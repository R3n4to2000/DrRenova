import type { PoolClient } from "pg";
import type { AppContext } from "@/lib/db";
import { runAuditedCommand } from "@/lib/audited-command";
import { patientService, type PatientRow } from "./patient.service";

export async function createPatientCommand(
  ctx: AppContext,
  input: { userId: string; fullName: string; cpf: string; birthDate: string; whatsapp: string }
): Promise<PatientRow> {
  return runAuditedCommand(ctx, { action: "PATIENT_CREATED", entityType: "Patient" }, async (client: PoolClient) => {
    const patient = await patientService.createPatient(client, input);
    // metadata nunca inclui cpf/whatsapp em claro — só o id do usuário vinculado
    return { result: patient, entityId: patient.id, metadata: { userId: input.userId } };
  });
}
