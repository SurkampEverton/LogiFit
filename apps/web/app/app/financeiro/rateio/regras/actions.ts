'use server'

/**
 * Server Actions allocation_rules + apply allocation — Sprint 16 Faixa B (ADR 0036).
 *
 * Funções:
 *   - createAllocationRule — valida distribution via Zod + soma=100 para fixed/custom
 *   - listAllocationRules
 *   - archiveAllocationRule (soft via archived_at)
 *   - simulateAllocation(ruleId, amountCents) — preview sem persistir
 *   - applyAllocation(apId, ruleId) — gera ap_allocations a partir do amount líquido da AP;
 *     idempotente (DELETE existentes do mesmo AP antes de INSERT)
 *
 * **Regra 25:** trigger SQL bloqueia se tenant.topology != 'owned'. Server Action
 * captura e retorna VALIDATION_ERROR.
 */

import { db } from '@repo/db/client'
import { distribute, validateRuleDistribution } from '@repo/db/rateio'
import {
  accountsPayable,
  allocationRules,
  apAllocations,
  companies,
  invoices,
  users,
} from '@repo/db/schema'
import { ApiException } from '@repo/errors'
import { and, asc, desc, eq, gte, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'
import { wrapServerAction } from '../../../../lib/wrap-action'

// ─── Zod ─────────────────────────────────────────────────────────────────

const KindEnum = z.enum([
  'fixed',
  'proportional',
  'per_unit',
  'by_revenue',
  'by_headcount',
  'custom',
])

const CreateAllocationRuleInputSchema = z.object({
  name: z.string().min(2).max(120),
  kind: KindEnum,
  distribution: z.unknown(),
  description: z.string().max(2000).optional(),
})

const ArchiveAllocationRuleInputSchema = z.object({
  ruleId: z.string().uuid(),
})

const SimulateInputSchema = z.object({
  ruleId: z.string().uuid(),
  amountCents: z.number().int().positive(),
})

const ApplyAllocationInputSchema = z.object({
  apId: z.string().uuid(),
  ruleId: z.string().uuid(),
})

// ─── Helpers internos ────────────────────────────────────────────────────

async function buildContextFor(
  tenantId: string,
  kind: z.infer<typeof KindEnum>,
): Promise<{
  unitsByCompany?: Record<string, number>
  revenueByCompany?: Record<string, number>
  headcountByCompany?: Record<string, number>
}> {
  if (kind === 'by_revenue') {
    // Revenue do mês anterior por company (soma de invoices.paid agrupada)
    const startPrev = new Date()
    startPrev.setMonth(startPrev.getMonth() - 1, 1)
    startPrev.setHours(0, 0, 0, 0)
    const startCurr = new Date()
    startCurr.setDate(1)
    startCurr.setHours(0, 0, 0, 0)
    const rows = await db
      .select({
        companyId: invoices.companyId,
        total: sql<number>`COALESCE(SUM(${invoices.amountCents}), 0)::bigint`,
      })
      .from(invoices)
      .where(
        and(
          eq(invoices.tenantId, tenantId),
          eq(invoices.status, 'paid'),
          gte(invoices.paidAt, startPrev),
        ),
      )
      .groupBy(invoices.companyId)
    const map: Record<string, number> = {}
    for (const r of rows) {
      if (r.companyId) map[r.companyId] = Number(r.total)
    }
    return { revenueByCompany: map }
  }
  if (kind === 'by_headcount') {
    // Headcount = users.count ativos por tenant — granularidade per-company não
    // está modelada no MVP. Aproximação: 1 user = 1 headcount no tenant inteiro,
    // distribuído igualmente. Sprint 16+ pode adicionar `users.primary_company_id`.
    const [agg] = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(users)
      .where(eq(users.tenantId, tenantId))
    const headcount = agg?.c ?? 0
    const comps = await db
      .select({ id: companies.id })
      .from(companies)
      .where(eq(companies.tenantId, tenantId))
    const per = comps.length > 0 ? Math.floor(headcount / comps.length) : 0
    const map: Record<string, number> = {}
    for (const c of comps) map[c.id] = per
    return { headcountByCompany: map }
  }
  if (kind === 'per_unit') {
    // Para cada company, conta units. Snapshot estático.
    const rows = await db
      .select({
        companyId: sql<string>`company_id`,
        c: sql<number>`count(*)::int`,
      })
      .from(sql`units`)
      .where(sql`tenant_id = ${tenantId}`)
      .groupBy(sql`company_id`)
    const map: Record<string, number> = {}
    for (const r of rows) {
      map[r.companyId] = r.c
    }
    return { unitsByCompany: map }
  }
  return {}
}

// ─── createAllocationRule ────────────────────────────────────────────────

export const createAllocationRule = wrapServerAction(
  { module: 'financeiro', action: 'allocation.create', resourceType: 'allocation_rules' },
  async (input: z.infer<typeof CreateAllocationRuleInputSchema>, { session, setAuditResource }) => {
    const parsed = CreateAllocationRuleInputSchema.parse(input)
    const validation = validateRuleDistribution(parsed.kind, parsed.distribution)
    if (!validation.ok) {
      throw new ApiException({
        code: 'VALIDATION_ERROR',
        message: validation.reason,
        request_id: '',
      })
    }
    try {
      const [row] = await db
        .insert(allocationRules)
        .values({
          tenantId: session.logifit.tenantId,
          name: parsed.name,
          kind: parsed.kind,
          distribution: parsed.distribution,
          description: parsed.description ?? null,
          createdByUserId: session.logifit.userId,
        })
        .returning({ id: allocationRules.id })
      if (!row)
        throw new ApiException({
          code: 'INTERNAL_ERROR',
          message: 'Falha ao criar rule',
          request_id: '',
        })
      setAuditResource(row.id, { name: parsed.name, kind: parsed.kind })
      return { id: row.id }
    } catch (err) {
      const code = (err as { code?: string }).code ?? ''
      if (code === '23514') {
        throw new ApiException({
          code: 'VALIDATION_ERROR',
          message:
            'Rateio só permitido em tenants com topology=owned (regra 25). Franquia não suporta rateio.',
          request_id: '',
        })
      }
      throw err
    }
  },
)

// ─── listAllocationRules ─────────────────────────────────────────────────

export const listAllocationRules = wrapServerAction(
  { module: 'financeiro', action: 'allocation.list' },
  async (input: { includeArchived?: boolean } | undefined, { session }) => {
    const where = [eq(allocationRules.tenantId, session.logifit.tenantId)]
    if (!input?.includeArchived) where.push(isNull(allocationRules.archivedAt))
    const rows = await db
      .select({
        id: allocationRules.id,
        name: allocationRules.name,
        kind: allocationRules.kind,
        distribution: allocationRules.distribution,
        description: allocationRules.description,
        active: allocationRules.active,
        archivedAt: allocationRules.archivedAt,
        createdAt: allocationRules.createdAt,
      })
      .from(allocationRules)
      .where(and(...where))
      .orderBy(asc(allocationRules.name))
    return { rules: rows }
  },
)

// ─── archiveAllocationRule ───────────────────────────────────────────────

export const archiveAllocationRule = wrapServerAction(
  { module: 'financeiro', action: 'allocation.archive', resourceType: 'allocation_rules' },
  async (
    input: z.infer<typeof ArchiveAllocationRuleInputSchema>,
    { session, setAuditResource },
  ) => {
    const parsed = ArchiveAllocationRuleInputSchema.parse(input)
    const [row] = await db
      .update(allocationRules)
      .set({ archivedAt: new Date(), active: false, updatedAt: new Date() })
      .where(
        and(
          eq(allocationRules.id, parsed.ruleId),
          eq(allocationRules.tenantId, session.logifit.tenantId),
        ),
      )
      .returning({ id: allocationRules.id })
    if (!row)
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Rule não encontrada',
        request_id: '',
      })
    setAuditResource(row.id, {})
    return { id: row.id }
  },
)

