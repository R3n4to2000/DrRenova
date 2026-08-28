import { redirect } from "next/navigation";
import { getServerAppContext } from "@/lib/session-cookie";
import { withContext } from "@/lib/db";
import { engagementCoverageService } from "@/modules/camilla/application/engagement-coverage.service";

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12 }}>
      <div style={{ fontSize: 22, fontWeight: "bold" }}>{value}</div>
      <div style={{ fontSize: 12, color: "#666" }}>{label}</div>
    </div>
  );
}

export default async function AdminOverviewPage() {
  const ctx = await getServerAppContext();
  if (!ctx || ctx.role !== "ADMIN") redirect("/dev-login");

  const stats = await withContext(ctx, async (client) => {
    const q = (sql: string) => client.query<{ c: string }>(sql).then((r) => Number(r.rows[0].c));
    const [activePatients, activeTreatments, pendingReviews, openIntercorrencias, checkinsAnswered30d, camillaMessages] =
      await Promise.all([
        q(`SELECT count(DISTINCT patient_id)::text AS c FROM treatments WHERE status = 'ACTIVE'`),
        q(`SELECT count(*)::text AS c FROM treatments WHERE status = 'ACTIVE'`),
        q(`SELECT count(*)::text AS c FROM treatments WHERE status = 'ACTIVE' AND next_review_due_at < now()`),
        q(`SELECT count(*)::text AS c FROM intercorrencias WHERE status != 'RESOLVED'`),
        q(`SELECT count(*)::text AS c FROM check_ins WHERE status = 'ANSWERED' AND answered_at > now() - interval '30 days'`),
        q(`SELECT count(*)::text AS c FROM conversation_messages WHERE sender = 'CAMILLA'`),
      ]);
    const engagement = await engagementCoverageService.computeD30D60D90(client);
    return { activePatients, activeTreatments, pendingReviews, openIntercorrencias, checkinsAnswered30d, camillaMessages, engagement };
  });

  return (
    <main style={{ maxWidth: 720, margin: "40px auto", fontFamily: "sans-serif" }}>
      <h1>Renovamed — Visão Geral</h1>
      <nav style={{ marginBottom: 20 }}>
        <a href="/admin" style={{ marginRight: 12 }}>Visão Geral</a>
        <a href="/admin/corpo-clinico" style={{ marginRight: 12 }}>Corpo Clínico</a>
        <a href="/admin/config" style={{ marginRight: 12 }}>Configuração</a>
        <a href="/admin/camilla" style={{ marginRight: 12 }}>Camilla</a>
        <a href="/admin/auditoria">Auditoria</a>
      </nav>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
        <Stat label="Pacientes ativos" value={stats.activePatients} />
        <Stat label="Tratamentos ativos" value={stats.activeTreatments} />
        <Stat label="Revisões vencidas" value={stats.pendingReviews} />
        <Stat label="Intercorrências abertas" value={stats.openIntercorrencias} />
        <Stat label="Check-ins respondidos (30d)" value={stats.checkinsAnswered30d} />
        <Stat label="Mensagens da Camilla" value={stats.camillaMessages} />
      </div>
      <h2 style={{ marginTop: 24 }}>Engagement Coverage</h2>
      <p style={{ color: "#666", fontSize: 13 }}>
        % de tratamentos ativos com interação útil (check-in respondido ou decisão médica) na janela.
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
        <Stat label="D30" value={`${stats.engagement.d30}%`} />
        <Stat label="D60" value={`${stats.engagement.d60}%`} />
        <Stat label="D90" value={`${stats.engagement.d90}%`} />
      </div>
    </main>
  );
}
