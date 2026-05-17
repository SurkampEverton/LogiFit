/**
 * `/app/financeiro/fluxo-caixa` — projeção de fluxo de caixa (Sprint 17 Faixa C).
 */
import Link from 'next/link'
import { requireFullSession } from '../../../lib/session'
import { CashflowChart } from './cashflow-chart'

export const dynamic = 'force-dynamic'

export default async function FluxoCaixaPage() {
  await requireFullSession('/app/financeiro/fluxo-caixa')
  return (
    <div className="ev-stack" style={{ padding: 'var(--ev-space-lg)' }}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--ev-space-md)' }}>
        <h1 style={{ margin: 0 }}>Fluxo de caixa</h1>
        <span style={{ flex: 1 }} />
        <Link href="/app/financeiro/bancos" className="ev-btn ev-btn-ghost">
          Bancos
        </Link>
        <Link href="/app/financeiro" className="ev-btn ev-btn-ghost">
          ← Financeiro
        </Link>
      </header>

      <p style={{ color: 'var(--ev-muted)', marginTop: 0 }}>
        Projeção 30/60/90 dias baseada no saldo atual das contas bancárias + APs pendentes + ARs +
        mensalidades de contrato (invoices Sprint 04). APs/ARs com `dueDate` passado (atrasadas)
        absorvidas no dia 0.
      </p>

      <CashflowChart />
    </div>
  )
}
