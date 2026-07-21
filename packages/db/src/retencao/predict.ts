/**
 * Predição de churn — Sprint 19 Faixa B.1 (ADR 0027 Fase 1).
 *
 * Função PURA: recebe features + opcionalmente "LLM callback" + retorna predição.
 * Server Action consome — testa lib sem mockar Vercel AI SDK.
 *
 * **Estratégia:**
 *   1. Tenta classifier LLM se callback fornecido (Sprint 06 + ADR 0064 task='classification')
 *   2. Fallback heurístico determinístico — sempre disponível
 *
 * **Heurística (fallback + cold start):**
 *   - Pontos por sinal: dias sem check-in (40%), variação frequência (30%),
 *     overdue invoices (20%), downgrade recente (10%)
 *   - Cap [0, 1]; probs 60d/90d são extrapolação suave da 30d
 *
 * **Output schema** garantido por Zod:
 *   - prob_30d/60d/90d ∈ [0, 1]
 *   - riskBand derivado (<0.3 low, <0.6 medium, else high)
 *   - topFactors[] com 3-5 entradas { factor, weight, narrative }
 */
import { z } from 'zod'
import type { ChurnFeatures } from './features'

// ─── Output Zod schema ───────────────────────────────────────────────────

export const ChurnPredictionSchema = z.object({
  prob30d: z.number().min(0).max(1),
  prob60d: z.number().min(0).max(1),
  prob90d: z.number().min(0).max(1),
  riskBand: z.enum(['low', 'medium', 'high']),
  topFactors: z
    .array(
      z.object({
        factor: z.string(),
        weight: z.number().min(0).max(1),
        narrative: z.string(),
      }),
    )
    .min(1)
    .max(8),
  source: z.enum(['llm', 'heuristic']),
})

export type ChurnPrediction = z.infer<typeof ChurnPredictionSchema>

export type LlmClassifyFn = (
  features: ChurnFeatures,
) => Promise<Pick<ChurnPrediction, 'prob30d' | 'prob60d' | 'prob90d' | 'topFactors'>>

/**
 * Função principal — chama LLM se disponível, senão heurística.
 *
 * Validação Zod no output do LLM: se falhar, cai pra heurística (regra de
 * defesa em profundidade — ADR 0064).
 */
export async function predictChurn(
  features: ChurnFeatures,
  llmClassify?: LlmClassifyFn,
): Promise<ChurnPrediction> {
  if (llmClassify) {
    try {
      const llmResult = await llmClassify(features)
      const validated = ChurnPredictionSchema.parse({
        ...llmResult,
        riskBand: bandFromProb(llmResult.prob30d),
        source: 'llm' as const,
      })
      return validated
    } catch {
      // Fallback silencioso pra heurística — caller pode logar via wrapper
    }
  }
  return heuristicPredict(features)
}

// ─── Heurística determinística ───────────────────────────────────────────

