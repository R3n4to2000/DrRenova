// Renovamed — Re-criptografia em lote para rotação de chave (Item 8)
//
// Uso: MIGRATE_DATABASE_URL=... FIELD_ENCRYPTION_KEY_V1=... FIELD_ENCRYPTION_KEY_V2=...
//   FIELD_ENCRYPTION_KEY_CURRENT_VERSION=2 FIELD_HASH_SECRET=...
//   node scripts/rotate-encryption-key.mjs
//
// NOTA: este script importa TypeScript diretamente via node --experimental
// não é usado aqui; assume-se execução via tsx em ambiente com suporte, ou
// a lógica de encryption.ts pode ser inlinied caso o projeto rode em ambiente
// Node puro sem loader de TS. Ver README de operação para o comando exato.

import "dotenv/config";
import pg from "pg";
import { decryptField, encryptField, getCiphertextKeyVersion } from "../src/lib/encryption.ts";

const pool = new pg.Pool({ connectionString: process.env.MIGRATE_DATABASE_URL });
const targetVersion = Number(process.env.FIELD_ENCRYPTION_KEY_CURRENT_VERSION ?? 1);

async function rotateColumn(table, idColumn, encryptedColumn) {
  const { rows } = await pool.query(`SELECT ${idColumn} AS id, ${encryptedColumn} AS value FROM ${table}`);
  let migrated = 0;
  for (const row of rows) {
    if (getCiphertextKeyVersion(row.value) === targetVersion) continue;
    const plaintext = decryptField(row.value);
    const reencrypted = encryptField(plaintext);
    await pool.query(`UPDATE ${table} SET ${encryptedColumn} = $1 WHERE ${idColumn} = $2`, [reencrypted, row.id]);
    migrated++;
  }
  console.log(`${table}.${encryptedColumn}: ${migrated}/${rows.length} linhas migradas para v${targetVersion}`);
}

async function main() {
  console.log(`Rotacionando campos cifrados para a versão de chave atual (v${targetVersion})...`);
  await rotateColumn("patients", "id", "cpf_encrypted");
  await rotateColumn("patients", "id", "whatsapp_encrypted");
  console.log("Concluído.");
  await pool.end();
}

main().catch((err) => {
  console.error("Falha na rotação:", err.message);
  process.exit(1);
});
