/**
 * `/app/settings/privacidade` — fila DPO de Data Subject Requests (LGPD art. 18).
 *
 * Sprint 01b fechamento — stub básico de listagem + criação manual via DPO.
 * Sprint 26 entrega `/meu/privacidade` portal completo pro titular criar
 * requests via self-service.
 *
 * MVP: lista DSR cadastradas + filtros estado + alertas SLA (15 dias úteis
 * Resolução ANPD 2/2024).
 */
import { and, desc, eq, sql } from 'drizzle-orm'
import Link from 'next/link'
import { db } from '@repo/db/client'
import { dataSubjectRequests, persons } from '@repo/db/schema'
import { requireFullSession } from '../../../lib/session'

export const dynamic = 'force-dynamic'

const STATE_LABEL: Record<string, string> = {
  received: '📥 Recebida',
  triaged: '📋 Triagem',
  in_progress: '⚙ Em andamento',
  awaiting_titular: '⏳ Aguarda titular',
  fulfilled: '✓ Concluída',
  partially_fulfilled: '◐ Parcial',
  rejected: '🚫 Rejeitada',
  cancelled: 'cancelada',
}

const STATE_COLOR: Record<string, string> = {
  received: 'var(--ev-warning, #f59e0b)',
  triaged: 'var(--ev-primary)',
  in_progress: 'var(--ev-primary)',
  awaiting_titular: 'var(--ev-warning, #f59e0b)',
  fulfilled: 'var(--ev-success, #10b981)',
  partially_fulfilled: 'var(--ev-success, #10b981)',
  rejected: 'var(--ev-text-muted)',
  cancelled: 'var(--ev-text-muted)',
}

const KIND_LABEL: Record<string, string> = {
  access: 'Acesso (art. 18 II)',
  anonymization: 'Anonimização (art. 18 VI)',
  deletion: 'Eliminação (art. 18 VI)',
  correction: 'Correção (art. 18 III)',
  portability: 'Portabilidade (art. 18 V)',
  consent_revocation: 'Revogação consent (art. 18 IX)',
  opposition: 'Oposição ao tratamento (art. 18 § 2º)',
}

function slaStatus(slaDueAt: Date, state: string): { label: string; color: string } {
  if (['fulfilled', 'partially_fulfilled', 'rejected', 'cancelled'].includes(state)) {
    return { label: 'OK', color: 'var(--ev-text-muted)' }
  }
  const daysLeft = Math.ceil((slaDueAt.getTime() - Date.now()) / 86_400_000)
  if (daysLeft < 0) return { label: `${-daysLeft}d atraso`, color: 'var(--ev-danger)' }
  if (daysLeft < 3) return { label: `${daysLeft}d`, color: 'var(--ev-warning, #f59e0b)' }
  return { label: `${daysLeft}d`, color: 'var(--ev-success, #10b981)' }
}

