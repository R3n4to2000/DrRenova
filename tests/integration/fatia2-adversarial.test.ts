import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resetTestData, seedBaseConfig, adminPool } from "../setup";
import { createActiveTreatment, createTestDoctor, asDoctor, asPatient, asSystem } from "../helpers";
import { withContext } from "@/lib/db";
import { doctorDecisionService } from "@/modules/decision/application/doctor-decision.service";
import { recordDoctorDecisionCommand } from "@/modules/decision/application/doctor-decision.commands";
import { prescriptionService } from "@/modules/prescription/application/prescription.service";

beforeEach(async () => {
  await resetTestData();
  await seedBaseConfig();
});

async function doctorUserIdFor(doctorId: string): Promise<string> {
  const { rows } = await adminPool.query(`SELECT user_id FROM doctors WHERE id = $1`, [doctorId]);
  return rows[0].user_id;
}

describe("Invariante 4/5 — médico fora da carteira não acessa nem registra decisão sobre o prontuário", () => {
  it("médico fora da carteira não enxerga o Treatment (prontuário)", async () => {
    const { treatment } = await createActiveTreatment({ cpf: "80808080801" });
    const { user: outsiderUser } = await createTestDoctor();

    const visible = await withContext(asDoctor(outsiderUser.id), (client) =>
      client.query(`SELECT * FROM treatments WHERE id = $1`, [treatment.id]).then((r) => r.rows)
    );
    expect(visible).toHaveLength(0);
  });

  it("médico fora da carteira não consegue inserir DoctorDecision (RLS rejeita)", async () => {
    const { treatment } = await createActiveTreatment({ cpf: "80808080802" });
    const { user: outsiderUser, doctor: outsiderDoctor } = await createTestDoctor();

    await expect(
      withContext(asDoctor(outsiderUser.id), (client) =>
        doctorDecisionService.record(client, {
          treatmentId: treatment.id,
          doctorId: outsiderDoctor.id,
          action: "MAINTAIN",
        })
      )
    ).rejects.toThrow(/row-level security/i);
  });
});

describe("Invariante 6 — paciente não acessa prontuário de outro paciente", () => {
  it("paciente A não enxerga DoctorDecision/CheckIn do tratamento de paciente B", async () => {
    const { treatment: treatmentB } = await createActiveTreatment({ cpf: "80808080803" });
    const { patientUser: userA } = await createActiveTreatment({ cpf: "80808080804" });

    const visibleDecisions = await withContext(asPatient(userA.id), (client) =>
      client.query(`SELECT * FROM doctor_decisions WHERE treatment_id = $1`, [treatmentB.id]).then((r) => r.rows)
    );
    expect(visibleDecisions).toHaveLength(0);

    const visibleCheckins = await withContext(asPatient(userA.id), (client) =>
      client.query(`SELECT * FROM check_ins WHERE treatment_id = $1`, [treatmentB.id]).then((r) => r.rows)
    );
    expect(visibleCheckins).toHaveLength(0);
  });
});

describe("Invariante 7 — DoctorDecision histórico não pode ser sobrescrito", () => {
  it("não existe caminho de UPDATE para doctor_decisions (nem para o médico da carteira)", async () => {
    const { treatment, doctor } = await createActiveTreatment({ cpf: "80808080805" });
    const doctorUserId = await doctorUserIdFor(doctor.id);

    const { decision } = await recordDoctorDecisionCommand(asDoctor(doctorUserId), {
      treatmentId: treatment.id,
      doctorId: doctor.id,
      action: "MAINTAIN",
    });

    await expect(
      withContext(asDoctor(doctorUserId), (client) =>
        client.query(`UPDATE doctor_decisions SET note = 'alterado' WHERE id = $1`, [decision.id])
      )
    ).rejects.toThrow(/permission denied/i);
  });
});

describe("Invariante 10 — mudança futura de CategoryConfig/questionário não altera resposta histórica", () => {
  it("um CheckIn mantém a versão de questionário com que foi criado mesmo após nova versão ser publicada", async () => {
    const { treatment } = await createActiveTreatment({ cpf: "80808080806" });
    const { continuityEngineService } = await import("@/modules/continuity/application/continuity-engine.service");
    const { questionnaireService } = await import("@/modules/questionnaire/application/questionnaire.service");
    const { getSeededCategoryConfigId } = await import("../setup");

    const checkInId = await withContext(asSystem(), (client) => continuityEngineService.scheduleCheckIn(client, treatment.id));
    const { rows: before } = await adminPool.query(`SELECT questionnaire_version_id FROM check_ins WHERE id = $1`, [checkInId]);

    const categoryConfigId = await getSeededCategoryConfigId();
    await withContext(asSystem(), (client) =>
      questionnaireService.publishNewVersion(client, {
        categoryConfigId,
        type: "CHECKIN",
        fields: [{ fieldKey: "novo_campo", label: "Novo Campo", valueType: "TEXT" }],
      })
    );

    const { rows: after } = await adminPool.query(`SELECT questionnaire_version_id FROM check_ins WHERE id = $1`, [checkInId]);
    expect(after[0].questionnaire_version_id).toBe(before[0].questionnaire_version_id); // não muda retroativamente
  });
});

