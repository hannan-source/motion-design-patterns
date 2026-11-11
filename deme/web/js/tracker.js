// Projects: the task tracker. One set of tasks, two ways to look at it: a board (To do, Doing,
// Blocked, Done) and a timeline. It runs the go-live of the ERP itself and any other project.
// Owners are functions first; a named person can be added later. Where a master's input is
// needed the task says so, and that is shown as an "Ask" mark on cards and bars.

import { api, data } from './api.js';
import { info, esc, toast, oops, busy, drawer, formHtml, readForm, fields, statusTag, fmtDate, fmtStamp, num, $, $$ } from './ui.js';
import { FUNCTIONS, TRACKS, GOLIVE_TEMPLATE } from '../shared/golive.js';
import { MODULES } from '../shared/schema.js';
import { iso, today, addWorkdays, workdayIndex, DAY, clamp } from '../shared/util.js';

const FN = Object.fromEntries(FUNCTIONS), TK = Object.fromEntries(TRACKS);
const STATUSES = [['todo', 'To do'], ['doing', 'Doing'], ['blocked', 'Blocked'], ['done', 'Done']];
const SCREENS = { home: 'Today', map: 'Business map', room: 'Production room', myday: 'My day', scan: 'Scan station', gate: 'Dispatch gate', pulse: 'Founder view' };
const DONE_CAP = 30;
const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const ICON = {
  ask: '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M3 2.5h10A1.5 1.5 0 0 1 14.5 4v5.5A1.5 1.5 0 0 1 13 11H8.4l-3.9 3v-3H3a1.5 1.5 0 0 1-1.5-1.5V4A1.5 1.5 0 0 1 3 2.5z" fill="currentColor"/></svg>',
  tick: '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  out: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M6.5 3.5h-3v9h9v-3M9.5 3.5h3v3M12.5 3.5l-5 5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  chev: '<svg class="tk-chev" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

const plural = (n, one, many = `${one}s`) => `${num(n)} ${n === 1 ? one : many}`;
const d0 = (s) => new Date(`${s}T00:00:00`);
const day = (s) => fmtDate(d0(s));
const addDays = (s, n) => { const d = d0(s); d.setDate(d.getDate() + n); return iso(d); };
const dayDiff = (a, b) => Math.round((d0(b) - d0(a)) / DAY);
const monday = (s) => addDays(s, -((d0(s).getDay() + 6) % 7));
const workSpan = (s, e) => workdayIndex(addWorkdays(d0(s), 0), d0(e)) + 1;
const initials = (name) => String(name || '').trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase();
const tc = (track) => (TK[track] ? `var(--tk-${track})` : 'var(--ink-3)');
const isLate = (t, T) => !!t.due && t.due < T && t.status !== 'done';
const screenName = (r) => SCREENS[r] || (r.startsWith('e-') ? data.entity(r.slice(2).replace(/-/g, '_'))?.name : r.startsWith('m-') ? MODULES[r.slice(2)]?.name : '') || '';
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
function nextMonday() { const d = today(); do d.setDate(d.getDate() + 1); while (d.getDay() !== 1); return iso(d); }

// What the person last chose here, kept while the app is open.
const mem = { project: null, view: 'board', group: 'none', lanes: new Map(), zoom: 'weeks', owner: '', person: '', track: '', mine: false, late: false, q: '', allDone: false, filtersOpen: false, closed: new Set(), planStart: '' };

export function mount(el, ctx) {
  const canP = () => data.canWrite('projects'), canT = () => data.canWrite('tasks');
  let open = null;            // the drawer: { d, id, mode }
  let pend = null, drag = null, dirty = false, raf = 0, quietUntil = 0;
  let asking = null;          // task whose card is asking why it is blocked
  let gantt = null;           // geometry of the timeline as drawn: { start, days, dw, lw, key }
  let seenKey = '';           // the timeline that was last scrolled to today
  let sum = { ring: 0, planned: 0, done: 0, tracks: {} };
  const moved = new Map(), dated = new Map(); // changes shown before the server answers

  el.innerHTML = `
    <div class="workspace tracker"><div class="workspace-inner">
      <div class="view-head rise">
        <div class="title-row"><h1 class="reveal">Projects</h1>${info('Each project is a set of tasks with an owner, a start and a due date. The board shows where each task stands; drag a card to another column, or use Move. The timeline shows the same tasks against the calendar; drag a bar to change its dates. Owners are functions, such as Stores, until a person is named. Masters do not use the system, so a task that needs their input carries an Ask mark: someone has to go and ask them.', 'Projects')}</div>
        ${canP() ? '<button class="btn btn-outline" type="button" id="tkNewProject">New project</button>' : ''}
      </div>
      <div class="tk-projects rise" style="--i:1" id="tkProjects" role="group" aria-label="Project"></div>
      <div id="tkPlan" class="rise" style="--i:2"></div>
      <div id="tkSummary" class="rise" style="--i:2"></div>
      <div id="tkControls" class="rise" style="--i:3"></div>
      <div id="tkMain" class="rise" style="--i:4"></div>
    </div><div class="tk-tip" id="tkTip" role="tooltip" hidden></div></div>`;
  const root = el.firstElementChild, ws = root, tip = $('#tkTip', root);
  const box = (id) => $(`#${id}`, root);

  // ───────── What is in view ─────────
  const golive = () => data.all('projects').find((p) => p.kind === 'golive') || null;
  const projects = () => data.all('projects').slice().sort((a, b) => (b.kind === 'golive') - (a.kind === 'golive') || String(a.name).localeCompare(String(b.name)));
  function project() {
    if (mem.project === null) mem.project = golive()?.id || 'all';
    if (mem.project !== 'all' && !data.get('projects', mem.project)) mem.project = 'all';
    return mem.project;
  }
  /** Tasks of the chosen project, with any change still on its way to the server already applied. */
  function scope() {
    const p = project();
    return data.all('tasks').filter((t) => p === 'all' || t.project === p).map((t) => (moved.has(t.id) || dated.has(t.id) ? { ...t, ...(dated.get(t.id) || {}), ...(moved.has(t.id) ? { status: moved.get(t.id) } : {}) } : t));
  }
  const text = (t) => [t.title, t.needs, t.doneWhen, t.notes, t.blockedBy, FN[t.ownerRole], TK[t.track], data.title('users', t.assignee)].join(' ').toLowerCase();
  function passes(t, T) {
    const q = mem.q.trim().toLowerCase();
    return (!mem.owner || t.ownerRole === mem.owner)
      && (!mem.person || (mem.person === '-' ? !t.assignee : t.assignee === mem.person))
      && (!mem.track || (mem.track === '-' ? !TK[t.track] : t.track === mem.track))
      && (!mem.mine || t.assignee === data.user.id) && (!mem.late || isLate(t, T)) && (!q || text(t).includes(q));
  }
  const filterCount = () => [mem.owner, mem.person, mem.track, mem.mine, mem.late, mem.q.trim()].filter(Boolean).length;
  const clearFilters = () => Object.assign(mem, { owner: '', person: '', track: '', mine: false, late: false, q: '' });

  // ───────── Small pieces shared by the board and the timeline ─────────
  const who = (t) => { const name = data.title('users', t.assignee); return name ? `<span class="tk-av" title="${esc(name)}" aria-label="${esc(name)}">${esc(initials(name))}</span>` : ''; };
  const askChip = (t) => (t.needs ? `<p class="tk-ask"><span class="tk-ask-mark">${ICON.ask}Ask</span><span class="tk-ask-who">${esc(t.needs)}</span></p>` : '');
  function dueHtml(t, T) {
    if (t.status === 'done') return `<span class="tk-due is-done">${ICON.tick}${t.doneOn ? `Done ${esc(day(t.doneOn))}` : 'Done'}</span>`;
    if (!t.due) return '<span class="tk-due is-none">No date</span>';
    const n = dayDiff(T, t.due);
    if (n < 0) return `<span class="tk-due is-late">Due ${esc(day(t.due))}<b>Late by ${esc(plural(-n, 'day'))}</b></span>`;
    if (n <= 3) return `<span class="tk-due is-soon">Due ${esc(day(t.due))}<b>${n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : `In ${n} days`}</b></span>`;
    return `<span class="tk-due">Due ${esc(day(t.due))}</span>`;
  }

  // ───────── Project switcher ─────────
  function drawProjects() {
    const ps = projects(), cur = project();
    const openCount = (id) => data.all('tasks').filter((t) => (id === 'all' || t.project === id) && t.status !== 'done').length;
    const chip = (id, name) => `<button type="button" class="tk-pchip" aria-pressed="${cur === id}" data-project="${esc(id)}"><span>${esc(name)}</span><span class="tk-pchip-n">${esc(num(openCount(id)))}</span></button>`;
    box('tkProjects').innerHTML = ps.length ? chip('all', 'All') + ps.map((p) => chip(p.id, p.name)).join('') : '';
    box('tkProjects').hidden = !ps.length;
  }

  // ───────── Create the go-live plan ─────────
  function planPreview(start) {
    const from = addWorkdays(d0(start), 0), first = monday(iso(from));
    const rows = GOLIVE_TEMPLATE.map((t) => ({ track: t.track, s: dayDiff(first, iso(addWorkdays(from, t.startDay))), e: dayDiff(first, iso(addWorkdays(from, t.startDay + t.days - 1))) }));
    const last = Math.max(...rows.map((r) => r.e)), weeks = Math.ceil((last + 1) / 7), span = weeks * 7;
    const pc = (x) => `${((x / span) * 100).toFixed(3)}%`;
    const fig = (n, label) => `<div><p class="tk-plan-n">${esc(num(n))}</p><p class="eyebrow">${esc(label)}</p></div>`;
    return {
      figs: `<div class="tk-plan-figs">${fig(GOLIVE_TEMPLATE.length, 'Tasks')}${fig(TRACKS.length, 'Tracks')}${fig(weeks, weeks === 1 ? 'Week' : 'Weeks')}</div><p class="tk-plan-range">${esc(day(iso(from)))} to ${esc(day(addDays(first, last)))}</p>`,
      mini: `
      <div class="tk-mini" role="img" aria-label="The ${TRACKS.length} tracks across ${weeks} weeks">
        <div class="tk-mini-axis" aria-hidden="true">${Array.from({ length: weeks }, (_, w) => `<span style="left:${pc(w * 7)}">${esc(day(addDays(first, w * 7)))}</span>`).join('')}</div>
        ${TRACKS.map(([k, name]) => { const mine = rows.filter((r) => r.track === k); return `<div class="tk-mini-row" style="--tc:${tc(k)}"><span class="tk-mini-name"><i class="tk-swatch"></i>${esc(name)}</span><span class="tk-mini-n">${mine.length}</span><span class="tk-mini-lane" style="--weeks:${weeks}">${mine.map((r) => `<i style="left:${pc(r.s)};width:${pc(r.e - r.s + 1)}"></i>`).join('')}</span></div>`; }).join('')}
      </div>` };
  }
  function drawPlan() {
    const host = box('tkPlan');
    if (golive() || !canP()) { host.innerHTML = ''; host.hidden = true; return; }
    if ($('#tkPlanStart', host)) return; // already drawn: leave the date being chosen alone
    const start = mem.planStart || nextMonday(), prev = planPreview(start);
    host.hidden = false;
    host.innerHTML = `
      <section class="panel tk-plan" aria-labelledby="tkPlanH">
        <div class="tk-plan-main">
          <p class="eyebrow">Go live with Deme Intelligence</p>
          <div class="title-row"><h2 id="tkPlanH">Create the go-live plan</h2>${info('This creates a project with every step each team takes to bring the ERP into daily use, in eight tracks. The dates and the owners are a proposal: after it is created you can move any task, change its length, give it to a person or delete it.', 'Go-live plan')}</div>
          <div id="tkPlanFigs">${prev.figs}</div>
          <div class="tk-plan-form">
            <div class="field"><label for="tkPlanStart">Start date</label><input class="input" type="date" id="tkPlanStart" value="${esc(start)}"></div>
            <button class="btn btn-primary tk-big" type="button" id="tkPlanCreate">Create the plan</button>
          </div>
        </div>
        <div class="tk-plan-prev" id="tkPlanPrev">${prev.mini}</div>
      </section>`;
  }

  // ───────── Summary strip ─────────
  function drawSummary(all, T) {
    const host = box('tkSummary');
    if (!all.length) { host.innerHTML = ''; host.hidden = true; return; }
    host.hidden = false;
    const total = all.length, done = all.filter((t) => t.status === 'done').length;
    const planned = all.filter((t) => t.due && t.due < T).length, late = all.filter((t) => isLate(t, T)).length, blocked = all.filter((t) => t.status === 'blocked').length;
    const gap = done - planned;
    const pace = gap > 0 ? `<span class="tag tag-ok">Ahead by ${esc(num(gap))}</span>` : gap < 0 ? `<span class="tag tag-warn">Behind by ${esc(num(-gap))}</span>` : '<span class="tag tag-ok">On plan</span>';
    const groups = [...TRACKS.map(([k, name]) => ({ k, name })), { k: '-', name: 'Other' }].map((g) => { const mine = all.filter((t) => (g.k === '-' ? !TK[t.track] : t.track === g.k)); return { ...g, n: mine.length, done: mine.filter((t) => t.status === 'done').length }; }).filter((g) => g.n);
    const showTracks = groups.some((g) => g.k !== '-');
    const C = 2 * Math.PI * 52, next = { ring: done / total, planned: planned / total, done: done / total, tracks: Object.fromEntries(groups.map((g) => [g.k, g.done / g.n])) };
    const pcOf = (x) => `${(x * 100).toFixed(1)}%`;
    host.innerHTML = `
      <section class="panel tk-sum" aria-label="Progress">
        <div class="tk-ring" role="img" aria-label="${esc(`${done} of ${total} tasks done`)}">
          <svg viewBox="0 0 120 120" aria-hidden="true"><circle class="tk-ring-bg" cx="60" cy="60" r="52"/><circle class="tk-ring-fg" cx="60" cy="60" r="52" transform="rotate(-90 60 60)" stroke-dasharray="${C.toFixed(2)}" style="stroke-dashoffset:${(C * (1 - sum.ring)).toFixed(2)}"/></svg>
          <div class="tk-ring-mid"><strong>${esc(num(done))}</strong><span>of ${esc(num(total))} done</span></div>
        </div>
        <div class="tk-pace">
          <div class="title-row"><p class="eyebrow">Planned against done</p>${info('Planned by today counts the tasks whose due date has passed. Done counts every finished task, early ones included. Late tasks are past their due date and not done. Blocked tasks are waiting on something written on the task.', 'Planned against done')}</div>
          <div class="tk-pace-row"><span>Planned by today</span><div class="tk-pace-bar is-plan"><i style="--v:${pcOf(sum.planned)}"></i></div><b>${esc(num(planned))}</b></div>
          <div class="tk-pace-row"><span>Done</span><div class="tk-pace-bar"><i style="--v:${pcOf(sum.done)}"></i></div><b>${esc(num(done))}</b></div>
          <div class="tk-pace-tags">${pace}${late ? `<span class="tag tag-crit">${esc(num(late))} late</span>` : ''}${blocked ? `<span class="tag tag-crit">${esc(num(blocked))} blocked</span>` : ''}</div>
        </div>
        ${showTracks ? `<div class="tk-tracks" role="group" aria-label="Tracks">${groups.map((g) => `<button type="button" class="tk-trk" style="--tc:${tc(g.k)}" data-trackf="${esc(g.k)}" aria-pressed="${mem.track === g.k}"><span class="tk-trk-name">${esc(g.name)}</span><span class="tk-trk-n">${g.done}/${g.n}</span><span class="tk-trk-bar"><i data-k="${esc(g.k)}" style="--v:${pcOf(sum.tracks[g.k] || 0)}"></i></span></button>`).join('')}</div>` : ''}
      </section>`;
    // Start from what was on screen and ease to the new figures.
    void host.offsetWidth;
    $('.tk-ring-fg', host).style.strokeDashoffset = (C * (1 - next.ring)).toFixed(2);
    const bars = $$('.tk-pace-bar i', host); bars[0].style.setProperty('--v', pcOf(next.planned)); bars[1].style.setProperty('--v', pcOf(next.done));
    $$('.tk-trk-bar i', host).forEach((i) => i.style.setProperty('--v', pcOf(next.tracks[i.dataset.k] || 0)));
    sum = next;
  }

  // ───────── Controls ─────────
  function drawControls(all) {
    const host = box('tkControls');
    if (!all.length) { host.innerHTML = ''; host.hidden = true; return; }
    host.hidden = false;
    const seg = (attr, cur, opts, label) => `<div class="seg" role="group" aria-label="${esc(label)}">${opts.map(([v, n]) => `<button type="button" data-${attr}="${v}" aria-pressed="${cur === v}">${esc(n)}</button>`).join('')}</div>`;
    const owners = FUNCTIONS.filter(([k]) => mem.owner === k || all.some((t) => t.ownerRole === k));
    const tracks = TRACKS.filter(([k]) => mem.track === k || all.some((t) => t.track === k));
    const people = data.users.filter((u) => u.active !== false || all.some((t) => t.assignee === u.id));
    const opt = (v, n, cur) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(n)}</option>`;
    const n = filterCount();
    host.innerHTML = `
      <div class="tk-controls${mem.filtersOpen ? ' is-open' : ''}">
        ${seg('mode', mem.view, [['board', 'Board'], ['timeline', 'Timeline']], 'View')}
        ${mem.view === 'board' ? `<div class="tk-seg-wrap"><span class="eyebrow">Group</span>${seg('group', mem.group, [['none', 'None'], ['track', 'Track'], ['owner', 'Owner']], 'Group by')}</div>` : `<div class="tk-seg-wrap"><span class="eyebrow">Zoom</span>${seg('zoom', mem.zoom, [['weeks', 'Weeks'], ['days', 'Days']], 'Zoom')}</div>`}
        <button type="button" class="tk-toggle tk-filter-btn" data-filters aria-expanded="${mem.filtersOpen}">Filters${n ? ` (${n})` : ''}</button>
        <div class="tk-filters">
          <select class="select" id="tkOwner" aria-label="Owner">${opt('', 'All owners', mem.owner)}${owners.map(([k, name]) => opt(k, name, mem.owner)).join('')}</select>
          <select class="select" id="tkPerson" aria-label="Person">${opt('', 'All people', mem.person)}${opt('-', 'No one yet', mem.person)}${people.map((u) => opt(u.id, u.name, mem.person)).join('')}</select>
          ${tracks.length ? `<select class="select" id="tkTrack" aria-label="Track">${opt('', 'All tracks', mem.track)}${tracks.map(([k, name]) => opt(k, name, mem.track)).join('')}</select>` : ''}
          <button type="button" class="tk-toggle" data-toggle="mine" aria-pressed="${mem.mine}">Mine</button>
          <button type="button" class="tk-toggle" data-toggle="late" aria-pressed="${mem.late}">Late</button>
          <input class="input tk-search" type="search" id="tkSearch" placeholder="Search" aria-label="Search tasks" value="${esc(mem.q)}">
          ${n ? '<button type="button" class="link tk-clear" data-clear>Clear</button>' : ''}
        </div>
        ${canT() ? '<button class="btn btn-primary tk-add" type="button" data-add>Add task</button>' : ''}
      </div>`;
  }

  // ───────── Board ─────────
  function cardHtml(t, T) {
    const ask = asking === t.id, late = isLate(t, T);
    return `
      <article class="tk-card${late ? ' is-late' : ''}${t.status === 'done' ? ' is-done' : ''}" data-task="${esc(t.id)}" data-status="${esc(t.status)}" style="--tc:${tc(t.track)}">
        <div class="tk-card-top">
          <span class="tk-track"><i class="tk-swatch"></i>${esc(TK[t.track] || 'Task')}</span>
          <span class="tk-card-tools">
            ${t.opens ? `<button type="button" class="tk-tool" data-go="${esc(t.id)}" aria-label="Open the screen${screenName(t.opens) ? `: ${esc(screenName(t.opens))}` : ''}" title="Open ${esc(screenName(t.opens) || 'the screen')}">${ICON.out}</button>` : ''}
            ${canT() && !ask ? `<button type="button" class="tk-tool tk-move" id="tkm-${esc(t.id)}" data-move="${esc(t.id)}" aria-expanded="false">Move${ICON.chev}</button>` : ''}
          </span>
        </div>
        <button type="button" class="tk-card-title" id="tkc-${esc(t.id)}" data-open="${esc(t.id)}">${esc(t.title)}</button>
        ${ask ? `<form class="tk-blockform" data-block="${esc(t.id)}"><label for="tkBlock">What is in the way</label><input class="input" id="tkBlock" name="reason" autocomplete="off" required><div class="tk-blockform-row"><button class="btn btn-primary btn-sm" type="submit">Block</button><button class="btn btn-quiet btn-sm" type="button" data-block-cancel>Cancel</button></div></form>` : ''}
        ${!ask && t.status === 'blocked' ? `<p class="tk-why"><span>Blocked</span>${esc(t.blockedBy || 'No reason given')}</p>` : ''}
        ${askChip(t)}
        <div class="tk-card-foot"><span class="tk-owner">${who(t)}<span>${esc(FN[t.ownerRole] || (t.assignee ? data.title('users', t.assignee) : 'No owner'))}</span></span>${dueHtml(t, T)}</div>
      </article>`;
  }
  function boardHtml(tasks, T) {
    const view = tasks.map((t) => (asking === t.id ? { ...t, status: 'blocked' } : t));
    const order = (a, b) => String(a.due || '9').localeCompare(String(b.due || '9')) || String(a.start || '9').localeCompare(String(b.start || '9')) || String(a.title).localeCompare(String(b.title));
    const recent = (a, b) => String(b.doneOn || '').localeCompare(String(a.doneOn || '')) || String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
    const doneAll = view.filter((t) => t.status === 'done').sort(recent);
    const doneShown = mem.allDone ? doneAll : doneAll.slice(0, DONE_CAP);
    const by = { todo: [], doing: [], blocked: [], done: doneShown };
    for (const t of view) if (t.status !== 'done') (by[t.status] || by.todo).push(t);
    for (const k of ['todo', 'doing', 'blocked']) by[k].sort(order);
    const count = (k) => (k === 'done' ? doneAll.length : by[k].length);
    const lanes = mem.group !== 'none';
    const groups = !lanes ? [{ k: '', name: '' }]
      : mem.group === 'track' ? [...TRACKS.map(([k, name]) => ({ k, name, c: tc(k) })), { k: '-', name: 'No track', c: tc('') }]
        : [...FUNCTIONS.map(([k, name]) => ({ k, name })), { k: '-', name: 'No owner' }];
    const inGroup = (t, g) => !lanes || (mem.group === 'track' ? (g.k === '-' ? !TK[t.track] : t.track === g.k) : (g.k === '-' ? !FN[t.ownerRole] : t.ownerRole === g.k));
    const laneHtml = (g) => {
      const mine = view.filter((t) => inGroup(t, g));
      if (lanes && !mine.length) return '';
      const done = mine.filter((t) => t.status === 'done').length, key = `${mem.group}:${g.k}`;
      const shown = !lanes || mine.some((t) => t.id === asking) || (mem.lanes.has(key) ? mem.lanes.get(key) : done < mine.length);
      return `
        <section class="tk-lane" ${g.c ? `style="--tc:${g.c}"` : ''}>
          ${lanes ? `<header class="tk-lane-head"><button type="button" class="tk-lane-label" id="tkn-${esc(key.replace(':', '-'))}" data-lane-fold="${esc(key)}" aria-expanded="${shown}">${ICON.chev}${g.c ? '<i class="tk-swatch"></i>' : ''}<h3>${esc(g.name)}</h3><span class="tk-lane-n">${done}/${mine.length} done</span><span class="tk-lane-bar"><i style="--v:${((done / mine.length) * 100).toFixed(1)}%"></i></span>${done === mine.length ? `<span class="tk-lane-tick">${ICON.tick}</span>` : ''}</button></header>` : ''}
          ${!shown ? '' : `<div class="tk-cells">${STATUSES.map(([k, name]) => { const cards = by[k].filter((t) => inGroup(t, g)); return `<div class="tk-cell" data-col="${k}" data-lane="${esc(g.k)}" aria-label="${esc(name)}${lanes ? `, ${esc(g.name)}` : ''}">${cards.map((t) => cardHtml(t, T)).join('')}${!cards.length && !lanes ? '<p class="tk-cell-none">Nothing here</p>' : ''}</div>`; }).join('')}</div>`}
        </section>`;
    };
    const more = doneAll.length > DONE_CAP ? `<button type="button" class="link tk-alldone" data-alldone>${mem.allDone ? `Show latest ${DONE_CAP}` : `Show all ${esc(num(doneAll.length))}`}</button>` : '';
    return `
      <div class="tk-colnav" role="group" aria-label="Jump to column">${STATUSES.map(([k, name], i) => `<button type="button" data-colnav="${i}" data-status="${k}" aria-pressed="${i === 0}"><span>${esc(name)}</span><b>${esc(num(count(k)))}</b></button>`).join('')}</div>
      <div class="tk-board${lanes ? ' is-lanes' : ''}" id="tkBoard"><div class="tk-board-in">
        <div class="tk-colheads">${STATUSES.map(([k, name]) => `<div class="tk-colhead" data-status="${k}"><i class="tk-dot" aria-hidden="true"></i><h2>${esc(name)}</h2><span class="tk-count">${esc(num(count(k)))}</span>${k === 'done' ? more : ''}</div>`).join('')}</div>
        ${groups.map(laneHtml).join('')}
      </div></div>`;
  }

  // ───────── Timeline ─────────
  function ganttHtml(tasks, T, width) {
    const narrow = width < 620;
    const rows = tasks.filter((t) => t.start || t.due).map((t) => { const s = t.start || t.due, e = t.due && t.due >= s ? t.due : s; return { ...t, s, e }; });
    const loose = tasks.filter((t) => !t.start && !t.due);
    const floor = addDays(T, -400), ceil = addDays(T, 800); // a mistyped year must not stretch the chart for ever
    let lo = T, hi = T;
    for (const r of rows) { if (r.s < lo) lo = r.s; if (r.e > hi) hi = r.e; }
    lo = lo < floor ? floor : lo; hi = hi > ceil ? ceil : hi;
    const start = monday(addDays(lo, -7)), days = dayDiff(start, addDays(monday(addDays(hi, 14)), 6)) + 1;
    const lw = narrow ? 146 : 300;
    const dw = mem.zoom === 'days' ? 34 : clamp(Math.floor((width - lw - 2) / days), narrow ? 12 : 14, 30);
    const x = (s) => dayDiff(start, s), t0 = x(T);
    gantt = { start, days, dw, lw, key: `${project()}|${mem.zoom}|${narrow}` };

    // Axis: months, week-start dates, and single days when zoomed in.
    let months = '', weeks = '', dayCells = '', from = 0;
    const month = (a, b) => { const d = d0(addDays(start, a)); return `<div class="tk-g-month" style="--n:${b - a}">${(b - a) * dw > 96 ? `<span>${esc(MONTHS[d.getMonth()])} ${d.getFullYear()}</span>` : ''}</div>`; };
    for (let i = 0; i < days; i++) {
      const d = d0(addDays(start, i));
      if (i > 0 && d.getDate() === 1) { months += month(from, i); from = i; }
      if (i % 7 === 0) weeks += `<span class="tk-g-week" style="--s:${i}">${esc(fmtDate(d))}</span>`;
      if (mem.zoom === 'days') dayCells += `<span class="tk-g-day${d.getDay() === 0 ? ' is-off' : ''}${i === t0 ? ' is-today' : ''}" style="--s:${i}"><i>${DOW[d.getDay()]}</i>${d.getDate()}</span>`;
    }

    const bar = (r) => {
      const late = isLate(r, T), n = Math.max(1, x(r.e) - x(r.s) + 1);
      const state = `${STATUSES.find(([k]) => k === r.status)?.[1] || ''}${late ? `, late by ${plural(dayDiff(r.due, T), 'day')}` : ''}`;
      return `${late && t0 > x(r.e) ? `<i class="tk-tail" style="--s:${x(r.e) + 1};--n:${t0 - x(r.e) - 0.5}"></i>` : ''}
        <div class="tk-bar is-${esc(r.status)}${late ? ' is-late' : ''}${canT() ? ' can-drag' : ''}" id="tkb-${esc(r.id)}" data-bar="${esc(r.id)}" tabindex="0" role="button" aria-label="${esc(`${r.title}. ${FN[r.ownerRole] || 'No owner'}. ${day(r.s)} to ${day(r.e)}. ${state}${r.needs ? `. Ask ${r.needs}` : ''}`)}" style="--s:${x(r.s)};--n:${n}">
          ${r.status === 'done' ? `<span class="tk-bar-tick">${ICON.tick}</span>` : ''}${r.needs ? `<span class="tk-bar-ask">${ICON.ask}</span>` : ''}${canT() ? '<span class="tk-bar-grip"></span>' : ''}
        </div>`;
    };
    const label = (r) => `<button type="button" class="tk-g-label" id="tkl-${esc(r.id)}" data-open="${esc(r.id)}"><span class="tk-g-title">${esc(r.title)}</span><span class="tk-g-owner">${r.needs ? `<span class="tk-g-askdot" title="Ask ${esc(r.needs)}">${ICON.ask}</span>` : ''}${esc(FN[r.ownerRole] || 'No owner')}${r.assignee ? ` · ${esc(data.title('users', r.assignee))}` : ''}</span></button>`;
    const hasTracks = tasks.some((t) => TK[t.track]);
    const groups = [...TRACKS.map(([k, name]) => ({ k, name })), { k: '-', name: hasTracks ? 'No track' : 'Tasks' }];
    const groupHtml = (g) => {
      const mine = rows.filter((r) => (g.k === '-' ? !TK[r.track] : r.track === g.k)).sort((a, b) => a.s.localeCompare(b.s) || a.e.localeCompare(b.e) || String(a.title).localeCompare(String(b.title)));
      if (!mine.length) return '';
      const done = mine.filter((r) => r.status === 'done').length, shut = mem.closed.has(g.k);
      const s = Math.min(...mine.map((r) => x(r.s))), e = Math.max(...mine.map((r) => x(r.e)));
      return `
        <div class="tk-g-group" style="--tc:${tc(g.k)}">
          <div class="tk-g-row is-group">
            <button type="button" class="tk-g-label" id="tkf-${esc(g.k)}" data-fold="${esc(g.k)}" aria-expanded="${!shut}">${ICON.chev}<i class="tk-swatch"></i><span class="tk-g-name">${esc(g.name)}</span><span class="tk-g-prog">${done}/${mine.length}</span><span class="tk-g-pbar"><i style="--v:${((done / mine.length) * 100).toFixed(1)}%"></i></span></button>
            <div class="tk-g-lane"><i class="tk-g-span" style="--s:${s};--n:${e - s + 1}"></i></div>
          </div>
          ${shut ? '' : mine.map((r) => `<div class="tk-g-row" data-row="${esc(r.id)}">${label(r)}<div class="tk-g-lane">${bar(r)}</div></div>`).join('')}
        </div>`;
    };
    const looseHtml = loose.length ? `
        <div class="tk-g-group is-loose" style="--tc:${tc('')}">
          <div class="tk-g-row is-group"><button type="button" class="tk-g-label" id="tkf-loose" data-fold="loose" aria-expanded="${!mem.closed.has('loose')}">${ICON.chev}<span class="tk-g-name">Unscheduled</span><span class="tk-g-prog">${loose.length}</span></button><div class="tk-g-lane"></div></div>
          ${mem.closed.has('loose') ? '' : loose.map((r) => `<div class="tk-g-row" data-row="${esc(r.id)}">${label(r)}<div class="tk-g-lane">${canT() ? `<button type="button" class="btn btn-sm btn-outline tk-setdates" data-setdates="${esc(r.id)}">Set dates</button>` : ''}</div></div>`).join('')}
        </div>` : '';
    const key = (cls, name) => `<span class="tk-key"><i class="${cls}"></i>${name}</span>`;
    return `
      <div class="tk-legend" aria-label="Key">${key('tk-bar is-todo', 'To do')}${key('tk-bar is-doing', 'Doing')}${key('tk-bar is-done', 'Done')}${key('tk-bar is-blocked', 'Blocked')}${key('tk-bar is-todo is-late', 'Late')}<span class="tk-key"><span class="tk-bar-ask">${ICON.ask}</span>Ask someone</span></div>
      <div class="tk-g${mem.zoom === 'days' ? ' is-days' : ''}" id="tkGantt" tabindex="0" role="group" aria-label="Timeline" style="--dw:${dw}px;--days:${days};--lw:${lw}px;--t:${t0}">
        <div class="tk-g-in">
          <div class="tk-g-head"><div class="tk-g-corner"><span class="eyebrow">Task</span></div><div class="tk-g-axis" aria-hidden="true"><div class="tk-g-months">${months}${month(from, days)}</div>${weeks}${dayCells}<span class="tk-g-now">Today</span></div></div>
          <div class="tk-g-body"><div class="tk-g-grid" aria-hidden="true"><i class="tk-g-today"></i></div>${groups.map(groupHtml).join('')}${looseHtml}</div>
        </div>
      </div>`;
  }

  function drawMain(all, T) {
    const host = box('tkMain');
    hideTip();
    if (!data.all('projects').length) { host.innerHTML = canP() ? '' : '<p class="tk-line">No projects yet.</p>'; return; }
    if (!all.length) { host.innerHTML = `<div class="panel empty"><h3>No tasks yet</h3>${canT() ? '<button class="btn btn-primary" type="button" data-add>Add task</button>' : ''}</div>`; return; }
    const shown = all.filter((t) => passes(t, T) || asking === t.id);
    if (!shown.length) { host.innerHTML = '<div class="panel empty"><h3>No tasks match</h3><button class="btn btn-outline" type="button" data-clear>Clear filters</button></div>'; return; }
    const board = $('#tkBoard', host), g = $('#tkGantt', host);
    const keep = { bx: board?.scrollLeft, gx: g?.scrollLeft, gy: g?.scrollTop };
    if (mem.view === 'board') {
      host.innerHTML = boardHtml(shown, T);
      const b = $('#tkBoard', host);
      if (keep.bx) b.scrollLeft = keep.bx;
      syncColnav();
      if (asking) $('#tkBlock', host)?.focus({ preventScroll: false });
    } else {
      host.innerHTML = ganttHtml(shown, T, host.clientWidth);
      const n = $('#tkGantt', host);
      if (seenKey === gantt.key && keep.gx !== undefined) { n.scrollLeft = keep.gx; n.scrollTop = keep.gy; }
      else { n.scrollLeft = Math.max(0, (dayDiff(gantt.start, T) + 0.5) * gantt.dw - (n.clientWidth - gantt.lw) * 0.3); seenKey = gantt.key; }
    }
  }

  function render() {
    if (drag) { dirty = true; return; }
    const a = document.activeElement, fid = a && root.contains(a) ? a.id : '', sel = fid && a.selectionStart != null && a.type !== 'date' ? [a.selectionStart, a.selectionEnd] : null;
    const T = iso(today()), all = scope();
    if (asking && !all.some((t) => t.id === asking)) asking = null;
    drawProjects(); drawPlan(); drawSummary(all, T); drawControls(all); drawMain(all, T);
    if (fid && document.activeElement?.id !== fid) { const n = $(`#${CSS.escape(fid)}`, root); if (n) { n.focus({ preventScroll: true }); if (sel) try { n.setSelectionRange(sel[0], sel[1]); } catch { /* not a text box */ } } }
    refreshDrawer();
  }
  const redrawMain = () => drawMain(scope(), iso(today()));

  function syncColnav() {
    const b = $('#tkBoard', root), nav = $('.tk-colnav', root);
    if (!b || !nav) return;
    const cells = $$('.tk-colhead', b), left = b.getBoundingClientRect().left;
    let at = 0, best = Infinity;
    cells.forEach((c, i) => { const d = Math.abs(c.getBoundingClientRect().left - left - 16); if (d < best) { best = d; at = i; } });
    $$('button', nav).forEach((n, i) => n.setAttribute('aria-pressed', String(i === at)));
  }

  // ───────── Tooltip over the timeline ─────────
  function tipHtml(t, T) {
    const s = t.start || t.due, e = t.due || t.start, late = isLate(t, T);
    return `<strong>${esc(TK[t.track] || 'Task')} · ${esc(STATUSES.find(([k]) => k === t.status)?.[1] || '')}${late ? ` · late by ${esc(plural(dayDiff(t.due, T), 'day'))}` : ''}</strong>
      <p class="tk-tip-title">${esc(t.title)}</p>
      <p>${esc(FN[t.ownerRole] || 'No owner')}${t.assignee ? ` · ${esc(data.title('users', t.assignee))}` : ''}</p>
      <p>${esc(day(s))} to ${esc(day(e))} · ${esc(plural(workSpan(s, e), 'working day'))}</p>
      ${t.needs ? `<p><em>Ask</em>${esc(t.needs)}</p>` : ''}${t.doneWhen ? `<p><em>Done when</em>${esc(t.doneWhen)}</p>` : ''}${t.status === 'blocked' && t.blockedBy ? `<p><em>Blocked by</em>${esc(t.blockedBy)}</p>` : ''}`;
  }
  function placeTip(node) {
    const g = $('#tkGantt', root); if (!g) return;
    const r = node.getBoundingClientRect(), gr = g.getBoundingClientRect();
    tip.hidden = false;
    const L = Math.max(r.left, gr.left + (gantt?.lw || 0)), R = Math.min(r.right, gr.right), w = tip.offsetWidth, h = tip.offsetHeight;
    tip.style.left = `${clamp((L + Math.max(L, R)) / 2 - w / 2, 8, Math.max(8, innerWidth - w - 8))}px`;
    tip.style.top = `${r.top - h - 10 < 8 ? r.bottom + 10 : r.top - h - 10}px`;
  }
  function showTip(node) { const t = scope().find((x) => x.id === node.dataset.bar); if (!t || drag) return; tip.innerHTML = tipHtml(t, iso(today())); tip.classList.remove('is-dates'); placeTip(node); }
  function hideTip() { tip.hidden = true; }

  // ───────── Dragging: cards between columns, bars along the calendar ─────────
  // Pointer events, so it works with a mouse and with a finger. A mouse drags after a few pixels.
  // A finger must rest for a moment first, so a swipe still scrolls the page.
  function arm(e, st) {
    pend = Object.assign(st, { pid: e.pointerId, touch: e.pointerType === 'touch', x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, live: false });
    if (st.touch) st.timer = setTimeout(() => { if (pend === st) lift(st); }, 260);
    document.addEventListener('pointermove', onMove); document.addEventListener('pointerup', onUp); document.addEventListener('pointercancel', onCancel);
  }
  function disarm() {
    if (pend) clearTimeout(pend.timer);
    pend = null;
    document.removeEventListener('pointermove', onMove); document.removeEventListener('pointerup', onUp); document.removeEventListener('pointercancel', onCancel);
  }
  function onMove(e) {
    const st = pend; if (!st || e.pointerId !== st.pid) return;
    st.x = e.clientX; st.y = e.clientY;
    if (!st.live) { const far = Math.hypot(st.x - st.x0, st.y - st.y0); if (far < (st.touch ? 10 : 5)) return; if (st.touch) return disarm(); lift(st); }
    step(st);
  }
  function onUp(e) { const st = pend; if (!st || e.pointerId !== st.pid || st.landing) return; if (!st.live) return disarm(); st.landing = true; quietUntil = Date.now() + 500; drop(st); }
  function onCancel(e) { const st = pend; if (!st || e.pointerId !== st.pid || st.landing) return; if (!st.live) return disarm(); finish(st); after(); }
  function lift(st) {
    clearTimeout(st.timer);
    const t = scope().find((x) => x.id === st.id);
    if (!t || !st.node.isConnected) return disarm();
    st.live = true; st.t = t; drag = st; closeMenus(); hideTip();
    root.classList.add('is-dragging');
    if (st.touch) try { navigator.vibrate?.(8); } catch { /* not allowed */ }
    if (st.kind === 'card') {
      const r = st.node.getBoundingClientRect();
      st.rect = r; st.cell0 = st.node.parentElement; st.over = st.cell0; st.cells = $$('.tk-cell', st.node.closest('.tk-cells'));
      st.ghost = st.node.cloneNode(true); st.ghost.classList.add('tk-ghost'); st.ghost.removeAttribute('data-task'); $$('[id]', st.ghost).forEach((n) => n.removeAttribute('id'));
      Object.assign(st.ghost.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
      st.ph = document.createElement('div'); st.ph.className = 'tk-ph'; st.ph.style.height = `${r.height}px`;
      st.node.after(st.ph); st.node.classList.add('is-lifted'); st.cell0.classList.add('is-over');
      root.appendChild(st.ghost);
    } else {
      const g = $('#tkGantt', root);
      st.g = g; st.sx0 = g.scrollLeft; st.s = t.start || t.due; st.e = t.due && t.due >= st.s ? t.due : st.s; st.ns = st.s; st.ne = st.e;
      st.node.classList.add('is-drag'); root.classList.add(st.kind === 'size' ? 'is-sizing' : 'is-shifting');
    }
    cancelAnimationFrame(raf); raf = requestAnimationFrame(edge);
  }
  function step(st) {
    if (st.kind === 'card') {
      st.ghost.style.transform = `translate3d(${st.x - st.x0}px, ${st.y - st.y0}px, 0) rotate(1.5deg)`;
      const hit = st.cells.find((c) => { const r = c.getBoundingClientRect(); return st.x >= r.left && st.x <= r.right; });
      if (hit && hit !== st.over) {
        st.over.classList.remove('is-over'); hit.classList.add('is-over'); st.over = hit;
        if (hit === st.cell0) st.node.after(st.ph); else hit.prepend(st.ph);
      }
      return;
    }
    const dd = Math.round((st.x - st.x0 + st.g.scrollLeft - st.sx0) / gantt.dw);
    if (st.kind === 'shift') {
      st.ns = iso(addWorkdays(d0(addDays(st.s, dd)), 0));
      st.ne = iso(addWorkdays(d0(st.ns), workSpan(st.s, st.e) - 1));
    } else {
      let e = addDays(st.e, dd);
      if (d0(e).getDay() === 0) e = addDays(e, dd > 0 ? 1 : -1);
      st.ne = e < st.s ? st.s : e;
    }
    st.node.style.setProperty('--s', dayDiff(gantt.start, st.ns));
    st.node.style.setProperty('--n', dayDiff(st.ns, st.ne) + 1);
    tip.innerHTML = `<strong>${st.kind === 'size' ? 'New length' : 'New dates'}</strong><p class="tk-tip-title">${esc(day(st.ns))} to ${esc(day(st.ne))}</p><p>${esc(plural(workSpan(st.ns, st.ne), 'working day'))}</p>`;
    tip.classList.add('is-dates'); placeTip(st.node);
  }
  /** While something is held near an edge, scroll what is under it. */
  function edge() {
    const st = drag; if (!st) return;
    const sc = st.kind === 'card' ? $('#tkBoard', root) : st.g;
    let stepped = false;
    if (sc && sc.scrollWidth > sc.clientWidth + 1) {
      const r = sc.getBoundingClientRect(), left = r.left + (st.kind === 'card' ? 0 : gantt.lw);
      const v = st.x < left + 44 ? -1 : st.x > r.right - 44 ? 1 : 0;
      if (v) { const before = sc.scrollLeft; sc.scrollLeft += v * 9; stepped = sc.scrollLeft !== before; }
    }
    if (st.kind === 'card') {
      const r = ws.getBoundingClientRect(), v = st.y < r.top + 56 ? -1 : st.y > r.bottom - 56 ? 1 : 0;
      if (v) ws.scrollTop += v * 10;
    }
    if (stepped) step(st);
    raf = requestAnimationFrame(edge);
  }
  /** Put the screen back as it was before the lift. */
  function finish(st) {
    cancelAnimationFrame(raf); disarm(); drag = null;
    root.classList.remove('is-dragging', 'is-sizing', 'is-shifting');
    st.ghost?.remove(); st.ph?.remove(); st.over?.classList.remove('is-over');
    st.node.classList.remove('is-lifted', 'is-drag');
    hideTip(); quietUntil = Date.now() + 350;
  }
  const after = () => { dirty = false; render(); };
  function drop(st) {
    if (st.kind === 'card') {
      const to = st.over.dataset.col;
      const land = () => { finish(st); if (to !== st.t.status) moveTo(st.id, to); else after(); };
      if (reduced()) return land();
      const p = st.ph.getBoundingClientRect();
      document.removeEventListener('pointermove', onMove);
      st.ghost.classList.add('is-landing');
      st.ghost.style.transform = `translate3d(${p.left - st.rect.left}px, ${p.top - st.rect.top}px, 0)`;
      setTimeout(land, 200);
      return;
    }
    const changed = st.ns !== (st.t.start || '') || st.ne !== (st.t.due || '');
    finish(st);
    if (!changed) return after();
    dated.set(st.id, { start: st.ns, due: st.ne }); after();
    api.update('tasks', st.id, { start: st.ns, due: st.ne }).catch(oops).finally(() => { dated.delete(st.id); render(); });
  }

  // ───────── Changing a task ─────────
  function moveTo(id, status) {
    const t = data.get('tasks', id);
    if (!t || t.status === status) return render();
    if (status === 'blocked') { asking = id; return render(); }
    moved.set(id, status); render();
    api.act('task.move', { id, status }).catch(oops).finally(() => { moved.delete(id); render(); });
  }
  async function block(id, reason) {
    const on = { entity: 'tasks', id }, t = data.get('tasks', id);
    asking = null; moved.set(id, 'blocked'); render();
    try { if (t?.status === 'done') await api.act('task.reopen', {}, on); const out = await api.act('task.block', { reason }, on); toast(out.message || 'Marked as blocked.'); }
    catch (e) { oops(e); } finally { moved.delete(id); render(); }
  }
  function closeMenus() { $$('.tk-menu', root).forEach((m) => m.remove()); $$('.tk-move[aria-expanded="true"]', root).forEach((b) => b.setAttribute('aria-expanded', 'false')); }
  function openMenu(btn) {
    const wasOpen = btn.getAttribute('aria-expanded') === 'true';
    closeMenus();
    if (wasOpen) return;
    const card = btn.closest('.tk-card'), cur = card.dataset.status;
    btn.setAttribute('aria-expanded', 'true');
    const menu = document.createElement('div');
    menu.className = 'tk-menu'; menu.setAttribute('role', 'group'); menu.setAttribute('aria-label', 'Move to');
    menu.innerHTML = STATUSES.map(([k, name]) => `<button type="button" data-to="${k}" data-status="${k}" ${k === cur ? 'aria-current="true" disabled' : ''}><i class="tk-dot" aria-hidden="true"></i>${esc(name)}</button>`).join('');
    card.querySelector('.tk-card-top').after(menu);
    menu.querySelector('button:not([disabled])')?.focus();
  }

  // ───────── Drawers ─────────
  const head = (eyebrow, title) => `<header class="drawer-head"><div><p class="eyebrow tk-d-eyebrow">${eyebrow}</p><h2>${esc(title)}</h2></div><button class="icon-btn" type="button" data-close aria-label="Close">×</button></header>`;
  function taskHtml(t) {
    const T = iso(today()), can = canT(), late = isLate(t, T), p = data.get('projects', t.project);
    const acts = can ? (data.entity('tasks').actions || []).filter((a) => a.when.includes(t.status)) : [];
    const people = data.users.filter((u) => u.active !== false || u.id === t.assignee);
    const fact = (label, html) => `<div><dt>${esc(label)}</dt><dd>${html}</dd></div>`;
    const long = (label, value) => (value ? `<div class="tk-d-long"><p class="eyebrow">${esc(label)}</p><p>${esc(value)}</p></div>` : '');
    return `
      <div class="tracker tk-drawer">
        ${head(`<i class="tk-swatch" style="--tc:${tc(t.track)}"></i>${esc(TK[t.track] || 'Task')}${p ? ` · ${esc(p.name)}` : ''}`, t.title)}
        <div class="drawer-body">
          <div class="tk-d-status">
            <span class="tk-d-tags">${statusTag('tasks', t.status)}${late ? `<span class="tag tag-crit">Late by ${esc(plural(dayDiff(t.due, T), 'day'))}</span>` : ''}${t.status === 'done' && t.doneOn ? `<span class="tk-d-note">Done on ${esc(day(t.doneOn))}</span>` : ''}</span>
            <span class="tk-d-steps">${acts.map((a) => `<button class="btn ${a.id === 'task.done' ? 'btn-primary' : 'btn-outline'}" type="button" data-step="${esc(a.id)}">${esc(a.label)}</button>`).join('')}</span>
          </div>
          <form class="action-form tk-d-reason" id="tkdReasonForm" hidden><div class="field"><label for="tkdReason">What is in the way</label><input class="input" id="tkdReason" autocomplete="off" required></div><div class="row"><button class="btn btn-primary" type="submit">Mark as blocked</button><button class="btn btn-quiet" type="button" data-reason-cancel>Cancel</button></div></form>
          ${t.status === 'blocked' ? `<div class="tk-d-blocked"><p class="eyebrow">Blocked by</p><p>${esc(t.blockedBy || 'No reason given')}</p></div>` : ''}
          <dl class="facts">${fact('Track', `<span class="tk-d-track" style="--tc:${tc(t.track)}"><i class="tk-swatch"></i>${esc(TK[t.track] || 'None')}</span>`)}${fact('Owner', esc(FN[t.ownerRole] || 'None'))}${can ? '' : fact('Person', esc(data.title('users', t.assignee) || 'No one yet')) + fact('Start', t.start ? esc(day(t.start)) : '–') + fact('Due', t.due ? esc(day(t.due)) : '–')}</dl>
          ${can ? `<div class="tk-d-edit">
            <div class="field"><label for="tkdPerson">Person</label><select class="select" id="tkdPerson"><option value="">No one yet</option>${people.map((u) => `<option value="${esc(u.id)}" ${u.id === t.assignee ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select></div>
            <div class="field"><label for="tkdStart">Start</label><input class="input" type="date" id="tkdStart" value="${esc(t.start || '')}"></div>
            <div class="field"><label for="tkdDue">Due</label><input class="input" type="date" id="tkdDue" value="${esc(t.due || '')}"></div>
          </div>` : ''}
          ${t.needs ? `<div class="tk-d-ask"><p class="eyebrow"><span class="tk-bar-ask">${ICON.ask}</span>Needs input from</p><p>${esc(t.needs)}</p></div>` : ''}
          ${long('Done when', t.doneWhen)}${long('Notes', t.notes)}
          ${t.opens ? `<div class="row"><button class="btn btn-outline" type="button" data-screen>Open the screen</button>${screenName(t.opens) ? `<span class="eyebrow">${esc(screenName(t.opens))}</span>` : ''}</div>` : ''}
          <div class="row">${can ? '<button class="btn btn-sm btn-outline" type="button" data-edit>Edit</button>' : ''}${data.can('projects', 'admin') ? '<button class="btn btn-sm btn-quiet" type="button" data-delete>Delete</button>' : ''}</div>
          <div class="trail"><p class="eyebrow">Activity</p><ul class="trail-list"><li class="faint">Loading</li></ul></div>
        </div>
      </div>`;
  }
  function loadTrail() {
    const mine = open;
    api.audit('tasks', mine.id).then((logs) => {
      const ul = open === mine && mine.mode === 'view' ? $('.trail-list', mine.d.el) : null;
      if (ul) ul.innerHTML = logs.length ? logs.map((l) => `<li><span class="mono faint">${esc(fmtStamp(l.at))}</span><span>${esc(l.text)}</span><span class="faint">${esc(l.userName || '')}</span></li>`).join('') : '<li class="faint">Nothing yet</li>';
    }).catch(() => {});
  }
  function openTask(id, focus) {
    const t = data.get('tasks', id);
    if (!t) return;
    closeMenus(); hideTip();
    const d = drawer(taskHtml(t), { onClose: () => { clearTimeout(open?.saver); open = null; } });
    open = { d, id, mode: 'view' };
    wireTask(); loadTrail();
    if (focus) $(`#${focus}`, d.el)?.focus();
  }
  function refreshDrawer() {
    if (!open || open.mode !== 'view') return;
    const t = data.get('tasks', open.id);
    if (!t) return open.d.close();
    const a = document.activeElement, inside = a && open.d.el.contains(a);
    if (inside && (a.type === 'date' || a.id === 'tkdReason')) { open.stale = true; return; } // do not pull a field away mid-entry
    open.stale = false;
    open.d.set(taskHtml(t)); loadTrail();
    if (inside && a.id) $(`#${CSS.escape(a.id)}`, open.d.el)?.focus(); else if (inside) open.d.el.focus();
  }
  function wireTask() {
    const { d, id } = open, on = { entity: 'tasks', id };
    const save = (input) => api.update('tasks', id, input).then(() => toast('Saved')).catch(oops);
    d.el.onclick = (ev) => {
      if (!open || open.mode !== 'view') return;
      const t = data.get('tasks', id), step = ev.target.closest('[data-step]'), del = ev.target.closest('[data-delete]');
      if (!t) return;
      if (step) {
        const a = data.entity('tasks').actions.find((x) => x.id === step.dataset.step);
        if (a.form) { const f = $('#tkdReasonForm', d.el); f.hidden = false; $('#tkdReason', d.el).focus(); return; }
        busy(step, async () => { const out = await api.act(a.id, {}, on); toast(out.message || `${a.label}: done`); });
      } else if (ev.target.closest('[data-reason-cancel]')) { $('#tkdReasonForm', d.el).hidden = true; $('#tkdReason', d.el).value = ''; if (open.stale) refreshDrawer(); }
      else if (ev.target.closest('[data-screen]')) { const to = t.opens; d.close(); ctx.go(to); }
      else if (ev.target.closest('[data-edit]')) taskForm(id);
      else if (del) {
        if (del.dataset.sure) busy(del, async () => { await api.remove('tasks', id); toast('Task deleted'); });
        else { del.dataset.sure = '1'; del.textContent = 'Tap again to delete'; }
      }
    };
    d.el.onsubmit = (ev) => {
      if (ev.target.id !== 'tkdReasonForm') return;
      ev.preventDefault();
      const reason = $('#tkdReason', d.el).value.trim();
      if (!reason) return $('#tkdReason', d.el).focus();
      busy(ev.target.querySelector('[type="submit"]'), async () => { $('#tkdReason', d.el).blur(); const out = await api.act('task.block', { reason }, on); toast(out.message || 'Marked as blocked.'); });
    };
    d.el.onchange = (ev) => {
      if (!open || open.mode !== 'view') return;
      const c = ev.target;
      if (c.id === 'tkdPerson') save({ assignee: c.value });
      else if (c.id === 'tkdStart' || c.id === 'tkdDue') {
        // A date typed part by part reports several changes: wait for the last one.
        clearTimeout(open.saver);
        open.saver = setTimeout(() => {
          if (!open || open.id !== id || open.mode !== 'view') return;
          let start = $('#tkdStart', d.el).value, due = $('#tkdDue', d.el).value;
          if (start && due && start > due) { if (c.id === 'tkdStart') due = start; else start = due; }
          const t = data.get('tasks', id);
          if (t && (t.start || '') === start && (t.due || '') === due) return;
          save({ start, due });
        }, 450);
      }
    };
    if (!d.wired) { d.wired = true; d.el.addEventListener('focusout', () => setTimeout(() => { if (open?.d === d && open.stale) refreshDrawer(); }, 0)); }
  }
  /** The full form in the drawer: a new project, a new task, or a task being edited. */
  function formDrawer({ entity, eyebrow, title, values, submit, save, back }) {
    const fs = fields(entity);
    const html = `<div class="tracker tk-drawer">${head(esc(eyebrow), title)}
      <form class="drawer-body form-grid" novalidate>${formHtml(fs, values)}
        <p class="error wide" role="alert" hidden></p>
        <div class="row wide"><button class="btn btn-primary" type="submit">${esc(submit)}</button><button class="btn btn-quiet" type="button" ${back ? 'data-back' : 'data-close'}>Cancel</button></div></form></div>`;
    let d;
    if (back && open) { d = open.d; d.set(html); d.el.onchange = null; d.el.onsubmit = null; d.el.scrollTop = 0; }
    else { d = drawer(html, { onClose: () => { open = null; } }); open = { d, id: null, mode: 'form' }; }
    open.mode = 'form';
    const form = $('form', d.el), err = $('.error', form);
    form.querySelector('input,select,textarea')?.focus();
    d.el.onclick = (ev) => { if (ev.target.closest('[data-back]')) back(); };
    form.onsubmit = (ev) => {
      ev.preventDefault(); err.hidden = true;
      busy(form.querySelector('[type="submit"]'), async () => {
        try { await save(readForm(form, fs), d); } catch (ex) { err.textContent = ex.message; err.hidden = false; err.scrollIntoView({ block: 'nearest' }); }
      });
    };
  }
  function showTask(id) { const t = data.get('tasks', id); if (!open || !t) return; open.mode = 'view'; open.id = id; open.d.set(taskHtml(t)); wireTask(); loadTrail(); open.d.el.focus(); }
  function taskForm(id) {
    const t = id ? data.get('tasks', id) : null, ps = data.all('projects');
    const p = project() !== 'all' ? project() : ps.length === 1 ? ps[0].id : '';
    formDrawer({
      entity: 'tasks', eyebrow: t ? 'Edit task' : 'New task', title: t ? t.title : 'Task', submit: t ? 'Save' : 'Add task',
      values: t || { project: p, track: TK[mem.track] ? mem.track : '', ownerRole: mem.owner, start: iso(today()) },
      back: t ? () => showTask(id) : null,
      save: async (input, d) => {
        if (t) { await api.update('tasks', id, input); toast('Saved'); showTask(id); }
        else { await api.create('tasks', input); toast('Task added'); d.close(); }
      },
    });
  }
  function projectForm() {
    formDrawer({
      entity: 'projects', eyebrow: 'New project', title: 'Project', submit: 'Add project', values: { start: iso(today()), owner: data.user.id },
      save: async (input, d) => { const out = await api.create('projects', input); mem.project = out.doc.id; toast('Project added'); d.close(); render(); },
    });
  }

  // ───────── Events ─────────
  const onClick = (e) => {
    if (Date.now() < quietUntil) return;
    const t = e.target, hit = (sel) => { const n = t.closest(sel); return n && root.contains(n) ? n : null; };
    let b;
    if ((b = hit('[data-project]'))) { mem.project = b.dataset.project; mem.allDone = false; asking = null; render(); }
    else if (hit('#tkNewProject')) projectForm();
    else if ((b = hit('#tkPlanCreate'))) busy(b, async () => { const out = await api.act('golive.create', { start: $('#tkPlanStart', root).value }); mem.project = out.data?.project || golive()?.id || 'all'; toast(out.message || 'Go-live plan created.'); render(); });
    else if ((b = hit('[data-trackf]'))) { mem.track = mem.track === b.dataset.trackf ? '' : b.dataset.trackf; render(); }
    else if ((b = hit('[data-mode]'))) { mem.view = b.dataset.mode; asking = null; render(); }
    else if ((b = hit('[data-group]'))) { mem.group = b.dataset.group; render(); }
    else if ((b = hit('[data-zoom]'))) { mem.zoom = b.dataset.zoom; render(); }
    else if ((b = hit('[data-toggle]'))) { mem[b.dataset.toggle] = !mem[b.dataset.toggle]; render(); }
    else if (hit('[data-clear]')) { clearFilters(); render(); }
    else if (hit('[data-filters]')) { mem.filtersOpen = !mem.filtersOpen; render(); }
    else if (hit('[data-add]')) taskForm(null);
    else if (hit('[data-alldone]')) { mem.allDone = !mem.allDone; redrawMain(); }
    else if ((b = hit('[data-colnav]'))) { const head = $$('.tk-colhead', root)[Number(b.dataset.colnav)], board = $('#tkBoard', root); board.scrollTo({ left: board.scrollLeft + head.getBoundingClientRect().left - board.getBoundingClientRect().left - 16, behavior: reduced() ? 'auto' : 'smooth' }); }
    else if ((b = hit('[data-move]'))) openMenu(b);
    else if ((b = hit('[data-to]'))) { const id = b.closest('.tk-card').dataset.task; closeMenus(); moveTo(id, b.dataset.to); }
    else if ((b = hit('[data-go]'))) { const task = data.get('tasks', b.dataset.go); if (task?.opens) ctx.go(task.opens); }
    else if (hit('[data-block-cancel]')) { asking = null; render(); }
    else if ((b = hit('[data-lane-fold]'))) { mem.lanes.set(b.dataset.laneFold, b.getAttribute('aria-expanded') !== 'true'); render(); }
    else if ((b = hit('[data-fold]'))) { const k = b.dataset.fold; if (mem.closed.has(k)) mem.closed.delete(k); else mem.closed.add(k); render(); }
    else if ((b = hit('[data-setdates]'))) openTask(b.dataset.setdates, 'tkdStart');
    else if ((b = hit('[data-open]'))) openTask(b.dataset.open);
    else if ((b = hit('.tk-bar[data-bar]'))) openTask(b.dataset.bar);
    else if ((b = hit('.tk-card')) && !hit('button, form, input, .tk-menu')) openTask(b.dataset.task);
  };
  const onChange = (e) => {
    const c = e.target;
    if (c.id === 'tkOwner') { mem.owner = c.value; render(); }
    else if (c.id === 'tkPerson') { mem.person = c.value; render(); }
    else if (c.id === 'tkTrack') { mem.track = c.value; render(); }
    else if (c.id === 'tkPlanStart' && c.value) { mem.planStart = c.value; const prev = planPreview(c.value); box('tkPlanFigs').innerHTML = prev.figs; box('tkPlanPrev').innerHTML = prev.mini; }
  };
  const onInput = (e) => { if (e.target.id === 'tkSearch') { mem.q = e.target.value; redrawMain(); } };
  const onSubmit = (e) => {
    const f = e.target.closest('.tk-blockform'); if (!f) return;
    e.preventDefault();
    const reason = f.elements.reason.value.trim();
    if (!reason) return f.elements.reason.focus();
    block(f.dataset.block, reason);
  };
  const onDown = (e) => {
    if (e.button > 0 || !e.isPrimary || pend || drag || !canT()) return;
    const bar = e.target.closest('.tk-bar[data-bar]'), card = e.target.closest('.tk-card');
    if (bar) arm(e, { kind: e.target.closest('.tk-bar-grip') ? 'size' : 'shift', node: bar, id: bar.dataset.bar });
    else if (card && card.dataset.task !== asking && !e.target.closest('.tk-card-tools, .tk-menu, form')) arm(e, { kind: 'card', node: card, id: card.dataset.task });
  };
  const onKey = (e) => {
    if (e.key === 'Escape') { if (drag) { const st = drag; finish(st); after(); } else if ($('.tk-menu', root)) { const b = $('.tk-move[aria-expanded="true"]', root); closeMenus(); b?.focus(); } else if (asking && !open) { asking = null; render(); } }
    else if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('.tk-bar[data-bar]')) { e.preventDefault(); openTask(e.target.dataset.bar); }
  };
  const onOver = (e) => { const b = e.target.closest?.('.tk-bar[data-bar]'); if (b && !drag && e.pointerType !== 'touch') showTip(b); };
  const onOut = (e) => { const b = e.target.closest?.('.tk-bar[data-bar]'); if (b && !drag && !b.contains(e.relatedTarget) && !b.matches(':focus-visible')) hideTip(); };
  const onFocusIn = (e) => { if (e.target.matches?.('.tk-bar[data-bar]') && e.target.matches(':focus-visible')) showTip(e.target); };
  const onFocusOut = (e) => { if (e.target.matches?.('.tk-bar[data-bar]') && !drag) hideTip(); };
  const onScroll = (e) => { if (e.target.id === 'tkBoard') syncColnav(); else if (e.target.id === 'tkGantt' && !drag) hideTip(); };
  const onTouchMove = (e) => { if (drag && e.cancelable) e.preventDefault(); };
  const onMenu = (e) => { if (drag || pend?.touch) e.preventDefault(); };
  let resizeT = 0, lastW = root.clientWidth;
  const onResize = () => { clearTimeout(resizeT); resizeT = setTimeout(() => { if (root.clientWidth !== lastW) { lastW = root.clientWidth; if (mem.view === 'timeline' && !drag) redrawMain(); } }, 150); };

  root.addEventListener('click', onClick); root.addEventListener('change', onChange); root.addEventListener('input', onInput); root.addEventListener('submit', onSubmit);
  root.addEventListener('pointerdown', onDown); root.addEventListener('pointerover', onOver); root.addEventListener('pointerout', onOut);
  root.addEventListener('focusin', onFocusIn); root.addEventListener('focusout', onFocusOut); root.addEventListener('scroll', onScroll, true);
  root.addEventListener('touchmove', onTouchMove, { passive: false }); root.addEventListener('contextmenu', onMenu);
  document.addEventListener('keydown', onKey); window.addEventListener('resize', onResize);

  // ───────── Opened from another screen ─────────
  const o = ctx.opts || {};
  let first = null;
  if (o.track || o.owner || o.task) {
    clearFilters();
    if (o.track && TK[o.track]) { mem.track = o.track; if (golive()) mem.project = golive().id; }
    if (o.owner && FN[o.owner]) mem.owner = o.owner;
    const t = o.task && data.get('tasks', o.task);
    if (t) { mem.project = data.get('projects', t.project) ? t.project : 'all'; first = t.id; }
  }

  render();
  if (first) openTask(first);
  const off = data.on(render);
  return () => {
    off(); if (drag) finish(drag); disarm(); cancelAnimationFrame(raf); clearTimeout(resizeT); clearTimeout(open?.saver);
    document.removeEventListener('keydown', onKey); window.removeEventListener('resize', onResize);
  };
}
