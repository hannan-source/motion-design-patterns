// The business map: a 3D model of Deme end to end. Places, flows, zones and the parts inside a
// place come from ontology.js. Every figure and every health ring comes from the records in the
// data cache, limited to what the signed-in person may read. Nothing is shown that is not recorded.

import * as THREE from '../vendor/three.module.min.js';
import { NODES as FIXED_NODES, FLOWS as FIXED_FLOWS, nodeById as fixedById, world, LAYERS, ZONES, SYSTEMS, SYSTEM_KINDS, TOURS, PARTS } from './ontology.js';
import { buildNode, HEIGHT } from './models.js';
import { data } from './api.js';
import { info, esc, inr, num, fmtDate } from './ui.js';
import { COMPANY } from '../shared/schema.js';
import { sum, clamp, iso, DAY, today as todayDate, addWorkdays, fmtDay } from '../shared/util.js';
import { papersMissing } from '../shared/floor.js';

const PLINTH = 0.6;
const easeOut = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const day = (d) => fmtDate(`${d}T00:00:00`);
const val = (x, fallback) => (x === undefined || x === null || x === '' || !Number.isFinite(Number(x)) ? fallback : Number(x));

const ABOUT_MAP = 'Fabric comes in on the left: ready-for-dyeing fabric goes from the mill straight to the dye house, the rest to the fabric store. Garments leave on the right. Production vendors, at the front, make most wholesale work; some of it ships from the vendor and some comes back for QC. Money and information arc overhead. Select a place, a flow line, a zone or a part inside a place to see what the records say about it. A ring marks a place where something is waiting (amber) or needs action (red).';
const ABOUT_MOVING = 'Drag to turn. Right-drag, shift-drag or two fingers to move. Scroll or pinch to zoom.';

let remembered = { layers: { material: true, goods: true, money: true, data: true } };

// The places and flows on the map now: the fixed ones plus one place per production vendor on
// record. Set each time the map is built; one map is on screen at a time.
let NODES = FIXED_NODES, FLOWS = FIXED_FLOWS, nodeById = fixedById;
const makersOnRecord = () => (data.canRead('suppliers') ? data.all('suppliers').filter((s) => s.kind === 'maker').map((s) => ({ id: s.id, name: s.name || 'Production vendor', city: s.city || '' })) : null);
const makersKey = () => JSON.stringify(makersOnRecord());
/** Is this work order made by one of the vendors a place or a flow stands for? (null stands for all of them) */
const ofMakers = (makers, w) => w.madeBy === 'vendor' && (makers === null || makers.includes(w.vendor));
const stillOut = (w) => Math.max(0, val(w.qty, 0) - val(w.qcAt === 'vendor' ? w.pack : w.finish, 0)); // pieces not yet back, or not yet passed there

// ───────── Figures from the records ─────────
const PREV = { cut: null, stitch: 'cut', finish: 'stitch', qc: 'finish', pack: 'qc' };
const LINE_OF = { B2B: 'b2b', D2C: 'd2c', STORE: 'd2c', SAMPLE: 'sample' };
const lineOfCentre = (w) => (w.line === 'd2c' || w.line === 'sample' ? w.line : 'b2b'); // as the plan does: anything else stitches on the B2B line

/**
 * Read the cache into what the map shows. Returns
 *   places: { [nodeId]: { rows: [[label, value, recordType?]], has, readable, health: { level, text } | null, add } }
 *     (a row that names a record type opens that list when its figure is selected)
 *   F: named counts the part facts reuse; F.at[nodeId] holds the per-place ones.
 * A record type the person cannot read contributes nothing.
 */
