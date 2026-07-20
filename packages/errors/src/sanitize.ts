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

/**
 * Segmentos que tornam uma chave composta sensível.
 *
 * O match exato de `REDACT_KEYS` deixava passar nomes compostos reais —
 * `senha_responsavel` (portal municipal, Focus NFe), `senhaPortal`,
 * `client_secret`, `userPassword`. Vazariam em claro no `audit_log`, no
 * GlitchTip e no envelope de erro.
 *
 * Comparamos por **segmento** (não substring) para não redigir demais:
 * `secretary` continua visível porque seu único segmento é `secretary`,
 * enquanto `client_secret` tem o segmento `secret`.
 */
const REDACT_SEGMENTS = new Set([
  'password',
  'passwd',
  'senha',
  'token',
  'secret',
  'apikey',
  'jwt',
  'credential',
  'credencial',
])

/** `senhaResponsavel` / `senha_responsavel` / `SENHA-PORTAL` → ['senha','responsavel'] */
function keySegments(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

function shouldRedact(key: string): boolean {
  const lower = key.toLowerCase()
  if (REDACT_KEYS.has(lower)) return true
  return keySegments(key).some((seg) => REDACT_SEGMENTS.has(seg))
}

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
    out[k] = shouldRedact(k) ? '[REDACTED]' : sanitize(v)
  }
  return out as T
}
