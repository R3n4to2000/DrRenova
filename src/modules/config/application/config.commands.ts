import type { PoolClient } from "pg";
import type { AppContext } from "@/lib/db";
import { runAuditedCommand } from "@/lib/audited-command";
import { configService, type PlanConfigRow, type CategoryConfigRow } from "./config.service";

export async function publishNewPlanVersionCommand(
  ctx: AppContext,
  planKey: string,
  data: { name: string; adesaoAmount: string; monthlyAmount: string; annualAmount: string; maxTreatments?: number }
): Promise<PlanConfigRow> {
  return runAuditedCommand(
    ctx,
    { action: "PLAN_CONFIG_NEW_VERSION_PUBLISHED", entityType: "PlanConfig" },
    async (client: PoolClient) => {
      const plan = await configService.publishNewPlanVersion(client, planKey, data);
      return {
        result: plan,
        entityId: plan.id,
        metadata: { planKey, version: plan.version, monthlyAmount: data.monthlyAmount },
      };
    }
  );
}

export async function publishNewCategoryVersionCommand(
  ctx: AppContext,
  categoryKey: string,
  data: { name: string; defaultReviewPeriodDays: number; icon?: string }
): Promise<CategoryConfigRow> {
  return runAuditedCommand(
    ctx,
    { action: "CATEGORY_CONFIG_NEW_VERSION_PUBLISHED", entityType: "CategoryConfig" },
    async (client: PoolClient) => {
      const category = await configService.publishNewCategoryVersion(client, categoryKey, data);
      return {
        result: category,
        entityId: category.id,
        metadata: { categoryKey, version: category.version },
      };
    }
  );
}
