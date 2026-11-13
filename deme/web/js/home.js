// Today: what is open, what needs attention and what sold, counted from live records.
// Each part is shown only when the signed-in person can read the records behind it.

import { data } from './api.js';
import { info, esc, inr, num, $ } from './ui.js';
import { iso, today, fmtDate, fmtDay, addWorkdays, DAY } from '../shared/util.js';
import { papersMissing } from '../shared/floor.js';

const ARROW = '<svg class="wk-arrow" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M3 8h9.5M8.5 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const TICK = '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const SEV = { crit: 0, warn: 1, info: 2 };
const DAYS = 14;
const CLAIM_DAYS = 14;   // an open claim older than this is chased

const plural = (n, one, many = `${one}s`) => `${num(n)} ${n === 1 ? one : many}`;
const day = (isoDate) => fmtDate(`${isoDate}T00:00:00`);
const total = (arr, f) => arr.reduce((s, x) => s + (Number(f(x)) || 0), 0);
/** The list for a record type opens only for people who can read its module. */
const canOpen = (entity) => data.can(data.entity(entity).module, 'read');
const canGate = () => data.can('logistics', 'write') || data.can('b2c', 'write') || data.can('production', 'write');

// What an order is worth in rupees. One in another currency counts at its stated rupee value, and not at all until a rate is on record.
const rupeesOf = (o) => (o.currency && o.currency !== 'INR' ? Number(o.amountInr) || 0 : Number(o.amount) || 0);

