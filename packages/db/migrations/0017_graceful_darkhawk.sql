CREATE TYPE "public"."exercise_level" AS ENUM('iniciante', 'intermediario', 'avancado');--> statement-breakpoint
CREATE TYPE "public"."prescription_kind" AS ENUM('workout', 'meal_plan', 'fisio_protocol', 'custom');--> statement-breakpoint
CREATE TABLE "exercises" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"name" text NOT NULL,
	"description" text,
	"muscle_groups" text[] DEFAULT '{}'::text[] NOT NULL,
	"equipment" text,
	"level" "exercise_level" DEFAULT 'iniciante' NOT NULL,
	"met_value" numeric(4, 2) NOT NULL,
	"variations" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"video_storage_path" text,
	"thumbnail_url" text,
	"created_by_user_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exercises_met_positive" CHECK ("exercises"."met_value" > 0)
);
--> statement-breakpoint
CREATE TABLE "prescriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"kind" "prescription_kind" NOT NULL,
	"ref_id" uuid,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"active" boolean DEFAULT true NOT NULL,
	"prescribed_by_user_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prescriptions_ref_required" CHECK (kind = 'custom' OR ref_id IS NOT NULL),
	CONSTRAINT "prescriptions_ends_after_starts" CHECK ("prescriptions"."ends_at" IS NULL OR "prescriptions"."ends_at" > "prescriptions"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "workout_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"workout_id" uuid NOT NULL,
	"exercise_id" uuid NOT NULL,
	"order" integer NOT NULL,
	"sets" integer NOT NULL,
	"reps" text NOT NULL,
	"load_kg" numeric(6, 2),
	"rest_seconds" integer DEFAULT 60 NOT NULL,
	"notes" text,
	"superset_group" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workout_items_sets_positive" CHECK ("workout_items"."sets" > 0),
	CONSTRAINT "workout_items_rest_non_negative" CHECK ("workout_items"."rest_seconds" >= 0),
	CONSTRAINT "workout_items_load_non_negative" CHECK ("workout_items"."load_kg" IS NULL OR "workout_items"."load_kg" >= 0)
);
--> statement-breakpoint
CREATE TABLE "workout_session_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"workout_item_id" uuid NOT NULL,
	"set_number" integer NOT NULL,
	"reps_performed" integer,
	"weight_kg" numeric(6, 2),
	"rpe" integer,
	"done_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workout_session_items_set_positive" CHECK ("workout_session_items"."set_number" > 0),
	CONSTRAINT "workout_session_items_rpe_range" CHECK ("workout_session_items"."rpe" IS NULL OR ("workout_session_items"."rpe" >= 1 AND "workout_session_items"."rpe" <= 10)),
	CONSTRAINT "workout_session_items_weight_non_negative" CHECK ("workout_session_items"."weight_kg" IS NULL OR "workout_session_items"."weight_kg" >= 0),
	CONSTRAINT "workout_session_items_reps_non_negative" CHECK ("workout_session_items"."reps_performed" IS NULL OR "workout_session_items"."reps_performed" >= 0)
);
--> statement-breakpoint
CREATE TABLE "workout_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"prescription_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"overall_rpe" integer,
	"calculated_kcal" numeric(8, 2),
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workout_sessions_rpe_range" CHECK ("workout_sessions"."overall_rpe" IS NULL OR ("workout_sessions"."overall_rpe" >= 1 AND "workout_sessions"."overall_rpe" <= 10)),
	CONSTRAINT "workout_sessions_finished_after_started" CHECK ("workout_sessions"."finished_at" IS NULL OR "workout_sessions"."finished_at" >= "workout_sessions"."started_at")
);
--> statement-breakpoint
CREATE TABLE "workouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"goal" text,
	"estimated_duration_min" integer,
	"version" integer DEFAULT 1 NOT NULL,
	"parent_workout_id" uuid,
	"created_by_user_id" uuid,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workouts_version_positive" CHECK ("workouts"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "exercises" ADD CONSTRAINT "exercises_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_prescribed_by_user_id_users_id_fk" FOREIGN KEY ("prescribed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_items" ADD CONSTRAINT "workout_items_workout_id_workouts_id_fk" FOREIGN KEY ("workout_id") REFERENCES "public"."workouts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_items" ADD CONSTRAINT "workout_items_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_session_items" ADD CONSTRAINT "workout_session_items_session_id_workout_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."workout_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_session_items" ADD CONSTRAINT "workout_session_items_workout_item_id_workout_items_id_fk" FOREIGN KEY ("workout_item_id") REFERENCES "public"."workout_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_sessions" ADD CONSTRAINT "workout_sessions_prescription_id_prescriptions_id_fk" FOREIGN KEY ("prescription_id") REFERENCES "public"."prescriptions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_sessions" ADD CONSTRAINT "workout_sessions_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workouts" ADD CONSTRAINT "workouts_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "exercises_tenant_active_idx" ON "exercises" USING btree ("tenant_id","active") WHERE archived_at IS NULL;--> statement-breakpoint
CREATE INDEX "exercises_global_idx" ON "exercises" USING btree ("active") WHERE tenant_id IS NULL AND active = true AND archived_at IS NULL;--> statement-breakpoint
CREATE INDEX "prescriptions_tenant_member_idx" ON "prescriptions" USING btree ("tenant_id","member_id");--> statement-breakpoint
CREATE INDEX "prescriptions_kind_ref_idx" ON "prescriptions" USING btree ("kind","ref_id");--> statement-breakpoint
CREATE INDEX "prescriptions_active_idx" ON "prescriptions" USING btree ("tenant_id","member_id") WHERE active = true;--> statement-breakpoint
CREATE UNIQUE INDEX "workout_items_workout_order_uq" ON "workout_items" USING btree ("workout_id","order");--> statement-breakpoint
CREATE INDEX "workout_items_workout_idx" ON "workout_items" USING btree ("workout_id");--> statement-breakpoint
CREATE INDEX "workout_items_exercise_idx" ON "workout_items" USING btree ("exercise_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workout_session_items_unique" ON "workout_session_items" USING btree ("session_id","workout_item_id","set_number");--> statement-breakpoint
CREATE INDEX "workout_session_items_session_idx" ON "workout_session_items" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "workout_session_items_workout_item_idx" ON "workout_session_items" USING btree ("workout_item_id");--> statement-breakpoint
CREATE INDEX "workout_sessions_tenant_member_idx" ON "workout_sessions" USING btree ("tenant_id","member_id","started_at");--> statement-breakpoint
CREATE INDEX "workout_sessions_prescription_idx" ON "workout_sessions" USING btree ("prescription_id");--> statement-breakpoint
CREATE INDEX "workout_sessions_active_idx" ON "workout_sessions" USING btree ("tenant_id","member_id") WHERE finished_at IS NULL;--> statement-breakpoint
CREATE INDEX "workouts_tenant_active_idx" ON "workouts" USING btree ("tenant_id") WHERE archived_at IS NULL;--> statement-breakpoint
CREATE INDEX "workouts_parent_idx" ON "workouts" USING btree ("parent_workout_id");