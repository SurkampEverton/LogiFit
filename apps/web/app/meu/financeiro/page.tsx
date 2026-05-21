/**
 * /meu/financeiro — cobranças do paciente. Sprint 26 Faixa C (26b).
 *
 * Lista pendentes (urgência primeiro) + histórico recente. Botão "Pagar" leva
 * pro `external_url` Asaas direto. Botão "Recibo" leva pra `/meu/recibos`.
 *
 * RLS member: invoices.member_id = current_setting('app.member_id').
 */
import Link from 'next/link'
import { pool } from '@repo/db/client'
import { withMemberContext } from '../../lib/member-session'
import { requireMemberOrPassport } from '../../lib/require-member-or-passport'
import { PassportNeedsLink } from '../_components/passport-needs-link'

export const dynamic = 'force-dynamic'

interface InvoiceRow {
  id: string
  amount_cents: number
  due_at: Date
  status: 'pending' | 'paid' | 'overdue' | 'cancelled' | 'refunded'
  external_url: string | null
  paid_at: Date | null
}

const STATUS_LABEL: Record<InvoiceRow['status'], string> = {
  pending: 'Pendente',
  paid: 'Pago',
  overdue: 'Vencido',
  cancelled: 'Cancelado',
  refunded: 'Estornado',
}

const STATUS_BADGE: Record<InvoiceRow['status'], string> = {
  pending: 'ev-portal-badge--warning',
  paid: 'ev-portal-badge--success',
  overdue: 'ev-portal-badge--danger',
  cancelled: 'ev-portal-badge',
  refunded: 'ev-portal-badge--info',
}

function formatBrl(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function formatDate(d: Date): string {
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export default async function MeuFinanceiroPage() {
  const ctx = await requireMemberOrPassport('/meu/financeiro')
  if (ctx.kind === 'passport_needs_link') {
    return <PassportNeedsLink feature="suas faturas" />
  }
  const session = ctx.claims

  const { pending, history } = await withMemberContext(session, async () => {
    const pendRes = await pool.query<InvoiceRow>(
      `SELECT id, amount_cents, due_at, status, external_url, paid_at
       FROM invoices
       WHERE member_id = $1 AND status IN ('pending', 'overdue')
       ORDER BY due_at ASC
       LIMIT 20`,
      [session.memberId],
    )
    const histRes = await pool.query<InvoiceRow>(
      `SELECT id, amount_cents, due_at, status, external_url, paid_at
       FROM invoices
       WHERE member_id = $1 AND status NOT IN ('pending', 'overdue')
       ORDER BY COALESCE(paid_at, due_at) DESC
       LIMIT 10`,
      [session.memberId],
    )
    return { pending: pendRes.rows, history: histRes.rows }
  })

  const totalPending = pending.reduce((acc, i) => acc + i.amount_cents, 0)

  return (
    <div className="ev-portal-page">
      <header>
        <h1 className="ev-portal-h1">Financeiro</h1>
        <p className="ev-portal-muted">Suas cobranças e pagamentos.</p>
      </header>

      {pending.length > 0 ? (
        <div className="ev-portal-callout ev-portal-callout--warning">
          <h2 className="ev-portal-h2">{formatBrl(totalPending)} em aberto</h2>
          <p>
            {pending.length} {pending.length === 1 ? 'cobrança pendente' : 'cobranças pendentes'}.
          </p>
        </div>
      ) : null}

      <section className="ev-portal-section">
        <h2 className="ev-portal-h2">Pendentes</h2>
        {pending.length === 0 ? (
          <div className="ev-portal-empty">Nenhuma cobrança em aberto.</div>
        ) : (
          <ul className="ev-portal-list">
            {pending.map((i) => (
              <li key={i.id} className="ev-portal-list-item">
                <div className="ev-portal-list-item--row">
                  <div>
                    <div className="ev-portal-h3">{formatBrl(i.amount_cents)}</div>
                    <div className="ev-portal-muted">Vence em {formatDate(i.due_at)}</div>
                  </div>
                  <span className={`ev-portal-badge ${STATUS_BADGE[i.status]}`}>
                    {STATUS_LABEL[i.status]}
                  </span>
                </div>
                <Link href={`/meu/financeiro/pagar/${i.id}`} className="ev-portal-button">
                  Pagar agora
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {history.length > 0 ? (
        <section className="ev-portal-section">
          <h2 className="ev-portal-h2">Histórico</h2>
          <ul className="ev-portal-list">
            {history.map((i) => (
              <li key={i.id} className="ev-portal-list-item ev-portal-list-item--row">
                <div>
                  <div className="ev-portal-h3">{formatBrl(i.amount_cents)}</div>
                  <div className="ev-portal-muted">
                    {i.paid_at ? `Pago em ${formatDate(i.paid_at)}` : formatDate(i.due_at)}
                  </div>
                </div>
                <span className={`ev-portal-badge ${STATUS_BADGE[i.status]}`}>
                  {STATUS_LABEL[i.status]}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <Link href="/meu/recibos" className="ev-portal-button ev-portal-button--ghost">
        Ver todos os recibos
      </Link>
    </div>
  )
}
