'use server'

/**
 * Server Actions Intercompany — Sprint 16 Faixa B (ADR 0036).
 *
 * Funções:
 *   - createIntercompanyEntry(fromCompanyId, toCompanyId, amountCents, kind, ...)
 *   - liquidateIntercompany(entryIds[], settlementMethod) — zera saldos
 *   - listIntercompanyEntries (filtros from/to/kind/settled/period)
 *   - generateIcReport(from, to) — saldos consolidados por par from×to
 *   - getIntercompanyBalances — saldo por par no momento atual
 *
 * **Regra 25:** trigger SQL bloqueia tenants franchise. Server Action captura
 * o erro 23514 e retorna VALIDATION_ERROR.
 *
 * **`requires_nfe_transfer`:** trigger SQL marca true quando kind='goods' +
 * CNPJs distintos. Sprint 36 Focus NFe consome flag.
 */

import { db } from '@repo/db/client'
import {
  companies,
  intercompanyEntries,
  persons,
} from '@repo/db/schema'
import { ApiException } from '@repo/errors'
import { and, asc, desc, eq, gte, isNull, lte, sql } from 'drizzle-orm'
import { z } from 'zod'
import { wrapServerAction } from '../../../lib/wrap-action'

// ─── Zod ─────────────────────────────────────────────────────────────────

const IcKindEnum = z.enum(['payment', 'transfer', 'service', 'goods', 'adjustment'])

const CreateICInputSchema = z.object({
  fromCompanyId: z.string().uuid(),
  toCompanyId: z.string().uuid(),
  amountCents: z.number().int().positive(),
  kind: IcKindEnum,
  referenceApId: z.string().uuid().optional().nullable(),
  referenceArId: z.string().uuid().optional().nullable(),
  notes: z.string().max(2000).optional(),
})

const LiquidateICInputSchema = z.object({
  entryIds: z.array(z.string().uuid()).min(1).max(100),
  settlementMethod: z.enum(['bank_transfer', 'virtual', 'cash', 'pix', 'other']),
  notes: z.string().max(1000).optional(),
})

const ListICInputSchema = z.object({
  fromCompanyId: z.string().uuid().optional(),
  toCompanyId: z.string().uuid().optional(),
  kind: IcKindEnum.optional(),
  settledOnly: z.boolean().optional(),
  pendingOnly: z.boolean().optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  limit: z.number().int().min(1).max(500).default(200),
})

const ReportInputSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
})

// ─── createIntercompanyEntry ─────────────────────────────────────────────

export const createIntercompanyEntry = wrapServerAction(
  { module: 'financeiro', action: 'ic.create', resourceType: 'intercompany_entries' },
  async (
    input: z.infer<typeof CreateICInputSchema>,
    { session, setAuditResource },
  ) => {
    const parsed = CreateICInputSchema.parse(input)
    if (parsed.fromCompanyId === parsed.toCompanyId) {
      throw new ApiException({
        code: 'VALIDATION_ERROR',
        message: 'from e to devem ser companies diferentes',
        request_id: '',
      })
    }
    try {
      const [row] = await db
        .insert(intercompanyEntries)
        .values({
          tenantId: session.logifit.tenantId,
          fromCompanyId: parsed.fromCompanyId,
          toCompanyId: parsed.toCompanyId,
          amountCents: parsed.amountCents,
          kind: parsed.kind,
          referenceApId: parsed.referenceApId ?? null,
          referenceArId: parsed.referenceArId ?? null,
          notes: parsed.notes ?? null,
          createdByUserId: session.user.id,
        })
        .returning({
          id: intercompanyEntries.id,
          requiresNfeTransfer: intercompanyEntries.requiresNfeTransfer,
        })
      if (!row)
        throw new ApiException({
          code: 'INTERNAL_ERROR',
          message: 'Falha ao criar IC entry',
          request_id: '',
        })
      setAuditResource(row.id, {
        kind: parsed.kind,
        amountCents: parsed.amountCents,
        requiresNfeTransfer: row.requiresNfeTransfer,
      })
      return { id: row.id, requiresNfeTransfer: row.requiresNfeTransfer }
    } catch (err) {
      const code = (err as { code?: string }).code ?? ''
      if (code === '23514') {
        throw new ApiException({
          code: 'VALIDATION_ERROR',
          message:
            'Intercompany só permitido em tenants com topology=owned (regra 25). Franquia não suporta IC.',
          request_id: '',
        })
      }
      throw err
    }
  },
)

