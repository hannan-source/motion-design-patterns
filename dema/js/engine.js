// The planner. A finite-capacity, forward scheduler over daily buckets:
// every work centre has a number of standard minutes per day, every order needs minutes at
// five stages, and each day the orders are served in priority order from what is left.
// A piece can only move to the next stage the day after it left the previous one.
// The same function answers "what is the plan" and "what if", so the map, the Production room
// and (later) the agents all read one schedule.

import { today, addWorkdays, workdayIndex, sum, by } from './util.js';
import { FABRICS, SHADES } from './seed.js';

export const STAGES = ['cut', 'stitch', 'finish', 'qc', 'pack'];
export const STAGE_NAMES = { cut: 'Cutting', stitch: 'Stitching', finish: 'Finishing', qc: 'Final QC', pack: 'Packing' };
export const HORIZON = 48;            // working days simulated (8 weeks of Mon–Sat)
export const WEEK = 6;

// Planning assumptions. Example values, shown in the UI, to be replaced with Dema's own.
export const ASSUME = {
  sampleFactor: { cut: 2.5, stitch: 3, finish: 1.5, qc: 1.5, pack: 1 }, // a sample takes about 3× a production piece
  dyeDays: 6,          // working days to dye and return passed greige fabric
  millDays: 14,        // working days for a mill to deliver new greige fabric
  absentDays: 12,      // how long an absence shock lasts
  overtimeRate: 140,   // ₹ per person per overtime hour
  tailorMonthly: 24000, // ₹ per added tailor per month
  helperMonthly: 17000, // ₹ per added finishing helper per month
  jobworkPremium: 38,  // ₹ extra per piece stitched outside
};

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
export const isEmpty = (sc) => !sc || (!sc.runs.length && !sc.uplift && !sc.absent && !(sc.fabricDelay?.days && sc.fabricDelay.fabric)
  && !sc.overtime && !sc.extraB2B && !sc.extraD2C && !sc.extraSample && !sc.extraFinish && !sc.jobwork && sc.priority === 'due');

const POOLS = {
  B2B: ['stitch_b2b'], D2C: ['stitch_d2c'], STORE: ['stitch_d2c'], SAMPLE: ['stitch_sample'],
};
const ROUTES = { sampling: ['stitch_sample'], d2c: ['stitch_sample', 'stitch_d2c'], b2b: ['stitch_sample', 'stitch_b2b'] };
export const ROUTE_NAMES = { sampling: 'Sampling room only', d2c: 'Sampling room + D2C line', b2b: 'Sampling room + B2B line' };

/** Free stock and lead time for extra pieces of a style. */
export function materialCheck(state, styleId, qty) {
  const st = by(state.styles, 'id')[styleId];
  const need = Math.ceil(qty * st.metres);
  const m = (f) => sum(state.rolls.filter(f), (r) => r.metres);
  const freeDyed = m((r) => r.status === 'dyed' && !r.reservedFor && r.fabric === st.fabric && r.shade === st.shade);
  const greige = m((r) => r.status === 'passed' && r.fabric === st.fabric);
  const unaudited = m((r) => r.status === 'unaudited' && r.fabric === st.fabric);
  let readyDay = 0, path = 'stock';
  if (freeDyed < need) {
    if (freeDyed + greige >= need) { readyDay = ASSUME.dyeDays; path = 'dye'; }
    else { readyDay = ASSUME.millDays + ASSUME.dyeDays; path = 'buy'; }
  }
  const conesNeed = Math.ceil((qty / 100) * st.cones);
  const conesHave = state.threads.find((t) => t.shade === st.shade)?.cones ?? 0;
  return {
    style: st, fabric: FABRICS[st.fabric], shade: SHADES[st.shade], need, freeDyed, greige, unaudited,
    gap: Math.max(0, need - freeDyed), buy: Math.max(0, need - freeDyed - greige), readyDay, path,
    auditCouldCover: path === 'buy' && freeDyed + greige + unaudited >= need,
    conesNeed, conesHave, conesGap: Math.max(0, conesNeed - conesHave),
    fabricCost: Math.max(0, need - freeDyed - greige) * FABRICS[st.fabric].cost + Math.max(0, need - freeDyed) * FABRICS[st.fabric].dye,
  };
}

