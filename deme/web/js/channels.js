// Channels: what each channel costs and what it really brings in.
// Spend comes from the channel (media_days). Orders and revenue come from Shopify, by the channel
// each order came through (shop_orders.channel). Set side by side with what the channel itself
// claims, the gap between claimed and real is plain to see. Someone who cannot read online orders
// gets the smaller picture: spend and the channels' own claims.

import { api, data } from './api.js';
import { $, esc, info, toast, busy, inr, num, fmtDate } from './ui.js';
import { iso, today, fmtDay, inrFull } from '../shared/util.js';

const PAID = ['Meta', 'Google', 'Email', 'Influencer', 'Affiliate', 'Other'];
const DIRECT = 'Direct', UNKNOWN = 'Source not known';
const PERIODS = [['7', '7 days'], ['30', '30 days'], ['90', '90 days'], ['month', 'This month'], ['last', 'Last month']];
const NOT_SOLD = ['cancelled', 'returned'];
let period = '30';   // kept while the app is open, so coming back shows the same days

const plural = (n, one, many = `${one}s`) => `${num(n)} ${n === 1 ? one : many}`;
const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
const dayOf = (isoDate) => new Date(`${isoDate}T00:00:00`);
const times = (x) => `${x >= 10 ? num(x, 1) : num(x, 2)}×`;
/** A round number at or above v, for the top of the scale. */
const nice = (v) => { if (!(v > 0)) return 0; const p = 10 ** Math.floor(Math.log10(v)), m = v / p; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p; };

function range(p) {
  const t = today(), back = (n) => { const x = today(); x.setDate(x.getDate() - n); return x; };
  if (p === 'month') return [iso(new Date(t.getFullYear(), t.getMonth(), 1)), iso(t)];
  if (p === 'last') return [iso(new Date(t.getFullYear(), t.getMonth() - 1, 1)), iso(new Date(t.getFullYear(), t.getMonth(), 0))];
  return [iso(back(Number(p) - 1)), iso(t)];
}

/** Rupees for one unit of a currency: the newest rate on or before the date, as the server states it. Null when none is on record. */
function rateOn(currency, date) {
  if (!currency || currency === 'INR') return 1;
  const r = data.all('fx_rates').filter((x) => x.currency === currency && x.date <= date).sort((a, b) => (a.date < b.date ? 1 : -1))[0];
  return r && Number(r.rate) > 0 ? Number(r.rate) : null;
}
/** The rate one line of spend was stated at: its own rupee figure if it has one, else the rate on record. */
function lineRate(l) {
  if (!l.currency || l.currency === 'INR') return 1;
  if (l.spendInr != null && Number(l.spend) > 0) return l.spendInr / l.spend;
  return rateOn(l.currency, l.date);
}
function orderInr(o) {
  if (o.amountInr != null) return Number(o.amountInr) || 0;
  const r = rateOn(o.currency, o.date);
  return r === null ? null : (Number(o.amount) || 0) * r;
}
const sourceOf = (o) => { const c = String(o.channel || '').trim(); return c ? [...PAID, DIRECT].find((x) => same(x, c)) || 'Other' : UNKNOWN; };

