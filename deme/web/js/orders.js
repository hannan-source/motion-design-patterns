// Orders: every made-to-order piece has a slip, and this screen is where everyone follows it.
// The board shows the slips moving through the stops, so nobody has to ask where an order is.
// The same module is the one-hand scan page a tailor, QC or a floor manager opens by scanning the
// QR code on a slip. Slips can be placed from here by any team, printed with their QR code, and,
// for production, looked back on by master and by tailor.
// Other teams do not receive customer names, masters, tailors or the trail, so every one of those
// is shown only when it is present on the record.

import { api, data } from './api.js';
import { $, esc, info, toast, busy, num, drawer, fmtStamp } from './ui.js';
import { today, iso, fmtDate, fmtDay, fmtTime } from '../shared/util.js';
import { SLIP_STAGES, GARMENT_REASONS } from '../shared/schema.js';
import { qrSvg, slipLink } from './qr.js';
import { mountPhotos } from './photos.js';

const ORDER = SLIP_STAGES.map(([id]) => id);
const STATUS = { ...Object.fromEntries(SLIP_STAGES), rework: 'Back for rework', rejected: 'Rejected at QC', cancelled: 'Cancelled' };
const REASON = Object.fromEntries(GARMENT_REASONS);
const CHECKS = GARMENT_REASONS.map(([id, name]) => (id === 'fabric' ? 'Fabric' : name));
const KIND = { customer: 'Customer order', store: 'Store display', boutique: 'Boutique stock', shoot: 'Shoot', influencer: 'Influencer' };
const KIND_LINE = { store: 'Our own store', boutique: 'Stock for a boutique', shoot: 'Photo or video shoot', influencer: 'A piece for a creator', customer: 'Taken for a customer' };
const SOURCE = { shopify: 'Shopify', internal: 'Internal', store: 'Store' };
const PRIO = { high: 'High', medium: 'Medium', low: 'Low' };
const SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
const LANES = [
  { id: 'start', name: 'To start', has: ['new'] },
  { id: 'master', name: 'With the master', has: ['assigned', 'cut'] },
  { id: 'stitch', name: 'Being stitched', has: ['stitching', 'rework'] },
  { id: 'qc', name: 'At QC', has: ['stitched', 'qc', 'rejected'] },
  { id: 'finish', name: 'Finishing and packing', has: ['passed', 'finished', 'packed'] },
  { id: 'out', name: 'Dispatched', has: ['dispatched'], fold: true },
  { id: 'off', name: 'Cancelled', has: ['cancelled'], fold: true },
];
const FOLD = 5;                                  // closed slips shown before "Show all"
const STEPS = ['assign', 'missing', 'rework', 'fail', 'details', 'cancel'];   // actions that ask for something first
const LS_RECENT = 'deme-slip-recent';

const same = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();
const plural = (n, one, many = `${one}s`) => `${num(n)} ${n === 1 ? one : many}`;
const initials = (name) => String(name || '').trim().split(/\s+/).slice(-2).map((w) => w[0] || '').join('').toUpperCase();
const day = (s) => new Date(`${s}T00:00:00`);
const styleName = (s) => data.title('styles', s.style) || s.styleName || '';
/** What to call the piece: its style, what it was ordered as, or (for teams who cannot see styles) what it is for. */
const pieceName = (s) => styleName(s) || KIND[s.kind] || 'Piece';
const isStuck = (s) => !!s.noFabric || !!s.needsInfo || s.status === 'rework' || s.status === 'rejected';
const isLate = (s, T = iso(today())) => !!s.promised && s.promised < T && !['dispatched', 'cancelled', 'rejected'].includes(s.status);
const posOf = (s) => (s.status === 'rework' ? ORDER.indexOf('stitching') : s.status === 'rejected' ? ORDER.indexOf('qc') : ORDER.indexOf(s.status));
const laneOf = (s) => LANES.find((l) => l.has.includes(s.status)) || LANES[0];
const freshAx = () => ({ step: '', master: '', stuck: '', reason: '', note: '', size: '', meas: '' });
const remember = (key, value) => { try { sessionStorage.setItem(key, JSON.stringify(value)); } catch { /* storage blocked: this visit only */ } };
const recall = (key, fallback) => { try { return JSON.parse(sessionStorage.getItem(key)) ?? fallback; } catch { return fallback; } };

/** What this person may do with slips. */
function perms() {
  const c = data.can, prod = c('production', 'write');
  return {
    prod, tailor: c('production', 'scan') && !c('production', 'read'), qc: c('quality', 'scan'),
    fabric: prod || c('inventory', 'write'), pack: prod || c('logistics', 'write') || c('b2c', 'write'), details: prod || c('b2c', 'write'),
    cancel: c('production', 'admin'), place: c('projects', 'read'), shop: c('b2c', 'write'), scan: c('production', 'scan') || c('quality', 'scan'),
  };
}

// ── Pieces of a slip, drawn the same way on the board, in the drawer and on the scan page ──
const prioHtml = (s) => { const p = PRIO[s.priority] ? s.priority : 'medium'; return `<span class="or-prio is-${p}" role="img" aria-label="${PRIO[p]} priority"><i></i><i></i><i></i><b>${PRIO[p]}</b></span>`; };
function marksOf(s) {
  const m = [];
  if (s.noFabric) m.push(['crit', `Missing ${s.stuck || 'fabric'}`]);
  if (s.needsInfo) m.push(['warn', 'Needs measurements']);
  if (s.status === 'rework') m.push(['warn', `Back for rework${REASON[s.qcReason] ? `: ${REASON[s.qcReason].toLowerCase()}` : ''}`]);
  if (s.status === 'rejected') m.push(['crit', `Rejected at QC${REASON[s.qcReason] ? `: ${REASON[s.qcReason].toLowerCase()}` : ''}`]);
  if (s.status === 'cancelled') m.push(['plain', 'Cancelled']);
  return m;
}
const marksHtml = (s) => { const m = marksOf(s); return m.length ? `<span class="or-marks">${m.map(([t, text]) => `<span class="or-mark is-${t}">${esc(text)}</span>`).join('')}</span>` : ''; };
function dueOf(s) {
  if (!s.promised) return { text: 'No date', late: false };
  const T = iso(today()), late = isLate(s, T);
  return { text: late ? `Late · ${fmtDate(day(s.promised))}` : s.promised === T ? 'Needed today' : `By ${fmtDate(day(s.promised))}`, late };
}
const stripHtml = (s) => { const at = posOf(s); return `<span class="or-strip" role="img" aria-label="${at < 0 ? 'Cancelled' : `Stop ${at + 1} of ${ORDER.length}: ${esc(STATUS[s.status])}`}">${ORDER.map((_, i) => `<i class="${i < at ? 'is-done' : i === at ? 'is-now' : ''}"></i>`).join('')}</span>`; };
const forLine = (s) => [s.orderNo, KIND[s.kind] && KIND[s.kind] !== pieceName(s) ? KIND[s.kind] : '', s.customerName].filter(Boolean).join(' · ');

/** Masters named on slips, day plans and bundles before, most used first: masters do not sign in, so this is the only list of them. */
function knownMasters() {
  const seen = new Map();
  const add = (n) => { const k = String(n || '').trim(); if (!k) return; const e = seen.get(k.toLowerCase()) || { name: k, n: 0 }; e.n++; seen.set(k.toLowerCase(), e); };
  for (const s of data.all('slips')) add(s.master);
  for (const p of data.all('day_plans')) for (const l of p.lines || []) add(l.master);
  for (const b of data.all('bundles')) add(b.master);
  return [...seen.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name)).map((e) => e.name);
}

