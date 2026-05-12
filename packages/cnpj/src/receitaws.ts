/**
 * Adapter ReceitaWS (fallback LogiFit — ADR 0048).
 *
 * Endpoint público free: https://www.receitaws.com.br/v1/cnpj/{cnpj}
 * Rate limit free: 3 req/min com IP único. Plano pago dispensa rate-limit.
 *
 * Sem API key na versão free; plano pago adiciona header `Authorization: Bearer ...`.
 * Sprint 02+ pluga key via `tenant_cnpj_settings.credentials_encrypted`.
 */
import type { CnpjData, CnpjLookupResult, CnpjProvider } from './types'
import { cnpjDataSchema } from './types'

const RECEITAWS_BASE = 'https://www.receitaws.com.br/v1/cnpj'
const TIMEOUT_MS = 30_000

interface ReceitaWsResponse {
  status?: 'OK' | 'ERROR'
  message?: string
  cnpj: string
  nome: string // razão social
  fantasia: string | null
  situacao: string // 'ATIVA' | 'BAIXADA' | 'SUSPENSA' | 'INAPTA' | 'NULA'
  motivo_situacao?: string
  abertura: string | null
  porte: string | null
  natureza_juridica: string | null
  capital_social: string | null
  email: string | null
  telefone: string | null
  cep: string | null
  logradouro: string | null
  numero: string | null
  complemento: string | null
  bairro: string | null
  municipio: string | null
  uf: string | null
  atividade_principal: Array<{ code: string; text: string }>
  atividades_secundarias: Array<{ code: string; text: string }>
}

function mapSituacao(raw: string): CnpjData['situacao'] {
  const s = (raw || '').toLowerCase().trim()
  if (s === 'ativa') return 'ativa'
  if (s === 'baixada') return 'baixada'
  if (s === 'suspensa') return 'suspensa'
  if (s === 'inapta') return 'inapta'
  if (s === 'nula') return 'nula'
  return 'desconhecida'
}

function parseAbertura(abertura: string | null): string | null {
  if (!abertura) return null
  // Formato DD/MM/YYYY → ISO YYYY-MM-DD
  const m = abertura.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (!m) return null
  return `${m[3]}-${m[2]}-${m[1]}`
}

function mapToCnpjData(raw: ReceitaWsResponse, cnpj: string): CnpjData {
  return cnpjDataSchema.parse({
    cnpj,
    razaoSocial: raw.nome,
    nomeFantasia: raw.fantasia || null,
    situacao: mapSituacao(raw.situacao),
    situacaoMotivo: raw.motivo_situacao || null,
    dataAbertura: parseAbertura(raw.abertura),
    porte: raw.porte,
    naturezaJuridica: raw.natureza_juridica,
    capitalSocial: raw.capital_social ? Number(raw.capital_social) : null,
    email: raw.email,
    telefone: raw.telefone,
    address: {
      cep: raw.cep,
      logradouro: raw.logradouro,
      numero: raw.numero,
      complemento: raw.complemento,
      bairro: raw.bairro,
      cidade: raw.municipio,
      uf: raw.uf,
    },
    cnaePrincipal: raw.atividade_principal?.[0]
      ? {
          codigo: raw.atividade_principal[0].code,
          descricao: raw.atividade_principal[0].text,
        }
      : null,
    cnaesSecundarios:
      raw.atividades_secundarias?.map((c) => ({
        codigo: c.code,
        descricao: c.text,
      })) ?? [],
    meta: {
      providerUsed: 'receitaws',
      fetchedAt: new Date().toISOString(),
    },
  })
}

export class ReceitaWsCnpjProvider implements CnpjProvider {
  readonly name = 'receitaws'

  async lookup(cnpj: string): Promise<CnpjLookupResult> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)

    try {
      // safe-fetch-exempt: endpoint público ReceitaWS fixo (allowlist canônica ADR 0048)
      const res = await fetch(`${RECEITAWS_BASE}/${cnpj}`, {
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          'User-Agent': 'LogiFit/0.1 (+https://logifit.com.br)',
        },
      })

      clearTimeout(timeout)

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

      const raw = (await res.json()) as ReceitaWsResponse

      // ReceitaWS retorna 200 com status=ERROR pra CNPJ inválido/inexistente
      if (raw.status === 'ERROR') {
        if ((raw.message || '').toLowerCase().includes('rate limit')) {
          return {
            ok: false,
            error: { code: 'CNPJ_RATE_LIMITED', provider: this.name },
          }
        }
        return { ok: false, error: { code: 'CNPJ_NOT_FOUND', cnpj } }
      }

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
