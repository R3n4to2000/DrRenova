import type { PoolClient } from "pg";
import type { AppContext } from "@/lib/db";
import { runAuditedCommand } from "@/lib/audited-command";
import { doctorDecisionService, type DoctorDecisionAction, type DoctorDecisionRow } from "./doctor-decision.service";
import { continuityEngineService } from "@/modules/continuity/application/continuity-engine.service";
import { intercorrenciaService } from "@/modules/intercorrencia/application/intercorrencia.service";
import { prescriptionService } from "@/modules/prescription/application/prescription.service";
import { analyticsService } from "@/modules/analytics/application/analytics.service";
import { camillaOrchestrator } from "@/modules/camilla/application/camilla-orchestrator.service";

export interface RecordDoctorDecisionInput {
  treatmentId: string;
  patientId?: string;
  doctorId: string;
  action: DoctorDecisionAction;
  note?: string;
  reviewPeriodDaysNew?: number;
  originCheckInId?: string;
  resolveIntercorrenciaId?: string;
}

export interface RecordDoctorDecisionResult {
  decision: DoctorDecisionRow;
  prescriptionId: string | null;
}

/**
 * Comando central da Fatia 2. Toda decisão médica passa por aqui:
 * 1. grava a DoctorDecision (append-only — RLS garante que só o médico da
 *    carteira daquele tratamento consegue inserir, ver migration 0009);
 * 2. aplica a consequência ESTRUTURAL via Engine (recalcular próxima
 *    revisão, encerrar tratamento) — nunca uma decisão clínica nova;
 * 3. resolve a Intercorrencia de origem, se houver;
 * 4. cria a Prescription em DRAFT, se a ação for ISSUE_PRESCRIPTION;
 * — tudo na MESMA transação/auditoria: se qualquer etapa falhar, a decisão
 * médica inteira é revertida (nunca fica "meio registrada").
 */
export async function recordDoctorDecisionCommand(
  ctx: AppContext,
  input: RecordDoctorDecisionInput
): Promise<RecordDoctorDecisionResult> {
  return runAuditedCommand(
    ctx,
    { action: "DOCTOR_DECISION_RECORDED", entityType: "DoctorDecision" },
    async (client: PoolClient) => {
      const decision = await doctorDecisionService.record(client, {
        treatmentId: input.treatmentId,
        doctorId: input.doctorId,
        action: input.action,
        note: input.note,
        reviewPeriodDaysNew: input.reviewPeriodDaysNew,
        originCheckInId: input.originCheckInId,
      });

      await continuityEngineService.applyDoctorDecisionEffects(client, {
        treatmentId: input.treatmentId,
        action: input.action,
        reviewPeriodDaysNew: input.reviewPeriodDaysNew,
      });

      if (input.resolveIntercorrenciaId) {
        await intercorrenciaService.resolve(client, input.resolveIntercorrenciaId, decision.id);
      }

      let prescriptionId: string | null = null;
      if (input.action === "ISSUE_PRESCRIPTION") {
        const prescription = await prescriptionService.create(client, {
          treatmentId: input.treatmentId,
          doctorId: input.doctorId,
          originDecisionId: decision.id,
        });
        prescriptionId = prescription.id;
        await analyticsService.emit(client, {
          eventName: "prescription_created",
          properties: { treatmentId: input.treatmentId, prescriptionId },
        });
      }

      await analyticsService.emit(client, {
        eventName: "doctor_decision_recorded",
        properties: { treatmentId: input.treatmentId, decisionId: decision.id, action: input.action },
      });

      // Camilla comunica o desfecho PERMITIDO — nunca interpretação clínica.
      // Só quando patientId é conhecido pelo chamador (rotas HTTP sempre
      // fornecem; chamadas internas de teste podem omitir).
      if (input.patientId) {
        await camillaOrchestrator.notifyReviewCompleted(client, { patientId: input.patientId, treatmentId: input.treatmentId });
      }

      return {
        result: { decision, prescriptionId },
        entityId: decision.id,
        metadata: { treatmentId: input.treatmentId, action: input.action },
      };
    }
  );
}
