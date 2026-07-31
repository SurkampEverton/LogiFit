import { describe, expect, it } from 'vitest'
import {
  type CstBehavior,
  IRRF_PISO_CENTS,
  PCC_DISPENSA_VALOR_RETIDO_CENTS,
  TaxConfigurationError,
  calculateRetentions,
  calculateTax,
  resolveCsosn,
  sumBreakdowns,
} from './calculate'
import type { ResolvedTax, TaxRule } from './models'
import { NonIntegerMoneyError } from './money'

function rule(overrides: Partial<TaxRule> = {}): TaxRule {
  return {
    id: 'rule-1',
    fiscalProfileId: 'profile-1',
    operationNature: 'REVENDA',
    priority: 0,
    active: true,
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    issRetido: false,
    irrfRetido: false,
    inssRetido: false,
    csllRetido: false,
    pisRetido: false,
    cofinsRetido: false,
    ...overrides,
  }
}

function resolved(overrides: Partial<TaxRule> = {}): ResolvedTax {
  return { rule: rule(overrides), score: 4, competitors: 0, cfop: '5102' }
}

function behavior(cst: string, flags: Partial<CstBehavior> = {}): CstBehavior {
  return {
    cst,
    calculaIcmsProprio: false,
    calculaSt: false,
    calculaReducaoBc: false,
    calculaDiferimento: false,
    calculaDesoneracao: false,
    calculaStRetido: false,
    requerModBc: false,
    requerModBcSt: false,
    requerMvaOuPauta: false,
    ...flags,
  }
}

/** CSTs como estão seedados em `tax_ref_icms_cst`. */
const CST_00 = behavior('00', { calculaIcmsProprio: true, requerModBc: true })
const CST_10 = behavior('10', {
  calculaIcmsProprio: true,
  calculaSt: true,
  requerModBc: true,
  requerModBcSt: true,
  requerMvaOuPauta: true,
})
const CST_20 = behavior('20', {
  calculaIcmsProprio: true,
  calculaReducaoBc: true,
  requerModBc: true,
})
const CST_40 = behavior('40', { calculaDesoneracao: true })
const CST_51 = behavior('51', {
  calculaIcmsProprio: true,
  calculaDiferimento: true,
  requerModBc: true,
})
const CST_60 = behavior('60', { calculaStRetido: true })

const values = { produtoCents: 100_000, quantityMilli: 1_000 }

describe('ICMS próprio', () => {
  it('calcula sobre o valor da operação', () => {
    const r = calculateTax({
      resolved: resolved({ icmsCst: '00', icmsAliqBp: 1_800, modBc: '3' }),
      behavior: CST_00,
      values,
    })
    expect(r.icms.bcCents).toBe(100_000)
    expect(r.icms.valorCents).toBe(18_000)
    expect(r.warnings).toHaveLength(0)
  })

  it('soma frete, seguro e outras despesas e subtrai desconto', () => {
    const r = calculateTax({
      resolved: resolved({ icmsCst: '00', icmsAliqBp: 1_800, modBc: '3' }),
      behavior: CST_00,
      values: {
        produtoCents: 100_000,
        freteCents: 5_000,
        seguroCents: 1_000,
        outrasDespesasCents: 2_000,
        descontoCents: 8_000,
        quantityMilli: 1_000,
      },
    })
    expect(r.baseOperacaoCents).toBe(100_000)
    expect(r.icms.valorCents).toBe(18_000)
  })

  it('trata desconto maior que a operação como base zero, com aviso', () => {
    const r = calculateTax({
      resolved: resolved({ icmsCst: '00', icmsAliqBp: 1_800 }),
      behavior: CST_00,
      values: { produtoCents: 10_000, descontoCents: 15_000, quantityMilli: 1_000 },
    })
    expect(r.baseOperacaoCents).toBe(0)
    expect(r.icms.valorCents).toBe(0)
    expect(r.warnings.join()).toMatch(/Desconto.*maior que o valor/)
  })

  it('avisa quando o CST exige modBC e a regra não tem', () => {
    const r = calculateTax({
      resolved: resolved({ icmsCst: '00', icmsAliqBp: 1_800 }),
      behavior: CST_00,
      values,
    })
    expect(r.warnings.join()).toMatch(/modalidade de base de cálculo/)
  })
})

