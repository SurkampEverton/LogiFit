import { describe, expect, it, vi } from 'vitest'
import {
  type FiscalFetchFn,
  FiscalProviderAuthError,
  FiscalProviderRateLimitError,
  FiscalProviderUnavailableError,
  FocusNfeProvider,
} from './focus-nfe'
import type { NfseEmissionInput } from './provider'

const NFSE_INPUT: NfseEmissionInput = {
  companyCnpj: '11222333000144',
  municipalityCode: '3550308',
  serie: 1,
  numero: 42,
  recipient: { document: '52998224725', name: 'Carlos Aluno' },
  service: {
    lc116Code: '8.02',
    taxRegime: 'simples_nacional' as const,
    description: 'Mensalidade academia',
    valorTotalCents: 19900,
    issRateBp: 250,
  },
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function providerWith(fetchFn: FiscalFetchFn): FocusNfeProvider {
  return new FocusNfeProvider({
    apiToken: 'token-teste',
    env: 'homologacao',
    fetchFn,
  })
}

describe('FocusNfeProvider', () => {
  it('emissionRef é determinística e limpa formatação do CNPJ', () => {
    expect(FocusNfeProvider.emissionRef('nfse', '11.222.333/0001-44', 1, 42)).toBe(
      'lf-nfse-11222333000144-1-42',
    )
  })

  it('emitNfse envia POST pro host de homologação com Basic auth', async () => {
    const fetchFn = vi.fn<FiscalFetchFn>(async () =>
      jsonResponse(202, { status: 'processando_autorizacao' }),
    )
    const provider = providerWith(fetchFn)
    const result = await provider.emitNfse(NFSE_INPUT)

    expect(fetchFn).toHaveBeenCalledOnce()
    const [url, init] = fetchFn.mock.calls[0] as Parameters<FiscalFetchFn>
    expect(url).toBe('https://homologacao.focusnfe.com.br/v2/nfse?ref=lf-nfse-11222333000144-1-42')
    expect(init.method).toBe('POST')
    expect(init.headers.authorization).toBe(
      `Basic ${Buffer.from('token-teste:').toString('base64')}`,
    )
    expect(init.allowedHosts).toEqual(['api.focusnfe.com.br', 'homologacao.focusnfe.com.br'])
    expect(result.status).toBe('processing')
    expect(result.providerRef).toBe('lf-nfse-11222333000144-1-42')
  })

  it('sentPayload devolve o corpo transmitido — inclusive quando rejeitado', async () => {
    // Rejeicao fiscal so e depuravel com o payload ao lado do motivo: em 20/07
    // Cascavel devolveu "codigo do item da lista de servico preenchido
    // incorretamente" e nao havia como saber qual codigo tinha saido.
    const fetchFn = vi.fn<FiscalFetchFn>(async () =>
      jsonResponse(422, { codigo: 'erro_validacao', mensagem: 'Codigo do item invalido' }),
    )
    const result = await providerWith(fetchFn).emitNfse(NFSE_INPUT)

    expect(result.status).toBe('rejected')
    const [, init] = fetchFn.mock.calls[0] as Parameters<FiscalFetchFn>
    expect(result.sentPayload).toEqual(JSON.parse(init.body as string))
    expect((result.sentPayload?.servico as Record<string, unknown>).item_lista_servico).toBe(
      NFSE_INPUT.service.codigoTributacaoNacional ?? NFSE_INPUT.service.lc116Code,
    )
  })

  it('env producao usa api.focusnfe.com.br', async () => {
    const fetchFn = vi.fn<FiscalFetchFn>(async () => jsonResponse(202, {}))
    const provider = new FocusNfeProvider({
      apiToken: 't',
      env: 'producao',
      fetchFn,
    })
    await provider.emitNfse(NFSE_INPUT)
    const [url] = fetchFn.mock.calls[0] as Parameters<FiscalFetchFn>
    expect(url).toMatch(/^https:\/\/api\.focusnfe\.com\.br\//)
  })

  it('autorizado síncrono mapeia completed com chave + URLs', async () => {
    const fetchFn = vi.fn<FiscalFetchFn>(async () =>
      jsonResponse(200, {
        status: 'autorizado',
        chave_nfe: '5'.repeat(44),
        caminho_xml_nota_fiscal: '/notas/x.xml',
        caminho_danfe: '/notas/x.pdf',
      }),
    )
    const result = await providerWith(fetchFn).queryStatus('lf-nfe-x-1-1', 'nfe')
    expect(result.status).toBe('completed')
    expect(result.chave).toBe('5'.repeat(44))
    expect(result.xmlUrl).toBe('/notas/x.xml')
    expect(result.pdfUrl).toBe('/notas/x.pdf')
  })

  it('422 vira rejected com motivo (não lança)', async () => {
    const fetchFn = vi.fn<FiscalFetchFn>(async () =>
      jsonResponse(422, {
        erros: [{ codigo: 'campo_invalido', mensagem: 'CNPJ inválido' }],
      }),
    )
    const result = await providerWith(fetchFn).emitNfse(NFSE_INPUT)
    expect(result.status).toBe('rejected')
    expect(result.rejectionReason).toBe('CNPJ inválido')
  })

  it('erro_autorizacao mapeia rejected com mensagem_sefaz', async () => {
    const fetchFn = vi.fn<FiscalFetchFn>(async () =>
      jsonResponse(200, {
        status: 'erro_autorizacao',
        mensagem_sefaz: 'Rejeição 539: duplicidade',
      }),
    )
    const result = await providerWith(fetchFn).queryStatus('lf-nfe-x-1-1', 'nfe')
    expect(result.status).toBe('rejected')
    expect(result.rejectionReason).toBe('Rejeição 539: duplicidade')
  })

  // Caso real (2026-07-20, primeira emissão contra a Focus de verdade):
  // empresa sem credencial do município. A Focus responde `{codigo, mensagem}`
  // SEM campo `status`, e NÃO no par 400/422 — antes do fix isso caía no
  // default `queued` e o operador ficava esperando nota que nunca chegaria.
  it.each([404, 200, 202])(
    'erro de cadastro da Focus (HTTP %i) vira rejected, não queued',
    async (httpStatus) => {
      const fetchFn = vi.fn<FiscalFetchFn>(async () =>
        jsonResponse(httpStatus, {
          codigo: 'empresa_nao_habilitada',
          mensagem: 'É necessário configurar o usuário e senha desta empresa neste município.',
        }),
      )
      const result = await providerWith(fetchFn).emitNfse(NFSE_INPUT)
      expect(result.status).toBe('rejected')
      expect(result.rejectionReason).toContain('empresa_nao_habilitada')
      expect(result.rejectionReason).toContain('município')
    },
  )

  it('202 sem corpo de erro segue queued (não confunde enfileiramento com falha)', async () => {
    const fetchFn = vi.fn<FiscalFetchFn>(async () => jsonResponse(202, {}))
    const result = await providerWith(fetchFn).emitNfse(NFSE_INPUT)
    expect(result.status).toBe('queued')
  })

  it('evento com erro de cadastro da Focus também vira rejected, não processing', async () => {
    const fetchFn = vi.fn<FiscalFetchFn>(async () =>
      jsonResponse(200, {
        codigo: 'empresa_nao_habilitada',
        mensagem: 'É necessário configurar o usuário e senha desta empresa neste município.',
      }),
    )
    const result = await providerWith(fetchFn).cancel({
      providerRef: 'lf-nfse-x-1-1',
      chave: '1'.repeat(44),
      justification: 'Emitida em duplicidade por erro operacional',
      kind: 'nfse',
    })
    expect(result.status).toBe('rejected')
    expect(result.rejectionReason).toContain('empresa_nao_habilitada')
  })

  it('429 lança FiscalProviderRateLimitError', async () => {
    const fetchFn = vi.fn<FiscalFetchFn>(async () => jsonResponse(429, {}))
    await expect(providerWith(fetchFn).emitNfse(NFSE_INPUT)).rejects.toThrow(
      FiscalProviderRateLimitError,
    )
  })

  it('403 lança FiscalProviderAuthError', async () => {
    const fetchFn = vi.fn<FiscalFetchFn>(async () => jsonResponse(403, {}))
    await expect(providerWith(fetchFn).emitNfse(NFSE_INPUT)).rejects.toThrow(
      FiscalProviderAuthError,
    )
  })

  it('5xx lança FiscalProviderUnavailableError (transient → retry)', async () => {
    const fetchFn = vi.fn<FiscalFetchFn>(async () => jsonResponse(503, {}))
    await expect(providerWith(fetchFn).emitNfse(NFSE_INPUT)).rejects.toThrow(
      FiscalProviderUnavailableError,
    )
  })

  it('timeout/erro de rede vira FiscalProviderUnavailableError', async () => {
    const fetchFn = vi.fn<FiscalFetchFn>(async () => {
      throw new Error('fetch timeout')
    })
    await expect(providerWith(fetchFn).emitNfse(NFSE_INPUT)).rejects.toThrow(
      FiscalProviderUnavailableError,
    )
  })

  it('cancel roteia recurso por kind (nfse → DELETE /v2/nfse)', async () => {
    const fetchFn = vi.fn<FiscalFetchFn>(async () => jsonResponse(200, { status: 'cancelado' }))
    const result = await providerWith(fetchFn).cancel({
      providerRef: 'lf-nfse-x-1-1',
      chave: '1'.repeat(44),
      justification: 'Emitida em duplicidade por erro operacional',
      kind: 'nfse',
    })
    const [url, init] = fetchFn.mock.calls[0] as Parameters<FiscalFetchFn>
    expect(url).toBe('https://homologacao.focusnfe.com.br/v2/nfse/lf-nfse-x-1-1')
    expect(init.method).toBe('DELETE')
    expect(result.status).toBe('completed')
  })

  it('nfe_return roteia recurso nfe', async () => {
    const fetchFn = vi.fn<FiscalFetchFn>(async () => jsonResponse(200, { status: 'cancelado' }))
    await providerWith(fetchFn).cancel({
      providerRef: 'lf-nfe_return-x-1-1',
      chave: '1'.repeat(44),
      justification: 'Justificativa mínima de quinze chars',
      kind: 'nfe_return',
    })
    const [url] = fetchFn.mock.calls[0] as Parameters<FiscalFetchFn>
    expect(url).toContain('/v2/nfe/')
  })

  it('issueCce envia POST carta_correcao', async () => {
    const fetchFn = vi.fn<FiscalFetchFn>(async () => jsonResponse(200, { status: 'autorizado' }))
    await providerWith(fetchFn).issueCce({
      providerRef: 'lf-nfe-x-1-1',
      chave: '1'.repeat(44),
      correction: 'Corrigir endereço da transportadora',
      sequence: 1,
    })
    const [url, init] = fetchFn.mock.calls[0] as Parameters<FiscalFetchFn>
    expect(url).toBe('https://homologacao.focusnfe.com.br/v2/nfe/lf-nfe-x-1-1/carta_correcao')
    expect(JSON.parse(init.body ?? '{}')).toEqual({
      correcao: 'Corrigir endereço da transportadora',
    })
  })

  it('inutilize envia faixa com strings numéricas', async () => {
    const fetchFn = vi.fn<FiscalFetchFn>(async () => jsonResponse(200, { status: 'autorizado' }))
    await providerWith(fetchFn).inutilize({
      companyCnpj: '11222333000144',
      emissionKind: 'nfe',
      serie: 1,
      numeroFrom: 10,
      numeroTo: 12,
      justification: 'Falha técnica na numeração sequencial',
      year: 26,
    })
    const [url, init] = fetchFn.mock.calls[0] as Parameters<FiscalFetchFn>
    expect(url).toBe('https://homologacao.focusnfe.com.br/v2/nfe/inutilizacao')
    expect(JSON.parse(init.body ?? '{}')).toEqual({
      cnpj: '11222333000144',
      serie: '1',
      numero_inicial: '10',
      numero_final: '12',
      justificativa: 'Falha técnica na numeração sequencial',
    })
  })

  it('healthCheck ok com credentials válidas (404 em ref inexistente)', async () => {
    const fetchFn = vi.fn<FiscalFetchFn>(async () =>
      jsonResponse(404, { mensagem: 'nota não encontrada' }),
    )
    const health = await providerWith(fetchFn).healthCheck()
    expect(health.ok).toBe(true)
  })

  it('healthCheck falha com credentials inválidas', async () => {
    const fetchFn = vi.fn<FiscalFetchFn>(async () => jsonResponse(401, {}))
    const health = await providerWith(fetchFn).healthCheck()
    expect(health.ok).toBe(false)
    expect(health.message).toMatch(/HTTP 401/)
  })
})
