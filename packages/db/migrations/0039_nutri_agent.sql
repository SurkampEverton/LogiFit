CREATE TYPE "public"."nutri_agent_run_status" AS ENUM('queued', 'collecting', 'analyzing', 'completed', 'failed', 'blocked');--> statement-breakpoint
CREATE TYPE "public"."nutri_agent_run_trigger" AS ENUM('manual_professional', 'pre_consult_auto', 'weekly_adherence', 'risk_event_triggered');--> statement-breakpoint
CREATE TYPE "public"."nutri_agent_suggestion_kind" AS ENUM('plan_adjustment', 'alert', 'risk_pattern', 'pre_consult_summary', 'follow_up_exam');--> statement-breakpoint
CREATE TYPE "public"."nutri_agent_suggestion_severity" AS ENUM('info', 'attention', 'critical');--> statement-breakpoint
CREATE TYPE "public"."nutri_agent_suggestion_status" AS ENUM('pending', 'accepted', 'rejected', 'expired');--> statement-breakpoint
CREATE TABLE "nutri_agent_metrics_snapshot" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"data" jsonb NOT NULL,
	"data_hash" text NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nutri_agent_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"triggered_by_user_id" uuid,
	"trigger" "nutri_agent_run_trigger" NOT NULL,
	"status" "nutri_agent_run_status" DEFAULT 'queued' NOT NULL,
	"model_used" text,
	"cost_cents" integer,
	"failure_reason" text,
	"summary" jsonb,
	"queued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	CONSTRAINT "nutri_agent_runs_completed_consistency" CHECK ((status NOT IN ('completed', 'failed', 'blocked') OR completed_at IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "nutri_agent_suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"kind" "nutri_agent_suggestion_kind" NOT NULL,
	"severity" "nutri_agent_suggestion_severity" DEFAULT 'info' NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"evidence" jsonb,
	"confidence" numeric(4, 3),
	"proposed_changes" jsonb,
	"target_meal_plan_id" uuid,
	"blocked_by_classifier" boolean DEFAULT false NOT NULL,
	"classifier_blocked_terms" jsonb,
	"status" "nutri_agent_suggestion_status" DEFAULT 'pending' NOT NULL,
	"reviewed_by_user_id" uuid,
	"reviewed_at" timestamp with time zone,
	"rejection_reason" text,
	"applied_meal_plan_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nutri_agent_suggestions_confidence_range" CHECK ("nutri_agent_suggestions"."confidence" IS NULL OR ("nutri_agent_suggestions"."confidence" >= 0 AND "nutri_agent_suggestions"."confidence" <= 1)),
	CONSTRAINT "nutri_agent_suggestions_reviewed_consistency" CHECK ((status NOT IN ('accepted', 'rejected') OR (reviewed_by_user_id IS NOT NULL AND reviewed_at IS NOT NULL)))
);
--> statement-breakpoint
ALTER TABLE "nutri_agent_metrics_snapshot" ADD CONSTRAINT "nutri_agent_metrics_snapshot_run_id_nutri_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."nutri_agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nutri_agent_runs" ADD CONSTRAINT "nutri_agent_runs_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nutri_agent_runs" ADD CONSTRAINT "nutri_agent_runs_triggered_by_user_id_users_id_fk" FOREIGN KEY ("triggered_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nutri_agent_suggestions" ADD CONSTRAINT "nutri_agent_suggestions_run_id_nutri_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."nutri_agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nutri_agent_suggestions" ADD CONSTRAINT "nutri_agent_suggestions_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nutri_agent_suggestions" ADD CONSTRAINT "nutri_agent_suggestions_target_meal_plan_id_meal_plans_id_fk" FOREIGN KEY ("target_meal_plan_id") REFERENCES "public"."meal_plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nutri_agent_suggestions" ADD CONSTRAINT "nutri_agent_suggestions_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nutri_agent_suggestions" ADD CONSTRAINT "nutri_agent_suggestions_applied_meal_plan_id_meal_plans_id_fk" FOREIGN KEY ("applied_meal_plan_id") REFERENCES "public"."meal_plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "nutri_agent_metrics_run_idx" ON "nutri_agent_metrics_snapshot" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "nutri_agent_metrics_hash_idx" ON "nutri_agent_metrics_snapshot" USING btree ("data_hash");--> statement-breakpoint
CREATE INDEX "nutri_agent_runs_tenant_member_idx" ON "nutri_agent_runs" USING btree ("tenant_id","member_id","queued_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "nutri_agent_runs_active_idx" ON "nutri_agent_runs" USING btree ("tenant_id","queued_at") WHERE status IN ('queued', 'collecting', 'analyzing');--> statement-breakpoint
CREATE INDEX "nutri_agent_suggestions_pending_idx" ON "nutri_agent_suggestions" USING btree ("tenant_id","created_at" DESC NULLS LAST) WHERE status = 'pending';--> statement-breakpoint
CREATE INDEX "nutri_agent_suggestions_member_idx" ON "nutri_agent_suggestions" USING btree ("member_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "nutri_agent_suggestions_run_idx" ON "nutri_agent_suggestions" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "nutri_agent_suggestions_severity_idx" ON "nutri_agent_suggestions" USING btree ("tenant_id","severity","created_at" DESC NULLS LAST) WHERE status = 'pending';