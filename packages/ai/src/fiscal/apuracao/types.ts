/**
 * Tipos canônicos da Apuração Fiscal Mensal — Sprint 37a (ADR 0100).
 */

export type FiscalTaxRegime = 'simples_nacional' | 'lucro_presumido' | 'lucro_real' | 'mei'

export type FiscalSimplesAnexo = 'III' | 'V'

export type FiscalEmissionKind =
  | 'nfse'
  | 'nfe'
  | 'nfce'
  | 'nfe_return'
  | 'nfe_transfer'
  | 'nfe_conserto_out'
  | 'nfe_conserto_return'
  | 'nfe_self_entry'

/** Linha do memorial — passo-a-passo do cálculo. Renderizada igual em UI + PDF. */
export interface MemorialLine {
  step: number
  /** Label curto (≤ 60 chars) — ex: "Receita bruta de serviços" */
  label: string
  /** Fórmula renderizada — ex: "rbt12 × alíquota nominal" */
  formula?: string
  /** Valor calculado da linha em centavos */
  valueCents?: number
  /** Nota livre — ex: "Anexo V aplicado por Fator R < 28%" */
  note?: string
}

/** Bracket vigente da tabela Simples. */
export interface SimplesBracket {
  anexo: FiscalSimplesAnexo
  bracket: number // 1..6
  rbt12FromCents: number
  rbt12ToCents: number | null // null = última faixa
  aliquotaNominalBp: number // basis points (1500 = 15%)
  parcelaDeduzirCents: number
  validFrom: string // YYYY-MM-DD
  validTo: string | null
}

/** Input do cálculo. */
export interface AggregationInput {
  regime: FiscalTaxRegime
  /** Receita bruta de serviços (NFS-e) do mês em centavos */
  receitaServicosCents: number
  /** Receita bruta de mercadorias (NF-e + NFC-e) do mês em centavos */
  receitaMercadoriasCents: number
  /** RBT12 — receita bruta acumulada últimos 12 meses (obrigatório p/ Simples) */
  rbt12Cents?: number
  /** Anexo aplicável (III default; V quando Fator R < 28%) */
  anexo?: FiscalSimplesAnexo
  /**
   * Fator R = folha últimos 12m / receita últimos 12m.
   * < 0.28 → Anexo V; >= 0.28 → Anexo III. Sprint 37a MVP: operador informa
   * manualmente (form); Sprint 37c auto-calc lendo commissions + folha.
   */
  fatorR?: number
  /** Data de competência (mês/ano da apuração). Usado pra lookup de bracket vigente. */
  competenciaDate: string // 'YYYY-MM-DD' (1º dia do mês)
}

/** Output canônico do cálculo. */
export interface AggregationResult {
  regime: FiscalTaxRegime
  receitaTotalCents: number
  rbt12Cents: number | null
  aliquotaEfetivaBp: number | null
  impostoApuradoCents: number
  memorial: MemorialLine[]
}
