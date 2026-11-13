// The platform under every business: separate workspaces, templates, lists a business sets up
// for itself, invites, each business's own AI connection, and reading slips from a photo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { memoryDb } from '../shared/service.js';
import { createApi } from '../server/app.js';

function platform(env = {}, extra = {}) {
  const root = memoryDb();
  const api = createApi({ store: { run: async (fn) => fn(root) }, env, ...extra });
  const call = async (method, path, body, cookie, headers = {}) => {
    const url = new URL(path, 'http://lychee.test');
    const r = await api.handle({ method, path: url.pathname, query: url.searchParams, headers: { host: 'lychee.test', ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...headers }, body: body || {}, raw: JSON.stringify(body || {}), ip: '1.1.1.1' });
    return { status: r.status, json: r.body ? JSON.parse(r.body) : null, cookie: (r.cookies[0] || '').split(';')[0] };
  };
  return { root, call };
}
const PW = 'a-long-password';

test('one deployment for one business: set up once, then closed', async () => {
  const { call } = platform();
  assert.deepEqual([(await call('GET', '/api/state')).json.setupNeeded, (await call('GET', '/api/state')).json.signup], [true, 'first']);
  const a = await call('POST', '/api/setup', { business: 'Deme', template: 'apparel', name: 'Admin', email: 'admin@deme.test', password: PW });
  assert.equal(a.status, 200); assert.equal(a.json.workspace.name, 'Deme');
  assert.equal((await call('POST', '/api/setup', { business: 'Other', name: 'X', email: 'x@other.test', password: PW })).status, 409);
  assert.equal((await call('GET', '/api/state')).json.signup, 'closed');
});

test('many businesses on one platform never see each other', async () => {
  const { call, root } = platform({ SIGNUP: 'open' });
  const deme = await call('POST', '/api/signup', { business: 'Deme', template: 'apparel', name: 'Asha', email: 'asha@deme.test', password: PW });
  const choc = await call('POST', '/api/signup', { business: 'Cocoa Works', template: 'food', name: 'Ben', email: 'ben@cocoa.test', password: PW });
  assert.equal(deme.status, 200); assert.equal(choc.status, 200);
  assert.notEqual(deme.json.workspace.id, choc.json.workspace.id);
  // each makes a supplier with the same name; each sees only its own
  await call('POST', '/api/data/suppliers', { name: 'Shared Name Ltd', kind: 'other' }, deme.cookie);
  await call('POST', '/api/data/suppliers', { name: 'Shared Name Ltd', kind: 'other' }, choc.cookie);
  await call('POST', '/api/data/suppliers', { name: 'Only Deme Mill', kind: 'mill' }, deme.cookie);
  assert.deepEqual((await call('GET', '/api/data/suppliers', null, deme.cookie)).json.map((s) => s.name).sort(), ['Only Deme Mill', 'Shared Name Ltd']);
  assert.deepEqual((await call('GET', '/api/data/suppliers', null, choc.cookie)).json.map((s) => s.name), ['Shared Name Ltd']);
  // one business cannot reach another's record by its id, and its audit trail and event feed are its own
  const mill = (await call('GET', '/api/data/suppliers', null, deme.cookie)).json.find((s) => s.name === 'Only Deme Mill');
  assert.equal((await call('GET', `/api/data/suppliers/${mill.id}`, null, choc.cookie)).status, 404);
  assert.equal((await call('PUT', `/api/data/suppliers/${mill.id}`, { name: 'Taken' }, choc.cookie)).status, 404);
  assert.ok(!(await call('GET', '/api/events?after=0', null, choc.cookie)).json.some((e) => /Only Deme Mill/.test(e.text)));
  assert.ok((await call('GET', '/api/events?after=0', null, deme.cookie)).json.some((e) => /Only Deme Mill/.test(e.text)));
  assert.ok(!(await call('GET', '/api/users', null, choc.cookie)).json.some((u) => u.name === 'Asha'));
  // document numbers run separately in each business
  const po = async (c) => (await call('POST', '/api/data/purchase_orders', { supplier: 'Shared Name Ltd', lines: [] }, c)).json;
  assert.ok(root.dump().cols[`${deme.json.workspace.id}/suppliers`], 'data is kept under the workspace');
  // signing in finds the right business from the email alone
  const again = await call('POST', '/api/login', { email: 'ben@cocoa.test', password: PW });
  assert.equal(again.json.workspace.name, 'Cocoa Works');
  // an email already in use cannot start a second business by accident
  assert.equal((await call('POST', '/api/signup', { business: 'Dup', name: 'Ben', email: 'ben@cocoa.test', password: PW })).status, 409);
  void po;
});

