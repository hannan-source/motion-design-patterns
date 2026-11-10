// ERP view: seven working modules on the shared store. Every action here changes stock,
// orders or parcels and posts the matching voucher to the ledger, so Finance never has to
// be told twice. In production the store calls become API calls; the screens stay as they are.

import { FABRICS, SHADES } from './seed.js';
import { vouchersToTallyXML, ledgersUsed } from './tally.js';
import { esc, inr, inrFull, num, fmtDate, fmtStamp, toast, copyText, today, iso, addWorkdays, sum, DAY } from './util.js';

const MODULES = [
  { id: 'today', name: 'Today' },
  { id: 'inbound', name: 'Inbound & fabric QC' },
  { id: 'inventory', name: 'Inventory' },
  { id: 'dye', name: 'Dye house' },
  { id: 'floor', name: 'Floor' },
  { id: 'dispatch', name: 'Dispatch & returns' },
  { id: 'finance', name: 'Finance' },
];
const STAGES = [['cut', 'Cut'], ['stitch', 'Stitch'], ['finish', 'Finish'], ['qc', 'QC'], ['pack', 'Pack']];
const ROLL_STATUS = {
  unaudited: ['Not inspected', 'warn'], passed: ['Passed, clear to dye', 'ok'], rejected: ['Failed, return to mill', 'crit'],
  at_dyer: ['At dyer', 'info'], dyed: ['Dyed, in store', 'ok'], dye_reject: ['Failed after dyeing', 'crit'], issued: ['Issued to cutting', ''],
};
const PARCEL_STATUS = {
  packed: ['Packed, not scanned', 'warn'], in_transit: ['In transit', 'info'], delivered: ['Delivered', 'ok'],
  returned: ['Returned', 'warn'], at_factory: ['At factory for fit', 'warn'], at_store: ['At store', 'ok'],
};
const CHANNEL_TAG = { B2B: 'tag-material', D2C: 'tag-goods', STORE: 'tag-money', SAMPLE: 'tag-data' };
const PASS_MAX = 40;          // 4-point system: pass at 40 points per 100 sq yd or under
const DEFAULT_WIDTH_IN = 44;  // usable fabric width in inches
const CONE_PRICE = 85;
const DYER = 'Rangrez Dye Works';
const THREAD_VENDOR = 'Sagar Thread Stores';

// What the person has open. Module-level so a re-render (or leaving and coming back) keeps their place.
const ui = {
  module: 'today', invTab: 'fabric', rollFilter: 'all', inspect: null,
  dye: { open: false, fabric: null, shade: 'INDIGO', rolls: [] }, receive: null,
  output: null, pending: null, scanMsg: null, openParcels: new Set(['PCL-9005']),
  finType: 'all', sel: null,
};

