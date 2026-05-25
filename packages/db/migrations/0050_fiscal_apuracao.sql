-- packages/db/migrations/0050_fiscal_apuracao.sql
-- Sprint 37a (ADR 0100 Proposed) — Apuração fiscal mensal de receita (Grupo C).
--
-- Backbone: 3 schemas + seed Anexos III+V vigentes 2026.
--
-- @volume_estimate_yearly: 12k+ (1k tenants × 1 company × 12 meses = 12k MVP).
-- Regra 34 não aplica (limite 5M/ano OU 50k/dia).

-- ─── fiscal_revenue_aggregations ─────────────────────────────────────────
CREATE TABLE "fiscal_revenue_aggregations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "company_id" uuid NOT NULL,
  "year_month" text NOT NULL,
  "tax_regime" "fiscal_tax_regime" NOT NULL,
  "receita_servicos_cents" bigint NOT NULL DEFAULT 0,
  "receita_mercadorias_cents" bigint NOT NULL DEFAULT 0,
  "receita_total_cents" bigint NOT NULL DEFAULT 0,
  "rbt12_cents" bigint,
  "aliquota_efetiva_bp" integer,
  "imposto_apurado_cents" bigint NOT NULL DEFAULT 0,
  "memorial" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "status" text NOT NULL DEFAULT 'draft',
  "computed_at" timestamp with time zone NOT NULL DEFAULT now(),
  "closed_at" timestamp with time zone,
  "closed_by_user_id" uuid,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "fiscal_revenue_agg_year_month_format"
    CHECK ("year_month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  CONSTRAINT "fiscal_revenue_agg_status_valid"
    CHECK ("status" IN ('draft', 'closed')),
  CONSTRAINT "fiscal_revenue_agg_closed_consistency"
    CHECK (status != 'closed' OR (closed_at IS NOT NULL AND closed_by_user_id IS NOT NULL)),
  CONSTRAINT "fiscal_revenue_agg_receita_nonneg"
    CHECK (receita_total_cents >= 0),
  CONSTRAINT "fiscal_revenue_agg_imposto_nonneg"
    CHECK (imposto_apurado_cents >= 0),
  CONSTRAINT "fiscal_revenue_agg_aliquota_range"
    CHECK (aliquota_efetiva_bp IS NULL OR (aliquota_efetiva_bp >= 0 AND aliquota_efetiva_bp <= 10000))
);
--> statement-breakpoint
ALTER TABLE "fiscal_revenue_aggregations"
  ADD CONSTRAINT "fiscal_revenue_agg_company_fk"
  FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict;
--> statement-breakpoint
CREATE UNIQUE INDEX "fiscal_revenue_agg_unique"
  ON "fiscal_revenue_aggregations" USING btree ("tenant_id", "company_id", "year_month");
--> statement-breakpoint
CREATE INDEX "fiscal_revenue_agg_tenant_period_idx"
  ON "fiscal_revenue_aggregations" USING btree ("tenant_id", "year_month");
--> statement-breakpoint
CREATE INDEX "fiscal_revenue_agg_status_idx"
  ON "fiscal_revenue_aggregations" USING btree ("tenant_id", "status");
--> statement-breakpoint

-- ─── fiscal_revenue_breakdown ────────────────────────────────────────────
CREATE TABLE "fiscal_revenue_breakdown" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "aggregation_id" uuid NOT NULL,
  "emission_kind" "fiscal_emission_kind" NOT NULL,
  "count" integer NOT NULL DEFAULT 0,
  "total_cents" bigint NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "fiscal_revenue_breakdown_count_nonneg" CHECK (count >= 0),
  CONSTRAINT "fiscal_revenue_breakdown_total_nonneg" CHECK (total_cents >= 0)
);
--> statement-breakpoint
ALTER TABLE "fiscal_revenue_breakdown"
  ADD CONSTRAINT "fiscal_revenue_breakdown_agg_fk"
  FOREIGN KEY ("aggregation_id") REFERENCES "public"."fiscal_revenue_aggregations"("id") ON DELETE cascade;
--> statement-breakpoint
CREATE UNIQUE INDEX "fiscal_revenue_breakdown_unique"
  ON "fiscal_revenue_breakdown" USING btree ("aggregation_id", "emission_kind");
--> statement-breakpoint
CREATE INDEX "fiscal_revenue_breakdown_agg_idx"
  ON "fiscal_revenue_breakdown" USING btree ("aggregation_id");
--> statement-breakpoint

