CREATE TYPE "public"."ai_doc_source" AS ENUM('adr', 'sprint', 'regulation', 'schema', 'runbook', 'user_uploaded');--> statement-breakpoint
CREATE TYPE "public"."support_ticket_category" AS ENUM('bug', 'question', 'feature_request', 'billing', 'other');--> statement-breakpoint
CREATE TYPE "public"."support_ticket_status" AS ENUM('open', 'in_progress', 'resolved', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."goal_kind" AS ENUM('weight_loss', 'weight_gain', 'frequency', 'strength_pr', 'body_composition', 'custom');--> statement-breakpoint
CREATE TYPE "public"."goal_measurement_source" AS ENUM('antropometria', 'checkin_count', 'workout_log', 'self_report', 'manual');--> statement-breakpoint
CREATE TYPE "public"."goal_status" AS ENUM('active', 'reached', 'missed', 'abandoned');--> statement-breakpoint
CREATE TYPE "public"."reward_grant_source" AS ENUM('achievement', 'referral', 'manual', 'promotion');--> statement-breakpoint
CREATE TYPE "public"."reward_grant_status" AS ENUM('pending_redeem', 'redeemed', 'shipped', 'delivered', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."reward_kind" AS ENUM('physical', 'digital_credit', 'service_credit');--> statement-breakpoint
CREATE TABLE "ai_document_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"document_id" uuid NOT NULL,
	"chunk_index" integer NOT NULL,
	"content" text NOT NULL,
	"tokens" integer NOT NULL,
	"embedding" vector(768),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"source" "ai_doc_source" NOT NULL,
	"source_path" text NOT NULL,
	"title" text NOT NULL,
	"content_hash" text NOT NULL,
	"tokens_total" integer NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"indexed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_semantic_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"query_text" text NOT NULL,
	"query_embedding" vector(768) NOT NULL,
	"response_text" text NOT NULL,
	"model_slug" text NOT NULL,
	"hits" integer DEFAULT 0 NOT NULL,
	"last_hit_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member_insights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"insight_key" text NOT NULL,
	"value" jsonb NOT NULL,
	"confidence" text,
	"generated_by" text,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"category" "support_ticket_category" DEFAULT 'other' NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "support_ticket_status" DEFAULT 'open' NOT NULL,
	"opened_by_assistant" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "achievements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"icon_url" text,
	"rule" jsonb NOT NULL,
	"reward_id" uuid,
	"points" numeric(10, 0) DEFAULT '0' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "goal_measurements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"goal_id" uuid NOT NULL,
	"value" numeric(12, 2) NOT NULL,
	"measured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" "goal_measurement_source" NOT NULL,
	"source_ref" uuid,
	"notes" text,
	"measured_by_user_id" uuid
);
--> statement-breakpoint
CREATE TABLE "goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"kind" "goal_kind" NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"target_value" numeric(12, 2) NOT NULL,
	"current_value" numeric(12, 2) DEFAULT '0' NOT NULL,
	"target_unit" text NOT NULL,
	"target_date" text NOT NULL,
	"status" "goal_status" DEFAULT 'active' NOT NULL,
	"reached_at" timestamp with time zone,
	"abandoned_reason" text,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member_achievements" (
	"tenant_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"achievement_id" uuid NOT NULL,
	"earned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"progress" jsonb
);
--> statement-breakpoint
CREATE TABLE "reward_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"reward_id" uuid NOT NULL,
	"source" "reward_grant_source" NOT NULL,
	"source_ref" uuid,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" "reward_grant_status" DEFAULT 'pending_redeem' NOT NULL,
	"redeemed_at" timestamp with time zone,
	"shipped_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancellation_reason" text,
	"notes" text,
	"granted_by_user_id" uuid
);
--> statement-breakpoint
CREATE TABLE "rewards_catalog" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"kind" "reward_kind" NOT NULL,
	"value_ref" jsonb NOT NULL,
	"stock_qty" numeric(10, 0),
	"active" boolean DEFAULT true NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rewards_catalog_stock_non_negative" CHECK ("rewards_catalog"."stock_qty" IS NULL OR "rewards_catalog"."stock_qty" >= 0)
);
--> statement-breakpoint
ALTER TABLE "ai_document_chunks" ADD CONSTRAINT "ai_document_chunks_document_id_ai_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."ai_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_measurements" ADD CONSTRAINT "goal_measurements_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_measurements" ADD CONSTRAINT "goal_measurements_measured_by_user_id_users_id_fk" FOREIGN KEY ("measured_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_achievements" ADD CONSTRAINT "member_achievements_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_achievements" ADD CONSTRAINT "member_achievements_achievement_id_achievements_id_fk" FOREIGN KEY ("achievement_id") REFERENCES "public"."achievements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reward_grants" ADD CONSTRAINT "reward_grants_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reward_grants" ADD CONSTRAINT "reward_grants_reward_id_rewards_catalog_id_fk" FOREIGN KEY ("reward_id") REFERENCES "public"."rewards_catalog"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reward_grants" ADD CONSTRAINT "reward_grants_granted_by_user_id_users_id_fk" FOREIGN KEY ("granted_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_document_chunks_doc_idx_uq" ON "ai_document_chunks" USING btree ("document_id","chunk_index");--> statement-breakpoint
CREATE INDEX "ai_document_chunks_tenant_idx" ON "ai_document_chunks" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_documents_source_path_uq" ON "ai_documents" USING btree ("source_path","tenant_id");--> statement-breakpoint
CREATE INDEX "ai_documents_tenant_source_idx" ON "ai_documents" USING btree ("tenant_id","source");--> statement-breakpoint
CREATE INDEX "ai_semantic_cache_tenant_idx" ON "ai_semantic_cache" USING btree ("tenant_id","last_hit_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ai_semantic_cache_expires_idx" ON "ai_semantic_cache" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "member_insights_member_key_uq" ON "member_insights" USING btree ("tenant_id","member_id","insight_key");--> statement-breakpoint
CREATE INDEX "member_insights_expires_idx" ON "member_insights" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "support_tickets_tenant_status_idx" ON "support_tickets" USING btree ("tenant_id","status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "support_tickets_tenant_user_idx" ON "support_tickets" USING btree ("tenant_id","user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "achievements_tenant_active_idx" ON "achievements" USING btree ("tenant_id") WHERE active = true AND archived_at IS NULL;--> statement-breakpoint
CREATE INDEX "goal_measurements_goal_at_idx" ON "goal_measurements" USING btree ("goal_id","measured_at");--> statement-breakpoint
CREATE INDEX "goal_measurements_tenant_idx" ON "goal_measurements" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "goals_tenant_member_idx" ON "goals" USING btree ("tenant_id","member_id","status");--> statement-breakpoint
CREATE INDEX "goals_active_idx" ON "goals" USING btree ("tenant_id","member_id") WHERE status = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "member_achievements_pk" ON "member_achievements" USING btree ("member_id","achievement_id");--> statement-breakpoint
CREATE INDEX "member_achievements_tenant_earned_idx" ON "member_achievements" USING btree ("tenant_id","earned_at");--> statement-breakpoint
CREATE INDEX "reward_grants_tenant_member_idx" ON "reward_grants" USING btree ("tenant_id","member_id","granted_at");--> statement-breakpoint
CREATE INDEX "reward_grants_status_idx" ON "reward_grants" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "reward_grants_pending_idx" ON "reward_grants" USING btree ("tenant_id") WHERE status IN ('pending_redeem', 'shipped');--> statement-breakpoint
CREATE INDEX "rewards_catalog_tenant_active_idx" ON "rewards_catalog" USING btree ("tenant_id") WHERE active = true AND archived_at IS NULL;