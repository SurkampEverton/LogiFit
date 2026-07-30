/**
 * Leitura de certificado A1 (PKCS#12 / `.pfx`) — Sprint 41a (ADR 0108).
 *
 * O `.pfx` já vive cifrado em `company_certificates` desde o Sprint 17
 * (`encrypted_pfx` AES-256-GCM + `encrypted_password` com chave separada, KEK
 * por company). Este módulo **não** guarda nada: recebe os bytes já decifrados,
 * extrai o que a assinatura e o mTLS precisam, e devolve.
 *
 * A chave privada sai embrulhada em `SecretPem` — ver o porquê em
 * [`secret-pem.ts`](./secret-pem.ts).
 *
 * **node-forge, não `node:crypto`:** o Node lê PKCS#12 direto no `https.Agent`
 * (`{ pfx, passphrase }`), o que resolve o transporte — mas não expõe a chave
 * em PEM nem os atributos do certificado, e a assinatura XMLDSig precisa dos
 * dois. forge é puro JS, o que importa porque o VPS é ARM Ampere e binário
 * nativo em runtime é risco de build (ADR 0091).
 */

import forge from 'node-forge'
import { type SecretPem, secretPem } from './secret-pem'

/** OID do CNPJ do titular em e-CNPJ ICP-Brasil (DOC-ICP-04). */
const OID_CNPJ_ICP_BRASIL = '2.16.76.1.3.3'

/** OID da extensão `subjectAltName` (RFC 5280). */
const OID_SAN = '2.5.29.17'

export class CertificateError extends Error {
  constructor(
    message: string,
    readonly reason: 'wrong_password' | 'malformed' | 'no_key' | 'no_cert',
  ) {
    super(message)
    this.name = 'CertificateError'
  }
}

export interface ParsedCertificate {
  /** Chave privada em PEM. Nunca serializa em claro. */
  privateKey: SecretPem
  /** Certificado do titular em PEM. Público — pode logar. */
  certificatePem: string
  /** Cadeia intermediária, do mais próximo do titular ao mais próximo da raiz. */
  chainPem: string[]
  subjectCn: string
  /** CNPJ só dígitos, ou `null` quando o certificado não é e-CNPJ. */
  cnpj: string | null
  issuer: string
  serialNumber: string
  notBefore: Date
  notAfter: Date
}

/**
 * Extrai chave, certificado e atributos de um `.pfx`.
 *
 * @throws {CertificateError} senha errada, arquivo corrompido, ou PKCS#12 sem
 * chave/certificado — cada caso com `reason` distinto, porque a ação do
 * operador é diferente em cada um (senha errada ele corrige; arquivo sem chave
 * significa que exportaram só a parte pública e ele precisa exportar de novo).
 */
export function parsePkcs12(pfx: Buffer, password: string): ParsedCertificate {
  const asn1 = decodeAsn1(pfx)
  const p12 = openPkcs12(asn1, password)

  const privateKeyPem = extractPrivateKeyPem(p12)
  const certs = extractCertificates(p12)
  const leaf = pickLeafCertificate(certs)

  return {
    privateKey: secretPem(privateKeyPem),
    certificatePem: forge.pki.certificateToPem(leaf),
    chainPem: certs.filter((c) => c !== leaf).map((c) => forge.pki.certificateToPem(c)),
    subjectCn: attributeValue(leaf.subject, 'commonName') ?? '',
    cnpj: extractCnpj(leaf),
    issuer: attributeValue(leaf.issuer, 'commonName') ?? '',
    serialNumber: leaf.serialNumber,
    notBefore: leaf.validity.notBefore,
    notAfter: leaf.validity.notAfter,
  }
}

/** `true` quando `agora` está dentro da validade. Sem tolerância — o órgão não dá. */
export function isWithinValidity(cert: ParsedCertificate, now: Date): boolean {
  return now >= cert.notBefore && now <= cert.notAfter
}

/** Dias até expirar; negativo se já expirou. Alimenta o alerta de 30/15/7 dias. */
export function daysUntilExpiry(cert: ParsedCertificate, now: Date): number {
  const MS_PER_DAY = 24 * 60 * 60 * 1000
  return Math.floor((cert.notAfter.getTime() - now.getTime()) / MS_PER_DAY)
}

// ─── internos ────────────────────────────────────────────────────────────

function decodeAsn1(pfx: Buffer): forge.asn1.Asn1 {
  try {
    return forge.asn1.fromDer(forge.util.createBuffer(pfx.toString('binary')))
  } catch {
    throw new CertificateError(
      'Arquivo não é um PKCS#12 válido. Exporte o certificado A1 novamente, no formato .pfx ou .p12.',
      'malformed',
    )
  }
}

/**
 * forge não distingue senha errada de arquivo corrompido — nos dois casos o MAC
 * não fecha. Como o ASN.1 já decodificou no passo anterior, senha errada é de
 * longe a hipótese mais provável, e é a que a mensagem sugere primeiro.
 */
function openPkcs12(asn1: forge.asn1.Asn1, password: string): forge.pkcs12.Pkcs12Pfx {
  try {
    return forge.pkcs12.pkcs12FromAsn1(asn1, password)
  } catch {
    throw new CertificateError(
      'Não foi possível abrir o certificado — a senha parece incorreta.',
      'wrong_password',
    )
  }
}

