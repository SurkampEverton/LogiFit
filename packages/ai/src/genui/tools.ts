/**
 * Generative UI — catálogo inicial de tools.
 *   Sprint 28 Faixa B (ADR 0085).
 *
 * 6 tools canônicas que cobrem o uso clínico fisio + base pra Academia/Nutri:
 *
 *   - `genui.fisio.patient_card`       → <PatientCard />
 *   - `genui.fisio.evolution_chart`    → <EvolutionChart />
 *   - `genui.fisio.cid_suggestion`     → <CidSuggestion />
 *   - `genui.fisio.exercise_recommendation` → <ExerciseRecommendation />
 *   - `genui.geral.measurement_comparison`  → <MeasurementComparison />
 *   - `genui.geral.report_section`     → <ReportSection />
 *
 * Cada tool tem schema Zod estrito. Sprint 28b adiciona: `<WorkoutCard />`,
 * `<TrainingHistory />`, `<MealPlanCard />`, `<NutritionTable />` (depende
 * Sprint 29 nutri pra Mel + Sprint 11 workouts pra Academia).
 *
 * **Garantia regra 28** (CFM 2.454/2026): todas as tools são `readOnly: true`.
 * Mutação via GenUI é proibida em MVP — fluxos de ação continuam via
 * `proposeAction` (Sprint 06 ADR 0075).
 */
import { z } from 'zod'
import { registerUIComponent } from './registry'
import type { GenUIToolDefinition } from './types'

// ─── Schemas ────────────────────────────────────────────────────────────────

const PatientCardArgs = z.object({
  memberId: z.string().uuid(),
  /** Nome a exibir (LLM resolve do RAG/insights) */
  name: z.string().min(1).max(120),
  /** Idade pra contexto clínico (opcional pra dados faltantes) */
  age: z.number().int().min(0).max(150).optional(),
  /** Vertical principal (Academia/Fisio/Nutri/Personal) */
  vertical: z.enum(['academia', 'fisio', 'nutri', 'personal']),
  /** Status do contrato — derivado de `contracts.status` */
  contractStatus: z.enum(['active', 'paused', 'cancelled', 'expired']).optional(),
  /** Última visita (ISO date) — opcional */
  lastVisitAt: z.string().datetime().nullable().optional(),
  /** Riscos ativos resumidos (max 3 pra UI compacta) */
  activeRisks: z.array(z.string().max(80)).max(3).optional(),
})

const EvolutionChartArgs = z.object({
  memberId: z.string().uuid(),
  /** Métrica que será plotada (ex: 'peso', 'IMC', 'EVA dor', '% gordura') */
  metric: z.string().min(1).max(60),
  /** Unidade pra eixo Y (ex: 'kg', '%') */
  unit: z.string().max(20).optional(),
  /** Pontos cronológicos (mín 2 pra fazer sentido como evolução) */
  points: z
    .array(
      z.object({
        at: z.string().datetime(),
        value: z.number(),
      }),
    )
    .min(2)
    .max(60),
  /** Faixa de referência opcional (ex: IMC saudável 18.5-24.9) */
  referenceRange: z
    .object({
      min: z.number(),
      max: z.number(),
      label: z.string().max(60).optional(),
    })
    .nullable()
    .optional(),
})

const CidSuggestionArgs = z.object({
  /** Lista de CIDs sugeridos pelo LLM com base no contexto clínico */
  cids: z
    .array(
      z.object({
        code: z.string().min(1).max(20),
        description: z.string().min(1).max(300),
        /** Probabilidade do LLM (0..1) — usado pra ranking visual */
        confidence: z.number().min(0).max(1),
        /** Justificativa (curta) pra apoio ao profissional */
        rationale: z.string().min(1).max(500),
      }),
    )
    .min(1)
    .max(5),
  /** Se UI permitir, link pro consulta-target onde adicionar o CID escolhido */
  targetConsultaId: z.string().uuid().nullable().optional(),
})

const ExerciseRecommendationArgs = z.object({
  /** Contexto do alvo (ex: "reabilitação lombar D+15", "manutenção atlética") */
  goal: z.string().min(1).max(120),
  exercises: z
    .array(
      z.object({
        exerciseId: z.string().uuid(),
        name: z.string().min(1).max(120),
        muscleGroups: z.array(z.string().max(40)).max(8),
        /** Severidade (avoid/modify/caution) ou null = livre — link com ADR 0084 */
        contraindicationFlag: z.enum(['avoid', 'modify', 'caution']).nullable().optional(),
        sets: z.number().int().min(1).max(12).optional(),
        reps: z.string().min(1).max(20).optional(),
        rationale: z.string().min(1).max(300),
      }),
    )
    .min(1)
    .max(8),
})

const MeasurementComparisonArgs = z.object({
  /** Member focado */
  memberId: z.string().uuid(),
  /** Métricas comparadas (ex: "Peso", "Cintura", "IMC") */
  metrics: z
    .array(
      z.object({
        name: z.string().min(1).max(60),
        unit: z.string().max(20).optional(),
        before: z.number(),
        after: z.number(),
        /** Direção esperada pra cor (positivo verde, negativo vermelho) */
        desiredDirection: z.enum(['lower', 'higher', 'stable']),
      }),
    )
    .min(1)
    .max(8),
  /** Datas das medições */
  beforeAt: z.string().datetime(),
  afterAt: z.string().datetime(),
})

