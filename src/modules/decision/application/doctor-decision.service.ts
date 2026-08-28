import type { PoolClient } from "pg";

export type DoctorDecisionAction =
  | "MAINTAIN"
  | "REQUEST_INFORMATION"
  | "REQUEST_EXAM"
  | "REQUEST_TELECONSULTATION"
  | "REQUEST_IN_PERSON_EVALUATION"
  | "ISSUE_PRESCRIPTION"
  | "CHANGE_REVIEW_PERIOD"
  | "REGISTER_CONDUCT"
  | "REFER"
  | "END_TREATMENT";

export interface DoctorDecisionRow {
  id: string;
  treatment_id: string;
  doctor_id: string;
  action: DoctorDecisionAction;
  note: string | null;
  review_period_days_new: number | null;
  origin_check_in_id: string | null;
  decided_at: string;
}

/**
 * Histórico clínico — cada decisão é uma NOVA linha. Nenhum método de
 * update/delete é exposto (reforçado também por GRANT de banco, ver
 * migration 0009). A única autoridade para decidir clinicamente é o
 * médico responsável pela carteira daquele tratamento (garantido por RLS,
 * não por este serviço).
 */
export class DoctorDecisionService {
  async record(
    client: PoolClient,
    input: {
      treatmentId: string;
      doctorId: string;
      action: DoctorDecisionAction;
      note?: string;
      reviewPeriodDaysNew?: number;
      originCheckInId?: string;
    }
  ): Promise<DoctorDecisionRow> {
    if (input.action === "CHANGE_REVIEW_PERIOD" && !input.reviewPeriodDaysNew) {
      throw new Error("reviewPeriodDaysNew é obrigatório quando action = CHANGE_REVIEW_PERIOD");
    }
    const { rows } = await client.query<DoctorDecisionRow>(
      `INSERT INTO doctor_decisions (treatment_id, doctor_id, action, note, review_period_days_new, origin_check_in_id)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [
        input.treatmentId,
        input.doctorId,
        input.action,
        input.note ?? null,
        input.reviewPeriodDaysNew ?? null,
        input.originCheckInId ?? null,
      ]
    );
    return rows[0];
  }

  async historyForTreatment(client: PoolClient, treatmentId: string): Promise<DoctorDecisionRow[]> {
    const { rows } = await client.query<DoctorDecisionRow>(
      `SELECT * FROM doctor_decisions WHERE treatment_id = $1 ORDER BY decided_at ASC`,
      [treatmentId]
    );
    return rows;
  }
}

export const doctorDecisionService = new DoctorDecisionService();
