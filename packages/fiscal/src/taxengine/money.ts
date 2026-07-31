/**
 * Aritmética de dinheiro da cadeia fiscal — Sprint 41c (ADR 0108, regra 47).
 *
 * **Tudo aqui é inteiro.** Centavo para valor, basis point para alíquota
 * (1% = 100 bp), milésimo para quantidade — que é a escala de
 * `stock_items.min_stock` (`numeric(12,3)`).
 *
 * O motivo de existir um módulo só para isto: `0.1 + 0.2 !== 0.3` em float
 * binário. Numa venda isso é um centavo; numa nota autorizada é divergência
 * entre o total e a soma dos itens, que é a rejeição 685 — e nota autorizada e
 * errada é passivo fiscal do cliente, irreversível pelo LogiFit. O port da
 * implementação de referência (Go, onde o tipo era decimal exato) para
 * TypeScript é justamente onde esse bug entraria sem ninguém ver.
 *
 * Nenhuma função aqui aceita ou devolve `number` fracionário. Se um valor
 * fracionário chegar, é erro de quem chamou e falha alto.
 */

/**
 * Estouro da faixa inteira segura do JS.
 *
 * `number` é float64: acima de 2^53-1 a adição de 1 vira no-op silencioso.
 * Multiplicar centavos por basis points chega perto disso mais rápido do que
 * parece — R$ 90 bilhões em centavos × 10.000 bp já passa. Preferimos falhar
 * ruidosamente a emitir um valor que o próprio JS não consegue representar.
 */
export class MoneyOverflowError extends Error {
  constructor(operation: string, ...operands: number[]) {
    super(
      `Estouro de precisão inteira em ${operation}(${operands.join(', ')}). O valor excede a faixa segura do JavaScript e não pode ser usado em documento fiscal.`,
    )
    this.name = 'MoneyOverflowError'
  }
}

/** Valor não-inteiro onde a cadeia fiscal exige inteiro. */
export class NonIntegerMoneyError extends Error {
  constructor(field: string, value: number) {
    super(
      `${field} recebeu ${value}, que não é inteiro. Valores fiscais são centavos, alíquotas são basis points e quantidades são milésimos — todos inteiros (regra 47).`,
    )
    this.name = 'NonIntegerMoneyError'
  }
}

/** Falha se o valor não for inteiro finito. Usado nas bordas do motor. */
export function assertInteger(field: string, value: number): number {
  if (!Number.isInteger(value)) throw new NonIntegerMoneyError(field, value)
  return value
}

function assertSafe(operation: string, result: number, ...operands: number[]): number {
  if (!Number.isSafeInteger(result)) throw new MoneyOverflowError(operation, ...operands)
  return result
}

/**
 * Divisão inteira com arredondamento **meio para cima, afastando de zero**.
 *
 * É a convenção de arredondamento comercial que a SEFAZ espera nos campos de
 * 2 casas. Afastar de zero (e não "meio para par") mantém simetria entre um
 * valor e seu negativo, o que importa em nota de devolução: arredondar
 * `-0,005` para `0,00` e `0,005` para `0,01` faria a devolução não zerar a
 * venda original.
 */
export function divRound(numerator: number, denominator: number): number {
  assertInteger('divRound.numerator', numerator)
  assertInteger('divRound.denominator', denominator)
  if (denominator === 0) throw new RangeError('divRound: divisor zero')

  const negative = numerator < 0 !== denominator < 0
  const n = Math.abs(numerator)
  const d = Math.abs(denominator)

  // `Math.floor(d / 2)` e não `d >> 1`: o shift coage a int32 e devolve
  // resultado errado, em silêncio, para divisor a partir de 2^31.
  const meio = Math.floor(d / 2)
  assertSafe('divRound', n + meio, numerator, denominator)
  const magnitude = Math.floor((n + meio) / d)
  return negative ? -magnitude : magnitude
}

/** Base de conversão de basis points: 10.000 bp = 100%. */
export const BP_SCALE = 10_000

/** Base de conversão de quantidade: 1.000 milésimos = 1 unidade. */
export const QTY_SCALE = 1_000

/**
 * Aplica uma alíquota em basis points sobre um valor em centavos.
 *
 * `applyBp(10_000, 1_800)` = 18% de R$ 100,00 = R$ 18,00 = `1_800` centavos.
 */
export function applyBp(cents: number, bp: number): number {
  assertInteger('applyBp.cents', cents)
  assertInteger('applyBp.bp', bp)
  const product = cents * bp
  assertSafe('applyBp', product, cents, bp)
  return divRound(product, BP_SCALE)
}

/**
 * Aplica o **complemento** de uma alíquota — o que sobra depois de reduzir.
 *
 * Existe separado de `applyBp` porque `base - applyBp(base, red)` arredonda
 * duas vezes e erra um centavo em parte dos valores. A redução de base de
 * cálculo do ICMS é definida como `vBC = valor × (1 - pRedBC)`: uma
 * multiplicação, um arredondamento.
 */
export function applyComplementBp(cents: number, reductionBp: number): number {
  assertInteger('applyComplementBp.reductionBp', reductionBp)
  if (reductionBp < 0 || reductionBp > BP_SCALE) {
    throw new RangeError(
      `Redução de base fora da faixa: ${reductionBp} bp. Deve estar entre 0 e ${BP_SCALE} (0% a 100%).`,
    )
  }
  return applyBp(cents, BP_SCALE - reductionBp)
}

/**
 * Acresce um percentual em basis points — a MVA da substituição tributária.
 *
 * `addBp(10_000, 4_000)` = R$ 100,00 com MVA de 40% = R$ 140,00.
 */
export function addBp(cents: number, bp: number): number {
  assertInteger('addBp.bp', bp)
  if (bp < 0) throw new RangeError(`Acréscimo negativo: ${bp} bp. MVA e pauta não são negativas.`)
  return applyBp(cents, BP_SCALE + bp)
}

/**
 * Valor de um tributo cobrado por unidade (PIS/COFINS `<PISQtde>`).
 *
 * Distinto do percentual de propósito: confundir `<PISAliq>` com `<PISQtde>`
 * é rejeição garantida, e os dois só se distinguem pela unidade da alíquota.
 */
export function applyPerUnit(quantityMilli: number, centsPerUnit: number): number {
  assertInteger('applyPerUnit.quantityMilli', quantityMilli)
  assertInteger('applyPerUnit.centsPerUnit', centsPerUnit)
  const product = quantityMilli * centsPerUnit
  assertSafe('applyPerUnit', product, quantityMilli, centsPerUnit)
  return divRound(product, QTY_SCALE)
}

/** Soma protegida contra estouro. */
export function sumCents(...values: number[]): number {
  let total = 0
  for (const [i, v] of values.entries()) {
    total += assertInteger(`sumCents[${i}]`, v)
  }
  return assertSafe('sumCents', total, ...values)
}

/** Nunca-negativo. O ICMS-ST subtrai o próprio e pode dar negativo por MVA baixa. */
export function clampZero(cents: number): number {
  return cents < 0 ? 0 : cents
}
