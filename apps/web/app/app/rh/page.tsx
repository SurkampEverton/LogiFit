import { db } from '@repo/db/client'
/**
 * `/app/rh` — hub RH (Sprint 23 Faixa C).
 */
import { sql } from 'drizzle-orm'
import Link from 'next/link'
import { requireFullSession } from '../../lib/session'

export const dynamic = 'force-dynamic'

function formatBrl(cents: number): string {
  return (Number(cents) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export default async function RhHubPage() {
  const session = await requireFullSession('/app/rh')
  const tenantId = session.logifit.tenantId

  const [k] = (
    await db.execute(sql`
      SELECT
        (SELECT COUNT(*)::int FROM professional_contracts WHERE tenant_id = ${tenantId} AND active = true) AS active_contracts,
        (SELECT COUNT(*)::int FROM commission_entries WHERE tenant_id = ${tenantId} AND status = 'pending') AS pending_entries,
        (SELECT COALESCE(SUM(commission_cents), 0)::bigint FROM commission_entries WHERE tenant_id = ${tenantId} AND status = 'pending') AS pending_total,
        (SELECT COUNT(*)::int FROM commission_periods WHERE tenant_id = ${tenantId} AND status = 'draft') AS draft_periods,
        (SELECT COALESCE(SUM(net_total_cents), 0)::bigint FROM commission_periods WHERE tenant_id = ${tenantId} AND status = 'approved') AS approved_to_pay
    `)
  ).rows as Array<{
    active_contracts: number
    pending_entries: number
    pending_total: number
    draft_periods: number
    approved_to_pay: number
  }>
  const kpi = k ?? {
    active_contracts: 0,
    pending_entries: 0,
    pending_total: 0,
    draft_periods: 0,
    approved_to_pay: 0,
  }

  return (
    <div className="ev-stack" style={{ padding: 'var(--ev-space-lg)' }}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--ev-space-md)' }}>
        <h1 style={{ margin: 0 }}>RH · Comissões</h1>
        <span style={{ color: 'var(--ev-muted)' }}>Sprint 23a · ADR 0086 Proposed</span>
      </header>

      <section
        className="ev-card"
        style={{
          padding: 'var(--ev-space-md)',
          display: 'grid',
          gridTemplateColumns: 'repeat(5, 1fr)',
          gap: 'var(--ev-space-md)',
        }}
      >
        <div>
          <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>
            Contratos ativos
          </div>
          <div style={{ fontSize: 'var(--ev-font-lg)', fontWeight: 600 }}>
            {kpi.active_contracts}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>
            Entries pendentes
          </div>
          <div style={{ fontSize: 'var(--ev-font-lg)', fontWeight: 600 }}>
            {kpi.pending_entries}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>
            Pendente bruto
          </div>
          <div style={{ fontSize: 'var(--ev-font-lg)', fontWeight: 600 }}>
            {formatBrl(Number(kpi.pending_total))}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>
            Periods em draft
          </div>
          <div style={{ fontSize: 'var(--ev-font-lg)', fontWeight: 600 }}>{kpi.draft_periods}</div>
        </div>
        <div>
          <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>
            Approved a pagar
          </div>
          <div
            style={{
              fontSize: 'var(--ev-font-lg)',
              fontWeight: 600,
              color: 'var(--ev-success, #16a34a)',
            }}
          >
            {formatBrl(Number(kpi.approved_to_pay))}
          </div>
        </div>
      </section>

      <nav
        className="ev-stack"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: 'var(--ev-space-md)',
        }}
      >
        <Link
          href="/app/rh/profissionais"
          className="ev-card"
          style={{ padding: 'var(--ev-space-md)' }}
        >
          <strong>👥 Profissionais + Contratos</strong>
          <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>
            Cadastro + condições + versões
          </div>
        </Link>
        <Link
          href="/app/rh/comissoes"
          className="ev-card"
          style={{ padding: 'var(--ev-space-md)' }}
        >
          <strong>💰 Entries de comissão</strong>
          <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>
            Cálculos por evento (pendentes + included + reversed)
          </div>
        </Link>
        <Link
          href="/app/rh/fechamento"
          className="ev-card"
          style={{ padding: 'var(--ev-space-md)' }}
        >
          <strong>📅 Fechamento mensal</strong>
          <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>
            Periods draft → approved → paid
          </div>
        </Link>
        <Link
          href="/app/rh/relatorios"
          className="ev-card"
          style={{ padding: 'var(--ev-space-md)' }}
        >
          <strong>📊 Relatórios</strong>
          <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>
            Por profissional · procedimento · convênio
          </div>
        </Link>
      </nav>
    </div>
  )
}
