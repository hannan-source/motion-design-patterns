// How fabric and work really move at Deme, where that differs from a textbook factory:
//  - ready-for-dyeing fabric goes from the mill straight to the dye house, and is passed either
//    on the mill's own QC report or by Deme's person there;
//  - fabric that fails is the supplier's to answer for, so a claim stays open until the credit
//    note or the replacement arrives;
//  - the dye house reports problems from a phone, with photos;
//  - tomorrow's cutting is planned the evening before, checked against fabric actually in the
//    store, and issued as bundles of exactly the cut quantity;
//  - most wholesale work is made by production vendors, checked in-house or at the vendor;
//  - a parcel leaves only with its paperwork.

import { INSPECTION_PASS_MARK, EWAY_ABOVE, FABRIC_REASONS } from './schema.js';

const round = (n, dp = 2) => { const f = 10 ** dp; return Math.round(n * f) / f; };
const qty = (n) => round(Number(n) || 0, 2).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const rupees = (n) => `₹${Math.round(n).toLocaleString('en-IN')}`;
const count = (n, one, many = `${one}s`) => `${qty(n)} ${n === 1 ? one : many}`;
const same = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();
const REASON = Object.fromEntries(FABRIC_REASONS);
const leftOn = (roll) => (roll.left ?? roll.metres ?? 0);
const holders = (ctx, positions) => ctx.all('users').filter((u) => u.active !== false && positions.includes(u.position)).map((u) => u.id);

/** Open a claim on a supplier for fabric that was turned down, with the debit note that goes with it. */
export function openClaim(ctx, { supplier, against, stage, rolls, dyeLot, reason, metres, amount, note }) {
  const s = supplier ? ctx.get('suppliers', supplier) : null;
  if (!s) return null;
  const claim = ctx.put('claims', { date: ctx.today, supplier: s.id, against, stage, rolls: rolls.map((r) => r.id), dyeLot, reason: REASON[reason] ? reason : undefined, metres: round(metres), amount: round(amount), note: note || undefined });
  ctx.voucher({ type: 'Debit Note', party: s.name, dr: ctx.ledgerOf('suppliers', s.id), cr: 'Purchase Returns', amount, narration: `Claim ${claim.no}: ${qty(metres)} m ${stage === 'after' ? 'failed after dyeing' : 'failed inspection'}${REASON[reason] ? ` (${REASON[reason].toLowerCase()})` : ''}`, ref: claim.no });
  ctx.log('claims', claim.id, 'created', `Claim ${claim.no} on ${s.name}: ${qty(metres)} m, ${rupees(amount)}`);
  for (const to of holders(ctx, ['finance', 'payables', 'merch'])) ctx.notify(to, `Claim ${claim.no} on ${s.name}: ${qty(metres)} m, ${rupees(amount)}`, 'e-claims');
  return claim;
}

/** What stops a parcel leaving: the office's paperwork. Returns a sentence, or '' when it may go. */
export function papersMissing(parcel) {
  if (parcel.kind === 'store') return '';
  if (!String(parcel.invoiceNo || '').trim()) return `Parcel ${parcel.barcode} has no e-invoice number yet. The office adds it under Parcels; then scan again.`;
  if ((parcel.value || 0) > EWAY_ABOVE && !String(parcel.ewayNo || '').trim()) return `Parcel ${parcel.barcode} is worth ${rupees(parcel.value)} and needs an e-way bill number before it leaves. The office adds it under Parcels.`;
  return '';
}

