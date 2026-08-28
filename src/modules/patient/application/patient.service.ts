import type { PoolClient } from "pg";
import { encryptField, decryptField, hashField, last4 } from "@/lib/encryption";

export interface PatientRow {
  id: string;
  user_id: string;
  full_name: string;
  cpf_encrypted: string;
  cpf_hash: string;
  birth_date: string;
  whatsapp_encrypted: string;
  whatsapp_last4: string;
  whatsapp_hash: string | null;
  anonymized_at: string | null;
}

export interface PatientView {
  id: string;
  userId: string;
  fullName: string;
  cpf: string; // decifrado — só deve ser chamado por serviço autorizado
  birthDate: string;
  whatsapp: string;
}

export class PatientService {
  /** Normaliza para dígitos apenas — garante que o hash bata independentemente de formatação (+55, espaços, traços). */
  private normalizeWhatsapp(raw: string): string {
    return raw.replace(/\D/g, "");
  }

  async createPatient(
    client: PoolClient,
    input: { userId: string; fullName: string; cpf: string; birthDate: string; whatsapp: string }
  ): Promise<PatientRow> {
    const cpfDigits = input.cpf.replace(/\D/g, "");
    const whatsappNormalized = this.normalizeWhatsapp(input.whatsapp);
    const { rows } = await client.query<PatientRow>(
      `INSERT INTO patients (user_id, full_name, cpf_encrypted, cpf_hash, birth_date, whatsapp_encrypted, whatsapp_last4, whatsapp_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        input.userId,
        input.fullName,
        encryptField(cpfDigits),
        hashField(cpfDigits),
        input.birthDate,
        encryptField(input.whatsapp),
        last4(input.whatsapp),
        hashField(whatsappNormalized),
      ]
    );
    return rows[0];
  }

  /** Resolve um paciente pelo número de WhatsApp — usado pelo webhook, nunca por patientId enviado externamente. */
  async findByWhatsapp(client: PoolClient, rawWhatsapp: string): Promise<PatientRow | null> {
    const hash = hashField(this.normalizeWhatsapp(rawWhatsapp));
    const { rows } = await client.query<PatientRow>(`SELECT * FROM patients WHERE whatsapp_hash = $1`, [hash]);
    return rows[0] ?? null;
  }

  async findById(client: PoolClient, patientId: string): Promise<PatientRow | null> {
    const { rows } = await client.query<PatientRow>(`SELECT * FROM patients WHERE id = $1`, [patientId]);
    return rows[0] ?? null;
  }

  /** Decifra CPF/whatsapp — só deve ser chamado por fluxo que realmente precisa do valor bruto. */
  reveal(row: PatientRow): PatientView {
    return {
      id: row.id,
      userId: row.user_id,
      fullName: row.full_name,
      cpf: decryptField(row.cpf_encrypted),
      birthDate: row.birth_date,
      whatsapp: decryptField(row.whatsapp_encrypted),
    };
  }

  /** Visão administrativa mascarada — nunca decifra. */
  maskedView(row: PatientRow) {
    return {
      id: row.id,
      fullName: row.full_name,
      whatsappMasked: `•••••${row.whatsapp_last4}`,
    };
  }
}

export const patientService = new PatientService();