export default async function PrivacidadePage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string }>
}) {
  const session = await requireFullSession('/app/settings/privacidade')
  const params = await searchParams
  const stateFilter = params.state

  const conditions = [eq(dataSubjectRequests.tenantId, session.logifit.tenantId)]
  if (stateFilter && stateFilter !== 'all') {
    conditions.push(
      eq(
        dataSubjectRequests.state,
        stateFilter as
          | 'received'
          | 'triaged'
          | 'in_progress'
          | 'awaiting_titular'
          | 'fulfilled'
          | 'partially_fulfilled'
          | 'rejected'
          | 'cancelled',
      ),
    )
  }

  const rows = await db
    .select({
      id: dataSubjectRequests.id,
      kind: dataSubjectRequests.kind,
      state: dataSubjectRequests.state,
      slaDueAt: dataSubjectRequests.slaDueAt,
      subjectName: dataSubjectRequests.subjectName,
      subjectEmail: dataSubjectRequests.subjectEmail,
      personName: persons.name,
      createdAt: dataSubjectRequests.createdAt,
    })
    .from(dataSubjectRequests)
    .leftJoin(persons, eq(persons.id, dataSubjectRequests.subjectPersonId))
    .where(and(...conditions))
    .orderBy(desc(dataSubjectRequests.createdAt))
    .limit(100)

  // Stats agregadas
  const [stats] = await db
    .select({
      total: sql<number>`count(*)::int`,
      pending: sql<number>`count(*) FILTER (WHERE state IN ('received', 'triaged', 'in_progress', 'awaiting_titular'))::int`,
      overdue: sql<number>`count(*) FILTER (WHERE state IN ('received', 'triaged', 'in_progress', 'awaiting_titular') AND sla_due_at < now())::int`,
    })
    .from(dataSubjectRequests)
    .where(eq(dataSubjectRequests.tenantId, session.logifit.tenantId))

  return (
    <div className="mx-auto max-w-6xl px-6 py-8 space-y-6">
      <header className="space-y-1">
        <h1 className="text-3xl font-semibold tracking-tight">Privacidade · DSR</h1>
        <p className="text-sm text-[color:var(--ev-text-muted)]">
          Direitos do titular LGPD art. 18 · SLA 15 dias úteis (Resolução ANPD 2/2024).
          Portal self-service `/meu/privacidade` no Sprint 26.
        </p>
      </header>

      <section
        className="grid gap-4"
        style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}
      >
        <div className="rounded-xl border border-[color:var(--ev-border)] p-5 space-y-1">
          <div className="text-xs text-[color:var(--ev-text-muted)] uppercase">Total DSR</div>
          <div className="text-2xl font-semibold tabular-nums">{stats?.total ?? 0}</div>
        </div>
        <div className="rounded-xl border border-[color:var(--ev-border)] p-5 space-y-1">
          <div className="text-xs text-[color:var(--ev-text-muted)] uppercase">Pendentes</div>
          <div className="text-2xl font-semibold tabular-nums">{stats?.pending ?? 0}</div>
        </div>
        <div
          className="rounded-xl border p-5 space-y-1"
          style={{
            borderColor: (stats?.overdue ?? 0) > 0 ? 'var(--ev-danger)' : 'var(--ev-border)',
          }}
        >
          <div className="text-xs text-[color:var(--ev-text-muted)] uppercase">⚠ SLA estourado</div>
          <div
            className="text-2xl font-semibold tabular-nums"
            style={{ color: (stats?.overdue ?? 0) > 0 ? 'var(--ev-danger)' : undefined }}
          >
            {stats?.overdue ?? 0}
          </div>
        </div>
      </section>

      <div className="flex items-center gap-3 text-sm flex-wrap">
        <span className="text-[color:var(--ev-text-muted)]">Filtrar:</span>
        <Link
          href="/app/settings/privacidade"
          className={
            !stateFilter || stateFilter === 'all'
              ? 'font-medium text-[color:var(--ev-primary)]'
              : 'text-[color:var(--ev-text-muted)] hover:underline'
          }
        >
          Todos
        </Link>
        {Object.keys(STATE_LABEL).map((s) => (
          <Link
            key={s}
            href={`/app/settings/privacidade?state=${s}`}
            className={
              stateFilter === s
                ? 'font-medium text-[color:var(--ev-primary)]'
                : 'text-[color:var(--ev-text-muted)] hover:underline'
            }
          >
            {STATE_LABEL[s]}
          </Link>
        ))}
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[color:var(--ev-border)] p-8 text-center">
          <p className="text-[color:var(--ev-text-muted)]">
            Nenhuma DSR{' '}
            {stateFilter && stateFilter !== 'all' ? `com estado "${STATE_LABEL[stateFilter]}"` : 'registrada'}.
          </p>
          <p className="text-xs text-[color:var(--ev-text-muted)] mt-2">
            Titular pode solicitar via email <strong>privacidade@logifit.com.br</strong> (canal
            oficial até Sprint 26 entregar portal self-service).
          </p>
        </div>
      ) : (
        <section className="rounded-xl border border-[color:var(--ev-border)] overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-[color:var(--ev-surface-muted)] text-left">
              <tr>
                <th className="px-4 py-3 font-medium">Titular</th>
                <th className="px-4 py-3 font-medium">Tipo</th>
                <th className="px-4 py-3 font-medium">Estado</th>
                <th className="px-4 py-3 font-medium">SLA</th>
                <th className="px-4 py-3 font-medium">Criada em</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const sla = slaStatus(r.slaDueAt, r.state)
                return (
                  <tr key={r.id} className="border-t border-[color:var(--ev-border)]">
                    <td className="px-4 py-3">
                      <div className="font-medium">{r.personName ?? r.subjectName ?? '—'}</div>
                      <div className="text-xs text-[color:var(--ev-text-muted)]">
                        {r.subjectEmail ?? ''}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-[color:var(--ev-text-muted)]">
                      {KIND_LABEL[r.kind] ?? r.kind}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className="text-xs font-medium"
                        style={{ color: STATE_COLOR[r.state] ?? 'var(--ev-text)' }}
                      >
                        {STATE_LABEL[r.state] ?? r.state}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className="text-xs font-medium tabular-nums"
                        style={{ color: sla.color }}
                      >
                        {sla.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-[color:var(--ev-text-muted)] tabular-nums">
                      {new Date(r.createdAt).toLocaleDateString('pt-BR')}
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
