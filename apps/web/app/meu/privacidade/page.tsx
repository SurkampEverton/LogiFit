/**
 * /meu/privacidade — overview. Sprint 26 Faixa C (26b).
 *
 * Página central dos direitos LGPD art. 18 + atalhos cross-tenant ADR 0077.
 *
 * Mostra:
 *   - Toggles dos 5 consents intra-tenant (`CONSENT_CATALOG`) com impacto
 *   - Badges de "expiring_soon" / "expired" (regra 29 + Direito VII art. 18)
 *   - Cards de atalho pros 4 portais cross-tenant
 *   - Botões dos 8 direitos LGPD (cria `data_subject_requests`)
 */
import Link from 'next/link'
import { pool } from '@repo/db/client'
import { withMemberContext } from '../../lib/member-session'
import { requireMemberOrPassport } from '../../lib/require-member-or-passport'
import { PassportNeedsLink } from '../_components/passport-needs-link'
import {
  CONSENT_CATALOG,
  checkRenewalStatus,
  type ConsentPurpose,
  type ConsentRecord,
  type RenewalStatus,
} from '@repo/db/portal-member'
import { ConsentToggle } from './consent-toggle'

export const dynamic = 'force-dynamic'

interface ConsentDbRow {
  purpose: ConsentPurpose
  granted: boolean
  granted_at: Date
  revoked_at: Date | null
}

const RENEWAL_BADGE: Record<RenewalStatus, string | null> = {
  active: null,
  expiring_soon: 'ev-portal-badge--warning',
  expired: 'ev-portal-badge--danger',
  revoked: null,
}

const RENEWAL_LABEL: Record<RenewalStatus, string | null> = {
  active: null,
  expiring_soon: 'expira em breve',
  expired: 'expirado',
  revoked: null,
}

