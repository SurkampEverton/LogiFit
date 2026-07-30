import { createHash } from 'node:crypto'
import forge from 'node-forge'
import { beforeAll, describe, expect, it } from 'vitest'
import { secretPem } from '../cert/secret-pem'
import { NFE_PROFILE, NFSE_NACIONAL_PROFILE, type SignatureProfile } from './profiles'
import { SignatureError, signXml } from './sign'

/**
 * Par de chaves **determinístico** entre rodadas: o golden-file compara o XML
 * assinado byte a byte, e uma chave nova a cada execução mudaria o
 * `SignatureValue` sem que nada de errado tivesse acontecido.
 *
 * A chave é gerada de um PRNG semeado do forge — não tem valor criptográfico e
 * não deve ser usada fora daqui.
 */
const SEED = 'logifit-fiscal-golden-file-41a'
const ID = 'NFe35260712345678000199550010000000011000000017'

let privateKeyPem: string
let certificatePem: string

function buildFixtureKeyPair() {
  const prng = forge.random.createInstance()
  prng.seedFileSync = (needed: number) => {
    // Fluxo determinístico derivado da SEED — repetível entre rodadas e SOs.
    let out = ''
    let counter = 0
    while (out.length < needed) {
      out += createHash('sha256').update(`${SEED}:${counter++}`).digest('binary')
    }
    return out.slice(0, needed)
  }
  const keys = forge.pki.rsa.generateKeyPair({ bits: 1024, prng })

  const cert = forge.pki.createCertificate()
  cert.publicKey = keys.publicKey
  cert.serialNumber = '01'
  cert.validity.notBefore = new Date('2026-01-01T00:00:00Z')
  cert.validity.notAfter = new Date('2027-01-01T00:00:00Z')
  cert.setSubject([{ name: 'commonName', value: 'ACADEMIA TESTE LTDA:12345678000199' }])
  cert.setIssuer([{ name: 'commonName', value: 'AC Teste LogiFit' }])
  cert.sign(keys.privateKey, forge.md.sha256.create())

  return {
    privateKeyPem: forge.pki.privateKeyToPem(keys.privateKey),
    certificatePem: forge.pki.certificateToPem(cert),
  }
}

/** XML mínimo com a forma que a SEFAZ espera: `Signature` irmã de `infNFe`. */
function nfeXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?><NFe xmlns="http://www.portalfiscal.inf.br/nfe"><infNFe versao="4.00" Id="${ID}"><ide><cUF>35</cUF><natOp>Venda de mercadoria</natOp></ide><emit><CNPJ>12345678000199</CNPJ></emit></infNFe></NFe>`
}

function sign(profile: SignatureProfile, xml = nfeXml()) {
  return signXml({
    xml,
    referenceId: ID,
    appendTo: "//*[local-name(.)='NFe']",
    profile,
    privateKey: secretPem(privateKeyPem),
    certificatePem,
    allowUnverifiedProfile: true,
  })
}

beforeAll(() => {
  const fixture = buildFixtureKeyPair()
  privateKeyPem = fixture.privateKeyPem
  certificatePem = fixture.certificatePem
})

describe('signXml', () => {
  it('insere a Signature como irmã do elemento assinado', () => {
    const signed = sign(NFE_PROFILE)
    expect(signed).toContain('<Signature')
    // Fora de infNFe: o conteúdo assinado não pode conter a própria assinatura.
    expect(signed.indexOf('<Signature')).toBeGreaterThan(signed.indexOf('</infNFe>'))
  })

  // Sem `uri`, xml-crypto emite URI="" — que assina o documento inteiro em vez
  // do elemento com Id. É outra assinatura, e o órgão rejeita.
  it('referencia o Id, não o documento inteiro', () => {
    expect(sign(NFE_PROFILE)).toContain(`URI="#${ID}"`)
  })

  it('usa os algoritmos do perfil, não defaults da lib', () => {
    const signed = sign(NFE_PROFILE)
    expect(signed).toContain(NFE_PROFILE.signatureAlgorithm)
    expect(signed).toContain(NFE_PROFILE.digestAlgorithm)
    expect(signed).toContain(NFE_PROFILE.canonicalizationAlgorithm)
  })

  it('embute o certificado no KeyInfo', () => {
    const signed = sign(NFE_PROFILE)
    expect(signed).toContain('<X509Certificate>')
    const bodyOnly = certificatePem
      .replace(/-----(BEGIN|END) CERTIFICATE-----/g, '')
      .replace(/\s/g, '')
    expect(signed.replace(/\s/g, '')).toContain(bodyOnly)
  })

  it('perfis diferentes produzem assinaturas diferentes', () => {
    expect(sign(NFE_PROFILE)).not.toBe(sign(NFSE_NACIONAL_PROFILE))
    expect(sign(NFSE_NACIONAL_PROFILE)).toContain(NFSE_NACIONAL_PROFILE.signatureAlgorithm)
  })

  describe('recusas', () => {
    // A defesa contra transmitir com algoritmo chutado. Sem ela, um perfil
    // escrito de memória chega ao órgão e volta como "assinatura inválida".
    it('bloqueia perfil não conferido contra o manual', () => {
      expect(() =>
        signXml({
          xml: nfeXml(),
          referenceId: ID,
          appendTo: "//*[local-name(.)='NFe']",
          profile: NFE_PROFILE,
          privateKey: secretPem(privateKeyPem),
          certificatePem,
          // sem allowUnverifiedProfile
        }),
      ).toThrowError(expect.objectContaining({ reason: 'unverified_profile' }))
    })

    it('aponta o Id quando o elemento não existe', () => {
      const semId = '<NFe xmlns="http://www.portalfiscal.inf.br/nfe"><infNFe/></NFe>'
      expect(() => sign(NFE_PROFILE, semId)).toThrowError(SignatureError)
    })
  })

  /**
   * Golden-file (T11 do ADR 0090).
   *
   * Trava o output byte a byte. Se `xml-crypto` ou `node-forge` mudarem
   * canonicalização, ordem de atributo ou espaçamento, isso vira diff no CI em
   * vez de rejeição do órgão meses depois — que é o modo de falha caro, porque
   * a mensagem do órgão não diz o que mudou.
   *
   * Quebrou depois de um `pnpm up`? Não atualize o snapshot no reflexo:
   * confira o diff contra o manual e só então regrave.
   */
  it('golden-file: NF-e assinada é byte-a-byte estável', () => {
    expect(sign(NFE_PROFILE)).toMatchSnapshot('nfe-55-65-signed')
  })
})
