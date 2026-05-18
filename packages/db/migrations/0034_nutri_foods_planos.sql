CREATE TYPE "public"."food_category" AS ENUM('cereais_e_derivados', 'verduras_hortalicas', 'frutas', 'gorduras_e_oleos', 'pescados_e_frutos_do_mar', 'carnes_e_derivados', 'leite_e_derivados', 'bebidas', 'ovos_e_derivados', 'produtos_acucarados', 'miscelaneos', 'alimentos_industrializados', 'leguminosas', 'nozes_e_sementes', 'preparacoes');--> statement-breakpoint
CREATE TYPE "public"."food_source" AS ENUM('taco', 'usda', 'custom');--> statement-breakpoint
CREATE TYPE "public"."meal_plan_goal" AS ENUM('emagrecimento', 'ganho_massa', 'manutencao', 'baixo_carbo', 'cetogenico', 'vegetariano', 'vegano', 'diabetico', 'renal', 'gestante', 'esportivo', 'outro');--> statement-breakpoint
CREATE TABLE "food_equivalences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"food_id_a" uuid NOT NULL,
	"food_id_b" uuid NOT NULL,
	"grams_a" numeric(8, 2) NOT NULL,
	"grams_b" numeric(8, 2) NOT NULL,
	"category" text NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "food_equiv_grams_positive" CHECK ("food_equivalences"."grams_a" > 0 AND "food_equivalences"."grams_b" > 0),
	CONSTRAINT "food_equiv_not_self" CHECK ("food_equivalences"."food_id_a" != "food_equivalences"."food_id_b")
);
--> statement-breakpoint
CREATE TABLE "food_measures" (
	"food_id" uuid NOT NULL,
	"measure" text NOT NULL,
	"grams" numeric(8, 2) NOT NULL,
	"display_order" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "food_measures_food_id_measure_pk" PRIMARY KEY("food_id","measure"),
	CONSTRAINT "food_measures_grams_positive" CHECK ("food_measures"."grams" > 0)
);
--> statement-breakpoint
CREATE TABLE "foods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"source" "food_source" NOT NULL,
	"external_code" text,
	"name" text NOT NULL,
	"name_normalized" text NOT NULL,
	"category" "food_category" NOT NULL,
	"subcategory" text,
	"preparation" text,
	"nutrients" jsonb NOT NULL,
	"density_g_per_ml" numeric(5, 3),
	"active" boolean DEFAULT true NOT NULL,
	"created_by_user_id" uuid,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meal_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"meal_id" uuid NOT NULL,
	"food_id" uuid NOT NULL,
	"measure" text,
	"grams" numeric(8, 2) NOT NULL,
	"notes" text,
	"order" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meal_items_grams_positive" CHECK ("meal_items"."grams" > 0)
);
--> statement-breakpoint
CREATE TABLE "meal_plan_meals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"meal_plan_id" uuid NOT NULL,
	"name" text NOT NULL,
	"expected_time" time,
	"order" integer NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meal_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"prescription_id" uuid,
	"name" text NOT NULL,
	"goal" "meal_plan_goal" NOT NULL,
	"target_kcal" integer,
	"target_protein_g" numeric(6, 1),
	"target_carb_g" numeric(6, 1),
	"target_lipid_g" numeric(6, 1),
	"notes" text,
	"version" integer DEFAULT 1 NOT NULL,
	"parent_meal_plan_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"starts_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ends_at" timestamp with time zone,
	"created_by_user_id" uuid,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meal_plans_version_positive" CHECK ("meal_plans"."version" > 0),
	CONSTRAINT "meal_plans_ends_after_starts" CHECK ("meal_plans"."ends_at" IS NULL OR "meal_plans"."ends_at" > "meal_plans"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "tenant_branding" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"logo_storage_path" text,
	"primary_color" text DEFAULT '#3498DB' NOT NULL,
	"logo_width_px" integer DEFAULT 120 NOT NULL,
	"signature_storage_path" text,
	"professional_name_default" text,
	"footer_text" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "food_equivalences" ADD CONSTRAINT "food_equivalences_food_id_a_foods_id_fk" FOREIGN KEY ("food_id_a") REFERENCES "public"."foods"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_equivalences" ADD CONSTRAINT "food_equivalences_food_id_b_foods_id_fk" FOREIGN KEY ("food_id_b") REFERENCES "public"."foods"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_measures" ADD CONSTRAINT "food_measures_food_id_foods_id_fk" FOREIGN KEY ("food_id") REFERENCES "public"."foods"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foods" ADD CONSTRAINT "foods_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_items" ADD CONSTRAINT "meal_items_meal_id_meal_plan_meals_id_fk" FOREIGN KEY ("meal_id") REFERENCES "public"."meal_plan_meals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_items" ADD CONSTRAINT "meal_items_food_id_foods_id_fk" FOREIGN KEY ("food_id") REFERENCES "public"."foods"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_plan_meals" ADD CONSTRAINT "meal_plan_meals_meal_plan_id_meal_plans_id_fk" FOREIGN KEY ("meal_plan_id") REFERENCES "public"."meal_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_plans" ADD CONSTRAINT "meal_plans_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_plans" ADD CONSTRAINT "meal_plans_prescription_id_prescriptions_id_fk" FOREIGN KEY ("prescription_id") REFERENCES "public"."prescriptions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_plans" ADD CONSTRAINT "meal_plans_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "food_equiv_a_idx" ON "food_equivalences" USING btree ("food_id_a","category");--> statement-breakpoint
CREATE INDEX "food_equiv_b_idx" ON "food_equivalences" USING btree ("food_id_b","category");--> statement-breakpoint
CREATE UNIQUE INDEX "food_equiv_pair_uq" ON "food_equivalences" USING btree ("tenant_id","food_id_a","food_id_b");--> statement-breakpoint
CREATE INDEX "food_measures_food_idx" ON "food_measures" USING btree ("food_id","display_order");--> statement-breakpoint
CREATE INDEX "foods_tenant_category_idx" ON "foods" USING btree ("tenant_id","category");--> statement-breakpoint
CREATE INDEX "foods_global_idx" ON "foods" USING btree ("category","active") WHERE tenant_id IS NULL AND active = true AND archived_at IS NULL;--> statement-breakpoint
CREATE INDEX "foods_name_normalized_idx" ON "foods" USING btree ("name_normalized");--> statement-breakpoint
CREATE UNIQUE INDEX "foods_external_uq" ON "foods" USING btree ("source","external_code") WHERE tenant_id IS NULL AND external_code IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "meal_items_order_uq" ON "meal_items" USING btree ("meal_id","order");--> statement-breakpoint
CREATE INDEX "meal_items_meal_idx" ON "meal_items" USING btree ("meal_id");--> statement-breakpoint
CREATE INDEX "meal_items_food_idx" ON "meal_items" USING btree ("food_id");--> statement-breakpoint
CREATE UNIQUE INDEX "meal_plan_meals_order_uq" ON "meal_plan_meals" USING btree ("meal_plan_id","order");--> statement-breakpoint
CREATE INDEX "meal_plan_meals_plan_idx" ON "meal_plan_meals" USING btree ("meal_plan_id");--> statement-breakpoint
CREATE INDEX "meal_plans_tenant_member_idx" ON "meal_plans" USING btree ("tenant_id","member_id","created_at");--> statement-breakpoint
CREATE INDEX "meal_plans_active_idx" ON "meal_plans" USING btree ("tenant_id","member_id") WHERE active = true AND archived_at IS NULL;--> statement-breakpoint
CREATE INDEX "meal_plans_parent_idx" ON "meal_plans" USING btree ("parent_meal_plan_id");