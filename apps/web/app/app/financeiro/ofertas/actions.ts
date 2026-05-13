'use server'

/**
 * Server Actions de ofertas comerciais — Sprint 05 Faixa B (ADR 0020 esperado).
 *
 * Pipeline:
 *   - Promotion: createPromotion + applyPromotion (valida + grava promotion_use)
 *   - Bundle: createBundle (plan.kind='bundle' + plan_items[]) +
 *     subscribeBundle (cria contract + appointment_credits do bundle)
 *   - Credit: consumeCredit (consumido no createAppointment integrado)
 *   - Referral: createReferralCode + applyReferral
 *
 * **`canApply(promotion, ctx)`**: validator centralizado em
 * `packages/db/src/ofertas/validate.ts`. Verifica:
 *   - active + archivedAt IS NULL
 *   - valid_from <= now <= valid_to (ou valid_to NULL)
 *   - max_uses NULL OR uses_count < max_uses
 *   - min_amount_cents OK (se invoice)
 *
 * **Idempotência aplicação**: `promotion_uses` é audit append-only; race entre
 * 2 aplicações simultâneas pode passar ambos no canApply mas só 1 vai conseguir
 * UPDATE uses_count com WHERE uses_count < max_uses (regra otimista). Sprint 06+
 * pode adicionar advisory lock se virar pain.
 */

