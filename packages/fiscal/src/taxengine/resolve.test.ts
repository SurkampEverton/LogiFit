import { describe, expect, it } from 'vitest'
import { NoMatchingRuleError, type ResolveRequest, type TaxRule } from './models'
import { compareTiebreak, resolveTaxRule, scoreRule } from './resolve'

const PROFILE = 'profile-suplemento'
const AT = new Date('2026-07-30T12:00:00Z')

function rule(overrides: Partial<TaxRule> & { id: string }): TaxRule {
  return {
    fiscalProfileId: PROFILE,
    operationNature: 'REVENDA',
    priority: 0,
    active: true,
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    issRetido: false,
    irrfRetido: false,
    inssRetido: false,
    csllRetido: false,
    pisRetido: false,
    cofinsRetido: false,
    ...overrides,
  }
}

function request(overrides: Partial<ResolveRequest> = {}): ResolveRequest {
  return {
    fiscalProfileId: PROFILE,
    operationNature: 'REVENDA',
    ufOrigem: 'PR',
    ufDestino: 'PR',
    regime: 'simples_nacional',
    at: AT,
    ...overrides,
  }
}

describe('resolveTaxRule — casamento', () => {
  it('escolhe a única regra compatível', () => {
    const r = rule({ id: 'a', csosn: '102' })
    expect(resolveTaxRule([r], request()).rule.id).toBe('a')
  })

  it('curinga: lista de UF vazia cobre qualquer UF', () => {
    const r = rule({ id: 'a', ufOrigem: [], ufDestino: null })
    expect(resolveTaxRule([r], request({ ufDestino: 'SC' })).rule.id).toBe('a')
  })

  it('respeita vigência nos dois limites, inclusive', () => {
    const vigente = rule({
      id: 'vigente',
      validFrom: new Date('2026-01-01T00:00:00Z'),
      validUntil: new Date('2026-12-31T23:59:59Z'),
    })
    expect(resolveTaxRule([vigente], request()).rule.id).toBe('vigente')

    const expirada = rule({ id: 'x', validUntil: new Date('2026-06-30T00:00:00Z') })
    expect(() => resolveTaxRule([expirada], request())).toThrowError(NoMatchingRuleError)
  })

  // Operador digita `2710.12.59`; o cadastro do fornecedor traz `27101259`.
  // Comparar sem normalizar descartaria regra legítima.
  it('normaliza NCM e CEST — pontuação não importa', () => {
    const r = rule({ id: 'a', ncm: '2710.12.59' })
    expect(resolveTaxRule([r], request({ ncm: '27101259' })).rule.id).toBe('a')
  })
})

describe('score de especificidade', () => {
  it('NCM vence UF — identifica o produto, não o recorte geográfico', () => {
    const porNcm = rule({ id: 'ncm', ncm: '22029900' })
    const porUf = rule({ id: 'uf', ufOrigem: ['PR'] })
    const resolved = resolveTaxRule([porUf, porNcm], request({ ncm: '22029900' }))
    expect(resolved.rule.id).toBe('ncm')
    expect(resolved.competitors).toBe(1)
  })

  it('UF única é mais específica que par de UFs', () => {
    const uma = rule({ id: 'uma', ufDestino: ['SC'] })
    const duas = rule({ id: 'duas', ufDestino: ['SC', 'RS'] })
    expect(resolveTaxRule([duas, uma], request({ ufDestino: 'SC' })).rule.id).toBe('uma')
  })

  it('acumula critérios casados', () => {
    const req = request({ ncm: '22029900', unitId: 'unit-1' })
    const simples = rule({ id: 's' })
    const rica = rule({ id: 'r', ncm: '22029900', unitId: 'unit-1', regime: 'simples_nacional' })
    expect(scoreRule(rica, req)).toBeGreaterThan(scoreRule(simples, req))
  })
})

/**
 * ARMADILHA 5 — a mais cara da implementação de referência.
 *
 * Sem desempate total, duas regras igualmente específicas deixavam a escolha na
 * ordem física em que o Postgres devolveu as linhas. O mesmo produto tributava
 * diferente entre duas vendas, sem nada ter mudado no cadastro — e ninguém
 * percebia até a conciliação do contador.
 */
