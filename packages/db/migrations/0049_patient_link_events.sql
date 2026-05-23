-- packages/db/migrations/0049_patient_link_events.sql
-- Sprint 02c.4 — event log dedicado pro lifecycle de vínculos cross-tenant
-- (ADR 0077). Substitui timeline derivada de timestamps em
-- `/app/passport/invites/[id]` por evento append-only.
--
-- @volume_estimate_yearly: 16M+ (10k tenants × 200 pacientes × 8 eventos)
--
-- **Particionada por mês** (regra 34 + ADR 0072): created_at é a chave de
-- partição. PK composta (id, created_at) — Postgres exige incluir coluna de
-- partição na PK.
--
-- **Append-only** (regra 5): sem UPDATE/DELETE policy (ver 0061_patient_link_events_rls.sql).

-- ─── Enums ──────────────────────────────────────────────────────────────
CREATE TYPE "public"."passport_event_actor" AS ENUM (
  'professional',
  'patient',
  'system'
);
--> statement-breakpoint

CREATE TYPE "public"."passport_event_kind" AS ENUM (
  'invite_sent',         -- sendPatientInvite — link criado em 'pending'
  'invite_resent',       -- resendPatientInvite (Sprint 02d+) — re-dispatch sem mudar status
  'invite_cancelled',    -- cancelPatientInvite — staff cancela pending
  'link_accepted',       -- acceptPatientInvite — paciente aceita
  'link_revoked',        -- revokePatientLink — staff/paciente revoga active
  'module_added',        -- 1 por module no sendPatientInvite
  'module_activated',    -- module passa pra status='active' (accept ou substitute)
  'module_deactivated',  -- module passa pra status='inactive' (revoke ou substitute)
  'module_substituted',  -- confirmModuleSubstitution — passport global troca tenant
  'data_levels_changed'  -- setSharingLevel — staff ajusta dataLevels do module
);
--> statement-breakpoint

-- ─── Tabela parent (particionada) ────────────────────────────────────────
CREATE TABLE "patient_link_events" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "link_id" uuid,
  "passport_passport_id" uuid NOT NULL,
  "patient_person_id" uuid NOT NULL,
  "actor_kind" "passport_event_actor" NOT NULL,
  "actor_user_id" uuid,
  "event_kind" "passport_event_kind" NOT NULL,
  "payload" jsonb,
  "request_id" uuid,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY ("id", "created_at")
) PARTITION BY RANGE ("created_at");
--> statement-breakpoint

-- ─── Partições iniciais (8 meses cobrindo histórico recente + futuro) ───
-- Histórico anterior a 2026-05 nunca terá rows (tabela criada agora) — sem
-- partição. Janeiro 2027 em diante ativa via cron mensal (Sprint 02d).

CREATE TABLE "patient_link_events_202604" PARTITION OF "patient_link_events"
  FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');
--> statement-breakpoint
CREATE TABLE "patient_link_events_202605" PARTITION OF "patient_link_events"
  FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
--> statement-breakpoint
CREATE TABLE "patient_link_events_202606" PARTITION OF "patient_link_events"
  FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
--> statement-breakpoint
CREATE TABLE "patient_link_events_202607" PARTITION OF "patient_link_events"
  FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
--> statement-breakpoint
CREATE TABLE "patient_link_events_202608" PARTITION OF "patient_link_events"
  FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
--> statement-breakpoint
CREATE TABLE "patient_link_events_202609" PARTITION OF "patient_link_events"
  FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
--> statement-breakpoint
CREATE TABLE "patient_link_events_202610" PARTITION OF "patient_link_events"
  FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
--> statement-breakpoint
CREATE TABLE "patient_link_events_202611" PARTITION OF "patient_link_events"
  FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');
--> statement-breakpoint
CREATE TABLE "patient_link_events_202612" PARTITION OF "patient_link_events"
  FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');
--> statement-breakpoint

-- ─── Indexes (na tabela parent — propagam automaticamente pras partições) ─
CREATE INDEX "patient_link_events_tenant_at_idx"
  ON "patient_link_events" USING btree ("tenant_id", "created_at" DESC NULLS LAST);
--> statement-breakpoint
CREATE INDEX "patient_link_events_link_at_idx"
  ON "patient_link_events" USING btree ("link_id", "created_at" DESC NULLS LAST);
--> statement-breakpoint
CREATE INDEX "patient_link_events_passport_at_idx"
  ON "patient_link_events" USING btree ("passport_passport_id", "created_at" DESC NULLS LAST);
--> statement-breakpoint

COMMENT ON TABLE "patient_link_events" IS
  'Sprint 02c.4 — event log lifecycle vínculo cross-tenant (ADR 0077). Particionada mensal (regra 34 + ADR 0072); append-only (regra 5). Substitui timeline derivada de timestamps no /app/passport/invites/[id].';
--> statement-breakpoint
COMMENT ON COLUMN "patient_link_events"."actor_kind" IS
  'Quem causou o evento: professional (staff via /app/passport) | patient (/meu/* ou /i/[token]) | system (cron, trigger SQL, dispatcher).';
--> statement-breakpoint
COMMENT ON COLUMN "patient_link_events"."payload" IS
  'jsonb com refs + diffs (NUNCA PII bruto). Ex: module_added → { module, responsibleUserId, dataLevels }; link_revoked → { reason }.';
