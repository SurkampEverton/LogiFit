-- packages/db/src/policies/0023_ai_rls.sql
-- Sprint 06 Faixa A — IA arquitetura RLS (ADR 0064 + 0075).
--
-- 10 tabelas:
--   GLOBAIS (sem RLS — catálogo público): ai_providers, ai_models,
--                                         ai_task_routing, tools_registry
--   TENANT-SCOPED: ai_provider_configs, ai_tenant_usage, ai_audit_log,
--                  assistant_sessions, assistant_messages,
--                  assistant_action_proposals

-- ─── Globais: GRANT SELECT pra logifit_app, sem RLS ────────────────────
GRANT SELECT ON ai_providers TO logifit_app;
GRANT SELECT ON ai_models TO logifit_app;
GRANT SELECT ON ai_task_routing TO logifit_app;
GRANT SELECT, INSERT, UPDATE ON tools_registry TO logifit_app;
-- tools_registry vai ser populado via registerAITool() em runtime — Server
-- Actions com role super_admin podem inserir/atualizar. Sprint 06+ Faixa B
-- adiciona check em wrapServerAction pra validar permission.

-- ─── Ativa RLS + FORCE nas tenant-scoped ────────────────────────────────
ALTER TABLE ai_provider_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_provider_configs FORCE ROW LEVEL SECURITY;

ALTER TABLE ai_tenant_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_tenant_usage FORCE ROW LEVEL SECURITY;

ALTER TABLE ai_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_audit_log FORCE ROW LEVEL SECURITY;

ALTER TABLE assistant_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE assistant_sessions FORCE ROW LEVEL SECURITY;

ALTER TABLE assistant_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE assistant_messages FORCE ROW LEVEL SECURITY;

ALTER TABLE assistant_action_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE assistant_action_proposals FORCE ROW LEVEL SECURITY;

-- ─── GRANTs tenant-scoped ──────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE ON ai_provider_configs TO logifit_app;
GRANT SELECT, INSERT, UPDATE ON ai_tenant_usage TO logifit_app;
GRANT SELECT, INSERT ON ai_audit_log TO logifit_app;
GRANT SELECT, INSERT, UPDATE ON assistant_sessions TO logifit_app;
GRANT SELECT, INSERT ON assistant_messages TO logifit_app;
GRANT SELECT, INSERT, UPDATE ON assistant_action_proposals TO logifit_app;

-- ─── ai_provider_configs ───────────────────────────────────────────────
CREATE POLICY ai_provider_configs_tenant_select ON ai_provider_configs
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY ai_provider_configs_tenant_insert ON ai_provider_configs
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY ai_provider_configs_tenant_update ON ai_provider_configs
  FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ─── ai_tenant_usage ───────────────────────────────────────────────────
CREATE POLICY ai_tenant_usage_tenant_select ON ai_tenant_usage
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY ai_tenant_usage_tenant_insert ON ai_tenant_usage
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY ai_tenant_usage_tenant_update ON ai_tenant_usage
  FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ─── ai_audit_log (append-only) ────────────────────────────────────────
CREATE POLICY ai_audit_log_tenant_select ON ai_audit_log
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY ai_audit_log_tenant_insert ON ai_audit_log
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Sem UPDATE/DELETE em ai_audit_log (regra 5 — append-only).

-- ─── assistant_sessions ───────────────────────────────────────────────
CREATE POLICY assistant_sessions_tenant_select ON assistant_sessions
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY assistant_sessions_tenant_insert ON assistant_sessions
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY assistant_sessions_tenant_update ON assistant_sessions
  FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ─── assistant_messages (append-only) ──────────────────────────────────
CREATE POLICY assistant_messages_tenant_select ON assistant_messages
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY assistant_messages_tenant_insert ON assistant_messages
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Sem UPDATE/DELETE (mensagens são imutáveis).

-- ─── assistant_action_proposals ───────────────────────────────────────
CREATE POLICY assistant_action_proposals_tenant_select ON assistant_action_proposals
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY assistant_action_proposals_tenant_insert ON assistant_action_proposals
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY assistant_action_proposals_tenant_update ON assistant_action_proposals
  FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ─── Seed básico ───────────────────────────────────────────────────────
-- 5 providers canônicos (ADR 0064)
INSERT INTO ai_providers (slug, name, api_base_url) VALUES
  ('vertex-ai-gemini', 'Vertex AI (Google Gemini)', 'https://us-central1-aiplatform.googleapis.com'),
  ('anthropic', 'Anthropic Claude', 'https://api.anthropic.com'),
  ('openai', 'OpenAI', 'https://api.openai.com'),
  ('groq', 'Groq', 'https://api.groq.com/openai/v1'),
  ('maritaca', 'Maritaca AI (Sabiá)', 'https://chat.maritaca.ai/api')
ON CONFLICT (slug) DO NOTHING;
