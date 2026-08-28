import type { PoolClient } from "pg";

export type EligibilityOutcome = "APPROVED" | "NEEDS_MORE_INFO" | "NOT_ELIGIBLE";

export interface EligibilityDecisionRow {
  id: string;
  patient_id: string;
  treatment_id: string;
  doctor_id: string;
  outcome: EligibilityOutcome;
  clinical_note: string | null;
  decided_at: string;
}

export class InvalidEligibilityDecisionError extends Error {}

/**
 * Histórico clínico — cada avaliação gera uma NOVA linha. Este serviço
 * deliberadamente não expõe nenhum método de update/delete.
 */
export class EligibilityService {
  async recordDecision(
    client: PoolClient,
    input: {
      patientId: string;
      treatmentId: string;
      doctorId: string;
      outcome: EligibilityOutcome;
      clinicalNote?: string;
    }
  ): Promise<EligibilityDecisionRow> {
    if (input.outcome === "NOT_ELIGIBLE" && !input.clinicalNote) {
      throw new InvalidEligibilityDecisionError("clinicalNote é obrigatório quando outcome = NOT_ELIGIBLE");
    }
    const { rows } = await client.query<EligibilityDecisionRow>(
      `INSERT INTO eligibility_decisions (patient_id, treatment_id, doctor_id, outcome, clinical_note)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [input.patientId, input.treatmentId, input.doctorId, input.outcome, input.clinicalNote ?? null]
    );
    return rows[0];
  }

  async latestForTreatment(client: PoolClient, treatmentId: string): Promise<EligibilityDecisionRow | null> {
    const { rows } = await client.query<EligibilityDecisionRow>(
      `SELECT * FROM eligibility_decisions WHERE treatment_id = $1 ORDER BY decided_at DESC LIMIT 1`,
      [treatmentId]
    );
    return rows[0] ?? null;
  }

  async historyForTreatment(client: PoolClient, treatmentId: string): Promise<EligibilityDecisionRow[]> {
    const { rows } = await client.query<EligibilityDecisionRow>(
      `SELECT * FROM eligibility_decisions WHERE treatment_id = $1 ORDER BY decided_at ASC`,
      [treatmentId]
    );
    return rows;
  }
}

export const eligibilityService = new EligibilityService();
