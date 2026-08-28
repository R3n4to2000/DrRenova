import { redirect } from "next/navigation";
import { getServerAppContext } from "@/lib/session-cookie";
import { withContext } from "@/lib/db";

interface PlanRow {
  plan_key: string;
  name: string;
  adesao_amount: string;
  monthly_amount: string;
  annual_amount: string;
}
interface CategoryRow {
  category_key: string;
  name: string;
  default_review_period_days: number;
  in_person_evaluation_rule_enabled: boolean;
}
interface RuleRow {
  rule_key: string;
  field_key: string;
  operator: string;
  threshold: string;
  status: string;
  approved_by: string | null;
}

export default async function AdminConfigPage() {
  const ctx = await getServerAppContext();
  if (!ctx || ctx.role !== "ADMIN") redirect("/dev-login");

  const { plans, categories, rules } = await withContext(ctx, async (client) => {
    const plans = await client
      .query<PlanRow>(`SELECT plan_key, name, adesao_amount, monthly_amount, annual_amount FROM plan_configs WHERE status = 'ACTIVE'`)
      .then((r) => r.rows);
    const categories = await client
      .query<CategoryRow>(
        `SELECT category_key, name, default_review_period_days, in_person_evaluation_rule_enabled FROM category_configs WHERE status = 'ACTIVE'`
      )
      .then((r) => r.rows);
    const rules = await client
      .query<RuleRow>(`SELECT rule_key, field_key, operator, threshold, status, approved_by FROM deterministic_safety_rules ORDER BY created_at DESC`)
      .then((r) => r.rows);
    return { plans, categories, rules };
  });

  return (
    <main style={{ maxWidth: 720, margin: "40px auto", fontFamily: "sans-serif" }}>
      <p>
        <a href="/admin">← Visão Geral</a>
      </p>
      <h1>Configuração</h1>

      <h2>Planos (configuráveis, nunca hardcoded)</h2>
      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 24 }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "2px solid #ddd" }}>
            <th style={{ padding: 8 }}>Plano</th>
            <th style={{ padding: 8 }}>Adesão</th>
            <th style={{ padding: 8 }}>Mensal</th>
            <th style={{ padding: 8 }}>Anual</th>
          </tr>
        </thead>
        <tbody>
          {plans.map((p) => (
            <tr key={p.plan_key} style={{ borderBottom: "1px solid #eee" }}>
              <td style={{ padding: 8 }}>{p.name}</td>
              <td style={{ padding: 8 }}>R$ {p.adesao_amount}</td>
              <td style={{ padding: 8 }}>R$ {p.monthly_amount}</td>
              <td style={{ padding: 8 }}>R$ {p.annual_amount}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Categorias</h2>
      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 24 }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "2px solid #ddd" }}>
            <th style={{ padding: 8 }}>Categoria</th>
            <th style={{ padding: 8 }}>Periodicidade padrão</th>
            <th style={{ padding: 8 }}>Regra 180 dias</th>
          </tr>
        </thead>
        <tbody>
          {categories.map((c) => (
            <tr key={c.category_key} style={{ borderBottom: "1px solid #eee" }}>
              <td style={{ padding: 8 }}>{c.name}</td>
              <td style={{ padding: 8 }}>{c.default_review_period_days} dias</td>
              <td style={{ padding: 8 }}>{c.in_person_evaluation_rule_enabled ? "Habilitada" : "Desabilitada"}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Regras Determinísticas (Camilla)</h2>
      <p style={{ color: "#666", fontSize: 13 }}>
        Vazias por padrão — só a Direção Médica publica regras reais. Nenhum limiar clínico é criado pelo desenvolvimento.
      </p>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "2px solid #ddd" }}>
            <th style={{ padding: 8 }}>Regra</th>
            <th style={{ padding: 8 }}>Campo</th>
            <th style={{ padding: 8 }}>Condição</th>
            <th style={{ padding: 8 }}>Status</th>
            <th style={{ padding: 8 }}>Aprovada por</th>
          </tr>
        </thead>
        <tbody>
          {rules.map((r, i) => (
            <tr key={i} style={{ borderBottom: "1px solid #eee" }}>
              <td style={{ padding: 8 }}>{r.rule_key}</td>
              <td style={{ padding: 8 }}>{r.field_key}</td>
              <td style={{ padding: 8 }}>
                {r.operator} {r.threshold}
              </td>
              <td style={{ padding: 8 }}>{r.status}</td>
              <td style={{ padding: 8 }}>{r.approved_by}</td>
            </tr>
          ))}
          {rules.length === 0 && (
            <tr>
              <td colSpan={5} style={{ padding: 8, color: "#999" }}>
                Nenhuma regra cadastrada.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </main>
  );
}
