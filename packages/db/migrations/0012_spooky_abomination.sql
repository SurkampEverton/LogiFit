CREATE TABLE "alert_subscribers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"event_kind" text NOT NULL,
	"target_role" text NOT NULL,
	"notes" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "alert_subscribers_tenant_event_idx" ON "alert_subscribers" USING btree ("tenant_id","event_kind") WHERE active = true;