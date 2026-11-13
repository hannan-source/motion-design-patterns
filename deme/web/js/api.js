// The web app's data layer. It talks to the server when there is one. Where the page is
// opened without a server (the hosted preview), the same service code runs in the browser over
// localStorage, so every screen works, but data stays on that device.
//
// Views read from `data` (a synchronous cache of everything the signed-in person may see) and
// change things through `api`; after any change the touched record types are refetched and
// every subscriber is told.

import { createService, memoryDb, titleOf, UserError } from '../shared/service.js';
import { ACTIONS } from '../shared/actions.js';
import { entityById, MODULES, can as canRole, levelOf } from '../shared/schema.js';
import { PLATFORM, TEMPLATES, templateById, settingsFrom, schemaFor, scopeDb, applySchema, cleanType } from '../shared/platform.js';

let mode = 'server';
let local = null; // the preview: { root, db, svc, userId, settings }
const listeners = new Set();

async function http(method, path, body) {
  const res = await fetch(`/api/${path}`, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(out.error || 'The server did not answer. Try again.'); e.status = res.status; throw e; }
  return out;
}

// ── In-browser preview ──
const LS_DB = 'lychee-preview-db', LS_USER = 'lychee-preview-user', LS_WS = 'lychee-preview-business';
const PREVIEW_WS = 'wpreview0001';
const sha = async (s) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, '0')).join('');
const hash = async (password) => { const salt = crypto.randomUUID(); return `${salt}:${await sha(salt + password)}`; };
const verify = async (password, stored) => { const [salt, h] = String(stored || '').split(':'); return !!h && (await sha(salt + password)) === h; };
function startLocal() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(LS_DB) || 'null'); } catch { /* start empty */ }
  const root = memoryDb(saved, (s) => { try { localStorage.setItem(LS_DB, JSON.stringify(s)); } catch { /* storage full or blocked: keep working in memory */ } });
  let userId = null, settings = null;
  try { userId = localStorage.getItem(LS_USER); settings = JSON.parse(localStorage.getItem(LS_WS) || 'null'); } catch { /* signed out */ }
  local = { root, userId, settings, db: null, svc: null };
  if (settings) openLocal();
}
/** The preview holds one business. (Re)build its service from its settings and the lists it has set up. */
function openLocal() {
  try { localStorage.setItem(LS_WS, JSON.stringify(local.settings)); } catch { /* fine */ }
  local.db = scopeDb(local.root, PREVIEW_WS);
  local.svc = createService(local.db, { actions: ACTIONS, hash, schema: schemaFor(local.settings, local.db.all('custom_types')), centres: templateById[local.settings.template]?.centres });
}
const localWs = () => (local.settings ? { id: PREVIEW_WS, name: local.settings.name, template: local.settings.template, modules: local.settings.modules, packs: local.settings.packs, terms: local.settings.terms || {}, domain: '', ai: { provider: 'platform', model: '', baseUrl: '', keySet: false }, connected: { shopify: false, meta: false } } : null);
const templates = () => TEMPLATES.map((t) => ({ id: t.id, name: t.name, line: t.line }));
const adminOnly = () => { const u = me(); if (!local.svc.can(u, 'admin', 'admin')) throw new UserError('Only an admin can do this.', 403); return u; };
const me = () => { const u = local.userId && local.svc.getUser(local.userId); if (!u || u.active === false) { const e = new Error('Sign in to continue.'); e.status = 401; throw e; } return u; };
const setLocalUser = (id) => { local.userId = id; try { if (id) localStorage.setItem(LS_USER, id); else localStorage.removeItem(LS_USER); } catch { /* fine */ } };
const guard = async (fn) => { try { return await fn(); } catch (e) { if (e instanceof UserError) { const x = new Error(e.message); x.status = e.status; throw x; } throw e; } };

