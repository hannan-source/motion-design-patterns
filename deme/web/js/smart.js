// Bring in data: take a spreadsheet in whatever shape it is, work out which record type it holds
// and which column fills which field, let the person check that, then import it.
// With an Anthropic key on the server, Claude Haiku suggests the mapping; without one, columns
// are matched by name and the person finishes the rest by hand. Either way nothing is saved
// until Import is pressed, and every row still goes through the same checks as a hand entry.

import { api, data } from './api.js';
import { $, $$, esc, info, toast, busy, parseCsv, num } from './ui.js';
import { MODULES, ENTITIES, entityById, fieldsOf } from '../shared/schema.js';

const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const importable = () => ENTITIES.filter((e) => !e.readonly && data.canWrite(e.id));
const fieldsFor = (e) => fieldsOf(e).filter((f) => !f.ro && f.type !== 'lines');

/** Match columns to fields by name alone. Used when AI mapping is off, and as the starting point when a type is picked by hand. */
function byName(headers, entity) {
  const fs = fieldsFor(entity), used = new Set();
  return headers.map((h) => {
    const n = norm(h);
    const hit = fs.find((f) => !used.has(f.k) && (norm(f.label) === n || norm(f.k) === n)) || fs.find((f) => !used.has(f.k) && n.length > 2 && (norm(f.label).includes(n) || n.includes(norm(f.label))));
    if (hit) used.add(hit.k);
    return { header: h, field: hit ? hit.k : '', dateFormat: '' };
  });
}
const bestType = (headers) => importable().map((e) => [e, byName(headers, e).filter((c) => c.field).length]).sort((a, b) => b[1] - a[1])[0]?.[0];
/** 03/31/2026 → 2026-03-31. Day-first and year-first dates are understood by the server as they are. */
const fromMDY = (v) => { const m = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2}|\d{4})$/.exec(String(v).trim()); return m ? `${m[3].length === 2 ? `20${m[3]}` : m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : v; };

export function mount(el, ctx) {
  let rows = [], headers = [], entity = null, columns = [], by = '', note = '', result = null;

  el.innerHTML = `<div class="workspace smart"><div class="workspace-inner">
    <div class="view-head"><div class="title-row"><h1 class="reveal">Bring in data</h1>${info('Use this to load what already exists: supplier lists, style sheets, stock counts, order books, employee lists. Export the sheet as CSV from Excel or Google Sheets, in whatever layout it has. Deme works out which list it belongs to and which column fills which field; you check that, then import. Rows that fail a check are listed with the reason and can be fixed and imported again.', 'Bring in data')}</div>
      <span class="tag ${api.caps.ai ? 'tag-ok' : 'tag-plain'}">${api.caps.ai ? 'AI mapping on' : 'Matching by column name'}</span></div>
    <section class="panel si-step" aria-labelledby="siH1">
      <div class="panel-head"><div class="title-row"><span class="si-n">1</span><h2 id="siH1">Choose a file</h2>${info(api.caps.ai ? 'When you press Read the file, the column headings and the first five rows are sent to Anthropic\'s Claude (Haiku) to suggest the mapping. The rest of the file stays in your browser until you import it into Deme.' : 'AI mapping is not switched on for this copy of Deme, so columns are matched by their names. An admin can switch it on by adding an Anthropic key on the server.', 'What is sent where')}</div></div>
      <div class="panel-pad si-pick">
        <label class="si-drop" for="siFile"><strong>Choose a CSV file</strong><span class="faint">or drop it here</span><input id="siFile" type="file" accept=".csv,.tsv,.txt,text/csv,text/plain"></label>
        <div class="field"><label for="siPaste">Or paste rows, with the headings in the first row</label><textarea class="input mono" id="siPaste" rows="5" placeholder="Name,Kind,Payment terms"></textarea></div>
        <div class="field"><label for="siType">What it holds</label><select class="select" id="siType"><option value="">Let Deme decide</option>${Object.entries(MODULES).map(([m, mod]) => { const es = importable().filter((e) => e.module === m); return es.length ? `<optgroup label="${esc(mod.name)}">${es.map((e) => `<option value="${e.id}">${esc(e.name)}</option>`).join('')}</optgroup>` : ''; }).join('')}</select></div>
        <div class="row"><button class="btn btn-primary" type="button" id="siRead">Read the file</button><span class="faint" id="siCount"></span></div>
      </div>
    </section>
    <section class="panel si-step" id="siStep2" hidden></section>
    <section class="panel si-step" id="siStep3" hidden></section>
  </div></div>`;
  const paste = $('#siPaste', el), step2 = $('#siStep2', el), step3 = $('#siStep3', el);

  const loadText = (text) => { paste.value = text; count(); };
  const count = () => { const n = parseCsv(paste.value).length; $('#siCount', el).textContent = n ? `${num(n)} row${n === 1 ? '' : 's'} found` : ''; };
  $('#siFile', el).addEventListener('change', (e) => { const f = e.target.files[0]; if (!f) return; const r = new FileReader(); r.onload = () => loadText(String(r.result)); r.readAsText(f); });
  const drop = $('.si-drop', el);
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('is-over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('is-over'); const f = e.dataTransfer.files[0]; if (f) { const r = new FileReader(); r.onload = () => loadText(String(r.result)); r.readAsText(f); } });
  paste.addEventListener('input', count);

  $('#siRead', el).addEventListener('click', (e) => busy(e.currentTarget, async () => {
    rows = parseCsv(paste.value);
    if (!rows.length) return toast('Add a heading row and at least one row of data.', 'crit');
    headers = [...new Set(rows.flatMap((r) => Object.keys(r)))];
    const picked = $('#siType', el).value;
    result = null; note = '';
    if (api.caps.ai) {
      try { const out = await api.aiMap({ entity: picked || undefined, headers, sample: rows.slice(0, 5) }); entity = entityById[out.entity]; columns = out.columns; note = out.note; by = 'ai'; }
      catch (err) { toast(err.message, 'crit'); entity = picked ? entityById[picked] : bestType(headers); columns = byName(headers, entity); by = 'name'; }
    } else { entity = picked ? entityById[picked] : bestType(headers); columns = byName(headers, entity); by = 'name'; }
    if (!entity) return toast('Your role cannot add records, so there is nothing to import into.', 'crit');
    renderMap(); step2.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }));

  function renderMap() {
    const fs = fieldsFor(entity), mapped = new Set(columns.map((c) => c.field).filter(Boolean));
    const missing = fs.filter((f) => f.req && !mapped.has(f.k));
    step2.hidden = false; step3.hidden = !result;
    step2.innerHTML = `<div class="panel-head"><div class="title-row"><span class="si-n">2</span><h2>Check the match</h2>${info('Each row below is one column of your file. Choose the field it fills, or leave it out. Where a column points at another list, such as a supplier or a style, its values must match a name or code already in Deme, so bring in those lists first. Dates may be written 31/03/2026, 31 Mar 2026 or 2026-03-31; pick month-first only for American-style dates.', 'Checking the match')}</div>
        <span class="tag ${by === 'ai' ? 'tag-info' : 'tag-plain'}">${by === 'ai' ? 'Suggested by AI' : 'Matched by name'}</span></div>
      <div class="panel-pad stack">
        <div class="si-into"><div class="field"><label for="siInto">Goes into</label><select class="select" id="siInto">${importable().map((e) => `<option value="${e.id}" ${e.id === entity.id ? 'selected' : ''}>${esc(MODULES[e.module].name)} · ${esc(e.name)}</option>`).join('')}</select></div>
          <div class="si-meter"><span class="num">${columns.filter((c) => c.field).length} of ${columns.length}</span><span class="faint">columns matched</span><span class="bar"><i style="--v:${columns.length ? Math.round((columns.filter((c) => c.field).length / columns.length) * 100) : 0}%"></i></span></div></div>
        ${note ? `<p class="si-note">${esc(note)}</p>` : ''}
        ${missing.length ? `<p class="si-missing"><span class="tag tag-warn">Still needed</span> ${missing.map((f) => esc(f.label)).join(', ')}</p>` : ''}
        <div class="si-map">${columns.map((c, i) => { const f = fs.find((x) => x.k === c.field); return `<div class="si-col ${c.field ? '' : 'is-out'}">
          <div class="si-from"><strong>${esc(c.header)}</strong><span class="faint">${rows.slice(0, 3).map((r) => esc(String(r[c.header] ?? '').slice(0, 28))).filter(Boolean).join(' · ') || 'empty'}</span></div>
          <span class="si-arrow" aria-hidden="true">→</span>
          <select class="select" data-col="${i}" aria-label="Field for ${esc(c.header)}"><option value="">Leave out</option>${fs.map((x) => `<option value="${x.k}" ${x.k === c.field ? 'selected' : ''} ${mapped.has(x.k) && x.k !== c.field ? 'disabled' : ''}>${esc(x.label)}${x.req ? ' *' : ''}</option>`).join('')}</select>
          ${f && f.type === 'date' ? `<select class="select si-date" data-date="${i}" aria-label="Date order for ${esc(c.header)}"><option value="">Day first or year first</option><option value="MDY" ${c.dateFormat === 'MDY' ? 'selected' : ''}>Month first</option></select>` : '<span></span>'}
        </div>`; }).join('')}</div>
        <div class="row"><button class="btn btn-primary" type="button" id="siImport" ${missing.length ? 'disabled' : ''}>Import ${num(rows.length)} row${rows.length === 1 ? '' : 's'}</button>${missing.length ? '<span class="faint">Match the needed fields first.</span>' : ''}</div>
      </div>`;
    if (result) renderResult();
  }
  step2.addEventListener('change', (e) => {
    const t = e.target;
    if (t.id === 'siInto') { entity = entityById[t.value]; columns = byName(headers, entity); by = 'name'; note = ''; result = null; renderMap(); }
    else if (t.dataset.col !== undefined) { columns[+t.dataset.col].field = t.value; renderMap(); }
    else if (t.dataset.date !== undefined) columns[+t.dataset.date].dateFormat = t.value;
  });
  step2.addEventListener('click', (e) => {
    const b = e.target.closest('#siImport'); if (!b) return;
    busy(b, async () => {
      const use = columns.filter((c) => c.field);
      const out = rows.map((r) => Object.fromEntries(use.map((c) => [c.field, c.dateFormat === 'MDY' ? fromMDY(r[c.header]) : r[c.header]]).filter(([, v]) => v !== undefined && v !== '')));
      result = await api.importRows(entity.id, out);
      renderResult(); step3.scrollIntoView({ block: 'start', behavior: 'smooth' });
    });
  });
  function renderResult() {
    step3.hidden = false;
    const total = result.created + result.errors.length;
    step3.innerHTML = `<div class="panel-head"><div class="title-row"><span class="si-n">3</span><h2>Result</h2></div></div>
      <div class="panel-pad stack">
        <div class="si-result"><div><span class="si-big num">${num(result.created)}</span><span class="faint">added to ${esc(entity.name)}</span></div>
          <div class="si-split" role="img" aria-label="${result.created} added, ${result.errors.length} not added"><i class="ok" style="flex:${Math.max(result.created, 0.001)}"></i><i class="bad" style="flex:${Math.max(result.errors.length, 0.001)}"></i></div>
          <div><span class="si-big num">${num(result.errors.length)}</span><span class="faint">not added, of ${num(total)}</span></div></div>
        ${result.errors.length ? `<ul class="si-errors">${result.errors.slice(0, 100).map((x) => `<li><span class="mono">Row ${x.row}</span><span>${esc(x.error)}</span></li>`).join('')}</ul>${result.errors.length > 100 ? `<p class="faint">and ${result.errors.length - 100} more</p>` : ''}` : ''}
        <div class="row"><button class="btn btn-primary" type="button" data-open>Open ${esc(entity.name.toLowerCase())}</button><button class="btn btn-outline" type="button" data-again>Bring in another file</button></div>
      </div>`;
  }
  step3.addEventListener('click', (e) => {
    if (e.target.closest('[data-open]')) ctx.openEntity(entity.id);
    if (e.target.closest('[data-again]')) { paste.value = ''; $('#siFile', el).value = ''; rows = []; result = null; step2.hidden = step3.hidden = true; count(); el.querySelector('.workspace').scrollTo({ top: 0, behavior: 'smooth' }); }
  });
  if (ctx.opts?.entity && entityById[ctx.opts.entity]) $('#siType', el).value = ctx.opts.entity;
  return () => {};
}
