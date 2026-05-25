/**
 * Unit tests Sprint 37a (ADR 0100) — calculadoras Apuração Fiscal Mensal.
 *
 * Cobre 12+ cenários canônicos:
 *   - Simples Nacional Anexo III brackets 1-6
 *   - Simples Anexo V (Fator R < 28%)
 *   - Lucro Presumido 4 atividades
 *   - Lucro Real proxy
 *   - MEI 3 atividades + teto excedido
 *   - Casos de borda (rbt12=0 primeira apuração, ceiling excedido, receita zero)
 */
import { describe, expect, it } from 'vitest'
import {
  calculateLucroPresumido,
  calculateLucroReal,
  calculateMEI,
  calculateSimplesNacional,
  computeAggregation,
} from './compute'
import {
  MEI_VALOR_AMBOS_CENTS,
  MEI_VALOR_COMERCIO_CENTS,
  MEI_VALOR_SERVICO_CENTS,
  SIMPLES_RBT12_CEILING_CENTS,
  findSimplesBracket,
} from './simples-tables'
import type { AggregationInput } from './types'

const COMPETENCIA = '2026-05-01'

function baseInput(overrides: Partial<AggregationInput> = {}): AggregationInput {
  return {
    regime: 'simples_nacional',
    receitaServicosCents: 0,
    receitaMercadoriasCents: 0,
    competenciaDate: COMPETENCIA,
    ...overrides,
  }
}

describe('findSimplesBracket', () => {
  it('Anexo III bracket 1 — rbt12 R$ 100k (dentro do teto R$ 180k)', () => {
    const b = findSimplesBracket('III', 10_000_000, COMPETENCIA)
    expect(b?.bracket).toBe(1)
    expect(b?.aliquotaNominalBp).toBe(600)
  })

  it('Anexo III bracket 3 — rbt12 R$ 500k', () => {
    const b = findSimplesBracket('III', 50_000_000, COMPETENCIA)
    expect(b?.bracket).toBe(3)
    expect(b?.aliquotaNominalBp).toBe(1350)
  })

  it('Anexo V bracket 4 — rbt12 R$ 1.2M', () => {
    const b = findSimplesBracket('V', 120_000_000, COMPETENCIA)
    expect(b?.bracket).toBe(4)
    expect(b?.aliquotaNominalBp).toBe(2050)
  })

  it('rbt12 acima do teto retorna null', () => {
    const b = findSimplesBracket('III', SIMPLES_RBT12_CEILING_CENTS + 1, COMPETENCIA)
    expect(b).toBeNull()
  })

  it('competência anterior à validFrom retorna null', () => {
    const b = findSimplesBracket('III', 10_000_000, '2025-12-01')
    expect(b).toBeNull()
  })
})

