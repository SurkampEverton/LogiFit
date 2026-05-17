-- packages/db/src/policies/0041_convenios_rls.sql
-- Sprint 22 Faixa A — TISS/TUSS + Convênios RLS.
--
-- 11 tabelas. insurance_plans + tuss_catalog + tuss_catalog_imports = GLOBAIS
-- (read-all); demais tenant-scoped.

ALTER TABLE insurance_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE insurance_plans FORCE ROW LEVEL SECURITY;

ALTER TABLE tuss_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE tuss_catalog FORCE ROW LEVEL SECURITY;

ALTER TABLE tuss_catalog_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE tuss_catalog_imports FORCE ROW LEVEL SECURITY;

ALTER TABLE insurance_agreements ENABLE ROW LEVEL SECURITY;
ALTER TABLE insurance_agreements FORCE ROW LEVEL SECURITY;

ALTER TABLE insurance_procedure_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE insurance_procedure_prices FORCE ROW LEVEL SECURITY;

ALTER TABLE member_insurances ENABLE ROW LEVEL SECURITY;
ALTER TABLE member_insurances FORCE ROW LEVEL SECURITY;

ALTER TABLE authorizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE authorizations FORCE ROW LEVEL SECURITY;

ALTER TABLE billing_guides ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_guides FORCE ROW LEVEL SECURITY;

ALTER TABLE billing_guide_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_guide_items FORCE ROW LEVEL SECURITY;

ALTER TABLE billing_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_batches FORCE ROW LEVEL SECURITY;

ALTER TABLE billing_glosas ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_glosas FORCE ROW LEVEL SECURITY;

-- GRANTs
GRANT SELECT, INSERT, UPDATE ON insurance_plans TO logifit_app;
GRANT SELECT ON tuss_catalog TO logifit_app;
GRANT SELECT, INSERT ON tuss_catalog_imports TO logifit_app;
GRANT SELECT, INSERT, UPDATE ON insurance_agreements TO logifit_app;
GRANT SELECT, INSERT, UPDATE ON insurance_procedure_prices TO logifit_app;
GRANT SELECT, INSERT, UPDATE ON member_insurances TO logifit_app;
GRANT SELECT, INSERT, UPDATE ON authorizations TO logifit_app;
GRANT SELECT, INSERT, UPDATE ON billing_guides TO logifit_app;
GRANT SELECT, INSERT, UPDATE ON billing_guide_items TO logifit_app;
GRANT SELECT, INSERT, UPDATE ON billing_batches TO logifit_app;
GRANT SELECT, INSERT, UPDATE ON billing_glosas TO logifit_app;

-- ─── insurance_plans (global tenant_id NULL + per-tenant) ─────────────
-- Leitura: globais + os do tenant
CREATE POLICY ip_select ON insurance_plans
  FOR SELECT USING (
    tenant_id IS NULL OR tenant_id = current_setting('app.tenant_id', true)::uuid
  );
CREATE POLICY ip_insert ON insurance_plans
  FOR INSERT WITH CHECK (
    tenant_id = current_setting('app.tenant_id', true)::uuid
  );
CREATE POLICY ip_update ON insurance_plans
  FOR UPDATE USING (
    tenant_id = current_setting('app.tenant_id', true)::uuid
  )
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ─── tuss_catalog (read-all global) ──────────────────────────────────
CREATE POLICY tuss_select_all ON tuss_catalog FOR SELECT USING (true);

-- ─── tuss_catalog_imports (read-all + insert admin) ──────────────────
CREATE POLICY tci_select_all ON tuss_catalog_imports FOR SELECT USING (true);
CREATE POLICY tci_insert_admin ON tuss_catalog_imports
  FOR INSERT WITH CHECK (true); -- Server Action gate em super_admin

-- ─── insurance_agreements ────────────────────────────────────────────
CREATE POLICY ia_tenant_select ON insurance_agreements
  FOR SELECT USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY ia_tenant_insert ON insurance_agreements
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY ia_tenant_update ON insurance_agreements
  FOR UPDATE USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ─── insurance_procedure_prices (via JOIN com agreement) ────────────
CREATE POLICY ipp_via_agreement_select ON insurance_procedure_prices
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM insurance_agreements ia
            WHERE ia.id = agreement_id
              AND ia.tenant_id = current_setting('app.tenant_id', true)::uuid)
  );
CREATE POLICY ipp_via_agreement_insert ON insurance_procedure_prices
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM insurance_agreements ia
            WHERE ia.id = agreement_id
              AND ia.tenant_id = current_setting('app.tenant_id', true)::uuid)
  );
CREATE POLICY ipp_via_agreement_update ON insurance_procedure_prices
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM insurance_agreements ia
            WHERE ia.id = agreement_id
              AND ia.tenant_id = current_setting('app.tenant_id', true)::uuid)
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM insurance_agreements ia
            WHERE ia.id = agreement_id
              AND ia.tenant_id = current_setting('app.tenant_id', true)::uuid)
  );

-- ─── member_insurances ───────────────────────────────────────────────
CREATE POLICY mi_tenant_select ON member_insurances
  FOR SELECT USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY mi_tenant_insert ON member_insurances
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY mi_tenant_update ON member_insurances
  FOR UPDATE USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ─── authorizations ──────────────────────────────────────────────────
CREATE POLICY auth_tenant_select ON authorizations
  FOR SELECT USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY auth_tenant_insert ON authorizations
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY auth_tenant_update ON authorizations
  FOR UPDATE USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ─── billing_guides ──────────────────────────────────────────────────
CREATE POLICY bg_tenant_select ON billing_guides
  FOR SELECT USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY bg_tenant_insert ON billing_guides
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY bg_tenant_update ON billing_guides
  FOR UPDATE USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ─── billing_guide_items ─────────────────────────────────────────────
CREATE POLICY bgi_tenant_select ON billing_guide_items
  FOR SELECT USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY bgi_tenant_insert ON billing_guide_items
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY bgi_tenant_update ON billing_guide_items
  FOR UPDATE USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ─── billing_batches ─────────────────────────────────────────────────
CREATE POLICY bb_tenant_select ON billing_batches
  FOR SELECT USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY bb_tenant_insert ON billing_batches
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY bb_tenant_update ON billing_batches
  FOR UPDATE USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ─── billing_glosas ──────────────────────────────────────────────────
CREATE POLICY bgl_tenant_select ON billing_glosas
  FOR SELECT USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY bgl_tenant_insert ON billing_glosas
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY bgl_tenant_update ON billing_glosas
  FOR UPDATE USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ─── COMMENTS ──────────────────────────────────────────────────────────
COMMENT ON TABLE insurance_plans IS
  'Sprint 22 (ADR 0029 esperado) — planos de saúde. tenant_id NULL = global LogiFit + tenant pode adicionar planos regionais.';
COMMENT ON TABLE tuss_catalog IS
  'Sprint 22 (ADRs 0029/0030 esperados) — terminologia TUSS versionada por release ANS (ex: 2026.01 do Ofício-Circular 1/2026). Read-all global.';
COMMENT ON TABLE billing_guides IS
  'Sprint 22 (ADR 0029 esperado) — guia TISS 4.01 (consulta/sp_sadt/honorario/internacao). @volume 2.4M+/ano particionamento manual trimestral. Snapshot do profissional + tuss_version persistido.';
COMMENT ON TABLE billing_glosas IS
  'Sprint 22 (ADR 0031 esperado) — glosas recebidas + recursos. Pipeline com validador proativo Sprint 22 reduz incidência.';
