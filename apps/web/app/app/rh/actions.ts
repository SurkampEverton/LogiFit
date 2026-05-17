'use server'

/**
 * Server Actions RH (Comissões + Repasse) — Sprint 23 Faixa B.2 (ADR 0086).
 *
 * MVP:
 *   - createProfessionalContract (com gate ADR 0055 council_body)
 *   - listProfessionalContracts
 *   - createCommissionRule
 *   - calculateCommissionForEvent (chamado por listeners — Sprint 23b cron real)
 *   - listCommissionEntries (filtros person/period/status)
 *   - closePeriod (agrega pending → period draft + marca incluídas)
 *   - approvePeriod (transição draft → approved + grava aprovador)
 *   - markPeriodPaid (Sprint 23b integra Asaas real)
 *   - listCommissionPeriods (com filtros status/period)
 *   - generateExtractStub (Sprint 23b implementa @react-pdf/renderer)
 *
 * **Gate ADR 0055** — `createProfessionalContract` valida:
 *   1. person_id existe no tenant
 *   2. service_type → council_body mapping
 *   3. existe `professional_registrations` ativo com council_body coerente
 */

import {
  aggregateEntries,
  calculateCommission,
  type CommissionContract,
  type CommissionEvent,
  type CommissionRuleRow,
} from '@repo/db/rh'
import { db } from '@repo/db/client'
import {
  commissionEntries,
  commissionPeriods,
  commissionRules,
  persons,
  professionalContracts,
  professionalRegistrations,
} from '@repo/db/schema'
import { ApiException } from '@repo/errors'
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'
import { wrapServerAction } from '../../lib/wrap-action'

// ─── service_type → council_body mapping (ADR 0055) ──────────────────

const SERVICE_TO_COUNCIL: Record<string, string | null> = {
  fisioterapia: 'CREFITO',
  personal_training: 'CREF',
  nutricao: 'CRN',
  medicina: 'CRM',
  enfermagem: 'COREN',
  // Custom/sem conselho regulado:
  custom: null,
}

function councilForService(serviceType: string): string | null {
  return SERVICE_TO_COUNCIL[serviceType] ?? null
}

// ─── Zod ─────────────────────────────────────────────────────────────────

const CreateContractInputSchema = z.object({
  personId: z.string().uuid(),
  companyId: z.string().uuid(),
  userId: z.string().uuid().optional().nullable(),
  serviceType: z.string().min(2).max(60),
  kind: z.enum([
    'percent_faturamento',
    'percent_recebido',
    'fixo_por_atendimento',
    'tabela_por_servico',
  ]),
  base: z
    .enum(['faturado', 'recebido_particular', 'recebido_convenio', 'misto'])
    .default('recebido_particular'),
  defaultPercent: z.number().min(0).max(100).optional().nullable(),
  defaultAmountCents: z.number().int().min(0).optional().nullable(),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  effectiveTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
})

const CreateRuleInputSchema = z.object({
  contractId: z.string().uuid(),
  serviceType: z.string().min(2).max(60).optional().nullable(),
  tussCode: z.string().min(2).max(30).optional().nullable(),
  percent: z.number().min(0).max(100).optional().nullable(),
  amountCents: z.number().int().min(0).optional().nullable(),
  priority: z.number().int().min(1).max(1000).default(100),
})

const CalculateInputSchema = z.object({
  contractId: z.string().uuid(),
  event: z.object({
    kind: z.enum([
      'invoice_issued',
      'payment_received',
      'guide_paid',
      'appointment_completed',
      'consulta_signed',
      'evolucao_created',
    ]),
    amountCents: z.number().int().min(0),
    ref: z.string().min(2).max(200),
    serviceType: z.string().max(60).optional().nullable(),
    tussCode: z.string().max(30).optional().nullable(),
    occurredAt: z.string(),
    paymentSource: z.enum(['particular', 'convenio']).optional().nullable(),
  }),
})

const ClosePeriodInputSchema = z.object({
  personId: z.string().uuid(),
  companyId: z.string().uuid(),
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
})

const ApprovePeriodInputSchema = z.object({
  periodId: z.string().uuid(),
})

const MarkPaidInputSchema = z.object({
  periodId: z.string().uuid(),
  asaasTransferId: z.string().max(80).optional().nullable(),
})

// ─── createProfessionalContract ─────────────────────────────────────────

