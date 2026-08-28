import type { PoolClient } from "pg";
import { configService } from "@/modules/config/application/config.service";

export interface AdesaoRow {
  id: string;
  patient_id: string;
  treatment_id: string;
  plan_config_id: string;
  amount_snapshot: string;
  status: string;
  paid_at: string | null;
  idempotency_key: string;
}

/**
 * Toda criação de Adesao é idempotente: uma requisição repetida com a
 * mesma idempotencyKey (ex.: retry de rede do checkout, ou duas requisições
 * verdadeiramente concorrentes) retorna a Adesao já criada, nunca cria uma
 * segunda cobrança.
 *
 * IMPLEMENTAÇÃO (corrigida — ver docs/PENDENCIAS.md/histórico): a versão
 * anterior fazia SELECT (existe?) e depois INSERT — uma race condition real
 * sob concorrência verdadeira (duas transações podem passar pelo SELECT
 * antes de qualquer uma comitar o INSERT). A versão atual usa
 * `INSERT ... ON CONFLICT (idempotency_key) DO NOTHING`, que é atômico no
 * nível do Postgres: a constraint UNIQUE em `adesoes.idempotency_key`
 * garante que, sob concorrência real, apenas uma transação insere a linha —
 * a(s) outra(s) recebem 0 linhas do INSERT e buscam a linha vencedora.
 */
export class AdesaoService {
  async createAdesao(
    client: PoolClient,
    input: { patientId: string; treatmentId: string; planKey: string; idempotencyKey: string }
  ): Promise<AdesaoRow> {
    const plan = await configService.getCurrentPlanVersion(client, input.planKey);

    const { rows: inserted } = await client.query<AdesaoRow>(
      `INSERT INTO adesoes (patient_id, treatment_id, plan_config_id, amount_snapshot, status, idempotency_key)
       VALUES ($1,$2,$3,$4,'PENDING',$5)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING *`,
      [input.patientId, input.treatmentId, plan.id, plan.adesao_amount, input.idempotencyKey]
    );
    if (inserted[0]) return inserted[0];

    // Conflito: outra transação (possivelmente concorrente) já criou a
    // Adesao com esta idempotencyKey. Busca a linha vencedora.
    const { rows: existing } = await client.query<AdesaoRow>(
      `SELECT * FROM adesoes WHERE idempotency_key = $1`,
      [input.idempotencyKey]
    );
    if (!existing[0]) {
      // Situação de corrida extrema: a linha vencedora ainda não commitou
      // (transação concorrente em andamento) e por isso não é visível aqui
      // ainda. Não deveria acontecer no fluxo normal (cada createAdesao
      // roda dentro de sua própria transação via withContext, que só
      // libera o client após COMMIT) — registrado como cenário a
      // monitorar sob carga real (ver docs/PENDENCIAS.md).
      throw new Error(
        `Conflito de idempotencyKey detectado, mas a linha vencedora ainda não está visível (possível transação concorrente em voo)`
      );
    }
    return existing[0];
  }

  async markPaid(client: PoolClient, adesaoId: string): Promise<AdesaoRow> {
    const { rows } = await client.query<AdesaoRow>(
      `UPDATE adesoes SET status = 'PAID', paid_at = now() WHERE id = $1 RETURNING *`,
      [adesaoId]
    );
    return rows[0];
  }
}

export const adesaoService = new AdesaoService();
