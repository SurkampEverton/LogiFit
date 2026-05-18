-- packages/db/src/policies/0048_nutri_labs_rls.sql
-- Sprint 30 Faixa A — Suplementos + Exames laboratoriais.
--
-- 6 tabelas:
--   - supplements: global (tenant_id IS NULL) + tenant custom
--   - supplement_interactions: global + tenant
--   - supplement_prescriptions: tenant + member (portal Sprint 26)
--   - lab_analytes: global read-all (curadoria via platform_admin direto no banco)
--   - lab_reference_ranges: global read-all
--   - lab_results: tenant + member portal scope
--
-- Dado sensível (regra 4 LGPD art. 11) — leitura em lab_results gera audit_log
-- async no Server Action (regra 5).

ALTER TABLE supplements ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplements FORCE ROW LEVEL SECURITY;
ALTER TABLE supplement_interactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplement_interactions FORCE ROW LEVEL SECURITY;
ALTER TABLE supplement_prescriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplement_prescriptions FORCE ROW LEVEL SECURITY;
ALTER TABLE lab_analytes ENABLE ROW LEVEL SECURITY;
ALTER TABLE lab_analytes FORCE ROW LEVEL SECURITY;
ALTER TABLE lab_reference_ranges ENABLE ROW LEVEL SECURITY;
ALTER TABLE lab_reference_ranges FORCE ROW LEVEL SECURITY;
ALTER TABLE lab_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE lab_results FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON supplements              TO logifit_app;
GRANT SELECT, INSERT, UPDATE ON supplement_interactions  TO logifit_app;
GRANT SELECT, INSERT, UPDATE ON supplement_prescriptions TO logifit_app;
GRANT SELECT, INSERT, UPDATE ON lab_analytes             TO logifit_app;
GRANT SELECT, INSERT, UPDATE ON lab_reference_ranges     TO logifit_app;
GRANT SELECT, INSERT, UPDATE ON lab_results              TO logifit_app;

-- ─── supplements ─────────────────────────────────────────────────────────
CREATE POLICY supp_select_global_or_tenant ON supplements
  FOR SELECT
  USING (
    tenant_id IS NULL
    OR tenant_id = current_setting('app.tenant_id', true)::uuid
  );
CREATE POLICY supp_insert_tenant ON supplements
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY supp_update_tenant ON supplements
  FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ─── supplement_interactions ────────────────────────────────────────────
CREATE POLICY supp_int_select ON supplement_interactions
  FOR SELECT
  USING (
    tenant_id IS NULL
    OR tenant_id = current_setting('app.tenant_id', true)::uuid
  );
CREATE POLICY supp_int_insert ON supplement_interactions
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY supp_int_update ON supplement_interactions
  FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ─── supplement_prescriptions ───────────────────────────────────────────
-- staff do tenant OU member dono (portal Sprint 26)
CREATE POLICY supp_pres_select ON supplement_prescriptions
  FOR SELECT
  USING (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    OR member_id = NULLIF(current_setting('app.member_id', true), '')::uuid
  );
CREATE POLICY supp_pres_insert ON supplement_prescriptions
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY supp_pres_update ON supplement_prescriptions
  FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ─── lab_analytes (global read-all) ─────────────────────────────────────
CREATE POLICY lab_analytes_select ON lab_analytes
  FOR SELECT
  USING (true);  -- global, todos veem
-- Curadoria via platform_admin direto no banco; sem INSERT/UPDATE policy

-- ─── lab_reference_ranges (global read-all) ─────────────────────────────
CREATE POLICY lab_ref_select ON lab_reference_ranges
  FOR SELECT
  USING (true);

-- ─── lab_results ─────────────────────────────────────────────────────────
-- staff do tenant OU member dono
CREATE POLICY lab_results_select ON lab_results
  FOR SELECT
  USING (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    OR member_id = NULLIF(current_setting('app.member_id', true), '')::uuid
  );
CREATE POLICY lab_results_insert ON lab_results
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY lab_results_update ON lab_results
  FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

COMMENT ON TABLE supplements IS
  'Sprint 30 — catálogo de suplementos (global LogiFit + tenant custom). ADR 0082. ANVISA RDC 243/2018.';
COMMENT ON TABLE supplement_prescriptions IS
  'Sprint 30 — prescrição ativa de suplemento ao member. Vincula consulta Sprint 20 opcional. Status active/completed/discontinued.';
COMMENT ON TABLE lab_results IS
  'Sprint 30 — resultados de exames laboratoriais. out_of_range denormalizado calculado no Server Action consumindo reference_ranges + idade/sexo. Retenção 20a (Lei 13.787 + CFM 2.299).';
