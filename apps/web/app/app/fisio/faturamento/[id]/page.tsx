/**
 * `/app/fisio/faturamento/[id]` — detalhe da guia + XML preview (Sprint 22 Faixa C).
 */
import { and, asc, desc, eq } from 'drizzle-orm'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { db } from '@repo/db/client'
import {
  billingGlosas,
  billingGuideItems,
  billingGuides,
  members,
  persons,
} from '@repo/db/schema'
import { requireFullSession } from '../../../../lib/session'

export const dynamic = 'force-dynamic'

function formatBrl(cents: number | null | undefined): string {
  if (cents == null) return '—'
  return (Number(cents) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export default async function GuideDetailPage({
  params,
}: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await requireFullSession(`/app/fisio/faturamento/${id}`)
  const tenantId = session.logifit.tenantId

  const [g] = await db
    .select({
      id: billingGuides.id,
      guideNumber: billingGuides.guideNumber,
      operatorGuideNumber: billingGuides.operatorGuideNumber,
      kind: billingGuides.kind,
      status: billingGuides.status,
      totalCents: billingGuides.totalCents,
      copayCents: billingGuides.copayCents,
      paidAmountCents: billingGuides.paidAmountCents,
      sentAt: billingGuides.sentAt,
      paidAt: billingGuides.paidAt,
      xmlSent: billingGuides.xmlSent,
      tussVersion: billingGuides.tussVersion,
      professionalSnapshot: billingGuides.professionalSnapshot,
      createdAt: billingGuides.createdAt,
      memberName: persons.name,
    })
    .from(billingGuides)
    .leftJoin(members, eq(members.id, billingGuides.memberId))
    .leftJoin(persons, eq(persons.id, members.personId))
    .where(and(eq(billingGuides.id, id), eq(billingGuides.tenantId, tenantId)))
    .limit(1)
  if (!g) notFound()

  const items = await db
    .select()
    .from(billingGuideItems)
    .where(eq(billingGuideItems.guideId, id))
    .orderBy(asc(billingGuideItems.sequenceNumber))

  const glosas = await db
    .select()
    .from(billingGlosas)
    .where(and(eq(billingGlosas.guideId, id), eq(billingGlosas.tenantId, tenantId)))
    .orderBy(desc(billingGlosas.receivedAt))

  const profSnap = (g.professionalSnapshot as {
    name?: string
    councilBody?: string
    councilState?: string
    councilNumber?: string
    cbosCode?: string
  } | null) ?? null

  return (
    <div className="ev-stack" style={{ padding: 'var(--ev-space-lg)' }}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--ev-space-md)' }}>
        <h1 style={{ margin: 0 }}>
          Guia <code>{g.guideNumber}</code>
        </h1>
        <span className="ev-badge">{g.status}</span>
        <span className="ev-badge">{g.kind}</span>
        <span style={{ flex: 1 }} />
        <Link href="/app/fisio/faturamento" className="ev-btn ev-btn-ghost">
          ← Lista
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
          <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>Total</div>
          <div style={{ fontSize: 'var(--ev-font-lg)', fontWeight: 600 }}>
            {formatBrl(g.totalCents)}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>
            Co-participação
          </div>
          <div style={{ fontSize: 'var(--ev-font-lg)', fontWeight: 600 }}>
            {formatBrl(g.copayCents)}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>Recebido</div>
          <div
            style={{
              fontSize: 'var(--ev-font-lg)',
              fontWeight: 600,
              color: 'var(--ev-success, #16a34a)',
            }}
          >
            {formatBrl(g.paidAmountCents)}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>TUSS</div>
          <div style={{ fontSize: 'var(--ev-font-lg)', fontWeight: 600 }}>{g.tussVersion}</div>
        </div>
      </section>

      <section className="ev-card" style={{ padding: 'var(--ev-space-md)' }}>
        <div><strong>Paciente:</strong> {g.memberName ?? '—'}</div>
        <div><strong>Criada:</strong> {new Date(g.createdAt).toLocaleString('pt-BR')}</div>
        <div>
          <strong>Enviada:</strong>{' '}
          {g.sentAt ? new Date(g.sentAt).toLocaleString('pt-BR') : '—'}
        </div>
        <div>
          <strong>Paga:</strong> {g.paidAt ? new Date(g.paidAt).toLocaleString('pt-BR') : '—'}
        </div>
        {g.operatorGuideNumber && (
          <div>
            <strong>Nº na operadora:</strong> <code>{g.operatorGuideNumber}</code>
          </div>
        )}
        {profSnap && (
          <div style={{ marginTop: 8 }}>
            <strong>Profissional executante:</strong> {profSnap.name} — {profSnap.councilBody}-
            {profSnap.councilState} {profSnap.councilNumber} (CBOS {profSnap.cbosCode})
          </div>
        )}
      </section>

      <h2>Itens ({items.length})</h2>
      <table className="ev-table" style={{ width: '100%' }}>
        <thead>
          <tr>
            <th>#</th>
            <th>TUSS</th>
            <th>Descrição</th>
            <th>Qty</th>
            <th>Unit</th>
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => (
            <tr key={it.id}>
              <td>{it.sequenceNumber}</td>
              <td>
                <code>{it.tussCode}</code>
              </td>
              <td>{it.description}</td>
              <td>{it.quantity}</td>
              <td>{formatBrl(it.unitPriceCents)}</td>
              <td>{formatBrl(it.totalCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {glosas.length > 0 && (
        <>
          <h2>⚠ Glosas ({glosas.length})</h2>
          <table className="ev-table" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th>Código</th>
                <th>Descrição</th>
                <th>Valor</th>
                <th>Status</th>
                <th>Recebida em</th>
              </tr>
            </thead>
            <tbody>
              {glosas.map((gl) => (
                <tr key={gl.id}>
                  <td>
                    <code>{gl.reasonCode}</code>
                  </td>
                  <td style={{ fontSize: 'var(--ev-font-xs)' }}>{gl.reasonDescription}</td>
                  <td>{formatBrl(gl.amountGlossedCents)}</td>
                  <td>
                    <span className="ev-badge">{gl.status}</span>
                  </td>
                  <td style={{ fontSize: 'var(--ev-font-xs)' }}>
                    {new Date(gl.receivedAt).toLocaleString('pt-BR')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {g.xmlSent && (
        <details>
          <summary>📄 XML TISS 4.01 enviado ({g.xmlSent.length} chars)</summary>
          <pre
            style={{
              background: 'var(--ev-surface)',
              padding: 'var(--ev-space-md)',
              fontSize: 'var(--ev-font-xs)',
              overflowX: 'auto',
              borderRadius: 'var(--ev-radius)',
            }}
          >
            {g.xmlSent}
          </pre>
        </details>
      )}
    </div>
  )
}
