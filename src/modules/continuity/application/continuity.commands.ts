import type { PoolClient } from "pg";
import type { AppContext } from "@/lib/db";
import { runAuditedCommand } from "@/lib/audited-command";
import { subscriptionService } from "@/modules/subscription/application/subscription.service";
import { continuityEngineService } from "./continuity-engine.service";
import { camillaOrchestrator } from "@/modules/camilla/application/camilla-orchestrator.service";

/**
 * Único caminho de ativação de Treatment. Reaproveita o gate já existente
 * da Fatia 1 (`SubscriptionService.activateAfterEligibility`, que verifica
 * a EligibilityDecision mais recente = APPROVED) — o Engine nunca decide
 * elegibilidade, só aplica o efeito estrutural (status, datas) depois que
 * a assinatura já foi legitimamente ativada, na MESMA transação/auditoria.
 *
 * Camilla se apresenta aqui (uma única vez) — é a orquestração deste
 * Command que consome o efeito da ativação, não o Engine chamando Camilla
 * diretamente.
 */
export async function activateTreatmentCommand(
  ctx: AppContext,
  input: { subscriptionId: string; treatmentId: string; patientId: string }
): Promise<void> {
  return runAuditedCommand(ctx, { action: "TREATMENT_ACTIVATED", entityType: "Treatment" }, async (client: PoolClient) => {
    await subscriptionService.activateAfterEligibility(client, input.subscriptionId);
    await continuityEngineService.activateTreatment(client, input.treatmentId);
    await camillaOrchestrator.presentIntroduction(client, { patientId: input.patientId, treatmentId: input.treatmentId });
    return { result: undefined as void, entityId: input.treatmentId, metadata: { subscriptionId: input.subscriptionId } };
  });
}

export async function scheduleCheckInCommand(ctx: AppContext, treatmentId: string): Promise<string> {
  return runAuditedCommand(ctx, { action: "CHECKIN_SCHEDULED", entityType: "CheckIn" }, async (client: PoolClient) => {
    const checkInId = await continuityEngineService.scheduleCheckIn(client, treatmentId);
    return { result: checkInId, entityId: checkInId, metadata: { treatmentId } };
  });
}

export async function openCheckInCommand(ctx: AppContext, checkInId: string, expiresInDays: number, patientId: string): Promise<void> {
  return runAuditedCommand(ctx, { action: "CHECKIN_OPENED", entityType: "CheckIn" }, async (client: PoolClient) => {
    await continuityEngineService.openCheckIn(client, checkInId, expiresInDays);
    const checkIn = await client.query(`SELECT treatment_id FROM check_ins WHERE id = $1`, [checkInId]);
    await camillaOrchestrator.notifyCheckInAvailable(client, {
      patientId,
      treatmentId: checkIn.rows[0].treatment_id,
    });
    return { result: undefined as void, entityId: checkInId, metadata: { expiresInDays } };
  });
}

/**
 * Job de sistema/scheduler (não uma ação de usuário sobre uma única
 * entidade) — audita um resumo do lote na mesma transação; o detalhe por
 * check-in já fica nos eventos `checkin_expired`/`patient_unresponsive`
 * emitidos pelo Engine.
 */
export async function expireOverdueCheckInsCommand(ctx: AppContext, asOf: Date = new Date()): Promise<string[]> {
  return runAuditedCommand(ctx, { action: "CHECKIN_BATCH_EXPIRED", entityType: "CheckIn" }, async (client: PoolClient) => {
    const expiredIds = await continuityEngineService.expireOverdueCheckIns(client, asOf);
    return { result: expiredIds, entityId: expiredIds[0] ?? "none", metadata: { count: expiredIds.length } };
  });
}
