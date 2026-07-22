import { describe, expect, it } from 'vitest'
import {
  MUNICIPALITY_NFSE_PROFILES,
  findMunicipalityNfseProfile,
  resolveRpsSerie,
  supportsEnvironment,
} from './municipios-nfse'

const CASCAVEL = '4104808'

describe('findMunicipalityNfseProfile', () => {
  it('encontra Cascavel/PR por código IBGE', () => {
    const p = findMunicipalityNfseProfile(CASCAVEL)
    expect(p?.name).toBe('Cascavel')
    expect(p?.uf).toBe('PR')
    expect(p?.system).toBe('AtendeNet')
  })

  it('tolera código formatado e retorna null pra não catalogado/vazio', () => {
    expect(findMunicipalityNfseProfile('4104-808')?.name).toBe('Cascavel')
    expect(findMunicipalityNfseProfile('3550308')).toBeNull()
    expect(findMunicipalityNfseProfile(null)).toBeNull()
    expect(findMunicipalityNfseProfile('')).toBeNull()
  })
})

describe('resolveRpsSerie', () => {
  it('usa a série exigida pelo município (Cascavel = 13, não 1)', () => {
    expect(resolveRpsSerie(findMunicipalityNfseProfile(CASCAVEL))).toBe(13)
  })

  it('override da empresa vence a do município', () => {
    expect(resolveRpsSerie(findMunicipalityNfseProfile(CASCAVEL), 7)).toBe(7)
  })

  it('cai em 1 sem perfil e sem override', () => {
    expect(resolveRpsSerie(null)).toBe(1)
  })

  it('override zero/negativo/null é ignorado, não vira série inválida', () => {
    const p = findMunicipalityNfseProfile(CASCAVEL)
    expect(resolveRpsSerie(p, 0)).toBe(13)
    expect(resolveRpsSerie(p, -1)).toBe(13)
    expect(resolveRpsSerie(p, null)).toBe(13)
  })
})

describe('supportsEnvironment', () => {
  it('Cascavel não tem homologação — o erro que custou a manhã de 2026-07-20', () => {
    const p = findMunicipalityNfseProfile(CASCAVEL)
    expect(supportsEnvironment(p, 'homologacao')).toBe(false)
    expect(supportsEnvironment(p, 'producao')).toBe(true)
  })

  it('município não catalogado não bloqueia — deixa o provider responder', () => {
    expect(supportsEnvironment(null, 'homologacao')).toBe(true)
    expect(supportsEnvironment(null, 'producao')).toBe(true)
  })
})

describe('integridade do catálogo', () => {
  it('a chave do registro bate com o ibgeCode declarado', () => {
    for (const [key, profile] of Object.entries(MUNICIPALITY_NFSE_PROFILES)) {
      expect(key).toBe(profile.ibgeCode)
      expect(key).toMatch(/^\d{7}$/)
    }
  })

  it('todo perfil aponta a fonte — perfil sem procedência não é verificável', () => {
    for (const profile of Object.values(MUNICIPALITY_NFSE_PROFILES)) {
      expect(profile.sourceUrl).toMatch(/^https:\/\//)
    }
  })
})

describe('cancelWindowHours', () => {
  it('Cascavel declara prazo desconhecido, nao um numero inventado', () => {
    // Perfil chutado e pior que perfil ausente: null nao exibe prazo e nao
    // bloqueia o cancelamento, deixando a regra com quem a define.
    expect(MUNICIPALITY_NFSE_PROFILES[CASCAVEL]?.cancelWindowHours).toBeNull()
  })

  it('todo perfil declara a janela explicitamente — inclusive quando e null', () => {
    for (const [code, profile] of Object.entries(MUNICIPALITY_NFSE_PROFILES)) {
      expect(profile, `perfil ${code} sem cancelWindowHours declarado`).toHaveProperty(
        'cancelWindowHours',
      )
    }
  })
})
