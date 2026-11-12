// Deme Intelligence as one Node process: serves the web app and the API, with data in a SQLite
// file. No dependencies beyond Node 22. Configure with environment variables (see .env.example).
// The same API also runs on Netlify over Postgres: see netlify/functions/api.mjs.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { dirname, join, normalize, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { createApi, hashPassword, verifyPassword } from './app.js';

export { hashPassword, verifyPassword };

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

export function createApp({ dbFile = process.env.DEME_DB || join(root, 'data', 'deme.db'), env = process.env, fetchImpl, anthropic } = {}) {
  const db = openDb(dbFile);
  // SQLite is synchronous and local, so the store simply hands the database to the request.
  const api = createApi({ store: { run: async (fn) => fn(db) }, env, fetchImpl, anthropic });

  const readBody = (req) => new Promise((ok, bad) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > 6e6) { ok({ tooLarge: true }); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { if (!chunks.length) return ok({ json: {}, raw: '' }); const raw = Buffer.concat(chunks).toString('utf8'); try { ok({ json: JSON.parse(raw), raw }); } catch { ok({ bad: true }); } });
    req.on('error', bad);
  });
  // Scripts only from this site and no inline script, so text that reaches a page can never run as code.
  const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'";
  const plain = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(body)); };

  async function apiRequest(req, res, url) {
    let body = {}, raw = '';
    if (req.method !== 'GET' && req.method !== 'DELETE') {
      const b = await readBody(req);
      if (b.tooLarge) return plain(res, 413, { error: 'That is too large. Import in smaller files.' });
      if (b.bad) return plain(res, 400, { error: 'The request was not valid JSON.' });
      body = b.json; raw = b.raw;
    }
    const out = await api.handle({ method: req.method, path: url.pathname, query: url.searchParams, headers: req.headers, body, raw, ip: req.socket.remoteAddress });
    const headers = { ...out.headers };
    if (out.cookies.length) headers['set-cookie'] = out.cookies;
    res.writeHead(out.status, headers);
    res.end(out.body);
  }

  async function staticFile(req, res, url) {
    let p = decodeURIComponent(url.pathname);
    // Only two folders are ever served: web/ and shared/. Anything that resolves outside them is refused.
    const shared = p.startsWith('/shared/');
    const base = join(root, shared ? 'shared' : 'web');
    if (shared) p = p.slice('/shared'.length);
    if (p === '/') p = '/index.html';
    const file = normalize(join(base, p));
    if (!file.startsWith(base + sep)) return plain(res, 403, { error: 'Forbidden' });
    try {
      const s = await stat(file);
      if (!s.isFile()) throw new Error('not a file');
      const data = await readFile(file);
      res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'Cache-Control': file.includes(`${sep}vendor${sep}`) ? 'public, max-age=604800' : 'no-cache', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Content-Security-Policy': CSP, 'Permissions-Policy': 'camera=(self), microphone=(), geolocation=(), payment=()', 'Referrer-Policy': 'same-origin' });
      res.end(data);
    } catch { plain(res, 404, { error: 'Not found' }); }
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    try {
      if (url.pathname.startsWith('/api/')) await apiRequest(req, res, url);
      else if (req.method === 'GET' || req.method === 'HEAD') await staticFile(req, res, url);
      else plain(res, 405, { error: 'Method not allowed' });
    } catch (e) { console.error(e); if (!res.headersSent) plain(res, 500, { error: 'Something went wrong on the server. It has been logged.' }); else res.end(); }
  });
  return { server, db, close: () => { server.close(); db.close(); } };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 8800);
  const app = createApp();
  app.server.listen(port, () => console.log(`Deme Intelligence is running on http://localhost:${port}`));
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { app.close(); process.exit(0); });
}
