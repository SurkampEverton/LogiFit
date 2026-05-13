CREATE TYPE "public"."appointment_status" AS ENUM('booked', 'checked_in', 'cancelled', 'no_show', 'completed');--> statement-breakpoint
CREATE TYPE "public"."resource_kind" AS ENUM('instrutor', 'sala', 'equipamento');--> statement-breakpoint
CREATE TABLE "appointment_waitlist" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"recurring_slot_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"member_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "appointments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"resource_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"recurring_slot_id" uuid,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" "appointment_status" DEFAULT 'booked' NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancelled_reason" text,
	"cancelled_by_user_id" uuid,
	"checked_in_at" timestamp with time zone,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recurring_slots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"resource_id" uuid NOT NULL,
	"rrule" text NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"capacity" integer DEFAULT 1 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"unit_id" uuid,
	"kind" "resource_kind" NOT NULL,
	"name" text NOT NULL,
	"modality" text,
	"instructor_user_id" uuid,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "appointment_waitlist" ADD CONSTRAINT "appointment_waitlist_recurring_slot_id_recurring_slots_id_fk" FOREIGN KEY ("recurring_slot_id") REFERENCES "public"."recurring_slots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_waitlist" ADD CONSTRAINT "appointment_waitlist_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_recurring_slot_id_recurring_slots_id_fk" FOREIGN KEY ("recurring_slot_id") REFERENCES "public"."recurring_slots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_cancelled_by_user_id_users_id_fk" FOREIGN KEY ("cancelled_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_slots" ADD CONSTRAINT "recurring_slots_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resources" ADD CONSTRAINT "resources_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resources" ADD CONSTRAINT "resources_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resources" ADD CONSTRAINT "resources_instructor_user_id_users_id_fk" FOREIGN KEY ("instructor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "appointment_waitlist_uq" ON "appointment_waitlist" USING btree ("recurring_slot_id","starts_at","member_id");--> statement-breakpoint
CREATE INDEX "appointment_waitlist_slot_starts_idx" ON "appointment_waitlist" USING btree ("recurring_slot_id","starts_at","created_at");--> statement-breakpoint
CREATE INDEX "appointment_waitlist_tenant_member_idx" ON "appointment_waitlist" USING btree ("tenant_id","member_id");--> statement-breakpoint
CREATE INDEX "appointments_tenant_starts_idx" ON "appointments" USING btree ("tenant_id","starts_at");--> statement-breakpoint
CREATE INDEX "appointments_tenant_member_starts_idx" ON "appointments" USING btree ("tenant_id","member_id","starts_at");--> statement-breakpoint
CREATE INDEX "appointments_resource_starts_idx" ON "appointments" USING btree ("resource_id","starts_at");--> statement-breakpoint
CREATE INDEX "appointments_status_idx" ON "appointments" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "recurring_slots_resource_idx" ON "recurring_slots" USING btree ("resource_id");--> statement-breakpoint
CREATE INDEX "recurring_slots_tenant_active_idx" ON "recurring_slots" USING btree ("tenant_id") WHERE active = true;--> statement-breakpoint
CREATE INDEX "resources_tenant_company_idx" ON "resources" USING btree ("tenant_id","company_id");--> statement-breakpoint
CREATE INDEX "resources_tenant_kind_idx" ON "resources" USING btree ("tenant_id","kind");--> statement-breakpoint
CREATE INDEX "resources_instructor_idx" ON "resources" USING btree ("instructor_user_id");--> statement-breakpoint
CREATE INDEX "resources_active_idx" ON "resources" USING btree ("tenant_id","company_id") WHERE archived_at IS NULL;