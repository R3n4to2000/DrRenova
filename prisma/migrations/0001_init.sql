-- Renovamed — Fatia 1 — Migration 0001: schema inicial
-- Espelha fielmente prisma/schema.prisma (fonte de verdade do modelo de dados).
-- Executada com o role app_migrator (superuser de desenvolvimento).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ================= ENUMS =================
CREATE TYPE user_role AS ENUM ('PATIENT','DOCTOR','ADMIN','SUPPORT');
CREATE TYPE doctor_status AS ENUM ('ACTIVE','ON_LEAVE','INACTIVE');
CREATE TYPE config_status AS ENUM ('DRAFT','ACTIVE','RETIRED');
CREATE TYPE treatment_status AS ENUM ('ONBOARDING','ACTIVE','PAUSED','ENDED');
CREATE TYPE subscription_status AS ENUM ('PENDING_ELIGIBILITY','ACTIVE','PAST_DUE','CANCELLED');
CREATE TYPE billing_period AS ENUM ('MONTHLY','ANNUAL');
CREATE TYPE eligibility_outcome AS ENUM ('APPROVED','NEEDS_MORE_INFO','NOT_ELIGIBLE');
CREATE TYPE conversation_channel AS ENUM ('WHATSAPP','WEB','SYSTEM');
CREATE TYPE message_sender AS ENUM ('PATIENT','CAMILLA','DOCTOR','SYSTEM');
CREATE TYPE message_type AS ENUM ('TEXT','STRUCTURED_DATA','SYSTEM_NOTICE');
CREATE TYPE delivery_status AS ENUM ('QUEUED','SENT','DELIVERED','READ','FAILED');

-- ================= IDENTIDADE =================
CREATE TABLE users (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id uuid NOT NULL UNIQUE,
  email        text NOT NULL UNIQUE,
  role         user_role NOT NULL,
  mfa_enabled  boolean NOT NULL DEFAULT false,
  mfa_required boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- ================= CONFIG VERSIONADA =================
CREATE TABLE plan_configs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_key        text NOT NULL,
  version         int NOT NULL,
  name            text NOT NULL,
  adesao_amount   numeric(10,2) NOT NULL,
  monthly_amount  numeric(10,2) NOT NULL,
  annual_amount   numeric(10,2) NOT NULL,
  max_treatments  int NOT NULL DEFAULT 1,
  status          config_status NOT NULL DEFAULT 'DRAFT',
  effective_from  timestamptz NOT NULL DEFAULT now(),
  effective_until timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (plan_key, version)
);

CREATE TABLE category_configs (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_key              text NOT NULL,
  version                   int NOT NULL,
  name                      text NOT NULL,
  icon                      text,
  default_review_period_days int NOT NULL,
  status                    config_status NOT NULL DEFAULT 'DRAFT',
  effective_from            timestamptz NOT NULL DEFAULT now(),
  effective_until           timestamptz,
  created_at                timestamptz NOT NULL DEFAULT now(),
  UNIQUE (category_key, version)
);

