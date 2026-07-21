/**
 * Seed Sprint 30 Faixa D — Suplementação + Exames laboratoriais.
 *
 * Popula:
 *   - 10 suplementos globais canônicos (Vit D3, Vit B12, Ômega 3, Magnésio, Ferro, Creatina,
 *     Whey isolado, Probiótico, Cálcio, Multivitamínico)
 *   - 30 interações curadas (Vit K vs varfarina, Cálcio vs Ferro, etc)
 *   - 20 analitos globais (glicose jejum, HbA1c, colesterol total, HDL, LDL, triglicérides,
 *     TSH, T4L, vitamina D 25OH, B12, ferritina, hemoglobina, hematócrito, leucócitos,
 *     creatinina, ureia, ácido úrico, PCR, AST, ALT)
 *   - Faixas de referência por analito (com segmentações sex + age + condition quando aplica)
 *
 * Idempotente via ON CONFLICT. Sources: SBAC + Mayo Clinic.
 *
 * Uso: `pnpm --filter @repo/db db:seed:nutri-labs`
 */
import { Pool } from 'pg'

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/logifit'

interface SupplementSeed {
  name: string
  kind:
    | 'vitamin'
    | 'mineral'
    | 'fitoterapico'
    | 'aminoacid'
    | 'protein_powder'
    | 'blend'
    | 'omega'
    | 'probiotic'
    | 'enzyme'
    | 'pre_workout'
    | 'other'
  concentration?: string
  anvisaRegistration?: string
  indication?: string
  contraindications?: string
}

const SUPPLEMENTS: SupplementSeed[] = [
  {
    name: 'Vitamina D3 (colecalciferol)',
    kind: 'vitamin',
    concentration: '1000 UI a 7000 UI por cápsula',
    indication: 'Deficiência de vitamina D (25-OH < 30 ng/mL). Suporte ósseo e imunológico.',
    contraindications: 'Hipercalcemia, hipervitaminose D, sarcoidose ativa.',
  },
  {
    name: 'Vitamina B12 (cianocobalamina)',
    kind: 'vitamin',
    concentration: '500 mcg a 5000 mcg por cápsula',
    indication:
      'Deficiência de B12 (B12 sérica < 200 pg/mL). Comum em veganos, idosos, pacientes com gastrite atrófica.',
    contraindications: 'Hipersensibilidade conhecida ao cobalto.',
  },
  {
    name: 'Ômega 3 EPA+DHA',
    kind: 'omega',
    concentration: '500-1000 mg EPA+DHA por cápsula',
    indication: 'Suporte cardiovascular + redução de triglicérides + inflamação crônica.',
    contraindications:
      'Distúrbios de coagulação; uso concomitante com anticoagulantes pede ajuste.',
  },
  {
    name: 'Magnésio bisglicinato',
    kind: 'mineral',
    concentration: '200-400 mg de magnésio elemento',
    indication: 'Cãibras, qualidade do sono, ansiedade leve, deficiência laboratorial.',
    contraindications: 'Insuficiência renal grave (eGFR < 30 mL/min).',
  },
  {
    name: 'Ferro quelato (bisglicinato)',
    kind: 'mineral',
    concentration: '14-40 mg de ferro elemento',
    indication: 'Anemia ferropriva, deficiência de ferritina (< 30 ng/mL).',
    contraindications: 'Hemocromatose. Tomar separado de Cálcio e laticínios.',
  },
  {
    name: 'Creatina monoidratada',
    kind: 'aminoacid',
    concentration: '3-5 g por dose',
    indication: 'Performance esportiva, ganho de massa muscular, recuperação.',
    contraindications: 'Insuficiência renal grave. Hidratação adequada obrigatória.',
  },
  {
    name: 'Whey protein isolado',
    kind: 'protein_powder',
    concentration: '~25 g de proteína por scoop',
    indication: 'Aporte proteico em atletas, idosos, sarcopenia, pós-bariátrica.',
    contraindications: 'Intolerância à lactose grave (mesmo no isolado pode ter traços).',
  },
  {
    name: 'Probiótico multi-cepa',
    kind: 'probiotic',
    concentration: '10-30 bilhões UFC por cápsula',
    indication: 'Disbiose intestinal, pós-antibiótico, síndrome do intestino irritável.',
    contraindications: 'Imunossupressão grave (avaliar caso a caso).',
  },
  {
    name: 'Cálcio citrato',
    kind: 'mineral',
    concentration: '500-1000 mg de cálcio elemento',
    indication: 'Osteopenia/osteoporose, gestação tardia, pós-menopausa.',
    contraindications: 'Hipercalcemia. Tomar separado de Ferro e tireoidianos.',
  },
  {
    name: 'Multivitamínico adulto',
    kind: 'blend',
    concentration: '1 cápsula com 100% IDR vitaminas e minerais essenciais',
    indication: 'Suporte nutricional geral; complemento em dietas restritivas.',
    contraindications: 'Hipervitaminose; ajustar pra gestantes (fórmula específica).',
  },
]

