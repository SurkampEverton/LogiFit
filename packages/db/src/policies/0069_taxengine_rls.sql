-- packages/db/src/policies/0069_taxengine_rls.sql
-- Sprint 41b — RLS do motor tributário (ADR 0108, regra 47).
--
-- Duas classes de tabela com tratamento oposto, de propósito:
--
--   `tax_ref_*` — catálogo da legislação federal, igual para todo mundo. Sem
--   `tenant_id`, sem RLS, apenas GRANT SELECT: replicar por tenant multiplicaria
--   a manutenção sem isolar nada que seja de alguém. Escrita só por migration.
--   Exceção declarada à regra 1, precedente do ADR 0028 (CID/CIF).
--
--   configuração do tenant (`fiscal_profiles`, `tax_rules`, naturezas, sombra) —
--   RLS normal. Ler exige permissão fiscal; **escrever exige `fiscal.admin`**,
--   porque errar uma alíquota aqui contamina toda nota futura daquele perfil.

-- ═══════════════════════════════════════════════════════════════════════════
-- Catálogo nacional: leitura para todos, escrita para ninguém em runtime
-- ═══════════════════════════════════════════════════════════════════════════
GRANT SELECT ON tax_ref_icms_cst       TO logifit_app;
GRANT SELECT ON tax_ref_csosn          TO logifit_app;
GRANT SELECT ON tax_ref_pis_cofins_cst TO logifit_app;
GRANT SELECT ON tax_ref_ipi_cst        TO logifit_app;
GRANT SELECT ON tax_ref_icms_origem    TO logifit_app;
GRANT SELECT ON tax_ref_mod_bc         TO logifit_app;
GRANT SELECT ON tax_ref_mod_bc_st      TO logifit_app;
GRANT SELECT ON tax_ref_cfop           TO logifit_app;

-- ═══════════════════════════════════════════════════════════════════════════
-- Configuração por tenant
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE fiscal_profiles            ENABLE ROW LEVEL SECURITY;
ALTER TABLE fiscal_profiles            FORCE  ROW LEVEL SECURITY;
ALTER TABLE tax_rules                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE tax_rules                  FORCE  ROW LEVEL SECURITY;
ALTER TABLE operation_natures          ENABLE ROW LEVEL SECURITY;
ALTER TABLE operation_natures          FORCE  ROW LEVEL SECURITY;
ALTER TABLE operation_nature_defaults  ENABLE ROW LEVEL SECURITY;
ALTER TABLE operation_nature_defaults  FORCE  ROW LEVEL SECURITY;
ALTER TABLE fiscal_tax_shadow_runs     ENABLE ROW LEVEL SECURITY;
ALTER TABLE fiscal_tax_shadow_runs     FORCE  ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON fiscal_profiles           TO logifit_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON tax_rules                 TO logifit_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON operation_natures         TO logifit_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON operation_nature_defaults TO logifit_app;
GRANT SELECT, INSERT                 ON fiscal_tax_shadow_runs    TO logifit_app;

DROP POLICY IF EXISTS fiscal_profiles_select ON fiscal_profiles;
DROP POLICY IF EXISTS fiscal_profiles_write  ON fiscal_profiles;
DROP POLICY IF EXISTS tax_rules_select       ON tax_rules;
DROP POLICY IF EXISTS tax_rules_write        ON tax_rules;
DROP POLICY IF EXISTS operation_natures_select ON operation_natures;
DROP POLICY IF EXISTS operation_natures_write  ON operation_natures;
DROP POLICY IF EXISTS operation_nature_defaults_select ON operation_nature_defaults;
DROP POLICY IF EXISTS operation_nature_defaults_write  ON operation_nature_defaults;
DROP POLICY IF EXISTS fiscal_tax_shadow_select ON fiscal_tax_shadow_runs;
DROP POLICY IF EXISTS fiscal_tax_shadow_insert ON fiscal_tax_shadow_runs;

-- ─── fiscal_profiles ───────────────────────────────────────────────────
-- Leitura ampla dentro do tenant: a tela de produto precisa listar perfis pra
-- vincular, e quem cadastra produto não é necessariamente quem configura ISS.
CREATE POLICY fiscal_profiles_select ON fiscal_profiles
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY fiscal_profiles_write ON fiscal_profiles
  FOR ALL
  USING (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    AND (
      current_setting('app.permissions', true) LIKE '%fiscal.admin%'
      OR current_setting('app.role', true) IN ('system', 'super_admin')
    )
  )
  WITH CHECK (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    AND (
      current_setting('app.permissions', true) LIKE '%fiscal.admin%'
      OR current_setting('app.role', true) IN ('system', 'super_admin')
    )
  );

-- ─── tax_rules ─────────────────────────────────────────────────────────
-- Contador externo lê (precisa conferir a tributação aplicada) mas nunca
-- escreve — o portal dele é read-only por LGPD (ADR 0061).
CREATE POLICY tax_rules_select ON tax_rules
  FOR SELECT
  USING (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    AND (
      current_setting('app.permissions', true) LIKE '%fiscal.%'
      OR current_setting('app.role', true) = 'contador_externo'
    )
  );

CREATE POLICY tax_rules_write ON tax_rules
  FOR ALL
  USING (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    AND (
      current_setting('app.permissions', true) LIKE '%fiscal.admin%'
      OR current_setting('app.role', true) IN ('system', 'super_admin')
    )
  )
  WITH CHECK (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    AND (
      current_setting('app.permissions', true) LIKE '%fiscal.admin%'
      OR current_setting('app.role', true) IN ('system', 'super_admin')
    )
  );

-- ─── operation_natures + defaults ──────────────────────────────────────
CREATE POLICY operation_natures_select ON operation_natures
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY operation_natures_write ON operation_natures
  FOR ALL
  USING (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    AND (
      current_setting('app.permissions', true) LIKE '%fiscal.admin%'
      OR current_setting('app.role', true) IN ('system', 'super_admin')
    )
  )
  WITH CHECK (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    AND (
      current_setting('app.permissions', true) LIKE '%fiscal.admin%'
      OR current_setting('app.role', true) IN ('system', 'super_admin')
    )
  );

CREATE POLICY operation_nature_defaults_select ON operation_nature_defaults
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY operation_nature_defaults_write ON operation_nature_defaults
  FOR ALL
  USING (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    AND (
      current_setting('app.permissions', true) LIKE '%fiscal.admin%'
      OR current_setting('app.role', true) IN ('system', 'super_admin')
    )
  )
  WITH CHECK (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    AND (
      current_setting('app.permissions', true) LIKE '%fiscal.admin%'
      OR current_setting('app.role', true) IN ('system', 'super_admin')
    )
  );

-- ─── fiscal_tax_shadow_runs ────────────────────────────────────────────
-- Escrita só pelo job de sombra (`app.role = system`): é evidência para decidir
-- cut-over, e evidência que o usuário pode editar não é evidência. Sem UPDATE
-- nem DELETE — corrigir uma comparação significa rodar a sombra de novo.
CREATE POLICY fiscal_tax_shadow_select ON fiscal_tax_shadow_runs
  FOR SELECT
  USING (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    AND (
      current_setting('app.permissions', true) LIKE '%fiscal.%'
      OR current_setting('app.role', true) IN ('system', 'super_admin')
    )
  );

CREATE POLICY fiscal_tax_shadow_insert ON fiscal_tax_shadow_runs
  FOR INSERT
  WITH CHECK (current_setting('app.role', true) IN ('system', 'super_admin'));
