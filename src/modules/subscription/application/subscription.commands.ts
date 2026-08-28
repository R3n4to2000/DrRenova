import type { PoolClient } from "pg";
import type { AppContext } from "@/lib/db";
import { runAuditedCommand } from "@/lib/audited-command";
import {
  subscriptionService,
  type SubscriptionRow,
  type SubscriptionStatus,
  type BillingPeriod,
} from "./subscription.service";
import { adesaoService, type AdesaoRow } from "./adesao.service";
import { fakePaymentGateway } from "@/ports/fakes";
import { eligibilityService, type EligibilityDecisionRow, type EligibilityOutcome } from "./eligibility.service";
import {
  communicationConsentService,
  type ConsentRow,
} from "./communication-consent.service";

// ---------- Subscription ----------

export async function createPendingSubscriptionCommand(
  ctx: AppContext,
  input: { patientId: string; treatmentId: string; planKey: string; billingPeriod?: BillingPeriod }
): Promise<SubscriptionRow> {
  return runAuditedCommand(ctx, { action: "SUBSCRIPTION_CREATED", entityType: "Subscription" }, async (client: PoolClient) => {
    const subscription = await subscriptionService.createPending(client, input);
    return {
      result: subscription,
      entityId: subscription.id,
      metadata: { patientId: input.patientId, treatmentId: input.treatmentId, planKey: input.planKey },
    };
  });
}

export async function transitionSubscriptionCommand(
  ctx: AppContext,
  subscriptionId: string,
  toStatus: SubscriptionStatus,
  reason: string
): Promise<SubscriptionRow> {
  return runAuditedCommand(
    ctx,
    { action: "SUBSCRIPTION_STATUS_TRANSITIONED", entityType: "Subscription" },
    async (client: PoolClient) => {
      const subscription = await subscriptionService.transition(client, subscriptionId, toStatus, reason);
      return { result: subscription, entityId: subscription.id, metadata: { toStatus, reason } };
    }
  );
}

export async function activateSubscriptionAfterEligibilityCommand(
  ctx: AppContext,
  subscriptionId: string
): Promise<SubscriptionRow> {
  return runAuditedCommand(
    ctx,
    { action: "SUBSCRIPTION_ACTIVATED", entityType: "Subscription" },
    async (client: PoolClient) => {
      const subscription = await subscriptionService.activateAfterEligibility(client, subscriptionId);
      return { result: subscription, entityId: subscription.id };
    }
  );
}

// ---------- Adesao ----------

export async function createAdesaoCommand(
  ctx: AppContext,
  input: { patientId: string; treatmentId: string; planKey: string; idempotencyKey: string }
): Promise<AdesaoRow> {
  return runAuditedCommand(ctx, { action: "ADESAO_CREATED", entityType: "Adesao" }, async (client: PoolClient) => {
    const adesao = await adesaoService.createAdesao(client, input);
    return {
      result: adesao,
      entityId: adesao.id,
      metadata: { patientId: input.patientId, treatmentId: input.treatmentId, planKey: input.planKey },
    };
  });
}

export async function markAdesaoPaidCommand(ctx: AppContext, adesaoId: string): Promise<AdesaoRow> {
  return runAuditedCommand(ctx, { action: "ADESAO_PAID", entityType: "Adesao" }, async (client: PoolClient) => {
    const adesao = await adesaoService.markPaid(client, adesaoId);
    return { result: adesao, entityId: adesao.id };
  });
}

/**
 * Fecha o fluxo de pagamento de ponta a ponta: cria a Adesao (idempotente,
 * já existia) e chama o PaymentGatewayPort — STAGING nesta fatia
 * (`fakePaymentGateway`), fornecedor real ainda não contratado. Só marca
 * PAID se o gateway confirmar; se falhar, a Adesao permanece PENDING (sem
 * mensalidade nunca ativada a partir daqui — o gate de elegibilidade
 * continua sendo o único caminho de ativação, inalterado).
 */
