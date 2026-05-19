-- packages/db/src/policies/0057_passport_global_identities.sql
-- Sprint 02b2 — passport_global_identities RLS (ADR 0093).
--
-- Tabela SEM tenant_id — RLS por tenant não se aplica. Visibilidade controlada
-- por novo setting `app.passport_global_id` setado em sessões do paciente
-- (member portal Sprint 02b3 conecta refactor de requireMemberSession).
--
-- **Acessos:**
--   - INSERT: pré-auth (Server Action signupPatient roda como logifit_app sem session)
--   - SELECT: paciente vê própria row via `app.passport_global_id`
--   - UPDATE: paciente atualiza próprio (perfil, password) via `app.passport_global_id`
--   - DELETE: não existe — deactivated_at é soft-delete (LGPD art. 18 VI ajusta)
--
-- **DPO override** (Sprint 02b3 — permission `dpo.passport_read_audit`):
--   policies adicionais permitem DPO ler todos quando atendendo art. 18 LGPD.

ALTER TABLE passport_global_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE passport_global_identities FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON passport_global_identities TO logifit_app;

-- Self-read: paciente vê própria row (app.passport_global_id setado por member portal)
CREATE POLICY passport_global_identities_self_select ON passport_global_identities
  FOR SELECT
  USING (
    -- Pré-auth signup: sem setting → bypass via NULL safe-cast retorna NULL ≠ id
    -- (não vaza dado mesmo sem app.passport_global_id setado — fail-closed)
    id = NULLIF(current_setting('app.passport_global_id', true), '')::uuid
  );

-- Pré-auth INSERT — Server Action signupPatient roda sem session
-- (visitor anônimo). Permite criação sempre; lint custom + validação de
-- input (Zod + Turnstile + OTP) garantem qualidade.
CREATE POLICY passport_global_identities_signup_insert ON passport_global_identities
  FOR INSERT
  WITH CHECK (true);

-- Self-update: paciente atualiza próprio
CREATE POLICY passport_global_identities_self_update ON passport_global_identities
  FOR UPDATE
  USING (
    id = NULLIF(current_setting('app.passport_global_id', true), '')::uuid
  )
  WITH CHECK (
    id = NULLIF(current_setting('app.passport_global_id', true), '')::uuid
  );

COMMENT ON TABLE passport_global_identities IS
  'Sprint 02b2 — Identidade global do paciente (ADR 0093). Pivot SEM tenant_id pra cadastro proativo. RLS via app.passport_global_id (member portal Sprint 02b3).';

COMMENT ON COLUMN passport_global_identities.password_hash IS
  'scrypt format scrypt$N$r$p$salt_b64$hash_b64 — packages/security/src/password-hash.ts';

COMMENT ON COLUMN passport_global_identities.mfa_totp_secret_encrypted IS
  'AES-256-GCM via LOGIFIT_DATA_KEY (ADR 0073). Ativado pós-signup via wizard Sprint 02b3.';

COMMENT ON COLUMN passport_global_identities.recovery_codes_encrypted IS
  'jsonb stringified cifrado — array de {hash, used_at}. packages/security/src/recovery-codes.ts.';
