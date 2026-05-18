'use server'

/**
 * Server Actions Suplementação + Exames Laboratoriais — Sprint 30 Faixa B.2 (ADR 0082).
 *
 * Actions:
 *   Supplements:
 *     - searchSupplements({query, kind?, includeGlobal})
 *     - createTenantSupplement(input)
 *     - listSupplementInteractions(supplementId)
 *     - prescribeSupplement(input) — cria supplement_prescriptions
 *     - listMemberSupplementPrescriptions(memberId, onlyActive)
 *     - discontinueSupplementPrescription(id, reason)
 *   Lab:
 *     - listLabAnalytes(category?)
 *     - getLabAnalyteWithReferences(analyteId)
 *     - registerLabResult(input) — calcula out_of_range via lib pura
 *     - listMemberLabResults(memberId, analyteId?, fromDate?, toDate?)
 *     - compareAnalyteOverTime(memberId, analyteId)
 */

import { db } from '@repo/db/client'
import {
  labAnalytes,
  labReferenceRanges,
  labResults,
  members,
  persons,
  supplementInteractions,
  supplementPrescriptions,
  supplements,
} from '@repo/db/schema'
import {
  ageYearsAt,
  classifyLabResult,
  type LabReferenceRange,
  type Sex,
} from '@repo/db/nutri'
import { ApiException } from '@repo/errors'
import { and, asc, desc, eq, gte, ilike, isNull, lte, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { wrapServerAction } from '../../../lib/wrap-action'

const SUPPLEMENT_KIND_ENUM = [
  'vitamin',
  'mineral',
  'fitoterapico',
  'aminoacid',
  'protein_powder',
  'blend',
  'omega',
  'probiotic',
  'enzyme',
  'pre_workout',
  'other',
] as const

const SEX_ENUM = ['male', 'female', 'any'] as const

// ─── Zod ─────────────────────────────────────────────────────────────────

const SearchSupplementsSchema = z.object({
  query: z.string().max(120).optional().nullable(),
  kind: z.enum(SUPPLEMENT_KIND_ENUM).optional().nullable(),
  includeGlobal: z.boolean().default(true),
  includeTenantCustom: z.boolean().default(true),
  limit: z.number().int().min(1).max(200).default(50),
})

const CreateSupplementSchema = z.object({
  name: z.string().min(2).max(200),
  kind: z.enum(SUPPLEMENT_KIND_ENUM),
  brand: z.string().max(120).optional().nullable(),
  concentration: z.string().max(120).optional().nullable(),
  anvisaRegistration: z.string().max(40).optional().nullable(),
  indication: z.string().max(500).optional().nullable(),
  contraindications: z.string().max(1000).optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
})

const PrescribeSupplementSchema = z.object({
  memberId: z.string().uuid(),
  supplementId: z.string().uuid(),
  consultaId: z.string().uuid().optional().nullable(),
  dose: z.string().min(1).max(60),
  frequency: z.string().min(1).max(120),
  route: z.enum(['oral', 'sublingual', 'topical', 'injectable', 'other']).default('oral'),
  durationDays: z.number().int().min(1).max(3650).optional().nullable(),
  startedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes: z.string().max(1000).optional().nullable(),
})

const DiscontinueSchema = z.object({
  prescriptionId: z.string().uuid(),
  reason: z.string().min(2).max(500),
})

const RegisterLabResultSchema = z.object({
  memberId: z.string().uuid(),
  analyteId: z.string().uuid(),
  value: z.number(),
  unit: z.string().min(1).max(20),
  collectedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  laboratory: z.string().max(200).optional().nullable(),
  consultaId: z.string().uuid().optional().nullable(),
  attachmentStoragePath: z.string().max(500).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  /** Override do member.condition (gestante, diabético, etc) pra escolher range mais específica */
  condition: z.string().max(80).optional().nullable(),
})

const CompareSchema = z.object({
  memberId: z.string().uuid(),
  analyteId: z.string().uuid(),
})

// ─── searchSupplements ──────────────────────────────────────────────────

export const searchSupplements = wrapServerAction(
  { module: 'nutri', action: 'supplement.search' },
  async (input: z.infer<typeof SearchSupplementsSchema>, { session }) => {
    const parsed = SearchSupplementsSchema.parse(input)
    const tenantId = session.logifit.tenantId

    const conditions = [eq(supplements.active, true)]
    if (parsed.kind) conditions.push(eq(supplements.kind, parsed.kind))
    if (parsed.query && parsed.query.trim().length > 0) {
      conditions.push(ilike(supplements.nameNormalized, `%${parsed.query.toLowerCase()}%`))
    }

    const scopeOr: ReturnType<typeof or>[] = []
    if (parsed.includeGlobal) scopeOr.push(isNull(supplements.tenantId))
    if (parsed.includeTenantCustom) scopeOr.push(eq(supplements.tenantId, tenantId))
    if (scopeOr.length === 0) return { ok: true as const, rows: [] }

    const rows = await db
      .select()
      .from(supplements)
      .where(and(...conditions, or(...scopeOr)))
      .orderBy(asc(supplements.name))
      .limit(parsed.limit)
    return { ok: true as const, rows }
  },
)

// ─── createTenantSupplement ─────────────────────────────────────────────

export const createTenantSupplement = wrapServerAction(
  {
    module: 'nutri',
    action: 'supplement.create',
    resourceType: 'supplements',
  },
  async (input: z.infer<typeof CreateSupplementSchema>, { session, setAuditResource }) => {
    const parsed = CreateSupplementSchema.parse(input)
    const tenantId = session.logifit.tenantId
    const nameNormalized = parsed.name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')

    const [row] = await db
      .insert(supplements)
      .values({
        tenantId,
        name: parsed.name,
        nameNormalized,
        kind: parsed.kind,
        brand: parsed.brand ?? null,
        concentration: parsed.concentration ?? null,
        anvisaRegistration: parsed.anvisaRegistration ?? null,
        indication: parsed.indication ?? null,
        contraindications: parsed.contraindications ?? null,
        notes: parsed.notes ?? null,
        createdByUserId: session.user.id,
      })
      .returning({ id: supplements.id })

    setAuditResource(row!.id, { name: parsed.name, kind: parsed.kind })
    return { ok: true as const, id: row!.id }
  },
)

// ─── listSupplementInteractions ─────────────────────────────────────────

export const listSupplementInteractions = wrapServerAction(
  { module: 'nutri', action: 'supplement.interactions.list' },
  async (input: { supplementId: string }, { session }) => {
    const parsed = z.object({ supplementId: z.string().uuid() }).parse(input)
    const tenantId = session.logifit.tenantId

    const rows = await db
      .select()
      .from(supplementInteractions)
      .where(
        and(
          eq(supplementInteractions.supplementId, parsed.supplementId),
          or(
            isNull(supplementInteractions.tenantId),
            eq(supplementInteractions.tenantId, tenantId),
          ),
        ),
      )
      .orderBy(desc(supplementInteractions.severity), asc(supplementInteractions.interactsWith))
    return { ok: true as const, rows }
  },
)

// ─── prescribeSupplement ────────────────────────────────────────────────

export const prescribeSupplement = wrapServerAction(
  {
    module: 'nutri',
    action: 'supplement.prescribe',
    resourceType: 'supplement_prescriptions',
  },
  async (input: z.infer<typeof PrescribeSupplementSchema>, { session, setAuditResource }) => {
    const parsed = PrescribeSupplementSchema.parse(input)
    const tenantId = session.logifit.tenantId

    // Valida member existe + tenant
    const m = await db
      .select({ id: members.id })
      .from(members)
      .where(and(eq(members.id, parsed.memberId), eq(members.tenantId, tenantId)))
      .limit(1)
    if (m.length === 0) {
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Member não encontrado',
        request_id: '',
      })
    }

    // Valida supplement existe (global ou tenant)
    const s = await db
      .select({ id: supplements.id })
      .from(supplements)
      .where(
        and(
          eq(supplements.id, parsed.supplementId),
          or(isNull(supplements.tenantId), eq(supplements.tenantId, tenantId)),
        ),
      )
      .limit(1)
    if (s.length === 0) {
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Suplemento não encontrado',
        request_id: '',
      })
    }

    const [row] = await db
      .insert(supplementPrescriptions)
      .values({
        tenantId,
        memberId: parsed.memberId,
        supplementId: parsed.supplementId,
        consultaId: parsed.consultaId ?? null,
        professionalUserId: session.user.id,
        dose: parsed.dose,
        frequency: parsed.frequency,
        route: parsed.route,
        durationDays: parsed.durationDays ?? null,
        startedAt: parsed.startedAt,
        notes: parsed.notes ?? null,
      })
      .returning({ id: supplementPrescriptions.id })

    setAuditResource(row!.id, {
      member_id: parsed.memberId,
      supplement_id: parsed.supplementId,
    })
    return { ok: true as const, id: row!.id }
  },
)

