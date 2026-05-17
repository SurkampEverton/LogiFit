/**
 * `/app/mensagens/historico` — histórico de mensagens enviadas (Sprint 13 Faixa C).
 */
import { and, desc, eq } from 'drizzle-orm'
import Link from 'next/link'
import { db } from '@repo/db/client'
import {
  members,
  messageTemplates,
  messagesSent,
  persons,
} from '@repo/db/schema'
import { requireFullSession } from '../../../lib/session'

export const dynamic = 'force-dynamic'

interface SearchParams {
  channel?: string
  status?: string
}

const STATUS_COLOR: Record<string, string> = {
  queued: 'var(--ev-text-muted)',
  sending: 'var(--ev-warning, #eab308)',
  sent: 'var(--ev-info, #3b82f6)',
  delivered: 'var(--ev-success, #22c55e)',
  read: 'var(--ev-success, #22c55e)',
  failed: 'var(--ev-danger, #ef4444)',
}

const CHANNEL_ICON: Record<string, string> = {
  whatsapp: '🟢',
  email: '📧',
  sms: '📱',
}

export default async function HistoricoPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const params = await searchParams
  const session = await requireFullSession('/app/mensagens/historico')
  const tenantId = session.logifit.tenantId

  const conditions = [eq(messagesSent.tenantId, tenantId)]
  if (params.channel) {
    conditions.push(eq(messagesSent.channel, params.channel as 'whatsapp'))
  }
  if (params.status) {
    conditions.push(eq(messagesSent.status, params.status as 'sent'))
  }

  const rows = await db
    .select({
      id: messagesSent.id,
      memberId: messagesSent.memberId,
      channel: messagesSent.channel,
      provider: messagesSent.provider,
      status: messagesSent.status,
      recipient: messagesSent.recipient,
      bodyRendered: messagesSent.bodyRendered,
      sentAt: messagesSent.sentAt,
      deliveredAt: messagesSent.deliveredAt,
      readAt: messagesSent.readAt,
      failedAt: messagesSent.failedAt,
      failureReason: messagesSent.failureReason,
      createdAt: messagesSent.createdAt,
      templateName: messageTemplates.name,
      memberName: persons.name,
    })
    .from(messagesSent)
    .leftJoin(messageTemplates, eq(messageTemplates.id, messagesSent.templateId))
    .leftJoin(members, eq(members.id, messagesSent.memberId))
    .leftJoin(persons, eq(persons.id, members.personId))
    .where(and(...conditions))
    .orderBy(desc(messagesSent.createdAt))
    .limit(100)

  return (
    <div className="mx-auto max-w-[1200px] px-6 py-8 space-y-6">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Histórico</h1>
          <p className="text-sm text-[color:var(--ev-text-muted)]">
            {rows.length} mensagens (últimas 100)
          </p>
        </div>
        <Link
          href="/app/mensagens"
          className="rounded-md border border-[color:var(--ev-border)] px-3 py-2 text-sm hover:bg-[color:var(--ev-surface)]"
        >
          ← Mensagens
        </Link>
      </header>

      <form method="get" className="flex gap-2 flex-wrap items-end">
        <label className="space-y-1 text-sm">
          <span className="block font-medium">Canal</span>
          <select
            name="channel"
            defaultValue={params.channel ?? ''}
            className="rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-bg)] px-3 py-2"
          >
            <option value="">Todos</option>
            <option value="whatsapp">WhatsApp</option>
            <option value="email">Email</option>
            <option value="sms">SMS</option>
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="block font-medium">Status</span>
          <select
            name="status"
            defaultValue={params.status ?? ''}
            className="rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-bg)] px-3 py-2"
          >
            <option value="">Todos</option>
            <option value="queued">Queued</option>
            <option value="sending">Sending</option>
            <option value="sent">Sent</option>
            <option value="delivered">Delivered</option>
            <option value="read">Read</option>
            <option value="failed">Failed</option>
          </select>
        </label>
        <button
          type="submit"
          className="rounded-md border border-[color:var(--ev-border)] px-3 py-2 text-sm hover:bg-[color:var(--ev-surface)]"
        >
          Filtrar
        </button>
      </form>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[color:var(--ev-border)] p-6 text-sm text-[color:var(--ev-text-muted)]">
          Nenhuma mensagem registrada com esses filtros.
        </div>
      ) : (
        <ul className="space-y-2">
          {rows.map((m) => (
            <li
              key={m.id}
              className="rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-surface)] p-3 space-y-1"
            >
              <header className="flex items-center justify-between gap-2 flex-wrap text-sm">
                <div className="min-w-0">
                  <span className="font-medium">
                    {CHANNEL_ICON[m.channel]} {m.memberName ?? m.recipient}
                  </span>
                  {m.templateName && (
                    <span className="text-xs text-[color:var(--ev-text-muted)] ml-2">
                      via {m.templateName}
                    </span>
                  )}
                </div>
                <span
                  className="rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide shrink-0"
                  style={{
                    backgroundColor: 'var(--ev-bg)',
                    color: STATUS_COLOR[m.status],
                    border: '1px solid var(--ev-border)',
                  }}
                >
                  {m.status} · {m.provider}
                </span>
              </header>
              {m.bodyRendered && (
                <p className="text-xs text-[color:var(--ev-text-muted)] line-clamp-2 italic">
                  {m.bodyRendered}
                </p>
              )}
              <div className="text-[10px] text-[color:var(--ev-text-muted)]">
                {new Date(m.createdAt).toLocaleString('pt-BR', {
                  dateStyle: 'short',
                  timeStyle: 'short',
                })}
                {m.deliveredAt &&
                  ` · entregue ${new Date(m.deliveredAt).toLocaleTimeString('pt-BR')}`}
                {m.readAt && ` · lido ${new Date(m.readAt).toLocaleTimeString('pt-BR')}`}
                {m.failureReason && ` · ❌ ${m.failureReason}`}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
