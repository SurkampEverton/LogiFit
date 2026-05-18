CREATE TYPE "public"."device_connection_status" AS ENUM('active', 'error', 'revoked', 'pending');--> statement-breakpoint
CREATE TYPE "public"."device_incident_kind" AS ENUM('oauth_failed', 'token_expired', 'rate_limited', 'provider_5xx', 'parser_failed', 'calibration_anomaly', 'duplicate_reading', 'other');--> statement-breakpoint
CREATE TYPE "public"."device_provider" AS ENUM('garmin', 'oura', 'fitbit', 'apple_health', 'google_health', 'ble_scale_omron', 'ble_scale_gtech', 'file_import', 'mock');--> statement-breakpoint
CREATE TABLE "device_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"provider" "device_provider" NOT NULL,
	"access_token_encrypted" text,
	"refresh_token_encrypted" text,
	"expires_at" timestamp with time zone,
	"external_user_id" text,
	"device_serial" text,
	"device_label" text,
	"status" "device_connection_status" DEFAULT 'pending' NOT NULL,
	"last_synced_at" timestamp with time zone,
	"last_error" text,
	"metadata" jsonb,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "device_consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"provider" "device_provider" NOT NULL,
	"purposes" text[] DEFAULT '{}'::text[] NOT NULL,
	"raw_data_access_granted" boolean DEFAULT false NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"ripd_version" text,
	"source_ip" text
);
--> statement-breakpoint
CREATE TABLE "device_incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"connection_id" uuid,
	"kind" "device_incident_kind" NOT NULL,
	"summary" text NOT NULL,
	"details" jsonb,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "device_readings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"observation_code" text NOT NULL,
	"value" numeric(12, 3) NOT NULL,
	"unit" text NOT NULL,
	"measured_at" timestamp with time zone NOT NULL,
	"source_provider" "device_provider" NOT NULL,
	"source_device_id" text,
	"quality" text,
	"metadata" jsonb,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "device_readings_value_finite" CHECK ("device_readings"."value" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "device_readings_curated" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"original_reading_id" uuid,
	"observation_code" text NOT NULL,
	"value" numeric(12, 3) NOT NULL,
	"unit" text NOT NULL,
	"measured_at" timestamp with time zone NOT NULL,
	"source_provider" "device_provider" NOT NULL,
	"source_device_id" text,
	"curated_by_user_id" uuid NOT NULL,
	"curated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"curation_notes" text,
	"value_edited" boolean DEFAULT false NOT NULL,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "device_readings_daily_summary" (
	"tenant_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"observation_code" text NOT NULL,
	"observed_date" date NOT NULL,
	"min_value" numeric(12, 3) NOT NULL,
	"max_value" numeric(12, 3) NOT NULL,
	"avg_value" numeric(12, 3) NOT NULL,
	"samples_count" numeric(7, 0) NOT NULL,
	"unit" text NOT NULL,
	"source_provider" "device_provider",
	"aggregated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "device_readings_daily_summary_tenant_id_member_id_observation_code_observed_date_pk" PRIMARY KEY("tenant_id","member_id","observation_code","observed_date"),
	CONSTRAINT "device_readings_summary_min_max" CHECK ("device_readings_daily_summary"."min_value" <= "device_readings_daily_summary"."max_value")
);
--> statement-breakpoint
CREATE TABLE "device_sync_cursors" (
	"connection_id" uuid PRIMARY KEY NOT NULL,
	"last_synced_at" timestamp with time zone,
	"cursor_payload" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "device_connections" ADD CONSTRAINT "device_connections_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_consents" ADD CONSTRAINT "device_consents_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_incidents" ADD CONSTRAINT "device_incidents_connection_id_device_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."device_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_readings" ADD CONSTRAINT "device_readings_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_readings" ADD CONSTRAINT "device_readings_connection_id_device_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."device_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_readings_curated" ADD CONSTRAINT "device_readings_curated_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_readings_curated" ADD CONSTRAINT "device_readings_curated_curated_by_user_id_users_id_fk" FOREIGN KEY ("curated_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_readings_daily_summary" ADD CONSTRAINT "device_readings_daily_summary_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_sync_cursors" ADD CONSTRAINT "device_sync_cursors_connection_id_device_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."device_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "device_conn_member_idx" ON "device_connections" USING btree ("member_id","status");--> statement-breakpoint
CREATE INDEX "device_conn_tenant_member_idx" ON "device_connections" USING btree ("tenant_id","member_id");--> statement-breakpoint
CREATE INDEX "device_conn_active_sync_idx" ON "device_connections" USING btree ("last_synced_at") WHERE status = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "device_conn_member_provider_active_uq" ON "device_connections" USING btree ("member_id","provider") WHERE status IN ('active', 'pending');--> statement-breakpoint
CREATE UNIQUE INDEX "device_consents_active_uq" ON "device_consents" USING btree ("member_id","provider") WHERE revoked_at IS NULL;--> statement-breakpoint
CREATE INDEX "device_consents_member_idx" ON "device_consents" USING btree ("member_id","granted_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "device_incidents_tenant_at_idx" ON "device_incidents" USING btree ("tenant_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "device_incidents_connection_idx" ON "device_incidents" USING btree ("connection_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "device_incidents_open_idx" ON "device_incidents" USING btree ("tenant_id","occurred_at" DESC NULLS LAST) WHERE resolved_at IS NULL;--> statement-breakpoint
CREATE INDEX "device_readings_member_code_idx" ON "device_readings" USING btree ("member_id","observation_code","measured_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "device_readings_tenant_at_idx" ON "device_readings" USING btree ("tenant_id","measured_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "device_readings_dedup_uq" ON "device_readings" USING btree ("connection_id","observation_code","measured_at");--> statement-breakpoint
CREATE INDEX "device_readings_curated_member_idx" ON "device_readings_curated" USING btree ("member_id","measured_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "device_readings_curated_tenant_idx" ON "device_readings_curated" USING btree ("tenant_id","curated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "device_readings_curated_original_idx" ON "device_readings_curated" USING btree ("original_reading_id");--> statement-breakpoint
CREATE INDEX "device_readings_summary_member_code_idx" ON "device_readings_daily_summary" USING btree ("member_id","observation_code","observed_date" DESC NULLS LAST);