/**
 * OFX parser — Sprint 17 Faixa B.
 *
 * OFX 2.x (XML-based) e 1.x (SGML-like) são suportados. Esta implementação
 * cobre o subset necessário pra extrato bancário brasileiro:
 *
 *   - STMTTRN (transaction): TRNTYPE, DTPOSTED, TRNAMT, FITID, MEMO, NAME
 *   - BANKID, ACCTID (matching com bank_accounts)
 *   - LEDGERBAL.BALAMT (saldo final do extrato)
 *
 * Não validamos XSD/DTD — parser tolerante baseado em regex pra evitar
 * dependência externa pesada (`xml2js`). Para casos exóticos, dependência
 * pode ser adicionada Sprint 17+.
 */

export interface ParsedTransaction {
  /** FITID — id único do banco (vira `external_id` em bank_transactions) */
  fitId: string
  /** YYYYMMDD ou YYYYMMDDHHMMSS — convertido pra ISO */
  postedAt: string
  /** Centavos com sinal: negativo = saída, positivo = entrada */
  amountCents: number
  description: string
  /** TRNTYPE: CREDIT/DEBIT/INT/DIV/FEE/etc */
  type?: string
  memo?: string
}

export interface ParsedOfx {
  bankId?: string
  accountId?: string
  accountKind?: string
  startDate?: string
  endDate?: string
  ledgerBalanceCents?: number
  transactions: ParsedTransaction[]
}

const TAG_OPEN = /<([A-Z][A-Z0-9_]*)>/g

/**
 * Extrai valor de tag OFX 1.x (SGML — `<TAG>value`) ou 2.x (XML — `<TAG>value</TAG>`).
 */
function extractValue(source: string, tag: string): string | null {
  // Try XML 2.x first
  const xmlMatch = source.match(new RegExp(`<${tag}>([^<]*)</${tag}>`, 'i'))
  if (xmlMatch) return xmlMatch[1]!.trim()
  // Try SGML 1.x
  const sgmlMatch = source.match(new RegExp(`<${tag}>([^<\\r\\n]*)`, 'i'))
  if (sgmlMatch) return sgmlMatch[1]!.trim()
  return null
}

function extractAllBlocks(source: string, blockTag: string): string[] {
  const blocks: string[] = []
  const startRegex = new RegExp(`<${blockTag}>`, 'gi')
  const endRegex = new RegExp(`</${blockTag}>`, 'gi')
  let match: RegExpExecArray | null
  const starts: number[] = []
  while ((match = startRegex.exec(source)) !== null) {
    starts.push(match.index + match[0].length)
  }
  endRegex.lastIndex = 0
  const ends: number[] = []
  while ((match = endRegex.exec(source)) !== null) {
    ends.push(match.index)
  }
  // XML 2.x: pares <STMTTRN>...</STMTTRN>
  if (ends.length >= starts.length && ends.length > 0) {
    for (let i = 0; i < starts.length; i++) {
      blocks.push(source.slice(starts[i]!, ends[i]!))
    }
    return blocks
  }
  // SGML 1.x: blocos delimitados apenas por novos <STMTTRN>
  if (starts.length > 0 && ends.length === 0) {
    for (let i = 0; i < starts.length; i++) {
      const blockStart = starts[i]!
      const blockEnd = i < starts.length - 1 ? starts[i + 1]! - blockTag.length - 2 : source.length
      blocks.push(source.slice(blockStart, blockEnd))
    }
  }
  return blocks
}

function parseOfxDate(raw: string | null): string | null {
  if (!raw) return null
  // YYYYMMDD or YYYYMMDDHHMMSS or YYYYMMDDHHMMSS.SSS[GMT]
  const m = raw.match(/^(\d{4})(\d{2})(\d{2})(?:(\d{2})(\d{2})(\d{2}))?/)
  if (!m) return null
  const [, y, mo, d, h = '00', mi = '00', s = '00'] = m
  return `${y}-${mo}-${d}T${h}:${mi}:${s}Z`
}

function parseOfxAmount(raw: string | null): number | null {
  if (!raw) return null
  const cleaned = raw.replace(/[^\d.,-]/g, '').replace(',', '.')
  const num = Number(cleaned)
  if (!Number.isFinite(num)) return null
  return Math.round(num * 100)
}

export function parseOfx(content: string): ParsedOfx {
  // Limpa headers OFX 1.x (linhas key:value antes do <OFX>)
  const ofxStart = content.search(/<OFX>/i)
  const body = ofxStart >= 0 ? content.slice(ofxStart) : content

  const bankId = extractValue(body, 'BANKID') ?? undefined
  const accountId = extractValue(body, 'ACCTID') ?? undefined
  const accountKind = extractValue(body, 'ACCTTYPE') ?? undefined

  const dtStart = parseOfxDate(extractValue(body, 'DTSTART')) ?? undefined
  const dtEnd = parseOfxDate(extractValue(body, 'DTEND')) ?? undefined
  const ledgerRaw = extractValue(body, 'BALAMT')
  const ledgerBalanceCents = parseOfxAmount(ledgerRaw) ?? undefined

  const trnBlocks = extractAllBlocks(body, 'STMTTRN')
  const transactions: ParsedTransaction[] = []
  for (const block of trnBlocks) {
    const fitId = extractValue(block, 'FITID')
    const postedRaw = extractValue(block, 'DTPOSTED')
    const amountRaw = extractValue(block, 'TRNAMT')
    const description = extractValue(block, 'NAME') ?? extractValue(block, 'PAYEE') ?? '(sem descrição)'
    const memo = extractValue(block, 'MEMO') ?? undefined
    const type = extractValue(block, 'TRNTYPE') ?? undefined

    const postedAt = parseOfxDate(postedRaw)
    const amountCents = parseOfxAmount(amountRaw)
    if (!fitId || !postedAt || amountCents == null) continue
    transactions.push({
      fitId,
      postedAt,
      amountCents,
      description,
      type,
      memo,
    })
  }

  return {
    bankId,
    accountId,
    accountKind,
    startDate: dtStart,
    endDate: dtEnd,
    ledgerBalanceCents,
    transactions,
  }
}
