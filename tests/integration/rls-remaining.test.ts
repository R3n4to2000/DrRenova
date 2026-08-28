import { describe, it, expect, beforeEach } from "vitest";
import { resetTestData, seedBaseConfig, adminPool } from "../setup";
import { createTestPatient, asPatient, asSupport } from "../helpers";
import { withContext } from "@/lib/db";
import { communicationConsentService } from "@/modules/subscription/application/communication-consent.service";

beforeEach(async () => {
  await resetTestData();
  await seedBaseConfig();
});

describe("Regressão 6 — paciente A não acessa consentimentos/preferências de paciente B", () => {
  it("paciente A não enxerga CommunicationConsent de paciente B", async () => {
    const { user: userA } = await createTestPatient({ cpf: "10111213141" });
    const { patient: patientB } = await createTestPatient({ cpf: "15161718191" });

    await adminPool.query(
      `INSERT INTO communication_consents (patient_id, purpose, channel, version, origin)
       VALUES ($1, 'comunicacao_proativa_acompanhamento', 'WHATSAPP', 'v1', 'onboarding_web')`,
      [patientB.id]
    );

    const visible = await withContext(asPatient(userA.id), (client) =>
      client.query(`SELECT * FROM communication_consents WHERE patient_id = $1`, [patientB.id]).then((r) => r.rows)
    );
    expect(visible).toHaveLength(0);
  });

  it("paciente A não enxerga nem consegue atualizar PatientCommunicationPreference de paciente B", async () => {
    const { user: userA } = await createTestPatient({ cpf: "20212223241" });
    const { patient: patientB } = await createTestPatient({ cpf: "25262728291" });

    await adminPool.query(
      `INSERT INTO patient_communication_preferences (patient_id, preferred_hour) VALUES ($1, 9)`,
      [patientB.id]
    );

    const visible = await withContext(asPatient(userA.id), (client) =>
      client.query(`SELECT * FROM patient_communication_preferences WHERE patient_id = $1`, [patientB.id]).then((r) => r.rows)
    );
    expect(visible).toHaveLength(0);

    const updateResult = await withContext(asPatient(userA.id), (client) =>
      client.query(`UPDATE patient_communication_preferences SET preferred_hour = 23 WHERE patient_id = $1`, [patientB.id])
    );
    expect(updateResult.rowCount).toBe(0);
  });
});

describe("Regressão 7 — RLS de users impede acesso indevido", () => {
  it("um paciente não enxerga a linha de users de outro paciente", async () => {
    const { user: userA } = await createTestPatient({ cpf: "30313233341" });
    const { user: userB } = await createTestPatient({ cpf: "35363738391" });

    const visible = await withContext(asPatient(userA.id), (client) =>
      client.query(`SELECT * FROM users WHERE id = $1`, [userB.id]).then((r) => r.rows)
    );
    expect(visible).toHaveLength(0);

    const own = await withContext(asPatient(userA.id), (client) =>
      client.query(`SELECT * FROM users WHERE id = $1`, [userA.id]).then((r) => r.rows)
    );
    expect(own).toHaveLength(1);
  });

  it("SUPPORT não enxerga nenhuma linha de users por padrão (sem policy = negado)", async () => {
    const { user } = await createTestPatient({ cpf: "40414243441" });
    const visible = await withContext(asSupport(), (client) =>
      client.query(`SELECT * FROM users WHERE id = $1`, [user.id]).then((r) => r.rows)
    );
    expect(visible).toHaveLength(0);
  });
});

describe("Regressão adicional — revogação de consentimento via serviço continua respeitando RLS", () => {
  it("o próprio paciente consegue revogar seu consentimento através do serviço", async () => {
    const { user, patient } = await createTestPatient({ cpf: "50515253541" });
    const consent = await withContext(asPatient(user.id), (client) =>
      communicationConsentService.accept(client, {
        patientId: patient.id,
        purpose: "comunicacao_proativa_acompanhamento",
        channel: "WHATSAPP",
        version: "v1",
        origin: "onboarding_web",
      })
    );
    const revoked = await withContext(asPatient(user.id), (client) =>
      communicationConsentService.revoke(client, consent.id)
    );
    expect(revoked.revoked_at).not.toBeNull();
  });
});