/** Run the schedule. `sc` is a scenario or null for the plan as it stands. */
export function simulate(state, sc = null) {
  sc = sc || emptyScenario();
  const t0 = today();
  const styles = by(state.styles, 'id');
  const dates = Array.from({ length: HORIZON }, (_, i) => addWorkdays(t0, i));

  // ── Capacity: standard minutes per work centre per day ──
  const stitchOps = sum(state.workCentres.filter((w) => w.id === 'stitch_b2b' || w.id === 'stitch_d2c'), (w) => w.ops);
  const wcs = state.workCentres.map((w) => {
    let ops = w.ops;
    if (w.id === 'stitch_b2b') ops += sc.extraB2B;
    if (w.id === 'stitch_d2c') ops += sc.extraD2C;
    if (w.id === 'stitch_sample') ops += sc.extraSample || 0;
    if (w.id === 'finish') ops += sc.extraFinish;
    const out = (w.id === 'stitch_b2b' || w.id === 'stitch_d2c') ? Math.round(sc.absent * (w.ops / stitchOps)) : 0;
    const cap = dates.map((_, d) => Math.max(0, ops - (d < ASSUME.absentDays ? out : 0)) * (w.mins + sc.overtime * 60) * w.eff);
    return { ...w, opsPlanned: ops, cap, used: cap.map(() => 0) };
  });
  const wcById = by(wcs, 'id');
  const stageWc = { cut: 'cut', finish: 'finish', qc: 'qc', pack: 'pack' };

  // ── Demand: open orders, plus whatever the scenario adds ──
  const dyeReady = {};
  for (const lot of state.dyeLots) if (lot.status === 'at_dyer') for (const id of lot.forOrders || []) dyeReady[id] = Math.max(0, workdayIndex(t0, lot.due)) + 1;
  const jobs = [];
  for (const o of state.orders) {
    if (o.done.pack >= o.qty) continue;
    const st = styles[o.style];
    const sample = o.channel === 'SAMPLE';
    const qty = sample ? o.qty : Math.round(o.qty * (1 + sc.uplift / 100));
    let startDay = o.done.cut >= o.qty ? 0 : (dyeReady[o.id] || 0);
    if (sc.fabricDelay?.days && sc.fabricDelay.fabric === st.fabric && o.done.cut < qty) startDay += sc.fabricDelay.days;
    jobs.push({
      id: o.id, channel: o.channel, customer: o.customer, style: o.style, name: st.name, qty, baseQty: o.qty, sample, isNew: false,
      dueDay: workdayIndex(t0, o.due), startDay, pools: POOLS[o.channel], done: STAGES.map((s) => Math.min(qty, o.done[s])),
      smv: STAGES.map((s) => st.smv[s] * (sample ? ASSUME.sampleFactor[s] : 1)),
    });
  }
  for (const run of sc.runs) {
    const st = styles[run.style];
    const sample = run.kind === 'sample';
    const mat = materialCheck(state, run.style, run.qty);
    jobs.push({
      id: run.id, channel: sample ? 'SAMPLE' : run.channel, customer: sample ? 'Merchandising' : (run.channel === 'B2B' ? 'New B2B demand' : 'New D2C demand'),
      style: run.style, name: st.name, qty: run.qty, baseQty: run.qty, sample, isNew: true, label: run.label,
      dueDay: run.dueDays, startDay: sample ? 0 : mat.readyDay, material: mat,
      pools: sample ? ROUTES[run.route || 'sampling'] : POOLS[run.channel], done: STAGES.map(() => 0),
      smv: STAGES.map((s) => st.smv[s] * (sample ? ASSUME.sampleFactor[s] : 1)),
    });
  }
  // Outside job-work takes a share of B2B stitching minutes off the line.
  if (sc.jobwork) for (const j of jobs) if (j.channel === 'B2B') j.smv[1] *= 1 - sc.jobwork / 100;

  const rank = (j) => (sc.priority === 'new' ? (j.isNew ? 0 : 1) : sc.priority === 'b2b' ? (j.channel === 'B2B' ? 0 : 1) : 0);
  jobs.sort((a, b) => rank(a) - rank(b) || a.dueDay - b.dueDay || (a.channel === 'B2B' ? -1 : 1));

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
        if (avail <= EPS) continue;
        const pools = k === 1 ? j.pools : [stageWc[STAGES[k]]];
        for (const p of pools) {
          const units = Math.min(avail, left[p] / j.smv[k]);
          if (units <= EPS) continue;
          j.done[k] += units; avail -= units;
          left[p] -= units * j.smv[k];
          wcById[p].used[d] += units * j.smv[k];
          if (j.firstDay === null) j.firstDay = d;
          if (k === 1 && pass === 0 && j.stitchDay === null) j.stitchDay = d;
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
    const late = fin === null ? HORIZON - j.dueDay : Math.max(0, fin - j.dueDay);
    return {
      id: j.id, channel: j.channel, customer: j.customer, style: j.style, name: j.name, qty: j.qty, baseQty: j.baseQty, isNew: j.isNew, label: j.label,
      sample: j.sample, dueDay: j.dueDay, due: addWorkdays(t0, Math.max(0, j.dueDay)), startDay: j.startDay, firstDay: j.firstDay,
      finishDay: fin, finish: fin === null ? null : dates[fin], late, slack: fin === null ? -late : j.dueDay - fin, unfinished: fin === null,
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
  return { dates, wcs, orders, weeks, scenario: sc };
}

/** Set a scenario against the plan as it stands. */
export function compare(base, scen) {
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
      const u = w.util[c.id], was = base.weeks[i].util[c.id];
      if (u >= 0.97 && u - was > 0.02) hot.push({ wc: c.id, name: c.name, node: c.node, week: i, util: u, was });
    });
  }
  const worse = moved.filter((m) => m.worse);
  const lateRuns = runs.filter((r) => r.late > 0);
  const addedLateDays = sum(worse, (m) => m.late - m.wasLate);
  const verdict = worse.length ? 'breaks' : lateRuns.length ? 'late' : 'fits';
  return { moved, worse, runs, lateRuns, hot, verdict, addedLateDays, b2bHit: worse.filter((m) => m.channel === 'B2B').length };
}

