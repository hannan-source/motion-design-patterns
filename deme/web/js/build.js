// Build: where the first admin sets a business up without code. Seven steps, each on real data:
// what is still to do, the business itself, the areas it has switched on, its own words for the
// built-in lists, the lists it sets up for itself, the people it invites, and its AI connection
// and connections to other systems.

import { api, data } from './api.js';
import { $, $$, esc, info, toast, oops, busy, formHtml, num, fmtDate } from './ui.js';
import { FIELD_TYPES, cleanType, builtInAreas, builtInPacks, builtInLists, positionsFor } from '../shared/platform.js';
import { ENTITIES, MODULES } from '../shared/schema.js';
import { positionById, byCentre, byStation } from '../shared/org.js';

const SECTIONS = [['start', 'Start here'], ['business', 'Business'], ['areas', 'Areas'], ['words', 'Words'], ['lists', 'Lists'], ['people', 'People'], ['ai', 'AI and connections']];
const KEEP = 'lychee-build-section', SAY = 'lychee-build-say';
// The gradient each area wears elsewhere in the app, so its card here is recognisably the same place.
const AREA_G = { masters: 'about', purchasing: 'engagement', inventory: 'industries', quality: 'trust', production: 'services', b2b: 'contact', b2c: 'application', logistics: 'ai', finance: 'foundation', crm: 'contact', hr: 'people', projects: 'ontology', marketing: 'engagement', design: 'about', admin: 'contact' };
const PACK_NAMES = { apparel: ['Garment floor', 'Rolls, dye lots, slips, day plans'] };

const stash = { get(k) { try { return sessionStorage.getItem(k); } catch { return null; } }, set(k, v) { try { if (v === null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, v); } catch { /* private window: carry on without it */ } } };
const plural = (n, one, many = `${one}s`) => `${num(n)} ${n === 1 ? one : many}`;
const initials = (name) => String(name || '').trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase();
const av = (name, size = 36) => `<span class="av" style="--av:${size}px" aria-hidden="true">${esc(initials(name) || '?')}</span>`;
const firstSentence = (s) => { const m = /^(.*?[.!?])(\s|$)/.exec(String(s || '')); return m ? m[1] : String(s || ''); };
const TICK = '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const LOCK = '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M4.5 7V5.2a3.5 3.5 0 0 1 7 0V7M3.5 7h9v6.5h-9z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>';
const ARROW = '<svg class="bd-arrow" viewBox="0 0 20 12" width="20" height="12" aria-hidden="true"><path d="M1 6h17M13.5 1.5L18 6l-4.5 4.5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const switchHtml = (on, attrs, label, locked = false) => `<button type="button" class="bd-switch" role="switch" aria-checked="${on}" aria-label="${esc(label)}" ${locked ? 'disabled' : ''} ${attrs}><i></i></button>`;

