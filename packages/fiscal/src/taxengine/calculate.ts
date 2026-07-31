/**
 * Camada 3 — Cálculo: `ResolvedTax` → `TaxBreakdown` — Sprint 41c (ADR 0108).
 *
 * **O comportamento de cada CST é dado, não código.** Nenhum `switch (cst)`
 * aqui: o que decide se um CST calcula ICMS próprio, ST, redução de base ou
 * diferimento são as flags de `tax_ref_icms_cst`, carregadas do banco e
 * passadas em `behavior`. CST novo, ou mudança de regra pela SEFAZ, é linha na
 * tabela em vez de deploy (regra 47). O preço disso é que o motor depende de a
 * tabela estar seedada — e por isso CST ausente da referência não é silencioso.
 *
 * Função pura: não toca banco, não lê relógio, não emite nada. É o que permite
 * o modo sombra rodar sobre milhares de emissões passadas e comparar com o
 * documento realmente autorizado, sem risco e sem custo externo.
 *
 * Toda aritmética passa por `./money` — centavos e basis points inteiros. Ver
 * lá o porquê.
 */

import type { ResolvedTax, TaxRule } from './models'
import {
  BP_SCALE,
  addBp,
  applyBp,
  applyComplementBp,
  applyPerUnit,
  assertInteger,
  clampZero,
  sumCents,
} from './money'

/**
 * A regra existe, casou com o contexto, mas está mal preenchida.
 *
 * Distinto de `NoMatchingRuleError`, que é "não achei regra". Aqui a regra foi
 * achada e o dado dela não fecha — alíquota faltando onde o CST diz que há
 * imposto, percentual fora de faixa. Regra 47 manda **abortar antes de
 * qualquer chamada externa**, dizendo o que falta e onde configurar: nota
 * rejeitada custa 5 minutos, nota autorizada e errada é passivo do cliente.
 */
export class TaxConfigurationError extends Error {
  constructor(
    readonly ruleId: string,
    readonly field: string,
    detail: string,
  ) {
    super(
      `${detail} (regra ${ruleId}, campo \`${field}\`). Corrija em Configurações → Fiscal → Regras.`,
    )
    this.name = 'TaxConfigurationError'
  }
}

/** Alíquota ausente onde o CST declara imposto devido é erro, não zero. */
function requireAliq(
  rule: TaxRule,
  field: string,
  value: number | null | undefined,
  quem: string,
): number {
  if (value === null || value === undefined) {
    throw new TaxConfigurationError(rule.id, field, `${quem} sem alíquota informada`)
  }
  if (!Number.isInteger(value) || value < 0 || value > BP_SCALE) {
    throw new TaxConfigurationError(
      rule.id,
      field,
      `${quem} com alíquota inválida (${value} bp; esperado entre 0 e ${BP_SCALE})`,
    )
  }
  return value
}

/**
 * Comportamento de um CST de ICMS, como está em `tax_ref_icms_cst`.
 *
 * Espelha as colunas-flag da tabela. É a peça que substitui o `switch`.
 */
export interface CstBehavior {
  cst: string
  calculaIcmsProprio: boolean
  calculaSt: boolean
  calculaReducaoBc: boolean
  calculaDiferimento: boolean
  calculaDesoneracao: boolean
  calculaStRetido: boolean
  requerModBc: boolean
  requerModBcSt: boolean
  requerMvaOuPauta: boolean
}

/**
 * Fallback para CST que não está em `tax_ref_icms_cst`.
 *
 * Tratar como CST 00 (tributação integral) é a escolha **conservadora**: cobra
 * o imposto cheio em vez de omiti-lo. Recolher a mais é corrigível por pedido
 * de restituição; recolher a menos é autuação. Mas nunca é silencioso — vai
 * para `warnings`, e o modo sombra existe justamente para essas divergências
 * aparecerem antes do cut-over.
 */
const CST_00_FALLBACK: Omit<CstBehavior, 'cst'> = {
  calculaIcmsProprio: true,
  calculaSt: false,
  calculaReducaoBc: false,
  calculaDiferimento: false,
  calculaDesoneracao: false,
  calculaStRetido: false,
  requerModBc: true,
  requerModBcSt: false,
  requerMvaOuPauta: false,
}

