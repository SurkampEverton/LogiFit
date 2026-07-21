/**
 * Payload builder NFS-e → Focus NFe API v2 — Sprint 36b (ADR 0059).
 *
 * Focus normaliza os 5500+ layouts municipais (ABRASF, GINFES, IPM, Nota
 * Carioca, etc) a partir deste JSON único. LogiFit não monta XML municipal.
 *
 * Builder é puro e determinístico (data de emissão vem do caller) — testável
 * sem rede.
 */

import { findMunicipalityNfseProfile } from '../municipios-nfse'
import type { NfseEmissionInput } from '../provider'
import { bpToPercent, centsToDecimal, documentField, isoDate } from './shared'

export interface NfsePayloadOptions {
  /** Data de emissão — caller injeta (SA usa new Date(); testes fixam). */
  emissionDate: Date
  /** ISS retido na fonte pelo tomador (retenção configurada no catálogo). */
  issRetido?: boolean
  /** Inscrição municipal do prestador quando o município exige. */
  inscricaoMunicipal?: string | null
  /**
   * Natureza da operação (enum Focus 1..6). Default `1` = tributação no
   * município do prestador, que é o caso da esmagadora maioria dos serviços.
   *
   * As exceções do art. 3º da LC 116/2003 (construção civil, limpeza urbana,
   * vigilância, etc — ISS devido no município do tomador) exigem valor
   * diferente. Fica explícito e sobrescrevível de propósito: default errado
   * escondido faz o imposto ir pro município errado.
   */
  naturezaOperacao?: '1' | '2' | '3' | '4' | '5' | '6'
}

/**
 * Monta o body de `POST /v2/nfse?ref={ref}`.
 */
export function buildNfsePayload(
  input: NfseEmissionInput,
  options: NfsePayloadOptions,
): Record<string, unknown> {
  const { recipient, service } = input

  const tomador: Record<string, unknown> = {
    ...documentField(recipient.document, 'cpf', 'cnpj'),
    razao_social: recipient.name,
  }
  if (recipient.email) tomador.email = recipient.email
  if (recipient.address) {
    tomador.endereco = {
      logradouro: recipient.address.street,
      numero: recipient.address.number,
      complemento: recipient.address.complement ?? undefined,
      bairro: recipient.address.district,
      codigo_municipio: recipient.address.municipalityCode,
      uf: recipient.address.uf,
      cep: recipient.address.zip.replace(/\D/g, ''),
    }
  }

  const prestador: Record<string, unknown> = {
    cnpj: input.companyCnpj.replace(/\D/g, ''),
    codigo_municipio: input.municipalityCode,
  }
  if (options.inscricaoMunicipal) {
    prestador.inscricao_municipal = options.inscricaoMunicipal
  }

  const servico: Record<string, unknown> = {
    discriminacao: service.description,
    valor_servicos: centsToDecimal(service.valorTotalCents),
    aliquota: bpToPercent(service.issRateBp),
    iss_retido: options.issRetido ?? false,
    codigo_municipio: input.municipalityCode,
  }
  // Município no padrão nacional exige o código de 6 dígitos (com
  // desdobramento); o formato da LC 116 é recusado. Precedência explícita.
  const itemLista = service.codigoTributacaoNacional || service.lc116Code
  if (itemLista) servico.item_lista_servico = itemLista
  // CNAE só onde a prefeitura de fato consome: em município que valida, CNAE
  // não vinculado à inscrição municipal derruba a nota (rejeição A0001).
  // Município ainda não catalogado mantém o comportamento antigo (envia).
  const profile = findMunicipalityNfseProfile(input.municipalityCode)
  if (service.cnae && (profile?.sendsCnae ?? true)) {
    servico.codigo_cnae = service.cnae.replace(/\D/g, '')
  }

  const payload: Record<string, unknown> = {
    data_emissao: isoDate(options.emissionDate),
    natureza_operacao: options.naturezaOperacao ?? '1',
    // Obrigatório na raiz. MEI é SIMEI, sub-regime do Simples — conta como optante.
    optante_simples_nacional:
      service.taxRegime === 'simples_nacional' || service.taxRegime === 'mei',
    prestador,
    tomador,
    servico,
  }
  if (input.notes) payload.observacoes = input.notes

  return payload
}
