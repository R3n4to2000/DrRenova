import "dotenv/config";
import { Pool } from "pg";

// Pool separado, com role de MIGRAÇÃO, usado só para seed/limpeza de dados de
// teste (o app_runtime não tem DELETE em várias tabelas, de propósito).
export const adminPool = new Pool({ connectionString: process.env.MIGRATE_DATABASE_URL });

export async function resetTestData(): Promise<void> {
  // Ordem respeita FKs. Usa o role de migração (bypassa RLS e restrições de DELETE),
  // exclusivamente para limpar o ambiente de teste entre execuções.
  const tables = [
    "intent_classifications",
    "ai_executions",
    "prescriptions",
    "intercorrencias",
    "doctor_decisions",
    "check_in_answers",
    "check_ins",
    "category_questionnaire_fields",
    "category_questionnaire_versions",
    "deterministic_safety_rules",
    "conversation_messages",
    "conversations",
    "communication_consents",
    "patient_communication_preferences",
    "analytics_events",
    "idempotency_keys",
    "audit_logs",
    "subscription_status_transitions",
    "subscriptions",
    "adesoes",
    "eligibility_decisions",
    "clinical_events",
    "doctor_patient_assignments",
    "treatments",
    "patients",
    "doctors",
    "users",
    "category_configs",
    "plan_configs",
  ];
  for (const t of tables) {
    await adminPool.query(`DELETE FROM ${t}`);
  }
}

export async function seedBaseConfig(): Promise<void> {
  await adminPool.query(
    `INSERT INTO plan_configs (plan_key, version, name, adesao_amount, monthly_amount, annual_amount, max_treatments, status)
     VALUES ('ESSENCIAL', 1, 'Essencial', 39.90, 39.90, 399.00, 1, 'ACTIVE')`
  );
  const { rows: category } = await adminPool.query(
    `INSERT INTO category_configs (category_key, version, name, default_review_period_days, status)
     VALUES ('PRESSAO_ALTA', 1, 'Pressão Alta', 90, 'ACTIVE') RETURNING id`
  );
  const categoryConfigId = category[0].id;

  // Questionário de check-in mínimo, versionado — sem lógica clínica
  // específica (só um campo numérico genérico de exemplo).
  const { rows: qv } = await adminPool.query(
    `INSERT INTO category_questionnaire_versions (category_config_id, questionnaire_type, version, status)
     VALUES ($1, 'CHECKIN', 1, 'ACTIVE') RETURNING id`,
    [categoryConfigId]
  );
  await adminPool.query(
    `INSERT INTO category_questionnaire_fields (questionnaire_version_id, field_key, label, value_type, required, order_index)
     VALUES ($1, 'valor_generico', 'Valor informado', 'NUMBER', true, 0)`,
    [qv[0].id]
  );

  return;
}

export async function getSeededCategoryConfigId(): Promise<string> {
  const { rows } = await adminPool.query(`SELECT id FROM category_configs WHERE category_key = 'PRESSAO_ALTA' LIMIT 1`);
  return rows[0].id;
}
