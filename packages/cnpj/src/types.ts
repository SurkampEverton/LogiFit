/**
 * Tipos canônicos LogiFit pra dados de CNPJ (ADR 0048).
 *
 * Formato normalizado independente do provider — cada adapter (BrasilAPI,
 * ReceitaWS, CNPJá!) mapeia seu payload pra este shape via Zod.
 *
 * Cache key é o CNPJ normalizado (14 dígitos só números — `normalizeDocument`
 * de `@repo/db/persons`).
 */
import { z } from 'zod'

/**
 * Situação cadastral canônica (LogiFit). Cada provider mapeia seus valores
 * (ex.: BrasilAPI usa "ATIVA", "BAIXADA"; ReceitaWS usa "ATIVA", "BAIXADA"
 * também mas pode trazer "SUSPENSA" com motivo).
 */
export const cnpjSituacaoSchema = z.enum([
  'ativa',
  'suspensa',
  'baixada',
  'inapta',
  'nula',
  'desconhecida',
])
export type CnpjSituacao = z.infer<typeof cnpjSituacaoSchema>

/**
 * Endereço normalizado — bate com `persons.address` (`@repo/db/schema/persons`).
 */
export const cnpjAddressSchema = z.object({
  cep: z.string().nullish(),
  logradouro: z.string().nullish(),
  numero: z.string().nullish(),
  complemento: z.string().nullish(),
  bairro: z.string().nullish(),
  cidade: z.string().nullish(),
  uf: z.string().length(2).nullish(),
})
export type CnpjAddress = z.infer<typeof cnpjAddressSchema>

/**
 * Dados de CNPJ normalizados — formato canônico LogiFit.
 *
 * `meta` carrega o payload bruto do provider pra debug (não persistido na
 * `persons` table; só no `cnpj_cache.data`).
 */
export const cnpjDataSchema = z.object({
  cnpj: z.string().regex(/^\d{14}$/), // 14 dígitos só números
  razaoSocial: z.string(),
  nomeFantasia: z.string().nullish(),
  situacao: cnpjSituacaoSchema,
  situacaoMotivo: z.string().nullish(),
  dataAbertura: z.string().nullish(), // ISO date (YYYY-MM-DD)
  porte: z.string().nullish(), // 'ME' | 'EPP' | 'DEMAIS'
  naturezaJuridica: z.string().nullish(),
  capitalSocial: z.number().nullish(),
  email: z.string().email().nullish(),
  telefone: z.string().nullish(),
  address: cnpjAddressSchema,
  cnaePrincipal: z
    .object({
      codigo: z.string(),
      descricao: z.string(),
    })
    .nullish(),
  cnaesSecundarios: z
    .array(
      z.object({
        codigo: z.string(),
        descricao: z.string(),
      }),
    )
    .default([]),
  meta: z.object({
    providerUsed: z.string(), // 'brasilapi' | 'receitaws' | 'cnpja'
    fetchedAt: z.string(), // ISO datetime
  }),
})
export type CnpjData = z.infer<typeof cnpjDataSchema>

/**
 * Erros discriminados (ADR 0071 envelope) — mapeados em Server Actions
 * pra `CNPJ_NOT_FOUND` / `CNPJ_INVALID` / `CNPJ_PROVIDER_DOWN`.
 */
export type CnpjLookupError =
  | { code: 'CNPJ_INVALID'; reason: string }
  | { code: 'CNPJ_NOT_FOUND'; cnpj: string }
  | { code: 'CNPJ_PROVIDER_DOWN'; provider: string; cause?: string }
  | { code: 'CNPJ_RATE_LIMITED'; provider: string; retryAfterSec?: number }
  | { code: 'CNPJ_INTERNAL'; cause: string }

export type CnpjLookupResult =
  | { ok: true; data: CnpjData; fromCache: boolean }
  | { ok: false; error: CnpjLookupError }

/**
 * Contrato de provider — implementações em `brasilapi.ts`, `receitaws.ts`,
 * `cnpja.ts` (futuro, opcional pago).
 *
 * `name` é usado no log + cache (`cnpj_cache.provider_used`) + dropdown UI
 * em `/app/settings/pessoas/cnpj` (Faixa D fechamento).
 */
export interface CnpjProvider {
  readonly name: string
  /**
   * Faz a consulta. Retorna `CnpjData` normalizado ou erro discriminado.
   * NÃO toca em cache — caller decide via `orchestrator.lookupCnpj()`.
   *
   * Provider implementa rate-limit interno se necessário (BrasilAPI tem
   * 3 req/min free; ReceitaWS 3 req/min free; CNPJá! conforme plano).
   * Retorno `CNPJ_RATE_LIMITED` faz o orchestrator tentar fallback.
   */
  lookup(cnpj: string): Promise<CnpjLookupResult>
}
