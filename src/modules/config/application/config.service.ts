import type { PoolClient } from "pg";

export interface PlanConfigRow {
  id: string;
  plan_key: string;
  version: number;
  name: string;
  adesao_amount: string;
  monthly_amount: string;
  annual_amount: string;
  max_treatments: number;
  status: "DRAFT" | "ACTIVE" | "RETIRED";
}

export interface CategoryConfigRow {
  id: string;
  category_key: string;
  version: number;
  name: string;
  default_review_period_days: number;
  status: "DRAFT" | "ACTIVE" | "RETIRED";
}

/**
 * Nada de preço/periodicidade fica hardcoded no código de aplicação — tudo
 * vem destas tabelas versionadas. "Vigente" = status ACTIVE mais recente
 * por planKey/categoryKey.
 */
export class ConfigService {
  async getCurrentPlanVersion(client: PoolClient, planKey: string): Promise<PlanConfigRow> {
    const { rows } = await client.query<PlanConfigRow>(
      `SELECT * FROM plan_configs
       WHERE plan_key = $1 AND status = 'ACTIVE'
         AND (effective_until IS NULL OR effective_until > now())
       ORDER BY version DESC LIMIT 1`,
      [planKey]
    );
    if (rows.length === 0) throw new Error(`Nenhuma versão ativa de PlanConfig para ${planKey}`);
    return rows[0];
  }

  async getCurrentCategoryVersion(client: PoolClient, categoryKey: string): Promise<CategoryConfigRow> {
    const { rows } = await client.query<CategoryConfigRow>(
      `SELECT * FROM category_configs
       WHERE category_key = $1 AND status = 'ACTIVE'
         AND (effective_until IS NULL OR effective_until > now())
       ORDER BY version DESC LIMIT 1`,
      [categoryKey]
    );
    if (rows.length === 0) throw new Error(`Nenhuma versão ativa de CategoryConfig para ${categoryKey}`);
    return rows[0];
  }

  /** Cria uma NOVA versão (nunca sobrescreve a anterior) e a ativa, aposentando a antiga. */
  async publishNewPlanVersion(
    client: PoolClient,
    planKey: string,
    data: { name: string; adesaoAmount: string; monthlyAmount: string; annualAmount: string; maxTreatments?: number }
  ): Promise<PlanConfigRow> {
    const { rows: existing } = await client.query<{ version: number }>(
      `SELECT COALESCE(MAX(version), 0) AS version FROM plan_configs WHERE plan_key = $1`,
      [planKey]
    );
    const nextVersion = (existing[0]?.version ?? 0) + 1;

    await client.query(
      `UPDATE plan_configs SET status = 'RETIRED', effective_until = now()
       WHERE plan_key = $1 AND status = 'ACTIVE'`,
      [planKey]
    );

    const { rows } = await client.query<PlanConfigRow>(
      `INSERT INTO plan_configs (plan_key, version, name, adesao_amount, monthly_amount, annual_amount, max_treatments, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'ACTIVE') RETURNING *`,
      [planKey, nextVersion, data.name, data.adesaoAmount, data.monthlyAmount, data.annualAmount, data.maxTreatments ?? 1]
    );
    return rows[0];
  }

  async publishNewCategoryVersion(
    client: PoolClient,
    categoryKey: string,
    data: { name: string; defaultReviewPeriodDays: number; icon?: string }
  ): Promise<CategoryConfigRow> {
    const { rows: existing } = await client.query<{ version: number }>(
      `SELECT COALESCE(MAX(version), 0) AS version FROM category_configs WHERE category_key = $1`,
      [categoryKey]
    );
    const nextVersion = (existing[0]?.version ?? 0) + 1;

    await client.query(
      `UPDATE category_configs SET status = 'RETIRED', effective_until = now()
       WHERE category_key = $1 AND status = 'ACTIVE'`,
      [categoryKey]
    );

    const { rows } = await client.query<CategoryConfigRow>(
      `INSERT INTO category_configs (category_key, version, name, icon, default_review_period_days, status)
       VALUES ($1,$2,$3,$4,$5,'ACTIVE') RETURNING *`,
      [categoryKey, nextVersion, data.name, data.icon ?? null, data.defaultReviewPeriodDays]
    );
    return rows[0];
  }
}

export const configService = new ConfigService();
