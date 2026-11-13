// Made-to-order slips: orders from Shopify and from inside the company, scans by tailor and QC,
// who can see what, missing fabric, other currencies, channel spend, and removing personal details.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, createHash } from 'node:crypto';
import { createService, memoryDb } from '../shared/service.js';
import { ACTIONS } from '../shared/actions.js';
import { settingsFrom, scopeDb } from '../shared/platform.js';
import { createApi } from '../server/app.js';
import { fromShopifyWebhook } from '../server/connectors.js';

// One business on the platform: `root` is the whole database, `db` is this business's view of it.
const root = memoryDb(), WS = 'w00000000001';
root.put('workspaces', { id: WS, settings: settingsFrom('apparel', 'Test Business'), secrets: {}, status: 'on', createdAt: new Date().toISOString() });
const db = scopeDb(root, WS);
const svc = createService(db, { actions: ACTIONS, hash: async (p) => `h:${p}` });
const admin = svc.getUser((await svc.setup({ name: 'Admin', email: 'admin@deme.test', password: 'correct-horse' })).id);
const person = async (name, position) => svc.getUser((await svc.createUser(admin, { name, email: `${name.toLowerCase()}@deme.test`, password: 'correct-horse', position })).id);
const add = (e, input, u = admin) => svc.create(u, e, input).doc;
const act = (a, e, id, payload = {}, u = admin) => svc.act(u, a, { entity: e, id, payload });
const run = (a, payload = {}, u = admin) => svc.act(u, a, { payload });
const slips = (u = admin) => svc.list(u, 'slips');
const inbox = (u) => svc.inbox(u).map((n) => n.text);
const sm = { smvCut: 5, smvStitch: 30, smvFinish: 5, smvQc: 3, smvPack: 2 };
const kaftan = add('styles', { code: 'KAF', name: 'Isla kaftan', ...sm }), shirt = add('styles', { code: 'SHT', name: 'Palm shirt', ...sm });
const tailor = await person('Ravi', 'masters'), qc = await person('Priya', 'qc'), sales = await person('Meera', 'sales'), marketing = await person('Tara', 'marketing'), manager = await person('Jason', 'prod_manager');

test('online orders come in once, a paid one becomes a slip per piece, history makes none', () => {
  add('fx_rates', { currency: 'USD', rate: 84, date: '2026-01-01' });
  const orders = [
    { orderNo: '#3001', date: '2026-11-10', customerName: 'Ana Lima', country: 'US', currency: 'USD', amount: 300, paid: true, shipped: false, channel: 'Meta', campaign: 'Resort 26', note: 'Gift wrap', lines: [{ sku: 'KAF', title: 'Isla Kaftan', variant: 'M', qty: 2, notes: 'Length: 52in' }, { sku: 'ZZZ', title: 'Mystery robe', variant: '', qty: 1, notes: '' }] },
    { orderNo: '#2990', date: '2026-09-01', customerName: 'Old Order', country: 'GB', currency: 'INR', amount: 9000, paid: true, shipped: true, lines: [{ sku: 'SHT', title: 'Palm shirt', variant: 'L', qty: 1 }] },
    { orderNo: '#3002', date: '2026-11-10', customerName: 'Unpaid', country: 'IN', currency: 'INR', amount: 5000, paid: false, shipped: false, lines: [{ sku: 'SHT', title: 'Palm shirt', variant: 'S', qty: 1 }] },
  ];
  const out = run('shopify.ingest', { orders });
  assert.equal(out.message, '3 new orders, 3 slips made, 1 with no matching style.');
  assert.equal(run('shopify.ingest', { orders }).message, 'Nothing new.', 'taking the same orders in again changes nothing');
  const o = svc.list(admin, 'shop_orders').find((x) => x.orderNo === '#3001');
  assert.deepEqual([o.amountInr, o.channel, o.status, o.items], [25200, 'Meta', 'in_production', '2 × Isla Kaftan (M); 1 × Mystery robe']);
  assert.equal(slips().length, 3);
  assert.deepEqual(slips().map((s) => [s.styleName || 'matched', s.size || '', !!s.needsInfo]).sort(), [['Mystery robe', '', false], ['matched', 'M', false], ['matched', 'M', false]]);
  assert.match(slips()[0].measurements, /Length: 52in\nGift wrap|Gift wrap/);
});

