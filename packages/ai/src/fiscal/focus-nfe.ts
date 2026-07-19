/**
 * FocusNfeProvider — Sprint 36b (ADR 0059 + regra 37).
 *
 * Adapter real da Focus NFe API v2. Toda chamada HTTP passa por `safeFetch()`
 * (@repo/security) com allowlist estrita dos 2 hosts Focus. LogiFit envia
 * payload semântico (builders em `emissions/*`); Focus monta XML, assina com
 * certificado A1 (gerenciado por eles no MVP — pergunta aberta ADR 0059) e
 * transmite à SEFAZ/prefeitura.
 *
 * **Idempotência de emissão:** `ref` é determinística por
 * `lf-{kind}-{cnpj}-{serie}-{numero}` — reenvio do mesmo número NÃO duplica
 * nota no Focus (eles deduplicam por ref).
 *
 * **Erros:**
 *   - 429 → `FiscalProviderRateLimitError` (wrapper traduz pra RATE_LIMITED)
 *   - 401/403 → `FiscalProviderAuthError` (credentials inválidas → system_alert)
 *   - 5xx/timeout → `FiscalProviderUnavailableError` (transient → fila de retry)
 *   - 400/422 → NÃO lança: retorna `status='rejected'` com motivo (erro de
 *     payload/SEFAZ é resultado de negócio, não falha de infra)
 */

import { safeFetch } from '@repo/security'
import { buildNfcePayload } from './emissions/nfce'
import { type NfePayloadOptions, buildNfePayload } from './emissions/nfe'
import { type NfsePayloadOptions, buildNfsePayload } from './emissions/nfse'
import type {
  CancellationInput,
  CceInput,
  EmissionResult,
  EventResult,
  FiscalEmissionKind,
  FiscalProvider,
  FiscalProviderEnv,
  InutilizacaoInput,
  NfceEmissionInput,
  NfeProductEmissionInput,
  NfseEmissionInput,
  ProviderHealthResult,
} from './provider'

export const FOCUS_NFE_HOSTS = {
  producao: 'api.focusnfe.com.br',
  homologacao: 'homologacao.focusnfe.com.br',
} as const

export class FiscalProviderRateLimitError extends Error {
  constructor() {
    super('Focus NFe rate limit excedido (HTTP 429)')
    this.name = 'FiscalProviderRateLimitError'
  }
}

export class FiscalProviderAuthError extends Error {
  constructor(status: number) {
    super(`Focus NFe rejeitou credentials (HTTP ${status})`)
    this.name = 'FiscalProviderAuthError'
  }
}

export class FiscalProviderUnavailableError extends Error {
  constructor(detail: string) {
    super(`Focus NFe indisponível: ${detail}`)
    this.name = 'FiscalProviderUnavailableError'
  }
}

/** Assinatura mínima de fetch injetável (testes passam stub; default = safeFetch). */
export type FiscalFetchFn = (
  url: string,
  init: {
    method: string
    headers: Record<string, string>
    body?: string
    allowedHosts: string[]
    timeoutMs?: number
  },
) => Promise<Response>

const defaultFetch: FiscalFetchFn = (url, init) =>
  safeFetch(url, {
    method: init.method,
    headers: init.headers,
    body: init.body,
    allowedHosts: init.allowedHosts,
    timeoutMs: init.timeoutMs,
  })

export interface FocusNfeProviderConfig {
  apiToken: string
  env: FiscalProviderEnv
  /** Override de host (sandbox enterprise futuro); precisa estar na allowlist. */
  baseHost?: string | null
  fetchFn?: FiscalFetchFn
}

/** Recurso Focus por kind — modelo 55 agrupa os 6 kinds de NF-e. */
function resourceFor(kind: FiscalEmissionKind): 'nfse' | 'nfe' | 'nfce' {
  if (kind === 'nfse') return 'nfse'
  if (kind === 'nfce') return 'nfce'
  return 'nfe'
}

interface FocusResponseBody {
  status?: string
  chave_nfe?: string
  chave?: string
  codigo_verificacao?: string
  caminho_xml_nota_fiscal?: string
  caminho_danfe?: string
  url?: string
  url_danfe?: string
  mensagem_sefaz?: string
  mensagem?: string
  erros?: Array<{ mensagem?: string; codigo?: string }>
  [key: string]: unknown
}

