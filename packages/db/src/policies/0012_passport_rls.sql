-- packages/db/src/policies/0012_passport_rls.sql
-- Sprint 01b Faixa B — RLS pras 3 tabelas de passaporte cross-tenant
-- (regra 42 + ADR 0077).
--
-- **Diferente das outras tabelas RLS**: estas têm semântica cross-tenant
-- por design. Policies precisam permitir leitura quando:
--   - tenant_id (reader) é o atual E
--   - há `patient_company_links` ativo entre patient e (tenant atual OU source tenant)
--
-- Sprint 01b Faixa B: policies SIMPLIFICADAS (só por tenant). Lookup
-- cross-tenant via funções SECURITY DEFINER + check de link ativo é
-- responsabilidade da camada `@repo/passport` (Sprint 02+ implementa).
-- Aqui garantimos isolamento BASE (sem vazamento entre tenants alheios).

-- ─── patient_company_links ──────────────────────────────────────────────
ALTER TABLE patient_company_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient_company_links FORCE  ROW LEVEL SECURITY;

-- SELECT: tenant atual vê seus próprios links
CREATE POLICY patient_company_links_select ON patient_company_links
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY patient_company_links_insert ON patient_company_links
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY patient_company_links_update ON patient_company_links
  FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- DELETE não permitido — revogação via revoked_at (preserva trilha LGPD)

-- ─── patient_link_modules ──────────────────────────────────────────────
-- Acesso via JOIN com patient_company_links (sem tenant_id direto).
-- RLS verifica que link.tenant_id corresponde ao app.tenant_id.
ALTER TABLE patient_link_modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient_link_modules FORCE  ROW LEVEL SECURITY;

CREATE POLICY patient_link_modules_via_link_select ON patient_link_modules
  FOR SELECT
  USING (
    link_id IN (
      SELECT id FROM patient_company_links
      WHERE tenant_id = current_setting('app.tenant_id', true)::uuid
    )
  );

CREATE POLICY patient_link_modules_via_link_write ON patient_link_modules
  FOR ALL TO logifit_app
  USING (
    link_id IN (
      SELECT id FROM patient_company_links
      WHERE tenant_id = current_setting('app.tenant_id', true)::uuid
    )
  )
  WITH CHECK (
    link_id IN (
      SELECT id FROM patient_company_links
      WHERE tenant_id = current_setting('app.tenant_id', true)::uuid
    )
  );

-- ─── patient_data_access_log ───────────────────────────────────────────
-- **Regra 42**: este log registra TODA leitura cross-tenant.
-- Policies:
--   - SELECT: reader_tenant (quem leu pode auditar) OU source_tenant (quem
--     forneceu pode auditar quem acessou)
--   - INSERT: sempre permitido (caller seta reader_tenant_id = current_setting)
--     mas WITH CHECK garante consistência
--   - UPDATE/DELETE: DENY (append-only, regra 5)
ALTER TABLE patient_data_access_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient_data_access_log FORCE  ROW LEVEL SECURITY;

CREATE POLICY patient_data_access_log_select ON patient_data_access_log
  FOR SELECT
  USING (
    reader_tenant_id = current_setting('app.tenant_id', true)::uuid
    OR source_tenant_id = current_setting('app.tenant_id', true)::uuid
  );

-- INSERT exige reader_tenant_id = app.tenant_id (caller é reader; loga onde está)
CREATE POLICY patient_data_access_log_insert ON patient_data_access_log
  FOR INSERT
  WITH CHECK (reader_tenant_id = current_setting('app.tenant_id', true)::uuid);

-- UPDATE/DELETE DENY total (append-only)

COMMENT ON TABLE patient_company_links IS
  'Passaporte cross-tenant (regra 42 + ADR 0077). 1 link ativo por (passport, tenant); 1 módulo ativo por (passport, module) em TODA a rede.';
COMMENT ON TABLE patient_link_modules IS
  'Módulos autorizados por link + responsável técnico. Status active/inactive/pending; deactivated_at preserva histórico.';
COMMENT ON TABLE patient_data_access_log IS
  'Audit de leitura cross-tenant (regra 42). Append-only; retenção 5 anos; lint cross-tenant-read-must-log enforce.';
