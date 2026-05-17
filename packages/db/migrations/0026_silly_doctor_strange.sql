CREATE TYPE "public"."cid_link_kind" AS ENUM('principal', 'secundario');--> statement-breakpoint
CREATE TYPE "public"."cif_component" AS ENUM('body_functions', 'body_structures', 'activities_participation', 'environmental_factors');--> statement-breakpoint
CREATE TYPE "public"."consulta_kind" AS ENUM('medico', 'fisio', 'nutri', 'personal', 'enfermeiro', 'custom');--> statement-breakpoint
CREATE TYPE "public"."consulta_status" AS ENUM('draft', 'locked', 'signed', 'archived');--> statement-breakpoint
CREATE TYPE "public"."lock_method" AS ENUM('icp_brasil_a1', 'icp_brasil_a3', 'authenticated_mfa');--> statement-breakpoint
CREATE TYPE "public"."signature_mode" AS ENUM('icp_required', 'icp_optional', 'authenticated_lock');--> statement-breakpoint
CREATE TABLE "cid_catalog" (
	"code" text PRIMARY KEY NOT NULL,
	"description" text NOT NULL,
	"chapter" text,
	"version" text DEFAULT 'CID-11' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"release_date" text
);
--> statement-breakpoint
CREATE TABLE "cif_catalog" (
	"code" text PRIMARY KEY NOT NULL,
	"description" text NOT NULL,
	"component" "cif_component" NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consulta_cids" (
	"consulta_id" uuid NOT NULL,
	"cid_code" text NOT NULL,
	"kind" "cid_link_kind" DEFAULT 'principal' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "consulta_cids_consulta_id_cid_code_kind_pk" PRIMARY KEY("consulta_id","cid_code","kind")
);
--> statement-breakpoint
CREATE TABLE "consulta_cifs" (
	"consulta_id" uuid NOT NULL,
	"cif_code" text NOT NULL,
	"qualifier" integer NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "consulta_cifs_consulta_id_cif_code_pk" PRIMARY KEY("consulta_id","cif_code"),
	CONSTRAINT "consulta_cifs_qualifier_range" CHECK (qualifier >= 0 AND qualifier <= 4)
);
--> statement-breakpoint
CREATE TABLE "consulta_correction_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"consulta_id" uuid NOT NULL,
	"body" text NOT NULL,
	"reason" text NOT NULL,
	"author_user_id" uuid NOT NULL,
	"content_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consultas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"appointment_id" uuid,
	"professional_user_id" uuid NOT NULL,
	"kind" "consulta_kind" NOT NULL,
	"template_type_id" uuid,
	"content" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "consulta_status" DEFAULT 'draft' NOT NULL,
	"signature_mode" "signature_mode" NOT NULL,
	"signed_at" timestamp with time zone,
	"signed_hash" text,
	"signature_provider" text,
	"lock_method" "lock_method",
	"locked_by_user_id" uuid,
	"locked_at" timestamp with time zone,
	"council_snapshot" jsonb,
	"council_body_at_sign" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "consultas_signed_consistent" CHECK ((status != 'signed' OR (signed_at IS NOT NULL AND signed_hash IS NOT NULL))),
	CONSTRAINT "consultas_locked_consistent" CHECK ((status NOT IN ('locked', 'signed') OR locked_at IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "signature_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profession" text NOT NULL,
	"mode" "signature_mode" NOT NULL,
	"min_cert_level" text,
	"requires_mfa" boolean DEFAULT true NOT NULL,
	"requires_audit_chain" boolean DEFAULT true NOT NULL,
	"requires_authenticated_session" boolean DEFAULT true NOT NULL,
	"source_norm" text NOT NULL,
	"retention_years" integer DEFAULT 20 NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "signature_policies_profession_unique" UNIQUE("profession")
);
--> statement-breakpoint
CREATE TABLE "tenant_signature_overrides" (
	"tenant_id" uuid NOT NULL,
	"profession" text NOT NULL,
	"mode_override" "signature_mode" NOT NULL,
	"reason" text NOT NULL,
	"approved_by_user_id" uuid NOT NULL,
	"approved_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_signature_overrides_tenant_id_profession_pk" PRIMARY KEY("tenant_id","profession"),
	CONSTRAINT "tsoverride_only_harden" CHECK (mode_override = 'icp_required')
);
--> statement-breakpoint
ALTER TABLE "consulta_cids" ADD CONSTRAINT "consulta_cids_consulta_id_consultas_id_fk" FOREIGN KEY ("consulta_id") REFERENCES "public"."consultas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consulta_cids" ADD CONSTRAINT "consulta_cids_cid_code_cid_catalog_code_fk" FOREIGN KEY ("cid_code") REFERENCES "public"."cid_catalog"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consulta_cifs" ADD CONSTRAINT "consulta_cifs_consulta_id_consultas_id_fk" FOREIGN KEY ("consulta_id") REFERENCES "public"."consultas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consulta_cifs" ADD CONSTRAINT "consulta_cifs_cif_code_cif_catalog_code_fk" FOREIGN KEY ("cif_code") REFERENCES "public"."cif_catalog"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consulta_correction_notes" ADD CONSTRAINT "consulta_correction_notes_consulta_id_consultas_id_fk" FOREIGN KEY ("consulta_id") REFERENCES "public"."consultas"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consulta_correction_notes" ADD CONSTRAINT "consulta_correction_notes_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consultas" ADD CONSTRAINT "consultas_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consultas" ADD CONSTRAINT "consultas_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consultas" ADD CONSTRAINT "consultas_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consultas" ADD CONSTRAINT "consultas_professional_user_id_users_id_fk" FOREIGN KEY ("professional_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consultas" ADD CONSTRAINT "consultas_locked_by_user_id_users_id_fk" FOREIGN KEY ("locked_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_signature_overrides" ADD CONSTRAINT "tenant_signature_overrides_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cid_chapter_idx" ON "cid_catalog" USING btree ("chapter");--> statement-breakpoint
CREATE INDEX "cid_active_idx" ON "cid_catalog" USING btree ("active") WHERE active = true;--> statement-breakpoint
CREATE INDEX "cif_component_idx" ON "cif_catalog" USING btree ("component");--> statement-breakpoint
CREATE INDEX "cif_active_idx" ON "cif_catalog" USING btree ("active") WHERE active = true;--> statement-breakpoint
CREATE INDEX "consulta_cids_consulta_idx" ON "consulta_cids" USING btree ("consulta_id");--> statement-breakpoint
CREATE INDEX "consulta_cids_code_idx" ON "consulta_cids" USING btree ("cid_code");--> statement-breakpoint
CREATE INDEX "correction_consulta_idx" ON "consulta_correction_notes" USING btree ("consulta_id","created_at");--> statement-breakpoint
CREATE INDEX "correction_tenant_idx" ON "consulta_correction_notes" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "consultas_tenant_member_idx" ON "consultas" USING btree ("tenant_id","member_id","created_at");--> statement-breakpoint
CREATE INDEX "consultas_tenant_status_idx" ON "consultas" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "consultas_tenant_kind_idx" ON "consultas" USING btree ("tenant_id","kind");--> statement-breakpoint
CREATE INDEX "consultas_professional_idx" ON "consultas" USING btree ("professional_user_id","created_at");