/**
 * Piso do IRRF: abaixo disto não se retém (RIR/2018, art. 785).
 *
 * Incide sobre o **valor do imposto**, não sobre a base — ao contrário do PCC
 * logo abaixo. Trocar um pelo outro é erro que só aparece na malha fina.
 */
export const IRRF_PISO_CENTS = 1_000

/**
 * Dispensa do PCC — PIS/COFINS/CSLL retidos na fonte.
 *
 * Incide sobre o **valor retido somado dos três**, que é o que vai no DARF
 * único (código 5952) — não sobre cada tributo isolado, e não sobre o
 * pagamento.
 *
 * Os R$ 5.000,00 sobre o pagamento que quase todo material de internet ainda
 * repete **foram revogados em 22/06/2015** pela Lei 13.137/2015, art. 24, que
 * deu nova redação ao art. 31, § 3º da Lei 10.833/2003 — junto com o § 4º, que
 * mandava somar os pagamentos do mês. Manter o limite antigo faria o motor
 * deixar de reter em praticamente toda emissão de clínica ou academia, e
 * deixar de reter é infração da fonte pagadora (art. 30 c/c Lei 9.430/1996,
 * art. 44) — o lado caro do erro.
 */
export const PCC_DISPENSA_VALOR_RETIDO_CENTS = 1_000

/**
 * Prefixos de CST de IBS/CBS em que o grupo `IBSCBS` **não** é emitido.
 *
 * Armadilha 8: emitir o grupo nesses CSTs devolve `cStat 1021`. Vive como dado
 * pelo mesmo motivo das flags de CST — e porque a lista ainda vai ser conferida
 * contra a NT 2025.002 no Sprint 46, quando IBS/CBS de fato passa a ser
 * emitido. Aqui o motor só decide **se** o grupo sai; os valores são do 46.
 */
export const IBS_CBS_CST_SEM_GRUPO = ['6', '7'] as const

/** Componentes do valor da operação, todos em centavos inteiros. */
export interface OperationValues {
  /** Quantidade × preço unitário, já arredondado para centavos. */
  produtoCents: number
  freteCents?: number
  seguroCents?: number
  outrasDespesasCents?: number
  descontoCents?: number
  /** Quantidade em milésimos — usada por PIS/COFINS por unidade e pelo ST retido. */
  quantityMilli: number
  /**
   * Base do ST já retido **deste item**, rateada do XML da compra (CST 60).
   * Tem precedência sobre a pauta unitária da regra.
   */
  vBcStRetCents?: number
}

export interface CalculateTaxInput {
  resolved: ResolvedTax
  /** Flags do CST da regra. `null` dispara o fallback CST 00 com aviso. */
  behavior: CstBehavior | null
  values: OperationValues
  /** CST de IBS/CBS, quando houver. Só decide supressão do grupo (armadilha 8). */
  cstIbsCbs?: string | null
}

export interface IcmsBreakdown {
  cst: string | null
  csosn: string | null
  origem: string | null
  modBc: string | null
  bcCents: number
  aliqBp: number
  reducaoBcBp: number
  /** ICMS da operação **antes** do diferimento. */
  valorOperacaoCents: number
  valorDiferidoCents: number
  /** ICMS efetivamente devido — é este que vai no total. */
  valorCents: number
  desoneradoCents: number
  motDes: string | null
}

export interface IcmsStBreakdown {
  bcCents: number
  mvaBp: number
  aliqBp: number
  redBcBp: number
  modBcSt: string | null
  valorCents: number
}

export interface IcmsStRetidoBreakdown {
  bcCents: number
  aliqBp: number
  valorCents: number
}

export interface ContributionBreakdown {
  cst: string | null
  bcCents: number
  aliqBp: number
  aliqUnitCents: number
  valorCents: number
  /** `true` quando calculado por quantidade (`<PISQtde>`) e não percentual. */
  porQuantidade: boolean
}

export interface IpiBreakdown {
  cst: string | null
  bcCents: number
  aliqBp: number
  valorCents: number
}

