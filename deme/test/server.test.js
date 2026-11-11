// The HTTP layer: setup, sign-in, sessions and role checks against a real server on a temp database.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/index.js';

const app = createApp({ dbFile: ':memory:' });
await new Promise((ok) => app.server.listen(0, ok));
const base = `http://localhost:${app.server.address().port}`;
test.after(() => app.close());

const call = async (method, path, body, cookie) => {
  const res = await fetch(base + path, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, json: await res.json().catch(() => null), cookie: (res.headers.get('set-cookie') || '').split(';')[0] };
};

test('setup, sign-in and role checks', async () => {
  assert.equal((await call('GET', '/api/state')).json.setupNeeded, true);
  assert.equal((await call('GET', '/api/data/items')).status, 401, 'no session, no data');

  const setup = await call('POST', '/api/setup', { name: 'Founder', email: 'founder@example.com', password: 'a-long-password' });
  assert.equal(setup.status, 200);
  const founder = setup.cookie;
  assert.ok(founder.startsWith('deme_sid='));
  assert.equal((await call('POST', '/api/setup', { name: 'X', email: 'x@example.com', password: 'a-long-password' })).status, 409, 'setup runs once');

  const boot = await call('GET', '/api/boot', null, founder);
  assert.equal(boot.json.user.role, 'admin');
  assert.ok(boot.json.readable.includes('vouchers'));
  assert.ok((await call('GET', '/api/data/ledgers', null, founder)).json.length > 5, 'starter ledgers exist');

  // A tailor can sign in but cannot read lists or add records.
  assert.equal((await call('POST', '/api/users', { name: 'Tailor', email: 'tailor@example.com', password: 'a-long-password', role: 'operator' }, founder)).status, 200);
  assert.equal((await call('POST', '/api/login', { email: 'tailor@example.com', password: 'wrong-password' })).status, 401);
  const tailor = (await call('POST', '/api/login', { email: 'tailor@example.com', password: 'a-long-password' })).cookie;
  assert.equal((await call('GET', '/api/data/work_orders', null, tailor)).status, 403);
  assert.equal((await call('POST', '/api/data/items', { code: 'X', name: 'X', kind: 'trim', unit: 'pcs' }, tailor)).status, 403);
  assert.equal((await call('POST', '/api/users', { name: 'Y', email: 'y@example.com', password: 'a-long-password', role: 'founder' }, tailor)).status, 403);
  assert.equal((await call('GET', '/api/mine', null, tailor)).status, 200, 'self-service is open to everyone');

  // Finance can read vouchers but not payroll salaries.
  await call('POST', '/api/users', { name: 'Accounts', email: 'accounts@example.com', password: 'a-long-password', role: 'finance' }, founder);
  const fin = (await call('POST', '/api/login', { email: 'accounts@example.com', password: 'a-long-password' })).cookie;
  assert.equal((await call('GET', '/api/data/vouchers', null, fin)).status, 200);
  assert.equal((await call('GET', '/api/data/employees', null, fin)).status, 403);

  // Validation and the audit trail.
  const bad = await call('POST', '/api/data/items', { name: 'No code' }, founder);
  assert.equal(bad.status, 400);
  const ok = await call('POST', '/api/data/items', { code: 'TH-1', name: 'Thread', kind: 'thread', unit: 'cones', minLevel: 10 }, founder);
  assert.equal(ok.status, 200);
  assert.ok((await call('GET', '/api/audit', null, founder)).json.some((l) => l.text.includes('Thread')));

  // Signing out ends the session; a switched-off login cannot be used.
  await call('POST', '/api/logout', {}, fin);
  assert.equal((await call('GET', '/api/boot', null, fin)).status, 401);
  const users = (await call('GET', '/api/users', null, founder)).json;
  await call('PUT', `/api/users/${users.find((u) => u.email === 'tailor@example.com').id}`, { active: false }, founder);
  assert.equal((await call('GET', '/api/boot', null, tailor)).status, 401);
});

test('static files are served and paths cannot escape the web folder', async () => {
  assert.equal((await fetch(`${base}/`)).status, 200);
  assert.equal((await fetch(`${base}/shared/schema.js`)).status, 200);
  assert.notEqual((await fetch(`${base}/..%2Fpackage.json`)).status, 200);
  assert.notEqual((await fetch(`${base}/shared/..%2Fserver/index.js`)).status, 200);
});

