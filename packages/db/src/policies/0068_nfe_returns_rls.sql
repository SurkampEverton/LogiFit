-- packages/db/src/policies/0068_nfe_returns_rls.sql
-- Sprint 17b — RLS de devolução de compra (ADR 0104).
--
-- Leitura: quem tem fiscal.* ou financeiro.* + contador externo (é base
-- contábil de crédito). Escrita: fiscal.emit/admin (a devolução gera nota).

ALTER TABLE nfe_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE nfe_returns FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON nfe_returns TO logifit_app;

CREATE POLICY nfe_returns_select ON nfe_returns
  FOR SELECT
  USING (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    AND (
      current_setting('app.permissions', true) LIKE '%fiscal.%'
      OR current_setting('app.permissions', true) LIKE '%financeiro.%'
      OR current_setting('app.role', true) = 'contador_externo'
    )
  );

CREATE POLICY nfe_returns_insert ON nfe_returns
  FOR INSERT
  WITH CHECK (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    AND (
      current_setting('app.permissions', true) LIKE '%fiscal.emit%'
      OR current_setting('app.permissions', true) LIKE '%fiscal.admin%'
    )
  );

CREATE POLICY nfe_returns_update ON nfe_returns
  FOR UPDATE
  USING (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    AND (
      current_setting('app.permissions', true) LIKE '%fiscal.emit%'
      OR current_setting('app.permissions', true) LIKE '%fiscal.admin%'
    )
  )
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
