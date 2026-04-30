/**
 * safeFetch — wrapper único para fetch externo (regra 37 + ADR 0073).
 *
 * Bloqueia SSRF: protocolo http/https obrigatório, IP privado/loopback/link-local,
 * timeout default 30s, redirect manual, allowedHosts obrigatória do caller.
 *
 * Lint custom `no-raw-fetch` (Faixa 4) bloqueia commit se algum import usar
 * fetch direto fora de safeFetch (exceção via `// safe-fetch-exempt: <motivo>`).
 *
 * Limitação MVP: não resolve DNS antes de chamar (DNS rebinding mitigado pela
 * allowedHosts estrita). Faixa 3+: integrar dns.lookup ou wrapper que valide IP
 * resolvido contra PRIVATE_IP_RANGES.
 */

export class SsrfError extends Error {
  constructor(reason: string) {
    super(`SSRF blocked: ${reason}`)
    this.name = 'SsrfError'
  }
}

export interface SafeFetchOptions extends RequestInit {
  /** Hosts permitidos (sem protocolo, sem porta). Obrigatório — sem wildcard MVP. */
  allowedHosts: string[]
  /** Timeout em ms. Default 30s. */
  timeoutMs?: number
  /** Tamanho máximo de resposta declarado em Content-Length. Default 50MB. */
  maxResponseBytes?: number
}

const PRIVATE_IP_RANGES = [
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^127\./,
  /^169\.254\./,
  /^0\./,
  /^::1$/,
  /^fe80:/i,
  /^fc/i,
  /^fd/i,
]

function isProbablyIp(host: string): boolean {
  return /^[0-9.]+$/.test(host) || /^[0-9a-f:]+$/i.test(host)
}

function isPrivateIp(ip: string): boolean {
  return PRIVATE_IP_RANGES.some((re) => re.test(ip))
}

export async function safeFetch(
  input: string | URL,
  options: SafeFetchOptions,
): Promise<Response> {
  const url = typeof input === 'string' ? new URL(input) : input

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SsrfError(`disallowed protocol ${url.protocol}`)
  }

  if (!options.allowedHosts.includes(url.hostname)) {
    throw new SsrfError(`host ${url.hostname} not in allowedHosts`)
  }

  if (isProbablyIp(url.hostname) && isPrivateIp(url.hostname)) {
    throw new SsrfError(`host ${url.hostname} is private/loopback/link-local`)
  }

  const controller = new AbortController()
  const timeoutMs = options.timeoutMs ?? 30_000
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const { allowedHosts: _, timeoutMs: __, maxResponseBytes: ___, ...init } = options
    const response = await fetch(url, {
      ...init,
      redirect: 'manual',
      signal: controller.signal,
    })

    if (response.status >= 300 && response.status < 400) {
      throw new SsrfError(
        `redirect ${response.status} to ${response.headers.get('location') ?? '?'} not followed`,
      )
    }

    const maxBytes = options.maxResponseBytes ?? 50 * 1024 * 1024
    const contentLength = Number(response.headers.get('content-length') ?? 0)
    if (contentLength > maxBytes) {
      throw new SsrfError(`response too large (${contentLength} > ${maxBytes})`)
    }

    return response
  } finally {
    clearTimeout(timeout)
  }
}