const pill = (label, state) => `<span class="pill ${state ? `pill-${state}` : ''}">${esc(label)}</span>`;
const swatch = (shade) => (shade && SHADES[shade] ? `<span class="swatch" style="background:${SHADES[shade].hex}" aria-hidden="true"></span>` : '');
const shadeName = (shade) => (shade && SHADES[shade] ? `${swatch(shade)}${esc(SHADES[shade].name)}` : '<span class="faint">Greige</span>');
const todayIso = () => iso(today());
const daysSince = (d) => Math.round((today() - new Date(d)) / DAY);
const rollValue = (r) => r.metres * FABRICS[r.fabric].cost;
const span = (ms) => {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h} h ${m % 60} min` : `${Math.floor(h / 24)} d ${h % 24} h`;
};
const nextNum = (list, prefix) => Math.max(0, ...list.map((x) => Number(String(x.id).replace(prefix, '')) || 0)) + 1;

function threadNeed(s, fabric, shade, metres) {
  const st = s.styles.find((y) => y.fabric === fabric && y.shade === shade) || s.styles.find((y) => y.fabric === fabric) || { metres: 2.8, cones: 8 };
  const pieces = Math.floor(metres / st.metres);
  const cones = Math.ceil((pieces / 100) * st.cones);
  const t = s.threads.find((y) => y.shade === shade) || { cones: 0, onOrder: 0 };
  return { pieces, cones, onHand: t.cones, onOrder: t.onOrder || 0, short: Math.max(0, cones - t.cones - (t.onOrder || 0)) };
}
const lotRolls = (s, lotId) => s.rolls.filter((r) => r.lot === lotId);

// ───────────────────────── Today ─────────────────────────
function attention(s) {
  const out = [];
  const t0 = today();
  for (const t of s.threads) {
    if (t.cones >= t.min) continue;
    const lot = s.dyeLots.find((l) => l.status === 'at_dyer' && l.shade === t.shade);
    out.push({
      sev: t.cones < t.min * 0.35 ? 'crit' : 'warn', module: 'inventory', tab: 'thread',
      text: `${SHADES[t.shade].name} thread is low: ${t.cones} cones, minimum ${t.min}`,
      detail: `${lot ? `Dye lot ${lot.id} in this shade is due back ${fmtDate(lot.due)}. ` : ''}${t.onOrder ? `${t.onOrder} cones on order.` : 'Nothing on order.'}`,
    });
  }
  for (const t of s.tools) {
    if (t.onHand >= t.min) continue;
    out.push({ sev: t.onHand < t.min * 0.5 ? 'crit' : 'warn', module: 'inventory', tab: 'tools', text: `${t.name}: ${num(t.onHand)} ${t.unit}, minimum ${num(t.min)}`, detail: t.note || `Kept at: ${t.where}` });
  }
  for (const l of s.dyeLots) {
    if (l.status === 'at_dyer' && new Date(l.due) < t0) out.push({ sev: 'crit', module: 'dye', text: `Dye lot ${l.id} is ${daysSince(l.due)} days late`, detail: `${FABRICS[l.fabric].name}, ${SHADES[l.shade].name}. Was due ${fmtDate(l.due)}.` });
  }
  if (s.machines.down) out.push({ sev: 'warn', module: 'floor', text: `${s.machines.down} of ${s.machines.total} machines are down`, detail: s.machines.downList.join(', ') });
  const un = s.rolls.filter((r) => r.status === 'unaudited');
  if (un.length) {
    const bay = un.filter((r) => r.location === 'QC bay').length;
    out.push({ sev: 'warn', module: 'inbound', text: `${un.length} rolls have not been inspected: ${num(sum(un, (r) => r.metres))} m, ${inr(sum(un, rollValue))} of fabric`, detail: bay ? `${bay} are new receipts waiting at the QC bay. The rest is the dark-room backlog.` : 'All of it is the dark-room backlog. None of it can be planned until it is checked.' });
  }
  const packed = s.parcels.filter((p) => p.status === 'packed');
  if (packed.length) out.push({ sev: 'warn', module: 'dispatch', text: `${packed.length} ${packed.length === 1 ? 'parcel is' : 'parcels are'} packed but not scanned out`, detail: packed.map((p) => p.ref).join(', ') });
  for (const p of s.parcels) {
    if (p.kind === 'store' && p.status === 'at_factory') out.push({ sev: (p.visits || 0) >= 3 ? 'warn' : 'info', module: 'dispatch', text: `${p.ref} is at the factory on fit visit ${p.visits}`, detail: `In since ${fmtStamp(p.events[p.events.length - 1].at)}.` });
  }
  const rej = s.rolls.filter((r) => r.status === 'rejected');
  if (rej.length) out.push({ sev: 'info', module: 'inventory', tab: 'fabric', filter: 'rejected', text: `${rej.length} failed rolls are waiting to go back to the mill`, detail: 'Debit notes are already raised. Send the rolls with the next pickup.' });
  const unsynced = s.ledger.filter((v) => !v.synced);
  if (unsynced.length) out.push({ sev: 'info', module: 'finance', text: `${unsynced.length} vouchers are not in Tally yet`, detail: `${inr(sum(unsynced, (v) => v.amount))} across ${[...new Set(unsynced.map((v) => v.type))].join(', ')}.` });
  if (s.people.absentToday) out.push({ sev: 'info', module: 'floor', text: `${s.people.absentToday} people are absent today`, detail: 'The schedule in the Production room already allows for this.' });
  const rank = { crit: 0, warn: 1, info: 2 };
  return out.sort((a, b) => rank[a.sev] - rank[b.sev]);
}
const SEV_LABEL = { crit: 'Stops work', warn: 'Needs action', info: 'To do' };

function viewToday(s) {
  const list = attention(s);
  const open = s.orders.filter((o) => o.done.pack < o.qty);
  const un = s.rolls.filter((r) => r.status === 'unaudited');
  const atDyer = s.rolls.filter((r) => r.status === 'at_dyer');
  const unsynced = s.ledger.filter((v) => !v.synced);
  const crit = list.filter((a) => a.sev === 'crit').length;
  return `
  <div class="kpis">
    <div class="kpi"><div class="kpi-label">Open work orders</div><div class="kpi-value">${open.length}</div><div class="kpi-note">${num(sum(open, (o) => o.qty - o.done.pack))} pieces still to pack</div></div>
    <div class="kpi" data-state="${un.length ? 'warn' : 'ok'}"><div class="kpi-label">Fabric not inspected</div><div class="kpi-value">${num(sum(un, (r) => r.metres))} m</div><div class="kpi-note">${un.length} rolls, ${inr(sum(un, rollValue))}</div></div>
    <div class="kpi"><div class="kpi-label">At the dyer</div><div class="kpi-value">${num(sum(atDyer, (r) => r.metres))} m</div><div class="kpi-note">${s.dyeLots.filter((l) => l.status === 'at_dyer').length} lots out</div></div>
    <div class="kpi" data-state="${unsynced.length ? 'warn' : 'ok'}"><div class="kpi-label">Not yet in Tally</div><div class="kpi-value">${unsynced.length}</div><div class="kpi-note">${unsynced.length ? `${inr(sum(unsynced, (v) => v.amount))} of vouchers` : 'Books are up to date'}</div></div>
  </div>
  <div class="panel">
    <div class="panel-head"><h2>Needs attention</h2><span class="faint">${crit ? `${crit} can stop work today` : 'Nothing is stopping work'}</span></div>
    ${list.length ? `<ul class="attn">${list.map((a) => `
      <li><button type="button" class="attn-row" data-act="open" data-module="${a.module}" ${a.tab ? `data-tab="${a.tab}"` : ''} ${a.filter ? `data-filter="${a.filter}"` : ''}>
        ${pill(SEV_LABEL[a.sev], a.sev)}
        <span class="attn-text"><strong>${esc(a.text)}</strong><span class="muted">${esc(a.detail)}</span></span>
        <span class="attn-go">${esc(MODULES.find((m) => m.id === a.module).name)} <span aria-hidden="true">→</span></span>
      </button></li>`).join('')}</ul>` : '<div class="empty">Nothing needs attention right now.</div>'}
  </div>`;
}

// ───────────────────────── Inbound & fabric QC ─────────────────────────
const score = (points, metres, widthIn) => (points * 3600) / (metres * 1.0936 * widthIn);

function viewInbound(s) {
  const queue = s.rolls.filter((r) => r.status === 'unaudited')
    .sort((a, b) => (a.location === 'QC bay' ? 0 : 1) - (b.location === 'QC bay' ? 0 : 1) || new Date(a.received) - new Date(b.received));
  const dark = queue.filter((r) => r.location === 'Dark room');
  const audited = s.rolls.filter((r) => r.audited).length;
  const totalDark = dark.length + audited;
  const suppliers = [...new Set(s.rolls.map((r) => r.supplier))].sort();
  const insp = ui.inspect && s.rolls.find((r) => r.id === ui.inspect && r.status === 'unaudited');
  return `
  <div class="split">
    <form class="panel" data-form="receive" autocomplete="off">
      <div class="panel-head"><h2>Receive a roll</h2><span class="tag">GRN</span></div>
      <div class="panel-pad stack">
        <div class="formgrid">
          <div class="field"><label for="rc-supplier">Mill</label><select class="select" id="rc-supplier">${suppliers.map((x) => `<option>${esc(x)}</option>`).join('')}</select></div>
          <div class="field"><label for="rc-fabric">Fabric</label><select class="select" id="rc-fabric">${Object.entries(FABRICS).map(([k, f]) => `<option value="${k}">${esc(f.name)} (${inrFull(f.cost)}/m)</option>`).join('')}</select></div>
          <div class="field"><label for="rc-metres">Metres on the roll</label><input class="input num" id="rc-metres" type="number" min="1" max="500" step="1" value="100" inputmode="numeric" required></div>
        </div>
        <div class="row"><button class="btn btn-primary" type="submit">Receive and tag</button><span class="hint">Tags the roll, books the purchase, and puts it first in the inspection queue.</span></div>
      </div>
    </form>
    <div class="panel panel-pad stack">
      <div class="row"><h2 class="h-sm">Dark-room audit</h2><span class="spacer"></span><span class="num">${audited} of ${totalDark} rolls</span></div>
      <div class="bar" data-state="${audited === totalDark ? 'ok' : 'warn'}" style="--v:${totalDark ? (audited / totalDark) * 100 : 100}%"><i></i></div>
      <p class="muted">${dark.length ? `${dark.length} rolls, ${num(sum(dark, (r) => r.metres))} m worth ${inr(sum(dark, rollValue))}, have never been counted or checked. The oldest has sat for ${Math.max(...dark.map((r) => daysSince(r.received)))} days.` : 'Every roll from the dark room has been through inspection.'}</p>
    </div>
  </div>
  ${insp ? inspectPanel(insp) : ''}
  <div class="panel">
    <div class="panel-head"><h2>Inspection queue</h2><span class="faint">${queue.length} rolls. New receipts first, then the oldest backlog.</span></div>
    ${queue.length ? `<div class="table-wrap"><table class="table">
      <thead><tr><th>Roll</th><th>Fabric</th><th>Mill</th><th class="num">Metres</th><th>Where</th><th class="num">Days waiting</th><th></th></tr></thead>
      <tbody>${queue.map((r) => `<tr${insp && insp.id === r.id ? ' class="is-active"' : ''}>
        <td class="mono">${esc(r.id)}</td><td>${esc(FABRICS[r.fabric].name)}</td><td>${esc(r.supplier)}</td><td class="num">${num(r.metres)}</td>
        <td>${r.location === 'QC bay' ? pill('QC bay', 'info') : pill('Dark room', '')}</td><td class="num">${daysSince(r.received)}</td>
        <td class="t-act"><button type="button" class="btn btn-sm" data-act="inspect" data-id="${esc(r.id)}">Inspect</button></td></tr>`).join('')}</tbody></table></div>`
    : '<div class="empty">No rolls are waiting for inspection.</div>'}
  </div>`;
}

function inspectPanel(r) {
  return `
  <form class="panel inspect" data-form="inspect" id="inspect-panel" autocomplete="off">
    <div class="panel-head"><h2>Inspect ${esc(r.id)}</h2><span class="muted">${esc(FABRICS[r.fabric].name)}, ${num(r.metres)} m, ${esc(r.supplier)}</span></div>
    <div class="panel-pad stack">
      <p class="muted">4-point system. Count each defect by its length, then the score is penalty points per 100 square yards. A roll passes at ${PASS_MAX} or under.</p>
      <div class="formgrid formgrid-5">
        <div class="field"><label for="in-p1">Up to 3 in <span class="faint">(1 pt)</span></label><input class="input num" id="in-p1" type="number" min="0" value="0" inputmode="numeric"></div>
        <div class="field"><label for="in-p2">3 to 6 in <span class="faint">(2 pt)</span></label><input class="input num" id="in-p2" type="number" min="0" value="0" inputmode="numeric"></div>
        <div class="field"><label for="in-p3">6 to 9 in <span class="faint">(3 pt)</span></label><input class="input num" id="in-p3" type="number" min="0" value="0" inputmode="numeric"></div>
        <div class="field"><label for="in-p4">Over 9 in, holes <span class="faint">(4 pt)</span></label><input class="input num" id="in-p4" type="number" min="0" value="0" inputmode="numeric"></div>
        <div class="field"><label for="in-width">Width, inches</label><input class="input num" id="in-width" type="number" min="20" max="120" value="${DEFAULT_WIDTH_IN}" inputmode="numeric"></div>
      </div>
      <div class="field"><label for="in-note">Defects seen</label><input class="input" id="in-note" type="text" placeholder="For example: weft lines every 2 m, oil stain at 14 m"></div>
      <div class="verdict" id="in-verdict" data-metres="${r.metres}"></div>
      <div class="row">
        <button class="btn" type="button" data-act="camera">Read from camera</button>
        <button class="btn btn-primary" type="submit">Save result</button>
        <button class="btn btn-quiet" type="button" data-act="inspect-cancel">Cancel</button>
      </div>
      <p class="hint">Read from camera fills in a simulated result until the roller rig and its camera are installed. A failed roll gets a debit note to the mill straight away, before it can be dyed.</p>
    </div>
  </form>`;
}
function readInspect(root) {
  const g = (id) => Math.max(0, Number(root.querySelector(`#${id}`)?.value) || 0);
  const points = g('in-p1') + 2 * g('in-p2') + 3 * g('in-p3') + 4 * g('in-p4');
  const width = g('in-width') || DEFAULT_WIDTH_IN;
  const metres = Number(root.querySelector('#in-verdict')?.dataset.metres) || 100;
  const sc = Math.round(score(points, metres, width) * 10) / 10;
  return { points, width, score: sc, pass: sc <= PASS_MAX, note: root.querySelector('#in-note')?.value.trim() || '' };
}
function paintVerdict(root) {
  const v = root.querySelector('#in-verdict');
  if (!v) return;
  const r = readInspect(root);
  v.dataset.state = r.pass ? 'ok' : 'crit';
  v.innerHTML = `<span class="verdict-score num">${num(r.score, 1)}</span><span><strong>${r.pass ? 'Pass' : 'Fail'}</strong><span class="muted"> · ${r.points} penalty points over the roll, ${num(r.score, 1)} per 100 sq yd</span><br><span class="muted">${r.pass ? 'The roll is cleared for dyeing.' : 'The roll goes back to the mill with a debit note. It cannot be put on a dye lot.'}</span></span>`;
}

