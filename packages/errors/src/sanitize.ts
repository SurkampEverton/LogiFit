/**
 * Sanitização LGPD (regra 29 + ADR 0054). Aplicada antes de:
 *   - Mensagem de erro retornada ao client
 *   - Payload pro GlitchTip / Sentry
 *   - Log estruturado (pino)
 *
 * Mascara identificadores parciais (CPF/CNPJ/email/telefone) e redact total
 * para senha/token/dado clínico (LGPD art. 11).
 */

const CPF_RE = /\b(\d{3})[.\s]?(\d{3})[.\s]?(\d{3})[-\s]?(\d{2})\b/g
const CNPJ_RE = /\b(\d{2})[.\s]?(\d{3})[.\s]?(\d{3})[/\s]?(\d{4})[-\s]?(\d{2})\b/g
const EMAIL_RE = /\b([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g
const PHONE_BR_RE = /\b\+?55?\s?\(?(\d{2})\)?\s?9?\s?\d{4,5}[-.\s]?(\d{4})\b/g

const REDACT_KEYS = new Set([
  'password',
  'senha',
  'token',
  'secret',
  'apikey',
  'api_key',
  'authorization',
  'cookie',
  'set-cookie',
  'jwt',
  'refresh_token',
  'access_token',
  'cid',
  'cid10',
  'cid11',
  'diagnostico',
  'diagnosis',
  'prescription',
  'prescricao',
  'medication',
  'medicamento',
  'condition',
  'condicao',
  'symptom',
  'sintoma',
  'lab_result',
  'exame',
])

export function maskCpf(cpf: string): string {
  return cpf.replace(CPF_RE, '$1.***.***-$4')
}

export function maskCnpj(cnpj: string): string {
  return cnpj.replace(CNPJ_RE, '$1.***.***/****-$5')
}

export function maskEmail(email: string): string {
  return email.replace(EMAIL_RE, '$1***@$2')
}

export function maskPhone(phone: string): string {
  return phone.replace(PHONE_BR_RE, '+55 ($1) ****-$2')
}

export function sanitizeString(s: string): string {
  return maskPhone(maskEmail(maskCnpj(maskCpf(s))))
}

export function sanitize<T>(input: T): T {
  if (input === null || input === undefined) return input
  if (typeof input === 'string') return sanitizeString(input) as T
  if (typeof input !== 'object') return input
  if (Array.isArray(input)) return input.map((v) => sanitize(v)) as T
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    out[k] = REDACT_KEYS.has(k.toLowerCase()) ? '[REDACTED]' : sanitize(v)
  }
  return out as T
}
