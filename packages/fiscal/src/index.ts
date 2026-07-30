/**
 * `@repo/fiscal` — emissão fiscal própria (ADR 0108, regra 47).
 *
 * Sai de `@repo/ai`, onde fiscal nunca deveria ter morado (dívida do Sprint
 * 36a). Piso de cobertura 80%, não os 60% de `@repo/ai`: nota autorizada e
 * errada vira passivo fiscal do cliente e é irreversível pelo LogiFit.
 *
 * **Entregue (41a):** fundação de assinatura — leitura de A1, XMLDSig por perfil.
 * **Próximo (41b/c):** motor tributário de 4 camadas — `tax_ref_*`,
 * `fiscal_profiles`, `tax_rules`, `Resolve()`, `CalculateTax()`.
 */

export {
  CertificateError,
  type ParsedCertificate,
  daysUntilExpiry,
  isWithinValidity,
  parsePkcs12,
} from './core/cert/pkcs12'
export { type SecretPem, isSecretPem, secretPem } from './core/cert/secret-pem'
export {
  C14N,
  DIGEST,
  NFE_PROFILE,
  NFSE_NACIONAL_PROFILE,
  SIGNATURE,
  type SignatureProfile,
  TRANSFORM,
} from './core/xml/profiles'
export { SignatureError, type SignXmlOptions, signXml } from './core/xml/sign'
