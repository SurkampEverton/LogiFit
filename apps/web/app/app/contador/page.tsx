/**
 * `/app/contador` — portal read-only para role `contador_externo`
 * (Sprint 01b fechamento + ADR 0061).
 *
 * Contador externo invitado tem acesso read-only a:
 *   - Cobranças (invoices) com filtros mês/status/company
 *   - Recebimentos (payments)
 *   - Resumo MRR + receita por mês
 *   - NF-e emitidas (Sprint 36 popula)
 *
 * RBAC: role `contador_externo` (Sprint 01a Faixa C) com permissions só
 * `financeiro.read`, `fiscal.read`, `nfe.read`, `retencoes.read`.
 * **Nunca** vê prontuário, consultas, member sensitive (LGPD art. 11).
 *
 * MVP Sprint 01b: dashboard agregado simples. Sprint 04+ Faixa C amplia
 * com filtros, export CSV/XML SPED, drill-down por NF-e.
 */
import { db } from '@repo/db/client'
import { companies, fiscalEmissions, invoices, payments, persons } from '@repo/db/schema'
import { and, desc, eq, gte, sql } from 'drizzle-orm'
import Link from 'next/link'
import { requireFullSession } from '../../lib/session'

export const dynamic = 'force-dynamic'

function formatBRL(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  })
}

