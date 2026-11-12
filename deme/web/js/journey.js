// My journey: what this person has to do to bring their part of Deme to life, in order.
// It starts with saying which position they hold. After that it is their own slice of the go-live
// plan: the next thing to do, the screen it is done on, a walkthrough that shows how, and a count
// of what is already in. Heads also see who is waiting to join them and how their team is doing;
// the system admin sees the three steps that get everyone else started.

import { api, data } from './api.js';
import { $, esc, info, toast, oops, busy, num, fmtDate } from './ui.js';
import { POSITIONS, positionById, isMine, byCentre, byStation } from '../shared/org.js';
import { TRACKS } from '../shared/golive.js';
import { MODULES, entityById } from '../shared/schema.js';
import { iso, today } from '../shared/util.js';
import { TOURS } from './guides-content.js';

const TK = Object.fromEntries(TRACKS);
const SCREENS = { home: 'Today', map: 'Business map', room: 'Production room', myday: 'My day', scan: 'Scan station', gate: 'Dispatch gate', pulse: 'Founder view', dayplan: 'Day plan', dye: 'Dye house', org: 'Work centres', import: 'Bring in data', guide: 'Guide' };
const initials = (name) => String(name || '').trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase();
const av = (id, size = 28) => { const n = data.title('users', id); return n ? `<span class="av" style="--av:${size}px" title="${esc(n)}">${esc(initials(n))}</span>` : `<span class="av av-none" style="--av:${size}px" title="Nobody yet">?</span>`; };
const day = (s) => fmtDate(`${s}T00:00:00`);
const plural = (n, one, many = `${one}s`) => `${num(n)} ${n === 1 ? one : many}`;
const entityOf = (route) => (route?.startsWith('e-') ? entityById[route.slice(2).replace(/-/g, '_')] : null);
const screenName = (r) => SCREENS[r] || entityOf(r)?.name || (r?.startsWith('m-') ? MODULES[r.slice(2)]?.name : '') || '';
const routesOf = (t) => t.steps.flatMap((s) => [].concat(s.route || []));
/** The walkthrough that teaches a screen, preferring one written for this person's position. */
const tourFor = (route, guide) => (route ? TOURS.find((t) => t.roles.includes(guide) && routesOf(t).includes(route)) || TOURS.find((t) => routesOf(t).includes(route)) : null);
const ring = (done, total, size = 132) => {
  const r = size / 2 - 9, c = 2 * Math.PI * r, v = total ? done / total : 0;
  return `<svg class="jn-ring" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="${done} of ${total} done"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="jn-ring-bg"/><circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="jn-ring-fg" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - v)}" transform="rotate(-90 ${size / 2} ${size / 2})"/><text x="50%" y="48%" class="jn-ring-n">${done}</text><text x="50%" y="66%" class="jn-ring-of">of ${total}</text></svg>`;
};

