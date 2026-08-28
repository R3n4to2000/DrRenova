import type { PoolClient } from "pg";
import { configService } from "@/modules/config/application/config.service";
import { eligibilityService } from "@/modules/subscription/application/eligibility.service";

export type SubscriptionStatus = "PENDING_ELIGIBILITY" | "ACTIVE" | "PAST_DUE" | "CANCELLED";
export type BillingPeriod = "MONTHLY" | "ANNUAL";

export interface SubscriptionRow {
  id: string;
  patient_id: string;
  treatment_id: string;
  plan_config_id: string;
  billing_period: BillingPeriod;
  status: SubscriptionStatus;
  monthly_amount_snapshot: string;
  annual_amount_snapshot: string;
  first_charge_at: string | null;
  next_charge_at: string | null;
}

export class InvalidTransitionError extends Error {
  constructor(from: SubscriptionStatus, to: SubscriptionStatus) {
    super(`Transição de status inválida: ${from} -> ${to}`);
    this.name = "InvalidTransitionError";
  }
}

export class EligibilityNotApprovedError extends Error {
  constructor() {
    super("Não é possível ativar a assinatura sem uma EligibilityDecision com outcome=APPROVED");
    this.name = "EligibilityNotApprovedError";
  }
}

/**
 * Mesma tabela de transições permitidas do trigger de banco
 * (prisma/migrations/0002_security_hardening.sql::check_subscription_transition).
 * Mantidas em dois lugares deliberadamente (defesa em profundidade) —
 * registrado como pendência de consolidação em docs/PENDENCIAS.md.
 */
const ALLOWED_TRANSITIONS: Record<SubscriptionStatus, SubscriptionStatus[]> = {
  PENDING_ELIGIBILITY: ["ACTIVE", "CANCELLED"],
  ACTIVE: ["PAST_DUE", "CANCELLED"],
  PAST_DUE: ["ACTIVE", "CANCELLED"],
  CANCELLED: [],
};

export class SubscriptionService {
  async createPending(
    client: PoolClient,
    input: { patientId: string; treatmentId: string; planKey: string; billingPeriod?: BillingPeriod }
  ): Promise<SubscriptionRow> {
    const plan = await configService.getCurrentPlanVersion(client, input.planKey);
    const { rows } = await client.query<SubscriptionRow>(
      `INSERT INTO subscriptions (patient_id, treatment_id, plan_config_id, billing_period, status, monthly_amount_snapshot, annual_amount_snapshot)
       VALUES ($1,$2,$3,$4,'PENDING_ELIGIBILITY',$5,$6) RETURNING *`,
      [
        input.patientId,
        input.treatmentId,
        plan.id,
        input.billingPeriod ?? "MONTHLY",
        plan.monthly_amount,
        plan.annual_amount,
      ]
    );
    const subscription = rows[0];
    await client.query(
      `INSERT INTO subscription_status_transitions (subscription_id, from_status, to_status, reason)
       VALUES ($1, NULL, 'PENDING_ELIGIBILITY', 'criação inicial')`,
      [subscription.id]
    );
    return subscription;
  }

  private assertTransitionAllowed(from: SubscriptionStatus, to: SubscriptionStatus): void {
    if (!ALLOWED_TRANSITIONS[from].includes(to)) {
      throw new InvalidTransitionError(from, to);
    }
  }

  async transition(
    client: PoolClient,
    subscriptionId: string,
    toStatus: SubscriptionStatus,
    reason: string
  ): Promise<SubscriptionRow> {
    const { rows: current } = await client.query<SubscriptionRow>(
      `SELECT * FROM subscriptions WHERE id = $1`,
      [subscriptionId]
    );
    if (current.length === 0) throw new Error("Subscription não encontrada");
    const fromStatus = current[0].status;

    this.assertTransitionAllowed(fromStatus, toStatus); // valida ANTES de tocar o banco

    const { rows } = await client.query<SubscriptionRow>(
      `UPDATE subscriptions SET status = $2 WHERE id = $1 RETURNING *`,
      [subscriptionId, toStatus]
    );
    await client.query(
      `INSERT INTO subscription_status_transitions (subscription_id, from_status, to_status, reason)
       VALUES ($1,$2,$3,$4)`,
      [subscriptionId, fromStatus, toStatus, reason]
    );
    return rows[0];
  }

  /**
   * Único caminho de ativação. Verifica a decisão de elegibilidade mais
   * recente do tratamento — nunca confia em um parâmetro passado pelo
   * chamador (evita bypass do gate por engano de outra camada).
   */
  async activateAfterEligibility(client: PoolClient, subscriptionId: string): Promise<SubscriptionRow> {
    const { rows } = await client.query<SubscriptionRow>(`SELECT * FROM subscriptions WHERE id = $1`, [
      subscriptionId,
    ]);
    if (rows.length === 0) throw new Error("Subscription não encontrada");
    const subscription = rows[0];

    const decision = await eligibilityService.latestForTreatment(client, subscription.treatment_id);
    if (!decision || decision.outcome !== "APPROVED") {
      throw new EligibilityNotApprovedError();
    }

    const updated = await this.transition(client, subscriptionId, "ACTIVE", "elegibilidade aprovada");
    await client.query(`UPDATE subscriptions SET first_charge_at = now() WHERE id = $1 AND first_charge_at IS NULL`, [
      subscriptionId,
    ]);
    return { ...updated, first_charge_at: updated.first_charge_at ?? new Date().toISOString() };
  }

  async findById(client: PoolClient, id: string): Promise<SubscriptionRow | null> {
    const { rows } = await client.query<SubscriptionRow>(`SELECT * FROM subscriptions WHERE id = $1`, [id]);
    return rows[0] ?? null;
  }
}

export const subscriptionService = new SubscriptionService();
