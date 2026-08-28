# Renovamed — Relatório Final da Fatia 1 (Fundação)

## 1. Status

## PASSOU

Nenhum teste crítico de segurança, RLS, elegibilidade, auditoria, snapshot ou idempotência falhou na versão final. Dois critérios têm ressalvas explícitas de escopo (itens 6 e 9 da tabela) — registrados como tal, não escondidos.

---

## 2. Testes

- **Total:** 29
- **Passaram:** 29
- **Falharam:** 0
- **Não executados/skip:** 0 (nenhum teste foi marcado como skip em nenhum momento)
- **Estabilidade:** suíte rodada 5× consecutivas ao longo do processo, sempre 100% verde.

**Principais cenários cobertos:** RBAC/MFA, carteira médica (histórico nunca apagado), gate de elegibilidade real, independência entre Adesão e elegibilidade, elegibilidade nunca sobrescrita, transições de Subscription (válidas e inválidas, em serviço e em trigger de banco), idempotência de Adesão, snapshot financeiro imutável a mudança de PlanConfig, isolamento RLS entre pacientes, médico restrito à própria carteira, SUPPORT sem acesso clínico por padrão, AuditLog imutável, revogação de consentimento preservando histórico, timestamps em UTC, dados sensíveis nunca em claro.

**Bugs reais encontrados e corrigidos durante a execução (não maquiados, corrigidos na raiz):**
1. `SET LOCAL` não aceita parâmetro bind — corrigido com `set_config()`.
2. Recursão estrutural de RLS entre `patients` ↔ `doctor_patient_assignments` — corrigida com funções `SECURITY DEFINER`.
3. Peculiaridade real do Postgres: GUC customizado revertendo para `''` em vez de `NULL` na primeira transação de uma conexão reaproveitada pelo pool — corrigido na origem (`db.ts`) + blindagem `NULLIF` em todas as policies afetadas.
4. Policies `_admin_all` em `patients`/`treatments`/`clinical_events` esqueciam o papel `SYSTEM`, quebrando `INSERT ... RETURNING` — corrigido.
5. Imports com sufixo `.js` (estilo Node ESM) não resolvidos pelo webpack do Next — corrigido removendo os sufixos.
6. `schema.prisma` sem `@map()` por campo — divergiria silenciosamente do banco (camelCase vs. snake_case) no dia em que o Prisma Client for usável — corrigido e verificado programaticamente (0 divergências em 19 tabelas).
7. Teste de consentimento nunca havia sido escrito (lacuna real) — escrito e corrigido (comparação de `Date` via `.getTime()`).

---

## 3. Build

- **Typecheck (`tsc --noEmit`):** ✅ exit 0, zero erros.
- **Lint (`next lint`):** ✅ "No ESLint warnings or errors".
- **Build (`next build`):** ✅ sucesso — 2 rotas estáticas + 1 rota de API dinâmica compiladas.

---

## 4. Banco

- **Migrations aplicadas (em ordem):** `0001_init.sql`, `0002_security_hardening.sql`, `0003_fix_rls_recursion.sql`, `0004_fix_system_role_select.sql`, `0005_harden_uuid_casts.sql`, `0006_fix_conversation_messages_policy.sql`. As migrations 0003–0006 existem precisamente porque bugs reais foram encontrados em execução — histórico preservado, nada foi "achatado" para esconder o processo.
- **Tabelas:** 19.
- **RLS ativado:** em 10 tabelas (patients, doctors, doctor_patient_assignments, treatments, subscriptions, adesoes, eligibility_decisions, clinical_events, conversations, conversation_messages).
- **Policies:** 34 no total.
- **Triggers:** 1 (`trg_subscription_transition`, state machine da Subscription).
- **Funções SECURITY DEFINER:** 2 (`fn_doctor_has_patient`, `fn_doctor_has_treatment`).
- **Roles:** `app_migrator` (superuser, só para DDL/migrations), `app_runtime` (privilégios restritos — sem DDL, sem UPDATE/DELETE em `audit_logs`, sem DELETE em entidades de retenção).
- **Grants confirmados em `audit_logs` para `app_runtime`:** apenas `INSERT`, `SELECT` (verificado via `information_schema.role_table_grants` e via tentativa real de `UPDATE`/`DELETE`, ambas rejeitadas).
- **Índices:** 37. **Constraints UNIQUE/FK:** 33.
- **Consistência `schema.prisma` × SQL × banco real:** checagem automatizada rodada — **0 divergências em 19 tabelas** (script comparou cada campo mapeado do Prisma contra `information_schema.columns`).

---

## 5. Módulos Implementados

Identity (auth/RBAC/MFA), Patient (com criptografia), Doctor + Carteira, Treatment, Subscription (state machine), Adesao (idempotente), EligibilityDecision (append-only), CommunicationConsent (append-only), Config (PlanConfig/CategoryConfig versionados), Audit (append-only), Analytics (emissão de eventos), Conversation (esqueleto para a Camilla). Ports: `PaymentGatewayPort`, `WhatsAppGatewayPort`, `TelemedicineProviderPort`, `SchedulerPort`, `StoragePort` — todos com implementação Fake.

