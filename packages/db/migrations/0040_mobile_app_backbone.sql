CREATE TYPE "public"."mobile_platform" AS ENUM('ios', 'android');--> statement-breakpoint
CREATE TYPE "public"."mobile_session_status" AS ENUM('active', 'revoked', 'expired');--> statement-breakpoint
CREATE TABLE "mobile_app_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform" "mobile_platform" NOT NULL,
	"version" text NOT NULL,
	"build_number" text NOT NULL,
	"store_url" text,
	"release_notes" text,
	"min_required" boolean DEFAULT false NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sunset" boolean DEFAULT false NOT NULL,
	"sunset_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mobile_push_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"platform" "mobile_platform" NOT NULL,
	"token" text NOT NULL,
	"device_id" text,
	"device_model" text,
	"os_version" text,
	"app_version" text,
	"locale" text,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"registered_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mobile_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"platform" "mobile_platform" NOT NULL,
	"refresh_token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"device_fingerprint" text,
	"device_label" text,
	"app_version" text,
	"created_ip" text,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_ip" text,
	"status" "mobile_session_status" DEFAULT 'active' NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mobile_sessions_revoked_consistency" CHECK ((status != 'revoked' OR revoked_at IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "mobile_push_tokens" ADD CONSTRAINT "mobile_push_tokens_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mobile_sessions" ADD CONSTRAINT "mobile_sessions_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mobile_app_versions_platform_version_uq" ON "mobile_app_versions" USING btree ("platform","version");--> statement-breakpoint
CREATE INDEX "mobile_app_versions_published_idx" ON "mobile_app_versions" USING btree ("platform","published_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "mobile_app_versions_min_required_idx" ON "mobile_app_versions" USING btree ("platform","published_at" DESC NULLS LAST) WHERE min_required = true;--> statement-breakpoint
CREATE UNIQUE INDEX "mobile_push_tokens_member_device_active_uq" ON "mobile_push_tokens" USING btree ("member_id","device_id","platform") WHERE revoked_at IS NULL;--> statement-breakpoint
CREATE INDEX "mobile_push_tokens_member_active_idx" ON "mobile_push_tokens" USING btree ("member_id","platform") WHERE revoked_at IS NULL;--> statement-breakpoint
CREATE INDEX "mobile_push_tokens_tenant_idx" ON "mobile_push_tokens" USING btree ("tenant_id","last_used_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "mobile_sessions_refresh_hash_uq" ON "mobile_sessions" USING btree ("refresh_token_hash");--> statement-breakpoint
CREATE INDEX "mobile_sessions_member_active_idx" ON "mobile_sessions" USING btree ("member_id","platform") WHERE status = 'active';