CREATE TYPE "public"."evolucao_attachment_kind" AS ENUM('exame_imagem', 'video_execucao', 'documento', 'foto_postural', 'audio_anamnese');--> statement-breakpoint
CREATE TYPE "public"."evolucao_attachment_scan_status" AS ENUM('pending', 'clean', 'rejected', 'soft_deleted');--> statement-breakpoint
CREATE TYPE "public"."evolucao_status" AS ENUM('draft', 'locked', 'signed');--> statement-breakpoint
CREATE TABLE "evolucao_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"evolucao_id" uuid NOT NULL,
	"kind" "evolucao_attachment_kind" NOT NULL,
	"storage_path" text NOT NULL,
	"storage_bucket" text DEFAULT 'fisio-evolucoes' NOT NULL,
	"filename" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"mime_type" text NOT NULL,
	"content_hash" text,
	"scan_status" "evolucao_attachment_scan_status" DEFAULT 'pending' NOT NULL,
	"scan_reason" text,
	"caption" text,
	"uploaded_by_user_id" uuid NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"soft_deleted_at" timestamp with time zone,
	"soft_deleted_by_user_id" uuid,
	"soft_delete_reason" text,
	CONSTRAINT "evol_att_size_positive" CHECK (size_bytes > 0 AND size_bytes <= 52428800)
);
--> statement-breakpoint
CREATE TABLE "evolucoes_sessao" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"appointment_id" uuid,
	"professional_user_id" uuid NOT NULL,
	"soap" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"free_text" text,
	"status" "evolucao_status" DEFAULT 'draft' NOT NULL,
	"locked_at" timestamp with time zone,
	"locked_by_user_id" uuid,
	"signed_at" timestamp with time zone,
	"signed_hash" text,
	"signature_provider" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "evol_signed_consistent" CHECK ((status != 'signed' OR (signed_at IS NOT NULL AND signed_hash IS NOT NULL))),
	CONSTRAINT "evol_locked_consistent" CHECK ((status NOT IN ('locked','signed') OR locked_at IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "evolucao_attachments" ADD CONSTRAINT "evolucao_attachments_evolucao_id_evolucoes_sessao_id_fk" FOREIGN KEY ("evolucao_id") REFERENCES "public"."evolucoes_sessao"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evolucao_attachments" ADD CONSTRAINT "evolucao_attachments_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evolucao_attachments" ADD CONSTRAINT "evolucao_attachments_soft_deleted_by_user_id_users_id_fk" FOREIGN KEY ("soft_deleted_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evolucoes_sessao" ADD CONSTRAINT "evolucoes_sessao_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evolucoes_sessao" ADD CONSTRAINT "evolucoes_sessao_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evolucoes_sessao" ADD CONSTRAINT "evolucoes_sessao_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evolucoes_sessao" ADD CONSTRAINT "evolucoes_sessao_professional_user_id_users_id_fk" FOREIGN KEY ("professional_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evolucoes_sessao" ADD CONSTRAINT "evolucoes_sessao_locked_by_user_id_users_id_fk" FOREIGN KEY ("locked_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "evol_att_evolucao_idx" ON "evolucao_attachments" USING btree ("evolucao_id") WHERE soft_deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "evol_att_tenant_idx" ON "evolucao_attachments" USING btree ("tenant_id","uploaded_at");--> statement-breakpoint
CREATE INDEX "evol_att_scan_pending_idx" ON "evolucao_attachments" USING btree ("scan_status") WHERE scan_status = 'pending';--> statement-breakpoint
CREATE INDEX "evol_tenant_member_idx" ON "evolucoes_sessao" USING btree ("tenant_id","member_id","created_at");--> statement-breakpoint
CREATE INDEX "evol_tenant_prof_idx" ON "evolucoes_sessao" USING btree ("professional_user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "evol_appointment_uq" ON "evolucoes_sessao" USING btree ("appointment_id") WHERE appointment_id IS NOT NULL;