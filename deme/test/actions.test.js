// The business chain end to end, through the public service API only:
// buy fabric → inspect → dye → sell → make → ship → return → pay → payroll, plus who may do what.
// The tests share one in-memory database and run in order, each building on the last.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createService, memoryDb, UserError, todayIso } from '../shared/service.js';
import { ENTITIES } from '../shared/schema.js';
import { ACTIONS } from '../shared/actions.js';

const svc = createService(memoryDb(), { actions: ACTIONS, hash: async (p) => 'h:' + p });
const founder = svc.getUser((await svc.setup({ name: 'Asha Rao', email: 'asha@deme.test', password: 'correct-horse' })).id);

const add = (entity, input, user = founder) => svc.create(user, entity, input).doc;
const act = (action, entity, id, payload = {}, user = founder) => svc.act(user, action, { entity, id, payload });
const scan = (action, payload, user = founder) => svc.act(user, action, { payload });
const list = (entity) => svc.list(founder, entity);
const get = (entity, id) => svc.get(founder, entity, id);
const vouchers = (where) => list('vouchers').filter((v) => Object.entries(where).every(([k, x]) => v[k] === x));
/** The call must be refused with a message for the person, not crash. */
const refused = (fn, pattern, status = 400) => assert.throws(fn, (e) => e instanceof UserError && e.status === status && pattern.test(e.message));

const s = {}; // records carried from one step to the next

test('every action declared in the schema is implemented', () => {
  const declared = ENTITIES.flatMap((e) => (e.actions || []).map((a) => a.id));
  assert.deepEqual(declared.filter((id) => typeof ACTIONS[id]?.run !== 'function'), []);
});

test('purchase order → goods receipts: rolls, stock, vouchers, bill, PO status', () => {
  s.fabric = add('items', { code: 'FAB-01', name: 'Cotton voile', kind: 'fabric', unit: 'm', cost: 100, dyeCost: 40 });
  s.thread = add('items', { code: 'THR-01', name: 'Thread, ivory', kind: 'thread', unit: 'cones', cost: 50 });
  s.mill = add('suppliers', { name: 'Sita Mills', kind: 'mill' });
  s.po = add('purchase_orders', { supplier: s.mill.id, lines: [{ item: s.fabric.id, qty: 300, rate: 100 }, { item: s.thread.id, qty: 40, rate: 50 }] });
  assert.equal(act('po.approve', 'purchase_orders', s.po.id).doc.status, 'approved');

  // First lorry: half the fabric as three rolls, and all the thread.
  const grn = add('goods_receipts', { po: s.po.id, supplier: s.mill.id, lines: [{ item: s.fabric.id, qty: 150, rolls: 3, rate: 100 }, { item: s.thread.id, qty: 40, rate: 50 }] });
  assert.equal(act('grn.post', 'goods_receipts', grn.id).doc.status, 'posted');
  s.rolls = list('rolls');
  assert.deepEqual(s.rolls.map((r) => [r.metres, r.status, r.location, r.grn]), Array(3).fill([50, 'received', 'Dock', grn.id]));
  assert.equal(get('items', s.thread.id).onHand, 40);
  assert.deepEqual(vouchers({ ref: grn.no }).map((v) => [v.type, v.dr, v.cr, v.amount]).sort(), [['Purchase', 'Fabric Purchases', 'Sita Mills', 15000], ['Purchase', 'Thread & Trims', 'Sita Mills', 2000]]);
  s.millBill = list('bills').find((b) => b.ref === grn.no);
  assert.deepEqual([s.millBill.amount, s.millBill.status], [17000, 'unpaid']);
  assert.equal(get('purchase_orders', s.po.id).status, 'part_received');
  refused(() => act('grn.post', 'goods_receipts', grn.id), /posted/); // cannot be posted twice

  // Second lorry: the rest of the fabric as one roll.
  const grn2 = add('goods_receipts', { po: s.po.id, supplier: s.mill.id, lines: [{ item: s.fabric.id, qty: 150, rate: 100 }] });
  act('grn.post', 'goods_receipts', grn2.id);
  assert.equal(get('purchase_orders', s.po.id).status, 'received');
  s.uninspected = list('rolls').find((r) => r.grn === grn2.id);
  assert.equal(s.uninspected.metres, 150);
});

