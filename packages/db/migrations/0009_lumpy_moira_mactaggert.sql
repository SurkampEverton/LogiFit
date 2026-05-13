CREATE TYPE "public"."billing_cycle" AS ENUM('monthly', 'quarterly', 'yearly');--> statement-breakpoint
CREATE TYPE "public"."contract_status" AS ENUM('active', 'paused', 'cancelled', 'expired');--> statement-breakpoint
CREATE TYPE "public"."invoice_status" AS ENUM('pending', 'paid', 'overdue', 'cancelled', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('boleto', 'pix', 'credit_card');--> statement-breakpoint
CREATE TABLE "asaas_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" uuid,
	"api_key" text NOT NULL,
	"sandbox" boolean DEFAULT true NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contracts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"status" "contract_status" DEFAULT 'active' NOT NULL,
	"billing_day" integer DEFAULT 10 NOT NULL,
	"pause_reason" text,
	"pause_starts_at" timestamp with time zone,
	"pause_ends_at" timestamp with time zone,
	"auto_pause_rule" jsonb,
	"cancelled_at" timestamp with time zone,
	"cancelled_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contracts_billing_day_range" CHECK ("contracts"."billing_day" BETWEEN 1 AND 28)
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"contract_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"status" "invoice_status" DEFAULT 'pending' NOT NULL,
	"asaas_id" text,
	"external_url" text,
	"breakdown" jsonb,
	"paid_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_amount_non_negative" CHECK ("invoices"."amount_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"method" "payment_method" NOT NULL,
	"paid_at" timestamp with time zone NOT NULL,
	"asaas_id" text NOT NULL,
	"raw_payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"price_cents" integer NOT NULL,
	"billing_cycle" "billing_cycle" DEFAULT 'monthly' NOT NULL,
	"trial_days" integer DEFAULT 0 NOT NULL,
	"cancel_notice_days" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plans_price_non_negative" CHECK ("plans"."price_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"external_id" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"payload" jsonb NOT NULL,
	"error" text,
	"tenant_id" uuid
);
--> statement-breakpoint
ALTER TABLE "asaas_keys" ADD CONSTRAINT "asaas_keys_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "asaas_keys_tenant_company_active_uq" ON "asaas_keys" USING btree ("tenant_id","company_id") WHERE active = true;--> statement-breakpoint
CREATE INDEX "asaas_keys_tenant_idx" ON "asaas_keys" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "contracts_tenant_member_idx" ON "contracts" USING btree ("tenant_id","member_id");--> statement-breakpoint
CREATE INDEX "contracts_tenant_plan_idx" ON "contracts" USING btree ("tenant_id","plan_id");--> statement-breakpoint
CREATE INDEX "contracts_active_idx" ON "contracts" USING btree ("tenant_id","company_id") WHERE status = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_asaas_id_uq" ON "invoices" USING btree ("asaas_id") WHERE asaas_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "invoices_tenant_status_idx" ON "invoices" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "invoices_tenant_contract_idx" ON "invoices" USING btree ("tenant_id","contract_id");--> statement-breakpoint
CREATE INDEX "invoices_tenant_due_idx" ON "invoices" USING btree ("tenant_id","due_at");--> statement-breakpoint
CREATE INDEX "invoices_member_idx" ON "invoices" USING btree ("tenant_id","member_id","due_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_asaas_id_uq" ON "payments" USING btree ("asaas_id");--> statement-breakpoint
CREATE INDEX "payments_tenant_invoice_idx" ON "payments" USING btree ("tenant_id","invoice_id");--> statement-breakpoint
CREATE INDEX "payments_tenant_paid_idx" ON "payments" USING btree ("tenant_id","paid_at");--> statement-breakpoint
CREATE INDEX "plans_tenant_company_idx" ON "plans" USING btree ("tenant_id","company_id");--> statement-breakpoint
CREATE INDEX "plans_active_idx" ON "plans" USING btree ("tenant_id","company_id") WHERE active = true AND archived_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_events_source_external_uq" ON "webhook_events" USING btree ("source","external_id");--> statement-breakpoint
CREATE INDEX "webhook_events_received_idx" ON "webhook_events" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX "webhook_events_unprocessed_idx" ON "webhook_events" USING btree ("source","received_at") WHERE processed_at IS NULL;