test('one form for the store, shoots and influencers; high priority needs a reason', () => {
  assert.throws(() => run('order.place', { kind: 'shoot', style: shirt.id, qty: 2, priority: 'high', promised: '2026-11-20' }, marketing), /why this is high priority/);
  const out = run('order.place', { kind: 'shoot', style: shirt.id, size: 'M', qty: 2, priority: 'high', priorityReason: 'Campaign shoot on the 21st', purpose: 'Resort lookbook', promised: '2026-11-20' }, marketing);
  assert.match(out.message, /Order INT-0001 is placed: 2 slips/);
  assert.ok(inbox(manager).includes('Tara ordered 2 × Palm shirt, high priority, needed 2026-11-20'));
});

test('the slip is scanned along: master, tailor, QC, rework, pass, finish, pack', () => {
  const s = slips().find((x) => x.orderNo === 'INT-0001');
  // a tailor cannot start a slip nobody has given out
  assert.throws(() => run('slip.scan', { code: s.no }, tailor), /not been given to a master/);
  act('slip.assign', 'slips', s.id, { master: 'Master Salim' }, manager);
  act('slip.cut', 'slips', s.id, {}, manager);
  // the QR code holds a link to the slip; the number alone works too
  assert.match(run('slip.scan', { code: `https://deme.test/#slip-${s.no}` }, tailor).message, /is yours/);
  assert.throws(() => run('slip.qcIn', { code: s.no }, qc), /still being stitched/);
  assert.equal(run('slip.scan', { code: s.no.toLowerCase() }, tailor).data.status, 'stitched');
  run('slip.qcIn', { code: s.no }, qc);
  assert.throws(() => run('slip.qc', { code: s.no, result: 'rework' }, qc), /Choose the reason/);
  run('slip.qc', { code: s.no, result: 'rework', reason: 'measurement', note: 'Sleeve 1 cm short' }, qc);
  assert.ok(inbox(tailor).includes(`Slip ${s.no} is back for rework: measurement (Sleeve 1 cm short)`));
  assert.ok(inbox(marketing).some((t) => t.includes('went back for rework: measurement')), 'whoever asked hears about it');
  run('slip.scan', { code: s.no }, tailor); run('slip.scan', { code: s.no }, tailor); run('slip.qcIn', { code: s.no }, qc);
  assert.equal(run('slip.qc', { code: s.no, result: 'pass' }, qc).data.status, 'passed');
  act('slip.finish', 'slips', s.id, {}, manager);
  assert.equal(act('slip.pack', 'slips', s.id, {}, manager).doc.status, 'packed');
  const done = svc.get(manager, 'slips', s.id);
  assert.deepEqual(done.events.map((e) => e.stage), ['Ordered', 'Given to Master Salim', 'Cut', 'Stitching started', 'Stitched', 'Reached QC', 'QC sent back: measurement', 'Rework started', 'Stitched', 'Reached QC', 'QC passed', 'Finished', 'Packed']);
  assert.deepEqual([done.master, done.tailor, done.reworks], ['Master Salim', tailor.id, 1], 'who made it is on record');
});

test('everyone can follow an order; only production sees who is on it', () => {
  const mine = slips(marketing).find((x) => x.orderNo === 'INT-0001' && x.status === 'packed');
  assert.equal(mine.status, 'packed'); assert.equal(mine.promised, '2026-11-20');
  assert.deepEqual([mine.master, mine.tailor, mine.events], [undefined, undefined, undefined], 'no worker names for other teams');
  const online = slips(marketing).find((x) => x.orderNo === '#3001');
  assert.equal(online.customerName, undefined, 'and no customer name for teams that do not handle the order');
  assert.equal(slips(sales).find((x) => x.orderNo === '#3001').customerName, 'Ana Lima');
  assert.throws(() => svc.update(marketing, 'slips', mine.id, { status: 'dispatched' }), /cannot change/);
  // everyone can read the style list to follow and place orders, without prices or the bill of materials
  const seenStyle = svc.list(tailor, 'styles').find((x) => x.id === kaftan.id);
  assert.equal(seenStyle.name, 'Isla kaftan'); assert.equal('wholesale' in seenStyle, false);
});

