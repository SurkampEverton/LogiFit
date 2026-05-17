/**
 * `/app/avaliacoes/tipos/new` — cadastro de tipo customizado (Sprint 12 Faixa C).
 *
 * Editor low-code de campos: nome + categoria + vertical + lista de fields
 * (key, label, kind, unit, min, max).
 */
import Link from 'next/link'
import { requireFullSession } from '../../../../lib/session'
import { NewAssessmentTypeForm } from './new-type-form'

export const dynamic = 'force-dynamic'

export default async function NewAssessmentTypePage() {
  await requireFullSession('/app/avaliacoes/tipos/new')

  return (
    <div className="mx-auto max-w-2xl px-6 py-8 space-y-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Novo tipo de avaliação</h1>
          <p className="text-sm text-[color:var(--ev-text-muted)]">
            Define os campos (low-code). Biblioteca global é gerenciada pela LogiFit.
          </p>
        </div>
        <Link
          href="/app/avaliacoes/tipos"
          className="rounded-md border border-[color:var(--ev-border)] px-3 py-2 text-sm hover:bg-[color:var(--ev-surface)]"
        >
          Cancelar
        </Link>
      </header>

      <NewAssessmentTypeForm />
    </div>
  )
}
