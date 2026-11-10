// The planner. A finite-capacity, forward scheduler over daily buckets:
// every work centre has a number of standard minutes per day, every order needs minutes at
// five stages, and each day the orders are served in priority order from what is left.
// A piece can only move to the next stage the day after it left the previous one.
// The same function answers "what is the plan" and "what if", so the map, the Production room
// and (later) the agents all read one schedule.
//
// Pure: no records, no browser. It takes a plain plan state (web/js/plan.js builds one from
// live records):
//   styles       [{ id, name, fabric, fabricName, shade, metres, cones, cost, dyeCost, smv: { cut, stitch, finish, qc, pack } }]
//   workCentres  [{ id, name, node, stage, ops, mins, eff, role }]   ids are the fixed pools below
//   orders       [{ id, ref?, channel: 'B2B'|'D2C'|'STORE'|'SAMPLE', customer, style, qty, due: 'YYYY-MM-DD', done: { cut, … }, readyDay? }]
//   rolls        [{ fabric, shade, metres, status, reservedFor }]
//   threads      [{ shade, cones }]
//   today?       'YYYY-MM-DD' to plan from a fixed day instead of the clock (tests)

import { today, addWorkdays, workdayIndex, sum, by } from './util.js';

export const STAGES = ['cut', 'stitch', 'finish', 'qc', 'pack'];
export const STAGE_NAMES = { cut: 'Cutting', stitch: 'Stitching', finish: 'Finishing', qc: 'Final QC', pack: 'Packing' };
export const HORIZON = 48;            // working days simulated (8 weeks of Mon–Sat)
export const WEEK = 6;
export const POOL_IDS = ['cut', 'stitch_b2b', 'stitch_d2c', 'stitch_sample', 'finish', 'qc', 'pack'];

// Planning assumptions: defaults, overridden per call with an `assume` object.
export const ASSUME = {
  sampleFactor: 3,     // a sample takes about 3× the stitching minutes of a production piece
  dyeDays: 6,          // working days to dye and return passed greige fabric
  millDays: 14,        // working days for a mill to deliver new greige fabric
  absentDays: 12,      // how long an absence shock lasts
  overtimeRate: 140,   // ₹ per person per overtime hour
  tailorMonthly: 24000, // ₹ per added tailor per month
  helperMonthly: 17000, // ₹ per added finishing helper per month
  jobworkPremium: 38,  // ₹ extra per piece stitched outside
  fullAt: 0.97,        // share of a week's minutes at which a work centre counts as full
};
// How much of the sample factor each stage feels: all of it at stitching, most at cutting,
// a little at finishing and QC, none at packing (3 gives 2.5, 3, 1.5, 1.5, 1).
const SAMPLE_SHARE = { cut: 0.75, stitch: 1, finish: 0.25, qc: 0.25, pack: 0 };

/** The defaults with any valid numbers from `over` laid on top. */
export function assumptions(over) {
  const a = { ...ASSUME };
  for (const k of Object.keys(ASSUME)) {
    const raw = over?.[k];
    if (raw === undefined || raw === null || raw === '') continue;
    const v = Number(raw);
    if (Number.isFinite(v) && v >= 0) a[k] = v;
  }
  return a;
}
const sampleFactor = (A, stage) => 1 + Math.max(0, A.sampleFactor - 1) * SAMPLE_SHARE[stage];

export const emptyScenario = () => ({
  runs: [],            // extra work: { id, kind: 'sample'|'scale', label, style, qty, dueDays, route, channel }
  uplift: 0,           // % more pieces on every open customer order
  absent: 0,           // tailors out for the next two weeks
  fabricDelay: { fabric: '', days: 0 }, // a faulty lot: this fabric is late by N working days
  overtime: 0,         // hours per day, whole floor
  extraB2B: 0, extraD2C: 0, extraSample: 0, extraFinish: 0, // people added
  jobwork: 0,          // % of B2B stitching sent to outside job-workers
  priority: 'due',     // 'due' | 'b2b' | 'new'
});
export const isEmpty = (sc) => !sc || (!sc.runs?.length && !sc.uplift && !sc.absent && !(sc.fabricDelay?.days && sc.fabricDelay.fabric)
  && !sc.overtime && !sc.extraB2B && !sc.extraD2C && !sc.extraSample && !sc.extraFinish && !sc.jobwork && (sc.priority || 'due') === 'due');

