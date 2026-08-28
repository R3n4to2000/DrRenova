import type { PoolClient } from "pg";
import type { AppContext } from "@/lib/db";
import { runAuditedCommand } from "@/lib/audited-command";
import { doctorService, carteiraService, type DoctorRow, type AssignmentRow } from "./doctor.service";

export async function createDoctorCommand(
  ctx: AppContext,
  input: { userId: string; fullName: string; crm: string; crmState: string; specialty: string }
): Promise<DoctorRow> {
  return runAuditedCommand(ctx, { action: "DOCTOR_CREATED", entityType: "Doctor" }, async (client: PoolClient) => {
    const doctor = await doctorService.createDoctor(client, input);
    return { result: doctor, entityId: doctor.id, metadata: { crmState: input.crmState, specialty: input.specialty } };
  });
}

export async function assignCarteiraCommand(
  ctx: AppContext,
  input: { patientId: string; doctorId: string; treatmentId?: string; reason: string }
): Promise<AssignmentRow> {
  return runAuditedCommand(
    ctx,
    { action: "CARTEIRA_ASSIGNED", entityType: "DoctorPatientAssignment" },
    async (client: PoolClient) => {
      const assignment = await carteiraService.assign(client, input);
      return {
        result: assignment,
        entityId: assignment.id,
        metadata: { patientId: input.patientId, doctorId: input.doctorId, reason: input.reason },
      };
    }
  );
}

export async function endCarteiraAssignmentCommand(
  ctx: AppContext,
  assignmentId: string,
  reason: string
): Promise<void> {
  return runAuditedCommand(
    ctx,
    { action: "CARTEIRA_ASSIGNMENT_ENDED", entityType: "DoctorPatientAssignment" },
    async (client: PoolClient) => {
      await carteiraService.endAssignment(client, assignmentId, reason);
      return { result: undefined as void, entityId: assignmentId, metadata: { reason } };
    }
  );
}
