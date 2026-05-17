-- packages/db/src/policies/0033_custos_rls.sql
-- Sprint 14 Faixa A — Custos operacionais RLS.
--
-- 3 tabelas: cost_categories + cost_entries + recurring_costs
--
-- **Scope por company** (Sprint 14 doc): Server Actions verificam via
-- `has_permission(user_id, 'custos.read', 'company', company_id)` (ADR 0019).
-- RLS pura limita ao tenant.

-- ─── Ativa RLS + FORCE ──────────────────────────────────────────────────
ALTER TABLE cost_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE cost_categories FORCE ROW LEVEL SECURITY;

ALTER TABLE cost_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE cost_entries FORCE ROW LEVEL SECURITY;

ALTER TABLE recurring_costs ENABLE ROW LEVEL SECURITY;
ALTER TABLE recurring_costs FORCE ROW LEVEL SECURITY;

-- ─── GRANTs ─────────────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE ON cost_categories TO logifit_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON cost_entries TO logifit_app;
GRANT SELECT, INSERT, UPDATE ON recurring_costs TO logifit_app;

-- ─── cost_categories ───────────────────────────────────────────────────
CREATE POLICY cost_categories_tenant_select ON cost_categories
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY cost_categories_tenant_insert ON cost_categories
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY cost_categories_tenant_update ON cost_categories
  FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Sem DELETE — soft via archived_at.

-- ─── cost_entries ──────────────────────────────────────────────────────
CREATE POLICY cost_entries_tenant_select ON cost_entries
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY cost_entries_tenant_insert ON cost_entries
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY cost_entries_tenant_update ON cost_entries
  FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- DELETE permitido em cost_entries pra correção de erro de lançamento
-- (audit_log registra via wrapServerAction). Sprint 14+: soft-delete via
-- coluna ad-hoc se compliance exigir retenção.
CREATE POLICY cost_entries_tenant_delete ON cost_entries
  FOR DELETE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ─── recurring_costs ──────────────────────────────────────────────────
CREATE POLICY recurring_costs_tenant_select ON recurring_costs
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY recurring_costs_tenant_insert ON recurring_costs
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY recurring_costs_tenant_update ON recurring_costs
  FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Sem DELETE — soft via active=false.

-- ─── COMMENTS ──────────────────────────────────────────────────────────
COMMENT ON TABLE cost_categories IS
  'Catálogo de categorias de custo. type=fixed/variable discrimina previsibilidade.';
COMMENT ON TABLE cost_entries IS
  'Registros de desembolso. incurred_at = data do custo (DRE agrupa por aqui). recurring_cost_id se gerado por cron.';
COMMENT ON TABLE recurring_costs IS
  'Template mensal. Cron diário recurring-tick gera cost_entries (Sprint 14+).';
