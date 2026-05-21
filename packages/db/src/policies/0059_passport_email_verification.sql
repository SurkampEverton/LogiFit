-- packages/db/src/policies/0059_passport_email_verification.sql
-- Sprint 02b4 fechamento — passport_email_verification_tokens GRANTs.
--
-- Sem RLS — tabela de auth (mesmo padrão member_auth_tokens Sprint 26 +
-- passport_signup_otps Sprint 02b backbone). Acesso direto via pool.query
-- pré-auth (verifyPassportEmail roda sem session — paciente clica link
-- direto do email).
--
-- Cleanup cron Sprint 02b5+ (`expire-passport-email-verification-tokens`):
-- DELETE used_at < now() - 30d (audit retention LGPD art. 18 V) +
-- DELETE expires_at < now() - 7d (não-usados expirados).

GRANT SELECT, INSERT, UPDATE ON passport_email_verification_tokens TO logifit_app;

COMMENT ON TABLE passport_email_verification_tokens IS
  'Sprint 02b4 fechamento — tokens de confirmação de email do paciente. Sem RLS — auth table acessada via pool.query pré-auth. Token plano via SHA-256, single-use, TTL 24h.';

COMMENT ON COLUMN passport_email_verification_tokens.token_hash IS
  'SHA-256 hex do token plain. Nunca grava plain. Padrão member_auth_tokens (Sprint 26 ADR 0088).';

COMMENT ON COLUMN passport_email_verification_tokens.email IS
  'Snapshot do email no momento da geração — protege race contra change_email entre request e verify. Se passport_global_identities.email mudou, token é inválido.';
