// Chat: who is in which channel, what a person outside one can do (nothing), direct conversations,
// groups, unread counts, mentions, and two businesses on one server that never hear each other.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createService, memoryDb } from '../shared/service.js';
import { ACTIONS } from '../shared/actions.js';
import { can } from '../shared/schema.js';
import { settingsFrom, scopeDb } from '../shared/platform.js';
import { createApi } from '../server/app.js';
import { inChannel, membersOf, unreadFor, mentionsIn } from '../shared/chat.js';

const root = memoryDb(), WS = 'w00000000001';
root.put('workspaces', { id: WS, settings: settingsFrom('apparel', 'Test Business'), secrets: {}, status: 'on', createdAt: new Date().toISOString() });
const db = scopeDb(root, WS);
const svc = createService(db, { actions: ACTIONS, hash: async (p) => `h:${p}` });
const fresh = (id) => svc.getUser(id);
const admin = fresh((await svc.setup({ name: 'Hannan Setup', email: 'admin@biz.test', password: 'correct-horse' })).id);
const centre = (key) => db.all('work_centres').find((c) => c.key === key);
const person = async (name, position, more = {}) => fresh((await svc.createUser(admin, { name, email: `${name.toLowerCase().replace(/\s+/g, '.')}@biz.test`, password: 'correct-horse', position, ...more })).id);
const act = (u, step, payload) => svc.act(u, step, { payload });
const channels = (u) => svc.list(u, 'chat_channels');
const named = (u, name) => channels(u).find((c) => c.name === name);
const inbox = (u) => svc.inbox(u).map((n) => n.text);
const tick = () => new Promise((r) => setTimeout(r, 3));   // so two stamps are never the same instant

const jason = await person('Jason Head', 'prod_b2b'), ravi = await person('Ravi Kumar', 'prod_manager'), ravindra = await person('Ravindra Rao', 'finance');
const nidhi = await person('Nidhi Shah', 'merch'), maya = await person('Maya Iyer', 'staff'), tailor = await person('Tara Tailor', 'masters');
const dyer = fresh((await svc.createUser(admin, { name: 'Outside Dyer', email: 'dyer@out.test', password: 'correct-horse', role: 'dyer' })).id);
svc.update(admin, 'work_centres', centre('production').id, { head: jason.id });
const cutting = db.all('workstations').find((s) => s.name === 'Cutting');
const cutter = fresh((await svc.updateUser(admin, (await person('Chetan Cutter', 'line_manager')).id, { station: cutting.id })).id);

test('the standing channels are made once and follow the organisation', async () => {
  const first = act(maya, 'chat.sync', {});
  assert.equal(first.data.made, 1 + db.all('work_centres').length + db.all('workstations').length);
  assert.deepEqual(act(ravi, 'chat.sync', {}).data, { made: 0, changed: 0 }, 'a second call does nothing');
  const seq = db.logs({ limit: 1 })[0].seq;
  act(nidhi, 'chat.sync', {});
  assert.equal(db.logs({ limit: 1 })[0].seq, seq, 'and writes nothing');
  // a rename is followed; a new workstation gets its channel; a removed one closes but keeps what was said
  svc.update(admin, 'workstations', cutting.id, { name: 'Cutting table' });
  const extra = svc.create(admin, 'workstations', { name: 'Embroidery', centre: centre('production').id }).doc;
  assert.deepEqual(act(maya, 'chat.sync', {}).data, { made: 1, changed: 1 });
  assert.ok(named(admin, 'Cutting table') && named(admin, 'Embroidery'));
  svc.remove(admin, 'workstations', extra.id);
  act(maya, 'chat.sync', {});
  await tick();
  assert.equal(named(admin, 'Embroidery').archived, true);
  assert.throws(() => act(admin, 'chat.post', { channel: named(admin, 'Embroidery').id, text: 'anyone?' }), /closed/);
  assert.throws(() => act(dyer, 'chat.sync', {}), /members of the team/);
});

