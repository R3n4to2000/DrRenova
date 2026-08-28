import { redirect } from "next/navigation";
import { getServerAppContext } from "@/lib/session-cookie";
import { withContext } from "@/lib/db";

interface AuditRow {
  action: string;
  entity_type: string;
  entity_id: string;
  result: string;
  created_at: string;
}

export default async function AdminAuditoriaPage() {
  const ctx = await getServerAppContext();
  if (!ctx || ctx.role !== "ADMIN") redirect("/dev-login");

  const logs = await withContext(ctx, (client) =>
    client
      .query<AuditRow>(`SELECT action, entity_type, entity_id, result, created_at FROM audit_logs ORDER BY created_at DESC LIMIT 50`)
      .then((r) => r.rows)
  );

  return (
    <main style={{ maxWidth: 720, margin: "40px auto", fontFamily: "sans-serif" }}>
      <p>
        <a href="/admin">← Visão Geral</a>
      </p>
      <h1>Auditoria (últimos 50 eventos)</h1>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "2px solid #ddd" }}>
            <th style={{ padding: 8 }}>Quando</th>
            <th style={{ padding: 8 }}>Ação</th>
            <th style={{ padding: 8 }}>Entidade</th>
            <th style={{ padding: 8 }}>Resultado</th>
          </tr>
        </thead>
        <tbody>
          {logs.map((l, i) => (
            <tr key={i} style={{ borderBottom: "1px solid #eee" }}>
              <td style={{ padding: 8, fontSize: 12 }}>{new Date(l.created_at).toLocaleString("pt-BR")}</td>
              <td style={{ padding: 8, fontSize: 12 }}>{l.action}</td>
              <td style={{ padding: 8, fontSize: 12 }}>
                {l.entity_type}/{l.entity_id.slice(0, 8)}
              </td>
              <td style={{ padding: 8, fontSize: 12 }}>{l.result}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
