CREATE TYPE "public"."ai_classifier_strictness" AS ENUM('strict', 'moderate');--> statement-breakpoint
CREATE TYPE "public"."exam_document_sensitivity" AS ENUM('normal', 'high');--> statement-breakpoint
CREATE TYPE "public"."exam_document_source" AS ENUM('professional_upload', 'patient_portal', 'patient_whatsapp', 'lab_integration_future');--> statement-breakpoint
CREATE TYPE "public"."exam_document_status" AS ENUM('uploaded', 'processing', 'pending_review', 'published', 'rejected', 'failed');--> statement-breakpoint
CREATE TABLE "exam_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"source" "exam_document_source" NOT NULL,
	"uploaded_by_user_id" uuid,
	"uploaded_by_member_id" uuid,
	"source_ref" uuid,
	"storage_path" text NOT NULL,
	"original_filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"file_size_bytes" integer,
	"sensitivity" "exam_document_sensitivity" DEFAULT 'normal' NOT NULL,
	"exam_type_detected" text,
	"laboratory" text,
	"collected_at" timestamp with time zone,
	"status" "exam_document_status" DEFAULT 'uploaded' NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"reviewed_at" timestamp with time zone,
	"reviewed_by_user_id" uuid,
	"rejection_reason" text,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exam_docs_uploader_consistency" CHECK (("exam_documents"."uploaded_by_user_id" IS NOT NULL OR "exam_documents"."uploaded_by_member_id" IS NOT NULL)),
	CONSTRAINT "exam_docs_review_consistency" CHECK ((status NOT IN ('published', 'rejected') OR (reviewed_by_user_id IS NOT NULL AND reviewed_at IS NOT NULL)))
);
--> statement-breakpoint
CREATE TABLE "exam_extractions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"exam_document_id" uuid NOT NULL,
	"raw_text" text,
	"ocr_provider" text,
	"ocr_confidence" numeric(4, 3),
	"structured_data" jsonb,
	"extraction_model" text,
	"extraction_at" timestamp with time zone DEFAULT now() NOT NULL,
	"extraction_cost_cents" integer,
	"cache_hit" boolean DEFAULT false NOT NULL,
	CONSTRAINT "exam_extractions_confidence_range" CHECK ("exam_extractions"."ocr_confidence" IS NULL OR ("exam_extractions"."ocr_confidence" >= 0 AND "exam_extractions"."ocr_confidence" <= 1))
);
--> statement-breakpoint
CREATE TABLE "exam_interpretations_draft" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"exam_document_id" uuid NOT NULL,
	"out_of_range" jsonb,
	"patterns" jsonb,
	"hypotheses" jsonb,
	"follow_up_suggestions" jsonb,
	"model_used" text NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"blocked_by_classifier" boolean DEFAULT false NOT NULL,
	"classifier_blocked_terms" jsonb,
	"generation_cost_cents" integer
);
--> statement-breakpoint
CREATE TABLE "exam_interpretations_final" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"exam_document_id" uuid NOT NULL,
	"accepted_patterns" jsonb,
	"accepted_hypotheses" jsonb,
	"rejected_hypotheses" jsonb,
	"professional_observations" text,
	"reviewed_by_user_id" uuid NOT NULL,
	"reviewed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exam_review_edits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"exam_document_id" uuid NOT NULL,
	"field_key" text NOT NULL,
	"before_value" jsonb,
	"after_value" jsonb,
	"edited_by_user_id" uuid NOT NULL,
	"edited_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant_exam_ai_settings" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"ai_extraction_enabled" boolean DEFAULT true NOT NULL,
	"ai_interpretation_enabled" boolean DEFAULT true NOT NULL,
	"classifier_strictness" "ai_classifier_strictness" DEFAULT 'strict' NOT NULL,
	"preferred_model" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "exam_documents" ADD CONSTRAINT "exam_documents_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_documents" ADD CONSTRAINT "exam_documents_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_documents" ADD CONSTRAINT "exam_documents_uploaded_by_member_id_members_id_fk" FOREIGN KEY ("uploaded_by_member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_documents" ADD CONSTRAINT "exam_documents_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_extractions" ADD CONSTRAINT "exam_extractions_exam_document_id_exam_documents_id_fk" FOREIGN KEY ("exam_document_id") REFERENCES "public"."exam_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_interpretations_draft" ADD CONSTRAINT "exam_interpretations_draft_exam_document_id_exam_documents_id_fk" FOREIGN KEY ("exam_document_id") REFERENCES "public"."exam_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_interpretations_final" ADD CONSTRAINT "exam_interpretations_final_exam_document_id_exam_documents_id_fk" FOREIGN KEY ("exam_document_id") REFERENCES "public"."exam_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_interpretations_final" ADD CONSTRAINT "exam_interpretations_final_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_review_edits" ADD CONSTRAINT "exam_review_edits_exam_document_id_exam_documents_id_fk" FOREIGN KEY ("exam_document_id") REFERENCES "public"."exam_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_review_edits" ADD CONSTRAINT "exam_review_edits_edited_by_user_id_users_id_fk" FOREIGN KEY ("edited_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "exam_docs_pending_idx" ON "exam_documents" USING btree ("tenant_id","uploaded_at" DESC NULLS LAST) WHERE status = 'pending_review';--> statement-breakpoint
CREATE INDEX "exam_docs_member_idx" ON "exam_documents" USING btree ("member_id","uploaded_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "exam_docs_tenant_status_idx" ON "exam_documents" USING btree ("tenant_id","status","uploaded_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "exam_docs_sensitive_idx" ON "exam_documents" USING btree ("tenant_id","member_id") WHERE sensitivity = 'high';--> statement-breakpoint
CREATE INDEX "exam_extractions_doc_idx" ON "exam_extractions" USING btree ("exam_document_id","extraction_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "exam_extractions_tenant_idx" ON "exam_extractions" USING btree ("tenant_id","extraction_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "exam_interp_draft_doc_idx" ON "exam_interpretations_draft" USING btree ("exam_document_id","generated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "exam_interp_draft_blocked_idx" ON "exam_interpretations_draft" USING btree ("tenant_id","generated_at" DESC NULLS LAST) WHERE blocked_by_classifier = true;--> statement-breakpoint
CREATE INDEX "exam_interp_final_doc_idx" ON "exam_interpretations_final" USING btree ("exam_document_id");--> statement-breakpoint
CREATE INDEX "exam_interp_final_reviewer_idx" ON "exam_interpretations_final" USING btree ("reviewed_by_user_id","reviewed_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "exam_review_edits_doc_idx" ON "exam_review_edits" USING btree ("exam_document_id","edited_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "exam_review_edits_user_idx" ON "exam_review_edits" USING btree ("edited_by_user_id","edited_at" DESC NULLS LAST);