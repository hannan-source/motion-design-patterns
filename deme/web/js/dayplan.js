// Day plan: tomorrow's cutting, decided the evening before. The production head picks the day,
// sees which open orders really have fabric in the store, puts pieces on each master, and issues
// the plan. Issuing makes one bundle per line with exactly the cut quantity, so the fabric runner
// brings each master the fabric for the day and no slip goes out without fabric behind it.
// The fabric marks are worked out here in the same order the server does it (see fabricCheck in
// shared/floor.js) and confirmed by the server's own check before anything is issued.

import { api, data } from './api.js';
import { $, esc, info, toast, oops, busy, num } from './ui.js';
import { today, iso, isWorkday, addWorkdays, fmtDay, fmtDate } from '../shared/util.js';
import { barcodeSvg } from '../shared/code128.js';

const CHANNEL = { B2B: 'B2B', D2C: 'Shopify', STORE: 'Store', SAMPLE: 'Sample' };
const OPEN = ['planned', 'released', 'in_progress'];
const round = (n, dp = 2) => { const f = 10 ** dp; return Math.round(n * f) / f; };
const mt = (n) => num(round(Number(n) || 0, 2), 2);
const leftOn = (r) => (r.left ?? r.metres ?? 0);
const same = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();
const plural = (n, one, many = `${one}s`) => `${num(n)} ${n === 1 ? one : many}`;
const initials = (name) => String(name || '').trim().split(/\s+/).slice(-2).map((w) => w[0] || '').join('').toUpperCase();
const at = (s) => new Date(`${s}T00:00:00`);
const stepDay = (s, n) => { const d = at(s); do { d.setDate(d.getDate() + n); } while (!isWorkday(d)); return iso(d); };
const tomorrow = () => { const d = today(); d.setDate(d.getDate() + 1); return iso(addWorkdays(d, 0)); };
const weekOf = (s) => { const d = at(s); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return Array.from({ length: 6 }, (_, i) => { const x = new Date(d); x.setDate(d.getDate() + i); return iso(x); }); };
const CHECK = '<svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M2.4 6.4l2.4 2.4 4.8-5.4" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ARROW = (dir) => `<svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="${dir < 0 ? 'M7.5 2.5L4 6l3.5 3.5' : 'M4.5 2.5L8 6 4.5 9.5'}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

// Fabric that can go to the cutting table, and whether a roll suits a style (as the server decides it).
const cuttable = (r) => ['dyed', 'passed'].includes(r.status) && !r.heldAt && leftOn(r) > 0;
const suits = (roll, style, woId) => roll.item === style.fabric && (!roll.reservedFor || roll.reservedFor === woId) && (style.shade ? roll.status === 'dyed' && same(roll.shade, style.shade) : true);

/** The fabric check, line by line in plan order, each ready line taking its metres off the rolls before the next is looked at. */
function preview(lines) {
  const free = data.all('rolls').filter(cuttable).map((r) => ({ roll: r, left: leftOn(r) }));
  const planned = {};
  const rows = lines.map((line) => {
    const row = { need: 0, have: 0, ok: '', bad: '', fit: 0, room: 0 };
    const wo = data.get('work_orders', line.workOrder);
    if (!wo) { row.bad = 'Order is gone'; return row; }
    if (wo.madeBy === 'vendor') { row.bad = 'Made by a vendor'; return row; }
    if (['done', 'hold'].includes(wo.status)) { row.bad = wo.status === 'done' ? 'Order is finished' : 'Order is on hold'; return row; }
    row.room = wo.qty - (wo.cut || 0) - (planned[wo.id] || 0);
    planned[wo.id] = (planned[wo.id] || 0) + line.pieces;
    if (line.pieces > row.room) { row.bad = row.room > 0 ? `Only ${num(row.room)} left to cut` : 'Nothing left to cut'; return row; }
    const style = data.get('styles', wo.style);
    if (!style?.fabric || !(style.metres > 0)) { row.ok = 'No fabric per piece on the style'; return row; }
    row.need = round(line.pieces * style.metres, 1);
    const usable = free.filter((f) => f.left > 0 && suits(f.roll, style, wo.id));
    row.have = round(usable.reduce((s, f) => s + f.left, 0), 1);
    if (row.have + 1e-6 < row.need) {
      row.ok = `Short by ${mt(row.need - row.have)} m`;
      let fit = Math.floor((row.have + 1e-6) / style.metres);
      while (fit > 0 && round(fit * style.metres, 1) > row.have + 1e-6) fit--;
      row.fit = fit;
      return row;
    }
    let want = row.need;
    for (const f of usable) { const t = Math.min(f.left, want); if (t <= 0) continue; f.left = round(f.left - t, 2); want = round(want - t, 2); if (want <= 0) break; }
    row.ok = 'Ready';
    return row;
  });
  rows.free = free;   // what is left on each roll once the ready lines have taken theirs
  return rows;
}

