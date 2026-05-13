-- packages/db/src/policies/0029_vendas_rls.sql
-- Sprint 10 Faixa A — Funil de vendas RLS (ADR 0022 esperado).
--
-- 5 tabelas: lead_stages + leads + lead_events + trial_classes + proposals
--
-- Política tenant-scoped via current_setting('app.tenant_id').
-- lead_events é append-only (sem UPDATE/DELETE), demais permitem UPDATE
-- pra movimentação de funil + edição de proposta.

-- ─── Ativa RLS + FORCE ──────────────────────────────────────────────────
ALTER TABLE lead_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_stages FORCE ROW LEVEL SECURITY;

ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads FORCE ROW LEVEL SECURITY;

ALTER TABLE lead_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_events FORCE ROW LEVEL SECURITY;

ALTER TABLE trial_classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE trial_classes FORCE ROW LEVEL SECURITY;

ALTER TABLE proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE proposals FORCE ROW LEVEL SECURITY;

-- ─── GRANTs ─────────────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE ON lead_stages TO logifit_app;
GRANT SELECT, INSERT, UPDATE ON leads TO logifit_app;
GRANT SELECT, INSERT ON lead_events TO logifit_app;
GRANT SELECT, INSERT, UPDATE ON trial_classes TO logifit_app;
GRANT SELECT, INSERT, UPDATE ON proposals TO logifit_app;

-- ─── lead_stages ───────────────────────────────────────────────────────
CREATE POLICY lead_stages_tenant_select ON lead_stages
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY lead_stages_tenant_insert ON lead_stages
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY lead_stages_tenant_update ON lead_stages
  FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Sem DELETE — soft via active=false.

-- ─── leads ─────────────────────────────────────────────────────────────
CREATE POLICY leads_tenant_select ON leads
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY leads_tenant_insert ON leads
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY leads_tenant_update ON leads
  FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Sem DELETE — soft via archived_at.

-- ─── lead_events (audit append-only — sem UPDATE/DELETE) ───────────────
CREATE POLICY lead_events_tenant_select ON lead_events
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY lead_events_tenant_insert ON lead_events
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ─── trial_classes ─────────────────────────────────────────────────────
CREATE POLICY trial_classes_tenant_select ON trial_classes
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY trial_classes_tenant_insert ON trial_classes
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY trial_classes_tenant_update ON trial_classes
  FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ─── proposals ─────────────────────────────────────────────────────────
CREATE POLICY proposals_tenant_select ON proposals
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY proposals_tenant_insert ON proposals
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY proposals_tenant_update ON proposals
  FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
