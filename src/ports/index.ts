/**
 * Ports — interfaces que isolam o domínio de qualquer SDK/fornecedor
 * concreto (Supabase, gateway de pagamento, WhatsApp, telemedicina).
 * Nesta fatia, todas têm apenas implementação Fake (ver ./fakes.ts).
 */

export interface PaymentGatewayPort {
  charge(input: { amount: string; idempotencyKey: string }): Promise<{ status: "PAID" | "FAILED"; providerRef: string }>;
}

export interface WhatsAppGatewayPort {
  sendMessage(input: { to: string; body: string }): Promise<{ externalMessageId: string }>;
}

export interface TelemedicineProviderPort {
  scheduleConsultation(input: { patientId: string; doctorId: string }): Promise<{ providerRef: string }>;
}

export interface PrescriptionProviderPort {
  sign(input: { treatmentId: string; doctorId: string; prescriptionId: string }): Promise<{
    providerRef: string;
    documentRef: string;
  }>;
}

export type CamillaIntent =
  | "ADMINISTRATIVE"
  | "STRUCTURED_FOLLOWUP"
  | "CLINICAL_QUESTION"
  | "POSSIBLE_INTERCURRENCE"
  | "POTENTIAL_URGENCY"
  | "HUMAN_SUPPORT_REQUIRED";

/**
 * Classificador de intenção. Nesta fatia, a implementação (ver
 * src/ports/fakes.ts) é um STAGING ADAPTER heurístico (por palavra-chave),
 * não um LLM real — não há acesso a um provedor de IA neste ambiente. A
 * interface é o que importa: um provedor real de LLM pode substituí-la sem
 * o Orchestrator mudar.
 */
export interface IntentClassifierPort {
  classify(input: { text: string }): Promise<{ intent: CamillaIntent; confidence: number }>;
}

/**
 * Estrutura texto livre em valor numérico simples (ex.: "13 por 8" ->
 * {systolic:130, diastolic:80}, "135" -> {value:135}). STAGING/heurístico
 * nesta fatia — nunca interpreta clinicamente o valor, só extrai números.
 */
export interface AnswerStructurerPort {
  structure(input: { text: string }): Promise<{ structured: Record<string, number> | null }>;
}

export interface SchedulerPort {
  scheduleJob(input: { runAt: Date; jobName: string; payload: Record<string, unknown> }): Promise<void>;
}

export interface StoragePort {
  upload(input: { key: string; content: Buffer }): Promise<{ url: string }>;
}