export function mount(el, ctx) {
  let picking = null;   // a position being asked for, before it is sent
  el.innerHTML = '<div class="workspace journey"><div class="workspace-inner" id="jnRoot"></div></div>';
  const root = $('#jnRoot', el);
  const centres = () => data.all('work_centres').slice().sort(byCentre);
  const centreName = (id) => data.title('work_centres', id);

  // ── Step 0: say what you do ──
  function pickHtml(me) {
    const cs = centres();
    const groups = cs.map((c) => [c, POSITIONS.filter((p) => p.centre === c.key)]).filter(([, ps]) => ps.length);
    const p = picking && positionById[picking];
    const c = p && cs.find((x) => x.key === p.centre);
    const stations = c ? data.all('workstations').filter((s) => s.centre === c.id).sort(byStation) : [];
    return `
      <div class="view-head"><div class="title-row"><h1 class="reveal">What do you do at Deme?</h1>${info('Pick the position you hold. It places you in a work centre, opens the screens that job needs, and gives you your own list of what to fill in. The person in charge of that work centre confirms it; positions that lead a work centre or handle money are confirmed by an admin. Until then you can look around and use the Guide.', 'Your position')}</div></div>
      ${me.pending ? '' : `<div class="jn-pick">${groups.map(([wc, ps]) => `
        <section class="panel jn-centre">
          <header><div><h2>${esc(wc.name)}</h2><p class="faint">${esc(wc.about || '')}</p></div><div class="jn-head" title="Person in charge">${av(wc.head, 30)}<span>${esc(data.title('users', wc.head) || 'Nobody in charge yet')}</span></div></header>
          <div class="jn-positions">${ps.map((x) => `<button type="button" class="jn-pos" data-pick="${x.id}" aria-pressed="${picking === x.id}"><strong>${esc(x.name)}</strong><span>${esc(x.line)}</span></button>`).join('')}</div>
          ${c && c.id === wc.id ? `<form class="jn-confirm" id="jnAsk"><div class="field"><label for="jnStation">Your workstation</label><select class="select" id="jnStation"><option value="">Not one in particular</option>${stations.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></div><button class="btn btn-primary" type="submit">Join as ${esc(p.name)}</button><span class="faint">${esc(p.approve === 'head' && wc.head ? `${data.title('users', wc.head)} confirms` : 'An admin confirms')}</span></form>` : ''}
        </section>`).join('')}</div>
        ${groups.length ? '' : `<div class="panel empty"><h3>No work centres yet</h3>${data.can('admin', 'admin') ? '<button class="btn btn-primary" type="button" data-seed>Create the starting work centres</button>' : '<p>The system admin has to create them first.</p>'}</div>`}`}`;
  }
  function waitingHtml(me) {
    const p = positionById[me.pending.position];
    const head = p?.approve === 'head' ? data.title('users', centres().find((c) => c.id === me.pending.centre)?.head) : '';
    return `<section class="panel jn-wait"><div class="jn-wait-mark" aria-hidden="true"></div><div><p class="eyebrow">Waiting to be confirmed</p><h2>${esc(p?.name || '')}${me.pending.centre ? `, ${esc(centreName(me.pending.centre))}` : ''}</h2><p class="muted">${esc(head ? `${head} has been told.` : 'The admins have been told.')} You will get a notice when you are in.</p></div><div class="row"><button class="btn btn-outline btn-sm" type="button" data-repick>Pick again</button><button class="btn btn-sm" type="button" data-go="guide">Open the Guide</button></div></section>`;
  }

  // ── People waiting for this person to let them in ──
  function approvalsHtml() {
    const list = data.users.filter((u) => u.pending && u.active !== false && u.id !== data.user.id);
    if (!list.length) return '';
    return `<section class="panel jn-joins" aria-labelledby="jnJoinH"><div class="panel-head"><div class="title-row"><h2 id="jnJoinH">Waiting to join</h2>${info('Each person picked the position they hold. Confirm the ones that are right: they get the access that position needs and their tasks. Say no to a wrong pick and they can choose again.', 'Waiting to join')}</div><span class="tag tag-warn">${list.length}</span></div>
      <ul>${list.map((u) => `<li>${av(u.id, 34)}<div><strong>${esc(u.name)}</strong><span class="faint">${esc(positionById[u.pending.position]?.name || '')} · ${esc(centreName(u.pending.centre) || '')}${u.pending.station ? ` · ${esc(data.title('workstations', u.pending.station))}` : ''}</span></div><div class="row"><button class="btn btn-primary btn-sm" type="button" data-join="${u.id}" data-ok="1">Confirm</button><button class="btn btn-quiet btn-sm" type="button" data-join="${u.id}" data-ok="0">Not right</button></div></li>`).join('')}</ul></section>`;
  }

  // ── The system admin: three steps that get everyone else started ──
  function setupHtml(golive) {
    const cs = centres(), headed = cs.filter((c) => c.head).length, people = data.users.filter((u) => u.active !== false).length;
    const steps = [
      { n: 1, done: cs.length > 0 && headed === cs.length, title: 'Work centres and who is in charge', fact: cs.length ? `${headed} of ${cs.length} have a head` : 'None yet', btn: cs.length ? '<button class="btn btn-sm btn-outline" type="button" data-go="org">Open work centres</button>' : '<button class="btn btn-sm btn-primary" type="button" data-seed>Create the starting set</button>' },
      { n: 2, done: people > 3, title: 'Invite the team', fact: `${plural(people, 'person', 'people')} so far`, btn: '<button class="btn btn-sm btn-outline" type="button" data-go="m-admin">Add people</button>' },
      { n: 3, done: !!golive, title: 'Create the go-live plan', fact: golive ? `Runs ${day(golive.start)} to ${day(golive.due)}` : 'Each person gets their own tasks from it', btn: golive ? '<button class="btn btn-sm btn-outline" type="button" data-go="m-projects">Open the plan</button>' : `<form class="jn-plan" id="jnPlan"><input class="input" type="date" id="jnStart" aria-label="Start date" value="${iso(today())}"><button class="btn btn-sm btn-primary" type="submit">Create</button></form>` },
    ];
    if (steps.every((s) => s.done)) return '';
    return `<section class="panel jn-setup" aria-labelledby="jnSetupH"><div class="panel-head"><div class="title-row"><h2 id="jnSetupH">Get everyone started</h2>${info('Do these once. Name a head for each work centre first: heads confirm the people who join them. Invite people by adding them with their position, or let them sign in with Google and pick it themselves. Creating the plan gives each position its tasks, dated from the day you choose; people who join later are handed theirs when they are confirmed.', 'Get everyone started')}</div></div>
      <ol class="jn-steps">${steps.map((s) => `<li class="${s.done ? 'is-done' : ''}"><span class="jn-step-n">${s.done ? '✓' : s.n}</span><div><strong>${s.title}</strong><span class="faint">${esc(s.fact)}</span></div>${s.btn}</li>`).join('')}</ol></section>`;
  }

  // ── A task, as one stop on the path ──
  function evidence(t) {
    const e = entityOf(t.opens);
    if (!e || !data.canRead(e.id)) return '';
    const n = data.all(e.id).length;
    return `<span class="jn-count ${n ? 'has' : ''}"><b>${num(n)}</b> ${esc(e.name.toLowerCase())} so far</span>`;
  }
  const waits = (t) => (t.dependsOn || []).map((id) => data.get('tasks', id)).filter((d) => d && d.status !== 'done');
  function stopHtml(t, T, guide, first) {
    const late = t.due && t.due < T && t.status !== 'done', tour = tourFor(t.opens, guide), w = waits(t), name = screenName(t.opens);
    const state = t.status === 'done' ? 'done' : t.status === 'blocked' ? 'blocked' : w.length ? 'waiting' : t.status === 'doing' ? 'doing' : 'todo';
    return `<li class="jn-stop is-${state} ${first ? 'is-next' : ''}" style="--tk:var(--tk-${TK[t.track] ? t.track : 'run'})">
      <span class="jn-dot" aria-hidden="true"></span>
      <div class="jn-body">
        <p class="jn-meta"><span>${esc(TK[t.track] || data.title('projects', t.project) || '')}</span>${t.due ? `<span class="${late ? 'is-late' : ''}">${late ? 'Was due' : 'Due'} ${esc(day(t.due))}</span>` : ''}${state === 'blocked' ? '<span class="tag tag-crit">Blocked</span>' : state === 'doing' ? '<span class="tag tag-info">Doing</span>' : state === 'waiting' ? `<span class="tag tag-plain">Waits for ${w.length}</span>` : ''}</p>
        <h3><button type="button" class="jn-title" data-task="${t.id}">${esc(t.title)}</button></h3>
        ${first && t.doneWhen ? `<p class="jn-when"><span class="eyebrow">Done when</span>${esc(t.doneWhen)}</p>` : ''}
        ${state !== 'done' && (first || state === 'doing') ? `<div class="jn-acts">
          ${name ? `<button class="btn btn-primary btn-sm" type="button" data-go="${esc(t.opens)}">Open ${esc(name)}</button>` : ''}
          ${tour ? `<button class="btn btn-outline btn-sm" type="button" data-tour="${tour.id}">Show me how</button>` : ''}
          ${t.status === 'todo' ? `<button class="btn btn-sm" type="button" data-act="task.start" data-id="${t.id}">Start</button>` : ''}
          <button class="btn btn-sm" type="button" data-act="task.done" data-id="${t.id}">Mark done</button>
        </div>` : ''}
        <p class="jn-foot">${evidence(t)}${t.needs ? `<span class="jn-needs">Ask ${esc(t.needs)}</span>` : ''}${w.length ? `<span class="jn-needs">After ${esc(w[0].title)}</span>` : ''}</p>
      </div></li>`;
  }

  function journeyHtml(me) {
    const pos = positionById[me.position], T = iso(today());
    const golive = data.all('projects').find((p) => p.kind === 'golive') || null;
    const all = data.all('tasks');
    const order = (a, b) => (a.status === 'done') - (b.status === 'done') || String(a.due || a.start || '9').localeCompare(String(b.due || b.start || '9'));
    const mine = all.filter((t) => isMine(t, me));
    const plan = mine.filter((t) => golive && t.project === golive.id).sort(order);
    const other = mine.filter((t) => !golive || t.project !== golive.id).filter((t) => t.status !== 'done').sort(order);
    const done = plan.filter((t) => t.status === 'done').length, late = plan.filter((t) => t.due && t.due < T && t.status !== 'done').length;
    const open = plan.filter((t) => t.status !== 'done');
    const next = open.find((t) => !waits(t).length) || open[0];
    const wc = centres().find((c) => c.id === me.centre);
    const admin = data.can('admin', 'admin'), heading = centres().filter((c) => c.head === me.id);
    // How the people in the work centres I lead are doing on their own tasks.
    const team = heading.length ? data.users.filter((u) => u.active !== false && u.id !== me.id && heading.some((c) => c.id === u.centre)).map((u) => { const ts = all.filter((t) => golive && t.project === golive.id && isMine(t, u)); return { u, n: ts.length, d: ts.filter((t) => t.status === 'done').length, late: ts.filter((t) => t.due && t.due < T && t.status !== 'done').length }; }) : [];
    const tours = TOURS.filter((t) => t.roles.includes(pos?.guide || 'everyone')).slice(0, 6);
    const canTasks = data.canRead('tasks');
    return `
      <div class="view-head">
        <div class="title-row"><h1 class="reveal">My journey</h1>${info('Your own part of bringing Deme to life, in the order it needs doing. The first card is what to do now: it opens the screen the work is done on and can show you how. The count on a step is what is already in the system, so you can see it filling up. When the go-live is over, anything asked of you or your work centre still lands here.', 'My journey')}</div>
        <div class="jn-me">${av(me.id, 38)}<div><strong>${esc(pos?.name || 'No position yet')}</strong><span class="faint">${esc(wc?.name || '')}${wc?.head && wc.head !== me.id ? ` · with ${esc(data.title('users', wc.head))}` : wc?.head === me.id ? ' · you are in charge' : ''}</span></div></div>
      </div>
      ${admin ? setupHtml(golive) : ''}
      ${approvalsHtml()}
      ${canTasks && plan.length ? `<section class="panel jn-hero">
        <div class="jn-progress">${ring(done, plan.length)}<div><p class="eyebrow">Your part of the go-live</p><p class="jn-big">${done === plan.length ? 'All done' : `${plural(plan.length - done, 'step')} to go`}</p>${late ? `<span class="tag tag-crit">${late} late</span>` : `<span class="tag tag-ok">On time</span>`}${golive ? `<p class="faint">Go-live runs to ${esc(day(golive.due))}</p>` : ''}</div></div>
        ${next ? `<div class="jn-now"><p class="eyebrow">Do this now</p><ul class="jn-path jn-path-one">${stopHtml(next, T, pos?.guide, true)}</ul></div>` : '<div class="jn-now jn-now-done"><p class="jn-big">Your part is in.</p><p class="muted">New requests to you or your work centre will show up here.</p></div>'}
      </section>` : ''}
      ${canTasks && !plan.length ? `<section class="panel empty jn-none"><h3>${golive ? 'Nothing in the go-live plan is yours' : 'The go-live plan has not been created yet'}</h3><p>${golive ? 'Tasks given to you later, and anything asked of your work centre, will show up here.' : admin ? 'Create it above and each person gets their own tasks.' : 'Once the system admin creates it, your tasks appear here.'}</p></section>` : ''}
      ${other.length ? `<section class="panel" aria-labelledby="jnAskedH"><div class="panel-head"><div class="title-row"><h2 id="jnAskedH">Asked of you</h2>${info('Tasks outside the go-live plan that are on you: what another work centre has asked for, or what someone has given you.', 'Asked of you')}</div><span class="tag tag-info">${other.length}</span></div><ul class="jn-path">${other.map((t) => stopHtml(t, T, pos?.guide, false)).join('')}</ul></section>` : ''}
      ${open.length > 1 ? `<section class="panel" aria-labelledby="jnPathH"><div class="panel-head"><div class="title-row"><h2 id="jnPathH">Then</h2></div><span class="faint">${plural(open.length - 1, 'step')}</span></div><ul class="jn-path">${open.filter((t) => t !== next).map((t) => stopHtml(t, T, pos?.guide, false)).join('')}</ul></section>` : ''}
      ${team.length ? `<section class="panel" aria-labelledby="jnTeamH"><div class="panel-head"><div class="title-row"><h2 id="jnTeamH">Your team</h2>${info('The people in the work centres you are in charge of, and how far each is through their own steps.', 'Your team')}</div></div><ul class="jn-team">${team.map(({ u, n, d, late: l }) => `<li>${av(u.id, 34)}<div><strong>${esc(u.name)}</strong><span class="faint">${esc(positionById[u.position]?.name || '')}</span></div><div class="jn-team-bar"><div class="bar" style="--v:${n ? Math.round((d / n) * 100) : 0}%"><i></i></div><span class="faint">${n ? `${d} of ${n}` : 'No steps'}${l ? ` · <b class="is-late">${l} late</b>` : ''}</span></div></li>`).join('')}</ul></section>` : ''}
      ${tours.length ? `<section class="panel" aria-labelledby="jnLearnH"><div class="panel-head"><div class="title-row"><h2 id="jnLearnH">Learn your screens</h2></div><button class="link" type="button" data-go="guide">All walkthroughs</button></div><div class="jn-tours">${tours.map((t) => `<button type="button" class="jn-tour" data-tour="${t.id}"><span class="jn-play" aria-hidden="true"></span><strong>${esc(t.title)}</strong><span class="faint">${t.minutes} min</span></button>`).join('')}</div></section>` : ''}
      ${done ? `<section class="panel" aria-labelledby="jnDoneH"><details class="jn-done"><summary><h2 id="jnDoneH">Done</h2><span class="tag tag-ok">${done}</span></summary><ul class="jn-path">${plan.filter((t) => t.status === 'done').map((t) => stopHtml(t, T, pos?.guide, false)).join('')}</ul></details></section>` : ''}
      <div class="row jn-ask">${data.can('projects', 'read') ? '<button class="btn btn-outline" type="button" data-ask>Ask a work centre for something</button>' : ''}<button class="btn btn-quiet" type="button" data-go="org">Who is who</button></div>`;
  }

  function render() {
    const me = data.user;
    const keep = el.querySelector('.workspace')?.scrollTop || 0;
    if (!me.position && !me.pending) root.innerHTML = pickHtml(me);
    else if (me.pending && !me.position) root.innerHTML = pickHtml(me) + waitingHtml(me) + approvalsHtml();
    else root.innerHTML = (me.pending ? waitingHtml(me) : '') + journeyHtml(me);
    el.querySelector('.workspace').scrollTop = keep;
  }

  root.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.pick) { picking = picking === b.dataset.pick ? null : b.dataset.pick; render(); root.querySelector('#jnAsk')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); return; }
    if (b.dataset.repick !== undefined) { data.user = { ...data.user, pending: null, position: '' }; picking = null; render(); return; }
    if (b.dataset.go) return ctx.go(b.dataset.go);
    if (b.dataset.ask !== undefined) return ctx.go('m-projects', { ask: true });
    if (b.dataset.task) { location.hash = `task-${b.dataset.task}`; return; }
    if (b.dataset.tour) return void import('./guide.js').then((g) => g.startTour(b.dataset.tour, 'watch', ctx)).catch(oops);
    if (b.dataset.join) return void busy(b, async () => { try { const u = await api.decideJoin(b.dataset.join, b.dataset.ok === '1'); toast(b.dataset.ok === '1' ? `${u.name} is in.` : `${u.name} can pick again.`); } catch (x) { oops(x); } });
    if (b.dataset.seed !== undefined) return void busy(b, async () => { try { const out = await api.act('org.seed'); toast(out.message); await data.load(); } catch (x) { oops(x); } });
    if (b.dataset.act) return void busy(b, async () => { try { const out = await api.act(b.dataset.act, {}, { entity: 'tasks', id: b.dataset.id }); if (out.message) toast(out.message); } catch (x) { oops(x); } });
  });
  root.addEventListener('submit', (e) => {
    e.preventDefault();
    if (e.target.id === 'jnAsk') busy(e.target.querySelector('button'), async () => { try { const u = await api.pickPosition(picking, $('#jnStation', root).value); picking = null; toast(u.pending ? 'Sent. You will get a notice when you are confirmed.' : 'You are in.'); } catch (x) { oops(x); } });
    if (e.target.id === 'jnPlan') busy(e.target.querySelector('button'), async () => { try { const out = await api.act('golive.create', { start: $('#jnStart', root).value }); toast(out.message); } catch (x) { oops(x); } });
  });

  render();
  // Do not redraw under someone who is in the middle of choosing or typing.
  return data.on(() => { const a = document.activeElement; if (a && root.contains(a) && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName)) return; render(); });
}
