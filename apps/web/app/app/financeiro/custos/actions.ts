'use server'

/**
 * Server Actions de custos + DRE — Sprint 14 Faixa B.
 *
 * MVP:
 *   - createCostCategory / listCostCategories / archiveCostCategory
 *   - createCostEntry / listCostEntries / deleteCostEntry
 *   - createRecurringCost / listRecurringCosts / toggleRecurringCost
 *   - generateDre — chama calculateDre com invoices+cost_entries do período
 *   - forecastRevenueAction — calcula baseline (contracts ativos × plans.price)
 *     e churn histórico simples (últimos 6 meses) e chama forecastRevenue
 *
 * Regras consumidas:
 *   - regra 7 (Zod boundary)
 *   - regra 29 (DRE = dado administrativo sensível → audit_log via wrap)
 *   - regra 33 (envelope ADR 0071)
 *   - regra 41 (createCostEntry permitido para IA Camada 3 só via ActionConfirmDialog — adiado Sprint 14+)
 */

import { db } from '@repo/db/client'
import { calculateDre, forecastRevenue } from '@repo/db/financeiro'
import {
  contracts,
  costCategories,
  costEntries,
  invoices,
  plans,
  recurringCosts,
} from '@repo/db/schema'
import { ApiException } from '@repo/errors'
import { and, asc, desc, eq, gte, isNull, lte, sql } from 'drizzle-orm'
import { z } from 'zod'
import { wrapServerAction } from '../../../lib/wrap-action'

// ─── Zod ─────────────────────────────────────────────────────────────────

const CreateCostCategoryInputSchema = z.object({
  slug: z
    .string()
    .min(2)
    .max(60)
    .regex(/^[a-z0-9_]+$/, 'Slug aceita só [a-z0-9_]'),
  name: z.string().min(2).max(120),
  type: z.enum(['fixed', 'variable']),
  icon: z.string().max(10).optional(),
  description: z.string().max(500).optional(),
})

const ArchiveCostCategoryInputSchema = z.object({
  categoryId: z.string().uuid(),
})

const CreateCostEntryInputSchema = z.object({
  companyId: z.string().uuid(),
  categoryId: z.string().uuid(),
  amountCents: z.number().int().positive(),
  incurredAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data ISO YYYY-MM-DD'),
  description: z.string().max(1000).optional(),
  attachmentStoragePath: z.string().max(500).optional(),
})

const ListCostEntriesInputSchema = z.object({
  companyId: z.string().uuid().optional(),
  categoryId: z.string().uuid().optional(),
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  limit: z.number().int().min(1).max(500).default(100),
})

const DeleteCostEntryInputSchema = z.object({
  entryId: z.string().uuid(),
})

const CreateRecurringCostInputSchema = z.object({
  companyId: z.string().uuid(),
  categoryId: z.string().uuid(),
  amountCents: z.number().int().positive(),
  dayOfMonth: z.number().int().min(1).max(28),
  description: z.string().max(500).optional(),
  startsAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endsAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
})

const ToggleRecurringCostInputSchema = z.object({
  recurringId: z.string().uuid(),
  active: z.boolean(),
})

const GenerateDreInputSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  companyId: z.string().uuid().optional(),
})

const ForecastInputSchema = z.object({
  monthsAhead: z.number().int().min(1).max(12).default(3),
  /** Override churn rate manual (0-1). Se omitido, calcula histórico. */
  manualChurnRate: z.number().min(0).max(1).optional(),
})

// ─── createCostCategory ──────────────────────────────────────────────────

export const createCostCategory = wrapServerAction(
  { module: 'custos', action: 'category.create', resourceType: 'cost_categories' },
  async (input: z.infer<typeof CreateCostCategoryInputSchema>, { session, setAuditResource }) => {
    const parsed = CreateCostCategoryInputSchema.parse(input)
    const [row] = await db
      .insert(costCategories)
      .values({
        tenantId: session.logifit.tenantId,
        slug: parsed.slug,
        name: parsed.name,
        type: parsed.type,
        icon: parsed.icon ?? null,
        description: parsed.description ?? null,
      })
      .returning({ id: costCategories.id })
    if (!row)
      throw new ApiException({
        code: 'INTERNAL_ERROR',
        message: 'Falha ao criar categoria',
        request_id: '',
      })
    setAuditResource(row.id, { slug: parsed.slug, type: parsed.type })
    return { id: row.id }
  },
)

