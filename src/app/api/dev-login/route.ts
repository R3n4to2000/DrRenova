import { withContext } from "@/lib/db";
import { signSessionToken } from "@/lib/session-token";
import { SESSION_COOKIE_NAME } from "@/lib/session-cookie";

/**
 * DEV-LOGIN — placeholder explícito enquanto o Supabase Auth real não está
 * integrado em produção (ver docs/PENDENCIAS.md, ADR-004/007 em
 * docs/DECISOES-TECNICAS.md).
 *
 * NUNCA aceita papel/identidade do cliente: busca o usuário real por e-mail
 * no banco e emite um token assinado com o papel que JÁ ESTÁ gravado para
 * aquele usuário — não é possível, mesmo neste mecanismo de desenvolvimento,
 * "se declarar" ADMIN sem que o registro no banco already exista como tal.
 *
 * Impossível fora de development: bloqueado tanto por `NODE_ENV==='production'`
 * quanto por `AUTH_MODE==='supabase'` — dupla trava independente.
 */
export async function POST(request: Request): Promise<Response> {
  const isProduction = process.env.NODE_ENV === "production";
  const authModeIsSupabase = process.env.AUTH_MODE === "supabase";
  if (isProduction || authModeIsSupabase) {
    return Response.json({ error: "dev-login desabilitado — AUTH_MODE=supabase ou ambiente de produção" }, { status: 403 });
  }

  const { email } = (await request.json()) as { email?: string };
  if (!email) return Response.json({ error: "email é obrigatório" }, { status: 400 });

  const user = await withContext({ userId: null, role: "SYSTEM", correlationId: "dev-login" }, async (client) => {
    const { rows } = await client.query<{ id: string; role: "PATIENT" | "DOCTOR" | "ADMIN" | "SUPPORT"; mfa_enabled: boolean; mfa_required: boolean }>(
      `SELECT id, role, mfa_enabled, mfa_required FROM users WHERE email = $1`,
      [email]
    );
    return rows[0] ?? null;
  });

  if (!user) return Response.json({ error: "usuário não encontrado" }, { status: 404 });
  if (user.mfa_required && !user.mfa_enabled) {
    return Response.json({ error: "MFA obrigatório e não habilitado para este usuário" }, { status: 403 });
  }

  const token = signSessionToken({ sub: user.id, role: user.role, mfaVerified: user.mfa_enabled });

  return new Response(JSON.stringify({ role: user.role }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": `${SESSION_COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=3600`,
    },
  });
}
