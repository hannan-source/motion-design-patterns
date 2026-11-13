// App entry: start a business or sign in, then the shell with navigation by role and by what the business has switched on.
// Each view module exports mount(el, ctx) and returns a cleanup function.

import { api, data } from './api.js';
import { $, esc, info, wireInfo, oops, busy, toast } from './ui.js';
import { mountField, cssVarFor } from './fx.js';
import { MODULES, ROLES, ENTITIES, entityById } from '../shared/schema.js';
import { positionById, isHead } from '../shared/org.js';

// Each area of the app wears one of the shared gradients.
export const VARIANT = {
  build: 'hll-foundation', chat: 'hll-people', flows: 'hll-ai', people: 'hll-people', crm: 'contact', lists: 'industries',
  home: 'services', journey: 'hll-people', org: 'about', dayplan: 'hll-ontology', dye: 'hll-trust', orders: 'services', channels: 'engagement', privacy: 'contact', guide: 'hll-ai', import: 'engagement', pulse: 'services', tracker: 'hll-ontology', map: 'industries', room: 'hll-ontology', myday: 'hll-people', scan: 'hll-foundation', gate: 'hll-ai',
  masters: 'about', purchasing: 'engagement', inventory: 'industries', quality: 'hll-trust', production: 'services', b2b: 'contact', b2c: 'hll-application',
  logistics: 'hll-ai', finance: 'hll-foundation', hr: 'hll-people', projects: 'hll-ontology', marketing: 'engagement', design: 'about', admin: 'contact',
};
const VIEWS = {
  home: () => import('./home.js'), journey: () => import('./journey.js'), org: () => import('./org.js'), dayplan: () => import('./dayplan.js'), dye: () => import('./dye.js'), orders: () => import('./orders.js'), channels: () => import('./channels.js'), privacy: () => import('./privacy.js'), map: () => import('./map.js'), room: () => import('./room.js'),
  myday: () => import('./myday.js'), build: () => import('./build.js'), chat: () => import('./chat.js'), flows: () => import('./flows.js'), people: () => import('./people.js'), guide: () => import('./guide.js'), import: () => import('./smart.js'), pulse: () => import('./pulse.js'), tracker: () => import('./tracker.js'), scan: () => import('./scan.js'), gate: () => import('./gate.js'), erp: () => import('./erp.js'),
};
const slug = (id) => id.replace(/_/g, '-');
const unslug = (s) => s.replace(/-/g, '_');

const app = document.getElementById('app');
let cleanup = null, stopField = null, pending = {}, routeTurn = 0;

