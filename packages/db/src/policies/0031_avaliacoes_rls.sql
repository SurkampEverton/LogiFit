-- packages/db/src/policies/0031_avaliacoes_rls.sql
-- Sprint 12 Faixa A — Avaliações físicas RLS (ADR 0024 esperado).
--
-- 5 tabelas: assessment_types (biblioteca global) + assessments +
-- assessment_measurements + assessment_photos + assessment_calculations
--
-- **Biblioteca global** (assessment_types.tenant_id IS NULL): SELECT
-- liberado pra todo logifit_app. INSERT/UPDATE bloqueado nesse modo —
-- apenas curador externo (LogiFit platform_admin) seeda templates Academia
-- + 8 escalas funcionais Fisio.
--
-- **Dado clínico sensível** (LGPD art. 11 + regra 29): leitura via
-- Server Action `getAssessment` grava audit_log automaticamente via
-- wrapServerAction. RLS pura limita ao tenant.
--
-- **Sem DELETE em assessments** — soft via `soft_deleted_at` (retenção
-- COFFITO 20a + CFM 2.299).

-- ─── Ativa RLS + FORCE ──────────────────────────────────────────────────
ALTER TABLE assessment_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE assessment_types FORCE ROW LEVEL SECURITY;

ALTER TABLE assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE assessments FORCE ROW LEVEL SECURITY;

ALTER TABLE assessment_measurements ENABLE ROW LEVEL SECURITY;
ALTER TABLE assessment_measurements FORCE ROW LEVEL SECURITY;

ALTER TABLE assessment_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE assessment_photos FORCE ROW LEVEL SECURITY;

ALTER TABLE assessment_calculations ENABLE ROW LEVEL SECURITY;
ALTER TABLE assessment_calculations FORCE ROW LEVEL SECURITY;

-- ─── GRANTs ─────────────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE ON assessment_types TO logifit_app;
GRANT SELECT, INSERT, UPDATE ON assessments TO logifit_app;
GRANT SELECT, INSERT, UPDATE ON assessment_measurements TO logifit_app;
GRANT SELECT, INSERT, UPDATE ON assessment_photos TO logifit_app;
GRANT SELECT, INSERT, UPDATE ON assessment_calculations TO logifit_app;

-- ─── assessment_types ──────────────────────────────────────────────────
-- SELECT: tenant próprio OU biblioteca global
CREATE POLICY assessment_types_select ON assessment_types
  FOR SELECT
  USING (
    tenant_id IS NULL
    OR tenant_id = current_setting('app.tenant_id', true)::uuid
  );

-- INSERT: apenas com tenant_id próprio (templates globais via superuser)
CREATE POLICY assessment_types_insert ON assessment_types
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- UPDATE: só próprio tenant
CREATE POLICY assessment_types_update ON assessment_types
  FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Sem DELETE — soft via active=false + archived_at.

-- ─── assessments ───────────────────────────────────────────────────────
CREATE POLICY assessments_tenant_select ON assessments
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY assessments_tenant_insert ON assessments
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY assessments_tenant_update ON assessments
  FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Sem DELETE — soft via soft_deleted_at (retenção 20a COFFITO/CFM).

-- ─── assessment_measurements ──────────────────────────────────────────
CREATE POLICY assessment_measurements_tenant_select ON assessment_measurements
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY assessment_measurements_tenant_insert ON assessment_measurements
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY assessment_measurements_tenant_update ON assessment_measurements
  FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Sem DELETE — apaga assessment (CASCADE) ou marca soft.

-- ─── assessment_photos ────────────────────────────────────────────────
CREATE POLICY assessment_photos_tenant_select ON assessment_photos
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY assessment_photos_tenant_insert ON assessment_photos
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY assessment_photos_tenant_update ON assessment_photos
  FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ─── assessment_calculations ──────────────────────────────────────────
CREATE POLICY assessment_calculations_tenant_select ON assessment_calculations
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY assessment_calculations_tenant_insert ON assessment_calculations
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY assessment_calculations_tenant_update ON assessment_calculations
  FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ─── COMMENTS ──────────────────────────────────────────────────────────
COMMENT ON TABLE assessment_types IS
  'ADR 0024 — schema dinâmico via fields jsonb. tenant_id NULL = biblioteca global LogiFit (Academia composição + Fisio escalas funcionais). Versionado via parent_type_id.';
COMMENT ON TABLE assessments IS
  'Registro de avaliação por member. type_version snapshot preserva schema histórico. soft_deleted_at retenção 20a (COFFITO 415 + CFM 2.299).';
COMMENT ON TABLE assessment_measurements IS
  'Medições serializadas: value_num/text/enum mutuamente exclusivos. source pré-cabeada pra Device Hub Sprint 34.';
COMMENT ON TABLE assessment_photos IS
  'Fotos em Storage bucket privado (criptografia at-rest). URL assinada curta. scan_status integra com regra 38 Sprint 38.';
COMMENT ON TABLE assessment_calculations IS
  'Cache de cálculos derivados (IMC, Pollock, TMB Mifflin, RCQ). Recalculado em createAssessment via @repo/db/avaliacoes/calc.';
