-- Renovamed — Fatia 1 — Migration 0006: última policy esquecida na blindagem
-- NULLIF (conversation_messages) — mesmo bug da migration 0005.

DROP POLICY conv_messages_via_conversation ON conversation_messages;
CREATE POLICY conv_messages_via_conversation ON conversation_messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM conversations c WHERE c.id = conversation_messages.conversation_id
      AND (
        (current_setting('app.current_role', true) = 'PATIENT' AND EXISTS (
          SELECT 1 FROM patients p WHERE p.id = c.patient_id
          AND p.user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid))
        OR (current_setting('app.current_role', true) = 'DOCTOR' AND fn_doctor_has_patient(
          NULLIF(current_setting('app.current_user_id', true), '')::uuid, c.patient_id))
        OR current_setting('app.current_role', true) IN ('ADMIN','SYSTEM')
      )
    )
  );