/** For each line of a day plan: the fabric it needs, what is really in the store for it, and the rolls to take it from. */
function fabricCheck(ctx, doc) {
  const free = new Map(ctx.all('rolls').filter((r) => ['dyed', 'passed'].includes(r.status) && !r.heldAt && leftOn(r) > 0).map((r) => [r.id, { roll: r, left: leftOn(r) }]));
  const planned = {}, issuedOn = {};
  return (doc.lines || []).map((line, i) => {
    const wo = ctx.get('work_orders', line.workOrder) || ctx.fail(`Line ${i + 1} has no work order.`);
    if (wo.madeBy === 'vendor') ctx.fail(`${wo.no} is made by a vendor, so it is not cut here. Take it off the plan.`);
    if (['done', 'hold'].includes(wo.status)) ctx.fail(`${wo.no} is ${wo.status === 'done' ? 'finished' : 'on hold'}. Take it off the plan.`);
    if (!(line.pieces > 0) || !Number.isInteger(line.pieces)) ctx.fail(`Line ${i + 1} (${wo.no}) needs a whole number of pieces above zero.`);
    planned[wo.id] = (planned[wo.id] || 0) + line.pieces;
    // Pieces already given out on earlier plans count, whether or not their cutting has been recorded yet.
    const given = issuedOn[wo.id] ??= ctx.all('bundles').filter((b) => b.plan && b.plan !== doc.id && b.workOrder === wo.id).reduce((n, b) => n + (b.pieces || 0), 0);
    const taken = Math.max(wo.cut || 0, given);
    if (taken + planned[wo.id] > wo.qty) ctx.fail(`${wo.no} is for ${qty(wo.qty)} pieces and ${qty(taken)} are already cut or with masters; this plan asks for ${qty(planned[wo.id])} more. Lower the pieces.`);
    const style = ctx.get('styles', wo.style);
    const row = { workOrder: wo.id, master: String(line.master || '').trim(), pieces: line.pieces, need: 0, have: 0, ok: '', take: [] };
    if (!row.master) ctx.fail(`Line ${i + 1} (${wo.no}) needs the master who will cut it.`);
    if (!style?.fabric || !(style.metres > 0)) { row.ok = 'No fabric per piece on the style'; return row; }
    row.need = round(line.pieces * style.metres, 1);
    // A style with a shade cuts from dyed rolls of that shade; one without cuts from any passed roll of its fabric.
    const usable = [...free.values()].filter((f) => f.left > 0 && f.roll.item === style.fabric && (!f.roll.reservedFor || f.roll.reservedFor === wo.id) && (style.shade ? f.roll.status === 'dyed' && same(f.roll.shade, style.shade) : true));
    row.have = round(usable.reduce((s, f) => s + f.left, 0), 1);
    if (row.have + 1e-6 < row.need) { row.ok = `Short by ${qty(row.need - row.have)} m`; return row; }
    let want = row.need;
    for (const f of usable) { const t = Math.min(f.left, want); if (t <= 0) continue; f.left = round(f.left - t, 2); want = round(want - t, 2); row.take.push({ roll: f.roll, metres: t }); if (want <= 0) break; }
    row.ok = 'Ready';
    return row;
  });
}
const publicCheck = (rows) => rows.map(({ take, ...r }) => r);