---

## 6. Critérios de Aceite

| # | Critério | Status | Evidência |
|---|---|---|---|
| 1 | RBAC + MFA bloqueia médico/admin sem MFA | ✅ PASSOU | `foundation.test.ts` — 3 testes |
| 2 | Carteira nunca desaparece (histórico preservado) | ✅ PASSOU | `foundation.test.ts` — 2 testes |
| 3 | Gate de elegibilidade é real, não decorativo | ✅ PASSOU | `subscription-flow.test.ts` — 2 testes |
| 4 | Adesão independente da elegibilidade | ✅ PASSOU | `subscription-flow.test.ts` — 1 teste |
| 5 | Nada de preço hardcoded (config versionada) | ✅ PASSOU | `subscription-flow.test.ts` — 1 teste |
| 6 | AuditLog cobre mutações-chave | ⚠️ **NÃO VALIDADO como automático** | `AuditService` existe e funciona (usado no exemplo de Route Handler), mas **não é chamado automaticamente dentro dos Application Services** — é responsabilidade da camada de orquestração (use-case/route handler) chamá-lo explicitamente, por decisão de manter os serviços de domínio livres de cross-cutting concerns. Não há teste automatizado garantindo que toda mutação-chave gera um log — isso depende de disciplina na camada de orquestração, ainda não coberta por teste. Registrado em `docs/PENDENCIAS.md`. |
| 7 | Fundação da Conversation existe sem funcionar automaticamente | ✅ PASSOU | `foundation.test.ts` — 1 teste |
| 8 | Nenhuma regra clínica hardcoded | ✅ PASSOU (verificação manual) | `grep` no código-fonte + consulta direta ao banco confirmando ausência de `DeterministicSafetyRule` e de limiares clínicos — **não é um teste automatizado no CI**, foi checagem manual nesta sessão |
| 9 | Testes automatizados rodam em CI e passam | ⚠️ **PARCIAL** | Rodam e passam localmente (29/29, 5× consecutivas). **Não há pipeline de CI configurado nesta fatia** — nenhum `.github/workflows` ou equivalente foi criado. Registrado como pendência. |
| 10 | Isolamento RLS entre dois pacientes | ✅ PASSOU | `rls.test.ts` — 2 testes (SELECT e UPDATE cruzados) |
| 11 | Médico não acessa paciente fora da carteira | ✅ PASSOU | `rls.test.ts` — 1 teste |
| 12 | SUPPORT não acessa prontuário clínico por padrão | ✅ PASSOU | `rls.test.ts` — 1 teste |
| 13 | AuditLog não pode ser alterado por fluxo normal | ✅ PASSOU | `rls.test.ts` — 2 testes (UPDATE e DELETE rejeitados) |
| 14 | EligibilityDecision anterior nunca é sobrescrita | ✅ PASSOU | `subscription-flow.test.ts` — 2 testes |
| 15 | Mudança de preço não altera snapshot financeiro | ✅ PASSOU | `subscription-flow.test.ts` — 1 teste |
| 16 | Transição inválida de Subscription é rejeitada | ✅ PASSOU | `subscription-flow.test.ts` — 2 testes (serviço + trigger de banco) |
| 17 | Idempotência impede duplicação | ✅ PASSOU | `subscription-flow.test.ts` — 1 teste |
| 18 | Revogação de consentimento preserva histórico | ✅ PASSOU | `consent.test.ts` — 2 testes |
| 19 | Timestamps persistidos em UTC | ✅ PASSOU | `timestamps.test.ts` — 2 testes (tipo de coluna + instante absoluto independente de timezone de sessão) |
| 20 | Dados sensíveis não aparecem em claro | ✅ PASSOU | `sensitive-data.test.ts` — 4 testes (cifra, hash, last4, metadata sanitizada) |

**Resumo:** 18/20 PASSOU integralmente, 2/20 com ressalva explícita de escopo (não falharam — são lacunas de cobertura/infraestrutura já documentadas, não bugs).

---

## 7. Segurança — Resumo do que Foi Efetivamente Testado

- Isolamento entre pacientes (SELECT e UPDATE) — testado com manipulação direta de ID.
- Médico restrito à carteira atual (via função `SECURITY DEFINER`, sem recursão) — testado.
- SUPPORT sem acesso a `clinical_events` por padrão (ausência de policy = negado) — testado.
- `app_runtime` não executa DDL — testado ao vivo (`CREATE TABLE`, `ALTER TABLE`, `DROP TABLE`, todos rejeitados com `permission denied`).
- `app_runtime` não altera/apaga `AuditLog` — testado ao vivo (`UPDATE`/`DELETE` rejeitados).
- `EligibilityDecision` nunca sobrescrita — testado (múltiplas decisões, histórico íntegro).
- Mudança de preço não altera snapshot — testado.
- Idempotência — testado (chamada dupla, uma única linha).
- CPF/WhatsApp nunca em claro no banco onde definidos como cifrados — testado (valor cifrado nunca contém o texto original; hash determinístico mas não reversível).
- CPF/WhatsApp/conteúdo clínico não aparecem nos logs de teste — testado (metadata sanitizada verificada por estrutura; nenhum `console.log` no código de produção imprime esses campos).
- Timestamps timezone-aware — testado (tipo de coluna `timestamp with time zone` + instante absoluto estável entre sessões com timezones diferentes).
- MFA obrigatório bloqueia médico/admin no serviço de identidade — testado.
- Nenhuma regra clínica fictícia carregada — verificado (grep + consulta direta).

