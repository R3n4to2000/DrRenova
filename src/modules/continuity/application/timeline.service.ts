import type { PoolClient } from "pg";

export interface TimelineItem {
  type: string;
  occurredAt: string;
  summary: string;
  meta: Record<string, unknown>;
}

/**
 * Prontuário longitudinal — não é a Conversation da Camilla (Fatia 3), que
 * nunca será fonte de verdade clínica; é sempre montado a partir das
 * entidades clínicas reais (EligibilityDecision, CheckIn, DoctorDecision,
 * Intercorrencia, Prescription, ClinicalEvent).
 */
export class TimelineService {
  /** Visão completa — só para o médico responsável (RLS já filtra o acesso à tabela). */
  async getTreatmentTimelineForDoctor(client: PoolClient, treatmentId: string): Promise<TimelineItem[]> {
    const items: TimelineItem[] = [];

    const { rows: eligibility } = await client.query(
      `SELECT outcome, clinical_note, decided_at FROM eligibility_decisions WHERE treatment_id = $1`,
      [treatmentId]
    );
    for (const e of eligibility) {
      items.push({
        type: "ELIGIBILITY",
        occurredAt: e.decided_at,
        summary: `Elegibilidade: ${e.outcome}`,
        meta: { clinicalNote: e.clinical_note },
      });
    }

    const { rows: checkIns } = await client.query(
      `SELECT id, status, scheduled_for, opened_at, answered_at FROM check_ins WHERE treatment_id = $1`,
      [treatmentId]
    );
    for (const c of checkIns) {
      items.push({
        type: "CHECKIN",
        occurredAt: c.answered_at ?? c.opened_at ?? c.scheduled_for,
        summary: `Check-in: ${c.status}`,
        meta: { checkInId: c.id },
      });
    }

    const { rows: decisions } = await client.query(
      `SELECT id, action, note, decided_at FROM doctor_decisions WHERE treatment_id = $1`,
      [treatmentId]
    );
    for (const d of decisions) {
      items.push({
        type: "DOCTOR_DECISION",
        occurredAt: d.decided_at,
        summary: `Decisão médica: ${d.action}`,
        meta: { decisionId: d.id, note: d.note },
      });
    }

    const { rows: intercorrencias } = await client.query(
      `SELECT id, description, status, opened_at FROM intercorrencias WHERE treatment_id = $1`,
      [treatmentId]
    );
    for (const i of intercorrencias) {
      items.push({
        type: "INTERCORRENCIA",
        occurredAt: i.opened_at,
        summary: `Intercorrência: ${i.description}`,
        meta: { intercorrenciaId: i.id, status: i.status },
      });
    }

    const { rows: prescriptions } = await client.query(
      `SELECT id, status, created_at FROM prescriptions WHERE treatment_id = $1`,
      [treatmentId]
    );
    for (const p of prescriptions) {
      items.push({
        type: "PRESCRIPTION",
        occurredAt: p.created_at,
        summary: `Prescrição: ${p.status}`,
        meta: { prescriptionId: p.id },
      });
    }

    const { rows: clinicalEvents } = await client.query(
      `SELECT id, type, occurred_at FROM clinical_events WHERE treatment_id = $1`,
      [treatmentId]
    );
    for (const ce of clinicalEvents) {
      items.push({ type: ce.type, occurredAt: ce.occurred_at, summary: `Evento: ${ce.type}`, meta: { clinicalEventId: ce.id } });
    }

    return items.sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime());
  }

  /**
   * Visão do paciente — nunca expõe `note` (conteúdo exclusivamente
   * médico/administrativo). RLS também restringe: paciente só enxerga
   * linhas do próprio tratamento em cada tabela consultada.
   */
  async getTreatmentTimelineForPatient(client: PoolClient, treatmentId: string): Promise<TimelineItem[]> {
    const full = await this.getTreatmentTimelineForDoctor(client, treatmentId);
    return full.map((item) => {
      if (item.type === "DOCTOR_DECISION") {
        return { ...item, meta: { decisionId: item.meta.decisionId } }; // remove note
      }
      if (item.type === "ELIGIBILITY") {
        return { ...item, meta: {} }; // remove clinicalNote
      }
      return item;
    });
  }
}

export const timelineService = new TimelineService();
