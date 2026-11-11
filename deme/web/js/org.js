// Work centres: how Deme is organised, as cards. Each work centre shows the person in charge,
// the workstations inside it and the people who belong to it. The system admin shapes the work
// centres and names their heads; the head of a work centre adds and changes its workstations.

import { api, data } from './api.js';
import { $, esc, info, toast, oops, busy, drawer, formHtml, readForm, fields, num } from './ui.js';
import { positionById, byCentre, byStation } from '../shared/org.js';
import { STAGE_NAMES } from '../shared/schema.js';

const initials = (name) => String(name || '').trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase();
const av = (id, size = 28) => { const n = data.title('users', id); return n ? `<span class="av" style="--av:${size}px" title="${esc(n)}">${esc(initials(n))}</span>` : `<span class="av av-none" style="--av:${size}px">?</span>`; };

export function mount(el, ctx) {
  const admin = () => data.can('masters', 'admin');
  const runs = (c) => admin() || c.head === data.user.id;   // may add and change this centre's workstations
  el.innerHTML = `<div class="workspace org"><div class="workspace-inner">
    <div class="view-head">
      <div class="title-row"><h1 class="reveal">Work centres</h1>${info('A work centre is a part of the business with one person in charge. A workstation is a place inside it where one kind of work is done: the cutting table, a stitching line, the inspection table, the dispatch gate. A starting set was created when the system was set up; change it to match how Deme is actually organised. The system admin adds work centres and names who is in charge. The person in charge adds and changes the workstations and confirms the people who join. For production workstations, the headcount is what the production plan schedules against.', 'Work centres and workstations')}</div>
      <div class="row" id="ogTop"></div>
    </div>
    <div class="og-legend"><span><i class="plan"></i>Scheduled by the production plan</span><span><i></i>Other workstation</span><span class="faint">The number on a workstation is its headcount</span></div>
    <div class="og-grid" id="ogGrid"></div>
  </div></div>`;
  const grid = $('#ogGrid', el);

  function render() {
    $('#ogTop', el).innerHTML = admin() ? '<button class="btn btn-primary" type="button" data-add-centre>Add a work centre</button>' : '';
    const cs = data.all('work_centres').slice().sort(byCentre);
    if (!cs.length) { grid.innerHTML = `<div class="panel empty"><h3>No work centres yet</h3>${admin() ? '<button class="btn btn-primary" type="button" data-seed>Create the starting set</button>' : '<p>The system admin creates them.</p>'}</div>`; return; }
    const stations = data.all('workstations'), people = data.users.filter((u) => u.active !== false);
    grid.innerHTML = cs.map((c, i) => {
      const ss = stations.filter((s) => s.centre === c.id).sort(byStation), ps = people.filter((u) => u.centre === c.id && u.id !== c.head);
      const waiting = people.filter((u) => u.pending?.centre === c.id).length;
      return `<article class="panel og-card" style="animation-delay:${i * 40}ms" aria-labelledby="og-${c.id}">
        <div class="og-top"><div><h2 id="og-${c.id}">${esc(c.name)}</h2><p>${esc(c.about || '')}</p></div>${admin() ? `<button class="btn btn-sm btn-quiet" type="button" data-edit-centre="${c.id}">Edit</button>` : ''}</div>
        <div class="og-head">${av(c.head, 36)}<div><span class="eyebrow">In charge</span><strong>${esc(data.title('users', c.head) || 'Nobody yet')}</strong></div>${admin() ? `<button class="btn btn-sm ${c.head ? 'btn-quiet' : 'btn-primary'}" type="button" data-edit-centre="${c.id}">${c.head ? 'Change' : 'Name someone'}</button>` : ''}</div>
        <div class="og-sect"><header><span class="eyebrow">Workstations</span>${runs(c) ? `<button class="link" type="button" data-add-station="${c.id}">Add</button>` : ''}</header>
          ${ss.length ? `<div class="og-stations">${ss.map((s) => { const tag = runs(c) ? 'button' : 'span'; return `<${tag} ${tag === 'button' ? `type="button" data-station="${s.id}"` : ''} class="og-station ${s.stage ? 'is-plan' : ''} ${s.stage && !s.people ? 'is-empty' : ''}" title="${esc(s.stage ? `${STAGE_NAMES[s.stage]}${s.people ? '' : ': headcount not entered'}` : '')}${s.lead ? ` Run by ${esc(data.title('users', s.lead))}` : ''}">${esc(s.name)}${s.stage || s.people ? `<i>${num(s.people || 0)}</i>` : ''}</${tag}>`; }).join('')}</div>` : '<p class="og-none">None yet</p>'}
        </div>
        <div class="og-sect"><header><span class="eyebrow">People</span>${waiting ? `<button class="tag tag-warn" type="button" data-go="journey">${waiting} waiting to join</button>` : ''}</header>
          ${ps.length ? `<div class="og-people">${ps.map((u) => `<span class="og-person">${av(u.id, 24)}${esc(u.name)}<small>${esc(positionById[u.position]?.name || '')}</small></span>`).join('')}</div>` : '<p class="og-none">Nobody has joined yet</p>'}
        </div>
      </article>`;
    }).join('');
  }

  /** A form in the side drawer for a work centre or a workstation. */
  function form(entity, title, values, save, canDelete) {
    const fs = fields(entity).filter((f) => !(entity === 'workstations' && f.k === 'centre' && !admin()));
    const d = drawer(`<header class="drawer-head"><div><p class="eyebrow">${entity === 'work_centres' ? 'Work centre' : 'Workstation'}</p><h2>${esc(title)}</h2></div><button class="icon-btn" type="button" data-close aria-label="Close">×</button></header>
      <form class="drawer-body form-grid" novalidate>${formHtml(fs, values)}
        <p class="error wide" role="alert" hidden></p>
        <div class="row wide"><button class="btn btn-primary" type="submit">Save</button><button class="btn btn-quiet" type="button" data-close>Cancel</button>${canDelete ? '<button class="btn btn-quiet" type="button" data-delete style="margin-left:auto">Delete</button>' : ''}</div></form>`);
    const f = $('form', d.el), err = $('.error', f);
    f.querySelector('input,select,textarea')?.focus();
    const guard = (btn, fn) => busy(btn, async () => { err.hidden = true; try { await fn(); d.close(); } catch (x) { err.textContent = x.message; err.hidden = false; } });
    f.addEventListener('submit', (e) => { e.preventDefault(); guard(f.querySelector('[type="submit"]'), () => save({ ...readForm(f, fs) })); });
    $('[data-delete]', f)?.addEventListener('click', (e) => guard(e.currentTarget, () => api.remove(entity, values.id)));
  }

  // Listen on this screen's own root: the element it is mounted in outlives it.
  el.firstElementChild.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.go) return ctx.go(b.dataset.go);
    if (b.dataset.seed !== undefined) return void busy(b, async () => { try { const out = await api.act('org.seed'); toast(out.message); await data.load(); } catch (x) { oops(x); } });
    if (b.dataset.addCentre !== undefined) return form('work_centres', 'Add a work centre', {}, (v) => api.create('work_centres', v));
    if (b.dataset.editCentre) { const c = data.get('work_centres', b.dataset.editCentre); return form('work_centres', c.name, c, (v) => api.update('work_centres', c.id, v), true); }
    if (b.dataset.addStation) { const c = data.get('work_centres', b.dataset.addStation); return form('workstations', `New in ${c.name}`, { centre: c.id }, (v) => api.create('workstations', { ...v, centre: v.centre || c.id })); }
    if (b.dataset.station) { const s = data.get('workstations', b.dataset.station); return form('workstations', s.name, s, (v) => api.update('workstations', s.id, { ...v, centre: v.centre || s.centre }), admin()); }
  });

  render();
  return data.on((touched) => { if (touched.some((t) => ['*', 'work_centres', 'workstations', 'notifications'].includes(t))) render(); });
}
