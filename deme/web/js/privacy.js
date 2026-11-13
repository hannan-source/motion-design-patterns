// Privacy: for when a customer asks what is held about them, or asks for it to be removed.
// The top shows what personal details the system holds and where. Below, an admin finds a customer
// by name or order number, can download what is held to hand over, and can remove the personal
// details from chosen orders. The orders themselves stay, without the person, for the accounts.

import { api, data } from './api.js';
import { $, esc, info, toast, oops, busy, inr, num, fmtDate, statusTag } from './ui.js';
import { iso, today } from '../shared/util.js';

const GONE = 'Removed on request';
const REMOVAL = `Removal puts "${GONE}" in place of the customer's name on the chosen orders and their slips, and in place of the measurements on those slips. A parcel's address is cut down to its last part. The orders stay, with their numbers, dates, items and amounts, because the accounts need them. Who asked and when is kept in the audit trail. It cannot be undone. Anything held in Shopify itself, such as email, phone and address, has to be removed in Shopify.`;
const ICONS = {
  customer: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c.6-3.6 3.4-5.5 7-5.5s6.4 1.9 7 5.5"/>',
  team: '<circle cx="9" cy="9" r="3"/><path d="M3.5 19c.5-3 2.7-4.5 5.5-4.5s5 1.5 5.5 4.5"/><circle cx="17" cy="8" r="2.3"/><path d="M16.5 13.5c2.3 0 3.7 1.3 4.2 3.5"/>',
  employee: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="9" cy="11" r="2"/><path d="M6 16c.4-1.5 1.5-2.2 3-2.2s2.6.7 3 2.2M14.5 10h3.5M14.5 13.5h3.5"/>',
};
const icon = (k) => `<svg class="pv-ico" viewBox="0 0 24 24" width="26" height="26" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${ICONS[k]}</svg>`;
const plural = (n, one, many = `${one}s`) => `${num(n)} ${n === 1 ? one : many}`;
const low = (s) => String(s || '').trim().toLowerCase();
const day = (s) => (s ? fmtDate(`${s}T00:00:00`) : '');
const money = (o) => (o.amount == null ? '' : !o.currency || o.currency === 'INR' ? inr(Number(o.amount) || 0) : `${o.currency} ${num(Number(o.amount) || 0, 2)}`);
/** A personal detail, marked so it is plain what removal would take away. */
const personal = (text) => (text && text !== GONE ? `<mark class="pv-p">${esc(text)}</mark>` : text ? `<span class="pv-gone">${esc(text)}</span>` : '');

