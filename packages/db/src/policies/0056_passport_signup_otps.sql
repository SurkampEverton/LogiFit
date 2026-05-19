-- packages/db/src/policies/0056_passport_signup_otps.sql
-- Sprint 02b Path B — passport_signup_otps GRANTs (sem RLS — pré-auth global).
--
-- Acesso via Server Action `requestSmsCode`/`verifySmsCode` que rodam como
-- `logifit_app` (sem session de paciente ainda — visitor anônimo). Tabela
-- não tem tenant_id, então RLS por tenant não se aplica.
--
-- Cleanup automático após 24h via cron Sprint 02b2 (`expire-passport-signup-otps`).
-- OTPs com used_at preservados 30d pra audit antes do cleanup permanente.

GRANT SELECT, INSERT, UPDATE ON passport_signup_otps TO logifit_app;

COMMENT ON TABLE passport_signup_otps IS
  'Sprint 02b — OTPs SMS pendentes do cadastro proativo /cadastro (Path B). Sem RLS — pré-auth global. Cleanup 24h via cron Sprint 02b2.';
