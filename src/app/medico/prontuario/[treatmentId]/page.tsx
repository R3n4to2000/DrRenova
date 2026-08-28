import { redirect } from "next/navigation";
import { getServerAppContext } from "@/lib/session-cookie";
import { withContext } from "@/lib/db";
import { timelineService } from "@/modules/continuity/application/timeline.service";
import { recordDoctorDecisionCommand } from "@/modules/decision/application/doctor-decision.commands";
import type { DoctorDecisionAction } from "@/modules/decision/application/doctor-decision.service";

const ACTIONS: DoctorDecisionAction[] = [
  "MAINTAIN",
  "REQUEST_INFORMATION",
  "REQUEST_EXAM",
  "REQUEST_TELECONSULTATION",
  "REQUEST_IN_PERSON_EVALUATION",
  "ISSUE_PRESCRIPTION",
  "CHANGE_REVIEW_PERIOD",
  "REGISTER_CONDUCT",
  "REFER",
  "END_TREATMENT",
];

export default async function ProntuarioPage({ params }: { params: { treatmentId: string } }) {
  const ctx = await getServerAppContext();
  if (!ctx || ctx.role !== "DOCTOR" || !ctx.doctorId) redirect("/dev-login");

  const treatment = await withContext(ctx, (client) =>
    client
      .query(
        `SELECT t.id, t.status, t.next_review_due_at, p.full_name AS patient_full_name, cc.name AS category_name
         FROM treatments t JOIN patients p ON p.id = t.patient_id JOIN category_configs cc ON cc.id = t.category_config_id
         WHERE t.id = $1`,
        [params.treatmentId]
      )
      .then((r) => r.rows[0])
  );

  if (!treatment) {
    return <main style={{ padding: 40 }}>Tratamento não encontrado (ou fora da sua carteira).</main>;
  }

  const timeline = await withContext(ctx, (client) => timelineService.getTreatmentTimelineForDoctor(client, params.treatmentId));
  const openIntercorrencias = await withContext(ctx, (client) =>
    client
      .query(`SELECT id, description, status FROM intercorrencias WHERE treatment_id = $1 AND status != 'RESOLVED'`, [params.treatmentId])
      .then((r) => r.rows)
  );

  async function registerDecision(formData: FormData) {
    "use server";
    const freshCtx = await getServerAppContext();
    if (!freshCtx || freshCtx.role !== "DOCTOR" || !freshCtx.doctorId) redirect("/dev-login");

    const action = formData.get("action") as DoctorDecisionAction;
    const note = String(formData.get("note") ?? "") || undefined;
    const reviewPeriodDaysNewRaw = formData.get("reviewPeriodDaysNew");
    const reviewPeriodDaysNew = reviewPeriodDaysNewRaw ? Number(reviewPeriodDaysNewRaw) : undefined;
    const resolveIntercorrenciaId = (formData.get("resolveIntercorrenciaId") as string) || undefined;

    await recordDoctorDecisionCommand(freshCtx, {
      treatmentId: params.treatmentId,
      doctorId: freshCtx.doctorId,
      action,
      note,
      reviewPeriodDaysNew,
      resolveIntercorrenciaId,
    });

    redirect(`/medico/prontuario/${params.treatmentId}`);
  }

  return (
    <main style={{ maxWidth: 720, margin: "40px auto", fontFamily: "sans-serif" }}>
      <p>
        <a href="/medico/fila">← Voltar à fila</a>
      </p>
      <h1>
        {treatment.patient_full_name} — {treatment.category_name}
      </h1>
      <p>
        <strong>Status:</strong> {treatment.status} ·{" "}
        <strong>Próxima revisão:</strong>{" "}
        {treatment.next_review_due_at ? new Date(treatment.next_review_due_at).toLocaleDateString("pt-BR") : "—"}
      </p>

      {openIntercorrencias.length > 0 && (
        <section style={{ background: "#fff3cd", padding: 12, borderRadius: 8, marginBottom: 20 }}>
          <strong>Pendências abertas:</strong>
          <ul>
            {openIntercorrencias.map((i) => (
              <li key={i.id}>
                {i.description} ({i.status})
              </li>
            ))}
          </ul>
        </section>
      )}

      <h2>Linha do tempo</h2>
      <ul>
        {timeline.map((item, idx) => (
          <li key={idx}>
            <strong>{new Date(item.occurredAt).toLocaleString("pt-BR")}</strong> — {item.summary}
          </li>
        ))}
      </ul>

      <h2>Registrar decisão</h2>
      <form action={registerDecision}>
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: "block", marginBottom: 4 }}>Ação</label>
          <select name="action" style={{ width: "100%", padding: 8 }} required>
            {ACTIONS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: "block", marginBottom: 4 }}>Nota (opcional)</label>
          <textarea name="note" style={{ width: "100%", padding: 8 }} rows={3} />
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: "block", marginBottom: 4 }}>Novo período de revisão em dias (só se CHANGE_REVIEW_PERIOD)</label>
          <input name="reviewPeriodDaysNew" type="number" style={{ width: "100%", padding: 8 }} />
        </div>
        {openIntercorrencias.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: "block", marginBottom: 4 }}>Resolver pendência (opcional)</label>
            <select name="resolveIntercorrenciaId" style={{ width: "100%", padding: 8 }}>
              <option value="">— nenhuma —</option>
              {openIntercorrencias.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.description}
                </option>
              ))}
            </select>
          </div>
        )}
        <button type="submit" style={{ padding: 8, width: "100%" }}>
          Registrar decisão
        </button>
      </form>
    </main>
  );
}
