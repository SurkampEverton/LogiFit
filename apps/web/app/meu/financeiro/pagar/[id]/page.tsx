import { pool } from '@repo/db/client'
import Link from 'next/link'
/**
 * /meu/financeiro/pagar/[id] — checkout Asaas. Sprint 26 Faixa C (26b).
 *
 * Server Component: busca invoice + valida ownership + redireciona pro
 * `external_url` Asaas (se já gerado) OU informa que checkout vai ser
 * regerado por job D-5 (Sprint 04).
 *
 * Sprint 26c (futuro): integrar Asaas checkout embed (iframe) ao invés de
 * redirect — exige ADR 0088 §checkout-embed.
 */
import { redirect } from 'next/navigation'
import { requireMemberSession, withMemberContext } from '../../../../lib/member-session'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ id: string }>
}

interface InvoiceRow {
  id: string
  amount_cents: number
  due_at: Date
  status: string
  external_url: string | null
}

function formatBrl(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function formatDate(d: Date): string {
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export default async function PagarInvoicePage({ params }: Props) {
  const { id } = await params
  const session = await requireMemberSession(`/meu/financeiro/pagar/${id}`)

  const invoice = await withMemberContext(session, async () => {
    const r = await pool.query<InvoiceRow>(
      `SELECT id, amount_cents, due_at, status, external_url
       FROM invoices
       WHERE id = $1 AND member_id = $2
       LIMIT 1`,
      [id, session.memberId],
    )
    return r.rows[0] ?? null
  })

  if (!invoice) {
    return (
      <div className="ev-portal-page">
        <h1 className="ev-portal-h1">Cobrança não encontrada</h1>
        <Link href="/meu/financeiro" className="ev-portal-button ev-portal-button--ghost">
          Voltar
        </Link>
      </div>
    )
  }

  if (invoice.status === 'paid') {
    return (
      <div className="ev-portal-page">
        <div className="ev-portal-callout ev-portal-callout--success">
          <h1 className="ev-portal-h1">Esta cobrança já foi paga</h1>
          <p>Você pode baixar o recibo em /meu/recibos.</p>
        </div>
        <Link href="/meu/recibos" className="ev-portal-button">
          Ver recibos
        </Link>
        <Link href="/meu/financeiro" className="ev-portal-button ev-portal-button--ghost">
          Voltar
        </Link>
      </div>
    )
  }

  // Redireciona pro Asaas se URL existir
  if (invoice.external_url) {
    redirect(invoice.external_url)
  }

  return (
    <div className="ev-portal-page">
      <header>
        <h1 className="ev-portal-h1">Pagamento</h1>
      </header>

      <div className="ev-portal-list-item">
        <div className="ev-portal-list-item--row">
          <div>
            <div className="ev-portal-h2">{formatBrl(invoice.amount_cents)}</div>
            <div className="ev-portal-muted">Vence em {formatDate(invoice.due_at)}</div>
          </div>
        </div>
      </div>

      <div className="ev-portal-callout">
        <h2 className="ev-portal-h2">Link de pagamento sendo gerado</h2>
        <p>
          Seu link Asaas (PIX/cartão/boleto) está sendo gerado e ficará disponível em alguns
          minutos. Recarregue esta página em instantes ou aguarde o lembrete por email/WhatsApp.
        </p>
      </div>

      <Link href="/meu/financeiro" className="ev-portal-button ev-portal-button--ghost">
        Voltar
      </Link>
    </div>
  )
}