/**
 * Fecha o fluxo de pagamento de ponta a ponta: cria a Adesao (idempotente,
 * já existia) e chama o PaymentGatewayPort — STAGING nesta fatia
 * (`fakePaymentGateway`), fornecedor real ainda não contratado. Só marca
 * PAID se o gateway confirmar; se falhar, a Adesao permanece PENDING (sem
 * mensalidade nunca ativada a partir daqui — o gate de elegibilidade
 * continua sendo o único caminho de ativação, inalterado).
 *
 * IMPORTANTE (revisão de robustez transacional): a chamada ao gateway é
 * envolvida em try/catch DENTRO da transação — se o provedor lançar uma
 * exceção (timeout, erro de rede), isso é tratado como "gatewayStatus:
 * FAILED", nunca deixado propagar. Se deixássemos propagar, `withContext`
 * faria ROLLBACK de tudo, inclusive da criação da Adesao que acabamos de
 * persistir — a decisão de negócio (existe uma tentativa de adesão
 * registrada) NUNCA pode depender da disponibilidade do provedor externo.
 */
export async function chargeAdesaoCommand(
  ctx: AppContext,
  input: { patientId: string; treatmentId: string; planKey: string; idempotencyKey: string }
): Promise<AdesaoRow> {
  return runAuditedCommand(ctx, { action: "ADESAO_CHARGED", entityType: "Adesao" }, async (client: PoolClient) => {
    const adesao = await adesaoService.createAdesao(client, input);
    if (adesao.status === "PAID") {
      return { result: adesao, entityId: adesao.id, metadata: { alreadyPaid: true } };
    }

    // STAGING ADAPTER — nenhum fornecedor de pagamento real contratado nesta
    // fatia. Porta claramente substituível (PaymentGatewayPort).
    let gatewayStatus: "PAID" | "FAILED";
    try {
      const chargeResult = await fakePaymentGateway.charge({
        amount: adesao.amount_snapshot,
        idempotencyKey: input.idempotencyKey,
      });
      gatewayStatus = chargeResult.status;
    } catch {
      // exceção do provedor NUNCA propaga — vira um resultado de negócio
      // (FAILED), nunca um rollback da Adesao já persistida.
      gatewayStatus = "FAILED";
    }

    if (gatewayStatus === "PAID") {
      const paid = await adesaoService.markPaid(client, adesao.id);
      return { result: paid, entityId: paid.id, metadata: { gatewayStatus: "PAID" } };
    }

    return { result: adesao, entityId: adesao.id, metadata: { gatewayStatus: "FAILED" } };
  });
}

// ---------- EligibilityDecision ----------

export async function recordEligibilityDecisionCommand(
  ctx: AppContext,
  input: { patientId: string; treatmentId: string; doctorId: string; outcome: EligibilityOutcome; clinicalNote?: string }
): Promise<EligibilityDecisionRow> {
  return runAuditedCommand(
    ctx,
    { action: "ELIGIBILITY_DECISION_RECORDED", entityType: "EligibilityDecision" },
    async (client: PoolClient) => {
      const decision = await eligibilityService.recordDecision(client, input);
      // NUNCA inclui clinicalNote (conteúdo clínico) no audit — só o desfecho e os ids.
      return {
        result: decision,
        entityId: decision.id,
        metadata: { patientId: input.patientId, treatmentId: input.treatmentId, outcome: input.outcome },
      };
    }
  );
}

// ---------- CommunicationConsent ----------

export async function acceptCommunicationConsentCommand(
  ctx: AppContext,
  input: { patientId: string; purpose: string; channel: ConsentRow["channel"]; version: string; origin: string }
): Promise<ConsentRow> {
  return runAuditedCommand(
    ctx,
    { action: "COMMUNICATION_CONSENT_ACCEPTED", entityType: "CommunicationConsent" },
    async (client: PoolClient) => {
      const consent = await communicationConsentService.accept(client, input);
      return {
        result: consent,
        entityId: consent.id,
        metadata: { patientId: input.patientId, purpose: input.purpose, version: input.version },
      };
    }
  );
}

export async function revokeCommunicationConsentCommand(ctx: AppContext, consentId: string): Promise<ConsentRow> {
  return runAuditedCommand(
    ctx,
    { action: "COMMUNICATION_CONSENT_REVOKED", entityType: "CommunicationConsent" },
    async (client: PoolClient) => {
      const consent = await communicationConsentService.revoke(client, consentId);
      return { result: consent, entityId: consent.id };
    }
  );
}
