import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getMember, listTimeline } from '../../actions'

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

export default async function TimelinePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const memberResult = await getMember({ id })
  if (!memberResult.ok || !memberResult.data) notFound()
  const { person } = memberResult.data

  const result = await listTimeline({ memberId: id, limit: 200 })
  const timeline = result.ok ? result.data : []

  return (
    <main className="mx-auto max-w-4xl px-6 py-8 space-y-6">
      <header className="space-y-1">
        <Link
          href={`/app/members/${id}`}
          className="text-sm text-[color:var(--ev-text-muted)] hover:underline"
        >
          ← Voltar para {person.name}
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">Timeline completa</h1>
        <p className="text-sm text-[color:var(--ev-text-muted)]">
          Eventos append-only (regra 5). Sprints 03/04/06/08 vão adicionar mais kinds.
        </p>
      </header>

      {timeline.length === 0 ? (
        <div className="rounded-md border border-dashed border-[color:var(--ev-border)] p-8 text-center text-sm text-[color:var(--ev-text-muted)]">
          Nenhum evento ainda.
        </div>
      ) : (
        <ol className="space-y-3 border-l-2 border-[color:var(--ev-border)] pl-6">
          {timeline.map((e) => (
            <li key={e.id} className="relative">
              <span
                className="absolute -left-[27px] top-2 h-3 w-3 rounded-full bg-[color:var(--ev-primary)]"
                aria-hidden="true"
              />
              <div className="rounded-md bg-[color:var(--ev-surface)] p-3 text-sm">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="font-medium">{KIND_LABELS[e.kind] ?? e.kind}</span>
                  <span className="text-xs text-[color:var(--ev-text-muted)]">
                    {new Date(e.at).toLocaleString('pt-BR')}
                  </span>
                </div>
                {e.payload != null && Object.keys(e.payload as object).length > 0 && (
                  <pre className="mt-2 overflow-x-auto rounded bg-[color:var(--ev-bg)] p-2 text-xs">
                    {JSON.stringify(e.payload, null, 2)}
                  </pre>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </main>
  )
}
