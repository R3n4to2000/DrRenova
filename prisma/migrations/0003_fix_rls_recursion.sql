-- Renovamed — Fatia 1 — Migration 0003: correção de recursão de RLS
--
-- BUG REAL ENCONTRADO EM EXECUÇÃO: policies em `patients` (e em outras
-- tabelas) faziam subquery direta em `doctor_patient_assignments`, que por
-- sua vez tem uma policy (`dpa_patient_self`) que faz subquery em
-- `patients`. Isso forma um ciclo estrutural que o Postgres rejeita com
-- "infinite recursion detected in policy for relation" — independentemente
-- do papel (role) em runtime, porque a expansão de policies OR'd acontece
-- em tempo de planejamento, não só em execução.
--
-- Correção padrão: mover a checagem de "médico tem este paciente/tratamento
-- na carteira" para funções SECURITY DEFINER, de propriedade de um role que
-- ignora RLS (app_migrator, superuser). Uma função não é expandida como
-- subquery pelo planejador de policies da mesma forma que um JOIN/EXISTS
-- direto, e sua execução roda sob outro role — quebrando o ciclo.

CREATE OR REPLACE FUNCTION fn_doctor_has_patient(p_doctor_user_id uuid, p_patient_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM doctor_patient_assignments dpa
    JOIN doctors d ON d.id = dpa.doctor_id
    WHERE dpa.patient_id = p_patient_id
      AND dpa.is_current = true
      AND d.user_id = p_doctor_user_id
  );
$$;

CREATE OR REPLACE FUNCTION fn_doctor_has_treatment(p_doctor_user_id uuid, p_treatment_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM doctor_patient_assignments dpa
    JOIN doctors d ON d.id = dpa.doctor_id
    WHERE dpa.treatment_id = p_treatment_id
      AND dpa.is_current = true
      AND d.user_id = p_doctor_user_id
  );
$$;

ALTER FUNCTION fn_doctor_has_patient(uuid, uuid) OWNER TO app_migrator;
ALTER FUNCTION fn_doctor_has_treatment(uuid, uuid) OWNER TO app_migrator;
REVOKE EXECUTE ON FUNCTION fn_doctor_has_patient(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION fn_doctor_has_treatment(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_doctor_has_patient(uuid, uuid) TO app_runtime;
GRANT EXECUTE ON FUNCTION fn_doctor_has_treatment(uuid, uuid) TO app_runtime;

-- ---- Recriar as policies afetadas usando as funções ----

DROP POLICY patients_doctor_in_carteira ON patients;
CREATE POLICY patients_doctor_in_carteira ON patients
  FOR SELECT USING (
    current_setting('app.current_role', true) = 'DOCTOR'
    AND fn_doctor_has_patient(current_setting('app.current_user_id', true)::uuid, patients.id)
  );

DROP POLICY treatments_doctor_in_carteira ON treatments;
CREATE POLICY treatments_doctor_in_carteira ON treatments
  FOR SELECT USING (
    current_setting('app.current_role', true) = 'DOCTOR'
    AND fn_doctor_has_treatment(current_setting('app.current_user_id', true)::uuid, treatments.id)
  );

DROP POLICY clinical_events_doctor_in_carteira ON clinical_events;
CREATE POLICY clinical_events_doctor_in_carteira ON clinical_events
  FOR SELECT USING (
    current_setting('app.current_role', true) = 'DOCTOR'
    AND fn_doctor_has_treatment(current_setting('app.current_user_id', true)::uuid, clinical_events.treatment_id)
  );

DROP POLICY subscriptions_doctor_carteira ON subscriptions;
CREATE POLICY subscriptions_doctor_carteira ON subscriptions
  FOR SELECT USING (
    current_setting('app.current_role', true) = 'DOCTOR'
    AND fn_doctor_has_treatment(current_setting('app.current_user_id', true)::uuid, subscriptions.treatment_id)
  );

DROP POLICY eligibility_doctor_carteira ON eligibility_decisions;
CREATE POLICY eligibility_doctor_carteira ON eligibility_decisions
  FOR SELECT USING (
    current_setting('app.current_role', true) = 'DOCTOR'
    AND fn_doctor_has_treatment(current_setting('app.current_user_id', true)::uuid, eligibility_decisions.treatment_id)
  );

DROP POLICY conversations_doctor_carteira ON conversations;
CREATE POLICY conversations_doctor_carteira ON conversations
  FOR SELECT USING (
    current_setting('app.current_role', true) = 'DOCTOR'
    AND fn_doctor_has_patient(current_setting('app.current_user_id', true)::uuid, conversations.patient_id)
  );
