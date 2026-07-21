/**
 * Seed Sprint 15 Faixa B — plano de contas brasileiro simplificado (ADR 0033)
 * adaptado a academia / clínica fisio / nutri.
 *
 * Idempotente — usa unique `(tenant, code)` via onConflictDoNothing.
 *
 * **5 raízes** (uma por kind): 1-Ativo, 2-Passivo, 3-Receita, 4-Despesa, 5-Custo
 * + **subgrupos agregadores** (is_leaf=false) + **contas folha** (is_leaf=true).
 * AP/AR só apontam para folhas.
 *
 * Total: ~12 agregadoras + ~55 folhas = ~67 contas por tenant.
 *
 * Também popula **3 approval_rules** canônicas:
 *   - Até R$ 500: auto-aprovada (approvers vazio)
 *   - R$ 500 a R$ 5.000: gerente_financeiro (series 1 approver)
 *   - Acima de R$ 5.000: gerente_financeiro + diretor (series 2 approvers)
 *
 * Uso: `pnpm --filter @repo/db db:seed:plano-contas`
 */
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { approvalRules, chartOfAccounts, tenants } from '../src/schema/index.js'

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/logifit'

type Kind = 'ativo' | 'passivo' | 'receita' | 'despesa' | 'custo'

interface ChartSeedRow {
  code: string
  name: string
  kind: Kind
  isLeaf: boolean
  parentCode: string | null
  description?: string
}

