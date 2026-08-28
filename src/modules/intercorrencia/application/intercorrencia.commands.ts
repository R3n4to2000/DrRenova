import type { PoolClient } from "pg";
import type { AppContext } from "@/lib/db";
import { runAuditedCommand } from "@/lib/audited-command";
import { intercorrenciaService, type IntercorrenciaRow } from "./intercorrencia.service";

export async function openIntercorrenciaCommand(
  ctx: AppContext,
  input: { treatmentId: string; origin: string; description: string; priority?: string }
): Promise<IntercorrenciaRow> {
  return runAuditedCommand(ctx, { action: "INTERCORRENCIA_OPENED", entityType: "Intercorrencia" }, async (client: PoolClient) => {
    const intercorrencia = await intercorrenciaService.open(client, input);
    return { result: intercorrencia, entityId: intercorrencia.id, metadata: { treatmentId: input.treatmentId, origin: input.origin } };
  });
}

export async function assumeIntercorrenciaCommand(
  ctx: AppContext,
  id: string,
  doctorId: string
): Promise<IntercorrenciaRow> {
  return runAuditedCommand(ctx, { action: "INTERCORRENCIA_ASSUMED", entityType: "Intercorrencia" }, async (client: PoolClient) => {
    const intercorrencia = await intercorrenciaService.assume(client, id, doctorId);
    return { result: intercorrencia, entityId: id, metadata: { doctorId } };
  });
}
