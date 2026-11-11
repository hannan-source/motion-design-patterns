// The Postgres store (used on Netlify) against a real Postgres engine running in-process (PGlite):
// the same API, the same rules, plus the retry-on-concurrent-change behaviour.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { createPgStore } from '../server/pgstore.js';
import { createApi } from '../server/app.js';

const pglite = new PGlite();
// PGlite runs one statement at a time, so a transaction is a queued section of its own.
let chain = Promise.resolve();
const sql = {
  query: async (text, params = []) => (await pglite.query(text, params)).rows,
  tx: (fn) => { const run = chain.then(() => pglite.transaction((t) => fn(async (text, params = []) => (await t.query(text, params)).rows))); chain = run.catch(() => {}); return run; },
};
const store = createPgStore(sql);
const api = createApi({ store, env: {} });
const call = async (method, path, body, cookie) => {
  const url = new URL(path, 'http://deme.test');
  const out = await api.handle({ method, path: url.pathname, query: url.searchParams, headers: { host: 'deme.test', ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) }, body: body || {}, ip: '1.1.1.1' });
  return { status: out.status, json: out.headers['content-type']?.startsWith('application/json') ? JSON.parse(out.body) : null, cookie: (out.cookies[0] || '').split(';')[0] };
};

test('the whole API works over Postgres', async () => {
  assert.equal((await call('GET', '/api/state')).json.setupNeeded, true);
  const setup = await call('POST', '/api/setup', { name: 'Founder', email: 'founder@example.com', password: 'a-long-password' });
  assert.equal(setup.status, 200);
  const who = setup.cookie;
  assert.equal((await call('GET', '/api/state', null, who)).json.user.role, 'founder');
  assert.equal((await call('GET', '/api/data/items')).status, 401);

  // A chain of real transactions: material, supplier, receipt posted, roll inspected.
  const item = (await call('POST', '/api/data/items', { code: 'FAB-1', name: 'Cotton voile', kind: 'fabric', unit: 'm', cost: 200 }, who)).json.doc;
  const mill = (await call('POST', '/api/data/suppliers', { name: 'Test Mill', kind: 'mill' }, who)).json.doc;
  const grn = (await call('POST', '/api/data/goods_receipts', { supplier: mill.id, lines: [{ item: item.id, qty: 200, rolls: 2, rate: 200 }] }, who)).json.doc;
  assert.equal(grn.no, 'GRN-00001');
  const posted = await call('POST', '/api/action/grn.post', { entity: 'goods_receipts', id: grn.id }, who);
  assert.equal(posted.status, 200, JSON.stringify(posted.json));
  const rolls = (await call('GET', '/api/data/rolls', null, who)).json;
  assert.equal(rolls.length, 2);
  const failed = await call('POST', '/api/action/roll.inspect', { entity: 'rolls', id: rolls[0].id, payload: { points: 60, defects: 'Stains' } }, who);
  assert.equal(failed.json.doc.status, 'rejected');
  const vouchers = (await call('GET', '/api/data/vouchers', null, who)).json;
  assert.deepEqual(vouchers.map((v) => v.type).sort(), ['Debit Note', 'Purchase']);

  // The one-request load the web app uses.
  const all = await call('GET', '/api/all', null, who);
  assert.equal(all.json.data.rolls.length, 2);
  assert.ok(all.json.readable.includes('vouchers'));

  // A rule violation saves nothing.
  const before = (await call('GET', '/api/data/stock_moves', null, who)).json.length;
  assert.equal((await call('POST', '/api/action/stock.issue', { payload: { item: item.id, qty: 99999 } }, who)).status, 400);
  assert.equal((await call('GET', '/api/data/stock_moves', null, who)).json.length, before);

  // Audit trail and event feed come from the logs table.
  assert.ok((await call('GET', '/api/audit', null, who)).json.length >= 5);
  const events = (await call('GET', '/api/events?after=0', null, who)).json;
  assert.ok(events[0].seq < events[1].seq);
});

test('two people changing the same list at once both succeed, and numbers never repeat', async () => {
  const who = (await call('POST', '/api/login', { email: 'founder@example.com', password: 'a-long-password' })).cookie;
  const results = await Promise.all(Array.from({ length: 8 }, (_, i) => call('POST', '/api/data/purchase_orders', { supplier: 'Test Mill', lines: [{ item: 'FAB-1', qty: 10 + i, rate: 200 }] }, who)));
  assert.ok(results.every((r) => r.status === 200), JSON.stringify(results.find((r) => r.status !== 200)?.json));
  const nos = results.map((r) => r.json.doc.no);
  assert.equal(new Set(nos).size, 8, `document numbers repeated: ${nos}`);
  assert.equal((await call('GET', '/api/data/purchase_orders', null, who)).json.length, 8);
});

test('a large import is saved in a few statements and the event feed keeps its order', async () => {
  const db2 = new PGlite();
  let statements = 0, queue = Promise.resolve();
  const counting = {
    query: async (text, params = []) => { statements++; return (await db2.query(text, params)).rows; },
    tx: (fn) => { const run = queue.then(() => db2.transaction((t) => fn(async (text, params = []) => { statements++; return (await t.query(text, params)).rows; }))); queue = run.catch(() => {}); return run; },
  };
  const api2 = createApi({ store: createPgStore(counting), env: {} });
  const hit = async (method, path, body, cookie) => {
    const url = new URL(path, 'http://deme.test');
    const out = await api2.handle({ method, path: url.pathname, query: url.searchParams, headers: { host: 'deme.test', ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) }, body: body || {}, ip: '1.1.1.1' });
    return { status: out.status, json: JSON.parse(out.body), cookie: (out.cookies[0] || '').split(';')[0] };
  };
  const who = (await hit('POST', '/api/setup', { name: 'Founder', email: 'founder@example.com', password: 'a-long-password' })).cookie;
  const rows = Array.from({ length: 1200 }, (_, i) => ({ Name: `Mill ${i + 1}`, Kind: i % 7 === 0 ? 'Not a kind' : 'Fabric mill' }));
  statements = 0;
  const r = await hit('POST', '/api/import/suppliers', { rows }, who);
  assert.equal(r.status, 200);
  assert.equal(r.json.errors.length, 172);
  assert.equal(r.json.created, 1028);
  assert.ok(statements < 40, `the import used ${statements} statements`);
  assert.equal((await hit('GET', '/api/data/suppliers', null, who)).json.length, 1028);
  // an action that writes many log lines keeps them in the order they happened
  assert.equal((await hit('POST', '/api/action/golive.create', { payload: { start: '2026-11-16' } }, who)).status, 200);
  const ev = (await hit('GET', '/api/events?after=0', null, who)).json;
  const list = Array.isArray(ev) ? ev : ev.events;
  assert.ok(list.length > 2);
  assert.deepEqual(list.map((e) => e.seq), list.map((e) => e.seq).sort((a, b) => a - b));
  await db2.close();
});