export const createProfessionalContract = wrapServerAction(
  { module: 'rh', action: 'contract.create', resourceType: 'professional_contracts' },
  async (input: z.infer<typeof CreateContractInputSchema>, { session, setAuditResource }) => {
    const parsed = CreateContractInputSchema.parse(input)
    const tenantId = session.logifit.tenantId

    // 1. Person existe no tenant
    const [person] = await db
      .select({ id: persons.id, name: persons.name })
      .from(persons)
      .where(and(eq(persons.id, parsed.personId), eq(persons.tenantId, tenantId)))
      .limit(1)
    if (!person)
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Pessoa não encontrada',
        request_id: '',
      })

    // 2. Gate ADR 0055 — registro profissional ativo
    const requiredCouncil = councilForService(parsed.serviceType)
    if (requiredCouncil) {
      const regs = await db
        .select({
          councilBody: professionalRegistrations.councilBody,
          situation: professionalRegistrations.situation,
        })
        .from(professionalRegistrations)
        .where(
          and(
            eq(professionalRegistrations.tenantId, tenantId),
            eq(professionalRegistrations.personId, parsed.personId),
          ),
        )
      const ok = regs.some(
        (r) => r.councilBody === requiredCouncil && r.situation === 'active',
      )
      if (!ok) {
        throw new ApiException({
          code: 'FORBIDDEN',
          message: `Profissional sem registro ativo no conselho ${requiredCouncil} (exigido para service_type=${parsed.serviceType}). Cadastre em /app/pessoas/${parsed.personId}/registros (ADR 0055).`,
          request_id: '',
        })
      }
    }

    // 3. Insere contract version 1 (futuras versões via update)
    try {
      const [row] = await db
        .insert(professionalContracts)
        .values({
          tenantId,
          companyId: parsed.companyId,
          personId: parsed.personId,
          userId: parsed.userId ?? null,
          serviceType: parsed.serviceType,
          kind: parsed.kind,
          base: parsed.base,
          defaultPercent: parsed.defaultPercent != null ? parsed.defaultPercent.toFixed(2) : null,
          defaultAmountCents: parsed.defaultAmountCents ?? null,
          version: 1,
          effectiveFrom: parsed.effectiveFrom,
          effectiveTo: parsed.effectiveTo ?? null,
          active: true,
          createdByUserId: session.user.id,
        })
        .returning({ id: professionalContracts.id })
      setAuditResource(row!.id, {
        personId: parsed.personId,
        kind: parsed.kind,
        serviceType: parsed.serviceType,
      })
      return { id: row!.id }
    } catch (err) {
      const e = err as { code?: string; cause?: { code?: string } }
      const code = e.code ?? e.cause?.code ?? ''
      if (code === '23514') {
        throw new ApiException({
          code: 'VALIDATION_ERROR',
          message: 'Contrato inválido: percent precisa estar definido para kinds percent_*, ou amount_cents para fixo_por_atendimento',
          request_id: '',
        })
      }
      if (code === '23505') {
        throw new ApiException({
          code: 'VALIDATION_ERROR',
          message: 'Já existe contrato com mesma version para essa pessoa+company+service_type',
          request_id: '',
        })
      }
      throw err
    }
  },
)

export const listProfessionalContracts = wrapServerAction(
  { module: 'rh', action: 'contract.list' },
  async (input: { personId?: string } | undefined, { session }) => {
    const parsed = z.object({ personId: z.string().uuid().optional() }).parse(input ?? {})
    const tenantId = session.logifit.tenantId
    const where = [eq(professionalContracts.tenantId, tenantId)]
    if (parsed.personId) where.push(eq(professionalContracts.personId, parsed.personId))
    const rows = await db
      .select({
        id: professionalContracts.id,
        personId: professionalContracts.personId,
        personName: persons.name,
        companyId: professionalContracts.companyId,
        serviceType: professionalContracts.serviceType,
        kind: professionalContracts.kind,
        base: professionalContracts.base,
        defaultPercent: professionalContracts.defaultPercent,
        defaultAmountCents: professionalContracts.defaultAmountCents,
        version: professionalContracts.version,
        effectiveFrom: professionalContracts.effectiveFrom,
        effectiveTo: professionalContracts.effectiveTo,
        active: professionalContracts.active,
      })
      .from(professionalContracts)
      .leftJoin(persons, eq(persons.id, professionalContracts.personId))
      .where(and(...where))
      .orderBy(desc(professionalContracts.createdAt))
      .limit(200)
    return { contracts: rows }
  },
)

// ─── createCommissionRule ────────────────────────────────────────────

