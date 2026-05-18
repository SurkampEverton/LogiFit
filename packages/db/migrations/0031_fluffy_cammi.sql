CREATE TYPE "public"."equipment_kind" AS ENUM('ultrassom', 'tens', 'laser', 'crioterapia', 'eletroestimulacao', 'esteira', 'bicicleta', 'balanca_bioimpedancia', 'pressao_arterial', 'glicosimetro', 'oximetro', 'outro');--> statement-breakpoint
CREATE TYPE "public"."equipment_status" AS ENUM('active', 'maintenance', 'decommissioned');--> statement-breakpoint
CREATE TYPE "public"."maintenance_kind" AS ENUM('preventive', 'calibration', 'corrective');--> statement-breakpoint
CREATE TYPE "public"."maintenance_status" AS ENUM('scheduled', 'in_transit_to_external', 'at_external', 'returning', 'completed', 'overdue', 'cancelled');--> statement-breakpoint
CREATE TABLE "cleaning_checklists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"unit_id" uuid,
	"name" text NOT NULL,
	"items" jsonb NOT NULL,
	"frequency_days" integer DEFAULT 1 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cc_frequency_positive" CHECK (frequency_days > 0)
);
--> statement-breakpoint
CREATE TABLE "cleaning_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"unit_id" uuid,
	"checklist_id" uuid NOT NULL,
	"performed_by_user_id" uuid NOT NULL,
	"performed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"items_done" jsonb NOT NULL,
	"completion_pct" integer,
	"is_complete" boolean DEFAULT false NOT NULL,
	"observations" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cl_completion_pct_range" CHECK ((completion_pct IS NULL OR (completion_pct >= 0 AND completion_pct <= 100)))
);
--> statement-breakpoint
CREATE TABLE "equipment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"unit_id" uuid,
	"kind" "equipment_kind" NOT NULL,
	"manufacturer" text NOT NULL,
	"model" text NOT NULL,
	"serial_number" text NOT NULL,
	"anvisa_registration" text,
	"acquired_at" date NOT NULL,
	"warranty_until" date,
	"status" "equipment_status" DEFAULT 'active' NOT NULL,
	"maintenance_interval_days" integer,
	"calibration_interval_days" integer,
	"last_maintenance_at" date,
	"last_calibration_at" date,
	"notes" text,
	"decommissioned_at" timestamp with time zone,
	"decommissioned_reason" text,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "eq_intervals_positive" CHECK ((maintenance_interval_days IS NULL OR maintenance_interval_days > 0)
       AND (calibration_interval_days IS NULL OR calibration_interval_days > 0))
);
--> statement-breakpoint
CREATE TABLE "equipment_maintenance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"equipment_id" uuid NOT NULL,
	"kind" "maintenance_kind" NOT NULL,
	"planned_for" date NOT NULL,
	"performed_at" date,
	"performed_by" text,
	"certificate_storage_path" text,
	"certificate_content_hash" text,
	"cost_cents" bigint,
	"observations" text,
	"status" "maintenance_status" DEFAULT 'scheduled' NOT NULL,
	"external_location" boolean DEFAULT false NOT NULL,
	"external_supplier_id" uuid,
	"nfe_shipping_emission_id" uuid,
	"nfe_return_emission_id" uuid,
	"external_departed_at" timestamp with time zone,
	"external_returned_at" timestamp with time zone,
	"created_by_user_id" uuid,
	"completed_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "em_completed_consistent" CHECK ((status != 'completed' OR performed_at IS NOT NULL)),
	CONSTRAINT "em_external_consistent" CHECK ((external_location = false OR external_supplier_id IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "equipment_usage_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"equipment_id" uuid NOT NULL,
	"appointment_id" uuid,
	"consulta_id" uuid,
	"evolucao_id" uuid,
	"used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"used_by_user_id" uuid NOT NULL,
	"duration_minutes" integer,
	"parameters" jsonb,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "eul_duration_positive" CHECK ((duration_minutes IS NULL OR duration_minutes > 0))
);
--> statement-breakpoint
ALTER TABLE "cleaning_checklists" ADD CONSTRAINT "cleaning_checklists_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cleaning_checklists" ADD CONSTRAINT "cleaning_checklists_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cleaning_logs" ADD CONSTRAINT "cleaning_logs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cleaning_logs" ADD CONSTRAINT "cleaning_logs_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cleaning_logs" ADD CONSTRAINT "cleaning_logs_checklist_id_cleaning_checklists_id_fk" FOREIGN KEY ("checklist_id") REFERENCES "public"."cleaning_checklists"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cleaning_logs" ADD CONSTRAINT "cleaning_logs_performed_by_user_id_users_id_fk" FOREIGN KEY ("performed_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_maintenance" ADD CONSTRAINT "equipment_maintenance_equipment_id_equipment_id_fk" FOREIGN KEY ("equipment_id") REFERENCES "public"."equipment"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_maintenance" ADD CONSTRAINT "equipment_maintenance_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_maintenance" ADD CONSTRAINT "equipment_maintenance_completed_by_user_id_users_id_fk" FOREIGN KEY ("completed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_usage_log" ADD CONSTRAINT "equipment_usage_log_equipment_id_equipment_id_fk" FOREIGN KEY ("equipment_id") REFERENCES "public"."equipment"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_usage_log" ADD CONSTRAINT "equipment_usage_log_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_usage_log" ADD CONSTRAINT "equipment_usage_log_used_by_user_id_users_id_fk" FOREIGN KEY ("used_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cc_tenant_company_idx" ON "cleaning_checklists" USING btree ("tenant_id","company_id") WHERE active = true;--> statement-breakpoint
CREATE INDEX "cl_checklist_performed_idx" ON "cleaning_logs" USING btree ("checklist_id","performed_at");--> statement-breakpoint
CREATE INDEX "cl_tenant_company_idx" ON "cleaning_logs" USING btree ("tenant_id","company_id","performed_at");--> statement-breakpoint
CREATE INDEX "cl_complete_idx" ON "cleaning_logs" USING btree ("tenant_id","is_complete");--> statement-breakpoint
CREATE UNIQUE INDEX "eq_serial_global_uq" ON "equipment" USING btree ("manufacturer","serial_number");--> statement-breakpoint
CREATE INDEX "eq_tenant_company_idx" ON "equipment" USING btree ("tenant_id","company_id") WHERE status != 'decommissioned';--> statement-breakpoint
CREATE INDEX "eq_tenant_status_idx" ON "equipment" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "eq_kind_idx" ON "equipment" USING btree ("tenant_id","kind");--> statement-breakpoint
CREATE INDEX "em_equipment_planned_idx" ON "equipment_maintenance" USING btree ("equipment_id","planned_for");--> statement-breakpoint
CREATE INDEX "em_tenant_status_idx" ON "equipment_maintenance" USING btree ("tenant_id","status","planned_for");--> statement-breakpoint
CREATE INDEX "em_overdue_idx" ON "equipment_maintenance" USING btree ("planned_for") WHERE status IN ('scheduled', 'overdue');--> statement-breakpoint
CREATE INDEX "eul_equipment_idx" ON "equipment_usage_log" USING btree ("equipment_id","used_at");--> statement-breakpoint
CREATE INDEX "eul_tenant_used_at_idx" ON "equipment_usage_log" USING btree ("tenant_id","used_at");--> statement-breakpoint
CREATE INDEX "eul_appointment_idx" ON "equipment_usage_log" USING btree ("appointment_id") WHERE appointment_id IS NOT NULL;