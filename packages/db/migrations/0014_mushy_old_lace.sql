CREATE TYPE "public"."ai_committee_role" AS ENUM('coordenador', 'medico', 'enfermeiro', 'fisio', 'nutri', 'ti', 'dpo', 'juridico', 'paciente');--> statement-breakpoint
CREATE TYPE "public"."ai_committee_status" AS ENUM('draft', 'active', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."data_subject_request_kind" AS ENUM('access', 'anonymization', 'deletion', 'correction', 'portability', 'consent_revocation', 'opposition');--> statement-breakpoint
CREATE TYPE "public"."data_subject_request_state" AS ENUM('received', 'triaged', 'in_progress', 'awaiting_titular', 'fulfilled', 'partially_fulfilled', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."pam_reason" AS ENUM('support', 'incident_response', 'data_subject_request', 'audit', 'migration', 'forensics');--> statement-breakpoint
CREATE TABLE "ai_committee_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"committee_id" uuid NOT NULL,
	"decided_at" timestamp with time zone NOT NULL,
	"subject" text NOT NULL,
	"decision" text NOT NULL,
	"rationale" text NOT NULL,
	"minute_url" text,
	"minute_hash" text,
	"recorded_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_committee_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"committee_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"role" "ai_committee_role" NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ai_committees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"status" "ai_committee_status" DEFAULT 'draft' NOT NULL,
	"charted_at" timestamp with time zone,
	"chart_url" text,
	"chart_hash" text,
	"bylaws" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "data_subject_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"subject_person_id" uuid,
	"subject_email" text,
	"subject_name" text,
	"subject_document" text,
	"kind" "data_subject_request_kind" NOT NULL,
	"state" "data_subject_request_state" DEFAULT 'received' NOT NULL,
	"request_payload" jsonb,
	"fulfillment_payload" jsonb,
	"triage_notes" text,
	"triaged_by_user_id" uuid,
	"triaged_at" timestamp with time zone,
	"fulfilled_at" timestamp with time zone,
	"fulfilled_by_user_id" uuid,
	"rejection_reason" text,
	"legal_basis_cited" text,
	"sla_due_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "privileged_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operator_user_id" uuid NOT NULL,
	"target_tenant_id" uuid NOT NULL,
	"reason" "pam_reason" NOT NULL,
	"rationale" text NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"approved_by_user_id" uuid,
	"approved_at" timestamp with time zone,
	"activated_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"close_reason" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "privileged_sessions_state_valid" CHECK ("privileged_sessions"."state" IN ('pending', 'active', 'closed', 'rejected')),
	CONSTRAINT "privileged_sessions_two_eye_when_active" CHECK ((state != 'active') OR (approved_by_user_id IS NOT NULL AND approved_by_user_id != operator_user_id))
);
--> statement-breakpoint
ALTER TABLE "ai_committee_decisions" ADD CONSTRAINT "ai_committee_decisions_committee_id_ai_committees_id_fk" FOREIGN KEY ("committee_id") REFERENCES "public"."ai_committees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_committee_decisions" ADD CONSTRAINT "ai_committee_decisions_recorded_by_user_id_users_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_committee_members" ADD CONSTRAINT "ai_committee_members_committee_id_ai_committees_id_fk" FOREIGN KEY ("committee_id") REFERENCES "public"."ai_committees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_committee_members" ADD CONSTRAINT "ai_committee_members_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_subject_requests" ADD CONSTRAINT "data_subject_requests_subject_person_id_persons_id_fk" FOREIGN KEY ("subject_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_subject_requests" ADD CONSTRAINT "data_subject_requests_triaged_by_user_id_users_id_fk" FOREIGN KEY ("triaged_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_subject_requests" ADD CONSTRAINT "data_subject_requests_fulfilled_by_user_id_users_id_fk" FOREIGN KEY ("fulfilled_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privileged_sessions" ADD CONSTRAINT "privileged_sessions_operator_user_id_users_id_fk" FOREIGN KEY ("operator_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privileged_sessions" ADD CONSTRAINT "privileged_sessions_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_committee_decisions_committee_idx" ON "ai_committee_decisions" USING btree ("committee_id","decided_at");--> statement-breakpoint
CREATE INDEX "ai_committee_members_committee_idx" ON "ai_committee_members" USING btree ("committee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_committee_members_active_uq" ON "ai_committee_members" USING btree ("committee_id","person_id","role") WHERE ended_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_committees_tenant_active_uq" ON "ai_committees" USING btree ("tenant_id") WHERE status = 'active';--> statement-breakpoint
CREATE INDEX "ai_committees_tenant_idx" ON "ai_committees" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "dsr_tenant_state_idx" ON "data_subject_requests" USING btree ("tenant_id","state","created_at");--> statement-breakpoint
CREATE INDEX "dsr_subject_idx" ON "data_subject_requests" USING btree ("subject_person_id");--> statement-breakpoint
CREATE INDEX "dsr_sla_idx" ON "data_subject_requests" USING btree ("tenant_id","sla_due_at") WHERE state NOT IN ('fulfilled', 'partially_fulfilled', 'rejected', 'cancelled');--> statement-breakpoint
CREATE INDEX "privileged_sessions_target_idx" ON "privileged_sessions" USING btree ("target_tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "privileged_sessions_operator_idx" ON "privileged_sessions" USING btree ("operator_user_id","created_at");--> statement-breakpoint
CREATE INDEX "privileged_sessions_active_idx" ON "privileged_sessions" USING btree ("target_tenant_id") WHERE state = 'active';