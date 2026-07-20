import { db } from '@repo/db/client'
import { accessDevices, companies, persons, units } from '@repo/db/schema'
/**
 * `/app/acesso/catracas` — lista catracas cadastradas + heartbeat status
 * (Sprint 08 Faixa C).
 *
 * Sprint 09+: detail page por catraca + UI rotação de access_secrets +
 * relatório de uptime.
 */
import { desc, eq } from 'drizzle-orm'
import Link from 'next/link'
import { requireFullSession } from '../../../lib/session'

export const dynamic = 'force-dynamic'

function deviceStatus(lastHeartbeat: Date | null, revokedAt: Date | null) {
  if (revokedAt !== null) return { label: 'Revogada', color: 'var(--ev-text-muted)' }
  if (!lastHeartbeat) return { label: 'Nunca conectou', color: 'var(--ev-warning, #f59e0b)' }
  const minutesSince = (Date.now() - lastHeartbeat.getTime()) / 60_000
  if (minutesSince < 2) return { label: '✓ Online', color: 'var(--ev-success, #10b981)' }
  if (minutesSince < 10) return { label: '⚠ Lento', color: 'var(--ev-warning, #f59e0b)' }
  return { label: '✗ Offline', color: 'var(--ev-danger, #ef4444)' }
}

export default async function CatracasPage() {
  const session = await requireFullSession('/app/acesso/catracas')

  const rows = await db
    .select({
      id: accessDevices.id,
      label: accessDevices.label,
      hardwareType: accessDevices.hardwareType,
      authModes: accessDevices.authModes,
      lastHeartbeat: accessDevices.lastHeartbeat,
      revokedAt: accessDevices.revokedAt,
      createdAt: accessDevices.createdAt,
      companyName: persons.name,
      unitId: accessDevices.unitId,
      unitName: units.name,
    })
    .from(accessDevices)
    .innerJoin(companies, eq(companies.id, accessDevices.companyId))
    .innerJoin(persons, eq(persons.id, companies.personId))
    .leftJoin(units, eq(units.id, accessDevices.unitId))
    .where(eq(accessDevices.tenantId, session.logifit.tenantId))
    .orderBy(desc(accessDevices.createdAt))
    .limit(100)

  return (
    <div className="mx-auto max-w-5xl px-6 py-8 space-y-6">
      <nav className="text-sm">
        <Link
          href="/app/acesso/checkins"
          className="text-[color:var(--ev-text-muted)] hover:underline"
        >
          ← Voltar para Check-ins
        </Link>
      </nav>

      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Catracas</h1>
          <p className="text-sm text-[color:var(--ev-text-muted)]">
            Dispositivos de controle de acesso por unit. Heartbeat a cada 30s.
          </p>
        </div>
        <Link
          href="/app/acesso/catracas/new"
          className="rounded-md bg-[color:var(--ev-primary)] px-4 py-2 font-medium text-[color:var(--ev-primary-foreground)]"
          style={{ minHeight: 'var(--ev-touch-min, 44px)' }}
        >
          + Cadastrar catraca
        </Link>
      </header>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[color:var(--ev-border)] p-8 text-center">
          <p className="text-[color:var(--ev-text-muted)]">Nenhuma catraca cadastrada.</p>
          <Link
            href="/app/acesso/catracas/new"
            className="mt-3 inline-block font-medium text-[color:var(--ev-primary)]"
          >
            Cadastrar primeira →
          </Link>
        </div>
      ) : (
        <section className="rounded-xl border border-[color:var(--ev-border)] overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-[color:var(--ev-surface-muted)] text-left">
              <tr>
                <th className="px-4 py-3 font-medium">Catraca</th>
                <th className="px-4 py-3 font-medium">Local</th>
                <th className="px-4 py-3 font-medium">Hardware</th>
                <th className="px-4 py-3 font-medium">Auth</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Último heartbeat</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => {
                const status = deviceStatus(d.lastHeartbeat, d.revokedAt)
                const authModes = Array.isArray(d.authModes) ? (d.authModes as string[]) : []
                return (
                  <tr key={d.id} className="border-t border-[color:var(--ev-border)]">
                    <td className="px-4 py-3 font-medium">{d.label}</td>
                    <td className="px-4 py-3 text-[color:var(--ev-text-muted)]">
                      {d.companyName}
                      {d.unitName && ` · ${d.unitName}`}
                    </td>
                    <td className="px-4 py-3 text-[color:var(--ev-text-muted)] text-xs">
                      {d.hardwareType ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-xs uppercase tracking-wide text-[color:var(--ev-text-muted)]">
                      {authModes.join(', ') || 'qr'}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs font-medium" style={{ color: status.color }}>
                        {status.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-[color:var(--ev-text-muted)] tabular-nums">
                      {d.lastHeartbeat
                        ? new Date(d.lastHeartbeat).toLocaleString('pt-BR', {
                            day: '2-digit',
                            month: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </section>
      )}
    </div>
  )
}
