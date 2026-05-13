-- packages/db/src/policies/0028_ai_settings_rls.sql
-- Sprint 06 Faixa C/D real — tenant_assistant_settings RLS (ADR 0075).
--
-- 1 row por tenant; admin do tenant edita; outros users apenas SELECT.

ALTER TABLE tenant_assistant_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_assistant_settings FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON tenant_assistant_settings TO logifit_app;

CREATE POLICY tenant_assistant_settings_select ON tenant_assistant_settings
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_assistant_settings_insert ON tenant_assistant_settings
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_assistant_settings_update ON tenant_assistant_settings
  FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
