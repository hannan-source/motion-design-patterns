// Founder view: how the go-live is going and how the business is running, drawn from live
// records. Nothing is typed in here: every figure is counted from the cache each time a
// record changes, and each block appears only when the records behind it can be read.

import { api, data } from './api.js';
import { info, esc, inr, num, fmtDate, fmtStamp, $ } from './ui.js';
import { mountField } from './fx.js';
import { FUNCTIONS, TRACKS } from '../shared/golive.js';
import { STAGES, STAGE_NAMES } from '../shared/schema.js';
import { iso, today, workdayIndex } from '../shared/util.js';

const ARROW = '<svg class="pl-arrow" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M3 8h9.5M8.5 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const TICK = '<svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICONS = {
  stock: '<path d="M6 20V6M12 20v-5M18 20v-3" fill="none"/><path d="M3 11.5h18" fill="none" stroke-dasharray="1.5 3"/>',
  machine: '<path d="M4 9h11a4 4 0 0 1 4 4v2h-4v-2H9v6H4z" fill="none"/><path d="M17 15v3M2.5 19h19" fill="none"/>',
  parcel: '<path d="M4 8l8-4 8 4v8l-8 4-8-4z" fill="none"/><path d="M4 8l8 4 8-4M12 12v8" fill="none"/>',
  sample: '<path d="M4 4h8l8 8-8 8-8-8z" fill="none"/><circle cx="8.5" cy="8.5" r="1.3" fill="none"/>',
};
const icon = (k) => `<svg class="pl-ico" viewBox="0 0 24 24" width="26" height="26" aria-hidden="true" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${ICONS[k]}</svg>`;

const DAYS = 14;
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const TRACK_IDS = new Set(TRACKS.map((t) => t[0]));
const FN_NAME = Object.fromEntries(FUNCTIONS);
const FN_SHORT = { founder: 'Founder', ops: 'Ops', prod_manager: 'Production', prod_b2b: 'B2B', merch: 'Merch', stores: 'Stores', dispatch: 'Dispatch', qc: 'QC', logistics: 'Logistics', finance: 'Finance', hr: 'HR', sales: 'Sales', masters: 'Masters', setup: 'Setup' };
const SEGS = [['done', 'Done'], ['doing', 'Doing'], ['blocked', 'Blocked'], ['todo', 'To do']];
const STATE = { done: ['ok', 'Done'], late: ['crit', 'Late'], under: ['info', 'Under way'], none: ['plain', 'Not started'] };
const FABRIC = [['received', 'To inspect', 'Awaiting inspection'], ['passed', 'Passed', 'Passed, waiting for dyeing'], ['at_dyer', 'At the dyer', 'At the dyer'], ['dyed', 'Dyed in store', 'Dyed, in store'], ['issued', 'Issued', 'Issued to cutting']];

const plural = (n, one, many = `${one}s`) => `${num(n)} ${n === 1 ? one : many}`;
const total = (arr, f) => arr.reduce((s, x) => s + (Number(f(x)) || 0), 0);
const dayOf = (isoDate) => new Date(`${isoDate}T00:00:00`);
const share = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0);
const can = (entity) => data.canRead(entity);
const rows = (entity) => (can(entity) ? data.all(entity) : []);
const canOpen = (entity) => data.can(data.entity(entity).module, 'read');
const canGate = () => data.can('logistics', 'write') || data.can('b2c', 'write') || data.can('production', 'write');
const fnName = (id) => (FN_NAME[id] || id || 'No owner').replace(/\s*\(.*\)$/, '');
const fnShort = (id) => FN_SHORT[id] || fnName(id).split(',')[0];
const trackColour = (id) => (TRACK_IDS.has(id) ? `var(--tk-${id})` : 'var(--ink-3)');
const initials = (name) => String(name || '?').trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
const go = (route, opts) => `data-go="${esc(route)}"${opts ? ` data-opts="${esc(JSON.stringify(opts))}"` : ''}`;
const tip = (text) => `data-tip="${esc(text)}"`;
const head = (title, text, right = '', tag = 'h3') => `<div class="pl-head"><div class="title-row"><${tag}>${esc(title)}</${tag}>${info(text, title)}</div>${right}</div>`;
const meta = (text) => `<p class="pl-meta">${esc(text)}</p>`;
const quiet = (text) => `<p class="pl-quiet">${esc(text)}</p>`;
const block = (span, title, text, body, right = '') => `<article class="pl-block pl-c${span}">${head(title, text, right)}${body}</article>`;

/** Arcs on one circle, each [share 0–100, class], drawn clockwise from 12 o'clock with a gap between them. */
function ring(size, r, width, parts, cls = '') {
  const c = size / 2, gap = parts.filter((p) => p[0] > 0).length > 1 ? 1.2 : 0;
  let at = 0;
  const arcs = parts.map(([v, k]) => {
    const from = at; at += v;
    const len = Math.max(0, v - gap);
    return v > 0 && len > 0 ? `<circle class="pl-arc" data-k="${k}" cx="${c}" cy="${c}" r="${r}" fill="none" stroke-width="${width}" stroke-linecap="${gap ? 'butt' : 'round'}" pathLength="100" style="--v:${len.toFixed(2)}" transform="rotate(${(-90 + (from + gap / 2) * 3.6).toFixed(2)} ${c} ${c})"/>` : '';
  }).join('');
  return `<svg class="pl-ring ${cls}" viewBox="0 0 ${size} ${size}" aria-hidden="true"><circle class="pl-ring-track" cx="${c}" cy="${c}" r="${r}" fill="none" stroke-width="${width}"/>${arcs}`;
}

