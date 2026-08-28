import { describe, it, expect, beforeEach } from "vitest";
import { resetTestData, seedBaseConfig, adminPool } from "../setup";
import { createTestPatient, createTestDoctor, asPatient, asDoctor, asSupport, asSystem } from "../helpers";
import { withContext } from "@/lib/db";
import { carteiraService } from "@/modules/doctor/application/doctor.service";
import { treatmentService } from "@/modules/treatment/application/treatment.service";

beforeEach(async () => {
  await resetTestData();
  await seedBaseConfig();
});

describe("Critério 10 — isolamento RLS entre dois pacientes", () => {
  it("Paciente A nunca consegue ver dados do Paciente B, mesmo manipulando o ID diretamente", async () => {
    const { user: userA, patient: patientA } = await createTestPatient({ cpf: "11111111111" });
    const { patient: patientB } = await createTestPatient({ cpf: "22222222222" });

    const rows = await withContext(asPatient(userA.id), (client) =>
      client.query(`SELECT * FROM patients WHERE id = $1`, [patientB.id]).then((r) => r.rows)
    );
    expect(rows).toHaveLength(0);

    const ownRows = await withContext(asPatient(userA.id), (client) =>
      client.query(`SELECT * FROM patients WHERE id = $1`, [patientA.id]).then((r) => r.rows)
    );
    expect(ownRows).toHaveLength(1);
  });

  it("Paciente A não consegue atualizar dados do Paciente B", async () => {
    const { user: userA } = await createTestPatient({ cpf: "33333333333" });
    const { patient: patientB } = await createTestPatient({ cpf: "44444444444" });

    const result = await withContext(asPatient(userA.id), (client) =>
      client.query(`UPDATE patients SET full_name = 'hackeado' WHERE id = $1`, [patientB.id])
    );
    expect(result.rowCount).toBe(0); // RLS filtra a linha alvo; nenhuma linha é afetada
  });
});

describe("Critério 11 — médico não acessa paciente fora da sua carteira", () => {
  it("médico só enxerga tratamentos de pacientes atualmente em sua carteira", async () => {
    const { patient: patientA } = await createTestPatient({ cpf: "55555555555" });
    const { patient: patientB } = await createTestPatient({ cpf: "66666666666" });
    const { user: doctorUser, doctor } = await createTestDoctor();

    const treatmentA = await withContext(asSystem(), (client) =>
      treatmentService.createTreatment(client, { patientId: patientA.id, categoryKey: "PRESSAO_ALTA" })
    );
    const treatmentB = await withContext(asSystem(), (client) =>
      treatmentService.createTreatment(client, { patientId: patientB.id, categoryKey: "PRESSAO_ALTA" })
    );
    // médico só está vinculado ao tratamento de A
    await withContext(asSystem(), (client) =>
      carteiraService.assign(client, { patientId: patientA.id, doctorId: doctor.id, treatmentId: treatmentA.id, reason: "consulta inicial" })
    );

    const visibleA = await withContext(asDoctor(doctorUser.id), (client) =>
      client.query(`SELECT * FROM treatments WHERE id = $1`, [treatmentA.id]).then((r) => r.rows)
    );
    const visibleB = await withContext(asDoctor(doctorUser.id), (client) =>
      client.query(`SELECT * FROM treatments WHERE id = $1`, [treatmentB.id]).then((r) => r.rows)
    );

    expect(visibleA).toHaveLength(1);
    expect(visibleB).toHaveLength(0);
  });
});

describe("Critério 12 — SUPPORT não acessa prontuário clínico por padrão", () => {
  it("SUPPORT não enxerga nenhuma linha de clinical_events (sem policy = acesso negado)", async () => {
    const { patient } = await createTestPatient({ cpf: "77777777777" });
    const treatment = await withContext(asSystem(), (client) =>
      treatmentService.createTreatment(client, { patientId: patient.id, categoryKey: "PRESSAO_ALTA" })
    );
    await adminPool.query(`INSERT INTO clinical_events (treatment_id, type, payload) VALUES ($1,'CONSULTATION','{}'::jsonb)`, [
      treatment.id,
    ]);

    const visibleToSupport = await withContext(asSupport(), (client) =>
      client.query(`SELECT * FROM clinical_events WHERE treatment_id = $1`, [treatment.id]).then((r) => r.rows)
    );
    expect(visibleToSupport).toHaveLength(0);
  });
});

describe("Critério 13 — AuditLog não pode ser alterado por fluxo normal da aplicação", () => {
  it("UPDATE em audit_logs pelo role de runtime falha por falta de privilégio", async () => {
    await adminPool.query(
      `INSERT INTO audit_logs (correlation_id, actor_id, actor_type, action, entity_type, entity_id, origin, result)
       VALUES ('c1', NULL, 'SYSTEM', 'TEST', 'X', 'x1', 'test', 'SUCCESS')`
    );
    await expect(
      withContext(asSystem(), (client) => client.query(`UPDATE audit_logs SET action = 'ALTERADO' WHERE entity_id = 'x1'`))
    ).rejects.toThrow(/permission denied/i);
  });

  it("DELETE em audit_logs pelo role de runtime falha por falta de privilégio", async () => {
    await adminPool.query(
      `INSERT INTO audit_logs (correlation_id, actor_id, actor_type, action, entity_type, entity_id, origin, result)
       VALUES ('c2', NULL, 'SYSTEM', 'TEST', 'X', 'x2', 'test', 'SUCCESS')`
    );
    await expect(
      withContext(asSystem(), (client) => client.query(`DELETE FROM audit_logs WHERE entity_id = 'x2'`))
    ).rejects.toThrow(/permission denied/i);
  });
});
