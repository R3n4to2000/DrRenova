import { describe, it, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { resetTestData, seedBaseConfig, adminPool } from "../setup";
import { createActiveTreatment } from "../helpers";
import { POST } from "@/app/api/webhooks/whatsapp/route";

const DEFAULT_TEST_WHATSAPP = "+5531999990000";

beforeEach(async () => {
  await resetTestData();
  await seedBaseConfig();
});

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/webhooks/whatsapp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("Webhook WhatsApp — resolução de identidade REAL por hash", () => {
  it("número conhecido é resolvido e processado normalmente", async () => {
    await createActiveTreatment({ cpf: "97000000001", whatsapp: DEFAULT_TEST_WHATSAPP });
    const res = await POST(makeRequest({ from: DEFAULT_TEST_WHATSAPP, text: "80", externalMessageId: randomUUID() }));
    const body = await res.json();
    expect(body.status).toBe("PROCESSED");
  });

  it("número DESCONHECIDO não processa nada", async () => {
    const res = await POST(makeRequest({ from: "+5599888887777", text: "olá", externalMessageId: randomUUID() }));
    const body = await res.json();
    expect(body.status).toBe("UNKNOWN_SENDER");
    const { rows } = await adminPool.query(`SELECT count(*)::int AS c FROM conversation_messages`);
    expect(rows[0].c).toBe(0);
  });

  it("tentar enviar um patientId no lugar do número não resolve nada", async () => {
    const { patient } = await createActiveTreatment({ cpf: "97000000002" });
    const res = await POST(makeRequest({ from: patient.id, text: "80", externalMessageId: randomUUID() }));
    const body = await res.json();
    expect(body.status).toBe("UNKNOWN_SENDER");
  });

  it("número com formatação diferente ainda resolve pelo mesmo hash normalizado", async () => {
    await createActiveTreatment({ cpf: "97000000003", whatsapp: DEFAULT_TEST_WHATSAPP });
    const res = await POST(makeRequest({ from: "+55 (31) 99999-0000", text: "80", externalMessageId: randomUUID() }));
    const body = await res.json();
    expect(body.status).toBe("PROCESSED");
  });
});

describe("Webhook WhatsApp — idempotência", () => {
  it("a mesma externalMessageId entregue duas vezes só processa uma vez", async () => {
    await createActiveTreatment({ cpf: "97000000004", whatsapp: DEFAULT_TEST_WHATSAPP });
    const externalMessageId = randomUUID();

    const res1 = await POST(makeRequest({ from: DEFAULT_TEST_WHATSAPP, text: "80", externalMessageId }));
    expect((await res1.json()).status).toBe("PROCESSED");

    const res2 = await POST(makeRequest({ from: DEFAULT_TEST_WHATSAPP, text: "80", externalMessageId }));
    expect((await res2.json()).status).toBe("ALREADY_PROCESSED");

    const { rows } = await adminPool.query(`SELECT count(*)::int AS c FROM conversation_messages WHERE sender = 'PATIENT'`);
    expect(rows[0].c).toBe(1);
  });
});

describe("Webhook WhatsApp — opt-out é respeitado", () => {
  it("paciente com opt-out não gera nenhuma mensagem processada", async () => {
    const { patient } = await createActiveTreatment({ cpf: "97000000005", whatsapp: DEFAULT_TEST_WHATSAPP });
    await adminPool.query(`INSERT INTO patient_communication_preferences (patient_id, opted_out) VALUES ($1, true)`, [
      patient.id,
    ]);
    const res = await POST(makeRequest({ from: DEFAULT_TEST_WHATSAPP, text: "80", externalMessageId: randomUUID() }));
    const body = await res.json();
    expect(body.status).toBe("OPTED_OUT");
    const { rows } = await adminPool.query(`SELECT count(*)::int AS c FROM conversation_messages`);
    expect(rows[0].c).toBe(0);
  });
});