export interface IssBreakdown {
  bcCents: number
  aliqBp: number
  valorCents: number
  retido: boolean
  codigoServico: string | null
  localPrestacao: 'P' | 'T' | null
}

export interface RetentionBreakdown {
  irrfCents: number
  inssCents: number
  csllCents: number
  pisCents: number
  cofinsCents: number
  totalCents: number
  /** Retenções zeradas por piso/mínimo legal — o operador precisa saber. */
  dispensadas: string[]
}

export interface TaxBreakdown {
  icms: IcmsBreakdown
  icmsSt: IcmsStBreakdown
  icmsStRetido: IcmsStRetidoBreakdown
  pis: ContributionBreakdown
  cofins: ContributionBreakdown
  ipi: IpiBreakdown
  iss: IssBreakdown
  /** Armadilha 8: `false` suprime o grupo no XML. Valores ficam para o Sprint 46. */
  emiteGrupoIbsCbs: boolean
  /** Valor da operação — produto + acessórias − desconto. */
  baseOperacaoCents: number
  /**
   * Total aproximado de tributos (Lei 12.741/2012).
   *
   * Somamos os tributos **efetivamente calculados** em vez de consultar tabela
   * IBPT: é o que temos, e a lei pede valor aproximado. O que não pode variar é
   * a coerência — armadilha 3: a soma dos itens tem que bater com o total da
   * nota, ou a SEFAZ devolve rejeição 685.
   */
  vTotTribCents: number
  warnings: string[]
}

/**
 * Calcula todos os tributos de um item já resolvido.
 *
 * @throws {NonIntegerMoneyError} se algum valor de entrada não for inteiro.
 */
export function calculateTax(input: CalculateTaxInput): TaxBreakdown {
  const { resolved, values } = input
  const rule = resolved.rule
  const warnings: string[] = []

  const behavior = resolveBehavior(input, warnings)
  const baseOperacaoCents = operationBase(values, warnings)

  // IPI antes do ICMS-ST: compõe a base da substituição. Inverter a ordem
  // subestima o ST em toda operação industrializada.
  const ipi = calcIpi(rule, baseOperacaoCents)
  const icms = calcIcms(rule, behavior, baseOperacaoCents, warnings)
  const icmsSt = calcIcmsSt(
    rule,
    behavior,
    baseOperacaoCents,
    ipi.valorCents,
    icms.valorCents,
    warnings,
  )
  const icmsStRetido = calcIcmsStRetido(rule, behavior, values, warnings)

  // Armadilha 4: PIS/COFINS e IPI usam a base CHEIA. A redução de base é
  // benefício de ICMS e não se propaga — propagar subestima os federais, que
  // é diferença que a Receita cobra com multa.
  const pis = calcContribution(
    rule.pisCst,
    rule.pisAliqBp,
    rule.pisAliqUnitCents,
    baseOperacaoCents,
    values.quantityMilli,
  )
  const cofins = calcContribution(
    rule.cofinsCst,
    rule.cofinsAliqBp,
    rule.cofinsAliqUnitCents,
    baseOperacaoCents,
    values.quantityMilli,
  )

  const iss = calcIss(rule, baseOperacaoCents)
  const emiteGrupoIbsCbs = shouldEmitIbsCbs(input.cstIbsCbs)

  const vTotTribCents = sumCents(
    icms.valorCents,
    icmsSt.valorCents,
    ipi.valorCents,
    pis.valorCents,
    cofins.valorCents,
    iss.valorCents,
  )

  return {
    icms,
    icmsSt,
    icmsStRetido,
    pis,
    cofins,
    ipi,
    iss,
    emiteGrupoIbsCbs,
    baseOperacaoCents,
    vTotTribCents,
    warnings,
  }
}

function resolveBehavior(input: CalculateTaxInput, warnings: string[]): CstBehavior {
  if (input.behavior) return input.behavior

  const cst = input.resolved.rule.icmsCst ?? '00'
  warnings.push(
    `CST ${cst} não está em tax_ref_icms_cst. Calculado como CST 00 (tributação integral), que cobra o imposto cheio. Cadastre o CST antes de emitir em produção.`,
  )
  return { cst, ...CST_00_FALLBACK }
}

