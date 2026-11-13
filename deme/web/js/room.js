// The Production room: the live plan, and a place to test a change before making it.
// The plan comes from plan.js (live records through the scheduler in shared/engine.js).
// A change being tested lives in this module's memory only: nothing is saved until a sample
// request is sent or a work order is raised.

import { api, data } from './api.js';
import { esc, inr, num, fmtDate, toast, info, busy } from './ui.js';
import { compare, options, leverCost, materialCheck, emptyScenario, isEmpty, HORIZON, WEEK, ROUTE_NAMES } from '../shared/engine.js';
import { planGaps, currentPlan, planAssumptions, savePlanAssumptions } from './plan.js';
import { sum, by, fmtDay, addWorkdays, workdayIndex, iso, clamp } from '../shared/util.js';

const CH = { B2B: { name: 'B2B', v: '--ch-b2b' }, D2C: { name: 'Shopify', v: '--ch-d2c' }, STORE: { name: 'Bombay store', v: '--ch-store' }, SAMPLE: { name: 'Samples', v: '--ch-sample' } };
const REPLAN_ON = ['*', 'styles', 'workstations', 'work_orders', 'items', 'rolls', 'dye_lots', 'customers'];
const ASSUME_FIELDS = [
  ['sampleFactor', 'Sample time factor', 'Times a production piece', 1, 10, 0.1],
  ['dyeDays', 'Dyeing days', 'Working days', 0, 60, 1],
  ['millDays', 'New-fabric days', 'Working days', 0, 120, 1],
  ['overtimeRate', 'Overtime rate', 'Rupees per person per hour', 0, 100000, 1],
  ['tailorMonthly', 'Tailor, monthly cost', 'Rupees', 0, 10000000, 100],
  ['helperMonthly', 'Finishing helper, monthly cost', 'Rupees', 0, 10000000, 100],
  ['jobworkPremium', 'Job-work premium per piece', 'Rupees', 0, 100000, 1],
];
const ABOUT = {
  room: 'The plan for the next eight weeks of working days, Monday to Saturday. It is worked out from the open work orders, the people on each work centre and the standard minutes each style takes. Each day the orders are served in due-date order from the minutes every work centre has left. Test a change to see what it moves before anyone is asked to do it.',
  test: 'Add extra work, or something that goes wrong, and the plan is worked out again beside the current one. Nothing here is saved and no order changes until you send a sample request or raise a work order. When a change does not fit, you get up to three ways through: give the new work a later date and move nothing, add the cheapest capacity that keeps every date, or push it through and see which orders slip.',
  moves: 'Orders whose finish date is different if you make this change. The change is counted in working days against the current plan.',
  materials: 'Free dyed fabric in the store is used first. If passed, undyed fabric covers the rest, it has to be dyed before cutting. Otherwise new fabric has to be bought, inspected and dyed, and more people cannot bring that date forward. Sample runs are taken to cut from sample yardage already in the room, so fabric does not hold up their start. The lead times come from the planning assumptions.',
  timeline: 'Each bar runs from first cut to last piece packed, in working days, Monday to Saturday. The upright marker is the due date and a red hatched length is time past it. A grey hatched start means the order is waiting for fabric. While a change is being tested, a thin grey line shows where the order was before.',
  load: 'The share of each work centre\'s standard minutes the plan uses in each week. Darker means busier. A ringed cell is a week with no spare minutes. Arrows mark a change of 3 points or more against the current plan. Every order starts as early as it can, so the busy weeks come first.',
  assume: 'These are your own planning numbers, not records from the ERP. They set how long a sample takes against a production piece, how long dyeing and new fabric take, and what overtime, hiring and outside stitching cost. They are saved on this device only. Change one and the plan is worked out again.',
};
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const days = (n) => plural(n, 'working day');
const some = (list, max, f) => list.slice(0, max).map(f).join(', ') + (list.length > max ? ` and ${list.length - max} more` : '');

// The change being tested and the half-filled "add work" form. Kept between visits to this
// screen, gone on reload, never sent anywhere.
let sc = emptyScenario();
let draft = { kind: 'sample', style: '', qty: 20, due: '', route: 'sampling', channel: 'D2C' };

