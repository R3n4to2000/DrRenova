# Renovamed — Pendências (Fundação, estado final)

Classificação: **BLOCKER** (impede produção), **ANTES DO PILOTO** (necessário antes de pacientes reais), **ANTES DA ESCALA** (necessário antes de volume relevante), **MELHORIA FUTURA** (não bloqueia nada, é ganho incremental).

Itens marcados **[RESOLVIDO NESTA RODADA]** foram fechados na rodada de hardening final e são mantidos aqui só para rastreabilidade histórica.

---

## BLOCKER

- **Rotação de chave de criptografia não implementada.** O esquema atual (`FIELD_ENCRYPTION_KEY` única) não suporta rotação sem re-criptografar todos os registros manualmente. Antes de qualquer CPF/WhatsApp real ser gravado, isso precisa de um esquema de versionamento de chave.
- **Chaves de criptografia vivem em `.env` local.** Aceitável para desenvolvimento; inaceitável para produção. Precisa de KMS gerenciado antes de dados reais.

## ANTES DO PILOTO

- **Regra dos 180 dias (Resolução CFM 2.314/2022) permanece não implementada.** O campo `Treatment.lastInPersonContactAt` existe, mas nenhuma lógica de alerta/obrigatoriedade está codificada — depende de validação jurídica/médica ainda pendente.
- **`DeterministicSafetyRule` não existe nesta fatia** (correto — pertence à Fatia 3, Camilla). Confirmado por teste automatizado que nenhum valor clínico fictício está no código ou no banco.
- **Autenticação real via Supabase Auth não integrada.** O mecanismo de sessão assinada (`SESSION_TOKEN_SECRET`) é um placeholder documentado — funciona e é testado, mas não é Supabase. O fluxo de criação de conta/login real ainda não existe.
- ~~Middleware de resolução de `AppContext` a partir da sessão HTTP não existe.~~ **[RESOLVIDO NESTA RODADA]** — `resolveAppContext` implementado e testado (`http-context.test.ts`).
- ~~Testes de carga/concorrência de idempotência não realizados.~~ **[RESOLVIDO NESTA RODADA]** — bug real de race condition encontrado e corrigido; testado com 20 chamadas concorrentes.
- ~~RLS não cobre `users`, `communication_consents`, `patient_communication_preferences`.~~ **[RESOLVIDO NESTA RODADA]** — RLS ativado e testado nas três tabelas.
- **Sem paginação/particionamento em `audit_logs` e `analytics_events`.** Aceitável em volume baixo; precisa de estratégia antes de volume alto.

## ANTES DA ESCALA

- **Duplicação da tabela de transições permitidas de `Subscription`** entre `SubscriptionService` (TypeScript) e o trigger `check_subscription_transition` (SQL). Correto como defesa em profundidade agora; arriscado em escala se um for alterado sem o outro.
- ~~`AuditLog.metadata` depende de disciplina do chamador.~~ **[RESOLVIDO NESTA RODADA]** — sanitização central obrigatória implementada (`audit-sanitizer.ts`), testada com tentativas deliberadas de burlar.
- **Prisma Client não gerado neste ambiente de execução.** `pg` é o runtime funcional e testado; a decisão de voltar ao Prisma Client é arquitetural futura (dependente de acesso de rede normal no ambiente de deploy), não uma dívida automática enquanto `pg` continuar funcionando corretamente — ver docs/DECISOES-TECNICAS.md, ADR-001.

## MELHORIA FUTURA

- Consolidar o helper `withContext` para suportar timeout configurável de transação.
- Adicionar testes de contrato para os `Ports` (`PaymentGatewayPort`, etc.) que qualquer implementação real precisaria satisfazer.
- ~~Automatizar a checagem de consistência `schema.prisma × banco` como passo de CI.~~ **[RESOLVIDO NESTA RODADA]** — `scripts/check-schema-consistency.mjs` integrado ao workflow de CI.
- Documentar formalmente o processo de rotação/versionamento de `PlanConfig`/`CategoryConfig` para quem for operar o painel administrativo (Fatia 5).
- Considerar gerar a lista de transições permitidas de `Subscription` a partir de uma única fonte (hoje duplicada entre serviço e trigger, deliberadamente, como defesa em profundidade).
