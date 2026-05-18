CREATE TYPE "public"."meal_name_enum" AS ENUM('cafe', 'lanche_manha', 'almoco', 'lanche_tarde', 'jantar', 'ceia', 'pre_treino', 'pos_treino', 'outro');--> statement-breakpoint
CREATE TYPE "public"."meal_review_status" AS ENUM('approved', 'needs_adjustment', 'flagged');--> statement-breakpoint
CREATE TYPE "public"."teleconsulta_provider" AS ENUM('daily', 'whereby', 'jitsi', 'twilio', 'other');--> statement-breakpoint
CREATE TYPE "public"."teleconsulta_status" AS ENUM('scheduled', 'active', 'ended', 'cancelled', 'failed');--> statement-breakpoint
CREATE TABLE "food_log_daily_summary" (
	"tenant_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"consumed_date" date NOT NULL,
	"total_kcal" numeric(8, 1) DEFAULT '0' NOT NULL,
	"total_protein_g" numeric(7, 1) DEFAULT '0' NOT NULL,
	"total_carb_g" numeric(7, 1) DEFAULT '0' NOT NULL,
	"total_fat_g" numeric(7, 1) DEFAULT '0' NOT NULL,
	"meals_count" integer DEFAULT 0 NOT NULL,
	"adherence_pct" numeric(5, 2),
	"meal_plan_id_ref" uuid,
	"status" text DEFAULT 'logged' NOT NULL,
	"aggregated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "food_log_daily_summary_tenant_id_member_id_consumed_date_pk" PRIMARY KEY("tenant_id","member_id","consumed_date"),
	CONSTRAINT "food_log_summary_adherence_pct_range" CHECK ("food_log_daily_summary"."adherence_pct" IS NULL OR ("food_log_daily_summary"."adherence_pct" >= 0 AND "food_log_daily_summary"."adherence_pct" <= 100))
);
--> statement-breakpoint
CREATE TABLE "meal_log_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"meal_plan_id" uuid,
	"consumed_date" date NOT NULL,
	"meal_name" "meal_name_enum" NOT NULL,
	"consumed_at" timestamp with time zone,
	"foods_structured" jsonb,
	"free_text_description" text,
	"photo_storage_path" text,
	"notes_member" text,
	"calculated_nutrition" jsonb,
	"review_status" "meal_review_status",
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meal_log_has_content" CHECK (("meal_log_entries"."foods_structured" IS NOT NULL OR "meal_log_entries"."free_text_description" IS NOT NULL OR "meal_log_entries"."photo_storage_path" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "meal_log_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"reviewed_by_user_id" uuid NOT NULL,
	"status" "meal_review_status" NOT NULL,
	"comment" text,
	"reviewed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "teleconsultation_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"appointment_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"professional_user_id" uuid NOT NULL,
	"consulta_id" uuid,
	"provider" "teleconsulta_provider" DEFAULT 'daily' NOT NULL,
	"room_id" text NOT NULL,
	"room_url" text,
	"access_token" text,
	"status" "teleconsulta_status" DEFAULT 'scheduled' NOT NULL,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"recording_consent_granted" boolean DEFAULT false NOT NULL,
	"transcription_consent_granted" boolean DEFAULT false NOT NULL,
	"recording_storage_path" text,
	"transcript_storage_path" text,
	"transcript" jsonb,
	"participants_log" jsonb,
	"failure_reason" text,
	"ai_draft_soap" jsonb,
	"ai_draft_status" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "telecon_ended_consistency" CHECK ((status NOT IN ('ended', 'cancelled', 'failed') OR ended_at IS NOT NULL)),
	CONSTRAINT "telecon_recording_requires_consent" CHECK (recording_storage_path IS NULL OR recording_consent_granted = true),
	CONSTRAINT "telecon_transcript_requires_consent" CHECK (transcript IS NULL OR transcription_consent_granted = true)
);
--> statement-breakpoint
ALTER TABLE "food_log_daily_summary" ADD CONSTRAINT "food_log_daily_summary_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_log_entries" ADD CONSTRAINT "meal_log_entries_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_log_entries" ADD CONSTRAINT "meal_log_entries_meal_plan_id_meal_plans_id_fk" FOREIGN KEY ("meal_plan_id") REFERENCES "public"."meal_plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_log_reviews" ADD CONSTRAINT "meal_log_reviews_entry_id_meal_log_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."meal_log_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_log_reviews" ADD CONSTRAINT "meal_log_reviews_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teleconsultation_sessions" ADD CONSTRAINT "teleconsultation_sessions_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teleconsultation_sessions" ADD CONSTRAINT "teleconsultation_sessions_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teleconsultation_sessions" ADD CONSTRAINT "teleconsultation_sessions_professional_user_id_users_id_fk" FOREIGN KEY ("professional_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teleconsultation_sessions" ADD CONSTRAINT "teleconsultation_sessions_consulta_id_consultas_id_fk" FOREIGN KEY ("consulta_id") REFERENCES "public"."consultas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "food_log_summary_member_date_idx" ON "food_log_daily_summary" USING btree ("member_id","consumed_date" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "food_log_summary_tenant_date_idx" ON "food_log_daily_summary" USING btree ("tenant_id","consumed_date");--> statement-breakpoint
CREATE INDEX "meal_log_member_date_idx" ON "meal_log_entries" USING btree ("member_id","consumed_date" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "meal_log_tenant_date_idx" ON "meal_log_entries" USING btree ("tenant_id","consumed_date" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "meal_log_pending_review_idx" ON "meal_log_entries" USING btree ("tenant_id","created_at" DESC NULLS LAST) WHERE review_status IS NULL;--> statement-breakpoint
CREATE INDEX "meal_log_reviews_entry_idx" ON "meal_log_reviews" USING btree ("entry_id","reviewed_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "meal_log_reviews_tenant_user_idx" ON "meal_log_reviews" USING btree ("tenant_id","reviewed_by_user_id","reviewed_at");--> statement-breakpoint
CREATE INDEX "telecon_tenant_status_idx" ON "teleconsultation_sessions" USING btree ("tenant_id","status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "telecon_member_idx" ON "teleconsultation_sessions" USING btree ("member_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "telecon_professional_idx" ON "teleconsultation_sessions" USING btree ("professional_user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "telecon_appointment_idx" ON "teleconsultation_sessions" USING btree ("appointment_id");--> statement-breakpoint
CREATE INDEX "telecon_active_idx" ON "teleconsultation_sessions" USING btree ("tenant_id") WHERE status = 'active';