import { db } from '@repo/db/client'
import {
  appointmentCredits,
  contracts,
  creditConsumptions,
  invoices,
  members,
  planItems,
  plans,
  promotionUses,
  promotions,
  referralUses,
  referrals,
} from '@repo/db/schema'
import { ApiException } from '@repo/errors'
import { and, eq, gte, isNull, lte, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { wrapServerAction } from '../../../lib/wrap-action'

// ─── Zod schemas ──────────────────────────────────────────────────────────

const PromotionKindSchema = z.enum(['percent', 'fixed', 'trial_days'])

const CreatePromotionInputSchema = z.object({
  code: z.string().min(2).max(40).regex(/^[A-Z0-9_-]+$/i),
  name: z.string().min(2).max(120),
  description: z.string().max(2000).optional(),
  kind: PromotionKindSchema,
  value: z.number().int().min(0).max(1000000),
  validFrom: z.string().datetime().optional(),
  validTo: z.string().datetime().optional(),
  maxUses: z.number().int().min(1).optional(),
  minAmountCents: z.number().int().min(0).optional(),
  stackable: z.boolean().default(false),
})

const ApplyPromotionInputSchema = z.object({
  code: z.string().min(2),
  invoiceId: z.string().uuid().optional(),
  contractId: z.string().uuid().optional(),
})

const CreateBundleInputSchema = z.object({
  companyId: z.string().uuid(),
  name: z.string().min(2).max(120),
  priceCents: z.number().int().min(0),
  items: z
    .array(
      z.object({
        serviceType: z.string().min(2).max(60),
        quantity: z.number().int().min(1).max(1000),
        creditValidityDays: z.number().int().min(1).max(365).optional(),
      }),
    )
    .min(1),
})

const SubscribeBundleInputSchema = z.object({
  memberId: z.string().uuid(),
  bundlePlanId: z.string().uuid(),
  startedAt: z.string().datetime().optional(),
})

const CreateReferralCodeInputSchema = z.object({
  memberId: z.string().uuid(),
  rewardPromotionId: z.string().uuid(),
  maxUses: z.number().int().min(1).optional(),
})

const ApplyReferralInputSchema = z.object({
  code: z.string().min(2),
  referredMemberId: z.string().uuid(),
  contractId: z.string().uuid().optional(),
})

// ─── createPromotion ──────────────────────────────────────────────────────

export const createPromotion = wrapServerAction(
  { module: 'ofertas', action: 'promotion.create', resourceType: 'promotions' },
  async (input: z.infer<typeof CreatePromotionInputSchema>, { session }) => {
    const parsed = CreatePromotionInputSchema.parse(input)
    const [row] = await db
      .insert(promotions)
      .values({
        tenantId: session.logifit.tenantId,
        code: parsed.code.toUpperCase(),
        name: parsed.name,
        description: parsed.description ?? null,
        kind: parsed.kind,
        value: parsed.value,
        validFrom: parsed.validFrom ? new Date(parsed.validFrom) : new Date(),
        validTo: parsed.validTo ? new Date(parsed.validTo) : null,
        maxUses: parsed.maxUses ?? null,
        minAmountCents: parsed.minAmountCents ?? null,
        stackable: parsed.stackable,
        active: true,
      })
      .returning({ id: promotions.id })
    if (!row)
      throw new ApiException({
        code: 'INTERNAL_ERROR',
        message: 'Falha ao criar promoção',
        request_id: '',
      })
    return { id: row.id }
  },
)

// ─── applyPromotion ───────────────────────────────────────────────────────
// Valida promoção + calcula desconto + grava promotion_use + atualiza invoice
// breakdown.

export const applyPromotion = wrapServerAction(
  { module: 'ofertas', action: 'promotion.apply' },
  async (input: z.infer<typeof ApplyPromotionInputSchema>, { session }) => {
    const parsed = ApplyPromotionInputSchema.parse(input)
    if (!parsed.invoiceId && !parsed.contractId) {
      throw new ApiException({
        code: 'VALIDATION_ERROR',
        message: 'invoiceId ou contractId é obrigatório',
        request_id: '',
      })
    }

    // Carrega promotion ativa
    const [promo] = await db
      .select()
      .from(promotions)
      .where(
        and(
          eq(promotions.tenantId, session.logifit.tenantId),
          eq(promotions.code, parsed.code.toUpperCase()),
          eq(promotions.active, true),
          isNull(promotions.archivedAt),
        ),
      )
      .limit(1)

    if (!promo)
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Cupom não encontrado ou inativo',
        request_id: '',
      })

    const now = new Date()
    if (promo.validFrom > now)
      throw new ApiException({
        code: 'CONFLICT',
        message: 'Cupom ainda não está vigente',
        request_id: '',
      })
    if (promo.validTo && promo.validTo < now)
      throw new ApiException({
        code: 'CONFLICT',
        message: 'Cupom expirado',
        request_id: '',
      })
    if (promo.maxUses !== null && promo.usesCount >= promo.maxUses)
      throw new ApiException({
        code: 'CONFLICT',
        message: 'Cupom esgotado',
        request_id: '',
      })

    // Resolve target (invoice ou contract → invoice mais recente pending)
    let targetInvoice: { id: string; amountCents: number; breakdown: unknown } | null = null
    if (parsed.invoiceId) {
      const [inv] = await db
        .select({
          id: invoices.id,
          amountCents: invoices.amountCents,
          breakdown: invoices.breakdown,
        })
        .from(invoices)
        .where(
          and(
            eq(invoices.id, parsed.invoiceId),
            eq(invoices.tenantId, session.logifit.tenantId),
            eq(invoices.status, 'pending'),
          ),
        )
        .limit(1)
      targetInvoice = inv ?? null
    } else if (parsed.contractId) {
      const [inv] = await db
        .select({
          id: invoices.id,
          amountCents: invoices.amountCents,
          breakdown: invoices.breakdown,
        })
        .from(invoices)
        .where(
          and(
            eq(invoices.contractId, parsed.contractId),
            eq(invoices.tenantId, session.logifit.tenantId),
            eq(invoices.status, 'pending'),
          ),
        )
        .orderBy(invoices.dueAt)
        .limit(1)
      targetInvoice = inv ?? null
    }

    if (!targetInvoice)
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Invoice pending não encontrada para aplicar promoção',
        request_id: '',
      })

    if (
      promo.minAmountCents !== null &&
      targetInvoice.amountCents < promo.minAmountCents
    )
      throw new ApiException({
        code: 'CONFLICT',
        message: `Cupom exige valor mínimo de R$ ${(promo.minAmountCents / 100).toFixed(2)}`,
        request_id: '',
      })

    // Calcula desconto
    let discountCents = 0
    if (promo.kind === 'percent') {
      discountCents = Math.floor((targetInvoice.amountCents * promo.value) / 10000)
    } else if (promo.kind === 'fixed') {
      discountCents = Math.min(promo.value, targetInvoice.amountCents - 1)
    } else if (promo.kind === 'trial_days') {
      // trial_days não aplica desconto; ignora amount (Sprint 06+ pode mexer em dates)
      discountCents = 0
    }

    if (discountCents <= 0 && promo.kind !== 'trial_days')
      throw new ApiException({
        code: 'VALIDATION_ERROR',
        message: 'Desconto calculado inválido (>=0)',
        request_id: '',
      })

    // Aplica em transação: UPDATE invoice + INSERT promotion_use + UPDATE promo uses_count
    const result = await db.transaction(async (tx) => {
      // Update uses_count com WHERE pra detectar race
      const upd = await tx
        .update(promotions)
        .set({ usesCount: sql`${promotions.usesCount} + 1`, updatedAt: new Date() })
        .where(
          and(
            eq(promotions.id, promo.id),
            or(
              isNull(promotions.maxUses),
              sql`${promotions.usesCount} < ${promotions.maxUses}`,
            ),
          ),
        )
        .returning({ id: promotions.id })

      if (upd.length === 0) {
        throw new ApiException({
          code: 'CONFLICT',
          message: 'Cupom esgotado (race)',
          request_id: '',
        })
      }

      // Update invoice amount + breakdown
      if (discountCents > 0 && targetInvoice) {
        const existingBreakdown =
          (targetInvoice.breakdown as Record<string, unknown> | null) ?? {
            base: targetInvoice.amountCents,
            overage_items: [],
            discounts: [],
            surcharges: [],
          }
        const discounts = (existingBreakdown.discounts as Array<unknown>) ?? []
        discounts.push({
          source: 'promotion',
          promotion_code: promo.code,
          promotion_id: promo.id,
          amount_cents: discountCents,
          applied_at: new Date().toISOString(),
          applied_by: session.logifit.userId,
        })
        await tx
          .update(invoices)
          .set({
            amountCents: targetInvoice.amountCents - discountCents,
            breakdown: { ...existingBreakdown, discounts },
            updatedAt: new Date(),
          })
          .where(eq(invoices.id, targetInvoice.id))
      }

      // Grava promotion_use
      const [useRow] = await tx
        .insert(promotionUses)
        .values({
          tenantId: session.logifit.tenantId,
          promotionId: promo.id,
          contractId: parsed.contractId ?? null,
          invoiceId: targetInvoice?.id ?? null,
          discountCents,
          usedByUserId: session.logifit.userId,
        })
        .returning({ id: promotionUses.id })

      return { promotionUseId: useRow?.id, discountCents }
    })

    return result
  },
)

