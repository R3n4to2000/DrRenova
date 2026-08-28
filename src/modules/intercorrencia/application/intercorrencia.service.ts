import type { PoolClient } from "pg";

export type IntercorrenciaStatus = "OPEN" | "IN_REVIEW" | "RESOLVED";

export interface IntercorrenciaRow {
  id: string;
  treatment_id: string;
  origin: string;
  description: string;
  priority: string;
  status: IntercorrenciaStatus;
  assumed_by_doctor_id: string | null;
  resolved_by_decision_id: string | null;
  opened_at: string;
  resolved_at: string | null;
}

export class InvalidIntercorrenciaTransitionError extends Error {
  constructor(from: IntercorrenciaStatus, to: IntercorrenciaStatus) {
    super(`Transição de intercorrência inválida: ${from} -> ${to}`);
    this.name = "InvalidIntercorrenciaTransitionError";
  }
}

const ALLOWED_TRANSITIONS: Record<IntercorrenciaStatus, IntercorrenciaStatus[]> = {
  OPEN: ["IN_REVIEW", "RESOLVED"],
  IN_REVIEW: ["RESOLVED"],
  RESOLVED: [],
};

/**
 * Intercorrência é um marcador OPERACIONAL de que algo precisa de atenção
 * — nunca um diagnóstico. `priority` é um texto administrativo/operacional
 * (ex.: "ALTA"/"ROTINA"), nunca derivado de um limiar clínico inventado
 * pelo Engine. Resolução SEMPRE exige uma DoctorDecision de origem —
 * nunca é resolvida automaticamente.
 */
export class IntercorrenciaService {
  async open(
    client: PoolClient,
    input: { treatmentId: string; origin: string; description: string; priority?: string }
  ): Promise<IntercorrenciaRow> {
    const { rows } = await client.query<IntercorrenciaRow>(
      `INSERT INTO intercorrencias (treatment_id, origin, description, priority)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [input.treatmentId, input.origin, input.description, input.priority ?? "ROTINA"]
    );
    return rows[0];
  }

  private assertTransitionAllowed(from: IntercorrenciaStatus, to: IntercorrenciaStatus): void {
    if (!ALLOWED_TRANSITIONS[from].includes(to)) {
      throw new InvalidIntercorrenciaTransitionError(from, to);
    }
  }

  async assume(client: PoolClient, id: string, doctorId: string): Promise<IntercorrenciaRow> {
    const current = await this.findById(client, id);
    if (!current) throw new Error("Intercorrência não encontrada");
    this.assertTransitionAllowed(current.status, "IN_REVIEW");
    const { rows } = await client.query<IntercorrenciaRow>(
      `UPDATE intercorrencias SET status = 'IN_REVIEW', assumed_by_doctor_id = $2 WHERE id = $1 RETURNING *`,
      [id, doctorId]
    );
    return rows[0];
  }

  /** Resolução SEMPRE referencia a DoctorDecision que a originou — nunca automática. */
  async resolve(client: PoolClient, id: string, decisionId: string): Promise<IntercorrenciaRow> {
    const current = await this.findById(client, id);
    if (!current) throw new Error("Intercorrência não encontrada");
    this.assertTransitionAllowed(current.status, "RESOLVED");
    const { rows } = await client.query<IntercorrenciaRow>(
      `UPDATE intercorrencias SET status = 'RESOLVED', resolved_at = now(), resolved_by_decision_id = $2
       WHERE id = $1 RETURNING *`,
      [id, decisionId]
    );
    return rows[0];
  }

  async findById(client: PoolClient, id: string): Promise<IntercorrenciaRow | null> {
    const { rows } = await client.query<IntercorrenciaRow>(`SELECT * FROM intercorrencias WHERE id = $1`, [id]);
    return rows[0] ?? null;
  }

  async openForTreatment(client: PoolClient, treatmentId: string): Promise<IntercorrenciaRow[]> {
    const { rows } = await client.query<IntercorrenciaRow>(
      `SELECT * FROM intercorrencias WHERE treatment_id = $1 AND status != 'RESOLVED' ORDER BY opened_at ASC`,
      [treatmentId]
    );
    return rows;
  }
}

export const intercorrenciaService = new IntercorrenciaService();
