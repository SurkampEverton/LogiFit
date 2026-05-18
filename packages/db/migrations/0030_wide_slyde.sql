CREATE TYPE "public"."stock_cost_method" AS ENUM('peps', 'custo_medio');--> statement-breakpoint
CREATE TYPE "public"."stock_inventory_status" AS ENUM('draft', 'finalized');--> statement-breakpoint
CREATE TYPE "public"."stock_movement_kind" AS ENUM('entry_purchase', 'entry_adjustment', 'entry_return_from_customer', 'exit_consumption', 'exit_sale', 'exit_loss', 'exit_adjustment', 'exit_return_to_supplier');--> statement-breakpoint
CREATE TABLE "stock_inventories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"counted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"counted_by_user_id" uuid NOT NULL,
	"status" "stock_inventory_status" DEFAULT 'draft' NOT NULL,
	"finalized_at" timestamp with time zone,
	"finalized_by_user_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_inventory_entries" (
	"inventory_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"system_qty" numeric(12, 3) NOT NULL,
	"physical_qty" numeric(12, 3) NOT NULL,
	"difference" numeric(12, 3) NOT NULL,
	"notes" text,
	CONSTRAINT "stock_inventory_entries_inventory_id_item_id_pk" PRIMARY KEY("inventory_id","item_id"),
	CONSTRAINT "sie_qty_non_negative" CHECK (physical_qty >= 0 AND system_qty >= 0),
	CONSTRAINT "sie_difference_consistent" CHECK (difference = physical_qty - system_qty)
);
--> statement-breakpoint
CREATE TABLE "stock_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"sku" text NOT NULL,
	"name" text NOT NULL,
	"category" text,
	"unit" text DEFAULT 'un' NOT NULL,
	"cost_cents" bigint DEFAULT 0 NOT NULL,
	"sale_price_cents" bigint,
	"min_stock" numeric(12, 3) DEFAULT '0' NOT NULL,
	"is_resale" boolean DEFAULT false NOT NULL,
	"barcode" text,
	"cost_method" "stock_cost_method" DEFAULT 'custo_medio' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"archived_at" timestamp with time zone,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "si_min_stock_positive" CHECK (min_stock >= 0),
	CONSTRAINT "si_cost_non_negative" CHECK (cost_cents >= 0)
);
--> statement-breakpoint
CREATE TABLE "stock_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"kind" "stock_movement_kind" NOT NULL,
	"quantity" numeric(12, 3) NOT NULL,
	"unit_cost_cents" bigint,
	"reference_doc" text,
	"appointment_id" uuid,
	"invoice_id" uuid,
	"inventory_id" uuid,
	"user_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sm_quantity_positive" CHECK (quantity > 0),
	CONSTRAINT "sm_unit_cost_consistent" CHECK ((kind != 'entry_purchase' OR unit_cost_cents IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "stock_inventories" ADD CONSTRAINT "stock_inventories_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_inventories" ADD CONSTRAINT "stock_inventories_counted_by_user_id_users_id_fk" FOREIGN KEY ("counted_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_inventories" ADD CONSTRAINT "stock_inventories_finalized_by_user_id_users_id_fk" FOREIGN KEY ("finalized_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_inventory_entries" ADD CONSTRAINT "stock_inventory_entries_inventory_id_stock_inventories_id_fk" FOREIGN KEY ("inventory_id") REFERENCES "public"."stock_inventories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_inventory_entries" ADD CONSTRAINT "stock_inventory_entries_item_id_stock_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."stock_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_items" ADD CONSTRAINT "stock_items_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_items" ADD CONSTRAINT "stock_items_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_item_id_stock_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."stock_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sinv_tenant_company_idx" ON "stock_inventories" USING btree ("tenant_id","company_id","counted_at");--> statement-breakpoint
CREATE INDEX "sinv_status_idx" ON "stock_inventories" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "si_tenant_company_sku_uq" ON "stock_items" USING btree ("tenant_id","company_id","sku");--> statement-breakpoint
CREATE INDEX "si_tenant_company_active_idx" ON "stock_items" USING btree ("tenant_id","company_id") WHERE active = true;--> statement-breakpoint
CREATE INDEX "si_tenant_category_idx" ON "stock_items" USING btree ("tenant_id","category");--> statement-breakpoint
CREATE INDEX "si_resale_idx" ON "stock_items" USING btree ("tenant_id","is_resale") WHERE active = true AND is_resale = true;--> statement-breakpoint
CREATE INDEX "sm_tenant_item_at_idx" ON "stock_movements" USING btree ("tenant_id","item_id","at");--> statement-breakpoint
CREATE INDEX "sm_tenant_kind_idx" ON "stock_movements" USING btree ("tenant_id","kind","at");--> statement-breakpoint
CREATE INDEX "sm_appointment_idx" ON "stock_movements" USING btree ("appointment_id") WHERE appointment_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "sm_invoice_idx" ON "stock_movements" USING btree ("invoice_id") WHERE invoice_id IS NOT NULL;