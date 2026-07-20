import { describe, expect, it } from 'vitest'
import { calculateRetentions } from './calculate'
import {
  FEDERAL_MIN_BASE_CENTS,
  GLOBAL_TAX_NATURES,
  INSS_CEILING_CENTS_2026,
  IRRF_BRACKETS_2026,
  findGlobalTaxNature,
} from './tables'
import type { TaxNatureDefinition } from './types'

function nature(code: string): TaxNatureDefinition {
  const n = findGlobalTaxNature(code)
  if (!n) throw new Error(`natureza ${code} não encontrada`)
  return n
}

function lineOf(result: ReturnType<typeof calculateRetentions>, tax: string) {
  const line = result.lines.find((l) => l.tax === tax)
  if (!line) throw new Error(`linha ${tax} ausente`)
  return line
}

describe('catálogo global', () => {
  it('tem as 10 naturezas curadas do ADR 0061', () => {
    expect(GLOBAL_TAX_NATURES).toHaveLength(10)
    expect(new Set(GLOBAL_TAX_NATURES.map((n) => n.code)).size).toBe(10)
  })

  it('toda natureza declara referência normativa', () => {
    for (const n of GLOBAL_TAX_NATURES) {
      expect(n.regulatoryReference.length).toBeGreaterThan(5)
    }
  })
})

describe('serviço PJ geral (PIS+COFINS+CSLL+IRRF = 6,15%)', () => {
  it('R$ 1.000,00 retém R$ 61,50 e líquido R$ 938,50', () => {
    const r = calculateRetentions({
      grossCents: 100000,
      nature: nature('servico_prestado_pj_geral'),
    })
    expect(lineOf(r, 'pis').amountCents).toBe(650)
    expect(lineOf(r, 'cofins').amountCents).toBe(3000)
    expect(lineOf(r, 'csll').amountCents).toBe(1000)
    expect(lineOf(r, 'irrf').amountCents).toBe(1500)
    expect(r.totalRetainedCents).toBe(6150)
    expect(r.netCents).toBe(93850)
  })

  it('base abaixo do piso de R$ 10 dispensa retenção federal (Lei 10.833 art. 31)', () => {
    const r = calculateRetentions({
      grossCents: FEDERAL_MIN_BASE_CENTS - 1,
      nature: nature('servico_prestado_pj_geral'),
    })
    expect(r.totalRetainedCents).toBe(0)
    expect(r.lines.every((l) => !l.withheld)).toBe(true)
    expect(lineOf(r, 'pis').note).toMatch(/piso de dispensa/)
    expect(r.netCents).toBe(FEDERAL_MIN_BASE_CENTS - 1)
  })

  it('arredonda por tributo, sem acumular erro', () => {
    // 333,33 × 0,65% = 2,1666 → 2,17
    const r = calculateRetentions({
      grossCents: 33333,
      nature: nature('servico_prestado_pj_geral'),
    })
    expect(lineOf(r, 'pis').amountCents).toBe(217)
    expect(r.netCents).toBe(r.grossCents - r.totalRetainedCents)
  })
})

describe('IRRF tabela progressiva (PF)', () => {
  it('faixa isenta não retém', () => {
    const r = calculateRetentions({ grossCents: 200000, nature: nature('aluguel_pf') })
    const irrf = lineOf(r, 'irrf')
    expect(irrf.amountCents).toBe(0)
    expect(irrf.withheld).toBe(false)
    expect(irrf.note).toMatch(/isenta/)
  })

  it('segunda faixa: R$ 2.500,00 → 7,5% − dedução R$ 169,44 = R$ 18,06', () => {
    const r = calculateRetentions({ grossCents: 250000, nature: nature('aluguel_pf') })
    expect(lineOf(r, 'irrf').amountCents).toBe(1806)
  })

  it('faixa máxima: R$ 10.000,00 → 27,5% − R$ 896,00 = R$ 1.854,00', () => {
    const r = calculateRetentions({ grossCents: 1000000, nature: nature('aluguel_pf') })
    expect(lineOf(r, 'irrf').amountCents).toBe(185400)
  })

  it('alíquota efetiva é reportada (não a nominal da faixa)', () => {
    const r = calculateRetentions({ grossCents: 1000000, nature: nature('aluguel_pf') })
    const irrf = lineOf(r, 'irrf')
    // 1854,00 / 10000,00 = 18,54% efetivo (nominal é 27,5%)
    expect(irrf.rateAppliedBp).toBe(1854)
  })

  it('nunca gera imposto negativo quando a dedução supera o apurado', () => {
    const r = calculateRetentions({ grossCents: 226000, nature: nature('aluguel_pf') })
    expect(lineOf(r, 'irrf').amountCents).toBeGreaterThanOrEqual(0)
  })

  it('tabela cobre todas as faixas sem buraco', () => {
    expect(IRRF_BRACKETS_2026[IRRF_BRACKETS_2026.length - 1]?.upToCents).toBeNull()
    for (let i = 1; i < IRRF_BRACKETS_2026.length; i++) {
      const prev = IRRF_BRACKETS_2026[i - 1]
      const curr = IRRF_BRACKETS_2026[i]
      if (prev?.upToCents !== null && curr) {
        expect(curr.rateBp).toBeGreaterThan(prev?.rateBp ?? 0)
      }
    }
  })
})

