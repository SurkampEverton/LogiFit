'use server'

import { db } from '@repo/db/client'
import {
  type MemberRow,
  companies,
  memberEvents,
  memberNotes,
  memberTags,
  members,
  persons,
} from '@repo/db/schema'
import { ApiException } from '@repo/errors'
/**
 * Server Actions de `members` — Sprint 02 Faixa B (ADR 0011).
 *
 * `members.person_id` FK obrigatória pra `persons`. Identidade vem via
 * JOIN, nunca duplicada. Ver ADR 0011.
 *
 * **Eventos**: cada Server Action emite entry em `member_events`
 * (append-only) via INSERT fire-and-forget — futura Sprint 27 cross-alert
 * consome via Postgres LISTEN/NOTIFY.
 */
import { and, eq, ilike, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'
import { wrapServerAction } from '../../lib/wrap-action'

// ─── helpers ───────────────────────────────────────────────────────────
async function emitEvent(
  tenantId: string,
  memberId: string,
  actorUserId: string,
  kind:
    | 'member.created'
    | 'member.updated'
    | 'member.archived'
    | 'member.transferred'
    | 'member.note_added'
    | 'member.tag_added'
    | 'member.tag_removed',
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    await db.insert(memberEvents).values({
      tenantId,
      memberId,
      actorUserId,
      kind,
      payload,
    })
  } catch (err) {
    // Não bloqueia a Server Action principal — log fire-and-forget
    console.error('[members] emit event failed:', err instanceof Error ? err.message : err)
  }
}

// ─── listMembers ──────────────────────────────────────────────────────
const listInputSchema = z.object({
  query: z.string().trim().min(1).max(200).optional(),
  companyId: z.string().uuid().optional(),
  unitId: z.string().uuid().optional(),
  tag: z.string().trim().max(50).optional(),
  includeArchived: z.boolean().default(false),
  limit: z.number().int().min(1).max(100).default(20),
})

interface MemberWithPerson extends MemberRow {
  personName: string
  personDocument: string | null
  personEmail: string | null
}

export const listMembers = wrapServerAction(
  { module: 'members', action: 'member.list', resourceType: 'members' },
  async (rawInput: z.input<typeof listInputSchema>): Promise<MemberWithPerson[]> => {
    const input = listInputSchema.parse(rawInput)

    const conditions = []
    if (!input.includeArchived) conditions.push(isNull(members.archivedAt))
    if (input.companyId) conditions.push(eq(members.companyId, input.companyId))
    if (input.unitId) conditions.push(eq(members.homeUnitId, input.unitId))

    if (input.query) {
      const q = input.query
      const queryDigits = q.replace(/\D/g, '')
      const orParts = [ilike(persons.name, `%${q}%`), ilike(persons.email, `%${q}%`)]
      if (queryDigits.length >= 3) {
        orParts.push(ilike(persons.document, `%${queryDigits}%`))
      }
      // Aplicar OR via filtro sobre persons via subquery; pra simplicidade,
      // usamos ILIKE direto no JOIN (Postgres otimiza com pg_trgm — regra 30)
      conditions.push(
        sql`(${persons.name} ILIKE ${`%${q}%`} OR ${persons.email} ILIKE ${`%${q}%`}${
          queryDigits.length >= 3 ? sql` OR ${persons.document} ILIKE ${`%${queryDigits}%`}` : sql``
        })`,
      )
    }

    if (input.tag) {
      // Sub-select: members que TÊM essa tag
      conditions.push(
        sql`${members.id} IN (
          SELECT member_id FROM member_tags
          WHERE tenant_id = ${members.tenantId} AND tag = ${input.tag}
        )`,
      )
    }

    const rows = await db
      .select({
        id: members.id,
        tenantId: members.tenantId,
        personId: members.personId,
        companyId: members.companyId,
        homeUnitId: members.homeUnitId,
        familyHistory: members.familyHistory,
        archivedAt: members.archivedAt,
        archiveReason: members.archiveReason,
        createdAt: members.createdAt,
        updatedAt: members.updatedAt,
        personName: persons.name,
        personDocument: persons.document,
        personEmail: persons.email,
      })
      .from(members)
      .innerJoin(persons, eq(persons.id, members.personId))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(persons.name)
      .limit(input.limit)

    return rows as MemberWithPerson[]
  },
)

