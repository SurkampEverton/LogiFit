CREATE TYPE "public"."churn_event_reason" AS ENUM('financial', 'location', 'health', 'competitor', 'satisfaction', 'schedule', 'other');--> statement-breakpoint
CREATE TYPE "public"."churn_risk_band" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TYPE "public"."intervention_action" AS ENUM('phone_call', 'whatsapp_message', 'free_pass', 'discount_offer', 'in_person_visit', 'manual');--> statement-breakpoint
CREATE TYPE "public"."intervention_outcome" AS ENUM('success', 'partial', 'failed', 'member_canceled_anyway');--> statement-breakpoint
CREATE TABLE "churn_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"event_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reason" "churn_event_reason" NOT NULL,
	"reason_detail" text,
	"prob_at_churn" numeric(4, 3),
	"was_predicted" boolean,
	"intervention_id" uuid,
	"recorded_by_user_id" uuid
);
--> statement-breakpoint
CREATE TABLE "churn_features_snapshot" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"snapshot_at" timestamp with time zone DEFAULT now() NOT NULL,
	"features" jsonb NOT NULL,
	"snapshot_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "churn_interventions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"prediction_id" uuid NOT NULL,
	"assigned_to_user_id" uuid NOT NULL,
	"action" "intervention_action" NOT NULL,
	"notes" text,
	"assigned_by_user_id" uuid,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"closed_by_user_id" uuid,
	"outcome" "intervention_outcome",
	"outcome_notes" text
);
--> statement-breakpoint
CREATE TABLE "churn_predictions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"model_version" text NOT NULL,
	"prob_30d" numeric(4, 3) NOT NULL,
	"prob_60d" numeric(4, 3) NOT NULL,
	"prob_90d" numeric(4, 3) NOT NULL,
	"risk_band" "churn_risk_band" NOT NULL,
	"top_factors" jsonb NOT NULL,
	"source" text DEFAULT 'llm' NOT NULL,
	"latency_ms" integer,
	"predicted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"valid_until" timestamp with time zone NOT NULL,
	CONSTRAINT "churn_prob_30d_range" CHECK (prob_30d >= 0 AND prob_30d <= 1),
	CONSTRAINT "churn_prob_60d_range" CHECK (prob_60d >= 0 AND prob_60d <= 1),
	CONSTRAINT "churn_prob_90d_range" CHECK (prob_90d >= 0 AND prob_90d <= 1)
);
--> statement-breakpoint
ALTER TABLE "churn_events" ADD CONSTRAINT "churn_events_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "churn_events" ADD CONSTRAINT "churn_events_intervention_id_churn_interventions_id_fk" FOREIGN KEY ("intervention_id") REFERENCES "public"."churn_interventions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "churn_events" ADD CONSTRAINT "churn_events_recorded_by_user_id_users_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "churn_features_snapshot" ADD CONSTRAINT "churn_features_snapshot_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "churn_interventions" ADD CONSTRAINT "churn_interventions_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "churn_interventions" ADD CONSTRAINT "churn_interventions_prediction_id_churn_predictions_id_fk" FOREIGN KEY ("prediction_id") REFERENCES "public"."churn_predictions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "churn_interventions" ADD CONSTRAINT "churn_interventions_assigned_to_user_id_users_id_fk" FOREIGN KEY ("assigned_to_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "churn_interventions" ADD CONSTRAINT "churn_interventions_assigned_by_user_id_users_id_fk" FOREIGN KEY ("assigned_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "churn_interventions" ADD CONSTRAINT "churn_interventions_closed_by_user_id_users_id_fk" FOREIGN KEY ("closed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "churn_predictions" ADD CONSTRAINT "churn_predictions_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "churn_predictions" ADD CONSTRAINT "churn_predictions_snapshot_id_churn_features_snapshot_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."churn_features_snapshot"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "churn_events_member_uq" ON "churn_events" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "churn_events_tenant_at_idx" ON "churn_events" USING btree ("tenant_id","event_at");--> statement-breakpoint
CREATE INDEX "churn_events_predicted_idx" ON "churn_events" USING btree ("tenant_id","was_predicted");--> statement-breakpoint
CREATE INDEX "churn_features_tenant_member_idx" ON "churn_features_snapshot" USING btree ("tenant_id","member_id","snapshot_at");--> statement-breakpoint
CREATE INDEX "churn_features_snapshot_at_idx" ON "churn_features_snapshot" USING btree ("snapshot_at");--> statement-breakpoint
CREATE INDEX "churn_intv_tenant_open_idx" ON "churn_interventions" USING btree ("tenant_id","assigned_at") WHERE closed_at IS NULL;--> statement-breakpoint
CREATE INDEX "churn_intv_member_idx" ON "churn_interventions" USING btree ("member_id","assigned_at");--> statement-breakpoint
CREATE INDEX "churn_intv_assigned_to_idx" ON "churn_interventions" USING btree ("assigned_to_user_id") WHERE closed_at IS NULL;--> statement-breakpoint
CREATE INDEX "churn_pred_tenant_band_idx" ON "churn_predictions" USING btree ("tenant_id","risk_band","predicted_at");--> statement-breakpoint
CREATE INDEX "churn_pred_member_idx" ON "churn_predictions" USING btree ("member_id","predicted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "churn_pred_snapshot_uq" ON "churn_predictions" USING btree ("snapshot_id");