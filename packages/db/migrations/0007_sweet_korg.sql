CREATE TYPE "public"."member_event_kind" AS ENUM('member.created', 'member.updated', 'member.archived', 'member.transferred', 'member.note_added', 'member.tag_added', 'member.tag_removed');--> statement-breakpoint
CREATE TYPE "public"."member_note_visibility" AS ENUM('author_only', 'unit', 'company', 'tenant');--> statement-breakpoint
CREATE TABLE "member_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"kind" "member_event_kind" NOT NULL,
	"payload" jsonb,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"author_user_id" uuid NOT NULL,
	"body" text NOT NULL,
	"visibility" "member_note_visibility" DEFAULT 'company' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member_tags" (
	"tenant_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"tag" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"home_unit_id" uuid,
	"family_history" jsonb,
	"archived_at" timestamp with time zone,
	"archive_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "member_events" ADD CONSTRAINT "member_events_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_events" ADD CONSTRAINT "member_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_notes" ADD CONSTRAINT "member_notes_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_notes" ADD CONSTRAINT "member_notes_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_tags" ADD CONSTRAINT "member_tags_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_home_unit_id_units_id_fk" FOREIGN KEY ("home_unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "member_events_member_at_idx" ON "member_events" USING btree ("member_id","at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "member_events_tenant_at_idx" ON "member_events" USING btree ("tenant_id","at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "member_events_tenant_kind_idx" ON "member_events" USING btree ("tenant_id","kind");--> statement-breakpoint
CREATE INDEX "member_notes_member_idx" ON "member_notes" USING btree ("member_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "member_notes_tenant_idx" ON "member_notes" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "member_tags_pk" ON "member_tags" USING btree ("tenant_id","member_id","tag");--> statement-breakpoint
CREATE INDEX "member_tags_tag_idx" ON "member_tags" USING btree ("tenant_id","tag");--> statement-breakpoint
CREATE UNIQUE INDEX "members_tenant_person_uq" ON "members" USING btree ("tenant_id","person_id");--> statement-breakpoint
CREATE INDEX "members_tenant_company_idx" ON "members" USING btree ("tenant_id","company_id");--> statement-breakpoint
CREATE INDEX "members_tenant_unit_idx" ON "members" USING btree ("tenant_id","home_unit_id");--> statement-breakpoint
CREATE INDEX "members_active_idx" ON "members" USING btree ("tenant_id","company_id") WHERE "members"."archived_at" IS NULL;