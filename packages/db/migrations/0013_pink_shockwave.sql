CREATE TYPE "public"."access_auth_mode" AS ENUM('qr', 'facial', 'manual');--> statement-breakpoint
CREATE TYPE "public"."access_block_kind" AS ENUM('manual', 'overdue', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."access_event_kind" AS ENUM('checkin', 'checkout', 'denied_overdue', 'denied_block', 'denied_invalid_token', 'denied_no_face_match', 'denied_no_consent', 'manual');--> statement-breakpoint
CREATE TABLE "access_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"kind" "access_block_kind" NOT NULL,
	"reason" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"resolved_reason" text,
	"source_invoice_id" uuid,
	"source_contract_id" uuid,
	"created_by_user_id" uuid,
	CONSTRAINT "access_blocks_resolved_consistency" CHECK ((resolved_at IS NULL AND resolved_reason IS NULL) OR (resolved_at IS NOT NULL AND resolved_reason IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "access_devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"unit_id" uuid,
	"label" text NOT NULL,
	"token_hash" text NOT NULL,
	"auth_modes" jsonb NOT NULL,
	"hardware_type" text,
	"last_heartbeat" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "access_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"device_id" uuid,
	"member_id" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" "access_event_kind" NOT NULL,
	"auth_mode" "access_auth_mode" NOT NULL,
	"appointment_id" uuid,
	"raw" jsonb
);
--> statement-breakpoint
CREATE TABLE "access_secrets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"secret" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"rotated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "access_blocks" ADD CONSTRAINT "access_blocks_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_devices" ADD CONSTRAINT "access_devices_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_devices" ADD CONSTRAINT "access_devices_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_events" ADD CONSTRAINT "access_events_device_id_access_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."access_devices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_events" ADD CONSTRAINT "access_events_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "access_blocks_tenant_member_idx" ON "access_blocks" USING btree ("tenant_id","member_id");--> statement-breakpoint
CREATE INDEX "access_blocks_active_idx" ON "access_blocks" USING btree ("tenant_id","member_id") WHERE resolved_at IS NULL;--> statement-breakpoint
CREATE INDEX "access_devices_tenant_unit_idx" ON "access_devices" USING btree ("tenant_id","unit_id");--> statement-breakpoint
CREATE INDEX "access_devices_active_idx" ON "access_devices" USING btree ("tenant_id","company_id") WHERE revoked_at IS NULL;--> statement-breakpoint
CREATE INDEX "access_events_tenant_at_idx" ON "access_events" USING btree ("tenant_id","at");--> statement-breakpoint
CREATE INDEX "access_events_member_at_idx" ON "access_events" USING btree ("member_id","at");--> statement-breakpoint
CREATE INDEX "access_events_device_at_idx" ON "access_events" USING btree ("device_id","at");--> statement-breakpoint
CREATE INDEX "access_events_denied_idx" ON "access_events" USING btree ("tenant_id","at") WHERE kind IN ('denied_overdue', 'denied_block', 'denied_invalid_token', 'denied_no_face_match', 'denied_no_consent');--> statement-breakpoint
CREATE INDEX "access_secrets_tenant_active_idx" ON "access_secrets" USING btree ("tenant_id") WHERE active = true;