/**
 * /meu/perfil — dados cadastrais + sessões + senha + MFA + LGPD.
 *
 * Sprint 26 Faixa C (member_session legacy) + **Sprint 02b4 (passport
 * identity global ADR 0094)** — suporta ambas via `getActiveSession()`:
 *
 *   - `kind: 'member'`: dados via persons JOIN members + sessions via
 *     member_sessions (Sprint 26 comportamento atual preservado)
 *   - `kind: 'passport'`: dados via passport_global_identities +
 *     sessions via passport_global_sessions + forms:
 *       - ChangePasswordForm (requireMfa)
 *       - RegenerateRecoveryCodesButton (requireMfa)
 *       - DeactivateAccountForm (requireMfa 5min)
 *       - PassportSessionRevokeButton (requireMfa) por session ativa
 */
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { pool } from '@repo/db/client'
import { getActiveSession } from '../../lib/active-session'
import { withMemberContext } from '../../lib/member-session'
import { ChangePasswordForm } from './change-password-form'
import { DeactivateAccountForm } from './deactivate-account-form'
import { LogoutButton } from './logout-button'
import { PassportSessionRevokeButton } from './passport-session-revoke-button'
import { RegenerateRecoveryCodesButton } from './regenerate-recovery-codes-button'
import { RevokeSessionButton } from './revoke-session-button'

export const dynamic = 'force-dynamic'

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

function maskCpfFromNormalized(cpf: string | null): string | null {
  if (!cpf || cpf.length !== 11) return null
  return `***.***.***-${cpf.slice(-2)}`
}

