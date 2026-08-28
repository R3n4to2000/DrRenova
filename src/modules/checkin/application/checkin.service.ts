import type { PoolClient } from "pg";
import type { AnswerValueType } from "@/modules/questionnaire/application/questionnaire.service";

export type CheckInStatus = "SCHEDULED" | "OPEN" | "ANSWERED" | "EXPIRED" | "CANCELLED";

export interface CheckInRow {
  id: string;
  treatment_id: string;
  questionnaire_version_id: string;
  status: CheckInStatus;
  scheduled_for: string;
  opened_at: string | null;
  answered_at: string | null;
  expires_at: string | null;
}

export interface CheckInAnswerInput {
  fieldKey: string;
  valueType: AnswerValueType;
  value: unknown; // serializado como jsonb — genérico, sem lógica clínica específica
  rawInput?: string;
}

export class InvalidCheckInTransitionError extends Error {
  constructor(from: CheckInStatus, to: CheckInStatus) {
    super(`Transição de check-in inválida: ${from} -> ${to}`);
    this.name = "InvalidCheckInTransitionError";
  }
}

const ALLOWED_TRANSITIONS: Record<CheckInStatus, CheckInStatus[]> = {
  SCHEDULED: ["OPEN", "CANCELLED"],
  OPEN: ["ANSWERED", "EXPIRED", "CANCELLED"],
  ANSWERED: [],
  EXPIRED: [],
  CANCELLED: [],
};

/**
 * O Engine cria/abre/expira check-ins. Ele NUNCA interpreta clinicamente a
 * resposta — apenas registra o dado estruturado que o paciente enviou.
 * Expirar um check-in (ausência de resposta) é puramente um estado
 * operacional: não cancela assinatura, não altera tratamento, não presume
 * abandono (ver ContinuityEngineService.expireOverdueCheckIns).
 */
export class CheckInService {
  async schedule(
    client: PoolClient,
    input: { treatmentId: string; questionnaireVersionId: string; scheduledFor: Date }
  ): Promise<CheckInRow> {
    const { rows } = await client.query<CheckInRow>(
      `INSERT INTO check_ins (treatment_id, questionnaire_version_id, status, scheduled_for)
       VALUES ($1,$2,'SCHEDULED',$3) RETURNING *`,
      [input.treatmentId, input.questionnaireVersionId, input.scheduledFor.toISOString()]
    );
    return rows[0];
  }

  private assertTransitionAllowed(from: CheckInStatus, to: CheckInStatus): void {
    if (!ALLOWED_TRANSITIONS[from].includes(to)) {
      throw new InvalidCheckInTransitionError(from, to);
    }
  }

  async open(client: PoolClient, checkInId: string, expiresAt: Date): Promise<CheckInRow> {
    const current = await this.findById(client, checkInId);
    if (!current) throw new Error("CheckIn não encontrado");
    this.assertTransitionAllowed(current.status, "OPEN");
    const { rows } = await client.query<CheckInRow>(
      `UPDATE check_ins SET status = 'OPEN', opened_at = now(), expires_at = $2 WHERE id = $1 RETURNING *`,
      [checkInId, expiresAt.toISOString()]
    );
    return rows[0];
  }

  async answer(client: PoolClient, checkInId: string, answers: CheckInAnswerInput[]): Promise<CheckInRow> {
    const current = await this.findById(client, checkInId);
    if (!current) throw new Error("CheckIn não encontrado");
    this.assertTransitionAllowed(current.status, "ANSWERED");

    for (const answer of answers) {
      await client.query(
        `INSERT INTO check_in_answers (check_in_id, field_key, value_type, value_json, raw_input)
         VALUES ($1,$2,$3,$4,$5)`,
        [checkInId, answer.fieldKey, answer.valueType, JSON.stringify(answer.value), answer.rawInput ?? null]
      );
    }

    const { rows } = await client.query<CheckInRow>(
      `UPDATE check_ins SET status = 'ANSWERED', answered_at = now() WHERE id = $1 RETURNING *`,
      [checkInId]
    );
    return rows[0];
  }

  /** Chamado só pelo Engine (nunca pelo paciente/médico diretamente). */
  async expire(client: PoolClient, checkInId: string): Promise<CheckInRow> {
    const current = await this.findById(client, checkInId);
    if (!current) throw new Error("CheckIn não encontrado");
    this.assertTransitionAllowed(current.status, "EXPIRED");
    const { rows } = await client.query<CheckInRow>(
      `UPDATE check_ins SET status = 'EXPIRED' WHERE id = $1 RETURNING *`,
      [checkInId]
    );
    return rows[0];
  }

  async cancel(client: PoolClient, checkInId: string): Promise<CheckInRow> {
    const current = await this.findById(client, checkInId);
    if (!current) throw new Error("CheckIn não encontrado");
    this.assertTransitionAllowed(current.status, "CANCELLED");
    const { rows } = await client.query<CheckInRow>(
      `UPDATE check_ins SET status = 'CANCELLED' WHERE id = $1 RETURNING *`,
      [checkInId]
    );
    return rows[0];
  }

  async findById(client: PoolClient, id: string): Promise<CheckInRow | null> {
    const { rows } = await client.query<CheckInRow>(`SELECT * FROM check_ins WHERE id = $1`, [id]);
    return rows[0] ?? null;
  }

  async findOpenOverdue(client: PoolClient, asOf: Date): Promise<CheckInRow[]> {
    const { rows } = await client.query<CheckInRow>(
      `SELECT * FROM check_ins WHERE status = 'OPEN' AND expires_at IS NOT NULL AND expires_at < $1`,
      [asOf.toISOString()]
    );
    return rows;
  }

  async findAnswers(client: PoolClient, checkInId: string) {
    const { rows } = await client.query(`SELECT * FROM check_in_answers WHERE check_in_id = $1`, [checkInId]);
    return rows;
  }
}

export const checkInService = new CheckInService();
