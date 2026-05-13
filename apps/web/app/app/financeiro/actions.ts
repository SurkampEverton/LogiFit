'use server'

/**
 * Server Actions de `financeiro` — Sprint 04 Faixa B (ADR 0013 + 0014 esperados).
 *
 * Pipeline: plan → contract → invoice → payment.
 * - `createPlan` / `updatePlan` / `archivePlan` — catálogo.
 * - `subscribeMember(memberId, planId, ...)` — cria contrato + 1ª invoice
 *   `pending`. Sprint 04 Faixa B inicial: invoice local; sync com Asaas
 *   (criar cobrança real) entra com `syncInvoiceToAsaas()` Faixa C.
 * - `cancelContract(contractId, reason)` — soft cancel + audit.
 * - `applyDiscount(invoiceId, amount, reason)` — ajusta breakdown + audit
 *   trail obrigatório.
 *
 * **Idempotência**: `subscribeMember` aceita `idempotencyKey` opcional
 * (Sprint 04+ Faixa C bind via header `x-idempotency-key`).
 *
 * **Envelope encryption**: chaves Asaas (`asaas_keys.api_key`) ciframos com
 * `@repo/security/envelope-crypto` ao gravar. Decifra só na hora do call
 * pra Asaas API (Sprint 04+ Faixa C).
 */

import { db } from '@repo/db/client'
import { contracts, invoices, plans } from '@repo/db/schema'
import { ApiException } from '@repo/errors'
import { and, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { wrapServerAction } from '../../lib/wrap-action'

// ─── Zod schemas ──────────────────────────────────────────────────────────

const BillingCycleSchema = z.enum(['monthly', 'quarterly', 'yearly'])
const ContractStatusSchema = z.enum(['active', 'paused', 'cancelled', 'expired'])

const CreatePlanInputSchema = z.object({
  companyId: z.string().uuid(),
  name: z.string().min(2).max(120),
  description: z.string().max(2000).optional(),
  priceCents: z.number().int().min(0),
  billingCycle: BillingCycleSchema.default('monthly'),
  trialDays: z.number().int().min(0).max(90).default(0),
  cancelNoticeDays: z.number().int().min(0).max(60).default(0),
})

const UpdatePlanInputSchema = z.object({
  planId: z.string().uuid(),
  name: z.string().min(2).max(120).optional(),
  description: z.string().max(2000).optional(),
  priceCents: z.number().int().min(0).optional(),
  billingCycle: BillingCycleSchema.optional(),
  trialDays: z.number().int().min(0).max(90).optional(),
  cancelNoticeDays: z.number().int().min(0).max(60).optional(),
})

const ArchivePlanInputSchema = z.object({ planId: z.string().uuid() })

const SubscribeMemberInputSchema = z.object({
  memberId: z.string().uuid(),
  planId: z.string().uuid(),
  startedAt: z.string().datetime().optional(),
  billingDay: z.number().int().min(1).max(28).default(10),
})

const CancelContractInputSchema = z.object({
  contractId: z.string().uuid(),
  reason: z.string().min(2).max(500),
  effectiveAt: z.string().datetime().optional(),
})

const ApplyDiscountInputSchema = z.object({
  invoiceId: z.string().uuid(),
  amountCents: z.number().int().min(1),
  reason: z.string().min(2).max(500),
})

const ListPlansInputSchema = z.object({
  includeArchived: z.boolean().default(false),
  companyId: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(500).default(100),
})

// ─── createPlan ───────────────────────────────────────────────────────────

export const createPlan = wrapServerAction(
  { module: 'financeiro', action: 'plan.create', resourceType: 'plans' },
  async (input: z.infer<typeof CreatePlanInputSchema>, { session }) => {
    const parsed = CreatePlanInputSchema.parse(input)
    const [row] = await db
      .insert(plans)
      .values({
        tenantId: session.logifit.tenantId,
        companyId: parsed.companyId,
        name: parsed.name,
        description: parsed.description ?? null,
        priceCents: parsed.priceCents,
        billingCycle: parsed.billingCycle,
        trialDays: parsed.trialDays,
        cancelNoticeDays: parsed.cancelNoticeDays,
        active: true,
      })
      .returning({ id: plans.id })
    if (!row)
      throw new ApiException({
        code: 'INTERNAL_ERROR',
        message: 'Falha ao criar plano',
        request_id: '',
      })
    return { id: row.id }
  },
)

// ─── updatePlan ───────────────────────────────────────────────────────────

export const updatePlan = wrapServerAction(
  { module: 'financeiro', action: 'plan.update' },
  async (input: z.infer<typeof UpdatePlanInputSchema>, { session }) => {
    const parsed = UpdatePlanInputSchema.parse(input)
    const fields: Record<string, unknown> = { updatedAt: new Date() }
    if (parsed.name !== undefined) fields.name = parsed.name
    if (parsed.description !== undefined) fields.description = parsed.description
    if (parsed.priceCents !== undefined) fields.priceCents = parsed.priceCents
    if (parsed.billingCycle !== undefined) fields.billingCycle = parsed.billingCycle
    if (parsed.trialDays !== undefined) fields.trialDays = parsed.trialDays
    if (parsed.cancelNoticeDays !== undefined) fields.cancelNoticeDays = parsed.cancelNoticeDays

    const [row] = await db
      .update(plans)
      .set(fields)
      .where(and(eq(plans.id, parsed.planId), eq(plans.tenantId, session.logifit.tenantId)))
      .returning({ id: plans.id })
    if (!row)
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Plano não encontrado',
        request_id: '',
      })
    return { id: row.id }
  },
)

