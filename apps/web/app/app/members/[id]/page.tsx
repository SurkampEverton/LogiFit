import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getMember, listTimeline } from '../actions'

export const dynamic = 'force-dynamic'

const KIND_LABELS: Record<string, string> = {
  'member.created': 'Cadastrado',
  'member.updated': 'Atualizado',
  'member.archived': 'Arquivado',
  'member.transferred': 'Transferido entre companies',
  'member.note_added': 'Anotação adicionada',
  'member.tag_added': 'Tag adicionada',
  'member.tag_removed': 'Tag removida',
}

export default async function MemberDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const detailResult = await getMember({ id })
  if (!detailResult.ok || !detailResult.data) notFound()
  const { member, person, company, tags } = detailResult.data

  // Timeline resumida (últimos 10 eventos) — widget overview ADR 0011
  const timelineResult = await listTimeline({ memberId: id, limit: 10 })
  const timeline = timelineResult.ok ? timelineResult.data : []

  const address = (person.address as Record<string, string | null> | null) ?? null

  return (
    <main className="mx-auto max-w-4xl px-6 py-8 space-y-6">
      <header className="space-y-1">
        <Link
          href="/app/members"
          className="text-sm text-[color:var(--ev-text-muted)] hover:underline"
        >
          ← Voltar pra members
        </Link>
        <div className="flex flex-wrap items-baseline gap-3">
          <h1 className="text-3xl font-semibold tracking-tight">{person.name}</h1>
          {member.archivedAt && (
            <span className="text-xs rounded-full bg-[color:var(--ev-warning-bg)] px-2 py-0.5">
              arquivado
            </span>
          )}
        </div>
        <p className="text-sm text-[color:var(--ev-text-muted)]">
          {company.type === 'matriz' ? 'Matriz' : 'Filial'}: {member.companyId.slice(0, 8)}…
          {person.document && ` · CPF ${person.document}`}
        </p>
      </header>

      {/* Slot OVERVIEW — ADR 0011 widget único MVP */}
      <section
        aria-labelledby="overview"
        className="rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-surface)] p-6 space-y-4"
      >
        <h2 id="overview" className="text-xl font-semibold">
          Visão geral
        </h2>

        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 text-sm">
          {person.email && (
            <div>
              <dt className="font-medium text-[color:var(--ev-text-muted)]">Email</dt>
              <dd>{person.email}</dd>
            </div>
          )}
          {person.phone && (
            <div>
              <dt className="font-medium text-[color:var(--ev-text-muted)]">Telefone</dt>
              <dd>{person.phone}</dd>
            </div>
          )}
          {person.birthDate && (
            <div>
              <dt className="font-medium text-[color:var(--ev-text-muted)]">Nascimento</dt>
              <dd>{person.birthDate}</dd>
            </div>
          )}
          {address && (address.cidade || address.uf) && (
            <div>
              <dt className="font-medium text-[color:var(--ev-text-muted)]">Cidade</dt>
              <dd>{[address.cidade, address.uf].filter(Boolean).join(' · ')}</dd>
            </div>
          )}
        </dl>

        {tags.length > 0 && (
          <div>
            <dt className="text-sm font-medium text-[color:var(--ev-text-muted)]">Tags</dt>
            <dd className="mt-1 flex flex-wrap gap-2">
              {tags.map((t) => (
                <span
                  key={t}
                  className="text-xs rounded-full bg-[color:var(--ev-surface)] border border-[color:var(--ev-border)] px-2 py-0.5"
                >
                  {t}
                </span>
              ))}
            </dd>
          </div>
        )}
      </section>

      {/* Slot TIMELINE — últimos 10 eventos */}
      <section
        aria-labelledby="timeline"
        className="rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-surface)] p-6 space-y-4"
      >
        <div className="flex items-baseline justify-between">
          <h2 id="timeline" className="text-xl font-semibold">
            Timeline
          </h2>
          <Link
            href={`/app/members/${id}/timeline`}
            className="text-sm text-[color:var(--ev-primary)] hover:underline"
          >
            Ver completo →
          </Link>
        </div>

        {timeline.length === 0 ? (
          <p className="text-sm text-[color:var(--ev-text-muted)]">Nenhum evento ainda.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {timeline.map((e) => (
              <li key={e.id} className="flex items-start gap-3">
                <span className="text-xs text-[color:var(--ev-text-muted)] tabular-nums w-32 shrink-0">
                  {new Date(e.at).toLocaleString('pt-BR')}
                </span>
                <span>{KIND_LABELS[e.kind] ?? e.kind}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Slots futuros — Sprint 03/04/06/08/09 */}
      <section className="rounded-md border border-dashed border-[color:var(--ev-border)] p-6 text-center text-sm text-[color:var(--ev-text-muted)]">
        <p>
          Widgets futuros: <strong>Agenda</strong> (Sprint 03) · <strong>Financeiro</strong> (Sprint
          04) · <strong>IA Copilot</strong> (Sprint 06) · <strong>Acessos</strong> (Sprint 08) ·{' '}
          <strong>Conquistas</strong> (Sprint 09)
        </p>
      </section>
    </main>
  )
}
