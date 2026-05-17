/**
 * Provider abstrato de adquirência — Sprint 18 Faixa B.1 (ADR 0039 esperado).
 *
 * Interface comum pra Cielo / Stone / Rede / GetNet / PagSeguro / Mock.
 * Adapters reais (`cielo.ts`/`stone.ts`/etc) ficam em Sprint 18b quando
 * houver credenciais sandbox; aqui ficam apenas `MockAcquirerProvider` (testes)
 * + dispatcher `getProvider(provider)` que falha pedindo POC.
 *
 * **Segurança** (regras 35/37):
 *   - safeFetch obrigatório (allowedHosts por provider em runtime)
 *   - Credentials descifradas só no momento da chamada (regra 33 wrapper)
 *   - Sandbox flag obriga endpoint distinto do prod (acesso por env)
 *
 * **Idempotência** (regra negocial):
 *   - `external_id` (NSU) é PK lógico do provider — Server Action `syncAcquirerSales`
 *     converte em INSERT ... ON CONFLICT (connection_id, external_id) DO UPDATE
 *     pra absorver re-sync sem duplicar.
 */
import { z } from 'zod'

export type AcquirerProvider = 'cielo' | 'stone' | 'rede' | 'getnet' | 'pagseguro' | 'mock'

// ─── Tipos canônicos ─────────────────────────────────────────────────────

export const AcquirerCredentialsSchema = z.record(z.string(), z.string())
export type AcquirerCredentials = z.infer<typeof AcquirerCredentialsSchema>

export interface AcquirerSaleRaw {
  /** NSU / id estável do provider. */
  externalId: string
  capturedAt: string // ISO datetime
  grossAmountCents: number
  feeCents: number
  netAmountCents: number
  cardBrand: string | null
  cardKind: 'credit' | 'debit' | 'voucher' | 'pix' | 'other'
  installments: number
  /** YYYY-MM-DD */
  expectedSettlementDate: string
  /** YYYY-MM-DD ou null */
  actualSettlementDate: string | null
  status: 'captured' | 'anticipated' | 'settled' | 'chargeback' | 'cancelled'
  rawPayload: Record<string, unknown>
}

export interface AnticipationRequest {
  salesIds: string[] // UUIDs internos LogiFit
  externalSaleIds: string[] // NSUs do provider
  originalAmountCents: number
}

export interface AnticipationResult {
  externalId: string
  status: 'requested' | 'approved' | 'credited' | 'rejected'
  anticipatedAmountCents: number | null
  feeCents: number
  effectiveRatePct: string | null
  rejectionReason: string | null
  rawPayload: Record<string, unknown>
}

export interface ConnectionTestResult {
  ok: boolean
  merchantName: string | null
  errorMessage: string | null
}

export interface AcquirerAdapter {
  readonly provider: AcquirerProvider
  /** Testa as credentials e devolve display name do merchant. */
  testConnection(credentials: AcquirerCredentials, sandbox: boolean): Promise<ConnectionTestResult>
  /** Lista vendas em janela [from, to]. Idempotente; chamadas duplas devolvem mesmos external_ids. */
  fetchSales(
    credentials: AcquirerCredentials,
    sandbox: boolean,
    range: { from: string; to: string },
  ): Promise<AcquirerSaleRaw[]>
  /** Solicita antecipação de recebíveis. Retorna estado + valor líquido aprovado. */
  requestAnticipation(
    credentials: AcquirerCredentials,
    sandbox: boolean,
    request: AnticipationRequest,
  ): Promise<AnticipationResult>
}

// ─── Mock adapter (testes + sandbox local) ───────────────────────────────

/**
 * Adapter deterministic — útil pra testes Vitest e demo. Não bate em API real.
 * Gera vendas pseudo-aleatórias baseadas em `range` + `merchant_id` em credentials.
 */
export class MockAcquirerProvider implements AcquirerAdapter {
  readonly provider: AcquirerProvider = 'mock'

  async testConnection(
    credentials: AcquirerCredentials,
    _sandbox: boolean,
  ): Promise<ConnectionTestResult> {
    const merchant = credentials.merchantId ?? credentials.merchant_id ?? null
    if (!merchant) {
      return { ok: false, merchantName: null, errorMessage: 'merchantId ausente' }
    }
    return { ok: true, merchantName: `Mock Merchant ${merchant}`, errorMessage: null }
  }

  async fetchSales(
    credentials: AcquirerCredentials,
    sandbox: boolean,
    range: { from: string; to: string },
  ): Promise<AcquirerSaleRaw[]> {
    const merchant = credentials.merchantId ?? 'MOCK-MERCHANT'
    const seedBase = `${merchant}-${range.from}-${range.to}`
    const days = daysBetween(range.from, range.to)
    if (days < 0) return []
    const sales: AcquirerSaleRaw[] = []
    const brands = ['visa', 'master', 'elo', 'amex']
    const kinds: Array<AcquirerSaleRaw['cardKind']> = ['credit', 'debit', 'pix']
    // Gera ~3 vendas por dia
    for (let d = 0; d <= days; d++) {
      const date = addDays(range.from, d)
      for (let i = 0; i < 3; i++) {
        const seed = hash(`${seedBase}-${d}-${i}`)
        const grossCents = 1000 + (seed % 50_000)
        const kind = kinds[seed % kinds.length]!
        const installments = kind === 'credit' ? 1 + (seed % 6) : 1
        const feeRatePct = sandbox ? 1.0 : feeRateFor('mock', kind, installments)
        const feeCents = Math.round((grossCents * feeRatePct) / 100)
        const netCents = grossCents - feeCents
        const settlementDays = kind === 'debit' ? 1 : 30
        sales.push({
          externalId: `MOCK-NSU-${seedBase}-${d}-${i}`,
          capturedAt: new Date(`${date}T12:00:00Z`).toISOString(),
          grossAmountCents: grossCents,
          feeCents,
          netAmountCents: netCents,
          cardBrand: brands[seed % brands.length]!,
          cardKind: kind,
          installments,
          expectedSettlementDate: addDays(date, settlementDays),
          actualSettlementDate: null,
          status: 'captured',
          rawPayload: { mock: true, seed, sandbox },
        })
      }
    }
    return sales
  }