// ───────────────────────── Inventory ─────────────────────────
function viewInventory(s) {
  const tabs = [['fabric', 'Fabric by roll'], ['thread', 'Thread by shade'], ['tools', 'Tools & consumables']];
  return `
  <div class="seg" role="group" aria-label="Inventory type">${tabs.map(([k, n]) => `<button type="button" data-act="inv-tab" data-tab="${k}" aria-pressed="${ui.invTab === k}">${n}</button>`).join('')}</div>
  ${ui.invTab === 'fabric' ? invFabric(s) : ui.invTab === 'thread' ? invThread(s) : invTools(s)}`;
}
function invFabric(s) {
  const counts = {};
  for (const r of s.rolls) counts[r.status] = (counts[r.status] || 0) + 1;
  const statuses = Object.keys(ROLL_STATUS).filter((k) => counts[k]);
  if (ui.rollFilter !== 'all' && !counts[ui.rollFilter]) ui.rollFilter = 'all';
  const rows = s.rolls.filter((r) => ui.rollFilter === 'all' || r.status === ui.rollFilter);
  return `
  <div class="panel">
    <div class="panel-head panel-head-wrap">
      <h2>Fabric</h2>
      <div class="row chips">
        <button type="button" class="chip" data-act="roll-filter" data-filter="all" aria-pressed="${ui.rollFilter === 'all'}">All <span class="num">${s.rolls.length}</span></button>
        ${statuses.map((k) => `<button type="button" class="chip" data-act="roll-filter" data-filter="${k}" aria-pressed="${ui.rollFilter === k}">${esc(ROLL_STATUS[k][0])} <span class="num">${counts[k]}</span></button>`).join('')}
      </div>
    </div>
    <div class="table-wrap table-tall"><table class="table">
      <thead><tr><th>Roll</th><th>Fabric</th><th>Shade</th><th class="num">Metres</th><th>Status</th><th>Where</th><th>Reserved for</th><th class="num">4-pt score</th></tr></thead>
      <tbody>${rows.map((r) => `<tr>
        <td class="mono">${esc(r.id)}</td><td>${esc(FABRICS[r.fabric].name)}</td><td class="nowrap">${shadeName(r.shade)}</td><td class="num">${num(r.metres)}</td>
        <td>${pill(ROLL_STATUS[r.status][0], ROLL_STATUS[r.status][1])}</td><td>${esc(r.location || '')}${r.lot ? ` <span class="tag">${esc(r.lot)}</span>` : ''}</td>
        <td>${r.reservedFor ? `<span class="tag">${esc(r.reservedFor)}</span>` : r.status === 'dyed' ? '<span class="faint">Free</span>' : ''}</td>
        <td class="num">${r.points == null ? '' : num(r.points, 1)}</td></tr>`).join('')}</tbody>
      <tfoot><tr><td colspan="3" class="muted">${rows.length} rolls</td><td class="num">${num(sum(rows, (r) => r.metres))}</td><td colspan="4" class="muted">${inr(sum(rows, rollValue))} at purchase cost</td></tr></tfoot>
    </table></div>
  </div>`;
}
function invThread(s) {
  return `
  <div class="panel">
    <div class="panel-head"><h2>Thread</h2><span class="faint">Cones on hand against the minimum for each shade</span></div>
    <div class="table-wrap"><table class="table">
      <thead><tr><th>Shade</th><th>Code</th><th class="num">On hand</th><th class="num">Minimum</th><th class="w-bar">Level</th><th class="num">On order</th><th>Count</th><th>Order</th></tr></thead>
      <tbody>${s.threads.map((t) => {
        const st = t.cones < t.min * 0.35 ? 'crit' : t.cones < t.min ? 'warn' : 'ok';
        const qty = Math.max(24, t.min * 2 - t.cones - (t.onOrder || 0));
        return `<tr>
        <td class="nowrap">${shadeName(t.shade)}</td><td class="mono">${esc(SHADES[t.shade].code)}</td>
        <td class="num">${num(t.cones)}</td><td class="num">${num(t.min)}</td>
        <td class="w-bar"><div class="bar" data-state="${st}" style="--v:${Math.min(100, (t.cones / (t.min * 2)) * 100)}%"><i></i></div></td>
        <td class="num">${t.onOrder ? num(t.onOrder) : ''}</td>
        <td class="nowrap"><button type="button" class="btn btn-sm" data-act="thread-adj" data-shade="${t.shade}" data-d="-1" aria-label="One cone fewer of ${esc(SHADES[t.shade].name)}">−</button> <button type="button" class="btn btn-sm" data-act="thread-adj" data-shade="${t.shade}" data-d="1" aria-label="One cone more of ${esc(SHADES[t.shade].name)}">+</button></td>
        <td class="nowrap">${t.onOrder ? `<button type="button" class="btn btn-sm btn-primary" data-act="thread-receive" data-shade="${t.shade}">Receive ${num(t.onOrder)}</button>` : `<button type="button" class="btn btn-sm" data-act="thread-order" data-shade="${t.shade}" data-qty="${qty}">Raise order for ${num(qty)}</button>`}</td></tr>`;
      }).join('')}</tbody></table></div>
    <p class="hint panel-foot">The +/− buttons correct a count. Once the thread wall camera is in, it keeps this count by reading the cones. Receiving an order books the purchase at ${inrFull(CONE_PRICE)} a cone.</p>
  </div>`;
}
function invTools(s) {
  return `
  <div class="panel">
    <div class="panel-head"><h2>Tools & consumables</h2><span class="faint">${s.tools.filter((t) => t.onHand < t.min).length} below minimum</span></div>
    <div class="table-wrap"><table class="table">
      <thead><tr><th>Item</th><th class="num">On hand</th><th class="num">Minimum</th><th class="w-bar">Level</th><th>Kept at</th><th>Note</th><th>Count</th></tr></thead>
      <tbody>${s.tools.map((t) => {
        const st = t.onHand < t.min * 0.5 ? 'crit' : t.onHand < t.min ? 'warn' : 'ok';
        const step = t.onHand > 300 ? 50 : 1;
        return `<tr>
        <td>${esc(t.name)}</td><td class="num">${num(t.onHand)} <span class="faint">${esc(t.unit)}</span></td><td class="num">${num(t.min)}</td>
        <td class="w-bar"><div class="bar" data-state="${st}" style="--v:${Math.min(100, (t.onHand / (t.min * 2)) * 100)}%"><i></i></div></td>
        <td>${esc(t.where)}</td><td class="muted">${esc(t.note || '')}</td>
        <td class="nowrap"><button type="button" class="btn btn-sm" data-act="tool-adj" data-id="${t.id}" data-d="${-step}" aria-label="Fewer ${esc(t.name)}">−${step > 1 ? step : ''}</button> <button type="button" class="btn btn-sm" data-act="tool-adj" data-id="${t.id}" data-d="${step}" aria-label="More ${esc(t.name)}">+${step > 1 ? step : ''}</button></td></tr>`;
      }).join('')}</tbody></table></div>
  </div>`;
}