// ─── archiveCostCategory ─────────────────────────────────────────────────

export const archiveCostCategory = wrapServerAction(
  { module: 'custos', action: 'category.archive', resourceType: 'cost_categories' },
  async (input: z.infer<typeof ArchiveCostCategoryInputSchema>, { session, setAuditResource }) => {
    const parsed = ArchiveCostCategoryInputSchema.parse(input)
    const [row] = await db
      .update(costCategories)
      .set({ archivedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(costCategories.id, parsed.categoryId),
          eq(costCategories.tenantId, session.logifit.tenantId),
        ),
      )
      .returning({ id: costCategories.id })
    if (!row)
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Categoria não encontrada',
        request_id: '',
      })
    setAuditResource(row.id, {})
    return { id: row.id }
  },
)

// ─── listCostCategories ──────────────────────────────────────────────────

export const listCostCategories = wrapServerAction(
  { module: 'custos', action: 'category.list' },
  async (_input: undefined, { session }) => {
    const rows = await db
      .select({
        id: costCategories.id,
        slug: costCategories.slug,
        name: costCategories.name,
        type: costCategories.type,
        icon: costCategories.icon,
        description: costCategories.description,
      })
      .from(costCategories)
      .where(
        and(
          eq(costCategories.tenantId, session.logifit.tenantId),
          isNull(costCategories.archivedAt),
        ),
      )
      .orderBy(asc(costCategories.name))
    return { rows }
  },
)

// ─── createCostEntry ─────────────────────────────────────────────────────

export const createCostEntry = wrapServerAction(
  { module: 'custos', action: 'entry.create', resourceType: 'cost_entries' },
  async (input: z.infer<typeof CreateCostEntryInputSchema>, { session, setAuditResource }) => {
    const parsed = CreateCostEntryInputSchema.parse(input)
    const [row] = await db
      .insert(costEntries)
      .values({
        tenantId: session.logifit.tenantId,
        companyId: parsed.companyId,
        categoryId: parsed.categoryId,
        amountCents: parsed.amountCents,
        incurredAt: parsed.incurredAt,
        description: parsed.description ?? null,
        attachmentStoragePath: parsed.attachmentStoragePath ?? null,
        createdByUserId: session.logifit.userId,
      })
      .returning({ id: costEntries.id })
    if (!row)
      throw new ApiException({
        code: 'INTERNAL_ERROR',
        message: 'Falha ao registrar custo',
        request_id: '',
      })
    setAuditResource(row.id, {
      company_id: parsed.companyId,
      amount: parsed.amountCents,
      incurred_at: parsed.incurredAt,
    })
    return { id: row.id }
  },
)

// ─── listCostEntries ─────────────────────────────────────────────────────

export const listCostEntries = wrapServerAction(
  { module: 'custos', action: 'entry.list' },
  async (input: z.infer<typeof ListCostEntriesInputSchema>, { session }) => {
    const parsed = ListCostEntriesInputSchema.parse(input)
    const conditions = [eq(costEntries.tenantId, session.logifit.tenantId)]
    if (parsed.companyId) conditions.push(eq(costEntries.companyId, parsed.companyId))
    if (parsed.categoryId) conditions.push(eq(costEntries.categoryId, parsed.categoryId))
    if (parsed.from) conditions.push(gte(costEntries.incurredAt, parsed.from))
    if (parsed.to) conditions.push(lte(costEntries.incurredAt, parsed.to))

    const rows = await db
      .select({
        id: costEntries.id,
        companyId: costEntries.companyId,
        categoryId: costEntries.categoryId,
        amountCents: costEntries.amountCents,
        incurredAt: costEntries.incurredAt,
        description: costEntries.description,
        attachmentStoragePath: costEntries.attachmentStoragePath,
        categoryName: costCategories.name,
        categoryType: costCategories.type,
        categoryIcon: costCategories.icon,
      })
      .from(costEntries)
      .leftJoin(costCategories, eq(costCategories.id, costEntries.categoryId))
      .where(and(...conditions))
      .orderBy(desc(costEntries.incurredAt))
      .limit(parsed.limit)
    return { rows }
  },
)

