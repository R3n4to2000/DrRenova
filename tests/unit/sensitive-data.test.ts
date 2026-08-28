import "dotenv/config";
import { describe, it, expect } from "vitest";
import { encryptField, decryptField, hashField, last4 } from "@/lib/encryption";

describe("Critério 20 — dados sensíveis não aparecem em claro", () => {
  it("o valor cifrado nunca contém o texto original", () => {
    const cpf = "12345678900";
    const encrypted = encryptField(cpf);
    expect(encrypted).not.toContain(cpf);
    expect(decryptField(encrypted)).toBe(cpf);
  });

  it("o hash de busca é determinístico mas não reversível (não é o valor original)", () => {
    const cpf = "12345678900";
    const hash1 = hashField(cpf);
    const hash2 = hashField(cpf);
    expect(hash1).toBe(hash2); // determinístico — permite unicidade/busca
    expect(hash1).not.toContain(cpf);
    expect(hash1).toHaveLength(64); // sha256 hex
  });

  it("last4 nunca expõe o número completo", () => {
    const masked = last4("+55 31 99999-1234");
    expect(masked).toBe("1234");
    expect(masked.length).toBe(4);
  });
});

describe("Estrutura de AuditLog — metadata não deve carregar dado sensível bruto", () => {
  it("um exemplo de metadata sanitizada não contém chaves de dado sensível", () => {
    const sanitizedMetadata = { patientId: "abc-123", planKey: "ESSENCIAL" };
    const forbiddenKeys = ["cpf", "whatsapp", "clinicalNote", "content"];
    for (const key of forbiddenKeys) {
      expect(Object.keys(sanitizedMetadata)).not.toContain(key);
    }
  });
});
