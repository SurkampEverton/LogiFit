/**
 * Camada 2 — Resolução: escolhe **UMA** regra fiscal — Sprint 41b (ADR 0108).
 *
 * Três passos, nesta ordem: filtro de compatibilidade → score de especificidade
 * → desempate determinístico.
 *
 * **O desempate não é detalhe.** Sem ele, duas regras igualmente específicas
 * deixavam a escolha na ordem física em que o Postgres devolveu as linhas — e o
 * mesmo produto tributava diferente entre duas vendas, sem nada ter mudado.
 * É incidente real da implementação de referência, não hipótese: por isso
 * `priority DESC → updatedAt DESC → id DESC` é total e testado com 100
 * execuções.
 *
 * Função pura: recebe as candidatas já carregadas. Não toca banco, não lê
 * relógio (a data de referência vem no request). Isso é o que permite rodar o
 * modo sombra sobre milhares de emissões passadas sem custo.
 */

import {
  type ClientType,
  NoMatchingRuleError,
  type RejectionReason,
  type ResolveRequest,
  type ResolvedTax,
  type TaxRule,
} from './models'

/**
 * Peso de cada critério casado.
 *
 * A ordem importa mais que os números absolutos: NCM identifica **o produto**,
 * então uma regra que casa NCM deve sempre vencer uma que casa só a UF. CEST e
 * município vêm logo abaixo por também discriminarem caso específico; UF e
 * unidade são recortes mais amplos; `clientType` e `regime` são desempate fino.
 */
const SCORE = {
  ncm: 4,
  cest: 3,
  municipio: 3,
  /** UF única é mais específica que uma lista de UFs. */
  ufSingle: 2,
  ufPair: 1,
  unit: 2,
  clientType: 1,
  regime: 1,
} as const

/**
 * Resolve a regra aplicável.
 *
 * @param candidates Regras do perfil + natureza, já carregadas do banco.
 * @throws {NoMatchingRuleError} com contexto e contagem de descartes por motivo.
 */
export function resolveTaxRule(candidates: TaxRule[], req: ResolveRequest): ResolvedTax {
  const rejections = new Map<RejectionReason, number>()
  const compatible: TaxRule[] = []

  for (const rule of candidates) {
    const reason = incompatibilityReason(rule, req)
    if (reason) {
      rejections.set(reason, (rejections.get(reason) ?? 0) + 1)
      continue
    }
    compatible.push(rule)
  }

  if (compatible.length === 0) {
    throw new NoMatchingRuleError(req, rejections, candidates.length)
  }

  const scored = compatible
    .map((rule) => ({ rule, score: scoreRule(rule, req) }))
    .sort((a, b) => (a.score !== b.score ? b.score - a.score : compareTiebreak(a.rule, b.rule)))

  // `scored` nunca é vazio aqui — `compatible.length > 0` foi checado acima.
  const winner = scored[0] as { rule: TaxRule; score: number }

  return {
    rule: winner.rule,
    score: winner.score,
    competitors: scored.length - 1,
    cfop: pickCfop(winner.rule, req),
  }
}

/**
 * Desempate **determinístico e total**: `priority DESC → updatedAt DESC → id DESC`.
 *
 * O terceiro critério existe para que nunca reste empate: `priority` e
 * `updatedAt` podem coincidir (duas regras salvas no mesmo lote, por exemplo),
 * e `id` é único por construção.
 */
export function compareTiebreak(a: TaxRule, b: TaxRule): number {
  if (a.priority !== b.priority) return b.priority - a.priority
  const byUpdated = b.updatedAt.getTime() - a.updatedAt.getTime()
  if (byUpdated !== 0) return byUpdated
  return b.id.localeCompare(a.id)
}

