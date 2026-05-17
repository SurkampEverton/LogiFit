-- packages/db/src/policies/0039_fisio_rls.sql
-- Sprint 20 Faixa A — Prontuário Fisio + CID/CIF + signature_policies RLS.
--
-- 8 tabelas: cid_catalog + cif_catalog + signature_policies + tenant_signature_overrides
--           + consultas + consulta_cids + consulta_cifs + consulta_correction_notes
--
-- **cid_catalog + cif_catalog + signature_policies:** GLOBAIS (não-tenant);
--   leitura por todos. INSERT/UPDATE só via migration LogiFit (sem policy app).
--
-- **consultas:** RLS tenant_id + permission `prontuario.read` no Server Action.
--   Regra 25 (franquia bloqueia cross-company) aplicada em Server Action porque
--   depende do tenant.topology — RLS pura cobre tenant; Server Action faz a
--   filtragem fina por company.
--
-- **consulta_correction_notes:** Append-only (sem UPDATE/DELETE policy).
--
-- **tenant_signature_overrides:** só `super_admin` ou `dpo` insere (Server Action gate).

-- ─── Ativa RLS + FORCE ──────────────────────────────────────────────────
ALTER TABLE cid_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE cid_catalog FORCE ROW LEVEL SECURITY;

ALTER TABLE cif_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE cif_catalog FORCE ROW LEVEL SECURITY;

ALTER TABLE signature_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE signature_policies FORCE ROW LEVEL SECURITY;

ALTER TABLE tenant_signature_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_signature_overrides FORCE ROW LEVEL SECURITY;

ALTER TABLE consultas ENABLE ROW LEVEL SECURITY;
ALTER TABLE consultas FORCE ROW LEVEL SECURITY;

ALTER TABLE consulta_cids ENABLE ROW LEVEL SECURITY;
ALTER TABLE consulta_cids FORCE ROW LEVEL SECURITY;

ALTER TABLE consulta_cifs ENABLE ROW LEVEL SECURITY;
ALTER TABLE consulta_cifs FORCE ROW LEVEL SECURITY;

ALTER TABLE consulta_correction_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE consulta_correction_notes FORCE ROW LEVEL SECURITY;

-- ─── GRANTs ─────────────────────────────────────────────────────────────
GRANT SELECT ON cid_catalog TO logifit_app;
GRANT SELECT ON cif_catalog TO logifit_app;
GRANT SELECT ON signature_policies TO logifit_app;
GRANT SELECT, INSERT ON tenant_signature_overrides TO logifit_app;
GRANT SELECT, INSERT, UPDATE ON consultas TO logifit_app;
GRANT SELECT, INSERT ON consulta_cids TO logifit_app;
GRANT SELECT, INSERT ON consulta_cifs TO logifit_app;
GRANT SELECT, INSERT ON consulta_correction_notes TO logifit_app;

-- ─── cid_catalog (global read-all) ──────────────────────────────────────
CREATE POLICY cid_catalog_select_all ON cid_catalog FOR SELECT USING (true);

-- ─── cif_catalog (global read-all) ──────────────────────────────────────
CREATE POLICY cif_catalog_select_all ON cif_catalog FOR SELECT USING (true);

-- ─── signature_policies (global read-all) ──────────────────────────────
CREATE POLICY sig_policies_select_all ON signature_policies FOR SELECT USING (true);

-- ─── tenant_signature_overrides ───────────────────────────────────────
CREATE POLICY tso_tenant_select ON tenant_signature_overrides
  FOR SELECT USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY tso_tenant_insert ON tenant_signature_overrides
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ─── consultas ─────────────────────────────────────────────────────────
CREATE POLICY consultas_tenant_select ON consultas
  FOR SELECT USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY consultas_tenant_insert ON consultas
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
-- UPDATE só permitido em draft → locked/signed (transição enforced via Server Action)
CREATE POLICY consultas_tenant_update ON consultas
  FOR UPDATE USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ─── consulta_cids ─────────────────────────────────────────────────────
-- RLS por tenant via JOIN na consulta (sem coluna tenant_id no link)
CREATE POLICY ccids_via_consulta_select ON consulta_cids
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM consultas c
            WHERE c.id = consulta_id
              AND c.tenant_id = current_setting('app.tenant_id', true)::uuid)
  );
CREATE POLICY ccids_via_consulta_insert ON consulta_cids
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM consultas c
            WHERE c.id = consulta_id
              AND c.tenant_id = current_setting('app.tenant_id', true)::uuid)
  );

-- ─── consulta_cifs ─────────────────────────────────────────────────────
CREATE POLICY ccifs_via_consulta_select ON consulta_cifs
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM consultas c
            WHERE c.id = consulta_id
              AND c.tenant_id = current_setting('app.tenant_id', true)::uuid)
  );
CREATE POLICY ccifs_via_consulta_insert ON consulta_cifs
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM consultas c
            WHERE c.id = consulta_id
              AND c.tenant_id = current_setting('app.tenant_id', true)::uuid)
  );

-- ─── consulta_correction_notes (append-only) ───────────────────────────
CREATE POLICY ccnotes_tenant_select ON consulta_correction_notes
  FOR SELECT USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY ccnotes_tenant_insert ON consulta_correction_notes
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ─── COMMENTS ──────────────────────────────────────────────────────────
COMMENT ON TABLE cid_catalog IS
  'Sprint 20 (ADR 0028 esperado) — CID-11 global versionado curado pela LogiFit. Update anual via migration.';
COMMENT ON TABLE cif_catalog IS
  'Sprint 20 (ADR 0028 esperado) — CIF global com 4 componentes (body_functions/structures/activities_participation/environmental_factors).';
COMMENT ON TABLE signature_policies IS
  'Sprint 20 (ADR 0032 Accepted) — catálogo global de política de assinatura por profissão. Seedado por LogiFit; tenant não edita (usa overrides).';
COMMENT ON TABLE tenant_signature_overrides IS
  'Sprint 20 (ADR 0032 Accepted) — endurecimento per-tenant (Enterprise). CHECK mode_override = icp_required impede afrouxamento.';
COMMENT ON TABLE consultas IS
  'Sprint 20 — prontuário polimórfico (kind: medico/fisio/nutri/personal/enfermeiro/custom). Retenção 20a (Lei 13.787/2018). @volume 6M+/ano particionamento por trimestre.';
COMMENT ON TABLE consulta_correction_notes IS
  'Sprint 20 — append-only notas corretivas pós-lock (regra 5). Hash incluído em audit chain regra 39.';
