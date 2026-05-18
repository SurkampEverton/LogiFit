/**
 * MockFiscalProvider — Sprint 36 Faixa B.1 (ADR 0059).
 *
 * Provider determinístico pra dev/test. Sempre retorna `status='completed'`
 * com chave SEFAZ fake 44 dígitos baseada em hash do input. Útil pra:
 *   - Testes E2E sem conectar com Focus sandbox real
 *   - Dev local quando dev não tem credentials Focus
 *   - CI determinístico (mesma chave pra mesmo input)
 *
 * **NUNCA usar em produção** — `fiscal_emissions.provider='mock'` é check-bloqueado
 *   no envelope `wrapAction` quando `NODE_ENV='production'` (Sprint 36b implementa).
 */

import { createHash } from 'node:crypto'
import type {
  CancellationInput,
  CceInput,
  EmissionResult,
  EventResult,
  FiscalProvider,
  InutilizacaoInput,
  NfeProductEmissionInput,
  NfseEmissionInput,
  ProviderHealthResult,
} from './provider'

/**
 * Gera chave SEFAZ fake determinística (44 dígitos) baseada em SHA-256 do input.
 * Estrutura NF-e real: cUF(2) + AAMM(4) + CNPJ(14) + mod(2) + serie(3) + nNF(9) + tpEmis(1) + cNF(8) + cDV(1)
 *
 * Mock simplifica: usa hash hex 44 chars → numeric via charCodeAt mod 10.
 */
function fakeChave(seed: string): string {
  const hash = createHash('sha256').update(seed).digest('hex')
  let out = ''
  for (let i = 0; i < 44; i++) {
    const c = hash.charCodeAt(i % hash.length)
    out += String((c + i) % 10)
  }
  return out
}

function fakeRef(seed: string): string {
  const hash = createHash('sha256').update(seed).digest('hex').slice(0, 16)
  return `mock_${hash}`
}

export class MockFiscalProvider implements FiscalProvider {
  readonly name = 'mock' as const
  readonly env = 'homologacao' as const

  async healthCheck(): Promise<ProviderHealthResult> {
    return { ok: true, latencyMs: 1, message: null }
  }

  async emitNfse(input: NfseEmissionInput): Promise<EmissionResult> {
    const seed = `nfse:${input.companyCnpj}:${input.serie}:${input.numero}:${input.recipient.document}:${input.service.valorTotalCents}`
    const chave = fakeChave(seed)
    return {
      providerRef: fakeRef(seed),
      status: 'completed',
      chave,
      xmlUrl: `https://mock.local/nfse/${chave}.xml`,
      pdfUrl: `https://mock.local/nfse/${chave}.pdf`,
      rejectionReason: null,
      raw: {
        mock: true,
        kind: 'nfse',
        valor_total: input.service.valorTotalCents,
        municipio: input.municipalityCode,
      },
    }
  }

  async emitNfeProduct(input: NfeProductEmissionInput): Promise<EmissionResult> {
    const totalCents = input.items.reduce(
      (s, it) => s + it.quantity * it.unitCents,
      0,
    )
    const seed = `nfe:${input.companyCnpj}:${input.serie}:${input.numero}:${input.recipient.document}:${totalCents}`
    const chave = fakeChave(seed)
    return {
      providerRef: fakeRef(seed),
      status: 'completed',
      chave,
      xmlUrl: `https://mock.local/nfe/${chave}.xml`,
      pdfUrl: `https://mock.local/nfe/${chave}.pdf`,
      rejectionReason: null,
      raw: {
        mock: true,
        kind: 'nfe',
        items: input.items.length,
        valor_total: totalCents,
        fin_nfe: input.finNFe,
      },
    }
  }

  async cancel(input: CancellationInput): Promise<EventResult> {
    const seed = `cancel:${input.chave}:${input.justification.length}`
    return {
      providerRef: fakeRef(seed),
      status: 'completed',
      xmlUrl: `https://mock.local/event/cancel/${input.chave}.xml`,
      rejectionReason: null,
      raw: { mock: true, kind: 'cancellation', chave: input.chave },
    }
  }

  async issueCce(input: CceInput): Promise<EventResult> {
    const seed = `cce:${input.chave}:${input.sequence}`
    return {
      providerRef: fakeRef(seed),
      status: 'completed',
      xmlUrl: `https://mock.local/event/cce/${input.chave}-${input.sequence}.xml`,
      rejectionReason: null,
      raw: {
        mock: true,
        kind: 'cce',
        chave: input.chave,
        sequence: input.sequence,
      },
    }
  }

  async inutilize(input: InutilizacaoInput): Promise<EventResult> {
    const seed = `inut:${input.companyCnpj}:${input.emissionKind}:${input.serie}:${input.numeroFrom}-${input.numeroTo}:${input.year}`
    return {
      providerRef: fakeRef(seed),
      status: 'completed',
      xmlUrl: `https://mock.local/event/inut/${input.companyCnpj}-${input.year}-${input.numeroFrom}-${input.numeroTo}.xml`,
      rejectionReason: null,
      raw: {
        mock: true,
        kind: 'inutilizacao',
        from: input.numeroFrom,
        to: input.numeroTo,
      },
    }
  }

  async queryStatus(providerRef: string): Promise<EmissionResult> {
    // Mock sempre returns completed mesmo em re-consulta
    return {
      providerRef,
      status: 'completed',
      chave: fakeChave(`query:${providerRef}`),
      xmlUrl: `https://mock.local/query/${providerRef}.xml`,
      pdfUrl: `https://mock.local/query/${providerRef}.pdf`,
      rejectionReason: null,
      raw: { mock: true, queried: providerRef },
    }
  }
}

/** Singleton mock (state-less; reuse seguro) */
export const mockFiscalProvider = new MockFiscalProvider()
