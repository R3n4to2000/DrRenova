import { describe, it, expect, beforeEach } from "vitest";
import { resetTestData, seedBaseConfig } from "../setup";
import { createTestPatient, createTestDoctor, asDoctor, asSystem } from "../helpers";
import { withContext } from "@/lib/db";
import { identityService, MfaRequiredError } from "@/modules/identity/application/identity.service";
import { carteiraService } from "@/modules/doctor/application/doctor.service";
import { conversationService } from "@/modules/conversation/application/conversation.service";

beforeEach(async () => {
  await resetTestData();
  await seedBaseConfig();
});

describe("Critério 1 — RBAC + MFA", () => {
  it("bloqueia login de DOCTOR sem MFA habilitado", async () => {
    const user = await withContext(asSystem(), (client) =>
      identityService.createUser(client, {
        authUserId: crypto.randomUUID(),
        email: "sem-mfa@test.dev",
        role: "DOCTOR",
        mfaEnabled: false,
      })
    );
    expect(() => identityService.assertLoginAllowed(user)).toThrow(MfaRequiredError);
  });

  it("permite login de PATIENT sem MFA", async () => {
    const { user } = await createTestPatient();
    expect(() => identityService.assertLoginAllowed(user)).not.toThrow();
  });

  it("permite login de DOCTOR com MFA habilitado", async () => {
    const { user } = await createTestDoctor();
    expect(() => identityService.assertLoginAllowed(user)).not.toThrow();
  });
});

describe("Critério 2 — Carteira nunca desaparece", () => {
  it("mantém o histórico ao encerrar um vínculo (isCurrent=false, endedAt preenchido)", async () => {
    const { patient } = await createTestPatient();
    const { doctor } = await createTestDoctor();

    const assignment = await withContext(asSystem(), (client) =>
      carteiraService.assign(client, { patientId: patient.id, doctorId: doctor.id, reason: "consulta inicial" })
    );
    expect(assignment.is_current).toBe(true);

    await withContext(asSystem(), (client) => carteiraService.endAssignment(client, assignment.id, "férias"));

    const history = await withContext(asSystem(), (client) => carteiraService.historyForPatient(client, patient.id));
    expect(history).toHaveLength(1);
    expect(history[0].is_current).toBe(false);
    expect(history[0].ended_at).not.toBeNull();
    expect(history[0].reason).toBe("férias");
  });

  it("uma nova atribuição cria uma NOVA linha, não sobrescreve a anterior", async () => {
    const { patient } = await createTestPatient();
    const { doctor: doctor1 } = await createTestDoctor();
    const { doctor: doctor2 } = await createTestDoctor();

    await withContext(asSystem(), (client) =>
      carteiraService.assign(client, { patientId: patient.id, doctorId: doctor1.id, reason: "consulta inicial" })
    );
    await withContext(asSystem(), (client) =>
      carteiraService.assign(client, { patientId: patient.id, doctorId: doctor2.id, reason: "solicitação do paciente" })
    );

    const history = await withContext(asSystem(), (client) => carteiraService.historyForPatient(client, patient.id));
    expect(history).toHaveLength(2);
  });
});

describe("Critério 7 — fundação da Conversation existe sem funcionar automaticamente", () => {
  it("permite criar Conversation e ConversationMessage manualmente", async () => {
    const { patient } = await createTestPatient();
    const conversation = await withContext(asSystem(), (client) =>
      conversationService.createConversation(client, patient.id)
    );
    const message = await withContext(asSystem(), (client) =>
      conversationService.addMessage(client, {
        conversationId: conversation.id,
        sender: "SYSTEM",
        channel: "SYSTEM",
        content: "mensagem de teste — sem Camilla implementada nesta fatia",
      })
    );
    expect(message.conversation_id).toBe(conversation.id);
  });
});