// ─── createBundle ─────────────────────────────────────────────────────────
// Cria plan kind='bundle' + plan_items[].

export const createBundle = wrapServerAction(
  { module: 'ofertas', action: 'bundle.create' },
  async (input: z.infer<typeof CreateBundleInputSchema>, { session }) => {
    const parsed = CreateBundleInputSchema.parse(input)

    const result = await db.transaction(async (tx) => {
      const [bundle] = await tx
        .insert(plans)
        .values({
          tenantId: session.logifit.tenantId,
          companyId: parsed.companyId,
          name: parsed.name,
          kind: 'bundle',
          priceCents: parsed.priceCents,
          billingCycle: 'monthly',
        })
        .returning({ id: plans.id })

      if (!bundle) throw new Error('Falha ao criar bundle')

      for (let i = 0; i < parsed.items.length; i++) {
        const item = parsed.items[i]
        if (!item) continue
        await tx.insert(planItems).values({
          tenantId: session.logifit.tenantId,
          bundlePlanId: bundle.id,
          idx: i,
          serviceType: item.serviceType,
          quantity: item.quantity,
          creditValidityDays: item.creditValidityDays ?? null,
        })
      }

      return { bundleId: bundle.id, itemsCount: parsed.items.length }
    })

    return result
  },
)

// ─── subscribeBundle ──────────────────────────────────────────────────────
// Cria contract + appointment_credits a partir dos plan_items.

