// Work centres, positions, joining with approval, tasks between teams, comments and notices.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createService, memoryDb } from '../shared/service.js';
import { ACTIONS } from '../shared/actions.js';
import { createApi } from '../server/app.js';
import { DEFAULT_CENTRES } from '../shared/org.js';

const db = memoryDb();
const svc = createService(db, { actions: ACTIONS, hash: async (p) => `h:${p}` });
const fresh = (id) => svc.getUser(id);
const admin = fresh((await svc.setup({ name: 'Hannan', email: 'admin@deme.test', password: 'correct-horse' })).id);
const centre = (key) => db.all('work_centres').find((c) => c.key === key);
const person = async (name, position) => fresh((await svc.createUser(admin, { name, email: `${name.toLowerCase()}@deme.test`, password: 'correct-horse', position })).id);
const inbox = (u) => svc.inbox(u).map((n) => n.text);

test('setup makes a system admin and the starting work centres, not a founder who enters data', () => {
  assert.equal(admin.role, 'admin'); assert.equal(admin.position, 'setup');
  assert.equal(db.all('work_centres').length, DEFAULT_CENTRES.length);
  assert.equal(centre('management').head, admin.id);
  const stations = db.all('workstations').filter((s) => s.centre === centre('production').id);
  assert.deepEqual(stations.map((s) => s.stage).sort(), ['cut', 'finish', 'pack', 'qc', 'stitch', 'stitch', 'stitch']);
  assert.ok(stations.every((s) => s.people === 0), 'headcount is left for the production head to fill in');
});

let jason, nidhi, gabriella, ravi;
test('a position brings its role and work centre; naming a head tells them', async () => {
  gabriella = await person('Gabriella', 'founder'); jason = await person('Jason', 'prod_b2b'); nidhi = await person('Nidhi', 'merch');
  assert.equal(jason.role, 'production_head'); assert.equal(jason.centre, centre('production').id);
  svc.update(admin, 'work_centres', centre('production').id, { head: jason.id });
  svc.update(admin, 'work_centres', centre('merchandising').id, { head: nidhi.id });
  svc.update(admin, 'work_centres', centre('design').id, { head: gabriella.id });
  assert.ok(inbox(jason).includes('You are now in charge of Production'));
  // only an admin shapes the work centres themselves
  assert.throws(() => svc.update(nidhi, 'work_centres', centre('production').id, { name: 'Mine' }), /cannot change/);
});

test('a head runs the workstations of their own work centre only', () => {
  const made = svc.create(jason, 'workstations', { name: 'Embroidery table', centre: centre('production').id, stage: 'stitch', people: 4 }).doc;
  assert.equal(svc.update(jason, 'workstations', made.id, { people: 6 }).doc.people, 6);
  assert.throws(() => svc.create(jason, 'workstations', { name: 'Not mine', centre: centre('finance').id }), /in charge of/);
  assert.throws(() => svc.update(jason, 'workstations', made.id, { centre: centre('finance').id }), /in charge of/);
  const design = db.all('workstations').find((s) => s.centre === centre('design').id);
  assert.throws(() => svc.update(nidhi, 'workstations', design.id, { people: 2 }), /cannot change/);
});

test('someone new picks a position; it counts only once the head of that work centre confirms', async () => {
  ravi = svc.externalUser({ email: 'ravi@deme.test', name: 'Ravi' }, { autoJoin: true });
  assert.equal(ravi.role, 'staff'); assert.equal(ravi.position, undefined);
  svc.pickPosition(ravi, { position: 'prod_manager' });
  assert.equal(fresh(ravi.id).role, 'staff', 'nothing changes until it is confirmed');
  assert.ok(inbox(jason).includes('Ravi asks to join as Production manager'));
  assert.ok(svc.listUsers(jason).find((u) => u.id === ravi.id).pending, 'the head sees the request');
  assert.equal(svc.listUsers(nidhi).find((u) => u.id === ravi.id).pending, null, 'another head does not');
  assert.throws(() => svc.decideJoin(nidhi, ravi.id, true), /Only an admin or the head/);
  svc.decideJoin(jason, ravi.id, true);
  ravi = fresh(ravi.id);
  assert.equal(ravi.role, 'production_manager'); assert.equal(ravi.centre, centre('production').id); assert.equal(ravi.pending, undefined);
  // a position with wide access is for an admin to confirm, not a head
  const meena = svc.externalUser({ email: 'meena@deme.test', name: 'Meena' }, { autoJoin: true });
  svc.pickPosition(meena, { position: 'finance' });
  assert.ok(inbox(admin).includes('Meena asks to join as Finance'));
  assert.throws(() => svc.decideJoin(jason, meena.id, true), /Only an admin/);
  svc.decideJoin(admin, meena.id, true);
  assert.equal(fresh(meena.id).role, 'finance');
});

