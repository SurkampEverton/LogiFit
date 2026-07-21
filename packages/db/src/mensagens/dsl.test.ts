import { describe, expect, it } from 'vitest'
import {
  ReguaDslSchema,
  extractTemplateVariables,
  isWithinHourWindow,
  nextActionAtFromSteps,
  renderTemplate,
} from './dsl'

describe('ReguaDslSchema — validação', () => {
  it('régua canônica de cobrança válida', () => {
    const dsl = {
      trigger: {
        event: 'invoice.overdue' as const,
        filter: { days_overdue: [1, 3, 7] },
      },
      actions: [
        {
          kind: 'send_message' as const,
          channel: 'whatsapp' as const,
          template_slug: 'cobranca_d1',
          delay_days: 0,
        },
        {
          kind: 'send_message' as const,
          channel: 'whatsapp' as const,
          template_slug: 'cobranca_d3',
          delay_days: 2,
        },
        {
          kind: 'send_message' as const,
          channel: 'email' as const,
          template_slug: 'cobranca_d7',
          delay_days: 4,
        },
      ],
      stop_on: ['invoice.paid' as const],
      guards: { consent: 'marketing_messages' as const, rate_limit_per_member_24h: 3 },
    }
    const r = ReguaDslSchema.safeParse(dsl)
    expect(r.success).toBe(true)
  })

  it('evento não-canônico rejeitado', () => {
    const dsl = {
      trigger: { event: 'invento.evento_inexistente' },
      actions: [{ kind: 'wait', delay_days: 1 }],
    }
    expect(ReguaDslSchema.safeParse(dsl).success).toBe(false)
  })

  it('action desconhecida rejeitada', () => {
    const dsl = {
      trigger: { event: 'invoice.overdue' },
      actions: [{ kind: 'send_email_legacy', body: 'teste' }],
    }
    expect(ReguaDslSchema.safeParse(dsl).success).toBe(false)
  })

  it('actions vazias rejeitada', () => {
    const dsl = {
      trigger: { event: 'invoice.overdue' },
      actions: [],
    }
    expect(ReguaDslSchema.safeParse(dsl).success).toBe(false)
  })

  it('delay_days negativo em send_message rejeitado', () => {
    const dsl = {
      trigger: { event: 'invoice.overdue' },
      actions: [{ kind: 'send_message', channel: 'whatsapp', template_slug: 'x', delay_days: -1 }],
    }
    expect(ReguaDslSchema.safeParse(dsl).success).toBe(false)
  })

  it('hour_window formato inválido rejeitado', () => {
    const dsl = {
      trigger: { event: 'invoice.overdue' },
      actions: [{ kind: 'wait', delay_days: 1 }],
      guards: { hour_window: { from: '8h00', to: '20h00' } },
    }
    expect(ReguaDslSchema.safeParse(dsl).success).toBe(false)
  })
})

describe('nextActionAtFromSteps', () => {
  const started = new Date('2026-05-13T10:00:00.000Z')
  const actions: import('./dsl').ReguaAction[] = [
    { kind: 'send_message', channel: 'whatsapp', template_slug: 'd1', delay_days: 0 },
    { kind: 'send_message', channel: 'whatsapp', template_slug: 'd3', delay_days: 2 },
    { kind: 'send_message', channel: 'email', template_slug: 'd7', delay_days: 4 },
  ]

  it('step 0 = startedAt (delay 0)', () => {
    const r = nextActionAtFromSteps(started, actions, 0)!
    expect(r.toISOString()).toBe('2026-05-13T10:00:00.000Z')
  })

  it('step 1 = startedAt + 2 dias', () => {
    const r = nextActionAtFromSteps(started, actions, 1)!
    expect(r.toISOString()).toBe('2026-05-15T10:00:00.000Z')
  })

  it('step 2 = startedAt + 6 dias (0 + 2 + 4 acumulado)', () => {
    const r = nextActionAtFromSteps(started, actions, 2)!
    expect(r.toISOString()).toBe('2026-05-19T10:00:00.000Z')
  })

  it('step fora do array retorna null', () => {
    expect(nextActionAtFromSteps(started, actions, 5)).toBeNull()
    expect(nextActionAtFromSteps(started, actions, -1)).toBeNull()
  })

  it('wait action conta delay normal', () => {
    const withWait: import('./dsl').ReguaAction[] = [
      { kind: 'send_message', channel: 'whatsapp', template_slug: 'd0', delay_days: 0 },
      { kind: 'wait', delay_days: 3 },
      { kind: 'send_message', channel: 'email', template_slug: 'd4', delay_days: 1 },
    ]
    const r = nextActionAtFromSteps(started, withWait, 2)!
    expect(r.toISOString()).toBe('2026-05-17T10:00:00.000Z') // +4 days total
  })
})