test('who is in each kind of channel', async () => {
  const cs = db.all('work_centres'), all = db.all('chat_channels');
  const everyone = all.find((c) => c.kind === 'everyone'), production = all.find((c) => c.kind === 'centre' && c.centre === centre('production').id), finance = all.find((c) => c.kind === 'centre' && c.centre === centre('finance').id);
  const cut = all.find((c) => c.kind === 'station' && c.station === cutting.id);
  const users = db.all('users'), ids = (ch) => membersOf(ch, users, cs, can).map((u) => u.name).sort();
  // everyone: the whole team, but not an outside login and not someone who only scans
  assert.deepEqual(ids(everyone), ['Chetan Cutter', 'Hannan Setup', 'Jason Head', 'Maya Iyer', 'Nidhi Shah', 'Ravi Kumar', 'Ravindra Rao']);
  // a work centre: its people, its head, and admins
  assert.deepEqual(ids(production), ['Chetan Cutter', 'Hannan Setup', 'Jason Head', 'Ravi Kumar']);
  assert.deepEqual(ids(finance), ['Hannan Setup', 'Ravindra Rao']);
  // a workstation: the people at it, the head of its work centre, and admins
  assert.deepEqual(ids(cut), ['Chetan Cutter', 'Hannan Setup', 'Jason Head']);
  // a head who sits in another work centre is still in the one they lead
  svc.update(admin, 'work_centres', centre('finance').id, { head: nidhi.id });
  await tick();
  assert.ok(inChannel(nidhi, finance, db.all('work_centres'), can));
  assert.ok(channels(nidhi).some((c) => c.id === finance.id));
  // what each person is handed matches
  assert.deepEqual(channels(maya).map((c) => c.kind), ['everyone'], 'no work centre, so only the channel for everyone');
  assert.ok(channels(ravi).some((c) => c.id === production.id) && !channels(ravi).some((c) => c.id === finance.id || c.id === cut.id));
  assert.equal(inChannel({ ...ravi, active: false }, production, cs, can), false, 'a login that is switched off is in nothing');
  // groups and direct conversations: exactly the people listed
  const g = { kind: 'group', members: [maya.id, ravi.id] };
  assert.deepEqual([inChannel(maya, g, cs, can), inChannel(admin, g, cs, can), inChannel(dyer, { kind: 'group', members: [dyer.id] }, cs, can)], [true, false, false]);
});

test('a person outside a channel can neither read it nor write in it', async () => {
  const production = named(jason, 'Production');
  const said = act(ravi, 'chat.post', { channel: production.id, text: 'Line two is short of thread' }).doc;
  assert.equal(said.by, ravi.id);
  await tick();
  // Maya is not in Production
  assert.ok(!channels(maya).some((c) => c.id === production.id));
  assert.ok(!svc.list(maya, 'chat_messages').some((m) => m.channel === production.id));
  assert.throws(() => svc.get(maya, 'chat_channels', production.id), /access/);
  assert.throws(() => svc.get(maya, 'chat_messages', said.id), /access/);
  for (const [step, payload] of [['chat.post', { channel: production.id, text: 'let me in' }], ['chat.read', { channel: production.id }], ['chat.edit', { id: said.id, text: 'changed' }], ['chat.delete', { id: said.id }], ['chat.members', { channel: production.id, add: [maya.id] }], ['chat.archive', { channel: production.id }]]) {
    assert.throws(() => act(maya, step, payload), /not in it/, step);
  }
  assert.equal(db.get('chat_messages', said.id).text, 'Line two is short of thread');
  // an outside login and someone who only scans get no chat at all
  for (const u of [dyer, tailor]) {
    assert.throws(() => svc.list(u, 'chat_channels'), /access/);
    assert.throws(() => act(u, 'chat.post', { channel: named(admin, 'Everyone').id, text: 'hello' }), /members of the team/);
    assert.throws(() => act(u, 'chat.open', { kind: 'direct', with: admin.id }), /members of the team/);
  }
  assert.throws(() => act(maya, 'chat.open', { kind: 'direct', with: dyer.id }), /member of the team/);
  // the lists are closed to the ordinary add and change: every write goes through a step
  assert.throws(() => svc.create(ravi, 'chat_messages', { channel: production.id, text: 'sneaky' }), /cannot add/);
  assert.throws(() => svc.update(admin, 'chat_messages', said.id, { text: 'rewritten' }), /cannot change/);
  // the words are checked
  assert.throws(() => act(ravi, 'chat.post', { channel: production.id, text: '   ' }), /Write the message/);
  assert.throws(() => act(ravi, 'chat.post', { channel: production.id, text: 'x'.repeat(4001) }), /under 4,000/);
});

