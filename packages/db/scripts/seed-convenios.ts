/**
 * Seed Sprint 22 Faixa D — Convênios TISS minimal.
 *
 * Popula:
 *   - 3 planos globais (Unimed Brasil + Bradesco Saúde + Amil)
 *   - 1 import audit record (version 2026.01)
 *   - ~30 códigos TUSS top fisio/clínica (procedimentos + medicamentos)
 *
 * Idempotente (ON CONFLICT DO NOTHING).
 *
 * Uso: `pnpm --filter @repo/db db:seed:convenios`
 */
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import {
  insurancePlans,
  tussCatalog,
  tussCatalogImports,
} from '../src/schema/index.js'

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/logifit'

interface PlanSeed {
  name: string
  ansCode: string
  national: boolean
}

const PLANS: PlanSeed[] = [
  { name: 'Unimed Brasil', ansCode: '343889', national: true },
  { name: 'Bradesco Saúde', ansCode: '005711', national: true },
  { name: 'Amil', ansCode: '326305', national: true },
  { name: 'SulAmérica Saúde', ansCode: '006246', national: true },
  { name: 'NotreDame Intermédica', ansCode: '359017', national: true },
]

interface TussSeed {
  code: string
  description: string
  category: 'procedimento' | 'opme' | 'medicamento' | 'taxa_diaria' | 'gasoterapia'
  specialties: string[]
}