test('the go-live plan lands on the people who hold each position', () => {
  svc.act(admin, 'golive.create', { payload: { start: '2026-11-16' } });
  const tasks = db.all('tasks');
  assert.ok(tasks.filter((t) => t.ownerRole === 'merch').every((t) => t.assignee === nidhi.id));
  assert.ok(tasks.filter((t) => t.ownerRole === 'founder').every((t) => t.assignee === gabriella.id));
  assert.ok(inbox(nidhi).some((t) => /^The go-live plan is ready: \d+ tasks are yours$/.test(t)));
  assert.ok(tasks.filter((t) => t.ownerRole === 'stores').every((t) => !t.assignee), 'unheld positions wait for whoever takes them');
});

test('a person who joins later is handed the open tasks of their position', () => {
  const sunil = svc.externalUser({ email: 'sunil@deme.test', name: 'Sunil' }, { autoJoin: true });
  svc.update(admin, 'work_centres', centre('stores').id, { head: admin.id });
  svc.pickPosition(sunil, { position: 'stores' });
  svc.decideJoin(admin, sunil.id, true);
  assert.ok(db.all('tasks').filter((t) => t.ownerRole === 'stores').every((t) => t.assignee === sunil.id));
  assert.ok(inbox(sunil).some((t) => /^You are in as Stores, inward and outward: \d+ tasks are waiting for you$/.test(t)));
});

test('one work centre asks another; only the people on a task change it, anyone can comment', () => {
  const out = svc.act(nidhi, 'task.ask', { payload: { centre: centre('production').id, title: 'I need 80 samples of the Isla kaftan', due: '2026-11-28' } });
  const task = db.get('tasks', out.data.task);
  assert.equal(task.assignee, jason.id); assert.match(out.message, /Sent to Jason/);
  assert.equal(db.get('projects', task.project).kind, 'requests');
  assert.ok(inbox(jason).includes('Nidhi asked Production: I need 80 samples of the Isla kaftan'));
  // an onlooker cannot move it, but can speak
  const meena = svc.findUserByEmail('meena@deme.test');
  assert.throws(() => svc.act(meena, 'task.move', { payload: { id: task.id, status: 'done' } }), /Add a comment instead/);
  assert.throws(() => svc.update(meena, 'tasks', task.id, { title: 'Hijacked' }), /Add a comment instead/);
  svc.act(meena, 'task.comment', { payload: { id: task.id, text: 'Budget is approved for this. @Gabriella to see.' } });
  assert.ok(inbox(jason).some((t) => t.startsWith('Meena on I need 80 samples')));
  assert.ok(inbox(gabriella).some((t) => t.startsWith('Meena on I need 80 samples')), 'a mention reaches the person named');
  // the head answers, and the one who asked hears about it
  svc.act(jason, 'task.comment', { payload: { id: task.id, text: 'Can do 50 by the 28th, the rest a week later.' } });
  svc.act(jason, 'task.start', { entity: 'tasks', id: task.id });
  svc.act(jason, 'task.done', { entity: 'tasks', id: task.id });
  assert.ok(inbox(nidhi).includes('Done: I need 80 samples of the Isla kaftan'));
  assert.equal(svc.list(nidhi, 'comments').filter((c) => c.task === task.id).length, 2);
});

