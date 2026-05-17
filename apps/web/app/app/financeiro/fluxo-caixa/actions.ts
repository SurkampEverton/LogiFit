'use server'

/**
 * Server Actions Fluxo de Caixa — Sprint 17 Faixa B.
 *
 * `forecastCashflowAction(companyId?, daysAhead)` agrega:
 *   - Saldo atual dos bank_accounts (sum currentBalanceCents) filtrado opcionalmente
 *     por company
 *   - APs pendentes (status ∈ pending_approval/approved/scheduled) com dueDate
 *     no range [hoje - 7d, hoje + daysAhead]
 *   - ARs pendentes (status ∈ draft/issued/overdue) idem
 *
 * Chama `forecastCashflow()` pure function e retorna array de pontos diários.
 */

import { db } from '@repo/db/client'
import { forecastCashflow } from '@repo/db/bancos'
import {
  accountsPayable,
  accountsReceivable,
  bankAccounts,
  invoices,
} from '@repo/db/schema'
import { and, eq, gte, isNull, lte, sql } from 'drizzle-orm'
import { z } from 'zod'
import { wrapServerAction } from '../../../lib/wrap-action'

const ForecastInputSchema = z.object({
  companyId: z.string().uuid().optional(),
  daysAhead: z.number().int().min(7).max(180).default(30),
})

export const forecastCashflowAction = wrapServerAction(
  { module: 'financeiro', action: 'cashflow.forecast', resourceType: 'cashflow' },
  async (
    input: z.infer<typeof ForecastInputSchema> | undefined,
    { session, setAuditResource },
  ) => {
    const parsed = ForecastInputSchema.parse(input ?? {})

    // Saldo atual
    const whereBank = [eq(bankAccounts.tenantId, session.logifit.tenantId), isNull(bankAccounts.archivedAt)]
    if (parsed.companyId) whereBank.push(eq(bankAccounts.companyId, parsed.companyId))
    const [bal] = await db
      .select({
        sum: sql<number>`COALESCE(SUM(${bankAccounts.currentBalanceCents}), 0)::bigint`,
      })
      .from(bankAccounts)
      .where(and(...whereBank))
    const currentBalanceCents = Number(bal?.sum ?? 0)

    const today = new Date().toISOString().slice(0, 10)
    const start = new Date()
    start.setDate(start.getDate() - 7) // pega overdue de até 7d
    const startStr = start.toISOString().slice(0, 10)
    const end = new Date()
    end.setDate(end.getDate() + parsed.daysAhead)
    const endStr = end.toISOString().slice(0, 10)

    // APs pendentes no range
    const whereAp = [
      eq(accountsPayable.tenantId, session.logifit.tenantId),
      sql`${accountsPayable.status} IN ('pending_approval','approved','scheduled')`,
      gte(accountsPayable.dueDate, startStr),
      lte(accountsPayable.dueDate, endStr),
    ]
    if (parsed.companyId) whereAp.push(eq(accountsPayable.companyId, parsed.companyId))
    const aps = await db
      .select({
        dueDate: accountsPayable.dueDate,
        amountCents: accountsPayable.netAmountCents,
      })
      .from(accountsPayable)
      .where(and(...whereAp))

    // ARs pendentes
    const whereAr = [
      eq(accountsReceivable.tenantId, session.logifit.tenantId),
      sql`${accountsReceivable.status} IN ('draft','issued','overdue')`,
      gte(accountsReceivable.dueDate, startStr),
      lte(accountsReceivable.dueDate, endStr),
    ]
    if (parsed.companyId) whereAr.push(eq(accountsReceivable.companyId, parsed.companyId))
    const ars = await db
      .select({
        dueDate: accountsReceivable.dueDate,
        amountCents: accountsReceivable.amountCents,
      })
      .from(accountsReceivable)
      .where(and(...whereAr))

    // Também inclui invoices Sprint 04 (mensalidades contrato pending/overdue)
    const whereInv = [
      eq(invoices.tenantId, session.logifit.tenantId),
      sql`${invoices.status} IN ('open','pending','overdue')`,
      gte(invoices.dueAt, new Date(startStr)),
      lte(invoices.dueAt, new Date(endStr + 'T23:59:59Z')),
    ]
    if (parsed.companyId) whereInv.push(eq(invoices.companyId, parsed.companyId))
    const invs = await db
      .select({
        dueAt: invoices.dueAt,
        amountCents: invoices.amountCents,
      })
      .from(invoices)
      .where(and(...whereInv))

    const futureAps = aps.map((a) => ({
      dueDate: typeof a.dueDate === 'string' ? a.dueDate : new Date(a.dueDate as Date).toISOString().slice(0, 10),
      amountCents: a.amountCents,
    }))
    const futureArs = [
      ...ars.map((a) => ({
        dueDate: typeof a.dueDate === 'string' ? a.dueDate : new Date(a.dueDate as Date).toISOString().slice(0, 10),
        amountCents: a.amountCents,
      })),
      ...invs.map((i) => ({
        dueDate: new Date(i.dueAt as Date).toISOString().slice(0, 10),
        amountCents: i.amountCents,
      })),
    ]

    const points = forecastCashflow({
      currentBalanceCents,
      futureAps,
      futureArs,
      daysAhead: parsed.daysAhead,
      startDate: today,
    })

    setAuditResource('cashflow', { days: parsed.daysAhead, balance: currentBalanceCents })

    return {
      currentBalanceCents,
      points,
      summary: {
        totalInflow: points.reduce((s, p) => s + p.inflowCents, 0),
        totalOutflow: points.reduce((s, p) => s + p.outflowCents, 0),
        minBalance: Math.min(...points.map((p) => p.closingBalance)),
        maxBalance: Math.max(...points.map((p) => p.closingBalance)),
        finalBalance: points[points.length - 1]?.closingBalance ?? currentBalanceCents,
      },
    }
  },
)
