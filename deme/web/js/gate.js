// Dispatch gate: one place to scan every parcel out and every return or store piece in.
// The scan itself is one action; the lists below are for people who can read parcels.

import { api, data } from './api.js';
import { info, esc, busy, statusTag, fmtStamp, num, $ } from './ui.js';
import { iso, today, fmtTime } from '../shared/util.js';

const KIND = { shopify: 'Shopify parcel', b2b: 'B2B cartons', store: 'Store piece' };
const EVENT = { pack: ['Packed', 'plain'], out: ['Out', 'info'], in: ['In', 'warn'], carrier: ['Carrier', 'plain'] };
const SHOWN = 40; // rows drawn per list
const OUT = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M4 12h15M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const IN = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M20 12H5M11 6l-6 6 6 6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const norm = (s) => String(s ?? '').trim().toLowerCase();
const when = (at) => (iso(at) === iso(today()) ? fmtTime(at) : fmtStamp(at));
const lastEvent = (p, type) => [...(p.events || [])].reverse().find((e) => !type || e.type === type);
const what = (p) => `${KIND[p.kind] || 'Parcel'} for order ${p.ref}`;

export function mount(el, ctx) {
  const reads = data.canRead('parcels');
  const canOpen = data.can('logistics', 'read');
  const storeOrder = (p) => (data.canRead('store_orders') ? data.all('store_orders').find((o) => norm(o.tag) === norm(p.barcode)) : null);

  el.innerHTML = `
    <div class="workspace work"><div class="workspace-inner">
      <div class="view-head">
        <div class="title-row"><h1 class="reveal">Dispatch gate</h1>${info('A handheld scanner or a camera reader types into this box and presses Enter. The barcode is the courier\'s tracking barcode on the label, or Deme\'s own tag on store pieces.', 'Dispatch gate')}</div>
      </div>
      <div class="gt-cols${reads ? '' : ' is-one'}">
        <div class="gt-col">
          <form class="panel wk-edge gt-scan" id="gtForm" novalidate>
            <div class="field"><label for="gtBarcode">Barcode</label><input class="input wk-scan-input" id="gtBarcode" type="text" autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false" enterkeyhint="go" placeholder="Scan the label"></div>
            <p class="gt-plan" id="gtPlan" hidden></p>
            <div class="field" id="gtNoteWrap" ${reads ? 'hidden' : ''}><label for="gtNote" id="gtNoteLabel">What needs doing</label><input class="input gt-extra" id="gtNote" type="text" autocomplete="off">${reads ? '' : '<span class="hint">Store piece coming in</span>'}</div>
            <div class="field" id="gtMinWrap" ${reads ? 'hidden' : ''}><label for="gtMinutes">Work minutes</label><input class="input num gt-extra" id="gtMinutes" type="number" min="0" step="1" inputmode="numeric">${reads ? '' : '<span class="hint">Store piece going out</span>'}</div>
            <button type="submit" class="btn btn-primary wk-bigbtn" id="gtGo">Scan</button>
          </form>
          <div id="gtResult" role="status" aria-live="polite"></div>
        </div>
        ${reads ? '<div class="gt-col" id="gtLists"></div>' : ''}
      </div>
    </div></div>`;

  const input = $('#gtBarcode', el), planEl = $('#gtPlan', el), note = $('#gtNote', el), minutes = $('#gtMinutes', el);
  const noteWrap = $('#gtNoteWrap', el), minWrap = $('#gtMinWrap', el);
  const focus = () => input.focus({ preventScroll: true });

  /** What scanning this parcel will do, and which extra field it calls for. */
  function plan(p) {
    if (!p) return { text: 'No parcel has this barcode', tone: 'warn' };
    if (p.kind === 'shopify') {
      if (p.status === 'packed') return { text: `${what(p)}: will be scanned out`, dir: 'out' };
      if (p.status === 'at_factory') return { text: `${what(p)}: already scanned in as a return`, tone: 'warn' };
      return { text: `${what(p)}: will be scanned in as a return`, dir: 'in', field: 'note', label: 'Condition on arrival' };
    }
    if (p.kind === 'b2b') return p.status === 'packed' ? { text: `${what(p)}: will be scanned out`, dir: 'out' } : { text: `${what(p)}: already scanned out`, tone: 'warn' };
    if (p.kind === 'store') {
      if (p.status === 'packed') return { text: `${what(p)}: will go out to the store`, dir: 'out' };
      if (p.status === 'at_store') { const o = storeOrder(p); return { text: `${what(p)}: will be scanned in${o ? ` for fit visit ${num((o.visits || 0) + 1)}` : ''}`, dir: 'in', field: 'note', label: 'What needs doing' }; }
      if (p.status === 'at_factory') return { text: `${what(p)}: will go back to the store`, dir: 'out', field: 'minutes' };
    }
    return { text: `${what(p)}: cannot be scanned right now`, tone: 'warn' };
  }
  const current = () => { const key = norm(input.value); return key ? plan(data.all('parcels').find((p) => norm(p.barcode) === key)) : null; };

  function preview() {
    if (!reads) return;
    const pl = current();
    planEl.hidden = !pl;
    if (pl) planEl.innerHTML = `<span class="tag tag-${pl.tone || 'info'}">${pl.dir === 'out' ? 'Out' : pl.dir === 'in' ? 'In' : 'Check'}</span><span>${esc(pl.text)}</span>`;
    noteWrap.hidden = pl?.field !== 'note';
    minWrap.hidden = pl?.field !== 'minutes';
    if (pl?.field === 'note') $('#gtNoteLabel', el).textContent = pl.label;
  }

  function showResult(html) { $('#gtResult', el).innerHTML = html; }
  function success(out) {
    const p = out.data?.parcel, dir = out.data?.direction === 'in' ? 'in' : 'out';
    const trail = [...(p?.events || [])].sort((a, b) => String(b.at).localeCompare(String(a.at)));
    showResult(`
      <div class="wk-result gt-result" data-tone="ok">
        <div class="gt-result-head"><span class="gt-dir">${dir === 'in' ? IN : OUT}<span>${dir === 'in' ? 'Scanned in' : 'Scanned out'}</span></span><span class="eyebrow">${esc(fmtTime(new Date()))}</span></div>
        <p class="wk-result-text">${esc(out.message || 'Scanned.')}</p>
        ${p ? `<div class="gt-result-parcel"><span class="mono">${esc(p.barcode)}</span><span class="faint">${esc([KIND[p.kind], p.ref, p.no].filter(Boolean).join(' · '))}</span>${statusTag('parcels', p.status)}${canOpen ? `<button type="button" class="btn btn-sm btn-quiet" data-open="${esc(p.id)}">Open</button>` : ''}</div>` : ''}
        ${trail.length ? `<ol class="gt-trail" aria-label="Trail, newest first">${trail.map((e) => { const [name, tone] = EVENT[e.type] || [e.type || 'Note', 'plain']; return `<li><span class="gt-trail-at">${esc(fmtStamp(e.at))}</span><span class="tag tag-${tone}">${esc(name)}</span><span>${esc(e.text || '')}</span></li>`; }).join('')}</ol>` : ''}
      </div>`);
  }
  const failure = (text) => showResult(`<div class="wk-result" data-tone="crit"><p class="eyebrow">Not scanned · ${esc(fmtTime(new Date()))}</p><p class="wk-result-text">${esc(text)}</p></div>`);

  // ───────── Lists ─────────
  function renderLists() {
    if (!reads) return;
    const parcels = data.all('parcels');
    const newest = (type) => (a, b) => String(lastEvent(b, type)?.at || b.updatedAt || '').localeCompare(String(lastEvent(a, type)?.at || a.updatedAt || ''));
    const row = (p, sub, end = '') => `<li class="gt-row">
        <button type="button" class="gt-pick" data-fill="${esc(p.barcode)}"><strong>${esc(p.barcode)}</strong><span class="gt-sub">${esc(sub.filter(Boolean).join(' · '))}</span></button>
        ${end}${canOpen ? `<button type="button" class="btn btn-sm btn-quiet" data-open="${esc(p.id)}" aria-label="Open parcel ${esc(p.no || p.barcode)}">Open</button>` : ''}
      </li>`;
    const panel = (id, title, about, list, each, none) => `
      <section class="panel gt-panel" aria-labelledby="${id}">
        <div class="panel-head"><div class="title-row"><h2 id="${id}">${title}</h2>${info(about, title)}</div>${list.length ? `<span class="wk-n">${esc(num(list.length))}</span>` : ''}</div>
        ${list.length ? `<ul class="gt-list">${list.slice(0, SHOWN).map(each).join('')}</ul>${list.length > SHOWN ? `<p class="wk-none">${esc(num(SHOWN))} of ${esc(num(list.length))} shown.${canOpen ? ' <button type="button" class="link" data-all>Open all parcels</button>' : ''}</p>` : ''}` : `<p class="wk-none">${none}</p>`}
      </section>`;
    const packed = parcels.filter((p) => p.status === 'packed').sort(newest('pack'));
    const atFactory = parcels.filter((p) => p.kind === 'store' && p.status === 'at_factory').sort(newest('in'));
    const moving = parcels.filter((p) => p.status === 'in_transit' || p.status === 'returning').sort(newest('out'));
    $('#gtLists', el).innerHTML =
      panel('gtPackedH', 'Packed, waiting for scan', 'Parcels and store pieces that are ready and have not passed the gate. Tap a row to put its barcode in the box, then scan.', packed,
        (p) => row(p, [KIND[p.kind], `Order ${p.ref}`, p.dest, lastEvent(p, 'pack') ? `packed ${when(lastEvent(p, 'pack').at)}` : '']), 'Nothing is waiting for a scan.')
      + panel('gtStoreH', 'Store pieces at the factory', 'Pieces from the store that are in for a fit or an alteration. Each trip in is counted as a visit on the store order. Scan the piece again when it leaves.', atFactory,
        (p) => { const o = storeOrder(p); return row(p, [`Order ${p.ref}`, o?.customerName, lastEvent(p, 'in') ? `in since ${when(lastEvent(p, 'in').at)}` : ''], o ? `<span class="tag tag-${(o.visits || 0) > 2 ? 'warn' : 'plain'}">${esc(`Visit ${num(o.visits || 0)}`)}</span>` : ''); }, 'No store pieces are at the factory.')
      + panel('gtMovingH', 'In transit', 'Parcels that have left and are not yet marked delivered. Scan one here if it comes back.', moving,
        (p) => row(p, [KIND[p.kind], `Order ${p.ref}`, data.title('suppliers', p.carrier), p.dest, lastEvent(p, 'out') ? `out ${when(lastEvent(p, 'out').at)}` : '']), 'Nothing is in transit.');
  }

  // ───────── Events ─────────
  input.addEventListener('input', preview);
  $('#gtForm', el).addEventListener('submit', (e) => {
    e.preventDefault();
    const barcode = input.value.trim();
    if (!barcode) { failure('Scan or type the barcode on the parcel.'); focus(); return; }
    // A scanner presses Enter straight after the barcode: stop once at the extra field this parcel calls for.
    const pl = reads ? current() : null, extra = pl?.field === 'note' ? note : pl?.field === 'minutes' ? minutes : null;
    if (extra && document.activeElement === input && extra.value === '') { extra.focus(); return; }
    const payload = { barcode, note: noteWrap.hidden ? '' : note.value.trim(), workMinutes: minWrap.hidden || minutes.value === '' ? undefined : Number(minutes.value) };
    busy($('#gtGo', el), async () => {
      try { success(await api.act('gate.scan', payload)); } catch (err) {
        failure(err.message || 'Something went wrong. Scan again.');
        if (err.status === 401) setTimeout(() => location.reload(), 1500); // the session ended: back to sign-in
      }
      input.value = ''; note.value = ''; minutes.value = '';
      preview(); focus();
    });
  });
  el.addEventListener('click', (e) => {
    const fill = e.target.closest('[data-fill]'), open = e.target.closest('[data-open]');
    if (fill) { input.value = fill.dataset.fill; preview(); focus(); el.querySelector('.workspace').scrollTo({ top: 0 }); }
    else if (open) ctx.openEntity('parcels', { id: open.dataset.open });
    else if (e.target.closest('[data-all]')) ctx.openEntity('parcels');
  });

  const refresh = () => { renderLists(); preview(); };
  refresh();
  focus();
  return data.on(refresh);
}