// ─── getMember (detalhe + tags) ─────────────────────────────────────────
const getInputSchema = z.object({
  id: z.string().uuid(),
})

export const getMember = wrapServerAction(
  { module: 'members', action: 'member.read', resourceType: 'members' },
  async (
    rawInput: z.input<typeof getInputSchema>,
  ): Promise<{
    member: MemberRow
    person: typeof persons.$inferSelect
    company: typeof companies.$inferSelect
    tags: string[]
  } | null> => {
    const input = getInputSchema.parse(rawInput)
    const rows = await db
      .select({ m: members, p: persons, c: companies })
      .from(members)
      .innerJoin(persons, eq(persons.id, members.personId))
      .innerJoin(companies, eq(companies.id, members.companyId))
      .where(eq(members.id, input.id))
      .limit(1)
    const row = rows[0]
    if (!row) return null

    const tagsResult = await db
      .select({ tag: memberTags.tag })
      .from(memberTags)
      .where(eq(memberTags.memberId, input.id))
    return {
      member: row.m,
      person: row.p,
      company: row.c,
      tags: tagsResult.map((t) => t.tag),
    }
  },
)

// ─── createMember ────────────────────────────────────────────────────
const createInputSchema = z.object({
  personId: z.string().uuid(),
  companyId: z.string().uuid(),
  homeUnitId: z.string().uuid().optional(),
  familyHistory: z
    .array(
      z.object({
        condition: z.string().trim().min(1).max(200),
        relative: z.string().trim().max(100).optional(),
        notes: z.string().trim().max(500).optional(),
      }),
    )
    .optional(),
})

export const createMember = wrapServerAction(
  { module: 'members', action: 'member.create', resourceType: 'members' },
  async (rawInput: z.input<typeof createInputSchema>, ctx): Promise<MemberRow> => {
    const input = createInputSchema.parse(rawInput)

    // Valida que person é PF (regra 24 — member é pessoa física)
    const personRows = await db
      .select({ kind: persons.kind })
      .from(persons)
      .where(eq(persons.id, input.personId))
      .limit(1)
    const personKind = personRows[0]?.kind
    if (!personKind) {
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Pessoa não encontrada',
        request_id: '',
      })
    }
    if (personKind !== 'pf') {
      throw new ApiException({
        code: 'VALIDATION_ERROR',
        message: 'Member deve ser pessoa física (PF); PJ não pode ser member',
        request_id: '',
      })
    }

    try {
      const [row] = await db
        .insert(members)
        .values({
          // why: ver pessoas/actions.ts — `current_setting` lança em conexão diferente
          // da que `withSessionContext` configurou. Passa do session enquanto wrap-action
          // não faz Drizzle-em-tx.
          tenantId: ctx.session.logifit.tenantId,
          personId: input.personId,
          companyId: input.companyId,
          homeUnitId: input.homeUnitId ?? null,
          familyHistory: input.familyHistory ?? null,
        })
        .returning()
      if (!row) {
        throw new ApiException({
          code: 'INTERNAL_ERROR',
          message: 'insert vazio',
          request_id: '',
        })
      }
      ctx.setAuditResource(row.id, { companyId: row.companyId })

      // Emite member.created
      await emitEvent(row.tenantId, row.id, ctx.session.logifit.userId, 'member.created', {
        personId: row.personId,
        companyId: row.companyId,
      })

      return row
    } catch (err) {
      if (err instanceof ApiException) throw err
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('members_tenant_person_uq')) {
        throw new ApiException({
          code: 'CONFLICT',
          message: 'Esta pessoa já é member deste tenant',
          request_id: '',
        })
      }
      throw err
    }
  },
)

