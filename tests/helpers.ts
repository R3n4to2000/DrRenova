import { randomUUID } from "node:crypto";
import { withContext, type AppContext } from "@/lib/db";
import { identityService } from "@/modules/identity/application/identity.service";
import { patientService } from "@/modules/patient/application/patient.service";
import { doctorService, carteiraService } from "@/modules/doctor/application/doctor.service";
import { signSessionToken } from "@/lib/session-token";
import { treatmentService } from "@/modules/treatment/application/treatment.service";
import { subscriptionService } from "@/modules/subscription/application/subscription.service";
import { eligibilityService } from "@/modules/subscription/application/eligibility.service";
import { continuityEngineService } from "@/modules/continuity/application/continuity-engine.service";

const systemCtx: AppContext = { userId: null, role: "SYSTEM", correlationId: "test-setup" };

export async function createTestPatient(overrides?: { cpf?: string; whatsapp?: string }) {
  return withContext(systemCtx, async (client) => {
    const authUserId = randomUUID();
    const user = await identityService.createUser(client, {
      authUserId,
      email: `patient_${authUserId}@test.dev`,
      role: "PATIENT",
    });
    const patient = await patientService.createPatient(client, {
      userId: user.id,
      fullName: "Paciente de Teste",
      cpf: overrides?.cpf ?? "12345678900",
      birthDate: "1990-01-01",
      // WhatsApp único por padrão (agora com UNIQUE real via whatsapp_hash) —
      // deriva de um sufixo aleatório para nunca colidir entre testes que
      // não especificam explicitamente um número.
      whatsapp: overrides?.whatsapp ?? `+55319${String(Math.floor(Math.random() * 100000000)).padStart(8, "0")}`,
    });
    return { user, patient };
  });
}

export async function createTestDoctor() {
  return withContext(systemCtx, async (client) => {
    const authUserId = randomUUID();
    const user = await identityService.createUser(client, {
      authUserId,
      email: `doctor_${authUserId}@test.dev`,
      role: "DOCTOR",
      mfaEnabled: true,
    });
    const doctor = await doctorService.createDoctor(client, {
      userId: user.id,
      fullName: "Dra. Teste",
      crm: `CRM${Math.floor(Math.random() * 1000000)}`,
      crmState: "SP",
      specialty: "Clínica Geral",
    });
    return { user, doctor };
  });
}

export const asPatient = (userId: string): AppContext => ({ userId, role: "PATIENT", correlationId: "test" });
export const asDoctor = (userId: string): AppContext => ({ userId, role: "DOCTOR", correlationId: "test" });
export const asAdmin = (): AppContext => ({ userId: null, role: "ADMIN", correlationId: "test" });
export const asSupport = (): AppContext => ({ userId: null, role: "SUPPORT", correlationId: "test" });
export const asSystem = (): AppContext => ({ userId: null, role: "SYSTEM", correlationId: "test" });

/**
 * Emite um token de sessão válido para testes, usando o MESMO mecanismo de
 * assinatura real (`signSessionToken`) — não é um bypass da verificação,
 * é a forma legítima de um teste simular uma sessão já autenticada, já que
 * o login real (Supabase Auth) ainda não está integrado (ver PENDENCIAS.md).
 */
export function mintTestSessionToken(input: { userId: string; role: "PATIENT" | "DOCTOR" | "ADMIN" | "SUPPORT"; mfaVerified?: boolean }): string {
  return signSessionToken({ sub: input.userId, role: input.role, mfaVerified: input.mfaVerified ?? false });
}

/**
 * Monta um Treatment ACTIVE de ponta a ponta (paciente + médico + carteira +
 * elegibilidade APPROVED + assinatura ACTIVE + Engine ativado) — usado como
 * fixture pelos testes da Fatia 2, que assumem esse estado já pronto.
 */
export async function createActiveTreatment(overrides?: { cpf?: string; whatsapp?: string }) {
  const { user: patientUser, patient } = await createTestPatient({ cpf: overrides?.cpf, whatsapp: overrides?.whatsapp });
  const { user: doctorUser, doctor } = await createTestDoctor();

  const treatment = await withContext(asSystem(), (client) =>
    treatmentService.createTreatment(client, { patientId: patient.id, categoryKey: "PRESSAO_ALTA" })
  );

  await withContext(asSystem(), (client) =>
    carteiraService.assign(client, {
      patientId: patient.id,
      doctorId: doctor.id,
      treatmentId: treatment.id,
      reason: "consulta inicial",
    })
  );

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

  await withContext(asSystem(), (client) => subscriptionService.activateAfterEligibility(client, subscription.id));
  await withContext(asSystem(), (client) => continuityEngineService.activateTreatment(client, treatment.id));

  return { patientUser, patient, doctorUser, doctor, treatment, subscription };
}
