-- Renovamed — Fatia 1 — Migration 0002: RLS, grants restritos, state machine
-- Executada com o role app_migrator (superuser de desenvolvimento).
--
-- Mecanismo de contexto: a aplicação (camada de Repository) abre cada
-- unidade de trabalho com:
--   SET LOCAL app.current_user_id = '<User.id>';
--   SET LOCAL app.current_role    = '<PATIENT|DOCTOR|ADMIN|SUPPORT>';
-- antes de qualquer SELECT/INSERT/UPDATE. Em produção sobre Supabase isso
-- seria preenchido a partir do JWT; localmente/self-hosted repetimos o
-- mesmo contrato explicitamente, para nunca depender do SDK do Supabase
-- dentro do domínio.

-- ================= GRANTS DE RUNTIME =================
GRANT USAGE ON SCHEMA public TO app_runtime;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO app_runtime;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO app_runtime;

-- audit_logs é append-only: revoga explicitamente UPDATE/DELETE do runtime.
REVOKE UPDATE, DELETE ON audit_logs FROM app_runtime;
GRANT INSERT, SELECT ON audit_logs TO app_runtime;

-- Entidades que nunca podem ser deletadas por fluxo normal da aplicação
-- (retenção/histórico obrigatórios) — DELETE explicitamente revogado.
REVOKE DELETE ON patients, treatments, subscriptions, adesoes,
  eligibility_decisions, clinical_events, conversation_messages,
  communication_consents, subscription_status_transitions FROM app_runtime;

-- ================= RLS =================
ALTER TABLE patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE doctors ENABLE ROW LEVEL SECURITY;
ALTER TABLE doctor_patient_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE treatments ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE adesoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE eligibility_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinical_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_messages ENABLE ROW LEVEL SECURITY;

-- ---- PATIENTS: paciente só enxerga a própria linha; médico enxerga
-- pacientes atualmente em sua carteira; admin enxerga tudo; support
-- por padrão NÃO enxerga (sem policy própria = negado).
CREATE POLICY patients_self ON patients
  FOR SELECT USING (
    current_setting('app.current_role', true) = 'PATIENT'
    AND user_id = current_setting('app.current_user_id', true)::uuid
  );

CREATE POLICY patients_own_update ON patients
  FOR UPDATE USING (
    current_setting('app.current_role', true) = 'PATIENT'
    AND user_id = current_setting('app.current_user_id', true)::uuid
  );

CREATE POLICY patients_doctor_in_carteira ON patients
  FOR SELECT USING (
    current_setting('app.current_role', true) = 'DOCTOR'
    AND EXISTS (
      SELECT 1 FROM doctor_patient_assignments dpa
      JOIN doctors d ON d.id = dpa.doctor_id
      WHERE dpa.patient_id = patients.id
        AND dpa.is_current = true
        AND d.user_id = current_setting('app.current_user_id', true)::uuid
    )
  );

CREATE POLICY patients_admin_all ON patients
  FOR ALL USING (current_setting('app.current_role', true) = 'ADMIN');

CREATE POLICY patients_insert_system ON patients
  FOR INSERT WITH CHECK (current_setting('app.current_role', true) IN ('ADMIN','SYSTEM'));

-- ---- TREATMENTS: mesma lógica de carteira, via join em patients.
CREATE POLICY treatments_self ON treatments
  FOR SELECT USING (
    current_setting('app.current_role', true) = 'PATIENT'
    AND EXISTS (SELECT 1 FROM patients p WHERE p.id = treatments.patient_id
      AND p.user_id = current_setting('app.current_user_id', true)::uuid)
  );

CREATE POLICY treatments_doctor_in_carteira ON treatments
  FOR SELECT USING (
    current_setting('app.current_role', true) = 'DOCTOR'
    AND EXISTS (
      SELECT 1 FROM doctor_patient_assignments dpa
      JOIN doctors d ON d.id = dpa.doctor_id
      WHERE dpa.treatment_id = treatments.id
        AND dpa.is_current = true
        AND d.user_id = current_setting('app.current_user_id', true)::uuid
    )
  );

CREATE POLICY treatments_admin_all ON treatments
  FOR ALL USING (current_setting('app.current_role', true) = 'ADMIN');

CREATE POLICY treatments_service_write ON treatments
  FOR INSERT WITH CHECK (current_setting('app.current_role', true) IN ('ADMIN','SYSTEM','DOCTOR'));

CREATE POLICY treatments_service_update ON treatments
  FOR UPDATE USING (current_setting('app.current_role', true) IN ('ADMIN','SYSTEM','DOCTOR'));

