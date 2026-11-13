// Dye house: built for a phone held in one hand. The lots that are out for dyeing and the fabric
// the mill delivered straight there; tap one to report a problem with photos. An outside dye-house
// login cannot read any list, so everything here comes from what `fabric.myLots` returns and from
// what this phone has sent. the business's own people also pass or inspect waiting rolls and see the reports.

import { api, data } from './api.js';
import { $, esc, info, toast, busy, num, fmtDate, fmtStamp, statusTag } from './ui.js';
import { iso, today, fmtTime, DAY } from '../shared/util.js';
import { INSPECTION_PASS_MARK, FABRIC_REASONS } from '../shared/schema.js';
import { mountPhotos, photoQueue } from './photos.js';

const TK = ['kickoff', 'lists', 'stock', 'inward', 'floor', 'dispatch', 'finance', 'run'];
const SHOWN = 20; // reports drawn
const plural = (n, one, many = `${one}s`) => `${num(n, 1)} ${n === 1 ? one : many}`;
const day = (s) => fmtDate(`${s}T00:00:00`);
const daysTo = (s, from) => Math.round((new Date(`${s}T00:00:00`) - new Date(`${from}T00:00:00`)) / DAY);
const metres = (rolls) => rolls.reduce((s, r) => s + (Number(r.metres) || 0), 0);
// Colour words in a shade name, each matched to the nearest token. A shade with none of them gets one of the track colours.
const HUES = [
  [/white|ivory|cream|ecru|natural|off.?white|chalk/, 'surface-3', 1], [/black|charcoal|jet/, 'ink'], [/gr[ae]y|\bash\b|slate|silver/, 'ink-3'],
  [/olive|khaki|moss|sage/, 'tk-run'], [/teal|jade|aqua|turquoise|mint/, 'tk-floor'], [/green|emerald|forest|leaf/, 'ok'],
  [/navy|indigo|royal|cobalt/, 'tk-kickoff'], [/blue|\bsky\b|denim|\bink\b/, 'material'], [/\bsea\b|ocean|petrol/, 'tk-finance'],
  [/purple|violet|plum|lilac|lavender|mauve/, 'data'], [/pink|rose|fuchsia|magenta|blush/, 'tk-lists'], [/\bred\b|coral|crimson|maroon|wine|cherry/, 'goods'],
  [/orange|rust|peach|terracotta|amber/, 'tk-dispatch'], [/yellow|mustard|gold|lemon|ochre|sand|beige|camel|brown|\btan\b/, 'tk-stock'],
];
/** A mark for a shade: its first letters on a woven tint that is a rough guide to the colour, the same every time for the same name. */
function swatch(shade) {
  const s = String(shade || '').trim(), low = s.toLowerCase(), words = s.split(/\s+/).filter(Boolean);
  let h = 0; for (const c of low) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const hit = HUES.find(([re]) => re.test(low));
  const letters = words.length > 1 ? words.slice(0, 2).map((w) => w[0]).join('') : s.slice(0, 2);
  return `<span class="dy-swatch${hit?.[2] ? ' is-light' : ''}" style="--sw:var(--${hit ? hit[1] : `tk-${TK[h % TK.length]}`})" aria-hidden="true">${esc(letters.toUpperCase() || '–')}</span>`;
}
const TICK = '<svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ARROW = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

// Reports sent from this phone since sign-in, per person.
const sentKey = () => `deme-dye-sent-${data.user?.id || ''}`;
const recallSent = () => { try { const v = JSON.parse(sessionStorage.getItem(sentKey())); return Array.isArray(v) ? v : []; } catch { return []; } };
const keepSent = (list) => { try { sessionStorage.setItem(sentKey(), JSON.stringify(list.slice(0, 30))); } catch { /* this visit only */ } };

