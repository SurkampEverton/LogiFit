/**
 * Seed Sprint 14 — custos operacionais.
 *
 * Idempotente. Por tenant:
 *   1. 6 categorias canônicas (aluguel/folha/marketing/manutenção/água/energia)
 *   2. 10 cost_entries últimos 3 meses na matriz
 *   3. 3 recurring_costs (aluguel D5, folha D5, internet D10)
 *
 * Uso: `pnpm --filter @repo/db db:seed:custos`
 */
import { and, eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import {
  companies,
  costCategories,
  costEntries,
  recurringCosts,
  tenants,
} from '../src/schema/index.js'

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/logifit'

const CATEGORIES = [
  { slug: 'aluguel', name: 'Aluguel', type: 'fixed' as const, icon: '🏢' },
  { slug: 'folha', name: 'Folha CLT', type: 'fixed' as const, icon: '👥' },
  { slug: 'internet', name: 'Internet / Telefonia', type: 'fixed' as const, icon: '📡' },
  { slug: 'marketing', name: 'Marketing', type: 'variable' as const, icon: '📣' },
  { slug: 'manutencao', name: 'Manutenção', type: 'variable' as const, icon: '🔧' },
  { slug: 'energia', name: 'Energia / Água', type: 'variable' as const, icon: '⚡' },
] as const

function daysAgo(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL })
  const db = drizzle(pool)
  console.log(`→ seeding custos ${DATABASE_URL.replace(/:[^:@]+@/, ':***@')}`)

  const tenantsRows = await db.select({ id: tenants.id, name: tenants.name }).from(tenants)
  console.log(`  • ${tenantsRows.length} tenants encontrados`)

  for (const tenant of tenantsRows) {
    // 1. Categorias
    for (const cat of CATEGORIES) {
      await db
        .insert(costCategories)
        .values({
          tenantId: tenant.id,
          slug: cat.slug,
          name: cat.name,
          type: cat.type,
          icon: cat.icon,
        })
        .onConflictDoNothing({ target: [costCategories.tenantId, costCategories.slug] })
    }

    const catRows = await db
      .select({ id: costCategories.id, slug: costCategories.slug })
      .from(costCategories)
      .where(eq(costCategories.tenantId, tenant.id))
    const catBySlug = new Map(catRows.map((c) => [c.slug, c.id]))

    // 2. Pega matriz do tenant
    const [matriz] = await db
      .select({ id: companies.id })
      .from(companies)
      .where(eq(companies.tenantId, tenant.id))
      .limit(1)
    if (!matriz) {
      console.log(`  • ${tenant.name}: sem company, pulando`)
      continue
    }

    // 3. Cost entries (idempotente via count)
    const existingEntries = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(costEntries)
      .where(eq(costEntries.tenantId, tenant.id))
    if ((existingEntries[0]?.n ?? 0) >= 10) {
      console.log(`  • ${tenant.name}: ${existingEntries[0]?.n} custos já existem`)
      continue
    }

    const ENTRIES = [
      { slug: 'aluguel', amountCents: 350000, daysAgo: 5, desc: 'Aluguel mês corrente' },
      { slug: 'aluguel', amountCents: 350000, daysAgo: 35, desc: 'Aluguel mês anterior' },
      { slug: 'aluguel', amountCents: 350000, daysAgo: 65, desc: 'Aluguel 2 meses atrás' },
      { slug: 'folha', amountCents: 1500000, daysAgo: 8, desc: 'Folha CLT mês corrente' },
      { slug: 'folha', amountCents: 1500000, daysAgo: 38, desc: 'Folha CLT mês anterior' },
      { slug: 'marketing', amountCents: 80000, daysAgo: 10, desc: 'Anúncios Instagram' },
      { slug: 'marketing', amountCents: 45000, daysAgo: 25, desc: 'Panfletagem' },
      { slug: 'manutencao', amountCents: 22000, daysAgo: 12, desc: 'Troca rolamento esteira' },
      { slug: 'energia', amountCents: 95000, daysAgo: 18, desc: 'Energia + água' },
      { slug: 'internet', amountCents: 35000, daysAgo: 22, desc: 'Plano fibra dedicada' },
    ] as const

    for (const e of ENTRIES) {
      const catId = catBySlug.get(e.slug)
      if (!catId) continue
      await db.insert(costEntries).values({
        tenantId: tenant.id,
        companyId: matriz.id,
        categoryId: catId,
        amountCents: e.amountCents,
        incurredAt: daysAgo(e.daysAgo),
        description: e.desc,
      })
    }

    // 4. Recurring costs
    const existingRec = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(recurringCosts)
      .where(eq(recurringCosts.tenantId, tenant.id))
    if ((existingRec[0]?.n ?? 0) === 0) {
      const RECURRING = [
        { slug: 'aluguel', amountCents: 350000, dayOfMonth: 5, desc: 'Aluguel mensal' },
        { slug: 'folha', amountCents: 1500000, dayOfMonth: 5, desc: 'Folha CLT mensal' },
        { slug: 'internet', amountCents: 35000, dayOfMonth: 10, desc: 'Plano fibra' },
      ] as const
      for (const r of RECURRING) {
        const catId = catBySlug.get(r.slug)
        if (!catId) continue
        await db.insert(recurringCosts).values({
          tenantId: tenant.id,
          companyId: matriz.id,
          categoryId: catId,
          amountCents: r.amountCents,
          dayOfMonth: r.dayOfMonth,
          description: r.desc,
          startsAt: daysAgo(180),
          active: true,
        })
      }
    }

    console.log(`  • ${tenant.name}: 6 categorias + 10 custos + 3 recorrências`)
  }

  await pool.end()
  console.log('✓ seed custos done')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