describe('armadilha 5 — desempate determinístico', () => {
  const base = { ncm: '22029900', ufOrigem: ['PR'] }

  it('priority vence primeiro', () => {
    const baixa = rule({ id: 'a', ...base, priority: 1 })
    const alta = rule({ id: 'b', ...base, priority: 9 })
    expect(resolveTaxRule([baixa, alta], request({ ncm: '22029900' })).rule.id).toBe('b')
  })

  it('updatedAt desempata quando priority empata', () => {
    const velha = rule({ id: 'a', ...base, updatedAt: new Date('2026-01-01T00:00:00Z') })
    const nova = rule({ id: 'b', ...base, updatedAt: new Date('2026-07-01T00:00:00Z') })
    expect(resolveTaxRule([velha, nova], request({ ncm: '22029900' })).rule.id).toBe('b')
  })

  it('id desempata quando priority e updatedAt empatam — nunca resta empate', () => {
    const a = rule({ id: 'aaa', ...base })
    const b = rule({ id: 'zzz', ...base })
    expect(compareTiebreak(a, b)).not.toBe(0)
    expect(resolveTaxRule([a, b], request({ ncm: '22029900' })).rule.id).toBe('zzz')
  })

  it('100 execuções com a ordem de entrada embaralhada dão o mesmo resultado', () => {
    const regras = ['r1', 'r2', 'r3', 'r4'].map((id) => rule({ id, ...base }))
    const req = request({ ncm: '22029900' })
    const esperado = resolveTaxRule(regras, req).rule.id

    for (let i = 0; i < 100; i++) {
      // Rotação determinística — não usa Math.random, para o teste não flakar.
      const girada = [...regras.slice(i % regras.length), ...regras.slice(0, i % regras.length)]
      expect(resolveTaxRule(girada, req).rule.id).toBe(esperado)
    }
  })
})

/**
 * ARMADILHA 1 — `client_type` some no fluxo de venda.
 *
 * O resolver de item da emissão de NF-e/NFC-e não preenche `clientType`, então
 * qualquer regra com esse campo é descartada ali. A referência trata isso como
 * folclore ("use NULL em regra de venda"); aqui o erro **diz** o que aconteceu.
 */
describe('armadilha 1 — client_type descarta a regra em venda', () => {
  it('regra com client_type não é escolhida quando o request não informa', () => {
    const comTipo = rule({ id: 'com', clientType: 'PJ' })
    expect(() => resolveTaxRule([comTipo], request())).toThrowError(NoMatchingRuleError)
  })

  it('regra com client_type NULL é escolhida no mesmo contexto', () => {
    const semTipo = rule({ id: 'sem' })
    expect(resolveTaxRule([semTipo], request()).rule.id).toBe('sem')
  })

  it('a mensagem instrui a deixar o campo vazio, em vez de só dizer que não achou', () => {
    const comTipo = rule({ id: 'com', clientType: 'PJ' })
    try {
      resolveTaxRule([comTipo], request())
      expect.unreachable('deveria ter lançado')
    } catch (e) {
      const err = e as NoMatchingRuleError
      expect(err.rejections.get('client_type')).toBe(1)
      expect(err.message).toContain('deixe vazio em regra de venda')
    }
  })

  it('client_type ainda funciona quando o fluxo informa (NFS-e)', () => {
    const comTipo = rule({ id: 'com', clientType: 'PJ' })
    expect(resolveTaxRule([comTipo], request({ clientType: 'PJ' })).rule.id).toBe('com')
  })
})

/**
 * ARMADILHA 6 — falhar alto, com contexto.
 *
 * Antes de existir, emissão sem regra gerava nota sem CST/CFOP, rejeitada pelo
 * órgão com mensagem inútil. Regra 47: aborta **antes** de qualquer chamada
 * externa, dizendo o que falta e onde configurar.
 */
