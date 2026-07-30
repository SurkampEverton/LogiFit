import forge from 'node-forge'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  CertificateError,
  type ParsedCertificate,
  daysUntilExpiry,
  isWithinValidity,
  parsePkcs12,
} from './pkcs12'

/**
 * Fixtures geradas em runtime, não commitadas.
 *
 * Certificado de verdade no repo seria chave privada real versionada — e um
 * `.pfx` de teste com chave fraca ainda assim ensina o padrão errado. Gerar
 * aqui também deixa o teste independente de validade: um fixture commitado
 * expira e quebra a suíte num dia arbitrário no futuro.
 *
 * 1024 bits porque é fixture: a geração de 2048 custaria segundos por rodada
 * sem provar nada a mais sobre o parser.
 */
const CNPJ = '12345678000199'
const PASSWORD = 'senha-do-pfx'

interface Fixture {
  pfx: Buffer
  notBefore: Date
  notAfter: Date
}

/**
 * DER da extensão `subjectAltName` com o `otherName` do e-CNPJ ICP-Brasil.
 *
 * Montado como DER cru, não via `altNames` do forge: ele **não sabe escrever
 * `otherName`** — serializa o objeto como `"[object Object]"`, e o certificado
 * sai com a extensão corrompida. Verificado antes de escrever este helper.
 */
function subjectAltNameWithCnpj(cnpj: string, oid = '2.16.76.1.3.3'): string {
  const { asn1 } = forge
  const otherName = asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0, true, [
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, asn1.oidToDer(oid).getBytes()),
    asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0, true, [
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OCTETSTRING, false, cnpj),
    ]),
  ])
  const san = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [otherName])
  return asn1.toDer(san).getBytes()
}

function makePfx(options: {
  commonName: string
  includeKey?: boolean
  sanCnpj?: string
  /** OID alternativo no otherName (e-CPF usa 2.16.76.1.3.1). */
  sanOid?: string
  extraCert?: boolean
}): Fixture {
  const keys = forge.pki.rsa.generateKeyPair(1024)
  const cert = forge.pki.createCertificate()
  cert.publicKey = keys.publicKey
  cert.serialNumber = '0A1B2C'

  const notBefore = new Date('2026-01-01T00:00:00Z')
  const notAfter = new Date('2027-01-01T00:00:00Z')
  cert.validity.notBefore = notBefore
  cert.validity.notAfter = notAfter

  const subject = [{ name: 'commonName', value: options.commonName }]
  const issuer = [{ name: 'commonName', value: 'AC Teste LogiFit' }]
  cert.setSubject(subject)
  cert.setIssuer(issuer)
  if (options.sanCnpj || options.sanOid) {
    const value = subjectAltNameWithCnpj(options.sanCnpj ?? '12345678000199', options.sanOid)
    cert.setExtensions([{ id: '2.5.29.17', critical: false, value }])
  }
  cert.sign(keys.privateKey, forge.md.sha256.create())

  // Intermediária: emitida pela mesma AC e **emissora do titular**, para
  // exercitar a escolha do leaf por `issuer`, não por ordem dos bags.
  const chain = [cert]
  if (options.extraCert) {
    const ca = forge.pki.createCertificate()
    ca.publicKey = keys.publicKey
    ca.serialNumber = 'CA01'
    ca.validity.notBefore = notBefore
    ca.validity.notAfter = notAfter
    ca.setSubject(issuer)
    ca.setIssuer([{ name: 'commonName', value: 'Raiz Teste LogiFit' }])
    ca.sign(keys.privateKey, forge.md.sha256.create())
    chain.unshift(ca) // de propósito antes do titular, para provar a ordem
  }

  const asn1 = forge.pkcs12.toPkcs12Asn1(
    options.includeKey === false ? null : keys.privateKey,
    chain,
    PASSWORD,
    { algorithm: '3des' },
  )
  return {
    pfx: Buffer.from(forge.asn1.toDer(asn1).getBytes(), 'binary'),
    notBefore,
    notAfter,
  }
}