// ─── liquidateIntercompany ───────────────────────────────────────────────

export const liquidateIntercompany = wrapServerAction(
  { module: 'financeiro', action: 'ic.liquidate', resourceType: 'intercompany_entries' },
  async (
    input: z.infer<typeof LiquidateICInputSchema>,
    { session, setAuditResource },
  ) => {
    const parsed = LiquidateICInputSchema.parse(input)
    const now = new Date()
    const updated = await db
      .update(intercompanyEntries)
      .set({
        settledAt: now,
        settlementMethod: parsed.settlementMethod,
        notes: parsed.notes
          ? sql`coalesce(${intercompanyEntries.notes}, '') || E'\n[liquidação] ' || ${parsed.notes}`
          : intercompanyEntries.notes,
        updatedAt: now,
      })
      .where(
        and(
          eq(intercompanyEntries.tenantId, session.logifit.tenantId),
          sql`${intercompanyEntries.id} = ANY(${parsed.entryIds}::uuid[])`,
          isNull(intercompanyEntries.settledAt),
        ),
      )
      .returning({ id: intercompanyEntries.id })

    setAuditResource(parsed.entryIds[0]!, {
      liquidatedCount: updated.length,
      settlementMethod: parsed.settlementMethod,
    })
    return { settled: updated.length }
  },
)

// ─── listIntercompanyEntries ─────────────────────────────────────────────

export const listIntercompanyEntries = wrapServerAction(
  { module: 'financeiro', action: 'ic.list' },
  async (input: z.infer<typeof ListICInputSchema> | undefined, { session }) => {
    const parsed = ListICInputSchema.parse(input ?? {})
    const where = [eq(intercompanyEntries.tenantId, session.logifit.tenantId)]
    if (parsed.fromCompanyId) where.push(eq(intercompanyEntries.fromCompanyId, parsed.fromCompanyId))
    if (parsed.toCompanyId) where.push(eq(intercompanyEntries.toCompanyId, parsed.toCompanyId))
    if (parsed.kind) where.push(eq(intercompanyEntries.kind, parsed.kind))
    if (parsed.settledOnly) where.push(sql`${intercompanyEntries.settledAt} IS NOT NULL`)
    if (parsed.pendingOnly) where.push(isNull(intercompanyEntries.settledAt))
    if (parsed.from) where.push(gte(intercompanyEntries.createdAt, new Date(parsed.from + 'T00:00:00Z')))
    if (parsed.to) where.push(lte(intercompanyEntries.createdAt, new Date(parsed.to + 'T23:59:59Z')))

    const rows = await db
      .select({
        id: intercompanyEntries.id,
        fromCompanyId: intercompanyEntries.fromCompanyId,
        toCompanyId: intercompanyEntries.toCompanyId,
        amountCents: intercompanyEntries.amountCents,
        kind: intercompanyEntries.kind,
        referenceApId: intercompanyEntries.referenceApId,
        referenceArId: intercompanyEntries.referenceArId,
        settledAt: intercompanyEntries.settledAt,
        settlementMethod: intercompanyEntries.settlementMethod,
        notes: intercompanyEntries.notes,
        requiresNfeTransfer: intercompanyEntries.requiresNfeTransfer,
        nfeTransferEmissionId: intercompanyEntries.nfeTransferEmissionId,
        createdAt: intercompanyEntries.createdAt,
      })
      .from(intercompanyEntries)
      .where(and(...where))
      .orderBy(desc(intercompanyEntries.createdAt))
      .limit(parsed.limit)
    return { entries: rows }
  },
)

// ─── generateIcReport ────────────────────────────────────────────────────

