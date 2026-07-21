/**
 * Cross-alert lesão — detector de contraindicações.
 *   Sprint 27 Faixa B.1 (ADR 0084).
 *
 * Função pura `detectContraindications(activeCids, workoutItems, contraIndex)`:
 * dado um conjunto de CIDs ativos do paciente + items da ficha atual + índice
 * de contraindicações vigentes (global + tenant), retorna lista de items que
 * precisam ser adaptados, com severidade e sugestões.
 *
 * **3 critérios de match** (ordem de precedência):
 *   1. exercise_id direto (mais preciso)
 *   2. movement_pattern (exercises.metadata.movement_patterns @> [pattern])
 *   3. muscle_group (exercises.muscle_groups @> [group])
 *
 * **Severidade agregada** quando múltiplas regras matcham o mesmo item:
 *   `avoid` > `modify` > `caution`. Pega a mais restritiva.
 */

export type ContraindicationSeverity = 'avoid' | 'modify' | 'caution'

export interface ContraindicationRule {
  id: string
  cidCode: string
  exerciseId: string | null
  muscleGroup: string | null
  movementPattern: string | null
  severity: ContraindicationSeverity
  alternativeExerciseIds: string[]
  rationale: string | null
  source: string | null
}

export interface ExerciseInfo {
  id: string
  name: string
  muscleGroups: string[]
  /** Sprint 27b: campo enriquecido em exercises.metadata; MVP usa fallback vazio */
  movementPatterns?: string[]
}

export interface WorkoutItemInput {
  itemId: string
  exerciseId: string
  exerciseInfo: ExerciseInfo
  /** Order dentro do workout — usado no diff de output */
  order: number
}

export interface ContraindicationMatch {
  itemId: string
  exerciseId: string
  exerciseName: string
  severity: ContraindicationSeverity
  /** Regras que matcharam (1+) */
  rules: Array<{
    ruleId: string
    cidCode: string
    matchedBy: 'exercise_id' | 'movement_pattern' | 'muscle_group'
    severity: ContraindicationSeverity
    rationale: string | null
  }>
  alternativeExerciseIds: string[]
}

export interface DetectionResult {
  matches: ContraindicationMatch[]
  /** Severity counts pra ranking de urgência */
  avoidCount: number
  modifyCount: number
  cautionCount: number
}

// ─── Severity helpers ─────────────────────────────────────────────────────

const SEVERITY_RANK: Record<ContraindicationSeverity, number> = {
  avoid: 3,
  modify: 2,
  caution: 1,
}

/**
 * Retorna a severidade mais restritiva entre duas.
 */
export function maxSeverity(
  a: ContraindicationSeverity,
  b: ContraindicationSeverity,
): ContraindicationSeverity {
  return SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b
}

// ─── Matcher principal ─────────────────────────────────────────────────────

/**
 * Detecta contraindicações entre CIDs ativos e items da ficha.
 *
 * @param activeCids CIDs ativos do paciente (de consultas signed recentes)
 * @param workoutItems items da ficha atual (workout_items + exercise info)
 * @param rules regras vigentes (global + tenant override merge)
 */
export function detectContraindications(
  activeCids: string[],
  workoutItems: WorkoutItemInput[],
  rules: ContraindicationRule[],
): DetectionResult {
  // Index de regras por CID
  const rulesByCid = new Map<string, ContraindicationRule[]>()
  for (const r of rules) {
    if (!activeCids.includes(r.cidCode)) continue
    const arr = rulesByCid.get(r.cidCode) ?? []
    arr.push(r)
    rulesByCid.set(r.cidCode, arr)
  }

  const matchesByItem = new Map<string, ContraindicationMatch>()

  for (const item of workoutItems) {
    for (const cid of activeCids) {
      const cidRules = rulesByCid.get(cid) ?? []
      for (const r of cidRules) {
        const matchedBy = matchRule(item, r)
        if (!matchedBy) continue

        let existing = matchesByItem.get(item.itemId)
        if (!existing) {
          existing = {
            itemId: item.itemId,
            exerciseId: item.exerciseId,
            exerciseName: item.exerciseInfo.name,
            severity: r.severity,
            rules: [],
            alternativeExerciseIds: [],
          }
          matchesByItem.set(item.itemId, existing)
        }

        existing.severity = maxSeverity(existing.severity, r.severity)
        existing.rules.push({
          ruleId: r.id,
          cidCode: r.cidCode,
          matchedBy,
          severity: r.severity,
          rationale: r.rationale,
        })
        // Merge alternativas (sem duplicar)
        for (const altId of r.alternativeExerciseIds) {
          if (!existing.alternativeExerciseIds.includes(altId)) {
            existing.alternativeExerciseIds.push(altId)
          }
        }
      }
    }
  }

  const matches = Array.from(matchesByItem.values())
  return {
    matches,
    avoidCount: matches.filter((m) => m.severity === 'avoid').length,
    modifyCount: matches.filter((m) => m.severity === 'modify').length,
    cautionCount: matches.filter((m) => m.severity === 'caution').length,
  }
}

