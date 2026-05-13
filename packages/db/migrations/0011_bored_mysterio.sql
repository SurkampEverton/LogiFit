CREATE TYPE "public"."ai_task" AS ENUM('chat', 'embedding', 'classification', 'extraction', 'vision', 'transcription', 'reasoning');--> statement-breakpoint
CREATE TYPE "public"."assistant_layer" AS ENUM('help', 'insight', 'action');--> statement-breakpoint
CREATE TYPE "public"."assistant_persona" AS ENUM('member', 'professional_clinical', 'professional_coach', 'admin', 'recepcao', 'super_admin', 'contador_externo', 'dpo');--> statement-breakpoint
CREATE TYPE "public"."proposal_state" AS ENUM('pending', 'confirmed', 'cancelled', 'expired', 'failed');--> statement-breakpoint
CREATE TABLE "ai_audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid,
	"session_id" uuid,
	"task" "ai_task" NOT NULL,
	"model_slug" text NOT NULL,
	"provider_slug" text NOT NULL,
	"persona" "assistant_persona",
	"layer" "assistant_layer",
	"prompt_hash" text,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost_micros" integer DEFAULT 0 NOT NULL,
	"latency_ms" integer,
	"cache_hit" boolean DEFAULT false NOT NULL,
	"fallback_used" boolean DEFAULT false NOT NULL,
	"guardrail_blocked" boolean DEFAULT false NOT NULL,
	"action_proposal_id" uuid,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_models" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"capabilities" jsonb NOT NULL,
	"deprecated" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_provider_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"provider_id" uuid NOT NULL,
	"api_key_encrypted" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_tested_at" timestamp with time zone,
	"last_test_result" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_providers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"api_base_url" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_providers_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "ai_task_routing" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task" "ai_task" NOT NULL,
	"model_id" uuid NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"scope" text DEFAULT 'global' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_tenant_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"month_bucket" text NOT NULL,
	"calls_count" integer DEFAULT 0 NOT NULL,
	"tokens_input" integer DEFAULT 0 NOT NULL,
	"tokens_output" integer DEFAULT 0 NOT NULL,
	"cost_micros" integer DEFAULT 0 NOT NULL,
	"cache_hits" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assistant_action_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"tool_key" text NOT NULL,
	"args" jsonb NOT NULL,
	"confirmation_copy" jsonb NOT NULL,
	"state" "proposal_state" DEFAULT 'pending' NOT NULL,
	"confirmed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"execution_result" jsonb,
	"execution_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assistant_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"tool_calls" jsonb,
	"tool_results" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assistant_messages_role_valid" CHECK ("assistant_messages"."role" IN ('user', 'assistant', 'tool', 'system'))
);
--> statement-breakpoint
CREATE TABLE "assistant_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"member_id" uuid,
	"title" text DEFAULT 'Nova conversa' NOT NULL,
	"persona" "assistant_persona" NOT NULL,
	"context_path" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tools_registry" (
	"key" text PRIMARY KEY NOT NULL,
	"module" text NOT NULL,
	"label" text NOT NULL,
	"description" text NOT NULL,
	"layer" "assistant_layer" NOT NULL,
	"show_in_personas" jsonb NOT NULL,
	"required_permissions" jsonb NOT NULL,
	"args_schema" jsonb NOT NULL,
	"result_schema" jsonb NOT NULL,
	"requires_confirmation" boolean DEFAULT false NOT NULL,
	"rate_limit_key" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_audit_log" ADD CONSTRAINT "ai_audit_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_models" ADD CONSTRAINT "ai_models_provider_id_ai_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."ai_providers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_provider_configs" ADD CONSTRAINT "ai_provider_configs_provider_id_ai_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."ai_providers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_task_routing" ADD CONSTRAINT "ai_task_routing_model_id_ai_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."ai_models"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_action_proposals" ADD CONSTRAINT "assistant_action_proposals_session_id_assistant_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."assistant_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_action_proposals" ADD CONSTRAINT "assistant_action_proposals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_messages" ADD CONSTRAINT "assistant_messages_session_id_assistant_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."assistant_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_sessions" ADD CONSTRAINT "assistant_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_sessions" ADD CONSTRAINT "assistant_sessions_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_audit_log_tenant_created_idx" ON "ai_audit_log" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_audit_log_session_idx" ON "ai_audit_log" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "ai_audit_log_user_idx" ON "ai_audit_log" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_audit_log_guardrail_idx" ON "ai_audit_log" USING btree ("tenant_id","created_at") WHERE guardrail_blocked = true;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_models_provider_slug_uq" ON "ai_models" USING btree ("provider_id","slug");--> statement-breakpoint
CREATE INDEX "ai_models_active_idx" ON "ai_models" USING btree ("provider_id") WHERE deprecated = false;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_provider_configs_tenant_provider_uq" ON "ai_provider_configs" USING btree ("tenant_id","provider_id");--> statement-breakpoint
CREATE INDEX "ai_task_routing_task_idx" ON "ai_task_routing" USING btree ("task","priority") WHERE active = true;--> statement-breakpoint
CREATE INDEX "ai_task_routing_scope_idx" ON "ai_task_routing" USING btree ("scope") WHERE active = true;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_tenant_usage_tenant_month_uq" ON "ai_tenant_usage" USING btree ("tenant_id","month_bucket");--> statement-breakpoint
CREATE INDEX "action_proposals_tenant_user_idx" ON "assistant_action_proposals" USING btree ("tenant_id","user_id","created_at");--> statement-breakpoint
CREATE INDEX "action_proposals_pending_idx" ON "assistant_action_proposals" USING btree ("tenant_id") WHERE state = 'pending';--> statement-breakpoint
CREATE INDEX "assistant_messages_session_idx" ON "assistant_messages" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE INDEX "assistant_messages_tenant_created_idx" ON "assistant_messages" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "assistant_sessions_tenant_user_idx" ON "assistant_sessions" USING btree ("tenant_id","user_id","updated_at");--> statement-breakpoint
CREATE INDEX "assistant_sessions_active_idx" ON "assistant_sessions" USING btree ("tenant_id","user_id") WHERE archived_at IS NULL;--> statement-breakpoint
CREATE INDEX "tools_registry_module_idx" ON "tools_registry" USING btree ("module") WHERE active = true;--> statement-breakpoint
CREATE INDEX "tools_registry_layer_idx" ON "tools_registry" USING btree ("layer") WHERE active = true;