// ───────────────────────── Dye house ─────────────────────────
function viewDye(s) {
  const lots = [...s.dyeLots].sort((a, b) => (a.status === 'at_dyer' ? 0 : 1) - (b.status === 'at_dyer' ? 0 : 1) || new Date(b.sent) - new Date(a.sent));
  const passed = s.rolls.filter((r) => r.status === 'passed');
  const recv = ui.receive && s.dyeLots.find((l) => l.id === ui.receive && l.status === 'at_dyer');
  // Thread is shared by every lot in a shade, so cover the lots in the order they come back.
  const needs = {};
  const left = Object.fromEntries(s.threads.map((t) => [t.shade, t.cones + (t.onOrder || 0)]));
  for (const l of s.dyeLots.filter((x) => x.status === 'at_dyer').sort((a, b) => new Date(a.due) - new Date(b.due))) {
    const n = threadNeed(s, l.fabric, l.shade, sum(lotRolls(s, l.id), (r) => r.metres));
    n.short = Math.max(0, n.cones - Math.max(0, left[l.shade] || 0));
    left[l.shade] = (left[l.shade] || 0) - n.cones;
    needs[l.id] = n;
  }
  return `
  <div class="gate-note">
    <strong>Only rolls that passed inspection can go to the dyer.</strong>
    <span>A fault found before dyeing goes back to the mill at their cost. A fault found after dyeing is Dema's loss. This screen will not let an unchecked roll onto a lot.</span>
  </div>
  ${ui.dye.open ? dyeForm(s, passed) : `<div class="row"><button type="button" class="btn btn-primary" data-act="dye-new" ${passed.length ? '' : 'disabled'}>New dye lot</button><span class="hint">${passed.length ? `${passed.length} passed rolls are waiting, ${num(sum(passed, (r) => r.metres))} m.` : 'No passed rolls are waiting. Inspect rolls in Inbound first.'}</span></div>`}
  ${recv ? receiveForm(s, recv) : ''}
  <div class="panel">
    <div class="panel-head"><h2>Dye lots</h2><span class="faint">${lots.filter((l) => l.status === 'at_dyer').length} out with ${esc(DYER)}</span></div>
    <ul class="lots">${lots.map((l) => {
      const rolls = lotRolls(s, l.id);
      const metres = sum(rolls, (r) => r.metres);
      const out = l.status === 'at_dyer';
      const late = out && new Date(l.due) < today();
      const need = out ? needs[l.id] : null;
      return `<li class="lot">
        <div class="lot-main">
          <div class="row"><span class="mono lot-id">${esc(l.id)}</span>${out ? pill(late ? `Late by ${daysSince(l.due)} d` : 'At dyer', late ? 'crit' : 'info') : pill('Returned', 'ok')}</div>
          <div class="lot-what">${esc(FABRICS[l.fabric].name)} <span class="faint">to</span> ${shadeName(l.shade)}</div>
          <div class="muted">${rolls.length} rolls, ${num(metres)} m${l.forOrders?.length ? ` · for ${l.forOrders.map(esc).join(', ')}` : ''}${l.note ? ` · ${esc(l.note)}` : ''}</div>
        </div>
        <dl class="lot-dates">
          <div><dt>Sent</dt><dd>${fmtDate(l.sent)}</dd></div>
          <div><dt>${out ? 'Days out' : 'Came back'}</dt><dd>${out ? daysSince(l.sent) : fmtDate(l.returned || l.due)}</dd></div>
          <div><dt>Due</dt><dd>${fmtDate(l.due)}</dd></div>
        </dl>
        ${out ? `<div class="lot-thread" data-state="${need.short ? 'warn' : 'ok'}">
          <span>${swatch(l.shade)}Thread for this lot: about <strong>${num(need.cones)}</strong> cones for ${num(need.pieces)} pieces. <strong>${num(need.onHand)}</strong> on hand${need.onOrder ? `, ${num(need.onOrder)} on order` : ''}.</span>
          ${need.short ? `<button type="button" class="btn btn-sm" data-act="thread-order" data-shade="${l.shade}" data-qty="${Math.max(24, need.short)}">Order ${num(Math.max(24, need.short))} cones</button>` : pill('Covered', 'ok')}
        </div>
        <div class="lot-act"><button type="button" class="btn btn-sm btn-primary" data-act="dye-receive" data-id="${esc(l.id)}">Receive lot</button></div>` : ''}
      </li>`;
    }).join('')}</ul>
  </div>`;
}
function dyeForm(s, passed) {
  const fabrics = [...new Set(passed.map((r) => r.fabric))];
  if (!fabrics.includes(ui.dye.fabric)) { ui.dye.fabric = fabrics[0] || null; ui.dye.rolls = []; }
  const rolls = passed.filter((r) => r.fabric === ui.dye.fabric);
  ui.dye.rolls = ui.dye.rolls.filter((id) => rolls.some((r) => r.id === id));
  return `
  <form class="panel" data-form="dye-create" autocomplete="off">
    <div class="panel-head"><h2>New dye lot</h2><button type="button" class="btn btn-sm btn-quiet" data-act="dye-cancel">Cancel</button></div>
    <div class="panel-pad stack">
      ${fabrics.length ? `
      <div class="formgrid">
        <div class="field"><label for="dy-fabric">Fabric</label><select class="select" id="dy-fabric" data-change="dye-fabric">${fabrics.map((f) => `<option value="${f}" ${f === ui.dye.fabric ? 'selected' : ''}>${esc(FABRICS[f].name)}</option>`).join('')}</select></div>
        <div class="field"><label for="dy-shade">Dye to shade</label><select class="select" id="dy-shade" data-change="dye-shade">${Object.entries(SHADES).map(([k, sh]) => `<option value="${k}" ${k === ui.dye.shade ? 'selected' : ''}>${esc(sh.name)} (${esc(sh.code)})</option>`).join('')}</select></div>
      </div>
      <fieldset class="rollpick"><legend>Passed rolls of ${esc(FABRICS[ui.dye.fabric].name)}</legend>
        ${rolls.map((r) => `<label class="rollpick-item"><input type="checkbox" data-change="dye-roll" value="${esc(r.id)}" id="dy-${esc(r.id)}" ${ui.dye.rolls.includes(r.id) ? 'checked' : ''}><span class="mono">${esc(r.id)}</span><span class="num">${num(r.metres)} m</span><span class="faint">score ${num(r.points, 1)}</span></label>`).join('')}
      </fieldset>
      <div id="dye-summary">${dyeSummary(s)}</div>
      <div class="row"><button class="btn btn-primary" type="submit">Send to dyer</button><span class="hint">Rolls that failed or were never inspected are not listed here on purpose.</span></div>`
      : '<div class="empty">No passed rolls are waiting. Inspect rolls in Inbound first.</div>'}
    </div>
  </form>`;
}
function dyeSummary(s) {
  const metres = sum(s.rolls.filter((r) => ui.dye.rolls.includes(r.id)), (r) => r.metres);
  if (!metres) return '<p class="muted">Tick the rolls to send.</p>';
  const need = threadNeed(s, ui.dye.fabric, ui.dye.shade, metres);
  return `<div class="lot-thread" data-state="${need.short ? 'warn' : 'ok'}">
    <span>${swatch(ui.dye.shade)}<strong>${ui.dye.rolls.length}</strong> rolls, <strong>${num(metres)}</strong> m, dyeing charge about ${inr(metres * FABRICS[ui.dye.fabric].dye)}. Thread: about <strong>${num(need.cones)}</strong> cones of ${esc(SHADES[ui.dye.shade].name)} for ${num(need.pieces)} pieces, <strong>${num(need.onHand)}</strong> on hand${need.onOrder ? `, ${num(need.onOrder)} on order` : ''}.</span>
    ${need.short ? pill(`${num(need.short)} cones short`, 'warn') : pill('Thread covered', 'ok')}
  </div>${need.short ? '<p class="hint">You can order the thread from the lot once it is sent, so it arrives before the fabric does.</p>' : ''}`;
}
function receiveForm(s, lot) {
  const rolls = lotRolls(s, lot.id).filter((r) => r.status === 'at_dyer');
  return `
  <form class="panel" data-form="dye-receive" id="receive-panel" autocomplete="off">
    <div class="panel-head"><h2>Receive ${esc(lot.id)}: shade check</h2><button type="button" class="btn btn-sm btn-quiet" data-act="receive-cancel">Cancel</button></div>
    <div class="panel-pad stack">
      <p class="muted">Compare each roll with the approved ${esc(SHADES[lot.shade].name)} swatch. Tick any roll that fails on shade or shows a defect. The dyer is billed for accepted metres only.</p>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>Roll</th><th class="num">Metres</th><th>Failed</th><th>What is wrong</th></tr></thead>
        <tbody>${rolls.map((r) => `<tr><td class="mono">${esc(r.id)}</td><td class="num">${num(r.metres)}</td>
          <td><label class="check"><input type="checkbox" id="rv-fail-${esc(r.id)}" data-roll="${esc(r.id)}"> <span>Fail</span></label></td>
          <td><input class="input" type="text" id="rv-note-${esc(r.id)}" aria-label="What is wrong with ${esc(r.id)}" placeholder="Only if failed"></td></tr>`).join('')}</tbody>
      </table></div>
      <div class="row"><button class="btn btn-primary" type="submit">Accept lot</button><span class="hint">Accepted rolls go to the fabric store. Failed rolls are written off, because the mill will not take dyed fabric back.</span></div>
    </div>
  </form>`;
}