describe('redução de base (CST 20)', () => {
  it('reduz a base do ICMS', () => {
    const r = calculateTax({
      resolved: resolved({ icmsCst: '20', icmsAliqBp: 1_800, icmsReducaoBcBp: 3_000, modBc: '3' }),
      behavior: CST_20,
      values,
    })
    expect(r.icms.bcCents).toBe(70_000)
    expect(r.icms.valorCents).toBe(12_600)
  })

  it('avisa e calcula cheio quando o percentual não foi informado', () => {
    const r = calculateTax({
      resolved: resolved({ icmsCst: '20', icmsAliqBp: 1_800, modBc: '3' }),
      behavior: CST_20,
      values,
    })
    expect(r.icms.bcCents).toBe(100_000)
    expect(r.warnings.join()).toMatch(/não informou percentual/)
  })

  // ARMADILHA 4 — a redução é benefício de ICMS e não se propaga.
  // Propagar subestima os federais, que é diferença cobrada com multa.
  it('NÃO propaga a redução para PIS, COFINS e IPI', () => {
    const r = calculateTax({
      resolved: resolved({
        icmsCst: '20',
        icmsAliqBp: 1_800,
        icmsReducaoBcBp: 3_000,
        modBc: '3',
        pisAliqBp: 165,
        cofinsAliqBp: 760,
        ipiAliqBp: 500,
      }),
      behavior: CST_20,
      values,
    })
    expect(r.icms.bcCents).toBe(70_000)
    // Base cheia nos demais — não 70.000.
    expect(r.pis.bcCents).toBe(100_000)
    expect(r.cofins.bcCents).toBe(100_000)
    expect(r.ipi.bcCents).toBe(100_000)
    expect(r.pis.valorCents).toBe(1_650)
    expect(r.cofins.valorCents).toBe(7_600)
    expect(r.ipi.valorCents).toBe(5_000)
  })
})

describe('diferimento (CST 51)', () => {
  it('separa valor diferido do devido', () => {
    const r = calculateTax({
      resolved: resolved({ icmsCst: '51', icmsAliqBp: 1_800, pDiferimentoBp: 3_300, modBc: '3' }),
      behavior: CST_51,
      values,
    })
    expect(r.icms.valorOperacaoCents).toBe(18_000)
    expect(r.icms.valorDiferidoCents).toBe(5_940)
    expect(r.icms.valorCents).toBe(12_060)
  })

  it('avisa quando o percentual diferido não foi informado', () => {
    const r = calculateTax({
      resolved: resolved({ icmsCst: '51', icmsAliqBp: 1_800, modBc: '3' }),
      behavior: CST_51,
      values,
    })
    expect(r.icms.valorDiferidoCents).toBe(0)
    expect(r.warnings.join()).toMatch(/percentual diferido/)
  })
})

describe('desoneração (CST 40)', () => {
  it('zera o imposto e informa o valor desonerado', () => {
    const r = calculateTax({
      resolved: resolved({ icmsCst: '40', icmsAliqBp: 1_800, motDesIcms: '9' }),
      behavior: CST_40,
      values,
    })
    expect(r.icms.valorCents).toBe(0)
    expect(r.icms.desoneradoCents).toBe(18_000)
    expect(r.warnings).toHaveLength(0)
  })

  it('avisa quando falta o motivo da desoneração', () => {
    const r = calculateTax({
      resolved: resolved({ icmsCst: '40', icmsAliqBp: 1_800 }),
      behavior: CST_40,
      values,
    })
    expect(r.warnings.join()).toMatch(/motivo da desoneração/)
  })
})

