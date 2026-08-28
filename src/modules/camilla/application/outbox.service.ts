import type { PoolClient } from "pg";
import { withContext } from "@/lib/db";
import { fakeWhatsAppGateway } from "@/ports/fakes";

export type OutboxStatus = "PENDING" | "SENT" | "FAILED" | "DEAD_LETTER" | "PROCESSING";

export interface OutboxEventRow {
  id: string;
  event_type: string;
  payload: unknown;
  status: OutboxStatus;
  attempts: number;
  max_attempts: number;
}

/**
 * Transactional Outbox — mutação + registro do efeito externo a disparar
 * commitam JUNTOS (`enqueue` usa o mesmo `client` da mutação). O envio de
 * verdade só acontece em `dispatchPending()`, DEPOIS do commit.
 *
 * CONCORRÊNCIA: claim atômico (`FOR UPDATE SKIP LOCKED` + PROCESSING em
 * uma única transação curta) — dois dispatchers concorrentes nunca
 * reivindicam a mesma linha.
 */
export class OutboxService {
  async enqueue(
    client: PoolClient,
    input: { eventType: string; payload: Record<string, unknown>; idempotencyKey?: string }
  ): Promise<string> {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO outbox_events (event_type, payload, idempotency_key)
       VALUES ($1,$2,$3)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING id`,
      [input.eventType, JSON.stringify(input.payload), input.idempotencyKey ?? null]
    );
    if (rows[0]) return rows[0].id;
    const { rows: existing } = await client.query<{ id: string }>(
      `SELECT id FROM outbox_events WHERE idempotency_key = $1`,
      [input.idempotencyKey]
    );
    return existing[0].id;
  }

  private async claim(limit: number): Promise<OutboxEventRow[]> {
    return withContext({ userId: null, role: "SYSTEM", correlationId: "outbox-claim" }, (client) =>
      client
        .query<OutboxEventRow>(
          `
          WITH claimed AS (
            SELECT id FROM outbox_events
            WHERE status IN ('PENDING','FAILED') AND next_attempt_at <= now()
            ORDER BY created_at ASC
            LIMIT $1
            FOR UPDATE SKIP LOCKED
          )
          UPDATE outbox_events
          SET status = 'PROCESSING', processing_since = now()
          WHERE id IN (SELECT id FROM claimed)
          RETURNING *
          `,
          [limit]
        )
        .then((r) => r.rows)
    );
  }

  async dispatchPending(limit = 20): Promise<{ sent: number; failed: number; deadLettered: number }> {
    let sent = 0,
      failed = 0,
      deadLettered = 0;

    const claimed = await this.claim(limit);

    for (const event of claimed) {
      const outcome = await this.attemptDelivery(event);
      if (outcome === "SENT") sent++;
      else if (outcome === "DEAD_LETTER") deadLettered++;
      else failed++;
    }

    return { sent, failed, deadLettered };
  }

  /**
   * Tenta entregar UM evento. Importante: se o gateway falhar, o UPDATE que
   * marca o evento como FAILED/DEAD_LETTER precisa ser COMMITADO — nunca
   * relançar a exceção de dentro da transação depois de já ter persistido
   * esse estado, porque `withContext` faz ROLLBACK de qualquer callback que
   * lance, desfazendo a própria atualização de status que acabamos de
   * fazer (bug real encontrado e corrigido nesta validação). Por isso o
   * catch acontece AQUI FORA da transação, e a transação em si sempre
   * termina com COMMIT — sucesso ou falha do gateway são ambos estados
   * finais válidos para o outbox, não uma exceção do banco.
   */
  private async attemptDelivery(event: OutboxEventRow): Promise<"SENT" | "FAILED" | "DEAD_LETTER"> {
    let gatewayError: Error | null = null;

    if (event.event_type === "whatsapp.send") {
      const payload = event.payload as { to: string; body: string };
      try {
        await fakeWhatsAppGateway.sendMessage({ to: payload.to, body: payload.body });
      } catch (err) {
        gatewayError = err as Error;
      }
    } else {
      gatewayError = new Error(`Tipo de evento de outbox desconhecido: ${event.event_type}`);
    }

    if (!gatewayError) {
      await withContext({ userId: null, role: "SYSTEM", correlationId: `outbox-${event.id}` }, (client) =>
        client.query(`UPDATE outbox_events SET status = 'SENT', sent_at = now(), processing_since = NULL WHERE id = $1`, [
          event.id,
        ])
      );
      return "SENT";
    }

    const nextAttempts = event.attempts + 1;
    const isDead = nextAttempts >= event.max_attempts;
    const backoffMinutes = Math.pow(2, nextAttempts);
    await withContext({ userId: null, role: "SYSTEM", correlationId: `outbox-${event.id}` }, (client) =>
      client.query(
        `UPDATE outbox_events
         SET attempts = $2, status = $3, last_error = $4, processing_since = NULL,
             next_attempt_at = now() + ($5 || ' minutes')::interval
         WHERE id = $1`,
        [event.id, nextAttempts, isDead ? "DEAD_LETTER" : "FAILED", gatewayError.message, backoffMinutes]
      )
    );
    return isDead ? "DEAD_LETTER" : "FAILED";
  }

  /** Devolve à fila (FAILED, retryable) eventos presos em PROCESSING há mais de `timeoutMinutes`. */
  async recoverStuckEvents(timeoutMinutes = 5): Promise<number> {
    return withContext({ userId: null, role: "SYSTEM", correlationId: "outbox-recovery" }, async (client) => {
      const { rowCount } = await client.query(
        `UPDATE outbox_events
         SET status = 'FAILED', processing_since = NULL, next_attempt_at = now()
         WHERE status = 'PROCESSING' AND processing_since < now() - ($1 || ' minutes')::interval`,
        [timeoutMinutes]
      );
      return rowCount ?? 0;
    });
  }
}

export const outboxService = new OutboxService();
