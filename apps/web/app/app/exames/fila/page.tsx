import { db } from '@repo/db/client'
/**
 * `/app/exames/fila` — fila de exames pendentes de revisão (Sprint 33 Faixa C).
 */
import { sql } from 'drizzle-orm'
import Link from 'next/link'
import { requireFullSession } from '../../../lib/session'

export const dynamic = 'force-dynamic'

const SOURCE_ICON: Record<string, string> = {
  professional_upload: '👨‍⚕️',
  patient_portal: '📱',
  patient_whatsapp: '💬',
  lab_integration_future: '🔌',
}

const SOURCE_LABEL: Record<string, string> = {
  professional_upload: 'Profissional',
  patient_portal: 'Paciente (portal)',
  patient_whatsapp: 'Paciente (WhatsApp)',
  lab_integration_future: 'Integração laboratório',
}

export default async function ExamesFilaPage() {
  const session = await requireFullSession('/app/exames/fila')
  const tenantId = session.logifit.tenantId

  const rows = (
    await db.execute(sql`
      SELECT
        ed.id,
        ed.member_id,
        ed.source::text AS source,
        ed.sensitivity::text AS sensitivity,
        ed.exam_type_detected,
        ed.laboratory,
        ed.uploaded_at,
        ed.processed_at,
        p.name AS member_name,
        (SELECT COUNT(*)::int FROM exam_extractions WHERE exam_document_id = ed.id) AS extraction_count,
        (SELECT blocked_by_classifier FROM exam_interpretations_draft WHERE exam_document_id = ed.id ORDER BY generated_at DESC LIMIT 1) AS blocked
      FROM exam_documents ed
      INNER JOIN members m ON m.id = ed.member_id
      INNER JOIN persons p ON p.id = m.person_id
      WHERE ed.tenant_id = ${tenantId}
        AND ed.status = 'pending_review'
      ORDER BY ed.uploaded_at ASC
      LIMIT 100
    `)
  ).rows as Array<{
    id: string
    member_id: string
    source: string
    sensitivity: string
    exam_type_detected: string | null
    laboratory: string | null
    uploaded_at: string
    processed_at: string | null
    member_name: string
    extraction_count: number
    blocked: boolean | null
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
        <h1 style={{ margin: 0 }}>Fila de revisão · Exames</h1>
        <span style={{ color: 'var(--ev-text-muted)' }}>
          Sprint 33 · ADR 0050 · {rows.length} aguardando
        </span>
      </header>

      {rows.length === 0 ? (
        <section className="ev-card" style={{ padding: 'var(--ev-space-md)' }}>
          <p style={{ color: 'var(--ev-text-muted)' }}>
            Nenhum exame aguardando revisão. Pacientes/profissionais sobem PDFs em{' '}
            <code>/meu/exames/upload</code> ou <code>/app/members/[id]/exames/upload</code>.
          </p>
        </section>
      ) : (
        <section className="ev-card" style={{ padding: 0, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead style={{ background: 'var(--ev-surface-muted)' }}>
              <tr>
                <th style={{ textAlign: 'left', padding: 'var(--ev-space-2)' }}>Paciente</th>
                <th style={{ textAlign: 'left', padding: 'var(--ev-space-2)' }}>Tipo</th>
                <th style={{ textAlign: 'left', padding: 'var(--ev-space-2)' }}>Lab</th>
                <th style={{ textAlign: 'left', padding: 'var(--ev-space-2)' }}>Origem</th>
                <th style={{ textAlign: 'left', padding: 'var(--ev-space-2)' }}>Sensibilidade</th>
                <th style={{ textAlign: 'left', padding: 'var(--ev-space-2)' }}>Status IA</th>
                <th style={{ textAlign: 'right', padding: 'var(--ev-space-2)' }}>Há</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const ageHours = Math.round(
                  (Date.now() - new Date(r.uploaded_at).getTime()) / (1000 * 60 * 60),
                )
                return (
                  <tr key={r.id} style={{ borderTop: '1px solid var(--ev-border)' }}>
                    <td style={{ padding: 'var(--ev-space-2)' }}>
                      <Link href={`/app/exames/${r.id}`}>{r.member_name}</Link>
                    </td>
                    <td style={{ padding: 'var(--ev-space-2)' }}>
                      {r.exam_type_detected ?? (
                        <span style={{ color: 'var(--ev-text-muted)' }}>—</span>
                      )}
                    </td>
                    <td style={{ padding: 'var(--ev-space-2)', color: 'var(--ev-text-muted)' }}>
                      {r.laboratory ?? '—'}
                    </td>
                    <td style={{ padding: 'var(--ev-space-2)', fontSize: 'var(--ev-text-xs)' }}>
                      {SOURCE_ICON[r.source]} {SOURCE_LABEL[r.source] ?? r.source}
                    </td>
                    <td style={{ padding: 'var(--ev-space-2)' }}>
                      {r.sensitivity === 'high' ? (
                        <span style={{ color: 'var(--ev-danger)' }}>🔒 Alta</span>
                      ) : (
                        <span style={{ color: 'var(--ev-text-muted)' }}>Normal</span>
                      )}
                    </td>
                    <td style={{ padding: 'var(--ev-space-2)' }}>
                      {r.blocked === true ? (
                        <span style={{ color: 'var(--ev-warning)' }}>⚠ IA bloqueou</span>
                      ) : r.blocked === false ? (
                        <span style={{ color: 'var(--ev-success)' }}>✓ Pronto</span>
                      ) : (
                        <span style={{ color: 'var(--ev-text-muted)' }}>—</span>
                      )}
                    </td>
                    <td
                      style={{
                        padding: 'var(--ev-space-2)',
                        textAlign: 'right',
                        color: 'var(--ev-text-muted)',
                      }}
                    >
                      {ageHours < 24 ? `${ageHours}h` : `${Math.round(ageHours / 24)}d`}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </section>
      )}
    </div>
  )
}