export const FLOOR_ACTIONS = {
  // ── Fabric that never comes through Deme's own dock ──
  /** Pass a roll on the strength of the mill's QC report, without Deme inspecting it again. */
  'roll.accept': {
    run(ctx, _p, doc) {
      const grn = doc.grn ? ctx.get('goods_receipts', doc.grn) : null;
      if (grn?.millReport !== 'ok') ctx.fail(`No mill QC report is recorded on ${grn ? `receipt ${grn.no}` : 'this roll\'s receipt'}. Record the report on the receipt, or inspect the roll.`);
      doc.checkedBy = 'mill';
      ctx.setStatus('rolls', doc, 'passed', `Roll ${doc.no} accepted on the mill's QC report`);
      return { message: `Roll ${doc.no} is accepted on the mill's report.` };
    },
  },
  'claim.credit': { run(ctx, { creditNote }, doc) { Object.assign(doc, { creditNote, closedOn: ctx.today }); ctx.setStatus('claims', doc, 'credited', `Claim ${doc.no}: credit note ${creditNote} received`); return { message: `Claim ${doc.no} is closed with credit note ${creditNote}.` }; } },
  'claim.replaced': { run(ctx, _p, doc) { doc.closedOn = ctx.today; ctx.setStatus('claims', doc, 'replaced', `Claim ${doc.no}: replacement fabric received`); return { message: `Claim ${doc.no} is closed: replacement received.` }; } },
  'claim.drop': {
    run(ctx, { note }, doc) {
      Object.assign(doc, { note, closedOn: ctx.today });
      // The supplier will not pay, so the debit note is reversed and the cost becomes Deme's.
      const s = ctx.get('suppliers', doc.supplier);
      if (s) ctx.voucher({ type: 'Journal', party: s.name, dr: 'Fabric Loss: Post-Dye Defects', cr: ctx.ledgerOf('suppliers', s.id), amount: doc.amount, narration: `Claim ${doc.no} dropped: ${note}`, ref: doc.no });
      ctx.setStatus('claims', doc, 'dropped', `Claim ${doc.no} dropped: ${note}`);
      return { message: `Claim ${doc.no} is dropped. ${rupees(doc.amount || 0)} is booked as a loss.` };
    },
  },

  // ── The dye house reports from a phone ──
  /** The dye lots a person may report on: their own dye house's for an outside login, every open one for Deme's people. */
  'fabric.myLots': {
    module: 'quality', level: 'scan',
    run(ctx) {
      const me = ctx.get('users', ctx.user.id) || ctx.user;
      const outside = ctx.user.role === 'dyer';
      if (outside && !me.supplier) ctx.fail('This login is not linked to a dye house yet. Ask Deme to link it.');
      const lots = ctx.all('dye_lots').filter((l) => l.status === 'at_dyer' && (!outside || l.dyer === me.supplier))
        .map((l) => ({ id: l.id, no: l.no, shade: l.shade, dyer: ctx.title('suppliers', l.dyer), sentOn: l.sentOn, dueBack: l.dueBack, rolls: (l.rolls || []).map((id) => ctx.get('rolls', id)).filter(Boolean).map((r) => ({ id: r.id, no: r.no, metres: r.metres })) }));
      // Rolls delivered straight to the dye house and not yet on a lot.
      const waiting = ctx.all('rolls').filter((r) => r.heldAt && ['received', 'passed'].includes(r.status) && (!outside || r.heldAt === me.supplier)).map((r) => ({ id: r.id, no: r.no, metres: r.metres, status: r.status, fabric: ctx.title('items', r.item) }));
      return { message: null, data: { lots, waiting, reasons: FABRIC_REASONS } };
    },
  },
  /** Report a problem seen on fabric. Photos are attached to the report afterwards. */
  'fabric.report': {
    module: 'quality', level: 'scan',
    run(ctx, { dyeLot, roll, reason, note, stage }) {
      const me = ctx.get('users', ctx.user.id) || ctx.user;
      const lot = dyeLot ? ctx.get('dye_lots', dyeLot) : null, r = roll ? ctx.get('rolls', roll) : null;
      if (!lot && !r) ctx.fail('Choose the dye lot or the roll the problem is on.');
      if (ctx.user.role === 'dyer' && ((lot && lot.dyer !== me.supplier) || (r && !lot && r.heldAt !== me.supplier))) ctx.fail('That fabric is not at your dye house.');
      if (!REASON[reason]) ctx.fail('Choose what is wrong.');
      const doc = ctx.put('fabric_reports', { date: ctx.today, dyeLot: lot?.id, roll: r?.id, supplier: me.supplier || lot?.dyer || r?.heldAt, stage: stage === 'before' ? 'before' : 'after', reason, note: String(note || '').trim() || undefined, by: ctx.user.id, photos: 0 });
      const where = lot ? `dye lot ${lot.no}` : `roll ${r.no}`, what = `${REASON[reason]} on ${where}`;
      ctx.log('fabric_reports', doc.id, 'created', `Problem report ${doc.no}: ${what}`);
      for (const to of holders(ctx, ['qc', 'stores', 'dyecheck', 'merch'])) ctx.notify(to, `${ctx.user.name} reports ${REASON[reason].toLowerCase()} on ${where}`, 'e-fabric-reports');
      return { message: `Report ${doc.no} is sent.`, data: { report: doc.id, no: doc.no } };
    },
  },
  'report.seen': { run(ctx, _p, doc) { ctx.setStatus('fabric_reports', doc, 'seen'); return { message: `Report ${doc.no} is marked as seen.` }; } },
  'report.close': { run(ctx, _p, doc) { ctx.setStatus('fabric_reports', doc, 'closed'); return { message: `Report ${doc.no} is closed.` }; } },

  // ── Tomorrow's cutting, planned against fabric that is really there ──
  'plan.check': {
    run(ctx, _p, doc) {
      const rows = fabricCheck(ctx, doc);
      Object.assign(doc, { check: publicCheck(rows), ready: rows.filter((r) => r.ok === 'Ready').length, short: rows.filter((r) => r.ok !== 'Ready').length });
      ctx.put('day_plans', doc);
      return { message: doc.short ? `${count(doc.ready, 'line has', 'lines have')} fabric. ${count(doc.short, 'line does', 'lines do')} not: do not give those slips out.` : `All ${count(doc.ready, 'line')} have fabric in the store.` };
    },
  },
  'plan.issue': {
    run(ctx, _p, doc) {
      const rows = fabricCheck(ctx, doc), ready = rows.filter((r) => r.ok === 'Ready');
      if (!ready.length) ctx.fail('No line on this plan has fabric in the store. Nothing can be issued. Check what is at the dye house, or change the plan.');
      let metres = 0;
      for (const row of ready) {
        const wo = ctx.get('work_orders', row.workOrder);
        for (const t of row.take) {
          const roll = ctx.get('rolls', t.roll.id);
          roll.left = round(leftOn(roll) - t.metres, 2);
          // What is left on a part-used roll stays free for the next order.
          if (roll.left <= 0.05) { roll.left = 0; roll.reservedFor = roll.reservedFor || wo.id; ctx.setStatus('rolls', roll, 'issued', `Roll ${roll.no} used up on ${wo.no}`); } else ctx.put('rolls', roll);
        }
        ctx.put('bundles', { workOrder: wo.id, pieces: row.pieces, master: row.master, metres: row.need, fromRolls: row.take.map((t) => `${t.roll.no} (${qty(t.metres)} m)`).join(', '), plan: doc.id });
        metres += row.need;
        if (wo.status === 'planned') ctx.setStatus('work_orders', wo, 'released', `Work order ${wo.no} released by day plan ${doc.no}`);
      }
      const short = rows.filter((r) => r.ok !== 'Ready');
      Object.assign(doc, { check: publicCheck(rows), ready: ready.length, short: short.length, planner: ctx.user.id });
      ctx.setStatus('day_plans', doc, 'issued', `Day plan ${doc.no} for ${doc.date}: ${count(ready.length, 'bundle')}, ${qty(metres)} m${short.length ? `; ${count(short.length, 'line')} left out for want of fabric` : ''}`);
      for (const to of holders(ctx, ['runner', 'stores'])) ctx.notify(to, `Bundling list for ${doc.date}: ${count(ready.length, 'bundle')}, ${qty(metres)} m to cut and hand out`, `e-day-plans`);
      return { message: `Plan for ${doc.date} is issued: ${count(ready.length, 'bundle')}, ${qty(metres)} m set aside.${short.length ? ` ${count(short.length, 'line was', 'lines were')} left out: no fabric.` : ''}`, data: { bundles: ready.length, short: short.length } };
    },
  },

  // ── Work made by production vendors ──
  'wo.sendOut': {
    run(ctx, { vendor, qcAt, backBy }, doc) {
      const v = ctx.get('suppliers', vendor) || ctx.fail('Choose the vendor.');
      if ((doc.cut || 0) > 0) ctx.fail(`${doc.no} has already been cut in-house. Finish it here, or raise a new work order for the vendor.`);
      Object.assign(doc, { madeBy: 'vendor', vendor: v.id, qcAt: qcAt === 'vendor' ? 'vendor' : 'inhouse', backBy: backBy || doc.backBy, sentOn: ctx.today });
      ctx.setStatus('work_orders', doc, 'at_vendor', `Work order ${doc.no} sent to ${v.name}`);
      return { message: `${doc.no} is with ${v.name}${v.city ? `, ${v.city}` : ''}. ${doc.qcAt === 'vendor' ? 'It will be checked there and shipped from there.' : 'It comes back here for QC.'}` };
    },
  },
  /** Pieces came back from the vendor, stitched and finished. In-house QC and packing follow as usual. */
  'wo.vendorBack': {
    run(ctx, { pieces }, doc) {
      if (!(pieces > 0) || !Number.isInteger(pieces)) ctx.fail('Enter the pieces received as a whole number above zero.');
      const total = (doc.finish || 0) + pieces;
      if (total > doc.qty) ctx.fail(`${doc.no} is for ${qty(doc.qty)} pieces and ${qty(doc.finish || 0)} are already back; ${qty(pieces)} more is too many.`);
      Object.assign(doc, { cut: total, stitch: total, finish: total });
      ctx.setStatus('work_orders', doc, total >= doc.qty ? 'in_progress' : 'at_vendor', `Work order ${doc.no}: ${qty(pieces)} pieces back from the vendor, ${qty(total)} of ${qty(doc.qty)}`);
      for (const to of holders(ctx, ['qc'])) ctx.notify(to, `${qty(pieces)} pieces of ${doc.no} are back from the vendor and wait for QC`, 'e-work-orders');
      return { message: `${qty(pieces)} pieces of ${doc.no} are back: ${qty(total)} of ${qty(doc.qty)}. They now go to final QC here.` };
    },
  },
  /** Deme's QC at the vendor passed and packed pieces there; they ship from the vendor. */
  'wo.vendorPassed': {
    run(ctx, { pieces, rejected = 0 }, doc) {
      if (doc.qcAt !== 'vendor') ctx.fail(`${doc.no} is checked in-house. Record it as received from the vendor instead.`);
      if (!(pieces >= 0) || !Number.isInteger(pieces) || !(rejected >= 0)) ctx.fail('Enter whole numbers of pieces.');
      if (pieces + rejected < 1) ctx.fail('Enter the pieces checked.');
      const total = (doc.pack || 0) + pieces;
      if (total > doc.qty) ctx.fail(`${doc.no} is for ${qty(doc.qty)} pieces and ${qty(doc.pack || 0)} are already passed; ${qty(pieces)} more is too many.`);
      ctx.put('qc_checks', { date: ctx.today, workOrder: doc.id, stage: 'final', checked: pieces + rejected, passed: pieces, rejected, checker: ctx.user.id, defects: rejected ? 'Checked at the vendor' : undefined });
      Object.assign(doc, { cut: total, stitch: total, finish: total, qc: total, pack: total });
      const done = total >= doc.qty;
      ctx.setStatus('work_orders', doc, done ? 'done' : 'at_vendor', `Work order ${doc.no}: ${qty(pieces)} passed at the vendor${rejected ? `, ${qty(rejected)} rejected` : ''}; ${qty(total)} of ${qty(doc.qty)}`);
      for (const to of holders(ctx, ['logistics', 'dispatch', 'prod_b2b'])) ctx.notify(to, `${qty(pieces)} pieces of ${doc.no} passed QC at the vendor and are ready to ship from there`, 'e-work-orders');
      return { message: `${qty(pieces)} pieces of ${doc.no} passed at the vendor${rejected ? ` and ${qty(rejected)} were rejected` : ''}. ${done ? 'The work order is done; it ships from the vendor.' : `${qty(doc.qty - total)} to go.`}` };
    },
  },

  // ── Paperwork before a parcel leaves, and pieces that come back ──
  'parcel.papers': {
    run(ctx, { invoiceNo, value, ewayNo }, doc) {
      Object.assign(doc, { invoiceNo: String(invoiceNo || '').trim(), value: value ?? doc.value, ewayNo: String(ewayNo || '').trim() || doc.ewayNo, papersBy: ctx.user.id });
      const missing = papersMissing(doc);
      if (missing) ctx.fail(missing.replace(' The office adds it under Parcels; then scan again.', '').replace(' The office adds it under Parcels.', ' Add it here.'));
      ctx.put('parcels', doc); ctx.log('parcels', doc.id, 'papers', `Paperwork added for parcel ${doc.no}: invoice ${doc.invoiceNo}${doc.ewayNo ? `, e-way bill ${doc.ewayNo}` : ''}`);
      for (const to of holders(ctx, ['dispatch', 'logistics'])) ctx.notify(to, `Paperwork is ready for parcel ${doc.barcode} (${doc.ref}): print it, attach it, ship`, 'e-parcels');
      return { message: `Paperwork for ${doc.no} is in. The factory can print it and ship.` };
    },
  },
  'ret.sold': {
    run(ctx, { amount, where }, doc) {
      if (!(amount >= 0)) ctx.fail('Enter what it was sold for.');
      ctx.voucher({ type: 'Sales', party: where || 'Resale of returns', dr: 'Bank Account', cr: 'Store Sales', amount, narration: `Returned piece ${doc.no} sold on${where ? ` through ${where}` : ''}`, ref: doc.no });
      ctx.setStatus('returns', doc, 'sold', `Return ${doc.no} sold on for ${rupees(amount)}`);
      return { message: `Return ${doc.no} is sold on for ${rupees(amount)}.` };
    },
  },
};
