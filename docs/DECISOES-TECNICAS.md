# Renovamed — Decisões Técnicas (Fatia 1)

## ADR-001: Prisma indisponível no sandbox → `pg` utilizado temporariamente

**Status:** Aceito como adaptação temporária do ambiente de desenvolvimento atual — não é uma migração de arquitetura.

**Contexto:** o Prisma CLI/Client depende do download de binários de engine hospedados em `binaries.prisma.sh`. A política de rede deste ambiente de execução bloqueia esse domínio (confirmado: `403 Forbidden` em `prisma generate`, `prisma format` e `prisma validate`).

**Decisão:** `prisma/schema.prisma` permanece como **fonte de verdade documental** do modelo de dados. As migrations reais são SQL puro (`prisma/migrations/*.sql`), aplicadas manualmente com `psql`. O acesso a dados na aplicação usa `pg` (`node-postgres`) diretamente, através da mesma camada de Repository que seria usada com Prisma Client — os módulos de domínio dependem de `AppContext`/`PoolClient`, nunca de `PrismaClient` ou de `pg` importado diretamente fora de `src/lib/db.ts`.

**Consequência verificada nesta fatia:** como `schema.prisma` não tinha `@map()` por campo inicialmente, uma checagem de consistência formal (ver seção abaixo) encontrou que ele divergiria silenciosamente das colunas reais (camelCase vs. snake_case) no dia em que o Prisma Client voltasse a ser usável. Corrigido: todo campo agora tem `@map()` explícito e todo enum tem `@@map()`, verificado programaticamente contra `information_schema.columns` — **0 divergências em 19 tabelas**.

**Reversão:** quando o ambiente de deploy tiver acesso de rede normal (Vercel, CI com egress liberado, etc.), `prisma generate` e `prisma migrate` voltam a funcionar sem qualquer alteração de schema — só é preciso trocar a camada de Repository de `pg` para `PrismaClient`, mantendo os Application Services intactos (eles não conhecem o driver concreto).

---

## Monólito Modular

Optamos por um monólito modular (não microsserviços) para o MVP: `src/modules/{identity,patient,doctor,treatment,subscription,conversation,config,audit,analytics}`, cada um com `application/domain/infrastructure`. Nenhum módulo importa Prisma/pg diretamente — tudo passa por `withContext()`. Isso evita overengineering agora, mas mantém fronteiras claras o suficiente para extrair um módulo (ex.: `conversation` viraria o backend da Camilla) como serviço próprio depois, sem reescrever os demais.

## PostgreSQL + Supabase (planejado)

PostgreSQL como banco único. Supabase é o destino planejado para Auth + Storage — mas o domínio nunca importa o SDK do Supabase diretamente; `User.authUserId` é o único ponto de acoplamento (um espelho do id do Supabase Auth), e toda regra de negócio opera sobre `User.id` interno.

## RLS Como Mecanismo Real, Não Documental

RLS ativado em 10 tabelas (patients, doctors, doctor_patient_assignments, treatments, subscriptions, adesoes, eligibility_decisions, clinical_events, conversations, conversation_messages), com 34 policies no total. O contexto de RLS (`app.current_role`, `app.current_user_id`) é definido pela aplicação a cada transação via `withContext()` — em produção sobre Supabase, esse mesmo contrato seria alimentado a partir do JWT (papel do PostgREST), mas aqui replicamos explicitamente para nunca depender do SDK do Supabase dentro do domínio.

**Bug real corrigido:** policies que faziam subquery direta entre `patients` e `doctor_patient_assignments` causavam recursão estrutural ("infinite recursion detected in policy"). Corrigido com funções `SECURITY DEFINER` (`fn_doctor_has_patient`, `fn_doctor_has_treatment`), de propriedade de um role que ignora RLS, quebrando o ciclo de expansão de policies.

## Criptografia de Dados Sensíveis

**Campos cifrados (AES-256-GCM, reversível):** `Patient.cpfEncrypted`, `Patient.whatsappEncrypted`.

**Campos com hash (HMAC-SHA256, não reversível):** `Patient.cpfHash` — usado exclusivamente para constraint de unicidade e busca; nunca é decodificado, nunca aparece em log, nunca é exibido.

