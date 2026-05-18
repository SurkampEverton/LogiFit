CREATE TYPE "public"."lab_analyte_category" AS ENUM('bioquimico', 'hematologico', 'hormonal', 'lipidograma', 'vitamina_mineral', 'inflamatorio', 'metabolismo_oxidativo', 'imunologico', 'urina', 'fezes', 'outro');--> statement-breakpoint
CREATE TYPE "public"."lab_result_direction" AS ENUM('above', 'below');--> statement-breakpoint
CREATE TYPE "public"."reference_range_sex" AS ENUM('any', 'male', 'female');--> statement-breakpoint
CREATE TYPE "public"."supplement_interaction_severity" AS ENUM('info', 'caution', 'avoid');--> statement-breakpoint
CREATE TYPE "public"."supplement_kind" AS ENUM('vitamin', 'mineral', 'fitoterapico', 'aminoacid', 'protein_powder', 'blend', 'omega', 'probiotic', 'enzyme', 'pre_workout', 'other');--> statement-breakpoint
CREATE TYPE "public"."supplement_prescription_status" AS ENUM('active', 'completed', 'discontinued');--> statement-breakpoint
CREATE TYPE "public"."supplement_route" AS ENUM('oral', 'sublingual', 'topical', 'injectable', 'other');--> statement-breakpoint
CREATE TABLE "lab_analytes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"category" "lab_analyte_category" NOT NULL,
	"unit" text NOT NULL,
	"description" text,
	"methods" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lab_analytes_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "lab_reference_ranges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"analyte_id" uuid NOT NULL,
	"sex" "reference_range_sex" DEFAULT 'any' NOT NULL,
	"age_min_years" integer,
	"age_max_years" integer,
	"condition" text,
	"min_value" numeric(12, 3),
	"max_value" numeric(12, 3),
	"notes" text,
	"source" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lab_ref_at_least_one_bound" CHECK ("lab_reference_ranges"."min_value" IS NOT NULL OR "lab_reference_ranges"."max_value" IS NOT NULL),
	CONSTRAINT "lab_ref_age_consistent" CHECK ("lab_reference_ranges"."age_min_years" IS NULL OR "lab_reference_ranges"."age_max_years" IS NULL OR "lab_reference_ranges"."age_min_years" <= "lab_reference_ranges"."age_max_years")
);
--> statement-breakpoint
CREATE TABLE "lab_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"analyte_id" uuid NOT NULL,
	"value" numeric(12, 3) NOT NULL,
	"unit" text NOT NULL,
	"collected_at" date NOT NULL,
	"laboratory" text,
	"consulta_id" uuid,
	"attachment_storage_path" text,
	"out_of_range" boolean DEFAULT false NOT NULL,
	"out_of_range_direction" "lab_result_direction",
	"reference_range_id_used" uuid,
	"notes" text,
	"entered_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lab_results_out_of_range_direction_consistent" CHECK ((out_of_range = false AND out_of_range_direction IS NULL) OR (out_of_range = true AND out_of_range_direction IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "supplement_interactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"supplement_id" uuid NOT NULL,
	"interacts_with" text NOT NULL,
	"interacts_with_normalized" text NOT NULL,
	"severity" "supplement_interaction_severity" NOT NULL,
	"description" text NOT NULL,
	"source" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplement_prescriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"supplement_id" uuid NOT NULL,
	"consulta_id" uuid,
	"professional_user_id" uuid NOT NULL,
	"dose" text NOT NULL,
	"frequency" text NOT NULL,
	"route" "supplement_route" DEFAULT 'oral' NOT NULL,
	"duration_days" integer,
	"started_at" date NOT NULL,
	"ended_at" date,
	"status" "supplement_prescription_status" DEFAULT 'active' NOT NULL,
	"notes" text,
	"discontinued_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supp_presc_duration_positive" CHECK ("supplement_prescriptions"."duration_days" IS NULL OR "supplement_prescriptions"."duration_days" > 0),
	CONSTRAINT "supp_presc_ended_after_started" CHECK ("supplement_prescriptions"."ended_at" IS NULL OR "supplement_prescriptions"."ended_at" >= "supplement_prescriptions"."started_at")
);
--> statement-breakpoint
CREATE TABLE "supplements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"name" text NOT NULL,
	"name_normalized" text NOT NULL,
	"kind" "supplement_kind" NOT NULL,
	"brand" text,
	"concentration" text,
	"anvisa_registration" text,
	"indication" text,
	"contraindications" text,
	"notes" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_by_user_id" uuid,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lab_reference_ranges" ADD CONSTRAINT "lab_reference_ranges_analyte_id_lab_analytes_id_fk" FOREIGN KEY ("analyte_id") REFERENCES "public"."lab_analytes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_results" ADD CONSTRAINT "lab_results_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_results" ADD CONSTRAINT "lab_results_analyte_id_lab_analytes_id_fk" FOREIGN KEY ("analyte_id") REFERENCES "public"."lab_analytes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_results" ADD CONSTRAINT "lab_results_consulta_id_consultas_id_fk" FOREIGN KEY ("consulta_id") REFERENCES "public"."consultas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_results" ADD CONSTRAINT "lab_results_reference_range_id_used_lab_reference_ranges_id_fk" FOREIGN KEY ("reference_range_id_used") REFERENCES "public"."lab_reference_ranges"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_results" ADD CONSTRAINT "lab_results_entered_by_user_id_users_id_fk" FOREIGN KEY ("entered_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplement_interactions" ADD CONSTRAINT "supplement_interactions_supplement_id_supplements_id_fk" FOREIGN KEY ("supplement_id") REFERENCES "public"."supplements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplement_prescriptions" ADD CONSTRAINT "supplement_prescriptions_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplement_prescriptions" ADD CONSTRAINT "supplement_prescriptions_supplement_id_supplements_id_fk" FOREIGN KEY ("supplement_id") REFERENCES "public"."supplements"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplement_prescriptions" ADD CONSTRAINT "supplement_prescriptions_consulta_id_consultas_id_fk" FOREIGN KEY ("consulta_id") REFERENCES "public"."consultas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplement_prescriptions" ADD CONSTRAINT "supplement_prescriptions_professional_user_id_users_id_fk" FOREIGN KEY ("professional_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplements" ADD CONSTRAINT "supplements_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lab_analytes_category_idx" ON "lab_analytes" USING btree ("category","active");--> statement-breakpoint
CREATE INDEX "lab_ref_analyte_idx" ON "lab_reference_ranges" USING btree ("analyte_id","sex","age_min_years");--> statement-breakpoint
CREATE INDEX "lab_results_tenant_member_idx" ON "lab_results" USING btree ("tenant_id","member_id","collected_at");--> statement-breakpoint
CREATE INDEX "lab_results_tenant_analyte_idx" ON "lab_results" USING btree ("tenant_id","analyte_id","collected_at");--> statement-breakpoint
CREATE INDEX "lab_results_out_of_range_idx" ON "lab_results" USING btree ("tenant_id","collected_at") WHERE out_of_range = true;--> statement-breakpoint
CREATE INDEX "lab_results_consulta_idx" ON "lab_results" USING btree ("consulta_id");--> statement-breakpoint
CREATE INDEX "supplement_interactions_supp_idx" ON "supplement_interactions" USING btree ("supplement_id","severity");--> statement-breakpoint
CREATE INDEX "supplement_interactions_lookup_idx" ON "supplement_interactions" USING btree ("interacts_with_normalized","supplement_id");--> statement-breakpoint
CREATE UNIQUE INDEX "supplement_interactions_uq" ON "supplement_interactions" USING btree ("tenant_id","supplement_id","interacts_with_normalized");--> statement-breakpoint
CREATE INDEX "supp_presc_tenant_member_idx" ON "supplement_prescriptions" USING btree ("tenant_id","member_id","started_at");--> statement-breakpoint
CREATE INDEX "supp_presc_active_idx" ON "supplement_prescriptions" USING btree ("tenant_id","member_id") WHERE status = 'active';--> statement-breakpoint
CREATE INDEX "supp_presc_consulta_idx" ON "supplement_prescriptions" USING btree ("consulta_id");--> statement-breakpoint
CREATE INDEX "supplements_tenant_kind_idx" ON "supplements" USING btree ("tenant_id","kind");--> statement-breakpoint
CREATE INDEX "supplements_global_idx" ON "supplements" USING btree ("kind","active") WHERE tenant_id IS NULL AND active = true AND archived_at IS NULL;--> statement-breakpoint
CREATE INDEX "supplements_name_idx" ON "supplements" USING btree ("name_normalized");--> statement-breakpoint
CREATE UNIQUE INDEX "supplements_global_name_uq" ON "supplements" USING btree ("kind","name_normalized") WHERE tenant_id IS NULL;