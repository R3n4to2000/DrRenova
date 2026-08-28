-- Renovamed — Fatia 1 — Migration 0005: blindagem de policies contra GUC
-- customizado retornando '' em vez de NULL.
--
-- BUG REAL ENCONTRADO EM EXECUÇÃO: na primeira transação de uma conexão
-- (reaproveitada pelo pool) que define 'app.current_user_id' via SET LOCAL,
-- ao fim da transação (COMMIT ou ROLLBACK) o Postgres reverte o GUC
-- customizado para '' (string vazia) — não para NULL — porque é a
-- primeira vez que aquele placeholder é criado na sessão. Transações
-- seguintes na MESMA conexão, sem paciente autenticado (app.current_user_id
-- nunca setado por essa transação), herdam '' e falham ao tentar
-- ''::uuid ("invalid input syntax for type uuid").
--
-- Correção: toda policy que faz cast para uuid a partir de
-- current_setting('app.current_user_id', true) agora passa por
-- NULLIF(..., '') antes do cast — NULL::uuid é sempre seguro (as
-- comparações/joins correspondentes simplesmente não casam nada).

DROP POLICY patients_self ON patients;
CREATE POLICY patients_self ON patients
  FOR SELECT USING (
    current_setting('app.current_role', true) = 'PATIENT'
    AND user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
  );

DROP POLICY patients_own_update ON patients;
CREATE POLICY patients_own_update ON patients
  FOR UPDATE USING (
    current_setting('app.current_role', true) = 'PATIENT'
    AND user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
  );

DROP POLICY patients_doctor_in_carteira ON patients;
CREATE POLICY patients_doctor_in_carteira ON patients
  FOR SELECT USING (
    current_setting('app.current_role', true) = 'DOCTOR'
    AND fn_doctor_has_patient(NULLIF(current_setting('app.current_user_id', true), '')::uuid, patients.id)
  );

DROP POLICY treatments_self ON treatments;
CREATE POLICY treatments_self ON treatments
  FOR SELECT USING (
    current_setting('app.current_role', true) = 'PATIENT'
    AND EXISTS (SELECT 1 FROM patients p WHERE p.id = treatments.patient_id
      AND p.user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid)
  );

DROP POLICY treatments_doctor_in_carteira ON treatments;
CREATE POLICY treatments_doctor_in_carteira ON treatments
  FOR SELECT USING (
    current_setting('app.current_role', true) = 'DOCTOR'
    AND fn_doctor_has_treatment(NULLIF(current_setting('app.current_user_id', true), '')::uuid, treatments.id)
  );

DROP POLICY clinical_events_self ON clinical_events;
CREATE POLICY clinical_events_self ON clinical_events
  FOR SELECT USING (
    current_setting('app.current_role', true) = 'PATIENT'
    AND EXISTS (
      SELECT 1 FROM treatments t JOIN patients p ON p.id = t.patient_id
      WHERE t.id = clinical_events.treatment_id
        AND p.user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
    )
  );

DROP POLICY clinical_events_doctor_in_carteira ON clinical_events;
CREATE POLICY clinical_events_doctor_in_carteira ON clinical_events
  FOR SELECT USING (
    current_setting('app.current_role', true) = 'DOCTOR'
    AND fn_doctor_has_treatment(NULLIF(current_setting('app.current_user_id', true), '')::uuid, clinical_events.treatment_id)
  );

DROP POLICY dpa_patient_self ON doctor_patient_assignments;
CREATE POLICY dpa_patient_self ON doctor_patient_assignments
  FOR SELECT USING (
    current_setting('app.current_role', true) = 'PATIENT'
    AND EXISTS (SELECT 1 FROM patients p WHERE p.id = doctor_patient_assignments.patient_id
      AND p.user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid)
  );

DROP POLICY dpa_doctor_self ON doctor_patient_assignments;
CREATE POLICY dpa_doctor_self ON doctor_patient_assignments
  FOR SELECT USING (
    current_setting('app.current_role', true) = 'DOCTOR'
    AND EXISTS (SELECT 1 FROM doctors d WHERE d.id = doctor_patient_assignments.doctor_id
      AND d.user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid)
  );

DROP POLICY subscriptions_self ON subscriptions;
CREATE POLICY subscriptions_self ON subscriptions
  FOR SELECT USING (
    current_setting('app.current_role', true) = 'PATIENT'
    AND EXISTS (SELECT 1 FROM patients p WHERE p.id = subscriptions.patient_id
      AND p.user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid)
  );

DROP POLICY subscriptions_doctor_carteira ON subscriptions;
CREATE POLICY subscriptions_doctor_carteira ON subscriptions
  FOR SELECT USING (
    current_setting('app.current_role', true) = 'DOCTOR'
    AND fn_doctor_has_treatment(NULLIF(current_setting('app.current_user_id', true), '')::uuid, subscriptions.treatment_id)
  );

DROP POLICY adesoes_self ON adesoes;
CREATE POLICY adesoes_self ON adesoes
  FOR SELECT USING (
    current_setting('app.current_role', true) = 'PATIENT'
    AND EXISTS (SELECT 1 FROM patients p WHERE p.id = adesoes.patient_id
      AND p.user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid)
  );

DROP POLICY eligibility_self ON eligibility_decisions;
CREATE POLICY eligibility_self ON eligibility_decisions
  FOR SELECT USING (
    current_setting('app.current_role', true) = 'PATIENT'
    AND EXISTS (SELECT 1 FROM patients p WHERE p.id = eligibility_decisions.patient_id
      AND p.user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid)
  );

DROP POLICY eligibility_doctor_carteira ON eligibility_decisions;
CREATE POLICY eligibility_doctor_carteira ON eligibility_decisions
  FOR SELECT USING (
    current_setting('app.current_role', true) = 'DOCTOR'
    AND fn_doctor_has_treatment(NULLIF(current_setting('app.current_user_id', true), '')::uuid, eligibility_decisions.treatment_id)
  );

DROP POLICY conversations_self ON conversations;
CREATE POLICY conversations_self ON conversations
  FOR SELECT USING (
    current_setting('app.current_role', true) = 'PATIENT'
    AND EXISTS (SELECT 1 FROM patients p WHERE p.id = conversations.patient_id
      AND p.user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid)
  );

DROP POLICY conversations_doctor_carteira ON conversations;
CREATE POLICY conversations_doctor_carteira ON conversations
  FOR SELECT USING (
    current_setting('app.current_role', true) = 'DOCTOR'
    AND fn_doctor_has_patient(NULLIF(current_setting('app.current_user_id', true), '')::uuid, conversations.patient_id)
  );
