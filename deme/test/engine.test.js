// The production scheduler, on a small plan state built by hand.
// Run: node --disable-warning=ExperimentalWarning --test test/engine.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simulate, compare, options, leverCost, materialCheck, emptyScenario, isEmpty, assumptions, ASSUME, HORIZON, WEEK, STAGES, ROUTE_NAMES } from '../shared/engine.js';
import { addWorkdays, iso } from '../shared/util.js';

const TODAY = '2026-11-09'; // a Monday, so day 0 is fixed whatever day the tests run
const day = (n) => {
  if (n >= 0) return iso(addWorkdays(new Date(`${TODAY}T00:00:00`), n));
  const d = new Date(`${TODAY}T00:00:00`); // working days back, skipping Sundays
  for (let left = -n; left > 0;) { d.setDate(d.getDate() - 1); if (d.getDay() !== 0) left--; }
  return iso(d);
};
const none = () => ({ cut: 0, stitch: 0, finish: 0, qc: 0, pack: 0 });

// One style at 20 stitching minutes. The B2B line makes 10 × 480 × 0.5 = 2,400 standard minutes
// a day, so 120 pieces; every other work centre has room to spare.
const style = (over = {}) => ({ id: 'kaftan', name: 'Kaftan', fabric: 'voile', fabricName: 'Cotton voile', shade: 'Coral', metres: 2, cones: 4, cost: 180, dyeCost: 40, smv: { cut: 2, stitch: 20, finish: 2, qc: 1, pack: 1 }, ...over });
const centres = () => [
  { id: 'cut', name: 'Cutting', node: 'cutting', stage: 'cut', ops: 10, mins: 480, eff: 1, role: 'cutters' },
  { id: 'stitch_b2b', name: 'B2B line', node: 'lineb2b', stage: 'stitch', ops: 10, mins: 480, eff: 0.5, role: 'tailors' },
  { id: 'stitch_d2c', name: 'D2C line', node: 'lined2c', stage: 'stitch', ops: 5, mins: 480, eff: 0.5, role: 'tailors' },
  { id: 'stitch_sample', name: 'Sampling room', node: 'sampling', stage: 'stitch', ops: 2, mins: 480, eff: 0.5, role: 'tailors' },
  { id: 'finish', name: 'Finishing', node: 'finishing', stage: 'finish', ops: 10, mins: 480, eff: 1, role: 'helpers' },
  { id: 'qc', name: 'Final QC', node: 'finalqc', stage: 'qc', ops: 10, mins: 480, eff: 1, role: 'checkers' },
  { id: 'pack', name: 'Packing', node: 'dispatch', stage: 'pack', ops: 10, mins: 480, eff: 1, role: 'packers' },
];
const order = (id, qty, dueIn, over = {}) => ({ id, ref: `rec-${id}`, channel: 'B2B', customer: 'Coast & Co', style: 'kaftan', qty, due: day(dueIn), done: none(), ...over });
const plan = (orders, over = {}) => ({
  today: TODAY, styles: [style()], workCentres: centres(), orders,
  rolls: [{ fabric: 'voile', shade: 'Coral', metres: 5000, status: 'dyed', reservedFor: '' }], threads: [{ shade: 'Coral', cones: 500 }], ...over,
});
const find = (sim, id) => sim.orders.find((o) => o.id === id);

test('an empty state does not throw', () => {
  for (const state of [{}, { styles: [], workCentres: [], orders: [], rolls: [], threads: [] }, plan([])]) {
    const sim = simulate(state);
    assert.equal(sim.orders.length, 0);
    assert.equal(sim.skipped.length, 0);
    assert.equal(sim.dates.length, HORIZON);
    assert.equal(sim.weeks.length, HORIZON / WEEK);
    assert.equal(compare(sim, sim).verdict, 'fits');
    const op = options(state, emptyScenario());
    assert.equal(op.pushCmp.verdict, 'fits');
    assert.equal(op.add, null);
    assert.equal(leverCost(state, emptyScenario()).total, 0);
    assert.equal(materialCheck(state, 'nothing', 10), null);
  }
  assert.ok(isEmpty(emptyScenario()));
  assert.deepEqual(STAGES, ['cut', 'stitch', 'finish', 'qc', 'pack']);
  assert.ok(ROUTE_NAMES.sampling);
});

