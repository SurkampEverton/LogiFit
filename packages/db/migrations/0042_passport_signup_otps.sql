-- packages/db/migrations/0042_passport_signup_otps.sql
-- Sprint 02b Path B — cadastro proativo /cadastro (Sprint 02 fechamento).
--
-- Tabela armazena OTPs SMS pendentes na etapa 1 do cadastro proativo.
-- Sem tenant_id nem member_id — pré-auth global (caller é visitor anônimo).
-- RLS desabilitado (acesso direto via pool.query do Server Action).

CREATE TABLE "passport_signup_otps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone" text NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"request_ip" text,
	"sms_provider" text,
	"sms_message_sid" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "passport_signup_otps_phone_idx" ON "passport_signup_otps" USING btree ("phone","created_at" DESC NULLS LAST);
--> statement-breakpoint
CREATE INDEX "passport_signup_otps_expires_idx" ON "passport_signup_otps" USING btree ("expires_at");
