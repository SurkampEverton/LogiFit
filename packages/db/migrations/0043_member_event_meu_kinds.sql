-- packages/db/migrations/0043_member_event_meu_kinds.sql
-- Sprint 02d3 — wrapMemberAction audit log automático em member_events.
--
-- Adiciona 15 novos kinds ao enum member_event_kind cobrindo todas as Server
-- Actions do member portal (Sprints 26 / 31 / 32 / 33 / 35a) que foram
-- migradas pra wrapMemberAction nos Sprints 02c2/02d.
--
-- Convenção `meu.<resource>.<verb>` distingue de staff-side `member.<verb>`
-- (Sprint 02 Faixa A). Member portal actions têm `actor_user_id IS NULL` em
-- member_events (paciente é actor, não staff).
--
-- **PostgreSQL ALTER TYPE ADD VALUE** requer 1 ALTER por value (não suporta
-- múltiplos em uma transação). Cada IF NOT EXISTS torna idempotente.

ALTER TYPE "public"."member_event_kind" ADD VALUE IF NOT EXISTS 'meu.appointment.cancelled';--> statement-breakpoint
ALTER TYPE "public"."member_event_kind" ADD VALUE IF NOT EXISTS 'meu.session.revoked';--> statement-breakpoint
ALTER TYPE "public"."member_event_kind" ADD VALUE IF NOT EXISTS 'meu.consent.updated';--> statement-breakpoint
ALTER TYPE "public"."member_event_kind" ADD VALUE IF NOT EXISTS 'meu.cross_prescription_alert.acknowledged';--> statement-breakpoint
ALTER TYPE "public"."member_event_kind" ADD VALUE IF NOT EXISTS 'meu.incident.acknowledged';--> statement-breakpoint
ALTER TYPE "public"."member_event_kind" ADD VALUE IF NOT EXISTS 'meu.cross_tenant_access.exported';--> statement-breakpoint
ALTER TYPE "public"."member_event_kind" ADD VALUE IF NOT EXISTS 'meu.exam.self_uploaded';--> statement-breakpoint
ALTER TYPE "public"."member_event_kind" ADD VALUE IF NOT EXISTS 'meu.device.connected';--> statement-breakpoint
ALTER TYPE "public"."member_event_kind" ADD VALUE IF NOT EXISTS 'meu.device.disconnected';--> statement-breakpoint
ALTER TYPE "public"."member_event_kind" ADD VALUE IF NOT EXISTS 'meu.device.consent_granted';--> statement-breakpoint
ALTER TYPE "public"."member_event_kind" ADD VALUE IF NOT EXISTS 'meu.device.consent_revoked';--> statement-breakpoint
ALTER TYPE "public"."member_event_kind" ADD VALUE IF NOT EXISTS 'meu.device.csv_imported';--> statement-breakpoint
ALTER TYPE "public"."member_event_kind" ADD VALUE IF NOT EXISTS 'meu.diary.meal_logged';--> statement-breakpoint
ALTER TYPE "public"."member_event_kind" ADD VALUE IF NOT EXISTS 'meu.diary.meal_deleted';--> statement-breakpoint
ALTER TYPE "public"."member_event_kind" ADD VALUE IF NOT EXISTS 'meu.mobile.push_token_registered';--> statement-breakpoint
ALTER TYPE "public"."member_event_kind" ADD VALUE IF NOT EXISTS 'meu.mobile.push_token_revoked';
