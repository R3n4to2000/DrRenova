import type { PoolClient } from "pg";

export type SafetyRuleOperator = "GT" | "GTE" | "LT" | "LTE" | "EQ";

export interface SafetyRuleRow {
  id: string;
  rule_key: string;
  version: number;
  field_key: string;
  operator: SafetyRuleOperator;
  threshold: string; // numeric vem como string do pg
  action: string;
  status: "DRAFT" | "ACTIVE" | "RETIRED";
}

/**
 * Regras determinísticas — SEMPRE avaliadas ANTES do Intent Classifier
 * (staging/IA). Nascem vazias: nenhum limiar clínico é inventado pelo
 * desenvolvedor. Só a Direção Médica publica regras ACTIVE. Quando uma
 * regra dispara, a Escalation é criada INDEPENDENTEMENTE da opinião do
 * classificador de intenção — a checagem aqui é puramente aritmética
 * (comparação de valor estruturado x limiar configurado).
 */
export class DeterministicSafetyRulesEngine {
  async getActiveRulesForField(client: PoolClient, fieldKey: string): Promise<SafetyRuleRow[]> {
    const { rows } = await client.query<SafetyRuleRow>(
      `SELECT * FROM deterministic_safety_rules
       WHERE field_key = $1 AND status = 'ACTIVE'
         AND (effective_until IS NULL OR effective_until > now())`,
      [fieldKey]
    );
    return rows;
  }

  private evaluate(operator: SafetyRuleOperator, value: number, threshold: number): boolean {
    switch (operator) {
      case "GT":
        return value > threshold;
      case "GTE":
        return value >= threshold;
      case "LT":
        return value < threshold;
      case "LTE":
        return value <= threshold;
      case "EQ":
        return value === threshold;
    }
  }

  /**
   * Avalia um valor estruturado contra as regras ativas para aquele campo.
   * Retorna a PRIMEIRA regra que disparar (se houver) — suficiente para
   * decidir escalonamento; não interpreta clinicamente o resultado.
   */
  async checkStructuredValue(client: PoolClient, fieldKey: string, value: number): Promise<SafetyRuleRow | null> {
    const rules = await this.getActiveRulesForField(client, fieldKey);
    for (const rule of rules) {
      if (this.evaluate(rule.operator, value, Number(rule.threshold))) {
        return rule;
      }
    }
    return null;
  }

  /** Publica uma nova versão de regra — nunca sobrescreve, sempre nova linha; requer aprovação explícita para ativar. */
  async publishRule(
    client: PoolClient,
    input: { ruleKey: string; fieldKey: string; operator: SafetyRuleOperator; threshold: number; approvedBy: string }
  ): Promise<SafetyRuleRow> {
    const { rows: existing } = await client.query<{ version: number }>(
      `SELECT COALESCE(MAX(version), 0) AS version FROM deterministic_safety_rules WHERE rule_key = $1`,
      [input.ruleKey]
    );
    const nextVersion = (existing[0]?.version ?? 0) + 1;

    await client.query(
      `UPDATE deterministic_safety_rules SET status = 'RETIRED', effective_until = now()
       WHERE rule_key = $1 AND status = 'ACTIVE'`,
      [input.ruleKey]
    );

    const { rows } = await client.query<SafetyRuleRow>(
      `INSERT INTO deterministic_safety_rules (rule_key, version, field_key, operator, threshold, status, approved_by)
       VALUES ($1,$2,$3,$4,$5,'ACTIVE',$6) RETURNING *`,
      [input.ruleKey, nextVersion, input.fieldKey, input.operator, input.threshold, input.approvedBy]
    );
    return rows[0];
  }
}

export const deterministicSafetyRulesEngine = new DeterministicSafetyRulesEngine();
