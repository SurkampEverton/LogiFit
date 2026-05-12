CREATE TYPE "public"."tenant_mode" AS ENUM('multi', 'solo');--> statement-breakpoint
CREATE TYPE "public"."council_body" AS ENUM('CRM', 'CRN', 'CREFITO', 'CREF', 'CRF', 'CRP', 'COREN', 'CRO');--> statement-breakpoint
CREATE TYPE "public"."professional_situation" AS ENUM('active', 'suspended', 'cassated', 'expired', 'pending_verification', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."verification_source" AS ENUM('operator_attested', 'council_api', 'manual_audit');--> statement-breakpoint
CREATE TYPE "public"."consent_legal_basis" AS ENUM('consent', 'contract', 'legal_obligation', 'vital_interests', 'health_protection', 'public_interest', 'legitimate_interest');--> statement-breakpoint
CREATE TYPE "public"."consent_purpose" AS ENUM('whatsapp_marketing', 'email_marketing', 'cross_company_data_share', 'cross_tenant_passport', 'ai_processing_clinical', 'device_telemetry_share', 'image_capture', 'lab_result_ai_interpretation', 'whatsapp_transactional', 'profile_data_export');--> statement-breakpoint
CREATE TABLE "professional_registrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"council_body" "council_body" NOT NULL,
	"council_number" text NOT NULL,
	"council_state" text NOT NULL,
	"specialty" text,
	"cbo_code" text,
	"situation" "professional_situation" DEFAULT 'pending_verification' NOT NULL,
	"issued_at" date,
	"verified_at" timestamp with time zone,
	"verified_by_user_id" uuid,
	"verification_source" "verification_source" DEFAULT 'operator_attested' NOT NULL,
	"valid_until" date,
	"document_storage_path" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "franchise_agreements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"franqueador_company_id" uuid NOT NULL,
	"franqueado_company_id" uuid NOT NULL,
	"royalty_percentage" numeric(5, 2),
	"fixed_monthly_fee_cents" numeric(12, 0),
	"cross_company_access" boolean DEFAULT false NOT NULL,
	"started_at" date NOT NULL,
	"ends_at" date,
	"metadata" jsonb,
	"signed_by_user_id" uuid,
	"signed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"terminated_at" timestamp with time zone,
	"termination_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"purpose" "consent_purpose" NOT NULL,
	"legal_basis" "consent_legal_basis" DEFAULT 'consent' NOT NULL,
	"granted" boolean DEFAULT true NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text,
	"ripd_version" text,
	"ip_address" text,
	"user_agent" text,
	"scope_tenant_id" uuid,
	"scope_company_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "mode" "tenant_mode" DEFAULT 'multi' NOT NULL;--> statement-breakpoint
ALTER TABLE "professional_registrations" ADD CONSTRAINT "professional_registrations_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "professional_registrations" ADD CONSTRAINT "professional_registrations_verified_by_user_id_users_id_fk" FOREIGN KEY ("verified_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "franchise_agreements" ADD CONSTRAINT "franchise_agreements_franqueador_company_id_companies_id_fk" FOREIGN KEY ("franqueador_company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "franchise_agreements" ADD CONSTRAINT "franchise_agreements_franqueado_company_id_companies_id_fk" FOREIGN KEY ("franqueado_company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "professional_registrations_global_uq" ON "professional_registrations" USING btree ("council_body","council_number","council_state");--> statement-breakpoint
CREATE INDEX "professional_registrations_tenant_person_idx" ON "professional_registrations" USING btree ("tenant_id","person_id");--> statement-breakpoint
CREATE INDEX "professional_registrations_person_idx" ON "professional_registrations" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "professional_registrations_situation_idx" ON "professional_registrations" USING btree ("situation");--> statement-breakpoint
CREATE UNIQUE INDEX "franchise_agreements_pair_active_uq" ON "franchise_agreements" USING btree ("franqueador_company_id","franqueado_company_id") WHERE "franchise_agreements"."terminated_at" IS NULL;--> statement-breakpoint
CREATE INDEX "franchise_agreements_tenant_idx" ON "franchise_agreements" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "franchise_agreements_franqueador_idx" ON "franchise_agreements" USING btree ("franqueador_company_id");--> statement-breakpoint
CREATE INDEX "franchise_agreements_franqueado_idx" ON "franchise_agreements" USING btree ("franqueado_company_id");--> statement-breakpoint
CREATE INDEX "consents_person_purpose_idx" ON "consents" USING btree ("person_id","purpose","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "consents_tenant_idx" ON "consents" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "consents_active_uq" ON "consents" USING btree ("person_id","purpose","scope_tenant_id","scope_company_id") WHERE "consents"."revoked_at" IS NULL;