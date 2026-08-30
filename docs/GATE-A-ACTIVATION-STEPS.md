# Renovamed — Production Activation, Gate A: Passo a Passo para o André

Este documento existe porque o ambiente de execução usado para desenvolver o Renovamed não tem acesso de rede a nenhum provedor de nuvem (Supabase, Vercel, AWS, GCP — todos bloqueados por política de egress: host_not_allowed, testado e confirmado nesta sessão). Isso não é falta de uma chave de API — é um bloqueio estrutural de rede do sandbox. Por isso, o Gate A não pode ser executado por mim; precisa ser executado por você, seguindo os passos abaixo. O código já está pronto para receber essas credenciais sem nenhuma mudança adicional.

## 1. Criar o projeto Supabase

1. Acesse supabase.com/dashboard e crie um projeto novo chamado renovamed-staging.
2. Em Project Settings > API, anote: Project URL (SUPABASE_URL), anon public key (SUPABASE_ANON_KEY).
3. Em Project Settings > API > JWT Settings, copie o JWT Secret (SUPABASE_JWT_SECRET).
4. Em Project Settings > Database, copie a connection string com o usuário postgres (superuser) para MIGRATE_DATABASE_URL.
5. Em Authentication > Providers, habilite Email.
6. Em Authentication > MFA, habilite TOTP.

## 2. Criar os roles restritos no banco

Conecte via psql usando a connection string de superuser:

```sql
CREATE ROLE app_migrator LOGIN PASSWORD 'SENHA_FORTE_AQUI' SUPERUSER;
CREATE ROLE app_runtime LOGIN PASSWORD 'OUTRA_SENHA_FORTE_AQUI';
GRANT CONNECT ON DATABASE postgres TO app_runtime;
```

## 3. Aplicar as 14 migrations (sem modificá-las)

```bash
export MIGRATE_DATABASE_URL="postgresql://app_migrator:SENHA@db.SEU_PROJETO.supabase.co:5432/postgres"
for f in prisma/migrations/*.sql; do
  psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"
done
```

## 4. Validar a consistência do schema contra o banco remoto

```bash
node scripts/check-schema-consistency.mjs
```

Resultado esperado: 31 tabelas, 0 divergências, 0 órfãs.

## 5. Configurar as variáveis de ambiente

Use .env.staging.example como template. Preencha com os valores reais. Nunca commite o .env preenchido.

## 6. Deploy no Vercel

1. Conecte o repositório Git em vercel.com/new (Next.js é detectado automaticamente).
2. Em Environment Variables, adicione todas as variáveis com os valores reais.
3. Faça o deploy. Anote a URL temporária.

## 7. Seed fictício

```bash
node scripts/seed-staging.mjs
```

Depois, crie manualmente um paciente fictício, um médico fictício (com MFA habilitado) e um admin fictício.

## 8. Validar

- `curl https://SEU_APP.vercel.app/api/health` deve retornar healthy: true.
- POST /api/dev-login deve retornar 403 (confirma que AUTH_MODE=supabase bloqueou o dev-login).
- Login humano pelo navegador como paciente, médico (MFA) e admin (MFA).

## 9. Depois de tudo isso

Volte com a URL de staging publicada e confirmação de que os passos 3, 4 e 8 funcionaram.
