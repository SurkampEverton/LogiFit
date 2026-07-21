'use server'

/**
 * Server Actions de Contas a Receber (AR avulso) — Sprint 15 Faixa B.
 *
 * AR avulso = recebimento não vinculado a contrato (aluguel recebido, venda
 * esporádica, reembolso). Para mensalidade de contrato, ver Sprint 04 invoices.
 *
 * Funções MVP:
 *   - createAR — cria em status='draft'
 *   - markARIssued — transição draft → issued (placeholder; gerar boleto Asaas
 *     em Sprint 04 wrapper fica adiado pra integração mais profunda)
 *   - registerARReceived — registra recebimento (vira 'received')
 *   - cancelAR — só funciona em draft/issued
 *   - listAR
 *   - getAR
 *
 * Pagamento via Asaas (boleto/PIX automático) reusa wrapper Sprint 04 — adiado
 * pra Sprint 15+ próximo PR.
 */

import { db } from '@repo/db/client'
import { accountsReceivable, apArPayments, chartOfAccounts, persons } from '@repo/db/schema'
import { ApiException } from '@repo/errors'
import { and, asc, desc, eq, gte, lte, sql } from 'drizzle-orm'
import { z } from 'zod'
import { wrapServerAction } from '../../../lib/wrap-action'

// ─── Zod ─────────────────────────────────────────────────────────────────

const CreateARInputSchema = z.object({
  companyId: z.string().uuid(),
  payerPersonId: z.string().uuid().optional().nullable(),
  chartAccountId: z.string().uuid(),
  amountCents: z.number().int().positive(),
  issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  description: z.string().max(2000).optional(),
  docNumber: z.string().max(60).optional(),
})

const ArIdInput = z.object({ arId: z.string().uuid() })

const RegisterReceivedInputSchema = z.object({
  arId: z.string().uuid(),
  amountCents: z.number().int().positive(),
  paidAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  method: z.enum(['pix', 'ted', 'doc', 'boleto', 'cash', 'credit_card', 'manual_other']),
  reference: z.string().max(120).optional(),
  notes: z.string().max(2000).optional(),
})

const ListARInputSchema = z.object({
  companyId: z.string().uuid().optional(),
  status: z.enum(['draft', 'issued', 'received', 'overdue', 'cancelled', 'refunded']).optional(),
  dueFrom: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  dueTo: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  limit: z.number().int().min(1).max(500).default(100),
})

// ─── createAR ────────────────────────────────────────────────────────────

export const createAR = wrapServerAction(
  { module: 'financeiro', action: 'ar.create', resourceType: 'accounts_receivable' },
  async (input: z.infer<typeof CreateARInputSchema>, { session, setAuditResource }) => {
    const parsed = CreateARInputSchema.parse(input)
    if (parsed.dueDate < parsed.issueDate) {
      throw new ApiException({
        code: 'VALIDATION_ERROR',
        message: 'Vencimento não pode ser anterior à emissão',
        request_id: '',
      })
    }
    const [chart] = await db
      .select({
        id: chartOfAccounts.id,
        isLeaf: chartOfAccounts.isLeaf,
        active: chartOfAccounts.active,
      })
      .from(chartOfAccounts)
      .where(
        and(
          eq(chartOfAccounts.id, parsed.chartAccountId),
          eq(chartOfAccounts.tenantId, session.logifit.tenantId),
        ),
      )
      .limit(1)
    if (!chart || !chart.isLeaf || !chart.active) {
      throw new ApiException({
        code: 'VALIDATION_ERROR',
        message: 'Conta contábil inválida',
        request_id: '',
      })
    }
    const [row] = await db
      .insert(accountsReceivable)
      .values({
        tenantId: session.logifit.tenantId,
        companyId: parsed.companyId,
        payerPersonId: parsed.payerPersonId ?? null,
        chartAccountId: parsed.chartAccountId,
        amountCents: parsed.amountCents,
        issueDate: parsed.issueDate,
        dueDate: parsed.dueDate,
        description: parsed.description ?? null,
        docNumber: parsed.docNumber ?? null,
        status: 'draft',
        createdByUserId: session.logifit.userId,
      })
      .returning({ id: accountsReceivable.id })
    if (!row)
      throw new ApiException({
        code: 'INTERNAL_ERROR',
        message: 'Falha ao criar AR',
        request_id: '',
      })
    setAuditResource(row.id, { amountCents: parsed.amountCents })
    return { id: row.id }
  },
)

// ─── markARIssued ────────────────────────────────────────────────────────

