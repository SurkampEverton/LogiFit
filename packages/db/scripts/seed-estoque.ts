/**
 * Seed Sprint 24 Faixa D — Estoque minimal.
 *
 * Por tenant matriz:
 *   - 10 itens (5 consumo + 5 revenda)
 *   - 3 movimentações por item (1 entry + 2 exits)
 *
 * Idempotente via SKU pattern `SEED-{tenant}-{kind}-{i}`.
 *
 * Uso: `pnpm --filter @repo/db db:seed:estoque`
 */
import { and, asc, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import {
  companies,
  stockItems,
  stockMovements,
  tenants,
  users,
} from '../src/schema/index.js'

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/logifit'

interface ItemSeed {
  sku: string
  name: string
  category: string
  unit: string
  costCents: number
  salePriceCents: number | null
  minStock: number
  isResale: boolean
  costMethod: 'peps' | 'custo_medio'
}

const ITEMS: ItemSeed[] = [
  // Consumo interno
  { sku: 'GAZE-7575-100', name: 'Gaze 7.5×7.5cm pacote 100un', category: 'descartavel', unit: 'pct', costCents: 800, salePriceCents: null, minStock: 5, isResale: false, costMethod: 'custo_medio' },
  { sku: 'AGULHA-25X8', name: 'Agulha 25×8 caixa 100un', category: 'descartavel', unit: 'cx', costCents: 1500, salePriceCents: null, minStock: 3, isResale: false, costMethod: 'custo_medio' },
  { sku: 'ATAD-15', name: 'Atadura crepe 15cm', category: 'descartavel', unit: 'un', costCents: 350, salePriceCents: null, minStock: 20, isResale: false, costMethod: 'custo_medio' },
  { sku: 'ALCOOL-70', name: 'Álcool 70% 1L', category: 'limpeza', unit: 'un', costCents: 1200, salePriceCents: null, minStock: 5, isResale: false, costMethod: 'custo_medio' },
  { sku: 'LUVA-M-100', name: 'Luva procedimento M caixa 100un', category: 'descartavel', unit: 'cx', costCents: 4500, salePriceCents: null, minStock: 2, isResale: false, costMethod: 'custo_medio' },
  // Revenda
  { sku: 'CREME-RELAX-150', name: 'Creme relaxante muscular 150g', category: 'revenda', unit: 'un', costCents: 2500, salePriceCents: 5500, minStock: 5, isResale: true, costMethod: 'custo_medio' },
  { sku: 'GEL-ICE-200', name: 'Gel ice analgésico 200g', category: 'revenda', unit: 'un', costCents: 1800, salePriceCents: 4200, minStock: 5, isResale: true, costMethod: 'custo_medio' },
  { sku: 'FAIXA-ELAS-1.5M', name: 'Faixa elástica resistência média 1,5m', category: 'revenda', unit: 'un', costCents: 3500, salePriceCents: 7900, minStock: 3, isResale: true, costMethod: 'peps' },
  { sku: 'GARRAFA-1L', name: 'Garrafa térmica 1L', category: 'revenda', unit: 'un', costCents: 1800, salePriceCents: 3990, minStock: 4, isResale: true, costMethod: 'custo_medio' },
  { sku: 'WHEY-2KG', name: 'Whey protein 2kg', category: 'suplemento', unit: 'un', costCents: 13000, salePriceCents: 21900, minStock: 2, isResale: true, costMethod: 'peps' },
]

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL })
  const db = drizzle(pool)
  console.log(`→ seeding estoque ${DATABASE_URL.replace(/:[^:@]+@/, ':***@')}`)

  const tenantsRows = await db.select({ id: tenants.id, name: tenants.name }).from(tenants)
  console.log(`  • ${tenantsRows.length} tenants encontrados`)

  let totalItems = 0
  let totalMovements = 0

  for (const tenant of tenantsRows) {
    const [matriz] = await db
      .select({ id: companies.id })
      .from(companies)
      .where(and(eq(companies.tenantId, tenant.id), eq(companies.type, 'matriz')))
      .orderBy(asc(companies.createdAt))
      .limit(1)
    if (!matriz) continue

    const [profUser] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.tenantId, tenant.id))
      .limit(1)
    if (!profUser) continue

    for (const seed of ITEMS) {
      const sku = `SEED-${tenant.id.slice(0, 8)}-${seed.sku}`

      // Item
      let itemId: string
      const existing = await db
        .select({ id: stockItems.id })
        .from(stockItems)
        .where(
          and(
            eq(stockItems.tenantId, tenant.id),
            eq(stockItems.companyId, matriz.id),
            eq(stockItems.sku, sku),
          ),
        )
        .limit(1)
      if (existing[0]) {
        itemId = existing[0].id
      } else {
        const [item] = await db
          .insert(stockItems)
          .values({
            tenantId: tenant.id,
            companyId: matriz.id,
            sku,
            name: seed.name,
            category: seed.category,
            unit: seed.unit,
            costCents: seed.costCents,
            salePriceCents: seed.salePriceCents,
            minStock: seed.minStock.toString(),
            isResale: seed.isResale,
            costMethod: seed.costMethod,
            createdByUserId: profUser.id,
          })
          .returning({ id: stockItems.id })
        itemId = item!.id
        totalItems += 1

        // 3 movimentações: 1 entrada de 50un + 2 saídas de 5un cada
        const now = Date.now()
        await db.insert(stockMovements).values([
          {
            tenantId: tenant.id,
            companyId: matriz.id,
            itemId,
            kind: 'entry_purchase',
            quantity: '50',
            unitCostCents: seed.costCents,
            referenceDoc: 'SEED-COMPRA-INICIAL',
            userId: profUser.id,
            at: new Date(now - 30 * 24 * 60 * 60 * 1000), // 30 dias atrás
            notes: 'Seed Sprint 24 — compra inicial',
          },
          {
            tenantId: tenant.id,
            companyId: matriz.id,
            itemId,
            kind: seed.isResale ? 'exit_sale' : 'exit_consumption',
            quantity: '5',
            userId: profUser.id,
            at: new Date(now - 15 * 24 * 60 * 60 * 1000),
            notes: 'Seed Sprint 24 — saída exemplo',
          },
          {
            tenantId: tenant.id,
            companyId: matriz.id,
            itemId,
            kind: seed.isResale ? 'exit_sale' : 'exit_consumption',
            quantity: '5',
            userId: profUser.id,
            at: new Date(now - 5 * 24 * 60 * 60 * 1000),
            notes: 'Seed Sprint 24 — saída exemplo',
          },
        ])
        totalMovements += 3
      }
    }
  }

  console.log(`✓ seed done: ${totalItems} items + ${totalMovements} movements`)
  await pool.end()
}

main().catch((err) => {
  console.error('seed failed:', err)
  process.exit(1)
})
