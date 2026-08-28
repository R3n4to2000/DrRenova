-- Renovamed — Fatia 1 — Migration 0004: corrige policies *_admin_all que
-- esqueciam o papel SYSTEM.
--
-- BUG REAL ENCONTRADO EM EXECUÇÃO: `patients_admin_all`, `treatments_admin_all`
-- e `clinical_events_admin_all` só liberavam `current_role = 'ADMIN'`. Isso
-- bloqueava até o INSERT ... RETURNING de operações de sistema (role SYSTEM),
-- porque o RETURNING de um INSERT exige que a linha satisfaça alguma policy
-- de SELECT — e nenhuma cobria SYSTEM nessas três tabelas (diferente de
-- todas as outras, que já usavam IN ('ADMIN','SYSTEM')). Alinhando aqui.

DROP POLICY patients_admin_all ON patients;
CREATE POLICY patients_admin_all ON patients
  FOR ALL USING (current_setting('app.current_role', true) IN ('ADMIN', 'SYSTEM'));

DROP POLICY treatments_admin_all ON treatments;
CREATE POLICY treatments_admin_all ON treatments
  FOR ALL USING (current_setting('app.current_role', true) IN ('ADMIN', 'SYSTEM'));

DROP POLICY clinical_events_admin_all ON clinical_events;
CREATE POLICY clinical_events_admin_all ON clinical_events
  FOR ALL USING (current_setting('app.current_role', true) IN ('ADMIN', 'SYSTEM'));