interface InteractionSeed {
  supplementName: string
  interactsWith: string
  severity: 'info' | 'caution' | 'avoid'
  description: string
  source?: string
}

const INTERACTIONS: InteractionSeed[] = [
  // Vitamina D3
  {
    supplementName: 'Vitamina D3 (colecalciferol)',
    interactsWith: 'Tiazídicos',
    severity: 'caution',
    description: 'Aumenta absorção de cálcio; monitorar hipercalcemia.',
    source: 'Mayo Clinic',
  },
  {
    supplementName: 'Vitamina D3 (colecalciferol)',
    interactsWith: 'Corticoides',
    severity: 'caution',
    description: 'Corticoides reduzem absorção de cálcio; pode antagonizar efeito.',
    source: 'Mayo Clinic',
  },
  // Vitamina B12
  {
    supplementName: 'Vitamina B12 (cianocobalamina)',
    interactsWith: 'Metformina',
    severity: 'caution',
    description: 'Metformina reduz absorção de B12; monitorar B12 sérica.',
    source: 'SBEM',
  },
  {
    supplementName: 'Vitamina B12 (cianocobalamina)',
    interactsWith: 'Omeprazol',
    severity: 'caution',
    description: 'IBPs prolongados reduzem absorção de B12.',
    source: 'SBEM',
  },
  // Ômega 3
  {
    supplementName: 'Ômega 3 EPA+DHA',
    interactsWith: 'Varfarina',
    severity: 'avoid',
    description: 'Doses altas (>3g/dia) aumentam INR; risco de sangramento.',
    source: 'Mayo Clinic',
  },
  {
    supplementName: 'Ômega 3 EPA+DHA',
    interactsWith: 'Aspirina',
    severity: 'caution',
    description: 'Efeito antiplaquetário aditivo; monitorar sangramento.',
    source: 'Mayo Clinic',
  },
  {
    supplementName: 'Ômega 3 EPA+DHA',
    interactsWith: 'Clopidogrel',
    severity: 'caution',
    description: 'Antiplaquetário aditivo; cautela em cirurgias.',
    source: 'Mayo Clinic',
  },
  // Magnésio
  {
    supplementName: 'Magnésio bisglicinato',
    interactsWith: 'Bisfosfonatos',
    severity: 'caution',
    description: 'Reduz absorção; separar 2h entre tomadas.',
    source: 'BNF',
  },
  {
    supplementName: 'Magnésio bisglicinato',
    interactsWith: 'Tetraciclinas',
    severity: 'caution',
    description: 'Quelação reduz absorção do antibiótico; separar 2h.',
    source: 'BNF',
  },
  {
    supplementName: 'Magnésio bisglicinato',
    interactsWith: 'Levotiroxina',
    severity: 'caution',
    description: 'Reduz absorção; separar 4h da medicação.',
    source: 'BNF',
  },
  // Ferro
  {
    supplementName: 'Ferro quelato (bisglicinato)',
    interactsWith: 'Cálcio',
    severity: 'caution',
    description: 'Cálcio reduz absorção de ferro; separar 2h.',
    source: 'SBEM',
  },
  {
    supplementName: 'Ferro quelato (bisglicinato)',
    interactsWith: 'Café/chá',
    severity: 'caution',
    description: 'Taninos reduzem absorção; evitar 1h antes/depois.',
    source: 'SBEM',
  },
  {
    supplementName: 'Ferro quelato (bisglicinato)',
    interactsWith: 'Vitamina C',
    severity: 'info',
    description: 'Aumenta absorção de ferro não-heme; benéfico co-administrar.',
    source: 'SBEM',
  },
  {
    supplementName: 'Ferro quelato (bisglicinato)',
    interactsWith: 'Levotiroxina',
    severity: 'caution',
    description: 'Reduz absorção; separar 4h.',
    source: 'BNF',
  },
  {
    supplementName: 'Ferro quelato (bisglicinato)',
    interactsWith: 'Tetraciclinas',
    severity: 'caution',
    description: 'Quelação reduz absorção; separar 2h.',
    source: 'BNF',
  },
  // Creatina
  {
    supplementName: 'Creatina monoidratada',
    interactsWith: 'Cafeína (alta dose)',
    severity: 'info',
    description: 'Estudos antigos sugeriram antagonismo, dados atuais inconclusivos.',
    source: 'ISSN',
  },
  {
    supplementName: 'Creatina monoidratada',
    interactsWith: 'AINEs',
    severity: 'caution',
    description: 'Risco renal aditivo; cautela em uso crônico.',
    source: 'ISSN',
  },
  // Whey
  {
    supplementName: 'Whey protein isolado',
    interactsWith: 'Levodopa',
    severity: 'caution',
    description: 'Proteína em alta dose reduz absorção; separar 30min.',
    source: 'BNF',
  },
  // Probiótico
  {
    supplementName: 'Probiótico multi-cepa',
    interactsWith: 'Antibióticos sistêmicos',
    severity: 'caution',
    description: 'Tomar 2-3h após o antibiótico pra preservar viabilidade.',
    source: 'WHO',
  },
  {
    supplementName: 'Probiótico multi-cepa',
    interactsWith: 'Imunossupressores',
    severity: 'caution',
    description: 'Risco de bacteremia em pacientes imunocomprometidos.',
    source: 'WHO',
  },
  // Cálcio
  {
    supplementName: 'Cálcio citrato',
    interactsWith: 'Ferro',
    severity: 'caution',
    description: 'Reduz absorção mútua; separar 2h.',
    source: 'SBEM',
  },
  {
    supplementName: 'Cálcio citrato',
    interactsWith: 'Levotiroxina',
    severity: 'caution',
    description: 'Reduz absorção; separar 4h.',
    source: 'BNF',
  },
  {
    supplementName: 'Cálcio citrato',
    interactsWith: 'Bisfosfonatos',
    severity: 'avoid',
    description: 'Reduz absorção do bisfosfonato drasticamente; separar 2h.',
    source: 'BNF',
  },
  {
    supplementName: 'Cálcio citrato',
    interactsWith: 'Tetraciclinas',
    severity: 'caution',
    description: 'Quelação reduz absorção do antibiótico.',
    source: 'BNF',
  },
  // Multivitamínico
  {
    supplementName: 'Multivitamínico adulto',
    interactsWith: 'Varfarina',
    severity: 'caution',
    description: 'Vitamina K interna antagoniza varfarina; mantenha dose estável.',
    source: 'Mayo Clinic',
  },
  {
    supplementName: 'Multivitamínico adulto',
    interactsWith: 'Levotiroxina',
    severity: 'caution',
    description: 'Ferro + Cálcio + Mg podem reduzir absorção; separar 4h.',
    source: 'BNF',
  },
  {
    supplementName: 'Multivitamínico adulto',
    interactsWith: 'Metotrexato',
    severity: 'avoid',
    description: 'Folato em altas doses antagoniza metotrexato.',
    source: 'Mayo Clinic',
  },
  // Vitamina K (subentendida em multivitamínico)
  {
    supplementName: 'Multivitamínico adulto',
    interactsWith: 'Anticonvulsivantes',
    severity: 'info',
    description: 'Anticonvulsivantes podem reduzir níveis de vitamina D do multi.',
    source: 'BNF',
  },
  // Geral interações fitoterápicas via multi
  {
    supplementName: 'Multivitamínico adulto',
    interactsWith: 'Isotretinoína',
    severity: 'avoid',
    description: 'Aditividade de vitamina A; risco de hipervitaminose.',
    source: 'BNF',
  },
  {
    supplementName: 'Multivitamínico adulto',
    interactsWith: 'Antibióticos quinolonas',
    severity: 'caution',
    description: 'Cálcio/Mg/Fe quelam; separar 2h.',
    source: 'BNF',
  },
]

