/**
 * `/app/acesso/checkins` — feed live de check-ins (Sprint 08 Faixa C).
 *
 * Server Component lista últimas 50 eventos do tenant + `<RealtimeCheckins>`
 * (Client) escuta SSE canal `acesso:{tenant}:*` e router.refresh em cada
 * event (mesmo pattern do Realtime Agenda Sprint 03 Faixa D).
 */
import { desc, eq } from 'drizzle-orm'
import Link from 'next/link'
import { db } from '@repo/db/client'
import {
  accessDevices,
  accessEvents,
  members,
  persons,
} from '@repo/db/schema'
import { requireFullSession } from '../../../lib/session'

export const dynamic = 'force-dynamic'

const KIND_LABEL: Record<string, string> = {
  checkin: '✓ Check-in',
  checkout: '↩ Check-out',
  denied_overdue: '⚠ Negado (overdue)',
  denied_block: '🚫 Negado (bloqueio)',
  denied_invalid_token: '❌ Token inválido',
  denied_no_face_match: '👤 Face não bate',
  denied_no_consent: '📝 Sem consent',
  manual: '✋ Manual',
}

const KIND_COLOR: Record<string, string> = {
  checkin: 'var(--ev-success, #10b981)',
  checkout: 'var(--ev-text-muted)',
  denied_overdue: 'var(--ev-danger, #ef4444)',
  denied_block: 'var(--ev-danger, #ef4444)',
  denied_invalid_token: 'var(--ev-warning, #f59e0b)',
  denied_no_face_match: 'var(--ev-warning, #f59e0b)',
  denied_no_consent: 'var(--ev-warning, #f59e0b)',
  manual: 'var(--ev-primary)',
}

export default async function CheckinsPage() {
  const session = await requireFullSession('/app/acesso/checkins')

  const rows = await db
    .select({
      id: accessEvents.id,
      kind: accessEvents.kind,
      authMode: accessEvents.authMode,
      at: accessEvents.at,
      memberId: accessEvents.memberId,
      personName: persons.name,
      deviceLabel: accessDevices.label,
    })
    .from(accessEvents)
    .leftJoin(members, eq(members.id, accessEvents.memberId))
    .leftJoin(persons, eq(persons.id, members.personId))
    .leftJoin(accessDevices, eq(accessDevices.id, accessEvents.deviceId))
    .where(eq(accessEvents.tenantId, session.logifit.tenantId))
    .orderBy(desc(accessEvents.at))
    .limit(50)

  return (
    <div className="mx-auto max-w-5xl px-6 py-8 space-y-6">
      <nav className="text-sm">
        <Link href="/app" className="text-[color:var(--ev-text-muted)] hover:underline">
          ← Voltar para Dashboard
        </Link>
      </nav>

      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Check-ins ao vivo</h1>
          <p className="text-sm text-[color:var(--ev-text-muted)]">
            Últimos 50 eventos. Atualiza em tempo real (SSE) — Sprint 08 Faixa C.
          </p>
        </div>
        <Link
          href="/app/acesso/catracas"
          className="rounded-md border border-[color:var(--ev-border)] px-4 py-2 font-medium hover:bg-[color:var(--ev-surface)]"
          style={{ minHeight: 'var(--ev-touch-min, 44px)' }}
        >
          Catracas
        </Link>
      </header>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[color:var(--ev-border)] p-8 text-center">
          <p className="text-[color:var(--ev-text-muted)]">
            Nenhum evento de acesso ainda. Catraca precisa estar cadastrada e
            online.
          </p>
          <Link
            href="/app/acesso/catracas"
            className="mt-3 inline-block font-medium text-[color:var(--ev-primary)]"
          >
            Cadastrar primeira catraca →
          </Link>
        </div>
      ) : (
        <section className="rounded-xl border border-[color:var(--ev-border)] overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-[color:var(--ev-surface-muted)] text-left">
              <tr>
                <th className="px-4 py-3 font-medium">Horário</th>
                <th className="px-4 py-3 font-medium">Member</th>
                <th className="px-4 py-3 font-medium">Catraca</th>
                <th className="px-4 py-3 font-medium">Tipo</th>
                <th className="px-4 py-3 font-medium">Modo</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id} className="border-t border-[color:var(--ev-border)]">
                  <td className="px-4 py-3 text-[color:var(--ev-text-muted)] tabular-nums">
                    {new Date(e.at).toLocaleString('pt-BR', {
                      day: '2-digit',
                      month: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    })}
                  </td>
                  <td className="px-4 py-3 font-medium">
                    {e.memberId ? (
                      <Link href={`/app/members/${e.memberId}`} className="hover:underline">
                        {e.personName ?? '—'}
                      </Link>
                    ) : (
                      <span className="text-[color:var(--ev-text-muted)]">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-[color:var(--ev-text-muted)]">
                    {e.deviceLabel ?? '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className="text-xs font-medium"
                      style={{ color: KIND_COLOR[e.kind] ?? 'var(--ev-text)' }}
                    >
                      {KIND_LABEL[e.kind] ?? e.kind}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[color:var(--ev-text-muted)] text-xs uppercase">
                    {e.authMode}
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
