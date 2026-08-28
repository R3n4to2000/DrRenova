import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { resetTestData, seedBaseConfig, adminPool } from "../setup";
import { createTestPatient, createTestDoctor, asDoctor, asSystem } from "../helpers";
import { withContext } from "@/lib/db";
import { treatmentService } from "@/modules/treatment/application/treatment.service";
import { carteiraService } from "@/modules/doctor/application/doctor.service";
import { eligibilityService } from "@/modules/subscription/application/eligibility.service";

beforeEach(async () => {
  await resetTestData();
  await seedBaseConfig();
});

describe("Adversarial final — médico NÃO altera/insere em tratamento fora da carteira (gap real corrigido)", () => {
  it("DOCTOR não consegue fazer UPDATE em Treatment fora da própria carteira", async () => {
    const { patient } = await createTestPatient({ cpf: "10101010101" });
    const { user: doctorUser } = await createTestDoctor(); // sem nenhum vínculo com este paciente
    const treatment = await withContext(asSystem(), (client) =>
      treatmentService.createTreatment(client, { patientId: patient.id, categoryKey: "PRESSAO_ALTA" })
    );

    const result = await withContext(asDoctor(doctorUser.id), (client) =>
      client.query(`UPDATE treatments SET status = 'ACTIVE' WHERE id = $1`, [treatment.id])
    );
    expect(result.rowCount).toBe(0); // RLS filtra a linha alvo — nenhuma atualização ocorre

    const { rows } = await adminPool.query(`SELECT status FROM treatments WHERE id = $1`, [treatment.id]);
    expect(rows[0].status).toBe("ONBOARDING"); // inalterado
  });

  it("DOCTOR consegue fazer UPDATE em Treatment DENTRO da própria carteira (garante que a correção não quebrou o caminho legítimo)", async () => {
    const { patient } = await createTestPatient({ cpf: "20202020202" });
    const { user: doctorUser, doctor } = await createTestDoctor();
    const treatment = await withContext(asSystem(), (client) =>
      treatmentService.createTreatment(client, { patientId: patient.id, categoryKey: "PRESSAO_ALTA" })
    );
    await withContext(asSystem(), (client) =>
      carteiraService.assign(client, { patientId: patient.id, doctorId: doctor.id, treatmentId: treatment.id, reason: "consulta inicial" })
    );

    const result = await withContext(asDoctor(doctorUser.id), (client) =>
      client.query(`UPDATE treatments SET status = 'ACTIVE' WHERE id = $1`, [treatment.id])
    );
    expect(result.rowCount).toBe(1);
  });

  it("DOCTOR não consegue inserir ClinicalEvent para tratamento fora da própria carteira", async () => {
    const { patient } = await createTestPatient({ cpf: "30303030303" });
    const { user: doctorUser } = await createTestDoctor();
    const treatment = await withContext(asSystem(), (client) =>
      treatmentService.createTreatment(client, { patientId: patient.id, categoryKey: "PRESSAO_ALTA" })
    );

    await expect(
      withContext(asDoctor(doctorUser.id), (client) =>
        client.query(`INSERT INTO clinical_events (treatment_id, type, payload) VALUES ($1,'CONSULTATION','{}'::jsonb)`, [
          treatment.id,
        ])
      )
    ).rejects.toThrow(/row-level security/i);
  });

  it("DOCTOR não consegue registrar EligibilityDecision para tratamento fora da própria carteira", async () => {
    const { patient } = await createTestPatient({ cpf: "40404040404" });
    const { user: doctorUser, doctor } = await createTestDoctor();
    const treatment = await withContext(asSystem(), (client) =>
      treatmentService.createTreatment(client, { patientId: patient.id, categoryKey: "PRESSAO_ALTA" })
    );
    // doutor NÃO está vinculado a este tratamento

    await expect(
      withContext(asDoctor(doctorUser.id), (client) =>
        eligibilityService.recordDecision(client, {
          patientId: patient.id,
          treatmentId: treatment.id,
          doctorId: doctor.id,
          outcome: "APPROVED",
        })
      )
    ).rejects.toThrow(/row-level security/i);
  });
});

describe("Adversarial final — role de runtime nunca executa DDL (automatizado)", () => {
  it("CREATE TABLE via app_runtime falha por falta de privilégio", async () => {
    const runtimePool = new Pool({ connectionString: process.env.DATABASE_URL });
    await expect(runtimePool.query(`CREATE TABLE tentativa_ddl_teste (id int)`)).rejects.toThrow(/permission denied/i);
    await runtimePool.end();
  });

  it("ALTER TABLE via app_runtime falha por falta de privilégio", async () => {
    const runtimePool = new Pool({ connectionString: process.env.DATABASE_URL });
    await expect(runtimePool.query(`ALTER TABLE patients ADD COLUMN hack text`)).rejects.toThrow(/must be owner|permission denied/i);
    await runtimePool.end();
  });
});

describe("Adversarial final — CPF/WhatsApp nunca em texto puro na coluna cifrada", () => {
  it("a coluna cpf_encrypted no banco real não contém o CPF em claro", async () => {
    const cpfPlain = "98765432100";
    const { patient } = await createTestPatient({ cpf: cpfPlain, whatsapp: "+5531977776666" });

    const { rows } = await adminPool.query(`SELECT cpf_encrypted, whatsapp_encrypted FROM patients WHERE id = $1`, [
      patient.id,
    ]);
    expect(rows[0].cpf_encrypted).not.toContain(cpfPlain);
    expect(rows[0].whatsapp_encrypted).not.toContain("977776666");
  });
});

describe("Adversarial final — nenhuma regra clínica fictícia hardcoded (verificação automatizada)", () => {
  it("o código-fonte não contém limiares clínicos nem tabela DeterministicSafetyRule", () => {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const srcDir = path.resolve(__dirname, "../../src");
    // "deterministicsafetyrule" removido do padrão proibido: agora é infraestrutura
    // legítima (MVP Integration) — o invariante real é "nasce vazia de regras
    // ATIVAS reais", testado separadamente acima via consulta ao banco.
    const forbiddenPatterns = [/pa sist[oó]lica/i, /\b160\/\d{2,3}\b/];

    function walk(dir: string): string[] {
      let results: string[] = [];
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) results = results.concat(walk(full));
        else if (/\.(ts|tsx|sql)$/.test(entry.name)) results.push(full);
      }
      return results;
    }

    const files = walk(srcDir).concat(
      fs.readdirSync(path.resolve(__dirname, "../../prisma/migrations")).map((f) =>
        path.join(__dirname, "../../prisma/migrations", f)
      )
    );

    const violations: string[] = [];
    for (const file of files) {
      const content = fs.readFileSync(file, "utf8");
      for (const pattern of forbiddenPatterns) {
        if (pattern.test(content)) violations.push(`${file} bate o padrão proibido ${pattern}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("a tabela deterministic_safety_rules existe (MVP Integration) mas nasce vazia de regras reais (nenhum limiar clínico seedado)", async () => {
    const { rows: tableExists } = await adminPool.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name = 'deterministic_safety_rules'`
    );
    expect(tableExists).toHaveLength(1); // existe — Camilla é MVP Integration, não mais Fatia 3 futura

    const { rows: activeRules } = await adminPool.query(
      `SELECT * FROM deterministic_safety_rules WHERE status = 'ACTIVE'`
    );
    // nenhuma regra ATIVA de produção/dev — só testes com rule_key TEST_ONLY_% podem existir, e nunca ACTIVE por padrão
    expect(activeRules).toHaveLength(0);
  });
});
