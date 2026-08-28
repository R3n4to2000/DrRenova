import { Pool, type PoolClient } from "pg";

/**
 * Camada de infraestrutura de acesso a dados.
 *
 * Decisão técnica (ver docs/DECISOES-TECNICAS.md): o Prisma Client exige
 * download de binário de engine que está bloqueado na rede deste ambiente
 * de execução. `schema.prisma` permanece a fonte de verdade documental do
 * modelo de dados; o acesso real, nesta fatia, é feito via `pg` diretamente,
 * mantendo os módulos de domínio agnósticos ao cliente concreto (eles
 * dependem de `AppContext`, não de `pg` nem de `PrismaClient`).
 */

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export type Role = "PATIENT" | "DOCTOR" | "ADMIN" | "SUPPORT" | "SYSTEM";

export interface AppContext {
  userId: string | null; // User.id (não o authUserId) — null para execuções de sistema
  role: Role;
  correlationId: string;
  origin?: string; // "web" | "api" | "scheduler" | "test" — default "app"
}

/**
 * Executa um bloco de trabalho dentro de uma transação com as variáveis de
 * sessão de RLS (`app.current_user_id`, `app.current_role`) já definidas.
 * Nenhum repository deve abrir conexão fora desta função.
 */
export async function withContext<T>(
  ctx: AppContext,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // SET LOCAL não aceita parâmetros bind ($1) — é erro de sintaxe do Postgres.
    // set_config() é a forma correta de definir variáveis de sessão parametrizadas.
    //
    // IMPORTANTE (bug real encontrado em execução): GUCs customizados (app.*)
    // em conexões reaproveitadas pelo pool, na primeira vez que são setados via
    // SET LOCAL, revertem para '' (string vazia) ao fim da transação — não para
    // NULL. Por isso `app.current_user_id` é SEMPRE definido explicitamente
    // aqui (mesmo como '' quando não há usuário), e toda policy que o usa faz
    // NULLIF(..., '')::uuid antes do cast, para nunca quebrar com
    // "invalid input syntax for type uuid: ''".
    await client.query("SELECT set_config('app.current_role', $1, true)", [ctx.role]);
    await client.query("SELECT set_config('app.current_user_id', $1, true)", [ctx.userId ?? ""]);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function closePool() {
  await pool.end();
}