const CHART_ROWS: ChartSeedRow[] = [
  // ─── 1 ATIVO ──────────────────────────────────────────────────────────
  { code: '1', name: 'Ativo', kind: 'ativo', isLeaf: false, parentCode: null },
  { code: '1.1', name: 'Ativo Circulante', kind: 'ativo', isLeaf: false, parentCode: '1' },
  { code: '1.1.01', name: 'Caixa', kind: 'ativo', isLeaf: true, parentCode: '1.1' },
  {
    code: '1.1.02',
    name: 'Bancos Conta Movimento',
    kind: 'ativo',
    isLeaf: true,
    parentCode: '1.1',
  },
  {
    code: '1.1.03',
    name: 'Aplicações Financeiras Curto Prazo',
    kind: 'ativo',
    isLeaf: true,
    parentCode: '1.1',
  },
  {
    code: '1.1.04',
    name: 'Contas a Receber Clientes',
    kind: 'ativo',
    isLeaf: true,
    parentCode: '1.1',
  },
  {
    code: '1.1.05',
    name: 'Cartão de Crédito a Receber',
    kind: 'ativo',
    isLeaf: true,
    parentCode: '1.1',
  },
  {
    code: '1.1.06',
    name: 'Adiantamentos a Fornecedores',
    kind: 'ativo',
    isLeaf: true,
    parentCode: '1.1',
  },
  {
    code: '1.1.07',
    name: 'Estoque — Insumos e Suplementos',
    kind: 'ativo',
    isLeaf: true,
    parentCode: '1.1',
  },
  { code: '1.1.08', name: 'Impostos a Recuperar', kind: 'ativo', isLeaf: true, parentCode: '1.1' },
  { code: '1.2', name: 'Ativo Não Circulante', kind: 'ativo', isLeaf: false, parentCode: '1' },
  {
    code: '1.2.01',
    name: 'Imobilizado — Equipamentos',
    kind: 'ativo',
    isLeaf: true,
    parentCode: '1.2',
  },
  {
    code: '1.2.02',
    name: 'Imobilizado — Móveis e Utensílios',
    kind: 'ativo',
    isLeaf: true,
    parentCode: '1.2',
  },
  {
    code: '1.2.03',
    name: 'Imobilizado — Veículos',
    kind: 'ativo',
    isLeaf: true,
    parentCode: '1.2',
  },
  { code: '1.2.04', name: 'Software / Sistemas', kind: 'ativo', isLeaf: true, parentCode: '1.2' },
  {
    code: '1.2.05',
    name: '(-) Depreciação Acumulada',
    kind: 'ativo',
    isLeaf: true,
    parentCode: '1.2',
  },

  // ─── 2 PASSIVO ────────────────────────────────────────────────────────
  { code: '2', name: 'Passivo', kind: 'passivo', isLeaf: false, parentCode: null },
  { code: '2.1', name: 'Passivo Circulante', kind: 'passivo', isLeaf: false, parentCode: '2' },
  {
    code: '2.1.01',
    name: 'Fornecedores a Pagar',
    kind: 'passivo',
    isLeaf: true,
    parentCode: '2.1',
  },
  {
    code: '2.1.02',
    name: 'Empréstimos Curto Prazo',
    kind: 'passivo',
    isLeaf: true,
    parentCode: '2.1',
  },
  {
    code: '2.1.03',
    name: 'Salários e Encargos a Pagar',
    kind: 'passivo',
    isLeaf: true,
    parentCode: '2.1',
  },
  { code: '2.1.04', name: 'Impostos a Recolher', kind: 'passivo', isLeaf: true, parentCode: '2.1' },
  {
    code: '2.1.05',
    name: 'Cartões de Crédito a Pagar',
    kind: 'passivo',
    isLeaf: true,
    parentCode: '2.1',
  },
  {
    code: '2.1.06',
    name: 'Adiantamentos de Clientes',
    kind: 'passivo',
    isLeaf: true,
    parentCode: '2.1',
  },
  { code: '2.2', name: 'Passivo Não Circulante', kind: 'passivo', isLeaf: false, parentCode: '2' },
  {
    code: '2.2.01',
    name: 'Financiamento Longo Prazo',
    kind: 'passivo',
    isLeaf: true,
    parentCode: '2.2',
  },
  { code: '2.3', name: 'Patrimônio Líquido', kind: 'passivo', isLeaf: false, parentCode: '2' },
  { code: '2.3.01', name: 'Capital Social', kind: 'passivo', isLeaf: true, parentCode: '2.3' },
  {
    code: '2.3.02',
    name: 'Lucros / Prejuízos Acumulados',
    kind: 'passivo',
    isLeaf: true,
    parentCode: '2.3',
  },

  // ─── 3 RECEITA ────────────────────────────────────────────────────────
  { code: '3', name: 'Receita', kind: 'receita', isLeaf: false, parentCode: null },
  { code: '3.1', name: 'Receita Operacional', kind: 'receita', isLeaf: false, parentCode: '3' },
  {
    code: '3.1.01',
    name: 'Mensalidade Academia',
    kind: 'receita',
    isLeaf: true,
    parentCode: '3.1',
  },
  { code: '3.1.02', name: 'Personal Trainer', kind: 'receita', isLeaf: true, parentCode: '3.1' },
  {
    code: '3.1.03',
    name: 'Aulas Avulsas / Coletivas',
    kind: 'receita',
    isLeaf: true,
    parentCode: '3.1',
  },
  { code: '3.1.04', name: 'Avaliações Físicas', kind: 'receita', isLeaf: true, parentCode: '3.1' },
  {
    code: '3.1.05',
    name: 'Atendimento Fisioterapia',
    kind: 'receita',
    isLeaf: true,
    parentCode: '3.1',
  },
  {
    code: '3.1.06',
    name: 'Consultas Nutricionais',
    kind: 'receita',
    isLeaf: true,
    parentCode: '3.1',
  },
  { code: '3.1.07', name: 'Venda Suplementos', kind: 'receita', isLeaf: true, parentCode: '3.1' },
  {
    code: '3.1.08',
    name: 'Venda Vestuário / Acessórios',
    kind: 'receita',
    isLeaf: true,
    parentCode: '3.1',
  },
  {
    code: '3.1.09',
    name: 'Convênios e Planos Empresariais',
    kind: 'receita',
    isLeaf: true,
    parentCode: '3.1',
  },
  { code: '3.2', name: 'Receita Não Operacional', kind: 'receita', isLeaf: false, parentCode: '3' },
  {
    code: '3.2.01',
    name: 'Aluguel de Espaços / Cessão',
    kind: 'receita',
    isLeaf: true,
    parentCode: '3.2',
  },
  {
    code: '3.2.02',
    name: 'Juros e Rendimentos Aplicações',
    kind: 'receita',
    isLeaf: true,
    parentCode: '3.2',
  },
  {
    code: '3.2.03',
    name: 'Reembolsos e Devoluções Recebidas',
    kind: 'receita',
    isLeaf: true,
    parentCode: '3.2',
  },

  // ─── 4 DESPESA ────────────────────────────────────────────────────────
  { code: '4', name: 'Despesa', kind: 'despesa', isLeaf: false, parentCode: null },
  { code: '4.1', name: 'Despesas com Pessoal', kind: 'despesa', isLeaf: false, parentCode: '4' },
  { code: '4.1.01', name: 'Salários CLT', kind: 'despesa', isLeaf: true, parentCode: '4.1' },
  { code: '4.1.02', name: 'INSS Patronal', kind: 'despesa', isLeaf: true, parentCode: '4.1' },
  { code: '4.1.03', name: 'FGTS', kind: 'despesa', isLeaf: true, parentCode: '4.1' },
  {
    code: '4.1.04',
    name: '13º / Férias / Encargos',
    kind: 'despesa',
    isLeaf: true,
    parentCode: '4.1',
  },
  {
    code: '4.1.05',
    name: 'Pró-labore de Sócios',
    kind: 'despesa',
    isLeaf: true,
    parentCode: '4.1',
  },
  {
    code: '4.1.06',
    name: 'Comissões Profissionais',
    kind: 'despesa',
    isLeaf: true,
    parentCode: '4.1',
  },
  {
    code: '4.1.07',
    name: 'Benefícios (VR / VA / Plano Saúde)',
    kind: 'despesa',
    isLeaf: true,
    parentCode: '4.1',
  },
  {
    code: '4.2',
    name: 'Despesas Administrativas',
    kind: 'despesa',
    isLeaf: false,
    parentCode: '4',
  },
  { code: '4.2.01', name: 'Aluguel de Imóvel', kind: 'despesa', isLeaf: true, parentCode: '4.2' },
  { code: '4.2.02', name: 'Condomínio / IPTU', kind: 'despesa', isLeaf: true, parentCode: '4.2' },
  { code: '4.2.03', name: 'Energia Elétrica', kind: 'despesa', isLeaf: true, parentCode: '4.2' },
  { code: '4.2.04', name: 'Água / Esgoto', kind: 'despesa', isLeaf: true, parentCode: '4.2' },
  {
    code: '4.2.05',
    name: 'Internet / Telefonia',
    kind: 'despesa',
    isLeaf: true,
    parentCode: '4.2',
  },
  {
    code: '4.2.06',
    name: 'Material de Escritório / Limpeza',
    kind: 'despesa',
    isLeaf: true,
    parentCode: '4.2',
  },
  { code: '4.2.07', name: 'Software / SaaS', kind: 'despesa', isLeaf: true, parentCode: '4.2' },
  { code: '4.2.08', name: 'Serviços Contábeis', kind: 'despesa', isLeaf: true, parentCode: '4.2' },
  { code: '4.2.09', name: 'Serviços Jurídicos', kind: 'despesa', isLeaf: true, parentCode: '4.2' },
  { code: '4.3', name: 'Despesas Comerciais', kind: 'despesa', isLeaf: false, parentCode: '4' },
  {
    code: '4.3.01',
    name: 'Marketing Digital (Ads / Social)',
    kind: 'despesa',
    isLeaf: true,
    parentCode: '4.3',
  },
  {
    code: '4.3.02',
    name: 'Material Gráfico / Brindes',
    kind: 'despesa',
    isLeaf: true,
    parentCode: '4.3',
  },
  {
    code: '4.3.03',
    name: 'Eventos / Patrocínios',
    kind: 'despesa',
    isLeaf: true,
    parentCode: '4.3',
  },
  {
    code: '4.3.04',
    name: 'Comissão Indicação / Referral',
    kind: 'despesa',
    isLeaf: true,
    parentCode: '4.3',
  },
  { code: '4.4', name: 'Despesas Financeiras', kind: 'despesa', isLeaf: false, parentCode: '4' },
  {
    code: '4.4.01',
    name: 'Juros e Multas Pagos',
    kind: 'despesa',
    isLeaf: true,
    parentCode: '4.4',
  },
  { code: '4.4.02', name: 'Tarifas Bancárias', kind: 'despesa', isLeaf: true, parentCode: '4.4' },
  { code: '4.4.03', name: 'IOF / Taxas Cartão', kind: 'despesa', isLeaf: true, parentCode: '4.4' },
  { code: '4.5', name: 'Tributos sobre Receita', kind: 'despesa', isLeaf: false, parentCode: '4' },
  { code: '4.5.01', name: 'Simples Nacional', kind: 'despesa', isLeaf: true, parentCode: '4.5' },
  { code: '4.5.02', name: 'ISS', kind: 'despesa', isLeaf: true, parentCode: '4.5' },
  { code: '4.5.03', name: 'PIS', kind: 'despesa', isLeaf: true, parentCode: '4.5' },
  { code: '4.5.04', name: 'COFINS', kind: 'despesa', isLeaf: true, parentCode: '4.5' },
  { code: '4.5.05', name: 'IRPJ', kind: 'despesa', isLeaf: true, parentCode: '4.5' },
  { code: '4.5.06', name: 'CSLL', kind: 'despesa', isLeaf: true, parentCode: '4.5' },

  // ─── 5 CUSTO ──────────────────────────────────────────────────────────
  { code: '5', name: 'Custo', kind: 'custo', isLeaf: false, parentCode: null },
  { code: '5.1', name: 'Custos Diretos', kind: 'custo', isLeaf: false, parentCode: '5' },
  {
    code: '5.1.01',
    name: 'Materiais Descartáveis (luvas / faixas / fitas)',
    kind: 'custo',
    isLeaf: true,
    parentCode: '5.1',
  },
  {
    code: '5.1.02',
    name: 'Suplementos para Revenda (CMV)',
    kind: 'custo',
    isLeaf: true,
    parentCode: '5.1',
  },
  {
    code: '5.1.03',
    name: 'Manutenção de Equipamentos',
    kind: 'custo',
    isLeaf: true,
    parentCode: '5.1',
  },
  { code: '5.1.04', name: 'Calibração / Aferição', kind: 'custo', isLeaf: true, parentCode: '5.1' },
  {
    code: '5.1.05',
    name: 'Vestuário Equipe / Uniformes',
    kind: 'custo',
    isLeaf: true,
    parentCode: '5.1',
  },
]