export default async function MeuPrivacidadePage() {
  const ctx = await requireMemberOrPassport('/meu/privacidade')
  if (ctx.kind === 'passport_needs_link') {
    return <PassportNeedsLink feature="sua privacidade" hideLinkButtons />
  }
  const session = ctx.claims

  const rows = await withMemberContext(session, async () => {
    const r = await pool.query<ConsentDbRow>(
      `SELECT purpose, granted, granted_at, revoked_at
       FROM member_consents
       WHERE member_id = $1
       ORDER BY granted_at DESC`,
      [session.memberId],
    )
    return r.rows
  })

  // Última row por purpose
  const latestByPurpose = new Map<ConsentPurpose, ConsentDbRow>()
  for (const row of rows) {
    if (!latestByPurpose.has(row.purpose)) latestByPurpose.set(row.purpose, row)
  }

  // Renewal status
  const consentRecords: ConsentRecord[] = Array.from(latestByPurpose.values()).map((r) => ({
    purpose: r.purpose,
    grantedAt: r.granted_at.toISOString(),
    revokedAt: r.revoked_at?.toISOString() ?? null,
  }))
  const renewalChecks = checkRenewalStatus(consentRecords)
  const renewalByPurpose = new Map(renewalChecks.map((c) => [c.purpose, c]))

  const purposes = Object.keys(CONSENT_CATALOG) as ConsentPurpose[]

  return (
    <div className="ev-portal-page">
      <header>
        <h1 className="ev-portal-h1">Privacidade e dados</h1>
        <p className="ev-portal-muted">
          Controle como seus dados são usados. LGPD art. 18 — você tem direito a confirmar,
          acessar, corrigir, anonimizar, portar, ser informado, ser informado das consequências
          e revogar consent a qualquer momento.
        </p>
      </header>

      {/* Cross-tenant cards (ADR 0077) */}
      <section className="ev-portal-section">
        <h2 className="ev-portal-h2">Compartilhamento entre estabelecimentos</h2>
        <div className="ev-portal-card-grid">
          <Link href="/meu/privacidade/compartilhamento" className="ev-portal-card">
            <div className="ev-portal-card-icon">🔗</div>
            <div className="ev-portal-card-title">Vínculos ativos</div>
            <div className="ev-portal-card-desc">Empresas que veem seus dados</div>
          </Link>
          <Link href="/meu/privacidade/acessos" className="ev-portal-card">
            <div className="ev-portal-card-icon">👁️</div>
            <div className="ev-portal-card-title">Quem viu</div>
            <div className="ev-portal-card-desc">Timeline de leituras</div>
          </Link>
          <Link href="/meu/privacidade/alertas-cruzados" className="ev-portal-card">
            <div className="ev-portal-card-icon">⚠️</div>
            <div className="ev-portal-card-title">Alertas cruzados</div>
            <div className="ev-portal-card-desc">Conflitos detectados</div>
          </Link>
          <Link href="/meu/privacidade/incidentes" className="ev-portal-card">
            <div className="ev-portal-card-icon">🛡️</div>
            <div className="ev-portal-card-title">Incidentes</div>
            <div className="ev-portal-card-desc">Notificações de segurança</div>
          </Link>
        </div>
      </section>

      {/* Consents intra-tenant */}
      <section className="ev-portal-section">
        <h2 className="ev-portal-h2">Permissões neste estabelecimento</h2>
        <p className="ev-portal-muted">
          Tudo está desligado por padrão e só ativa com seu OK. Cada toggle explica o impacto se
          você desligar (Direito VII LGPD art. 18).
        </p>
        {purposes.map((purpose) => {
          const meta = CONSENT_CATALOG[purpose]
          const current = latestByPurpose.get(purpose)
          const renewal = renewalByPurpose.get(purpose)
          const isGranted = current?.granted === true && current?.revoked_at === null
          const badgeClass = renewal ? RENEWAL_BADGE[renewal.status] : null
          const badgeLabel = renewal ? RENEWAL_LABEL[renewal.status] : null
          return (
            <div key={purpose} className="ev-portal-toggle-row">
              <div className="ev-portal-toggle-row__text">
                <div className="ev-portal-toggle-row__title">{meta.labelPt}</div>
                <div className="ev-portal-toggle-row__impact">{meta.impactWhenRevokedPt}</div>
                {badgeClass && badgeLabel ? (
                  <span className={`ev-portal-badge ${badgeClass}`} style={{ marginTop: 4 }}>
                    {badgeLabel}
                    {renewal?.daysUntilExpiry != null
                      ? ` (${renewal.daysUntilExpiry}d)`
                      : ''}
                  </span>
                ) : null}
              </div>
              <ConsentToggle purpose={purpose} initialGranted={isGranted} />
            </div>
          )
        })}
      </section>

      {/* LGPD direitos */}
      <section className="ev-portal-section">
        <h2 className="ev-portal-h2">Seus direitos LGPD</h2>
        <p className="ev-portal-muted">
          Cada botão abre uma solicitação formal. Você recebe resposta em até 15 dias úteis
          (Resolução ANPD 2/2024).
        </p>
        <ul className="ev-portal-list">
          <li className="ev-portal-list-item">
            <div className="ev-portal-h3">📥 Baixar meus dados (Direito II)</div>
            <p className="ev-portal-muted">Acesso a todos os dados que temos sobre você.</p>
            <Link
              href="/meu/privacidade/solicitar?kind=access"
              className="ev-portal-button ev-portal-button--ghost"
            >
              Solicitar
            </Link>
          </li>
          <li className="ev-portal-list-item">
            <div className="ev-portal-h3">✏️ Corrigir dado errado (Direito III)</div>
            <p className="ev-portal-muted">Pedir correção de informação incompleta ou desatualizada.</p>
            <Link
              href="/meu/privacidade/solicitar?kind=correction"
              className="ev-portal-button ev-portal-button--ghost"
            >
              Solicitar
            </Link>
          </li>
          <li className="ev-portal-list-item">
            <div className="ev-portal-h3">🗑️ Anonimizar / apagar (Direito VI)</div>
            <p className="ev-portal-muted">
              Solicitação avaliada por DPO + equipe. Alguns dados têm retenção legal obrigatória
              (prontuário 20 anos, fiscal 5 anos).
            </p>
            <Link
              href="/meu/privacidade/solicitar?kind=anonymization"
              className="ev-portal-button ev-portal-button--ghost"
            >
              Solicitar
            </Link>
          </li>
          <li className="ev-portal-list-item">
            <div className="ev-portal-h3">📦 Portabilidade (Direito V)</div>
            <p className="ev-portal-muted">Export estruturado JSON + FHIR clínico + OFX financeiro.</p>
            <Link
              href="/meu/privacidade/solicitar?kind=portability"
              className="ev-portal-button ev-portal-button--ghost"
            >
              Solicitar
            </Link>
          </li>
          <li className="ev-portal-list-item">
            <div className="ev-portal-h3">🤝 Quem mais vê meus dados (Direito VI sharing_info)</div>
            <p className="ev-portal-muted">
              Lista de processadores (Asaas, Focus NFe, etc) + finalidade de cada um.
            </p>
            <Link
              href="/meu/privacidade/solicitar?kind=sharing_info"
              className="ev-portal-button ev-portal-button--ghost"
            >
              Solicitar
            </Link>
          </li>
        </ul>
      </section>
    </div>
  )
}