// ─── archivePlan ──────────────────────────────────────────────────────────

export const archivePlan = wrapServerAction(
  { module: 'financeiro', action: 'plan.archive' },
  async (input: z.infer<typeof ArchivePlanInputSchema>, { session }) => {
    const parsed = ArchivePlanInputSchema.parse(input)
    const [row] = await db
      .update(plans)
      .set({ archivedAt: new Date(), active: false, updatedAt: new Date() })
      .where(and(eq(plans.id, parsed.planId), eq(plans.tenantId, session.logifit.tenantId)))
      .returning({ id: plans.id })
    if (!row)
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Plano não encontrado',
        request_id: '',
      })
    return { id: row.id }
  },
)

// ─── subscribeMember ──────────────────────────────────────────────────────

export const subscribeMember = wrapServerAction(
  { module: 'financeiro', action: 'contract.create', resourceType: 'contracts' },
  async (input: z.infer<typeof SubscribeMemberInputSchema>, { session }) => {
    const parsed = SubscribeMemberInputSchema.parse(input)
    const startsAt = parsed.startedAt ? new Date(parsed.startedAt) : new Date()

    // Carrega plan pra companyId + priceCents
    const [plan] = await db
      .select({
        id: plans.id,
        companyId: plans.companyId,
        priceCents: plans.priceCents,
        billingCycle: plans.billingCycle,
      })
      .from(plans)
      .where(
        and(
          eq(plans.id, parsed.planId),
          eq(plans.tenantId, session.logifit.tenantId),
          eq(plans.active, true),
          isNull(plans.archivedAt),
        ),
      )
      .limit(1)
    if (!plan)
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Plano não encontrado ou inativo',
        request_id: '',
      })

    // Cria contract + 1ª invoice em transação
    const result = await db.transaction(async (tx) => {
      const [contract] = await tx
        .insert(contracts)
        .values({
          tenantId: session.logifit.tenantId,
          companyId: plan.companyId,
          memberId: parsed.memberId,
          planId: plan.id,
          startedAt: startsAt,
          status: 'active',
          billingDay: parsed.billingDay,
        })
        .returning({ id: contracts.id })

      if (!contract) throw new Error('Falha ao criar contrato')

      // 1ª invoice — due_at = startsAt + 5d (D-5 do vencimento)
      const dueAt = new Date(startsAt)
      dueAt.setDate(startsAt.getDate() + 5)

      const [invoice] = await tx
        .insert(invoices)
        .values({
          tenantId: session.logifit.tenantId,
          companyId: plan.companyId,
          contractId: contract.id,
          memberId: parsed.memberId,
          amountCents: plan.priceCents,
          dueAt,
          status: 'pending',
          breakdown: { base: plan.priceCents, overage_items: [], discounts: [], surcharges: [] },
        })
        .returning({ id: invoices.id })

      if (!invoice) throw new Error('Falha ao criar primeira invoice')

      return { contractId: contract.id, invoiceId: invoice.id }
    })

    return result
  },
)

