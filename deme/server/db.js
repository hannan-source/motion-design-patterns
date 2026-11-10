// SQLite storage behind the interface shared/service.js expects.
// Records are JSON documents keyed by (collection, id); SQLite gives durability and transactions.
// Uses Node's built-in sqlite module, so there is nothing to install.

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function openDb(file) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const sql = new DatabaseSync(file);
  sql.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    CREATE TABLE IF NOT EXISTS docs (col TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (col, id));
    CREATE TABLE IF NOT EXISTS counters (name TEXT PRIMARY KEY, n INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS logs (seq INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT, user TEXT, userName TEXT, entity TEXT, id TEXT, action TEXT, text TEXT);
    CREATE INDEX IF NOT EXISTS logs_entity ON logs (entity, id);
    CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user TEXT NOT NULL, expires INTEGER NOT NULL);
  `);
  const q = {
    all: sql.prepare('SELECT data FROM docs WHERE col = ?'),
    get: sql.prepare('SELECT data FROM docs WHERE col = ? AND id = ?'),
    put: sql.prepare('INSERT INTO docs (col, id, data) VALUES (?, ?, ?) ON CONFLICT (col, id) DO UPDATE SET data = excluded.data'),
    del: sql.prepare('DELETE FROM docs WHERE col = ? AND id = ?'),
    next: sql.prepare('INSERT INTO counters (name, n) VALUES (?, 1) ON CONFLICT (name) DO UPDATE SET n = n + 1 RETURNING n'),
    log: sql.prepare('INSERT INTO logs (at, user, userName, entity, id, action, text) VALUES (?, ?, ?, ?, ?, ?, ?)'),
  };
  let depth = 0;
  const db = {
    all: (col) => q.all.all(col).map((r) => JSON.parse(r.data)),
    get: (col, id) => { if (!id) return null; const r = q.get.get(col, String(id)); return r ? JSON.parse(r.data) : null; },
    put: (col, doc) => { q.put.run(col, doc.id, JSON.stringify(doc)); },
    del: (col, id) => { q.del.run(col, id); },
    next: (name) => q.next.get(name).n,
    log: (e) => { q.log.run(e.at, e.user, e.userName, e.entity ?? null, e.id ?? null, e.action, e.text); },
    logs({ entity, id, limit = 200 } = {}) {
      const where = [], args = [];
      if (entity) { where.push('entity = ?'); args.push(entity); }
      if (id) { where.push('id = ?'); args.push(id); }
      return sql.prepare(`SELECT at, user, userName, entity, id, action, text FROM logs ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY seq DESC LIMIT ?`).all(...args, Math.min(1000, limit));
    },
    /** All-or-nothing: if anything inside throws, nothing is saved. */
    tx(fn) {
      if (depth++ === 0) sql.exec('BEGIN IMMEDIATE');
      try { const out = fn(); if (--depth === 0) sql.exec('COMMIT'); return out; }
      catch (e) { if (--depth === 0) sql.exec('ROLLBACK'); throw e; }
    },
    // Sessions live beside the data so a restart does not sign everyone out.
    sessions: {
      create: (token, user, expires) => sql.prepare('INSERT INTO sessions (token, user, expires) VALUES (?, ?, ?)').run(token, user, expires),
      get: (token) => sql.prepare('SELECT user, expires FROM sessions WHERE token = ?').get(token),
      drop: (token) => sql.prepare('DELETE FROM sessions WHERE token = ?').run(token),
      dropUser: (user) => sql.prepare('DELETE FROM sessions WHERE user = ?').run(user),
      sweep: () => sql.prepare('DELETE FROM sessions WHERE expires < ?').run(Date.now()),
    },
    close: () => sql.close(),
  };
  return db;
}
