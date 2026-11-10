# Tally connector

A plan for connecting the ERP to Tally, so every factory event that moves money
becomes a voucher in Dema's books without being keyed in twice.

**Status.** The voucher export exists today: `js/tally.js` turns the ERP's
vouchers into Tally import XML, and the Finance module shows it for copying. The
bridge that posts it automatically is planned here and not yet built.

**To confirm first.** This plan assumes Tally Prime on a Windows PC in the
accounts office. The Tally version, whether it is single or multi-user, the
company name, the chart of accounts and the GST setup must be confirmed against
Dema's actual installation before any of this is switched on. Each point that
depends on that is marked **Confirm**.

Contents:

1. [How Tally is reached](#1-how-tally-is-reached)
2. [The bridge](#2-the-bridge)
3. [Event to voucher mapping](#3-event-to-voucher-mapping)
4. [Worked XML](#4-worked-xml)
5. [Masters: names must match](#5-masters-names-must-match)
6. [GST: open item](#6-gst-open-item)
7. [Reconciliation](#7-reconciliation)
8. [Failure modes](#8-failure-modes)
9. [Rollout](#9-rollout)

---

## 1. How Tally is reached

Tally Prime can act as a small HTTP server on the PC it runs on. Other programs
send it XML and get XML back. No add-on is needed.

**Turn it on** (once, on the accounts PC):

1. In Tally Prime press `F1` (Help) > **Settings** > **Connectivity**.
2. Under Client/Server configuration set **TallyPrime acts as** to `Both`
   (or `Server`).
3. Leave **Port** at `9000`, or note the port chosen.
4. Restart Tally Prime.

From then on, while Tally is open with the company loaded, an XML request sent
by HTTP `POST` to `http://localhost:9000` is answered by Tally. A plain `GET`
to that address returns a short "TallyPrime Server is Running" message, which
is a useful health check.

Two kinds of request matter here:

- **Import Data**: create vouchers (and masters, if we choose to).
- **Export Data**: read ledgers, stock items and vouchers back out.

Tally only answers for a company that is open. **Confirm** whether Tally stays
open during the working day on the accounts PC. If it is opened and closed, the
bridge simply waits and sends when it is next available.

The port is on the local machine. It is not exposed to the internet and must
not be. Nothing outside the accounts PC talks to Tally directly.

---

## 2. The bridge

A small program on the accounts PC, running as a Windows service. It is the only
thing that talks to both sides.

```
ERP API (cloud)  ◀──HTTPS──▶  Bridge (accounts PC)  ◀──HTTP :9000──▶  Tally Prime
                 outbound only                        localhost only
```

The bridge only makes outbound calls to the ERP. No inbound port is opened on
Dema's network.

### The loop

Every few minutes:

1. **Health.** `GET http://localhost:9000`. If Tally is not answering, report
   "Tally closed" to the ERP and stop this round.
2. **Fetch.** Ask the ERP API for vouchers with status `queued`, oldest first,
   in small batches.
3. **Post.** For each voucher, build the XML (the same format `js/tally.js`
   produces) and `POST` it to Tally. One voucher per request, so one bad voucher
   cannot block the rest.
4. **Read the answer.** Tally replies with a `RESPONSE` block:

   ```xml
   <RESPONSE>
    <CREATED>1</CREATED>
    <ALTERED>0</ALTERED>
    <DELETED>0</DELETED>
    <LASTVCHID>4127</LASTVCHID>
    <LASTMID>0</LASTMID>
    <COMBINED>0</COMBINED>
    <IGNORED>0</IGNORED>
    <ERRORS>0</ERRORS>
    <CANCELLED>0</CANCELLED>
   </RESPONSE>
   ```

   On a failure, `ERRORS` is 1 or more and a `LINEERROR` element carries the
   reason in words, for example `Ledger 'Kaveri Weaves' does not exist!`.
5. **Record.** Report the result to the ERP: `synced` with Tally's voucher id,
   or `failed` with the `LINEERROR` text. The Finance module shows both.
6. **Pull.** Read back entries made directly in Tally since the last round
   (payments, receipts, journals by the accountant) and send them to the ERP, so
   supplier balances and claim status stay current.

### Sending once and only once

Tally will accept the same voucher twice unless told otherwise, so the bridge
guards against duplicates in three ways:

- **Our number is the key.** Every voucher carries the ERP's voucher number
  (`PUR-0418`, `DN-0031`) as `VOUCHERNUMBER`. The ERP never reuses a number.
- **Check before retry.** If a request times out, the bridge does not resend
  blindly. It first asks Tally for a voucher of that type with that number. If
  it is there, the voucher is marked `synced`. Only if it is absent is it sent
  again.
- **Tally's own guard.** Set the voucher types the bridge uses to manual
  numbering with **Prevent Duplicates** on. A second voucher with the same
  number is then refused by Tally itself. **Confirm** this setting is acceptable
  with the accountant, since it changes how those voucher types are numbered.

Tally also supports a `REMOTEID` attribute on a voucher, which lets a later
import with the same id alter the voucher instead of creating a new one. We
intend to set it to the ERP voucher number. Its exact behaviour should be tested
on Dema's Tally version before it is relied on. **Confirm.**

### What the bridge never does

- It never deletes a voucher in Tally.
- It never alters a voucher in Tally. A correction is a new reversing voucher,
  raised in the ERP and approved by the accountant.
- It never creates a ledger without approval (see section 5).

---

## 3. Event to voucher mapping

Each factory event that moves money maps to one voucher type and two ledgers.
Ledger names below are the ones used in the example data. Dema's real names
replace them (section 5).

| Factory event | Voucher type | Debit | Credit | Amount | Source link |
|---|---|---|---|---|---|
| Fabric received at the dock (goods receipt) | Purchase | Fabric Purchases | The mill | Received metres × rate | GRN and roll ids |
| Roll fails inspection **before dyeing** | Debit Note | The mill | Purchase Returns | Rejected metres × rate | Roll id, defect photos |
| Dye lot returned and accepted | Purchase | Dyeing Charges | The dye house | Accepted metres × dye rate | Dye lot |
| Fabric fault found **after dyeing** | Journal | Fabric Loss: Post-Dye Defects | Stock: Dyed Fabric | Fabric cost + dye cost of the roll | Dye lot, roll id |
| Thread, trims, tools received | Purchase | Thread and Trims / Consumables | The vendor | Per invoice | Receipt |
| B2B cartons scanned out | Sales | The customer (Revolve, buyer) | Export Sales | Invoice value | Parcel, PO |
| Shopify order scanned out | Sales | Shopify Clearing | Online Sales | Order value | Parcel, Shopify order |
| Shopify payout received | Receipt | Bank | Shopify Clearing | Payout amount | Payout id |
| Store sale | Sales | Store Cash/Card Clearing | Retail Sales | Bill value | Store order |
| Customer return refunded | Credit Note | Sales Returns | The customer or Shopify Clearing | Refund value | Parcel |
| Customer payment received | Receipt | Bank | The customer | Amount received | PO or invoice |
| Supplier or dyer paid | Payment | The supplier | Bank | Amount paid | The purchase it settles |
| Freight billed | Payment or Purchase | Freight Outward | Bank or DHL | Per invoice | Carrier invoice |

Notes on the mapping:

- **The two fabric failures are booked differently on purpose.** A pre-dye
  rejection is a debit note: the money comes back from the mill. A post-dye
  failure is a journal to a loss ledger: the money is gone. Keeping the loss in
  its own ledger gives the founder one number to watch, and it should fall as
  the inspection gate takes hold.
- **Purchase timing.** The mapping books the fabric purchase at the goods receipt
  and reverses a failed roll with a debit note, which is what `erp.js` does. If the
  accountant prefers to book only when a roll passes, only the first two rows change. **Confirm.**
- **Shopify clearing.** Sales are booked per order to a clearing ledger and the
  payout clears it. Fees and refunds inside a payout need a rule agreed with the
  accountant. **Confirm.**
- **Receipts and payments** are usually entered by accounts in Tally from the
  bank. The bridge pulls those back and matches them to invoices. It only
  creates them itself where the accountant asks for that.
- **Export sales** are invoiced in USD. How the foreign currency amount and
  exchange rate are carried on the voucher depends on whether multi-currency is
  enabled in Dema's Tally. **Confirm.**
- **Wages** are out of scope for the first version.

---

## 4. Worked XML

These two examples are what `vouchersToTallyXML(vouchers, companyName)` in
`js/tally.js` produces for two vouchers from the example data. Dates and names
are examples.

Tally's sign convention, which the code follows:

- A **debit** line has `ISDEEMEDPOSITIVE` = `Yes` and a **negative** `AMOUNT`.
- A **credit** line has `ISDEEMEDPOSITIVE` = `No` and a **positive** `AMOUNT`.
- `DATE` is `YYYYMMDD`.
- The two lines of a voucher sum to zero.

### A purchase

Twelve rolls of cotton voile pass inspection. ₹2,48,600 is owed to the mill.

```xml
<ENVELOPE>
 <HEADER>
  <TALLYREQUEST>Import Data</TALLYREQUEST>
 </HEADER>
 <BODY>
  <IMPORTDATA>
   <REQUESTDESC>
    <REPORTNAME>Vouchers</REPORTNAME>
    <STATICVARIABLES>
     <SVCURRENTCOMPANY>Dema</SVCURRENTCOMPANY>
    </STATICVARIABLES>
   </REQUESTDESC>
   <REQUESTDATA>
    <TALLYMESSAGE xmlns:UDF="TallyUDF">
     <VOUCHER VCHTYPE="Purchase" ACTION="Create" OBJVIEW="Accounting Voucher View">
      <DATE>20261029</DATE>
      <EFFECTIVEDATE>20261029</EFFECTIVEDATE>
      <VOUCHERTYPENAME>Purchase</VOUCHERTYPENAME>
      <VOUCHERNUMBER>PUR-0418</VOUCHERNUMBER>
      <REFERENCE>GRN-0418</REFERENCE>
      <PARTYLEDGERNAME>Shree Laxmi Textiles</PARTYLEDGERNAME>
      <PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW>
      <NARRATION>GRN 0418: 12 rolls cotton voile, 1,184 m [Source: GRN-0418]</NARRATION>
      <ALLLEDGERENTRIES.LIST>
       <LEDGERNAME>Fabric Purchases</LEDGERNAME>
       <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
       <ISPARTYLEDGER>No</ISPARTYLEDGER>
       <AMOUNT>-248600.00</AMOUNT>
      </ALLLEDGERENTRIES.LIST>
      <ALLLEDGERENTRIES.LIST>
       <LEDGERNAME>Shree Laxmi Textiles</LEDGERNAME>
       <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
       <ISPARTYLEDGER>Yes</ISPARTYLEDGER>
       <AMOUNT>248600.00</AMOUNT>
      </ALLLEDGERENTRIES.LIST>
     </VOUCHER>
    </TALLYMESSAGE>
   </REQUESTDATA>
  </IMPORTDATA>
 </BODY>
</ENVELOPE>
```

### A debit note

One roll from the same mill fails inspection before dyeing. ₹21,630 is claimed
back.

```xml
<ENVELOPE>
 <HEADER>
  <TALLYREQUEST>Import Data</TALLYREQUEST>
 </HEADER>
 <BODY>
  <IMPORTDATA>
   <REQUESTDESC>
    <REPORTNAME>Vouchers</REPORTNAME>
    <STATICVARIABLES>
     <SVCURRENTCOMPANY>Dema</SVCURRENTCOMPANY>
    </STATICVARIABLES>
   </REQUESTDESC>
   <REQUESTDATA>
    <TALLYMESSAGE xmlns:UDF="TallyUDF">
     <VOUCHER VCHTYPE="Debit Note" ACTION="Create" OBJVIEW="Accounting Voucher View">
      <DATE>20261030</DATE>
      <EFFECTIVEDATE>20261030</EFFECTIVEDATE>
      <VOUCHERTYPENAME>Debit Note</VOUCHERTYPENAME>
      <VOUCHERNUMBER>DN-0031</VOUCHERNUMBER>
      <REFERENCE>R-2407</REFERENCE>
      <PARTYLEDGERNAME>Shree Laxmi Textiles</PARTYLEDGERNAME>
      <PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW>
      <NARRATION>Roll failed inspection before dyeing: weft lines, 46 points per 100 sq yd [Source: R-2407]</NARRATION>
      <ALLLEDGERENTRIES.LIST>
       <LEDGERNAME>Shree Laxmi Textiles</LEDGERNAME>
       <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
       <ISPARTYLEDGER>Yes</ISPARTYLEDGER>
       <AMOUNT>-21630.00</AMOUNT>
      </ALLLEDGERENTRIES.LIST>
      <ALLLEDGERENTRIES.LIST>
       <LEDGERNAME>Purchase Returns</LEDGERNAME>
       <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
       <ISPARTYLEDGER>No</ISPARTYLEDGER>
       <AMOUNT>21630.00</AMOUNT>
      </ALLLEDGERENTRIES.LIST>
     </VOUCHER>
    </TALLYMESSAGE>
   </REQUESTDATA>
  </IMPORTDATA>
 </BODY>
</ENVELOPE>
```

The export sends several vouchers in one envelope, as repeated `TALLYMESSAGE`
blocks. The bridge sends one per request.

These are accounting vouchers: two ledger lines, no stock items and no tax
lines. That is enough to prove the pipe. Item-wise invoices with quantities and
GST come after section 6 is settled.

**Trying it by hand.** In the Finance module, copy the XML. In Tally Prime use
`Alt+O` (Import) > **Transactions**, and point it at a file holding the XML.
Use a test company first.

---

## 5. Masters: names must match

Tally identifies a ledger by its name. `Kaveri Weaves` and `Kaveri Weaves Pvt
Ltd` are two different ledgers, and a voucher naming a ledger that does not
exist is refused. Most first-run failures are name mismatches.

So masters are pulled from Tally before any voucher is pushed to it.

1. **Pull.** The bridge exports the list of ledgers (name, parent group, GSTIN
   where present), voucher types, stock groups, stock items and units from
   Tally and sends them to the ERP.
2. **Map.** In the ERP, each supplier, customer and account the factory events
   use is mapped once to a Tally ledger, on a screen the accountant fills in.
   The example names in this document are replaced by Dema's.
3. **Hold.** A voucher whose ledgers are not all mapped stays in `needs mapping`
   and is not sent. The Finance module lists what is missing. `ledgersUsed()` in
   `js/tally.js` already produces that list.
4. **New parties.** When a new mill or buyer appears, the ERP asks the
   accountant to pick or create the Tally ledger. The bridge can create a ledger
   on approval, under the group the accountant chooses. It never creates one on
   its own.
5. **Refresh.** Masters are pulled again daily, so renames in Tally are caught
   before they cause a failure.

Ledgers that probably need creating, because they are new ideas: a loss ledger
for post-dye defects, a Shopify clearing ledger, and possibly separate ledgers
for dyeing charges and purchase returns. **Confirm** the names and groups with
the accountant.

Stock items are only needed if Dema keeps inventory in Tally. If Tally is used
for accounts only, the ERP is the stock record and Tally receives values, not
quantities. **Confirm.**

---

## 6. GST: open item

GST is deliberately not built into the examples above. It has to be settled
with Dema's accountant, not guessed. The questions:

1. **Tax ledgers.** The names of the input and output CGST, SGST and IGST
   ledgers in Dema's Tally, and whether tax is calculated by Tally from the
   stock item and party, or posted as explicit ledger lines.
2. **Invoice mode.** Whether purchases and sales are entered as item invoices
   (with stock items, quantity, rate, HSN) or as accounting vouchers. Item
   invoices need the stock items mapped and add inventory lines to the XML.
3. **HSN codes and rates** for each fabric, for thread and trims, and for each
   garment style. Garment rates can depend on the sale value per piece.
4. **Purchases.** Intra-state versus inter-state by supplier, and how a debit
   note for rejected fabric adjusts input credit.
5. **Job-work.** Fabric sent to the dye house is job-work. The challans that
   cover goods sent and returned, the time limits on return, and how the dyer's
   charges are taxed. The ERP's dye lot record can produce the challan
   particulars if the accountant wants them.
6. **Exports.** Whether exports to Revolve and the UK buyers go under a Letter
   of Undertaking without payment of tax, or with tax paid and refunded, and
   what the export invoice in Tally must carry (currency, rate, shipping bill,
   port code).
7. **Online and store sales.** Tax treatment of Shopify orders shipped abroad
   versus within India, and of store sales.
8. **E-invoicing and e-way bills.** Whether they apply to Dema, and whether
   they are raised from Tally or elsewhere. The bridge must not get in the way
   of whichever it is.
9. **Returns filing.** Which reports the accountant files from Tally, so the
   vouchers the bridge creates show up correctly in them.

Until these are answered, the bridge runs on a test company, or posts only
vouchers with no tax effect. No tax ledger is touched by the bridge before the
accountant has signed off the mapping.

---

## 7. Reconciliation

A daily check that both sides agree, run by the bridge after the last sync and
shown in the Finance module.

For each voucher type and day:

| Check | ERP side | Tally side | If different |
|---|---|---|---|
| Count | Vouchers marked `synced` | Vouchers with our number series | List the missing or extra numbers |
| Total | Sum of amounts | Sum of amounts | List vouchers whose amount differs |
| Altered | Amount and ledgers as sent | Amount and ledgers now | Flag as changed in Tally, for the accountant |

And once a week:

- **Party balances.** Each supplier's and customer's balance in Tally against
  the ERP's open invoices and claims.
- **Loss ledger.** The balance of the post-dye loss ledger against the rolls in
  the write-off bay.
- **Clearing ledgers.** Shopify clearing should return to near zero after each
  payout. A growing balance means unmatched orders or fees.

A difference is never fixed automatically. It is shown to the accountant with
both versions side by side. The answer is either a reversing voucher or an
accepted note on why they differ.

---

## 8. Failure modes

| What goes wrong | How it shows | What happens |
|---|---|---|
| Tally is closed, or the company is not loaded | Health check fails | Vouchers stay queued. The Finance module shows "Tally not reachable since…". Nothing is lost |
| The accounts PC is off or offline | The ERP stops hearing from the bridge | Same as above. An alert after an agreed number of hours |
| Ledger does not exist | `LINEERROR` names the ledger | Voucher marked `failed: ledger missing`, sent to mapping. Others carry on |
| Voucher date is in a locked or closed period | `LINEERROR` on the date | Voucher held for the accountant to choose a date or reopen the period |
| Voucher type missing or named differently | `LINEERROR` on the voucher type | Fixed once in the mapping. **Confirm** Dema's voucher type names |
| Request times out | No response | Bridge checks Tally for the voucher number before any resend (section 2) |
| Same voucher sent twice | Tally refuses it if Prevent Duplicates is on | Marked `synced` after the check finds the original |
| Voucher edited or deleted in Tally | Daily reconciliation | Flagged to the accountant. The ERP is not changed silently |
| Amounts do not balance | Caught in the ERP before sending | Never reaches Tally. A voucher is two equal lines by construction |
| Special characters in names or narration | Would break the XML | Escaped by `tally.js` (`&`, `<`, `>`, quotes) |
| Tally upgraded | Possible change in behaviour | Re-run the test set on a copy of the company before resuming |
| Multi-user Tally with the company open elsewhere | Port answers on a different machine | **Confirm** where the server role should sit |

The rule behind all of these: a voucher is either safely in the queue or
confirmed in Tally. It is never in doubt, and never sent on a guess.

---

## 9. Rollout

1. **Look.** Get the Tally version, the company name, the ledger list, voucher
   types and GST setup. Take a backup of the company.
2. **Copy.** Restore the backup as a test company on the accounts PC. All early
   work happens there.
3. **Paste.** Copy the XML from the Finance module and import it by hand into
   the test company. Fix names until the purchase and debit note examples go in
   cleanly. This proves the format with no software installed.
4. **Map.** Pull masters from Tally. The accountant maps suppliers, customers
   and accounts, and agrees the new ledgers.
5. **Settle GST.** Work through section 6 and extend the XML to match.
6. **Install the bridge** against the test company. Run every event type from
   section 3 through it. Run the failure cases from section 8 on purpose.
7. **Shadow.** Point the bridge at the live company for one voucher type only,
   fabric purchases at goods receipt. The accountant keeps entering by hand as well
   for a short period and compares.
8. **Widen.** Add debit notes, then dye charges, then sales, as each one
   reconciles cleanly.
9. **Hand over.** The accountant stops re-keying factory paperwork. Daily
   reconciliation becomes their check. The bookkeeper agent starts flagging
   unusual vouchers for approval.

**Done means:** for a full month, daily voucher counts and totals match on both
sides, every voucher in Tally opens back to its roll, lot or parcel in the ERP,
and nothing was keyed in twice.