test('a slip can be marked as missing fabric by hand, and everyone following it sees why', () => {
  const s = slips().find((x) => x.orderNo === 'INT-0001' && x.status === 'new');
  act('slip.assign', 'slips', s.id, { master: 'Master Irfan' }, manager);
  assert.match(act('slip.noFabric', 'slips', s.id, { stuck: 'palm print fabric' }, manager).message, /Stores and merchandising have been told/);
  assert.throws(() => act('slip.cut', 'slips', s.id, {}, manager), /missing fabric/);
  assert.throws(() => run('slip.scan', { code: s.no }, tailor), /stopped: missing palm print fabric/);
  const seen = slips(marketing).find((x) => x.id === s.id);
  assert.deepEqual([seen.noFabric, seen.stuck], [true, 'palm print fabric']);
  assert.ok(inbox(marketing).some((t) => t.includes('is waiting for palm print fabric')));
  act('slip.fabricIn', 'slips', s.id, {}, manager);
  assert.equal(svc.get(admin, 'slips', s.id).noFabric, false);
});

test('when the parcel leaves, its slips are dispatched and the sale is booked in rupees', () => {
  const o = svc.list(admin, 'shop_orders').find((x) => x.orderNo === '#3001');
  for (const s of slips().filter((x) => x.orderNo === '#3001')) db.put('slips', { ...db.get('slips', s.id), status: 'packed' });
  act('shop.pack', 'shop_orders', o.id, { awb: 'AWB-3001' });
  const parcel = svc.list(admin, 'parcels').find((p) => p.barcode === 'AWB-3001');
  act('parcel.papers', 'parcels', parcel.id, { invoiceNo: 'INV-3001', value: 25200 });
  run('gate.scan', { barcode: 'AWB-3001' });
  assert.ok(slips().filter((x) => x.orderNo === '#3001').every((x) => x.status === 'dispatched'));
  assert.ok(svc.list(admin, 'vouchers').some((v) => v.ref === '#3001' && v.amount === 25200), 'USD 300 at 84');
});

test('channel spend comes in by day and is stated in rupees; the same day is replaced, not doubled', () => {
  const rows = [{ date: '2026-11-10', channel: 'meta', campaign: 'Resort 26', spend: 50, currency: 'USD', impressions: 9000, clicks: 300, purchases: 4, revenue: 1100 }, { date: '2026-11-10', channel: 'Google', campaign: 'Brand', spend: 2000, currency: 'INR', clicks: 120, purchases: 2, revenue: 15000 }];
  assert.equal(run('media.ingest', { rows, from: 'Meta' }, marketing).message, '2 lines added, 0 updated.');
  rows[0].spend = 60;
  assert.equal(run('media.ingest', { rows, from: 'Meta' }, marketing).message, '0 lines added, 2 updated.');
  const meta = svc.list(marketing, 'media_days').find((r) => r.channel === 'Meta');
  assert.deepEqual([meta.spend, meta.spendInr, meta.from], [60, 5040, 'Meta']);
  assert.throws(() => run('media.ingest', { rows }, sales), /cannot do this/);
});

test('a customer\'s personal details can be found, handed over and removed; the order stays for the accounts', () => {
  assert.throws(() => run('privacy.find', { q: 'Ana' }, sales), /cannot do this/);
  const found = run('privacy.find', { q: 'ana lima' }).data;
  assert.deepEqual([found.orders.length, found.slips.length, found.parcels.length], [1, 3, 1]);
  assert.throws(() => run('privacy.erase', { orderNos: ['#3001'] }), /Record who asked/);
  run('privacy.erase', { orderNos: ['#3001'], reason: 'Customer email of 11 Nov asking for deletion' });
  const o = svc.list(admin, 'shop_orders').find((x) => x.orderNo === '#3001');
  assert.deepEqual([o.customerName, o.amount], ['Removed on request', 300]);
  assert.ok(slips().filter((x) => x.orderNo === '#3001').every((x) => x.customerName === 'Removed on request' && x.measurements !== 'Length: 52in'));
  assert.equal(run('privacy.find', { q: 'ana lima' }).data.orders.length, 0);
});

