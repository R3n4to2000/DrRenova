import type { PoolClient } from "pg";
import { configService } from "@/modules/config/application/config.service";

export interface TreatmentRow {
  id: string;
  patient_id: string;
  category_config_id: string;
  status: "ONBOARDING" | "ACTIVE" | "PAUSED" | "ENDED";
  review_period_days_override: number | null;
  last_in_person_contact_at: string | null;
}

export class TreatmentService {
  async createTreatment(
    client: PoolClient,
    input: { patientId: string; categoryKey: string }
  ): Promise<TreatmentRow> {
    const category = await configService.getCurrentCategoryVersion(client, input.categoryKey);
    const { rows } = await client.query<TreatmentRow>(
      `INSERT INTO treatments (patient_id, category_config_id) VALUES ($1,$2) RETURNING *`,
      [input.patientId, category.id]
    );
    return rows[0];
  }

  /** Periodicidade efetiva: individualização do médico prevalece sobre o padrão da categoria. */
  async effectiveReviewPeriodDays(client: PoolClient, treatmentId: string): Promise<number> {
    const { rows } = await client.query<{ override: number | null; default_days: number }>(
      `SELECT t.review_period_days_override AS override, cc.default_review_period_days AS default_days
       FROM treatments t JOIN category_configs cc ON cc.id = t.category_config_id
       WHERE t.id = $1`,
      [treatmentId]
    );
    if (rows.length === 0) throw new Error("Treatment não encontrado");
    return rows[0].override ?? rows[0].default_days;
  }

  async findById(client: PoolClient, id: string): Promise<TreatmentRow | null> {
    const { rows } = await client.query<TreatmentRow>(`SELECT * FROM treatments WHERE id = $1`, [id]);
    return rows[0] ?? null;
  }
}

export const treatmentService = new TreatmentService();
