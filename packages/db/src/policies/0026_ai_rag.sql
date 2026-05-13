-- packages/db/src/policies/0026_ai_rag.sql
-- Sprint 06 Faixa B — RAG + cache semântico + insights + tickets.
--
-- 5 tabelas novas (ai-rag.ts):
--   GLOBAL (sem RLS quando tenant_id IS NULL):
--     - ai_documents (seed global + per-tenant uploads)
--     - ai_document_chunks
--   TENANT-SCOPED:
--     - ai_semantic_cache
--     - member_insights
--     - support_tickets
--
-- Habilita extension pgvector (idempotente — Sprint 00 já fez, mantém safe).
CREATE EXTENSION IF NOT EXISTS vector;

-- ─── RLS habilitada nas tenant-scoped ────────────────────────────────────
ALTER TABLE ai_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_documents FORCE ROW LEVEL SECURITY;

ALTER TABLE ai_document_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_document_chunks FORCE ROW LEVEL SECURITY;

ALTER TABLE ai_semantic_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_semantic_cache FORCE ROW LEVEL SECURITY;

ALTER TABLE member_insights ENABLE ROW LEVEL SECURITY;
ALTER TABLE member_insights FORCE ROW LEVEL SECURITY;

ALTER TABLE support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_tickets FORCE ROW LEVEL SECURITY;

-- ─── GRANTs ────────────────────────────────────────────────────────────
GRANT SELECT ON ai_documents TO logifit_app;
GRANT SELECT ON ai_document_chunks TO logifit_app;
GRANT SELECT, INSERT, UPDATE ON ai_semantic_cache TO logifit_app;
GRANT SELECT, INSERT, UPDATE ON member_insights TO logifit_app;
GRANT SELECT, INSERT, UPDATE ON support_tickets TO logifit_app;
-- INSERT/UPDATE em ai_documents/chunks rodam via service role (job ingest);
-- logifit_app só lê.

-- ─── ai_documents (read global + own tenant) ─────────────────────────────
CREATE POLICY ai_documents_read ON ai_documents
  FOR SELECT
  USING (
    tenant_id IS NULL
    OR tenant_id = current_setting('app.tenant_id', true)::uuid
  );

-- ─── ai_document_chunks (read global + own tenant) ───────────────────────
CREATE POLICY ai_document_chunks_read ON ai_document_chunks
  FOR SELECT
  USING (
    tenant_id IS NULL
    OR tenant_id = current_setting('app.tenant_id', true)::uuid
  );

-- ─── ai_semantic_cache (tenant-scoped) ───────────────────────────────────
CREATE POLICY ai_semantic_cache_tenant_select ON ai_semantic_cache
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY ai_semantic_cache_tenant_insert ON ai_semantic_cache
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY ai_semantic_cache_tenant_update ON ai_semantic_cache
  FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ─── member_insights ────────────────────────────────────────────────────
CREATE POLICY member_insights_tenant_select ON member_insights
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY member_insights_tenant_insert ON member_insights
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY member_insights_tenant_update ON member_insights
  FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ─── support_tickets ────────────────────────────────────────────────────
CREATE POLICY support_tickets_tenant_select ON support_tickets
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY support_tickets_tenant_insert ON support_tickets
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY support_tickets_tenant_update ON support_tickets
  FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ─── HNSW indexes em embeddings (similaridade cosine) ───────────────────
-- Sprint 06: cosine distance é o default pgvector pra `<=>` operator.
-- HNSW > IVFFlat pra <100k chunks (que é a faixa do MVP). Tunar m/ef_construction
-- com benchmark real no Sprint 06+ Faixa C.
CREATE INDEX IF NOT EXISTS ai_document_chunks_embedding_hnsw_idx
  ON ai_document_chunks
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE INDEX IF NOT EXISTS ai_semantic_cache_embedding_hnsw_idx
  ON ai_semantic_cache
  USING hnsw (query_embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