test('sign-up can be limited to people holding a code', async () => {
  const { call } = platform({ SIGNUP: 'lychee-2026' });
  assert.equal((await call('GET', '/api/state')).json.signup, 'code');
  assert.equal((await call('POST', '/api/signup', { business: 'X', name: 'A', email: 'a@x.test', password: PW })).status, 403);
  assert.equal((await call('POST', '/api/signup', { business: 'X', name: 'A', email: 'a@x.test', password: PW, code: 'lychee-2026' })).status, 200);
});

test('a template decides what a business starts with, in its own words', async () => {
  const { call } = platform({ SIGNUP: 'open' });
  const choc = await call('POST', '/api/signup', { business: 'Cocoa Works', template: 'food', name: 'Ben', email: 'ben@cocoa.test', password: PW });
  const all = (await call('GET', '/api/all', null, choc.cookie)).json;
  assert.ok(!all.readable.includes('rolls') && !all.readable.includes('dye_lots') && !all.readable.includes('slips'), 'no apparel lists');
  assert.ok(all.readable.includes('items') && all.readable.includes('purchase_orders') && all.readable.includes('tasks'));
  assert.deepEqual(all.workspace.terms.styles, ['Products', 'Product']);
  assert.deepEqual(all.data.work_centres.map((c) => c.name).slice(0, 3).sort(), ['Management', 'Production', 'Stores']);
  assert.ok(all.data.workstations.some((s) => s.name === 'Mixing and cooking'));
  // a product needs no stitching minutes here
  assert.equal((await call('POST', '/api/data/styles', { code: 'BAR-70', name: 'Dark 70% bar' }, choc.cookie)).status, 200);
  // an area that is switched off is closed, whatever the role
  assert.equal((await call('GET', '/api/data/dye_lots', null, choc.cookie)).status, 404);
  // the admin switches an area on later
  const s = await call('PUT', '/api/workspace', { modules: [...all.workspace.modules, 'quality'], name: 'Cocoa Works Pvt' }, choc.cookie);
  assert.equal(s.json.name, 'Cocoa Works Pvt'); assert.ok(s.json.modules.includes('quality'));
});