  async requestAnticipation(
    _credentials: AcquirerCredentials,
    _sandbox: boolean,
    request: AnticipationRequest,
  ): Promise<AnticipationResult> {
    // Mock: aprova com 1.99% a.m. equivalente
    const ratePct = 1.99
    const feeCents = Math.round((request.originalAmountCents * ratePct) / 100)
    const anticipated = request.originalAmountCents - feeCents
    return {
      externalId: `MOCK-ANTIC-${Date.now()}`,
      status: 'credited',
      anticipatedAmountCents: anticipated,
      feeCents,
      effectiveRatePct: ratePct.toFixed(2),
      rejectionReason: null,
      rawPayload: { mock: true, request },
    }
  }
}

// ─── Dispatcher ──────────────────────────────────────────────────────────

/**
 * Retorna adapter por provider key. Adapters reais (cielo/stone/rede/getnet/
 * pagseguro) jogam erro pedindo POC com credentials válidas — ativados em
 * Sprint 18b conforme tenant real fornecer chave.
 */
export function getAdapter(provider: AcquirerProvider): AcquirerAdapter {
  if (provider === 'mock') return new MockAcquirerProvider()
  throw new Error(
    `Provider "${provider}" requer credenciais sandbox + adapter real (POC Sprint 18b). ADR 0039 §Próximos passos.`,
  )
}

// ─── Tabelas de taxa típicas (calibração inicial) ────────────────────────

/**
 * Taxas MDR aproximadas por provider × tipo cartão × parcelas. Valores
 * realistas pra demo/seed; cada tenant ajusta no admin via `acquirer_connections.metadata`
 * quando contratar maquininha real (Sprint 18b lê do provider via API).
 *
 * Source: pesquisa pública 2024-2025 — Stone/Cielo blogs + benchmarks.
 * NÃO usar pra projeção financeira real sem confirmar com contrato vigente.
 */
const FEE_TABLE: Record<
  AcquirerProvider,
  Record<'credit' | 'debit' | 'voucher' | 'pix' | 'other', { base: number; perInstallment: number }>
> = {
  cielo: {
    credit: { base: 2.99, perInstallment: 0.2 },
    debit: { base: 1.39, perInstallment: 0 },
    voucher: { base: 3.49, perInstallment: 0 },
    pix: { base: 0.99, perInstallment: 0 },
    other: { base: 2.99, perInstallment: 0 },
  },
  stone: {
    credit: { base: 2.79, perInstallment: 0.18 },
    debit: { base: 1.29, perInstallment: 0 },
    voucher: { base: 3.39, perInstallment: 0 },
    pix: { base: 0.79, perInstallment: 0 },
    other: { base: 2.79, perInstallment: 0 },
  },
  rede: {
    credit: { base: 3.05, perInstallment: 0.22 },
    debit: { base: 1.55, perInstallment: 0 },
    voucher: { base: 3.49, perInstallment: 0 },
    pix: { base: 0.99, perInstallment: 0 },
    other: { base: 3.05, perInstallment: 0 },
  },
  getnet: {
    credit: { base: 3.15, perInstallment: 0.21 },
    debit: { base: 1.49, perInstallment: 0 },
    voucher: { base: 3.59, perInstallment: 0 },
    pix: { base: 0.99, perInstallment: 0 },
    other: { base: 3.15, perInstallment: 0 },
  },
  pagseguro: {
    credit: { base: 3.49, perInstallment: 0.25 },
    debit: { base: 1.89, perInstallment: 0 },
    voucher: { base: 3.89, perInstallment: 0 },
    pix: { base: 0.99, perInstallment: 0 },
    other: { base: 3.49, perInstallment: 0 },
  },
  mock: {
    credit: { base: 2.5, perInstallment: 0.15 },
    debit: { base: 1.0, perInstallment: 0 },
    voucher: { base: 3.0, perInstallment: 0 },
    pix: { base: 0.5, perInstallment: 0 },
    other: { base: 2.5, perInstallment: 0 },
  },
}

/**
 * Taxa nominal pra display em UI. `installments` 1 = à vista.
 */
export function feeRateFor(
  provider: AcquirerProvider,
  kind: 'credit' | 'debit' | 'voucher' | 'pix' | 'other',
  installments: number,
): number {
  const row = FEE_TABLE[provider]?.[kind] ?? FEE_TABLE.mock[kind]
  const extra = Math.max(0, installments - 1) * row.perInstallment
  return row.base + extra
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

function daysBetween(from: string, to: string): number {
  const t1 = new Date(`${from}T00:00:00Z`).getTime()
  const t2 = new Date(`${to}T00:00:00Z`).getTime()
  return Math.round((t2 - t1) / (24 * 60 * 60 * 1000))
}

function hash(s: string): number {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = (h * 33 + s.charCodeAt(i)) | 0
  return Math.abs(h)
}
