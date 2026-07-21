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
   * Prazo de cancelamento em horas, quando conhecido. `null` = NÃO SABEMOS.
   *
   * NFS-e não tem prazo nacional: cada município escolhe (24h, mesmo mês,
   * 5 dias, análise fiscal caso a caso). O código antes carimbava 24h fixas em
   * toda emissão e usava esse número tanto pra exibir "janela até X" quanto pra
   * BLOQUEAR o cancelamento — inventando um prazo e impedindo o operador de
   * cancelar algo que a prefeitura ainda aceitaria.
   *
   * `null` é a resposta honesta: não exibe prazo e não bloqueia, deixando a
   * regra com quem a define.
   */
  cancelWindowHours: number | null
  /**
   * Exige credenciamento explícito pra emissão via webservice, além de ter
   * login no portal. Emitir manualmente no portal NÃO implica este passo.
   */
  requiresWebserviceCredenciamento: boolean
  /**
   * A prefeitura consome `codigo_cnae` no RPS?
   *
   * Enviar CNAE não vinculado à inscrição municipal dispara rejeição A0001
   * ("item da lista de serviço, código CNAE ou código da tributação informado
   * não está cadastrado para o prestador") em municípios que o validam. Onde
   * o campo é ignorado, mandar é ruído com risco e zero ganho.
   */
  sendsCnae: boolean
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
    // Regra de Cascavel não confirmada em fonte primária — perfil chutado é
    // pior que perfil ausente (ver docstring do módulo).
    cancelWindowHours: null,
    requiresWebserviceCredenciamento: true,
    // Guia da Focus pra Cascavel marca "Código CNAE — Não utilizado".
    sendsCnae: false,
    sourceUrl: 'https://focusnfe.com.br/guides/nfse/municipios-integrados/cascavel-pr/',
    notes:
      'Portal https://nfse-cascavel.atende.net/. O credenciamento de webservice é pedido no ' +
      'autoatendimento da prefeitura ("Emissão de NFS-e via webservices") e é separado de ter ' +
      'login no portal. Certificado digital não substitui login/senha aqui. ' +
      // Verificado 2026-07-21, com base legal — ver CHANGELOG da data.
      'Migrou ao Ambiente de Dados Nacional em 01/01/2026: por isso exige a lista LC 116 com ' +
      'desdobramento nacional (6 dígitos) e recusa o formato "X.YY". Um item por nota. ' +
      'Alíquotas de ISS por subitem vivem no art. 158 da LC Municipal 1/2001 (redação da LC ' +
      'Municipal 95/2017), coluna "Variável (%)" — 17.24 (palestras) = 3%. Esse é o percentual ' +
      'de REGIME NORMAL: para optante do Simples a nota sai com "SIMPLES NACIONAL" no lugar do ' +
      'número, e o art. 199-A da LC 1/2001 restringe retenção na fonte de ME/EPP do Simples às ' +
      'exceções do art. 3º da LC 116/2003. Emissor oficial é a IPM em pr.nfs-e.net — confirmar o ' +
      'mapeamento antes de tratar o módulo do atende.net como endpoint. NBS pode passar a ser ' +
      'exigido pelo ADN; hoje o cadastro da empresa no portal traz o campo vazio. ' +
      // Conferido campo a campo contra a doc da Focus em 2026-07-21.
      'A doc da Focus para o município confirma: CNAE e código tributário municipal não são ' +
      'utilizados, NBS é opcional, série de RPS 13, sem homologação e cancelamento por ' +
      'webservice não funcional.',
  },
}

/**
 * O "arquivo" devolvido pelo provider é na verdade um link para o portal da
 * prefeitura?
 *
 * Municípios como Cascavel não entregam PDF: devolvem a URL de consulta de
 * autenticidade, que exige a sessão do próprio contribuinte. Não há o que
 * proxyar — a UI precisa oferecer o link, não um botão de download.
 *
 * O código antes tratava URL absoluta como sinal de emissão mock. Uma nota
 * real e autorizada em Cascavel caía nesse ramo e a tela informava ao
 * operador que sua nota era de teste.
 */
export function isExternalPortalLink(path: string | null | undefined): boolean {
  return typeof path === 'string' && /^https?:\/\//i.test(path)
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