-- ================= PACIENTE / MÉDICO =================
CREATE TABLE patients (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL UNIQUE REFERENCES users(id),
  full_name           text NOT NULL,
  cpf_encrypted       text NOT NULL,
  cpf_hash            text NOT NULL UNIQUE,
  birth_date          date NOT NULL,
  whatsapp_encrypted  text NOT NULL,
  whatsapp_last4      text NOT NULL,
  anonymized_at       timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE doctors (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL UNIQUE REFERENCES users(id),
  full_name  text NOT NULL,
  crm        text NOT NULL,
  crm_state  text NOT NULL,
  specialty  text NOT NULL,
  status     doctor_status NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (crm, crm_state)
);

-- ================= TRATAMENTO =================
CREATE TABLE treatments (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id                  uuid NOT NULL REFERENCES patients(id),
  category_config_id          uuid NOT NULL REFERENCES category_configs(id),
  status                      treatment_status NOT NULL DEFAULT 'ONBOARDING',
  review_period_days_override int,
  last_review_at              timestamptz,
  next_review_due_at          timestamptz,
  last_in_person_contact_at   timestamptz,
  created_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE doctor_patient_assignments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id   uuid NOT NULL REFERENCES patients(id),
  doctor_id    uuid NOT NULL REFERENCES doctors(id),
  treatment_id uuid REFERENCES treatments(id),
  started_at   timestamptz NOT NULL DEFAULT now(),
  ended_at     timestamptz,
  reason       text,
  is_current   boolean NOT NULL DEFAULT true
);
CREATE INDEX idx_dpa_patient_current ON doctor_patient_assignments(patient_id, is_current);
CREATE INDEX idx_dpa_doctor_current ON doctor_patient_assignments(doctor_id, is_current);

-- ================= ASSINATURA / ADESÃO / ELEGIBILIDADE =================
CREATE TABLE subscriptions (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id               uuid NOT NULL REFERENCES patients(id),
  treatment_id             uuid NOT NULL UNIQUE REFERENCES treatments(id),
  plan_config_id           uuid NOT NULL REFERENCES plan_configs(id),
  billing_period           billing_period NOT NULL DEFAULT 'MONTHLY',
  status                   subscription_status NOT NULL DEFAULT 'PENDING_ELIGIBILITY',
  monthly_amount_snapshot  numeric(10,2) NOT NULL,
  annual_amount_snapshot   numeric(10,2) NOT NULL,
  snapshot_at              timestamptz NOT NULL DEFAULT now(),
  first_charge_at          timestamptz,
  next_charge_at           timestamptz,
  created_at               timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE subscription_status_transitions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid NOT NULL REFERENCES subscriptions(id),
  from_status     subscription_status,
  to_status       subscription_status NOT NULL,
  reason          text,
  occurred_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE adesoes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id      uuid NOT NULL REFERENCES patients(id),
  treatment_id    uuid NOT NULL REFERENCES treatments(id),
  plan_config_id  uuid NOT NULL REFERENCES plan_configs(id),
  amount_snapshot numeric(10,2) NOT NULL,
  status          text NOT NULL,
  paid_at         timestamptz,
  idempotency_key text NOT NULL UNIQUE,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE eligibility_decisions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id    uuid NOT NULL REFERENCES patients(id),
  treatment_id  uuid NOT NULL REFERENCES treatments(id),
  doctor_id     uuid NOT NULL REFERENCES doctors(id),
  outcome       eligibility_outcome NOT NULL,
  clinical_note text,
  decided_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_elig_treatment_decided ON eligibility_decisions(treatment_id, decided_at);

-- ================= CLÍNICO / AUDITORIA =================
CREATE TABLE clinical_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  treatment_id uuid NOT NULL REFERENCES treatments(id),
  type         text NOT NULL,
  occurred_at  timestamptz NOT NULL DEFAULT now(),
  payload      jsonb NOT NULL
);

CREATE TABLE audit_logs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  correlation_id text NOT NULL,
  actor_id       uuid,
  actor_type     text NOT NULL,
  action         text NOT NULL,
  entity_type    text NOT NULL,
  entity_id      text NOT NULL,
  origin         text NOT NULL,
  result         text NOT NULL,
  metadata       jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_entity ON audit_logs(entity_type, entity_id);

-- ================= CONVERSATION (fundação) =================
CREATE TABLE conversations (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES patients(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE conversation_messages (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id     uuid NOT NULL REFERENCES conversations(id),
  sender              message_sender NOT NULL,
  channel             conversation_channel NOT NULL,
  message_type        message_type NOT NULL DEFAULT 'TEXT',
  content             text NOT NULL,
  actor_user_id       uuid,
  external_message_id text,
  delivery_status     delivery_status NOT NULL DEFAULT 'SENT',
  occurred_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_conv_msg_conv_time ON conversation_messages(conversation_id, occurred_at);

CREATE TABLE patient_communication_preferences (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id        uuid NOT NULL UNIQUE REFERENCES patients(id),
  preferred_hour    int,
  timezone          text NOT NULL DEFAULT 'UTC',
  preferred_channel conversation_channel NOT NULL DEFAULT 'WHATSAPP',
  opted_out         boolean NOT NULL DEFAULT false,
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE communication_consents (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id  uuid NOT NULL REFERENCES patients(id),
  purpose     text NOT NULL,
  channel     conversation_channel NOT NULL,
  version     text NOT NULL,
  origin      text NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at  timestamptz
);

-- ================= ANALYTICS / IDEMPOTÊNCIA =================
CREATE TABLE analytics_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id  uuid,
  event_name  text NOT NULL,
  properties  jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_analytics_event_time ON analytics_events(event_name, occurred_at);

CREATE TABLE idempotency_keys (
  key        text PRIMARY KEY,
  scope      text NOT NULL,
  result_ref text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_idem_scope ON idempotency_keys(scope);
