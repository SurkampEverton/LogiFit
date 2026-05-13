-- packages/db/src/policies/0027_engajamento_rls.sql
-- Sprint 09 Faixa A — Engajamento RLS (ADR 0021 esperado).
--
-- 6 tabelas: achievements + member_achievements + rewards_catalog +
--           reward_grants + goals + goal_measurements

-- ─── Ativa RLS + FORCE ──────────────────────────────────────────────────
ALTER TABLE achievements ENABLE ROW LEVEL SECURITY;
ALTER TABLE achievements FORCE ROW LEVEL SECURITY;

ALTER TABLE member_achievements ENABLE ROW LEVEL SECURITY;
ALTER TABLE member_achievements FORCE ROW LEVEL SECURITY;

ALTER TABLE rewards_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE rewards_catalog FORCE ROW LEVEL SECURITY;

ALTER TABLE reward_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE reward_grants FORCE ROW LEVEL SECURITY;

ALTER TABLE goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE goals FORCE ROW LEVEL SECURITY;

ALTER TABLE goal_measurements ENABLE ROW LEVEL SECURITY;
ALTER TABLE goal_measurements FORCE ROW LEVEL SECURITY;

-- ─── GRANTs ─────────────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE ON achievements TO logifit_app;
GRANT SELECT, INSERT ON member_achievements TO logifit_app;
GRANT SELECT, INSERT, UPDATE ON rewards_catalog TO logifit_app;
GRANT SELECT, INSERT, UPDATE ON reward_grants TO logifit_app;
GRANT SELECT, INSERT, UPDATE ON goals TO logifit_app;
GRANT SELECT, INSERT ON goal_measurements TO logifit_app;

-- ─── achievements ──────────────────────────────────────────────────────
CREATE POLICY achievements_tenant_select ON achievements
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY achievements_tenant_insert ON achievements
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY achievements_tenant_update ON achievements
  FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Sem DELETE — soft via archived_at.

-- ─── member_achievements (append-only — idempotente via PK) ────────────
CREATE POLICY member_achievements_tenant_select ON member_achievements
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY member_achievements_tenant_insert ON member_achievements
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ─── rewards_catalog ───────────────────────────────────────────────────
CREATE POLICY rewards_catalog_tenant_select ON rewards_catalog
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY rewards_catalog_tenant_insert ON rewards_catalog
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY rewards_catalog_tenant_update ON rewards_catalog
  FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ─── reward_grants ─────────────────────────────────────────────────────
CREATE POLICY reward_grants_tenant_select ON reward_grants
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY reward_grants_tenant_insert ON reward_grants
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY reward_grants_tenant_update ON reward_grants
  FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ─── goals ─────────────────────────────────────────────────────────────
CREATE POLICY goals_tenant_select ON goals
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY goals_tenant_insert ON goals
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY goals_tenant_update ON goals
  FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ─── goal_measurements (audit) ─────────────────────────────────────────
CREATE POLICY goal_measurements_tenant_select ON goal_measurements
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY goal_measurements_tenant_insert ON goal_measurements
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
