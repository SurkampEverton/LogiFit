/**
 * Validação de certificado A1 no cadastro — Sprint 41a.2 (ADR 0108).
 *
 * Roda **antes** de cifrar e gravar. Cada recusa aqui é um problema que, se
 * passasse, só apareceria na primeira tentativa de emissão — quando o operador
 * já espera que funcione, e com mensagem do órgão que não ajuda.
 *
 * **Por que não `scanUpload()` (regra 38):** aquele gate é para arquivo que vai
 * ao MinIO, e é orientado a bucket/MIME. O `.pfx` nunca chega ao MinIO — vai
 * cifrado direto na coluna `company_certificates.encrypted_pfx`. E a validação
 * aqui é mais forte que farejar magic bytes: `parsePkcs12` **prova
 * criptograficamente** que o arquivo é um PKCS#12 que abre com aquela senha.
 * O pré-filtro de tamanho e assinatura DER existe só para não gastar ASN.1 em
 * lixo, não como garantia.
 */

import { CertificateError, type ParsedCertificate, isWithinValidity, parsePkcs12 } from './pkcs12'

/**
 * Teto de tamanho. Um A1 real tem poucos KB; 64 KB é folgado o bastante para
 * cadeia longa e apertado o bastante para não virar vetor de negação de serviço
 * via ASN.1 gigante.
 */
const MAX_PFX_BYTES = 64 * 1024

/** DER começa com SEQUENCE de comprimento longo — `30 82` em todo PKCS#12 real. */
const DER_SEQUENCE_PREFIX = [0x30, 0x82]

export type CertificateRejection =
  | 'too_large'
  | 'not_der'
  | 'wrong_password'
  | 'malformed'
  | 'no_key'
  | 'no_cert'
  | 'cnpj_mismatch'
  | 'cnpj_absent'
  | 'expired'

export class CertificateRejectedError extends Error {
  constructor(
    message: string,
    readonly rejection: CertificateRejection,
  ) {
    super(message)
    this.name = 'CertificateRejectedError'
  }
}

export interface ValidateCertificateInput {
  pfx: Buffer
  password: string
  /** CNPJ da company que vai emitir, só dígitos. */
  expectedCnpj: string
  /** Data de referência — injetada pelo caller; testes fixam. */
  now: Date
}

/**
 * Valida e devolve o certificado pronto para ser cifrado e gravado.
 *
 * @throws {CertificateRejectedError} com `rejection` distinta por causa, porque
 * a ação do operador muda em cada uma: senha errada ele redigita; CNPJ diferente
 * significa que subiu o certificado da empresa errada; vencido significa que
 * precisa renovar na AC.
 */
export function validateCertificateUpload(input: ValidateCertificateInput): ParsedCertificate {
  assertPlausiblePkcs12(input.pfx)

  const cert = parseOrReject(input.pfx, input.password)

  // Vencido no cadastro é sempre engano — nunca há motivo legítimo para subir
  // um certificado que não pode assinar nada. Barrar aqui evita a descoberta na
  // primeira emissão, que é quando o operador menos quer descobrir.
  if (!isWithinValidity(cert, input.now)) {
    throw new CertificateRejectedError(
      `Certificado fora da validade (${formatDate(cert.notBefore)} a ${formatDate(cert.notAfter)}). Emita um novo na sua Autoridade Certificadora e faça o upload dele.`,
      'expired',
    )
  }

  assertBelongsToCompany(cert, input.expectedCnpj)

  return cert
}

// ─── internos ────────────────────────────────────────────────────────────

function assertPlausiblePkcs12(pfx: Buffer): void {
  if (pfx.byteLength > MAX_PFX_BYTES) {
    throw new CertificateRejectedError(
      `Arquivo grande demais para um certificado A1 (${Math.round(pfx.byteLength / 1024)} KB). Confira se selecionou o arquivo .pfx e não outro documento.`,
      'too_large',
    )
  }
  if (!DER_SEQUENCE_PREFIX.every((byte, i) => pfx[i] === byte)) {
    throw new CertificateRejectedError(
      'O arquivo não parece um certificado digital A1. Selecione o arquivo .pfx ou .p12 fornecido pela sua Autoridade Certificadora.',
      'not_der',
    )
  }
}

function parseOrReject(pfx: Buffer, password: string): ParsedCertificate {
  try {
    return parsePkcs12(pfx, password)
  } catch (e) {
    if (e instanceof CertificateError) {
      // A causa já vem classificada do leitor; só reetiqueta para o vocabulário
      // do cadastro, preservando a mensagem, que é acionável.
      throw new CertificateRejectedError(e.message, e.reason)
    }
    throw e
  }
}

/**
 * O certificado tem que ser **da empresa que vai emitir**.
 *
 * Sem esta checagem, subir o certificado da matriz na filial passa no cadastro
 * e falha só na SEFAZ — ou pior, autoriza nota com o CNPJ errado.
 */
function assertBelongsToCompany(cert: ParsedCertificate, expectedCnpj: string): void {
  const expected = expectedCnpj.replace(/\D/g, '')

  if (!cert.cnpj) {
    throw new CertificateRejectedError(
      `Não foi possível ler o CNPJ do certificado (titular: ${cert.subjectCn || 'desconhecido'}). Certificados e-CPF não servem para emissão fiscal da empresa — use um e-CNPJ (A1).`,
      'cnpj_absent',
    )
  }

  if (cert.cnpj !== expected) {
    throw new CertificateRejectedError(
      `O certificado é do CNPJ ${formatCnpj(cert.cnpj)}, mas esta empresa é ${formatCnpj(expected)}. Selecione o certificado correspondente a esta empresa.`,
      'cnpj_mismatch',
    )
  }
}

function formatCnpj(digits: string): string {
  return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10).split('-').reverse().join('/')
}
