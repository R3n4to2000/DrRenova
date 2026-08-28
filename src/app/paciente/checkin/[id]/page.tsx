import { redirect } from "next/navigation";
import { getServerAppContext } from "@/lib/session-cookie";
import { withContext } from "@/lib/db";
import { openCheckInCommand } from "@/modules/continuity/application/continuity.commands";
import { submitCheckInAnswersCommand } from "@/modules/checkin/application/checkin.commands";
import type { AnswerValueType } from "@/modules/questionnaire/application/questionnaire.service";

interface FieldView {
  field_key: string;
  label: string;
  value_type: AnswerValueType;
  required: boolean;
}

const DEFAULT_CHECKIN_EXPIRES_DAYS = 7; // operacional/configurável — nunca uma regra clínica

export default async function CheckInPage({ params }: { params: { id: string } }) {
  const ctx = await getServerAppContext();
  if (!ctx || ctx.role !== "PATIENT") redirect("/dev-login");

  const checkIn = await withContext(ctx, (client) =>
    client.query(`SELECT id, status, questionnaire_version_id FROM check_ins WHERE id = $1`, [params.id]).then((r) => r.rows[0])
  );
  if (!checkIn) return <main style={{ padding: 40 }}>Check-in não encontrado (ou você não tem acesso a ele).</main>;

  if (checkIn.status === "SCHEDULED") {
    await openCheckInCommand(ctx, checkIn.id, DEFAULT_CHECKIN_EXPIRES_DAYS, ctx.patientId!);
  }
  if (checkIn.status === "ANSWERED") {
    return (
      <main style={{ maxWidth: 480, margin: "40px auto", fontFamily: "sans-serif" }}>
        <h1>Check-in já respondido</h1>
        <p>Obrigado! Sua resposta já foi registrada e encaminhada para seu médico.</p>
        <a href="/paciente/dashboard">Voltar ao painel</a>
      </main>
    );
  }

  const fields = await withContext(ctx, (client) =>
    client
      .query<FieldView>(
        `SELECT field_key, label, value_type, required FROM category_questionnaire_fields
         WHERE questionnaire_version_id = $1 ORDER BY order_index ASC`,
        [checkIn.questionnaire_version_id]
      )
      .then((r) => r.rows)
  );

  async function submit(formData: FormData) {
    "use server";
    const freshCtx = await getServerAppContext();
    if (!freshCtx || freshCtx.role !== "PATIENT") redirect("/dev-login");

    const answers = fields.map((f) => ({
      fieldKey: f.field_key,
      valueType: f.value_type,
      value: f.value_type === "NUMBER" ? Number(formData.get(f.field_key)) : formData.get(f.field_key),
      rawInput: String(formData.get(f.field_key) ?? ""),
    }));

    await submitCheckInAnswersCommand(freshCtx, params.id, answers);
    redirect("/paciente/dashboard");
  }

  return (
    <main style={{ maxWidth: 480, margin: "40px auto", fontFamily: "sans-serif" }}>
      <h1>Check-in do seu acompanhamento</h1>
      <form action={submit}>
        {fields.map((f) => (
          <div key={f.field_key} style={{ marginBottom: 12 }}>
            <label style={{ display: "block", marginBottom: 4 }}>{f.label}</label>
            <input
              name={f.field_key}
              type={f.value_type === "NUMBER" ? "number" : f.value_type === "DATE" ? "date" : "text"}
              required={f.required}
              style={{ width: "100%", padding: 8 }}
            />
          </div>
        ))}
        <button type="submit" style={{ padding: 8, width: "100%" }}>
          Enviar
        </button>
      </form>
    </main>
  );
}
