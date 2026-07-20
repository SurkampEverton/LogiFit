-- packages/db/src/policies/0064_usage_snapshots_rls.sql
-- Sprint 04b — RLS de tenant_usage_snapshots (ADR 0102).
--
-- Escrita SOMENTE via job cron (role 'system'); leitura: tenant lê a própria
-- row (UI /app/settings/tenant/plan) + super_admin lê todas.

ALTER TABLE tenant_usage_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_usage_snapshots FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON tenant_usage_snapshots TO logifit_app;

CREATE POLICY tus_select ON tenant_usage_snapshots
  FOR SELECT
  USING (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    OR current_setting('app.role', true) IN ('super_admin', 'system')
  );

CREATE POLICY tus_insert ON tenant_usage_snapshots
  FOR INSERT
  WITH CHECK (current_setting('app.role', true) = 'system');

CREATE POLICY tus_update ON tenant_usage_snapshots
  FOR UPDATE
  USING (current_setting('app.role', true) = 'system')
  WITH CHECK (current_setting('app.role', true) = 'system');
