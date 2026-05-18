/**
 * `/app/nutri/suplementos/[id]` — detalhe + interações (Sprint 30 Faixa C).
 */
import { sql } from 'drizzle-orm'
import Link from 'next/link'
import { db } from '@repo/db/client'
import { requireFullSession } from '../../../../lib/session'

export const dynamic = 'force-dynamic'

const SEVERITY_COLOR: Record<string, string> = {
  info: 'var(--ev-text-muted)',
  caution: 'var(--ev-warning)',
  avoid: 'var(--ev-danger)',
}

const SEVERITY_LABEL: Record<string, string> = {
  info: 'Informativo',
  caution: 'Atenção',
  avoid: 'Evitar combinação',
}

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function SupplementDetailPage({ params }: PageProps) {
  const session = await requireFullSession('/app/nutri/suplementos')
  const tenantId = session.logifit.tenantId
  const { id } = await params

  const [s] = (
    await db.execute(sql`
      SELECT id, tenant_id, name, kind, brand, concentration, anvisa_registration,
             indication, contraindications, notes
      FROM supplements
      WHERE id = ${id} AND (tenant_id IS NULL OR tenant_id = ${tenantId})
      LIMIT 1
    `)
  ).rows as Array<{
    id: string
    tenant_id: string | null
    name: string
    kind: string
    brand: string | null
    concentration: string | null
    anvisa_registration: string | null
    indication: string | null
    contraindications: string | null
    notes: string | null
  }>

  if (!s) {
    return (
      <div className="ev-stack" style={{ padding: 'var(--ev-space-lg)' }}>
        <h1>Suplemento não encontrado</h1>
        <Link href="/app/nutri/suplementos">Voltar</Link>
      </div>
    )
  }

  const interactions = (
    await db.execute(sql`
      SELECT id, interacts_with, severity, description, source
      FROM supplement_interactions
      WHERE supplement_id = ${id}
        AND (tenant_id IS NULL OR tenant_id = ${tenantId})
      ORDER BY
        CASE severity WHEN 'avoid' THEN 1 WHEN 'caution' THEN 2 ELSE 3 END,
        interacts_with ASC
    `)
  ).rows as Array<{
    id: string
    interacts_with: string
    severity: string
    description: string
    source: string | null
  }>

  return (
    <div className="ev-stack" style={{ padding: 'var(--ev-space-lg)' }}>
      <header
        style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--ev-space-md)', flexWrap: 'wrap' }}
      >
        <h1 style={{ margin: 0 }}>{s.name}</h1>
        <span style={{ color: 'var(--ev-text-muted)' }}>
          {s.brand ?? '—'} · {s.tenant_id ? '🏢 tenant' : '🌐 global'}
        </span>
      </header>

      <section
        className="ev-card"
        style={{
          padding: 'var(--ev-space-md)',
          display: 'grid',
          gridTemplateColumns: 'auto 1fr',
          gap: 'var(--ev-space-sm) var(--ev-space-md)',
        }}
      >
        <dt style={{ color: 'var(--ev-text-muted)' }}>Concentração</dt>
        <dd style={{ margin: 0 }}>{s.concentration ?? '—'}</dd>
        <dt style={{ color: 'var(--ev-text-muted)' }}>Reg. ANVISA</dt>
        <dd style={{ margin: 0, fontFamily: 'monospace' }}>{s.anvisa_registration ?? '—'}</dd>
        {s.indication ? (
          <>
            <dt style={{ color: 'var(--ev-text-muted)' }}>Indicação</dt>
            <dd style={{ margin: 0 }}>{s.indication}</dd>
          </>
        ) : null}
        {s.contraindications ? (
          <>
            <dt style={{ color: 'var(--ev-text-muted)' }}>Contraindicações</dt>
            <dd style={{ margin: 0 }}>{s.contraindications}</dd>
          </>
        ) : null}
        {s.notes ? (
          <>
            <dt style={{ color: 'var(--ev-text-muted)' }}>Notas</dt>
            <dd style={{ margin: 0 }}>{s.notes}</dd>
          </>
        ) : null}
      </section>

      <section className="ev-card" style={{ padding: 'var(--ev-space-md)' }}>
        <h2 style={{ marginTop: 0 }}>Interações conhecidas</h2>
        {interactions.length === 0 ? (
          <p style={{ color: 'var(--ev-text-muted)' }}>Sem interações cadastradas.</p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 'var(--ev-space-2)' }}>
            {interactions.map((it) => (
              <li
                key={it.id}
                style={{
                  borderLeft: `3px solid ${SEVERITY_COLOR[it.severity] ?? 'var(--ev-border)'}`,
                  padding: 'var(--ev-space-2)',
                  backgroundColor: 'var(--ev-surface-muted)',
                  borderRadius: 'var(--ev-radius-sm)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <strong>{it.interacts_with}</strong>
                  <span
                    style={{
                      fontSize: 'var(--ev-text-xs)',
                      color: SEVERITY_COLOR[it.severity] ?? 'var(--ev-text-muted)',
                      fontWeight: 'var(--ev-weight-medium)',
                    }}
                  >
                    {SEVERITY_LABEL[it.severity] ?? it.severity}
                  </span>
                </div>
                <p style={{ margin: '4px 0 0 0', fontSize: 'var(--ev-text-sm)' }}>{it.description}</p>
                {it.source ? (
                  <small style={{ color: 'var(--ev-text-muted)' }}>Fonte: {it.source}</small>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <Link href="/app/nutri/suplementos" className="ev-btn ev-btn-ghost">
        ← Voltar
      </Link>
    </div>
  )
}
