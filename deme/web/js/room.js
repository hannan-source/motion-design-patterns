// The Production room: the live plan, and a place to test a change before making it.
// Everything on this page is computed by engine.js from the same state the ERP edits.

import { simulate, compare, options, leverCost, materialCheck, emptyScenario, isEmpty, ASSUME, HORIZON, WEEK, ROUTE_NAMES } from './engine.js';
import { FABRICS, SHADES } from './seed.js';
import { esc, inr, num, sum, by, fmtDate, fmtDay, addWorkdays, workdayIndex, today, iso, toast, clamp } from './util.js';

const CH = { B2B: { name: 'B2B', v: '--ch-b2b' }, D2C: { name: 'Shopify', v: '--ch-d2c' }, STORE: { name: 'Bombay store', v: '--ch-store' }, SAMPLE: { name: 'Samples', v: '--ch-sample' } };
const PRESETS = [
  { id: 'samples', name: '80 samples for a new collection', make: () => ({ ...emptyScenario(), runs: [{ id: 'NEW-1', kind: 'sample', label: '80 samples, new collection', style: 'CORA', qty: 80, dueDays: 10, route: 'sampling' }] }) },
  { id: 'scale', name: '110 more Isla dresses next month', make: () => ({ ...emptyScenario(), runs: [{ id: 'NEW-1', kind: 'scale', label: '110 more Isla maxi dress', style: 'ISLA', qty: 110, dueDays: 24, channel: 'D2C' }] }) },
  { id: 'uplift', name: 'Every order grows 30%', make: () => ({ ...emptyScenario(), uplift: 30 }) },
  { id: 'absent', name: '6 tailors out for two weeks', make: () => ({ ...emptyScenario(), absent: 6 }) },
  { id: 'faulty', name: 'Faulty voile lot, 8 days lost', make: () => ({ ...emptyScenario(), fabricDelay: { fabric: 'VOILE', days: 8 } }) },
];
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const days = (n) => plural(n, 'working day');

let draft = { kind: 'sample', style: 'CORA', qty: 80, due: null, route: 'sampling', channel: 'D2C' };

