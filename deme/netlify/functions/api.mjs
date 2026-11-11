// Deme Intelligence on Netlify: every /api/* request comes here. The same API code as the Node
// server, with data in Postgres. Needs DATABASE_URL (or NETLIFY_DB_URL) in the site's environment.

import pg from 'pg';
import { createApi } from '../../server/app.js';
import { createPgStore, pgSql } from '../../server/pgstore.js';

let api = null;
function getApi() {
  if (api) return api;
  const url = process.env.DATABASE_URL || process.env.NETLIFY_DB_URL || process.env.NETLIFY_DATABASE_URL;
  if (!url) throw new Error('No database. Set DATABASE_URL to a Postgres connection string in the site settings.');
  // One connection per warm function instance; use the provider's pooled connection string.
  const pool = new pg.Pool({ connectionString: url, max: 1, ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: true } });
  api = createApi({ store: createPgStore(pgSql(pool)) });
  return api;
}

export default async (request, context) => {
  const url = new URL(request.url);
  const headers = Object.fromEntries([...request.headers].map(([k, v]) => [k.toLowerCase(), v]));
  let body = {};
  if (request.method !== 'GET' && request.method !== 'DELETE') {
    const text = await request.text();
    if (text.length > 6e6) return Response.json({ error: 'That is too large. Import in smaller files.' }, { status: 413 });
    try { body = text ? JSON.parse(text) : {}; } catch { return Response.json({ error: 'The request was not valid JSON.' }, { status: 400 }); }
  }
  let out;
  try { out = await getApi().handle({ method: request.method, path: url.pathname, query: url.searchParams, headers, body, ip: context?.ip || headers['x-nf-client-connection-ip'] || '' }); }
  catch (e) { console.error(e); return Response.json({ error: String(e.message || e) }, { status: 500 }); }
  const h = new Headers(out.headers);
  for (const c of out.cookies) h.append('set-cookie', c);
  return new Response(out.status === 302 ? null : out.body, { status: out.status, headers: h });
};

export const config = { path: '/api/*' };
