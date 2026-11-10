// Deme ERP server: serves the web app and the JSON API from one process.
// No dependencies beyond Node 22. Configure with environment variables (see .env.example).

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { dirname, join, normalize, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { createService, UserError } from '../shared/service.js';
import { ACTIONS } from '../shared/actions.js';
import { vouchersToTallyXML } from '../shared/tally.js';
import { COMPANY, ROLES } from '../shared/schema.js';
import { newId } from '../shared/service.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scryptAsync = promisify(scrypt);
const SESSION_DAYS = 14;
const COOKIE = 'deme_sid';

// Passwords: scrypt with a per-user salt. Stored as salt:hash, both hex.
export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, 64);
  return `${salt.toString('hex')}:${key.toString('hex')}`;
}
export async function verifyPassword(password, stored) {
  const [salt, key] = String(stored || '').split(':');
  if (!salt || !key) return false;
  const got = await scryptAsync(password, Buffer.from(salt, 'hex'), 64);
  const want = Buffer.from(key, 'hex');
  return got.length === want.length && timingSafeEqual(got, want);
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

export function createApp({ dbFile = process.env.DEME_DB || join(root, 'data', 'deme.db') } = {}) {
  const db = openDb(dbFile);
  const svc = createService(db, { actions: ACTIONS, hash: hashPassword });
  const attempts = new Map(); // sign-in throttle: key -> { n, until }

  const send = (res, status, body, headers = {}) => {
    const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers });
    res.end(data);
  };
  const readJson = (req) => new Promise((ok, bad) => {
    if (!/^application\/json/.test(req.headers['content-type'] || '')) return bad(new UserError('Send JSON.', 415));
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > 6e6) { bad(new UserError('That is too large. Import in smaller files.', 413)); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { ok(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch { bad(new UserError('The request was not valid JSON.')); } });
    req.on('error', bad);
  });
  const cookieOf = (req) => Object.fromEntries((req.headers.cookie || '').split(';').map((p) => p.trim().split('=')).filter((p) => p[0]))[COOKIE];
  const secure = (req) => req.headers['x-forwarded-proto'] === 'https' || process.env.DEME_SECURE_COOKIES === '1';
  const setCookie = (req, token, maxAge) => `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure(req) ? '; Secure' : ''}`;
  // Service keys let other programs (a scanner app, a camera's edge box, the Tally bridge) call the
  // same API as a person, with the access of one role. Only a hash of the key is stored.
  const keyHash = (key) => createHash('sha256').update(key).digest('hex');
  function keyUser(req) {
    const m = /^Bearer\s+(deme_[a-f0-9]{48})$/.exec(req.headers.authorization || '');
    if (!m) return null;
    const k = db.all('api_keys').find((x) => x.hash === keyHash(m[1]) && x.active);
    if (!k) return null;
    const today = new Date().toISOString().slice(0, 10);
    if (k.lastUsed !== today) { k.lastUsed = today; db.put('api_keys', k); }
    return { id: `key:${k.id}`, name: k.name, role: k.role, extra: [], active: true, service: true };
  }
  const publicKey = (k) => ({ id: k.id, name: k.name, role: k.role, hint: k.hint, active: k.active, createdAt: k.createdAt, lastUsed: k.lastUsed || null });
  function sessionUser(req) {
    const viaKey = keyUser(req); if (viaKey) return viaKey;
    const token = cookieOf(req); if (!token) return null;
    const s = db.sessions.get(token);
    if (!s || s.expires < Date.now()) return null;
    const u = svc.getUser(s.user);
    return u && u.active !== false ? u : null;
  }
  const startSession = (req, res, user) => {
    const token = randomBytes(32).toString('hex');
    db.sessions.create(token, user.id, Date.now() + SESSION_DAYS * 864e5);
    res.setHeader('Set-Cookie', setCookie(req, token, SESSION_DAYS * 86400));
  };

  async function api(req, res, url) {
    const parts = url.pathname.split('/').filter(Boolean).slice(1); // after /api
    const m = req.method;
    // Changes must come from this site: a cross-site page cannot send JSON with our cookie.
    if (m !== 'GET') {
      const origin = req.headers.origin;
      if (origin && new URL(origin).host !== req.headers.host && !/^Bearer\s/.test(req.headers.authorization || '')) throw new UserError('Cross-site request refused.', 403);
    }
    const body = m === 'GET' || m === 'DELETE' ? {} : await readJson(req);

    if (parts[0] === 'health') return send(res, 200, { ok: true, company: COMPANY });
    if (parts[0] === 'state') { const u = sessionUser(req); return send(res, 200, { setupNeeded: !svc.hasUsers(), user: svc.publicUser(u) }); }
    if (parts[0] === 'setup' && m === 'POST') { const user = await svc.setup(body); startSession(req, res, user); return send(res, 200, { user }); }
    if (parts[0] === 'login' && m === 'POST') {
      const key = `${req.socket.remoteAddress}|${String(body.email || '').toLowerCase()}`;
      const a = attempts.get(key);
      if (a && a.n >= 6 && a.until > Date.now()) throw new UserError('Too many attempts. Try again in a few minutes.', 429);
      const u = svc.findUserByEmail(body.email);
      const ok = u && u.active !== false && await verifyPassword(String(body.password || ''), u.pass);
      if (!ok) { attempts.set(key, { n: (a && a.until > Date.now() ? a.n : 0) + 1, until: Date.now() + 10 * 60e3 }); throw new UserError('Email or password is not right.', 401); }
      attempts.delete(key); startSession(req, res, u);
      return send(res, 200, { user: svc.publicUser(u) });
    }
    if (parts[0] === 'logout' && m === 'POST') { const t = cookieOf(req); if (t) db.sessions.drop(t); res.setHeader('Set-Cookie', setCookie(req, '', 0)); return send(res, 200, { ok: true }); }

    const user = sessionUser(req);
    if (!user) throw new UserError('Sign in to continue.', 401);

    if (parts[0] === 'boot') return send(res, 200, { user: svc.publicUser(user), readable: svc.readable(user), writable: svc.writable(user), users: svc.listUsers(user), mine: svc.mine(user) });
    if (parts[0] === 'users') {
      if (m === 'GET') return send(res, 200, svc.listUsers(user));
      if (m === 'POST') return send(res, 200, await svc.createUser(user, body));
      if (m === 'PUT' && parts[1]) { const out = await svc.updateUser(user, parts[1], body); if (body.active === false || body.password) db.sessions.dropUser(parts[1]); if (body.password && parts[1] === user.id) startSession(req, res, user); return send(res, 200, out); }
    }
    if (parts[0] === 'data' && parts[1]) {
      if (m === 'GET' && !parts[2]) return send(res, 200, svc.list(user, parts[1]));
      if (m === 'GET') return send(res, 200, svc.get(user, parts[1], parts[2]));
      if (m === 'POST') return send(res, 200, svc.create(user, parts[1], body));
      if (m === 'PUT' && parts[2]) return send(res, 200, svc.update(user, parts[1], parts[2], body));
      if (m === 'DELETE' && parts[2]) return send(res, 200, svc.remove(user, parts[1], parts[2]));
    }
    if (parts[0] === 'import' && parts[1] && m === 'POST') return send(res, 200, svc.importRows(user, parts[1], body.rows));
    if (parts[0] === 'action' && parts[1] && m === 'POST') return send(res, 200, svc.act(user, parts[1], body));
    if (parts[0] === 'audit' && m === 'GET') return send(res, 200, svc.audit(user, { entity: url.searchParams.get('entity') || undefined, id: url.searchParams.get('id') || undefined }));
    if (parts[0] === 'mine' && m === 'GET') return send(res, 200, svc.mine(user));
    // Everything that happened after a given point, oldest first: other services follow this feed.
    if (parts[0] === 'events' && m === 'GET') {
      if (!svc.can(user, 'admin', 'read')) throw new UserError('Your role cannot read the event feed.', 403);
      return send(res, 200, db.logsAfter(Number(url.searchParams.get('after') || 0), Math.min(500, Number(url.searchParams.get('limit') || 200))));
    }
    if (parts[0] === 'keys') {
      if (!svc.can(user, 'admin', 'admin') || user.service) throw new UserError('Only an admin signed in as a person can manage service keys.', 403);
      if (m === 'GET') return send(res, 200, db.all('api_keys').map(publicKey));
      if (m === 'POST') {
        const name = String(body.name || '').trim();
        if (!name) throw new UserError('Give the key a name that says what uses it.');
        if (!ROLES[body.role]) throw new UserError('Choose the role this key acts as.');
        const key = `deme_${randomBytes(24).toString('hex')}`;
        const doc = { id: newId(), name, role: body.role, hash: keyHash(key), hint: `${key.slice(0, 9)}…${key.slice(-4)}`, active: true, createdAt: new Date().toISOString(), createdBy: user.id };
        db.tx(() => { db.put('api_keys', doc); db.log({ at: doc.createdAt, user: user.id, userName: user.name, entity: 'api_keys', id: doc.id, action: 'created', text: `Service key created: ${name} (${ROLES[body.role].name})` }); });
        return send(res, 200, { ...publicKey(doc), key });
      }
      if (m === 'PUT' && parts[1]) {
        const doc = db.get('api_keys', parts[1]); if (!doc) throw new UserError('No such key.', 404);
        doc.active = !!body.active;
        db.tx(() => { db.put('api_keys', doc); db.log({ at: new Date().toISOString(), user: user.id, userName: user.name, entity: 'api_keys', id: doc.id, action: 'updated', text: `Service key ${doc.active ? 'switched on' : 'switched off'}: ${doc.name}` }); });
        return send(res, 200, publicKey(doc));
      }
    }
    if (parts[0] === 'export' && parts[1] === 'tally' && m === 'GET') {
      const ids = (url.searchParams.get('ids') || '').split(',').filter(Boolean);
      const vs = svc.list(user, 'vouchers').filter((v) => (ids.length ? ids.includes(v.id) : v.status === 'open'));
      return send(res, 200, vouchersToTallyXML(vs.map((v) => ({ ...v, id: v.no })), url.searchParams.get('company') || COMPANY), { 'Content-Type': 'application/xml; charset=utf-8', 'Content-Disposition': 'attachment; filename="deme-vouchers.xml"' });
    }
    throw new UserError('Not found.', 404);
  }

  async function staticFile(req, res, url) {
    let p = decodeURIComponent(url.pathname);
    // Only two folders are ever served: web/ and shared/. Anything that resolves outside them is refused.
    const shared = p.startsWith('/shared/');
    const base = join(root, shared ? 'shared' : 'web');
    if (shared) p = p.slice('/shared'.length);
    if (p === '/') p = '/index.html';
    const file = normalize(join(base, p));
    if (!file.startsWith(base + sep)) return send(res, 403, { error: 'Forbidden' });
    try {
      const s = await stat(file);
      if (!s.isFile()) throw new Error('not a file');
      const data = await readFile(file);
      res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'Cache-Control': file.includes(`${sep}vendor${sep}`) ? 'public, max-age=604800' : 'no-cache', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin' });
      res.end(data);
    } catch { send(res, 404, { error: 'Not found' }); }
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    try {
      if (url.pathname.startsWith('/api/')) await api(req, res, url);
      else if (req.method === 'GET' || req.method === 'HEAD') await staticFile(req, res, url);
      else send(res, 405, { error: 'Method not allowed' });
    } catch (e) {
      if (e instanceof UserError) return send(res, e.status, { error: e.message });
      console.error(e);
      send(res, 500, { error: 'Something went wrong on the server. It has been logged.' });
    }
  });
  const sweep = setInterval(() => db.sessions.sweep(), 3600e3); sweep.unref();
  return { server, db, svc, close: () => { clearInterval(sweep); server.close(); db.close(); } };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 8800);
  const app = createApp();
  app.server.listen(port, () => console.log(`Deme ERP is running on http://localhost:${port}`));
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { app.close(); process.exit(0); });
}