export function mount(el, ctx) {
  el.innerHTML = '<div class="workspace privacy is-first"><div class="workspace-inner" id="pvRoot"></div></div>';
  const root = $('.privacy', el), body = $('#pvRoot', el);
  if (!data.can('admin', 'admin')) {
    body.innerHTML = '<div class="view-head"><div class="title-row"><h1 class="reveal">Privacy</h1></div></div><section class="panel empty"><h3>Only an admin can open this</h3><p>Ask the system admin to find or remove a customer\'s details.</p></section>';
    return undefined;
  }
  let found = null;            // { q, res, groups } from the last search
  const picked = new Set();    // order numbers chosen for removal
  let asking = false, reason = '', done = null;

  body.innerHTML = `
    <div class="view-head"><div class="title-row"><h1 class="reveal">Privacy</h1>${info('For when a customer asks what is held about them, or asks for it to be removed. Find them by name or order number, download what is held to hand over, or remove their personal details. Every search and every removal is written to the audit trail.', 'Privacy')}</div></div>
    <section aria-labelledby="pvHeldH" class="pv-held-sec">
      <div class="title-row"><h2 id="pvHeldH" class="sect">What is held, and where</h2>${info('The personal details this system keeps. A customer is known by name and country on their online orders, with any measurements on the slips made for them; their email, phone and address stay in Shopify. A team member is a name and a work email. An employee has an HR record, and the salary on it is shown to HR only.', 'What is held')}</div>
      <div class="pv-cards" id="pvHeld"></div>
    </section>
    <section class="panel" aria-labelledby="pvFindH">
      <div class="panel-head"><div class="title-row"><h2 id="pvFindH">Find a customer</h2>${info('Type the customer\'s name, or part of it, or the whole order number. At least three characters. Each search is written to the audit trail.', 'Find a customer')}</div><span class="pv-about">What removal does ${info(REMOVAL, 'What removal does')}</span></div>
      <form class="pv-find" id="pvForm" role="search" novalidate>
        <div class="field"><label for="pvQ">Customer name or order number</label><input class="input" id="pvQ" name="q" type="search" autocomplete="off" spellcheck="false" enterkeyhint="search"></div>
        <button class="btn btn-primary" type="submit">Find</button>
      </form>
      <div id="pvOut" class="pv-out" tabindex="-1"></div>
    </section>`;
  const held = $('#pvHeld', body), out = $('#pvOut', body);

  // ── What is held, and where ──
  function heldHtml() {
    const canOrders = data.canRead('shop_orders'), canSlips = data.canRead('slips'), canHr = data.canRead('employees');
    const orders = data.all('shop_orders'), named = orders.filter((o) => o.customerName && o.customerName !== GONE);
    const people = new Set(named.map((o) => low(o.customerName))).size, removed = orders.filter((o) => o.customerName === GONE).length;
    const measured = data.all('slips').filter((s) => s.measurements && s.measurements !== GONE).length;
    const team = data.users.filter((u) => u.active !== false).length, staff = data.all('employees').length;
    const closed = '<span class="tag tag-plain">Not open to you</span>';
    const row = (what, where, n, open) => `<div><dt>${esc(what)}</dt><dd>${open ? `<button type="button" class="link" data-open="${open}">${esc(where)}</button>` : esc(where)}</dd><dd class="pv-c">${n}</dd></div>`;
    const card = (k, name, n, unit, rows) => `<article class="panel pv-card">
      <header>${icon(k)}<div><p class="eyebrow">${esc(name)}</p><p class="pv-n">${n === null ? '<span class="pv-n-na">Not open to you</span>' : num(n)}</p><p class="faint">${esc(unit)}</p></div></header>
      <dl>${rows.join('')}</dl></article>`;
    return [
      card('customer', 'Customers', canOrders ? people : null, canOrders ? (people ? `named on ${plural(named.length, 'online order')}` : 'No online orders with a name yet') : 'Online orders', [
        row('Name and country', 'Online orders', canOrders ? `<b>${num(named.length)}</b>` : closed, canOrders ? 'shop_orders' : ''),
        row('Measurements', 'Order slips', canSlips ? `<b>${num(measured)}</b>` : closed, canSlips ? 'slips' : ''),
        row('Email, phone, address', 'Shopify only', '<span class="tag tag-plain">Not kept here</span>'),
        ...(removed ? [row('Removed on request', 'Online orders', `<b>${num(removed)}</b>`)] : []),
      ]),
      card('team', 'Team members', team, team === 1 ? 'person who can sign in' : 'people who can sign in', [
        row('Name and work email', 'Sign-in accounts', `<b>${num(team)}</b>`),
        row('Position and work centre', 'Sign-in accounts', `<b>${num(data.users.filter((u) => u.active !== false && u.position).length)}</b>`),
      ]),
      card('employee', 'Employees', canHr ? staff : null, canHr ? (staff ? 'HR records' : 'No HR records yet') : 'HR records', [
        row('HR record', 'Employees', canHr ? `<b>${num(staff)}</b>` : closed, canHr ? 'employees' : ''),
        row('Salary', 'Employees', '<span class="tag tag-info">HR only</span>'),
      ]),
    ].join('');
  }

  // ── What a search found, one block per order ──
  function groupsOf(res) {
    const by = new Map();
    const g = (no) => { const k = low(no); if (!by.has(k)) by.set(k, { no: String(no || ''), order: null, slips: [], returns: [], parcels: [] }); return by.get(k); };
    for (const o of res.orders || []) g(o.orderNo).order = o;
    for (const s of res.slips || []) g(s.orderNo).slips.push(s);
    for (const p of res.parcels || []) g(p.ref).parcels.push(p);
    for (const r of res.returns || []) g((res.orders || []).find((o) => o.id === r.order)?.orderNo).returns.push(r);
    const list = [...by.values()];
    for (const x of list) x.gone = (!x.order || x.order.customerName === GONE) && x.slips.every((s) => (!s.customerName || s.customerName === GONE) && (!s.measurements || s.measurements === GONE));
    return list.sort((a, b) => String(b.order?.date || '').localeCompare(String(a.order?.date || '')));
  }
  function groupHtml(x, i) {
    const o = x.order, id = `pvPick${i}`;
    const slip = (s) => `<li><span class="mono">${esc(s.no || '')}</span><span>${esc([data.title('styles', s.style) || s.styleName, s.size].filter(Boolean).join(', '))}${s.customerName && low(s.customerName) !== low(o?.customerName) ? ` · ${personal(s.customerName)}` : ''}</span><span class="pv-wide">${s.measurements ? personal(s.measurements) : '<span class="faint">No measurements</span>'}</span>${statusTag('slips', s.status)}</li>`;
    const parcel = (p) => `<li><span class="mono">${esc(p.no || '')}</span><span class="mono">${esc(p.barcode || '')}</span><span class="pv-wide">${p.dest ? (p.dest.includes(',') ? personal(p.dest) : esc(p.dest)) : '<span class="faint">No address</span>'}</span>${statusTag('parcels', p.status)}</li>`;
    const ret = (r) => `<li><span class="mono">${esc(r.no || '')}</span><span>${esc(day(r.date))}</span><span class="pv-wide">${esc([r.reason, r.condition].filter(Boolean).join(', '))}${r.refund ? ` · refund ${esc(inr(Number(r.refund) || 0))}` : ''}</span>${statusTag('returns', r.status)}</li>`;
    const part = (name, items, f) => (items.length ? `<div class="pv-part"><p class="eyebrow">${esc(plural(items.length, name))}</p><ul>${items.map(f).join('')}</ul></div>` : '');
    return `<li class="pv-group${x.gone ? ' is-gone' : ''}">
      <div class="pv-top">
        <input type="checkbox" id="${id}" value="${esc(x.no)}"${picked.has(x.no) ? ' checked' : ''}${x.gone || !x.no ? ' disabled' : ''} aria-describedby="${id}d">
        <label for="${id}"><span class="pv-no">${esc(x.no || 'No order number')}</span><span class="pv-name">${o ? personal(o.customerName) || '<span class="faint">No name</span>' : '<span class="faint">Slips only, no online order</span>'}</span></label>
        <p class="pv-facts" id="${id}d">${o ? [day(o.date), o.country ? `Ships to ${o.country}` : '', money(o), o.items].filter(Boolean).map(esc).join(' · ') : ''}</p>
        <span class="pv-state">${x.gone ? '<span class="tag tag-ok">Already removed</span>' : o ? statusTag('shop_orders', o.status) : ''}</span>
      </div>
      ${part('slip', x.slips, slip)}${part('parcel', x.parcels, parcel)}${part('return', x.returns, ret)}
    </li>`;
  }
  /** What removal would touch, for the orders chosen. */
  function chosen() {
    const gs = found ? found.groups.filter((x) => picked.has(x.no)) : [];
    return { gs, orders: gs.filter((x) => x.order), slips: gs.flatMap((x) => x.slips), measured: gs.flatMap((x) => x.slips).filter((s) => s.measurements && s.measurements !== GONE), parcels: gs.flatMap((x) => x.parcels).filter((p) => p.dest && p.dest.includes(',')) };
  }
  function askHtml() {
    if (!asking) return '';
    const c = chosen(), nos = c.gs.map((x) => x.no).join(', ');
    return `<div class="pv-ask" role="group" aria-labelledby="pvAskH">
      <div class="title-row"><h3 id="pvAskH">Remove personal details</h3>${info(REMOVAL, 'What removal does')}</div>
      ${c.gs.length ? `<div class="pv-two">
        <div class="pv-goes"><p class="eyebrow">Will be removed</p><ul>
          ${c.orders.length ? `<li>The customer's name on ${esc(plural(c.orders.length, 'order'))}: <b>${esc(c.orders.map((x) => x.no).join(', '))}</b></li>` : ''}
          ${c.slips.length ? `<li>The customer's name on ${esc(plural(c.slips.length, 'slip'))}${c.measured.length ? `, and the measurements on ${esc(num(c.measured.length))}` : ''}</li>` : ''}
          ${c.parcels.length ? `<li>The address on ${esc(plural(c.parcels.length, 'parcel'))}, cut down to its last part</li>` : ''}
        </ul></div>
        <div class="pv-stays"><p class="eyebrow">Stays</p><ul>
          <li>Order numbers, dates, items and amounts, for the accounts</li>
          <li>The slips, parcels and returns themselves</li>
          <li>Anything in Shopify, until it is removed there</li>
        </ul></div>
      </div>` : '<p class="muted">Tick the orders to remove from.</p>'}
      <form id="pvErase" novalidate>
        <div class="field"><label for="pvWhy">Who asked, and when <span class="req" aria-hidden="true">*</span></label><input class="input" id="pvWhy" name="reason" autocomplete="off" required aria-required="true" maxlength="200" placeholder="Customer email of 11 Nov asking for deletion" value="${esc(reason)}"></div>
        <div class="row"><button class="btn btn-primary" type="submit"${c.gs.length ? '' : ' disabled'}>${c.gs.length ? `Remove from ${esc(nos.length > 40 ? plural(c.gs.length, 'order') : nos)}` : 'Remove'}</button><button class="btn btn-quiet" type="button" data-cancel>Keep everything</button><span class="faint">This cannot be undone.</span></div>
      </form></div>`;
  }
  function doneHtml() {
    const canSee = data.canRead('shop_orders');
    const rows = done.nos.map((no) => {
      const o = data.all('shop_orders').find((x) => low(x.orderNo) === low(no)), ss = data.all('slips').filter((s) => low(s.orderNo) === low(no));
      const clear = ss.filter((s) => (!s.customerName || s.customerName === GONE) && (!s.measurements || s.measurements === GONE)).length;
      return `<tr><td class="mono">${esc(no)}</td><td>${o ? (o.customerName === GONE ? `<span class="pv-gone">${esc(GONE)}</span>` : personal(o.customerName)) : canSee ? '<span class="faint">No online order</span>' : esc(GONE)}</td><td>${o ? esc(day(o.date)) : ''}</td><td class="num">${o ? esc(money(o)) : ''}</td><td>${ss.length ? `${num(clear)} of ${esc(plural(ss.length, 'slip'))} cleared` : '<span class="faint">No slips</span>'}</td></tr>`;
    });
    return `<div class="pv-done" role="group" aria-labelledby="pvDoneH">
      <div class="pv-done-head"><span class="tag tag-ok">Removed</span><h3 id="pvDoneH" tabindex="-1">${esc(done.message)}</h3></div>
      <div class="table-wrap"><table class="table"><thead><tr><th>Order</th><th>Customer now</th><th>Date</th><th class="num">Amount</th><th>Slips</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>
      <dl class="pv-log"><div><dt>Recorded</dt><dd>${esc(done.reason)}</dd></div><div><dt>Still to do</dt><dd>Remove the customer in Shopify too, if they asked for everything to go.</dd></div></dl>
      <div class="row"><button class="btn btn-sm btn-outline" type="button" data-again>Find another customer</button></div>
    </div>`;
  }
  function outHtml() {
    if (done) return doneHtml();
    if (!found) return '';
    const r = found.res, n = found.groups.length, open = found.groups.filter((x) => !x.gone && x.no);
    if (!n) return `<div class="empty"><h3>Nothing held under "${esc(found.q)}"</h3><p>No online order or slip carries that name or order number.</p></div>`;
    return `
      <div class="pv-res-head">
        <div><p class="eyebrow">Held under "${esc(found.q)}"</p>
          <p class="pv-counts"><span><b>${num(r.orders.length)}</b> ${r.orders.length === 1 ? 'order' : 'orders'}</span><span><b>${num(r.slips.length)}</b> ${r.slips.length === 1 ? 'slip' : 'slips'}</span><span><b>${num(r.returns.length)}</b> ${r.returns.length === 1 ? 'return' : 'returns'}</span><span><b>${num(r.parcels.length)}</b> ${r.parcels.length === 1 ? 'parcel' : 'parcels'}</span></p></div>
        <div class="row"><button class="btn btn-sm" type="button" data-dl>Download what is held</button>${open.length ? `<button class="btn btn-sm btn-primary" type="button" data-ask aria-expanded="${asking}">Remove personal details</button>` : ''}</div>
      </div>
      <div class="pv-key"><span><mark class="pv-p">Marked like this</mark> is a personal detail</span>${open.length > 1 ? '<button type="button" class="link" data-all>Choose all</button>' : ''}</div>
      <ul class="pv-groups" aria-label="Orders found">${found.groups.map(groupHtml).join('')}</ul>
      <div id="pvAsk">${askHtml()}</div>`;
  }
  const renderOut = () => { out.innerHTML = outHtml(); };
  const renderAsk = () => { const a = $('#pvAsk', out); if (a) a.innerHTML = askHtml(); };

  /** What is held, as a file to hand to the customer: their own details only, without who made what. */
  function download() {
    const keep = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined && o[k] !== null && o[k] !== '').map((k) => [k, o[k]]));
    const r = found.res, noOf = (id) => r.orders.find((o) => o.id === id)?.orderNo;
    const file = {
      heldBy: data.workspace?.name || 'The business', searchedFor: found.q, madeOn: iso(today()),
      orders: r.orders.map((o) => keep(o, ['orderNo', 'date', 'customerName', 'country', 'items', 'size', 'qty', 'currency', 'amount', 'amountInr', 'status', 'awb', 'erasedOn'])),
      slips: r.slips.map((s) => ({ ...keep(s, ['no', 'orderNo', 'customerName']), ...keep({ style: data.title('styles', s.style) || s.styleName }, ['style']), ...keep(s, ['size', 'colour', 'measurements', 'promised', 'status']) })),
      returns: r.returns.map((x) => ({ ...keep({ orderNo: noOf(x.order) }, ['orderNo']), ...keep(x, ['no', 'date', 'reason', 'condition', 'refund', 'status']) })),
      parcels: r.parcels.map((p) => keep(p, ['no', 'ref', 'barcode', 'dest', 'status'])),
      notHeldHere: 'Email, phone and address are held in Shopify, not in this system.',
    };
    const a = document.createElement('a'), url = URL.createObjectURL(new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' }));
    a.href = url; a.download = `held-${low(found.q).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'customer'}-${iso(today())}.json`;
    root.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast('Downloaded what is held.');
  }

  root.addEventListener('submit', (e) => {
    e.preventDefault();
    if (e.target.id === 'pvForm') {
      const q = $('#pvQ', body).value.trim();
      if (q.length < 3) { oops(new Error('Type at least three letters of the name, or the order number.')); $('#pvQ', body).focus(); return; }
      busy(e.target.querySelector('button'), async () => {
        const res = (await api.act('privacy.find', { q })).data || {};
        found = { q, res: { orders: res.orders || [], slips: res.slips || [], returns: res.returns || [], parcels: res.parcels || [] } };
        found.groups = groupsOf(found.res); picked.clear(); asking = false; reason = ''; done = null;
        renderOut(); out.focus({ preventScroll: true }); out.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      });
    }
    if (e.target.id === 'pvErase') {
      const why = $('#pvWhy', out), c = chosen();
      if (!c.gs.length) return oops(new Error('Tick the orders to remove from.'));
      if (!reason.trim()) { oops(new Error('Record who asked and when.')); why.setAttribute('aria-invalid', 'true'); why.focus(); return; }
      busy(e.target.querySelector('button[type="submit"]'), async () => {
        const nos = c.gs.map((x) => x.no), res = await api.act('privacy.erase', { orderNos: nos, reason: reason.trim() });
        done = { message: res.message || 'Personal details are removed.', nos, reason: reason.trim() };
        found = null; picked.clear(); asking = false; reason = '';
        $('#pvQ', body).value = '';
        renderOut(); held.innerHTML = heldHtml(); toast(done.message);
        $('#pvDoneH', out)?.focus({ preventScroll: true }); out.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      });
    }
  });
  root.addEventListener('change', (e) => {
    const box = e.target.closest('.pv-group input[type="checkbox"]'); if (!box) return;
    if (box.checked) picked.add(box.value); else picked.delete(box.value);
    renderAsk();
  });
  root.addEventListener('input', (e) => { if (e.target.id === 'pvWhy') { reason = e.target.value; e.target.removeAttribute('aria-invalid'); } });
  root.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b || !root.contains(b)) return;
    if (b.dataset.open) return ctx.openEntity(b.dataset.open);
    if (b.dataset.dl !== undefined) return download();
    if (b.dataset.all !== undefined) {
      const boxes = [...out.querySelectorAll('.pv-group input[type="checkbox"]:not(:disabled)')], all = boxes.every((x) => x.checked);
      for (const x of boxes) { x.checked = !all; if (x.checked) picked.add(x.value); else picked.delete(x.value); }
      b.textContent = all ? 'Choose all' : 'Choose none'; renderAsk(); return;
    }
    if (b.dataset.ask !== undefined) {
      if (!picked.size) { const open = found.groups.filter((x) => !x.gone && x.no); if (open.length === 1) { picked.add(open[0].no); const box = out.querySelector('.pv-group input[type="checkbox"]:not(:disabled)'); if (box) box.checked = true; } }
      asking = true; b.setAttribute('aria-expanded', 'true'); renderAsk();
      const why = $('#pvWhy', out); why?.focus({ preventScroll: true }); $('.pv-ask', out)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); return;
    }
    if (b.dataset.cancel !== undefined) { asking = false; reason = ''; renderAsk(); const again = out.querySelector('[data-ask]'); again?.setAttribute('aria-expanded', 'false'); again?.focus(); return; }
    if (b.dataset.again !== undefined) { done = null; renderOut(); $('#pvQ', body).focus(); }
  });

  held.innerHTML = heldHtml();
  // The cards rise in once, on arrival; later redraws stay still.
  const settle = setTimeout(() => root.classList.remove('is-first'), 800);
  // The counts follow the records; the search and its result are left alone while someone works on them.
  const off = data.on(() => { held.innerHTML = heldHtml(); });
  return () => { off(); clearTimeout(settle); };
}