const APPROVAL_RULES_CANONICAS = [
  {
    name: 'Auto-aprovação até R$ 500',
    scope: 'ap' as const,
    minAmountCents: 0,
    maxAmountCents: 50000,
    requiredApprovers: { mode: 'series' as const, approvers: [] },
  },
  {
    name: 'Gerente financeiro até R$ 5.000',
    scope: 'ap' as const,
    minAmountCents: 50001,
    maxAmountCents: 500000,
    requiredApprovers: {
      mode: 'series' as const,
      approvers: [{ role: 'gerente_financeiro' }],
    },
  },
  {
    name: 'Gerente + Diretor acima de R$ 5.000',
    scope: 'ap' as const,
    minAmountCents: 500001,
    maxAmountCents: null as number | null,
    requiredApprovers: {
      mode: 'series' as const,
      approvers: [{ role: 'gerente_financeiro' }, { role: 'diretor' }],
    },
  },
]

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL })
  const db = drizzle(pool)
  console.log(
    `→ seeding plano-contas + approval_rules ${DATABASE_URL.replace(/:[^:@]+@/, ':***@')}`,
  )

  const tenantsRows = await db.select({ id: tenants.id, name: tenants.name }).from(tenants)
  console.log(`  • ${tenantsRows.length} tenants encontrados`)

  let totalAccounts = 0
  let totalRules = 0

  for (const tenant of tenantsRows) {
    // ─── Pass 1: insere todas as contas (sem parent_id por enquanto)
    for (const row of CHART_ROWS) {
      await db
        .insert(chartOfAccounts)
        .values({
          tenantId: tenant.id,
          code: row.code,
          name: row.name,
          kind: row.kind,
          isLeaf: row.isLeaf,
          description: row.description ?? null,
        })
        .onConflictDoNothing({ target: [chartOfAccounts.tenantId, chartOfAccounts.code] })
    }

    // ─── Pass 2: resolve parent_id via code lookup
    const existing = await db
      .select({ id: chartOfAccounts.id, code: chartOfAccounts.code })
      .from(chartOfAccounts)
      .where(eq(chartOfAccounts.tenantId, tenant.id))
    const idByCode = new Map(existing.map((r) => [r.code, r.id]))

    for (const row of CHART_ROWS) {
      if (!row.parentCode) continue
      const id = idByCode.get(row.code)
      const parentId = idByCode.get(row.parentCode)
      if (!id || !parentId) continue
      await db
        .update(chartOfAccounts)
        .set({ parentId, updatedAt: new Date() })
        .where(eq(chartOfAccounts.id, id))
    }

    totalAccounts += CHART_ROWS.length

    // ─── Approval rules canônicas
    for (const rule of APPROVAL_RULES_CANONICAS) {
      const ruleExists = await db
        .select({ id: approvalRules.id })
        .from(approvalRules)
        .where(eq(approvalRules.tenantId, tenant.id))
        .limit(20)

      const alreadyHas = ruleExists.some((r) => r.id)
      if (alreadyHas && ruleExists.length >= APPROVAL_RULES_CANONICAS.length) {
        continue
      }
      await db.insert(approvalRules).values({
        tenantId: tenant.id,
        name: rule.name,
        scope: rule.scope,
        minAmountCents: rule.minAmountCents,
        maxAmountCents: rule.maxAmountCents,
        requiredApprovers: rule.requiredApprovers,
      })
      totalRules += 1
    }

    console.log(`  • ${tenant.name}: plano de contas ${CHART_ROWS.length} contas + rules canônicas`)
  }

  await pool.end()
  console.log(
    `✓ seeded ${totalAccounts} chart_of_accounts + ${totalRules} approval_rules em ${tenantsRows.length} tenants`,
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