// ─── discontinueSupplementPrescription ──────────────────────────────────

export const discontinueSupplementPrescription = wrapServerAction(
  {
    module: 'nutri',
    action: 'supplement.discontinue',
    resourceType: 'supplement_prescriptions',
  },
  async (input: z.infer<typeof DiscontinueSchema>, { session, setAuditResource }) => {
    const parsed = DiscontinueSchema.parse(input)
    const tenantId = session.logifit.tenantId

    const [row] = await db
      .update(supplementPrescriptions)
      .set({
        status: 'discontinued',
        endedAt: sql`CURRENT_DATE`,
        discontinuedReason: parsed.reason,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(supplementPrescriptions.id, parsed.prescriptionId),
          eq(supplementPrescriptions.tenantId, tenantId),
          eq(supplementPrescriptions.status, 'active'),
        ),
      )
      .returning({ id: supplementPrescriptions.id })

    if (!row) {
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Prescrição não encontrada ou já encerrada',
        request_id: '',
      })
    }
    setAuditResource(row.id, { reason: parsed.reason })
    return { ok: true as const }
  },
)

// ─── listMemberSupplementPrescriptions ──────────────────────────────────

export const listMemberSupplementPrescriptions = wrapServerAction(
  { module: 'nutri', action: 'supplement.list' },
  async (input: { memberId: string; onlyActive?: boolean }, { session }) => {
    const parsed = z
      .object({
        memberId: z.string().uuid(),
        onlyActive: z.boolean().default(true),
      })
      .parse(input)
    const tenantId = session.logifit.tenantId

    const conditions = [
      eq(supplementPrescriptions.tenantId, tenantId),
      eq(supplementPrescriptions.memberId, parsed.memberId),
    ]
    if (parsed.onlyActive) conditions.push(eq(supplementPrescriptions.status, 'active'))

    const rows = await db
      .select({
        id: supplementPrescriptions.id,
        supplementId: supplementPrescriptions.supplementId,
        supplementName: supplements.name,
        supplementKind: supplements.kind,
        dose: supplementPrescriptions.dose,
        frequency: supplementPrescriptions.frequency,
        route: supplementPrescriptions.route,
        durationDays: supplementPrescriptions.durationDays,
        startedAt: supplementPrescriptions.startedAt,
        endedAt: supplementPrescriptions.endedAt,
        status: supplementPrescriptions.status,
        notes: supplementPrescriptions.notes,
      })
      .from(supplementPrescriptions)
      .innerJoin(supplements, eq(supplements.id, supplementPrescriptions.supplementId))
      .where(and(...conditions))
      .orderBy(desc(supplementPrescriptions.startedAt))
    return { ok: true as const, rows }
  },
)

