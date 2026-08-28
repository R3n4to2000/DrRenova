-- Renovamed — Fatia 1 (continuação): Migration 0007
-- RLS para as tabelas pendentes: users, communication_consents,
-- patient_communication_preferences.
--
-- Princípio: defesa em profundidade e menor privilégio. Nenhuma policy
-- "permissiva só para o teste passar" — o desenho segue exatamente o mesmo
-- padrão já usado nas demais tabelas (self + admin/system; sem policy para
-- SUPPORT = acesso negado por padrão).

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE communication_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient_communication_preferences ENABLE ROW LEVEL SECURITY;

-- ---- USERS ----
-- Um usuário só enxerga a própria linha (comparando id, não authUserId —
-- id é o identificador interno já presente no contexto de RLS).
CREATE POLICY users_self ON users
  FOR SELECT USING (
    id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
  );

CREATE POLICY users_admin_all ON users
  FOR ALL USING (current_setting('app.current_role', true) IN ('ADMIN', 'SYSTEM'));

-- Sem policy para DOCTOR/PATIENT/SUPPORT verem OUTROS usuários — só a si
-- mesmos (acima) ou nada (ausência de policy aplicável = negado).

-- ---- COMMUNICATION_CONSENTS ----
-- Consentimento é uma decisão do próprio paciente sobre si mesmo — só o
-- paciente dono e ADMIN/SYSTEM enxergam. SUPPORT não vê (sem policy).
CREATE POLICY consents_self ON communication_consents
  FOR SELECT USING (
    current_setting('app.current_role', true) = 'PATIENT'
    AND EXISTS (SELECT 1 FROM patients p WHERE p.id = communication_consents.patient_id
      AND p.user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid)
  );

CREATE POLICY consents_admin_all ON communication_consents
  FOR ALL USING (current_setting('app.current_role', true) IN ('ADMIN', 'SYSTEM'));

CREATE POLICY consents_patient_write ON communication_consents
  FOR INSERT WITH CHECK (
    current_setting('app.current_role', true) IN ('PATIENT', 'SYSTEM', 'ADMIN')
  );

CREATE POLICY consents_patient_revoke ON communication_consents
  FOR UPDATE USING (
    current_setting('app.current_role', true) = 'PATIENT'
    AND EXISTS (SELECT 1 FROM patients p WHERE p.id = communication_consents.patient_id
      AND p.user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid)
  );

-- ---- PATIENT_COMMUNICATION_PREFERENCES ----
-- Mesmo padrão: só o próprio paciente (leitura e escrita das preferências)
-- e ADMIN/SYSTEM. Médico não precisa ler preferências de comunicação.
CREATE POLICY comm_prefs_self_select ON patient_communication_preferences
  FOR SELECT USING (
    current_setting('app.current_role', true) = 'PATIENT'
    AND EXISTS (SELECT 1 FROM patients p WHERE p.id = patient_communication_preferences.patient_id
      AND p.user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid)
  );

CREATE POLICY comm_prefs_self_update ON patient_communication_preferences
  FOR UPDATE USING (
    current_setting('app.current_role', true) = 'PATIENT'
    AND EXISTS (SELECT 1 FROM patients p WHERE p.id = patient_communication_preferences.patient_id
      AND p.user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid)
  );

CREATE POLICY comm_prefs_admin_all ON patient_communication_preferences
  FOR ALL USING (current_setting('app.current_role', true) IN ('ADMIN', 'SYSTEM'));

CREATE POLICY comm_prefs_insert ON patient_communication_preferences
  FOR INSERT WITH CHECK (
    current_setting('app.current_role', true) IN ('PATIENT', 'SYSTEM', 'ADMIN')
  );
