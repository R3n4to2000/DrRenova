import type { PoolClient } from "pg";
import { sanitizeAuditMetadata } from "@/lib/audit-sanitizer";

export interface AuditEntry {
  correlationId: string;
  actorId: string | null;
  actorType: "USER" | "SYSTEM";
  action: string;
  entityType: string;
  entityId: string;
  origin: string;
  result: "SUCCESS" | "FAILURE";
  metadata?: Record<string, unknown>;
}

/**
 * Serviço de auditoria. `metadata` é sanitizada INCONDICIONALMENTE por
 * `sanitizeAuditMetadata` antes de qualquer INSERT — não é opt-in do
 * chamador. Uma metadata rejeitada lança (não grava silenciosamente uma
 * versão "limpa"), propositalmente: se o chamador tentou gravar algo
 * proibido, isso deve estourar alto, não ser mascarado.
 */
export class AuditService {
  async record(client: PoolClient, entry: AuditEntry): Promise<void> {
    const safeMetadata = sanitizeAuditMetadata(entry.metadata);
    await client.query(
      `INSERT INTO audit_logs (correlation_id, actor_id, actor_type, action, entity_type, entity_id, origin, result, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        entry.correlationId,
        entry.actorId,
        entry.actorType,
        entry.action,
        entry.entityType,
        entry.entityId,
        entry.origin,
        entry.result,
        safeMetadata ? JSON.stringify(safeMetadata) : null,
      ]
    );
  }
}

export const auditService = new AuditService();