/** Everything the screen shows for one stretch of days, worked out from the cache. */
function work(from, to, canOrders) {
  const days = [], at = {};
  for (let d = dayOf(from); iso(d) <= to; d.setDate(d.getDate() + 1)) { const x = { date: iso(d), spend: 0, rev: 0, orders: 0, claimed: 0 }; days.push(x); at[x.date] = x; }
  const ch = {}, camp = {};
  const channel = (name) => (ch[name] ||= { name, paid: PAID.includes(name), spend: 0, lines: 0, noRate: 0, orders: 0, rev: 0, claimOrders: 0, claimRev: 0, clicks: 0 });
  const campaign = (name) => (camp[name.toLowerCase()] ||= { name, channels: new Set(), spend: 0, lines: 0, noRate: 0, orders: 0, rev: 0, claimOrders: 0, claimRev: 0, clicks: 0 });
  const t = { spend: 0, lines: 0, spendDays: new Set(), clicks: 0, claimOrders: 0, claimRev: 0, rev: 0, orders: 0, paidRev: 0, paidOrders: 0, left: 0,
    noRate: { lines: 0, orders: 0, cur: new Set(), first: '' } };
  const missing = (cur, date, what) => { t.noRate[what]++; t.noRate.cur.add(cur); if (!t.noRate.first || date < t.noRate.first) t.noRate.first = date; };

  for (const l of data.all('media_days')) {
    if (!(l.date >= from && l.date <= to)) continue;
    const r = lineRate(l), name = PAID.find((x) => same(x, l.channel)) || 'Other';
    const spend = l.spendInr != null ? Number(l.spendInr) || 0 : r === null ? null : (Number(l.spend) || 0) * r;
    const claimed = r === null ? 0 : (Number(l.revenue) || 0) * r;
    const c = channel(name), k = campaign(String(l.campaign || '').trim());
    if (spend === null) { missing(l.currency, l.date, 'lines'); c.noRate++; k.noRate++; }
    for (const x of [c, k, t]) { x.spend += spend || 0; x.lines++; x.claimOrders += Number(l.purchases) || 0; x.claimRev += claimed; x.clicks += Number(l.clicks) || 0; }
    k.channels.add(name);
    if (spend) t.spendDays.add(l.date);
    if (at[l.date]) { at[l.date].spend += spend || 0; at[l.date].claimed += claimed; }
  }
  if (canOrders) for (const o of data.all('shop_orders')) {
    if (!(o.date >= from && o.date <= to)) continue;
    if (NOT_SOLD.includes(o.status)) { t.left++; continue; }
    const v = orderInr(o), c = channel(sourceOf(o)), name = String(o.campaign || '').trim();
    if (v === null) missing(o.currency, o.date, 'orders');
    const into = [c, t, at[o.date]].filter(Boolean);
    if (name) { const k = campaign(name); k.channels.add(c.name); into.push(k); }
    for (const x of into) { x.orders++; x.rev += v || 0; }
    if (c.paid) { t.paidOrders++; t.paidRev += v || 0; }
  }
  const order = [...PAID, DIRECT, UNKNOWN];
  const channels = Object.values(ch).sort((a, b) => (b.paid - a.paid) || (b.spend - a.spend) || (order.indexOf(a.name) - order.indexOf(b.name)));
  const plans = data.all('campaigns');
  const campaigns = Object.values(camp).filter((k) => k.name || k.lines).map((k) => ({ ...k, plan: k.name ? plans.find((p) => same(p.name, k.name)) || null : null }))
    .sort((a, b) => (b.spend - a.spend) || (b.rev - a.rev) || a.name.localeCompare(b.name));
  return { from, to, days, channels, campaigns, t };
}

