// The business transactions of the ERP: what happens when someone presses a button on a record,
// scans a bundle or a parcel, or checks in. The service (service.js) checks access, loads the record,
// checks its status and coerces the form, then calls `run(ctx, payload, doc)` here inside one
// transaction, so a rule that fails part-way leaves nothing behind.
//
// Record actions are declared on their entity in schema.js (label, `when`, form, access).
// Global actions carry their own `module` and `level`. Hooks run after a record is created.
// Runs unchanged in Node and in the browser, and takes its clock from ctx (ctx.now, ctx.today).

import { STAGES, STAGE_NAMES, INSPECTION_PASS_MARK, entityById } from './schema.js';

// ───────── Helpers ─────────
const round = (n, dp = 2) => { const f = 10 ** dp; return Math.round(n * f) / f; };
const qty = (n) => round(Number(n) || 0, 2).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const rupees = (n) => `₹${Math.round(n).toLocaleString('en-IN')}`;
const count = (n, one, many = `${one}s`) => `${qty(n)} ${n === 1 ? one : many}`;
const same = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();
/** Global actions get their payload as typed; this reads a number from it, or NaN. */
const number = (v) => (v === undefined || v === null || v === '' ? NaN : typeof v === 'number' ? v : Number(String(v).replace(/[,₹\s]/g, '')));

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const utc = (isoDate) => new Date(`${isoDate}T00:00:00Z`);
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(+utc(s)) && utc(s).toISOString().slice(0, 10) === s;
const addDays = (isoDate, n) => new Date(+utc(isoDate) + n * 86400000).toISOString().slice(0, 10);
const dayText = (isoDate) => `${Number(isoDate.slice(8, 10))} ${MONTHS[Number(isoDate.slice(5, 7)) - 1]}`;
const minutesBetween = (from, to) => Math.max(0, Math.floor((Date.parse(to) - Date.parse(from)) / 60000));
const span = (mins) => (mins < 1 ? 'under a minute' : mins < 60 ? `${mins} min` : mins < 1440 ? `${Math.floor(mins / 60)} h ${mins % 60} min` : `${Math.floor(mins / 1440)} d ${Math.floor((mins % 1440) / 60)} h`);

/** What a record is called in a message. Where the title field points at another record, use that record's name. */
function nameOf(ctx, entityId, doc) {
  const e = entityById[entityId];
  const field = e.fields.find(([k]) => k === e.title);
  if (field && field[2] === 'ref' && doc[e.title]) return ctx.title(field[3].ref, doc[e.title]) || String(doc[e.title]);
  return String(doc[e.title] ?? doc.no ?? doc.name ?? doc.id);
}

/** An action that only moves a record to another status. */
const step = (entity, status, say) => ({ run(ctx, _payload, doc) { ctx.setStatus(entity, doc, status); return { message: say(nameOf(ctx, entity, doc), doc) }; } });

/** Move a record to the next status in its declared order. `dropped` is never reached this way. */
const forward = (entity) => ({
  run(ctx, _payload, doc) {
    const e = entityById[entity];
    const order = Object.keys(e.statuses).filter((s) => s !== 'dropped');
    const next = order[order.indexOf(doc.status) + 1];
    if (!order.includes(doc.status) || !next) ctx.fail(`${nameOf(ctx, entity, doc)} is already at its last step.`);
    ctx.setStatus(entity, doc, next);
    return { message: `${nameOf(ctx, entity, doc)} moved to ${e.statuses[next].name.toLowerCase()}.` };
  },
});

const PURCHASE_LEDGER = { fabric: 'Fabric Purchases', thread: 'Thread & Trims', trim: 'Thread & Trims', tool: 'Consumables', consumable: 'Consumables' };
const DONE = { cut: 'cut', stitch: 'stitched', finish: 'finished', qc: 'passed by QC', pack: 'packed' };
const NOT_DYEABLE = {
  received: 'has not passed inspection. Inspect it first, or take it off this lot',
  rejected: 'was rejected at inspection. Take it off this lot',
  returned: 'was returned to the mill. Take it off this lot',
  at_dyer: 'is already at the dyer. Take it off this lot',
  dyed: 'is already dyed. Take it off this lot',
  dye_reject: 'failed after dyeing. Take it off this lot',
  issued: 'is already issued to cutting. Take it off this lot',
};
const LEAVE_TYPES = ['Casual', 'Sick', 'Earned', 'Unpaid'];

const bankLedger = (ctx, id) => (id && ctx.get('ledgers', id)?.name) || 'Bank Account';
const employeeOf = (ctx) => ctx.all('employees').find((e) => e.login === ctx.user.id) || ctx.fail('Your login is not linked to an employee record yet. Ask HR to link it.');
const parcelWith = (ctx, barcode) => ctx.all('parcels').find((p) => same(p.barcode, barcode));

function findBundle(ctx, tag) {
  const key = String(tag ?? '').trim();
  if (!key) ctx.fail('Scan or type the bundle tag.');
  return ctx.get('bundles', key) || ctx.all('bundles').find((b) => same(b.no, key)) || ctx.fail(`No bundle has the tag ${key}. Check the tag and scan again.`);
}
function findItem(ctx, ref) {
  const key = String(ref ?? '').trim();
  if (!key) ctx.fail('Choose the material first.');
  return ctx.get('items', key) || ctx.all('items').find((i) => same(i.code, key) || same(i.name, key)) || ctx.fail(`No material is called "${key}". Check the code.`);
}

// ───────── The scan gate, by kind of parcel ─────────
// Each returns { direction, message } after saving the parcel with its new event and status.
// What an online order is worth in rupees: stated when it came in, or worked out now from the newest rate.
const rupeesOf = (ctx, order) => (order.currency && order.currency !== 'INR' ? order.amountInr ?? ctx.toInr(order.amount || 0, order.currency, order.date) ?? ctx.fail(`Order ${order.orderNo} is in ${order.currency} and there is no exchange rate for it yet. Add one under Finance, then scan again.`) : order.amount);
function gateShopify(ctx, parcel, note, event) {
  const order = ctx.all('shop_orders').find((o) => o.orderNo === parcel.ref);
  if (parcel.status === 'packed') {
    event('out', 'Scanned out at the gate');
    ctx.setStatus('parcels', parcel, 'in_transit');
    if (!order) return { direction: 'out', message: `Parcel ${parcel.barcode} is scanned out. No Shopify order ${parcel.ref} was found, so no sale was booked.` };
    ctx.setStatus('shop_orders', order, 'shipped');
    const sale = ctx.voucher({ type: 'Sales', party: 'Shopify', dr: 'Shopify Clearing', cr: 'Online Sales', amount: rupeesOf(ctx, order), narration: `Shopify order ${order.orderNo}`, ref: order.orderNo });
    return { direction: 'out', message: `Order ${order.orderNo} is on its way.${sale ? ` The sale of ${rupees(rupeesOf(ctx, order))} is booked.` : ''}` };
  }
  if (parcel.status === 'at_factory') ctx.fail(`This parcel is already scanned in as a return. Look under Returns for order ${parcel.ref}.`);
  if (!['in_transit', 'delivered', 'returning'].includes(parcel.status)) ctx.fail('This parcel cannot be scanned at the gate right now. Check its trail in Parcels.');
  event('in', note ? `Came back: ${note}` : 'Came back to the factory');
  ctx.setStatus('parcels', parcel, 'at_factory');
  if (!order) return { direction: 'in', message: `Parcel ${parcel.barcode} is scanned in. No Shopify order ${parcel.ref} was found, so no return was opened.` };
  ctx.setStatus('shop_orders', order, 'returned');
  // A return that was logged in advance is picked up rather than doubled.
  const expected = ctx.all('returns').find((r) => r.order === order.id && r.status === 'expected');
  const ret = expected ? ctx.setStatus('returns', { ...expected, condition: note }, 'received') : ctx.put('returns', { order: order.id, date: ctx.today, condition: note, status: 'received' });
  return { direction: 'in', message: `Order ${order.orderNo} is back at the factory. Return ${ret.no} is ready to be checked.` };
}

