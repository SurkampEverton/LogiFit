/**
 * `/app/mensagens/reguas/new` — wizard de criação de régua (Sprint 13 Faixa C).
 *
 * MVP entrega builder visual simples (trigger + N actions). Editor JSON
 * avançado adiado pra Sprint 13b.
 */
import { and, asc, eq, isNull } from 'drizzle-orm'
import Link from 'next/link'
import { db } from '@repo/db/client'
import { messageTemplates } from '@repo/db/schema'
import { requireFullSession } from '../../../../lib/session'
import { NewReguaForm } from './new-regua-form'

export const dynamic = 'force-dynamic'

export default async function NewReguaPage() {
  const session = await requireFullSession('/app/mensagens/reguas/new')
  const tenantId = session.logifit.tenantId

  const templates = await db
    .select({
      id: messageTemplates.id,
      slug: messageTemplates.slug,
      name: messageTemplates.name,
      channel: messageTemplates.channel,
      approvalStatus: messageTemplates.approvalStatus,
    })
    .from(messageTemplates)
    .where(
      and(
        eq(messageTemplates.tenantId, tenantId),
        isNull(messageTemplates.archivedAt),
      ),
    )
    .orderBy(asc(messageTemplates.slug))

  return (
    <div className="mx-auto max-w-2xl px-6 py-8 space-y-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Nova régua</h1>
          <p className="text-sm text-[color:var(--ev-text-muted)]">
            Trigger (evento) → ações (envios + delays) → stop_on opcional
          </p>
        </div>
        <Link
          href="/app/mensagens/reguas"
          className="rounded-md border border-[color:var(--ev-border)] px-3 py-2 text-sm hover:bg-[color:var(--ev-surface)]"
        >
          Cancelar
        </Link>
      </header>

      <NewReguaForm templates={templates} />
    </div>
  )
}
