import { pool } from '@repo/db/client'
/**
 * /meu/recibos — recibos / comprovantes pagos. Sprint 26 Faixa C (26b).
 *
 * Lista invoices status=paid com link de download. Sprint 26c: gerar PDF
 * via @react-pdf/renderer com timbre do tenant + assinatura digital opcional.
 */
import Link from 'next/link'
import { withMemberContext } from '../../lib/member-session'
import { requireMemberOrPassport } from '../../lib/require-member-or-passport'
import { PassportNeedsLink } from '../_components/passport-needs-link'

export const dynamic = 'force-dynamic'

interface ReceiptRow {
  id: string
  amount_cents: number
  paid_at: Date
  external_url: string | null
  asaas_id: string | null
}

function formatBrl(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function formatDate(d: Date): string {
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export default async function RecibosPage() {
  const ctx = await requireMemberOrPassport('/meu/recibos')
  if (ctx.kind === 'passport_needs_link') {
    return <PassportNeedsLink feature="seus recibos" />
  }
  const session = ctx.claims

  const receipts = await withMemberContext(session, async () => {
    const r = await pool.query<ReceiptRow>(
      `SELECT id, amount_cents, paid_at, external_url, asaas_id
       FROM invoices
       WHERE member_id = $1 AND status = 'paid' AND paid_at IS NOT NULL
       ORDER BY paid_at DESC
       LIMIT 50`,
      [session.memberId],
    )
    return r.rows
  })

  return (
    <div className="ev-portal-page">
      <header>
        <h1 className="ev-portal-h1">Recibos</h1>
        <p className="ev-portal-muted">Comprovantes dos seus pagamentos.</p>
      </header>

      {receipts.length === 0 ? (
        <div className="ev-portal-empty">Você ainda não tem recibos.</div>
      ) : (
        <ul className="ev-portal-list">
          {receipts.map((r) => (
            <li key={r.id} className="ev-portal-list-item ev-portal-list-item--row">
              <div>
                <div className="ev-portal-h3">{formatBrl(r.amount_cents)}</div>
                <div className="ev-portal-muted">Pago em {formatDate(r.paid_at)}</div>
              </div>
              {r.external_url ? (
                <a
                  href={r.external_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ev-portal-button ev-portal-button--ghost"
                >
                  Baixar
                </a>
              ) : (
                <span className="ev-portal-badge">PDF em breve</span>
              )}
            </li>
          ))}
        </ul>
      )}

      <Link href="/meu/financeiro" className="ev-portal-button ev-portal-button--ghost">
        Voltar
      </Link>
    </div>
  )
}
