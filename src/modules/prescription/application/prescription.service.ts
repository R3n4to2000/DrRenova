import type { PoolClient } from "pg";
import { fakePrescriptionProvider } from "@/ports/fakes";

export type PrescriptionStatus = "DRAFT" | "PENDING_SIGNATURE" | "SIGNED" | "DELIVERED" | "FAILED" | "CANCELLED";

export interface PrescriptionRow {
  id: string;
  treatment_id: string;
  doctor_id: string;
  origin_decision_id: string;
  status: PrescriptionStatus;
  provider_ref: string | null;
  document_ref: string | null;
  signed_at: string | null;
  delivered_at: string | null;
}

export class InvalidPrescriptionTransitionError extends Error {
  constructor(from: PrescriptionStatus, to: PrescriptionStatus) {
    super(`Transição de prescrição inválida: ${from} -> ${to}`);
    this.name = "InvalidPrescriptionTransitionError";
  }
}

const ALLOWED_TRANSITIONS: Record<PrescriptionStatus, PrescriptionStatus[]> = {
  DRAFT: ["PENDING_SIGNATURE", "CANCELLED"],
  PENDING_SIGNATURE: ["SIGNED", "FAILED", "CANCELLED"],
  SIGNED: ["DELIVERED", "FAILED"],
  DELIVERED: [],
  FAILED: [],
  CANCELLED: [],
};

/**
 * Domínio de Prescription desacoplado de fornecedor real via
 * PrescriptionProviderPort — nesta fatia, implementação Fake
 * (src/ports/fakes.ts). Só pode ser criada/assinada por médico autorizado
 * (garantido por RLS na tabela `prescriptions`, não só aqui).
 */
export class PrescriptionService {
  private assertTransitionAllowed(from: PrescriptionStatus, to: PrescriptionStatus): void {
    if (!ALLOWED_TRANSITIONS[from].includes(to)) {
      throw new InvalidPrescriptionTransitionError(from, to);
    }
  }

  async create(
    client: PoolClient,
    input: { treatmentId: string; doctorId: string; originDecisionId: string }
  ): Promise<PrescriptionRow> {
    const { rows } = await client.query<PrescriptionRow>(
      `INSERT INTO prescriptions (treatment_id, doctor_id, origin_decision_id, status)
       VALUES ($1,$2,$3,'DRAFT') RETURNING *`,
      [input.treatmentId, input.doctorId, input.originDecisionId]
    );
    return rows[0];
  }

  async requestSignature(client: PoolClient, id: string): Promise<PrescriptionRow> {
    const current = await this.findById(client, id);
    if (!current) throw new Error("Prescription não encontrada");
    this.assertTransitionAllowed(current.status, "PENDING_SIGNATURE");
    const { rows } = await client.query<PrescriptionRow>(
      `UPDATE prescriptions SET status = 'PENDING_SIGNATURE' WHERE id = $1 RETURNING *`,
      [id]
    );
    return rows[0];
  }

  /**
   * Só o médico autorizado (checado por RLS) pode assinar.
   *
   * Revisão de robustez transacional: se o provedor de assinatura lançar
   * uma exceção, ela é capturada AQUI e convertida em transição para
   * FAILED — nunca deixada propagar. Se propagasse, a transação inteira
   * (incluinda a transição DRAFT→PENDING_SIGNATURE feita momentos antes,
   * na mesma chamada de `signPrescriptionCommand`) seria revertida por
   * `withContext`. A disponibilidade do fornecedor de prescrição nunca
   * pode apagar o registro de que uma tentativa de assinatura ocorreu.
   */
  async sign(client: PoolClient, id: string, doctorId: string): Promise<PrescriptionRow> {
    const current = await this.findById(client, id);
    if (!current) throw new Error("Prescription não encontrada");
    this.assertTransitionAllowed(current.status, "SIGNED");

    try {
      const { providerRef, documentRef } = await fakePrescriptionProvider.sign({
        treatmentId: current.treatment_id,
        doctorId,
        prescriptionId: id,
      });
      const { rows } = await client.query<PrescriptionRow>(
        `UPDATE prescriptions SET status = 'SIGNED', provider_ref = $2, document_ref = $3, signed_at = now()
         WHERE id = $1 RETURNING *`,
        [id, providerRef, documentRef]
      );
      return rows[0];
    } catch {
      const { rows } = await client.query<PrescriptionRow>(
        `UPDATE prescriptions SET status = 'FAILED' WHERE id = $1 RETURNING *`,
        [id]
      );
      return rows[0];
    }
  }

  async deliver(client: PoolClient, id: string): Promise<PrescriptionRow> {
    const current = await this.findById(client, id);
    if (!current) throw new Error("Prescription não encontrada");
    this.assertTransitionAllowed(current.status, "DELIVERED");
    const { rows } = await client.query<PrescriptionRow>(
      `UPDATE prescriptions SET status = 'DELIVERED', delivered_at = now() WHERE id = $1 RETURNING *`,
      [id]
    );
    return rows[0];
  }

  async findById(client: PoolClient, id: string): Promise<PrescriptionRow | null> {
    const { rows } = await client.query<PrescriptionRow>(`SELECT * FROM prescriptions WHERE id = $1`, [id]);
    return rows[0] ?? null;
  }
}

export const prescriptionService = new PrescriptionService();
