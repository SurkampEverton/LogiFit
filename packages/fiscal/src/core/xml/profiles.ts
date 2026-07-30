/**
 * Perfis de assinatura por documento fiscal — Sprint 41a (ADR 0108).
 *
 * XMLDSig deixa quase tudo em aberto: algoritmo de digest, de assinatura, de
 * canonicalização, transforms, formato do `KeyInfo`. Cada órgão fixa uma
 * combinação e **rejeita as outras** — e a mensagem de rejeição costuma ser
 * genérica ("assinatura inválida"), o que torna o erro caro de diagnosticar.
 *
 * Por isso o perfil é dado explícito e nomeado, nunca default embutido no
 * assinador: quando um órgão mudar de exigência, muda-se uma constante aqui,
 * e o golden-file do CI mostra exatamente o que mudou no XML.
 *
 * ⚠️ **Cada perfil precisa ser conferido contra o manual vigente do órgão antes
 * do primeiro envio em homologação.** O campo `verifiedAgainst` registra a
 * fonte e a data; perfil sem verificação declarada não deve chegar a produção.
 * A verificação é item de gate do Sprint 41a (NF-e/NFC-e) e 42 (NFS-e).
 */

export const C14N = {
  /** Canonical XML 1.0 — o que a SEFAZ especifica para NF-e/NFC-e. */
  inclusive: 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
  /** Exclusive C14N — comum em padrões mais novos. */
  exclusive: 'http://www.w3.org/2001/10/xml-exc-c14n#',
} as const

export const DIGEST = {
  sha1: 'http://www.w3.org/2000/09/xmldsig#sha1',
  sha256: 'http://www.w3.org/2001/04/xmlenc#sha256',
} as const

export const SIGNATURE = {
  rsaSha1: 'http://www.w3.org/2000/09/xmldsig#rsa-sha1',
  rsaSha256: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
} as const

export const TRANSFORM = {
  enveloped: 'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
} as const

export interface SignatureProfile {
  /** Nome do perfil, usado em log e no nome do golden-file. */
  readonly name: string
  readonly canonicalizationAlgorithm: string
  readonly signatureAlgorithm: string
  readonly digestAlgorithm: string
  readonly transforms: readonly string[]
  /**
   * Manual e data da última conferência. `null` = **não conferido**; o
   * assinador recusa usar um perfil assim fora de teste.
   */
  readonly verifiedAgainst: string | null
}

/**
 * NF-e modelo 55 e NFC-e modelo 65.
 *
 * SHA-1 não é escolha nossa nem descuido: o Manual de Orientação do
 * Contribuinte fixa RSA-SHA1 + digest SHA-1 + C14N inclusive, e assinar com
 * SHA-256 é rejeitado. Documentado aqui para ninguém "corrigir" isso depois.
 */
export const NFE_PROFILE: SignatureProfile = {
  name: 'nfe-55-65',
  canonicalizationAlgorithm: C14N.inclusive,
  signatureAlgorithm: SIGNATURE.rsaSha1,
  digestAlgorithm: DIGEST.sha1,
  transforms: [TRANSFORM.enveloped, C14N.inclusive],
  verifiedAgainst: null, // gate do Sprint 41a: conferir contra o MOC 4.00 vigente
}

/**
 * NFS-e padrão nacional (DPS).
 *
 * Deixado **sem verificação** de propósito: o perfil só é exercitado no Sprint
 * 42, e fixá-lo agora a partir de memória seria inventar um fato que só se
 * descobre errado na primeira rejeição. Conferir no Manual de Contribuintes do
 * Emissor Nacional antes de usar.
 */
export const NFSE_NACIONAL_PROFILE: SignatureProfile = {
  name: 'nfse-nacional-dps',
  canonicalizationAlgorithm: C14N.exclusive,
  signatureAlgorithm: SIGNATURE.rsaSha256,
  digestAlgorithm: DIGEST.sha256,
  transforms: [TRANSFORM.enveloped, C14N.exclusive],
  verifiedAgainst: null, // gate do Sprint 42
}