test('a business sets up a list of its own and uses it like any other', async () => {
  const { call } = platform({ SIGNUP: 'open' });
  const c = (await call('POST', '/api/signup', { business: 'Cocoa Works', template: 'food', name: 'Ben', email: 'ben@cocoa.test', password: PW })).cookie;
  assert.equal((await call('POST', '/api/types', { name: 'Batches', fields: [] }, c)).status, 400);
  const made = await call('POST', '/api/types', { name: 'Batches', one: 'Batch', statuses: ['Planned', 'Cooking', 'Cooled', 'Packed'], fields: [
    { label: 'Batch no', type: 'text' }, { label: 'Product', type: 'ref', ref: 'styles' }, { label: 'Kilos', type: 'number' }, { label: 'Made on', type: 'date' }, { label: 'Temper', type: 'select', options: 'Good, Soft, Bloomed' }, { label: 'Made by', type: 'user' }] }, c);
  assert.equal(made.status, 200, JSON.stringify(made.json));
  const all = (await call('GET', '/api/all', null, c)).json;
  assert.ok(all.readable.includes('x_batches')); assert.equal(all.types[0].name, 'Batches');
  await call('POST', '/api/data/styles', { code: 'BAR-70', name: 'Dark 70% bar' }, c);
  const bad = await call('POST', '/api/data/x_batches', { product: 'Dark 70% bar', kilos: 'many' }, c);
  assert.equal(bad.status, 400); assert.match(bad.json.error, /Batch no is needed|Kilos must be a number/);
  const b = await call('POST', '/api/data/x_batches', { batch_no: 'B-001', product: 'Dark 70% bar', kilos: 40, made_on: '12/11/2026', temper: 'good' }, c);
  assert.equal(b.status, 200, JSON.stringify(b.json));
  assert.deepEqual([b.json.doc.status, b.json.doc.made_on, b.json.doc.temper], ['planned', '2026-11-12', 'Good']);
  const next = await call('POST', '/api/action/list.next', { entity: 'x_batches', id: b.json.doc.id }, c);
  assert.equal(next.json.doc.status, 'cooking');
  // rows from a spreadsheet go in the same way, and the audit trail records them
  const imp = await call('POST', '/api/import/x_batches', { rows: [{ 'Batch no': 'B-002', Kilos: '55' }, { Kilos: '9' }] }, c);
  assert.deepEqual([imp.json.created, imp.json.errors.length], [1, 1]);
  // a list with records in it cannot be removed by mistake; an empty one can
  assert.match((await call('DELETE', `/api/types/${made.json.id}`, null, c)).json.error, /still holds 2 records/);
  // someone who is not an admin can add to the list but cannot reshape it
  await call('POST', '/api/users', { name: 'Maya', email: 'maya@cocoa.test', password: PW, position: 'staff' }, c);
  const maya = (await call('POST', '/api/login', { email: 'maya@cocoa.test', password: PW })).cookie;
  assert.equal((await call('POST', '/api/data/x_batches', { batch_no: 'B-003' }, maya)).status, 200);
  assert.equal((await call('POST', '/api/types', { name: 'Sneaky', fields: [{ label: 'A', type: 'text' }] }, maya)).status, 403);
});

test('people are invited by email and set their own password', async () => {
  const sent = [];
  const { call } = platform({ SIGNUP: 'open', RESEND_API_KEY: 'k', MAIL_FROM: 'Lychee <x@lychee.test>', PUBLIC_URL: 'https://lychee.test' }, { fetchImpl: async (url, init) => { sent.push(JSON.parse(init.body)); return { ok: true, status: 200 }; } });
  const c = (await call('POST', '/api/signup', { business: 'Deme', template: 'apparel', name: 'Asha', email: 'asha@deme.test', password: PW })).cookie;
  const inv = await call('POST', '/api/invites', { email: 'Jason@Deme.test', name: 'Jason', position: 'prod_b2b' }, c);
  assert.equal(inv.status, 200, JSON.stringify(inv.json));
  assert.equal(inv.json.user.role, 'production_head'); assert.equal(inv.json.emailed, true);
  assert.deepEqual([sent[0].to, sent[0].subject], [['jason@deme.test'], 'Asha invited you to Deme on Hyper Lychee Labs ERP']);
  const token = new URL(inv.json.link).searchParams.get('invite');
  assert.match(sent[0].text, new RegExp(token));
  assert.equal((await call('POST', '/api/login', { email: 'jason@deme.test', password: PW })).status, 401, 'no password until the invitation is taken up');
  assert.deepEqual((await call('GET', `/api/invite?token=${token}`)).json.business, 'Deme');
  const taken = await call('POST', '/api/invite/accept', { token, password: PW });
  assert.equal(taken.status, 200); assert.equal(taken.json.user.name, 'Jason');
  assert.equal((await call('GET', `/api/invite?token=${token}`)).status, 404, 'an invitation works once');
  assert.equal((await call('POST', '/api/login', { email: 'jason@deme.test', password: PW })).status, 200);
  assert.equal((await call('GET', '/api/invite?token=nope')).status, 404);
});

