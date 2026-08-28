import type { PoolClient } from "pg";
import type { AppContext } from "@/lib/db";
import { runAuditedCommand } from "@/lib/audited-command";
import { fakeTelemedicineProvider } from "@/ports/fakes";

/**
 * Consulta inicial — suporta as duas estratégias aprovadas (médico próprio
 * ou fornecedor externo) através de TelemedicineProviderPort. Nesta fatia,
 * `fakeTelemedicineProvider` é STAGING (nenhum fornecedor de R$3,40 ou
 * equivalente está contratado/credenciado neste ambiente). O domínio nunca
 * depende do fornecedor específico — só do Port.
 *
 * A consulta sempre gera um ClinicalEvent. A decisão de elegibilidade
 * continua exclusivamente médica (EligibilityService, inalterado).
 */
export async function conductInitialConsultationCommand(
  ctx: AppContext,
  input: { treatmentId: string; patientId: string; doctorId: string; providerMode: "OWN_DOCTOR" | "EXTERNAL_PROVIDER" }
): Promise<{ clinicalEventId: string }> {
  return runAuditedCommand(
    ctx,
    { action: "INITIAL_CONSULTATION_CONDUCTED", entityType: "ClinicalEvent" },
    async (client: PoolClient) => {
      let providerRef: string | null = null;
      if (input.providerMode === "EXTERNAL_PROVIDER") {
        const result = await fakeTelemedicineProvider.scheduleConsultation({
          patientId: input.patientId,
          doctorId: input.doctorId,
        });
        providerRef = result.providerRef;
      }

      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO clinical_events (treatment_id, type, payload) VALUES ($1, 'CONSULTATION', $2) RETURNING id`,
        [input.treatmentId, JSON.stringify({ providerMode: input.providerMode, providerRef })]
      );

      return {
        result: { clinicalEventId: rows[0].id },
        entityId: rows[0].id,
        metadata: { treatmentId: input.treatmentId, providerMode: input.providerMode },
      };
    }
  );
}
