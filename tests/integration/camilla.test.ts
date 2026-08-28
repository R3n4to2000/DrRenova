import { describe, it, expect, beforeEach } from "vitest";
import { resetTestData, seedBaseConfig, adminPool } from "../setup";
import { createActiveTreatment, asSystem } from "../helpers";
import { withContext } from "@/lib/db";
import { camillaOrchestrator } from "@/modules/camilla/application/camilla-orchestrator.service";
import { deterministicSafetyRulesEngine } from "@/modules/camilla/application/safety-rules.service";
import { communicationRulesEngine } from "@/modules/camilla/application/communication-rules.service";
import { continuityEngineService } from "@/modules/continuity/application/continuity-engine.service";

beforeEach(async () => {
  await resetTestData();
  await seedBaseConfig();
});

describe("Camilla — apresentação única", () => {
  it("apresenta-se apenas na primeira vez, não repete", async () => {
    const { treatment, patient } = await createActiveTreatment({ cpf: "90000000001" });

    const first = await withContext(asSystem(), (client) =>
      camillaOrchestrator.presentIntroduction(client, { patientId: patient.id, treatmentId: treatment.id })
    );
    expect(first).not.toBeNull();

    const second = await withContext(asSystem(), (client) =>
      camillaOrchestrator.presentIntroduction(client, { patientId: patient.id, treatmentId: treatment.id })
    );
    expect(second).toBeNull(); // já se apresentou — não envia de novo

    const { rows } = await adminPool.query(`SELECT count(*)::int AS c FROM conversation_messages WHERE content LIKE 'INTRO:%'`);
    expect(rows[0].c).toBe(1);
  });
});

describe("Camilla — Deterministic Safety Rules disparam INDEPENDENTEMENTE da intenção classificada", () => {
  it("uma regra TEST_ONLY ativa cria Escalation mesmo com texto administrativo/neutro", async () => {
    const { treatment, patient } = await createActiveTreatment({ cpf: "90000000002" });

    // Regra fictícia, marcada explicitamente TEST_ONLY — nunca usada fora de teste.
    await withContext(asSystem(), (client) =>
      deterministicSafetyRulesEngine.publishRule(client, {
        ruleKey: "TEST_ONLY_generic_threshold",
        fieldKey: "valor_generico",
        operator: "GT",
        threshold: 100,
        approvedBy: "TEST_ONLY — não é aprovação real da Direção Médica",
      })
    );

    const result = await withContext(asSystem(), (client) =>
      camillaOrchestrator.handleInboundMessage(client, {
        patientId: patient.id,
        treatmentId: treatment.id,
        rawText: "135", // classificado como STRUCTURED_FOLLOWUP pelo staging classifier — mas a regra dispara mesmo assim
        pendingFieldKey: "valor_generico",
      })
    );

    expect(result.escalated).toBe(true);
    const { rows } = await adminPool.query(`SELECT origin, priority FROM intercorrencias WHERE treatment_id = $1`, [treatment.id]);
    expect(rows).toHaveLength(1);
    expect(rows[0].origin).toBe("CAMILLA");
    expect(rows[0].priority).toBe("ALTA");
  });

  it("sem regra disparada e com valor abaixo do limiar, não escala (fica em STRUCTURED_FOLLOWUP normal)", async () => {
    const { treatment, patient } = await createActiveTreatment({ cpf: "90000000003" });
    await withContext(asSystem(), (client) =>
      deterministicSafetyRulesEngine.publishRule(client, {
        ruleKey: "TEST_ONLY_generic_threshold",
        fieldKey: "valor_generico",
        operator: "GT",
        threshold: 100,
        approvedBy: "TEST_ONLY",
      })
    );

    const result = await withContext(asSystem(), (client) =>
      camillaOrchestrator.handleInboundMessage(client, {
        patientId: patient.id,
        treatmentId: treatment.id,
        rawText: "80",
        pendingFieldKey: "valor_generico",
      })
    );
    expect(result.escalated).toBe(false);
    expect(result.intent).toBe("STRUCTURED_FOLLOWUP");
  });
});

describe("Camilla — Intent Classifier escala dúvida clínica mesmo sem regra determinística", () => {
  it("texto mencionando dose/medicamento é classificado como CLINICAL_QUESTION e escala", async () => {
    const { treatment, patient } = await createActiveTreatment({ cpf: "90000000004" });
    const result = await withContext(asSystem(), (client) =>
      camillaOrchestrator.handleInboundMessage(client, {
        patientId: patient.id,
        treatmentId: treatment.id,
        rawText: "posso aumentar a dose do meu remédio sozinho?",
      })
    );
    expect(result.intent).toBe("CLINICAL_QUESTION");
    expect(result.escalated).toBe(true);
    expect(result.replyText).not.toMatch(/pode|deve|está (bom|ruim|alto|baixo)/i); // nunca opina clinicamente
  });

  it("texto administrativo é resolvido sem escalonamento", async () => {
    const { treatment, patient } = await createActiveTreatment({ cpf: "90000000005" });
    const result = await withContext(asSystem(), (client) =>
      camillaOrchestrator.handleInboundMessage(client, {
        patientId: patient.id,
        treatmentId: treatment.id,
        rawText: "quero saber sobre o pagamento da minha assinatura",
      })
    );
    expect(result.intent).toBe("ADMINISTRATIVE");
    expect(result.escalated).toBe(false);
  });
});