export const api = {
  get mode() { return mode; },
  /** What this copy of the server has switched on: Google sign-in, AI mapping. */
  caps: { google: false, passwords: true, ai: false, mail: false, shopify: false, meta: false, signup: 'closed' },
  product: PLATFORM,
  templates: [],
  /**
   * Who is signed in, and whether the first account still has to be made. The hosted preview page
   * is marked as such when it is built and keeps its data in this browser; every other copy talks
   * to its server and says so when the server cannot be reached, so live data never lands in one
   * person's browser by accident.
   */
  async state() {
    if (document.getElementById('app')?.dataset.preview === '1') {
      mode = 'local'; startLocal();
      api.templates = templates(); api.caps.signup = local.settings ? 'closed' : 'first';
      const u = local.svc && local.userId && local.svc.getUser(local.userId);
      return { setupNeeded: !local.settings, signup: api.caps.signup, user: local.svc ? local.svc.publicUser(u) : null, workspace: localWs(), templates: api.templates };
    }
    mode = 'server';
    let last = null;
    for (let i = 0; i < 3; i++) {
      try {
        const s = await http('GET', 'state');
        api.caps.google = !!s.google; api.caps.passwords = s.passwords !== false; api.caps.ai = !!s.ai; api.caps.mail = !!s.mail; api.caps.shopify = !!s.shopify; api.caps.meta = !!s.meta; api.caps.signup = s.signup || 'closed'; api.templates = s.templates || [];
        return s;
      } catch (e) {
        last = e;
        if (e.status && e.status < 500) break;
        await new Promise((r) => setTimeout(r, 700 * (i + 1)));
      }
    }
    throw new Error(last?.status ? last.message : 'The server did not answer.');
  },
  /** Start a business: its name, the template it starts from, and the first person. */
  setup: (input) => (mode === 'server' ? http('POST', api.caps.signup === 'first' ? 'setup' : 'signup', input) : guard(async () => {
    if (local.settings) throw new UserError('This preview already holds a business. Sign in, or reset the preview.', 409);
    local.settings = settingsFrom(input.template, input.business); openLocal();
    try { const user = await local.svc.setup(input); setLocalUser(user.id); return { user, workspace: localWs() }; }
    catch (e) { local.settings = null; local.svc = null; try { localStorage.removeItem(LS_WS); } catch { /* fine */ } throw e; }
  })),
  /** An invitation: who it is for, and taking it up with a password (live site only). */
  invite: (token) => http('GET', `invite?token=${encodeURIComponent(token)}`),
  acceptInvite: (token, password) => http('POST', 'invite/accept', { token, password }),
  /** Sign in. Where the same person is on more than one business the reply is `{ choose: [{ ws, name }] }`; call again with `ws`. */
  login: (email, password, ws) => (mode === 'server' ? http('POST', 'login', { email, password, ws }) : guard(async () => {
    const u = local.svc?.findUserByEmail(email);
    if (!u || u.active === false || !(await verify(password, u.pass))) throw new UserError('Email or password is not right.', 401);
    setLocalUser(u.id); return { user: local.svc.publicUser(u) };
  })),
  logout: async () => { if (mode === 'server') await http('POST', 'logout', {}); else setLocalUser(null); },
  boot: () => (mode === 'server' ? http('GET', 'boot') : guard(async () => { const u = me(); return { workspace: localWs(), types: local.db.all('custom_types'), user: local.svc.publicUser(u), readable: local.svc.readable(u), writable: local.svc.writable(u), users: local.svc.listUsers(u), mine: local.svc.mine(u) }; })),
  list: (entity) => (mode === 'server' ? http('GET', `data/${entity}`) : guard(async () => local.svc.list(me(), entity))),
  create: (entity, input) => change(mode === 'server' ? http('POST', `data/${entity}`, input) : guard(async () => local.svc.create(me(), entity, input))),
  update: (entity, id, input) => change(mode === 'server' ? http('PUT', `data/${entity}/${id}`, input) : guard(async () => local.svc.update(me(), entity, id, input))),
  remove: (entity, id) => change(mode === 'server' ? http('DELETE', `data/${entity}/${id}`) : guard(async () => local.svc.remove(me(), entity, id))),
  /** Adds rows in parts of 500 so a big file never becomes one oversized request. Row numbers in errors stay those of the file. */
  importRows: async (entity, rows) => {
    const SIZE = 500, errors = []; let created = 0, last = {};
    for (let i = 0; i < rows.length || i === 0; i += SIZE) {
      const part = rows.slice(i, i + SIZE);
      try { last = await change(mode === 'server' ? http('POST', `import/${entity}`, { rows: part }) : guard(async () => local.svc.importRows(me(), entity, part))); }
      catch (e) { if (!created && !errors.length) throw e; throw new Error(`Stopped after the first ${i} rows (${created} added): ${e.message}`); }
      created += last.created; errors.push(...last.errors.map((x) => ({ ...x, row: x.row + i })));
    }
    return { ...last, created, errors };
  },
  /** Run a business action. `on` is { entity, id } for a record action; leave it out for scans and self-service. */
  act: (actionId, payload = {}, on = {}) => change(mode === 'server' ? http('POST', `action/${actionId}`, { ...on, payload }) : guard(async () => local.svc.act(me(), actionId, { ...on, payload }))),
  audit: (entity, id) => (mode === 'server' ? http('GET', `audit?${new URLSearchParams(Object.entries({ entity, id }).filter(([, v]) => v))}`) : guard(async () => local.svc.audit(me(), { entity, id }))),
  createUser: (input) => (mode === 'server' ? http('POST', 'users', input) : guard(async () => local.svc.createUser(me(), input))).then(async (u) => { await data.load(); return u; }),
  updateUser: (id, input) => (mode === 'server' ? http('PUT', `users/${id}`, input) : guard(async () => local.svc.updateUser(me(), id, input))).then(async (u) => { await data.load(); return u; }),
  // ── The business itself, the lists it sets up, and the people it invites ──
  /** Change the business: name, areas switched on, its words, its AI connection and connections. Keys go in `secrets` and are never read back. */
  saveWorkspace: (input) => (mode === 'server' ? http('PUT', 'workspace', input) : guard(async () => {
    adminOnly(); const s = local.settings;
    if (input.name !== undefined) { const n = String(input.name).trim(); if (n.length < 2) throw new UserError('Give the business a name of 2 to 60 characters.'); s.name = n; }
    if (Array.isArray(input.modules)) s.modules = [...new Set([...input.modules, 'masters', 'hr', 'projects', 'admin'])];
    if (Array.isArray(input.packs)) s.packs = input.packs.filter((x) => x === 'apparel');
    if (input.terms) s.terms = input.terms;
    openLocal(); return localWs();
  })).then(async (w) => { await data.load(); return w; }),
  types: {
    save: (def) => (mode === 'server' ? http(def.id ? 'PUT' : 'POST', def.id ? `types/${def.id}` : 'types', def) : guard(async () => {
      adminOnly(); const all = local.db.all('custom_types'), old = def.id ? all.find((t) => t.id === def.id) : null;
      let clean; try { clean = cleanType({ ...def, id: old?.id, key: old?.key }, all); } catch (e) { throw new UserError(e.message); }
      const doc = { id: old?.id || crypto.randomUUID().replace(/-/g, '').slice(0, 16), ...clean, createdAt: old?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
      local.db.put('custom_types', doc); openLocal(); return doc;
    })).then(async (t) => { await data.load(); return t; }),
    remove: (id) => (mode === 'server' ? http('DELETE', `types/${id}`) : guard(async () => {
      adminOnly(); const old = local.db.all('custom_types').find((t) => t.id === id); if (!old) throw new UserError('No such list.', 404);
      const n = local.db.all(`x_${old.key}`).length; if (n) throw new UserError(`${old.name} still holds ${n} ${n === 1 ? 'record' : 'records'}. Empty it first, so nothing is lost by mistake.`);
      local.db.del('custom_types', id); openLocal(); return { ok: true };
    })).then(async (r) => { await data.load(); return r; }),
  },
  /** Invite someone by email. Returns `{ user, link, emailed }`; give them the link when no email went out. */
  inviteUser: (input) => (mode === 'server' ? http('POST', 'invites', input) : guard(async () => ({ user: await local.svc.invite(me(), input), link: '', emailed: false }))).then(async (r) => { await data.load(); return r; }),
  /** Read completed slips off photos (live site with an AI connection). `images`: [{ type, data (base64) }]. Changes nothing; returns what was seen for a person to confirm. */
  readSlips: (images) => http('POST', 'ai/slips', { images }),
  /** Bring in new orders from Shopify, or spend from Meta (live site only, when connected). `since` is YYYY-MM-DD or empty. */
  shopifyPull: (since = '') => change(http('POST', 'shopify/pull', { since }).then((o) => ({ ...o, touched: ['shop_orders', 'slips'] }))),
  mediaPull: (since = '') => change(http('POST', 'media/pull', { since }).then((o) => ({ ...o, touched: ['media_days'] }))),
  /** Photos and documents on a record: add (base64 `data`), list, fetch one (with its data), remove. */
  files: {
    add: (entity, id, file) => change((mode === 'server' ? http('POST', 'files', { entity, id, ...file }) : guard(async () => local.svc.addFile(me(), { entity, id, ...file }))).then((meta) => ({ ...meta, touched: [entity] }))),
    list: (entity, id) => (mode === 'server' ? http('GET', `files?${new URLSearchParams({ entity, id })}`) : guard(async () => local.svc.listFiles(me(), entity, id))),
    get: (fileId) => (mode === 'server' ? http('GET', `files/${fileId}`) : guard(async () => local.svc.getFile(me(), fileId))),
    remove: (fileId) => (mode === 'server' ? http('DELETE', `files/${fileId}`) : guard(async () => local.svc.removeFile(me(), fileId))),
  },
  /** Say which position I hold. It waits for the head of that work centre, or an admin, to confirm. */
  pickPosition: (position, station = '') => (mode === 'server' ? http('POST', 'me/position', { position, station }) : guard(async () => local.svc.pickPosition(me(), { position, station }))).then(async (u) => { await data.load(); return u; }),
  /** Confirm (or turn down) someone's request to join. */
  decideJoin: (id, ok) => (mode === 'server' ? http('POST', `users/${id}/join`, { ok }) : guard(async () => local.svc.decideJoin(me(), id, ok))).then(async (u) => { await data.load(); return u; }),
  inbox: () => (mode === 'server' ? http('GET', 'inbox') : guard(async () => local.svc.inbox(me()))),
  readInbox: async (ids = null) => { const list = await (mode === 'server' ? http('POST', 'inbox/read', { ids }) : guard(async () => local.svc.readInbox(me(), ids))); data.inbox = list; emit(['notifications']); return list; },
  /** Tally import XML for the given vouchers (all open ones if none given). */
  async tallyXml(ids = []) {
    if (mode === 'server') { const res = await fetch(`/api/export/tally?ids=${ids.join(',')}`, { credentials: 'same-origin' }); if (!res.ok) throw new Error('Could not build the export.'); return res.text(); }
    const { vouchersToTallyXML } = await import('../shared/tally.js');
    const vs = data.all('vouchers').filter((v) => (ids.length ? ids.includes(v.id) : v.status === 'open'));
    return vouchersToTallyXML(vs.map((v) => ({ ...v, id: v.no })), 'Deme');
  },
  /** Ask the server's AI which record type and fields a spreadsheet's columns belong to (server only). */
  aiMap: (body) => http('POST', 'ai/map', body),
  /** Service keys for other programs (server only). */
  keys: { list: () => http('GET', 'keys'), create: (name, role) => http('POST', 'keys', { name, role }), setActive: (id, active) => http('PUT', `keys/${id}`, { active }) },
  /** Preview only: wipe everything stored in this browser. */
  resetPreview() { try { localStorage.removeItem(LS_DB); localStorage.removeItem(LS_USER); localStorage.removeItem(LS_WS); } catch { /* fine */ } location.reload(); },
};

/** Make this browser's lists and areas those of the business just loaded. */
function takeOn(workspace, types) {
  data.workspace = workspace || null; data.types = types || [];
  if (workspace) applySchema(schemaFor(workspace, data.types));
}

async function change(promise) {
  const out = await promise;
  await data.refresh(out.touched || []);
  return out;
}

export const data = {
  user: null, users: [], mine: null, inbox: [], readable: new Set(), writable: new Set(), cache: {}, ready: false,
  /** The business this person is signed in to, and the lists it has set up for itself. */
  workspace: null, types: [],
  /** Fetch who I am and everything I may read. */
  async load() {
    if (mode === 'server') {   // one request for everything this person may read
      const b = await http('GET', 'all');
      takeOn(b.workspace, b.types);
      Object.assign(data, { seq: b.seq, user: b.user, users: b.users, mine: b.mine, inbox: b.mine?.inbox || [], readable: new Set(b.readable), writable: new Set(b.writable), cache: b.data });
    } else {
      const b = await api.boot();
      takeOn(b.workspace, b.types);
      Object.assign(data, { user: b.user, users: b.users, mine: b.mine, inbox: b.mine?.inbox || [], readable: new Set(b.readable), writable: new Set(b.writable) });
      const lists = await Promise.all(b.readable.map((e) => api.list(e)));
      data.cache = Object.fromEntries(b.readable.map((e, i) => [e, lists[i]]));
    }
    data.ready = true; emit(['*']);
  },
  async refresh(touched) {
    const mineToo = touched.some((t) => ['attendance', 'leaves', 'kras', 'employees', 'notifications', 'work_centres'].includes(t));
    const todo = touched.filter((e) => data.readable.has(e));
    const lists = await Promise.all(todo.map((e) => api.list(e)));
    todo.forEach((e, i) => { data.cache[e] = lists[i]; });
    if (mineToo) { const b = await api.boot(); Object.assign(data, { mine: b.mine, inbox: b.mine?.inbox || [], users: b.users, user: b.user, writable: new Set(b.writable) }); }
    if (touched.length) emit(touched);
  },
  /**
   * Called on a timer while the app is open: has anyone changed anything since this page last
   * loaded? If so, load it again, so what one person enters shows on everyone else's screen
   * without a refresh. While this person is typing, only tasks and comments are refreshed, and
   * the rest waits until they stop, so nothing is redrawn under their hands.
   */
  async poll() {
    if (!data.ready) return;
    if (mode !== 'server') { const before = data.inbox[0]?.id; data.inbox = await api.inbox(); if (data.inbox[0]?.id !== before) emit(['notifications']); return; }
    const t = await http('GET', 'tick');
    const news = t.seq !== data.seq, notice = t.notice !== (data.inbox[0]?.id || '');
    if (!news && !notice) return;
    const a = document.activeElement, typing = !!a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName));
    if (news && !typing) return data.load();
    await data.refresh([...(news ? ['tasks', 'comments', 'projects'] : []), ...(notice ? ['notifications'] : [])]);
  },
  clear() { Object.assign(data, { user: null, users: [], mine: null, inbox: [], readable: new Set(), writable: new Set(), cache: {}, ready: false }); },
  all: (entity) => data.cache[entity] || [],
  get: (entity, id) => (data.cache[entity] || []).find((d) => d.id === id) || null,
  /** Display text for a referenced record, or for a team member when entity is 'users'. */
  title(entity, id) { if (!id) return ''; if (entity === 'users') return data.users.find((u) => u.id === id)?.name || ''; const d = data.get(entity, id); return d ? titleOf(entity, d) : ''; },
  // An area that is switched off for this business is closed, whatever the role.
  can: (module, level = 'read') => (module === 'lists' || !!MODULES[module]) && canRole(data.user, module, level),
  level: (module) => (module === 'lists' || MODULES[module] ? levelOf(data.user, module) : 'none'),
  canRead: (entity) => data.readable.has(entity),
  canWrite: (entity) => data.writable.has(entity),
  /** Subscribe to changes. `fn(touched)` gets the record types that changed, or ['*'] after a full load. */
  on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  entity: (id) => entityById[id],
};
function emit(touched) { listeners.forEach((l) => { try { l(touched); } catch (e) { console.error(e); } }); }
