/**
 * Parser de XML de retorno TISS — Sprint 22 Faixa B.1.
 *
 * Operadora envia XML após processar o lote contendo:
 *   - Guias pagas (com valor)
 *   - Guias glosadas (parcial ou total, com motivo)
 *   - Guias canceladas
 *
 * MVP: parser regex-based para os campos essenciais. Sprint 22b pode usar
 * `fast-xml-parser` ou `xml2js` para parsing estruturado completo.
 *
 * Função pura — caller persiste eventos no DB.
 */

export interface ParsedReturnItem {
  guideNumber: string
  operatorGuideNumber?: string | null
  /** Valor efetivamente pago em centavos */
  paidAmountCents: number
  /** Lista de glosas no item */
  glosas: ParsedGlosa[]
  /** Status final da guia segundo a operadora */
  status: 'paid' | 'partially_paid' | 'fully_glossed' | 'cancelled' | 'unknown'
}

export interface ParsedGlosa {
  reasonCode: string
  reasonDescription: string
  amountGlossedCents: number
}

export interface ParsedReturnXml {
  batchNumber?: string | null
  returnDate?: string | null
  items: ParsedReturnItem[]
}

function extractAll(xml: string, tag: string): string[] {
  const re = new RegExp(
    `<(?:[a-zA-Z]+:)?${tag}[^>]*>([\\s\\S]*?)<\\/(?:[a-zA-Z]+:)?${tag}>`,
    'g',
  )
  const out: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(xml)) !== null) out.push(m[1] ?? '')
  return out
}

function extractOne(xml: string, tag: string): string | null {
  const re = new RegExp(
    `<(?:[a-zA-Z]+:)?${tag}[^>]*>([\\s\\S]*?)<\\/(?:[a-zA-Z]+:)?${tag}>`,
  )
  const m = xml.match(re)
  return m ? m[1] ?? null : null
}

function brlToCents(brl: string | null): number {
  if (!brl) return 0
  const cleaned = brl.replace(/\./g, '').replace(',', '.').trim()
  const n = Number(cleaned)
  return Number.isFinite(n) ? Math.round(n * 100) : 0
}

/**
 * Parse XML de retorno TISS. Procura estrutura típica:
 *
 * ```xml
 * <retornoLote>
 *   <numeroLote>...</numeroLote>
 *   <dataRetorno>YYYY-MM-DD</dataRetorno>
 *   <guiaResposta>
 *     <numeroGuiaPrestador>GUI-001</numeroGuiaPrestador>
 *     <numeroGuiaOperadora>OP-XYZ</numeroGuiaOperadora>
 *     <valorPago>110,00</valorPago>
 *     <glosa>
 *       <codigoGlosa>0301</codigoGlosa>
 *       <descricaoGlosa>...</descricaoGlosa>
 *       <valorGlosa>30,00</valorGlosa>
 *     </glosa>
 *   </guiaResposta>
 * </retornoLote>
 * ```
 */
export function parseReturnXml(xml: string): ParsedReturnXml {
  const batchNumber = extractOne(xml, 'numeroLote')
  const returnDate = extractOne(xml, 'dataRetorno')

  const guideBlocks = extractAll(xml, 'guiaResposta')
  const items: ParsedReturnItem[] = []

  for (const block of guideBlocks) {
    const guideNumber = extractOne(block, 'numeroGuiaPrestador') ?? ''
    const operatorGuideNumber = extractOne(block, 'numeroGuiaOperadora')
    const paidStr = extractOne(block, 'valorPago')
    const paidAmountCents = brlToCents(paidStr)
    const totalStr = extractOne(block, 'valorTotalGeral')
    const totalCents = brlToCents(totalStr)

    const glosaBlocks = extractAll(block, 'glosa')
    const glosas: ParsedGlosa[] = glosaBlocks.map((g) => ({
      reasonCode: extractOne(g, 'codigoGlosa') ?? '',
      reasonDescription: extractOne(g, 'descricaoGlosa') ?? '',
      amountGlossedCents: brlToCents(extractOne(g, 'valorGlosa')),
    }))

    let status: ParsedReturnItem['status'] = 'unknown'
    if (glosas.length === 0 && paidAmountCents > 0) status = 'paid'
    else if (glosas.length > 0 && paidAmountCents === 0) status = 'fully_glossed'
    else if (glosas.length > 0 && paidAmountCents > 0) status = 'partially_paid'
    else if (totalCents > 0 && paidAmountCents === 0 && glosas.length === 0)
      status = 'cancelled'

    if (guideNumber) {
      items.push({
        guideNumber,
        operatorGuideNumber: operatorGuideNumber ?? null,
        paidAmountCents,
        glosas,
        status,
      })
    }
  }

  return {
    batchNumber: batchNumber ?? null,
    returnDate: returnDate ?? null,
    items,
  }
}