/** Score de especificidade. Quanto mais critérios casados, mais específica. */
export function scoreRule(rule: TaxRule, req: ResolveRequest): number {
  let score = 0

  if (rule.ncm && normalizeCode(rule.ncm) === normalizeCode(req.ncm)) score += SCORE.ncm
  if (rule.cest && normalizeCode(rule.cest) === normalizeCode(req.cest)) score += SCORE.cest
  if (rule.municipioIncidencia && rule.municipioIncidencia === req.municipioIbge) {
    score += SCORE.municipio
  }

  score += ufScore(rule.ufOrigem)
  score += ufScore(rule.ufDestino)

  if (rule.unitId && rule.unitId === req.unitId) score += SCORE.unit
  if (rule.clientType) score += SCORE.clientType
  if (rule.regime) score += SCORE.regime

  return score
}

/**
 * Primeiro motivo pelo qual a regra não serve, ou `null` se serve.
 *
 * Devolve o **primeiro** motivo, não todos: para a mensagem de erro o que
 * importa é o padrão agregado ("12 regras caíram por natureza"), e enumerar
 * todos os motivos de cada regra só ruído.
 */
function incompatibilityReason(rule: TaxRule, req: ResolveRequest): RejectionReason | null {
  if (!rule.active) return 'inactive'
  if (rule.operationNature !== req.operationNature) return 'operation_nature'
  if (!isWithinValidity(rule, req.at)) return 'validity'

  if (!ufMatches(rule.ufOrigem, req.ufOrigem)) return 'uf_origem'
  if (!ufMatches(rule.ufDestino, req.ufDestino)) return 'uf_destino'

  // ⚠️ Armadilha 1: regra com `clientType` preenchido é descartada quando o
  // request não o informa — e o fluxo de venda não informa. O motivo é
  // reportado com a instrução ("deixe vazio em regra de venda") justamente
  // porque a tela de regras não deixa isso óbvio.
  if (rule.clientType && rule.clientType !== req.clientType) return 'client_type'
  if (rule.regime && rule.regime !== req.regime) return 'regime'
  if (rule.unitId && rule.unitId !== req.unitId) return 'unit'

  if (rule.ncm && normalizeCode(rule.ncm) !== normalizeCode(req.ncm)) return 'ncm'
  if (rule.cest && normalizeCode(rule.cest) !== normalizeCode(req.cest)) return 'cest'
  if (rule.municipioIncidencia && rule.municipioIncidencia !== req.municipioIbge) {
    return 'municipio'
  }

  return null
}

/** Regra vigente na data de referência. Limites inclusivos. */
function isWithinValidity(rule: TaxRule, at: Date): boolean {
  if (rule.validFrom && at < rule.validFrom) return false
  if (rule.validUntil && at > rule.validUntil) return false
  return true
}

/** Lista vazia ou nula é curinga — cobre qualquer UF. */
function ufMatches(list: string[] | null | undefined, uf: string): boolean {
  if (!list || list.length === 0) return true
  return list.includes(uf)
}

function ufScore(list: string[] | null | undefined): number {
  if (!list || list.length === 0) return 0
  if (list.length === 1) return SCORE.ufSingle
  if (list.length === 2) return SCORE.ufPair
  return 0
}

/**
 * Normaliza NCM/CEST: só dígitos.
 *
 * `2710.12.59` e `27101259` são o mesmo código; o operador digita de um jeito,
 * o cadastro do fornecedor vem de outro. Comparar sem normalizar descartaria
 * regra legítima.
 */
function normalizeCode(value: string | null | undefined): string {
  return (value ?? '').replace(/\D/g, '')
}

/**
 * CFOP aplicável: interno quando a operação não cruza a UF, externo quando cruza.
 *
 * A regra guarda os dois porque a mesma operação comercial muda de CFOP só por
 * causa do destino, e obrigar o operador a cadastrar duas regras idênticas para
 * isso multiplicaria a configuração sem informação nova.
 */
function pickCfop(rule: TaxRule, req: ResolveRequest): string | null {
  const interestadual = req.ufOrigem !== req.ufDestino
  if (interestadual) return rule.cfopExterno ?? rule.cfop ?? null
  return rule.cfop ?? null
}

export type { ClientType }
