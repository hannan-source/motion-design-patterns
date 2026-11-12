#!/usr/bin/env node
// API-level smoke test for Deme Intelligence, with obviously synthetic data.
// Usage: node tools/smoke.mjs [base-url]      (default http://localhost:8870)
// Needs a FRESH, EMPTY system: it creates the first admin through POST /api/setup.
// Dependency-free, Node 22. Prints one line per check; exits non-zero if any check failed.

const BASE = (process.argv[2] || 'http://localhost:8870').replace(/\/$/, '');
const PASSWORD = 'smoke-test-password-1';
const TODAY = new Date().toISOString().slice(0, 10);
const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const MONTH = TODAY.slice(0, 7);

let passed = 0, failed = 0;
const failures = [];
const seen500 = [];
const ok = (name, cond, detail = '') => {
  if (cond) { passed++; console.log(`ok   ${name}`); } else { failed++; failures.push(name); console.log(`FAIL ${name}${detail ? `: ${String(detail).slice(0, 400)}` : ''}`); }
  return !!cond;
};
const short = (r) => `${r.status} ${JSON.stringify(r.json ?? r.text ?? '').slice(0, 300)}`;

class Client {
  constructor(label) { this.label = label; this.cookie = ''; this.user = null; }
  async raw(method, path, body, extra = {}) {
    const headers = { origin: BASE };
    if (body !== undefined || method === 'POST' || method === 'PUT') headers['content-type'] = 'application/json';
    if (this.cookie) headers.cookie = this.cookie;
    Object.assign(headers, extra);
    let res;
    try { res = await fetch(BASE + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : (method === 'POST' || method === 'PUT' ? '{}' : undefined) }); }
    catch (e) { return { status: 0, json: null, text: String(e), res: null }; }
    const sc = res.headers.getSetCookie?.() || [];
    const sid = sc.map((c) => c.split(';')[0]).find((c) => c.startsWith('deme_sid='));
    if (sid && sid !== 'deme_sid=') this.cookie = sid;
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
    if (res.status >= 500) seen500.push(`${this.label} ${method} ${path} -> ${res.status} ${text.slice(0, 120)}`);
    return { status: res.status, json, text, res };
  }
  get(path) { return this.raw('GET', path); }
  post(path, body = {}) { return this.raw('POST', path, body); }
  put(path, body = {}) { return this.raw('PUT', path, body); }
  list(entity) { return this.get(`/api/data/${entity}`).then((r) => (r.status === 200 ? r.json : [])); }
  create(entity, body) { return this.post(`/api/data/${entity}`, body); }
  update(entity, id, body) { return this.put(`/api/data/${entity}/${id}`, body); }
  /** Record action. */
  act(action, entity, id, payload = {}) { return this.post(`/api/action/${action}`, { entity, id, payload }); }
  /** Global (scan / self-service) action. */
  run(action, payload = {}) { return this.post(`/api/action/${action}`, { payload }); }
  async login(email) { const r = await this.post('/api/login', { email, password: PASSWORD }); this.user = r.json?.user || null; return r; }
}

const msgOf = (r) => r.json?.message ?? r.json?.error ?? '';
/** Expect a 200 and (optionally) a message pattern; returns the response. */
function expectOk(name, r, pattern) {
  const good = r.status === 200 && (!pattern || pattern.test(msgOf(r)));
  ok(name, good, short(r));
  return r;
}
function expectRefused(name, r, status = [400, 403], pattern) {
  const sts = Array.isArray(status) ? status : [status];
  ok(name, sts.includes(r.status) && (!pattern || pattern.test(msgOf(r))), short(r));
  return r;
}

const S = {};            // records carried between steps
const created = {};      // counts of what we created, by entity, for the final cross-check
const track = (entity, n = 1) => { created[entity] = (created[entity] || 0) + n; };
async function make(c, entity, body, label) {
  const r = await c.create(entity, body);
  if (!ok(`create ${entity}: ${label || body.name || body.code || body.orderNo || ''}`, r.status === 200 && r.json?.doc?.id, short(r))) return null;
  track(entity);
  return r.json.doc;
}

// ───────────────────────── 1. People and organisation ─────────────────────────
const PEOPLE = [
  // key, first name, position, expected role
  ['founder', 'Ada', 'founder', 'founder'],
  ['prodhead', 'Bram', 'prod_b2b', 'production_head'],
  ['prodmgr', 'Cleo', 'prod_manager', 'production_manager'],
  ['tailor', 'Dev', 'masters', 'operator'],
  ['merch', 'Esme', 'merch', 'b2b'],
  ['stores', 'Finn', 'stores', 'stores'],
  ['runner', 'Gus', 'runner', 'stores'],
  ['dyecheck', 'Hana', 'dyecheck', 'qc'],
  ['dyehouse', 'Ivo', 'dyehouse', 'dyer'],
  ['qc', 'Jude', 'qc', 'qc'],
  ['dispatch', 'Kira', 'dispatch', 'dispatch'],
  ['papers', 'Lena', 'papers', 'logistics'],
  ['logistics', 'Milo', 'logistics', 'logistics'],
  ['sales', 'Nora', 'sales', 'sales'],
  ['finance', 'Otto', 'finance', 'finance'],
  ['hr', 'Pia', 'hr', 'hr_admin'],
  ['marketing', 'Quin', 'marketing', 'marketing'],
  ['staff', 'Rae', 'staff', 'staff'],
  ['designer', 'Tess', 'design', 'design'],
];
const email = (key) => `${key}@smoke.test`;
const C = {};   // clients by key

async function part1() {
  console.log('\n# 1. People and organisation');
  const anon = new Client('anon');
  const st0 = await anon.get('/api/state');
  ok('fresh system reports setupNeeded', st0.json?.setupNeeded === true, short(st0));
  expectRefused('no session, no data', await anon.get('/api/data/items'), 401);
  expectRefused('a cross-site origin is refused', await anon.raw('POST', '/api/login', { email: 'x@smoke.test', password: PASSWORD }, { origin: 'http://evil.example' }), 403);
  expectRefused('a change without JSON content type is refused', await anon.raw('POST', '/api/login', undefined, { 'content-type': 'text/plain' }), 415);
  expectRefused('a short password is refused at setup', await anon.post('/api/setup', { name: 'Zed Smoketest', email: 'zed@smoke.test', password: 'short' }), 400);

  C.admin = new Client('admin');
  const setup = await C.admin.post('/api/setup', { name: 'Zed Smoketest', email: email('admin'), password: PASSWORD });
  ok('setup creates the first admin and a session cookie', setup.status === 200 && C.admin.cookie.startsWith('deme_sid='), short(setup));
  ok('first user is system admin with position setup', setup.json?.user?.role === 'admin' && setup.json?.user?.position === 'setup', short(setup));
  expectRefused('setup runs once', await new Client('anon').post('/api/setup', { name: 'X', email: 'x@smoke.test', password: PASSWORD }), 409);
  const st1 = await C.admin.get('/api/state');
  ok('state after setup: setupNeeded false and user present', st1.json?.setupNeeded === false && st1.json?.user?.email === email('admin'), short(st1));

  // The dye house login needs its supplier: create the supplier first (admin may write masters).
  S.dyerAlpha = await make(C.admin, 'suppliers', { name: 'Test Dye House Alpha', kind: 'dyer', city: 'Surat' });

  for (const [key, first, position, role] of PEOPLE) {
    const body = { name: `${first} Smoketest`, email: email(key), password: PASSWORD, position };
    if (key === 'dyehouse') body.supplier = S.dyerAlpha?.id;
    const r = await C.admin.post('/api/users', body);
    ok(`create login ${key} (${position}) lands as role ${role}`, r.status === 200 && r.json?.role === role && r.json?.position === position, short(r));
    track('users');
    C[key] = new Client(key);
    const li = await C[key].login(email(key));
    ok(`login ${key}`, li.status === 200 && !!C[key].cookie, short(li));
    S[`user_${key}`] = r.json;
  }
  expectRefused('wrong password is refused', await new Client('anon').post('/api/login', { email: email('tailor'), password: 'wrong-password-x' }), 401);

  // Work centres: name a head for each.
  const centres = await C.admin.list('work_centres');
  S.centres = Object.fromEntries(centres.map((c) => [c.key, c]));
  ok('nine starting work centres exist', centres.length === 9, `got ${centres.length}`);
  const ws = await C.admin.list('workstations');
  ok('starting workstations exist (production has 7)', ws.filter((w) => w.centre === S.centres.production?.id).length === 7, `got ${ws.length}`);
  const heads = { production: 'prodhead', merchandising: 'merch', design: 'designer', stores: 'stores', dispatch: 'dispatch', finance: 'finance', people: 'hr', marketing: 'marketing' };
  for (const [centre, key] of Object.entries(heads)) {
    const r = await C.admin.update('work_centres', S.centres[centre].id, { head: S[`user_${key}`].id });
    expectOk(`name ${key} head of ${centre}`, r);
  }
  const inbox = (await C.prodhead.get('/api/inbox')).json || [];
  ok('production head is told they are in charge of Production', inbox.some((n) => n.text === 'You are now in charge of Production'), JSON.stringify(inbox.map((n) => n.text)));
  expectRefused('a head cannot rename a work centre', await C.merch.update('work_centres', S.centres.production.id, { name: 'Mine' }), [403]);

  // A person with no position picks one; the head confirms.
  const nb = await C.admin.post('/api/users', { name: 'Sol Smoketest', email: email('newbie'), password: PASSWORD, role: 'staff' });
  ok('create a login with no position', nb.status === 200 && nb.json?.role === 'staff' && !nb.json?.position, short(nb));
  track('users');
  C.newbie = new Client('newbie'); await C.newbie.login(email('newbie'));
  S.user_newbie = nb.json;
  const pick = await C.newbie.post('/api/me/position', { position: 'prod_manager' });
  ok('newbie picks a position, it stays pending', pick.status === 200 && pick.json?.role === 'staff', short(pick));
  const ph = (await C.prodhead.get('/api/inbox')).json || [];
  ok('production head is asked to confirm', ph.some((n) => n.text === 'Sol Smoketest asks to join as Production manager'), JSON.stringify(ph.map((n) => n.text)));
  expectRefused('another head cannot confirm', await C.merch.post(`/api/users/${nb.json.id}/join`, { ok: true }), 403);
  expectOk('production head confirms', await C.prodhead.post(`/api/users/${nb.json.id}/join`, { ok: true }));
  const nb2 = await C.newbie.get('/api/boot');
  ok('newbie is now production_manager in Production', nb2.json?.user?.role === 'production_manager' && nb2.json?.user?.centre === S.centres.production.id, short(nb2));

  // Things people must NOT be able to do.
  expectRefused('tailor cannot read suppliers', await C.tailor.get('/api/data/suppliers'), 403);
  expectRefused('tailor cannot read work orders', await C.tailor.get('/api/data/work_orders'), 403);
  expectRefused('team member cannot create the go-live plan', await C.staff.run('golive.create', {}), 403);
  expectRefused('outside dye house cannot list dye lots', await C.dyehouse.get('/api/data/dye_lots'), 403);
  expectRefused('outside dye house cannot read suppliers', await C.dyehouse.get('/api/data/suppliers'), 403);
  expectRefused('marketing cannot read vouchers', await C.marketing.get('/api/data/vouchers'), 403);
  expectRefused('finance cannot read employees (salaries)', await C.finance.get('/api/data/employees'), 403);
  expectRefused('team member cannot create users', await C.staff.post('/api/users', { name: 'X', email: 'x@smoke.test', password: PASSWORD, role: 'founder' }), 403);
  expectRefused('tailor cannot read audit', await C.tailor.get('/api/audit'), 403);
  expectRefused('tailor cannot read the event feed', await C.tailor.get('/api/events?after=0'), 403);
  expectRefused('team member cannot manage service keys', await C.staff.get('/api/keys'), 403);
  const hrMe = await C.hr.get('/api/data/employees');
  ok('HR can read employees', hrMe.status === 200, short(hrMe));
}

