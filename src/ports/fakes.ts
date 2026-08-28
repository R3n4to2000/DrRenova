import type {
  PaymentGatewayPort,
  WhatsAppGatewayPort,
  TelemedicineProviderPort,
  PrescriptionProviderPort,
  SchedulerPort,
  StoragePort,
  IntentClassifierPort,
  AnswerStructurerPort,
} from "./index";

export const fakePaymentGateway: PaymentGatewayPort = {
  async charge({ idempotencyKey }) {
    return { status: "PAID", providerRef: `fake_${idempotencyKey}` };
  },
};

export const fakeWhatsAppGateway: WhatsAppGatewayPort = {
  async sendMessage() {
    return { externalMessageId: `fake_msg_${Date.now()}` };
  },
};

export const fakeTelemedicineProvider: TelemedicineProviderPort = {
  async scheduleConsultation() {
    return { providerRef: `fake_consult_${Date.now()}` };
  },
};

/**
 * Fake/Development do fornecedor de prescrição eletrônica — Fatia 2 não
 * escolhe fornecedor definitivo (ver docs/PENDENCIAS.md). Simula
 * assinatura com sucesso determinístico, suficiente para o fluxo de MVP.
 */
export const fakePrescriptionProvider: PrescriptionProviderPort = {
  async sign({ prescriptionId }) {
    return {
      providerRef: `fake_provider_${prescriptionId}`,
      documentRef: `fake://prescriptions/${prescriptionId}.pdf`,
    };
  },
};

/**
 * STAGING ADAPTER — heurística por palavra-chave, não um LLM real. Rótulo
 * explícito: `model = 'staging-keyword-classifier-v1'` é registrado em
 * AIExecution para nunca ser confundido com um classificador real de IA.
 * Regra de segurança: na dúvida, escala (nunca resolve "para ser útil").
 */
export const stagingIntentClassifier: IntentClassifierPort = {
  async classify({ text }) {
    const t = text.toLowerCase();
    const clinicalKeywords = ["dose", "medicamento", "remédio", "aumentar", "parar de tomar", "sintoma", "dor", "efeito"];
    const urgencyKeywords = ["urgente", "socorro", "mal estar", "desmaiei", "muito mal", "não consigo respirar"];
    const adminKeywords = ["pagamento", "cartão", "assinatura", "cancelar", "boleto", "fatura", "senha", "cadastro"];
    const supportKeywords = ["falar com humano", "atendente", "reclamação", "reclamar"];

    if (urgencyKeywords.some((k) => t.includes(k))) return { intent: "POTENTIAL_URGENCY", confidence: 0.6 };
    if (supportKeywords.some((k) => t.includes(k))) return { intent: "HUMAN_SUPPORT_REQUIRED", confidence: 0.6 };
    if (clinicalKeywords.some((k) => t.includes(k))) return { intent: "CLINICAL_QUESTION", confidence: 0.6 };
    if (adminKeywords.some((k) => t.includes(k))) return { intent: "ADMINISTRATIVE", confidence: 0.6 };

    // um número simples ou par de números é tratado como STRUCTURED_FOLLOWUP
    // (resposta de check-in); qualquer coisa não reconhecida, por segurança,
    // é tratada como intenção que exige suporte humano — nunca "clinical" por
    // omissão, mas também nunca assumida como trivial.
    if (/^\s*\d{1,3}(\s*(por|\/)\s*\d{1,3})?\s*$/.test(t)) return { intent: "STRUCTURED_FOLLOWUP", confidence: 0.8 };
    return { intent: "HUMAN_SUPPORT_REQUIRED", confidence: 0.3 };
  },
};

export const stagingAnswerStructurer: AnswerStructurerPort = {
  async structure({ text }) {
    const pairMatch = text.match(/(\d{1,3})\s*(?:por|\/)\s*(\d{1,3})/i);
    if (pairMatch) {
      const structured: Record<string, number> = { systolic: Number(pairMatch[1]), diastolic: Number(pairMatch[2]) };
      return { structured };
    }
    const singleMatch = text.match(/-?\d+(\.\d+)?/);
    if (singleMatch) {
      const structured: Record<string, number> = { value: Number(singleMatch[0]) };
      return { structured };
    }
    return { structured: null };
  },
};

export const fakeScheduler: SchedulerPort = {
  async scheduleJob() {
    /* no-op nesta fatia */
  },
};

export const fakeStorage: StoragePort = {
  async upload({ key }) {
    return { url: `fake://storage/${key}` };
  },
};