test('own messages can be changed and taken back; a deleted one keeps its place', async () => {
  const everyone = named(maya, 'Everyone');
  const m = act(maya, 'chat.post', { channel: everyone.id, text: 'Lunch is at one' }).doc;
  const reply = act(ravi, 'chat.post', { channel: everyone.id, text: 'See you there', replyTo: m.id }).doc;
  const deeper = act(nidhi, 'chat.post', { channel: everyone.id, text: 'Me too', replyTo: reply.id }).doc;
  assert.deepEqual([reply.replyTo, deeper.replyTo], [m.id, m.id], 'threads are one level deep');
  assert.throws(() => act(ravi, 'chat.edit', { id: m.id, text: 'Lunch is cancelled' }), /only your own/);
  assert.throws(() => act(ravi, 'chat.delete', { id: m.id }), /only your own/);
  const edited = act(maya, 'chat.edit', { id: m.id, text: 'Lunch is at two' }).doc;
  assert.deepEqual([edited.text, edited.edited], ['Lunch is at two', true]);
  const last = act(maya, 'chat.post', { channel: everyone.id, text: 'Bring plates' }).doc;
  assert.equal(named(maya, 'Everyone').lastText, 'Bring plates');
  assert.equal(act(maya, 'chat.delete', { id: last.id }).doc.deleted, true);
  const kept = db.get('chat_messages', last.id);
  assert.deepEqual([kept.text, kept.deleted, kept.channel], ['', true, everyone.id]);
  assert.notEqual(named(maya, 'Everyone').lastText, 'Bring plates', 'the preview no longer shows what was taken back');
  assert.throws(() => act(maya, 'chat.edit', { id: last.id, text: 'back again' }), /deleted/);
  // an admin may delete anyone's message in a channel they are in
  assert.equal(act(admin, 'chat.delete', { id: reply.id }).doc.deleted, true);
});

test('a direct conversation between two people is reused, never duplicated', async () => {
  const a = act(maya, 'chat.open', { kind: 'direct', with: ravi.id }).doc;
  const b = act(ravi, 'chat.open', { kind: 'direct', with: maya.id }).doc;
  const c = act(maya, 'chat.open', { kind: 'direct', with: ravi.id }).doc;
  assert.equal(a.id, b.id); assert.equal(a.id, c.id);
  assert.equal(db.all('chat_channels').filter((x) => x.kind === 'direct').length, 1);
  assert.notEqual(act(maya, 'chat.open', { kind: 'direct', with: nidhi.id }).doc.id, a.id);
  assert.throws(() => act(maya, 'chat.open', { kind: 'direct', with: maya.id }), /someone else/);
  assert.throws(() => act(maya, 'chat.open', { kind: 'direct', with: 'nobody' }), /member of the team/);
  // the other person is always told, but not again while that notice is still unread
  act(maya, 'chat.post', { channel: a.id, text: 'Can you cover Saturday?' });
  act(maya, 'chat.post', { channel: a.id, text: 'Morning shift only' });
  assert.deepEqual(inbox(ravi).filter((t) => t.startsWith('Maya Iyer:')), ['Maya Iyer: Can you cover Saturday?']);
  assert.equal(svc.inbox(ravi).find((n) => n.text.startsWith('Maya Iyer:')).link, `chat-${a.id}`);
  await tick();
  // nobody else can read it, not even an admin
  assert.ok(!channels(admin).some((x) => x.id === a.id));
  assert.ok(!svc.list(admin, 'chat_messages').some((m) => m.channel === a.id));
  assert.throws(() => act(admin, 'chat.post', { channel: a.id, text: 'listening in' }), /not in it/);
  assert.equal(svc.list(ravi, 'chat_messages').filter((m) => m.channel === a.id).length, 2);
});

