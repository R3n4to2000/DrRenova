# Renovamed — Relatório: MVP Integration

## Status Geral do MVP

**Integrado parcialmente, com o núcleo clínico + Camilla + pagamento + telemedicina + admin mínimo funcionando de ponta a ponta sobre banco real. Auth real e providers de produção (WhatsApp/pagamento/prescrição/telemedicina) permanecem em STAGING — corretamente isolados atrás de Ports, nunca hardcoded.**

---

## Fluxos que Funcionam Ponta a Ponta (testado, não assumido)

1. **Paciente ativo → Engine → Camilla → check-in → médico → decisão → próxima revisão** — já demonstrado na Fatia 2 com telas reais, agora com Camilla se apresentando na ativação e reagindo aos eventos.
2. **Cobrança de Adesão → gateway staging → PAID/FAILED → Adesao** — `chargeAdesaoCommand`, testado.
3. **Consulta inicial → TelemedicineProviderPort (staging) → ClinicalEvent** — `conductInitialConsultationCommand`, typecheck ok (sem teste dedicado ainda — ver Pendências).
4. **WhatsApp inbound (staging) → Safety Rules → Intent Classifier → resposta/Escalation** — webhook real, idempotente, testado (2 testes).
5. **Confirmação conversacional → CheckInAnswer** — dado só persiste após confirmação explícita, testado.
6. **DoctorDecision → Camilla notifica desfecho permitido** — integrado na mesma transação auditada.
7. **Prescription entregue → Camilla avisa** — integrado.
8. **Admin mínimo** — Visão Geral, Corpo Clínico, Configuração (planos/categorias/regras), Camilla (métricas + Engagement Coverage D30/60/90), Auditoria — 5 páginas reais lendo dados reais.

---

## O Que é Integração Real vs. Staging vs. Pendente

| Componente | Status |
|---|---|
| Treatment Continuity Engine | **REAL** (Fatia 2, inalterado) |
| DoctorDecision/Intercorrencia/CheckIn | **REAL** |
| Auditoria transacional (`runAuditedCommand`) | **REAL** |
| RLS/HTTP Security Context | **REAL** |
| Deterministic Safety Rules Engine | **REAL** (mecanismo); regras em si nascem **vazias** — Direção Médica ainda não populou |
| Intent Classifier | **ADAPTER FAKE/STAGING** (heurística por palavra-chave, não LLM) |
| Answer Structurer | **ADAPTER FAKE/STAGING** (regex simples) |
| WhatsApp Gateway | **ADAPTER FAKE/STAGING** (webhook real, envio simulado) |
| Payment Gateway | **ADAPTER FAKE/STAGING** (sempre aprova) |
| Telemedicine Provider | **ADAPTER FAKE/STAGING** |
| Prescription Provider | **ADAPTER FAKE/STAGING** (já existia da Fatia 2) |
| Autenticação (dev-login) | **PENDENTE FORNECEDOR** — placeholder explícito, bloqueado fora de dev |
| Admin (5 páginas) | **REAL** (lê dados reais, sem mock) |

---

## Camilla — Capacidades e Limites

**Capacidades reais:** apresentação única, notificação de check-in (respeitando frequency cap/opt-out), pipeline Safety→Intent→resposta, escalonamento via Intercorrencia (reaproveitando a fila médica existente — nenhuma fila paralela), confirmação explícita antes de persistir dado clínico, observabilidade completa (PromptVersion + AIExecution por interação).

**Limites explícitos:** classificação de intenção e estruturação de texto são heurísticas simples (staging), não um LLM real — não há acesso a provedor de IA neste ambiente. Nenhuma regra determinística real está carregada (por design). Resolução de paciente por número de WhatsApp real não está implementada (staging aceita `patientId` direto).

## WhatsApp
**Status:** webhook inbound real e testado (idempotente, respeita opt-out). Envio outbound é staging (loga, não entrega de fato). Falta: resolução por hash de telefone real, retry de entrega, status de entrega real.

## Pagamentos
**Status:** `chargeAdesaoCommand` fecha o fluxo (cria Adesao idempotente → chama gateway → só marca PAID se confirmado). Gateway é staging (sempre aprova). Mensalidade continua nunca cobrada antes de `EligibilityDecision.APPROVED` (inalterado da Fatia 1).

