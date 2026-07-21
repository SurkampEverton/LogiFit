import { sql } from 'drizzle-orm'
/**
 * Seed Sprint 27 Faixa D — Cross-alert contraindicações curadas.
 *
 * Popula `cid_exercise_contraindications` com mapeamentos canônicos LogiFit
 * (tenant_id NULL = catálogo global). ~35 mapeamentos cobrindo as lesões/
 * patologias mais comuns que disparam adaptação de treino.
 *
 * Fontes citadas em `source`:
 *   - COFFITO 414/2012 + 415/2012 (resoluções fisioterapia)
 *   - ACSM 2023 Guidelines for Exercise Testing and Prescription
 *   - Curadoria LogiFit (consolidação multi-fonte)
 *
 * Uso: `pnpm --filter @repo/db db:seed:cross-contras`
 */
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { cidExerciseContraindications } from '../src/schema/index.js'

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/logifit'

interface ContraSeed {
  cidCode: string
  /** Quando preencher null em todos os 3 (exercise_id, muscle_group, movement_pattern),
   *  o seed pula (check constraint). */
  exerciseId?: string | null
  muscleGroup?: string | null
  movementPattern?: string | null
  severity: 'avoid' | 'modify' | 'caution'
  alternativeExerciseIds?: string[]
  rationale: string
  source: string
}

