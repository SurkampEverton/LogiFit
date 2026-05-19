/**
 * Members — Sprint 02 (ADR 0011 esperado).
 *
 * **Modelo: Member como perfil único cross-module.**
 * - `members.person_id` FK obrigatória pra `persons` (Sprint 01a — ADR 0047)
 * - Identidade (nome, document, email, phone, address, birth_date) vem via JOIN
 *   com `persons` — NUNCA duplicada em `members`
 * - Tabelas de vertical (Sprint 11 prescrições, Sprint 12 avaliações, Sprint 20
 *   prontuário fisio, Sprint 29 nutri plano alimentar, etc) referenciam
 *   `member_id` mas continuam consumindo identidade via persons
 *
 * **Timeline event-sourced** — `member_events` é append-only (trigger proíbe
 * UPDATE/DELETE). Cada vertical emite seus eventos. Sprint 04+ amplia kinds.
 *
 * **Notes** (`member_notes`) é **Nível 5 — nunca cruza tenant** (regra 42).
 *
 * **Particionamento** de `member_events`: ADR 0072 + regra 34 prevê PARTITION
 * BY trimestre desde dia 1. **Adiado pra Sprint 04+** (volume MVP <10k até
 * primeiro tenant operacional; particionamento real custa migration complexa).
 *
 * RLS por tenant_id (Sprint 01a Faixa A pattern). Scope por
 * `company_id`/`home_unit_id` aplicado em policies via `user_roles.scope_*`
 * (regra 25 — fisio só vê member de sua company em franchise).
 */
import { sql } from 'drizzle-orm'
import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { companies, units, users } from './identity'
import { persons } from './persons'

// Tipos de evento canônicos (Sprint 02 — kinds básicos; verticais ampliam)
export const memberEventKindEnum = pgEnum('member_event_kind', [
  // Staff-side member lifecycle (Sprint 02 Faixa A)
  'member.created',
  'member.updated',
  'member.archived',
  'member.transferred', // entre companies
  'member.note_added',
  'member.tag_added',
  'member.tag_removed',
  // Member portal actions (Sprint 02c2 wrapMemberAction audit Sprint 02d3)
  // — paciente é actor (actor_user_id NULL pra distinguir de staff)
  'meu.appointment.cancelled', // Sprint 26 cancelMyAppointment
  'meu.session.revoked', // Sprint 26 revokeMySession
  'meu.consent.updated', // Sprint 26 updateMyConsent
  'meu.cross_prescription_alert.acknowledged', // Sprint 26 acknowledgeCrossPrescriptionAlert
  'meu.incident.acknowledged', // Sprint 26 acknowledgeIncident
  'meu.cross_tenant_access.exported', // Sprint 26 exportCrossTenantAccessLog (LGPD art. 18 V)
  'meu.exam.self_uploaded', // Sprint 33 selfUploadExam
  'meu.device.connected', // Sprint 32 startConnection (após complete)
  'meu.device.disconnected', // Sprint 32 disconnect
  'meu.device.consent_granted', // Sprint 32 grantDeviceConsent
  'meu.device.consent_revoked', // Sprint 32 revokeDeviceConsent
  'meu.device.csv_imported', // Sprint 32 importInBodyCsv
  'meu.diary.meal_logged', // Sprint 31 logMeal
  'meu.diary.meal_deleted', // Sprint 31 deleteDiaryEntry
  'meu.mobile.push_token_registered', // Sprint 35a registerPushToken
  'meu.mobile.push_token_revoked', // Sprint 35a revokeMyPushToken
  // Sprint 03+ amplia verticais: agenda.booked, evolucao.created, invoice.paid, etc
])

// Visibilidade de note — controle granular regra 42
export const memberNoteVisibilityEnum = pgEnum('member_note_visibility', [
  'author_only', // só quem escreveu vê
  'unit', // todos na mesma unit
  'company', // todos na mesma company
  'tenant', // tenant inteiro
])

// ─── members ─────────────────────────────────────────────────────────────
export const members = pgTable(
  'members',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),

    // Identidade vem via persons (ADR 0047)
    personId: uuid('person_id')
      .notNull()
      .references(() => persons.id, { onDelete: 'restrict' }),

    // Hierarquia (regra 25 — clínico não cruza company em franchise)
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    homeUnitId: uuid('home_unit_id').references(() => units.id),

    // Anamnese: histórico familiar (diabetes, hipertensão, câncer, etc).
    // Sprint 20 (prontuário fisio) + Sprint 29 (nutri) consomem.
    // Armazenado em jsonb pra evolução sem migrations: array<{condition, relative?, notes?}>.
    familyHistory: jsonb('family_history'),

    // Soft-delete (regra 5 + LGPD — preserva trilha mesmo arquivado)
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    archiveReason: text('archive_reason'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // 1 member por (tenant, person) — mesma pessoa não vira 2 members no mesmo tenant
    uniqueIndex('members_tenant_person_uq').on(t.tenantId, t.personId),
    index('members_tenant_company_idx').on(t.tenantId, t.companyId),
    index('members_tenant_unit_idx').on(t.tenantId, t.homeUnitId),
    // Filtro "ativos": archivedAt IS NULL — lookup quente
    index('members_active_idx')
      .on(t.tenantId, t.companyId)
      .where(sql`${t.archivedAt} IS NULL`),
  ],
)

// ─── member_events ───────────────────────────────────────────────────────
// Timeline append-only. Trigger proíbe UPDATE/DELETE (regra 5).
// Particionamento adiado (Sprint 04+).
export const memberEvents = pgTable(
  'member_events',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'cascade' }),

    actorUserId: uuid('actor_user_id').references(() => users.id), // null = system event
    kind: memberEventKindEnum('kind').notNull(),
    payload: jsonb('payload'), // dados estruturados do evento (diff, ref ids, etc)

    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('member_events_member_at_idx').on(t.memberId, t.at.desc()),
    index('member_events_tenant_at_idx').on(t.tenantId, t.at.desc()),
    index('member_events_tenant_kind_idx').on(t.tenantId, t.kind),
  ],
)

// ─── member_notes ────────────────────────────────────────────────────────
// Anotações livres. **Nível 5 — nunca cruza tenant via passaporte (regra 42).**
// `// ai-blocked` no Server Action `addNote` (lint regra 41).
export const memberNotes = pgTable(
  'member_notes',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'cascade' }),
    authorUserId: uuid('author_user_id')
      .notNull()
      .references(() => users.id),

    body: text('body').notNull(),
    visibility: memberNoteVisibilityEnum('visibility').notNull().default('company'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('member_notes_member_idx').on(t.memberId, t.createdAt.desc()),
    index('member_notes_tenant_idx').on(t.tenantId),
  ],
)

// ─── member_tags ─────────────────────────────────────────────────────────
// PK composta (tenant_id, member_id, tag) — sem duplicação semântica.
export const memberTags = pgTable(
  'member_tags',
  {
    tenantId: uuid('tenant_id').notNull(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'cascade' }),
    tag: text('tag').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('member_tags_pk').on(t.tenantId, t.memberId, t.tag),
    index('member_tags_tag_idx').on(t.tenantId, t.tag), // busca por tag
  ],
)

export type MemberRow = typeof members.$inferSelect
export type MemberInsert = typeof members.$inferInsert
export type MemberEventRow = typeof memberEvents.$inferSelect
export type MemberEventInsert = typeof memberEvents.$inferInsert
export type MemberNoteRow = typeof memberNotes.$inferSelect
export type MemberTagRow = typeof memberTags.$inferSelect
