import { describe, expect, it } from 'vitest'
import type { NfceEmissionInput, NfeProductEmissionInput, NfseEmissionInput } from '../provider'
import { buildNfcePayload } from './nfce'
import { SIMPLES_TAX_DEFAULTS, buildNfePayload } from './nfe'
import { buildNfsePayload } from './nfse'
import { bpToPercent, centsToDecimal, documentField, isoDate } from './shared'

const FIXED_DATE = new Date('2026-07-15T12:00:00Z')

const NFSE_INPUT: NfseEmissionInput = {
  companyCnpj: '11.222.333/0001-44',
  municipalityCode: '3550308',
  serie: 1,
  numero: 42,
  recipient: {
    document: '52998224725',
    name: 'Carlos Aluno',
    email: 'carlos@aluno.test',
    address: {
      street: 'Rua das Flores',
      number: '100',
      complement: 'Ap 12',
      district: 'Centro',
      municipalityCode: '3550308',
      uf: 'SP',
      zip: '01310-100',
    },
  },
  service: {
    lc116Code: '8.02',
    cnae: '8591-1/00',
    taxRegime: 'simples_nacional' as const,
    description: 'Mensalidade academia — julho/2026',
    valorTotalCents: 19900,
    issRateBp: 250,
  },
  notes: 'Ref. contrato 123',
}

const NFE_INPUT: NfeProductEmissionInput = {
  companyCnpj: '11222333000144',
  serie: 1,
  numero: 7,
  recipient: {
    document: '11444777000161',
    name: 'Distribuidora Fit LTDA',
    address: {
      street: 'Av Industrial',
      number: '2000',
      district: 'Distrito',
      municipalityCode: '3550308',
      uf: 'SP',
      zip: '04000000',
    },
  },
  items: [
    {
      sku: 'WHEY-900',
      description: 'Whey Protein 900g',
      quantity: 2,
      unitCents: 12050,
      cfop: '5102',
      ncm: '2106.90.30',
      cestCode: '17.110.00',
    },
  ],
  finNFe: 1,
  idDest: 1,
}

const NFCE_INPUT: NfceEmissionInput = {
  companyCnpj: '11222333000144',
  serie: 1,
  numero: 99,
  recipientCpf: '529.982.247-25',
  items: [
    {
      sku: 'BARRA-01',
      description: 'Barra de proteína',
      quantity: 3,
      unitCents: 990,
      cfop: '5102',
      ncm: '21069030',
    },
  ],
  payments: [{ method: '17', amountCents: 2970 }],
}

describe('shared helpers', () => {
  it('centsToDecimal converte centavos pra reais decimais', () => {
    expect(centsToDecimal(19900)).toBe(199)
    expect(centsToDecimal(12345)).toBe(123.45)
    expect(centsToDecimal(1)).toBe(0.01)
  })

  it('bpToPercent converte basis points pra percentual', () => {
    expect(bpToPercent(250)).toBe(2.5)
    expect(bpToPercent(500)).toBe(5)
  })

  it('isoDate formata YYYY-MM-DD', () => {
    expect(isoDate(FIXED_DATE)).toBe('2026-07-15')
  })

  it('documentField discrimina CPF vs CNPJ e rejeita tamanho inválido', () => {
    expect(documentField('529.982.247-25', 'cpf', 'cnpj')).toEqual({ cpf: '52998224725' })
    expect(documentField('11.222.333/0001-44', 'cpf', 'cnpj')).toEqual({
      cnpj: '11222333000144',
    })
    expect(() => documentField('123', 'cpf', 'cnpj')).toThrow(/documento inválido/)
  })
})

