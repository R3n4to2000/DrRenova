import { randomUUID } from "node:crypto";
import { withContext, type AppContext, type Role } from "@/lib/db";
import { verifySessionToken, InvalidSessionTokenError } from "@/lib/session-token";
import { verifySupabaseAccessToken, InvalidSupabaseTokenError } from "@/lib/supabase-auth";

export const SINGLE_TENANT_ID = "plenno-medical";

export class UnauthorizedError extends Error {
  constructor(reason: string) {
    super(`Não autorizado: ${reason}`);
    this.name = "UnauthorizedError";
  }
}

export interface HttpResolvedContext extends AppContext {
  tenantId: string;
  patientId: string | null;
  doctorId: string | null;
  mfaVerified: boolean;
}

interface ResolvedIdentity {
  userId: string;
  role: Role;
  mfaVerified: boolean;
}

async function resolveBusinessIdentityFromAuthUserId(authUserId: string): Promise<ResolvedIdentity> {
  return withContext({ userId: null, role: "SYSTEM", correlationId: "context-resolution" }, async (client) => {
    const { rows } = await client.query<{ id: string; role: Role; mfa_enabled: boolean; mfa_required: boolean }>(
      `SELECT id, role, mfa_enabled, mfa_required FROM users WHERE auth_user_id = $1`,
      [authUserId]
    );
    if (rows.length === 0) {
      throw new UnauthorizedError("identidade autenticada não corresponde a um usuário conhecido da aplicação");
    }
    const user = rows[0];
    if (user.mfa_required && !user.mfa_enabled) {
      throw new UnauthorizedError("MFA obrigatório e não habilitado para este usuário");
    }
    return { userId: user.id, role: user.role, mfaVerified: user.mfa_enabled };
  });
}

async function resolvePatientId(userId: string): Promise<string | null> {
  return withContext({ userId: null, role: "SYSTEM", correlationId: "context-resolution" }, async (client) => {
    const { rows } = await client.query<{ id: string }>(`SELECT id FROM patients WHERE user_id = $1`, [userId]);
    return rows[0]?.id ?? null;
  });
}

async function resolveDoctorId(userId: string): Promise<string | null> {
  return withContext({ userId: null, role: "SYSTEM", correlationId: "context-resolution" }, async (client) => {
    const { rows } = await client.query<{ id: string }>(`SELECT id FROM doctors WHERE user_id = $1`, [userId]);
    return rows[0]?.id ?? null;
  });
}

function getAuthMode(): "supabase" | "development" {
  const mode = process.env.AUTH_MODE;
  if (process.env.NODE_ENV === "production" && mode !== "supabase") {
    return "supabase";
  }
  return mode === "supabase" ? "supabase" : "development";
}

export async function resolveAppContext(headers: Headers): Promise<HttpResolvedContext> {
  const authHeader = headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new UnauthorizedError("cabeçalho Authorization ausente ou malformado");
  }
  const token = authHeader.slice("Bearer ".length).trim();
  const authMode = getAuthMode();

  let identity: ResolvedIdentity;

  if (authMode === "supabase") {
    let supabasePayload;
    try {
      supabasePayload = verifySupabaseAccessToken(token);
    } catch (err) {
      if (err instanceof InvalidSupabaseTokenError) throw new UnauthorizedError(err.message);
      throw err;
    }
    identity = await resolveBusinessIdentityFromAuthUserId(supabasePayload.sub);
  } else {
    let devPayload;
    try {
      devPayload = verifySessionToken(token);
    } catch (err) {
      if (err instanceof InvalidSessionTokenError) throw new UnauthorizedError(err.message);
      throw err;
    }
    identity = { userId: devPayload.sub, role: devPayload.role, mfaVerified: devPayload.mfaVerified };
  }

  const [patientId, doctorId] = await Promise.all([
    identity.role === "PATIENT" ? resolvePatientId(identity.userId) : Promise.resolve(null),
    identity.role === "DOCTOR" ? resolveDoctorId(identity.userId) : Promise.resolve(null),
  ]);

  const suggestedCorrelationId = headers.get("x-correlation-id");
  const correlationId =
    suggestedCorrelationId && /^[\w-]{1,100}$/.test(suggestedCorrelationId) ? suggestedCorrelationId : randomUUID();

  return {
    userId: identity.userId,
    role: identity.role,
    correlationId,
    origin: "http",
    tenantId: SINGLE_TENANT_ID,
    patientId,
    doctorId,
    mfaVerified: identity.mfaVerified,
  };
}