describe('ICMS-ST', () => {
  it('inclui o IPI na base e desconta o ICMS próprio', () => {
    const r = calculateTax({
      resolved: resolved({
        icmsCst: '10',
        icmsAliqBp: 1_200,
        pIcmsStBp: 1_800,
        mvaStBp: 4_000,
        ipiAliqBp: 1_000,
        modBc: '3',
        modBcSt: '4',
      }),
      behavior: CST_10,
      values,
    })
    // base 100.000 + IPI 10.000 = 110.000; MVA 40% → 154.000
    expect(r.ipi.valorCents).toBe(10_000)
    expect(r.icmsSt.bcCents).toBe(154_000)
    // 18% de 154.000 = 27.720, menos ICMS próprio 12.000
    expect(r.icms.valorCents).toBe(12_000)
    expect(r.icmsSt.valorCents).toBe(15_720)
  })

  it('aplica redução de base do ST', () => {
    const r = calculateTax({
      resolved: resolved({
        icmsCst: '10',
        icmsAliqBp: 1_200,
        pIcmsStBp: 1_800,
        mvaStBp: 4_000,
        pRedBcStBp: 2_000,
        modBc: '3',
        modBcSt: '4',
      }),
      behavior: CST_10,
      values,
    })
    expect(r.icmsSt.bcCents).toBe(112_000)
  })

  // MVA baixa com alíquota igual à interna dá ST negativo — que não existe.
  // Com mvaStBp 0 o guard de MVA devolvia empty antes de chegar no clampZero,
  // e o teste passava sem exercitar nada. MVA de 5% atravessa o guard.
  it('nunca devolve ST negativo', () => {
    const r = calculateTax({
      resolved: resolved({
        icmsCst: '10',
        icmsAliqBp: 1_800,
        pIcmsStBp: 400,
        mvaStBp: 500,
        modBc: '3',
        modBcSt: '4',
      }),
      behavior: CST_10,
      values,
    })
    // BC ST = 105.000; 4% = 4.200; menos ICMS próprio 18.000 = -13.800 → 0
    expect(r.icmsSt.bcCents).toBe(105_000)
    expect(r.icms.valorCents).toBe(18_000)
    expect(r.icmsSt.valorCents).toBe(0)
  })

  it('avisa quando o CST exige modBCST e a regra não tem', () => {
    const r = calculateTax({
      resolved: resolved({
        icmsCst: '10',
        icmsAliqBp: 1_200,
        pIcmsStBp: 1_800,
        mvaStBp: 4_000,
        modBc: '3',
      }),
      behavior: CST_10,
      values,
    })
    expect(r.warnings.join()).toMatch(/modalidade de base do ICMS-ST/)
  })

  // vBCSTRet é campo POR ITEM. Lido como valor absoluto da regra, toda venda
  // declarava a mesma base vendendo 1 ou 10 — e CST 60 é o caso central do
  // negócio (academia revendendo suplemento comprado com ST retido).
  it('escala o ST retido com a quantidade do item', () => {
    const um = calculateTax({
      resolved: resolved({ icmsCst: '60', vBcStRetUnitCents: 12_000, pStBp: 1_800 }),
      behavior: CST_60,
      values: { produtoCents: 15_000, quantityMilli: 1_000 },
    })
    const dez = calculateTax({
      resolved: resolved({ icmsCst: '60', vBcStRetUnitCents: 12_000, pStBp: 1_800 }),
      behavior: CST_60,
      values: { produtoCents: 150_000, quantityMilli: 10_000 },
    })
    expect(um.icmsStRetido.bcCents).toBe(12_000)
    expect(dez.icmsStRetido.bcCents).toBe(120_000)
  })

  it('prefere a base do item vinda da compra à pauta da regra', () => {
    const r = calculateTax({
      resolved: resolved({ icmsCst: '60', vBcStRetUnitCents: 12_000, pStBp: 1_800 }),
      behavior: CST_60,
      values: { produtoCents: 150_000, quantityMilli: 10_000, vBcStRetCents: 118_500 },
    })
    expect(r.icmsStRetido.bcCents).toBe(118_500)
  })

  it('avisa quando CST 60 não tem base de ST retido em lugar nenhum', () => {
    const r = calculateTax({
      resolved: resolved({ icmsCst: '60', pStBp: 1_800 }),
      behavior: CST_60,
      values,
    })
    expect(r.warnings.join()).toMatch(/não há base informada/)
  })

  it('avisa e zera quando o CST exige MVA e a regra não tem', () => {
    const r = calculateTax({
      resolved: resolved({ icmsCst: '10', icmsAliqBp: 1_200, pIcmsStBp: 1_800, modBc: '3' }),
      behavior: CST_10,
      values,
    })
    expect(r.icmsSt.valorCents).toBe(0)
    expect(r.warnings.join()).toMatch(/não tem MVA nem pauta/)
  })

  it('informa ST retido anteriormente sem cobrar de novo (CST 60)', () => {
    const r = calculateTax({
      resolved: resolved({ icmsCst: '60', vBcStRetUnitCents: 120_000, pStBp: 1_800 }),
      behavior: CST_60,
      values,
    })
    expect(r.icms.valorCents).toBe(0)
    expect(r.icmsSt.valorCents).toBe(0)
    expect(r.icmsStRetido.valorCents).toBe(21_600)
  })
})

