import fs from "node:fs";
import pg from "pg";

/**
 * Checagem automatizada de consistência entre `prisma/schema.prisma`
 * (fonte de verdade documental, ver ADR-001 em docs/DECISOES-TECNICAS.md)
 * e o schema real do PostgreSQL (criado pelas migrations SQL em
 * prisma/migrations/).
 *
 * Uso: MIGRATE_DATABASE_URL=... node scripts/check-schema-consistency.mjs
 * Sai com código 1 se houver qualquer divergência (apropriado para CI).
 */

const schema = fs.readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
const modelBlocks = [...schema.matchAll(/model\s+(\w+)\s*\{([^}]+)\}/gs)];
const results = [];

const SCALAR_TYPES = ["String", "Int", "Boolean", "DateTime", "Json", "Decimal"];
const KNOWN_ENUMS = [
  "UserRole", "DoctorStatus", "ConfigStatus", "TreatmentStatus", "SubscriptionStatus",
  "BillingPeriod", "EligibilityOutcome", "ConversationChannel", "MessageSender",
  "MessageType", "DeliveryStatus",
  // Fatia 2 — Treatment Continuity Engine
  "QuestionnaireType", "AnswerValueType", "CheckInStatus", "DoctorDecisionAction",
  "IntercorrenciaStatus", "PrescriptionStatus",
  // MVP Integration — Camilla
  "SafetyRuleStatus", "SafetyRuleOperator", "CamillaIntent",
  // Pilot Readiness — Outbox
  "OutboxStatus",
];

for (const [, modelName, body] of modelBlocks) {
  const tableNameMatch = body.match(/@@map\("([^"]+)"\)/);
  if (!tableNameMatch) continue;
  const tableName = tableNameMatch[1];

  const fieldLines = body
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("//") && !l.startsWith("@@") && !l.startsWith("///"));

  const columns = [];
  for (const line of fieldLines) {
    const m = line.match(/^(\w+)\s+([\w[\]?]+)/);
    if (!m) continue;
    const [, fieldName, fieldType] = m;
    if (line.includes("@relation(fields")) continue; // lado com FK própria, já capturado como campo escalar id
    const baseType = fieldType.replace(/[[\]?]/g, "");
    const isScalarOrEnum = SCALAR_TYPES.includes(baseType) || KNOWN_ENUMS.includes(baseType);
    if (!isScalarOrEnum) continue; // campo de relação virtual (lista/objeto sem coluna própria)

    const mapMatch = line.match(/@map\("([^"]+)"\)/);
    const columnName = mapMatch ? mapMatch[1] : fieldName;
    columns.push({ fieldName, columnName });
  }
  results.push({ modelName, tableName, columns });
}

const pool = new pg.Pool({ connectionString: process.env.MIGRATE_DATABASE_URL });
let totalDivergences = 0;

for (const { modelName, tableName, columns } of results) {
  const { rows } = await pool.query(
    `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1`,
    [tableName]
  );
  const dbColumns = new Set(rows.map((r) => r.column_name));
  const prismaColumns = new Set(columns.map((c) => c.columnName));

  const missingInDb = [...prismaColumns].filter((c) => !dbColumns.has(c));
  const missingInPrisma = [...dbColumns].filter((c) => !prismaColumns.has(c));

  if (missingInDb.length || missingInPrisma.length) {
    totalDivergences++;
    console.log(`⚠️  DIVERGÊNCIA em ${modelName} (tabela ${tableName}):`);
    if (missingInDb.length) console.log(`   - No schema.prisma mas NÃO no banco: ${missingInDb.join(", ")}`);
    if (missingInPrisma.length) console.log(`   - No banco mas NÃO no schema.prisma: ${missingInPrisma.join(", ")}`);
  } else {
    console.log(`✅ ${modelName} (${tableName}) — ${prismaColumns.size} colunas, consistente`);
  }
}

// ---- Checagem reversa: toda tabela do banco tem um modelo Prisma? ----
// Sem isso, uma tabela nova criada só via SQL (sem @@map correspondente em
// schema.prisma) nunca seria detectada — o loop acima só percorre modelos
// já declarados no schema, nunca o inverso.
const KNOWN_TABLE_NAMES = new Set(results.map((r) => r.tableName));
const { rows: allTables } = await pool.query(
  `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'`
);
const orphanTables = allTables.map((r) => r.table_name).filter((t) => !KNOWN_TABLE_NAMES.has(t));
if (orphanTables.length > 0) {
  totalDivergences++;
  console.log(`⚠️  TABELAS NO BANCO SEM MODELO CORRESPONDENTE em schema.prisma: ${orphanTables.join(", ")}`);
}

console.log(`\n=== TOTAL: ${results.length} tabelas verificadas (+ ${orphanTables.length} órfã(s) no banco), ${totalDivergences} com divergência ===`);
await pool.end();

if (totalDivergences > 0) {
  process.exit(1);
}