export function mount(el, ctx) {
  let section = SECTIONS.some((s) => s[0] === ctx.opts?.section) ? ctx.opts.section : SECTIONS.some((s) => s[0] === stash.get(KEEP)) ? stash.get(KEEP) : 'start';
  const local = api.mode === 'local';
  el.innerHTML = `<div class="workspace build"><div class="workspace-inner">
    <div class="view-head">
      <div class="title-row"><h1 class="reveal">Build</h1>${info('Set the business up here, without code. Work through the steps in any order: name it, choose the areas it uses, put its own words on the built-in lists, set up lists of its own, invite the team, and connect AI and other systems. Start here shows what is in place and what is still to do, worked out from what is really in the system.', 'Build')}</div>
      <p class="bd-biz" id="bdBiz"></p>
    </div>
    <nav class="bd-nav" id="bdNav" aria-label="Build steps"></nav>
    <div class="bd-body" id="bdBody"></div>
  </div></div>`;
  const root = el.firstElementChild, nav = $('#bdNav', root), body = $('#bdBody', root);
  const ws = () => data.workspace || { name: '', modules: [], packs: [], terms: {}, ai: {}, connected: {} };
  const has = (list) => !!data.entity(list);
  const centres = () => data.all('work_centres').slice().sort(byCentre);
  const people = () => data.users.filter((u) => u.active !== false);
  const templateName = () => api.templates.find((t) => t.id === ws().template)?.name || '';

  /** Save, then load the page again: the menu is drawn once at sign-in, so a change to what the business has only shows there after a reload. */
  function applied(message) { stash.set(SAY, message); location.reload(); }

  // ───────── 1. Start here: what building a business takes, from real data ─────────
  function steps() {
    const w = ws(), cs = centres(), headed = cs.filter((c) => c.head).length, stations = data.all('workstations').length, team = people();
    const areas = builtInAreas(), on = areas.filter((a) => a.core || (w.modules || []).includes(a.id)).length;
    const cust = has('customers') ? data.all('customers').length : 0, cont = has('contacts') ? data.all('contacts').length : 0;
    const ai = w.ai || {}, aiOn = ai.provider === 'anthropic' ? !!ai.keySet : ai.provider === 'openai-compatible' ? !!ai.baseUrl : !!api.caps.ai;
    const projects = has('projects') ? data.all('projects').length : 0;
    const named = !!w.name && w.name.trim().toLowerCase() !== 'my business';
    return [
      { id: 'name', title: 'Name the business', done: named, fact: named ? w.name : 'Still called My business', act: [['Name it', 'sec:business']], redo: [['Change', 'sec:business']] },
      { id: 'heads', title: 'A person in charge of each work centre', done: cs.length > 0 && headed === cs.length, part: [headed, cs.length], fact: cs.length ? `${headed} of ${cs.length} work centres` : 'No work centres yet', act: [['Name who is in charge', 'go:org']], redo: [['Open work centres', 'go:org']] },
      { id: 'stations', title: 'Workstations', done: stations > 0, fact: stations ? plural(stations, 'workstation') : 'None yet', act: [['Add workstations', 'go:org']], redo: [['Open work centres', 'go:org']] },
      { id: 'people', title: 'Invite the team', done: team.length > 1, fact: team.length > 1 ? `${plural(team.length, 'person', 'people')} on the team` : 'Only you so far', act: [['Invite people', 'sec:people']], redo: [['Invite more', 'sec:people']] },
      { id: 'areas', title: 'Choose the areas', done: true, part: [on, areas.length], fact: `${on} of ${areas.length} on${templateName() ? `, from ${templateName()}` : ''}`, redo: [['Review areas', 'sec:areas']] },
      { id: 'customers', title: has('contacts') ? 'Customers or contacts' : 'Customers', done: cust + cont > 0, fact: cust + cont ? [cust ? plural(cust, 'customer') : '', cont ? plural(cont, 'contact') : ''].filter(Boolean).join(', ') : 'None yet', act: [['Add a customer', 'add:customers'], ...(has('contacts') ? [['Add a contact', 'add:contacts']] : [])], redo: [['Open customers', 'open:customers'], ...(has('contacts') ? [['Open contacts', 'open:contacts']] : [])] },
      { id: 'lists', title: 'Lists of your own', done: data.types.length > 0, fact: data.types.length ? plural(data.types.length, 'list') : 'None yet', act: [['Set up a list', 'sec:lists']], redo: [['Open lists', 'sec:lists']] },
      local ? { id: 'ai', title: 'Connect AI', na: true, fact: 'On the live site', redo: [['See what it does', 'sec:ai']] }
        : { id: 'ai', title: 'Connect AI', done: aiOn, fact: aiOn ? (ai.provider === 'anthropic' ? 'Anthropic (Claude)' : ai.provider === 'openai-compatible' ? 'Your own model' : 'The platform\'s') : 'Not connected', act: [['Connect AI', 'sec:ai']], redo: [['Change', 'sec:ai']] },
      { id: 'project', title: 'A first project', done: projects > 0, fact: projects ? plural(projects, 'project') : 'None yet', act: [['Open projects', 'go:m-projects']], redo: [['Open projects', 'go:m-projects']] },
    ];
  }
  const actBtn = ([label, to], cls) => `<button class="btn btn-sm ${cls}" type="button" data-to="${esc(to)}">${esc(label)}</button>`;
  function startHtml() {
    const all = steps(), counted = all.filter((s) => !s.na), done = counted.filter((s) => s.done).length, next = counted.find((s) => !s.done);
    const pct = counted.length ? Math.round((done / counted.length) * 100) : 0;
    return `<section class="bd-hero panel" aria-labelledby="bdHeroH">
        <div class="bd-ring" style="--p:${pct}" role="img" aria-label="${done} of ${counted.length} in place"><div class="bd-ring-in"><b>${done}</b><span>of ${counted.length}</span></div></div>
        <div class="bd-hero-main">
          <p class="eyebrow">${esc(ws().name || 'Your business')}</p>
          <h2 id="bdHeroH">${done === counted.length ? 'Everything is in place' : `${plural(counted.length - done, 'step')} to go`}</h2>
          <ol class="bd-meter" aria-hidden="true">${counted.map((s, i) => `<li class="${s.done ? 'is-done' : s === next ? 'is-next' : ''}" style="--i:${i}" title="${esc(s.title)}"></li>`).join('')}</ol>
          ${next ? `<div class="bd-next"><span class="eyebrow">Next</span><strong>${esc(next.title)}</strong>${(next.act || []).map((a, i) => actBtn(a, i ? 'btn-outline' : 'btn-primary')).join('')}</div>` : '<p class="bd-next"><span class="tag tag-ok">Built</span><span class="muted">Change anything from the steps above.</span></p>'}
        </div>
      </section>
      <ol class="bd-tasks">${all.map((s, i) => `<li class="bd-task panel ${s.na ? 'is-na' : s.done ? 'is-done' : ''} ${s === next ? 'is-next' : ''}" style="--i:${i}">
        <span class="bd-task-n">${s.done && !s.na ? TICK : i + 1}</span>
        <div class="bd-task-main"><h3>${esc(s.title)}</h3><p class="bd-fact">${esc(s.fact)}</p>${s.part && s.part[1] ? `<div class="bar" style="--v:${Math.round((s.part[0] / s.part[1]) * 100)}%"><i></i></div>` : ''}</div>
        <div class="bd-task-acts">${(s.done || s.na ? s.redo || [] : s.act || []).map((a, k) => actBtn(a, s.done || s.na ? 'btn-quiet' : k ? 'btn-outline' : 'btn-primary')).join('')}</div>
      </li>`).join('')}</ol>`;
  }

  // ───────── 2. Business: its name, what it started from, its Google domain ─────────
  function businessHtml() {
    const w = ws(), t = api.templates.find((x) => x.id === w.template);
    const on = builtInAreas().filter((a) => a.core || (w.modules || []).includes(a.id)).length;
    return `<div class="bd-two">
      <form class="panel bd-form" id="bdBusiness" novalidate>
        <div class="panel-head"><div class="title-row"><h2>The business</h2>${info('The name shows at the top of the menu, on the sign-in page of an invitation and in the emails the system sends. Changing it changes nothing else.', 'The business')}</div></div>
        <div class="bd-form-body">
          <div class="field"><label for="bdName">Name</label><input class="input bd-input-lg" id="bdName" name="name" maxlength="60" autocomplete="organization" value="${esc(w.name || '')}"></div>
          ${local ? '' : `<div class="field"><label for="bdDomain">Google domain ${info('Where Google sign-in is switched on for this site, anyone signing in with a Google account on this domain comes straight in to this business, picks the position they hold and waits to be confirmed. Leave it empty to let in only the people you invite.', 'Google domain')}</label><div class="bd-affix"><span>@</span><input class="input" id="bdDomain" name="domain" maxlength="80" autocomplete="off" spellcheck="false" placeholder="yourcompany.com" value="${esc(w.domain || '')}"></div></div>`}
          <p class="error" role="alert" hidden></p>
          <div class="row"><button class="btn btn-primary" type="submit">Save</button></div>
        </div>
      </form>
      <aside class="panel bd-card" aria-label="How the business shows">
        <p class="eyebrow">${esc(api.product)}</p>
        <p class="bd-card-name" id="bdCardName">${esc(w.name || '')}</p>
        <dl class="bd-card-facts">
          <div><dt>Started from</dt><dd>${esc(t?.name || 'A template')}</dd></div>
          ${w.createdAt ? `<div><dt>Since</dt><dd>${esc(fmtDate(w.createdAt))}</dd></div>` : ''}
          <div><dt>Team</dt><dd>${plural(people().length, 'person', 'people')}</dd></div>
          <div><dt>Areas on</dt><dd>${on}</dd></div>
        </dl>
        ${t?.line ? `<p class="bd-card-line">${esc(t.line)} ${info('What a business starts from only decides the first set of areas, work centres and words. Everything it chose can be changed here: switch areas on and off, rename lists, add lists of your own.', 'Started from')}</p>` : ''}
      </aside>
    </div>`;
  }

  const HTML = { start: startHtml, business: businessHtml };

  function paintNav() {
    const st = steps(), flag = { business: st[0].done, people: st[3].done, lists: st[6].done, ai: !st[7].na && st[7].done };
    nav.innerHTML = `<ol>${SECTIONS.map(([id, name], i) => `<li><button type="button" class="bd-step ${flag[id] ? 'is-done' : ''}" data-sec="${id}" ${id === section ? 'aria-current="step"' : ''}><span class="bd-step-n">${flag[id] ? TICK : i + 1}</span><span class="bd-step-t">${esc(name)}</span></button></li>`).join('')}</ol>`;
    nav.querySelector('[aria-current]')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }
  function paint() {
    $('#bdBiz', root).innerHTML = `<strong>${esc(ws().name || '')}</strong>${templateName() ? `<span>${esc(templateName())}</span>` : ''}`;
    paintNav();
    body.dataset.section = section;
    body.innerHTML = (HTML[section] || (() => ''))();
  }
  function open(id) {
    if (!SECTIONS.some((s) => s[0] === id)) return;
    section = id; stash.set(KEEP, id); paint();
    root.scrollTop = 0;
  }
  /** Follow a button's destination: another step here, another screen, or a list (to look at, or to add to). */
  function follow(to) {
    const [kind, what] = String(to).split(':');
    if (kind === 'sec') return open(what);
    if (kind === 'go') return ctx.go(what);
    if (kind === 'open') return ctx.openEntity(what);
    if (kind === 'add') return ctx.openEntity(what, { add: true });
  }

  root.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b || b.classList.contains('info')) return;
    if (b.dataset.sec) return open(b.dataset.sec);
    if (b.dataset.to) return follow(b.dataset.to);
  });
  root.addEventListener('input', (e) => {
    if (e.target.id === 'bdName') $('#bdCardName', root).textContent = e.target.value;
  });
  root.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target, err = $('.error', f), fail = (x) => { if (err) { err.textContent = x.message; err.hidden = false; } else oops(x); };
    if (err) err.hidden = true;
    if (f.id === 'bdBusiness') {
      const name = f.elements.name.value.trim(), input = { name, ...(f.elements.domain ? { domain: f.elements.domain.value.trim() } : {}) };
      return void busy(f.querySelector('[type="submit"]'), async () => { try { await api.saveWorkspace(input); applied(`Saved. The business is called ${name}.`); } catch (x) { fail(x); } });
    }
  });

  paint();
  const said = stash.get(SAY); if (said) { stash.set(SAY, null); toast(said); }
  // Do not redraw under someone who is typing; what they typed is kept either way.
  return data.on(() => { const a = document.activeElement; if (a && root.contains(a) && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName)) return; paint(); });
}
