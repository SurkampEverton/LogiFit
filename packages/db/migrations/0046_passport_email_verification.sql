-- packages/db/migrations/0046_passport_email_verification.sql
-- Sprint 02b4 fechamento — email confirmation pro paciente (LGPD).
--
-- Auth table sem tenant_id (paciente sem vínculo clínico ainda).
-- Padrão member_auth_tokens (Sprint 26): SHA-256 do token plano, single-use
-- (used_at), TTL 24h (link de confirmação aceita janela folgada — não auth).
--
-- @volume_estimate_yearly: 50000  -- 1 row por signup + reenvios + change_email

CREATE TABLE "passport_email_verification_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"passport_global_identity_id" uuid NOT NULL REFERENCES "passport_global_identities"("id") ON DELETE CASCADE,
	"email" text NOT NULL,  -- snapshot do email no momento da geração (proteção change-email race)
	"token_hash" text NOT NULL,  -- SHA-256 do token plano (256-bit aleatório base64url)
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"request_ip" text,
	"created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX "passport_email_verification_token_hash_uq"
	ON "passport_email_verification_tokens" ("token_hash");

CREATE INDEX "passport_email_verification_identity_idx"
	ON "passport_email_verification_tokens" ("passport_global_identity_id", "created_at" DESC);

-- Partial: tokens ativos (não usados, não expirados) — pra rate limit + cleanup cron
CREATE INDEX "passport_email_verification_active_idx"
	ON "passport_email_verification_tokens" ("passport_global_identity_id", "expires_at")
	WHERE "used_at" IS NULL;

COMMENT ON TABLE "passport_email_verification_tokens" IS
	'Tokens de confirmação de email pra passport global identities. Sprint 02b4 fechamento; padrão member_auth_tokens. Single-use via used_at, TTL 24h, SHA-256 do token plano.';
