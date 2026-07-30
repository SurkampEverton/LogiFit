import forge from 'node-forge'
import { describe, expect, it } from 'vitest'
import { CertificateRejectedError, validateCertificateUpload } from './validate'

const CNPJ = '12345678000199'
const OUTRO_CNPJ = '99887766000155'
const PASSWORD = 'senha-do-pfx'
const AGORA = new Date('2026-07-30T12:00:00Z')

function makePfx(options: {
  commonName?: string
  notBefore?: Date
  notAfter?: Date
  includeKey?: boolean
}): Buffer {
  const keys = forge.pki.rsa.generateKeyPair(1024)
  const cert = forge.pki.createCertificate()
  cert.publicKey = keys.publicKey
  cert.serialNumber = '01'
  cert.validity.notBefore = options.notBefore ?? new Date('2026-01-01T00:00:00Z')
  cert.validity.notAfter = options.notAfter ?? new Date('2027-01-01T00:00:00Z')
  cert.setSubject([
    { name: 'commonName', value: options.commonName ?? `ACADEMIA TESTE LTDA:${CNPJ}` },
  ])
  cert.setIssuer([{ name: 'commonName', value: 'AC Teste LogiFit' }])
  cert.sign(keys.privateKey, forge.md.sha256.create())

  const asn1 = forge.pkcs12.toPkcs12Asn1(
    options.includeKey === false ? null : keys.privateKey,
    [cert],
    PASSWORD,
    { algorithm: '3des' },
  )
  return Buffer.from(forge.asn1.toDer(asn1).getBytes(), 'binary')
}

function validate(
  pfx: Buffer,
  overrides: Partial<Parameters<typeof validateCertificateUpload>[0]> = {},
) {
  return validateCertificateUpload({
    pfx,
    password: PASSWORD,
    expectedCnpj: CNPJ,
    now: AGORA,
    ...overrides,
  })
}

describe('validateCertificateUpload', () => {
  it('aceita certificado válido da empresa e devolve os metadados', () => {
    const cert = validate(makePfx({}))
    expect(cert.cnpj).toBe(CNPJ)
    expect(cert.subjectCn).toContain('ACADEMIA TESTE LTDA')
    expect(cert.privateKey.reveal()).toContain('PRIVATE KEY')
  })

  it('aceita CNPJ formatado com pontuação na empresa', () => {
    expect(validate(makePfx({}), { expectedCnpj: '12.345.678/0001-99' }).cnpj).toBe(CNPJ)
  })

  describe('recusas com ação distinta para o operador', () => {
    // Cada `rejection` existe porque o que o operador precisa fazer é diferente:
    // redigitar a senha, escolher outro arquivo, ou renovar na AC.
    it('senha errada', () => {
      expect(() => validate(makePfx({}), { password: 'errada' })).toThrowError(
        expect.objectContaining({ rejection: 'wrong_password' }),
      )
    })

    it('arquivo que não é DER — nem tenta parsear ASN.1', () => {
      const pdf = Buffer.from('%PDF-1.7 conteúdo qualquer', 'utf8')
      expect(() => validate(pdf)).toThrowError(expect.objectContaining({ rejection: 'not_der' }))
    })

    it('arquivo grande demais', () => {
      const gigante = Buffer.alloc(70 * 1024, 0x30)
      expect(() => validate(gigante)).toThrowError(
        expect.objectContaining({ rejection: 'too_large' }),
      )
    })

    it('exportado sem a chave privada', () => {
      expect(() => validate(makePfx({ includeKey: false }))).toThrowError(
        expect.objectContaining({ rejection: 'no_key' }),
      )
    })

    // Sem esta checagem, subir o certificado da matriz na filial passa no
    // cadastro e só falha na SEFAZ — ou autoriza nota com o CNPJ errado.
    it('certificado de outra empresa', () => {
      try {
        validate(makePfx({}), { expectedCnpj: OUTRO_CNPJ })
        expect.unreachable('deveria ter recusado')
      } catch (e) {
        const err = e as CertificateRejectedError
        expect(err.rejection).toBe('cnpj_mismatch')
        // A mensagem mostra os dois CNPJs formatados: o operador precisa ver
        // qual subiu e qual era esperado para saber qual arquivo pegar.
        expect(err.message).toContain('12.345.678/0001-99')
        expect(err.message).toContain('99.887.766/0001-55')
      }
    })

    it('e-CPF em vez de e-CNPJ', () => {
      try {
        validate(makePfx({ commonName: 'FULANO DE TAL' }))
        expect.unreachable('deveria ter recusado')
      } catch (e) {
        const err = e as CertificateRejectedError
        expect(err.rejection).toBe('cnpj_absent')
        expect(err.message).toContain('e-CNPJ')
      }
    })

    // Subir certificado vencido nunca é intencional. Barrar no cadastro evita a
    // descoberta na primeira emissão, que é o pior momento possível.
    it('certificado já vencido', () => {
      const vencido = makePfx({
        notBefore: new Date('2024-01-01T00:00:00Z'),
        notAfter: new Date('2025-01-01T00:00:00Z'),
      })
      try {
        validate(vencido)
        expect.unreachable('deveria ter recusado')
      } catch (e) {
        const err = e as CertificateRejectedError
        expect(err.rejection).toBe('expired')
        expect(err.message).toContain('01/01/2025')
      }
    })

    it('certificado que ainda não entrou em vigor', () => {
      const futuro = makePfx({
        notBefore: new Date('2027-01-01T00:00:00Z'),
        notAfter: new Date('2028-01-01T00:00:00Z'),
      })
      expect(() => validate(futuro)).toThrowError(expect.objectContaining({ rejection: 'expired' }))
    })
  })

  it('erros são CertificateRejectedError — o caller trata um tipo só', () => {
    expect(() => validate(Buffer.from([0x30, 0x82, 0x00]))).toThrowError(CertificateRejectedError)
  })
})