// ── The steps a person may take on a slip, and the small forms some of them need ──
function actionsFor(s, P, where) {
  const A = [], st = s.status, early = ['new', 'assigned'].includes(st), scan = where === 'scan';
  if (scan && P.tailor && !s.noFabric) {
    if (['assigned', 'cut'].includes(st)) A.push({ k: 'scan', label: 'Start stitching', tone: 'go' });
    if (st === 'rework') A.push({ k: 'scan', label: 'Start rework', tone: 'go' });
    if (st === 'stitching') A.push({ k: 'scan', label: 'Finished stitching', tone: 'go' });
  }
  if (scan && P.qc) {
    if (st === 'stitched') A.push({ k: 'qcIn', label: 'Piece reached QC', tone: 'go' });
    if (st === 'qc') A.push({ k: 'pass', label: 'Pass', tone: 'ok' }, { k: 'rework', label: 'Send back', tone: 'warn' }, { k: 'fail', label: 'Reject', tone: 'crit' });
  }
  if (P.prod) {
    if (st === 'new') A.push({ k: 'assign', label: 'Give to a master', tone: s.noFabric ? '' : 'go' });
    if (st === 'assigned' && !s.noFabric) A.push({ k: 'cut', label: 'Cut', tone: 'go' });
    if (st === 'assigned') A.push({ k: 'assign', label: 'Give to another master' });
    if (scan && st === 'stitching') A.push({ k: 'scan', label: 'Stitching finished' });
    if (st === 'passed') A.push({ k: 'finish', label: 'Finished', tone: 'go' });
  }
  if (P.fabric && early) A.push(s.noFabric ? { k: 'fabricIn', label: 'Fabric arrived', tone: 'go' } : { k: 'missing', label: 'Missing fabric', tone: 'warn' });
  if (P.pack && st === 'finished') A.push({ k: 'pack', label: 'Packed', tone: 'go' });
  if (!scan && P.details && early) A.push({ k: 'details', label: s.needsInfo ? 'Add measurements' : 'Change measurements', tone: s.needsInfo ? 'go' : '' });
  if (!scan && P.cancel && ['new', 'assigned', 'cut'].includes(st)) A.push({ k: 'cancel', label: 'Cancel slip' });
  return A;
}
const TONE = { go: 'btn-primary', ok: 'btn-primary is-ok', warn: 'btn-primary is-warn', crit: 'btn-primary is-crit' };
function actsHtml(s, P, ax, where) {
  if (ax.step) return stepHtml(s, ax, where);
  const A = actionsFor(s, P, where);
  return A.length ? `<div class="or-acts ${where === 'scan' ? 'is-big' : ''}">${A.map((a) => `<button type="button" class="btn ${TONE[a.tone] || 'btn-outline'} or-act" data-act="${a.k}" data-fk="act-${a.k}-${a.tone || 'x'}">${esc(a.label)}</button>`).join('')}</div>` : '';
}
function stepHtml(s, ax, where) {
  const k = ax.step, big = where === 'scan' ? 'is-big' : '';
  const back = '<button type="button" class="btn btn-quiet" data-act-back data-fk="ax-back">Back</button>';
  const wrap = (title, inner, go, off = false) => `<form class="or-step ${big}" data-form="step" novalidate><p class="or-step-h">${esc(title)}</p>${inner}<div class="or-step-foot"><button type="submit" class="btn btn-primary or-act" data-fk="ax-go" ${off ? 'disabled' : ''}>${esc(go)}</button>${back}</div></form>`;
  const text = (key, label, value, more = '') => `<div class="field"><label for="orAx-${key}">${esc(label)}</label><input class="input" id="orAx-${key}" type="text" autocomplete="off" data-ax="${key}" data-fk="ax-${key}" value="${esc(value)}" ${more}></div>`;
  if (k === 'assign') {
    const known = knownMasters().filter((m) => !same(m, s.master)).slice(0, 8);
    return wrap(`Give ${s.no} to`, `${known.length ? `<div class="or-chiprow">${known.map((m) => `<button type="button" class="chip" data-master="${esc(m)}" data-fk="m-${esc(m)}"><span class="av" style="--av:20px" aria-hidden="true">${esc(initials(m))}</span>${esc(m)}</button>`).join('')}</div>` : ''}${text('master', known.length ? 'Or another master' : 'Master', ax.master, 'placeholder="Master\'s name"')}`, 'Give');
  }
  if (k === 'missing') return wrap(`What is ${s.no} waiting for`, text('stuck', 'What is missing', ax.stuck), 'Mark as missing');
  if (k === 'rework' || k === 'fail') {
    return wrap(k === 'rework' ? `Why does ${s.no} go back` : `Why is ${s.no} rejected`, `<div class="or-reasons" role="group" aria-label="Reason">${GARMENT_REASONS.map(([id, name]) => `<button type="button" class="or-reason" data-reason="${id}" data-fk="r-${id}" aria-pressed="${ax.reason === id}">${esc(name)}</button>`).join('')}</div>${text('note', 'Note', ax.note, 'placeholder="Sleeve 1 cm short"')}`, k === 'rework' ? 'Send back for rework' : 'Reject the piece', !ax.reason);
  }
  if (k === 'details') return wrap(`Measurements for ${s.no}`, `${text('size', 'Size', ax.size)}<div class="field"><label for="orAx-meas">Measurements and notes</label><textarea class="input" id="orAx-meas" data-ax="meas" data-fk="ax-meas">${esc(ax.meas)}</textarea></div>`, 'Save measurements');
  return wrap(`Cancel ${s.no}`, text('note', 'Why', ax.note), 'Cancel slip');
}
/** Send one step to the server. Rejects with a message fit to show. */
function send(k, s, ax) {
  const rec = { entity: 'slips', id: s.id };
  switch (k) {
    case 'scan': return api.act('slip.scan', { code: s.no });
    case 'qcIn': return api.act('slip.qcIn', { code: s.no });
    case 'pass': return api.act('slip.qc', { code: s.no, result: 'pass' });
    case 'rework': case 'fail': if (!ax.reason) return Promise.reject(new Error('Choose the reason.')); return api.act('slip.qc', { code: s.no, result: k, reason: ax.reason, note: ax.note.trim() });
    case 'assign': if (!ax.master.trim()) return Promise.reject(new Error('Name the master.')); return api.act('slip.assign', { master: ax.master.trim() }, rec);
    case 'missing': return api.act('slip.noFabric', { stuck: ax.stuck.trim() || 'Fabric' }, rec);
    case 'fabricIn': return api.act('slip.fabricIn', {}, rec);
    case 'details': if (!ax.meas.trim()) return Promise.reject(new Error('Add the measurements.')); return api.act('slip.details', { size: ax.size.trim(), measurements: ax.meas.trim() }, rec);
    case 'cancel': if (!ax.note.trim()) return Promise.reject(new Error('Say why it is cancelled.')); return api.act('slip.cancel', { note: ax.note.trim() }, rec);
    default: return api.act(`slip.${k}`, {}, rec);   // cut, finish, pack
  }
}
/** Open the small form a step needs, filled with what the slip already says. */
function openStep(ax, k, s) { Object.assign(ax, freshAx(), { step: k, stuck: k === 'missing' ? 'Fabric' : '', size: s.size || '', meas: s.measurements || '' }); }
/** Keep what is typed in a step form, so a redraw puts it back. */
function typeStep(ax, t) { if (t.dataset?.ax) ax[t.dataset.ax] = t.value; }

/** Replace a region's HTML, putting focus and the caret back where they were. */
function swap(node, html) {
  const a = document.activeElement, inside = !!a && node.contains(a), fk = inside ? a.dataset.fk || '' : '';
  let caret = null;
  if (fk && /^(INPUT|TEXTAREA)$/.test(a.tagName)) { try { caret = [a.selectionStart, a.selectionEnd]; } catch { /* not a text field */ } }
  const scroller = node.closest('.drawer-body, .workspace'), keep = scroller ? scroller.scrollTop : 0;
  node.innerHTML = html;
  if (scroller) scroller.scrollTop = keep;
  if (!fk) return;
  const n = [...node.querySelectorAll('[data-fk]')].find((x) => x.dataset.fk === fk);
  if (n) { n.focus({ preventScroll: true }); if (caret && caret[0] !== null) { try { n.setSelectionRange(caret[0], caret[1]); } catch { /* not a text field */ } } }
}

// ── Printing: one slip per piece, two to a sheet, with the QR code the scan page reads ──
function slipSheet(slips) {
  const cell = (label, value, cls = '') => (value ? `<div class="${cls}"><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>` : '');
  return `<div class="or-sheets">${slips.map((s) => {
    const style = data.get('styles', s.style);
    const bom = (style?.bom || []).filter((l) => l.item && data.title('items', l.item)).map((l) => `${data.title('items', l.item)}${l.qty ? ` × ${num(l.qty, 2)}` : ''}`);
    const fab = [data.title('items', style?.fabric), s.colour].filter(Boolean).join(' · ');
    return `<article class="or-slip">
      <header><div><span>Order slip · ${esc(SOURCE[s.source] || 'Order')}${KIND[s.kind] ? ` · ${esc(KIND[s.kind])}` : ''}</span><strong class="mono">${esc(s.no)}</strong><em>${esc(PRIO[s.priority] || 'Medium')} priority${s.priorityReason ? `: ${esc(s.priorityReason)}` : ''}</em></div>${qrSvg(slipLink(s.no), { size: 120, label: esc(`QR code for slip ${s.no}`) })}</header>
      <p class="or-slip-style">${esc(pieceName(s))}${style?.code ? ` <small class="mono">${esc(style.code)}</small>` : ''}</p>
      <dl>${cell('Size', s.size, 'big')}${cell('Promised', s.promised ? fmtDay(day(s.promised)) : '', 'big')}${cell('Order', s.orderNo)}${cell('Customer', s.customerName)}${cell('Fabric and colour', fab)}${cell('Master', s.master)}${cell('Purpose', s.purpose)}${s.noFabric ? cell('Waiting for', s.stuck || 'Fabric') : ''}
        ${cell('Measurements and notes', s.measurements, 'wide pre')}${cell('Accessories', bom.join(', '), 'wide')}</dl>
      <div class="or-slip-qc"><span>QC</span>${CHECKS.map((c) => `<label><i></i>${esc(c)}</label>`).join('')}</div>
      <div class="or-slip-sign"><span>Tailor</span><span>Checked by</span><span>Date</span></div>
    </article>`;
  }).join('')}</div>`;
}
let stopPrint = null;
function printOut(html) {
  stopPrint?.();
  const area = document.createElement('div'); area.id = 'printArea'; area.className = 'or-print'; area.innerHTML = html;
  document.body.appendChild(area); document.documentElement.classList.add('printing');
  const done = () => { document.documentElement.classList.remove('printing'); area.remove(); window.removeEventListener('afterprint', done); clearTimeout(t); if (stopPrint === done) stopPrint = null; };
  const t = setTimeout(done, 60000); stopPrint = done;
  window.addEventListener('afterprint', done);
  try { window.print(); } catch { done(); toast('This device cannot print from here.', 'crit'); }
}

