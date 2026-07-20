-- packages/db/src/policies/0067_retencoes_rls.sql
-- Sprint 15b — RLS de retenções (ADR 0061).
--
-- tax_natures: naturezas GLOBAIS (tenant_id NULL) são legíveis por todos os
-- tenants (catálogo curado LogiFit) mas nunca editáveis — só super_admin
-- escreve nelas; custom do tenant segue RLS normal.
-- tax_retentions: dado fiscal/financeiro — staff com financeiro/fiscal lê,
-- contador externo lê (base da DARF), escrita exige permission de escrita.

ALTER TABLE tax_natures     ENABLE ROW LEVEL SECURITY;
ALTER TABLE tax_natures     FORCE ROW LEVEL SECURITY;
ALTER TABLE tax_retentions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE tax_retentions  FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON tax_natures    TO logifit_app;
GRANT SELECT, INSERT, UPDATE ON tax_retentions TO logifit_app;

-- ─── tax_natures ───────────────────────────────────────────────────────
CREATE POLICY tax_natures_select ON tax_natures
  FOR SELECT
  USING (
    tenant_id IS NULL
    OR tenant_id = current_setting('app.tenant_id', true)::uuid
  );

-- Custom do tenant: insert só no próprio tenant (nunca global)
CREATE POLICY tax_natures_insert ON tax_natures
  FOR INSERT
  WITH CHECK (
    (tenant_id = current_setting('app.tenant_id', true)::uuid
     AND current_setting('app.permissions', true) LIKE '%fiscal.admin%')
    OR current_setting('app.role', true) = 'super_admin'
  );

CREATE POLICY tax_natures_update ON tax_natures
  FOR UPDATE
  USING (
    (tenant_id = current_setting('app.tenant_id', true)::uuid
     AND current_setting('app.permissions', true) LIKE '%fiscal.admin%')
    OR current_setting('app.role', true) = 'super_admin'
  )
  WITH CHECK (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    OR current_setting('app.role', true) = 'super_admin'
  );

-- ─── tax_retentions ────────────────────────────────────────────────────
CREATE POLICY tax_retentions_select ON tax_retentions
  FOR SELECT
  USING (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    AND (
      current_setting('app.permissions', true) LIKE '%fiscal.%'
      OR current_setting('app.permissions', true) LIKE '%financeiro.%'
      OR current_setting('app.role', true) = 'contador_externo'
    )
  );

CREATE POLICY tax_retentions_insert ON tax_retentions
  FOR INSERT
  WITH CHECK (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    AND (
      current_setting('app.permissions', true) LIKE '%financeiro.%'
      OR current_setting('app.permissions', true) LIKE '%fiscal.admin%'
      OR current_setting('app.role', true) = 'system'
    )
  );

CREATE POLICY tax_retentions_update ON tax_retentions
  FOR UPDATE
  USING (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    AND (
      current_setting('app.permissions', true) LIKE '%financeiro.%'
      OR current_setting('app.permissions', true) LIKE '%fiscal.admin%'
    )
  )
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
