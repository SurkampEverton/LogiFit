-- packages/db/src/policies/0005_auth_rls.sql
-- Sprint 01a Faixa B — RLS pras tabelas BetterAuth + LogiFit auth_attempts/lockouts.
--
-- ATENÇÃO: BetterAuth é single-tenant por design — `auth_user` NÃO tem
-- `tenant_id`. Multi-tenant LogiFit é resolvido em DUAS camadas separadas:
--   1. BetterAuth gerencia identidade global (email → user_id)
--   2. `users` table (Sprint 01a Faixa A) tem tenant_id + auth_user_id FK
--      pra `auth_user.id` — daí o mapping global→tenant
--
-- Policies aqui são FORÇA DENY pra acesso direto via role `logifit_app`. Apenas
-- o BetterAuth (via role separado `auth_internal`, ou via SECURITY DEFINER
-- functions) escreve nessas tabelas. Sprint 01a usa pool dedicado (`authPool`
-- em `@repo/auth/server`) pra isolar.
--
-- Como o pool do BetterAuth também usa role `logifit_app` no MVP (não criamos
-- role separado ainda — futuro Sprint 02+), liberamos SELECT+INSERT+UPDATE+DELETE
-- pra `logifit_app` nessas tabelas. RLS sem WITH CHECK = pass-through.

-- ─── auth_user ───────────────────────────────────────────────────────────
ALTER TABLE auth_user ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_user FORCE  ROW LEVEL SECURITY;

-- Permite TUDO pro role logifit_app (BetterAuth precisa); RLS continua FORCED
-- pra bloquear acesso direto via psql como `postgres` (já fica enforced via FORCE).
CREATE POLICY auth_user_app_all ON auth_user
  FOR ALL TO logifit_app
  USING (true)
  WITH CHECK (true);

-- ─── auth_session ────────────────────────────────────────────────────────
ALTER TABLE auth_session ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_session FORCE  ROW LEVEL SECURITY;

CREATE POLICY auth_session_app_all ON auth_session
  FOR ALL TO logifit_app
  USING (true)
  WITH CHECK (true);

-- ─── auth_account ────────────────────────────────────────────────────────
ALTER TABLE auth_account ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_account FORCE  ROW LEVEL SECURITY;

CREATE POLICY auth_account_app_all ON auth_account
  FOR ALL TO logifit_app
  USING (true)
  WITH CHECK (true);

-- ─── auth_verification ───────────────────────────────────────────────────
ALTER TABLE auth_verification ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_verification FORCE  ROW LEVEL SECURITY;

CREATE POLICY auth_verification_app_all ON auth_verification
  FOR ALL TO logifit_app
  USING (true)
  WITH CHECK (true);

-- ─── auth_two_factor + auth_passkey ──────────────────────────────────────
ALTER TABLE auth_two_factor ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_two_factor FORCE  ROW LEVEL SECURITY;
CREATE POLICY auth_two_factor_app_all ON auth_two_factor
  FOR ALL TO logifit_app USING (true) WITH CHECK (true);

ALTER TABLE auth_passkey ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_passkey FORCE  ROW LEVEL SECURITY;
CREATE POLICY auth_passkey_app_all ON auth_passkey
  FOR ALL TO logifit_app USING (true) WITH CHECK (true);

-- ─── auth_attempts + auth_lockouts (LogiFit-owned) ───────────────────────
ALTER TABLE auth_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_attempts FORCE  ROW LEVEL SECURITY;
CREATE POLICY auth_attempts_app_all ON auth_attempts
  FOR ALL TO logifit_app USING (true) WITH CHECK (true);

ALTER TABLE auth_lockouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_lockouts FORCE  ROW LEVEL SECURITY;
CREATE POLICY auth_lockouts_app_all ON auth_lockouts
  FOR ALL TO logifit_app USING (true) WITH CHECK (true);

COMMENT ON TABLE auth_user IS
  'BetterAuth user (ADR 0092). Single-tenant por design — multi-tenant via users.auth_user_id FK.';
COMMENT ON TABLE auth_session IS
  'BetterAuth session — cookie `logifit_session` token. `/meu/sessoes` revoga (ADR 0073).';
COMMENT ON TABLE auth_attempts IS
  'Log de tentativas de login (ADR 0073 camada 2). Retenção 30 dias (regra 5).';
COMMENT ON TABLE auth_lockouts IS
  'Lockouts ativos: 5 falhas/15min → 30min cooldown. Cleanup quando locked_until < now().';
