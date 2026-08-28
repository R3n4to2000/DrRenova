import type { PoolClient } from "pg";
import { treatmentService } from "@/modules/treatment/application/treatment.service";
import { questionnaireService } from "@/modules/questionnaire/application/questionnaire.service";
import { checkInService, type CheckInAnswerInput } from "@/modules/checkin/application/checkin.service";
import { intercorrenciaService } from "@/modules/intercorrencia/application/intercorrencia.service";
import { analyticsService } from "@/modules/analytics/application/analytics.service";
import type { DoctorDecisionAction } from "@/modules/decision/application/doctor-decision.service";

/**
 * Treatment Continuity Engine — decide QUANDO/O QUÊ, nunca interpreta
 * clinicamente. Toda regra aqui é aritmética de datas e leitura de
 * configuração (CategoryConfig/Treatment) — nenhum limiar clínico é
 * inventado neste arquivo (ver tests/integration/final-adversarial.test.ts,
 * que varre o código-fonte por padrões proibidos).
 *
 * Eventos emitidos (via AnalyticsService — mesma tabela genérica da Fatia 1)
 * são a interface que a Camilla (Fatia 3) consumirá sem reescrever o núcleo.
 */
export class ContinuityEngineService {
  /** 4.1 — Ativação. Pré-condição (EligibilityDecision=APPROVED, Subscription=ACTIVE)
   *  é responsabilidade do CHAMADOR (Command), não do Engine — o Engine só
   *  aplica o efeito estrutural da ativação já autorizada. */
  async activateTreatment(client: PoolClient, treatmentId: string): Promise<void> {
    const periodDays = await treatmentService.effectiveReviewPeriodDays(client, treatmentId);
    const now = new Date();
    const nextReviewDueAt = new Date(now.getTime() + periodDays * 24 * 60 * 60 * 1000);

    await client.query(
      `UPDATE treatments SET status = 'ACTIVE', activated_at = now(), last_review_at = now(), next_review_due_at = $2
       WHERE id = $1`,
      [treatmentId, nextReviewDueAt.toISOString()]
    );

    await analyticsService.emit(client, {
      eventName: "treatment_activated",
      properties: { treatmentId, nextReviewDueAt: nextReviewDueAt.toISOString() },
    });
  }

  /** 4.3 — Agenda um check-in para a próxima revisão devida do tratamento. */
  async scheduleCheckIn(client: PoolClient, treatmentId: string): Promise<string> {
    const { rows } = await client.query<{ category_config_id: string; next_review_due_at: string | null }>(
      `SELECT category_config_id, next_review_due_at FROM treatments WHERE id = $1`,
      [treatmentId]
    );
    if (rows.length === 0) throw new Error("Treatment não encontrado");
    const { category_config_id: categoryConfigId, next_review_due_at: nextReviewDueAt } = rows[0];

    const questionnaireVersion = await questionnaireService.getCurrentVersion(client, categoryConfigId, "CHECKIN");
    const scheduledFor = nextReviewDueAt ? new Date(nextReviewDueAt) : new Date();

    const checkIn = await checkInService.schedule(client, {
      treatmentId,
      questionnaireVersionId: questionnaireVersion.id,
      scheduledFor,
    });

    await analyticsService.emit(client, {
      eventName: "checkin_scheduled",
      properties: { treatmentId, checkInId: checkIn.id, scheduledFor: scheduledFor.toISOString() },
    });

    return checkIn.id;
  }

