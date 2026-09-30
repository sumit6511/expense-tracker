import { describe, expect, it } from 'vitest';
import { adToBs } from './bs';
import {
  detectStatementFormat,
  parseCamt053,
  parseOfx,
  parseQif,
  parseStatementFile,
} from './formats';
import { parseBankSms } from './sms';

const OFX_SGML = `OFXHEADER:100
DATA:OFXSGML
VERSION:102

<OFX>
<BANKMSGSRSV1><STMTTRNRS><STMTRS>
<CURDEF>NPR
<BANKACCTFROM><BANKID>NABIL<ACCTID>0101017500123<ACCTTYPE>SAVINGS</BANKACCTFROM>
<BANKTRANLIST>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260915120000[+5:45:NPT]
<TRNAMT>-2450.00
<FITID>TXN001
<NAME>BHAT BHATENI SUPERMARKET
<MEMO>POS PURCHASE &amp; CASHBACK
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20260916
<TRNAMT>85000
<FITID>TXN002
<NAME>SALARY SEP
</STMTTRN>
</BANKTRANLIST>
<LEDGERBAL><BALAMT>132550.00<DTASOF>20260930</LEDGERBAL>
</STMTRS></STMTTRNRS></BANKMSGSRSV1>
</OFX>`;

const OFX_XML = `<?xml version="1.0"?><?OFX OFXHEADER="200" VERSION="220"?>
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>USD</CURDEF>
<BANKTRANLIST><STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20260901</DTPOSTED>
<TRNAMT>-15.49</TRNAMT><FITID>N1</FITID><NAME>NETFLIX.COM</NAME></STMTTRN></BANKTRANLIST>
</STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

describe('OFX', () => {
  it('reads SGML statements', () => {
    const s = parseOfx(OFX_SGML, 2);
    expect(s).toMatchObject({ currency: 'NPR', account: '0101017500123', errors: [] });
    expect(s.balance).toEqual({ amountMinor: 13_255_000, date: '2026-09-30' });
    expect(s.rows).toEqual([
      {
        line: 0,
        date: '2026-09-15',
        amountMinor: -245_000,
        payee: 'BHAT BHATENI SUPERMARKET',
        description: 'BHAT BHATENI SUPERMARKET POS PURCHASE & CASHBACK',
        notes: '',
        externalId: 'TXN001',
      },
      expect.objectContaining({ date: '2026-09-16', amountMinor: 8_500_000, externalId: 'TXN002' }),
    ]);
  });

  it('reads XML statements and is detected by content', () => {
    expect(detectStatementFormat(OFX_XML)).toBe('ofx');
    expect(detectStatementFormat('Date,Amount\n1,2', 'x.csv')).toBeNull();
    const s = parseStatementFile(OFX_XML, 2, 'export.qfx')!;
    expect(s.currency).toBe('USD');
    expect(s.rows[0]).toMatchObject({ amountMinor: -1549, payee: 'NETFLIX.COM' });
  });
});

describe('QIF', () => {
  it('reads records, detecting day-first dates', () => {
    const qif = `!Type:Bank