function operationBase(values: OperationValues, warnings: string[]): number {
  const bruto = sumCents(
    assertInteger('produtoCents', values.produtoCents),
    values.freteCents ?? 0,
    values.seguroCents ?? 0,
    values.outrasDespesasCents ?? 0,
  )
  const desconto = assertInteger('descontoCents', values.descontoCents ?? 0)
  const base = bruto - desconto

  if (base < 0) {
    warnings.push(
      `Desconto (${desconto} centavos) maior que o valor da operação (${bruto} centavos). Base tratada como zero — confira o desconto antes de emitir.`,
    )
    return 0
  }
  return base
}

function calcIcms(
  rule: TaxRule,
  behavior: CstBehavior,
  baseCents: number,
  warnings: string[],
): IcmsBreakdown {
  const zeroed: IcmsBreakdown = {
    cst: rule.icmsCst ?? null,
    csosn: resolveCsosn(rule),
    origem: rule.origem ?? null,
    modBc: rule.modBc ?? null,
    bcCents: 0,
    aliqBp: 0,
    reducaoBcBp: 0,
    valorOperacaoCents: 0,
    valorDiferidoCents: 0,
    valorCents: 0,
    desoneradoCents: 0,
    motDes: rule.motDesIcms ?? null,
  }

  if (!behavior.calculaIcmsProprio) {
    // CST 40/41/50 e afins: desonerado. O valor desonerado é informativo, mas
    // a SEFAZ exige o motivo — sem ele a nota é rejeitada.
    if (behavior.calculaDesoneracao) {
      const potencial = applyBp(baseCents, rule.icmsAliqBp ?? 0)
      if (!rule.motDesIcms) {
        warnings.push(
          `CST ${behavior.cst} exige motivo da desoneração (motDesICMS) e a regra não tem. A SEFAZ rejeita a nota sem esse campo.`,
        )
      }
      return { ...zeroed, desoneradoCents: potencial }
    }
    return zeroed
  }

  if (behavior.requerModBc && !rule.modBc) {
    warnings.push(
      `CST ${behavior.cst} exige modalidade de base de cálculo (modBC) e a regra não tem. Assumido 3 (valor da operação).`,
    )
  }

  const reducaoBp = behavior.calculaReducaoBc ? (rule.icmsReducaoBcBp ?? 0) : 0
  if (behavior.calculaReducaoBc && !rule.icmsReducaoBcBp) {
    warnings.push(
      `CST ${behavior.cst} prevê redução de base e a regra não informou percentual. Calculado sem redução.`,
    )
  }

  const bcCents = reducaoBp > 0 ? applyComplementBp(baseCents, reducaoBp) : baseCents
  // Alíquota ausente não é 0% — é regra pela metade. Zerar em silêncio deixa
  // de cobrar imposto devido, que é o lado caro do erro.
  const aliqBp = requireAliq(rule, 'icms_aliq_bp', rule.icmsAliqBp, `CST ${behavior.cst}`)
  const valorOperacaoCents = applyBp(bcCents, aliqBp)

  // Diferimento (CST 51): parte do imposto é adiada, e só a diferença é devida
  // agora. O valor diferido continua no XML — a SEFAZ confere os dois.
  let valorDiferidoCents = 0
  if (behavior.calculaDiferimento) {
    const pDif = rule.pDiferimentoBp ?? 0
    if (pDif === 0) {
      warnings.push(
        `CST ${behavior.cst} é de diferimento e a regra não informou o percentual diferido. Nenhum valor foi diferido.`,
      )
    }
    // Acima de 100% o diferido supera o devido e o ICMS fica NEGATIVO, que o
    // leiaute não admite e que contamina o total da nota. Erro de escala
    // (120 em vez de 12) chega aqui como 12000 bp.
    if (pDif < 0 || pDif > BP_SCALE) {
      throw new TaxConfigurationError(
        rule.id,
        'p_diferimento_bp',
        `Percentual de diferimento fora da faixa (${pDif} bp; esperado entre 0 e ${BP_SCALE})`,
      )
    }
    valorDiferidoCents = applyBp(valorOperacaoCents, pDif)
  }

  return {
    ...zeroed,
    bcCents,
    aliqBp,
    reducaoBcBp: reducaoBp,
    valorOperacaoCents,
    valorDiferidoCents,
    valorCents: valorOperacaoCents - valorDiferidoCents,
  }
}

