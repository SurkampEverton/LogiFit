/**
 * `/app/financeiro` — visão geral financeiro (Sprint 04 Faixa C).
 *
 * KPIs MVP: MRR mês, total overdue, receita 30d, contratos ativos.
 * Server Component agrega via SQL — sem hit em listMembers/etc.
 */
import { and, eq, gte, sql } from 'drizzle-orm'
import Link from 'next/link'
import { db } from '@repo/db/client'
import { contracts, invoices } from '@repo/db/schema'
import { requireFullSession } from '../../lib/session'

export const dynamic = 'force-dynamic'

function formatBRL(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  })
}

export default async function FinanceiroPage() {
  const session = await requireFullSession('/app/financeiro')
  const tenantId = session.logifit.tenantId
  const now = new Date()
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
  const last30d = new Date(now)
  last30d.setDate(now.getDate() - 30)

  const [activeContracts, paidThisMonth, overdueTotal, last30dRevenue] = await Promise.all([
    // Contratos ativos
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(contracts)
      .where(and(eq(contracts.tenantId, tenantId), eq(contracts.status, 'active'))),
    // MRR (sum amount_cents pago no mês)
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
    // Overdue total
    db
      .select({
        sum: sql<number>`coalesce(sum(${invoices.amountCents}), 0)::int`,
        count: sql<number>`count(*)::int`,
      })
      .from(invoices)
      .where(and(eq(invoices.tenantId, tenantId), eq(invoices.status, 'overdue'))),
    // Receita 30d
    db
      .select({ sum: sql<number>`coalesce(sum(${invoices.amountCents}), 0)::int` })
      .from(invoices)
      .where(
        and(
          eq(invoices.tenantId, tenantId),
          eq(invoices.status, 'paid'),
          gte(invoices.paidAt, last30d),
        ),
      ),
  ])

  const kpis = [
    {
      label: 'Contratos ativos',
      value: String(activeContracts[0]?.count ?? 0),
      hint: 'Members com contrato `active`',
    },
    {
      label: 'Receita do mês',
      value: formatBRL(paidThisMonth[0]?.sum ?? 0),
      hint: 'Invoices `paid` neste mês',
    },
    {
      label: 'Em atraso',
      value: formatBRL(overdueTotal[0]?.sum ?? 0),
      hint: `${overdueTotal[0]?.count ?? 0} invoice(s) overdue`,
      danger: (overdueTotal[0]?.count ?? 0) > 0,
    },
    {
      label: 'Receita 30d',
      value: formatBRL(last30dRevenue[0]?.sum ?? 0),
      hint: 'Pagas nos últimos 30 dias',
    },
  ]

  return (
    <div className="mx-auto max-w-6xl px-6 py-8 space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Financeiro</h1>
          <p className="text-sm text-[color:var(--ev-text-muted)]">
            Sprint 04 — Planos, contratos, cobranças. Cobranças automáticas D-5 + webhook Asaas.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Link
            href="/app/financeiro/planos"
            className="rounded-md border border-[color:var(--ev-border)] px-4 py-2 font-medium hover:bg-[color:var(--ev-surface)]"
            style={{ minHeight: 'var(--ev-touch-min, 44px)' }}
          >
            Planos
          </Link>
          <Link
            href="/app/financeiro/contratos"
            className="rounded-md border border-[color:var(--ev-border)] px-4 py-2 font-medium hover:bg-[color:var(--ev-surface)]"
            style={{ minHeight: 'var(--ev-touch-min, 44px)' }}
          >
            Contratos
          </Link>
          <Link
            href="/app/financeiro/cobrancas"
            className="rounded-md border border-[color:var(--ev-border)] px-4 py-2 font-medium hover:bg-[color:var(--ev-surface)]"
            style={{ minHeight: 'var(--ev-touch-min, 44px)' }}
          >
            Cobranças
          </Link>
        </div>
      </header>

      <nav
        className="grid gap-3"
        style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}
      >
        <Link
          href="/app/financeiro/plano-contas"
          className="rounded-xl border border-[color:var(--ev-border)] p-4 hover:bg-[color:var(--ev-surface)]"
        >
          <div style={{ fontWeight: 600 }}>📒 Plano de contas</div>
          <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-text-muted)' }}>
            Hierarquia contábil brasileira (ADR 0033)
          </div>
        </Link>
        <Link
          href="/app/financeiro/fornecedores"
          className="rounded-xl border border-[color:var(--ev-border)] p-4 hover:bg-[color:var(--ev-surface)]"
        >
          <div style={{ fontWeight: 600 }}>🏭 Fornecedores</div>
          <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-text-muted)' }}>
            Cadastro + histórico de compras
          </div>
        </Link>
        <Link
          href="/app/financeiro/contas-pagar"
          className="rounded-xl border border-[color:var(--ev-border)] p-4 hover:bg-[color:var(--ev-surface)]"
        >
          <div style={{ fontWeight: 600 }}>💸 Contas a pagar</div>
          <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-text-muted)' }}>
            AP com workflow de aprovação (ADR 0034)
          </div>
        </Link>
        <Link
          href="/app/financeiro/contas-receber"
          className="rounded-xl border border-[color:var(--ev-border)] p-4 hover:bg-[color:var(--ev-surface)]"
        >
          <div style={{ fontWeight: 600 }}>💰 Contas a receber</div>
          <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-text-muted)' }}>
            AR avulso (não-contrato)
          </div>
        </Link>
        <Link
          href="/app/financeiro/aging"
          className="rounded-xl border border-[color:var(--ev-border)] p-4 hover:bg-[color:var(--ev-surface)]"
        >
          <div style={{ fontWeight: 600 }}>📊 Aging</div>
          <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-text-muted)' }}>
            Distribuição por faixa de vencimento
          </div>
        </Link>
        <Link
          href="/app/financeiro/rateio/regras"
          className="rounded-xl border border-[color:var(--ev-border)] p-4 hover:bg-[color:var(--ev-surface)]"
        >
          <div style={{ fontWeight: 600 }}>⚖️ Rateio entre filiais</div>
          <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-text-muted)' }}>
            Regras de distribuição (ADR 0036)
          </div>
        </Link>
        <Link
          href="/app/financeiro/intercompany"
          className="rounded-xl border border-[color:var(--ev-border)] p-4 hover:bg-[color:var(--ev-surface)]"
        >
          <div style={{ fontWeight: 600 }}>🔄 Intercompany</div>
          <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-text-muted)' }}>
            Lançamentos cruzando companies + fechamento
          </div>
        </Link>
        <Link
          href="/app/financeiro/bancos"
          className="rounded-xl border border-[color:var(--ev-border)] p-4 hover:bg-[color:var(--ev-surface)]"
        >
          <div style={{ fontWeight: 600 }}>🏦 Bancos</div>
          <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-text-muted)' }}>
            Contas + OFX + conciliação (Sprint 17)
          </div>
        </Link>
        <Link
          href="/app/financeiro/fluxo-caixa"
          className="rounded-xl border border-[color:var(--ev-border)] p-4 hover:bg-[color:var(--ev-surface)]"
        >
          <div style={{ fontWeight: 600 }}>💹 Fluxo de caixa</div>
          <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-text-muted)' }}>
            Projeção 30/60/90 dias
          </div>
        </Link>
        <Link
          href="/app/financeiro/custos"
          className="rounded-xl border border-[color:var(--ev-border)] p-4 hover:bg-[color:var(--ev-surface)]"
        >
          <div style={{ fontWeight: 600 }}>🧾 Custos</div>
          <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-text-muted)' }}>
            Lançamentos rápidos (Sprint 14)
          </div>
        </Link>
        <Link
          href="/app/financeiro/dre"
          className="rounded-xl border border-[color:var(--ev-border)] p-4 hover:bg-[color:var(--ev-surface)]"
        >
          <div style={{ fontWeight: 600 }}>📈 DRE</div>
          <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-text-muted)' }}>
            Demonstrativo de resultado
          </div>
        </Link>
        <Link
          href="/app/financeiro/previsao"
          className="rounded-xl border border-[color:var(--ev-border)] p-4 hover:bg-[color:var(--ev-surface)]"
        >
          <div style={{ fontWeight: 600 }}>🔮 Previsão</div>
          <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-text-muted)' }}>
            Forecast receita 3-12m
          </div>
        </Link>
        <Link
          href="/app/financeiro/adquirencia"
          className="rounded-xl border border-[color:var(--ev-border)] p-4 hover:bg-[color:var(--ev-surface)]"
        >
          <div style={{ fontWeight: 600 }}>💳 Adquirência</div>
          <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-text-muted)' }}>
            Maquininhas + antecipação (Sprint 18)
          </div>
        </Link>
        <Link
          href="/app/financeiro/receita"
          className="rounded-xl border border-[color:var(--ev-border)] p-4 hover:bg-[color:var(--ev-surface)]"
        >
          <div style={{ fontWeight: 600 }}>📊 Receita unificada</div>
          <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-text-muted)' }}>
            Online (Asaas) + presencial (maquininha)
          </div>
        </Link>
      </nav>

      <section
        className="grid gap-4"
        style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}
      >
        {kpis.map((k) => (
          <div
            key={k.label}
            className="rounded-xl border border-[color:var(--ev-border)] p-5 space-y-1"
            style={{
              borderColor: k.danger ? 'var(--ev-danger)' : undefined,
            }}
          >
            <div className="text-xs text-[color:var(--ev-text-muted)] uppercase tracking-wide">
              {k.label}
            </div>
            <div
              className="text-2xl font-semibold"
              style={{ color: k.danger ? 'var(--ev-danger)' : undefined }}
            >
              {k.value}
            </div>
            <div className="text-xs text-[color:var(--ev-text-muted)]">{k.hint}</div>
          </div>
        ))}
      </section>
    </div>
  )
}
