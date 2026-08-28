// Renovamed — Seed de STAGING — 100% FICTÍCIO
//
// NUNCA rodar contra um banco com qualquer dado de paciente real.
//
// Uso: MIGRATE_DATABASE_URL=... node scripts/seed-staging.mjs

import "dotenv/config";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.MIGRATE_DATABASE_URL });

async function main() {
  console.log("Seed de staging — dados 100% fictícios");

  await pool.query(
    `INSERT INTO plan_configs (plan_key, version, name, adesao_amount, monthly_amount, annual_amount, max_treatments, status)
     VALUES
       ('ESSENCIAL', 1, 'Essencial', 39.90, 39.90, 399.00, 1, 'ACTIVE'),
       ('PLUS', 1, 'Plus', 39.90, 59.90, 599.00, 1, 'ACTIVE'),
       ('EMAGRECIMENTO', 1, 'Emagrecimento', 39.90, 99.90, 999.00, 1, 'ACTIVE')
     ON CONFLICT (plan_key, version) DO NOTHING`
  );

  const { rows: existingCategory } = await pool.query(
    `SELECT id FROM category_configs WHERE category_key = 'PRESSAO_ALTA' AND version = 1`
  );
  let categoryId = existingCategory[0]?.id;
  if (!categoryId) {
    const { rows } = await pool.query(
      `INSERT INTO category_configs (category_key, version, name, default_review_period_days, status)
       VALUES ('PRESSAO_ALTA', 1, 'Pressão Alta', 90, 'ACTIVE') RETURNING id`
    );
    categoryId = rows[0].id;
  }

  const { rows: existingQv } = await pool.query(
    `SELECT id FROM category_questionnaire_versions WHERE category_config_id = $1 AND questionnaire_type = 'CHECKIN'`,
    [categoryId]
  );
  if (existingQv.length === 0) {
    const { rows: qv } = await pool.query(
      `INSERT INTO category_questionnaire_versions (category_config_id, questionnaire_type, version, status)
       VALUES ($1, 'CHECKIN', 1, 'ACTIVE') RETURNING id`,
      [categoryId]
    );
    await pool.query(
      `INSERT INTO category_questionnaire_fields (questionnaire_version_id, field_key, label, value_type, required, order_index)
       VALUES ($1, 'valor_generico', 'Valor informado', 'NUMBER', true, 0)`,
      [qv[0].id]
    );
  }

  console.log("Planos, categoria e questionário de staging seedados.");
  console.log("deterministic_safety_rules permanece VAZIA — nenhuma regra ACTIVE é seedada aqui.");
  console.log("Nenhum paciente/médico fictício é criado por este script — use o painel ou API para criar contas de teste vinculadas a contas reais do Supabase Auth de staging.");

  await pool.end();
}

main().catch((err) => {
  console.error("Falha no seed de staging:", err.message);
  process.exit(1);
});
