/**
 * /meu — home do portal do paciente.
 *
 * Sprint 26 Faixa C (member_session magic link) + **Sprint 02b3 (ADR 0094 —
 * passport_global_session)** — suporta ambas sessions via `getActiveSession()`
 * orchestrator:
 *
 *   - `kind: 'member'` (legacy Sprint 26): paciente vinculado a 1 tenant clínico
 *     via magic link → dashboard com cards específicos (agenda + financeiro +
 *     treino + QR + privacidade + perfil)
 *
 *   - `kind: 'passport'` (Sprint 02b3): paciente fez cadastro proativo `/cadastro`
 *     ou veio de invite `/i/[token]` → dashboard global resolvendo:
 *       - identity via passport_global_identities (greeting + email + phone)
 *       - vínculos via patient_company_links + tenants (lista empresas linkadas)
 *       - Se 0 vínculos: CTA "Convidar profissional/empresa" (Sprint 02b4 ativo)
 *       - Se 1+ vínculos: lista + "tenant switching" entre eles (Sprint 02b4
 *         picker com cookie `lf_passport_active_tenant`)
 *
 * Migration Fase 1 (ADR 0094) — coexistência: novos signups proativos passport;
 * pacientes legacy magic link continuam member_session. Sem session → /meu/login.
 */
import { redirect } from 'next/navigation'
import { pool } from '@repo/db/client'
import Link from 'next/link'
import { getActiveSession } from '../lib/active-session'

export const dynamic = 'force-dynamic'

interface PassportSummary {
  name: string
  email: string
  mfaEnrolled: boolean
  linkedTenants: Array<{
    tenantId: string
    tenantName: string
    linkId: string
    activeModules: number
  }>
}

async function loadPassportSummary(passportGlobalId: string): Promise<PassportSummary | null> {
  const idRes = await pool.query<{
    name: string
    email: string
    mfa_enrolled_at: Date | null
  }>(
    `SELECT name, email, mfa_enrolled_at
     FROM passport_global_identities
     WHERE id = $1
     LIMIT 1`,
    [passportGlobalId],
  )
  const identity = idRes.rows[0]
  if (!identity) return null

  const linksRes = await pool.query<{
    tenant_id: string
    tenant_name: string
    link_id: string
    active_modules: string
  }>(
    `SELECT pcl.tenant_id, t.name AS tenant_name, pcl.id AS link_id,
            (SELECT count(*) FROM patient_link_modules plm
              WHERE plm.link_id = pcl.id AND plm.status = 'active'
                AND plm.deactivated_at IS NULL)::text AS active_modules
     FROM patient_company_links pcl
     INNER JOIN tenants t ON t.id = pcl.tenant_id
     WHERE pcl.passport_passport_id = $1
       AND pcl.status = 'active'
       AND pcl.revoked_at IS NULL
     ORDER BY pcl.accepted_at DESC NULLS LAST
     LIMIT 50`,
    [passportGlobalId],
  )

  return {
    name: identity.name,
    email: identity.email,
    mfaEnrolled: identity.mfa_enrolled_at !== null,
    linkedTenants: linksRes.rows.map((r) => ({
      tenantId: r.tenant_id,
      tenantName: r.tenant_name,
      linkId: r.link_id,
      activeModules: Number.parseInt(r.active_modules, 10),
    })),
  }
}

