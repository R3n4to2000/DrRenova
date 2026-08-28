import type { PoolClient } from "pg";
import { conversationService } from "@/modules/conversation/application/conversation.service";
import { patientContextService } from "./patient-context.service";
import { deterministicSafetyRulesEngine } from "./safety-rules.service";
import { aiObservabilityService } from "./ai-observability.service";
import { communicationRulesEngine } from "./communication-rules.service";
import { intercorrenciaService } from "@/modules/intercorrencia/application/intercorrencia.service";
import { submitCheckInAnswersCommand } from "@/modules/checkin/application/checkin.commands";
import { stagingIntentClassifier, stagingAnswerStructurer } from "@/ports/fakes";
import { outboxService } from "./outbox.service";
import type { AppContext } from "@/lib/db";
import type { CamillaIntent } from "@/ports/index";

const MODEL_LABEL = "staging-keyword-classifier-v1";

export class CamillaOrchestrator {
  private async getOrCreateConversation(client: PoolClient, patientId: string): Promise<string> {
    const { rows } = await client.query<{ id: string }>(`SELECT id FROM conversations WHERE patient_id = $1 LIMIT 1`, [
      patientId,
    ]);
    if (rows[0]) return rows[0].id;
    const conversation = await conversationService.createConversation(client, patientId);
    return conversation.id;
  }

  async presentIntroduction(client: PoolClient, input: { patientId: string; treatmentId: string }): Promise<string | null> {
    const conversationId = await this.getOrCreateConversation(client, input.patientId);
    const { rows: already } = await client.query(
      `SELECT 1 FROM conversation_messages WHERE conversation_id = $1 AND content LIKE 'INTRO:%'`,
      [conversationId]
    );
    if (already.length > 0) return null;

    const ctx = await patientContextService.getMinimalContextForTreatment(client, input.treatmentId);
    const text = `Oi, ${ctx.patientFirstName}. Eu sou a Camilla, assistente virtual de cuidado do Renovamed. Vou estar por aqui para ajudar você a acompanhar seu tratamento, lembrar das próximas etapas e facilitar sua comunicação com a nossa equipe.`;

    const message = await conversationService.addMessage(client, {
      conversationId,
      sender: "CAMILLA",
      channel: "WHATSAPP",
      content: `INTRO:${text}`,
      messageType: "SYSTEM_NOTICE",
    });
    await outboxService.enqueue(client, { eventType: "whatsapp.send", payload: { to: input.patientId, body: text } });
    return message.id;
  }

  async notifyCheckInAvailable(client: PoolClient, input: { patientId: string; treatmentId: string }): Promise<string | null> {
    const canSend = await communicationRulesEngine.canSendProactiveMessage(client, {
      treatmentId: input.treatmentId,
      patientId: input.patientId,
    });
    if (!canSend) return null;

    const conversationId = await this.getOrCreateConversation(client, input.patientId);
    const ctx = await patientContextService.getMinimalContextForTreatment(client, input.treatmentId);
    const text = `${ctx.patientFirstName}, está na hora do seu acompanhamento de ${ctx.treatmentCategoryName}. Pode me contar como você está?`;

    const message = await conversationService.addMessage(client, {
      conversationId,
      sender: "CAMILLA",
      channel: "WHATSAPP",
      content: text,
      messageType: "SYSTEM_NOTICE",
    });
    await outboxService.enqueue(client, { eventType: "whatsapp.send", payload: { to: input.patientId, body: text } });
    return message.id;
  }