const CONTRAS: ContraSeed[] = [
  // ─── Dor lombar (MG30.0 + MG30.1) ─────────────────────────────────────
  {
    cidCode: 'MG30.0',
    muscleGroup: 'lombar',
    severity: 'avoid',
    rationale: 'Carga axial e flexão lombar excessiva aumentam estresse discal',
    source: 'ACSM 2023 + COFFITO 414/2012',
  },
  {
    cidCode: 'MG30.0',
    movementPattern: 'flexao_lombar_carga',
    severity: 'avoid',
    rationale: 'Stiff, levantamento terra, agachamento com carga aumentam pressão discal',
    source: 'Curadoria LogiFit',
  },
  {
    cidCode: 'MG30.0',
    muscleGroup: 'core',
    severity: 'modify',
    rationale:
      'Fortalecimento de core em posições neutras é benéfico — evitar crunchs com flexão repetida',
    source: 'ACSM 2023',
  },
  {
    cidCode: 'MG30.1',
    muscleGroup: 'lombar',
    severity: 'avoid',
    rationale: 'Sintomas radiculares contraindicam carga axial — preferir descompressão',
    source: 'COFFITO 414/2012',
  },
  // ─── Dor cervical (MG30.50) ────────────────────────────────────────────
  {
    cidCode: 'MG30.50',
    muscleGroup: 'cervical',
    severity: 'avoid',
    rationale: 'Carga em cervical (encolhimento, military press com barra livre)',
    source: 'COFFITO 415/2012',
  },
  {
    cidCode: 'MG30.50',
    muscleGroup: 'trapezio',
    severity: 'modify',
    rationale: 'Trapézio pode ser trabalhado com cargas leves e amplitude reduzida',
    source: 'Curadoria LogiFit',
  },
  // ─── Tendinopatia manguito rotador (FB52) ──────────────────────────────
  {
    cidCode: 'FB52',
    muscleGroup: 'ombro',
    severity: 'avoid',
    rationale: 'Elevação de ombro > 90° + carga inflama tendões inflamados',
    source: 'ACSM 2023',
  },
  {
    cidCode: 'FB52',
    movementPattern: 'elevacao_ombro_carga',
    severity: 'avoid',
    rationale: 'Desenvolvimento lateral, military press, arnold press — avoid agudo',
    source: 'Curadoria LogiFit',
  },
  // ─── Túnel do carpo (FB54.0) ───────────────────────────────────────────
  {
    cidCode: 'FB54.0',
    muscleGroup: 'antebraco',
    severity: 'modify',
    rationale: 'Evitar pegada com flexão de punho prolongada; usar straps quando indicado',
    source: 'Curadoria LogiFit',
  },
  // ─── Tendinopatia patelar (FB55.0) ─────────────────────────────────────
  {
    cidCode: 'FB55.0',
    muscleGroup: 'joelho',
    severity: 'avoid',
    rationale: 'Cargas axiais altas em flexão > 90° agravam tendinopatia patelar',
    source: 'ACSM 2023',
  },
  {
    cidCode: 'FB55.0',
    movementPattern: 'agachamento_profundo',
    severity: 'avoid',
    rationale: 'Agachamento livre profundo + carga: substituir por leg press 45° amplitude curta',
    source: 'Curadoria LogiFit',
  },
  // ─── Síndrome femoropatelar (FB55.1) ───────────────────────────────────
  {
    cidCode: 'FB55.1',
    muscleGroup: 'joelho',
    severity: 'modify',
    rationale: 'Fortalecimento de quadríceps obrigatório mas com amplitude controlada',
    source: 'ACSM 2023',
  },
  // ─── Fasciíte plantar (FB56) ───────────────────────────────────────────
  {
    cidCode: 'FB56',
    muscleGroup: 'calcaneo',
    severity: 'avoid',
    rationale: 'Impacto repetitivo em pé descalço; usar tênis adequado',
    source: 'Curadoria LogiFit',
  },
  {
    cidCode: 'FB56',
    movementPattern: 'corrida',
    severity: 'avoid',
    rationale: 'Substituir por bike ou natação até resolução',
    source: 'COFFITO 414/2012',
  },
  // ─── LCA (BA00) ────────────────────────────────────────────────────────
  {
    cidCode: 'BA00',
    muscleGroup: 'joelho',
    severity: 'avoid',
    rationale: 'Lesão LCA contraindica rotação e cisalhamento — fase aguda',
    source: 'ACSM 2023 + COFFITO 415/2012',
  },
  {
    cidCode: 'BA00',
    movementPattern: 'agachamento_livre',
    severity: 'avoid',
    rationale: 'Cisalhamento anterior alto — usar máquinas guiadas inicialmente',
    source: 'Curadoria LogiFit',
  },
  {
    cidCode: 'BA00',
    movementPattern: 'corrida',
    severity: 'avoid',
    rationale: 'Impacto + mudança de direção contraindicados em fase de recuperação',
    source: 'ACSM 2023',
  },
  // ─── Lesão meniscal (BA01) ─────────────────────────────────────────────
  {
    cidCode: 'BA01',
    muscleGroup: 'joelho',
    severity: 'modify',
    rationale: 'Cargas leves em amplitude reduzida; evitar flexão profunda',
    source: 'COFFITO 415/2012',
  },
  {
    cidCode: 'BA01',
    movementPattern: 'agachamento_profundo',
    severity: 'avoid',
    rationale: 'Compressão meniscal > 100° contraindicada',
    source: 'ACSM 2023',
  },
  // ─── Artrite reumatoide (FA20) ─────────────────────────────────────────
  {
    cidCode: 'FA20',
    muscleGroup: 'joelho',
    severity: 'caution',
    rationale: 'Cargas devem respeitar dor articular do dia (escala EVA)',
    source: 'ACSM 2023',
  },
  {
    cidCode: 'FA20',
    muscleGroup: 'ombro',
    severity: 'caution',
    rationale: 'Idem — adaptar amplitude e carga conforme inflamação',
    source: 'ACSM 2023',
  },
  // ─── Osteoartrose primária (FA00) ─────────────────────────────────────
  {
    cidCode: 'FA00',
    muscleGroup: 'joelho',
    severity: 'modify',
    rationale: 'Fortalecimento de quadríceps essencial; evitar impacto',
    source: 'ACSM 2023',
  },
  // ─── Fibromialgia (MG30.51) ────────────────────────────────────────────
  {
    cidCode: 'MG30.51',
    muscleGroup: 'core',
    severity: 'caution',
    rationale: 'Progressão lenta de carga; foco em aeróbico de baixo impacto',
    source: 'ACSM 2023',
  },
  // ─── Hemiplegia pós-AVC (8B11) ─────────────────────────────────────────
  {
    cidCode: '8B11',
    muscleGroup: 'core',
    severity: 'avoid',
    rationale: 'Treino padrão Academia contraindicado — exige reabilitação supervisionada',
    source: 'Curadoria LogiFit',
  },
  // ─── DPOC (CA22) ───────────────────────────────────────────────────────
  {
    cidCode: 'CA22',
    muscleGroup: 'core',
    severity: 'caution',
    rationale: 'Monitorar saturação O₂; pausas frequentes; evitar prender ar',
    source: 'ACSM 2023',
  },
  // ─── Diabetes mellitus 2 (5A11) ────────────────────────────────────────
  {
    cidCode: '5A11',
    muscleGroup: 'core',
    severity: 'caution',
    rationale: 'Monitorar glicemia pré/pós; lanche se < 100 mg/dL antes',
    source: 'ACSM 2023',
  },
  // ─── Insuficiência venosa MMII (BD93.0) ────────────────────────────────
  {
    cidCode: 'BD93.0',
    muscleGroup: 'panturrilha',
    severity: 'modify',
    rationale: 'Bomba muscular benéfica; evitar Valsalva e ortostatismo prolongado',
    source: 'COFFITO 415/2012',
  },
  // ─── Capsulite adesiva (FB45.0) ────────────────────────────────────────
  {
    cidCode: 'FB45.0',
    muscleGroup: 'ombro',
    severity: 'avoid',
    rationale: 'Movimentos rápidos em amplitude máxima contraindicados',
    source: 'COFFITO 415/2012',
  },
  // ─── Síndrome dolorosa miofascial (FB54.5) ─────────────────────────────
  {
    cidCode: 'FB54.5',
    muscleGroup: 'trapezio',
    severity: 'caution',
    rationale: 'Pontos-gatilho cervicais — adaptar carga e amplitude',
    source: 'Curadoria LogiFit',
  },
  // ─── Bursite trocantérica (FB30.0) ─────────────────────────────────────
  {
    cidCode: 'FB30.0',
    muscleGroup: 'quadril',
    severity: 'modify',
    rationale: 'Evitar abdução resistida ipsilateral em decúbito lateral',
    source: 'COFFITO 414/2012',
  },
  // ─── Bursite subacromial (FB30.1) ──────────────────────────────────────
  {
    cidCode: 'FB30.1',
    muscleGroup: 'ombro',
    severity: 'avoid',
    rationale: 'Elevação acima da linha dos ombros aumenta impacto subacromial',
    source: 'ACSM 2023',
  },
  // ─── Condromalácia patelar (FB80) ──────────────────────────────────────
  {
    cidCode: 'FB80',
    movementPattern: 'agachamento_profundo',
    severity: 'avoid',
    rationale: 'Compressão patelofemoral em flexão profunda agrava sintomas',
    source: 'ACSM 2023',
  },
  {
    cidCode: 'FB80',
    muscleGroup: 'joelho',
    severity: 'modify',
    rationale: 'Cadeira extensora amplitude 30-0° é mais segura que 90-0°',
    source: 'Curadoria LogiFit',
  },
  // ─── Dor crônica primária (MG31.0) ─────────────────────────────────────
  {
    cidCode: 'MG31.0',
    muscleGroup: 'core',
    severity: 'caution',
    rationale: 'Exercício é benefício comprovado; progressão lenta + escuta ativa',
    source: 'ACSM 2023',
  },
  // ─── Espondilite anquilosante (FA20.1) ─────────────────────────────────
  {
    cidCode: 'FA20.1',
    movementPattern: 'flexao_lombar_carga',
    severity: 'avoid',
    rationale: 'Flexão lombar repetitiva contraindicada — preferir extensão e mobilidade',
    source: 'ACSM 2023 + COFFITO 415/2012',
  },
]

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: DATABASE_URL })
  const db = drizzle(pool)

  try {
    console.log(`[seed-cross-contras] Inserindo ${CONTRAS.length} contraindicações globais...`)

    // Garante que CIDs referenciados existem (a maioria já vem do seed-fisio)
    const cidCodes = Array.from(new Set(CONTRAS.map((c) => c.cidCode)))
    const existing = await pool.query<{ code: string }>(
      `SELECT code FROM cid_catalog WHERE code = ANY($1::text[])`,
      [cidCodes],
    )
    const existingSet = new Set(existing.rows.map((r) => r.code))
    const missing = cidCodes.filter((c) => !existingSet.has(c))
    if (missing.length > 0) {
      console.warn(
        `[seed-cross-contras] CIDs não encontrados em cid_catalog: ${missing.join(', ')} — rode seed-fisio primeiro.`,
      )
    }

    let inserted = 0
    let skipped = 0
    for (const c of CONTRAS) {
      if (!existingSet.has(c.cidCode)) {
        skipped++
        continue
      }
      try {
        await db
          .insert(cidExerciseContraindications)
          .values({
            tenantId: null,
            cidCode: c.cidCode,
            exerciseId: c.exerciseId ?? null,
            muscleGroup: c.muscleGroup ?? null,
            movementPattern: c.movementPattern ?? null,
            severity: c.severity,
            alternativeExerciseIds: c.alternativeExerciseIds ?? [],
            rationale: c.rationale,
            source: c.source,
          })
          .onConflictDoNothing()
        inserted++
      } catch (err) {
        const e = err as { code?: string; message?: string }
        if (e.code === '23505') {
          skipped++
        } else {
          console.error(`[seed-cross-contras] Falhou CID ${c.cidCode}:`, e.message)
        }
      }
    }

    // Confere quantos existem agora (global)
    const total = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM cid_exercise_contraindications WHERE tenant_id IS NULL`,
    )
    console.log(
      `[seed-cross-contras] ✅ ${inserted} inseridos · ${skipped} pulados · ${total.rows[0]!.count} total global agora`,
    )
    void sql // silence unused import
  } finally {
    await pool.end()
  }
}

main().catch((err) => {
  console.error('[seed-cross-contras] Erro fatal:', err)
  process.exit(1)
})