describe('PIS/COFINS', () => {
  it('calcula por percentual', () => {
    const r = calculateTax({
      resolved: resolved({
        icmsCst: '00',
        icmsAliqBp: 1_800,
        modBc: '3',
        pisAliqBp: 165,
        cofinsAliqBp: 760,
      }),
      behavior: CST_00,
      values,
    })
    expect(r.pis.porQuantidade).toBe(false)
    expect(r.pis.valorCents).toBe(1_650)
    expect(r.cofins.valorCents).toBe(7_600)
  })

  // `<PISQtde>` e `<PISAliq>` só se distinguem pela unidade da alíquota;
  // trocar um pelo outro é rejeição garantida.
  it('calcula por quantidade quando há alíquota por unidade', () => {
    const r = calculateTax({
      resolved: resolved({
        icmsCst: '00',
        icmsAliqBp: 1_800,
        modBc: '3',
        pisAliqBp: 165,
        pisAliqUnitCents: 30,
      }),
      behavior: CST_00,
      values: { produtoCents: 100_000, quantityMilli: 2_500 },
    })
    expect(r.pis.porQuantidade).toBe(true)
    expect(r.pis.valorCents).toBe(75)
    // Base em valor não se aplica ao grupo por quantidade.
    expect(r.pis.bcCents).toBe(0)
    expect(r.pis.aliqBp).toBe(0)
  })
})

describe('ISS', () => {
  it('calcula sobre o valor do serviço', () => {
    const r = calculateTax({
      resolved: resolved({
        icmsCst: '00',
        issAliqBp: 500,
        issRetido: true,
        codigoServico: '17.24',
      }),
      behavior: behavior('00'),
      values,
    })
    expect(r.iss.valorCents).toBe(5_000)
    expect(r.iss.retido).toBe(true)
    expect(r.iss.codigoServico).toBe('17.24')
  })
})