function gateB2b(ctx, parcel, _note, event) {
  if (parcel.status !== 'packed') ctx.fail(`The cartons for ${parcel.ref} are already scanned out. Use Mark delivered or Add tracking update on the parcel.`);
  event('out', 'Scanned out at the gate');
  ctx.setStatus('parcels', parcel, 'in_transit');
  const order = ctx.all('sales_orders').find((o) => o.no === parcel.ref);
  if (order && order.status === 'confirmed') ctx.setStatus('sales_orders', order, 'shipped');
  return { direction: 'out', message: `The cartons for ${parcel.ref} are scanned out${order && order.status === 'shipped' ? ' and the sales order is marked shipped' : ''}.` };
}

function gateStore(ctx, parcel, note, event, workMinutes) {
  const order = ctx.all('store_orders').find((o) => same(o.tag, parcel.barcode));
  if (parcel.status === 'packed') {
    event('out', 'Sent to the store');
    ctx.setStatus('parcels', parcel, 'at_store');
    if (order) ctx.setStatus('store_orders', order, 'at_store');
    return { direction: 'out', message: `Store piece ${parcel.barcode} is scanned out to the store.` };
  }
  if (parcel.status === 'at_store') {
    event('in', note ? `Back for fit: ${note}` : 'Back for fit');
    ctx.setStatus('parcels', parcel, 'at_factory');
    if (!order) return { direction: 'in', message: `Store piece ${parcel.barcode} is scanned in. No store order has this tag, so no fit visit was counted.` };
    order.visits = (order.visits || 0) + 1;
    ctx.setStatus('store_orders', order, 'at_factory');
    ctx.put('fit_visits', { storeOrder: order.id, visitNo: order.visits, inAt: ctx.now, note });
    return { direction: 'in', message: `Store piece ${parcel.barcode} is in for fit visit ${order.visits}.` };
  }
  if (parcel.status !== 'at_factory') ctx.fail('This store piece cannot be scanned at the gate right now. Check its trail in Parcels.');
  const visit = order && ctx.all('fit_visits').filter((v) => v.storeOrder === order.id && !v.outAt).sort((a, b) => String(b.inAt).localeCompare(String(a.inAt)))[0];
  const cameIn = visit?.inAt || [...(parcel.events || [])].reverse().find((e) => e.type === 'in')?.at || ctx.now;
  const stayed = span(minutesBetween(cameIn, ctx.now));
  event('out', `Sent back to the store after ${stayed} at the factory`);
  ctx.setStatus('parcels', parcel, 'at_store');
  if (visit) { visit.outAt = ctx.now; if (workMinutes >= 0) visit.workMinutes = workMinutes; ctx.put('fit_visits', visit); }
  if (order) ctx.setStatus('store_orders', order, 'at_store');
  return { direction: 'out', message: `Store piece ${parcel.barcode} is going back to the store after ${stayed} at the factory.` };
}

