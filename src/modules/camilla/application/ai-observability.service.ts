import type { PoolClient } from "pg";
import type { CamillaIntent } from "@/ports/index";

export interface PromptVersionRow {
  id: string;
  name: string;
  version: number;
  status: "DRAFT" | "ACTIVE" | "RETIRED";
}

/**
 * Observabilidade obrigatória de IA — nunca grava segredo, nunca duplica
 * conteúdo de prontuário (só uma referência de "purpose"/"model"/métricas).
 */
export class AiObservabilityService {
  async getOrCreatePromptVersion(client: PoolClient, name: string): Promise<PromptVersionRow> {
    const { rows: existing } = await client.query<PromptVersionRow>(
      `SELECT * FROM prompt_versions WHERE name = $1 AND status = 'ACTIVE' ORDER BY version DESC LIMIT 1`,
      [name]
    );
    if (existing[0]) return existing[0];

    const { rows } = await client.query<PromptVersionRow>(
      `INSERT INTO prompt_versions (name, version, status) VALUES ($1, 1, 'ACTIVE') RETURNING *`,
      [name]
    );
    return rows[0];
  }

  async recordExecution(
    client: PoolClient,
    input: {
      conversationMessageId?: string;
      promptVersionId: string;
      model: string;
      purpose: string;
      intentClassified?: CamillaIntent;
      toolsUsed?: string[];
      latencyMs?: number;
      estimatedCostCents?: number;
      escalated?: boolean;
    }
  ): Promise<void> {
    await client.query(
      `INSERT INTO ai_executions
       (conversation_message_id, prompt_version_id, model, purpose, intent_classified, tools_used, latency_ms, estimated_cost_cents, escalated)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        input.conversationMessageId ?? null,
        input.promptVersionId,
        input.model,
        input.purpose,
        input.intentClassified ?? null,
        input.toolsUsed ? JSON.stringify(input.toolsUsed) : null,
        input.latencyMs ?? null,
        input.estimatedCostCents ?? 0,
        input.escalated ?? false,
      ]
    );
  }
}

export const aiObservabilityService = new AiObservabilityService();
