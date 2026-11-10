// Scan station: tailors and masters scan a bundle when they start it and again when it is done.
// Their role cannot read any list, so the station works from what each scan returns and from
// what this device remembers. People who can read bundles and scans also see the floor below.

import { api, data } from './api.js';
import { info, esc, busy, num, fmtStamp, $ } from './ui.js';
import { iso, today, fmtTime } from '../shared/util.js';

const LS_STATION = 'deme-scan-station', LS_STARTED = 'deme-scan-started';
const remember = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage blocked: this visit only */ } };
const recall = (key, fallback) => { try { const v = JSON.parse(localStorage.getItem(key)); return v ?? fallback; } catch { return fallback; } };
const norm = (s) => String(s ?? '').trim().toLowerCase();
const plural = (n, one, many = `${one}s`) => `${num(n)} ${n === 1 ? one : many}`;
const since = (at) => (iso(at) === iso(today()) ? fmtTime(at) : fmtStamp(at));

export function mount(el) {
  let station = String(recall(LS_STATION, '') || '');
  let started = recall(LS_STARTED, []);
  if (!Array.isArray(started)) started = [];
  const floor = data.canRead('bundles') && data.canRead('scans');

  el.innerHTML = `
    <div class="workspace work"><div class="workspace-inner">
      <div class="view-head">
        <div class="title-row"><h1 class="reveal">Scan station</h1>${info('Scan the tag on a bundle when you pick it up, and again when it is finished. A handheld scanner types the number into the box and presses Enter. Enter finishes a bundle that was started on this device and starts any other.', 'Scan station')}</div>
      </div>
      <div class="sc-wrap">
        <form class="panel wk-edge sc-station" id="scForm" novalidate>
          <div class="field"><label for="scStation">Station</label><input class="input sc-station-input" id="scStation" type="text" autocomplete="off" value="${esc(station)}"></div>
          <div class="field"><label for="scBundle">Bundle</label><input class="input wk-scan-input" id="scBundle" type="text" autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false" enterkeyhint="go" placeholder="Scan the tag"></div>
          <div class="sc-actions">
            <button type="button" class="btn btn-primary wk-bigbtn" id="scStart">Start bundle</button>
            <button type="button" class="btn wk-bigbtn" id="scFinish">Finish bundle</button>
          </div>
        </form>
        <div id="scResult" role="status" aria-live="polite"></div>
        <section class="panel" aria-labelledby="scStartedH">
          <div class="panel-head"><div class="title-row"><h2 id="scStartedH">Started on this device</h2>${info('Bundles started from this tablet or phone and not yet scanned as finished. The list is kept on this device only.', 'Started on this device')}</div><span class="wk-n" id="scStartedN"></span></div>
          <div id="scStarted"></div>
        </section>
      </div>
      ${floor ? '<div class="sc-floor" id="scFloor"></div>' : ''}
    </div></div>`;

  const input = $('#scBundle', el), startBtn = $('#scStart', el), finishBtn = $('#scFinish', el);
  const focus = () => input.focus({ preventScroll: true });
  const entry = (tag) => started.find((s) => norm(s.no) === norm(tag) || s.id === String(tag).trim());

  /** The button Enter will press wears the main-action style. */
  function mark() {
    const finishing = !!entry(input.value);
    startBtn.classList.toggle('btn-primary', !finishing);
    finishBtn.classList.toggle('btn-primary', finishing);
  }

  function renderStarted() {
    $('#scStartedN', el).textContent = started.length ? num(started.length) : '';
    $('#scStarted', el).innerHTML = started.length
      ? `<ul class="sc-list">${started.map((s) => `<li>
          <div class="sc-row-main"><strong>${esc(s.no)}</strong><span class="sc-row-sub">${esc([s.pieces ? plural(s.pieces, 'piece') : '', s.station, s.at ? `since ${since(s.at)}` : ''].filter(Boolean).join(' · '))}</span></div>
          <button type="button" class="btn btn-outline sc-fin" data-finish="${esc(s.no)}">Finish</button>
          <button type="button" class="icon-btn" data-forget="${esc(s.no)}" aria-label="Take ${esc(s.no)} off this list">×</button>
        </li>`).join('')}</ul>`
      : '<p class="wk-none">No bundle is open on this device.</p>';
  }

  function result(tone, head, text) {
    $('#scResult', el).innerHTML = `<div class="wk-result" data-tone="${tone}"><p class="eyebrow">${esc(head)} · ${esc(fmtTime(new Date()))}</p><p class="wk-result-text">${esc(text)}</p></div>`;
  }

  async function run(kind, raw, btn) {
    const tag = String(raw ?? '').trim();
    if (!tag) { result('crit', 'Not done', 'Scan or type the bundle tag.'); focus(); return; }
    await busy(btn, async () => {
      try {
        const out = kind === 'start' ? await api.act('scan.start', { bundle: tag, station }) : await api.act('scan.finish', { bundle: tag });
        const b = out.data?.bundle || {};
        const no = b.no || tag;
        started = started.filter((s) => norm(s.no) !== norm(no) && norm(s.no) !== norm(tag));
        if (kind === 'start') started.unshift({ no, id: b.id || '', pieces: b.pieces || 0, station, at: new Date().toISOString() });
        remember(LS_STARTED, started);
        result('ok', kind === 'start' ? 'Started' : 'Finished', out.message || (kind === 'start' ? `Started bundle ${no}.` : `Finished bundle ${no}.`));
      } catch (e) {
        result('crit', 'Not done', e.message || 'Something went wrong. Scan again.');
        if (e.status === 401) setTimeout(() => location.reload(), 1500); // the session ended: back to sign-in
      }
    });
    input.value = ''; mark(); renderStarted(); focus();
  }

  // ───────── The floor, for people who can read bundles and scans ─────────
  function renderFloor() {
    if (!floor) return;
    const scans = data.all('scans');
    const live = data.all('bundles').filter((b) => b.status === 'stitching').map((b) => ({ b, at: scans.filter((s) => s.bundle === b.id && !s.finishedAt).map((s) => s.startedAt).sort().pop() || b.updatedAt })).sort((x, y) => String(x.at).localeCompare(String(y.at)));

    const byStyle = new Map();
    for (const s of scans) {
      if (!s.finishedAt || !(s.minutes > 0) || !(s.pieces > 0)) continue;
      const g = byStyle.get(s.style) || { minutes: 0, pieces: 0, scans: 0 };
      g.minutes += s.minutes; g.pieces += s.pieces; g.scans += 1; byStyle.set(s.style, g);
    }
    const rows = [...byStyle.entries()].map(([id, g]) => {
      const std = Number(data.get('styles', id)?.smvStitch) || 0, actual = g.minutes / g.pieces;
      return { name: data.title('styles', id) || 'Style', std, actual, gap: std > 0 ? (actual - std) / std : null, scans: g.scans };
    }).sort((a, b) => (b.gap ?? -Infinity) - (a.gap ?? -Infinity));
    const gapText = (g) => (g === null ? '<span class="faint">–</span>' : esc(`${g > 0 ? '+' : g < 0 ? '−' : ''}${Math.abs(Math.round(g * 100))}%`));

    $('#scFloor', el).innerHTML = `
      <section class="panel" aria-labelledby="scLiveH">
        <div class="panel-head"><h2 id="scLiveH">Being stitched now</h2>${live.length ? `<span class="wk-n">${esc(num(live.length))}</span>` : ''}</div>
        ${live.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Bundle</th><th>Work order</th><th>Station</th><th>Tailor</th><th>Since</th></tr></thead>
          <tbody>${live.map(({ b, at }) => `<tr><td class="mono">${esc(b.no)}</td><td>${esc(data.title('work_orders', b.workOrder) || '–')}</td><td>${esc(b.station || '–')}</td><td>${esc(data.title('users', b.operator) || '–')}</td><td>${at ? esc(since(at)) : '–'}</td></tr>`).join('')}</tbody></table></div>`
    : '<p class="wk-none">No bundle is being stitched right now.</p>'}
      </section>
      <section class="panel" aria-labelledby="scPaceH">
        <div class="panel-head"><div class="title-row"><h2 id="scPaceH">Minutes per piece</h2>${info('For each style: the minutes of every finished bundle scan added up and divided by the pieces in those bundles, set against the stitching minutes on the style. A style running more than 10% over its standard is flagged.', 'Minutes per piece')}</div></div>
        ${rows.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Style</th><th class="num">Standard</th><th class="num">Actual</th><th class="num">Gap</th><th class="num">Scans</th><th></th></tr></thead>
          <tbody>${rows.map((r) => `<tr><td>${esc(r.name)}</td><td class="num">${r.std ? esc(num(r.std, 2)) : '<span class="faint">–</span>'}</td><td class="num">${esc(num(r.actual, 2))}</td><td class="num">${gapText(r.gap)}</td><td class="num">${esc(num(r.scans))}</td><td>${r.gap !== null && r.gap > 0.1 ? '<span class="tag tag-warn">Over standard</span>' : ''}</td></tr>`).join('')}</tbody></table></div>`
    : '<p class="wk-none">No finished scans yet.</p>'}
      </section>`;
  }

  /** Where bundles can be read, drop any this device still lists that are no longer being stitched. */
  function prune() {
    if (!data.canRead('bundles') || !started.length) return;
    const stitching = new Set(data.all('bundles').filter((b) => b.status === 'stitching').map((b) => norm(b.no)));
    const kept = started.filter((s) => stitching.has(norm(s.no)));
    if (kept.length !== started.length) { started = kept; remember(LS_STARTED, started); }
  }

  $('#scForm', el).addEventListener('submit', (e) => { e.preventDefault(); const finishing = !!entry(input.value); run(finishing ? 'finish' : 'start', input.value, finishing ? finishBtn : startBtn); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#scForm', el).requestSubmit(); } });
  input.addEventListener('input', mark);
  startBtn.addEventListener('click', () => run('start', input.value, startBtn));
  finishBtn.addEventListener('click', () => run('finish', input.value, finishBtn));
  $('#scStation', el).addEventListener('input', (e) => { station = e.target.value.trim(); remember(LS_STATION, station); });
  $('#scStation', el).addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); focus(); } });
  $('#scStarted', el).addEventListener('click', (e) => {
    const fin = e.target.closest('[data-finish]'), forget = e.target.closest('[data-forget]');
    if (fin) run('finish', fin.dataset.finish, fin);
    else if (forget) { started = started.filter((s) => norm(s.no) !== norm(forget.dataset.forget)); remember(LS_STARTED, started); renderStarted(); mark(); focus(); }
  });

  const refresh = () => { prune(); renderStarted(); renderFloor(); mark(); };
  refresh();
  focus();
  return data.on(refresh);
}
