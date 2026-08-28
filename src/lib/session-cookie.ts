import { cookies } from "next/headers";
import { resolveAppContext, type HttpResolvedContext } from "@/lib/http-context";

export const SESSION_COOKIE_NAME = "renovamed_session";

/**
 * Adapta o mecanismo de sessão (Bearer token) para o modelo de cookies do
 * App Router em Server Components/Actions. Reaproveita INTEGRALMENTE
 * `resolveAppContext` — a verificação de assinatura é a mesma; só a
 * origem do token (cookie em vez de header Authorization) muda.
 */
export async function getServerAppContext(): Promise<HttpResolvedContext | null> {
  const cookieStore = cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  try {
    return await resolveAppContext(new Headers({ authorization: `Bearer ${token}` }));
  } catch {
    return null;
  }
}
