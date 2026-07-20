/**
 * Tabelas oficiais de retenção vigentes — Sprint 15b (ADR 0061).
 *
 * **Fontes normativas:**
 *   - IRRF PF: Tabela Progressiva Mensal RFB (Lei 11.482/2007 com alterações)
 *   - INSS: alíquota 11% do contribuinte individual + teto do salário de
 *     contribuição (Portaria interministerial anual)
 *   - PIS/COFINS/CSLL: Lei 10.833/2003 art. 30-31 (4,65% agregado, piso R$ 10)
 *   - IRRF PJ serviço: Lei 9.430/1996 art. 64 + IN RFB 1.234/2012 (1,5%)
 *   - ISS: LC 116/2003 (2% a 5% — alíquota vem do catálogo municipal do tenant)
 *
 * **Atualização anual obrigatória** (ADR 0061 §riscos): as tabelas mudam por
 * portaria/lei. Quando mudarem, adicionar NOVA constante versionada e apontar
 * `CURRENT_*` — nunca editar a antiga (apuração retroativa precisa da vigente
 * na época). Alerta de revisão: janeiro de cada ano.
 */

import type { ProgressiveBracket, TaxNatureDefinition } from './types'

/** Vigência das tabelas abaixo — exibida na UI pra operador conferir. */
export const TAX_TABLES_VERSION = '2026-01'

/**
 * Tabela progressiva IRRF mensal 2026 (valores em centavos).
 * Faixa isenta até R$ 2.259,20; alíquotas 7,5% / 15% / 22,5% / 27,5%.
 */
export const IRRF_BRACKETS_2026: ProgressiveBracket[] = [
  { upToCents: 225920, rateBp: 0, deductionCents: 0 },
  { upToCents: 282665, rateBp: 750, deductionCents: 16944 },
  { upToCents: 375105, rateBp: 1500, deductionCents: 38144 },
  { upToCents: 466468, rateBp: 2250, deductionCents: 66277 },
  { upToCents: null, rateBp: 2750, deductionCents: 89600 },
]

/** Teto do salário de contribuição INSS 2026 (base máxima de retenção). */
export const INSS_CEILING_CENTS_2026 = 812000

/** Alíquota do contribuinte individual (autônomo) — 11%. */
export const INSS_RATE_BP = 1100

/** Piso de dispensa das retenções federais (Lei 10.833 art. 31). */
export const FEDERAL_MIN_BASE_CENTS = 1000

/**
 * 10 naturezas tributárias globais curadas (ADR 0061 §seed).
 * Tenant herda todas; pode desativar ou criar custom, nunca editar as globais.
 */
