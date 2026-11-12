// Made-to-order work, one slip per piece. A slip is born from a paid online order or from an
// internal order (store, boutique, shoot, influencer), is given to a master, and is then scanned
// at each stop: the tailor when starting and finishing, QC when it arrives and when it is judged.
// Every stop is stamped with the time and the person, so nobody has to ask where a piece is, and
// later it is known who made what. Also here: orders pulled from Shopify, channel spend, and
// what privacy law asks for (finding and removing a customer's personal details).

import { GARMENT_REASONS, CURRENCIES } from './schema.js';

const REASON = Object.fromEntries(GARMENT_REASONS);
const same = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();
const short = (s, n = 60) => (String(s).length > n ? `${String(s).slice(0, n - 1)}…` : String(s));
const holders = (ctx, positions) => ctx.all('users').filter((u) => u.active !== false && positions.includes(u.position)).map((u) => u.id);
const link = (slip) => `slip-${slip.no}`;
const what = (ctx, s) => `${s.no}${s.orderNo ? ` (${s.orderNo})` : ''}: ${ctx.title('styles', s.style) || s.styleName || 'piece'}${s.size ? `, ${s.size}` : ''}`;

/** Stamp a stop on the slip's trail and move it there. */
function stop(ctx, slip, status, text, note = '') {
  slip.events = [...(slip.events || []), { at: ctx.now, stage: text, by: ctx.user.name, ...(note ? { note } : {}) }];
  return ctx.setStatus('slips', slip, status, `Slip ${slip.no}: ${text.toLowerCase()}${note ? ` (${note})` : ''}`);
}
/** A slip from what was scanned or typed: its number, or the link in its QR code. */
function find(ctx, code) {
  const raw = String(code ?? '').trim(); if (!raw) ctx.fail('Scan the code on the slip.');
  const no = (/slip-([A-Za-z]+-\d+)/i.exec(raw)?.[1] || raw).toUpperCase();
  return ctx.all('slips').find((s) => same(s.no, no)) || ctx.fail(`No slip has the number ${short(no, 30)}. Check the slip and scan again.`);
}
/** Tell whoever asked for the piece, and anyone standing in for an online customer. */
const tellAsker = (ctx, slip, text) => { if (slip.raisedBy) ctx.notify(slip.raisedBy, text, link(slip)); };
/** Does the store hold fabric for this style right now? Used to warn, never to block. */
function fabricFor(ctx, styleId) {
  const st = styleId ? ctx.get('styles', styleId) : null;
  if (!st?.fabric || !(st.metres > 0)) return null;
  const have = ctx.all('rolls').filter((r) => ['dyed', 'passed'].includes(r.status) && !r.heldAt && r.item === st.fabric && (st.shade ? r.status === 'dyed' && same(r.shade, st.shade) : true)).reduce((n, r) => n + (r.left ?? r.metres ?? 0), 0);
  return { need: st.metres, have };
}
/** The style an online order line means: by its code (the SKU), else by its name. */
function styleFor(ctx, line) {
  const styles = ctx.all('styles');
  return styles.find((s) => line.sku && same(s.code, line.sku)) || styles.find((s) => same(s.name, line.title)) || styles.find((s) => line.sku && String(line.sku).toLowerCase().startsWith(String(s.code).toLowerCase())) || null;
}

