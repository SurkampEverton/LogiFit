/**
 * `/app/mensagens/templates` — lista de templates do tenant (Sprint 13 Faixa C).
 */
import { and, desc, eq, isNull } from 'drizzle-orm'
import Link from 'next/link'
import { db } from '@repo/db/client'
import { messageTemplates } from '@repo/db/schema'
import { requireFullSession } from '../../../lib/session'

export const dynamic = 'force-dynamic'

const APPROVAL_COLOR: Record<string, string> = {
  draft: 'var(--ev-text-muted)',
  pending: 'var(--ev-warning, #eab308)',
  approved: 'var(--ev-success, #22c55e)',
  rejected: 'var(--ev-danger, #ef4444)',
}

const CHANNEL_LABELS: Record<string, string> = {
  whatsapp: '🟢 WhatsApp',
  email: '📧 Email',
  sms: '📱 SMS',
}

export default async function TemplatesListPage() {
  const session = await requireFullSession('/app/mensagens/templates')
  const tenantId = session.logifit.tenantId

  const rows = await db
    .select({
      id: messageTemplates.id,
      slug: messageTemplates.slug,
      name: messageTemplates.name,
      channel: messageTemplates.channel,
      subject: messageTemplates.subject,
      variables: messageTemplates.variables,
      approvalStatus: messageTemplates.approvalStatus,
      approvedAt: messageTemplates.approvedAt,
      createdAt: messageTemplates.createdAt,
    })
    .from(messageTemplates)
    .where(
      and(eq(messageTemplates.tenantId, tenantId), isNull(messageTemplates.archivedAt)),
    )
    .orderBy(desc(messageTemplates.createdAt))

  return (
    <div className="mx-auto max-w-[1200px] px-6 py-8 space-y-6">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Templates</h1>
          <p className="text-sm text-[color:var(--ev-text-muted)]">
            {rows.length} templates · WhatsApp Business exige aprovação Meta
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/app/mensagens"
            className="rounded-md border border-[color:var(--ev-border)] px-3 py-2 text-sm hover:bg-[color:var(--ev-surface)]"
          >
            ← Mensagens
          </Link>
          <Link
            href="/app/mensagens/templates/new"
            className="rounded-md bg-[color:var(--ev-primary)] px-3 py-2 text-sm text-white hover:opacity-90"
          >
            + Novo template
          </Link>
        </div>
      </header>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[color:var(--ev-border)] p-6 text-sm text-[color:var(--ev-text-muted)]">
          Nenhum template criado. Comece pelo botão "+ Novo template" — sugestão:
          cobrança D+1, reengajamento, boas-vindas.
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((t) => (
            <article
              key={t.id}
              className="rounded-xl border border-[color:var(--ev-border)] bg-[color:var(--ev-surface)] p-4 space-y-2"
            >
              <header className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="font-medium leading-tight">{t.name}</h3>
                  <code className="text-[10px] text-[color:var(--ev-text-muted)]">
                    {t.slug}
                  </code>
                </div>
                <span
                  className="rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide shrink-0"
                  style={{
                    backgroundColor: 'var(--ev-bg)',
                    color: APPROVAL_COLOR[t.approvalStatus],
                    border: '1px solid var(--ev-border)',
                  }}
                >
                  {t.approvalStatus}
                </span>
              </header>
              <div className="text-xs text-[color:var(--ev-text-muted)]">
                {CHANNEL_LABELS[t.channel] ?? t.channel}
                {t.subject && ` · ${t.subject}`}
              </div>
              {t.variables.length > 0 && (
                <div className="flex gap-1 flex-wrap">
                  {t.variables.slice(0, 4).map((v) => (
                    <code
                      key={v}
                      className="rounded-full bg-[color:var(--ev-bg)] px-2 py-0.5 text-[10px]"
                    >
                      {`{{${v}}}`}
                    </code>
                  ))}
                  {t.variables.length > 4 && (
                    <span className="text-[10px] text-[color:var(--ev-text-muted)]">
                      +{t.variables.length - 4}
                    </span>
                  )}
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  )
}
