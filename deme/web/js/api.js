// The web app's data layer. It talks to the Deme server when there is one. Where the page is
// opened without a server (the hosted preview), the same service code runs in the browser over
// localStorage, so every screen works, but data stays on that device.
//
// Views read from `data` (a synchronous cache of everything the signed-in person may see) and
// change things through `api`; after any change the touched record types are refetched and
// every subscriber is told.

import { createService, memoryDb, titleOf, UserError } from '../shared/service.js';
import { ACTIONS } from '../shared/actions.js';
import { entityById, can as canRole, levelOf } from '../shared/schema.js';

let mode = 'server';
let local = null; // { svc, db, userId }
const listeners = new Set();

async function http(method, path, body) {
  const res = await fetch(`/api/${path}`, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(out.error || 'The server did not answer. Try again.'); e.status = res.status; throw e; }
  return out;
}

// ── In-browser preview ──
const LS_DB = 'deme-preview-db', LS_USER = 'deme-preview-user';
const sha = async (s) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, '0')).join('');
const hash = async (password) => { const salt = crypto.randomUUID(); return `${salt}:${await sha(salt + password)}`; };
const verify = async (password, stored) => { const [salt, h] = String(stored || '').split(':'); return !!h && (await sha(salt + password)) === h; };
function startLocal() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(LS_DB) || 'null'); } catch { /* start empty */ }
  const db = memoryDb(saved, (s) => { try { localStorage.setItem(LS_DB, JSON.stringify(s)); } catch { /* storage full or blocked: keep working in memory */ } });
  let userId = null;
  try { userId = localStorage.getItem(LS_USER); } catch { /* signed out */ }
  local = { db, svc: createService(db, { actions: ACTIONS, hash }), userId };
}
const me = () => { const u = local.userId && local.svc.getUser(local.userId); if (!u || u.active === false) { const e = new Error('Sign in to continue.'); e.status = 401; throw e; } return u; };
const setLocalUser = (id) => { local.userId = id; try { if (id) localStorage.setItem(LS_USER, id); else localStorage.removeItem(LS_USER); } catch { /* fine */ } };
const guard = async (fn) => { try { return await fn(); } catch (e) { if (e instanceof UserError) { const x = new Error(e.message); x.status = e.status; throw x; } throw e; } };