-- ---- CLINICAL_EVENTS: SUPPORT nunca vê por padrão (sem policy para SUPPORT).
CREATE POLICY clinical_events_self ON clinical_events
  FOR SELECT USING (
    current_setting('app.current_role', true) = 'PATIENT'
    AND EXISTS (
      SELECT 1 FROM treatments t JOIN patients p ON p.id = t.patient_id
      WHERE t.id = clinical_events.treatment_id
        AND p.user_id = current_setting('app.current_user_id', true)::uuid
    )
  );

CREATE POLICY clinical_events_doctor_in_carteira ON clinical_events
  FOR SELECT USING (
    current_setting('app.current_role', true) = 'DOCTOR'
    AND EXISTS (
      SELECT 1 FROM doctor_patient_assignments dpa
      JOIN doctors d ON d.id = dpa.doctor_id
      WHERE dpa.treatment_id = clinical_events.treatment_id
        AND dpa.is_current = true
        AND d.user_id = current_setting('app.current_user_id', true)::uuid
    )
  );

CREATE POLICY clinical_events_admin_all ON clinical_events
  FOR ALL USING (current_setting('app.current_role', true) = 'ADMIN');

CREATE POLICY clinical_events_write ON clinical_events
  FOR INSERT WITH CHECK (current_setting('app.current_role', true) IN ('ADMIN','SYSTEM','DOCTOR'));

-- ---- DOCTORS: leitura ampla (nome/CRM/especialidade não é dado sensível
-- de paciente), escrita restrita a admin/sistema.
CREATE POLICY doctors_read_all ON doctors FOR SELECT USING (true);
CREATE POLICY doctors_admin_write ON doctors
  FOR ALL USING (current_setting('app.current_role', true) IN ('ADMIN','SYSTEM'));

-- ---- DOCTOR_PATIENT_ASSIGNMENTS
CREATE POLICY dpa_patient_self ON doctor_patient_assignments
  FOR SELECT USING (
    current_setting('app.current_role', true) = 'PATIENT'
    AND EXISTS (SELECT 1 FROM patients p WHERE p.id = doctor_patient_assignments.patient_id
      AND p.user_id = current_setting('app.current_user_id', true)::uuid)
  );

CREATE POLICY dpa_doctor_self ON doctor_patient_assignments
  FOR SELECT USING (
    current_setting('app.current_role', true) = 'DOCTOR'
    AND EXISTS (SELECT 1 FROM doctors d WHERE d.id = doctor_patient_assignments.doctor_id
      AND d.user_id = current_setting('app.current_user_id', true)::uuid)
  );

CREATE POLICY dpa_admin_all ON doctor_patient_assignments
  FOR ALL USING (current_setting('app.current_role', true) IN ('ADMIN','SYSTEM'));

-- ---- SUBSCRIPTIONS / ADESOES / ELIGIBILITY: paciente vê as próprias;
-- médico vê as de sua carteira; admin vê tudo.
CREATE POLICY subscriptions_self ON subscriptions
  FOR SELECT USING (
    current_setting('app.current_role', true) = 'PATIENT'
    AND EXISTS (SELECT 1 FROM patients p WHERE p.id = subscriptions.patient_id
      AND p.user_id = current_setting('app.current_user_id', true)::uuid)
  );
CREATE POLICY subscriptions_admin_all ON subscriptions
  FOR ALL USING (current_setting('app.current_role', true) IN ('ADMIN','SYSTEM'));
CREATE POLICY subscriptions_doctor_carteira ON subscriptions
  FOR SELECT USING (
    current_setting('app.current_role', true) = 'DOCTOR'
    AND EXISTS (
      SELECT 1 FROM doctor_patient_assignments dpa JOIN doctors d ON d.id = dpa.doctor_id
      WHERE dpa.treatment_id = subscriptions.treatment_id AND dpa.is_current = true
        AND d.user_id = current_setting('app.current_user_id', true)::uuid
    )
  );

CREATE POLICY adesoes_self ON adesoes
  FOR SELECT USING (
    current_setting('app.current_role', true) = 'PATIENT'
    AND EXISTS (SELECT 1 FROM patients p WHERE p.id = adesoes.patient_id
      AND p.user_id = current_setting('app.current_user_id', true)::uuid)
  );
CREATE POLICY adesoes_admin_all ON adesoes
  FOR ALL USING (current_setting('app.current_role', true) IN ('ADMIN','SYSTEM'));

CREATE POLICY eligibility_self ON eligibility_decisions
  FOR SELECT USING (
    current_setting('app.current_role', true) = 'PATIENT'
    AND EXISTS (SELECT 1 FROM patients p WHERE p.id = eligibility_decisions.patient_id
      AND p.user_id = current_setting('app.current_user_id', true)::uuid)
  );
