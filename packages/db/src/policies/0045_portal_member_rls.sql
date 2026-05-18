-- packages/db/src/policies/0045_portal_member_rls.sql
-- Sprint 26 Faixa A — Portal do Paciente RLS.
--
-- 3 tabelas novas: member_auth_tokens + member_sessions + member_consents
--
-- **Member role** — Sprint 26 introduz JWT claim `role=member` + `member_id`.
-- RLS aqui usa `current_setting('app.tenant_id')` (operador staff que olha
-- tokens, ex: admin pra revogar suspeita) + `current_setting('app.member_id')`
-- (paciente acessando próprios dados via portal).
--
-- **member_auth_tokens** — verify acontece ANTES de auth → handler usa
-- `app.bypass_rls=true` via SET LOCAL (Sprint 26b: SECURITY DEFINER function).
-- Policy de SELECT permite tenant_id atual (staff) OU member_id atual.
--
-- **APPEND-ONLY** member_auth_tokens? Não — `used_at` precisa de UPDATE.
-- **APPEND-ONLY** member_sessions? Não — `revoked_at` + `last_seen_at` UPDATE.
-- Trilha completa fica em audit_log (regra 5, esse SIM append-only).

ALTER TABLE member_auth_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE member_auth_tokens FORCE ROW LEVEL SECURITY;

ALTER TABLE member_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE member_sessions FORCE ROW LEVEL SECURITY;

ALTER TABLE member_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE member_consents FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON member_auth_tokens TO logifit_app;
GRANT SELECT, INSERT, UPDATE ON member_sessions    TO logifit_app;
GRANT SELECT, INSERT, UPDATE ON member_consents    TO logifit_app;

-- ─── member_auth_tokens ────────────────────────────────────────────────
-- SELECT: staff do tenant OU paciente próprio
CREATE POLICY mat_tenant_or_member_select ON member_auth_tokens
  FOR SELECT
  USING (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    OR member_id = NULLIF(current_setting('app.member_id', true), '')::uuid
  );

-- INSERT: caller (request handler) seta tenant_id correto
CREATE POLICY mat_tenant_insert ON member_auth_tokens
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- UPDATE: marca used_at (verify handler)
CREATE POLICY mat_tenant_update ON member_auth_tokens
  FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ─── member_sessions ───────────────────────────────────────────────────
-- SELECT: staff vê sessões do tenant; member vê suas próprias
CREATE POLICY ms_tenant_or_member_select ON member_sessions
  FOR SELECT
  USING (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    OR member_id = NULLIF(current_setting('app.member_id', true), '')::uuid
  );

CREATE POLICY ms_tenant_insert ON member_sessions
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- UPDATE: refresh + revoke
CREATE POLICY ms_tenant_or_member_update ON member_sessions
  FOR UPDATE
  USING (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    OR member_id = NULLIF(current_setting('app.member_id', true), '')::uuid
  )
  WITH CHECK (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    OR member_id = NULLIF(current_setting('app.member_id', true), '')::uuid
  );

-- ─── member_consents ───────────────────────────────────────────────────
-- SELECT: staff (compliance) vê; member vê próprio
CREATE POLICY mc_tenant_or_member_select ON member_consents
  FOR SELECT
  USING (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    OR member_id = NULLIF(current_setting('app.member_id', true), '')::uuid
  );

CREATE POLICY mc_tenant_insert ON member_consents
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- UPDATE: paciente revoga (revoked_at) OU staff atualiza ripd_version
CREATE POLICY mc_tenant_or_member_update ON member_consents
  FOR UPDATE
  USING (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    OR member_id = NULLIF(current_setting('app.member_id', true), '')::uuid
  )
  WITH CHECK (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    OR member_id = NULLIF(current_setting('app.member_id', true), '')::uuid
  );

COMMENT ON TABLE member_auth_tokens IS
  'Sprint 26 — magic link tokens. token_hash SHA-256, TTL 15min, single-use (used_at). Anti-enumeration via lib pura.';
COMMENT ON TABLE member_sessions IS
  'Sprint 26 — sessões multi-device do member. refresh_token_hash SHA-256, TTL 30d, soft-revoke via revoked_at.';
COMMENT ON TABLE member_consents IS
  'Sprint 26 — consent intra-tenant granular (marketing/cross_module_share/analytics_anon/photo_use). Revogação imediata; audit via audit_log.';
