'use server'

/**
 * Server Actions de Contas a Pagar (AP) — Sprint 15 Faixa B (ADR 0034).
 *
 * Funções core MVP:
 *   - createAP — cria em status='draft'
 *   - submitForApproval — passa pra 'pending_approval' e executa decideNextState;
 *     auto-aprovação direta quando rule sem approvers ou sem rule matching
 *   - approveAP — uma aprovação no trace; se workflow completou, vira 'approved'
 *   - rejectAP — registra rejeição no trace e vira 'rejected'
 *   - cancelAP — só funciona em draft/pending_approval (estados anteriores ao approved)
 *   - registerManualPayment — registra pagamento externo (vira 'paid' se quitado integralmente)
 *   - listAP — lista filtrável (status, supplier, due range, company)
 *   - getAP — detalhe com pagamentos
 *
 * **Pagamento via Asaas** + **pagamento em lote** ficam Sprint 15+ (depende Open Finance Sprint 17).
 *
 * Regras consumidas:
 *   - regra 7 (Zod boundary)
 *   - regra 5 (audit_log via wrap em todas mutações)
 *   - regra 33 (envelope ADR 0071)
 */

import { db } from '@repo/db/client'
import {
  accountsPayable,
  apArPayments,
  approvalRules,
  chartOfAccounts,
  persons,
  suppliers,
} from '@repo/db/schema'
import {
  type ApprovalRuleRow,
  type ApprovalTraceEntry,
  canUserApprove as engineCanApprove,
  decideNextState,
  RequiredApproversSchema,
} from '@repo/db/erp-financeiro'
import { ApiException } from '@repo/errors'
import { and, asc, desc, eq, gte, lte, sql } from 'drizzle-orm'
import { z } from 'zod'
import { wrapServerAction } from '../../../lib/wrap-action'

// ─── Zod ─────────────────────────────────────────────────────────────────

const CreateAPInputSchema = z.object({
  companyId: z.string().uuid(),
  unitId: z.string().uuid().optional().nullable(),
  supplierId: z.string().uuid().optional().nullable(),
  chartAccountId: z.string().uuid(),
  amountCents: z.number().int().positive(),
  issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  description: z.string().max(2000).optional(),
  docNumber: z.string().max(60).optional(),
  docKey: z.string().length(44).optional(), // chave NF-e 44 dígitos
  noInvoice: z.boolean().default(false),
  attachmentStoragePath: z.string().max(500).optional(),
})

const ApIdInput = z.object({ apId: z.string().uuid() })

const ApproveAPInputSchema = z.object({
  apId: z.string().uuid(),
  comment: z.string().max(2000).optional(),
})

const RejectAPInputSchema = z.object({
  apId: z.string().uuid(),
  reason: z.string().min(5).max(2000),
})

const RegisterManualPaymentInputSchema = z.object({
  apId: z.string().uuid(),
  amountCents: z.number().int().positive(),
  paidAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  method: z.enum(['pix', 'ted', 'doc', 'boleto', 'cash', 'credit_card', 'manual_other']),
  reference: z.string().max(120).optional(),
  notes: z.string().max(2000).optional(),
})

const ListAPInputSchema = z.object({
  companyId: z.string().uuid().optional(),
  supplierId: z.string().uuid().optional(),
  status: z
    .enum([
      'draft',
      'pending_approval',
      'approved',
      'rejected',
      'scheduled',
      'paid',
      'cancelled',
      'reconciled',
    ])
    .optional(),
  dueFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dueTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  limit: z.number().int().min(1).max(500).default(100),
})

// ─── Helpers internos ────────────────────────────────────────────────────

