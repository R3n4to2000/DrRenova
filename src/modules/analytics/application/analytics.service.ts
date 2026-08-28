import type { PoolClient } from "pg";

export class AnalyticsService {
  async emit(
    client: PoolClient,
    input: { patientId?: string; eventName: string; properties?: Record<string, unknown> }
  ): Promise<void> {
    await client.query(`INSERT INTO analytics_events (patient_id, event_name, properties) VALUES ($1,$2,$3)`, [
      input.patientId ?? null,
      input.eventName,
      input.properties ? JSON.stringify(input.properties) : null,
    ]);
  }
}

export const analyticsService = new AnalyticsService();