// ───────────────────────── Floor ─────────────────────────
function viewFloor(s) {
  const styles = Object.fromEntries(s.styles.map((y) => [y.id, y]));
  const orders = [...s.orders].sort((a, b) => new Date(a.due) - new Date(b.due));
  const stations = [];
  for (let i = 1; i <= 34; i++) stations.push(`B2B-${String(i).padStart(2, '0')}`);
  for (let i = 1; i <= 18; i++) stations.push(`D2C-${String(i).padStart(2, '0')}`);
  const tool = (id) => s.tools.find((t) => t.id === id);
  const kit = [
    ['Needles #11', tool('needle11')], ['Sharp shears', tool('shears')], ['Dress forms in place', tool('forms')],
  ].filter(([, t]) => t).map(([label, t]) => ({ label, value: `${num(t.onHand)} of ${num(t.min)} ${t.unit}`, st: t.onHand < t.min * 0.5 ? 'crit' : t.onHand < t.min ? 'warn' : 'ok', note: t.note }));
  kit.push({ label: 'Machines running', value: `${s.machines.total - s.machines.down} of ${s.machines.total}`, st: s.machines.down ? 'warn' : 'ok', note: s.machines.down ? `Down: ${s.machines.downList.join(', ')}` : '' });
  kit.push({ label: 'People absent today', value: String(s.people.absentToday), st: s.people.absentToday > 3 ? 'warn' : 'ok', note: '' });
  const cyc = s.styles.map((y) => {
    const p = s.punches.filter((x) => x.style === y.id);
    const pieces = sum(p, (x) => x.pieces);
    const actual = pieces ? sum(p, (x) => x.minutes) / pieces : null;
    return { y, scans: p.length, pieces, actual, gap: actual == null ? null : actual / y.smv.stitch - 1 };
  });
  return `
  <div class="panel">
    <div class="panel-head"><h2>Work orders</h2><span class="faint">${orders.filter((o) => o.done.pack < o.qty).length} open, in due-date order</span></div>
    <div class="table-wrap"><table class="table orders">
      <thead><tr><th>Order</th><th>Style</th><th class="num">Pieces</th><th>Cut · Stitch · Finish · QC · Pack</th><th class="num">Packed</th><th>Due</th><th></th></tr></thead>
      <tbody>${orders.map((o) => {
        const left = Math.round((new Date(o.due) - today()) / DAY);
        const done = o.done.pack >= o.qty;
        const row = `<tr>
          <td><span class="mono">${esc(o.id)}</span> <span class="tag ${CHANNEL_TAG[o.channel] || ''}">${esc(o.channel)}</span><div class="faint">${esc(o.customer)}</div></td>
          <td>${esc(styles[o.style]?.name || o.style)}</td><td class="num">${num(o.qty)}</td>
          <td><div class="stages" role="img" aria-label="${STAGES.map(([k, n]) => `${n} ${o.done[k]} of ${o.qty}`).join(', ')}">${STAGES.map(([k, n]) => `<span class="stage" title="${n}: ${num(o.done[k])} of ${num(o.qty)}" style="--v:${Math.min(100, (o.done[k] / o.qty) * 100)}%"><i></i></span>`).join('')}</div></td>
          <td class="num">${num(o.done.pack)}</td>
          <td class="nowrap">${fmtDate(o.due)} ${done ? pill('Done', 'ok') : left < 0 ? pill(`${-left} d late`, 'crit') : `<span class="faint">in ${left} d</span>`}</td>
          <td class="t-act">${done ? '' : `<button type="button" class="btn btn-sm" data-act="output" data-id="${esc(o.id)}">Record output</button>`}</td></tr>`;
        return row + (ui.output === o.id && !done ? outputRow(o) : '');
      }).join('')}</tbody></table></div>
  </div>
  <div class="split">
    <form class="panel" data-form="punch" autocomplete="off">
      <div class="panel-head"><h2>Bundle scan</h2><span class="faint">Start and finish of one bundle at one station</span></div>
      <div class="panel-pad stack">
        <div class="formgrid">
          <div class="field"><label for="pn-station">Station</label><select class="select" id="pn-station">${stations.map((x) => `<option>${x}</option>`).join('')}</select></div>
          <div class="field"><label for="pn-style">Style</label><select class="select" id="pn-style">${s.styles.map((y) => `<option value="${y.id}">${esc(y.name)}</option>`).join('')}</select></div>
          <div class="field"><label for="pn-pieces">Pieces in the bundle</label><input class="input num" id="pn-pieces" type="number" min="1" max="200" value="12" inputmode="numeric" required></div>
          <div class="field"><label for="pn-minutes">Minutes from start to finish</label><input class="input num" id="pn-minutes" type="number" min="1" max="5000" value="660" inputmode="numeric" required></div>
        </div>
        <div class="row"><button class="btn btn-primary" type="submit">Save scan</button><span class="hint">On the floor this is two taps of the bundle tag on the station reader. Timing comes from the bundle, so nobody is watched by a camera.</span></div>
      </div>
    </form>
    <div class="panel">
      <div class="panel-head"><h2>Station kit check</h2><span class="faint">Shift start</span></div>
      <ul class="kit">${kit.map((k) => `<li><span class="kit-label">${esc(k.label)}${k.note ? `<span class="faint">${esc(k.note)}</span>` : ''}</span><span class="num">${esc(k.value)}</span>${pill(k.st === 'ok' ? 'OK' : k.st === 'warn' ? 'Short' : 'Stops work', k.st)}</li>`).join('')}</ul>
    </div>
  </div>
  <div class="panel">
    <div class="panel-head"><h2>Stitching time per piece</h2><span class="faint">Standard minutes against what the scans show</span></div>
    <div class="table-wrap"><table class="table">
      <thead><tr><th>Style</th><th class="num">Standard min</th><th class="num">Actual min</th><th class="num">Gap</th><th class="num">Scans</th><th class="num">Pieces</th><th>Reading</th></tr></thead>
      <tbody>${cyc.map((c) => `<tr>
        <td>${esc(c.y.name)}${c.y.bestseller ? ' <span class="tag">Bestseller</span>' : ''}</td><td class="num">${num(c.y.smv.stitch)}</td>
        <td class="num">${c.actual == null ? '' : num(c.actual, 1)}</td>
        <td class="num">${c.gap == null ? '' : `${c.gap > 0 ? '+' : '−'}${Math.abs(Math.round(c.gap * 100))}%`}</td>
        <td class="num">${c.scans}</td><td class="num">${num(c.pieces)}</td>
        <td>${c.gap == null ? '<span class="faint">No scans yet</span>' : c.gap > 0.1 ? pill('Slower than standard', 'warn') : c.gap < -0.1 ? pill('Faster than standard', 'info') : pill('On standard', 'ok')}</td></tr>`).join('')}</tbody>
    </table></div>
    <p class="hint panel-foot">A style running more than 10% over standard is flagged. Either the standard is wrong, which makes every promise date wrong, or something at the station is slowing the tailor down.</p>
  </div>`;
}
function outputRow(o) {
  const room = (k, i) => (i === 0 ? o.qty : o.done[STAGES[i - 1][0]]) - o.done[k];
  const first = STAGES.findIndex(([k], i) => room(k, i) > 0);
  return `<tr class="inline-form"><td colspan="7">
    <form class="row" data-form="output" data-id="${esc(o.id)}" autocomplete="off">
      <div class="field"><label for="op-stage">Stage</label><select class="select" id="op-stage">${STAGES.map(([k, n], i) => `<option value="${k}" ${i === first ? 'selected' : ''} ${room(k, i) > 0 ? '' : 'disabled'}>${n} (room for ${num(room(k, i))})</option>`).join('')}</select></div>
      <div class="field"><label for="op-pieces">Pieces finished</label><input class="input num" id="op-pieces" type="number" min="1" value="${first >= 0 ? Math.min(50, room(STAGES[first][0], first)) : 1}" inputmode="numeric" required></div>
      <button class="btn btn-primary" type="submit">Save</button>
      <button class="btn btn-quiet" type="button" data-act="output-cancel">Cancel</button>
      <span class="hint">A stage cannot finish more pieces than the stage before it has passed on.</span>
    </form></td></tr>`;
}

// ───────────────────────── Dispatch & returns ─────────────────────────
function viewDispatch(s) {
  const waiting = s.parcels.filter((p) => p.status === 'packed' || p.status === 'at_factory');
  const out = s.parcels.filter((p) => ['in_transit', 'delivered', 'at_store'].includes(p.status) || (p.status === 'returned' && p.events[p.events.length - 1].type !== 'in'));
  const pend = ui.pending && s.parcels.find((p) => p.id === ui.pending.id);
  const order = { packed: 0, at_factory: 1, in_transit: 2, returned: 3, at_store: 4, delivered: 5 };
  const parcels = [...s.parcels].sort((a, b) => order[a.status] - order[b.status]);
  const styles = Object.fromEntries(s.styles.map((y) => [y.id, y]));
  return `
  <div class="panel scan">
    <form class="panel-pad stack" data-form="scan" autocomplete="off">
      <div class="field"><label for="sc-code">Scan or type a barcode</label>
        <div class="scan-row"><input class="input mono" id="sc-code" type="text" placeholder="DHL waybill or Dema store tag" autocapitalize="characters" spellcheck="false"><button class="btn btn-primary" type="submit">Scan</button></div></div>
      <p class="hint">Everything that leaves or comes back passes this one gate. In production the gate camera reads the label and fills this box.</p>
      ${ui.scanMsg ? `<div class="scan-msg" data-state="${ui.scanMsg.state}" role="status">${esc(ui.scanMsg.text)}</div>` : ''}
      ${waiting.length ? `<div class="row"><span class="eyebrow">Waiting to go out</span>${waiting.map((p) => `<button type="button" class="chip mono" data-act="scan-code" data-code="${esc(p.barcode)}" title="${esc(p.ref)}">${esc(p.barcode)}</button>`).join('')}</div>` : ''}
      ${out.length ? `<div class="row"><span class="eyebrow">Out, try a return</span>${out.slice(0, 4).map((p) => `<button type="button" class="chip mono" data-act="scan-code" data-code="${esc(p.barcode)}" title="${esc(p.ref)}">${esc(p.barcode)}</button>`).join('')}</div>` : ''}
    </form>
    ${pend ? pendingForm(pend) : ''}
  </div>
  <div class="row">
    <h2 class="h-sm">Parcels</h2><span class="spacer"></span>
    <span class="hint">Simulated until the DHL connector is live.</span>
    <button type="button" class="btn btn-sm" data-act="dhl-refresh">Refresh DHL</button>
  </div>
  <div class="parcels">${parcels.map((p) => `
    <details class="panel parcel" data-id="${esc(p.id)}" ${ui.openParcels.has(p.id) ? 'open' : ''}>
      <summary>
        <span class="parcel-ref"><strong>${esc(p.ref)}</strong><span class="muted">${esc(styles[p.style]?.name || p.style)} · ${esc(p.dest)}</span></span>
        <span class="tag ${p.kind === 'store' ? 'tag-money' : p.kind === 'b2b' ? 'tag-material' : 'tag-goods'}">${p.kind === 'store' ? 'Store' : p.kind === 'b2b' ? 'B2B' : 'Shopify'}</span>
        ${pill(PARCEL_STATUS[p.status][0], PARCEL_STATUS[p.status][1])}
      </summary>
      <div class="parcel-body">
        <div class="mono faint parcel-code">${esc(p.barcode)}</div>
        ${p.kind === 'store' ? fitNote(p) : ''}
        <ol class="timeline">${[...p.events].reverse().map((e) => `<li data-type="${esc(e.type)}"><span class="tl-dot" aria-hidden="true"></span><span class="tl-text">${esc(e.text)}</span><time class="faint num">${fmtStamp(e.at)}</time></li>`).join('')}</ol>
      </div>
    </details>`).join('')}</div>`;
}
function pendingForm(p) {
  if (ui.pending.dir === 'in') {
    return `<form class="panel-pad stack pending" data-form="pending" autocomplete="off">
      <strong>${esc(p.ref)} is coming in on fit visit ${(p.visits || 0) + 1}.</strong>
      <div class="field"><label for="pd-note">What needs changing?</label><input class="input" id="pd-note" type="text" placeholder="For example: take in waist 2 cm" required></div>
      <div class="row"><button class="btn btn-primary" type="submit">Scan in</button><button class="btn btn-quiet" type="button" data-act="pending-cancel">Cancel</button></div>
    </form>`;
  }
  const lastIn = [...p.events].reverse().find((e) => e.type === 'in');
  return `<form class="panel-pad stack pending" data-form="pending" autocomplete="off">
    <strong>${esc(p.ref)} is going back to the store.</strong> <span class="muted">In the factory for ${lastIn ? span(Date.now() - new Date(lastIn.at)) : 'an unknown time'}.</span>
    <div class="field"><label for="pd-work">Minutes of work on this visit</label><input class="input num" id="pd-work" type="number" min="0" max="2000" placeholder="Filled from bundle scans when the piece was scanned at a station" inputmode="numeric"></div>
    <div class="row"><button class="btn btn-primary" type="submit">Scan out</button><button class="btn btn-quiet" type="button" data-act="pending-cancel">Cancel</button></div>
  </form>`;
}
function fitNote(p) {
  const visits = [];
  let cur = null;
  let first = null;
  for (const e of p.events) {
    if (e.type === 'out' && !first && !cur) first = e;
    if (e.type === 'in') { cur = { in: e, out: null }; visits.push(cur); }
    else if (e.type === 'out' && cur) { cur.out = e; cur = null; }
  }
  const total = sum(visits, (v) => (v.out ? new Date(v.out.at) : new Date()) - new Date(v.in.at));
  return `<div class="fitnote">
    <div class="row"><span class="eyebrow">Fit note</span><span class="spacer"></span>${pill(`${visits.length} ${visits.length === 1 ? 'visit' : 'visits'}`, visits.length >= 3 ? 'crit' : visits.length === 2 ? 'warn' : 'info')}</div>
    <p>This is an order from the Bombay store${first ? `, first sent out on ${fmtStamp(first.at)}` : ''}. It has spent ${span(total)} at the factory across ${visits.length} fit ${visits.length === 1 ? 'visit' : 'visits'}.</p>
    <div class="table-wrap"><table class="table"><thead><tr><th>Visit</th><th>Came in</th><th>Went out</th><th class="num">Time in factory</th><th class="num">Work</th></tr></thead>
    <tbody>${visits.map((v, i) => `<tr><td class="mono">${i + 1}</td><td>${fmtStamp(v.in.at)}<div class="muted">${esc(v.in.note || v.in.text.replace(/^Scanned in: fit visit \d+,?\s*/, ''))}</div></td>
      <td>${v.out ? fmtStamp(v.out.at) : pill('Still here', 'warn')}</td><td class="num">${span((v.out ? new Date(v.out.at) : new Date()) - new Date(v.in.at))}</td>
      <td class="num">${v.out ? esc(v.out.workMin != null ? `${v.out.workMin} min` : (v.out.text.match(/work (\d+ min)/) || [])[1] || '') : ''}</td></tr>`).join('')}</tbody></table></div>
    ${visits.length >= 3 ? '<p class="hint">Three visits for one piece. Check the pattern or the store\'s measuring for this style.</p>' : ''}
  </div>`;
}

