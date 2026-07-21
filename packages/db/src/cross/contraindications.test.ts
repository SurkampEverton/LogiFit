/**
 * detectContraindications + buildAdaptationDiff — Sprint 27 Faixa B.1 unit tests.
 */
import { describe, expect, it } from 'vitest'
import {
  type ContraindicationRule,
  type ContraindicationRuleSourced,
  type ExerciseInfo,
  type WorkoutItemInput,
  buildAdaptationDiff,
  detectContraindications,
  maxSeverity,
  mergeRules,
} from './contraindications'

function ex(
  id: string,
  name: string,
  muscleGroups: string[],
  patterns: string[] = [],
): ExerciseInfo {
  return { id, name, muscleGroups, movementPatterns: patterns }
}

function item(itemId: string, exerciseInfo: ExerciseInfo, order = 1): WorkoutItemInput {
  return { itemId, exerciseId: exerciseInfo.id, exerciseInfo, order }
}

function rule(
  id: string,
  cidCode: string,
  overrides: Partial<Omit<ContraindicationRule, 'id' | 'cidCode'>> = {},
): ContraindicationRule {
  return {
    id,
    cidCode,
    exerciseId: null,
    muscleGroup: null,
    movementPattern: null,
    severity: 'modify',
    alternativeExerciseIds: [],
    rationale: null,
    source: null,
    ...overrides,
  }
}

describe('maxSeverity', () => {
  it('avoid > modify > caution', () => {
    expect(maxSeverity('avoid', 'caution')).toBe('avoid')
    expect(maxSeverity('modify', 'caution')).toBe('modify')
    expect(maxSeverity('caution', 'caution')).toBe('caution')
    expect(maxSeverity('modify', 'avoid')).toBe('avoid')
  })
})

