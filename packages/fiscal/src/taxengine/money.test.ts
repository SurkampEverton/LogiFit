import { describe, expect, it } from 'vitest'
import {
  BP_SCALE,
  MoneyOverflowError,
  NonIntegerMoneyError,
  addBp,
  applyBp,
  applyComplementBp,
  applyPerUnit,
  assertInteger,
  clampZero,
  divRound,
  sumCents,
} from './money'

describe('divRound', () => {
  it('arredonda meio para cima', () => {
    expect(divRound(5, 10)).toBe(1)
    expect(divRound(4, 10)).toBe(0)
    expect(divRound(15, 10)).toBe(2)
  })

  // Simetria importa em nota de devolução: se -0,005 virasse 0,00 e 0,005
  // virasse 0,01, a devolução não zeraria a venda original.
  it('afasta de zero nos dois sinais', () => {
    expect(divRound(-5, 10)).toBe(-1)
    expect(divRound(5, 10)).toBe(1)
    expect(divRound(-15, 10)).toBe(-2)
  })

  it('recusa divisor zero', () => {
    expect(() => divRound(1, 0)).toThrow(RangeError)
  })

  // `d >> 1` coagia o divisor a int32 e devolvia resultado errado, em
  // silêncio, a partir de 2^31.
  it('acerta com divisor acima de 2^31', () => {
    expect(divRound(3_000_000_000, 4_000_000_000)).toBe(1)
    expect(divRound(1_000_000_000, 4_000_000_000)).toBe(0)
  })

  it('recusa entrada fracionária', () => {
    expect(() => divRound(1.5, 10)).toThrow(NonIntegerMoneyError)
  })
})

describe('applyBp', () => {
  it('aplica alíquota percentual', () => {
    // 18% de R$ 100,00
    expect(applyBp(10_000, 1_800)).toBe(1_800)
    // 7,5% de R$ 33,33
    expect(applyBp(3_333, 750)).toBe(250)
  })

  it('trata alíquota zero e valor zero', () => {
    expect(applyBp(10_000, 0)).toBe(0)
    expect(applyBp(0, 1_800)).toBe(0)
  })

  it('falha alto em vez de perder precisão silenciosamente', () => {
    expect(() => applyBp(Number.MAX_SAFE_INTEGER, BP_SCALE)).toThrow(MoneyOverflowError)
  })
})

describe('applyComplementBp', () => {
  // O ponto de existir separado: arredondar uma vez em vez de duas.
  it('reduz a base numa única multiplicação', () => {
    // Redução de 33,33% sobre R$ 100,00 → base de R$ 66,67
    expect(applyComplementBp(10_000, 3_333)).toBe(6_667)
  })

  // Os dois caminhos divergem exatamente quando a fração cai em 0,5 — aí um
  // arredonda para cima e o outro para baixo. R$ 100,01 com 50% de redução é
  // o menor caso realista, e o centavo de diferença é o que separa o total da
  // soma dos itens (rejeição 685).
  it('difere de subtrair o valor arredondado', () => {
    const base = 10_001
    const reducao = 5_000
    const umArredondamento = applyComplementBp(base, reducao)
    const doisArredondamentos = base - applyBp(base, reducao)
    expect(umArredondamento).toBe(5_001)
    expect(doisArredondamentos).toBe(5_000)
  })

  it('recusa redução fora de 0–100%', () => {
    expect(() => applyComplementBp(10_000, -1)).toThrow(RangeError)
    expect(() => applyComplementBp(10_000, BP_SCALE + 1)).toThrow(RangeError)
  })
})

describe('addBp', () => {
  it('acresce MVA', () => {
    expect(addBp(10_000, 4_000)).toBe(14_000)
  })

  it('recusa acréscimo negativo', () => {
    expect(() => addBp(10_000, -1)).toThrow(RangeError)
  })
})

describe('applyPerUnit', () => {
  it('calcula por quantidade em milésimos', () => {
    // 2,5 unidades × R$ 0,30
    expect(applyPerUnit(2_500, 30)).toBe(75)
  })

  it('arredonda fração de milésimo', () => {
    expect(applyPerUnit(1, 30)).toBe(0)
    expect(applyPerUnit(500, 1)).toBe(1)
  })
})

describe('sumCents', () => {
  it('soma e valida cada parcela', () => {
    expect(sumCents(1, 2, 3)).toBe(6)
    expect(sumCents()).toBe(0)
    expect(() => sumCents(1, 2.5)).toThrow(NonIntegerMoneyError)
  })
})

describe('assertInteger / clampZero', () => {
  it('devolve o valor quando inteiro', () => {
    expect(assertInteger('x', 42)).toBe(42)
  })

  it('recusa NaN e infinito', () => {
    expect(() => assertInteger('x', Number.NaN)).toThrow(NonIntegerMoneyError)
    expect(() => assertInteger('x', Number.POSITIVE_INFINITY)).toThrow(NonIntegerMoneyError)
  })

  it('trunca negativo em zero', () => {
    expect(clampZero(-1)).toBe(0)
    expect(clampZero(5)).toBe(5)
  })
})