export const subscribeBundle = wrapServerAction(
  { module: 'ofertas', action: 'bundle.subscribe', resourceType: 'contracts' },
  async (input: z.infer<typeof SubscribeBundleInputSchema>, { session }) => {
    const parsed = SubscribeBundleInputSchema.parse(input)
    const startsAt = parsed.startedAt ? new Date(parsed.startedAt) : new Date()

    const [bundle] = await db
      .select({
        id: plans.id,
        companyId: plans.companyId,
        priceCents: plans.priceCents,
        kind: plans.kind,
      })
      .from(plans)
      .where(
        and(
          eq(plans.id, parsed.bundlePlanId),
          eq(plans.tenantId, session.logifit.tenantId),
          eq(plans.active, true),
        ),
      )
      .limit(1)

    if (!bundle)
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Bundle não encontrado ou inativo',
        request_id: '',
      })

    if (bundle.kind !== 'bundle')
      throw new ApiException({
        code: 'VALIDATION_ERROR',
        message: 'Plan não é um bundle — use subscribeMember para plans normais',
        request_id: '',
      })

    const items = await db
      .select()
      .from(planItems)
      .where(
        and(
          eq(planItems.bundlePlanId, bundle.id),
          eq(planItems.tenantId, session.logifit.tenantId),
        ),
      )

    if (items.length === 0)
      throw new ApiException({
        code: 'CONFLICT',
        message: 'Bundle vazio (sem plan_items)',
        request_id: '',
      })

    const result = await db.transaction(async (tx) => {
      const [contract] = await tx
        .insert(contracts)
        .values({
          tenantId: session.logifit.tenantId,
          companyId: bundle.companyId,
          memberId: parsed.memberId,
          planId: bundle.id,
          startedAt: startsAt,
          status: 'active',
          billingDay: startsAt.getUTCDate() <= 28 ? startsAt.getUTCDate() : 28,
        })
        .returning({ id: contracts.id })

      if (!contract) throw new Error('Falha ao criar contract pra bundle')

      const credits: Array<{ id: string }> = []
      for (const item of items) {
        const expiresAt = item.creditValidityDays
          ? new Date(startsAt.getTime() + item.creditValidityDays * 86400000)
          : null
        const [credit] = await tx
          .insert(appointmentCredits)
          .values({
            tenantId: session.logifit.tenantId,
            memberId: parsed.memberId,
            contractId: contract.id,
            serviceType: item.serviceType,
            balance: item.quantity,
            initialQuantity: item.quantity,
            source: 'bundle',
            expiresAt,
          })
          .returning({ id: appointmentCredits.id })
        if (credit) credits.push({ id: credit.id })
      }

      // 1ª invoice (mesmo padrão de subscribeMember Sprint 04 Faixa B)
      const dueAt = new Date(startsAt)
      dueAt.setDate(startsAt.getDate() + 5)
      const [invoice] = await tx
        .insert(invoices)
        .values({
          tenantId: session.logifit.tenantId,
          companyId: bundle.companyId,
          contractId: contract.id,
          memberId: parsed.memberId,
          amountCents: bundle.priceCents,
          dueAt,
          status: 'pending',
          breakdown: {
            base: bundle.priceCents,
            overage_items: [],
            discounts: [],
            surcharges: [],
            bundle_items: items.map((it) => ({
              service_type: it.serviceType,
              quantity: it.quantity,
            })),
          },
        })
        .returning({ id: invoices.id })

      return { contractId: contract.id, invoiceId: invoice?.id, creditIds: credits.map((c) => c.id) }
    })

    return result
  },
)

// ─── consumeCredit ────────────────────────────────────────────────────────
// Decrementa balance + grava credit_consumption. Usado pelo createAppointment
// (Sprint 03) quando member tem crédito válido pro service_type.

export const consumeCredit = wrapServerAction(
  { module: 'ofertas', action: 'credit.consume' },
  async (
    input: { memberId: string; serviceType: string; appointmentId?: string; amount?: number },
    { session },
  ) => {
    const memberId = z.string().uuid().parse(input.memberId)
    const serviceType = z.string().min(2).parse(input.serviceType)
    const amount = z.number().int().min(1).default(1).parse(input.amount ?? 1)
    const appointmentId = input.appointmentId
      ? z.string().uuid().parse(input.appointmentId)
      : null

    // Busca crédito ativo + balance >= amount (FIFO: oldest expires_at first)
    const now = new Date()
    const [credit] = await db
      .select()
      .from(appointmentCredits)
      .where(
        and(
          eq(appointmentCredits.tenantId, session.logifit.tenantId),
          eq(appointmentCredits.memberId, memberId),
          eq(appointmentCredits.serviceType, serviceType),
          gte(appointmentCredits.balance, amount),
          or(
            isNull(appointmentCredits.expiresAt),
            gte(appointmentCredits.expiresAt, now),
          ),
        ),
      )
      .orderBy(appointmentCredits.expiresAt, appointmentCredits.earnedAt)
      .limit(1)

    if (!credit) {
      // Sem crédito disponível — não é erro, caller decide se cobrar avulso
      return { consumed: false }
    }

    await db.transaction(async (tx) => {
      const upd = await tx
        .update(appointmentCredits)
        .set({
          balance: sql`${appointmentCredits.balance} - ${amount}`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(appointmentCredits.id, credit.id),
            gte(appointmentCredits.balance, amount), // Defensa contra race
          ),
        )
        .returning({ id: appointmentCredits.id })

      if (upd.length === 0) {
        throw new ApiException({
          code: 'CONFLICT',
          message: 'Crédito consumido em race — tentar novamente',
          request_id: '',
        })
      }

      await tx.insert(creditConsumptions).values({
        tenantId: session.logifit.tenantId,
        creditId: credit.id,
        appointmentId,
        amount,
        consumedByUserId: session.logifit.userId,
      })
    })

    return { consumed: true, creditId: credit.id, remainingBalance: credit.balance - amount }
  },
)

