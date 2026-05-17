CREATE TYPE "public"."commission_base" AS ENUM('faturado', 'recebido_particular', 'recebido_convenio', 'misto');--> statement-breakpoint
CREATE TYPE "public"."commission_contract_kind" AS ENUM('percent_faturamento', 'percent_recebido', 'fixo_por_atendimento', 'tabela_por_servico');--> statement-breakpoint
CREATE TYPE "public"."commission_entry_status" AS ENUM('pending', 'included', 'excluded', 'reversed');--> statement-breakpoint
CREATE TYPE "public"."commission_period_status" AS ENUM('draft', 'approved', 'paid', 'cancelled');--> statement-breakpoint
CREATE TABLE "commission_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"contract_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"user_id" uuid,
	"company_id" uuid NOT NULL,
	"source_event_ref" text NOT NULL,
	"reference_amount_cents" bigint NOT NULL,
	"commission_cents" bigint NOT NULL,
	"percent_applied" numeric(5, 2),
	"service_type" text,
	"tuss_code" text,
	"tax_nature_id" uuid,
	"retention_total_cents" bigint DEFAULT 0 NOT NULL,
	"net_amount_cents" bigint NOT NULL,
	"status" "commission_entry_status" DEFAULT 'pending' NOT NULL,
	"period_id" uuid,
	"earned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reversal_reason" text,
	"reversed_at" timestamp with time zone,
	"reversed_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ce_commission_positive_or_zero" CHECK (commission_cents >= 0),
	CONSTRAINT "ce_net_consistent" CHECK (net_amount_cents = commission_cents - retention_total_cents),
	CONSTRAINT "ce_reference_positive" CHECK (reference_amount_cents >= 0)
);
--> statement-breakpoint
CREATE TABLE "commission_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"user_id" uuid,
	"company_id" uuid NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"total_entries" integer DEFAULT 0 NOT NULL,
	"gross_total_cents" bigint DEFAULT 0 NOT NULL,
	"deductions_cents" bigint DEFAULT 0 NOT NULL,
	"retention_total_cents" bigint DEFAULT 0 NOT NULL,
	"net_total_cents" bigint DEFAULT 0 NOT NULL,
	"status" "commission_period_status" DEFAULT 'draft' NOT NULL,
	"approved_by_user_id" uuid,
	"approved_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"asaas_transfer_id" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cp_period_range" CHECK (period_end >= period_start),
	CONSTRAINT "cp_net_consistent" CHECK (net_total_cents = gross_total_cents - deductions_cents - retention_total_cents)
);
--> statement-breakpoint
CREATE TABLE "commission_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contract_id" uuid NOT NULL,
	"service_type" text,
	"tuss_code" text,
	"percent" numeric(5, 2),
	"amount_cents" bigint,
	"priority" integer DEFAULT 100 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cr_at_least_one" CHECK ((service_type IS NOT NULL OR tuss_code IS NOT NULL)),
	CONSTRAINT "cr_value_provided" CHECK ((percent IS NOT NULL OR amount_cents IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "professional_contracts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"user_id" uuid,
	"service_type" text NOT NULL,
	"kind" "commission_contract_kind" NOT NULL,
	"base" "commission_base" DEFAULT 'recebido_particular' NOT NULL,
	"default_percent" numeric(5, 2),
	"default_amount_cents" bigint,
	"version" integer DEFAULT 1 NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"active" boolean DEFAULT true NOT NULL,
	"metadata" jsonb,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pc_default_consistent" CHECK ((
        (kind IN ('percent_faturamento','percent_recebido') AND default_percent IS NOT NULL AND default_percent > 0 AND default_percent <= 100) OR
        (kind = 'fixo_por_atendimento' AND default_amount_cents IS NOT NULL AND default_amount_cents > 0) OR
        (kind = 'tabela_por_servico')
      )),
	CONSTRAINT "pc_effective_range" CHECK ((effective_to IS NULL OR effective_to >= effective_from))
);
--> statement-breakpoint
ALTER TABLE "commission_entries" ADD CONSTRAINT "commission_entries_contract_id_professional_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."professional_contracts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_entries" ADD CONSTRAINT "commission_entries_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_entries" ADD CONSTRAINT "commission_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_entries" ADD CONSTRAINT "commission_entries_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_entries" ADD CONSTRAINT "commission_entries_reversed_by_user_id_users_id_fk" FOREIGN KEY ("reversed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_periods" ADD CONSTRAINT "commission_periods_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_periods" ADD CONSTRAINT "commission_periods_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_periods" ADD CONSTRAINT "commission_periods_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_periods" ADD CONSTRAINT "commission_periods_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_rules" ADD CONSTRAINT "commission_rules_contract_id_professional_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."professional_contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "professional_contracts" ADD CONSTRAINT "professional_contracts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "professional_contracts" ADD CONSTRAINT "professional_contracts_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "professional_contracts" ADD CONSTRAINT "professional_contracts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "professional_contracts" ADD CONSTRAINT "professional_contracts_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ce_tenant_person_period_idx" ON "commission_entries" USING btree ("tenant_id","person_id","period_id");--> statement-breakpoint
CREATE INDEX "ce_tenant_status_idx" ON "commission_entries" USING btree ("tenant_id","status","earned_at");--> statement-breakpoint
CREATE INDEX "ce_contract_idx" ON "commission_entries" USING btree ("contract_id","earned_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ce_source_event_uq" ON "commission_entries" USING btree ("contract_id","source_event_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "cp_person_company_period_uq" ON "commission_periods" USING btree ("person_id","company_id","period_start","period_end");--> statement-breakpoint
CREATE INDEX "cp_tenant_status_idx" ON "commission_periods" USING btree ("tenant_id","status","period_start");--> statement-breakpoint
CREATE INDEX "cr_contract_priority_idx" ON "commission_rules" USING btree ("contract_id","priority") WHERE active = true;--> statement-breakpoint
CREATE INDEX "pc_tenant_person_idx" ON "professional_contracts" USING btree ("tenant_id","person_id","active");--> statement-breakpoint
CREATE INDEX "pc_tenant_company_idx" ON "professional_contracts" USING btree ("tenant_id","company_id","active");--> statement-breakpoint
CREATE UNIQUE INDEX "pc_person_company_service_version_uq" ON "professional_contracts" USING btree ("person_id","company_id","service_type","version");