const POOLS = {
  B2B: ['stitch_b2b'], D2C: ['stitch_d2c'], STORE: ['stitch_d2c'], SAMPLE: ['stitch_sample'],
};
const ROUTES = { sampling: ['stitch_sample'], d2c: ['stitch_sample', 'stitch_d2c'], b2b: ['stitch_sample', 'stitch_b2b'] };
export const ROUTE_NAMES = { sampling: 'Sampling room only', d2c: 'Sampling room + D2C line', b2b: 'Sampling room + B2B line' };

const n0 = (v) => { const x = Number(v); return Number.isFinite(x) && x > 0 ? x : 0; };
const asDate = (d) => {
  const x = d instanceof Date ? new Date(d) : new Date(/^\d{4}-\d{2}-\d{2}$/.test(String(d)) ? `${d}T00:00:00` : d);
  return Number.isNaN(x.getTime()) ? null : x;
};
/** Day 0 of the plan: today, or the next working day when today is a Sunday. */
const dayZero = (state) => addWorkdays((state.today && asDate(state.today)) || today(), 0);

/** Free stock and lead time for extra pieces of a style. Null when the style is not known. */
export function materialCheck(state, styleId, qty, assume) {
  const A = assumptions(assume);
  const st = (state.styles || []).find((s) => s.id === styleId);
  if (!st) return null;
  const rolls = state.rolls || [];
  const shade = String(st.shade ?? '').trim().toLowerCase();
  const need = st.fabric ? Math.ceil(n0(qty) * n0(st.metres)) : 0;
  const m = (f) => sum(rolls.filter(f), (r) => n0(r.metres));
  const freeDyed = m((r) => r.status === 'dyed' && !r.reservedFor && r.fabric === st.fabric && String(r.shade ?? '').trim().toLowerCase() === shade);
  const greige = m((r) => r.status === 'passed' && !r.reservedFor && r.fabric === st.fabric);
  const unchecked = m((r) => r.status === 'received' && r.fabric === st.fabric);
  let readyDay = 0, path = 'stock';
  if (freeDyed < need) {
    if (freeDyed + greige >= need) { readyDay = A.dyeDays; path = 'dye'; }
    else { readyDay = A.millDays + A.dyeDays; path = 'buy'; }
  }
  const conesNeed = Math.ceil((n0(qty) / 100) * n0(st.cones));
  const conesHave = sum((state.threads || []).filter((t) => String(t.shade ?? '').trim().toLowerCase() === shade), (t) => n0(t.cones));
  const buy = Math.max(0, need - freeDyed - greige), gap = Math.max(0, need - freeDyed);
  return {
    style: st, fabricName: st.fabricName || '', shade: st.shade || '', need, freeDyed, greige, unchecked,
    gap, buy, readyDay, path,
    checkCouldCover: path === 'buy' && freeDyed + greige + unchecked >= need,
    conesNeed, conesHave, conesGap: Math.max(0, conesNeed - conesHave),
    fabricCost: buy * n0(st.cost) + gap * n0(st.dyeCost),
  };
}

