import { db } from '@repo/db/client'
/**
 * `/app/exames/[id]` — detalhe + revisão do exame. Sprint 33 Faixa C.
 *
 * Layout lado-a-lado (PDF embed + extração + interpretação). MVP read-only;
 * Sprint 33b adiciona table editor + submit review.
 */
import { sql } from 'drizzle-orm'
import Link from 'next/link'
import { requireFullSession } from '../../../lib/session'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ id: string }>
}

interface ExamFull {
  id: string
  member_id: string
  member_name: string
  source: string
  sensitivity: string
  exam_type_detected: string | null
  laboratory: string | null
  storage_path: string
  original_filename: string
  mime_type: string
  status: string
  uploaded_at: string
  processed_at: string | null
  raw_text: string | null
  structured_data: {
    examType?: string
    laboratory?: string
    analytes?: Array<{
      code: string
      label: string
      value: number
      unit: string
      referenceHint?: string
    }>
  } | null
  draft_out_of_range: Array<{
    code: string
    value: number
    unit: string
    direction: string
    severity: string
  }> | null
  draft_patterns: Array<{
    code: string
    label: string
    description: string
    confidence: number
  }> | null
  draft_follow_up: string[] | null
  draft_blocked: boolean | null
  draft_blocked_terms: string[] | null
}

