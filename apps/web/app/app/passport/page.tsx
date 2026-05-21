/**
 * `/app/passport` — landing do módulo Passaporte cross-tenant (Sprint 02b9).
 *
 * Hub do módulo regra 42 / ADR 0077: vínculo entre paciente e empresas via
 * `patient_company_links` + `patient_link_modules`. Por enquanto traz só
 * counts agregados + atalhos pra invites; Sprint 02c+ ganha cards por módulo
 * (academia/personal/fisio/nutri/pilates) e timeline de acessos cross-tenant.
 *
 * Counts derivados de queries leves (filtros simples) — pra dashboard mais
 * rico ver `/app/dashboard`.
 */
import { pool } from '@repo/db/client'
import Link from 'next/link'
import { requireFullSession } from '../../lib/session'

export const dynamic = 'force-dynamic'

interface Counts {
  pending: number
  active: number
  revoked: number
  totalLinks: number
  totalActiveModules: number
}

const MODULE_LABELS: Record<string, string> = {
  academia: '🏋️ Academia',
  personal_training: '🤸 Personal Training',
  fisioterapia: '🩺 Fisioterapia',
  nutricao: '🥗 Nutrição',
  pilates: '🧘 Pilates',
}

export default async function PassportLandingPage() {
  const session = await requireFullSession('/app/passport')

  const client = await pool.connect()
  const counts: Counts = {
    pending: 0,
    active: 0,
    revoked: 0,
    totalLinks: 0,
    totalActiveModules: 0,
  }
  let modulesBreakdown: Array<{ module: string; count: number }> = []
  try {
    await client.query("SELECT set_config('app.tenant_id', $1, false)", [session.logifit.tenantId])
    const cRes = await client.query<{
      pending: string
      active: string
      revoked: string
      total: string
    }>(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'pending')::text AS pending,
         COUNT(*) FILTER (WHERE status = 'active')::text AS active,
         COUNT(*) FILTER (WHERE status = 'revoked')::text AS revoked,
         COUNT(*)::text AS total
       FROM patient_company_links
       WHERE tenant_id = $1`,
      [session.logifit.tenantId],
    )
    const r = cRes.rows[0]
    counts.pending = Number(r?.pending ?? 0)
    counts.active = Number(r?.active ?? 0)
    counts.revoked = Number(r?.revoked ?? 0)
    counts.totalLinks = Number(r?.total ?? 0)

    const mRes = await client.query<{ module: string; count: string }>(
      `SELECT m.module::text AS module, COUNT(*)::text AS count
       FROM patient_link_modules m
       INNER JOIN patient_company_links l ON l.id = m.link_id
       WHERE l.tenant_id = $1 AND m.status = 'active'
       GROUP BY m.module
       ORDER BY count DESC`,
      [session.logifit.tenantId],
    )
    modulesBreakdown = mRes.rows.map((row) => ({
      module: row.module,
      count: Number(row.count),
    }))
    counts.totalActiveModules = modulesBreakdown.reduce((acc, m) => acc + m.count, 0)
  } finally {
    await client.query("SELECT set_config('app.tenant_id', '', false)").catch(() => {})
    client.release()
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-8 space-y-8">
      <header className="space-y-2">
        <nav className="text-sm" style={{ color: 'var(--ev-text-muted)' }}>
          <Link href="/app" style={{ color: 'inherit' }}>
            Início
          </Link>
          {' / '}
          <span>Passaporte</span>
        </nav>
        <h1 className="text-3xl font-semibold tracking-tight">Passaporte cross-tenant</h1>
        <p className="max-w-3xl text-sm" style={{ color: 'var(--ev-text-muted)' }}>
          Vínculos do paciente entre tenants — o paciente leva sua identidade e histórico entre
          clínicas e academias autorizadas (
          <a
            href="/docs/decisions/0077-passaporte-paciente-vinculo-cross-tenant.md"
            className="underline"
          >
            ADR 0077
          </a>
          ). Cada vínculo libera dados em níveis específicos por módulo clínico, com responsável
          técnico definido por profissão regulada.
        </p>
      </header>

      <section className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Pendentes" value={counts.pending} accent="warning" />
        <StatCard label="Ativos" value={counts.active} accent="success" />
        <StatCard label="Revogados" value={counts.revoked} accent="danger" />
        <StatCard label="Módulos ativos" value={counts.totalActiveModules} accent="primary" />
      </section>

      <section className="flex flex-wrap gap-3">
        <Link
          href="/app/passport/invites/new"
          className="inline-flex items-center rounded-md px-4 py-2 text-sm font-medium"
          style={{
            background: 'var(--ev-primary)',
            color: 'var(--ev-primary-foreground, white)',
            minHeight: 'var(--ev-touch-min, 44px)',
          }}
        >
          + Novo convite
        </Link>
        <Link
          href="/app/passport/invites"
          className="inline-flex items-center rounded-md border px-4 py-2 text-sm font-medium"
          style={{
            borderColor: 'var(--ev-border)',
            background: 'var(--ev-surface)',
            color: 'var(--ev-text)',
            minHeight: 'var(--ev-touch-min, 44px)',
          }}
        >
          Ver todos os convites
        </Link>
      </section>

      {modulesBreakdown.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-medium">Módulos ativos por categoria</h2>
          <ul
            className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3"
            aria-label="Distribuição de vínculos ativos por módulo"
          >
            {modulesBreakdown.map((m) => (
              <li
                key={m.module}
                className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
                style={{
                  borderColor: 'var(--ev-border)',
                  background: 'var(--ev-surface)',
                }}
              >
                <span>{MODULE_LABELS[m.module] ?? m.module}</span>
                <span
                  className="rounded-full px-2 py-0.5 text-xs font-medium"
                  style={{
                    background: 'var(--ev-bg)',
                    color: 'var(--ev-text)',
                  }}
                >
                  {m.count}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {counts.totalLinks === 0 && (
        <section
          className="rounded-md border border-dashed p-6 text-sm"
          style={{
            borderColor: 'var(--ev-border)',
            color: 'var(--ev-text-muted)',
          }}
        >
          Nenhum vínculo cross-tenant criado neste tenant ainda.{' '}
          <Link
            href="/app/passport/invites/new"
            className="font-medium hover:underline"
            style={{ color: 'var(--ev-primary)' }}
          >
            Criar o primeiro convite →
          </Link>
        </section>
      )}
    </main>
  )
}

interface StatCardProps {
  label: string
  value: number
  accent: 'success' | 'warning' | 'danger' | 'primary'
}

function StatCard({ label, value, accent }: StatCardProps) {
  const color = `var(--ev-${accent === 'primary' ? 'primary' : accent}-fg, var(--ev-text))`
  const bg = `var(--ev-${accent === 'primary' ? 'primary' : accent}-bg, var(--ev-surface))`
  return (
    <div
      className="rounded-md border p-4"
      style={{
        borderColor: 'var(--ev-border)',
        background: 'var(--ev-surface)',
      }}
    >
      <div className="text-xs uppercase tracking-wide" style={{ color: 'var(--ev-text-muted)' }}>
        {label}
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-3xl font-semibold tabular-nums" style={{ color }}>
          {value}
        </span>
        <span
          className="rounded-full px-1.5 py-0.5 text-xs"
          style={{
            background: bg,
            color,
          }}
          aria-hidden
        >
          ●
        </span>
      </div>
    </div>
  )
}
