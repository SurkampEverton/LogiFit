/**
 * Payload builder NF-e produto (modelo 55) → Focus NFe API v2 — Sprint 36b (ADR 0059).
 *
 * Cobre os 6 kinds modelo 55: venda (`nfe`), devolução (`nfe_return`, finNFe=4),
 * transferência (`nfe_transfer`), remessa/retorno conserto (`nfe_conserto_*`) e
 * entrada própria (`nfe_self_entry`, tipo_documento=0). Diferenciação vem de
 * `naturezaOperacao` + `finNFe` + CFOP dos items (cfop-resolver).
 *
 * **Tributação:** LogiFit não calcula imposto (ADR 0059) — mas o layout NF-e
 * exige CST/CSOSN por item. Defaults cobrem Simples Nacional (CSOSN 102 +
 * PIS/COFINS 07 outras operações); tenants Presumido/Real configuram overrides
 * no catálogo fiscal (Sprint 36c expõe UI).
 */

import type { NfeProductEmissionInput } from '../provider'
import { centsToDecimal, documentField, isoDate } from './shared'

export interface NfeTaxDefaults {
  /** CSOSN (Simples: '102') ou CST ICMS (Presumido/Real: '00', '40', etc). */
  icmsSituacaoTributaria: string
  /** Origem da mercadoria (0=nacional). */
  icmsOrigem: number
  pisSituacaoTributaria: string
  cofinsSituacaoTributaria: string
}

/** Default MVP: Simples Nacional sem crédito (CSOSN 102) + PIS/COFINS 07. */
export const SIMPLES_TAX_DEFAULTS: NfeTaxDefaults = {
  icmsSituacaoTributaria: '102',
  icmsOrigem: 0,
  pisSituacaoTributaria: '07',
  cofinsSituacaoTributaria: '07',
}

export interface NfePayloadOptions {
  emissionDate: Date
  /** Descrição da operação no cabeçalho (ex: "Venda de mercadoria", "Devolução de venda"). */
  naturezaOperacao: string
  /**
   * tipo_documento: 1=saída (venda/devolução emitida/transferência/remessa),
   * 0=entrada (nfe_self_entry — compra de PF sem inscrição, CFOP 1.917).
   */
  tipoDocumento: 0 | 1
  /** Chaves SEFAZ referenciadas (devolução exige a chave da NF-e original). */
  referencedChaves?: string[]
  taxDefaults?: NfeTaxDefaults
  /** presenca_comprador: 9=não presencial (default operação não-varejo). */
  presencaComprador?: number
}

/**
 * Monta o body de `POST /v2/nfe?ref={ref}`.
 */
export function buildNfePayload(
  input: NfeProductEmissionInput,
  options: NfePayloadOptions,
): Record<string, unknown> {
  const tax = options.taxDefaults ?? SIMPLES_TAX_DEFAULTS
  const { recipient } = input

  const items = input.items.map((item, index) => {
    const totalCents = Math.round(item.quantity * item.unitCents)
    const entry: Record<string, unknown> = {
      numero_item: index + 1,
      codigo_produto: item.sku,
      descricao: item.description,
      cfop: item.cfop,
      codigo_ncm: item.ncm.replace(/\D/g, ''),
      unidade_comercial: 'UN',
      quantidade_comercial: item.quantity,
      valor_unitario_comercial: centsToDecimal(item.unitCents),
      unidade_tributavel: 'UN',
      quantidade_tributavel: item.quantity,
      valor_unitario_tributavel: centsToDecimal(item.unitCents),
      valor_bruto: centsToDecimal(totalCents),
      icms_situacao_tributaria: tax.icmsSituacaoTributaria,
      icms_origem: tax.icmsOrigem,
      pis_situacao_tributaria: tax.pisSituacaoTributaria,
      cofins_situacao_tributaria: tax.cofinsSituacaoTributaria,
    }
    if (item.cestCode) entry.cest = item.cestCode.replace(/\D/g, '')
    return entry
  })

  const payload: Record<string, unknown> = {
    natureza_operacao: options.naturezaOperacao,
    data_emissao: isoDate(options.emissionDate),
    tipo_documento: options.tipoDocumento,
    finalidade_emissao: input.finNFe,
    local_destino: input.idDest,
    presenca_comprador: options.presencaComprador ?? 9,
    cnpj_emitente: input.companyCnpj.replace(/\D/g, ''),
    serie: input.serie,
    numero: input.numero,
    nome_destinatario: recipient.name,
    ...documentField(recipient.document, 'cpf_destinatario', 'cnpj_destinatario'),
    modalidade_frete: 9, // sem frete — serviços/varejo local (Sprint 36c: configurável)
    items,
  }

  if (recipient.address) {
    payload.logradouro_destinatario = recipient.address.street
    payload.numero_destinatario = recipient.address.number
    if (recipient.address.complement) {
      payload.complemento_destinatario = recipient.address.complement
    }
    payload.bairro_destinatario = recipient.address.district
    payload.codigo_municipio_destinatario = recipient.address.municipalityCode
    payload.uf_destinatario = recipient.address.uf
    payload.cep_destinatario = recipient.address.zip.replace(/\D/g, '')
  }

  if (options.referencedChaves && options.referencedChaves.length > 0) {
    payload.notas_referenciadas = options.referencedChaves.map((chave) => ({
      chave_nfe: chave.replace(/\D/g, ''),
    }))
  }

  return payload
}