D25/09/2026
T-1,200.50
PMomo Hut
MLunch
LDining
^
D30/09'26
T5,000.00
PBrother
N1042
^
`;
    const s = parseQif(qif, 2);
    expect(s.errors).toEqual([]);
    expect(s.rows).toEqual([
      expect.objectContaining({
        date: '2026-09-25',
        amountMinor: -120_050,
        payee: 'Momo Hut',
        description: 'Momo Hut Lunch',
        notes: 'Dining',
      }),
      expect.objectContaining({ date: '2026-09-30', amountMinor: 500_000, externalId: '1042' }),
    ]);
  });

  it('reports records it cannot read', () => {
    const s = parseQif('!Type:Bank\nPNo date\nT5\n^\n', 2);
    expect(s.rows).toHaveLength(0);
    expect(s.errors).toHaveLength(1);
  });
});

describe('CAMT.053', () => {
  it('reads entries, direction, parties and the closing balance', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"><BkToCstmrStmt><Stmt>
<Acct><Id><IBAN>NP12NABIL0001</IBAN></Id><Ccy>NPR</Ccy></Acct>
<Bal><Tp><CdOrPrtry><Cd>CLBD</Cd></CdOrPrtry></Tp><Amt Ccy="NPR">50000.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Dt><Dt>2026-09-30</Dt></Dt></Bal>
<Ntry><Amt Ccy="NPR">1500.00</Amt><CdtDbtInd>DBIT</CdtDbtInd><BookgDt><Dt>2026-09-20</Dt></BookgDt>
<AcctSvcrRef>REF-1</AcctSvcrRef><NtryDtls><TxDtls><RltdPties><Cdtr><Nm>WorldLink Communications</Nm></Cdtr></RltdPties>
<RmtInf><Ustrd>Internet Asoj</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry>
<Ntry><Amt Ccy="NPR">40000.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><BookgDt><DtTm>2026-09-21T10:00:00</DtTm></BookgDt>
<NtryDtls><TxDtls><RltdPties><Dbtr><Nm>Brother</Nm></Dbtr></RltdPties></TxDtls></NtryDtls></Ntry>
</Stmt></BkToCstmrStmt></Document>`;
    expect(detectStatementFormat(xml)).toBe('camt');
    const s = parseCamt053(xml, 2);
    expect(s).toMatchObject({ currency: 'NPR', account: 'NP12NABIL0001', errors: [] });
    expect(s.balance).toEqual({ amountMinor: 5_000_000, date: '2026-09-30' });
    expect(s.rows).toEqual([
      expect.objectContaining({
        date: '2026-09-20',
        amountMinor: -150_000,
        payee: 'WorldLink Communications',
        description: 'WorldLink Communications Internet Asoj',
        externalId: 'REF-1',
      }),
      expect.objectContaining({ date: '2026-09-21', amountMinor: 4_000_000, payee: 'Brother' }),
    ]);
  });

  it('ignores namespace prefixes', () => {
    const xml = `<ns2:Document><ns2:BkToCstmrStmt><ns2:Stmt><ns2:Ntry><ns2:Amt Ccy="EUR">10.00</ns2:Amt>
<ns2:CdtDbtInd>DBIT</ns2:CdtDbtInd><ns2:BookgDt><ns2:Dt>2026-01-02</ns2:Dt></ns2:BookgDt></ns2:Ntry>
</ns2:Stmt></ns2:BkToCstmrStmt></ns2:Document>`;
    expect(parseCamt053(xml, 2).rows[0]).toMatchObject({ amountMinor: -1000, date: '2026-01-02' });
  });
});

describe('bank SMS', () => {
  const today = '2026-09-30';
  const sms = (text: string) => parseBankSms(text, { today, digits: 2 });

  it('reads common Nepali bank alerts', () => {
    const { rows, unreadable } =
      sms(`Dear Customer, Your A/C 0101XXXX456 has been debited by NPR 2,500.00 on 15/09/2026. Remarks: POS/BHAT BHATENI KTM. Bal: NPR 45,000.00

Dear Customer, your A/C ##1234 is credited by NPR 85,000.00 on 2026-09-16 for SALARY SEP 2026. Avl Bal NPR 1,30,000.00

NPR 5,000.00 has been withdrawn from your A/C xxxx1234 on 15-SEP-26 at ATM NABIL THAMEL. Txn ID: 998877

This is not a transaction alert.`);
    expect(unreadable).toEqual(['This is not a transaction alert.']);
    expect(rows).toEqual([
      expect.objectContaining({
        date: '2026-09-15',
        amountMinor: -250_000,
        currency: 'NPR',
        payee: 'Bhat Bhateni KTM',
        description: 'POS/BHAT BHATENI KTM',
      }),
      expect.objectContaining({
        date: '2026-09-16',
        amountMinor: 8_500_000,
        description: 'SALARY SEP 2026',
      }),
      expect.objectContaining({
        date: '2026-09-15',
        amountMinor: -500_000,
        description: 'ATM NABIL THAMEL',
        externalId: '998877',
      }),
    ]);
  });

  it('reads wallet messages, one per line, with Bikram Sambat dates', () => {
    const { rows } = sms(
      [
        'You have paid Rs. 250 to Momo Hut via Khalti. Txn ID: KH12345',
        'Rs.1,000.00 has been received from Sita Sharma on 2083-06-14 in your eSewa account.',
      ].join('\n'),
    );
    expect(rows[0]).toMatchObject({
      amountMinor: -25_000,
      payee: 'Momo Hut',
      externalId: 'KH12345',
      date: today,
    });
    expect(rows[1]).toMatchObject({ amountMinor: 100_000, payee: 'Sita Sharma' });
    expect(adToBs(rows[1]!.date)).toEqual({ year: 2083, month: 6, day: 14 });
  });

  it('skips balances and reads Devanagari digits', () => {
    const { rows } = sms(
      'Bal: NPR 45,000.00. Your account was debited by NPR २००.०० for Ncell recharge.',
    );
    expect(rows[0]).toMatchObject({ amountMinor: -20_000 });
  });
});