export const createCommissionRule = wrapServerAction(
  { module: 'rh', action: 'rule.create', resourceType: 'commission_rules' },
  async (input: z.infer<typeof CreateRuleInputSchema>, { session, setAuditResource }) => {
    const parsed = CreateRuleInputSchema.parse(input)
    const tenantId = session.logifit.tenantId
    // Valida contract pertence ao tenant
    const [c] = await db
      .select({ id: professionalContracts.id })
      .from(professionalContracts)
      .where(
        and(
          eq(professionalContracts.id, parsed.contractId),
          eq(professionalContracts.tenantId, tenantId),
        ),
      )
      .limit(1)
    if (!c)
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Contrato não encontrado',
        request_id: '',
      })

    try {
      const [row] = await db
        .insert(commissionRules)
        .values({
          contractId: parsed.contractId,
          serviceType: parsed.serviceType ?? null,
          tussCode: parsed.tussCode ?? null,
          percent: parsed.percent != null ? parsed.percent.toFixed(2) : null,
          amountCents: parsed.amountCents ?? null,
          priority: parsed.priority,
          active: true,
        })
        .returning({ id: commissionRules.id })
      setAuditResource(row!.id, {})
      return { id: row!.id }
    } catch (err) {
      const e = err as { code?: string; cause?: { code?: string } }
      const code = e.code ?? e.cause?.code ?? ''
      if (code === '23514') {
        throw new ApiException({
          code: 'VALIDATION_ERROR',
          message: 'Rule precisa de serviceType ou tussCode + valor (percent ou amount_cents)',
          request_id: '',
        })
      }
      throw err
    }
  },
)

// ─── calculateCommissionForEvent ─────────────────────────────────────

export const calculateCommissionForEvent = wrapServerAction(
  { module: 'rh', action: 'commission.calculate', resourceType: 'commission_entries' },
  async (input: z.infer<typeof CalculateInputSchema>, { session, setAuditResource }) => {
    const parsed = CalculateInputSchema.parse(input)
    const tenantId = session.logifit.tenantId

    const [c] = await db
      .select()
      .from(professionalContracts)
      .where(
        and(
          eq(professionalContracts.id, parsed.contractId),
          eq(professionalContracts.tenantId, tenantId),
        ),
      )
      .limit(1)
    if (!c)
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Contrato não encontrado',
        request_id: '',
      })

    const rules = await db
      .select()
      .from(commissionRules)
      .where(and(eq(commissionRules.contractId, parsed.contractId), eq(commissionRules.active, true)))

    const contract: CommissionContract = {
      id: c.id,
      personId: c.personId,
      userId: c.userId,
      companyId: c.companyId,
      serviceType: c.serviceType,
      kind: c.kind as CommissionContract['kind'],
      base: c.base as CommissionContract['base'],
      defaultPercent: c.defaultPercent != null ? Number(c.defaultPercent) : null,
      defaultAmountCents: c.defaultAmountCents,
      active: c.active,
      effectiveFrom: c.effectiveFrom,
      effectiveTo: c.effectiveTo,
    }
    const rulesParsed: CommissionRuleRow[] = rules.map((r) => ({
      id: r.id,
      contractId: r.contractId,
      serviceType: r.serviceType,
      tussCode: r.tussCode,
      percent: r.percent != null ? Number(r.percent) : null,
      amountCents: r.amountCents,
      priority: r.priority,
      active: r.active,
    }))

    const event: CommissionEvent = {
      kind: parsed.event.kind,
      amountCents: parsed.event.amountCents,
      ref: parsed.event.ref,
      serviceType: parsed.event.serviceType ?? null,
      tussCode: parsed.event.tussCode ?? null,
      occurredAt: parsed.event.occurredAt,
      paymentSource: parsed.event.paymentSource ?? null,
    }

    const result = calculateCommission({ event, contract, rules: rulesParsed })
    if (!result.entry) {
      return { skipped: true, skipReason: result.skipReason ?? 'unknown' }
    }

    try {
      const [row] = await db
        .insert(commissionEntries)
        .values({
          tenantId,
          contractId: contract.id,
          personId: result.entry.personId,
          userId: result.entry.userId,
          companyId: result.entry.companyId,
          sourceEventRef: result.entry.sourceEventRef,
          referenceAmountCents: result.entry.referenceAmountCents,
          commissionCents: result.entry.commissionCents,
          percentApplied:
            result.entry.percentApplied != null ? result.entry.percentApplied.toFixed(2) : null,
          serviceType: result.entry.serviceType,
          tussCode: result.entry.tussCode,
          taxNatureId: result.entry.taxNatureId,
          retentionTotalCents: result.entry.retentionTotalCents,
          netAmountCents: result.entry.netAmountCents,
          status: 'pending',
          earnedAt: new Date(result.entry.earnedAt),
        })
        .returning({ id: commissionEntries.id })
      setAuditResource(row!.id, { commissionCents: result.entry.commissionCents })
      return { id: row!.id, commissionCents: result.entry.commissionCents }
    } catch (err) {
      const e = err as { code?: string; cause?: { code?: string } }
      const code = e.code ?? e.cause?.code ?? ''
      if (code === '23505') {
        return { skipped: true, skipReason: 'Source event ref já calculado (idempotente)' }
      }
      throw err
    }
  },
)