export function mount(el, ctx) {
  let state = null, base = null, assume = planAssumptions(), t0 = null, gaps = [];
  let timer = 0, assumeTimer = 0, hold = false, lastOp = null;

  el.innerHTML = `
    <div class="workspace room"><div class="workspace-inner">
      <div class="view-head">
        <div class="title-row"><h1 class="reveal">Production room</h1>${info(ABOUT.room, 'Production room')}</div>
        <span class="eyebrow">As of ${esc(fmtDay(new Date()))}</span>
      </div>
      <section class="room-gaps panel" aria-label="What is missing" hidden></section>
      <div class="room-plan" hidden>
        <div class="kpis" id="roomKpis"></div>
        <div class="room-grid">
          <section class="panel builder" aria-label="Test a change"></section>
          <div class="room-main">
            <div class="results"></div>
            <details class="panel assume"></details>
          </div>
        </div>
      </div>
      <div class="tip" hidden></div>
    </div></div>`;
  const $ = (s) => el.querySelector(s);
  const gapsEl = $('.room-gaps'), planEl = $('.room-plan'), builder = $('.builder'), results = $('.results'), assumeEl = $('.assume'), tip = $('.tip');
  const has = (id) => state.workCentres.some((w) => w.id === id);

  // ───────── Nothing to plan yet ─────────
  function renderGaps() {
    gapsEl.innerHTML = `
      <div class="gaps-head"><p class="eyebrow">Before a plan can be drawn</p><h2>${gaps.length === 1 ? 'One thing is missing' : `${gaps.length} things are missing`}</h2></div>
      <ol class="gaps-list">${gaps.map((g, i) => `<li class="rise" style="--i:${i}"><span class="num faint">${String(i + 1).padStart(2, '0')}</span><span class="gap-text">${esc(g.text)}</span>${
        g.entity && data.canWrite(g.entity) ? `<button class="btn btn-sm ${i === 0 ? 'btn-primary' : ''}" type="button" data-add="${esc(g.entity)}">Add ${esc((data.entity(g.entity)?.one || 'record').toLowerCase())}</button>` : ''}</li>`).join('')}</ol>`;
  }
  gapsEl.addEventListener('click', (e) => { const b = e.target.closest('[data-add]'); if (b) ctx.openEntity(b.dataset.add, { add: true }); });

  // ───────── Builder ─────────
  const UNIT = { uplift: '%', jobwork: '%', overtime: ' h a day' };
  const slider = (id, label, val, min, max, step) => `
    <div class="field slider"><label for="${id}">${label}<output id="${id}Out" class="num">${val}${UNIT[id] || ''}</output></label>
    <input type="range" id="${id}" data-k="${id}" min="${min}" max="${max}" step="${step}" value="${val}"></div>`;
  const pickable = () => { const live = state.styles.filter((s) => s.status !== 'discontinued'); return live.length ? live : state.styles; };
  const fabrics = () => [...new Map(state.styles.filter((s) => s.fabric).map((s) => [s.fabric, s.fabricName || 'Fabric'])).entries()];
  const routes = () => Object.keys(ROUTE_NAMES).filter((r) => r === 'sampling' || has(`stitch_${r}`));
  const channels = () => [['D2C', 'Shopify and store', 'stitch_d2c'], ['B2B', 'B2B', 'stitch_b2b']].filter((c) => has(c[2]));

  /** Keep the scenario and the form pointing at records and work centres that still exist. */
  function settle() {
    const known = new Set(state.styles.map((s) => s.id));
    sc.runs = sc.runs.filter((r) => known.has(r.style));
    if (sc.fabricDelay.fabric && !fabrics().some(([id]) => id === sc.fabricDelay.fabric)) sc.fabricDelay = { fabric: '', days: 0 };
    const styles = pickable();
    if (!styles.some((s) => s.id === draft.style)) draft.style = styles[0]?.id || '';
    const kinds = [has('stitch_sample') && 'sample', channels().length && 'scale'].filter(Boolean);
    if (!kinds.includes(draft.kind)) draft.kind = kinds[0] || 'sample';
    if (!routes().includes(draft.route)) draft.route = 'sampling';
    if (!channels().some((c) => c[0] === draft.channel)) draft.channel = channels()[0]?.[0] || 'D2C';
    if (!draft.due || draft.due < iso(t0)) draft.due = iso(addWorkdays(t0, 10));
  }

  function renderBuilder() {
    const styleOpts = pickable().map((s) => `<option value="${esc(s.id)}" ${s.id === draft.style ? 'selected' : ''}>${esc(s.name)}</option>`).join('');
    const canSample = has('stitch_sample'), canScale = channels().length > 0;
    const lines = has('stitch_b2b') || has('stitch_d2c');
    builder.innerHTML = `
      <div class="panel-head"><div class="title-row"><h2>Test a change</h2>${info(ABOUT.test, 'Test a change')}</div><button class="btn btn-sm btn-quiet" type="button" data-act="clear">Clear</button></div>
      <div class="panel-pad stack">
        <fieldset class="group">
          <legend>Add work</legend>
          <div class="seg" role="group" aria-label="Kind of work">
            <button type="button" data-kind="sample" aria-pressed="${draft.kind === 'sample'}" ${canSample ? '' : 'disabled'}>Sample run</button>
            <button type="button" data-kind="scale" aria-pressed="${draft.kind === 'scale'}" ${canScale ? '' : 'disabled'}>More of a style</button>
          </div>
          <div class="field"><label for="dStyle">${draft.kind === 'sample' ? 'Closest existing style' : 'Style'}</label><select class="select" id="dStyle">${styleOpts}</select></div>
          <div class="two">
            <div class="field"><label for="dQty">Pieces</label><input class="input num" id="dQty" type="number" min="1" max="5000" value="${draft.qty}"></div>
            <div class="field"><label for="dDue">Needed by</label><input class="input" id="dDue" type="date" min="${iso(t0)}" max="${iso(base.dates[HORIZON - 1])}" value="${esc(draft.due)}"></div>
          </div>
          ${draft.kind === 'sample'
            ? `<div class="field"><label for="dRoute">Who stitches it</label><select class="select" id="dRoute">${routes().map((k) => `<option value="${k}" ${k === draft.route ? 'selected' : ''}>${esc(ROUTE_NAMES[k])}</option>`).join('')}</select></div>`
            : `<div class="field"><span class="label">For</span><div class="seg" role="group" aria-label="Channel">${channels().map(([k, name]) => `<button type="button" data-channel="${k}" aria-pressed="${draft.channel === k}">${name}</button>`).join('')}</div></div>`}
          <div><button class="btn btn-primary" type="button" data-act="add" ${draft.style && (canSample || canScale) ? '' : 'disabled'}>Add to the plan</button></div>
          <ul class="runs" id="runList"></ul>
        </fieldset>
        <fieldset class="group">
          <legend>Things that go wrong</legend>
          ${slider('uplift', 'Every customer order grows', sc.uplift, 0, 60, 5)}
          ${lines ? slider('absent', 'Tailors out, next two weeks', sc.absent, 0, 12, 1) : ''}
          ${fabrics().length ? `<div class="two">
            <div class="field"><label for="fdFabric">Faulty fabric lot</label><select class="select" id="fdFabric"><option value="">None</option>${fabrics().map(([id, name]) => `<option value="${esc(id)}" ${sc.fabricDelay.fabric === id ? 'selected' : ''}>${esc(name)}</option>`).join('')}</select></div>
            <div class="field"><label for="fdDays">Days lost</label><input class="input num" id="fdDays" type="number" min="0" max="30" value="${sc.fabricDelay.days}"></div>
          </div>` : ''}
        </fieldset>
        <fieldset class="group">
          <legend>What you can do about it</legend>
          ${slider('overtime', 'Overtime, whole floor', sc.overtime, 0, 3, 1)}
          ${has('stitch_b2b') ? slider('extraB2B', 'More tailors, B2B line', sc.extraB2B, 0, 14, 1) : ''}
          ${has('stitch_d2c') ? slider('extraD2C', 'More tailors, D2C line', sc.extraD2C, 0, 8, 1) : ''}
          ${has('stitch_sample') ? slider('extraSample', 'More sample tailors', sc.extraSample, 0, 6, 1) : ''}
          ${has('finish') ? slider('extraFinish', 'More finishing helpers', sc.extraFinish, 0, 4, 1) : ''}
          ${has('stitch_b2b') ? slider('jobwork', 'B2B stitching sent outside', sc.jobwork, 0, 40, 5) : ''}
          <div class="field"><span class="label">Who goes first</span>
            <div class="seg" role="group" aria-label="Queue rule">
              ${[['due', 'Due date'], ['b2b', 'B2B first'], ['new', 'New work first']].map(([k, n]) => `<button type="button" data-priority="${k}" aria-pressed="${sc.priority === k}">${n}</button>`).join('')}
            </div>
          </div>
        </fieldset>
      </div>`;
    renderRuns();
  }
  function renderRuns() {
    const ul = builder.querySelector('#runList'); if (!ul) return;
    const act = (r) => (r.kind === 'sample'
      ? (r.sent ? `<span class="tag tag-ok">Sent ${esc(r.sent)}</span>` : data.canWrite('sample_requests') ? `<button class="btn btn-sm btn-outline" type="button" data-send="${r.id}">Send as sample request</button>` : '')
      : (data.canWrite('work_orders') ? `<button class="btn btn-sm btn-outline" type="button" data-raise="${r.id}">Raise work order</button>` : ''));
    ul.innerHTML = sc.runs.map((r) => `<li>
      <div class="run-text"><strong>${esc(r.label)}</strong><span class="muted">${r.kind === 'sample' ? esc(ROUTE_NAMES[r.route]) : r.channel === 'B2B' ? 'B2B line' : 'D2C line'} · by ${esc(fmtDate(`${r.due}T00:00:00`))}</span></div>
      <div class="run-acts">${act(r)}<button class="btn btn-sm btn-quiet" type="button" data-remove="${r.id}" aria-label="Remove ${esc(r.label)}">Remove</button></div></li>`).join('');
  }

  function commit(now = false) {
    clearTimeout(timer);
    if (now) renderResults(); else timer = setTimeout(renderResults, 70);
  }

  builder.addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset.k) { sc[t.dataset.k] = +t.value; builder.querySelector(`#${t.id}Out`).textContent = t.value + (UNIT[t.dataset.k] || ''); commit(); }
    else if (t.id === 'fdDays') { sc.fabricDelay.days = clamp(Math.round(+t.value) || 0, 0, 30); commit(); }
    else if (t.id === 'dQty') draft.qty = clamp(Math.round(+t.value) || 1, 1, 5000);
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
    if (b.dataset.kind) { draft.kind = b.dataset.kind; renderBuilder(); }
    else if (b.dataset.channel) { draft.channel = b.dataset.channel; renderBuilder(); }
    else if (b.dataset.priority) { sc.priority = b.dataset.priority; builder.querySelectorAll('[data-priority]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); commit(true); }
    else if (b.dataset.remove) { sc.runs = sc.runs.filter((r) => r.id !== b.dataset.remove); renderRuns(); commit(true); }
    else if (b.dataset.act === 'clear') { sc = emptyScenario(); renderBuilder(); commit(true); }
    else if (b.dataset.act === 'add') {
      const st = by(state.styles, 'id')[draft.style]; if (!st) return;
      const dueDays = clamp(workdayIndex(t0, new Date(`${draft.due}T00:00:00`)), 1, HORIZON - 1);
      const due = iso(addWorkdays(t0, dueDays));
      const id = `NEW-${1 + Math.max(0, ...sc.runs.map((r) => +r.id.split('-')[1]))}`;
      sc.runs.push(draft.kind === 'sample'
        ? { id, kind: 'sample', label: `${draft.qty} samples (${st.name} block)`, style: draft.style, qty: draft.qty, dueDays, due, route: draft.route }
        : { id, kind: 'scale', label: `${draft.qty} more ${st.name}`, style: draft.style, qty: draft.qty, dueDays, due, channel: draft.channel });
      renderRuns(); commit(true);
    }
    else if (b.dataset.send) {
      const run = sc.runs.find((r) => r.id === b.dataset.send); if (!run) return;
      busy(b, async () => {
        const out = await api.create('sample_requests', { style: run.style, qty: run.qty, neededBy: run.due, notes: `Tested in the Production room. ${ROUTE_NAMES[run.route]}.` });
        run.sent = out.doc?.no || 'request'; renderRuns();
        toast(`Sample request ${out.doc?.no || ''} is sent for ${plural(run.qty, 'piece')}.`);
      });
    }
    else if (b.dataset.raise) {
      const run = sc.runs.find((r) => r.id === b.dataset.raise); if (!run) return;
      busy(b, async () => {
        let out;
        hold = true; // the new order replaces the test run in one step, not two
        try { out = await api.create('work_orders', { channel: run.channel, style: run.style, qty: run.qty, due: run.due }); } finally { hold = false; }
        sc.runs = sc.runs.filter((r) => r !== run); refresh();
        toast(`Work order ${out.doc?.no || ''} is raised for ${plural(run.qty, 'piece')}.`);
      });
    }
  });

  // ───────── Results ─────────
  // The day a line next has spare minutes, counted from when work first reaches it.
  const fullUntil = (sim, wc) => {
    const c = sim.wcs.find((w) => w.id === wc);
    const busy = (i) => c.used[i] / Math.max(1, c.cap[i]) >= 0.85;
    const from = c.used.findIndex((_, i) => busy(i));
    if (from < 0) return 'Not full';
    const d = c.used.findIndex((_, i) => i > from && !busy(i));
    return d < 0 ? 'Beyond 8 weeks' : fmtDate(sim.dates[d]);
  };
  const openBtn = (o, text = o.id) => (o.ref ? `<button class="link" type="button" data-open="${esc(o.ref)}">${esc(text)}</button>` : esc(text));

  function renderKpis(sim, active) {
    const late = sim.orders.filter((o) => o.late > 0);
    const wasLate = base.orders.filter((o) => o.late > 0).length;
    const lateDays = sum(late, (o) => o.late), wasDays = sum(base.orders, (o) => o.late);
    const k = (label, value, note, st = '') => `<div class="kpi" data-state="${st}"><div class="kpi-label">${label}</div><div class="kpi-value">${value}</div><div class="kpi-note">${note}</div></div>`;
    const lines = ['stitch_b2b', 'stitch_d2c'].filter(has);
    if (!lines.length && has('stitch_sample')) lines.push('stitch_sample');
    $('#roomKpis').innerHTML =
      k('Orders on track', `${sim.orders.length - late.length} of ${sim.orders.length}`, active ? `${base.orders.length - wasLate} of ${base.orders.length} before the change` : late.length ? `${esc(some(late, 3, (o) => o.id))} late` : 'Every order meets its date', late.length ? (late.length > wasLate ? 'crit' : 'warn') : 'ok')
      + k('Working days late, all orders', num(lateDays), active ? `${num(wasDays)} before the change` : 'Sum across late orders', lateDays > wasDays ? 'crit' : '')
      + lines.map((id) => k(`${esc(sim.wcs.find((w) => w.id === id).name)} full until`, esc(fullUntil(sim, id)), active ? `Before: ${esc(fullUntil(base, id))}` : 'First day with spare minutes')).join('');
  }

  /** Orders the plan could not place, and orders with no fabric to cut from. */
  function flags(sim) {
    const out = [];
    const left = sim.skipped.filter((s) => !s.isNew);
    if (left.length) out.push(`<p class="flag"><span class="tag tag-warn">Not planned</span><span>${left.map((s) => `${openBtn(s)} ${s.reason === 'due' ? 'has no due date' : 'has no style'}`).join(', ')}</span></p>`);
    const refs = by(state.orders, 'id');
    const bare = (state.missing?.fabric || []).filter((id) => refs[id]);
    if (bare.length) out.push(`<p class="flag"><span class="tag tag-warn">No dyed fabric in store or at the dyer</span><span>${bare.map((id) => openBtn(refs[id])).join(', ')}</span></p>`);
    return out.join('');
  }

  function verdictBlock(op, active) {
    const c = op.pushCmp;
    if (!active) {
      const late = base.orders.filter((o) => o.late > 0);
      return `<div class="room-verdict" data-v="${late.length ? 'late' : 'fits'}"><div class="row"><p class="eyebrow">The plan as it stands</p><span class="tag tag-${late.length ? 'crit' : 'ok'}">${late.length ? 'Late' : 'On time'}</span></div>
        <h2>${late.length ? `${plural(late.length, 'order')} will miss the due date` : 'Every order meets its date'}</h2>
        ${late.length ? `<ul class="plain">${late.slice(0, 6).map((o) => `<li>${openBtn(o)} · ${esc(o.customer)} · ${num(o.qty)} ${esc(o.name)}: ${o.unfinished ? 'not finished within 8 weeks' : `finishes ${esc(fmtDay(o.finish))}, ${days(o.late)} late`}</li>`).join('')}${late.length > 6 ? `<li>and ${late.length - 6} more</li>` : ''}</ul>` : ''}
        ${flags(base)}</div>`;
    }
    const worst = c.worse[0];
    const head = c.verdict === 'fits' ? 'It fits. No order gets later.'
      : c.verdict === 'late' ? 'Nothing else moves, but the new work is late.'
      : `${plural(c.worse.length, 'order')} slip${c.worse.length === 1 ? 's' : ''} past the due date${c.b2bHit ? `, ${c.b2bHit} of them B2B` : ', none of them B2B'}.`;
    const lines = c.runs.map((r) => `<li>${esc(r.label)}: ${r.unfinished ? 'does not finish within 8 weeks' : `finishes ${esc(fmtDay(r.finish))}`}${r.late ? `, ${days(r.late)} after it is needed` : r.unfinished ? '' : ', on time'}</li>`);
    if (worst) lines.push(`<li>Hardest hit: ${openBtn(worst)} · ${esc(worst.customer)}, now ${days(worst.late)} late</li>`);
    const cost = leverCost(state, sc, assume);
    if (cost.total) lines.push(`<li>Steps switched on: about ${esc(inr(cost.total))} a month</li>`);
    const tag = { fits: ['ok', 'Fits'], late: ['warn', 'New work late'], breaks: ['crit', 'Dates slip'] }[c.verdict];
    return `<div class="room-verdict" data-v="${c.verdict}"><div class="row"><p class="eyebrow">If you do this</p><span class="tag tag-${tag[0]}">${tag[1]}</span></div><h2>${head}</h2>
      ${lines.length ? `<ul class="plain">${lines.join('')}</ul>` : ''}${flags(op.push)}</div>`;
  }

  function optionCards(op, active) {
    if (!active) return '';
    const c = op.pushCmp, cards = [];
    if (c.verdict === 'fits') return '';
    if (op.wait && op.wait.runs.length) {
      cards.push(`<article class="opt"><p class="eyebrow">Option 1 · Move nothing</p><h3>Give it a later date</h3>
        <ul class="plain">${op.wait.runs.map((r) => `<li>${esc(r.label)}: <strong>${r.finish ? esc(fmtDay(r.finish)) : 'after 8 weeks'}</strong></li>`).join('')}</ul></article>`);
    }
    if (op.add) {
      const parts = leverCost(state, op.add.scenario, assume).parts;
      cards.push(`<article class="opt"><p class="eyebrow">Option ${cards.length + 1} · Add capacity</p><h3>Keep every date for about ${esc(inr(op.add.cost))} a month</h3>
        <ul class="plain">${parts.map((p) => `<li>${esc(p.what)}: ${esc(inr(p.cost))}</li>`).join('')}</ul>
        <button class="btn btn-sm btn-primary" type="button" data-act="apply">Apply these steps</button></article>`);
    } else {
      const most = ['3 hours of overtime', has('stitch_b2b') && '14 more B2B tailors', has('stitch_d2c') && '8 more D2C tailors', has('finish') && '4 finishing helpers'].filter(Boolean);
      cards.push(`<article class="opt"><p class="eyebrow">Option ${cards.length + 1} · Add capacity</p><h3>Overtime and hiring alone do not fix this</h3>
        <p>${sc.fabricDelay.days && sc.fabricDelay.fabric ? 'The delay is fabric. People cannot buy it back.' : `Still late with ${most.join(', ')}.`}</p></article>`);
    }
    if (c.verdict === 'breaks') {
      cards.push(`<article class="opt"><p class="eyebrow">Option ${cards.length + 1} · Push it through</p><h3>Accept ${days(c.addedLateDays)} of delay elsewhere</h3>
        <p>${some(c.worse, 4, (m) => `<span class="nb">${esc(m.id)} +${m.late - m.wasLate}</span>`)}</p>
        <p>${c.b2bHit ? `${plural(c.b2bHit, 'B2B order')} slip${c.b2bHit === 1 ? 's' : ''}` : 'B2B orders keep their dates'}</p></article>`);
    }
    return `<div class="opts">${cards.join('')}</div>`;
  }

  function loadGrid(sim, active) {
    const lastUsed = Math.max(0, ...sim.wcs.map((c) => c.used.findLastIndex((u) => u > 1)));
    const nWeeks = clamp(Math.ceil((lastUsed + 1) / WEEK) + 1, 5, HORIZON / WEEK);
    const cell = (c, i) => {
      const u = sim.weeks[i].util[c.id], was = base.weeks[i].util[c.id] ?? 0;
      const p = Math.round(u * 100), d = Math.round((u - was) * 100);
      const full = u >= 0.995;
      const tipText = `${c.name}, week of ${fmtDate(sim.weeks[i].start)}|${p}% of ${num(sum(c.cap.slice(i * WEEK, (i + 1) * WEEK)))} standard minutes${active && d ? `|Before the change: ${Math.round(was * 100)}%` : ''}${full ? '|Full: no spare minutes this week' : ''}`;
      return `<td class="heat ${p >= 52 ? 'on-dark' : ''} ${full ? 'is-full' : ''}" style="--u:${Math.min(100, p)}%" data-tip="${esc(tipText)}"><span class="num">${p}</span>${active && Math.abs(d) >= 3 ? `<i class="delta" aria-label="${d > 0 ? 'up' : 'down'} ${Math.abs(d)} points">${d > 0 ? '▲' : '▼'}</i>` : ''}</td>`;
    };
    return `<section class="panel"><div class="panel-head"><div class="title-row"><h2>Load on each work centre</h2>${info(ABOUT.load, 'Load on each work centre')}</div><span class="eyebrow">% of standard minutes, by week</span></div>
      <div class="table-wrap"><table class="table heat-table"><thead><tr><th>Work centre</th><th class="num">People</th>${Array.from({ length: nWeeks }, (_, i) => `<th class="num">${esc(fmtDate(sim.weeks[i].start))}</th>`).join('')}</tr></thead>
      <tbody>${sim.wcs.map((c) => `<tr><td><button class="link" type="button" data-focus="${esc(c.node)}">${esc(c.name)}</button></td><td class="num">${num(c.opsPlanned)}${c.opsPlanned !== c.ops ? ` <span class="faint">(${num(c.ops)})</span>` : ''}</td>${Array.from({ length: nWeeks }, (_, i) => cell(c, i)).join('')}</tr>`).join('')}</tbody></table></div></section>`;
  }

  function timeline(sim, active) {
    const b = by(base.orders, 'id');
    const rows = sim.orders.slice().sort((x, y) => x.dueDay - y.dueDay);
    const head = `<div class="panel-head"><div class="title-row"><h2>Order timeline</h2>${info(ABOUT.timeline, 'Order timeline')}</div>
        <div class="g-legend">${Object.values(CH).map((c) => `<span><i style="background:var(${c.v})"></i>${c.name}</span>`).join('')}<span><i class="lg-due"></i>Due</span><span><i class="lg-late"></i>Late</span>${active ? '<span><i class="lg-ghost"></i>Before</span>' : ''}</div></div>`;
    if (!rows.length) return `<section class="panel">${head}<div class="empty"><h3>No orders in the plan</h3></div></section>`;
    const D = clamp(Math.max(...rows.map((o) => Math.max(o.finishDay ?? HORIZON - 1, Math.min(o.dueDay, HORIZON - 1)))) + 3, 24, HORIZON);
    const pc = (d) => `${(clamp(d, 0, D) / D * 100).toFixed(2)}%`;
    const ticks = Array.from({ length: Math.floor(D / WEEK) + 1 }, (_, i) => i * WEEK).filter((d) => d < D);
    const noFabric = new Set(state.missing?.fabric || []);
    const row = (o) => {
      const was = b[o.id];
      const s = o.firstDay ?? o.startDay, e = (o.finishDay ?? D - 1) + 1;
      const due = o.dueDay + 1;
      const moved = active && was && (was.finishDay !== o.finishDay);
      const status = o.unfinished ? '<span class="tag tag-crit">Over 8 weeks</span>' : o.late ? `<span class="tag tag-crit">${o.late} d late</span>` : `<span class="tag tag-${o.slack <= 1 ? 'warn' : 'ok'}">${o.slack} d spare</span>`;
      const tipText = `${o.isNew ? o.label : `${o.id} · ${o.customer}`}|${num(o.qty)} × ${o.name}${o.qty !== o.baseQty ? ` (was ${num(o.baseQty)})` : ''}|${o.due ? `Due ${fmtDay(o.due)}` : 'No date'}|${o.unfinished ? 'Does not finish within 8 weeks' : `Finishes ${fmtDay(o.finish)}`}${moved && was.finish ? `|Before the change: ${fmtDay(was.finish)}` : ''}${o.startDay > 0 ? `|Fabric ready ${fmtDay(sim.dates[Math.min(HORIZON - 1, o.startDay)])}` : ''}${noFabric.has(o.id) ? '|No dyed fabric in store or at the dyer' : ''}`;
      return `<li class="g-row ${o.isNew ? 'is-new' : ''}" ${o.ref ? `data-open="${esc(o.ref)}"` : ''} data-tip="${esc(tipText)}">
        <div class="g-name">${o.isNew ? `<strong>${esc(o.label)}</strong>` : `<strong>${openBtn(o)}</strong>`}<span class="muted">${o.isNew ? esc(CH[o.channel]?.name || '') : `${esc(o.name)} · ${num(o.qty)}`}</span></div>
        <div class="g-track">
          ${o.startDay > 0 && (o.firstDay ?? 99) >= o.startDay ? `<i class="g-wait" style="left:0;width:${pc(o.startDay)}"></i>` : ''}
          ${moved && was.finishDay !== null ? `<i class="g-ghost" style="left:${pc(was.firstDay ?? was.startDay)};width:${pc(was.finishDay + 1 - (was.firstDay ?? was.startDay))}"></i>` : ''}
          <i class="g-bar" style="left:${pc(s)};width:${pc(Math.max(0.6, Math.min(e, Math.max(due, s + 0.6)) - s))};--c:var(${CH[o.channel]?.v || '--ink-3'})"></i>
          ${e > due ? `<i class="g-bar g-late" style="left:${pc(Math.max(due, s))};width:${pc(e - Math.max(due, s))}"></i>` : ''}
          <i class="g-due" style="left:${pc(due)}"></i>
        </div>
        <div class="g-end"><span class="num">${o.finish ? esc(fmtDate(o.finish)) : '–'}</span>${status}</div></li>`;
    };
    return `<section class="panel">${head}
      <div class="gantt" style="--D:${D}">
        <div class="g-row g-axis"><div class="g-name"></div><div class="g-track">${ticks.map((d) => `<span style="left:${pc(d)}">${esc(fmtDate(sim.dates[d]))}</span>`).join('')}</div><div class="g-end eyebrow">Finishes</div></div>
        <ul>${rows.map(row).join('')}</ul>
      </div></section>`;
  }

  function movedTable(op) {
    const c = op.pushCmp; if (!c.moved.length) return '';
    return `<section class="panel"><div class="panel-head"><div class="title-row"><h2>What moves</h2>${info(ABOUT.moves, 'What moves')}</div><span class="count">${c.moved.length}</span></div>
      <div class="table-wrap"><table class="table tight"><thead><tr><th>Order</th><th>Customer</th><th>Due</th><th>Was finishing</th><th>Now finishing</th><th class="num">Change</th><th>Result</th></tr></thead><tbody>
      ${c.moved.map((m) => `<tr ${m.ref ? `data-open="${esc(m.ref)}"` : ''}><td class="mono">${openBtn(m)}</td><td>${esc(m.customer)}</td><td>${m.due ? esc(fmtDate(m.due)) : '–'}</td><td>${m.wasFinish ? esc(fmtDate(m.wasFinish)) : '–'}</td><td>${m.finish ? esc(fmtDate(m.finish)) : 'After 8 weeks'}</td><td class="num">${m.delta > 0 ? '+' : ''}${m.delta} d</td><td>${m.late ? `<span class="tag tag-crit">${m.late} d late</span>` : m.delta < 0 ? '<span class="tag tag-ok">Earlier</span>' : '<span class="tag tag-ok">Still on time</span>'}</td></tr>`).join('')}
      </tbody></table></div></section>`;
  }

  function materials() {
    const items = [];
    for (const r of sc.runs) { const m = materialCheck(state, r.style, r.qty, assume); if (m) items.push({ label: r.label, sample: r.kind === 'sample', m }); }
    if (sc.uplift) {
      for (const st of state.styles) {
        const extra = sum(state.orders.filter((o) => o.style === st.id && o.channel !== 'SAMPLE' && o.done.pack < o.qty), (o) => Math.round(o.qty * sc.uplift / 100));
        const m = extra ? materialCheck(state, st.id, extra, assume) : null;
        if (m) items.push({ label: `${num(extra)} more ${st.name}`, m });
      }
    }
    if (!items.length) return '';
    const path = (x) => {
      const m = x.m;
      if (!m.style.fabric) return '<span class="tag tag-plain">No fabric on the style</span>';
      if (x.sample) return '<span class="tag tag-plain">Sample yardage</span>';
      if (m.path === 'stock') return '<span class="tag tag-ok">In store</span>';
      if (m.path === 'dye') return `<span class="tag tag-warn">Dye first</span> <span class="muted">${days(assume.dyeDays)}</span>`;
      return `<span class="tag tag-crit">Buy and dye</span> <span class="muted">${days(assume.millDays + assume.dyeDays)}${m.checkCouldCover ? `, or inspect ${num(m.unchecked)} m waiting` : ''}</span>`;
    };
    return `<section class="panel"><div class="panel-head"><div class="title-row"><h2>Fabric and thread for the extra pieces</h2>${info(ABOUT.materials, 'Fabric and thread')}</div></div>
      <div class="table-wrap"><table class="table tight"><thead><tr><th>For</th><th>Fabric</th><th class="num">Needs</th><th class="num">Free, dyed</th><th class="num">Passed, undyed</th><th>Where from</th><th>Thread cones</th></tr></thead><tbody>
      ${items.map((x) => `<tr><td class="wrap">${esc(x.label)}</td><td>${esc([x.m.fabricName, x.m.shade].filter(Boolean).join(', ') || '–')}</td><td class="num">${num(x.m.need)} m</td><td class="num">${num(x.m.freeDyed)} m</td><td class="num">${num(x.m.greige)} m</td><td>${path(x)}</td>
        <td>${x.m.conesGap ? `<span class="tag tag-crit">Short ${num(x.m.conesGap)}</span>` : '<span class="tag tag-ok">Enough</span>'} <span class="muted num">${num(x.m.conesNeed)} of ${num(x.m.conesHave)}</span></td></tr>`).join('')}
      </tbody></table></div></section>`;
  }

  function renderResults() {
    if (!state) return;
    const active = !isEmpty(sc);
    const op = lastOp = active ? options(state, sc, assume, base) : { base, push: base, pushCmp: compare(base, base, assume), wait: null, add: null };
    const sim = op.push;
    renderKpis(sim, active);
    results.innerHTML = verdictBlock(op, active) + optionCards(op, active) + (active ? movedTable(op) : '') + materials() + timeline(sim, active) + loadGrid(sim, active);
    tip.hidden = true;
  }

  results.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b?.dataset.focus) ctx.go('map', { focus: b.dataset.focus });
    else if (b?.dataset.act === 'apply' && lastOp?.add) { sc = { ...lastOp.add.scenario }; renderBuilder(); commit(true); toast('Steps applied. Every order keeps its date.'); }
    else { const row = e.target.closest('[data-open]'); if (row) ctx.openEntity('work_orders', { id: row.dataset.open }); }
  });

  // Hover and tap detail for chart marks
  const showTip = (target, x, y) => {
    tip.innerHTML = target.dataset.tip.split('|').map((l, i) => (i === 0 ? `<strong>${esc(l)}</strong>` : `<span>${esc(l)}</span>`)).join('');
    tip.hidden = false;
    const host = tip.offsetParent.getBoundingClientRect(), r = tip.getBoundingClientRect();
    tip.style.left = `${clamp(x - host.left + 14, 0, Math.max(0, host.width - r.width))}px`;
    tip.style.top = `${y - host.top + 16}px`;
  };
  const tipAt = (e) => { const t = e.target.closest('[data-tip]'); if (t) showTip(t, e.clientX, e.clientY); else tip.hidden = true; };
  results.addEventListener('pointermove', tipAt);
  results.addEventListener('pointerdown', tipAt);
  results.addEventListener('pointerleave', () => { tip.hidden = true; });

  // ───────── Planning assumptions ─────────
  function renderAssume() {
    assumeEl.innerHTML = `
      <summary><span class="title-row"><h2>Planning assumptions</h2>${info(ABOUT.assume, 'Planning assumptions')}</span><span class="eyebrow">Saved on this device</span></summary>
      <div class="panel-pad stack">
        <div class="assume-grid">${ASSUME_FIELDS.map(([k, label, unit, min, max, step]) => `<div class="field"><label for="as-${k}">${label}</label><input class="input num" id="as-${k}" data-assume="${k}" type="number" inputmode="decimal" min="${min}" max="${max}" step="${step}" value="${assume[k]}"><span class="hint">${unit}</span></div>`).join('')}</div>
        <div><button class="btn btn-sm btn-quiet" type="button" data-act="defaults">Use standard numbers</button></div>
      </div>`;
  }
  function saveAssume() {
    clearTimeout(assumeTimer);
    const next = {};
    for (const [k, , , min, max] of ASSUME_FIELDS) {
      const input = assumeEl.querySelector(`[data-assume="${k}"]`);
      next[k] = input.value === '' || !Number.isFinite(+input.value) ? assume[k] : clamp(+input.value, min, max);
      if (document.activeElement !== input) input.value = next[k];
    }
    savePlanAssumptions(next);
    refresh();
  }
  assumeEl.addEventListener('input', (e) => { if (e.target.dataset.assume) { clearTimeout(assumeTimer); assumeTimer = setTimeout(saveAssume, 350); } });
  assumeEl.addEventListener('change', (e) => { if (e.target.dataset.assume) saveAssume(); });
  assumeEl.addEventListener('click', (e) => {
    if (e.target.closest('[data-act="defaults"]')) { clearTimeout(assumeTimer); savePlanAssumptions(null); assume = planAssumptions(); renderAssume(); refresh(); toast('Standard planning numbers are back.'); }
  });

  // ───────── Live data ─────────
  /** Read the plan again from the records as they are now. The change being tested is kept. */
  function refresh() {
    gaps = planGaps();
    const plan = gaps.length ? null : currentPlan();
    if (!gaps.length && !plan) gaps = [{ text: 'The plan could not be worked out', entity: '' }];
    gapsEl.hidden = !gaps.length; planEl.hidden = !!gaps.length;
    if (gaps.length) { state = null; tip.hidden = true; renderGaps(); return; }
    state = plan.state; base = plan.sim; t0 = base.t0; assume = base.assume;
    settle();
    renderBuilder(); renderResults();
  }
  const off = data.on((touched) => { if (!hold && touched.some((t) => REPLAN_ON.includes(t))) refresh(); });

  renderAssume(); refresh();
  return () => { off(); clearTimeout(timer); clearTimeout(assumeTimer); };
}
