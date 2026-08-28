import type { PoolClient } from "pg";

export interface ConsentRow {
  id: string;
  patient_id: string;
  purpose: string;
  channel: "WHATSAPP" | "WEB" | "SYSTEM";
  version: string;
  origin: string;
  accepted_at: string;
  revoked_at: string | null;
}

/**
 * Nunca atualizado destrutivamente: aceitar de novo cria uma NOVA linha;
 * revogar só marca `revoked_at` na linha original (a prova do aceite —
 * version, acceptedAt, origin — permanece intacta).
 */
export class CommunicationConsentService {
  async accept(
    client: PoolClient,
    input: { patientId: string; purpose: string; channel: ConsentRow["channel"]; version: string; origin: string }
  ): Promise<ConsentRow> {
    const { rows } = await client.query<ConsentRow>(
      `INSERT INTO communication_consents (patient_id, purpose, channel, version, origin)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [input.patientId, input.purpose, input.channel, input.version, input.origin]
    );
    return rows[0];
  }

  async revoke(client: PoolClient, consentId: string): Promise<ConsentRow> {
    const { rows } = await client.query<ConsentRow>(
      `UPDATE communication_consents SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL RETURNING *`,
      [consentId]
    );
    return rows[0];
  }

  async historyForPatient(client: PoolClient, patientId: string): Promise<ConsentRow[]> {
    const { rows } = await client.query<ConsentRow>(
      `SELECT * FROM communication_consents WHERE patient_id = $1 ORDER BY accepted_at ASC`,
      [patientId]
    );
    return rows;
  }
}

export const communicationConsentService = new CommunicationConsentService();
