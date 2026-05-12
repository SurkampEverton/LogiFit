CREATE TYPE "public"."alert_category" AS ENUM('security', 'data_leak', 'compliance', 'fiscal', 'financeiro', 'integration', 'infra', 'ai', 'clinical');--> statement-breakpoint
CREATE TYPE "public"."alert_severity" AS ENUM('info', 'warning', 'error', 'critical');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_auth_user_id" text,
	"actor_user_id" uuid,
	"actor_ip" text,
	"actor_user_agent" text,
	"action" text NOT NULL,
	"resource_type" text,
	"resource_id" text,
	"payload" jsonb,
	"current_hash" text,
	"previous_hash" text,
	"request_id" text,
	"legal_basis" text
);
--> statement-breakpoint
CREATE TABLE "system_alert_occurrences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"alert_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"request_id" text,
	"member_id" uuid,
	"payload" jsonb
);
--> statement-breakpoint
CREATE TABLE "system_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"severity" "alert_severity" NOT NULL,
	"category" "alert_category" NOT NULL,
	"fingerprint" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"occurrence_count" integer DEFAULT 1 NOT NULL,
	"acknowledged_at" timestamp with time zone,
	"acknowledged_by" uuid,
	"resolved_at" timestamp with time zone,
	"min_role" text,
	"retention_days" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "system_alert_occurrences" ADD CONSTRAINT "system_alert_occurrences_alert_id_system_alerts_id_fk" FOREIGN KEY ("alert_id") REFERENCES "public"."system_alerts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_tenant_at_idx" ON "audit_log" USING btree ("tenant_id","at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_log_tenant_actor_at_idx" ON "audit_log" USING btree ("tenant_id","actor_user_id","at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_log_tenant_resource_idx" ON "audit_log" USING btree ("tenant_id","resource_type","resource_id");--> statement-breakpoint
CREATE INDEX "system_alert_occurrences_alert_idx" ON "system_alert_occurrences" USING btree ("alert_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "system_alerts_tenant_fingerprint_uq" ON "system_alerts" USING btree ("tenant_id","fingerprint");--> statement-breakpoint
CREATE INDEX "system_alerts_tenant_severity_idx" ON "system_alerts" USING btree ("tenant_id","severity");--> statement-breakpoint
CREATE INDEX "system_alerts_tenant_lastseen_idx" ON "system_alerts" USING btree ("tenant_id","last_seen_at" DESC NULLS LAST);