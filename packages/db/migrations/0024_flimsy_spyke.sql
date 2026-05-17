CREATE TYPE "public"."acquirer_connection_status" AS ENUM('pending', 'active', 'error', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."acquirer_provider" AS ENUM('cielo', 'stone', 'rede', 'getnet', 'pagseguro', 'mock');--> statement-breakpoint
CREATE TYPE "public"."acquirer_reconcile_action" AS ENUM('auto_match_bank', 'flag_for_review');--> statement-breakpoint
CREATE TYPE "public"."acquirer_sale_status" AS ENUM('captured', 'anticipated', 'settled', 'chargeback', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."anticipation_status" AS ENUM('requested', 'approved', 'credited', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."acquirer_card_kind" AS ENUM('credit', 'debit', 'voucher', 'pix', 'other');--> statement-breakpoint
CREATE TABLE "acquirer_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"provider" "acquirer_provider" NOT NULL,
	"merchant_id" text NOT NULL,
	"credentials_encrypted" text,
	"nickname" text,
	"settlement_bank_account_id" uuid,
	"sandbox" boolean DEFAULT false NOT NULL,
	"status" "acquirer_connection_status" DEFAULT 'pending' NOT NULL,
	"last_synced_at" timestamp with time zone,
	"last_sync_error" text,
	"metadata" jsonb,
	"active" boolean DEFAULT true NOT NULL,
	"archived_at" timestamp with time zone,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "acquirer_reconciliation_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"condition" jsonb NOT NULL,
	"action" "acquirer_reconcile_action" DEFAULT 'auto_match_bank' NOT NULL,
	"target_bank_account_id" uuid,
	"priority" integer DEFAULT 100 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"hits_count" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "acquirer_sales" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"gross_amount_cents" bigint NOT NULL,
	"fee_cents" bigint DEFAULT 0 NOT NULL,
	"net_amount_cents" bigint NOT NULL,
	"anticipated_amount_cents" bigint,
	"card_brand" text,
	"card_kind" "acquirer_card_kind" DEFAULT 'credit' NOT NULL,
	"installments" integer DEFAULT 1 NOT NULL,
	"expected_settlement_date" text NOT NULL,
	"actual_settlement_date" text,
	"reconciled_with_bank_tx_id" uuid,
	"reconciled_at" timestamp with time zone,
	"reconciled_by_user_id" uuid,
	"status" "acquirer_sale_status" DEFAULT 'captured' NOT NULL,
	"raw_payload" jsonb,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "acq_sales_net_consistent" CHECK (net_amount_cents = gross_amount_cents - fee_cents),
	CONSTRAINT "acq_sales_installments_valid" CHECK (installments >= 1 AND installments <= 24),
	CONSTRAINT "acq_sales_amounts_positive" CHECK (gross_amount_cents > 0)
);
--> statement-breakpoint
CREATE TABLE "anticipations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"sales_ids" uuid[] NOT NULL,
	"original_amount_cents" bigint NOT NULL,
	"anticipated_amount_cents" bigint,
	"fee_cents" bigint DEFAULT 0 NOT NULL,
	"effective_rate_pct" text,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_at" timestamp with time zone,
	"credited_at" timestamp with time zone,
	"rejected_at" timestamp with time zone,
	"rejection_reason" text,
	"status" "anticipation_status" DEFAULT 'requested' NOT NULL,
	"external_id" text,
	"raw_payload" jsonb,
	"requested_by_user_id" uuid,
	CONSTRAINT "antic_amounts_positive" CHECK (original_amount_cents > 0)
);
--> statement-breakpoint
ALTER TABLE "acquirer_connections" ADD CONSTRAINT "acquirer_connections_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acquirer_connections" ADD CONSTRAINT "acquirer_connections_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acquirer_reconciliation_rules" ADD CONSTRAINT "acquirer_reconciliation_rules_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acquirer_sales" ADD CONSTRAINT "acquirer_sales_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acquirer_sales" ADD CONSTRAINT "acquirer_sales_connection_id_acquirer_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."acquirer_connections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acquirer_sales" ADD CONSTRAINT "acquirer_sales_reconciled_with_bank_tx_id_bank_transactions_id_fk" FOREIGN KEY ("reconciled_with_bank_tx_id") REFERENCES "public"."bank_transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acquirer_sales" ADD CONSTRAINT "acquirer_sales_reconciled_by_user_id_users_id_fk" FOREIGN KEY ("reconciled_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anticipations" ADD CONSTRAINT "anticipations_connection_id_acquirer_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."acquirer_connections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anticipations" ADD CONSTRAINT "anticipations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anticipations" ADD CONSTRAINT "anticipations_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "acq_conn_tenant_company_idx" ON "acquirer_connections" USING btree ("tenant_id","company_id") WHERE active = true;--> statement-breakpoint
CREATE INDEX "acq_conn_status_idx" ON "acquirer_connections" USING btree ("status") WHERE status IN ('active', 'error');--> statement-breakpoint
CREATE UNIQUE INDEX "acq_conn_merchant_uq" ON "acquirer_connections" USING btree ("provider","merchant_id");--> statement-breakpoint
CREATE INDEX "acq_rules_tenant_priority_idx" ON "acquirer_reconciliation_rules" USING btree ("tenant_id","priority") WHERE active = true;--> statement-breakpoint
CREATE UNIQUE INDEX "acq_rules_tenant_name_uq" ON "acquirer_reconciliation_rules" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "acq_sales_external_uq" ON "acquirer_sales" USING btree ("connection_id","external_id");--> statement-breakpoint
CREATE INDEX "acq_sales_company_captured_idx" ON "acquirer_sales" USING btree ("company_id","captured_at");--> statement-breakpoint
CREATE INDEX "acq_sales_settlement_idx" ON "acquirer_sales" USING btree ("expected_settlement_date") WHERE actual_settlement_date IS NULL;--> statement-breakpoint
CREATE INDEX "acq_sales_tenant_unreconciled_idx" ON "acquirer_sales" USING btree ("tenant_id","captured_at") WHERE reconciled_at IS NULL AND status IN ('settled', 'anticipated');--> statement-breakpoint
CREATE INDEX "antic_tenant_status_idx" ON "anticipations" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "antic_connection_idx" ON "anticipations" USING btree ("connection_id");