/** What this person can open, in menu order. */
function menu() {
  const c = data.can, has = (list) => !!entityById[list];
  const works = ['production', 'inventory', 'quality', 'b2b', 'b2c', 'logistics', 'purchasing'].some((m) => c(m, 'read'));
  const top = [], floor = [], mods = [];
  // The founder opens on the result; everyone else opens on what is theirs to do.
  const founder = data.user.position === 'founder' || data.user.role === 'founder';
  if (founder) top.push(['pulse', 'Founder view'], ['journey', 'My journey']);
  else { top.push(['journey', 'My journey']); if (c('admin', 'admin')) top.push(['pulse', 'Founder view']); }
  if (has('chat_channels') && c('projects', 'read')) top.push(['chat', 'Chat']);
  if (c('projects', 'read')) { if (has('slips')) top.push(['orders', 'Orders']); top.push(['org', 'Work centres']); }
  if (works) top.push(['home', 'Today']);
  if (c('projects', 'read')) top.push(['map', 'Business map']);
  if (has('work_orders') && (c('production', 'read') || c('b2b', 'read') || c('design', 'read'))) top.push(['room', 'Production room']);
  if (has('day_plans') && c('production', 'write')) floor.push(['dayplan', 'Day plan']);
  // The scan screens are for people who work the floor: tailors (scan level), those who run it, and QC. Not for everyone who can merely look at Production.
  const onFloor = data.level('production') === 'scan' || c('production', 'write');
  if (has('slips') && (onFloor || c('quality', 'write'))) floor.push(['slip', 'Scan a slip']);
  if (has('bundles') && onFloor) floor.push(['scan', 'Scan station']);
  if (has('dye_lots') && c('quality', 'scan')) floor.push(['dye', 'Dye house']);
  if (has('parcels') && (c('logistics', 'write') || c('b2c', 'write') || c('production', 'write'))) floor.push(['gate', 'Dispatch gate']);
  floor.push(['myday', 'My day']);
  if (has('payslips') && c('hr', 'read')) floor.push(['people', 'People and pay']);
  const start = [['guide', 'Guide']];
  if (has('media_days') && c('marketing', 'read')) top.push(['channels', 'Channels']);
  if (c('admin', 'admin')) start.unshift(['build', 'Build']);
  if (has('flows') && c('admin', 'admin')) start.push(['flows', 'Workflows']);
  if (c('admin', 'admin')) start.push(['privacy', 'Privacy']);
  if (data.writable.size) start.push(['import', 'Bring in data']);
  for (const m of Object.keys(MODULES)) if (c(m, 'read') && ENTITIES.some((e) => e.module === m && data.canRead(e.id))) mods.push([`m-${m}`, MODULES[m].name, m]);
  return { top, floor, mods, start };
}
const firstRoute = () => { const m = menu(); return (m.top[0] || m.floor[0])[0]; };

