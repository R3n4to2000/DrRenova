import "dotenv/config";
import { describe, it, expect, afterEach, vi } from "vitest";
import { encryptField, decryptField, getCiphertextKeyVersion } from "@/lib/encryption";

describe("Rotação de chave de criptografia (preparação — Item 8 Pilot Readiness)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("dado cifrado com a chave v1 continua decifrável depois que v2 se torna a corrente", () => {
    const plaintext = "12345678900";
    const oldCiphertext = encryptField(plaintext);
    expect(getCiphertextKeyVersion(oldCiphertext)).toBe(1);

    vi.stubEnv("FIELD_ENCRYPTION_KEY_V2", Buffer.from("b".repeat(32)).toString("base64"));
    vi.stubEnv("FIELD_ENCRYPTION_KEY_CURRENT_VERSION", "2");

    const newCiphertext = encryptField(plaintext);
    expect(getCiphertextKeyVersion(newCiphertext)).toBe(2);

    expect(decryptField(oldCiphertext)).toBe(plaintext);
    expect(decryptField(newCiphertext)).toBe(plaintext);
  });

  it("ciphertext sem prefixo de versão (dado legado) é tratado como v1 implicitamente", () => {
    const plaintext = "legado";
    const withPrefix = encryptField(plaintext);
    const withoutPrefix = withPrefix.replace(/^v1:/, "");
    expect(decryptField(withoutPrefix)).toBe(plaintext);
  });
});