function readRecords() {
  const R = (e) => (data.canRead(e) ? data.all(e) : null);
  const today = iso(new Date()), old = iso(Date.now() - 14 * DAY), nextDay = iso(addWorkdays(todayDate(), 1));
  const places = Object.fromEntries(NODES.map((n) => [n.id, { rows: [], has: false, readable: false, health: null, add: n.add || n.rec }]));
  const F = { at: Object.fromEntries(NODES.map((n) => [n.id, {}])) };
  const row = (id, label, value, entity) => { places[id].rows.push([label, String(value), entity]); places[id].readable = true; };
  const has = (id, x) => { if (x) places[id].has = true; };
  const flag = (id, level, text) => { const h = places[id].health; if (!h || (level === 'crit' && h.level !== 'crit')) places[id].health = { level, text }; };
  const count = (list, f) => list.filter(f).length;
  const metres = (list) => Math.round(sum(list, (r) => val(r.metres, 0)));

  const rolls = R('rolls'), items = R('items'), suppliers = R('suppliers'), lots = R('dye_lots'), pos = R('purchase_orders'), grns = R('goods_receipts'),
    centres = R('workstations'), wos = R('work_orders'), machines = R('machines'), parcels = R('parcels'), shop = R('shop_orders'), store = R('store_orders'), fits = R('fit_visits'),
    sos = R('sales_orders'), customers = R('customers'), invoices = R('invoices'), vouchers = R('vouchers'), bills = R('bills'), samples = R('sample_requests'), collections = R('collections'),
    bundles = R('bundles'), checks = R('qc_checks'), inspections = R('inspections'), moves = R('stock_moves'),
    claims = R('claims'), reports = R('fabric_reports'), returns = R('returns'), plans = R('day_plans');
  const leftOn = (r) => val(r.left, val(r.metres, 0));

  const withStatus = (s) => rolls.filter((r) => r.status === s);
  const low = (kinds) => items.filter((i) => kinds.includes(i.kind) && val(i.minLevel, 0) > 0 && val(i.onHand, 0) < val(i.minLevel, 0));
  const atZero = (list) => list.filter((i) => val(i.onHand, 0) <= 0);

  // Suppliers
  if (suppliers) {
    F.mills = count(suppliers, (s) => s.kind === 'mill'); row('mills', 'Fabric mills', F.mills); has('mills', F.mills);
    F.trimVendors = count(suppliers, (s) => s.kind === 'trims'); row('trims', 'Thread and trim vendors', F.trimVendors); has('trims', F.trimVendors);
  }
  // Fabric that failed is the supplier's to answer for: what is claimed and not yet settled.
  if (claims) {
    for (const [who, id, label] of [['mill', 'mills', 'Open claims on mills'], ['dyer', 'dyer', 'Open claims on the dye house']]) {
      const open = claims.filter((c) => c.against === who && c.status === 'open'), owed = sum(open, (c) => val(c.amount, 0));
      F[`${who}Claims`] = open.length; F[`${who}Owed`] = owed;
      row(id, label, open.length ? `${open.length} · ${inr(owed)}` : 0, 'claims'); has(id, count(claims, (c) => c.against === who));
      if (open.length) flag(id, 'warn', `${plural(open.length, 'claim')} open, ${inr(owed)} owed`);
    }
    row('mills', 'Claims credited or replaced', count(claims, (c) => c.against === 'mill' && (c.status === 'credited' || c.status === 'replaced')), 'claims');
  }
  if (rolls) {
    const c = withStatus('rejected').length;
    row('mills', 'Rolls rejected, not returned', c); has('mills', c);
    if (c) flag('mills', 'warn', `${plural(c, 'roll')} rejected, not yet returned`);
  }
  if (items) {
    row('trims', 'Thread and trims below minimum', low(['thread', 'trim']).length);
    has('trims', count(items, (i) => i.kind === 'thread' || i.kind === 'trim'));
  }

  // Dye house and the check on return
  if (lots) {
    const out = lots.filter((l) => l.status === 'at_dyer').sort((a, b) => String(a.dueBack || '9').localeCompare(String(b.dueBack || '9')));
    const late = out.filter((l) => l.dueBack && l.dueBack < today);
    F.lotsOut = out.length; F.lotsChecked = count(lots, (l) => l.status === 'received');
    row('dyer', 'Lots at the dyer', out.length); has('dyer', lots.length);
    if (late.length) flag('dyer', 'warn', `${plural(late.length, 'lot')} overdue`);
    row('dyecheck', 'Lots due back', out.length);
    if (out[0]?.dueBack) row('dyecheck', 'Next due', `${out[0].no || ''} ${out[0].shade || ''}, ${day(out[0].dueBack)}`.trim());
    has('dyecheck', out.length || F.lotsChecked);
    if (late.length) flag('dyecheck', 'warn', `${plural(late.length, 'lot')} overdue from the dyer`);
  }

  // Fabric, roll by roll
  if (rolls) {
    // Rolls the mill delivered to a dye house lie there; the rest are at Deme.
    const lying = rolls.filter((r) => r.heldAt && (r.status === 'received' || r.status === 'passed')), unchecked = lying.filter((r) => r.status === 'received');
    const waiting = withStatus('received').filter((r) => !r.heldAt), passed = withStatus('passed'), rejected = withStatus('rejected'), out = withStatus('at_dyer'), dyed = withStatus('dyed');
    const when = (r) => r.receivedOn || String(r.createdAt || '').slice(0, 10) || today;
    const fresh = waiting.filter((r) => when(r) >= old), stale = waiting.filter((r) => when(r) < old);
    Object.assign(F, { awaiting: waiting.length, stale: stale.length, dyed: dyed.length, metresOut: metres(out), lying: metres(lying), lyingRolls: lying.length });

    row('dyer', 'Metres lying there, waiting', num(F.lying), 'rolls'); row('dyer', 'Of those, rolls not checked yet', unchecked.length, 'rolls');
    row('dyer', 'Metres at the dyer on lots', num(F.metresOut), 'dye_lots'); has('dyer', out.length || lying.length);
    if (unchecked.length) flag('dyer', 'warn', `${plural(unchecked.length, 'roll')} lying there, not checked`);

    row('dock', 'Awaiting inspection, last 14 days', fresh.length); has('dock', fresh.length);

    row('fabricqc', 'Awaiting inspection at the store', waiting.length); row('fabricqc', 'Checked by Deme, store or dye house', count(rolls, (r) => r.checkedBy === 'store' || r.checkedBy === 'dyehouse'));
    row('fabricqc', 'Accepted on the mill\'s report', count(rolls, (r) => r.checkedBy === 'mill')); row('fabricqc', 'Passed, waiting for dyeing', passed.length); row('fabricqc', 'Rejected', rejected.length);
    has('fabricqc', waiting.length || passed.length || rejected.length);
    if (waiting.length) flag('fabricqc', 'warn', `${plural(waiting.length, 'roll')} awaiting inspection`);

    row('darkroom', 'Rolls waiting over 14 days', stale.length); row('darkroom', 'Metres', num(metres(stale))); has('darkroom', stale.length);
    if (stale.length) flag('darkroom', 'warn', `${plural(stale.length, 'roll')} not inspected in over 14 days`);

    const left = (list) => Math.round(sum(list, leftOn));
    row('fabricstore', 'Dyed rolls', dyed.length);
    row('fabricstore', 'Metres left, reserved', num(left(dyed.filter((r) => r.reservedFor)))); row('fabricstore', 'Metres left, free', num(left(dyed.filter((r) => !r.reservedFor))));
    has('fabricstore', dyed.length);
  }
  if (reports) {
    const fresh = count(reports, (r) => r.status === 'new');
    F.reportsOpen = count(reports, (r) => r.status !== 'closed');
    row('dyer', 'Open problem reports', F.reportsOpen, 'fabric_reports'); has('dyer', reports.length);
    if (fresh) flag('dyer', 'warn', `${plural(fresh, 'new problem report')}`);
  }
  if (inspections) { F.inspected = inspections.length; has('fabricqc', F.inspected); }

  // Dock
  if (pos) { F.openPos = count(pos, (p) => ['draft', 'approved', 'sent', 'part_received'].includes(p.status)); row('dock', 'Open purchase orders', F.openPos); has('dock', pos.length); }
  if (grns) {
    F.draftGrns = count(grns, (g) => g.status === 'draft'); row('dock', 'Receipts not posted', F.draftGrns); has('dock', grns.length);
    if (F.draftGrns) flag('dock', 'warn', `${plural(F.draftGrns, 'receipt')} not posted`);
  }

  // Thread, trims, tools
  if (items) {
    const thread = items.filter((i) => i.kind === 'thread'), lowThread = low(['thread']), lowTrims = low(['trim']), short = [...lowThread, ...lowTrims];
    const lowest = lowThread.slice().sort((a, b) => val(a.onHand, 0) - val(b.onHand, 0))[0];
    F.threads = thread.length; F.lowThread = lowThread.length;
    row('threadstore', 'Thread below minimum', `${lowThread.length} of ${thread.length}`); row('threadstore', 'Trims below minimum', lowTrims.length);
    if (lowest) row('threadstore', 'Lowest', `${lowest.name}: ${num(val(lowest.onHand, 0))} ${lowest.unit || ''}`.trim());
    has('threadstore', thread.length || count(items, (i) => i.kind === 'trim'));
    if (atZero(short).length) flag('threadstore', 'crit', `${plural(atZero(short).length, 'material')} at zero`);
    else if (short.length) flag('threadstore', 'warn', `${plural(short.length, 'material')} below minimum`);

    const lowTools = low(['tool', 'consumable']);
    F.lowTools = lowTools.length;
    row('toolcrib', 'Tools and consumables below minimum', lowTools.length); has('toolcrib', count(items, (i) => i.kind === 'tool' || i.kind === 'consumable'));
    if (atZero(lowTools).length) flag('toolcrib', 'crit', `${plural(atZero(lowTools).length, 'item')} at zero`);
    else if (lowTools.length) flag('toolcrib', 'warn', `${plural(lowTools.length, 'item')} below minimum`);
  }
  if (machines) {
    F.machinesDown = count(machines, (m) => m.status === 'down');
    row('toolcrib', 'Machines down', `${F.machinesDown} of ${machines.length}`); has('toolcrib', machines.length);
    if (F.machinesDown) flag('toolcrib', 'warn', `${plural(F.machinesDown, 'machine')} down`);
  }
  if (moves) F.issues = count(moves, (m) => m.reason === 'issue');

  // Parcels
  if (parcels) {
    const sent = parcels.filter((p) => p.kind !== 'store');
    F.packed = count(parcels, (p) => p.status === 'packed'); F.atFactory = count(parcels, (p) => p.status === 'at_factory');
    F.transit = count(sent, (p) => p.status === 'in_transit'); F.b2bParcels = count(parcels, (p) => p.kind === 'b2b');
    // The office adds the paperwork; until then a packed parcel cannot leave.
    const outward = parcels.filter((p) => p.kind !== 'store');
    F.needPapers = count(parcels, (p) => p.status === 'packed' && papersMissing(p));
    row('dispatch', 'Packed, not scanned', F.packed); row('dispatch', 'Of those, waiting for paperwork', F.needPapers, 'parcels'); row('dispatch', 'Store pieces at the factory', F.atFactory); has('dispatch', parcels.length);
    if (F.packed) flag('dispatch', 'warn', F.needPapers ? `${plural(F.needPapers, 'parcel')} stopped for paperwork` : `${plural(F.packed, 'parcel')} packed, not scanned`);
    row('papers', 'Parcels waiting for paperwork', F.needPapers, 'parcels'); row('papers', 'Paperwork in, not scanned out', count(outward, (p) => p.status === 'packed' && !papersMissing(p)), 'parcels');
    row('papers', 'Shipping from a vendor or the office', count(outward, (p) => p.shipFrom === 'vendor' || p.shipFrom === 'office'), 'parcels'); has('papers', outward.length);
    if (F.needPapers) flag('papers', 'warn', `${plural(F.needPapers, 'parcel')} packed, waiting for paperwork`);
    row('dhl', 'In transit', F.transit); row('dhl', 'Delivered', count(sent, (p) => p.status === 'delivered')); row('dhl', 'Coming back', count(sent, (p) => p.status === 'returning'));
    has('dhl', count(sent, (p) => p.status !== 'packed'));
  }

  // Work centres: people and standard minutes a day, and the work waiting at that stage
  const open = wos ? wos.filter((w) => w.status !== 'done') : null;
  const onFloor = wos ? wos.filter((w) => w.status === 'released' || w.status === 'in_progress') : null;
  const left = (w, stage) => Math.max(0, (PREV[stage] ? val(w[PREV[stage]], 0) : val(w.qty, 0)) - val(w[stage], 0));
  for (const n of NODES.filter((x) => x.wc)) {
    const { stage, line } = n.wc, A = F.at[n.id], packing = n.id === 'dispatch';
    if (centres) {
      const mine = centres.filter((w) => w.stage === stage && (!line || lineOfCentre(w) === line));
      A.people = sum(mine, (w) => val(w.people, 0));
      A.minutes = Math.round(sum(mine, (w) => val(w.people, 0) * val(w.shiftMinutes, 480) * val(w.efficiency, 0.7)));
      if (packing) { if (mine.length) row(n.id, 'Packing', `${num(A.people)} people · ${num(A.minutes)} min a day`); }
      else { row(n.id, 'People', num(A.people)); row(n.id, 'Standard minutes a day', num(A.minutes)); if (!mine.length) places[n.id].add = 'workstations'; }
      has(n.id, mine.length);
      if (machines) A.down = count(machines, (m) => m.status === 'down' && mine.some((w) => w.id === m.workCentre));
    }
    if (onFloor) {
      const mine = onFloor.filter((w) => left(w, stage) > 0 && (!line || LINE_OF[w.channel] === line));
      const late = mine.filter((w) => w.due && w.due < today);
      A.orders = mine.length; A.pieces = sum(mine, (w) => left(w, stage));
      row(n.id, packing ? 'Work orders to pack' : 'Work orders here', `${mine.length} · ${num(A.pieces)} pieces`); has(n.id, mine.length);
      if (late.length) flag(n.id, 'crit', `${plural(late.length, 'overdue work order')} here`);
    }
  }
  if (checks) {
    const final = checks.filter((c) => c.stage === 'final');
    F.finalChecks = final.length; F.rework = sum(final, (c) => val(c.rework, 0));
    row('finalqc', 'Pieces sent for rework', num(F.rework)); has('finalqc', final.length);
  }
  // Production vendors: what is out with each, what is due back and what Deme's QC passed there.
  for (const n of NODES.filter((x) => x.zone === 'makers')) {
    const A = F.at[n.id];
    if (suppliers) {
      places[n.id].readable = true;
      if (n.makers?.length > 1) row(n.id, 'Vendors', n.makers.length, 'suppliers'); else if (n.makers?.length) row(n.id, 'City', n.city || 'Not set');
      has(n.id, n.makers?.length);
    }
    if (wos) {
      const mine = wos.filter((w) => ofMakers(n.makers, w)), out = mine.filter((w) => w.status === 'at_vendor');
      const back = out.filter((w) => w.qcAt !== 'vendor'), late = out.filter((w) => w.backBy && w.backBy < today);
      const next = out.filter((w) => w.backBy).sort((a, b) => a.backBy.localeCompare(b.backBy))[0];
      A.out = sum(out, stillOut); A.dueBack = sum(back, stillOut); A.passed = sum(mine.filter((w) => w.qcAt === 'vendor'), (w) => val(w.pack, 0));
      row(n.id, 'Pieces with the vendor', `${num(A.out)} on ${plural(out.length, 'order')}`, 'work_orders'); row(n.id, 'Due back for QC here', num(A.dueBack), 'work_orders');
      if (next) row(n.id, 'Next due', `${next.no || ''}, ${day(next.backBy)}`.trim());
      row(n.id, 'Pieces passed there', num(A.passed), 'qc_checks'); has(n.id, mine.length);
      if (late.length) flag(n.id, 'crit', `${plural(late.length, 'work order')} past the due-back date`);
    }
  }
  if (wos) {
    const sent = wos.filter((w) => w.madeBy === 'vendor' && w.status === 'at_vendor');
    F.vendorBack = sum(sent.filter((w) => w.qcAt !== 'vendor'), stillOut);
    row('finalqc', 'Due back from vendors', num(F.vendorBack), 'work_orders');
  }
  // The day plan: is the next working day issued, and how the last one went.
  if (plans) {
    const next = plans.filter((p) => p.date === nextDay), issued = plans.filter((p) => p.status === 'issued').sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const state = next.some((p) => p.status === 'issued') ? 'Issued' : next.length ? 'Draft' : 'Not planned';
    F.planNext = state; F.plansIssued = issued.length;
    row('cutting', `Day plan for ${fmtDay(`${nextDay}T00:00:00`)}`, state, 'day_plans');
    if (issued[0]) row('cutting', 'Last plan issued', `${val(issued[0].ready, 0)} with fabric, ${val(issued[0].short, 0)} left out`, 'day_plans');
    has('cutting', plans.length);
    const toCut = wos ? wos.some((w) => w.madeBy !== 'vendor' && !['done', 'hold', 'at_vendor'].includes(w.status) && val(w.cut, 0) < val(w.qty, 0)) : plans.length > 0;
    if (state !== 'Issued' && toCut) flag('cutting', 'warn', `No day plan issued for ${fmtDay(`${nextDay}T00:00:00`)}`);
  }
  if (bundles) {
    F.bundlesWaiting = count(bundles, (b) => b.status === 'cut');
    row('cutting', 'Bundles cut, waiting', F.bundlesWaiting, 'bundles');
    const now = bundles.filter((b) => b.status === 'stitching');
    F.stitching = now.length;
    if (wos) { const lineOf = new Map(wos.map((w) => [w.id, LINE_OF[w.channel]])); for (const n of NODES.filter((x) => x.wc?.line)) F.at[n.id].stitching = count(now, (b) => lineOf.get(b.workOrder) === n.wc.line); }
  }

  // Channels
  if (shop) {
    const c = (s) => count(shop, (o) => o.status === s);
    F.shopNew = c('new'); F.shopPacked = c('packed');
    row('shopify', 'New', F.shopNew); row('shopify', 'In production', c('in_production')); row('shopify', 'Packed', F.shopPacked); row('shopify', 'Shipped or delivered', c('shipped') + c('delivered'));
    has('shopify', shop.length);
    if (F.shopNew) flag('shopify', 'warn', `${plural(F.shopNew, 'new order')} not in production`);
  }
  if (store) {
    const visits = new Map(store.map((o) => [o.id, val(o.visits, 0)]));
    if (fits) { const seen = new Map(); for (const v of fits) seen.set(v.storeOrder, (seen.get(v.storeOrder) || 0) + 1); for (const [id, c] of seen) visits.set(id, Math.max(visits.get(id) || 0, c)); }
    F.storeOpen = count(store, (o) => o.status !== 'closed'); F.maxVisits = Math.max(0, ...visits.values());
    row('bombay', 'Open store orders', F.storeOpen); row('bombay', 'At the factory', count(store, (o) => o.status === 'at_factory')); row('bombay', 'Most fit visits by one piece', F.maxVisits);
    has('bombay', store.length);
    if (F.maxVisits >= 3) flag('bombay', 'warn', `A piece is on fit visit ${F.maxVisits}`);
  }
  // The three wholesale places are segments of one customer kind: names cannot split them, so each shows all B2B.
  const accounts = customers ? new Set(customers.filter((c) => c.kind === 'b2b').map((c) => c.id)) : null;
  const b2b = sos ? sos.filter((o) => !accounts || accounts.has(o.customer)) : null;
  const b2bOpen = b2b ? b2b.filter((o) => o.status === 'draft' || o.status === 'confirmed') : null;
  const nextShip = b2bOpen ? b2bOpen.filter((o) => o.shipBy).sort((a, b) => a.shipBy.localeCompare(b.shipBy))[0] : null;
  if (b2bOpen) F.b2bOpen = b2bOpen.length;
  for (const id of ['revolve', 'ukbuyers', 'global']) {
    if (accounts) { row(id, 'B2B accounts', accounts.size); has(id, accounts.size); }
    if (b2b) { row(id, 'B2B sales orders, open', b2bOpen.length); if (nextShip) row(id, 'Next to ship', `${nextShip.no || ''}, ${day(nextShip.shipBy)}`); has(id, b2b.length); }
  }

  // Pieces that came back
  if (returns) {
    const c = (st) => count(returns, (r) => r.status === st);
    F.toCheck = c('received'); F.fitToSell = c('restocked'); F.soldOn = c('sold');
    row('resale', 'Received, to be checked', F.toCheck, 'returns'); row('resale', 'Fit to sell, waiting', F.fitToSell, 'returns'); row('resale', 'Sold on', F.soldOn, 'returns'); row('resale', 'Written off', c('written_off'), 'returns');
    has('resale', returns.length);
    if (F.toCheck) flag('resale', 'warn', `${plural(F.toCheck, 'return')} to be checked`);
    else if (F.fitToSell) flag('resale', 'warn', `${plural(F.fitToSell, 'piece')} fit to sell, not sold yet`);
  }

  // Office
  if (samples) {
    F.samplesWaiting = count(samples, (s) => s.status === 'requested');
    row('merch', 'Sample requests waiting', F.samplesWaiting); has('merch', samples.length);
    if (F.samplesWaiting) flag('merch', 'warn', `${plural(F.samplesWaiting, 'sample request')} waiting`);
  }
  if (collections) { F.collections = collections.length; row('merch', 'Collections', F.collections); row('merch', 'In sampling', count(collections, (c) => c.status === 'sampling')); has('merch', F.collections); }
  if (open) {
    const late = open.filter((w) => w.due && w.due < today);
    F.openWos = open.length; F.lateWos = late.length; F.sampleWos = count(open, (w) => w.channel === 'SAMPLE');
    row('tower', 'Open work orders', open.length); row('tower', 'Overdue', late.length); row('tower', 'Pieces in work', num(sum(open, (w) => val(w.qty, 0))));
    has('tower', wos.length);
    if (late.length) flag('tower', 'crit', `${plural(late.length, 'work order')} overdue`);
  }
  if (vouchers) {
    F.vouchersOpen = count(vouchers, (v) => v.status === 'open');
    row('finance', 'Vouchers not in Tally', F.vouchersOpen); has('finance', vouchers.length);
    if (F.vouchersOpen) flag('finance', 'warn', `${plural(F.vouchersOpen, 'voucher')} not in Tally`);
  }
  if (bills) {
    const unpaid = bills.filter((b) => b.status !== 'paid');
    F.unpaid = unpaid.length;
    row('finance', 'Unpaid bills', unpaid.length ? `${unpaid.length} · ${inr(sum(unpaid, (b) => val(b.amount, 0) - val(b.paid, 0)))}` : 0); has('finance', bills.length);
  }
  if (invoices) { row('finance', 'Invoices awaiting payment', count(invoices, (i) => i.status === 'posted')); has('finance', invoices.length); }

  return { places, F };
}