export function mount(el, ctx) {
  const outside = data.user?.role === 'dyer';
  const canCheck = !outside && data.can('quality', 'write');
  const readsReports = data.canRead('fabric_reports');
  let S = { lots: null, waiting: [], reasons: [], error: '' };
  let draft = null, queue = null, inspecting = null, loading = false, alive = true, lastFocus = '', refocus = '';
  let sent = recallSent(), sideSig = '', strips = [];

  el.innerHTML = `
    <div class="workspace dye"><div class="workspace-inner" id="dyRoot">
      <div class="view-head">
        <div class="title-row"><h1 class="reveal">Dye house</h1>${info('Fabric that is at the dye house. Tap a lot or a roll to report a problem on it with photos. The report reaches quality and stores at once.', 'Dye house')}</div>
        <div class="dy-sum" id="dySum"></div>
      </div>
      <div class="dy-cols">
        <div class="dy-col" id="dyMain"></div>
        <div class="dy-col" id="dySide"></div>
      </div>
    </div></div>`;
  const root = $('#dyRoot', el), main = $('#dyMain', el), side = $('#dySide', el), work = el.querySelector('.workspace');
  const reasonName = (code) => ([...S.reasons, ...FABRIC_REASONS].find((r) => r[0] === code) || [])[1] || code || '';

  // ───────── What is at the dye house ─────────
  function due(l, T) {
    if (!l.dueBack) return { late: false, html: '' };
    const d = daysTo(l.dueBack, T);
    if (d < 0) return { late: true, html: `<span class="tag tag-crit">Late ${esc(plural(-d, 'day'))}</span>` };
    if (d === 0) return { late: false, html: '<span class="tag tag-warn">Due today</span>' };
    return { late: false, html: `<span class="dy-due">Due ${esc(day(l.dueBack))}</span>` };
  }
  function lotCard(l, T) {
    const d = due(l, T), n = l.rolls.length;
    return `<li><button type="button" class="dy-lot${d.late ? ' is-late' : ''}" data-lot="${esc(l.id)}">
      ${swatch(l.shade)}
      <span class="dy-lot-body">
        <strong class="dy-lot-no">${esc(l.no)}</strong>
        <span class="dy-lot-shade">${esc([l.shade, outside ? '' : l.dyer].filter(Boolean).join(' · '))}</span>
        <span class="dy-lot-facts">${esc(`${plural(n, 'roll')} · ${num(metres(l.rolls), 1)} m`)}</span>
      </span>
      <span class="dy-lot-end">${d.html}<span class="dy-go">Report a problem ${ARROW}</span></span>
    </button></li>`;
  }
  function inspectForm(w) {
    return `<form class="dy-inspect" data-inspect="${esc(w.id)}" novalidate>
      <div class="field"><label for="dyPts">Penalty points per 100 sq yd ${info(`The 4-point system: count the penalty points and work them out per 100 square yards. ${INSPECTION_PASS_MARK} or under passes. Over that the roll fails and a claim is opened on the mill.`, 'Inspecting a roll')}</label><input class="input dy-in" id="dyPts" type="number" min="0" step="any" inputmode="decimal" autocomplete="off"></div>
      <p class="dy-verdict" id="dyVerdict" role="status"></p>
      <div class="field" id="dyWhyWrap" hidden><label for="dyWhy">Main reason</label><select class="select dy-in" id="dyWhy"><option value=""></option>${S.reasons.map(([c, n]) => `<option value="${esc(c)}">${esc(n)}</option>`).join('')}</select></div>
      <div class="field"><label for="dyDef">Defects seen</label><input class="input dy-in" id="dyDef" type="text" autocomplete="off"></div>
      <p class="error" id="dyInsErr" role="alert" hidden></p>
      <div class="dy-acts"><button type="submit" class="btn btn-primary dy-btn">Save inspection</button><button type="button" class="btn btn-quiet dy-btn" data-inspect-cancel>Cancel</button></div>
    </form>`;
  }
  function rollRow(w) {
    const toCheck = w.status === 'received';
    return `<li class="dy-roll">
      <div class="dy-roll-top"><div class="dy-roll-main"><strong>${esc(w.no)}</strong><span>${esc([w.fabric, `${num(w.metres, 1)} m`].filter(Boolean).join(' · '))}</span></div>${toCheck ? '<span class="tag tag-warn">To check</span>' : '<span class="tag tag-ok">Passed</span>'}</div>
      ${inspecting === w.id ? inspectForm(w) : `<div class="dy-acts">
        ${canCheck && toCheck ? `<button type="button" class="btn btn-primary dy-btn" data-accept="${esc(w.id)}">Accept on mill report</button><button type="button" class="btn btn-outline dy-btn" data-inspect-open="${esc(w.id)}">Inspect</button>` : ''}
        <button type="button" class="btn dy-btn" data-roll="${esc(w.id)}">Report a problem</button>
      </div>`}
    </li>`;
  }
  function listHtml() {
    const T = iso(today());
    const lots = S.lots.slice().sort((a, b) => String(a.dueBack || '9').localeCompare(String(b.dueBack || '9')) || String(a.no).localeCompare(String(b.no), undefined, { numeric: true }));
    if (!lots.length && !S.waiting.length) {
      return `<div class="panel empty"><h3>Nothing is at the dye house</h3>${data.canWrite('dye_lots') ? '<button type="button" class="btn btn-primary dy-btn" data-new-lot>Make a dye lot</button>' : '<p>Fabric sent for dyeing shows up here.</p>'}</div>`;
    }
    return `
      ${lots.length ? `<section class="dy-sect" aria-labelledby="dyLotsH">
        <div class="dy-sect-head"><div class="title-row"><h2 id="dyLotsH">Lots at the dye house</h2>${info('Dye lots that are out and not yet back, the one due first on top. Late means the due-back date has passed. The coloured mark is a rough guide that tells one lot from another at a glance; it is not the true shade.', 'Lots at the dye house')}</div><span class="dy-n">${esc(num(lots.length))}</span></div>
        <ul class="dy-lots">${lots.map((l) => lotCard(l, T)).join('')}</ul>
      </section>` : ''}
      ${S.waiting.length ? `<section class="dy-sect" aria-labelledby="dyWaitH">
        <div class="dy-sect-head"><div class="title-row"><h2 id="dyWaitH">Fabric waiting</h2>${info(`Rolls the mill delivered straight to the dye house that are not on a dye lot yet.${canCheck ? ` A roll to check can be accepted on the mill's QC report, or inspected: ${INSPECTION_PASS_MARK} points or under passes.` : ''}`, 'Fabric waiting')}</div><span class="dy-n">${esc(num(S.waiting.length))}</span></div>
        <ul class="panel dy-rolls">${S.waiting.map(rollRow).join('')}</ul>
      </section>` : ''}`;
  }

  // ───────── Report a problem ─────────
  const whereOf = (d) => (d.lot ? `lot ${d.lot.no}${d.pick ? `, roll ${d.lot.rolls.find((r) => r.id === d.pick)?.no || ''}` : ''}` : `roll ${d.roll.no}`);
  function flowHtml() {
    const d = draft, rolls = d.lot ? d.lot.rolls : [];
    const press = (on) => `aria-pressed="${on ? 'true' : 'false'}"`;
    return `<section class="panel dy-flow" aria-labelledby="dyFlowH">
      <header class="dy-flow-head">
        <button type="button" class="btn btn-quiet dy-btn dy-back" data-back>Back</button>
        <div class="dy-flow-what">${d.lot ? swatch(d.lot.shade) : ''}<div><p class="eyebrow">Report a problem</p><h2 id="dyFlowH" tabindex="-1">${esc(d.lot ? `Lot ${d.lot.no}` : `Roll ${d.roll.no}`)}</h2><p class="dy-flow-sub">${esc(d.lot ? [d.lot.shade, plural(rolls.length, 'roll'), `${num(metres(rolls), 1)} m`].filter(Boolean).join(' · ') : [d.roll.fabric, `${num(d.roll.metres, 1)} m`].filter(Boolean).join(' · '))}</p></div></div>
      </header>
      <div class="dy-step"><p class="dy-label" id="dyStageL">When was it seen</p>
        <div class="dy-pair" role="group" aria-labelledby="dyStageL"><button type="button" class="dy-choice" data-stage="before" ${press(d.stage === 'before')}>Before dyeing</button><button type="button" class="dy-choice" data-stage="after" ${press(d.stage === 'after')}>After dyeing</button></div></div>
      ${rolls.length ? `<div class="dy-step"><p class="dy-label" id="dyRollL">Which roll</p>
        <div class="dy-picks" role="group" aria-labelledby="dyRollL"><button type="button" class="dy-choice" data-pick="" ${press(!d.pick)}>Whole lot</button>${rolls.map((r) => `<button type="button" class="dy-choice" data-pick="${esc(r.id)}" ${press(d.pick === r.id)}><span>${esc(r.no)}</span><small>${esc(`${num(r.metres, 1)} m`)}</small></button>`).join('')}</div></div>` : ''}
      <div class="dy-step"><p class="dy-label" id="dyReasonL">What is wrong</p>
        <div class="dy-reasons" role="group" aria-labelledby="dyReasonL">${S.reasons.map(([c, n]) => `<button type="button" class="dy-choice" data-reason="${esc(c)}" ${press(d.reason === c)}>${esc(n)}</button>`).join('')}</div>
        <p class="error" id="dyReasonErr" role="alert" hidden>Choose what is wrong.</p></div>
      <div class="dy-step"><p class="dy-label">Photos</p><div id="dyQueue"></div></div>
      <div class="dy-step field"><label for="dyNote">Note</label><textarea class="input dy-note" id="dyNote" rows="3" maxlength="600">${esc(d.note)}</textarea></div>
      <div id="dyMsg" role="status" aria-live="polite"></div>
      <div class="dy-send-row"><button type="button" class="btn btn-primary dy-send" data-send>Send report</button><button type="button" class="btn btn-quiet dy-btn" data-finish hidden>Finish without them</button></div>
    </section>`;
  }
  function doneHtml() {
    const d = draft;
    return `<section class="dy-done" aria-labelledby="dyDoneH">
      <span class="dy-tick">${TICK}</span>
      <p class="eyebrow">Sent · ${esc(fmtTime(new Date()))}</p>
      <h2 id="dyDoneH" tabindex="-1">Report ${esc(d.no)} is sent</h2>
      <p class="dy-done-what">${esc(`${reasonName(d.reason)} on ${whereOf(d)}`)}</p>
      <p class="dy-done-n">${esc(d.photos ? `${plural(d.photos, 'photo')} attached` : 'No photos attached')}</p>
      <div class="dy-acts"><button type="button" class="btn btn-primary dy-btn" data-again>Report another problem</button><button type="button" class="btn dy-btn" data-back>Back to the lots</button></div>
    </section>`;
  }
  function startReport(target) {
    queue?.destroy();
    draft = { lot: target.lot || null, roll: target.roll || null, stage: target.lot ? 'after' : 'before', pick: '', reason: '', note: '', report: '', no: '', photos: 0, phase: 'form' };
    renderMain();
    queue = photoQueue($('#dyQueue', main));
    work.scrollTop = 0;
    $('#dyFlowH', main)?.focus({ preventScroll: true });
  }
  function endReport() {
    queue?.destroy(); queue = null; draft = null;
    refocus = lastFocus;   // back on the card it started from, also after the list is loaded afresh
    const going = load();
    renderMain(); renderSide(true);
    going.then(() => { refocus = ''; });
  }
  const say = (tone, head, text) => { $('#dyMsg', main).innerHTML = text ? `<div class="dy-result" data-tone="${tone}"><p class="dy-result-head">${esc(head)}</p><p>${esc(text)}</p></div>` : ''; };
  const lock = (on) => { main.querySelectorAll('[data-stage], [data-pick], [data-reason]').forEach((b) => { b.disabled = on; }); const n = $('#dyNote', main); if (n) n.readOnly = on; };
  function noteSent() {
    const i = sent.findIndex((x) => x.report === draft.report);
    const row = { report: draft.report, no: draft.no, what: `${reasonName(draft.reason)} on ${whereOf(draft)}`, at: i >= 0 ? sent[i].at : new Date().toISOString(), photos: draft.photos };
    if (i >= 0) sent[i] = row; else sent.unshift(row);
    keepSent(sent);
  }
  async function send(btn) {
    const d = draft;
    if (!d.reason) { const err = $('#dyReasonErr', main); err.hidden = false; err.scrollIntoView({ block: 'center' }); main.querySelector('[data-reason]')?.focus({ preventScroll: true }); return; }
    await busy(btn, async () => {
      lock(true); say('', '', '');
      if (!d.report) {   // made once: sending again after a failure only sends what is still missing
        try {
          const out = await api.act('fabric.report', { dyeLot: d.lot?.id, roll: d.lot ? d.pick || undefined : d.roll.id, reason: d.reason, note: d.note.trim(), stage: d.stage });
          d.report = out.data.report; d.no = out.data.no; noteSent();
        } catch (e) {
          if (draft !== d) return;
          lock(false);
          say('crit', 'Not sent', `${e.status ? e.message : 'No network.'} Nothing is lost. Send again.`);
          if (e.status === 401) setTimeout(() => location.reload(), 1500); // the session ended: back to sign-in
          return;
        }
      }
      const res = await queue.sendTo('fabric_reports', d.report);
      if (draft !== d) return;
      d.photos = res.sent; noteSent();
      if (res.failed.length) {
        d.phase = 'partial';
        say('crit', `Report ${d.no} is sent`, `${plural(res.failed.length, 'photo')} did not go: ${res.failed.map((f) => f.name).join(', ')}. ${res.failed[0].error || ''}`);
        btn.textContent = 'Send the photos again';
        $('[data-finish]', main).hidden = false;
        $('#dyMsg', main).scrollIntoView({ block: 'center' });
      } else showDone();
    });
  }
  function showDone() {
    draft.phase = 'done';
    queue?.destroy(); queue = null;
    main.innerHTML = doneHtml();
    work.scrollTop = 0;
    $('#dyDoneH', main)?.focus({ preventScroll: true });
    renderSide(true);
  }

  // ───────── Reports: every one for those who can read them, otherwise what this phone sent ─────────
  function renderSide(force = false) {
    const cards = readsReports
      ? data.all('fabric_reports').slice().sort((a, b) => String(b.createdAt || b.date || '').localeCompare(String(a.createdAt || a.date || ''))).slice(0, SHOWN)
      : sent;
    const sig = JSON.stringify(cards.map((r) => (readsReports ? [r.id, r.status, r.photos, r.note] : [r.report, r.photos])));
    root.classList.toggle('has-side', cards.length > 0 || readsReports);
    if (!force && sig === sideSig && side.firstElementChild) return;
    sideSig = sig;
    strips.forEach((s) => s?.destroy()); strips = [];
    if (readsReports) {
      const total = data.all('fabric_reports').length, fresh = data.all('fabric_reports').filter((r) => r.status === 'new').length;
      side.innerHTML = `<section class="dy-sect" aria-labelledby="dyRepH">
        <div class="dy-sect-head"><div class="title-row"><h2 id="dyRepH">Reports</h2>${info('Problems reported on fabric from the dye house, the store or the cutting table, newest first. Mark one as seen when you have looked at it; close it when it is dealt with.', 'Reports')}</div>${fresh ? `<span class="tag tag-warn">${esc(num(fresh))} new</span>` : ''}</div>
        ${cards.length ? `<ul class="dy-reps">${cards.map((r) => `<li class="panel dy-rep">
          <div class="dy-rep-head"><strong>${esc(r.no)}</strong>${statusTag('fabric_reports', r.status)}<span class="dy-rep-at">${esc(r.createdAt ? fmtStamp(r.createdAt) : r.date ? day(r.date) : '')}</span></div>
          <p class="dy-rep-what">${esc([reasonName(r.reason), r.dyeLot ? `lot ${data.title('dye_lots', r.dyeLot) || ''}` : '', r.roll ? `roll ${data.title('rolls', r.roll) || ''}` : '', r.stage === 'before' ? 'before dyeing' : 'after dyeing'].filter(Boolean).join(' · '))}</p>
          ${r.note ? `<p class="dy-rep-note">${esc(r.note)}</p>` : ''}
          <p class="dy-rep-by">${esc([data.title('users', r.by), data.title('suppliers', r.supplier)].filter(Boolean).join(' · '))}</p>
          <div data-photos-of="${esc(r.id)}"></div>
          <div class="dy-acts">${canCheck && r.status === 'new' ? `<button type="button" class="btn btn-primary dy-btn" data-rep="report.seen" data-id="${esc(r.id)}">Seen</button>` : ''}${canCheck && r.status !== 'closed' ? `<button type="button" class="btn btn-outline dy-btn" data-rep="report.close" data-id="${esc(r.id)}">Close</button>` : ''}<button type="button" class="btn btn-quiet dy-btn" data-open-rep="${esc(r.id)}">Open</button></div>
        </li>`).join('')}</ul>${total > SHOWN ? `<p class="dy-more">${esc(num(SHOWN))} of ${esc(num(total))} shown. <button type="button" class="link" data-all-reps>Open all reports</button></p>` : ''}` : '<p class="panel dy-none">No problem has been reported.</p>'}
      </section>`;
      cards.forEach((r) => { if (r.photos > 0 || r.by === data.user.id) strips.push(mountPhotos(side.querySelector(`[data-photos-of="${CSS.escape(r.id)}"]`), 'fabric_reports', r.id, { canAdd: r.by === data.user.id && r.status !== 'closed', bare: true })); });
    } else {
      side.innerHTML = cards.length ? `<section class="dy-sect" aria-labelledby="dySentH">
        <div class="dy-sect-head"><div class="title-row"><h2 id="dySentH">Sent from this phone</h2>${info('Reports sent from this phone since you signed in. More photos can be added to them here.', 'Sent from this phone')}</div><span class="dy-n">${esc(num(cards.length))}</span></div>
        <ul class="dy-reps">${cards.map((r) => `<li class="panel dy-rep">
          <div class="dy-rep-head"><strong>${esc(r.no)}</strong><span class="tag tag-ok">Sent</span><span class="dy-rep-at">${esc(fmtStamp(r.at))}</span></div>
          <p class="dy-rep-what">${esc(r.what)}</p>
          <div data-photos-of="${esc(r.report)}"></div>
        </li>`).join('')}</ul>
      </section>` : '';
      cards.forEach((r) => strips.push(mountPhotos(side.querySelector(`[data-photos-of="${CSS.escape(r.report)}"]`), 'fabric_reports', r.report, { canAdd: true, bare: true, big: true })));
    }
  }

  // ───────── Drawing and loading ─────────
  function renderSum() {
    if (!S.lots) { $('#dySum', el).innerHTML = ''; return; }
    const T = iso(today()), late = S.lots.filter((l) => l.dueBack && l.dueBack < T).length, toCheck = S.waiting.filter((w) => w.status === 'received').length;
    $('#dySum', el).innerHTML = [
      S.lots.length ? `<span class="tag tag-plain">${esc(plural(S.lots.length, 'lot'))}</span>` : '',
      late ? `<span class="tag tag-crit">${esc(num(late))} late</span>` : '',
      S.waiting.length ? `<span class="tag ${toCheck ? 'tag-warn' : 'tag-plain'}">${esc(plural(S.waiting.length, 'roll'))} waiting</span>` : '',
    ].join('');
  }
  function renderMain() {
    root.classList.toggle('is-flow', !!draft);
    if (draft) { main.innerHTML = flowHtml(); return; }
    if (S.error) { main.innerHTML = `<div class="panel empty"><h3>The lots could not be loaded</h3><p>${esc(S.error)}</p><button type="button" class="btn btn-primary dy-btn" data-reload>Try again</button></div>`; return; }
    if (!S.lots) { main.innerHTML = '<div class="panel dy-none">Loading</div>'; return; }
    main.innerHTML = listHtml();
    if (inspecting) $('#dyPts', main)?.focus({ preventScroll: true });
    else if (refocus) { main.querySelector(refocus)?.focus({ preventScroll: true }); if (!loading) refocus = ''; }
  }
  async function load() {
    if (loading) return;
    loading = true;
    try { const out = await api.act('fabric.myLots'); S = { lots: out.data.lots || [], waiting: out.data.waiting || [], reasons: out.data.reasons || [], error: '' }; }
    catch (e) { S = { ...S, error: e.status ? e.message : 'No network. Check the connection.' }; if (e.status === 401) setTimeout(() => location.reload(), 1500); }
    finally { loading = false; }
    if (!alive) return;
    renderSum();
    if (!draft) renderMain();
  }
  const typing = () => { const a = document.activeElement; return !!a && root.contains(a) && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName); };

  // ───────── Events, on this screen's own root ─────────
  root.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b || b.closest('.photos')) return;
    const ds = b.dataset;
    if (ds.lot) { const lot = S.lots.find((l) => l.id === ds.lot); if (lot) { lastFocus = `[data-lot="${CSS.escape(lot.id)}"]`; startReport({ lot }); } return; }
    if (ds.roll) { const roll = S.waiting.find((w) => w.id === ds.roll); if (roll) { lastFocus = `[data-roll="${CSS.escape(roll.id)}"]`; startReport({ roll }); } return; }
    if (ds.back !== undefined || ds.finish !== undefined) { if (draft?.phase === 'partial' && ds.finish !== undefined) return showDone(); return endReport(); }
    if (ds.again !== undefined) return startReport({ lot: draft.lot, roll: draft.roll });
    if (ds.stage) { draft.stage = ds.stage; main.querySelectorAll('[data-stage]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); return; }
    if (ds.pick !== undefined) { draft.pick = ds.pick; main.querySelectorAll('[data-pick]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); return; }
    if (ds.reason) { draft.reason = ds.reason; main.querySelectorAll('[data-reason]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); $('#dyReasonErr', main).hidden = true; return; }
    if (ds.send !== undefined) return void send(b);
    if (ds.reload !== undefined) return void busy(b, load);
    if (ds.newLot !== undefined) return ctx.openEntity('dye_lots', { add: true });
    if (ds.accept) return void busy(b, async () => { const out = await api.act('roll.accept', {}, { entity: 'rolls', id: ds.accept }); toast(out.message || 'Accepted.'); await load(); });
    if (ds.inspectOpen) { inspecting = ds.inspectOpen; renderMain(); return; }
    if (ds.inspectCancel !== undefined) { inspecting = null; renderMain(); return; }
    if (ds.rep) return void busy(b, async () => { const out = await api.act(ds.rep, {}, { entity: 'fabric_reports', id: ds.id }); toast(out.message || 'Done.'); renderSide(); });
    if (ds.openRep) return ctx.openEntity('fabric_reports', { id: ds.openRep });
    if (ds.allReps !== undefined) return ctx.openEntity('fabric_reports');
  });
  root.addEventListener('input', (e) => {
    if (e.target.id === 'dyNote' && draft) draft.note = e.target.value;
    if (e.target.id === 'dyPts') {
      const v = e.target.value, p = Number(v), fails = v !== '' && p > INSPECTION_PASS_MARK;
      $('#dyInsErr', main).hidden = true;
      $('#dyWhyWrap', main).hidden = !fails;
      $('#dyVerdict', main).innerHTML = v === '' || !(p >= 0) ? '' : fails ? '<span class="tag tag-crit">Fails</span>' : '<span class="tag tag-ok">Passes</span>';
    }
  });
  root.addEventListener('submit', (e) => {
    const f = e.target.closest('[data-inspect]'); if (!f) return;
    e.preventDefault();
    const err = $('#dyInsErr', f), v = $('#dyPts', f).value, points = Number(v);
    if (v === '' || !(points >= 0)) { err.textContent = 'Enter the penalty points as zero or more.'; err.hidden = false; $('#dyPts', f).focus(); return; }
    err.hidden = true;
    busy(f.querySelector('[type="submit"]'), async () => {
      const out = await api.act('roll.inspect', { points, reason: points > INSPECTION_PASS_MARK ? $('#dyWhy', f).value || undefined : undefined, defects: $('#dyDef', f).value.trim() }, { entity: 'rolls', id: f.dataset.inspect });
      toast(out.message || 'Inspection saved.');
      inspecting = null; await load();
    });
  });

  renderMain(); renderSide(true);
  load();
  const off = data.on((touched) => {
    if (!alive) return;
    renderSide();
    // Never redraw under someone who is reporting or typing.
    if (draft || typing() || inspecting) return;
    if (touched.includes('*') || touched.some((t) => ['rolls', 'dye_lots', 'goods_receipts'].includes(t))) load();
  });
  return () => { alive = false; off(); queue?.destroy(); strips.forEach((s) => s?.destroy()); };
}
