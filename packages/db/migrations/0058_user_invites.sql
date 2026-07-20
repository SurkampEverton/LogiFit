-- packages/db/migrations/0058_user_invites.sql
-- Sprint 01c — Convites de staff (ADR 0103; débito #6 da auditoria 36b).
-- @volume_estimate_yearly: 5000 (regra 34 não aplica)

CREATE TABLE "user_invites" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "email" text NOT NULL,
  "name" text,
  "role_key" text DEFAULT 'contador_externo' NOT NULL,
  "token_hash" text NOT NULL,
  "invited_by_user_id" uuid,
  "expires_at" timestamp with time zone NOT NULL,
  "accepted_at" timestamp with time zone,
  "accepted_user_id" uuid,
  "revoked_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "user_invites_invited_by_user_id_users_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "users"("id"),
  CONSTRAINT "user_invites_accepted_user_id_users_id_fk" FOREIGN KEY ("accepted_user_id") REFERENCES "users"("id"),
  CONSTRAINT "user_invites_role_mvp" CHECK (role_key IN ('contador_externo')),
  CONSTRAINT "user_invites_state_exclusive" CHECK (NOT (accepted_at IS NOT NULL AND revoked_at IS NOT NULL)),
  CONSTRAINT "user_invites_accepted_consistency" CHECK ((accepted_at IS NULL) = (accepted_user_id IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "user_invites_token_hash_uq" ON "user_invites" ("token_hash");
--> statement-breakpoint
CREATE UNIQUE INDEX "user_invites_pending_uq" ON "user_invites" ("tenant_id", "email") WHERE accepted_at IS NULL AND revoked_at IS NULL;
--> statement-breakpoint
CREATE INDEX "user_invites_tenant_idx" ON "user_invites" ("tenant_id");
