-- packages/db/src/policies/0063_pos_rls.sql
-- Sprint 24b — RLS de vendas POS (ADR 0101 + regra 1).
--
-- Permissions: reusa família estoque/vendas — leitura por staff operacional
-- (qualquer permission de venda/estoque), escrita por quem opera POS.
-- Contador externo lê (base contábil), nunca escreve.

ALTER TABLE sales          ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales          FORCE ROW LEVEL SECURITY;
ALTER TABLE sale_items     ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_items     FORCE ROW LEVEL SECURITY;
ALTER TABLE sale_payments  ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_payments  FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON sales         TO logifit_app;
GRANT SELECT, INSERT ON sale_items            TO logifit_app;
GRANT SELECT, INSERT ON sale_payments         TO logifit_app;

-- ─── sales ─────────────────────────────────────────────────────────────
CREATE POLICY sales_select ON sales
  FOR SELECT
  USING (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    AND (
      current_setting('app.permissions', true) LIKE '%estoque.%'
      OR current_setting('app.permissions', true) LIKE '%vendas.%'
      OR current_setting('app.permissions', true) LIKE '%fiscal.%'
      OR current_setting('app.role', true) = 'contador_externo'
    )
  );

CREATE POLICY sales_insert ON sales
  FOR INSERT
  WITH CHECK (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    AND (
      current_setting('app.permissions', true) LIKE '%vendas.write%'
      OR current_setting('app.permissions', true) LIKE '%estoque.write%'
    )
  );

-- UPDATE só pra soft-cancel (status/cancelled_at/cancel_reason) — SA valida
CREATE POLICY sales_update ON sales
  FOR UPDATE
  USING (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    AND (
      current_setting('app.permissions', true) LIKE '%vendas.write%'
      OR current_setting('app.permissions', true) LIKE '%estoque.write%'
    )
  )
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ─── sale_items (imutável pós-venda — sem UPDATE/DELETE grant) ─────────
CREATE POLICY sale_items_select ON sale_items
  FOR SELECT
  USING (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    AND (
      current_setting('app.permissions', true) LIKE '%estoque.%'
      OR current_setting('app.permissions', true) LIKE '%vendas.%'
      OR current_setting('app.permissions', true) LIKE '%fiscal.%'
      OR current_setting('app.role', true) = 'contador_externo'
    )
  );

CREATE POLICY sale_items_insert ON sale_items
  FOR INSERT
  WITH CHECK (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    AND (
      current_setting('app.permissions', true) LIKE '%vendas.write%'
      OR current_setting('app.permissions', true) LIKE '%estoque.write%'
    )
  );

-- ─── sale_payments (imutável pós-venda) ────────────────────────────────
CREATE POLICY sale_payments_select ON sale_payments
  FOR SELECT
  USING (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    AND (
      current_setting('app.permissions', true) LIKE '%estoque.%'
      OR current_setting('app.permissions', true) LIKE '%vendas.%'
      OR current_setting('app.permissions', true) LIKE '%fiscal.%'
      OR current_setting('app.role', true) = 'contador_externo'
    )
  );

CREATE POLICY sale_payments_insert ON sale_payments
  FOR INSERT
  WITH CHECK (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    AND (
      current_setting('app.permissions', true) LIKE '%vendas.write%'
      OR current_setting('app.permissions', true) LIKE '%estoque.write%'
    )
  );