/**
 * CSOSN do Simples, aceitando as **duas** convenções de armazenamento.
 *
 * Armadilha 2: por convenção histórica o CSOSN às vezes é gravado na coluna
 * `icms_cst`. Sem aceitar as duas formas, tenant do Simples emitia `<CSOSN>`
 * vazio e a nota era rejeitada. CSOSN tem 3 dígitos e CST tem 2 — é o que
 * permite distinguir sem ambiguidade.
 */
export function resolveCsosn(rule: TaxRule): string | null {
  if (rule.csosn) return rule.csosn
  const cst = rule.icmsCst
  if (cst && cst.length === 3) return cst
  return null
}

function calcIcmsSt(
  rule: TaxRule,
  behavior: CstBehavior,
  baseCents: number,
  ipiCents: number,
  icmsProprioCents: number,
  warnings: string[],
): IcmsStBreakdown {
  const empty: IcmsStBreakdown = {
    bcCents: 0,
    mvaBp: 0,
    aliqBp: 0,
    redBcBp: 0,
    modBcSt: rule.modBcSt ?? null,
    valorCents: 0,
  }
  if (!behavior.calculaSt) return empty

  if (behavior.requerModBcSt && !rule.modBcSt) {
    warnings.push(
      `CST ${behavior.cst} exige modalidade de base do ICMS-ST (modBCST) e a regra não tem. Assumido 4 (margem de valor agregado).`,
    )
  }

  const mvaBp = rule.mvaStBp ?? 0
  if (behavior.requerMvaOuPauta && mvaBp === 0) {
    warnings.push(
      `CST ${behavior.cst} calcula ICMS-ST e a regra não tem MVA nem pauta. O ST saiu zerado — confira a regra antes de emitir.`,
    )
    return empty
  }

  // A base do ST inclui o IPI: é mercadoria industrializada seguindo para
  // revenda, e o IPI compõe o preço que o contribuinte substituído vai praticar.
  const comIpi = sumCents(baseCents, ipiCents)
  const comMva = addBp(comIpi, mvaBp)
  const redBcBp = rule.pRedBcStBp ?? 0
  const bcCents = redBcBp > 0 ? applyComplementBp(comMva, redBcBp) : comMva

  const aliqBp = requireAliq(rule, 'p_icms_st_bp', rule.pIcmsStBp, `CST ${behavior.cst} (ICMS-ST)`)
  // O ST é o que falta para chegar à carga total — por isso desconta o próprio.
  // MVA baixa com alíquota igual pode dar negativo; nesse caso não há ST a pagar.
  const valorCents = clampZero(applyBp(bcCents, aliqBp) - icmsProprioCents)

  return { bcCents, mvaBp, aliqBp, redBcBp, modBcSt: rule.modBcSt ?? null, valorCents }
}

/**
 * ST retido anteriormente (CST 60).
 *
 * Não há imposto a recolher: a mercadoria já foi tributada na cadeia. Os
 * valores são informativos, mas a SEFAZ os confere — e o destinatário precisa
 * deles para creditar.
 */
function calcIcmsStRetido(
  rule: TaxRule,
  behavior: CstBehavior,
  values: OperationValues,
  warnings: string[],
): IcmsStRetidoBreakdown {
  if (!behavior.calculaStRetido) return { bcCents: 0, aliqBp: 0, valorCents: 0 }

  // vBCSTRet é campo POR ITEM: proporcional à quantidade daquele item, e o
  // valor real vem rateado do XML da compra. Ler a coluna da regra como valor
  // absoluto fazia toda venda daquele produto declarar a mesma base, vendendo
  // 1 ou 100 — e CST 60 é justamente o caso central do negócio (academia
  // revendendo suplemento comprado com ST retido).
  let bcCents: number
  if (values.vBcStRetCents !== undefined) {
    bcCents = assertInteger('vBcStRetCents', values.vBcStRetCents)
  } else {
    const unitario = rule.vBcStRetUnitCents ?? 0
    if (unitario === 0) {
      warnings.push(
        `CST ${behavior.cst} declara ST retido anteriormente e não há base informada — nem por item (vindo da compra) nem como pauta unitária na regra. O destinatário não consegue creditar sem esse valor.`,
      )
    }
    bcCents = applyPerUnit(values.quantityMilli, unitario)
  }

  const aliqBp = rule.pStBp ?? 0
  return { bcCents, aliqBp, valorCents: applyBp(bcCents, aliqBp) }
}

