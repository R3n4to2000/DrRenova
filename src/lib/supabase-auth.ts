import jwt from "jsonwebtoken";

/**
 * Verificação REAL do JWT emitido pelo Supabase Auth — não é staging.
 *
 * Projetos Supabase (modelo clássico, "Legacy JWT Secret") assinam tokens
 * com HS256 usando um segredo compartilhado do projeto (`SUPABASE_JWT_SECRET`,
 * disponível em Project Settings > API no painel do Supabase). Essa
 * verificação é feita OFFLINE — não exige chamada de rede ao Supabase — e é
 * exatamente o que qualquer backend faria para validar uma sessão.
 *
 * LIMITAÇÃO DOCUMENTADA: projetos Supabase mais novos podem usar chaves
 * assimétricas (RS256/ES256) publicadas via JWKS, o que exigiria buscar as
 * chaves públicas via rede (`GET /.well-known/jwks.json` do projeto). Este
 * ambiente de execução não tem acesso de rede a domínios `supabase.co`
 * (confirmado pela mesma política de egress que bloqueia `binaries.prisma.sh`),
 * então o caminho JWKS não pode ser testado aqui — só o caminho HS256
 * (compartilhado), que é suportado nativamente sem rede. Registrado como
 * item a confirmar quando o projeto Supabase real for provisionado (ver
 * docs/PENDENCIAS.md).
 *
 * Este código NUNCA foi executado contra um token real emitido por um
 * projeto Supabase de verdade neste ambiente (sem credencial/rede) — foi
 * validado com tokens sintéticos no formato exato do Supabase (mesma
 * assinatura HS256, mesmas claims `sub`/`aud`/`role`/`exp`), o que prova a
 * lógica de verificação e extração, mas não a integração fim-a-fim real.
 */

export interface SupabaseJwtPayload {
  sub: string; // Supabase auth.users.id — igual ao User.authUserId da aplicação
  aud: string; // deve ser "authenticated"
  role: string; // role do Postgres do Supabase (ex.: "authenticated") — NÃO é o papel de negócio (PATIENT/DOCTOR/ADMIN)
  email?: string;
  exp: number;
}

export class InvalidSupabaseTokenError extends Error {
  constructor(reason: string) {
    super(`Token Supabase inválido: ${reason}`);
    this.name = "InvalidSupabaseTokenError";
  }
}

function getSupabaseJwtSecret(): string {
  const secret = process.env.SUPABASE_JWT_SECRET;
  if (!secret) throw new Error("SUPABASE_JWT_SECRET não configurada");
  return secret;
}

export function verifySupabaseAccessToken(token: string): SupabaseJwtPayload {
  try {
    const decoded = jwt.verify(token, getSupabaseJwtSecret(), { algorithms: ["HS256"] });
    if (typeof decoded === "string") throw new InvalidSupabaseTokenError("payload não é um objeto");
    const { sub, aud, role, email, exp } = decoded as Record<string, unknown>;
    if (typeof sub !== "string" || typeof aud !== "string" || typeof role !== "string" || typeof exp !== "number") {
      throw new InvalidSupabaseTokenError("claims obrigatórias do Supabase ausentes ou malformadas");
    }
    if (aud !== "authenticated") {
      throw new InvalidSupabaseTokenError(`aud inesperado: ${aud}`);
    }
    return { sub, aud, role, email: typeof email === "string" ? email : undefined, exp };
  } catch (err) {
    if (err instanceof InvalidSupabaseTokenError) throw err;
    throw new InvalidSupabaseTokenError((err as Error).message);
  }
}