// ─── simulateAllocation ──────────────────────────────────────────────────

export const simulateAllocation = wrapServerAction(
  { module: 'financeiro', action: 'allocation.simulate' },
  async (input: z.infer<typeof SimulateInputSchema>, { session }) => {
    const parsed = SimulateInputSchema.parse(input)
    const [rule] = await db
      .select({
        id: allocationRules.id,
        kind: allocationRules.kind,
        distribution: allocationRules.distribution,
        name: allocationRules.name,
      })
      .from(allocationRules)
      .where(
        and(
          eq(allocationRules.id, parsed.ruleId),
          eq(allocationRules.tenantId, session.logifit.tenantId),
          eq(allocationRules.active, true),
        ),
      )
      .limit(1)
    if (!rule)
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Rule não encontrada ou inativa',
        request_id: '',
      })
    const context = await buildContextFor(
      session.logifit.tenantId,
      rule.kind as z.infer<typeof KindEnum>,
    )
    const result = distribute({
      amountCents: parsed.amountCents,
      rule: { kind: rule.kind as z.infer<typeof KindEnum>, distribution: rule.distribution },
      context,
    })
    // Resolve nomes de companies pra UI
    const compIds = result.allocations.map((a) => a.companyId)
    const compRows =
      compIds.length > 0
        ? await db
            .select({
              id: companies.id,
              personId: companies.personId,
            })
            .from(companies)
            .where(eq(companies.tenantId, session.logifit.tenantId))
        : []
    const nameByCompany = new Map(compRows.map((c) => [c.id, c.personId ?? '']))
    return {
      ruleName: rule.name,
      ruleKind: rule.kind,
      allocations: result.allocations.map((a) => ({
        ...a,
        companyPersonId: nameByCompany.get(a.companyId) ?? null,
      })),
      contextSnapshot: result.contextSnapshot,
    }
  },
)