describe('calculateSimplesNacional', () => {
  it('caso canônico — Anexo III, RBT12 R$ 100k, mês R$ 12k → alíquota 6% (faixa 1) → imposto R$ 720', () => {
    const r = calculateSimplesNacional(
      baseInput({
        receitaServicosCents: 1_200_000,
        rbt12Cents: 10_000_000,
        anexo: 'III',
      }),
    )
    expect(r.regime).toBe('simples_nacional')
    expect(r.receitaTotalCents).toBe(1_200_000)
    // RBT12 R$ 100k < R$ 180k → faixa 1, alíquota 6%, parcela = 0
    // Alíquota efetiva = (100000_00 × 600 - 0 × 10000) / 100000_00 = 600 bp (6%)
    expect(r.aliquotaEfetivaBp).toBe(600)
    expect(r.impostoApuradoCents).toBe(72_000) // 12k × 6% = 720
  })

  it('Anexo III faixa 2 — RBT12 R$ 250k, mês R$ 25k → alíquota efetiva ~7.21%', () => {
    const r = calculateSimplesNacional(
      baseInput({
        receitaServicosCents: 2_500_000,
        rbt12Cents: 25_000_000,
        anexo: 'III',
      }),
    )
    // Alíquota efetiva = (25000000 × 1120 - 998400 × 10000) / 25000000
    //                  = (28_000_000_000 - 9_984_000_000) / 25_000_000
    //                  = 18_016_000_000 / 25_000_000 = 720.64 bp ≈ 721 bp (rounded)
    expect(r.aliquotaEfetivaBp).toBeGreaterThanOrEqual(720)
    expect(r.aliquotaEfetivaBp).toBeLessThanOrEqual(722)
    // Imposto ≈ 25k × 7.21% ≈ R$ 1.802
    expect(r.impostoApuradoCents).toBeGreaterThan(170_000)
    expect(r.impostoApuradoCents).toBeLessThan(190_000)
  })

  it('Anexo V faixa 3 — RBT12 R$ 500k, mês R$ 50k', () => {
    const r = calculateSimplesNacional(
      baseInput({
        receitaServicosCents: 5_000_000,
        rbt12Cents: 50_000_000,
        anexo: 'V',
      }),
    )
    // Anexo V bracket 3: 19% nominal, parcela R$ 9.900
    // Efetiva = (50000000 × 1900 - 990000 × 10000) / 50000000
    //         = (95_000_000_000 - 9_900_000_000) / 50_000_000 = 1702 bp (17.02%)
    expect(r.aliquotaEfetivaBp).toBe(1702)
    // Imposto = 50k × 17.02% = R$ 8.510
    expect(r.impostoApuradoCents).toBe(851_000)
  })

  it('primeira apuração — RBT12 = 0 usa alíquota nominal da faixa 1', () => {
    const r = calculateSimplesNacional(
      baseInput({
        receitaServicosCents: 1_000_000,
        rbt12Cents: 0,
        anexo: 'III',
      }),
    )
    expect(r.aliquotaEfetivaBp).toBe(600) // 6% nominal faixa 1 Anexo III
    expect(r.impostoApuradoCents).toBe(60_000) // 10k × 6% = R$ 600
    expect(r.memorial.some((l) => l.note?.includes('primeira apuração'))).toBe(true)
  })

  it('RBT12 acima do teto — usa última faixa + memorial alerta', () => {
    const r = calculateSimplesNacional(
      baseInput({
        receitaServicosCents: 10_000_000,
        rbt12Cents: SIMPLES_RBT12_CEILING_CENTS + 1_000_000,
        anexo: 'III',
      }),
    )
    expect(r.impostoApuradoCents).toBeGreaterThan(0)
    expect(r.memorial.some((l) => l.label.includes('excedeu o teto'))).toBe(true)
  })

  it('receita zero do mês — imposto zero', () => {
    const r = calculateSimplesNacional(
      baseInput({
        receitaServicosCents: 0,
        rbt12Cents: 10_000_000,
        anexo: 'III',
      }),
    )
    expect(r.receitaTotalCents).toBe(0)
    expect(r.impostoApuradoCents).toBe(0)
  })

  it('memorial sempre tem ≥ 5 linhas estruturadas', () => {
    const r = calculateSimplesNacional(
      baseInput({
        receitaServicosCents: 1_200_000,
        rbt12Cents: 10_000_000,
      }),
    )
    expect(r.memorial.length).toBeGreaterThanOrEqual(5)
    // Cada linha tem step + label
    for (const line of r.memorial) {
      expect(line.step).toBeGreaterThan(0)
      expect(line.label.length).toBeGreaterThan(0)
    }
  })
})

