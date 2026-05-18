/**
 * Classificador de output IA pra interpretação de exames — Sprint 33 (ADR 0050).
 *
 * Bloqueia frases diagnósticas / prescritivas em output de IA antes de mostrar
 * ao profissional. Vocabulário **conservador é mandatório** (regra 28 CFM
 * 2.454/2026 + SaMD ANVISA RDC 657/2022): IA pode "sugerir", "indicar",
 * "compatível com" — NUNCA "diagnostica", "tem [doença]", "prescrever".
 *
 * Função pura (sem IO). Caller chama com output do LLM antes de persistir.
 */

export type ClassifierStrictness = 'strict' | 'moderate'

/**
 * Frases proibidas (regex case-insensitive). Patterns expressos como string
 * — sem `^` ou `$` (match em qualquer posição do texto).
 *
 * **strict** bloqueia tudo abaixo + frases moderadas.
 * **moderate** bloqueia só as mais flagrantes (diagnóstico direto, prescrição).
 */
const STRICT_BLOCKED_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\bdiagnóstico\s+de\s+\w+/i, reason: 'IA não diagnostica' },
  { pattern: /\bdiagnostico\s+de\s+\w+/i, reason: 'IA não diagnostica' },
  { pattern: /\bpaciente\s+(tem|possui|apresenta)\s+(diabetes|hipertensão|hipertensao|câncer|cancer|hipotireoidismo|hipertireoidismo|anemia)\b/i, reason: 'Afirmação diagnóstica direta' },
  { pattern: /\bvocê\s+(tem|possui|sofre\s+de)\b/i, reason: 'Endereçamento direto ao paciente é proibido' },
  { pattern: /\bvc\s+(tem|possui)\b/i, reason: 'Endereçamento direto ao paciente' },
  { pattern: /\bprescrev[oe]r?\b/i, reason: 'IA não prescreve medicamento' },
  { pattern: /\btome\s+\d+\s*(mg|ml|g|ui)\b/i, reason: 'Prescrição posológica' },
  { pattern: /\biniciar?\s+(tratamento|medicação|medicacao)\b/i, reason: 'Decisão terapêutica é ato profissional' },
  { pattern: /\b(comece|comecar|começar)\s+(a\s+)?(tomar|usar)\b/i, reason: 'Decisão terapêutica' },
  { pattern: /\bsubstituir?\s+(medicamento|remédio|remedio)\b/i, reason: 'Decisão terapêutica' },
  { pattern: /\bcontraindicad[oa]\s+para\s+\w+/i, reason: 'Decisão clínica direta' },
]

const MODERATE_BLOCKED_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\bconfirma\s+\w+/i, reason: 'IA não confirma; sugere apenas' },
  { pattern: /\bgarante?\s+que\b/i, reason: 'Confiança excessiva' },
  { pattern: /\bcerteza\s+(de|que)\b/i, reason: 'IA não tem certeza diagnóstica' },
  { pattern: /\bdefinitivamente\b/i, reason: 'Linguagem absoluta' },
  { pattern: /\bcomprovadamente\s+(tem|possui)\b/i, reason: 'Confirmação diagnóstica' },
]

/**
 * Vocabulário conservador aceito (allowlist mental — não bloqueia, só
 * documenta o estilo esperado):
 *   "sugere", "compatível com", "pode indicar", "padrão sugestivo de",
 *   "achado a esclarecer", "exame complementar pode ajudar"
 */

export interface ClassificationResult {
  /** True se output passou (sem termos bloqueados) */
  ok: boolean
  /** Termos que dispararam bloqueio (com reason) */
  blockedTerms: Array<{ matched: string; reason: string }>
  /** Texto original (não modificado) */
  originalText: string
}

/**
 * Avalia texto de interpretação contra patterns. Strict é o default.
 */
export function classifyInterpretationOutput(
  text: string,
  strictness: ClassifierStrictness = 'strict',
): ClassificationResult {
  const patterns =
    strictness === 'strict'
      ? [...STRICT_BLOCKED_PATTERNS, ...MODERATE_BLOCKED_PATTERNS]
      : STRICT_BLOCKED_PATTERNS

  const blockedTerms: ClassificationResult['blockedTerms'] = []
  for (const { pattern, reason } of patterns) {
    const match = text.match(pattern)
    if (match) {
      blockedTerms.push({ matched: match[0], reason })
    }
  }

  return {
    ok: blockedTerms.length === 0,
    blockedTerms,
    originalText: text,
  }
}

/**
 * Classifica um set de strings (ex: array de hipóteses) — retorna OK se TODAS
 * passaram. Útil pra validar JSON completo de interpretação.
 */
export function classifyInterpretationFields(
  fields: string[],
  strictness: ClassifierStrictness = 'strict',
): ClassificationResult {
  const allBlocked: ClassificationResult['blockedTerms'] = []
  for (const f of fields) {
    const r = classifyInterpretationOutput(f, strictness)
    allBlocked.push(...r.blockedTerms)
  }
  return {
    ok: allBlocked.length === 0,
    blockedTerms: allBlocked,
    originalText: fields.join(' | '),
  }
}

/**
 * Mensagem amigável pra mostrar ao profissional quando classificador bloqueia.
 */
export function getBlockedMessage(result: ClassificationResult): string {
  if (result.ok) return ''
  const terms = result.blockedTerms.map((t) => `"${t.matched}" (${t.reason})`).join(', ')
  return `Interpretação IA foi bloqueada pelo classificador clínico. Termos detectados: ${terms}. Profissional precisa interpretar manualmente.`
}