function calcContribution(
  cst: string | null | undefined,
  aliqBp: number | null | undefined,
  aliqUnitCents: number | null | undefined,
  baseCents: number,
  quantityMilli: number,
): ContributionBreakdown {
  // Alíquota por unidade tem precedência: quando ela existe, o tributo é
  // monofásico por quantidade e o percentual não se aplica.
  const porQuantidade = (aliqUnitCents ?? 0) > 0
  const valorCents = porQuantidade
    ? applyPerUnit(quantityMilli, aliqUnitCents ?? 0)
    : applyBp(baseCents, aliqBp ?? 0)

  return {
    cst: cst ?? null,
    // `<PISQtde>` declara quantidade, não base em valor.
    bcCents: porQuantidade ? 0 : baseCents,
    aliqBp: porQuantidade ? 0 : (aliqBp ?? 0),
    aliqUnitCents: aliqUnitCents ?? 0,
    valorCents,
    porQuantidade,
  }
}

function calcIpi(rule: TaxRule, baseCents: number): IpiBreakdown {
  const aliqBp = rule.ipiAliqBp ?? 0
  return {
    cst: rule.ipiCst ?? null,
    bcCents: aliqBp > 0 ? baseCents : 0,
    aliqBp,
    valorCents: applyBp(baseCents, aliqBp),
  }
}

function calcIss(rule: TaxRule, baseCents: number): IssBreakdown {
  const aliqBp = rule.issAliqBp ?? 0
  return {
    bcCents: aliqBp > 0 ? baseCents : 0,
    aliqBp,
    valorCents: applyBp(baseCents, aliqBp),
    retido: rule.issRetido,
    codigoServico: rule.codigoServico ?? null,
    localPrestacao: rule.issLocalPrestacao ?? null,
  }
}

/**
 * Retenções na fonte do **documento inteiro**.
 *
 * Deliberadamente fora de `calculateTax`, que é por item: os dois pisos legais
 * incidem sobre o pagamento, não sobre a linha da nota. Apurar por item e
 * somar fragmentava o limite — uma NFS-e de 4 itens de R$ 600,00 apurava
 * R$ 9,00 de IRRF em cada, todos abaixo do piso, e a nota inteira saía sem
 * retenção quando o devido eram R$ 36,00 sobre os R$ 2.400,00. O DARF também é
 * um só: somar valores arredondados item a item diverge do apurado sobre o
 * total.
 *
 * @param totalDocumentoCents Soma de `baseOperacaoCents` dos itens.
 * @throws {TaxConfigurationError} se um tributo está marcado para reter sem alíquota.
 */
