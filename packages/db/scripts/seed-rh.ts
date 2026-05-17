/**
 * Seed Sprint 23 Faixa D — RH Comissões minimal.
 *
 * Por tenant matriz:
 *   - Cria/reusa 3 profissionais sintéticos (fisio + personal + nutri)
 *   - 3 contratos com kinds diferentes (percent_recebido / fixo_por_atendimento / tabela_por_servico)
 *   - 1 commission_rule override em cada
 *   - 5 commission_entries amostra por profissional (pending)
 *
 * Idempotente via email pattern `seed-rh-{tenant}-{role}@example.com`.
 *
 * Uso: `pnpm --filter @repo/db db:seed:rh`
 */
import { and, asc, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import {
  commissionEntries,
  commissionRules,
  companies,
  persons,
  professionalContracts,
  tenants,
} from '../src/schema/index.js'

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/logifit'

interface RoleSeed {
  role: 'fisio' | 'personal' | 'nutri'
  serviceType: string
  name: string
  kind: 'percent_faturamento' | 'percent_recebido' | 'fixo_por_atendimento' | 'tabela_por_servico'
  base: 'faturado' | 'recebido_particular' | 'recebido_convenio' | 'misto'
  defaultPercent: number | null
  defaultAmountCents: number | null
  /** Rule override pra um tussCode específico */
  ruleOverride: {
    tussCode: string
    percent?: number
    amountCents?: number
  }
}

const ROLES: RoleSeed[] = [
  {
    role: 'fisio',
    serviceType: 'fisioterapia',
    name: 'Dra. Maria Fisio',
    kind: 'percent_recebido',
    base: 'misto',
    defaultPercent: 60,
    defaultAmountCents: null,
    ruleOverride: { tussCode: '20104073', percent: 70 }, // sessão fisio = 70%
  },
  {
    role: 'personal',
    serviceType: 'personal_training',
    name: 'Carlos Personal',
    kind: 'fixo_por_atendimento',
    base: 'recebido_particular',
    defaultPercent: null,
    defaultAmountCents: 6000, // R$ 60 por aula
    ruleOverride: { tussCode: '50000128', amountCents: 8000 }, // avaliação funcional = R$ 80
  },
  {
    role: 'nutri',
    serviceType: 'nutricao',
    name: 'Dra. Patrícia Nutri',
    kind: 'tabela_por_servico',
    base: 'misto',
    defaultPercent: null,
    defaultAmountCents: null,
    ruleOverride: { tussCode: '50000470', percent: 55 }, // consulta nutri = 55%
  },
]

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL })
  const db = drizzle(pool)
  console.log(`→ seeding rh ${DATABASE_URL.replace(/:[^:@]+@/, ':***@')}`)

  const tenantsRows = await db.select({ id: tenants.id, name: tenants.name }).from(tenants)
  console.log(`  • ${tenantsRows.length} tenants encontrados`)

  let totalPersons = 0
  let totalContracts = 0
  let totalRules = 0
  let totalEntries = 0

  for (const tenant of tenantsRows) {
    const [matriz] = await db
      .select({ id: companies.id })
      .from(companies)
      .where(and(eq(companies.tenantId, tenant.id), eq(companies.type, 'matriz')))
      .orderBy(asc(companies.createdAt))
      .limit(1)
    if (!matriz) continue

    for (const role of ROLES) {
      const email = `seed-rh-${tenant.id.slice(0, 8)}-${role.role}@example.com`

      // 1. Person
      let personId: string
      const existingP = await db
        .select({ id: persons.id })
        .from(persons)
        .where(and(eq(persons.tenantId, tenant.id), eq(persons.email, email)))
        .limit(1)
      if (existingP[0]) {
        personId = existingP[0].id
      } else {
        const [p] = await db
          .insert(persons)
          .values({
            tenantId: tenant.id,
            kind: 'pf',
            name: role.name,
            email,
          })
          .returning({ id: persons.id })
        personId = p!.id
        totalPersons += 1
      }

      // 2. Contract idempotente
      const existingC = await db
        .select({ id: professionalContracts.id })
        .from(professionalContracts)
        .where(
          and(
            eq(professionalContracts.tenantId, tenant.id),
            eq(professionalContracts.personId, personId),
            eq(professionalContracts.serviceType, role.serviceType),
          ),
        )
        .limit(1)

      let contractId: string
      if (existingC[0]) {
        contractId = existingC[0].id
      } else {
        const [c] = await db
          .insert(professionalContracts)
          .values({
            tenantId: tenant.id,
            companyId: matriz.id,
            personId,
            serviceType: role.serviceType,
            kind: role.kind,
            base: role.base,
            defaultPercent: role.defaultPercent != null ? role.defaultPercent.toFixed(2) : null,
            defaultAmountCents: role.defaultAmountCents,
            version: 1,
            effectiveFrom: '2026-01-01',
            active: true,
          })
          .returning({ id: professionalContracts.id })
        contractId = c!.id
        totalContracts += 1

        // 3. Rule
        try {
          await db.insert(commissionRules).values({
            contractId,
            tussCode: role.ruleOverride.tussCode,
            percent:
              role.ruleOverride.percent != null
                ? role.ruleOverride.percent.toFixed(2)
                : null,
            amountCents: role.ruleOverride.amountCents ?? null,
            priority: 10,
            active: true,
          })
          totalRules += 1
        } catch (err) {
          const e = err as { code?: string; cause?: { code?: string } }
          const code = e.code ?? e.cause?.code ?? ''
          if (code !== '23505') throw err
        }

        // 4. 5 entries amostra (todas pending)
        for (let i = 0; i < 5; i++) {
          const daysAgo = i * 3
          const earnedAt = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000)
          const refAmount = 10000 + i * 2500 // R$ 100, 125, 150, 175, 200
          let commission = 0
          let pct: number | null = null
          if (role.kind === 'percent_recebido') {
            pct = role.defaultPercent ?? 50
            commission = Math.round((refAmount * pct) / 100)
          } else if (role.kind === 'fixo_por_atendimento') {
            commission = role.defaultAmountCents ?? 5000
          } else if (role.kind === 'tabela_por_servico') {
            pct = role.ruleOverride.percent ?? 50
            commission = Math.round((refAmount * pct) / 100)
          }

          try {
            await db.insert(commissionEntries).values({
              tenantId: tenant.id,
              contractId,
              personId,
              companyId: matriz.id,
              sourceEventRef: `seed-rh-${tenant.id.slice(0, 8)}-${role.role}-${i}`,
              referenceAmountCents: refAmount,
              commissionCents: commission,
              percentApplied: pct != null ? pct.toFixed(2) : null,
              serviceType: role.serviceType,
              tussCode: role.ruleOverride.tussCode,
              netAmountCents: commission, // sem retenção MVP
              status: 'pending',
              earnedAt,
            })
            totalEntries += 1
          } catch (err) {
            const e = err as { code?: string; cause?: { code?: string } }
            const code = e.code ?? e.cause?.code ?? ''
            if (code !== '23505') throw err
          }
        }
      }
    }
  }

  console.log(
    `✓ seed done: ${totalPersons} persons + ${totalContracts} contratos + ${totalRules} rules + ${totalEntries} entries`,
  )
  await pool.end()
}

main().catch((err) => {
  console.error('seed failed:', err)
  process.exit(1)
})