export function mount(el, ctx) { return ctx.route?.name === 'slip' ? mountScan(el, ctx) : mountBoard(el, ctx); }

// ───────────────────────── The board ─────────────────────────
function mountBoard(el, ctx) {
  const P = perms();
  const people = P.prod;   // masters and tailors are on the record only for production
  el.innerHTML = `<div class="workspace orders"><div class="workspace-inner" id="orRoot">
    <div class="view-head"><div class="title-row"><h1 class="reveal">Orders</h1>${info('Every made-to-order piece has a slip. A slip moves from left to right as it is given to a master, stitched, checked and packed, so anyone can see where an order is without asking. Tap a slip for everything on it.', 'Orders')}</div>
      <div class="row or-top">${people ? '<div class="seg" role="group" aria-label="View"><button type="button" data-view="board" aria-pressed="true">Board</button><button type="button" data-view="made" aria-pressed="false">Who made what</button></div>' : ''}
        ${P.shop ? (api.caps.shopify ? '<button type="button" class="btn btn-outline" data-pull>Pull from Shopify</button>' : `<span class="or-note"><button type="button" class="btn btn-quiet" data-import>Import orders</button>${info('Online orders come in by import until the Shopify connection is on. After that they arrive here by themselves.', 'Shopify')}</span>`) : ''}
        ${P.place ? '<button type="button" class="btn btn-primary" data-place>Place an order</button>' : ''}</div></div>
    <div class="or-tools" id="orTools"><input class="input or-q" id="orQ" type="search" autocomplete="off" placeholder="Find an order, slip or style" aria-label="Find an order, slip or style"><div class="or-filters" id="orFilters"></div></div>
    <div id="orBody"></div><div class="or-barwrap" id="orBar"></div></div></div>`;
  const root = $('#orRoot', el), body = $('#orBody', root), bar = $('#orBar', root), filters = $('#orFilters', root), tools = $('#orTools', root), box = $('#orQ', root);
  const st = { view: 'board', q: '', f: new Set(), source: '', lane: '', more: new Set(), sel: new Set(), give: false, master: '', period: '30', who: '' };
  let gone = false, down = false, later = false, dr = null, form = null;

  // A redraw that comes from someone else's change waits while a button is being pressed, so the press is not lost.
  const onDown = () => { down = true; };
  const onUp = () => { down = false; if (later) { later = false; setTimeout(refresh, 0); } };
  window.addEventListener('pointerdown', onDown, true); window.addEventListener('pointerup', onUp, true); window.addEventListener('pointercancel', onUp, true);
  function refresh() {
    if (gone) return;
    if (down) { later = true; return; }
    for (const id of [...st.sel]) if (!data.get('slips', id)) st.sel.delete(id);
    render(); if (dr) paintDrawer();
  }

  // ── What is on the board ──
  const hay = (s) => [s.no, s.orderNo, styleName(s), s.customerName, s.purpose, s.master, s.size, s.colour, KIND[s.kind]].filter(Boolean).join(' ').toLowerCase();
  const rank = (s) => ({ high: 0, medium: 1, low: 2 }[s.priority] ?? 1);
  function model() {
    const T = iso(today()), q = st.q.trim().toLowerCase(), me = data.user?.id, all = data.all('slips');
    const live = all.filter((s) => !['dispatched', 'cancelled'].includes(s.status));
    const counts = { mine: live.filter((s) => s.raisedBy === me).length, stuck: live.filter(isStuck).length, high: live.filter((s) => s.priority === 'high').length, late: live.filter((s) => isLate(s, T)).length };
    const hit = (s) => (!q || hay(s).includes(q)) && (!st.f.has('mine') || s.raisedBy === me) && (!st.f.has('stuck') || isStuck(s)) && (!st.f.has('high') || s.priority === 'high') && (!st.f.has('late') || isLate(s, T)) && (!st.source || s.source === st.source);
    const shown = all.filter(hit);
    const lanes = LANES.map((l) => ({ ...l, slips: shown.filter((s) => l.has.includes(s.status)).sort(l.fold
      ? (a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))
      : (a, b) => rank(a) - rank(b) || String(a.promised || '9').localeCompare(String(b.promised || '9')) || String(a.no).localeCompare(String(b.no), undefined, { numeric: true })) })).filter((l) => l.id !== 'off' || l.slips.length);
    return { all, shown, lanes, counts, filtered: !!q || st.f.size > 0 || !!st.source };
  }

  function filtersHtml(M) {
    const chip = (id, label, n, tone) => `<button type="button" class="chip or-f ${tone && n ? `is-${tone}` : ''}" data-f="${id}" data-fk="f-${id}" aria-pressed="${st.f.has(id)}">${label}<b>${num(n)}</b></button>`;
    return `<div class="or-chiprow" role="group" aria-label="Show only">${chip('mine', 'Mine', M.counts.mine)}${chip('stuck', 'Stuck', M.counts.stuck, 'crit')}${chip('high', 'High priority', M.counts.high)}${chip('late', 'Late', M.counts.late, 'crit')}</div>
      <div class="seg" role="group" aria-label="Where the order came from">${[['', 'All'], ...Object.entries(SOURCE)].map(([id, name]) => `<button type="button" data-source="${id}" data-fk="src-${id}" aria-pressed="${st.source === id}">${name}</button>`).join('')}</div>`;
  }
  function cardHtml(s) {
    const due = dueOf(s), lane = laneOf(s), tone = marksOf(s)[0]?.[0] || '', sub = [s.size, s.colour].filter(Boolean).join(' · '), who = forLine(s);
    return `<li class="or-card ${tone ? `is-${tone}` : ''} ${P.prod ? 'has-pick' : ''} ${st.sel.has(s.id) ? 'is-sel' : ''}">
      <button type="button" class="or-card-main" data-open="${s.id}" data-fk="c-${s.id}">
        <span class="or-card-top"><strong class="mono">${esc(s.no)}</strong>${prioHtml(s)}</span>
        <span class="or-card-style">${esc(pieceName(s))}</span>
        ${sub ? `<span class="or-card-sub">${esc(sub)}</span>` : ''}${who ? `<span class="or-card-for">${esc(who)}</span>` : ''}${s.purpose ? `<span class="or-card-for">${esc(s.purpose)}</span>` : ''}
        ${marksHtml(s)}
        <span class="or-card-foot"><span class="or-due ${due.late ? 'is-late' : ''}">${esc(due.text)}</span>${STATUS[s.status] !== lane.name && !['rework', 'rejected', 'cancelled'].includes(s.status) ? `<span class="or-at">${esc(STATUS[s.status])}</span>` : ''}</span>
        ${stripHtml(s)}
      </button>
      ${P.prod ? `<label class="or-pick"><input type="checkbox" data-sel="${s.id}" data-fk="s-${s.id}" ${st.sel.has(s.id) ? 'checked' : ''} aria-label="Select ${esc(s.no)}"></label>` : ''}
    </li>`;
  }
  function boardHtml(M) {
    if (!M.all.length) {
      return `<section class="panel empty"><h3>No orders yet</h3><p>A slip appears here for every piece once an order is placed${P.shop ? ' or comes in from Shopify' : ''}.</p><div class="row">${P.place ? '<button type="button" class="btn btn-primary" data-place data-fk="e-place">Place an order</button>' : ''}${P.shop ? (api.caps.shopify ? '<button type="button" class="btn btn-outline" data-pull data-fk="e-pull">Pull from Shopify</button>' : '<button type="button" class="btn btn-outline" data-import data-fk="e-import">Import orders</button>') : ''}</div></section>`;
    }
    if (!M.shown.length) return '<section class="panel empty"><h3>No slips match</h3><button type="button" class="btn btn-primary" data-clear data-fk="e-clear">Show all slips</button></section>';
    if (!st.lane || !M.lanes.some((l) => l.id === st.lane)) st.lane = (M.lanes.find((l) => l.slips.length) || M.lanes[0]).id;
    const stuckIn = (l) => l.slips.filter(isStuck).length;
    return `<div class="or-board" style="--n:${M.lanes.filter((l) => !l.fold).length + 1}">
      <nav class="or-stops" aria-label="Stops">${M.lanes.map((l) => `<button type="button" class="or-stop is-${l.id}" data-lane="${l.id}" data-fk="lane-${l.id}" aria-pressed="${l.id === st.lane}"><b>${num(l.slips.length)}</b><span>${esc(l.name)}</span>${stuckIn(l) ? `<i aria-label="${plural(stuckIn(l), 'stuck slip')}"></i>` : ''}</button>`).join('')}</nav>
      <div class="or-lanes">${M.lanes.map((l, i) => {
        const open = !l.fold || st.more.has(l.id) || !!st.q.trim(), list = open ? l.slips : l.slips.slice(0, FOLD), stuck = stuckIn(l);
        return `${l.fold && !M.lanes[i - 1]?.fold ? '<div class="or-closed">' : ''}<section class="or-lane is-${l.id} ${l.id === st.lane ? 'is-on' : ''}" aria-label="${esc(l.name)}">
          <header><h2>${esc(l.name)}</h2><span class="or-n">${num(l.slips.length)}</span>${stuck ? `<span class="or-n is-stuck" aria-label="${plural(stuck, 'stuck slip')}">${num(stuck)} stuck</span>` : ''}${P.prod && !l.fold && l.slips.length ? `<button type="button" class="or-all" data-lane-all="${l.id}" data-fk="all-${l.id}">${l.slips.every((s) => st.sel.has(s.id)) ? 'Clear' : 'Select all'}</button>` : ''}</header>
          ${list.length ? `<ul class="or-cards">${list.map(cardHtml).join('')}</ul>` : '<p class="or-none">Nothing here</p>'}
          ${l.fold && l.slips.length > FOLD && !st.q.trim() ? `<button type="button" class="btn btn-sm btn-quiet" data-more="${l.id}" data-fk="more-${l.id}">${st.more.has(l.id) ? 'Show fewer' : `Show all ${num(l.slips.length)}`}</button>` : ''}
        </section>${l.fold && !M.lanes[i + 1]?.fold ? '</div>' : ''}`;
      }).join('')}</div></div>`;
  }
  function barHtml() {
    if (!P.prod || !st.sel.size || st.view !== 'board') return '';
    const picked = [...st.sel].map((id) => data.get('slips', id)).filter(Boolean), can = picked.filter((s) => ['new', 'assigned'].includes(s.status)).length;
    if (st.give) {
      const known = knownMasters().slice(0, 8);
      return `<form class="or-bar is-give" data-form="give" novalidate><p class="or-step-h">Give ${plural(can, 'slip')} to</p>
        ${known.length ? `<div class="or-chiprow">${known.map((m) => `<button type="button" class="chip" data-give="${esc(m)}" data-fk="g-${esc(m)}"><span class="av" style="--av:20px" aria-hidden="true">${esc(initials(m))}</span>${esc(m)}</button>`).join('')}</div>` : ''}
        <div class="or-bar-row"><input class="input" type="text" autocomplete="off" data-bar-master data-fk="bar-master" placeholder="Master's name" aria-label="Master's name" value="${esc(st.master)}"><button type="submit" class="btn btn-primary" data-fk="bar-go">Give</button><button type="button" class="btn btn-quiet" data-bar="back" data-fk="bar-back">Back</button></div></form>`;
    }
    return `<div class="or-bar"><p class="or-bar-n"><b>${num(picked.length)}</b> selected</p><button type="button" class="btn btn-primary" data-bar="give" data-fk="bar-give" ${can ? '' : 'disabled'}>Give to a master</button><button type="button" class="btn btn-outline" data-bar="print" data-fk="bar-print">Print slips</button><button type="button" class="btn btn-quiet" data-bar="clear" data-fk="bar-clear">Clear</button></div>`;
  }

  // ── Who made what: finished pieces by master and by tailor ──
  const doneAt = (s) => { const ev = Array.isArray(s.events) ? s.events : []; return String([...ev].reverse().find((e) => /^(Finished|QC passed)/.test(e.stage))?.at || s.updatedAt || s.createdAt || ''); };
  function madeHtml() {
    const from = st.period === 'all' ? '' : (() => { const d = today(); d.setDate(d.getDate() - Number(st.period)); return iso(d); })();
    const rows = data.all('slips').filter((s) => ['finished', 'packed', 'dispatched'].includes(s.status)).map((s) => ({ s, at: doneAt(s) })).filter((r) => !from || !r.at || iso(new Date(r.at)) >= from);
    const group = (keyOf, nameOf) => {
      const g = new Map();
      for (const r of rows) {
        const key = keyOf(r.s) || '', e = g.get(key) || { key, name: key ? nameOf(r.s) : '', n: 0, reworks: 0, clean: 0, styles: new Map(), rows: [] };
        e.n++; e.reworks += r.s.reworks || 0; if (!r.s.reworks) e.clean++; e.styles.set(pieceName(r.s), (e.styles.get(pieceName(r.s)) || 0) + 1); e.rows.push(r); g.set(key, e);
      }
      return [...g.values()].sort((a, b) => !a.key - !b.key || b.n - a.n || a.name.localeCompare(b.name));
    };
    const masters = group((s) => String(s.master || '').trim().toLowerCase(), (s) => String(s.master).trim());
    const tailors = group((s) => s.tailor || '', (s) => data.title('users', s.tailor) || 'No longer on the team');
    const period = `<div class="seg" role="group" aria-label="Period">${[['7', '7 days'], ['30', '30 days'], ['90', '90 days'], ['all', 'All time']].map(([id, name]) => `<button type="button" data-period="${id}" data-fk="per-${id}" aria-pressed="${st.period === id}">${name}</button>`).join('')}</div>`;
    const head = `<div class="or-made-head"><div class="title-row"><h2>Who made what</h2>${info('Finished, packed and dispatched pieces, by the master the slip was given to and by the tailor who scanned it. Reworks count the times QC sent a piece back.', 'Who made what')}</div>${period}</div>`;
    if (!rows.length) return `${head}<section class="panel empty"><h3>No finished pieces ${st.period === 'all' ? 'yet' : 'in this period'}</h3>${st.period === 'all' ? '<button type="button" class="btn btn-primary" data-view="board" data-fk="e-board">Open the board</button>' : '<button type="button" class="btn btn-primary" data-period="all" data-fk="e-all">Show all time</button>'}</section>`;
    const reworks = rows.reduce((n, r) => n + (r.s.reworks || 0), 0), clean = rows.filter((r) => !r.s.reworks).length;
    const col = (kind, title, list, none) => {
      const max = Math.max(1, ...list.map((p) => p.n));
      return `<section class="or-col"><h3 class="sect">${title}</h3><ul class="or-people">${list.map((p) => {
        const id = `${kind}:${p.key}`, open = st.who === id, name = p.key ? p.name : none;
        return `<li class="or-person ${p.key ? '' : 'is-none'}"><button type="button" class="or-person-main" data-who="${esc(id)}" data-fk="who-${esc(id)}" aria-expanded="${open}">
            <span class="av ${p.key ? '' : 'av-none'}" style="--av:38px" aria-hidden="true">${p.key ? esc(initials(name)) : '?'}</span>
            <span class="or-person-name"><strong>${esc(name)}</strong><span class="or-rate" style="--v:${((p.n / max) * 100).toFixed(1)}%;--c:${((p.clean / p.n) * 100).toFixed(1)}%" role="img" aria-label="${plural(p.clean, 'piece')} right first time out of ${num(p.n)}"><i></i></span></span>
            <span class="or-person-n"><b>${num(p.n)}</b>${p.n === 1 ? 'piece' : 'pieces'}</span></button>
          <div class="or-person-more"><span class="tag ${p.reworks ? 'tag-warn' : 'tag-ok'}">${p.reworks ? plural(p.reworks, 'rework') : 'No rework'}</span>${[...p.styles.entries()].sort((a, b) => b[1] - a[1]).map(([n, c]) => `<span class="or-made-style">${esc(n)}<b>${num(c)}</b></span>`).join('')}</div>
          ${open ? `<ul class="or-pieces">${p.rows.sort((a, b) => b.at.localeCompare(a.at)).map(({ s, at }) => `<li><button type="button" data-open="${s.id}" data-fk="p-${esc(id)}-${s.id}"><strong class="mono">${esc(s.no)}</strong><span>${esc([pieceName(s), s.size].filter(Boolean).join(' · '))}</span>${s.reworks ? `<span class="tag tag-warn">${plural(s.reworks, 'rework')}</span>` : ''}<span class="or-due">${at ? esc(fmtDate(new Date(at))) : ''}</span></button></li>`).join('')}</ul>` : ''}
        </li>`;
      }).join('')}</ul></section>`;
    };
    return `${head}<div class="kpis"><div class="kpi"><p class="kpi-label">Pieces finished</p><p class="kpi-value">${num(rows.length)}</p></div><div class="kpi" data-state="${clean === rows.length ? 'ok' : ''}"><p class="kpi-label">Right first time</p><p class="kpi-value">${num(clean)}</p><p class="kpi-note">of ${num(rows.length)}</p></div><div class="kpi" data-state="${reworks ? 'warn' : ''}"><p class="kpi-label">Reworks</p><p class="kpi-value">${num(reworks)}</p></div><div class="kpi"><p class="kpi-label">Masters</p><p class="kpi-value">${num(masters.filter((m) => m.key).length)}</p></div><div class="kpi"><p class="kpi-label">Tailors</p><p class="kpi-value">${num(tailors.filter((m) => m.key).length)}</p></div></div>
      <div class="or-made">${col('m', 'By master', masters, 'No master on record')}${col('t', 'By tailor', tailors, 'No tailor on record')}</div>`;
  }

  function render() {
    const made = st.view === 'made' && people;
    root.querySelectorAll('[data-view]').forEach((b) => { if (b.closest('.seg')) b.setAttribute('aria-pressed', String(b.dataset.view === (made ? 'made' : 'board'))); });
    tools.hidden = made;
    if (made) { swap(body, madeHtml()); swap(bar, ''); return; }
    const M = model();
    tools.hidden = !M.all.length;
    const across = body.querySelector('.or-lanes')?.scrollLeft || 0;   // lanes scroll sideways inside the board on a narrow window
    swap(filters, filtersHtml(M)); swap(body, boardHtml(M)); swap(bar, barHtml());
    if (across) { const l = body.querySelector('.or-lanes'); if (l) l.scrollLeft = across; }
  }
  const focusOn = (fk) => [...root.querySelectorAll('[data-fk]')].find((x) => x.dataset.fk === fk)?.focus({ preventScroll: true });

  // ── A slip's details, in the side drawer ──
  function slipHead(s) {
    return `<div><p class="eyebrow">${esc([SOURCE[s.source], KIND[s.kind]].filter(Boolean).join(' · ') || 'Slip')}</p><h2 class="mono">${esc(s.no)}</h2><div class="or-d-tags">${prioHtml(s)}<span class="tag or-state is-${laneOf(s).id}">${esc(STATUS[s.status] || s.status)}</span></div></div><button class="icon-btn" type="button" data-close aria-label="Close">×</button>`;
  }
  function slipMain(s) {
    const due = dueOf(s), at = posOf(s), ev = Array.isArray(s.events) ? s.events : [];
    const fact = (label, value, cls = '') => (value ? `<div class="${cls}"><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>` : '');
    return `${marksHtml(s)}
      <div class="or-d-title"><h3>${esc(pieceName(s))}</h3>${[s.size, s.colour].filter(Boolean).length ? `<p>${esc([s.size, s.colour].filter(Boolean).join(' · '))}</p>` : ''}</div>
      <div class="or-track is-${laneOf(s).id}"><ol>${ORDER.map((id, i) => `<li class="${i < at ? 'is-done' : i === at ? 'is-now' : ''}" ${i === at ? 'aria-current="step"' : ''}><i></i><span>${esc(STATUS[id])}</span></li>`).join('')}</ol><p class="or-track-now">${at < 0 ? 'Cancelled' : `${esc(STATUS[s.status])} · stop ${at + 1} of ${ORDER.length}`}</p></div>
      ${actsHtml(s, P, dr.ax, 'drawer')}
      <dl class="or-facts">${fact('Order', s.orderNo)}${fact('Customer', s.customerName)}${fact('Needed by', s.promised ? `${fmtDay(day(s.promised))}${due.late ? ' · late' : ''}` : '', due.late ? 'is-late' : '')}${fact('Priority', `${PRIO[s.priority] || 'Medium'}${s.priorityReason ? `: ${s.priorityReason}` : ''}`)}${fact('For', KIND[s.kind])}${fact('Purpose', s.purpose)}${fact('Asked by', data.title('users', s.raisedBy))}${fact('Team', data.title('work_centres', s.team))}${fact('Master', s.master)}${fact('Tailor', data.title('users', s.tailor))}${fact('Times reworked', s.reworks ? num(s.reworks) : '')}${fact('QC reason', REASON[s.qcReason])}</dl>
      ${s.measurements ? `<div class="or-notes"><p class="eyebrow">Measurements and notes</p><p>${esc(s.measurements)}</p></div>` : ''}
      <div class="or-qr">${qrSvg(slipLink(s.no), { size: 132, label: esc(`QR code for slip ${s.no}`) })}<div><p class="eyebrow">Scan to open this slip</p><p class="mono or-qr-no">${esc(s.no)}</p><div class="row"><button type="button" class="btn btn-outline btn-sm" data-print-one data-fk="d-print">Print slip</button>${P.scan ? '<button type="button" class="btn btn-quiet btn-sm" data-scan-page data-fk="d-scan">Open on the scan page</button>' : ''}</div></div></div>
      ${ev.length ? `<div class="or-trail"><div class="title-row"><p class="eyebrow">Trail</p>${info('Every stop this piece made, with the time and the person who recorded it.', 'Trail')}</div><ol>${ev.map((e) => `<li><time>${e.at ? esc(fmtStamp(e.at)) : ''}</time><strong>${esc(e.stage)}</strong><span>${esc([e.by, e.note].filter(Boolean).join(' · '))}</span></li>`).join('')}</ol></div>` : ''}`;
  }
  function paintDrawer() {
    const s = dr && data.get('slips', dr.id);
    if (!s) { dr?.d.close(); return; }
    if (dr.ax.step && !actionsFor(s, P, 'drawer').some((a) => a.k === dr.ax.step)) dr.ax = freshAx();   // the slip moved on under an open form
    swap($('[data-r="head"]', dr.d.el), slipHead(s)); swap($('[data-r="main"]', dr.d.el), slipMain(s));
  }
  function openSlip(id) {
    const s = data.get('slips', id); if (!s) return;
    dr?.photos?.destroy?.(); form = null;
    const d = drawer('<div class="orders or-drawer"><header class="drawer-head" data-r="head"></header><div class="drawer-body"><div class="or-d-main" data-r="main"></div><div data-photos></div></div></div>', { onClose: () => { if (dr?.d === d) { dr.photos?.destroy?.(); dr = null; } } });
    dr = { id, d, ax: freshAx(), photos: null };
    paintDrawer();
    dr.photos = mountPhotos($('[data-photos]', d.el), 'slips', id, { canAdd: true });
    const run = (k, btn) => busy(btn, async () => {
      const cur = data.get('slips', dr.id); if (!cur) return;
      const out = await send(k, cur, dr.ax);
      if (!dr || dr.d !== d) return void toast(out.message);
      dr.ax = freshAx(); toast(out.message); paintDrawer(); render();
    });
    d.el.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b || b.classList.contains('info') || !dr || dr.d !== d) return;
      const cur = data.get('slips', dr.id); if (!cur) return;
      if (b.dataset.act) { if (STEPS.includes(b.dataset.act)) { openStep(dr.ax, b.dataset.act, cur); paintDrawer(); $('[data-ax]', d.el)?.focus(); } else run(b.dataset.act, b); }
      else if (b.dataset.actBack !== undefined) { dr.ax = freshAx(); paintDrawer(); }
      else if (b.dataset.master) { dr.ax.master = b.dataset.master; run('assign', b); }
      else if (b.dataset.reason) { dr.ax.reason = b.dataset.reason; paintDrawer(); }
      else if (b.dataset.printOne !== undefined) printOut(slipSheet([cur]));
      else if (b.dataset.scanPage !== undefined) location.hash = `slip-${cur.no}`;
    });
    d.el.addEventListener('input', (e) => { if (dr && dr.d === d) typeStep(dr.ax, e.target); });
    d.el.addEventListener('submit', (e) => { e.preventDefault(); if (dr && dr.d === d && dr.ax.step) run(dr.ax.step, e.target.querySelector('[type="submit"]')); });
  }

  // ── Place an order: one short form for the store, boutiques, shoots, influencer pieces and sales ──
  function openForm() {
    dr?.photos?.destroy?.(); dr = null;
    const f = { kind: '', style: '', q: '', priority: 'medium', done: null };
    const styles = () => data.all('styles').slice().sort((a, b) => String(a.name).localeCompare(String(b.name)));
    const styleList = () => {
      const chosen = data.get('styles', f.style);
      if (chosen) return `<div class="or-chosen"><div><strong>${esc(chosen.name)}</strong><span class="mono">${esc([chosen.code, chosen.shade].filter(Boolean).join(' · '))}</span></div><button type="button" class="btn btn-sm btn-quiet" data-style-clear>Change</button></div>`;
      const all = styles(), q = f.q.trim().toLowerCase(), hits = all.filter((s) => !q || `${s.name} ${s.code}`.toLowerCase().includes(q));
      if (!all.length) return `<div class="or-nostyle"><p>${data.canRead('styles') ? 'There are no styles yet. An order needs one.' : 'Your role cannot see the style list, so an order cannot be placed from here yet. Ask production to place it.'}</p>${data.canWrite('styles') ? '<button type="button" class="btn btn-outline btn-sm" data-add-style>Add a style</button>' : ''}</div>`;
      return hits.length ? `<ul class="or-styles" aria-label="Styles">${hits.slice(0, 40).map((s) => `<li><button type="button" data-style="${s.id}"><strong>${esc(s.name)}</strong><span class="mono">${esc([s.code, s.shade].filter(Boolean).join(' · '))}</span></button></li>`).join('')}</ul>` : '<p class="or-none">No style has that name or code</p>';
    };
    const head = '<header class="drawer-head"><div><p class="eyebrow">New order</p><h2>Place an order</h2></div><button class="icon-btn" type="button" data-close aria-label="Close">×</button></header>';
    if (!styles().length) {   // an order names a style: say what is missing instead of a form that cannot be sent
      const can = data.canRead('styles');
      const none = drawer(`<div class="orders or-drawer">${head}<div class="drawer-body"><section class="empty"><h3>${can ? 'No styles yet' : 'The style list is not open to you'}</h3><p>${can ? 'An order names a style. Add the first style, then place the order.' : 'An order names a style, and your role cannot see styles. Ask production or sales to place this order.'}</p>${data.canWrite('styles') ? '<button type="button" class="btn btn-primary" data-add-style>Add a style</button>' : ''}</section></div></div>`);
      none.el.addEventListener('click', (e) => { if (e.target.closest('[data-add-style]')) { none.close(); ctx.openEntity('styles', { add: true }); } });
      (none.el.querySelector('[data-add-style]') || none.el.querySelector('[data-close]')).focus();
      return;
    }
    const d = drawer(`<div class="orders or-drawer">${head}
      <form class="drawer-body or-form" data-form="place" novalidate>
        <fieldset><legend class="eyebrow">What is it for</legend><div class="or-kinds">${['store', 'boutique', 'shoot', 'influencer', 'customer'].map((k) => `<label class="or-kind"><input type="radio" name="kind" value="${k}"><span><strong>${esc(KIND[k])}</strong><small>${esc(KIND_LINE[k])}</small></span></label>`).join('')}</div></fieldset>
        <div class="field"><label for="orStyleQ">Style</label><input class="input" id="orStyleQ" type="search" autocomplete="off" placeholder="Find a style by name or code" ${styles().length ? '' : 'hidden'}><div data-r="styles">${styleList()}</div></div>
        <div class="or-grid2">
          <div class="field"><label for="orSize">Size</label><input class="input" id="orSize" name="size" type="text" autocomplete="off"><div class="or-chiprow">${SIZES.map((z) => `<button type="button" class="chip or-size" data-size="${z}">${z}</button>`).join('')}</div></div>
          <div class="field"><label for="orColour">Fabric and colour</label><input class="input" id="orColour" name="colour" type="text" autocomplete="off"></div>
          <div class="field"><label for="orQty">Pieces</label><span class="or-qty"><button type="button" data-qty="-1" aria-label="Fewer pieces">−</button><input id="orQty" name="qty" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" value="1"><button type="button" data-qty="1" aria-label="More pieces">+</button></span></div>
          <div class="field"><label for="orBy">Needed by</label><input class="input" id="orBy" name="promised" type="date" min="${iso(today())}"></div>
        </div>
        <div class="field"><p class="eyebrow" id="orPrioL">Priority</p><div class="seg or-prioseg" role="group" aria-labelledby="orPrioL">${Object.entries(PRIO).map(([id, name]) => `<button type="button" data-prio="${id}" aria-pressed="${id === f.priority}">${name}</button>`).join('')}</div></div>
        <div class="field" data-r="reason" hidden><label for="orWhy">Why it is high priority</label><input class="input" id="orWhy" name="priorityReason" type="text" autocomplete="off"></div>
        <div class="field"><label for="orPurpose">Purpose</label><input class="input" id="orPurpose" name="purpose" type="text" autocomplete="off" placeholder="Resort lookbook"></div>
        <div class="field"><label for="orMeas">Measurements and notes</label><textarea class="input" id="orMeas" name="measurements"></textarea></div>
        <div class="or-form-foot"><button type="submit" class="btn btn-primary or-act">Place order</button><p class="error" data-r="err" role="alert"></p></div>
      </form></div>`, { onClose: () => { if (form === f) form = null; } });
    form = f;
    const el2 = d.el, fld = (name) => el2.querySelector(`[name="${name}"]`), err = (msg, focus) => { $('[data-r="err"]', el2).textContent = msg; focus?.focus(); };
    const qty = () => Math.min(30, Math.max(1, parseInt(fld('qty').value, 10) || 1));
    el2.addEventListener('change', (e) => { if (e.target.name === 'kind') f.kind = e.target.value; if (e.target.name === 'qty') e.target.value = qty(); });
    el2.addEventListener('input', (e) => { if (e.target.id === 'orStyleQ') { f.q = e.target.value; $('[data-r="styles"]', el2).innerHTML = styleList(); } });
    el2.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b || form !== f) return;
      const ds = b.dataset;
      if (ds.style) { f.style = ds.style; const s = data.get('styles', f.style); $('#orStyleQ', el2).hidden = true; $('[data-r="styles"]', el2).innerHTML = styleList(); if (s?.shade && !fld('colour').value) fld('colour').placeholder = s.shade; $('[data-style-clear]', el2)?.focus(); }
      else if (ds.styleClear !== undefined) { f.style = ''; $('#orStyleQ', el2).hidden = false; $('[data-r="styles"]', el2).innerHTML = styleList(); $('#orStyleQ', el2).focus(); }
      else if (ds.addStyle !== undefined) { d.close(); ctx.openEntity('styles', { add: true }); }
      else if (ds.size) { fld('size').value = ds.size; el2.querySelectorAll('.or-size').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); }
      else if (ds.qty) fld('qty').value = Math.min(30, Math.max(1, qty() + Number(ds.qty)));
      else if (ds.prio) { f.priority = ds.prio; el2.querySelectorAll('[data-prio]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); $('[data-r="reason"]', el2).hidden = ds.prio !== 'high'; if (ds.prio === 'high') fld('priorityReason').focus(); }
      else if (ds.openSlip) openSlip(ds.openSlip);
      else if (ds.printOrder !== undefined) printOut(slipSheet((f.done?.slips || []).map((x) => data.get('slips', x.id)).filter(Boolean)));
      else if (ds.again !== undefined) openForm();
    });
    el2.addEventListener('submit', (e) => {
      e.preventDefault(); if (form !== f || f.done) return;
      if (!f.kind) return err('Say what the order is for.', el2.querySelector('[name="kind"]'));
      if (!f.style) return err('Choose the style.', $('#orStyleQ', el2));
      if (!fld('promised').value) return err('Give the date it is needed by.', fld('promised'));
      if (f.priority === 'high' && !fld('priorityReason').value.trim()) return err('Say why this is high priority.', fld('priorityReason'));
      err('');
      busy(e.target.querySelector('[type="submit"]'), async () => {
        try {
          const out = await api.act('order.place', { kind: f.kind, style: f.style, size: fld('size').value, colour: fld('colour').value, measurements: fld('measurements').value, qty: qty(), priority: f.priority, priorityReason: fld('priorityReason').value, purpose: fld('purpose').value, promised: fld('promised').value });
          f.done = out.data || { slips: [] };
          if (form !== f) return void toast(out.message);
          $('.or-form', el2).outerHTML = `<div class="drawer-body or-placed"><p class="or-placed-no mono">${esc(f.done.orderNo || '')}</p><p class="or-placed-msg">${esc(out.message)}</p>
            <ul class="or-placed-slips">${(f.done.slips || []).map((x) => `<li><button type="button" data-open-slip="${x.id}">${qrSvg(slipLink(x.no), { size: 56, label: esc(`QR code for slip ${x.no}`) })}<strong class="mono">${esc(x.no)}</strong></button></li>`).join('')}</ul>
            <div class="row"><button type="button" class="btn btn-primary" data-close>Done</button><button type="button" class="btn btn-outline" data-print-order>Print slips</button><button type="button" class="btn btn-quiet" data-again>Place another</button></div></div>`;
          $('[data-close].btn', el2)?.focus(); render();
        } catch (ex) { err(ex.message || 'The order was not placed. Try again.'); }
      });
    });
    el2.querySelector('[name="kind"]')?.focus();
  }

  // ── Many slips at once ──
  async function giveMany(name, btn) {
    name = String(name || '').trim(); if (!name) return focusOn('bar-master');
    const ids = [...st.sel].filter((id) => ['new', 'assigned'].includes(data.get('slips', id)?.status));
    if (!ids.length) return toast('None of the selected slips can be given to a master now.', 'crit');
    await busy(btn, async () => {
      let done = 0, noFabric = 0, last = '', failed = '';
      for (const id of ids) { try { last = (await api.act('slip.assign', { master: name }, { entity: 'slips', id })).message; done++; if (/shows no fabric/.test(last)) noFabric++; } catch (e) { failed = e.message; } }
      if (done) { st.sel.clear(); st.give = false; st.master = ''; }
      toast(done === 1 && !failed ? last : `${plural(done, 'slip is', 'slips are')} with ${name}.${noFabric ? ` The store shows no fabric for ${num(noFabric)} of them.` : ''}${failed ? ` ${failed}` : ''}`, done ? '' : 'crit');
      render();
    });
  }

  root.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b || b.classList.contains('info')) return;
    const d = b.dataset;
    if (d.view) { st.view = d.view; st.who = ''; return render(); }
    if (d.place !== undefined) return openForm();
    if (d.pull !== undefined) return void busy(b, async () => { const out = await api.shopifyPull(); toast(out.message); render(); });
    if (d.import !== undefined) return ctx.go('import');
    if (d.f) { if (st.f.has(d.f)) st.f.delete(d.f); else st.f.add(d.f); st.lane = ''; return render(); }
    if (d.source !== undefined) { st.source = d.source; st.lane = ''; return render(); }
    if (d.clear !== undefined) { st.f.clear(); st.source = ''; st.q = ''; box.value = ''; st.lane = ''; render(); return box.focus(); }
    if (d.lane) { st.lane = d.lane; return render(); }
    if (d.more) { if (st.more.has(d.more)) st.more.delete(d.more); else st.more.add(d.more); return render(); }
    if (d.open) return openSlip(d.open);
    if (d.period) { st.period = d.period; st.who = ''; render(); return focusOn(`per-${d.period}`); }
    if (d.who) { st.who = st.who === d.who ? '' : d.who; return render(); }
    if (d.laneAll) { const l = model().lanes.find((x) => x.id === d.laneAll); if (!l) return; const all = l.slips.every((s) => st.sel.has(s.id)); for (const s of l.slips) { if (all) st.sel.delete(s.id); else st.sel.add(s.id); } return render(); }
    if (d.bar === 'give') { st.give = true; render(); return focusOn('bar-master'); }
    if (d.bar === 'back') { st.give = false; render(); return focusOn('bar-give'); }
    if (d.bar === 'clear') { st.sel.clear(); st.give = false; return render(); }
    if (d.bar === 'print') return printOut(slipSheet([...st.sel].map((id) => data.get('slips', id)).filter(Boolean).sort((a, c) => String(a.no).localeCompare(String(c.no), undefined, { numeric: true }))));
    if (d.give) return void giveMany(d.give, b);
  });
  root.addEventListener('change', (e) => {
    const id = e.target.dataset?.sel; if (!id) return;
    if (e.target.checked) st.sel.add(id); else st.sel.delete(id);
    if (!st.sel.size) st.give = false;
    e.target.closest('.or-card')?.classList.toggle('is-sel', e.target.checked);
    swap(bar, barHtml());
    root.querySelectorAll('[data-lane-all]').forEach((n) => { const l = model().lanes.find((x) => x.id === n.dataset.laneAll); if (l) n.textContent = l.slips.every((s) => st.sel.has(s.id)) ? 'Clear' : 'Select all'; });
  });
  root.addEventListener('input', (e) => {
    if (e.target === box) { st.q = box.value; st.lane = ''; const M = model(); swap(body, boardHtml(M)); }
    else if (e.target.dataset?.barMaster !== undefined) st.master = e.target.value;
  });
  root.addEventListener('submit', (e) => { e.preventDefault(); if (e.target.dataset.form === 'give') giveMany(st.master, e.target.querySelector('[type="submit"]')); });
  root.addEventListener('keydown', (e) => { if (e.key === 'Escape' && st.give) { st.give = false; render(); focusOn('bar-give'); } });

  render();
  // Someone followed a notice or scanned a slip's code without a scan role: open that slip here.
  const want = ctx.route?.slip || ctx.opts?.slip;
  if (want) { const s = data.all('slips').find((x) => same(x.no, want)); if (s) openSlip(s.id); else toast(`No slip has the number ${String(want).slice(0, 30)}.`, 'crit'); }
  const off = data.on(refresh);
  return () => { off(); gone = true; stopPrint?.(); dr?.photos?.destroy?.(); window.removeEventListener('pointerdown', onDown, true); window.removeEventListener('pointerup', onUp, true); window.removeEventListener('pointercancel', onUp, true); };
}