function mapEmissionStatus(focusStatus: string | undefined): EmissionResult['status'] {
  switch (focusStatus) {
    case 'autorizado':
      return 'completed'
    case 'processando_autorizacao':
      return 'processing'
    case 'erro_autorizacao':
    case 'denegado':
      return 'rejected'
    default:
      // Body sem status (202 recém-enfileirado) → queued
      return 'queued'
  }
}

function extractRejection(body: FocusResponseBody): string | null {
  if (body.mensagem_sefaz) return body.mensagem_sefaz
  if (body.mensagem) return body.mensagem
  if (body.erros?.length) {
    return body.erros.map((e) => e.mensagem ?? e.codigo ?? 'erro desconhecido').join('; ')
  }
  return null
}

export class FocusNfeProvider implements FiscalProvider {
  readonly name = 'focus_nfe' as const
  readonly env: FiscalProviderEnv

  private readonly host: string
  private readonly authHeader: string
  private readonly fetchFn: FiscalFetchFn

  constructor(config: FocusNfeProviderConfig) {
    this.env = config.env
    this.host = config.baseHost ?? FOCUS_NFE_HOSTS[config.env]
    // Focus auth: HTTP Basic com token como usuário e senha vazia
    this.authHeader = `Basic ${Buffer.from(`${config.apiToken}:`).toString('base64')}`
    this.fetchFn = config.fetchFn ?? defaultFetch
  }

  /** Ref determinística — Focus deduplica emissão por ref (idempotência). */
  static emissionRef(
    kind: FiscalEmissionKind,
    companyCnpj: string,
    serie: number,
    numero: number,
  ): string {
    return `lf-${kind}-${companyCnpj.replace(/\D/g, '')}-${serie}-${numero}`
  }