describe('retenções (do documento, não do item)', () => {
  const doc = (over: Partial<TaxRule>, totalCents: number) =>
    calculateRetentions(rule(over), totalCents)

  it('retém IRRF acima do piso', () => {
    const r = doc({ irrfRetido: true, irrfAliqBp: 150 }, 100_000)
    expect(r.irrfCents).toBe(1_500)
    expect(r.dispensadas).toHaveLength(0)
  })

  // O piso do IRRF incide sobre o IMPOSTO (RIR art. 785)...
  it('dispensa IRRF de valor até R$ 10,00', () => {
    const r = doc({ irrfRetido: true, irrfAliqBp: 150 }, 60_000)
    expect(900).toBeLessThanOrEqual(IRRF_PISO_CENTS)
    expect(r.irrfCents).toBe(0)
    expect(r.dispensadas.join()).toMatch(/IRRF.*dispensado/)
  })

  // ...e o do PCC também, desde a Lei 13.137/2015. Os R$ 5.000,00 sobre o
  // PAGAMENTO foram revogados em 22/06/2015 — implementá-los faria o motor
  // deixar de reter em praticamente toda emissão de clínica ou academia.
  it('retém PCC em pagamento de R$ 3.000,00 — a regra dos R$ 5.000 está revogada', () => {
    const r = doc(
      {
        pisRetido: true,
        cofinsRetido: true,
        csllRetido: true,
        pisRetidoAliqBp: 65,
        cofinsRetidoAliqBp: 300,
        csllAliqBp: 100,
      },
      300_000,
    )
    expect(r.pisCents).toBe(1_950)
    expect(r.cofinsCents).toBe(9_000)
    expect(r.csllCents).toBe(3_000)
    expect(r.dispensadas).toHaveLength(0)
  })

  // A dispensa é do DARF único (5952): avalia a SOMA dos três, não cada um.
  it('dispensa os três em bloco quando a soma retida não passa de R$ 10,00', () => {
    const r = doc(
      {
        pisRetido: true,
        cofinsRetido: true,
        csllRetido: true,
        pisRetidoAliqBp: 65,
        cofinsRetidoAliqBp: 300,
        csllAliqBp: 100,
      },
      20_000,
    )
    // 4,65% de R$ 200,00 = R$ 9,30
    expect(r.pisCents + r.cofinsCents + r.csllCents).toBe(0)
    expect(r.dispensadas.join()).toMatch(/PIS\/COFINS\/CSLL.*dispensados/)
    expect(r.dispensadas.join()).toMatch(/13\.137/)
  })

  it('não dispensa quando só um dos três ficaria abaixo do piso', () => {
    const r = doc(
      { pisRetido: true, cofinsRetido: true, pisRetidoAliqBp: 65, cofinsRetidoAliqBp: 300 },
      30_000,
    )
    // PIS sozinho seria R$ 1,95, abaixo do piso; somado à COFINS passa.
    expect(r.pisCents).toBe(195)
    expect(r.cofinsCents).toBe(900)
  })

  it('deixa o tenant elevar o piso, nunca reduzi-lo', () => {
    const elevado = doc(
      { pisRetido: true, pisRetidoAliqBp: 65, retencaoMinimaCents: 100_000 },
      1_000_000,
    )
    expect(elevado.pisCents).toBe(0)

    const reduzido = doc({ pisRetido: true, pisRetidoAliqBp: 65, retencaoMinimaCents: 1 }, 20_000)
    expect(reduzido.pisCents).toBe(0)
    expect(PCC_DISPENSA_VALOR_RETIDO_CENTS).toBe(1_000)
  })

  // No Lucro Real a alíquota de saída é 1,65%/7,6% e a de retenção continua
  // 0,65%/3%. Cair na de saída retinha mais que o dobro do devido.
  it('usa a alíquota de retenção, não a de saída', () => {
    const r = doc(
      {
        pisRetido: true,
        cofinsRetido: true,
        pisAliqBp: 165,
        cofinsAliqBp: 760,
        pisRetidoAliqBp: 65,
        cofinsRetidoAliqBp: 300,
      },
      1_000_000,
    )
    expect(r.pisCents).toBe(6_500)
    expect(r.cofinsCents).toBe(30_000)
  })

  it('aborta quando marcado para reter sem alíquota de retenção', () => {
    expect(() => doc({ pisRetido: true }, 1_000_000)).toThrow(TaxConfigurationError)
    expect(() => doc({ pisRetido: true }, 1_000_000)).toThrow(/pis_retido_aliq_bp/)
  })

  it('retém INSS sem dispensa por piso', () => {
    const r = doc({ inssRetido: true, inssAliqBp: 1_100 }, 10_000)
    expect(r.inssCents).toBe(1_100)
  })

  // A falha que motivou tirar retenção do item: 4 linhas de R$ 600,00
  // apuravam R$ 9,00 cada, todas abaixo do piso, e a nota saía sem reter.
  it('avalia o piso sobre o documento, não sobre cada item', () => {
    const porItem = [1, 2, 3, 4].map(() => doc({ irrfRetido: true, irrfAliqBp: 150 }, 60_000))
    expect(porItem.every((r) => r.irrfCents === 0)).toBe(true)

    const porDocumento = doc({ irrfRetido: true, irrfAliqBp: 150 }, 240_000)
    expect(porDocumento.irrfCents).toBe(3_600)
  })
})