const ReportSectionArgs = z.object({
  /** Título do bloco (ex: "Anamnese", "Plano terapêutico", "Próximos passos") */
  title: z.string().min(1).max(120),
  /** Markdown leve permitido (apenas **bold**, *italic*, listas) — sem HTML */
  body: z.string().min(1).max(4000),
  /** Tom pra cor de borda (info/atencao/sucesso/risco) */
  tone: z.enum(['info', 'success', 'warning', 'danger']).default('info'),
})

// ─── Definições ─────────────────────────────────────────────────────────────

export const PATIENT_CARD_TOOL: GenUIToolDefinition<z.infer<typeof PatientCardArgs>> = {
  name: 'genui.fisio.patient_card',
  description:
    'Renderiza card resumido do paciente (nome, idade, vertical, status do contrato, riscos ativos). Use em respostas que precisam ancorar o contexto do paciente antes de detalhes clínicos.',
  argsSchema: PatientCardArgs,
  category: 'clinico',
  allowedPersonas: ['professional_clinical', 'professional_coach', 'admin'],
  readOnly: true,
  example: {
    args: {
      memberId: '00000000-0000-0000-0000-000000000001',
      name: 'Marcelo Silva',
      age: 42,
      vertical: 'fisio',
      contractStatus: 'active',
      lastVisitAt: '2026-05-10T14:30:00Z',
      activeRisks: ['lombalgia crônica', 'risco médio churn'],
    },
    description: 'Card de paciente em risco com lombalgia.',
  },
}

export const EVOLUTION_CHART_TOOL: GenUIToolDefinition<z.infer<typeof EvolutionChartArgs>> = {
  name: 'genui.fisio.evolution_chart',
  description:
    'Renderiza gráfico de evolução de uma métrica (peso, IMC, EVA dor, % gordura) ao longo do tempo. Use quando o usuário pergunta "como evoluiu X" ou ao gerar relatórios.',
  argsSchema: EvolutionChartArgs,
  category: 'clinico',
  allowedPersonas: ['professional_clinical', 'professional_coach', 'admin'],
  readOnly: true,
}

export const CID_SUGGESTION_TOOL: GenUIToolDefinition<z.infer<typeof CidSuggestionArgs>> = {
  name: 'genui.fisio.cid_suggestion',
  description:
    'Sugere CIDs prováveis com base no contexto clínico. Cada item tem código, descrição, confidence (0..1) e rationale. **Apoio ao profissional — nunca diagnóstico definitivo** (regra 28 CFM 2.454/2026).',
  argsSchema: CidSuggestionArgs,
  category: 'clinico',
  allowedPersonas: ['professional_clinical'],
  readOnly: true,
}

export const EXERCISE_RECOMMENDATION_TOOL: GenUIToolDefinition<
  z.infer<typeof ExerciseRecommendationArgs>
> = {
  name: 'genui.fisio.exercise_recommendation',
  description:
    'Lista exercícios recomendados pra um objetivo terapêutico/treino. Cada item pode trazer flag de contraindicação (avoid/modify/caution) ligado a ADR 0084.',
  argsSchema: ExerciseRecommendationArgs,
  category: 'academia',
  allowedPersonas: ['professional_clinical', 'professional_coach'],
  readOnly: true,
}

export const MEASUREMENT_COMPARISON_TOOL: GenUIToolDefinition<
  z.infer<typeof MeasurementComparisonArgs>
> = {
  name: 'genui.geral.measurement_comparison',
  description:
    'Compara medições (peso, cintura, IMC, etc.) entre duas datas. Mostra delta absoluto, percentual e direção desejada (verde/vermelho).',
  argsSchema: MeasurementComparisonArgs,
  category: 'geral',
  allowedPersonas: ['professional_clinical', 'professional_coach', 'admin'],
  readOnly: true,
}

export const REPORT_SECTION_TOOL: GenUIToolDefinition<z.infer<typeof ReportSectionArgs>> = {
  name: 'genui.geral.report_section',
  description:
    'Bloco de texto formatado (markdown leve) com título e tom. Use pra estruturar relatórios em seções (anamnese, plano, observações).',
  argsSchema: ReportSectionArgs,
  category: 'geral',
  allowedPersonas: ['professional_clinical', 'professional_coach', 'admin'],
  readOnly: true,
}

export const GENUI_DEFAULT_TOOLS = [
  PATIENT_CARD_TOOL,
  EVOLUTION_CHART_TOOL,
  CID_SUGGESTION_TOOL,
  EXERCISE_RECOMMENDATION_TOOL,
  MEASUREMENT_COMPARISON_TOOL,
  REPORT_SECTION_TOOL,
] as const

/**
 * Boot do registry — chamado uma vez em `packages/ai/src/index.ts` ou na
 * inicialização do app. Idempotente.
 */
export function registerDefaultGenUITools(): void {
  for (const tool of GENUI_DEFAULT_TOOLS) {
    registerUIComponent(tool as GenUIToolDefinition<unknown>)
  }
}
