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
  NfeProductEmissionOptions,
  NfseEmissionInput,
  ProviderHealthResult,
} from './provider'

export const FOCUS_NFE_HOSTS = {
  producao: 'api.focusnfe.com.br',
  homologacao: 'homologacao.focusnfe.com.br',
} as const

/**
 * A URL aponta pra um ARQUIVO hospedado pela Focus (DANFSE/XML)?
 *
 * A Focus serve o PDF da NFS-e no S3 dela (`focusnfe.s3.<região>.amazonaws.com`),
 * público, fora dos hosts da API. É arquivo real e proxyável — distinto do link
 * de portal do município, que é uma página que exige a sessão do contribuinte.
 */
export function isFocusAssetUrl(url: string): boolean {
  try {
    const h = new URL(url).hostname
    return (
      h === FOCUS_NFE_HOSTS.producao ||
      h === FOCUS_NFE_HOSTS.homologacao ||
      (h.startsWith('focusnfe.s3.') && h.endsWith('.amazonaws.com'))
    )
  } catch {
    return false
  }
}

export type FiscalAssetKind = 'none' | 'focus-relative' | 'focus-file' | 'external-portal'

/**
 * Classifica o `caminho`/URL que a Focus devolve pra XML/PDF:
 *  - `focus-relative`: caminho na API da Focus (`/arquivos/...`), proxyável com auth.
 *  - `focus-file`: URL absoluta de arquivo da Focus (S3), proxyável sem auth.
 *  - `external-portal`: página do portal do município — não é arquivo, exige sessão.
 *  - `none`: ausente/inválido.
 */
export function classifyFiscalAsset(path: string | null | undefined): FiscalAssetKind {
  if (!path) return 'none'
  if (path.startsWith('/')) return 'focus-relative'
  if (isFocusAssetUrl(path)) return 'focus-file'
  return 'external-portal'
}

/**
 * O "arquivo" devolvido pelo provider é na verdade um link pro portal da
 * prefeitura? Municípios como Cascavel devolvem a URL de consulta de
 * autenticidade como "pdf", e ela exige a sessão do contribuinte — não há o
 * que proxyar. Ver `classifyFiscalAsset`.
 */
export function isExternalPortalLink(path: string | null | undefined): boolean {
  return classifyFiscalAsset(path) === 'external-portal'
}

/**
 * Escolhe a melhor URL de PDF do corpo da Focus.
 *
 * NFS-e usa `danfse` (com s); NF-e/NFC-e usam `danfe`. O `url` genérico é, em
 * municípios como Cascavel, o link do PORTAL — só serve de último recurso, senão
 * a nota real fica sem o DANFSE que a Focus de fato hospeda no S3. Bug real:
 * mapear só `url_danfe` (sem s) fazia o PDF da NFS-e cair no link do portal.
 */
function pdfFromBody(body: FocusResponseBody): string | null {
  return (
    body.caminho_danfse ??
    body.url_danfse ??
    body.caminho_danfe ??
    body.url_danfe ??
    body.url ??
    null
  )
}

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
  /** Código de ERRO da Focus (ex: 'empresa_nao_habilitada') — não confundir com `status` */
  codigo?: string
  chave_nfe?: string
  chave?: string
  codigo_verificacao?: string
  /** Numero/serie da NOTA atribuidos pelo municipio/SEFAZ (nao do RPS) */
  numero?: string | number
  serie?: string | number
  numero_nfse?: string | number
  serie_nfse?: string | number
  caminho_xml_nota_fiscal?: string
  caminho_danfe?: string
  /** DANFSE de NFS-e — Focus usa 'danfse' (com s); 'danfe' é NF-e. */
  caminho_danfse?: string
  url_danfse?: string
  url?: string
  url_danfe?: string
  mensagem_sefaz?: string
  mensagem?: string
  erros?: Array<{ mensagem?: string; codigo?: string }>
  [key: string]: unknown
}

/**
 * Erro da Focus vem como `{codigo, mensagem}` SEM campo `status` — e pode
 * chegar com HTTP fora do par 400/422 (403 em `empresa_nao_habilitada`, por
 * exemplo). Sem esta checagem o default de `mapEmissionStatus` classificaria
 * como `queued`, e o operador ficaria esperando uma nota que nunca vem.
 * Descoberto no primeiro teste contra a Focus real (2026-07-20).
 */
function isFocusErrorBody(body: FocusResponseBody): boolean {
  return body.status === undefined && typeof body.codigo === 'string' && body.codigo.length > 0
}

/** Primeiro valor presente, normalizado pra string. Focus alterna os nomes. */
function firstDefined(...values: Array<string | number | undefined>): string | null {
  for (const v of values) {
    if (v !== undefined && v !== null && String(v).length > 0) return String(v)
  }
  return null
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
  // Erro da Focus: prefixa o código pra o operador conseguir buscar no suporte
  if (body.mensagem) {
    return body.codigo ? `[${body.codigo}] ${body.mensagem}` : body.mensagem
  }
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
    sentPayload?: Record<string, unknown>,
  ): EmissionResult {
    // 4xx de negócio (payload/SEFAZ/cadastro) = rejeição, não exceção.
    // Inclui body de erro `{codigo, mensagem}` que chega em outros status.
    const rejected = httpStatus === 400 || httpStatus === 422 || isFocusErrorBody(body)
    const status = rejected ? 'rejected' : mapEmissionStatus(body.status)
    return {
      providerRef,
      status,
      chave: body.chave_nfe ?? body.chave ?? body.codigo_verificacao ?? null,
      xmlUrl: body.caminho_xml_nota_fiscal ?? null,
      pdfUrl: pdfFromBody(body),
      rejectionReason: status === 'rejected' ? extractRejection(body) : null,
      documentNumber: firstDefined(body.numero_nfse, body.numero),
      documentSerie: firstDefined(body.serie_nfse, body.serie),
      raw: body,
      sentPayload,
    }
  }

  private toEventResult(
    providerRef: string,
    httpStatus: number,
    body: FocusResponseBody,
  ): EventResult {
    // Mesma armadilha da emissão: erro de cadastro `{codigo, mensagem}` chega
    // fora do par 400/422 e cairia no `processing` do else — evento fantasma.
    const rejected = httpStatus === 400 || httpStatus === 422 || isFocusErrorBody(body)
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
      issRetido: options?.issRetido ?? input.issRetido,
      inscricaoMunicipal: options?.inscricaoMunicipal ?? input.inscricaoMunicipal,
    })
    const { httpStatus, body } = await this.request('POST', `/v2/nfse?ref=${ref}`, payload)
    return this.toEmissionResult(ref, httpStatus, body, payload)
  }

  async emitNfeProduct(
    input: NfeProductEmissionInput,
    options?: NfeProductEmissionOptions & Partial<Pick<NfePayloadOptions, 'taxDefaults'>>,
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
    return this.toEmissionResult(ref, httpStatus, body, payload)
  }

  async emitNfce(input: NfceEmissionInput): Promise<EmissionResult> {
    const ref = FocusNfeProvider.emissionRef('nfce', input.companyCnpj, input.serie, input.numero)
    const payload = buildNfcePayload(input, { emissionDate: new Date() })
    const { httpStatus, body } = await this.request('POST', `/v2/nfce?ref=${ref}`, payload)
    return this.toEmissionResult(ref, httpStatus, body, payload)
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