/** Run the schedule. `sc` is a scenario or null for the plan as it stands. */
export function simulate(state, sc = null, assume = null) {
  sc = { ...emptyScenario(), ...(sc || {}) };
  const A = assumptions(assume);
  const t0 = dayZero(state);
  const styles = by(state.styles || [], 'id');
  const dates = Array.from({ length: HORIZON }, (_, i) => addWorkdays(t0, i));
  const skipped = [];

  // ── Capacity: standard minutes per work centre per day ──
  const centres = state.workCentres || [];
  const isLine = (w) => w.id === 'stitch_b2b' || w.id === 'stitch_d2c';
  const stitchOps = sum(centres.filter(isLine), (w) => n0(w.ops));
  const wcs = centres.map((w) => {
    const base = n0(w.ops);
    let ops = base;
    if (w.id === 'stitch_b2b') ops += n0(sc.extraB2B);
    if (w.id === 'stitch_d2c') ops += n0(sc.extraD2C);
    if (w.id === 'stitch_sample') ops += n0(sc.extraSample);
    if (w.id === 'finish') ops += n0(sc.extraFinish);
    const out = isLine(w) && stitchOps > 0 ? Math.round(n0(sc.absent) * (base / stitchOps)) : 0;
    const perHead = (n0(w.mins) + n0(sc.overtime) * 60) * n0(w.eff);
    const cap = dates.map((_, d) => Math.max(0, ops - (d < A.absentDays ? out : 0)) * perHead);
    return { ...w, ops: base, opsPlanned: ops, cap, used: cap.map(() => 0) };
  });
  const wcById = by(wcs, 'id');
  const stageWc = { cut: 'cut', finish: 'finish', qc: 'qc', pack: 'pack' };

  // ── Demand: open orders, plus whatever the scenario adds ──
  const jobs = [];
  for (const o of state.orders || []) {
    const done = o.done || {};
    const base = n0(o.qty);
    if (!base || n0(done.pack) >= base) continue;
    const st = styles[o.style];
    if (!st) { skipped.push({ id: o.id, ref: o.ref, style: o.style, reason: 'style' }); continue; }
    const due = asDate(o.due);
    if (!due) { skipped.push({ id: o.id, ref: o.ref, style: o.style, reason: 'due' }); continue; }
    const sample = o.channel === 'SAMPLE';
    const qty = sample ? base : Math.round(base * (1 + n0(sc.uplift) / 100));
    let startDay = n0(done.cut) >= base ? 0 : n0(o.readyDay);
    if (sc.fabricDelay?.days && sc.fabricDelay.fabric && sc.fabricDelay.fabric === st.fabric && n0(done.cut) < qty) startDay += n0(sc.fabricDelay.days);
    jobs.push({
      id: o.id, ref: o.ref, channel: o.channel, customer: o.customer, style: o.style, name: st.name, qty, baseQty: base, sample, isNew: false,
      dueDay: workdayIndex(t0, due), due, startDay, pools: POOLS[o.channel] || [], done: STAGES.map((s) => Math.min(qty, n0(done[s]))),
      smv: STAGES.map((s) => n0(st.smv?.[s]) * (sample ? sampleFactor(A, s) : 1)),
    });
  }
  for (const run of sc.runs || []) {
    const st = styles[run.style];
    if (!st || !n0(run.qty)) { skipped.push({ id: run.id, style: run.style, reason: st ? 'qty' : 'style', isNew: true }); continue; }
    const sample = run.kind === 'sample';
    const mat = materialCheck(state, run.style, run.qty, A);
    const dueDay = Number.isFinite(+run.dueDays) ? +run.dueDays : 0;
    jobs.push({
      id: run.id, channel: sample ? 'SAMPLE' : run.channel, customer: sample ? 'Merchandising' : (run.channel === 'B2B' ? 'New B2B demand' : 'New D2C demand'),
      style: run.style, name: st.name, qty: n0(run.qty), baseQty: n0(run.qty), sample, isNew: true, label: run.label,
      dueDay, due: dueDay < 1000 ? addWorkdays(t0, Math.max(0, dueDay)) : null, startDay: sample ? 0 : mat.readyDay, material: mat,
      pools: (sample ? ROUTES[run.route || 'sampling'] : POOLS[run.channel]) || [], done: STAGES.map(() => 0),
      smv: STAGES.map((s) => n0(st.smv?.[s]) * (sample ? sampleFactor(A, s) : 1)),
    });
  }
  // Outside job-work takes a share of B2B stitching minutes off the line.
  if (sc.jobwork) for (const j of jobs) if (j.channel === 'B2B') j.smv[1] *= 1 - Math.min(100, n0(sc.jobwork)) / 100;

  const rank = (j) => (sc.priority === 'new' ? (j.isNew ? 0 : 1) : sc.priority === 'b2b' ? (j.channel === 'B2B' ? 0 : 1) : 0);
  const b2bFirst = (j) => (j.channel === 'B2B' ? 0 : 1);
  jobs.sort((a, b) => rank(a) - rank(b) || a.dueDay - b.dueDay || b2bFirst(a) - b2bFirst(b));

  // ── Day loop, run twice ──
  // Pass 1 finds when each order reaches a stitching line. Pass 2 holds cutting back to two days
  // before that, so fabric is cut just ahead of need instead of piling up as bundles.
  const EPS = 1e-6;
  const start0 = jobs.map((j) => j.done.slice());
  for (let pass = 0; pass < 2; pass++) {
    wcs.forEach((w) => w.used.fill(0));
    jobs.forEach((j, i) => {
      j.cutFrom = pass === 0 ? j.startDay : Math.max(j.startDay, (j.stitchDay ?? j.startDay) - 2);
      j.done = start0[i].slice(); j.prev = j.done.slice(); j.finishDay = null; j.firstDay = null; j.stitchDay = pass === 0 ? null : j.stitchDay; j.stageEnd = STAGES.map(() => null);
    });
    for (let d = 0; d < HORIZON; d++) {
      const left = Object.fromEntries(wcs.map((w) => [w.id, w.cap[d]]));
      for (const j of jobs) {
        if (j.finishDay !== null || d < j.startDay) continue;
        for (let k = 0; k < STAGES.length; k++) {
          if (k === 0 && d < j.cutFrom) continue;
          let avail = (k === 0 ? j.qty : j.prev[k - 1]) - j.done[k];
          if (avail > EPS) {
            const pools = k === 1 ? j.pools : [stageWc[STAGES[k]]];
            for (const p of pools) {
              // A stage that takes no minutes passes straight through; a pool that is missing or
              // has nothing left today gives nothing.
              const room = left[p];
              const units = j.smv[k] > 0 ? (room > EPS ? Math.min(avail, room / j.smv[k]) : 0) : avail;
              if (!(units > EPS)) continue;
              j.done[k] += units; avail -= units;
              if (j.smv[k] > 0) { left[p] -= units * j.smv[k]; wcById[p].used[d] += units * j.smv[k]; }
              if (j.firstDay === null) j.firstDay = d;
              if (k === 1 && pass === 0 && j.stitchDay === null) j.stitchDay = d;
              if (avail <= EPS) break;
            }
          }
          if (j.stageEnd[k] === null && j.done[k] >= j.qty - EPS) j.stageEnd[k] = d;
        }
        if (j.done[4] >= j.qty - EPS) j.finishDay = d;
      }
      for (const j of jobs) j.prev = j.done.slice();
    }
  }

  const orders = jobs.map((j) => {
    const fin = j.finishDay;
    const late = fin === null ? Math.max(0, HORIZON - j.dueDay) : Math.max(0, fin - j.dueDay);
    return {
      id: j.id, ref: j.ref, channel: j.channel, customer: j.customer, style: j.style, name: j.name, qty: j.qty, baseQty: j.baseQty, isNew: j.isNew, label: j.label,
      sample: j.sample, dueDay: j.dueDay, due: j.due, startDay: j.startDay, firstDay: j.firstDay,
      finishDay: fin, finish: fin === null ? null : dates[fin], late, slack: fin === null ? j.dueDay - HORIZON : j.dueDay - fin, unfinished: fin === null,
      stageEnd: j.stageEnd, material: j.material, pools: j.pools,
    };
  });

  const weeks = [];
  for (let w = 0; w < HORIZON / WEEK; w++) {
    const span = [w * WEEK, (w + 1) * WEEK];
    weeks.push({
      start: dates[span[0]], end: dates[span[1] - 1],
      util: Object.fromEntries(wcs.map((c) => [c.id, sum(c.used.slice(...span)) / Math.max(1, sum(c.cap.slice(...span)))])),
    });
  }
  return { t0, dates, wcs, orders, weeks, skipped, scenario: sc, assume: A };
}

