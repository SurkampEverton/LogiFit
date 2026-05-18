import { describe, expect, test } from 'vitest'
import { CANONICAL_CFOPS, resolveCfop } from './cfop-resolver'

describe('resolveCfop — Sprint 36 Faixa B.1', () => {
  describe('nfse — serviço municipal', () => {
    test('retorna sentinel 0000 (ISS via município)', () => {
      const r = resolveCfop({ kind: 'nfse', ufOrigin: 'SP', ufDestination: 'SP' })
      expect(r.cfop).toBe('0000')
      expect(r.isCanonical).toBe(true)
      expect(r.description).toContain('NFS-e')
    })

    test('NFS-e interestadual também retorna 0000', () => {
      const r = resolveCfop({ kind: 'nfse', ufOrigin: 'SP', ufDestination: 'RJ' })
      expect(r.cfop).toBe('0000')
    })
  })

  describe('nfe — venda de produto', () => {
    test('venda interna mercadoria de terceiros → 5102', () => {
      const r = resolveCfop({
        kind: 'nfe',
        ufOrigin: 'SP',
        ufDestination: 'SP',
        merchandiseKind: 'industrialized',
      })
      expect(r.cfop).toBe('5102')
      expect(r.isCanonical).toBe(true)
    })

    test('venda interestadual mercadoria de terceiros → 6102', () => {
      const r = resolveCfop({
        kind: 'nfe',
        ufOrigin: 'SP',
        ufDestination: 'RJ',
        merchandiseKind: 'industrialized',
      })
      expect(r.cfop).toBe('6102')
    })

    test('venda interna produção própria → 5101', () => {
      const r = resolveCfop({
        kind: 'nfe',
        ufOrigin: 'MG',
        ufDestination: 'MG',
        merchandiseKind: 'own_production',
      })
      expect(r.cfop).toBe('5101')
    })

    test('venda interestadual produção própria → 6101', () => {
      const r = resolveCfop({
        kind: 'nfe',
        ufOrigin: 'PR',
        ufDestination: 'SC',
        merchandiseKind: 'own_production',
      })
      expect(r.cfop).toBe('6101')
    })

    test('venda interna ativo imobilizado → 5551', () => {
      const r = resolveCfop({
        kind: 'nfe',
        ufOrigin: 'BA',
        ufDestination: 'BA',
        merchandiseKind: 'fixed_asset',
      })
      expect(r.cfop).toBe('5551')
    })

    test('venda interestadual ativo imobilizado → 6551', () => {
      const r = resolveCfop({
        kind: 'nfe',
        ufOrigin: 'CE',
        ufDestination: 'PB',
        merchandiseKind: 'fixed_asset',
      })
      expect(r.cfop).toBe('6551')
    })

    test('saída service_input ou consumer_use → 5949 (genérico) com isCanonical=false', () => {
      const r = resolveCfop({
        kind: 'nfe',
        ufOrigin: 'SP',
        ufDestination: 'SP',
        merchandiseKind: 'service_input',
      })
      expect(r.cfop).toBe('5949')
      expect(r.isCanonical).toBe(false)
    })

    test('default merchandiseKind quando omitido = industrialized', () => {
      const r = resolveCfop({ kind: 'nfe', ufOrigin: 'SP', ufDestination: 'SP' })
      expect(r.cfop).toBe('5102')
    })
  })

  describe('nfce — varejo balcão', () => {
    test('NFC-e sempre 5102 mesmo se ufDestination diferir (SEFAZ proíbe 6.xxx em NFC-e)', () => {
      const r1 = resolveCfop({ kind: 'nfce', ufOrigin: 'SP', ufDestination: 'SP' })
      expect(r1.cfop).toBe('5102')
      // Edge case: cliente NFC-e identificado de outro UF (raríssimo) — resolver
      // mantém 5102 porque NFC-e é tributada como interna sempre
      const r2 = resolveCfop({ kind: 'nfce', ufOrigin: 'SP', ufDestination: 'RJ' })
      expect(r2.cfop).toBe('5102')
    })
  })

  describe('nfe_return — devolução de compra', () => {
    test('devolução interna → 5202', () => {
      const r = resolveCfop({
        kind: 'nfe_return',
        ufOrigin: 'SP',
        ufDestination: 'SP',
      })
      expect(r.cfop).toBe('5202')
    })

    test('devolução interestadual → 6202', () => {
      const r = resolveCfop({
        kind: 'nfe_return',
        ufOrigin: 'SP',
        ufDestination: 'MG',
      })
      expect(r.cfop).toBe('6202')
    })
  })

  describe('nfe_transfer — transferência entre filiais', () => {
    test('transferência interna → 5152', () => {
      const r = resolveCfop({
        kind: 'nfe_transfer',
        ufOrigin: 'SP',
        ufDestination: 'SP',
      })
      expect(r.cfop).toBe('5152')
    })

    test('transferência interestadual → 6152', () => {
      const r = resolveCfop({
        kind: 'nfe_transfer',
        ufOrigin: 'SP',
        ufDestination: 'RJ',
      })
      expect(r.cfop).toBe('6152')
    })
  })

  describe('nfe_conserto_out — remessa pra conserto', () => {
    test('remessa interna → 5915', () => {
      const r = resolveCfop({
        kind: 'nfe_conserto_out',
        ufOrigin: 'SP',
        ufDestination: 'SP',
      })
      expect(r.cfop).toBe('5915')
    })

    test('remessa interestadual → 6915', () => {
      const r = resolveCfop({
        kind: 'nfe_conserto_out',
        ufOrigin: 'SP',
        ufDestination: 'RJ',
      })
      expect(r.cfop).toBe('6915')
    })
  })

  describe('nfe_conserto_return — retorno de conserto', () => {
    test('retorno interno → 1915 (entrada)', () => {
      const r = resolveCfop({
        kind: 'nfe_conserto_return',
        ufOrigin: 'SP',
        ufDestination: 'SP',
      })
      expect(r.cfop).toBe('1915')
    })

    test('retorno interestadual → 2915 (entrada interestadual)', () => {
      const r = resolveCfop({
        kind: 'nfe_conserto_return',
        ufOrigin: 'RJ',
        ufDestination: 'SP',
      })
      expect(r.cfop).toBe('2915')
    })
  })

  describe('nfe_self_entry — entrada própria (compra de PF)', () => {
    test('entrada própria interna → 1917', () => {
      const r = resolveCfop({
        kind: 'nfe_self_entry',
        ufOrigin: 'SP',
        ufDestination: 'SP',
      })
      expect(r.cfop).toBe('1917')
    })

    test('entrada própria interestadual → 2917', () => {
      const r = resolveCfop({
        kind: 'nfe_self_entry',
        ufOrigin: 'SP',
        ufDestination: 'MG',
      })
      expect(r.cfop).toBe('2917')
    })
  })

  describe('determinismo — mesmo input gera mesmo output', () => {
    test('roda 10x com mesmo input + retorna mesmo CFOP', () => {
      const inputs = {
        kind: 'nfe' as const,
        ufOrigin: 'SP' as const,
        ufDestination: 'RJ' as const,
        merchandiseKind: 'industrialized' as const,
      }
      const results = Array.from({ length: 10 }, () => resolveCfop(inputs))
      expect(results.every((r) => r.cfop === '6102')).toBe(true)
    })
  })

  describe('CANONICAL_CFOPS catálogo', () => {
    test('lista contém todos os 18 CFOPs documentados', () => {
      expect(CANONICAL_CFOPS).toHaveLength(18)
    })

    test('todos os CFOPs do catálogo são 4 dígitos numéricos', () => {
      for (const entry of CANONICAL_CFOPS) {
        expect(entry.cfop).toMatch(/^\d{4}$/)
        expect(entry.description.length).toBeGreaterThan(5)
      }
    })

    test('saídas começam com 5 ou 6; entradas com 1 ou 2', () => {
      for (const entry of CANONICAL_CFOPS) {
        const first = entry.cfop[0]
        expect(['1', '2', '5', '6']).toContain(first)
      }
    })
  })

  describe('coverage de pares interno/interestadual', () => {
    const pairs: Array<{
      kind: Parameters<typeof resolveCfop>[0]['kind']
      internal: string
      interestadual: string
    }> = [
      { kind: 'nfe', internal: '5102', interestadual: '6102' },
      { kind: 'nfe_return', internal: '5202', interestadual: '6202' },
      { kind: 'nfe_transfer', internal: '5152', interestadual: '6152' },
      { kind: 'nfe_conserto_out', internal: '5915', interestadual: '6915' },
      { kind: 'nfe_conserto_return', internal: '1915', interestadual: '2915' },
      { kind: 'nfe_self_entry', internal: '1917', interestadual: '2917' },
    ]

    for (const p of pairs) {
      test(`${p.kind}: internal=${p.internal} ; interestadual=${p.interestadual}`, () => {
        const intern = resolveCfop({
          kind: p.kind,
          ufOrigin: 'SP',
          ufDestination: 'SP',
        })
        const inter = resolveCfop({
          kind: p.kind,
          ufOrigin: 'SP',
          ufDestination: 'RJ',
        })
        expect(intern.cfop).toBe(p.internal)
        expect(inter.cfop).toBe(p.interestadual)
      })
    }
  })
})
