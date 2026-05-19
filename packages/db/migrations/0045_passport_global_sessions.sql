-- packages/db/migrations/0045_passport_global_sessions.sql
-- Sprint 02b3 — passport_global_sessions (ADR 0094).
--
-- Sessões dedicadas pra paciente com identidade global. Análogo a
-- member_sessions (Sprint 26 ADR 0088) mas SEM tenant_id/member_id —
-- paciente pode ter session sem vínculo clínico ainda.

CREATE TABLE "passport_global_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"passport_global_identity_id" uuid NOT NULL,
	"refresh_token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"device_label" text,
	"ip" text,
	"mfa_verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text
);
--> statement-breakpoint
ALTER TABLE "passport_global_sessions" ADD CONSTRAINT "passport_global_sessions_passport_global_identity_id_fk" FOREIGN KEY ("passport_global_identity_id") REFERENCES "public"."passport_global_identities"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "passport_global_sessions_token_uq" ON "passport_global_sessions" USING btree ("refresh_token_hash");
--> statement-breakpoint
CREATE INDEX "passport_global_sessions_identity_idx" ON "passport_global_sessions" USING btree ("passport_global_identity_id","created_at" DESC NULLS LAST);
--> statement-breakpoint
CREATE INDEX "passport_global_sessions_active_idx" ON "passport_global_sessions" USING btree ("passport_global_identity_id","expires_at" DESC NULLS LAST) WHERE "passport_global_sessions"."revoked_at" IS NULL;
--> statement-breakpoint
CREATE INDEX "passport_global_sessions_cleanup_idx" ON "passport_global_sessions" USING btree ("expires_at") WHERE "passport_global_sessions"."revoked_at" IS NULL;