describe('INSS com teto (autônomo 11%)', () => {
  it('abaixo do teto retém 11% do bruto', () => {
    const r = calculateRetentions({ grossCents: 300000, nature: nature('autonomo_rpa_pf') })
    const inss = lineOf(r, 'inss')
    expect(inss.amountCents).toBe(33000)
    expect(inss.baseCents).toBe(300000)
    expect(inss.note).toBeUndefined()
  })

  it('acima do teto retém 11% do teto e sinaliza', () => {
    const r = calculateRetentions({ grossCents: 1500000, nature: nature('autonomo_rpa_pf') })
    const inss = lineOf(r, 'inss')
    expect(inss.baseCents).toBe(INSS_CEILING_CENTS_2026)
    expect(inss.amountCents).toBe(Math.round((INSS_CEILING_CENTS_2026 * 1100) / 10000))
    expect(inss.note).toMatch(/teto/)
  })

  it('teto é único no mês — base já retida por outra fonte consome o limite', () => {
    const r = calculateRetentions({
      grossCents: 500000,
      nature: nature('autonomo_rpa_pf'),
      inssAlreadyWithheldBaseCents: INSS_CEILING_CENTS_2026 - 100000,
    })
    const inss = lineOf(r, 'inss')
    expect(inss.baseCents).toBe(100000)
    expect(inss.amountCents).toBe(11000)
  })

  it('teto já esgotado zera a retenção', () => {
    const r = calculateRetentions({
      grossCents: 500000,
      nature: nature('autonomo_rpa_pf'),
      inssAlreadyWithheldBaseCents: INSS_CEILING_CENTS_2026,
    })
    expect(lineOf(r, 'inss').amountCents).toBe(0)
    expect(lineOf(r, 'inss').withheld).toBe(false)
  })

  it('autônomo combina INSS + IRRF progressivo', () => {
    const r = calculateRetentions({ grossCents: 500000, nature: nature('autonomo_rpa_pf') })
    expect(lineOf(r, 'inss').amountCents).toBe(55000)
    expect(lineOf(r, 'irrf').amountCents).toBeGreaterThan(0)
    expect(r.netCents).toBe(500000 - r.totalRetainedCents)
  })
})

describe('ISS retido (municipal — fora da natureza)', () => {
  it('aplica alíquota do catálogo quando informada', () => {
    const r = calculateRetentions({
      grossCents: 100000,
      nature: nature('autonomo_rpa_pf'),
      issRateBp: 500,
    })
    const iss = lineOf(r, 'iss')
    expect(iss.amountCents).toBe(5000)
    expect(iss.note).toMatch(/LC 116/)
  })

  it('sem alíquota informada não cria linha de ISS', () => {
    const r = calculateRetentions({ grossCents: 100000, nature: nature('autonomo_rpa_pf') })
    expect(r.lines.some((l) => l.tax === 'iss')).toBe(false)
  })
})

describe('naturezas sem retenção', () => {
  it('utilidade pública não retém nada', () => {
    const r = calculateRetentions({ grossCents: 500000, nature: nature('utilidade_publica') })
    expect(r.lines).toHaveLength(0)
    expect(r.totalRetainedCents).toBe(0)
    expect(r.netCents).toBe(500000)
  })

  it('prestador do Simples é dispensado da retenção federal (LC 123 art. 13)', () => {
    const r = calculateRetentions({
      grossCents: 500000,
      nature: nature('simples_nacional_prestador'),
    })
    expect(r.totalRetainedCents).toBe(0)
  })
})

describe('invariantes gerais', () => {
  it('líquido + retido = bruto em todas as naturezas', () => {
    for (const n of GLOBAL_TAX_NATURES) {
      const r = calculateRetentions({ grossCents: 750000, nature: n, issRateBp: 200 })
      expect(r.netCents + r.totalRetainedCents).toBe(750000)
    }
  })

  it('nenhuma retenção excede o bruto', () => {
    for (const n of GLOBAL_TAX_NATURES) {
      const r = calculateRetentions({ grossCents: 100000, nature: n, issRateBp: 500 })
      expect(r.totalRetainedCents).toBeLessThanOrEqual(100000)
      expect(r.netCents).toBeGreaterThanOrEqual(0)
    }
  })

  it('bruto zero não gera retenção nem divisão por zero', () => {
    const r = calculateRetentions({ grossCents: 0, nature: nature('autonomo_rpa_pf') })
    expect(r.totalRetainedCents).toBe(0)
    expect(lineOf(r, 'irrf').rateAppliedBp).toBe(0)
  })

  it('é determinística (mesma entrada → mesma saída)', () => {
    const input = {
      grossCents: 123456,
      nature: nature('servico_prestado_pj_geral'),
      issRateBp: 300,
    }
    expect(calculateRetentions(input)).toEqual(calculateRetentions(input))
  })
})
