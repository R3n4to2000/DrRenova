/**
 * Sanitização central de AuditLog.metadata.
 *
 * Estratégia em duas camadas (defesa em profundidade):
 * 1. ALLOWLIST estrutural: só aceita chaves cujo nome bate um padrão seguro
 *    E cujo valor é escalar (string curta, number, boolean ou null) — nunca
 *    objetos/arrays aninhados, para não permitir "esconder" dado sensível
 *    dentro de uma estrutura mais profunda.
 * 2. BLACKLIST de nomes de chave conhecidos como sensíveis, mesmo que o
 *    valor pareça inofensivo.
 * 3. Checagem de PADRÃO DE VALOR: mesmo com chave "inocente", rejeita
 *    valores que parecem CPF, telefone, JWT/token ou texto longo (proxy
 *    para conteúdo clínico/livre).
 *
 * É chamada INCONDICIONALMENTE por AuditService.record — não é opt-in.
 */

export class ForbiddenAuditMetadataError extends Error {
  constructor(reason: string) {
    super(`Metadata de auditoria rejeitada: ${reason}`);
    this.name = "ForbiddenAuditMetadataError";
  }
}

const FORBIDDEN_KEY_NAMES = new Set(
  [
    "cpf",
    "whatsapp",
    "phone",
    "telefone",
    "password",
    "senha",
    "token",
    "secret",
    "authorization",
    "clinicalnote",
    "clinical_note",
    "content",
    "rawinput",
    "raw_input",
    "prontuario",
    "diagnostico",
    "apikey",
    "api_key",
  ].map((k) => k.toLowerCase())
);

const SAFE_KEY_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/;

// CPF: 11 dígitos seguidos, com ou sem máscara
const CPF_PATTERN = /^\d{3}\.?\d{3}\.?\d{3}-?\d{2}$/;
// Telefone BR/E.164-like: 10+ dígitos, opcionalmente com +/espacos/traços
const PHONE_PATTERN = /^\+?[\d\s().-]{10,}$/;
// JWT-like: três segmentos base64url separados por ponto
const JWT_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
// UUID padrão (v1-v5) — sempre tratado como id seguro, nunca como "token longo"
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Token/segredo longo aleatório (heurística: blob alfanumérico contíguo >= 32 chars,
// SEM hífen — UUIDs têm hífen e são tratados à parte acima como seguros)
const LONG_TOKEN_PATTERN = /^[A-Za-z0-9+/=_]{32,}$/;

const MAX_STRING_LENGTH = 200; // valores mais longos que isso são tratados como possível conteúdo livre/clínico

function isSuspiciousStringValue(value: string): string | null {
  const trimmed = value.trim();
  if (UUID_PATTERN.test(trimmed)) return null; // id legítimo — nunca suspeito
  if (CPF_PATTERN.test(trimmed)) return "valor parece CPF";
  if (PHONE_PATTERN.test(trimmed) && value.replace(/\D/g, "").length >= 10) return "valor parece telefone";
  if (JWT_PATTERN.test(trimmed)) return "valor parece um token JWT";
  if (LONG_TOKEN_PATTERN.test(trimmed)) return "valor parece um token/segredo longo";
  if (value.length > MAX_STRING_LENGTH) return `valor excede ${MAX_STRING_LENGTH} caracteres (possível conteúdo livre/clínico)`;
  return null;
}

export function sanitizeAuditMetadata(
  metadata: Record<string, unknown> | undefined | null
): Record<string, unknown> | undefined {
  if (metadata === undefined || metadata === null) return undefined;

  for (const [key, value] of Object.entries(metadata)) {
    const lowerKey = key.toLowerCase();

    if (!SAFE_KEY_PATTERN.test(key)) {
      throw new ForbiddenAuditMetadataError(`chave "${key}" não bate o padrão permitido`);
    }
    if (FORBIDDEN_KEY_NAMES.has(lowerKey)) {
      throw new ForbiddenAuditMetadataError(`chave "${key}" está na lista de campos proibidos`);
    }
    if (value !== null && typeof value === "object") {
      throw new ForbiddenAuditMetadataError(`chave "${key}" contém objeto/array aninhado — metadata só aceita valores escalares`);
    }
    if (typeof value === "string") {
      const suspicious = isSuspiciousStringValue(value);
      if (suspicious) {
        throw new ForbiddenAuditMetadataError(`chave "${key}": ${suspicious}`);
      }
    }
  }

  return metadata;
}
