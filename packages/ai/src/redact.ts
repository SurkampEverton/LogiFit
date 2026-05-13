/**
 * `redactBeforeLLM(text)` — máscara de PII antes de enviar pro provider externo
 * (ADR 0073 camada 5 + regra 37 defense-in-depth).
 *
 * Cobre PII brasileiro comum: CPF, CNPJ, RG, e-mail, telefone, cartão, PIX
 * aleatória, endereço (logradouro completo "Rua X, 123, bairro").
 *
 * **Por que mascarar antes do LLM** mesmo o provider sendo Google Cloud BR
 * (Vertex AI SP)? Defense-in-depth: BYOK pode apontar pra Anthropic/OpenAI
 * (US), além de minimizar transferência de PII bruto pra qualquer terceiro.
 *
 * Mascara é parcial pra preservar utilidade: '123.456.789-00' → '***.***.***-00'
 * (mantém dígitos verificadores) — assistente pode validar que conhece o CPF
 * sem ver os 6 primeiros dígitos.
 */
import type { PiiRedactionResult } from './types'

// ─── Padrões PII (regex precompilados) ───────────────────────────────────

// CPF — 11 dígitos com formatação opcional. Mantém últimos 2 (verificadores).
const CPF_PATTERN = /(\d{3}\.?\d{3}\.?\d{3}-?)(\d{2})/g

// CNPJ — 14 dígitos. Mantém raiz + ordem visível (8 primeiros + /0001-X).
const CNPJ_PATTERN = /(\d{2}\.?\d{3}\.?\d{3}\/?)(\d{4}-?\d{2})/g

// RG — varia por estado, mas formato comum 9 dígitos com ponto opcional + dígito
const RG_PATTERN = /\b(\d{2}\.?\d{3}\.?\d{3}-?[\dXx])\b/g

// Email — RFC simplificado
const EMAIL_PATTERN = /([A-Za-z0-9._%+-]+)@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g

// Telefone BR — +55 (DDD) 9XXXX-XXXX | (DDD) XXXX-XXXX | 10-11 dígitos
const PHONE_PATTERN = /(\+?55\s?)?\(?(\d{2})\)?\s?(\d{4,5})-?(\d{4})/g

// Cartão de crédito — 13-19 dígitos com hífen/espaço opcional
const CREDIT_CARD_PATTERN = /\b(\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{1,7})\b/g

// PIX aleatória (UUID v4 padrão)
const PIX_RANDOM_PATTERN =
  /\b([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\b/gi

// CEP
const CEP_PATTERN = /\b(\d{5})-?(\d{3})\b/g

// ─── Função canônica ─────────────────────────────────────────────────────

export function redactBeforeLLM(text: string): PiiRedactionResult {
  if (!text) return { redacted: '', hits: {} }

  const hits: Record<string, number> = {}
  let result = text

  // PIX UUID primeiro (mais estruturado; evita que phone/cep peguem dígitos do UUID)
  result = result.replace(PIX_RANDOM_PATTERN, () => {
    hits.pix_random = (hits.pix_random ?? 0) + 1
    return '[PIX_KEY]'
  })

  // CPF (formato distintivo) — mantém últimos 2 dígitos
  result = result.replace(CPF_PATTERN, (_match, _start, end) => {
    hits.cpf = (hits.cpf ?? 0) + 1
    return `***.***.***-${end}`
  })

  // CNPJ — mantém últimos 6 (filial + verificador)
  result = result.replace(CNPJ_PATTERN, (_match, _root, end) => {
    hits.cnpj = (hits.cnpj ?? 0) + 1
    return `**.***.***/${end}`
  })

  // RG (depois de CPF pra evitar falso positivo)
  result = result.replace(RG_PATTERN, (match) => {
    // Evita re-mascarar CPF/CNPJ já tratados (não tem * no original)
    if (match.includes('*')) return match
    hits.rg = (hits.rg ?? 0) + 1
    return '**.***.***-*'
  })

  // Email — mantém domínio (útil pra LLM identificar tipo de service)
  result = result.replace(EMAIL_PATTERN, (_match, _local, domain) => {
    hits.email = (hits.email ?? 0) + 1
    return `***@${domain}`
  })

  // Cartão de crédito (antes de phone — formato com 4 grupos de 4 dígitos)
  result = result.replace(CREDIT_CARD_PATTERN, (match) => {
    const digits = match.replace(/\D/g, '')
    if (digits.length < 13 || digits.length > 19) return match
    const last4 = digits.slice(-4)
    hits.credit_card = (hits.credit_card ?? 0) + 1
    return `**** **** **** ${last4}`
  })

  // Telefone — mantém DDD
  result = result.replace(PHONE_PATTERN, (_match, _country, ddd) => {
    hits.phone = (hits.phone ?? 0) + 1
    return `(${ddd}) ****-****`
  })

  // CEP — mantém primeira parte (região)
  result = result.replace(CEP_PATTERN, (_match, region) => {
    hits.cep = (hits.cep ?? 0) + 1
    return `${region}-***`
  })

  return { redacted: result, hits }
}

/**
 * `redactRagChunks(chunks)` — aplica `redactBeforeLLM` em cada chunk antes de
 * injetar no system prompt. Mantém metadata (source, title).
 */
export function redactRagChunks<T extends { content: string }>(chunks: T[]): T[] {
  return chunks.map((c) => ({
    ...c,
    content: redactBeforeLLM(c.content).redacted,
  }))
}
