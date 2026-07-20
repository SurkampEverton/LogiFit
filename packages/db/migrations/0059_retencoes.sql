-- packages/db/migrations/0059_retencoes.sql
-- Sprint 15b — Retenções tributárias (ADR 0061 Grupos B e G; débito #5).
-- Seed das 10 naturezas globais curadas (tenant_id NULL) espelhando
-- GLOBAL_TAX_NATURES de @repo/ai/fiscal/retencoes/tables.ts.
-- @volume_estimate_yearly: 600000

CREATE TYPE "tax_kind" AS ENUM ('pis', 'cofins', 'csll', 'irrf', 'inss', 'iss');
--> statement-breakpoint
CREATE TYPE "tax_guide_status" AS ENUM ('pending', 'paid', 'reconciled');
--> statement-breakpoint
CREATE TABLE "tax_natures" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid,
  "code" text NOT NULL,
  "label" text NOT NULL,
  "applies_to" text DEFAULT 'ap' NOT NULL,
  "rules" jsonb NOT NULL,
  "regulatory_reference" text,
  "active" boolean DEFAULT true NOT NULL,
  "archived_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "tax_natures_applies_to_valid" CHECK (applies_to IN ('ap','professional_contract','both'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "tax_natures_global_code_uq" ON "tax_natures" ("code") WHERE tenant_id IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "tax_natures_tenant_code_uq" ON "tax_natures" ("tenant_id", "code") WHERE tenant_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "tax_natures_tenant_idx" ON "tax_natures" ("tenant_id") WHERE active = true;
--> statement-breakpoint
CREATE TABLE "tax_retentions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "source_type" text NOT NULL,
  "source_id" uuid NOT NULL,
  "tax_nature_id" uuid,
  "tax" "tax_kind" NOT NULL,
  "base_cents" bigint NOT NULL,
  "rate_applied_percent" numeric(7,4) NOT NULL,
  "amount_cents" bigint NOT NULL,
  "should_withhold" boolean DEFAULT true NOT NULL,
  "guide_status" "tax_guide_status" DEFAULT 'pending' NOT NULL,
  "guide_reference" text,
  "paid_at" timestamp with time zone,
  "year_month" text NOT NULL,
  "calculated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "tax_retentions_tax_nature_id_tax_natures_id_fk" FOREIGN KEY ("tax_nature_id") REFERENCES "tax_natures"("id") ON DELETE restrict,
  CONSTRAINT "tax_retentions_source_type_valid" CHECK (source_type IN ('ap','commission_entry')),
  CONSTRAINT "tax_retentions_amounts_non_negative" CHECK (base_cents >= 0 AND amount_cents >= 0),
  CONSTRAINT "tax_retentions_year_month_format" CHECK (year_month ~ '^\d{4}-\d{2}$'),
  CONSTRAINT "tax_retentions_paid_consistency" CHECK ((guide_status = 'pending') = (paid_at IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "tax_retentions_source_tax_uq" ON "tax_retentions" ("source_type", "source_id", "tax");
--> statement-breakpoint
CREATE INDEX "tax_retentions_tenant_month_idx" ON "tax_retentions" ("tenant_id", "year_month");
--> statement-breakpoint
CREATE INDEX "tax_retentions_tenant_tax_idx" ON "tax_retentions" ("tenant_id", "tax", "year_month");
--> statement-breakpoint
CREATE INDEX "tax_retentions_pending_idx" ON "tax_retentions" ("tenant_id", "guide_status") WHERE guide_status = 'pending';
--> statement-breakpoint
-- ─── Seed das 10 naturezas globais (ADR 0061) ──────────────────────────
INSERT INTO "tax_natures" ("tenant_id", "code", "label", "applies_to", "rules", "regulatory_reference") VALUES
  (NULL, 'servico_prestado_pj_geral', 'Serviço prestado por PJ (geral)', 'ap',
   '[{"tax":"pis","kind":"fixed","rateBp":65,"minBaseCents":1000},{"tax":"cofins","kind":"fixed","rateBp":300,"minBaseCents":1000},{"tax":"csll","kind":"fixed","rateBp":100,"minBaseCents":1000},{"tax":"irrf","kind":"fixed","rateBp":150,"minBaseCents":1000}]'::jsonb,
   'Lei 10.833/2003 art. 30-31 + Lei 9.430/1996 art. 64'),
  (NULL, 'servico_prestado_pj_saude', 'Serviço de saúde prestado por PJ', 'ap',
   '[{"tax":"pis","kind":"fixed","rateBp":65,"minBaseCents":1000},{"tax":"cofins","kind":"fixed","rateBp":300,"minBaseCents":1000},{"tax":"csll","kind":"fixed","rateBp":100,"minBaseCents":1000},{"tax":"irrf","kind":"fixed","rateBp":150,"minBaseCents":1000}]'::jsonb,
   'Lei 10.833/2003 + IN RFB 1.234/2012 (verificar não-cumulatividade)'),
  (NULL, 'autonomo_rpa_pf', 'Autônomo PF (RPA)', 'both',
   '[{"tax":"inss","kind":"capped","rateBp":1100,"maxBaseCents":812000},{"tax":"irrf","kind":"progressive","brackets":[{"upToCents":225920,"rateBp":0,"deductionCents":0},{"upToCents":282665,"rateBp":750,"deductionCents":16944},{"upToCents":375105,"rateBp":1500,"deductionCents":38144},{"upToCents":466468,"rateBp":2250,"deductionCents":66277},{"upToCents":null,"rateBp":2750,"deductionCents":89600}]}]'::jsonb,
   'Lei 8.212/1991 (INSS 11%) + Tabela IRRF RFB + LC 116/2003 (ISS)'),
  (NULL, 'aluguel_pj', 'Aluguel pago a PJ', 'ap',
   '[{"tax":"pis","kind":"fixed","rateBp":65,"minBaseCents":1000},{"tax":"cofins","kind":"fixed","rateBp":300,"minBaseCents":1000},{"tax":"csll","kind":"fixed","rateBp":100,"minBaseCents":1000},{"tax":"irrf","kind":"fixed","rateBp":150,"minBaseCents":1000}]'::jsonb,
   'Lei 10.833/2003 art. 30 + Lei 9.430/1996'),
  (NULL, 'aluguel_pf', 'Aluguel pago a PF', 'ap',
   '[{"tax":"irrf","kind":"progressive","brackets":[{"upToCents":225920,"rateBp":0,"deductionCents":0},{"upToCents":282665,"rateBp":750,"deductionCents":16944},{"upToCents":375105,"rateBp":1500,"deductionCents":38144},{"upToCents":466468,"rateBp":2250,"deductionCents":66277},{"upToCents":null,"rateBp":2750,"deductionCents":89600}]}]'::jsonb,
   'Tabela IRRF RFB (RIR/2018 art. 688)'),
  (NULL, 'software_saas_pj', 'Software / SaaS (PJ)', 'ap',
   '[{"tax":"pis","kind":"fixed","rateBp":65,"minBaseCents":1000},{"tax":"cofins","kind":"fixed","rateBp":300,"minBaseCents":1000},{"tax":"csll","kind":"fixed","rateBp":100,"minBaseCents":1000},{"tax":"irrf","kind":"fixed","rateBp":150,"minBaseCents":1000}]'::jsonb,
   'Lei 10.833/2003 + LC 116/2003 item 1.05 (ISS condicional)'),
  (NULL, 'comissao_autonomo_pf', 'Comissão a autônomo PF', 'professional_contract',
   '[{"tax":"inss","kind":"capped","rateBp":1100,"maxBaseCents":812000},{"tax":"irrf","kind":"progressive","brackets":[{"upToCents":225920,"rateBp":0,"deductionCents":0},{"upToCents":282665,"rateBp":750,"deductionCents":16944},{"upToCents":375105,"rateBp":1500,"deductionCents":38144},{"upToCents":466468,"rateBp":2250,"deductionCents":66277},{"upToCents":null,"rateBp":2750,"deductionCents":89600}]}]'::jsonb,
   'Lei 8.212/1991 + Tabela IRRF RFB'),
  (NULL, 'servico_transporte_pj', 'Transporte prestado por PJ', 'ap',
   '[{"tax":"pis","kind":"fixed","rateBp":65,"minBaseCents":1000},{"tax":"cofins","kind":"fixed","rateBp":300,"minBaseCents":1000},{"tax":"csll","kind":"fixed","rateBp":100,"minBaseCents":1000},{"tax":"irrf","kind":"fixed","rateBp":100,"minBaseCents":1000}]'::jsonb,
   'Lei 10.833/2003 + Lei 9.430/1996 art. 64 (IRRF 1%)'),
  (NULL, 'utilidade_publica', 'Utilidade pública (água/luz/telefone)', 'ap', '[]'::jsonb,
   'IN RFB 1.234/2012 art. 4 (concessionária dispensada)'),
  (NULL, 'simples_nacional_prestador', 'Prestador optante do Simples Nacional', 'both', '[]'::jsonb,
   'LC 123/2006 art. 13 §3 (dispensa retenção federal)')
ON CONFLICT DO NOTHING;
