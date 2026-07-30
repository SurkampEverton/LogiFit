/**
 * Tipos do motor tributário — Sprint 41b (ADR 0108, regra 47).
 *
 * Espelham as colunas de `tax_rules` (`packages/db/src/schema/taxengine.ts`),
 * mas o motor é **puro**: recebe as regras candidatas já carregadas e devolve a
 * escolhida. Nada aqui toca banco, o que permite testar resolução e cálculo sem
 * subir Postgres — e é o que torna o modo sombra barato de rodar.
 *
 * **Dinheiro e alíquota são inteiros.** Alíquota em basis points (1% = 100 bp),
 * valor em centavos. Float binário é proibido na cadeia fiscal (regra 47):
 * `0.1 + 0.2 !== 0.3` vira centavo errado na nota, e centavo errado em nota
 * autorizada é passivo fiscal do cliente, irreversível pelo LogiFit.
 */

/** Regime tributário do emitente. Casa com `tax_rules.regime`. */
export type TaxRegime = 'simples_nacional' | 'lucro_presumido' | 'lucro_real' | 'mei'

/** Tipo do destinatário. Casa com `tax_rules.client_type`. */
export type ClientType = 'PF' | 'PJ'

/**
 * Regra fiscal carregada do banco.
 *
 * Campos de contexto (`operationNature` até `municipioIncidencia`) formam a
 * chave de casamento; o resto é a carga fiscal que a regra devolve.
 */
export interface TaxRule {
  id: string
  fiscalProfileId: string

  // ─── Contexto ───────────────────────────────────────────────────────
  operationNature: string
  /** Vazio ou nulo = qualquer UF. */
  ufOrigem?: string[] | null
  ufDestino?: string[] | null
  clientType?: ClientType | null
  regime?: TaxRegime | null
  unitId?: string | null
  ncm?: string | null
  cest?: string | null
  municipioIncidencia?: string | null

  priority: number
  validFrom?: Date | null
  validUntil?: Date | null
  active: boolean
  updatedAt: Date

  // ─── Carga fiscal ───────────────────────────────────────────────────
  icmsCst?: string | null
  csosn?: string | null
  icmsAliqBp?: number | null
  icmsReducaoBcBp?: number | null
  origem?: string | null
  modBc?: string | null
  pDiferimentoBp?: number | null
  motDesIcms?: string | null

  mvaStBp?: number | null
  modBcSt?: string | null
  pRedBcStBp?: number | null
  pIcmsStBp?: number | null
  vBcStRetCents?: number | null
  pStBp?: number | null

  pisCst?: string | null
  pisAliqBp?: number | null
  pisAliqUnitCents?: number | null
  cofinsCst?: string | null
  cofinsAliqBp?: number | null
  cofinsAliqUnitCents?: number | null

  ipiCst?: string | null
  ipiAliqBp?: number | null

  issAliqBp?: number | null
  issRetido: boolean
  codigoServico?: string | null
  issLocalPrestacao?: 'P' | 'T' | null

  irrfAliqBp?: number | null
  irrfRetido: boolean
  inssAliqBp?: number | null
  inssRetido: boolean
  csllAliqBp?: number | null
  csllRetido: boolean
  pisRetido: boolean
  cofinsRetido: boolean
  retencaoMinimaCents?: number | null

  classTrib?: string | null
  aliqCbsBp?: number | null
  aliqIbsUfBp?: number | null
  aliqIbsMunicipioBp?: number | null

  cfop?: string | null
  cfopExterno?: string | null
}

/**
 * Contexto de uma emissão, contra o qual as regras são casadas.
 *
 * ⚠️ **`clientType` é opcional de propósito e isso tem consequência.** O fluxo
 * de venda (NF-e/NFC-e) **não** o preenche, e regra com `clientType` definido é
 * descartada nesse caso — armadilha 1. Em vez de esconder isso, o resolvedor
 * reporta quantas regras caíram por esse motivo quando nada casa.
 */
export interface ResolveRequest {
  fiscalProfileId: string
  operationNature: string
  ufOrigem: string
  ufDestino: string
  clientType?: ClientType | null
  regime?: TaxRegime | null
  unitId?: string | null
  ncm?: string | null
  cest?: string | null
  municipioIbge?: string | null
  /** Data de referência para vigência — injetada pelo caller, nunca `new Date()`. */
  at: Date
}

/** Regra escolhida + como ela foi escolhida (para auditoria e depuração). */
export interface ResolvedTax {
  rule: TaxRule
  /** Score de especificidade da regra vencedora. */
  score: number
  /** Quantas outras regras eram compatíveis — >0 significa que houve disputa. */
  competitors: number
  /** CFOP aplicável: interno ou interestadual, conforme UF origem × destino. */
  cfop: string | null
}

/** Por que cada regra candidata foi descartada. Alimenta a mensagem de erro. */
export type RejectionReason =
  | 'inactive'
  | 'operation_nature'
  | 'validity'
  | 'uf_origem'
  | 'uf_destino'
  | 'client_type'
  | 'regime'
  | 'unit'
  | 'ncm'
  | 'cest'
  | 'municipio'

/**
 * Nenhuma regra casou.
 *
 * Carrega **contexto e motivo de descarte**, não só "não achei". A causa nº 1
 * deste erro na implementação de referência é divergência de natureza da
 * operação; a nº 2 é `client_type` preenchido em regra de venda. Sem o
 * detalhamento, o operador olha uma tela de regras aparentemente corretas e não
 * tem como saber qual campo derrubou a dele.
 */
export class NoMatchingRuleError extends Error {
  constructor(
    readonly request: ResolveRequest,
    readonly rejections: Map<RejectionReason, number>,
    readonly candidatesConsidered: number,
  ) {
    super(NoMatchingRuleError.buildMessage(request, rejections, candidatesConsidered))
    this.name = 'NoMatchingRuleError'
  }

  private static buildMessage(
    req: ResolveRequest,
    rejections: Map<RejectionReason, number>,
    considered: number,
  ): string {
    const contexto = [
      `perfil=${req.fiscalProfileId}`,
      `natureza=${req.operationNature}`,
      `uf=${req.ufOrigem}→${req.ufDestino}`,
      `regime=${req.regime ?? '—'}`,
    ].join(' ')

    if (considered === 0) {
      return `Nenhuma regra fiscal cadastrada para este perfil e natureza de operação (${contexto}). Cadastre a regra em Configurações → Fiscal → Regras antes de emitir.`
    }

    const porMotivo = [...rejections.entries()]
      .filter(([, n]) => n > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([motivo, n]) => `${n} por ${MOTIVO_LABEL[motivo]}`)
      .join(', ')

    return `Nenhuma regra fiscal casou com o contexto da emissão (${contexto}). ${considered} regra(s) foram descartadas: ${porMotivo}. Ajuste a regra correspondente em Configurações → Fiscal → Regras.`
  }
}

const MOTIVO_LABEL: Record<RejectionReason, string> = {
  inactive: 'estar inativa',
  operation_nature: 'natureza da operação diferente',
  validity: 'vigência fora do período',
  uf_origem: 'UF de origem não coberta',
  uf_destino: 'UF de destino não coberta',
  // Nomeado de forma acionável: é a armadilha 1, e "tipo de cliente diferente"
  // não diria ao operador que a solução é deixar o campo vazio.
  client_type: 'tipo de cliente preenchido (deixe vazio em regra de venda)',
  regime: 'regime tributário diferente',
  unit: 'restrita a outra unidade',
  ncm: 'NCM diferente do produto',
  cest: 'CEST diferente do produto',
  municipio: 'município de incidência diferente',
}