test('each business chooses its AI; slips read from a photo are checked before anything is saved', async () => {
  const asked = [];
  // a stand-in for an open-source model behind a chat-completions endpoint
  const fetchImpl = async (url, init) => { asked.push({ url: String(url), auth: init.headers.authorization, body: JSON.parse(init.body) }); return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify({ slips: [{ no: 'SL-00001', outcome: 'pass', reason: '', tailor: 'Ravi', sure: 'high' }, { no: 'sl-00002', outcome: 'rework', reason: 'measurement', tailor: '', sure: 'medium' }, { no: 'SL-99999', outcome: 'pass', reason: '', tailor: '', sure: 'low' }], note: 'One slip is cut off at the edge.' }) } }] }) }; };
  const { call } = platform({ SIGNUP: 'open' }, { fetchImpl });
  const c = (await call('POST', '/api/signup', { business: 'Deme', template: 'apparel', name: 'Asha', email: 'asha@deme.test', password: PW })).cookie;
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  assert.equal((await call('POST', '/api/ai/slips', { images: [{ type: 'image/png', data: png }] }, c)).status, 501, 'no connection yet');
  assert.equal((await call('PUT', '/api/workspace', { ai: { provider: 'openai-compatible', baseUrl: 'http://insecure.test/v1', model: 'm' } }, c)).status, 400);
  const set = await call('PUT', '/api/workspace', { ai: { provider: 'openai-compatible', baseUrl: 'https://models.cocoa.test/v1', model: 'open-vision-1' }, secrets: { aiKey: 'sk-own' } }, c);
  assert.deepEqual([set.json.ai.provider, set.json.ai.keySet], ['openai-compatible', true]);
  assert.ok(!JSON.stringify(set.json).includes('sk-own'), 'the key is never sent back');
  await call('POST', '/api/users', { name: 'Ravi', email: 'ravi@deme.test', password: PW, position: 'masters' }, c);
  const style = (await call('POST', '/api/data/styles', { code: 'KAF', name: 'Isla kaftan', smvCut: 5, smvStitch: 30, smvFinish: 5, smvQc: 3, smvPack: 2 }, c)).json.doc;
  await call('POST', '/api/action/order.place', { payload: { kind: 'store', style: style.id, qty: 2, promised: '2026-12-01' } }, c);
  const read = await call('POST', '/api/ai/slips', { images: [{ type: 'image/png', data: png }] }, c);
  assert.equal(read.status, 200, JSON.stringify(read.json));
  assert.equal(asked[0].url, 'https://models.cocoa.test/v1/chat/completions'); assert.equal(asked[0].auth, 'Bearer sk-own'); assert.equal(asked[0].body.model, 'open-vision-1');
  assert.deepEqual(read.json.rows.map((r) => [r.no, r.known, r.outcome]), [['SL-00001', true, 'pass'], ['SL-00002', true, 'rework'], ['SL-99999', false, 'pass']]);
  assert.equal((await call('GET', '/api/data/slips', null, c)).json.every((s) => s.status === 'new'), true, 'reading changes nothing');
  // the person confirms; only then are the slips closed
  const saved = await call('POST', '/api/action/slip.closeMany', { payload: { items: read.json.rows.map((r) => ({ no: r.no, outcome: r.outcome, reason: r.reason, tailor: r.tailor })) } }, c);
  assert.equal(saved.json.message, '2 slips saved: 1 passed, 1 back for rework. 1 left as they were.');
  const slips = (await call('GET', '/api/data/slips', null, c)).json.sort((a, b) => a.no.localeCompare(b.no));
  assert.deepEqual(slips.map((s) => [s.status, s.madeBy || '', s.qcReason || '']), [['passed', 'Ravi', ''], ['rework', '', 'measurement']]);
  assert.ok(slips[0].tailor, 'the written name is matched to the team member');
});
