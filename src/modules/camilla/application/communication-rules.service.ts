import type { PoolClient } from "pg";

/**
 * Reaproveita PatientCommunicationPreference (Fatia 1) — nenhuma tabela
 * nova. Régua operacional simples para o MVP: respeita opt-out sempre;
 * limita mensagens PROATIVAS (não-resposta) a 1 por tratamento a cada
 * `minHoursBetweenProactive` horas (configurável pelo chamador, nunca uma
 * régua clínica). Mensagens em RESPOSTA direta ao paciente nunca são
 * bloqueadas por frequency cap — só o outbound proativo.
 */
export class CommunicationRulesEngine {
  async isOptedOut(client: PoolClient, patientId: string): Promise<boolean> {
    const { rows } = await client.query<{ opted_out: boolean }>(
      `SELECT opted_out FROM patient_communication_preferences WHERE patient_id = $1`,
      [patientId]
    );
    return rows[0]?.opted_out ?? false;
  }

  async canSendProactiveMessage(
    client: PoolClient,
    input: { treatmentId: string; patientId: string; minHoursBetweenProactive?: number }
  ): Promise<boolean> {
    if (await this.isOptedOut(client, input.patientId)) return false;

    const minHours = input.minHoursBetweenProactive ?? 12;
    const { rows } = await client.query<{ occurred_at: string }>(
      `SELECT cm.occurred_at FROM conversation_messages cm
       JOIN conversations c ON c.id = cm.conversation_id
       WHERE c.patient_id = $1 AND cm.sender = 'CAMILLA' AND cm.message_type = 'SYSTEM_NOTICE'
       ORDER BY cm.occurred_at DESC LIMIT 1`,
      [input.patientId]
    );
    if (rows.length === 0) return true;
    const hoursSinceLast = (Date.now() - new Date(rows[0].occurred_at).getTime()) / (1000 * 60 * 60);
    return hoursSinceLast >= minHours;
  }
}

export const communicationRulesEngine = new CommunicationRulesEngine();
