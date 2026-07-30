/**
 * `@repo/fiscal` — emissão fiscal própria (ADR 0108, regra 47).
 *
 * Sai de `@repo/ai`, onde fiscal nunca deveria ter morado (dívida do Sprint
 * 36a). Piso de cobertura 80%, não os 60% de `@repo/ai`: nota autorizada e
 * errada vira passivo fiscal do cliente e é irreversível pelo LogiFit.
 *
 * **Entregue (41a):** fundação de assinatura — leitura de A1, XMLDSig por perfil.
 * **Entregue (41b):** camada 2 — `resolveTaxRule()` com score de especificidade
 *   e desempate determinístico, mais o schema em `@repo/db`.
 * **Próximo (41c):** camada 3 — `calculateTax()` dirigido por flags de
 *   `tax_ref_icms_cst`, CRUD admin, defaults por ramo e modo sombra.
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
export {
  type ClientType,
  NoMatchingRuleError,
  type RejectionReason,
  type ResolvedTax,
  type ResolveRequest,
  type TaxRegime,
  type TaxRule,
} from './taxengine/models'
export { compareTiebreak, resolveTaxRule, scoreRule } from './taxengine/resolve'
