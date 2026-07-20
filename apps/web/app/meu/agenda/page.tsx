import { pool } from '@repo/db/client'
/**
 * /meu/agenda — agenda do paciente. Sprint 26 Faixa C (26b).
 *
 * Lista próximos agendamentos (status booked/checked_in) + histórico recente.
 * Botão "Cancelar" chama `cancelMyAppointment` (respeita política por vertical).
 * Botão "Agendar novo" leva pra `/meu/agenda/novo`.
 *
 * RLS member: SELECT em appointments WHERE member_id = current_setting('app.member_id').
 */
import Link from 'next/link'
import { withMemberContext } from '../../lib/member-session'
import { requireMemberOrPassport } from '../../lib/require-member-or-passport'
import { PassportNeedsLink } from '../_components/passport-needs-link'
import { CancelButton } from './cancel-button'

export const dynamic = 'force-dynamic'

interface AppointmentRow {
  id: string
  starts_at: Date
  ends_at: Date
  status: 'booked' | 'checked_in' | 'cancelled' | 'no_show' | 'completed'
  resource_name: string | null
  resource_kind: 'instrutor' | 'sala' | 'equipamento' | null
}

const STATUS_LABEL: Record<AppointmentRow['status'], string> = {
  booked: 'Agendado',
  checked_in: 'Em andamento',
  cancelled: 'Cancelado',
  no_show: 'Não compareceu',
  completed: 'Concluído',
}

const STATUS_BADGE: Record<AppointmentRow['status'], string> = {
  booked: 'ev-portal-badge--info',
  checked_in: 'ev-portal-badge--success',
  cancelled: 'ev-portal-badge--danger',
  no_show: 'ev-portal-badge--warning',
  completed: 'ev-portal-badge',
}

function formatBr(d: Date): string {
  return d.toLocaleString('pt-BR', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default async function MeuAgendaPage() {
  const ctx = await requireMemberOrPassport('/meu/agenda')
  if (ctx.kind === 'passport_needs_link') {
    return <PassportNeedsLink feature="sua agenda" />
  }
  const session = ctx.claims

  const { upcoming, past } = await withMemberContext(session, async () => {
    const upRes = await pool.query<AppointmentRow>(
      `SELECT a.id, a.starts_at, a.ends_at, a.status,
              r.name AS resource_name, r.kind AS resource_kind
       FROM appointments a
       LEFT JOIN resources r ON r.id = a.resource_id
       WHERE a.member_id = $1
         AND a.starts_at >= now() - interval '1 hour'
         AND a.status IN ('booked', 'checked_in')
       ORDER BY a.starts_at ASC
       LIMIT 20`,
      [session.memberId],
    )
    const pastRes = await pool.query<AppointmentRow>(
      `SELECT a.id, a.starts_at, a.ends_at, a.status,
              r.name AS resource_name, r.kind AS resource_kind
       FROM appointments a
       LEFT JOIN resources r ON r.id = a.resource_id
       WHERE a.member_id = $1
         AND (a.starts_at < now() - interval '1 hour' OR a.status NOT IN ('booked', 'checked_in'))
       ORDER BY a.starts_at DESC
       LIMIT 10`,
      [session.memberId],
    )
    return { upcoming: upRes.rows, past: pastRes.rows }
  })

  return (
    <div className="ev-portal-page">
      <header className="ev-portal-section">
        <h1 className="ev-portal-h1">Sua agenda</h1>
        <Link href="/meu/agenda/novo" className="ev-portal-button">
          + Agendar novo
        </Link>
      </header>

      <section className="ev-portal-section">
        <h2 className="ev-portal-h2">Próximos</h2>
        {upcoming.length === 0 ? (
          <div className="ev-portal-empty">
            Você não tem agendamentos próximos. <Link href="/meu/agenda/novo">Agendar agora</Link>.
          </div>
        ) : (
          <ul className="ev-portal-list">
            {upcoming.map((a) => (
              <li key={a.id} className="ev-portal-list-item">
                <div className="ev-portal-list-item--row">
                  <div>
                    <div className="ev-portal-h3">{formatBr(a.starts_at)}</div>
                    <div className="ev-portal-muted">
                      {a.resource_name ?? 'Recurso não informado'}
                      {a.resource_kind ? ` · ${a.resource_kind}` : ''}
                    </div>
                  </div>
                  <span className={`ev-portal-badge ${STATUS_BADGE[a.status]}`}>
                    {STATUS_LABEL[a.status]}
                  </span>
                </div>
                {a.status === 'booked' ? <CancelButton appointmentId={a.id} /> : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {past.length > 0 ? (
        <section className="ev-portal-section">
          <h2 className="ev-portal-h2">Histórico</h2>
          <ul className="ev-portal-list">
            {past.map((a) => (
              <li key={a.id} className="ev-portal-list-item ev-portal-list-item--row">
                <div>
                  <div className="ev-portal-h3">{formatBr(a.starts_at)}</div>
                  <div className="ev-portal-muted">{a.resource_name ?? '—'}</div>
                </div>
                <span className={`ev-portal-badge ${STATUS_BADGE[a.status]}`}>
                  {STATUS_LABEL[a.status]}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}
