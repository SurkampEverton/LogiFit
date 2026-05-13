-- packages/db/src/policies/0024_alert_subscribers_rls.sql
-- Sprint 07 — Cross-alert dispatcher: RLS basic.

ALTER TABLE alert_subscribers ENABLE ROW LEVEL SECURITY;
ALTER TABLE alert_subscribers FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON alert_subscribers TO logifit_app;

CREATE POLICY alert_subscribers_tenant_select ON alert_subscribers
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY alert_subscribers_tenant_insert ON alert_subscribers
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY alert_subscribers_tenant_update ON alert_subscribers
  FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
