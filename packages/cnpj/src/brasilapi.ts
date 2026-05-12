/**
 * Adapter BrasilAPI (default LogiFit — ADR 0048).
 *
 * Endpoint público: https://brasilapi.com.br/api/cnpj/v1/{cnpj}
 * Rate limit free: 3 req/min (segundo docs). Cache 7d em `cnpj_cache`
 * reduz para ~95% menos requests.
 *
 * Sem API key — endpoint aberto. Sprint 02+ pode adicionar `User-Agent`
 * custom pra identificação amigável.
 */
import type { CnpjData, CnpjLookupResult, CnpjProvider } from './types'
import { cnpjDataSchema } from './types'

const BRASILAPI_BASE = 'https://brasilapi.com.br/api/cnpj/v1'
const TIMEOUT_MS = 30_000

interface BrasilApiResponse {
  cnpj: string
  razao_social: string
  nome_fantasia: string | null
  descricao_situacao_cadastral: string
  motivo_situacao_cadastral?: string | number
  data_inicio_atividade: string | null
  porte: string | null
  natureza_juridica: string | null
  capital_social: number | null
  email: string | null
  ddd_telefone_1: string | null
  cep: string | null
  logradouro: string | null
  numero: string | null
  complemento: string | null
  bairro: string | null
  municipio: string | null
  uf: string | null
  cnae_fiscal: number
  cnae_fiscal_descricao: string
  cnaes_secundarios?: Array<{ codigo: number; descricao: string }>
  // 404 também usa este shape:
  type?: string
  message?: string
}

function mapSituacao(raw: string): CnpjData['situacao'] {
  const s = (raw || '').toLowerCase().trim()
  if (s.includes('ativa')) return 'ativa'
  if (s.includes('baixada')) return 'baixada'
  if (s.includes('suspensa')) return 'suspensa'
  if (s.includes('inapta')) return 'inapta'
  if (s.includes('nula')) return 'nula'
  return 'desconhecida'
}

function mapToCnpjData(raw: BrasilApiResponse, cnpj: string): CnpjData {
  return cnpjDataSchema.parse({
    cnpj,
    razaoSocial: raw.razao_social,
    nomeFantasia: raw.nome_fantasia || null,
    situacao: mapSituacao(raw.descricao_situacao_cadastral),
    situacaoMotivo: raw.motivo_situacao_cadastral
      ? String(raw.motivo_situacao_cadastral)
      : null,
    dataAbertura: raw.data_inicio_atividade,
    porte: raw.porte,
    naturezaJuridica: raw.natureza_juridica,
    capitalSocial: raw.capital_social,
    email: raw.email,
    telefone: raw.ddd_telefone_1,
    address: {
      cep: raw.cep,
      logradouro: raw.logradouro,
      numero: raw.numero,
      complemento: raw.complemento,
      bairro: raw.bairro,
      cidade: raw.municipio,
      uf: raw.uf,
    },
    cnaePrincipal: raw.cnae_fiscal
      ? {
          codigo: String(raw.cnae_fiscal),
          descricao: raw.cnae_fiscal_descricao,
        }
      : null,
    cnaesSecundarios:
      raw.cnaes_secundarios?.map((c) => ({
        codigo: String(c.codigo),
        descricao: c.descricao,
      })) ?? [],
    meta: {
      providerUsed: 'brasilapi',
      fetchedAt: new Date().toISOString(),
    },
  })
}

export class BrasilApiCnpjProvider implements CnpjProvider {
  readonly name = 'brasilapi'

  async lookup(cnpj: string): Promise<CnpjLookupResult> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)

    try {
      // safe-fetch-exempt: endpoint público BrasilAPI fixo (allowlist canônica ADR 0048); sem credenciais
      const res = await fetch(`${BRASILAPI_BASE}/${cnpj}`, {
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          'User-Agent': 'LogiFit/0.1 (+https://logifit.com.br)',
        },
      })

      clearTimeout(timeout)

      if (res.status === 404) {
        return { ok: false, error: { code: 'CNPJ_NOT_FOUND', cnpj } }
      }
      if (res.status === 429) {
        const retryAfter = res.headers.get('retry-after')
        return {
          ok: false,
          error: {
            code: 'CNPJ_RATE_LIMITED',
            provider: this.name,
            retryAfterSec: retryAfter ? Number.parseInt(retryAfter, 10) : undefined,
          },
        }
      }
      if (!res.ok) {
        return {
          ok: false,
          error: {
            code: 'CNPJ_PROVIDER_DOWN',
            provider: this.name,
            cause: `HTTP ${res.status}`,
          },
        }
      }

      const raw = (await res.json()) as BrasilApiResponse
      const data = mapToCnpjData(raw, cnpj)
      return { ok: true, data, fromCache: false }
    } catch (err) {
      clearTimeout(timeout)
      const msg = err instanceof Error ? err.message : String(err)
      if (err instanceof Error && err.name === 'AbortError') {
        return {
          ok: false,
          error: { code: 'CNPJ_PROVIDER_DOWN', provider: this.name, cause: 'timeout' },
        }
      }
      return {
        ok: false,
        error: { code: 'CNPJ_PROVIDER_DOWN', provider: this.name, cause: msg },
      }
    }
  }
}
