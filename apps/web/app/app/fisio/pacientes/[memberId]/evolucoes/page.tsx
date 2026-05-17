/**
 * `/app/fisio/pacientes/[memberId]/evolucoes` — lista de evoluções (Sprint 21 Faixa C).
 */
import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { db } from '@repo/db/client'
import { evolucoesSessao, members, persons } from '@repo/db/schema'
import { requireFullSession } from '../../../../../lib/session'

export const dynamic = 'force-dynamic'

const STATUS_BADGE: Record<string, { label: string; bg: string }> = {
  draft: { label: 'Rascunho', bg: 'var(--ev-surface)' },
  locked: { label: '🔒 Fechada (lacre)', bg: 'var(--ev-info-soft, #eff6ff)' },
  signed: { label: '✍️ Assinada (ICP)', bg: 'var(--ev-success-soft, #dcfce7)' },
}

export default async function EvolucoesListPage({
  params,
}: { params: Promise<{ memberId: string }> }) {
  const { memberId } = await params
  const session = await requireFullSession(
    `/app/fisio/pacientes/${memberId}/evolucoes`,
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
      appointmentId: evolucoesSessao.appointmentId,
      lockedAt: evolucoesSessao.lockedAt,
      signedAt: evolucoesSessao.signedAt,
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
    .orderBy(desc(evolucoesSessao.createdAt))
    .limit(100)

  return (
    <div className="ev-stack" style={{ padding: 'var(--ev-space-lg)' }}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--ev-space-md)' }}>
        <h1 style={{ margin: 0 }}>Evoluções — {member.name ?? '—'}</h1>
        <span style={{ color: 'var(--ev-muted)' }}>{rows.length} sessões</span>
        <span style={{ flex: 1 }} />
        <Link
          href={`/app/fisio/pacientes/${memberId}/prontuario`}
          className="ev-btn ev-btn-ghost"
        >
          → Prontuário (consultas)
        </Link>
        <Link
          href={`/app/fisio/pacientes/${memberId}/timeline-evolucao`}
          className="ev-btn ev-btn-ghost"
        >
          📈 Timeline
        </Link>
        <Link
          href={`/app/fisio/evolucoes/new?memberId=${memberId}`}
          className="ev-btn ev-btn-primary"
        >
          + Nova evolução
        </Link>
      </header>

      <div className="ev-card" style={{ padding: 'var(--ev-space-md)' }}>
        <p style={{ marginTop: 0, marginBottom: 0 }}>
          <strong>Evolução por sessão</strong> é um SOAP enxuto registrado a cada
          atendimento. Difere de <strong>consulta</strong> (avaliação inicial/reavaliação
          com CID/CIF formal). Anexos categorizados (raio-X / vídeo execução /
          documento / foto postural / áudio) entram aqui também — scan obrigatório
          antes de exibir (regra 38).
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="ev-card" style={{ padding: 'var(--ev-space-lg)' }}>
          <p style={{ marginTop: 0 }}>Nenhuma evolução registrada.</p>
        </div>
      ) : (
        <table className="ev-table" style={{ width: '100%' }}>
          <thead>
            <tr>
              <th>Data</th>
              <th>Status</th>
              <th>Vinculada agendamento?</th>
              <th>Fechada em</th>
              <th>Anexos</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => {
              const st = STATUS_BADGE[e.status] ?? { label: e.status, bg: 'var(--ev-surface)' }
              return (
                <tr key={e.id}>
                  <td style={{ fontSize: 'var(--ev-font-xs)' }}>
                    {new Date(e.createdAt).toLocaleString('pt-BR')}
                  </td>
                  <td>
                    <span className="ev-badge" style={{ background: st.bg }}>
                      {st.label}
                    </span>
                  </td>
                  <td>{e.appointmentId ? '✓' : '—'}</td>
                  <td style={{ fontSize: 'var(--ev-font-xs)' }}>
                    {e.lockedAt ? new Date(e.lockedAt).toLocaleString('pt-BR') : '—'}
                  </td>
                  <td>{e.attachmentsCount}</td>
                  <td>
                    <Link
                      href={`/app/fisio/evolucoes/${e.id}`}
                      className="ev-btn ev-btn-ghost"
                    >
                      Abrir →
                    </Link>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}
