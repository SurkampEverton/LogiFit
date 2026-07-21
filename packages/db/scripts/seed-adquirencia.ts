/**
 * Seed Sprint 18 Faixa D — Adquirência.
 *
 * Por tenant (matriz):
 *   - 2 conexões mock (Stone + Cielo sandbox)
 *   - 30 vendas sintéticas determinísticas (15 por connection, últimos 60 dias)
 *   - 3 reconciliation_rules canônicas
 *
 * Idempotente via:
 *   - unique (provider, merchant_id) em acquirer_connections (merchant_id usa tenant.id pra evitar colisão entre tenants)
 *   - unique (connection_id, external_id) em acquirer_sales
 *   - unique (tenant_id, name) em acquirer_reconciliation_rules
 *
 * Uso: `pnpm --filter @repo/db db:seed:adquirencia`
 */
import { and, asc, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import {
  acquirerConnections,
  acquirerReconciliationRules,
  acquirerSales,
  companies,
  tenants,
} from '../src/schema/index.js'

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/logifit'

type ProviderKey = 'stone' | 'cielo' | 'rede' | 'getnet' | 'pagseguro' | 'mock'

interface ConnectionSeed {
  provider: ProviderKey
  nickname: string
  feeTable: Record<'credit' | 'debit' | 'pix', { rate: number; settlementDays: number }>
}

const CONNECTION_SEEDS: ConnectionSeed[] = [
  {
    provider: 'stone',
    nickname: 'Stone Matriz (sandbox)',
    feeTable: {
      credit: { rate: 2.79, settlementDays: 30 },
      debit: { rate: 1.29, settlementDays: 1 },
      pix: { rate: 0.79, settlementDays: 0 },
    },
  },
  {
    provider: 'cielo',
    nickname: 'Cielo Filial (sandbox)',
    feeTable: {
      credit: { rate: 2.99, settlementDays: 30 },
      debit: { rate: 1.39, settlementDays: 1 },
      pix: { rate: 0.99, settlementDays: 0 },
    },
  },
]

interface RuleSeed {
  name: string
  priority: number
  condition: Record<string, unknown>
  action: 'auto_match_bank' | 'flag_for_review'
}

const RULES: RuleSeed[] = [
  {
    name: 'Auto-match Stone settlement',
    priority: 10,
    condition: {
      providerEquals: 'stone',
      bankDescriptionContains: 'stone',
      daysAfterSettlementMax: 3,
    },
    action: 'auto_match_bank',
  },
  {
    name: 'Auto-match Cielo settlement',
    priority: 20,
    condition: {
      providerEquals: 'cielo',
      bankDescriptionContains: 'cielo',
      daysAfterSettlementMax: 3,
    },
    action: 'auto_match_bank',
  },
  {
    name: 'Flag chargeback ou voucher >R$ 5k',
    priority: 999,
    condition: { amountMinCents: 500_000, cardKindEquals: 'voucher' },
    action: 'flag_for_review',
  },
]

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

function isoToday(): string {
  return new Date().toISOString().slice(0, 10)
}

function hash(s: string): number {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = (h * 33 + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL })
  const db = drizzle(pool)
  console.log(`→ seeding adquirencia ${DATABASE_URL.replace(/:[^:@]+@/, ':***@')}`)

  const tenantsRows = await db.select({ id: tenants.id, name: tenants.name }).from(tenants)
  console.log(`  • ${tenantsRows.length} tenants encontrados`)

  let totalConns = 0
  let totalSales = 0
  let totalRules = 0

  for (const tenant of tenantsRows) {
    const [matriz] = await db
      .select({ id: companies.id })
      .from(companies)
      .where(and(eq(companies.tenantId, tenant.id), eq(companies.type, 'matriz')))
      .orderBy(asc(companies.createdAt))
      .limit(1)
    if (!matriz) continue

    for (const seed of CONNECTION_SEEDS) {
      // merchantId único por tenant para evitar colisão no unique global (provider, merchant_id)
      // Usa tenant.id completo sem hífen para garantir unicidade global (provider, merchant_id).
      // Tenants do seed canônico têm prefixos curtos colididos (ex: 00000003-0001-* vs 00000003-0001-*-0020).
      const merchantId = `MOCK-${seed.provider.toUpperCase()}-${tenant.id.replace(/-/g, '')}`

      let connId: string | undefined
      const [existing] = await db
        .select({ id: acquirerConnections.id })
        .from(acquirerConnections)
        .where(eq(acquirerConnections.merchantId, merchantId))
        .limit(1)
      if (existing) {
        connId = existing.id
      } else {
        const [row] = await db
          .insert(acquirerConnections)
          .values({
            tenantId: tenant.id,
            companyId: matriz.id,
            provider: seed.provider,
            merchantId,
            nickname: seed.nickname,
            credentialsEncrypted: JSON.stringify({ merchantId, apiKey: 'mock-sandbox-key' }),
            sandbox: true,
            status: 'active',
            lastSyncedAt: new Date(),
          })
          .returning({ id: acquirerConnections.id })
        connId = row?.id
        if (connId) totalConns += 1
      }

      if (!connId) continue

      // 15 vendas sintéticas últimos 60 dias
      const brands = ['visa', 'master', 'elo', 'amex']
      const kinds: Array<'credit' | 'debit' | 'pix'> = ['credit', 'debit', 'pix']
      const today = isoToday()
      for (let i = 0; i < 15; i++) {
        const seedNum = hash(`${tenant.id}-${seed.provider}-${i}`)
        const daysBack = 60 - i * 4 // dispersa últimos 60 dias
        const capturedDate = addDays(today, -daysBack)
        const grossCents = 5_000 + (seedNum % 90_000)
        const kind = kinds[seedNum % kinds.length]!
        const fee = seed.feeTable[kind]
        const installments = kind === 'credit' ? 1 + (seedNum % 6) : 1
        const ratePctTotal = fee.rate + Math.max(0, installments - 1) * 0.2
        const feeCents = Math.round((grossCents * ratePctTotal) / 100)
        const netCents = grossCents - feeCents
        const settlementDate = addDays(capturedDate, fee.settlementDays)
        const todayDate = today
        const isPastSettlement = settlementDate <= todayDate
        const externalId = `MOCK-${seed.provider}-${tenant.id.replace(/-/g, '')}-${i}`

        try {
          await db.insert(acquirerSales).values({
            tenantId: tenant.id,
            companyId: matriz.id,
            connectionId: connId,
            externalId,
            capturedAt: new Date(`${capturedDate}T12:00:00Z`),
            grossAmountCents: grossCents,
            feeCents,
            netAmountCents: netCents,
            cardBrand: brands[seedNum % brands.length],
            cardKind: kind,
            installments,
            expectedSettlementDate: settlementDate,
            actualSettlementDate: isPastSettlement ? settlementDate : null,
            status: isPastSettlement ? 'settled' : 'captured',
            rawPayload: { seed: true, mock: true },
          })
          totalSales += 1
        } catch (err) {
          const e = err as { code?: string; cause?: { code?: string } }
          const code = e.code ?? e.cause?.code ?? ''
          if (code !== '23505') throw err
        }
      }
    }

    // Reconciliation rules
    for (const rule of RULES) {
      try {
        await db.insert(acquirerReconciliationRules).values({
          tenantId: tenant.id,
          name: rule.name,
          condition: rule.condition,
          action: rule.action,
          priority: rule.priority,
          active: true,
        })
        totalRules += 1
      } catch (err) {
        const e = err as { code?: string; cause?: { code?: string } }
        const code = e.code ?? e.cause?.code ?? ''
        if (code !== '23505') throw err
      }
    }
  }

  console.log(`✓ seed done: ${totalConns} conexões + ${totalSales} vendas + ${totalRules} regras`)
  await pool.end()
}

main().catch((err) => {
  console.error('seed failed:', err)
  process.exit(1)
})
