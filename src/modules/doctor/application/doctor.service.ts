import type { PoolClient } from "pg";

export interface DoctorRow {
  id: string;
  user_id: string;
  full_name: string;
  crm: string;
  crm_state: string;
  specialty: string;
  status: "ACTIVE" | "ON_LEAVE" | "INACTIVE";
}

export interface AssignmentRow {
  id: string;
  patient_id: string;
  doctor_id: string;
  treatment_id: string | null;
  started_at: string;
  ended_at: string | null;
  reason: string | null;
  is_current: boolean;
}

export class DoctorService {
  async createDoctor(
    client: PoolClient,
    input: { userId: string; fullName: string; crm: string; crmState: string; specialty: string }
  ): Promise<DoctorRow> {
    const { rows } = await client.query<DoctorRow>(
      `INSERT INTO doctors (user_id, full_name, crm, crm_state, specialty) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [input.userId, input.fullName, input.crm, input.crmState, input.specialty]
    );
    return rows[0];
  }
}

/**
 * Carteira: vínculo médico responsável ↔ paciente. Nunca deletado — apenas
 * encerrado (isCurrent=false, endedAt preenchido). Uma nova atribuição é
 * sempre uma NOVA linha.
 */
export class CarteiraService {
  async assign(
    client: PoolClient,
    input: { patientId: string; doctorId: string; treatmentId?: string; reason: string }
  ): Promise<AssignmentRow> {
    // encerra qualquer vínculo atual para o mesmo tratamento (se houver) antes de criar o novo
    if (input.treatmentId) {
      await client.query(
        `UPDATE doctor_patient_assignments SET is_current = false, ended_at = now()
         WHERE treatment_id = $1 AND is_current = true`,
        [input.treatmentId]
      );
    }
    const { rows } = await client.query<AssignmentRow>(
      `INSERT INTO doctor_patient_assignments (patient_id, doctor_id, treatment_id, reason)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [input.patientId, input.doctorId, input.treatmentId ?? null, input.reason]
    );
    return rows[0];
  }

  async endAssignment(client: PoolClient, assignmentId: string, reason: string): Promise<void> {
    await client.query(
      `UPDATE doctor_patient_assignments SET is_current = false, ended_at = now(), reason = $2
       WHERE id = $1 AND is_current = true`,
      [assignmentId, reason]
    );
  }

  async currentForTreatment(client: PoolClient, treatmentId: string): Promise<AssignmentRow | null> {
    const { rows } = await client.query<AssignmentRow>(
      `SELECT * FROM doctor_patient_assignments WHERE treatment_id = $1 AND is_current = true LIMIT 1`,
      [treatmentId]
    );
    return rows[0] ?? null;
  }

  async historyForPatient(client: PoolClient, patientId: string): Promise<AssignmentRow[]> {
    const { rows } = await client.query<AssignmentRow>(
      `SELECT * FROM doctor_patient_assignments WHERE patient_id = $1 ORDER BY started_at ASC`,
      [patientId]
    );
    return rows;
  }
}

export const doctorService = new DoctorService();
export const carteiraService = new CarteiraService();
