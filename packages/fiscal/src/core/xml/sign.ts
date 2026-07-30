/**
 * Assinatura XMLDSig enveloped — Sprint 41a (ADR 0108).
 *
 * É aqui que a maioria das integrações fiscais quebra, e o motivo é sempre o
 * mesmo: o órgão rejeita com "assinatura inválida" sem dizer *qual* das cinco
 * escolhas (digest, assinatura, canonicalização, transform, KeyInfo) está
 * errada. Três defesas contra isso:
 *
 *   1. **Perfil explícito** por documento ([`profiles.ts`](./profiles.ts)) — a
 *      combinação é dado nomeado, não default escondido.
 *   2. **Golden-file no CI** — `xml-crypto`/`node-forge` mudarem o output vira
 *      diff visível, não rejeição em produção seis meses depois.
 *   3. **Recusa de perfil não conferido** fora de teste — perfil com
 *      `verifiedAgainst: null` não vai a lugar nenhum sem alguém abrir o manual.
 *
 * O elemento assinado é referenciado por `Id`, como os manuais exigem: a
 * `Reference URI` vira `#<Id>` e a `Signature` é anexada como irmã do elemento
 * assinado (NF-e) ou dentro do documento raiz, conforme `appendTo`.
 */

import { SignedXml } from 'xml-crypto'
import type { SecretPem } from '../cert/secret-pem'
import type { SignatureProfile } from './profiles'

export class SignatureError extends Error {
  constructor(
    message: string,
    readonly reason: 'unverified_profile' | 'element_not_found' | 'sign_failed',
  ) {
    super(message)
    this.name = 'SignatureError'
  }
}

export interface SignXmlOptions {
  /** XML a assinar, já montado e válido contra o XSD. */
  xml: string
  /**
   * Valor do atributo `Id` do elemento a assinar (ex.: `NFe3526...` ou
   * `DPS3526...`). Vira `Reference URI="#<id>"`.
   */
  referenceId: string
  /**
   * XPath do elemento que **contém** a assinatura resultante. Na NF-e a
   * `Signature` é irmã de `infNFe`, dentro de `NFe`.
   */
  appendTo: string
  profile: SignatureProfile
  privateKey: SecretPem
  /** Certificado do titular em PEM — vai no `X509Data` do `KeyInfo`. */
  certificatePem: string
  /**
   * Só `true` em teste, para exercitar perfil ainda não conferido contra o
   * manual do órgão. Em qualquer outro caminho, perfil não verificado lança.
   */
  allowUnverifiedProfile?: boolean
}

/**
 * Assina e devolve o XML completo, com a `Signature` inserida.
 *
 * @throws {SignatureError} perfil não conferido, elemento ausente, ou falha na
 * assinatura — com `reason` distinto porque a ação é diferente em cada caso.
 */
export function signXml(options: SignXmlOptions): string {
  const { profile, referenceId, appendTo, xml } = options

  if (!profile.verifiedAgainst && !options.allowUnverifiedProfile) {
    throw new SignatureError(
      `Perfil de assinatura "${profile.name}" ainda não foi conferido contra o manual do órgão. Confirme os algoritmos no manual vigente e preencha \`verifiedAgainst\` antes de transmitir.`,
      'unverified_profile',
    )
  }

  const signer = new SignedXml({
    privateKey: options.privateKey.reveal(),
    publicCert: options.certificatePem,
    signatureAlgorithm: profile.signatureAlgorithm,
    canonicalizationAlgorithm: profile.canonicalizationAlgorithm,
  })

  signer.addReference({
    xpath: `//*[@Id='${referenceId}']`,
    transforms: [...profile.transforms],
    digestAlgorithm: profile.digestAlgorithm,
    // O órgão espera a URI apontando pro Id; sem isso xml-crypto emite URI=""
    // (documento inteiro), que é outra assinatura e é rejeitada.
    uri: `#${referenceId}`,
  })

  try {
    signer.computeSignature(xml, {
      location: { reference: appendTo, action: 'append' },
    })
  } catch (cause) {
    // xml-crypto não distingue "xpath não casou" de erro de cripto; a causa
    // quase sempre é o Id ausente ou o appendTo errado, e é o que a mensagem diz.
    throw new SignatureError(
      `Falha ao assinar: verifique se existe elemento com Id="${referenceId}" e se o caminho "${appendTo}" resolve no XML. Causa: ${String(cause)}`,
      'sign_failed',
    )
  }

  return signer.getSignedXml()
}
