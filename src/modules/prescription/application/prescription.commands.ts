import type { PoolClient } from "pg";
import type { AppContext } from "@/lib/db";
import { runAuditedCommand } from "@/lib/audited-command";
import { prescriptionService, type PrescriptionRow } from "./prescription.service";
import { analyticsService } from "@/modules/analytics/application/analytics.service";
import { camillaOrchestrator } from "@/modules/camilla/application/camilla-orchestrator.service";

/** Só médico autorizado (RLS) chega aqui — mas a checagem de papel também é feita na camada de entrega (ver rota). */
export async function signPrescriptionCommand(ctx: AppContext, id: string, doctorId: string): Promise<PrescriptionRow> {
  return runAuditedCommand(ctx, { action: "PRESCRIPTION_SIGNED", entityType: "Prescription" }, async (client: PoolClient) => {
    const current = await prescriptionService.findById(client, id);
    if (current?.status === "DRAFT") {
      await prescriptionService.requestSignature(client, id);
    }
    const prescription = await prescriptionService.sign(client, id, doctorId);
    await analyticsService.emit(client, { eventName: "prescription_signed", properties: { prescriptionId: id } });
    return { result: prescription, entityId: id, metadata: { doctorId } };
  });
}

export async function deliverPrescriptionCommand(ctx: AppContext, id: string, patientId: string): Promise<PrescriptionRow> {
  return runAuditedCommand(ctx, { action: "PRESCRIPTION_DELIVERED", entityType: "Prescription" }, async (client: PoolClient) => {
    const prescription = await prescriptionService.deliver(client, id);
    await analyticsService.emit(client, { eventName: "prescription_delivered", properties: { prescriptionId: id } });
    // Camilla apenas avisa que o documento está disponível — nunca descreve/modifica a conduta.
    await camillaOrchestrator.notifyPrescriptionAvailable(client, { patientId });
    return { result: prescription, entityId: id };
  });
}