// ───────────────────────── 2. Reference data ─────────────────────────
const SHADES = ['Coral', 'Sand', 'Jade', 'Ink'];
async function part2() {
  console.log('\n# 2. Reference data');
  const m = C.merch;
  S.millOne = await make(m, 'suppliers', { name: 'Test Mill One', kind: 'mill', city: 'Surat', terms: 30 });
  S.millTwo = await make(m, 'suppliers', { name: 'Test Mill Two', kind: 'mill', city: 'Ahmedabad', terms: 45 });
  S.dyerBeta = await make(m, 'suppliers', { name: 'Test Dye House Beta', kind: 'dyer', city: 'Jetpur' });
  S.vendorDelhi = await make(m, 'suppliers', { name: 'Test Vendor Delhi', kind: 'maker', city: 'Delhi' });
  S.vendorMumbai = await make(m, 'suppliers', { name: 'Test Vendor Mumbai', kind: 'maker', city: 'Mumbai' });
  S.courier = await make(m, 'suppliers', { name: 'Test Courier One', kind: 'courier', city: 'Mumbai' });
  S.trimsSupplier = await make(m, 'suppliers', { name: 'Test Trims Supplier', kind: 'trims', city: 'Mumbai' });
  // (Test Dye House Alpha was created in part 1 for the dye house login.)
  S.wholesale = await make(m, 'customers', { name: 'Synthetic Wholesale 01', kind: 'b2b', country: 'US', currency: 'USD', terms: 30 });
  S.storeCust = await make(m, 'customers', { name: 'Synthetic Store 01', kind: 'store', country: 'IN', currency: 'INR', terms: 15 });

  // Fabrics: linen and voile from the store; RFD cotton straight to the dye house.
  S.linen = await make(m, 'items', { code: 'FAB-LIN', name: 'Test Linen', kind: 'fabric', unit: 'm', cost: 150, dyeCost: 50 });
  S.voile = await make(m, 'items', { code: 'FAB-VOI', name: 'Test Voile', kind: 'fabric', unit: 'm', cost: 100, dyeCost: 40 });
  S.rfd = await make(m, 'items', { code: 'FAB-RFD', name: 'Test Cotton RFD', kind: 'fabric', unit: 'm', rfd: true, cost: 90, dyeCost: 30 });
  S.thread1 = await make(m, 'items', { code: 'THR-IVY', name: 'Test Thread Ivory', kind: 'thread', unit: 'cones', cost: 50, minLevel: 20 });
  S.thread2 = await make(m, 'items', { code: 'THR-BLK', name: 'Test Thread Black', kind: 'thread', unit: 'cones', cost: 55, minLevel: 20 });
  S.trim1 = await make(m, 'items', { code: 'TRM-BTN', name: 'Test Button', kind: 'trim', unit: 'pcs', cost: 3, minLevel: 500 });
  S.trim2 = await make(m, 'items', { code: 'TRM-ZIP', name: 'Test Zip', kind: 'trim', unit: 'pcs', cost: 12, minLevel: 200 });
  const sm = { smvCut: 5, smvStitch: 30, smvFinish: 5, smvQc: 3, smvPack: 2 };
  // Eight styles. SAND styles cut from dyed linen; JADE styles from dyed RFD cotton, which will not be in stock for a while.
  const defs = [
    ['SM-KAF', 'Test Isla Kaftan', S.linen, 'Sand', 2.5], ['SM-SHT', 'Test Palm Shirt', S.linen, 'Sand', 1.8], ['SM-DRS', 'Test Sea Dress', S.rfd, 'Jade', 3],
    ['SM-TUN', 'Test Dune Tunic', S.linen, 'Sand', 2], ['SM-PNT', 'Test Wide Pant', S.voile, 'Coral', 2.2], ['SM-SKT', 'Test Wrap Skirt', S.voile, 'Coral', 1.5],
    ['SM-JKT', 'Test Light Jacket', S.rfd, 'Ink', 2.8], ['SM-SRT', 'Test Sarong', S.voile, 'Coral', 2],
  ];
  S.styles = [];
  for (const [code, name, fab, shade, metres] of defs) {
    const st = await make(m, 'styles', { code, name, fabric: fab?.id, shade, metres, cones: 4, ...sm, wholesale: 3000, retail: 8400, status: 'active', bom: [{ item: S.thread1?.id, qty: 0.04 }, { item: S.trim1?.id, qty: 6 }] }, name);
    if (st) S.styles.push(st);
  }
  ok('eight styles created', S.styles.length === 8, `got ${S.styles.length}`);
  S.kaftan = S.styles[0]; S.shirt = S.styles[1]; S.dress = S.styles[2]; S.pant = S.styles[4];

  const f = C.finance;
  for (const [currency, rate] of [['USD', 84], ['GBP', 105], ['EUR', 90], ['AED', 22.9]]) {
    await make(f, 'fx_rates', { currency, rate, date: '2026-01-01' }, `${currency} ${rate}`);
  }
  // Read-back: a plain team member can read style names but not wholesale prices.
  const seen = (await C.staff.list('styles')).find((s) => s.id === S.kaftan?.id);
  ok('team member sees style name but not wholesale price or bill of materials', seen?.name === S.kaftan?.name && !('wholesale' in seen) && !('bom' in seen), JSON.stringify(seen));
  const suppliersMerch = await m.list('suppliers');
  ok('merch lists all eight suppliers', suppliersMerch.length === 8, `got ${suppliersMerch.length}`);
  expectRefused('duplicate style code is refused or accepted? (checking validation of missing required field)', await m.create('styles', { name: 'No code' }), 400);
  expectRefused('bad select value is refused', await m.create('items', { code: 'BAD', name: 'Bad', kind: 'nonsense', unit: 'm' }), 400);
}

