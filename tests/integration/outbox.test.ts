import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetTestData, seedBaseConfig, adminPool } from "../setup";
import { createActiveTreatment, asDoctor } from "../helpers";
import { withContext } from "@/lib/db";
import { recordDoctorDecisionCommand } from "@/modules/decision/application/doctor-decision.commands";
import { outboxService } from "@/modules/camilla/application/outbox.service";
import * as fakes from "@/ports/fakes";

async function doctorUserIdFor(doctorId: string): Promise<string> {
  const { rows } = await adminPool.query(`SELECT user_id FROM doctors WHERE id = $1`, [doctorId]);
  return rows[0].user_id;
}

beforeEach(async () => {
  await resetTestData();
  await adminPool.query(`DELETE FROM outbox_events`);
  await seedBaseConfig();
});

describe("Outbox — propriedade central: falha externa nunca desfaz a mutação clínica", () => {
  it("DoctorDecision + AuditLog + OutboxEvent commitam juntos; gateway falhando depois não reverte nada", async () => {
    const { treatment, doctor, patient } = await createActiveTreatment({ cpf: "98000000001" });
    const doctorUserId = await doctorUserIdFor(doctor.id);

    const spy = vi.spyOn(fakes.fakeWhatsAppGateway, "sendMessage").mockRejectedValueOnce(new Error("provedor indisponível"));

    const { decision } = await recordDoctorDecisionCommand(asDoctor(doctorUserId), {
      treatmentId: treatment.id,
      doctorId: doctor.id,
      patientId: patient.id,
      action: "MAINTAIN",
    });

    const { rows: decisionRows } = await adminPool.query(`SELECT * FROM doctor_decisions WHERE id = $1`, [decision.id]);
    expect(decisionRows).toHaveLength(1);

    const { rows: auditRows } = await adminPool.query(
      `SELECT * FROM audit_logs WHERE entity_type='DoctorDecision' AND entity_id=$1`,
      [decision.id]
    );
    expect(auditRows).toHaveLength(1);

    const { rows: outboxBefore } = await adminPool.query(`SELECT status FROM outbox_events`);
    expect(outboxBefore).toHaveLength(1);
    expect(outboxBefore[0].status).toBe("PENDING");

    const result = await outboxService.dispatchPending();
    expect(result.failed).toBe(1);

    const { rows: decisionAfter } = await adminPool.query(`SELECT * FROM doctor_decisions WHERE id = $1`, [decision.id]);
    expect(decisionAfter).toHaveLength(1);

    const { rows: outboxAfter } = await adminPool.query(`SELECT status, attempts, next_attempt_at FROM outbox_events`);
    expect(outboxAfter[0].status).toBe("FAILED");
    expect(outboxAfter[0].attempts).toBe(1);
    expect(new Date(outboxAfter[0].next_attempt_at).getTime()).toBeGreaterThan(Date.now());

    spy.mockRestore();
  });

  it("depois que o gateway volta, o dispatcher reprocessa e entrega — exatamente uma vez", async () => {
    const { treatment, doctor, patient } = await createActiveTreatment({ cpf: "98000000002" });
    const doctorUserId = await doctorUserIdFor(doctor.id);

    const spy = vi.spyOn(fakes.fakeWhatsAppGateway, "sendMessage").mockRejectedValueOnce(new Error("timeout"));
    await recordDoctorDecisionCommand(asDoctor(doctorUserId), { treatmentId: treatment.id, doctorId: doctor.id, patientId: patient.id, action: "MAINTAIN" });

    const first = await outboxService.dispatchPending();
    expect(first.failed).toBe(1);
    spy.mockRestore();

    await adminPool.query(`UPDATE outbox_events SET next_attempt_at = now()`);

    const sendSpy = vi.spyOn(fakes.fakeWhatsAppGateway, "sendMessage");
    const second = await outboxService.dispatchPending();
    expect(second.sent).toBe(1);
    expect(sendSpy).toHaveBeenCalledTimes(1);

    const { rows } = await adminPool.query(`SELECT status FROM outbox_events`);
    expect(rows[0].status).toBe("SENT");

    const third = await outboxService.dispatchPending();
    expect(third.sent).toBe(0);
    sendSpy.mockRestore();
  });
});

