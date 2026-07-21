/**
 * OFX parser tests — Sprint 17 Faixa B.
 */
import { describe, expect, it } from 'vitest'
import { parseOfx } from './ofx-parser'

const OFX_2X_SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<OFX>
<BANKMSGSRSV1>
<STMTTRNRS>
<STMTRS>
<CURDEF>BRL</CURDEF>
<BANKACCTFROM>
<BANKID>237</BANKID>
<ACCTID>1234-56789-0</ACCTID>
<ACCTTYPE>CHECKING</ACCTTYPE>
</BANKACCTFROM>
<BANKTRANLIST>
<DTSTART>20260501</DTSTART>
<DTEND>20260531</DTEND>
<STMTTRN>
<TRNTYPE>DEBIT</TRNTYPE>
<DTPOSTED>20260505</DTPOSTED>
<TRNAMT>-3500.00</TRNAMT>
<FITID>2026050500001</FITID>
<NAME>ALUGUEL MAIO 2026</NAME>
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT</TRNTYPE>
<DTPOSTED>20260510</DTPOSTED>
<TRNAMT>15000.00</TRNAMT>
<FITID>2026051000002</FITID>
<NAME>RECEBIMENTO MENSALIDADES</NAME>
<MEMO>Lote 23 alunos</MEMO>
</STMTTRN>
</BANKTRANLIST>
<LEDGERBAL>
<BALAMT>11500.00</BALAMT>
<DTASOF>20260531</DTASOF>
</LEDGERBAL>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>`

const OFX_1X_SAMPLE = `OFXHEADER:100
DATA:OFXSGML
VERSION:102
SECURITY:NONE
ENCODING:USASCII
CHARSET:1252
COMPRESSION:NONE

<OFX>
<BANKMSGSRSV1>
<STMTTRNRS>
<STMTRS>
<BANKACCTFROM>
<BANKID>001
<ACCTID>9876-1234-5
<ACCTTYPE>CHECKING
</BANKACCTFROM>
<BANKTRANLIST>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260315
<TRNAMT>-150.50
<FITID>SGML-TX-001
<NAME>ENERGIA ELETRICA
</STMTTRN>
</BANKTRANLIST>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>`

describe('parseOfx — OFX 2.x XML', () => {
  it('extrai bank info', () => {
    const r = parseOfx(OFX_2X_SAMPLE)
    expect(r.bankId).toBe('237')
    expect(r.accountId).toBe('1234-56789-0')
    expect(r.accountKind).toBe('CHECKING')
  })

  it('extrai período', () => {
    const r = parseOfx(OFX_2X_SAMPLE)
    expect(r.startDate).toBe('2026-05-01T00:00:00Z')
    expect(r.endDate).toBe('2026-05-31T00:00:00Z')
  })

  it('extrai saldo final', () => {
    const r = parseOfx(OFX_2X_SAMPLE)
    expect(r.ledgerBalanceCents).toBe(1_150_000)
  })

  it('extrai 2 transações com valores corretos', () => {
    const r = parseOfx(OFX_2X_SAMPLE)
    expect(r.transactions).toHaveLength(2)
    expect(r.transactions[0]).toMatchObject({
      fitId: '2026050500001',
      amountCents: -350_000,
      description: 'ALUGUEL MAIO 2026',
      type: 'DEBIT',
    })
    expect(r.transactions[1]).toMatchObject({
      fitId: '2026051000002',
      amountCents: 1_500_000,
      description: 'RECEBIMENTO MENSALIDADES',
      memo: 'Lote 23 alunos',
    })
  })
})

describe('parseOfx — OFX 1.x SGML', () => {
  it('extrai transação SGML sem tags de fechamento', () => {
    const r = parseOfx(OFX_1X_SAMPLE)
    expect(r.bankId).toBe('001')
    expect(r.accountId).toBe('9876-1234-5')
    expect(r.transactions).toHaveLength(1)
    expect(r.transactions[0]).toMatchObject({
      fitId: 'SGML-TX-001',
      amountCents: -15_050,
      description: 'ENERGIA ELETRICA',
    })
  })
})

describe('parseOfx — edge cases', () => {
  it('content sem <OFX> retorna vazio (sem crash)', () => {
    const r = parseOfx('<HTML>not an ofx</HTML>')
    expect(r.transactions).toHaveLength(0)
  })

  it('transação sem FITID é ignorada', () => {
    const r = parseOfx(
      `<OFX><STMTTRN><DTPOSTED>20260501</DTPOSTED><TRNAMT>-100</TRNAMT></STMTTRN></OFX>`,
    )
    expect(r.transactions).toHaveLength(0)
  })

  it('valor com vírgula brasileira (apesar de padrão ser ponto)', () => {
    const r = parseOfx(
      `<OFX><STMTTRN><FITID>X1</FITID><DTPOSTED>20260501</DTPOSTED><TRNAMT>-1500,50</TRNAMT></STMTTRN></OFX>`,
    )
    expect(r.transactions[0]?.amountCents).toBe(-150_050)
  })

  it('data com hora extraída corretamente', () => {
    const r = parseOfx(
      `<OFX><STMTTRN><FITID>X1</FITID><DTPOSTED>20260501143000</DTPOSTED><TRNAMT>100</TRNAMT></STMTTRN></OFX>`,
    )
    expect(r.transactions[0]?.postedAt).toBe('2026-05-01T14:30:00Z')
  })
})
