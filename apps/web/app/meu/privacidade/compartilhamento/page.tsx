/**
 * /meu/privacidade/compartilhamento — vínculos cross-tenant ativos.
 * Sprint 26 Faixa C (26b) — ADR 0077.
 *
 * Lista `patient_company_links` ativos do paciente (resolvido via passport_passport_id
 * → patient_company_links em outros tenants). Para cada link mostra:
 *   - Nome do tenant (companies.name) + módulos liberados (chips)
 *   - Última leitura por módulo (via patient_data_access_log mais recente)
 *   - Botões: pausar / revogar (Server Actions reusadas Sprint 02)
 *
 * Sprint 26c (PWA-grade): swipe-to-pause/revoke; drill-down nível 1-4 toggle
 * granular; banner "renovar consentimento" 30d antes de expires_at.
 */
import Link from 'next/link'
import { pool } from '@repo/db/client'
import { withMemberContext } from '../../../lib/member-session'
import { requireMemberOrPassport } from '../../../lib/require-member-or-passport'
import { PassportNeedsLink } from '../../_components/passport-needs-link'

export const dynamic = 'force-dynamic'

interface LinkRow {
  link_id: string
  passport_id: string
  source_tenant_id: string
  source_tenant_slug: string | null
  source_tenant_name: string | null
  status: 'active' | 'revoked' | 'pending'
  creation_path: string
  accepted_at: Date | null
  revoked_at: Date | null
  modules: string[]
  last_access_at: Date | null
}

const PATH_LABEL: Record<string, string> = {
  reactive: 'Convite recebido',
  proactive: 'Você convidou',
}

const STATUS_BADGE: Record<LinkRow['status'], string> = {
  active: 'ev-portal-badge--success',
  revoked: 'ev-portal-badge--danger',
  pending: 'ev-portal-badge--warning',
}

const STATUS_LABEL: Record<LinkRow['status'], string> = {
  active: 'Ativo',
  revoked: 'Revogado',
  pending: 'Pendente',
}

function formatDate(d: Date): string {
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export default async function CompartilhamentoPage() {
  const ctx = await requireMemberOrPassport('/meu/privacidade/compartilhamento')
  if (ctx.kind === 'passport_needs_link') {
    return <PassportNeedsLink feature="seus vínculos" hideLinkButtons />
  }
  const session = ctx.claims

  const links = await withMemberContext(session, async () => {
    // 1. Descobrir passport_passport_id do member atual via patient_company_links
    //    do tenant atual (paciente sempre tem 1 link no próprio tenant após Sprint 02).
    const passRes = await pool.query<{ passport_id: string; person_id: string }>(
      `SELECT pcl.passport_passport_id AS passport_id, pcl.person_id
       FROM patient_company_links pcl
       JOIN members m ON m.person_id = pcl.person_id
       WHERE m.id = $1 AND pcl.tenant_id = $2
       LIMIT 1`,
      [session.memberId, session.tenantId],
    )
    const passportId = passRes.rows[0]?.passport_id
    if (!passportId) return [] as LinkRow[]

    // 2. Listar todos links do mesmo passport (cross-tenant)
    const r = await pool.query<LinkRow>(
      `SELECT
         pcl.id AS link_id,
         pcl.passport_passport_id AS passport_id,
         pcl.tenant_id AS source_tenant_id,
         t.slug AS source_tenant_slug,
         c.name AS source_tenant_name,
         pcl.status,
         pcl.creation_path,
         pcl.accepted_at,
         pcl.revoked_at,
         COALESCE(
           ARRAY_AGG(DISTINCT plm.module::text) FILTER (WHERE plm.deactivated_at IS NULL),
           ARRAY[]::text[]
         ) AS modules,
         (
           SELECT MAX(pdal.recorded_at)
           FROM patient_data_access_log pdal
           WHERE pdal.passport_passport_id = pcl.passport_passport_id
             AND pdal.reader_tenant_id = pcl.tenant_id
         ) AS last_access_at
       FROM patient_company_links pcl
       LEFT JOIN tenants t ON t.id = pcl.tenant_id
       LEFT JOIN companies c ON c.tenant_id = pcl.tenant_id
       LEFT JOIN patient_link_modules plm ON plm.link_id = pcl.id
       WHERE pcl.passport_passport_id = $1
       GROUP BY pcl.id, t.slug, c.name
       ORDER BY pcl.created_at DESC`,
      [passportId],
    )
    return r.rows
  })

  return (
    <div className="ev-portal-page">
      <header>
        <h1 className="ev-portal-h1">Compartilhamento</h1>
        <p className="ev-portal-muted">
          Estabelecimentos que têm acesso aos seus dados. Você pode pausar ou revogar a
          qualquer momento — efeito é imediato (próximas consultas do estabelecimento retornam
          FORBIDDEN). Dados clínicos com retenção legal não são apagados, apenas isolados.
        </p>
      </header>

      {links.length === 0 ? (
        <div className="ev-portal-empty">
          Você não tem vínculos cross-tenant ativos.
          <br />
          <Link href="/meu/convidar">Convidar profissional ou estabelecimento</Link>.
        </div>
      ) : (
        <ul className="ev-portal-list">
          {links.map((l) => (
            <li key={l.link_id} className="ev-portal-list-item">
              <div className="ev-portal-list-item--row">
                <div>
                  <div className="ev-portal-h3">
                    {l.source_tenant_name ?? l.source_tenant_slug ?? 'Estabelecimento'}
                  </div>
                  <div className="ev-portal-muted">
                    {PATH_LABEL[l.creation_path] ?? l.creation_path}
                    {l.accepted_at ? ` · vinculado em ${formatDate(l.accepted_at)}` : ''}
                  </div>
                </div>
                <span className={`ev-portal-badge ${STATUS_BADGE[l.status]}`}>
                  {STATUS_LABEL[l.status]}
                </span>
              </div>

              {l.modules.length > 0 ? (
                <div style={{ display: 'flex', gap: 'var(--ev-space-1)', flexWrap: 'wrap' }}>
                  {l.modules.map((m) => (
                    <span key={m} className="ev-portal-badge ev-portal-badge--info">
                      {m}
                    </span>
                  ))}
                </div>
              ) : (
                <span className="ev-portal-muted">Nenhum módulo liberado</span>
              )}

              <div className="ev-portal-muted">
                {l.last_access_at
                  ? `Última leitura em ${l.last_access_at.toLocaleString('pt-BR')}`
                  : 'Nenhuma leitura registrada'}
              </div>

              {l.status === 'active' ? (
                <p className="ev-portal-muted">
                  Para pausar ou revogar: fale com o estabelecimento ou abra solicitação em{' '}
                  <Link href="/meu/privacidade/solicitar?kind=consent_revocation">
                    Direito VIII LGPD
                  </Link>
                  .
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <Link href="/meu/privacidade" className="ev-portal-button ev-portal-button--ghost">
        Voltar
      </Link>
    </div>
  )
}
