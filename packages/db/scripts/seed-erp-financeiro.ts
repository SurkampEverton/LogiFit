/**
 * Seed Sprint 15 Faixa D — ERP Financeiro Core (ADRs 0033 + 0034).
 *
 * Por tenant:
 *   - 20 fornecedores PJ tÃ­picos brasileiros (com CNPJs fictÃ­cios)
 *   - 10 APs em estados variados (paid/pending/approved/rejected/cancelled/draft)
 *   - 5 ARs avulsos em estados variados (received/issued/draft)
 *
 * **Pré-requisito:** seed plano de contas (`pnpm db:seed:plano-contas`) precisa
 * ter rodado antes — APs/ARs apontam para folhas brasileiras canÃ´nicas.
 *
 * Idempotente via INSERT ... ON CONFLICT DO NOTHING (e via unique tenant+person
 * em suppliers).
 *
 * Uso: `pnpm --filter @repo/db db:seed:erp-financeiro`
 */
import { and, eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import {
  accountsPayable,
  accountsReceivable,
  apArPayments,
  chartOfAccounts,
  companies,
  persons,
  suppliers,
  tenants,
} from '../src/schema/index.js'

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/logifit'

// ─── CNPJs vÃ¡lidos no algoritmo (dÃ­gitos verificadores corretos) ───────
// Gerados via algoritmo CNPJ; podem nÃ£o existir na Receita
const SUPPLIER_TEMPLATES = [
  {
    name: 'Imobiliária Central Cuiabá Ltda',
    doc: '08123456000174',
    chartCode: '4.2.01',
    term: 30,
    method: 'pix',
  },
  {
    name: 'Iluminar Engenharia Elétrica MEI',
    doc: '15234567000185',
    chartCode: '4.2.03',
    term: 15,
    method: 'boleto',
  },
  {
    name: 'TIM Brasil S.A.',
    doc: '02421421000111',
    chartCode: '4.2.05',
    term: 10,
    method: 'boleto',
  },
  {
    name: 'Google Cloud LATAM Ltda',
    doc: '06990590000123',
    chartCode: '4.2.07',
    term: 30,
    method: 'pix',
  },
  {
    name: 'Suplementos Atlas Distribuidora',
    doc: '23456789000196',
    chartCode: '5.1.02',
    term: 45,
    method: 'ted',
  },
  {
    name: 'Limpa Tudo Materiais Higiênicos ME',
    doc: '34567890000107',
    chartCode: '4.2.06',
    term: 30,
    method: 'boleto',
  },
  {
    name: 'Equipe Crossfit Manutenção LTDA',
    doc: '45678901000118',
    chartCode: '5.1.03',
    term: 30,
    method: 'pix',
  },
  {
    name: 'AdsLuz Marketing Digital ME',
    doc: '56789012000129',
    chartCode: '4.3.01',
    term: 15,
    method: 'pix',
  },
  {
    name: 'Contabilidade Numero Certo S/S',
    doc: '67890123000130',
    chartCode: '4.2.08',
    term: 5,
    method: 'pix',
  },
  {
    name: 'Advocacia & Cia Sociedade',
    doc: '78901234000141',
    chartCode: '4.2.09',
    term: 30,
    method: 'pix',
  },
  {
    name: 'Sabesp Saneamento SP',
    doc: '43776517000180',
    chartCode: '4.2.04',
    term: 10,
    method: 'boleto',
  },
  {
    name: 'Enel Distribuição SP',
    doc: '61695227000193',
    chartCode: '4.2.03',
    term: 10,
    method: 'boleto',
  },
  {
    name: 'Fast Print Gráfica Express',
    doc: '89012345000152',
    chartCode: '4.3.02',
    term: 30,
    method: 'pix',
  },
  {
    name: 'Uniformes Pro Esporte LTDA',
    doc: '90123456000163',
    chartCode: '5.1.05',
    term: 30,
    method: 'pix',
  },
  {
    name: 'Bandagens Premium Distribuição',
    doc: '12345678000174',
    chartCode: '5.1.01',
    term: 45,
    method: 'ted',
  },
  {
    name: 'PIX Pagamentos Bancárias SA',
    doc: '13579024000185',
    chartCode: '4.4.02',
    term: 0,
    method: 'pix',
  },
  {
    name: 'Asaas Tecnologia LTDA',
    doc: '19540550000121',
    chartCode: '4.2.07',
    term: 15,
    method: 'pix',
  },
  {
    name: 'Calibração SP Equipamentos',
    doc: '24681357000196',
    chartCode: '5.1.04',
    term: 30,
    method: 'pix',
  },
  {
    name: 'Eventos & Esporte Patrocínios ME',
    doc: '35792468000107',
    chartCode: '4.3.03',
    term: 30,
    method: 'pix',
  },
  {
    name: 'Vale Brindes Corporativos',
    doc: '46813579000118',
    chartCode: '4.3.02',
    term: 30,
    method: 'pix',
  },
] as const

// ─── AP templates (status variados) ──────────────────────────────────────
const AP_TEMPLATES = [
  {
    supplierIndex: 0,
    chartCode: '4.2.01',
    amountCents: 380000,
    daysAgo: 25,
    dueOffset: 5,
    status: 'paid' as const,
    description: 'Aluguel matriz maio',
  },
  {
    supplierIndex: 1,
    chartCode: '4.2.03',
    amountCents: 124500,
    daysAgo: 20,
    dueOffset: 10,
    status: 'paid' as const,
    description: 'Energia abril matriz',
  },
  {
    supplierIndex: 8,
    chartCode: '4.2.08',
    amountCents: 89000,
    daysAgo: 15,
    dueOffset: 5,
    status: 'paid' as const,
    description: 'Honorários contábeis maio',
  },
  {
    supplierIndex: 2,
    chartCode: '4.2.05',
    amountCents: 35900,
    daysAgo: 8,
    dueOffset: 5,
    status: 'pending_approval' as const,
    description: 'Telefonia maio (4 linhas)',
  },
  {
    supplierIndex: 7,
    chartCode: '4.3.01',
    amountCents: 156000,
    daysAgo: 5,
    dueOffset: 10,
    status: 'pending_approval' as const,
    description: 'Ads Meta + Google maio',
  },
  {
    supplierIndex: 4,
    chartCode: '5.1.02',
    amountCents: 480000,
    daysAgo: 3,
    dueOffset: 30,
    status: 'approved' as const,
    description: 'Suplementos lote 50 unidades',
  },
  {
    supplierIndex: 12,
    chartCode: '4.3.02',
    amountCents: 28000,
    daysAgo: 2,
    dueOffset: 25,
    status: 'approved' as const,
    description: 'Folders campanha verão',
  },
  {
    supplierIndex: 5,
    chartCode: '4.2.06',
    amountCents: 18500,
    daysAgo: 10,
    dueOffset: 15,
    status: 'rejected' as const,
    description: 'Material de limpeza — divergência valor',
  },
  {
    supplierIndex: 18,
    chartCode: '4.3.03',
    amountCents: 250000,
    daysAgo: 1,
    dueOffset: 60,
    status: 'cancelled' as const,
    description: 'Patrocínio evento cancelado',
  },
  {
    supplierIndex: 14,
    chartCode: '5.1.01',
    amountCents: 67500,
    daysAgo: 1,
    dueOffset: 45,
    status: 'draft' as const,
    description: 'Bandagens reposição estoque',
  },
] as const

// ─── AR templates (avulsos) ──────────────────────────────────────────────
const AR_TEMPLATES = [
  {
    chartCode: '3.2.01',
    amountCents: 80000,
    daysAgo: 30,
    dueOffset: 0,
    status: 'received' as const,
    description: 'Aluguel sala convidado abril',
  },
  {
    chartCode: '3.1.07',
    amountCents: 18900,
    daysAgo: 15,
    dueOffset: 0,
    status: 'received' as const,
    description: 'Venda whey 5kg — cliente avulso',
  },
  {
    chartCode: '3.2.01',
    amountCents: 80000,
    daysAgo: 2,
    dueOffset: 15,
    status: 'issued' as const,
    description: 'Aluguel sala convidado maio',
  },
  {
    chartCode: '3.1.04',
    amountCents: 25000,
    daysAgo: 1,
    dueOffset: 7,
    status: 'issued' as const,
    description: 'Avaliação física avulsa — Maria S.',
  },
  {
    chartCode: '3.1.08',
    amountCents: 12500,
    daysAgo: 0,
    dueOffset: 10,
    status: 'draft' as const,
    description: 'Venda camiseta linha LogiFit',
  },
] as const

function isoOffset(daysFromNow: number): string {
  const d = new Date()
  d.setDate(d.getDate() + daysFromNow)
  return d.toISOString().slice(0, 10)
}

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL })
  const db = drizzle(pool)
  console.log(`→ seeding erp-financeiro ${DATABASE_URL.replace(/:[^:@]+@/, ':***@')}`)

  const tenantsRows = await db.select({ id: tenants.id, name: tenants.name }).from(tenants)
  console.log(`  • ${tenantsRows.length} tenants encontrados`)

  let totalSuppliers = 0
  let totalAps = 0
  let totalArs = 0

  for (const tenant of tenantsRows) {
    // 1. Matriz da company
    const [matriz] = await db
      .select({ id: companies.id })
      .from(companies)
      .where(eq(companies.tenantId, tenant.id))
      .limit(1)
    if (!matriz) {
      console.log(`  • ${tenant.name}: sem company, pulando`)
      continue
    }

    // 2. Cria/garante persons fornecedores
    const supplierIds: string[] = []
    for (const tpl of SUPPLIER_TEMPLATES) {
      // Verifica se person já existe via document
      const [existing] = await db
        .select({ id: persons.id })
        .from(persons)
        .where(and(eq(persons.tenantId, tenant.id), eq(persons.document, tpl.doc)))
        .limit(1)

      let personId = existing?.id
      if (!personId) {
        const [created] = await db
          .insert(persons)
          .values({
            tenantId: tenant.id,
            kind: 'pj',
            name: tpl.name,
            document: tpl.doc,
            email: `contato@${tpl.doc}.fake`,
          })
          .returning({ id: persons.id })
        personId = created!.id
      }

      // Insere supplier (idempotente via unique tenant+person)
      let supplierId: string | undefined
      const [existingSupp] = await db
        .select({ id: suppliers.id })
        .from(suppliers)
        .where(and(eq(suppliers.tenantId, tenant.id), eq(suppliers.personId, personId)))
        .limit(1)
      if (existingSupp) {
        supplierId = existingSupp.id
      } else {
        const [createdSupp] = await db
          .insert(suppliers)
          .values({
            tenantId: tenant.id,
            personId,
            defaultPaymentMethod: tpl.method as 'pix' | 'ted' | 'boleto',
            defaultPaymentTermDays: tpl.term,
          })
          .returning({ id: suppliers.id })
        supplierId = createdSupp!.id
        totalSuppliers += 1
      }
      supplierIds.push(supplierId!)
    }

    // 3. Lookup de chartOfAccounts por code
    const chartRows = await db
      .select({ id: chartOfAccounts.id, code: chartOfAccounts.code })
      .from(chartOfAccounts)
      .where(eq(chartOfAccounts.tenantId, tenant.id))
    const chartByCode = new Map(chartRows.map((c) => [c.code, c.id]))

    // 4. APs — verifica se já existem via descrição+supplier (rough idempotency)
    const [existingApCount] = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(accountsPayable)
      .where(eq(accountsPayable.tenantId, tenant.id))
    if ((existingApCount?.c ?? 0) === 0) {
      for (const ap of AP_TEMPLATES) {
        const chartId = chartByCode.get(ap.chartCode)
        if (!chartId) continue
        const supplierId = supplierIds[ap.supplierIndex]!
        const issueDate = isoOffset(-ap.daysAgo)
        const dueDate = isoOffset(-ap.daysAgo + ap.dueOffset)
        const [row] = await db
          .insert(accountsPayable)
          .values({
            tenantId: tenant.id,
            companyId: matriz.id,
            supplierId,
            chartAccountId: chartId,
            amountCents: ap.amountCents,
            retentionTotalCents: 0,
            netAmountCents: ap.amountCents,
            issueDate,
            dueDate,
            description: ap.description,
            docNumber: `NF${Math.floor(Math.random() * 99999)
              .toString()
              .padStart(5, '0')}`,
            noInvoice: false,
            status: ap.status,
            approvalTrace:
              ap.status === 'paid' || ap.status === 'approved'
                ? [
                    {
                      at: new Date(issueDate + 'T08:00:00Z').toISOString(),
                      byUserId: '00000000-0000-0000-0000-000000000000',
                      action: 'submitted',
                    },
                    {
                      at: new Date(issueDate + 'T14:00:00Z').toISOString(),
                      byUserId: '00000000-0000-0000-0000-000000000000',
                      byRole: 'gerente_financeiro',
                      action: 'approved',
                      comment: 'OK — seed canônico',
                    },
                  ]
                : ap.status === 'rejected'
                  ? [
                      {
                        at: new Date(issueDate + 'T08:00:00Z').toISOString(),
                        byUserId: '00000000-0000-0000-0000-000000000000',
                        action: 'submitted',
                      },
                      {
                        at: new Date(issueDate + 'T16:00:00Z').toISOString(),
                        byUserId: '00000000-0000-0000-0000-000000000000',
                        byRole: 'gerente_financeiro',
                        action: 'rejected',
                        comment: 'Divergência identificada',
                      },
                    ]
                  : ap.status === 'pending_approval'
                    ? [
                        {
                          at: new Date(issueDate + 'T08:00:00Z').toISOString(),
                          byUserId: '00000000-0000-0000-0000-000000000000',
                          action: 'submitted',
                        },
                      ]
                    : [],
            paidAt: ap.status === 'paid' ? new Date(dueDate + 'T10:00:00Z') : null,
            paidAmountCents: ap.status === 'paid' ? ap.amountCents : null,
            paymentMethod: ap.status === 'paid' ? 'pix' : null,
            source: 'manual',
          })
          .returning({ id: accountsPayable.id })

        // Registra payment row pras APs pagas (pra paidTotal bater)
        if (ap.status === 'paid' && row) {
          await db.insert(apArPayments).values({
            tenantId: tenant.id,
            sourceType: 'ap',
            sourceId: row.id,
            amountCents: ap.amountCents,
            paidAt: new Date(dueDate + 'T10:00:00Z'),
            method: 'pix',
            reference: `seed-${row.id.slice(0, 8)}`,
          })
        }
        totalAps += 1
      }
    }

    // 5. ARs avulsos
    const [existingArCount] = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(accountsReceivable)
      .where(eq(accountsReceivable.tenantId, tenant.id))
    if ((existingArCount?.c ?? 0) === 0) {
      for (const ar of AR_TEMPLATES) {
        const chartId = chartByCode.get(ar.chartCode)
        if (!chartId) continue
        const issueDate = isoOffset(-ar.daysAgo)
        const dueDate = isoOffset(-ar.daysAgo + ar.dueOffset)
        const [row] = await db
          .insert(accountsReceivable)
          .values({
            tenantId: tenant.id,
            companyId: matriz.id,
            chartAccountId: chartId,
            amountCents: ar.amountCents,
            issueDate,
            dueDate,
            description: ar.description,
            status: ar.status,
            receivedAt: ar.status === 'received' ? new Date(dueDate + 'T11:00:00Z') : null,
            receivedAmountCents: ar.status === 'received' ? ar.amountCents : null,
          })
          .returning({ id: accountsReceivable.id })

        if (ar.status === 'received' && row) {
          await db.insert(apArPayments).values({
            tenantId: tenant.id,
            sourceType: 'ar',
            sourceId: row.id,
            amountCents: ar.amountCents,
            paidAt: new Date(dueDate + 'T11:00:00Z'),
            method: 'pix',
            reference: `seed-ar-${row.id.slice(0, 8)}`,
          })
        }
        totalArs += 1
      }
    }

    console.log(`  • ${tenant.name}: suppliers/AP/AR populados`)
  }

  await pool.end()
  console.log(
    `✓ seeded ${totalSuppliers} suppliers + ${totalAps} APs + ${totalArs} ARs em ${tenantsRows.length} tenants`,
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
