/**
 * /meu/privacidade/acessos — timeline de leituras cross-tenant. Sprint 26 Faixa C (26b).
 *
 * Lista `patient_data_access_log` filtrado pelo passport do paciente. Cada
 * registro: data + reader_tenant + módulo + categoria + recurso.
 *
 * Sprint 26c (PWA-grade): filtros (data/empresa/módulo/categoria), busca textual,
 * gráfico "leituras por empresa", export CSV/PDF via `exportCrossTenantAccessLog`.
 */
import Link from 'next/link'
import { pool } from '@repo/db/client'
import { requireMemberSession, withMemberContext } from '../../../lib/member-session'
import { ExportLogForm } from './export-log-form'

export const dynamic = 'force-dynamic'

interface AccessRow {
  id: string
  recorded_at: Date
  reader_tenant_name: string | null
  reader_tenant_slug: string | null
  module_type: string
  category: string
  resource_type: string | null
}

const CATEGORY_LABEL: Record<string, string> = {
  identidade: 'Identidade',
  antropometria: 'Antropometria',
  treino: 'Treino',
  clinico: 'Clínico',
}

const MODULE_LABEL: Record<string, string> = {
  academia: 'Academia',
  personal_training: 'Personal Training',
  fisioterapia: 'Fisioterapia',
  nutricao: 'Nutrição',
  pilates: 'Pilates',
}

function formatDateTime(d: Date): string {
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default async function AcessosPage() {
  const session = await requireMemberSession('/meu/privacidade/acessos')

  const accesses = await withMemberContext(session, async () => {
    // Descobre passport do member
    const passRes = await pool.query<{ passport_id: string }>(
      `SELECT pcl.passport_passport_id AS passport_id
       FROM patient_company_links pcl
       JOIN members m ON m.person_id = pcl.person_id
       WHERE m.id = $1 AND pcl.tenant_id = $2
       LIMIT 1`,
      [session.memberId, session.tenantId],
    )
    const passportId = passRes.rows[0]?.passport_id
    if (!passportId) return [] as AccessRow[]

    const r = await pool.query<AccessRow>(
      `SELECT pdal.id, pdal.recorded_at,
              c.name AS reader_tenant_name,
              t.slug AS reader_tenant_slug,
              pdal.module_type::text AS module_type,
              pdal.category,
              pdal.resource_type
       FROM patient_data_access_log pdal
       LEFT JOIN tenants t ON t.id = pdal.reader_tenant_id
       LEFT JOIN companies c ON c.tenant_id = pdal.reader_tenant_id
       WHERE pdal.passport_passport_id = $1
       ORDER BY pdal.recorded_at DESC
       LIMIT 100`,
      [passportId],
    )
    return r.rows
  })

  return (
    <div className="ev-portal-page">
      <header>
        <h1 className="ev-portal-h1">Quem viu meus dados</h1>
        <p className="ev-portal-muted">
          Registro completo de cada leitura dos seus dados por profissionais de outros
          estabelecimentos vinculados (regra 42 LogiFit + LGPD art. 18 VI).
        </p>
      </header>

      <ExportLogForm />

      {accesses.length === 0 ? (
        <div className="ev-portal-empty">Nenhuma leitura cross-tenant registrada ainda.</div>
      ) : (
        <ol className="ev-portal-timeline">
          {accesses.map((a) => (
            <li key={a.id} className="ev-portal-timeline-item">
              <div className="ev-portal-h3">{formatDateTime(a.recorded_at)}</div>
              <div className="ev-portal-muted">
                {a.reader_tenant_name ?? a.reader_tenant_slug ?? '—'} ·{' '}
                {MODULE_LABEL[a.module_type] ?? a.module_type} ·{' '}
                {CATEGORY_LABEL[a.category] ?? a.category}
                {a.resource_type ? ` · ${a.resource_type}` : ''}
              </div>
            </li>
          ))}
        </ol>
      )}

      <Link href="/meu/privacidade" className="ev-portal-button ev-portal-button--ghost">
        Voltar
      </Link>
    </div>
  )
}