  private async request(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body?: Record<string, unknown>,
  ): Promise<{ httpStatus: number; body: FocusResponseBody }> {
    let response: Response
    try {
      response = await this.fetchFn(`https://${this.host}${path}`, {
        method,
        headers: {
          authorization: this.authHeader,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
        allowedHosts: [FOCUS_NFE_HOSTS.producao, FOCUS_NFE_HOSTS.homologacao],
        timeoutMs: 30_000,
      })
    } catch (err) {
      throw new FiscalProviderUnavailableError(err instanceof Error ? err.message : String(err))
    }

    if (response.status === 429) throw new FiscalProviderRateLimitError()
    if (response.status === 401 || response.status === 403) {
      throw new FiscalProviderAuthError(response.status)
    }
    if (response.status >= 500) {
      throw new FiscalProviderUnavailableError(`HTTP ${response.status}`)
    }

    let parsed: FocusResponseBody = {}
    try {
      parsed = (await response.json()) as FocusResponseBody
    } catch {
      // 204/body vazio é válido em alguns eventos
    }
    return { httpStatus: response.status, body: parsed }
  }

  private toEmissionResult(
    providerRef: string,
    httpStatus: number,
    body: FocusResponseBody,
  ): EmissionResult {
    // 400/422 = payload/SEFAZ rejeitou — resultado de negócio, não exceção
    const rejected = httpStatus === 400 || httpStatus === 422
    const status = rejected ? 'rejected' : mapEmissionStatus(body.status)
    return {
      providerRef,
      status,
      chave: body.chave_nfe ?? body.chave ?? body.codigo_verificacao ?? null,
      xmlUrl: body.caminho_xml_nota_fiscal ?? null,
      pdfUrl: body.caminho_danfe ?? body.url_danfe ?? body.url ?? null,
      rejectionReason: status === 'rejected' ? extractRejection(body) : null,
      raw: body,
    }
  }

  private toEventResult(
    providerRef: string,
    httpStatus: number,
    body: FocusResponseBody,
  ): EventResult {
    const rejected = httpStatus === 400 || httpStatus === 422
    const focusStatus = body.status
    let status: EventResult['status']
    if (rejected || focusStatus === 'erro_cancelamento' || focusStatus === 'erro') {
      status = 'rejected'
    } else if (focusStatus === 'cancelado' || focusStatus === 'autorizado') {
      status = 'completed'
    } else {
      status = 'processing'
    }
    return {
      providerRef,
      status,
      xmlUrl: body.caminho_xml_nota_fiscal ?? null,
      rejectionReason: status === 'rejected' ? extractRejection(body) : null,
      raw: body,
    }
  }

  async healthCheck(): Promise<ProviderHealthResult> {
    const start = Date.now()
    try {
      // GET em ref inexistente: 404 com credentials válidas; 401/403 inválidas
      await this.request('GET', '/v2/nfse/lf-healthcheck-probe')
      return { ok: true, latencyMs: Date.now() - start, message: null }
    } catch (err) {
      if (err instanceof FiscalProviderAuthError) {
        return { ok: false, latencyMs: Date.now() - start, message: err.message }
      }
      return {
        ok: false,
        latencyMs: Date.now() - start,
        message: err instanceof Error ? err.message : String(err),
      }
    }
  }

  async emitNfse(
    input: NfseEmissionInput,
    options?: Partial<NfsePayloadOptions>,
  ): Promise<EmissionResult> {
    const ref = FocusNfeProvider.emissionRef('nfse', input.companyCnpj, input.serie, input.numero)
    const payload = buildNfsePayload(input, {
      emissionDate: options?.emissionDate ?? new Date(),
      issRetido: options?.issRetido,
      inscricaoMunicipal: options?.inscricaoMunicipal,
    })
    const { httpStatus, body } = await this.request('POST', `/v2/nfse?ref=${ref}`, payload)
    return this.toEmissionResult(ref, httpStatus, body)
  }

  async emitNfeProduct(
    input: NfeProductEmissionInput,
    options?: Partial<NfePayloadOptions> & { kind?: FiscalEmissionKind },
  ): Promise<EmissionResult> {
    const kind = options?.kind ?? 'nfe'
    const ref = FocusNfeProvider.emissionRef(kind, input.companyCnpj, input.serie, input.numero)
    const payload = buildNfePayload(input, {
      emissionDate: options?.emissionDate ?? new Date(),
      naturezaOperacao: options?.naturezaOperacao ?? 'Venda de mercadoria',
      tipoDocumento: options?.tipoDocumento ?? 1,
      referencedChaves: options?.referencedChaves,
      taxDefaults: options?.taxDefaults,
      presencaComprador: options?.presencaComprador,
    })
    const { httpStatus, body } = await this.request('POST', `/v2/nfe?ref=${ref}`, payload)
    return this.toEmissionResult(ref, httpStatus, body)
  }

  async emitNfce(input: NfceEmissionInput): Promise<EmissionResult> {
    const ref = FocusNfeProvider.emissionRef('nfce', input.companyCnpj, input.serie, input.numero)
    const payload = buildNfcePayload(input, { emissionDate: new Date() })
    const { httpStatus, body } = await this.request('POST', `/v2/nfce?ref=${ref}`, payload)
    return this.toEmissionResult(ref, httpStatus, body)
  }

  async cancel(input: CancellationInput): Promise<EventResult> {
    const resource = resourceFor(input.kind)
    const { httpStatus, body } = await this.request(
      'DELETE',
      `/v2/${resource}/${input.providerRef}`,
      { justificativa: input.justification },
    )
    return this.toEventResult(input.providerRef, httpStatus, body)
  }

  async issueCce(input: CceInput): Promise<EventResult> {
    const { httpStatus, body } = await this.request(
      'POST',
      `/v2/nfe/${input.providerRef}/carta_correcao`,
      { correcao: input.correction },
    )
    return this.toEventResult(input.providerRef, httpStatus, body)
  }

  async inutilize(input: InutilizacaoInput): Promise<EventResult> {
    const resource = resourceFor(input.emissionKind)
    const providerRef = `lf-inut-${input.companyCnpj.replace(/\D/g, '')}-${input.serie}-${input.numeroFrom}-${input.numeroTo}`
    const { httpStatus, body } = await this.request('POST', `/v2/${resource}/inutilizacao`, {
      cnpj: input.companyCnpj.replace(/\D/g, ''),
      serie: String(input.serie),
      numero_inicial: String(input.numeroFrom),
      numero_final: String(input.numeroTo),
      justificativa: input.justification,
    })
    return this.toEventResult(providerRef, httpStatus, body)
  }

  async queryStatus(providerRef: string, kind: FiscalEmissionKind): Promise<EmissionResult> {
    const resource = resourceFor(kind)
    const { httpStatus, body } = await this.request('GET', `/v2/${resource}/${providerRef}`)
    return this.toEmissionResult(providerRef, httpStatus, body)
  }
}
