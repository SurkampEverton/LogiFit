/**
 * Seed Sprint 12 — avaliações físicas.
 *
 * Idempotente:
 *   1. Popula 5 assessment_types GLOBAIS (tenant_id NULL):
 *      - Antropometria Academia (peso/altura/circ. cintura/quadril/braço/coxa)
 *      - Bioimpedância (peso, % gordura, massa magra, % água, gordura visceral)
 *      - Dobras 7-pregas Pollock (7 dobras × idade + sexo via context)
 *      - Anamnese Academia (queixa principal + histórico + objetivos)
 *      - EVA — Escala Visual Analógica de Dor (Fisio)
 *   2. Por tenant: cria 2 avaliações populadas no primeiro member encontrado
 *      (Antropometria + Bioimpedância), pra demonstrar cálculos derivados.
 *
 * Roda como superuser pra criar tipos globais (RLS bloqueia app-role).
 *
 * Uso: `pnpm --filter @repo/db db:seed:avaliacoes`
 */
import { and, eq, isNull, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import {
  assessmentCalculations,
  assessmentMeasurements,
  assessmentTypes,
  assessments,
  members,
  tenants,
} from '../src/schema/index.js'
import { calculateImc, calculatePollock7, calculateTmbMifflin } from '../src/avaliacoes/calc.js'

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/logifit'

const GLOBAL_TYPES = [
  {
    name: 'Antropometria Academia',
    description: 'Medidas básicas de composição corporal (peso, altura, circunferências).',
    category: 'composicao_corporal' as const,
    vertical: 'academia' as const,
    fields: [
      { key: 'peso_kg', label: 'Peso', kind: 'number', unit: 'kg', min: 30, max: 250 },
      { key: 'altura_cm', label: 'Altura', kind: 'number', unit: 'cm', min: 100, max: 230 },
      { key: 'circ_cintura', label: 'Cintura', kind: 'number', unit: 'cm', min: 40, max: 200 },
      { key: 'circ_quadril', label: 'Quadril', kind: 'number', unit: 'cm', min: 40, max: 200 },
      { key: 'circ_braco', label: 'Braço', kind: 'number', unit: 'cm', min: 15, max: 60 },
      { key: 'circ_coxa', label: 'Coxa', kind: 'number', unit: 'cm', min: 20, max: 100 },
    ],
  },
  {
    name: 'Bioimpedância',
    description:
      'Análise de composição corporal via bioimpedância (InBody/equivalente). Resultados aceitos como source manual até Sprint 34 Device Hub.',
    category: 'composicao_corporal' as const,
    vertical: 'academia' as const,
    fields: [
      { key: 'peso_kg', label: 'Peso', kind: 'number', unit: 'kg', min: 30, max: 250 },
      { key: 'altura_cm', label: 'Altura', kind: 'number', unit: 'cm', min: 100, max: 230 },
      { key: 'pct_gordura', label: '% Gordura', kind: 'number', unit: '%', min: 1, max: 70 },
      { key: 'massa_magra_kg', label: 'Massa magra', kind: 'number', unit: 'kg', min: 10, max: 150 },
      { key: 'pct_agua', label: '% Água corporal', kind: 'number', unit: '%', min: 30, max: 75 },
      { key: 'gordura_visceral', label: 'Gordura visceral', kind: 'number', unit: 'nível', min: 1, max: 30 },
    ],
  },
  {
    name: 'Dobras 7 (Pollock-Jackson)',
    description:
      'Protocolo 7 dobras Pollock-Jackson 1980. Idade + sexo via contexto pra cálculo % gordura.',
    category: 'composicao_corporal' as const,
    vertical: 'academia' as const,
    clinicalReference: 'Pollock & Jackson 1980; Siri 1956',
    fields: [
      { key: 'dobra_tricipital', label: 'Tricipital', kind: 'number', unit: 'mm', min: 0, max: 60 },
      { key: 'dobra_subescapular', label: 'Subescapular', kind: 'number', unit: 'mm', min: 0, max: 60 },
      { key: 'dobra_supra_iliaca', label: 'Supra-ilíaca', kind: 'number', unit: 'mm', min: 0, max: 60 },
      { key: 'dobra_abdominal', label: 'Abdominal', kind: 'number', unit: 'mm', min: 0, max: 60 },
      { key: 'dobra_peitoral', label: 'Peitoral', kind: 'number', unit: 'mm', min: 0, max: 60 },
      { key: 'dobra_axilar_media', label: 'Axilar média', kind: 'number', unit: 'mm', min: 0, max: 60 },
      { key: 'dobra_coxa', label: 'Coxa', kind: 'number', unit: 'mm', min: 0, max: 60 },
    ],
  },
  {
    name: 'Anamnese Academia',
    description: 'Questionário inicial padrão Academia: histórico, objetivos, restrições.',
    category: 'anamnese' as const,
    vertical: 'academia' as const,
    fields: [
      { key: 'objetivo_principal', label: 'Objetivo principal', kind: 'enum',
        options: ['hipertrofia', 'emagrecimento', 'condicionamento', 'reabilitacao', 'saude_geral'] },
      { key: 'nivel_atividade', label: 'Nível atividade atual', kind: 'enum',
        options: ['sedentario', 'leve', 'moderado', 'intenso'] },
      { key: 'historico_medico', label: 'Histórico médico relevante', kind: 'text' },
      { key: 'medicamentos', label: 'Medicamentos em uso', kind: 'text' },
      { key: 'restricoes_motoras', label: 'Restrições motoras conhecidas', kind: 'text' },
      { key: 'frequencia_semanal', label: 'Frequência semanal alvo', kind: 'number',
        unit: 'sessões/semana', min: 1, max: 14 },
    ],
  },
  {
    name: 'EVA — Escala de Dor',
    description:
      'Escala Visual Analógica de Dor. 0 = sem dor, 10 = pior dor possível. Huskisson 1974.',
    category: 'escala_funcional' as const,
    vertical: 'fisio' as const,
    clinicalReference: 'Huskisson 1974',
    fields: [
      { key: 'eva_value', label: 'Intensidade dor (0-10)', kind: 'likert', min: 0, max: 10 },
      { key: 'local_dor', label: 'Local da dor', kind: 'text' },
    ],
    scoringMethod: {
      strategy: 'sum',
      interpretation: [
        { range: [0, 0], label: 'sem_dor', severity: 'info' },
        { range: [1, 3], label: 'dor_leve', severity: 'info' },
        { range: [4, 6], label: 'dor_moderada', severity: 'warning' },
        { range: [7, 9], label: 'dor_intensa', severity: 'danger' },
        { range: [10, 10], label: 'dor_insuportavel', severity: 'critical' },
      ],
    },
  },
] as const

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL })
  const db = drizzle(pool)
  console.log(`→ seeding avaliações ${DATABASE_URL.replace(/:[^:@]+@/, ':***@')}`)

  // 1. Tipos globais (idempotente por name + tenant_id IS NULL)
  const existingGlobal = await db
    .select({ id: assessmentTypes.id, name: assessmentTypes.name })
    .from(assessmentTypes)
    .where(isNull(assessmentTypes.tenantId))

  const existingByName = new Map(existingGlobal.map((t) => [t.name, t.id]))
  let inserted = 0
  for (const tpl of GLOBAL_TYPES) {
    if (existingByName.has(tpl.name)) continue
    const [row] = await db
      .insert(assessmentTypes)
      .values({
        tenantId: null,
        name: tpl.name,
        description: tpl.description,
        category: tpl.category,
        vertical: tpl.vertical,
        fields: tpl.fields as unknown as object,
        scoringMethod: 'scoringMethod' in tpl ? (tpl.scoringMethod as unknown as object) : null,
        clinicalReference: 'clinicalReference' in tpl ? tpl.clinicalReference : null,
        version: 1,
      })
      .returning({ id: assessmentTypes.id, name: assessmentTypes.name })
    if (row) {
      existingByName.set(row.name, row.id)
      inserted++
    }
  }
  console.log(`  • ${inserted} tipos globais inseridos (${existingByName.size} total)`)

  // 2. Por tenant: 2 avaliações populadas no 1º member encontrado
  const antropometriaId = existingByName.get('Antropometria Academia')!
  const bioimpedanciaId = existingByName.get('Bioimpedância')!

  const tenantsRows = await db.select({ id: tenants.id, name: tenants.name }).from(tenants)
  for (const tenant of tenantsRows) {
    const [member] = await db
      .select({ id: members.id })
      .from(members)
      .where(eq(members.tenantId, tenant.id))
      .limit(1)
    if (!member) {
      console.log(`  • ${tenant.name}: sem members, pulando seed de avaliações`)
      continue
    }

    const existingCount = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(assessments)
      .where(and(eq(assessments.tenantId, tenant.id), eq(assessments.memberId, member.id)))
    if ((existingCount[0]?.n ?? 0) >= 2) {
      console.log(`  • ${tenant.name}: ${existingCount[0]?.n} avaliações já existem, pulando`)
      continue
    }

    // Avaliação 1: Antropometria
    const performedAt1 = new Date()
    performedAt1.setMonth(performedAt1.getMonth() - 2)
    const [a1] = await db
      .insert(assessments)
      .values({
        tenantId: tenant.id,
        memberId: member.id,
        assessmentTypeId: antropometriaId,
        typeVersion: 1,
        performedAt: performedAt1,
        notes: 'Avaliação inicial — captura padrão.',
      })
      .returning({ id: assessments.id })
    if (a1) {
      const meas1 = [
        { fieldKey: 'peso_kg', valueNum: 78.5 },
        { fieldKey: 'altura_cm', valueNum: 175 },
        { fieldKey: 'circ_cintura', valueNum: 88 },
        { fieldKey: 'circ_quadril', valueNum: 98 },
        { fieldKey: 'circ_braco', valueNum: 32 },
        { fieldKey: 'circ_coxa', valueNum: 56 },
      ]
      await db.insert(assessmentMeasurements).values(
        meas1.map((m) => ({
          tenantId: tenant.id,
          assessmentId: a1.id,
          fieldKey: m.fieldKey,
          valueNum: m.valueNum.toString(),
          source: 'manual' as const,
        })),
      )
      // Calcs: IMC + RCQ + TMB Mifflin (assumindo masc 30a)
      const imc = calculateImc({ weightKg: 78.5, heightCm: 175 })!
      const tmb = calculateTmbMifflin({ weightKg: 78.5, heightCm: 175, ageYears: 30, sex: 'male' })!
      await db.insert(assessmentCalculations).values([
        {
          tenantId: tenant.id,
          assessmentId: a1.id,
          calcKey: 'imc',
          value: imc.value.toString(),
          classification: imc.classification ?? null,
        },
        {
          tenantId: tenant.id,
          assessmentId: a1.id,
          calcKey: 'tmb_mifflin',
          value: tmb.value.toString(),
          classification: null,
        },
      ])
    }

    // Avaliação 2: Bioimpedância (dia atual)
    const [a2] = await db
      .insert(assessments)
      .values({
        tenantId: tenant.id,
        memberId: member.id,
        assessmentTypeId: bioimpedanciaId,
        typeVersion: 1,
        performedAt: new Date(),
        notes: 'Bioimpedância — equipamento padrão.',
      })
      .returning({ id: assessments.id })
    if (a2) {
      const meas2 = [
        { fieldKey: 'peso_kg', valueNum: 77.2 },
        { fieldKey: 'altura_cm', valueNum: 175 },
        { fieldKey: 'pct_gordura', valueNum: 18.5 },
        { fieldKey: 'massa_magra_kg', valueNum: 62.9 },
        { fieldKey: 'pct_agua', valueNum: 58.4 },
        { fieldKey: 'gordura_visceral', valueNum: 7 },
      ]
      await db.insert(assessmentMeasurements).values(
        meas2.map((m) => ({
          tenantId: tenant.id,
          assessmentId: a2.id,
          fieldKey: m.fieldKey,
          valueNum: m.valueNum.toString(),
          source: 'manual' as const,
        })),
      )
      const imc2 = calculateImc({ weightKg: 77.2, heightCm: 175 })!
      const tmb2 = calculateTmbMifflin({
        weightKg: 77.2,
        heightCm: 175,
        ageYears: 30,
        sex: 'male',
      })!
      await db.insert(assessmentCalculations).values([
        {
          tenantId: tenant.id,
          assessmentId: a2.id,
          calcKey: 'imc',
          value: imc2.value.toString(),
          classification: imc2.classification ?? null,
        },
        {
          tenantId: tenant.id,
          assessmentId: a2.id,
          calcKey: 'tmb_mifflin',
          value: tmb2.value.toString(),
          classification: null,
        },
      ])
    }

    console.log(`  • ${tenant.name}: 2 avaliações criadas (Antropometria + Bioimpedância)`)
  }

  await pool.end()
  console.log('✓ seed avaliações done')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
