/**
 * `/app/vendas/leads` — lista tabular de leads ativos (Sprint 10 Faixa C).
 *
 * Tabela responsiva com filtros via querystring (?stage=...&assigned=...);
 * filtros completos ficam Faixa D+.
 */
import { and, desc, eq, isNull } from 'drizzle-orm'
import Link from 'next/link'
import { db } from '@repo/db/client'
import { alias } from 'drizzle-orm/pg-core'
import { leadStages, leads, persons, users } from '@repo/db/schema'
import { requireFullSession } from '../../../lib/session'

export const dynamic = 'force-dynamic'

interface PageProps {
  searchParams: Promise<{ stage?: string; assigned?: string }>
}

export default async function VendasLeadsListPage({ searchParams }: PageProps) {
  const session = await requireFullSession('/app/vendas/leads')
  const tenantId = session.logifit.tenantId
  const sp = await searchParams

  const conditions = [eq(leads.tenantId, tenantId), isNull(leads.archivedAt)]
  if (sp.stage) conditions.push(eq(leads.stageId, sp.stage))
  if (sp.assigned) conditions.push(eq(leads.assignedToUserId, sp.assigned))

  // alias persons pra dois joins distintos (lead.person + lead.assigned_user.person)
  const assignedPerson = alias(persons, 'assigned_person')

  const rows = await db
    .select({
      id: leads.id,
      quickName: leads.quickName,
      quickPhone: leads.quickPhone,
      quickEmail: leads.quickEmail,
      source: leads.source,
      interest: leads.interest,
      createdAt: leads.createdAt,
      personName: persons.name,
      personDocument: persons.document,
      stageName: leadStages.name,
      stageKind: leadStages.kind,
      assignedName: assignedPerson.name,
    })
    .from(leads)
    .leftJoin(persons, eq(persons.id, leads.personId))
    .leftJoin(leadStages, eq(leadStages.id, leads.stageId))
    .leftJoin(users, eq(users.id, leads.assignedToUserId))
    .leftJoin(assignedPerson, eq(assignedPerson.id, users.personId))
    .where(and(...conditions))
    .orderBy(desc(leads.createdAt))
    .limit(200)

  return (
    <div className="mx-auto max-w-7xl px-6 py-8 space-y-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Leads</h1>
          <p className="text-sm text-[color:var(--ev-text-muted)]">
            {rows.length} leads listados {sp.stage && '· filtrado por estágio'}
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/app/vendas"
            className="rounded-md border border-[color:var(--ev-border)] px-3 py-2 text-sm hover:bg-[color:var(--ev-surface)]"
          >
            Board kanban
          </Link>
          <Link
            href="/app/vendas/leads/new"
            className="rounded-md bg-[color:var(--ev-primary)] px-3 py-2 text-sm text-white hover:opacity-90"
          >
            + Novo lead
          </Link>
        </div>
      </header>

      <div className="overflow-x-auto rounded-xl border border-[color:var(--ev-border)]">
        <table className="w-full text-sm">
          <thead className="bg-[color:var(--ev-surface)] text-left text-xs uppercase tracking-wide text-[color:var(--ev-text-muted)]">
            <tr>
              <th className="px-3 py-2">Nome / Contato</th>
              <th className="px-3 py-2">Estágio</th>
              <th className="px-3 py-2">Origem</th>
              <th className="px-3 py-2">Interesse</th>
              <th className="px-3 py-2">Responsável</th>
              <th className="px-3 py-2">Criado</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-[color:var(--ev-text-muted)]">
                  Nenhum lead encontrado.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={row.id}
                  className="border-t border-[color:var(--ev-border)] hover:bg-[color:var(--ev-surface)]"
                >
                  <td className="px-3 py-2">
                    <Link href={`/app/vendas/leads/${row.id}`} className="font-medium hover:underline">
                      {row.personName ?? row.quickName ?? '(sem nome)'}
                    </Link>
                    <div className="text-xs text-[color:var(--ev-text-muted)]">
                      {row.quickPhone ?? '—'} {row.quickEmail && `· ${row.quickEmail}`}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className="rounded-full px-2 py-0.5 text-xs"
                      style={{
                        backgroundColor:
                          row.stageKind === 'won'
                            ? 'rgba(34,197,94,0.15)'
                            : row.stageKind === 'lost'
                              ? 'rgba(239,68,68,0.15)'
                              : 'var(--ev-surface)',
                      }}
                    >
                      {row.stageName ?? '—'}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs">{row.source}</td>
                  <td className="px-3 py-2 text-xs truncate max-w-[200px]">
                    {row.interest ?? '—'}
                  </td>
                  <td className="px-3 py-2 text-xs">{row.assignedName ?? '—'}</td>
                  <td className="px-3 py-2 text-xs text-[color:var(--ev-text-muted)] tabular-nums">
                    {row.createdAt.toLocaleDateString('pt-BR')}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
