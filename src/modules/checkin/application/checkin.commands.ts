import type { PoolClient } from "pg";
import type { AppContext } from "@/lib/db";
import { runAuditedCommand } from "@/lib/audited-command";
import { continuityEngineService } from "@/modules/continuity/application/continuity-engine.service";
import type { CheckInAnswerInput } from "./checkin.service";

/** Submissão do paciente — o Engine registra a resposta, nunca a interpreta. */
export async function submitCheckInAnswersCommand(
  ctx: AppContext,
  checkInId: string,
  answers: CheckInAnswerInput[]
): Promise<void> {
  return runAuditedCommand(ctx, { action: "CHECKIN_ANSWERED", entityType: "CheckIn" }, async (client: PoolClient) => {
    await continuityEngineService.recordCheckInAnswers(client, checkInId, answers);
    return { result: undefined as void, entityId: checkInId, metadata: { fieldCount: answers.length } };
  });
}