export function mount(el, ctx) {
  el.innerHTML = '<div class="workspace channels is-first"><div class="workspace-inner" id="chRoot"></div><div class="ch-tip" role="status" aria-live="polite" hidden></div></div>';
  const root = $('.channels', el), body = $('#chRoot', el), tipEl = $('.ch-tip', el);
  let dayTips = [], at = -1;

  const label = () => PERIODS.find((p) => p[0] === period)[1];
  const span = (w) => (w.from === w.to ? fmtDate(dayOf(w.from)) : `${fmtDate(dayOf(w.from))} to ${fmtDate(dayOf(w.to))}`);
  const tip = (text) => `data-tip="${esc(text)}"`;

  // ── The buttons that bring spend in ──
  function buttons(primary) {
    if (!data.canWrite('media_days')) return '';
    return `${api.caps.meta ? `<button class="btn btn-sm${primary === 'pull' ? ' btn-primary' : ''}" type="button" data-pull>Pull from Meta</button>` : ''}
      <button class="btn btn-sm${primary && !(primary === 'pull' && api.caps.meta) ? ' btn-primary' : ''}" type="button" data-go="import">Bring in a channel export</button>
      <button class="btn btn-sm" type="button" data-add="media_days">Add a day by hand</button>`;
  }
  function headHtml(bare) {
    const how = api.caps.meta
      ? 'Meta is connected: Pull from Meta brings in its spend for the days shown. Google and the other channels come in from their exports, or from a scheduled job that sends each day in. A day can also be typed in by hand.'
      : 'Meta comes in by itself once its keys are added to the live site. Google and the other channels come in from their exports, or from a scheduled job that sends each day in. A day can also be typed in by hand.';
    return `
      <div class="view-head">
        <div class="title-row"><h1 class="reveal">Channels</h1>${info('What each channel cost in the days shown and what it really brought in. Spend is what was paid to the channel, in rupees. Online revenue is every online order in those days that was not cancelled or returned. Return on ad spend is the revenue of the orders that came through a paid channel, divided by spend. Cost per order is spend divided by those orders.', 'Channels')}</div>
        <div class="seg" role="group" aria-label="Days shown">${PERIODS.map(([id, name]) => `<button type="button" data-period="${id}" aria-pressed="${period === id}">${esc(name)}</button>`).join('')}</div>
      </div>
      <div class="ch-acts">
        <span class="ch-src"><span class="tag ${api.caps.meta ? 'tag-ok' : 'tag-plain'}">${api.caps.meta ? 'Meta connected' : 'Meta not connected'}</span>${info(how, 'Where spend comes from')}</span>
        ${bare ? '' : `<span class="ch-btns">${buttons('')}</span>`}
      </div>`;
  }

  // ── Lines that cannot be stated in rupees ──
  function noRateHtml(w) {
    const m = w.t.noRate; if (!m.lines && !m.orders) return '';
    const what = [m.lines ? plural(m.lines, 'line') + ' of spend' : '', m.orders ? plural(m.orders, 'order') : ''].filter(Boolean).join(' and ');
    const cur = [...m.cur].filter(Boolean).join(', ') || 'another currency';
    return `<div class="panel ch-note" role="note">
      <span class="tag tag-warn">No exchange rate</span>
      <p>${esc(what)} in ${esc(cur)} ${m.lines + m.orders === 1 ? 'has' : 'have'} no rupee value and ${m.lines + m.orders === 1 ? 'is' : 'are'} left out of the rupee figures.</p>
      ${data.canWrite('fx_rates') ? '<button class="btn btn-sm btn-primary" type="button" data-add="fx_rates">Add an exchange rate</button>' : '<span class="faint">Ask finance to add the rate</span>'}
      ${info(`Amounts in another currency are stated in rupees at the newest exchange rate dated on or before their own date. Add a rate for ${cur} dated ${fmtDate(dayOf(m.first))} or earlier and these are counted.`, 'No exchange rate')}
    </div>`;
  }

  // ── Headline figures ──
  const kpi = (name, value, note, { na = false, state = '' } = {}) => `<div class="kpi"${state ? ` data-state="${state}"` : ''}><p class="kpi-label">${esc(name)}</p><p class="kpi-value${na ? ' ch-na' : ''}">${esc(value)}</p>${note ? `<p class="kpi-note">${esc(note)}</p>` : ''}</div>`;
  function kpisHtml(w, canOrders) {
    const t = w.t, partial = t.noRate.lines > 0, state = partial ? { state: 'warn' } : {};
    const spend = t.spend > 0
      ? kpi('Spend', inr(t.spend), partial ? `Without ${plural(t.noRate.lines, 'line')} that ${t.noRate.lines === 1 ? 'has' : 'have'} no rate` : `On ${plural(t.spendDays.size, 'day')} of ${num(w.days.length)}`, state)
      : kpi('Spend', partial ? 'No rate' : 'No spend', partial ? `${plural(t.noRate.lines, 'line')} with no rupee value` : t.lines ? 'Lines are in, at zero' : 'Nothing brought in for these days', { na: true });
    if (!canOrders) {
      return `<div class="kpis">${spend}
        ${t.clicks > 0 ? kpi('Clicks', num(t.clicks), t.spend > 0 ? `${inr(t.spend / t.clicks)} a click` : '') : kpi('Clicks', 'No clicks', '', { na: true })}
        ${t.claimOrders > 0 ? kpi('Orders the channels claim', num(t.claimOrders), t.spend > 0 ? `${inr(t.spend / t.claimOrders)} an order, by their count` : '') : kpi('Orders the channels claim', 'None claimed', '', { na: true })}
        ${t.claimRev > 0 ? kpi('Revenue the channels claim', inr(t.claimRev), t.spend > 0 ? `${times(t.claimRev / t.spend)} the spend, by their count` : '') : kpi('Revenue the channels claim', 'None claimed', '', { na: true })}
      </div>`;
    }
    const noSpend = partial && !t.spend ? 'No rate for the spend' : 'No spend to set it against';
    return `<div class="kpis">${spend}
      ${t.orders ? kpi('Online revenue', inr(t.rev), t.noRate.orders ? `Without ${plural(t.noRate.orders, 'order')} that ${t.noRate.orders === 1 ? 'has' : 'have'} no rate` : `${inr(t.paidRev)} through paid channels`, t.noRate.orders ? { state: 'warn' } : {}) : kpi('Online revenue', 'No orders', 'None in these days', { na: true })}
      ${t.orders ? kpi('Orders', num(t.orders), `${num(t.paidOrders)} through paid channels${t.left ? `, ${num(t.left)} cancelled or returned left out` : ''}`) : kpi('Orders', 'No orders', t.left ? `${num(t.left)} cancelled or returned left out` : 'None in these days', { na: true })}
      ${!(t.spend > 0) ? kpi('Return on ad spend', 'No spend', noSpend, { na: true }) : !t.paidOrders ? kpi('Return on ad spend', 'No orders', 'None came through a paid channel', { na: true }) : kpi('Return on ad spend', times(t.paidRev / t.spend), partial || t.noRate.orders ? 'Part of the picture: a rate is missing' : `${inr(t.paidRev)} back on ${inr(t.spend)}`)}
      ${!(t.spend > 0) ? kpi('Cost per order', 'No spend', noSpend, { na: true }) : !t.paidOrders ? kpi('Cost per order', 'No orders', 'None came through a paid channel', { na: true }) : kpi('Cost per order', inr(t.spend / t.paidOrders), partial ? 'Part of the picture: a rate is missing' : `${plural(t.paidOrders, 'order')} through paid channels`)}
    </div>`;
  }

  // ── One channel: spend, what came in, what it claims ──
  function gapTag(c) {
    if (!c.paid || !(c.claimRev > 0)) return '';
    if (!(c.rev > 0)) return '<span class="tag tag-warn">Claim not seen in orders</span>';
    const g = c.claimRev / c.rev - 1;
    return g >= 1 ? `<span class="tag tag-warn">Claims ${esc(times(g + 1))} what came in</span>` : g > 0.1 ? `<span class="tag tag-warn">Claims ${num(g * 100)}% more</span>` : g < -0.1 ? `<span class="tag tag-info">Claims ${num(-g * 100)}% less</span>` : '<span class="tag tag-ok">Claim matches</span>';
  }
  function channelHtml(c, max, canOrders) {
    const bar = (k, name, v, text) => `<div class="ch-bar" data-k="${k}"><span>${name}</span><div class="ch-track"><i style="width:${v > 0 ? Math.max(1.5, (v / max) * 100).toFixed(1) : 0}%"></i></div><b${v > 0 ? '' : ' class="ch-none"'}>${esc(text)}</b></div>`;
    const said = [`${c.name}:`, c.paid ? `spend ${c.spend > 0 ? inrFull(c.spend) : 'none'}` : 'no spend',
      canOrders ? `, came in ${inrFull(c.rev)} from ${plural(c.orders, 'order')}` : '',
      c.paid ? `, the channel claims ${inrFull(c.claimRev)} from ${plural(c.claimOrders, 'order')}` : ''].filter(Boolean).join(' ').replace(/ ,/g, ',');
    const real = canOrders ? c.rev : c.claimRev;
    const ret = !c.paid ? '<p class="ch-x ch-na">No spend</p>'
      : !(c.spend > 0) ? `<p class="ch-x ch-na">${c.noRate ? 'No rate for the spend' : 'No spend brought in'}</p>`
        : canOrders && !c.orders ? `<p class="ch-x ch-na">No orders</p>${c.claimRev > 0 ? `<p class="ch-sub">Channel claims ${esc(times(c.claimRev / c.spend))}</p>` : ''}`
          : !(real > 0) ? '<p class="ch-x ch-na">Nothing claimed</p>'
            : `<p class="ch-x">${esc(times(real / c.spend))}</p>${canOrders && c.claimRev > 0 ? `<p class="ch-sub">Channel claims ${esc(times(c.claimRev / c.spend))}</p>` : ''}`;
    return `<li class="ch-row">
      <div class="ch-who">
        <h3>${esc(c.name)}</h3>
        <p>${canOrders ? esc(plural(c.orders, 'order')) : esc(plural(c.clicks, 'click'))}${c.paid && (canOrders || c.claimOrders) ? ` · ${canOrders ? 'channel ' : ''}claims ${esc(canOrders ? num(c.claimOrders) : plural(c.claimOrders, 'order'))}` : ''}</p>
        ${canOrders ? gapTag(c) : ''}
      </div>
      <div class="ch-bars" tabindex="0" role="img" aria-label="${esc(said)}" ${tip(said)}>
        ${bar('spend', 'Spend', c.spend, c.spend > 0 ? inr(c.spend) : c.noRate ? 'No rate' : 'No spend')}
        ${canOrders ? bar('real', 'Came in', c.rev, c.orders ? inr(c.rev) : 'No orders') : ''}
        ${c.paid ? bar('claim', 'Claimed', c.claimRev, c.claimRev > 0 ? inr(c.claimRev) : c.noRate && c.claimOrders ? 'No rate' : 'No claim') : ''}
      </div>
      <div class="ch-ret"><p class="eyebrow">${canOrders ? 'Return on spend' : 'Claimed return'}</p>${ret}</div>
    </li>`;
  }
  function channelsHtml(w, canOrders) {
    const max = Math.max(...w.channels.flatMap((c) => [c.spend, canOrders ? c.rev : 0, c.claimRev]), 0);
    const about = canOrders
      ? 'For each channel: what was spent, the orders and revenue that came through it as Shopify traced them, and what the channel itself reports. A channel counts a sale whenever its advert was seen or clicked, so it usually claims more than came in. Direct is people who came by themselves and has no spend. Source not known is orders with no trace of where they came from.'
      : 'For each channel: what was spent and what the channel itself reports. Online orders are not open to you, so the real orders and revenue are not shown.';
    return `<section class="panel" aria-labelledby="chByH">
      <div class="panel-head"><div class="title-row"><h2 id="chByH">By channel</h2>${info(about, 'By channel')}</div>${canOrders ? '' : '<span class="tag tag-plain">Channel claims only</span>'}</div>
      ${w.channels.length ? `
        <ul class="ch-legend" aria-label="What the bars show"><li><i data-k="spend"></i>Spend</li>${canOrders ? '<li><i data-k="real"></i>Came in, from orders</li>' : ''}<li><i data-k="claim"></i>Claimed by the channel</li></ul>
        <ul class="ch-list">${w.channels.map((c) => channelHtml(c, max, canOrders)).join('')}</ul>`
    : `<div class="empty"><h3>Nothing in ${esc(label().toLowerCase())}</h3><p>No spend${canOrders ? ' and no online orders' : ''} from ${esc(span(w))}.</p></div>`}
    </section>`;
  }

  // ── Day by day: spend as bars, revenue as a line, on one rupee scale ──
  function daysHtml(w, canOrders) {
    const val = (d) => (canOrders ? d.rev : d.claimed), top = nice(Math.max(...w.days.flatMap((d) => [d.spend, val(d)]), 0));
    const lineName = canOrders ? 'Online revenue' : 'Revenue the channels claim';
    const head = `<div class="panel-head"><div class="title-row"><h2 id="chDayH">Day by day</h2>${info(`The bars are spend and the line is ${canOrders ? 'online revenue' : 'the revenue the channels claim'}, both in rupees on the same scale. Point at a day, or move to the chart and use the left and right arrow keys, to read it.`, 'Day by day')}</div><span class="faint ch-span">${esc(span(w))}</span></div>`;
    dayTips = [];
    if (!top) return `<section class="panel" aria-labelledby="chDayH">${head}<div class="empty"><h3>Nothing to draw</h3><p>No spend${canOrders ? ' or orders' : ''} in these days.</p></div></section>`;
    const n = w.days.length, y = (v) => ((v / top) * 100).toFixed(2);
    const pts = w.days.map((d, i) => `${(((i + 0.5) / n) * 100).toFixed(2)} ${(100 - (val(d) / top) * 100).toFixed(2)}`);
    dayTips = w.days.map((d) => `${fmtDay(dayOf(d.date))}: spend ${inrFull(d.spend)}, ${canOrders ? `revenue ${inrFull(d.rev)}, ${plural(d.orders, 'order')}` : `claimed ${inrFull(d.claimed)}`}`);
    const mid = w.days[Math.floor((n - 1) / 2)];
    return `<section class="panel" aria-labelledby="chDayH">${head}
      <ul class="ch-legend" aria-label="What the chart shows"><li><i data-k="spend"></i>Spend <b>${esc(w.t.spend > 0 ? inr(w.t.spend) : 'None')}</b></li><li><i data-k="${canOrders ? 'line' : 'dash'}"></i>${esc(lineName)} <b>${esc(canOrders ? (w.t.orders ? inr(w.t.rev) : 'No orders') : w.t.claimRev > 0 ? inr(w.t.claimRev) : 'None')}</b></li></ul>
      <div class="ch-chart">
        <div class="ch-plot">
          <div class="ch-grid" aria-hidden="true">${[1, 0.5, 0].map((f) => `<span style="bottom:${f * 100}%"${f ? '' : ' class="is-base"'}><em>${f ? esc(inr(top * f)) : '0'}</em></span>`).join('')}</div>
          <div class="ch-days${n > 45 ? ' is-dense' : ''}" tabindex="0" role="group" aria-label="${esc(`Spend and ${lineName.toLowerCase()} for each day, ${span(w)}. Use the left and right arrow keys to read each day.`)}">${w.days.map((d) => `<i>${d.spend > 0 ? `<b style="height:${y(d.spend)}%"></b>` : ''}<u style="bottom:${y(val(d))}%"></u></i>`).join('')}</div>
          <svg class="ch-line" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path class="ch-under" d="M${pts.join('L')}"/><path class="ch-stroke${canOrders ? '' : ' is-claim'}" d="M${pts.join('L')}"/></svg>
        </div>
        <div class="ch-axis" aria-hidden="true"><span>${esc(fmtDate(dayOf(w.from)))}</span>${n > 4 ? `<span>${esc(fmtDate(dayOf(mid.date)))}</span>` : ''}<span>${esc(fmtDate(dayOf(w.to)))}</span></div>
      </div>
    </section>`;
  }

  // ── Campaigns, ranked by spend ──
  function campaignsHtml(w, canOrders) {
    const list = w.campaigns.slice(0, 50), max = Math.max(...list.map((k) => k.spend), 0);
    const quiet = (text) => `<span class="faint">${text}</span>`;
    const about = `Campaigns ranked by spend. ${canOrders ? 'An order belongs to a campaign when the campaign name on the order is the same as the name in the channel, whatever the capitals, so the name in the advert link has to match. A campaign with orders and no spend is listed last. ' : ''}Budget shows when a planned campaign of the same name exists; its name opens the plan.`;
    const row = (k) => {
      const chans = [...k.channels].sort((a, b) => PAID.indexOf(a) - PAID.indexOf(b));
      const name = k.name || 'No campaign named';
      return `<tr>
        <td class="ch-camp">${k.plan && data.canRead('campaigns') ? `<button type="button" class="link" data-open="campaigns" data-id="${esc(k.plan.id)}">${esc(name)}</button>` : `<span${k.name ? '' : ' class="faint"'}>${esc(name)}</span>`}</td>
        <td>${chans.map((c) => `<span class="tag tag-plain">${esc(c)}</span>`).join(' ')}</td>
        <td class="num">${k.spend > 0 ? `<span class="ch-spend"><b>${esc(inr(k.spend))}</b><span class="bar" style="--v:${((k.spend / max) * 100).toFixed(1)}%"><i></i></span></span>` : quiet(k.noRate ? 'No rate' : 'No spend')}</td>
        <td class="num">${k.plan && Number(k.plan.budget) > 0 ? esc(inr(Number(k.plan.budget))) : quiet('Not set')}</td>
        ${canOrders ? `<td class="num">${k.orders ? num(k.orders) : quiet('0')}</td><td class="num">${k.orders ? esc(inr(k.rev)) : quiet('₹0')}</td><td class="num">${k.spend > 0 && k.orders ? esc(times(k.rev / k.spend)) : quiet(k.orders ? (k.noRate ? 'No rate' : 'No spend') : 'No orders')}</td>`
    : `<td class="num">${k.clicks ? num(k.clicks) : quiet('0')}</td>`}
        <td class="num">${k.lines ? (k.claimOrders ? num(k.claimOrders) : quiet('0')) : quiet('No claim')}</td><td class="num">${k.claimRev > 0 ? esc(inr(k.claimRev)) : quiet(!k.lines ? 'No claim' : k.noRate && k.claimOrders ? 'No rate' : '₹0')}</td>
        ${canOrders ? '' : `<td class="num">${k.spend > 0 && k.claimRev > 0 ? esc(times(k.claimRev / k.spend)) : quiet(k.spend > 0 ? 'No claim' : k.noRate ? 'No rate' : 'No spend')}</td>`}
      </tr>`;
    };
    return `<section class="panel" aria-labelledby="chCampH">
      <div class="panel-head"><div class="title-row"><h2 id="chCampH">Campaigns</h2>${info(about, 'Campaigns')}</div>${w.campaigns.length ? `<span class="faint ch-span">${w.campaigns.length > list.length ? `Top ${list.length} of ${num(w.campaigns.length)}` : plural(list.length, 'campaign')}</span>` : ''}</div>
      ${list.length ? `<div class="table-wrap"><table class="table ch-camps">
        <thead><tr><th>Campaign</th><th>Channel</th><th class="num">Spend</th><th class="num">Budget</th>${canOrders ? '<th class="num">Orders</th><th class="num">Came in</th><th class="num">Return</th>' : '<th class="num">Clicks</th>'}<th class="num">Claimed orders</th><th class="num">Claimed revenue</th>${canOrders ? '' : '<th class="num">Claimed return</th>'}</tr></thead>
        <tbody>${list.map(row).join('')}</tbody></table></div>`
    : `<div class="empty"><h3>No campaigns in these days</h3><p>They appear when spend or orders carry a campaign name.</p></div>`}
    </section>`;
  }

  function render() {
    const canOrders = data.canRead('shop_orders'), keep = root.scrollTop;
    const [from, to] = range(period), w = work(from, to, canOrders);
    const media = data.all('media_days'), orders = canOrders ? data.all('shop_orders') : [];
    const nothing = !media.length && !orders.length;
    let html = headHtml(nothing);   // with nothing in, the buttons sit in the empty panel instead
    if (nothing) {
      html += `<section class="panel empty"><h3>No channel spend yet</h3>
        <p>${data.canWrite('media_days') ? 'Bring in what Meta, Google or any other channel was paid, day by day.' : 'Marketing brings in what each channel was paid, day by day.'}${canOrders ? ' Online orders come in from Shopify.' : ''}</p>
        <div class="row ch-empty-btns">${buttons(api.caps.meta ? 'pull' : 'import')}</div></section>`;
    } else {
      const newest = [...media, ...orders].reduce((m, x) => (x.date > m ? x.date : m), '');
      const bare = !w.t.lines && !w.t.orders && !w.t.left;
      html += noRateHtml(w) + kpisHtml(w, canOrders);
      if (bare) html += `<section class="panel empty"><h3>Nothing from ${esc(span(w))}</h3><p>${newest ? `The newest line on record is ${esc(fmtDate(dayOf(newest)))}.` : ''}</p><div class="row ch-empty-btns">${period !== '90' ? '<button class="btn btn-sm btn-primary" type="button" data-period="90">Show 90 days</button>' : ''}${buttons('')}</div></section>`;
      else html += channelsHtml(w, canOrders) + daysHtml(w, canOrders) + campaignsHtml(w, canOrders);
    }
    body.innerHTML = html;
    root.scrollTop = keep; at = -1; hideTip();
  }

  // ── Reading a value: point at it, or focus it ──
  function showTip(target, text) {
    if (!text || !target) return hideTip();
    tipEl.textContent = text; tipEl.hidden = false;
    const r = target.getBoundingClientRect(), tw = tipEl.offsetWidth, th = tipEl.offsetHeight;
    tipEl.style.left = `${Math.max(8, Math.min(r.left + r.width / 2 - tw / 2, innerWidth - tw - 8))}px`;
    tipEl.style.top = `${r.top - th - 10 < 8 ? r.bottom + 10 : r.top - th - 10}px`;
  }
  function hideTip() { tipEl.hidden = true; }
  const cols = () => [...root.querySelectorAll('.ch-days > i')];
  function onDay(i) {
    const cs = cols(); if (!cs.length) return;
    at = Math.max(0, Math.min(cs.length - 1, i));
    cs.forEach((c, j) => c.classList.toggle('is-on', j === at));
    showTip(cs[at].querySelector('u'), dayTips[at]);
  }
  function offDay() { cols().forEach((c) => c.classList.remove('is-on')); hideTip(); }
  const daysFocused = () => document.activeElement?.classList?.contains('ch-days') && root.contains(document.activeElement);

  root.addEventListener('click', (e) => {
    const col = e.target.closest('.ch-days > i');
    if (col) return onDay([...col.parentNode.children].indexOf(col));
    const b = e.target.closest('button'); if (!b || !root.contains(b)) return;
    if (b.dataset.period) { period = b.dataset.period; render(); root.querySelector(`.seg [data-period="${period}"]`)?.focus(); return; }
    if (b.dataset.go) return ctx.go(b.dataset.go);
    if (b.dataset.add) return ctx.openEntity(b.dataset.add, { add: true });
    if (b.dataset.open) return ctx.openEntity(b.dataset.open, { id: b.dataset.id });
    if (b.dataset.pull !== undefined) return void busy(b, async () => { const out = await api.mediaPull(range(period)[0]); toast(out.message || 'Meta is up to date.'); });
  });
  root.addEventListener('pointerover', (e) => {
    const col = e.target.closest('.ch-days > i');
    if (col) return onDay([...col.parentNode.children].indexOf(col));
    if (daysFocused() && at >= 0) return onDay(at);
    offDay();
    const t = e.target.closest('[data-tip]'); if (t) showTip(t, t.dataset.tip);
  });
  root.addEventListener('pointerleave', () => { if (daysFocused() && at >= 0) onDay(at); else offDay(); });
  root.addEventListener('focusin', (e) => {
    if (e.target.classList.contains('ch-days')) return onDay(at < 0 ? cols().length - 1 : at);
    const t = e.target.closest('[data-tip]'); if (t && t.matches(':focus-visible')) showTip(t, t.dataset.tip);
  });
  root.addEventListener('focusout', offDay);
  root.addEventListener('keydown', (e) => {
    if (!e.target.classList.contains('ch-days')) return;
    const to = { ArrowLeft: at - 1, ArrowRight: at + 1, Home: 0, End: cols().length - 1 }[e.key];
    if (to === undefined) return;
    e.preventDefault(); onDay(to);
  });
  root.addEventListener('scroll', () => { if (!daysFocused()) hideTip(); }, { passive: true });
  const onKey = (e) => { if (e.key === 'Escape') offDay(); };
  document.addEventListener('keydown', onKey);

  render();
  // Bars draw in once, on arrival; later redraws from live changes stay still.
  const settle = setTimeout(() => root.classList.remove('is-first'), 1200);
  const USES = ['*', 'media_days', 'shop_orders', 'campaigns', 'fx_rates'];
  const off = data.on((touched) => { if (!touched || touched.some((t) => USES.includes(t))) render(); });
  return () => { off(); clearTimeout(settle); document.removeEventListener('keydown', onKey); };
}
