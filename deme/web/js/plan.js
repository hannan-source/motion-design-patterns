// Live records in, a plan out. This is the only place that knows both the ERP's record types
// and the shape the scheduler in shared/engine.js works on. The Production room and the map
// read the same plan from here.

import { data } from './api.js';
import { simulate, assumptions, ASSUME } from '../shared/engine.js';
import { today, addWorkdays, workdayIndex, sum, iso } from '../shared/util.js';

// The seven fixed pools the scheduler knows, and the place each one stands for on the map.
const POOLS = [
  { id: 'cut', stage: 'cut', name: 'Cutting', node: 'cutting', role: 'cutters' },
  { id: 'stitch_b2b', stage: 'stitch', name: 'B2B line', node: 'lineb2b', role: 'tailors' },
  { id: 'stitch_d2c', stage: 'stitch', name: 'D2C line', node: 'lined2c', role: 'tailors' },
  { id: 'stitch_sample', stage: 'stitch', name: 'Sampling room', node: 'sampling', role: 'sample tailors' },
  { id: 'finish', stage: 'finish', name: 'Finishing', node: 'finishing', role: 'helpers' },
  { id: 'qc', stage: 'qc', name: 'Final QC', node: 'finalqc', role: 'checkers' },
  { id: 'pack', stage: 'pack', name: 'Packing', node: 'dispatch', role: 'packers' },
];
const OPEN = new Set(['planned', 'released', 'in_progress']);
const CHANNEL_NAMES = { B2B: 'B2B', D2C: 'Shopify', STORE: 'Store', SAMPLE: 'Sample' };
const LINE_FOR = { B2B: 'stitch_b2b', D2C: 'stitch_d2c', STORE: 'stitch_d2c', SAMPLE: 'stitch_sample' };
const USES = new Set(['styles', 'workstations', 'work_orders', 'items', 'rolls', 'dye_lots', 'customers']);
const LS_KEY = 'deme-plan-assumptions';

const n = (v, fallback = 0) => { const x = Number(v); return Number.isFinite(x) && x >= 0 ? x : fallback; };
const same = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();
const poolOf = (wc) => (wc.stage === 'stitch' ? (wc.line === 'd2c' ? 'stitch_d2c' : wc.line === 'sample' ? 'stitch_sample' : 'stitch_b2b') : wc.stage);
const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

/** Work-centre records grouped into the fixed pools; pools with no record are left out. */
function pools() {
  const groups = {};
  for (const wc of data.all('workstations')) (groups[poolOf(wc)] ||= []).push(wc);
  return POOLS.filter((p) => groups[p.id]).map((p) => {
    const list = groups[p.id];
    const people = sum(list, (w) => n(w.people));
    const mins = (w) => n(w.shiftMinutes, 480) || 480;
    const eff = (w) => { const e = n(w.efficiency, 0.7); return e > 1 ? Math.min(e, 100) / 100 : e; }; // 70 typed for 0.7
    return {
      id: p.id, name: list.length === 1 && list[0].name ? list[0].name : p.name, node: p.node, stage: p.stage, role: p.role,
      ops: people,
      mins: people ? sum(list, (w) => n(w.people) * mins(w)) / people : sum(list, mins) / list.length,
      eff: people ? sum(list, (w) => n(w.people) * eff(w)) / people : sum(list, eff) / list.length,
      refs: list.map((w) => w.id),
    };
  });
}
// Work a production vendor is making takes no in-house time until it is back for QC and packing.
const openOrders = () => data.all('work_orders').filter((o) => OPEN.has(o.status) && n(o.pack) < n(o.qty) && !(o.madeBy === 'vendor' && n(o.finish) < n(o.qty)));

/** The planning assumptions in force on this device: engine defaults with any saved numbers on top. */
let unsaved = null; // kept in memory when this browser will not store them
export function planAssumptions() {
  let saved = unsaved;
  try { saved = JSON.parse(localStorage.getItem(LS_KEY) || 'null') || unsaved; } catch { /* storage blocked: use what is in memory */ }
  return assumptions(saved);
}
/** Save planning assumptions on this device. Pass null to go back to the defaults. Returns what is now in force. */
export function savePlanAssumptions(obj) {
  const clean = obj ? Object.fromEntries(Object.keys(ASSUME).filter((k) => obj[k] !== undefined && obj[k] !== null && obj[k] !== '' && Number.isFinite(Number(obj[k])) && Number(obj[k]) >= 0).map((k) => [k, Number(obj[k])])) : null;
  unsaved = clean;
  try { if (clean) localStorage.setItem(LS_KEY, JSON.stringify(clean)); else localStorage.removeItem(LS_KEY); } catch { /* kept in memory for this visit */ }
  memo = null;
  return planAssumptions();
}

