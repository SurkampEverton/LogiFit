/**
 * Seed Sprint 17 Faixa D — Bancos + reconciliation rules.
 *
 * Por tenant:
 *   - 2 contas bancárias na matriz (1 CC PJ + 1 caixa)
 *   - 20 transações OFX-style aleatórias últimos 60 dias
 *   - 5 reconciliation_rules canônicas
 *
 * Idempotente via unique constraints + count check em bank_transactions.
 *
 * Uso: `pnpm --filter @repo/db db:seed:bancos`
 */
import { and, asc, eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import {
  bankAccounts,
  bankTransactions,
  companies,
  reconciliationRules,
  tenants,
} from '../src/schema/index.js'

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/logifit'

interface BankSeed {
  bankCode: string
  bankName: string
  agency: string
  accountNumber: string
  accountDigit: string
  kind: 'business' | 'cashbox'
  nickname: string
  openingBalanceCents: number
}

const BANKS: BankSeed[] = [
  {
    bankCode: '237',
    bankName: 'Bradesco',
    agency: '1234',
    accountNumber: '56789',
    accountDigit: '0',
    kind: 'business',
    nickname: 'Bradesco CC PJ Matriz',
    openingBalanceCents: 1_500_000,
  },
  {
    bankCode: '000',
    bankName: 'Caixa interno',
    agency: '',
    accountNumber: 'CAIXA-MATRIZ',
    accountDigit: '',
    kind: 'cashbox',
    nickname: 'Caixa físico matriz',
    openingBalanceCents: 80_000,
  },
]

interface RuleSeed {
  name: string
  priority: number
  condition: Record<string, unknown>
  action: 'auto_match_ap' | 'auto_match_ar' | 'auto_create_entry' | 'flag_for_review'
}

const RULES: RuleSeed[] = [
  {
    name: 'Auto-match aluguel matriz',
    priority: 10,
    condition: { descriptionContains: 'aluguel', amountSign: 'negative' },
    action: 'auto_match_ap',
  },
  {
    name: 'Auto-match energia',
    priority: 20,
    condition: { descriptionContains: 'energia', amountSign: 'negative' },
    action: 'auto_match_ap',
  },
  {
    name: 'Auto-match mensalidades recebidas',
    priority: 30,
    condition: { descriptionContains: 'mensalidade', amountSign: 'positive' },
    action: 'auto_match_ar',
  },
  {
    name: 'Auto-create tarifa bancária',
    priority: 100,
    condition: {
      descriptionContains: 'tarifa',
      amountMinCents: 0,
      amountMaxCents: 10000,
      amountSign: 'negative',
    },
    action: 'auto_create_entry',
  },
  {
    name: 'Flag transações grandes >R$50k',
    priority: 999,
    condition: { amountMinCents: 5_000_000 },
    action: 'flag_for_review',
  },
]

const SAMPLE_TX_DESCRIPTIONS = [
  { desc: 'ALUGUEL MAIO 2026', sign: -1, base: 380_000 },
  { desc: 'ENERGIA ELETRICA MATRIZ', sign: -1, base: 120_000 },
  { desc: 'INTERNET FIBRA EMPRESARIAL', sign: -1, base: 38_000 },
  { desc: 'MENSALIDADE ALUNO MARIA SILVA', sign: 1, base: 18_900 },
  { desc: 'MENSALIDADE ALUNO JOAO PEREIRA', sign: 1, base: 21_500 },
  { desc: 'TARIFA TED INTRABANK', sign: -1, base: 1_490 },
  { desc: 'PIX RECEBIDO CARLOS LIMA', sign: 1, base: 15_000 },
  { desc: 'SUPLEMENTOS ATLAS DISTRIB', sign: -1, base: 480_000 },
  { desc: 'CONSULTORIA CONTABIL MAIO', sign: -1, base: 89_000 },
  { desc: 'PIX RECEBIDO ANA SANTOS', sign: 1, base: 25_000 },
  { desc: 'AGUA SABESP', sign: -1, base: 24_500 },
  { desc: 'COMBUSTIVEL CARTAO FROTA', sign: -1, base: 32_500 },
  { desc: 'TARIFA MANUTENCAO CONTA', sign: -1, base: 4_500 },
  { desc: 'MENSALIDADE PEDRO COSTA', sign: 1, base: 18_900 },
  { desc: 'GOOGLE CLOUD PLATFORM', sign: -1, base: 18_500 },
  { desc: 'PIX RECEBIDO LUCAS ROCHA', sign: 1, base: 22_300 },
  { desc: 'MATERIAL HIGIENE LIMPATUDO', sign: -1, base: 18_500 },
  { desc: 'PIX RECEBIDO BEATRIZ MAIA', sign: 1, base: 26_700 },
  { desc: 'MARKETING ADS GOOGLE/META', sign: -1, base: 156_000 },
  { desc: 'JUROS APLICACAO POUPANCA', sign: 1, base: 8_500 },
]

function daysAgo(n: number): Date {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d
}

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL })
  const db = drizzle(pool)
  console.log(`→ seeding bancos ${DATABASE_URL.replace(/:[^:@]+@/, ':***@')}`)

  const tenantsRows = await db.select({ id: tenants.id, name: tenants.name }).from(tenants)
  console.log(`  • ${tenantsRows.length} tenants encontrados`)

  let totalAccounts = 0
  let totalTx = 0
  let totalRules = 0

  for (const tenant of tenantsRows) {
    // Matriz do tenant
    const [matriz] = await db
      .select({ id: companies.id })
      .from(companies)
      .where(and(eq(companies.tenantId, tenant.id), eq(companies.type, 'matriz')))
      .orderBy(asc(companies.createdAt))
      .limit(1)
    if (!matriz) {
      console.log(`  • ${tenant.name}: sem matriz, pulando`)
      continue
    }

    // ─── 1. Bank accounts (idempotente via unique tenant/company/bank/agency/account)
    const accountIds: string[] = []
    for (const bank of BANKS) {
      const [existing] = await db
        .select({ id: bankAccounts.id })
        .from(bankAccounts)
        .where(
          and(
            eq(bankAccounts.companyId, matriz.id),
            eq(bankAccounts.bankCode, bank.bankCode),
            eq(bankAccounts.accountNumber, bank.accountNumber),
          ),
        )
        .limit(1)
      if (existing) {
        accountIds.push(existing.id)
        continue
      }
      const [created] = await db
        .insert(bankAccounts)
        .values({
          tenantId: tenant.id,
          companyId: matriz.id,
          bankCode: bank.bankCode,
          bankName: bank.bankName,
          agency: bank.agency || null,
          accountNumber: bank.accountNumber,
          accountDigit: bank.accountDigit || null,
          kind: bank.kind,
          openingBalanceCents: bank.openingBalanceCents,
          currentBalanceCents: bank.openingBalanceCents,
          nickname: bank.nickname,
        })
        .returning({ id: bankAccounts.id })
      if (created) {
        accountIds.push(created.id)
        totalAccounts += 1
      }
    }

    // ─── 2. Transactions (idempotente via count check)
    if (accountIds.length > 0) {
      const ccPjId = accountIds[0]!
      const [count] = await db
        .select({ c: sql<number>`count(*)::int` })
        .from(bankTransactions)
        .where(eq(bankTransactions.bankAccountId, ccPjId))
      if ((count?.c ?? 0) === 0) {
        let runningBalance = BANKS[0]!.openingBalanceCents
        for (let i = 0; i < SAMPLE_TX_DESCRIPTIONS.length; i++) {
          const t = SAMPLE_TX_DESCRIPTIONS[i]!
          const amount = t.sign * t.base
          runningBalance += amount
          await db.insert(bankTransactions).values({
            tenantId: tenant.id,
            bankAccountId: ccPjId,
            externalId: `OFX-SEED-${tenant.id.slice(0, 4)}-${i.toString().padStart(3, '0')}`,
            postedAt: daysAgo(60 - i * 3),
            amountCents: amount,
            description: t.desc,
            source: 'ofx',
          })
          totalTx += 1
        }
        await db
          .update(bankAccounts)
          .set({
            currentBalanceCents: runningBalance,
            lastSyncedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(bankAccounts.id, ccPjId))
      }
    }

    // ─── 3. Reconciliation rules (idempotente via unique tenant/name)
    for (const rule of RULES) {
      await db
        .insert(reconciliationRules)
        .values({
          tenantId: tenant.id,
          name: rule.name,
          priority: rule.priority,
          condition: rule.condition,
          action: rule.action,
        })
        .onConflictDoNothing({
          target: [reconciliationRules.tenantId, reconciliationRules.name],
        })
        .then((r) => {
          if (r.rowCount && r.rowCount > 0) totalRules += 1
        })
    }

    console.log(`  • ${tenant.name}: 2 contas + ${SAMPLE_TX_DESCRIPTIONS.length} tx + 5 rules`)
  }

  await pool.end()
  console.log(
    `✓ seeded ${totalAccounts} bank_accounts + ${totalTx} bank_transactions + ${totalRules} reconciliation_rules`,
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