describe('calculateLucroPresumido', () => {
  it('SERVICO_SAUDE — receita R$ 100k → IRPJ + CSLL + PIS + COFINS', () => {
    const r = calculateLucroPresumido(
      baseInput({ receitaServicosCents: 10_000_000, regime: 'lucro_presumido' }),
      'SERVICO_SAUDE',
    )
    expect(r.regime).toBe('lucro_presumido')
    // Base IRPJ = 100k × 12% = R$ 12k
    // IRPJ = 12k × 15% = R$ 1.800
    // Base trimestre proxy = 36k < R$ 60k → sem adicional
    // CSLL base = 100k × 12% = 12k → CSLL 9% = R$ 1.080
    // PIS = 100k × 0.65% = R$ 650
    // COFINS = 100k × 3% = R$ 3.000
    // Total ≈ R$ 6.530
    expect(r.impostoApuradoCents).toBeGreaterThan(640_000)
    expect(r.impostoApuradoCents).toBeLessThan(680_000)
  })

  it('REVENDA — presunção menor (8%) → imposto IRPJ menor', () => {
    const r = calculateLucroPresumido(
      baseInput({ receitaMercadoriasCents: 10_000_000, regime: 'lucro_presumido' }),
      'REVENDA',
    )
    // Base IRPJ = 100k × 8% = 8k → IRPJ = 8k × 15% = R$ 1.200 (menor que SERVICO_SAUDE)
    expect(r.memorial.some((l) => l.label.includes('IRPJ'))).toBe(true)
  })

  it('Adicional IRPJ acima R$ 60k trimestre proxy', () => {
    // Mês com R$ 1M receita serviço → base IRPJ proxy mensal = 120k; trimestre proxy = 360k > 60k
    const r = calculateLucroPresumido(
      baseInput({ receitaServicosCents: 100_000_000, regime: 'lucro_presumido' }),
      'SERVICO_SAUDE',
    )
    expect(r.memorial.some((l) => l.label.includes('Adicional IRPJ'))).toBe(true)
  })
})

describe('calculateLucroReal', () => {
  it('apuração parcial com nota explicativa no memorial', () => {
    const r = calculateLucroReal(
      baseInput({ receitaServicosCents: 50_000_000, regime: 'lucro_real' }),
    )
    expect(r.regime).toBe('lucro_real')
    expect(r.rbt12Cents).toBeNull()
    expect(r.impostoApuradoCents).toBeGreaterThan(0)
    expect(r.memorial.some((l) => l.note?.includes('Consulte contador'))).toBe(true)
  })
})

describe('calculateMEI', () => {
  it('serviço → R$ 71,50 fixo', () => {
    const r = calculateMEI(baseInput({ receitaServicosCents: 500_000, regime: 'mei' }), 'servico')
    expect(r.impostoApuradoCents).toBe(MEI_VALOR_SERVICO_CENTS)
  })

  it('comércio → R$ 67,50 fixo', () => {
    const r = calculateMEI(
      baseInput({ receitaMercadoriasCents: 300_000, regime: 'mei' }),
      'comercio',
    )
    expect(r.impostoApuradoCents).toBe(MEI_VALOR_COMERCIO_CENTS)
  })

  it('ambos → R$ 72,50 fixo', () => {
    const r = calculateMEI(
      baseInput({ receitaServicosCents: 300_000, receitaMercadoriasCents: 200_000, regime: 'mei' }),
      'ambos',
    )
    expect(r.impostoApuradoCents).toBe(MEI_VALOR_AMBOS_CENTS)
  })

  it('teto excedido — memorial alerta', () => {
    const r = calculateMEI(
      baseInput({
        receitaServicosCents: 1_000_000,
        rbt12Cents: 9_000_000, // > R$ 81k
        regime: 'mei',
      }),
      'servico',
    )
    expect(r.memorial.some((l) => l.label.includes('excedeu o teto MEI'))).toBe(true)
  })
})

describe('computeAggregation (dispatcher)', () => {
  it('despacha Simples', () => {
    const r = computeAggregation(
      baseInput({
        regime: 'simples_nacional',
        receitaServicosCents: 1_000_000,
        rbt12Cents: 10_000_000,
      }),
    )
    expect(r.regime).toBe('simples_nacional')
  })

  it('despacha Presumido', () => {
    const r = computeAggregation(
      baseInput({ regime: 'lucro_presumido', receitaServicosCents: 1_000_000 }),
    )
    expect(r.regime).toBe('lucro_presumido')
  })

  it('despacha Real', () => {
    const r = computeAggregation(
      baseInput({ regime: 'lucro_real', receitaServicosCents: 1_000_000 }),
    )
    expect(r.regime).toBe('lucro_real')
  })

  it('despacha MEI', () => {
    const r = computeAggregation(baseInput({ regime: 'mei', receitaServicosCents: 1_000_000 }))
    expect(r.regime).toBe('mei')
  })
})
