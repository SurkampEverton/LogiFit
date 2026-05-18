/**
 * /meu/perfil — dados cadastrais + sessões + logout. Sprint 26 Faixa C (26b).
 *
 * Mostra:
 *   - Nome/email/telefone (read-only no MVP — edição vem Sprint 26c)
 *   - Lista de sessões ativas (revogar individual)
 *   - Botão logout
 *   - Links pra /meu/privacidade
 *
 * RLS member: persons via members.person_id; member_sessions WHERE member_id.
 */
import Link from 'next/link'
import { pool } from '@repo/db/client'
import { requireMemberSession, withMemberContext } from '../../lib/member-session'
import { LogoutButton } from './logout-button'
import { RevokeSessionButton } from './revoke-session-button'

export const dynamic = 'force-dynamic'

interface PersonRow {
  name: string
  email: string | null
  phone: string | null
  document: string | null
}

interface SessionRow {
  id: string
  device_label: string | null
  user_agent: string | null
  created_ip: string | null
  last_seen_at: Date
  created_at: Date
  is_current: boolean
}

function formatDate(d: Date): string {
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function maskDoc(doc: string | null): string | null {
  if (!doc || doc.length < 4) return doc
  return `***.***.***-${doc.slice(-2)}`
}

export default async function MeuPerfilPage() {
  const session = await requireMemberSession('/meu/perfil')

  const { person, sessions } = await withMemberContext(session, async () => {
    const personRes = await pool.query<PersonRow>(
      `SELECT p.name, p.email, p.phone, p.document
       FROM members m
       JOIN persons p ON p.id = m.person_id
       WHERE m.id = $1 LIMIT 1`,
      [session.memberId],
    )
    const sessRes = await pool.query<SessionRow>(
      `SELECT id, device_label, user_agent, created_ip, last_seen_at, created_at,
              (id = $2) AS is_current
       FROM member_sessions
       WHERE member_id = $1 AND revoked_at IS NULL AND expires_at > now()
       ORDER BY last_seen_at DESC
       LIMIT 10`,
      [session.memberId, session.sessionId],
    )
    return { person: personRes.rows[0] ?? null, sessions: sessRes.rows }
  })

  return (
    <div className="ev-portal-page">
      <header>
        <h1 className="ev-portal-h1">Seu perfil</h1>
      </header>

      <section className="ev-portal-section">
        <h2 className="ev-portal-h2">Dados cadastrais</h2>
        <div className="ev-portal-list-item">
          <div>
            <div className="ev-portal-muted">Nome</div>
            <div className="ev-portal-h3">{person?.name ?? '—'}</div>
          </div>
        </div>
        <div className="ev-portal-list-item">
          <div>
            <div className="ev-portal-muted">Email</div>
            <div>{person?.email ?? '—'}</div>
          </div>
        </div>
        <div className="ev-portal-list-item">
          <div>
            <div className="ev-portal-muted">Telefone</div>
            <div>{person?.phone ?? '—'}</div>
          </div>
        </div>
        <div className="ev-portal-list-item">
          <div>
            <div className="ev-portal-muted">Documento</div>
            <div>{maskDoc(person?.document ?? null) ?? '—'}</div>
          </div>
        </div>
        <p className="ev-portal-muted">
          Para alterar dados, fale com a recepção. A edição direta pelo portal entra em
          versão futura.
        </p>
      </section>

      <section className="ev-portal-section">
        <h2 className="ev-portal-h2">Dispositivos conectados</h2>
        {sessions.length === 0 ? (
          <div className="ev-portal-empty">Nenhuma sessão ativa.</div>
        ) : (
          <ul className="ev-portal-list">
            {sessions.map((s) => (
              <li key={s.id} className="ev-portal-list-item">
                <div className="ev-portal-list-item--row">
                  <div>
                    <div className="ev-portal-h3">
                      {s.device_label ?? s.user_agent?.slice(0, 40) ?? 'Dispositivo'}
                    </div>
                    <div className="ev-portal-muted">
                      Ativo até {formatDate(s.last_seen_at)} · IP {s.created_ip ?? '—'}
                    </div>
                  </div>
                  {s.is_current ? (
                    <span className="ev-portal-badge ev-portal-badge--success">Atual</span>
                  ) : (
                    <RevokeSessionButton sessionId={s.id} />
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="ev-portal-section">
        <h2 className="ev-portal-h2">Privacidade</h2>
        <Link href="/meu/privacidade" className="ev-portal-button ev-portal-button--ghost">
          Configurar consents e direitos LGPD
        </Link>
        <Link
          href="/meu/privacidade/compartilhamento"
          className="ev-portal-button ev-portal-button--ghost"
        >
          Compartilhamento entre estabelecimentos
        </Link>
        <Link
          href="/meu/privacidade/acessos"
          className="ev-portal-button ev-portal-button--ghost"
        >
          Quem viu meus dados
        </Link>
      </section>

      <LogoutButton />
    </div>
  )
}
