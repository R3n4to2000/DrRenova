import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

/**
 * Camada de criptografia de aplicação para campos sensíveis (CPF, WhatsApp).
 * AES-256-GCM para o valor reversível; HMAC-SHA256 para o hash
 * determinístico usado em unicidade/busca (nunca reversível).
 *
 * VERSIONAMENTO DE CHAVE (preparação para rotação — Pilot Readiness item 8):
 * o ciphertext carrega um prefixo de versão (`v{N}:`) indicando qual chave
 * foi usada para cifrar. Isso permite introduzir uma nova chave
 * (`FIELD_ENCRYPTION_KEY_V2`) sem invalidar dados já cifrados com a
 * anterior (`FIELD_ENCRYPTION_KEY_V1`) — a decifragem sempre lê a versão
 * correta pelo prefixo. `FIELD_ENCRYPTION_KEY_CURRENT_VERSION` decide qual
 * versão é usada para CIFRAR dados novos.
 *
 * LIMITAÇÃO DOCUMENTADA: isto prepara o mecanismo de rotação (múltiplas
 * chaves versionadas, script de re-criptografia em lote —
 * `scripts/rotate-encryption-key.mjs`), mas as chaves em si continuam
 * vindo de variáveis de ambiente, não de um KMS gerenciado (AWS
 * KMS/GCP KMS/Vault) — isso exige um provedor de nuvem contratado e
 * credenciado, que não existe neste ambiente. Ver docs/PENDENCIAS.md:
 * "chaves fora de KMS" continua um BLOCKER real para dados de produção,
 * mesmo com o versionamento pronto.
 */

const DEFAULT_KEY_VERSION = 1;

function getKeyForVersion(version: number): Buffer {
  const raw = process.env[`FIELD_ENCRYPTION_KEY_V${version}`] ?? (version === 1 ? process.env.FIELD_ENCRYPTION_KEY : undefined);
  if (!raw) throw new Error(`FIELD_ENCRYPTION_KEY_V${version} (ou FIELD_ENCRYPTION_KEY para v1) não configurada`);
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error(`Chave de criptografia v${version} precisa ter 32 bytes (base64)`);
  return key;
}

function getCurrentKeyVersion(): number {
  const raw = process.env.FIELD_ENCRYPTION_KEY_CURRENT_VERSION;
  return raw ? Number(raw) : DEFAULT_KEY_VERSION;
}

function getHmacSecret(): string {
  const secret = process.env.FIELD_HASH_SECRET;
  if (!secret) throw new Error("FIELD_HASH_SECRET não configurada");
  return secret;
}

export function encryptField(plaintext: string): string {
  const version = getCurrentKeyVersion();
  const key = getKeyForVersion(version);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const body = Buffer.concat([iv, authTag, encrypted]).toString("base64");
  return `v${version}:${body}`;
}

export function decryptField(payload: string): string {
  // Compatibilidade retroativa: ciphertext sem prefixo de versão (gerado
  // antes deste mecanismo) é tratado implicitamente como v1.
  const match = payload.match(/^v(\d+):(.+)$/);
  const version = match ? Number(match[1]) : 1;
  const body = match ? match[2] : payload;

  const key = getKeyForVersion(version);
  const raw = Buffer.from(body, "base64");
  const iv = raw.subarray(0, 12);
  const authTag = raw.subarray(12, 28);
  const encrypted = raw.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

/** Extrai a versão de chave usada em um ciphertext, sem decifrar — útil para auditoria de rotação. */
export function getCiphertextKeyVersion(payload: string): number {
  const match = payload.match(/^v(\d+):/);
  return match ? Number(match[1]) : 1;
}

/** Hash determinístico — usado só para unicidade/busca, nunca para exibir. */
export function hashField(plaintext: string): string {
  return createHmac("sha256", getHmacSecret()).update(plaintext).digest("hex");
}

/** Últimos 4 dígitos, para exibição mascarada em interfaces administrativas. */
export function last4(value: string): string {
  const digits = value.replace(/\D/g, "");
  return digits.slice(-4);
}
