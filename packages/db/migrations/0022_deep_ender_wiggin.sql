CREATE TYPE "public"."allocation_rule_kind" AS ENUM('fixed', 'proportional', 'per_unit', 'by_revenue', 'by_headcount', 'custom');--> statement-breakpoint
CREATE TYPE "public"."intercompany_kind" AS ENUM('payment', 'transfer', 'service', 'goods', 'adjustment');--> statement-breakpoint
CREATE TABLE "allocation_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" "allocation_rule_kind" NOT NULL,
	"distribution" jsonb NOT NULL,
	"description" text,
	"active" boolean DEFAULT true NOT NULL,
	"archived_at" timestamp with time zone,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ap_allocations" (
	"ap_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"amount_cents" bigint NOT NULL,
	"percent_applied" numeric(7, 4) NOT NULL,
	"rule_id" uuid,
	"rule_kind" "allocation_rule_kind",
	"context_snapshot" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ap_allocations_amount_positive" CHECK ("ap_allocations"."amount_cents" > 0),
	CONSTRAINT "ap_allocations_percent_in_range" CHECK ("ap_allocations"."percent_applied" >= 0 AND "ap_allocations"."percent_applied" <= 100)
);
--> statement-breakpoint
CREATE TABLE "intercompany_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"from_company_id" uuid NOT NULL,
	"to_company_id" uuid NOT NULL,
	"amount_cents" bigint NOT NULL,
	"kind" "intercompany_kind" NOT NULL,
	"reference_ap_id" uuid,
	"reference_ar_id" uuid,
	"counter_entry_id" uuid,
	"settled_at" timestamp with time zone,
	"settlement_method" text,
	"notes" text,
	"requires_nfe_transfer" boolean DEFAULT false NOT NULL,
	"nfe_transfer_emission_id" uuid,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ic_entries_amount_positive" CHECK ("intercompany_entries"."amount_cents" > 0),
	CONSTRAINT "ic_entries_distinct_companies" CHECK ("intercompany_entries"."from_company_id" <> "intercompany_entries"."to_company_id")
);
--> statement-breakpoint
ALTER TABLE "allocation_rules" ADD CONSTRAINT "allocation_rules_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ap_allocations" ADD CONSTRAINT "ap_allocations_ap_id_accounts_payable_id_fk" FOREIGN KEY ("ap_id") REFERENCES "public"."accounts_payable"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ap_allocations" ADD CONSTRAINT "ap_allocations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ap_allocations" ADD CONSTRAINT "ap_allocations_rule_id_allocation_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."allocation_rules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intercompany_entries" ADD CONSTRAINT "intercompany_entries_from_company_id_companies_id_fk" FOREIGN KEY ("from_company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intercompany_entries" ADD CONSTRAINT "intercompany_entries_to_company_id_companies_id_fk" FOREIGN KEY ("to_company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intercompany_entries" ADD CONSTRAINT "intercompany_entries_reference_ap_id_accounts_payable_id_fk" FOREIGN KEY ("reference_ap_id") REFERENCES "public"."accounts_payable"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intercompany_entries" ADD CONSTRAINT "intercompany_entries_reference_ar_id_accounts_receivable_id_fk" FOREIGN KEY ("reference_ar_id") REFERENCES "public"."accounts_receivable"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intercompany_entries" ADD CONSTRAINT "intercompany_entries_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "allocation_rules_tenant_idx" ON "allocation_rules" USING btree ("tenant_id") WHERE active = true;--> statement-breakpoint
CREATE UNIQUE INDEX "allocation_rules_tenant_name_uq" ON "allocation_rules" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "ap_allocations_pk" ON "ap_allocations" USING btree ("ap_id","company_id");--> statement-breakpoint
CREATE INDEX "ap_allocations_tenant_idx" ON "ap_allocations" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "ap_allocations_company_idx" ON "ap_allocations" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "ic_entries_tenant_idx" ON "intercompany_entries" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "ic_entries_from_idx" ON "intercompany_entries" USING btree ("from_company_id","created_at");--> statement-breakpoint
CREATE INDEX "ic_entries_to_idx" ON "intercompany_entries" USING btree ("to_company_id","created_at");--> statement-breakpoint
CREATE INDEX "ic_entries_pair_unsettled_idx" ON "intercompany_entries" USING btree ("tenant_id","from_company_id","to_company_id") WHERE settled_at IS NULL;