// ───────────────────────── Finance ─────────────────────────
const selected = (s) => (ui.sel ? s.ledger.filter((v) => ui.sel.has(v.id)) : s.ledger.filter((v) => !v.synced));

function viewFinance(s) {
  const types = ['all', ...new Set(s.ledger.map((v) => v.type))];
  if (!types.includes(ui.finType)) ui.finType = 'all';
  const rows = [...s.ledger].sort((a, b) => new Date(b.date) - new Date(a.date)).filter((v) => ui.finType === 'all' || v.type === ui.finType);
  const sel = selected(s);
  const selIds = new Set(sel.map((v) => v.id));
  const claims = s.ledger.filter((v) => v.type === 'Debit Note');
  const lost = s.ledger.filter((v) => v.type === 'Journal' && /^Fabric Loss/i.test(v.dr));
  const unsynced = s.ledger.filter((v) => !v.synced);
  return `
  <div class="kpis">
    <div class="kpi" data-state="ok"><div class="kpi-label">Claims recovered from mills</div><div class="kpi-value">${inr(sum(claims, (v) => v.amount))}</div><div class="kpi-note">${claims.length} debit notes, caught before dyeing</div></div>
    <div class="kpi" data-state="crit"><div class="kpi-label">Lost after dyeing</div><div class="kpi-value">${inr(sum(lost, (v) => v.amount))}</div><div class="kpi-note">${lost.length} write-offs the mill would not take back</div></div>
    <div class="kpi" data-state="${unsynced.length ? 'warn' : 'ok'}"><div class="kpi-label">Not yet in Tally</div><div class="kpi-value">${unsynced.length}</div><div class="kpi-note">${unsynced.length ? inr(sum(unsynced, (v) => v.amount)) : 'Up to date'}</div></div>
  </div>
  <div class="panel">
    <div class="panel-head panel-head-wrap"><h2>Voucher register</h2>
      <div class="row chips">${types.map((t) => `<button type="button" class="chip" data-act="fin-type" data-type="${esc(t)}" aria-pressed="${ui.finType === t}">${t === 'all' ? 'All' : esc(t)}</button>`).join('')}</div></div>
    <div class="table-wrap table-tall"><table class="table">
      <thead><tr><th><span class="sr">Select for Tally</span></th><th>Date</th><th>No.</th><th>Type</th><th>Party</th><th>Debit</th><th>Credit</th><th class="num">Amount</th><th>Source</th><th>Tally</th></tr></thead>
      <tbody>${rows.map((v) => `<tr>
        <td><input type="checkbox" data-change="fin-sel" value="${esc(v.id)}" id="fs-${esc(v.id)}" aria-label="Select ${esc(v.id)}" ${selIds.has(v.id) ? 'checked' : ''}></td>
        <td class="nowrap">${fmtDate(v.date)}</td><td class="mono">${esc(v.id)}</td><td class="nowrap">${esc(v.type)}</td><td>${esc(v.party)}<div class="muted narr">${esc(v.narration)}</div></td>
        <td>${esc(v.dr)}</td><td>${esc(v.cr)}</td><td class="num">${inrFull(v.amount)}</td><td><span class="tag">${esc(v.ref || '')}</span></td>
        <td>${v.synced ? pill('In Tally', 'ok') : pill('Not sent', 'warn')}</td></tr>`).join('')}</tbody>
    </table></div>
  </div>
  <div class="panel" id="tally-panel">
    <div class="panel-head panel-head-wrap"><h2>Tally XML</h2>
      <div class="row"><span class="faint">${sel.length} ${sel.length === 1 ? 'voucher' : 'vouchers'} selected, ${inr(sum(sel, (v) => v.amount))}</span>
        <button type="button" class="btn btn-sm" data-act="xml-copy" ${sel.length ? '' : 'disabled'}>Copy XML</button>
        <button type="button" class="btn btn-sm btn-primary" data-act="xml-sent" ${sel.some((v) => !v.synced) ? '' : 'disabled'}>Mark as sent to Tally</button></div></div>
    ${sel.length ? `<div class="panel-pad stack">
      <p class="muted">Import this in Tally Prime under Import, Transactions. These ledgers must exist first: ${ledgersUsed(sel).map((l) => `<span class="tag">${esc(l)}</span>`).join(' ')}</p>
      <pre class="xml" id="tally-xml" tabindex="0">${esc(vouchersToTallyXML(sel))}</pre>
      <p class="hint">Copy and import is the manual route. Once the Tally connector is running it posts each voucher as it happens and this step goes away.</p></div>`
    : '<div class="empty">Tick vouchers in the register to build the import file. New vouchers are selected for you.</div>'}
  </div>`;
}

// ───────────────────────── Mount, actions ─────────────────────────
const VIEWS = { today: viewToday, inbound: viewInbound, inventory: viewInventory, dye: viewDye, floor: viewFloor, dispatch: viewDispatch, finance: viewFinance };
const INTRO = {
  today: 'What needs a decision before the shift ends, worst first.',
  inbound: 'Receive fabric, inspect every roll, and send failures back before they cost anything.',
  inventory: 'What is on the shelf, what it is for, and what is running low.',
  dye: 'Lots out to the dyer and back, with the thread ordered before the fabric returns.',
  floor: 'Orders through each stage, and how long a piece really takes to stitch.',
  dispatch: 'One scan gate for parcels out, returns in, and store pieces coming back for fit.',
  finance: 'Every voucher the factory has raised, ready for Tally.',
};

