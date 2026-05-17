-- packages/db/src/policies/0032_mensagens_rls.sql
-- Sprint 13 Faixa A — Mensagens RLS (ADR 0025 + ADR 0026).
--
-- 5 tabelas: message_providers + message_templates + reguas +
-- regua_executions + messages_sent
--
-- **Audit append-only em messages_sent** (regra 5): SELECT/INSERT liberado;
-- UPDATE restrito a colunas de callback (delivered_at/read_at/failed_at/
-- status/provider_message_id/cost_cents) — trigger valida.
--
-- **credentials_encrypted** em message_providers nunca aparece em SELECT
-- direto pela UI — Server Action getMessageProvider() decrypta em runtime
-- e retorna apenas o necessário pro adapter.

-- ─── Ativa RLS + FORCE ──────────────────────────────────────────────────
ALTER TABLE message_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_providers FORCE ROW LEVEL SECURITY;

ALTER TABLE message_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_templates FORCE ROW LEVEL SECURITY;

ALTER TABLE reguas ENABLE ROW LEVEL SECURITY;
ALTER TABLE reguas FORCE ROW LEVEL SECURITY;

ALTER TABLE regua_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE regua_executions FORCE ROW LEVEL SECURITY;

ALTER TABLE messages_sent ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages_sent FORCE ROW LEVEL SECURITY;

-- ─── GRANTs ─────────────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE ON message_providers TO logifit_app;
GRANT SELECT, INSERT, UPDATE ON message_templates TO logifit_app;
GRANT SELECT, INSERT, UPDATE ON reguas TO logifit_app;
GRANT SELECT, INSERT, UPDATE ON regua_executions TO logifit_app;
GRANT SELECT, INSERT, UPDATE ON messages_sent TO logifit_app;

-- ─── message_providers ─────────────────────────────────────────────────
CREATE POLICY message_providers_tenant_select ON message_providers
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY message_providers_tenant_insert ON message_providers
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY message_providers_tenant_update ON message_providers
  FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ─── message_templates ─────────────────────────────────────────────────
CREATE POLICY message_templates_tenant_select ON message_templates
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY message_templates_tenant_insert ON message_templates
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY message_templates_tenant_update ON message_templates
  FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Sem DELETE — soft via archived_at.

-- ─── reguas ────────────────────────────────────────────────────────────
CREATE POLICY reguas_tenant_select ON reguas
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY reguas_tenant_insert ON reguas
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY reguas_tenant_update ON reguas
  FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Sem DELETE — soft via archived_at.

-- ─── regua_executions ──────────────────────────────────────────────────
CREATE POLICY regua_executions_tenant_select ON regua_executions
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY regua_executions_tenant_insert ON regua_executions
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY regua_executions_tenant_update ON regua_executions
  FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ─── messages_sent (audit-friendly) ────────────────────────────────────
-- INSERT + SELECT liberados pelo tenant. UPDATE permitido (callbacks),
-- DELETE bloqueado (audit append-only). Sprint 13+ adiciona trigger
-- BEFORE UPDATE que valida apenas colunas de callback foram alteradas.
CREATE POLICY messages_sent_tenant_select ON messages_sent
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY messages_sent_tenant_insert ON messages_sent
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY messages_sent_tenant_update ON messages_sent
  FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ─── COMMENTS ──────────────────────────────────────────────────────────
COMMENT ON TABLE message_providers IS
  'ADR 0025 — config por tenant (WhatsApp/Email/SMS). credentials_encrypted via envelope crypto AES-256-GCM.';
COMMENT ON TABLE message_templates IS
  'Templates com approval flow (draft → pending → approved); WhatsApp Business exige aprovação Meta. Audit obrigatório (regra 5).';
COMMENT ON TABLE reguas IS
  'ADR 0026 — motor declarativo DSL JSON (trigger/actions/stop_on/guards). Validado por Zod em runtime.';
COMMENT ON TABLE regua_executions IS
  'Instâncias rodando per-member. State machine: running → completed/stopped_by_rule/stopped_by_consent/failed. Cron tick processa next_action_at.';
COMMENT ON TABLE messages_sent IS
  'Audit append-only de envios. variables_resolved snapshot pra debugging. Particionamento previsto Sprint 14+ (regra 34 + ADR 0072).';
