-- Renovamed — MVP Integration — Migration 0010: Camilla (infraestrutura)
--
-- Reaproveita deliberadamente entidades já existentes da Fatia 1:
--   Conversation / ConversationMessage — já existiam como esqueleto vazio;
--   agora passam a ser populadas de verdade.
--   PatientCommunicationPreference — já tem optedOut/preferredHour/timezone;
--   é o CommunicationRulesEngine (frequency cap), sem tabela nova.
--   Intercorrencia — Escalation da Camilla é implementada REUTILIZANDO esta
--   tabela (origin='CAMILLA'), para não criar uma segunda fila, conforme
--   exigido. Nenhuma tabela "escalations" separada foi criada.
--
-- Tabelas novas, mínimas e justificadas:
--   deterministic_safety_rules — versionada, nasce VAZIA (nenhum limiar
--     clínico inventado pelo desenvolvedor).
--   intent_classifications — resultado da classificação por mensagem.
--   prompt_versions / ai_executions — observabilidade obrigatória de IA.

CREATE TYPE safety_rule_status AS ENUM ('DRAFT','ACTIVE','RETIRED');
CREATE TYPE safety_rule_operator AS ENUM ('GT','GTE','LT','LTE','EQ');
CREATE TYPE camilla_intent AS ENUM (
  'ADMINISTRATIVE','STRUCTURED_FOLLOWUP','CLINICAL_QUESTION',
  'POSSIBLE_INTERCURRENCE','POTENTIAL_URGENCY','HUMAN_SUPPORT_REQUIRED'
);

-- ================= DETERMINISTIC SAFETY RULES =================
-- Versionada como PlanConfig/CategoryConfig. Nasce vazia — a Direção Médica
-- popula depois. O campo `field_key` referencia um `field_key` de
-- CheckInAnswer (ex.: "valor_generico"); o Engine/Camilla nunca inventam
-- a que campo/valor a regra se aplica, apenas executam a comparação.
CREATE TABLE deterministic_safety_rules (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_key       text NOT NULL,
  version        int NOT NULL,
  field_key      text NOT NULL,
  operator       safety_rule_operator NOT NULL,
  threshold      numeric NOT NULL,
  action         text NOT NULL DEFAULT 'ESCALATE', -- único valor suportado nesta fatia
  status         safety_rule_status NOT NULL DEFAULT 'DRAFT',
  approved_by    text, -- referência textual a quem aprovou (Direção Médica) — sem FK a usuário específico nesta fatia
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_until timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rule_key, version)
);

-- ================= INTENT CLASSIFICATION =================
CREATE TABLE intent_classifications (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_message_id uuid NOT NULL REFERENCES conversation_messages(id),
  intent                 camilla_intent NOT NULL,
  triggered_safety_rule_id uuid REFERENCES deterministic_safety_rules(id), -- preenchido só se uma regra determinística disparou
  created_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_intent_class_message ON intent_classifications(conversation_message_id);

-- ================= AI OBSERVABILITY =================
CREATE TABLE prompt_versions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL, -- ex.: 'camilla_checkin_followup'
  version     int NOT NULL,
  description text,
  status      config_status NOT NULL DEFAULT 'DRAFT',
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (name, version)
);

CREATE TABLE ai_executions (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_message_id uuid REFERENCES conversation_messages(id),
  prompt_version_id       uuid REFERENCES prompt_versions(id),
  model                   text NOT NULL, -- ex.: 'staging-template-v1' (não é um LLM real nesta fatia — ver docs)
  purpose                 text NOT NULL, -- ex.: 'intent_classification', 'checkin_followup_message'
  intent_classified       camilla_intent,
  tools_used              jsonb,
  latency_ms              int,
  estimated_cost_cents    int,
  escalated               boolean NOT NULL DEFAULT false,
  created_at              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_ai_exec_created ON ai_executions(created_at);

-- ================= RLS =================
-- deterministic_safety_rules / prompt_versions: configuração administrativa,
-- mesmo padrão de plan_configs/category_configs (sem RLS — GRANT já restringe
-- runtime a SELECT/INSERT/UPDATE, escrita real fica a cargo de rotas admin).
-- intent_classifications / ai_executions carregam referência a paciente
-- apenas indiretamente (via conversation_messages); RLS herdada pela
-- própria tabela conversation_messages já existente é suficiente para os
-- casos de leitura desta fatia — nenhuma política nova necessária aqui,
-- porque não há endpoint que exponha estas tabelas diretamente ao paciente.

GRANT SELECT, INSERT, UPDATE ON deterministic_safety_rules, intent_classifications,
  prompt_versions, ai_executions TO app_runtime;