// ─── listLabAnalytes (global) ───────────────────────────────────────────

export const listLabAnalytes = wrapServerAction(
  { module: 'nutri', action: 'lab.analyte.list' },
  async (input: { category?: string | null }, _ctx) => {
    const parsed = z
      .object({ category: z.string().max(40).optional().nullable() })
      .parse(input)

    const conditions = [eq(labAnalytes.active, true)]
    if (parsed.category) conditions.push(eq(labAnalytes.category, parsed.category as never))

    const rows = await db
      .select()
      .from(labAnalytes)
      .where(and(...conditions))
      .orderBy(asc(labAnalytes.name))
    return { ok: true as const, rows }
  },
)

// ─── getLabAnalyteWithReferences ────────────────────────────────────────

export const getLabAnalyteWithReferences = wrapServerAction(
  { module: 'nutri', action: 'lab.analyte.read' },
  async (input: { analyteId: string }, _ctx) => {
    const parsed = z.object({ analyteId: z.string().uuid() }).parse(input)
    const [analyte] = await db
      .select()
      .from(labAnalytes)
      .where(eq(labAnalytes.id, parsed.analyteId))
      .limit(1)
    if (!analyte) {
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Analito não encontrado',
        request_id: '',
      })
    }
    const ranges = await db
      .select()
      .from(labReferenceRanges)
      .where(eq(labReferenceRanges.analyteId, parsed.analyteId))
      .orderBy(asc(labReferenceRanges.sex), asc(labReferenceRanges.ageMinYears))
    return { ok: true as const, analyte, ranges }
  },
)

// ─── registerLabResult ──────────────────────────────────────────────────

