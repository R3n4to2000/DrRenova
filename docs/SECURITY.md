# Renovamed — Segurança da Fundação (Fatia 1)

Este documento descreve o modelo de segurança efetivamente implementado e testado na Fundação do Renovamed. Não é um documento de política — é uma descrição técnica do que existe.

---

## 1. Modelo de Autorização

Quatro papéis: `PATIENT`, `DOCTOR`, `ADMIN`, `SUPPORT` (mais `SYSTEM`, interno, para operações de processo/scheduler). Autorização acontece em duas camadas independentes que se reforçam:

1. **RLS no PostgreSQL** — a autoridade final. Mesmo que uma camada de aplicação tenha um bug, o banco recusa a linha.
2. **HTTP Security Context** — resolve identidade verificada (nunca de headers arbitrários) antes de qualquer chamada de domínio.

Princípio de menor privilégio aplicado em todas as camadas: nenhum papel tem mais acesso do que o estritamente necessário para sua função (ex.: SUPPORT nunca vê dado clínico; DOCTOR só vê/altera a própria carteira).

---

## 2. RLS (Row-Level Security)

Ativado em 12 tabelas: `patients`, `doctors`, `doctor_patient_assignments`, `treatments`, `subscriptions`, `adesoes`, `eligibility_decisions`, `clinical_events`, `conversations`, `conversation_messages`, `users`, `communication_consents`, `patient_communication_preferences`.

**Padrão geral:** paciente vê/altera só a própria linha; médico vê/altera só o que está atualmente em sua carteira (via `doctor_patient_assignments.is_current = true`); ADMIN/SYSTEM têm acesso amplo através de policies `FOR ALL`; SUPPORT não tem policy em nenhuma tabela clínica — ausência de policy = acesso negado por padrão no Postgres.

**Funções `SECURITY DEFINER`** (`fn_doctor_has_patient`, `fn_doctor_has_treatment`) resolvem a checagem de carteira sem causar recursão de RLS entre `patients` e `doctor_patient_assignments` (bug real encontrado e corrigido — ver migration 0003).

**Gap de segurança real encontrado e corrigido nesta rodada final:** as policies de escrita `treatments_service_update`, `clinical_events_write` e `eligibility_doctor_write` permitiam que **qualquer médico** escrevesse em tratamentos/eventos/decisões de **qualquer paciente**, sem checar a carteira — diferente das policies de leitura, que já checavam corretamente. Corrigido na migration 0008, testado explicitamente (`tests/integration/final-adversarial.test.ts`).

---

## 3. HTTP Security Context

`src/lib/http-context.ts` implementa `resolveAppContext(headers)`:

- Extrai `Authorization: Bearer <token>` e verifica a assinatura via `src/lib/session-token.ts` (HMAC-SHA256, placeholder pré-Supabase Auth — ver PENDENCIAS.md).
- `patientId`/`doctorId` são **derivados por consulta ao banco** a partir do `userId` verificado — nunca aceitos de um campo enviado pelo cliente.
- `tenantId` é uma constante fixa do servidor (`SINGLE_TENANT_ID`) — nunca lido de header.
- Headers como `x-user-role` e `x-tenant-id` são **conscientemente ignorados** — testado explicitamente (`tests/integration/http-context.test.ts`, Regressões 4 e 5).
- Token ausente, malformado, adulterado ou expirado → `UnauthorizedError`, testado.

---

## 4. MFA

`IdentityService.assertLoginAllowed()` bloqueia login de `DOCTOR`/`ADMIN` sem `mfaEnabled=true` — testado (`foundation.test.ts`). O claim `mfaVerified` viaja no token de sessão e é exposto no contexto resolvido (`ctx.mfaVerified`) para checagens adicionais por rota, quando necessário.

---

## 5. Criptografia

**Campos cifrados (AES-256-GCM, reversível):** `Patient.cpfEncrypted`, `Patient.whatsappEncrypted`. Chave: `FIELD_ENCRYPTION_KEY` (32 bytes, base64).

**HMAC para lookup (não reversível):** `Patient.cpfHash` (HMAC-SHA256, chave `FIELD_HASH_SECRET`) — usado exclusivamente para a constraint `UNIQUE` e busca por CPF; nunca decodificado, nunca logado.

**Gerenciamento/versionamento/rotação de chaves:** **não implementado nesta fatia** (BLOCKER registrado em PENDENCIAS.md). O esquema atual assume uma única chave ativa — rotação real exigiria versionar o payload cifrado (ex.: prefixo `v1:`/`v2:`) e um processo de re-criptografia em lote. Antes de qualquer dado real de paciente, isso precisa existir, e as chaves precisam sair de `.env` para um KMS gerenciado.

