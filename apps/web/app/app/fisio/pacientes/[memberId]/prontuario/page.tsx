import { db } from '@repo/db/client'
import { consultas, members, persons } from '@repo/db/schema'
/**
 * `/app/fisio/pacientes/[memberId]/prontuario` — Sprint 20 Faixa C.
 *
 * Lista de consultas do member ordenada por data desc + botão "Nova consulta".
 */
import { and, desc, eq } from 'drizzle-orm'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireFullSession } from '../../../../../lib/session'
import { CreateConsultaButton } from './create-consulta-button'

export const dynamic = 'force-dynamic'

const KIND_LABEL: Record<string, string> = {
  medico: '🩺 Médico',
  fisio: '🩹 Fisio',
  nutri: '🥗 Nutri',
  personal: '💪 Personal',
  enfermeiro: '🩻 Enfermeiro',
  custom: '📝 Custom',
}

const STATUS_LABEL: Record<string, { label: string; bg: string }> = {
  draft: { label: 'Rascunho', bg: 'var(--ev-surface)' },
  locked: { label: '🔒 Fechado (lacre)', bg: 'var(--ev-info-soft, #eff6ff)' },
  signed: { label: '✍️ Assinado (ICP)', bg: 'var(--ev-success-soft, #dcfce7)' },
  archived: { label: '📦 Arquivado', bg: 'var(--ev-muted-soft, #f3f4f6)' },
}

export default async function ProntuarioPage({
  params,
}: { params: Promise<{ memberId: string }> }) {
  const { memberId } = await params
  const session = await requireFullSession(`/app/fisio/pacientes/${memberId}/prontuario`)
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
      id: consultas.id,
      kind: consultas.kind,
      status: consultas.status,
      signatureMode: consultas.signatureMode,
      lockMethod: consultas.lockMethod,
      signedAt: consultas.signedAt,
      lockedAt: consultas.lockedAt,
      createdAt: consultas.createdAt,
    })
    .from(consultas)
    .where(and(eq(consultas.tenantId, tenantId), eq(consultas.memberId, memberId)))
    .orderBy(desc(consultas.createdAt))
    .limit(100)

  return (
    <div className="ev-stack" style={{ padding: 'var(--ev-space-lg)' }}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--ev-space-md)' }}>
        <h1 style={{ margin: 0 }}>Prontuário — {member.name ?? '—'}</h1>
        <span style={{ flex: 1 }} />
        <Link href={`/app/members/${memberId}`} className="ev-btn ev-btn-ghost">
          ← Perfil
        </Link>
        <CreateConsultaButton memberId={memberId} />
      </header>

      <div className="ev-card" style={{ padding: 'var(--ev-space-md)' }}>
        <p style={{ marginTop: 0, marginBottom: 0 }}>
          Política de assinatura aplicada automaticamente por <strong>kind</strong>: médico →
          ICP-Brasil A3 obrigatório (CFM 2.299/2021); fisio/nutri/personal → lacre autenticado MFA
          aceito (COFFITO 414, CFN 599, Lei 9.696). Retenção mínima 20 anos (Lei 13.787/2018).
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="ev-card" style={{ padding: 'var(--ev-space-lg)' }}>
          <p style={{ marginTop: 0 }}>Nenhuma consulta registrada. Comece criando a primeira.</p>
        </div>
      ) : (
        <table className="ev-table" style={{ width: '100%' }}>
          <thead>
            <tr>
              <th>Data</th>
              <th>Tipo</th>
              <th>Status</th>
              <th>Política</th>
              <th>Fechado em</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const st = STATUS_LABEL[c.status] ?? { label: c.status, bg: 'var(--ev-surface)' }
              return (
                <tr key={c.id}>
                  <td style={{ fontSize: 'var(--ev-font-xs)' }}>
                    {new Date(c.createdAt).toLocaleString('pt-BR')}
                  </td>
                  <td>{KIND_LABEL[c.kind] ?? c.kind}</td>
                  <td>
                    <span className="ev-badge" style={{ background: st.bg }}>
                      {st.label}
                    </span>
                  </td>
                  <td style={{ fontSize: 'var(--ev-font-xs)' }}>{c.signatureMode}</td>
                  <td style={{ fontSize: 'var(--ev-font-xs)' }}>
                    {c.lockedAt ? new Date(c.lockedAt).toLocaleString('pt-BR') : '—'}
                  </td>
                  <td>
                    <Link href={`/app/fisio/consultas/${c.id}`} className="ev-btn ev-btn-ghost">
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
