# Renovamed — Runbook de Desenvolvimento Local

Este documento permite que outro desenvolvedor rode o projeto do zero sem depender de conhecimento oral da implementação.

## Pré-requisitos

- Node.js 22+
- PostgreSQL 16 (local ou container)

## 1. Clonar e instalar

```bash
git clone <repo>
cd renovamed
npm install
```

## 2. Subir o PostgreSQL

```bash
# Se usando o Postgres do sistema (Ubuntu/Debian):
service postgresql start

# Ou via Docker:
docker run -d --name renovamed-pg -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:16
```

## 3. Criar roles e banco

```bash
psql -U postgres -c "CREATE ROLE app_migrator LOGIN PASSWORD 'SUA_SENHA_DEV' SUPERUSER;"
psql -U postgres -c "CREATE ROLE app_runtime LOGIN PASSWORD 'SUA_SENHA_DEV';"
psql -U postgres -c "CREATE DATABASE renovamed OWNER app_migrator;"
psql -U postgres -c "GRANT CONNECT ON DATABASE renovamed TO app_runtime;"
```

## 4. Configurar variáveis de ambiente

```bash
cp .env.example .env
```

Edite `.env` preenchendo:
- `DATABASE_URL` — usando o role `app_runtime` e a senha escolhida acima.
- `MIGRATE_DATABASE_URL` — usando o role `app_migrator`.
- `FIELD_ENCRYPTION_KEY` — gerar com: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
- `FIELD_HASH_SECRET` — qualquer string longa e aleatória.
- `SESSION_TOKEN_SECRET` — qualquer string longa e aleatória.

Nunca use os mesmos valores de produção em desenvolvimento, e nunca commite `.env` (já está no `.gitignore`).

## 5. Aplicar as migrations (em ordem, do zero)

```bash
for f in prisma/migrations/*.sql; do
  psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"
done
```

Ou, individualmente, na ordem `0001` → a última existente no diretório. **Nunca pule uma migration nem aplique fora de ordem.**

## 6. Verificar consistência do schema

```bash
node scripts/check-schema-consistency.mjs
```

Deve terminar com `0 com divergência`. Se não terminar, **pare** — algo está inconsistente entre `prisma/schema.prisma` e o banco real, e precisa ser investigado antes de continuar (ver `docs/DECISOES-TECNICAS.md`).

## 7. Rodar as verificações

```bash
npm run typecheck   # deve terminar com exit code 0
npm run lint        # deve terminar sem warnings/erros
npm test            # deve terminar com todos os testes passando
npm run build       # deve compilar sem erros
```

## 8. Rodar em desenvolvimento

```bash
npm run dev
```

---

## Solução de Problemas Comuns

**"connection refused" no Postgres:** o serviço não está rodando — repita o passo 2.

**Testes falhando com "permission denied for schema public":** você está usando `app_runtime` como `MIGRATE_DATABASE_URL` por engano — migrations exigem `app_migrator`.

**Testes falhando de forma incoerente entre execuções:** rode a suíte isolada (`npx vitest run tests/integration/<arquivo>.test.ts`) para isolar qual arquivo introduz o problema; verifique se o Postgres não foi reiniciado no meio da execução.

**Checagem de consistência falhando:** normalmente indica que uma coluna foi adicionada em uma migration SQL sem o `@map()` correspondente em `schema.prisma`, ou vice-versa — corrija os dois juntos e rode a checagem de novo antes de prosseguir.

---

## O Que Este Runbook Não Cobre (fora do escopo desta fatia)

- Deploy em produção (Vercel/Supabase) — depende de decisões ainda pendentes (ver `docs/PENDENCIAS.md`).
- Login real de usuários (Supabase Auth) — o mecanismo de sessão atual (`SESSION_TOKEN_SECRET`) é um placeholder de desenvolvimento.
- Rotação de chaves de criptografia em produção.