export default async function MyHomePage() {
  const session = await getActiveSession()
  if (!session) {
    redirect('/meu/login')
  }

  // ─── kind: 'passport' (Sprint 02b3 — identity global) ─────────────
  if (session.kind === 'passport') {
    const summary = await loadPassportSummary(session.passport.passportGlobalId)
    if (!summary) {
      // Identity sumiu — força login
      redirect('/meu/login')
    }
    const firstName = summary.name.split(' ')[0]

    return (
      <div className="ev-portal-page">
        <h1 className="ev-portal-h1">Olá, {firstName}!</h1>
        <p className="ev-portal-muted">
          Seu portal LogiFit — identidade global, vínculos com empresas parceiras.
        </p>

        {!summary.mfaEnrolled ? (
          <section
            className="ev-portal-callout"
            style={{
              padding: 'var(--ev-space-md)',
              background: 'var(--ev-warning-soft, var(--ev-surface-muted))',
              borderLeft: '4px solid var(--ev-warning)',
              borderRadius: 'var(--ev-radius-sm)',
              marginBottom: 'var(--ev-space-md)',
            }}
          >
            <h3 style={{ marginTop: 0 }}>🔐 Ative autenticação em 2 fatores</h3>
            <p style={{ fontSize: 'var(--ev-text-sm)' }}>
              Proteja sua conta contra acesso indevido — pode levar 2 minutos.
            </p>
            <Link href="/cadastro/mfa-setup" className="ev-portal-button">
              Ativar agora
            </Link>
          </section>
        ) : null}

        <section style={{ marginTop: 'var(--ev-space-lg)' }}>
          <h2>Empresas vinculadas ({summary.linkedTenants.length})</h2>
          {summary.linkedTenants.length === 0 ? (
            <div className="ev-portal-callout" style={{ padding: 'var(--ev-space-md)' }}>
              <p style={{ fontSize: 'var(--ev-text-sm)' }}>
                Você ainda não está vinculado a nenhuma empresa LogiFit. Quando
                receber convite por WhatsApp/email, abra o link <code>/i/[token]</code>
                pra aceitar — ou peça pra sua academia/clínica enviar convite.
              </p>
              <p style={{ fontSize: 'var(--ev-text-xs)', color: 'var(--ev-text-muted)' }}>
                Sprint 02b4 ativa "Convidar profissional/empresa" via{' '}
                <code>/meu/convidar</code>.
              </p>
            </div>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 'var(--ev-space-2)' }}>
              {summary.linkedTenants.map((t) => (
                <li
                  key={t.linkId}
                  className="ev-portal-card"
                  style={{
                    padding: 'var(--ev-space-md)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <div>
                    <strong>{t.tenantName}</strong>
                    <div style={{ fontSize: 'var(--ev-text-xs)', color: 'var(--ev-text-muted)' }}>
                      {t.activeModules} módulo(s) ativo(s)
                    </div>
                  </div>
                  <span style={{ fontSize: 'var(--ev-text-xs)', color: 'var(--ev-text-muted)' }}>
                    Sprint 02b4 ativa picker tenant
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="ev-portal-card-grid" style={{ marginTop: 'var(--ev-space-lg)' }}>
          <Link href="/meu/privacidade" className="ev-portal-card">
            <div className="ev-portal-card-icon">🔒</div>
            <div className="ev-portal-card-title">Privacidade</div>
            <div className="ev-portal-card-desc">Compartilhamento + acessos</div>
          </Link>
          <Link href="/meu/perfil" className="ev-portal-card">
            <div className="ev-portal-card-icon">👤</div>
            <div className="ev-portal-card-title">Perfil</div>
            <div className="ev-portal-card-desc">{summary.email}</div>
          </Link>
        </section>

        <p
          style={{
            marginTop: 'var(--ev-space-lg)',
            fontSize: 'var(--ev-text-xs)',
            color: 'var(--ev-text-muted)',
          }}
        >
          ⚠ Sprint 02b3 partial — dashboard passport básico. Sprint 02b4 adiciona
          tenant picker + cards específicos por tenant ativo (agenda + financeiro +
          treino + QR) + /meu/convidar (convite inverso).
        </p>
      </div>
    )
  }

  // ─── kind: 'member' (legacy Sprint 26 — magic link) ───────────────
  const memberSession = session.member
  const r = await pool.query<{ name: string }>(
    `SELECT p.name FROM members m
     JOIN persons p ON p.id = m.person_id
     WHERE m.id = $1 LIMIT 1`,
    [memberSession.memberId],
  )
  const name = r.rows[0]?.name?.split(' ')[0] ?? ''

  return (
    <div className="ev-portal-page">
      <h1 className="ev-portal-h1">Olá, {name}!</h1>
      <p className="ev-portal-muted">Bem-vindo ao seu portal LogiFit.</p>

      <section className="ev-portal-card-grid">
        <Link href="/meu/agenda" className="ev-portal-card">
          <div className="ev-portal-card-icon">📅</div>
          <div className="ev-portal-card-title">Agenda</div>
          <div className="ev-portal-card-desc">Próximos agendamentos</div>
        </Link>
        <Link href="/meu/financeiro" className="ev-portal-card">
          <div className="ev-portal-card-icon">💳</div>
          <div className="ev-portal-card-title">Financeiro</div>
          <div className="ev-portal-card-desc">Cobranças e recibos</div>
        </Link>
        <Link href="/meu/treino" className="ev-portal-card">
          <div className="ev-portal-card-icon">💪</div>
          <div className="ev-portal-card-title">Treino</div>
          <div className="ev-portal-card-desc">Sua ficha atual</div>
        </Link>
        <Link href="/meu/qr" className="ev-portal-card">
          <div className="ev-portal-card-icon">📱</div>
          <div className="ev-portal-card-title">QR Acesso</div>
          <div className="ev-portal-card-desc">Catraca</div>
        </Link>
        <Link href="/meu/privacidade" className="ev-portal-card">
          <div className="ev-portal-card-icon">🔒</div>
          <div className="ev-portal-card-title">Privacidade</div>
          <div className="ev-portal-card-desc">Seus dados</div>
        </Link>
        <Link href="/meu/perfil" className="ev-portal-card">
          <div className="ev-portal-card-icon">👤</div>
          <div className="ev-portal-card-title">Perfil</div>
          <div className="ev-portal-card-desc">Dados cadastrais</div>
        </Link>
      </section>
    </div>
  )
}
