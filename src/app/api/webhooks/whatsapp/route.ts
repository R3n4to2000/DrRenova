import { withContext } from "@/lib/db";
import { camillaOrchestrator } from "@/modules/camilla/application/camilla-orchestrator.service";
import { patientService } from "@/modules/patient/application/patient.service";

/**
 * Webhook inbound de WhatsApp — STAGING no envio (não há credencial de
 * provedor real), mas a RESOLUÇÃO DE IDENTIDADE aqui é real: o paciente é
 * sempre resolvido pelo HASH do número (`whatsapp_hash`, HMAC-SHA256,
 * mesmo padrão do `cpf_hash`) — o payload NUNCA carrega nem é autorizado a
 * carregar um `patientId` direto.
 *
 * Estados tratados explicitamente:
 * - CONHECIDO: paciente resolvido, segue o pipeline normal da Camilla.
 * - DESCONHECIDO: nenhum paciente com este número — não processa.
 * - OPT-OUT: paciente conhecido mas optou por não receber comunicação.
 * - CONFLITO: estruturalmente impossível (índice único em whatsapp_hash).
 * - MUDANÇA DE NÚMERO: fora do escopo — exigiria fluxo de verificação de
 *   propriedade (ver docs/PENDENCIAS.md); tratado como DESCONHECIDO.
 */
export async function POST(request: Request): Promise<Response> {
  const body = (await request.json()) as { from: string; text: string; externalMessageId: string };
  if (!body.from || !body.text || !body.externalMessageId) {
    return Response.json({ error: "payload inválido" }, { status: 400 });
  }

  const ctx = { userId: null, role: "SYSTEM" as const, correlationId: `whatsapp-webhook-${body.externalMessageId}` };

  const result = await withContext(ctx, async (client) => {
    const { rows: claimed } = await client.query(
      `INSERT INTO idempotency_keys (key, scope) VALUES ($1, 'whatsapp.webhook') ON CONFLICT (key) DO NOTHING RETURNING key`,
      [body.externalMessageId]
    );
    if (claimed.length === 0) {
      return { status: "ALREADY_PROCESSED" as const };
    }

    const patient = await patientService.findByWhatsapp(client, body.from);
    if (!patient) {
      return { status: "UNKNOWN_SENDER" as const };
    }

    const { rows: prefs } = await client.query<{ opted_out: boolean }>(
      `SELECT opted_out FROM patient_communication_preferences WHERE patient_id = $1`,
      [patient.id]
    );
    if (prefs[0]?.opted_out) {
      return { status: "OPTED_OUT" as const };
    }

    const { rows: treatmentRows } = await client.query<{ id: string }>(
      `SELECT id FROM treatments WHERE patient_id = $1 AND status = 'ACTIVE' ORDER BY created_at DESC LIMIT 1`,
      [patient.id]
    );
    if (treatmentRows.length === 0) {
      return { status: "NO_ACTIVE_TREATMENT" as const };
    }

    const outcome = await camillaOrchestrator.handleInboundMessage(client, {
      patientId: patient.id,
      treatmentId: treatmentRows[0].id,
      rawText: body.text,
    });

    await client.query(`UPDATE idempotency_keys SET result_ref = $2 WHERE key = $1`, [body.externalMessageId, "processed"]);

    return { status: "PROCESSED" as const, escalated: outcome.escalated, intent: outcome.intent };
  });

  return Response.json(result, { status: 200 });
}
