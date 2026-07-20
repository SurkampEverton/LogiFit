import { pool } from '@repo/db/client'
/**
 * /meu/exames — paciente vê próprios exames. Sprint 33 Faixa C.
 */
import Link from 'next/link'
import { withMemberContext } from '../../lib/member-session'
import { requireMemberOrPassport } from '../../lib/require-member-or-passport'
import { PassportNeedsLink } from '../_components/passport-needs-link'

export const dynamic = 'force-dynamic'

interface ExamRow {
  id: string
  status: string
  exam_type_detected: string | null
  laboratory: string | null
  uploaded_at: Date
  reviewed_at: Date | null
}

const STATUS_LABEL: Record<string, string> = {
  uploaded: 'Recebido — aguardando análise',
  processing: 'Em análise pela IA',
  pending_review: 'Aguardando seu profissional',
  published: '✓ Analisado e adicionado ao histórico',
  rejected: 'Não pôde ser analisado',
  failed: 'Erro técnico — re-enviar',
}

const STATUS_BADGE: Record<string, string> = {
  uploaded: 'ev-portal-badge--warning',
  processing: 'ev-portal-badge--warning',
  pending_review: 'ev-portal-badge--info',
  published: 'ev-portal-badge--success',
  rejected: 'ev-portal-badge--danger',
  failed: 'ev-portal-badge--danger',
}

function formatDate(d: Date | null): string {
  if (!d) return '—'
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export default async function MeuExamesPage() {
  const ctx = await requireMemberOrPassport('/meu/exames')
  if (ctx.kind === 'passport_needs_link') {
    return <PassportNeedsLink feature="seus exames" />
  }
  const session = ctx.claims

  const exams = await withMemberContext(session, async () => {
    const r = await pool.query<ExamRow>(
      `SELECT id, status::text AS status, exam_type_detected, laboratory,
              uploaded_at, reviewed_at
       FROM exam_documents
       WHERE member_id = $1
       ORDER BY uploaded_at DESC
       LIMIT 50`,
      [session.memberId],
    )
    return r.rows
  })

  return (
    <div className="ev-portal-page">
      <header className="ev-portal-section">
        <h1 className="ev-portal-h1">Meus exames</h1>
        <Link href="/meu/exames/upload" className="ev-portal-button">
          + Enviar exame
        </Link>
      </header>

      {exams.length === 0 ? (
        <div className="ev-portal-empty">
          Você ainda não enviou nenhum exame laboratorial.
          <br />
          Faça upload do PDF do seu laudo e a equipe avalia em até 24h.
        </div>
      ) : (
        <ul className="ev-portal-list">
          {exams.map((e) => (
            <li key={e.id} className="ev-portal-list-item">
              <div className="ev-portal-list-item--row">
                <div>
                  <div className="ev-portal-h3">{e.exam_type_detected ?? 'Exame laboratorial'}</div>
                  <div className="ev-portal-muted">
                    {e.laboratory ?? ''}
                    {e.laboratory ? ' · ' : ''}
                    Enviado em {formatDate(e.uploaded_at)}
                    {e.reviewed_at ? ` · Analisado em ${formatDate(e.reviewed_at)}` : ''}
                  </div>
                </div>
                <span
                  className={`ev-portal-badge ${STATUS_BADGE[e.status] ?? ''}`}
                  style={{ whiteSpace: 'nowrap', maxWidth: 220 }}
                >
                  {STATUS_LABEL[e.status] ?? e.status}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="ev-portal-muted" style={{ fontSize: 'var(--ev-text-xs)' }}>
        Após análise pelo profissional, os valores entram automaticamente no seu histórico. Você
        pode acompanhar a evolução em /meu/exames/historico (em breve).
      </p>
    </div>
  )
}