describe('parsePkcs12', () => {
  let fixture: Fixture
  let parsed: ParsedCertificate

  beforeAll(() => {
    fixture = makePfx({ commonName: `ACADEMIA TESTE LTDA:${CNPJ}` })
    parsed = parsePkcs12(fixture.pfx, PASSWORD)
  })

  it('extrai certificado, titular e validade', () => {
    expect(parsed.certificatePem).toMatch(/^-----BEGIN CERTIFICATE-----/)
    expect(parsed.subjectCn).toBe(`ACADEMIA TESTE LTDA:${CNPJ}`)
    expect(parsed.issuer).toBe('AC Teste LogiFit')
    expect(parsed.serialNumber).toContain('a1b2c')
    expect(parsed.notBefore.toISOString()).toBe(fixture.notBefore.toISOString())
    expect(parsed.notAfter.toISOString()).toBe(fixture.notAfter.toISOString())
  })

  it('extrai a chave privada em PEM utilizável', () => {
    expect(parsed.privateKey.reveal()).toMatch(/^-----BEGIN RSA PRIVATE KEY-----/)
  })

  // e-CNPJ sem a extensão OID 2.16.76.1.3.3 ainda traz o CNPJ no CN, no padrão
  // `RAZAO SOCIAL:CNPJ`. Sem esse fallback, a validação contra companies.cnpj
  // reprovaria certificado legítimo.
  it('extrai CNPJ do CN quando não há extensão ICP-Brasil', () => {
    expect(parsed.cnpj).toBe(CNPJ)
  })

  it('devolve null quando o CN não carrega CNPJ — não chuta', () => {
    const semCnpj = parsePkcs12(makePfx({ commonName: 'FULANO DE TAL' }).pfx, PASSWORD)
    expect(semCnpj.cnpj).toBeNull()
  })

  // Caminho primário do DOC-ICP-04, e o que existe em certificado e-CNPJ real.
  // A primeira versão deste parser lia `altNames` do forge e nunca funcionaria:
  // ele não decodifica `otherName` e entrega "[object Object]".
  it('prefere o CNPJ da extensão ICP-Brasil sobre o CN', () => {
    const comSan = parsePkcs12(
      makePfx({ commonName: 'OUTRA RAZAO:99999999000199', sanCnpj: CNPJ }).pfx,
      PASSWORD,
    )
    expect(comSan.cnpj).toBe(CNPJ)
  })

  // Certificado de pessoa física (e-CPF) tem otherName com outro OID. Casar
  // por posição em vez de por OID devolveria o CPF como se fosse CNPJ.
  it('ignora otherName de OID diferente', () => {
    const outroOid = parsePkcs12(
      makePfx({ commonName: 'PESSOA FISICA', sanOid: '2.16.76.1.3.1' }).pfx,
      PASSWORD,
    )
    expect(outroOid.cnpj).toBeNull()
  })

  it('escolhe o titular pela cadeia, não pela ordem dos bags', () => {
    const comCadeia = parsePkcs12(
      makePfx({ commonName: `TITULAR:${CNPJ}`, extraCert: true }).pfx,
      PASSWORD,
    )
    expect(comCadeia.subjectCn).toBe(`TITULAR:${CNPJ}`)
    expect(comCadeia.chainPem).toHaveLength(1)
    expect(comCadeia.chainPem[0]).toMatch(/^-----BEGIN CERTIFICATE-----/)
  })

  describe('erros distinguem a ação do operador', () => {
    it('senha errada', () => {
      expect(() => parsePkcs12(fixture.pfx, 'senha-errada')).toThrowError(
        expect.objectContaining({ reason: 'wrong_password' }),
      )
    })

    it('arquivo que não é PKCS#12', () => {
      const lixo = Buffer.from('isto nao e um certificado', 'utf8')
      expect(() => parsePkcs12(lixo, PASSWORD)).toThrowError(
        expect.objectContaining({ reason: 'malformed' }),
      )
    })

    // Exportar só a parte pública é engano comum; a mensagem precisa dizer o
    // que refazer, não "erro ao ler certificado".
    it('exportado sem a chave privada', () => {
      const semChave = makePfx({ commonName: 'SEM CHAVE', includeKey: false })
      expect(() => parsePkcs12(semChave.pfx, PASSWORD)).toThrowError(
        expect.objectContaining({ reason: 'no_key' }),
      )
    })

    it('erros são CertificateError, não Error genérico', () => {
      expect(() => parsePkcs12(Buffer.from('x'), PASSWORD)).toThrowError(CertificateError)
    })
  })

  describe('validade', () => {
    it('reconhece dentro e fora da janela', () => {
      expect(isWithinValidity(parsed, new Date('2026-07-30T00:00:00Z'))).toBe(true)
      expect(isWithinValidity(parsed, new Date('2025-12-31T00:00:00Z'))).toBe(false)
      expect(isWithinValidity(parsed, new Date('2027-01-02T00:00:00Z'))).toBe(false)
    })

    it('conta os dias que alimentam o alerta de expiração', () => {
      expect(daysUntilExpiry(parsed, new Date('2026-12-02T00:00:00Z'))).toBe(30)
      expect(daysUntilExpiry(parsed, new Date('2027-01-11T00:00:00Z'))).toBe(-10)
    })
  })
})