test('fabric inspection: a pass, and a fail that claims the money back', () => {
  const [a, b, c] = s.rolls;
  assert.equal(act('roll.inspect', 'rolls', a.id, { points: 20 }).doc.status, 'passed');
  assert.equal(act('roll.inspect', 'rolls', b.id, { points: 40 }).doc.status, 'passed'); // the pass mark itself passes
  const failed = act('roll.inspect', 'rolls', c.id, { points: 55, defects: 'Weft bars' });
  assert.equal(failed.doc.status, 'rejected');
  assert.match(failed.message, /Claim CLM-00001 for ₹5,000 is open on Sita Mills/);
  assert.deepEqual(list('claims').map((c) => [c.against, c.stage, c.metres > 0, c.amount, c.status]), [['mill', 'before', true, 5000, 'open']]);
  assert.deepEqual(vouchers({ type: 'Debit Note' }).map((v) => [v.dr, v.cr, v.amount]), [['Sita Mills', 'Purchase Returns', 5000]]);
  assert.equal(get('bills', s.millBill.id).amount, 12000);
  assert.deepEqual(list('inspections').map((i) => i.result).sort(), ['fail', 'pass', 'pass']);
});

test('dye lot: only inspected rolls go out; a roll that fails on shade is not paid for', () => {
  const [a, b] = s.rolls;
  s.dyer = add('suppliers', { name: 'Rang Dyers', kind: 'dyer' });
  const lot = add('dye_lots', { dyer: s.dyer.id, shade: 'Coral', rolls: [a.id, b.id, s.uninspected.id] });
  refused(() => act('dye.send', 'dye_lots', lot.id), new RegExp(`Roll ${s.uninspected.no} has not passed inspection`));
  assert.equal(get('rolls', a.id).status, 'passed'); // nothing moved when the lot was refused

  svc.update(founder, 'dye_lots', lot.id, { rolls: [a.id, b.id] });
  assert.equal(act('dye.send', 'dye_lots', lot.id).doc.status, 'at_dyer');
  assert.deepEqual([a, b].map((r) => get('rolls', r.id)).map((r) => [r.status, r.location, r.shade]), Array(2).fill(['at_dyer', 'Dye house', 'Coral']));

  refused(() => act('dye.receive', 'dye_lots', lot.id, { failed: [s.uninspected.id] }), /not on this dye lot/);
  const back = act('dye.receive', 'dye_lots', lot.id, { failed: [b.id], note: 'Patchy shade' }).doc;
  assert.deepEqual([back.status, back.acceptedMetres, back.failedMetres], ['received', 50, 50]);
  assert.deepEqual([get('rolls', a.id).status, get('rolls', b.id).status, get('rolls', b.id).defects], ['dyed', 'dye_reject', 'Patchy shade']);
  assert.deepEqual(vouchers({ ref: lot.no }).map((v) => [v.type, v.dr, v.cr, v.amount]).sort(), [
    ['Journal', 'Fabric Loss: Post-Dye Defects', 'Stock: Dyed Fabric', 7000], // 50 m × (100 cloth + 40 dyeing)
    ['Purchase', 'Dyeing Charges', 'Rang Dyers', 2000], // 50 accepted m × 40
  ]);
  assert.equal(list('bills').find((x) => x.ref === lot.no).amount, 2000);
});

test('sales order → work orders → output can never run ahead', () => {
  s.style = add('styles', { code: 'KF-01', name: 'Kaftan', smvCut: 4, smvStitch: 18, smvFinish: 5, smvQc: 2, smvPack: 2 });
  add('workstations', { name: 'Stitching line 1', centre: 'Production', stage: 'stitch', people: 12 });
  const customer = add('customers', { name: 'Coast Boutique', kind: 'b2b', currency: 'USD' });
  s.so = add('sales_orders', { customer: customer.id, shipBy: '2026-12-20', lines: [{ style: s.style.id, qty: 200, price: 30 }, { style: s.style.id, qty: 100, price: 30 }] });
  assert.equal(act('so.confirm', 'sales_orders', s.so.id).doc.status, 'confirmed');
  const raised = list('work_orders').filter((w) => w.source === s.so.no);
  assert.deepEqual(raised.map((w) => [w.channel, w.qty, w.due, w.status]).sort(), [['B2B', 100, '2026-12-20', 'planned'], ['B2B', 200, '2026-12-20', 'planned']]);

  s.wo = raised.find((w) => w.qty === 200);
  refused(() => act('wo.output', 'work_orders', s.wo.id, { stage: 'cut', pieces: 10 }), /not available/); // not on the floor yet
  assert.equal(act('wo.release', 'work_orders', s.wo.id).doc.status, 'released');
  const cut = act('wo.output', 'work_orders', s.wo.id, { stage: 'cut', pieces: 120 }).doc;
  assert.deepEqual([cut.cut, cut.status], [120, 'in_progress']);
  refused(() => act('wo.output', 'work_orders', s.wo.id, { stage: 'stitch', pieces: 200 }), /Only 120 pieces are cut; 200 cannot be stitched yet/);
  refused(() => act('wo.output', 'work_orders', s.wo.id, { stage: 'cut', pieces: 100 }), /Enter 80 or fewer/); // 220 of 200
  assert.equal(get('work_orders', s.wo.id).stitch ?? 0, 0);
});

