# Renovamed — Arquitetura (MVP v1.0)

Visão consolidada. Para o raciocínio por trás de cada decisão (ADRs), ver `DECISOES-TECNICAS.md` — este documento descreve o que existe, não por que foi decidido.

## Camadas

```
Route Handler / Server Action (entrega — sem regra de negócio)
        ↓
Command (runAuditedCommand — auditoria obrigatória, mesma transação)
        ↓
Service (regra de domínio pura)
        ↓
Repository (SQL direto via node-postgres)
        ↓
PostgreSQL (RLS como autoridade final)
```

Chamadas externas (WhatsApp, Payment, Prescription, Telemedicine, LLM) sempre atrás de um Port — nunca importadas diretamente por um Service. Ver `docs/PROVIDERS.md`.

## Módulos (monólito modular)

| Módulo | Responsabilidade |
|---|---|
| identity | Users, RBAC, MFA |
| patient | Patient (dados cifrados), identidade WhatsApp |
| doctor | Doctor, carteira (DoctorPatientAssignment) |
| treatment | Treatment, consulta inicial |
| subscription | Subscription (state machine), Adesao, EligibilityDecision, cobrança |
| config | PlanConfig, CategoryConfig (versionados) |
| questionnaire | Questionários versionados (anamnese/check-in) |
| checkin | CheckIn/CheckInAnswer (state machine) |
| decision | DoctorDecision (append-only) |
| intercorrencia | Intercorrencia (fila operacional, reaproveitada pela Camilla) |
| prescription | Prescription (state machine) + Port |
| continuity | Treatment Continuity Engine — datas/estados, nunca decisão clínica |
| camilla | Orchestrator, Safety Rules, Intent Classifier, Outbox, observabilidade de IA |
| conversation | Conversation/ConversationMessage |
| audit | AuditLog (append-only, sanitização central) |
| analytics | Eventos de domínio (Engine → Camilla) |

## Treatment Continuity Engine — princípio central

Engine = quando/o quê. Camilla = como conversar. Médico = decisão clínica.

O Engine nunca cria uma DoctorDecision — só aplica a consequência estrutural (recalcular datas, mudar status) de uma decisão que o médico já tomou, ou agenda/expira check-ins por aritmética de datas e configuração, nunca por interpretação de conteúdo.

## Auditoria Estrutural

`runAuditedCommand`: mutação + AuditLog commitam na mesma transação. Se a auditoria falhar, a mutação inteira é revertida. Nenhum Command pode retornar sem declarar `entityId`.

## Transactional Outbox

Mutação clínica + AuditLog + OutboxEvent commitam juntos; o efeito externo só acontece depois, via dispatcher, com claim atômico (FOR UPDATE SKIP LOCKED) e backoff exponencial. Falha de fornecedor externo nunca reverte decisão clínica.

## RLS como Autoridade Final

31 tabelas, RLS ativado onde há dado sensível/paciente-específico. Funções SECURITY DEFINER resolvem checagem de carteira sem recursão. HTTP Security Context nunca aceita identidade de header — só de token verificado.

## Camilla

Consome eventos do Engine e reage: apresentação única, notificação de check-in (respeitando frequency cap/opt-out), pipeline Safety→Intent→resposta, escalonamento reaproveitando Intercorrencia (nenhuma fila paralela), confirmação explícita antes de persistir dado clínico. Classificador de intenção e estruturador de resposta são STAGING, não LLM real.

## Banco de Dados

PostgreSQL 16. 14 migrations (histórico completo preservado). 31 tabelas. Dois roles: app_migrator (superuser, só DDL) e app_runtime (privilégios mínimos).