interface AnalyteSeed {
  code: string
  name: string
  category:
    | 'bioquimico'
    | 'hematologico'
    | 'hormonal'
    | 'lipidograma'
    | 'vitamina_mineral'
    | 'inflamatorio'
    | 'metabolismo_oxidativo'
    | 'imunologico'
    | 'urina'
    | 'fezes'
    | 'outro'
  unit: string
  description?: string
  /** Faixas de referência (multi por analito) */
  ranges: Array<{
    sex?: 'any' | 'male' | 'female'
    ageMin?: number
    ageMax?: number
    condition?: string
    min?: number
    max?: number
    notes?: string
    source?: string
  }>
}

const ANALYTES: AnalyteSeed[] = [
  // Bioquímicos
  {
    code: 'glicose_jejum',
    name: 'Glicose em jejum',
    category: 'bioquimico',
    unit: 'mg/dL',
    description: 'Glicemia após 8h de jejum. Diagnóstico de diabetes.',
    ranges: [
      { sex: 'any', min: 70, max: 99, notes: 'Normal', source: 'SBD 2024' },
      {
        sex: 'any',
        condition: 'gestante',
        min: 70,
        max: 92,
        notes: 'Gestante: normal ≤ 92',
        source: 'SBD 2024',
      },
    ],
  },
  {
    code: 'hba1c',
    name: 'Hemoglobina glicada (HbA1c)',
    category: 'bioquimico',
    unit: '%',
    description: 'Média glicêmica dos últimos 3 meses.',
    ranges: [{ sex: 'any', max: 5.6, notes: 'Normal < 5.7%', source: 'SBD 2024' }],
  },
  {
    code: 'creatinina',
    name: 'Creatinina sérica',
    category: 'bioquimico',
    unit: 'mg/dL',
    description: 'Função renal.',
    ranges: [
      { sex: 'male', min: 0.7, max: 1.3, source: 'SBAC' },
      { sex: 'female', min: 0.6, max: 1.1, source: 'SBAC' },
    ],
  },
  {
    code: 'ureia',
    name: 'Ureia sérica',
    category: 'bioquimico',
    unit: 'mg/dL',
    ranges: [{ sex: 'any', min: 10, max: 50, source: 'SBAC' }],
  },
  {
    code: 'acido_urico',
    name: 'Ácido úrico',
    category: 'bioquimico',
    unit: 'mg/dL',
    ranges: [
      { sex: 'male', min: 3.5, max: 7.2, source: 'SBAC' },
      { sex: 'female', min: 2.6, max: 6.0, source: 'SBAC' },
    ],
  },
  {
    code: 'ast_tgo',
    name: 'AST (TGO)',
    category: 'bioquimico',
    unit: 'U/L',
    description: 'Função hepática.',
    ranges: [{ sex: 'any', max: 35, source: 'SBH' }],
  },
  {
    code: 'alt_tgp',
    name: 'ALT (TGP)',
    category: 'bioquimico',
    unit: 'U/L',
    ranges: [{ sex: 'any', max: 35, source: 'SBH' }],
  },
  // Hematológicos
  {
    code: 'hemoglobina',
    name: 'Hemoglobina',
    category: 'hematologico',
    unit: 'g/dL',
    description: 'Anemia.',
    ranges: [
      { sex: 'male', min: 13.5, max: 17.5, source: 'OMS' },
      { sex: 'female', min: 12.0, max: 15.5, source: 'OMS' },
      { sex: 'female', condition: 'gestante', min: 11.0, max: 14.0, source: 'OMS' },
    ],
  },
  {
    code: 'hematocrito',
    name: 'Hematócrito',
    category: 'hematologico',
    unit: '%',
    ranges: [
      { sex: 'male', min: 40, max: 52, source: 'SBP' },
      { sex: 'female', min: 36, max: 48, source: 'SBP' },
    ],
  },
  {
    code: 'leucocitos',
    name: 'Leucócitos totais',
    category: 'hematologico',
    unit: '/mm³',
    ranges: [{ sex: 'any', min: 4000, max: 10000, source: 'SBP' }],
  },
  // Lipidograma
  {
    code: 'colesterol_total',
    name: 'Colesterol total',
    category: 'lipidograma',
    unit: 'mg/dL',
    ranges: [{ sex: 'any', max: 190, notes: 'Desejável < 190', source: 'SBC 2024' }],
  },
  {
    code: 'hdl',
    name: 'HDL colesterol',
    category: 'lipidograma',
    unit: 'mg/dL',
    description: 'Colesterol "bom".',
    ranges: [
      { sex: 'male', min: 40, source: 'SBC 2024' },
      { sex: 'female', min: 50, source: 'SBC 2024' },
    ],
  },
  {
    code: 'ldl',
    name: 'LDL colesterol',
    category: 'lipidograma',
    unit: 'mg/dL',
    ranges: [
      { sex: 'any', max: 130, notes: 'Desejável < 130 (varia por risco CV)', source: 'SBC 2024' },
    ],
  },
  {
    code: 'triglicerides',
    name: 'Triglicérides',
    category: 'lipidograma',
    unit: 'mg/dL',
    ranges: [{ sex: 'any', max: 150, source: 'SBC 2024' }],
  },
  // Hormonais
  {
    code: 'tsh',
    name: 'TSH (hormônio tireoestimulante)',
    category: 'hormonal',
    unit: 'µUI/mL',
    description: 'Função tireoidiana.',
    ranges: [
      { sex: 'any', min: 0.4, max: 4.5, source: 'SBEM' },
      {
        sex: 'female',
        condition: 'gestante',
        min: 0.1,
        max: 2.5,
        notes: '1º trimestre',
        source: 'SBEM',
      },
    ],
  },
  {
    code: 't4_livre',
    name: 'T4 livre',
    category: 'hormonal',
    unit: 'ng/dL',
    ranges: [{ sex: 'any', min: 0.7, max: 1.8, source: 'SBEM' }],
  },
  // Vitaminas/minerais
  {
    code: 'vitamina_d_25oh',
    name: 'Vitamina D (25-OH)',
    category: 'vitamina_mineral',
    unit: 'ng/mL',
    description: 'Status de vitamina D.',
    ranges: [
      { sex: 'any', min: 30, max: 60, notes: 'Suficiente (SBPC: ≥30)', source: 'SBPC' },
      {
        sex: 'any',
        condition: 'osteoporose',
        min: 40,
        max: 60,
        notes: 'Recomendado pra osteoporose ≥40',
        source: 'SBPC',
      },
    ],
  },
  {
    code: 'vitamina_b12',
    name: 'Vitamina B12',
    category: 'vitamina_mineral',
    unit: 'pg/mL',
    ranges: [{ sex: 'any', min: 200, max: 900, source: 'SBPC' }],
  },
  {
    code: 'ferritina',
    name: 'Ferritina',
    category: 'vitamina_mineral',
    unit: 'ng/mL',
    description: 'Estoques de ferro.',
    ranges: [
      { sex: 'male', min: 30, max: 400, source: 'SBPC' },
      { sex: 'female', min: 13, max: 150, source: 'SBPC' },
    ],
  },
  // Inflamatórios
  {
    code: 'pcr',
    name: 'Proteína C reativa (PCR ultrassensível)',
    category: 'inflamatorio',
    unit: 'mg/L',
    description: 'Marcador inflamatório / risco CV.',
    ranges: [
      {
        sex: 'any',
        max: 3.0,
        notes: 'Baixo risco CV < 1; intermediário 1-3; alto > 3',
        source: 'AHA',
      },
    ],
  },
]

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: DATABASE_URL })
  try {
    console.log(`[seed-nutri-labs] Inserindo ${SUPPLEMENTS.length} suplementos globais...`)
    const suppNameToId = new Map<string, string>()
    for (const s of SUPPLEMENTS) {
      const nameNormalized = s.name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      const r = await pool.query<{ id: string }>(
        `INSERT INTO supplements (tenant_id, name, name_normalized, kind, concentration, anvisa_registration, indication, contraindications)
         VALUES (NULL, $1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (kind, name_normalized) WHERE tenant_id IS NULL
         DO UPDATE SET concentration = EXCLUDED.concentration,
                       indication = EXCLUDED.indication,
                       contraindications = EXCLUDED.contraindications,
                       updated_at = now()
         RETURNING id`,
        [
          s.name,
          nameNormalized,
          s.kind,
          s.concentration ?? null,
          s.anvisaRegistration ?? null,
          s.indication ?? null,
          s.contraindications ?? null,
        ],
      )
      suppNameToId.set(s.name, r.rows[0]!.id)
    }
    console.log(`[seed-nutri-labs] ✅ ${SUPPLEMENTS.length} suplementos`)

    console.log(`[seed-nutri-labs] Inserindo ${INTERACTIONS.length} interações...`)
    let interactionsInserted = 0
    for (const it of INTERACTIONS) {
      const sId = suppNameToId.get(it.supplementName)
      if (!sId) {
        console.warn(
          `[seed-nutri-labs] interação pulada (sup não encontrado): ${it.supplementName}`,
        )
        continue
      }
      const interactsNormalized = it.interactsWith
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
      await pool.query(
        `INSERT INTO supplement_interactions (tenant_id, supplement_id, interacts_with, interacts_with_normalized, severity, description, source)
         VALUES (NULL, $1, $2, $3, $4, $5, $6)
         ON CONFLICT DO NOTHING`,
        [
          sId,
          it.interactsWith,
          interactsNormalized,
          it.severity,
          it.description,
          it.source ?? null,
        ],
      )
      interactionsInserted++
    }
    console.log(`[seed-nutri-labs] ✅ ${interactionsInserted} interações`)

    console.log(`[seed-nutri-labs] Inserindo ${ANALYTES.length} analitos + faixas...`)
    let rangesInserted = 0
    for (const a of ANALYTES) {
      const r = await pool.query<{ id: string }>(
        `INSERT INTO lab_analytes (code, name, category, unit, description)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description
         RETURNING id`,
        [a.code, a.name, a.category, a.unit, a.description ?? null],
      )
      const analyteId = r.rows[0]!.id
      // Limpa ranges anteriores (idempotente, idempotente, idempotente)
      await pool.query(`DELETE FROM lab_reference_ranges WHERE analyte_id = $1`, [analyteId])
      for (const rng of a.ranges) {
        await pool.query(
          `INSERT INTO lab_reference_ranges (analyte_id, sex, age_min_years, age_max_years, condition, min_value, max_value, notes, source)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            analyteId,
            rng.sex ?? 'any',
            rng.ageMin ?? null,
            rng.ageMax ?? null,
            rng.condition ?? null,
            rng.min ?? null,
            rng.max ?? null,
            rng.notes ?? null,
            rng.source ?? null,
          ],
        )
        rangesInserted++
      }
    }
    console.log(
      `[seed-nutri-labs] ✅ ${ANALYTES.length} analitos · ${rangesInserted} faixas de referência`,
    )
  } finally {
    await pool.end()
  }
}

main().catch((err) => {
  console.error('[seed-nutri-labs] Erro fatal:', err)
  process.exit(1)
})
