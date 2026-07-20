import { db } from '@repo/db/client'
import { messageTemplates, messagesSent, reguas } from '@repo/db/schema'
/**
 * `/app/mensagens` — hub mensagens (Sprint 13 Faixa C).
 *
 * Mostra contadores de templates/réguas/mensagens enviadas + links.
 */
import { and, count, eq, isNull } from 'drizzle-orm'
import Link from 'next/link'
import { requireFullSession } from '../../lib/session'

export const dynamic = 'force-dynamic'

export default async function MensagensHubPage() {
  const session = await requireFullSession('/app/mensagens')
  const tenantId = session.logifit.tenantId

  const [templatesCount, reguasCount, messagesCount] = await Promise.all([
    db
      .select({ n: count() })
      .from(messageTemplates)
      .where(and(eq(messageTemplates.tenantId, tenantId), isNull(messageTemplates.archivedAt))),
    db
      .select({ n: count() })
      .from(reguas)
      .where(and(eq(reguas.tenantId, tenantId), isNull(reguas.archivedAt))),
    db.select({ n: count() }).from(messagesSent).where(eq(messagesSent.tenantId, tenantId)),
  ])

  return (
    <div className="mx-auto max-w-[1200px] px-6 py-8 space-y-6">
      <header className="space-y-1">
        <h1 className="text-3xl font-semibold tracking-tight">Mensagens</h1>
        <p className="text-sm text-[color:var(--ev-text-muted)]">
          WhatsApp + Email + Régua de cobrança. Provider real (Twilio/Gupshup/Resend) será
          habilitado em Sprint 13b — MVP usa stub adapter.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Link
          href="/app/mensagens/templates"
          className="rounded-xl border border-[color:var(--ev-border)] bg-[color:var(--ev-surface)] p-5 hover:border-[color:var(--ev-primary)]"
        >
          <div className="text-xs uppercase tracking-wide text-[color:var(--ev-text-muted)]">
            Templates
          </div>
          <div className="text-3xl font-semibold tabular-nums mt-2">
            {templatesCount[0]?.n ?? 0}
          </div>
          <div className="text-xs text-[color:var(--ev-text-muted)] mt-1">
            mensagens com variáveis
          </div>
        </Link>

        <Link
          href="/app/mensagens/reguas"
          className="rounded-xl border border-[color:var(--ev-border)] bg-[color:var(--ev-surface)] p-5 hover:border-[color:var(--ev-primary)]"
        >
          <div className="text-xs uppercase tracking-wide text-[color:var(--ev-text-muted)]">
            Réguas
          </div>
          <div className="text-3xl font-semibold tabular-nums mt-2">{reguasCount[0]?.n ?? 0}</div>
          <div className="text-xs text-[color:var(--ev-text-muted)] mt-1">
            cobrança / reengajamento
          </div>
        </Link>

        <Link
          href="/app/mensagens/historico"
          className="rounded-xl border border-[color:var(--ev-border)] bg-[color:var(--ev-surface)] p-5 hover:border-[color:var(--ev-primary)]"
        >
          <div className="text-xs uppercase tracking-wide text-[color:var(--ev-text-muted)]">
            Histórico
          </div>
          <div className="text-3xl font-semibold tabular-nums mt-2">{messagesCount[0]?.n ?? 0}</div>
          <div className="text-xs text-[color:var(--ev-text-muted)] mt-1">
            mensagens registradas
          </div>
        </Link>

        <div className="rounded-xl border border-dashed border-[color:var(--ev-border)] p-5 text-xs text-[color:var(--ev-text-muted)]">
          <div className="text-sm font-medium text-[color:var(--ev-text)]">Provider</div>
          <p className="mt-2">
            Sprint 13b plugará Twilio/Gupshup (WhatsApp) + Resend (email) via adapter abstrato.
          </p>
          <p className="italic mt-2">
            MVP usa <code>provider='stub'</code>: mensagens entram em queued sem envio real.
          </p>
        </div>
      </div>
    </div>
  )
}