**Testado:** valor cifrado nunca contém o texto original (`sensitive-data.test.ts`, `final-adversarial.test.ts` — verificação direta na coluna do banco, não só na função de cifra).

---

## 6. Auditoria

`runAuditedCommand` (`src/lib/audited-command.ts`) torna a auditoria estruturalmente obrigatória para mutações críticas — ver seção dedicada no relatório final (item 8). `AuditLog` é append-only por **GRANT de banco** (`REVOKE UPDATE, DELETE ON audit_logs FROM app_runtime`), não só por convenção — testado com tentativa real de `UPDATE`/`DELETE`.

---

## 7. Sanitização de Metadata

`src/lib/audit-sanitizer.ts`, chamada incondicionalmente por `AuditService.record` — não é opt-in do chamador. Estratégia em três camadas: allowlist de padrão de nome de chave, blacklist de nomes conhecidos (`cpf`, `whatsapp`, `token`, `password`, `clinicalNote`, etc.), e detecção de padrão de valor (CPF, telefone, JWT, token longo) mesmo com chave "inocente". Rejeita objetos/arrays aninhados. Testado com tentativas deliberadas de inserir cada tipo de dado proibido (`audit-mandatory.test.ts`).

---

## 8. Idempotência

`AdesaoService.createAdesao` usa `INSERT ... ON CONFLICT (idempotency_key) DO NOTHING`, atômico no nível do Postgres — corrige uma race condition real de uma implementação anterior (`SELECT` → `INSERT`). Testado com 20 chamadas verdadeiramente concorrentes (`idempotency-concurrency.test.ts`).

---

## 9. Tratamento de Dados Clínicos

`ClinicalEvent.payload` (jsonb) e `EligibilityDecision.clinicalNote` armazenam conteúdo clínico nas entidades apropriadas — nunca em `AuditLog.metadata` (bloqueado estruturalmente pelo sanitizador) nem em logs técnicos comuns. Nenhuma regra clínica (limiar, protocolo, critério de urgência) está hardcoded no código ou pré-carregada no banco — verificado por teste automatizado que varre o código-fonte (`final-adversarial.test.ts`).

---

## 10. Diferença Entre Role de Migration e Runtime

- `app_migrator` — superuser, usado **só** para aplicar migrations (`MIGRATE_DATABASE_URL`). Nunca usado pela aplicação em runtime.
- `app_runtime` — privilégios restritos (`DATABASE_URL`): sem DDL, sem `UPDATE`/`DELETE` em `audit_logs`, sem `DELETE` em entidades de retenção (patients, treatments, subscriptions, adesoes, eligibility_decisions, clinical_events, conversation_messages, communication_consents, subscription_status_transitions). Testado explicitamente que `app_runtime` não executa `CREATE TABLE`/`ALTER TABLE` (`final-adversarial.test.ts`).

---

## 11. Ameaças Explicitamente Testadas

| Ameaça | Testado em |
|---|---|
| Paciente A lê/altera dado de Paciente B | `rls.test.ts` |
| Médico lê/altera paciente fora da carteira | `rls.test.ts`, `final-adversarial.test.ts` |
| SUPPORT acessa dado clínico | `rls.test.ts` |
| Header forjado concede autorização (role/tenant) | `http-context.test.ts` |
| Token adulterado/ausente cria contexto | `http-context.test.ts` |
| Médico/admin loga sem MFA | `foundation.test.ts` |
| Runtime executa DDL | `final-adversarial.test.ts` |
| Runtime altera/apaga AuditLog | `rls.test.ts` |
| EligibilityDecision sobrescrita | `subscription-flow.test.ts` |
| Subscription ativa sem APPROVED | `subscription-flow.test.ts` |
| Transição inválida de Subscription | `subscription-flow.test.ts` |
| Preço muda e afeta snapshot já persistido | `subscription-flow.test.ts` |
| Concorrência duplica Adesao | `idempotency-concurrency.test.ts` |
| Falha de auditoria deixa mutação persistida | `audit-mandatory.test.ts` |
| Metadata proibida é aceita | `audit-mandatory.test.ts` |
| CPF/WhatsApp em claro no banco | `final-adversarial.test.ts` |
| Regra clínica fictícia hardcoded | `final-adversarial.test.ts` |
