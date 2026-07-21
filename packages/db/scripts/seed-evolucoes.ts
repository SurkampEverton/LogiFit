/**
 * Seed Sprint 21 Faixa D — Evoluções fisio amostra.
 *
 * Por tenant matriz:
 *   - Reusa members existentes (cria 1 paciente fisio sintético se não houver)
 *   - 3 evoluções sequenciais (15d/8d/hoje) com SOAP realista de dor lombar
 *   - 1 anexo de metadata (foto postural fake) na evolução mais antiga
 *
 * Idempotente via email pattern `seed-evol-{tenant}-paciente@example.com`.
 *
 * Uso: `pnpm --filter @repo/db db:seed:evolucoes`
 */
import { and, asc, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import {
  companies,
  evolucaoAttachments,
  evolucoesSessao,
  members,
  persons,
  tenants,
  users,
} from '../src/schema/index.js'

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/logifit'

interface EvolucaoSeed {
  daysAgo: number
  soap: {
    subjetivo?: string
    objetivo?: string
    avaliacao?: string
    plano?: string
  }
  freeText?: string
}

const EVOL_SEEDS: EvolucaoSeed[] = [
  {
    daysAgo: 15,
    soap: {
      subjetivo:
        'Paciente refere dor lombar irradiando MMII direito (EVA 7/10), iniciada após esforço repetitivo no trabalho.',
      objetivo:
        'ADM lombar reduzida (60%). Lasègue positivo à direita. Força 4/5 paravertebrais. Sem sinais neurológicos.',
      avaliacao: 'Lombalgia mecânica com componente radicular leve. Sem indicação cirúrgica.',
      plano:
        '10 sessões 2×/semana — eletroterapia + cinesioterapia ativa + HEP isométricos paravertebrais.',
    },
    freeText: 'Paciente trabalha em escritório, sentado 8h/dia. Orientado sobre ergonomia.',
  },
  {
    daysAgo: 8,
    soap: {
      subjetivo:
        'Dor diminuiu para EVA 4/10, melhor no período da manhã. Conseguiu dormir sem analgésico anteontem pela 1ª vez.',
      objetivo: 'ADM lombar 75%. Lasègue negativo. Força 5/5. Sem dor à palpação L4-L5.',
      avaliacao: 'Evolução positiva. Manter conduta com progressão de cargas.',
      plano: 'Iniciar fortalecimento global core. HEP atualizado.',
    },
  },
  {
    daysAgo: 1,
    soap: {
      subjetivo:
        'Dor residual EVA 2/10 ao final do dia. Retornou às atividades laborais sem restrição.',
      objetivo: 'ADM completa. Força 5/5. Postura adequada na simulação de tarefa.',
      avaliacao: 'Alta com orientações. Recomenda-se manutenção semanal de Pilates / HEP.',
      plano: 'Alta. Retorno PRN em 30 dias se sintomas recorrentes.',
    },
    freeText: 'Paciente extremamente colaborativo. Adesão 100% ao HEP.',
  },
]

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL })
  const db = drizzle(pool)
  console.log(`→ seeding evolucoes ${DATABASE_URL.replace(/:[^:@]+@/, ':***@')}`)

  const tenantsRows = await db.select({ id: tenants.id, name: tenants.name }).from(tenants)
  console.log(`  • ${tenantsRows.length} tenants encontrados`)

  let totalMembers = 0
  let totalEvolucoes = 0
  let totalAttachments = 0

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

    // Cria/reusa paciente sintético específico do sprint 21
    const email = `seed-evol-${tenant.id.slice(0, 8)}-paciente@example.com`
    let memberId: string
    const existingP = await db
      .select({ id: persons.id })
      .from(persons)
      .where(and(eq(persons.tenantId, tenant.id), eq(persons.email, email)))
      .limit(1)
    let personId: string
    if (existingP[0]) {
      personId = existingP[0].id
    } else {
      const [p] = await db
        .insert(persons)
        .values({
          tenantId: tenant.id,
          kind: 'pf',
          name: `Paciente Fisio Seed ${tenant.name.slice(0, 12)}`,
          email,
        })
        .returning({ id: persons.id })
      personId = p!.id
    }
    const existingM = await db
      .select({ id: members.id })
      .from(members)
      .where(and(eq(members.tenantId, tenant.id), eq(members.personId, personId)))
      .limit(1)
    if (existingM[0]) {
      memberId = existingM[0].id
    } else {
      const [m] = await db
        .insert(members)
        .values({ tenantId: tenant.id, personId, companyId: matriz.id })
        .returning({ id: members.id })
      memberId = m!.id
      totalMembers += 1
    }

    // Verifica se já tem evoluções pra esse member; se sim, pula
    const existingEvol = await db
      .select({ id: evolucoesSessao.id })
      .from(evolucoesSessao)
      .where(and(eq(evolucoesSessao.tenantId, tenant.id), eq(evolucoesSessao.memberId, memberId)))
      .limit(1)
    if (existingEvol[0]) continue

    let firstEvolucaoId: string | undefined
    for (let i = 0; i < EVOL_SEEDS.length; i++) {
      const seed = EVOL_SEEDS[i]!
      const createdAt = new Date(Date.now() - seed.daysAgo * 24 * 60 * 60 * 1000)
      const [row] = await db
        .insert(evolucoesSessao)
        .values({
          tenantId: tenant.id,
          companyId: matriz.id,
          memberId,
          professionalUserId: profUser.id,
          soap: seed.soap as Record<string, unknown>,
          freeText: seed.freeText ?? null,
          status: 'draft',
          createdAt,
          updatedAt: createdAt,
        })
        .returning({ id: evolucoesSessao.id })
      if (row) {
        totalEvolucoes += 1
        if (i === 0) firstEvolucaoId = row.id
      }
    }

    if (firstEvolucaoId) {
      // Anexo de metadata fake na primeira evolução (foto postural)
      const contentHash = 'a'.repeat(64) // placeholder hex sha256
      const storagePath = `tenants/${tenant.id}/evolucoes/${firstEvolucaoId}/aaaaaaaaaaaa-postura-inicial.jpg`
      const [a] = await db
        .insert(evolucaoAttachments)
        .values({
          tenantId: tenant.id,
          evolucaoId: firstEvolucaoId,
          kind: 'foto_postural',
          storagePath,
          storageBucket: 'fisio-evolucoes',
          filename: 'postura-inicial.jpg',
          sizeBytes: 1_200_000,
          mimeType: 'image/jpeg',
          contentHash,
          scanStatus: 'clean',
          caption: 'Foto postural inicial frontal',
          uploadedByUserId: profUser.id,
        })
        .returning({ id: evolucaoAttachments.id })
      if (a) totalAttachments += 1
    }
  }

  console.log(
    `✓ seed done: ${totalMembers} members + ${totalEvolucoes} evoluções + ${totalAttachments} attachments`,
  )
  await pool.end()
}

main().catch((err) => {
  console.error('seed failed:', err)
  process.exit(1)
})
