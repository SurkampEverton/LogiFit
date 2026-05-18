-- packages/db/src/policies/0043_estoque_rls.sql
-- Sprint 24 Faixa A — Estoque + POS + Inventário RLS.
--
-- 4 tabelas: stock_items + stock_movements (append-only) + stock_inventories + stock_inventory_entries
--
-- **Append-only stock_movements** — RLS permite INSERT mas não UPDATE (regra 5).
-- Ajuste pra mais/menos vira movimento novo. Sprint 24b adiciona trigger
-- bloqueando DELETE explicitamente.
--
-- **stock_inventory_entries via JOIN com inventory.**

ALTER TABLE stock_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_items FORCE ROW LEVEL SECURITY;

ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_movements FORCE ROW LEVEL SECURITY;

ALTER TABLE stock_inventories ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_inventories FORCE ROW LEVEL SECURITY;

ALTER TABLE stock_inventory_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_inventory_entries FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON stock_items TO logifit_app;
-- stock_movements: SEM UPDATE (regra 5 append-only)
GRANT SELECT, INSERT ON stock_movements TO logifit_app;
GRANT SELECT, INSERT, UPDATE ON stock_inventories TO logifit_app;
GRANT SELECT, INSERT, UPDATE ON stock_inventory_entries TO logifit_app;

-- ─── stock_items ──────────────────────────────────────────────────────
CREATE POLICY si_tenant_select ON stock_items
  FOR SELECT USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY si_tenant_insert ON stock_items
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY si_tenant_update ON stock_items
  FOR UPDATE USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ─── stock_movements (append-only) ────────────────────────────────────
CREATE POLICY sm_tenant_select ON stock_movements
  FOR SELECT USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY sm_tenant_insert ON stock_movements
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
-- Sem UPDATE policy intencionalmente (regra 5)

-- ─── stock_inventories ───────────────────────────────────────────────
CREATE POLICY sinv_tenant_select ON stock_inventories
  FOR SELECT USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY sinv_tenant_insert ON stock_inventories
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY sinv_tenant_update ON stock_inventories
  FOR UPDATE USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ─── stock_inventory_entries (via JOIN com inventory) ────────────────
CREATE POLICY sie_via_inventory_select ON stock_inventory_entries
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM stock_inventories i
            WHERE i.id = inventory_id
              AND i.tenant_id = current_setting('app.tenant_id', true)::uuid)
  );
CREATE POLICY sie_via_inventory_insert ON stock_inventory_entries
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM stock_inventories i
            WHERE i.id = inventory_id
              AND i.tenant_id = current_setting('app.tenant_id', true)::uuid)
  );
CREATE POLICY sie_via_inventory_update ON stock_inventory_entries
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM stock_inventories i
            WHERE i.id = inventory_id
              AND i.tenant_id = current_setting('app.tenant_id', true)::uuid)
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM stock_inventories i
            WHERE i.id = inventory_id
              AND i.tenant_id = current_setting('app.tenant_id', true)::uuid)
  );

COMMENT ON TABLE stock_items IS
  'Sprint 24 (ADR 0087 esperado) — catálogo de itens de estoque. SKU unique por (tenant, company). Custo + preço + min_stock + cost_method.';
COMMENT ON TABLE stock_movements IS
  'Sprint 24 — APPEND-ONLY (regra 5). entry/exit por kind enum; quantity sempre positiva; sinal definido por kind. @volume 2.4M+/ano particionamento manual Sprint 24b.';
COMMENT ON TABLE stock_inventories IS
  'Sprint 24 — contagem física. Status draft → finalized (Server Action gera ajustes).';
COMMENT ON TABLE stock_inventory_entries IS
  'Sprint 24 — item por inventário com diferença (physical_qty - system_qty). CHECK consistência.';