**Finalidade da chave de criptografia (`FIELD_ENCRYPTION_KEY`):** decifra CPF/WhatsApp quando um fluxo legítimo precisa do valor original (ex.: exibir para o próprio paciente, enviar mensagem via WhatsApp). Chave AES-256 (32 bytes, base64), nunca hardcoded — vem de variável de ambiente.

**Finalidade da chave HMAC (`FIELD_HASH_SECRET`):** gerar o hash determinístico de CPF para permitir a constraint `UNIQUE` no banco e busca por CPF sem nunca expor ou permitir reversão do valor original a partir do hash.

**Rotação de chaves (pendência formal, ver docs/PENDENCIAS.md):** o esquema atual assume uma única chave ativa. Rotação real exige versionar a chave (ex.: prefixo `v1:`/`v2:` no payload cifrado) e um processo de re-criptografia em lote — **não implementado nesta fatia**, registrado como pendência antes de dados reais de produção.

**Como evitar perda de capacidade de descriptografia:** a chave nunca deve existir em um único lugar — recomienda-se KMS gerenciado (ex.: AWS KMS, GCP KMS) com backup de chave mestra fora do ambiente de aplicação antes de qualquer dado real de paciente ser gravado. Nesta fatia, a chave vive apenas em `.env` local, o que é aceitável só para desenvolvimento.

**O que nunca deve ir para `.env.example`:** nenhum valor real de chave, secret do Supabase, senha de banco ou string de conexão com credencial real — `.env.example` contém apenas nomes de variável e um placeholder `CHANGE_ME`, nunca um valor funcional, nem mesmo de desenvolvimento.

## Snapshot Financeiro

`Subscription.monthlyAmountSnapshot`/`annualAmountSnapshot` e `Adesao.amountSnapshot` são gravados no momento da criação, a partir da versão vigente de `PlanConfig` — nunca recalculados. Testado explicitamente: alterar `PlanConfig` via `publishNewPlanVersion()` (que cria uma nova versão e aposenta a anterior) não altera nenhum snapshot já persistido.

## Append-Only

`AuditLog`, `EligibilityDecision`, `CommunicationConsent` (na parte de aceite) e `SubscriptionStatusTransition` nunca são atualizados/sobrescritos por fluxo normal — apenas novas linhas são inseridas. Para `AuditLog`, isso é reforçado não só por convenção de código, mas por `REVOKE UPDATE, DELETE` no papel de runtime (`app_runtime`) — verificado com tentativa real de `UPDATE`/`DELETE`, ambas rejeitadas com `permission denied`.

## State Machines

`Subscription.status` segue transições explícitas (`PENDING_ELIGIBILITY → ACTIVE/CANCELLED`, `ACTIVE → PAST_DUE/CANCELLED`, `PAST_DUE → ACTIVE/CANCELLED`), validadas em dois lugares deliberadamente (defesa em profundidade): na camada de serviço (`SubscriptionService.transition()`, falha antes de tocar o banco) e no banco (trigger `check_subscription_transition`, falha mesmo se o serviço for contornado). **Pendência registrada:** a lista de transições permitidas está duplicada nos dois lugares — risco de divergência futura se um for alterado sem o outro (ver docs/PENDENCIAS.md).

## Idempotência

Tabela genérica `idempotency_keys` (chave, escopo, referência ao resultado). Usada hoje em `AdesaoService.createAdesao()` — uma chamada repetida com a mesma `idempotencyKey` retorna a `Adesao` já criada, nunca cria uma segunda. Testado explicitamente com chamada dupla.

## Ports/Adapters

`src/ports/index.ts` define `PaymentGatewayPort`, `WhatsAppGatewayPort`, `TelemedicineProviderPort`, `SchedulerPort`, `StoragePort` — todas com implementação `Fake` (`src/ports/fakes.ts`) nesta fatia. Nenhum serviço de domínio importa um SDK de fornecedor diretamente.

## Camada de Entrega Não Contém Regra de Negócio

`src/app/api/adesao/route.ts` (exemplo) usa `resolveAppContext` + `createAdesaoCommand` — parsing de request, resolução de contexto verificado e delegação. Toda regra de negócio vive em `src/modules/*/application`.

---

## ADR-002: Auditoria Estrutural Obrigatória (`runAuditedCommand`)

**Contexto:** `AuditService` existia, mas nada impedia um Application Service de mutar dados sem gerar `AuditLog` — dependia de disciplina do desenvolvedor lembrar de chamar `auditService.record()`.