// ───────────────────────── The scan page ─────────────────────────
function mountScan(el, ctx) {
  const P = perms();
  const canCam = 'BarcodeDetector' in window && !!navigator.mediaDevices?.getUserMedia;
  el.innerHTML = `<div class="workspace orders or-scan"><div class="workspace-inner" id="orScan">
    <div class="view-head"><div class="title-row"><h1 class="reveal">Scan a slip</h1>${info('Scan the code on a slip with a scanner or the camera, or type its number. The screen shows the piece and your next step. Press the large button to record it.', 'Scan a slip')}</div></div>
    <form class="or-scanbox" data-form="code" novalidate>
      <label class="eyebrow" for="orCode">Slip</label>
      <div class="or-scanrow"><input class="input or-code" id="orCode" type="text" autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false" enterkeyhint="go" placeholder="Scan or type"><button type="submit" class="btn btn-primary" id="orGo">Open</button></div>
      ${canCam ? '<button type="button" class="btn btn-outline or-camgo" id="orCamGo">Scan with camera</button>' : ''}
      <div class="or-cam" id="orCam" hidden><video playsinline muted aria-label="Camera"></video><button type="button" class="btn btn-primary" id="orCamStop">Stop camera</button></div>
    </form>
    <div id="orResult" role="status" aria-live="polite"></div>
    <div id="orSlip"></div>
    <section class="or-recent" id="orRecent" aria-label="Slips you handled"></section></div></div>`;
  const root = $('#orScan', el), input = $('#orCode', root), slipBox = $('#orSlip', root), resBox = $('#orResult', root), recBox = $('#orRecent', root), camBox = $('#orCam', root), video = $('video', camBox);
  const key = `${LS_RECENT}-${data.user?.id || ''}`;
  const sc = { id: '', ax: freshAx(), result: null, typed: false };
  const say = (tone, head, text, more = {}) => { sc.result = { tone, head, text, at: new Date(), ...more }; };
  const DID = { assign: 'Given to a master', missing: 'Marked as missing', rework: 'Sent back for rework', fail: 'Rejected' };
  let recent = recall(key, []); if (!Array.isArray(recent)) recent = [];
  let gone = false, cam = null, down = false, later = false;
  const onDown = () => { down = true; };
  const onUp = () => { down = false; if (later) { later = false; setTimeout(paint, 0); } };
  window.addEventListener('pointerdown', onDown, true); window.addEventListener('pointerup', onUp, true); window.addEventListener('pointercancel', onUp, true);
  // A scanner needs the box focused. On a phone the keyboard would cover the slip, so focus returns only where someone typed.
  const refocus = () => { if (sc.typed || matchMedia('(pointer: fine)').matches) input.focus({ preventScroll: true }); };

  /** The slip a scanned or typed code means: the link in the QR code, the slip number, or just its digits. */
  function find(raw) {
    const t = String(raw ?? '').trim(), no = (/slip-([A-Za-z]+-\d+)/i.exec(t)?.[1] || t).toUpperCase();
    return { no, slip: data.all('slips').find((s) => same(s.no, no) || (/^\d+$/.test(no) && Number(String(s.no).replace(/\D/g, '')) === Number(no))) };
  }
  async function open(raw) {
    let { no, slip } = find(raw);
    if (!no) { say('crit', 'Nothing scanned', 'Scan the code on the slip, or type its number.'); return paint(); }
    if (!slip) { try { await data.refresh(['slips']); } catch { /* offline: the answer below still holds */ } slip = find(raw).slip; }
    if (gone) return;
    stopCam(); input.value = ''; sc.ax = freshAx();
    if (!slip) { sc.id = ''; say('crit', 'Not found', `No slip has the number ${no.slice(0, 30)}. Check the slip and scan again.`); paint(); return refocus(); }
    sc.id = slip.id; sc.result = null; paint();
    slipBox.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    const acts = slipBox.querySelectorAll('.or-acts .or-act');
    if (acts.length === 1) acts[0].focus({ preventScroll: true });   // one clear next step: Enter does it. A verdict is never one keypress away.
  }

  function slipHtml(s) {
    const due = dueOf(s), fact = (label, value, cls = '') => (value ? `<div class="${cls}"><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>` : '');
    const acts = actsHtml(s, P, sc.ax, 'scan');
    const idle = s.noFabric && P.tailor ? `Stopped: missing ${s.stuck || 'fabric'}. Tell the floor manager.` : s.status === 'new' && P.tailor ? 'Not given to a master yet.' : `${STATUS[s.status] || s.status}. Nothing for you to do on this slip.`;
    return `<article class="or-ticket is-${laneOf(s).id}">
        <header><strong class="mono">${esc(s.no)}</strong>${prioHtml(s)}<button type="button" class="icon-btn" data-drop data-fk="drop" aria-label="Put this slip away">×</button></header>
        ${marksHtml(s)}
        <h2>${esc(pieceName(s))}</h2>
        <dl class="or-ticket-facts">${fact('Size', s.size, 'big')}${fact('Needed by', s.promised ? `${fmtDate(day(s.promised))}${due.late ? ' · late' : ''}` : '', `big ${due.late ? 'is-late' : ''}`)}${fact('Fabric and colour', s.colour)}${fact('Order', s.orderNo)}${fact('For', [KIND[s.kind] !== pieceName(s) ? KIND[s.kind] : '', s.purpose].filter(Boolean).join(' · '))}${fact('Customer', s.customerName)}${fact('Master', s.master)}${s.priority === 'high' ? fact('Why high', s.priorityReason) : ''}</dl>
        ${s.measurements ? `<div class="or-notes"><p class="eyebrow">Measurements and notes</p><p>${esc(s.measurements)}</p></div>` : ''}
        <div class="or-ticket-at">${stripHtml(s)}<span>${esc(STATUS[s.status] || s.status)}</span></div>
      </article>
      ${acts || `<div class="or-idle"><p>${esc(idle)}</p>${P.place ? '<button type="button" class="btn btn-outline" data-board data-fk="board">Open on the board</button>' : ''}</div>`}`;
  }
  function paint() {
    if (gone) return;
    if (down) { later = true; return; }
    const s = sc.id ? data.get('slips', sc.id) : null;
    if (s && sc.ax.step && !actionsFor(s, P, 'scan').some((a) => a.k === sc.ax.step)) sc.ax = freshAx();
    const r = sc.result;
    swap(resBox, r ? `<div class="or-result" data-tone="${r.tone}"><p class="eyebrow">${esc(r.head)} · ${esc(fmtTime(r.at))}</p><p class="or-result-text">${esc(r.text)}</p>${r.again ? `<button type="button" class="btn btn-outline" data-again="${esc(r.again)}" data-fk="again">${esc(r.againLabel)}</button>` : ''}</div>` : '');
    swap(slipBox, s ? slipHtml(s) : (r ? '' : `<div class="or-wait"><span class="or-wait-qr" aria-hidden="true">${qrSvg('SLIP', { size: 84, label: '' })}</span><p>Scan a slip to see the piece and your next step.</p></div>`));
    swap(recBox, recent.length ? `<h2 class="sect">Handled here</h2><ul>${recent.map((x) => `<li><button type="button" data-again="${esc(x.no)}" data-fk="rec-${esc(x.no)}"><strong class="mono">${esc(x.no)}</strong><span>${esc(x.did)}</span><time>${esc(fmtTime(new Date(x.at)))}</time></button></li>`).join('')}</ul>` : '');
  }
  async function run(k, btn, label) {
    const s = data.get('slips', sc.id); if (!s) return;
    await busy(btn, async () => {
      try {
        const out = await send(k, s, sc.ax), no = out.data?.no || s.no, now = data.get('slips', s.id);
        recent = [{ no, did: label, at: new Date().toISOString() }, ...recent.filter((x) => x.no !== no)].slice(0, 6); remember(key, recent);
        const more = now ? actionsFor(now, P, 'scan').length > 0 : false;
        say('ok', label, out.message || `${no} is recorded.`, { again: more ? no : '', againLabel: k === 'qcIn' ? 'Check this piece now' : `Open ${no} again` });
        sc.id = ''; sc.ax = freshAx();
      } catch (e) {
        say('crit', 'Not done', e.message || 'Something went wrong. Scan again.');
        if (e.status === 401) setTimeout(() => location.reload(), 1500);   // the session ended: back to sign-in
      }
    });
    down = false; paint();
    resBox.scrollIntoView({ block: 'nearest' }); refocus();
  }

  // ── The camera, where the browser can read codes itself ──
  function stopCam() {
    if (cam) { clearInterval(cam.timer); cam.stream.getTracks().forEach((t) => t.stop()); cam = null; }
    video.srcObject = null; camBox.hidden = true;
    const go = $('#orCamGo', root); if (go) go.hidden = false;
  }
  async function startCam(btn) {
    await busy(btn, async () => {
      try {
        const det = new window.BarcodeDetector({ formats: ['qr_code'] });
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
        if (gone) { stream.getTracks().forEach((t) => t.stop()); return; }
        const c = { stream, busy: false, timer: 0 }; cam = c;   // set before anything else waits, so leaving the screen can stop it
        video.srcObject = stream; camBox.hidden = false; btn.hidden = true;
        await video.play().catch(() => {});
        if (cam !== c) return;
        c.timer = setInterval(async () => {
          if (c.busy || cam !== c || video.readyState < 2) return;
          c.busy = true;
          try { const hit = (await det.detect(video)).find((h) => h.rawValue); if (hit && cam === c) { stopCam(); sc.typed = false; open(hit.rawValue); } } catch { /* a frame that could not be read: try the next */ }
          c.busy = false;
        }, 250);
        $('#orCamStop', root).focus({ preventScroll: true });
      } catch (e) {
        stopCam();
        say('crit', 'Camera', e?.name === 'NotAllowedError' ? 'The camera is not allowed on this device. Type the number on the slip instead.' : 'The camera could not start. Type the number on the slip instead.');
        paint();
      }
    });
  }

  root.addEventListener('submit', (e) => {
    e.preventDefault();
    if (e.target.dataset.form === 'code') { sc.typed = true; return void open(input.value); }
    if (e.target.dataset.form === 'step' && sc.ax.step) run(sc.ax.step, e.target.querySelector('[type="submit"]'), DID[sc.ax.step] || 'Done');
  });
  root.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b || b.classList.contains('info')) return;
    const d = b.dataset, s = data.get('slips', sc.id);
    if (b.id === 'orCamGo') return void startCam(b);
    if (b.id === 'orCamStop') { stopCam(); return refocus(); }
    if (d.again) return void open(d.again);
    if (d.drop !== undefined) { sc.id = ''; sc.ax = freshAx(); paint(); return input.focus(); }
    if (d.board !== undefined && s) return ctx.go('orders', { slip: s.no });
    if (!s) return;
    if (d.act) { if (STEPS.includes(d.act)) { openStep(sc.ax, d.act, s); paint(); slipBox.querySelector('.or-step')?.scrollIntoView({ block: 'nearest' }); } else run(d.act, b, b.textContent); return; }
    if (d.actBack !== undefined) { sc.ax = freshAx(); return paint(); }
    if (d.master) { sc.ax.master = d.master; return void run('assign', b, `Given to ${d.master}`); }
    if (d.reason) { sc.ax.reason = d.reason; paint(); }
  });
  root.addEventListener('input', (e) => typeStep(sc.ax, e.target));
  // A handheld scanner types the code and presses Enter. With a large button in focus, that Enter
  // must open the scanned slip, never press the button for the slip that was on screen before.
  let burst = '', burstAt = 0;
  const onKey = (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    const now = performance.now();
    if (e.key === 'Enter') { const code = burst; burst = ''; if (code.length >= 4 && now - burstAt < 120) { e.preventDefault(); e.stopPropagation(); sc.typed = true; open(code); } return; }
    if (e.key.length !== 1) return;
    burst = now - burstAt < 60 ? burst + e.key : e.key; burstAt = now;
  };
  window.addEventListener('keydown', onKey, true);

  paint();
  if (ctx.route?.slip) open(ctx.route.slip); else input.focus({ preventScroll: true });
  const off = data.on(paint);
  return () => { off(); gone = true; stopCam(); window.removeEventListener('keydown', onKey, true); window.removeEventListener('pointerdown', onDown, true); window.removeEventListener('pointerup', onUp, true); window.removeEventListener('pointercancel', onUp, true); };
}
