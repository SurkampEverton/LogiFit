-- packages/db/migrations/0061_nfe_returns.sql
-- Sprint 17b — Devolução de compra (ADR 0104 + ADR 0058; débito #2, o último).
-- Desacoplado da inbox: original_chave digitada em vez de FK pra nfe_received.
-- @volume_estimate_yearly: 30000

CREATE TYPE "nfe_return_kind" AS ENUM ('total', 'partial');
--> statement-breakpoint
CREATE TYPE "nfe_return_reason" AS ENUM ('defeito', 'divergencia_quantidade', 'divergencia_especificacao', 'atraso', 'cancelamento', 'outro');
--> statement-breakpoint
CREATE TYPE "nfe_return_status" AS ENUM ('draft', 'emitted', 'cancelled');
--> statement-breakpoint
CREATE TABLE "nfe_returns" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "company_id" uuid NOT NULL,
  "original_chave" text NOT NULL,
  "nfe_received_id" uuid,
  "original_supplier_name" text,
  "original_supplier_document" text,
  "kind" "nfe_return_kind" NOT NULL,
  "items" jsonb,
  "return_amount_cents" bigint NOT NULL,
  "reason_category" "nfe_return_reason" NOT NULL,
  "reason_description" text NOT NULL,
  "status" "nfe_return_status" DEFAULT 'draft' NOT NULL,
  "external_chave" text,
  "external_xml_storage_path" text,
  "external_issue_date" date,
  "emitted_at" timestamp with time zone,
  "emission_mode" text,
  "fiscal_emission_id" uuid,
  "created_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "nfe_returns_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE restrict,
  CONSTRAINT "nfe_returns_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE set null,
  CONSTRAINT "nfe_returns_chave_44" CHECK (original_chave ~ '^[0-9]{44}$'),
  CONSTRAINT "nfe_returns_amount_positive" CHECK (return_amount_cents > 0),
  CONSTRAINT "nfe_returns_reason_min" CHECK (length(reason_description) >= 20),
  CONSTRAINT "nfe_returns_partial_needs_items" CHECK (kind = 'total' OR items IS NOT NULL),
  CONSTRAINT "nfe_returns_emitted_consistency" CHECK ((status = 'emitted') = (emitted_at IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX "nfe_returns_tenant_status_idx" ON "nfe_returns" ("tenant_id", "status");
--> statement-breakpoint
CREATE INDEX "nfe_returns_tenant_company_idx" ON "nfe_returns" ("tenant_id", "company_id");
--> statement-breakpoint
CREATE INDEX "nfe_returns_original_chave_idx" ON "nfe_returns" ("original_chave");
