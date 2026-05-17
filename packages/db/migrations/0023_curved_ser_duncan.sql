CREATE TYPE "public"."bank_account_kind" AS ENUM('checking', 'savings', 'business', 'cashbox');--> statement-breakpoint
CREATE TYPE "public"."certificate_kind" AS ENUM('a1');--> statement-breakpoint
CREATE TYPE "public"."openfinance_provider" AS ENUM('pluggy', 'belvo', 'direct');--> statement-breakpoint
CREATE TYPE "public"."openfinance_connection_status" AS ENUM('pending', 'active', 'error', 'expired', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."reconciliation_action" AS ENUM('auto_match_ap', 'auto_match_ar', 'auto_create_entry', 'flag_for_review');--> statement-breakpoint
CREATE TYPE "public"."certificate_status" AS ENUM('active', 'expired', 'revoked', 'replaced');--> statement-breakpoint
CREATE TYPE "public"."nfe_recepcao_provider" AS ENUM('arquivei', 'sieg', 'focus', 'sefaz_direct');--> statement-breakpoint
CREATE TABLE "bank_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"bank_code" text NOT NULL,
	"bank_name" text NOT NULL,
	"agency" text,
	"account_number" text NOT NULL,
	"account_digit" text,
	"kind" "bank_account_kind" DEFAULT 'business' NOT NULL,
	"opening_balance_cents" bigint DEFAULT 0 NOT NULL,
	"opening_balance_at" timestamp with time zone DEFAULT now() NOT NULL,
	"current_balance_cents" bigint DEFAULT 0 NOT NULL,
	"last_synced_at" timestamp with time zone,
	"openfinance_connection_id" uuid,
	"nickname" text,
	"active" boolean DEFAULT true NOT NULL,
	"archived_at" timestamp with time zone,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bank_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"bank_account_id" uuid NOT NULL,
	"external_id" text,
	"posted_at" timestamp with time zone NOT NULL,
	"amount_cents" bigint NOT NULL,
	"description" text NOT NULL,
	"memo" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"raw_payload" jsonb,
	"reconciled_with_ap_id" uuid,
	"reconciled_with_ar_id" uuid,
	"reconciled_at" timestamp with time zone,
	"reconciled_by_user_id" uuid,
	"reconciled_by_rule_id" uuid,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "openfinance_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"provider" "openfinance_provider" NOT NULL,
	"external_connection_id" text,
	"access_token_encrypted" text,
	"refresh_token_encrypted" text,
	"token_expires_at" timestamp with time zone,
	"status" "openfinance_connection_status" DEFAULT 'pending' NOT NULL,
	"last_synced_at" timestamp with time zone,
	"last_sync_error" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reconciliation_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"condition" jsonb NOT NULL,
	"action" "reconciliation_action" NOT NULL,
	"target_supplier_id" uuid,
	"target_chart_account_id" uuid,
	"target_company_id" uuid,
	"priority" integer DEFAULT 100 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"hits_count" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_certificates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"kind" text DEFAULT 'a1' NOT NULL,
	"subject_cn" text,
	"subject_cnpj" text,
	"issuer" text,
	"serial_number" text,
	"encrypted_pfx" "bytea" NOT NULL,
	"encrypted_password" text NOT NULL,
	"valid_from" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"status" "certificate_status" DEFAULT 'active' NOT NULL,
	"uploaded_by_user_id" uuid,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "nfe_sefaz_cursors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"provider" "nfe_recepcao_provider" NOT NULL,
	"last_nsu" text,
	"last_synced_at" timestamp with time zone,
	"last_sync_count" integer DEFAULT 0 NOT NULL,
	"last_sync_error" text,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_reconciled_with_ap_id_accounts_payable_id_fk" FOREIGN KEY ("reconciled_with_ap_id") REFERENCES "public"."accounts_payable"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_reconciled_with_ar_id_accounts_receivable_id_fk" FOREIGN KEY ("reconciled_with_ar_id") REFERENCES "public"."accounts_receivable"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_reconciled_by_user_id_users_id_fk" FOREIGN KEY ("reconciled_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "openfinance_connections" ADD CONSTRAINT "openfinance_connections_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_rules" ADD CONSTRAINT "reconciliation_rules_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_certificates" ADD CONSTRAINT "company_certificates_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_certificates" ADD CONSTRAINT "company_certificates_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nfe_sefaz_cursors" ADD CONSTRAINT "nfe_sefaz_cursors_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bank_accounts_tenant_company_idx" ON "bank_accounts" USING btree ("tenant_id","company_id") WHERE active = true;--> statement-breakpoint
CREATE UNIQUE INDEX "bank_accounts_unique_per_company_uq" ON "bank_accounts" USING btree ("company_id","bank_code","agency","account_number");--> statement-breakpoint
CREATE INDEX "bank_tx_account_posted_idx" ON "bank_transactions" USING btree ("bank_account_id","posted_at");--> statement-breakpoint
CREATE INDEX "bank_tx_tenant_unreconciled_idx" ON "bank_transactions" USING btree ("tenant_id","posted_at") WHERE reconciled_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "bank_tx_external_uq" ON "bank_transactions" USING btree ("bank_account_id","external_id") WHERE external_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "of_conn_tenant_company_idx" ON "openfinance_connections" USING btree ("tenant_id","company_id");--> statement-breakpoint
CREATE INDEX "of_conn_status_idx" ON "openfinance_connections" USING btree ("status") WHERE status IN ('active', 'error');--> statement-breakpoint
CREATE INDEX "rec_rules_tenant_priority_idx" ON "reconciliation_rules" USING btree ("tenant_id","priority") WHERE active = true;--> statement-breakpoint
CREATE UNIQUE INDEX "rec_rules_tenant_name_uq" ON "reconciliation_rules" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE INDEX "cert_company_active_idx" ON "company_certificates" USING btree ("company_id") WHERE status = 'active';--> statement-breakpoint
CREATE INDEX "cert_expiring_soon_idx" ON "company_certificates" USING btree ("expires_at") WHERE status = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "nfe_cursors_company_provider_uq" ON "nfe_sefaz_cursors" USING btree ("company_id","provider");