describe('armadilha 6 — erro acionável', () => {
  it('sem nenhuma candidata, manda cadastrar a regra', () => {
    try {
      resolveTaxRule([], request())
      expect.unreachable('deveria ter lançado')
    } catch (e) {
      const err = e as NoMatchingRuleError
      expect(err.candidatesConsidered).toBe(0)
      expect(err.message).toContain('Nenhuma regra fiscal cadastrada')
      expect(err.message).toContain('Configurações → Fiscal → Regras')
    }
  })

  it('carrega o contexto que o operador precisa para achar a regra', () => {
    try {
      resolveTaxRule([rule({ id: 'a', ufDestino: ['SP'] })], request({ ufDestino: 'SC' }))
      expect.unreachable('deveria ter lançado')
    } catch (e) {
      const err = e as NoMatchingRuleError
      expect(err.message).toContain('natureza=REVENDA')
      expect(err.message).toContain('PR→SC')
      expect(err.message).toContain('regime=simples_nacional')
    }
  })

  // O agregado é o que revela o padrão: "12 caíram por natureza" aponta o campo
  // errado de imediato; "nenhuma regra casou" obriga a conferir uma a uma.
  it('agrega os descartes por motivo, do mais frequente ao menos', () => {
    const candidatas = [
      rule({ id: 'n1', operationNature: 'VENDA' }),
      rule({ id: 'n2', operationNature: 'VENDA' }),
      rule({ id: 'n3', operationNature: 'VENDA' }),
      rule({ id: 'u1', ufDestino: ['SP'] }),
      rule({ id: 'i1', active: false }),
    ]
    try {
      resolveTaxRule(candidatas, request({ ufDestino: 'SC' }))
      expect.unreachable('deveria ter lançado')
    } catch (e) {
      const err = e as NoMatchingRuleError
      expect(err.candidatesConsidered).toBe(5)
      expect(err.rejections.get('operation_nature')).toBe(3)
      expect(err.rejections.get('uf_destino')).toBe(1)
      expect(err.rejections.get('inactive')).toBe(1)
      // Ordenado por frequência: o motivo dominante aparece primeiro.
      expect(err.message.indexOf('3 por')).toBeLessThan(err.message.indexOf('1 por'))
    }
  })
})

describe('demais motivos de descarte', () => {
  // Cada caso prova que o campo restringe de verdade. Regra que "quase casa" e
  // é aceita por engano é pior que nenhuma regra: emite com alíquota errada.
  const casos: Array<{ motivo: string; regra: Partial<TaxRule>; req?: Partial<ResolveRequest> }> = [
    { motivo: 'regime', regra: { regime: 'lucro_real' } },
    { motivo: 'unit', regra: { unitId: 'unit-outra' }, req: { unitId: 'unit-1' } },
    { motivo: 'cest', regra: { cest: '2810600' }, req: { cest: '9999999' } },
    {
      motivo: 'municipio',
      regra: { municipioIncidencia: '4104808' },
      req: { municipioIbge: '3550308' },
    },
    { motivo: 'uf_origem', regra: { ufOrigem: ['SP'] } },
  ]

  for (const { motivo, regra, req } of casos) {
    it(`descarta por ${motivo}`, () => {
      try {
        resolveTaxRule([rule({ id: 'x', ...regra })], request(req))
        expect.unreachable('deveria ter lançado')
      } catch (e) {
        expect((e as NoMatchingRuleError).rejections.get(motivo as never)).toBe(1)
      }
    })
  }

  it('vigência que ainda não começou também descarta', () => {
    const futura = rule({ id: 'f', validFrom: new Date('2027-01-01T00:00:00Z') })
    try {
      resolveTaxRule([futura], request())
      expect.unreachable('deveria ter lançado')
    } catch (e) {
      expect((e as NoMatchingRuleError).rejections.get('validity')).toBe(1)
    }
  })

  // Lista longa de UF não é especificidade: cobrir 5 estados é quase curinga, e
  // pontuar como se fosse recorte fino faria uma regra ampla vencer uma precisa.
  it('3+ UFs não pontuam como especificidade', () => {
    const req = request({ ufDestino: 'SC' })
    const muitas = rule({ id: 'muitas', ufDestino: ['SC', 'RS', 'PR', 'SP'] })
    const uma = rule({ id: 'uma', ufDestino: ['SC'] })
    expect(scoreRule(muitas, req)).toBe(0)
    expect(resolveTaxRule([muitas, uma], req).rule.id).toBe('uma')
  })
})

describe('CFOP interno vs interestadual', () => {
  it('mesma UF usa o CFOP interno', () => {
    const r = rule({ id: 'a', cfop: '5102', cfopExterno: '6102' })
    expect(resolveTaxRule([r], request()).cfop).toBe('5102')
  })

  it('UF diferente usa o CFOP externo', () => {
    const r = rule({ id: 'a', cfop: '5102', cfopExterno: '6102' })
    expect(resolveTaxRule([r], request({ ufDestino: 'SC' })).cfop).toBe('6102')
  })

  // Melhor cair no interno e ser rejeitado pelo órgão do que emitir sem CFOP:
  // nota sem CFOP não chega a ser analisada, e a mensagem não ajuda ninguém.
  it('sem CFOP externo cadastrado, cai no interno', () => {
    const r = rule({ id: 'a', cfop: '5102' })
    expect(resolveTaxRule([r], request({ ufDestino: 'SC' })).cfop).toBe('5102')
  })
})
