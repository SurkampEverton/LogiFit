CREATE TYPE "public"."ap_payment_method" AS ENUM('pix', 'ted', 'doc', 'boleto', 'cash', 'credit_card', 'manual_other');--> statement-breakpoint
CREATE TYPE "public"."ap_source" AS ENUM('manual', 'ocr_boleto', 'nfe_upload', 'nfe_manual_key', 'nfe_sefaz', 'recurring');--> statement-breakpoint
CREATE TYPE "public"."ap_status" AS ENUM('draft', 'pending_approval', 'approved', 'rejected', 'scheduled', 'paid', 'cancelled', 'reconciled');--> statement-breakpoint
CREATE TYPE "public"."approval_rule_scope" AS ENUM('ap', 'ar', 'both');--> statement-breakpoint
CREATE TYPE "public"."ar_status" AS ENUM('draft', 'issued', 'received', 'overdue', 'cancelled', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."chart_account_kind" AS ENUM('ativo', 'passivo', 'receita', 'despesa', 'custo');--> statement-breakpoint
CREATE TABLE "accounts_payable" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"unit_id" uuid,
	"supplier_id" uuid,
	"chart_account_id" uuid NOT NULL,
	"amount_cents" bigint NOT NULL,
	"tax_nature_id" uuid,
	"retention_total_cents" bigint DEFAULT 0 NOT NULL,
	"net_amount_cents" bigint NOT NULL,
	"issue_date" date NOT NULL,
	"due_date" date NOT NULL,
	"description" text,
	"doc_number" text,
	"doc_key" text,
	"nfe_received_id" uuid,
	"no_invoice" boolean DEFAULT false NOT NULL,
	"status" "ap_status" DEFAULT 'draft' NOT NULL,
	"approval_trace" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"paid_at" timestamp with time zone,
	"paid_amount_cents" bigint,
	"payment_method" "ap_payment_method",
	"asaas_transfer_id" text,
	"attachment_storage_path" text,
	"source" "ap_source" DEFAULT 'manual' NOT NULL,
	"source_metadata" jsonb,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_payable_amount_positive" CHECK ("accounts_payable"."amount_cents" > 0),
	CONSTRAINT "accounts_payable_net_consistent" CHECK ("accounts_payable"."net_amount_cents" = "accounts_payable"."amount_cents" - "accounts_payable"."retention_total_cents"),
	CONSTRAINT "accounts_payable_retention_non_negative" CHECK ("accounts_payable"."retention_total_cents" >= 0),
	CONSTRAINT "accounts_payable_due_after_issue" CHECK ("accounts_payable"."due_date" >= "accounts_payable"."issue_date")
);
--> statement-breakpoint
CREATE TABLE "accounts_receivable" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"payer_person_id" uuid,
	"chart_account_id" uuid NOT NULL,
	"amount_cents" bigint NOT NULL,
	"issue_date" date NOT NULL,
	"due_date" date NOT NULL,
	"description" text,
	"doc_number" text,
	"invoice_id" uuid,
	"asaas_charge_id" text,
	"external_url" text,
	"status" "ar_status" DEFAULT 'draft' NOT NULL,
	"received_at" timestamp with time zone,
	"received_amount_cents" bigint,
	"attachment_storage_path" text,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_receivable_amount_positive" CHECK ("accounts_receivable"."amount_cents" > 0),
	CONSTRAINT "accounts_receivable_due_after_issue" CHECK ("accounts_receivable"."due_date" >= "accounts_receivable"."issue_date")
);
--> statement-breakpoint
CREATE TABLE "ap_ar_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid NOT NULL,
	"amount_cents" bigint NOT NULL,
	"paid_at" timestamp with time zone NOT NULL,
	"method" "ap_payment_method" NOT NULL,
	"reference" text,
	"notes" text,
	"recorded_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ap_ar_payments_source_type_valid" CHECK ("ap_ar_payments"."source_type" IN ('ap', 'ar'))
);
--> statement-breakpoint
CREATE TABLE "approval_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"scope" "approval_rule_scope" NOT NULL,
	"company_id" uuid,
	"min_amount_cents" bigint NOT NULL,
	"max_amount_cents" bigint,
	"required_approvers" jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approval_rules_min_non_negative" CHECK ("approval_rules"."min_amount_cents" >= 0),
	CONSTRAINT "approval_rules_max_after_min" CHECK ("approval_rules"."max_amount_cents" IS NULL OR "approval_rules"."max_amount_cents" >= "approval_rules"."min_amount_cents")
);
--> statement-breakpoint
CREATE TABLE "chart_of_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"kind" chart_account_kind NOT NULL,
	"parent_id" uuid,
	"is_leaf" boolean DEFAULT true NOT NULL,
	"description" text,
	"active" boolean DEFAULT true NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"company_id" uuid,
	"default_payment_method" "ap_payment_method",
	"default_payment_term_days" bigint,
	"bank_account" jsonb,
	"notes" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts_payable" ADD CONSTRAINT "accounts_payable_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts_payable" ADD CONSTRAINT "accounts_payable_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts_payable" ADD CONSTRAINT "accounts_payable_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts_payable" ADD CONSTRAINT "accounts_payable_chart_account_id_chart_of_accounts_id_fk" FOREIGN KEY ("chart_account_id") REFERENCES "public"."chart_of_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts_payable" ADD CONSTRAINT "accounts_payable_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts_receivable" ADD CONSTRAINT "accounts_receivable_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts_receivable" ADD CONSTRAINT "accounts_receivable_payer_person_id_persons_id_fk" FOREIGN KEY ("payer_person_id") REFERENCES "public"."persons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts_receivable" ADD CONSTRAINT "accounts_receivable_chart_account_id_chart_of_accounts_id_fk" FOREIGN KEY ("chart_account_id") REFERENCES "public"."chart_of_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts_receivable" ADD CONSTRAINT "accounts_receivable_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ap_ar_payments" ADD CONSTRAINT "ap_ar_payments_recorded_by_user_id_users_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_rules" ADD CONSTRAINT "approval_rules_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_rules" ADD CONSTRAINT "approval_rules_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounts_payable_tenant_status_idx" ON "accounts_payable" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "accounts_payable_tenant_due_idx" ON "accounts_payable" USING btree ("tenant_id","due_date");--> statement-breakpoint