export function mount(el, ctx) {
  const { store } = ctx;
  if (ctx.opts?.module && VIEWS[ctx.opts.module]) ui.module = ctx.opts.module;
  if (ctx.opts?.tab) ui.invTab = ctx.opts.tab;

  el.innerHTML = `<div class="workspace"><div class="workspace-inner">
    <div class="view-head">
      <div><h1>ERP</h1><p>The working record of the factory: what came in, where it is, who did what, and what it cost. All figures are example data until Dema's own are loaded.</p></div>
      <button type="button" class="btn btn-sm btn-quiet" data-act="reset">Reset example data</button>
    </div>
    <div class="erp">
      <nav class="erp-rail" aria-label="ERP modules"></nav>
      <section class="erp-main"></section>
    </div>
  </div></div>`;
  const root = el.querySelector('.workspace');
  const rail = el.querySelector('.erp-rail');
  const main = el.querySelector('.erp-main');

  function counts(s) {
    return {
      today: attention(s).filter((a) => a.sev !== 'info').length,
      inbound: s.rolls.filter((r) => r.status === 'unaudited').length,
      inventory: s.threads.filter((t) => t.cones < t.min).length + s.tools.filter((t) => t.onHand < t.min).length,
      dye: s.dyeLots.filter((l) => l.status === 'at_dyer').length,
      floor: s.orders.filter((o) => o.done.pack < o.qty).length,
      dispatch: s.parcels.filter((p) => p.status === 'packed' || p.status === 'at_factory').length,
      finance: s.ledger.filter((v) => !v.synced).length,
    };
  }
  function render() {
    const s = store.get();
    const c = counts(s);
    rail.innerHTML = MODULES.map((m) => `<button type="button" data-act="module" data-module="${m.id}" ${ui.module === m.id ? 'aria-current="page"' : ''}><span>${m.name}</span>${c[m.id] ? `<span class="rail-count num">${c[m.id]}</span>` : ''}</button>`).join('');
    main.innerHTML = `<div class="mod-head"><h2>${MODULES.find((m) => m.id === ui.module).name}</h2><p class="muted">${INTRO[ui.module]}</p></div>${VIEWS[ui.module](s)}`;
    paintVerdict(main);
  }
  const openModule = (id) => {
    ui.module = id;
    render();
    root.scrollTop = 0;
    rail.querySelector('[aria-current]')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  };
  const reveal = (sel) => requestAnimationFrame(() => main.querySelector(sel)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
  const post = (s, counter, prefix, v) => {
    const id = store.nextId(counter, prefix);
    s.ledger.unshift({ id, date: todayIso(), synced: false, ...v });
    return id;
  };
  const nowIso = () => new Date().toISOString();

  function doScan(raw) {
    const code = String(raw || '').trim();
    const s = store.get();
    ui.pending = null;
    if (!code) { ui.scanMsg = { state: 'crit', text: 'Scan a label or type its barcode first.' }; return render(); }
    const p = s.parcels.find((x) => x.barcode.toLowerCase() === code.toLowerCase() || x.id.toLowerCase() === code.toLowerCase());
    if (!p) {
      ui.scanMsg = { state: 'crit', text: `No parcel has the barcode ${code}. Check the label was read fully. If the piece is new, pack it against its order first so the label is registered.` };
      return render();
    }
    ui.openParcels.add(p.id);
    const last = p.events[p.events.length - 1];
    if (p.status === 'packed') {
      store.update((st) => {
        const q = st.parcels.find((x) => x.id === p.id);
        q.events.push({ at: nowIso(), type: 'out', text: 'Scanned out at dispatch gate' });
        q.status = 'in_transit';
        const y = st.styles.find((z) => z.id === q.style);
        let vid = null;
        if (q.kind === 'shopify' && y) vid = post(st, 'sal', 'SAL', { type: 'Sales', party: 'Shopify', amount: y.retail, dr: 'Shopify Clearing', cr: 'Online Sales', narration: `${q.ref}: ${y.name}`, ref: q.id });
        ui.scanMsg = { state: 'ok', text: `${q.ref} scanned out. Stock is down by one${vid ? ` and sales voucher ${vid} is raised` : ''}.` };
      });
    } else if (p.kind === 'store' && p.status === 'at_factory') {
      ui.pending = { id: p.id, dir: 'out' };
      ui.scanMsg = null;
      render();
    } else if (last.type === 'in') {
      ui.scanMsg = { state: 'warn', text: `${p.ref} is already back at the factory, scanned in on ${fmtStamp(last.at)}. Nothing was changed.` };
      render();
    } else if (p.kind === 'store') {
      ui.pending = { id: p.id, dir: 'in' };
      ui.scanMsg = null;
      render();
    } else {
      store.update((st) => {
        const q = st.parcels.find((x) => x.id === p.id);
        q.events.push({ at: nowIso(), type: 'in', text: q.kind === 'b2b' ? 'Scanned in at gate: cartons returned' : 'Scanned in at gate: customer return' });
        q.status = 'returned';
        ui.scanMsg = { state: 'ok', text: `${q.ref} scanned in as a return. Stock is up by one. Send it to QC before it is put back on the shelf.` };
      });
    }
    requestAnimationFrame(() => (main.querySelector('#pd-note, #pd-work') || main.querySelector('#sc-code'))?.focus());
  }

  const actions = {
    module: (b) => openModule(b.dataset.module),
    open: (b) => {
      if (b.dataset.tab) ui.invTab = b.dataset.tab;
      if (b.dataset.filter) ui.rollFilter = b.dataset.filter;
      openModule(b.dataset.module);
    },
    reset: (b) => {
      if (b.dataset.armed) {
        Object.assign(ui, { inspect: null, receive: null, output: null, pending: null, scanMsg: null, sel: null, dye: { open: false, fabric: null, shade: 'INDIGO', rolls: [] } });
        store.reset();
        toast('Example data reset');
        delete b.dataset.armed; b.textContent = 'Reset example data';
      } else {
        b.dataset.armed = '1'; b.textContent = 'Tap again to reset';
        setTimeout(() => { if (b.isConnected) { delete b.dataset.armed; b.textContent = 'Reset example data'; } }, 3500);
      }
    },
    // Inbound
    inspect: (b) => { ui.inspect = b.dataset.id; render(); reveal('#inspect-panel'); },
    'inspect-cancel': () => { ui.inspect = null; render(); },
    camera: () => {
      const metres = Number(main.querySelector('#in-verdict')?.dataset.metres) || 100;
      const k = metres / 100;
      const fail = Math.random() < 0.3;
      const rnd = (a, b) => Math.round((a + Math.random() * (b - a)) * k);
      const vals = fail ? [rnd(14, 24), rnd(6, 10), rnd(3, 6), rnd(4, 8)] : [rnd(4, 12), rnd(1, 5), rnd(0, 2), rnd(0, 2)];
      vals.forEach((v, i) => { main.querySelector(`#in-p${i + 1}`).value = v; });
      const notes = fail ? ['Weft lines every 2 to 3 m', 'Oil stains in 8 places', 'Two holes and a running warp line', 'Shade bars across the width'] : ['Minor slubs, within tolerance', 'A few small knots, no stains', 'Clean roll, light slubs near the selvedge'];
      main.querySelector('#in-note').value = notes[Math.floor(Math.random() * notes.length)];
      paintVerdict(main);
    },
    // Inventory
    'inv-tab': (b) => { ui.invTab = b.dataset.tab; render(); },
    'roll-filter': (b) => { ui.rollFilter = b.dataset.filter; render(); },
    'thread-adj': (b) => store.update((s) => { const t = s.threads.find((x) => x.shade === b.dataset.shade); t.cones = Math.max(0, t.cones + Number(b.dataset.d)); }),
    'thread-order': (b) => {
      const qty = Number(b.dataset.qty);
      store.update((s) => { const t = s.threads.find((x) => x.shade === b.dataset.shade); t.onOrder = (t.onOrder || 0) + qty; });
      toast(`Ordered ${qty} cones of ${SHADES[b.dataset.shade].name}`);
    },
    'thread-receive': (b) => {
      let vid;
      store.update((s) => {
        const t = s.threads.find((x) => x.shade === b.dataset.shade);
        const qty = t.onOrder || 0;
        t.cones += qty; t.onOrder = 0;
        vid = post(s, 'grn', 'PUR', { type: 'Purchase', party: THREAD_VENDOR, amount: qty * CONE_PRICE, dr: 'Thread & Trims', cr: THREAD_VENDOR, narration: `${qty} cones ${SHADES[t.shade].name} thread, ${SHADES[t.shade].code}`, ref: SHADES[t.shade].code });
      });
      toast(`Thread received, purchase ${vid} raised`);
    },
    'tool-adj': (b) => store.update((s) => { const t = s.tools.find((x) => x.id === b.dataset.id); t.onHand = Math.max(0, t.onHand + Number(b.dataset.d)); }),
    // Dye
    'dye-new': () => { ui.dye.open = true; ui.receive = null; render(); },
    'dye-cancel': () => { ui.dye.open = false; ui.dye.rolls = []; render(); },
    'dye-receive': (b) => { ui.receive = b.dataset.id; ui.dye.open = false; render(); reveal('#receive-panel'); },
    'receive-cancel': () => { ui.receive = null; render(); },
    // Floor
    output: (b) => { ui.output = ui.output === b.dataset.id ? null : b.dataset.id; render(); },
    'output-cancel': () => { ui.output = null; render(); },
    // Dispatch
    'scan-code': (b) => doScan(b.dataset.code),
    'pending-cancel': () => { ui.pending = null; render(); },
    'dhl-refresh': () => {
      const steps = ['Customs cleared at destination', 'Out for delivery', 'Delivered, signed'];
      let n = 0;
      store.update((s) => {
        for (const p of s.parcels) {
          if (p.status !== 'in_transit') continue;
          const next = steps.find((t) => !p.events.some((e) => e.text === t));
          if (!next) continue;
          p.events.push({ at: nowIso(), type: 'carrier', text: next });
          if (next.startsWith('Delivered')) p.status = 'delivered';
          n++;
        }
      });
      toast(n ? `${n} tracking ${n === 1 ? 'update' : 'updates'} added (simulated)` : 'No parcels are in transit');
    },
    // Finance
    'fin-type': (b) => { ui.finType = b.dataset.type; render(); },
    'xml-copy': async () => {
      const text = vouchersToTallyXML(selected(store.get()));
      if (await copyText(text)) return toast('Tally XML copied');
      const pre = main.querySelector('#tally-xml');
      if (pre) { const r = document.createRange(); r.selectNodeContents(pre); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); }
      toast('Copy was blocked. The XML is selected, press Ctrl or Cmd + C');
    },
    'xml-sent': () => {
      const ids = new Set(selected(store.get()).map((v) => v.id));
      ui.sel = null;
      store.update((s) => { for (const v of s.ledger) if (ids.has(v.id)) v.synced = true; });
      toast(`${ids.size} ${ids.size === 1 ? 'voucher' : 'vouchers'} marked as sent to Tally`);
    },
  };

  const forms = {
    receive: (f) => {
      const metres = Math.round(Number(f.querySelector('#rc-metres').value));
      if (!(metres > 0)) return toast('Enter the metres on the roll');
      const fabric = f.querySelector('#rc-fabric').value;
      const supplier = f.querySelector('#rc-supplier').value;
      let id;
      store.update((s) => {
        id = `R-${nextNum(s.rolls, 'R-')}`;
        const grn = store.nextId('grn', 'GRN');
        s.rolls.push({ id, fabric, supplier, metres, status: 'unaudited', received: todayIso(), points: null, shade: null, lot: null, reservedFor: null, location: 'QC bay', grn });
        s.ledger.unshift({ id: grn.replace('GRN', 'PUR'), date: todayIso(), synced: false, type: 'Purchase', party: supplier, amount: metres * FABRICS[fabric].cost, dr: 'Fabric Purchases', cr: supplier, narration: `${grn.replace('-', ' ')}: 1 roll ${FABRICS[fabric].name.toLowerCase()}, ${metres} m`, ref: grn });
      });
      toast(`${id} received and tagged. It is first in the inspection queue`);
    },
    inspect: () => {
      const r = readInspect(main);
      const id = ui.inspect;
      let vid = null;
      ui.inspect = null;
      store.update((s) => {
        const roll = s.rolls.find((x) => x.id === id);
        if (!roll) return;
        if (roll.location === 'Dark room') roll.audited = true;
        roll.points = r.score;
        if (r.note) roll.defects = r.note;
        if (r.pass) { roll.status = 'passed'; roll.location = 'QC bay'; }
        else {
          roll.status = 'rejected'; roll.location = 'Returns bay';
          vid = post(s, 'dn', 'DN', { type: 'Debit Note', party: roll.supplier, amount: roll.metres * FABRICS[roll.fabric].cost, dr: roll.supplier, cr: 'Purchase Returns', narration: `Roll failed inspection before dyeing: ${r.note || 'defects over limit'}, ${r.score} points per 100 sq yd`, ref: roll.id });
        }
      });
      toast(r.pass ? `${id} passed at ${r.score}. Cleared for dyeing` : `${id} failed at ${r.score}. Debit note ${vid} raised on the mill`);
    },
    'dye-create': () => {
      const ids = [...ui.dye.rolls];
      if (!ids.length) return toast('Tick at least one roll to send');
      const { fabric, shade } = ui.dye;
      let id;
      store.update((s) => {
        id = `DL-${String(nextNum(s.dyeLots, 'DL-')).padStart(4, '0')}`;
        for (const r of s.rolls) if (ids.includes(r.id) && r.status === 'passed') Object.assign(r, { status: 'at_dyer', shade, lot: id, location: 'Dye house' });
        s.dyeLots.push({ id, fabric, shade, sent: todayIso(), due: iso(addWorkdays(today(), 6)), status: 'at_dyer', forOrders: [] });
      });
      ui.dye = { open: false, fabric: null, shade, rolls: [] };
      render();
      toast(`${id} sent to the dyer: ${ids.length} rolls. Check the thread for it below`);
    },
    'dye-receive': (f) => {
      const id = ui.receive;
      const failed = new Map([...f.querySelectorAll('input[data-roll]:checked')].map((c) => [c.dataset.roll, f.querySelector(`#rv-note-${CSS.escape(c.dataset.roll)}`)?.value.trim() || 'Failed shade check']));
      ui.receive = null;
      let msg = '';
      store.update((s) => {
        const lot = s.dyeLots.find((l) => l.id === id);
        const rolls = s.rolls.filter((r) => r.lot === id && r.status === 'at_dyer');
        let ok = 0, bad = 0, loss = 0, i = 0;
        for (const r of rolls) {
          if (failed.has(r.id)) {
            Object.assign(r, { status: 'dye_reject', location: 'Write-off bay', defects: failed.get(r.id) });
            bad += r.metres; loss += r.metres * (FABRICS[r.fabric].cost + FABRICS[r.fabric].dye);
          } else {
            Object.assign(r, { status: 'dyed', location: `Rack ${'ABCD'[i % 4]}${1 + (i % 6)}` });
            ok += r.metres; i++;
          }
        }
        lot.status = 'returned'; lot.returned = todayIso();
        if (failed.size) lot.note = `${failed.size} ${failed.size === 1 ? 'roll' : 'rolls'} failed after dyeing`;
        if (ok) post(s, 'jw', 'JW', { type: 'Purchase', party: DYER, amount: ok * FABRICS[lot.fabric].dye, dr: 'Dyeing Charges', cr: DYER, narration: `Dye lot ${id}: ${FABRICS[lot.fabric].name.toLowerCase()} ${SHADES[lot.shade].name.toLowerCase()}, ${ok} m accepted`, ref: id });
        if (bad) post(s, 'jv', 'JV', { type: 'Journal', party: 'Fabric loss', amount: loss, dr: 'Fabric Loss: Post-Dye Defects', cr: 'Stock: Dyed Fabric', narration: `${failed.size} ${failed.size === 1 ? 'roll' : 'rolls'}, ${bad} m, failed after dyeing: ${[...new Set(failed.values())].join('; ')}. Not returnable to the mill`, ref: id });
        msg = bad ? `${id} received. ${ok} m accepted, ${bad} m written off (${inr(loss)})` : `${id} received. ${ok} m accepted into the fabric store`;
      });
      toast(msg);
    },
    output: (f) => {
      const id = f.dataset.id;
      const stage = f.querySelector('#op-stage').value;
      const pieces = Math.round(Number(f.querySelector('#op-pieces').value));
      const o = store.get().orders.find((x) => x.id === id);
      const i = STAGES.findIndex(([k]) => k === stage);
      const room = (i === 0 ? o.qty : o.done[STAGES[i - 1][0]]) - o.done[stage];
      if (!(pieces > 0)) return toast('Enter how many pieces were finished');
      if (pieces > room) return toast(`${STAGES[i][1]} can take ${room} more ${room === 1 ? 'piece' : 'pieces'} on ${id}${i ? `. ${STAGES[i - 1][1]} has only passed on ${o.done[STAGES[i - 1][0]]}` : ''}`);
      ui.output = null;
      store.update((s) => { s.orders.find((x) => x.id === id).done[stage] += pieces; });
      toast(`${id}: ${pieces} pieces recorded at ${STAGES[i][1].toLowerCase()}`);
    },
    punch: (f) => {
      const pieces = Math.round(Number(f.querySelector('#pn-pieces').value));
      const minutes = Math.round(Number(f.querySelector('#pn-minutes').value));
      if (!(pieces > 0) || !(minutes > 0)) return toast('Enter pieces and minutes for the bundle');
      const style = f.querySelector('#pn-style').value;
      const station = f.querySelector('#pn-station').value;
      store.update((s) => { s.punches.push({ id: `P-${s.counters.punch++}`, style, station, pieces, minutes, date: todayIso() }); });
      toast(`Scan saved: ${num(minutes / pieces, 1)} min a piece at ${station}`);
    },
    scan: (f) => doScan(f.querySelector('#sc-code').value),
    pending: (f) => {
      const { id, dir } = ui.pending;
      ui.pending = null;
      store.update((s) => {
        const p = s.parcels.find((x) => x.id === id);
        if (dir === 'in') {
          const note = f.querySelector('#pd-note').value.trim();
          p.visits = (p.visits || 0) + 1;
          p.events.push({ at: nowIso(), type: 'in', text: `Scanned in: fit visit ${p.visits}, ${note}`, note });
          p.status = 'at_factory';
          ui.scanMsg = { state: p.visits >= 3 ? 'warn' : 'ok', text: `${p.ref} scanned in on fit visit ${p.visits}.${p.visits >= 3 ? ' This is its third trip or more. The style is flagged for a pattern check.' : ''}` };
        } else {
          const lastIn = [...p.events].reverse().find((e) => e.type === 'in');
          const stay = lastIn ? span(Date.now() - new Date(lastIn.at)) : null;
          const raw = f.querySelector('#pd-work').value;
          const workMin = raw === '' ? null : Math.max(0, Math.round(Number(raw)));
          p.events.push({ at: nowIso(), type: 'out', text: `Scanned out to store.${stay ? ` In factory ${stay}` : ''}${workMin != null ? `, work ${workMin} min` : ''}`, workMin });
          p.status = 'at_store';
          ui.scanMsg = { state: 'ok', text: `${p.ref} scanned out to the Bombay store${stay ? ` after ${stay} in the factory` : ''}.` };
        }
      });
    },
  };

  const changes = {
    'dye-fabric': (t) => { ui.dye.fabric = t.value; ui.dye.rolls = []; render(); main.querySelector('#dy-fabric')?.focus(); },
    'dye-shade': (t) => { ui.dye.shade = t.value; main.querySelector('#dye-summary').innerHTML = dyeSummary(store.get()); },
    'dye-roll': (t) => {
      ui.dye.rolls = t.checked ? [...new Set([...ui.dye.rolls, t.value])] : ui.dye.rolls.filter((x) => x !== t.value);
      main.querySelector('#dye-summary').innerHTML = dyeSummary(store.get());
    },
    'fin-sel': (t) => {
      if (!ui.sel) ui.sel = new Set(selected(store.get()).map((v) => v.id));
      if (t.checked) ui.sel.add(t.value); else ui.sel.delete(t.value);
      render();
      main.querySelector(`#${CSS.escape(t.id)}`)?.focus();
    },
  };

  const onClick = (e) => {
    const b = e.target.closest('[data-act]');
    if (b && root.contains(b) && actions[b.dataset.act]) actions[b.dataset.act](b);
  };
  const onSubmit = (e) => {
    const f = e.target.closest('form[data-form]');
    if (!f) return;
    e.preventDefault();
    forms[f.dataset.form]?.(f);
  };
  const onChange = (e) => { const k = e.target.dataset?.change; if (k && changes[k]) changes[k](e.target); };
  const onInput = (e) => { if (e.target.closest('#inspect-panel')) paintVerdict(main); };
  const onToggle = (e) => {
    const d = e.target;
    if (d.matches?.('details.parcel')) { if (d.open) ui.openParcels.add(d.dataset.id); else ui.openParcels.delete(d.dataset.id); }
  };
  root.addEventListener('click', onClick);
  root.addEventListener('submit', onSubmit);
  root.addEventListener('change', onChange);
  root.addEventListener('input', onInput);
  root.addEventListener('toggle', onToggle, true);

  const off = store.on(() => render());
  render();
  return () => { off(); };
}