test('bundles are scanned by a tailor who can do nothing else', async () => {
  refused(() => act('wo.bundles', 'work_orders', s.wo.id, { count: 501, pieces: 25 }), /500/);
  act('wo.bundles', 'work_orders', s.wo.id, { count: 4, pieces: 25 });
  const bundles = list('bundles');
  assert.deepEqual(bundles.map((b) => [b.workOrder, b.pieces, b.status]), Array(4).fill([s.wo.id, 25, 'cut']));

  s.tailor = svc.getUser((await svc.createUser(founder, { name: 'Ravi Kumar', email: 'ravi@deme.test', password: 'needle-and-thread', role: 'operator' })).id);
  const tag = bundles[0].no.toLowerCase(); // the scanner may send either case
  scan('scan.start', { bundle: tag, station: 'L1-04' }, s.tailor);
  const started = get('bundles', bundles[0].id);
  assert.deepEqual([started.status, started.station, started.operator], ['stitching', 'L1-04', s.tailor.id]);
  refused(() => scan('scan.start', { bundle: tag, station: 'L1-05' }, s.tailor), /already being stitched/);

  assert.match(scan('scan.finish', { bundle: tag }, s.tailor).message, /25 pieces in 1 minute, 0\.04 minutes per piece/);
  assert.equal(get('bundles', bundles[0].id).status, 'stitched');
  const [log] = list('scans');
  assert.deepEqual([log.bundle, log.style, log.operator, log.pieces, log.minutes, !!log.finishedAt], [bundles[0].id, s.style.id, s.tailor.id, 25, 1, true]);
  const wo = get('work_orders', s.wo.id);
  assert.deepEqual([wo.cut, wo.stitch], [120, 25]);

  // Scan level is the floor tier: no lists, no gate.
  refused(() => svc.list(s.tailor, 'work_orders'), /access/, 403);
  refused(() => scan('gate.scan', { barcode: 'AWB111' }, s.tailor), /role/, 403);
});

test('Shopify parcel: packed, out through the gate, and back as a return', () => {
  const order = add('shop_orders', { orderNo: '#1001', customerName: 'Mira', country: 'UAE', style: s.style.id, amount: 8400 });
  assert.equal(act('shop.pack', 'shop_orders', order.id, { awb: 'AWB111' }).doc.status, 'packed');
  const second = add('shop_orders', { orderNo: '#1002', style: s.style.id, amount: 5000 });
  refused(() => act('shop.pack', 'shop_orders', second.id, { awb: 'awb111' }), /already exists/);
  refused(() => scan('gate.scan', { barcode: 'NOPE' }), /^No parcel has this barcode\. Pack the order first, or check the label\.$/);

  // nothing leaves without the office's paperwork; above ₹50,000 that includes an e-way bill
  refused(() => scan('gate.scan', { barcode: 'AWB111' }), /has no e-invoice number yet/);
  const parcel = list('parcels').find((p) => p.barcode === 'AWB111');
  refused(() => act('parcel.papers', 'parcels', parcel.id, { invoiceNo: 'INV-1', value: 60000 }), /needs an e-way bill number/);
  act('parcel.papers', 'parcels', parcel.id, { invoiceNo: 'INV-1', value: 8400 });
  const out = scan('gate.scan', { barcode: ' awb111 ' });
  assert.deepEqual([out.data.direction, out.data.parcel.status, out.data.parcel.events.map((e) => e.type)], ['out', 'in_transit', ['pack', 'out']]);
  assert.equal(get('shop_orders', order.id).status, 'shipped');
  assert.deepEqual(vouchers({ ref: '#1001' }).map((v) => [v.type, v.dr, v.cr, v.amount]), [['Sales', 'Shopify Clearing', 'Online Sales', 8400]]);

  const back = scan('gate.scan', { barcode: 'AWB111', note: 'Tags removed' });
  assert.deepEqual([back.data.direction, back.data.parcel.status], ['in', 'at_factory']);
  assert.equal(get('shop_orders', order.id).status, 'returned');
  assert.deepEqual(list('returns').map((r) => [r.order, r.status, r.condition]), [[order.id, 'received', 'Tags removed']]);
  refused(() => scan('gate.scan', { barcode: 'AWB111' }), /already scanned in/);
});