export function mount(el, ctx) {
  let planMod = null, alive = true, log = null, spark = null;

  const hour = new Date().getHours();
  const first = String(data.user?.name || '').trim().split(/\s+/)[0];
  el.innerHTML = `
    <div class="workspace pulse is-first"><div class="workspace-inner">
      <header class="pl-band">
        <canvas class="pl-field" aria-hidden="true"></canvas>
        <div class="pl-scrim" aria-hidden="true"></div>
        <div class="pl-band-in">
          <div class="pl-band-top"><p class="pl-date">${esc(new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date()))}</p>${info('The sentence states the most pressing fact right now. It checks, in this order: go-live tasks that are late or blocked, work orders that will miss their date, then how far the go-live has come.', 'Founder view')}</div>
          <div class="pl-band-say">
            <p class="pl-hello">${esc(`Good ${hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening'}${first ? `, ${first}` : ''}`)}</p>
            <h1 class="pl-headline" id="plHeadline"></h1>
            <div class="pl-band-act" id="plAct" hidden></div>
          </div>
        </div>
      </header>
      <div class="pl-body" id="plBody"></div>
    </div>
    <div class="pl-tip" role="status" aria-live="polite" hidden></div></div>`;
  const root = $('.pulse', el), body = $('#plBody', el), tipEl = $('.pl-tip', el);
  const stopField = mountField($('.pl-field', el), 'services');

  // ───────── What the records say ─────────
  /** The go-live plan as counts: undefined when it cannot be read, null when it has not been created. */
  function goliveModel(T) {
    if (!can('projects') || !can('tasks')) return undefined;
    const project = data.all('projects').find((p) => p.kind === 'golive');
    if (!project) return null;
    const now = today();
    const tasks = data.all('tasks').filter((t) => t.project === project.id);
    const kind = (t) => (['done', 'doing', 'blocked'].includes(t.status) ? t.status : 'todo');
    const isLate = (t) => t.status !== 'done' && !!t.due && t.due < T;
    const tally = (list) => { const c = { done: 0, doing: 0, blocked: 0, todo: 0, late: 0, total: list.length }; for (const t of list) { c[kind(t)]++; if (isLate(t)) c.late++; } return c; };
    const tracks = TRACKS.map(([id, name], i) => {
      const mine = tasks.filter((t) => t.track === id), c = tally(mine);
      const state = c.total && c.done === c.total ? 'done' : c.late ? 'late' : c.done || c.doing || c.blocked ? 'under' : 'none';
      return { id, name, no: i + 1, ...c, state, owners: [...new Set(mine.map((t) => t.ownerRole).filter(Boolean))] };
    }).filter((t) => t.total);
    const ownerIds = [...FUNCTIONS.map((f) => f[0]), ...new Set(tasks.map((t) => t.ownerRole || '').filter((id) => !FN_NAME[id]))];
    const owners = ownerIds.map((id) => {
      const mine = tasks.filter((t) => (t.ownerRole || '') === id);
      return { id, name: fnName(id), ...tally(mine), people: [...new Set(mine.map((t) => t.assignee).filter(Boolean))].map((u) => data.title('users', u)).filter(Boolean) };
    }).filter((o) => o.total).sort((a, b) => b.late - a.late || (b.total - b.done) - (a.total - a.done) || a.name.localeCompare(b.name));
    const week = [];
    for (let i = 0; i < 7; i++) { const d = today(); d.setDate(d.getDate() + i); const date = iso(d); week.push({ date, d, tasks: tasks.filter((t) => t.due === date) }); }
    const trouble = tasks.filter((t) => isLate(t) || t.status === 'blocked')
      .map((t) => ({ t, days: isLate(t) ? Math.max(1, workdayIndex(dayOf(t.due), now)) : 0 }))
      .sort((a, b) => (b.t.status === 'blocked') - (a.t.status === 'blocked') || b.days - a.days);
    return { project, ...tally(tasks), planned: tasks.filter((t) => t.due && t.due < T).length, tracks, owners, week, trouble,
      daysLeft: project.due && project.due >= T ? workdayIndex(now, dayOf(project.due)) : 0 };
  }

  /** Open work orders, and which of them will miss their date: from the production plan when there is one. */
  function ordersModel(T) {
    if (!can('work_orders')) return null;
    const open = data.all('work_orders').filter((w) => w.status !== 'done');
    let late = null;
    try {
      const plan = planMod?.currentPlan?.();
      const ids = new Set(open.map((w) => w.id));
      const planned = plan?.sim?.orders?.filter((o) => !o.isNew && ids.has(o.ref));
      if (planned?.length) late = { from: 'plan', n: planned.length, list: planned.filter((o) => o.late > 0).map((o) => ({ no: o.id, days: o.late })) };
    } catch (e) { console.error(e); }
    if (!late) late = { from: 'due', n: open.length, list: open.filter((w) => w.due && w.due < T).map((w) => ({ no: w.no || '', days: Math.max(1, workdayIndex(dayOf(w.due), today())) })) };
    return { open, late };
  }

  // ───────── Opening band ─────────
  function say(T, g, wo) {
    let text = '', act = '';
    const be = (n) => (n === 1 ? 'is' : 'are');
    if (g && (g.late || g.blocked)) {
      text = g.late ? `${plural(g.late, 'go-live task')} ${be(g.late)} late${g.blocked ? `, ${num(g.blocked)} ${be(g.blocked)} blocked` : ''}.` : `${plural(g.blocked, 'go-live task')} ${be(g.blocked)} blocked.`;
    } else if (wo?.late.list.length) {
      const n = wo.late.list.length;
      text = wo.late.from === 'plan' ? `${plural(n, 'work order')} will miss ${n === 1 ? 'its' : 'their'} date.` : `${plural(n, 'work order')} ${be(n)} past ${n === 1 ? 'its' : 'their'} date.`;
    } else if (g && g.total) {
      text = g.done === g.total ? `Go-live is complete: all ${num(g.total)} tasks done.` : `Go-live is on track: ${num(g.done)} of ${num(g.total)} tasks done.`;
    } else if (!['work_orders', 'rolls', 'shop_orders', 'store_orders', 'sales_orders', 'invoices', 'bills', 'items', 'styles', 'tasks'].some((e) => rows(e).length)) {
      text = 'Nothing is recorded yet. Start with the go-live plan.';
      if (data.can('projects', 'read')) act = `<button type="button" class="btn" ${go('m-projects')}>Open the go-live plan</button>`;
    } else if (wo?.open.length) {
      text = `${wo.open.length === 1 ? 'The open work order is' : `All ${num(wo.open.length)} open work orders are`} on track.`;
    } else {
      text = 'Nothing is late today.';
    }
    $('#plHeadline', el).textContent = text;
    const slot = $('#plAct', el);
    slot.innerHTML = act; slot.hidden = !act;
  }

  // ───────── Go-live ─────────
  const stack = (c, width = 100) => `<span class="pl-stack" style="width:${width.toFixed(1)}%">${SEGS.filter(([k]) => c[k] > 0).map(([k, name]) => `<i data-k="${k}" style="flex:${c[k]}" ${tip(`${name}: ${plural(c[k], 'task')}`)}></i>`).join('')}</span>`;

  function goliveHtml(g) {
    if (g === undefined) return '';
    const about = 'The plan that brings the ERP into daily use: tasks in eight tracks, each with an owner and a due date. Everything in this section is counted from those tasks as they stand now.';
    if (!g) {
      return `<section class="pl-sec" aria-label="Go-live">${head('Go-live', about, '', 'h2')}
        <div class="pl-nogo"><p>The go-live plan has not been created yet.</p>${data.can('projects', 'read') ? `<button type="button" class="btn btn-primary" ${go('m-projects')}>Create the go-live plan</button>` : ''}</div></section>`;
    }
    const pct = share(g.done, g.total), planPct = share(g.planned, g.total), gap = g.done - g.planned;
    const verdict = gap > 0 ? ['ok', `Ahead by ${plural(gap, 'task')}`] : gap < 0 ? ['crit', `Behind by ${plural(-gap, 'task')}`] : ['info', 'On plan'];
    const a = (planPct / 100) * 2 * Math.PI - Math.PI / 2;
    const progress = `
      <div class="pl-prog">
        ${head('Progress', 'The thick ring is the share of go-live tasks marked done. The thin outer ring and its marker show where the plan says progress should be today: the share of tasks whose due date has passed. Ahead or behind is tasks done minus tasks that should be done by now.')}
        <div class="pl-prog-in">
          <div class="pl-ring-wrap" tabindex="0" role="img" aria-label="${esc(`${pct}% done: ${num(g.done)} of ${num(g.total)} tasks. The plan says ${planPct}% by today.`)}" ${tip(`${num(g.done)} of ${num(g.total)} tasks done. The plan says ${num(g.planned)} by today.`)}>
            ${ring(240, 90, 16, [[pct, 'done']])}
              <circle class="pl-ring-track" cx="120" cy="120" r="112" fill="none" stroke-width="2"/>
              ${planPct > 0 ? `<circle class="pl-arc" data-k="plan" cx="120" cy="120" r="112" fill="none" stroke-width="2" pathLength="100" style="--v:${planPct}" transform="rotate(-90 120 120)"/>` : ''}
              <circle class="pl-ring-mark" cx="${(120 + 112 * Math.cos(a)).toFixed(1)}" cy="${(120 + 112 * Math.sin(a)).toFixed(1)}" r="5" style="fill:var(--ink)"/>
            </svg>
            <div class="pl-ring-mid"><p class="pl-ring-n">${pct}<span>%</span></p><p class="pl-ring-of">${esc(`${num(g.done)} of ${num(g.total)} tasks`)}</p></div>
          </div>
          <div class="pl-verdict">
            <p class="pl-verdict-say"><span class="pl-state" data-state="${verdict[0]}" aria-hidden="true"></span>${esc(verdict[1])}</p>
            <ul class="pl-keys">
              <li><i data-k="ring"></i>${esc(`${num(g.done)} done`)}</li>
              <li><i data-k="plan"></i>${esc(`${num(g.planned)} planned by today`)}</li>
            </ul>
            <div class="pl-all">${stack(g)}</div>
            <ul class="pl-legend">${SEGS.map(([k, name]) => `<li><i data-k="${k}"></i>${esc(name)} <b>${esc(num(g[k]))}</b></li>`).join('')}</ul>
            <p class="pl-meta">${esc(g.daysLeft ? `${plural(g.daysLeft, 'working day')} left` : 'Past the planned end')}</p>
          </div>
        </div>
      </div>`;

    const due = total(g.week, (d) => d.tasks.filter((t) => t.status !== 'done').length);
    const week = `
      <div class="pl-week">
        ${head('This week', 'Go-live tasks due in the next seven days, one dot per task in the colour of its track. A hollow dot is already done; a red ring means blocked. Late and blocked tasks are listed further down.', meta(due ? `${num(due)} to finish` : 'Nothing due'))}
        <ol class="pl-days">${g.week.map((d, i) => `
          <li class="pl-day${i === 0 ? ' is-today' : ''}${d.d.getDay() === 0 ? ' is-off' : ''}">
            <span class="pl-day-name">${i === 0 ? 'Today' : DOW[d.d.getDay()]}</span><span class="pl-day-n">${d.d.getDate()}</span>
            <span class="pl-dots">${d.tasks.map((t) => `<button type="button" class="pl-dot"${t.status === 'done' ? ' data-done' : ''}${t.status === 'blocked' ? ' data-blocked' : ''} style="--c:${trackColour(t.track)}" ${go('m-projects', { task: t.id })} aria-label="${esc(`${t.title}. ${fnName(t.ownerRole)}, due ${fmtDate(dayOf(t.due))}`)}" ${tip(`${t.title} · ${fnName(t.ownerRole)}${t.status === 'done' ? ' · done' : t.status === 'blocked' ? ' · blocked' : ''}`)}></button>`).join('')}</span>
          </li>`).join('')}</ol>
      </div>`;

    const journey = `
      <div class="pl-journey">
        ${head('The journey', 'The eight tracks in plan order. Each stretch of the line fills as its tasks are done. A track is late when any task in it is past its due date and not done, and under way once any task has started. The names under each track are the functions that own its tasks.')}
        <ol class="pl-rail">${g.tracks.map((t) => `
          <li><button type="button" class="pl-stn" data-state="${t.state}" style="--c:var(--tk-${t.id});--v:${share(t.done, t.total)}%" ${go('m-projects', { track: t.id })} ${tip(`${t.name}: ${num(t.done)} of ${num(t.total)} done${t.late ? `, ${num(t.late)} late` : ''}${t.blocked ? `, ${num(t.blocked)} blocked` : ''}`)}>
            <span class="pl-stn-rail" aria-hidden="true"><i class="pl-stn-node">${t.state === 'done' ? TICK : ''}</i><i class="pl-stn-seg"><b></b></i></span>
            <span class="pl-stn-no">${String(t.no).padStart(2, '0')}</span>
            <span class="pl-stn-name">${esc(t.name)}</span>
            <span class="pl-stn-count"><b>${esc(num(t.done))}</b> / ${esc(num(t.total))}</span>
            <span class="tag tag-${STATE[t.state][0]}">${esc(t.state === 'late' ? `${num(t.late)} late` : STATE[t.state][1])}</span>
            <span class="pl-stn-own">${esc(t.owners.map(fnShort).join(', '))}</span>
          </button></li>`).join('')}</ol>
      </div>`;

    const most = Math.max(...g.owners.map((o) => o.total), 1);
    const owners = `
      <div class="pl-block">
        ${head('Who is carrying what', 'One row per function that owns go-live tasks. The bar is as long as the number of tasks it owns and is split into done, doing, blocked and to do. Sorted by most late, then by most still open. The circles are the people those tasks are assigned to.')}
        <ul class="pl-owners">${g.owners.map((o) => `
          <li><button type="button" class="pl-own" ${go('m-projects', { owner: o.id })} ${tip(`${o.name}: ${num(o.done)} done, ${num(o.doing)} doing, ${num(o.blocked)} blocked, ${num(o.todo)} to do${o.late ? `, ${num(o.late)} late` : ''}`)}>
            <span class="pl-own-name">${esc(o.name)}</span>
            <span class="pl-own-bar">${stack(o, (o.total / most) * 100)}</span>
            <span class="pl-own-n"><b>${esc(num(o.done))}</b> / ${esc(num(o.total))}</span>
            <span class="pl-own-late">${o.late ? `<span class="tag tag-crit">${esc(`${num(o.late)} late`)}</span>` : ''}</span>
            <span class="pl-own-who">${o.people.length ? `${o.people.slice(0, 3).map((n) => `<span class="pl-face" title="${esc(n)}">${esc(initials(n))}</span>`).join('')}${o.people.length > 3 ? `<span class="pl-face is-more">+${o.people.length - 3}</span>` : ''}` : '<span class="pl-face is-none" title="No one named yet"><span class="pl-sr">No one named yet</span></span>'}</span>
          </button></li>`).join('')}</ul>
      </div>`;

    const shown = g.trouble.slice(0, 6);
    const trouble = `
      <div class="pl-block">
        ${head('Late and blocked', 'Go-live tasks past their due date and not done, counted in working days (Monday to Saturday), and tasks someone has marked as blocked with the reason they gave. Blocked first, then the longest overdue.', g.trouble.length ? meta(plural(g.trouble.length, 'task')) : '')}
        ${shown.length ? `<ul class="pl-cards">${shown.map(({ t, days }) => `
          <li><button type="button" class="pl-card" style="--c:${trackColour(t.track)}" ${go('m-projects', { task: t.id })}>
            <span class="pl-card-title">${esc(t.title)}</span>
            <span class="pl-card-tags">${t.status === 'blocked' ? '<span class="tag tag-crit">Blocked</span>' : ''}${days ? `<span class="tag tag-crit">${esc(`${plural(days, 'day')} late`)}</span>` : ''}</span>
            <span class="pl-card-meta">${esc(fnName(t.ownerRole))}${t.assignee && data.title('users', t.assignee) ? ` · ${esc(data.title('users', t.assignee))}` : ''}${t.status === 'blocked' && t.blockedBy ? `<span class="pl-card-why">${esc(t.blockedBy)}</span>` : ''}</span>
          </button></li>`).join('')}</ul>${g.trouble.length > shown.length ? `<button type="button" class="link pl-more" ${go('m-projects')}>${esc(`${num(g.trouble.length - shown.length)} more in the tracker`)}</button>` : ''}` : '<p class="pl-fine"><span class="pl-state" data-state="ok" aria-hidden="true"></span>Nothing is late or blocked.</p>'}
      </div>`;

    return `
      <section class="pl-sec" aria-label="Go-live">
        ${head('Go-live', about, meta(`${g.project.start ? fmtDate(dayOf(g.project.start)) : ''}${g.project.due ? ` to ${fmtDate(dayOf(g.project.due))}` : ''}`), 'h2')}
        <div class="panel pl-stage"><div class="pl-top">${progress}${week}</div>${journey}</div>
        <div class="pl-duo">${owners}${trouble}</div>
      </section>`;
  }

  // ───────── The business, live ─────────
  function fabricHtml() {
    if (!can('rolls')) return '';
    const title = 'Fabric pipeline', rolls = data.all('rolls');
    const about = 'Where every metre of fabric on record stands now, by the status of its roll. The thickness of the band at each stage is the metres there. Rejected at inspection (including rolls already returned to the mill) and failed after dyeing drop off the line. Money lost after dyeing is the metres that failed times the fabric cost plus the dyeing cost per metre.';
    if (!rolls.length) return block(8, title, about, quiet('Appears when fabric rolls are received'));
    const at = (...statuses) => { const mine = rolls.filter((r) => statuses.includes(r.status)); return { m: total(mine, (r) => r.metres), n: mine.length }; };
    const stages = FABRIC.map(([s, name, long]) => ({ name, long, ...at(s) }));
    const drops = [{ from: 0, name: 'Rejected', long: 'Rejected at inspection', ...at('rejected', 'returned') }, { from: 2, name: 'Failed after dyeing', long: 'Failed after dyeing', ...at('dye_reject') }];
    const all = total(rolls, (r) => r.metres), max = Math.max(...stages.map((s) => s.m), ...drops.map((d) => d.m), 1);
    const lost = total(rolls.filter((r) => r.status === 'dye_reject'), (r) => { const item = can('items') ? data.get('items', r.item) : null; return (Number(r.metres) || 0) * ((Number(item?.cost) || 0) + (Number(item?.dyeCost) || 0)); });

    // 500 wide, stretched to the block; every thickness runs top to bottom so stretching keeps it true.
    const H = 172, YC = 44, TOP = 72, X = (i) => 50 + i * 100;
    const h = (m) => (m > 0 ? Math.max(3, (m / max) * TOP) : 1.5);
    const link = (xa, a0, a1, xb, b0, b1) => { const m = (xa + xb) / 2; return `M${xa} ${a0.toFixed(1)}C${m} ${a0.toFixed(1)} ${m} ${b0.toFixed(1)} ${xb} ${b0.toFixed(1)}L${xb} ${b1.toFixed(1)}C${m} ${b1.toFixed(1)} ${m} ${a1.toFixed(1)} ${xa} ${a1.toFixed(1)}Z`; };
    let svg = '';
    stages.forEach((s, i) => {
      const hi = h(s.m);
      if (i < stages.length - 1) { const hn = h(stages[i + 1].m); svg += `<path class="pl-pipe-band" d="${link(X(i) + 5, YC - hi / 2, YC + hi / 2, X(i + 1) - 5, YC - hn / 2, YC + hn / 2)}" style="fill:var(--material)"/>`; }
      svg += `<rect class="pl-pipe-node" x="${X(i) - 3}" y="${(YC - hi / 2).toFixed(1)}" width="6" height="${hi.toFixed(1)}" rx="1" style="fill:var(--material)"/>`;
    });
    drops.filter((d) => d.m > 0).forEach((d) => {
      const t = h(d.m), y0 = YC + h(stages[d.from].m) / 2 + 3 + t / 2, y1 = H - 3 - t / 2;
      svg += `<path class="pl-pipe-drop" d="${link(X(d.from) + 5, y0 - t / 2, y0 + t / 2, X(d.from + 1) - 5, y1 - t / 2, y1 + t / 2)}" style="fill:var(--crit)"/><rect class="pl-pipe-node" x="${X(d.from + 1) - 3}" y="${(y1 - t / 2).toFixed(1)}" width="6" height="${t.toFixed(1)}" rx="1" style="fill:var(--crit)"/>`;
    });
    const say = (s) => `${s.long}: ${num(s.m)} m in ${plural(s.n, 'roll')}, ${share(s.m, all)}% of the fabric on record`;
    return block(8, title, about, `
      <div class="pl-pipe">
        <ol class="pl-pipe-top">${stages.map((s) => `<li tabindex="0" ${tip(say(s))}><span class="pl-pipe-name">${esc(s.name)}</span><span class="pl-pipe-m">${esc(num(s.m))}<small> m</small></span><span class="pl-pipe-n">${esc(plural(s.n, 'roll'))}</span></li>`).join('')}</ol>
        <div class="pl-pipe-plot">
          <svg viewBox="0 0 500 ${H}" preserveAspectRatio="none" aria-hidden="true">${svg}</svg>
          ${drops.filter((d) => d.m > 0).map((d) => `<p class="pl-pipe-off" style="left:${(d.from + 1) * 20 + 10}%" tabindex="0" ${tip(say(d))}><span class="pl-pipe-name">${esc(d.name)}</span><span class="pl-pipe-n">${esc(`${num(d.m)} m · ${plural(d.n, 'roll')}`)}</span></p>`).join('')}
        </div>
      </div>`, lost > 0 ? `<p class="pl-lost"><span class="pl-state" data-state="crit" aria-hidden="true"></span><b>${esc(inr(lost))}</b> lost after dyeing</p>` : meta(`${num(all)} m on record`));
  }

  function productionHtml(wo) {
    if (!wo) return '';
    const title = 'Production flow';
    const about = 'Across every open work order: pieces finished at each of the five stages, against all the pieces ordered (the full height of each bar). A big step down between two stages is work piling up before the second one. Orders on track come from the production plan when it can be drawn; otherwise an order is late when its due date has passed.';
    if (!data.all('work_orders').length) return block(7, title, about, quiet('Appears when work orders exist'));
    if (!wo.open.length) return block(7, title, about, '<p class="pl-fine"><span class="pl-state" data-state="ok" aria-hidden="true"></span>No open work orders: everything raised is packed.</p>');
    const qty = total(wo.open, (w) => w.qty);
    const done = STAGES.map((s) => total(wo.open, (w) => Math.min(Number(w.qty) || 0, Number(w[s]) || 0)));
    const waits = done.map((d, i) => (i ? done[i - 1] - d : 0));
    const pile = waits.indexOf(Math.max(...waits));
    const y = (v) => (qty > 0 ? 100 - (v / qty) * 100 : 100).toFixed(1);
    const cols = STAGES.map((s, i) => `
      ${i ? `<span class="pl-fun-link${i === pile && waits[i] > 0 ? ' is-pile' : ''}" style="grid-column:${i * 2};clip-path:polygon(0 ${y(done[i - 1])}%,100% ${y(done[i])}%,100% 100%,0 100%)" ${tip(`${plural(waits[i], 'piece')} waiting for ${STAGE_NAMES[s].toLowerCase()}`)}></span>` : ''}
      <span class="pl-fun-v" style="grid-column:${i * 2 + 1}">${esc(num(done[i]))}</span>
      <span class="pl-fun-bar" style="grid-column:${i * 2 + 1}" tabindex="0" role="img" aria-label="${esc(`${STAGE_NAMES[s]}: ${num(done[i])} of ${num(qty)} pieces`)}" ${tip(`${STAGE_NAMES[s]}: ${num(done[i])} of ${num(qty)} pieces, ${share(done[i], qty)}%`)}><i style="--v:${share(done[i], qty)}%"></i></span>
      <span class="pl-fun-name" style="grid-column:${i * 2 + 1}">${esc(STAGE_NAMES[s])}</span>`).join('');
    const late = wo.late.list.length, ok = wo.late.n - late;
    return block(7, title, about, `
      <div class="pl-prod">
        <div class="pl-prod-flow">
          <div class="pl-fun">${cols}</div>
          ${waits[pile] > 0 ? `<p class="pl-pile"><span class="tag tag-warn">Piling up</span>${esc(`${plural(waits[pile], 'piece')} waiting for ${STAGE_NAMES[STAGES[pile]].toLowerCase()}`)}</p>` : ''}
        </div>
        <div class="pl-ontrack">
          <p class="eyebrow">Orders on track</p>
          <p class="pl-big">${esc(num(ok))}<span> of ${esc(num(wo.late.n))}</span></p>
          <div class="pl-split" tabindex="0" role="img" aria-label="${esc(`${num(ok)} on track, ${num(late)} late`)}" ${tip(`${num(ok)} on track, ${num(late)} late${wo.late.from === 'plan' ? ', from the production plan' : ', by due date'}`)}>${ok ? `<i data-k="ok" style="flex:${ok}"></i>` : ''}${late ? `<i data-k="late" style="flex:${late}"></i>` : ''}</div>
          <ul class="pl-legend"><li><i data-k="ok"></i>On track <b>${esc(num(ok))}</b></li><li><i data-k="late"></i>Late <b>${esc(num(late))}</b></li></ul>
          ${late ? `<p class="pl-note">${esc(wo.late.list.slice(0, 3).map((o) => `${o.no} by ${plural(o.days, 'day')}`).join(', '))}${late > 3 ? esc(` and ${num(late - 3)} more`) : ''}</p>` : ''}
          ${data.can('production', 'read') ? `<button type="button" class="link pl-more" ${go('room')}>Open the Production room</button>` : ''}
        </div>
      </div>`, meta(`${plural(qty, 'piece')} on ${plural(wo.open.length, 'open order')}`));
  }

  function salesHtml(T) {
    const canShop = can('shop_orders'), canStore = can('store_orders'), canInv = can('invoices');
    if (!canShop && !canStore) return '';
    const title = 'Sales, last 14 days';
    const about = 'Shopify orders and store orders by their order date, at the amount on the order, added together for each day. Cancelled Shopify orders are left out. The three blocks split this month so far between Shopify, the store and B2B invoices posted, in rupees.';
    const shop = rows('shop_orders').filter((o) => o.status !== 'cancelled'), store = rows('store_orders');
    const inv = rows('invoices').filter((i) => i.status === 'posted' || i.status === 'paid');
    spark = null;
    if (!shop.length && !store.length && !inv.length) return block(5, title, about, quiet('Appears when Shopify or store orders exist'));
    const lines = [...shop, ...store].map((o) => ({ date: o.date, amount: Number(o.amount) || 0 }));
    const days = [];
    for (let i = DAYS - 1; i >= 0; i--) { const d = today(); d.setDate(d.getDate() - i); const date = iso(d); const mine = lines.filter((l) => l.date === date); days.push({ date, d, orders: mine.length, amount: total(mine, (l) => l.amount) }); }
    const max = Math.max(...days.map((d) => d.amount), 1), W = (DAYS - 1) * 20, Hh = 72;
    const py = (v) => 66 - (v / max) * 56;
    const pts = days.map((d, i) => `${i * 20} ${py(d.amount).toFixed(1)}`);
    const now = days[DAYS - 1];
    spark = days.map((d) => `${DOW[d.d.getDay()]} ${fmtDate(d.d)}: ${inr(d.amount)}, ${plural(d.orders, 'order')}`);
    const month = T.slice(0, 7);
    const parts = [canShop && ['Shopify', total(shop.filter((o) => String(o.date).startsWith(month)), (o) => o.amount)], canStore && ['Store', total(store.filter((o) => String(o.date).startsWith(month)), (o) => o.amount)],
      canInv && ['B2B invoiced', total(inv.filter((i) => String(i.date).startsWith(month)), (i) => (Number(i.total) || 0) * (Number(i.fx) || 1))]].filter(Boolean);
    const sum = total(parts, (p) => p[1]);
    return block(5, title, about, `
      <div class="pl-sales">
        <div class="pl-sales-now"><p class="eyebrow">Today</p><p class="pl-hero">${esc(inr(now.amount))}</p><p class="pl-note">${esc(plural(now.orders, 'order'))}</p></div>
        <div class="pl-spark">
          <svg viewBox="0 0 ${W} ${Hh}" preserveAspectRatio="none" aria-hidden="true">
            <path class="pl-spark-area" d="M0 ${Hh}L${pts.join('L')}L${W} ${Hh}Z" style="fill:var(--ink)"/>
            <path class="pl-spark-line" d="M${pts.join('L')}" fill="none"/>
          </svg>
          <i class="pl-spark-now" style="top:${((py(now.amount) / Hh) * 100).toFixed(1)}%" aria-hidden="true"></i>
          <div class="pl-spark-hit" tabindex="0" role="group" aria-label="Sales per day for the last ${DAYS} days. Use the left and right arrow keys to read each day.">${days.map((d) => `<i><b style="top:${((py(d.amount) / Hh) * 100).toFixed(1)}%"></b></i>`).join('')}</div>
        </div>
        <div class="pl-axis" aria-hidden="true"><span>${esc(fmtDate(days[0].d))}</span><span>Today</span></div>
        <div class="pl-mix">
          <p class="eyebrow">This month so far</p>
          ${sum > 0 ? `<div class="pl-mix-bar">${parts.filter((p) => p[1] > 0).map((p) => `<i data-k="${parts.indexOf(p)}" style="flex:${p[1]}" tabindex="0" role="img" aria-label="${esc(`${p[0]}: ${inr(p[1])}`)}" ${tip(`${p[0]}: ${inr(p[1])}, ${share(p[1], sum)}% of the month`)}>${share(p[1], sum) >= 16 ? `<span>${share(p[1], sum)}%</span>` : ''}</i>`).join('')}</div>` : ''}
          <ul class="pl-legend is-mix">${parts.map((p, i) => `<li><i data-k="m${i}"></i>${esc(p[0])} <b>${esc(inr(p[1]))}</b></li>`).join('')}</ul>
        </div>
      </div>`, meta(`${inr(total(days, (d) => d.amount))} in ${DAYS} days`));
  }

  function moneyHtml(T) {
    const canBills = can('bills'), canInv = can('invoices');
    if (!canBills && !canInv) return '';
    const title = 'Money';
    const about = 'Left: what Deme owes suppliers, the unpaid part of every supplier bill. Right: what customers owe Deme, every posted invoice not yet paid in full, in rupees at the rate on the invoice. Both bars share one scale. The hatched part is past its due date. Vouchers not in Tally are those still to be exported.';
    const bills = rows('bills').filter((b) => b.status !== 'paid').map((b) => ({ amount: Math.max(0, (Number(b.amount) || 0) - (Number(b.paid) || 0)), over: !!b.due && b.due < T }));
    const invs = rows('invoices').filter((i) => i.status === 'posted').map((i) => ({ amount: Math.max(0, ((Number(i.total) || 0) - (Number(i.received) || 0)) * (Number(i.fx) || 1)), over: !!i.dueDate && i.dueDate < T }));
    const open = rows('vouchers').filter((v) => v.status === 'open').length;
    if (!rows('bills').length && !rows('invoices').length && !rows('vouchers').length) return block(5, title, about, quiet('Appears when supplier bills or invoices exist'));
    const side = (label, list, one, many, k) => {
      const all = total(list, (x) => x.amount), over = total(list.filter((x) => x.over), (x) => x.amount);
      return { label, all, over, n: list.length, one, many, k };
    };
    const sides = [canBills && side('Owed to suppliers', bills, 'unpaid bill', 'unpaid bills', 'out'), canInv && side('Owed by customers', invs, 'open invoice', 'open invoices', 'in')].filter(Boolean);
    const max = Math.max(...sides.map((s) => s.all), 1);
    return block(5, title, about, `
      <div class="pl-money${sides.length === 1 ? ' is-one' : ''}">${sides.map((s) => `
        <div class="pl-money-side is-${s.k}">
          <p class="eyebrow">${esc(s.label)}</p>
          <p class="pl-big">${esc(inr(s.all))}</p>
          <div class="pl-money-bar" tabindex="0" role="img" aria-label="${esc(`${s.label}: ${inr(s.all)}, of which ${inr(s.over)} overdue`)}" ${tip(`${s.label}: ${inr(s.all)} on ${plural(s.n, s.one, s.many)}, ${inr(s.over)} overdue`)}><span style="width:${((s.all / max) * 100).toFixed(1)}%">${s.all - s.over > 0 ? `<i data-k="due" style="flex:${s.all - s.over}"></i>` : ''}${s.over > 0 ? `<i data-k="over" style="flex:${s.over}"></i>` : ''}</span></div>
          <p class="pl-note">${esc(s.over > 0 ? `${inr(s.over)} overdue` : s.all > 0 ? 'Nothing overdue' : `No ${s.many}`)}</p>
        </div>`).join('')}
      </div>
      ${can('vouchers') ? `<button type="button" class="pl-line" data-open="vouchers"><span>Vouchers</span><span class="tag tag-${open ? 'warn' : 'ok'}">${esc(open ? `${num(open)} not in Tally` : 'All in Tally')}</span>${ARROW}</button>` : ''}`,
    sides.length === 2 ? `<ul class="pl-legend"><li><i data-k="due"></i>Not yet due</li><li><i data-k="over"></i>Overdue</li></ul>` : '');
  }

  function qualityHtml() {
    if (!can('inspections')) return '';
    const title = 'Quality';
    const about = `Fabric: rolls that passed inspection out of all rolls inspected, from the inspection records. Garments: pieces passed out of pieces checked, across all in-line and final checks. The red part of each ring is what failed.`;
    const insp = data.all('inspections'), checks = rows('qc_checks');
    const checked = total(checks, (c) => c.checked), passed = total(checks, (c) => c.passed);
    if (!insp.length && !(checked > 0)) return block(4, title, about, quiet('Appears when fabric rolls are inspected'));
    const dial = (label, good, all, unit, failWord) => {
      const p = share(good, all), bad = all - good;
      return `<div class="pl-dial">
        <div class="pl-dial-ring" tabindex="0" role="img" aria-label="${esc(`${label}: ${p}% passed`)}" ${tip(`${label}: ${num(good)} of ${num(all)} ${unit} passed, ${num(bad)} ${failWord}`)}>${ring(132, 56, 10, [[(good / all) * 100, 'done'], [(bad / all) * 100, 'bad']])}</svg><p class="pl-dial-n">${p}<span>%</span></p></div>
        <div class="pl-dial-say"><p class="eyebrow">${esc(label)}</p><p class="pl-dial-of">${esc(`${num(good)} of ${num(all)} ${unit} passed`)}</p>${bad > 0 ? `<span class="tag tag-crit">${esc(`${num(bad)} ${failWord}`)}</span>` : '<span class="tag tag-ok">None failed</span>'}</div>
      </div>`;
    };
    return block(4, title, about, `<div class="pl-dials">
      ${insp.length ? dial('Fabric inspection', insp.filter((i) => i.result === 'pass').length, insp.length, insp.length === 1 ? 'roll' : 'rolls', 'failed') : ''}
      ${checked > 0 ? dial('Garment checks', Math.min(passed, checked), checked, 'pieces', 'not passed') : ''}</div>`);
  }

  function alertsHtml() {
    const title = 'Stock and floor alerts';
    const about = 'Four counts from live records: materials whose stock on hand is below their minimum level, machines marked as down, parcels packed but not yet scanned out at the gate, and sample requests waiting for a decision. Each opens the place where it is dealt with.';
    const tiles = [];
    const add = (entity, k, label, match, name, tone, to) => {
      if (!can(entity)) return;
      const hit = data.all(entity).filter(match);
      const names = hit.map(name).filter(Boolean).slice(0, 3).join(', ') + (hit.length > 3 ? ` and ${num(hit.length - 3)} more` : '');
      tiles.push(`<li><button type="button" class="pl-alert" data-state="${hit.length ? tone : 'ok'}" ${to}>
        <span class="pl-alert-top">${icon(k)}<span class="pl-state" data-state="${hit.length ? tone : 'ok'}" aria-hidden="true"></span></span>
        <span class="pl-alert-n">${esc(num(hit.length))}</span>
        <span class="pl-alert-name">${esc(label)}</span>
        <span class="pl-alert-sub">${esc(hit.length ? names : 'None')}</span>
      </button></li>`);
    };
    const open = (entity) => (canOpen(entity) ? `data-open="${entity}"` : 'disabled');
    add('items', 'stock', 'Materials below minimum', (i) => i.minLevel > 0 && (Number(i.onHand) || 0) < i.minLevel, (i) => i.name, 'warn', open('items'));
    add('machines', 'machine', 'Machines down', (m) => m.status === 'down', (m) => m.code, 'crit', open('machines'));
    add('parcels', 'parcel', 'Parcels packed, not scanned', (p) => p.status === 'packed', (p) => p.barcode, 'warn', canGate() ? go('gate') : open('parcels'));
    add('sample_requests', 'sample', 'Sample requests waiting', (s) => s.status === 'requested', (s) => s.no, 'warn', open('sample_requests'));
    if (!tiles.length) return '';
    if (!['items', 'machines', 'parcels', 'sample_requests'].some((e) => rows(e).length)) return block(7, title, about, quiet('Appears when materials, machines, parcels or sample requests exist'));
    return block(7, title, about, `<ul class="pl-alerts">${tiles.join('')}</ul>`);
  }

  // ───────── What just happened ─────────
  function logHtml() {
    if (log === null) return '';
    const dot = (l) => data.entity(l.entity)?.statuses?.[l.action]?.tone || 'plain';
    return `
      <section class="pl-sec" aria-label="What just happened">
        ${head('What just happened', 'The latest twelve entries from the audit trail: every record added, changed or moved to a new status, with who did it and when. The full trail is under Admin.', '', 'h2')}
        ${log.length ? `<ol class="pl-log">${log.map((l) => `<li><span class="pl-state" data-state="${dot(l)}" aria-hidden="true"></span><span class="pl-log-at">${esc(fmtStamp(l.at))}</span><span class="pl-log-who">${esc(l.userName || '')}</span><span class="pl-log-what">${esc(l.text || '')}</span></li>`).join('')}</ol>` : quiet('Appears when records are added or changed')}
      </section>`;
  }
  async function loadLog() {
    let list = [];
    try { if (data.can('admin', 'read')) list = await api.audit(); else return; } catch { list = log || []; }
    if (!alive) return;
    log = [...list].sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 12);
    const slot = $('#plLog', el);
    if (slot) slot.innerHTML = logHtml();
  }

  // ───────── Drawing and wiring ─────────
  function render() {
    hideTip();
    const T = iso(today());
    const g = goliveModel(T), wo = ordersModel(T);
    say(T, g, wo);
    const col = (span, ...blocks) => (blocks.join('') ? `<div class="pl-col pl-c${span}">${blocks.join('')}</div>` : '');
    const business = [fabricHtml(), qualityHtml(), col(7, productionHtml(wo), alertsHtml()), col(5, salesHtml(T), moneyHtml(T))].join('');
    body.innerHTML = `
      ${goliveHtml(g)}
      ${business ? `<section class="pl-sec" aria-label="The business, live">${head('The business, live', 'Each picture below is drawn from the records as they stand this minute and redraws when any of them changes. A block shows only when your role can read the records behind it.', '', 'h2')}<div class="pl-grid">${business}</div></section>` : ''}
      <div id="plLog">${logHtml()}</div>`;
    wireSpark();
  }

  function showTip(target, text = target.dataset.tip) {
    if (!text) return hideTip();
    tipEl.textContent = text; tipEl.hidden = false;
    const r = target.getBoundingClientRect(), w = tipEl.offsetWidth, h = tipEl.offsetHeight;
    tipEl.style.left = `${Math.max(8, Math.min(r.left + r.width / 2 - w / 2, innerWidth - w - 8))}px`;
    tipEl.style.top = `${r.top - h - 8 < 8 ? r.bottom + 8 : r.top - h - 8}px`;
  }
  function hideTip() { tipEl.hidden = true; }

  /** The sales line: point at a day, or focus it and use the arrow keys, to read that day. */
  function wireSpark() {
    const hit = $('.pl-spark-hit', el);
    if (!hit || !spark) return;
    const cols = [...hit.children];
    let at = cols.length - 1;
    const off = () => { cols.forEach((c) => c.classList.remove('is-on')); hideTip(); };
    const on = (i) => { at = Math.max(0, Math.min(cols.length - 1, i)); cols.forEach((c, j) => c.classList.toggle('is-on', j === at)); showTip(cols[at].firstElementChild, spark[at]); };
    cols.forEach((c, i) => { c.addEventListener('pointerenter', () => on(i)); c.addEventListener('click', () => on(i)); });
    hit.addEventListener('pointerleave', () => { if (document.activeElement !== hit) off(); });
    hit.addEventListener('focus', () => on(at));
    hit.addEventListener('blur', off);
    hit.addEventListener('keydown', (e) => {
      const to = { ArrowLeft: at - 1, ArrowRight: at + 1, Home: 0, End: cols.length - 1 }[e.key];
      if (to === undefined) return;
      e.preventDefault(); on(to);
    });
  }

  root.addEventListener('click', (e) => {
    const to = e.target.closest('[data-go]'), open = e.target.closest('[data-open]');
    if (to) { let opts = {}; try { opts = JSON.parse(to.dataset.opts || '{}'); } catch { /* go without options */ } ctx.go(to.dataset.go, opts); }
    else if (open) ctx.openEntity(open.dataset.open);
  });
  root.addEventListener('pointerover', (e) => { if (e.target.closest('.pl-spark-hit')) return; const t = e.target.closest('[data-tip]'); if (t) showTip(t); else hideTip(); });
  root.addEventListener('pointerleave', hideTip);
  root.addEventListener('focusin', (e) => { const t = e.target.closest('[data-tip]'); if (t && t.matches(':focus-visible')) showTip(t); });
  root.addEventListener('focusout', (e) => { if (!e.target.closest('.pl-spark-hit')) hideTip(); });
  root.addEventListener('scroll', hideTip, { passive: true });
  const onKey = (e) => { if (e.key === 'Escape') hideTip(); };
  document.addEventListener('keydown', onKey);

  render();
  loadLog();
  // Rings and bars draw in once, on arrival; later redraws from live changes stay still.
  const settle = setTimeout(() => root.classList.remove('is-first'), 1400);
  // Orders on track come from the production plan when that module is there.
  (async () => { try { planMod = await import('./plan.js'); if (alive) render(); } catch { /* fall back to due dates */ } })();
  const off = data.on(() => { if (!alive) return; render(); loadLog(); });

  return () => { alive = false; clearTimeout(settle); off(); stopField(); document.removeEventListener('keydown', onKey); };
}
