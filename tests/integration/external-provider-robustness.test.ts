import { describe, it, expect, beforeEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { resetTestData, seedBaseConfig, adminPool } from "../setup";
import { createActiveTreatment, asDoctor, asSystem } from "../helpers";
import { chargeAdesaoCommand } from "@/modules/subscription/application/subscription.commands";
import { recordDoctorDecisionCommand } from "@/modules/decision/application/doctor-decision.commands";
import { signPrescriptionCommand } from "@/modules/prescription/application/prescription.commands";
import * as fakes from "@/ports/fakes";

async function doctorUserIdFor(doctorId: string): Promise<string> {
  const { rows } = await adminPool.query(`SELECT user_id FROM doctors WHERE id = $1`, [doctorId]);
  return rows[0].user_id;
}

beforeEach(async () => {
  await resetTestData();
  await seedBaseConfig();
});

describe("Robustez transacional — Payment Gateway", () => {
  it("se o gateway de pagamento LANÇAR exceção, a Adesao criada não é revertida", async () => {
    const { treatment, patient } = await createActiveTreatment({ cpf: "99000000001" });
    const spy = vi.spyOn(fakes.fakePaymentGateway, "charge").mockRejectedValueOnce(new Error("timeout do provedor"));

    const adesao = await chargeAdesaoCommand(asSystem(), {
      patientId: patient.id,
      treatmentId: treatment.id,
      planKey: "ESSENCIAL",
      idempotencyKey: randomUUID(),
    });

    const { rows } = await adminPool.query(`SELECT * FROM adesoes WHERE id = $1`, [adesao.id]);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("PENDING");

    const { rows: auditRows } = await adminPool.query(
      `SELECT * FROM audit_logs WHERE entity_type='Adesao' AND entity_id=$1`,
      [adesao.id]
    );
    expect(auditRows.length).toBeGreaterThan(0);

    spy.mockRestore();
  });
});

describe("Robustez transacional — Prescription Provider", () => {
  it("se o provedor de assinatura LANÇAR exceção, a Prescription vai para FAILED, não desaparece", async () => {
    const { treatment, doctor } = await createActiveTreatment({ cpf: "99000000002" });
    const doctorUserId = await doctorUserIdFor(doctor.id);

    const { prescriptionId } = await recordDoctorDecisionCommand(asDoctor(doctorUserId), {
      treatmentId: treatment.id,
      doctorId: doctor.id,
      action: "ISSUE_PRESCRIPTION",
    });
    expect(prescriptionId).not.toBeNull();

    const spy = vi.spyOn(fakes.fakePrescriptionProvider, "sign").mockRejectedValueOnce(new Error("provedor fora do ar"));

    const result = await signPrescriptionCommand(asDoctor(doctorUserId), prescriptionId as string, doctor.id);
    expect(result.status).toBe("FAILED");

    const { rows } = await adminPool.query(`SELECT status FROM prescriptions WHERE id = $1`, [prescriptionId]);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("FAILED");

    spy.mockRestore();
  });
});