/** One live fact about a part of a place: [label, value], or null when there is none to give. */
function partFact(F, id, part) {
  const A = F.at[id] || {};
  const f = (label, v) => (v === undefined ? null : [label, String(v)]);
  switch (part) {
    case 'shed': return f('Fabric mills', F.mills);
    case 'chimney': return id === 'mills' ? f('Open claims on mills', F.millClaims) : null;
    case 'greige': return id === 'darkroom' ? f('Rolls waiting over 14 days', F.stale) : f('Rolls awaiting inspection', F.awaiting);
    case 'vendor': return f('Thread and trim vendors', F.trimVendors);
    case 'cone': case 'conewall': return F.threads === undefined ? null : f('Thread below minimum', `${F.lowThread} of ${F.threads}`);
    case 'dyeworks': case 'vat': return f('Lots at the dyer', F.lotsOut);
    case 'held': return F.lying === undefined ? null : f('Metres lying there, waiting', num(F.lying));
    case 'workshop': case 'vendorline': return A.out === undefined ? null : f('Pieces with the vendor', num(A.out));
    case 'qcdesk': return A.passed === undefined ? null : f('Pieces passed there', num(A.passed));
    case 'deskoffice': case 'papers': case 'printer': return f('Parcels waiting for paperwork', F.needPapers);
    case 'returnrail': return f('Fit to sell, waiting', F.fitToSell);
    case 'checktable': return f('Returns to be checked', F.toCheck);
    case 'dryline': return F.metresOut === undefined ? null : f('Metres at the dyer', num(F.metresOut));
    case 'bench': return f('Receipts not posted', F.draftGrns);
    case 'truck': return f('Open purchase orders', F.openPos);
    case 'frame': return f('Rolls inspected', F.inspected);
    case 'camera': return id === 'fabricqc' ? f('Rolls inspected', F.inspected) : id === 'dyecheck' ? f('Lots checked', F.lotsChecked) : id === 'threadstore' ? f('Thread materials', F.threads) : null;
    case 'darkstore': return f('Rolls waiting over 14 days', F.stale);
    case 'rack': case 'dyedroll': return f('Dyed rolls', F.dyed);
    case 'lightbox': return f('Lots due back', F.lotsOut);
    case 'counter': return f('Issues to the floor', F.issues);
    case 'cuttable': return A.pieces !== undefined ? f('Pieces to cut', num(A.pieces)) : f('Bundles cut, waiting', F.bundlesWaiting);
    case 'toolwall': return f('Tools and consumables below minimum', F.lowTools);
    case 'repair': return f('Machines down', F.machinesDown);
    case 'station': return f('Bundles being stitched', A.stitching ?? F.stitching);
    case 'stationdown': return f('Machines down here', A.down);
    case 'rail': return id === 'sampling' ? f('Sample work orders open', F.sampleWos) : id === 'merch' ? f('Sample requests waiting', F.samplesWaiting) : null;
    case 'press': return A.pieces === undefined ? null : f('Pieces to finish', num(A.pieces));
    case 'qctable': return f('Final checks recorded', F.finalChecks);
    case 'rework': return F.rework === undefined ? null : f('Pieces sent for rework', num(F.rework));
    case 'conveyor': case 'scangate': return f('Parcels packed, not scanned', F.packed);
    case 'parcel': return nodeById[id]?.zone === 'makers' ? (A.passed === undefined ? null : f('Pieces passed there', num(A.passed))) : id === 'resale' ? f('Returns to be checked', F.toCheck) : id === 'dispatch' ? f('Parcels packed, not scanned', F.packed) : id === 'dhl' ? f('Parcels in transit', F.transit) : id === 'shopify' ? f('Orders packed', F.shopPacked) : f('B2B cartons recorded', F.b2bParcels);
    case 'depot': case 'van': return f('Parcels in transit', F.transit);
    case 'screen': return f('New Shopify orders', F.shopNew);
    case 'shopfront': return f('Open store orders', F.storeOpen);
    case 'form': return id === 'bombay' ? f('Most fit visits by one piece', F.maxVisits) : null;
    case 'tower': case 'office': return f('B2B sales orders, open', F.b2bOpen);
    case 'studio': return f('Collections', F.collections);
    case 'controltower': return f('Open work orders', F.openWos);
    case 'beacon': return f('Overdue work orders', F.lateWos);
    case 'ledgerhall': return f('Vouchers not in Tally', F.vouchersOpen);
    case 'coins': return f('Unpaid bills', F.unpaid);
    case 'person': return id === 'papers' ? f('Parcels waiting for paperwork', F.needPapers) : A.people === undefined ? null : f('People here', num(A.people));
    default: return null;
  }
}