describe("Invariante 12/13 — Prescription não pode ser criada por paciente nem por médico fora da carteira", () => {
  it("paciente não consegue INSERT direto em prescriptions (mesmo com uma DoctorDecision de origem real existente)", async () => {
    const { treatment, patientUser, doctor } = await createActiveTreatment({ cpf: "80808080807" });
    const doctorUserId = await doctorUserIdFor(doctor.id);
    // cria uma DoctorDecision REAL de origem — sem isso, o INSERT...SELECT
    // abaixo simplesmente não insere nada (0 linhas) e o teste não provaria nada.
    const { decision } = await recordDoctorDecisionCommand(asDoctor(doctorUserId), {
      treatmentId: treatment.id,
      doctorId: doctor.id,
      action: "MAINTAIN",
    });

    await expect(
      withContext(asPatient(patientUser.id), (client) =>
        client.query(
          `INSERT INTO prescriptions (treatment_id, doctor_id, origin_decision_id, status)
           VALUES ($1, $2, $3, 'DRAFT')`,
          [treatment.id, doctor.id, decision.id]
        )
      )
    ).rejects.toThrow(/row-level security|new row/i);

    const { rows } = await adminPool.query(`SELECT count(*)::int AS c FROM prescriptions WHERE treatment_id = $1`, [treatment.id]);
    expect(rows[0].c).toBe(0); // confirma que nada foi inserido de fato
  });

  it("médico fora da carteira não consegue criar Prescription para o tratamento", async () => {
    const { treatment, doctor } = await createActiveTreatment({ cpf: "80808080808" });
    const doctorUserId = await doctorUserIdFor(doctor.id);
    const { decision } = await recordDoctorDecisionCommand(asDoctor(doctorUserId), {
      treatmentId: treatment.id,
      doctorId: doctor.id,
      action: "MAINTAIN",
    });

    const { user: outsiderUser, doctor: outsiderDoctor } = await createTestDoctor();
    await expect(
      withContext(asDoctor(outsiderUser.id), (client) =>
        prescriptionService.create(client, {
          treatmentId: treatment.id,
          doctorId: outsiderDoctor.id,
          originDecisionId: decision.id,
        })
      )
    ).rejects.toThrow(/row-level security/i);
  });
});

describe("Invariante 14 — nova tabela clínica possui RLS", () => {
  it("check_ins, doctor_decisions, intercorrencias, prescriptions têm RLS ativado", async () => {
    const { rows } = await adminPool.query(
      `SELECT relname FROM pg_class WHERE relrowsecurity = true AND relname IN
       ('check_ins','check_in_answers','doctor_decisions','intercorrencias','prescriptions')`
    );
    expect(rows.map((r) => r.relname).sort()).toEqual(
      ["check_in_answers", "check_ins", "doctor_decisions", "intercorrencias", "prescriptions"].sort()
    );
  });
});

describe("Invariante 15/16 — toda decisão médica gera AuditLog; falha de auditoria reverte a decisão", () => {
  it("registrar uma DoctorDecision gera um AuditLog correspondente", async () => {
    const { treatment, doctor } = await createActiveTreatment({ cpf: "80808080809" });
    const doctorUserId = await doctorUserIdFor(doctor.id);

    const { decision } = await recordDoctorDecisionCommand(asDoctor(doctorUserId), {
      treatmentId: treatment.id,
      doctorId: doctor.id,
      action: "MAINTAIN",
    });

    const { rows } = await adminPool.query(
      `SELECT * FROM audit_logs WHERE entity_type = 'DoctorDecision' AND entity_id = $1`,
      [decision.id]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe("DOCTOR_DECISION_RECORDED");
  });

  it("se a auditoria falhar (metadata proibida), a DoctorDecision não fica persistida", async () => {
    const { treatment, doctor } = await createActiveTreatment({ cpf: "80808080810" });
    const doctorUserId = await doctorUserIdFor(doctor.id);
    const { runAuditedCommand } = await import("@/lib/audited-command");

    await expect(
      runAuditedCommand(asDoctor(doctorUserId), { action: "DOCTOR_DECISION_RECORDED", entityType: "DoctorDecision" }, async (client) => {
        const decision = await doctorDecisionService.record(client, {
          treatmentId: treatment.id,
          doctorId: doctor.id,
          action: "MAINTAIN",
        });
        return { result: decision, entityId: decision.id, metadata: { cpf: "11111111111" } }; // proibido deliberadamente
      })
    ).rejects.toThrow();

    const { rows } = await adminPool.query(`SELECT * FROM doctor_decisions WHERE treatment_id = $1`, [treatment.id]);
    expect(rows).toHaveLength(0); // revertido junto com a auditoria
  });
});

describe("Invariante 18 — nenhuma regra clínica está hardcoded (Fatia 2)", () => {
  it("varre os novos módulos da Fatia 2 por padrões clínicos proibidos", () => {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const dirs = ["continuity", "checkin", "decision", "intercorrencia", "prescription", "questionnaire"].map((m) =>
      path.resolve(__dirname, `../../src/modules/${m}`)
    );
    const forbidden = [/pa sist[oó]lica/i, /\b180\b.*dia/i, /\b160\/\d{2,3}\b/];

    function walk(dir: string): string[] {
      let out: string[] = [];
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out = out.concat(walk(full));
        else if (entry.name.endsWith(".ts")) out.push(full);
      }
      return out;
    }

    const violations: string[] = [];
    for (const dir of dirs) {
      for (const file of walk(dir)) {
        const content = fs.readFileSync(file, "utf8");
        for (const pattern of forbidden) {
          if (pattern.test(content)) violations.push(`${file} bate ${pattern}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
