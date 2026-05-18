CREATE TYPE "public"."fiscal_emission_kind" AS ENUM('nfse', 'nfe', 'nfce', 'nfe_return', 'nfe_transfer', 'nfe_conserto_out', 'nfe_conserto_return', 'nfe_self_entry');--> statement-breakpoint
CREATE TYPE "public"."fiscal_emission_status" AS ENUM('draft', 'queued', 'processing', 'completed', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."fiscal_event_kind" AS ENUM('cancellation', 'cce', 'inutilizacao');--> statement-breakpoint
CREATE TYPE "public"."fiscal_provider_env" AS ENUM('homologacao', 'producao');--> statement-breakpoint
CREATE TYPE "public"."fiscal_tax_regime" AS ENUM('simples_nacional', 'lucro_presumido', 'lucro_real', 'mei');--> statement-breakpoint
CREATE TABLE "fiscal_emissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"kind" "fiscal_emission_kind" NOT NULL,
	"status" "fiscal_emission_status" DEFAULT 'draft' NOT NULL,
	"provider" text DEFAULT 'focus_nfe' NOT NULL,
	"source_kind" text,
	"source_id" uuid,
	"serie" integer NOT NULL,
	"numero" bigint NOT NULL,
	"chave" text,
	"provider_ref" text,
	"valor_total_cents" bigint NOT NULL,
	"recipient_person_id" uuid,
	"recipient_name" text,
	"recipient_document" text,
	"payload" jsonb NOT NULL,
	"xml_storage_path" text,
	"pdf_storage_path" text,
	"rejection_reason" text,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"cancel_deadline_at" timestamp with time zone,
	"submitted_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" uuid,
	CONSTRAINT "fiscal_emissions_provider_valid" CHECK (provider IN ('focus_nfe', 'mock', 'nfse_nacional', 'enotas')),
	CONSTRAINT "fiscal_emissions_completed_consistency" CHECK ((status != 'completed' OR (chave IS NOT NULL AND completed_at IS NOT NULL))),
	CONSTRAINT "fiscal_emissions_rejected_consistency" CHECK ((status != 'rejected' OR rejection_reason IS NOT NULL)),
	CONSTRAINT "fiscal_emissions_cancelled_consistency" CHECK ((status != 'cancelled' OR cancelled_at IS NOT NULL)),
	CONSTRAINT "fiscal_emissions_numero_positive" CHECK (numero > 0),
	CONSTRAINT "fiscal_emissions_serie_positive" CHECK (serie > 0),
	CONSTRAINT "fiscal_emissions_retry_nonneg" CHECK (retry_count >= 0)
);
--> statement-breakpoint
CREATE TABLE "fiscal_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"emission_id" uuid,
	"kind" "fiscal_event_kind" NOT NULL,
	"provider_ref" text,
	"company_id" uuid,
	"emission_kind" "fiscal_emission_kind",
	"serie" integer,
	"numero_from" bigint,
	"numero_to" bigint,
	"justification" text NOT NULL,
	"status" "fiscal_emission_status" DEFAULT 'draft' NOT NULL,
	"rejection_reason" text,
	"payload" jsonb NOT NULL,
	"xml_storage_path" text,
	"submitted_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" uuid,
	CONSTRAINT "fiscal_events_emission_or_inutilizacao" CHECK ((kind = 'inutilizacao' AND emission_id IS NULL AND numero_from IS NOT NULL AND numero_to IS NOT NULL)
       OR (kind IN ('cancellation', 'cce') AND emission_id IS NOT NULL)),
	CONSTRAINT "fiscal_events_inutilizacao_range" CHECK ((kind != 'inutilizacao' OR numero_from <= numero_to)),
	CONSTRAINT "fiscal_events_rejected_consistency" CHECK ((status != 'rejected' OR rejection_reason IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "fiscal_numbering_sequences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"kind" "fiscal_emission_kind" NOT NULL,
	"serie" integer NOT NULL,
	"next_numero" bigint DEFAULT 1 NOT NULL,
	"last_used_numero" bigint,
	"environment" "fiscal_provider_env" DEFAULT 'homologacao' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fiscal_numbering_sequences_next_positive" CHECK (next_numero >= 1),
	CONSTRAINT "fiscal_numbering_sequences_serie_positive" CHECK (serie >= 1 AND serie <= 999)
);
--> statement-breakpoint
CREATE TABLE "fiscal_provider_credentials" (
	"tenant_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"api_token_encrypted" text NOT NULL,
	"api_token_nonce" text NOT NULL,
	"api_token_tag" text NOT NULL,
	"environment" "fiscal_provider_env" NOT NULL,
	"base_url" text,
	"webhook_secret_encrypted" text,
	"webhook_secret_nonce" text,
	"webhook_secret_tag" text,
	"last_validated_at" timestamp with time zone,
	"last_validation_status" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fiscal_provider_credentials_provider_valid" CHECK (provider IN ('focus_nfe', 'mock', 'nfse_nacional', 'enotas'))
);
--> statement-breakpoint
CREATE TABLE "fiscal_service_catalog" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"municipality_code" text NOT NULL,
	"lc116_code" text,
	"nbs_code" text,
	"cnae" text,
	"description" text NOT NULL,
	"tax_regime" "fiscal_tax_regime" NOT NULL,
	"iss_rate_bp" integer NOT NULL,
	"pis_rate_bp" integer,
	"cofins_rate_bp" integer,
	"retention_rules" jsonb,
	"active" boolean DEFAULT true NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fiscal_service_catalog_iss_range" CHECK (iss_rate_bp >= 0 AND iss_rate_bp <= 500)
);
--> statement-breakpoint
ALTER TABLE "fiscal_emissions" ADD CONSTRAINT "fiscal_emissions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_events" ADD CONSTRAINT "fiscal_events_emission_id_fiscal_emissions_id_fk" FOREIGN KEY ("emission_id") REFERENCES "public"."fiscal_emissions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_events" ADD CONSTRAINT "fiscal_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_numbering_sequences" ADD CONSTRAINT "fiscal_numbering_sequences_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_service_catalog" ADD CONSTRAINT "fiscal_service_catalog_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fiscal_emissions_chave_uq" ON "fiscal_emissions" USING btree ("tenant_id","kind","chave") WHERE chave IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "fiscal_emissions_numeracao_uq" ON "fiscal_emissions" USING btree ("company_id","kind","serie","numero");--> statement-breakpoint
CREATE INDEX "fiscal_emissions_tenant_status_idx" ON "fiscal_emissions" USING btree ("tenant_id","status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "fiscal_emissions_provider_ref_uq" ON "fiscal_emissions" USING btree ("tenant_id","provider","provider_ref") WHERE provider_ref IS NOT NULL;--> statement-breakpoint
CREATE INDEX "fiscal_emissions_source_idx" ON "fiscal_emissions" USING btree ("tenant_id","source_kind","source_id");--> statement-breakpoint
CREATE INDEX "fiscal_emissions_retry_idx" ON "fiscal_emissions" USING btree ("tenant_id","created_at" DESC NULLS LAST) WHERE status = 'rejected' AND retry_count < 3;--> statement-breakpoint
CREATE INDEX "fiscal_events_tenant_idx" ON "fiscal_events" USING btree ("tenant_id","status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "fiscal_events_emission_idx" ON "fiscal_events" USING btree ("emission_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "fiscal_events_provider_ref_uq" ON "fiscal_events" USING btree ("tenant_id","provider_ref") WHERE provider_ref IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "fiscal_numbering_sequences_uq" ON "fiscal_numbering_sequences" USING btree ("company_id","kind","serie","environment");--> statement-breakpoint
CREATE UNIQUE INDEX "fiscal_provider_credentials_pk" ON "fiscal_provider_credentials" USING btree ("tenant_id","provider");--> statement-breakpoint
CREATE INDEX "fiscal_service_catalog_tenant_idx" ON "fiscal_service_catalog" USING btree ("tenant_id","company_id");--> statement-breakpoint
CREATE INDEX "fiscal_service_catalog_active_idx" ON "fiscal_service_catalog" USING btree ("tenant_id","company_id") WHERE active = true;