// Tests a flow names in `where`, for what a list of field values cannot say.
const WHERE = {
  toDyer: (g) => g.deliveredTo === 'dyer',
  toStore: (g) => g.deliveredTo !== 'dyer',
  storeWaiting: (r) => r.status === 'received' && !r.heldAt,
  fromPlan: (b) => !!b.plan,
  needsPapers: (p) => p.status === 'packed' && !!papersMissing(p),
  sentOut: (w, f) => ofMakers(f.makers, w) && w.status === 'at_vendor',
  backForQc: (w, f) => ofMakers(f.makers, w) && w.qcAt !== 'vendor',
  shippedThere: (w, f) => ofMakers(f.makers, w) && w.qcAt === 'vendor',
};

/** The records behind a flow: { entity, label, count, total in the list }, or null when the person cannot read them. */
function flowRecords(f) {
  const e = data.entity(f.rec);
  if (!e || !data.canRead(f.rec)) return null;
  let docs = data.all(f.rec), label = e.name;
  const total = docs.length;
  if (f.only) { docs = docs.filter((d) => Object.entries(f.only).every(([k, allowed]) => allowed.includes(d[k]))); label = f.label || label; }
  if (f.where) { docs = docs.filter((d) => WHERE[f.where](d, f)); label = f.label || label; }
  if (f.via && data.canRead(f.via[1])) { const [field, ref, key, allowed] = f.via; docs = docs.filter((d) => allowed.includes(data.get(ref, d[field])?.[key])); label = f.label || label; }
  return { entity: f.rec, label, count: docs.length, total };
}

/** The map is built for the production vendors on record, and built again when that list changes. */
export function mount(el, ctx) {
  let key = makersKey(), stop = build(el, ctx);
  const off = data.on(() => { const now = makersKey(); if (now === key) return; key = now; stop(); stop = build(el, ctx); });
  return () => { off(); stop(); };
}

