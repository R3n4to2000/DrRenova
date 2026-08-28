import { redirect } from "next/navigation";
import { getServerAppContext } from "@/lib/session-cookie";
import { withContext } from "@/lib/db";

interface DoctorRow {
  id: string;
  full_name: string;
  crm: string;
  crm_state: string;
  specialty: string;
  status: string;
  carteira_size: string;
}

export default async function AdminCorpoClinicoPage() {
  const ctx = await getServerAppContext();
  if (!ctx || ctx.role !== "ADMIN") redirect("/dev-login");

  const doctors = await withContext(ctx, (client) =>
    client
      .query<DoctorRow>(
        `
        SELECT d.id, d.full_name, d.crm, d.crm_state, d.specialty, d.status,
               count(dpa.id) FILTER (WHERE dpa.is_current)::text AS carteira_size
        FROM doctors d
        LEFT JOIN doctor_patient_assignments dpa ON dpa.doctor_id = d.id
        GROUP BY d.id
        ORDER BY d.full_name
        `
      )
      .then((r) => r.rows)
  );

  return (
    <main style={{ maxWidth: 720, margin: "40px auto", fontFamily: "sans-serif" }}>
      <p>
        <a href="/admin">← Visão Geral</a>
      </p>
      <h1>Corpo Clínico</h1>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "2px solid #ddd" }}>
            <th style={{ padding: 8 }}>Médico</th>
            <th style={{ padding: 8 }}>CRM</th>
            <th style={{ padding: 8 }}>Especialidade</th>
            <th style={{ padding: 8 }}>Status</th>
            <th style={{ padding: 8 }}>Carteira</th>
          </tr>
        </thead>
        <tbody>
          {doctors.map((d) => (
            <tr key={d.id} style={{ borderBottom: "1px solid #eee" }}>
              <td style={{ padding: 8 }}>{d.full_name}</td>
              <td style={{ padding: 8 }}>
                {d.crm}/{d.crm_state}
              </td>
              <td style={{ padding: 8 }}>{d.specialty}</td>
              <td style={{ padding: 8 }}>{d.status}</td>
              <td style={{ padding: 8 }}>{d.carteira_size}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