// ─── cancelContract ───────────────────────────────────────────────────────

export const cancelContract = wrapServerAction(
  { module: 'financeiro', action: 'contract.cancel' },
  async (input: z.infer<typeof CancelContractInputSchema>, { session }) => {
    const parsed = CancelContractInputSchema.parse(input)
    const effectiveAt = parsed.effectiveAt ? new Date(parsed.effectiveAt) : new Date()

    const [row] = await db
      .update(contracts)
      .set({
        status: 'cancelled',
        cancelledAt: effectiveAt,
        cancelledReason: parsed.reason,
        endsAt: effectiveAt,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(contracts.id, parsed.contractId),
          eq(contracts.tenantId, session.logifit.tenantId),
          eq(contracts.status, 'active'),
        ),
      )
      .returning({ id: contracts.id })

    if (!row)
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Contrato não encontrado ou não está ativo',
        request_id: '',
      })

    return { id: row.id }
  },
)

// ─── applyDiscount ────────────────────────────────────────────────────────
// Aplica desconto em invoice pending. Reduz amount_cents + adiciona em
// `breakdown.discounts[]` pra audit trail. Sprint 04+ Faixa C valida que
// `permission='invoice.discount'` ou similar.

export const applyDiscount = wrapServerAction(
  { module: 'financeiro', action: 'invoice.apply_discount' },
  async (input: z.infer<typeof ApplyDiscountInputSchema>, { session }) => {
    const parsed = ApplyDiscountInputSchema.parse(input)

    const [current] = await db
      .select({
        id: invoices.id,
        amountCents: invoices.amountCents,
        status: invoices.status,
        breakdown: invoices.breakdown,
      })
      .from(invoices)
      .where(
        and(eq(invoices.id, parsed.invoiceId), eq(invoices.tenantId, session.logifit.tenantId)),
      )
      .limit(1)
    if (!current)
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Invoice não encontrada',
        request_id: '',
      })
    if (current.status !== 'pending')
      throw new ApiException({
        code: 'CONFLICT',
        message: 'Desconto só pode ser aplicado em invoice pending',
        request_id: '',
      })
    if (parsed.amountCents >= current.amountCents)
      throw new ApiException({
        code: 'VALIDATION_ERROR',
        message: 'Desconto não pode ser maior ou igual ao valor da invoice',
        request_id: '',
      })

    const existingBreakdown = (current.breakdown as Record<string, unknown> | null) ?? {
      base: current.amountCents,
      overage_items: [],
      discounts: [],
      surcharges: [],
    }
    const discounts = (existingBreakdown.discounts as Array<unknown>) ?? []
    discounts.push({
      amount_cents: parsed.amountCents,
      reason: parsed.reason,
      applied_at: new Date().toISOString(),
      applied_by: session.logifit.userId,
    })

    await db
      .update(invoices)
      .set({
        amountCents: current.amountCents - parsed.amountCents,
        breakdown: { ...existingBreakdown, discounts },
        updatedAt: new Date(),
      })
      .where(eq(invoices.id, parsed.invoiceId))

    return { id: parsed.invoiceId, newAmountCents: current.amountCents - parsed.amountCents }
  },
)

// ─── listPlans ────────────────────────────────────────────────────────────

export const listPlans = wrapServerAction(
  { module: 'financeiro', action: 'plan.list' },
  async (input: z.infer<typeof ListPlansInputSchema>, { session }) => {
    const parsed = ListPlansInputSchema.parse(input)
    const conditions = [eq(plans.tenantId, session.logifit.tenantId)]
    if (!parsed.includeArchived) conditions.push(isNull(plans.archivedAt))
    if (parsed.companyId) conditions.push(eq(plans.companyId, parsed.companyId))

    const rows = await db
      .select({
        id: plans.id,
        companyId: plans.companyId,
        name: plans.name,
        priceCents: plans.priceCents,
        billingCycle: plans.billingCycle,
        active: plans.active,
        archivedAt: plans.archivedAt,
        createdAt: plans.createdAt,
      })
      .from(plans)
      .where(and(...conditions))
      .limit(parsed.limit)

    return { plans: rows }
  },
)