// ─── listMemberCredits ────────────────────────────────────────────────────
// Sprint 05 Faixa C — widget créditos em member detail.

export const listMemberCredits = wrapServerAction(
  { module: 'ofertas', action: 'credit.list_by_member' },
  async (input: { memberId: string }, { session }) => {
    const memberId = z.string().uuid().parse(input.memberId)
    const now = new Date()
    const rows = await db
      .select({
        id: appointmentCredits.id,
        serviceType: appointmentCredits.serviceType,
        balance: appointmentCredits.balance,
        initialQuantity: appointmentCredits.initialQuantity,
        source: appointmentCredits.source,
        expiresAt: appointmentCredits.expiresAt,
        earnedAt: appointmentCredits.earnedAt,
      })
      .from(appointmentCredits)
      .where(
        and(
          eq(appointmentCredits.tenantId, session.logifit.tenantId),
          eq(appointmentCredits.memberId, memberId),
          gte(appointmentCredits.balance, 1),
          or(
            isNull(appointmentCredits.expiresAt),
            gte(appointmentCredits.expiresAt, now),
          ),
        ),
      )
      .orderBy(appointmentCredits.expiresAt)
      .limit(20)

    return { credits: rows }
  },
)

// ─── createReferralCode ───────────────────────────────────────────────────

export const createReferralCode = wrapServerAction(
  { module: 'ofertas', action: 'referral.create' },
  async (input: z.infer<typeof CreateReferralCodeInputSchema>, { session }) => {
    const parsed = CreateReferralCodeInputSchema.parse(input)

    // Gera código único 8 chars (sem 0/O/I/1 pra UX)
    const code = generateReferralCode()

    const [row] = await db
      .insert(referrals)
      .values({
        tenantId: session.logifit.tenantId,
        referrerMemberId: parsed.memberId,
        code,
        rewardPromotionId: parsed.rewardPromotionId,
        maxUses: parsed.maxUses ?? null,
        active: true,
      })
      .returning({ id: referrals.id, code: referrals.code })

    if (!row)
      throw new ApiException({
        code: 'INTERNAL_ERROR',
        message: 'Falha ao gerar código referral',
        request_id: '',
      })

    return { id: row.id, code: row.code }
  },
)

function generateReferralCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // exclui 0/O/I/1
  let code = ''
  for (let i = 0; i < 8; i++) {
    code += chars[Math.floor(Math.random() * chars.length)]
  }
  return code
}

// ─── applyReferral ────────────────────────────────────────────────────────

export const applyReferral = wrapServerAction(
  { module: 'ofertas', action: 'referral.apply' },
  async (input: z.infer<typeof ApplyReferralInputSchema>, { session }) => {
    const parsed = ApplyReferralInputSchema.parse(input)

    const [ref] = await db
      .select()
      .from(referrals)
      .where(
        and(
          eq(referrals.tenantId, session.logifit.tenantId),
          eq(referrals.code, parsed.code.toUpperCase()),
          eq(referrals.active, true),
        ),
      )
      .limit(1)

    if (!ref)
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Código de referral inválido',
        request_id: '',
      })

    if (ref.maxUses !== null && ref.usesCount >= ref.maxUses)
      throw new ApiException({
        code: 'CONFLICT',
        message: 'Código de referral esgotado',
        request_id: '',
      })

    // Member não pode usar próprio código
    if (ref.referrerMemberId === parsed.referredMemberId)
      throw new ApiException({
        code: 'VALIDATION_ERROR',
        message: 'Member não pode usar próprio código',
        request_id: '',
      })

    const result = await db.transaction(async (tx) => {
      const upd = await tx
        .update(referrals)
        .set({ usesCount: sql`${referrals.usesCount} + 1` })
        .where(
          and(
            eq(referrals.id, ref.id),
            or(isNull(referrals.maxUses), sql`${referrals.usesCount} < ${referrals.maxUses}`),
          ),
        )
        .returning({ id: referrals.id })

      if (upd.length === 0) {
        throw new ApiException({
          code: 'CONFLICT',
          message: 'Código esgotado (race)',
          request_id: '',
        })
      }

      const [useRow] = await tx
        .insert(referralUses)
        .values({
          tenantId: session.logifit.tenantId,
          referralId: ref.id,
          referredMemberId: parsed.referredMemberId,
          contractId: parsed.contractId ?? null,
        })
        .returning({ id: referralUses.id })

      return {
        referralUseId: useRow?.id,
        rewardPromotionId: ref.rewardPromotionId,
        referrerMemberId: ref.referrerMemberId,
      }
    })

    return result
  },
)