describe('detectContraindications', () => {
  it('sem CIDs ativos → zero matches', () => {
    const items = [item('i1', ex('e1', 'Agachamento', ['quadriceps', 'lombar']))]
    const rules = [rule('r1', 'MG30.0', { muscleGroup: 'lombar', severity: 'avoid' })]
    const r = detectContraindications([], items, rules)
    expect(r.matches).toHaveLength(0)
  })

  it('match por exercise_id direto', () => {
    const items = [item('i1', ex('e1', 'Agachamento', ['quadriceps']))]
    const rules = [
      rule('r1', 'MG30.0', { exerciseId: 'e1', severity: 'avoid', rationale: 'Carga axial' }),
    ]
    const r = detectContraindications(['MG30.0'], items, rules)
    expect(r.matches).toHaveLength(1)
    expect(r.matches[0]!.severity).toBe('avoid')
    expect(r.matches[0]!.rules[0]!.matchedBy).toBe('exercise_id')
  })

  it('match por muscle_group', () => {
    const items = [item('i1', ex('e1', 'Agachamento', ['lombar', 'quadriceps']))]
    const rules = [rule('r1', 'MG30.0', { muscleGroup: 'lombar', severity: 'modify' })]
    const r = detectContraindications(['MG30.0'], items, rules)
    expect(r.matches).toHaveLength(1)
    expect(r.matches[0]!.rules[0]!.matchedBy).toBe('muscle_group')
  })

  it('match por movement_pattern', () => {
    const items = [item('i1', ex('e1', 'Stiff', ['lombar', 'posterior'], ['flexao_lombar_carga']))]
    const rules = [
      rule('r1', 'MG30.0', {
        movementPattern: 'flexao_lombar_carga',
        severity: 'avoid',
      }),
    ]
    const r = detectContraindications(['MG30.0'], items, rules)
    expect(r.matches).toHaveLength(1)
    expect(r.matches[0]!.rules[0]!.matchedBy).toBe('movement_pattern')
  })

  it('sem match → ignora item', () => {
    const items = [item('i1', ex('e1', 'Supino', ['peitoral']))]
    const rules = [rule('r1', 'MG30.0', { muscleGroup: 'lombar' })]
    const r = detectContraindications(['MG30.0'], items, rules)
    expect(r.matches).toHaveLength(0)
  })

  it('múltiplas regras matcham → severidade agregada (max)', () => {
    const items = [item('i1', ex('e1', 'Agachamento', ['lombar', 'quadriceps']))]
    const rules = [
      rule('r1', 'MG30.0', { muscleGroup: 'lombar', severity: 'caution' }),
      rule('r2', 'MG30.0', { exerciseId: 'e1', severity: 'avoid' }),
    ]
    const r = detectContraindications(['MG30.0'], items, rules)
    expect(r.matches).toHaveLength(1)
    expect(r.matches[0]!.severity).toBe('avoid')
    expect(r.matches[0]!.rules).toHaveLength(2)
  })

  it('múltiplos CIDs ativos → agrega ambos', () => {
    const items = [item('i1', ex('e1', 'Agachamento', ['lombar', 'joelho']))]
    const rules = [
      rule('r1', 'MG30.0', { muscleGroup: 'lombar', severity: 'modify' }),
      rule('r2', 'S83.5', { muscleGroup: 'joelho', severity: 'avoid' }),
    ]
    const r = detectContraindications(['MG30.0', 'S83.5'], items, rules)
    expect(r.matches).toHaveLength(1)
    expect(r.matches[0]!.severity).toBe('avoid')
    expect(r.matches[0]!.rules.map((rr) => rr.cidCode).sort()).toEqual(['MG30.0', 'S83.5'])
  })

  it('counts por severidade', () => {
    const items = [
      item('i1', ex('e1', 'Agachamento', ['lombar']), 1),
      item('i2', ex('e2', 'Stiff', ['lombar']), 2),
      item('i3', ex('e3', 'Leg Press', ['quadriceps']), 3),
    ]
    const rules = [
      rule('r1', 'MG30.0', { muscleGroup: 'lombar', severity: 'avoid' }),
      rule('r2', 'MG30.0', { muscleGroup: 'quadriceps', severity: 'caution' }),
    ]
    const r = detectContraindications(['MG30.0'], items, rules)
    expect(r.avoidCount).toBe(2)
    expect(r.cautionCount).toBe(1)
    expect(r.modifyCount).toBe(0)
  })

  it('alternative_exercise_ids agregado (sem duplicar)', () => {
    const items = [item('i1', ex('e1', 'Agachamento', ['lombar']))]
    const rules = [
      rule('r1', 'MG30.0', {
        muscleGroup: 'lombar',
        severity: 'avoid',
        alternativeExerciseIds: ['alt1', 'alt2'],
      }),
      rule('r2', 'MG30.0', {
        exerciseId: 'e1',
        severity: 'modify',
        alternativeExerciseIds: ['alt2', 'alt3'],
      }),
    ]
    const r = detectContraindications(['MG30.0'], items, rules)
    expect(r.matches[0]!.alternativeExerciseIds).toEqual(['alt1', 'alt2', 'alt3'])
  })
})

describe('mergeRules — tenant override > global', () => {
  function srcRule(
    id: string,
    cidCode: string,
    isGlobal: boolean,
    severity: 'avoid' | 'modify' | 'caution' = 'caution',
    muscleGroup: string | null = 'lombar',
  ): ContraindicationRuleSourced {
    return {
      id,
      cidCode,
      isGlobal,
      exerciseId: null,
      muscleGroup,
      movementPattern: null,
      severity,
      alternativeExerciseIds: [],
      rationale: isGlobal ? 'curadoria global' : 'override tenant',
      source: null,
    }
  }

  it('tenant override prevalece sobre global (mesma chave)', () => {
    const globals = [srcRule('g1', 'MG30.0', true, 'caution', 'lombar')]
    const tenants = [srcRule('t1', 'MG30.0', false, 'avoid', 'lombar')]
    const merged = mergeRules(globals, tenants)
    expect(merged).toHaveLength(1)
    expect(merged[0]!.severity).toBe('avoid')
    expect(merged[0]!.rationale).toBe('override tenant')
  })

  it('chaves distintas convivem', () => {
    const globals = [srcRule('g1', 'MG30.0', true, 'caution', 'lombar')]
    const tenants = [srcRule('t1', 'MG30.0', false, 'avoid', 'joelho')]
    const merged = mergeRules(globals, tenants)
    expect(merged).toHaveLength(2)
  })
})

