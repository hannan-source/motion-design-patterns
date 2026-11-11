// Postgres storage for serverless hosting (Netlify Functions), behind the same `store.run(fn)`
// the SQLite server uses.
//
// The service code is synchronous, but Postgres is reached over the network. So each request
// works on a snapshot: `fn` runs against data held in memory; when it asks for something that has
// not been fetched yet, it is stopped, that data is fetched, and `fn` is run again. When `fn`
// finishes, everything it wrote is saved in one transaction. Each collection carries a version
// number; if another request changed a collection this one read, the save is refused and the
// whole request is run again on fresh data, so two people can never silently overwrite each other.
//
// `sql` is any Postgres client wrapped as { query(text, params) -> rows, tx(async (q) => ...) }.

class Need extends Error { constructor(what) { super('need data'); this.what = what; } }
class Conflict extends Error {}
const BATCH = 500;   // records per write statement

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS docs (col text NOT NULL, id text NOT NULL, data jsonb NOT NULL, PRIMARY KEY (col, id));
  CREATE TABLE IF NOT EXISTS col_versions (col text PRIMARY KEY, v bigint NOT NULL DEFAULT 0);
  CREATE TABLE IF NOT EXISTS counters (name text PRIMARY KEY, n bigint NOT NULL);
  CREATE TABLE IF NOT EXISTS logs (seq bigserial PRIMARY KEY, at text, usr text, user_name text, entity text, id text, action text, text text);
  CREATE INDEX IF NOT EXISTS logs_entity ON logs (entity, id);
