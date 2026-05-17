/**
 * `/app/fisio/pacientes/[memberId]/timeline-evolucao` — timeline visual (Sprint 21 Faixa C).
 */
import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { db } from '@repo/db/client'
import { evolucoesSessao, members, persons } from '@repo/db/schema'
import { requireFullSession } from '../../../../../lib/session'

export const dynamic = 'force-dynamic'

interface Soap {
  subjetivo?: string | null
  objetivo?: string | null
  avaliacao?: string | null
  plano?: string | null
}

function shorten(text: string | null | undefined, max = 120): string {
  if (!text) return '—'
  const trimmed = text.trim()
  if (trimmed.length <= max) return trimmed
  return `${trimmed.slice(0, max - 1)}…`
}

export default async function TimelineEvolucaoPage({
  params,
}: { params: Promise<{ memberId: string }> }) {
  const { memberId } = await params
  const session = await requireFullSession(
    `/app/fisio/pacientes/${memberId}/timeline-evolucao`,
  )
  const tenantId = session.logifit.tenantId

  const [member] = await db
    .select({ id: members.id, name: persons.name })
    .from(members)
    .leftJoin(persons, eq(persons.id, members.personId))
    .where(and(eq(members.id, memberId), eq(members.tenantId, tenantId)))
    .limit(1)
  if (!member) notFound()

  const rows = await db
    .select({
      id: evolucoesSessao.id,
      status: evolucoesSessao.status,
      soap: evolucoesSessao.soap,
      freeText: evolucoesSessao.freeText,
      createdAt: evolucoesSessao.createdAt,
      attachmentsCount: sql<number>`(SELECT COUNT(*)::int FROM evolucao_attachments WHERE evolucao_id = ${evolucoesSessao.id} AND soft_deleted_at IS NULL)`,
    })
    .from(evolucoesSessao)
    .where(
      and(
        eq(evolucoesSessao.tenantId, tenantId),
        eq(evolucoesSessao.memberId, memberId),
        isNull(evolucoesSessao.archivedAt),
      ),
    )
    .orderBy(asc(evolucoesSessao.createdAt))
    .limit(200)

  return (
    <div className="ev-stack" style={{ padding: 'var(--ev-space-lg)' }}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--ev-space-md)' }}>
        <h1 style={{ margin: 0 }}>📈 Timeline — {member.name ?? '—'}</h1>
        <span style={{ color: 'var(--ev-muted)' }}>{rows.length} pontos</span>
        <span style={{ flex: 1 }} />
        <Link
          href={`/app/fisio/pacientes/${memberId}/evolucoes`}
          className="ev-btn ev-btn-ghost"
        >
          ← Lista
        </Link>
      </header>

      {rows.length === 0 ? (
        <div className="ev-card" style={{ padding: 'var(--ev-space-lg)' }}>
          <p style={{ marginTop: 0 }}>Sem dados. Crie a primeira evolução.</p>
        </div>
      ) : (
        <div className="ev-stack" style={{ gap: 0, paddingLeft: 24 }}>
          {rows.map((r, idx) => {
            const soap = (r.soap as unknown as Soap) ?? {}
            const isLast = idx === rows.length - 1
            const dotColor =
              r.status === 'signed'
                ? 'var(--ev-success, #16a34a)'
                : r.status === 'locked'
                  ? 'var(--ev-info, #2563eb)'
                  : 'var(--ev-muted, #9ca3af)'
            return (
              <div
                key={r.id}
                style={{
                  position: 'relative',
                  paddingLeft: 24,
                  paddingBottom: isLast ? 0 : 24,
                  borderLeft: isLast ? 'none' : '2px solid var(--ev-border)',
                  marginLeft: 8,
                }}
              >
                <div
                  style={{
                    position: 'absolute',
                    left: -10,
                    top: 0,
                    width: 16,
                    height: 16,
                    borderRadius: '50%',
                    background: dotColor,
                    border: '2px solid var(--ev-surface, white)',
                  }}
                />
                <div
                  className="ev-card"
                  style={{ padding: 'var(--ev-space-md)', marginLeft: 8 }}
                >
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                    <strong>{new Date(r.createdAt).toLocaleString('pt-BR')}</strong>
                    <span className="ev-badge">{r.status}</span>
                    {r.attachmentsCount > 0 && (
                      <span className="ev-badge">📎 {r.attachmentsCount}</span>
                    )}
                    <span style={{ flex: 1 }} />
                    <Link
                      href={`/app/fisio/evolucoes/${r.id}`}
                      style={{ fontSize: 'var(--ev-font-xs)' }}
                    >
                      Abrir →
                    </Link>
                  </div>
                  <div style={{ marginTop: 8, fontSize: 'var(--ev-font-sm)' }}>
                    <div>
                      <strong>S:</strong> {shorten(soap.subjetivo)}
                    </div>
                    <div>
                      <strong>O:</strong> {shorten(soap.objetivo)}
                    </div>
                    <div>
                      <strong>A:</strong> {shorten(soap.avaliacao)}
                    </div>
                    <div>
                      <strong>P:</strong> {shorten(soap.plano)}
                    </div>
                    {r.freeText && (
                      <div style={{ marginTop: 4, color: 'var(--ev-muted)' }}>
                        💬 {shorten(r.freeText, 200)}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