export function mount(el, ctx) {
  let goes = [];        // what each "needs attention" row opens, by row index
  let chart = null;     // the days drawn in the sales chart, for its tooltip
  let tableOpen = false;

  el.innerHTML = `
    <div class="workspace work"><div class="workspace-inner">
      <div class="view-head">
        <div class="title-row"><h1 class="reveal">Today</h1>${info('Everything here is counted from live records each time something changes. You see only the parts your role can read. A row under Needs attention opens the place where that work is done.', 'Today')}</div>
        <p class="wk-date">${esc(fmtDay(today()))}</p>
      </div>
      <div class="hm-body" id="hmBody"></div>
    </div></div>`;
  const body = $('#hmBody', el);

  // ───────── KPI strip ─────────
  function kpis(T) {
    const tiles = [];
    const tile = (label, value, note, state = '') => tiles.push(`<div class="kpi" ${state ? `data-state="${state}"` : ''}><p class="kpi-label">${esc(label)}</p><p class="kpi-value">${esc(value)}</p><p class="kpi-note">${esc(note)}</p></div>`);
    if (data.canRead('work_orders')) {
      const open = data.all('work_orders').filter((w) => w.status !== 'done');
      tile('Open work orders', num(open.length), `${plural(total(open, (w) => Math.max(0, (w.qty || 0) - (w.pack || 0))), 'piece')} still to pack`);
      const late = open.filter((w) => w.due && w.due < T).sort((a, b) => a.due.localeCompare(b.due));
      tile('Work orders overdue', num(late.length), late.length ? `Oldest was due ${day(late[0].due)}` : 'None late', late.length ? 'crit' : '');
    }
    if (data.canRead('shop_orders')) {
      const mine = data.all('shop_orders').filter((o) => o.date === T && o.status !== 'cancelled');
      tile('Shopify orders today', num(mine.length), inr(total(mine, (o) => rupeesOf(o))));
    }
    if (data.canRead('bills')) {
      const unpaid = data.all('bills').filter((b) => b.status !== 'paid');
      tile('Owed to suppliers', inr(total(unpaid, (b) => Math.max(0, (b.amount || 0) - (b.paid || 0)))), unpaid.length ? plural(unpaid.length, 'unpaid bill') : 'No unpaid bills');
    }
    return tiles.length ? `<div class="kpis">${tiles.join('')}</div>` : '';
  }

  // ───────── Needs attention ─────────
  /** Tomorrow's cutting is planned the evening before: say so while the next working day has no issued plan. */
  function dayPlan(rows) {
    if (!data.can('production', 'write') || !data.canRead('day_plans')) return;
    const next = iso(addWorkdays(today(), 1)), plans = data.all('day_plans').filter((p) => p.date === next);
    if (plans.some((p) => p.status === 'issued')) return;
    // Nothing to plan when no in-house work is waiting to be cut.
    if (data.canRead('work_orders') && !data.all('work_orders').some((w) => w.madeBy !== 'vendor' && !['done', 'hold', 'at_vendor'].includes(w.status) && (w.cut || 0) < (w.qty || 0))) return;
    rows.push({ sev: 'warn', n: 1, title: `Day plan to issue for ${fmtDay(`${next}T00:00:00`)}`, tag: 'Plan', sub: plans.length ? 'Draft, not issued yet' : 'Not started', go: () => ctx.go('dayplan') });
  }
  function attention(T) {
    const rows = [];
    const add = (sev, entity, match, one, many, tag, o = {}) => {
      if (!data.canRead(entity)) return;
      const docs = data.all(entity).filter(match);
      if (!docs.length) return;
      const name = o.name || ((d) => data.title(entity, d.id));
      const shown = docs.map(name).filter(Boolean).sort((x, y) => String(x).localeCompare(String(y), undefined, { numeric: true })).slice(0, 3);
      rows.push({ sev, n: docs.length, title: docs.length === 1 ? one : many, tag, sub: shown.join(', ') + (shown.length && docs.length > 3 ? ` and ${num(docs.length - 3)} more` : ''), go: o.go !== undefined ? o.go : (canOpen(entity) ? () => ctx.openEntity(entity) : null) });
    };
    add('crit', 'machines', (m) => m.status === 'down', 'Machine down', 'Machines down', 'Down');
    add('crit', 'work_orders', (w) => w.status !== 'done' && w.due && w.due < T, 'Work order overdue', 'Work orders overdue', 'Overdue');
    add('crit', 'bills', (b) => b.status !== 'paid' && b.due && b.due < T, 'Supplier bill past due', 'Supplier bills past due', 'Pay');
    add('crit', 'dye_lots', (l) => l.status === 'at_dyer' && l.dueBack && l.dueBack < T, 'Dye lot late from the dyer', 'Dye lots late from the dyer', 'Late');
    add('crit', 'work_orders', (w) => w.status === 'at_vendor' && w.backBy && w.backBy < T, 'Vendor work past its due-back date', 'Vendor work past its due-back date', 'Late', { name: (w) => [w.no, data.canRead('suppliers') ? data.title('suppliers', w.vendor) : ''].filter(Boolean).join(' ') });
    add('crit', 'courier_invoices', (c) => c.status === 'disputed', 'Courier invoice with mismatches', 'Courier invoices with mismatches', 'Mismatch');
    add('warn', 'items', (i) => i.minLevel > 0 && (i.onHand || 0) < i.minLevel, 'Material below its minimum', 'Materials below their minimum', 'Low');
    add('warn', 'rolls', (r) => r.status === 'received', 'Roll awaiting inspection', 'Rolls awaiting inspection', 'Inspect');
    const dyeScreen = data.can('quality', 'scan') ? () => ctx.go('dye') : undefined;
    add('warn', 'fabric_reports', (r) => r.status === 'new', 'New problem report on fabric', 'New problem reports on fabric', 'Look', { go: dyeScreen });
    const stale = iso(Date.now() - CLAIM_DAYS * DAY);
    add('warn', 'claims', (c) => c.status === 'open' && (c.date || String(c.createdAt || '').slice(0, 10) || T) < stale, `Claim open over ${CLAIM_DAYS} days`, `Claims open over ${CLAIM_DAYS} days`, 'Chase', { name: (c) => [c.no, data.canRead('suppliers') ? data.title('suppliers', c.supplier) : ''].filter(Boolean).join(' ') });
    dayPlan(rows);
    add('warn', 'purchase_orders', (p) => p.status === 'draft', 'Purchase order waiting for approval', 'Purchase orders waiting for approval', 'Approve');
    add('warn', 'sample_requests', (s) => s.status === 'requested', 'Sample request waiting', 'Sample requests waiting', 'Decide');
    add('warn', 'shop_orders', (o) => o.status === 'new' || o.status === 'in_production', 'Shopify order not yet packed', 'Shopify orders not yet packed', 'Pack');
    // A packed parcel waits for the office first, then for the gate.
    add('warn', 'parcels', (p) => p.status === 'packed' && papersMissing(p), 'Parcel waiting for paperwork', 'Parcels waiting for paperwork', 'Paperwork', { name: (p) => p.barcode });
    add('warn', 'parcels', (p) => p.status === 'packed' && !papersMissing(p), 'Parcel packed, not scanned out', 'Parcels packed, not scanned out', 'Scan', { name: (p) => p.barcode, go: canGate() ? () => ctx.go('gate') : canOpen('parcels') ? () => ctx.openEntity('parcels') : null });
    add('warn', 'leaves', (l) => l.status === 'applied', 'Leave request waiting', 'Leave requests waiting', 'Approve', { name: (l) => data.title('employees', l.employee) });
    if (data.canRead('store_orders')) add('info', 'store_orders', (s) => s.status === 'at_factory', 'Store piece at the factory', 'Store pieces at the factory', 'At factory');
    else add('info', 'parcels', (p) => p.kind === 'store' && p.status === 'at_factory', 'Store piece at the factory', 'Store pieces at the factory', 'At factory', { name: (p) => p.barcode, go: canGate() ? () => ctx.go('gate') : canOpen('parcels') ? () => ctx.openEntity('parcels') : null });
    add('info', 'vouchers', (v) => v.status === 'open', 'Voucher not in Tally', 'Vouchers not in Tally', 'Export');
    rows.sort((a, b) => SEV[a.sev] - SEV[b.sev]); // stable: the order above holds within each level
    goes = rows.map((r) => r.go);
    const row = (r, i) => {
      const inner = `<span class="hm-att-n">${esc(num(r.n))}</span><span class="hm-att-body"><span class="hm-att-title">${esc(r.title)}</span>${r.sub ? `<span class="hm-att-sub">${esc(r.sub)}</span>` : ''}</span><span class="tag tag-${r.sev}">${esc(r.tag)}</span>`;
      return `<li>${r.go ? `<button type="button" class="hm-att" data-att="${i}">${inner}${ARROW}</button>` : `<div class="hm-att">${inner}</div>`}</li>`;
    };
    return `
      <section class="panel hm-panel" aria-labelledby="hmAttH">
        <div class="panel-head"><div class="title-row"><h2 id="hmAttH">Needs attention</h2>${info('Worked out from the records you can read, most serious first: things that are late or stopped, then things waiting on someone, then things to keep an eye on. A row disappears when the work behind it is done.', 'Needs attention')}</div>${rows.length ? `<span class="wk-n">${esc(num(rows.length))}</span>` : ''}</div>
        ${rows.length ? `<ul class="hm-att-list">${rows.map(row).join('')}</ul>` : '<p class="wk-none"><span class="wk-dot" aria-hidden="true"></span>Nothing needs attention right now.</p>'}
      </section>`;
  }

  // ───────── Sales of the day ─────────
  function sales(T) {
    const canShop = data.canRead('shop_orders'), canStore = data.canRead('store_orders');
    if (!canShop && !canStore) return '';
    const shop = canShop ? data.all('shop_orders').filter((o) => o.status !== 'cancelled') : [];
    const store = canStore ? data.all('store_orders') : [];
    const lines = [...shop.map((o) => ({ date: o.date, amount: rupeesOf(o), style: o.style, qty: Number(o.qty) || 1 })), ...store.map((o) => ({ date: o.date, amount: rupeesOf(o), style: o.style, qty: 1 }))];

    const dates = [];
    for (let i = DAYS - 1; i >= 0; i--) { const d = today(); d.setDate(d.getDate() - i); dates.push(iso(d)); }
    const days = dates.map((date) => { const mine = lines.filter((l) => l.date === date); return { date, orders: mine.length, amount: total(mine, (l) => l.amount) }; });
    const peak = Math.max(...days.map((d) => d.amount));
    const p10 = 10 ** Math.floor(Math.log10(peak || 1)), lead = peak / p10;
    const max = peak > 0 ? (lead <= 1 ? 1 : lead <= 2 ? 2 : lead <= 5 ? 5 : 10) * p10 : 0;
    chart = max ? { days } : null;

    const stat = (label, list) => { const mine = list.filter((o) => o.date === T); return `<div><p class="eyebrow">${esc(label)}</p><p class="hm-big">${esc(inr(total(mine, (o) => rupeesOf(o))))}</p><p class="hm-note">${esc(plural(mine.length, 'order'))}</p></div>`; };

    const styles = new Map();
    for (const l of lines.filter((x) => x.date === T)) { const s = styles.get(l.style) || { pieces: 0, amount: 0 }; s.pieces += l.qty; s.amount += l.amount; styles.set(l.style, s); }
    const top = [...styles.entries()].sort((a, b) => b[1].amount - a[1].amount || b[1].pieces - a[1].pieces).slice(0, 5);

    const openShop = canShop && canOpen('shop_orders');
    const plot = max ? `
          <div class="hm-plot">
            <div class="hm-area">
              <div class="hm-rule" style="bottom:100%"><span>${esc(inr(max))}</span></div>
              <div class="hm-rule" style="bottom:50%"><span>${esc(inr(max / 2))}</span></div>
              <div class="hm-rule is-base"></div>
              <div class="hm-bars" tabindex="0" role="group" aria-label="Sales per day for the last ${DAYS} days. Use the left and right arrow keys to read each day.">${days.map((d) => `<div class="hm-col${d.date === T ? ' is-today' : ''}">${d.amount > 0 ? `<i style="height:${Math.max(1.5, (d.amount / max) * 100).toFixed(2)}%"></i>` : ''}</div>`).join('')}</div>
              <div class="hm-tip" role="status" aria-live="polite" hidden></div>
            </div>
          </div>
          <div class="hm-axis" aria-hidden="true"><span>${esc(day(dates[0]))}</span><span>Today, ${esc(day(T))}</span></div>
          <details class="hm-details" ${tableOpen ? 'open' : ''}><summary>Table</summary>
            <div class="table-wrap"><table class="table"><thead><tr><th>Date</th><th class="num">Orders</th><th class="num">Amount</th></tr></thead>
            <tbody>${[...days].reverse().map((d) => `<tr><td>${esc(fmtDay(`${d.date}T00:00:00`))}</td><td class="num">${esc(num(d.orders))}</td><td class="num">${esc(inr(d.amount))}</td></tr>`).join('')}</tbody></table></div>
          </details>` : `
          <div class="hm-plot is-empty">
            <div class="hm-area"><div class="hm-rule" style="bottom:100%"></div><div class="hm-rule is-base"></div></div>
            <div class="hm-nosales"><p>${lines.length ? `No sales in the last ${DAYS} days` : 'No sales recorded yet'}</p>${openShop ? `<button type="button" class="btn btn-outline" id="hmImport">${data.canWrite('shop_orders') ? 'Import Shopify orders' : 'Open Shopify orders'}</button>` : ''}</div>
          </div>`;

    return `
      <section class="panel" aria-labelledby="hmSalesH">
        <div class="panel-head"><div class="title-row"><h2 id="hmSalesH">Sales of the day</h2>${info('Shopify orders and store orders by their order date, at the amount on the order. Cancelled Shopify orders are left out. The chart adds both channels together for each of the last 14 days.', 'Sales of the day')}</div></div>
        <div class="panel-pad hm-sales">
          <div class="hm-stats">${canShop ? stat('Shopify today', shop) : ''}${canStore ? stat('Store today', store) : ''}</div>
          <div class="hm-block">
            <div class="hm-block-head"><p class="eyebrow">Sales per day, last ${DAYS} days</p>${max ? `<p class="wk-n">${esc(inr(total(days, (d) => d.amount)))}</p>` : ''}</div>
            ${plot}
          </div>
          ${data.canRead('styles') ? `<div class="hm-block">
            <div class="hm-block-head"><p class="eyebrow">Top styles today</p></div>
            ${top.length ? `<ol class="hm-top">${top.map(([id, s]) => `<li><span class="hm-top-name">${esc(data.title('styles', id) || 'Style')}</span><span class="hm-top-n">${esc(plural(s.pieces, 'piece'))}</span><span class="hm-top-n">${esc(inr(s.amount))}</span></li>`).join('')}</ol>` : '<p class="faint">No sales today yet.</p>'}
          </div>` : ''}
        </div>
      </section>`;
  }

  function wireChart() {
    const bars = $('.hm-bars', el);
    if (!bars || !chart) return;
    const tip = $('.hm-tip', el), cols = [...bars.children];
    let at = cols.length - 1;
    const hide = () => { tip.hidden = true; cols.forEach((c) => c.classList.remove('is-on')); };
    const showTip = (i) => {
      at = Math.max(0, Math.min(cols.length - 1, i));
      const d = chart.days[at], c = cols[at];
      cols.forEach((x, j) => x.classList.toggle('is-on', j === at));
      tip.innerHTML = `<strong>${esc(fmtDay(`${d.date}T00:00:00`))}</strong>${esc(inr(d.amount))} · ${esc(plural(d.orders, 'order'))}`;
      tip.hidden = false;
      const x = bars.offsetLeft + c.offsetLeft + c.offsetWidth / 2;
      const barHeight = c.firstElementChild ? c.firstElementChild.offsetHeight : 0;
      tip.style.left = `${Math.max(0, Math.min(x - tip.offsetWidth / 2, tip.parentElement.clientWidth - tip.offsetWidth))}px`;
      tip.style.top = `${Math.max(-18, bars.offsetTop + bars.offsetHeight - barHeight - tip.offsetHeight - 8)}px`;
    };
    cols.forEach((c, i) => { c.addEventListener('pointerenter', () => showTip(i)); c.addEventListener('click', () => showTip(i)); });
    bars.addEventListener('pointerleave', () => { if (document.activeElement !== bars) hide(); });
    bars.addEventListener('focus', () => showTip(at));
    bars.addEventListener('blur', hide);
    bars.addEventListener('keydown', (e) => {
      const to = { ArrowLeft: at - 1, ArrowRight: at + 1, Home: 0, End: cols.length - 1 }[e.key];
      if (to === undefined) return;
      e.preventDefault(); showTip(to);
    });
  }

  // ───────── Getting started ─────────
  const settingUp = () => data.can('masters', 'write') && ['work_orders', 'shop_orders', 'store_orders'].every((e) => !data.all(e).length);
  function start() {
    const steps = [];
    const list = (entity, label) => { if (!data.canWrite(entity)) return; const n = data.all(entity).length; steps.push({ key: entity, label, done: n > 0, note: n ? `${num(n)} added` : 'None yet' }); };
    list('workstations', 'Add work centres');
    list('items', 'Add materials');
    list('styles', 'Add styles');
    list('suppliers', 'Add suppliers');
    list('customers', 'Add customers');
    if (data.can('admin', 'read')) { const n = data.users.length; steps.push({ key: 'team', label: 'Add the team', done: n > 1, note: n > 1 ? `${num(n)} people` : 'Only you so far' }); }
    list('work_orders', 'Raise the first work order');
    const done = steps.filter((s) => s.done).length;
    return `
      <section class="panel hm-panel hm-start" aria-labelledby="hmStartH">
        <div class="panel-head"><div class="title-row"><h2 id="hmStartH">Getting started</h2>${info('A new business starts empty. Work centres, materials and styles are what the production plan is built from, so add those first; suppliers and customers are needed for purchase orders and sales orders. Each step is ticked from what is really in the lists, and this page turns into the daily view once the first work order or sale is in.', 'Getting started')}</div><span class="wk-n">${esc(`${done} of ${steps.length} done`)}</span></div>
        <div class="bar" role="presentation"><i style="--v:${steps.length ? Math.round((done / steps.length) * 100) : 0}%"></i></div>
        <ol class="hm-steps">${steps.map((s) => `<li><button type="button" class="hm-step${s.done ? ' is-done' : ''}" data-step="${esc(s.key)}"><span class="hm-tick">${TICK}</span><span class="hm-step-title">${esc(s.label)}</span><span class="hm-step-note">${esc(s.note)}</span>${ARROW}</button></li>`).join('')}</ol>
      </section>`;
  }

  function render() {
    const T = iso(today());
    if (settingUp()) { goes = []; chart = null; body.innerHTML = start(); return; }
    const right = sales(T);
    body.innerHTML = `${kpis(T)}<div class="hm-cols${right ? '' : ' is-one'}">${attention(T)}${right}</div>`;
    wireChart();
    $('.hm-details', el)?.addEventListener('toggle', (e) => { tableOpen = e.currentTarget.open; });
  }

  el.firstElementChild.addEventListener('click', (e) => {   // on this screen's own root: the mount element outlives the screen
    const att = e.target.closest('[data-att]'), step = e.target.closest('[data-step]');
    if (att) goes[Number(att.dataset.att)]?.();
    else if (step) { if (step.dataset.step === 'team') ctx.go('m-admin'); else ctx.openEntity(step.dataset.step, { add: true }); }
    else if (e.target.closest('#hmImport')) ctx.openEntity('shop_orders');
  });

  render();
  return data.on(render);
}
