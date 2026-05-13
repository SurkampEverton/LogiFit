-- packages/db/src/policies/0026_compliance_rls.sql
-- Sprint 01b fechamento — Compliance RLS (CFM 2.454, LGPD art. 18, PAM).
--
-- 6 tabelas:
--   - ai_committees + ai_committee_members + ai_committee_decisions
--   - privileged_sessions (PAM — cross-tenant; super_admin LogiFit)
--   - data_subject_requests
--
-- privileged_sessions tem RLS especial — super_admin acessa todos tenants
-- (operator_user_id é o super_admin; target_tenant_id é o alvo). Sprint 02+
-- adiciona check de role super_admin_rede na policy.

-- ─── Ativa RLS + FORCE ──────────────────────────────────────────────────
ALTER TABLE ai_committees ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_committees FORCE ROW LEVEL SECURITY;

ALTER TABLE ai_committee_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_committee_members FORCE ROW LEVEL SECURITY;

ALTER TABLE ai_committee_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_committee_decisions FORCE ROW LEVEL SECURITY;

ALTER TABLE privileged_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE privileged_sessions FORCE ROW LEVEL SECURITY;

ALTER TABLE data_subject_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_subject_requests FORCE ROW LEVEL SECURITY;

-- ─── GRANTs ─────────────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE ON ai_committees TO logifit_app;
GRANT SELECT, INSERT, UPDATE ON ai_committee_members TO logifit_app;
GRANT SELECT, INSERT ON ai_committee_decisions TO logifit_app;
GRANT SELECT, INSERT, UPDATE ON privileged_sessions TO logifit_app;
GRANT SELECT, INSERT, UPDATE ON data_subject_requests TO logifit_app;

-- ─── ai_committees ─────────────────────────────────────────────────────
CREATE POLICY ai_committees_tenant_select ON ai_committees
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY ai_committees_tenant_insert ON ai_committees
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY ai_committees_tenant_update ON ai_committees
  FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ─── ai_committee_members ──────────────────────────────────────────────
CREATE POLICY ai_committee_members_tenant_select ON ai_committee_members
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY ai_committee_members_tenant_insert ON ai_committee_members
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY ai_committee_members_tenant_update ON ai_committee_members
  FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ─── ai_committee_decisions (append-only) ──────────────────────────────
CREATE POLICY ai_committee_decisions_tenant_select ON ai_committee_decisions
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY ai_committee_decisions_tenant_insert ON ai_committee_decisions
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ─── privileged_sessions (PAM) ─────────────────────────────────────────
-- Operator vê suas próprias sessões; target tenant pode ver sessões ativas
-- pra auditoria. Sprint 02+ refina com has_permission('pam.read').
CREATE POLICY privileged_sessions_self_or_target ON privileged_sessions
  FOR SELECT
  USING (
    operator_user_id = current_setting('app.user_id', true)::uuid
    OR target_tenant_id = current_setting('app.tenant_id', true)::uuid
  );

CREATE POLICY privileged_sessions_self_insert ON privileged_sessions
  FOR INSERT
  WITH CHECK (operator_user_id = current_setting('app.user_id', true)::uuid);

CREATE POLICY privileged_sessions_self_update ON privileged_sessions
  FOR UPDATE
  USING (
    operator_user_id = current_setting('app.user_id', true)::uuid
    OR approved_by_user_id = current_setting('app.user_id', true)::uuid
  );

-- ─── data_subject_requests ─────────────────────────────────────────────
CREATE POLICY dsr_tenant_select ON data_subject_requests
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY dsr_tenant_insert ON data_subject_requests
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY dsr_tenant_update ON data_subject_requests
  FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