const TUSS: TussSeed[] = [
  // Procedimentos consulta
  { code: '10101012', description: 'Consulta em consultório (no horário normal ou preestabelecido)', category: 'procedimento', specialties: ['medicina'] },
  { code: '10101039', description: 'Consulta em domicílio', category: 'procedimento', specialties: ['medicina'] },
  { code: '10101047', description: 'Consulta em pronto socorro', category: 'procedimento', specialties: ['medicina'] },
  // Fisioterapia
  { code: '20104073', description: 'Sessão de fisioterapia individual', category: 'procedimento', specialties: ['fisioterapia'] },
  { code: '20104081', description: 'Sessão de fisioterapia em grupo', category: 'procedimento', specialties: ['fisioterapia'] },
  { code: '20104090', description: 'Atendimento fisioterapêutico hospitalar', category: 'procedimento', specialties: ['fisioterapia'] },
  // Nutrição
  { code: '50000470', description: 'Consulta nutricional', category: 'procedimento', specialties: ['nutricao'] },
  { code: '50000489', description: 'Acompanhamento nutricional individual', category: 'procedimento', specialties: ['nutricao'] },
  // Enfermagem
  { code: '40101010', description: 'Visita de enfermagem hospitalar', category: 'procedimento', specialties: ['enfermagem'] },
  // RPG / Pilates clínico
  { code: '20104111', description: 'Reeducação Postural Global (RPG)', category: 'procedimento', specialties: ['fisioterapia'] },
  // Exames complementares comuns
  { code: '40901130', description: 'Eletrocardiograma de repouso', category: 'procedimento', specialties: ['medicina'] },
  { code: '40901327', description: 'Espirometria simples', category: 'procedimento', specialties: ['medicina', 'fisioterapia'] },
  // Avaliação
  { code: '50000071', description: 'Avaliação postural', category: 'procedimento', specialties: ['fisioterapia'] },
  { code: '50000128', description: 'Avaliação funcional', category: 'procedimento', specialties: ['fisioterapia'] },
  // Imobilização / órteses
  { code: '20104278', description: 'Aplicação de imobilização gessada (membro inferior)', category: 'procedimento', specialties: ['medicina', 'fisioterapia'] },
  // OPME comum
  { code: '70000118', description: 'Joelheira articulada', category: 'opme', specialties: ['fisioterapia', 'medicina'] },
  { code: '70000142', description: 'Tornozeleira elástica', category: 'opme', specialties: ['fisioterapia', 'medicina'] },
  { code: '70000169', description: 'Colete lombar abdominal', category: 'opme', specialties: ['fisioterapia', 'medicina'] },
  // Medicamentos comuns (em fisio = aplicação de gel/creme; em consulta = injetável)
  { code: '90150019', description: 'Diclofenaco sódico gel 1%', category: 'medicamento', specialties: ['fisioterapia'] },
  { code: '90150035', description: 'Tribedoxina (Vitamina B1+B6+B12) injetável', category: 'medicamento', specialties: ['medicina'] },
  { code: '90150086', description: 'Soro fisiológico 0,9% 500ml', category: 'medicamento', specialties: ['medicina', 'enfermagem'] },
  // Taxas
  { code: '60010014', description: 'Taxa de sala para procedimento ambulatorial', category: 'taxa_diaria', specialties: [] },
  { code: '60010030', description: 'Taxa de equipamento (eletroterapia)', category: 'taxa_diaria', specialties: ['fisioterapia'] },
  // Gasoterapia / oxigenoterapia
  { code: '80010019', description: 'Oxigenoterapia (por hora)', category: 'gasoterapia', specialties: ['fisioterapia', 'medicina'] },
  // Sessão grupo / Pilates clínico
  { code: '20104120', description: 'Pilates terapêutico em grupo (até 5 pacientes)', category: 'procedimento', specialties: ['fisioterapia'] },
  { code: '20104138', description: 'Hidroterapia em piscina aquecida', category: 'procedimento', specialties: ['fisioterapia'] },
  // Outros comuns
  { code: '20104154', description: 'Massoterapia / liberação miofascial', category: 'procedimento', specialties: ['fisioterapia'] },
  { code: '20104162', description: 'Crochetagem mioaponeurótica', category: 'procedimento', specialties: ['fisioterapia'] },
  { code: '20104170', description: 'Bandagem terapêutica (Kinesio Taping)', category: 'procedimento', specialties: ['fisioterapia'] },
  { code: '20104189', description: 'Terapia manual ortopédica', category: 'procedimento', specialties: ['fisioterapia'] },
]

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL })
  const db = drizzle(pool)
  console.log(`→ seeding convenios ${DATABASE_URL.replace(/:[^:@]+@/, ':***@')}`)

  // 1. Insurance plans globais
  let plansInserted = 0
  for (const p of PLANS) {
    const r = await db
      .insert(insurancePlans)
      .values({
        name: p.name,
        ansCode: p.ansCode,
        tissVersion: '4.01',
        national: p.national,
        active: true,
      })
      .onConflictDoNothing()
      .returning({ id: insurancePlans.id })
    if (r.length > 0) plansInserted += 1
  }

  // 2. TUSS catalog
  let tussInserted = 0
  for (const t of TUSS) {
    const r = await db
      .insert(tussCatalog)
      .values({
        code: t.code,
        description: t.description,
        category: t.category,
        version: '2026.01',
        specialties: t.specialties,
        active: true,
        effectiveFrom: '2026-01-15',
      })
      .onConflictDoNothing()
      .returning({ code: tussCatalog.code })
    if (r.length > 0) tussInserted += 1
  }

  // 3. Import audit
  await db
    .insert(tussCatalogImports)
    .values({
      version: '2026.01',
      source: 'ans_oficio_circular',
      itemsAdded: tussInserted,
      itemsUpdated: 0,
      itemsDeactivated: 0,
      importLog: `Seed inicial Sprint 22 Faixa D: ${tussInserted} códigos TUSS top fisio/clínica/personal vindos do Ofício-Circular ANS nº 1/2026.`,
    })
    .onConflictDoNothing()

  console.log(
    `✓ seed done: ${plansInserted}/${PLANS.length} planos + ${tussInserted}/${TUSS.length} TUSS`,
  )
  await pool.end()
}

main().catch((err) => {
  console.error('seed failed:', err)
  process.exit(1)
})
