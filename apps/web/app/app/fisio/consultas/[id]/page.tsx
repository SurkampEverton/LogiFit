/**
 * `/app/fisio/consultas/[id]` — detalhe da consulta (Sprint 20 Faixa C).
 *
 * Em draft: editor SOAP + add CID/CIF + botão fechar.
 * Em locked/signed: readonly + hash + botão nota corretiva.
 */
import { and, asc, desc, eq } from 'drizzle-orm'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { db } from '@repo/db/client'
import {
  consultaCids,
  consultaCifs,
  consultaCorrectionNotes,
  consultas,
  members,
  persons,
} from '@repo/db/schema'
import { requireFullSession } from '../../../../lib/session'
import { ConsultaEditor } from './consulta-editor'
import { LockConsultaForm } from './lock-consulta-form'
import { CorrectionNoteForm } from './correction-note-form'

export const dynamic = 'force-dynamic'

const KIND_LABEL: Record<string, string> = {
  medico: 'Médico',
  fisio: 'Fisio',
  nutri: 'Nutri',
  personal: 'Personal',
  enfermeiro: 'Enfermeiro',
  custom: 'Custom',
}

export default async function ConsultaDetailPage({
  params,
}: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await requireFullSession(`/app/fisio/consultas/${id}`)
  const tenantId = session.logifit.tenantId

  const [c] = await db
    .select({
      id: consultas.id,
      memberId: consultas.memberId,
      memberName: persons.name,
      kind: consultas.kind,
      status: consultas.status,
      signatureMode: consultas.signatureMode,
      lockMethod: consultas.lockMethod,
      signedAt: consultas.signedAt,
      signedHash: consultas.signedHash,
      signatureProvider: consultas.signatureProvider,
      lockedAt: consultas.lockedAt,
      content: consultas.content,
      councilSnapshot: consultas.councilSnapshot,
      createdAt: consultas.createdAt,
      professionalUserId: consultas.professionalUserId,
    })
    .from(consultas)
    .leftJoin(members, eq(members.id, consultas.memberId))
    .leftJoin(persons, eq(persons.id, members.personId))
    .where(and(eq(consultas.id, id), eq(consultas.tenantId, tenantId)))
    .limit(1)
  if (!c) notFound()

  const cids = await db
    .select({ code: consultaCids.cidCode, kind: consultaCids.kind, notes: consultaCids.notes })
    .from(consultaCids)
    .where(eq(consultaCids.consultaId, id))
    .orderBy(asc(consultaCids.cidCode))

  const cifs = await db
    .select({
      code: consultaCifs.cifCode,
      qualifier: consultaCifs.qualifier,
      notes: consultaCifs.notes,
    })
    .from(consultaCifs)
    .where(eq(consultaCifs.consultaId, id))
    .orderBy(asc(consultaCifs.cifCode))

  const correctionNotes = await db
    .select({
      id: consultaCorrectionNotes.id,
      body: consultaCorrectionNotes.body,
      reason: consultaCorrectionNotes.reason,
      authorUserId: consultaCorrectionNotes.authorUserId,
      createdAt: consultaCorrectionNotes.createdAt,
      contentHash: consultaCorrectionNotes.contentHash,
    })
    .from(consultaCorrectionNotes)
    .where(eq(consultaCorrectionNotes.consultaId, id))
    .orderBy(desc(consultaCorrectionNotes.createdAt))

  const content = (c.content as Record<string, unknown>) ?? {}
  const councilSnap = (c.councilSnapshot as
    | { councilBody?: string; councilState?: string; councilNumber?: string }
    | null) ?? null
  const isDraft = c.status === 'draft'
  const isAuthor = c.professionalUserId === session.user.id
  const isReadonly = !isDraft || !isAuthor

  return (
    <div className="ev-stack" style={{ padding: 'var(--ev-space-lg)' }}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--ev-space-md)', flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0 }}>
          Consulta {KIND_LABEL[c.kind] ?? c.kind} — {c.memberName ?? '—'}
        </h1>
        <span className="ev-badge">{c.status}</span>
        {c.signatureMode === 'icp_required' && <span className="ev-badge">ICP A3</span>}
        <span style={{ flex: 1 }} />
        <Link
          href={`/app/fisio/pacientes/${c.memberId}/prontuario`}
          className="ev-btn ev-btn-ghost"
        >
          ← Prontuário
        </Link>
        <Link href={`/app/fisio/consultas/${id}/pdf`} className="ev-btn ev-btn-ghost">
          📄 PDF preview
        </Link>
      </header>

      <section
        className="ev-card"
        style={{
          padding: 'var(--ev-space-md)',
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 'var(--ev-space-md)',
        }}
      >
        <div>
          <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>Criada</div>
          <div>{new Date(c.createdAt).toLocaleString('pt-BR')}</div>
        </div>
        <div>
          <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>Política</div>
          <div>{c.signatureMode}</div>
        </div>
        <div>
          <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>Lock method</div>
          <div>{c.lockMethod ?? '—'}</div>
        </div>
        <div>
          <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>
            {c.signedAt ? 'Assinada em' : c.lockedAt ? 'Lacrada em' : 'Aguarda fechamento'}
          </div>
          <div style={{ fontSize: 'var(--ev-font-xs)' }}>
            {c.signedAt
              ? new Date(c.signedAt).toLocaleString('pt-BR')
              : c.lockedAt
                ? new Date(c.lockedAt).toLocaleString('pt-BR')
                : '—'}
          </div>
        </div>
      </section>

      <ConsultaEditor
        consultaId={id}
        content={{
          queixa: (content.queixa as string) ?? '',
          avaliacao: (content.avaliacao as string) ?? '',
          conduta: (content.conduta as string) ?? '',
          observacoes: (content.observacoes as string) ?? '',
        }}
        readonly={isReadonly}
      />

      <h2>CID-11 vinculados ({cids.length})</h2>
      {cids.length === 0 ? (
        <p style={{ color: 'var(--ev-muted)' }}>Nenhum CID. Pelo menos 1 principal antes de fechar.</p>
      ) : (
        <table className="ev-table" style={{ width: '100%' }}>
          <thead>
            <tr>
              <th>Código</th>
              <th>Tipo</th>
              <th>Notas</th>
            </tr>
          </thead>
          <tbody>
            {cids.map((c) => (
              <tr key={`${c.code}-${c.kind}`}>
                <td>
                  <code>{c.code}</code>
                </td>
                <td>{c.kind}</td>
                <td style={{ fontSize: 'var(--ev-font-xs)' }}>{c.notes ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>CIF vinculados ({cifs.length})</h2>
      {cifs.length === 0 ? (
        <p style={{ color: 'var(--ev-muted)' }}>—</p>
      ) : (
        <table className="ev-table" style={{ width: '100%' }}>
          <thead>
            <tr>
              <th>Código</th>
              <th>Qualifier</th>
              <th>Notas</th>
            </tr>
          </thead>
          <tbody>
            {cifs.map((c) => (
              <tr key={c.code}>
                <td>
                  <code>{c.code}</code>
                </td>
                <td>{c.qualifier}</td>
                <td style={{ fontSize: 'var(--ev-font-xs)' }}>{c.notes ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {isDraft && isAuthor && (
        <>
          <h2>Fechar consulta</h2>
          <div className="ev-card" style={{ padding: 'var(--ev-space-md)' }}>
            <p style={{ marginTop: 0 }}>
              Política <strong>{c.signatureMode}</strong> aplicada. Fechamento exige MFA
              recente (&lt;15min) + registro profissional ativo coerente com o tipo da
              consulta (ADR 0055). Após fechar, edição direta fica bloqueada —
              correções viram <strong>nota corretiva</strong> append-only.
            </p>
            <LockConsultaForm
              consultaId={id}
              signatureMode={c.signatureMode}
              hasPrincipalCid={cids.some((c) => c.kind === 'principal')}
            />
          </div>
        </>
      )}

      {!isDraft && (
        <>
          <h2>🔒 Lacre / assinatura</h2>
          <div className="ev-card" style={{ padding: 'var(--ev-space-md)' }}>
            <div style={{ fontSize: 'var(--ev-font-xs)' }}>
              <strong>Hash SHA-256 do conteúdo (regra 39):</strong>
            </div>
            <div style={{ fontFamily: 'monospace', fontSize: 'var(--ev-font-xs)', wordBreak: 'break-all' }}>
              {c.signedHash ?? '—'}
            </div>
            {councilSnap && (
              <>
                <div style={{ marginTop: 8, fontSize: 'var(--ev-font-xs)' }}>
                  <strong>Profissional executante:</strong>
                </div>
                <div>
                  {councilSnap.councilBody ?? ''}-{councilSnap.councilState ?? ''}{' '}
                  {councilSnap.councilNumber ?? ''}
                </div>
              </>
            )}
            {c.signatureProvider && (
              <div style={{ marginTop: 8, fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>
                Provider: {c.signatureProvider}
              </div>
            )}
          </div>

          <h2>Notas corretivas ({correctionNotes.length})</h2>
          {correctionNotes.length === 0 ? (
            <p style={{ color: 'var(--ev-muted)' }}>—</p>
          ) : (
            <table className="ev-table" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Motivo</th>
                  <th>Corpo</th>
                  <th>Hash</th>
                </tr>
              </thead>
              <tbody>
                {correctionNotes.map((n) => (
                  <tr key={n.id}>
                    <td style={{ fontSize: 'var(--ev-font-xs)' }}>
                      {new Date(n.createdAt).toLocaleString('pt-BR')}
                    </td>
                    <td>{n.reason}</td>
                    <td style={{ fontSize: 'var(--ev-font-xs)' }}>{n.body}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: 'var(--ev-font-xs)' }}>
                      {n.contentHash.slice(0, 12)}…
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <CorrectionNoteForm consultaId={id} />
        </>
      )}
    </div>
  )
}
