-- packages/db/src/policies/0038_retencao_rls.sql
-- Sprint 19 Faixa A — Retenção/Churn RLS.
--
-- 4 tabelas: churn_features_snapshot + churn_predictions + churn_interventions + churn_events
--
-- **Dados sensíveis** — previsões + intervenções revelam comportamento individual
-- do member. Permission `retencao.read` (gerente/diretor) controla na Server
-- Action; RLS pura limita ao tenant.
--
-- **churn_features_snapshot particionamento manual em migration futura** (regra
-- 34 + ADR 0072). RLS aplicada na tabela pai antes do PARTITION BY.
--
-- **churn_events** — read-only depois de inserido (audit trail). Sem UPDATE policy.

-- ─── Ativa RLS + FORCE ──────────────────────────────────────────────────
ALTER TABLE churn_features_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE churn_features_snapshot FORCE ROW LEVEL SECURITY;

ALTER TABLE churn_predictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE churn_predictions FORCE ROW LEVEL SECURITY;

ALTER TABLE churn_interventions ENABLE ROW LEVEL SECURITY;
ALTER TABLE churn_interventions FORCE ROW LEVEL SECURITY;

ALTER TABLE churn_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE churn_events FORCE ROW LEVEL SECURITY;

-- ─── GRANTs ─────────────────────────────────────────────────────────────
GRANT SELECT, INSERT ON churn_features_snapshot TO logifit_app;
GRANT SELECT, INSERT ON churn_predictions TO logifit_app;
GRANT SELECT, INSERT, UPDATE ON churn_interventions TO logifit_app;
GRANT SELECT, INSERT ON churn_events TO logifit_app;

-- ─── churn_features_snapshot ──────────────────────────────────────────
CREATE POLICY churn_features_tenant_select ON churn_features_snapshot
  FOR SELECT USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY churn_features_tenant_insert ON churn_features_snapshot
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
-- Sem UPDATE: snapshot é imutável (append-only)

-- ─── churn_predictions ─────────────────────────────────────────────────
CREATE POLICY churn_pred_tenant_select ON churn_predictions
  FOR SELECT USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY churn_pred_tenant_insert ON churn_predictions
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
-- Sem UPDATE: predição é imutável; novo snapshot → nova predição

-- ─── churn_interventions ───────────────────────────────────────────────
CREATE POLICY churn_intv_tenant_select ON churn_interventions
  FOR SELECT USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY churn_intv_tenant_insert ON churn_interventions
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY churn_intv_tenant_update ON churn_interventions
  FOR UPDATE USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ─── churn_events ──────────────────────────────────────────────────────
CREATE POLICY churn_events_tenant_select ON churn_events
  FOR SELECT USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY churn_events_tenant_insert ON churn_events
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
-- Sem UPDATE: evento é histórico/audit

-- ─── COMMENTS ──────────────────────────────────────────────────────────
COMMENT ON TABLE churn_features_snapshot IS
  'Sprint 19 (ADR 0027) — snapshot append-only de features estruturadas por member. snapshot_hash em cache key (predições reusam quando features inalteradas). @volume 6M+/ano.';
COMMENT ON TABLE churn_predictions IS
  'Sprint 19 — output do modelo (Fase 1 LLM Gemini classifier / Fase 2 sklearn). prob_30d/60d/90d numeric(4,3) + top_factors jsonb (explainability narrativa). risk_band derivado.';
COMMENT ON TABLE churn_interventions IS
  'Sprint 19 — ação atribuída a operador quando member em risco. Outcome alimenta precision do modelo + retreino Fase 2.';
COMMENT ON TABLE churn_events IS
  'Sprint 19 — evento real de cancelamento. was_predicted compara prob no momento × resultado real. Conjunto de validação para retreino.';