test('orders finish in due-date order under capacity', () => {
  // Entered out of order on purpose.
  const sim = simulate(plan([order('C', 300, 20), order('A', 300, 8), order('B', 300, 14)]));
  const [a, b, c] = ['A', 'B', 'C'].map((id) => find(sim, id));
  for (const o of [a, b, c]) { assert.equal(o.unfinished, false); assert.equal(o.late, 0, `${o.id} is on time`); assert.ok(o.slack >= 0); }
  assert.ok(a.finishDay < b.finishDay && b.finishDay < c.finishDay, `finish days ${a.finishDay}, ${b.finishDay}, ${c.finishDay}`);
  assert.equal(a.ref, 'rec-A', 'the record id rides along');
  // No work centre is ever asked for more minutes than it has.
  for (const w of sim.wcs) w.used.forEach((u, d) => assert.ok(u <= w.cap[d] + 1e-6, `${w.id} day ${d}`));
  // 900 pieces at 20 minutes went through the B2B line and nowhere else.
  const used = (id) => sim.wcs.find((w) => w.id === id).used.reduce((s, x) => s + x, 0);
  assert.ok(Math.abs(used('stitch_b2b') - 900 * 20) < 1e-3);
  assert.equal(used('stitch_d2c'), 0);
});

test('a run that exceeds capacity makes a later order late, and added capacity restores the plan', () => {
  const state = plan([order('A', 480, 9), order('B', 480, 13), order('C', 480, 18)]);
  const base = simulate(state);
  assert.ok(base.orders.every((o) => o.late === 0), 'the plan as it stands is on time');

  const sc = { ...emptyScenario(), runs: [{ id: 'NEW-1', kind: 'scale', label: '600 more Kaftan', style: 'kaftan', qty: 600, dueDays: 6, channel: 'B2B' }] };
  assert.equal(isEmpty(sc), false);
  const pushed = simulate(state, sc);
  const cmp = compare(base, pushed);
  assert.equal(cmp.verdict, 'breaks');
  assert.ok(cmp.worse.some((m) => m.id === 'A' || m.id === 'B' || m.id === 'C'));
  assert.ok(cmp.addedLateDays > 0);
  assert.ok(cmp.b2bHit > 0);
  assert.ok(find(pushed, 'C').finishDay > find(base, 'C').finishDay, 'the last order moves out');

  const op = options(state, sc, null, base);
  assert.equal(op.pushCmp.verdict, 'breaks');
  assert.ok(op.wait && op.wait.runs.length === 1, 'a later date for the new work is offered');
  assert.ok(op.add, 'a lever set is found');
  assert.equal(op.add.cmp.verdict, 'fits');
  assert.ok(op.add.cost > 0);
  assert.equal(op.add.cost, leverCost(state, op.add.scenario).total);
  // Applying the levers by hand gives the same answer.
  assert.equal(compare(base, simulate(state, op.add.scenario)).verdict, 'fits');
  // Waiting moves nothing that was already planned.
  for (const o of base.orders) assert.equal(find(op.wait.sim, o.id).finishDay, o.finishDay);
});

test('a missing stitching pool leaves that order unfinished without throwing', () => {
  const state = plan([order('A', 200, 10), order('D', 100, 10, { channel: 'D2C' })]);
  state.workCentres = state.workCentres.filter((w) => w.id !== 'stitch_d2c');
  const sim = simulate(state);
  assert.equal(find(sim, 'D').unfinished, true);
  assert.equal(find(sim, 'D').finish, null);
  assert.ok(find(sim, 'D').late > 0);
  assert.equal(find(sim, 'A').unfinished, false);
  assert.doesNotThrow(() => options(state, { ...emptyScenario(), uplift: 20 }));
  assert.doesNotThrow(() => options(state, { ...emptyScenario(), absent: 4, extraD2C: 3, runs: [{ id: 'NEW-1', kind: 'sample', label: 'samples', style: 'kaftan', qty: 10, dueDays: 5, route: 'd2c' }] }));

  // A pool with nobody on it behaves the same way.
  const idle = plan([order('A', 200, 10)]);
  idle.workCentres.find((w) => w.id === 'stitch_b2b').ops = 0;
  const stuck = simulate(idle);
  assert.equal(find(stuck, 'A').unfinished, true);
  assert.ok(stuck.weeks.every((w) => Number.isFinite(w.util.stitch_b2b)));

  // No work centres at all.
  assert.equal(find(simulate(plan([order('A', 200, 10)], { workCentres: [] })), 'A').unfinished, true);
});