export function mount(el, ctx) {
  el.innerHTML = `<div class="workspace dayplan"><div class="workspace-inner" id="dpRoot">
    <div class="view-head"><div class="title-row"><h1 class="reveal">Day plan</h1>${info('Decide the cutting for a day the evening before. Put pieces of an order on a master: the mark on each line shows at once whether the fabric is really in the store. Issue the plan and each line with fabric becomes a bundle of exactly that many pieces, with its metres set aside from named rolls. The fabric runner gets the bundling list; lines without fabric stay back.', 'Day plan')}</div><div class="dp-when" id="dpWhen"></div></div>
    <div class="dp-body" id="dpBody"></div></div></div>`;
  const root = $('#dpRoot', el), body = $('#dpBody', root), when = $('#dpWhen', root);
  const canEdit = data.canWrite('day_plans');
  const plansOn = (date) => data.all('day_plans').filter((p) => p.date === date).sort((a, b) => String(a.no).localeCompare(String(b.no), undefined, { numeric: true }));
  const pickPlan = (date) => { const ps = plansOn(date); return ps.find((p) => p.status === 'draft') || ps[ps.length - 1] || null; };
  const startDate = () => { const d = /^\d{4}-\d\d-\d\d$/.test(ctx.opts?.date || '') ? ctx.opts.date : tomorrow(); return iso(addWorkdays(at(d), 0)); };

  // `cx` is the plan being looked at: a day and, once it exists on the server, its id.
  const st = { cx: null, lines: [], lanes: [], give: null, confirm: null, newMaster: '', giveNew: '', dirty: false, saving: 0, saveErr: '', drag: null, focus: '' };
  const lanesKept = new Map();   // masters added on a day, kept while the screen is open even before they have a line
  let seq = 0, timer = 0, saveP = Promise.resolve(), gone = false, stopPrint = null, painting = false, down = false, later = false;
  // A redraw that comes from a save or from someone else's change waits while a button is being pressed, so the press is not lost.
  const refresh = () => { if (down) later = true; else if (!gone) render(); };
  const onUp = () => { down = false; if (later) { later = false; setTimeout(refresh, 0); } };

  const plan = () => (st.cx.id ? data.get('day_plans', st.cx.id) : null);
  const lane = (name) => st.lanes.find((m) => same(m, name));
  const addLane = (name) => { const n = String(name || '').trim().replace(/\s+/g, ' '); if (!n) return ''; const have = lane(n); if (have) return have; st.lanes.push(n); return n; };
  function open(date, id) {
    if (st.cx) lanesKept.set(st.cx.date, st.lanes);
    const p = id ? data.get('day_plans', id) : id === null ? null : pickPlan(date);
    st.cx = { date, id: p?.id || null, fresh: id === null };
    Object.assign(st, { lines: [], lanes: [...(lanesKept.get(date) || [])], give: null, confirm: null, dirty: false, saveErr: '', drag: null });
    load();
  }
  /** Take the lines from the saved draft, unless they already match what is on screen. */
  function load() {
    const p = plan();
    const saved = p && p.status === 'draft' ? (p.lines || []) : [];
    const match = saved.length === st.lines.length && saved.every((l, i) => l.workOrder === st.lines[i].workOrder && same(l.master, st.lines[i].master) && l.pieces === st.lines[i].pieces);
    if (!match) st.lines = saved.map((l) => ({ key: ++seq, workOrder: l.workOrder, master: String(l.master || '').trim(), pieces: l.pieces }));
    for (const l of st.lines) l.master = addLane(l.master) || l.master;
  }
  /** Names used on earlier plans and bundles: masters do not use the system, so this is the only list of them. */
  function known() {
    const seen = new Map();
    const add = (n) => { const s = String(n || '').trim(); if (s && !seen.has(s.toLowerCase())) seen.set(s.toLowerCase(), s); };
    for (const p of data.all('day_plans')) for (const l of p.lines || []) add(l.master);
    for (const b of data.all('bundles')) add(b.master);
    return [...seen.values()].filter((n) => !lane(n)).sort((a, b) => a.localeCompare(b));
  }

  // ── Saving: create the draft on the first line, then update, a little after the last change ──
  function touch() { st.dirty = true; st.confirm = null; clearTimeout(timer); timer = setTimeout(save, 700); }
  function save() {
    clearTimeout(timer);
    if (!st.dirty || !canEdit) return saveP;
    const cx = st.cx, lines = st.lines.map((l) => ({ workOrder: l.workOrder, master: l.master, pieces: l.pieces }));
    st.dirty = false; st.saving++;
    saveP = saveP.then(async () => {
      try {
        if (!lines.length) {
          // A plan cannot be saved with no lines: an admin's empty draft is removed, anyone else's keeps its last line.
          if (cx.id && data.can('production', 'admin')) { await api.remove('day_plans', cx.id); cx.id = null; }
          else if (cx.id && cx === st.cx) { st.dirty = true; st.saveErr = 'The last line stays saved'; return; }
        } else if (!cx.id) cx.id = (await api.create('day_plans', { date: cx.date, lines })).doc.id;
        else await api.update('day_plans', cx.id, { date: cx.date, lines });
        if (cx === st.cx) st.saveErr = '';
      } catch (e) { if (cx === st.cx) { st.dirty = true; st.saveErr = 'Not saved'; } oops(e); }
    }).finally(() => { st.saving--; refresh(); });
    return saveP;
  }

  // ── What the screen shows, worked out from the cache and the lines on screen ──
  function model() {
    const rows = preview(st.lines), onPlan = {};
    for (const l of st.lines) onPlan[l.workOrder] = (onPlan[l.workOrder] || 0) + l.pieces;
    const rolls = data.all('rolls'), T = iso(today()), bundled = {};
    for (const b of data.all('bundles')) if (b.plan) bundled[b.workOrder] = (bundled[b.workOrder] || 0) + (b.pieces || 0);
    const orders = data.all('work_orders').filter((w) => w.madeBy !== 'vendor' && OPEN.includes(w.status) && (w.cut || 0) < w.qty)
      .sort((a, b) => String(a.due || '9').localeCompare(String(b.due || '9')) || String(a.no).localeCompare(String(b.no), undefined, { numeric: true }))
      .map((wo) => {
        const style = data.get('styles', wo.style), left = wo.qty - (wo.cut || 0), planned = onPlan[wo.id] || 0;
        // Pieces issued to masters on earlier plans that the floor has not yet recorded as cut.
        const out = Math.max(0, Math.min(left, (bundled[wo.id] || 0) - (wo.cut || 0)));
        const o = { wo, style, left, planned, out, rest: Math.max(0, left - planned), need: 0, have: 0, after: 0, coming: 0, covers: 0, state: 'nostyle', late: !!wo.due && wo.due < T };
        if (!style?.fabric || !(style.metres > 0)) return o;
        o.need = round(left * style.metres, 1);
        o.have = round(rolls.filter((r) => cuttable(r) && suits(r, style, wo.id)).reduce((s, r) => s + leftOn(r), 0), 1);
        o.after = round(rows.free.filter((f) => suits(f.roll, style, wo.id)).reduce((s, f) => s + f.left, 0), 1);
        // Fabric of this kind that exists but cannot be cut yet: not checked, at the dye house, or waiting to be dyed.
        o.coming = round(rolls.filter((r) => r.item === style.fabric && !(cuttable(r) && suits(r, style, wo.id)) && (['received', 'at_dyer'].includes(r.status) || (r.status === 'passed' && (r.heldAt || style.shade)))).reduce((s, r) => s + leftOn(r), 0), 1);
        o.covers = Math.min(left, Math.floor((o.have + 1e-6) / style.metres));
        o.state = o.covers >= left ? 'ok' : o.covers >= 1 ? 'part' : 'none';
        return o;
      });
    const ready = rows.filter((r) => r.ok === 'Ready').length, bad = rows.filter((r) => r.bad).length;
    return { rows, orders, ready, bad, short: rows.length - ready - bad, metres: round(rows.filter((r) => r.ok === 'Ready').reduce((s, r) => s + r.need, 0), 1) };
  }
  const orderOf = (M, id) => M.orders.find((o) => o.wo.id === id);
  const styleLine = (wo) => { const s = data.get('styles', wo?.style); return s ? { name: s.name, sub: [s.code, s.shade].filter(Boolean).join(' · ') } : { name: 'No style', sub: '' }; };
  const mark = (row) => (row.bad ? { cls: 'bad', tag: `<span class="tag tag-warn">${esc(row.bad)}</span>`, icon: '!' } : row.ok === 'Ready' ? { cls: 'ok', tag: '<span class="tag tag-ok">Ready</span>', icon: CHECK } : { cls: 'short', tag: `<span class="tag tag-crit">${esc(row.ok === 'No fabric per piece on the style' ? 'No metres on the style' : row.ok)}</span>`, icon: '!' });
  const stepper = (value, attrs, minus, plus, label) => `<span class="dp-step"><button type="button" ${minus} aria-label="Fewer pieces">−</button><input type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" ${attrs} value="${esc(value)}" aria-label="${esc(label)}"><button type="button" ${plus} aria-label="More pieces">+</button></span>`;

  // ── Pick the day ──
  function daysHtml() {
    const T = iso(today());
    return `<nav class="dp-days" aria-label="Day">
      <button type="button" class="icon-btn" data-step="-1" data-fk="step-1" aria-label="Day before">${ARROW(-1)}</button>
      <div class="dp-week">${weekOf(st.cx.date).map((d) => {
        const ps = plansOn(d), draft = ps.some((p) => p.status === 'draft'), issued = ps.some((p) => p.status === 'issued');
        return `<button type="button" class="dp-day ${d === T ? 'is-today' : ''}" data-day="${d}" data-fk="day-${d}" aria-pressed="${d === st.cx.date}" aria-label="${esc(fmtDay(at(d)))}: ${draft ? 'draft' : issued ? 'issued' : 'nothing planned'}"><span class="dp-dow">${esc(fmtDay(at(d)).slice(0, 3))}</span><span class="dp-dnum">${at(d).getDate()}</span><span class="dp-dots">${issued ? '<i class="is-issued"></i>' : ''}${draft ? '<i class="is-draft"></i>' : ''}${!issued && !draft ? '<i></i>' : ''}</span></button>`;
      }).join('')}</div>
      <button type="button" class="icon-btn" data-step="1" data-fk="step1" aria-label="Day after">${ARROW(1)}</button>
    </nav>`;
  }
  function whenHtml() {
    const p = plan(), T = iso(today()), d = st.cx.date;
    const rel = d === T ? 'Today' : d === tomorrow() ? 'Tomorrow' : d < T ? 'Past day' : 'Coming up';
    const state = p?.status === 'issued' ? `<span class="tag tag-ok">Issued ${esc(p.no)}</span>` : p ? `<span class="tag tag-info">Draft ${esc(p.no)}</span>` : st.lines.length ? '<span class="tag tag-info">Draft</span>' : '<span class="tag tag-plain">Nothing planned</span>';
    return `<div><p class="eyebrow">${rel}</p><p class="dp-date">${esc(fmtDay(at(d)))}</p></div>${state}${d !== tomorrow() ? '<button type="button" class="btn btn-sm btn-quiet" data-tomorrow data-fk="tomorrow">Tomorrow</button>' : ''}`;
  }
  function switchHtml() {
    const ps = plansOn(st.cx.date);
    if (ps.length + (st.cx.id ? 0 : 1) < 2) return '';
    return `<div class="seg dp-switch" role="group" aria-label="Plans for this day">${ps.map((p) => `<button type="button" data-plan="${p.id}" data-fk="plan-${p.id}" aria-pressed="${p.id === st.cx.id}">${esc(p.no)} · ${p.status === 'issued' ? 'Issued' : 'Draft'}</button>`).join('')}${st.cx.id ? '' : '<button type="button" aria-pressed="true" data-fk="plan-new">New plan</button>'}</div>`;
  }

  // ── What could be cut ──
  function cardHtml(o, M) {
    const { wo } = o, s = styleLine(wo), picked = st.give?.wo === wo.id, off = o.state === 'none' || o.state === 'nostyle', full = o.rest < 1;
    const cut = wo.qty ? ((wo.cut || 0) / wo.qty) * 100 : 0, pl = wo.qty ? ((wo.cut || 0) + Math.min(o.planned, o.left)) / wo.qty * 100 : 0;
    const gauge = o.state === 'nostyle' ? 'No fabric per piece on the style' : `${mt(o.have)} m in store, ${mt(o.need)} m needed`;
    const who = [CHANNEL[wo.channel] || wo.channel, data.title('customers', wo.customer)].filter(Boolean).join(' · ');
    return `<li class="dp-card is-${o.state} ${picked ? 'is-picked' : ''} ${full ? 'is-full' : ''}" ${canEdit && !off && !full ? `draggable="true" data-drag-wo="${wo.id}"` : ''}>
      <button type="button" class="dp-card-main" data-pick="${wo.id}" data-fk="pick-${wo.id}" ${canEdit ? `aria-expanded="${picked}"` : ''} ${off || full ? 'aria-disabled="true"' : ''}>
        <span class="dp-card-top"><strong class="mono">${esc(wo.no)}</strong><span class="dp-due ${o.late ? 'is-late' : ''}">${wo.due ? `${o.late ? 'Late · ' : 'Due '}${esc(fmtDate(at(wo.due)))}` : 'No due date'}</span></span>
        <span class="dp-card-style">${esc(s.name)}${s.sub ? ` <small>${esc(s.sub)}</small>` : ''}</span>
        ${who ? `<span class="dp-card-for">${esc(who)}</span>` : ''}
        <span class="dp-pieces"><b>${num(o.left)}</b><span>to cut${wo.cut ? ` of ${num(wo.qty)}` : ''}</span>${o.planned || o.out ? `<em>${[o.out ? `${num(o.out)} with masters` : '', o.planned ? `${num(o.planned)} on this plan` : ''].filter(Boolean).join(' · ')}</em>` : ''}</span>
        <span class="dp-split" style="--cut:${cut.toFixed(1)}%;--plan:${pl.toFixed(1)}%" aria-hidden="true"></span>
        <span class="dp-gauge" role="img" aria-label="${esc(gauge)}"><i class="dp-gauge-all" style="--v:${o.need > 0 ? Math.min(100, (o.have / o.need) * 100).toFixed(1) : 0}%"></i><i style="--v:${o.need > 0 ? Math.min(100, (o.after / o.need) * 100).toFixed(1) : 0}%"></i></span>
        <span class="dp-gauge-text">${o.state === 'nostyle' ? 'No fabric per piece on the style' : o.state === 'none' ? `<b>No fabric in the store</b> · needs ${mt(o.need)} m` : `<b>${mt(o.have)} m</b> in store · needs ${mt(o.need)} m${o.state === 'part' ? ` · enough for ${num(o.covers)}` : ''}`}${o.have - o.after > 0.05 ? `<small>${mt(o.have - o.after)} m of it is on this plan, ${mt(o.after)} m free</small>` : ''}${o.coming > 0 && o.state !== 'ok' ? `<small>${mt(o.coming)} m not ready to cut yet</small>` : ''}</span>
      </button>
      ${o.state === 'nostyle' && data.canWrite('styles') && o.style ? `<div class="dp-card-fix"><button type="button" class="btn btn-sm btn-outline" data-style="${o.style.id}" data-fk="style-${wo.id}">Open the style</button></div>` : ''}
      ${picked && canEdit ? giveHtml(o, M) : ''}
    </li>`;
  }
  function giveHtml(o) {
    const sugg = known().slice(0, 5);
    return `<div class="dp-give">
      <div class="dp-give-n"><span class="eyebrow">Pieces</span>${stepper(st.give.pieces, 'id="dpGivePcs" data-fk="give-pcs"', 'data-give-step="-1" data-fk="give-dec"', 'data-give-step="1" data-fk="give-inc"', `Pieces of ${o.wo.no}`)}<span class="faint">of ${num(o.rest)} not planned</span></div>
      <div class="dp-give-to"><span class="eyebrow">Give to</span><div class="dp-chips">${st.lanes.map((m) => `<button type="button" class="chip" data-give="${esc(m)}" data-fk="give-${esc(m)}">${esc(m)}</button>`).join('')}${sugg.map((m) => `<button type="button" class="chip dp-chip-new" data-give="${esc(m)}" data-fk="give-${esc(m)}">${esc(m)}</button>`).join('')}</div>
      <form class="dp-add" data-form="give-new"><input class="input" type="text" data-fk="give-new" list="dpKnown" autocomplete="off" placeholder="New master" aria-label="New master's name" value="${esc(st.giveNew)}"><button class="btn btn-sm btn-outline" type="submit" data-fk="give-new-go">Give</button></form></div>
    </div>`;
  }

  // ── One lane per master ──
  function laneHtml(name, M) {
    const mine = st.lines.map((l, i) => ({ l, row: M.rows[i] })).filter(({ l }) => same(l.master, name));
    const pcs = mine.reduce((s, x) => s + x.l.pieces, 0), need = mine.reduce((s, x) => s + x.row.need, 0), ok = mine.filter((x) => x.row.ok === 'Ready').reduce((s, x) => s + x.row.need, 0);
    const g = st.give && orderOf(M, st.give.wo);
    return `<section class="dp-lane ${st.drag ? 'is-target' : ''}" data-lane="${esc(name)}" aria-label="${esc(name)}">
      <header><span class="av" style="--av:32px" aria-hidden="true">${esc(initials(name))}</span><div><strong>${esc(name)}</strong><span class="faint">${mine.length ? `${plural(mine.length, 'line')} · ${num(pcs)} pcs · ${mt(need)} m` : 'Nothing yet'}</span></div>${mine.length || !canEdit ? '' : `<button type="button" class="dp-x" data-lane-del="${esc(name)}" data-fk="lanedel-${esc(name)}" aria-label="Remove ${esc(name)}">×</button>`}</header>
      ${mine.length ? `<div class="dp-lanebar" role="img" aria-label="${mt(ok)} of ${mt(need)} m has fabric"><i style="--v:${need > 0 ? ((ok / need) * 100).toFixed(1) : 0}%"></i></div>` : ''}
      <ul class="dp-lines">${mine.map(({ l, row }) => lineHtml(l, row)).join('')}</ul>
      ${g && canEdit && g.rest > 0 ? `<button type="button" class="dp-drop" data-give="${esc(name)}" data-fk="drop-${esc(name)}">Put ${esc(g.wo.no)} here</button>` : ''}
    </section>`;
  }
  function lineHtml(l, row) {
    const wo = data.get('work_orders', l.workOrder), s = styleLine(wo), k = mark(row), no = wo?.no || 'Order';
    return `<li class="dp-line is-${k.cls}">
      <div class="dp-line-head" ${canEdit ? `draggable="true" data-drag-line="${l.key}"` : ''}><span class="dp-mark" aria-hidden="true">${k.icon}</span><div><strong class="mono">${esc(no)}</strong><span>${esc(s.name)}${s.sub ? ` · ${esc(s.sub)}` : ''}</span></div>${canEdit ? `<button type="button" class="dp-x" data-del="${l.key}" data-fk="del-${l.key}" aria-label="Take ${esc(no)} off ${esc(l.master)}">×</button>` : ''}</div>
      <div class="dp-line-body">${canEdit ? stepper(l.raw ?? l.pieces, `data-pcs="${l.key}" data-fk="pcs-${l.key}" ${l.raw !== undefined ? 'aria-invalid="true"' : ''}`, `data-dec="${l.key}" data-fk="dec-${l.key}"`, `data-inc="${l.key}" data-fk="inc-${l.key}"`, `Pieces of ${no} for ${l.master}`) : `<b class="num">${num(l.pieces)}</b>`}<span class="dp-unit">pcs</span><span class="dp-need num">${row.need ? `${mt(row.need)} m` : ''}</span>${k.tag}</div>
      ${canEdit && row.fit > 0 ? `<button type="button" class="link dp-fit" data-fit="${l.key}" data-n="${row.fit}" data-fk="fit-${l.key}">Cut ${num(row.fit)}: the fabric covers that</button>` : ''}
    </li>`;
  }

  // ── Fabric check total, and issuing ──
  function barHtml(M) {
    if (st.confirm) {
      const c = st.confirm;
      return `<div class="dp-bar is-confirm" role="alertdialog" aria-labelledby="dpConfH">
        <div class="dp-conf"><p class="eyebrow">Issue the plan for ${esc(fmtDay(at(st.cx.date)))}</p><p class="dp-big" id="dpConfH">${plural(c.ready.length, 'bundle')} · ${mt(c.metres)} m set aside</p>
        <p class="muted">${c.ready.length === 1 ? 'The bundle is' : 'Each bundle is'} tagged with its rolls. The fabric runner is told. The plan can no longer be changed.</p>
        ${c.back.length ? `<p class="dp-stay-h"><span class="dp-mark" aria-hidden="true">!</span>${plural(c.back.length, 'line stays', 'lines stay')} back: no fabric</p><ul class="dp-stay">${c.back.map((r) => `<li><strong class="mono">${esc(data.title('work_orders', r.workOrder))}</strong><span>${esc(r.master)} · ${num(r.pieces)} pcs</span><span class="tag tag-crit">${esc(r.ok)}</span></li>`).join('')}</ul>` : ''}</div>
        <div class="row"><button type="button" class="btn btn-primary" data-issue-go data-fk="issue-go">Issue ${plural(c.ready.length, 'bundle')}</button><button type="button" class="btn btn-quiet" data-issue-back data-fk="issue-back">Back to the plan</button></div>
      </div>`;
    }
    const saveText = st.saving ? 'Saving' : st.saveErr || (st.dirty ? 'Saving' : st.cx.id ? 'Saved' : '');
    const why = M.bad ? 'Fix the marked line first' : !M.ready ? 'No line has fabric' : '';
    return `<div class="dp-bar" role="region" aria-label="Fabric check">
      <div class="dp-tally" aria-live="polite"><span class="dp-n is-ok"><b>${num(M.ready)}</b>${M.ready === 1 ? 'line' : 'lines'} with fabric</span><span class="dp-n ${M.short ? 'is-short' : ''}"><b>${num(M.short)}</b>without</span>${M.bad ? `<span class="dp-n is-bad"><b>${num(M.bad)}</b>to fix</span>` : ''}<span class="dp-n"><b>${mt(M.metres)} m</b>to set aside</span></div>
      ${info('The marks are worked out line by line, in the order the lines were added: each ready line takes its metres off the rolls before the next is checked, so two orders never count the same fabric. Issue plan asks the store once more before anything is set aside.', 'Fabric check')}
      <span class="dp-save ${st.saveErr ? 'is-err' : ''}" role="status">${esc(saveText)}</span>
      <button type="button" class="btn btn-primary" data-issue data-fk="issue" ${why ? 'disabled' : ''}>Issue plan</button>${why ? `<span class="dp-why">${why}</span>` : ''}
    </div>`;
  }

  function builderHtml() {
    const M = model(), sugg = known().slice(0, 6), past = st.cx.date < iso(today());
    if (!canEdit || (past && !st.lines.length && !st.cx.id)) return `<section class="panel empty"><h3>${past ? 'Nothing was planned for this day' : 'Nothing is planned for this day'}</h3>${canEdit ? '<button type="button" class="btn btn-primary" data-tomorrow data-fk="tomorrow2">Plan tomorrow</button>' : ''}</section>`;
    const orders = M.orders.length ? `<ul class="dp-cards">${M.orders.map((o) => cardHtml(o, M)).join('')}</ul>` : `<div class="panel empty"><h3>No work orders to cut</h3><p>Every in-house order is cut, on hold or with a vendor.</p><button type="button" class="btn btn-primary" data-go="m-production" data-fk="go-prod">Open Production</button></div>`;
    const lanes = st.lanes.length ? `<div class="dp-lanes">${st.lanes.map((m) => laneHtml(m, M)).join('')}</div>` : `<div class="panel empty dp-nolanes"><h3>No masters on this plan yet</h3><button type="button" class="btn btn-primary" data-focus-master data-fk="focus-master">Add a master</button>${sugg.length ? `<div class="dp-chips">${sugg.map((m) => `<button type="button" class="chip dp-chip-new" data-add-master="${esc(m)}" data-fk="sugg-${esc(m)}">${esc(m)}</button>`).join('')}</div>` : ''}</div>`;
    return `<div class="dp-build">
      <section class="dp-orders" aria-labelledby="dpOrdH">
        <header class="dp-head"><div class="title-row"><h2 id="dpOrdH">To cut</h2>${info('In-house work orders with pieces still to cut, soonest due first. The gauge is the fabric in the store for that style against what the rest of the order needs: green covers it, amber covers part, red has none. Pick an order, set the pieces and give it to a master, or drag it onto a master. An order with no fabric cannot go on the plan. "With masters" counts pieces issued on an earlier plan that are not recorded as cut yet.', 'To cut')}</div><span class="faint">${plural(M.orders.length, 'order')}</span></header>
        ${orders}
      </section>
      <section class="dp-board" aria-labelledby="dpLaneH">
        <header class="dp-head"><div class="title-row"><h2 id="dpLaneH">Masters</h2>${info('One lane per master. Type a name to add one; names used on earlier plans are offered. The same order can be split across masters. Change the pieces on a line or take it off; drag a line to move it to another master. Everything is saved as you go.', 'Masters')}</div>
          <form class="dp-add" data-form="master"><input class="input" type="text" id="dpMaster" data-fk="master" list="dpKnown" autocomplete="off" placeholder="Master's name" aria-label="Master's name" value="${esc(st.newMaster)}"><button class="btn btn-sm btn-outline" type="submit" data-fk="master-go">Add master</button></form></header>
        ${st.lanes.length && sugg.length ? `<div class="dp-chips dp-sugg">${sugg.map((m) => `<button type="button" class="chip dp-chip-new" data-add-master="${esc(m)}" data-fk="sugg-${esc(m)}">${esc(m)}</button>`).join('')}</div>` : ''}
        ${lanes}
      </section>
    </div>
    <datalist id="dpKnown">${known().map((m) => `<option value="${esc(m)}"></option>`).join('')}</datalist>
    ${st.lines.length ? barHtml(M) : ''}`;
  }

  // ── After issuing: the bundling list ──
  const bundlesOf = (p) => data.all('bundles').filter((b) => b.plan === p.id).sort((a, b) => String(a.no).localeCompare(String(b.no), undefined, { numeric: true }));
  const byMaster = (list) => { const g = new Map(); for (const b of list) { const k = [...g.keys()].find((m) => same(m, b.master)) || b.master || 'No master'; g.set(k, [...(g.get(k) || []), b]); } return [...g]; };
  const rollsOf = (b) => String(b.fromRolls || '').split(/,\s*/).filter(Boolean);
  function issuedHtml(p) {
    const bs = bundlesOf(p), back = (p.check || []).filter((r) => r.ok !== 'Ready');
    const pcs = bs.reduce((s, b) => s + (b.pieces || 0), 0), metres = bs.reduce((s, b) => s + (b.metres || 0), 0);
    return `<div class="kpis"><div class="kpi" data-state="ok"><div class="kpi-label">Bundles</div><div class="kpi-value">${num(bs.length)}</div></div><div class="kpi"><div class="kpi-label">Pieces</div><div class="kpi-value">${num(pcs)}</div></div><div class="kpi"><div class="kpi-label">Fabric set aside</div><div class="kpi-value">${mt(metres)} m</div></div><div class="kpi" ${back.length ? 'data-state="crit"' : ''}><div class="kpi-label">Stayed back</div><div class="kpi-value">${num(back.length)}</div>${p.planner ? `<div class="kpi-note">Issued by ${esc(data.title('users', p.planner))}</div>` : ''}</div></div>
      <section aria-labelledby="dpListH" class="dp-issued">
        <header class="dp-head"><div class="title-row"><h2 id="dpListH">Bundling list</h2>${info('One bundle per line that had fabric. The fabric runner cuts each bundle\'s metres from the rolls named on it and hands it to the master with its slip. The barcode on the slip is the bundle tag: the scan station reads it when stitching starts and ends. An issued plan cannot be changed.', 'Bundling list')}</div>
          <div class="row">${bs.length ? '<button type="button" class="btn btn-primary btn-sm" data-print="list" data-fk="print-list">Print bundling list</button><button type="button" class="btn btn-outline btn-sm" data-print="slips" data-fk="print-slips">Print slips</button>' : ''}${canEdit ? '<button type="button" class="btn btn-quiet btn-sm" data-more data-fk="more">Plan more for this day</button>' : ''}</div></header>
        ${bs.length ? `<div class="dp-lanes">${byMaster(bs).map(([m, list]) => `<section class="dp-lane" aria-label="${esc(m)}">
          <header><span class="av" style="--av:32px" aria-hidden="true">${esc(initials(m))}</span><div><strong>${esc(m)}</strong><span class="faint">${plural(list.length, 'bundle')} · ${num(list.reduce((s, b) => s + (b.pieces || 0), 0))} pcs · ${mt(list.reduce((s, b) => s + (b.metres || 0), 0))} m</span></div></header>
          <ul class="dp-lines">${list.map((b) => { const wo = data.get('work_orders', b.workOrder), s = styleLine(wo); return `<li class="dp-line dp-bundle is-ok"><div class="dp-line-head"><span class="dp-mark" aria-hidden="true">${CHECK}</span><div><strong class="mono dp-tagno">${esc(b.no)}</strong><span>${esc(s.name)}${s.sub ? ` · ${esc(s.sub)}` : ''}</span></div></div><div class="dp-line-body"><span class="dp-fig"><b>${num(b.pieces)}</b>pcs</span><span class="dp-fig"><b>${mt(b.metres)}</b>m</span><span class="faint mono">${esc(wo?.no || '')}${wo?.due ? ` · due ${esc(fmtDate(at(wo.due)))}` : ''}</span></div><div class="dp-rolls"><span class="eyebrow">From</span>${rollsOf(b).map((r) => `<span class="dp-roll">${esc(r)}</span>`).join('') || '<span class="faint">No rolls named</span>'}</div></li>`; }).join('')}</ul>
        </section>`).join('')}</div>` : '<div class="panel empty"><h3>No bundles on this plan</h3></div>'}
      </section>
      ${back.length ? `<section aria-labelledby="dpBackH" class="dp-back"><header class="dp-head"><div class="title-row"><h2 id="dpBackH">Stayed back</h2>${info('These lines had no fabric in the store when the plan was issued, so no slip went out for them. Plan them again once the fabric is in.', 'Stayed back')}</div><span class="tag tag-crit">${back.length}</span></header><ul class="dp-stay">${back.map((r) => `<li><strong class="mono">${esc(data.title('work_orders', r.workOrder))}</strong><span>${esc(styleLine(data.get('work_orders', r.workOrder)).name)} · ${esc(r.master)} · ${num(r.pieces)} pcs</span><span class="tag tag-crit">${esc(r.ok)}</span></li>`).join('')}</ul></section>` : ''}`;
  }

  // ── Print-outs: the runner's list, and one slip per bundle for the master ──
  function listSheet(p) {
    const bs = bundlesOf(p), back = (p.check || []).filter((r) => r.ok !== 'Ready');
    return `<div class="dp-sheet"><header><h1>Bundling list</h1><p>${esc(fmtDay(at(p.date)))} ${at(p.date).getFullYear()} · ${esc(p.no)} · ${plural(bs.length, 'bundle')} · ${mt(bs.reduce((s, b) => s + (b.metres || 0), 0))} m</p></header>
      ${byMaster(bs).map(([m, list]) => `<section><h2>${esc(m)}<span>${plural(list.length, 'bundle')} · ${num(list.reduce((s, b) => s + (b.pieces || 0), 0))} pcs · ${mt(list.reduce((s, b) => s + (b.metres || 0), 0))} m</span></h2>
        <table><thead><tr><th>Tag</th><th>Order</th><th>Style</th><th class="n">Pieces</th><th class="n">Metres</th><th>Take from rolls</th><th>Given</th></tr></thead><tbody>${list.map((b) => { const wo = data.get('work_orders', b.workOrder), s = styleLine(wo); return `<tr><td class="mono"><strong>${esc(b.no)}</strong></td><td class="mono">${esc(wo?.no || '')}</td><td>${esc(s.name)}${s.sub ? `<br><small>${esc(s.sub)}</small>` : ''}</td><td class="n">${num(b.pieces)}</td><td class="n">${mt(b.metres)}</td><td>${rollsOf(b).map(esc).join('<br>')}</td><td><span class="dp-box"></span></td></tr>`; }).join('')}</tbody></table></section>`).join('')}
      ${back.length ? `<section><h2>Not issued: no fabric</h2><ul>${back.map((r) => `<li><span class="mono">${esc(data.title('work_orders', r.workOrder))}</span> · ${esc(r.master)} · ${num(r.pieces)} pcs · ${esc(r.ok)}</li>`).join('')}</ul></section>` : ''}</div>`;
  }
  function slipSheet(p) {
    return `<div class="dp-slips">${bundlesOf(p).map((b) => { const wo = data.get('work_orders', b.workOrder), s = styleLine(wo); return `<article class="dp-slip">
      <header><span>Cutting slip · ${esc(fmtDay(at(p.date)))}</span><strong>${esc(b.master || '')}</strong></header>
      <div class="dp-slip-code">${barcodeSvg(b.no, { height: 52, module: 1.8 })}<span class="mono">${esc(b.no)}</span></div>
      <dl><div><dt>Pieces</dt><dd class="big">${num(b.pieces)}</dd></div><div><dt>Fabric</dt><dd class="big">${mt(b.metres)} m</dd></div><div><dt>Order</dt><dd class="mono">${esc(wo?.no || '')}</dd></div><div><dt>Due</dt><dd>${wo?.due ? esc(fmtDay(at(wo.due))) : ''}</dd></div><div class="wide"><dt>Style</dt><dd>${esc(s.name)}${s.sub ? ` · ${esc(s.sub)}` : ''}</dd></div><div class="wide"><dt>Rolls</dt><dd>${esc(rollsOf(b).join(', '))}</dd></div></dl>
    </article>`; }).join('')}</div>`;
  }
  function printOut(kind) {
    const p = plan(); if (!p) return;
    stopPrint?.();
    const area = document.createElement('div'); area.id = 'printArea'; area.className = 'dp-print'; area.innerHTML = kind === 'slips' ? slipSheet(p) : listSheet(p);
    document.body.appendChild(area); document.documentElement.classList.add('printing');
    const done = () => { document.documentElement.classList.remove('printing'); area.remove(); window.removeEventListener('afterprint', done); clearTimeout(t); if (stopPrint === done) stopPrint = null; };
    const t = setTimeout(done, 60000); stopPrint = done;
    window.addEventListener('afterprint', done);
    try { window.print(); } catch { done(); toast('This device cannot print from here.', 'crit'); }
  }

  /** Redraw from state. What is typed lives in state, so focus and the caret are put back where they were. */
  function render() {
    const a = document.activeElement, inside = a && root.contains(a);
    const fk = st.focus || (inside ? a.dataset.fk : ''), caret = inside && !st.focus && a.tagName === 'INPUT' ? [a.selectionStart, a.selectionEnd] : null;
    st.focus = '';
    const keep = el.querySelector('.workspace')?.scrollTop || 0;
    const p = plan();
    painting = true;
    when.innerHTML = whenHtml();
    body.innerHTML = `${daysHtml()}${switchHtml()}${p?.status === 'issued' ? issuedHtml(p) : builderHtml()}`;
    painting = false;
    el.querySelector('.workspace').scrollTop = keep;
    if (fk) { const n = [...root.querySelectorAll('[data-fk]')].find((x) => x.dataset.fk === fk); if (n) { n.focus({ preventScroll: true }); if (caret && caret[0] !== null) { try { n.setSelectionRange(caret[0], caret[1]); } catch { /* not a text field */ } } } }
  }

  // ── Changing the plan ──
  const lineOf = (key) => st.lines.find((l) => String(l.key) === String(key));
  function give(master, woId = st.give?.wo, pieces = st.give?.pieces) {
    const o = orderOf(model(), woId); if (!o) return;
    if (o.state === 'none' || o.state === 'nostyle') return toast(o.state === 'none' ? `No fabric in the store for ${o.wo.no}. It stays back.` : `${o.wo.no}: the style has no fabric per piece.`, 'crit');
    if (o.rest < 1) return toast(`All of ${o.wo.no} is already on the plan.`);
    const name = addLane(master); if (!name) return;
    const n = Math.min(o.rest, Math.max(1, parseInt(pieces, 10) || o.rest));
    st.lines.push({ key: ++seq, workOrder: woId, master: name, pieces: n });
    // Keep the order open with what is left, so it can be split across masters.
    st.give = st.give?.wo === woId && o.rest - n > 0 ? { wo: woId, pieces: String(o.rest - n) } : st.give?.wo === woId ? null : st.give;
    if (!st.give) st.focus = `pick-${woId}`;
    touch(); render();
  }
  function setPieces(l, n, paint = render) {
    const i = st.lines.indexOf(l), room = preview(st.lines)[i]?.room || 0;
    l.pieces = Math.max(1, room > 0 ? Math.min(n, room) : n); delete l.raw;
    touch(); paint();
  }
  function go(date, id) { if (st.dirty) save(); open(date, id); render(); }

  root.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b || b.classList.contains('info')) return;
    const d = b.dataset;
    if (d.step) return go(stepDay(st.cx.date, Number(d.step)));
    if (d.day) return go(d.day);
    if (d.tomorrow !== undefined) return go(tomorrow());
    if (d.plan) return go(st.cx.date, d.plan);
    if (d.more !== undefined) { const draft = plansOn(st.cx.date).find((p) => p.status === 'draft'); return go(st.cx.date, draft ? draft.id : null); }
    if (d.go) return ctx.go(d.go);
    if (d.style) return ctx.openEntity('styles', { id: d.style });
    if (d.print) return printOut(d.print);
    if (!canEdit) return;
    if (d.pick) {
      const o = orderOf(model(), d.pick); if (!o) return;
      if (o.state === 'none') return toast(`No fabric in the store for ${o.wo.no}.${o.coming > 0 ? ` ${mt(o.coming)} m is not ready to cut yet.` : ''}`, 'crit');
      if (o.state === 'nostyle') return toast(`${o.wo.no}: the style has no fabric per piece. Add it on the style.`, 'crit');
      if (o.rest < 1 && st.give?.wo !== d.pick) return toast(`All of ${o.wo.no} is already on the plan.`);
      st.give = st.give?.wo === d.pick ? null : { wo: d.pick, pieces: String(o.rest - o.out > 0 ? o.rest - o.out : o.rest) }; st.giveNew = '';
      render();
      return root.querySelector('.dp-give')?.scrollIntoView({ block: 'nearest' });
    }
    if (d.giveStep) { const o = orderOf(model(), st.give?.wo); if (!o) return; st.give.pieces = String(Math.min(o.rest, Math.max(1, (parseInt(st.give.pieces, 10) || 0) + Number(d.giveStep)))); return render(); }
    if (d.give) return give(d.give);
    if (d.addMaster) { addLane(d.addMaster); return render(); }
    if (d.focusMaster !== undefined) return $('#dpMaster', root)?.focus();
    if (d.laneDel) { st.lanes = st.lanes.filter((m) => !same(m, d.laneDel)); st.focus = 'master'; return render(); }
    if (d.del) { const l = lineOf(d.del); if (!l) return; st.lines = st.lines.filter((x) => x !== l); st.focus = `pick-${l.workOrder}`; touch(); return render(); }
    if (d.inc || d.dec) { const l = lineOf(d.inc || d.dec); if (l) setPieces(l, l.pieces + (d.inc ? 1 : -1)); return; }
    if (d.fit) { const l = lineOf(d.fit); if (l) { st.focus = `pcs-${l.key}`; setPieces(l, Number(d.n)); } return; }
    if (d.issue !== undefined) return void busy(b, async () => {
      await save();
      if (st.dirty || !st.cx.id) throw new Error('The plan is not saved yet. Try again in a moment.');
      const out = await api.act('plan.check', {}, { entity: 'day_plans', id: st.cx.id });
      const rows = out.doc.check || [], ready = rows.filter((r) => r.ok === 'Ready');
      if (!ready.length) throw new Error('No line on this plan has fabric in the store. Nothing can be issued.');
      st.confirm = { ready, back: rows.filter((r) => r.ok !== 'Ready'), metres: round(ready.reduce((s, r) => s + r.need, 0), 1) };
      st.focus = 'issue-go'; render();
    });
    if (d.issueBack !== undefined) { st.confirm = null; st.focus = 'issue'; return render(); }
    if (d.issueGo !== undefined) return void busy(b, async () => {
      const out = await api.act('plan.issue', {}, { entity: 'day_plans', id: st.cx.id });
      st.confirm = null; st.give = null; st.focus = 'print-list';
      toast(out.message); render();
    });
  });
  root.addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset.pcs) {
      const l = lineOf(t.dataset.pcs); if (!l) return;
      const n = /^\d+$/.test(t.value.trim()) ? parseInt(t.value, 10) : 0;
      if (n >= 1) { l.pieces = n; delete l.raw; touch(); } else l.raw = t.value;
      return render();
    }
    if (t.id === 'dpGivePcs' && st.give) st.give.pieces = t.value;
    if (t.id === 'dpMaster') st.newMaster = t.value;
    if (t.dataset.fk === 'give-new') st.giveNew = t.value;
  });
  // Leaving the pieces box: snap back from a half-typed number, and never plan more than the order has left.
  root.addEventListener('focusout', (e) => {
    const l = !painting && e.target.dataset?.pcs && lineOf(e.target.dataset.pcs); if (!l) return;
    const i = st.lines.indexOf(l), room = preview(st.lines)[i]?.room || 0;
    if (l.raw !== undefined || (room > 0 && l.pieces > room)) setPieces(l, l.pieces, refresh);
  });
  root.addEventListener('pointerdown', () => { down = true; });
  window.addEventListener('pointerup', onUp); window.addEventListener('pointercancel', onUp);
  root.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!canEdit) return;
    if (e.target.dataset.form === 'master') {
      if (!st.newMaster.trim()) return $('#dpMaster', root)?.focus();
      addLane(st.newMaster); st.newMaster = ''; st.focus = 'master'; render();
    }
    if (e.target.dataset.form === 'give-new') { const name = st.giveNew.trim(); if (!name) return; st.giveNew = ''; give(name); }
  });
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && st.confirm) { st.confirm = null; st.focus = 'issue'; render(); }
    else if (e.key === 'Escape' && st.give && e.target.closest('.dp-card')) { st.focus = `pick-${st.give.wo}`; st.give = null; render(); }
    else if (e.key === 'Enter' && e.target.dataset.pcs) e.target.blur();
  });

  // Drag an order onto a master, or a line from one master to another.
  const paintDrag = (over) => root.querySelectorAll('.dp-lane').forEach((n) => { n.classList.toggle('is-target', !!st.drag); n.classList.toggle('is-over', !!over && n === over); });
  root.addEventListener('dragstart', (e) => {
    const src = e.target.closest?.('[data-drag-wo], [data-drag-line]'); if (!src || !canEdit) return;
    st.drag = src.dataset.dragWo ? { wo: src.dataset.dragWo } : { line: src.dataset.dragLine };
    e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', src.dataset.dragWo ? data.title('work_orders', src.dataset.dragWo) : 'line');
    paintDrag(null);
  });
  root.addEventListener('dragover', (e) => { const over = st.drag && e.target.closest?.('.dp-lane'); if (!over) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; paintDrag(over); });
  root.addEventListener('dragend', () => { st.drag = null; paintDrag(null); });
  root.addEventListener('drop', (e) => {
    const over = st.drag && e.target.closest?.('.dp-lane'); if (!over) return;
    e.preventDefault();
    const drag = st.drag, name = over.dataset.lane; st.drag = null;
    if (drag.wo) return give(name, drag.wo, st.give?.wo === drag.wo ? st.give.pieces : '');
    const l = lineOf(drag.line);
    if (l && !same(l.master, name)) { l.master = lane(name) || name; touch(); }
    render();
  });

  open(startDate());
  render();
  const off = data.on(() => {
    if (st.drag) return;
    const p = plan();
    // The plan on screen was removed elsewhere, or a draft for this day was started elsewhere.
    if (st.cx.id && !p && !st.saving) open(st.cx.date);
    else if (!st.cx.id && !st.cx.fresh && !st.dirty && !st.saving && !st.lines.length) { const q = pickPlan(st.cx.date); if (q) st.cx.id = q.id; }
    if (!st.dirty && !st.saving) load();
    if (plan()?.status === 'issued') st.confirm = null;
    refresh();
  });
  return () => { off(); if (st.dirty) save(); gone = true; stopPrint?.(); window.removeEventListener('pointerup', onUp); window.removeEventListener('pointercancel', onUp); };
}