describe('renderTemplate', () => {
  it('substitui {{member.name}}', () => {
    const out = renderTemplate('Olá {{member.name}}, tudo bem?', { 'member.name': 'João' })
    expect(out).toBe('Olá João, tudo bem?')
  })

  it('múltiplas variáveis', () => {
    const out = renderTemplate(
      'Olá {{member.name}}, sua fatura de {{invoice.amount}} vence em {{invoice.due_date}}.',
      {
        'member.name': 'Maria',
        'invoice.amount': 'R$ 150,00',
        'invoice.due_date': '15/05/2026',
      },
    )
    expect(out).toBe('Olá Maria, sua fatura de R$ 150,00 vence em 15/05/2026.')
  })

  it('variável faltante vira vazia', () => {
    const out = renderTemplate('Olá {{member.name}}, {{missing}} aqui.', {
      'member.name': 'Ana',
    })
    expect(out).toBe('Olá Ana,  aqui.')
  })

  it('espaços dentro {{ }} são tolerados', () => {
    const out = renderTemplate('Olá {{  member.name  }}', { 'member.name': 'Pedro' })
    expect(out).toBe('Olá Pedro')
  })

  it('valor 0 numérico renderiza como "0"', () => {
    const out = renderTemplate('Saldo: {{value}}', { value: 0 })
    expect(out).toBe('Saldo: 0')
  })
})

describe('extractTemplateVariables', () => {
  it('extrai vars únicas ordenadas', () => {
    const body = 'Olá {{member.name}}, sua fatura {{invoice.id}} de {{invoice.amount}}.'
    expect(extractTemplateVariables(body)).toEqual(['invoice.amount', 'invoice.id', 'member.name'])
  })

  it('body sem vars retorna []', () => {
    expect(extractTemplateVariables('Hello world')).toEqual([])
  })

  it('vars duplicadas viram únicas', () => {
    expect(extractTemplateVariables('{{a}} {{a}} {{b}}')).toEqual(['a', 'b'])
  })
})

describe('isWithinHourWindow', () => {
  // Janela 08:00-20:00 GMT-3 SP
  const win = { from: '08:00', to: '20:00' }

  it('14:00 SP (=17:00 UTC) está dentro', () => {
    const utc = new Date('2026-05-13T17:00:00.000Z')
    expect(isWithinHourWindow(utc, win)).toBe(true)
  })

  it('06:00 SP (=09:00 UTC) está fora', () => {
    const utc = new Date('2026-05-13T09:00:00.000Z')
    expect(isWithinHourWindow(utc, win)).toBe(false)
  })

  it('22:00 SP (=01:00 UTC dia seguinte) está fora', () => {
    const utc = new Date('2026-05-14T01:00:00.000Z')
    expect(isWithinHourWindow(utc, win)).toBe(false)
  })

  it('janela cruza meia-noite (22:00-06:00) ainda funciona', () => {
    const winOver = { from: '22:00', to: '06:00' }
    // 23:00 SP = 02:00 UTC dia seguinte
    const utc1 = new Date('2026-05-14T02:00:00.000Z')
    expect(isWithinHourWindow(utc1, winOver)).toBe(true)
    // 12:00 SP = 15:00 UTC
    const utc2 = new Date('2026-05-13T15:00:00.000Z')
    expect(isWithinHourWindow(utc2, winOver)).toBe(false)
  })
})
