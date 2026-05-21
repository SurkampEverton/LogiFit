-- packages/db/migrations/0047_passport_email_change.sql
-- Sprint 02b5 — change_email flow.
--
-- Estende passport_email_verification_tokens com 2 colunas pra suportar
-- 2 tipos de fluxo no mesmo schema:
--   - kind='signup'        — confirmação pós-signup (Sprint 02b4 fechamento)
--   - kind='change_email'  — confirmação de troca de email (este sprint)
--
-- Em kind='change_email', `email` é o ATUAL (snapshot) e `new_email` é o
-- novo target. Quando confirmado, UPDATE passport_global_identities.email
-- = new_email + reset email_verified_at = now() (já está verificando o novo).
--
-- Old email recebe notificação informativa "seu email foi alterado pra X"
-- (alerta de segurança — paciente sabe se foi não-autorizado).

ALTER TABLE "passport_email_verification_tokens"
  ADD COLUMN IF NOT EXISTS "kind" text NOT NULL DEFAULT 'signup'
    CHECK ("kind" IN ('signup', 'change_email'));

ALTER TABLE "passport_email_verification_tokens"
  ADD COLUMN IF NOT EXISTS "new_email" text;

-- Constraint: kind='change_email' OBRIGA new_email; kind='signup' não usa
ALTER TABLE "passport_email_verification_tokens"
  ADD CONSTRAINT "passport_email_verification_kind_new_email_check"
  CHECK (
    (kind = 'signup' AND new_email IS NULL) OR
    (kind = 'change_email' AND new_email IS NOT NULL)
  );

-- Index pra filtro por kind (cron cleanup pode separar comportamento)
CREATE INDEX IF NOT EXISTS "passport_email_verification_kind_idx"
  ON "passport_email_verification_tokens" ("kind", "expires_at");

COMMENT ON COLUMN "passport_email_verification_tokens"."kind" IS
  'signup = confirmação pós-cadastro (Sprint 02b4); change_email = troca de email (Sprint 02b5).';

COMMENT ON COLUMN "passport_email_verification_tokens"."new_email" IS
  'Novo email target em kind=change_email. NULL em kind=signup. Validado por check constraint.';
