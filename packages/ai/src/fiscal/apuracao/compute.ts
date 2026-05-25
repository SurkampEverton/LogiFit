/**
 * Calculadoras da Apuração Fiscal Mensal — Sprint 37a (ADR 0100).
 *
 * Funções puras. Sem side effect, sem DB, sem fetch. Recebem input + tabelas,
 * retornam output canônico + memorial estruturado.
 *
 * Validação: testes unit cobrem 12+ cenários canônicos + casos de borda.
 */
import {
  LUCRO_PRESUMIDO_ATIVIDADE,
  LUCRO_PRESUMIDO_COFINS_RATE_BP,
  LUCRO_PRESUMIDO_CSLL_RATE_BP,
  LUCRO_PRESUMIDO_IRPJ_ADICIONAL_RATE_BP,
  LUCRO_PRESUMIDO_IRPJ_RATE_BP,
  LUCRO_PRESUMIDO_PIS_RATE_BP,
  MEI_RBT12_CEILING_CENTS,
  MEI_VALOR_AMBOS_CENTS,
  MEI_VALOR_COMERCIO_CENTS,
  MEI_VALOR_SERVICO_CENTS,
  SIMPLES_RBT12_CEILING_CENTS,
  findSimplesBracket,
} from './simples-tables'
import type { AggregationInput, AggregationResult, FiscalSimplesAnexo, MemorialLine } from './types'

/**
 * Aplica fórmula Simples Nacional: aliquota_efetiva = (rbt12 × nom - parc) / rbt12
 *
 * Retorna alíquota efetiva em basis points + memorial detalhado.
 */
export function calculateSimplesNacional(input: AggregationInput): AggregationResult {
  const memorial: MemorialLine[] = []
  const receitaTotal = input.receitaServicosCents + input.receitaMercadoriasCents
  const rbt12 = input.rbt12Cents ?? 0
  const anexo: FiscalSimplesAnexo = input.anexo ?? 'III'

  memorial.push({
    step: 1,
    label: 'Receita bruta de serviços (NFS-e)',
    valueCents: input.receitaServicosCents,
  })
  memorial.push({
    step: 2,
    label: 'Receita bruta de mercadorias (NF-e + NFC-e)',
    valueCents: input.receitaMercadoriasCents,
  })
  memorial.push({
    step: 3,
    label: 'Receita bruta total do mês',
    formula: 'serviços + mercadorias',
    valueCents: receitaTotal,
  })
  memorial.push({
    step: 4,
    label: 'Receita bruta últimos 12 meses (RBT12)',
    valueCents: rbt12,
  })

  // RBT12 = 0 → primeira apuração; receita do mês × alíquota da faixa 1
  if (rbt12 === 0) {
    memorial.push({
      step: 5,
      label: 'Primeira apuração',
      note: 'RBT12=0 indica que esta é a primeira apuração ou recém-aderiu ao Simples. Aplicada alíquota da faixa 1 do anexo selecionado.',
    })
  }

  if (rbt12 > SIMPLES_RBT12_CEILING_CENTS) {
    memorial.push({
      step: 5,
      label: '⚠ RBT12 excedeu o teto do Simples (R$ 4.800.000,00)',
      note: 'Migração obrigatória pra Lucro Presumido ou Real no ano seguinte. Apuração deste mês ainda usa última faixa do Simples; consulte contador.',
    })
  }

  // Faixa pra cálculo: se rbt12=0, usa bracket 1; senão lookup normal
  const lookupRbt12 = rbt12 === 0 ? 1 : rbt12
  const bracket = findSimplesBracket(anexo, lookupRbt12, input.competenciaDate)

  if (!bracket) {
    // RBT12 estourou teto — usa última faixa
    const fallback =
      anexo === 'III'
        ? findSimplesBracket('III', SIMPLES_RBT12_CEILING_CENTS - 1, input.competenciaDate)
        : findSimplesBracket('V', SIMPLES_RBT12_CEILING_CENTS - 1, input.competenciaDate)
    if (!fallback) {
      throw new Error(`Bracket Simples não encontrado pra competência ${input.competenciaDate}`)
    }
    return calculateWithBracket(input, fallback, memorial, true, receitaTotal, rbt12, anexo)
  }

  return calculateWithBracket(input, bracket, memorial, false, receitaTotal, rbt12, anexo)
}

