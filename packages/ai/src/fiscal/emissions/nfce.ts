/**
 * Payload builder NFC-e (modelo 65, varejo balcão) → Focus NFe API v2 — Sprint 36b (ADR 0059).
 *
 * NFC-e difere da NF-e 55: consumidor pode ser não-identificado (CPF opcional),
 * grupo de pagamento (`formas_pagamento`) é obrigatório no XML, CFOP fixo 5102
 * (SEFAZ impõe operação interna — cfop-resolver já trata), presença 1 (presencial).
 *
 * CSC (Código de Segurança do Contribuinte) por UF fica nas credenciais Focus
 * da company — o provider Focus injeta na transmissão, não entra neste payload.
 */

import type { NfceEmissionInput } from '../provider'
import { type NfeTaxDefaults, SIMPLES_TAX_DEFAULTS } from './nfe'
import { centsToDecimal, isoDate } from './shared'

export interface NfcePayloadOptions {
  emissionDate: Date
  taxDefaults?: NfeTaxDefaults
}

/**
 * Monta o body de `POST /v2/nfce?ref={ref}`.
 */
export function buildNfcePayload(
  input: NfceEmissionInput,
  options: NfcePayloadOptions,
): Record<string, unknown> {
  const tax = options.taxDefaults ?? SIMPLES_TAX_DEFAULTS

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
    natureza_operacao: 'Venda ao consumidor',
    data_emissao: isoDate(options.emissionDate),
    tipo_documento: 1,
    finalidade_emissao: 1,
    presenca_comprador: 1, // varejo balcão é sempre presencial
    cnpj_emitente: input.companyCnpj.replace(/\D/g, ''),
    serie: input.serie,
    numero: input.numero,
    modalidade_frete: 9,
    items,
    formas_pagamento: input.payments.map((p) => ({
      forma_pagamento: p.method,
      valor_pagamento: centsToDecimal(p.amountCents),
    })),
  }

  const cpf = input.recipientCpf?.replace(/\D/g, '')
  if (cpf) payload.cpf_destinatario = cpf

  return payload
}