test('groups: made by anyone, run by their creator, left by anyone', async () => {
  assert.throws(() => act(maya, 'chat.open', { kind: 'group', name: 'X', members: [] }), /2 to 60/);
  assert.throws(() => act(maya, 'chat.open', { kind: 'group', name: 'Diwali', members: [dyer.id] }), /not on the team/);
  const g = act(maya, 'chat.open', { kind: 'group', name: 'Diwali party', members: [ravi.id, nidhi.id], about: 'Who brings what' }).doc;
  assert.deepEqual(g.members, [maya.id, ravi.id, nidhi.id]);
  assert.ok(inbox(nidhi).includes('Maya Iyer added you to the group Diwali party'));
  act(ravi, 'chat.post', { channel: g.id, text: 'I will bring sweets' });
  await tick();
  assert.ok(channels(nidhi).some((c) => c.id === g.id) && !channels(jason).some((c) => c.id === g.id) && !channels(admin).some((c) => c.id === g.id));
  assert.throws(() => act(ravi, 'chat.members', { channel: g.id, add: [jason.id] }), /Only whoever started/);
  assert.throws(() => act(ravi, 'chat.archive', { channel: g.id }), /Only whoever started/);
  assert.throws(() => act(jason, 'chat.members', { channel: g.id, add: [jason.id] }), /not in it/, 'nobody adds themselves');
  act(maya, 'chat.members', { channel: g.id, add: [jason.id], remove: [nidhi.id] });
  await tick();
  assert.ok(channels(jason).some((c) => c.id === g.id) && !channels(nidhi).some((c) => c.id === g.id));
  assert.equal(svc.list(jason, 'chat_messages').filter((m) => m.channel === g.id).length, 1, 'someone added later reads what was said before');
  // anyone may leave; when the creator leaves the group passes on
  assert.match(act(ravi, 'chat.members', { channel: g.id, remove: [ravi.id] }).message, /You left/);
  act(maya, 'chat.members', { channel: g.id, remove: [maya.id] });
  assert.equal(db.get('chat_channels', g.id).createdBy, jason.id);
  assert.throws(() => act(jason, 'chat.members', { channel: named(jason, 'Production').id, add: [maya.id] }), /Only a group/);
  act(jason, 'chat.archive', { channel: g.id });
  assert.throws(() => act(jason, 'chat.post', { channel: g.id, text: 'still here?' }), /closed/);
});

test('unread counts: what others said since I last read', async () => {
  const g = act(maya, 'chat.open', { kind: 'group', name: 'Stock take', members: [ravi.id, nidhi.id] }).doc;
  const mine = (u) => unreadFor(u.id, channels(u), svc.list(u, 'chat_messages'), svc.list(u, 'chat_reads'))[g.id];
  act(maya, 'chat.post', { channel: g.id, text: 'Starting at nine' });
  await tick();
  act(maya, 'chat.post', { channel: g.id, text: 'Bring the count sheets' });
  await tick();
  assert.deepEqual([mine(maya), mine(ravi), mine(nidhi)], [0, 2, 2], 'my own messages are never unread to me');
  act(ravi, 'chat.read', { channel: g.id });
  await tick();
  assert.deepEqual([mine(ravi), mine(nidhi)], [0, 2]);
  const third = act(nidhi, 'chat.post', { channel: g.id, text: 'On my way' }).doc;
  await tick();
  assert.deepEqual([mine(maya), mine(ravi), mine(nidhi)], [3 - 2, 1, 0], 'posting marks the channel read for the sender');
  act(nidhi, 'chat.delete', { id: third.id });
  await tick();
  assert.equal(mine(ravi), 0, 'a deleted message is not counted');
  // a person sees only their own read markers
  assert.ok(svc.list(ravi, 'chat_reads').length > 0 && svc.list(ravi, 'chat_reads').every((r) => r.user === ravi.id));
  // the helper on plain data
  const out = unreadFor('me', [{ id: 'a' }, { id: 'b' }], [
    { channel: 'a', by: 'you', at: '2026-01-01T10:00:00.000Z' }, { channel: 'a', by: 'you', at: '2026-01-01T12:00:00.000Z' }, { channel: 'a', by: 'me', at: '2026-01-01T13:00:00.000Z' },
    { channel: 'b', by: 'you', at: '2026-01-01T10:00:00.000Z', deleted: true }, { channel: 'c', by: 'you', at: '2026-01-01T10:00:00.000Z' },
  ], [{ user: 'me', channel: 'a', at: '2026-01-01T11:00:00.000Z' }, { user: 'you', channel: 'a', at: '2026-01-01T09:00:00.000Z' }]);
  assert.deepEqual(out, { a: 1, b: 0 });
});