test('a service key acts with its role and can be switched off', async () => {
  const founder = (await call('POST', '/api/login', { email: 'founder@example.com', password: 'a-long-password' })).cookie;
  const made = await call('POST', '/api/keys', { name: 'Gate scanner', role: 'logistics' }, founder);
  assert.equal(made.status, 200);
  assert.match(made.json.key, /^deme_[a-f0-9]{48}$/);
  const withKey = async (method, path, body) => { const r = await fetch(base + path, { method, headers: { Authorization: `Bearer ${made.json.key}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, json: await r.json().catch(() => null) }; };
  assert.equal((await withKey('GET', '/api/data/parcels')).status, 200, 'logistics can read parcels');
  assert.equal((await withKey('GET', '/api/data/vouchers')).status, 403, 'but not finance');
  assert.equal((await withKey('POST', '/api/action/gate.scan', { payload: { barcode: 'NOPE' } })).status, 400, 'actions run and report plainly');
  assert.equal((await withKey('GET', '/api/keys')).status, 403, 'a key cannot manage keys');
  assert.ok(!(await call('GET', '/api/keys', null, founder)).json.some((k) => k.hash || k.key), 'the key itself is never listed');
  const events = await call('GET', '/api/events?after=0', null, founder);
  assert.ok(events.json.length > 3 && events.json[0].seq < events.json[1].seq, 'the event feed is ordered');
  await call('PUT', `/api/keys/${made.json.id}`, { active: false }, founder);
  assert.equal((await withKey('GET', '/api/data/parcels')).status, 401);
});

// ── Google Workspace sign-in and AI import mapping, with the outside services stubbed ──
const idToken = (claims) => `x.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.y`;
const googleApp = (claims, extra = {}) => {
  const a = createApp({ dbFile: ':memory:', env: { GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 'secret', GOOGLE_WORKSPACE_DOMAIN: 'deme.example', ...extra.env },
    fetchImpl: async () => ({ ok: true, json: async () => ({ id_token: idToken(claims) }) }), anthropic: extra.anthropic });
  return a;
};
const listen = (a) => new Promise((ok) => a.server.listen(0, () => ok(`http://localhost:${a.server.address().port}`)));
const signInWithGoogle = async (b) => {
  const start = await fetch(`${b}/api/auth/google/start`, { redirect: 'manual' });
  const to = new URL(start.headers.get('location'));
  const state = to.searchParams.get('state');
  const back = await fetch(`${b}/api/auth/google/callback?code=abc&state=${state}`, { redirect: 'manual', headers: { Cookie: start.headers.get('set-cookie').split(';')[0] } });
  return { to, location: back.headers.get('location'), cookie: (back.headers.getSetCookie().find((c) => c.startsWith('deme_sid=')) || '').split(';')[0] };
};

test('Google sign-in: the Workspace domain is admitted, others are turned away', async () => {
  const good = { iss: 'https://accounts.google.com', aud: 'cid', exp: Date.now() / 1000 + 600, email: 'Gabi@deme.example', email_verified: true, hd: 'deme.example', name: 'Gabi' };
  const a = googleApp(good); const b = await listen(a);
  try {
    assert.equal((await (await fetch(`${b}/api/state`)).json()).google, true);
    const first = await signInWithGoogle(b);
    assert.equal(first.to.hostname, 'accounts.google.com');
    assert.equal(first.to.searchParams.get('hd'), 'deme.example');
    assert.equal(first.location, '/?signin=ok');
    const me = await (await fetch(`${b}/api/state`, { headers: { Cookie: first.cookie } })).json();
    assert.equal(me.user.role, 'admin', 'the first Workspace sign-in sets Deme up');
    assert.equal(me.user.email, 'gabi@deme.example');
    // A forged state is refused.
    const forged = await fetch(`${b}/api/auth/google/callback?code=abc&state=nope`, { redirect: 'manual' });
    assert.equal(forged.headers.get('location'), '/?signin=expired');
  } finally { a.close(); }

  const outsider = googleApp({ ...good, email: 'someone@gmail.com', hd: undefined }); const b2 = await listen(outsider);
  try { assert.equal((await signInWithGoogle(b2)).location, '/?signin=domain'); } finally { outsider.close(); }
  const wrongAud = googleApp({ ...good, aud: 'another-app' }); const b3 = await listen(wrongAud);
  try { assert.equal((await signInWithGoogle(b3)).location, '/?signin=google'); } finally { wrongAud.close(); }
});

test('AI import mapping: the reply is checked against the real fields, and is off without a key', async () => {
  let asked = null;
  const stub = { messages: { create: async (req) => { asked = req; return { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ entity: 'suppliers', note: 'Check the terms column.',
    columns: [{ header: 'Vendor', field: 'name', dateFormat: '' }, { header: 'Type', field: 'kind', dateFormat: '' }, { header: 'Days', field: 'terms', dateFormat: '' }, { header: 'Junk', field: 'not_a_field', dateFormat: '' }, { header: 'Also name', field: 'name', dateFormat: 'DMY' }] }) }] }; } } };
  const a = createApp({ dbFile: ':memory:', env: {}, anthropic: stub }); const b = await listen(a);
  try {
    const setup = await fetch(`${b}/api/setup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'F', email: 'f@example.com', password: 'a-long-password' }) });
    const cookie = setup.headers.get('set-cookie').split(';')[0];
    const post = (body, c = cookie) => fetch(`${b}/api/ai/map`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(c ? { Cookie: c } : {}) }, body: JSON.stringify(body) });
    assert.equal((await post({ headers: ['Vendor'] }, null)).status, 401, 'sign-in is needed');
    const out = await (await post({ headers: ['Vendor', 'Type', 'Days', 'Junk', 'Also name'], sample: [{ Vendor: 'Kaveri Weaves', Type: 'Fabric mill', Days: '30' }] })).json();
    assert.equal(out.entity, 'suppliers');
    assert.deepEqual(out.columns.map((c) => c.field), ['name', 'kind', 'terms', '', ''], 'unknown and repeated fields are dropped');
    assert.equal(asked.model, 'claude-haiku-5-5');
    assert.match(asked.messages[0].content, /Kaveri Weaves/);
  } finally { a.close(); }
  const off = createApp({ dbFile: ':memory:', env: {} }); const b2 = await listen(off);
  try {
    const setup = await fetch(`${b2}/api/setup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'F', email: 'f@example.com', password: 'a-long-password' }) });
    const r = await fetch(`${b2}/api/ai/map`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: setup.headers.get('set-cookie').split(';')[0] }, body: JSON.stringify({ headers: ['A'] }) });
    assert.equal(r.status, 501);
  } finally { off.close(); }
});
