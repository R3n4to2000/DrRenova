import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import { resetTestData, seedBaseConfig, adminPool } from "../setup";
import { createTestPatient, mintTestSessionToken } from "../helpers";
import { resolveAppContext, UnauthorizedError } from "@/lib/http-context";
import { verifySupabaseAccessToken, InvalidSupabaseTokenError } from "@/lib/supabase-auth";
import { identityService } from "@/modules/identity/application/identity.service";
import { withContext } from "@/lib/db";

const SUPABASE_SECRET = process.env.SUPABASE_JWT_SECRET as string;

function mintFakeSupabaseToken(sub: string, overrides?: Partial<{ aud: string; role: string; exp: number }>) {
  return jwt.sign(
    { sub, aud: overrides?.aud ?? "authenticated", role: overrides?.role ?? "authenticated", email: "x@y.com" },
    SUPABASE_SECRET,
    { expiresIn: overrides?.exp ?? 3600, algorithm: "HS256" }
  );
}

beforeEach(async () => {
  await resetTestData();
  await seedBaseConfig();
});

describe("Supabase Auth real — verificação offline de assinatura (não staging)", () => {
  it("verifySupabaseAccessToken aceita um token com a assinatura correta e claims válidas", async () => {
    const token = mintFakeSupabaseToken(randomUUID());
    const payload = verifySupabaseAccessToken(token);
    expect(payload.aud).toBe("authenticated");
  });

  it("rejeita token assinado com segredo diferente (não é do projeto)", () => {
    const forged = jwt.sign({ sub: "x", aud: "authenticated", role: "authenticated" }, "segredo-errado", {
      expiresIn: 3600,
      algorithm: "HS256",
    });
    expect(() => verifySupabaseAccessToken(forged)).toThrow(InvalidSupabaseTokenError);
  });

  it("rejeita token com aud diferente de 'authenticated'", () => {
    const token = mintFakeSupabaseToken("x", { aud: "anon" });
    expect(() => verifySupabaseAccessToken(token)).toThrow(InvalidSupabaseTokenError);
  });

  it("rejeita token expirado", () => {
    const token = mintFakeSupabaseToken("x", { exp: -10 });
    expect(() => verifySupabaseAccessToken(token)).toThrow(InvalidSupabaseTokenError);
  });
});

describe("resolveAppContext em AUTH_MODE=supabase", () => {
  const originalMode = process.env.AUTH_MODE;
  beforeEach(() => {
    process.env.AUTH_MODE = "supabase";
  });
  afterEach(() => {
    process.env.AUTH_MODE = originalMode;
  });

  it("resolve papel/patientId a partir do authUserId real do usuário no banco", async () => {
    const { user, patient } = await createTestPatient({ cpf: "96000000002" });
    const { rows } = await adminPool.query(`SELECT auth_user_id FROM users WHERE id = $1`, [user.id]);
    const token = mintFakeSupabaseToken(rows[0].auth_user_id);

    const ctx = await resolveAppContext(new Headers({ authorization: `Bearer ${token}` }));
    expect(ctx.role).toBe("PATIENT");
    expect(ctx.patientId).toBe(patient.id);
  });

  it("médico sem MFA habilitado é rejeitado mesmo com token Supabase válido", async () => {
    const authUserId = randomUUID();
    await withContext({ userId: null, role: "SYSTEM", correlationId: "test" }, (client) =>
      identityService.createUser(client, { authUserId, email: `semmfa_${authUserId}@test.dev`, role: "DOCTOR", mfaEnabled: false })
    );

    const token = mintFakeSupabaseToken(authUserId);
    await expect(resolveAppContext(new Headers({ authorization: `Bearer ${token}` }))).rejects.toThrow(UnauthorizedError);
  });

  it("um token de dev-login é REJEITADO quando AUTH_MODE=supabase", async () => {
    const { user } = await createTestPatient({ cpf: "96000000003" });
    const devToken = mintTestSessionToken({ userId: user.id, role: "PATIENT" });

    await expect(resolveAppContext(new Headers({ authorization: `Bearer ${devToken}` }))).rejects.toThrow(UnauthorizedError);
  });

  it("authUserId desconhecido (não existe na tabela users) é rejeitado", async () => {
    const token = mintFakeSupabaseToken(randomUUID());
    await expect(resolveAppContext(new Headers({ authorization: `Bearer ${token}` }))).rejects.toThrow(UnauthorizedError);
  });
});

describe("dev-login é impossível fora de development", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("retorna 403 quando AUTH_MODE=supabase, mesmo em NODE_ENV=development", async () => {
    vi.stubEnv("AUTH_MODE", "supabase");
    const { POST } = await import("@/app/api/dev-login/route");
    const res = await POST(
      new Request("http://localhost/api/dev-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "qualquer@teste.dev" }),
      })
    );
    expect(res.status).toBe(403);
  });

  it("retorna 403 quando NODE_ENV=production, mesmo sem AUTH_MODE definido", async () => {
    vi.stubEnv("AUTH_MODE", "");
    vi.stubEnv("NODE_ENV", "production");
    const { POST } = await import("@/app/api/dev-login/route");
    const res = await POST(
      new Request("http://localhost/api/dev-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "qualquer@teste.dev" }),
      })
    );
    expect(res.status).toBe(403);
  });
});
