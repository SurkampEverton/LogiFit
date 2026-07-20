import { db } from '@repo/db/client'
/**
 * `/app/cross/alertas` — lista de todos os injury_alerts (Sprint 27 Faixa C).
 *
 * Gerente vê tudo: pending_review + accepted + rejected + blocked.
 * Filtro por status na URL (?status=blocked).
 */
import { sql } from 'drizzle-orm'
import Link from 'next/link'
import { requireFullSession } from '../../../lib/session'

export const dynamic = 'force-dynamic'

const STATUS_LABEL: Record<string, string> = {
  pending_review: 'Aguarda revisão',
  accepted: 'Aceito',
  rejected: 'Rejeitado',
  expired: 'Expirado',
  blocked: 'Bloqueado',
}

const STATUS_COLOR: Record<string, string> = {
  pending_review: 'var(--ev-warning)',
  accepted: 'var(--ev-success)',
  rejected: 'var(--ev-text-muted)',
  expired: 'var(--ev-text-subtle)',
  blocked: 'var(--ev-danger)',
}

const BLOCKED_LABEL: Record<string, string> = {
  regra_25_franchise_cross_company: 'Regra 25 (franchise)',
  consent_missing: 'Sem consent',
  no_active_academia_contract: 'Sem contrato Academia',
  no_active_workout: 'Sem workout ativo',
  cid_not_actionable: 'CID não actionable',
}

interface PageProps {
  searchParams: Promise<{ status?: string }>
}

export default async function AlertasListPage({ searchParams }: PageProps) {
  const session = await requireFullSession('/app/cross/alertas')
  const tenantId = session.logifit.tenantId
  const { status } = await searchParams

  const rows = (
    await db.execute(sql`
      SELECT
        a.id,
        a.member_id,
        p.name AS member_name,
        a.primary_cid_code,
        c.description AS cid_description,
        a.status,
        a.blocked_reason,
        a.source_company_id,
        a.target_company_id,
        a.created_at,
        a.expires_at
      FROM member_injury_alerts a
      LEFT JOIN members m ON m.id = a.member_id
      LEFT JOIN persons p ON p.id = m.person_id
      LEFT JOIN cid_catalog c ON c.code = a.primary_cid_code
      WHERE a.tenant_id = ${tenantId}
        ${status ? sql`AND a.status = ${status}` : sql``}
      ORDER BY a.created_at DESC
      LIMIT 200
    `)
  ).rows as Array<{
    id: string
    member_id: string
    member_name: string | null
    primary_cid_code: string
    cid_description: string | null
    status: keyof typeof STATUS_LABEL
    blocked_reason: string | null
    source_company_id: string | null
    target_company_id: string | null
    created_at: string
    expires_at: string
  }>

  return (
    <div className="ev-stack" style={{ padding: 'var(--ev-space-lg)' }}>
      <header
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 'var(--ev-space-md)',
          flexWrap: 'wrap',
        }}
      >
        <h1 style={{ margin: 0 }}>Alertas de lesão</h1>
        <span style={{ flex: 1 }} />
        <nav style={{ display: 'flex', gap: 'var(--ev-space-sm)' }}>
          <Link
            href="/app/cross/alertas"
            className="ev-btn ev-btn-ghost"
            style={{ fontWeight: !status ? 600 : 400 }}
          >
            Todos
          </Link>
          {Object.entries(STATUS_LABEL).map(([k, v]) => (
            <Link
              key={k}
              href={`/app/cross/alertas?status=${k}`}
              className="ev-btn ev-btn-ghost"
              style={{ fontWeight: status === k ? 600 : 400 }}
            >
              {v}
            </Link>
          ))}
        </nav>
      </header>

      <section className="ev-card" style={{ padding: 0, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead style={{ background: 'var(--ev-surface-muted)' }}>
            <tr>
              <th style={{ textAlign: 'left', padding: 'var(--ev-space-2)' }}>Paciente</th>
              <th style={{ textAlign: 'left', padding: 'var(--ev-space-2)' }}>CID</th>
              <th style={{ textAlign: 'left', padding: 'var(--ev-space-2)' }}>Status</th>
              <th style={{ textAlign: 'left', padding: 'var(--ev-space-2)' }}>Motivo</th>
              <th style={{ textAlign: 'left', padding: 'var(--ev-space-2)' }}>Criado</th>
              <th style={{ textAlign: 'left', padding: 'var(--ev-space-2)' }}>Expira</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  style={{ padding: 'var(--ev-space-md)', color: 'var(--ev-text-muted)' }}
                >
                  Nenhum alerta encontrado.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} style={{ borderTop: '1px solid var(--ev-border)' }}>
                <td style={{ padding: 'var(--ev-space-2)' }}>
                  <Link href={`/app/cross/alertas/${r.id}`}>{r.member_name ?? '—'}</Link>
                </td>
                <td style={{ padding: 'var(--ev-space-2)', fontFamily: 'monospace' }}>
                  {r.primary_cid_code}
                  {r.cid_description ? (
                    <span style={{ color: 'var(--ev-text-muted)' }}> — {r.cid_description}</span>
                  ) : null}
                </td>
                <td
                  style={{
                    padding: 'var(--ev-space-2)',
                    color: STATUS_COLOR[r.status] ?? 'var(--ev-text)',
                  }}
                >
                  {STATUS_LABEL[r.status] ?? r.status}
                </td>
                <td style={{ padding: 'var(--ev-space-2)', color: 'var(--ev-text-muted)' }}>
                  {r.blocked_reason ? (BLOCKED_LABEL[r.blocked_reason] ?? r.blocked_reason) : '—'}
                </td>
                <td style={{ padding: 'var(--ev-space-2)' }}>
                  {new Date(r.created_at).toLocaleString('pt-BR')}
                </td>
                <td style={{ padding: 'var(--ev-space-2)' }}>
                  {new Date(r.expires_at).toLocaleDateString('pt-BR')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  )
}