-- ─── fiscal_simples_brackets (GLOBAL) ────────────────────────────────────
CREATE TABLE "fiscal_simples_brackets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "anexo" text NOT NULL,
  "bracket" integer NOT NULL,
  "rbt12_from_cents" bigint NOT NULL,
  "rbt12_to_cents" bigint,
  "aliquota_nominal_bp" integer NOT NULL,
  "parcela_deduzir_cents" bigint NOT NULL,
  "valid_from" date NOT NULL,
  "valid_to" date,
  CONSTRAINT "fiscal_simples_brackets_anexo_valid"
    CHECK (anexo IN ('III', 'V')),
  CONSTRAINT "fiscal_simples_brackets_bracket_range"
    CHECK (bracket >= 1 AND bracket <= 6),
  CONSTRAINT "fiscal_simples_brackets_rbt12_range"
    CHECK (rbt12_to_cents IS NULL OR rbt12_to_cents > rbt12_from_cents),
  CONSTRAINT "fiscal_simples_brackets_aliquota_range"
    CHECK (aliquota_nominal_bp > 0 AND aliquota_nominal_bp <= 10000),
  CONSTRAINT "fiscal_simples_brackets_valid_to_after_from"
    CHECK (valid_to IS NULL OR valid_to > valid_from)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "fiscal_simples_brackets_unique"
  ON "fiscal_simples_brackets" USING btree ("anexo", "bracket", "valid_from");
--> statement-breakpoint
CREATE INDEX "fiscal_simples_brackets_lookup_idx"
  ON "fiscal_simples_brackets" USING btree ("anexo", "valid_from");
--> statement-breakpoint

-- ─── Seed Anexos III + V vigentes 2026-01-01 ─────────────────────────────
-- Fontes: LC 123/2006 + LC 155/2016; tabela vigente desde 2018 (sem reajuste em 2024-2026 das faixas/alíquotas).
--
-- Anexo III (5%-19.5%): serviços comuns — academia, clínica geral, consultoria
-- Anexo V (15.5%-30.5%): serviços intelectuais quando Fator R < 28%
--
-- Fórmula efetiva: ((rbt12 × aliquota_nominal) - parcela_deduzir) / rbt12

INSERT INTO "fiscal_simples_brackets" (anexo, bracket, rbt12_from_cents, rbt12_to_cents, aliquota_nominal_bp, parcela_deduzir_cents, valid_from) VALUES
  -- Anexo III
  ('III', 1, 0,             18000000,    600,  0,           '2026-01-01'),  -- até R$ 180k
  ('III', 2, 18000000,      36000000,    1120, 998400,      '2026-01-01'),  -- R$ 180k a R$ 360k
  ('III', 3, 36000000,      72000000,    1350, 1825200,     '2026-01-01'),  -- R$ 360k a R$ 720k
  ('III', 4, 72000000,      180000000,   1600, 3625200,     '2026-01-01'),  -- R$ 720k a R$ 1.8M
  ('III', 5, 180000000,     360000000,   2100, 12345200,    '2026-01-01'),  -- R$ 1.8M a R$ 3.6M
  ('III', 6, 360000000,     480000000,   3300, 55870000,    '2026-01-01'),  -- R$ 3.6M a R$ 4.8M
  -- Anexo V
  ('V', 1, 0,               18000000,    1550, 0,           '2026-01-01'),  -- até R$ 180k
  ('V', 2, 18000000,        36000000,    1800, 450000,      '2026-01-01'),  -- R$ 180k a R$ 360k
  ('V', 3, 36000000,        72000000,    1900, 990000,      '2026-01-01'),  -- R$ 360k a R$ 720k
  ('V', 4, 72000000,        180000000,   2050, 2070000,     '2026-01-01'),  -- R$ 720k a R$ 1.8M
  ('V', 5, 180000000,       360000000,   2300, 6570000,     '2026-01-01'),  -- R$ 1.8M a R$ 3.6M
  ('V', 6, 360000000,       480000000,   3050, 33530000,    '2026-01-01'); -- R$ 3.6M a R$ 4.8M
--> statement-breakpoint

COMMENT ON TABLE "fiscal_revenue_aggregations" IS
  'Sprint 37a (ADR 0100) — apuração fiscal mensal Grupo C. Snapshot tax_regime preserva histórico. Status draft (editável) → closed (imutável via trigger).';
--> statement-breakpoint
COMMENT ON COLUMN "fiscal_revenue_aggregations"."memorial" IS
  'Array jsonb passo-a-passo do cálculo: [{ step, label, formula?, value_cents?, note? }]. Schema canônico em @repo/ai/fiscal-apuracao.';
--> statement-breakpoint
COMMENT ON TABLE "fiscal_revenue_breakdown" IS
  'Sprint 37a — quebra receita do mês por fiscal_emission_kind. Permite drill-down sem reler fiscal_emissions.';
--> statement-breakpoint
COMMENT ON TABLE "fiscal_simples_brackets" IS
  'Sprint 37a — tabela vigente Simples Nacional Anexos III+V (LC 123/2006). GLOBAL sem RLS. Atualização anual via migration data (valid_from/to).';