// ARMADILHA 2 — CSOSN gravado na coluna icms_cst por convenção histórica.
// Sem aceitar as duas formas, tenant do Simples emitia <CSOSN> vazio.
describe('armadilha 2 — CSOSN', () => {
  it('lê da coluna própria', () => {
    expect(resolveCsosn(rule({ csosn: '102' }))).toBe('102')
  })

  it('lê de icms_cst quando tem 3 dígitos', () => {
    expect(resolveCsosn(rule({ icmsCst: '102' }))).toBe('102')
  })

  it('não confunde CST de 2 dígitos com CSOSN', () => {
    expect(resolveCsosn(rule({ icmsCst: '00' }))).toBeNull()
  })

  it('nunca devolve CSOSN vazio para tenant do Simples', () => {
    const r = calculateTax({
      resolved: resolved({ icmsCst: '102', regime: 'simples_nacional' }),
      behavior: behavior('102'),
      values,
    })
    expect(r.icms.csosn).toBe('102')
  })
})

// ARMADILHA 3 — vTotTrib do total tem que ser a soma dos itens, ou é
// rejeição 685. Somar por uma função só é o que impede as duas saírem
// de sincronia.
describe('armadilha 3 — total igual à soma dos itens', () => {
  const item = (produtoCents: number) =>
    calculateTax({
      resolved: resolved({
        icmsCst: '00',
        icmsAliqBp: 1_800,
        pisAliqBp: 165,
        cofinsAliqBp: 760,
        modBc: '3',
      }),
      behavior: CST_00,
      values: { produtoCents, quantityMilli: 1_000 },
    })

  // Asserção sobre o INVARIANTE, não sobre uma reimplementação da soma: o
  // vTotTrib de cada item tem que ser a soma dos tributos daquele item.
  it('vTotTrib do item é a soma dos tributos do item', () => {
    const b = item(33_333)
    expect(b.vTotTribCents).toBe(
      b.icms.valorCents +
        b.icmsSt.valorCents +
        b.ipi.valorCents +
        b.pis.valorCents +
        b.cofins.valorCents +
        b.iss.valorCents,
    )
  })

  // Valores literais escritos à mão — se o cálculo mudar, o teste acusa, em
  // vez de acompanhar a mudança como fazia a versão anterior.
  it('bate com valores conferidos à mão', () => {
    const b = item(33_333)
    expect(b.icms.valorCents).toBe(6_000)
    expect(b.pis.valorCents).toBe(550)
    expect(b.cofins.valorCents).toBe(2_533)
    expect(b.vTotTribCents).toBe(9_083)
  })

  it('o total do documento é a soma dos itens, tributo a tributo', () => {
    const total = sumBreakdowns([item(33_333), item(66_667), item(1)])
    expect(total.baseOperacaoCents).toBe(100_001)
    expect(total.icmsCents).toBe(18_000)
    expect(total.vTotTribCents).toBe(
      total.icmsCents +
        total.icmsStCents +
        total.ipiCents +
        total.pisCents +
        total.cofinsCents +
        total.issCents,
    )
  })

  it('soma lista vazia como zero', () => {
    expect(sumBreakdowns([]).vTotTribCents).toBe(0)
  })
})

// ARMADILHA 8 — grupo IBSCBS em CST que não o admite devolve cStat 1021.
describe('armadilha 8 — grupo IBS/CBS', () => {
  const IBS_BASE = resolved({ icmsCst: '00', icmsAliqBp: 1_800, modBc: '3' })

  it('omite o grupo em CST 6xx e 7xx', () => {
    for (const cst of ['620', '600', '700', '790']) {
      const r = calculateTax({ resolved: IBS_BASE, behavior: CST_00, values, cstIbsCbs: cst })
      expect(r.emiteGrupoIbsCbs, `CST ${cst}`).toBe(false)
    }
  })

  it('emite o grupo nos demais CSTs', () => {
    const r = calculateTax({ resolved: IBS_BASE, behavior: CST_00, values, cstIbsCbs: '000' })
    expect(r.emiteGrupoIbsCbs).toBe(true)
  })

  it('omite o grupo quando não há CST de IBS/CBS', () => {
    const r = calculateTax({ resolved: IBS_BASE, behavior: CST_00, values })
    expect(r.emiteGrupoIbsCbs).toBe(false)
  })
})

describe('CST fora da tabela de referência', () => {
  // Conservador de propósito: cobra cheio em vez de omitir. Recolher a mais
  // é restituível; recolher a menos é autuação.
  it('calcula como CST 00 e avisa', () => {
    const r = calculateTax({
      resolved: resolved({ icmsCst: '99', icmsAliqBp: 1_800 }),
      behavior: null,
      values,
    })
    expect(r.icms.valorCents).toBe(18_000)
    expect(r.warnings.join()).toMatch(/CST 99 não está em tax_ref_icms_cst/)
  })
})

