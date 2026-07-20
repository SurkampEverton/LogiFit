-- packages/db/migrations/0056_usage_snapshots.sql
-- Sprint 04b — tenant_usage_snapshots (ADR 0102 + ADR 0066; débito do Sprint 04).
-- @volume_estimate_yearly: 12000 (1 row por tenant×mês — regra 34 não aplica)

CREATE TABLE "tenant_usage_snapshots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "year_month" text NOT NULL,
  "active_members_count" integer DEFAULT 0 NOT NULL,
  "fiscal_emissions_count" integer DEFAULT 0 NOT NULL,
  "ai_calls_count" integer DEFAULT 0 NOT NULL,
  "storage_bytes" bigint DEFAULT 0 NOT NULL,
  "computed_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "tus_year_month_format" CHECK (year_month ~ '^\d{4}-\d{2}$'),
  CONSTRAINT "tus_counts_non_negative" CHECK (active_members_count >= 0 AND fiscal_emissions_count >= 0 AND ai_calls_count >= 0 AND storage_bytes >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_usage_snapshots_tenant_month_uq" ON "tenant_usage_snapshots" ("tenant_id", "year_month");
--> statement-breakpoint
CREATE INDEX "tenant_usage_snapshots_month_idx" ON "tenant_usage_snapshots" ("year_month");