export const markARIssued = wrapServerAction(
  { module: 'financeiro', action: 'ar.issue', resourceType: 'accounts_receivable' },
  async (input: z.infer<typeof ArIdInput>, { session, setAuditResource }) => {
    const parsed = ArIdInput.parse(input)
    const [ar] = await db
      .select({ id: accountsReceivable.id, status: accountsReceivable.status })
      .from(accountsReceivable)
      .where(
        and(
          eq(accountsReceivable.id, parsed.arId),
          eq(accountsReceivable.tenantId, session.logifit.tenantId),
        ),
      )
      .limit(1)
    if (!ar)
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'AR não encontrada',
        request_id: '',
      })
    if (ar.status !== 'draft') {
      throw new ApiException({
        code: 'VALIDATION_ERROR',
        message: `AR no estado '${ar.status}' não comporta emissão`,
        request_id: '',
      })
    }
    await db
      .update(accountsReceivable)
      .set({ status: 'issued', updatedAt: new Date() })
      .where(eq(accountsReceivable.id, parsed.arId))
    setAuditResource(parsed.arId, {})
    return { id: parsed.arId, status: 'issued' as const }
  },
)

// ─── registerARReceived ──────────────────────────────────────────────────

export const registerARReceived = wrapServerAction(
  { module: 'financeiro', action: 'ar.received', resourceType: 'accounts_receivable' },
  async (input: z.infer<typeof RegisterReceivedInputSchema>, { session, setAuditResource }) => {
    const parsed = RegisterReceivedInputSchema.parse(input)
    const [ar] = await db
      .select({
        id: accountsReceivable.id,
        status: accountsReceivable.status,
        amountCents: accountsReceivable.amountCents,
      })
      .from(accountsReceivable)
      .where(
        and(
          eq(accountsReceivable.id, parsed.arId),
          eq(accountsReceivable.tenantId, session.logifit.tenantId),
        ),
      )
      .limit(1)
    if (!ar)
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'AR não encontrada',
        request_id: '',
      })
    if (!['draft', 'issued', 'overdue'].includes(ar.status)) {
      throw new ApiException({
        code: 'VALIDATION_ERROR',
        message: `AR no estado '${ar.status}' não comporta recebimento`,
        request_id: '',
      })
    }
    await db.insert(apArPayments).values({
      tenantId: session.logifit.tenantId,
      sourceType: 'ar',
      sourceId: parsed.arId,
      amountCents: parsed.amountCents,
      paidAt: new Date(parsed.paidAt + 'T12:00:00Z'),
      method: parsed.method,
      reference: parsed.reference ?? null,
      notes: parsed.notes ?? null,
      recordedByUserId: session.logifit.userId,
    })
    const [agg] = await db
      .select({
        total: sql<number>`COALESCE(SUM(${apArPayments.amountCents}), 0)::bigint`,
      })
      .from(apArPayments)
      .where(
        and(
          eq(apArPayments.sourceType, 'ar'),
          eq(apArPayments.sourceId, parsed.arId),
          eq(apArPayments.tenantId, session.logifit.tenantId),
        ),
      )
    const receivedTotal = Number(agg?.total ?? 0)
    const fullyReceived = receivedTotal >= ar.amountCents

    await db
      .update(accountsReceivable)
      .set({
        status: fullyReceived ? 'received' : 'issued',
        receivedAt: fullyReceived ? new Date() : null,
        receivedAmountCents: receivedTotal,
        updatedAt: new Date(),
      })
      .where(eq(accountsReceivable.id, parsed.arId))
    setAuditResource(parsed.arId, { receivedTotal, fullyReceived })
    return { id: parsed.arId, fullyReceived, receivedTotal }
  },
)

// ─── cancelAR ────────────────────────────────────────────────────────────

export const cancelAR = wrapServerAction(
  { module: 'financeiro', action: 'ar.cancel', resourceType: 'accounts_receivable' },
  async (input: z.infer<typeof ArIdInput>, { session, setAuditResource }) => {
    const parsed = ArIdInput.parse(input)
    const [ar] = await db
      .select({ id: accountsReceivable.id, status: accountsReceivable.status })
      .from(accountsReceivable)
      .where(
        and(
          eq(accountsReceivable.id, parsed.arId),
          eq(accountsReceivable.tenantId, session.logifit.tenantId),
        ),
      )
      .limit(1)
    if (!ar)
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'AR não encontrada',
        request_id: '',
      })
    if (!['draft', 'issued', 'overdue'].includes(ar.status)) {
      throw new ApiException({
        code: 'VALIDATION_ERROR',
        message: `AR no estado '${ar.status}' não pode ser cancelada`,
        request_id: '',
      })
    }
    await db
      .update(accountsReceivable)
      .set({ status: 'cancelled', updatedAt: new Date() })
      .where(eq(accountsReceivable.id, parsed.arId))
    setAuditResource(parsed.arId, {})
    return { id: parsed.arId, status: 'cancelled' as const }
  },
)