test('Shopify and Meta through the API: a pull, and a webhook that must be signed', async () => {
  const asked = [];
  const fetchImpl = async (url, init = {}) => {
    asked.push(String(url));
    if (String(url).includes('myshopify.com')) return { ok: true, status: 200, json: async () => ({ data: { orders: { pageInfo: { hasNextPage: false }, nodes: [{ name: '#4001', createdAt: '2026-11-11T09:00:00Z', note: '', displayFinancialStatus: 'PAID', displayFulfillmentStatus: 'UNFULFILLED', customer: { displayName: 'Bo Chen' }, shippingAddress: { countryCodeV2: 'GB' }, totalPriceSet: { shopMoney: { amount: '12000.00', currencyCode: 'INR' } }, customerJourneySummary: { lastVisit: { utmParameters: { source: 'instagram', medium: 'paid', campaign: 'Resort 26' } } }, lineItems: { nodes: [{ title: 'Palm shirt', quantity: 1, sku: 'SHT', variantTitle: 'M', customAttributes: [{ key: 'Sleeve', value: 'Long' }, { key: '_hidden', value: 'x' }] }] } }] } } }) };
    if (String(url).includes('graph.facebook.com')) { assert.equal(init.headers.authorization, 'Bearer meta-token'); return { ok: true, status: 200, json: async () => ({ data: [{ date_start: '2026-11-11', campaign_name: 'Resort 26', spend: '1500.50', impressions: '20000', clicks: '410', account_currency: 'INR', actions: [{ action_type: 'purchase', value: '3' }], action_values: [{ action_type: 'purchase', value: '36000' }] }] }) }; }
    throw new Error(`unexpected ${url}`);
  };
  const env = { SHOPIFY_STORE: 'deme-test.myshopify.com', SHOPIFY_TOKEN: 'shpat_x', SHOPIFY_WEBHOOK_SECRET: 'whsec', META_AD_ACCOUNT: 'act_123', META_TOKEN: 'meta-token' };
  const api = createApi({ store: { run: async (fn) => fn(root) }, env, fetchImpl });
  root.put('sessions', { id: createHash('sha256').update('tok').digest('hex'), ws: WS, user: admin.id, expires: Date.now() + 6e5 });
  const call = async (path, body, headers = {}, raw) => { const r = await api.handle({ method: 'POST', path, query: new URLSearchParams(), headers: { host: 'deme.test', 'content-type': 'application/json', ...headers }, body, raw: raw ?? JSON.stringify(body), ip: '1' }); return { status: r.status, json: JSON.parse(r.body) }; };
  const pulled = await call('/api/shopify/pull', {}, { cookie: 'deme_sid=tok' });
  assert.equal(pulled.status, 200, JSON.stringify(pulled.json)); assert.equal(pulled.json.message, '1 new order, 1 slip made.');
  assert.match(asked[0], /^https:\/\/deme-test\.myshopify\.com\/admin\/api\/[\d-]+\/graphql\.json$/);
  const s = slips().find((x) => x.orderNo === '#4001');
  assert.deepEqual([s.size, s.measurements], ['M', 'Sleeve: Long']);
  assert.equal(svc.list(admin, 'shop_orders').find((x) => x.orderNo === '#4001').channel, 'Meta');
  const media = await call('/api/media/pull', { since: '2026-11-11' }, { cookie: 'deme_sid=tok' });
  assert.equal(media.json.message, '1 line added, 0 updated.');
  // a webhook: the same order shape Shopify sends, signed with the shared secret
  const order = { name: '#4002', created_at: '2026-11-12T08:00:00+05:30', currency: 'INR', total_price: '7000.00', financial_status: 'paid', fulfillment_status: null, customer: { first_name: 'Dia', last_name: 'Rao', email: 'dia@example.com' }, shipping_address: { country_code: 'IN', address1: '1 Sea Road' }, landing_site: '/?utm_source=google&utm_medium=cpc&utm_campaign=Brand', line_items: [{ sku: 'KAF', title: 'Isla kaftan', variant_title: 'S', quantity: 1, properties: [] }] };
  const raw = JSON.stringify(order);
  assert.equal((await call('/api/shopify/webhook', order, { 'x-shopify-hmac-sha256': 'bm9wZQ==' }, raw)).status, 401, 'an unsigned message is refused');
  const signed = await call('/api/shopify/webhook', order, { 'x-shopify-hmac-sha256': createHmac('sha256', 'whsec').update(raw).digest('base64') }, raw);
  assert.equal(signed.status, 200, JSON.stringify(signed.json));
  const kept = svc.list(admin, 'shop_orders').find((x) => x.orderNo === '#4002');
  assert.deepEqual([kept.customerName, kept.channel, kept.campaign], ['Dia Rao', 'Google', 'Brand']);
  assert.ok(!JSON.stringify(kept).includes('dia@example.com') && !JSON.stringify(kept).includes('Sea Road'), 'no email or address is kept');
  assert.equal(fromShopifyWebhook(order).lines[0].variant, 'S');
});

