import type { PoolClient } from "pg";

export class EngagementCoverageService {
  async compute(client: PoolClient, windowDays: number): Promise<{ activeCount: number; engagedCount: number; coverage: number }> {
    const { rows: activeRows } = await client.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM treatments WHERE status = 'ACTIVE'`
    );
    const activeCount = Number(activeRows[0].c);

    const { rows: engagedRows } = await client.query<{ c: string }>(
      `
      SELECT count(DISTINCT t.id)::text AS c
      FROM treatments t
      WHERE t.status = 'ACTIVE'
        AND (
          EXISTS (SELECT 1 FROM check_ins ci WHERE ci.treatment_id = t.id AND ci.status = 'ANSWERED' AND ci.answered_at > now() - ($1 || ' days')::interval)
          OR EXISTS (SELECT 1 FROM doctor_decisions dd WHERE dd.treatment_id = t.id AND dd.decided_at > now() - ($1 || ' days')::interval)
        )
      `,
      [windowDays]
    );
    const engagedCount = Number(engagedRows[0].c);

    return {
      activeCount,
      engagedCount,
      coverage: activeCount === 0 ? 0 : Math.round((engagedCount / activeCount) * 1000) / 10,
    };
  }

  async computeD30D60D90(client: PoolClient): Promise<{ d30: number; d60: number; d90: number }> {
    const [d30, d60, d90] = await Promise.all([this.compute(client, 30), this.compute(client, 60), this.compute(client, 90)]);
    return { d30: d30.coverage, d60: d60.coverage, d90: d90.coverage };
  }
}

export const engagementCoverageService = new EngagementCoverageService();