test('mentions tell the people named, and only people in the channel', async () => {
  const production = named(jason, 'Production');
  const m = act(jason, 'chat.post', { channel: production.id, text: 'Thanks @Ravi, and @Maya please note. @ravindra too' }).doc;
  assert.deepEqual(m.mentions, [ravi.id], 'Maya and Ravindra are not in Production; @Ravi does not mean Ravindra');
  assert.ok(inbox(ravi).some((t) => t.startsWith('Jason Head mentioned you in Production: Thanks @Ravi')));
  assert.equal(svc.inbox(ravi).find((n) => /mentioned you in Production/.test(n.text)).link, `chat-${production.id}`);
  assert.ok(!inbox(maya).some((t) => /mentioned you/.test(t)) && !inbox(ravindra).some((t) => /mentioned you/.test(t)));
  // a full name works, and naming yourself tells nobody
  const everyone = named(maya, 'Everyone');
  assert.deepEqual(act(maya, 'chat.post', { channel: everyone.id, text: 'Ask @ravindra rao or @maya' }).doc.mentions, [ravindra.id]);
  assert.ok(inbox(ravindra).some((t) => /Maya Iyer mentioned you in Everyone/.test(t)));
  // a reply tells whoever wrote the message it answers
  const q = act(ravi, 'chat.post', { channel: everyone.id, text: 'Who has the store key?' }).doc;
  act(nidhi, 'chat.post', { channel: everyone.id, text: 'I do', replyTo: q.id });
  assert.ok(inbox(ravi).some((t) => t.startsWith('Nidhi Shah replied to you in Everyone: I do')));
  assert.deepEqual(mentionsIn('mail me@ravi.test or @RAVI!', [{ id: 'r', name: 'Ravi Kumar' }, { id: 'x', name: 'Ravindra' }, { id: 'off', name: 'Ravi Off', active: false }]), ['r']);
});

test('a message can carry a record or a task, by where it is and not what it says', async () => {
  const everyone = named(maya, 'Everyone');
  const project = svc.create(admin, 'projects', { name: 'Hidden plan', access: 'centre', centre: centre('finance').id }).doc;
  const hidden = svc.create(admin, 'tasks', { project: project.id, title: 'Quiet task' }).doc;
  const open = svc.create(maya, 'tasks', { project: svc.create(maya, 'projects', { name: 'Open plan' }).doc.id, title: 'Count the chairs' }).doc;
  const m = act(maya, 'chat.post', { channel: everyone.id, text: 'About this one', link: { entity: 'tasks', id: open.id } }).doc;
  assert.deepEqual(m.link, { entity: 'tasks', id: open.id });
  assert.throws(() => act(maya, 'chat.post', { channel: everyone.id, text: 'And this', link: { entity: 'tasks', id: hidden.id } }), /cannot be attached/, 'not a record the sender can see');
  assert.throws(() => act(maya, 'chat.post', { channel: everyone.id, text: 'And this', link: { entity: 'no_such_list', id: 'x' } }), /cannot be attached/);
  assert.throws(() => act(maya, 'chat.post', { channel: everyone.id, text: 'And this', link: { entity: 'users', id: admin.id } }), /cannot be attached/);
});

