/**
 * tiss-generator.ts tests — Sprint 22 Faixa B.1.
 */
import { describe, expect, it } from 'vitest'
import {
  generateBatchXml,
  generateGuideXml,
  type GuideInput,
} from './tiss-generator'

const SAMPLE_GUIDE: GuideInput = {
  tissVersion: '4.01',
  kind: 'sp_sadt',
  guideNumber: 'GUI-2026-001',
  operator: { ansCode: '123456', name: 'Unimed Brasil' },
  prestador: { cnpj: '12.345.678/0001-90', name: 'Clínica Saúde', codePlan: 'CLI-001' },
  memberInsurance: {
    cardNumber: '1234567890',
    memberName: 'Maria Silva',
    validUntil: '2027-12-31',
    category: 'enfermaria',
  },
  items: [
    {
      sequenceNumber: 1,
      tussCode: '20104073',
      description: 'Sessão de fisioterapia individual',
      quantity: 1,
      unitPriceCents: 5500,
      totalCents: 5500,
      executionDate: '2026-05-17',
      professional: {
        name: 'João Fisioterapeuta',
        councilBody: 'CREFITO',
        councilState: 'SP',
        councilNumber: '12345',
        cbosCode: '226305',
      },
    },
  ],
  totalCents: 5500,
  issueDate: '2026-05-17',
  authorizationNumber: 'AUTH-XYZ-789',
}

describe('generateGuideXml', () => {
  it('gera XML válido pra SP/SADT', () => {
    const xml = generateGuideXml(SAMPLE_GUIDE)
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>')
    expect(xml).toContain('versaoTISS="4.01"')
    expect(xml).toContain('<ans:guiaSPSADT>')
    expect(xml).toContain('GUI-2026-001')
    expect(xml).toContain('1234567890') // carteirinha
    expect(xml).toContain('CREFITO')
    expect(xml).toContain('226305') // CBOS
    expect(xml).toContain('AUTH-XYZ-789')
    expect(xml).toContain('20104073') // TUSS
    expect(xml).toContain('55.00') // valor R$ formatado
  })

  it('gera XML pra consulta (tag guiaConsulta)', () => {
    const xml = generateGuideXml({ ...SAMPLE_GUIDE, kind: 'consulta' })
    expect(xml).toContain('<ans:guiaConsulta>')
    expect(xml).not.toContain('<ans:guiaSPSADT>')
  })

  it('escape XML em valores com caracteres especiais', () => {
    const xml = generateGuideXml({
      ...SAMPLE_GUIDE,
      memberInsurance: {
        ...SAMPLE_GUIDE.memberInsurance,
        memberName: 'João & Maria <test>',
      },
    })
    // escapeXml mantém UTF-8 nativo (ã), converte apenas & < > " '
    expect(xml).toContain('João &amp; Maria &lt;test&gt;')
  })

  it('múltiplos itens — todos no XML', () => {
    const xml = generateGuideXml({
      ...SAMPLE_GUIDE,
      items: [
        SAMPLE_GUIDE.items[0]!,
        {
          ...SAMPLE_GUIDE.items[0]!,
          sequenceNumber: 2,
          tussCode: '10101012',
          description: 'Consulta médica em consultório',
          totalCents: 12000,
          unitPriceCents: 12000,
        },
      ],
      totalCents: 17500,
    })
    expect(xml).toContain('20104073')
    expect(xml).toContain('10101012')
    expect(xml).toContain('175.00')
  })

  it('campo opcional operatorGuideNumber omitido quando null', () => {
    const xml = generateGuideXml({ ...SAMPLE_GUIDE, operatorGuideNumber: null })
    expect(xml).not.toContain('numeroGuiaOperadora')
  })

  it('campo opcional operatorGuideNumber presente quando fornecido', () => {
    const xml = generateGuideXml({
      ...SAMPLE_GUIDE,
      operatorGuideNumber: 'OP-2026-XYZ',
    })
    expect(xml).toContain('OP-2026-XYZ')
  })

  it('valores em centavos formatados com 2 decimais', () => {
    const xml = generateGuideXml({
      ...SAMPLE_GUIDE,
      items: [
        {
          ...SAMPLE_GUIDE.items[0]!,
          unitPriceCents: 12345,
          totalCents: 12345,
        },
      ],
      totalCents: 12345,
    })
    expect(xml).toContain('123.45')
  })
})

describe('generateBatchXml', () => {
  it('agrega múltiplas guias no lote', () => {
    const g1Xml = generateGuideXml({ ...SAMPLE_GUIDE, guideNumber: 'GUI-001' })
    const g2Xml = generateGuideXml({ ...SAMPLE_GUIDE, guideNumber: 'GUI-002' })
    const batchXml = generateBatchXml({
      tissVersion: '4.01',
      batchNumber: 'LOTE-2026-001',
      guides: [
        { kind: 'sp_sadt', xml: g1Xml },
        { kind: 'sp_sadt', xml: g2Xml },
      ],
      operator: SAMPLE_GUIDE.operator,
      prestador: SAMPLE_GUIDE.prestador,
      issueDate: '2026-05-17',
    })
    expect(batchXml).toContain('LOTE-2026-001')
    expect(batchXml).toContain('ENVIO_LOTE_GUIAS')
    expect(batchXml).toContain('GUI-001')
    expect(batchXml).toContain('GUI-002')
    expect(batchXml).toContain('<ans:loteGuias>')
    expect(batchXml).toContain('<ans:numeroLote>LOTE-2026-001</ans:numeroLote>')
  })

  it('lote vazio gera estrutura mas sem guias', () => {
    const xml = generateBatchXml({
      tissVersion: '4.01',
      batchNumber: 'LOTE-EMPTY',
      guides: [],
      operator: SAMPLE_GUIDE.operator,
      prestador: SAMPLE_GUIDE.prestador,
      issueDate: '2026-05-17',
    })
    expect(xml).toContain('LOTE-EMPTY')
    expect(xml).toContain('<ans:guiasTISS>')
  })
})