export default async function MeuPerfilPage() {
  const session = await getActiveSession()
  if (!session) redirect('/meu/login')

  // ─── kind: 'passport' (Sprint 02b4) ───────────────────────────────
  if (session.kind === 'passport') {
    const idRes = await pool.query<{
      name: string
      email: string
      phone: string
      cpf_normalized: string
      mfa_enrolled_at: Date | null
      created_at: Date
      last_login_at: Date | null
    }>(
      `SELECT name, email, phone, cpf_normalized, mfa_enrolled_at, created_at, last_login_at
       FROM passport_global_identities WHERE id = $1 LIMIT 1`,
      [session.passport.passportGlobalId],
    )
    const identity = idRes.rows[0]
    if (!identity) redirect('/meu/login')

    const sessRes = await pool.query<{
      id: string
      device_label: string | null
      ip: string | null
      created_at: Date
      last_seen_at: Date
      mfa_verified_at: Date | null
    }>(
      `SELECT id, device_label, ip, created_at, last_seen_at, mfa_verified_at
       FROM passport_global_sessions
       WHERE passport_global_identity_id = $1
         AND revoked_at IS NULL
         AND expires_at > now()
       ORDER BY last_seen_at DESC
       LIMIT 20`,
      [session.passport.passportGlobalId],
    )

    return (
      <div className="ev-portal-page">
        <header>
          <h1 className="ev-portal-h1">Seu perfil</h1>
          <p className="ev-portal-muted" style={{ fontSize: 'var(--ev-text-sm)' }}>
            Identidade global LogiFit — única conta pra todas empresas parceiras.
          </p>
        </header>

        <section className="ev-portal-section">
          <h2 className="ev-portal-h2">Dados cadastrais</h2>
          <div className="ev-portal-list-item">
            <div>
              <div className="ev-portal-muted">Nome</div>
              <div className="ev-portal-h3">{identity.name}</div>
            </div>
          </div>
          <div className="ev-portal-list-item">
            <div>
              <div className="ev-portal-muted">Email</div>
              <div>{identity.email}</div>
            </div>
          </div>
          <div className="ev-portal-list-item">
            <div>
              <div className="ev-portal-muted">Telefone</div>
              <div>{identity.phone}</div>
            </div>
          </div>
          <div className="ev-portal-list-item">
            <div>
              <div className="ev-portal-muted">CPF</div>
              <div>{maskCpfFromNormalized(identity.cpf_normalized) ?? '—'}</div>
            </div>
          </div>
          <p className="ev-portal-muted" style={{ fontSize: 'var(--ev-text-xs)' }}>
            Alterar nome/email/telefone entra em Sprint 02b5 (changeEmail exige
            email confirmation flow via AWS SES).
          </p>
        </section>

        <section className="ev-portal-section">
          <h2 className="ev-portal-h2">Segurança</h2>
          <div className="ev-portal-list-item">
            <div>
              <div className="ev-portal-muted">MFA (autenticação 2 fatores)</div>
              {identity.mfa_enrolled_at ? (
                <div style={{ color: 'var(--ev-success)' }}>
                  ✓ Ativo desde {formatDate(identity.mfa_enrolled_at)}
                </div>
              ) : (
                <div style={{ color: 'var(--ev-warning)' }}>
                  ⚠ Não ativado —{' '}
                  <Link href="/cadastro/mfa-setup">ativar agora</Link>
                </div>
              )}
            </div>
          </div>

          {identity.mfa_enrolled_at ? (
            <div style={{ marginTop: 'var(--ev-space-md)' }}>
              <RegenerateRecoveryCodesButton />
            </div>
          ) : null}

          <div style={{ marginTop: 'var(--ev-space-md)' }}>
            <h3 style={{ fontSize: 'var(--ev-text-base)' }}>Trocar senha</h3>
            <ChangePasswordForm />
          </div>
        </section>

        <section className="ev-portal-section">
          <h2 className="ev-portal-h2">Dispositivos ativos ({sessRes.rows.length})</h2>
          {sessRes.rows.length === 0 ? (
            <div className="ev-portal-empty">Nenhuma sessão ativa.</div>
          ) : (
            <ul className="ev-portal-list">
              {sessRes.rows.map((s) => {
                const isCurrent = s.id === session.passport.sessionId
                return (
                  <li key={s.id} className="ev-portal-list-item">
                    <div className="ev-portal-list-item--row">
                      <div>
                        <div className="ev-portal-h3">
                          {s.device_label ?? 'Dispositivo'}
                        </div>
                        <div
                          className="ev-portal-muted"
                          style={{ fontSize: 'var(--ev-text-xs)' }}
                        >
                          Ativo até {formatDate(s.last_seen_at)}
                          {s.ip ? ` · IP ${s.ip}` : ''}
                          {s.mfa_verified_at ? ' · 🔐 MFA verificado' : ''}
                        </div>
                      </div>
                      {isCurrent ? (
                        <span className="ev-portal-badge ev-portal-badge--success">
                          Atual
                        </span>
                      ) : (
                        <PassportSessionRevokeButton
                          sessionId={s.id}
                          deviceLabel={s.device_label}
                        />
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        <section className="ev-portal-section">
          <h2 className="ev-portal-h2">Privacidade</h2>
          <Link
            href="/meu/privacidade"
            className="ev-portal-button ev-portal-button--ghost"
          >
            Configurar consents e direitos LGPD
          </Link>
        </section>

        <section className="ev-portal-section">
          <h2 className="ev-portal-h2" style={{ color: 'var(--ev-danger)' }}>
            Zona de perigo
          </h2>
          <DeactivateAccountForm email={identity.email} />
        </section>

        <LogoutButton />

        <p
          style={{
            marginTop: 'var(--ev-space-lg)',
            fontSize: 'var(--ev-text-xs)',
            color: 'var(--ev-text-muted)',
          }}
        >
          ℹ️ Sessão criada em {formatDate(identity.created_at)}.
          {identity.last_login_at
            ? ` Último login: ${formatDate(identity.last_login_at)}.`
            : ''}
        </p>
      </div>
    )
  }

  // ─── kind: 'member' (Sprint 26 legacy — magic link) ───────────────
  const memberSession = session.member
  const { person, sessions } = await withMemberContext(memberSession, async () => {
    const personRes = await pool.query<{
      name: string
      email: string | null
      phone: string | null
      document: string | null
    }>(
      `SELECT p.name, p.email, p.phone, p.document
       FROM members m
       JOIN persons p ON p.id = m.person_id
       WHERE m.id = $1 LIMIT 1`,
      [memberSession.memberId],
    )
    const sessRes = await pool.query<{
      id: string
      device_label: string | null
      user_agent: string | null
      created_ip: string | null
      last_seen_at: Date
      created_at: Date
      is_current: boolean
    }>(
      `SELECT id, device_label, user_agent, created_ip, last_seen_at, created_at,
              (id = $2) AS is_current
       FROM member_sessions
       WHERE member_id = $1 AND revoked_at IS NULL AND expires_at > now()
       ORDER BY last_seen_at DESC
       LIMIT 10`,
      [memberSession.memberId, memberSession.sessionId],
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
                      Ativo até {formatDate(s.last_seen_at)} · IP{' '}
                      {s.created_ip ?? '—'}
                    </div>
                  </div>
                  {s.is_current ? (
                    <span className="ev-portal-badge ev-portal-badge--success">
                      Atual
                    </span>
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
