-- Renovamed — Fatia 2 — Migration 0009: Treatment Continuity Engine
--
-- Adiciona as entidades mínimas para o Engine operar: CheckIn/CheckInAnswer,
-- DoctorDecision (append-only), Intercorrencia, Prescription, questionários
-- versionados por categoria, e a configuração (não hardcoded) da regra dos
-- 180 dias. RLS habilitado na mesma migration para toda tabela clínica
-- sensível, reaproveitando fn_doctor_has_treatment já existente (Fatia 1).

-- ================= ENUMS =================
CREATE TYPE checkin_status AS ENUM ('SCHEDULED','OPEN','ANSWERED','EXPIRED','CANCELLED');
CREATE TYPE answer_value_type AS ENUM ('NUMBER','BOOLEAN','OPTION','TEXT','DATE');
CREATE TYPE doctor_decision_action AS ENUM (
  'MAINTAIN','REQUEST_INFORMATION','REQUEST_EXAM','REQUEST_TELECONSULTATION',
  'REQUEST_IN_PERSON_EVALUATION','ISSUE_PRESCRIPTION','CHANGE_REVIEW_PERIOD',
  'REGISTER_CONDUCT','REFER','END_TREATMENT'
);
CREATE TYPE intercorrencia_status AS ENUM ('OPEN','IN_REVIEW','RESOLVED');
CREATE TYPE prescription_status AS ENUM ('DRAFT','PENDING_SIGNATURE','SIGNED','DELIVERED','FAILED','CANCELLED');
CREATE TYPE questionnaire_type AS ENUM ('ANAMNESIS','CHECKIN');

-- ================= CONFIGURAÇÃO (180 dias — nunca hardcoded) =================
-- category_configs já é versionado (Fatia 1) — adicionamos campos de
-- configuração administrável, sem valor clínico fixo no código.
ALTER TABLE category_configs
  ADD COLUMN in_person_evaluation_rule_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN in_person_evaluation_max_days int;

-- Data de ativação do tratamento (distinta de createdAt, que é o onboarding).
ALTER TABLE treatments ADD COLUMN activated_at timestamptz;

-- ================= QUESTIONÁRIOS VERSIONADOS =================
CREATE TABLE category_questionnaire_versions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_config_id  uuid NOT NULL REFERENCES category_configs(id),
  questionnaire_type  questionnaire_type NOT NULL,
  version             int NOT NULL,
  status              config_status NOT NULL DEFAULT 'DRAFT',
  effective_from      timestamptz NOT NULL DEFAULT now(),
  effective_until     timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (category_config_id, questionnaire_type, version)
);

CREATE TABLE category_questionnaire_fields (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  questionnaire_version_id uuid NOT NULL REFERENCES category_questionnaire_versions(id),
  field_key              text NOT NULL,
  label                  text NOT NULL,
  value_type             answer_value_type NOT NULL,
  required               boolean NOT NULL DEFAULT true,
  order_index            int NOT NULL DEFAULT 0,
  options                jsonb, -- usado quando value_type = OPTION
  created_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (questionnaire_version_id, field_key)
);

