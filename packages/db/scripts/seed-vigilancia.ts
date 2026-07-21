/**
 * Seed Sprint 25 Faixa D — Vigilância Sanitária minimal.
 *
 * Por tenant matriz com user:
 *   - 3 equipamentos (1 ultrassom + 1 TENS + 1 bioimpedância)
 *   - 1 manutenção agendada por equipamento
 *   - 1 checklist de limpeza com 5 items
 *   - 5 logs de limpeza recentes (3 completos + 2 parciais)
 *
 * Idempotente via serial pattern + checklist name único.
 *
 * Uso: `pnpm --filter @repo/db db:seed:vigilancia`
 */
import { and, asc, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import {
  cleaningChecklists,
  cleaningLogs,
  companies,
  equipment,
  equipmentMaintenance,
  tenants,
  users,
} from '../src/schema/index.js'

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/logifit'

interface EquipmentSeed {
  kind: 'ultrassom' | 'tens' | 'balanca_bioimpedancia'
  manufacturer: string
  model: string
  serialSuffix: string
  anvisaRegistration: string
  maintenanceIntervalDays: number
  calibrationIntervalDays: number | null
  maintenanceKind: 'preventive' | 'calibration'
}

const EQUIPMENTS: EquipmentSeed[] = [
  {
    kind: 'ultrassom',
    manufacturer: 'Bioset',
    model: 'Sonopulse 3 Geração',
    serialSuffix: 'ULT-001',
    anvisaRegistration: '10379070058',
    maintenanceIntervalDays: 180,
    calibrationIntervalDays: 365,
    maintenanceKind: 'preventive',
  },
  {
    kind: 'tens',
    manufacturer: 'IBRAMED',
    model: 'NeuroDyn II',
    serialSuffix: 'TNS-001',
    anvisaRegistration: '10287060003',
    maintenanceIntervalDays: 365,
    calibrationIntervalDays: null,
    maintenanceKind: 'preventive',
  },
  {
    kind: 'balanca_bioimpedancia',
    manufacturer: 'InBody',
    model: '270',
    serialSuffix: 'BIO-001',
    anvisaRegistration: '80523360001',
    maintenanceIntervalDays: 180,
    calibrationIntervalDays: 365,
    maintenanceKind: 'calibration',
  },
]

const CHECKLIST_ITEMS = [
  { key: 'alcool_70', label: 'Limpar superfícies com álcool 70%', required: true },
  {
    key: 'descarte_perfurocortantes',
    label: 'Esvaziar descartador perfurocortantes',
    required: true,
  },
  { key: 'troca_lencois', label: 'Trocar lençóis e toalhas', required: true },
  { key: 'lixo_organico', label: 'Esvaziar lixo orgânico', required: false },
  { key: 'esterilizar_aparelhos', label: 'Esterilizar transdutores/eletrodos', required: false },
]

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL })
  const db = drizzle(pool)
  console.log(`→ seeding vigilancia ${DATABASE_URL.replace(/:[^:@]+@/, ':***@')}`)

  const tenantsRows = await db.select({ id: tenants.id, name: tenants.name }).from(tenants)
  console.log(`  • ${tenantsRows.length} tenants encontrados`)

  let totalEq = 0
  let totalMnt = 0
  let totalChk = 0
  let totalLogs = 0

  for (const tenant of tenantsRows) {
    const [matriz] = await db
      .select({ id: companies.id })
      .from(companies)
      .where(and(eq(companies.tenantId, tenant.id), eq(companies.type, 'matriz')))
      .orderBy(asc(companies.createdAt))
      .limit(1)
    if (!matriz) continue

    const [user] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.tenantId, tenant.id))
      .limit(1)
    if (!user) continue

    // Equipamentos + manutenções
    for (const seed of EQUIPMENTS) {
      const serial = `SEED-${tenant.id.slice(0, 8)}-${seed.serialSuffix}`
      const existing = await db
        .select({ id: equipment.id })
        .from(equipment)
        .where(
          and(eq(equipment.manufacturer, seed.manufacturer), eq(equipment.serialNumber, serial)),
        )
        .limit(1)

      let eqId: string
      if (existing[0]) {
        eqId = existing[0].id
      } else {
        try {
          const [row] = await db
            .insert(equipment)
            .values({
              tenantId: tenant.id,
              companyId: matriz.id,
              kind: seed.kind,
              manufacturer: seed.manufacturer,
              model: seed.model,
              serialNumber: serial,
              anvisaRegistration: seed.anvisaRegistration,
              acquiredAt: '2025-06-01',
              maintenanceIntervalDays: seed.maintenanceIntervalDays,
              calibrationIntervalDays: seed.calibrationIntervalDays,
              notes: 'Equipamento seed Sprint 25',
              createdByUserId: user.id,
            })
            .returning({ id: equipment.id })
          eqId = row!.id
          totalEq += 1
        } catch (err) {
          const e = err as { code?: string; cause?: { code?: string } }
          const code = e.code ?? e.cause?.code ?? ''
          if (code !== '23505') throw err
          continue
        }

        // Manutenção agendada D+30
        const plannedFor = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
          .toISOString()
          .slice(0, 10)
        await db.insert(equipmentMaintenance).values({
          tenantId: tenant.id,
          equipmentId: eqId,
          kind: seed.maintenanceKind,
          plannedFor,
          status: 'scheduled',
          externalLocation: seed.maintenanceKind === 'calibration', // calibração tipicamente externa
          externalSupplierId: seed.maintenanceKind === 'calibration' ? crypto.randomUUID() : null,
          observations: 'Manutenção semestral seed',
          createdByUserId: user.id,
        })
        totalMnt += 1
      }
    }

    // Checklist
    const checklistName = `Seed Sprint 25 — Sala Fisio ${tenant.id.slice(0, 8)}`
    const existingC = await db
      .select({ id: cleaningChecklists.id })
      .from(cleaningChecklists)
      .where(
        and(eq(cleaningChecklists.tenantId, tenant.id), eq(cleaningChecklists.name, checklistName)),
      )
      .limit(1)

    let chkId: string
    if (existingC[0]) {
      chkId = existingC[0].id
    } else {
      const [row] = await db
        .insert(cleaningChecklists)
        .values({
          tenantId: tenant.id,
          companyId: matriz.id,
          name: checklistName,
          items: CHECKLIST_ITEMS as unknown as Record<string, unknown>,
          frequencyDays: 1,
          active: true,
        })
        .returning({ id: cleaningChecklists.id })
      chkId = row!.id
      totalChk += 1

      // 5 logs amostra
      for (let i = 0; i < 5; i++) {
        const daysAgo = i
        const performedAt = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000)
        const isComplete = i < 3
        const itemsDone = isComplete
          ? ['alcool_70', 'descarte_perfurocortantes', 'troca_lencois', 'lixo_organico']
          : ['alcool_70'] // só 1 required
        const completionPct = Math.round((itemsDone.length / CHECKLIST_ITEMS.length) * 100)
        await db.insert(cleaningLogs).values({
          tenantId: tenant.id,
          companyId: matriz.id,
          checklistId: chkId,
          performedByUserId: user.id,
          performedAt,
          itemsDone: itemsDone as unknown as Record<string, unknown>,
          completionPct,
          isComplete,
          observations: isComplete ? 'Limpeza completa' : 'Faltou trocar lençóis',
        })
        totalLogs += 1
      }
    }
  }

  console.log(
    `✓ seed done: ${totalEq} equipamentos + ${totalMnt} manutenções + ${totalChk} checklists + ${totalLogs} logs`,
  )
  await pool.end()
}

main().catch((err) => {
  console.error('seed failed:', err)
  process.exit(1)
})
