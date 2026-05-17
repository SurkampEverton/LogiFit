/**
 * tiss-return-parser.ts tests — Sprint 22 Faixa B.1.
 */
import { describe, expect, it } from 'vitest'
import { parseReturnXml } from './tiss-return-parser'

const SAMPLE_RETURN_PAGA = `<?xml version="1.0" encoding="UTF-8"?>
<ans:mensagemTISS xmlns:ans="http://www.ans.gov.br/padroes/tiss/schemas" versaoTISS="4.01">
  <ans:cabecalho>
    <ans:numeroLote>LOTE-2026-001</ans:numeroLote>
    <ans:dataRetorno>2026-05-20</ans:dataRetorno>
  </ans:cabecalho>
  <ans:retornoLote>
    <ans:guiaResposta>
      <ans:numeroGuiaPrestador>GUI-001</ans:numeroGuiaPrestador>
      <ans:numeroGuiaOperadora>OP-XYZ-001</ans:numeroGuiaOperadora>
      <ans:valorTotalGeral>55,00</ans:valorTotalGeral>
      <ans:valorPago>55,00</ans:valorPago>
    </ans:guiaResposta>
  </ans:retornoLote>
</ans:mensagemTISS>`

const SAMPLE_RETURN_GLOSADA = `<?xml version="1.0" encoding="UTF-8"?>
<ans:mensagemTISS xmlns:ans="http://www.ans.gov.br/padroes/tiss/schemas" versaoTISS="4.01">
  <ans:cabecalho>
    <ans:numeroLote>LOTE-2026-002</ans:numeroLote>
    <ans:dataRetorno>2026-05-21</ans:dataRetorno>
  </ans:cabecalho>
  <ans:retornoLote>
    <ans:guiaResposta>
      <ans:numeroGuiaPrestador>GUI-PARC</ans:numeroGuiaPrestador>
      <ans:valorTotalGeral>110,00</ans:valorTotalGeral>
      <ans:valorPago>80,00</ans:valorPago>
      <ans:glosa>
        <ans:codigoGlosa>0301</ans:codigoGlosa>
        <ans:descricaoGlosa>Procedimento sem cobertura no plano</ans:descricaoGlosa>
        <ans:valorGlosa>30,00</ans:valorGlosa>
      </ans:glosa>
    </ans:guiaResposta>
    <ans:guiaResposta>
      <ans:numeroGuiaPrestador>GUI-TOTAL-GLOSA</ans:numeroGuiaPrestador>
      <ans:valorTotalGeral>200,00</ans:valorTotalGeral>
      <ans:valorPago>0,00</ans:valorPago>
      <ans:glosa>
        <ans:codigoGlosa>0501</ans:codigoGlosa>
        <ans:descricaoGlosa>Beneficiario inadimplente</ans:descricaoGlosa>
        <ans:valorGlosa>200,00</ans:valorGlosa>
      </ans:glosa>
    </ans:guiaResposta>
  </ans:retornoLote>
</ans:mensagemTISS>`

describe('parseReturnXml', () => {
  it('parse retorno simples (guia paga integralmente)', () => {
    const r = parseReturnXml(SAMPLE_RETURN_PAGA)
    expect(r.batchNumber).toBe('LOTE-2026-001')
    expect(r.returnDate).toBe('2026-05-20')
    expect(r.items).toHaveLength(1)
    const item = r.items[0]!
    expect(item.guideNumber).toBe('GUI-001')
    expect(item.operatorGuideNumber).toBe('OP-XYZ-001')
    expect(item.paidAmountCents).toBe(5500)
    expect(item.glosas).toHaveLength(0)
    expect(item.status).toBe('paid')
  })

  it('parse retorno com glosa parcial', () => {
    const r = parseReturnXml(SAMPLE_RETURN_GLOSADA)
    expect(r.items).toHaveLength(2)

    const parcial = r.items.find((i) => i.guideNumber === 'GUI-PARC')!
    expect(parcial.paidAmountCents).toBe(8000)
    expect(parcial.glosas).toHaveLength(1)
    expect(parcial.glosas[0]!.reasonCode).toBe('0301')
    expect(parcial.glosas[0]!.amountGlossedCents).toBe(3000)
    expect(parcial.status).toBe('partially_paid')

    const total = r.items.find((i) => i.guideNumber === 'GUI-TOTAL-GLOSA')!
    expect(total.paidAmountCents).toBe(0)
    expect(total.glosas).toHaveLength(1)
    expect(total.status).toBe('fully_glossed')
  })

  it('XML vazio retorna items = []', () => {
    const r = parseReturnXml('<?xml version="1.0"?><empty></empty>')
    expect(r.items).toHaveLength(0)
  })

  it('valor BRL formato 1.234,56 → centavos corretos', () => {
    const xml = `<retornoLote>
      <guiaResposta>
        <numeroGuiaPrestador>GUI-BIG</numeroGuiaPrestador>
        <valorPago>1.234,56</valorPago>
      </guiaResposta>
    </retornoLote>`
    const r = parseReturnXml(xml)
    expect(r.items[0]!.paidAmountCents).toBe(123456)
  })

  it('múltiplas glosas no mesmo item', () => {
    const xml = `<retornoLote>
      <guiaResposta>
        <numeroGuiaPrestador>GUI-MULTI</numeroGuiaPrestador>
        <valorPago>10,00</valorPago>
        <glosa><codigoGlosa>0301</codigoGlosa><descricaoGlosa>X</descricaoGlosa><valorGlosa>5,00</valorGlosa></glosa>
        <glosa><codigoGlosa>0401</codigoGlosa><descricaoGlosa>Y</descricaoGlosa><valorGlosa>10,00</valorGlosa></glosa>
      </guiaResposta>
    </retornoLote>`
    const r = parseReturnXml(xml)
    expect(r.items[0]!.glosas).toHaveLength(2)
    expect(r.items[0]!.glosas.map((g) => g.reasonCode).sort()).toEqual(['0301', '0401'])
  })
})