-- ================= CHECK-IN =================
CREATE TABLE check_ins (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  treatment_id              uuid NOT NULL REFERENCES treatments(id),
  questionnaire_version_id  uuid NOT NULL REFERENCES category_questionnaire_versions(id),
  status                    checkin_status NOT NULL DEFAULT 'SCHEDULED',
  scheduled_for             timestamptz NOT NULL,
  opened_at                 timestamptz,
  answered_at               timestamptz,
  expires_at                timestamptz,
  created_at                timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_checkins_treatment_status ON check_ins(treatment_id, status);

CREATE TABLE check_in_answers (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  check_in_id  uuid NOT NULL REFERENCES check_ins(id),
  field_key    text NOT NULL,
  value_type   answer_value_type NOT NULL,
  value_json   jsonb NOT NULL,       -- valor estruturado (genérico por tipo)
  raw_input    text,                 -- texto original informado, quando aplicável
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (check_in_id, field_key)
);

-- ================= DECISÃO MÉDICA (append-only) =================
CREATE TABLE doctor_decisions (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  treatment_id           uuid NOT NULL REFERENCES treatments(id),
  doctor_id              uuid NOT NULL REFERENCES doctors(id),
  action                 doctor_decision_action NOT NULL,
  note                   text,
  review_period_days_new int,                 -- só quando action = CHANGE_REVIEW_PERIOD
  origin_check_in_id     uuid REFERENCES check_ins(id),
  decided_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_decisions_treatment_time ON doctor_decisions(treatment_id, decided_at);

-- ================= INTERCORRÊNCIA =================
CREATE TABLE intercorrencias (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  treatment_id          uuid NOT NULL REFERENCES treatments(id),
  origin                text NOT NULL, -- 'CHECKIN' | 'MANUAL' | 'ENGINE'
  description           text NOT NULL,
  priority              text NOT NULL DEFAULT 'ROTINA', -- operacional/administrativo, nunca clínico
  status                intercorrencia_status NOT NULL DEFAULT 'OPEN',
  assumed_by_doctor_id  uuid REFERENCES doctors(id),
  resolved_by_decision_id uuid REFERENCES doctor_decisions(id),
  opened_at             timestamptz NOT NULL DEFAULT now(),
  resolved_at           timestamptz
);
CREATE INDEX idx_intercorrencias_treatment_status ON intercorrencias(treatment_id, status);

-- ================= PRESCRIÇÃO =================
CREATE TABLE prescriptions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  treatment_id       uuid NOT NULL REFERENCES treatments(id),
  doctor_id          uuid NOT NULL REFERENCES doctors(id),
  origin_decision_id uuid NOT NULL REFERENCES doctor_decisions(id),
  status             prescription_status NOT NULL DEFAULT 'DRAFT',
  provider_ref       text,
  document_ref       text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  signed_at          timestamptz,
  delivered_at       timestamptz
);
CREATE INDEX idx_prescriptions_treatment ON prescriptions(treatment_id);

-- ================= RLS (mesmo padrão da Fatia 1) =================
ALTER TABLE check_ins ENABLE ROW LEVEL SECURITY;
ALTER TABLE check_in_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE doctor_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE intercorrencias ENABLE ROW LEVEL SECURITY;
ALTER TABLE prescriptions ENABLE ROW LEVEL SECURITY;

-- ---- CHECK_INS ----
CREATE POLICY checkins_self ON check_ins
  FOR SELECT USING (
    current_setting('app.current_role', true) = 'PATIENT'
    AND EXISTS (SELECT 1 FROM treatments t JOIN patients p ON p.id = t.patient_id
      WHERE t.id = check_ins.treatment_id AND p.user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid)
  );
CREATE POLICY checkins_doctor_carteira ON check_ins
  FOR SELECT USING (
    current_setting('app.current_role', true) = 'DOCTOR'
    AND fn_doctor_has_treatment(NULLIF(current_setting('app.current_user_id', true), '')::uuid, check_ins.treatment_id)
  );
CREATE POLICY checkins_admin_all ON check_ins
  FOR ALL USING (current_setting('app.current_role', true) IN ('ADMIN','SYSTEM'));
CREATE POLICY checkins_update_scoped ON check_ins
  FOR UPDATE USING (
    current_setting('app.current_role', true) IN ('ADMIN','SYSTEM')
    OR (current_setting('app.current_role', true) = 'DOCTOR'
        AND fn_doctor_has_treatment(NULLIF(current_setting('app.current_user_id', true), '')::uuid, check_ins.treatment_id))
    OR (current_setting('app.current_role', true) = 'PATIENT'
        AND EXISTS (SELECT 1 FROM treatments t JOIN patients p ON p.id = t.patient_id
          WHERE t.id = check_ins.treatment_id AND p.user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid))
  );

-- ---- CHECK_IN_ANSWERS ----
CREATE POLICY checkin_answers_self ON check_in_answers
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM check_ins ci JOIN treatments t ON t.id = ci.treatment_id JOIN patients p ON p.id = t.patient_id
      WHERE ci.id = check_in_answers.check_in_id
        AND current_setting('app.current_role', true) = 'PATIENT'
        AND p.user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
    )
  );
CREATE POLICY checkin_answers_doctor_carteira ON check_in_answers
  FOR SELECT USING (
    current_setting('app.current_role', true) = 'DOCTOR'
    AND EXISTS (SELECT 1 FROM check_ins ci WHERE ci.id = check_in_answers.check_in_id
      AND fn_doctor_has_treatment(NULLIF(current_setting('app.current_user_id', true), '')::uuid, ci.treatment_id))
  );
CREATE POLICY checkin_answers_admin_all ON check_in_answers
  FOR ALL USING (current_setting('app.current_role', true) IN ('ADMIN','SYSTEM'));
CREATE POLICY checkin_answers_patient_write ON check_in_answers
  FOR INSERT WITH CHECK (
    current_setting('app.current_role', true) IN ('PATIENT','SYSTEM','ADMIN')
  );

-- ---- DOCTOR_DECISIONS (append-only: sem policy de UPDATE/DELETE p/ ninguém) ----
CREATE POLICY decisions_self ON doctor_decisions
  FOR SELECT USING (
    current_setting('app.current_role', true) = 'PATIENT'
    AND EXISTS (SELECT 1 FROM treatments t JOIN patients p ON p.id = t.patient_id
      WHERE t.id = doctor_decisions.treatment_id AND p.user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid)
  );
