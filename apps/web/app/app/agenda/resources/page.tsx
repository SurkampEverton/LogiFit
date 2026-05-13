/**
 * `/app/agenda/resources` — lista recursos (instrutor/sala/equipamento).
 * Sprint 03 Faixa C.
 */
import Link from 'next/link'
import { requireFullSession } from '../../../lib/session'
import { listResources } from '../actions'

export const dynamic = 'force-dynamic'

const KIND_LABEL: Record<string, string> = {
  instrutor: '👤 Instrutor',
  sala: '🚪 Sala',
  equipamento: '🏋️ Equipamento',
}

export default async function ResourcesPage({
  searchParams,
}: {
  searchParams: Promise<{ archived?: string }>
}) {
  await requireFullSession('/app/agenda/resources')
  const params = await searchParams
  const includeArchived = params.archived === '1'

  const result = await listResources({ includeArchived, limit: 200 })
  const resources = result.ok ? result.data.resources : []

  return (
    <div className="mx-auto max-w-5xl px-6 py-8 space-y-6">
      <nav className="text-sm">
        <Link href="/app/agenda" className="text-[color:var(--ev-text-muted)] hover:underline">
          ← Voltar para Agenda
        </Link>
      </nav>

      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-3xl font-semibold tracking-tight">Recursos</h1>
          <p className="text-sm text-[color:var(--ev-text-muted)]">
            Instrutores, salas e equipamentos que aparecem na agenda.
          </p>
        </div>
        <Link
          href="/app/agenda/resources/new"
          className="rounded-md bg-[color:var(--ev-primary)] px-4 py-2 font-medium text-[color:var(--ev-primary-foreground)]"
          style={{ minHeight: 'var(--ev-touch-min, 44px)' }}
        >
          + Novo recurso
        </Link>
      </header>

      <div className="flex items-center gap-3 text-sm">
        <Link
          href={includeArchived ? '/app/agenda/resources' : '/app/agenda/resources?archived=1'}
          className="text-[color:var(--ev-primary)] hover:underline"
        >
          {includeArchived ? 'Ocultar arquivados' : 'Mostrar arquivados'}
        </Link>
      </div>

      {resources.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[color:var(--ev-border)] p-8 text-center">
          <p className="text-[color:var(--ev-text-muted)]">Nenhum recurso cadastrado.</p>
          <Link
            href="/app/agenda/resources/new"
            className="mt-3 inline-block font-medium text-[color:var(--ev-primary)]"
          >
            Cadastrar primeiro recurso →
          </Link>
        </div>
      ) : (
        <section className="rounded-xl border border-[color:var(--ev-border)] overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-[color:var(--ev-surface-muted)] text-left">
              <tr>
                <th className="px-4 py-3 font-medium">Tipo</th>
                <th className="px-4 py-3 font-medium">Nome</th>
                <th className="px-4 py-3 font-medium">Modalidade</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {resources.map((r) => (
                <tr key={r.id} className="border-t border-[color:var(--ev-border)]">
                  <td className="px-4 py-3">{KIND_LABEL[r.kind] ?? r.kind}</td>
                  <td className="px-4 py-3 font-medium">{r.name}</td>
                  <td className="px-4 py-3 text-[color:var(--ev-text-muted)]">
                    {r.modality ?? '—'}
                  </td>
                  <td className="px-4 py-3">
                    {r.archivedAt ? (
                      <span className="text-[color:var(--ev-text-muted)]">Arquivado</span>
                    ) : (
                      <span className="text-[color:var(--ev-success, #10b981)]">Ativo</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  )
}