/**
 * The plan state the engine takes, built from the records in `data`.
 * Also carries `missing.fabric`: work orders with no dyed fabric in store and none at the dyer.
 */
export function planState(assume = planAssumptions()) {
  const t0 = addWorkdays(today(), 0);
  const items = Object.fromEntries(data.all('items').map((i) => [i.id, i]));

  const styles = data.all('styles').map((s) => {
    const fabric = items[s.fabric];
    return {
      id: s.id, name: s.name || s.code || 'Style', code: s.code || '', status: s.status || 'active',
      fabric: s.fabric || '', fabricName: fabric?.name || '', shade: s.shade || '', metres: n(s.metres), cones: n(s.cones),
      cost: n(fabric?.cost), dyeCost: n(fabric?.dyeCost),
      smv: { cut: n(s.smvCut), stitch: n(s.smvStitch), finish: n(s.smvFinish), qc: n(s.smvQc), pack: n(s.smvPack) },
    };
  });
  const styleById = Object.fromEntries(styles.map((s) => [s.id, s]));

  const rolls = data.all('rolls').map((r) => ({ id: r.id, fabric: r.item || '', shade: r.shade || '', metres: n(r.reservedFor ? r.metres : (r.left ?? r.metres)), status: r.status, reservedFor: r.reservedFor || '', dyeLot: r.dyeLot || '', away: !!r.heldAt }));
  const threads = data.all('items').filter((i) => i.kind === 'thread').map((i) => ({ shade: i.shade || '', cones: n(i.onHand) }));

  // Fabric on its way back from the dyer, by lot.
  const rollById = Object.fromEntries(rolls.map((r) => [r.id, r]));
  const lots = data.all('dye_lots').filter((l) => l.status === 'at_dyer').map((l) => {
    const mine = (l.rolls || []).map((id) => rollById[id]).filter(Boolean);
    const back = l.dueBack ? Math.max(0, workdayIndex(t0, new Date(`${l.dueBack}T00:00:00`))) + 1 : assume.dyeDays;
    return { shade: l.shade, readyDay: back, metres: (fabric) => sum(mine.filter((r) => r.fabric === fabric), (r) => r.metres) };
  }).sort((a, b) => a.readyDay - b.readyDay);

  // Free stock is handed out in due-date order, so two orders cannot both count on the same roll.
  // Fabric still lying at the dye house, passed but not yet dyed and back, cannot be cut from.
  const free = new Map(rolls.filter((r) => !r.reservedFor && !r.away && r.metres > 0 && (r.status === 'dyed' || r.status === 'passed')).map((r) => [r, r.metres]));
  const missing = { fabric: [] };
  const orders = openOrders()
    .map((o) => ({
      id: o.no || o.id, ref: o.id, channel: o.channel, customer: data.get('customers', o.customer)?.name || CHANNEL_NAMES[o.channel] || o.channel || '',
      style: o.style, qty: n(o.qty), due: o.due, status: o.status,
      done: { cut: n(o.cut), stitch: n(o.stitch), finish: n(o.finish), qc: n(o.qc), pack: n(o.pack) },
    }))
    .sort((a, b) => String(a.due).localeCompare(String(b.due)));
  for (const o of orders) {
    const st = styleById[o.style];
    if (!st || !st.fabric || o.done.cut >= o.qty) continue;
    let need = (o.qty - o.done.cut) * st.metres;
    if (!(need > 0)) { o.readyDay = 0; continue; }
    // Rolls already set aside for, or issued to, this order.
    need -= sum(rolls.filter((r) => r.reservedFor === o.ref && r.fabric === st.fabric && ['dyed', 'passed', 'issued'].includes(r.status)), (r) => r.metres);
    // A style with a shade cuts from dyed rolls of that shade; a style without one cuts from any passed roll.
    const usable = [...free.keys()].filter((r) => r.fabric === st.fabric && (st.shade ? r.status === 'dyed' && same(r.shade, st.shade) : true));
    const inStore = sum(usable, (r) => free.get(r));
    const take = (metres) => { for (const r of usable) { const t = Math.min(free.get(r), metres); free.set(r, free.get(r) - t); metres -= t; if (metres <= 0) break; } };
    if (need <= inStore) { if (need > 0) take(need); o.readyDay = 0; continue; }
    const coming = lots.filter((l) => same(l.shade, st.shade) && l.metres(st.fabric) > 0);
    if (!coming.length) { missing.fabric.push(o.id); continue; }
    take(inStore);
    let short = need - inStore, lot = coming[coming.length - 1];
    for (const l of coming) { short -= l.metres(st.fabric); if (short <= 0) { lot = l; break; } }
    o.readyDay = lot.readyDay;
  }

  return { styles, workCentres: pools(), orders, rolls, threads, missing };
}