// ─── listCommissionEntries ──────────────────────────────────────────

export const listCommissionEntries = wrapServerAction(
  { module: 'rh', action: 'commission.list_entries' },
  async (
    input: { personId?: string; status?: string; limit?: number } | undefined,
    { session },
  ) => {
    const parsed = z
      .object({
        personId: z.string().uuid().optional(),
        status: z
          .enum(['pending', 'included', 'excluded', 'reversed', 'all'])
          .default('all'),
        limit: z.number().int().min(1).max(500).default(200),
      })
      .parse(input ?? {})
    const tenantId = session.logifit.tenantId
    const where = [eq(commissionEntries.tenantId, tenantId)]
    if (parsed.personId) where.push(eq(commissionEntries.personId, parsed.personId))
    if (parsed.status !== 'all')
      where.push(eq(commissionEntries.status, parsed.status))
    const rows = await db
      .select({
        id: commissionEntries.id,
        contractId: commissionEntries.contractId,
        personId: commissionEntries.personId,
        personName: persons.name,
        sourceEventRef: commissionEntries.sourceEventRef,
        referenceAmountCents: commissionEntries.referenceAmountCents,
        commissionCents: commissionEntries.commissionCents,
        retentionTotalCents: commissionEntries.retentionTotalCents,
        netAmountCents: commissionEntries.netAmountCents,
        percentApplied: commissionEntries.percentApplied,
        serviceType: commissionEntries.serviceType,
        status: commissionEntries.status,
        earnedAt: commissionEntries.earnedAt,
        periodId: commissionEntries.periodId,
      })
      .from(commissionEntries)
      .leftJoin(persons, eq(persons.id, commissionEntries.personId))
      .where(and(...where))
      .orderBy(desc(commissionEntries.earnedAt))
      .limit(parsed.limit)
    return { entries: rows }
  },
)

// ─── closePeriod ────────────────────────────────────────────────────

export const closePeriod = wrapServerAction(
  { module: 'rh', action: 'period.close', resourceType: 'commission_periods' },
  async (input: z.infer<typeof ClosePeriodInputSchema>, { session, setAuditResource }) => {
    const parsed = ClosePeriodInputSchema.parse(input)
    const tenantId = session.logifit.tenantId

    // Carrega entries pendentes do person/company dentro do range
    const entries = await db
      .select({
        id: commissionEntries.id,
        commissionCents: commissionEntries.commissionCents,
        retentionTotalCents: commissionEntries.retentionTotalCents,
        netAmountCents: commissionEntries.netAmountCents,
        status: commissionEntries.status,
      })
      .from(commissionEntries)
      .where(
        and(
          eq(commissionEntries.tenantId, tenantId),
          eq(commissionEntries.personId, parsed.personId),
          eq(commissionEntries.companyId, parsed.companyId),
          eq(commissionEntries.status, 'pending'),
          sql`${commissionEntries.earnedAt} >= ${parsed.periodStart + 'T00:00:00Z'}::timestamptz`,
          sql`${commissionEntries.earnedAt} <= ${parsed.periodEnd + 'T23:59:59Z'}::timestamptz`,
        ),
      )

    if (entries.length === 0)
      throw new ApiException({
        code: 'VALIDATION_ERROR',
        message: 'Nenhuma entry pendente no período',
        request_id: '',
      })

    const summary = aggregateEntries(entries)

    try {
      const [period] = await db
        .insert(commissionPeriods)
        .values({
          tenantId,
          personId: parsed.personId,
          companyId: parsed.companyId,
          periodStart: parsed.periodStart,
          periodEnd: parsed.periodEnd,
          totalEntries: summary.totalEntries,
          grossTotalCents: summary.grossTotalCents,
          deductionsCents: summary.deductionsCents,
          retentionTotalCents: summary.retentionTotalCents,
          netTotalCents: summary.netTotalCents,
          status: 'draft',
        })
        .returning({ id: commissionPeriods.id })

      // Marca entries como included + linka periodId
      await db
        .update(commissionEntries)
        .set({ status: 'included', periodId: period!.id })
        .where(sql`${commissionEntries.id} = ANY(${entries.map((e) => e.id)})`)

      setAuditResource(period!.id, {
        totalEntries: summary.totalEntries,
        netTotalCents: summary.netTotalCents,
      })
      return { id: period!.id, summary }
    } catch (err) {
      const e = err as { code?: string; cause?: { code?: string } }
      const code = e.code ?? e.cause?.code ?? ''
      if (code === '23505') {
        throw new ApiException({
          code: 'VALIDATION_ERROR',
          message: 'Já existe period fechado para essa pessoa+company+intervalo',
          request_id: '',
        })
      }
      throw err
    }
  },
)