function calculateWithBracket(
  _input: AggregationInput,
  bracket: ReturnType<typeof findSimplesBracket> & object,
  memorial: MemorialLine[],
  ceilingExceeded: boolean,
  receitaTotal: number,
  rbt12: number,
  anexo: FiscalSimplesAnexo,
): AggregationResult {
  memorial.push({
    step: memorial.length + 1,
    label: `Faixa Simples Anexo ${anexo} bracket ${bracket.bracket}`,
    note: `Alíquota nominal: ${(bracket.aliquotaNominalBp / 100).toFixed(2)}%; parcela a deduzir: R$ ${(bracket.parcelaDeduzirCents / 100).toFixed(2)}`,
  })

  let aliquotaEfetivaBp: number
  if (rbt12 === 0) {
    // Primeira apuração: usa alíquota nominal da bracket 1 direto
    aliquotaEfetivaBp = bracket.aliquotaNominalBp
    memorial.push({
      step: memorial.length + 1,
      label: 'Alíquota efetiva (primeira apuração)',
      formula: 'alíquota nominal da faixa 1',
      valueCents: aliquotaEfetivaBp,
      note: '% representado em basis points (600 = 6.00%)',
    })
  } else {
    // Fórmula efetiva: ((rbt12 × nom) - parc) / rbt12
    // Em basis points: ((rbt12 × nom_bp / 10000) - parc) × 10000 / rbt12
    const aliquotaEfetivaRatio =
      (rbt12 * bracket.aliquotaNominalBp - bracket.parcelaDeduzirCents * 10_000) / rbt12
    aliquotaEfetivaBp = Math.round(aliquotaEfetivaRatio)
    // Sanity: clamp 0-10000
    aliquotaEfetivaBp = Math.max(0, Math.min(10_000, aliquotaEfetivaBp))
    memorial.push({
      step: memorial.length + 1,
      label: 'Alíquota efetiva',
      formula: `((${rbt12} × ${bracket.aliquotaNominalBp}) - ${bracket.parcelaDeduzirCents} × 10000) / ${rbt12}`,
      valueCents: aliquotaEfetivaBp,
      note: `${(aliquotaEfetivaBp / 100).toFixed(2)}% sobre a receita do mês`,
    })
  }

  // Imposto = receita_mes × aliquota_efetiva
  const imposto = Math.round((receitaTotal * aliquotaEfetivaBp) / 10_000)
  memorial.push({
    step: memorial.length + 1,
    label: 'Imposto estimado (pré-DAS)',
    formula: `receita_total × alíquota_efetiva = ${receitaTotal} × ${aliquotaEfetivaBp}bp`,
    valueCents: imposto,
    note: 'Sprint 38 gera DAS oficial com código de barras',
  })

  if (ceilingExceeded) {
    memorial.push({
      step: memorial.length + 1,
      label: 'Atenção',
      note: 'Cálculo usa última faixa do Simples por RBT12 acima do teto. Resultado é estimativa; consulte contador pra apuração definitiva.',
    })
  }

  return {
    regime: 'simples_nacional',
    receitaTotalCents: receitaTotal,
    rbt12Cents: rbt12,
    aliquotaEfetivaBp,
    impostoApuradoCents: imposto,
    memorial,
  }
}

/**
 * Lucro Presumido — estimativa simplificada IRPJ + CSLL + PIS + COFINS.
 *
 * Assume atividade `SERVICO_SAUDE` por default (rede saúde MVP); operador
 * informa atividade no form da Server Action. Adicional IRPJ aplicado se
 * receita do mês × 3 (proxy trimestre) > R$ 60k.
 */