/** What is missing before a plan can be drawn: [{ text, entity }]. Empty when a plan can be made. */
export function planGaps() {
  const gaps = [];
  const open = openOrders();
  if (!data.all('workstations').length) gaps.push({ text: 'No work centres', entity: 'workstations' });
  else {
    const have = Object.fromEntries(pools().map((p) => [p.id, p]));
    const check = (id, none, idle) => { if (!have[id]) gaps.push({ text: none, entity: 'workstations' }); else if (!have[id].ops) gaps.push({ text: idle, entity: 'workstations' }); };
    check('cut', 'No cutting work centre', 'No people on cutting');
    const lines = [...new Set(open.map((o) => LINE_FOR[o.channel]).filter(Boolean))];
    if (!open.length && !['stitch_b2b', 'stitch_d2c', 'stitch_sample'].some((id) => have[id])) gaps.push({ text: 'No stitching line', entity: 'workstations' });
    const LINE_GAPS = {
      stitch_b2b: ['No B2B stitching line', 'No people on the B2B stitching line'],
      stitch_d2c: ['No D2C stitching line for Shopify and store orders', 'No people on the D2C stitching line'],
      stitch_sample: ['No sampling room for sample orders', 'No people in the sampling room'],
    };
    for (const p of POOLS.filter((x) => lines.includes(x.id))) check(p.id, ...LINE_GAPS[p.id]);
    check('finish', 'No finishing work centre', 'No people on finishing');
    check('qc', 'No final QC work centre', 'No people on final QC');
    check('pack', 'No packing work centre', 'No people on packing');
  }
  if (!data.all('styles').length) gaps.push({ text: 'No styles', entity: 'styles' });
  if (!open.length) gaps.push({ text: 'No open work orders', entity: 'work_orders' });
  return gaps;
}

// One plan serves every screen until a record it is built from changes, or the day does.
let memo = null;
data.on((touched) => { if (touched.some((t) => t === '*' || USES.has(t))) memo = null; });

/** The plan as it stands: { state, sim }, or null when the gaps make it meaningless. */
export function currentPlan() {
  if (!data.ready) return null;
  const key = iso(today());
  if (memo?.key === key) return memo.value;
  let value = null;
  try {
    if (!planGaps().length) {
      const assume = planAssumptions();
      const state = planState(assume);
      value = { state, sim: simulate(state, null, assume) };
    }
  } catch (e) { console.error(e); value = null; }
  memo = { key, value };
  return value;
}

/** Health of the work-centre places on the map, from the current plan: { [nodeId]: { level, text } }. */
export function planHealth() {
  try {
    const plan = currentPlan();
    if (!plan) return {};
    const { state, sim } = plan;
    const health = {};
    const set = (node, level, text) => { if (!health[node] || level === 'crit') health[node] = { level, text }; };
    for (const w of state.workCentres) {
      if (w.stage === 'stitch') {
        const mine = sim.orders.filter((o) => o.pools.includes(w.id));
        const late = mine.filter((o) => o.late > 0), tight = mine.filter((o) => o.late === 0 && !o.unfinished && o.slack <= 1);
        if (late.length) set(w.node, 'crit', `${plural(late.length, 'order')} will miss the due date`);
        else if (tight.length) set(w.node, 'warn', `${plural(tight.length, 'order')} with a day or less to spare`);
      } else {
        const full = sim.weeks.filter((wk) => wk.util[w.id] >= sim.assume.fullAt).length;
        if (full) set(w.node, 'warn', `${w.name} is full for ${plural(full, 'week')}`);
      }
    }
    return health;
  } catch (e) { console.error(e); return {}; }
}