// ─── updateMember ────────────────────────────────────────────────────
const updateInputSchema = z.object({
  id: z.string().uuid(),
  patch: z
    .object({
      companyId: z.string().uuid().optional(),
      homeUnitId: z.string().uuid().nullable().optional(),
      familyHistory: z
        .array(
          z.object({
            condition: z.string().min(1).max(200),
            relative: z.string().max(100).optional(),
            notes: z.string().max(500).optional(),
          }),
        )
        .optional(),
    })
    .refine((p) => Object.keys(p).length > 0, { message: 'patch vazio' }),
})

export const updateMember = wrapServerAction(
  { module: 'members', action: 'member.update', resourceType: 'members' },
  async (rawInput: z.input<typeof updateInputSchema>, ctx): Promise<MemberRow> => {
    const input = updateInputSchema.parse(rawInput)
    const [row] = await db
      .update(members)
      .set({ ...input.patch, updatedAt: new Date() })
      .where(eq(members.id, input.id))
      .returning()
    if (!row) {
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Member não encontrado',
        request_id: '',
      })
    }
    ctx.setAuditResource(row.id, { diff: Object.keys(input.patch) })
    await emitEvent(row.tenantId, row.id, ctx.session.logifit.userId, 'member.updated', {
      diff: Object.keys(input.patch),
    })
    return row
  },
)

// ─── archiveMember ────────────────────────────────────────────────────
const archiveInputSchema = z.object({
  id: z.string().uuid(),
  reason: z.string().trim().max(500).optional(),
})

export const archiveMember = wrapServerAction(
  { module: 'members', action: 'member.archive', resourceType: 'members' },
  async (rawInput: z.input<typeof archiveInputSchema>, ctx): Promise<MemberRow> => {
    const input = archiveInputSchema.parse(rawInput)
    const [row] = await db
      .update(members)
      .set({
        archivedAt: new Date(),
        archiveReason: input.reason ?? null,
        updatedAt: new Date(),
      })
      .where(eq(members.id, input.id))
      .returning()
    if (!row) {
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Member não encontrado',
        request_id: '',
      })
    }
    ctx.setAuditResource(row.id, { reason: input.reason })
    await emitEvent(row.tenantId, row.id, ctx.session.logifit.userId, 'member.archived', {
      reason: input.reason,
    })
    return row
  },
)

// ─── transferMember (regra 24/25 — clínico não cruza em franchise) ────
const transferInputSchema = z.object({
  id: z.string().uuid(),
  toCompanyId: z.string().uuid(),
})

export const transferMember = wrapServerAction(
  { module: 'members', action: 'member.transfer', resourceType: 'members' },
  async (rawInput: z.input<typeof transferInputSchema>, ctx): Promise<MemberRow> => {
    const input = transferInputSchema.parse(rawInput)

    // Sprint 02 MVP: transfer livre (mesmo tenant). Sprint 11+ adiciona
    // gate: se tenant.topology='franchise' E cross_company_access=false,
    // exige consent.cross_company_data_share (regra 25).
    const [row] = await db
      .update(members)
      .set({ companyId: input.toCompanyId, updatedAt: new Date() })
      .where(eq(members.id, input.id))
      .returning()
    if (!row) {
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Member não encontrado',
        request_id: '',
      })
    }
    ctx.setAuditResource(row.id, { toCompanyId: input.toCompanyId })
    await emitEvent(row.tenantId, row.id, ctx.session.logifit.userId, 'member.transferred', {
      toCompanyId: input.toCompanyId,
    })
    return row
  },
)

// ─── addNote (Nível 5 — // ai-blocked: regra 41 + 42) ────────────────
// ai-blocked: nota privada do profissional Nível 5; nunca exposta a IA nem
// cross-tenant via passaporte (regra 42).
const addNoteInputSchema = z.object({
  memberId: z.string().uuid(),
  body: z.string().trim().min(1).max(5000),
  visibility: z.enum(['author_only', 'unit', 'company', 'tenant']).default('company'),
})