---

## 8. Decisões Técnicas

Ver `docs/DECISOES-TECNICAS.md` — inclui ADR-001 (Prisma → pg), monólito modular, PostgreSQL/Supabase planejado, RLS como mecanismo real (com o bug de recursão documentado), criptografia (finalidade de cada chave, rotação pendente, o que nunca vai para `.env.example`), snapshot financeiro, append-only, state machines (com a duplicação serviço/trigger documentada como risco), idempotência, ports/adapters.

---

## 9. Pendências

Ver `docs/PENDENCIAS.md` — classificadas em BLOCKER (Prisma Client real, rotação de chave, chaves fora de KMS), ANTES DO PILOTO (regra dos 180 dias, autenticação real via Supabase Auth, middleware de contexto HTTP real, RLS em `users`/`communication_consents`/`patient_communication_preferences`, teste de concorrência de idempotência), ANTES DA ESCALA (duplicação da state machine, sanitização automática de `AuditLog.metadata`, particionamento de tabelas de log/evento) e MELHORIA FUTURA (timeout configurável, testes de contrato dos Ports, CI automatizado da checagem de consistência, documentação de versionamento de config para o painel admin).

---

## 10. Como Executar Localmente

```bash
# 1. Banco (assume PostgreSQL 16 instalado)
service postgresql start
psql -c "CREATE DATABASE renovamed;"
psql -c "CREATE ROLE app_migrator LOGIN PASSWORD 'SEU_PASSWORD' SUPERUSER;"
psql -c "CREATE ROLE app_runtime LOGIN PASSWORD 'SEU_PASSWORD';"
psql -c "GRANT ALL PRIVILEGES ON DATABASE renovamed TO app_migrator;"
psql -c "GRANT CONNECT ON DATABASE renovamed TO app_runtime;"

# 2. Migrations (nesta ordem)
psql -U app_migrator -d renovamed -f prisma/migrations/0001_init.sql
psql -U app_migrator -d renovamed -f prisma/migrations/0002_security_hardening.sql
psql -U app_migrator -d renovamed -f prisma/migrations/0003_fix_rls_recursion.sql
psql -U app_migrator -d renovamed -f prisma/migrations/0004_fix_system_role_select.sql
psql -U app_migrator -d renovamed -f prisma/migrations/0005_harden_uuid_casts.sql
psql -U app_migrator -d renovamed -f prisma/migrations/0006_fix_conversation_messages_policy.sql

# 3. Dependências
npm install

# 4. Variáveis de ambiente
cp .env.example .env   # preencher com valores reais de desenvolvimento

# 5. Verificações
npm run typecheck
npm run lint
npm run build
npm test
```

---

## 11. Variáveis de Ambiente

| Variável | Finalidade |
|---|---|
| `DATABASE_URL` | Conexão de runtime da aplicação (role `app_runtime`, privilégios restritos) |
| `MIGRATE_DATABASE_URL` | Conexão usada só para aplicar migrations (role `app_migrator`) — nunca usada em runtime |
| `FIELD_ENCRYPTION_KEY` | Chave AES-256-GCM (32 bytes, base64) para cifrar CPF/WhatsApp em repouso |
| `FIELD_HASH_SECRET` | Segredo para HMAC-SHA256 usado no hash determinístico de CPF (unicidade/busca) |
| `SUPABASE_URL` | URL do projeto Supabase (Auth + Storage) — a preencher quando a integração real for feita |
| `SUPABASE_ANON_KEY` | Chave anônima do Supabase — a preencher quando a integração real for feita |
| `SUPABASE_SERVICE_ROLE_KEY` | Chave de service role do Supabase — a preencher quando a integração real for feita |

Nenhum valor real está no repositório — `.env.example` contém apenas nomes e placeholders `CHANGE_ME`.

---

## 12. Estrutura do Repositório

```
renovamed/
├── prisma/
│   ├── schema.prisma                 # fonte de verdade documental (com @map completo)
│   └── migrations/*.sql              # 6 migrations SQL aplicadas, em ordem
├── src/
│   ├── app/                          # Next.js App Router (layout, page, 1 API route de exemplo)
│   ├── modules/                      # 10 módulos de domínio (application/domain/infrastructure)
│   ├── ports/                        # interfaces + implementações Fake
│   └── lib/                          # db.ts (contexto RLS), encryption.ts
├── tests/
│   ├── unit/                         # 1 arquivo (dados sensíveis)
│   └── integration/                  # 5 arquivos (fundação, RLS, assinatura, consentimento, timestamps)
└── docs/
    ├── DECISOES-TECNICAS.md
    └── PENDENCIAS.md
```

Repositório completo entregue como `renovamed-fatia1.tar.gz` (sem `node_modules`, `.next` ou `.env`).
