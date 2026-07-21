/**
 * Seed Sprint 11 — treinos.
 *
 * Idempotente:
 *   1. Popula 20 exercises GLOBAIS (tenant_id NULL) — biblioteca curada LogiFit
 *      cobrindo grupos canônicos (peito/dorsal/quadriceps/posterior/ombro/braço/
 *      core/aeróbico) com MET Compendium 2024.
 *   2. Por tenant: cria 2 workouts (`Treino A — Superior` + `Treino B — Inferior`)
 *      cada um com 4-6 items linkando exercises globais.
 *
 * Roda como `postgres` superuser (bypassa RLS — admin-only). Necessário pra
 * INSERT com tenant_id=NULL (RLS bloqueia app-role).
 *
 * Uso: `pnpm --filter @repo/db db:seed:treinos`
 */
import { eq, isNull, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { exercises, tenants, workoutItems, workouts } from '../src/schema/index.js'

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/logifit'

// MET values: Compendium of Physical Activities 2024
const GLOBAL_EXERCISES = [
  // Peito
  {
    name: 'Supino reto com barra',
    met: 6.0,
    level: 'intermediario',
    groups: ['peitoral', 'triceps', 'ombro'],
    equipment: 'barra',
  },
  {
    name: 'Supino inclinado com halteres',
    met: 5.5,
    level: 'intermediario',
    groups: ['peitoral', 'ombro'],
    equipment: 'halteres',
  },
  {
    name: 'Crucifixo na máquina',
    met: 4.5,
    level: 'iniciante',
    groups: ['peitoral'],
    equipment: 'máquina',
  },
  // Dorsal
  {
    name: 'Puxada frontal',
    met: 5.0,
    level: 'iniciante',
    groups: ['dorsal', 'biceps'],
    equipment: 'máquina',
  },
  {
    name: 'Remada baixa',
    met: 5.5,
    level: 'intermediario',
    groups: ['dorsal', 'biceps'],
    equipment: 'máquina',
  },
  {
    name: 'Barra fixa',
    met: 8.0,
    level: 'avancado',
    groups: ['dorsal', 'biceps', 'core'],
    equipment: 'peso corporal',
  },
  // Quadriceps / posterior
  {
    name: 'Agachamento livre',
    met: 6.0,
    level: 'intermediario',
    groups: ['quadriceps', 'gluteo', 'posterior'],
    equipment: 'barra',
  },
  {
    name: 'Leg press',
    met: 5.5,
    level: 'iniciante',
    groups: ['quadriceps', 'gluteo'],
    equipment: 'máquina',
  },
  {
    name: 'Cadeira extensora',
    met: 4.0,
    level: 'iniciante',
    groups: ['quadriceps'],
    equipment: 'máquina',
  },
  {
    name: 'Mesa flexora',
    met: 4.0,
    level: 'iniciante',
    groups: ['posterior'],
    equipment: 'máquina',
  },
  {
    name: 'Stiff com halteres',
    met: 5.0,
    level: 'intermediario',
    groups: ['posterior', 'gluteo'],
    equipment: 'halteres',
  },
  // Ombro
  {
    name: 'Desenvolvimento militar',
    met: 5.5,
    level: 'intermediario',
    groups: ['ombro', 'triceps'],
    equipment: 'barra',
  },
  {
    name: 'Elevação lateral',
    met: 4.5,
    level: 'iniciante',
    groups: ['ombro'],
    equipment: 'halteres',
  },
  // Braço
  {
    name: 'Rosca direta com barra',
    met: 4.5,
    level: 'iniciante',
    groups: ['biceps'],
    equipment: 'barra',
  },
  { name: 'Tríceps testa', met: 4.5, level: 'iniciante', groups: ['triceps'], equipment: 'barra' },
  {
    name: 'Tríceps corda na polia',
    met: 4.0,
    level: 'iniciante',
    groups: ['triceps'],
    equipment: 'polia',
  },
  // Core
  {
    name: 'Prancha frontal',
    met: 4.0,
    level: 'iniciante',
    groups: ['core'],
    equipment: 'peso corporal',
  },
  {
    name: 'Abdominal crunch',
    met: 3.5,
    level: 'iniciante',
    groups: ['core'],
    equipment: 'peso corporal',
  },
  // Aeróbico
  {
    name: 'Esteira corrida moderada',
    met: 7.0,
    level: 'intermediario',
    groups: ['aerobico', 'quadriceps'],
    equipment: 'esteira',
  },
  {
    name: 'Bike spinning HIIT',
    met: 8.5,
    level: 'avancado',
    groups: ['aerobico', 'quadriceps'],
    equipment: 'bike',
  },
] as const

const WORKOUT_TEMPLATES = [
  {
    name: 'Treino A — Superior (Push + Pull)',
    goal: 'hipertrofia',
    estimatedDurationMin: 60,
    description: 'Treino completo de membros superiores com foco em hipertrofia.',
    items: [
      {
        exerciseName: 'Supino reto com barra',
        sets: 4,
        reps: '8-10',
        loadKg: null,
        restSeconds: 90,
      },
      {
        exerciseName: 'Supino inclinado com halteres',
        sets: 3,
        reps: '10-12',
        loadKg: null,
        restSeconds: 60,
      },
      { exerciseName: 'Puxada frontal', sets: 4, reps: '10', loadKg: null, restSeconds: 90 },
      { exerciseName: 'Remada baixa', sets: 3, reps: '10-12', loadKg: null, restSeconds: 60 },
      {
        exerciseName: 'Desenvolvimento militar',
        sets: 3,
        reps: '10',
        loadKg: null,
        restSeconds: 60,
      },
      {
        exerciseName: 'Rosca direta com barra',
        sets: 3,
        reps: '12',
        loadKg: null,
        restSeconds: 45,
      },
    ],
  },
  {
    name: 'Treino B — Inferior (Pernas + Core)',
    goal: 'hipertrofia',
    estimatedDurationMin: 55,
    description: 'Treino de membros inferiores com finalização de core.',
    items: [
      { exerciseName: 'Agachamento livre', sets: 4, reps: '8-10', loadKg: null, restSeconds: 120 },
      { exerciseName: 'Leg press', sets: 3, reps: '12', loadKg: null, restSeconds: 90 },
      { exerciseName: 'Cadeira extensora', sets: 3, reps: '12', loadKg: null, restSeconds: 60 },
      { exerciseName: 'Mesa flexora', sets: 3, reps: '12', loadKg: null, restSeconds: 60 },
      { exerciseName: 'Stiff com halteres', sets: 3, reps: '10', loadKg: null, restSeconds: 90 },
      { exerciseName: 'Prancha frontal', sets: 3, reps: '40s', loadKg: null, restSeconds: 45 },
    ],
  },
] as const

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL })
  const db = drizzle(pool)
  console.log(`→ seeding treinos ${DATABASE_URL.replace(/:[^:@]+@/, ':***@')}`)

  // 1. Insere exercícios globais (idempotente via name unique global)
  const existingGlobal = await db
    .select({ name: exercises.name, id: exercises.id })
    .from(exercises)
    .where(isNull(exercises.tenantId))

  const existingGlobalByName = new Map(existingGlobal.map((e) => [e.name, e.id]))
  let inserted = 0
  for (const ex of GLOBAL_EXERCISES) {
    if (existingGlobalByName.has(ex.name)) continue
    const [row] = await db
      .insert(exercises)
      .values({
        tenantId: null,
        name: ex.name,
        muscleGroups: ex.groups as unknown as string[],
        equipment: ex.equipment,
        level: ex.level,
        metValue: ex.met.toString(),
      })
      .returning({ id: exercises.id, name: exercises.name })
    if (row) {
      existingGlobalByName.set(row.name, row.id)
      inserted++
    }
  }
  console.log(`  • ${inserted} exercícios globais inseridos (${existingGlobalByName.size} total)`)

  // 2. Por tenant: cria 2 workouts com items
  const tenantsRows = await db.select({ id: tenants.id, name: tenants.name }).from(tenants)
  console.log(`  • ${tenantsRows.length} tenants encontrados`)

  for (const tenant of tenantsRows) {
    const existing = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(workouts)
      .where(eq(workouts.tenantId, tenant.id))
    if ((existing[0]?.n ?? 0) >= 2) {
      console.log(`  • ${tenant.name}: ${existing[0]?.n} workouts já existem, pulando`)
      continue
    }

    for (const wt of WORKOUT_TEMPLATES) {
      const [w] = await db
        .insert(workouts)
        .values({
          tenantId: tenant.id,
          name: wt.name,
          description: wt.description,
          goal: wt.goal,
          estimatedDurationMin: wt.estimatedDurationMin,
          version: 1,
        })
        .returning({ id: workouts.id })
      if (!w) continue

      const itemsToInsert = wt.items
        .map((it, idx) => {
          const exId = existingGlobalByName.get(it.exerciseName)
          if (!exId) return null
          return {
            tenantId: tenant.id,
            workoutId: w.id,
            exerciseId: exId,
            order: idx,
            sets: it.sets,
            reps: it.reps,
            loadKg: it.loadKg,
            restSeconds: it.restSeconds,
          }
        })
        .filter((x): x is NonNullable<typeof x> => x !== null)

      if (itemsToInsert.length > 0) {
        await db.insert(workoutItems).values(itemsToInsert)
      }
      console.log(
        `  • ${tenant.name}: workout '${wt.name}' criado com ${itemsToInsert.length} items`,
      )
    }
  }

  await pool.end()
  console.log('✓ seed treinos done')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
