CREATE TYPE "public"."authorization_status" AS ENUM('pending', 'approved', 'denied', 'expired');--> statement-breakpoint
CREATE TYPE "public"."batch_status" AS ENUM('draft', 'sent', 'returned', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."glosa_status" AS ENUM('glossed', 'recurring', 'recovered', 'lost');--> statement-breakpoint
CREATE TYPE "public"."billing_guide_kind" AS ENUM('consulta', 'sp_sadt', 'honorario', 'internacao');--> statement-breakpoint
CREATE TYPE "public"."billing_guide_status" AS ENUM('draft', 'ready', 'sent', 'paid', 'partially_paid', 'fully_glossed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."tuss_category" AS ENUM('procedimento', 'opme', 'medicamento', 'taxa_diaria', 'gasoterapia');--> statement-breakpoint
CREATE TYPE "public"."tuss_import_source" AS ENUM('ans_oficio_circular', 'manual');--> statement-breakpoint
CREATE TABLE "authorizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"member_insurance_id" uuid NOT NULL,
	"tuss_code" text NOT NULL,
	"quantity_requested" integer NOT NULL,
	"quantity_authorized" integer,
	"quantity_used" integer DEFAULT 0 NOT NULL,
	"authorization_number" text,
	"status" "authorization_status" DEFAULT 'pending' NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_at" timestamp with time zone,
	"denied_at" timestamp with time zone,
	"denial_reason" text,
	"valid_until" date,
	"requested_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_qty_positive" CHECK (quantity_requested > 0),
	CONSTRAINT "auth_qty_used_le_authorized" CHECK ((quantity_authorized IS NULL OR quantity_used <= quantity_authorized))
);
--> statement-breakpoint
CREATE TABLE "billing_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"agreement_id" uuid NOT NULL,
	"batch_number" text NOT NULL,
	"guide_ids" uuid[] NOT NULL,
	"xml" text NOT NULL,
	"status" "batch_status" DEFAULT 'draft' NOT NULL,
	"sent_at" timestamp with time zone,
	"returned_at" timestamp with time zone,
	"return_xml" text,
	"tiss_version" text NOT NULL,
	"sent_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_glosas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"guide_id" uuid NOT NULL,
	"guide_item_id" uuid,
	"reason_code" text NOT NULL,
	"reason_description" text NOT NULL,
	"amount_glossed_cents" bigint NOT NULL,
	"status" "glosa_status" DEFAULT 'glossed' NOT NULL,
	"recurso_body" text,
	"recurso_at" timestamp with time zone,
	"recurso_by_user_id" uuid,
	"resolved_at" timestamp with time zone,
	"resolution_notes" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bgl_amount_positive" CHECK (amount_glossed_cents > 0)
);
--> statement-breakpoint
CREATE TABLE "billing_guide_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"guide_id" uuid NOT NULL,
	"sequence_number" integer NOT NULL,
	"tuss_code" text NOT NULL,
	"description" text NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price_cents" bigint NOT NULL,
	"total_cents" bigint NOT NULL,
	"appointment_id" uuid,
	"professional_user_id" uuid NOT NULL,
	"cbos_code" text,
	CONSTRAINT "bgi_qty_positive" CHECK (quantity > 0),
	CONSTRAINT "bgi_total_consistent" CHECK (total_cents = quantity * unit_price_cents)
);
--> statement-breakpoint
CREATE TABLE "billing_guides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"member_insurance_id" uuid NOT NULL,
	"kind" "billing_guide_kind" NOT NULL,
	"guide_number" text NOT NULL,
	"operator_guide_number" text,
	"authorization_id" uuid,
	"total_cents" bigint NOT NULL,
	"copay_cents" bigint DEFAULT 0 NOT NULL,
	"copay_invoice_id" uuid,
	"status" "billing_guide_status" DEFAULT 'draft' NOT NULL,
	"xml_sent" text,
	"sent_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"paid_amount_cents" bigint,
	"professional_snapshot" jsonb,
	"tuss_version" text NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancelled_by_user_id" uuid,
	"cancelled_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bg_total_positive" CHECK (total_cents >= 0),
	CONSTRAINT "bg_paid_le_total" CHECK ((paid_amount_cents IS NULL OR paid_amount_cents <= total_cents))
);
--> statement-breakpoint
CREATE TABLE "insurance_agreements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"contract_number" text,
	"credentials_encrypted" jsonb,
	"payment_term_days" integer DEFAULT 30 NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "insurance_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"name" text NOT NULL,
	"ans_code" text,
	"tiss_version" text DEFAULT '4.01' NOT NULL,
	"national" boolean DEFAULT true NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "insurance_procedure_prices" (
	"agreement_id" uuid NOT NULL,
	"tuss_code" text NOT NULL,
	"price_cents" bigint NOT NULL,
	"patient_copay_cents" bigint,
	"auth_required" boolean DEFAULT false NOT NULL,
	"max_sessions_per_auth" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "insurance_procedure_prices_agreement_id_tuss_code_pk" PRIMARY KEY("agreement_id","tuss_code"),
	CONSTRAINT "ipp_price_positive" CHECK (price_cents >= 0)
);
--> statement-breakpoint
CREATE TABLE "member_insurances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"card_number" text NOT NULL,
	"category" text,
	"valid_until" date,
	"holder_name" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tuss_catalog" (
	"code" text NOT NULL,
	"description" text NOT NULL,
	"category" "tuss_category" NOT NULL,
	"version" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"effective_from" date,
	"effective_to" date,
	"specialties" text[],
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tuss_catalog_code_version_pk" PRIMARY KEY("code","version")
);
--> statement-breakpoint
CREATE TABLE "tuss_catalog_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" text NOT NULL,
	"source" "tuss_import_source" NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"imported_by_user_id" uuid,
	"items_added" integer DEFAULT 0 NOT NULL,
	"items_updated" integer DEFAULT 0 NOT NULL,
	"items_deactivated" integer DEFAULT 0 NOT NULL,
	"import_log" text
);
--> statement-breakpoint
ALTER TABLE "authorizations" ADD CONSTRAINT "authorizations_member_insurance_id_member_insurances_id_fk" FOREIGN KEY ("member_insurance_id") REFERENCES "public"."member_insurances"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authorizations" ADD CONSTRAINT "authorizations_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_batches" ADD CONSTRAINT "billing_batches_agreement_id_insurance_agreements_id_fk" FOREIGN KEY ("agreement_id") REFERENCES "public"."insurance_agreements"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_batches" ADD CONSTRAINT "billing_batches_sent_by_user_id_users_id_fk" FOREIGN KEY ("sent_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_glosas" ADD CONSTRAINT "billing_glosas_guide_id_billing_guides_id_fk" FOREIGN KEY ("guide_id") REFERENCES "public"."billing_guides"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_glosas" ADD CONSTRAINT "billing_glosas_guide_item_id_billing_guide_items_id_fk" FOREIGN KEY ("guide_item_id") REFERENCES "public"."billing_guide_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_glosas" ADD CONSTRAINT "billing_glosas_recurso_by_user_id_users_id_fk" FOREIGN KEY ("recurso_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_guide_items" ADD CONSTRAINT "billing_guide_items_guide_id_billing_guides_id_fk" FOREIGN KEY ("guide_id") REFERENCES "public"."billing_guides"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_guide_items" ADD CONSTRAINT "billing_guide_items_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_guide_items" ADD CONSTRAINT "billing_guide_items_professional_user_id_users_id_fk" FOREIGN KEY ("professional_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_guides" ADD CONSTRAINT "billing_guides_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_guides" ADD CONSTRAINT "billing_guides_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_guides" ADD CONSTRAINT "billing_guides_member_insurance_id_member_insurances_id_fk" FOREIGN KEY ("member_insurance_id") REFERENCES "public"."member_insurances"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_guides" ADD CONSTRAINT "billing_guides_authorization_id_authorizations_id_fk" FOREIGN KEY ("authorization_id") REFERENCES "public"."authorizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_guides" ADD CONSTRAINT "billing_guides_copay_invoice_id_invoices_id_fk" FOREIGN KEY ("copay_invoice_id") REFERENCES "public"."invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_guides" ADD CONSTRAINT "billing_guides_cancelled_by_user_id_users_id_fk" FOREIGN KEY ("cancelled_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance_agreements" ADD CONSTRAINT "insurance_agreements_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance_agreements" ADD CONSTRAINT "insurance_agreements_plan_id_insurance_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."insurance_plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance_procedure_prices" ADD CONSTRAINT "insurance_procedure_prices_agreement_id_insurance_agreements_id_fk" FOREIGN KEY ("agreement_id") REFERENCES "public"."insurance_agreements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_insurances" ADD CONSTRAINT "member_insurances_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_insurances" ADD CONSTRAINT "member_insurances_plan_id_insurance_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."insurance_plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tuss_catalog_imports" ADD CONSTRAINT "tuss_catalog_imports_imported_by_user_id_users_id_fk" FOREIGN KEY ("imported_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_tenant_status_idx" ON "authorizations" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "auth_member_insurance_idx" ON "authorizations" USING btree ("member_insurance_id","requested_at");--> statement-breakpoint
CREATE UNIQUE INDEX "bb_tenant_number_uq" ON "billing_batches" USING btree ("tenant_id","batch_number");--> statement-breakpoint
CREATE INDEX "bb_agreement_status_idx" ON "billing_batches" USING btree ("agreement_id","status","sent_at");--> statement-breakpoint
CREATE INDEX "bgl_tenant_status_idx" ON "billing_glosas" USING btree ("tenant_id","status","received_at");--> statement-breakpoint
CREATE INDEX "bgl_guide_idx" ON "billing_glosas" USING btree ("guide_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bgi_guide_seq_uq" ON "billing_guide_items" USING btree ("guide_id","sequence_number");--> statement-breakpoint
CREATE INDEX "bgi_tuss_idx" ON "billing_guide_items" USING btree ("tuss_code");--> statement-breakpoint
CREATE UNIQUE INDEX "bg_tenant_number_uq" ON "billing_guides" USING btree ("tenant_id","guide_number");--> statement-breakpoint
CREATE INDEX "bg_tenant_status_idx" ON "billing_guides" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "bg_member_idx" ON "billing_guides" USING btree ("member_id","created_at");--> statement-breakpoint
CREATE INDEX "agreement_tenant_company_idx" ON "insurance_agreements" USING btree ("tenant_id","company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agreement_company_plan_uq" ON "insurance_agreements" USING btree ("company_id","plan_id") WHERE active = true;--> statement-breakpoint
CREATE INDEX "insurance_plans_active_idx" ON "insurance_plans" USING btree ("active");--> statement-breakpoint
CREATE UNIQUE INDEX "insurance_plans_ans_uq" ON "insurance_plans" USING btree ("ans_code") WHERE ans_code IS NOT NULL;--> statement-breakpoint
CREATE INDEX "mi_tenant_member_idx" ON "member_insurances" USING btree ("tenant_id","member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mi_member_plan_card_uq" ON "member_insurances" USING btree ("member_id","plan_id","card_number");--> statement-breakpoint
CREATE INDEX "tuss_category_idx" ON "tuss_catalog" USING btree ("category","version");--> statement-breakpoint
CREATE INDEX "tuss_active_idx" ON "tuss_catalog" USING btree ("active","version");--> statement-breakpoint
CREATE UNIQUE INDEX "tuss_imports_version_source_uq" ON "tuss_catalog_imports" USING btree ("version","source");--> statement-breakpoint
CREATE INDEX "tuss_imports_at_idx" ON "tuss_catalog_imports" USING btree ("imported_at");