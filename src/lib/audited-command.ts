import type { PoolClient } from "pg";
import { withContext, type AppContext } from "@/lib/db";
import { auditService } from "@/modules/audit/application/audit.service";

/**
 * Torna a auditoria estruturalmente obrigatória para mutações críticas.
 *
 * Design: "application/use-case orchestration padronizada" (unit-of-work
 * simples), não um framework de command bus. Cada operação crítica deixa
 * de ser chamada diretamente no Service — passa a ser encapsulada em uma
 * função de "Command" que usa `runAuditedCommand`. O contrato de retorno
 * (`AuditedCommandOutcome`) OBRIGA o chamador, via TypeScript, a declarar
 * `entityId` — não há como retornar um resultado sem também descrever o
 * que auditar.
 *
 * Garantia transacional (o ponto central do requisito):
 * - mutação E audit rodam na MESMA transação (mesmo `client`, mesmo
 *   BEGIN/COMMIT de `withContext`);
 * - se a mutação falhar, `withContext` já faz ROLLBACK — nenhum audit é
 *   criado (não existiria entityId para descrever);
 * - se a mutação funcionar mas a gravação do audit falhar (ex.: o
 *   sanitizador de metadata rejeitar o payload), a exceção sobe, o
 *   `withContext` externo faz ROLLBACK da transação inteira — a mutação
 *   que "funcionou" é desfeita junto. Nunca existe estado em que a mutação
 *   ficou persistida sem o audit correspondente.
 */

export interface AuditedCommandMeta {
  action: string;
  entityType: string;
}

export interface AuditedCommandOutcome<T> {
  result: T;
  entityId: string;
  metadata?: Record<string, unknown>;
}

export async function runAuditedCommand<T>(
  ctx: AppContext,
  meta: AuditedCommandMeta,
  fn: (client: PoolClient) => Promise<AuditedCommandOutcome<T>>
): Promise<T> {
  return withContext(ctx, async (client) => {
    const outcome = await fn(client); // se lançar, withContext faz ROLLBACK — nada é auditado nem persistido

    // mesma transação: se isto lançar (ex.: metadata sanitizada rejeitada),
    // withContext também faz ROLLBACK da mutação acima.
    await auditService.record(client, {
      correlationId: ctx.correlationId,
      actorId: ctx.userId,
      actorType: ctx.userId ? "USER" : "SYSTEM",
      action: meta.action,
      entityType: meta.entityType,
      entityId: outcome.entityId,
      origin: ctx.origin ?? "app",
      result: "SUCCESS",
      metadata: outcome.metadata,
    });

    return outcome.result;
  });
}