function extractPrivateKeyPem(p12: forge.pkcs12.Pkcs12Pfx): string {
  // A chave pode vir cifrada (pkcs8ShroudedKeyBag, o caso comum) ou em claro.
  // Os OIDs vêm de um índice `{[k: string]: string}` no forge, daí o cast.
  const bagTypes = [forge.pki.oids.pkcs8ShroudedKeyBag as string, forge.pki.oids.keyBag as string]
  for (const bagType of bagTypes) {
    const bags: forge.pkcs12.Bag[] = p12.getBags({ bagType })[bagType] ?? []
    const key = bags[0]?.key
    if (key) return forge.pki.privateKeyToPem(key)
  }
  throw new CertificateError(
    'O arquivo não contém chave privada — provavelmente foi exportado só com a parte pública. Exporte novamente marcando a opção de incluir a chave privada.',
    'no_key',
  )
}

function extractCertificates(p12: forge.pkcs12.Pkcs12Pfx): forge.pki.Certificate[] {
  const bagType = forge.pki.oids.certBag as string
  const bags: forge.pkcs12.Bag[] = p12.getBags({ bagType })[bagType] ?? []
  const certs = bags.map((b) => b.cert).filter((c): c is forge.pki.Certificate => Boolean(c))
  if (certs.length === 0) {
    throw new CertificateError('O arquivo não contém certificado.', 'no_cert')
  }
  return certs
}

/**
 * O titular é o certificado que **não** assinou nenhum outro do conjunto — os
 * demais são intermediários da cadeia ICP-Brasil. Comparar por `issuer` evita
 * depender da ordem dos bags, que varia conforme quem exportou.
 */
function pickLeafCertificate(certs: forge.pki.Certificate[]): forge.pki.Certificate {
  if (certs.length === 1) return certs[0] as forge.pki.Certificate
  const issuers = new Set(certs.map((c) => c.issuer.hash))
  return certs.find((c) => !issuers.has(c.subject.hash)) ?? (certs[0] as forge.pki.Certificate)
}

/**
 * Valor de um atributo do DN.
 *
 * Percorre `attributes` em vez de usar `getField` do forge: a API dele trata
 * string como `shortName` (`CN`), não como `name` (`commonName`), e depender
 * dessa distinção rendeu duas falhas silenciosas — `subjectCn` vazio e CNPJ
 * `null` em certificado que tinha os dois.
 */
function attributeValue(name: forge.pki.Certificate['subject'], field: string): string | null {
  const attr = name.attributes.find(
    (a) => a.name === field || a.shortName === field || a.type === field,
  )
  return typeof attr?.value === 'string' ? attr.value : null
}

/**
 * CNPJ do titular.
 *
 * O lugar correto é a extensão `subjectAltName`, num `otherName` de OID
 * `2.16.76.1.3.3`, cujo valor são 14 dígitos. Nem todo emissor preenche —
 * quando falta, o fallback é o CN, que em e-CNPJ segue o padrão
 * `RAZAO SOCIAL:CNPJ`.
 *
 * Devolve `null` em vez de chutar: o chamador compara com `companies.cnpj` e
 * um valor errado aqui reprovaria um certificado legítimo.
 */
function extractCnpj(cert: forge.pki.Certificate): string | null {
  const fromExtension = cnpjFromSubjectAltName(cert)
  if (fromExtension) return fromExtension

  const cn = attributeValue(cert.subject, 'commonName')
  const tail = cn?.split(':').pop()?.replace(/\D/g, '')
  return tail?.length === 14 ? tail : null
}

/**
 * Lê o CNPJ do `otherName` de OID 2.16.76.1.3.3 dentro do `subjectAltName`.
 *
 * **forge não decodifica `otherName`** — em `altNames[i].value` ele entrega um
 * objeto que vira a string `"[object Object]"`. Verificado na prática antes de
 * escrever isto; a primeira versão deste módulo tentava usar `altNames` e nunca
 * teria funcionado com certificado real. O caminho correto é parsear o DER cru
 * da extensão e caminhar a ASN.1.
 *
 * Estrutura: `SAN ::= SEQUENCE OF GeneralName`, e o `otherName` é
 * `[0] { OID, [0] EXPLICIT valor }` — então o nó imediatamente após o OID
 * carrega os 14 dígitos.
 */
function cnpjFromSubjectAltName(cert: forge.pki.Certificate): string | null {
  const ext = cert.extensions?.find((e) => e.name === 'subjectAltName' || e.id === OID_SAN)
  if (!ext?.value) return null

  let leaves: forge.asn1.Asn1[]
  try {
    leaves = flattenAsn1(forge.asn1.fromDer(forge.util.createBuffer(ext.value)))
  } catch {
    // Extensão ilegível não é motivo para reprovar o certificado — o CN ainda
    // pode trazer o CNPJ, e o chamador trata `null`.
    return null
  }

  for (let i = 0; i < leaves.length - 1; i++) {
    const node = leaves[i] as forge.asn1.Asn1
    if (node.tagClass !== forge.asn1.Class.UNIVERSAL || node.type !== forge.asn1.Type.OID) continue
    if (forge.asn1.derToOid(node.value as string) !== OID_CNPJ_ICP_BRASIL) continue

    const digits = String((leaves[i + 1] as forge.asn1.Asn1).value ?? '').replace(/\D/g, '')
    const match = digits.match(/\d{14}/)
    if (match) return match[0]
  }
  return null
}

/** Nós-folha da árvore ASN.1, em ordem de leitura. */
function flattenAsn1(node: forge.asn1.Asn1, out: forge.asn1.Asn1[] = []): forge.asn1.Asn1[] {
  if (Array.isArray(node.value)) {
    for (const child of node.value) flattenAsn1(child, out)
    return out
  }
  out.push(node)
  return out
}