describe("Outbox — concorrência real entre dois dispatchers", () => {
  it("dois dispatchers concorrentes nunca entregam o mesmo evento duas vezes (claim atômico)", async () => {
    const { treatment, doctor, patient } = await createActiveTreatment({ cpf: "98000000003" });
    const doctorUserId = await doctorUserIdFor(doctor.id);
    await recordDoctorDecisionCommand(asDoctor(doctorUserId), { treatmentId: treatment.id, doctorId: doctor.id, patientId: patient.id, action: "MAINTAIN" });

    const sendSpy = vi.spyOn(fakes.fakeWhatsAppGateway, "sendMessage");

    const [r1, r2] = await Promise.all([outboxService.dispatchPending(), outboxService.dispatchPending()]);

    const totalSent = r1.sent + r2.sent;
    expect(totalSent).toBe(1);
    expect(sendSpy).toHaveBeenCalledTimes(1);

    sendSpy.mockRestore();
  });

  it("mesmo idempotencyKey nunca cria dois OutboxEvents equivalentes", async () => {
    await createActiveTreatment({ cpf: "98000000004" });
    await withContext({ userId: null, role: "SYSTEM", correlationId: "test" }, async (client) => {
      const id1 = await outboxService.enqueue(client, {
        eventType: "whatsapp.send",
        payload: { to: "x", body: "y" },
        idempotencyKey: "fixed-key-123",
      });
      const id2 = await outboxService.enqueue(client, {
        eventType: "whatsapp.send",
        payload: { to: "x", body: "y" },
        idempotencyKey: "fixed-key-123",
      });
      expect(id1).toBe(id2);
    });
    const { rows } = await adminPool.query(`SELECT count(*)::int AS c FROM outbox_events WHERE idempotency_key = 'fixed-key-123'`);
    expect(rows[0].c).toBe(1);
  });

  it("evento preso em PROCESSING é recuperado (volta para FAILED, retryable) após o timeout", async () => {
    const { treatment, doctor, patient } = await createActiveTreatment({ cpf: "98000000005" });
    const doctorUserId = await doctorUserIdFor(doctor.id);
    await recordDoctorDecisionCommand(asDoctor(doctorUserId), { treatmentId: treatment.id, doctorId: doctor.id, patientId: patient.id, action: "MAINTAIN" });

    await adminPool.query(
      `UPDATE outbox_events SET status = 'PROCESSING', processing_since = now() - interval '10 minutes'`
    );

    const recovered = await outboxService.recoverStuckEvents(5);
    expect(recovered).toBe(1);

    const { rows } = await adminPool.query(`SELECT status FROM outbox_events`);
    expect(rows[0].status).toBe("FAILED");
  });

  it("evento SENT nunca volta a ser processado, mesmo se o dispatcher rodar de novo", async () => {
    const { treatment, doctor, patient } = await createActiveTreatment({ cpf: "98000000006" });
    const doctorUserId = await doctorUserIdFor(doctor.id);
    await recordDoctorDecisionCommand(asDoctor(doctorUserId), { treatmentId: treatment.id, doctorId: doctor.id, patientId: patient.id, action: "MAINTAIN" });

    await outboxService.dispatchPending();
    const { rows: before } = await adminPool.query(`SELECT status FROM outbox_events`);
    expect(before[0].status).toBe("SENT");

    const sendSpy = vi.spyOn(fakes.fakeWhatsAppGateway, "sendMessage");
    const result = await outboxService.dispatchPending();
    expect(result.sent).toBe(0);
    expect(sendSpy).not.toHaveBeenCalled();
    sendSpy.mockRestore();
  });
});
