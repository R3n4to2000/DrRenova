import { withContext } from "@/lib/db";

/**
 * Healthcheck — usado por orquestradores de staging/produção para saber se
 * a aplicação está operacional. Nunca expõe segredo, nunca expõe dado de
 * paciente — só sinais operacionais agregados.
 */
export async function GET(): Promise<Response> {
  const checks: Record<string, boolean | string> = {};
  let healthy = true;

  try {
    const dbCheck = await withContext({ userId: null, role: "SYSTEM", correlationId: "healthcheck" }, (client) =>
      client.query("SELECT 1 AS ok").then((r) => r.rows[0].ok === 1)
    );
    checks.database = dbCheck;
  } catch {
    checks.database = false;
    healthy = false;
  }

  checks.authMode = process.env.AUTH_MODE === "supabase" ? "supabase" : "development";
  if (process.env.NODE_ENV === "production" && checks.authMode !== "supabase") {
    checks.authModeSafe = false;
    healthy = false;
  } else {
    checks.authModeSafe = true;
  }

  try {
    await withContext({ userId: null, role: "SYSTEM", correlationId: "healthcheck" }, (client) =>
      client.query("SELECT 1 FROM information_schema.tables WHERE table_name = 'outbox_events' LIMIT 1")
    );
    checks.migrationsApplied = true;
  } catch {
    checks.migrationsApplied = false;
    healthy = false;
  }

  return Response.json({ healthy, checks, timestamp: new Date().toISOString() }, { status: healthy ? 200 : 503 });
}
