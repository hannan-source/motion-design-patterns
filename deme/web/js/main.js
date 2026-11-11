// App entry: first-run setup, sign-in, then the shell with navigation by role.
// Each view module exports mount(el, ctx) and returns a cleanup function.

import { api, data } from './api.js';
import { $, esc, info, wireInfo, oops, busy, toast } from './ui.js';
import { mountField, cssVarFor } from './fx.js';
import { MODULES, ROLES, ENTITIES, entityById } from '../shared/schema.js';

// Each area of the app wears one of the shared gradients.
export const VARIANT = {
  home: 'services', guide: 'hll-ai', import: 'engagement', pulse: 'services', tracker: 'hll-ontology', map: 'industries', room: 'hll-ontology', myday: 'hll-people', scan: 'hll-foundation', gate: 'hll-ai',
  masters: 'about', purchasing: 'engagement', inventory: 'industries', quality: 'hll-trust', production: 'services', b2b: 'contact', b2c: 'hll-application',
  logistics: 'hll-ai', finance: 'hll-foundation', hr: 'hll-people', projects: 'hll-ontology', marketing: 'engagement', design: 'about', admin: 'contact',
};
const VIEWS = {
  home: () => import('./home.js'), map: () => import('./map.js'), room: () => import('./room.js'),
  myday: () => import('./myday.js'), guide: () => import('./guide.js'), import: () => import('./smart.js'), pulse: () => import('./pulse.js'), tracker: () => import('./tracker.js'), scan: () => import('./scan.js'), gate: () => import('./gate.js'), erp: () => import('./erp.js'),
};
const slug = (id) => id.replace(/_/g, '-');
const unslug = (s) => s.replace(/-/g, '_');

const app = document.getElementById('app');
let cleanup = null, stopField = null, pending = {}, routeTurn = 0;

/** What this person can open, in menu order. */
function menu() {
  const c = data.can;
  const works = ['production', 'inventory', 'quality', 'b2b', 'b2c', 'logistics', 'finance', 'purchasing'].some((m) => c(m, 'read'));
  const top = [], floor = [], mods = [];
  if (c('admin', 'admin')) top.push(['pulse', 'Founder view']);
  if (works) top.push(['home', 'Today'], ['map', 'Business map']);
  if (c('production', 'read') || c('b2b', 'read') || c('design', 'read')) top.push(['room', 'Production room']);
  if (c('production', 'scan')) floor.push(['scan', 'Scan station']);
  if (c('logistics', 'write') || c('b2c', 'write') || c('production', 'write')) floor.push(['gate', 'Dispatch gate']);
  floor.push(['myday', 'My day']);
  const start = [['guide', 'Guide']];
  if (data.writable.size) start.push(['import', 'Bring in data']);
  for (const m of Object.keys(MODULES)) if (c(m, 'read')) mods.push([`m-${m}`, MODULES[m].name, m]);
  return { top, floor, mods, start };
}
const firstRoute = () => { const m = menu(); return (m.top[0] || m.floor[0])[0]; };

function parse() {
  const h = location.hash.slice(1);
  if (h === 'm-projects') return { view: 'tracker', module: 'projects', key: 'projects', name: h };
  if (h.startsWith('m-') && MODULES[h.slice(2)]) return { view: 'erp', module: h.slice(2), key: h.slice(2), name: h };
  if (h.startsWith('e-') && entityById[unslug(h.slice(2))]) { const e = entityById[unslug(h.slice(2))]; return { view: 'erp', module: e.module, entity: e.id, key: e.module, name: h }; }
  if (VIEWS[h] && h !== 'erp' && h !== 'tracker') return { view: h, key: h, name: h };
  return null;
}

const ctx = {
  /** Go to a route name ('map', 'm-quality', ...). `opts` reach the next view as ctx.opts. */
  go(name, opts = {}) { pending = opts; if (location.hash.slice(1) === name) route(); else location.hash = name; },
  /** Open a record type in the ERP, optionally a record ({ id }) or the add form ({ add: true }). */
  openEntity(entity, opts = {}) { ctx.go(`e-${slug(entity)}`, opts); },
};

