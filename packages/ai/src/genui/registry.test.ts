/**
 * GenUI registry — unit tests Sprint 28 Faixa B.1.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  clearRegistry,
  getRegisteredTools,
  getToolDefinition,
  getToolsForPersona,
  registerUIComponent,
  validateToolCall,
} from './registry'
import { registerDefaultGenUITools } from './tools'
import type { GenUIToolDefinition } from './types'

function makeTool<TArgs>(
  override: Partial<GenUIToolDefinition<TArgs>> = {},
): GenUIToolDefinition<TArgs> {
  return {
    name: 'genui.test.dummy',
    description: 'dummy',
    argsSchema: z.object({ x: z.number().int() }) as unknown as z.ZodType<TArgs>,
    category: 'geral',
    readOnly: true,
    ...override,
  } as GenUIToolDefinition<TArgs>
}

afterEach(() => {
  clearRegistry()
})

describe('registry — register + lookup', () => {
  it('register + getToolDefinition retorna a tool', () => {
    const t = makeTool()
    registerUIComponent(t)
    expect(getToolDefinition('genui.test.dummy')).toBe(t)
  })

  it('re-register sobrescreve (HMR-friendly)', () => {
    registerUIComponent(makeTool({ description: 'v1' }))
    registerUIComponent(makeTool({ description: 'v2' }))
    expect(getToolDefinition('genui.test.dummy')?.description).toBe('v2')
  })

  it('getRegisteredTools retorna lista completa', () => {
    registerUIComponent(makeTool({ name: 'genui.a' }))
    registerUIComponent(makeTool({ name: 'genui.b' }))
    expect(getRegisteredTools().map((t) => t.name).sort()).toEqual(['genui.a', 'genui.b'])
  })

  it('clearRegistry limpa tudo', () => {
    registerUIComponent(makeTool())
    clearRegistry()
    expect(getRegisteredTools()).toEqual([])
  })

  it('getToolsForPersona filtra por allowedPersonas', () => {
    registerUIComponent(
      makeTool({ name: 'genui.medico', allowedPersonas: ['professional_clinical'] }),
    )
    registerUIComponent(
      makeTool({ name: 'genui.coach', allowedPersonas: ['professional_coach'] }),
    )
    registerUIComponent(makeTool({ name: 'genui.publico' })) // sem allowedPersonas = todos

    expect(getToolsForPersona('professional_clinical').map((t) => t.name).sort()).toEqual([
      'genui.medico',
      'genui.publico',
    ])
    expect(getToolsForPersona('admin').map((t) => t.name)).toEqual(['genui.publico'])
  })
})

describe('validateToolCall — guardrails', () => {
  it('tool não registrada → unknown_tool', () => {
    const r = validateToolCall({ id: '1', name: 'genui.inexistente', args: {} })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('unknown_tool')
  })

  it('args inválidos → schema_violation com detalhes', () => {
    registerUIComponent(makeTool())
    const r = validateToolCall({ id: '1', name: 'genui.test.dummy', args: { x: 'not_a_number' } })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reason).toBe('schema_violation')
      expect(r.details).toMatch(/x:/)
    }
  })

  it('args válidos → ok com call tipada', () => {
    registerUIComponent(makeTool())
    const r = validateToolCall({ id: 'abc', name: 'genui.test.dummy', args: { x: 42 } })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.call.id).toBe('abc')
      expect(r.call.args).toEqual({ x: 42 })
    }
  })

  it('readOnly=false rejeitado → mutation_attempted', () => {
    registerUIComponent(
      makeTool({ name: 'genui.write', readOnly: false }) as GenUIToolDefinition<unknown>,
    )
    const r = validateToolCall({ id: '1', name: 'genui.write', args: { x: 1 } })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('mutation_attempted')
  })

  it('persona não permitida → persona_not_allowed', () => {
    registerUIComponent(makeTool({ allowedPersonas: ['professional_clinical'] }))
    const r = validateToolCall(
      { id: '1', name: 'genui.test.dummy', args: { x: 1 } },
      { persona: 'member' },
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('persona_not_allowed')
  })

  it('persona permitida → ok', () => {
    registerUIComponent(makeTool({ allowedPersonas: ['professional_clinical'] }))
    const r = validateToolCall(
      { id: '1', name: 'genui.test.dummy', args: { x: 1 } },
      { persona: 'professional_clinical' },
    )
    expect(r.ok).toBe(true)
  })

  it('sem allowedPersonas + persona qualquer → ok', () => {
    registerUIComponent(makeTool())
    const r = validateToolCall(
      { id: '1', name: 'genui.test.dummy', args: { x: 1 } },
      { persona: 'admin' },
    )
    expect(r.ok).toBe(true)
  })
})

describe('default tools (Sprint 28 catálogo inicial)', () => {
  it('registerDefaultGenUITools registra os 6 canônicos', () => {
    registerDefaultGenUITools()
    const names = getRegisteredTools().map((t) => t.name).sort()
    expect(names).toEqual([
      'genui.fisio.cid_suggestion',
      'genui.fisio.evolution_chart',
      'genui.fisio.exercise_recommendation',
      'genui.fisio.patient_card',
      'genui.geral.measurement_comparison',
      'genui.geral.report_section',
    ])
  })

  it('patient_card valida args completos', () => {
    registerDefaultGenUITools()
    const r = validateToolCall(
      {
        id: 'pc1',
        name: 'genui.fisio.patient_card',
        args: {
          memberId: '00000000-0000-0000-0000-000000000001',
          name: 'Marcelo Silva',
          age: 42,
          vertical: 'fisio',
          contractStatus: 'active',
          activeRisks: ['lombalgia'],
        },
      },
      { persona: 'professional_clinical' },
    )
    expect(r.ok).toBe(true)
  })

  it('patient_card rejeita vertical inválida', () => {
    registerDefaultGenUITools()
    const r = validateToolCall(
      {
        id: 'pc1',
        name: 'genui.fisio.patient_card',
        args: {
          memberId: '00000000-0000-0000-0000-000000000001',
          name: 'X',
          vertical: 'pilates', // não é enum
        },
      },
      { persona: 'professional_clinical' },
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('schema_violation')
  })

  it('evolution_chart exige >=2 pontos', () => {
    registerDefaultGenUITools()
    const r = validateToolCall(
      {
        id: 'ec1',
        name: 'genui.fisio.evolution_chart',
        args: {
          memberId: '00000000-0000-0000-0000-000000000001',
          metric: 'peso',
          unit: 'kg',
          points: [{ at: '2026-05-01T00:00:00Z', value: 80 }],
        },
      },
      { persona: 'professional_clinical' },
    )
    expect(r.ok).toBe(false)
  })

  it('cid_suggestion bloqueado para professional_coach', () => {
    registerDefaultGenUITools()
    const r = validateToolCall(
      {
        id: 'c1',
        name: 'genui.fisio.cid_suggestion',
        args: {
          cids: [
            { code: 'MG30.0', description: 'Dor lombar', confidence: 0.8, rationale: 'queixa típica' },
          ],
        },
      },
      { persona: 'professional_coach' },
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('persona_not_allowed')
  })

  it('report_section confidence default tone=info', () => {
    registerDefaultGenUITools()
    const r = validateToolCall(
      {
        id: 'r1',
        name: 'genui.geral.report_section',
        args: { title: 'Anamnese', body: 'Paciente refere...' },
      },
      { persona: 'admin' },
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      // tone default aplicado
      expect((r.call.args as { tone: string }).tone).toBe('info')
    }
  })
})