// ───────── Actions ─────────
export const ACTIONS = {
  // ── Purchasing ──
  'po.approve': step('purchase_orders', 'approved', (no) => `Purchase order ${no} is approved.`),
  'po.send': step('purchase_orders', 'sent', (no) => `Purchase order ${no} is marked as sent.`),
  'po.cancel': step('purchase_orders', 'cancelled', (no) => `Purchase order ${no} is cancelled.`),

  'grn.post': {
    run(ctx, _payload, doc) {
      const supplier = ctx.get('suppliers', doc.supplier) || ctx.fail('This receipt has no supplier. Choose the supplier, then post again.');
      const lines = doc.lines || [];
      if (!lines.length) ctx.fail('This receipt has no lines. Add what arrived, then post again.');
      // Ready-for-dyeing fabric is usually delivered by the mill straight to the dye house.
      const toDyer = doc.deliveredTo === 'dyer';
      const dyer = toDyer ? ctx.get('suppliers', doc.dyer) || ctx.fail('Choose which dye house the mill delivered to, then post again.') : null;
      const byLedger = {};
      let total = 0, rolls = 0, stocked = 0;
      lines.forEach((line, i) => {
        const item = ctx.get('items', line.item) || ctx.fail(`Line ${i + 1} has no material. Choose the material, then post again.`);
        if (!(line.qty > 0)) ctx.fail(`Line ${i + 1} (${item.name}) needs a quantity above zero.`);
        if (item.kind === 'fabric') {
          const n = Math.max(1, Math.round(line.rolls || 1));
          if (n > 500) ctx.fail(`Line ${i + 1} (${item.name}) says ${qty(n)} rolls. Check the number of rolls; one line takes up to 500.`);
          const metres = round(line.qty / n, 1);
          for (let r = 0; r < n; r++) ctx.put('rolls', { item: item.id, supplier: doc.supplier, metres, left: metres, grn: doc.id, receivedOn: doc.date || ctx.today, location: dyer ? `At ${dyer.name}` : 'Dock', heldAt: dyer?.id });
          rolls += n;
        } else {
          ctx.move(item.id, line.qty, 'receipt', doc.no);
          stocked++;
        }
        const amount = line.qty * (line.rate || 0);
        const ledger = PURCHASE_LEDGER[item.kind] || 'Consumables';
        byLedger[ledger] = (byLedger[ledger] || 0) + amount;
        total += amount;
      });
      const cr = ctx.ledgerOf('suppliers', doc.supplier);
      for (const [dr, amount] of Object.entries(byLedger)) {
        ctx.voucher({ type: 'Purchase', party: supplier.name, dr, cr, amount, narration: `Goods receipt ${doc.no} from ${supplier.name}${doc.invoiceNo ? `, invoice ${doc.invoiceNo}` : ''}`, ref: doc.no });
      }
      const bill = ctx.bill(doc.supplier, doc.no, round(total));

      const po = doc.po ? ctx.get('purchase_orders', doc.po) : null;
      if (po) {
        const got = {}, ordered = {};
        const receipts = [doc, ...ctx.all('goods_receipts').filter((g) => g.po === po.id && g.status === 'posted' && g.id !== doc.id)];
        for (const g of receipts) for (const l of g.lines || []) got[l.item] = (got[l.item] || 0) + (l.qty || 0);
        for (const l of po.lines || []) ordered[l.item] = (ordered[l.item] || 0) + (l.qty || 0);
        const covered = Object.keys(ordered).every((item) => (got[item] || 0) >= ordered[item] - 1e-9);
        ctx.setStatus('purchase_orders', po, covered ? 'received' : 'part_received');
      }
      ctx.setStatus('goods_receipts', doc, 'posted');

      const parts = [];
      if (rolls) parts.push(`${count(rolls, 'roll is', 'rolls are')} ${dyer ? `at ${dyer.name}, to be checked there${doc.millReport === 'ok' ? ' or accepted on the mill\'s report' : ''}` : 'waiting for inspection'}`);
      if (stocked) parts.push(`${count(stocked, 'material is', 'materials are')} added to stock`);
      if (bill) parts.push(`a bill of ${rupees(total)} is open`);
      return { message: `Receipt ${doc.no} is posted: ${parts.join(', ')}.` };
    },
  },

  // ── Inventory ──
  'roll.inspect': {
    run(ctx, { points, defects = '', reason }, doc) {
      if (!(points >= 0)) ctx.fail('Enter the penalty points as zero or more.');
      const pass = points <= INSPECTION_PASS_MARK;
      ctx.put('inspections', { date: ctx.today, roll: doc.id, points, result: pass ? 'pass' : 'fail', defects, inspector: ctx.user.id });
      doc.points = points; doc.defects = defects; doc.checkedBy = doc.heldAt ? 'dyehouse' : 'store';
      if (!pass && reason) doc.reason = reason;
      if (pass) {
        ctx.setStatus('rolls', doc, 'passed');
        return { message: `Roll ${doc.no} passed inspection with ${qty(points)} points.` };
      }
      ctx.setStatus('rolls', doc, 'rejected');
      let claim = '';
      const supplier = doc.supplier ? ctx.get('suppliers', doc.supplier) : null;
      if (supplier) {
        const item = ctx.get('items', doc.item);
        const amount = round((doc.metres || 0) * (item?.cost || 0));
        // The mill answers for it: a claim stays open until the credit note or the replacement arrives.
        const opened = openClaim(ctx, { supplier: supplier.id, against: 'mill', stage: 'before', rolls: [doc], reason, metres: doc.metres || 0, amount, note: defects });
        if (opened && amount > 0) {
          claim = ` Claim ${opened.no} for ${rupees(amount)} is open on ${supplier.name}.`;
          const grn = doc.grn ? ctx.get('goods_receipts', doc.grn) : null;
          const bill = grn && ctx.all('bills').find((b) => b.ref === grn.no && ['unpaid', 'part_paid'].includes(b.status));
          if (bill) {
            bill.amount = Math.max(bill.paid || 0, round(bill.amount - amount));
            // Nothing left to pay once the claim covers the rest of the bill.
            if (bill.amount <= (bill.paid || 0)) ctx.setStatus('bills', bill, 'paid', `Bill ${bill.no}: nothing left to pay after the claim for roll ${doc.no}`);
            else ctx.put('bills', bill);
          }
        }
      }
      return { message: `Roll ${doc.no} failed inspection with ${qty(points)} points; ${INSPECTION_PASS_MARK} or under passes.${claim}` };
    },
  },
  'roll.return': step('rolls', 'returned', (no) => `Roll ${no} is marked as returned to the mill.`),
  'roll.issue': {
    run(ctx, { workOrder }, doc) {
      const wo = ctx.get('work_orders', workOrder) || ctx.fail('Choose the work order this roll is for.');
      doc.reservedFor = wo.id; doc.left = 0;
      ctx.setStatus('rolls', doc, 'issued');
      return { message: `Roll ${doc.no} is issued to cutting for ${wo.no}.` };
    },
  },
  'count.post': {
    run(ctx, _payload, doc) {
      let changed = 0;
      (doc.lines || []).forEach((line, i) => {
        const item = ctx.get('items', line.item) || ctx.fail(`Line ${i + 1} has no material. Choose the material, then post again.`);
        if (!(line.counted >= 0)) ctx.fail(`Enter the counted quantity for ${item.name} (0 if there is none), then post again.`);
        const diff = round(line.counted - (item.onHand || 0), 3);
        if (diff !== 0) { ctx.move(item.id, diff, 'count', doc.no, doc.area || ''); changed++; }
      });
      ctx.setStatus('stock_counts', doc, 'posted');
      return { message: changed ? `Count ${doc.no} is posted. ${count(changed, 'material was', 'materials were')} corrected.` : `Count ${doc.no} is posted. Stock already matched the count.` };
    },
  },

  // ── Quality ──
  'dye.send': {
    run(ctx, _payload, doc) {
      const ids = [...new Set(doc.rolls || [])];
      if (!ids.length) ctx.fail('This dye lot has no rolls. Add passed rolls, then send it.');
      const rolls = ids.map((id) => ctx.get('rolls', id) || ctx.fail('A roll on this lot no longer exists. Take it off the lot, then send again.'));
      for (const roll of rolls) {
        if (roll.status !== 'passed') ctx.fail(`Roll ${roll.no} ${NOT_DYEABLE[roll.status] || 'cannot be dyed. Take it off this lot'}, then send again.`);
        if (roll.item !== rolls[0].item) ctx.fail(`Roll ${roll.no} is ${ctx.title('items', roll.item)}, but this lot is ${ctx.title('items', rolls[0].item)}. Put it on its own dye lot.`);
      }
      for (const roll of rolls) {
        Object.assign(roll, { dyeLot: doc.id, shade: doc.shade, location: 'Dye house' });
        ctx.setStatus('rolls', roll, 'at_dyer');
      }
      doc.rolls = ids; doc.sentOn = ctx.today;
      ctx.setStatus('dye_lots', doc, 'at_dyer');
      const metres = rolls.reduce((s, r) => s + (r.metres || 0), 0);
      return { message: `Dye lot ${doc.no} is sent to ${ctx.title('suppliers', doc.dyer)}: ${count(rolls.length, 'roll')}, ${qty(metres)} m, shade ${doc.shade}.` };
    },
  },
  'dye.receive': {
    run(ctx, payload, doc) {
      const failed = [...new Set(Array.isArray(payload.failed) ? payload.failed : [])];
      const note = payload.note || '';
      // Whose fault a failure is decides where the cost goes: the mill, the dye house, or the business itself.
      const fault = ['mill', 'dyer'].includes(payload.fault) ? payload.fault : 'none';
      const bad = [];
      for (const id of failed) if (!(doc.rolls || []).includes(id)) ctx.fail(`Roll ${ctx.title('rolls', id) || id} is not on this dye lot. Choose the failed rolls from this lot only.`);
      let accepted = 0, lost = 0, item = null;
      for (const id of doc.rolls || []) {
        const roll = ctx.get('rolls', id);
        if (!roll) continue;
        item ||= ctx.get('items', roll.item);
        if (failed.includes(id)) {
          lost += roll.metres || 0; bad.push(roll);
          if (note) roll.defects = note;
          if (payload.reason) roll.reason = payload.reason;
          // A fabric fault goes back to the mill like any rejected roll.
          ctx.setStatus('rolls', roll, fault === 'mill' ? 'rejected' : 'dye_reject');
        } else {
          accepted += roll.metres || 0;
          roll.location = 'Fabric store'; delete roll.heldAt;
          ctx.setStatus('rolls', roll, 'dyed');
        }
      }
      accepted = round(accepted); lost = round(lost);
      Object.assign(doc, { acceptedMetres: accepted, failedMetres: lost, receivedOn: ctx.today });
      const dyer = ctx.title('suppliers', doc.dyer);
      const dyeCost = item?.dyeCost || 0;
      const charge = round(accepted * dyeCost);
      if (charge > 0) {
        ctx.voucher({ type: 'Purchase', party: dyer, dr: 'Dyeing Charges', cr: ctx.ledgerOf('suppliers', doc.dyer), amount: charge, narration: `Dyeing ${qty(accepted)} m of ${item.name} in ${doc.shade}, lot ${doc.no}`, ref: doc.no });
        ctx.bill(doc.dyer, doc.no, charge);
      }
      let claimed = '';
      if (failed.length && fault !== 'none') {
        const on = fault === 'mill' ? bad[0]?.supplier : doc.dyer;
        const opened = openClaim(ctx, { supplier: on, against: fault, stage: 'after', rolls: bad, dyeLot: doc.id, reason: payload.reason, metres: lost, amount: round(lost * (item?.cost || 0)), note });
        if (opened) claimed = ` Claim ${opened.no} is open on ${ctx.title('suppliers', on)}.`;
      }
      if (failed.length && !claimed) {
        ctx.voucher({ type: 'Journal', party: dyer, dr: 'Fabric Loss: Post-Dye Defects', cr: 'Stock: Dyed Fabric', amount: lost * ((item?.cost || 0) + dyeCost), narration: `${qty(lost)} m failed after dyeing, lot ${doc.no}${note ? `: ${note}` : ''}`, ref: doc.no });
      }
      ctx.setStatus('dye_lots', doc, 'received');
      return { message: `Dye lot ${doc.no} is received: ${qty(accepted)} m accepted${failed.length ? `, ${qty(lost)} m failed` : ''}.${charge > 0 ? ` ${dyer} is billed ${rupees(charge)}.` : ''}${claimed}` };
    },
  },

  // ── Production ──
  'wo.release': step('work_orders', 'released', (no) => `Work order ${no} is released to the floor.`),
  'wo.hold': step('work_orders', 'hold', (no) => `Work order ${no} is on hold.`),
  'wo.output': {
    run(ctx, { stage, pieces }, doc) {
      const at = STAGES.indexOf(stage);
      if (at < 0) ctx.fail('Choose the stage the pieces were finished at.');
      if (!(pieces > 0) || !Number.isInteger(pieces)) ctx.fail('Enter the pieces finished as a whole number above zero.');
      const done = doc[stage] || 0, total = done + pieces;
      if (total > doc.qty) {
        ctx.fail(done >= doc.qty ? `All ${qty(doc.qty)} pieces of ${doc.no} are already ${DONE[stage]}.`
          : `${doc.no} is for ${qty(doc.qty)} pieces${done ? ` and ${qty(done)} are already ${DONE[stage]}` : ''}; ${qty(pieces)} more is too many. Enter ${qty(doc.qty - done)} or fewer.`);
      }
      if (at > 0) {
        const before = STAGES[at - 1], ready = doc[before] || 0;
        if (total > ready) ctx.fail(`Only ${qty(ready)} pieces are ${DONE[before]}; ${qty(total)} cannot be ${DONE[stage]} yet. Record the ${STAGE_NAMES[before].toLowerCase()} output first.`);
      }
      doc[stage] = total;
      const finished = (doc.pack || 0) >= doc.qty;
      ctx.setStatus('work_orders', doc, finished ? 'done' : 'in_progress', `Work order ${doc.no}: ${qty(pieces)} more ${DONE[stage]}, ${qty(total)} of ${qty(doc.qty)}`);
      return { message: finished ? `Work order ${doc.no} is done: all ${qty(doc.qty)} pieces are packed.` : `${qty(pieces)} pieces recorded for ${doc.no}: ${qty(total)} of ${qty(doc.qty)} are now ${DONE[stage]}.` };
    },
  },
  'wo.bundles': {
    run(ctx, { count: n, pieces }, doc) {
      if (!Number.isInteger(n) || n < 1) ctx.fail('Enter the number of bundles as a whole number, 1 or more.');
      if (n > 500) ctx.fail('Up to 500 bundles can be made at a time. Enter 500 or fewer.');
      if (!Number.isInteger(pieces) || pieces < 1) ctx.fail('Enter the pieces in each bundle as a whole number, 1 or more.');
      const made = [];
      for (let i = 0; i < n; i++) made.push(ctx.put('bundles', { workOrder: doc.id, pieces }));
      ctx.log('work_orders', doc.id, 'bundles', `Work order ${doc.no}: ${count(n, 'bundle')} of ${qty(pieces)} pieces made`);
      return { message: `${count(n, 'bundle')} of ${qty(pieces)} pieces made for ${doc.no}: ${n === 1 ? made[0].no : `${made[0].no} to ${made[n - 1].no}`}.`, data: { bundles: made.map((b) => ({ id: b.id, no: b.no })) } };
    },
  },
  'sample.approve': {
    run(ctx, _payload, doc) {
      const wo = ctx.put('work_orders', { channel: 'SAMPLE', style: doc.style, qty: doc.qty, due: doc.neededBy, source: doc.no });
      ctx.setStatus('sample_requests', doc, 'approved');
      return { message: `Sample request ${doc.no} is approved. Work order ${wo.no} is raised for ${count(doc.qty, 'piece')}.` };
    },
  },
  'sample.decline': step('sample_requests', 'declined', (no) => `Sample request ${no} is declined.`),
  'maint.close': {
    run(ctx, _payload, doc) {
      ctx.setStatus('maintenance', doc, 'closed');
      const machine = ctx.get('machines', doc.machine);
      if (doc.type !== 'breakdown' || !machine) return { message: `Upkeep entry for ${machine?.code || 'the machine'} is closed.` };
      // The machine stays down while another breakdown on it is still open.
      if (ctx.all('maintenance').some((m) => m.id !== doc.id && m.machine === machine.id && m.type === 'breakdown' && m.status === 'open')) {
        return { message: `Breakdown closed. ${machine.code} stays down because another breakdown on it is still open.` };
      }
      machine.status = 'running';
      ctx.put('machines', machine);
      return { message: `Breakdown closed. ${machine.code} is running again.` };
    },
  },

  // ── B2B ──
  'so.confirm': {
    run(ctx, _payload, doc) {
      const lines = doc.lines || [];
      if (!lines.length) ctx.fail('This sales order has no lines. Add the styles and quantities, then confirm.');
      lines.forEach((l, i) => { if (!ctx.get('styles', l.style) || !(l.qty > 0)) ctx.fail(`Line ${i + 1} needs a style and a quantity above zero.`); });
      const raised = lines.map((l) => ctx.put('work_orders', { channel: 'B2B', customer: doc.customer, style: l.style, qty: l.qty, due: doc.shipBy, source: doc.no, madeBy: l.vendor ? 'vendor' : 'inhouse', vendor: l.vendor || undefined }));
      ctx.setStatus('sales_orders', doc, 'confirmed');
      return { message: `Sales order ${doc.no} is confirmed. ${count(raised.length, 'work order is', 'work orders are')} raised: ${raised.map((w) => w.no).join(', ')}.` };
    },
  },
  'so.invoice': {
    run(ctx, _payload, doc) {
      const customer = ctx.get('customers', doc.customer);
      const invoice = ctx.put('invoices', {
        customer: doc.customer, salesOrder: doc.id, date: ctx.today, dueDate: addDays(ctx.today, customer?.terms ?? 30), currency: doc.currency, fx: 1,
        lines: (doc.lines || []).map((l) => ({ ...l })), total: doc.total || 0, received: 0,
      });
      ctx.setStatus('sales_orders', doc, 'invoiced');
      return { message: `Invoice ${invoice.no} is drafted from ${doc.no}.${doc.currency && doc.currency !== 'INR' ? ` Enter the rupees per ${doc.currency} on it before posting.` : ' Check it, then post it.'}` };
    },
  },
  'so.cancel': step('sales_orders', 'cancelled', (no) => `Sales order ${no} is cancelled.`),
  'inv.post': {
    run(ctx, _payload, doc) {
      const customer = ctx.get('customers', doc.customer) || ctx.fail('This invoice has no customer. Choose the customer, then post again.');
      if (!(doc.total > 0)) ctx.fail('This invoice has no value. Add lines with prices, then post again.');
      const foreign = !!doc.currency && doc.currency !== 'INR';
      const cr = !foreign && customer.kind === 'store' ? 'Store Sales' : 'Export Sales';
      // An invoice in another currency is booked at its own rate, or the newest rate on record; never at one for one.
      if (foreign && !(doc.fx > 1)) { const rate = ctx.toInr(1, doc.currency, doc.date); if (!rate) ctx.fail(`Enter the rupees per ${doc.currency} on this invoice, or add an exchange rate under Finance, then post again.`); doc.fx = rate; }
      const amount = doc.total * (doc.fx || 1);
      ctx.voucher({ type: 'Sales', party: customer.name, dr: ctx.ledgerOf('customers', customer.id), cr, amount, narration: `Invoice ${doc.no} to ${customer.name}${foreign ? `: ${doc.currency} ${qty(doc.total)} at ₹${qty(doc.fx || 1)}` : ''}`, ref: doc.no });
      ctx.setStatus('invoices', doc, 'posted');
      return { message: `Invoice ${doc.no} is posted: ${rupees(amount)} is due from ${customer.name}.` };
    },
  },
  'inv.receive': {
    run(ctx, { amount, bank }, doc) {
      if (!(amount > 0)) ctx.fail('Enter the amount received, above zero.');
      const customer = ctx.get('customers', doc.customer);
      ctx.voucher({ type: 'Receipt', party: customer?.name || '', dr: bankLedger(ctx, bank), cr: ctx.ledgerOf('customers', doc.customer), amount: amount * (doc.fx || 1), narration: `Payment received against invoice ${doc.no}`, ref: doc.no });
      doc.received = round((doc.received || 0) + amount);
      const left = round(doc.total - doc.received);
      ctx.setStatus('invoices', doc, left <= 0 ? 'paid' : 'posted', left <= 0 ? undefined : `Invoice ${doc.no}: ${doc.currency || 'INR'} ${qty(amount)} received, ${qty(left)} still due`);
      return { message: left <= 0 ? `Invoice ${doc.no} is paid in full.` : `${doc.currency || 'INR'} ${qty(amount)} received on ${doc.no}. ${doc.currency || 'INR'} ${qty(left)} is still due.` };
    },
  },

  // ── B2C ──
  'shop.pack': {
    run(ctx, { awb, carrier }, doc) {
      const barcode = String(awb ?? '').trim();
      if (!barcode) ctx.fail('Scan or type the tracking barcode on the label.');
      const clash = parcelWith(ctx, barcode);
      if (clash) ctx.fail(`A parcel with the barcode ${barcode} already exists (${clash.no}, order ${clash.ref}). Check the label and scan it again.`);
      const parcel = { kind: 'shopify', ref: doc.orderNo, barcode, dest: doc.country, cartons: 1, events: [{ at: ctx.now, type: 'pack', text: 'Packed, label printed' }] };
      if (carrier) parcel.carrier = carrier;
      ctx.put('parcels', parcel);
      doc.awb = barcode;
      ctx.setStatus('shop_orders', doc, 'packed');
      return { message: `Order ${doc.orderNo} is packed. Scan parcel ${barcode} at the gate when it leaves.` };
    },
  },
  'shop.cancel': step('shop_orders', 'cancelled', (no) => `Order ${no} is cancelled.`),
  'store.close': step('store_orders', 'closed', (no) => `Store order ${no} is closed.`),
  'ret.restock': step('returns', 'restocked', (no) => `Return ${no} is restocked.`),
  'ret.writeoff': step('returns', 'written_off', (no) => `Return ${no} is written off.`),

  // ── Logistics ──
  'parcel.delivered': {
    run(ctx, _payload, doc) {
      doc.events = [...(doc.events || []), { at: ctx.now, type: 'carrier', text: 'Delivered' }];
      ctx.setStatus('parcels', doc, 'delivered');
      const order = doc.kind === 'shopify' && ctx.all('shop_orders').find((o) => o.orderNo === doc.ref);
      if (order) ctx.setStatus('shop_orders', order, 'delivered');
      return { message: `Parcel ${doc.no} is delivered${order ? `, and order ${order.orderNo} with it` : ''}.` };
    },
  },
  'parcel.track': {
    run(ctx, { text }, doc) {
      doc.events = [...(doc.events || []), { at: ctx.now, type: 'carrier', text }];
      ctx.put('parcels', doc);
      ctx.log('parcels', doc.id, 'tracking', `Parcel ${doc.no}: ${text}`);
      return { message: `Tracking update added to parcel ${doc.no}.` };
    },
  },
  'courier.match': {
    run(ctx, _payload, doc) {
      const key = (awb) => String(awb ?? '').trim().toLowerCase();
      const lines = doc.lines || [];
      if (!lines.length) ctx.fail('This invoice has no lines. Add each tracking number and what was billed, then match.');
      const scannedOut = new Set(ctx.all('parcels').filter((p) => (p.events || []).some((e) => e.type === 'out')).map((p) => key(p.barcode)));
      const billedBefore = new Set(ctx.all('courier_invoices').filter((c) => c.id !== doc.id && c.status === 'approved').flatMap((c) => (c.lines || []).map((l) => key(l.awb))));
      const seen = new Set();
      let wrong = 0;
      for (const line of lines) {
        const k = key(line.awb);
        line.match = seen.has(k) || billedBefore.has(k) ? 'Billed twice' : k && scannedOut.has(k) ? 'OK' : 'No parcel scanned out';
        seen.add(k);
        if (line.match !== 'OK') wrong++;
      }
      ctx.setStatus('courier_invoices', doc, wrong ? 'disputed' : 'matched');
      return { message: wrong ? `${wrong} of ${count(lines.length, 'line')} did not match. Check the lines marked on the invoice and take them up with the courier.` : `${lines.length === 1 ? 'The line matches a parcel that was' : `All ${qty(lines.length)} lines match parcels that were`} scanned out. The invoice can be approved.` };
    },
  },
  'courier.approve': {
    run(ctx, _payload, doc) {
      const carrier = ctx.get('suppliers', doc.carrier) || ctx.fail('This invoice has no courier. Choose the courier, then approve again.');
      const total = round(doc.total ?? (doc.lines || []).reduce((s, l) => s + (l.billed || 0), 0));
      if (!(total > 0)) ctx.fail('This invoice has no billed amount. Enter what was billed on each line first.');
      ctx.voucher({ type: 'Purchase', party: carrier.name, dr: 'Freight Outward', cr: ctx.ledgerOf('suppliers', carrier.id), amount: total, narration: `Courier invoice ${doc.invoiceNo} from ${carrier.name}`, ref: doc.invoiceNo });
      ctx.bill(carrier.id, doc.invoiceNo, total);
      ctx.setStatus('courier_invoices', doc, 'approved');
      return { message: `Courier invoice ${doc.invoiceNo} is approved. A bill of ${rupees(total)} is open for ${carrier.name}.` };
    },
  },

  // ── Finance ──
  'voucher.synced': step('vouchers', 'synced', (no) => `Voucher ${no} is marked as in Tally.`),
  'bill.pay': {
    run(ctx, { amount, bank }, doc) {
      if (!(amount > 0)) ctx.fail('Enter the amount paid, above zero.');
      const owed = round((doc.amount || 0) - (doc.paid || 0));
      if (amount > owed) ctx.fail(`Only ${rupees(owed)} is still owed on ${doc.no}; ${rupees(amount)} is too much. Enter ${rupees(owed)} or less.`);
      const supplier = ctx.get('suppliers', doc.supplier);
      ctx.voucher({ type: 'Payment', party: supplier?.name || '', dr: ctx.ledgerOf('suppliers', doc.supplier), cr: bankLedger(ctx, bank), amount, narration: `Payment to ${supplier?.name || 'supplier'} for ${doc.ref || doc.no}`, ref: doc.no });
      doc.paid = round((doc.paid || 0) + amount);
      const left = round(doc.amount - doc.paid);
      ctx.setStatus('bills', doc, left <= 0 ? 'paid' : 'part_paid', left <= 0 ? undefined : `Bill ${doc.no}: ${rupees(amount)} paid, ${rupees(left)} still owed`);
      return { message: left <= 0 ? `Bill ${doc.no} is paid in full.` : `${rupees(amount)} paid on ${doc.no}. ${rupees(left)} is still owed.` };
    },
  },

  // ── People ──
  'leave.approve': step('leaves', 'approved', (who, l) => `Leave for ${who} from ${dayText(l.from)} to ${dayText(l.to)} is approved.`),
  'leave.reject': step('leaves', 'rejected', (who, l) => `Leave for ${who} from ${dayText(l.from)} to ${dayText(l.to)} is rejected.`),
  'payroll.build': {
    run(ctx, _payload, doc) {
      const month = String(doc.month || '').trim();
      const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
      if (!m) ctx.fail('The month must look like 2026-03. Correct it, then build again.');
      const daysInMonth = new Date(Date.UTC(Number(m[1]), Number(m[2]), 0)).getUTCDate();
      const working = []; // the factory runs Monday to Saturday
      for (let d = 1; d <= daysInMonth; d++) { const date = `${month}-${String(d).padStart(2, '0')}`; if (utc(date).getUTCDay() !== 0) working.push(date); }
      const attendance = ctx.all('attendance').filter((a) => String(a.date || '').slice(0, 7) === month);
      const leaves = ctx.all('leaves').filter((l) => l.status === 'approved' && l.type !== 'Unpaid');
      const staff = ctx.all('employees').filter((e) => e.status !== 'left' && e.salary > 0).sort((a, b) => String(a.name).localeCompare(String(b.name)) || String(a.id).localeCompare(String(b.id)));
      if (!staff.length) ctx.fail('No employee has a salary yet. Add salaries in Employees, then build again.');
      const lines = staff.map((emp) => {
        // Paid share of each date, so a day is never counted twice (say, checked in and on leave).
        const paid = {};
        for (const a of attendance) if (a.employee === emp.id) paid[a.date] = Math.max(paid[a.date] || 0, a.status === 'present' ? 1 : a.status === 'half' ? 0.5 : 0);
        for (const l of leaves) if (l.employee === emp.id) for (const date of working) if (date >= l.from && date <= l.to) paid[date] = 1;
        const days = Math.min(working.length, Object.values(paid).reduce((s, x) => s + x, 0));
        return { employee: emp.id, days, gross: Math.round((emp.salary * days) / working.length) };
      });
      doc.month = month; doc.lines = lines; doc.total = lines.reduce((s, l) => s + l.gross, 0);
      ctx.put('payroll_runs', doc);
      ctx.log('payroll_runs', doc.id, 'built', `Payroll ${month} built: ${count(lines.length, 'person', 'people')}, ${rupees(doc.total)}`);
      return { message: `Payroll for ${month} is built: ${count(lines.length, 'person', 'people')}, ${rupees(doc.total)} over ${working.length} working days. Check the lines, then post it.` };
    },
  },
  'payroll.post': {
    run(ctx, _payload, doc) {
      if (!(doc.lines || []).length) ctx.fail('This payroll has no pay lines yet. Build it from attendance first, then post it.');
      if (!(doc.total > 0)) ctx.fail('This payroll adds up to zero. Check attendance for the month, build it again, then post it.');
      if (ctx.all('payroll_runs').some((r) => r.id !== doc.id && r.month === doc.month && r.status === 'posted')) ctx.fail(`Payroll for ${doc.month} is already posted. Delete this run rather than posting the month twice.`);
      ctx.voucher({ type: 'Journal', party: '', dr: 'Salaries & Wages', cr: 'Salaries Payable', amount: doc.total, narration: `Salaries for ${doc.month}, ${count(doc.lines.length, 'person', 'people')}`, ref: `Payroll ${doc.month}` });
      ctx.setStatus('payroll_runs', doc, 'posted');
      return { message: `Payroll for ${doc.month} is posted: ${rupees(doc.total)} in salaries.` };
    },
  },

  // ── Projects, marketing, design ──
  'project.done': step('projects', 'done', (name) => `Project ${name} is done.`),
  'project.pause': step('projects', 'paused', (name) => `Project ${name} is paused.`),
  'project.resume': step('projects', 'active', (name) => `Project ${name} is active again.`),
  'task.start': step('tasks', 'doing', (name) => `Task started: ${name}.`),
  'task.done': step('tasks', 'done', (name) => `Task done: ${name}.`),
  'task.reopen': step('tasks', 'todo', (name) => `Task reopened: ${name}.`),
  'campaign.live': step('campaigns', 'live', (name) => `Campaign ${name} is live.`),
  'campaign.end': step('campaigns', 'ended', (name) => `Campaign ${name} has ended.`),
  'content.next': forward('content'),
  'collection.next': forward('collections'),
  'dev.next': forward('developments'),
  'dev.drop': step('developments', 'dropped', (name) => `${name} is dropped.`),

  // ───────── Global actions ─────────
  // ── Bundle scans at a station ──
  'scan.start': {
    module: 'production', level: 'scan',
    run(ctx, payload) {
      const bundle = findBundle(ctx, payload.bundle);
      if (bundle.status === 'stitching') ctx.fail(`Bundle ${bundle.no} is already being stitched${bundle.station ? ` at ${bundle.station}` : ''}. Scan it as finished when it is done.`);
      if (bundle.status !== 'cut') ctx.fail(`Bundle ${bundle.no} is already stitched. Pick up the next bundle.`);
      const wo = ctx.get('work_orders', bundle.workOrder) || ctx.fail(`Bundle ${bundle.no} has no work order. Tell your line manager.`);
      const station = String(payload.station ?? '').trim();
      Object.assign(bundle, { station, operator: ctx.user.id });
      ctx.setStatus('bundles', bundle, 'stitching');
      ctx.put('scans', { bundle: bundle.id, workOrder: wo.id, style: wo.style, station, operator: ctx.user.id, startedAt: ctx.now, pieces: bundle.pieces });
      if (wo.status === 'released') ctx.setStatus('work_orders', wo, 'in_progress');
      return { message: `Started bundle ${bundle.no}: ${count(bundle.pieces, 'piece')} of ${ctx.title('styles', wo.style) || 'this style'}${station ? ` at ${station}` : ''}.`, data: { bundle } };
    },
  },
  'scan.finish': {
    module: 'production', level: 'scan',
    run(ctx, payload) {
      const bundle = findBundle(ctx, payload.bundle);
      if (bundle.status === 'cut') ctx.fail(`Bundle ${bundle.no} has not been started. Scan it to start first.`);
      if (bundle.status !== 'stitching') ctx.fail(`Bundle ${bundle.no} is already scanned as finished.`);
      const pieces = bundle.pieces || 0;
      const scan = ctx.all('scans').filter((s) => s.bundle === bundle.id && !s.finishedAt).sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)))[0];
      let minutes = null;
      if (scan) {
        minutes = Math.max(1, minutesBetween(scan.startedAt, ctx.now));
        Object.assign(scan, { finishedAt: ctx.now, minutes });
        ctx.put('scans', scan);
      }
      ctx.setStatus('bundles', bundle, 'stitched');
      const wo = ctx.get('work_orders', bundle.workOrder);
      if (wo) {
        wo.stitch = (wo.stitch || 0) + pieces;
        wo.cut = Math.max(wo.cut || 0, wo.stitch); // a stage is never ahead of the one before it
        if (wo.status === 'released') ctx.setStatus('work_orders', wo, 'in_progress'); else ctx.put('work_orders', wo);
      }
      const perPiece = minutes !== null && pieces > 0 ? round(minutes / pieces, 2) : null;
      return {
        message: perPiece === null ? `Finished bundle ${bundle.no}: ${count(pieces, 'piece')}.` : `Finished bundle ${bundle.no}: ${count(pieces, 'piece')} in ${count(minutes, 'minute')}, ${qty(perPiece)} ${perPiece === 1 ? 'minute' : 'minutes'} per piece.`,
        data: { bundle, minutes, perPiece },
      };
    },
  },

  // ── The scan gate: every parcel in or out ──
  'gate.scan': {
    module: ['logistics', 'b2c', 'production'], level: 'write',
    run(ctx, payload) {
      const barcode = String(payload.barcode ?? '').trim();
      if (!barcode) ctx.fail('Scan or type the barcode on the parcel.');
      const parcel = parcelWith(ctx, barcode) || ctx.fail('No parcel has this barcode. Pack the order first, or check the label.');
      const note = String(payload.note ?? '').trim();
      const event = (type, text) => { parcel.events = [...(parcel.events || []), { at: ctx.now, type, text }]; };
      const gate = { shopify: gateShopify, b2b: gateB2b, store: gateStore }[parcel.kind] || ctx.fail('This parcel has no kind set. Correct it in Parcels, then scan again.');
      // Going out: nothing leaves without the office's paperwork.
      if (parcel.status === 'packed') { const missing = papersMissing(parcel); if (missing) ctx.fail(missing); }
      const { direction, message } = gate(ctx, parcel, note, event, number(payload.workMinutes));
      if (direction === 'out' && parcel.kind !== 'store') slipsDispatched(ctx, parcel.ref);
      return { message, data: { parcel: ctx.get('parcels', parcel.id), direction } };
    },
  },

  // ── Stock ──
  'stock.adjust': {
    module: 'inventory', level: 'write',
    run(ctx, payload) {
      const item = findItem(ctx, payload.item);
      const target = number(payload.onHand);
      if (!(target >= 0)) ctx.fail('Enter the quantity that is really on hand, zero or more.');
      const was = item.onHand || 0, diff = round(target - was, 3);
      if (diff === 0) return { message: `${item.name} already shows ${qty(was)} ${item.unit} on hand. Nothing was changed.` };
      ctx.move(item.id, diff, 'adjust', 'Stock adjustment', String(payload.note ?? '').trim());
      return { message: `${item.name} is now ${qty(target)} ${item.unit} on hand; it was ${qty(was)}.` };
    },
  },
  'stock.issue': {
    module: ['inventory', 'production'], level: 'write',
    run(ctx, payload) {
      const item = findItem(ctx, payload.item);
      const amount = number(payload.qty);
      if (!(amount > 0)) ctx.fail('Enter the quantity to issue, above zero.');
      const onHand = item.onHand || 0;
      if (amount > onHand) ctx.fail(`Only ${qty(onHand)} ${item.unit} of ${item.name} are on hand; ${qty(amount)} cannot be issued. Issue less, or receive more first.`);
      ctx.move(item.id, -amount, 'issue', String(payload.ref ?? '').trim() || 'Issued to the floor');
      const left = round(onHand - amount, 3);
      const low = item.minLevel > 0 && left < item.minLevel ? ` That is under the minimum of ${qty(item.minLevel)}; raise a purchase order.` : '';
      return { message: `Issued ${qty(amount)} ${item.unit} of ${item.name}. ${qty(left)} left.${low}` };
    },
  },

  // ── My day: attendance and leave for the person signed in ──
  'hr.checkin': {
    level: 'self',
    run(ctx) {
      const emp = employeeOf(ctx);
      const entry = ctx.all('attendance').find((a) => a.employee === emp.id && a.date === ctx.today);
      if (entry?.inAt) ctx.fail('You have already checked in today.');
      ctx.put('attendance', entry ? { ...entry, inAt: ctx.now, status: 'present' } : { date: ctx.today, employee: emp.id, inAt: ctx.now, status: 'present' });
      return { message: `Checked in. Have a good day, ${String(emp.name).split(' ')[0]}.` };
    },
  },
  'hr.checkout': {
    level: 'self',
    run(ctx) {
      const emp = employeeOf(ctx);
      const entry = ctx.all('attendance').find((a) => a.employee === emp.id && a.date === ctx.today);
      if (!entry?.inAt) ctx.fail('You have not checked in today. Check in first.');
      if (entry.outAt) ctx.fail('You have already checked out today.');
      entry.outAt = ctx.now;
      ctx.put('attendance', entry);
      return { message: `Checked out. You were in for ${span(minutesBetween(entry.inAt, ctx.now))}.` };
    },
  },
  'hr.applyLeave': {
    level: 'self',
    run(ctx, payload) {
      const emp = employeeOf(ctx);
      const from = String(payload.from ?? '').slice(0, 10), to = String(payload.to ?? '').slice(0, 10);
      if (!isDate(from)) ctx.fail('Choose the first day of your leave.');
      if (!isDate(to)) ctx.fail('Choose the last day of your leave.');
      if (to < from) ctx.fail('The last day of leave is before the first day. Correct the dates.');
      const type = payload.type ? LEAVE_TYPES.find((t) => same(t, payload.type)) || ctx.fail(`Leave type must be one of: ${LEAVE_TYPES.join(', ')}.`) : 'Casual';
      ctx.put('leaves', { employee: emp.id, from, to, type, reason: String(payload.reason ?? '').trim() });
      const days = Math.round((+utc(to) - +utc(from)) / 86400000) + 1;
      return { message: `${type} leave applied for ${from === to ? dayText(from) : `${dayText(from)} to ${dayText(to)}`} (${count(days, 'day')}). HR will approve or reject it.` };
    },
  },

  // ── Finance ──
  'vouchers.markSynced': {
    module: 'finance', level: 'write',
    run(ctx, payload) {
      const ids = [...new Set(Array.isArray(payload.ids) ? payload.ids : [])];
      if (!ids.length) ctx.fail('Select the vouchers that are now in Tally first.');
      let marked = 0;
      for (const id of ids) { const v = ctx.get('vouchers', id); if (v && v.status === 'open') { ctx.setStatus('vouchers', v, 'synced'); marked++; } }
      return { message: `${count(marked, 'voucher is', 'vouchers are')} marked as in Tally.${marked < ids.length ? ` ${count(ids.length - marked, 'other was', 'others were')} already marked or not found.` : ''}`, data: { marked } };
    },
  },

  // ───────── Hooks: run by the service right after a record is created ─────────
  'hook.created.maintenance': {
    run(ctx, _payload, doc) {
      const machine = doc.type === 'breakdown' && ctx.get('machines', doc.machine);
      if (machine) { machine.status = 'down'; ctx.put('machines', machine); }
      return {};
    },
  },
  'hook.created.store_orders': {
    run(ctx, _payload, doc) {
      if (doc.tag && !parcelWith(ctx, doc.tag)) {
        ctx.put('parcels', { kind: 'store', ref: doc.no, barcode: doc.tag, dest: 'Store', cartons: 1, events: [{ at: ctx.now, type: 'pack', text: 'New store order, ready to go out' }] });
      }
      return {};
    },
  },
};

// The go-live plan and the task board steps live in their own file.
import { GOLIVE_ACTIONS } from './golive.js';
import { FLOOR_ACTIONS, openClaim, papersMissing } from './floor.js';
import { SLIP_ACTIONS, slipsDispatched } from './slips.js';
import { COLLAB_ACTIONS } from './collab.js';
import { PACK_ACTIONS } from './packs.js';
const checkAddsUp = { run(ctx, a, b) { const d = b || a; const n = (v) => Number(v) || 0; if (n(d.passed) + n(d.rework) + n(d.rejected) > n(d.checked)) ctx.fail(`${n(d.checked)} pieces were checked, so passed, rework and rejected cannot add up to ${n(d.passed) + n(d.rework) + n(d.rejected)}.`); } };
ACTIONS['hook.created.qc_checks'] = { run: (ctx, _p, doc) => checkAddsUp.run(ctx, doc) };
ACTIONS['hook.updated.qc_checks'] = { run: (ctx, _old, doc) => checkAddsUp.run(ctx, doc) };
Object.assign(ACTIONS, GOLIVE_ACTIONS, COLLAB_ACTIONS, FLOOR_ACTIONS, SLIP_ACTIONS, PACK_ACTIONS);