CREATE POLICY eligibility_doctor_carteira ON eligibility_decisions
  FOR SELECT USING (
    current_setting('app.current_role', true) = 'DOCTOR'
    AND EXISTS (
      SELECT 1 FROM doctor_patient_assignments dpa JOIN doctors d ON d.id = dpa.doctor_id
      WHERE dpa.treatment_id = eligibility_decisions.treatment_id AND dpa.is_current = true
        AND d.user_id = current_setting('app.current_user_id', true)::uuid
    )
  );
CREATE POLICY eligibility_admin_all ON eligibility_decisions
  FOR ALL USING (current_setting('app.current_role', true) IN ('ADMIN','SYSTEM'));
CREATE POLICY eligibility_doctor_write ON eligibility_decisions
  FOR INSERT WITH CHECK (current_setting('app.current_role', true) IN ('DOCTOR','SYSTEM','ADMIN'));

-- ---- CONVERSATIONS: paciente vê as próprias; SUPPORT não vê por padrão
-- (nenhuma policy para SUPPORT = acesso negado, conforme exigido).
CREATE POLICY conversations_self ON conversations
  FOR SELECT USING (
    current_setting('app.current_role', true) = 'PATIENT'
    AND EXISTS (SELECT 1 FROM patients p WHERE p.id = conversations.patient_id
      AND p.user_id = current_setting('app.current_user_id', true)::uuid)
  );
CREATE POLICY conversations_doctor_carteira ON conversations
  FOR SELECT USING (
    current_setting('app.current_role', true) = 'DOCTOR'
    AND EXISTS (
      SELECT 1 FROM doctor_patient_assignments dpa JOIN doctors d ON d.id = dpa.doctor_id
      WHERE dpa.patient_id = conversations.patient_id AND dpa.is_current = true
        AND d.user_id = current_setting('app.current_user_id', true)::uuid
    )
  );
CREATE POLICY conversations_admin_all ON conversations
  FOR ALL USING (current_setting('app.current_role', true) IN ('ADMIN','SYSTEM'));
CREATE POLICY conversations_write ON conversations
  FOR INSERT WITH CHECK (current_setting('app.current_role', true) IN ('PATIENT','SYSTEM','ADMIN'));

CREATE POLICY conv_messages_via_conversation ON conversation_messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM conversations c WHERE c.id = conversation_messages.conversation_id
      -- reaplica as mesmas condições de conversations via subquery direta
      AND (
        (current_setting('app.current_role', true) = 'PATIENT' AND EXISTS (
          SELECT 1 FROM patients p WHERE p.id = c.patient_id
          AND p.user_id = current_setting('app.current_user_id', true)::uuid))
        OR (current_setting('app.current_role', true) = 'DOCTOR' AND EXISTS (
          SELECT 1 FROM doctor_patient_assignments dpa JOIN doctors d ON d.id = dpa.doctor_id
          WHERE dpa.patient_id = c.patient_id AND dpa.is_current = true
            AND d.user_id = current_setting('app.current_user_id', true)::uuid))
        OR current_setting('app.current_role', true) IN ('ADMIN','SYSTEM')
      )
    )
  );
CREATE POLICY conv_messages_write ON conversation_messages
  FOR INSERT WITH CHECK (current_setting('app.current_role', true) IN ('PATIENT','DOCTOR','SYSTEM','ADMIN'));

-- ================= STATE MACHINE: SUBSCRIPTION =================
-- Defesa em profundidade: mesmo que um bug no serviço tente uma transição
-- inválida, o banco rejeita. A tabela de transições permitidas é a mesma
-- lista usada pelo SubscriptionService (documentada em ambos os lugares
-- deliberadamente — ver "pendências" no relatório de entrega).
CREATE OR REPLACE FUNCTION check_subscription_transition() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    IF NOT (
      (OLD.status = 'PENDING_ELIGIBILITY' AND NEW.status = 'ACTIVE') OR
      (OLD.status = 'PENDING_ELIGIBILITY' AND NEW.status = 'CANCELLED') OR
      (OLD.status = 'ACTIVE' AND NEW.status = 'PAST_DUE') OR
      (OLD.status = 'ACTIVE' AND NEW.status = 'CANCELLED') OR
      (OLD.status = 'PAST_DUE' AND NEW.status = 'ACTIVE') OR
      (OLD.status = 'PAST_DUE' AND NEW.status = 'CANCELLED')
    ) THEN
      RAISE EXCEPTION 'Transição de status inválida: % -> %', OLD.status, NEW.status
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_subscription_transition
  BEFORE UPDATE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION check_subscription_transition();