// ─── applyAllocation ─────────────────────────────────────────────────────

export const applyAllocation = wrapServerAction(
  { module: 'financeiro', action: 'allocation.apply', resourceType: 'accounts_payable' },
  async (input: z.infer<typeof ApplyAllocationInputSchema>, { session, setAuditResource }) => {
    const parsed = ApplyAllocationInputSchema.parse(input)
    const [ap] = await db
      .select({
        id: accountsPayable.id,
        netAmountCents: accountsPayable.netAmountCents,
        status: accountsPayable.status,
      })
      .from(accountsPayable)
      .where(
        and(
          eq(accountsPayable.id, parsed.apId),
          eq(accountsPayable.tenantId, session.logifit.tenantId),
        ),
      )
      .limit(1)
    if (!ap)
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'AP não encontrada',
        request_id: '',
      })
    if (!['approved', 'scheduled', 'paid'].includes(ap.status)) {
      throw new ApiException({
        code: 'VALIDATION_ERROR',
        message: `AP no estado '${ap.status}' não comporta rateio — aprove antes`,
        request_id: '',
      })
    }
    const [rule] = await db
      .select({
        id: allocationRules.id,
        kind: allocationRules.kind,
        distribution: allocationRules.distribution,
      })
      .from(allocationRules)
      .where(
        and(
          eq(allocationRules.id, parsed.ruleId),
          eq(allocationRules.tenantId, session.logifit.tenantId),
          eq(allocationRules.active, true),
        ),
      )
      .limit(1)
    if (!rule)
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Rule não encontrada ou inativa',
        request_id: '',
      })
    const context = await buildContextFor(
      session.logifit.tenantId,
      rule.kind as z.infer<typeof KindEnum>,
    )
    const result = distribute({
      amountCents: ap.netAmountCents,
      rule: { kind: rule.kind as z.infer<typeof KindEnum>, distribution: rule.distribution },
      context,
    })
    if (result.allocations.length === 0) {
      throw new ApiException({
        code: 'VALIDATION_ERROR',
        message: 'Rule não produziu rateio (verifique pesos/contexto)',
        request_id: '',
      })
    }
    // Limpa rateios anteriores desta AP (idempotência)
    await db.delete(apAllocations).where(eq(apAllocations.apId, parsed.apId))
    // Insere novos
    await db.insert(apAllocations).values(
      result.allocations.map((a) => ({
        apId: parsed.apId,
        companyId: a.companyId,
        tenantId: session.logifit.tenantId,
        amountCents: a.amountCents,
        percentApplied: String(a.percentApplied),
        ruleId: rule.id,
        ruleKind: rule.kind,
        contextSnapshot: result.contextSnapshot ?? null,
      })),
    )
    setAuditResource(parsed.apId, {
      ruleId: rule.id,
      allocations: result.allocations.length,
    })
    return { id: parsed.apId, allocations: result.allocations }
  },
)

// ─── listApAllocations ───────────────────────────────────────────────────

export const listApAllocations = wrapServerAction(
  { module: 'financeiro', action: 'allocation.list_for_ap' },
  async (input: { apId: string }, { session }) => {
    const z = await db
      .select({
        apId: apAllocations.apId,
        companyId: apAllocations.companyId,
        amountCents: apAllocations.amountCents,
        percentApplied: apAllocations.percentApplied,
        ruleKind: apAllocations.ruleKind,
        contextSnapshot: apAllocations.contextSnapshot,
        createdAt: apAllocations.createdAt,
      })
      .from(apAllocations)
      .where(
        and(
          eq(apAllocations.apId, input.apId),
          eq(apAllocations.tenantId, session.logifit.tenantId),
        ),
      )
      .orderBy(desc(apAllocations.amountCents))
    return { allocations: z }
  },
)