describe('buildNfsePayload', () => {
  it('marca optante_simples_nacional na raiz — inclusive MEI', () => {
    // Campo obrigatorio que o LogiFit nunca enviou. Sem ele o municipio trata
    // a nota como regime normal e lanca ISS proprio sobre faturamento que ja
    // recolhe ISS dentro do DAS: imposto em duplicidade, revertivel so por
    // repeticao de indebito.
    const opts = { emissionDate: FIXED_DATE }
    const simples = buildNfsePayload(NFSE_INPUT, opts)
    expect(simples.optante_simples_nacional).toBe(true)

    const mei = buildNfsePayload(
      { ...NFSE_INPUT, service: { ...NFSE_INPUT.service, taxRegime: 'mei' } },
      opts,
    )
    expect(mei.optante_simples_nacional).toBe(true)

    const presumido = buildNfsePayload(
      { ...NFSE_INPUT, service: { ...NFSE_INPUT.service, taxRegime: 'lucro_presumido' } },
      opts,
    )
    expect(presumido.optante_simples_nacional).toBe(false)
  })

  it('natureza_operacao default 1 (tributado no municipio) e sobrescrivel', () => {
    expect(buildNfsePayload(NFSE_INPUT, { emissionDate: FIXED_DATE }).natureza_operacao).toBe('1')
    // Excecoes do art. 3o da LC 116 recolhem no municipio do tomador.
    expect(
      buildNfsePayload(NFSE_INPUT, { emissionDate: FIXED_DATE, naturezaOperacao: '2' })
        .natureza_operacao,
    ).toBe('2')
  })

  it('omite codigo_cnae em municipio que nao consome (Cascavel/AtendeNet)', () => {
    // CNAE nao vinculado a inscricao municipal derruba a nota (A0001) onde e
    // validado; onde e ignorado, mandar e ruido com risco e zero ganho.
    const cascavel = buildNfsePayload(
      { ...NFSE_INPUT, municipalityCode: '4104808' },
      { emissionDate: FIXED_DATE },
    )
    expect((cascavel.servico as Record<string, unknown>).codigo_cnae).toBeUndefined()

    // Municipio nao catalogado mantem o comportamento antigo.
    const generico = buildNfsePayload(NFSE_INPUT, { emissionDate: FIXED_DATE })
    expect((generico.servico as Record<string, unknown>).codigo_cnae).toBe('8591100')
  })

  it('monta payload completo com prestador/tomador/servico', () => {
    const payload = buildNfsePayload(NFSE_INPUT, {
      emissionDate: FIXED_DATE,
      inscricaoMunicipal: '12345',
    })
    expect(payload).toMatchObject({
      data_emissao: '2026-07-15',
      prestador: {
        cnpj: '11222333000144',
        codigo_municipio: '3550308',
        inscricao_municipal: '12345',
      },
      tomador: {
        cpf: '52998224725',
        razao_social: 'Carlos Aluno',
        email: 'carlos@aluno.test',
      },
      servico: {
        discriminacao: 'Mensalidade academia — julho/2026',
        valor_servicos: 199,
        aliquota: 2.5,
        iss_retido: false,
        item_lista_servico: '8.02',
        codigo_cnae: '8591100',
      },
      observacoes: 'Ref. contrato 123',
    })
    const tomador = payload.tomador as Record<string, unknown>
    expect(tomador.endereco).toMatchObject({ cep: '01310100', uf: 'SP' })
  })

  it('omite endereço/email/inscrição quando ausentes', () => {
    const minimal: NfseEmissionInput = {
      ...NFSE_INPUT,
      recipient: { document: '52998224725', name: 'Carlos' },
      notes: null,
    }
    const payload = buildNfsePayload(minimal, { emissionDate: FIXED_DATE })
    const tomador = payload.tomador as Record<string, unknown>
    expect(tomador.endereco).toBeUndefined()
    expect(tomador.email).toBeUndefined()
    expect(payload.observacoes).toBeUndefined()
    expect((payload.prestador as Record<string, unknown>).inscricao_municipal).toBeUndefined()
  })

  it('iss_retido configurável', () => {
    const payload = buildNfsePayload(NFSE_INPUT, {
      emissionDate: FIXED_DATE,
      issRetido: true,
    })
    expect((payload.servico as Record<string, unknown>).iss_retido).toBe(true)
  })
})

