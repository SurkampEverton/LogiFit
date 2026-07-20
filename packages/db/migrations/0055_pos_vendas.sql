-- packages/db/migrations/0055_pos_vendas.sql
-- Sprint 24b — Vendas POS (ADR 0101; débito de schema do Sprint 24).
-- @volume_estimate_yearly: 200000 (regra 34 não aplica — sem particionamento)

CREATE TYPE "sale_status" AS ENUM ('completed', 'cancelled');
--> statement-breakpoint
CREATE TYPE "sale_payment_method" AS ENUM ('dinheiro', 'pix', 'credito', 'debito', 'outro');
--> statement-breakpoint
CREATE TABLE "sales" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "company_id" uuid NOT NULL,
  "unit_id" uuid,
  "member_id" uuid,
  "person_id" uuid,
  "status" "sale_status" DEFAULT 'completed' NOT NULL,
  "total_cents" bigint NOT NULL,
  "discount_cents" bigint DEFAULT 0 NOT NULL,
  "sold_by_user_id" uuid,
  "sold_at" timestamp with time zone DEFAULT now() NOT NULL,
  "notes" text,
  "cancelled_at" timestamp with time zone,
  "cancel_reason" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "sales_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE restrict,
  CONSTRAINT "sales_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE set null,
  CONSTRAINT "sales_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE set null,
  CONSTRAINT "sales_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "persons"("id") ON DELETE set null,
  CONSTRAINT "sales_sold_by_user_id_users_id_fk" FOREIGN KEY ("sold_by_user_id") REFERENCES "users"("id"),
  CONSTRAINT "sales_total_non_negative" CHECK (total_cents >= 0),
  CONSTRAINT "sales_discount_non_negative" CHECK (discount_cents >= 0),
  CONSTRAINT "sales_buyer_exclusive" CHECK (NOT (member_id IS NOT NULL AND person_id IS NOT NULL)),
  CONSTRAINT "sales_cancelled_consistency" CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX "sales_tenant_sold_at_idx" ON "sales" ("tenant_id", "sold_at");
--> statement-breakpoint
CREATE INDEX "sales_tenant_company_idx" ON "sales" ("tenant_id", "company_id");
--> statement-breakpoint
CREATE INDEX "sales_member_idx" ON "sales" ("tenant_id", "member_id") WHERE member_id IS NOT NULL;
--> statement-breakpoint
CREATE TABLE "sale_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "sale_id" uuid NOT NULL,
  "stock_item_id" uuid NOT NULL,
  "sku" text NOT NULL,
  "description" text NOT NULL,
  "ncm" text,
  "cest_code" text,
  "quantity" numeric(12,3) NOT NULL,
  "unit_cents" bigint NOT NULL,
  "total_cents" bigint NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "sale_items_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE cascade,
  CONSTRAINT "sale_items_stock_item_id_stock_items_id_fk" FOREIGN KEY ("stock_item_id") REFERENCES "stock_items"("id") ON DELETE restrict,
  CONSTRAINT "sale_items_quantity_positive" CHECK (quantity > 0),
  CONSTRAINT "sale_items_unit_non_negative" CHECK (unit_cents >= 0),
  CONSTRAINT "sale_items_total_non_negative" CHECK (total_cents >= 0)
);
--> statement-breakpoint
CREATE INDEX "sale_items_sale_idx" ON "sale_items" ("sale_id");
--> statement-breakpoint
CREATE INDEX "sale_items_tenant_stock_item_idx" ON "sale_items" ("tenant_id", "stock_item_id");
--> statement-breakpoint
CREATE TABLE "sale_payments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "sale_id" uuid NOT NULL,
  "method" "sale_payment_method" NOT NULL,
  "amount_cents" bigint NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "sale_payments_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE cascade,
  CONSTRAINT "sale_payments_amount_positive" CHECK (amount_cents > 0)
);
--> statement-breakpoint
CREATE INDEX "sale_payments_sale_idx" ON "sale_payments" ("sale_id");
--> statement-breakpoint
ALTER TABLE "stock_items" ADD COLUMN IF NOT EXISTS "ncm" text;
--> statement-breakpoint
ALTER TABLE "stock_items" ADD COLUMN IF NOT EXISTS "cest_code" text;
