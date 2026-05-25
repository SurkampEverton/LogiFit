-- packages/db/src/policies/0062_fiscal_apuracao_rls.sql
-- Sprint 37a (ADR 0100 Proposed) — RLS + trigger pras 3 tabelas Apuração.

-- ─── fiscal_revenue_aggregations ─────────────────────────────────────────
ALTER TABLE fiscal_revenue_aggregations ENABLE ROW LEVEL SECURITY;
ALTER TABLE fiscal_revenue_aggregations FORCE  ROW LEVEL SECURITY;

CREATE POLICY fiscal_revenue_agg_select ON fiscal_revenue_aggregations
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY fiscal_revenue_agg_insert ON fiscal_revenue_aggregations
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY fiscal_revenue_agg_update ON fiscal_revenue_aggregations
  FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- DELETE não tem policy: append-then-update; arquivo via trigger nunca apaga
REVOKE DELETE ON fiscal_revenue_aggregations FROM logifit_app;
GRANT SELECT, INSERT, UPDATE ON fiscal_revenue_aggregations TO logifit_app;

-- Trigger BEFORE UPDATE: bloqueia mudança se status='closed' (exceto reopen
-- via super_admin — escopo Sprint 37c).
DROP TRIGGER IF EXISTS fiscal_revenue_agg_block_closed_update ON fiscal_revenue_aggregations;
CREATE OR REPLACE FUNCTION fiscal_revenue_agg_block_closed_update_fn() RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'closed' AND TG_OP = 'UPDATE' THEN
    -- Permite só transição closed → closed (idempotente) sem alterar campos críticos
    IF (NEW.receita_total_cents != OLD.receita_total_cents
        OR NEW.imposto_apurado_cents != OLD.imposto_apurado_cents
        OR NEW.aliquota_efetiva_bp IS DISTINCT FROM OLD.aliquota_efetiva_bp
        OR NEW.rbt12_cents IS DISTINCT FROM OLD.rbt12_cents
        OR NEW.memorial::text != OLD.memorial::text
        OR NEW.status != OLD.status) THEN
      RAISE EXCEPTION 'Apuração fechada (id=%) é imutável; abra reopenAggregation (Sprint 37c+) ou recompute via nova aggregation.', OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  -- Atualiza updated_at em qualquer UPDATE permitido
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER fiscal_revenue_agg_block_closed_update
  BEFORE UPDATE ON fiscal_revenue_aggregations
  FOR EACH ROW EXECUTE FUNCTION fiscal_revenue_agg_block_closed_update_fn();

-- ─── fiscal_revenue_breakdown ────────────────────────────────────────────
-- Acesso via JOIN com aggregations (sem tenant_id direto). RLS verifica que
-- aggregation_id pertence a aggregation do app.tenant_id.
ALTER TABLE fiscal_revenue_breakdown ENABLE ROW LEVEL SECURITY;
ALTER TABLE fiscal_revenue_breakdown FORCE  ROW LEVEL SECURITY;

CREATE POLICY fiscal_revenue_breakdown_via_agg_select ON fiscal_revenue_breakdown
  FOR SELECT
  USING (
    aggregation_id IN (
      SELECT id FROM fiscal_revenue_aggregations
      WHERE tenant_id = current_setting('app.tenant_id', true)::uuid
    )
  );

CREATE POLICY fiscal_revenue_breakdown_via_agg_write ON fiscal_revenue_breakdown
  FOR ALL TO logifit_app
  USING (
    aggregation_id IN (
      SELECT id FROM fiscal_revenue_aggregations
      WHERE tenant_id = current_setting('app.tenant_id', true)::uuid
    )
  )
  WITH CHECK (
    aggregation_id IN (
      SELECT id FROM fiscal_revenue_aggregations
      WHERE tenant_id = current_setting('app.tenant_id', true)::uuid
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON fiscal_revenue_breakdown TO logifit_app;

-- ─── fiscal_simples_brackets ─────────────────────────────────────────────
-- Tabela GLOBAL — sem tenant_id, sem RLS. Apenas GRANT SELECT.
-- Atualização anual via migration data (admin LogiFit; tenant não edita).
GRANT SELECT ON fiscal_simples_brackets TO logifit_app;

COMMENT ON TRIGGER fiscal_revenue_agg_block_closed_update ON fiscal_revenue_aggregations IS
  'Sprint 37a — bloqueia UPDATE de campos críticos em apurações fechadas (ADR 0100). Reopen restrito a super_admin pós-Sprint 37c.';
