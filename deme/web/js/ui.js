// Shared interface pieces: formatting, the information popover, forms built from the schema,
// the side drawer, CSV reading. Every screen uses these so they look and behave the same.

import { data } from './api.js';
import { entityById, fieldsOf } from '../shared/schema.js';
import { esc, inr, num, fmtDate, fmtStamp, toast as baseToast } from '../shared/util.js';

export { esc, inr, num, fmtDate, fmtStamp };
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function toast(msg, tone = '') { const el = document.getElementById('toast'); if (el) el.dataset.tone = tone; baseToast(msg); }
export const oops = (e) => toast(e?.message || 'Something went wrong.', 'crit');

/** The "i" button. Clicking it shows `text`; nothing is explained on screen otherwise. */
export const info = (text, title = '') => (text ? `<button type="button" class="info" aria-label="About ${esc(title || 'this')}" aria-expanded="false" data-info="${esc(text)}" data-info-title="${esc(title)}">i</button>` : '');
export function wireInfo() {
  const pop = document.getElementById('pop');
  let owner = null;
  const close = () => { if (owner) owner.setAttribute('aria-expanded', 'false'); owner = null; pop.hidden = true; };
  document.addEventListener('click', (e) => {
    const b = e.target.closest('.info');
    if (!b) { if (!e.target.closest('#pop')) close(); return; }
    e.preventDefault(); e.stopPropagation();
    if (owner === b) return close();
    close(); owner = b; b.setAttribute('aria-expanded', 'true');
    pop.innerHTML = `${b.dataset.infoTitle ? `<strong>${esc(b.dataset.infoTitle)}</strong>` : ''}${esc(b.dataset.info)}`;
    pop.hidden = false;
    const r = b.getBoundingClientRect(), p = pop.getBoundingClientRect();
    pop.style.left = `${Math.max(12, Math.min(r.left, innerWidth - p.width - 12))}px`;
    pop.style.top = `${r.bottom + 8 + p.height > innerHeight ? Math.max(12, r.top - p.height - 8) : r.bottom + 8}px`;
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  window.addEventListener('hashchange', close);
}

export const tone = (entity, status) => entityById[entity]?.statuses?.[status]?.tone || 'plain';
export const statusTag = (entity, status) => { const s = entityById[entity]?.statuses?.[status]; return s ? `<span class="tag tag-${s.tone}">${esc(s.name)}</span>` : ''; };

/** A stored value as display text, by field type. */
export function show(f, v) {
  if (v === undefined || v === null || v === '') return '<span class="faint">–</span>';
  switch (f.type) {
    case 'money': return esc(inr(v));
    case 'number': return esc(num(v, 2));
    case 'date': return esc(fmtDate(`${v}T00:00:00`));
    case 'datetime': return esc(fmtStamp(v));
    case 'bool': return v ? 'Yes' : 'No';
    case 'select': return esc(f.options.find((o) => o[0] === v)?.[1] ?? v);
    case 'ref': return esc(data.title(f.ref, v) || '(removed)');
    case 'refs': return esc((v || []).map((id) => data.title(f.ref, id)).join(', '));
    case 'user': return esc(data.title('users', v));
    case 'lines': return `${(v || []).length} line${(v || []).length === 1 ? '' : 's'}`;
    default: return esc(v);
  }
}

// ── Forms from field definitions ──
const refOptions = (f, value, scopeDoc) => {
  let docs = data.all(f.ref);
  if (f.scope === 'lot' && scopeDoc) docs = docs.filter((d) => (scopeDoc.rolls || []).includes(d.id));
  if (f.filter) docs = docs.filter((d) => Object.entries(f.filter).every(([k, v]) => d[k] === v) || [].concat(value || []).includes(d.id));
  return docs.map((d) => [d.id, data.title(f.ref, d.id) + (f.ref === 'rolls' ? ` · ${num(d.metres)} m` : '')]).sort((a, b) => a[1].localeCompare(b[1], undefined, { numeric: true }));
};
function control(f, value, name, scopeDoc) {
  const id = `f-${name.replace(/[^\w]/g, '-')}`;
  const a = `id="${id}" name="${esc(name)}"`;
  switch (f.type) {
    case 'long': return `<textarea class="input" ${a}>${esc(value ?? '')}</textarea>`;
    case 'number': case 'money': return `<input class="input num" type="number" step="any" ${a} value="${esc(value ?? '')}">`;
    case 'date': return `<input class="input" type="date" ${a} value="${esc(value ?? '')}">`;
    case 'datetime': return `<input class="input" type="datetime-local" ${a} value="${value ? esc(new Date(new Date(value) - new Date(value).getTimezoneOffset() * 6e4).toISOString().slice(0, 16)) : ''}">`;
    case 'bool': return `<input type="checkbox" ${a} ${value ? 'checked' : ''}>`;
    case 'select': return `<select class="select" ${a}><option value=""></option>${f.options.map(([v, n]) => `<option value="${esc(v)}" ${v === value ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>`;
    case 'ref': return `<select class="select" ${a}><option value=""></option>${refOptions(f, value, scopeDoc).map(([v, n]) => `<option value="${esc(v)}" ${v === value ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>`;
    case 'user': return `<select class="select" ${a}><option value=""></option>${data.users.filter((u) => u.active !== false || u.id === value).map((u) => `<option value="${u.id}" ${u.id === value ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select>`;
    case 'refs': { const opts = refOptions(f, value, scopeDoc); return opts.length ? `<div class="checks" data-refs="${esc(name)}">${opts.map(([v, n]) => `<label><input type="checkbox" value="${esc(v)}" ${(value || []).includes(v) ? 'checked' : ''}> ${esc(n)}</label>`).join('')}</div>` : `<p class="faint">Nothing to choose from yet.</p><div data-refs="${esc(name)}"></div>`; }
    case 'lines': {
      const cols = f.cols.map(([k, label, type, o = {}]) => ({ k, label, type, ...o })).filter((c) => !c.ro);
      const row = (r, i) => `<tr>${cols.map((c) => `<td>${control(c, r[c.k], `${name}.${i}.${c.k}`, scopeDoc)}</td>`).join('')}<td><button type="button" class="btn btn-sm btn-quiet" data-line-del aria-label="Remove line">×</button></td></tr>`;
      const rows = (value && value.length ? value : [{}]);
      return `<div class="lines" data-lines="${esc(name)}"><div class="table-wrap"><table class="table"><thead><tr>${cols.map((c) => `<th>${esc(c.label)}</th>`).join('')}<th></th></tr></thead><tbody>${rows.map(row).join('')}</tbody></table></div><button type="button" class="btn btn-sm btn-outline" data-line-add>Add line</button></div>`;
    }
    default: return `<input class="input" type="text" ${a} value="${esc(value ?? '')}">`;
  }
}
/** HTML for a set of fields. `values` prefill; read-only fields are left out. */
export function formHtml(fields, values = {}, scopeDoc = null) {
  return fields.filter((f) => !f.ro).map((f) => `<div class="field ${f.type === 'lines' || f.type === 'long' || f.type === 'refs' ? 'wide' : ''}"><label for="f-${f.k}">${esc(f.label)}${f.req ? ' <span class="req">*</span>' : ''}</label>${control(f, values[f.k], f.k, scopeDoc)}${f.hint ? `<span class="hint">${esc(f.hint)}</span>` : ''}</div>`).join('');
}
/** Read a form built by formHtml back into an object the service accepts. */
export function readForm(root, fields) {
  const out = {};
  for (const f of fields.filter((x) => !x.ro)) {
    if (f.type === 'lines') {
      const cols = f.cols.map(([k, , type]) => ({ k, type }));
      out[f.k] = $$(`[data-lines="${f.k}"] tbody tr`, root).map((tr) => { const r = {}; $$('input,select,textarea', tr).forEach((c) => { const k = c.name.split('.').pop(); const col = cols.find((x) => x.k === k); if (col && c.value !== '') r[k] = c.value; }); return r; }).filter((r) => Object.keys(r).length);
    } else if (f.type === 'refs') out[f.k] = $$(`[data-refs="${f.k}"] input:checked`, root).map((c) => c.value);
    else { const c = root.querySelector(`[name="${f.k}"]`); if (!c) continue; out[f.k] = f.type === 'bool' ? c.checked : f.type === 'datetime' && c.value ? new Date(c.value).toISOString() : c.value; }
  }
  return out;
}
/** Add and remove rows in any lines editor inside `root`. */
export function wireLines(root) {
  root.addEventListener('click', (e) => {
    const add = e.target.closest('[data-line-add]'), del = e.target.closest('[data-line-del]');
    if (add) { const body = add.closest('.lines').querySelector('tbody'); const tr = body.lastElementChild.cloneNode(true); const i = body.children.length; $$('input,select,textarea', tr).forEach((c) => { c.value = ''; c.name = c.name.replace(/\.\d+\./, `.${i}.`); c.id = `f-${c.name.replace(/[^\w]/g, '-')}`; }); body.appendChild(tr); tr.querySelector('input,select')?.focus(); }
    if (del) { const body = del.closest('tbody'); if (body.children.length > 1) del.closest('tr').remove(); else $$('input,select,textarea', del.closest('tr')).forEach((c) => { c.value = ''; }); }
  });
}

/** Side drawer for a record. Returns { el, close }. */
export function drawer(html, { onClose } = {}) {
  document.querySelector('.drawer-wrap')?.remove();
  const wrap = document.createElement('div');
  wrap.className = 'drawer-wrap';
  wrap.innerHTML = `<div class="drawer-scrim"></div><aside class="drawer" role="dialog" aria-modal="true" tabindex="-1">${html}</aside>`;
  document.body.appendChild(wrap);
  const el = wrap.querySelector('.drawer');
  const close = () => { wrap.remove(); document.removeEventListener('keydown', key); onClose?.(); };
  const key = (e) => { if (e.key === 'Escape' && !document.getElementById('pop').hidden === false) close(); };
  document.addEventListener('keydown', key);
  wrap.querySelector('.drawer-scrim').addEventListener('click', close);
  el.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) close(); });
  wireLines(el); el.focus();
  return { el, close, set(h) { el.innerHTML = h; } };
}

/** Parse CSV text (quotes, commas and line breaks inside quotes handled) into row objects keyed by the header row. */
export function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  const t = text.replace(/^﻿/, '');
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"' && t[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true;
    else if (c === ',' || c === '\t') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; row.push(cell); cell = ''; if (row.some((x) => x.trim() !== '')) rows.push(row); row = []; }
    else cell += c;
  }
  row.push(cell); if (row.some((x) => x.trim() !== '')) rows.push(row);
  if (rows.length < 2) return [];
  const head = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()]).filter(([h, v]) => h && v !== '')));
}

/** Run an async step from a button: shows it busy, reports errors, never double-fires. */
export async function busy(btn, fn) {
  if (btn?.getAttribute('aria-busy') === 'true') return;
  btn?.setAttribute('aria-busy', 'true');
  try { return await fn(); } catch (e) { oops(e); } finally { btn?.removeAttribute('aria-busy'); }
}
export const fields = (entity) => fieldsOf(entityById[entity]);
