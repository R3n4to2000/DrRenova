import { describe, it, expect, beforeEach } from "vitest";
import { resetTestData, seedBaseConfig, adminPool } from "../setup";
import { createActiveTreatment, asDoctor, asPatient, asSystem } from "../helpers";
import { withContext } from "@/lib/db";
import { continuityEngineService } from "@/modules/continuity/application/continuity-engine.service";
import { checkInService, InvalidCheckInTransitionError } from "@/modules/checkin/application/checkin.service";
import { recordDoctorDecisionCommand } from "@/modules/decision/application/doctor-decision.commands";
import { doctorDecisionService } from "@/modules/decision/application/doctor-decision.service";
import { treatmentService } from "@/modules/treatment/application/treatment.service";

beforeEach(async () => {
  await resetTestData();
  await seedBaseConfig();
});

describe("Invariante 8 — revisão registrada recalcula a próxima revisão", () => {
  it("MAINTAIN atualiza lastReviewAt/nextReviewDueAt para ~90 dias à frente (default da categoria)", async () => {
    const { treatment, doctor } = await createActiveTreatment({ cpf: "70707070701" });
    const { rows: before } = await adminPool.query(`SELECT next_review_due_at FROM treatments WHERE id = $1`, [
      treatment.id,
    ]);

    await recordDoctorDecisionCommand(asDoctor((await adminPool.query(`SELECT user_id FROM doctors WHERE id=$1`, [doctor.id])).rows[0].user_id), {
      treatmentId: treatment.id,
      doctorId: doctor.id,
      action: "MAINTAIN",
    });

    const { rows: after } = await adminPool.query(`SELECT last_review_at, next_review_due_at FROM treatments WHERE id = $1`, [
      treatment.id,
    ]);
    expect(after[0].last_review_at).not.toBeNull();
    expect(new Date(after[0].next_review_due_at).getTime()).toBeGreaterThan(new Date(before[0].next_review_due_at).getTime() - 1000);
    const daysDiff = (new Date(after[0].next_review_due_at).getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    expect(daysDiff).toBeGreaterThan(89);
    expect(daysDiff).toBeLessThan(91);
  });
});

describe("Invariante 9 — override médico prevalece sobre o default da categoria", () => {
  it("CHANGE_REVIEW_PERIOD define o override e a próxima revisão passa a usar o novo valor", async () => {
    const { treatment, doctor } = await createActiveTreatment({ cpf: "70707070702" });
    const doctorUserId = (await adminPool.query(`SELECT user_id FROM doctors WHERE id=$1`, [doctor.id])).rows[0].user_id;

    await recordDoctorDecisionCommand(asDoctor(doctorUserId), {
      treatmentId: treatment.id,
      doctorId: doctor.id,
      action: "CHANGE_REVIEW_PERIOD",
      reviewPeriodDaysNew: 30,
    });

    const effective = await withContext(asSystem(), (client) => treatmentService.effectiveReviewPeriodDays(client, treatment.id));
    expect(effective).toBe(30); // não os 90 default da categoria

    const { rows } = await adminPool.query(`SELECT next_review_due_at FROM treatments WHERE id = $1`, [treatment.id]);
    const daysDiff = (new Date(rows[0].next_review_due_at).getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    expect(daysDiff).toBeGreaterThan(29);
    expect(daysDiff).toBeLessThan(31);
  });
});

describe("Invariante 2/3 — check-in vencido/ausência de resposta não altera tratamento nem cancela assinatura", () => {
  it("expirar um check-in não muda o status do tratamento nem da assinatura", async () => {
    const { treatment } = await createActiveTreatment({ cpf: "70707070703" });

    const checkInId = await withContext(asSystem(), (client) => continuityEngineService.scheduleCheckIn(client, treatment.id));
    await withContext(asSystem(), (client) => continuityEngineService.openCheckIn(client, checkInId, 0)); // expira imediatamente (expiresInDays=0)

    const { rows: beforeTreatment } = await adminPool.query(`SELECT status FROM treatments WHERE id = $1`, [treatment.id]);
    const { rows: beforeSub } = await adminPool.query(`SELECT status FROM subscriptions WHERE treatment_id = $1`, [treatment.id]);

    await withContext(asSystem(), (client) => continuityEngineService.expireOverdueCheckIns(client, new Date(Date.now() + 1000)));

    const { rows: afterTreatment } = await adminPool.query(`SELECT status FROM treatments WHERE id = $1`, [treatment.id]);
    const { rows: afterSub } = await adminPool.query(`SELECT status FROM subscriptions WHERE treatment_id = $1`, [treatment.id]);

    expect(afterTreatment[0].status).toBe(beforeTreatment[0].status);
    expect(afterSub[0].status).toBe(beforeSub[0].status);
    expect(afterTreatment[0].status).toBe("ACTIVE");
    expect(afterSub[0].status).toBe("ACTIVE");
  });

  it("check-in expirado gera uma Intercorrencia OPERACIONAL, não uma decisão clínica", async () => {
    const { treatment } = await createActiveTreatment({ cpf: "70707070704" });
    const checkInId = await withContext(asSystem(), (client) => continuityEngineService.scheduleCheckIn(client, treatment.id));
    await withContext(asSystem(), (client) => continuityEngineService.openCheckIn(client, checkInId, 0));
    await withContext(asSystem(), (client) => continuityEngineService.expireOverdueCheckIns(client, new Date(Date.now() + 1000)));

    const { rows } = await adminPool.query(`SELECT origin, status, description FROM intercorrencias WHERE treatment_id = $1`, [
      treatment.id,
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].origin).toBe("ENGINE");
    expect(rows[0].status).toBe("OPEN");
  });
});

describe("Invariante 11 — intercorrência não é resolvida automaticamente pelo Engine", () => {
  it("expirar check-ins não resolve intercorrências existentes nem cria decisão", async () => {
    const { treatment } = await createActiveTreatment({ cpf: "70707070705" });
    const checkInId = await withContext(asSystem(), (client) => continuityEngineService.scheduleCheckIn(client, treatment.id));
    await withContext(asSystem(), (client) => continuityEngineService.openCheckIn(client, checkInId, 0));
    await withContext(asSystem(), (client) => continuityEngineService.expireOverdueCheckIns(client, new Date(Date.now() + 1000)));

    const decisions = await withContext(asSystem(), (client) => doctorDecisionService.historyForTreatment(client, treatment.id));
    expect(decisions).toHaveLength(0); // nenhuma decisão médica foi criada pelo Engine

    const { rows } = await adminPool.query(`SELECT status FROM intercorrencias WHERE treatment_id = $1`, [treatment.id]);
    expect(rows[0].status).toBe("OPEN"); // permanece aberta — só um médico resolve
  });
});

describe("Invariante 17 — reativar um tratamento já ativo não duplica efeito", () => {
  it("chamar activateTreatment duas vezes não reseta datas nem duplica o tratamento", async () => {
    const { treatment, subscription, patient } = await createActiveTreatment({ cpf: "70707070707" });
    const { rows: before } = await adminPool.query(`SELECT next_review_due_at, activated_at FROM treatments WHERE id = $1`, [
      treatment.id,
    ]);

    const { activateTreatmentCommand } = await import("@/modules/continuity/application/continuity.commands");
    await expect(
      activateTreatmentCommand(asSystem(), { subscriptionId: subscription.id, treatmentId: treatment.id, patientId: patient.id })
    ).rejects.toThrow(); // Subscription já ACTIVE -> transição ACTIVE->ACTIVE é inválida, rejeitada com segurança

    const { rows: after } = await adminPool.query(`SELECT next_review_due_at, activated_at FROM treatments WHERE id = $1`, [
      treatment.id,
    ]);
    expect(new Date(after[0].activated_at).getTime()).toBe(new Date(before[0].activated_at).getTime());
    expect(new Date(after[0].next_review_due_at).getTime()).toBe(new Date(before[0].next_review_due_at).getTime());
  });
});

describe("Invariante 1 — Engine não cria decisão clínica", () => {
  it("nenhum método do ContinuityEngineService insere em doctor_decisions", async () => {
    const { treatment } = await createActiveTreatment({ cpf: "70707070706" });
    const checkInId = await withContext(asSystem(), (client) => continuityEngineService.scheduleCheckIn(client, treatment.id));
    await withContext(asSystem(), (client) => continuityEngineService.openCheckIn(client, checkInId, 7));
    await withContext(asSystem(), (client) =>
      continuityEngineService.recordCheckInAnswers(client, checkInId, [
        { fieldKey: "valor_generico", valueType: "NUMBER", value: 42 },
      ])
    );

    const decisions = await withContext(asSystem(), (client) => doctorDecisionService.historyForTreatment(client, treatment.id));
    expect(decisions).toHaveLength(0);
  });
});
