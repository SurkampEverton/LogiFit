CREATE TYPE "public"."cost_category_type" AS ENUM('fixed', 'variable');--> statement-breakpoint
CREATE TABLE "cost_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"type" "cost_category_type" NOT NULL,
	"icon" text,
	"description" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cost_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"incurred_at" date NOT NULL,
	"description" text,
	"attachment_storage_path" text,
	"recurring_cost_id" uuid,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cost_entries_amount_positive" CHECK ("cost_entries"."amount_cents" > 0)
);
--> statement-breakpoint
CREATE TABLE "recurring_costs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"day_of_month" integer NOT NULL,
	"description" text,
	"starts_at" date NOT NULL,
	"ends_at" date,
	"last_generated_at" date,
	"active" boolean DEFAULT true NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recurring_costs_amount_positive" CHECK ("recurring_costs"."amount_cents" > 0),
	CONSTRAINT "recurring_costs_day_of_month_range" CHECK ("recurring_costs"."day_of_month" >= 1 AND "recurring_costs"."day_of_month" <= 28),
	CONSTRAINT "recurring_costs_ends_after_starts" CHECK ("recurring_costs"."ends_at" IS NULL OR "recurring_costs"."ends_at" >= "recurring_costs"."starts_at")
);
--> statement-breakpoint
ALTER TABLE "cost_entries" ADD CONSTRAINT "cost_entries_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_entries" ADD CONSTRAINT "cost_entries_category_id_cost_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."cost_categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_entries" ADD CONSTRAINT "cost_entries_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_costs" ADD CONSTRAINT "recurring_costs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_costs" ADD CONSTRAINT "recurring_costs_category_id_cost_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."cost_categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_costs" ADD CONSTRAINT "recurring_costs_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cost_categories_tenant_slug_uq" ON "cost_categories" USING btree ("tenant_id","slug");--> statement-breakpoint
CREATE INDEX "cost_categories_tenant_type_idx" ON "cost_categories" USING btree ("tenant_id","type") WHERE archived_at IS NULL;--> statement-breakpoint
CREATE INDEX "cost_entries_tenant_company_at_idx" ON "cost_entries" USING btree ("tenant_id","company_id","incurred_at");--> statement-breakpoint
CREATE INDEX "cost_entries_category_at_idx" ON "cost_entries" USING btree ("category_id","incurred_at");--> statement-breakpoint
CREATE INDEX "cost_entries_recurring_idx" ON "cost_entries" USING btree ("recurring_cost_id");--> statement-breakpoint
CREATE INDEX "recurring_costs_tenant_company_idx" ON "recurring_costs" USING btree ("tenant_id","company_id");--> statement-breakpoint
CREATE INDEX "recurring_costs_active_idx" ON "recurring_costs" USING btree ("day_of_month") WHERE active = true;