// ─── approvePeriod ──────────────────────────────────────────────────

export const approvePeriod = wrapServerAction(
  { module: 'rh', action: 'period.approve', resourceType: 'commission_periods' },
  async (input: z.infer<typeof ApprovePeriodInputSchema>, { session, setAuditResource }) => {
    const parsed = ApprovePeriodInputSchema.parse(input)
    const tenantId = session.logifit.tenantId
    const [row] = await db
      .update(commissionPeriods)
      .set({
        status: 'approved',
        approvedByUserId: session.user.id,
        approvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(commissionPeriods.id, parsed.periodId),
          eq(commissionPeriods.tenantId, tenantId),
          eq(commissionPeriods.status, 'draft'),
        ),
      )
      .returning({ id: commissionPeriods.id })
    if (!row)
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Period não encontrado ou já não está em draft',
        request_id: '',
      })
    setAuditResource(row.id, { approved: true })
    return { ok: true }
  },
)

// ─── markPeriodPaid ─────────────────────────────────────────────────

export const markPeriodPaid = wrapServerAction(
  { module: 'rh', action: 'period.mark_paid', resourceType: 'commission_periods' },
  async (input: z.infer<typeof MarkPaidInputSchema>, { session, setAuditResource }) => {
    const parsed = MarkPaidInputSchema.parse(input)
    const tenantId = session.logifit.tenantId
    const [row] = await db
      .update(commissionPeriods)
      .set({
        status: 'paid',
        paidAt: new Date(),
        asaasTransferId: parsed.asaasTransferId ?? null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(commissionPeriods.id, parsed.periodId),
          eq(commissionPeriods.tenantId, tenantId),
          eq(commissionPeriods.status, 'approved'),
        ),
      )
      .returning({ id: commissionPeriods.id })
    if (!row)
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Period não encontrado ou não está approved',
        request_id: '',
      })
    setAuditResource(row.id, { paid: true })
    return { ok: true }
  },
)

// ─── listCommissionPeriods ──────────────────────────────────────────

export const listCommissionPeriods = wrapServerAction(
  { module: 'rh', action: 'period.list' },
  async (input: { status?: string; limit?: number } | undefined, { session }) => {
    const parsed = z
      .object({
        status: z
          .enum(['draft', 'approved', 'paid', 'cancelled', 'all'])
          .default('all'),
        limit: z.number().int().min(1).max(200).default(100),
      })
      .parse(input ?? {})
    const tenantId = session.logifit.tenantId
    const where = [eq(commissionPeriods.tenantId, tenantId)]
    if (parsed.status !== 'all')
      where.push(eq(commissionPeriods.status, parsed.status))
    const rows = await db
      .select({
        id: commissionPeriods.id,
        personId: commissionPeriods.personId,
        personName: persons.name,
        companyId: commissionPeriods.companyId,
        periodStart: commissionPeriods.periodStart,
        periodEnd: commissionPeriods.periodEnd,
        totalEntries: commissionPeriods.totalEntries,
        grossTotalCents: commissionPeriods.grossTotalCents,
        retentionTotalCents: commissionPeriods.retentionTotalCents,
        netTotalCents: commissionPeriods.netTotalCents,
        status: commissionPeriods.status,
        approvedAt: commissionPeriods.approvedAt,
        paidAt: commissionPeriods.paidAt,
      })
      .from(commissionPeriods)
      .leftJoin(persons, eq(persons.id, commissionPeriods.personId))
      .where(and(...where))
      .orderBy(desc(commissionPeriods.periodStart))
      .limit(parsed.limit)
    return { periods: rows }
  },
)

// ─── generateExtractStub ────────────────────────────────────────────

export const generateExtractStub = wrapServerAction(
  { module: 'rh', action: 'period.extract' },
  async (_input: { periodId: string }, { session: _session }) => {
    throw new ApiException({
      code: 'INTERNAL_ERROR',
      message:
        'Extrato PDF chega no Sprint 23b com @react-pdf/renderer + decomposição de retenções + GPS/DARF sugeridos.',
      request_id: '',
    })
  },
)

void isNull
void asc
