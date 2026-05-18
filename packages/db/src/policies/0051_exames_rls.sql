-- packages/db/src/policies/0051_exames_rls.sql
-- Sprint 33 Faixa A — Pipeline Exames Laboratoriais.
--
-- 6 tabelas. Dado clínico (regra 25 + LGPD art. 11). Member portal Sprint 26
-- vê próprios exames; staff vê do tenant. Sensitivity=high exige permission
-- exam.sensitive.read (validação na camada de Server Action, não RLS — porque
-- permission é checada via wrapServerAction).
--
-- exam_review_edits = audit append-only (sem UPDATE/DELETE policy).

ALTER TABLE exam_documents              ENABLE ROW LEVEL SECURITY;
ALTER TABLE exam_documents              FORCE ROW LEVEL SECURITY;
ALTER TABLE exam_extractions            ENABLE ROW LEVEL SECURITY;
ALTER TABLE exam_extractions            FORCE ROW LEVEL SECURITY;
ALTER TABLE exam_interpretations_draft  ENABLE ROW LEVEL SECURITY;
ALTER TABLE exam_interpretations_draft  FORCE ROW LEVEL SECURITY;
ALTER TABLE exam_interpretations_final  ENABLE ROW LEVEL SECURITY;
ALTER TABLE exam_interpretations_final  FORCE ROW LEVEL SECURITY;
ALTER TABLE exam_review_edits           ENABLE ROW LEVEL SECURITY;
ALTER TABLE exam_review_edits           FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant_exam_ai_settings     ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_exam_ai_settings     FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON exam_documents             TO logifit_app;
GRANT SELECT, INSERT, UPDATE ON exam_extractions           TO logifit_app;
GRANT SELECT, INSERT, UPDATE ON exam_interpretations_draft TO logifit_app;
GRANT SELECT, INSERT, UPDATE ON exam_interpretations_final TO logifit_app;
GRANT SELECT, INSERT         ON exam_review_edits          TO logifit_app;  -- append-only
GRANT SELECT, INSERT, UPDATE ON tenant_exam_ai_settings    TO logifit_app;

-- ─── exam_documents ─────────────────────────────────────────────────────
CREATE POLICY exam_docs_select ON exam_documents
  FOR SELECT
  USING (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    OR member_id = NULLIF(current_setting('app.member_id', true), '')::uuid
  );

CREATE POLICY exam_docs_insert ON exam_documents
  FOR INSERT
  WITH CHECK (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    OR member_id = NULLIF(current_setting('app.member_id', true), '')::uuid
  );

CREATE POLICY exam_docs_update ON exam_documents
  FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ─── exam_extractions / draft / final / edits — tenant scope ────────────
CREATE POLICY exam_extr_select ON exam_extractions
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY exam_extr_insert ON exam_extractions
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY exam_extr_update ON exam_extractions
  FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY exam_interp_draft_select ON exam_interpretations_draft
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY exam_interp_draft_insert ON exam_interpretations_draft
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY exam_interp_draft_update ON exam_interpretations_draft
  FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY exam_interp_final_select ON exam_interpretations_final
  FOR SELECT
  USING (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    OR EXISTS (
      SELECT 1 FROM exam_documents ed
      WHERE ed.id = exam_interpretations_final.exam_document_id
        AND ed.member_id = NULLIF(current_setting('app.member_id', true), '')::uuid
    )
  );

CREATE POLICY exam_interp_final_insert ON exam_interpretations_final
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY exam_review_edits_select ON exam_review_edits
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY exam_review_edits_insert ON exam_review_edits
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ─── tenant_exam_ai_settings ────────────────────────────────────────────
CREATE POLICY tenant_exam_ai_select ON tenant_exam_ai_settings
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_exam_ai_insert ON tenant_exam_ai_settings
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_exam_ai_update ON tenant_exam_ai_settings
  FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

COMMENT ON TABLE exam_documents IS
  'Sprint 33 — PDF/imagem original do exame. Status workflow uploaded→processing→pending_review→published. Particionamento ANUAL Sprint 33b. Retenção 20a Lei 13.787. ADR 0050.';
COMMENT ON TABLE exam_extractions IS
  'Sprint 33 — texto bruto OCR + structured_data jsonb (analitos IA-extraídos). 1:1 com exam_documents. Provider OCR abstrato Sprint 15 ADR 0035.';
COMMENT ON TABLE exam_interpretations_draft IS
  'Sprint 33 — interpretação preliminar IA: padrões + hipóteses conservadoras + follow-up. Classifier bloqueia diagnóstico (regra 28). SaMD Classe II ANVISA RDC 657/2022.';
COMMENT ON TABLE exam_interpretations_final IS
  'Sprint 33 — interpretação revisada pelo profissional. Member portal Sprint 26 lê via RLS (próprio member).';
COMMENT ON TABLE exam_review_edits IS
  'Sprint 33 — audit append-only de edições durante review. Sem UPDATE/DELETE policy.';
