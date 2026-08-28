import { describe, it, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { resetTestData, seedBaseConfig, adminPool } from "../setup";
import { asSystem, createTestPatient } from "../helpers";
import { withContext } from "@/lib/db";
import { identityService } from "@/modules/identity/application/identity.service";
import { createPatientCommand } from "@/modules/patient/application/patient.commands";
import { runAuditedCommand } from "@/lib/audited-command";
import { patientService } from "@/modules/patient/application/patient.service";
import { ForbiddenAuditMetadataError, sanitizeAuditMetadata } from "@/lib/audit-sanitizer";

beforeEach(async () => {
  await resetTestData();
  await seedBaseConfig();
});

describe("Regressão 1 — mutação crítica gera AuditLog estruturalmente", () => {
  it("criar um Patient via Command gera um AuditLog correspondente na mesma operação", async () => {
    const authUserId = randomUUID();
    const user = await withContext(asSystem(), (client) =>
      identityService.createUser(client, { authUserId, email: `p_${authUserId}@test.dev`, role: "PATIENT" })
    );

    const patient = await createPatientCommand(asSystem(), {
      userId: user.id,
      fullName: "Paciente Auditado",
      cpf: "40404040404",
      birthDate: "1990-01-01",
      whatsapp: "+5531988887777",
    });

    const { rows } = await adminPool.query(
      `SELECT * FROM audit_logs WHERE entity_type='Patient' AND entity_id=$1`,
      [patient.id]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe("PATIENT_CREATED");
    expect(rows[0].result).toBe("SUCCESS");
    // metadata nunca contém cpf/whatsapp em claro
    expect(JSON.stringify(rows[0].metadata)).not.toContain("40404040404");
  });
});

describe("Regressão 2 — falha de auditoria não deixa mutação persistida silenciosamente", () => {
  it("se a metadata do audit for rejeitada, a mutação crítica é desfeita (mesma transação)", async () => {
    const authUserId = randomUUID();
    const user = await withContext(asSystem(), (client) =>
      identityService.createUser(client, { authUserId, email: `p2_${authUserId}@test.dev`, role: "PATIENT" })
    );

    // comando "malformado" deliberadamente: metadata inclui uma chave proibida (cpf)
    await expect(
      runAuditedCommand(asSystem(), { action: "PATIENT_CREATED", entityType: "Patient" }, async (client) => {
        const patient = await patientService.createPatient(client, {
          userId: user.id,
          fullName: "Paciente Que Não Deveria Persistir",
          cpf: "50505050505",
          birthDate: "1990-01-01",
          whatsapp: "+5531900001111",
        });
        return { result: patient, entityId: patient.id, metadata: { cpf: "50505050505" } };
      })
    ).rejects.toThrow(ForbiddenAuditMetadataError);

    // a mutação NÃO deve ter sido persistida — toda a transação foi revertida
    const { rows } = await adminPool.query(`SELECT * FROM patients WHERE user_id = $1`, [user.id]);
    expect(rows).toHaveLength(0);

    const { rows: auditRows } = await adminPool.query(
      `SELECT * FROM audit_logs WHERE action='PATIENT_CREATED' AND entity_id IN (SELECT id::text FROM patients WHERE user_id=$1)`,
      [user.id]
    );
    expect(auditRows).toHaveLength(0);
  });
});

describe("Regressão 3 — metadata sensível é bloqueada pelo sanitizador central", () => {
  it("rejeita chaves proibidas (cpf, whatsapp, token, password, etc.)", () => {
    expect(() => sanitizeAuditMetadata({ cpf: "12345678900" })).toThrow(ForbiddenAuditMetadataError);
    expect(() => sanitizeAuditMetadata({ whatsapp: "+5531999998888" })).toThrow(ForbiddenAuditMetadataError);
    expect(() => sanitizeAuditMetadata({ token: "abc" })).toThrow(ForbiddenAuditMetadataError);
    expect(() => sanitizeAuditMetadata({ password: "x" })).toThrow(ForbiddenAuditMetadataError);
    expect(() => sanitizeAuditMetadata({ clinicalNote: "paciente relatou..." })).toThrow(ForbiddenAuditMetadataError);
  });

  it("rejeita valores que PARECEM CPF/telefone/token mesmo com chave inocente", () => {
    expect(() => sanitizeAuditMetadata({ someField: "123.456.789-00" })).toThrow(ForbiddenAuditMetadataError);
    expect(() => sanitizeAuditMetadata({ contact: "+55 31 99999-8888" })).toThrow(ForbiddenAuditMetadataError);
    expect(() =>
      sanitizeAuditMetadata({ ref: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dGhpc2lzYWZha2VzaWc" })
    ).toThrow(ForbiddenAuditMetadataError);
  });

  it("rejeita objetos/arrays aninhados", () => {
    expect(() => sanitizeAuditMetadata({ nested: { a: 1 } })).toThrow(ForbiddenAuditMetadataError);
    expect(() => sanitizeAuditMetadata({ list: [1, 2, 3] })).toThrow(ForbiddenAuditMetadataError);
  });

  it("aceita metadata segura (ids, status, valores curtos)", () => {
    expect(() =>
      sanitizeAuditMetadata({ patientId: "abc-123", planKey: "ESSENCIAL", outcome: "APPROVED", count: 3 })
    ).not.toThrow();
  });
});
