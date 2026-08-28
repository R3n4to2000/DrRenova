import type { PoolClient } from "pg";

/**
 * Fundação de dados para a Camilla (Fatia 3). Nesta fatia, nenhum fluxo
 * automático popula estas tabelas — apenas confirmamos que a estrutura
 * suporta criação manual sem exigir migração estrutural depois.
 */
export interface ConversationRow {
  id: string;
  patient_id: string;
}

export interface ConversationMessageRow {
  id: string;
  conversation_id: string;
  sender: "PATIENT" | "CAMILLA" | "DOCTOR" | "SYSTEM";
  channel: "WHATSAPP" | "WEB" | "SYSTEM";
  content: string;
}

export type ConversationMessageType = "TEXT" | "STRUCTURED_DATA" | "SYSTEM_NOTICE";

export class ConversationService {
  async createConversation(client: PoolClient, patientId: string): Promise<ConversationRow> {
    const { rows } = await client.query<ConversationRow>(
      `INSERT INTO conversations (patient_id) VALUES ($1) RETURNING id, patient_id`,
      [patientId]
    );
    return rows[0];
  }

  async addMessage(
    client: PoolClient,
    input: {
      conversationId: string;
      sender: ConversationMessageRow["sender"];
      channel: ConversationMessageRow["channel"];
      content: string;
      messageType?: ConversationMessageType;
    }
  ): Promise<ConversationMessageRow> {
    const { rows } = await client.query<ConversationMessageRow>(
      `INSERT INTO conversation_messages (conversation_id, sender, channel, content, message_type)
       VALUES ($1,$2,$3,$4,$5) RETURNING id, conversation_id, sender, channel, content`,
      [input.conversationId, input.sender, input.channel, input.content, input.messageType ?? "TEXT"]
    );
    return rows[0];
  }
}

export const conversationService = new ConversationService();