export const registerLabResult = wrapServerAction(
  {
    module: 'nutri',
    action: 'lab.result.register',
    resourceType: 'lab_results',
  },
  async (input: z.infer<typeof RegisterLabResultSchema>, { session, setAuditResource }) => {
    const parsed = RegisterLabResultSchema.parse(input)
    const tenantId = session.logifit.tenantId

    // Resolve idade + sexo do member via persons
    const memberInfo = await db
      .select({
        id: members.id,
        birthDate: persons.birthDate,
        sex: persons.sex,
      })
      .from(members)
      .innerJoin(persons, eq(persons.id, members.personId))
      .where(and(eq(members.id, parsed.memberId), eq(members.tenantId, tenantId)))
      .limit(1)
    if (memberInfo.length === 0) {
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Member não encontrado',
        request_id: '',
      })
    }
    const m = memberInfo[0]!
    const birthIso = m.birthDate ? String(m.birthDate) : null
    const age = birthIso ? ageYearsAt(birthIso, parsed.collectedAt) : 30 // default 30 quando birth_date ausente
    const sex: Sex = m.sex === 'male' || m.sex === 'female' ? m.sex : 'any'

    // Carrega ranges
    const rangesRaw = await db
      .select()
      .from(labReferenceRanges)
      .where(eq(labReferenceRanges.analyteId, parsed.analyteId))
    const ranges: LabReferenceRange[] = rangesRaw.map((r) => ({
      id: r.id,
      sex: r.sex as Sex,
      ageMinYears: r.ageMinYears,
      ageMaxYears: r.ageMaxYears,
      condition: r.condition,
      minValue: r.minValue ? Number(r.minValue) : null,
      maxValue: r.maxValue ? Number(r.maxValue) : null,
      notes: r.notes,
    }))

    // Classifica via lib pura
    const classification = classifyLabResult(parsed.value, ranges, {
      ageYears: age,
      sex,
      condition: parsed.condition ?? null,
    })

    const [row] = await db
      .insert(labResults)
      .values({
        tenantId,
        memberId: parsed.memberId,
        analyteId: parsed.analyteId,
        value: parsed.value.toString(),
        unit: parsed.unit,
        collectedAt: parsed.collectedAt,
        laboratory: parsed.laboratory ?? null,
        consultaId: parsed.consultaId ?? null,
        attachmentStoragePath: parsed.attachmentStoragePath ?? null,
        outOfRange: classification.outOfRange,
        outOfRangeDirection: classification.direction,
        referenceRangeIdUsed: classification.referenceRangeIdUsed,
        notes: parsed.notes ?? null,
        enteredByUserId: session.user.id,
      })
      .returning({ id: labResults.id })

    setAuditResource(row!.id, {
      member_id: parsed.memberId,
      analyte_id: parsed.analyteId,
      out_of_range: classification.outOfRange,
      direction: classification.direction,
      severity: classification.severity,
    })

    return {
      ok: true as const,
      id: row!.id,
      outOfRange: classification.outOfRange,
      direction: classification.direction,
      severity: classification.severity,
    }
  },
)

// ─── listMemberLabResults ───────────────────────────────────────────────

export const listMemberLabResults = wrapServerAction(
  { module: 'nutri', action: 'lab.result.list' },
  async (
    input: {
      memberId: string
      analyteId?: string | null
      fromDate?: string | null
      toDate?: string | null
      onlyAltered?: boolean
    },
    { session },
  ) => {
    const parsed = z
      .object({
        memberId: z.string().uuid(),
        analyteId: z.string().uuid().optional().nullable(),
        fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
        toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
        onlyAltered: z.boolean().default(false),
      })
      .parse(input)
    const tenantId = session.logifit.tenantId

    const conditions = [eq(labResults.tenantId, tenantId), eq(labResults.memberId, parsed.memberId)]
    if (parsed.analyteId) conditions.push(eq(labResults.analyteId, parsed.analyteId))
    if (parsed.fromDate) conditions.push(gte(labResults.collectedAt, parsed.fromDate))
    if (parsed.toDate) conditions.push(lte(labResults.collectedAt, parsed.toDate))
    if (parsed.onlyAltered) conditions.push(eq(labResults.outOfRange, true))

    const rows = await db
      .select({
        id: labResults.id,
        analyteId: labResults.analyteId,
        analyteName: labAnalytes.name,
        analyteCategory: labAnalytes.category,
        value: labResults.value,
        unit: labResults.unit,
        collectedAt: labResults.collectedAt,
        laboratory: labResults.laboratory,
        outOfRange: labResults.outOfRange,
        outOfRangeDirection: labResults.outOfRangeDirection,
      })
      .from(labResults)
      .innerJoin(labAnalytes, eq(labAnalytes.id, labResults.analyteId))
      .where(and(...conditions))
      .orderBy(desc(labResults.collectedAt))
      .limit(200)
    return { ok: true as const, rows }
  },
)

// ─── compareAnalyteOverTime ─────────────────────────────────────────────

export const compareAnalyteOverTime = wrapServerAction(
  { module: 'nutri', action: 'lab.result.compare' },
  async (input: z.infer<typeof CompareSchema>, { session }) => {
    const parsed = CompareSchema.parse(input)
    const tenantId = session.logifit.tenantId

    const rows = await db
      .select({
        id: labResults.id,
        value: labResults.value,
        unit: labResults.unit,
        collectedAt: labResults.collectedAt,
        outOfRange: labResults.outOfRange,
        outOfRangeDirection: labResults.outOfRangeDirection,
      })
      .from(labResults)
      .where(
        and(
          eq(labResults.tenantId, tenantId),
          eq(labResults.memberId, parsed.memberId),
          eq(labResults.analyteId, parsed.analyteId),
        ),
      )
      .orderBy(asc(labResults.collectedAt))

    return { ok: true as const, points: rows }
  },
)
