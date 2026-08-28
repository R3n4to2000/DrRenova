import type { PoolClient } from "pg";
import type { AppContext } from "@/lib/db";
import { runAuditedCommand } from "@/lib/audited-command";
import { treatmentService, type TreatmentRow } from "./treatment.service";

export async function createTreatmentCommand(
  ctx: AppContext,
  input: { patientId: string; categoryKey: string }
): Promise<TreatmentRow> {
  return runAuditedCommand(ctx, { action: "TREATMENT_CREATED", entityType: "Treatment" }, async (client: PoolClient) => {
    const treatment = await treatmentService.createTreatment(client, input);
    return {
      result: treatment,
      entityId: treatment.id,
      metadata: { patientId: input.patientId, categoryKey: input.categoryKey },
    };
  });
}
