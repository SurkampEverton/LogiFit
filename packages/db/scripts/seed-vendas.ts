/**
 * Seed Sprint 10 — funil de vendas.
 *
 * Idempotente: popula 6 estágios default + 10 leads por tenant canônico.
 * Roda como `postgres` superuser (bypassa RLS — admin-only).
 *
 * Uso: `pnpm --filter @repo/db db:seed:vendas`
 *
 * Pré-requisito: `pnpm db:seed` rodou primeiro (precisa de companies populadas).
 */
import { eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { companies, leadStages, leads, tenants } from '../src/schema/index.js'

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/logifit'

const DEFAULT_STAGES = [
  { slug: 'novo', name: 'Novo', orderIdx: 1, kind: 'open' as const, color: '#3b82f6' },
  {
    slug: 'contato_feito',
    name: 'Contato feito',
    orderIdx: 2,
    kind: 'open' as const,
    color: '#8b5cf6',
  },
  {
    slug: 'aula_experimental',
    name: 'Aula experimental',
    orderIdx: 3,
    kind: 'open' as const,
    color: '#06b6d4',
  },
  {
    slug: 'proposta',
    name: 'Proposta',
    orderIdx: 4,
    kind: 'open' as const,
    color: '#f59e0b',
  },
  {
    slug: 'matriculado',
    name: 'Matriculado',
    orderIdx: 5,
    kind: 'won' as const,
    color: '#22c55e',
  },
  {
    slug: 'perdido',
    name: 'Perdido',
    orderIdx: 6,
    kind: 'lost' as const,
    color: '#ef4444',
  },
]

const SAMPLE_LEADS = [
  { quickName: 'Ana Souza', quickPhone: '11987654321', source: 'website', interest: 'Musculação' },
  { quickName: 'Bruno Lima', quickPhone: '11987654322', source: 'instagram', interest: 'Personal' },
  { quickName: 'Carla Mendes', quickPhone: '11987654323', source: 'referral', interest: 'Pilates' },
  {
    quickName: 'Diego Rocha',
    quickPhone: '11987654324',
    source: 'walk_in',
    interest: 'Musculação',
  },
  {
    quickName: 'Eduarda Silva',
    quickPhone: '11987654325',
    source: 'panfleto',
    interest: 'Cross training',
  },
  {
    quickName: 'Fábio Costa',
    quickPhone: '11987654326',
    source: 'gympass',
    interest: 'Personal',
  },
  {
    quickName: 'Gabriela Alves',
    quickPhone: '11987654327',
    source: 'instagram',
    interest: 'Pilates',
  },
  {
    quickName: 'Henrique Dias',
    quickPhone: '11987654328',
    source: 'website',
    interest: 'Musculação',
  },
  {
    quickName: 'Isabela Martins',
    quickPhone: '11987654329',
    source: 'referral',
    interest: 'Avaliação física',
  },
  {
    quickName: 'João Pereira',
    quickPhone: '11987654330',
    source: 'outdoor',
    interest: 'Musculação',
  },
] as const

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL })
  const db = drizzle(pool)
  console.log(`→ seeding vendas ${DATABASE_URL.replace(/:[^:@]+@/, ':***@')}`)

  // 1. Lista tenants existentes
  const tenantsRows = await db.select({ id: tenants.id, name: tenants.name }).from(tenants)
  console.log(`  • ${tenantsRows.length} tenants encontrados`)

  for (const tenant of tenantsRows) {
    // 2. Insere stages default (idempotente via ON CONFLICT slug)
    for (const stage of DEFAULT_STAGES) {
      await db
        .insert(leadStages)
        .values({
          tenantId: tenant.id,
          slug: stage.slug,
          name: stage.name,
          orderIdx: stage.orderIdx,
          kind: stage.kind,
          color: stage.color,
        })
        .onConflictDoNothing({
          target: [leadStages.tenantId, leadStages.slug],
        })
    }

    // 3. Pega stages criadas pra distribuir leads
    const stages = await db
      .select({ id: leadStages.id, slug: leadStages.slug })
      .from(leadStages)
      .where(eq(leadStages.tenantId, tenant.id))

    // 4. Pega primeira company do tenant (matriz)
    const [matrizCompany] = await db
      .select({ id: companies.id })
      .from(companies)
      .where(eq(companies.tenantId, tenant.id))
      .limit(1)
    if (!matrizCompany) {
      console.log(`  • ${tenant.name}: sem company, pulando seed de leads`)
      continue
    }

    // 5. Conta leads existentes — só insere se < 10
    const existing = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(leads)
      .where(eq(leads.tenantId, tenant.id))
    if ((existing[0]?.n ?? 0) >= 10) {
      console.log(`  • ${tenant.name}: ${existing[0]?.n} leads já existem, pulando`)
      continue
    }

    // 6. Distribui 10 leads entre stages 'open' (não won/lost)
    const openStages = stages.filter(
      (s) => s.slug !== 'matriculado' && s.slug !== 'perdido',
    )
    for (let i = 0; i < SAMPLE_LEADS.length; i++) {
      const sample = SAMPLE_LEADS[i]!
      const stage = openStages[i % openStages.length]!
      await db.insert(leads).values({
        tenantId: tenant.id,
        companyId: matrizCompany.id,
        stageId: stage.id,
        quickName: sample.quickName,
        quickPhone: sample.quickPhone,
        source: sample.source as
          | 'website'
          | 'instagram'
          | 'referral'
          | 'walk_in'
          | 'panfleto'
          | 'gympass'
          | 'totalpass'
          | 'outdoor'
          | 'other',
        interest: sample.interest,
      })
    }
    console.log(`  • ${tenant.name}: 6 stages + 10 leads OK`)
  }

  console.log('✓ seed vendas done')
  await pool.end()
}

main().catch((err) => {
  console.error('seed-vendas error:', err)
  process.exit(1)
})