test('two businesses on one server never see each other\'s chat', async () => {
  const store = memoryDb();
  const api = createApi({ store: { run: async (fn) => fn(store) }, env: { SIGNUP: 'open' } });
  const call = async (method, path, body, cookie) => {
    const url = new URL(path, 'http://lychee.test');
    const r = await api.handle({ method, path: url.pathname, query: url.searchParams, headers: { host: 'lychee.test', ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) }, body: body || {}, raw: JSON.stringify(body || {}), ip: '1.1.1.1' });
    return { status: r.status, json: r.body ? JSON.parse(r.body) : null, cookie: (r.cookies[0] || '').split(';')[0] };
  };
  const PW = 'a-long-password', step = (name, payload, cookie) => call('POST', `/api/action/${name}`, { payload }, cookie);
  const a = await call('POST', '/api/signup', { business: 'Studio North', template: 'general', name: 'Asha', email: 'asha@north.test', password: PW });
  const b = await call('POST', '/api/signup', { business: 'Cocoa Works', template: 'food', name: 'Ben', email: 'ben@cocoa.test', password: PW });
  assert.equal(a.status, 200); assert.equal(b.status, 200);
  assert.equal((await step('chat.sync', {}, a.cookie)).status, 200);
  assert.equal((await step('chat.sync', {}, b.cookie)).status, 200);
  const chA = (await call('GET', '/api/data/chat_channels', null, a.cookie)).json, chB = (await call('GET', '/api/data/chat_channels', null, b.cookie)).json;
  // each has its own channels, named after its own work centres
  assert.ok(chA.some((c) => c.name === 'Operations') && !chB.some((c) => c.name === 'Operations'));
  assert.ok(chB.some((c) => c.name === 'Mixing and cooking') && !chA.some((c) => c.name === 'Mixing and cooking'));
  const evA = chA.find((c) => c.kind === 'everyone'), evB = chB.find((c) => c.kind === 'everyone');
  assert.notEqual(evA.id, evB.id);
  const said = await step('chat.post', { channel: evA.id, text: 'Only for Studio North' }, a.cookie);
  assert.equal(said.status, 200, JSON.stringify(said.json));
  await step('chat.post', { channel: evB.id, text: 'Only for Cocoa Works' }, b.cookie);
  // neither reads the other's messages, in the list or in everything the app loads on opening
  assert.deepEqual((await call('GET', '/api/data/chat_messages', null, a.cookie)).json.map((m) => m.text), ['Only for Studio North']);
  assert.deepEqual((await call('GET', '/api/data/chat_messages', null, b.cookie)).json.map((m) => m.text), ['Only for Cocoa Works']);
  assert.ok(!JSON.stringify((await call('GET', '/api/all', null, b.cookie)).json).includes('Studio North'));
  // nor reaches the other's channel or message by its id
  assert.equal((await call('GET', `/api/data/chat_channels/${evA.id}`, null, b.cookie)).status, 404);
  assert.equal((await call('GET', `/api/data/chat_messages/${said.json.doc.id}`, null, b.cookie)).status, 404);
  assert.equal((await step('chat.post', { channel: evA.id, text: 'Hello from next door' }, b.cookie)).status, 404);
  assert.equal((await step('chat.read', { channel: evA.id }, b.cookie)).status, 404);
  assert.equal((await step('chat.edit', { id: said.json.doc.id, text: 'Taken over' }, b.cookie)).status, 404);
  assert.equal((await step('chat.delete', { id: said.json.doc.id }, b.cookie)).status, 404);
  // nor writes to a person in the other business
  assert.equal((await step('chat.open', { kind: 'direct', with: a.json.user.id }, b.cookie)).status, 400);
  assert.equal((await step('chat.open', { kind: 'group', name: 'Both of us', members: [a.json.user.id] }, b.cookie)).status, 400);
  // and the data sits under each business's own name
  const cols = store.dump().cols;
  assert.equal(Object.keys(cols[`${a.json.workspace.id}/chat_messages`]).length, 1);
  assert.equal(Object.keys(cols[`${b.json.workspace.id}/chat_messages`]).length, 1);
  // a second person in one business hears the first within that business only
  await call('POST', '/api/users', { name: 'Maya', email: 'maya@north.test', password: PW, position: 'staff' }, a.cookie);
  const maya2 = (await call('POST', '/api/login', { email: 'maya@north.test', password: PW })).cookie;
  const before = (await call('GET', '/api/tick', null, maya2)).json.seq;
  await step('chat.post', { channel: evB.id, text: 'Cocoa again' }, b.cookie);
  assert.equal((await call('GET', '/api/tick', null, maya2)).json.seq, before, 'another business talking does not stir this one');
  await step('chat.post', { channel: evA.id, text: 'Welcome Maya' }, a.cookie);
  assert.notEqual((await call('GET', '/api/tick', null, maya2)).json.seq, before, 'a new message is news for an open page');
  assert.deepEqual((await call('GET', '/api/data/chat_messages', null, maya2)).json.map((m) => m.text), ['Only for Studio North', 'Welcome Maya']);
});
