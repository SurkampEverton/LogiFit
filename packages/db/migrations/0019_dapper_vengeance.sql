CREATE TYPE "public"."message_channel" AS ENUM('whatsapp', 'email', 'sms');--> statement-breakpoint
CREATE TYPE "public"."message_status" AS ENUM('queued', 'sending', 'sent', 'delivered', 'read', 'failed');--> statement-breakpoint
CREATE TYPE "public"."message_template_approval" AS ENUM('draft', 'pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."regua_execution_state" AS ENUM('running', 'completed', 'stopped_by_rule', 'stopped_by_consent', 'failed');--> statement-breakpoint
CREATE TABLE "message_providers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"channel" "message_channel" NOT NULL,
	"provider" text NOT NULL,
	"credentials_encrypted" jsonb NOT NULL,
	"from_identifier" text NOT NULL,
	"sandbox" boolean DEFAULT true NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"channel" "message_channel" NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"subject" text,
	"body" text NOT NULL,
	"variables" text[] DEFAULT '{}'::text[] NOT NULL,
	"approval_status" "message_template_approval" DEFAULT 'draft' NOT NULL,
	"approved_at" timestamp with time zone,
	"provider_template_id" text,
	"rejection_reason" text,
	"created_by_user_id" uuid,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages_sent" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"member_id" uuid,
	"channel" "message_channel" NOT NULL,
	"provider" text NOT NULL,
	"template_id" uuid,
	"regua_execution_id" uuid,
	"status" "message_status" DEFAULT 'queued' NOT NULL,
	"sent_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"read_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"failure_reason" text,
	"provider_message_id" text,
	"cost_cents" integer,
	"variables_resolved" jsonb,
	"recipient" text NOT NULL,
	"body_rendered" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messages_sent_cost_non_negative" CHECK ("messages_sent"."cost_cents" IS NULL OR "messages_sent"."cost_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "regua_executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"regua_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"member_id" uuid,
	"trigger_event_ref" uuid,
	"trigger_payload" jsonb,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"next_action_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"state" "regua_execution_state" DEFAULT 'running' NOT NULL,
	"current_step" integer DEFAULT 0 NOT NULL,
	"failure_reason" text
);
--> statement-breakpoint
CREATE TABLE "reguas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"trigger" jsonb NOT NULL,
	"actions" jsonb NOT NULL,
	"stop_on" jsonb,
	"guards" jsonb,
	"active" boolean DEFAULT false NOT NULL,
	"created_by_user_id" uuid,
	"last_run_at" timestamp with time zone,
	"runs_count" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages_sent" ADD CONSTRAINT "messages_sent_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages_sent" ADD CONSTRAINT "messages_sent_template_id_message_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."message_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages_sent" ADD CONSTRAINT "messages_sent_regua_execution_id_regua_executions_id_fk" FOREIGN KEY ("regua_execution_id") REFERENCES "public"."regua_executions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "regua_executions" ADD CONSTRAINT "regua_executions_regua_id_reguas_id_fk" FOREIGN KEY ("regua_id") REFERENCES "public"."reguas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "regua_executions" ADD CONSTRAINT "regua_executions_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reguas" ADD CONSTRAINT "reguas_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "message_providers_tenant_channel_idx" ON "message_providers" USING btree ("tenant_id","channel");--> statement-breakpoint
CREATE INDEX "message_providers_active_idx" ON "message_providers" USING btree ("tenant_id","channel") WHERE active = true;--> statement-breakpoint
CREATE UNIQUE INDEX "message_templates_tenant_slug_uq" ON "message_templates" USING btree ("tenant_id","slug");--> statement-breakpoint
CREATE INDEX "message_templates_tenant_channel_idx" ON "message_templates" USING btree ("tenant_id","channel");--> statement-breakpoint
CREATE INDEX "message_templates_approved_idx" ON "message_templates" USING btree ("tenant_id","channel") WHERE approval_status = 'approved' AND archived_at IS NULL;--> statement-breakpoint
CREATE INDEX "messages_sent_tenant_member_idx" ON "messages_sent" USING btree ("tenant_id","member_id","created_at");--> statement-breakpoint
CREATE INDEX "messages_sent_tenant_status_idx" ON "messages_sent" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "messages_sent_provider_id_idx" ON "messages_sent" USING btree ("provider_message_id");--> statement-breakpoint
CREATE INDEX "messages_sent_regua_idx" ON "messages_sent" USING btree ("regua_execution_id");--> statement-breakpoint
CREATE INDEX "regua_executions_tenant_state_idx" ON "regua_executions" USING btree ("tenant_id","state");--> statement-breakpoint
CREATE INDEX "regua_executions_pending_idx" ON "regua_executions" USING btree ("next_action_at") WHERE state = 'running';--> statement-breakpoint
CREATE INDEX "regua_executions_member_idx" ON "regua_executions" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "reguas_tenant_active_idx" ON "reguas" USING btree ("tenant_id") WHERE active = true AND archived_at IS NULL;