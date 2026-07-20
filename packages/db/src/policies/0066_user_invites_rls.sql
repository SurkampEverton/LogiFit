-- packages/db/src/policies/0066_user_invites_rls.sql
-- Sprint 01c — RLS de user_invites (ADR 0103).
--
-- Staff do tenant gerencia (SAs gateiam fiscal.admin por cima); o ACEITE
-- público (pré-auth) roda em contexto elevado (withElevatedContext) e não
-- passa por estas policies.

ALTER TABLE user_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_invites FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON user_invites TO logifit_app;

CREATE POLICY user_invites_select ON user_invites
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY user_invites_insert ON user_invites
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY user_invites_update ON user_invites
  FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