describe('buildAdaptationDiff', () => {
  it('avoid com alternativa → replaced', () => {
    const lookup = new Map<string, ExerciseInfo>([
      ['alt1', ex('alt1', 'Leg Press 45', ['quadriceps'])],
    ])
    const diff = buildAdaptationDiff({
      matches: [
        {
          itemId: 'i1',
          exerciseId: 'e1',
          exerciseName: 'Agachamento Livre',
          severity: 'avoid',
          rules: [
            {
              ruleId: 'r1',
              cidCode: 'MG30.0',
              matchedBy: 'exercise_id',
              severity: 'avoid',
              rationale: 'Carga axial alta',
            },
          ],
          alternativeExerciseIds: ['alt1'],
        },
      ],
      exerciseLookup: lookup,
    })
    expect(diff.replaced).toHaveLength(1)
    expect(diff.removed).toHaveLength(0)
    expect(diff.replaced[0]!.toExerciseName).toBe('Leg Press 45')
    expect(diff.summary).toContain('Substituído')
  })

  it('avoid sem alternativa → removed', () => {
    const diff = buildAdaptationDiff({
      matches: [
        {
          itemId: 'i1',
          exerciseId: 'e1',
          exerciseName: 'Levantamento Terra',
          severity: 'avoid',
          rules: [
            {
              ruleId: 'r1',
              cidCode: 'M51.1',
              matchedBy: 'muscle_group',
              severity: 'avoid',
              rationale: 'Hérnia L4-L5',
            },
          ],
          alternativeExerciseIds: [],
        },
      ],
      exerciseLookup: new Map(),
    })
    expect(diff.removed).toHaveLength(1)
    expect(diff.replaced).toHaveLength(0)
    expect(diff.summary).toContain('Removido')
  })

  it('caution não vira diff (instrutor avalia em loco)', () => {
    const diff = buildAdaptationDiff({
      matches: [
        {
          itemId: 'i1',
          exerciseId: 'e1',
          exerciseName: 'Remada',
          severity: 'caution',
          rules: [
            {
              ruleId: 'r1',
              cidCode: 'M75.1',
              matchedBy: 'muscle_group',
              severity: 'caution',
              rationale: null,
            },
          ],
          alternativeExerciseIds: [],
        },
      ],
      exerciseLookup: new Map(),
    })
    expect(diff.removed).toHaveLength(0)
    expect(diff.replaced).toHaveLength(0)
    expect(diff.summary).toBe('')
  })

  it('modify com alternativa → replaced', () => {
    const lookup = new Map<string, ExerciseInfo>([
      ['alt1', ex('alt1', 'Máquina guiada', ['quadriceps'])],
    ])
    const diff = buildAdaptationDiff({
      matches: [
        {
          itemId: 'i1',
          exerciseId: 'e1',
          exerciseName: 'Agachamento Livre',
          severity: 'modify',
          rules: [
            {
              ruleId: 'r1',
              cidCode: 'M54.5',
              matchedBy: 'movement_pattern',
              severity: 'modify',
              rationale: 'Reduzir carga axial',
            },
          ],
          alternativeExerciseIds: ['alt1'],
        },
      ],
      exerciseLookup: lookup,
    })
    expect(diff.replaced).toHaveLength(1)
  })

  it('modify sem alternativa → não muda (instrutor decide)', () => {
    const diff = buildAdaptationDiff({
      matches: [
        {
          itemId: 'i1',
          exerciseId: 'e1',
          exerciseName: 'Supino',
          severity: 'modify',
          rules: [
            {
              ruleId: 'r1',
              cidCode: 'M75.1',
              matchedBy: 'muscle_group',
              severity: 'modify',
              rationale: null,
            },
          ],
          alternativeExerciseIds: [],
        },
      ],
      exerciseLookup: new Map(),
    })
    expect(diff.removed).toHaveLength(0)
    expect(diff.replaced).toHaveLength(0)
  })
})
