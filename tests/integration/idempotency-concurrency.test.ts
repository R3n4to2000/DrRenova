import { describe, it, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { resetTestData, seedBaseConfig, adminPool } from "../setup";
import { createTestPatient, asSystem } from "../helpers";
import { withContext } from "@/lib/db";
import { treatmentService } from "@/modules/treatment/application/treatment.service";
import { adesaoService } from "@/modules/subscription/application/adesao.service";

beforeEach(async () => {
  await resetTestData();
  await seedBaseConfig();
});

describe("Regressão 8 — concorrência real não duplica Adesao", () => {
  it("20 chamadas verdadeiramente concorrentes com a mesma idempotencyKey produzem exatamente 1 Adesao", async () => {
    const { patient } = await createTestPatient({ cpf: "60616263641" });
    const treatment = await withContext(asSystem(), (client) =>
      treatmentService.createTreatment(client, { patientId: patient.id, categoryKey: "PRESSAO_ALTA" })
    );
    const sharedKey = randomUUID();

    // Dispara 20 chamadas de fato concorrentes (Promise.all — cada uma abre
    // sua própria conexão/transação via withContext, correndo em paralelo
    // de verdade, não sequencialmente).
    const concurrentCalls = Array.from({ length: 20 }, () =>
      withContext(asSystem(), (client) =>
        adesaoService.createAdesao(client, {
          patientId: patient.id,
          treatmentId: treatment.id,
          planKey: "ESSENCIAL",
          idempotencyKey: sharedKey,
        })
      )
    );

    const results = await Promise.all(concurrentCalls);

    // todas as 20 chamadas devem ter retornado o MESMO id de Adesao
    const uniqueIds = new Set(results.map((r) => r.id));
    expect(uniqueIds.size).toBe(1);

    // e deve existir exatamente 1 linha no banco para essa chave
    const { rows } = await adminPool.query(`SELECT count(*)::int AS c FROM adesoes WHERE idempotency_key = $1`, [
      sharedKey,
    ]);
    expect(rows[0].c).toBe(1);
  });

  it("chaves diferentes em concorrência real produzem Adesoes diferentes (não há falso-positivo de dedupe)", async () => {
    const { patient } = await createTestPatient({ cpf: "65666768691" });
    const treatment = await withContext(asSystem(), (client) =>
      treatmentService.createTreatment(client, { patientId: patient.id, categoryKey: "PRESSAO_ALTA" })
    );

    const calls = Array.from({ length: 5 }, () => randomUUID()).map((key) =>
      withContext(asSystem(), (client) =>
        adesaoService.createAdesao(client, {
          patientId: patient.id,
          treatmentId: treatment.id,
          planKey: "ESSENCIAL",
          idempotencyKey: key,
        })
      )
    );
    const results = await Promise.all(calls);
    const uniqueIds = new Set(results.map((r) => r.id));
    expect(uniqueIds.size).toBe(5);
  });
});
