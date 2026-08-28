-- Renovamed — Pilot Readiness — Migration 0014: gap de RLS em conversations
--
-- BUG REAL ENCONTRADO durante validação do Outbox: quando um médico
-- registra uma decisão clínica e a Camilla precisa notificar o paciente,
-- ela cria a Conversation daquele paciente — mas a policy de INSERT só
-- permitia PATIENT/SYSTEM/ADMIN, nunca DOCTOR. Toda decisão médica que
-- aciona a Camilla pela primeira vez para um paciente falhava.
--
-- Correção: DOCTOR pode criar Conversation, mas só para paciente
-- atualmente em sua carteira (fn_doctor_has_patient, já existente).

DROP POLICY conversations_write ON conversations;
CREATE POLICY conversations_write ON conversations
  FOR INSERT WITH CHECK (
    current_setting('app.current_role', true) IN ('PATIENT', 'SYSTEM', 'ADMIN')
    OR (
      current_setting('app.current_role', true) = 'DOCTOR'
      AND fn_doctor_has_patient(NULLIF(current_setting('app.current_user_id', true), '')::uuid, conversations.patient_id)
    )
  );