export function calculateLucroPresumido(
  input: AggregationInput,
  atividade: keyof typeof LUCRO_PRESUMIDO_ATIVIDADE = 'SERVICO_SAUDE',
): AggregationResult {
  const memorial: MemorialLine[] = []
  const receitaTotal = input.receitaServicosCents + input.receitaMercadoriasCents
  const presuncao = LUCRO_PRESUMIDO_ATIVIDADE[atividade]

  memorial.push({
    step: 1,
    label: 'Receita bruta total do mês',
    valueCents: receitaTotal,
  })
  memorial.push({
    step: 2,
    label: `Atividade: ${atividade}`,
    note: `Presunção IRPJ ${presuncao.presunaoIrpjBp / 100}%; presunção CSLL ${presuncao.presuncaoCsllBp / 100}%`,
  })

  // Base IRPJ = receita × presunção
  const baseIrpj = Math.round((receitaTotal * presuncao.presunaoIrpjBp) / 10_000)
  memorial.push({
    step: 3,
    label: 'Base de cálculo IRPJ',
    formula: `${receitaTotal} × ${presuncao.presunaoIrpjBp}bp`,
    valueCents: baseIrpj,
  })

  // IRPJ = base × 15%
  const irpj = Math.round((baseIrpj * LUCRO_PRESUMIDO_IRPJ_RATE_BP) / 10_000)
  memorial.push({
    step: 4,
    label: 'IRPJ (15%)',
    formula: 'base_irpj × 15%',
    valueCents: irpj,
  })

  // Adicional 10% se base trimestral (proxy: base × 3) > R$ 60k
  const baseTrimestreProxy = baseIrpj * 3
  let irpjAdicional = 0
  if (baseTrimestreProxy > 60_000_00 /* R$ 60k em centavos */) {
    const excedente = (baseTrimestreProxy - 60_000_00) / 3 // mensal proporcional
    irpjAdicional = Math.round((excedente * LUCRO_PRESUMIDO_IRPJ_ADICIONAL_RATE_BP) / 10_000)
    memorial.push({
      step: 5,
      label: 'Adicional IRPJ (10% sobre excedente R$ 60k/trimestre)',
      formula: 'excedente trimestral / 3 × 10%',
      valueCents: irpjAdicional,
    })
  }

  // Base CSLL = receita × presunção
  const baseCsll = Math.round((receitaTotal * presuncao.presuncaoCsllBp) / 10_000)
  const csll = Math.round((baseCsll * LUCRO_PRESUMIDO_CSLL_RATE_BP) / 10_000)
  memorial.push({
    step: memorial.length + 1,
    label: 'Base de cálculo CSLL',
    valueCents: baseCsll,
  })
  memorial.push({
    step: memorial.length + 1,
    label: 'CSLL (9%)',
    valueCents: csll,
  })

  // PIS + COFINS cumulativos sobre receita bruta
  const pis = Math.round((receitaTotal * LUCRO_PRESUMIDO_PIS_RATE_BP) / 10_000)
  const cofins = Math.round((receitaTotal * LUCRO_PRESUMIDO_COFINS_RATE_BP) / 10_000)
  memorial.push({
    step: memorial.length + 1,
    label: 'PIS cumulativo (0.65%)',
    valueCents: pis,
  })
  memorial.push({
    step: memorial.length + 1,
    label: 'COFINS cumulativo (3%)',
    valueCents: cofins,
  })

  const total = irpj + irpjAdicional + csll + pis + cofins
  memorial.push({
    step: memorial.length + 1,
    label: 'Imposto estimado total (pré-DARF + pré-DARFs PIS/COFINS)',
    formula: 'IRPJ + Adicional + CSLL + PIS + COFINS',
    valueCents: total,
    note: 'Sprint 38 gera DARFs individuais com códigos de receita.',
  })

  return {
    regime: 'lucro_presumido',
    receitaTotalCents: receitaTotal,
    rbt12Cents: null,
    aliquotaEfetivaBp: receitaTotal === 0 ? 0 : Math.round((total * 10_000) / receitaTotal),
    impostoApuradoCents: total,
    memorial,
  }
}

/**
 * Lucro Real — apuração parcial. Sprint 37a entrega só estrutura. Lucro Real
 * exige despesas dedutíveis + adições + exclusões fiscais — escopo Sprint 37c
 * integra com `cost_entries` Sprint 14.
 */