`;
const logRow = (r) => ({ seq: Number(r.seq), at: r.at, user: r.usr, userName: r.user_name, entity: r.entity, id: r.id, action: r.action, text: r.text });

export function createPgStore(sql) {
  let ready = null;
  const init = () => (ready ||= (async () => { for (const stmt of SCHEMA.split(';').map((s) => s.trim()).filter(Boolean)) await sql.query(stmt); })());

  /** `preload`: collections the request is known to need, fetched together up front to save round trips. */
  async function run(fn, { preload = [] } = {}) {
    await init();
    for (let attempt = 0; attempt < 6; attempt++) {
      const cols = new Map(), docs = new Map(), counters = new Map(), logCache = new Map(), versions = new Map();
      const load = async (what) => {
        const ver = async (col) => { if (!versions.has(col)) { const r = await sql.query('SELECT v FROM col_versions WHERE col = $1', [col]); versions.set(col, r[0] ? Number(r[0].v) : 0); } };
        if (what.col) { await ver(what.col); const rows = await sql.query('SELECT id, data FROM docs WHERE col = $1', [what.col]); cols.set(what.col, new Map(rows.map((r) => [r.id, r.data]))); }
        if (what.doc) { const [col, id] = what.doc; await ver(col); const rows = await sql.query('SELECT data FROM docs WHERE col = $1 AND id = $2', [col, id]); docs.set(`${col}/${id}`, rows[0] ? rows[0].data : null); }
        if (what.counter) { await ver(`#counter:${what.counter}`); const rows = await sql.query('SELECT n FROM counters WHERE name = $1', [what.counter]); counters.set(what.counter, rows[0] ? Number(rows[0].n) : 0); }
        if (what.logs) {
          const f = what.logs;
          if (f.after !== undefined) logCache.set(f.key, (await sql.query('SELECT * FROM logs WHERE seq > $1 ORDER BY seq ASC LIMIT $2', [f.after, f.limit])).map(logRow));
          else {
            const where = [], args = [];
            if (f.entity) { args.push(f.entity); where.push(`entity = $${args.length}`); }
            if (f.id) { args.push(f.id); where.push(`id = $${args.length}`); }
            args.push(Math.min(1000, f.limit || 200));
            logCache.set(f.key, (await sql.query(`SELECT * FROM logs ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY seq DESC LIMIT $${args.length}`, args)).map(logRow));
          }
        }
      };

      if (preload.length) {
        const vs = await sql.query('SELECT col, v FROM col_versions WHERE col = ANY($1)', [preload]);
        for (const col of preload) { versions.set(col, 0); cols.set(col, new Map()); }
        for (const r of vs) versions.set(r.col, Number(r.v));
        for (const r of await sql.query('SELECT col, id, data FROM docs WHERE col = ANY($1)', [preload])) cols.get(r.col).set(r.id, r.data);
      }
      for (let pass = 0; pass < 40; pass++) {
        const puts = new Map(), dels = new Set(), newCounters = new Map(), newLogs = [], wrote = new Set();
        const clone = (d) => (d == null ? null : structuredClone(d));
        // Writes are applied on top of what was fetched, so `fn` reads its own changes back.
        const seen = (col, id) => { const k = `${col}/${id}`; if (dels.has(k)) return null; if (puts.has(k)) return puts.get(k).doc; return undefined; };
        const db = {
          all(col) {
            if (!cols.has(col)) throw new Need({ col });
            const out = new Map(cols.get(col));
            for (const [k, p] of puts) if (p.col === col) out.set(p.doc.id, p.doc);
            for (const k of dels) { const [c, id] = k.split('/'); if (c === col) out.delete(id); }
            return [...out.values()].map(clone);
          },
          get(col, id) {
            if (!id) return null;
            const mine = seen(col, id); if (mine !== undefined) return clone(mine);
            if (cols.has(col)) return clone(cols.get(col).get(String(id)) ?? null);
            const k = `${col}/${id}`; if (!docs.has(k)) throw new Need({ doc: [col, String(id)] });
            return clone(docs.get(k));
          },
          put(col, doc) { const k = `${col}/${doc.id}`; dels.delete(k); puts.set(k, { col, doc: clone(doc) }); wrote.add(col); },
          del(col, id) { const k = `${col}/${id}`; puts.delete(k); dels.add(k); wrote.add(col); },
          next(name) { if (!counters.has(name)) throw new Need({ counter: name }); const n = (newCounters.get(name) ?? counters.get(name)) + 1; newCounters.set(name, n); wrote.add(`#counter:${name}`); return n; },
          log(e) { newLogs.push(e); },
          logs(f = {}) { const key = `q:${f.entity || ''}:${f.id || ''}:${f.limit || 200}`; if (!logCache.has(key)) throw new Need({ logs: { ...f, key } }); return logCache.get(key); },
          logsAfter(after, limit = 200) { const key = `a:${after}:${limit}`; if (!logCache.has(key)) throw new Need({ logs: { after, limit, key } }); return logCache.get(key); },
          tx(f) { return f(); },
        };
        let result;
        try { result = await fn(db); } catch (e) { if (e instanceof Need) { await load(e.what); continue; } throw e; }
        if (!puts.size && !dels.size && !newCounters.size && !newLogs.length) return result;
        try {
          await sql.tx(async (q) => {
            // Lock and check the version of everything this request read or wrote.
            const involved = [...new Set([...versions.keys(), ...wrote])].sort();
            await q('INSERT INTO col_versions (col, v) SELECT c, 0 FROM unnest($1::text[]) AS t(c) ON CONFLICT (col) DO NOTHING', [involved]);
            const now = await q('SELECT col, v FROM col_versions WHERE col = ANY($1) ORDER BY col FOR UPDATE', [involved]);
            for (const r of now) if (versions.has(r.col) && Number(r.v) !== versions.get(r.col)) throw new Conflict();
            // Everything is written in a few statements, however many records changed: an import of
            // thousands of rows must not cost thousands of round trips.
            if (dels.size) {
              const pairs = [...dels].map((k) => [k.slice(0, k.indexOf('/')), k.slice(k.indexOf('/') + 1)]);
              await q('DELETE FROM docs d USING unnest($1::text[], $2::text[]) AS t(c, i) WHERE d.col = t.c AND d.id = t.i', [pairs.map((x) => x[0]), pairs.map((x) => x[1])]);
            }
            const all = [...puts.values()];
            for (let n = 0; n < all.length; n += BATCH) {
              const part = all.slice(n, n + BATCH);
              await q('INSERT INTO docs (col, id, data) SELECT c, i, d::jsonb FROM unnest($1::text[], $2::text[], $3::text[]) AS t(c, i, d) ON CONFLICT (col, id) DO UPDATE SET data = excluded.data',
                [part.map((x) => x.col), part.map((x) => String(x.doc.id)), part.map((x) => JSON.stringify(x.doc))]);
            }
            for (const [name, n] of newCounters) await q('INSERT INTO counters (name, n) VALUES ($1, $2) ON CONFLICT (name) DO UPDATE SET n = excluded.n', [name, n]);
            for (let n = 0; n < newLogs.length; n += BATCH) {
              const part = newLogs.slice(n, n + BATCH), col = (f) => part.map((e) => (e[f] == null ? null : String(e[f])));
              await q(`INSERT INTO logs (at, usr, user_name, entity, id, action, text)
                SELECT a, u, un, e, i, ac, t FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[]) WITH ORDINALITY AS x(a, u, un, e, i, ac, t, ord) ORDER BY ord`,
              [col('at'), col('user'), col('userName'), col('entity'), col('id'), col('action'), col('text')]);
            }
            await q('UPDATE col_versions SET v = v + 1 WHERE col = ANY($1)', [[...wrote]]);
          });
          return result;
        } catch (e) { if (e instanceof Conflict) break; throw e; }   // someone else changed it first: start again on fresh data
      }
    }
    throw new Error('The data kept changing while this request ran. Try again.');
  }
  return { run, init };
}

/** Wrap a `pg` Pool (or anything with the same connect/query shape) as the `sql` this store needs. */
export function pgSql(pool) {
  return {
    query: async (text, params = []) => (await pool.query(text, params)).rows,
    async tx(fn) {
      const c = await pool.connect();
      try { await c.query('BEGIN'); const out = await fn(async (text, params = []) => (await c.query(text, params)).rows); await c.query('COMMIT'); return out; }
      catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; }
      finally { c.release(); }
    },
  };
}