describe('integridade da aritmética', () => {
  it('recusa valor fracionário na entrada', () => {
    expect(() =>
      calculateTax({
        resolved: resolved({ icmsCst: '00', icmsAliqBp: 1_800 }),
        behavior: CST_00,
        values: { produtoCents: 100_000.5, quantityMilli: 1_000 },
      }),
    ).toThrow(NonIntegerMoneyError)
  })

  it('é determinístico em 100 execuções', () => {
    const run = () =>
      calculateTax({
        resolved: resolved({
          icmsCst: '10',
          icmsAliqBp: 1_200,
          pIcmsStBp: 1_800,
          mvaStBp: 4_000,
          ipiAliqBp: 1_000,
          pisAliqBp: 165,
          cofinsAliqBp: 760,
          modBc: '3',
          modBcSt: '4',
        }),
        behavior: CST_10,
        values: { produtoCents: 33_333, quantityMilli: 1_500 },
      })

    const primeiro = JSON.stringify(run())
    for (let i = 0; i < 100; i++) {
      expect(JSON.stringify(run())).toBe(primeiro)
    }
  })
})

// Regra 47 — nenhum default tributário inferido em silêncio. Nota rejeitada
// custa 5 minutos; nota autorizada e errada é passivo do cliente.
describe('regra 47 — aborta em vez de chutar', () => {
  it('recusa CST que declara ICMS devido sem alíquota', () => {
    expect(() =>
      calculateTax({ resolved: resolved({ icmsCst: '00', modBc: '3' }), behavior: CST_00, values }),
    ).toThrow(TaxConfigurationError)
  })

  it('nomeia o campo que falta', () => {
    expect(() =>
      calculateTax({ resolved: resolved({ icmsCst: '00', modBc: '3' }), behavior: CST_00, values }),
    ).toThrow(/icms_aliq_bp/)
  })

  it('recusa alíquota fora da faixa de 0 a 100%', () => {
    expect(() =>
      calculateTax({
        resolved: resolved({ icmsCst: '00', icmsAliqBp: 12_000, modBc: '3' }),
        behavior: CST_00,
        values,
      }),
    ).toThrow(/alíquota inválida/)
  })

  it('recusa ICMS-ST sem alíquota de ST', () => {
    expect(() =>
      calculateTax({
        resolved: resolved({
          icmsCst: '10',
          icmsAliqBp: 1_200,
          mvaStBp: 4_000,
          modBc: '3',
          modBcSt: '4',
        }),
        behavior: CST_10,
        values,
      }),
    ).toThrow(/p_icms_st_bp/)
  })

  // Erro de escala (120 em vez de 12) chega como 12000 bp e produzia ICMS
  // NEGATIVO, que o leiaute não admite e que contaminava o total da nota.
  it('recusa diferimento acima de 100%', () => {
    expect(() =>
      calculateTax({
        resolved: resolved({
          icmsCst: '51',
          icmsAliqBp: 1_800,
          pDiferimentoBp: 12_000,
          modBc: '3',
        }),
        behavior: CST_51,
        values,
      }),
    ).toThrow(/p_diferimento_bp/)
  })

  it('aceita diferimento de exatamente 100% e zera o ICMS devido', () => {
    const r = calculateTax({
      resolved: resolved({ icmsCst: '51', icmsAliqBp: 1_800, pDiferimentoBp: 10_000, modBc: '3' }),
      behavior: CST_51,
      values,
    })
    expect(r.icms.valorCents).toBe(0)
    expect(r.icms.valorDiferidoCents).toBe(18_000)
  })

  it('nunca devolve ICMS negativo', () => {
    const r = calculateTax({
      resolved: resolved({ icmsCst: '51', icmsAliqBp: 1_800, pDiferimentoBp: 9_999, modBc: '3' }),
      behavior: CST_51,
      values,
    })
    expect(r.icms.valorCents).toBeGreaterThanOrEqual(0)
    expect(r.vTotTribCents).toBeGreaterThanOrEqual(0)
  })
})
