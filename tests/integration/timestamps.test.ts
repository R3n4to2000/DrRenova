import { describe, it, expect, beforeEach } from "vitest";
import { resetTestData, seedBaseConfig, adminPool } from "../setup";
import { createTestPatient } from "../helpers";

beforeEach(async () => {
  await resetTestData();
  await seedBaseConfig();
});

describe("Critério 19 — timestamps persistidos em UTC (timestamptz)", () => {
  it("todas as colunas de data/hora relevantes são timestamptz, não timestamp ingênuo", async () => {
    const { rows } = await adminPool.query<{ table_name: string; column_name: string; data_type: string }>(
      `SELECT table_name, column_name, data_type
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND (column_name LIKE '%_at' OR column_name = 'created_at')
       ORDER BY table_name, column_name`
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      if (row.column_name === "birth_date") continue; // date, não timestamp
      expect(row.data_type).toBe("timestamp with time zone");
    }
  });

  it("o valor persistido representa o mesmo instante independentemente do timezone da sessão", async () => {
    const { patient } = await createTestPatient({ cpf: "88888888888" });

    await adminPool.query(`SET TIME ZONE 'America/Sao_Paulo'`);
    const { rows: saoPaulo } = await adminPool.query(`SELECT created_at FROM patients WHERE id = $1`, [patient.id]);

    await adminPool.query(`SET TIME ZONE 'UTC'`);
    const { rows: utc } = await adminPool.query(`SELECT created_at FROM patients WHERE id = $1`, [patient.id]);

    await adminPool.query(`RESET TIME ZONE`);

    // mesmo instante absoluto, independentemente do timezone de exibição da sessão
    expect(new Date(saoPaulo[0].created_at).getTime()).toBe(new Date(utc[0].created_at).getTime());
  });
});