async function loadActiveApRulesForTenant(
  tenantId: string,
  scope: 'ap' | 'ar' = 'ap',
): Promise<ApprovalRuleRow[]> {
  const rows = await db
    .select({
      id: approvalRules.id,
      minAmountCents: approvalRules.minAmountCents,
      maxAmountCents: approvalRules.maxAmountCents,
      requiredApprovers: approvalRules.requiredApprovers,
      companyId: approvalRules.companyId,
      active: approvalRules.active,
      scope: approvalRules.scope,
    })
    .from(approvalRules)
    .where(and(eq(approvalRules.tenantId, tenantId), eq(approvalRules.active, true)))
  return rows
    .filter((r) => r.scope === scope || r.scope === 'both')
    .map((r) => ({
      id: r.id,
      minAmountCents: r.minAmountCents,
      maxAmountCents: r.maxAmountCents,
      companyId: r.companyId,
      active: r.active,
      requiredApprovers: RequiredApproversSchema.parse(r.requiredApprovers),
    }))
}

// ─── createAP ────────────────────────────────────────────────────────────

export const createAP = wrapServerAction(
  { module: 'financeiro', action: 'ap.create', resourceType: 'accounts_payable' },
  async (
    input: z.infer<typeof CreateAPInputSchema>,
    { session, setAuditResource },
  ) => {
    const parsed = CreateAPInputSchema.parse(input)
    if (parsed.dueDate < parsed.issueDate) {
      throw new ApiException({
        code: 'VALIDATION_ERROR',
        message: 'Vencimento não pode ser anterior à emissão',
        request_id: '',
      })
    }
    // Valida chartAccount existe + é folha + pertence ao tenant
    const [chart] = await db
      .select({ id: chartOfAccounts.id, isLeaf: chartOfAccounts.isLeaf, active: chartOfAccounts.active })
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
        message: 'Conta contábil inválida (não-folha ou inativa)',
        request_id: '',
      })
    }

    const [row] = await db
      .insert(accountsPayable)
      .values({
        tenantId: session.logifit.tenantId,
        companyId: parsed.companyId,
        unitId: parsed.unitId ?? null,
        supplierId: parsed.supplierId ?? null,
        chartAccountId: parsed.chartAccountId,
        amountCents: parsed.amountCents,
        retentionTotalCents: 0,
        netAmountCents: parsed.amountCents, // Sprint 15a sem retenção
        issueDate: parsed.issueDate,
        dueDate: parsed.dueDate,
        description: parsed.description ?? null,
        docNumber: parsed.docNumber ?? null,
        docKey: parsed.docKey ?? null,
        noInvoice: parsed.noInvoice,
        status: 'draft',
        attachmentStoragePath: parsed.attachmentStoragePath ?? null,
        source: 'manual',
        createdByUserId: session.user.id,
      })
      .returning({ id: accountsPayable.id })
    if (!row)
      throw new ApiException({
        code: 'INTERNAL_ERROR',
        message: 'Falha ao criar AP',
        request_id: '',
      })
    setAuditResource(row.id, {
      amountCents: parsed.amountCents,
      chartAccountId: parsed.chartAccountId,
    })
    return { id: row.id }
  },
)

// ─── submitForApproval ───────────────────────────────────────────────────

