/**
 * `/app/biblioteca/exercicios/new` — cadastro de exercício no tenant.
 *
 * Biblioteca global é seedada fora do app (curadoria LogiFit) — esta tela
 * cadastra apenas em tenant_id próprio.
 */
import Link from 'next/link'
import { requireFullSession } from '../../../../lib/session'
import { NewExerciseForm } from './new-exercise-form'

export const dynamic = 'force-dynamic'

export default async function NewExercisePage() {
  await requireFullSession('/app/biblioteca/exercicios/new')

  return (
    <div className="mx-auto max-w-2xl px-6 py-8 space-y-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Novo exercício</h1>
          <p className="text-sm text-[color:var(--ev-text-muted)]">
            Cadastra no catálogo do tenant. Biblioteca global é gerenciada pela LogiFit.
          </p>
        </div>
        <Link
          href="/app/biblioteca/exercicios"
          className="rounded-md border border-[color:var(--ev-border)] px-3 py-2 text-sm hover:bg-[color:var(--ev-surface)]"
        >
          Cancelar
        </Link>
      </header>

      <NewExerciseForm />
    </div>
  )
}