  /** Abre um check-in agendado. `expiresInDays` é operacional/configurável pelo chamador, nunca uma regra clínica. */
  async openCheckIn(client: PoolClient, checkInId: string, expiresInDays: number): Promise<void> {
    const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);
    await checkInService.open(client, checkInId, expiresAt);
    const checkIn = await checkInService.findById(client, checkInId);
    await analyticsService.emit(client, {
      eventName: "checkin_opened",
      properties: { treatmentId: checkIn?.treatment_id, checkInId, expiresAt: expiresAt.toISOString() },
    });
  }

  /** O Engine registra a resposta estruturada — nunca interpreta o conteúdo. */
  async recordCheckInAnswers(client: PoolClient, checkInId: string, answers: CheckInAnswerInput[]): Promise<void> {
    const checkIn = await checkInService.answer(client, checkInId, answers);
    await analyticsService.emit(client, {
      eventName: "checkin_answered",
      properties: { treatmentId: checkIn.treatment_id, checkInId },
    });
  }

  /**
   * 4.6 — Ausência de resposta. Expira o check-in e sinaliza uma pendência
   * OPERACIONAL (Intercorrencia origin=ENGINE) — nunca cancela assinatura,
   * nunca altera medicamento, nunca presume abandono, nunca muda conduta.
   */
  async expireOverdueCheckIns(client: PoolClient, asOf: Date = new Date()): Promise<string[]> {
    const overdue = await checkInService.findOpenOverdue(client, asOf);
    const expiredIds: string[] = [];

    for (const checkIn of overdue) {
      await checkInService.expire(client, checkIn.id);
      await intercorrenciaService.open(client, {
        treatmentId: checkIn.treatment_id,
        origin: "ENGINE",
        description: "Paciente não respondeu ao check-in dentro do prazo.",
        priority: "ROTINA",
      });
      await analyticsService.emit(client, {
        eventName: "checkin_expired",
        properties: { treatmentId: checkIn.treatment_id, checkInId: checkIn.id },
      });
      await analyticsService.emit(client, {
        eventName: "patient_unresponsive",
        properties: { treatmentId: checkIn.treatment_id, checkInId: checkIn.id },
      });
      expiredIds.push(checkIn.id);
    }
    return expiredIds;
  }

  /**
   * 4.3 — Aplica a CONSEQUÊNCIA ESTRUTURAL (aritmética de datas) de uma
   * decisão médica já registrada. O Engine não decide a ação — o médico já
   * decidiu (DoctorDecision); aqui só recalculamos next_review_due_at ou
   * encerramos o tratamento, conforme o tipo de ação.
   */
  async applyDoctorDecisionEffects(
    client: PoolClient,
    input: { treatmentId: string; action: DoctorDecisionAction; reviewPeriodDaysNew?: number }
  ): Promise<void> {
    const REVIEW_COMPLETING_ACTIONS: DoctorDecisionAction[] = [
      "MAINTAIN",
      "REGISTER_CONDUCT",
      "ISSUE_PRESCRIPTION",
      "CHANGE_REVIEW_PERIOD",
    ];

    if (input.action === "END_TREATMENT") {
      await client.query(`UPDATE treatments SET status = 'ENDED' WHERE id = $1`, [input.treatmentId]);
      await analyticsService.emit(client, { eventName: "treatment_ended", properties: { treatmentId: input.treatmentId } });
      return;
    }

    if (input.action === "CHANGE_REVIEW_PERIOD" && input.reviewPeriodDaysNew) {
      await client.query(`UPDATE treatments SET review_period_days_override = $2 WHERE id = $1`, [
        input.treatmentId,
        input.reviewPeriodDaysNew,
      ]);
      await analyticsService.emit(client, {
        eventName: "review_period_changed",
        properties: { treatmentId: input.treatmentId, newPeriodDays: input.reviewPeriodDaysNew },
      });
    }

    if (REVIEW_COMPLETING_ACTIONS.includes(input.action)) {
      const periodDays = await treatmentService.effectiveReviewPeriodDays(client, input.treatmentId);
      const now = new Date();
      const nextReviewDueAt = new Date(now.getTime() + periodDays * 24 * 60 * 60 * 1000);
      await client.query(
        `UPDATE treatments SET last_review_at = now(), next_review_due_at = $2 WHERE id = $1`,
        [input.treatmentId, nextReviewDueAt.toISOString()]
      );
      await analyticsService.emit(client, {
        eventName: "review_due",
        properties: { treatmentId: input.treatmentId, nextReviewDueAt: nextReviewDueAt.toISOString() },
      });
    }
  }
}

export const continuityEngineService = new ContinuityEngineService();