export function calculateLucroReal(input: AggregationInput): AggregationResult {
  const memorial: MemorialLine[] = []
  const receitaTotal = input.receitaServicosCents + input.receitaMercadoriasCents

  memorial.push({
    step: 1,
    label: 'Receita bruta total do mês',
    valueCents: receitaTotal,
  })
  memorial.push({
    step: 2,
    label: 'Lucro Real — apuração parcial',
    note: 'LogiFit Sprint 37a calcula apenas a base bruta. Cálculo definitivo requer balancete + despesas dedutíveis + adições + exclusões fiscais (Sprint 37c integra com cost_entries). Consulte contador.',
  })
  memorial.push({
    step: 3,
    label: 'PIS não-cumulativo (1.65%)',
    formula: 'receita × 1.65% (não-cumulativo permite crédito de insumos)',
    valueCents: Math.round((receitaTotal * 165) / 10_000),
    note: 'Cálculo bruto; crédito de insumos não considerado.',
  })
  memorial.push({
    step: 4,
    label: 'COFINS não-cumulativo (7.6%)',
    valueCents: Math.round((receitaTotal * 760) / 10_000),
    note: 'Cálculo bruto; crédito de insumos não considerado.',
  })

  // Estimativa MUITO grosseira: IRPJ + CSLL = 34% sobre 32% da receita (proxy serviço)
  const baseProxy = Math.round((receitaTotal * 3200) / 10_000)
  const irpjCsllProxy = Math.round((baseProxy * 3400) / 10_000)
  memorial.push({
    step: 5,
    label: 'IRPJ + CSLL (proxy grosseiro 34% sobre 32% receita)',
    valueCents: irpjCsllProxy,
    note: 'Cálculo real depende de lucro líquido após despesas. Use como ESTIMATIVA TETO; contador apresenta valor preciso.',
  })

  const pisCofins =
    Math.round((receitaTotal * 165) / 10_000) + Math.round((receitaTotal * 760) / 10_000)
  const total = pisCofins + irpjCsllProxy

  return {
    regime: 'lucro_real',
    receitaTotalCents: receitaTotal,
    rbt12Cents: null,
    aliquotaEfetivaBp: receitaTotal === 0 ? 0 : Math.round((total * 10_000) / receitaTotal),
    impostoApuradoCents: total,
    memorial,
  }
}

/** MEI — valor fixo mensal (DAS-MEI). */
export function calculateMEI(
  input: AggregationInput,
  atividade: 'servico' | 'comercio' | 'ambos' = 'servico',
): AggregationResult {
  const memorial: MemorialLine[] = []
  const receitaTotal = input.receitaServicosCents + input.receitaMercadoriasCents
  const rbt12 = input.rbt12Cents ?? 0

  const valorFixo =
    atividade === 'servico'
      ? MEI_VALOR_SERVICO_CENTS
      : atividade === 'comercio'
        ? MEI_VALOR_COMERCIO_CENTS
        : MEI_VALOR_AMBOS_CENTS

  memorial.push({
    step: 1,
    label: 'Receita bruta total do mês',
    valueCents: receitaTotal,
  })
  memorial.push({
    step: 2,
    label: 'RBT12 — receita bruta últimos 12 meses',
    valueCents: rbt12,
  })
  memorial.push({
    step: 3,
    label: `Atividade: ${atividade}`,
    note: `Valor fixo DAS-MEI: R$ ${(valorFixo / 100).toFixed(2)}/mês`,
  })

  if (rbt12 > MEI_RBT12_CEILING_CENTS) {
    memorial.push({
      step: 4,
      label: '⚠ RBT12 excedeu o teto MEI (R$ 81.000)',
      note: 'Desenquadramento obrigatório. Migração pra Simples Nacional no mês seguinte.',
    })
  }

  memorial.push({
    step: memorial.length + 1,
    label: 'Imposto fixo do mês (DAS-MEI)',
    valueCents: valorFixo,
    note: 'Sprint 38 gera DAS-MEI com código de barras.',
  })

  return {
    regime: 'mei',
    receitaTotalCents: receitaTotal,
    rbt12Cents: rbt12,
    aliquotaEfetivaBp: receitaTotal === 0 ? 0 : Math.round((valorFixo * 10_000) / receitaTotal),
    impostoApuradoCents: valorFixo,
    memorial,
  }
}

/** Dispatcher que escolhe calculator por regime. */
export function computeAggregation(input: AggregationInput): AggregationResult {
  switch (input.regime) {
    case 'simples_nacional':
      return calculateSimplesNacional(input)
    case 'lucro_presumido':
      return calculateLucroPresumido(input)
    case 'lucro_real':
      return calculateLucroReal(input)
    case 'mei':
      return calculateMEI(input)
    default: {
      const _exhaustive: never = input.regime
      throw new Error(`Regime tributário não suportado: ${_exhaustive as string}`)
    }
  }
}