export default async function ContadorPortalPage() {
  const session = await requireFullSession('/app/contador')
  const tenantId = session.logifit.tenantId
  const now = new Date()
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
  const last90d = new Date(now)
  last90d.setDate(now.getDate() - 90)

  const [mrr, paymentsMonth, recentPayments, revenueByCompany, fiscalMonth] = await Promise.all([
    db
      .select({ sum: sql<number>`coalesce(sum(${invoices.amountCents}), 0)::int` })
      .from(invoices)
      .where(
        and(
          eq(invoices.tenantId, tenantId),
          eq(invoices.status, 'paid'),
          gte(invoices.paidAt, startOfMonth),
        ),
      ),
    db
      .select({
        sum: sql<number>`coalesce(sum(${payments.amountCents}), 0)::int`,
        count: sql<number>`count(*)::int`,
      })
      .from(payments)
      .where(and(eq(payments.tenantId, tenantId), gte(payments.paidAt, startOfMonth))),
    db
      .select({
        id: payments.id,
        amountCents: payments.amountCents,
        method: payments.method,
        paidAt: payments.paidAt,
        asaasId: payments.asaasId,
      })
      .from(payments)
      .where(eq(payments.tenantId, tenantId))
      .orderBy(desc(payments.paidAt))
      .limit(20),
    db
      .select({
        companyId: invoices.companyId,
        companyName: persons.name,
        sum: sql<number>`coalesce(sum(${invoices.amountCents}), 0)::int`,
      })
      .from(invoices)
      .innerJoin(companies, eq(companies.id, invoices.companyId))
      .innerJoin(persons, eq(persons.id, companies.personId))
      .where(
        and(
          eq(invoices.tenantId, tenantId),
          eq(invoices.status, 'paid'),
          gte(invoices.paidAt, last90d),
        ),
      )
      .groupBy(invoices.companyId, persons.name)
      .orderBy(desc(sql`sum(${invoices.amountCents})`)),
    db
      .select({
        total: sql<number>`count(*)::int`,
        autorizadas: sql<number>`count(*) FILTER (WHERE status = 'completed')::int`,
        valorAutorizadoCents: sql<number>`coalesce(sum(valor_total_cents) FILTER (WHERE status = 'completed'), 0)::bigint`,
      })
      .from(fiscalEmissions)
      .where(
        and(eq(fiscalEmissions.tenantId, tenantId), gte(fiscalEmissions.createdAt, startOfMonth)),
      ),
  ])

  return (
    <div className="mx-auto max-w-6xl px-6 py-8 space-y-8">
      <header className="space-y-1">
        <h1 className="text-3xl font-semibold tracking-tight">Portal Contador</h1>
        <p className="text-sm text-[color:var(--ev-text-muted)]">
          Visão read-only fiscal/financeiro · ADR 0061 + role `contador_externo`. Sem acesso a
          prontuário ou dados sensíveis (LGPD art. 11).
        </p>
      </header>

      <section
        className="grid gap-4"
        style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}
      >
        <div className="rounded-xl border border-[color:var(--ev-border)] p-5 space-y-1">
          <div className="text-xs text-[color:var(--ev-text-muted)] uppercase tracking-wide">
            MRR do mês
          </div>
          <div className="text-2xl font-semibold tabular-nums">{formatBRL(mrr[0]?.sum ?? 0)}</div>
          <div className="text-xs text-[color:var(--ev-text-muted)]">Invoices `paid` no mês</div>
        </div>
        <div className="rounded-xl border border-[color:var(--ev-border)] p-5 space-y-1">
          <div className="text-xs text-[color:var(--ev-text-muted)] uppercase tracking-wide">
            Recebimentos confirmados
          </div>
          <div className="text-2xl font-semibold tabular-nums">
            {formatBRL(paymentsMonth[0]?.sum ?? 0)}
          </div>
          <div className="text-xs text-[color:var(--ev-text-muted)]">
            {paymentsMonth[0]?.count ?? 0} transação(ões) — Asaas
          </div>
        </div>
      </section>

      {/* Receita por company 90d */}
      <section className="rounded-xl border border-[color:var(--ev-border)] p-5 space-y-3">
        <h2 className="font-semibold">🏢 Receita por company (90 dias)</h2>
        {revenueByCompany.length === 0 ? (
          <p className="text-sm text-[color:var(--ev-text-muted)] py-2">
            Sem receita registrada nos últimos 90 dias.
          </p>
        ) : (
          <ul className="divide-y divide-[color:var(--ev-border)] text-sm">
            {revenueByCompany.map((c) => (
              <li key={c.companyId} className="py-2 flex items-center justify-between">
                <span className="font-medium">{c.companyName}</span>
                <span className="tabular-nums font-medium">{formatBRL(c.sum)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Recebimentos recentes */}
      <section className="rounded-xl border border-[color:var(--ev-border)] p-5 space-y-3">
        <h2 className="font-semibold">📥 Últimos 20 recebimentos</h2>
        {recentPayments.length === 0 ? (
          <p className="text-sm text-[color:var(--ev-text-muted)] py-2">
            Sem pagamentos recentes registrados.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-[color:var(--ev-text-muted)] uppercase tracking-wide">
                <tr>
                  <th className="pb-2">Data</th>
                  <th className="pb-2">Método</th>
                  <th className="pb-2">Asaas ID</th>
                  <th className="pb-2 text-right">Valor</th>
                </tr>
              </thead>
              <tbody>
                {recentPayments.map((p) => (
                  <tr key={p.id} className="border-t border-[color:var(--ev-border)]">
                    <td className="py-2 tabular-nums text-[color:var(--ev-text-muted)]">
                      {new Date(p.paidAt).toLocaleString('pt-BR', {
                        day: '2-digit',
                        month: '2-digit',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                    <td className="py-2 text-xs uppercase">{p.method}</td>
                    <td className="py-2 text-xs font-mono text-[color:var(--ev-text-muted)]">
                      {p.asaasId}
                    </td>
                    <td className="py-2 tabular-nums font-medium text-right">
                      {formatBRL(p.amountCents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Emissões fiscais do mês (Sprint 36b.6) */}
      <section className="rounded-xl border border-[color:var(--ev-border)] p-5 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="font-semibold">🧾 Emissões fiscais do mês</h2>
          <Link href="/app/contador/fiscal-emissions" className="ev-btn ev-btn-sm">
            Ver notas + XML/PDF →
          </Link>
        </div>
        <div className="flex flex-wrap gap-6 text-sm">
          <div>
            <div className="text-xs text-[color:var(--ev-text-muted)] uppercase tracking-wide">
              Emitidas
            </div>
            <div className="text-2xl font-semibold tabular-nums">{fiscalMonth[0]?.total ?? 0}</div>
          </div>
          <div>
            <div className="text-xs text-[color:var(--ev-text-muted)] uppercase tracking-wide">
              Autorizadas
            </div>
            <div className="text-2xl font-semibold tabular-nums">
              {fiscalMonth[0]?.autorizadas ?? 0}
            </div>
          </div>
          <div>
            <div className="text-xs text-[color:var(--ev-text-muted)] uppercase tracking-wide">
              Valor autorizado
            </div>
            <div className="text-2xl font-semibold tabular-nums">
              {formatBRL(Number(fiscalMonth[0]?.valorAutorizadoCents ?? 0))}
            </div>
          </div>
          <div className="flex items-end">
            <Link href="/app/fiscal/apuracao" className="ev-btn ev-btn-sm ev-btn-ghost">
              📊 Apuração mensal (memorial pré-DAS)
            </Link>
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-dashed border-[color:var(--ev-border)] p-6 text-sm text-[color:var(--ev-text-muted)]">
        <p>
          <strong>Fase 2 do portal:</strong> download ZIP em massa de XMLs · CSV/OFX de AP/AR ·
          retenções IRRF/INSS/ISS por tributo · DRE read-only · export SPED.
        </p>
      </section>

      <p className="text-xs text-[color:var(--ev-text-muted)] text-center">
        Para dúvidas ou solicitações: <strong>privacidade@logifit.com.br</strong>
      </p>
    </div>
  )
}
