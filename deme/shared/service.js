// The ERP's rules, independent of where the data lives. The Node server runs this over SQLite;
// the in-browser preview runs the same code over localStorage. Everything goes through here:
// permissions, validation, numbering, the audit trail and the business actions.
//
// `db` is a small synchronous interface:
//   all(col) get(col, id) put(col, doc) del(col, id) next(counter) log(entry) logs(filter) tx(fn)

import { ENTITIES, entityById, fieldsOf, can, levelOf, LEVELS, ROLES, MODULES, STARTER_LEDGERS } from './schema.js';
import { positionById, DEFAULT_CENTRES, headOf, isHead, isMine } from './org.js';

export class UserError extends Error { constructor(msg, status = 400) { super(msg); this.status = status; } }
const fail = (msg, status) => { throw new UserError(msg, status); };

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
/** A date in any of the ways it is usually typed in India: 2026-03-31, 31/03/2026, 31-03-26, 31 Mar 2026. Returns YYYY-MM-DD or null. */
export function parseDate(v) {
  const s = String(v).trim();
  const ok = (y, m, d) => { const dt = new Date(Date.UTC(y, m - 1, d)); return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` : null; };
  const yr = (y) => (y < 100 ? 2000 + y : y);
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s); if (m) return ok(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2}|\d{4})$/.exec(s); if (m) return ok(yr(+m[3]), +m[2], +m[1]);
  m = /^(\d{1,2})[\s\-]([A-Za-z]{3})[A-Za-z]*[\s\-,]+(\d{2}|\d{4})$/.exec(s); if (m && MONTHS.includes(m[2].toLowerCase())) return ok(yr(+m[3]), MONTHS.indexOf(m[2].toLowerCase()) + 1, +m[1]);
  return null;
}

export const newId = () => globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 16);
export const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const UNIQUE = { items: 'code', styles: 'code', machines: 'code', shop_orders: 'orderNo', parcels: 'barcode', store_orders: 'tag', ledgers: 'name', suppliers: 'name', customers: 'name', courier_invoices: 'invoiceNo' };

/** The text a record is known by, for lists, pickers and imports. */
export function titleOf(entity, doc) {
  if (!doc) return '';
  const e = typeof entity === 'string' ? entityById[entity] : entity;
  return String(doc[e.title] ?? doc.no ?? doc.name ?? doc.id);
}

const modulesFor = (e) => [e.module, ...(e.alsoWrite || [])];
// `open` record types (the organisation itself) can be read by anyone who is signed in.
const canRead = (user, e) => (!!e.open && !!user) || modulesFor(e).some((m) => can(user, m, 'read'));
const canWrite = (user, e) => !e.readonly && (can(user, e.module, e.level || 'write') || (e.alsoWrite || []).some((m) => can(user, m, 'write')));

export function createService(db, { actions = {}, hash = null } = {}) {
  const publicUser = (u) => u && { id: u.id, name: u.name, email: u.email, role: u.role, extra: u.extra || [], active: u.active !== false, position: u.position || '', centre: u.centre || '', station: u.station || '', supplier: u.supplier || '', pending: u.pending || null };
  /** Emails to send once this request has been saved: [{ email, name, text, link, byName }]. The host sends them. */
  const outbox = [];
  const centres = () => db.all('work_centres');
  const isAdmin = (user) => can(user, 'admin', 'admin');

  // ── Rules on single records, on top of the role's level on the module ──
  // A project limited to its work centre is seen only by that work centre, its owner and admins.
  const projectOpen = (user, p) => !p || p.access !== 'centre' || can(user, 'projects', 'admin') || p.owner === user.id || p.createdBy === user.id || (!!p.centre && (user.centre === p.centre || headOf(centres(), p.centre) === user.id));
  const RULES = {
    projects: {
      read: (u, d) => projectOpen(u, d),
      write: (u, d) => can(u, 'projects', 'admin') || d.owner === u.id || d.createdBy === u.id || isHead(centres(), u, d.centre || '-'),
      why: 'Only the project owner, the head of its work centre or an admin can change a project.',
    },
    // Anyone can add a task and comment on one. Changing it is for the people on it.
    tasks: {
      read: (u, d) => projectOpen(u, db.get('projects', d.project)),
      write: (u, d) => can(u, 'projects', 'admin') || d.createdBy === u.id || isMine(d, u) || (!!d.centre && headOf(centres(), d.centre) === u.id) || db.get('projects', d.project)?.owner === u.id,
      why: 'Only the person on this task, whoever asked for it, the head of its work centre or the project owner can change it. Add a comment instead.',
    },
    comments: { read: (u, d) => { const t = db.get('tasks', d.task); return !t || RULES.tasks.read(u, t); } },
  };
  const visible = (user, e, doc) => !RULES[e.id]?.read || RULES[e.id].read(user, doc);
  /** May this person change this record? The head of a work centre also runs its own workstations. */
  const mayChange = (user, e, doc) => {
    if (e.headVia && isHead(centres(), user, doc[e.headVia] || '-')) return true;
    if (!canWrite(user, e)) return false;
    return !RULES[e.id]?.write || RULES[e.id].write(user, doc);
  };
  const mayAdd = (user, e) => canWrite(user, e) || (!!e.headVia && isHead(centres(), user));

  /** Tell someone, in the app and by email. Never the person who caused it. */
  function notify(actor, to, text, link = '', touched = null) {
    if (!to || to === actor?.id) return;
    const u = db.get('users', to); if (!u || u.active === false) return;
    if (outbox.some((m) => m.to === to && m.text === text)) return;
    db.put('notifications', { id: newId(), to, text, link, at: new Date().toISOString(), by: actor?.id || null, byName: actor?.name || '', read: false });
    outbox.push({ to, email: u.email, name: u.name, text, link, byName: actor?.name || '' });
    touched?.add('notifications');
  }
  /** Give a person the open, unnamed tasks of their position when nobody else holds it. */
  function handOver(u) {
    if (!u.position || db.all('users').some((x) => x.id !== u.id && x.active !== false && x.position === u.position)) return 0;
    let n = 0;
    for (const t of db.all('tasks')) if (!t.assignee && t.ownerRole === u.position && t.status !== 'done') { t.assignee = u.id; db.put('tasks', t); n++; }
    return n;
  }
  /** The starting structure: ledgers, work centres and their workstations. The first person is put in charge of Management. */
  function seedOrg(user, at) {
    const made = {};
    for (const [key, name, about, stations] of DEFAULT_CENTRES) {
      if (db.all('work_centres').some((c) => c.key === key || c.name.toLowerCase() === name.toLowerCase())) continue;
      const c = { id: newId(), key, name, about, createdAt: at, createdBy: user.id, updatedAt: at, updatedBy: user.id }; if (key === 'management') c.head = user.id;
      db.put('work_centres', c); made[key] = c.id;
      for (const [sn, stage, line] of stations) db.put('workstations', { id: newId(), name: sn, centre: c.id, ...(stage ? { stage } : {}), line: line || 'shared', people: 0, shiftMinutes: 480, efficiency: 0.7, createdAt: at, createdBy: user.id, updatedAt: at, updatedBy: user.id });
    }
    return made;
  }
  const centreByKey = (key) => db.all('work_centres').find((c) => c.key === key)?.id || '';
  const need = (ok, msg = 'You do not have access to this.') => { if (!ok) fail(msg, 403); };
  const ent = (id) => entityById[id] || fail(`Unknown record type: ${id}`, 404);

  const strip = (user, e, doc) => {
    if (can(user, e.module, 'admin')) return doc;
    const secret = fieldsOf(e).filter((f) => f.secret);
    if (!secret.length) return doc;
    const out = { ...doc }; for (const f of secret) delete out[f.k]; return out;
  };

  // ── Validation ──
  function coerce(f, v, label = f.label) {
    if (v === undefined || v === null || v === '') return undefined;
    switch (f.type) {
      case 'number': case 'money': { const n = typeof v === 'number' ? v : Number(String(v).replace(/[,₹\s]/g, '')); if (!Number.isFinite(n)) fail(`${label} must be a number.`); return n; }
      case 'bool': return v === true || /^(true|yes|y|1)$/i.test(String(v));
      case 'date': { const s = parseDate(v); if (!s) fail(`${label} must be a date like 2026-03-31 or 31/03/2026.`); return s; }
      case 'datetime': { const d = new Date(v); if (Number.isNaN(+d)) fail(`${label} must be a date and time.`); return d.toISOString(); }
      case 'select': { const o = f.options.find(([val, name]) => String(val).toLowerCase() === String(v).toLowerCase() || String(name).toLowerCase() === String(v).toLowerCase()); if (!o) fail(`${label} must be one of: ${f.options.map((x) => x[1]).join(', ')}.`); return o[0]; }
      case 'ref': return resolveRef(f.ref, v, label);
      case 'refs': { const arr = Array.isArray(v) ? v : String(v).split(/[;,]/).map((s) => s.trim()).filter(Boolean); return arr.map((x) => resolveRef(f.ref, x, label)); }
      case 'user': { const u = db.get('users', v) || db.all('users').find((x) => x.email === String(v).toLowerCase() || x.name.toLowerCase() === String(v).toLowerCase()); if (!u) fail(`${label}: no team member "${v}".`); return u.id; }
      case 'lines': {
        if (!Array.isArray(v)) fail(`${label} must be a list of lines.`);
        const cols = f.cols.map(([k, l, type, o = {}]) => ({ k, label: l, type, ...o }));
        return v.map((row) => { const out = {}; for (const c of cols) { const x = coerce(c, row[c.k], `${label}: ${c.label}`); if (x !== undefined) out[c.k] = x; } return out; }).filter((r) => Object.keys(r).length);
      }
      default: return String(v).trim();
    }
  }
  function resolveRef(refEntity, v, label) {
    const hit = db.get(refEntity, v) || db.all(refEntity).find((d) => titleOf(refEntity, d).toLowerCase() === String(v).trim().toLowerCase() || String(d.code || '').toLowerCase() === String(v).trim().toLowerCase() || String(d.no || '').toLowerCase() === String(v).trim().toLowerCase());
    if (!hit) fail(`${label}: nothing called "${v}" in ${entityById[refEntity].name}.`);
    return hit.id;
  }
  function validate(e, input, existing) {
    const doc = existing ? { ...existing } : {};
    for (const f of fieldsOf(e)) {
      if (f.ro) continue;
      if (!(f.k in input)) { if (!existing && f.def !== undefined) doc[f.k] = f.def === 'today' ? todayIso() : f.def; continue; }
      const v = coerce(f, input[f.k]);
      if (v === undefined) delete doc[f.k]; else doc[f.k] = v;
    }
    for (const f of fieldsOf(e)) if (f.req && !f.ro && (doc[f.k] === undefined || (Array.isArray(doc[f.k]) && !doc[f.k].length))) fail(`${f.label} is needed.`);
    const lines = fieldsOf(e).find((f) => f.type === 'lines' && !f.ro);
    if (lines && fieldsOf(e).some((f) => f.k === 'total')) {
      doc.total = (doc[lines.k] || []).reduce((s, r) => s + (r.billed ?? (r.qty || 0) * (r.rate ?? r.price ?? 0)), 0);
    }
    const uk = UNIQUE[e.id];
    if (uk && doc[uk] !== undefined && db.all(e.id).some((d) => d.id !== doc.id && String(d[uk]).toLowerCase() === String(doc[uk]).toLowerCase())) fail(`${fieldsOf(e).find((f) => f.k === uk).label} "${doc[uk]}" is already in use.`);
    return doc;
  }

  // ── Writes, shared by CRUD and actions ──
  function context(user, touched) {
    const now = new Date().toISOString();
    const put = (entityId, doc) => {
      const e = ent(entityId);
      const fresh = !doc.id;
      if (fresh) { doc.id = newId(); doc.createdAt = now; doc.createdBy = user.id; if (e.no && !doc.no) doc.no = `${e.no}-${String(db.next(e.id)).padStart(5, '0')}`; if (e.statuses && !doc.status) doc.status = e.initial || Object.keys(e.statuses)[0]; }
      doc.updatedAt = now; doc.updatedBy = user.id;
      db.put(entityId, doc); touched.add(entityId);
      return doc;
    };
    const log = (entityId, id, action, text) => db.log({ at: now, user: user.id, userName: user.name, entity: entityId, id, action, text });
    const ctx = {
      db, user, now, today: todayIso(), fail, put, log,
      get: (entityId, id) => db.get(entityId, id),
      all: (entityId) => db.all(entityId),
      title: (entityId, id) => titleOf(entityId, db.get(entityId, id)),
      setStatus(entityId, doc, status, text) { doc.status = status; put(entityId, doc); log(entityId, doc.id, status, text || `${ent(entityId).one} ${titleOf(entityId, doc)}: ${ent(entityId).statuses[status].name}`); return doc; },
      /** Write an accounting voucher. Amounts are in rupees. */
      voucher(v) { if (!(v.amount > 0)) return null; const doc = put('vouchers', { date: ctx.today, status: 'open', ...v, amount: Math.round(v.amount * 100) / 100 }); log('vouchers', doc.id, 'posted', `${v.type} ${doc.no}: ${v.narration || ''}`); return doc; },
      /** Change stock of a material and record why. */
      move(itemId, qty, reason, ref, note = '') { const item = db.get('items', itemId) || fail('Material not found.'); item.onHand = Math.round(((item.onHand || 0) + qty) * 1000) / 1000; put('items', item); return put('stock_moves', { date: ctx.today, item: itemId, qty, reason, ref, note }); },
      /** Open a supplier bill, due by the supplier's payment terms. */
      bill(supplierId, ref, amount) { if (!(amount > 0)) return null; const s = db.get('suppliers', supplierId); const due = new Date(); due.setDate(due.getDate() + (s?.terms ?? 30)); const local = `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, '0')}-${String(due.getDate()).padStart(2, '0')}`; return put('bills', { supplier: supplierId, ref, amount, paid: 0, date: ctx.today, due: local }); },
      ledgerOf: (kind, id) => { const d = db.get(kind, id); return d ? (d.ledger || d.name) : ''; },
      /** Tell a team member something, in the app and by email. `link` is a route such as 'task-<id>'. */
      notify: (to, text, link) => notify(user, to, text, link, touched),
      /** May the person doing this change that record? */
      may: (entityId, doc) => mayChange(user, ent(entityId), doc),
      why: (entityId) => RULES[entityId]?.why || 'Your role cannot change this.',
      handOver, seedOrg, centreByKey,
    };
    return ctx;
  }
  const run = (fn) => { const touched = new Set(); const out = db.tx(() => fn(touched)); return { ...out, touched: [...touched] }; };

  const svc = {
    // ── Session and people ──
    hasUsers: () => db.all('users').length > 0,
    findUserByEmail: (email) => db.all('users').find((u) => u.email === String(email || '').trim().toLowerCase()),
    getUser: (id) => db.get('users', id),
    publicUser,
    async setup({ name, email, password }) {
      if (svc.hasUsers()) fail('Deme is already set up. Sign in instead.', 409);
      // The first account belongs to whoever sets the system up, not to the founder: the founder
      // is added like everyone else and sees the result.
      checkPassword(password);
      const user = await makeUser({ name, email, password, role: 'admin' });
      db.tx(() => {
        for (const [n, group] of STARTER_LEDGERS) db.put('ledgers', { id: newId(), name: n, group, createdAt: user.createdAt, createdBy: user.id });
        const made = seedOrg(user, user.createdAt);
        Object.assign(user, { position: 'setup', centre: made.management || '' }); db.put('users', user);
        db.log({ at: user.createdAt, user: user.id, userName: user.name, entity: 'users', id: user.id, action: 'setup', text: 'Deme was set up' });
      });
      return publicUser(user);
    },
    /**
     * Someone has proved their email with an outside sign-in (Google). Returns their user record.
     * A person already on the team list signs in as themselves. `autoJoin` (their email is in the
     * company's own Workspace domain) admits a new person: as the system admin if nobody exists
     * yet, otherwise with self-service access until they pick a position and it is confirmed.
     */
    externalUser({ email, name }, { autoJoin = false } = {}) {
      email = String(email || '').trim().toLowerCase();
      const found = svc.findUserByEmail(email);
      if (found) { if (found.active === false) fail('This login has been switched off.', 403); return found; }
      if (!autoJoin) fail('Your Google account is not on the team list. Ask an admin to add you.', 403);
      const first = !svc.hasUsers(), at = new Date().toISOString();
      const user = { id: newId(), name: String(name || email).trim(), email, role: first ? 'admin' : 'staff', extra: [], active: true, pass: null, createdAt: at };
      db.tx(() => {
        if (first) { for (const [n, group] of STARTER_LEDGERS) db.put('ledgers', { id: newId(), name: n, group, createdAt: at, createdBy: user.id }); const made = seedOrg(user, at); Object.assign(user, { position: 'setup', centre: made.management || '' }); }
        db.put('users', user);
        db.log({ at, user: user.id, userName: user.name, entity: 'users', id: user.id, action: first ? 'setup' : 'joined', text: first ? 'Deme was set up' : `${user.name} joined by Google sign-in and has yet to pick a position` });
      });
      return user;
    },
    listUsers(user) {
      const full = isAdmin(user), cs = centres();
      // Everyone sees who is who and where. A request to join is shown to those who can answer it.
      return db.all('users').map((u) => (full ? publicUser(u) : { id: u.id, name: u.name, role: u.role, active: u.active !== false, position: u.position || '', centre: u.centre || '', station: u.station || '', pending: u.pending && (u.id === user.id || (positionById[u.pending.position]?.approve === 'head' && isHead(cs, user, u.pending.centre || '-'))) ? u.pending : null }));
    },
    async createUser(user, input) {
      need(can(user, 'admin', 'admin'));
      // Naming a position is enough: it brings the role and the work centre with it.
      const pos = positionById[input.position];
      const u = await makeUser({ ...input, role: input.role || pos?.role });
      if (pos) Object.assign(u, { position: pos.id, centre: input.centre || centreByKey(pos.centre) });
      else if (input.centre) u.centre = input.centre;
      // An outside login (a dye house) is tied to the supplier it belongs to.
      if (input.supplier) { if (!db.get('suppliers', input.supplier)) fail('Unknown supplier.'); u.supplier = input.supplier; }
      db.tx(() => { db.put('users', u); handOver(u); db.log({ at: u.createdAt, user: user.id, userName: user.name, entity: 'users', id: u.id, action: 'created', text: `Added ${u.name} as ${pos?.name || ROLES[u.role].name}` }); });
      return publicUser(u);
    },
    async updateUser(user, id, input) {
      const self = user.id === id;
      need(can(user, 'admin', 'admin') || (self && Object.keys(input).every((k) => k === 'password' || k === 'name')));
      const u = db.get('users', id) || fail('No such team member.', 404);
      if (input.name !== undefined) u.name = String(input.name).trim() || fail('Name is needed.');
      if (!self || can(user, 'admin', 'admin')) {
        if (input.role !== undefined) { if (!ROLES[input.role]) fail('Unknown role.'); if (self && input.role !== u.role) fail('You cannot change your own role.'); u.role = input.role; }
        if (input.position !== undefined) {
          const pos = positionById[input.position]; if (input.position && !pos) fail('Unknown position.');
          if (self && (input.position || '') !== (u.position || '')) fail('You cannot change your own position.');
          u.position = pos?.id || ''; delete u.pending;
          if (pos && input.role === undefined) u.role = pos.role;
          if (pos && input.centre === undefined && !u.centre) u.centre = centreByKey(pos.centre);
        }
        if (input.centre !== undefined) { if (input.centre && !db.get('work_centres', input.centre)) fail('Unknown work centre.'); u.centre = input.centre || ''; }
        if (input.station !== undefined) u.station = input.station || '';
        if (input.supplier !== undefined) { if (input.supplier && !db.get('suppliers', input.supplier)) fail('Unknown supplier.'); u.supplier = input.supplier || ''; }
        if (input.extra !== undefined) u.extra = (input.extra || []).filter((m) => MODULES[m]);
        if (input.active !== undefined) { if (self && !input.active) fail('You cannot switch off your own login.'); u.active = !!input.active; }
        if (input.email !== undefined) { const em = String(input.email).trim().toLowerCase(); if (db.all('users').some((x) => x.id !== id && x.email === em)) fail('That email is already in use.'); u.email = em; }
      }
      if (input.password) { checkPassword(input.password); u.pass = await hash(input.password); }
      db.tx(() => { db.put('users', u); if (input.position) handOver(u); db.log({ at: new Date().toISOString(), user: user.id, userName: user.name, entity: 'users', id, action: 'updated', text: `Updated ${u.name}` }); });
      return publicUser(u);
    },
    /**
     * A person says which position they hold. It takes effect when someone who can vouch for it
     * confirms: the head of the work centre for floor and desk positions, an admin for positions
     * that lead a work centre or carry wide access. Until then they keep what they had.
     */
    pickPosition(user, { position, station } = {}) {
      const pos = positionById[position] || fail('Choose a position.');
      const u = db.get('users', user.id) || fail('Sign in to continue.', 401);
      const centre = centreByKey(pos.centre);
      if (station && db.get('workstations', station)?.centre !== centre) fail('That workstation is in another work centre.');
      const at = new Date().toISOString();
      db.tx(() => {
        if (isAdmin(u)) { Object.assign(u, { position: pos.id, centre: centre || u.centre || '', station: station || '' }); delete u.pending; db.put('users', u); handOver(u); return; }
        u.pending = { position: pos.id, centre, station: station || '', at }; db.put('users', u);
        const head = pos.approve === 'head' ? headOf(centres(), centre) : null;
        const ask = head ? [head] : db.all('users').filter((x) => x.active !== false && isAdmin(x)).map((x) => x.id);
        for (const to of ask) notify(u, to, `${u.name} asks to join as ${pos.name}`, 'journey');
        db.log({ at, user: u.id, userName: u.name, entity: 'users', id: u.id, action: 'asked', text: `${u.name} asked to join as ${pos.name}` });
      });
      return publicUser(u);
    },
    /** Confirm or turn down a request to join. */
    decideJoin(user, id, ok) {
      const u = db.get('users', id) || fail('No such team member.', 404);
      const p = u.pending || fail('There is no request waiting for this person.');
      const pos = positionById[p.position] || fail('That position no longer exists.');
      need(isAdmin(user) || (pos.approve === 'head' && isHead(centres(), user, p.centre || '-')), 'Only an admin or the head of that work centre can confirm this.');
      const at = new Date().toISOString();
      db.tx(() => {
        delete u.pending;
        if (ok) { Object.assign(u, { position: pos.id, role: pos.role, centre: p.centre || '', station: p.station || '' }); db.put('users', u); const n = handOver(u); notify(user, u.id, `You are in as ${pos.name}${n ? `: ${n} task${n === 1 ? ' is' : 's are'} waiting for you` : ''}`, 'journey'); }
        else { db.put('users', u); notify(user, u.id, `Your request to join as ${pos.name} was not confirmed. Pick again or ask ${user.name}.`, 'journey'); }
        db.log({ at, user: user.id, userName: user.name, entity: 'users', id, action: ok ? 'confirmed' : 'declined', text: `${ok ? 'Confirmed' : 'Declined'} ${u.name} as ${pos.name}` });
      });
      return publicUser(u);
    },
    // ── Photos and documents on a record ──
    // The picture itself is kept apart from its description, so listing never loads the pictures.
    /** Attach a photo or a PDF to a record. `data` is base64. Whoever can open the record can add to it; so can the person who made it. */
    addFile(user, { entity: entityId, id, name, type, data } = {}) {
      const e = ent(entityId), doc = db.get(entityId, id) || fail('Not found.', 404);
      need((canRead(user, e) && visible(user, e, doc)) || doc.createdBy === user.id, `You cannot add to this ${e.one.toLowerCase()}.`);
      if (!/^(image\/(jpeg|png|webp)|application\/pdf)$/.test(String(type))) fail('Attach a photo or a PDF.');
      if (typeof data !== 'string' || !/^[A-Za-z0-9+/=]+$/.test(data)) fail('The file did not arrive whole. Try again.');
      if (data.length > 2.8e6) fail('That file is too large. Keep it under 2 MB.');
      if (db.all('file_index').filter((f) => f.entity === entityId && f.ref === id).length >= 12) fail('This record already has 12 files.');
      const at = new Date().toISOString(), meta = { id: newId(), entity: entityId, ref: id, name: String(name || 'photo').slice(0, 120), type, size: Math.round(data.length * 0.75), by: user.id, byName: user.name, at };
      db.tx(() => {
        db.put('file_index', meta); db.put('files', { id: meta.id, data });
        if (fieldsOf(e).some((f) => f.k === 'photos')) { doc.photos = (doc.photos || 0) + 1; db.put(entityId, doc); }
        db.log({ at, user: user.id, userName: user.name, entity: entityId, id, action: 'file', text: `Attached ${meta.name} to ${e.one.toLowerCase()} ${titleOf(e, doc)}` });
      });
      return meta;
    },
    listFiles(user, entityId, id) {
      const e = ent(entityId), doc = db.get(entityId, id) || fail('Not found.', 404);
      need((canRead(user, e) && visible(user, e, doc)) || doc.createdBy === user.id);
      return db.all('file_index').filter((f) => f.entity === entityId && f.ref === id).sort((a, b) => (a.at < b.at ? -1 : 1));
    },
    getFile(user, fileId) {
      const meta = db.get('file_index', fileId) || fail('Not found.', 404);
      const e = ent(meta.entity), doc = db.get(meta.entity, meta.ref);
      need(meta.by === user.id || (doc && canRead(user, e) && visible(user, e, doc)));
      return { ...meta, data: db.get('files', fileId)?.data || '' };
    },
    removeFile(user, fileId) {
      const meta = db.get('file_index', fileId) || fail('Not found.', 404);
      const e = ent(meta.entity);
      need(meta.by === user.id || can(user, e.module, 'admin'), 'Only whoever attached it, or a module admin, can remove a file.');
      db.tx(() => {
        db.del('file_index', fileId); db.del('files', fileId);
        const doc = db.get(meta.entity, meta.ref);
        if (doc && fieldsOf(e).some((f) => f.k === 'photos')) { doc.photos = Math.max(0, (doc.photos || 0) - 1); db.put(meta.entity, doc); }
      });
      return { ok: true };
    },
    /** A person's own notifications, newest first. */
    inbox: (user) => db.all('notifications').filter((n) => n.to === user.id).sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 60),
    readInbox(user, ids = null) {
      db.tx(() => { for (const n of db.all('notifications')) if (n.to === user.id && !n.read && (!ids || ids.includes(n.id))) { n.read = true; db.put('notifications', n); } });
      return svc.inbox(user);
    },

    // ── Records ──
    readable: (user) => ENTITIES.filter((e) => canRead(user, e)).map((e) => e.id),
    writable: (user) => ENTITIES.filter((e) => mayAdd(user, e)).map((e) => e.id),
    list(user, entityId) { const e = ent(entityId); need(canRead(user, e)); return db.all(entityId).filter((d) => visible(user, e, d)).map((d) => strip(user, e, d)); },
    get(user, entityId, id) { const e = ent(entityId); need(canRead(user, e)); const d = db.get(entityId, id) || fail('Not found.', 404); need(visible(user, e, d)); return strip(user, e, d); },
    create(user, entityId, input) {
      const e = ent(entityId); need(mayAdd(user, e), `You cannot add ${e.name.toLowerCase()}.`);
      return run((touched) => { const ctx = context(user, touched); const doc = validate(e, input || {}, null); if (!canWrite(user, e)) need(mayChange(user, e, doc), `You can add ${e.name.toLowerCase()} only to a work centre you are in charge of.`); for (const k of ['requestedBy', 'checker']) if (fieldsOf(e).some((f) => f.k === k)) doc[k] = user.id; ctx.put(entityId, doc); ctx.log(entityId, doc.id, 'created', `Added ${e.one.toLowerCase()} ${titleOf(e, doc)}`); actions[`hook.created.${entityId}`]?.run(ctx, {}, doc); return { doc: strip(user, e, db.get(entityId, doc.id)) }; });
    },
    update(user, entityId, id, input) {
      const e = ent(entityId); need(mayAdd(user, e), `You cannot change ${e.name.toLowerCase()}.`);
      return run((touched) => {
        const ctx = context(user, touched); const old = db.get(entityId, id) || fail('Not found.', 404);
        need(mayChange(user, e, old), RULES[e.id]?.why || `You cannot change this ${e.one.toLowerCase()}.`);
        const editable = !e.statuses || (e.editWhen || [e.initial || Object.keys(e.statuses)[0]]).includes(old.status) || can(user, e.module, 'admin');
        if (!editable) fail(`This ${e.one.toLowerCase()} is ${e.statuses[old.status].name.toLowerCase()} and can no longer be edited.`);
        const secretKeys = can(user, e.module, 'admin') ? [] : fieldsOf(e).filter((f) => f.secret).map((f) => f.k);
        const clean = { ...input }; for (const k of secretKeys) delete clean[k];
        const doc = validate(e, clean, old); if (!canWrite(user, e)) need(mayChange(user, e, doc), 'You can move it only to a work centre you are in charge of.'); ctx.put(entityId, doc); ctx.log(entityId, id, 'updated', `Changed ${e.one.toLowerCase()} ${titleOf(e, doc)}`); actions[`hook.updated.${entityId}`]?.run(ctx, old, doc);
        return { doc: strip(user, e, doc) };
      });
    },
    remove(user, entityId, id) {
      const e = ent(entityId); need(!e.readonly && can(user, e.module, 'admin'), 'Only a module admin can delete records.');
      return run((touched) => {
        const doc = db.get(entityId, id) || fail('Not found.', 404);
        for (const other of ENTITIES) for (const f of fieldsOf(other)) {
          const hits = (d) => (f.type === 'ref' && f.ref === entityId && d[f.k] === id) || (f.type === 'refs' && f.ref === entityId && (d[f.k] || []).includes(id)) || (f.type === 'lines' && (d[f.k] || []).some((r) => f.cols.some(([ck, , ct, co]) => ct === 'ref' && co?.ref === entityId && r[ck] === id)));
          const used = db.all(other.id).find(hits);
          if (used) fail(`${titleOf(e, doc)} is used by ${other.one.toLowerCase()} ${titleOf(other, used)} and cannot be deleted.`);
        }
        db.del(entityId, id); touched.add(entityId);
        db.log({ at: new Date().toISOString(), user: user.id, userName: user.name, entity: entityId, id, action: 'deleted', text: `Deleted ${e.one.toLowerCase()} ${titleOf(e, doc)}` });
        return {};
      });
    },
    /** Bulk add from a spreadsheet. Column headings may be field labels or keys. Good rows go in; bad rows are reported. */
    importRows(user, entityId, rows) {
      const e = ent(entityId); need(canWrite(user, e), `You cannot add ${e.name.toLowerCase()}.`);
      if (!Array.isArray(rows) || !rows.length) fail('The file has no rows.');
      if (rows.length > 5000) fail('Import up to 5,000 rows at a time.');
      const fs = fieldsOf(e).filter((f) => !f.ro && f.type !== 'lines');
      const key = (h) => { const n = String(h).trim().toLowerCase(); const f = fs.find((x) => x.k.toLowerCase() === n || x.label.toLowerCase() === n); return f?.k; };
      const errors = []; let created = 0;
      const out = run((touched) => {
        const ctx = context(user, touched);
        rows.forEach((row, i) => {
          try { const input = {}; for (const [h, v] of Object.entries(row)) { const k = key(h); if (k) input[k] = v; } const doc = validate(e, input, null); ctx.put(entityId, doc); created++; }
          catch (err) { if (!(err instanceof UserError)) throw err; errors.push({ row: i + 2, error: err.message }); }
        });
        if (created) ctx.log(entityId, null, 'imported', `Imported ${created} ${e.name.toLowerCase()}`);
        return {};
      });
      return { created, errors, touched: out.touched };
    },

    // ── Actions ──
    /** Run a business action. For record actions pass the entity and id; scan and self-service actions have neither. */
    act(user, actionId, { entity: entityId, id, payload = {} } = {}) {
      const def = actions[actionId] || fail(`Unknown action: ${actionId}`, 404);
      let e = null, btn = null, doc = null;
      if (entityId) {
        e = ent(entityId); btn = (e.actions || []).find((a) => a.id === actionId) || fail('That action does not apply here.', 404);
        need(can(user, btn.module || e.module, btn.level || 'write') || (!btn.module && (e.alsoWrite || []).some((m) => can(user, m, btn.level || 'write'))), 'Your role cannot do this.');
      } else {
        need(def.level === 'self' || [].concat(def.module).some((m) => can(user, m, def.level || 'write')), 'Your role cannot do this.');
      }
      return run((touched) => {
        const ctx = context(user, touched);
        if (e) {
          doc = db.get(entityId, id) || fail('Not found.', 404);
          if (RULES[e.id]?.write && !RULES[e.id].write(user, doc)) fail(RULES[e.id].why, 403);
          if (btn.when && !btn.when.includes(doc.status)) fail(`This ${e.one.toLowerCase()} is ${e.statuses[doc.status]?.name.toLowerCase() || doc.status}; that step is not available.`);
          if (btn.form) { const coerced = {}; for (const [k, label, type, o = {}] of btn.form) { const v = coerce({ k, label, type, ...o }, payload[k]); if (v === undefined && o.req) fail(`${label} is needed.`); if (v !== undefined) coerced[k] = v; } payload = { ...payload, ...coerced }; }
        }
        const result = def.run(ctx, payload, doc) || {};
        return { message: result.message || null, doc: e ? strip(user, e, db.get(entityId, id)) : result.doc || null, data: result.data || null };
      });
    },
    audit(user, { entity: entityId, id, limit = 200 } = {}) {
      if (entityId) need(canRead(user, ent(entityId))); else need(can(user, 'admin', 'read'));
      return db.logs({ entity: entityId, id, limit });
    },
    /** What a person sees about themselves, whatever their role. */
    mine(user) { return { ...svc.mineHr(user), inbox: svc.inbox(user) }; },
    mineHr(user) {
      const emp = db.all('employees').find((x) => x.login === user.id) || null;
      if (!emp) return { employee: null, today: null, leaves: [], kras: [], month: [] };
      const { salary, ...employee } = emp; const t = todayIso();
      const att = db.all('attendance').filter((a) => a.employee === emp.id);
      return { employee, today: att.find((a) => a.date === t) || null, month: att.filter((a) => a.date.slice(0, 7) === t.slice(0, 7)), leaves: db.all('leaves').filter((l) => l.employee === emp.id), kras: db.all('kras').filter((k) => k.employee === emp.id) };
    },
    levelOf, can, outbox,
  };

  function checkPassword(p) { if (typeof p !== 'string' || p.length < 8) fail('Use a password of at least 8 characters.'); }
  async function makeUser({ name, email, password, role, extra }) {
    if (!hash) fail('Password hashing is not available.', 500);
    name = String(name || '').trim(); email = String(email || '').trim().toLowerCase();
    if (!name) fail('Name is needed.');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail('Enter a valid email address.');
    if (!ROLES[role]) fail('Choose a role.');
    if (svc.findUserByEmail(email)) fail('That email is already in use.');
    // No password means the person signs in with Google only.
    if (password) checkPassword(password);
    return { id: newId(), name, email, role, extra: (extra || []).filter((m) => MODULES[m]), active: true, pass: password ? await hash(password) : null, createdAt: new Date().toISOString() };
  }
  return svc;
}

/** An in-memory db with the interface above, with optional load/save hooks. Used by tests and the browser preview. */
export function memoryDb(initial = null, onChange = null) {
  let s = initial || { cols: {}, counters: {}, logs: [] };
  let depth = 0;
  const save = () => { if (depth === 0 && onChange) onChange(s); };
  return {
    all: (col) => Object.values(s.cols[col] || {}).map((d) => structuredClone(d)),
    get: (col, id) => { const d = id && s.cols[col]?.[id]; return d ? structuredClone(d) : null; },
    put(col, doc) { (s.cols[col] ||= {})[doc.id] = structuredClone(doc); save(); },
    del(col, id) { delete s.cols[col]?.[id]; save(); },
    next(counter) { s.counters[counter] = (s.counters[counter] || 0) + 1; save(); return s.counters[counter]; },
    log(entry) { s.logs.push(entry); if (s.logs.length > 3000) s.logs.splice(0, s.logs.length - 3000); save(); },
    logs: ({ entity, id, limit = 200 } = {}) => s.logs.filter((l) => (!entity || l.entity === entity) && (!id || l.id === id)).slice(-limit).reverse(),
    tx(fn) { const snap = structuredClone(s); depth++; try { const out = fn(); depth--; save(); return out; } catch (e) { s = snap; depth--; throw e; } },
    dump: () => s,
  };
}