// ─── deleteCostEntry ─────────────────────────────────────────────────────

export const deleteCostEntry = wrapServerAction(
  { module: 'custos', action: 'entry.delete', resourceType: 'cost_entries' },
  async (input: z.infer<typeof DeleteCostEntryInputSchema>, { session, setAuditResource }) => {
    const parsed = DeleteCostEntryInputSchema.parse(input)
    const [row] = await db
      .delete(costEntries)
      .where(
        and(eq(costEntries.id, parsed.entryId), eq(costEntries.tenantId, session.logifit.tenantId)),
      )
      .returning({ id: costEntries.id })
    if (!row)
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Lançamento não encontrado',
        request_id: '',
      })
    setAuditResource(row.id, {})
    return { id: row.id }
  },
)

// ─── createRecurringCost / toggle / list ─────────────────────────────────

export const createRecurringCost = wrapServerAction(
  { module: 'custos', action: 'recurring.create', resourceType: 'recurring_costs' },
  async (input: z.infer<typeof CreateRecurringCostInputSchema>, { session, setAuditResource }) => {
    const parsed = CreateRecurringCostInputSchema.parse(input)
    const [row] = await db
      .insert(recurringCosts)
      .values({
        tenantId: session.logifit.tenantId,
        companyId: parsed.companyId,
        categoryId: parsed.categoryId,
        amountCents: parsed.amountCents,
        dayOfMonth: parsed.dayOfMonth,
        description: parsed.description ?? null,
        startsAt: parsed.startsAt,
        endsAt: parsed.endsAt ?? null,
        active: true,
        createdByUserId: session.logifit.userId,
      })
      .returning({ id: recurringCosts.id })
    if (!row)
      throw new ApiException({
        code: 'INTERNAL_ERROR',
        message: 'Falha ao criar recorrência',
        request_id: '',
      })
    setAuditResource(row.id, { day_of_month: parsed.dayOfMonth })
    return { id: row.id }
  },
)

export const toggleRecurringCost = wrapServerAction(
  { module: 'custos', action: 'recurring.toggle', resourceType: 'recurring_costs' },
  async (input: z.infer<typeof ToggleRecurringCostInputSchema>, { session, setAuditResource }) => {
    const parsed = ToggleRecurringCostInputSchema.parse(input)
    const [row] = await db
      .update(recurringCosts)
      .set({ active: parsed.active, updatedAt: new Date() })
      .where(
        and(
          eq(recurringCosts.id, parsed.recurringId),
          eq(recurringCosts.tenantId, session.logifit.tenantId),
        ),
      )
      .returning({ id: recurringCosts.id })
    if (!row)
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Recorrência não encontrada',
        request_id: '',
      })
    setAuditResource(row.id, { active: parsed.active })
    return { id: row.id }
  },
)

export const listRecurringCosts = wrapServerAction(
  { module: 'custos', action: 'recurring.list' },
  async (_input: undefined, { session }) => {
    const rows = await db
      .select({
        id: recurringCosts.id,
        companyId: recurringCosts.companyId,
        categoryId: recurringCosts.categoryId,
        amountCents: recurringCosts.amountCents,
        dayOfMonth: recurringCosts.dayOfMonth,
        description: recurringCosts.description,
        startsAt: recurringCosts.startsAt,
        endsAt: recurringCosts.endsAt,
        active: recurringCosts.active,
        lastGeneratedAt: recurringCosts.lastGeneratedAt,
        categoryName: costCategories.name,
        categoryIcon: costCategories.icon,
      })
      .from(recurringCosts)
      .leftJoin(costCategories, eq(costCategories.id, recurringCosts.categoryId))
      .where(eq(recurringCosts.tenantId, session.logifit.tenantId))
      .orderBy(asc(recurringCosts.dayOfMonth))
    return { rows }
  },
)

// ─── generateDre ─────────────────────────────────────────────────────────
/**
 * DRE = dado administrativo sensível. wrapServerAction registra audit_log
 * automático com `module='custos'` + `action='dre.generate'` + `request_id`.
 */