/** What the levers in a scenario cost per month. */
export function leverCost(state, sc) {
  const tailors = sc.extraB2B + sc.extraD2C + (sc.extraSample || 0);
  const ops = sum(state.workCentres, (w) => w.ops) + tailors + sc.extraFinish;
  const parts = [];
  if (sc.overtime) parts.push({ what: `${sc.overtime} h overtime a day, whole floor`, cost: ops * sc.overtime * ASSUME.overtimeRate * 26 });
  if (tailors) parts.push({ what: `${tailors} more tailor${tailors > 1 ? 's' : ''}`, cost: tailors * ASSUME.tailorMonthly });
  if (sc.extraFinish) parts.push({ what: `${sc.extraFinish} more finishing helper${sc.extraFinish > 1 ? 's' : ''}`, cost: sc.extraFinish * ASSUME.helperMonthly });
  if (sc.jobwork) {
    const pieces = sum(state.orders.filter((o) => o.channel === 'B2B'), (o) => Math.max(0, o.qty - o.done.stitch)) * sc.jobwork / 100;
    parts.push({ what: `${sc.jobwork}% of B2B stitching outside`, cost: pieces * ASSUME.jobworkPremium });
  }
  return { parts, total: sum(parts, (p) => p.cost) };
}

/**
 * Three ways to answer a request, so the conversation is about choices:
 *  push  – do it as entered and show what slips
 *  wait  – the earliest date the new work finishes if nothing else is allowed to move
 *  add   – the cheapest extra capacity that keeps every order where it was
 */