export function mount(el, ctx) {
  const { store } = ctx;
  const t0 = today();
  let state = store.get();
  let base = simulate(state);
  let sc = state.scenario ? { ...emptyScenario(), ...state.scenario } : emptyScenario();
  if (!draft.due) draft.due = iso(addWorkdays(t0, 10));

  el.innerHTML = `
    <div class="workspace room"><div class="workspace-inner">
      <div class="view-head">
        <div><h1>Production room</h1><p>The plan for the next eight weeks, worked out from the order book, the people on each line and the minutes each style takes. Test a change on the left and see what it moves before anyone is asked to do it.</p></div>
        <div class="row"><span class="faint">As of ${esc(fmtDay(t0))}</span></div>
      </div>
      <div class="kpis" id="roomKpis"></div>
      <div class="room-grid">
        <section class="panel builder" aria-label="Test a change"></section>
        <div class="results"></div>
      </div>
      <div class="tip" hidden></div>
    </div></div>`;
  const $ = (s) => el.querySelector(s);
  const builder = $('.builder'), results = $('.results'), tip = $('.tip');

  // ───────── Builder ─────────
  const slider = (id, label, val, min, max, step, unit, hint = '') => `
    <div class="field slider"><label for="${id}">${label}<output id="${id}Out" class="num">${val}${unit}</output></label>
    <input type="range" id="${id}" data-k="${id}" min="${min}" max="${max}" step="${step}" value="${val}">${hint ? `<span class="hint">${hint}</span>` : ''}</div>`;

  function renderBuilder() {
    const styleOpts = (sel) => state.styles.map((s) => `<option value="${s.id}" ${s.id === sel ? 'selected' : ''}>${esc(s.name)}</option>`).join('');
    builder.innerHTML = `
      <div class="panel-head"><h2>Test a change</h2><button class="btn btn-sm btn-quiet" type="button" data-act="clear">Clear</button></div>
      <div class="panel-pad stack">
        <div>
          <p class="eyebrow">Try one</p>
          <div class="presets">${PRESETS.map((p) => `<button class="btn btn-sm" type="button" data-preset="${p.id}">${esc(p.name)}</button>`).join('')}</div>
        </div>
        <fieldset class="group">
          <legend>Add work</legend>
          <div class="seg" role="group" aria-label="Kind of work">
            <button type="button" data-kind="sample" aria-pressed="${draft.kind === 'sample'}">Sample run</button>
            <button type="button" data-kind="scale" aria-pressed="${draft.kind === 'scale'}">More of a style</button>
          </div>
          <div class="field"><label for="dStyle">${draft.kind === 'sample' ? 'Closest existing style' : 'Style'}</label><select class="select" id="dStyle">${styleOpts(draft.style)}</select></div>
          <div class="two">
            <div class="field"><label for="dQty">Pieces</label><input class="input num" id="dQty" type="number" min="1" max="5000" value="${draft.qty}"></div>
            <div class="field"><label for="dDue">Needed by</label><input class="input" id="dDue" type="date" min="${iso(t0)}" value="${draft.due}"></div>
          </div>
          ${draft.kind === 'sample'
            ? `<div class="field"><label for="dRoute">Who stitches it</label><select class="select" id="dRoute">${Object.entries(ROUTE_NAMES).map(([k, v]) => `<option value="${k}" ${k === draft.route ? 'selected' : ''}>${v}</option>`).join('')}</select></div>`
            : `<div class="field"><span class="label">For</span><div class="seg" role="group"><button type="button" data-channel="D2C" aria-pressed="${draft.channel === 'D2C'}">Shopify and store</button><button type="button" data-channel="B2B" aria-pressed="${draft.channel === 'B2B'}">B2B</button></div></div>`}
          <button class="btn btn-primary" type="button" data-act="add">Add to the plan</button>
          <ul class="runs" id="runList"></ul>
        </fieldset>
        <fieldset class="group">
          <legend>Things that go wrong</legend>
          ${slider('uplift', 'Every customer order grows', sc.uplift, 0, 60, 5, '%')}
          ${slider('absent', 'Tailors out, next two weeks', sc.absent, 0, 12, 1, '')}
          <div class="two">
            <div class="field"><label for="fdFabric">Faulty fabric lot</label><select class="select" id="fdFabric"><option value="">None</option>${Object.entries(FABRICS).map(([k, f]) => `<option value="${k}" ${sc.fabricDelay.fabric === k ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</select></div>
            <div class="field"><label for="fdDays">Days lost</label><input class="input num" id="fdDays" type="number" min="0" max="30" value="${sc.fabricDelay.days}"></div>
          </div>
        </fieldset>
        <fieldset class="group">
          <legend>What you can do about it</legend>
          ${slider('overtime', 'Overtime, whole floor', sc.overtime, 0, 3, 1, ' h a day')}
          ${slider('extraB2B', 'More tailors, B2B line', sc.extraB2B, 0, 14, 1, '')}
          ${slider('extraD2C', 'More tailors, D2C line', sc.extraD2C, 0, 8, 1, '')}
          ${slider('extraSample', 'More sample tailors', sc.extraSample, 0, 6, 1, '')}
          ${slider('extraFinish', 'More finishing helpers', sc.extraFinish, 0, 4, 1, '')}
          ${slider('jobwork', 'B2B stitching sent outside', sc.jobwork, 0, 40, 5, '%')}
          <div class="field"><span class="label">Who goes first</span>
            <div class="seg" role="group" aria-label="Queue rule">
              ${[['due', 'Earliest due date'], ['b2b', 'B2B first'], ['new', 'New work first']].map(([k, n]) => `<button type="button" data-priority="${k}" aria-pressed="${sc.priority === k}">${n}</button>`).join('')}
            </div>
          </div>
        </fieldset>
      </div>`;
    renderRuns();
  }
  function renderRuns() {
    const ul = builder.querySelector('#runList'); if (!ul) return;
    ul.innerHTML = sc.runs.map((r) => `<li><span><strong>${esc(r.label)}</strong><br><span class="muted">${r.kind === 'sample' ? esc(ROUTE_NAMES[r.route]) : r.channel === 'B2B' ? 'B2B line' : 'D2C line'} · by ${esc(fmtDate(addWorkdays(t0, r.dueDays)))}</span></span><button class="btn btn-sm btn-quiet" type="button" data-remove="${r.id}" aria-label="Remove ${esc(r.label)}">Remove</button></li>`).join('');
  }

  let timer = 0;
  function commit(now = false) {
    clearTimeout(timer);
    const run = () => { store.update((s) => { s.scenario = isEmpty(sc) ? null : sc; }, 'scenario'); renderResults(); };
    if (now) run(); else timer = setTimeout(run, 70);
  }

  builder.addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset.k) { sc[t.dataset.k] = +t.value; builder.querySelector(`#${t.id}Out`).textContent = t.value + ({ uplift: '%', jobwork: '%', overtime: ' h a day' }[t.dataset.k] || ''); commit(); }
    else if (t.id === 'fdDays') { sc.fabricDelay.days = clamp(+t.value || 0, 0, 30); commit(); }
    else if (t.id === 'dQty') draft.qty = clamp(+t.value || 1, 1, 5000);
  });
  builder.addEventListener('change', (e) => {
    const t = e.target;
    if (t.id === 'fdFabric') { sc.fabricDelay.fabric = t.value; if (t.value && !sc.fabricDelay.days) { sc.fabricDelay.days = 8; builder.querySelector('#fdDays').value = 8; } commit(true); }
    else if (t.id === 'dStyle') draft.style = t.value;
    else if (t.id === 'dDue') draft.due = t.value || draft.due;
    else if (t.id === 'dRoute') draft.route = t.value;
  });
  builder.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.preset) { sc = PRESETS.find((p) => p.id === b.dataset.preset).make(); renderBuilder(); commit(true); }
    else if (b.dataset.kind) { draft.kind = b.dataset.kind; renderBuilder(); }
    else if (b.dataset.channel) { draft.channel = b.dataset.channel; renderBuilder(); }
    else if (b.dataset.priority) { sc.priority = b.dataset.priority; builder.querySelectorAll('[data-priority]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); commit(true); }
    else if (b.dataset.remove) { sc.runs = sc.runs.filter((r) => r.id !== b.dataset.remove); renderRuns(); commit(true); }
    else if (b.dataset.act === 'clear') { sc = emptyScenario(); renderBuilder(); commit(true); }
    else if (b.dataset.act === 'add') {
      const st = by(state.styles, 'id')[draft.style];
      const dueDays = Math.max(1, workdayIndex(t0, new Date(draft.due + 'T00:00:00')));
      const id = `NEW-${1 + Math.max(0, ...sc.runs.map((r) => +r.id.split('-')[1]))}`;
      sc.runs.push(draft.kind === 'sample'
        ? { id, kind: 'sample', label: `${draft.qty} samples (${st.name} block)`, style: draft.style, qty: draft.qty, dueDays, route: draft.route }
        : { id, kind: 'scale', label: `${draft.qty} more ${st.name}`, style: draft.style, qty: draft.qty, dueDays, channel: draft.channel });
      renderRuns(); commit(true);
    }
  });

  // ───────── Results ─────────
  const fullUntil = (sim, wc) => {
    const c = sim.wcs.find((w) => w.id === wc);
    const d = c.used.findIndex((u, i) => u / Math.max(1, c.cap[i]) < 0.85);
    return d < 0 ? 'Beyond 8 weeks' : d === 0 ? 'Has room today' : fmtDate(sim.dates[d]);
  };

  function renderKpis(sim, active) {
    const late = sim.orders.filter((o) => o.late > 0);
    const wasLate = base.orders.filter((o) => o.late > 0).length;
    const k = (label, value, note, st = '') => `<div class="kpi" data-state="${st}"><div class="kpi-label">${label}</div><div class="kpi-value">${value}</div><div class="kpi-note">${note}</div></div>`;
    $('#roomKpis').innerHTML =
      k('Orders on track', `${sim.orders.length - late.length} of ${sim.orders.length}`, active ? `${base.orders.length - wasLate} of ${base.orders.length} before the change` : late.length ? `${late.map((o) => o.id).join(', ')} late` : 'Every order meets its date', late.length ? (late.length > wasLate ? 'crit' : 'warn') : 'ok')
      + k('Working days late, all orders', num(sum(late, (o) => o.late)), active ? `${num(sum(base.orders, (o) => o.late))} before the change` : 'Sum across late orders', sum(late, (o) => o.late) > sum(base.orders, (o) => o.late) ? 'crit' : '')
      + k('B2B line is full until', fullUntil(sim, 'stitch_b2b'), active ? `Was ${fullUntil(base, 'stitch_b2b')}` : 'First day with spare minutes')
      + k('D2C line is full until', fullUntil(sim, 'stitch_d2c'), active ? `Was ${fullUntil(base, 'stitch_d2c')}` : 'First day with spare minutes');
  }

  function verdictBlock(op, active) {
    const c = op.pushCmp;
    if (!active) {
      const late = base.orders.filter((o) => o.late > 0);
      return `<div class="room-verdict" data-v="${late.length ? 'late' : 'fits'}"><p class="eyebrow">The plan as it stands</p>
        <h2>${late.length ? `${plural(late.length, 'order')} will miss the due date` : 'Every order meets its date'}</h2>
        <p>${late.length ? late.map((o) => `${esc(o.id)} (${esc(o.customer)}, ${num(o.qty)} ${esc(o.name)}) finishes ${esc(fmtDay(o.finish))}, ${days(o.late)} late.`).join(' ') : ''} The stitching lines are booked solid, so anything new has to take minutes from something else. Add a change on the left to see what it takes.</p></div>`;
    }
    const worst = c.worse[0];
    const head = c.verdict === 'fits' ? 'It fits. No order gets later.'
      : c.verdict === 'late' ? 'Nothing else moves, but the new work is late.'
      : `This makes ${plural(c.worse.length, 'order')} later${c.b2bHit ? `, ${c.b2bHit} of them B2B` : ', none of them B2B'}.`;
    const runLines = c.runs.map((r) => `${esc(r.label)}: ${r.unfinished ? 'does not finish within 8 weeks' : `finishes ${esc(fmtDay(r.finish))}`}${r.late ? `, ${days(r.late)} after it is needed` : ', on time'}.`).join(' ');
    const worstLine = worst ? ` Hardest hit: ${esc(worst.id)} (${esc(worst.customer)}), ${days(worst.late - worst.wasLate)} later.` : '';
    const cost = leverCost(state, sc);
    return `<div class="room-verdict" data-v="${c.verdict}"><p class="eyebrow">If you do this</p><h2>${head}</h2>
      <p>${runLines}${worstLine}${cost.total ? ` The steps you have switched on cost about ${inr(cost.total)} a month.` : ''}</p>
      <div class="row"><button class="btn btn-sm" type="button" data-act="map">Show on the map</button></div></div>`;
  }

  function optionCards(op, active) {
    if (!active) return '';
    const c = op.pushCmp, cards = [];
    if (c.verdict === 'fits') return '';
    if (op.wait && op.wait.runs.length) {
      cards.push(`<article class="opt"><p class="eyebrow">Option 1 · Move nothing</p><h3>Give it a later date</h3>
        <p>${op.wait.runs.map((r) => `${esc(r.label)} can finish <strong>${r.finish ? esc(fmtDay(r.finish)) : 'after 8 weeks'}</strong> using only minutes no other order needs.`).join(' ')}</p></article>`);
    }
    if (op.add) {
      const a = op.add.scenario, parts = leverCost(state, a).parts;
      cards.push(`<article class="opt"><p class="eyebrow">Option ${cards.length + 1} · Add capacity</p><h3>Keep every date for about ${inr(op.add.cost)} a month</h3>
        <ul class="plain">${parts.map((p) => `<li>${esc(p.what)}: ${inr(p.cost)}</li>`).join('')}</ul>
        <button class="btn btn-sm btn-primary" type="button" data-act="apply">Apply these steps</button></article>`);
    } else {
      cards.push(`<article class="opt"><p class="eyebrow">Option ${cards.length + 1} · Add capacity</p><h3>Overtime and hiring alone do not fix this</h3>
        <p>Up to 3 hours of overtime, 14 more B2B tailors, 8 more D2C tailors and 4 finishing helpers still leave an order late. ${sc.fabricDelay.days && sc.fabricDelay.fabric ? 'The delay is fabric, so people cannot buy it back.' : 'Split the work, move a date or send stitching outside.'}</p></article>`);
    }
    if (c.verdict === 'breaks') {
      cards.push(`<article class="opt"><p class="eyebrow">Option ${cards.length + 1} · Push it through</p><h3>Accept ${days(c.addedLateDays)} of delay elsewhere</h3>
        <p>${c.worse.slice(0, 4).map((m) => `${esc(m.id)} +${m.late - m.wasLate}`).join(', ')}${c.worse.length > 4 ? ` and ${c.worse.length - 4} more` : ''}. ${c.b2bHit ? 'This touches B2B orders. Try "B2B first" under who goes first.' : 'B2B orders keep their dates.'}</p></article>`);
    }
    return `<div class="opts">${cards.join('')}</div>`;
  }

  function loadGrid(sim, active) {
    const lastUsed = Math.max(...sim.wcs.map((c) => c.used.findLastIndex((u) => u > 1)));
    const nWeeks = clamp(Math.ceil((lastUsed + 1) / WEEK) + 1, 5, HORIZON / WEEK);
    const cell = (c, i) => {
      const u = sim.weeks[i].util[c.id], was = base.weeks[i].util[c.id];
      const p = Math.round(u * 100), d = Math.round((u - was) * 100);
      const full = u >= 0.995;
      return `<td class="heat ${p >= 62 ? 'on-dark' : ''} ${full ? 'is-full' : ''}" style="--u:${Math.min(100, p)}%" data-tip="${esc(c.name)}, week of ${esc(fmtDate(sim.weeks[i].start))}|${p}% of ${num(sum(c.cap.slice(i * WEEK, (i + 1) * WEEK)))} standard minutes${active && d ? `|Before the change: ${Math.round(was * 100)}%` : ''}${full ? '|Full: no spare minutes this week' : ''}"><span class="num">${p}</span>${active && Math.abs(d) >= 3 ? `<i class="delta" aria-label="${d > 0 ? 'up' : 'down'} ${Math.abs(d)} points">${d > 0 ? '▲' : '▼'}</i>` : ''}</td>`;
    };
    return `<section class="panel"><div class="panel-head"><h2>Load on each work centre</h2><span class="faint">% of standard minutes used, by week</span></div>
      <div class="table-wrap"><table class="table heat-table"><thead><tr><th>Work centre</th><th class="num">People</th>${Array.from({ length: nWeeks }, (_, i) => `<th class="num">${esc(fmtDate(sim.weeks[i].start))}</th>`).join('')}</tr></thead>
      <tbody>${sim.wcs.map((c) => `<tr><td><button class="link" type="button" data-focus="${c.node}">${esc(c.name)}</button></td><td class="num">${c.opsPlanned}${c.opsPlanned !== c.ops ? ` <span class="faint">(${c.ops})</span>` : ''}</td>${Array.from({ length: nWeeks }, (_, i) => cell(c, i)).join('')}</tr>`).join('')}</tbody></table></div>
      <p class="chart-note faint">Darker means busier. A bold edge marks a week with no spare minutes.${active ? ' ▲ ▼ show a change of 3 points or more against the current plan.' : ''} The plan starts every order as early as it can, so busy weeks come first.</p></section>`;
  }

  function timeline(sim, active) {
    const b = by(base.orders, 'id');
    const rows = sim.orders.slice().sort((x, y) => x.dueDay - y.dueDay);
    const D = clamp(Math.max(...rows.map((o) => Math.max(o.finishDay ?? HORIZON - 1, Math.min(o.dueDay, HORIZON - 1)))) + 3, 24, HORIZON);
    const pc = (d) => `${(clamp(d, 0, D) / D * 100).toFixed(2)}%`;
    const ticks = Array.from({ length: Math.floor(D / WEEK) + 1 }, (_, i) => i * WEEK).filter((d) => d < D);
    const row = (o) => {
      const was = b[o.id];
      const s = o.firstDay ?? o.startDay, e = (o.finishDay ?? D - 1) + 1;
      const due = o.dueDay + 1;
      const moved = active && was && (was.finishDay !== o.finishDay);
      const status = o.unfinished ? '<span class="pill pill-crit">Over 8 weeks</span>' : o.late ? `<span class="pill pill-crit">${o.late} d late</span>` : o.slack <= 1 ? `<span class="pill pill-warn">${o.slack} d spare</span>` : `<span class="pill pill-ok">${o.slack} d spare</span>`;
      const tipText = `${o.id} · ${o.customer}|${num(o.qty)} × ${o.name}${o.qty !== o.baseQty ? ` (was ${num(o.baseQty)})` : ''}|Due ${fmtDay(o.due)}|${o.unfinished ? 'Does not finish within 8 weeks' : `Finishes ${fmtDay(o.finish)}`}${moved && was.finish ? `|Before the change: ${fmtDay(was.finish)}` : ''}${o.startDay > 0 ? `|Fabric ready ${fmtDay(sim.dates[Math.min(HORIZON - 1, o.startDay)])}` : ''}`;
      return `<li class="g-row ${o.isNew ? 'is-new' : ''}" data-tip="${esc(tipText)}">
        <div class="g-name"><strong>${esc(o.isNew ? o.label : o.id)}</strong><span class="muted">${o.isNew ? esc(CH[o.channel].name) : `${esc(o.name)} · ${num(o.qty)}`}</span></div>
        <div class="g-track">
          ${o.startDay > 0 && (o.firstDay ?? 99) >= o.startDay ? `<i class="g-wait" style="left:0;width:${pc(o.startDay)}"></i>` : ''}
          ${moved && was.finishDay !== null ? `<i class="g-ghost" style="left:${pc(was.firstDay ?? was.startDay)};width:${pc(was.finishDay + 1 - (was.firstDay ?? was.startDay))}"></i>` : ''}
          <i class="g-bar" style="left:${pc(s)};width:${pc(Math.max(0.6, Math.min(e, Math.max(due, s + 0.6)) - s))};--c:var(${CH[o.channel].v})"></i>
          ${e > due ? `<i class="g-bar g-late" style="left:${pc(Math.max(due, s))};width:${pc(e - Math.max(due, s))}"></i>` : ''}
          <i class="g-due" style="left:${pc(due)}"></i>
        </div>
        <div class="g-end"><span class="num">${o.finish ? esc(fmtDate(o.finish)) : '–'}</span>${status}</div></li>`;
    };
    return `<section class="panel"><div class="panel-head"><h2>Order timeline</h2>
        <div class="g-legend">${Object.values(CH).map((c) => `<span><i style="background:var(${c.v})"></i>${c.name}</span>`).join('')}<span><i class="lg-due"></i>Due</span><span><i class="lg-late"></i>Late</span>${active ? '<span><i class="lg-ghost"></i>Before</span>' : ''}</div></div>
      <div class="gantt" style="--D:${D}">
        <div class="g-row g-axis"><div class="g-name"></div><div class="g-track">${ticks.map((d) => `<span style="left:${pc(d)}">${esc(fmtDate(sim.dates[d]))}</span>`).join('')}</div><div class="g-end eyebrow">Finishes</div></div>
        <ul>${rows.map(row).join('')}</ul>
      </div>
      <p class="chart-note faint">Each bar runs from first cut to last piece packed. Working days, Monday to Saturday. A hatched start means the order is waiting for fabric.</p></section>`;
  }

  function movedTable(op) {
    const c = op.pushCmp; if (!c.moved.length) return '';
    return `<section class="panel"><div class="panel-head"><h2>What moves</h2><span class="count">${c.moved.length}</span></div>
      <div class="table-wrap"><table class="table"><thead><tr><th>Order</th><th>Customer</th><th>Due</th><th>Was finishing</th><th>Now finishing</th><th class="num">Change</th><th>Result</th></tr></thead><tbody>
      ${c.moved.map((m) => `<tr><td class="mono">${esc(m.id)}</td><td>${esc(m.customer)}</td><td>${esc(fmtDate(m.due))}</td><td>${m.wasFinish ? esc(fmtDate(m.wasFinish)) : '–'}</td><td>${m.finish ? esc(fmtDate(m.finish)) : 'After 8 weeks'}</td><td class="num">${m.delta > 0 ? '+' : ''}${m.delta} d</td><td>${m.late ? `<span class="pill pill-crit">${m.late} d late</span>` : m.delta < 0 ? '<span class="pill pill-ok">Earlier</span>' : '<span class="pill pill-ok">Still on time</span>'}</td></tr>`).join('')}
      </tbody></table></div></section>`;
  }

  function materials() {
    const items = [];
    for (const r of sc.runs) items.push({ label: r.label, sample: r.kind === 'sample', m: materialCheck(state, r.style, r.qty) });
    if (sc.uplift) {
      for (const st of state.styles) {
        const extra = sum(state.orders.filter((o) => o.style === st.id && o.channel !== 'SAMPLE' && o.done.pack < o.qty), (o) => Math.round(o.qty * sc.uplift / 100));
        if (extra) items.push({ label: `${num(extra)} more ${st.name}`, m: materialCheck(state, st.id, extra) });
      }
    }
    if (!items.length) return '';
    const path = (x) => {
      const m = x.m;
      if (m.path === 'stock') return '<span class="pill pill-ok">On the racks</span>';
      if (m.path === 'dye') return `<span class="pill pill-warn">Dye first</span> <span class="muted">about ${ASSUME.dyeDays} working days</span>`;
      return `<span class="pill pill-crit">Buy and dye</span> <span class="muted">about ${ASSUME.millDays + ASSUME.dyeDays} working days${m.auditCouldCover ? `. The unaudited store holds ${num(m.unaudited)} m of this fabric: auditing it could cover the gap` : ''}</span>`;
    };
    const short = items.filter((x) => x.m.path === 'buy' && !x.sample);
    return `<section class="panel"><div class="panel-head"><h2>Fabric and thread for the extra pieces</h2></div>
      <div class="table-wrap"><table class="table"><thead><tr><th>For</th><th>Fabric</th><th class="num">Needs</th><th class="num">Free, dyed</th><th class="num">Passed, undyed</th><th>Fabric</th><th>Thread cones</th></tr></thead><tbody>
      ${items.map((x) => `<tr><td>${esc(x.label)}</td><td><span class="sw" style="background:${x.m.shade.hex}"></span>${esc(x.m.fabric.name)}, ${esc(x.m.shade.name)}</td><td class="num">${num(x.m.need)} m</td><td class="num">${num(x.m.freeDyed)} m</td><td class="num">${num(x.m.greige)} m</td><td>${path(x)}</td>
        <td>${x.m.conesGap ? `<span class="pill pill-crit">Short ${x.m.conesGap}</span>` : '<span class="pill pill-ok">Enough</span>'} <span class="muted num">${x.m.conesNeed} of ${x.m.conesHave}</span></td></tr>`).join('')}
      </tbody></table></div>
      ${short.length ? `<p class="chart-note"><strong>Fabric, not people, sets the date here.</strong> ${short.length === 1 ? 'This line' : `${short.length} of these lines`} cannot start cutting until new fabric is bought, inspected and dyed. More tailors do not change that.</p>` : ''}
      ${sc.runs.some((r) => r.kind === 'sample') ? '<p class="chart-note faint">Sample runs are assumed to cut from sample yardage already on hand, so fabric does not hold up their start.</p>' : ''}</section>`;
  }

  let lastOp = null;
  function renderResults() {
    const active = !isEmpty(sc);
    const op = lastOp = active ? options(state, sc, base) : { base, push: base, pushCmp: compare(base, base), wait: null, add: null };
    const sim = op.push;
    renderKpis(sim, active);
    results.innerHTML = verdictBlock(op, active) + optionCards(op, active) + (active ? movedTable(op) : '') + materials() + timeline(sim, active) + loadGrid(sim, active)
      + `<p class="faint fine assume">Planning assumptions (example values): a sample takes about 3× the stitching minutes of a production piece; dyeing takes ${ASSUME.dyeDays} working days and new fabric ${ASSUME.millDays}; overtime ${inr(ASSUME.overtimeRate)} an hour per person; an added tailor ${inr(ASSUME.tailorMonthly)} a month. All order, stock and capacity figures are example data.</p>`;
  }

  results.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.focus) ctx.go('map', { focus: b.dataset.focus });
    else if (b.dataset.act === 'map') ctx.go('map');
    else if (b.dataset.act === 'apply' && lastOp?.add) { sc = { ...lastOp.add.scenario }; renderBuilder(); commit(true); toast('Steps applied. Every order keeps its date.'); }
  });

  // Hover and tap detail for chart marks
  const showTip = (target, x, y) => {
    tip.innerHTML = target.dataset.tip.split('|').map((l, i) => (i === 0 ? `<strong>${l}</strong>` : `<span>${l}</span>`)).join('');
    tip.hidden = false;
    const host = el.querySelector('.workspace').getBoundingClientRect(), r = tip.getBoundingClientRect();
    tip.style.left = `${clamp(x - host.left + 14, 8, host.width - r.width - 8)}px`;
    tip.style.top = `${y - host.top + el.querySelector('.workspace').scrollTop + 16}px`;
  };
  results.addEventListener('pointermove', (e) => { const t = e.target.closest('[data-tip]'); if (t) showTip(t, e.clientX, e.clientY); else tip.hidden = true; });
  results.addEventListener('pointerleave', () => { tip.hidden = true; });

  const off = store.on((s, topic) => {
    if (topic === 'scenario') return;
    state = s; base = simulate(state); sc = state.scenario ? { ...emptyScenario(), ...state.scenario } : emptyScenario();
    renderBuilder(); renderResults();
  });

  renderBuilder(); renderResults();
  return () => { off(); clearTimeout(timer); };
}
