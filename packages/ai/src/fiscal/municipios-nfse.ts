/**
 * Perfis de integração NFS-e por município.
 *
 * NFS-e não tem padrão nacional efetivo: cada prefeitura escolhe o sistema, o
 * esquema de autenticação, a série de RPS e quais operações expõe por
 * webservice. O que vale pra um município não vale pro vizinho, e isso não é
 * dedutível do código nem do CNPJ — é fato externo que precisa estar escrito.
 *
 * Este catálogo existe porque a ausência dele custou caro: passamos uma manhã
 * emitindo contra o ambiente de homologação de um município que **não tem**
 * homologação, interpretando o erro genérico do provider como credencial
 * faltando (2026-07-20). Cada perfil aqui evita que alguém repita isso.
 *
 * Só entra município **verificado na documentação do provider** — perfil
 * chutado é pior que perfil ausente, porque `null` faz o código degradar pro
 * comportamento genérico enquanto um valor errado bloqueia emissão legítima.
 *
 * Ver ADR 0059 (ciclo fiscal Focus NFe).
 */

/** Como a prefeitura autentica a transmissão do RPS. */
export type MunicipalityAuthKind =
  /** Login e senha do portal — o certificado, se existir, só assina o documento */
  | 'login_senha'
  /** Certificado digital A1/A3 autentica a transmissão (padrão SEFAZ-like) */
  | 'certificado'
  /** Exige os dois: login pra sessão, certificado pra assinatura */
  | 'login_senha_e_certificado'

export interface MunicipalityNfseProfile {
  /** Código IBGE de 7 dígitos */
  ibgeCode: string
  name: string
  uf: string
  /** Sistema da prefeitura (AtendeNet, GINFES, Betha, IPM...) — define as quirks */
  system: string
  auth: MunicipalityAuthKind
  /**
   * A prefeitura oferece ambiente de teste? Muitas não oferecem — nesse caso
   * a única forma de validar a integração é emitir nota real em produção.
   */
  hasHomologacao: boolean
  /** Série de RPS esperada pela prefeitura; null = sem exigência conhecida */
  defaultRpsSerie: number | null
  /** Cancelamento por webservice funciona? Quando false, só pelo portal. */
  supportsWebserviceCancel: boolean
  /**
   * Exige credenciamento explícito pra emissão via webservice, além de ter
   * login no portal. Emitir manualmente no portal NÃO implica este passo.
   */
  requiresWebserviceCredenciamento: boolean
  /** Onde conferir/atualizar este perfil */
  sourceUrl: string
  notes?: string
}

/**
 * Indexado por código IBGE. Cresce conforme municípios são integrados —
 * município ausente cai no comportamento genérico (ver `findMunicipalityNfseProfile`).
 */
export const MUNICIPALITY_NFSE_PROFILES: Record<string, MunicipalityNfseProfile> = {
  '4104808': {
    ibgeCode: '4104808',
    name: 'Cascavel',
    uf: 'PR',
    system: 'AtendeNet',
    auth: 'login_senha',
    hasHomologacao: false,
    defaultRpsSerie: 13,
    supportsWebserviceCancel: false,
    requiresWebserviceCredenciamento: true,
    sourceUrl: 'https://focusnfe.com.br/guides/nfse/municipios-integrados/cascavel-pr/',
    notes:
      'Portal https://nfse-cascavel.atende.net/. O credenciamento de webservice é pedido no ' +
      'autoatendimento da prefeitura ("Emissão de NFS-e via webservices") e é separado de ter ' +
      'login no portal. Certificado digital não substitui login/senha aqui.',
  },
}

/** Perfil do município, ou null quando ainda não catalogado. */
export function findMunicipalityNfseProfile(
  municipalityCode: string | null | undefined,
): MunicipalityNfseProfile | null {
  if (!municipalityCode) return null
  return MUNICIPALITY_NFSE_PROFILES[municipalityCode.replace(/\D/g, '')] ?? null
}

/** Série de RPS a usar: override da empresa > exigência do município > 1. */
export function resolveRpsSerie(
  profile: MunicipalityNfseProfile | null,
  companyOverride?: number | null,
): number {
  if (companyOverride && companyOverride > 0) return companyOverride
  return profile?.defaultRpsSerie ?? 1
}

/**
 * O município aceita emissão neste ambiente?
 *
 * Município não catalogado retorna `true`: preferimos deixar o provider
 * responder a bloquear emissão por falta de dado nosso.
 */
export function supportsEnvironment(
  profile: MunicipalityNfseProfile | null,
  env: 'homologacao' | 'producao',
): boolean {
  if (env === 'producao') return true
  return profile?.hasHomologacao ?? true
}
