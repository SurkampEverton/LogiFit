CREATE TYPE "public"."adaptation_status" AS ENUM('suggested', 'confirmed', 'rejected', 'manually_overridden');--> statement-breakpoint
CREATE TYPE "public"."contraindication_severity" AS ENUM('avoid', 'modify', 'caution');--> statement-breakpoint
CREATE TYPE "public"."injury_alert_status" AS ENUM('pending_review', 'accepted', 'rejected', 'expired', 'blocked');--> statement-breakpoint
CREATE TABLE "cid_exercise_contraindications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"cid_code" text NOT NULL,
	"exercise_id" uuid,
	"muscle_group" text,
	"movement_pattern" text,
	"severity" "contraindication_severity" DEFAULT 'caution' NOT NULL,
	"alternative_exercise_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"rationale" text,
	"source" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cid_contra_at_least_one_target" CHECK (("cid_exercise_contraindications"."exercise_id" IS NOT NULL OR "cid_exercise_contraindications"."muscle_group" IS NOT NULL OR "cid_exercise_contraindications"."movement_pattern" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "member_injury_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"source_consulta_id" uuid NOT NULL,
	"primary_cid_code" text NOT NULL,
	"secondary_cid_codes" jsonb,
	"source_company_id" uuid,
	"target_company_id" uuid,
	"status" "injury_alert_status" DEFAULT 'pending_review' NOT NULL,
	"blocked_reason" text,
	"consent_id_used" uuid,
	"reviewed_by_user_id" uuid,
	"reviewed_at" timestamp with time zone,
	"rejection_reason" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "injury_alerts_blocked_requires_reason" CHECK ((status != 'blocked' OR blocked_reason IS NOT NULL)),
	CONSTRAINT "injury_alerts_reviewed_consistency" CHECK ((status NOT IN ('accepted', 'rejected') OR (reviewed_by_user_id IS NOT NULL AND reviewed_at IS NOT NULL)))
);
--> statement-breakpoint
CREATE TABLE "workout_adaptations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"alert_id" uuid NOT NULL,
	"original_workout_id" uuid NOT NULL,
	"adapted_workout_id" uuid,
	"changes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "adaptation_status" DEFAULT 'suggested' NOT NULL,
	"confirmed_at" timestamp with time zone,
	"confirmed_by_user_id" uuid,
	"rejection_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workout_adaptations_confirmed_consistency" CHECK ((status != 'confirmed' OR (confirmed_at IS NOT NULL AND adapted_workout_id IS NOT NULL)))
);
--> statement-breakpoint
ALTER TABLE "cid_exercise_contraindications" ADD CONSTRAINT "cid_exercise_contraindications_cid_code_cid_catalog_code_fk" FOREIGN KEY ("cid_code") REFERENCES "public"."cid_catalog"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cid_exercise_contraindications" ADD CONSTRAINT "cid_exercise_contraindications_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_injury_alerts" ADD CONSTRAINT "member_injury_alerts_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_injury_alerts" ADD CONSTRAINT "member_injury_alerts_source_consulta_id_consultas_id_fk" FOREIGN KEY ("source_consulta_id") REFERENCES "public"."consultas"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_injury_alerts" ADD CONSTRAINT "member_injury_alerts_primary_cid_code_cid_catalog_code_fk" FOREIGN KEY ("primary_cid_code") REFERENCES "public"."cid_catalog"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_injury_alerts" ADD CONSTRAINT "member_injury_alerts_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_adaptations" ADD CONSTRAINT "workout_adaptations_alert_id_member_injury_alerts_id_fk" FOREIGN KEY ("alert_id") REFERENCES "public"."member_injury_alerts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_adaptations" ADD CONSTRAINT "workout_adaptations_original_workout_id_workouts_id_fk" FOREIGN KEY ("original_workout_id") REFERENCES "public"."workouts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_adaptations" ADD CONSTRAINT "workout_adaptations_adapted_workout_id_workouts_id_fk" FOREIGN KEY ("adapted_workout_id") REFERENCES "public"."workouts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_adaptations" ADD CONSTRAINT "workout_adaptations_confirmed_by_user_id_users_id_fk" FOREIGN KEY ("confirmed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cid_contra_code_active_idx" ON "cid_exercise_contraindications" USING btree ("cid_code","active") WHERE active = true;--> statement-breakpoint
CREATE INDEX "cid_contra_tenant_idx" ON "cid_exercise_contraindications" USING btree ("tenant_id","cid_code");--> statement-breakpoint
CREATE INDEX "cid_contra_global_idx" ON "cid_exercise_contraindications" USING btree ("cid_code","active") WHERE tenant_id IS NULL AND active = true;--> statement-breakpoint
CREATE UNIQUE INDEX "cid_contra_dedup_uq" ON "cid_exercise_contraindications" USING btree ("tenant_id","cid_code",COALESCE("exercise_id"::text, ''),COALESCE("muscle_group", ''),COALESCE("movement_pattern", ''));--> statement-breakpoint
CREATE INDEX "injury_alerts_tenant_status_idx" ON "member_injury_alerts" USING btree ("tenant_id","status","created_at");--> statement-breakpoint
CREATE INDEX "injury_alerts_member_idx" ON "member_injury_alerts" USING btree ("member_id","created_at");--> statement-breakpoint
CREATE INDEX "injury_alerts_consulta_idx" ON "member_injury_alerts" USING btree ("source_consulta_id");--> statement-breakpoint
CREATE INDEX "injury_alerts_pending_idx" ON "member_injury_alerts" USING btree ("tenant_id","expires_at") WHERE status = 'pending_review';--> statement-breakpoint
CREATE UNIQUE INDEX "workout_adaptations_alert_uq" ON "workout_adaptations" USING btree ("alert_id");--> statement-breakpoint
CREATE INDEX "workout_adaptations_tenant_status_idx" ON "workout_adaptations" USING btree ("tenant_id","status","created_at");--> statement-breakpoint
CREATE INDEX "workout_adaptations_workout_idx" ON "workout_adaptations" USING btree ("original_workout_id");