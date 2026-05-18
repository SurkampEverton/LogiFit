-- packages/db/src/policies/0049_diario_teleconsulta_rls.sql
-- Sprint 31 Faixa A — Diário alimentar + Teleconsulta.
--
-- 4 tabelas:
--   - meal_log_entries: member registra própria; nutri (staff) vê do tenant
--   - food_log_daily_summary: igual (member vê próprio; staff vê do tenant)
--   - meal_log_reviews: só staff cria/lê (member não vê comentários internos)
--   - teleconsultation_sessions: member vê próprias; staff vê do tenant
--
-- Dado clínico (regra 25 + LGPD art. 11). Member portal Sprint 26 scope via
-- app.member_id; staff via app.tenant_id.

ALTER TABLE meal_log_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE meal_log_entries FORCE ROW LEVEL SECURITY;
ALTER TABLE food_log_daily_summary ENABLE ROW LEVEL SECURITY;
ALTER TABLE food_log_daily_summary FORCE ROW LEVEL SECURITY;
ALTER TABLE meal_log_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE meal_log_reviews FORCE ROW LEVEL SECURITY;
ALTER TABLE teleconsultation_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE teleconsultation_sessions FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON meal_log_entries          TO logifit_app;
GRANT SELECT, INSERT, UPDATE ON food_log_daily_summary    TO logifit_app;
GRANT SELECT, INSERT, UPDATE ON meal_log_reviews          TO logifit_app;
GRANT SELECT, INSERT, UPDATE ON teleconsultation_sessions TO logifit_app;

-- ─── meal_log_entries ───────────────────────────────────────────────────
-- staff do tenant OU member dono (portal Sprint 26)
CREATE POLICY meal_log_select ON meal_log_entries
  FOR SELECT
  USING (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    OR member_id = NULLIF(current_setting('app.member_id', true), '')::uuid
  );

CREATE POLICY meal_log_insert ON meal_log_entries
  FOR INSERT
  WITH CHECK (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    OR member_id = NULLIF(current_setting('app.member_id', true), '')::uuid
  );

CREATE POLICY meal_log_update ON meal_log_entries
  FOR UPDATE
  USING (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    OR member_id = NULLIF(current_setting('app.member_id', true), '')::uuid
  )
  WITH CHECK (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    OR member_id = NULLIF(current_setting('app.member_id', true), '')::uuid
  );

-- ─── food_log_daily_summary ─────────────────────────────────────────────
CREATE POLICY food_log_summary_select ON food_log_daily_summary
  FOR SELECT
  USING (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    OR member_id = NULLIF(current_setting('app.member_id', true), '')::uuid
  );

CREATE POLICY food_log_summary_insert ON food_log_daily_summary
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY food_log_summary_update ON food_log_daily_summary
  FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ─── meal_log_reviews (só staff vê — feedback interno + audit) ─────────
CREATE POLICY meal_log_reviews_select ON meal_log_reviews
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY meal_log_reviews_insert ON meal_log_reviews
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY meal_log_reviews_update ON meal_log_reviews
  FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ─── teleconsultation_sessions ──────────────────────────────────────────
CREATE POLICY telecon_select ON teleconsultation_sessions
  FOR SELECT
  USING (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    OR member_id = NULLIF(current_setting('app.member_id', true), '')::uuid
  );

CREATE POLICY telecon_insert ON teleconsultation_sessions
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY telecon_update ON teleconsultation_sessions
  FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

COMMENT ON TABLE meal_log_entries IS
  'Sprint 31 — paciente registra refeições reais (com foto opcional). RLS member portal Sprint 26 + staff tenant. Particionamento mensal Sprint 31b. Retenção 6m raw.';
COMMENT ON TABLE food_log_daily_summary IS
  'Sprint 31 — agregado diário (1 row/member/date); cron 02:00 SP popula. Retenção perpétua. Alimenta calculateCaloricBalance ADR 0070.';
COMMENT ON TABLE teleconsultation_sessions IS
  'Sprint 31 — sessões de teleconsulta com provider abstrato (ADR 0083). Consent gravação + transcrição separados (LGPD art. 11). Rascunho SOAP IA Sprint 31b.';