/** Set a scenario against the plan as it stands. */
export function compare(base, scen, assume = null) {
  const A = assumptions(assume || scen.assume);
  const b = by(base.orders, 'id');
  const moved = [];
  for (const o of scen.orders) {
    const was = b[o.id];
    if (!was) continue;
    const delta = (o.finishDay ?? HORIZON) - (was.finishDay ?? HORIZON);
    if (delta !== 0 || o.late !== was.late) moved.push({ ...o, delta, wasLate: was.late, wasFinish: was.finish, newlyLate: o.late > 0 && was.late === 0, worse: o.late > was.late });
  }
  moved.sort((x, y) => (y.late - y.wasLate) - (x.late - x.wasLate) || y.delta - x.delta);
  const runs = scen.orders.filter((o) => o.isNew);
  const hot = [];
  for (const c of scen.wcs) {
    scen.weeks.forEach((w, i) => {
      const u = w.util[c.id] ?? 0, was = base.weeks[i]?.util[c.id] ?? 0;
      if (u >= A.fullAt && u - was > 0.02) hot.push({ wc: c.id, name: c.name, node: c.node, week: i, util: u, was });
    });
  }
  const worse = moved.filter((m) => m.worse);
  const lateRuns = runs.filter((r) => r.late > 0);
  const addedLateDays = sum(worse, (m) => m.late - m.wasLate);
  const verdict = worse.length ? 'breaks' : lateRuns.length ? 'late' : 'fits';
  return { moved, worse, runs, lateRuns, hot, verdict, addedLateDays, b2bHit: worse.filter((m) => m.channel === 'B2B').length };
}

