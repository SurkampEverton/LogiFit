-- packages/db/src/policies/0058_passport_global_sessions.sql
-- Sprint 02b3 — passport_global_sessions GRANTs (ADR 0094).
--
-- Sem RLS — sessões são tabela de auth (mesmo padrão member_sessions
-- Sprint 26 ADR 0088). Acesso direto via pool.query da camada de
-- middleware (getPassportSession resolve hash + lookup).
--
-- Cleanup automático após expires_at via cron Sprint 02b4
-- (`expire-passport-global-sessions`). Sessions revogadas preservadas
-- 30d pra audit antes do delete permanente.

GRANT SELECT, INSERT, UPDATE ON passport_global_sessions TO logifit_app;

COMMENT ON TABLE passport_global_sessions IS
  'Sprint 02b3 — Sessões da identidade global do paciente (ADR 0094). Sem RLS — auth table acessada via pool.query. Cookie lf_passport_session.';

COMMENT ON COLUMN passport_global_sessions.refresh_token_hash IS
  'SHA-256 hex do refresh token plain (cookie). Nunca grava plain. Padrão ADR 0088.';

COMMENT ON COLUMN passport_global_sessions.mfa_verified_at IS
  'Setado quando paciente completa TOTP em login fresh. requirePassportMfa() exige recency <15min pra ações de alto risco do paciente.';

COMMENT ON COLUMN passport_global_sessions.revoked_reason IS
  'user_logout | admin_revoke | password_change | mfa_change | session_rotation';
