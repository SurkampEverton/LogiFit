/**
 * Classificador de output clínico + anti-prompt-injection (ADR 0015 + 0073
 * camada 5 + regra 28). Bloqueia respostas que parecem prescrição/diagnóstico
 * e detecta tentativa de tool calling sequestrado por injection.
 *
 * **Por que regex e não LLM-classifier?** Latency. Cada chamada já tem 2-3s de
 * cold path Vertex AI; adicionar segundo LLM dobra. Patterns curados cobrem
 * 90%+ do dataset de teste (DoD do Sprint 06). Falso positivo em conversa
 * legítima volta como `system_alerts severity=warning` pro DPO revisar.
 *
 * Aplicado em DOIS pontos:
 *   1. **Input** (anti-injection): após o user enviar a msg, antes de chamar LLM.
 *   2. **Output** (clínico): depois do LLM responder, antes de enviar pro user.
 */
import type { ClassifierResult } from './types'

// ─── Vocabulário proibido clínico (regra 28) ─────────────────────────────
/**
 * **Prescrição direta**: "prescrevo X", "tome X", "use X". Modelo deve sugerir,
 * nunca ordenar. Use 2ª pessoa imperativa é o gatilho.
 */
const PRESCRIPTION_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: 'prescribe_verb', re: /\b(prescrev[oae]|prescription)\b/i },
  { name: 'imperative_take', re: /\b(tome|use|aplique|administre|inj[eé]te)\s+\d+/i },
  {
    name: 'imperative_dosage',
    re: /\btome\s+\d+\s*(mg|g|ml|mcg|comprimid|c[áa]psula|gota)/i,
  },
  // Equivalentes en/es básicos pra i18n
  { name: 'imperative_take_en', re: /\btake\s+\d+\s*(mg|g|ml|mcg|pill|capsule|drop)/i },
  { name: 'imperative_take_es', re: /\btome\s+\d+\s*(mg|g|ml|mcg|pastilla|c[aá]psula|gota)/i },
]

/**
 * **Diagnóstico afirmativo**: "você tem [doença]", "voc[êe] est[áa] com X".
 * Sugestão diagnóstica deve ser hipotética ("pode indicar...").
 */
const DIAGNOSIS_PATTERNS: Array<{ name: string; re: RegExp }> = [
  {
    name: 'you_have_disease',
    re: /\bvoc[êe]\s+(tem|est[áa]\s+com)\s+(diabetes|hipertens[ãa]o|c[âa]ncer|covid|gripe|asma|depress[ãa]o|ansiedade|tdah|tea|autismo|alzheimer|parkinson|hiv|aids|hepatite|tuberculose|gastrite|[úu]lcera|art[rh]ose|art[rh]ite|fibromialgia|enxaqueca|migr[âa]nea)\b/i,
  },
  { name: 'you_have_en', re: /\byou have\s+(diabetes|hypertension|cancer|covid|flu|asthma)\b/i },
  {
    name: 'diagnostic_certain',
    re: /\b(diagnostic[oa]?|diagn[oó]stico)\s+(positivo|confirmad[oa]|de)\b/i,
  },
]

/**
 * **Termos absolutamente proibidos** — só profissional ICP-Brasil emite.
 */
const PROHIBITED_TERMS = [
  /\batestado m[eé]dico\b/i,
  /\bautoriza[çc][aã]o de medicamento\b/i,
  /\breceitu[áa]rio\b/i,
  /\bemiss[aã]o de receita\b/i,
]

// ─── Anti-prompt-injection ───────────────────────────────────────────────

const INJECTION_PATTERNS: Array<{ name: string; re: RegExp }> = [
  // Tentativa de redefinir comportamento
  { name: 'ignore_previous', re: /\bignore\s+(all\s+)?(previous|prior|above)\s+(instructions|rules)\b/i },
  { name: 'ignore_pt', re: /\bignore\s+(tudo\s+que\s+|todas?\s+as\s+)(instru[çc][õo]es|regras)\s+(acima|anteriores)\b/i },
  // System role injection
  { name: 'system_role_fake', re: /<\s*system\s*>|<\|im_start\|>system/i },
  // Tool exec direto (CL3 bypass attempt)
  { name: 'execute_tool', re: /\b(execute|chamar)\s+(tool|fun[çc][ãa]o)\b/i },
  // Prompt leak attempt
  { name: 'reveal_prompt', re: /\b(reveal|show|tell\s+me)\s+(your|the)\s+(system\s+)?prompt\b/i },
  // Code execution
  { name: 'code_exec', re: /\b(eval|exec|drop\s+table|delete\s+from)\b/i },
]

// ─── Classifiers públicos ────────────────────────────────────────────────

/**
 * Classifica output do LLM antes de mostrar ao user. Bloqueia se detecta
 * prescrição/diagnóstico/termo proibido.
 */
export function classifyOutput(text: string): ClassifierResult {
  if (!text) return { blocked: false }

  for (const { name, re } of PRESCRIPTION_PATTERNS) {
    const m = text.match(re)
    if (m) return { blocked: true, reason: 'prescription', match: name }
  }

  for (const { name, re } of DIAGNOSIS_PATTERNS) {
    const m = text.match(re)
    if (m) return { blocked: true, reason: 'diagnosis', match: name }
  }

  for (const re of PROHIBITED_TERMS) {
    const m = text.match(re)
    if (m) return { blocked: true, reason: 'prohibited_term', match: m[0] }
  }

  return { blocked: false }
}

/**
 * Classifica input do user antes de invocar LLM. Bloqueia se detecta
 * tentativa de injection (system role fake, ignore instructions, etc).
 */
export function classifyInput(text: string): ClassifierResult {
  if (!text) return { blocked: false }

  for (const { name, re } of INJECTION_PATTERNS) {
    const m = text.match(re)
    if (m) return { blocked: true, reason: 'injection_attempt', match: name }
  }

  return { blocked: false }
}

/**
 * Mensagem padrão de fallback quando classificador bloqueia output clínico.
 * Persona-aware (medico vs aluno).
 */
export function getBlockedOutputMessage(reason: ClassifierResult['reason']): string {
  switch (reason) {
    case 'prescription':
      return 'Não posso prescrever medicamentos ou doses. Procure um profissional habilitado (médico CRM, nutricionista CRN ou fisioterapeuta CREFITO) para uma prescrição formal.'
    case 'diagnosis':
      return 'Não posso confirmar diagnósticos. Os sintomas que descreveu podem ter várias causas; procure um profissional habilitado para uma avaliação adequada.'
    case 'prohibited_term':
      return 'A emissão de receitas, atestados e autorizações exige assinatura ICP-Brasil de um profissional habilitado. Posso ajudar a localizar o profissional do seu tenant?'
    default:
      return 'Não posso responder a essa pergunta. Posso ajudá-lo a falar com um profissional?'
  }
}
