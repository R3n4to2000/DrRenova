import jwt from "jsonwebtoken";

/**
 * Mecanismo de sessão assinada — PLACEHOLDER explícito enquanto o Supabase
 * Auth real não está conectado (ver docs/PENDENCIAS.md).
 *
 * Quando a integração real com Supabase Auth acontecer, este arquivo é
 * substituído por verificação do JWT emitido pelo Supabase (mesma forma —
 * assinatura + expiração — trocando apenas a chave/emissor verificado). O
 * contrato posterior (claims verificadas → AppContext) não muda.
 *
 * IMPORTANTE: nada aqui aceita papel/identidade vindos de headers HTTP
 * arbitrários. A única fonte de verdade é a assinatura criptográfica do
 * token, verificada com o segredo do servidor.
 */

export interface SessionPayload {
  sub: string; // User.id (não authUserId)
  role: "PATIENT" | "DOCTOR" | "ADMIN" | "SUPPORT";
  mfaVerified: boolean;
}

export class InvalidSessionTokenError extends Error {
  constructor(reason: string) {
    super(`Token de sessão inválido: ${reason}`);
    this.name = "InvalidSessionTokenError";
  }
}

function getSecret(): string {
  const secret = process.env.SESSION_TOKEN_SECRET;
  if (!secret) throw new Error("SESSION_TOKEN_SECRET não configurada");
  return secret;
}

/** Emitido apenas pelo processo de login (fora do escopo desta fatia — ver PENDENCIAS.md). */
export function signSessionToken(payload: SessionPayload, expiresInSeconds = 3600): string {
  return jwt.sign(payload, getSecret(), { expiresIn: expiresInSeconds, algorithm: "HS256" });
}

/** Única forma de obter um SessionPayload confiável — nunca aceitar claims não verificadas. */
export function verifySessionToken(token: string): SessionPayload {
  try {
    const decoded = jwt.verify(token, getSecret(), { algorithms: ["HS256"] });
    if (typeof decoded === "string") throw new InvalidSessionTokenError("payload não é um objeto");
    const { sub, role, mfaVerified } = decoded as Record<string, unknown>;
    if (typeof sub !== "string" || typeof role !== "string" || typeof mfaVerified !== "boolean") {
      throw new InvalidSessionTokenError("claims obrigatórias ausentes ou malformadas");
    }
    if (!["PATIENT", "DOCTOR", "ADMIN", "SUPPORT"].includes(role)) {
      throw new InvalidSessionTokenError(`papel desconhecido: ${role}`);
    }
    return { sub, role: role as SessionPayload["role"], mfaVerified };
  } catch (err) {
    if (err instanceof InvalidSessionTokenError) throw err;
    throw new InvalidSessionTokenError((err as Error).message);
  }
}
