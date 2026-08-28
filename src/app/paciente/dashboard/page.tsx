import { redirect } from "next/navigation";
import { getServerAppContext } from "@/lib/session-cookie";
import { withContext } from "@/lib/db";

interface TreatmentView {
  treatment_id: string;
  category_name: string;
  status: string;
  next_review_due_at: string | null;
  doctor_full_name: string | null;
  doctor_crm: string | null;
  open_checkin_id: string | null;
  open_checkin_status: string | null;
}

export default async function PatientDashboardPage() {
  const ctx = await getServerAppContext();
  if (!ctx || ctx.role !== "PATIENT" || !ctx.patientId) redirect("/dev-login");

  const treatments = await withContext(ctx, async (client) => {
    const { rows } = await client.query<TreatmentView>(
      `
      SELECT
        t.id AS treatment_id,
        cc.name AS category_name,
        t.status,
        t.next_review_due_at,
        d.full_name AS doctor_full_name,
        d.crm AS doctor_crm,
        ci.id AS open_checkin_id,
        ci.status AS open_checkin_status
      FROM treatments t
      JOIN category_configs cc ON cc.id = t.category_config_id
      LEFT JOIN LATERAL (
        SELECT dpa.doctor_id FROM doctor_patient_assignments dpa
        WHERE dpa.treatment_id = t.id AND dpa.is_current = true LIMIT 1
      ) current_dpa ON true
      LEFT JOIN doctors d ON d.id = current_dpa.doctor_id
      LEFT JOIN LATERAL (
        SELECT id, status FROM check_ins c
        WHERE c.treatment_id = t.id AND c.status IN ('SCHEDULED','OPEN')
        ORDER BY c.scheduled_for ASC LIMIT 1
      ) ci ON true
      WHERE t.patient_id = $1
      ORDER BY t.created_at ASC
      `,
      [ctx.patientId]
    );
    return rows;
  });

  return (
    <main style={{ maxWidth: 480, margin: "40px auto", fontFamily: "sans-serif" }}>
      <h1>Meu acompanhamento</h1>
      {treatments.length === 0 && <p>Nenhum tratamento ativo ainda.</p>}
      {treatments.map((t) => (
        <section key={t.treatment_id} style={{ border: "1px solid #ddd", borderRadius: 8, padding: 16, marginBottom: 16 }}>
          <h2 style={{ marginTop: 0 }}>{t.category_name}</h2>
          <p>
            <strong>Status:</strong> {t.status}
          </p>
          {t.doctor_full_name && (
            <p>
              <strong>Médico responsável:</strong> {t.doctor_full_name} (CRM {t.doctor_crm})
            </p>
          )}
          {t.next_review_due_at && (
            <p>
              <strong>Próxima revisão:</strong> {new Date(t.next_review_due_at).toLocaleDateString("pt-BR")}
            </p>
          )}
          {t.open_checkin_id && (
            <p>
              <a href={`/paciente/checkin/${t.open_checkin_id}`} style={{ fontWeight: "bold" }}>
                🔔 Check-in disponível — responder agora
              </a>
            </p>
          )}
        </section>
      ))}
    </main>
  );
}
