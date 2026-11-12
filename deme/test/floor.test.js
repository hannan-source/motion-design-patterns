// The flows Deme's merchandising head described: fabric straight from mill to dye house, claims
// on whoever is at fault, the dye house reporting from a phone, a day plan checked against real
// fabric, wholesale work made by vendors, and pieces that come back being sold on.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createService, memoryDb } from '../shared/service.js';
import { ACTIONS } from '../shared/actions.js';

const db = memoryDb();
const svc = createService(db, { actions: ACTIONS, hash: async (p) => `h:${p}` });
const admin = svc.getUser((await svc.setup({ name: 'Admin', email: 'admin@deme.test', password: 'correct-horse' })).id);
const add = (e, input, u = admin) => svc.create(u, e, input).doc;
const act = (a, e, id, payload = {}, u = admin) => svc.act(u, a, { entity: e, id, payload });
const run = (a, payload = {}, u = admin) => svc.act(u, a, { payload });
const list = (e) => svc.list(admin, e);
const inbox = (u) => svc.inbox(u).map((n) => n.text);
const S = {};

test('RFD fabric goes from the mill straight to the dye house and is passed on the mill report or checked there', async () => {
  S.mill = add('suppliers', { name: 'Sita Mills', kind: 'mill' }); S.dyer = add('suppliers', { name: 'Rangrez', kind: 'dyer' });
  S.fabric = add('items', { code: 'RFD-1', name: 'Cotton voile RFD', kind: 'fabric', unit: 'm', rfd: true, cost: 100, dyeCost: 20 });
  assert.throws(() => act('grn.post', 'goods_receipts', add('goods_receipts', { supplier: S.mill.id, deliveredTo: 'dyer', lines: [{ item: S.fabric.id, qty: 300, rolls: 3, rate: 100 }] }).id), /which dye house/);
  const grn = add('goods_receipts', { supplier: S.mill.id, deliveredTo: 'dyer', dyer: S.dyer.id, millReport: 'ok', millHeld: 40, lines: [{ item: S.fabric.id, qty: 300, rolls: 3, rate: 100 }] });
  assert.match(act('grn.post', 'goods_receipts', grn.id).message, /3 rolls are at Rangrez, to be checked there or accepted on the mill's report/);
  S.rolls = list('rolls');
  assert.ok(S.rolls.every((r) => r.heldAt === S.dyer.id && r.location === 'At Rangrez' && r.left === 100));
  // two rolls on the mill's report, one checked by Deme's person at the dye house
  assert.equal(act('roll.accept', 'rolls', S.rolls[0].id).doc.checkedBy, 'mill');
  act('roll.accept', 'rolls', S.rolls[1].id);
  assert.equal(act('roll.inspect', 'rolls', S.rolls[2].id, { points: 12 }).doc.checkedBy, 'dyehouse');
  // without a mill report there is nothing to accept on
  const g2 = add('goods_receipts', { supplier: S.mill.id, lines: [{ item: S.fabric.id, qty: 50, rolls: 1, rate: 100 }] });
  act('grn.post', 'goods_receipts', g2.id);
  S.storeRoll = list('rolls').find((r) => r.grn === g2.id);
  assert.equal(S.storeRoll.location, 'Dock');
  assert.throws(() => act('roll.accept', 'rolls', S.storeRoll.id), /No mill QC report/);
});

test('a fabric fault that shows only after dyeing is the mill\'s: a claim, not a loss', () => {
  const lot = add('dye_lots', { dyer: S.dyer.id, shade: 'Coral', rolls: S.rolls.map((r) => r.id) });
  act('dye.send', 'dye_lots', lot.id);
  const out = act('dye.receive', 'dye_lots', lot.id, { failed: [S.rolls[2].id], fault: 'mill', reason: 'yarn', note: 'Yarn lines across the width' });
  assert.match(out.message, /Claim CLM-00001 is open on Sita Mills/);
  const claim = list('claims')[0];
  assert.deepEqual([claim.against, claim.stage, claim.reason, claim.metres, claim.amount, claim.status], ['mill', 'after', 'yarn', 100, 10000, 'open']);
  assert.equal(svc.get(admin, 'rolls', S.rolls[2].id).status, 'rejected', 'it goes back to the mill like any rejected roll');
  assert.equal(list('vouchers').filter((v) => v.dr === 'Fabric Loss: Post-Dye Defects').length, 0, 'nothing is written off');
  assert.equal(list('vouchers').filter((v) => v.type === 'Debit Note' && v.dr === 'Sita Mills' && v.amount === 10000).length, 1);
  const good = svc.get(admin, 'rolls', S.rolls[0].id);
  assert.deepEqual([good.status, good.location, good.heldAt], ['dyed', 'Fabric store', undefined]);
  // the claim stays open until the credit note arrives
  assert.equal(act('claim.credit', 'claims', claim.id, { creditNote: 'CN-88' }).doc.status, 'credited');
});

test('the dye house reports a problem from its own login, and only on its own lots', async () => {
  const other = add('suppliers', { name: 'Other Dyers', kind: 'dyer' });
  const outside = svc.getUser((await svc.createUser(admin, { name: 'Rangrez desk', email: 'desk@rangrez.test', password: 'correct-horse', position: 'dyehouse', supplier: S.dyer.id })).id);
  assert.equal(outside.role, 'dyer');
  const qc = svc.getUser((await svc.createUser(admin, { name: 'Priya', email: 'priya@deme.test', password: 'correct-horse', position: 'qc' })).id);
  act('roll.inspect', 'rolls', S.storeRoll.id, { points: 5 });
  const lot = add('dye_lots', { dyer: S.dyer.id, shade: 'Sea', rolls: [S.storeRoll.id] });
  act('dye.send', 'dye_lots', lot.id);
  const g3 = add('goods_receipts', { supplier: S.mill.id, lines: [{ item: S.fabric.id, qty: 20, rolls: 1, rate: 100 }] });
  act('grn.post', 'goods_receipts', g3.id);
  const spare = list('rolls').find((r) => r.grn === g3.id); act('roll.inspect', 'rolls', spare.id, { points: 1 });
  const theirs = add('dye_lots', { dyer: other.id, shade: 'Ink', rolls: [spare.id] }); act('dye.send', 'dye_lots', theirs.id);
  const mine = run('fabric.myLots', {}, outside).data;
  assert.deepEqual(mine.lots.map((l) => l.no), [lot.no]);
  assert.throws(() => svc.list(outside, 'dye_lots'), /access/, 'an outside login reads no lists');
  assert.throws(() => run('fabric.report', { dyeLot: theirs.id, reason: 'patchy' }, outside), /not at your dye house/);
  const r = run('fabric.report', { dyeLot: lot.id, roll: S.storeRoll.id, reason: 'pilling', note: 'Pilling after wash' }, outside);
  assert.match(r.message, /Report FR-00001 is sent/);
  assert.ok(inbox(qc).includes(`Rangrez desk reports pilling on dye lot ${lot.no}`));
  // photos go on the report
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const f = svc.addFile(outside, { entity: 'fabric_reports', id: r.data.report, name: 'defect.png', type: 'image/png', data: png });
  assert.equal(svc.get(admin, 'fabric_reports', r.data.report).photos, 1);
  assert.equal(svc.listFiles(qc, 'fabric_reports', r.data.report).length, 1);
  assert.equal(svc.getFile(qc, f.id).data, png);
  assert.throws(() => svc.addFile(outside, { entity: 'claims', id: list('claims')[0].id, name: 'x.png', type: 'image/png', data: png }), /cannot add/);
  assert.throws(() => svc.addFile(qc, { entity: 'fabric_reports', id: r.data.report, name: 'x.exe', type: 'application/x-msdownload', data: png }), /photo or a PDF/);
});

test('the day plan: no slip goes out without fabric, and each master gets exactly the cut quantity', async () => {
  const runner = svc.getUser((await svc.createUser(admin, { name: 'Runner', email: 'runner@deme.test', password: 'correct-horse', position: 'runner' })).id);
  const style = add('styles', { code: 'KAF', name: 'Isla kaftan', fabric: S.fabric.id, shade: 'Coral', metres: 2.5, smvCut: 5, smvStitch: 30, smvFinish: 5, smvQc: 3, smvPack: 2 });
  const noFabric = add('styles', { code: 'SEA', name: 'Sea dress', fabric: S.fabric.id, shade: 'Jade', metres: 3, smvCut: 5, smvStitch: 30, smvFinish: 5, smvQc: 3, smvPack: 2 });
  const a = add('work_orders', { channel: 'D2C', style: style.id, qty: 60, due: '2026-12-01' });
  const b = add('work_orders', { channel: 'D2C', style: noFabric.id, qty: 10, due: '2026-12-01' });
  // 200 m of Coral is in the store: 40 + 30 pieces need 175 m, a third line of 20 would need 50 more
  const plan = add('day_plans', { date: '2026-11-12', lines: [{ workOrder: a.id, master: 'Master Salim', pieces: 40 }, { workOrder: a.id, master: 'Master Irfan', pieces: 20 }, { workOrder: b.id, master: 'Master Salim', pieces: 10 }] });
  const checked = act('plan.check', 'day_plans', plan.id);
  assert.deepEqual(checked.doc.check.map((r) => [r.need, r.ok]), [[100, 'Ready'], [50, 'Ready'], [30, 'Short by 30 m']]);
  assert.match(checked.message, /2 lines have fabric\. 1 line does not: do not give those slips out\./);
  const issued = act('plan.issue', 'day_plans', plan.id);
  assert.match(issued.message, /2 bundles, 150 m set aside\. 1 line was left out: no fabric\./);
  const bundles = list('bundles').filter((x) => x.plan === plan.id);
  assert.deepEqual(bundles.map((x) => [x.master, x.pieces, x.metres]).sort(), [['Master Irfan', 20, 50], ['Master Salim', 40, 100]]);
  assert.match(bundles[0].fromRolls, /R-\d+ \(\d+ m\)/);
  const coral = list('rolls').filter((r) => r.shade === 'Coral' && ['dyed', 'issued'].includes(r.status));
  assert.equal(coral.reduce((s, r) => s + r.left, 0), 50, 'metres left go down by what was set aside');
  assert.ok(coral.some((r) => r.status === 'issued' && r.left === 0));
  assert.equal(svc.get(admin, 'work_orders', a.id).status, 'released');
  assert.equal(svc.get(admin, 'work_orders', b.id).status, 'planned', 'the order without fabric stays back');
  assert.ok(inbox(runner).includes('Bundling list for 2026-11-12: 2 bundles, 150 m to cut and hand out'));
  // pieces already with masters count against the order, even before their cutting is recorded
  const again = add('day_plans', { date: '2026-11-13', lines: [{ workOrder: a.id, master: 'Master Salim', pieces: 1 }] });
  assert.throws(() => act('plan.check', 'day_plans', again.id), /60 are already cut or with masters/);
  // a plan cannot ask for more than the order
  const over = add('day_plans', { date: '2026-11-13', lines: [{ workOrder: a.id, master: 'Master Salim', pieces: 61 }] });
  assert.throws(() => act('plan.check', 'day_plans', over.id), /Lower the pieces/);
  S.style = style;
});

test('wholesale work goes to vendors: bulk checked and shipped from the vendor, difficult pieces back for QC here', () => {
  const delhi = add('suppliers', { name: 'Delhi Makers', kind: 'maker', city: 'Delhi' }), mumbai = add('suppliers', { name: 'Atelier M', kind: 'maker', city: 'Mumbai' });
  const buyer = add('customers', { name: 'Trading Co', kind: 'b2b', currency: 'USD' });
  const so = add('sales_orders', { customer: buyer.id, endBuyer: 'A US retailer', customerPO: 'PO-9', shipBy: '2026-12-26', lines: [{ style: S.style.id, qty: 600, price: 40, vendor: delhi.id }, { style: S.style.id, qty: 200, price: 40, vendor: mumbai.id }, { style: S.style.id, qty: 20, price: 40 }] });
  act('so.confirm', 'sales_orders', so.id);
  const [bulk, hard, own] = list('work_orders').filter((w) => w.source === so.no).sort((x, y) => y.qty - x.qty);
  assert.deepEqual([bulk.madeBy, hard.madeBy, own.madeBy], ['vendor', 'vendor', 'inhouse']);
  assert.match(act('wo.sendOut', 'work_orders', bulk.id, { vendor: delhi.id, qcAt: 'vendor' }).message, /with Delhi Makers, Delhi\. It will be checked there and shipped from there\./);
  act('wo.sendOut', 'work_orders', hard.id, { vendor: mumbai.id, qcAt: 'inhouse' });
  // Delhi: Deme's QC passes it there, and it never comes through the factory
  assert.throws(() => act('wo.vendorPassed', 'work_orders', hard.id, { pieces: 10 }), /checked in-house/);
  const passed = act('wo.vendorPassed', 'work_orders', bulk.id, { pieces: 590, rejected: 10 });
  assert.equal(passed.doc.status, 'at_vendor'); assert.equal(passed.doc.pack, 590);
  assert.equal(act('wo.vendorPassed', 'work_orders', bulk.id, { pieces: 10 }).doc.status, 'done');
  // Mumbai: pieces come back stitched and go through QC and packing here
  const back = act('wo.vendorBack', 'work_orders', hard.id, { pieces: 200 });
  assert.deepEqual([back.doc.status, back.doc.finish, back.doc.qc || 0], ['in_progress', 200, 0]);
  act('wo.output', 'work_orders', hard.id, { stage: 'qc', pieces: 200 });
  assert.equal(act('wo.output', 'work_orders', hard.id, { stage: 'pack', pieces: 200 }).doc.status, 'done');
  // vendor work is not cut here, so it cannot go on a day plan
  const p = add('day_plans', { date: '2026-11-14', lines: [{ workOrder: bulk.id, master: 'Master Salim', pieces: 5 }] });
  assert.throws(() => act('plan.check', 'day_plans', p.id), /made by a vendor/);
});

test('a returned piece is approved as fit to sell, then sold on', () => {
  const order = add('shop_orders', { orderNo: '#2001', style: S.style.id, amount: 9000 });
  const ret = add('returns', { order: order.id, reason: 'Size' });
  svc.update(admin, 'returns', ret.id, {}); db.put('returns', { ...db.get('returns', ret.id), status: 'received' });
  assert.equal(act('ret.restock', 'returns', ret.id).doc.status, 'restocked');
  const sold = act('ret.sold', 'returns', ret.id, { amount: 4500, where: 'Sample sale' });
  assert.equal(sold.doc.status, 'sold');
  assert.ok(list('vouchers').some((v) => v.ref === ret.no && v.cr === 'Store Sales' && v.amount === 4500));
});
