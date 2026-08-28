import { describe, it, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { resetTestData, seedBaseConfig, adminPool } from "../setup";
import { asSystem, asDoctor, asPatient } from "../helpers";
import { withContext } from "@/lib/db";
import { identityService } from "@/modules/identity/application/identity.service";
import { createPatientCommand } from "@/modules/patient/application/patient.commands";
import { createDoctorCommand, assignCarteiraCommand } from "@/modules/doctor/application/doctor.commands";
import { createTreatmentCommand } from "@/modules/treatment/application/treatment.commands";
import {
  createPendingSubscriptionCommand,
  chargeAdesaoCommand,
  recordEligibilityDecisionCommand,
} from "@/modules/subscription/application/subscription.commands";
import { activateTreatmentCommand, scheduleCheckInCommand, openCheckInCommand } from "@/modules/continuity/application/continuity.commands";
import { submitCheckInAnswersCommand } from "@/modules/checkin/application/checkin.commands";
import { queueService } from "@/modules/continuity/application/queue.service";
import { recordDoctorDecisionCommand } from "@/modules/decision/application/doctor-decision.commands";
import { outboxService } from "@/modules/camilla/application/outbox.service";

/**
 * E2E — LIMITAÇÃO DO SANDBOX DOCUMENTADA: Playwright não pôde ser usado
 * porque o download do binário do Chromium é bloqueado pela política de
 * egress deste ambiente (`cdn.playwright.dev` fora da allowlist — mesma
 * classe de restrição já registrada para `binaries.prisma.sh`). Limitação
 * de ambiente de build, não defeito do produto.
 *
 * Equivalente máximo possível sem browser: percorre a Jornada 1 de ponta a
 * ponta usando os mesmos Commands que rotas HTTP/Server Actions chamam.
 */
beforeEach(async () => {
  await resetTestData();
  await seedBaseConfig();
});

describe("E2E (equivalente sem browser) — Jornada 1: paciente elegível de ponta a ponta", () => {
  it("cadastro → adesão → consulta → APPROVED → mensalidade → ativação → check-in → fila → decisão → próximo ciclo", async () => {
    const patientAuthId = randomUUID();
    const patientUser = await withContext(asSystem(), (client) =>
      identityService.createUser(client, { authUserId: patientAuthId, email: `e2e_${patientAuthId}@test.dev`, role: "PATIENT" })
    );
    const patient = await createPatientCommand(asSystem(), {
      userId: patientUser.id,
      fullName: "Jornada Um Paciente",
      cpf: "50505050505",
      birthDate: "1975-05-05",
      whatsapp: "+5531955550000",
    });

    const doctorAuthId = randomUUID();
    const doctorUser = await withContext(asSystem(), (client) =>
      identityService.createUser(client, { authUserId: doctorAuthId, email: `e2e_doc_${doctorAuthId}@test.dev`, role: "DOCTOR", mfaEnabled: true })
    );
    const doctor = await createDoctorCommand(asSystem(), {
      userId: doctorUser.id,
      fullName: "Dra. Jornada Um",
      crm: "999999",
      crmState: "SP",
      specialty: "Clínica Geral",
    });

    const treatment = await createTreatmentCommand(asSystem(), { patientId: patient.id, categoryKey: "PRESSAO_ALTA" });
    await assignCarteiraCommand(asSystem(), { patientId: patient.id, doctorId: doctor.id, treatmentId: treatment.id, reason: "consulta inicial" });

    const adesao = await chargeAdesaoCommand(asSystem(), {
      patientId: patient.id,
      treatmentId: treatment.id,
      planKey: "ESSENCIAL",
      idempotencyKey: randomUUID(),
    });
    expect(adesao.status).toBe("PAID");

    const { conductInitialConsultationCommand } = await import("@/modules/treatment/application/consultation.commands");
    await conductInitialConsultationCommand(asDoctor(doctorUser.id), {
      treatmentId: treatment.id,
      patientId: patient.id,
      doctorId: doctor.id,
      providerMode: "OWN_DOCTOR",
    });
    const { rows: clinicalEvents } = await adminPool.query(`SELECT type FROM clinical_events WHERE treatment_id = $1`, [treatment.id]);
    expect(clinicalEvents.some((e) => e.type === "CONSULTATION")).toBe(true);

    await recordEligibilityDecisionCommand(asDoctor(doctorUser.id), {
      patientId: patient.id,
      treatmentId: treatment.id,
      doctorId: doctor.id,
      outcome: "APPROVED",
    });

    const subscription = await createPendingSubscriptionCommand(asSystem(), { patientId: patient.id, treatmentId: treatment.id, planKey: "ESSENCIAL" });
    await activateTreatmentCommand(asSystem(), { subscriptionId: subscription.id, treatmentId: treatment.id, patientId: patient.id });

    const { rows: treatmentRow } = await adminPool.query(`SELECT status FROM treatments WHERE id = $1`, [treatment.id]);
    expect(treatmentRow[0].status).toBe("ACTIVE");

    const { rows: intro } = await adminPool.query(`SELECT count(*)::int AS c FROM conversation_messages WHERE content LIKE 'INTRO:%'`);
    expect(intro[0].c).toBe(1);

    const checkInId = await scheduleCheckInCommand(asSystem(), treatment.id);
    await openCheckInCommand(asSystem(), checkInId, 7, patient.id);

    await submitCheckInAnswersCommand(asPatient(patientUser.id), checkInId, [
      { fieldKey: "valor_generico", valueType: "NUMBER", value: 80, rawInput: "80" },
    ]);

    const queue = await withContext(asDoctor(doctorUser.id), (client) => queueService.getDoctorQueue(client, doctor.id));
    expect(queue.some((q) => q.treatment_id === treatment.id)).toBe(true);

    const { decision } = await recordDoctorDecisionCommand(asDoctor(doctorUser.id), {
      treatmentId: treatment.id,
      patientId: patient.id,
      doctorId: doctor.id,
      action: "MAINTAIN",
      originCheckInId: checkInId,
    });
    expect(decision.action).toBe("MAINTAIN");

    const { rows: afterDecision } = await adminPool.query(`SELECT next_review_due_at, last_review_at FROM treatments WHERE id = $1`, [treatment.id]);
    expect(afterDecision[0].last_review_at).not.toBeNull();
    const daysAhead = (new Date(afterDecision[0].next_review_due_at).getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    expect(daysAhead).toBeGreaterThan(89);

    const dispatch = await outboxService.dispatchPending();
    expect(dispatch.sent).toBeGreaterThan(0);

    const { rows: auditCount } = await adminPool.query(`SELECT count(*)::int AS c FROM audit_logs WHERE entity_id = $1`, [treatment.id]);
    expect(auditCount[0].c).toBeGreaterThan(0);
  });
});