test('store piece: the order makes its own parcel, and each trip back is one fit visit', () => {
  const order = add('store_orders', { customerName: 'Leela', style: s.style.id, tag: 'ST-TAG-9' });
  const parcel = () => list('parcels').find((p) => p.barcode === 'ST-TAG-9');
  assert.deepEqual([parcel().kind, parcel().ref, parcel().status], ['store', order.no, 'packed']);

  assert.equal(scan('gate.scan', { barcode: 'ST-TAG-9' }).data.parcel.status, 'at_store');
  assert.equal(scan('gate.scan', { barcode: 'ST-TAG-9', note: 'Shorten hem' }).data.direction, 'in');
  assert.deepEqual([get('store_orders', order.id).status, get('store_orders', order.id).visits], ['at_factory', 1]);
  assert.equal(scan('gate.scan', { barcode: 'ST-TAG-9', workMinutes: 35 }).data.direction, 'out');

  const [visit] = list('fit_visits');
  assert.deepEqual([visit.storeOrder, visit.visitNo, visit.note, visit.workMinutes, !!visit.inAt, !!visit.outAt], [order.id, 1, 'Shorten hem', 35, true, true]);
  assert.deepEqual([get('store_orders', order.id).status, get('store_orders', order.id).visits, parcel().status], ['at_store', 1, 'at_store']);
});

test('courier invoice: only parcels that really went out are accepted', () => {
  const courier = add('suppliers', { name: 'BlueDart', kind: 'courier' });
  const invoice = add('courier_invoices', { carrier: courier.id, invoiceNo: 'BD-77', lines: [{ awb: 'AWB111', billed: 450 }, { awb: 'AWB999', billed: 300 }] });
  const matched = act('courier.match', 'courier_invoices', invoice.id);
  assert.deepEqual(matched.doc.lines.map((l) => l.match), ['OK', 'No parcel scanned out']);
  assert.equal(matched.doc.status, 'disputed');
  assert.match(matched.message, /^1 of 2 lines did not match/);
  refused(() => act('courier.approve', 'courier_invoices', invoice.id), /not available/);
});

test('paying a supplier bill: never more than is owed', () => {
  refused(() => act('bill.pay', 'bills', s.millBill.id, { amount: 20000 }), /Only ₹12,000 is still owed/);
  const part = act('bill.pay', 'bills', s.millBill.id, { amount: 5000 }).doc;
  assert.deepEqual([part.paid, part.status], [5000, 'part_paid']);
  assert.deepEqual(vouchers({ type: 'Payment' }).map((v) => [v.dr, v.cr, v.amount]), [['Sita Mills', 'Bank Account', 5000]]);
  assert.equal(act('bill.pay', 'bills', s.millBill.id, { amount: 7000 }).doc.status, 'paid');
});

test('payroll: days present plus approved leave, over the Monday-to-Saturday month', () => {
  const today = todayIso(), month = today.slice(0, 7);
  const dates = Array.from({ length: 31 }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`).filter((d) => new Date(`${d}T00:00:00Z`).getUTCMonth() + 1 === Number(month.slice(5)));
  const working = dates.filter((d) => new Date(`${d}T00:00:00Z`).getUTCDay() !== 0);
  const leaveDay = working.find((d) => d !== today);

  refused(() => scan('hr.checkin', {}, s.tailor), /not linked to an employee record/);
  const ravi = add('employees', { name: 'Ravi Kumar', department: 'Production', login: s.tailor.id, salary: 26000 });
  add('employees', { name: 'Old Hand', salary: 30000, status: 'left' }); // not paid
  scan('hr.checkin', {}, s.tailor);
  refused(() => scan('hr.checkin', {}, s.tailor), /already checked in/);
  scan('hr.applyLeave', { from: leaveDay, to: leaveDay, type: 'Casual', reason: 'Family function' }, s.tailor);
  refused(() => scan('hr.applyLeave', { from: leaveDay, to: '2020-01-01' }, s.tailor), /before the first day/);
  act('leave.approve', 'leaves', list('leaves')[0].id);

  const run = add('payroll_runs', { month });
  refused(() => act('payroll.post', 'payroll_runs', run.id), /Build it from attendance first/);
  const built = act('payroll.build', 'payroll_runs', run.id).doc;
  const gross = Math.round((26000 * 2) / working.length);
  assert.deepEqual([built.lines, built.total, built.status], [[{ employee: ravi.id, days: 2, gross }], gross, 'draft']);
  assert.equal(act('payroll.post', 'payroll_runs', run.id).doc.status, 'posted');
  assert.deepEqual(vouchers({ dr: 'Salaries & Wages' }).map((v) => [v.type, v.cr, v.amount]), [['Journal', 'Salaries Payable', gross]]);
});