function build(el, ctx) {
  ({ NODES, FLOWS, nodeById } = world(makersOnRecord()));
  el.innerHTML = `
    <div class="map">
      <canvas class="map-canvas" aria-label="3D map of the business. Drag to turn, scroll to zoom, select a place, a flow, a zone or a part for detail."></canvas>
      <div class="map-labels"></div>
      <div class="map-top">
        <div class="map-layers" role="group" aria-label="Flows shown">
          ${Object.entries(LAYERS).map(([id, l]) => `<button class="chip" type="button" data-layer="${id}" aria-pressed="true" style="--c:var(${l.var})" title="${esc(l.what)}"><span class="dot"></span>${esc(l.name)}</button>`).join('')}
        </div>
      </div>
      <div class="map-foot"><button class="btn btn-sm map-home" type="button">Whole business</button>${info(ABOUT_MOVING, 'Moving around')}</div>
      <aside class="map-inspector" aria-label="Detail"></aside>
      <div class="map-tour" hidden></div>
    </div>`;
  const wrap = el.querySelector('.map');
  const canvas = el.querySelector('.map-canvas');
  const labelsEl = el.querySelector('.map-labels');
  const inspector = el.querySelector('.map-inspector');
  const tourEl = el.querySelector('.map-tour');

  let alive = true;
  let state = readRecords();   // { places, F }
  let planHealth = null;       // from plan.js, when it is there
  let layers = { ...remembered.layers };
  let selected = null;         // place id
  let selPart = null;          // a mesh inside the selected place
  let selFlow = null;          // index into flowObjs
  let selZone = null;          // zone id
  let tour = null;             // { def, i, saved }
  let sheetOpen = false;

  // ───────── Scene ─────────
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 1, 1400);

  const hemi = new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.7);
  const sun = new THREE.DirectionalLight(0xffffff, 2.3);
  sun.position.set(-60, 110, 70);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -95, right: 95, top: 80, bottom: -80, near: 10, far: 320 });
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.05;
  scene.add(hemi, sun);

  const std = (o = {}) => new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, ...o });
  const flat = (o = {}) => new THREE.MeshBasicMaterial(o);
  const M = {
    ground: std(), plinth: std(), block: std({ roughness: 0.8 }), pad: std(), ink: std({ roughness: 0.7 }), dark: std(), raw: std(), parcel: std(), staff: std(),
    material: std(), goods: std(), money: std(), data: std(), critMat: std(),
    glass: std({ transparent: true, opacity: 0.45, roughness: 0.2 }), glow: flat(), beacon: flat(),
    beam: flat({ transparent: true, opacity: 0.32, depthWrite: false }),
  };
  const layerMat = {}, dotMat = {};
  for (const id of Object.keys(LAYERS)) { layerMat[id] = flat({ transparent: true, opacity: 0.5, depthWrite: false }); dotMat[id] = flat(); }
  const ringMat = { warn: flat({ transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }), crit: flat({ transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }) };
  const selMat = flat({ transparent: true, opacity: 0.9 });
  const unseen = flat({ visible: false });
  const inkColour = new THREE.Color();

  /** Colours come from the CSS tokens, read once: the app has one light theme. */
  function applyColours() {
    const css = getComputedStyle(wrap);
    const c = (name) => new THREE.Color(css.getPropertyValue(name).trim());
    const ground = c('--scene-ground'), block = c('--scene-block'), ink = c('--ink');
    inkColour.copy(ink);
    renderer.setClearColor(ground);
    scene.fog = new THREE.Fog(ground, 260, 520);
    hemi.groundColor.copy(ground);
    M.ground.color.copy(ground); M.plinth.color.copy(c('--scene-plinth')); M.block.color.copy(block);
    M.pad.color.copy(c('--scene-plinth')).lerp(ground, 0.75);
    M.ink.color.copy(ink).lerp(block, 0.32); M.dark.color.copy(c('--scene-dark')); M.staff.color.copy(c('--ink-3'));
    M.raw.color.copy(c('--scene-raw')); M.parcel.color.copy(c('--scene-parcel'));
    for (const id of Object.keys(LAYERS)) { const col = c(LAYERS[id].var); M[id].color.copy(col); layerMat[id].color.copy(col); dotMat[id].color.copy(col); }
    M.critMat.color.copy(c('--crit'));
    M.glass.color.copy(c('--data')).lerp(block, 0.55);
    M.glow.color.copy(c('--surface')); M.beacon.color.copy(c('--data')); M.beam.color.copy(c('--data'));
    for (const o of flowObjs) o.tube.material.color.copy(c(LAYERS[o.f.layer].var));
    ringMat.warn.color.copy(c('--warn')); ringMat.crit.color.copy(c('--crit')); selMat.color.copy(ink);
  }

  // Ground, zone plinths
  const groundMesh = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400), M.ground);
  groundMesh.rotation.x = -Math.PI / 2; groundMesh.receiveShadow = true; scene.add(groundMesh);
  const zoneObj = {};
  const plinths = [];
  for (const z of ZONES) {
    const ns = NODES.filter((n) => n.zone === z.id);
    const x0 = Math.min(...ns.map((n) => n.pos[0] - n.size[0] / 2)) - 3, x1 = Math.max(...ns.map((n) => n.pos[0] + n.size[0] / 2)) + 3;
    const z0 = Math.min(...ns.map((n) => n.pos[1] - n.size[1] / 2)) - 3, z1 = Math.max(...ns.map((n) => n.pos[1] + n.size[1] / 2)) + 3;
    const p = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, PLINTH, z1 - z0), M.plinth);
    p.position.set((x0 + x1) / 2, PLINTH / 2, (z0 + z1) / 2); p.receiveShadow = true; p.castShadow = true; p.userData.zone = z.id; scene.add(p); plinths.push(p);
    const sel = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0 + 1.4, 0.1, z1 - z0 + 1.4), selMat);
    sel.position.set((x0 + x1) / 2, 0.06, (z0 + z1) / 2); sel.visible = false; scene.add(sel);
    const label = document.createElement('button');
    label.type = 'button'; label.className = 'map-zone'; label.dataset.zone = z.id; label.textContent = z.name; labelsEl.appendChild(label);
    zoneObj[z.id] = { z, nodes: ns, box: { x0, x1, z0, z1 }, sel, label, pos: new THREE.Vector3(x0 + 0.5, PLINTH, z1 + 0.2) };
  }

  // Places
  const nodeObj = {};
  const partMeshes = [];
  NODES.forEach((n, i) => {
    const g = buildNode(n, M);
    g.position.set(n.pos[0], PLINTH, n.pos[1]);
    scene.add(g);
    const units = new Map();
    g.traverse((m) => {
      if (!m.isMesh) return;
      m.userData.node = n.id; partMeshes.push(m);
      if (m.userData.part === 'station') { if (!units.has(m.userData.unit)) units.set(m.userData.unit, []); units.get(m.userData.unit).push(m); }
    });
    const stations = [...units.values()].map((meshes) => ({ meshes, head: meshes.find((m) => m.userData.head) })).filter((s) => s.head);
    const h = HEIGHT[n.kind] || 4;
    const r = Math.max(n.size[0], n.size[1]) * 0.6;
    const ring = new THREE.Mesh(new THREE.RingGeometry(r, r + 0.5, 56), ringMat.warn);
    const ping = new THREE.Mesh(new THREE.RingGeometry(r, r + 0.34, 56), ringMat.warn.clone());
    for (const m of [ring, ping]) { m.rotation.x = -Math.PI / 2; m.position.set(n.pos[0], PLINTH + 0.06, n.pos[1]); m.visible = false; scene.add(m); }
    const sel = new THREE.Mesh(new THREE.BoxGeometry(n.size[0] + 1.3, 0.1, n.size[1] + 1.3), selMat);
    sel.position.set(n.pos[0], PLINTH + 0.03, n.pos[1]); sel.visible = false; scene.add(sel);
    const label = document.createElement('button');
    label.type = 'button'; label.className = 'map-label'; label.tabIndex = -1; label.dataset.id = n.id;
    label.innerHTML = `<i></i><span>${esc(n.name)}</span>`;
    labelsEl.appendChild(label);
    nodeObj[n.id] = { n, g, h, ring, ping, sel, label, stations, phase: i * 0.37, lift: 0 };
  });

  // Flows: ground-level conveyors for material and garments, arcs for money, a high canopy for data.
  // Each has a fat unseen tube around it so the thin line is easy to select.
  const pairCount = {};
  const flowPicks = [];
  const flowObjs = FLOWS.map((f, idx) => {
    const a = nodeById[f.from], b = nodeById[f.to];
    const key = [f.from, f.to].sort().join('|') + (f.layer === 'data' || f.layer === 'money' ? f.layer : 'ground');
    const lane = pairCount[key] = (pairCount[key] ?? -1) + 1;
    const A = new THREE.Vector3(a.pos[0], 0, a.pos[1]), B = new THREE.Vector3(b.pos[0], 0, b.pos[1]);
    const dir = B.clone().sub(A); const dist = dir.length(); dir.normalize();
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    const edge = (n, sgn) => { const t = Math.min((n.size[0] / 2) / Math.max(1e-3, Math.abs(dir.x)), (n.size[1] / 2) / Math.max(1e-3, Math.abs(dir.z))); return dir.clone().multiplyScalar(sgn * Math.min(t, dist * 0.4)); };
    let lift, y0, y1;
    if (f.layer === 'data') { y0 = PLINTH + nodeObj[a.id].h + 0.4; y1 = PLINTH + nodeObj[b.id].h + 0.4; lift = 10 + dist * 0.28; }
    else if (f.layer === 'money') { y0 = PLINTH + nodeObj[a.id].h * 0.7; y1 = PLINTH + nodeObj[b.id].h * 0.7; lift = 5 + dist * 0.2; }
    else { y0 = y1 = PLINTH + 0.75; A.add(edge(a, 1)); B.add(edge(b, -1)); lift = f.lift ?? 1.0 + dist * 0.035; }
    if (f.lift && f.layer !== 'material' && f.layer !== 'goods') lift = f.lift + dist * 0.12;
    A.y = y0; B.y = y1;
    const offset = side.clone().multiplyScalar((lane === 0 ? 0 : lane % 2 ? 1 : -1) * Math.ceil(lane / 2) * 1.7 + (f.layer === 'goods' ? 0.5 : f.layer === 'material' ? -0.5 : 0));
    A.add(offset); B.add(offset);
    const mid = A.clone().add(B).multiplyScalar(0.5); mid.y = Math.max(y0, y1) + lift; mid.add(offset.clone().multiplyScalar(0.6));
    const curve = new THREE.QuadraticBezierCurve3(A, mid, B);
    const len = curve.getLength();
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(14, Math.round(len / 2.2)), f.layer === 'data' ? 0.09 : f.layer === 'money' ? 0.13 : 0.2, 6, false), layerMat[f.layer].clone());
    tube.userData.base = f.weak ? 0.25 : f.layer === 'data' ? 0.42 : 0.62;
    scene.add(tube);
    const pick = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(8, Math.round(len / 4)), 0.9, 5, false), unseen);
    pick.userData.flow = idx; scene.add(pick); flowPicks.push(pick);
    const n = f.weak ? 1 : clamp(Math.round(len / 9), 2, 7);
    return { f, idx, curve, len, tube, pick, pts: curve.getPoints(Math.max(10, Math.round(len / 2))), n, speed: (f.layer === 'data' ? 13 : f.layer === 'money' ? 10 : 7.5) / len, on: true, dim: false };
  });
  // One instanced mesh of travelling dots per layer.
  const dotGeo = { material: new THREE.BoxGeometry(0.75, 0.55, 0.55), goods: new THREE.SphereGeometry(0.42, 12, 10), money: new THREE.CylinderGeometry(0.42, 0.42, 0.16, 14), data: new THREE.OctahedronGeometry(0.36) };
  const dots = {};
  for (const id of Object.keys(LAYERS)) {
    const count = sum(flowObjs.filter((o) => o.f.layer === id), (o) => o.n);
    dots[id] = new THREE.InstancedMesh(dotGeo[id], dotMat[id], count);
    dots[id].frustumCulled = false; scene.add(dots[id]);
  }
  const tmpM = new THREE.Matrix4(), tmpP = new THREE.Vector3(), tmpQ = new THREE.Quaternion(), tmpS = new THREE.Vector3(), zero = new THREE.Vector3(0, 0, 0);

  function refreshFlows() {
    for (const o of flowObjs) {
      const touches = !!selected && (o.f.from === selected || o.f.to === selected), isSel = selFlow === o.idx;
      o.on = layers[o.f.layer] || isSel;
      o.dim = selFlow !== null ? !isSel : !!selected && !touches;
      o.tube.visible = o.on;
      o.tube.material.opacity = o.dim ? 0.07 : touches || isSel ? 0.95 : o.tube.userData.base;
    }
    el.querySelectorAll('[data-layer]').forEach((b) => b.setAttribute('aria-pressed', String(layers[b.dataset.layer])));
  }

  /** Rings, label dots and selection marks, from the current health and selection. */
  function refreshMarks() {
    const ends = selFlow !== null ? [flowObjs[selFlow].f.from, flowObjs[selFlow].f.to] : [];
    for (const id in nodeObj) {
      const o = nodeObj[id], p = state.places[id], hl = p.health;
      o.ring.visible = o.ping.visible = !!hl;
      if (hl) { o.ring.material = ringMat[hl.level]; o.ping.material.color.copy(ringMat[hl.level].color); }
      o.label.dataset.level = hl ? hl.level : p.has ? 'ok' : '';
      o.label.classList.toggle('is-selected', selected === id);
      o.label.classList.toggle('is-end', ends.includes(id) || (selZone !== null && o.n.zone === selZone));
      o.sel.visible = selected === id;
    }
    for (const id in zoneObj) { zoneObj[id].sel.visible = selZone === id; zoneObj[id].label.classList.toggle('is-selected', selZone === id); }
  }

  /** Stations are all drawn alike; the machine list says how many on a line are down. */
  function refreshMachines() {
    for (const id in nodeObj) {
      const st = nodeObj[id].stations; if (!st.length) continue;
      const down = Math.min(st.length, state.F.at[id].down || 0);
      const marked = new Set(Array.from({ length: down }, (_, k) => Math.floor(((k + 0.5) * st.length) / down)));
      st.forEach((s, i) => { const d = marked.has(i); s.head.material = d ? M.critMat : M.ink; for (const m of s.meshes) m.userData.part = d ? 'stationdown' : 'station'; });
    }
  }

  // An outline around the selected part, parented to its place so it lifts with it.
  let partBox = null;
  function refreshPartBox() {
    if (partBox) { partBox.parent?.remove(partBox); partBox.geometry.dispose(); partBox.material.dispose(); partBox = null; }
    if (!selected || !selPart) return;
    const box = new THREE.Box3(), one = new THREE.Box3();
    for (const m of nodeObj[selected].g.children) {
      if (!m.isMesh || m.userData.unit !== selPart.userData.unit) continue;
      if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
      m.updateMatrix(); box.union(one.copy(m.geometry.boundingBox).applyMatrix4(m.matrix));
    }
    if (box.isEmpty()) return;
    partBox = new THREE.Box3Helper(box.expandByScalar(0.14), inkColour);
    nodeObj[selected].g.add(partBox);
  }

  // ───────── Camera ─────────
  const narrow = () => wrap.getBoundingClientRect().width <= 860;
  const HOME = narrow() ? { tx: 0, tz: -4, radius: 300, theta: -0.4, phi: 0.82 } : { tx: 5, tz: -6, radius: 206, theta: -0.4, phi: 0.9 };
  const cam = { ...HOME };
  const v = new THREE.Vector3();
  let fly = null;
  function placeCamera() {
    const s = Math.sin(cam.phi), c = Math.cos(cam.phi);
    camera.position.set(cam.tx + cam.radius * s * Math.sin(cam.theta), cam.radius * c, cam.tz + cam.radius * s * Math.cos(cam.theta));
    camera.lookAt(cam.tx, 2, cam.tz);
  }
  function flyTo(to, dur = 1.15) {
    if (reduced()) { Object.assign(cam, to); placeCamera(); return; }
    const from = { ...cam };
    let dth = (to.theta ?? cam.theta) - cam.theta; dth = Math.atan2(Math.sin(dth), Math.cos(dth));
    fly = { from, to: { ...cam, ...to, theta: cam.theta + dth }, t: 0, dur };
  }
  const focusNode = (id, zoom = true) => {
    const n = nodeById[id]; if (!n) return;
    const big = Math.max(n.size[0], n.size[1]);
    flyTo({ tx: n.pos[0], tz: n.pos[1], ...(zoom ? { radius: clamp(58 + big * 3.2, 70, 110), phi: 0.98 } : {}) });
  };
  const focusFlow = (idx) => {
    const o = flowObjs[idx]; if (!o) return;
    const a = nodeById[o.f.from], b = nodeById[o.f.to];
    flyTo({ tx: (a.pos[0] + b.pos[0]) / 2, tz: (a.pos[1] + b.pos[1]) / 2, radius: clamp(80 + Math.hypot(a.pos[0] - b.pos[0], a.pos[1] - b.pos[1]) * 1.5, 95, HOME.radius) });
  };
  const focusZone = (id) => {
    const z = zoneObj[id]; if (!z) return;
    const { x0, x1, z0, z1 } = z.box;
    flyTo({ tx: (x0 + x1) / 2, tz: (z0 + z1) / 2, radius: clamp(70 + Math.max(x1 - x0, z1 - z0) * 2.1, 100, HOME.radius) });
  };

  let W = 1, H = 1;
  function resize() {
    const r = wrap.getBoundingClientRect();
    W = Math.max(1, r.width); H = Math.max(1, r.height);
    renderer.setSize(W, H, false);
    camera.aspect = W / H;
    // Keep the model centred in the space the inspector leaves free.
    const insp = inspector.getBoundingClientRect();
    if (W > 860) camera.setViewOffset(W, H, (insp.width + 16) / 2, 0, W, H);
    else camera.setViewOffset(W, H, 0, (sheetOpen ? insp.height : 132) / 2 - 20 - (tour ? tourEl.offsetHeight / 2 : 0), W, H); // also clear of the tour caption at the top
    camera.fov = W > 860 ? 30 : 38;
    camera.updateProjectionMatrix();
    fitHome();
  }
  // The home view holds the whole model in the part of the stage the inspector leaves free:
  // find the closest distance at which every plinth corner and roof is inside it, then centre it.
  const extent = [];
  for (const id in zoneObj) { const b = zoneObj[id].box; for (const x of [b.x0, b.x1]) for (const z of [b.z0, b.z1]) extent.push(new THREE.Vector3(x, 0, z)); }
  for (const id in nodeObj) { const o = nodeObj[id]; extent.push(new THREE.Vector3(o.n.pos[0], PLINTH + o.h + 3, o.n.pos[1])); }
  function fitHome() {
    const wide = W > 860, insp = inspector.getBoundingClientRect();
    const x0 = -1 + 28 / W, x1 = 1 - (wide ? (insp.width + 28) * 2 : 28) / W, y0 = -1 + (wide ? 120 : 300) / H, y1 = 1 - 110 / H;
    const keep = { ...cam }, box = { x0: 0, x1: 0, y0: 0, y1: 0 };
    const measure = (radius) => {
      Object.assign(cam, HOME, { radius }); placeCamera(); camera.updateMatrixWorld();
      box.x0 = box.y0 = Infinity; box.x1 = box.y1 = -Infinity;
      for (const p of extent) { v.copy(p).project(camera); box.x0 = Math.min(box.x0, v.x); box.x1 = Math.max(box.x1, v.x); box.y0 = Math.min(box.y0, v.y); box.y1 = Math.max(box.y1, v.y); }
      return box;
    };
    const closest = () => {
      let lo = 90, hi = 520;
      for (let i = 0; i < 12; i++) { const mid = (lo + hi) / 2, b = measure(mid); if (b.x1 - b.x0 <= x1 - x0 && b.y1 - b.y0 <= y1 - y0) hi = mid; else lo = mid; }
      return hi;
    };
    for (let pass = 0; pass < 3; pass++) {
      HOME.radius = closest();
      const b = measure(HOME.radius), half = HOME.radius * Math.tan((camera.fov * Math.PI) / 360);
      const dx = ((x0 + x1) / 2 - (b.x0 + b.x1) / 2) * half * camera.aspect, dy = -((y0 + y1) / 2 - (b.y0 + b.y1) / 2) * half;
      HOME.tx -= Math.cos(HOME.theta) * dx + (Math.sin(HOME.theta) * dy) / Math.cos(HOME.phi);
      HOME.tz -= -Math.sin(HOME.theta) * dx + (Math.cos(HOME.theta) * dy) / Math.cos(HOME.phi);
    }
    HOME.radius = closest();
    Object.assign(cam, keep); placeCamera();
  }
  const ro = new ResizeObserver(resize); ro.observe(wrap);

  // ───────── Picking: a part or place, a flow line, or a zone ─────────
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  function pick(x, y) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const mesh = ray.intersectObjects(partMeshes, false)[0];
    const line = ray.intersectObjects(flowPicks.filter((p) => flowObjs[p.userData.flow].on), false)[0];
    const asFlow = () => ({ type: 'flow', idx: line.object.userData.flow });
    if (line && (!mesh || line.distance < mesh.distance)) {
      // In front of a place, a flow wins only when the pointer is on the line itself, not just near it.
      const pts = flowObjs[line.object.userData.flow].pts, near = Math.max(0.3, cam.radius * 0.004);
      let best = Infinity;
      for (let i = 1; i < pts.length; i++) best = Math.min(best, ray.ray.distanceSqToSegment(pts[i - 1], pts[i]));
      if (!mesh || best < near * near) return asFlow();
    }
    if (mesh) return { type: 'node', id: mesh.object.userData.node, mesh: mesh.object.userData.part ? mesh.object : null };
    if (line) return asFlow();
    const ground = ray.intersectObjects(plinths, false)[0];
    if (!ground) return null;
    const p = ground.point;
    const on = NODES.find((n) => Math.abs(p.x - n.pos[0]) <= n.size[0] / 2 + 0.6 && Math.abs(p.z - n.pos[1]) <= n.size[1] / 2 + 0.6);
    return on ? { type: 'node', id: on.id, mesh: null } : { type: 'zone', id: ground.object.userData.zone };
  }

  // Pointer: one finger or left button turns, right button or two fingers move, wheel or pinch zooms.
  const ptrs = new Map();
  let drag = null, moved = 0, pinch = null, hoverAt = null, hovered = null;
  const pan = (dx, dy) => {
    const k = cam.radius * 0.0012;
    cam.tx -= (Math.cos(cam.theta) * dx + Math.sin(cam.theta) * dy / Math.cos(cam.phi)) * k;
    cam.tz -= (-Math.sin(cam.theta) * dx + Math.cos(cam.theta) * dy / Math.cos(cam.phi)) * k;
    cam.tx = clamp(cam.tx, -80, 80); cam.tz = clamp(cam.tz, -60, 50);
  };
  canvas.addEventListener('pointerdown', (e) => {
    try { canvas.setPointerCapture(e.pointerId); } catch { /* a pointer that cannot be captured still selects */ }
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    fly = null; moved = 0; hoverAt = null;
    if (ptrs.size === 1) drag = { x: e.clientX, y: e.clientY, pan: e.button === 2 || e.shiftKey };
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 }; drag = null; }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!ptrs.has(e.pointerId)) { if (e.pointerType === 'mouse') hoverAt = { x: e.clientX, y: e.clientY }; return; }
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && ptrs.size === 2) {
      const [a, b] = [...ptrs.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y), cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      cam.radius = clamp(cam.radius * (pinch.d / d), 45, Math.max(360, HOME.radius * 1.15)); pan(cx - pinch.cx, cy - pinch.cy);
      pinch = { d, cx, cy }; moved = 99;
    } else if (drag) {
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y; moved += Math.abs(dx) + Math.abs(dy);
      if (drag.pan) pan(dx, dy); else { cam.theta -= dx * 0.005; cam.phi = clamp(cam.phi - dy * 0.004, 0.25, 1.36); }
      drag.x = e.clientX; drag.y = e.clientY;
    }
  });
  const up = (e) => {
    const was = ptrs.size; ptrs.delete(e.pointerId);
    if (was === 1 && moved < 6 && e.type === 'pointerup') {
      const p = pick(e.clientX, e.clientY);
      if (!p) select(null);
      else if (p.type === 'node') { select(p.id, { mesh: p.mesh }); focusNode(p.id, cam.radius > 125); }
      else if (p.type === 'flow') selectFlow(p.idx);
      else selectZone(p.id);
    }
    if (ptrs.size < 2) pinch = null;
    if (ptrs.size === 0) drag = null;
  };
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('pointerleave', () => { hoverAt = null; setHover(null); });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); fly = null; cam.radius = clamp(cam.radius * Math.exp(e.deltaY * 0.0011), 45, Math.max(300, HOME.radius * 1.15)); }, { passive: false });

  function setHover(p) {
    const id = p?.type === 'node' ? p.id : null;
    canvas.style.cursor = p ? 'pointer' : '';
    if (id === hovered) return;
    if (hovered) nodeObj[hovered].label.classList.remove('is-hover');
    hovered = id;
    if (id) nodeObj[id].label.classList.add('is-hover');
  }
  labelsEl.addEventListener('click', (e) => {
    const b = e.target.closest('.map-label'), z = e.target.closest('.map-zone');
    if (b) { select(b.dataset.id); focusNode(b.dataset.id, cam.radius > 125); }
    else if (z) selectZone(z.dataset.zone);
  });

  // ───────── Selection ─────────
  function show(reset = true) { refreshPartBox(); refreshFlows(); refreshMarks(); renderInspector(reset); }
  /** Select a place (null for the overview). `mesh` or a part id in `part` also selects a part inside it. */
  function select(id, { keepTour = false, mesh = null, part = null } = {}) {
    if (!keepTour && tour) endTour(false);
    selected = id && nodeById[id] ? id : null; selFlow = null; selZone = null;
    selPart = !selected ? null : mesh || (part ? nodeObj[selected].g.children.find((m) => m.userData.part === part) || null : null);
    sheetOpen = !!selected;
    show();
  }
  function selectFlow(idx) {
    if (tour) endTour(false);
    if (!flowObjs[idx]) return select(null);
    selected = null; selPart = null; selZone = null; selFlow = idx; sheetOpen = true;
    show();
  }
  function selectZone(id) {
    if (tour) endTour(false);
    if (!zoneObj[id]) return select(null);
    selected = null; selPart = null; selFlow = null; selZone = id; sheetOpen = true;
    show();
  }

  // ───────── Inspector ─────────
  const grip = '<button class="sheet-grip" type="button" aria-label="Show or hide details"><i></i></button>';
  const back = '<button class="btn btn-quiet btn-sm" type="button" data-go="">All places</button>';
  const layerTag = (id) => `<span class="tag tag-${id}">${esc(LAYERS[id].name)}</span>`;
  const statusOf = (p) => (p.health ? `<span class="tag tag-${p.health.level}">${p.health.level === 'crit' ? 'Needs action' : 'Waiting'}</span><span>${esc(p.health.text)}</span>`
    : p.has ? '<span class="tag tag-ok">Nothing waiting</span>' : `<span class="faint">${p.readable ? 'Nothing recorded yet' : 'No access to these records'}</span>`);
  const placeRow = (id) => { const p = state.places[id]; return `<li><button type="button" data-go="${id}"><span class="lvl lvl-${p.health ? p.health.level : p.has ? 'ok' : 'none'}"></span><span><strong>${esc(nodeById[id].name)}</strong><br><span class="muted">${esc(p.health ? p.health.text : p.has ? 'Nothing waiting' : p.readable ? 'Nothing recorded yet' : 'No access to these records')}</span></span></button></li>`; };
  const canPlan = () => data.can('production', 'read') || data.can('b2b', 'read') || data.can('design', 'read');
  const addButton = (entity, primary) => { const e = data.entity(entity); return e && data.canWrite(entity) ? `<button class="btn btn-sm ${primary ? 'btn-primary' : 'btn-outline'}" type="button" data-add="${entity}">Add ${esc(e.one.toLowerCase())}</button>` : ''; };

  function overviewHtml() {
    const rank = { crit: 0, warn: 1 };
    const issues = NODES.filter((n) => state.places[n.id].health).sort((a, b) => rank[state.places[a.id].health.level] - rank[state.places[b.id].health.level]);
    return `
      <div class="insp-top"><p class="eyebrow">Business map</p></div>
      <div class="insp-title"><h2>${esc(COMPANY)}, end to end</h2>${info(ABOUT_MAP, 'Business map')}</div>
      <section>
        <h3>Needs attention ${issues.length ? `<span class="count">${issues.length}</span>` : ''}</h3>
        ${issues.length ? `<ul class="issue-list">${issues.map((n) => placeRow(n.id)).join('')}</ul>` : '<p class="faint">Nothing needs attention</p>'}
      </section>
      <section>
        <h3>Walk through</h3>
        <div class="tour-list">${TOURS.map((t) => `<button class="btn btn-sm" type="button" data-tour="${t.id}"><span class="dot" style="background:var(${LAYERS[t.layer].var})"></span>${esc(t.name)}</button>`).join('')}</div>
      </section>
      <section>
        <h3>What moves</h3>
        <ul class="legend">${Object.entries(LAYERS).map(([id, l]) => `<li><span class="swatch" style="background:var(${l.var})"></span><span>${esc(l.name)}</span><span class="count">${FLOWS.filter((f) => f.layer === id).length}</span>${info(l.what, l.name)}</li>`).join('')}</ul>
      </section>`;
  }

  function placeHtml() {
    const n = nodeById[selected], p = state.places[selected];
    const zone = ZONES.find((z) => z.id === n.zone);
    const about = [n.blurb, n.today.length ? `Today: ${n.today.join(' ')}` : '', n.change.length ? `What changes: ${n.change.join(' ')}` : ''].filter(Boolean).join(' ');
    const flowRow = (o, dirn) => { const other = dirn === 'out' ? o.f.to : o.f.from; return `<li>${layerTag(o.f.layer)}<button type="button" class="link flow-what" data-flow="${o.idx}">${esc(o.f.what)}</button><button type="button" class="link flow-end" data-go="${other}">${dirn === 'out' ? 'to' : 'from'} ${esc(nodeById[other].name)}</button></li>`; };
    const out = flowObjs.filter((o) => o.f.from === selected), inn = flowObjs.filter((o) => o.f.to === selected);
    let partHtml = '';
    if (selPart) {
      const id = selPart.userData.part, part = PARTS[id], fact = partFact(state.F, selected, id);
      if (part) partHtml = `<div class="insp-part"><p class="eyebrow">Part</p><div class="insp-title"><strong>${esc(part.name)}</strong>${info(part.what, part.name)}</div>${fact ? `<dl class="metrics"><div><dt>${esc(fact[0])}</dt><dd class="num">${esc(fact[1])}</dd></div></dl>` : ''}</div>`;
    }
    // Where the work of this place is done, when it has a screen of its own.
    const screen = selected === 'dyer' && data.can('quality', 'scan') ? ['dye', 'Open the dye house'] : selected === 'cutting' && data.can('production', 'write') ? ['dayplan', 'Open the day plan'] : null;
    const vendor = n.makers?.length === 1 && data.canRead('suppliers') ? `<button class="btn btn-sm" type="button" data-open="suppliers" data-id="${esc(n.makers[0])}">Open vendor</button>` : '';
    const actions = p.has
      ? `${data.canRead(n.rec) ? `<button class="btn btn-sm btn-primary" type="button" data-open="${n.rec}">Open records</button>` : ''}${vendor}${screen ? `<button class="btn btn-sm" type="button" data-screen="${screen[0]}">${screen[1]}</button>` : ''}${n.plan && canPlan() ? '<button class="btn btn-sm" type="button" data-room>Test a change here</button>' : ''}`
      : p.readable ? addButton(p.add, true) : '';
    const figure = ([k, v, entity]) => `<div><dt>${esc(k)}</dt><dd class="num">${entity && data.canRead(entity) ? `<button type="button" class="link" data-open="${entity}" aria-label="${esc(`${k}: ${v}. Open records`)}">${esc(v)}</button>` : esc(v)}</dd></div>`;
    return `
      <div class="insp-top"><button class="eyebrow insp-zone" type="button" data-zone="${zone.id}">${esc(zone.name)}</button>${back}</div>
      ${partHtml}
      <div class="insp-title"><h2>${esc(n.name)}</h2>${info(about, n.name)}</div>
      <div class="insp-status">${statusOf(p)}</div>
      ${p.has && p.rows.length ? `<dl class="metrics">${p.rows.map(figure).join('')}</dl>` : ''}
      <div class="insp-actions">${actions}</div>
      <section><h3>Systems</h3>
        <ul class="sys-list">${n.systems.map((id) => { const s = SYSTEMS[id], k = SYSTEM_KINDS[s.kind]; return `<li><span class="tag ${k.tag}">${esc(s.name)}</span>${info(s.does, `${k.name}: ${s.name}`)}</li>`; }).join('')}</ul>
      </section>
      <section><h3>Connected to <span class="count">${out.length + inn.length}</span></h3>
        ${inn.length ? `<p class="eyebrow">Comes in</p><ul class="flow-list">${inn.map((o) => flowRow(o, 'in')).join('')}</ul>` : ''}
        ${out.length ? `<p class="eyebrow">Goes out</p><ul class="flow-list">${out.map((o) => flowRow(o, 'out')).join('')}</ul>` : ''}
      </section>`;
  }

  function flowHtml() {
    const f = flowObjs[selFlow].f, rec = flowRecords(f);
    const end = (id) => `<button type="button" class="link" data-go="${id}">${esc(nodeById[id].name)}</button>`;
    return `
      <div class="insp-top"><p class="eyebrow">Flow</p>${back}</div>
      <div class="insp-title"><h2>${esc(f.what)}</h2></div>
      <div class="flow-ends">${end(f.from)}<span aria-hidden="true">→</span><span class="sr">to</span>${end(f.to)}</div>
      <div class="insp-status">${layerTag(f.layer)}${info(LAYERS[f.layer].what, LAYERS[f.layer].name)}</div>
      ${rec ? `<dl class="metrics"><div><dt>${esc(rec.label)}</dt><dd class="num">${rec.count}</dd></div></dl>
      <div class="insp-actions">${rec.count ? `<button class="btn btn-sm btn-primary" type="button" data-open="${rec.entity}">Open records</button>` : rec.total ? `<button class="btn btn-sm btn-outline" type="button" data-open="${rec.entity}">Open ${esc(data.entity(rec.entity).name.toLowerCase())}</button>` : addButton(rec.entity, true)}</div>`
    : '<p class="faint">No access to these records</p>'}`;
  }

  function zoneHtml() {
    const z = zoneObj[selZone];
    return `
      <div class="insp-top"><p class="eyebrow">Zone</p>${back}</div>
      <div class="insp-title"><h2>${esc(z.z.name)}</h2></div>
      <section><h3>Places <span class="count">${z.nodes.length}</span></h3><ul class="issue-list">${z.nodes.map((n) => placeRow(n.id)).join('')}</ul></section>`;
  }

  function renderInspector(reset = true) {
    if (inspector.classList.contains('is-open') !== sheetOpen) { inspector.classList.toggle('is-open', sheetOpen); resize(); }
    const body = inspector.querySelector('.insp-body'), at = body && !reset ? body.scrollTop : 0;
    inspector.innerHTML = `${grip}<div class="insp-body">${selected ? placeHtml() : selFlow !== null ? flowHtml() : selZone ? zoneHtml() : overviewHtml()}</div>`;
    inspector.querySelector('.insp-body').scrollTop = at;
  }
  inspector.addEventListener('click', (e) => {
    const hit = (sel) => e.target.closest(sel);
    if (hit('.sheet-grip')) { sheetOpen = !sheetOpen; inspector.classList.toggle('is-open', sheetOpen); resize(); return; }
    if (hit('.info')) return;
    const go = hit('[data-go]'), fl = hit('[data-flow]'), zn = hit('[data-zone]'), t = hit('[data-tour]'), open = hit('[data-open]'), add = hit('[data-add]');
    if (go) { const id = go.dataset.go || null; select(id); if (id) focusNode(id); else flyTo(HOME); }
    else if (fl) { selectFlow(Number(fl.dataset.flow)); focusFlow(Number(fl.dataset.flow)); }
    else if (zn) { selectZone(zn.dataset.zone); focusZone(zn.dataset.zone); }
    else if (t) startTour(t.dataset.tour);
    else if (open) ctx.openEntity(open.dataset.open, open.dataset.id ? { id: open.dataset.id } : undefined);
    else if (add) ctx.openEntity(add.dataset.add, { add: true });
    else if (hit('[data-screen]')) ctx.go(hit('[data-screen]').dataset.screen);
    else if (hit('[data-room]')) ctx.go('room');
  });

  // ───────── Tours ─────────
  function startTour(id) {
    const def = TOURS.find((t) => t.id === id); if (!def) return;
    if (tour) endTour(false);
    tour = { def, i: 0, saved: { ...layers } };
    layers = { material: false, goods: false, money: false, data: false, [def.layer]: true };
    if (def.id === 'order' || def.id === 'samples' || def.id === 'wholesale') layers.data = layers.goods = true;
    showStep();
  }
  function showStep() {
    const [id, text] = tour.def.steps[tour.i];
    select(id, { keepTour: true }); focusNode(id);
    tourEl.hidden = false; wrap.classList.add('is-touring');
    tourEl.innerHTML = `
      <div class="tour-meta"><span class="dot" style="background:var(${LAYERS[tour.def.layer].var})"></span><strong>${esc(tour.def.name)}</strong><span class="num faint">${tour.i + 1} / ${tour.def.steps.length}</span></div>
      <p key="${tour.i}">${esc(text)}</p>
      <div class="tour-nav"><button class="btn btn-sm" type="button" data-t="prev" ${tour.i === 0 ? 'disabled' : ''}>Back</button>
      ${tour.i < tour.def.steps.length - 1 ? '<button class="btn btn-sm btn-primary" type="button" data-t="next">Next</button>' : '<button class="btn btn-sm btn-primary" type="button" data-t="end">Finish</button>'}
      <button class="btn btn-sm btn-quiet" type="button" data-t="end">Close</button></div>`;
    resize();
  }
  function endTour(home = true) {
    if (!tour) return;
    layers = tour.saved; tour = null; tourEl.hidden = true; wrap.classList.remove('is-touring'); resize();
    if (home) { select(null); flyTo(HOME); } else refreshFlows();
  }
  tourEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-t]'); if (!b || !tour) return;
    if (b.dataset.t === 'next') { tour.i++; showStep(); } else if (b.dataset.t === 'prev') { tour.i--; showStep(); } else endTour();
  });

  el.querySelector('.map-layers').addEventListener('click', (e) => {
    const b = e.target.closest('[data-layer]'); if (!b) return;
    layers[b.dataset.layer] = !layers[b.dataset.layer]; if (!tour) remembered.layers = { ...layers }; refreshFlows();
  });
  el.querySelector('.map-home').addEventListener('click', () => { select(null); flyTo(HOME); });

  // ───────── Records in, figures and rings out ─────────
  function refreshData() {
    if (!alive) return;
    state = readRecords();
    if (planHealth) {
      // The plan knows which work centres will run late or full; the worse of the two readings shows.
      let extra = {};
      try { extra = planHealth() || {}; } catch (e) { console.error(e); }
      for (const [id, hl] of Object.entries(extra)) {
        const p = state.places[id]; if (!p || !hl || !ringMat[hl.level]) continue;
        if (!p.health || hl.level === 'crit' || p.health.level !== 'crit') p.health = { level: hl.level, text: String(hl.text || '') };
      }
    }
    refreshMachines(); refreshMarks(); renderInspector(false);
  }
  // Wait for every other subscriber to hear the change first, so the plan is rebuilt before it is read.
  const off = data.on(() => queueMicrotask(refreshData));
  import('./plan.js').then((m) => { if (alive && typeof m.planHealth === 'function') { planHealth = m.planHealth; refreshData(); } }).catch(() => { /* the map works without the plan */ });

  // ───────── Frame loop ─────────
  let raf = 0, last = performance.now(), time = 0, running = true;
  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (!running) return;
    time += dt;
    if (fly) {
      fly.t += dt / fly.dur; const k = easeOut(Math.min(1, fly.t));
      for (const key of ['tx', 'tz', 'radius', 'theta', 'phi']) cam[key] = fly.from[key] + (fly.to[key] - fly.from[key]) * k;
      if (fly.t >= 1) fly = null;
    }
    placeCamera();
    scene.fog.near = cam.radius + 60; scene.fog.far = cam.radius + 320; // the haze starts behind the model at any zoom

    // travelling dots
    const idx = { material: 0, goods: 0, money: 0, data: 0 };
    for (const o of flowObjs) {
      const mesh = dots[o.f.layer];
      for (let i = 0; i < o.n; i++) {
        if (o.on && !o.dim) {
          const t = (time * o.speed + i / o.n + o.idx * 0.137) % 1;
          o.curve.getPoint(t, tmpP);
          const grow = Math.min(1, Math.min(t, 1 - t) * 12);
          tmpS.setScalar(grow); tmpM.compose(tmpP, tmpQ, tmpS);
        } else tmpM.compose(zero, tmpQ, tmpS.setScalar(0));
        mesh.setMatrixAt(idx[o.f.layer]++, tmpM);
      }
    }
    for (const id in dots) dots[id].instanceMatrix.needsUpdate = true;

    // health pings, selection lift, scanner pulses
    for (const id in nodeObj) {
      const o = nodeObj[id];
      if (o.ping.visible) { const p = ((time + o.phase) % 2.6) / 2.6; o.ping.scale.setScalar(1 + p * 0.45); o.ping.material.opacity = 0.7 * (1 - p); }
      const target = selected === id ? 0.9 : 0;
      o.lift += (target - o.lift) * Math.min(1, dt * 9); o.g.position.y = PLINTH + o.lift;
    }
    M.beam.opacity = 0.2 + 0.16 * (0.5 + 0.5 * Math.sin(time * 2.3));

    renderer.render(scene, camera);
    if (hoverAt) { const at = hoverAt; hoverAt = null; setHover(pick(at.x, at.y)); }

    // labels: project, then hide the ones that would sit on top of a more important label
    const shown = [];
    for (const id in nodeObj) {
      const o = nodeObj[id];
      v.set(o.n.pos[0], PLINTH + o.h + 1.2 + o.lift, o.n.pos[1]).project(camera);
      const vis = v.z < 1 && v.x > -1.1 && v.x < 1.1 && v.y > -1.1 && v.y < 1.2;
      o.label.style.display = vis ? '' : 'none';
      if (!vis) continue;
      o.sx = (v.x * 0.5 + 0.5) * W; o.sy = (-v.y * 0.5 + 0.5) * H; o.sz = v.z;
      o.lw ||= o.label.offsetWidth; o.lh ||= o.label.offsetHeight;
      o.label.style.transform = `translate(-50%,-100%) translate(${o.sx.toFixed(1)}px,${o.sy.toFixed(1)}px)`;
      o.label.style.zIndex = String(Math.round((1 - v.z) * 100000));
      const lv = state.places[id].health?.level;
      o.prio = (selected === id ? 16 : 0) + (o.label.classList.contains('is-end') ? 8 : 0) + (hovered === id ? 4 : 0) + (lv === 'crit' ? 2 : lv === 'warn' ? 1 : 0);
      shown.push(o);
    }
    shown.sort((a, b) => b.prio - a.prio || a.sz - b.sz);
    const placed = [];
    for (const o of shown) {
      const x0 = o.sx - o.lw / 2 - 3, x1 = o.sx + o.lw / 2 + 3, y0 = o.sy - o.lh - 2, y1 = o.sy + 2;
      const clash = placed.some((p) => x0 < p[1] && x1 > p[0] && y0 < p[3] && y1 > p[2]);
      o.label.classList.toggle('is-crowded', clash);
      if (!clash) placed.push([x0, x1, y0, y1]);
    }
    const far = cam.radius > 150;
    for (const id in zoneObj) {
      const z = zoneObj[id];
      v.copy(z.pos).project(camera);
      z.label.style.display = v.z < 1 && (far || selZone === id) ? '' : 'none';
      z.label.style.transform = `translate(0,2px) translate(${((v.x * 0.5 + 0.5) * W).toFixed(1)}px,${((-v.y * 0.5 + 0.5) * H).toFixed(1)}px)`;
    }
  }
  const onVis = () => { running = !document.hidden; last = performance.now(); };
  document.addEventListener('visibilitychange', onVis);

  // ───────── Start ─────────
  applyColours(); resize(); Object.assign(cam, HOME); refreshMachines(); show();
  const focus = ctx.opts?.focus || null;
  if (focus && nodeById[focus]) { select(focus); const n = nodeById[focus]; Object.assign(cam, { tx: n.pos[0], tz: n.pos[1], radius: 150 }); focusNode(focus); }
  else if (!reduced()) { Object.assign(cam, { radius: HOME.radius * 1.45, phi: 0.62, theta: -0.75 }); flyTo(HOME, 2.0); }
  placeCamera();
  raf = requestAnimationFrame(frame);
  // Handle for automated checks and for other views that want to drive the map.
  window.__demeMap = { select, selectFlow, selectZone, focusNode, focusFlow, focusZone, startTour, flyTo, cam, flows: FLOWS, get state() { return state; } };

  return () => {
    alive = false;
    cancelAnimationFrame(raf); ro.disconnect(); off();
    document.removeEventListener('visibilitychange', onVis);
    selPart = null; refreshPartBox();
    const mats = new Set();
    scene.traverse((o) => {
      if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose();
      for (const m of [].concat(o.material || [])) if (!m.userData.shared) mats.add(m);
    });
    for (const m of [...Object.values(M), ...Object.values(ringMat), ...Object.values(layerMat), selMat, unseen, ...mats]) m.dispose();
    renderer.dispose(); renderer.forceContextLoss();
    if (window.__demeMap?.cam === cam) delete window.__demeMap;
  };
}
