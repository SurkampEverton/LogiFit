CREATE TYPE "public"."person_kind" AS ENUM('pf', 'pj');--> statement-breakpoint
CREATE TYPE "public"."company_type" AS ENUM('matriz', 'filial');--> statement-breakpoint
CREATE TYPE "public"."tenant_financial_mode" AS ENUM('centralized', 'distributed');--> statement-breakpoint
CREATE TYPE "public"."tenant_subscription_status" AS ENUM('trialing', 'active', 'trial_expired', 'suspended', 'anonymized');--> statement-breakpoint
CREATE TYPE "public"."tenant_topology" AS ENUM('owned', 'franchise');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "persons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" "person_kind" NOT NULL,
	"name" text NOT NULL,
	"display_name" text,
	"document" text,
	"birth_date" date,
	"sex" text,
	"email" text,
	"phone" text,
	"address" jsonb,
	"notes" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cnpj_cache" (
	"cnpj" text PRIMARY KEY NOT NULL,
	"data" jsonb NOT NULL,
	"provider_used" text NOT NULL,
	"situacao" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tenant_cnpj_settings" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"provider_primary" text DEFAULT 'brasilapi' NOT NULL,
	"provider_fallback" text,
	"credentials_encrypted" jsonb,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"type" "company_type" NOT NULL,
	"parent_company_id" uuid,
	"ie" text,
	"im" text,
	"regime_tributario" text,
	"cnes_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"topology" "tenant_topology" DEFAULT 'owned' NOT NULL,
	"financial_mode" "tenant_financial_mode" DEFAULT 'centralized' NOT NULL,
	"cross_company_access" boolean DEFAULT false NOT NULL,
	"subscription_status" "tenant_subscription_status" DEFAULT 'trialing' NOT NULL,
	"trial_ends_at" timestamp with time zone,
	"shard_url" text,
	"default_locale" text DEFAULT 'pt-BR' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"address" jsonb NOT NULL,
	"capacity" numeric,
	"area_m2" numeric,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"auth_user_id" uuid,
	"username" text NOT NULL,
	"mfa_enabled" boolean DEFAULT false NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "companies" ADD CONSTRAINT "companies_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tenants" ADD CONSTRAINT "tenants_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "units" ADD CONSTRAINT "units_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_tenants" ADD CONSTRAINT "user_tenants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_tenants" ADD CONSTRAINT "user_tenants_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "users" ADD CONSTRAINT "users_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "persons_tenant_document_uq" ON "persons" USING btree ("tenant_id","document") WHERE "persons"."document" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "companies_matriz_per_tenant_uq" ON "companies" USING btree ("tenant_id") WHERE "companies"."type" = 'matriz';--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "companies_person_per_tenant_uq" ON "companies" USING btree ("tenant_id","person_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "companies_tenant_id_idx" ON "companies" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "companies_parent_id_idx" ON "companies" USING btree ("parent_company_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tenants_slug_uq" ON "tenants" USING btree ("slug");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tenants_group_id_idx" ON "tenants" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "units_tenant_id_idx" ON "units" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "units_company_id_idx" ON "units" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_tenants_user_tenant_uq" ON "user_tenants" USING btree ("user_id","tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_tenants_user_id_idx" ON "user_tenants" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_tenants_tenant_id_idx" ON "user_tenants" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "users_tenant_username_uq" ON "users" USING btree ("tenant_id","username");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "users_tenant_person_uq" ON "users" USING btree ("tenant_id","person_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "users_auth_user_id_idx" ON "users" USING btree ("auth_user_id");