export function heuristicPredict(features: ChurnFeatures): ChurnPrediction {
  const factors: Array<{ factor: string; weight: number; narrative: string }> = []
  let score = 0

  // 1. Dias sem check-in (peso 0.40) — academia que para de ir cancela
  if (features.daysSinceLastCheckin < 0) {
    // Nunca checou — member novo ou inativo
    if (features.monthsAsMember >= 2) {
      score += 0.4
      factors.push({
        factor: 'never_checkin',
        weight: 0.4,
        narrative: `Member há ${features.monthsAsMember} meses sem nenhum check-in registrado`,
      })
    }
  } else if (features.daysSinceLastCheckin >= 30) {
    score += 0.4
    factors.push({
      factor: 'long_absence',
      weight: 0.4,
      narrative: `${features.daysSinceLastCheckin} dias sem aparecer na unidade`,
    })
  } else if (features.daysSinceLastCheckin >= 14) {
    score += 0.25
    factors.push({
      factor: 'absence',
      weight: 0.25,
      narrative: `${features.daysSinceLastCheckin} dias sem check-in — risco de descontinuar`,
    })
  } else if (features.daysSinceLastCheckin >= 7) {
    score += 0.1
    factors.push({
      factor: 'mild_absence',
      weight: 0.1,
      narrative: `${features.daysSinceLastCheckin} dias sem check-in — atenção`,
    })
  }

  // 2. Variação frequência (peso 0.30)
  if (features.frequencyChangePct <= -50) {
    score += 0.3
    factors.push({
      factor: 'frequency_drop',
      weight: 0.3,
      narrative: `Frequência caiu ${Math.abs(features.frequencyChangePct).toFixed(0)}% vs período anterior`,
    })
  } else if (features.frequencyChangePct <= -25) {
    score += 0.15
    factors.push({
      factor: 'frequency_drop_mild',
      weight: 0.15,
      narrative: `Frequência caiu ${Math.abs(features.frequencyChangePct).toFixed(0)}% vs período anterior`,
    })
  }

  // 3. Overdue (peso 0.20)
  if (features.overdueInvoicesCount >= 2) {
    score += 0.2
    factors.push({
      factor: 'multiple_overdue',
      weight: 0.2,
      narrative: `${features.overdueInvoicesCount} faturas em atraso (total R$ ${(features.overdueTotalCents / 100).toFixed(2)})`,
    })
  } else if (features.overdueInvoicesCount === 1) {
    score += 0.1
    factors.push({
      factor: 'single_overdue',
      weight: 0.1,
      narrative: `1 fatura em atraso (R$ ${(features.overdueTotalCents / 100).toFixed(2)})`,
    })
  }

  // 4. Downgrade recente (peso 0.10)
  if (features.planChangedDowngrade) {
    score += 0.1
    factors.push({
      factor: 'plan_downgrade',
      weight: 0.1,
      narrative: 'Downgrade de plano recente — indício de aperto financeiro',
    })
  }

  // Atenuadores
  if (features.achievementsEarned90d >= 3 || features.goalsActiveCount >= 2) {
    const protect = Math.min(
      0.15,
      features.achievementsEarned90d * 0.03 + features.goalsActiveCount * 0.05,
    )
    score = Math.max(0, score - protect)
    factors.push({
      factor: 'engagement_active',
      weight: -protect,
      narrative: `${features.achievementsEarned90d} conquistas + ${features.goalsActiveCount} metas ativas (proteção)`,
    })
  }
  if (features.monthsAsMember >= 12) {
    // Loyalty buff: -0.05 (mas só se score > 0.15)
    if (score > 0.15) {
      score -= 0.05
      factors.push({
        factor: 'loyalty',
        weight: -0.05,
        narrative: `Member há ${features.monthsAsMember} meses — fidelidade pesa contra cancelamento imediato`,
      })
    }
  }

  // Clamp final
  const prob30d = Math.max(0, Math.min(1, score))
  // Extrapolação suave: 60d ~ 30d × 1.25, 90d ~ 30d × 1.45 (cap 1)
  const prob60d = Math.max(prob30d, Math.min(1, prob30d * 1.25))
  const prob90d = Math.max(prob60d, Math.min(1, prob30d * 1.45))

  // Garante pelo menos 1 factor (Zod min(1))
  if (factors.length === 0) {
    factors.push({
      factor: 'baseline',
      weight: 0,
      narrative: 'Sem sinais de risco identificados — member estável',
    })
  }

  return {
    prob30d: Number(prob30d.toFixed(3)),
    prob60d: Number(prob60d.toFixed(3)),
    prob90d: Number(prob90d.toFixed(3)),
    riskBand: bandFromProb(prob30d),
    topFactors: factors.slice(0, 5),
    source: 'heuristic',
  }
}

export function bandFromProb(prob: number): 'low' | 'medium' | 'high' {
  if (prob < 0.3) return 'low'
  if (prob < 0.6) return 'medium'
  return 'high'
}