export const generateIcReport = wrapServerAction(
  { module: 'financeiro', action: 'ic.report', resourceType: 'intercompany_entries' },
  async (input: z.infer<typeof ReportInputSchema>, { session, setAuditResource }) => {
    const parsed = ReportInputSchema.parse(input)
    const rows = await db
      .select({
        fromCompanyId: intercompanyEntries.fromCompanyId,
        toCompanyId: intercompanyEntries.toCompanyId,
        totalCents: sql<number>`SUM(${intercompanyEntries.amountCents})::bigint`,
        count: sql<number>`COUNT(*)::int`,
        pendingCents: sql<number>`COALESCE(SUM(${intercompanyEntries.amountCents}) FILTER (WHERE ${intercompanyEntries.settledAt} IS NULL), 0)::bigint`,
        settledCents: sql<number>`COALESCE(SUM(${intercompanyEntries.amountCents}) FILTER (WHERE ${intercompanyEntries.settledAt} IS NOT NULL), 0)::bigint`,
      })
      .from(intercompanyEntries)
      .where(
        and(
          eq(intercompanyEntries.tenantId, session.logifit.tenantId),
          gte(intercompanyEntries.createdAt, new Date(parsed.from + 'T00:00:00Z')),
          lte(intercompanyEntries.createdAt, new Date(parsed.to + 'T23:59:59Z')),
        ),
      )
      .groupBy(intercompanyEntries.fromCompanyId, intercompanyEntries.toCompanyId)
      .orderBy(desc(sql`SUM(${intercompanyEntries.amountCents})`))

    setAuditResource(`report-${parsed.from}-${parsed.to}`, { pairCount: rows.length })
    return {
      period: parsed,
      pairs: rows.map((r) => ({
        fromCompanyId: r.fromCompanyId,
        toCompanyId: r.toCompanyId,
        totalCents: Number(r.totalCents),
        pendingCents: Number(r.pendingCents),
        settledCents: Number(r.settledCents),
        count: r.count,
      })),
    }
  },
)

// ─── getIntercompanyBalances ─────────────────────────────────────────────
/**
 * Saldo líquido pendente entre cada par from→to (no momento atual).
 * Saldos compensam: se from=A→B = R$ 1000 pendente e B→A = R$ 300 pendente,
 * saldo líquido = A deve R$ 700 a B.
 */
export const getIntercompanyBalances = wrapServerAction(
  { module: 'financeiro', action: 'ic.balances' },
  async (_input: undefined, { session }) => {
    const rows = await db
      .select({
        fromCompanyId: intercompanyEntries.fromCompanyId,
        toCompanyId: intercompanyEntries.toCompanyId,
        pendingCents: sql<number>`SUM(${intercompanyEntries.amountCents})::bigint`,
        count: sql<number>`COUNT(*)::int`,
      })
      .from(intercompanyEntries)
      .where(
        and(
          eq(intercompanyEntries.tenantId, session.logifit.tenantId),
          isNull(intercompanyEntries.settledAt),
        ),
      )
      .groupBy(intercompanyEntries.fromCompanyId, intercompanyEntries.toCompanyId)
      .orderBy(desc(sql`SUM(${intercompanyEntries.amountCents})`))

    // Resolve names
    const compIds = new Set<string>()
    rows.forEach((r) => {
      compIds.add(r.fromCompanyId)
      compIds.add(r.toCompanyId)
    })
    const comps =
      compIds.size > 0
        ? await db
            .select({
              id: companies.id,
              name: persons.name,
            })
            .from(companies)
            .leftJoin(persons, eq(persons.id, companies.personId))
            .where(eq(companies.tenantId, session.logifit.tenantId))
        : []
    const nameById = new Map(comps.map((c) => [c.id, c.name ?? '—']))

    return {
      balances: rows.map((r) => ({
        fromCompanyId: r.fromCompanyId,
        toCompanyId: r.toCompanyId,
        fromCompanyName: nameById.get(r.fromCompanyId) ?? '—',
        toCompanyName: nameById.get(r.toCompanyId) ?? '—',
        pendingCents: Number(r.pendingCents),
        count: r.count,
      })),
    }
  },
)
