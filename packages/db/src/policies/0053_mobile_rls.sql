-- packages/db/src/policies/0053_mobile_rls.sql
-- Sprint 35 Faixa A — Mobile App Nativo backbone.
--
-- 3 tabelas:
--   - mobile_app_versions: GLOBAL (sem tenant_id). Leitura por todos
--     (app verifica versão em boot). Sem policy de SELECT — read-all via
--     GRANT direto.
--   - mobile_push_tokens: tenant + member portal
--   - mobile_sessions: tenant + member portal

ALTER TABLE mobile_app_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE mobile_app_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE mobile_push_tokens  ENABLE ROW LEVEL SECURITY;
ALTER TABLE mobile_push_tokens  FORCE ROW LEVEL SECURITY;
ALTER TABLE mobile_sessions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE mobile_sessions     FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON mobile_app_versions TO logifit_app;
GRANT SELECT, INSERT, UPDATE ON mobile_push_tokens  TO logifit_app;
GRANT SELECT, INSERT, UPDATE ON mobile_sessions     TO logifit_app;

-- ─── mobile_app_versions (global read-all) ─────────────────────────────
-- Curadoria via platform_admin direto no banco; INSERT via super-admin UI Sprint 35b
CREATE POLICY mobile_versions_select ON mobile_app_versions
  FOR SELECT
  USING (true);  -- Global

-- ─── mobile_push_tokens ────────────────────────────────────────────────
CREATE POLICY mobile_push_select ON mobile_push_tokens
  FOR SELECT
  USING (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    OR member_id = NULLIF(current_setting('app.member_id', true), '')::uuid
  );

CREATE POLICY mobile_push_insert ON mobile_push_tokens
  FOR INSERT
  WITH CHECK (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    OR member_id = NULLIF(current_setting('app.member_id', true), '')::uuid
  );

CREATE POLICY mobile_push_update ON mobile_push_tokens
  FOR UPDATE
  USING (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    OR member_id = NULLIF(current_setting('app.member_id', true), '')::uuid
  )
  WITH CHECK (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    OR member_id = NULLIF(current_setting('app.member_id', true), '')::uuid
  );

-- ─── mobile_sessions ───────────────────────────────────────────────────
CREATE POLICY mobile_sessions_select ON mobile_sessions
  FOR SELECT
  USING (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    OR member_id = NULLIF(current_setting('app.member_id', true), '')::uuid
  );

CREATE POLICY mobile_sessions_insert ON mobile_sessions
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY mobile_sessions_update ON mobile_sessions
  FOR UPDATE
  USING (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    OR member_id = NULLIF(current_setting('app.member_id', true), '')::uuid
  )
  WITH CHECK (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    OR member_id = NULLIF(current_setting('app.member_id', true), '')::uuid
  );

COMMENT ON TABLE mobile_app_versions IS
  'Sprint 35 — registry de versões iOS/Android publicadas. Global read-all. min_required força update. ADRs 0045+0046.';
COMMENT ON TABLE mobile_push_tokens IS
  'Sprint 35 — APNs/FCM tokens por (member, device). Unique active. Soft-revoke. Sprint 35b conecta dispatcher real.';
COMMENT ON TABLE mobile_sessions IS
  'Sprint 35 — sessões nativas distintas das web. Refresh 90d. Device fingerprint. Single sign-out por device.';