**Decisão:** unit-of-work simples (`src/lib/audited-command.ts`). Uma função de "Command" (`src/modules/*/application/*.commands.ts`) executa a mutação e retorna `{ result, entityId, metadata? }` — o `entityId` é obrigatório no tipo de retorno, então não há como escrever um Command sem declarar o que auditar. `runAuditedCommand` grava o `AuditLog` **na mesma transação** da mutação (mesmo `client`, mesmo `BEGIN`/`COMMIT` de `withContext`). Se a gravação do audit falhar (ex.: `sanitizeAuditMetadata` rejeita o payload), a exceção sobe e `withContext` faz `ROLLBACK` de tudo — a mutação "que funcionou" é desfeita junto.

**Alternativas consideradas e descartadas:** command bus genérico (complexidade desproporcional ao tamanho do domínio agora); espalhar chamadas manuais de `auditService.record()` pelos Services (não resolve o problema — ainda dependeria de disciplina).

**Cobertura:** Patient, Doctor, Carteira (assign/end), Treatment, Subscription (create/transition/activate), Adesao (create/markPaid), EligibilityDecision, CommunicationConsent (accept/revoke), Config (publishNewVersion). Os Services originais (`*.service.ts`) continuam existindo e sendo testados diretamente pelos 29 testes originais — os Commands são uma camada nova por cima, não uma reescrita.

## ADR-003: Sanitização Central de Audit Metadata

`src/lib/audit-sanitizer.ts`, chamada incondicionalmente dentro de `AuditService.record` (não é opt-in). Allowlist de padrão de chave + blacklist de nomes conhecidos + detecção de padrão de valor (CPF/telefone/JWT/token longo). **Bug real encontrado na própria implementação:** a heurística inicial de "token longo" capturava UUIDs legítimos (que contêm hífen) como se fossem segredos — corrigido excluindo o hífen do padrão e tratando UUID como formato seguro explícito.

## ADR-004: HTTP Security Context (Placeholder Pré-Supabase)

`src/lib/session-token.ts` + `src/lib/http-context.ts`. Sessão assinada com HMAC-SHA256 (`jsonwebtoken`, `SESSION_TOKEN_SECRET`) — mecanismo temporário e explicitamente documentado como tal, **não** uma simulação de conexão com o Supabase. Quando o Supabase Auth real for integrado, a única troca é a função de verificação (`verifySessionToken` → verificação do JWT do Supabase); o contrato posterior (claims verificadas → `AppContext`) não muda. `patientId`/`doctorId`/`tenantId` são sempre derivados no servidor a partir do `userId` verificado — nunca aceitos de headers do cliente.

## ADR-005: Correção Atômica de Idempotência

**Bug real encontrado:** `AdesaoService.createAdesao` fazia `SELECT` (existe?) seguido de `INSERT` — uma race condition clássica (TOCTOU) sob concorrência verdadeira: duas transações podiam passar pelo `SELECT` antes de qualquer uma commitar o `INSERT`, produzindo duas `Adesao`s para a mesma `idempotencyKey`.

**Correção:** `INSERT ... ON CONFLICT (idempotency_key) DO NOTHING RETURNING *`, atômico no nível do Postgres — a constraint `UNIQUE` já existente garante que, sob concorrência real, apenas uma transação insere; as demais recebem 0 linhas do `INSERT` e buscam a linha vencedora com um `SELECT` subsequente (que, sob `READ COMMITTED`, só executa depois que a transação vencedora commitou, então sempre encontra a linha). Testado com 20 chamadas verdadeiramente concorrentes (`Promise.all`), 5 execuções consecutivas sem falha.

## ADR-006: Gap de Escopo de Escrita do Médico (Corrigido)

**Bug de segurança real encontrado** na bateria final de testes adversariais: as policies de escrita `treatments_service_update`, `clinical_events_write` e `eligibility_doctor_write` permitiam que qualquer `DOCTOR` escrevesse em tratamentos/eventos/decisões de **qualquer** paciente, sem checar a carteira — assimetria em relação às policies de leitura (que já checavam corretamente via `fn_doctor_has_treatment`). Corrigido na migration `0008_fix_doctor_write_scope_gap.sql`, restringindo as três policies para exigir `fn_doctor_has_treatment` também na escrita. Testado explicitamente, incluindo o caminho legítimo (médico dentro da carteira continua conseguindo escrever).