export function options(state, sc, base = simulate(state)) {
  const push = simulate(state, sc);
  const pushCmp = compare(base, push);

  let wait = null;
  if (sc.runs.length) {
    // New work goes to the back of every queue: it only uses minutes nobody else needed.
    const patient = { ...sc, priority: 'due', runs: sc.runs.map((r) => ({ ...r, dueDays: 9999 })) };
    const sim = simulate(state, patient);
    wait = { sim, runs: sim.orders.filter((o) => o.isNew).map((o) => ({ id: o.id, label: o.label, finishDay: o.finishDay, finish: o.finish })) };
  }

  let add = null;
  if (pushCmp.verdict !== 'fits') {
    const ok = (cmp) => cmp.verdict === 'fits';
    let best = null;
    const sampleSteps = sc.runs.some((r) => r.kind === 'sample') ? [0, 2, 4, 6] : [0];
    for (const overtime of [0, 1, 2, 3]) for (const xb of [0, 3, 6, 10, 14]) for (const xd of [0, 2, 4, 6, 8]) for (const xf of [0, 1, 2, 4]) for (const xs of sampleSteps) {
      const trial = { ...sc, overtime: Math.max(sc.overtime, overtime), extraB2B: sc.extraB2B + xb, extraD2C: sc.extraD2C + xd, extraFinish: sc.extraFinish + xf, extraSample: (sc.extraSample || 0) + xs };
      const cost = leverCost(state, trial).total;
      if (best && cost >= best.cost) continue;
      const cmp = compare(base, simulate(state, trial));
      if (ok(cmp)) best = { scenario: trial, cost, cmp };
    }
    add = best;
  }
  return { base, push, pushCmp, wait, add };
}

/** Per-node health for the map, from stock and from the schedule. */
export function nodeHealth(state, sim) {
  const h = {};
  const set = (id, level, text) => { if (!h[id] || level === 'crit') h[id] = { level, text }; };
  const wcNode = by(state.workCentres, 'id');
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  for (const w of state.workCentres.filter((c) => c.stage === 'stitch')) {
    const mine = sim.orders.filter((o) => o.pools.includes(w.id));
    const late = mine.filter((o) => o.late > 0), tight = mine.filter((o) => o.late === 0 && o.slack <= 1);
    if (late.length) set(w.node, 'crit', `${plural(late.length, 'order')} will miss the due date`);
    else if (tight.length) set(w.node, 'warn', `${plural(tight.length, 'order')} with a day or less to spare`);
  }
  for (const w of state.workCentres.filter((c) => c.stage !== 'stitch')) {
    const full = sim.weeks.filter((wk) => wk.util[w.id] >= 0.97).length;
    if (full) set(w.node, 'warn', `${w.name} is full for ${plural(full, 'week')}`);
  }
  const un = state.rolls.filter((r) => r.status === 'unaudited' && r.location === 'Dark room');
  if (un.length) set('darkroom', 'crit', `${un.length} rolls, ${Math.round(sum(un, (r) => r.metres)).toLocaleString('en-IN')} m never checked`);
  const low = state.threads.filter((t) => t.cones < t.min);
  if (low.length) set('threadstore', low.some((t) => t.cones < t.min / 3) ? 'crit' : 'warn', `${low.length} thread shade${low.length > 1 ? 's' : ''} below minimum`);
  const tl = state.tools.filter((t) => t.onHand < t.min);
  if (tl.length || state.machines.down) set('toolcrib', 'warn', `${tl.length} items short, ${state.machines.down} machines down`);
  const lost = state.rolls.filter((r) => r.status === 'dye_reject');
  if (lost.length) set('dyer', 'crit', `${lost.length} rolls lost after dyeing`);
  const rej = state.rolls.filter((r) => r.status === 'rejected');
  if (rej.length) set('fabricqc', 'warn', `${rej.length} rolls failed, going back to the mill`);
  const waiting = state.parcels.filter((p) => p.status === 'packed');
  if (waiting.length) set('dispatch', 'warn', `${waiting.length} parcel${waiting.length > 1 ? 's' : ''} packed, not yet scanned out`);
  const fit = state.parcels.filter((p) => p.kind === 'store' && (p.visits || 0) >= 3);
  if (fit.length) set('bombay', 'warn', `${fit.length} piece${fit.length > 1 ? 's' : ''} on a third fit visit`);
  const unsynced = state.ledger.filter((v) => !v.synced);
  if (unsynced.length) set('finance', 'warn', `${unsynced.length} vouchers not yet in Tally`);
  return h;
}
