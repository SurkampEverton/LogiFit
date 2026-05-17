/**
 * Seed Sprint 19 Faixa D — Retenção/Churn.
 *
 * Por tenant matriz:
 *   - Cria/reusa 10 members sintéticos com perfis variados (baixo/médio/alto risco)
 *   - Roda `heuristicPredict` localmente sobre features fictícias
 *   - Persiste snapshot + prediction
 *   - 2 intervenções amostra (1 aberta + 1 encerrada)
 *
 * Mostra fluxo end-to-end sem depender de check-ins/invoices reais.
 * Quando há seed-vendas/financeiro/agenda integrado, basta rodar
 * `scorePredict` por member que features reais entram.
 *
 * Uso: `pnpm --filter @repo/db db:seed:retencao`
 */
import { createHash } from 'node:crypto'
import { and, asc, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import {
  churnFeaturesSnapshot,
  churnInterventions,
  churnPredictions,
  companies,
  members,
  persons,
  tenants,
  users,
} from '../src/schema/index.js'
import {
  bandFromProb,
  heuristicPredict,
  type ChurnFeatures,
} from '../src/retencao/predict.js'

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/logifit'

interface MemberProfile {
  name: string
  features: ChurnFeatures
}

function profile(name: string, overrides: Partial<ChurnFeatures>): MemberProfile {
  const base: ChurnFeatures = {
    frequencyLast30d: 8,
    frequencyPrev30d: 10,
    frequencyChangePct: -20,
    daysSinceLastCheckin: 3,
    overdueInvoicesCount: 0,
    overdueTotalCents: 0,
    monthsAsMember: 12,
    avgTicketCents: 18900,
    achievementsEarned90d: 2,
    goalsActiveCount: 1,
    lastPlanChangeAt: null,
    planChangedDowngrade: false,
  }
  return { name, features: { ...base, ...overrides } }
}

const PROFILES: MemberProfile[] = [
  profile('Member Estável', {}),
  profile('Member Engajado', {
    frequencyLast30d: 18,
    frequencyPrev30d: 16,
    achievementsEarned90d: 6,
    goalsActiveCount: 3,
  }),
  profile('Member Caindo Frequência', {
    frequencyLast30d: 4,
    frequencyPrev30d: 12,
    frequencyChangePct: -66,
    daysSinceLastCheckin: 8,
  }),
  profile('Member Em Atraso', {
    frequencyLast30d: 6,
    daysSinceLastCheckin: 12,
    overdueInvoicesCount: 1,
    overdueTotalCents: 18900,
  }),
  profile('Member Risco Alto', {
    frequencyLast30d: 1,
    frequencyPrev30d: 10,
    frequencyChangePct: -90,
    daysSinceLastCheckin: 35,
    overdueInvoicesCount: 2,
    overdueTotalCents: 37800,
    achievementsEarned90d: 0,
    goalsActiveCount: 0,
    planChangedDowngrade: true,
  }),
  profile('Member Sumiu', {
    frequencyLast30d: 0,
    frequencyPrev30d: 8,
    frequencyChangePct: -100,
    daysSinceLastCheckin: 42,
  }),
  profile('Member Novo Sem Visita', {
    frequencyLast30d: 0,
    frequencyPrev30d: 0,
    daysSinceLastCheckin: -1,
    monthsAsMember: 3,
  }),
  profile('Member Veterano Leal', {
    monthsAsMember: 36,
    frequencyLast30d: 16,
    frequencyPrev30d: 14,
    achievementsEarned90d: 8,
  }),
  profile('Member Downgrade Recente', {
    monthsAsMember: 24,
    planChangedDowngrade: true,
    lastPlanChangeAt: '2026-04-01',
    frequencyLast30d: 6,
    frequencyPrev30d: 12,
    frequencyChangePct: -50,
  }),
  profile('Member Estagnado', {
    frequencyLast30d: 2,
    frequencyPrev30d: 3,
    daysSinceLastCheckin: 18,
    overdueInvoicesCount: 1,
    overdueTotalCents: 18900,
  }),
]

function hashFeaturesCanonical(features: ChurnFeatures): string {
  const ordered: Record<string, unknown> = {}
  for (const key of Object.keys(features).sort()) {
    ordered[key] = features[key as keyof ChurnFeatures]
  }
  return createHash('sha256').update(JSON.stringify(ordered)).digest('hex')
}

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL })
  const db = drizzle(pool)
  console.log(`→ seeding retencao ${DATABASE_URL.replace(/:[^:@]+@/, ':***@')}`)

  const tenantsRows = await db.select({ id: tenants.id, name: tenants.name }).from(tenants)
  console.log(`  • ${tenantsRows.length} tenants encontrados`)

  let totalMembers = 0
  let totalSnapshots = 0
  let totalPreds = 0
  let totalIntv = 0

  for (const tenant of tenantsRows) {
    const [matriz] = await db
      .select({ id: companies.id })
      .from(companies)
      .where(and(eq(companies.tenantId, tenant.id), eq(companies.type, 'matriz')))
      .orderBy(asc(companies.createdAt))
      .limit(1)
    if (!matriz) continue

    // Pega um user existente do tenant pra atribuir intervenção
    const [seedUser] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.tenantId, tenant.id))
      .limit(1)

    for (const prof of PROFILES) {
      const email = `seed-retencao-${tenant.id.slice(0, 8)}-${prof.name.replace(/\s/g, '-').toLowerCase()}@example.com`

      // person idempotente
      let personId: string
      const existingP = await db
        .select({ id: persons.id })
        .from(persons)
        .where(and(eq(persons.tenantId, tenant.id), eq(persons.email, email)))
        .limit(1)
      if (existingP[0]) {
        personId = existingP[0].id
      } else {
        const [pRow] = await db
          .insert(persons)
          .values({ tenantId: tenant.id, kind: 'pf', name: prof.name, email })
          .returning({ id: persons.id })
        personId = pRow!.id
      }

      // member idempotente
      let memberId: string
      const existingM = await db
        .select({ id: members.id })
        .from(members)
        .where(and(eq(members.tenantId, tenant.id), eq(members.personId, personId)))
        .limit(1)
      if (existingM[0]) {
        memberId = existingM[0].id
      } else {
        const [mRow] = await db
          .insert(members)
          .values({ tenantId: tenant.id, personId, companyId: matriz.id })
          .returning({ id: members.id })
        memberId = mRow!.id
        totalMembers += 1
      }

      // snapshot idempotente por hash
      const hash = hashFeaturesCanonical(prof.features)
      const existingSnap = await db
        .select({ id: churnFeaturesSnapshot.id })
        .from(churnFeaturesSnapshot)
        .where(
          and(
            eq(churnFeaturesSnapshot.tenantId, tenant.id),
            eq(churnFeaturesSnapshot.memberId, memberId),
            eq(churnFeaturesSnapshot.snapshotHash, hash),
          ),
        )
        .limit(1)

      let snapshotId: string
      if (existingSnap[0]) {
        snapshotId = existingSnap[0].id
      } else {
        const [snap] = await db
          .insert(churnFeaturesSnapshot)
          .values({
            tenantId: tenant.id,
            memberId,
            features: prof.features as unknown as Record<string, unknown>,
            snapshotHash: hash,
          })
          .returning({ id: churnFeaturesSnapshot.id })
        snapshotId = snap!.id
        totalSnapshots += 1

        // Roda predição heurística + persiste
        const prediction = heuristicPredict(prof.features)
        const validUntil = new Date()
        validUntil.setHours(validUntil.getHours() + 24)
        const [pred] = await db
          .insert(churnPredictions)
          .values({
            tenantId: tenant.id,
            memberId,
            snapshotId,
            modelVersion: 'heuristic-v1@2026-05',
            prob30d: prediction.prob30d.toFixed(3),
            prob60d: prediction.prob60d.toFixed(3),
            prob90d: prediction.prob90d.toFixed(3),
            riskBand: bandFromProb(prediction.prob30d),
            topFactors: prediction.topFactors,
            source: 'heuristic',
            latencyMs: 2,
            validUntil,
          })
          .returning({ id: churnPredictions.id })
        if (pred) totalPreds += 1

        // Intervenções amostra apenas pros 2 perfis de alto risco
        if (
          pred &&
          seedUser &&
          (prof.name === 'Member Risco Alto' || prof.name === 'Member Sumiu')
        ) {
          // Aberta
          await db.insert(churnInterventions).values({
            tenantId: tenant.id,
            memberId,
            predictionId: pred.id,
            assignedToUserId: seedUser.id,
            action: prof.name === 'Member Sumiu' ? 'phone_call' : 'whatsapp_message',
            notes:
              prof.name === 'Member Sumiu'
                ? 'Sumiu há 6 semanas — ligar pra checar se quer cancelar ou tem problema'
                : 'Frequência caiu 90% + 2 faturas em atraso — oferecer desconto temporário',
          })
          totalIntv += 1
        }
      }
    }
  }

  console.log(
    `✓ seed done: ${totalMembers} members novos + ${totalSnapshots} snapshots + ${totalPreds} predições + ${totalIntv} intervenções`,
  )
  await pool.end()
}

main().catch((err) => {
  console.error('seed failed:', err)
  process.exit(1)
})