export const addNote = wrapServerAction(
  { module: 'members', action: 'member.note_added', resourceType: 'member_notes' },
  async (
    rawInput: z.input<typeof addNoteInputSchema>,
    ctx,
  ): Promise<typeof memberNotes.$inferSelect> => {
    const input = addNoteInputSchema.parse(rawInput)
    const [row] = await db
      .insert(memberNotes)
      .values({
        tenantId: ctx.session.logifit.tenantId,
        memberId: input.memberId,
        authorUserId: ctx.session.logifit.userId,
        body: input.body,
        visibility: input.visibility,
      })
      .returning()
    if (!row) {
      throw new ApiException({
        code: 'INTERNAL_ERROR',
        message: 'insert vazio',
        request_id: '',
      })
    }
    ctx.setAuditResource(row.id, { visibility: row.visibility })
    await emitEvent(row.tenantId, row.memberId, ctx.session.logifit.userId, 'member.note_added', {
      noteId: row.id,
      visibility: row.visibility,
    })
    return row
  },
)

// ─── addTag / removeTag ─────────────────────────────────────────────
const tagInputSchema = z.object({
  memberId: z.string().uuid(),
  tag: z
    .string()
    .trim()
    .min(1)
    .max(50)
    .regex(/^[a-z0-9-]+$/, 'tag deve ser lowercase alfanum + hífen'),
})

export const addTag = wrapServerAction(
  { module: 'members', action: 'member.tag_added', resourceType: 'member_tags' },
  async (rawInput: z.input<typeof tagInputSchema>, ctx): Promise<{ tag: string }> => {
    const input = tagInputSchema.parse(rawInput)
    try {
      await db.insert(memberTags).values({
        tenantId: ctx.session.logifit.tenantId,
        memberId: input.memberId,
        tag: input.tag,
      })
      const tenantId = (
        await db
          .select({ tenantId: members.tenantId })
          .from(members)
          .where(eq(members.id, input.memberId))
          .limit(1)
      )[0]?.tenantId
      if (tenantId) {
        await emitEvent(tenantId, input.memberId, ctx.session.logifit.userId, 'member.tag_added', {
          tag: input.tag,
        })
      }
      return { tag: input.tag }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('member_tags_pk')) {
        return { tag: input.tag } // já existe — idempotente
      }
      throw err
    }
  },
)

export const removeTag = wrapServerAction(
  { module: 'members', action: 'member.tag_removed', resourceType: 'member_tags' },
  async (rawInput: z.input<typeof tagInputSchema>, ctx): Promise<{ tag: string }> => {
    const input = tagInputSchema.parse(rawInput)
    await db
      .delete(memberTags)
      .where(and(eq(memberTags.memberId, input.memberId), eq(memberTags.tag, input.tag)))
    const tenantId = (
      await db
        .select({ tenantId: members.tenantId })
        .from(members)
        .where(eq(members.id, input.memberId))
        .limit(1)
    )[0]?.tenantId
    if (tenantId) {
      await emitEvent(tenantId, input.memberId, ctx.session.logifit.userId, 'member.tag_removed', {
        tag: input.tag,
      })
    }
    return { tag: input.tag }
  },
)

// ─── listTimeline ────────────────────────────────────────────────────
const listTimelineInputSchema = z.object({
  memberId: z.string().uuid(),
  limit: z.number().int().min(1).max(200).default(50),
})

export const listTimeline = wrapServerAction(
  { module: 'members', action: 'member.timeline_read', resourceType: 'member_events' },
  async (
    rawInput: z.input<typeof listTimelineInputSchema>,
  ): Promise<(typeof memberEvents.$inferSelect)[]> => {
    const input = listTimelineInputSchema.parse(rawInput)
    return db
      .select()
      .from(memberEvents)
      .where(eq(memberEvents.memberId, input.memberId))
      .orderBy(memberEvents.at)
      .limit(input.limit)
  },
)

// ─── listNotes ────────────────────────────────────────────────────────
const listNotesInputSchema = z.object({
  memberId: z.string().uuid(),
})

export const listNotes = wrapServerAction(
  { module: 'members', action: 'member.notes_read', resourceType: 'member_notes' },
  async (
    rawInput: z.input<typeof listNotesInputSchema>,
  ): Promise<(typeof memberNotes.$inferSelect)[]> => {
    const input = listNotesInputSchema.parse(rawInput)
    return db
      .select()
      .from(memberNotes)
      .where(eq(memberNotes.memberId, input.memberId))
      .orderBy(memberNotes.createdAt)
  },
)