test('what the smoke test found stays fixed', async () => {
  const dyer = add('suppliers', { name: 'Test Dye House', kind: 'dyer' });
  const outside = svc.getUser((await svc.createUser(admin, { name: 'Outside desk', email: 'desk@dye.test', password: 'correct-horse', position: 'dyehouse', supplier: dyer.id })).id);
  const one = run('order.place', { kind: 'store', style: shirt.id, qty: 1, promised: '2026-12-01' }, sales).data.slips[0];
  act('slip.assign', 'slips', one.id, { master: 'Master Salim' }, manager); act('slip.cut', 'slips', one.id, {}, manager);
  run('slip.scan', { code: one.no }, tailor); run('slip.scan', { code: one.no }, tailor);
  // the tailor who stitched it, and an outside login, cannot judge it
  for (const who of [tailor, outside]) { assert.throws(() => run('slip.qcIn', { code: one.no }, who), /cannot do this/); assert.throws(() => run('slip.qc', { code: one.no, result: 'pass' }, who), /cannot do this/); }
  // an outside login reads nothing it was not handed, and sees no one but itself
  assert.deepEqual(svc.readable(outside), []);
  assert.deepEqual(svc.listUsers(outside).map((u) => u.id), [outside.id]);
  // a missing payload is an empty one, not a crash; a bad row is refused with a message
  assert.throws(() => svc.act(tailor, 'slip.scan', { payload: null }), /Scan the code on the slip/);
  assert.throws(() => run('media.ingest', { rows: [null] }, marketing), /A line is empty/);
  assert.equal(run('shopify.ingest', { orders: [null, 5] }).message, 'Nothing new.');
  // a foreign invoice is never booked one for one
  const buyer = add('customers', { name: 'Synthetic Buyer', kind: 'b2b', currency: 'GBP' });
  const inv = add('invoices', { customer: buyer.id, currency: 'GBP', lines: [{ style: shirt.id, qty: 10, price: 50 }] });
  assert.throws(() => act('inv.post', 'invoices', inv.id), /Enter the rupees per GBP/);
  const usd = add('invoices', { customer: buyer.id, currency: 'USD', lines: [{ style: shirt.id, qty: 10, price: 50 }] });
  assert.match(act('inv.post', 'invoices', usd.id).message, /₹42,000/, 'the rate on record is used');
  // the accounts can post an invoice
  const fin = await person('Asha', 'receivables');
  svc.update(fin, 'invoices', inv.id, { fx: 105 }); assert.equal(act('inv.post', 'invoices', inv.id, {}, fin).doc.status, 'posted');
  // a check cannot pass more than it checked; text has a sensible length
  const wo = add('work_orders', { channel: 'D2C', style: shirt.id, qty: 10, due: '2026-12-01' });
  assert.throws(() => add('qc_checks', { workOrder: wo.id, stage: 'final', checked: 5, passed: 9 }), /cannot add up to 9/);
  assert.throws(() => add('items', { code: 'X'.repeat(400), name: 'Too long', kind: 'trim', unit: 'pcs' }), /too long/);
  // no name reaches the accounts: the sale's narration carries the order number only
  assert.ok(svc.list(admin, 'vouchers').filter((v) => /^Shopify order/.test(v.narration)).every((v) => !/ for /.test(v.narration)));
});