export function calculateRetentions(
  rule: TaxRule,
  totalDocumentoCents: number,
): RetentionBreakdown {
  assertInteger('totalDocumentoCents', totalDocumentoCents)
  const dispensadas: string[] = []

  // IRRF: o piso incide sobre o IMPOSTO apurado (RIR/2018, art. 785).
  let irrfCents = rule.irrfRetido
    ? applyBp(
        totalDocumentoCents,
        requireAliq(rule, 'irrf_aliq_bp', rule.irrfAliqBp, 'IRRF retido'),
      )
    : 0
  if (irrfCents > 0 && irrfCents <= IRRF_PISO_CENTS) {
    dispensadas.push(
      `IRRF de R$ ${formatReais(irrfCents)} dispensado (piso de R$ 10,00, RIR art. 785)`,
    )
    irrfCents = 0
  }

  // PCC: alíquotas PRÓPRIAS de retenção. Cair na alíquota de saída coincide no
  // Simples e no Presumido cumulativo, mas no Lucro Real a saída é 1,65%/7,6%
  // contra 0,65%/3% da retenção — mais que o dobro do devido.
  let csllCents = rule.csllRetido
    ? applyBp(
        totalDocumentoCents,
        requireAliq(rule, 'csll_aliq_bp', rule.csllAliqBp, 'CSLL retida'),
      )
    : 0
  let pisCents = rule.pisRetido
    ? applyBp(
        totalDocumentoCents,
        requireAliq(rule, 'pis_retido_aliq_bp', rule.pisRetidoAliqBp, 'PIS retido'),
      )
    : 0
  let cofinsCents = rule.cofinsRetido
    ? applyBp(
        totalDocumentoCents,
        requireAliq(rule, 'cofins_retido_aliq_bp', rule.cofinsRetidoAliqBp, 'COFINS retida'),
      )
    : 0

  // A dispensa é do DARF único (código 5952), então avalia a soma dos três —
  // não cada um isolado. O tenant pode elevar o piso, nunca reduzi-lo.
  const pisoPcc = Math.max(rule.retencaoMinimaCents ?? 0, PCC_DISPENSA_VALOR_RETIDO_CENTS)
  const somaPcc = sumCents(csllCents, pisCents, cofinsCents)
  if (somaPcc > 0 && somaPcc <= pisoPcc) {
    dispensadas.push(
      `PIS/COFINS/CSLL de R$ ${formatReais(somaPcc)} dispensados (piso de R$ ${formatReais(pisoPcc)} sobre o valor retido, Lei 10.833/2003 art. 31 § 3º com redação da Lei 13.137/2015)`,
    )
    csllCents = 0
    pisCents = 0
    cofinsCents = 0
  }

  // INSS sem dispensa por piso, de propósito. Há regra de valor mínimo de
  // recolhimento, mas ela manda ACUMULAR para a competência seguinte, não
  // deixar de reter — e acumulação é da folha, não da emissão. Reter a menos
  // é infração da fonte; na dúvida, retém.
  const inssCents = rule.inssRetido
    ? applyBp(
        totalDocumentoCents,
        requireAliq(rule, 'inss_aliq_bp', rule.inssAliqBp, 'INSS retido'),
      )
    : 0

  return {
    irrfCents,
    inssCents,
    csllCents,
    pisCents,
    cofinsCents,
    totalCents: sumCents(irrfCents, inssCents, csllCents, pisCents, cofinsCents),
    dispensadas,
  }
}

/** Armadilha 8 — `cStat 1021` quando o grupo sai em CST que não o admite. */
function shouldEmitIbsCbs(cstIbsCbs: string | null | undefined): boolean {
  if (!cstIbsCbs) return false
  return !IBS_CBS_CST_SEM_GRUPO.some((prefix) => cstIbsCbs.startsWith(prefix))
}

function formatReais(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  return `${sign}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, '0')}`
}

/**
 * Soma os totais da nota a partir dos itens.
 *
 * Armadilha 3: `vTotTrib` do total **tem** que ser a soma dos itens, ou a
 * SEFAZ devolve rejeição 685. Existir como função — em vez de cada chamador
 * somar do seu jeito — é o que garante que a mutação de um item e a do total
 * nunca saiam de sincronia.
 */
export function sumBreakdowns(items: TaxBreakdown[]): {
  baseOperacaoCents: number
  icmsCents: number
  icmsStCents: number
  ipiCents: number
  pisCents: number
  cofinsCents: number
  issCents: number
  vTotTribCents: number
} {
  const pick = (fn: (b: TaxBreakdown) => number) => sumCents(...items.map(fn))
  return {
    baseOperacaoCents: pick((b) => b.baseOperacaoCents),
    icmsCents: pick((b) => b.icms.valorCents),
    icmsStCents: pick((b) => b.icmsSt.valorCents),
    ipiCents: pick((b) => b.ipi.valorCents),
    pisCents: pick((b) => b.pis.valorCents),
    cofinsCents: pick((b) => b.cofins.valorCents),
    issCents: pick((b) => b.iss.valorCents),
    vTotTribCents: pick((b) => b.vTotTribCents),
  }
}

export { BP_SCALE }