export const SLIP_ACTIONS = {
  // An online order typed or imported in another currency is also stated in rupees.
  'hook.created.shop_orders': { run(ctx, _p, doc) { if (doc.currency && doc.currency !== 'INR' && doc.amountInr === undefined) { const v = ctx.toInr(doc.amount || 0, doc.currency, doc.date); if (v !== null) { doc.amountInr = v; ctx.put('shop_orders', doc); } } } },
  'hook.created.media_days': { run(ctx, _p, doc) { const v = ctx.toInr(doc.spend || 0, doc.currency || 'INR', doc.date); if (v !== null && doc.spendInr !== v) { doc.spendInr = v; doc.from ||= 'Typed in'; ctx.put('media_days', doc); } } },
  // ── On the floor ──
  'slip.assign': {
    run(ctx, { master }, doc) {
      master = String(master || '').trim(); if (!master) ctx.fail('Name the master.');
      doc.master = master;
      const f = fabricFor(ctx, doc.style);
      const warn = f && f.have < f.need * (doc.qty || 1) ? ' The store shows no fabric for it: mark it as missing fabric if the master cannot start.' : '';
      stop(ctx, doc, 'assigned', `Given to ${master}`);
      return { message: `Slip ${doc.no} is with ${master}.${warn}` };
    },
  },
  'slip.cut': { run(ctx, _p, doc) { if (doc.noFabric) ctx.fail(`Slip ${doc.no} is marked as missing fabric. Clear that first.`); stop(ctx, doc, 'cut', 'Cut'); return { message: `Slip ${doc.no} is cut.` }; } },
  /** The master or the floor manager cannot start: say what is missing. Everyone following the order sees it. */
  'slip.noFabric': {
    run(ctx, { stuck }, doc) {
      Object.assign(doc, { noFabric: true, stuck: String(stuck || 'Fabric').trim(), stuckAt: ctx.now });
      doc.events = [...(doc.events || []), { at: ctx.now, stage: 'Stopped: missing', by: ctx.user.name, note: doc.stuck }];
      ctx.put('slips', doc); ctx.log('slips', doc.id, 'stopped', `Slip ${doc.no} stopped: missing ${doc.stuck}`);
      for (const to of holders(ctx, ['stores', 'runner', 'merch'])) ctx.notify(to, `Slip ${what(ctx, doc)} is stopped: missing ${short(doc.stuck)}`, link(doc));
      tellAsker(ctx, doc, `Your order ${what(ctx, doc)} is waiting for ${short(doc.stuck)}`);
      return { message: `Slip ${doc.no} is marked as missing ${doc.stuck}. Stores and merchandising have been told.` };
    },
  },
  'slip.fabricIn': {
    run(ctx, _p, doc) {
      if (!doc.noFabric) ctx.fail(`Slip ${doc.no} is not marked as missing anything.`);
      doc.events = [...(doc.events || []), { at: ctx.now, stage: 'Going again', by: ctx.user.name, note: `${doc.stuck} arrived` }];
      Object.assign(doc, { noFabric: false, stuck: '' });
      ctx.put('slips', doc); ctx.log('slips', doc.id, 'resumed', `Slip ${doc.no} can go again`);
      tellAsker(ctx, doc, `Your order ${what(ctx, doc)} is moving again`);
      return { message: `Slip ${doc.no} can go again.` };
    },
  },
  'slip.details': { run(ctx, { size, measurements }, doc) { Object.assign(doc, { size: size || doc.size, measurements, needsInfo: false }); ctx.put('slips', doc); ctx.log('slips', doc.id, 'updated', `Measurements added to slip ${doc.no}`); return { message: `Slip ${doc.no} has its measurements.` }; } },
  'slip.finish': { run(ctx, _p, doc) { stop(ctx, doc, 'finished', 'Finished'); return { message: `Slip ${doc.no} is finished.` }; } },
  'slip.pack': { run(ctx, _p, doc) { stop(ctx, doc, 'packed', 'Packed'); return { message: `Slip ${doc.no} is packed.` }; } },
  'slip.cancel': { run(ctx, { note }, doc) { stop(ctx, doc, 'cancelled', 'Cancelled', note); tellAsker(ctx, doc, `Your order ${what(ctx, doc)} was cancelled: ${short(note)}`); return { message: `Slip ${doc.no} is cancelled.` }; } },

  // ── Scans. One code, read by whoever holds the piece. ──
  /** A tailor scans the slip: the first scan starts the stitching, the next one finishes it. */
  'slip.scan': {
    module: 'production', level: 'scan',
    run(ctx, { code }) {
      const s = find(ctx, code);
      if (s.noFabric) ctx.fail(`Slip ${s.no} is stopped: missing ${s.stuck}. Tell the floor manager.`);
      if (['cut', 'assigned', 'rework'].includes(s.status)) {
        const again = s.status === 'rework';
        s.tailor = ctx.user.id;
        stop(ctx, s, 'stitching', again ? 'Rework started' : 'Stitching started');
        return { message: `Slip ${s.no} is yours. Scan it again when it is ${again ? 'put right' : 'stitched'}.`, data: { slip: s.id, no: s.no, status: 'stitching' } };
      }
      if (s.status === 'stitching') {
        if (s.tailor && s.tailor !== ctx.user.id && !ctx.can('production', 'write')) ctx.fail(`Slip ${s.no} was started by ${ctx.get('users', s.tailor)?.name || 'someone else'}. They scan it when it is done.`);
        stop(ctx, s, 'stitched', 'Stitched');
        return { message: `Slip ${s.no} is stitched. It goes to QC.`, data: { slip: s.id, no: s.no, status: 'stitched' } };
      }
      if (s.status === 'new') ctx.fail(`Slip ${s.no} has not been given to a master yet.`);
      ctx.fail(`Slip ${s.no} is ${s.status === 'stitched' ? 'already stitched and waiting for QC' : 'past stitching'}.`);
    },
  },
  /** QC scans the slip when the piece reaches the table. */
  'slip.qcIn': {
    module: ['quality', 'production'], level: 'scan',
    run(ctx, { code }) {
      const s = find(ctx, code);
      if (s.status === 'qc') return { message: `Slip ${s.no} is already at QC.`, data: { slip: s.id, no: s.no, status: 'qc' } };
      if (s.status !== 'stitched') ctx.fail(`Slip ${s.no} is ${s.status === 'stitching' ? 'still being stitched' : 'not ready for QC'}.`);
      stop(ctx, s, 'qc', 'Reached QC');
      return { message: `Slip ${s.no} is at QC.`, data: { slip: s.id, no: s.no, status: 'qc' } };
    },
  },
  /** QC's verdict: pass, back for rework (which step, and why), or rejected. */
  'slip.qc': {
    module: ['quality', 'production'], level: 'scan',
    run(ctx, { code, result, reason, note }) {
      const s = find(ctx, code);
      if (!['qc', 'stitched'].includes(s.status)) ctx.fail(`Slip ${s.no} is not at QC.`);
      if (!['pass', 'rework', 'fail'].includes(result)) ctx.fail('Choose pass, rework or reject.');
      if (result !== 'pass' && !REASON[reason]) ctx.fail('Choose the reason.');
      const first = !(s.reworks > 0) && !(s.events || []).some((e) => /^QC/.test(e.stage));
      if (result === 'pass') { s.qcReason = undefined; stop(ctx, s, 'passed', first ? 'QC passed first time' : 'QC passed', note); return { message: `Slip ${s.no} passed QC.`, data: { slip: s.id, no: s.no, status: 'passed' } }; }
      s.qcReason = reason;
      if (result === 'rework') {
        s.reworks = (s.reworks || 0) + 1;
        stop(ctx, s, 'rework', `QC sent back: ${REASON[reason].toLowerCase()}`, note);
        if (s.tailor) ctx.notify(s.tailor, `Slip ${s.no} is back for rework: ${REASON[reason].toLowerCase()}${note ? ` (${short(note)})` : ''}`, link(s));
      } else {
        stop(ctx, s, 'rejected', `QC rejected: ${REASON[reason].toLowerCase()}`, note);
        for (const to of holders(ctx, ['prod_b2b', 'prod_manager'])) ctx.notify(to, `Slip ${what(ctx, s)} was rejected at QC: ${REASON[reason].toLowerCase()}`, link(s));
      }
      tellAsker(ctx, s, `Your order ${what(ctx, s)} ${result === 'rework' ? 'went back for rework' : 'was rejected at QC'}: ${REASON[reason].toLowerCase()}`);
      return { message: result === 'rework' ? `Slip ${s.no} goes back for rework: ${REASON[reason].toLowerCase()}.` : `Slip ${s.no} is rejected: ${REASON[reason].toLowerCase()}.`, data: { slip: s.id, no: s.no, status: s.status } };
    },
  },

  // ── Placing an order without walking to the floor ──
  /** One form for the store, boutiques, shoots and influencer pieces. Makes one slip per piece. */
  'order.place': {
    module: 'projects', level: 'read',
    run(ctx, { kind, style, size, colour, measurements, qty = 1, priority = 'medium', priorityReason, purpose, promised }) {
      const st = ctx.get('styles', style) || ctx.fail('Choose the style.');
      qty = Number(qty); if (!Number.isInteger(qty) || qty < 1 || qty > 30) ctx.fail('Order between 1 and 30 pieces at a time.');
      if (!['store', 'boutique', 'shoot', 'influencer', 'customer'].includes(kind)) ctx.fail('Say what the order is for.');
      if (!['high', 'medium', 'low'].includes(priority)) ctx.fail('Choose a priority.');
      if (priority === 'high' && !String(priorityReason || '').trim()) ctx.fail('Say why this is high priority.');
      if (!promised || !/^\d{4}-\d{2}-\d{2}$/.test(promised)) ctx.fail('Give the date it is needed by.');
      const orderNo = `INT-${String(ctx.db.next('internal_orders')).padStart(4, '0')}`;
      const me = ctx.get('users', ctx.user.id) || ctx.user, made = [];
      for (let i = 0; i < qty; i++) made.push(ctx.put('slips', { source: 'internal', kind, orderNo, style: st.id, size: String(size || '').trim() || undefined, colour: String(colour || '').trim() || st.shade || undefined, measurements: String(measurements || '').trim() || undefined, priority, priorityReason: String(priorityReason || '').trim() || undefined, purpose: String(purpose || '').trim() || undefined, promised, raisedBy: ctx.user.id, team: me.centre || undefined, qty: 1, events: [{ at: ctx.now, stage: 'Ordered', by: ctx.user.name }] }));
      ctx.log('slips', made[0].id, 'created', `${ctx.user.name} ordered ${qty} × ${st.name} (${orderNo})`);
      for (const to of holders(ctx, ['prod_b2b', 'prod_manager'])) ctx.notify(to, `${ctx.user.name} ordered ${qty} × ${st.name}${priority === 'high' ? ', high priority' : ''}, needed ${promised}`, link(made[0]));
      return { message: `Order ${orderNo} is placed: ${qty} ${qty === 1 ? 'slip' : 'slips'}, ${made[0].no}${qty > 1 ? ` to ${made[qty - 1].no}` : ''}.`, data: { orderNo, slips: made.map((s) => ({ id: s.id, no: s.no })) } };
    },
  },

  // ── Online orders coming in ──
  /**
   * Take in online orders: from the Shopify connection, or pushed by another program with a service key.
   * A paid, unshipped order becomes one slip per piece. An order already shipped is kept for the record only.
   * `orders`: [{ orderNo, date, customerName, country, currency, amount, note, paid, shipped, channel, campaign,
   *              lines: [{ sku, title, variant, qty, notes }] }]
   */
  'shopify.ingest': {
    module: 'b2c', level: 'write',
    run(ctx, { orders }) {
      if (!Array.isArray(orders)) ctx.fail('Send the orders as a list.');
      if (orders.length > 500) ctx.fail('Send up to 500 orders at a time.');
      const have = new Map(ctx.all('shop_orders').map((o) => [String(o.orderNo).toLowerCase(), o]));
      let added = 0, slips = 0, held = 0, unmatched = 0;
      for (const o of orders) {
        const orderNo = String(o.orderNo || '').trim(); if (!orderNo) continue;
        const known = have.get(orderNo.toLowerCase());
        if (known) { if (o.shipped && ['new', 'in_production', 'packed'].includes(known.status)) ctx.setStatus('shop_orders', known, 'shipped'); continue; }
        const lines = (Array.isArray(o.lines) ? o.lines : []).filter((l) => l && (l.title || l.sku));
        const currency = CURRENCIES.includes(o.currency) ? o.currency : 'INR', amount = Number(o.amount) || 0, date = /^\d{4}-\d{2}-\d{2}/.test(String(o.date)) ? String(o.date).slice(0, 10) : ctx.today;
        const first = lines[0] && styleFor(ctx, lines[0]);
        const doc = ctx.put('shop_orders', { orderNo, date, customerName: String(o.customerName || '').trim().slice(0, 80) || undefined, country: String(o.country || '').trim().slice(0, 40) || undefined, style: first?.id, size: lines[0]?.variant || undefined, qty: lines.reduce((n, l) => n + (Number(l.qty) || 1), 0) || 1,
          currency, amount, amountInr: ctx.toInr(amount, currency, date) ?? undefined, channel: String(o.channel || '').slice(0, 40) || undefined, campaign: String(o.campaign || '').slice(0, 80) || undefined, items: lines.map((l) => `${Number(l.qty) || 1} × ${l.title || l.sku}${l.variant ? ` (${l.variant})` : ''}`).join('; ').slice(0, 400) || undefined, status: o.shipped ? 'shipped' : 'new' });
        have.set(orderNo.toLowerCase(), doc); added++;
        if (o.shipped || o.paid === false) continue;      // history, or not paid yet: no production
        for (const l of lines) {
          const st = styleFor(ctx, l); if (!st) unmatched++;
          const notes = [l.notes, o.note].map((x) => String(x || '').trim()).filter(Boolean).join('\n').slice(0, 1500);
          const needsInfo = !String(l.variant || '').trim() && !notes;
          for (let i = 0; i < Math.min(Number(l.qty) || 1, 30); i++) {
            ctx.put('slips', { source: 'shopify', kind: 'customer', orderNo, shopOrder: doc.id, customerName: doc.customerName, style: st?.id, styleName: st ? undefined : String(l.title || l.sku).slice(0, 120), size: String(l.variant || '').slice(0, 60) || undefined, colour: st?.shade || undefined, measurements: notes || undefined, priority: 'medium', promised: o.promised || undefined, needsInfo, qty: 1, events: [{ at: ctx.now, stage: 'Order received', by: 'Shopify' }] });
            slips++; if (needsInfo) held++;
          }
        }
        if (!o.shipped) ctx.setStatus('shop_orders', doc, 'in_production');
      }
      if (added) ctx.log('shop_orders', null, 'imported', `${added} online orders taken in, ${slips} slips made`);
      const parts = [`${added} new ${added === 1 ? 'order' : 'orders'}`, `${slips} ${slips === 1 ? 'slip' : 'slips'} made`];
      if (held) parts.push(`${held} held for measurements`); if (unmatched) parts.push(`${unmatched} with no matching style`);
      return { message: added ? `${parts.join(', ')}.` : 'Nothing new.', data: { added, slips, held, unmatched } };
    },
  },

  // ── What each channel costs and brings in ──
  /** Take in spend by day, channel and campaign. A line for the same day, channel and campaign replaces the old one. */
  'media.ingest': {
    module: 'marketing', level: 'write',
    run(ctx, { rows, from }) {
      if (!Array.isArray(rows)) ctx.fail('Send the days as a list.');
      if (rows.length > 2000) ctx.fail('Send up to 2,000 lines at a time.');
      const key = (r) => `${r.date}|${String(r.channel).toLowerCase()}|${String(r.campaign || '').toLowerCase()}`;
      const have = new Map(ctx.all('media_days').map((r) => [key(r), r]));
      const CH = ['Meta', 'Google', 'Email', 'Influencer', 'Affiliate', 'Other'];
      let added = 0, changed = 0;
      for (const r of rows) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(r.date))) ctx.fail(`A line has no date: ${short(JSON.stringify(r), 80)}`);
        const channel = CH.find((c) => same(c, r.channel)) || 'Other', currency = CURRENCIES.includes(r.currency) ? r.currency : 'INR', spend = Number(r.spend) || 0;
        const line = { date: r.date, channel, campaign: String(r.campaign || '').slice(0, 120), spend, currency, spendInr: ctx.toInr(spend, currency, r.date) ?? undefined, impressions: Number(r.impressions) || 0, clicks: Number(r.clicks) || 0, purchases: Number(r.purchases) || 0, revenue: Number(r.revenue) || 0, from: from || 'Import' };
        const old = have.get(key(line));
        if (old) { ctx.put('media_days', { ...old, ...line }); changed++; } else { have.set(key(line), ctx.put('media_days', line)); added++; }
      }
      ctx.log('media_days', null, 'imported', `Channel spend: ${added} days added, ${changed} updated`);
      return { message: `${added} ${added === 1 ? 'line' : 'lines'} added, ${changed} updated.`, data: { added, changed } };
    },
  },

  // ── A customer asks what is held about them, or asks for it to be removed ──
  /** Everything held about a customer, found by name or order number. Returned to be read out or handed over. */
  'privacy.find': {
    module: 'admin', level: 'admin',
    run(ctx, { q }) {
      const needle = String(q || '').trim().toLowerCase(); if (needle.length < 3) ctx.fail('Type at least three letters of the name, or the order number.');
      const hit = (d) => String(d.customerName || '').toLowerCase().includes(needle) || String(d.orderNo || '').toLowerCase() === needle;
      const orders = ctx.all('shop_orders').filter(hit), nos = new Set(orders.map((o) => o.orderNo));
      const slips = ctx.all('slips').filter((s) => hit(s) || nos.has(s.orderNo));
      const returns = ctx.all('returns').filter((r) => orders.some((o) => o.id === r.order));
      const parcels = ctx.all('parcels').filter((p) => nos.has(p.ref));
      ctx.log('shop_orders', null, 'privacy', `${ctx.user.name} looked up what is held on "${short(q, 40)}"`);
      return { message: `${orders.length} ${orders.length === 1 ? 'order' : 'orders'} and ${slips.length} ${slips.length === 1 ? 'slip' : 'slips'} found.`, data: { orders, slips, returns, parcels } };
    },
  },
  /** Remove a customer's personal details from their orders. The orders stay, for the accounts, without the person. */
  'privacy.erase': {
    module: 'admin', level: 'admin',
    run(ctx, { orderNos, reason }) {
      if (!Array.isArray(orderNos) || !orderNos.length) ctx.fail('Choose the orders.');
      if (!String(reason || '').trim()) ctx.fail('Record who asked and when.');
      const set = new Set(orderNos.map((n) => String(n).toLowerCase()));
      let n = 0;
      for (const o of ctx.all('shop_orders')) if (set.has(String(o.orderNo).toLowerCase())) { Object.assign(o, { customerName: 'Removed on request', erasedOn: ctx.today }); ctx.put('shop_orders', o); n++; }
      for (const s of ctx.all('slips')) if (set.has(String(s.orderNo).toLowerCase())) { Object.assign(s, { customerName: 'Removed on request', measurements: s.measurements ? 'Removed on request' : undefined }); ctx.put('slips', s); }
      for (const p of ctx.all('parcels')) if (set.has(String(p.ref).toLowerCase()) && p.dest) { p.dest = p.dest.split(',').pop().trim(); ctx.put('parcels', p); }
      ctx.log('shop_orders', null, 'privacy', `Personal details removed from ${n} ${n === 1 ? 'order' : 'orders'}: ${short(reason, 120)}`);
      return { message: `Personal details are removed from ${n} ${n === 1 ? 'order' : 'orders'} and their slips.`, data: { orders: n } };
    },
  },
  /** Remove customers' personal details from online orders older than a number of months: the routine that keeps old data from piling up. */
  'privacy.sweep': {
    module: 'admin', level: 'admin',
    run(ctx, { months = 36 }) {
      months = Number(months); if (!(months >= 6)) ctx.fail('Keep at least 6 months.');
      const cut = new Date(); cut.setMonth(cut.getMonth() - months); const before = cut.toISOString().slice(0, 10);
      const old = ctx.all('shop_orders').filter((o) => o.date && o.date < before && o.customerName && o.customerName !== 'Removed on request' && ['shipped', 'delivered', 'returned', 'cancelled'].includes(o.status));
      if (!old.length) return { message: `No finished order older than ${months} months still carries a name.`, data: { orders: 0 } };
      const nos = new Set(old.map((o) => String(o.orderNo).toLowerCase()));
      for (const o of old) { Object.assign(o, { customerName: 'Removed on request', erasedOn: ctx.today }); ctx.put('shop_orders', o); }
      for (const sl of ctx.all('slips')) if (nos.has(String(sl.orderNo).toLowerCase())) { Object.assign(sl, { customerName: 'Removed on request', measurements: sl.measurements ? 'Removed on request' : undefined }); ctx.put('slips', sl); }
      ctx.log('shop_orders', null, 'privacy', `Routine clean-up: personal details removed from ${old.length} orders older than ${months} months`);
      return { message: `Personal details are removed from ${old.length} ${old.length === 1 ? 'order' : 'orders'} older than ${months} months.`, data: { orders: old.length } };
    },
  },
};

/** When a parcel leaves, the slips of its order are dispatched and whoever asked is told. */
export function slipsDispatched(ctx, orderNo) {
  for (const s of ctx.all('slips')) if (same(s.orderNo, orderNo) && ['packed', 'finished', 'passed'].includes(s.status)) { stop(ctx, s, 'dispatched', 'Dispatched'); tellAsker(ctx, s, `Your order ${what(ctx, s)} has been dispatched`); }
}
