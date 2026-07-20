'use server'

/**
 * Server Actions de fornecedores — Sprint 15 Faixa B.
 *
 * Funções:
 *   - createSupplier({ personId, ...specificFields }) — linka persons existente
 *     (obrigatório); UI usa <PersonPicker> para buscar/criar persons antes.
 *   - updateSupplier — só campos específicos do supplier; identidade edita em
 *     /app/pessoas/[id] (ADR 0047).
 *   - listSuppliers — lista com filtros (companyId, query name)
 *   - archiveSupplier — soft-delete via archived_at
 *   - getSupplier — detalhe com histórico de AP
 */

import { db } from '@repo/db/client'
import { accountsPayable, persons, suppliers } from '@repo/db/schema'
import { ApiException } from '@repo/errors'
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'
import { wrapServerAction } from '../../../lib/wrap-action'

// ─── Zod ─────────────────────────────────────────────────────────────────

const BankAccountSchema = z.object({
  pixKey: z.string().max(120).optional(),
  bank: z.string().max(50).optional(),
  agency: z.string().max(20).optional(),
  account: z.string().max(30).optional(),
  accountType: z.enum(['checking', 'savings']).optional(),
})

const CreateSupplierInputSchema = z.object({
  personId: z.string().uuid(),
  companyId: z.string().uuid().optional(),
  defaultPaymentMethod: z
    .enum(['pix', 'ted', 'doc', 'boleto', 'cash', 'credit_card', 'manual_other'])
    .optional(),
  defaultPaymentTermDays: z.number().int().min(0).max(365).optional(),
  bankAccount: BankAccountSchema.optional(),
  notes: z.string().max(2000).optional(),
})

const UpdateSupplierInputSchema = z.object({
  supplierId: z.string().uuid(),
  patch: z.object({
    companyId: z.string().uuid().nullable().optional(),
    defaultPaymentMethod: z
      .enum(['pix', 'ted', 'doc', 'boleto', 'cash', 'credit_card', 'manual_other'])
      .nullable()
      .optional(),
    defaultPaymentTermDays: z.number().int().min(0).max(365).nullable().optional(),
    bankAccount: BankAccountSchema.nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
  }),
})

const ListSuppliersInputSchema = z.object({
  query: z.string().max(120).optional(),
  companyId: z.string().uuid().optional(),
  includeArchived: z.boolean().default(false),
  limit: z.number().int().min(1).max(500).default(100),
})

const GetSupplierInputSchema = z.object({
  supplierId: z.string().uuid(),
})

const ArchiveSupplierInputSchema = z.object({
  supplierId: z.string().uuid(),
})

// ─── createSupplier ──────────────────────────────────────────────────────

export const createSupplier = wrapServerAction(
  { module: 'financeiro', action: 'supplier.create', resourceType: 'suppliers' },
  async (input: z.infer<typeof CreateSupplierInputSchema>, { session, setAuditResource }) => {
    const parsed = CreateSupplierInputSchema.parse(input)

    // Valida persons existe no tenant
    const [p] = await db
      .select({ id: persons.id })
      .from(persons)
      .where(and(eq(persons.id, parsed.personId), eq(persons.tenantId, session.logifit.tenantId)))
      .limit(1)
    if (!p) {
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Pessoa não encontrada',
        request_id: '',
      })
    }

    const [row] = await db
      .insert(suppliers)
      .values({
        tenantId: session.logifit.tenantId,
        personId: parsed.personId,
        companyId: parsed.companyId ?? null,
        defaultPaymentMethod: parsed.defaultPaymentMethod ?? null,
        defaultPaymentTermDays: parsed.defaultPaymentTermDays ?? null,
        bankAccount: parsed.bankAccount ?? null,
        notes: parsed.notes ?? null,
      })
      .returning({ id: suppliers.id })
    if (!row)
      throw new ApiException({
        code: 'INTERNAL_ERROR',
        message: 'Falha ao criar fornecedor',
        request_id: '',
      })
    setAuditResource(row.id, { personId: parsed.personId })
    return { id: row.id }
  },
)

// ─── updateSupplier ──────────────────────────────────────────────────────

export const updateSupplier = wrapServerAction(
  { module: 'financeiro', action: 'supplier.update', resourceType: 'suppliers' },
  async (input: z.infer<typeof UpdateSupplierInputSchema>, { session, setAuditResource }) => {
    const parsed = UpdateSupplierInputSchema.parse(input)
    const set: Record<string, unknown> = { updatedAt: new Date() }
    const p = parsed.patch
    if (p.companyId !== undefined) set.companyId = p.companyId
    if (p.defaultPaymentMethod !== undefined) set.defaultPaymentMethod = p.defaultPaymentMethod
    if (p.defaultPaymentTermDays !== undefined)
      set.defaultPaymentTermDays = p.defaultPaymentTermDays
    if (p.bankAccount !== undefined) set.bankAccount = p.bankAccount
    if (p.notes !== undefined) set.notes = p.notes

    const [row] = await db
      .update(suppliers)
      .set(set)
      .where(
        and(eq(suppliers.id, parsed.supplierId), eq(suppliers.tenantId, session.logifit.tenantId)),
      )
      .returning({ id: suppliers.id })
    if (!row)
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Fornecedor não encontrado',
        request_id: '',
      })
    setAuditResource(row.id, {})
    return { id: row.id }
  },
)

