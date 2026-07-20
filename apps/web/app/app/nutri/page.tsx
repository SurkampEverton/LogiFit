import { db } from '@repo/db/client'
/**
 * `/app/nutri` — hub Nutrição (Sprint 29 Faixa C — abre Fase 3).
 */
import { sql } from 'drizzle-orm'
import Link from 'next/link'
import { requireFullSession } from '../../lib/session'

export const dynamic = 'force-dynamic'

export default async function NutriHubPage() {
  const session = await requireFullSession('/app/nutri')
  const tenantId = session.logifit.tenantId

  const [k] = (
    await db.execute(sql`
      SELECT
        (SELECT COUNT(*)::int FROM meal_plans WHERE tenant_id = ${tenantId} AND active = true AND archived_at IS NULL) AS active_plans,
        (SELECT COUNT(*)::int FROM meal_plans WHERE tenant_id = ${tenantId} AND created_at > NOW() - INTERVAL '30 days') AS plans_30d,
        (SELECT COUNT(*)::int FROM foods WHERE tenant_id IS NULL AND active = true) AS global_foods,
        (SELECT COUNT(*)::int FROM foods WHERE tenant_id = ${tenantId} AND active = true) AS tenant_foods,
        (SELECT COUNT(DISTINCT food_id)::int FROM food_equivalences WHERE tenant_id IS NULL OR tenant_id = ${tenantId}) AS foods_with_subs
    `)
  ).rows as Array<{
    active_plans: number
    plans_30d: number
    global_foods: number
    tenant_foods: number
    foods_with_subs: number
  }>
  const kpi = k ?? {
    active_plans: 0,
    plans_30d: 0,
    global_foods: 0,
    tenant_foods: 0,
    foods_with_subs: 0,
  }

  return (
    <div className="ev-stack" style={{ padding: 'var(--ev-space-lg)' }}>
      <header
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 'var(--ev-space-md)',
          flexWrap: 'wrap',
        }}
      >
        <h1 style={{ margin: 0 }}>Nutrição</h1>
        <span style={{ color: 'var(--ev-text-muted)' }}>
          Sprint 29 · ADRs 0080+0081 — abre Fase 3
        </span>
        <span style={{ flex: 1 }} />
        <Link href="/app/nutri/alimentos" className="ev-btn ev-btn-ghost">
          🍎 Alimentos
        </Link>
        <Link href="/app/nutri/planos" className="ev-btn ev-btn-primary">
          🥗 Planos alimentares
        </Link>
      </header>

      <section
        className="ev-card"
        style={{
          padding: 'var(--ev-space-md)',
          display: 'grid',
          gridTemplateColumns: 'repeat(5, 1fr)',
          gap: 'var(--ev-space-md)',
        }}
      >
        <div>
          <div style={{ fontSize: 'var(--ev-text-xs)', color: 'var(--ev-text-muted)' }}>
            Planos ativos
          </div>
          <div style={{ fontSize: 'var(--ev-text-2xl)', fontWeight: 600 }}>{kpi.active_plans}</div>
        </div>
        <div>
          <div style={{ fontSize: 'var(--ev-text-xs)', color: 'var(--ev-text-muted)' }}>
            Criados 30d
          </div>
          <div style={{ fontSize: 'var(--ev-text-2xl)', fontWeight: 600 }}>{kpi.plans_30d}</div>
        </div>
        <div>
          <div style={{ fontSize: 'var(--ev-text-xs)', color: 'var(--ev-text-muted)' }}>
            TACO global
          </div>
          <div style={{ fontSize: 'var(--ev-text-2xl)', fontWeight: 600 }}>{kpi.global_foods}</div>
        </div>
        <div>
          <div style={{ fontSize: 'var(--ev-text-xs)', color: 'var(--ev-text-muted)' }}>
            Custom do tenant
          </div>
          <div style={{ fontSize: 'var(--ev-text-2xl)', fontWeight: 600 }}>{kpi.tenant_foods}</div>
        </div>
        <div>
          <div style={{ fontSize: 'var(--ev-text-xs)', color: 'var(--ev-text-muted)' }}>
            Com substituições
          </div>
          <div style={{ fontSize: 'var(--ev-text-2xl)', fontWeight: 600 }}>
            {kpi.foods_with_subs}
          </div>
        </div>
      </section>

      <section className="ev-card" style={{ padding: 'var(--ev-space-md)' }}>
        <h2 style={{ marginTop: 0 }}>O que o módulo faz</h2>
        <ul>
          <li>
            <strong>Banco TACO</strong> — Tabela Brasileira de Composição de Alimentos como catálogo
            global, somando ao USDA opcional. Customize com alimentos do seu tenant em{' '}
            <Link href="/app/nutri/alimentos">/app/nutri/alimentos</Link>.
          </li>
          <li>
            <strong>Plano alimentar versionado</strong> — editar gera nova versão
            (parent_meal_plan_id), histórico preservado. Cálculo nutricional em tempo real soma
            macros + micros por gramas.
          </li>
          <li>
            <strong>Substituições calóricas</strong> — para cada item, top-N equivalentes ordenados
            por proximidade calórica (ADR 0081 § rankEquivalents).
          </li>
          <li>
            <strong>PDF com branding</strong> — configure logo + cores em{' '}
            <Link href="/app/settings/branding">/app/settings/branding</Link>; export em Sprint 29b.
          </li>
        </ul>
      </section>
    </div>
  )
}
