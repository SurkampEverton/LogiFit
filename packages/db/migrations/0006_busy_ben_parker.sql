ALTER TABLE "user_permission_grants" ADD COLUMN "revoked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_permission_grants" ADD COLUMN "revoked_reason" text;