/**
 * Classifier de output IA de exames — unit tests Sprint 33 Faixa B.1.
 */
import { describe, expect, it } from 'vitest'
import {
  classifyInterpretationFields,
  classifyInterpretationOutput,
  getBlockedMessage,
} from './classifier'

describe('classifyInterpretationOutput — strict', () => {
  it('texto conservador passa', () => {
    const r = classifyInterpretationOutput(
      'Padrão sugestivo de resistência à insulina. Compatível com pré-diabetes.',
    )
    expect(r.ok).toBe(true)
    expect(r.blockedTerms).toHaveLength(0)
  })

  it('"diagnóstico de X" bloqueia', () => {
    const r = classifyInterpretationOutput('Paciente apresenta diagnóstico de diabetes mellitus.')
    expect(r.ok).toBe(false)
    expect(r.blockedTerms.length).toBeGreaterThan(0)
  })

  it('"paciente tem diabetes" bloqueia', () => {
    const r = classifyInterpretationOutput('O paciente tem diabetes tipo 2.')
    expect(r.ok).toBe(false)
  })

  it('"você tem hipertensão" bloqueia (endereçamento direto)', () => {
    const r = classifyInterpretationOutput('Você tem hipertensão arterial sistêmica.')
    expect(r.ok).toBe(false)
  })

  it('"prescrever metformina" bloqueia', () => {
    const r = classifyInterpretationOutput('Recomenda-se prescrever metformina 500mg.')
    expect(r.ok).toBe(false)
  })

  it('"tome 500mg" bloqueia posologia', () => {
    const r = classifyInterpretationOutput('Tome 500mg de metformina 2 vezes ao dia.')
    expect(r.ok).toBe(false)
  })

  it('"iniciar tratamento" bloqueia', () => {
    const r = classifyInterpretationOutput('Iniciar tratamento com sinvastatina.')
    expect(r.ok).toBe(false)
  })

  it('"confirma diabetes" bloqueia (moderate)', () => {
    const r = classifyInterpretationOutput('Exame confirma diabetes.')
    expect(r.ok).toBe(false)
  })

  it('"definitivamente diabetes" bloqueia (moderate)', () => {
    const r = classifyInterpretationOutput('Definitivamente é um caso de diabetes.')
    expect(r.ok).toBe(false)
  })

  it('vocabulário conservador OK', () => {
    const r = classifyInterpretationOutput(
      'Padrão sugestivo de hipotireoidismo. Pode indicar disfunção tireoidiana. Achado a esclarecer.',
    )
    expect(r.ok).toBe(true)
  })

  it('múltiplos termos bloqueados retornam todos', () => {
    const r = classifyInterpretationOutput(
      'Paciente apresenta diagnóstico de diabetes. Iniciar tratamento com metformina.',
    )
    expect(r.blockedTerms.length).toBeGreaterThanOrEqual(2)
  })
})

describe('classifyInterpretationOutput — moderate', () => {
  it('moderate é mais permissivo (não bloqueia "confirma X")', () => {
    const r = classifyInterpretationOutput('Exame confirma alteração tireoidiana.', 'moderate')
    expect(r.ok).toBe(true)
  })

  it('moderate ainda bloqueia diagnóstico direto', () => {
    const r = classifyInterpretationOutput('Paciente tem diabetes.', 'moderate')
    expect(r.ok).toBe(false)
  })

  it('moderate ainda bloqueia prescrição', () => {
    const r = classifyInterpretationOutput('Prescrever sinvastatina 20mg.', 'moderate')
    expect(r.ok).toBe(false)
  })
})

describe('classifyInterpretationFields', () => {
  it('todos os fields OK retorna ok=true', () => {
    const r = classifyInterpretationFields([
      'Padrão sugestivo de resistência à insulina.',
      'Hipótese: pré-diabetes a esclarecer.',
      'Recomendação: avaliar HOMA-IR.',
    ])
    expect(r.ok).toBe(true)
  })

  it('1 field bloqueado falha o conjunto', () => {
    const r = classifyInterpretationFields([
      'Padrão sugestivo de resistência à insulina.',
      'Paciente tem diabetes tipo 2.',
      'Recomendação: avaliar HOMA-IR.',
    ])
    expect(r.ok).toBe(false)
    expect(r.blockedTerms.length).toBeGreaterThan(0)
  })

  it('lista vazia retorna ok', () => {
    const r = classifyInterpretationFields([])
    expect(r.ok).toBe(true)
  })
})

describe('getBlockedMessage', () => {
  it('mensagem vazia quando ok', () => {
    expect(getBlockedMessage({ ok: true, blockedTerms: [], originalText: 'x' })).toBe('')
  })

  it('mensagem amigável quando bloqueado', () => {
    const msg = getBlockedMessage({
      ok: false,
      blockedTerms: [{ matched: 'diagnóstico de diabetes', reason: 'IA não diagnostica' }],
      originalText: 'foo',
    })
    expect(msg).toContain('Termos detectados')
    expect(msg).toContain('diagnóstico de diabetes')
    expect(msg).toContain('Profissional precisa interpretar manualmente')
  })
})