  async handleInboundMessage(
    client: PoolClient,
    input: { patientId: string; treatmentId: string; rawText: string; pendingFieldKey?: string; pendingCheckInId?: string }
  ): Promise<{ replyText: string; escalated: boolean; intent: CamillaIntent }> {
    const conversationId = await this.getOrCreateConversation(client, input.patientId);
    const inboundMessage = await conversationService.addMessage(client, {
      conversationId,
      sender: "PATIENT",
      channel: "WHATSAPP",
      content: input.rawText,
    });

    const promptVersion = await aiObservabilityService.getOrCreatePromptVersion(client, "camilla_inbound_handler");
    const startedAt = Date.now();

    const { structured } = await stagingAnswerStructurer.structure({ text: input.rawText });

    let triggeredRule = null;
    if (structured && input.pendingFieldKey) {
      const numericValue = structured.systolic ?? structured.value;
      if (typeof numericValue === "number") {
        triggeredRule = await deterministicSafetyRulesEngine.checkStructuredValue(client, input.pendingFieldKey, numericValue);
      }
    }

    const { intent } = await stagingIntentClassifier.classify({ text: input.rawText });

    const mustEscalate = Boolean(triggeredRule) || ["CLINICAL_QUESTION", "POSSIBLE_INTERCURRENCE", "POTENTIAL_URGENCY"].includes(intent);

    let replyText: string;
    if (mustEscalate) {
      const reason = triggeredRule
        ? `Sinal determinístico disparado (regra ${triggeredRule.rule_key})`
        : `Intenção classificada como ${intent}`;
      await intercorrenciaService.open(client, {
        treatmentId: input.treatmentId,
        origin: "CAMILLA",
        description: `Encaminhamento da Camilla: ${reason}. Mensagem do paciente: "${input.rawText.slice(0, 200)}"`,
        priority: triggeredRule || intent === "POTENTIAL_URGENCY" ? "ALTA" : "ROTINA",
      });
      replyText =
        intent === "CLINICAL_QUESTION"
          ? "Entendi. Isso precisa ser avaliado pelo seu médico — vou encaminhar agora."
          : "Identifiquei uma informação relevante no seu relato. Vou encaminhar para sua equipe médica agora.";
    } else if (intent === "STRUCTURED_FOLLOWUP" && structured) {
      const value = structured.systolic ? `${structured.systolic}/${structured.diastolic}` : String(structured.value);
      replyText = `Registrei ${value}. Está correto? Responda SIM para confirmar.`;
    } else if (intent === "ADMINISTRATIVE") {
      replyText = "Posso te ajudar com isso agora. Um momento.";
    } else {
      replyText = "Entendi. Vou encaminhar sua mensagem para nossa equipe de suporte.";
    }

    await conversationService.addMessage(client, {
      conversationId,
      sender: "CAMILLA",
      channel: "WHATSAPP",
      content: replyText,
    });

    await client.query(
      `INSERT INTO intent_classifications (conversation_message_id, intent, triggered_safety_rule_id) VALUES ($1,$2,$3)`,
      [inboundMessage.id, intent, triggeredRule?.id ?? null]
    );

    await aiObservabilityService.recordExecution(client, {
      conversationMessageId: inboundMessage.id,
      promptVersionId: promptVersion.id,
      model: MODEL_LABEL,
      purpose: "inbound_message_handling",
      intentClassified: intent,
      toolsUsed: ["DeterministicSafetyRulesEngine", "IntentClassifierPort", "AnswerStructurerPort"],
      latencyMs: Date.now() - startedAt,
      escalated: mustEscalate,
    });

    await outboxService.enqueue(client, { eventType: "whatsapp.send", payload: { to: input.patientId, body: replyText } });

    return { replyText, escalated: mustEscalate, intent };
  }

  async confirmStructuredAnswer(
    ctx: AppContext,
    client: PoolClient,
    input: { checkInId: string; fieldKey: string; valueType: "NUMBER"; value: number; rawInput: string }
  ): Promise<void> {
    await submitCheckInAnswersCommand(ctx, input.checkInId, [
      { fieldKey: input.fieldKey, valueType: input.valueType, value: input.value, rawInput: input.rawInput },
    ]);

    const { rows } = await client.query<{ treatment_id: string }>(`SELECT treatment_id FROM check_ins WHERE id = $1`, [
      input.checkInId,
    ]);
    const treatmentId = rows[0]?.treatment_id;
    const { rows: patientRows } = await client.query<{ patient_id: string }>(
      `SELECT patient_id FROM treatments WHERE id = $1`,
      [treatmentId]
    );
    const conversationId = await this.getOrCreateConversation(client, patientRows[0].patient_id);
    const text = "Confirmado — já está no seu acompanhamento. Obrigada!";
    await conversationService.addMessage(client, { conversationId, sender: "CAMILLA", channel: "WHATSAPP", content: text });
    await outboxService.enqueue(client, { eventType: "whatsapp.send", payload: { to: patientRows[0].patient_id, body: text } });
  }

  async notifyReviewCompleted(client: PoolClient, input: { patientId: string; treatmentId: string }): Promise<void> {
    const conversationId = await this.getOrCreateConversation(client, input.patientId);
    const ctx = await patientContextService.getMinimalContextForTreatment(client, input.treatmentId);
    const text = ctx.doctorFullName
      ? `${ctx.doctorFullName} já concluiu sua revisão. Se houver alguma orientação ou documento novo, você verá por aqui.`
      : "Sua revisão já foi concluída pela equipe médica.";
    await conversationService.addMessage(client, {
      conversationId,
      sender: "CAMILLA",
      channel: "WHATSAPP",
      content: text,
      messageType: "SYSTEM_NOTICE",
    });
    await outboxService.enqueue(client, { eventType: "whatsapp.send", payload: { to: input.patientId, body: text } });
  }

  async notifyPrescriptionAvailable(client: PoolClient, input: { patientId: string }): Promise<void> {
    const conversationId = await this.getOrCreateConversation(client, input.patientId);
    const text = "Sua prescrição já está disponível no seu painel do Renovamed e aqui no WhatsApp.";
    await conversationService.addMessage(client, {
      conversationId,
      sender: "CAMILLA",
      channel: "WHATSAPP",
      content: text,
      messageType: "SYSTEM_NOTICE",
    });
    await outboxService.enqueue(client, { eventType: "whatsapp.send", payload: { to: input.patientId, body: text } });
  }
}

export const camillaOrchestrator = new CamillaOrchestrator();
