import { redirect } from "next/navigation";
import { getServerAppContext } from "@/lib/session-cookie";
import { withContext } from "@/lib/db";
import { engagementCoverageService } from "@/modules/camilla/application/engagement-coverage.service";

export default async function AdminCamillaPage() {
  const ctx = await getServerAppContext();
  if (!ctx || ctx.role !== "ADMIN") redirect("/dev-login");

  const stats = await withContext(ctx, async (client) => {
    const q = (sql: string) => client.query<{ c: string }>(sql).then((r) => Number(r.rows[0].c));
    const [patientsContacted, checkinsConcluded, unresponsive, escalations, optOuts, aiExecutions] = await Promise.all([
      q(`SELECT count(DISTINCT c.patient_id)::text AS c FROM conversations c JOIN conversation_messages cm ON cm.conversation_id = c.id WHERE cm.sender='CAMILLA'`),
      q(`SELECT count(*)::text AS c FROM check_ins WHERE status = 'ANSWERED'`),
      q(`SELECT count(*)::text AS c FROM check_ins WHERE status = 'EXPIRED'`),
      q(`SELECT count(*)::text AS c FROM intercorrencias WHERE origin = 'CAMILLA'`),
      q(`SELECT count(*)::text AS c FROM patient_communication_preferences WHERE opted_out = true`),
      q(`SELECT count(*)::text AS c FROM ai_executions`),
    ]);

    const { rows: responseRate } = await client.query<{ sent: string; answered: string }>(`
      SELECT
        (SELECT count(*)::text FROM check_ins WHERE status IN ('ANSWERED','EXPIRED')) AS sent,
        (SELECT count(*)::text FROM check_ins WHERE status = 'ANSWERED') AS answered
    `);
    const sent = Number(responseRate[0].sent);
    const answered = Number(responseRate[0].answered);
    const responsePct = sent === 0 ? 0 : Math.round((answered / sent) * 1000) / 10;

    const engagement = await engagementCoverageService.computeD30D60D90(client);

    return { patientsContacted, checkinsConcluded, unresponsive, escalations, optOuts, aiExecutions, responsePct, engagement };
  });

  return (
    <main style={{ maxWidth: 720, margin: "40px auto", fontFamily: "sans-serif" }}>
      <p>
        <a href="/admin">← Visão Geral</a>
      </p>
      <h1>Camilla — Assistente de Cuidado</h1>
      <p style={{ color: "#a00", fontSize: 12 }}>
        Classificação de intenção e estruturação de resposta são STAGING (heurística por palavra-chave) — não há LLM real
        conectado neste ambiente.
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
        <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12 }}>
          <div style={{ fontSize: 22, fontWeight: "bold" }}>{stats.patientsContacted}</div>
          <div style={{ fontSize: 12, color: "#666" }}>Pacientes contatados</div>
        </div>
        <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12 }}>
          <div style={{ fontSize: 22, fontWeight: "bold" }}>{stats.responsePct}%</div>
          <div style={{ fontSize: 12, color: "#666" }}>Taxa de resposta</div>
        </div>
        <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12 }}>
          <div style={{ fontSize: 22, fontWeight: "bold" }}>{stats.checkinsConcluded}</div>
          <div style={{ fontSize: 12, color: "#666" }}>Check-ins concluídos</div>
        </div>
        <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12 }}>
          <div style={{ fontSize: 22, fontWeight: "bold" }}>{stats.unresponsive}</div>
          <div style={{ fontSize: 12, color: "#666" }}>Sem resposta</div>
        </div>
        <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12 }}>
          <div style={{ fontSize: 22, fontWeight: "bold" }}>{stats.escalations}</div>
          <div style={{ fontSize: 12, color: "#666" }}>Escalonamentos</div>
        </div>
        <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12 }}>
          <div style={{ fontSize: 22, fontWeight: "bold" }}>{stats.optOuts}</div>
          <div style={{ fontSize: 12, color: "#666" }}>Opt-out</div>
        </div>
      </div>
      <h2 style={{ marginTop: 24 }}>Engagement Coverage</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
        <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12 }}>
          <div style={{ fontSize: 22, fontWeight: "bold" }}>{stats.engagement.d30}%</div>
          <div style={{ fontSize: 12, color: "#666" }}>D30</div>
        </div>
        <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12 }}>
          <div style={{ fontSize: 22, fontWeight: "bold" }}>{stats.engagement.d60}%</div>
          <div style={{ fontSize: 12, color: "#666" }}>D60</div>
        </div>
        <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12 }}>
          <div style={{ fontSize: 22, fontWeight: "bold" }}>{stats.engagement.d90}%</div>
          <div style={{ fontSize: 12, color: "#666" }}>D90</div>
        </div>
      </div>
      <p style={{ marginTop: 20, fontSize: 12, color: "#666" }}>Execuções de IA registradas (observabilidade): {stats.aiExecutions}</p>
    </main>
  );
}
