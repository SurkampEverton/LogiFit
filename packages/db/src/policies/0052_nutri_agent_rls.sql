-- packages/db/src/policies/0052_nutri_agent_rls.sql
-- Sprint 34 Faixa A — Nutri-Agent IA.
--
-- 3 tabelas:
--   - nutri_agent_runs: staff (nutri); member não vê runs (audit interno)
--   - nutri_agent_suggestions: staff + member portal (paciente vê suggestion accepted que afeta plano dele)
--   - nutri_agent_metrics_snapshot: staff only (audit forense)

ALTER TABLE nutri_agent_runs              ENABLE ROW LEVEL SECURITY;
ALTER TABLE nutri_agent_runs              FORCE ROW LEVEL SECURITY;
ALTER TABLE nutri_agent_suggestions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE nutri_agent_suggestions       FORCE ROW LEVEL SECURITY;
ALTER TABLE nutri_agent_metrics_snapshot  ENABLE ROW LEVEL SECURITY;
ALTER TABLE nutri_agent_metrics_snapshot  FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON nutri_agent_runs              TO logifit_app;
GRANT SELECT, INSERT, UPDATE ON nutri_agent_suggestions       TO logifit_app;
GRANT SELECT, INSERT         ON nutri_agent_metrics_snapshot  TO logifit_app;  -- append-only

-- ─── nutri_agent_runs ───────────────────────────────────────────────────
CREATE POLICY nutri_agent_runs_select ON nutri_agent_runs
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY nutri_agent_runs_insert ON nutri_agent_runs
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY nutri_agent_runs_update ON nutri_agent_runs
  FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ─── nutri_agent_suggestions ────────────────────────────────────────────
-- staff vê tudo do tenant; member vê accepted que aplicaram em plano dele
CREATE POLICY nutri_agent_sugg_select ON nutri_agent_suggestions
  FOR SELECT
  USING (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    OR (
      member_id = NULLIF(current_setting('app.member_id', true), '')::uuid
      AND status = 'accepted'
    )
  );

CREATE POLICY nutri_agent_sugg_insert ON nutri_agent_suggestions
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY nutri_agent_sugg_update ON nutri_agent_suggestions
  FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ─── nutri_agent_metrics_snapshot (staff scope; append-only) ───────────
CREATE POLICY nutri_agent_metrics_select ON nutri_agent_metrics_snapshot
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY nutri_agent_metrics_insert ON nutri_agent_metrics_snapshot
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

COMMENT ON TABLE nutri_agent_runs IS
  'Sprint 34 — execução do Nutri-Agent IA. Audit completo: trigger, modelo, custo, status. ADR 0043.';
COMMENT ON TABLE nutri_agent_suggestions IS
  'Sprint 34 — propostas geradas pelo agent (sempre revisão profissional, ADR 0044). 5 kinds + 3 severities + classifier guard reusado Sprint 33.';
COMMENT ON TABLE nutri_agent_metrics_snapshot IS
  'Sprint 34 — snapshot dos dados consultados na run (audit forense + reprodutibilidade + LGPD provar processamento). Append-only.';