function parse() {
  const h = location.hash.slice(1);
  if (h === 'm-projects') return { view: 'tracker', module: 'projects', key: 'projects', name: h };
  // A slip's QR code and its notices link here. Whoever scans it gets the one screen for their job.
  if (h === 'slip' || h.startsWith('slip-')) return { view: 'orders', key: 'orders', name: 'slip', slip: h.slice(5).toUpperCase() };
  if (h.startsWith('task-')) return { view: 'tracker', module: 'projects', key: 'projects', name: 'm-projects', task: h.slice(5) };   // a link from a notice or an email
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
 * Where a scanned or typed code leads. The business's own tags (rolls, bundles, store pieces, materials),
 * courier tracking barcodes on parcels, and any document number all resolve here.
 */
function findCode(raw) {
  const code = String(raw || '').trim(); if (!code) return null;
  // A slip's QR code holds a link to it; its number alone works too.
  const slip = /slip-([A-Za-z]+-\d+)/i.exec(code)?.[1] || (data.all('slips').some((x) => String(x.no).toLowerCase() === code.toLowerCase()) ? code : '');
  if (slip) return { name: `slip-${slip.toUpperCase()}`, opts: {} };
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
  if (!to) { toast(`Nothing here has the code ${String(code).trim()}.`, 'crit'); return false; }
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

let lastLook = 0;
async function route() {
  if (!data.ready) return;
  // Moving to another screen is a good moment to pick up what other people have changed.
  if (Date.now() - lastLook > 5000) { lastLook = Date.now(); data.poll().catch(() => {}); }
  let r = parse();
  const m = menu();
  const allowed = new Set([...m.top, ...m.floor, ...m.mods, ...m.start].map((x) => x[0]));
  if (r && r.name === 'slip' && !allowed.has('slip') && allowed.has('orders')) r.name = 'orders';   // followers open the slip on the Orders screen
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

// ── Notices: what needs this person, wherever they are in the app ──
const BELL = '<svg viewBox="0 0 20 20" width="17" height="17" aria-hidden="true"><path d="M10 3a4.5 4.5 0 0 0-4.5 4.5c0 3.2-1.5 4.6-1.5 4.6h12s-1.5-1.4-1.5-4.6A4.5 4.5 0 0 0 10 3zM8.3 15a1.8 1.8 0 0 0 3.4 0" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const unread = () => data.inbox.filter((n) => !n.read).length;
const bell = (id) => `<button class="icon-btn bell" type="button" id="${id}" aria-label="Notices" aria-expanded="false">${BELL}<span class="bell-n" ${unread() ? '' : 'hidden'}>${unread()}</span></button>`;
const ago = (at) => { const m = Math.max(0, Math.round((Date.now() - Date.parse(at)) / 60000)); return m < 1 ? 'now' : m < 60 ? `${m} min` : m < 1440 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} d`; };
function paintBell() { document.querySelectorAll('.bell').forEach((b) => { const n = b.querySelector('.bell-n'); n.textContent = unread(); n.hidden = !unread(); }); const box = document.querySelector('.inbox'); if (box) box.innerHTML = inboxHtml(); }
const inboxHtml = () => `<header><h2>Notices</h2>${info(api.caps.mail ? 'Each notice is also sent to your email.' : 'What needs you: a task given to you, a request to your work centre, a comment, something you were waiting for. Email notices switch on when the site has a mail key.', 'Notices')}${unread() ? '<button class="link" type="button" data-read-all>Mark all read</button>' : ''}</header>${data.inbox.length ? `<ul>${data.inbox.slice(0, 30).map((n) => `<li><button type="button" data-notice="${esc(n.id)}" data-link="${esc(n.link || '')}" class="${n.read ? '' : 'is-new'}"><span class="inbox-text">${esc(n.text)}</span><span class="inbox-meta">${esc(n.byName || '')}${n.byName ? ' · ' : ''}${ago(n.at)}</span></button></li>`).join('')}</ul>` : '<p class="inbox-none">Nothing needs you right now.</p>'}`;
function closeInbox() { document.querySelector('.inbox')?.remove(); document.querySelectorAll('.bell').forEach((b) => b.setAttribute('aria-expanded', 'false')); }
function toggleInbox(btn) {
  if (document.querySelector('.inbox')) return closeInbox();
  const box = document.createElement('section'); box.className = 'inbox'; box.setAttribute('aria-label', 'Notices'); box.innerHTML = inboxHtml();
  document.body.appendChild(box); btn.setAttribute('aria-expanded', 'true');
  const r = btn.getBoundingClientRect(); box.style.top = `${r.bottom + 8}px`; box.style.left = `${Math.max(8, Math.min(r.left, innerWidth - box.offsetWidth - 8))}px`;
  box.addEventListener('click', async (e) => {
    const all = e.target.closest('[data-read-all]'), one = e.target.closest('[data-notice]');
    if (all) { await api.readInbox().catch(oops); return; }
    if (!one) return;
    const link = one.dataset.link; closeInbox();
    api.readInbox([one.dataset.notice]).catch(() => {});
    if (link) location.hash = link;
  });
}
document.addEventListener('click', (e) => { if (!e.target.closest('.inbox, .bell')) closeInbox(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeInbox(); });
data.on((touched) => { if (touched.includes('notifications') || touched.includes('*')) paintBell(); });
// While the app is open, look for new notices and other people's changes to tasks.
setInterval(() => { if (data.ready && !document.hidden) data.poll().catch(() => {}); }, 40000);
document.addEventListener('visibilitychange', () => { if (data.ready && !document.hidden) data.poll().catch(() => {}); });

function shell() {
  const m = menu();
  const link = ([name, label, mod]) => `<a href="#${name}" data-route="${name}" style="--gi:${cssVarFor(VARIANT[mod || name] || 'services')}">${esc(label)}</a>`;
  app.innerHTML = `
    <div class="shell">
      <nav class="rail" aria-label="Main">
        <div class="rail-top"><a class="brand" href="#${firstRoute()}" title="${esc(api.product)}">${esc(data.workspace?.name || 'Lychee')}</a>${bell('bellBtn')}</div>
        <form class="finder" id="finder" role="search"><label class="eyebrow" for="finderBox">Scan or find ${info('Scan any tag or type any number: a roll, bundle, parcel tracking barcode, store piece, material code, order or document number. You are taken to the record, or to the scan screen that handles it. With no field selected, a handheld scanner works from anywhere in the app.', 'Scan or find')}</label><input class="input" id="finderBox" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" enterkeyhint="go" placeholder="Tag or number"></form>
        <div class="rail-scroll">
          ${api.mode === 'local' ? `<div class="mode-flag">Preview without a server. Data stays in this browser. ${info('This page is running without a server, so everything you add is saved only in this browser on this device. Run the server (see the README) for shared, permanent data and real sign-in.', 'Preview mode')}</div>` : ''}
          ${m.top.length ? `<div class="rail-group">${m.top.map(link).join('')}</div>` : ''}
          <div class="rail-group"><p class="eyebrow">On the floor</p>${m.floor.map(link).join('')}</div>
          ${m.mods.length ? `<div class="rail-group"><p class="eyebrow">Records</p>${m.mods.map(link).join('')}</div>` : ''}
          <div class="rail-group"><p class="eyebrow">Getting going</p>${m.start.map(link).join('')}</div>
        </div>
        <div class="rail-foot"><div class="who"><strong>${esc(data.user.name)}</strong><span>${esc(positionById[data.user.position]?.name || ROLES[data.user.role].name)}</span></div><button class="btn btn-sm btn-quiet" type="button" id="signOut">Sign out</button></div>
      </nav>
      <div class="stage">
        <header class="topbar"><button class="icon-btn" type="button" id="navBtn" aria-label="Menu"><svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M3 5.5h14M3 10h14M3 14.5h14" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/></svg></button><span class="brand">${esc(data.workspace?.name || 'Lychee')}</span>${bell('bellBtnTop')}</header>
        <main id="view" tabindex="-1"></main>
        <div class="glow" aria-hidden="true"></div>
      </div>
    </div>`;
  document.querySelectorAll('.bell').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); toggleInbox(b); }));
  $('#finder').addEventListener('submit', (e) => { e.preventDefault(); const box = $('#finderBox'); if (followCode(box.value)) box.value = ''; });
  $('#signOut').addEventListener('click', async () => { await api.logout().catch(() => {}); data.clear(); start(); });
  $('#navBtn').addEventListener('click', () => {
    const s = $('.shell'); s.classList.add('nav-open');
    const scrim = document.createElement('div'); scrim.className = 'scrim'; s.appendChild(scrim);
    scrim.addEventListener('click', () => { s.classList.remove('nav-open'); scrim.remove(); });
  });
}

const G = '<svg viewBox="0 0 18 18" width="15" height="15" aria-hidden="true"><path d="M15.4 5.9A7 7 0 1 0 16 9H9.6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
/**
 * The door. Four ways through it: sign in; start a business (name it, pick the template it starts
 * from, become its first admin); take up an invitation; or, where one person is on several
 * businesses, choose which.
 */
function auth(view = 'signin', extra = {}) {
  if (cleanup) { try { cleanup(); } catch { /* leaving */ } cleanup = null; }
  const canStart = api.caps.signup === 'first' || api.caps.signup === 'open' || api.caps.signup === 'code';
  if (view === 'signin' && api.caps.signup === 'first') view = 'create';
  const create = view === 'create', invite = view === 'invite', choose = view === 'choose';
  const googleBtn = api.caps.google
    ? `<a class="btn btn-outline" href="/api/auth/google/start">${G}${create ? 'Start with Google' : 'Sign in with Google'}</a>${info('Use your company Google account. People already on a team sign in as themselves. Anyone else from a company whose Google domain is registered here comes in, picks the position they hold, and waits for the head of that work centre to confirm it.', 'Google sign-in')}`
    : `<button class="btn btn-outline" type="button" id="gOff">${G}Sign in with Google</button>${info(api.mode === 'local' ? 'Google sign-in works on the live site, not in this preview: a preview has no server to check the account with Google.' : 'Google sign-in is not connected on this site yet. It is switched on with the Google keys in the site settings.', 'Google sign-in')}`;
  const field = (id, label, attrs, hint = '') => `<div class="field"><label for="${id}">${label}</label><input class="input" id="${id}" ${attrs}>${hint ? `<span class="hint">${hint}</span>` : ''}</div>`;
  const body = choose ? `
        <h1 class="reveal">Which business?</h1>
        <p class="muted">This email has a login on more than one.</p>
        <div class="auth-choices">${extra.choose.map((c) => `<button class="auth-choice" type="button" data-ws="${esc(c.ws)}"><strong>${esc(c.name)}</strong></button>`).join('')}</div>
        <p class="error" role="alert" hidden></p>
        <div class="row"><button class="btn btn-quiet" type="button" data-view="signin">Back</button></div>`
    : invite ? `
        <h1 class="reveal">Join ${esc(extra.business)}</h1>
        <p class="muted">${esc(extra.name)}, you have been invited as <strong>${esc(extra.email)}</strong>. Choose a password to come in${extra.google ? ', or use your Google account' : ''}.</p>
        ${field('aPass', 'Password', 'type="password" autocomplete="new-password" required minlength="8"', 'At least 8 characters.')}
        <p class="error" role="alert" hidden></p>
        <div class="row"><button class="btn btn-primary" type="submit">Join</button>${extra.google ? `<a class="btn btn-outline" href="/api/auth/google/start">${G}Use Google</a>` : ''}</div>`
    : create ? `
        <h1 class="reveal">Start your business</h1>
        <p class="muted">Name it, pick what it starts from, and you are its first admin. ${info('The first account is the admin: it shapes the work centres, names the person in charge of each, invites the team and switches areas on. Everyone else is added or invited afterwards. What a business starts from can be changed later: areas can be switched on and off, and lists of its own added.', 'Starting a business')}</p>
        ${field('aBiz', 'Business name', 'autocomplete="organization" required maxlength="60"')}
        <fieldset class="auth-templates"><legend>It starts from</legend>${api.templates.map((t, i) => `<label class="auth-tpl"><input type="radio" name="tpl" value="${esc(t.id)}" ${i === 0 ? 'checked' : ''}><span><strong>${esc(t.name)}</strong><small>${esc(t.line)}</small></span></label>`).join('')}</fieldset>
        ${field('aName', 'Your name', 'autocomplete="name" required')}
        ${field('aEmail', 'Work email', 'type="email" autocomplete="username" required')}
        ${field('aPass', 'Password', 'type="password" autocomplete="new-password" required minlength="8"', 'At least 8 characters.')}
        ${api.caps.signup === 'code' ? field('aCode', 'Sign-up code', 'autocomplete="off" required', 'From Hyper Lychee Labs.') : ''}
        <p class="error" role="alert" hidden></p>
        <div class="row"><button class="btn btn-primary" type="submit">Start</button>${api.caps.signup === 'first' ? '' : '<button class="btn btn-quiet" type="button" data-view="signin">I have a login</button>'}</div>`
    : `
        <h1 class="reveal">Sign in</h1>
        ${!api.caps.passwords ? '<p class="muted">Sign in with your company Google account.</p>' : `${field('aEmail', 'Work email', 'type="email" autocomplete="username" required')}${field('aPass', 'Password', 'type="password" autocomplete="current-password" required minlength="8"')}`}
        <p class="error" role="alert" hidden></p>
        <div class="row">${api.caps.passwords ? '<button class="btn btn-primary" type="submit">Sign in</button>' : ''}${googleBtn}</div>
        ${canStart ? '<p class="auth-alt">New here? <button class="link" type="button" data-view="create">Start a business</button></p>' : ''}`;
  app.innerHTML = `
    <div class="auth">
      <form class="auth-form" novalidate>
        <div><p class="sect">${esc(api.product)}</p></div>
        ${body}
        ${api.mode === 'local' ? `<p class="faint" style="font-size:12px">Preview without a server: accounts and data are kept in this browser only. ${info('In this preview, everything you add is saved only in this browser on this device, and anyone using this browser profile can read it. The live site keeps data on the server and shares it across the team.', 'Preview mode')}</p>` : ''}
      </form>
      <div class="auth-field"><canvas aria-hidden="true"></canvas><div class="wordmark" aria-hidden="true">${esc(extra.business || 'Lychee')}</div></div>
    </div>`;
  document.documentElement.style.setProperty('--g', cssVarFor('services'));
  stopField?.(); stopField = mountField($('.auth-field canvas'), 'services');
  const form = $('.auth-form'), err = $('.error', form);
  const say = (msg) => { err.textContent = msg; err.hidden = false; };
  $('#gOff')?.addEventListener('click', () => say(api.mode === 'local' ? 'Google sign-in works on the live site. This preview keeps accounts in your browser, so use an email and password here.' : 'Google sign-in is not connected on this site yet.'));
  form.addEventListener('click', (e) => {
    const to = e.target.closest('[data-view]'); if (to) return auth(to.dataset.view);
    const pick = e.target.closest('[data-ws]');
    if (pick) busy(pick, async () => { try { await api.login(extra.email, extra.password, pick.dataset.ws); await enter(); } catch (ex) { say(ex.message); } });
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault(); err.hidden = true;
    busy(form.querySelector('button[type="submit"]'), async () => {
      try {
        if (create) await api.setup({ business: $('#aBiz').value, template: form.querySelector('[name="tpl"]:checked')?.value, name: $('#aName').value, email: $('#aEmail').value, password: $('#aPass').value, code: $('#aCode')?.value });
        else if (invite) { await api.acceptInvite(extra.token, $('#aPass').value); history.replaceState(null, '', location.pathname); }
        else { const out = await api.login($('#aEmail').value, $('#aPass').value); if (out.choose) return auth('choose', { choose: out.choose, email: $('#aEmail').value, password: $('#aPass').value }); }
        await api.state();   // what is switched on for the business just entered
        await enter();
      } catch (ex) { say(ex.message); }
    });
  });
  const why = { expired: 'That sign-in took too long. Try again.', google: 'Google did not confirm your account. Try again.', domain: 'Use your company Google account.', notlisted: 'Your Google account is not on a team here. Ask an admin to invite you.' }[new URLSearchParams(location.search).get('signin')];
  if (why) { say(why); history.replaceState(null, '', location.pathname + location.hash); }
  form.querySelector('input:not([type="radio"])')?.focus();
}

async function enter() {
  stopField?.(); stopField = null;
  await data.load();
  document.title = `${data.workspace?.name || 'Lychee'} · ${api.product}`;
  shell();
  if (parse()) route(); else location.replace(`#${firstRoute()}`); // the hash change starts the route
}

async function start() {
  try {
    const s = await api.state();
    if (s.user) return await enter();
    // Someone following an invitation link: show who it is for.
    const token = new URLSearchParams(location.search).get('invite');
    if (token && api.mode === 'server') {
      try { const inv = await api.invite(token); return auth('invite', { ...inv, token }); }
      catch (ex) { auth('signin'); const err = $('.auth-form .error'); err.textContent = ex.message; err.hidden = false; return; }
    }
    auth(s.setupNeeded ? 'create' : 'signin');
  } catch (e) {
    app.innerHTML = `<div class="boot boot-fail"><span>${esc(api.product)} could not start</span><small>${esc(e.message)}</small><button class="btn btn-outline btn-sm" id="bootRetry">Try again</button></div>`;
    document.getElementById('bootRetry').onclick = () => { app.innerHTML = '<div class="boot">Lychee</div>'; start(); };
  }
}

wireInfo();
window.addEventListener('hashchange', route);
// A request that comes back "sign in" means the session ended: return to the sign-in screen.
window.addEventListener('unhandledrejection', (e) => { if (e.reason?.status === 401 && data.ready) { data.clear(); start(); } else if (e.reason?.message) oops(e.reason); });
start();
export { ENTITIES };