// ─── listAR ──────────────────────────────────────────────────────────────

export const listAR = wrapServerAction(
  { module: 'financeiro', action: 'ar.list' },
  async (input: z.infer<typeof ListARInputSchema> | undefined, { session }) => {
    const parsed = ListARInputSchema.parse(input ?? {})
    const where = [eq(accountsReceivable.tenantId, session.logifit.tenantId)]
    if (parsed.companyId) where.push(eq(accountsReceivable.companyId, parsed.companyId))
    if (parsed.status) where.push(eq(accountsReceivable.status, parsed.status))
    if (parsed.dueFrom) where.push(gte(accountsReceivable.dueDate, parsed.dueFrom))
    if (parsed.dueTo) where.push(lte(accountsReceivable.dueDate, parsed.dueTo))

    const rows = await db
      .select({
        id: accountsReceivable.id,
        companyId: accountsReceivable.companyId,
        payerPersonId: accountsReceivable.payerPersonId,
        chartAccountId: accountsReceivable.chartAccountId,
        amountCents: accountsReceivable.amountCents,
        receivedAmountCents: accountsReceivable.receivedAmountCents,
        issueDate: accountsReceivable.issueDate,
        dueDate: accountsReceivable.dueDate,
        description: accountsReceivable.description,
        docNumber: accountsReceivable.docNumber,
        status: accountsReceivable.status,
        receivedAt: accountsReceivable.receivedAt,
        payerName: persons.name,
        chartCode: chartOfAccounts.code,
        chartName: chartOfAccounts.name,
      })
      .from(accountsReceivable)
      .leftJoin(persons, eq(persons.id, accountsReceivable.payerPersonId))
      .leftJoin(chartOfAccounts, eq(chartOfAccounts.id, accountsReceivable.chartAccountId))
      .where(and(...where))
      .orderBy(asc(accountsReceivable.dueDate))
      .limit(parsed.limit)
    return { ars: rows }
  },
)

// ─── getAR ───────────────────────────────────────────────────────────────

export const getAR = wrapServerAction(
  { module: 'financeiro', action: 'ar.get', resourceType: 'accounts_receivable' },
  async (input: z.infer<typeof ArIdInput>, { session, setAuditResource }) => {
    const parsed = ArIdInput.parse(input)
    const [row] = await db
      .select({
        id: accountsReceivable.id,
        companyId: accountsReceivable.companyId,
        payerPersonId: accountsReceivable.payerPersonId,
        chartAccountId: accountsReceivable.chartAccountId,
        amountCents: accountsReceivable.amountCents,
        receivedAmountCents: accountsReceivable.receivedAmountCents,
        issueDate: accountsReceivable.issueDate,
        dueDate: accountsReceivable.dueDate,
        description: accountsReceivable.description,
        docNumber: accountsReceivable.docNumber,
        status: accountsReceivable.status,
        receivedAt: accountsReceivable.receivedAt,
        invoiceId: accountsReceivable.invoiceId,
        asaasChargeId: accountsReceivable.asaasChargeId,
        externalUrl: accountsReceivable.externalUrl,
        createdAt: accountsReceivable.createdAt,
        payerName: persons.name,
        payerDocument: persons.document,
        chartCode: chartOfAccounts.code,
        chartName: chartOfAccounts.name,
      })
      .from(accountsReceivable)
      .leftJoin(persons, eq(persons.id, accountsReceivable.payerPersonId))
      .leftJoin(chartOfAccounts, eq(chartOfAccounts.id, accountsReceivable.chartAccountId))
      .where(
        and(
          eq(accountsReceivable.id, parsed.arId),
          eq(accountsReceivable.tenantId, session.logifit.tenantId),
        ),
      )
      .limit(1)
    if (!row)
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'AR não encontrada',
        request_id: '',
      })
    const receipts = await db
      .select({
        id: apArPayments.id,
        amountCents: apArPayments.amountCents,
        paidAt: apArPayments.paidAt,
        method: apArPayments.method,
        reference: apArPayments.reference,
        notes: apArPayments.notes,
      })
      .from(apArPayments)
      .where(
        and(
          eq(apArPayments.sourceType, 'ar'),
          eq(apArPayments.sourceId, parsed.arId),
          eq(apArPayments.tenantId, session.logifit.tenantId),
        ),
      )
      .orderBy(desc(apArPayments.paidAt))
    setAuditResource(parsed.arId, {})
    return { ar: row, receipts }
  },
)