/** What the levers in a scenario cost per month. */
export function leverCost(state, sc, assume = null) {
  const A = assumptions(assume);
  sc = { ...emptyScenario(), ...(sc || {}) };
  const tailors = n0(sc.extraB2B) + n0(sc.extraD2C) + n0(sc.extraSample);
  const ops = sum(state.workCentres || [], (w) => n0(w.ops)) + tailors + n0(sc.extraFinish);
  const parts = [];
  if (sc.overtime) parts.push({ what: `${sc.overtime} h overtime a day, whole floor`, cost: ops * sc.overtime * A.overtimeRate * 26 });
  if (tailors) parts.push({ what: `${tailors} more tailor${tailors > 1 ? 's' : ''}`, cost: tailors * A.tailorMonthly });
  if (sc.extraFinish) parts.push({ what: `${sc.extraFinish} more finishing helper${sc.extraFinish > 1 ? 's' : ''}`, cost: sc.extraFinish * A.helperMonthly });
  if (sc.jobwork) {
    const pieces = sum((state.orders || []).filter((o) => o.channel === 'B2B'), (o) => Math.max(0, n0(o.qty) - n0(o.done?.stitch))) * sc.jobwork / 100;
    parts.push({ what: `${sc.jobwork}% of B2B stitching outside`, cost: pieces * A.jobworkPremium });
  }
  return { parts, total: sum(parts, (p) => p.cost) };
}

/**
 * Three ways to answer a request, so the conversation is about choices:
 *  push  – do it as entered and show what slips
 *  wait  – the earliest date the new work finishes if nothing else is allowed to move
 *  add   – the cheapest extra capacity that keeps every order where it was
 */
export function options(state, sc, assume = null, base = simulate(state, null, assume)) {
  sc = { ...emptyScenario(), ...(sc || {}) };
  const push = simulate(state, sc, assume);
  const pushCmp = compare(base, push, assume);

  let wait = null;
  if (sc.runs.length) {
    // New work goes to the back of every queue: it only uses minutes nobody else needed.
    const patient = { ...sc, priority: 'due', runs: sc.runs.map((r) => ({ ...r, dueDays: 9999 })) };
    const sim = simulate(state, patient, assume);
    wait = { sim, runs: sim.orders.filter((o) => o.isNew).map((o) => ({ id: o.id, label: o.label, finishDay: o.finishDay, finish: o.finish })) };
  }

  let add = null;
  if (pushCmp.verdict !== 'fits') {
    // Only try levers on work centres that exist.
    const has = (id) => (state.workCentres || []).some((w) => w.id === id);
    const b2bSteps = has('stitch_b2b') ? [0, 3, 6, 10, 14] : [0];
    const d2cSteps = has('stitch_d2c') ? [0, 2, 4, 6, 8] : [0];
    const finishSteps = has('finish') ? [0, 1, 2, 4] : [0];
    const sampleSteps = has('stitch_sample') && sc.runs.some((r) => r.kind === 'sample') ? [0, 2, 4, 6] : [0];
    let best = null;
    for (const overtime of [0, 1, 2, 3]) for (const xb of b2bSteps) for (const xd of d2cSteps) for (const xf of finishSteps) for (const xs of sampleSteps) {
      const trial = { ...sc, overtime: Math.max(sc.overtime, overtime), extraB2B: sc.extraB2B + xb, extraD2C: sc.extraD2C + xd, extraFinish: sc.extraFinish + xf, extraSample: (sc.extraSample || 0) + xs };
      const cost = leverCost(state, trial, assume).total;
      if (best && cost >= best.cost) continue;
      const cmp = compare(base, simulate(state, trial, assume), assume);
      if (cmp.verdict === 'fits') best = { scenario: trial, cost, cmp };
    }
    add = best;
  }
  return { base, push, pushCmp, wait, add };
}
