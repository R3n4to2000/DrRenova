import { redirect } from "next/navigation";
import { getServerAppContext } from "@/lib/session-cookie";
import { withContext } from "@/lib/db";
import { queueService, type QueuePriority } from "@/modules/continuity/application/queue.service";

const PRIORITY_LABEL: Record<QueuePriority, string> = {
  RED: "🔴 Prioridade alta",
  ORANGE: "🟠 Intercorrência / avaliação",
  YELLOW: "🟡 Vencendo / pendente",
  GREEN: "🟢 Rotina",
};

export default async function DoctorQueuePage() {
  const ctx = await getServerAppContext();
  if (!ctx || ctx.role !== "DOCTOR" || !ctx.doctorId) redirect("/dev-login");

  const queue = await withContext(ctx, (client) => queueService.getDoctorQueue(client, ctx.doctorId!));

  return (
    <main style={{ maxWidth: 720, margin: "40px auto", fontFamily: "sans-serif" }}>
      <h1>Minha Carteira — Fila de Hoje</h1>
      <p style={{ color: "#666" }}>{queue.length} tratamento(s) ativo(s) na sua carteira.</p>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "2px solid #ddd" }}>
            <th style={{ padding: 8 }}>Paciente</th>
            <th style={{ padding: 8 }}>Categoria</th>
            <th style={{ padding: 8 }}>Prioridade</th>
            <th style={{ padding: 8 }}>Próxima revisão</th>
            <th style={{ padding: 8 }}></th>
          </tr>
        </thead>
        <tbody>
          {queue.map((item) => (
            <tr key={item.treatment_id} style={{ borderBottom: "1px solid #eee" }}>
              <td style={{ padding: 8 }}>{item.patient_full_name}</td>
              <td style={{ padding: 8 }}>{item.category_name}</td>
              <td style={{ padding: 8 }}>{PRIORITY_LABEL[item.priority]}</td>
              <td style={{ padding: 8 }}>
                {item.next_review_due_at ? new Date(item.next_review_due_at).toLocaleDateString("pt-BR") : "—"}
              </td>
              <td style={{ padding: 8 }}>
                <a href={`/medico/prontuario/${item.treatment_id}`}>Abrir prontuário</a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {queue.length === 0 && <p>Nenhum tratamento ativo na sua carteira no momento.</p>}
    </main>
  );
}
