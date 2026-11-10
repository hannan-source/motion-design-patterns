// Tally Prime import XML for vouchers.
// Paste the output into Tally (Import > Transactions) or POST it to Tally's HTTP port (default 9000).
// Tally's sign convention: a debit line is ISDEEMEDPOSITIVE "Yes" with a negative AMOUNT,
// a credit line is ISDEEMEDPOSITIVE "No" with a positive AMOUNT.

const x = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
const ymd = (isoDate) => String(isoDate).slice(0, 10).replace(/-/g, '');
const amt = (n) => (Math.round(Number(n) * 100) / 100).toFixed(2);

function entry(ledger, amount, isDebit, isParty) {
  return [
    '      <ALLLEDGERENTRIES.LIST>',
    `       <LEDGERNAME>${x(ledger)}</LEDGERNAME>`,
    `       <ISDEEMEDPOSITIVE>${isDebit ? 'Yes' : 'No'}</ISDEEMEDPOSITIVE>`,
    `       <ISPARTYLEDGER>${isParty ? 'Yes' : 'No'}</ISPARTYLEDGER>`,
    `       <AMOUNT>${isDebit ? '-' : ''}${amt(amount)}</AMOUNT>`,
    '      </ALLLEDGERENTRIES.LIST>',
  ].join('\n');
}

/**
 * @param {Array<{id:string,date:string,type:string,party:string,amount:number,dr:string,cr:string,narration:string,ref?:string}>} vouchers
 * @param {string} companyName  the company as it is named in Tally
 */
export function vouchersToTallyXML(vouchers, companyName = 'Dema') {
  const messages = vouchers.map((v) => {
    // The party ledger must be one side of the entry. If the voucher's party is a label rather
    // than a ledger (for example "Shopify" against "Shopify Clearing"), use the side Tally expects.
    const side = { Sales: v.dr, 'Debit Note': v.dr, Payment: v.dr, Purchase: v.cr, Receipt: v.cr, 'Credit Note': v.cr };
    const party = v.party === v.dr || v.party === v.cr ? v.party : side[v.type] || null;
    const narration = v.ref ? `${v.narration} [Source: ${v.ref}]` : v.narration;
    return [
      '    <TALLYMESSAGE xmlns:UDF="TallyUDF">',
      `     <VOUCHER VCHTYPE="${x(v.type)}" ACTION="Create" OBJVIEW="Accounting Voucher View">`,
      `      <DATE>${ymd(v.date)}</DATE>`,
      `      <EFFECTIVEDATE>${ymd(v.date)}</EFFECTIVEDATE>`,
      `      <VOUCHERTYPENAME>${x(v.type)}</VOUCHERTYPENAME>`,
      `      <VOUCHERNUMBER>${x(v.id)}</VOUCHERNUMBER>`,
      v.ref ? `      <REFERENCE>${x(v.ref)}</REFERENCE>` : null,
      party ? `      <PARTYLEDGERNAME>${x(party)}</PARTYLEDGERNAME>` : null,
      '      <PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW>',
      `      <NARRATION>${x(narration)}</NARRATION>`,
      entry(v.dr, v.amount, true, v.dr === party),
      entry(v.cr, v.amount, false, v.cr === party),
      '     </VOUCHER>',
      '    </TALLYMESSAGE>',
    ].filter(Boolean).join('\n');
  });
  return [
    '<ENVELOPE>',
    ' <HEADER>',
    '  <TALLYREQUEST>Import Data</TALLYREQUEST>',
    ' </HEADER>',
    ' <BODY>',
    '  <IMPORTDATA>',
    '   <REQUESTDESC>',
    '    <REPORTNAME>Vouchers</REPORTNAME>',
    '    <STATICVARIABLES>',
    `     <SVCURRENTCOMPANY>${x(companyName)}</SVCURRENTCOMPANY>`,
    '    </STATICVARIABLES>',
    '   </REQUESTDESC>',
    '   <REQUESTDATA>',
    ...messages,
    '   </REQUESTDATA>',
    '  </IMPORTDATA>',
    ' </BODY>',
    '</ENVELOPE>',
  ].join('\n');
}

/** Ledger names the vouchers refer to, so the accountant can create any that are missing in Tally. */
export function ledgersUsed(vouchers) {
  return [...new Set(vouchers.flatMap((v) => [v.dr, v.cr]))].sort();
}