export const api = {
  get mode() { return mode; },
  /** Find out whether a server is there, then whether anyone is signed in. */
  async state() {
    try {
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 2500);
      const res = await fetch('/api/health', { signal: ctl.signal }); clearTimeout(t);
      const j = await res.json(); if (!j.ok) throw new Error('not deme');
      mode = 'server';
      return await http('GET', 'state');
    } catch {
      mode = 'local'; startLocal();
      const u = local.userId && local.svc.getUser(local.userId);
      return { setupNeeded: !local.svc.hasUsers(), user: local.svc.publicUser(u) };
    }
  },
  setup: (input) => (mode === 'server' ? http('POST', 'setup', input) : guard(async () => { const user = await local.svc.setup(input); setLocalUser(user.id); return { user }; })),
  login: (email, password) => (mode === 'server' ? http('POST', 'login', { email, password }) : guard(async () => {
    const u = local.svc.findUserByEmail(email);
    if (!u || u.active === false || !(await verify(password, u.pass))) throw new UserError('Email or password is not right.', 401);
    setLocalUser(u.id); return { user: local.svc.publicUser(u) };
  })),
  logout: async () => { if (mode === 'server') await http('POST', 'logout', {}); else setLocalUser(null); },
  boot: () => (mode === 'server' ? http('GET', 'boot') : guard(async () => { const u = me(); return { user: local.svc.publicUser(u), readable: local.svc.readable(u), writable: local.svc.writable(u), users: local.svc.listUsers(u), mine: local.svc.mine(u) }; })),
  list: (entity) => (mode === 'server' ? http('GET', `data/${entity}`) : guard(async () => local.svc.list(me(), entity))),
  create: (entity, input) => change(mode === 'server' ? http('POST', `data/${entity}`, input) : guard(async () => local.svc.create(me(), entity, input))),
  update: (entity, id, input) => change(mode === 'server' ? http('PUT', `data/${entity}/${id}`, input) : guard(async () => local.svc.update(me(), entity, id, input))),
  remove: (entity, id) => change(mode === 'server' ? http('DELETE', `data/${entity}/${id}`) : guard(async () => local.svc.remove(me(), entity, id))),
  importRows: (entity, rows) => change(mode === 'server' ? http('POST', `import/${entity}`, { rows }) : guard(async () => local.svc.importRows(me(), entity, rows))),
  /** Run a business action. `on` is { entity, id } for a record action; leave it out for scans and self-service. */
  act: (actionId, payload = {}, on = {}) => change(mode === 'server' ? http('POST', `action/${actionId}`, { ...on, payload }) : guard(async () => local.svc.act(me(), actionId, { ...on, payload }))),
  audit: (entity, id) => (mode === 'server' ? http('GET', `audit?${new URLSearchParams(Object.entries({ entity, id }).filter(([, v]) => v))}`) : guard(async () => local.svc.audit(me(), { entity, id }))),
  createUser: (input) => (mode === 'server' ? http('POST', 'users', input) : guard(async () => local.svc.createUser(me(), input))).then(async (u) => { await data.load(); return u; }),
  updateUser: (id, input) => (mode === 'server' ? http('PUT', `users/${id}`, input) : guard(async () => local.svc.updateUser(me(), id, input))).then(async (u) => { await data.load(); return u; }),
  /** Tally import XML for the given vouchers (all open ones if none given). */
  async tallyXml(ids = []) {
    if (mode === 'server') { const res = await fetch(`/api/export/tally?ids=${ids.join(',')}`, { credentials: 'same-origin' }); if (!res.ok) throw new Error('Could not build the export.'); return res.text(); }
    const { vouchersToTallyXML } = await import('../shared/tally.js');
    const vs = data.all('vouchers').filter((v) => (ids.length ? ids.includes(v.id) : v.status === 'open'));
    return vouchersToTallyXML(vs.map((v) => ({ ...v, id: v.no })), 'Deme');
  },
  /** Preview only: wipe everything stored in this browser. */
  resetPreview() { try { localStorage.removeItem(LS_DB); localStorage.removeItem(LS_USER); } catch { /* fine */ } location.reload(); },
};

async function change(promise) {
  const out = await promise;
  await data.refresh(out.touched || []);
  return out;
}

export const data = {
  user: null, users: [], mine: null, readable: new Set(), writable: new Set(), cache: {}, ready: false,
  /** Fetch who I am and everything I may read. */
  async load() {
    const b = await api.boot();
    Object.assign(data, { user: b.user, users: b.users, mine: b.mine, readable: new Set(b.readable), writable: new Set(b.writable) });
    const lists = await Promise.all(b.readable.map((e) => api.list(e)));
    data.cache = Object.fromEntries(b.readable.map((e, i) => [e, lists[i]]));
    data.ready = true; emit(['*']);
  },
  async refresh(touched) {
    const mineToo = touched.some((t) => ['attendance', 'leaves', 'kras', 'employees'].includes(t));
    const todo = touched.filter((e) => data.readable.has(e));
    const lists = await Promise.all(todo.map((e) => api.list(e)));
    todo.forEach((e, i) => { data.cache[e] = lists[i]; });
    if (mineToo) data.mine = (await api.boot()).mine;
    if (touched.length) emit(touched);
  },
  clear() { Object.assign(data, { user: null, users: [], mine: null, readable: new Set(), writable: new Set(), cache: {}, ready: false }); },
  all: (entity) => data.cache[entity] || [],
  get: (entity, id) => (data.cache[entity] || []).find((d) => d.id === id) || null,
  /** Display text for a referenced record, or for a team member when entity is 'users'. */
  title(entity, id) { if (!id) return ''; if (entity === 'users') return data.users.find((u) => u.id === id)?.name || ''; const d = data.get(entity, id); return d ? titleOf(entity, d) : ''; },
  can: (module, level = 'read') => canRole(data.user, module, level),
  level: (module) => levelOf(data.user, module),
  canRead: (entity) => data.readable.has(entity),
  canWrite: (entity) => data.writable.has(entity),
  /** Subscribe to changes. `fn(touched)` gets the record types that changed, or ['*'] after a full load. */
  on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  entity: (id) => entityById[id],
};
function emit(touched) { listeners.forEach((l) => { try { l(touched); } catch (e) { console.error(e); } }); }