test('an unknown style lands in skipped', () => {
  const state = plan([order('A', 200, 10), order('X', 50, 10, { style: 'gone' })]);
  const sim = simulate(state);
  assert.deepEqual(sim.skipped.map((s) => [s.id, s.reason]), [['X', 'style']]);
  assert.equal(sim.skipped[0].ref, 'rec-X');
  assert.equal(find(sim, 'X'), undefined);
  assert.equal(find(sim, 'A').late, 0);
  // A scenario run on a style that no longer exists is skipped too.
  const sc = { ...emptyScenario(), runs: [{ id: 'NEW-1', kind: 'scale', label: 'x', style: 'gone', qty: 10, dueDays: 5, channel: 'B2B' }] };
  assert.ok(simulate(state, sc).skipped.some((s) => s.id === 'NEW-1'));
});

test('overdue orders keep a negative due day', () => {
  const sim = simulate(plan([order('OLD', 120, -3)]));
  const o = find(sim, 'OLD');
  assert.equal(o.dueDay, -3);
  assert.equal(iso(o.due), day(-3));
  assert.ok(o.late >= 3 && o.slack < 0);
});

test('fabric that is not ready holds the start; work already cut is not held', () => {
  const held = find(simulate(plan([order('A', 120, 30, { readyDay: 5 })])), 'A');
  assert.ok(held.firstDay >= 5);
  const cut = find(simulate(plan([order('A', 120, 30, { readyDay: 5, done: { ...none(), cut: 120 } })])), 'A');
  assert.equal(cut.startDay, 0);
  assert.ok(cut.firstDay < 5);
});

test('planning assumptions are defaults that a call can override', () => {
  assert.equal(assumptions().dyeDays, ASSUME.dyeDays);
  assert.equal(assumptions({ dyeDays: 9, millDays: 'x', overtimeRate: -1 }).dyeDays, 9);
  assert.equal(assumptions({ millDays: 'x' }).millDays, ASSUME.millDays);
  assert.equal(assumptions({ overtimeRate: -1 }).overtimeRate, ASSUME.overtimeRate);

  // Samples: a higher factor means a later finish on the same sampling room.
  const state = plan([order('S', 60, 40, { channel: 'SAMPLE' })]);
  const quick = find(simulate(state, null, { sampleFactor: 1 }), 'S');
  const slow = find(simulate(state, null, { sampleFactor: 4 }), 'S');
  assert.ok(slow.finishDay > quick.finishDay);

  // Materials: no free fabric means dye or buy, on the lead times given.
  const bare = plan([], { rolls: [{ fabric: 'voile', shade: '', metres: 300, status: 'passed', reservedFor: '' }] });
  const dye = materialCheck(bare, 'kaftan', 100, { dyeDays: 4 });
  assert.equal(dye.path, 'dye'); assert.equal(dye.readyDay, 4); assert.equal(dye.need, 200);
  const buy = materialCheck(bare, 'kaftan', 400, { dyeDays: 4, millDays: 10 });
  assert.equal(buy.path, 'buy'); assert.equal(buy.readyDay, 14); assert.equal(buy.buy, 500);
  assert.equal(materialCheck(plan([]), 'kaftan', 100).path, 'stock');

  // Costs follow the rates given.
  const sc = { ...emptyScenario(), extraB2B: 2, extraFinish: 1 };
  assert.equal(leverCost(state, sc).total, 2 * ASSUME.tailorMonthly + ASSUME.helperMonthly);
  assert.equal(leverCost(state, sc, { tailorMonthly: 1000, helperMonthly: 500 }).total, 2500);
});