// ─── listSuppliers ───────────────────────────────────────────────────────

export const listSuppliers = wrapServerAction(
  { module: 'financeiro', action: 'supplier.list' },
  async (input: z.infer<typeof ListSuppliersInputSchema> | undefined, { session }) => {
    const parsed = ListSuppliersInputSchema.parse(input ?? {})
    const where = [eq(suppliers.tenantId, session.logifit.tenantId)]
    if (!parsed.includeArchived) where.push(isNull(suppliers.archivedAt))
    if (parsed.companyId) where.push(eq(suppliers.companyId, parsed.companyId))

    let query = db
      .select({
        id: suppliers.id,
        personId: suppliers.personId,
        companyId: suppliers.companyId,
        defaultPaymentMethod: suppliers.defaultPaymentMethod,
        defaultPaymentTermDays: suppliers.defaultPaymentTermDays,
        bankAccount: suppliers.bankAccount,
        notes: suppliers.notes,
        archivedAt: suppliers.archivedAt,
        createdAt: suppliers.createdAt,
        personName: persons.name,
        personDocument: persons.document,
        personKind: persons.kind,
        personEmail: persons.email,
        personPhone: persons.phone,
      })
      .from(suppliers)
      .leftJoin(persons, eq(persons.id, suppliers.personId))
      .where(and(...where))
      .orderBy(asc(persons.name))
      .limit(parsed.limit)
      .$dynamic()

    if (parsed.query) {
      const q = `%${parsed.query}%`
      query = query.where(
        and(...where, sql`(${persons.name} ILIKE ${q} OR ${persons.document} ILIKE ${q})`),
      )
    }

    const rows = await query
    return { suppliers: rows }
  },
)

// ─── getSupplier ─────────────────────────────────────────────────────────

export const getSupplier = wrapServerAction(
  { module: 'financeiro', action: 'supplier.get', resourceType: 'suppliers' },
  async (input: z.infer<typeof GetSupplierInputSchema>, { session, setAuditResource }) => {
    const parsed = GetSupplierInputSchema.parse(input)
    const [row] = await db
      .select({
        id: suppliers.id,
        personId: suppliers.personId,
        companyId: suppliers.companyId,
        defaultPaymentMethod: suppliers.defaultPaymentMethod,
        defaultPaymentTermDays: suppliers.defaultPaymentTermDays,
        bankAccount: suppliers.bankAccount,
        notes: suppliers.notes,
        archivedAt: suppliers.archivedAt,
        createdAt: suppliers.createdAt,
        personName: persons.name,
        personDocument: persons.document,
        personKind: persons.kind,
        personEmail: persons.email,
        personPhone: persons.phone,
      })
      .from(suppliers)
      .leftJoin(persons, eq(persons.id, suppliers.personId))
      .where(
        and(eq(suppliers.id, parsed.supplierId), eq(suppliers.tenantId, session.logifit.tenantId)),
      )
      .limit(1)
    if (!row) {
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Fornecedor não encontrado',
        request_id: '',
      })
    }

    // Histórico AP (últimas 20)
    const apHistory = await db
      .select({
        id: accountsPayable.id,
        amountCents: accountsPayable.amountCents,
        netAmountCents: accountsPayable.netAmountCents,
        dueDate: accountsPayable.dueDate,
        status: accountsPayable.status,
        description: accountsPayable.description,
        paidAt: accountsPayable.paidAt,
      })
      .from(accountsPayable)
      .where(eq(accountsPayable.supplierId, parsed.supplierId))
      .orderBy(desc(accountsPayable.dueDate))
      .limit(20)

    setAuditResource(parsed.supplierId, {})
    return { supplier: row, apHistory }
  },
)

// ─── archiveSupplier ─────────────────────────────────────────────────────

export const archiveSupplier = wrapServerAction(
  { module: 'financeiro', action: 'supplier.archive', resourceType: 'suppliers' },
  async (input: z.infer<typeof ArchiveSupplierInputSchema>, { session, setAuditResource }) => {
    const parsed = ArchiveSupplierInputSchema.parse(input)
    // Bloqueio: AP não-concluídas pendentes
    const [openAp] = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(accountsPayable)
      .where(
        and(
          eq(accountsPayable.supplierId, parsed.supplierId),
          sql`${accountsPayable.status} IN ('draft','pending_approval','approved','scheduled')`,
        ),
      )
    if ((openAp?.c ?? 0) > 0) {
      throw new ApiException({
        code: 'VALIDATION_ERROR',
        message: `Fornecedor tem ${openAp?.c} APs em aberto — quite ou cancele antes`,
        request_id: '',
      })
    }
    const [row] = await db
      .update(suppliers)
      .set({ archivedAt: new Date(), updatedAt: new Date() })
      .where(
        and(eq(suppliers.id, parsed.supplierId), eq(suppliers.tenantId, session.logifit.tenantId)),
      )
      .returning({ id: suppliers.id })
    if (!row)
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Fornecedor não encontrado',
        request_id: '',
      })
    setAuditResource(row.id, {})
    return { id: row.id }
  },
)