export const GLOBAL_TAX_NATURES: TaxNatureDefinition[] = [
  {
    code: 'servico_prestado_pj_geral',
    label: 'Serviço prestado por PJ (geral)',
    appliesTo: 'ap',
    regulatoryReference: 'Lei 10.833/2003 art. 30-31 + Lei 9.430/1996 art. 64',
    rules: [
      { tax: 'pis', kind: 'fixed', rateBp: 65, minBaseCents: FEDERAL_MIN_BASE_CENTS },
      { tax: 'cofins', kind: 'fixed', rateBp: 300, minBaseCents: FEDERAL_MIN_BASE_CENTS },
      { tax: 'csll', kind: 'fixed', rateBp: 100, minBaseCents: FEDERAL_MIN_BASE_CENTS },
      { tax: 'irrf', kind: 'fixed', rateBp: 150, minBaseCents: FEDERAL_MIN_BASE_CENTS },
    ],
  },
  {
    code: 'servico_prestado_pj_saude',
    label: 'Serviço de saúde prestado por PJ',
    appliesTo: 'ap',
    regulatoryReference: 'Lei 10.833/2003 + IN RFB 1.234/2012 (verificar não-cumulatividade)',
    rules: [
      { tax: 'pis', kind: 'fixed', rateBp: 65, minBaseCents: FEDERAL_MIN_BASE_CENTS },
      { tax: 'cofins', kind: 'fixed', rateBp: 300, minBaseCents: FEDERAL_MIN_BASE_CENTS },
      { tax: 'csll', kind: 'fixed', rateBp: 100, minBaseCents: FEDERAL_MIN_BASE_CENTS },
      { tax: 'irrf', kind: 'fixed', rateBp: 150, minBaseCents: FEDERAL_MIN_BASE_CENTS },
    ],
  },
  {
    code: 'autonomo_rpa_pf',
    label: 'Autônomo PF (RPA)',
    appliesTo: 'both',
    regulatoryReference: 'Lei 8.212/1991 (INSS 11%) + Tabela IRRF RFB + LC 116/2003 (ISS)',
    rules: [
      {
        tax: 'inss',
        kind: 'capped',
        rateBp: INSS_RATE_BP,
        maxBaseCents: INSS_CEILING_CENTS_2026,
      },
      { tax: 'irrf', kind: 'progressive', brackets: IRRF_BRACKETS_2026 },
    ],
  },
  {
    code: 'aluguel_pj',
    label: 'Aluguel pago a PJ',
    appliesTo: 'ap',
    regulatoryReference: 'Lei 10.833/2003 art. 30 + Lei 9.430/1996',
    rules: [
      { tax: 'pis', kind: 'fixed', rateBp: 65, minBaseCents: FEDERAL_MIN_BASE_CENTS },
      { tax: 'cofins', kind: 'fixed', rateBp: 300, minBaseCents: FEDERAL_MIN_BASE_CENTS },
      { tax: 'csll', kind: 'fixed', rateBp: 100, minBaseCents: FEDERAL_MIN_BASE_CENTS },
      { tax: 'irrf', kind: 'fixed', rateBp: 150, minBaseCents: FEDERAL_MIN_BASE_CENTS },
    ],
  },
  {
    code: 'aluguel_pf',
    label: 'Aluguel pago a PF',
    appliesTo: 'ap',
    regulatoryReference: 'Tabela IRRF RFB (RIR/2018 art. 688)',
    rules: [{ tax: 'irrf', kind: 'progressive', brackets: IRRF_BRACKETS_2026 }],
  },
  {
    code: 'software_saas_pj',
    label: 'Software / SaaS (PJ)',
    appliesTo: 'ap',
    regulatoryReference: 'Lei 10.833/2003 + LC 116/2003 item 1.05 (ISS condicional)',
    rules: [
      { tax: 'pis', kind: 'fixed', rateBp: 65, minBaseCents: FEDERAL_MIN_BASE_CENTS },
      { tax: 'cofins', kind: 'fixed', rateBp: 300, minBaseCents: FEDERAL_MIN_BASE_CENTS },
      { tax: 'csll', kind: 'fixed', rateBp: 100, minBaseCents: FEDERAL_MIN_BASE_CENTS },
      { tax: 'irrf', kind: 'fixed', rateBp: 150, minBaseCents: FEDERAL_MIN_BASE_CENTS },
    ],
  },
  {
    code: 'comissao_autonomo_pf',
    label: 'Comissão a autônomo PF',
    appliesTo: 'professional_contract',
    regulatoryReference: 'Lei 8.212/1991 + Tabela IRRF RFB',
    rules: [
      {
        tax: 'inss',
        kind: 'capped',
        rateBp: INSS_RATE_BP,
        maxBaseCents: INSS_CEILING_CENTS_2026,
      },
      { tax: 'irrf', kind: 'progressive', brackets: IRRF_BRACKETS_2026 },
    ],
  },
  {
    code: 'servico_transporte_pj',
    label: 'Transporte prestado por PJ',
    appliesTo: 'ap',
    regulatoryReference: 'Lei 10.833/2003 + Lei 9.430/1996 art. 64 (IRRF 1%)',
    rules: [
      { tax: 'pis', kind: 'fixed', rateBp: 65, minBaseCents: FEDERAL_MIN_BASE_CENTS },
      { tax: 'cofins', kind: 'fixed', rateBp: 300, minBaseCents: FEDERAL_MIN_BASE_CENTS },
      { tax: 'csll', kind: 'fixed', rateBp: 100, minBaseCents: FEDERAL_MIN_BASE_CENTS },
      { tax: 'irrf', kind: 'fixed', rateBp: 100, minBaseCents: FEDERAL_MIN_BASE_CENTS },
    ],
  },
  {
    code: 'utilidade_publica',
    label: 'Utilidade pública (água/luz/telefone)',
    appliesTo: 'ap',
    regulatoryReference: 'IN RFB 1.234/2012 art. 4 (concessionária dispensada)',
    rules: [],
  },
  {
    code: 'simples_nacional_prestador',
    label: 'Prestador optante do Simples Nacional',
    appliesTo: 'both',
    regulatoryReference: 'LC 123/2006 art. 13 §3 (dispensa retenção federal)',
    rules: [],
  },
]

export function findGlobalTaxNature(code: string): TaxNatureDefinition | undefined {
  return GLOBAL_TAX_NATURES.find((n) => n.code === code)
}
