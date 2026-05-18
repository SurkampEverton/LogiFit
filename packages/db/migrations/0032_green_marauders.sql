CREATE TABLE "member_auth_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"channel" text DEFAULT 'email' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"request_ip" text,
	"request_user_agent" text,
	"consumed_ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member_consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"granted" boolean NOT NULL,
	"ripd_version" text,
	"consent_text" text,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"source_ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"refresh_token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"device_label" text,
	"user_agent" text,
	"created_ip" text,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_ip" text,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "member_auth_tokens" ADD CONSTRAINT "member_auth_tokens_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_consents" ADD CONSTRAINT "member_consents_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_sessions" ADD CONSTRAINT "member_sessions_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mat_token_hash_uq" ON "member_auth_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "mat_member_idx" ON "member_auth_tokens" USING btree ("member_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "mat_tenant_idx" ON "member_auth_tokens" USING btree ("tenant_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "mat_member_active_idx" ON "member_auth_tokens" USING btree ("member_id","expires_at") WHERE used_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "mc_member_purpose_active_uq" ON "member_consents" USING btree ("member_id","purpose") WHERE revoked_at IS NULL;--> statement-breakpoint
CREATE INDEX "mc_tenant_idx" ON "member_consents" USING btree ("tenant_id","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "mc_member_idx" ON "member_consents" USING btree ("member_id","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "ms_refresh_hash_uq" ON "member_sessions" USING btree ("refresh_token_hash");--> statement-breakpoint
CREATE INDEX "ms_member_idx" ON "member_sessions" USING btree ("member_id","last_seen_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ms_tenant_idx" ON "member_sessions" USING btree ("tenant_id","last_seen_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ms_member_active_idx" ON "member_sessions" USING btree ("member_id","expires_at") WHERE revoked_at IS NULL;