describe('buildNfePayload', () => {
  it('monta NF-e venda com defaults Simples (CSOSN 102)', () => {
    const payload = buildNfePayload(NFE_INPUT, {
      emissionDate: FIXED_DATE,
      naturezaOperacao: 'Venda de mercadoria',
      tipoDocumento: 1,
    })
    expect(payload).toMatchObject({
      natureza_operacao: 'Venda de mercadoria',
      tipo_documento: 1,
      finalidade_emissao: 1,
      local_destino: 1,
      cnpj_emitente: '11222333000144',
      cnpj_destinatario: '11444777000161',
      serie: 1,
      numero: 7,
    })
    const items = payload.items as Array<Record<string, unknown>>
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      numero_item: 1,
      cfop: '5102',
      codigo_ncm: '21069030',
      cest: '1711000',
      quantidade_comercial: 2,
      valor_unitario_comercial: 120.5,
      valor_bruto: 241,
      icms_situacao_tributaria: SIMPLES_TAX_DEFAULTS.icmsSituacaoTributaria,
      pis_situacao_tributaria: '07',
    })
  })

  it('devolução referencia chave original e finNFe=4', () => {
    const devolucao: NfeProductEmissionInput = { ...NFE_INPUT, finNFe: 4 }
    const chaveOriginal = '3'.repeat(44)
    const payload = buildNfePayload(devolucao, {
      emissionDate: FIXED_DATE,
      naturezaOperacao: 'Devolução de venda',
      tipoDocumento: 1,
      referencedChaves: [chaveOriginal],
    })
    expect(payload.finalidade_emissao).toBe(4)
    expect(payload.notas_referenciadas).toEqual([{ chave_nfe: chaveOriginal }])
  })

  it('entrada própria usa tipo_documento=0', () => {
    const payload = buildNfePayload(NFE_INPUT, {
      emissionDate: FIXED_DATE,
      naturezaOperacao: 'Entrada de mercadoria adquirida de PF',
      tipoDocumento: 0,
    })
    expect(payload.tipo_documento).toBe(0)
  })

  it('tax defaults substituíveis (Presumido CST 00)', () => {
    const payload = buildNfePayload(NFE_INPUT, {
      emissionDate: FIXED_DATE,
      naturezaOperacao: 'Venda de mercadoria',
      tipoDocumento: 1,
      taxDefaults: {
        icmsSituacaoTributaria: '00',
        icmsOrigem: 0,
        pisSituacaoTributaria: '01',
        cofinsSituacaoTributaria: '01',
      },
    })
    const items = payload.items as Array<Record<string, unknown>>
    expect(items[0]).toMatchObject({
      icms_situacao_tributaria: '00',
      pis_situacao_tributaria: '01',
    })
  })
})

describe('buildNfcePayload', () => {
  it('monta NFC-e presencial com formas_pagamento obrigatórias', () => {
    const payload = buildNfcePayload(NFCE_INPUT, { emissionDate: FIXED_DATE })
    expect(payload).toMatchObject({
      natureza_operacao: 'Venda ao consumidor',
      presenca_comprador: 1,
      tipo_documento: 1,
      cpf_destinatario: '52998224725',
      formas_pagamento: [{ forma_pagamento: '17', valor_pagamento: 29.7 }],
    })
    const items = payload.items as Array<Record<string, unknown>>
    expect(items[0]).toMatchObject({ valor_bruto: 29.7, cfop: '5102' })
  })

  it('venda sem identificação omite cpf_destinatario', () => {
    const anon: NfceEmissionInput = { ...NFCE_INPUT, recipientCpf: null }
    const payload = buildNfcePayload(anon, { emissionDate: FIXED_DATE })
    expect(payload.cpf_destinatario).toBeUndefined()
  })
})