// ───────────────────────── 3. Fabric ─────────────────────────
async function part3() {
  console.log('\n# 3. Fabric');
  const m = C.merch, s = C.stores;
  const po = await make(m, 'purchase_orders', { supplier: S.millOne.id, needBy: addDays(TODAY, 14), lines: [{ item: S.linen.id, qty: 400, rate: 150 }, { item: S.thread1.id, qty: 60, rate: 50 }, { item: S.trim1.id, qty: 2000, rate: 3 }] }, 'PO to Test Mill One');
  S.po = po;
  expectRefused('merchandising head cannot approve their own PO (admin level)', await m.act('po.approve', 'purchase_orders', po.id), 403);
  expectOk('founder approves PO', await C.founder.act('po.approve', 'purchase_orders', po.id), /approved/);
  expectOk('send PO', await m.act('po.send', 'purchase_orders', po.id), /sent/);
  ok('PO total computed (400*150+60*50+2000*3 = 69000)', (await m.list('purchase_orders')).find((p) => p.id === po.id)?.total === 69000, JSON.stringify((await m.list('purchase_orders'))[0]));

  // Receipt at the store: 5 linen rolls of 80 m, thread and trims.
  const grn = await make(s, 'goods_receipts', { po: po.id, supplier: S.millOne.id, invoiceNo: 'SMOKE-INV-1', lines: [{ item: S.linen.id, qty: 400, rolls: 5, rate: 150 }, { item: S.thread1.id, qty: 60, rate: 50 }, { item: S.trim1.id, qty: 2000, rate: 3 }] }, 'GRN at store');
  S.grn = grn;
  const posted = expectOk('post store receipt', await s.act('grn.post', 'goods_receipts', grn.id), /5 rolls are waiting for inspection/);
  ok('receipt posted opens a bill', /a bill of ₹69,000 is open/.test(msgOf(posted)), msgOf(posted));
  expectRefused('a receipt cannot be posted twice', await s.act('grn.post', 'goods_receipts', grn.id), 400, /posted/);
  const items = await s.list('items');
  ok('thread on hand is 60 after the receipt', items.find((i) => i.id === S.thread1.id)?.onHand === 60, JSON.stringify(items.find((i) => i.id === S.thread1.id)));
  const rolls1 = (await s.list('rolls')).filter((r) => r.grn === grn.id).sort((a, b) => a.no.localeCompare(b.no));
  ok('five linen rolls of 80 m at the Dock', rolls1.length === 5 && rolls1.every((r) => r.metres === 80 && r.location === 'Dock'), JSON.stringify(rolls1.map((r) => [r.no, r.metres, r.location])));
  S.rolls1 = rolls1;
  const q = C.qc;
  expectOk('inspect roll 1: pass', await q.act('roll.inspect', 'rolls', rolls1[0].id, { points: 20 }), /passed inspection/);
  expectOk('inspect roll 2: pass', await q.act('roll.inspect', 'rolls', rolls1[1].id, { points: 40 }), /passed inspection/);
  expectOk('inspect roll 3: pass', await q.act('roll.inspect', 'rolls', rolls1[2].id, { points: 10 }), /passed inspection/);
  expectOk('inspect roll 4: pass', await q.act('roll.inspect', 'rolls', rolls1[3].id, { points: 5 }), /passed inspection/);
  const fail = expectOk('inspect roll 5: fail opens a claim on the mill', await q.act('roll.inspect', 'rolls', rolls1[4].id, { points: 55, defects: 'Weft bars', reason: 'weave' }), /failed inspection.*Claim CLM-\d+ for ₹12,000 is open on Test Mill One/);
  S.claim1No = /CLM-\d+/.exec(msgOf(fail))?.[0];
  expectRefused('negative penalty points are refused', await q.act('roll.inspect', 'rolls', rolls1[3].id, { points: -1 }), 400);
  const claims = await q.list('claims');
  ok('claim 1: against mill, before dyeing, 80 m, 12000, open', claims.length === 1 && claims[0].against === 'mill' && claims[0].stage === 'before' && claims[0].metres === 80 && claims[0].amount === 12000 && claims[0].status === 'open', JSON.stringify(claims));
  const bills = await C.finance.list('bills');
  ok('mill bill reduced by the claim (69000 - 12000 = 57000)', bills.find((b) => b.ref === grn.no)?.amount === 57000, JSON.stringify(bills));
  S.millBill = bills.find((b) => b.ref === grn.no);
  const vch = await C.finance.list('vouchers');
  ok('a Debit Note voucher of 12000 against Test Mill One', vch.some((v) => v.type === 'Debit Note' && v.dr === 'Test Mill One' && v.amount === 12000), JSON.stringify(vch.filter((v) => v.type === 'Debit Note')));
  ok('inspection records: 3 pass + ... (5 inspections, 4 pass 1 fail)', (await q.list('inspections')).filter((i) => i.result === 'pass').length === 4, '');

  // RFD fabric: mill delivers straight to Test Dye House Alpha with a mill QC report.
  const grn2 = await make(s, 'goods_receipts', { supplier: S.millTwo.id, deliveredTo: 'dyer', dyer: S.dyerAlpha.id, millReport: 'ok', millHeld: 40, invoiceNo: 'SMOKE-INV-2', lines: [{ item: S.rfd.id, qty: 300, rolls: 3, rate: 90 }] }, 'GRN straight to dye house');
  expectOk('post receipt delivered to dye house', await s.act('grn.post', 'goods_receipts', grn2.id), /3 rolls are at Test Dye House Alpha.*mill's report/);
  const rfdRolls = (await s.list('rolls')).filter((r) => r.grn === grn2.id).sort((a, b) => a.no.localeCompare(b.no));
  ok('RFD rolls are held at the dye house', rfdRolls.length === 3 && rfdRolls.every((r) => r.heldAt === S.dyerAlpha.id && r.location === 'At Test Dye House Alpha'), JSON.stringify(rfdRolls.map((r) => [r.heldAt, r.location])));
  S.rfdRolls = rfdRolls;
  expectOk('accept RFD roll 1 on the mill report', await C.dyecheck.act('roll.accept', 'rolls', rfdRolls[0].id), /accepted on the mill's report/);
  expectOk('accept RFD roll 2 on the mill report', await C.dyecheck.act('roll.accept', 'rolls', rfdRolls[1].id));
  const ins = await C.dyecheck.act('roll.inspect', 'rolls', rfdRolls[2].id, { points: 12 });
  expectOk('dye house checker inspects RFD roll 3', ins, /passed inspection/);
  ok('roll 3 checkedBy dyehouse', (await s.list('rolls')).find((r) => r.id === rfdRolls[2].id)?.checkedBy === 'dyehouse', '');
  const grn3 = await make(s, 'goods_receipts', { supplier: S.millOne.id, lines: [{ item: S.linen.id, qty: 50, rolls: 1, rate: 150 }] }, 'GRN of one extra store roll');
  await s.act('grn.post', 'goods_receipts', grn3.id);
  const extra = (await s.list('rolls')).find((r) => r.grn === grn3.id);
  expectRefused('a store roll cannot be accepted without a mill report', await q.act('roll.accept', 'rolls', extra.id), 400, /No mill QC report/);

  // Dye lots. L1 (Alpha): linen rolls 1-3 in Sand; L2 (Beta): roll 4; L3 (Alpha): the RFD rolls in Jade.
  const L1 = await make(s, 'dye_lots', { dyer: S.dyerAlpha.id, shade: 'Sand', rolls: [rolls1[0].id, rolls1[1].id, rolls1[2].id], dueBack: addDays(TODAY, 5) }, 'lot Sand at Alpha');
  const L2 = await make(s, 'dye_lots', { dyer: S.dyerBeta.id, shade: 'Ink', rolls: [rolls1[3].id] }, 'lot Ink at Beta');
  const L3 = await make(s, 'dye_lots', { dyer: S.dyerAlpha.id, shade: 'Jade', rolls: rfdRolls.map((r) => r.id) }, 'lot Jade RFD at Alpha');
  S.L1 = L1; S.L2 = L2; S.L3 = L3;
  const badLot = await make(s, 'dye_lots', { dyer: S.dyerAlpha.id, shade: 'Sand', rolls: [rolls1[4].id] }, 'lot with a rejected roll');
  expectRefused('a rejected roll cannot go on a dye lot', await s.act('dye.send', 'dye_lots', badLot.id), 400, /rejected at inspection/);
  expectOk('send lot 1', await s.act('dye.send', 'dye_lots', L1.id), /sent to Test Dye House Alpha: 3 rolls, 240 m, shade Sand/);
  expectOk('send lot 2', await s.act('dye.send', 'dye_lots', L2.id), /sent to Test Dye House Beta/);
  expectOk('send lot 3', await s.act('dye.send', 'dye_lots', L3.id), /3 rolls, 300 m/);

  // The outside dye house, on its phone screen.
  const d = C.dyehouse;
  const mine = await d.run('fabric.myLots');
  ok('dye house sees only its own lots (L1 and L3, not L2)', mine.status === 200 && mine.json?.data?.lots?.length === 2 && !mine.json.data.lots.some((l) => l.id === L2.id), short(mine));
  expectRefused('dye house cannot report on another dye house\'s lot', await d.run('fabric.report', { dyeLot: L2.id, reason: 'patchy' }), 400, /not at your dye house/);
  const rep = expectOk('dye house reports a problem on its lot', await d.run('fabric.report', { dyeLot: L3.id, roll: rfdRolls[2].id, reason: 'pilling', note: 'Pilling after wash' }), /Report FR-\d+ is sent/);
  const repId = rep.json?.data?.report;
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const up = await d.post('/api/files', { entity: 'fabric_reports', id: repId, name: 'defect.png', type: 'image/png', data: png });
  ok('dye house attaches a small PNG to its report', up.status === 200 && up.json?.id && up.json.size > 0, short(up));
  const fl = await q.get(`/api/files?entity=fabric_reports&id=${repId}`);
  ok('QC lists the photo on the report', fl.status === 200 && fl.json.length === 1, short(fl));
  const got = await q.get(`/api/files/${up.json?.id}`);
  ok('QC downloads the photo and it is the same bytes', got.json?.data === png, short(got).slice(0, 100));
  ok('report shows photos = 1', (await q.list('fabric_reports')).find((r) => r.id === repId)?.photos === 1, '');
  expectRefused('a .exe attachment is refused', await q.post('/api/files', { entity: 'fabric_reports', id: repId, name: 'x.exe', type: 'application/x-msdownload', data: png }), 400, /photo or a PDF/);
  expectRefused('a broken base64 attachment is refused', await q.post('/api/files', { entity: 'fabric_reports', id: repId, name: 'x.png', type: 'image/png', data: 'not base64!!' }), 400);
  const qcInbox = (await q.get('/api/inbox')).json || [];
  ok('QC is told about the dye house report', qcInbox.some((n) => /Ivo Smoketest reports pilling on dye lot/.test(n.text)), JSON.stringify(qcInbox.map((n) => n.text)));

  // Receive. L1: roll 2 fails as the mill's fault (claim). L2: roll 4 fails as nobody's fault (written off). L3: all accepted.
  const r1 = expectOk('receive lot 1 with roll 2 failed (mill fault)', await s.act('dye.receive', 'dye_lots', L1.id, { failed: [rolls1[1].id], fault: 'mill', reason: 'yarn', note: 'Yarn lines across the width' }), /Claim CLM-\d+ is open on Test Mill One/);
  const claims2 = await q.list('claims');
  ok('second claim: after dyeing, against mill, 80 m', claims2.length === 2 && claims2.some((c) => c.stage === 'after' && c.against === 'mill' && c.metres === 80 && c.status === 'open'), JSON.stringify(claims2));
  let vch2 = await C.finance.list('vouchers');
  ok('nothing written off for the mill fault', !vch2.some((v) => v.dr === 'Fabric Loss: Post-Dye Defects'), '');
  const r2 = expectOk('receive lot 2 with roll 4 failed (no fault)', await s.act('dye.receive', 'dye_lots', L2.id, { failed: [rolls1[3].id], fault: 'none', note: 'Shade off' }), /0 m accepted, 80 m failed/);
  vch2 = await C.finance.list('vouchers');
  ok('failure nobody answers for is written off (80 m x (150+50) = 16000)', vch2.some((v) => v.dr === 'Fabric Loss: Post-Dye Defects' && v.amount === 16000), JSON.stringify(vch2.filter((v) => v.type === 'Journal')));
  expectOk('receive lot 3', await s.act('dye.receive', 'dye_lots', L3.id, {}), /300 m accepted/);
  const rollsNow = await s.list('rolls');
  ok('dyed rolls are in the Fabric store with shade Sand', ['0', '2'].every((i) => { const r = rollsNow.find((x) => x.id === rolls1[i].id); return r.status === 'dyed' && r.shade === 'Sand' && r.location === 'Fabric store'; }), '');
  ok('roll 2 went back to the mill as rejected, roll 4 is dye_reject', rollsNow.find((r) => r.id === rolls1[1].id)?.status === 'rejected' && rollsNow.find((r) => r.id === rolls1[3].id)?.status === 'dye_reject', '');
  const claimList = await q.list('claims');
  const claimBefore = claimList.find((c) => c.stage === 'before');
  expectOk('close claim 1 with a credit note', await q.act('claim.credit', 'claims', claimBefore.id, { creditNote: 'SMOKE-CN-1' }), /closed with credit note SMOKE-CN-1/);
  ok('claim 1 is credited', (await q.list('claims')).find((c) => c.id === claimBefore.id)?.status === 'credited', '');
  expectRefused('a claim cannot be credited twice', await q.act('claim.credit', 'claims', claimBefore.id, { creditNote: 'again' }), [400, 404]);
  expectOk('report is marked seen', await q.act('report.seen', 'fabric_reports', repId), /seen/);
  expectOk('report is closed', await q.act('report.close', 'fabric_reports', repId), /closed/);
  const items2 = await s.list('items');
  ok('Test Zip has no stock and is under its minimum (a low-stock candidate)', (items2.find((i) => i.id === S.trim2.id)?.onHand || 0) === 0, '');
  expectOk('stock adjust of buttons by stores', await s.run('stock.adjust', { item: 'TRM-BTN', onHand: 1800, note: 'count' }), /now 1,800 pcs on hand; it was 2,000/);
  expectOk('stock issue of thread', await s.run('stock.issue', { item: 'THR-IVY', qty: 50, ref: 'smoke' }), /Issued 50 cones.*10 left.*under the minimum of 20/);
  expectRefused('cannot issue more than on hand', await s.run('stock.issue', { item: 'THR-IVY', qty: 500 }), 400, /Only 10 cones/);
  const cnt = await make(s, 'stock_counts', { area: 'Thread store', lines: [{ item: S.thread1.id, counted: 12 }] }, 'stock count');
  expectOk('post stock count', await s.act('count.post', 'stock_counts', cnt.id), /corrected/);
}

// ───────────────────────── 4. Production ─────────────────────────
async function part4() {
  console.log('\n# 4. Production');
  const pm = C.prodmgr;
  // A wholesale sales order with vendor lines (also used in part 7).
  const so = await make(C.merch, 'sales_orders', { customer: S.wholesale.id, customerPO: 'SMOKE-PO-9', endBuyer: 'Synthetic Retailer', currency: 'USD', date: TODAY, shipBy: addDays(TODAY, 40), lines: [{ style: S.kaftan.id, qty: 600, price: 40, vendor: S.vendorDelhi.id }, { style: S.shirt.id, qty: 200, price: 40, vendor: S.vendorMumbai.id }, { style: S.pant.id, qty: 20, price: 40 }] }, 'wholesale sales order');
  S.so = so;
  ok('sales order total is 32800 (820 pieces x 40)', (await C.merch.list('sales_orders')).find((x) => x.id === so.id)?.total === 32800, '');
  expectOk('confirm sales order raises three work orders', await C.merch.act('so.confirm', 'sales_orders', so.id), /3 work orders are raised/);
  const wos = (await pm.list('work_orders')).filter((w) => w.source === so.no).sort((a, b) => b.qty - a.qty);
  ok('two vendor work orders and one in-house', wos.map((w) => w.madeBy).join() === 'vendor,vendor,inhouse', wos.map((w) => w.madeBy).join());
  const [bulk, hard, own] = wos; S.wo = { bulk, hard, own };
  expectOk('send bulk to Delhi, checked there', await pm.act('wo.sendOut', 'work_orders', bulk.id, { vendor: S.vendorDelhi.id, qcAt: 'vendor' }), /with Test Vendor Delhi, Delhi\. It will be checked there and shipped from there\./);
  expectOk('send the hard pieces to Mumbai, back for in-house QC', await pm.act('wo.sendOut', 'work_orders', hard.id, { vendor: S.vendorMumbai.id, qcAt: 'inhouse' }), /It comes back here for QC/);
  expectRefused('vendor-passed refused on an in-house-QC order', await C.qc.act('wo.vendorPassed', 'work_orders', hard.id, { pieces: 10 }), 400, /checked in-house/);
  const vp = expectOk('QC at Delhi passes 590, rejects 10', await C.qc.act('wo.vendorPassed', 'work_orders', bulk.id, { pieces: 590, rejected: 10 }), /590 pieces.*10 were rejected/);
  ok('vendor order still at_vendor with pack 590', vp.json?.doc?.status === 'at_vendor' && vp.json.doc.pack === 590, short(vp));
  const vp2 = expectOk('QC at Delhi passes the last 10: done', await C.qc.act('wo.vendorPassed', 'work_orders', bulk.id, { pieces: 10 }), /work order is done/);
  ok('vendor order is done', vp2.json?.doc?.status === 'done', short(vp2));
  expectOk('Mumbai pieces come back', await pm.act('wo.vendorBack', 'work_orders', hard.id, { pieces: 200 }), /200 of 200/);
  expectOk('final QC output on the vendor order', await pm.act('wo.output', 'work_orders', hard.id, { stage: 'qc', pieces: 200 }));
  const pk = expectOk('pack output done', await pm.act('wo.output', 'work_orders', hard.id, { stage: 'pack', pieces: 200 }), /is done: all 200 pieces are packed/);
  ok('vendor-back order is done', pk.json?.doc?.status === 'done', short(pk));
  expectRefused('output cannot run ahead of the stage before', await pm.act('wo.output', 'work_orders', own.id, { stage: 'stitch', pieces: 5 }), 400, /not available|Only 0 pieces/);
  expectOk('release the in-house order', await pm.act('wo.release', 'work_orders', own.id), /released/);
  expectOk('cut 12 pieces', await pm.act('wo.output', 'work_orders', own.id, { stage: 'cut', pieces: 12 }), /12 of 20/);
  expectRefused('stitch beyond cut is refused', await pm.act('wo.output', 'work_orders', own.id, { stage: 'stitch', pieces: 20 }), 400, /Only 12 pieces are cut/);
  expectRefused('cut beyond the order is refused', await pm.act('wo.output', 'work_orders', own.id, { stage: 'cut', pieces: 9 }), 400, /Enter 8 or fewer/);
  expectRefused('a fractional output is refused', await pm.act('wo.output', 'work_orders', own.id, { stage: 'cut', pieces: 1.5 }), 400);
  expectOk('stitch 12', await pm.act('wo.output', 'work_orders', own.id, { stage: 'stitch', pieces: 12 }));
  expectOk('finish 12', await pm.act('wo.output', 'work_orders', own.id, { stage: 'finish', pieces: 12 }));
  expectOk('QC 12', await pm.act('wo.output', 'work_orders', own.id, { stage: 'qc', pieces: 12 }));
  expectOk('pack 12', await pm.act('wo.output', 'work_orders', own.id, { stage: 'pack', pieces: 12 }));

  // Day plan. Sand linen: R1 + R3 dyed = 160 m in the store. Kaftan 2.5 m/piece. A work order for Kaftan and one for Dress (Jade RFD, but the Jade rolls are dyed too: 300 m) and one Ink with no stock.
  // Jade rolls came back dyed (300 m) so the dress has fabric; the jacket (Ink RFD) has none.
  const jacket = S.styles[6];
  const woA = await make(pm, 'work_orders', { channel: 'D2C', style: S.kaftan.id, qty: 60, due: addDays(TODAY, 10) }, 'D2C kaftan x60');
  const woB = await make(pm, 'work_orders', { channel: 'D2C', style: jacket.id, qty: 10, due: addDays(TODAY, 10) }, 'D2C jacket x10 (no fabric)');
  const woC = await make(pm, 'work_orders', { channel: 'STORE', style: S.dress.id, qty: 20, due: addDays(TODAY, 10) }, 'store dress x20');
  S.woA = woA; S.woB = woB; S.woC = woC;
  // Kaftan: 40 pieces need 100 m, 20 need 50 m; only 160 m of Sand in store: first two lines fit (150), jacket line has none.
  const plan = await make(pm, 'day_plans', { date: addDays(TODAY, 1), lines: [{ workOrder: woA.id, master: 'Master Salim', pieces: 40 }, { workOrder: woA.id, master: 'Master Irfan', pieces: 20 }, { workOrder: woB.id, master: 'Master Salim', pieces: 10 }, { workOrder: woC.id, master: 'Master Irfan', pieces: 20 }] }, 'day plan');
  S.plan = plan;
  const chk = expectOk('check the day plan', await pm.act('plan.check', 'day_plans', plan.id), /3 lines have fabric\. 1 line does not/);
  ok('check rows: need 100/50/(30)/60 and Ready/Ready/Short/Ready', JSON.stringify(chk.json?.doc?.check?.map((r) => [r.need, r.ok])) === JSON.stringify([[100, 'Ready'], [50, 'Ready'], [28, 'Short by 28 m'], [60, 'Ready']]), JSON.stringify(chk.json?.doc?.check?.map((r) => [r.need, r.ok])));
  const issued = expectOk('issue the day plan: bundles made, metres set aside', await pm.act('plan.issue', 'day_plans', plan.id), /3 bundles, 210 m set aside\. 1 line was left out: no fabric/);
  const planBundles = (await pm.list('bundles')).filter((b) => b.plan === plan.id);
  ok('three bundles with metres on them', planBundles.length === 3 && planBundles.reduce((n, b) => n + b.metres, 0) === 210, JSON.stringify(planBundles.map((b) => [b.master, b.pieces, b.metres])));
  ok('work order A released; B (no fabric) stays planned', (await pm.list('work_orders')).find((w) => w.id === woA.id)?.status === 'released' && (await pm.list('work_orders')).find((w) => w.id === woB.id)?.status === 'planned', '');
  const runnerInbox = (await C.runner.get('/api/inbox')).json || [];
  ok('fabric runner gets the bundling list', runnerInbox.some((n) => /^Bundling list for .*: 3 bundles, 210 m/.test(n.text)), JSON.stringify(runnerInbox.map((n) => n.text)));
  const rollsNow = await C.stores.list('rolls');
  const sandLeft = rollsNow.filter((r) => r.shade === 'Sand' && ['dyed', 'issued'].includes(r.status)).reduce((n, r) => n + (r.left || 0), 0);
  ok('Sand metres left in the store is 10 (160 - 150)', Math.round(sandLeft) === 10, `left ${sandLeft}`);
  const again = await make(pm, 'day_plans', { date: addDays(TODAY, 2), lines: [{ workOrder: woA.id, master: 'Master Salim', pieces: 1 }] }, 'second day plan');
  expectRefused('a second plan for the same order is refused when the first covers it', await pm.act('plan.check', 'day_plans', again.id), 400, /60 are already cut or with masters/);
  const vendorPlan = await make(pm, 'day_plans', { date: addDays(TODAY, 2), lines: [{ workOrder: bulk.id, master: 'Master Salim', pieces: 5 }] }, 'plan on a vendor order');
  expectRefused('a vendor order cannot go on a day plan', await pm.act('plan.check', 'day_plans', vendorPlan.id), 400, /made by a vendor/);

  // Bundle scans by the tailor at the scan station.
  const b0 = planBundles.find((b) => b.pieces === 40) || planBundles[0];
  S.bundle0 = b0;
  const t = C.tailor;
  expectRefused('tailor cannot read bundles', await t.get('/api/data/bundles'), 403);
  expectOk('tailor starts a bundle (case-insensitive tag)', await t.run('scan.start', { bundle: b0.no.toLowerCase(), station: 'L1-04' }), /Started bundle/);
  expectRefused('a started bundle cannot be started again', await t.run('scan.start', { bundle: b0.no, station: 'L1-05' }), 400, /already being stitched/);
  const fin = expectOk('tailor finishes the bundle', await t.run('scan.finish', { bundle: b0.no }), /Finished bundle .* 40 pieces in 1 minute/);
  expectRefused('a finished bundle cannot be finished again', await t.run('scan.finish', { bundle: b0.no }), 400, /already scanned as finished/);
  expectRefused('an unknown bundle tag is refused', await t.run('scan.start', { bundle: 'NOPE-0' }), 400, /No bundle has the tag/);
  const scans = await pm.list('scans');
  ok('a scan record has minutes and the tailor', scans.length >= 1 && scans[0].minutes >= 1 && scans[0].operator === S.user_tailor.id, JSON.stringify(scans));
  const woAnow = (await pm.list('work_orders')).find((w) => w.id === woA.id);
  ok('work order A: stitch 40 and cut >= 40', woAnow.stitch === 40 && woAnow.cut >= 40, JSON.stringify([woAnow.cut, woAnow.stitch]));
  expectOk('make 4 bundles of 15 on a plain work order', await pm.act('wo.bundles', 'work_orders', woC.id, { count: 4, pieces: 5 }), /4 bundles of 5 pieces made/);
  expectRefused('501 bundles at once is refused', await pm.act('wo.bundles', 'work_orders', woC.id, { count: 501, pieces: 5 }), 400, /500/);

  // Stage output through to packed on woA.
  for (const [stage, n] of [['cut', 40], ['finish', 40], ['qc', 40], ['pack', 40]]) {
    const r = await pm.act('wo.output', 'work_orders', woA.id, { stage, pieces: n });
    ok(`woA output ${stage} ${n}`, r.status === 200 || (stage === 'cut' && r.status === 400), short(r));
  }
  const woA2 = (await pm.list('work_orders')).find((w) => w.id === woA.id);
  ok('woA stitch=40 pack=40 in progress', woA2.pack === 40 && woA2.status === 'in_progress', JSON.stringify([woA2.cut, woA2.stitch, woA2.finish, woA2.qc, woA2.pack, woA2.status]));

  // A garment check.
  const chkd = await make(C.qc, 'qc_checks', { date: TODAY, workOrder: woA.id, stage: 'final', checked: 40, passed: 37, rework: 2, rejected: 1, defects: 'Loose thread' }, 'garment check');
  ok('garment check records the checker as the QC user', chkd?.checker === S.user_qc.id, JSON.stringify(chkd));
  expectRefused('garment check cannot pass more than checked', await C.qc.create('qc_checks', { date: TODAY, workOrder: woA.id, stage: 'final', checked: 5, passed: 9 }), 400);
  // sample request / maintenance
  const col = await make(C.designer, 'collections', { name: 'Test Resort Collection', season: 'Resort 27' }, 'collection');
  const sr = await make(C.designer, 'sample_requests', { collection: col?.id, style: S.kaftan.id, qty: 3, neededBy: addDays(TODAY, 20) }, 'sample request');
  expectOk('approve a sample request raises a work order', await pm.act('sample.approve', 'sample_requests', sr.id), /Work order .* is raised for 3 pieces/);
  const mc = await make(C.prodhead, 'machines', { code: 'SM-MC-1', type: 'Single needle', status: 'running' }, 'machine');
  const mt = await make(pm, 'maintenance', { date: TODAY, machine: mc.id, type: 'breakdown', notes: 'Needle bar' }, 'breakdown');
  ok('a breakdown sets the machine down', (await pm.list('machines')).find((x) => x.id === mc.id)?.status === 'down', '');
  expectOk('close the breakdown', await pm.act('maint.close', 'maintenance', mt.id), /running again/);
}

// ───────────────────────── 5. Made-to-order slips ─────────────────────────
const CHANNELS = ['Meta', 'Google', 'Instagram', 'Email', 'Organic', 'Influencer'];
const CURS = ['INR', 'USD', 'GBP', 'EUR', 'AED', 'INR', 'USD', 'AUD'];
async function part5() {
  console.log('\n# 5. Made-to-order slips');
  const sales = C.sales;
  const codes = S.styles.map((s) => s.code);
  const orders = [];
  let expectSlips = 0, expectNew = 0, expectNoStyle = 0, expectHeld = 0;
  for (let i = 1; i <= 40; i++) {
    const nn = String(i).padStart(2, '0');
    const cur = i === 7 ? 'USD' : CURS[i % CURS.length];
    const shipped = i % 9 === 0, unpaid = i % 13 === 0;
    const lines = [];
    const nl = 1 + (i % 3 === 0 ? 1 : 0);
    for (let k = 0; k < nl; k++) {
      const code = codes[(i + k) % codes.length];
      const bare = i % 8 === 0 && k === 0;                  // no size, no notes
      lines.push({ sku: code, title: `Test ${code}`, variant: bare ? '' : ['XS', 'S', 'M', 'L', 'XL'][(i + k) % 5], qty: i % 11 === 0 ? 2 : 1, notes: bare ? '' : (i % 4 === 0 ? 'Length: 50in' : '') });
    }
    if (i === 17) lines.push({ sku: 'NOPE-99', title: 'Mystery robe', variant: 'M', qty: 1, notes: '' });   // unknown product
    orders.push({ orderNo: `#SM-${1000 + i}`, date: addDays(TODAY, -(i % 50)), customerName: `Synthetic Customer ${nn}`, country: ['US', 'GB', 'IN', 'AE', 'DE', 'AU'][i % 6], currency: cur, amount: 4000 + i * 100, note: i % 5 === 0 ? 'Gift wrap please' : '', paid: !unpaid, shipped, channel: CHANNELS[i % CHANNELS.length], campaign: `Smoke campaign ${i % 4}`, lines });
    if (!shipped && !unpaid) for (const l of lines) {
      const q = Math.min(l.qty, 30); expectSlips += q; expectNew += q;
      if (l.sku === 'NOPE-99') expectNoStyle++;
      if (!l.variant && !l.notes && !'Gift wrap please'.includes(orders[orders.length - 1].note || '#')) expectHeld += q;
    }
  }
  // Two old finished orders for the privacy sweep.
  orders.push({ orderNo: '#SM-OLD-1', date: '2025-01-05', customerName: 'Synthetic Customer 90', country: 'GB', currency: 'INR', amount: 5000, paid: true, shipped: true, lines: [{ sku: codes[0], title: 'Test old', variant: 'M', qty: 1 }] });
  orders.push({ orderNo: '#SM-OLD-2', date: '2025-02-05', customerName: 'Synthetic Customer 91', country: 'IN', currency: 'INR', amount: 6000, paid: true, shipped: true, lines: [{ sku: codes[1], title: 'Test old', variant: 'S', qty: 1 }] });
  S.orders = orders;
  const ing = await sales.run('shopify.ingest', { orders });
  expectOk('ingest 42 online orders', ing, /^42 new orders, \d+ slips made/);
  ok(`slips made = ${expectSlips} as computed from the input`, ing.json?.data?.slips === expectSlips, `message: ${msgOf(ing)}; expected ${expectSlips}`);
  ok('one line with an unknown product reported', ing.json?.data?.unmatched === expectNoStyle, `message: ${msgOf(ing)}; expected unmatched ${expectNoStyle}`);
  ok(`held for measurements = ${expectHeld} (lines with no size and no notes)`, ing.json?.data?.held === expectHeld, `message: ${msgOf(ing)}; expected ${expectHeld}`);
  expectOk('re-ingesting the same orders changes nothing', await sales.run('shopify.ingest', { orders }), /^Nothing new\.$/);
  expectRefused('orders that are not a list are refused', await sales.run('shopify.ingest', { orders: 'x' }), 400);
  const shop = await sales.list('shop_orders');
  ok('42 shop orders exist', shop.length === 42, `got ${shop.length}`);
  const o7 = shop.find((o) => o.orderNo === '#SM-1007');
  ok('USD order #SM-1007 is also stated in rupees at 84', o7?.currency === 'USD' && o7.amountInr === Math.round(o7.amount * 84 * 100) / 100 || o7?.amountInr === o7?.amount * 84, JSON.stringify(o7));
  const aud = shop.filter((o) => o.currency === 'AUD');
  ok('AUD orders (no exchange rate) have no rupee value and are still accepted', aud.length > 0 && aud.every((o) => o.amountInr === undefined || o.amountInr === null), JSON.stringify(aud[0]));
  ok('history orders (shipped) are kept with status shipped', shop.filter((o) => o.orderNo === '#SM-1009')[0]?.status === 'shipped', JSON.stringify(shop.find((o) => o.orderNo === '#SM-1009')));
  ok('unpaid order makes no slips', (await sales.list('slips')).filter((s) => s.orderNo === '#SM-1013').length === 0, '');
  const slips = await sales.list('slips');
  S.slips0 = slips;
  ok('every shopify slip has a number and status new', slips.filter((s) => s.source === 'shopify').every((s) => /^[A-Z]+-\d+$/.test(s.no) && s.status === 'new'), JSON.stringify(slips[0]));
  const needs = slips.filter((s) => s.needsInfo);
  ok('slips with no size and no notes are flagged needsInfo', needs.length === expectHeld, `flagged ${needs.length}, expected ${expectHeld}`);
  const noStyle = slips.find((s) => s.styleName === 'Mystery robe');
  ok('slip for the unknown product keeps its title as styleName', !!noStyle && !noStyle.style, JSON.stringify(noStyle));

  // Privacy of the slip as other teams see it.
  const mk = (await C.marketing.list('slips')).find((s) => s.orderNo === '#SM-1001');
  ok('marketing sees the slip but not customer name or measurements', !!mk && mk.customerName === undefined && mk.master === undefined && mk.events === undefined, JSON.stringify(mk));
  const sl = (await sales.list('slips')).find((s) => s.orderNo === '#SM-1001');
  ok('sales sees the customer name on an online slip', sl?.customerName === 'Synthetic Customer 01', JSON.stringify(sl));
  expectRefused('marketing cannot move a slip by hand', await C.marketing.update('slips', mk.id, { status: 'dispatched' }), 403);

  // Internal orders.
  expectRefused('high priority without a reason is refused', await C.marketing.run('order.place', { kind: 'shoot', style: S.shirt.id, qty: 2, priority: 'high', promised: addDays(TODAY, 9) }), 400, /why this is high priority/);
  const io1 = expectOk('marketing places a shoot order', await C.marketing.run('order.place', { kind: 'shoot', style: S.shirt.id, size: 'M', qty: 2, priority: 'high', priorityReason: 'Campaign shoot', purpose: 'Resort lookbook', promised: addDays(TODAY, 9) }), /Order INT-0001 is placed: 2 slips/);
  const io2 = expectOk('sales places a store order', await C.sales.run('order.place', { kind: 'store', style: S.kaftan.id, size: 'S', qty: 3, promised: addDays(TODAY, 12) }), /Order INT-0002 is placed: 3 slips/);
  expectRefused('order.place needs a date', await C.sales.run('order.place', { kind: 'store', style: S.kaftan.id, qty: 1 }), 400, /date/);
  expectRefused('order.place caps at 30', await C.sales.run('order.place', { kind: 'store', style: S.kaftan.id, qty: 31, promised: addDays(TODAY, 3) }), 400, /between 1 and 30/);
  expectRefused('order.place rejects an unknown kind', await C.sales.run('order.place', { kind: 'nonsense', style: S.kaftan.id, qty: 1, promised: addDays(TODAY, 3) }), 400);
  const pmInbox = (await C.prodmgr.get('/api/inbox')).json || [];
  ok('production manager is told of the internal order', pmInbox.some((n) => n.text === 'Quin Smoketest ordered 2 × Test Palm Shirt, high priority, needed ' + addDays(TODAY, 9)), JSON.stringify(pmInbox.map((n) => n.text)));
  const pmx = C.prodmgr;
  const int1 = (await pmx.list('slips')).filter((s) => s.orderNo === 'INT-0001');
  const int2 = (await pmx.list('slips')).filter((s) => s.orderNo === 'INT-0002');
  ok('INT-0001 has 2 slips and INT-0002 has 3', int1.length === 2 && int2.length === 3, `${int1.length}/${int2.length}`);
  S.int1 = int1; S.int2 = int2;

  // Give slips to masters; missing fabric, cleared; tailor, QC, rework, pass, finish, pack.
  const a = int1[0], b = int1[1];
  expectRefused('a tailor cannot start a slip nobody has given out', await C.tailor.run('slip.scan', { code: a.no }), 400, /not been given to a master/);
  expectOk('assign slip A to Master Salim', await pmx.act('slip.assign', 'slips', a.id, { master: 'Master Salim' }), /is with Master Salim/);
  expectOk('assign slip B to Master Irfan', await pmx.act('slip.assign', 'slips', b.id, { master: 'Master Irfan' }), /is with Master Irfan/);
  expectRefused('assign without a master name is refused', await pmx.act('slip.assign', 'slips', int2[0].id, { master: '' }), 400);
  expectOk('mark slip B as missing fabric', await pmx.act('slip.noFabric', 'slips', b.id, { stuck: 'palm print fabric' }), /Stores and merchandising have been told/);
  expectRefused('cannot cut a slip that is missing fabric', await pmx.act('slip.cut', 'slips', b.id), 400, /missing fabric/);
  expectRefused('tailor scan stops at a missing-fabric slip', await C.tailor.run('slip.scan', { code: b.no }), 400, /stopped: missing palm print fabric/);
  const stInbox = (await C.stores.get('/api/inbox')).json || [];
  ok('stores is told about the missing fabric', stInbox.some((n) => /is stopped: missing palm print fabric/.test(n.text)), JSON.stringify(stInbox.map((n) => n.text)));
  const mqInbox = (await C.marketing.get('/api/inbox')).json || [];
  ok('marketing (who asked) hears it is waiting', mqInbox.some((n) => /is waiting for palm print fabric/.test(n.text)), JSON.stringify(mqInbox.map((n) => n.text)));
  expectOk('clear the missing-fabric flag', await pmx.act('slip.fabricIn', 'slips', b.id), /can go again/);
  expectRefused('clearing twice is refused', await pmx.act('slip.fabricIn', 'slips', b.id), 400);
  expectOk('cut slip A', await pmx.act('slip.cut', 'slips', a.id), /is cut/);
  const t = C.tailor, qc = C.qc;
  expectOk('tailor scans slip A (QR link form)', await t.run('slip.scan', { code: `${BASE}/#slip-${a.no}` }), /is yours/);
  expectRefused('QC cannot take it in while still being stitched', await qc.run('slip.qcIn', { code: a.no }), 400, /still being stitched/);
  expectOk('tailor scans slip A again (lower case)', await t.run('slip.scan', { code: a.no.toLowerCase() }), /is stitched/);
  expectOk('QC scans slip A in', await qc.run('slip.qcIn', { code: a.no }), /is at QC/);
  expectRefused('rework needs a reason', await qc.run('slip.qc', { code: a.no, result: 'rework' }), 400, /Choose the reason/);
  expectOk('QC sends slip A back for rework', await qc.run('slip.qc', { code: a.no, result: 'rework', reason: 'measurement', note: 'Sleeve 1 cm short' }), /goes back for rework/);
  const tInbox = (await t.get('/api/inbox')).json || [];
  ok('tailor is told of the rework', tInbox.some((n) => n.text === `Slip ${a.no} is back for rework: measurement (Sleeve 1 cm short)`), JSON.stringify(tInbox.map((n) => n.text)));
  expectOk('tailor restarts the rework', await t.run('slip.scan', { code: a.no }), /is yours/);
  expectOk('tailor finishes the rework', await t.run('slip.scan', { code: a.no }), /is stitched/);
  expectOk('QC takes it in again', await qc.run('slip.qcIn', { code: a.no }), /at QC/);
  expectOk('QC passes slip A', await qc.run('slip.qc', { code: a.no, result: 'pass' }), /passed QC/);
  expectOk('finish slip A', await pmx.act('slip.finish', 'slips', a.id), /is finished/);
  const packed = expectOk('pack slip A', await pmx.act('slip.pack', 'slips', a.id), /is packed/);
  ok('slip A trail is complete and ordered', JSON.stringify(packed.json?.doc?.events?.map((e) => e.stage)) === JSON.stringify(['Ordered', 'Given to Master Salim', 'Cut', 'Stitching started', 'Stitched', 'Reached QC', 'QC sent back: measurement', 'Rework started', 'Stitched', 'Reached QC', 'QC passed', 'Finished', 'Packed']), JSON.stringify(packed.json?.doc?.events?.map((e) => e.stage)));
  ok('slip A records master, tailor, reworks=1', packed.json?.doc?.master === 'Master Salim' && packed.json.doc.tailor === S.user_tailor.id && packed.json.doc.reworks === 1, JSON.stringify(packed.json?.doc));
  // QC reject
  const c = int2[0];
  await pmx.act('slip.assign', 'slips', c.id, { master: 'Master Salim' }); await pmx.act('slip.cut', 'slips', c.id);
  await t.run('slip.scan', { code: c.no }); await t.run('slip.scan', { code: c.no }); await qc.run('slip.qcIn', { code: c.no });
  expectOk('QC rejects slip C', await qc.run('slip.qc', { code: c.no, result: 'fail', reason: 'stain' }), /is rejected: stain/);
  const cancel = expectOk('cancel slip', await C.admin.act('slip.cancel', 'slips', int2[1].id, { note: 'Customer changed mind' }), /is cancelled/);
  expectOk('add measurements to a held slip', needs[0] ? await pmx.act('slip.details', 'slips', needs[0].id, { size: 'M', measurements: 'Bust 90' }) : { status: 200 }, /has its measurements/);
  if (needs[0]) ok('needsInfo is cleared', (await pmx.list('slips')).find((s) => s.id === needs[0].id)?.needsInfo === false, '');

  // Online-order slips: take 3 USD-order slips and pack them (for the dispatch step).
  const o7slips = (await pmx.list('slips')).filter((s) => s.orderNo === '#SM-1007');
  S.o7slips = o7slips;
  for (const s of o7slips) {
    await pmx.act('slip.assign', 'slips', s.id, { master: 'Master Irfan' }); await pmx.act('slip.cut', 'slips', s.id);
    await t.run('slip.scan', { code: s.no }); await t.run('slip.scan', { code: s.no }); await qc.run('slip.qcIn', { code: s.no }); await qc.run('slip.qc', { code: s.no, result: 'pass' });
    await pmx.act('slip.finish', 'slips', s.id); await pmx.act('slip.pack', 'slips', s.id);
  }
  ok('all slips of #SM-1007 are packed', (await pmx.list('slips')).filter((s) => s.orderNo === '#SM-1007').every((s) => s.status === 'packed') && o7slips.length > 0, `${o7slips.length}`);
  // Everyone can follow an order
  const stf = (await C.staff.list('slips')).find((s) => s.id === a.id);
  ok('a plain team member can follow slip A and sees no worker names', stf?.status === 'packed' && stf.master === undefined && stf.tailor === undefined, JSON.stringify(stf));
}

// ───────────────────────── 6. Dispatch ─────────────────────────
async function part6() {
  console.log('\n# 6. Dispatch');
  const d = C.dispatch, shop = await d.list('shop_orders');
  const o7 = shop.find((o) => o.orderNo === '#SM-1007');
  expectOk('pack the USD order (parcel made)', await d.act('shop.pack', 'shop_orders', o7.id, { awb: 'AWB-SM-1007', carrier: S.courier.id }), /is packed/);
  const o1 = shop.find((o) => o.orderNo === '#SM-1001'), o2 = shop.find((o) => o.orderNo === '#SM-1002'), o3 = shop.find((o) => o.orderNo === '#SM-1003');
  expectOk('pack a second order', await d.act('shop.pack', 'shop_orders', o1.id, { awb: 'AWB-SM-1001' }));
  expectRefused('same barcode on another order is refused', await d.act('shop.pack', 'shop_orders', o2.id, { awb: 'awb-sm-1001' }), 400, /already exists/);
  expectRefused('an empty barcode is refused', await d.act('shop.pack', 'shop_orders', o2.id, { awb: '' }), 400);
  expectOk('pack a third order for the return flow', await d.act('shop.pack', 'shop_orders', o3.id, { awb: 'AWB-SM-1003' }));
  const gate = (code, extra = {}) => d.run('gate.scan', { barcode: code, ...extra });
  expectRefused('unknown barcode at the gate', await gate('NOPE'), 400, /No parcel has this barcode/);
  expectRefused('stopped at the gate: no e-invoice number', await gate('AWB-SM-1007'), 400, /has no e-invoice number yet/);
  const parcels = await C.papers.list('parcels');
  const p7 = parcels.find((p) => p.barcode === 'AWB-SM-1007'), p1 = parcels.find((p) => p.barcode === 'AWB-SM-1001'), p3 = parcels.find((p) => p.barcode === 'AWB-SM-1003');
  const o7now = (await d.list('shop_orders')).find((o) => o.id === o7.id);
  ok('USD order amountInr is amount x 84', Math.abs(o7now.amountInr - o7now.amount * 84) < 1, JSON.stringify(o7now));
  expectRefused('over ₹50,000 needs an e-way bill', await C.papers.act('parcel.papers', 'parcels', p7.id, { invoiceNo: 'SMOKE-EINV-7', value: 60000 }), 400, /needs an e-way bill number/);
  expectOk('paperwork added by the office with the e-way bill', await C.papers.act('parcel.papers', 'parcels', p7.id, { invoiceNo: 'SMOKE-EINV-7', value: o7now.amountInr, ewayNo: 'SMOKE-EWAY-7' }), /Paperwork for .* is in/);
  expectOk('paperwork for parcel 1', await C.papers.act('parcel.papers', 'parcels', p1.id, { invoiceNo: 'SMOKE-EINV-1', value: 9000 }));
  expectOk('paperwork for parcel 3', await C.papers.act('parcel.papers', 'parcels', p3.id, { invoiceNo: 'SMOKE-EINV-3', value: 9000 }));
  const dInbox = (await d.get('/api/inbox')).json || [];
  ok('dispatch is told paperwork is ready', dInbox.some((n) => /Paperwork is ready for parcel AWB-SM-1007/.test(n.text)), JSON.stringify(dInbox.map((n) => n.text)));
  const out = expectOk('scan the USD parcel out', await gate(' awb-sm-1007 '), new RegExp(`Order #SM-1007 is on its way\\. The sale of ₹${Math.round(o7now.amountInr).toLocaleString('en-IN')} is booked`));
  ok('gate direction out, parcel in_transit', out.json?.data?.direction === 'out' && out.json.data.parcel.status === 'in_transit', short(out));
  const slipsNow = (await C.prodmgr.list('slips')).filter((s) => s.orderNo === '#SM-1007');
  ok('slips of the order are dispatched', slipsNow.length > 0 && slipsNow.every((s) => s.status === 'dispatched'), JSON.stringify(slipsNow.map((s) => s.status)));
  const sale = (await C.finance.list('vouchers')).find((v) => v.ref === '#SM-1007');
  ok('sale voucher booked in rupees (USD x 84)', !!sale && Math.abs(sale.amount - o7now.amount * 84) < 1 && sale.type === 'Sales', JSON.stringify(sale));
  S.saleVoucher = sale;
  ok('shop order is shipped', (await d.list('shop_orders')).find((o) => o.id === o7.id)?.status === 'shipped', '');
  expectOk('scan parcel 1 out', await gate('AWB-SM-1001'), /is on its way/);
  expectOk('scan parcel 3 out', await gate('AWB-SM-1003'), /is on its way/);
  // Return
  const back = expectOk('scan parcel 3 back in as a return', await gate('AWB-SM-1003', { note: 'Tags removed' }), /is back at the factory\. Return RET-\d+ is ready/);
  ok('gate direction in', back.json?.data?.direction === 'in', '');
  expectRefused('scanning a returned parcel again is refused', await gate('AWB-SM-1003'), 400, /already scanned in/);
  const ret = (await d.list('returns'))[0];
  ok('return record exists, received, with the condition', ret?.status === 'received' && ret.condition === 'Tags removed', JSON.stringify(ret));
  expectOk('return approved as fit to sell', await d.act('ret.restock', 'returns', ret.id), /is restocked/);
  expectOk('return sold on', await d.act('ret.sold', 'returns', ret.id, { amount: 4500, where: 'Sample sale' }), /sold on for ₹4,500/);
  ok('a Store Sales voucher of 4500 for the resale', (await C.finance.list('vouchers')).some((v) => v.cr === 'Store Sales' && v.amount === 4500 && v.ref === ret.no), '');
  expectOk('tracking update on the parcel', await C.logistics.act('parcel.track', 'parcels', p1.id, { text: 'Arrived at hub' }), /Tracking update added/);
  expectOk('parcel delivered', await C.logistics.act('parcel.delivered', 'parcels', p1.id), /is delivered/);
  // Order in AUD with no exchange rate
  const audOrder = (await d.list('shop_orders')).find((o) => o.currency === 'AUD' && o.status === 'in_production');
  if (audOrder) {
    await d.act('shop.pack', 'shop_orders', audOrder.id, { awb: 'AWB-SM-AUD' });
    const pa = (await C.papers.list('parcels')).find((p) => p.barcode === 'AWB-SM-AUD');
    await C.papers.act('parcel.papers', 'parcels', pa.id, { invoiceNo: 'SMOKE-EINV-AUD', value: 10000 });
    expectRefused(`AUD parcel (${audOrder.orderNo}) with no exchange rate is stopped with a plain message`, await gate('AWB-SM-AUD'), 400, /no exchange rate/);
  }
  // Store piece fit cycle
  const store = await make(C.sales, 'store_orders', { customerName: 'Synthetic Store Client', style: S.kaftan.id, tag: 'ST-SM-1', amount: 9000 }, 'store order');
  expectOk('store piece out', await gate('ST-SM-1'), /scanned out to the store/);
  expectOk('store piece back for fit', await gate('ST-SM-1', { note: 'Shorten hem' }), /fit visit 1/);
  expectOk('store piece out again', await gate('ST-SM-1', { workMinutes: 35 }), /going back to the store/);
  ok('one fit visit recorded', (await d.list('fit_visits')).filter((v) => v.storeOrder === store.id).length === 1, '');
  // Courier invoice
  const ci = await make(C.logistics, 'courier_invoices', { carrier: S.courier.id, invoiceNo: 'SMOKE-BD-77', date: TODAY, lines: [{ awb: 'AWB-SM-1007', billed: 450 }, { awb: 'AWB-SM-9999', billed: 300 }] }, 'courier invoice');
  const mt = expectOk('courier invoice matched: one line unmatched', await C.logistics.act('courier.match', 'courier_invoices', ci.id), /^1 of 2 lines did not match/);
  ok('courier invoice disputed, lines marked', mt.json?.doc?.status === 'disputed' && mt.json.doc.lines.map((l) => l.match).join() === 'OK,No parcel scanned out', short(mt));
  const ci2 = await make(C.logistics, 'courier_invoices', { carrier: S.courier.id, invoiceNo: 'SMOKE-BD-78', date: TODAY, lines: [{ awb: 'AWB-SM-1001', billed: 400 }] }, 'courier invoice 2');
  expectOk('clean courier invoice matches', await C.logistics.act('courier.match', 'courier_invoices', ci2.id), /matches a parcel/);
  expectOk('approve it: bill opened', await C.logistics.act('courier.approve', 'courier_invoices', ci2.id), /A bill of ₹400 is open for Test Courier One/);
}

// ───────────────────────── 7. Money and people ─────────────────────────
async function part7() {
  console.log('\n# 7. Money and people');
  const m = C.merch, f = C.finance;
  const inv = expectOk('invoice the confirmed wholesale order (USD)', await m.act('so.invoice', 'sales_orders', S.so.id), /Invoice .* is drafted/);
  const invDoc = inv.json?.doc ? (await f.list('invoices')).find((i) => i.salesOrder === S.so.id) : null;
  ok('invoice exists in USD with total 32800', invDoc?.currency === 'USD' && invDoc.total === 32800, JSON.stringify(invDoc));
  if (!invDoc) return;
  // Finance (receivables) is the position that owns invoices and money due in.
  const fxTry = await f.update('invoices', invDoc.id, { fx: 84 });
  ok('finance can set the rupee rate on a USD invoice', fxTry.status === 200, short(fxTry));
  const postTry = await f.act('inv.post', 'invoices', invDoc.id);
  ok('finance can post an invoice', postTry.status === 200, short(postTry));
  // Once posted, the invoice is closed to edits, whoever asks.
  const setfx = await m.update('invoices', invDoc.id, { fx: 90 });
  ok('a posted invoice can no longer be edited', setfx.status === 400 && /posted and can no longer be edited/.test(setfx.json?.error || ''), short(setfx));
  const posted = postTry.status === 200 ? postTry : await m.act('inv.post', 'invoices', invDoc.id);
  ok('invoice posted: 32,800 USD at 84 = 27,55,200 due', posted.status === 200 && /is posted: ₹27,55,200 is due from Synthetic Wholesale 01/.test(msgOf(posted)), short(posted));
  expectOk('receive part payment in USD', await f.act('inv.receive', 'invoices', invDoc.id, { amount: 10000 }), /USD 10,000 received.*USD 22,800 is still due/);
  expectOk('receive the rest', await f.act('inv.receive', 'invoices', invDoc.id, { amount: 22800 }), /paid in full/);
  ok('invoice status paid', (await f.list('invoices')).find((i) => i.id === invDoc.id)?.status === 'paid', '');
  const v = await f.list('vouchers');
  ok('Export Sales voucher of 2755200 and a Receipt voucher', v.some((x) => x.type === 'Sales' && x.cr === 'Export Sales' && x.amount === 2755200) && v.filter((x) => x.type === 'Receipt').reduce((n, x) => n + x.amount, 0) === 32800 * 84, JSON.stringify(v.filter((x) => ['Sales', 'Receipt'].includes(x.type)).map((x) => [x.type, x.cr, x.amount])));
  // Supplier bill paid
  const bills = await f.list('bills');
  const bill = bills.find((b) => b.ref === S.grn.no);
  expectRefused('overpaying a bill is refused', await f.act('bill.pay', 'bills', bill.id, { amount: bill.amount + 1 }), 400, /still owed/);
  expectOk('pay half the mill bill', await f.act('bill.pay', 'bills', bill.id, { amount: 20000 }), /₹20,000 paid/);
  expectOk('pay the rest of the mill bill', await f.act('bill.pay', 'bills', bill.id, { amount: bill.amount - 20000 }), /paid in full/);
  // A USD invoice posted without a rupee rate: is it refused, or booked at 1?
  const inv2 = await make(m, 'invoices', { customer: S.wholesale.id, currency: 'USD', date: TODAY, lines: [{ style: S.kaftan.id, qty: 10, price: 50 }] }, 'USD invoice with no rupee rate');
  const p2 = await m.act('inv.post', 'invoices', inv2.id);
  // With a USD rate on record it is booked at that rate; with none on record (GBP here) it is refused. Never one for one.
  ok('a USD invoice with no rate of its own is booked at the rate on record, not 1:1', p2.status === 200 && /₹42,000 is due/.test(msgOf(p2)), short(p2));
  const inv3 = await make(m, 'invoices', { customer: S.wholesale.id, currency: 'AUD', date: TODAY, lines: [{ style: S.kaftan.id, qty: 10, price: 50 }] }, 'AUD invoice with no rate anywhere');
  const p3 = inv3 ? await m.act('inv.post', 'invoices', inv3.id) : { status: 0 };
  ok('an invoice in a currency with no rate on record is refused', p3.status === 400 && /Enter the rupees per AUD/.test(p3.json?.error || ''), short(p3));
  const vs = await f.list('vouchers');
  ok('vouchers are present (purchase, debit note, sales, receipt, payment, journal)', ['Purchase', 'Debit Note', 'Sales', 'Receipt', 'Payment', 'Journal'].every((t) => vs.some((x) => x.type === t)), [...new Set(vs.map((x) => x.type))].join());
  const manual = await make(f, 'vouchers', { date: TODAY, type: 'Journal', dr: 'Indirect Expenses', cr: 'Bank Account', amount: 100, narration: 'Smoke manual journal' }, 'manual voucher');
  // Tally
  const vsNow = await f.list('vouchers');
  const tally = await f.get('/api/export/tally');
  ok('Tally export returns XML', tally.status === 200 && /xml/.test(tally.res.headers.get('content-type') || '') && /<ENVELOPE>/.test(tally.text) && /<VOUCHER /.test(tally.text), `${tally.status} ${tally.text.slice(0, 150)}`);
  ok('Tally XML has one VOUCHER per open voucher', (tally.text.match(/<VOUCHER /g) || []).length === vsNow.filter((x) => x.status === 'open').length, `${(tally.text.match(/<VOUCHER /g) || []).length} vs ${vsNow.filter((x) => x.status === 'open').length}`);
  ok('Tally XML has no raw ampersand', !/&(?!amp;|lt;|gt;|quot;|apos;|#)/.test(tally.text), '');
  expectRefused('marketing cannot export Tally', await C.marketing.get('/api/export/tally'), 403);
  expectOk('mark vouchers synced', await f.run('vouchers.markSynced', { ids: [manual.id] }), /1 voucher is marked as in Tally/);
  // People
  const hr = C.hr;
  const empTailor = await make(hr, 'employees', { code: 'SM-E1', name: 'Dev Smoketest', department: 'Production', designation: 'Tailor', login: S.user_tailor.id, salary: 26000, joinDate: '2025-01-01' }, 'employee tailor');
  await make(hr, 'employees', { code: 'SM-E2', name: 'Old Hand Smoketest', department: 'Production', salary: 30000, status: 'left' }, 'employee left');
  await make(hr, 'employees', { code: 'SM-E3', name: 'Rae Smoketest', department: 'Administration', login: S.user_staff.id, salary: 20000 }, 'employee staff');
  expectRefused('check-in without an employee link is refused', await C.sales.run('hr.checkin', {}), 400, /not linked to an employee record/);
  expectOk('tailor checks in', await C.tailor.run('hr.checkin', {}), /Checked in/);
  expectRefused('double check-in is refused', await C.tailor.run('hr.checkin', {}), 400, /already checked in/);
  expectOk('tailor checks out', await C.tailor.run('hr.checkout', {}), /Checked out/);
  const leaveDay = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => addDays(TODAY, n)).find((d) => d.slice(0, 7) === MONTH && new Date(`${d}T00:00:00Z`).getUTCDay() !== 0) || addDays(TODAY, -1);
  expectOk('tailor applies for leave', await C.tailor.run('hr.applyLeave', { from: leaveDay, to: leaveDay, type: 'Casual', reason: 'Family function' }), /Casual leave applied/);
  expectRefused('leave ending before it starts is refused', await C.tailor.run('hr.applyLeave', { from: leaveDay, to: '2020-01-01' }), 400, /before the first day/);
  const lv = (await hr.list('leaves'))[0];
  expectOk('HR approves the leave', await hr.act('leave.approve', 'leaves', lv.id), /is approved/);
  const run = await make(hr, 'payroll_runs', { month: MONTH }, 'payroll run');
  expectRefused('posting an unbuilt payroll is refused', await hr.act('payroll.post', 'payroll_runs', run.id), 400, /Build it from attendance first/);
  const built = expectOk('build payroll from attendance', await hr.act('payroll.build', 'payroll_runs', run.id), /Payroll for .* is built: 2 people/);
  ok('payroll has two lines (left employee excluded)', built.json?.doc?.lines?.length === 2, short(built));
  expectOk('post payroll', await hr.act('payroll.post', 'payroll_runs', run.id), /is posted/);
  const run2 = await make(hr, 'payroll_runs', { month: MONTH }, 'duplicate payroll run');
  await hr.act('payroll.build', 'payroll_runs', run2.id);
  expectRefused('posting the same month twice is refused', await hr.act('payroll.post', 'payroll_runs', run2.id), 400, /already posted/);
  expectRefused('payroll is invisible to finance', await f.get('/api/data/payroll_runs'), 403);
  const kra = await make(hr, 'kras', { employee: empTailor.id, period: '2026 Q4', title: 'Bundles scanned', target: '200', weight: 50 }, 'KRA');
  const mine = await C.tailor.get('/api/mine');
  ok('tailor sees own HR data via /api/mine', mine.status === 200 && mine.json?.employee?.id === empTailor.id, short(mine).slice(0, 200));
}

// ───────────────────────── 8. Working together ─────────────────────────
async function part8() {
  console.log('\n# 8. Working together');
  const a = C.admin;
  const gl = expectOk('admin creates the go-live plan', await a.run('golive.create', { start: addDays(TODAY, 4) }), /Go-live plan created: \d+ tasks/);
  expectRefused('the plan cannot be created twice', await a.run('golive.create', {}), 400, /already exists/);
  const tasks = await a.list('tasks');
  const golive = tasks.filter((t) => t.ownerRole);
  ok('go-live tasks exist', golive.length > 20, `${golive.length}`);
  ok('merch tasks are assigned to the merch login', golive.filter((t) => t.ownerRole === 'merch').length > 0 && golive.filter((t) => t.ownerRole === 'merch').every((t) => t.assignee === S.user_merch.id), '');
  ok('founder tasks are assigned to the founder login', golive.filter((t) => t.ownerRole === 'founder').every((t) => t.assignee === S.user_founder.id), '');
  ok('prod_manager tasks (two holders) wait for whoever takes them', golive.filter((t) => t.ownerRole === 'prod_manager').every((t) => !t.assignee), JSON.stringify(golive.filter((t) => t.ownerRole === 'prod_manager').map((t) => t.assignee)));
  ok('stores tasks are assigned to the stores login', golive.filter((t) => t.ownerRole === 'stores').every((t) => t.assignee === S.user_stores.id), '');
  const mi = (await C.merch.get('/api/inbox')).json || [];
  ok('merch is told the plan is ready with a count', mi.some((n) => /^The go-live plan is ready: \d+ tasks are yours$/.test(n.text)), JSON.stringify(mi.map((n) => n.text)));
  // Request from one work centre to another.
  const ask = expectOk('merchandising asks Production for samples', await C.merch.run('task.ask', { centre: S.centres.production.id, title: 'I need 80 samples of the Test Isla Kaftan', due: addDays(TODAY, 20) }), /Sent to Bram Smoketest/);
  const taskId = ask.json?.data?.task;
  const reqProj = (await C.merch.list('projects')).find((p) => p.kind === 'requests');
  ok('a Requests project was made', !!reqProj, '');
  const bi = (await C.prodhead.get('/api/inbox')).json || [];
  ok('production head is told of the request', bi.some((n) => n.text === 'Esme Smoketest asked Production: I need 80 samples of the Test Isla Kaftan'), JSON.stringify(bi.map((n) => n.text)));
  expectRefused('an onlooker cannot move the task', await C.staff.run('task.move', { id: taskId, status: 'done' }), 403, /Add a comment instead/);
  expectRefused('an onlooker cannot edit the task', await C.staff.update('tasks', taskId, { title: 'Hijacked' }), 403, /Add a comment instead/);
  expectOk('an onlooker comments with an @mention', await C.sales.run('task.comment', { id: taskId, text: 'Budget is approved for this. @Ada to see.' }));
  const fi = (await C.founder.get('/api/inbox')).json || [];
  ok('the mention reaches the founder', fi.some((n) => /^Nora Smoketest on I need 80 samples/.test(n.text)), JSON.stringify(fi.map((n) => n.text)));
  const bi2 = (await C.prodhead.get('/api/inbox')).json || [];
  ok('the head hears of the comment too', bi2.some((n) => /^Nora Smoketest on I need 80 samples/.test(n.text)), '');
  expectRefused('an empty comment is refused', await C.sales.run('task.comment', { id: taskId, text: '   ' }), 400);
  expectOk('the head answers', await C.prodhead.run('task.comment', { id: taskId, text: 'Can do 50 by the 28th.' }));
  expectOk('the head starts it', await C.prodhead.act('task.start', 'tasks', taskId));
  expectOk('the head finishes it', await C.prodhead.act('task.done', 'tasks', taskId));
  const mi2 = (await C.merch.get('/api/inbox')).json || [];
  ok('the asker hears it is done', mi2.some((n) => n.text === 'Done: I need 80 samples of the Test Isla Kaftan'), JSON.stringify(mi2.map((n) => n.text).slice(0, 5)));
  ok('two comments are on the task', (await C.merch.list('comments')).filter((c) => c.task === taskId).length === 2, '');
  // A task that waits for another.
  const first = await make(C.merch, 'tasks', { project: reqProj.id, title: 'Fabric approved', assignee: S.user_merch.id }, 'task: fabric approved');
  const second = await make(C.merch, 'tasks', { project: reqProj.id, title: 'Cut the samples', centre: S.centres.production.id, dependsOn: [first.id] }, 'task: cut samples (waits)');
  ok('a task addressed to a work centre goes to its head', second?.assignee === S.user_prodhead.id, JSON.stringify(second));
  expectRefused('a circular wait is refused', await C.merch.update('tasks', first.id, { dependsOn: [second.id] }), 400, /waiting for each other/);
  expectOk('finish the first task', await C.merch.act('task.done', 'tasks', first.id));
  const bi3 = (await C.prodhead.get('/api/inbox')).json || [];
  ok('the owner of the waiting task is told they can start', bi3.some((n) => n.text.startsWith('You can start: Cut the samples')), JSON.stringify(bi3.map((n) => n.text).slice(0, 6)));
  // Project limited to its work centre.
  const proj = await make(C.prodhead, 'projects', { name: 'Smoke line rebalancing', centre: S.centres.production.id, access: 'centre' }, 'centre-only project');
  const tsk = await make(C.prodhead, 'tasks', { project: proj.id, title: 'Move two tailors to D2C' }, 'task in centre-only project');
  ok('production manager (same centre) sees the project', (await C.newbie.list('projects')).some((p) => p.id === proj.id) && (await C.newbie.list('tasks')).some((t) => t.id === tsk.id), '');
  ok('merch does not see the project or its task', !(await C.merch.list('projects')).some((p) => p.id === proj.id) && !(await C.merch.list('tasks')).some((t) => t.id === tsk.id), '');
  ok('team member does not see the project', !(await C.staff.list('projects')).some((p) => p.id === proj.id), '');
  expectRefused('merch cannot open the hidden task directly', await C.merch.get(`/api/data/tasks/${tsk.id}`), [403, 404]);
  expectRefused('merch cannot comment on the hidden task', await C.merch.run('task.comment', { id: tsk.id, text: 'peeking' }), [403, 404]);
  ok('comments on a hidden task are not listed to people who cannot see the task', !(await C.staff.list('comments')).some((c) => c.task === tsk.id) && !(await C.merch.list('comments')).some((c) => c.task === tsk.id), '');
  ok('a task asked into a hidden project is not visible to the person who asked', !(await C.merch.list('tasks')).some((t) => t.title === 'Sneaky'), '');
  ok('founder sees everything', (await C.founder.list('projects')).some((p) => p.id === proj.id), '');
  expectRefused('merch cannot ask into the hidden project', await C.merch.run('task.ask', { centre: S.centres.production.id, title: 'Sneaky', project: proj.id }), [403, 404]);
  // Inbox read / tick
  const ib = await C.prodhead.get('/api/inbox');
  const unread = ib.json.filter((n) => !n.read).length;
  const tick = await C.prodhead.get('/api/tick');
  ok('tick returns seq and newest notice id', tick.status === 200 && tick.json.seq > 0 && tick.json.notice === ib.json[0].id, short(tick));
  const rd = await C.prodhead.post('/api/inbox/read', {});
  ok('marking the inbox read leaves none unread', rd.status === 200 && rd.json.every((n) => n.read) && unread > 0, short(rd).slice(0, 150));
}

// ───────────────────────── 9. Marketing and privacy ─────────────────────────
async function part9() {
  console.log('\n# 9. Marketing and privacy');
  const mk = C.marketing;
  const rows = [];
  for (let i = 0; i < 30; i++) {
    const date = addDays(TODAY, -i);
    rows.push({ date, channel: 'meta', campaign: 'Smoke Resort', spend: 40 + i, currency: 'USD', impressions: 9000 + i, clicks: 300 + i, purchases: 4, revenue: 1100 });
    rows.push({ date, channel: 'Google', campaign: 'Smoke Brand', spend: 2000 + i * 10, currency: 'INR', impressions: 4000, clicks: 120, purchases: 2, revenue: 15000 });
  }
  expectOk('ingest 30 days x 2 channels', await mk.run('media.ingest', { rows, from: 'Meta' }), /^60 lines added, 0 updated\.$/);
  expectOk('re-ingest replaces rather than doubles', await mk.run('media.ingest', { rows, from: 'Meta' }), /^0 lines added, 60 updated\.$/);
  const md = await mk.list('media_days');
  ok('60 media days exist', md.length === 60, `${md.length}`);
  const meta = md.find((r) => r.channel === 'Meta' && r.date === TODAY);
  ok('Meta USD spend stated in rupees at 84 (40 -> 3360)', meta?.spend === 40 && meta.spendInr === 3360, JSON.stringify(meta));
  expectRefused('sales cannot ingest media', await C.sales.run('media.ingest', { rows }), 403);
  expectRefused('a media line with no date is refused', await mk.run('media.ingest', { rows: [{ channel: 'Meta', spend: 1 }] }), 400, /no date/);
  const camp = await make(mk, 'campaigns', { name: 'Smoke Resort', channel: 'Meta', start: addDays(TODAY, -30), budget: 100000 }, 'campaign');
  expectOk('campaign goes live', await mk.act('campaign.live', 'campaigns', camp.id), /is live/);
  await make(mk, 'content', { title: 'Smoke reel', type: 'Reel', channel: 'Instagram', publishDate: addDays(TODAY, 5), campaign: camp.id }, 'content');

  // Privacy: Synthetic Customer 07 (the USD order that was dispatched).
  expectRefused('sales cannot use privacy.find', await C.sales.run('privacy.find', { q: 'Synthetic Customer 07' }), 403);
  expectRefused('a two-letter query is refused', await C.admin.run('privacy.find', { q: 'Sy' }), 400);
  const found = await C.admin.run('privacy.find', { q: 'synthetic customer 07' });
  expectOk('find what is held on Synthetic Customer 07', found, /1 order and \d+ slips? found/);
  ok('find returns the order, slips and parcel', found.json?.data?.orders?.length === 1 && found.json.data.slips.length >= 1 && found.json.data.parcels.length === 1, short(found).slice(0, 200));
  expectRefused('erase needs a reason', await C.admin.run('privacy.erase', { orderNos: ['#SM-1007'] }), 400, /Record who asked/);
  expectOk('erase Synthetic Customer 07', await C.admin.run('privacy.erase', { orderNos: ['#SM-1007'], reason: 'Synthetic request of 11 Nov asking for deletion' }), /removed from 1 order/);
  const after = await C.admin.run('privacy.find', { q: 'synthetic customer 07' });
  ok('the customer can no longer be found by name', after.json?.data?.orders?.length === 0, short(after));
  const so = (await C.admin.list('shop_orders')).find((o) => o.orderNo === '#SM-1007');
  ok('order stays for the accounts without the person', so?.customerName === 'Removed on request' && so.amount > 0, JSON.stringify(so));
  // Does the name survive anywhere else?
  const all = await C.admin.get('/api/all');
  const dump = JSON.stringify(all.json?.data || {});
  const leaks = [];
  for (const [entity, rows2] of Object.entries(all.json?.data || {})) for (const row of rows2) if (JSON.stringify(row).includes('Synthetic Customer 07')) leaks.push(`${entity}:${row.no || row.id}`);
  ok('the erased name appears in no record any more', leaks.length === 0, `still present in: ${leaks.slice(0, 6).join(', ')}`);
  const audit = await C.admin.get('/api/audit');
  const auditLeak = (audit.json || []).filter((l) => JSON.stringify(l).includes('Synthetic Customer 07'));
  ok('the erased name appears nowhere in the audit trail', auditLeak.length === 0, `${auditLeak.length} audit lines, e.g. ${auditLeak[0]?.text}`);
  const events = await C.admin.get('/api/events?after=0&limit=500');
  const evLeak = (events.json || []).filter((l) => JSON.stringify(l).includes('Synthetic Customer 07'));
  ok('the erased name appears nowhere in the event feed', evLeak.length === 0, `${evLeak.length} events, e.g. ${evLeak[0]?.text}`);
  ok('dump of all data does not contain the phrase', !dump.includes('Synthetic Customer 07'), '');
  // sweep
  expectRefused('sweep under 6 months is refused', await C.admin.run('privacy.sweep', { months: 2 }), 400);
  const sweep = expectOk('privacy.sweep (36 months) removes the two 2025 orders... only if older than 36 months', await C.admin.run('privacy.sweep', { months: 36 }), /^(Personal details are removed from \d+ orders? older|No finished order older)/);
  const sw6 = expectOk('privacy.sweep (6 months) removes the old finished orders', await C.admin.run('privacy.sweep', { months: 6 }), /Personal details are removed from 2 orders older than 6 months/);
  const old = (await C.admin.list('shop_orders')).filter((o) => /^#SM-OLD/.test(o.orderNo));
  ok('both old orders now say Removed on request', old.length === 2 && old.every((o) => o.customerName === 'Removed on request'), JSON.stringify(old.map((o) => o.customerName)));
  const recent = (await C.admin.list('shop_orders')).find((o) => o.orderNo === '#SM-1009');
  ok('recent shipped orders keep their names', recent?.customerName === 'Synthetic Customer 09', JSON.stringify(recent?.customerName));
}

// ───────────────────────── 10. Cross-checks ─────────────────────────
async function part10() {
  console.log('\n# 10. Cross-checks');
  const keys = ['admin', ...PEOPLE.map((p) => p[0]), 'newbie'];
  const sizes = {};
  for (const k of keys) {
    const r = await C[k].get('/api/all');
    const good = r.status === 200 && r.json?.user && r.json.data && Array.isArray(r.json.readable) && r.json.readable.every((e) => Array.isArray(r.json.data[e]));
    ok(`GET /api/all works for ${k}`, good, short(r).slice(0, 200));
    sizes[k] = r.json?.data ? Object.fromEntries(Object.entries(r.json.data).map(([e, v]) => [e, v.length])) : {};
    if (r.status === 200) {
      const keysSeen = Object.keys(r.json.data);
      ok(`/api/all for ${k} contains exactly what it may read`, keysSeen.length === r.json.readable.length, `${keysSeen.length} vs ${r.json.readable.length}`);
    }
  }
  const ev = await C.admin.get('/api/events?after=0&limit=500');
  ok('events after=0 are ordered by seq ascending', ev.status === 200 && ev.json.length > 50 && ev.json.every((e, i, a) => i === 0 || a[i - 1].seq < e.seq), `${ev.json?.length}`);
  const last = ev.json?.[ev.json.length - 1]?.seq;
  const ev2 = await C.admin.get(`/api/events?after=${last - 5}`);
  ok('events after=N returns only newer events', ev2.status === 200 && ev2.json.every((e) => e.seq > last - 5) && ev2.json.length === 5, `${ev2.json?.length}`);
  const tick = await C.admin.get('/api/tick');
  ok('tick seq matches the newest event', tick.json?.seq >= last, `${tick.json?.seq} vs ${last}`);
  // Counts of what we created match what the API lists.
  const a = sizes.admin;
  const want = { suppliers: created.suppliers, customers: created.customers, items: created.items, styles: created.styles, fx_rates: created.fx_rates, purchase_orders: 1, goods_receipts: 3, dye_lots: 3 + 1, sales_orders: 1, machines: 1, slips: undefined };
  for (const [e, n] of Object.entries(want)) if (n !== undefined) ok(`count: ${e} listed (${a[e]}) = created (${n})`, a[e] === n, `${a[e]} vs ${n}`);
  ok('count: users listed = admin + created', (await C.admin.get('/api/users')).json.length === created.users + 1, '');
  ok('count: rolls = 5 + 3 + 1', a.rolls === 9, `${a.rolls}`);
  ok('count: claims = 2', a.claims === 2, `${a.claims}`);
  ok('count: media_days = 60', a.media_days === 60, `${a.media_days}`);
  ok('count: employees = 3', a.employees === 3, `${a.employees}`);
  ok('count: shop_orders = 42 ingested', a.shop_orders === 42, `${a.shop_orders}`);
  const slipsAdmin = a.slips;
  const expectSlipTotal = S.slips0.length + 5;
  ok(`count: slips = ingested ${S.slips0.length - 5} + 5 internal`, slipsAdmin === expectSlipTotal, `${slipsAdmin} vs ${expectSlipTotal}`);
  const audit = await C.admin.get('/api/audit');
  ok('audit trail is non-empty and readable by admin', audit.status === 200 && audit.json.length > 100, `${audit.json?.length}`);
  // Secrets and object-level access.
  const allAdmin = await C.admin.get('/api/all');
  ok('no password hash or session secret appears in /api/all for admin', !/"pass":|"hash":|[0-9a-f]{32}:[0-9a-f]{128}/.test(allAdmin.text), '');
  const allStaff = await C.staff.get('/api/all');
  ok('no password hash appears in /api/all or /api/users for a team member', !/"pass":|"hash":|[0-9a-f]{32}:[0-9a-f]{128}/.test(allStaff.text + (await C.staff.get('/api/users')).text), '');
  expectRefused('a team member cannot change their own role', await C.staff.put(`/api/users/${S.user_staff.id}`, { role: 'admin' }), 403);
  expectRefused('a team member cannot change their own position', await C.staff.put(`/api/users/${S.user_staff.id}`, { position: 'founder' }), 403);
  const empId = (await C.hr.list('employees'))[0].id;
  expectRefused('a tailor cannot attach a file to an employee record', await C.tailor.post('/api/files', { entity: 'employees', id: empId, name: 'x.png', type: 'image/png', data: 'iVBORw0KGgo=' }), [403, 404]);
  const anyFile = (await C.qc.get(`/api/files?entity=fabric_reports&id=${(await C.qc.list('fabric_reports'))[0].id}`)).json?.[0];
  expectRefused('marketing cannot download a QC photo by id', await C.marketing.get(`/api/files/${anyFile?.id}`), [403, 404]);
  expectRefused('marketing cannot list files on a fabric report', await C.marketing.get(`/api/files?entity=fabric_reports&id=${(await C.qc.list('fabric_reports'))[0].id}`), [403, 404]);
  const lg = new Client('lg'); await lg.login(email('staff')); await lg.post('/api/logout', {});
  expectRefused('a signed-out session cookie no longer works', await lg.get('/api/boot'), 401);
  const sw = await C.admin.put(`/api/users/${S.user_staff.id}`, { active: false });
  ok('admin can switch a login off', sw.status === 200, short(sw));
  expectRefused('a switched-off login loses its session', await C.staff.get('/api/boot'), 401);
  expectRefused('a switched-off login cannot sign in', await new Client('x').post('/api/login', { email: email('staff'), password: PASSWORD }), 401);
  await C.admin.put(`/api/users/${S.user_staff.id}`, { active: true });
  // Odd requests must never 500.
  const probes = [
    ['GET', '/api/data/nonsense'], ['GET', '/api/data/slips/does-not-exist'], ['POST', '/api/action/nonsense', {}], ['POST', '/api/action/slip.scan', { payload: null }], ['POST', '/api/action/slip.scan', {}],
    ['POST', '/api/data/items', { code: 'X'.repeat(5000), name: 'long', kind: 'trim', unit: 'pcs' }], ['POST', '/api/import/items', { rows: 'nope' }], ['POST', '/api/import/items', { rows: [] }],
    ['PUT', '/api/data/items/zzz', { name: 'x' }], ['DELETE', '/api/data/items/zzz'], ['GET', '/api/files/zzz'], ['POST', '/api/files', {}], ['GET', '/api/users/zzz'], ['POST', '/api/users/zzz/join', {}],
    ['POST', '/api/action/order.place', { payload: { style: 'x', qty: 'abc', kind: 'store', promised: '2026-01-01' } }], ['POST', '/api/action/media.ingest', { payload: { rows: [null] } }],
    ['POST', '/api/action/shopify.ingest', { payload: { orders: [null, 5, { orderNo: 'x', lines: 'bad' }] } }], ['POST', '/api/action/privacy.erase', { payload: { orderNos: [null], reason: 'x' } }],
    ['POST', '/api/action/gate.scan', { payload: { barcode: { a: 1 } } }], ['POST', '/api/action/scan.start', { payload: { bundle: ['a'] } }],
  ];
  for (const [mth, path, body] of probes) {
    const r = await C.admin.raw(mth, path, body);
    ok(`no 500 on ${mth} ${path} ${body ? JSON.stringify(body).slice(0, 50) : ''}`, r.status < 500, short(r));
  }
  const bad = await C.admin.raw('POST', '/api/data/items', undefined, { 'content-type': 'application/json' });
  ok('no 500 on an empty JSON body', bad.status < 500, short(bad));
  const malformed = await fetch(`${BASE}/api/data/items`, { method: 'POST', headers: { origin: BASE, 'content-type': 'application/json', cookie: C.admin.cookie }, body: '{not json' });
  ok('malformed JSON gets 400, not 500', malformed.status === 400, `${malformed.status}`);
  const badpath = await fetch(`${BASE}/%E0%A4%A`);
  ok('a malformed URL escape does not 500 or hang the server', badpath.status < 500, `${badpath.status}`);
  const health = await fetch(`${BASE}/api/health`);
  ok('server still healthy after the probes', health.status === 200, `${health.status}`);
  ok('no response anywhere returned a 5xx', seen500.length === 0, seen500.slice(0, 5).join(' | '));
}

// ───────────────────────── run ─────────────────────────
const steps = [part1, part2, part3, part4, part5, part6, part7, part8, part9, part10];
for (const step of steps) {
  try { await step(); } catch (e) { failed++; failures.push(`${step.name} crashed`); console.log(`FAIL ${step.name} crashed: ${e.stack || e}`); }
}
console.log(`\n${passed + failed} checks: ${passed} ok, ${failed} FAIL${seen500.length ? `, ${seen500.length} responses were 5xx` : ''}`);
if (failed) console.log(`Failed: ${failures.join('; ')}`);
process.exit(failed ? 1 : 0);