test('a task that waits for another tells its owner when the way is clear', () => {
  const p = db.all('projects').find((x) => x.kind === 'requests');
  const first = svc.create(nidhi, 'tasks', { project: p.id, title: 'Fabric approved', assignee: nidhi.id }).doc;
  const second = svc.create(nidhi, 'tasks', { project: p.id, title: 'Cut the samples', centre: centre('production').id, dependsOn: [first.id] }).doc;
  assert.equal(second.assignee, jason.id, 'addressed to a work centre, it goes to its head');
  assert.throws(() => svc.update(nidhi, 'tasks', first.id, { dependsOn: [second.id] }), /waiting for each other/);
  svc.act(nidhi, 'task.done', { entity: 'tasks', id: first.id });
  assert.ok(inbox(jason).some((t) => t.startsWith('You can start: Cut the samples')));
});

test('a project limited to its work centre is hidden from everyone else', () => {
  const p = svc.create(jason, 'projects', { name: 'Line rebalancing', centre: centre('production').id, access: 'centre' }).doc;
  const t = svc.create(jason, 'tasks', { project: p.id, title: 'Move two tailors to D2C' }).doc;
  assert.ok(svc.list(ravi, 'projects').some((x) => x.id === p.id), 'the work centre sees it');
  assert.ok(!svc.list(nidhi, 'projects').some((x) => x.id === p.id));
  assert.ok(!svc.list(nidhi, 'tasks').some((x) => x.id === t.id));
  assert.throws(() => svc.get(nidhi, 'tasks', t.id), /access/);
  assert.ok(svc.list(gabriella, 'tasks').some((x) => x.id === t.id), 'the founder sees everything');
});

test('notices are emailed once the request is saved, when email is switched on', async () => {
  const sent = [];
  const store = { run: async (fn) => fn(db) };
  const api = createApi({ store, env: { RESEND_API_KEY: 'k', MAIL_FROM: 'Deme <x@deme.test>', PUBLIC_URL: 'https://deme.test' }, fetchImpl: async (url, init) => { sent.push({ url, body: JSON.parse(init.body), auth: init.headers.authorization }); return { ok: true, status: 200 }; } });
  const call = async (method, path, body, cookie) => { const r = await api.handle({ method, path, query: new URLSearchParams(), headers: { host: 'deme.test', 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body || {}, ip: '1' }); return { status: r.status, json: JSON.parse(r.body), cookie: (r.cookies[0] || '').split(';')[0] }; };
  // act through the API as Nidhi by planting a session for her
  const { createHash } = await import('node:crypto');
  db.put('sessions', { id: createHash('sha256').update('tok').digest('hex'), user: nidhi.id, expires: Date.now() + 6e5 });
  const r = await call('POST', '/api/action/task.ask', { payload: { centre: centre('production').id, title: 'Quote for 200 units' } }, 'deme_sid=tok');
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, 'https://api.resend.com/emails'); assert.equal(sent[0].auth, 'Bearer k');
  assert.deepEqual(sent[0].body.to, ['jason@deme.test']); assert.equal(sent[0].body.subject, 'Nidhi asked Production: Quote for 200 units');
  assert.match(sent[0].body.text, /https:\/\/deme\.test\/#task-/);
  assert.ok((await call('GET', '/api/inbox', null, 'deme_sid=tok')).json.length >= 1);
});

test('only an admin creates the go-live plan; a team member cannot', () => {
  const db2 = memoryDb(); const s2 = createService(db2, { actions: ACTIONS, hash: async (p) => `h:${p}` });
  return s2.setup({ name: 'A', email: 'a@deme.test', password: 'correct-horse' }).then(async (a) => {
    const staff = s2.externalUser({ email: 'x@deme.test', name: 'X' }, { autoJoin: true });
    assert.throws(() => s2.act(staff, 'golive.create', { payload: {} }), /cannot do this/);
    assert.equal(s2.act(s2.getUser(a.id), 'golive.create', { payload: { start: '2026-11-16' } }).data.project.length > 0, true);
    // a team member with no position can still raise a task and see the work centres
    assert.ok(s2.list(staff, 'work_centres').length > 0);
    assert.ok(s2.act(staff, 'task.ask', { payload: { centre: s2.list(staff, 'work_centres')[0].id, title: 'Where do I sit?' } }).data.task);
  });
});
