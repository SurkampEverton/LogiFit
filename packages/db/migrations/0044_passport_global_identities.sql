-- packages/db/migrations/0044_passport_global_identities.sql
-- Sprint 02b2 — passport_global_identities (ADR 0093).
--
-- Identidade global do paciente — pivot SEM tenant_id. Permite paciente ter
-- conta LogiFit antes de vínculo clínico (Path B cadastro proativo).
--
-- Bridge com persons (tenant-scoped) via nova coluna nullable
-- persons.passport_global_identity_id FK. Quando paciente aceita invite,
-- cria espelho persons no tenant emissor com FK pra global.

CREATE TABLE "passport_global_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"cpf_normalized" text NOT NULL,
	"email" text NOT NULL,
	"phone" text NOT NULL,
	"email_verified_at" timestamp with time zone,
	"phone_verified_at" timestamp with time zone,
	"birth_date" date,
	"sex" text,
	"password_hash" text NOT NULL,
	"password_changed_at" timestamp with time zone,
	"mfa_enrolled_at" timestamp with time zone,
	"mfa_totp_secret_encrypted" text,
	"recovery_codes_encrypted" text,
	"accepted_terms_at" timestamp with time zone NOT NULL,
	"terms_version" text NOT NULL,
	"accepted_privacy_at" timestamp with time zone NOT NULL,
	"privacy_version" text NOT NULL,
	"ripd_version_signup" text NOT NULL,
	"signup_path" text NOT NULL,
	"signup_ip" text,
	"signup_user_agent" text,
	"signup_otp_id" uuid,
	"last_login_at" timestamp with time zone,
	"deactivated_at" timestamp with time zone,
	"deactivated_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "passport_global_identities" ADD CONSTRAINT "passport_global_identities_signup_otp_id_passport_signup_otps_id_fk" FOREIGN KEY ("signup_otp_id") REFERENCES "public"."passport_signup_otps"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "passport_global_cpf_uq" ON "passport_global_identities" USING btree ("cpf_normalized");
--> statement-breakpoint
CREATE UNIQUE INDEX "passport_global_email_lower_uq" ON "passport_global_identities" USING btree (lower("email"));
--> statement-breakpoint
CREATE INDEX "passport_global_phone_idx" ON "passport_global_identities" USING btree ("phone");
--> statement-breakpoint
CREATE INDEX "passport_global_active_idx" ON "passport_global_identities" USING btree ("created_at" DESC NULLS LAST) WHERE "passport_global_identities"."deactivated_at" IS NULL;
--> statement-breakpoint
CREATE INDEX "passport_global_signup_otp_idx" ON "passport_global_identities" USING btree ("signup_otp_id");
--> statement-breakpoint
-- ALTER persons ADD bridge column (nullable FK pra global identity)
ALTER TABLE "persons" ADD COLUMN "passport_global_identity_id" uuid;
--> statement-breakpoint
ALTER TABLE "persons" ADD CONSTRAINT "persons_passport_global_identity_id_fk" FOREIGN KEY ("passport_global_identity_id") REFERENCES "public"."passport_global_identities"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "persons_passport_global_id_idx" ON "persons" USING btree ("passport_global_identity_id") WHERE "persons"."passport_global_identity_id" IS NOT NULL;
