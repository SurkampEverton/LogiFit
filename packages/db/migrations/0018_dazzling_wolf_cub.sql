CREATE TYPE "public"."assessment_category" AS ENUM('composicao_corporal', 'escala_funcional', 'anamnese', 'teste_funcional', 'custom');--> statement-breakpoint
CREATE TYPE "public"."assessment_vertical" AS ENUM('academia', 'fisio', 'nutri');--> statement-breakpoint
CREATE TYPE "public"."measurement_source" AS ENUM('manual', 'device', 'import_csv');--> statement-breakpoint
CREATE TYPE "public"."assessment_photo_kind" AS ENUM('front', 'back', 'side_left', 'side_right', 'custom');--> statement-breakpoint
CREATE TABLE "assessment_calculations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"assessment_id" uuid NOT NULL,
	"calc_key" text NOT NULL,
	"value" numeric(12, 4) NOT NULL,
	"classification" text,
	"calculated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assessment_measurements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"assessment_id" uuid NOT NULL,
	"field_key" text NOT NULL,
	"value_num" numeric(12, 4),
	"value_text" text,
	"value_enum" text,
	"source" "measurement_source" DEFAULT 'manual' NOT NULL,
	"source_device_reading_id" uuid,
	"validated_by_user_id" uuid,
	"validated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assessment_measurements_has_value" CHECK (("assessment_measurements"."value_num" IS NOT NULL) OR ("assessment_measurements"."value_text" IS NOT NULL) OR ("assessment_measurements"."value_enum" IS NOT NULL)),
	CONSTRAINT "assessment_measurements_device_requires_validation" CHECK ("assessment_measurements"."source" <> 'device' OR ("assessment_measurements"."validated_by_user_id" IS NOT NULL AND "assessment_measurements"."validated_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "assessment_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"assessment_id" uuid NOT NULL,
	"storage_path" text NOT NULL,
	"kind" "assessment_photo_kind" DEFAULT 'custom' NOT NULL,
	"scan_status" text DEFAULT 'pending',
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"uploaded_by_user_id" uuid
);
--> statement-breakpoint
CREATE TABLE "assessment_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"name" text NOT NULL,
	"description" text,
	"vertical" "assessment_vertical",
	"category" "assessment_category" NOT NULL,
	"fields" jsonb NOT NULL,
	"scoring_method" jsonb,
	"clinical_reference" text,
	"version" integer DEFAULT 1 NOT NULL,
	"parent_type_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"archived_at" timestamp with time zone,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assessment_types_version_positive" CHECK ("assessment_types"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "assessments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"assessment_type_id" uuid NOT NULL,
	"type_version" integer NOT NULL,
	"performed_at" timestamp with time zone NOT NULL,
	"performed_by_user_id" uuid,
	"notes" text,
	"soft_deleted_at" timestamp with time zone,
	"soft_delete_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assessment_calculations" ADD CONSTRAINT "assessment_calculations_assessment_id_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."assessments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_measurements" ADD CONSTRAINT "assessment_measurements_assessment_id_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."assessments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_measurements" ADD CONSTRAINT "assessment_measurements_validated_by_user_id_users_id_fk" FOREIGN KEY ("validated_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_photos" ADD CONSTRAINT "assessment_photos_assessment_id_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."assessments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_photos" ADD CONSTRAINT "assessment_photos_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_types" ADD CONSTRAINT "assessment_types_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_assessment_type_id_assessment_types_id_fk" FOREIGN KEY ("assessment_type_id") REFERENCES "public"."assessment_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_performed_by_user_id_users_id_fk" FOREIGN KEY ("performed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "assessment_calculations_unique" ON "assessment_calculations" USING btree ("assessment_id","calc_key");--> statement-breakpoint
CREATE INDEX "assessment_calculations_tenant_key_idx" ON "assessment_calculations" USING btree ("tenant_id","calc_key");--> statement-breakpoint
CREATE UNIQUE INDEX "assessment_measurements_unique" ON "assessment_measurements" USING btree ("assessment_id","field_key");--> statement-breakpoint
CREATE INDEX "assessment_measurements_tenant_idx" ON "assessment_measurements" USING btree ("tenant_id","field_key");--> statement-breakpoint
CREATE INDEX "assessment_photos_assessment_idx" ON "assessment_photos" USING btree ("assessment_id");--> statement-breakpoint
CREATE INDEX "assessment_photos_tenant_idx" ON "assessment_photos" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "assessment_types_tenant_category_idx" ON "assessment_types" USING btree ("tenant_id","category") WHERE active = true AND archived_at IS NULL;--> statement-breakpoint
CREATE INDEX "assessment_types_global_idx" ON "assessment_types" USING btree ("category") WHERE tenant_id IS NULL AND active = true AND archived_at IS NULL;--> statement-breakpoint
CREATE INDEX "assessment_types_parent_idx" ON "assessment_types" USING btree ("parent_type_id");--> statement-breakpoint
CREATE INDEX "assessments_tenant_member_idx" ON "assessments" USING btree ("tenant_id","member_id","performed_at");--> statement-breakpoint
CREATE INDEX "assessments_type_idx" ON "assessments" USING btree ("assessment_type_id");--> statement-breakpoint
CREATE INDEX "assessments_active_idx" ON "assessments" USING btree ("tenant_id","member_id") WHERE soft_deleted_at IS NULL;