/**
 * Verifica se uma regra matcha um item específico (precedência: exercise > pattern > group).
 * Retorna o tipo de match ou null.
 */
function matchRule(
  item: WorkoutItemInput,
  rule: ContraindicationRule,
): ContraindicationMatch['rules'][number]['matchedBy'] | null {
  if (rule.exerciseId && rule.exerciseId === item.exerciseId) {
    return 'exercise_id'
  }
  if (rule.movementPattern && item.exerciseInfo.movementPatterns?.includes(rule.movementPattern)) {
    return 'movement_pattern'
  }
  if (rule.muscleGroup && item.exerciseInfo.muscleGroups.includes(rule.muscleGroup)) {
    return 'muscle_group'
  }
  return null
}

// ─── Merge global + tenant override ───────────────────────────────────────

/**
 * Quando o tenant tem override pro mesmo (cid_code + alvo), tenant prevalece.
 * MVP: dedup baseado em chave canônica `cidCode|exerciseId|muscleGroup|movementPattern`.
 * Tenant rules vêm com `_tenantSource=true` (interno) pra dedup priorizar.
 */
export interface ContraindicationRuleSourced extends ContraindicationRule {
  isGlobal: boolean
}

export function mergeRules(
  globalRules: ContraindicationRuleSourced[],
  tenantRules: ContraindicationRuleSourced[],
): ContraindicationRule[] {
  const byKey = new Map<string, ContraindicationRuleSourced>()
  for (const r of globalRules) {
    byKey.set(ruleKey(r), r)
  }
  // Tenant overrides global
  for (const r of tenantRules) {
    byKey.set(ruleKey(r), r)
  }
  return Array.from(byKey.values())
}

function ruleKey(r: ContraindicationRuleSourced): string {
  return [r.cidCode, r.exerciseId ?? '', r.muscleGroup ?? '', r.movementPattern ?? ''].join('|')
}

// ─── Diff: builder de `workout_adaptations.changes` ───────────────────────

export interface AdaptationDiffInput {
  matches: ContraindicationMatch[]
  /** Lookup de exercise id → info pra preencher rationales legíveis */
  exerciseLookup: Map<string, ExerciseInfo>
}

export interface AdaptationDiff {
  removed: Array<{ itemId: string; exerciseId: string; exerciseName: string; reason: string }>
  replaced: Array<{
    fromItemId: string
    fromExerciseId: string
    toExerciseId: string
    toExerciseName: string
    rationale: string
  }>
  added: Array<{
    exerciseId: string
    exerciseName: string
    sets: number
    reps: string
    rationale: string
  }>
  summary: string
}

/**
 * Constrói o diff jsonb que será gravado em `workout_adaptations.changes`.
 * Regra:
 *   - severity='avoid' + tem alternativa → replaced
 *   - severity='avoid' + sem alternativa → removed
 *   - severity='modify' + tem alternativa → replaced
 *   - severity='modify' + sem alternativa → mantém com warning (não vira diff)
 *   - severity='caution' → mantém com warning (instrutor avalia)
 */
export function buildAdaptationDiff(input: AdaptationDiffInput): AdaptationDiff {
  const removed: AdaptationDiff['removed'] = []
  const replaced: AdaptationDiff['replaced'] = []
  const summaryParts: string[] = []

  for (const m of input.matches) {
    const cidList = m.rules.map((r) => r.cidCode).join(', ')
    const reason = `${cidList} ${m.severity} (${
      m.rules
        .map((r) => r.rationale)
        .filter(Boolean)
        .join('; ') || 'curadoria LogiFit'
    })`

    if (m.severity === 'avoid' || m.severity === 'modify') {
      if (m.alternativeExerciseIds.length > 0) {
        const toId = m.alternativeExerciseIds[0]!
        const toInfo = input.exerciseLookup.get(toId)
        replaced.push({
          fromItemId: m.itemId,
          fromExerciseId: m.exerciseId,
          toExerciseId: toId,
          toExerciseName: toInfo?.name ?? 'Exercício alternativo',
          rationale: reason,
        })
        summaryParts.push(
          `Substituído ${m.exerciseName} → ${toInfo?.name ?? toId.slice(0, 6)} (${cidList} ${m.severity})`,
        )
      } else if (m.severity === 'avoid') {
        removed.push({
          itemId: m.itemId,
          exerciseId: m.exerciseId,
          exerciseName: m.exerciseName,
          reason,
        })
        summaryParts.push(
          `Removido ${m.exerciseName} (${cidList} avoid, sem alternativa cadastrada)`,
        )
      }
    }
    // caution: instrutor avalia em loco; não entra no diff
  }

  return {
    removed,
    replaced,
    added: [], // Sprint 27b: heurística sugere exercises adicionais pra cobrir grupo muscular afetado
    summary: summaryParts.join('. '),
  }
}
