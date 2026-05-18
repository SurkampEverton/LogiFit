/**
 * /meu/alertas — paciente vê alertas de lesão envolvendo ele (Sprint 27 Faixa C).
 *
 * Lista `member_injury_alerts` próprios + status da adaptação relacionada.
 * RLS member: `member_id = current_setting('app.member_id')`.
 */
import Link from 'next/link'
import { pool } from '@repo/db/client'
import { requireMemberSession, withMemberContext } from '../../lib/member-session'

export const dynamic = 'force-dynamic'

interface AlertRow {
  id: string
  primary_cid_code: string
  cid_description: string | null
  status: string
  blocked_reason: string | null
  created_at: Date
  adaptation_status: string | null
  adaptation_summary: string | null
}

const STATUS_LABEL: Record<string, string> = {
  pending_review: 'Aguardando seu instrutor revisar',
  accepted: 'Aplicado — sua ficha foi adaptada',
  rejected: 'Decisão clínica: ficha original mantida',
  expired: 'Expirado sem revisão',
  blocked: 'Não aplicado',
}

const STATUS_BADGE: Record<string, string> = {
  pending_review: 'ev-portal-badge--warning',
  accepted: 'ev-portal-badge--success',
  rejected: 'ev-portal-badge',
  expired: 'ev-portal-badge',
  blocked: 'ev-portal-badge--info',
}

function formatDate(d: Date): string {
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export default async function MeuAlertasPage() {
  const session = await requireMemberSession('/meu/alertas')

  const rows = await withMemberContext(session, async () => {
    const r = await pool.query<AlertRow>(
      `SELECT
         a.id,
         a.primary_cid_code,
         c.description AS cid_description,
         a.status,
         a.blocked_reason,
         a.created_at,
         wa.status AS adaptation_status,
         (wa.changes ->> 'summary') AS adaptation_summary
       FROM member_injury_alerts a
       LEFT JOIN cid_catalog c ON c.code = a.primary_cid_code
       LEFT JOIN workout_adaptations wa ON wa.alert_id = a.id
       WHERE a.member_id = $1
         AND a.status != 'blocked'  -- paciente não vê eventos bloqueados (audit interno)
       ORDER BY a.created_at DESC
       LIMIT 30`,
      [session.memberId],
    )
    return r.rows
  })

  return (
    <div className="ev-portal-page">
      <header>
        <h1 className="ev-portal-h1">Alertas de lesão</h1>
        <p className="ev-portal-muted">
          Quando um profissional registra uma lesão sua, podemos adaptar seu treino
          automaticamente. Você vê aqui tudo que envolve sua ficha — quem prescreveu o quê e
          como foi resolvido.
        </p>
      </header>

      {rows.length === 0 ? (
        <div className="ev-portal-callout ev-portal-callout--success">
          <p>Nenhum alerta de lesão registrado. Continue treinando bem!</p>
        </div>
      ) : (
        <ol className="ev-portal-timeline">
          {rows.map((a) => (
            <li key={a.id} className="ev-portal-timeline-item">
              <div className="ev-portal-h3">
                {a.cid_description ?? a.primary_cid_code}
              </div>
              <div className="ev-portal-muted">
                Registrado em {formatDate(a.created_at)} · CID{' '}
                <code>{a.primary_cid_code}</code>
              </div>
              <span
                className={`ev-portal-badge ${STATUS_BADGE[a.status] ?? 'ev-portal-badge'}`}
                style={{ marginTop: 8 }}
              >
                {STATUS_LABEL[a.status] ?? a.status}
              </span>
              {a.adaptation_summary ? (
                <p style={{ marginTop: 8 }}>{a.adaptation_summary}</p>
              ) : null}
            </li>
          ))}
        </ol>
      )}

      <Link href="/meu/treino" className="ev-portal-button ev-portal-button--ghost">
        Ver minha ficha
      </Link>
    </div>
  )
}