export const generateDre = wrapServerAction(
  { module: 'custos', action: 'dre.generate' },
  async (input: z.infer<typeof GenerateDreInputSchema>, { session }) => {
    const parsed = GenerateDreInputSchema.parse(input)
    const fromDate = new Date(`${parsed.from}T00:00:00.000Z`)
    const toDate = new Date(`${parsed.to}T23:59:59.999Z`)
    if (fromDate >= toDate)
      throw new ApiException({
        code: 'VALIDATION_ERROR',
        message: 'Período inválido (from >= to)',
        request_id: '',
      })

    // Invoices do tenant (filtrado por company se informado)
    const invoiceConditions = [eq(invoices.tenantId, session.logifit.tenantId)]
    if (parsed.companyId) invoiceConditions.push(eq(invoices.companyId, parsed.companyId))

    const invoiceRows = await db
      .select({
        amountCents: invoices.amountCents,
        status: invoices.status,
        paidAt: invoices.paidAt,
        dueAt: invoices.dueAt,
      })
      .from(invoices)
      .where(and(...invoiceConditions))

    // Custos (filtrado por company se informado)
    const costConditions = [eq(costEntries.tenantId, session.logifit.tenantId)]
    if (parsed.companyId) costConditions.push(eq(costEntries.companyId, parsed.companyId))

    const costRows = await db
      .select({
        amountCents: costEntries.amountCents,
        categoryId: costEntries.categoryId,
        incurredAt: costEntries.incurredAt,
        categoryName: costCategories.name,
        categoryType: costCategories.type,
      })
      .from(costEntries)
      .leftJoin(costCategories, eq(costCategories.id, costEntries.categoryId))
      .where(and(...costConditions))

    const result = calculateDre({
      period: { from: fromDate, to: toDate },
      invoices: invoiceRows.map((i) => ({
        amountCents: i.amountCents,
        status: i.status,
        paidAt: i.paidAt,
        dueAt: i.dueAt,
      })),
      costEntries: costRows.map((c) => ({
        amountCents: c.amountCents,
        categoryId: c.categoryId,
        categoryName: c.categoryName ?? '(removida)',
        categoryType: (c.categoryType ?? 'variable') as 'fixed' | 'variable',
        incurredAt: c.incurredAt,
      })),
    })

    return { dre: result }
  },
)

// ─── forecastRevenueAction ───────────────────────────────────────────────
/**
 * Baseline = sum(plans.price × contracts active).
 * Churn = (contratos cancelados últimos 6m) / (média contratos ativos últimos 6m).
 * Substituível por modelo preditivo Sprint 19 (ADR 0027).
 */
export const forecastRevenueAction = wrapServerAction(
  { module: 'custos', action: 'dre.forecast' },
  async (input: z.infer<typeof ForecastInputSchema>, { session }) => {
    const parsed = ForecastInputSchema.parse(input)

    // Baseline: contratos ativos × valor do plano
    const baselineRows = await db
      .select({
        priceCents: plans.priceCents,
      })
      .from(contracts)
      .innerJoin(plans, eq(plans.id, contracts.planId))
      .where(and(eq(contracts.tenantId, session.logifit.tenantId), eq(contracts.status, 'active')))
    const baselineMonthlyCents = baselineRows.reduce((acc, row) => acc + row.priceCents, 0)

    // Churn heurístico: simples — contratos cancelados últimos 6m vs base ativa
    let churnRate = parsed.manualChurnRate ?? 0
    if (parsed.manualChurnRate === undefined) {
      const sixMonthsAgo = new Date()
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6)
      const cancelled = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(contracts)
        .where(
          and(
            eq(contracts.tenantId, session.logifit.tenantId),
            eq(contracts.status, 'cancelled'),
            gte(contracts.cancelledAt, sixMonthsAgo),
          ),
        )
      const cancelledCount = cancelled[0]?.n ?? 0
      const activeBase = baselineRows.length || 1
      const monthlyChurn = cancelledCount / activeBase / 6
      churnRate = Math.min(0.5, Math.max(0, monthlyChurn))
    }

    const forecast = forecastRevenue({
      baselineMonthlyCents,
      monthlyChurnRate: churnRate,
      monthsAhead: parsed.monthsAhead,
    })

    return {
      baselineMonthlyCents,
      churnRate: Math.round(churnRate * 10000) / 10000,
      activeContracts: baselineRows.length,
      forecast,
    }
  },
)
