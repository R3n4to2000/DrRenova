import { describe, it, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { resetTestData, seedBaseConfig, adminPool } from "../setup";
import { createTestPatient, createTestDoctor, asSystem } from "../helpers";
import { withContext } from "@/lib/db";
import { treatmentService } from "@/modules/treatment/application/treatment.service";
import { subscriptionService, EligibilityNotApprovedError, InvalidTransitionError } from "@/modules/subscription/application/subscription.service";
import { adesaoService } from "@/modules/subscription/application/adesao.service";
import { eligibilityService } from "@/modules/subscription/application/eligibility.service";
import { configService } from "@/modules/config/application/config.service";

beforeEach(async () => {
  await resetTestData();
  await seedBaseConfig();
});

async function setupPatientTreatment() {
  const { patient } = await createTestPatient();
  const { doctor } = await createTestDoctor();
  const treatment = await withContext(asSystem(), (client) =>
    treatmentService.createTreatment(client, { patientId: patient.id, categoryKey: "PRESSAO_ALTA" })
  );
  return { patient, doctor, treatment };
}

describe("Critério 3 — gate de elegibilidade é real, não decorativo", () => {
  it("rejeita ativar a assinatura sem EligibilityDecision=APPROVED", async () => {
    const { patient, treatment } = await setupPatientTreatment();
    const subscription = await withContext(asSystem(), (client) =>
      subscriptionService.createPending(client, { patientId: patient.id, treatmentId: treatment.id, planKey: "ESSENCIAL" })
    );

    await expect(
      withContext(asSystem(), (client) => subscriptionService.activateAfterEligibility(client, subscription.id))
    ).rejects.toThrow(EligibilityNotApprovedError);
  });

  it("ativa a assinatura somente após EligibilityDecision=APPROVED", async () => {
    const { patient, doctor, treatment } = await setupPatientTreatment();
    const subscription = await withContext(asSystem(), (client) =>
      subscriptionService.createPending(client, { patientId: patient.id, treatmentId: treatment.id, planKey: "ESSENCIAL" })
    );

    await withContext(asSystem(), (client) =>
      eligibilityService.recordDecision(client, {
        patientId: patient.id,
        treatmentId: treatment.id,
        doctorId: doctor.id,
        outcome: "APPROVED",
      })
    );

    const activated = await withContext(asSystem(), (client) =>
      subscriptionService.activateAfterEligibility(client, subscription.id)
    );
    expect(activated.status).toBe("ACTIVE");
    expect(activated.first_charge_at).not.toBeNull();
  });
});

describe("Critério 4 — Adesão é independente da elegibilidade", () => {
  it("permite criar e marcar Adesao como paga sem nenhuma EligibilityDecision existir", async () => {
    const { patient, treatment } = await setupPatientTreatment();
    const adesao = await withContext(asSystem(), (client) =>
      adesaoService.createAdesao(client, {
        patientId: patient.id,
        treatmentId: treatment.id,
        planKey: "ESSENCIAL",
        idempotencyKey: randomUUID(),
      })
    );
    const paid = await withContext(asSystem(), (client) => adesaoService.markPaid(client, adesao.id));
    expect(paid.status).toBe("PAID");

    const decision = await withContext(asSystem(), (client) => eligibilityService.latestForTreatment(client, treatment.id));
    expect(decision).toBeNull();
  });
});

describe("Critério 14 — EligibilityDecision anterior nunca é sobrescrita", () => {
  it("registra uma nova linha a cada avaliação, preservando o histórico completo", async () => {
    const { patient, doctor, treatment } = await setupPatientTreatment();

    await withContext(asSystem(), (client) =>
      eligibilityService.recordDecision(client, {
        patientId: patient.id,
        treatmentId: treatment.id,
        doctorId: doctor.id,
        outcome: "NEEDS_MORE_INFO",
      })
    );
    await withContext(asSystem(), (client) =>
      eligibilityService.recordDecision(client, {
        patientId: patient.id,
        treatmentId: treatment.id,
        doctorId: doctor.id,
        outcome: "APPROVED",
      })
    );

    const history = await withContext(asSystem(), (client) => eligibilityService.historyForTreatment(client, treatment.id));
    expect(history).toHaveLength(2);
    expect(history[0].outcome).toBe("NEEDS_MORE_INFO");
    expect(history[1].outcome).toBe("APPROVED");
  });

  it("exige clinicalNote quando outcome = NOT_ELIGIBLE", async () => {
    const { patient, doctor, treatment } = await setupPatientTreatment();
    await expect(
      withContext(asSystem(), (client) =>
        eligibilityService.recordDecision(client, {
          patientId: patient.id,
          treatmentId: treatment.id,
          doctorId: doctor.id,
          outcome: "NOT_ELIGIBLE",
        })
      )
    ).rejects.toThrow(/clinicalNote/);
  });
});

describe("Critério 16 — transição inválida de Subscription é rejeitada", () => {
  it("rejeita PENDING_ELIGIBILITY -> PAST_DUE na camada de serviço", async () => {
    const { patient, treatment } = await setupPatientTreatment();
    const subscription = await withContext(asSystem(), (client) =>
      subscriptionService.createPending(client, { patientId: patient.id, treatmentId: treatment.id, planKey: "ESSENCIAL" })
    );
    await expect(
      withContext(asSystem(), (client) => subscriptionService.transition(client, subscription.id, "PAST_DUE", "tentativa inválida"))
    ).rejects.toThrow(InvalidTransitionError);
  });

  it("rejeita a mesma transição inválida no BANCO (trigger), mesmo bypassando o serviço", async () => {
    const { patient, treatment } = await setupPatientTreatment();
    const subscription = await withContext(asSystem(), (client) =>
      subscriptionService.createPending(client, { patientId: patient.id, treatmentId: treatment.id, planKey: "ESSENCIAL" })
    );
    // update direto via role de migração, contornando o serviço de aplicação
    await expect(
      adminPool.query(`UPDATE subscriptions SET status = 'PAST_DUE' WHERE id = $1`, [subscription.id])
    ).rejects.toThrow();
  });
});

describe("Critério 17 — idempotência", () => {
  it("uma chamada repetida com a mesma idempotencyKey não duplica a Adesao", async () => {
    const { patient, treatment } = await setupPatientTreatment();
    const key = randomUUID();

    const first = await withContext(asSystem(), (client) =>
      adesaoService.createAdesao(client, { patientId: patient.id, treatmentId: treatment.id, planKey: "ESSENCIAL", idempotencyKey: key })
    );
    const second = await withContext(asSystem(), (client) =>
      adesaoService.createAdesao(client, { patientId: patient.id, treatmentId: treatment.id, planKey: "ESSENCIAL", idempotencyKey: key })
    );

    expect(second.id).toBe(first.id);
    const { rows } = await adminPool.query(`SELECT count(*)::int AS c FROM adesoes WHERE idempotency_key = $1`, [key]);
    expect(rows[0].c).toBe(1);
  });
});

describe("Critério 5/15 — preço cobrado é snapshot, config pode mudar sem afetar histórico", () => {
  it("alterar o PlanConfig não modifica o snapshot financeiro já persistido", async () => {
    const { patient, treatment } = await setupPatientTreatment();
    const subscription = await withContext(asSystem(), (client) =>
      subscriptionService.createPending(client, { patientId: patient.id, treatmentId: treatment.id, planKey: "ESSENCIAL" })
    );
    expect(Number(subscription.monthly_amount_snapshot)).toBe(39.9);

    await withContext(asSystem(), (client) =>
      configService.publishNewPlanVersion(client, "ESSENCIAL", {
        name: "Essencial",
        adesaoAmount: "49.90",
        monthlyAmount: "49.90",
        annualAmount: "499.00",
      })
    );

    const { rows } = await adminPool.query(`SELECT monthly_amount_snapshot FROM subscriptions WHERE id = $1`, [subscription.id]);
    expect(Number(rows[0].monthly_amount_snapshot)).toBe(39.9); // continua o valor antigo, não o novo
  });
});
