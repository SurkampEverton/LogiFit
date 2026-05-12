CREATE TYPE "public"."passport_link_status" AS ENUM('active', 'revoked', 'pending');--> statement-breakpoint
CREATE TYPE "public"."passport_module" AS ENUM('academia', 'personal_training', 'fisioterapia', 'nutricao', 'pilates');--> statement-breakpoint
CREATE TYPE "public"."passport_module_status" AS ENUM('active', 'inactive', 'pending');--> statement-breakpoint
CREATE TABLE "patient_company_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"passport_passport_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"status" "passport_link_status" DEFAULT 'pending' NOT NULL,
	"creation_path" text NOT NULL,
	"invited_by_user_id" uuid,
	"invited_at" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "patient_data_access_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reader_user_id" uuid NOT NULL,
	"reader_tenant_id" uuid NOT NULL,
	"source_tenant_id" uuid NOT NULL,
	"patient_person_id" uuid NOT NULL,
	"passport_passport_id" uuid NOT NULL,
	"module_type" "passport_module" NOT NULL,
	"category" text NOT NULL,
	"resource_type" text,
	"resource_id" uuid,
	"request_id" uuid NOT NULL,
	"ip" text,
	"user_agent" text
);
--> statement-breakpoint
CREATE TABLE "patient_link_modules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"link_id" uuid NOT NULL,
	"passport_passport_id" uuid NOT NULL,
	"module" "passport_module" NOT NULL,
	"status" "passport_module_status" DEFAULT 'pending' NOT NULL,
	"responsible_professional_user_id" uuid,
	"responsible_registration_id" uuid,
	"data_levels" jsonb,
	"activated_at" timestamp with time zone,
	"deactivated_at" timestamp with time zone,
	"deactivated_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "patient_company_links" ADD CONSTRAINT "patient_company_links_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_company_links" ADD CONSTRAINT "patient_company_links_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_company_links" ADD CONSTRAINT "patient_company_links_invited_by_user_id_users_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_link_modules" ADD CONSTRAINT "patient_link_modules_link_id_patient_company_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."patient_company_links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_link_modules" ADD CONSTRAINT "patient_link_modules_responsible_professional_user_id_users_id_fk" FOREIGN KEY ("responsible_professional_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "patient_company_links_passport_tenant_uq" ON "patient_company_links" USING btree ("passport_passport_id","tenant_id") WHERE "patient_company_links"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "patient_company_links_passport_idx" ON "patient_company_links" USING btree ("passport_passport_id");--> statement-breakpoint
CREATE INDEX "patient_company_links_tenant_idx" ON "patient_company_links" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "patient_company_links_person_idx" ON "patient_company_links" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "patient_data_access_log_reader_tenant_at_idx" ON "patient_data_access_log" USING btree ("reader_tenant_id","recorded_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "patient_data_access_log_source_tenant_at_idx" ON "patient_data_access_log" USING btree ("source_tenant_id","recorded_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "patient_data_access_log_patient_at_idx" ON "patient_data_access_log" USING btree ("patient_person_id","recorded_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "patient_data_access_log_passport_at_idx" ON "patient_data_access_log" USING btree ("passport_passport_id","recorded_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "patient_link_modules_global_active_uq" ON "patient_link_modules" USING btree ("passport_passport_id","module") WHERE "patient_link_modules"."deactivated_at" IS NULL;--> statement-breakpoint
CREATE INDEX "patient_link_modules_link_idx" ON "patient_link_modules" USING btree ("link_id");--> statement-breakpoint
CREATE INDEX "patient_link_modules_passport_idx" ON "patient_link_modules" USING btree ("passport_passport_id");