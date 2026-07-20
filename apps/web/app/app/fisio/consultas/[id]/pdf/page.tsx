import { db } from '@repo/db/client'
import { consultaCids, consultaCifs, consultas, members, persons } from '@repo/db/schema'
/**
 * `/app/fisio/consultas/[id]/pdf` — preview HTML do prontuário (Sprint 20 Faixa C).
 *
 * MVP renderiza HTML com layout PDF-like + hash + dados profissional.
 * Sprint 20b implementa @react-pdf/renderer real + carimbo ICP-Brasil.
 */
import { and, asc, eq } from 'drizzle-orm'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireFullSession } from '../../../../../lib/session'

export const dynamic = 'force-dynamic'

export default async function ConsultaPdfPreview({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await requireFullSession(`/app/fisio/consultas/${id}/pdf`)
  const tenantId = session.logifit.tenantId

  const [c] = await db
    .select({
      id: consultas.id,
      memberName: persons.name,
      memberId: consultas.memberId,
      kind: consultas.kind,
      status: consultas.status,
      content: consultas.content,
      signedAt: consultas.signedAt,
      signedHash: consultas.signedHash,
      lockedAt: consultas.lockedAt,
      lockMethod: consultas.lockMethod,
      councilSnapshot: consultas.councilSnapshot,
      signatureProvider: consultas.signatureProvider,
      createdAt: consultas.createdAt,
    })
    .from(consultas)
    .leftJoin(members, eq(members.id, consultas.memberId))
    .leftJoin(persons, eq(persons.id, members.personId))
    .where(and(eq(consultas.id, id), eq(consultas.tenantId, tenantId)))
    .limit(1)
  if (!c) notFound()

  const cids = await db
    .select({ code: consultaCids.cidCode, kind: consultaCids.kind })
    .from(consultaCids)
    .where(eq(consultaCids.consultaId, id))
    .orderBy(asc(consultaCids.cidCode))

  const cifs = await db
    .select({ code: consultaCifs.cifCode, qualifier: consultaCifs.qualifier })
    .from(consultaCifs)
    .where(eq(consultaCifs.consultaId, id))
    .orderBy(asc(consultaCifs.cifCode))

  const content = (c.content as Record<string, unknown>) ?? {}
  const council = (c.councilSnapshot as Record<string, unknown>) ?? {}

  return (
    <div className="ev-stack" style={{ padding: 'var(--ev-space-lg)', maxWidth: 800 }}>
      <header
        style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--ev-space-md)' }}
        className="no-print"
      >
        <h1 style={{ margin: 0 }}>PDF preview</h1>
        <span style={{ color: 'var(--ev-muted)' }}>
          (Sprint 20b implementa @react-pdf/renderer real)
        </span>
        <span style={{ flex: 1 }} />
        <Link href={`/app/fisio/consultas/${id}`} className="ev-btn ev-btn-ghost">
          ← Consulta
        </Link>
        <button
          onClick={() => window.print()}
          className="ev-btn ev-btn-primary"
          type="button"
          disabled
        >
          🖨 Imprimir (próximo sprint)
        </button>
      </header>

      <article
        style={{
          background: 'white',
          color: 'black',
          padding: '40px 50px',
          border: '1px solid #ddd',
          fontFamily: 'Georgia, serif',
          lineHeight: 1.5,
        }}
      >
        <header style={{ borderBottom: '2px solid #333', paddingBottom: 12, marginBottom: 20 }}>
          <h1 style={{ fontSize: 22, margin: 0 }}>PRONTUÁRIO ELETRÔNICO</h1>
          <div style={{ fontSize: 12, color: '#666' }}>
            LogiFit · Lei 13.787/2018 — retenção 20 anos
          </div>
        </header>

        <section>
          <strong>Paciente:</strong> {c.memberName ?? '—'}
          <br />
          <strong>Tipo:</strong> {c.kind}
          <br />
          <strong>Criada em:</strong> {new Date(c.createdAt).toLocaleString('pt-BR')}
        </section>

        <h2 style={{ fontSize: 16, marginTop: 24 }}>Subjetivo / Queixa</h2>
        <p>{(content.queixa as string) || '—'}</p>

        <h2 style={{ fontSize: 16 }}>Objetivo / Avaliação</h2>
        <p>{(content.avaliacao as string) || '—'}</p>

        <h2 style={{ fontSize: 16 }}>Plano / Conduta</h2>
        <p>{(content.conduta as string) || '—'}</p>

        {(content.observacoes as string) && (
          <>
            <h2 style={{ fontSize: 16 }}>Observações</h2>
            <p>{content.observacoes as string}</p>
          </>
        )}

        {cids.length > 0 && (
          <>
            <h2 style={{ fontSize: 16 }}>CID-11</h2>
            <ul>
              {cids.map((c) => (
                <li key={`${c.code}-${c.kind}`}>
                  <code>{c.code}</code> ({c.kind})
                </li>
              ))}
            </ul>
          </>
        )}

        {cifs.length > 0 && (
          <>
            <h2 style={{ fontSize: 16 }}>CIF</h2>
            <ul>
              {cifs.map((c) => (
                <li key={c.code}>
                  <code>{c.code}</code> — qualifier {c.qualifier}
                </li>
              ))}
            </ul>
          </>
        )}

        <footer
          style={{
            marginTop: 40,
            paddingTop: 16,
            borderTop: '1px solid #333',
            fontSize: 12,
            color: '#444',
          }}
        >
          {c.status !== 'draft' ? (
            <>
              <div>
                <strong>Status:</strong>{' '}
                {c.status === 'signed' ? 'ASSINADO ICP-Brasil' : 'LACRADO (lacre autenticado)'}
              </div>
              <div>
                <strong>Método:</strong> {c.lockMethod}
              </div>
              {c.signatureProvider && (
                <div>
                  <strong>Provider:</strong> {c.signatureProvider}
                </div>
              )}
              <div>
                <strong>Quando:</strong>{' '}
                {c.signedAt
                  ? new Date(c.signedAt).toLocaleString('pt-BR')
                  : c.lockedAt
                    ? new Date(c.lockedAt).toLocaleString('pt-BR')
                    : '—'}
              </div>
              <div style={{ fontFamily: 'monospace', wordBreak: 'break-all', marginTop: 8 }}>
                <strong>Hash SHA-256 (regra 39):</strong>
                <br />
                {c.signedHash ?? '—'}
              </div>
              {council.councilBody && (
                <div style={{ marginTop: 8 }}>
                  <strong>Profissional executante:</strong> {council.councilBody as string}-
                  {council.councilState as string} {council.councilNumber as string}
                </div>
              )}
            </>
          ) : (
            <div style={{ color: '#999', fontStyle: 'italic' }}>
              Rascunho — não imprimível até fechamento.
            </div>
          )}
        </footer>
      </article>
    </div>
  )
}
