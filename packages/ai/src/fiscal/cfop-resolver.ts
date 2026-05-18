/**
 * Resolver de CFOP — Sprint 36 Faixa B.1 (ADR 0059).
 *
 * CFOP (Código Fiscal de Operações e Prestações) é o código 4 dígitos que
 * classifica a operação na NF-e. Primeira dígito identifica destino:
 *   1xxx — entrada dentro do UF
 *   2xxx — entrada de outro UF
 *   3xxx — entrada do exterior
 *   5xxx — saída dentro do UF
 *   6xxx — saída pra outro UF
 *   7xxx — saída pro exterior
 *
 * **Foco MVP:** 8 operações canônicas (vinculadas aos 8 tipos de emissão).
 * Tabela completa CFOP tem 200+ códigos; LogiFit cobre os essenciais e
 * **delega ao Focus NFe** o cálculo final via campo `natureza_operacao` —
 * resolver apenas sugere o CFOP base, Focus pode corrigir.
 *
 * **Resolver puro (sem I/O):** input determinístico → output determinístico.
 * Permite teste isolado + composição com payload builders Sprint 36b.
 *
 * Referências:
 *   - Convênio SINIEF s/n/1970 (Anexo II) — tabela oficial CFOP
 *   - Ajuste SINIEF 11/2017 — CFOPs de entrada própria (1.917, 2.917)
 *   - Manual NFC-e SEFAZ — CFOPs varejo balcão (5.102 vs 5.405)
 */

import type { FiscalEmissionKind } from './provider'

/**
 * UFs brasileiros (27 unidades federativas).
 */
export type UF =
  | 'AC' | 'AL' | 'AP' | 'AM' | 'BA' | 'CE' | 'DF' | 'ES' | 'GO' | 'MA'
  | 'MT' | 'MS' | 'MG' | 'PA' | 'PB' | 'PR' | 'PE' | 'PI' | 'RJ' | 'RN'
  | 'RS' | 'RO' | 'RR' | 'SC' | 'SP' | 'SE' | 'TO'

export interface CfopResolveInput {
  /** Tipo de emissão (espelha enum schema) */
  kind: FiscalEmissionKind
  /** UF da empresa emitente */
  ufOrigin: UF
  /** UF do destinatário (NFC-e + venda balcão: pode ser igual à origin) */
  ufDestination: UF
  /**
   * Tipo de mercadoria:
   *   - 'industrialized' — produto comprado pra revenda (CFOP 5.102/6.102)
   *   - 'own_production' — fabricação própria (CFOP 5.101/6.101) — fora do MVP
   *   - 'consumer_use' — material de uso/consumo (5.910/6.910 — devolução; 1.556/2.556 — entrada)
   *   - 'fixed_asset' — bem do ativo imobilizado (5.551/6.551)
   *   - 'service_input' — insumo pra prestação de serviço (5.949/6.949 — genérico saída)
   */
  merchandiseKind?:
    | 'industrialized'
    | 'own_production'
    | 'consumer_use'
    | 'fixed_asset'
    | 'service_input'
}

export interface CfopResolveResult {
  /** CFOP 4 dígitos (sem ponto) */
  cfop: string
  /** Descrição humana pra log + UI */
  description: string
  /** Quando true, resolver tem confiança alta; quando false, sugere revisão manual */
  isCanonical: boolean
}

/**
 * Resolver canônico de CFOP. Trata 8 tipos de emissão × interno/interestadual.
 *
 * **Não cobre:**
 *   - NFC-e a consumidor final (sempre 5.102 — mesmo UF; SEFAZ não aceita 6.xxx em NFC-e)
 *   - Operações com ZFM (Zona Franca de Manaus) — codes 5.151/6.151 — Sprint 36b
 *   - Substituição tributária (CFOPs 5.401-5.405) — Focus calcula automaticamente
 *   - Exportação (7.xxx) — fora do MVP (academia/clínica não exporta)
 *
 * Quando `kind` exige campo `merchandiseKind` (ex: NF-e produto) e não veio,
 * usa default 'industrialized' (mais comum em academia/clínica revendendo suplemento).
 */
