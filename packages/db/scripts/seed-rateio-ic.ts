/**
 * Seed Sprint 16 Faixa D — Rateio + Intercompany (ADR 0036).
 *
 * **Apenas tenants com topology='owned'** (regra 25) — franquia é pulada
 * com mensagem informativa.
 *
 * Por tenant owned:
 *   - 2 allocation_rules canônicas (Rateio aluguel + Rateio software por revenue)
 *   - 3 intercompany_entries de exemplo (1 payment + 1 service + 1 goods com NF-e flag)
 *
 * Idempotente via unique (tenant, name) em rules + count check em IC.
 *
 * Uso: `pnpm --filter @repo/db db:seed:rateio-ic`
 */
import { and, asc, eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import {
  allocationRules,
  companies,
  intercompanyEntries,
  tenants,
} from '../src/schema/index.js'

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/logifit'

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL })
  const db = drizzle(pool)
  console.log(`→ seeding rateio + IC ${DATABASE_URL.replace(/:[^:@]+@/, ':***@')}`)

  const tenantsRows = await db
    .select({ id: tenants.id, name: tenants.name, topology: tenants.topology })
    .from(tenants)
  console.log(`  • ${tenantsRows.length} tenants encontrados`)

  let totalRules = 0
  let totalIcs = 0

  for (const tenant of tenantsRows) {
    if (tenant.topology !== 'owned') {
      console.log(`  • ${tenant.name}: topology=${tenant.topology}, pulando (regra 25)`)
      continue
    }
    // Lista companies do tenant (matriz + filiais)
    const comps = await db
      .select({ id: companies.id, type: companies.type })
      .from(companies)
      .where(eq(companies.tenantId, tenant.id))
      .orderBy(asc(companies.type), asc(companies.createdAt))
    if (comps.length < 2) {
      console.log(`  • ${tenant.name}: <2 companies, pulando`)
      continue
    }
    const matriz = comps.find((c) => c.type === 'matriz')!
    const filiais = comps.filter((c) => c.type === 'filial')
    if (filiais.length === 0) continue

    // Rule 1: rateio fixo 40/30/30 (ou ajustado pra qtd de filiais)
    const totalFiliais = filiais.length
    const filialPercent = Math.floor(60 / totalFiliais)
    const distribution1 = [
      { companyId: matriz.id, percent: 40 },
      ...filiais.map((f, i) => ({
        companyId: f.id,
        percent: i === totalFiliais - 1 ? 60 - filialPercent * (totalFiliais - 1) : filialPercent,
      })),
    ]

    await db
      .insert(allocationRules)
      .values({
        tenantId: tenant.id,
        name: 'Aluguel rateado matriz+filiais',
        kind: 'fixed',
        distribution: distribution1,
        description: `Rateio fixo do aluguel corporativo: matriz absorve 40%, ${totalFiliais} filiais dividem 60%.`,
      })
      .onConflictDoNothing({ target: [allocationRules.tenantId, allocationRules.name] })
      .then((r) => {
        if (r.rowCount && r.rowCount > 0) totalRules += 1
      })

    // Rule 2: rateio por receita (snapshot dinâmico)
    await db
      .insert(allocationRules)
      .values({
        tenantId: tenant.id,
        name: 'Software / SaaS por receita',
        kind: 'by_revenue',
        distribution: comps.map((c) => ({ companyId: c.id })),
        description:
          'Custo de software (Google Cloud, Asaas, etc) rateado proporcional ao faturamento de cada company no mês anterior.',
      })
      .onConflictDoNothing({ target: [allocationRules.tenantId, allocationRules.name] })
      .then((r) => {
        if (r.rowCount && r.rowCount > 0) totalRules += 1
      })

    // IC entries — só se ainda não tem nenhum
    const [icCount] = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(intercompanyEntries)
      .where(eq(intercompanyEntries.tenantId, tenant.id))
    if ((icCount?.c ?? 0) === 0) {
      await db.insert(intercompanyEntries).values({
        tenantId: tenant.id,
        fromCompanyId: matriz.id,
        toCompanyId: filiais[0]!.id,
        amountCents: 350000,
        kind: 'payment',
        notes: 'Matriz pagou energia elétrica da filial 1 — centralização operacional',
      })
      totalIcs += 1

      await db.insert(intercompanyEntries).values({
        tenantId: tenant.id,
        fromCompanyId: filiais[0]!.id,
        toCompanyId: matriz.id,
        amountCents: 120000,
        kind: 'service',
        notes: 'Filial 1 prestou consultoria pra matriz (treinamento interno equipe)',
      })
      totalIcs += 1

      if (filiais.length >= 2) {
        await db.insert(intercompanyEntries).values({
          tenantId: tenant.id,
          fromCompanyId: matriz.id,
          toCompanyId: filiais[1]!.id,
          amountCents: 480000,
          kind: 'goods',
          notes:
            'Transferência de esteira ergométrica seminova da matriz para a filial 2 — NF-e de transferência necessária (CFOP 5.151/6.151)',
        })
        totalIcs += 1
      }
    }

    console.log(
      `  • ${tenant.name}: rateio + IC seed aplicado (${totalFiliais} filial(is))`,
    )
  }

  await pool.end()
  console.log(
    `✓ seeded ${totalRules} allocation_rules + ${totalIcs} intercompany_entries`,
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
