CREATE TYPE "public"."lead_source" AS ENUM('website', 'instagram', 'referral', 'walk_in', 'panfleto', 'gympass', 'totalpass', 'outdoor', 'other');--> statement-breakpoint
CREATE TYPE "public"."lead_stage_kind" AS ENUM('open', 'won', 'lost');--> statement-breakpoint
CREATE TYPE "public"."proposal_status" AS ENUM('draft', 'sent', 'accepted', 'rejected', 'expired', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."trial_outcome" AS ENUM('booked', 'attended', 'no_show', 'cancelled');--> statement-breakpoint
CREATE TABLE "tenant_assistant_settings" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"assistant_name" text DEFAULT 'Copilot' NOT NULL,
	"default_persona" text DEFAULT 'admin' NOT NULL,
	"enabled_personas" jsonb DEFAULT '["member","admin","recepcao","professional_clinical","professional_coach"]'::jsonb NOT NULL,
	"classifier_strictness" text DEFAULT 'strict' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"from_stage_id" uuid,
	"to_stage_id" uuid,
	"payload" text,
	"actor_user_id" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_stages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"order_idx" integer NOT NULL,
	"kind" "lead_stage_kind" DEFAULT 'open' NOT NULL,
	"color" text,
	"requires_person" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"unit_id" uuid,
	"person_id" uuid,
	"quick_name" text,
	"quick_phone" text,
	"quick_email" text,
	"assigned_to_user_id" uuid,
	"stage_id" uuid NOT NULL,
	"source" "lead_source" DEFAULT 'other' NOT NULL,
	"source_ref" uuid,
	"interest" text,
	"notes" text,
	"converted_to_member_id" uuid,
	"lost_reason" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leads_min_contact_or_person" CHECK (person_id IS NOT NULL OR quick_name IS NOT NULL OR quick_phone IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"plan_id" uuid,
	"bundle_plan_id" uuid,
	"price_cents" integer NOT NULL,
	"discount_cents" integer DEFAULT 0 NOT NULL,
	"valid_until" timestamp with time zone NOT NULL,
	"status" "proposal_status" DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"sent_at" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"rejected_at" timestamp with time zone,
	"rejection_reason" text,
	"converted_contract_id" uuid,
	"notes" text,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "proposals_price_non_negative" CHECK ("proposals"."price_cents" >= 0),
	CONSTRAINT "proposals_discount_non_negative" CHECK ("proposals"."discount_cents" >= 0),
	CONSTRAINT "proposals_discount_lt_price" CHECK ("proposals"."discount_cents" < "proposals"."price_cents"),
	CONSTRAINT "proposals_one_plan_xor_bundle" CHECK ((plan_id IS NOT NULL)::int + (bundle_plan_id IS NOT NULL)::int <= 1)
);
--> statement-breakpoint
CREATE TABLE "trial_classes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"appointment_id" uuid NOT NULL,
	"outcome" "trial_outcome" DEFAULT 'booked' NOT NULL,
	"attended_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancellation_reason" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lead_events" ADD CONSTRAINT "lead_events_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_events" ADD CONSTRAINT "lead_events_from_stage_id_lead_stages_id_fk" FOREIGN KEY ("from_stage_id") REFERENCES "public"."lead_stages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_events" ADD CONSTRAINT "lead_events_to_stage_id_lead_stages_id_fk" FOREIGN KEY ("to_stage_id") REFERENCES "public"."lead_stages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_events" ADD CONSTRAINT "lead_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_assigned_to_user_id_users_id_fk" FOREIGN KEY ("assigned_to_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_stage_id_lead_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."lead_stages"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_converted_to_member_id_members_id_fk" FOREIGN KEY ("converted_to_member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_bundle_plan_id_plans_id_fk" FOREIGN KEY ("bundle_plan_id") REFERENCES "public"."plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_converted_contract_id_contracts_id_fk" FOREIGN KEY ("converted_contract_id") REFERENCES "public"."contracts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trial_classes" ADD CONSTRAINT "trial_classes_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lead_events_lead_at_idx" ON "lead_events" USING btree ("lead_id","at");--> statement-breakpoint
CREATE INDEX "lead_events_tenant_kind_idx" ON "lead_events" USING btree ("tenant_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "lead_stages_tenant_slug_uq" ON "lead_stages" USING btree ("tenant_id","slug");--> statement-breakpoint
CREATE INDEX "lead_stages_tenant_order_idx" ON "lead_stages" USING btree ("tenant_id","order_idx") WHERE active = true;--> statement-breakpoint
CREATE INDEX "leads_tenant_stage_idx" ON "leads" USING btree ("tenant_id","stage_id");--> statement-breakpoint
CREATE INDEX "leads_tenant_assigned_idx" ON "leads" USING btree ("tenant_id","assigned_to_user_id");--> statement-breakpoint
CREATE INDEX "leads_active_idx" ON "leads" USING btree ("tenant_id") WHERE archived_at IS NULL;--> statement-breakpoint
CREATE INDEX "leads_person_idx" ON "leads" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "proposals_tenant_lead_idx" ON "proposals" USING btree ("tenant_id","lead_id");--> statement-breakpoint
CREATE INDEX "proposals_tenant_status_idx" ON "proposals" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "proposals_active_idx" ON "proposals" USING btree ("tenant_id","lead_id") WHERE status IN ('draft', 'sent');--> statement-breakpoint
CREATE UNIQUE INDEX "trial_classes_appointment_uq" ON "trial_classes" USING btree ("appointment_id");--> statement-breakpoint
CREATE INDEX "trial_classes_tenant_lead_idx" ON "trial_classes" USING btree ("tenant_id","lead_id");