/**
 * Where a scanned or typed code leads. Deme's own tags (rolls, bundles, store pieces, materials),
 * courier tracking barcodes on parcels, and any document number all resolve here.
 */
function findCode(raw) {
  const code = String(raw || '').trim(); if (!code) return null;
  const lc = code.toLowerCase();
  const hit = (entity, key) => (data.canRead(entity) ? data.all(entity).find((d) => String(d[key] ?? '').toLowerCase() === lc) : null);
  const canGate = data.can('logistics', 'write') || data.can('b2c', 'write') || data.can('production', 'write');
  if (canGate && (hit('parcels', 'barcode') || hit('store_orders', 'tag'))) return { name: 'gate', opts: { code } };
  if (data.can('production', 'scan') && (hit('bundles', 'no') || (!data.canRead('bundles') && /^b-\d+$/i.test(code)))) return { name: 'scan', opts: { code } };
  for (const [entity, key] of [['rolls', 'no'], ['items', 'code'], ['styles', 'code'], ['machines', 'code'], ['shop_orders', 'orderNo'], ['store_orders', 'tag'], ['parcels', 'barcode']]) { const d = hit(entity, key); if (d) return { entity, id: d.id }; }
  for (const e of ENTITIES) if (e.no) { const d = hit(e.id, 'no'); if (d) return { entity: e.id, id: d.id }; }
  if (canGate && !data.canRead('parcels')) return { name: 'gate', opts: { code } };
  return null;
}
function followCode(code) {
  const to = findCode(code);
  if (!to) { toast(`Nothing in Deme has the code ${String(code).trim()}.`, 'crit'); return false; }
  if (to.name) ctx.go(to.name, to.opts); else ctx.openEntity(to.entity, { id: to.id });
  return true;
}
// A handheld scanner types fast and ends with Enter. When no field has focus, catch that burst.
let burst = '', burstAt = 0;
document.addEventListener('keydown', (e) => {
  if (!data.ready || e.ctrlKey || e.metaKey || e.altKey) return;
  const t = e.target;
  if (t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
  const now = performance.now();
  if (e.key === 'Enter') { if (burst.length >= 4 && now - burstAt < 120) { e.preventDefault(); followCode(burst); } burst = ''; return; }
  if (e.key.length !== 1) return;
  burst = now - burstAt < 60 ? burst + e.key : e.key; burstAt = now;
});

async function route() {
  if (!data.ready) return;
  let r = parse();
  const m = menu();
  const allowed = new Set([...m.top, ...m.floor, ...m.mods, ...m.start].map((x) => x[0]));
  if (!r || !(allowed.has(r.name) || (r.module && allowed.has(`m-${r.module}`)))) { location.replace(`#${firstRoute()}`); return; }
  const opts = pending; pending = {};
  const turn = ++routeTurn; // a newer navigation cancels this one
  if (cleanup) { try { cleanup(); } catch (e) { console.error(e); } cleanup = null; }
  document.querySelector('.drawer-wrap')?.remove();
  document.querySelectorAll('.rail a').forEach((a) => { const on = a.dataset.route === r.name || (r.module && a.dataset.route === `m-${r.module}`); if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  document.querySelector('.shell')?.classList.remove('nav-open'); document.querySelector('.scrim')?.remove();
  document.documentElement.style.setProperty('--g', cssVarFor(VARIANT[r.key] || 'services'));
  const view = $('#view'); view.innerHTML = ''; view.dataset.view = r.view;
  try {
    const mod = await VIEWS[r.view]();
    if (turn !== routeTurn) return;
    cleanup = mod.mount(view, { ...ctx, opts, route: r }) || null;
    window.dispatchEvent(new CustomEvent('deme:routed', { detail: { name: r.name } }));   // the guide re-anchors on this
    if (opts.code) { const box = view.querySelector('#gtBarcode, #scBundle'); if (box) { box.value = opts.code; box.dispatchEvent(new Event('input', { bubbles: true })); box.focus(); } }
  } catch (e) {
    console.error(e);
    view.innerHTML = `<div class="workspace"><div class="empty"><h3>This screen could not open</h3><p>${esc(/dynamically imported module/.test(String(e.message)) ? 'It is not part of this build yet.' : e.message || e)}</p></div></div>`;
  }
}

function shell() {
  const m = menu();
  const link = ([name, label, mod]) => `<a href="#${name}" data-route="${name}" style="--gi:${cssVarFor(VARIANT[mod || name] || 'services')}">${esc(label)}</a>`;
  app.innerHTML = `
    <div class="shell">
      <nav class="rail" aria-label="Main">
        <div class="rail-top"><a class="brand" href="#${firstRoute()}">Deme</a></div>
        <form class="finder" id="finder" role="search"><label class="eyebrow" for="finderBox">Scan or find ${info('Scan any tag or type any number: a roll, bundle, parcel tracking barcode, store piece, material code, order or document number. You are taken to the record, or to the scan screen that handles it. With no field selected, a handheld scanner works from anywhere in the app.', 'Scan or find')}</label><input class="input" id="finderBox" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" enterkeyhint="go" placeholder="Tag or number"></form>
        <div class="rail-scroll">
          ${api.mode === 'local' ? `<div class="mode-flag">Preview without a server. Data stays in this browser. ${info('This page is running without the Deme server, so everything you add is saved only in this browser on this device. Run the server (see the README) for shared, permanent data and real sign-in.', 'Preview mode')}</div>` : ''}
          ${m.top.length ? `<div class="rail-group">${m.top.map(link).join('')}</div>` : ''}
          <div class="rail-group"><p class="eyebrow">On the floor</p>${m.floor.map(link).join('')}</div>
          ${m.mods.length ? `<div class="rail-group"><p class="eyebrow">ERP</p>${m.mods.map(link).join('')}</div>` : ''}
          <div class="rail-group"><p class="eyebrow">Getting going</p>${m.start.map(link).join('')}</div>
        </div>
        <div class="rail-foot"><div class="who"><strong>${esc(data.user.name)}</strong><span>${esc(ROLES[data.user.role].name)}</span></div><button class="btn btn-sm btn-quiet" type="button" id="signOut">Sign out</button></div>
      </nav>
      <div class="stage">
        <header class="topbar"><button class="icon-btn" type="button" id="navBtn" aria-label="Menu"><svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M3 5.5h14M3 10h14M3 14.5h14" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/></svg></button><span class="brand">Deme</span></header>
        <main id="view" tabindex="-1"></main>
        <div class="glow" aria-hidden="true"></div>
      </div>
    </div>`;
  $('#finder').addEventListener('submit', (e) => { e.preventDefault(); const box = $('#finderBox'); if (followCode(box.value)) box.value = ''; });
  $('#signOut').addEventListener('click', async () => { await api.logout().catch(() => {}); data.clear(); start(); });
  $('#navBtn').addEventListener('click', () => {
    const s = $('.shell'); s.classList.add('nav-open');
    const scrim = document.createElement('div'); scrim.className = 'scrim'; s.appendChild(scrim);
    scrim.addEventListener('click', () => { s.classList.remove('nav-open'); scrim.remove(); });
  });
}

function auth(setup) {
  if (cleanup) { try { cleanup(); } catch { /* leaving */ } cleanup = null; }
  app.innerHTML = `
    <div class="auth">
      <form class="auth-form" novalidate>
        <div><p class="sect">Deme Intelligence</p></div>
        <h1 class="reveal">${setup ? 'Set up Deme' : 'Sign in'}</h1>
        ${setup ? `<p class="muted">Nothing has been set up yet. The first account becomes the founder, with access to everything. ${info('The founder account can add every other team member under Admin, choose their role and reset passwords. Roles decide which modules a person can open and whether they can add, approve or only look.', 'First account')}</p>` : ''}
        ${setup ? '<div class="field"><label for="aName">Your name</label><input class="input" id="aName" autocomplete="name" required></div>' : ''}
        <div class="field"><label for="aEmail">Work email</label><input class="input" id="aEmail" type="email" autocomplete="username" required></div>
        <div class="field"><label for="aPass">Password</label><input class="input" id="aPass" type="password" autocomplete="${setup ? 'new-password' : 'current-password'}" required minlength="8">${setup ? '<span class="hint">At least 8 characters.</span>' : ''}</div>
        <p class="error" role="alert" hidden></p>
        <div class="row"><button class="btn btn-primary" type="submit">${setup ? 'Create the founder account' : 'Sign in'}</button>${api.caps.google ? `<a class="btn btn-outline" href="/api/auth/google/start">${setup ? 'Set up with Google' : 'Sign in with Google'}</a>${info('Use your Deme Google Workspace account. People already on the team list sign in as themselves. Anyone else in the Workspace is let in with self-service access only (attendance, leave, their own tasks) until an admin gives them a role.', 'Google sign-in')}` : ''}</div>
        ${api.mode === 'local' ? `<p class="faint" style="font-size:12px">Preview without a server: accounts and data are kept in this browser only. ${info('Open this app from the Deme server to share data across the team. In this preview, anyone using this browser profile can read what is stored.', 'Preview mode')}</p>` : ''}
      </form>
      <div class="auth-field"><canvas aria-hidden="true"></canvas><div class="wordmark" aria-hidden="true">Deme</div></div>
    </div>`;
  document.documentElement.style.setProperty('--g', cssVarFor('services'));
  stopField?.(); stopField = mountField($('.auth-field canvas'), 'services');
  const form = $('.auth-form'), err = $('.error', form);
  form.addEventListener('submit', (e) => {
    e.preventDefault(); err.hidden = true;
    busy(form.querySelector('button[type="submit"]'), async () => {
      try {
        if (setup) await api.setup({ name: $('#aName').value, email: $('#aEmail').value, password: $('#aPass').value });
        else await api.login($('#aEmail').value, $('#aPass').value);
        await enter();
      } catch (ex) { err.textContent = ex.message; err.hidden = false; }
    });
  });
  const why = { expired: 'That sign-in took too long. Try again.', google: 'Google did not confirm your account. Try again.', domain: 'Use your Deme Google Workspace account.', notlisted: 'Your Google account is not on the team list. Ask an admin to add you.' }[new URLSearchParams(location.search).get('signin')];
  if (why) { err.textContent = why; err.hidden = false; history.replaceState(null, '', location.pathname + location.hash); }
  (setup ? $('#aName') : $('#aEmail')).focus();
}

async function enter() {
  stopField?.(); stopField = null;
  await data.load();
  shell();
  if (parse()) route(); else location.replace(`#${firstRoute()}`); // the hash change starts the route
}

async function start() {
  try {
    const s = await api.state();
    if (s.user) await enter(); else auth(s.setupNeeded);
  } catch (e) {
    app.innerHTML = `<div class="boot boot-fail"><span>Deme Intelligence could not start</span><small>${esc(e.message)}</small><button class="btn btn-outline btn-sm" id="bootRetry">Try again</button></div>`;
    document.getElementById('bootRetry').onclick = () => { app.innerHTML = '<div class="boot">Deme</div>'; start(); };
  }
}

wireInfo();
window.addEventListener('hashchange', route);
// A request that comes back "sign in" means the session ended: return to the sign-in screen.
window.addEventListener('unhandledrejection', (e) => { if (e.reason?.status === 401 && data.ready) { data.clear(); start(); } else if (e.reason?.message) oops(e.reason); });
start();
export { ENTITIES };