CREATE INDEX "accounts_payable_supplier_idx" ON "accounts_payable" USING btree ("supplier_id");--> statement-breakpoint
CREATE INDEX "accounts_payable_chart_idx" ON "accounts_payable" USING btree ("chart_account_id");--> statement-breakpoint
CREATE INDEX "accounts_payable_company_idx" ON "accounts_payable" USING btree ("company_id","due_date");--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_payable_doc_key_uq" ON "accounts_payable" USING btree ("doc_key") WHERE doc_key IS NOT NULL;--> statement-breakpoint
CREATE INDEX "accounts_receivable_tenant_status_idx" ON "accounts_receivable" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "accounts_receivable_tenant_due_idx" ON "accounts_receivable" USING btree ("tenant_id","due_date");--> statement-breakpoint
CREATE INDEX "accounts_receivable_chart_idx" ON "accounts_receivable" USING btree ("chart_account_id");--> statement-breakpoint
CREATE INDEX "accounts_receivable_payer_idx" ON "accounts_receivable" USING btree ("payer_person_id");--> statement-breakpoint
CREATE INDEX "ap_ar_payments_source_idx" ON "ap_ar_payments" USING btree ("source_type","source_id");--> statement-breakpoint
CREATE INDEX "ap_ar_payments_tenant_paid_idx" ON "ap_ar_payments" USING btree ("tenant_id","paid_at");--> statement-breakpoint
CREATE INDEX "approval_rules_tenant_scope_idx" ON "approval_rules" USING btree ("tenant_id","scope") WHERE active = true;--> statement-breakpoint
CREATE UNIQUE INDEX "chart_of_accounts_tenant_code_uq" ON "chart_of_accounts" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE INDEX "chart_of_accounts_tenant_kind_idx" ON "chart_of_accounts" USING btree ("tenant_id","kind");--> statement-breakpoint
CREATE INDEX "chart_of_accounts_parent_idx" ON "chart_of_accounts" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "chart_of_accounts_leaves_idx" ON "chart_of_accounts" USING btree ("tenant_id","kind") WHERE is_leaf = true AND active = true;--> statement-breakpoint
CREATE UNIQUE INDEX "suppliers_tenant_person_uq" ON "suppliers" USING btree ("tenant_id","person_id");--> statement-breakpoint
CREATE INDEX "suppliers_tenant_company_idx" ON "suppliers" USING btree ("tenant_id","company_id");--> statement-breakpoint
CREATE INDEX "suppliers_active_idx" ON "suppliers" USING btree ("tenant_id") WHERE archived_at IS NULL;