CREATE POLICY decisions_doctor_carteira_select ON doctor_decisions
  FOR SELECT USING (
    current_setting('app.current_role', true) = 'DOCTOR'
    AND fn_doctor_has_treatment(NULLIF(current_setting('app.current_user_id', true), '')::uuid, doctor_decisions.treatment_id)
  );
CREATE POLICY decisions_admin_select ON doctor_decisions
  FOR SELECT USING (current_setting('app.current_role', true) IN ('ADMIN','SYSTEM'));
CREATE POLICY decisions_doctor_carteira_insert ON doctor_decisions
  FOR INSERT WITH CHECK (
    current_setting('app.current_role', true) = 'DOCTOR'
    AND fn_doctor_has_treatment(NULLIF(current_setting('app.current_user_id', true), '')::uuid, doctor_decisions.treatment_id)
  );
CREATE POLICY decisions_admin_insert ON doctor_decisions
  FOR INSERT WITH CHECK (current_setting('app.current_role', true) IN ('ADMIN','SYSTEM'));

-- ---- INTERCORRENCIAS ----
CREATE POLICY intercorrencias_self ON intercorrencias
  FOR SELECT USING (
    current_setting('app.current_role', true) = 'PATIENT'
    AND EXISTS (SELECT 1 FROM treatments t JOIN patients p ON p.id = t.patient_id
      WHERE t.id = intercorrencias.treatment_id AND p.user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid)
  );
CREATE POLICY intercorrencias_doctor_carteira ON intercorrencias
  FOR SELECT USING (
    current_setting('app.current_role', true) = 'DOCTOR'
    AND fn_doctor_has_treatment(NULLIF(current_setting('app.current_user_id', true), '')::uuid, intercorrencias.treatment_id)
  );
CREATE POLICY intercorrencias_admin_all ON intercorrencias
  FOR ALL USING (current_setting('app.current_role', true) IN ('ADMIN','SYSTEM'));
CREATE POLICY intercorrencias_write ON intercorrencias
  FOR INSERT WITH CHECK (current_setting('app.current_role', true) IN ('ADMIN','SYSTEM'));
CREATE POLICY intercorrencias_doctor_update ON intercorrencias
  FOR UPDATE USING (
    current_setting('app.current_role', true) = 'DOCTOR'
    AND fn_doctor_has_treatment(NULLIF(current_setting('app.current_user_id', true), '')::uuid, intercorrencias.treatment_id)
  );

-- ---- PRESCRIPTIONS ----
CREATE POLICY prescriptions_self ON prescriptions
  FOR SELECT USING (
    current_setting('app.current_role', true) = 'PATIENT'
    AND EXISTS (SELECT 1 FROM treatments t JOIN patients p ON p.id = t.patient_id
      WHERE t.id = prescriptions.treatment_id AND p.user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid)
  );
CREATE POLICY prescriptions_doctor_carteira_select ON prescriptions
  FOR SELECT USING (
    current_setting('app.current_role', true) = 'DOCTOR'
    AND fn_doctor_has_treatment(NULLIF(current_setting('app.current_user_id', true), '')::uuid, prescriptions.treatment_id)
  );
CREATE POLICY prescriptions_admin_all ON prescriptions
  FOR ALL USING (current_setting('app.current_role', true) IN ('ADMIN','SYSTEM'));
-- Somente médico da carteira pode CRIAR/ATUALIZAR prescrição — nunca paciente.
CREATE POLICY prescriptions_doctor_carteira_write ON prescriptions
  FOR INSERT WITH CHECK (
    current_setting('app.current_role', true) = 'DOCTOR'
    AND fn_doctor_has_treatment(NULLIF(current_setting('app.current_user_id', true), '')::uuid, prescriptions.treatment_id)
  );
CREATE POLICY prescriptions_doctor_carteira_update ON prescriptions
  FOR UPDATE USING (
    current_setting('app.current_role', true) = 'DOCTOR'
    AND fn_doctor_has_treatment(NULLIF(current_setting('app.current_user_id', true), '')::uuid, prescriptions.treatment_id)
  );

-- ================= GRANTS (mesmo runtime restrito da Fatia 1) =================
GRANT SELECT, INSERT, UPDATE ON category_questionnaire_versions, category_questionnaire_fields,
  check_ins, check_in_answers, doctor_decisions, intercorrencias, prescriptions TO app_runtime;

-- doctor_decisions é append-only por contrato de aplicação (nenhuma policy de
-- UPDATE/DELETE foi criada acima para nenhum papel) — reforçado aqui também
-- por GRANT, na mesma lógica já usada para audit_logs na Fatia 1.
REVOKE UPDATE, DELETE ON doctor_decisions FROM app_runtime;
GRANT INSERT, SELECT ON doctor_decisions TO app_runtime;