export const submitForApproval = wrapServerAction(
  { module: 'financeiro', action: 'ap.submit', resourceType: 'accounts_payable' },
  async (input: z.infer<typeof ApIdInput>, { session, setAuditResource }) => {
    const parsed = ApIdInput.parse(input)
    const [ap] = await db
      .select({
        id: accountsPayable.id,
        status: accountsPayable.status,
        amountCents: accountsPayable.amountCents,
        companyId: accountsPayable.companyId,
        approvalTrace: accountsPayable.approvalTrace,
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
    if (ap.status !== 'draft') {
      throw new ApiException({
        code: 'VALIDATION_ERROR',
        message: `AP no estado '${ap.status}' não pode ser submetida`,
        request_id: '',
      })
    }

    const rules = await loadActiveApRulesForTenant(session.logifit.tenantId)
    const traceArr = Array.isArray(ap.approvalTrace) ? (ap.approvalTrace as ApprovalTraceEntry[]) : []
    const submission: ApprovalTraceEntry = {
      at: new Date().toISOString(),
      byUserId: session.user.id,
      action: 'submitted',
    }
    const newTrace = [...traceArr, submission]
    const decision = decideNextState({
      amountCents: ap.amountCents,
      companyId: ap.companyId,
      rules,
      trace: newTrace,
    })

    const newStatus =
      decision.state === 'approved' ? 'approved' : decision.state === 'rejected' ? 'rejected' : 'pending_approval'

    await db
      .update(accountsPayable)
      .set({
        status: newStatus,
        approvalTrace: newTrace,
        updatedAt: new Date(),
      })
      .where(eq(accountsPayable.id, parsed.apId))
    setAuditResource(parsed.apId, { decisionState: decision.state })
    return { id: parsed.apId, status: newStatus, decision }
  },
)

// ─── approveAP ───────────────────────────────────────────────────────────

export const approveAP = wrapServerAction(
  { module: 'financeiro', action: 'ap.approve', resourceType: 'accounts_payable' },
  async (input: z.infer<typeof ApproveAPInputSchema>, { session, setAuditResource }) => {
    const parsed = ApproveAPInputSchema.parse(input)
    const [ap] = await db
      .select({
        id: accountsPayable.id,
        status: accountsPayable.status,
        amountCents: accountsPayable.amountCents,
        companyId: accountsPayable.companyId,
        approvalTrace: accountsPayable.approvalTrace,
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
    if (ap.status !== 'pending_approval') {
      throw new ApiException({
        code: 'VALIDATION_ERROR',
        message: `AP no estado '${ap.status}' não comporta aprovação`,
        request_id: '',
      })
    }

    const rules = await loadActiveApRulesForTenant(session.logifit.tenantId)
    const userRoles = session.logifit.roles ?? []
    const traceArr = Array.isArray(ap.approvalTrace) ? (ap.approvalTrace as ApprovalTraceEntry[]) : []
    const can = engineCanApprove({
      userId: session.user.id,
      userRoles,
      amountCents: ap.amountCents,
      companyId: ap.companyId,
      rules,
      trace: traceArr,
    })
    if (!can.allowed) {
      throw new ApiException({
        code: 'FORBIDDEN',
        message: can.reason ?? 'Usuário não autorizado a aprovar essa AP',
        request_id: '',
      })
    }
    const approval: ApprovalTraceEntry = {
      at: new Date().toISOString(),
      byUserId: session.user.id,
      byRole: userRoles[0],
      action: 'approved',
      comment: parsed.comment,
    }
    const newTrace = [...traceArr, approval]
    const decision = decideNextState({
      amountCents: ap.amountCents,
      companyId: ap.companyId,
      rules,
      trace: newTrace,
    })
    const newStatus =
      decision.state === 'approved' ? 'approved' : decision.state === 'rejected' ? 'rejected' : 'pending_approval'

    await db
      .update(accountsPayable)
      .set({ status: newStatus, approvalTrace: newTrace, updatedAt: new Date() })
      .where(eq(accountsPayable.id, parsed.apId))
    setAuditResource(parsed.apId, { decisionState: decision.state })
    return { id: parsed.apId, status: newStatus, decision }
  },
)

// ─── rejectAP ────────────────────────────────────────────────────────────

export const rejectAP = wrapServerAction(
  { module: 'financeiro', action: 'ap.reject', resourceType: 'accounts_payable' },
  async (input: z.infer<typeof RejectAPInputSchema>, { session, setAuditResource }) => {
    const parsed = RejectAPInputSchema.parse(input)
    const [ap] = await db
      .select({
        id: accountsPayable.id,
        status: accountsPayable.status,
        approvalTrace: accountsPayable.approvalTrace,
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
    if (ap.status !== 'pending_approval' && ap.status !== 'draft') {
      throw new ApiException({
        code: 'VALIDATION_ERROR',
        message: `AP no estado '${ap.status}' não comporta rejeição`,
        request_id: '',
      })
    }
    const traceArr = Array.isArray(ap.approvalTrace) ? (ap.approvalTrace as ApprovalTraceEntry[]) : []
    const rejection: ApprovalTraceEntry = {
      at: new Date().toISOString(),
      byUserId: session.user.id,
      byRole: session.logifit.roles?.[0],
      action: 'rejected',
      comment: parsed.reason,
    }
    await db
      .update(accountsPayable)
      .set({
        status: 'rejected',
        approvalTrace: [...traceArr, rejection],
        updatedAt: new Date(),
      })
      .where(eq(accountsPayable.id, parsed.apId))
    setAuditResource(parsed.apId, { reason: parsed.reason })
    return { id: parsed.apId, status: 'rejected' as const }
  },
)

// ─── cancelAP ────────────────────────────────────────────────────────────

export const cancelAP = wrapServerAction(
  { module: 'financeiro', action: 'ap.cancel', resourceType: 'accounts_payable' },
  async (input: z.infer<typeof ApIdInput>, { session, setAuditResource }) => {
    const parsed = ApIdInput.parse(input)
    const [ap] = await db
      .select({ id: accountsPayable.id, status: accountsPayable.status })
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
    if (!['draft', 'pending_approval', 'approved', 'scheduled'].includes(ap.status)) {
      throw new ApiException({
        code: 'VALIDATION_ERROR',
        message: `AP no estado '${ap.status}' não pode ser cancelada`,
        request_id: '',
      })
    }
    await db
      .update(accountsPayable)
      .set({ status: 'cancelled', updatedAt: new Date() })
      .where(eq(accountsPayable.id, parsed.apId))
    setAuditResource(parsed.apId, {})
    return { id: parsed.apId, status: 'cancelled' as const }
  },
)

// ─── registerManualPayment ───────────────────────────────────────────────

export const registerManualPayment = wrapServerAction(
  { module: 'financeiro', action: 'ap.pay_manual', resourceType: 'accounts_payable' },
  async (
    input: z.infer<typeof RegisterManualPaymentInputSchema>,
    { session, setAuditResource },
  ) => {
    const parsed = RegisterManualPaymentInputSchema.parse(input)
    const [ap] = await db
      .select({
        id: accountsPayable.id,
        status: accountsPayable.status,
        netAmountCents: accountsPayable.netAmountCents,
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
    if (!['approved', 'scheduled'].includes(ap.status)) {
      throw new ApiException({
        code: 'VALIDATION_ERROR',
        message: `AP no estado '${ap.status}' não comporta pagamento`,
        request_id: '',
      })
    }

    // Insere pagamento
    await db.insert(apArPayments).values({
      tenantId: session.logifit.tenantId,
      sourceType: 'ap',
      sourceId: parsed.apId,
      amountCents: parsed.amountCents,
      paidAt: new Date(parsed.paidAt + 'T12:00:00Z'),
      method: parsed.method,
      reference: parsed.reference ?? null,
      notes: parsed.notes ?? null,
      recordedByUserId: session.user.id,
    })

    // Soma todos os pagamentos da AP
    const [agg] = await db
      .select({
        total: sql<number>`COALESCE(SUM(${apArPayments.amountCents}), 0)::bigint`,
      })
      .from(apArPayments)
      .where(
        and(eq(apArPayments.sourceType, 'ap'), eq(apArPayments.sourceId, parsed.apId)),
      )
    const paidTotal = Number(agg?.total ?? 0)
    const fullyPaid = paidTotal >= ap.netAmountCents

    await db
      .update(accountsPayable)
      .set({
        status: fullyPaid ? 'paid' : 'scheduled',
        paidAt: fullyPaid ? new Date() : null,
        paidAmountCents: paidTotal,
        paymentMethod: parsed.method,
        updatedAt: new Date(),
      })
      .where(eq(accountsPayable.id, parsed.apId))
    setAuditResource(parsed.apId, {
      paidAmountCents: parsed.amountCents,
      fullyPaid,
    })
    return { id: parsed.apId, fullyPaid, paidTotal }
  },
)

// ─── listAP ──────────────────────────────────────────────────────────────

export const listAP = wrapServerAction(
  { module: 'financeiro', action: 'ap.list' },
  async (input: z.infer<typeof ListAPInputSchema> | undefined, { session }) => {
    const parsed = ListAPInputSchema.parse(input ?? {})
    const where = [eq(accountsPayable.tenantId, session.logifit.tenantId)]
    if (parsed.companyId) where.push(eq(accountsPayable.companyId, parsed.companyId))
    if (parsed.supplierId) where.push(eq(accountsPayable.supplierId, parsed.supplierId))
    if (parsed.status) where.push(eq(accountsPayable.status, parsed.status))
    if (parsed.dueFrom) where.push(gte(accountsPayable.dueDate, parsed.dueFrom))
    if (parsed.dueTo) where.push(lte(accountsPayable.dueDate, parsed.dueTo))

    const rows = await db
      .select({
        id: accountsPayable.id,
        companyId: accountsPayable.companyId,
        supplierId: accountsPayable.supplierId,
        chartAccountId: accountsPayable.chartAccountId,
        amountCents: accountsPayable.amountCents,
        netAmountCents: accountsPayable.netAmountCents,
        issueDate: accountsPayable.issueDate,
        dueDate: accountsPayable.dueDate,
        description: accountsPayable.description,
        docNumber: accountsPayable.docNumber,
        status: accountsPayable.status,
        paidAt: accountsPayable.paidAt,
        supplierName: persons.name,
        chartCode: chartOfAccounts.code,
        chartName: chartOfAccounts.name,
      })
      .from(accountsPayable)
      .leftJoin(suppliers, eq(suppliers.id, accountsPayable.supplierId))
      .leftJoin(persons, eq(persons.id, suppliers.personId))
      .leftJoin(chartOfAccounts, eq(chartOfAccounts.id, accountsPayable.chartAccountId))
      .where(and(...where))
      .orderBy(asc(accountsPayable.dueDate))
      .limit(parsed.limit)
    return { aps: rows }
  },
)

// ─── getAP ───────────────────────────────────────────────────────────────

export const getAP = wrapServerAction(
  { module: 'financeiro', action: 'ap.get', resourceType: 'accounts_payable' },
  async (input: z.infer<typeof ApIdInput>, { session, setAuditResource }) => {
    const parsed = ApIdInput.parse(input)
    const [row] = await db
      .select({
        id: accountsPayable.id,
        companyId: accountsPayable.companyId,
        unitId: accountsPayable.unitId,
        supplierId: accountsPayable.supplierId,
        chartAccountId: accountsPayable.chartAccountId,
        amountCents: accountsPayable.amountCents,
        retentionTotalCents: accountsPayable.retentionTotalCents,
        netAmountCents: accountsPayable.netAmountCents,
        issueDate: accountsPayable.issueDate,
        dueDate: accountsPayable.dueDate,
        description: accountsPayable.description,
        docNumber: accountsPayable.docNumber,
        docKey: accountsPayable.docKey,
        noInvoice: accountsPayable.noInvoice,
        status: accountsPayable.status,
        approvalTrace: accountsPayable.approvalTrace,
        paidAt: accountsPayable.paidAt,
        paidAmountCents: accountsPayable.paidAmountCents,
        paymentMethod: accountsPayable.paymentMethod,
        attachmentStoragePath: accountsPayable.attachmentStoragePath,
        source: accountsPayable.source,
        createdAt: accountsPayable.createdAt,
        supplierName: persons.name,
        supplierDocument: persons.document,
        chartCode: chartOfAccounts.code,
        chartName: chartOfAccounts.name,
      })
      .from(accountsPayable)
      .leftJoin(suppliers, eq(suppliers.id, accountsPayable.supplierId))
      .leftJoin(persons, eq(persons.id, suppliers.personId))
      .leftJoin(chartOfAccounts, eq(chartOfAccounts.id, accountsPayable.chartAccountId))
      .where(
        and(
          eq(accountsPayable.id, parsed.apId),
          eq(accountsPayable.tenantId, session.logifit.tenantId),
        ),
      )
      .limit(1)
    if (!row)
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'AP não encontrada',
        request_id: '',
      })
    const payments = await db
      .select({
        id: apArPayments.id,
        amountCents: apArPayments.amountCents,
        paidAt: apArPayments.paidAt,
        method: apArPayments.method,
        reference: apArPayments.reference,
        notes: apArPayments.notes,
      })
      .from(apArPayments)
      .where(and(eq(apArPayments.sourceType, 'ap'), eq(apArPayments.sourceId, parsed.apId)))
      .orderBy(desc(apArPayments.paidAt))
    setAuditResource(parsed.apId, {})
    return { ap: row, payments }
  },
)
