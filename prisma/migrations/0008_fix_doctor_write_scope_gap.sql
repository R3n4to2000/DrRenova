-- Renovamed — Fatia 1 (finalização): Migration 0008
--
-- GAP DE SEGURANÇA REAL ENCONTRADO durante a bateria final de testes
-- adversariais: três policies de escrita permitiam que QUALQUER médico
-- (role DOCTOR) escrevesse em tratamentos/eventos clínicos/decisões de
-- elegibilidade de QUALQUER paciente — sem checar se o tratamento está na
-- carteira do médico. As policies de LEITURA (SELECT) já faziam essa
-- checagem corretamente via fn_doctor_has_treatment; as de ESCRITA não.
--
-- Afetadas:
--   1. treatments_service_update (UPDATE em treatments)
--   2. clinical_events_write (INSERT em clinical_events)
--   3. eligibility_doctor_write (INSERT em eligibility_decisions)
--
-- Correção: DOCTOR só escreve se fn_doctor_has_treatment for verdadeiro
-- para o treatment_id da linha. ADMIN/SYSTEM continuam cobertos pelas
-- policies *_admin_all (FOR ALL) já existentes — por isso são removidos
-- da lista de roles aqui (ficam com um único caminho de autorização, não
-- dois desalinhados).

DROP POLICY treatments_service_update ON treatments;
CREATE POLICY treatments_service_update ON treatments
  FOR UPDATE USING (
    current_setting('app.current_role', true) = 'DOCTOR'
    AND fn_doctor_has_treatment(NULLIF(current_setting('app.current_user_id', true), '')::uuid, treatments.id)
  );

DROP POLICY clinical_events_write ON clinical_events;
CREATE POLICY clinical_events_write ON clinical_events
  FOR INSERT WITH CHECK (
    current_setting('app.current_role', true) = 'DOCTOR'
    AND fn_doctor_has_treatment(NULLIF(current_setting('app.current_user_id', true), '')::uuid, clinical_events.treatment_id)
  );

DROP POLICY eligibility_doctor_write ON eligibility_decisions;
CREATE POLICY eligibility_doctor_write ON eligibility_decisions
  FOR INSERT WITH CHECK (
    current_setting('app.current_role', true) = 'DOCTOR'
    AND fn_doctor_has_treatment(NULLIF(current_setting('app.current_user_id', true), '')::uuid, eligibility_decisions.treatment_id)
  );

-- Nota: treatments_service_write (INSERT em treatments) permanece
-- ADMIN/SYSTEM/DOCTOR sem checagem de carteira — correto: um treatment
-- ainda não tem vínculo de carteira no momento em que é criado (a
-- atribuição do médico responsável acontece depois, via
-- DoctorPatientAssignment). Não há o que restringir aqui sem quebrar o
-- fluxo de entrada clínica.
