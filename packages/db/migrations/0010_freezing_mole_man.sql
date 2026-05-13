CREATE TYPE "public"."credit_source" AS ENUM('bundle', 'purchase', 'referral_reward', 'manual_grant');--> statement-breakpoint
CREATE TYPE "public"."promotion_kind" AS ENUM('percent', 'fixed', 'trial_days');--> statement-breakpoint
CREATE TABLE "appointment_credits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"contract_id" uuid,
	"service_type" text NOT NULL,
	"resource_modality" text,
	"balance" integer NOT NULL,
	"initial_quantity" integer NOT NULL,
	"source" "credit_source" NOT NULL,
	"earned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credits_balance_non_negative" CHECK ("appointment_credits"."balance" >= 0),
	CONSTRAINT "credits_initial_positive" CHECK ("appointment_credits"."initial_quantity" > 0),
	CONSTRAINT "credits_balance_le_initial" CHECK ("appointment_credits"."balance" <= "appointment_credits"."initial_quantity")
);
--> statement-breakpoint
CREATE TABLE "credit_consumptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"credit_id" uuid NOT NULL,
	"appointment_id" uuid,
	"consumed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"amount" integer DEFAULT 1 NOT NULL,
	"consumed_by_user_id" uuid,
	CONSTRAINT "credit_consumptions_amount_positive" CHECK ("credit_consumptions"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "plan_items" (
	"tenant_id" uuid NOT NULL,
	"bundle_plan_id" uuid NOT NULL,
	"idx" integer NOT NULL,
	"service_type" text NOT NULL,
	"quantity" integer NOT NULL,
	"credit_validity_days" integer,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_items_quantity_positive" CHECK ("plan_items"."quantity" > 0),
	CONSTRAINT "plan_items_validity_days_valid" CHECK ("plan_items"."credit_validity_days" IS NULL OR "plan_items"."credit_validity_days" > 0)
);
--> statement-breakpoint
CREATE TABLE "promotion_uses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"promotion_id" uuid NOT NULL,
	"contract_id" uuid,
	"invoice_id" uuid,
	"member_id" uuid,
	"discount_cents" integer NOT NULL,
	"used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"used_by_user_id" uuid,
	CONSTRAINT "promotion_uses_discount_positive" CHECK ("promotion_uses"."discount_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "promotions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"kind" "promotion_kind" NOT NULL,
	"value" integer NOT NULL,
	"valid_from" timestamp with time zone NOT NULL,
	"valid_to" timestamp with time zone,
	"max_uses" integer,
	"uses_count" integer DEFAULT 0 NOT NULL,
	"min_amount_cents" integer,
	"stackable" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "promotions_value_non_negative" CHECK ("promotions"."value" >= 0),
	CONSTRAINT "promotions_uses_non_negative" CHECK ("promotions"."uses_count" >= 0),
	CONSTRAINT "promotions_max_uses_valid" CHECK ("promotions"."max_uses" IS NULL OR "promotions"."max_uses" > 0)
);
--> statement-breakpoint
CREATE TABLE "referral_uses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"referral_id" uuid NOT NULL,
	"referred_member_id" uuid NOT NULL,
	"contract_id" uuid,
	"converted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reward_granted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "referrals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"referrer_member_id" uuid NOT NULL,
	"code" text NOT NULL,
	"reward_promotion_id" uuid NOT NULL,
	"uses_count" integer DEFAULT 0 NOT NULL,
	"max_uses" integer,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "referrals_uses_non_negative" CHECK ("referrals"."uses_count" >= 0),
	CONSTRAINT "referrals_max_uses_valid" CHECK ("referrals"."max_uses" IS NULL OR "referrals"."max_uses" > 0)
);
--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "kind" text DEFAULT 'plan' NOT NULL;--> statement-breakpoint
ALTER TABLE "appointment_credits" ADD CONSTRAINT "appointment_credits_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_credits" ADD CONSTRAINT "appointment_credits_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_consumptions" ADD CONSTRAINT "credit_consumptions_credit_id_appointment_credits_id_fk" FOREIGN KEY ("credit_id") REFERENCES "public"."appointment_credits"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_consumptions" ADD CONSTRAINT "credit_consumptions_consumed_by_user_id_users_id_fk" FOREIGN KEY ("consumed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_items" ADD CONSTRAINT "plan_items_bundle_plan_id_plans_id_fk" FOREIGN KEY ("bundle_plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotion_uses" ADD CONSTRAINT "promotion_uses_promotion_id_promotions_id_fk" FOREIGN KEY ("promotion_id") REFERENCES "public"."promotions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotion_uses" ADD CONSTRAINT "promotion_uses_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotion_uses" ADD CONSTRAINT "promotion_uses_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotion_uses" ADD CONSTRAINT "promotion_uses_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotion_uses" ADD CONSTRAINT "promotion_uses_used_by_user_id_users_id_fk" FOREIGN KEY ("used_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_uses" ADD CONSTRAINT "referral_uses_referral_id_referrals_id_fk" FOREIGN KEY ("referral_id") REFERENCES "public"."referrals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_uses" ADD CONSTRAINT "referral_uses_referred_member_id_members_id_fk" FOREIGN KEY ("referred_member_id") REFERENCES "public"."members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_uses" ADD CONSTRAINT "referral_uses_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referrer_member_id_members_id_fk" FOREIGN KEY ("referrer_member_id") REFERENCES "public"."members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_reward_promotion_id_promotions_id_fk" FOREIGN KEY ("reward_promotion_id") REFERENCES "public"."promotions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "credits_tenant_member_idx" ON "appointment_credits" USING btree ("tenant_id","member_id");--> statement-breakpoint
CREATE INDEX "credits_member_service_idx" ON "appointment_credits" USING btree ("member_id","service_type");--> statement-breakpoint
CREATE INDEX "credits_active_idx" ON "appointment_credits" USING btree ("tenant_id","member_id","service_type") WHERE balance > 0;--> statement-breakpoint
CREATE INDEX "credit_consumptions_tenant_credit_idx" ON "credit_consumptions" USING btree ("tenant_id","credit_id","consumed_at");--> statement-breakpoint
CREATE INDEX "credit_consumptions_appointment_idx" ON "credit_consumptions" USING btree ("appointment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "plan_items_pk" ON "plan_items" USING btree ("bundle_plan_id","idx");--> statement-breakpoint
CREATE INDEX "plan_items_tenant_idx" ON "plan_items" USING btree ("tenant_id","bundle_plan_id");--> statement-breakpoint
CREATE INDEX "promotion_uses_tenant_promo_idx" ON "promotion_uses" USING btree ("tenant_id","promotion_id","used_at");--> statement-breakpoint
CREATE INDEX "promotion_uses_contract_idx" ON "promotion_uses" USING btree ("contract_id");--> statement-breakpoint
CREATE INDEX "promotion_uses_invoice_idx" ON "promotion_uses" USING btree ("invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "promotions_tenant_code_uq" ON "promotions" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE INDEX "promotions_tenant_active_idx" ON "promotions" USING btree ("tenant_id") WHERE active = true AND archived_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "referral_uses_referred_uq" ON "referral_uses" USING btree ("tenant_id","referred_member_id");--> statement-breakpoint
CREATE INDEX "referral_uses_tenant_referral_idx" ON "referral_uses" USING btree ("tenant_id","referral_id");--> statement-breakpoint
CREATE UNIQUE INDEX "referrals_tenant_code_uq" ON "referrals" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "referrals_tenant_member_uq" ON "referrals" USING btree ("tenant_id","referrer_member_id") WHERE active = true;--> statement-breakpoint
CREATE INDEX "referrals_tenant_active_idx" ON "referrals" USING btree ("tenant_id") WHERE active = true;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_kind_valid" CHECK ("plans"."kind" IN ('plan', 'bundle'));