## Telemedicina
**Status:** `conductInitialConsultationCommand` suporta as duas estratégias (médico próprio/fornecedor externo) via Port, gera `ClinicalEvent`. Fornecedor real (R$3,40 ou outro) não contratado — staging.

## Prescrição
**Status:** fluxo completo já existia (Fatia 2): DRAFT→PENDING_SIGNATURE→SIGNED→DELIVERED, agora com Camilla avisando na entrega. Fornecedor jurídico real pendente.

## Auth
**Status:** dev-login (placeholder), bloqueado por `NODE_ENV==='production'` a menos que `ALLOW_DEV_LOGIN=true`. **Não pode ir a produção como está — BLOCKER real para piloto.**

## Admin
**Status:** 5 páginas funcionais reais (Visão Geral, Corpo Clínico, Configuração, Camilla, Auditoria) — sem mock, leem o banco diretamente sob RLS.

---

## Segurança — Regressões + Novos Testes

**Nenhuma regressão** — Fatia 1 (59 testes) e Fatia 2 (18 testes) seguem 100% passando.

**Novos testes desta rodada:** 11 (Camilla: 9 + WhatsApp webhook: 2). Total: **88 testes**, 0 falhas, 5 execuções consecutivas em banco reconstruído do zero (10 migrations), 0 flaky.

**Bugs reais encontrados e corrigidos nesta rodada:**
1. Teste desatualizado assumia ausência de `DeterministicSafetyRule` — corrigido para validar o invariante real (existe, mas vazia).
2. Regex de "regra hardcoded" batia no próprio nome da classe legítima — corrigido.
3. `resetTestData` com ordem de FK incorreta para as novas tabelas.
4. **`CommunicationRulesEngine` nunca funcionava de verdade** — `conversationService.addMessage` não aceitava `messageType`, então nenhuma mensagem proativa era marcada `SYSTEM_NOTICE`, e o frequency cap nunca encontrava nada para comparar. Corrigido extensivamente (aditivo, sem quebrar chamadas antigas).
5. **Consistência schema×banco só verificava uma direção** — 4 tabelas novas (Camilla) criadas via SQL nunca teriam sido detectadas como ausentes do `schema.prisma`. Adicionei checagem reversa (tabela→modelo) ao script — achado real, corrigido, e os 4 modelos foram adicionados ao schema.

---

## Testes

- **Unitários/integração:** 88, todos passando, 5× consecutivas em banco limpo.
- **E2E (Playwright):** **NÃO implementado nesta rodada** — não tentei instalar (o padrão de bloqueio de download de binário já visto com o Prisma Engine tornava improvável a instalação do browser do Playwright neste sandbox, e o tempo restante não permitiu validar isso com segurança). Como mitigação, os fluxos ponta a ponta foram validados via scripts diretos chamando os mesmos Commands que as rotas HTTP usam (mesma técnica já usada com sucesso na Fatia 2) — não substitui Playwright real, mas prova que a lógica de negócio funciona de ponta a ponta.

---

## Staging — Pronto ou Não para Deploy

**NÃO está pronto para deploy de staging real.** Faltam: variáveis de ambiente documentadas para staging especificamente (existe `.env.example`, mas não um `.env.staging.example`), seed fictício formal para popular um ambiente novo, healthcheck endpoint, feature flags. O `RUNBOOK.md` cobre desenvolvimento local, não staging.

---

## BLOCKERS PARA PILOTO (reais, não hipotéticos)

1. **Auth real (Supabase ou equivalente)** — dev-login não pode ir a paciente real.
2. **KMS + rotação de chave de criptografia** — herdado, ainda não resolvido.
3. **Protocolos da Camilla aprovados pela Direção Médica** — Deterministic Safety Rules seguem vazias; sem isso, a Camilla escala tudo que não é puramente administrativo (comportamento seguro, mas não é o produto final).
4. **Fornecedor de prescrição juridicamente válido.**
5. **Interpretação jurídica da regra dos 180 dias.**
6. **WhatsApp real** — resolução de paciente por telefone real não implementada.

---

## Próximo Passo

**MVP AINDA NÃO INTEGRADO — ITENS NECESSÁRIOS ANTES DO PILOT READINESS.**

Itens necessários, em ordem de prioridade: (1) Auth real, (2) resolução de paciente por WhatsApp real, (3) Playwright E2E, (4) staging formal (seed, healthcheck, env docs), (5) aprovação médica das Safety Rules, (6) fornecedores reais de pagamento/prescrição/telemedicina.