export function resolveCfop(input: CfopResolveInput): CfopResolveResult {
  const { kind, ufOrigin, ufDestination } = input
  const isInternal = ufOrigin === ufDestination
  const merchKind = input.merchandiseKind ?? 'industrialized'

  switch (kind) {
    case 'nfse':
      // NFS-e não usa CFOP (é tributada por ISS municipal). Retorna sentinela.
      return {
        cfop: '0000',
        description: 'NFS-e (serviço municipal — sem CFOP; ISS via município)',
        isCanonical: true,
      }

    case 'nfe':
      // Venda de mercadoria
      if (merchKind === 'industrialized') {
        return isInternal
          ? {
              cfop: '5102',
              description: 'Venda de mercadoria adquirida ou recebida de terceiros',
              isCanonical: true,
            }
          : {
              cfop: '6102',
              description:
                'Venda de mercadoria adquirida ou recebida de terceiros — interestadual',
              isCanonical: true,
            }
      }
      if (merchKind === 'own_production') {
        return isInternal
          ? {
              cfop: '5101',
              description: 'Venda de produção do estabelecimento',
              isCanonical: true,
            }
          : {
              cfop: '6101',
              description:
                'Venda de produção do estabelecimento — interestadual',
              isCanonical: true,
            }
      }
      if (merchKind === 'fixed_asset') {
        return isInternal
          ? {
              cfop: '5551',
              description: 'Venda de bem do ativo imobilizado',
              isCanonical: true,
            }
          : {
              cfop: '6551',
              description:
                'Venda de bem do ativo imobilizado — interestadual',
              isCanonical: true,
            }
      }
      // service_input + consumer_use saindo — usa 5.949/6.949 genérico
      return isInternal
        ? {
            cfop: '5949',
            description: 'Outra saída de mercadoria não especificada',
            isCanonical: false,
          }
        : {
            cfop: '6949',
            description: 'Outra saída — interestadual',
            isCanonical: false,
          }

    case 'nfce':
      // NFC-e sempre interno (consumidor final balcão); SEFAZ não aceita 6.xxx
      return {
        cfop: '5102',
        description:
          'NFC-e venda a consumidor final — mercadoria adquirida de terceiros',
        isCanonical: true,
      }

    case 'nfe_return':
      // Devolução de venda — invertida (saída do que entrou)
      // Empresa que devolve emite NF-e de saída (5.202/6.202) referenciando NF original
      return isInternal
        ? {
            cfop: '5202',
            description:
              'Devolução de compra para comercialização (operação interna)',
            isCanonical: true,
          }
        : {
            cfop: '6202',
            description:
              'Devolução de compra para comercialização — interestadual',
            isCanonical: true,
          }

    case 'nfe_transfer':
      // Transferência entre filiais do mesmo titular (mesmo CNPJ raiz)
      // CFOP 5.151/6.151 = produção própria; 5.152/6.152 = mercadoria de terceiros
      // MVP: assume mercadoria de terceiros (CFOP 5.152/6.152)
      return isInternal
        ? {
            cfop: '5152',
            description:
              'Transferência de mercadoria adquirida ou recebida de terceiros',
            isCanonical: true,
          }
        : {
            cfop: '6152',
            description:
              'Transferência interestadual de mercadoria adquirida de terceiros',
            isCanonical: true,
          }

    case 'nfe_conserto_out':
      // Remessa pra conserto (saída — vai voltar)
      return isInternal
        ? {
            cfop: '5915',
            description:
              'Remessa de mercadoria ou bem para conserto ou reparo',
            isCanonical: true,
          }
        : {
            cfop: '6915',
            description: 'Remessa para conserto — interestadual',
            isCanonical: true,
          }

    case 'nfe_conserto_return':
      // Retorno de conserto (entrada — bem volta consertado)
      return isInternal
        ? {
            cfop: '1915',
            description:
              'Entrada de mercadoria ou bem recebido para conserto ou reparo',
            isCanonical: true,
          }
        : {
            cfop: '2915',
            description: 'Retorno de conserto — interestadual',
            isCanonical: true,
          }

    case 'nfe_self_entry':
      // Entrada própria — empresa emite NF-e referente a compra de PF sem inscrição
      // CFOP 1.917 = entrada interna; 2.917 = entrada interestadual
      return isInternal
        ? {
            cfop: '1917',
            description:
              'Entrada de mercadoria ou bem recebido em consignação industrial',
            isCanonical: true,
          }
        : {
            cfop: '2917',
            description:
              'Entrada de mercadoria recebida em consignação — interestadual',
            isCanonical: true,
          }

    default: {
      // Exhaustive check (TS força quando enum expande)
      const _exhaustive: never = kind
      return {
        cfop: '5949',
        description: `Operação não mapeada (${String(_exhaustive)})`,
        isCanonical: false,
      }
    }
  }
}

/**
 * Helper pra UI: lista todos os CFOPs canônicos que o resolver pode retornar.
 * Útil pra dropdown manual override no wizard Sprint 36b.
 */
export const CANONICAL_CFOPS: ReadonlyArray<{ cfop: string; description: string }> = [
  { cfop: '5101', description: 'Venda de produção do estabelecimento' },
  { cfop: '5102', description: 'Venda de mercadoria adquirida de terceiros' },
  { cfop: '5152', description: 'Transferência de mercadoria de terceiros' },
  { cfop: '5202', description: 'Devolução de compra para comercialização' },
  { cfop: '5551', description: 'Venda de bem do ativo imobilizado' },
  { cfop: '5915', description: 'Remessa para conserto' },
  { cfop: '5949', description: 'Outra saída não especificada' },
  { cfop: '6101', description: 'Venda de produção — interestadual' },
  { cfop: '6102', description: 'Venda de mercadoria de terceiros — interestadual' },
  { cfop: '6152', description: 'Transferência de mercadoria — interestadual' },
  { cfop: '6202', description: 'Devolução de compra — interestadual' },
  { cfop: '6551', description: 'Venda de ativo imobilizado — interestadual' },
  { cfop: '6915', description: 'Remessa para conserto — interestadual' },
  { cfop: '6949', description: 'Outra saída — interestadual' },
  { cfop: '1915', description: 'Entrada de bem para conserto' },
  { cfop: '1917', description: 'Entrada em consignação industrial' },
  { cfop: '2915', description: 'Retorno de conserto — interestadual' },
  { cfop: '2917', description: 'Entrada em consignação — interestadual' },
]
