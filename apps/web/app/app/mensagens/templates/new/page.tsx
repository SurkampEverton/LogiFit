/**
 * `/app/mensagens/templates/new` — cadastro de template (Sprint 13 Faixa C).
 */
import Link from 'next/link'
import { requireFullSession } from '../../../../lib/session'
import { NewTemplateForm } from './new-template-form'

export const dynamic = 'force-dynamic'

export default async function NewTemplatePage() {
  await requireFullSession('/app/mensagens/templates/new')

  return (
    <div className="mx-auto max-w-2xl px-6 py-8 space-y-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Novo template</h1>
          <p className="text-sm text-[color:var(--ev-text-muted)]">
            Use <code>{`{{member.name}}`}</code>, <code>{`{{invoice.amount}}`}</code>
            , etc.
          </p>
        </div>
        <Link
          href="/app/mensagens/templates"
          className="rounded-md border border-[color:var(--ev-border)] px-3 py-2 text-sm hover:bg-[color:var(--ev-surface)]"
        >
          Cancelar
        </Link>
      </header>

      <NewTemplateForm />
    </div>
  )
}
