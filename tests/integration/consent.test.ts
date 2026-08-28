import { describe, it, expect, beforeEach } from "vitest";
import { resetTestData, seedBaseConfig } from "../setup.js";
import { createTestPatient, asSystem } from "../helpers.js";
import { withContext } from "@/lib/db";
import { communicationConsentService } from "@/modules/subscription/application/communication-consent.service";

beforeEach(async () => {
  await resetTestData();
  await seedBaseConfig();
});

describe("Critério 18 — revogação de consentimento preserva histórico do aceite", () => {
  it("revogar não apaga nem altera version/acceptedAt/origin do aceite original", async () => {
    const { patient } = await createTestPatient({ cpf: "20202020202" });

    const consent = await withContext(asSystem(), (client) =>
      communicationConsentService.accept(client, {
        patientId: patient.id,
        purpose: "comunicacao_proativa_acompanhamento",
        channel: "WHATSAPP",
        version: "v1",
        origin: "onboarding_web",
      })
    );
    expect(consent.revoked_at).toBeNull();

    const revoked = await withContext(asSystem(), (client) => communicationConsentService.revoke(client, consent.id));

    expect(revoked.revoked_at).not.toBeNull();
    // a prova do aceite original permanece intacta
    expect(revoked.version).toBe("v1");
    expect(revoked.origin).toBe("onboarding_web");
    expect(new Date(revoked.accepted_at).getTime()).toBe(new Date(consent.accepted_at).getTime());
  });

  it("um novo aceite cria uma NOVA linha, nunca sobrescreve o anterior", async () => {
    const { patient } = await createTestPatient({ cpf: "30303030303" });

    await withContext(asSystem(), (client) =>
      communicationConsentService.accept(client, {
        patientId: patient.id,
        purpose: "comunicacao_proativa_acompanhamento",
        channel: "WHATSAPP",
        version: "v1",
        origin: "onboarding_web",
      })
    );
    await withContext(asSystem(), (client) =>
      communicationConsentService.accept(client, {
        patientId: patient.id,
        purpose: "comunicacao_proativa_acompanhamento",
        channel: "WHATSAPP",
        version: "v2",
        origin: "app_settings",
      })
    );

    const history = await withContext(asSystem(), (client) =>
      communicationConsentService.historyForPatient(client, patient.id)
    );
    expect(history).toHaveLength(2);
    expect(history[0].version).toBe("v1");
    expect(history[1].version).toBe("v2");
  });
});