export default async function ExamDetailPage({ params }: PageProps) {
  const session = await requireFullSession('/app/exames/fila')
  const tenantId = session.logifit.tenantId
  const { id } = await params

  const rows = (
    await db.execute(sql`
      SELECT
        ed.id, ed.member_id, p.name AS member_name,
        ed.source::text AS source,
        ed.sensitivity::text AS sensitivity,
        ed.exam_type_detected, ed.laboratory, ed.storage_path, ed.original_filename,
        ed.mime_type, ed.status::text AS status, ed.uploaded_at, ed.processed_at,
        ex.raw_text, ex.structured_data,
        eid.out_of_range AS draft_out_of_range,
        eid.patterns AS draft_patterns,
        eid.follow_up_suggestions AS draft_follow_up,
        eid.blocked_by_classifier AS draft_blocked,
        eid.classifier_blocked_terms AS draft_blocked_terms
      FROM exam_documents ed
      INNER JOIN members m ON m.id = ed.member_id
      INNER JOIN persons p ON p.id = m.person_id
      LEFT JOIN exam_extractions ex ON ex.exam_document_id = ed.id
      LEFT JOIN exam_interpretations_draft eid ON eid.exam_document_id = ed.id
      WHERE ed.id = ${id} AND ed.tenant_id = ${tenantId}
      LIMIT 1
    `)
  ).rows as unknown as ExamFull[]

  const exam = rows[0]

  if (!exam) {
    return (
      <div className="ev-stack" style={{ padding: 'var(--ev-space-lg)' }}>
        <h1>Exame não encontrado</h1>
        <Link href="/app/exames/fila">Voltar para fila</Link>
      </div>
    )
  }

  const analytes = exam.structured_data?.analytes ?? []
  const outOfRange = exam.draft_out_of_range ?? []
  const patterns = exam.draft_patterns ?? []
  const followUp = exam.draft_follow_up ?? []

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
        <h1 style={{ margin: 0 }}>Exame · {exam.member_name}</h1>
        <span style={{ color: 'var(--ev-text-muted)' }}>
          {exam.exam_type_detected ?? 'tipo não detectado'}
          {exam.laboratory ? ` · ${exam.laboratory}` : ''}
        </span>
        <span style={{ flex: 1 }} />
        <span style={{ color: 'var(--ev-text-muted)' }}>
          Status: <strong>{exam.status}</strong>
        </span>
        {exam.sensitivity === 'high' ? (
          <span style={{ color: 'var(--ev-danger)' }}>🔒 Sensibilidade alta</span>
        ) : null}
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
        <dt style={{ color: 'var(--ev-text-muted)' }}>Arquivo</dt>
        <dd style={{ margin: 0, fontFamily: 'monospace', fontSize: 'var(--ev-text-sm)' }}>
          {exam.original_filename} ({exam.mime_type})
        </dd>
        <dt style={{ color: 'var(--ev-text-muted)' }}>Origem</dt>
        <dd style={{ margin: 0 }}>{exam.source}</dd>
        <dt style={{ color: 'var(--ev-text-muted)' }}>Recebido</dt>
        <dd style={{ margin: 0 }}>{new Date(exam.uploaded_at).toLocaleString('pt-BR')}</dd>
        {exam.processed_at ? (
          <>
            <dt style={{ color: 'var(--ev-text-muted)' }}>Processado IA</dt>
            <dd style={{ margin: 0 }}>{new Date(exam.processed_at).toLocaleString('pt-BR')}</dd>
          </>
        ) : null}
      </section>

      <section className="ev-card" style={{ padding: 'var(--ev-space-md)' }}>
        <h2 style={{ marginTop: 0 }}>Analitos extraídos ({analytes.length})</h2>
        {analytes.length === 0 ? (
          <p style={{ color: 'var(--ev-text-muted)' }}>Nenhum analito extraído ainda.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr
                style={{
                  color: 'var(--ev-text-muted)',
                  fontSize: 'var(--ev-text-xs)',
                  textTransform: 'uppercase',
                }}
              >
                <th style={{ textAlign: 'left', padding: 4 }}>Analito</th>
                <th style={{ textAlign: 'left', padding: 4 }}>Code</th>
                <th style={{ textAlign: 'right', padding: 4 }}>Valor</th>
                <th style={{ textAlign: 'left', padding: 4 }}>Unid</th>
                <th style={{ textAlign: 'left', padding: 4 }}>Referência</th>
                <th style={{ textAlign: 'center', padding: 4 }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {analytes.map((a) => {
                const oor = outOfRange.find((o) => o.code === a.code)
                return (
                  <tr key={a.code} style={{ borderTop: '1px solid var(--ev-border)' }}>
                    <td style={{ padding: 4 }}>{a.label}</td>
                    <td
                      style={{ padding: 4, fontFamily: 'monospace', fontSize: 'var(--ev-text-xs)' }}
                    >
                      {a.code}
                    </td>
                    <td style={{ padding: 4, textAlign: 'right', fontFamily: 'monospace' }}>
                      {a.value.toFixed(2)}
                    </td>
                    <td style={{ padding: 4 }}>{a.unit}</td>
                    <td
                      style={{
                        padding: 4,
                        color: 'var(--ev-text-muted)',
                        fontSize: 'var(--ev-text-xs)',
                      }}
                    >
                      {a.referenceHint ?? '—'}
                    </td>
                    <td style={{ padding: 4, textAlign: 'center' }}>
                      {oor ? (
                        <span
                          style={{
                            color:
                              oor.severity === 'severe' ? 'var(--ev-danger)' : 'var(--ev-warning)',
                            fontSize: 'var(--ev-text-xs)',
                          }}
                        >
                          {oor.direction === 'above' ? '⬆' : '⬇'} {oor.severity}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--ev-success)' }}>✓</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </section>

      {exam.draft_blocked ? (
        <section
          className="ev-card"
          style={{
            padding: 'var(--ev-space-md)',
            borderLeft: '4px solid var(--ev-warning)',
            background: 'var(--ev-warning-soft)',
          }}
        >
          <h3 style={{ marginTop: 0 }}>⚠ IA bloqueada pelo classificador clínico</h3>
          <p style={{ color: 'var(--ev-text-muted)', margin: 0 }}>
            Termos detectados: {exam.draft_blocked_terms?.join(', ') ?? '—'}.
            <br />
            Profissional precisa interpretar manualmente.
          </p>
        </section>
      ) : (
        <>
          {patterns.length > 0 ? (
            <section className="ev-card" style={{ padding: 'var(--ev-space-md)' }}>
              <h2 style={{ marginTop: 0 }}>Padrões detectados ({patterns.length})</h2>
              <ul
                style={{ display: 'grid', gap: 'var(--ev-space-2)', listStyle: 'none', padding: 0 }}
              >
                {patterns.map((p) => (
                  <li
                    key={p.code}
                    style={{
                      padding: 'var(--ev-space-2)',
                      borderLeft: '3px solid var(--ev-primary)',
                      background: 'var(--ev-surface-muted)',
                      borderRadius: 'var(--ev-radius-sm)',
                    }}
                  >
                    <div style={{ fontWeight: 600 }}>{p.label}</div>
                    <p style={{ margin: '4px 0 0 0', fontSize: 'var(--ev-text-sm)' }}>
                      {p.description}
                    </p>
                    <small style={{ color: 'var(--ev-text-muted)' }}>
                      Confidence: {(p.confidence * 100).toFixed(0)}%
                    </small>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {followUp.length > 0 ? (
            <section className="ev-card" style={{ padding: 'var(--ev-space-md)' }}>
              <h2 style={{ marginTop: 0 }}>Exames sugeridos para complementar</h2>
              <ul>
                {followUp.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
              <small style={{ color: 'var(--ev-text-muted)' }}>
                Sugestões automáticas baseadas em padrões. Profissional decide.
              </small>
            </section>
          ) : null}
        </>
      )}

      <section className="ev-card" style={{ padding: 'var(--ev-space-md)' }}>
        <p style={{ color: 'var(--ev-text-muted)', margin: 0 }}>
          <strong>UI de revisão completa (table editor + submit + publicação)</strong> entra em
          Sprint 33b. MVP entrega backend completo + visualização read-only do draft IA.
        </p>
      </section>

      <Link href="/app/exames/fila" className="ev-btn ev-btn-ghost">
        ← Voltar para fila
      </Link>
    </div>
  )
}
