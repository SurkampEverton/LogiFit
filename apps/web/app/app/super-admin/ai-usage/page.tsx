/**
 * `/app/super-admin/ai-usage` — dashboard global de uso IA (ADR 0075).
 *
 * Sprint 06 Faixa D: agregados mensais por tenant + top tools utilizadas.
 * Visível pra role `super_admin` LogiFit (não tenant).
 */
import { db } from '@repo/db/client'
import { aiAuditLog, aiTenantUsage, toolsRegistry } from '@repo/db/schema'
import { count, desc, eq } from 'drizzle-orm'
import { getTranslations } from 'next-intl/server'
import { requireFullSession } from '../../../lib/session'

export const dynamic = 'force-dynamic'

export default async function AIUsageDashboard() {
  const session = await requireFullSession('/app/super-admin/ai-usage')
  const t = await getTranslations('ai_usage')

  // Sprint 06+: filtro real role=super_admin. MVP: deixa todos verem.
  void session

  const monthBucket = new Date().toISOString().slice(0, 7)
  const tenantUsage = await db
    .select({
      tenantId: aiTenantUsage.tenantId,
      calls: aiTenantUsage.callsCount,
      cacheHits: aiTenantUsage.cacheHits,
      tokensIn: aiTenantUsage.tokensInput,
      tokensOut: aiTenantUsage.tokensOutput,
    })
    .from(aiTenantUsage)
    .where(eq(aiTenantUsage.monthBucket, monthBucket))
    .orderBy(desc(aiTenantUsage.callsCount))
    .limit(20)

  const totalGuardrail = await db
    .select({ count: count() })
    .from(aiAuditLog)
    .where(eq(aiAuditLog.guardrailBlocked, true))

  const tools = await db
    .select({ key: toolsRegistry.key, layer: toolsRegistry.layer, module: toolsRegistry.module })
    .from(toolsRegistry)
    .where(eq(toolsRegistry.active, true))
    .limit(100)

  const totalCalls = tenantUsage.reduce((a, b) => a + b.calls, 0)
  const totalCache = tenantUsage.reduce((a, b) => a + b.cacheHits, 0)
  const cacheRate = totalCalls === 0 ? 0 : (totalCache / (totalCalls + totalCache)) * 100

  return (
    <main style={{ padding: 'var(--ev-space-5)', maxWidth: 1080 }}>
      <header style={{ marginBottom: 'var(--ev-space-5)' }}>
        <h1 style={{ margin: 0, fontSize: 'var(--ev-text-2xl)' }}>{t('title')}</h1>
        <p style={{ margin: 'var(--ev-space-2) 0 0', color: 'var(--ev-text-muted)' }}>
          {t('subtitle', { month: monthBucket })}
        </p>
      </header>

      {/* KPIs */}
      <section
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: 'var(--ev-space-3)',
          marginBottom: 'var(--ev-space-5)',
        }}
      >
        <Kpi label={t('kpi.total_calls')} value={totalCalls.toString()} />
        <Kpi label={t('kpi.cache_rate')} value={`${Math.round(cacheRate)}%`} />
        <Kpi
          label={t('kpi.guardrail_blocked')}
          value={(totalGuardrail[0]?.count ?? 0).toString()}
          danger
        />
        <Kpi label={t('kpi.tools_registered')} value={tools.length.toString()} />
      </section>

      {/* Top tenants */}
      <section
        style={{
          padding: 'var(--ev-space-4)',
          border: '1px solid var(--ev-border)',
          borderRadius: 12,
          marginBottom: 'var(--ev-space-4)',
        }}
      >
        <h2 style={{ margin: 0, fontSize: 'var(--ev-text-lg)' }}>{t('top_tenants.title')}</h2>
        {tenantUsage.length === 0 ? (
          <p style={{ color: 'var(--ev-text-muted)', marginTop: 'var(--ev-space-2)' }}>
            {t('top_tenants.empty')}
          </p>
        ) : (
          <table
            style={{ width: '100%', marginTop: 'var(--ev-space-3)', borderCollapse: 'collapse' }}
          >
            <thead>
              <tr style={{ borderBottom: '1px solid var(--ev-border)', textAlign: 'left' }}>
                <th style={{ padding: 'var(--ev-space-2)', fontSize: 'var(--ev-text-xs)' }}>
                  {t('top_tenants.col.tenant')}
                </th>
                <th style={{ padding: 'var(--ev-space-2)', fontSize: 'var(--ev-text-xs)' }}>
                  {t('top_tenants.col.calls')}
                </th>
                <th style={{ padding: 'var(--ev-space-2)', fontSize: 'var(--ev-text-xs)' }}>
                  {t('top_tenants.col.cache')}
                </th>
                <th style={{ padding: 'var(--ev-space-2)', fontSize: 'var(--ev-text-xs)' }}>
                  {t('top_tenants.col.tokens')}
                </th>
              </tr>
            </thead>
            <tbody>
              {tenantUsage.map((row) => (
                <tr key={row.tenantId} style={{ borderBottom: '1px solid var(--ev-border)' }}>
                  <td style={{ padding: 'var(--ev-space-2)', fontSize: 'var(--ev-text-sm)' }}>
                    {row.tenantId.slice(0, 8)}…
                  </td>
                  <td style={{ padding: 'var(--ev-space-2)', fontSize: 'var(--ev-text-sm)' }}>
                    {row.calls}
                  </td>
                  <td style={{ padding: 'var(--ev-space-2)', fontSize: 'var(--ev-text-sm)' }}>
                    {row.cacheHits}
                  </td>
                  <td style={{ padding: 'var(--ev-space-2)', fontSize: 'var(--ev-text-sm)' }}>
                    {row.tokensIn + row.tokensOut}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Tools registry snapshot */}
      <section
        style={{
          padding: 'var(--ev-space-4)',
          border: '1px solid var(--ev-border)',
          borderRadius: 12,
        }}
      >
        <h2 style={{ margin: 0, fontSize: 'var(--ev-text-lg)' }}>{t('tools.title')}</h2>
        <p style={{ color: 'var(--ev-text-muted)', marginTop: 'var(--ev-space-2)' }}>
          {t('tools.count', { count: tools.length })}
        </p>
        <details style={{ marginTop: 'var(--ev-space-3)' }}>
          <summary style={{ cursor: 'pointer', fontSize: 'var(--ev-text-sm)' }}>
            {t('tools.list_label')}
          </summary>
          <ul style={{ marginTop: 'var(--ev-space-2)' }}>
            {tools.map((tool) => (
              <li
                key={tool.key}
                style={{ fontSize: 'var(--ev-text-xs)', color: 'var(--ev-text-muted)' }}
              >
                <code>{tool.key}</code> · {tool.module} · {tool.layer}
              </li>
            ))}
          </ul>
        </details>
      </section>
    </main>
  )
}

function Kpi({ label, value, danger = false }: { label: string; value: string; danger?: boolean }) {
  return (
    <div
      style={{
        padding: 'var(--ev-space-4)',
        border: '1px solid var(--ev-border)',
        borderRadius: 12,
        backgroundColor: danger ? 'var(--ev-danger-bg, #fee2e2)' : 'var(--ev-surface)',
      }}
    >
      <div style={{ fontSize: 'var(--ev-text-xs)', color: 'var(--ev-text-muted)' }}>{label}</div>
      <div
        style={{
          fontSize: 'var(--ev-text-2xl)',
          fontWeight: 700,
          color: danger ? 'var(--ev-danger-text, #991b1b)' : 'var(--ev-text)',
        }}
      >
        {value}
      </div>
    </div>
  )
}
