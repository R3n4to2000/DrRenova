import type { PoolClient } from "pg";

export interface MinimalCamillaContext {
  patientFirstName: string;
  doctorFullName: string | null;
  treatmentCategoryName: string;
  nextReviewDueAt: string | null;
}

/**
 * Monta apenas o contexto necessário para uma interação específica da
 * Camilla — nunca o prontuário inteiro por padrão. Cada chamada busca só
 * os campos que a finalidade exige (aqui: nome, médico, categoria, próxima
 * revisão — suficiente para lembretes/follow-up conversacional).
 */
export class PatientContextService {
  async getMinimalContextForTreatment(client: PoolClient, treatmentId: string): Promise<MinimalCamillaContext> {
    const { rows } = await client.query(
      `
      SELECT
        p.full_name AS patient_full_name,
        cc.name AS category_name,
        t.next_review_due_at,
        d.full_name AS doctor_full_name
      FROM treatments t
      JOIN patients p ON p.id = t.patient_id
      JOIN category_configs cc ON cc.id = t.category_config_id
      LEFT JOIN LATERAL (
        SELECT dpa.doctor_id FROM doctor_patient_assignments dpa
        WHERE dpa.treatment_id = t.id AND dpa.is_current = true LIMIT 1
      ) current_dpa ON true
      LEFT JOIN doctors d ON d.id = current_dpa.doctor_id
      WHERE t.id = $1
      `,
      [treatmentId]
    );
    if (rows.length === 0) throw new Error("Treatment não encontrado");
    const row = rows[0];
    return {
      patientFirstName: String(row.patient_full_name).split(" ")[0],
      doctorFullName: row.doctor_full_name,
      treatmentCategoryName: row.category_name,
      nextReviewDueAt: row.next_review_due_at,
    };
  }
}

export const patientContextService = new PatientContextService();