describe("Camilla — confirmação explícita antes de persistir dado clínico", () => {
  it("o dado só entra em CheckInAnswer depois de confirmStructuredAnswer, nunca antes", async () => {
    const { treatment, patient } = await createActiveTreatment({ cpf: "90000000006" });
    const checkInId = await withContext(asSystem(), (client) => continuityEngineService.scheduleCheckIn(client, treatment.id));
    await withContext(asSystem(), (client) => continuityEngineService.openCheckIn(client, checkInId, 7));

    await withContext(asSystem(), (client) =>
      camillaOrchestrator.handleInboundMessage(client, {
        patientId: patient.id,
        treatmentId: treatment.id,
        rawText: "135",
        pendingFieldKey: "valor_generico",
      })
    );

    // antes da confirmação: nenhuma CheckInAnswer ainda existe
    const { rows: before } = await adminPool.query(`SELECT count(*)::int AS c FROM check_in_answers WHERE check_in_id = $1`, [
      checkInId,
    ]);
    expect(before[0].c).toBe(0);

    await withContext(asSystem(), (client) =>
      camillaOrchestrator.confirmStructuredAnswer(asSystem(), client, {
        checkInId,
        fieldKey: "valor_generico",
        valueType: "NUMBER",
        value: 135,
        rawInput: "135",
      })
    );

    const { rows: after } = await adminPool.query(`SELECT count(*)::int AS c FROM check_in_answers WHERE check_in_id = $1`, [
      checkInId,
    ]);
    expect(after[0].c).toBe(1);
  });
});

describe("Camilla — frequency cap / opt-out (CommunicationRulesEngine)", () => {
  it("paciente com opt-out nunca recebe mensagem proativa", async () => {
    const { treatment, patient } = await createActiveTreatment({ cpf: "90000000007" });
    await adminPool.query(
      `INSERT INTO patient_communication_preferences (patient_id, opted_out) VALUES ($1, true)`,
      [patient.id]
    );

    const canSend = await withContext(asSystem(), (client) =>
      communicationRulesEngine.canSendProactiveMessage(client, { treatmentId: treatment.id, patientId: patient.id })
    );
    expect(canSend).toBe(false);
  });

  it("sem mensagem proativa anterior, pode enviar; logo depois de uma, respeita o intervalo mínimo", async () => {
    const { treatment, patient } = await createActiveTreatment({ cpf: "90000000008" });
    const canSendFirst = await withContext(asSystem(), (client) =>
      communicationRulesEngine.canSendProactiveMessage(client, { treatmentId: treatment.id, patientId: patient.id })
    );
    expect(canSendFirst).toBe(true);

    const checkInId = await withContext(asSystem(), (client) => continuityEngineService.scheduleCheckIn(client, treatment.id));
    await withContext(asSystem(), (client) => continuityEngineService.openCheckIn(client, checkInId, 7));
    await withContext(asSystem(), (client) => camillaOrchestrator.notifyCheckInAvailable(client, { patientId: patient.id, treatmentId: treatment.id }));

    const canSendAgain = await withContext(asSystem(), (client) =>
      communicationRulesEngine.canSendProactiveMessage(client, { treatmentId: treatment.id, patientId: patient.id, minHoursBetweenProactive: 12 })
    );
    expect(canSendAgain).toBe(false); // acabou de enviar — respeita o cap
  });
});

describe("Camilla — observabilidade de IA", () => {
  it("toda mensagem inbound gera um AIExecution referenciando PromptVersion, sem duplicar prontuário", async () => {
    const { treatment, patient } = await createActiveTreatment({ cpf: "90000000009" });
    await withContext(asSystem(), (client) =>
      camillaOrchestrator.handleInboundMessage(client, { patientId: patient.id, treatmentId: treatment.id, rawText: "80" })
    );

    const { rows } = await adminPool.query(
      `SELECT model, purpose, prompt_version_id, escalated FROM ai_executions ORDER BY created_at DESC LIMIT 1`
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].model).toBe("staging-keyword-classifier-v1");
    expect(rows[0].prompt_version_id).not.toBeNull();
  });
});
