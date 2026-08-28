import type { PoolClient } from "pg";

export type QueuePriority = "RED" | "ORANGE" | "YELLOW" | "GREEN";

export interface QueueItem {
  treatment_id: string;
  patient_full_name: string;
  category_name: string;
  treatment_status: string;
  next_review_due_at: string | null;
  open_intercorrencias: number;
  has_high_priority_intercorrencia: boolean;
  has_answered_pending_review: boolean;
  priority: QueuePriority;
}

/**
 * Fila do médico — orientada por dados reais da própria carteira (RLS
 * já garante que só o SELECT de treatments/intercorrencias/check_ins do
 * médico autenticado retorna linhas). A prioridade NUNCA vem de um
 * limiar clínico inventado — apenas: existência de intercorrência com
 * prioridade administrativa "ALTA" (🔴), qualquer intercorrência aberta
 * (🟠), revisão vencida ou check-in respondido aguardando revisão (🟡),
 * ou rotina (🟢).
 */
export class QueueService {
  async getDoctorQueue(client: PoolClient, doctorId: string): Promise<QueueItem[]> {
    const { rows } = await client.query<QueueItem>(
      `
      SELECT
        t.id AS treatment_id,
        p.full_name AS patient_full_name,
        cc.name AS category_name,
        t.status AS treatment_status,
        t.next_review_due_at,
        COALESCE(ic.open_count, 0)::int AS open_intercorrencias,
        COALESCE(ic.has_alta, false) AS has_high_priority_intercorrencia,
        COALESCE(ci.has_answered, false) AS has_answered_pending_review,
        CASE
          WHEN COALESCE(ic.has_alta, false) THEN 'RED'
          WHEN COALESCE(ic.open_count, 0) > 0 THEN 'ORANGE'
          WHEN (t.next_review_due_at IS NOT NULL AND t.next_review_due_at < now())
               OR COALESCE(ci.has_answered, false) THEN 'YELLOW'
          ELSE 'GREEN'
        END AS priority
      FROM doctor_patient_assignments dpa
      JOIN treatments t ON t.id = dpa.treatment_id
      JOIN patients p ON p.id = t.patient_id
      JOIN category_configs cc ON cc.id = t.category_config_id
      LEFT JOIN LATERAL (
        SELECT count(*) AS open_count, bool_or(priority = 'ALTA') AS has_alta
        FROM intercorrencias i WHERE i.treatment_id = t.id AND i.status != 'RESOLVED'
      ) ic ON true
      LEFT JOIN LATERAL (
        SELECT bool_or(status = 'ANSWERED') AS has_answered
        FROM check_ins c WHERE c.treatment_id = t.id
      ) ci ON true
      WHERE dpa.doctor_id = $1 AND dpa.is_current = true AND t.status = 'ACTIVE'
      ORDER BY
        CASE
          WHEN COALESCE(ic.has_alta, false) THEN 0
          WHEN COALESCE(ic.open_count, 0) > 0 THEN 1
          WHEN (t.next_review_due_at IS NOT NULL AND t.next_review_due_at < now()) OR COALESCE(ci.has_answered, false) THEN 2
          ELSE 3
        END,
        t.next_review_due_at ASC NULLS LAST
      `,
      [doctorId]
    );
    return rows;
  }
}

export const queueService = new QueueService();
