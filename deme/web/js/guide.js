// The Guide: short tours for each kind of team member, played over the real screens.
//
// Two parts live here. mount() draws the Guide screen (route `guide`): pick a role, see its
// tours, press Watch or Step through. The player is a singleton on document.body, outside the
// routed view, because the view is replaced on every navigation and a tour crosses many screens.
// For each step it goes to the step's screen, finds the real control, lights it and says what to
// do. It never saves anything: it only goes to screens and presses controls that show something
// (a tab, an Add form, a record), and it refuses any control that would post or delete.
//
// The content is data in guides-content.js. Other screens can start a tour with startTour().

import { data } from './api.js';
import { $, $$, esc, info, toast } from './ui.js';
import { MODULES, ROLES, ENTITIES, entityById, can as canRole } from '../shared/schema.js';
import { GUIDE_ROLES, TOURS } from './guides-content.js';

const tourById = Object.fromEntries(TOURS.map((t) => [t.id, t]));
const roleById = Object.fromEntries(GUIDE_ROLES.map((r) => [r.id, r]));
const unslug = (s) => s.replace(/-/g, '_');
const list = (v) => (v === undefined || v === null || v === '' ? [] : [].concat(v));
const here = () => location.hash.slice(1);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const words = (s) => String(s || '').trim().split(/\s+/).filter(Boolean).length;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const TICK = '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ARROW = '<svg class="gd-arrow" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M3 8h9.5M8.5 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const PLAY = '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M4.5 2.8v10.4L13 8z" fill="currentColor"/></svg>';
const PAUSE = '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M4 3h3v10H4zM9 3h3v10H9z" fill="currentColor"/></svg>';

// ───────── Screens: their names and who may open them ─────────
const SCREENS = { pulse: 'Founder view', home: 'Today', map: 'Business map', room: 'Production room', scan: 'Scan station', gate: 'Dispatch gate', myday: 'My day', guide: 'Guide', import: 'Bring in data' };
function routeName(route) {
  if (SCREENS[route]) return SCREENS[route];
  if (route.startsWith('m-')) return MODULES[route.slice(2)]?.name || route;
  if (route.startsWith('e-')) return entityById[unslug(route.slice(2))]?.name || route;
  return route;
}
/** Whether a route opens for someone, given c(module, level). The same rule as the menu in main.js. */
function opens(route, c) {
  switch (route) {
    case 'guide': case 'myday': return true;
    case 'import': return ENTITIES.some((e) => !e.readonly && (c(e.module, e.level || 'write') || (e.alsoWrite || []).some((m) => c(m, 'write'))));
    case 'pulse': return c('admin', 'admin');
    case 'home': case 'map': return ['production', 'inventory', 'quality', 'b2b', 'b2c', 'logistics', 'finance', 'purchasing'].some((m) => c(m, 'read'));
    case 'room': return c('production', 'read') || c('b2b', 'read') || c('design', 'read');
    case 'scan': return c('production', 'scan');
    case 'gate': return c('logistics', 'write') || c('b2c', 'write') || c('production', 'write');
    default:
  }
  if (route.startsWith('m-')) return !!MODULES[route.slice(2)] && c(route.slice(2), 'read');
  if (route.startsWith('e-')) { const e = entityById[unslug(route.slice(2))]; return !!e && c(e.module, 'read'); }
  return false;
}
function mayOpen(route) {
  try {
    if (!route) return true;
    if (route === 'import') return data.writable.size > 0;
    return opens(route, (m, l) => data.can(m, l));
  } catch { return false; }
}
const whoOpens = (route) => Object.entries(ROLES).filter(([id]) => opens(route, (m, l) => canRole({ role: id }, m, l))).map(([, r]) => r.name.replace(/\s*\(.*\)$/, ''));
/** The screen a step is on: the first of its routes this login may open, else the first. */
const routeOf = (step) => { const all = list(step.route); return all.find(mayOpen) || all[0] || ''; };

// ───────── What this person has finished, kept on this device ─────────
const storeKey = () => `deme-guide:${data.user?.id || 'anon'}`;
function recall() { try { const v = JSON.parse(localStorage.getItem(storeKey()) || 'null'); return v && typeof v === 'object' ? v : {}; } catch { return {}; } }
function remember(patch) { try { localStorage.setItem(storeKey(), JSON.stringify({ ...recall(), ...patch })); } catch { /* storage blocked: this visit only */ } }
let doneNow = null, doneFor = ''; // in memory too, so a tick shows even where storage is blocked
function doneSet() {
  if (doneFor !== storeKey()) { doneFor = storeKey(); doneNow = new Set(list(recall().done).filter((id) => tourById[id])); }
  return doneNow;
}
function markDone(id) { const s = doneSet(); s.add(id); remember({ done: [...s] }); }

/** The guide role closest to an ERP role: the one that names it first, else any that names it. */
function matchRole(erp = data.user?.role) {
  return (GUIDE_ROLES.find((r) => r.erp[0] === erp) || GUIDE_ROLES.find((r) => r.erp.includes(erp)) || roleById.everyone).id;
}
/** A role's tours: its own first, then the ones it shares, in the order they are written. */
function toursFor(roleId) {
  const mine = TOURS.filter((t) => t.roles.includes(roleId));
  return [...mine.filter((t) => t.roles[0] === roleId), ...mine.filter((t) => t.roles[0] !== roleId)];
}
function ensureCss() {
  // Already there as a linked sheet, or inlined into the page (the hosted preview): the sheet sets this marker.
  if (document.querySelector('link[href*="guide.css"]') || getComputedStyle(document.documentElement).getPropertyValue('--guide-css').trim()) return;
  const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = new URL('../css/guide.css', import.meta.url).href;
  document.head.appendChild(link);
}

// ═════════ The player ═════════
const P = {
  on: false, tour: null, mode: 'step', i: 0, step: null, ctx: null, role: '',
  root: null, card: null, spot: null, blocks: [],
  run: 0,            // bumps on every step change, so older waiting work gives up
  phase: 'idle',     // idle | seeking | shown | ended
  route: '', blocked: false, missing: false, sel: '',
  target: null, clips: [], side: '', drawn: '',
  playing: false, elapsed: 0, length: 0, lastT: 0, lastLook: 0, raf: 0, moveT: 0,
  opened: false, navOpened: false, focusBack: null,
};
let lastCtx = null;     // the router's ctx from the last time the Guide screen was mounted
let guideSeen = false;  // the `guide` route exists in this build

const seen = (el) => { if (!el || !el.isConnected) return false; const r = el.getBoundingClientRect(); return r.width > 0.5 && r.height > 0.5; };
/** The first element matching `sel` that is laid out. Never throws on a selector the browser cannot read. */
function find(sel) {
  if (!sel) return null;
  try { for (const el of document.querySelectorAll(sel)) if (!el.closest('.gd-player') && seen(el)) return el; } catch { /* not a selector */ }
  return null;
}
async function until(fn, ms, run) {
  const t0 = performance.now();
  for (;;) {
    const v = fn(); if (v) return v;
    if (run !== P.run || performance.now() - t0 >= ms) return null;
    await wait(50);
  }
}

/** Go to a route and wait for its screen. False when the router sent us somewhere else. */
async function travel(route, run) {
  if (here() === route) return true;
  let routed = false;
  const on = (e) => { if (!e.detail?.name || e.detail.name === route) routed = true; };
  window.addEventListener('deme:routed', on);
  try {
    const go = P.ctx?.go || ((r) => { location.hash = r; });
    go(route);
    const t0 = performance.now();
    for (;;) {
      await wait(40);
      if (run !== P.run) return false;
      if (here() !== route) return false;
      if (routed) return true;
      const dt = performance.now() - t0, view = document.getElementById('view');
      if (dt > 300 && view?.childElementCount) return true; // a router that does not announce itself
      if (dt > 3000) return true;
    }
  } finally { window.removeEventListener('deme:routed', on); }
}

// The player presses a control only to show something. Anything that saves, posts, scans or
// deletes is refused here, whatever the content file says.
const FORM_ACTIONS = new Set([...ENTITIES.flatMap((e) => (e.actions || []).filter((a) => a.form).map((a) => a.id)), 'stock.adjust', 'stock.issue']);
function safeToPress(el) {
  if (el.closest('.gd-player') || el.disabled) return false;
  if (el.matches('[type="submit"], [data-delete], [data-run], [data-mark], [data-print], [data-send], [data-raise], [data-remove], [data-task], [data-do], [data-reset], [data-key]')) return false;
  if (/^(tkPlanCreate|scStart|scFinish|gtGo|siImport|siRead|mdCheckBtn|signOut)$/.test(el.id || '')) return false;
  if (el.dataset.action !== undefined && !FORM_ACTIONS.has(el.dataset.action)) return false;
  if (el.dataset.act !== undefined && !['add', 'import', 'tags', 'tally'].includes(el.dataset.act)) return false;
  return true;
}

/**
 * Press a control. An ERP list handles its own clicks on .tabs and .erp-body, so the click is
 * stopped at the screen's root: screens visited earlier may have left click handlers on the view
 * element above it (the Dispatch gate listens there for [data-open]), and those must not fire.
 */
function press(b) {
  const root = document.getElementById('view')?.firstElementChild;
  const hold = (e) => e.stopPropagation();
  const guard = !!root && root.matches('.erp') && root.contains(b);
  if (guard) root.addEventListener('click', hold);
  try { b.click(); } finally { if (guard) root.removeEventListener('click', hold); }
}

/** Find a step's target, pressing its `open` controls if it is not on screen yet, else an `alt`. */
async function locate(step, run) {
  if (!step.target) return { el: null, sel: '' };
  const alts = list(step.alt), presses = list(step.open);
  let el = await until(() => find(step.target), presses.length ? 250 : alts.length ? 700 : 3000, run);
  if (!el && presses.length && run === P.run) {
    let ok = true;
    for (const sel of presses) {
      const b = await until(() => find(sel), 700, run);
      if (!b || run !== P.run || !safeToPress(b)) { ok = false; break; }
      press(b); P.opened = true;
      await wait(30);
    }
    if (ok && run === P.run) el = await until(() => find(step.target), 1200, run);
  }
  if (el) return { el, sel: step.target };
  for (const sel of alts) { const a = find(sel); if (a) return { el: a, sel }; }
  return { el: null, sel: '' };
}

function shutDrawer() {
  const dw = document.querySelector('.drawer-wrap'); if (!dw) return;
  try { dw.querySelector('[data-close]')?.click(); } catch { /* fall through */ }
  if (dw.isConnected) dw.remove();
}
/** On a narrow screen the menu is off to the side: slide it in for a target inside it, and back out after. */
function minding(el) {
  const shell = document.querySelector('.shell'); if (!shell) return;
  const rail = el?.closest('.rail');
  if (rail && !shell.classList.contains('nav-open') && rail.getBoundingClientRect().right <= 4) { document.getElementById('navBtn')?.click(); P.navOpened = true; }
  else if (!rail && shell.classList.contains('nav-open')) closeNav();
}
function closeNav() {
  const shell = document.querySelector('.shell'); if (!shell) return;
  const scrim = shell.querySelector('.scrim');
  if (scrim) scrim.click();
  shell.classList.remove('nav-open'); shell.querySelector('.scrim')?.remove();
  P.navOpened = false;
}

/** Every ancestor that clips or scrolls the element, nearest first. */
function clipsOf(el) {
  const out = [];
  for (let p = el.parentElement; p && p !== document.documentElement; p = p.parentElement) {
    const cs = getComputedStyle(p);
    if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') out.push({ el: p, x: /auto|scroll/.test(cs.overflowX), y: /auto|scroll/.test(cs.overflowY) });
  }
  return out;
}
/** What to light for a found element: a form control is lit together with its label. */
const lit = (el) => (el && el.matches('input, select, textarea') && el.closest('.field')) || el || null;
function setTarget(el, sel = '') { P.target = lit(el); P.sel = el ? sel : ''; P.clips = P.target ? clipsOf(P.target) : []; }

/** Scroll the target into view inside each of its scroll containers, clear of `keep` px at the foot of the window. */
function reveal(el, keep = 0) {
  for (const c of P.clips) {
    const p = c.el;
    if (c.y && p.scrollHeight > p.clientHeight + 1) {
      const pr = p.getBoundingClientRect(), r = el.getBoundingClientRect();
      const top = Math.max(pr.top, 0) + 14, bottom = Math.min(pr.bottom, innerHeight - keep) - 14, band = bottom - top;
      if (band > 40) {
        const d = r.height > band ? r.top - top : (r.top < top || r.bottom > bottom ? r.top - (top + (band - r.height) / 2) : 0);
        if (d) p.scrollTop += d;
      }
    }
    if (c.x && p.scrollWidth > p.clientWidth + 1) {
      const pr = p.getBoundingClientRect(), r = el.getBoundingClientRect();
      const left = Math.max(pr.left, 0) + 14, right = Math.min(pr.right, innerWidth) - 14, band = right - left;
      if (band > 40) {
        const d = r.width > band ? r.left - left : (r.left < left || r.right > right ? r.left - (left + (band - r.width) / 2) : 0);
        if (d) p.scrollLeft += d;
      }
    }
  }
}
/** The part of the target that shows, in window px. Null when it is scrolled out of sight. */
function showing(el) {
  const r = el.getBoundingClientRect();
  let x1 = Math.max(r.left, 0), y1 = Math.max(r.top, 0), x2 = Math.min(r.right, innerWidth), y2 = Math.min(r.bottom, innerHeight);
  for (const c of P.clips) { const b = c.el.getBoundingClientRect(); x1 = Math.max(x1, b.left); y1 = Math.max(y1, b.top); x2 = Math.min(x2, b.right); y2 = Math.min(y2, b.bottom); }
  return x2 - x1 > 1 && y2 - y1 > 1 ? { x: x1, y: y1, w: x2 - x1, h: y2 - y1 } : null;
}

/** Put the cut-out, the ring and the caption where they belong for the window as it is now. */
function place() {
  if (!P.root) return;
  const vw = innerWidth, vh = innerHeight, narrow = vw <= 640, card = P.card;
  const cw = card.offsetWidth, ch = card.offsetHeight, gap = 14, m = 12, pad = 6;
  let hole = null;
  if (P.phase === 'shown' && P.target && seen(P.target)) {
    const r = showing(P.target);
    if (r) { const x = Math.max(0, r.x - pad), y = Math.max(0, r.y - pad); hole = { x, y, w: Math.min(vw, r.x + r.w + pad) - x, h: Math.min(vh, r.y + r.h + pad) - y }; }
  }
  let placed = 'centre', cx = 0, cy = 0, stay = false;
  if (P.phase === 'ended') placed = 'centre';
  else if (narrow) {
    // A phone: dock to the foot, or to the top when the target can only be seen down there.
    const zone = ch + 8 + gap;
    let dock = 'bottom';
    if (hole) {
      const underFoot = Math.max(0, hole.y + hole.h - (vh - zone)), underTop = Math.max(0, zone - hole.y);
      const want = P.side === 'top' || P.side === 'bottom' ? P.side : 'bottom';
      // Clear of the target if either end is; else the foot, so long as the top of the target still shows above it.
      dock = (want === 'bottom' ? underFoot : underTop) < 1 ? want : underFoot < 1 ? 'bottom' : underTop < 1 ? 'top' : (hole.y < vh - zone - 60 ? 'bottom' : 'top');
      if (dock === 'bottom') hole.h = Math.min(hole.h, vh - zone - hole.y);
      else { const y = Math.max(hole.y, zone); hole.h -= y - hole.y; hole.y = y; }
      if (hole.h < 12) hole = null;
      P.side = dock;
    }
    placed = `dock-${dock}`;
  } else if (hole) {
    const fits = { right: vw - (hole.x + hole.w) >= cw + gap + m, left: hole.x >= cw + gap + m, below: vh - (hole.y + hole.h) >= ch + gap + m, above: hole.y >= ch + gap + m };
    const order = hole.w > vw * 0.5 ? ['below', 'above', 'right', 'left'] : ['right', 'left', 'below', 'above'];
    let side = fits[P.side] ? P.side : order.find((s) => fits[s]);
    if (!side) {
      // Too big to stand beside: light as much of it as leaves room for the caption under or over it.
      const under = vh - m - ch - gap - hole.y, over = hole.y + hole.h - (m + ch + gap);
      if (under >= 110) { hole.h = under; side = 'below'; }
      else if (over >= 110) { hole.h = over; hole.y = m + ch + gap; side = 'above'; }
      else side = 'corner';
    } else P.side = side;
    const clampX = (x) => Math.max(m, Math.min(x, vw - cw - m)), clampY = (y) => Math.max(m, Math.min(y, vh - ch - m));
    if (side === 'right') { cx = hole.x + hole.w + gap; cy = clampY(hole.y); }
    else if (side === 'left') { cx = hole.x - gap - cw; cy = clampY(hole.y); }
    else if (side === 'below') { cx = clampX(hole.x); cy = hole.y + hole.h + gap; }
    else if (side === 'above') { cx = clampX(hole.x); cy = hole.y - gap - ch; }
    else { cx = vw - cw - m; cy = vh - ch - m; }
    placed = 'side';
  } else if (P.phase === 'seeking' && card.dataset.placed === 'side') { placed = 'side'; stay = true; } // looking for the next control: the caption stays put
  // otherwise there is nothing to point at, and the caption sits in the middle

  const round = (n) => Math.round(n);
  const key = `${placed}|${stay ? 'stay' : `${round(cx)}|${round(cy)}`}|${hole ? [hole.x, hole.y, hole.w, hole.h].map(round).join(',') : '-'}|${vw}x${vh}`;
  if (key === P.drawn) return;
  P.drawn = key;
  P.root.dataset.hole = hole ? '1' : '0';
  const box = (el, x, y, w, h) => { el.style.cssText = `left:${round(x)}px;top:${round(y)}px;width:${Math.max(0, round(w))}px;height:${Math.max(0, round(h))}px`; };
  const [b0, b1, b2, b3] = P.blocks;
  if (hole) {
    const hx = round(hole.x), hy = round(hole.y), hw = round(hole.w), hh = round(hole.h);
    box(P.spot, hx, hy, hw, hh);
    box(b0, 0, 0, vw, hy); box(b1, 0, hy + hh, vw, vh - hy - hh); box(b2, 0, hy, hx, hh); box(b3, hx + hw, hy, vw - hx - hw, hh);
  } else { box(b0, 0, 0, vw, vh); box(b1, 0, 0, 0, 0); box(b2, 0, 0, 0, 0); box(b3, 0, 0, 0, 0); }
  card.dataset.placed = placed;
  if (placed !== 'side') { card.style.left = ''; card.style.top = ''; } else if (!stay) { card.style.left = `${round(cx)}px`; card.style.top = `${round(cy)}px`; }
}

/** Keep hold of the target: screens redraw themselves, and a control that was missing may turn up. */
function rebind() {
  const s = P.step; if (!s?.target || P.blocked) return;
  if (P.route && here() !== P.route) { if (P.target) setTarget(null); return; } // the person went somewhere else
  const el = find(s.target);
  if (el) { if (lit(el) !== P.target) setTarget(el, s.target); return; }
  if (P.target && seen(P.target) && P.sel !== s.target) return; // still pointing at a stand-in that is there
  for (const sel of list(s.alt)) { const a = find(sel); if (a) { if (lit(a) !== P.target) setTarget(a, sel); return; } }
  if (P.target) setTarget(null);
}

function tick(t) {
  if (!P.on) return;
  P.raf = requestAnimationFrame(tick);
  try {
    if (!data.ready) { close(); return; } // signed out under us
    const dt = Math.min(100, t - (P.lastT || t)); P.lastT = t;
    if (P.phase === 'shown') {
      if (t - P.lastLook > 250) { P.lastLook = t; rebind(); }
      if (P.mode === 'watch') {
        if (P.playing) P.elapsed += dt;
        const bar = P.card.querySelector('.gd-segs .is-now b');
        if (bar) bar.style.width = `${Math.min(100, (P.elapsed / P.length) * 100).toFixed(1)}%`;
        if (P.playing && P.elapsed >= P.length) { next(false); return; }
      }
    }
    place();
  } catch (e) { console.error(e); }
}

function drawCard() {
  const t = P.tour, s = P.step, n = t.steps.length, watch = P.mode === 'watch';
  const had = P.card.contains(document.activeElement) ? document.activeElement.dataset?.gd : '';
  P.card.innerHTML = `
    <header class="gd-head"><p class="eyebrow gd-tour">${esc(t.title)}</p><button type="button" class="icon-btn gd-x" data-gd="close" aria-label="Close the guide">×</button></header>
    <div class="gd-prog"><span class="gd-count">Step ${P.i + 1} of ${n}</span><div class="gd-segs" aria-hidden="true">${t.steps.map((_, k) => `<i class="${k < P.i ? 'is-past' : k === P.i ? 'is-now' : ''}"><b></b></i>`).join('')}</div></div>
    <div class="gd-say" aria-live="polite">
      <h2 class="gd-title">${esc(s.title)}</h2>
      <p class="gd-text">${esc(s.text)}</p>
      ${s.hint ? `<p class="gd-hint">${esc(s.hint)}</p>` : ''}
      <p class="gd-note" hidden></p>
    </div>
    <footer class="gd-foot">
      ${watch ? `<button type="button" class="icon-btn gd-play" data-gd="toggle" aria-label="${P.playing ? 'Pause' : 'Play'}">${P.playing ? PAUSE : PLAY}</button>` : ''}
      <span class="gd-gap"></span>
      <button type="button" class="btn btn-sm btn-quiet" data-gd="back" ${P.i ? '' : 'disabled'}>Back</button>
      <button type="button" class="btn btn-sm btn-primary" data-gd="next">${P.i === n - 1 ? 'Finish' : 'Next'}</button>
    </footer>`;
  P.card.setAttribute('aria-label', `Guide: ${t.title}`);
  P.root.dataset.mode = P.mode;
  refocus(had);
}
function refocus(had) {
  const again = had && P.card.querySelector(`[data-gd="${had}"]:not([disabled])`);
  (again || P.card).focus({ preventScroll: true });
}
function setPlaying(on) {
  P.playing = !!on && P.mode === 'watch';
  if (P.root) P.root.dataset.playing = P.playing ? '1' : '0';
  const b = P.card?.querySelector('.gd-play');
  if (b) { b.innerHTML = P.playing ? PAUSE : PLAY; b.setAttribute('aria-label', P.playing ? 'Pause' : 'Play'); }
}

async function show(i) {
  const run = ++P.run, s = P.tour.steps[i];
  Object.assign(P, { i, step: s, elapsed: 0, length: Math.max(4000, 1200 + 280 * words(s.text)), blocked: false, missing: false, side: '', drawn: '' });
  const route = routeOf(s);
  P.route = route;
  drawCard();
  let hit = null;
  try {
    if (route && !mayOpen(route)) P.blocked = true;
    else {
      const quick = (!route || here() === route) && s.target ? find(s.target) : null;
      if (quick) hit = { el: quick, sel: s.target };
      else {
        P.phase = 'seeking'; setTarget(null); place();
        const there = !route || await travel(route, run);
        if (run !== P.run) return;
        if (there) hit = await locate(s, run);
        if (run !== P.run) return;
      }
    }
  } catch (e) { console.error(e); hit = null; }
  if (run !== P.run || !P.on) return;
  try {
    const el = hit?.el || null, hadHole = P.root.dataset.hole === '1';
    const dw = document.querySelector('.drawer-wrap');
    if (dw && !(el && dw.contains(el))) shutDrawer();
    minding(el);
    setTarget(el, hit?.sel);
    P.missing = !P.blocked && !!s.target && !el;
    const note = P.card.querySelector('.gd-note');
    if (note && P.blocked) {
      const who = whoOpens(route), shown = who.slice(0, 3).join(', ');
      note.textContent = `This login cannot open ${routeName(route)}.${who.length ? ` It is usually open to ${shown}${who.length > 3 ? ` and ${who.length - 3} more` : ''}.` : ''}`;
      note.hidden = false;
    }
    P.root.dataset.state = P.blocked ? 'blocked' : P.missing ? 'missing' : 'on';
    P.phase = 'shown';
    // The spotlight glides only from one control to the next; anywhere else it simply appears.
    clearTimeout(P.moveT);
    P.root.classList.toggle('is-moving', hadHole && !!el);
    P.moveT = setTimeout(() => P.root?.classList.remove('is-moving'), 460);
    if (P.target) reveal(P.target, innerWidth <= 640 ? P.card.offsetHeight + 26 : 0);
    P.drawn = ''; place();
    if (!P.card.contains(document.activeElement)) refocus('');
  } catch (e) { console.error(e); P.phase = 'shown'; setTarget(null); P.drawn = ''; try { place(); } catch { /* the caption stays where it is */ } }
}

function finish() {
  ++P.run;
  const t = P.tour;
  markDone(t.id);
  if (P.opened) shutDrawer();
  if (P.navOpened) closeNav();
  P.opened = false;
  Object.assign(P, { phase: 'ended', blocked: false, missing: false, drawn: '' });
  setTarget(null); setPlaying(false);
  const done = doneSet();
  const mine = toursFor(P.role), at = mine.findIndex((x) => x.id === t.id);
  const after = [...mine.slice(at + 1), ...mine.slice(0, Math.max(at, 0))].filter((x) => x.id !== t.id && !done.has(x.id)).slice(0, 2);
  const canGuide = guideSeen || !!document.querySelector('.rail a[data-route="guide"]');
  P.card.innerHTML = `
    <header class="gd-head"><p class="eyebrow gd-tour">${esc(t.title)}</p><button type="button" class="icon-btn gd-x" data-gd="close" aria-label="Close the guide">×</button></header>
    <div class="gd-say" aria-live="polite">
      <h2 class="gd-title gd-done"><span class="gd-tick">${TICK}</span>Done</h2>
      <p class="gd-text">${esc(t.outcome)}</p>
    </div>
    ${after.length ? `<div class="gd-nexts"><p class="eyebrow">Next for ${esc(roleById[P.role]?.name || 'you')}</p>${after.map((x) => `<button type="button" class="gd-next" data-gd-tour="${esc(x.id)}"><span class="gd-next-title">${esc(x.title)}</span><span class="gd-next-meta">${x.minutes} min</span>${ARROW}</button>`).join('')}</div>` : ''}
    <footer class="gd-foot"><span class="gd-gap"></span>${canGuide ? '<button type="button" class="btn btn-sm btn-outline" data-gd="guide">Back to the Guide</button>' : ''}<button type="button" class="btn btn-sm btn-primary" data-gd="close">Close</button></footer>`;
  P.root.dataset.state = 'ended';
  P.root.classList.remove('is-moving');
  place();
  P.card.focus({ preventScroll: true });
  window.dispatchEvent(new CustomEvent('deme:guide', { detail: { done: t.id } }));
}

/** Next step. `byHand` is false only when Watch mode moves on by itself. */
async function next(byHand = true) {
  if (!P.on || P.phase === 'ended') return snap();
  if (byHand && P.mode === 'watch') setPlaying(false);
  if (P.i >= P.tour.steps.length - 1) finish(); else await show(P.i + 1);
  return snap();
}
async function back() {
  if (!P.on || P.phase === 'ended') return snap();
  if (P.mode === 'watch') setPlaying(false);
  if (P.i > 0) await show(P.i - 1);
  return snap();
}

function onKey(e) {
  if (!P.on || e.defaultPrevented) return;
  const t = e.target instanceof HTMLElement ? e.target : null;
  const inCard = !!t && P.card.contains(t), onButton = inCard && !!t.closest('button');
  const typing = !inCard && !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
  const take = () => { e.preventDefault(); e.stopPropagation(); };
  if (e.key === 'Escape') {
    const pop = document.getElementById('pop');
    if (pop && !pop.hidden) return; // an information note is open: let it close first
    take();
    if (P.mode === 'watch' && P.playing && P.phase !== 'ended') setPlaying(false); else close();
    return;
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === 'Tab') {
    // Keep the keyboard on the caption while the rest of the screen is behind the dim layer.
    const stops = $$('button:not([disabled])', P.card); if (!stops.length) return;
    const at = stops.indexOf(document.activeElement);
    take(); stops[at < 0 ? (e.shiftKey ? stops.length - 1 : 0) : (at + (e.shiftKey ? -1 : 1) + stops.length) % stops.length].focus();
    return;
  }
  if (typing || P.phase === 'ended') return;
  if (e.key === 'ArrowRight' || (e.key === 'Enter' && !onButton)) { take(); next(true); }
  else if (e.key === 'ArrowLeft') { take(); back(); }
  else if (e.key === ' ' && P.mode === 'watch' && !onButton) { take(); setPlaying(!P.playing); }
}
function onClick(e) {
  const b = e.target.closest('[data-gd], [data-gd-tour]'); if (!b) return;
  if (b.dataset.gdTour) { startTour(b.dataset.gdTour, P.mode, P.ctx, { role: P.role }); return; }
  const what = b.dataset.gd;
  if (what === 'close') close();
  else if (what === 'next') next(true);
  else if (what === 'back') back();
  else if (what === 'toggle') setPlaying(!P.playing);
  else if (what === 'guide') { const go = P.ctx?.go || ((r) => { location.hash = r; }); close(); if (here() !== 'guide') go('guide'); }
}
const onMove = () => { try { place(); } catch { /* next frame will try again */ } };

function build() {
  const root = document.createElement('div');
  root.className = 'gd-player'; root.dataset.hole = '0'; root.dataset.mode = P.mode; root.dataset.playing = P.playing ? '1' : '0';
  root.innerHTML = '<div class="gd-veil"></div><div class="gd-block"></div><div class="gd-block"></div><div class="gd-block"></div><div class="gd-block"></div><div class="gd-spot" aria-hidden="true"></div><section class="gd-card" role="dialog" aria-label="Guide" tabindex="-1" data-placed="centre"></section>';
  document.body.appendChild(root);
  Object.assign(P, { root, card: root.querySelector('.gd-card'), spot: root.querySelector('.gd-spot'), blocks: $$('.gd-block', root) });
  P.card.addEventListener('click', onClick);
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', onMove);
  window.addEventListener('scroll', onMove, true);
}

/** Stop the tour and take everything of it off the page. Safe to call at any time. */
export function close() {
  if (!P.on && !P.root) return;
  ++P.run; P.on = false;
  cancelAnimationFrame(P.raf); clearTimeout(P.moveT);
  window.removeEventListener('keydown', onKey, true);
  window.removeEventListener('resize', onMove);
  window.removeEventListener('scroll', onMove, true);
  try { if (P.opened) shutDrawer(); if (P.navOpened) closeNav(); } catch (e) { console.error(e); }
  P.card?.removeEventListener('click', onClick);
  P.root?.remove();
  document.querySelectorAll('.gd-player').forEach((el) => el.remove());
  const back = P.focusBack;
  Object.assign(P, { tour: null, step: null, root: null, card: null, spot: null, blocks: [], phase: 'idle', target: null, clips: [], sel: '', route: '', blocked: false, missing: false, playing: false, opened: false, navOpened: false, focusBack: null, drawn: '', side: '', lastT: 0 });
  try { (back && back.isConnected ? back : document.getElementById('view'))?.focus({ preventScroll: true }); } catch { /* nothing to return to */ }
  window.dispatchEvent(new CustomEvent('deme:guide', { detail: { closed: true } }));
}

/**
 * Start a tour from any screen. `mode` is 'watch' (plays by itself) or 'step' (waits for Next).
 * `ctx` is the router's ctx (needs go). Resolves true once the first step is on screen.
 */
export async function startTour(id, mode = 'step', ctx = null, opts = {}) {
  const tour = tourById[id];
  if (!tour) { toast('That tour is not in the guide.', 'crit'); return false; }
  if (!data.ready) return false;
  try {
    if (P.on || P.root) { const keep = P.focusBack; close(); P.focusBack = keep; }
    ensureCss();
    const watch = mode === 'watch';
    Object.assign(P, {
      on: true, tour, mode: watch ? 'watch' : 'step', playing: watch, i: 0, phase: 'seeking', lastT: 0, lastLook: 0, opened: false, navOpened: false,
      ctx: ctx?.go ? ctx : lastCtx, focusBack: P.focusBack || document.activeElement,
      role: opts.role && roleById[opts.role] ? opts.role : (tour.roles.includes(recall().role) ? recall().role : tour.roles.includes(matchRole()) ? matchRole() : tour.roles[0]),
    });
    build();
    P.raf = requestAnimationFrame(tick);
    await show(0);
    return P.on;
  } catch (e) { console.error(e); close(); return false; }
}

function snap() {
  return { active: P.on, id: P.tour?.id || null, mode: P.mode, index: P.i, total: P.tour?.steps.length || 0, phase: P.phase, playing: P.playing, route: P.route, blocked: P.blocked, missing: P.missing, target: P.sel, placed: P.card?.dataset.placed || '', role: P.role, done: [...(data.user ? doneSet() : [])] };
}
// For tests and the console. `state` reads as an object and can also be called.
window.__demeGuide = { start: startTour, next: () => next(true), back, close, get state() { return Object.assign(() => snap(), snap()); } };

// ═════════ The Guide screen ═════════
const ABOUT = 'Pick a role to see what that person does in Deme. Watch plays a tour by itself, like a video, and can be paused. Step through waits for you to press Next. Either way the tour opens the real screens and points at the real controls. It does not add or change any record. Right arrow or Enter is next, Left arrow is back, Escape closes. Finished tours are ticked on this device only.';
const ABOUT_START = 'The steps that bring an empty system up to date: logins for the team, the lists you already keep in spreadsheets, the reference lists, opening stock and the go-live plan. Each role sees the parts it owns.';
const ABOUT_DAY = 'What this role does on a normal day, one short tour per job. A greyed part of a strip is a screen this login cannot open; the tour says so when it gets there and carries on.';
// Each role wears one of the shared gradients.
const TONE = { founder: '--g-services', ops: '--g-ontology', prod_manager: '--g-foundation', prod_b2b: '--g-contact', merch: '--g-engagement', stores: '--g-industries', qc: '--g-trust', dispatch: '--g-application', logistics: '--g-ai', finance: '--g-about', hr: '--g-people', tailor: '--g-foundation', everyone: '--g-contact' };

/** A tour's steps grouped by the screen they are on, in order. */
function legsOf(t) {
  const legs = [];
  for (const s of t.steps) {
    const route = routeOf(s), last = legs[legs.length - 1];
    if (last && last.route === route) last.n += 1; else legs.push({ route, name: routeName(route), n: 1, shut: !mayOpen(route) });
  }
  return legs;
}

export function mount(el, ctx) {
  lastCtx = ctx; guideSeen = true;
  ensureCss();
  const saved = recall().role;
  const own = matchRole();
  let role = roleById[saved] ? saved : own;

  el.innerHTML = `<div class="workspace guide"><div class="workspace-inner">
    <div class="view-head"><div class="title-row"><h1 class="reveal">Guide</h1>${info(ABOUT, 'Guide')}</div><div class="gu-count" id="guCount"></div></div>
    <div class="gu-roles" id="guRoles" role="group" aria-label="Role"></div>
    <div class="gu-body" id="guBody"></div>
  </div></div>`;
  const rolesEl = $('#guRoles', el), body = $('#guBody', el), countEl = $('#guCount', el);

  function drawRoles() {
    const done = doneSet();
    rolesEl.innerHTML = GUIDE_ROLES.map((r) => {
      const mine = toursFor(r.id), n = mine.filter((t) => done.has(t.id)).length;
      return `<button type="button" class="gu-role" data-role="${esc(r.id)}" aria-pressed="${r.id === role}" style="--gi:var(${TONE[r.id] || '--g'})">
        <span class="gu-role-head"><span class="gu-role-name">${esc(r.name)}${r.also ? ` <span class="gu-role-also">${esc(r.also)}</span>` : ''}</span>${r.id === own ? '<span class="gu-you">Your login</span>' : ''}</span>
        <span class="gu-role-line">${esc(r.line)}</span>
        <span class="gu-role-foot"><span class="gu-pips" aria-hidden="true">${mine.map((t) => `<i class="${done.has(t.id) ? 'is-done' : ''}"></i>`).join('')}</span><span class="gu-role-n">${n} of ${mine.length}</span></span>
      </button>`;
    }).join('');
  }
  function card(t, n, of) {
    const done = doneSet().has(t.id), legs = legsOf(t);
    return `<article class="panel gu-tour${done ? ' is-done' : ''}" data-tour="${esc(t.id)}">
      <header class="gu-tour-head"><div>${n ? `<p class="eyebrow">Part ${n} of ${of}</p>` : ''}<h3>${esc(t.title)}</h3></div>${done ? `<span class="gu-tick" role="img" aria-label="Done">${TICK}</span>` : ''}</header>
      <p class="gu-out">${esc(t.outcome)}</p>
      <div class="gu-strip" role="img" aria-label="${esc(`${plural(t.steps.length, 'step')}: ${legs.map((l) => `${l.name} ${l.n}`).join(', ')}`)}">${legs.map((l) => `<div class="gu-leg${l.shut ? ' is-shut' : ''}" style="--n:${l.n}"><div class="gu-dots">${'<i></i>'.repeat(l.n)}</div><span class="gu-leg-name">${esc(l.name)}</span></div>`).join('')}</div>
      <footer class="gu-tour-foot"><span class="gu-meta">${t.minutes} min · ${plural(t.steps.length, 'step')}</span><span class="gu-btns"><button type="button" class="btn btn-sm btn-primary" data-play="watch" aria-label="Watch: ${esc(t.title)}">${PLAY}Watch</button><button type="button" class="btn btn-sm btn-outline" data-play="step" aria-label="Step through: ${esc(t.title)}">Step through</button></span></footer>
    </article>`;
  }
  function drawBody() {
    const mine = toursFor(role), done = doneSet();
    const start = mine.filter((t) => t.group === 'start'), day = mine.filter((t) => t.group !== 'start');
    const n = mine.filter((t) => done.has(t.id)).length;
    countEl.innerHTML = `<span class="gu-count-n">${n} of ${mine.length} done</span><span class="bar"><i style="--v:${mine.length ? Math.round((n / mine.length) * 100) : 0}%"></i></span>`;
    const sec = (title, about, tours, numbered) => (tours.length ? `<section class="gu-sec"><div class="title-row"><h2>${title}</h2>${info(about, title)}</div><div class="gu-tours">${tours.map((t, i) => card(t, numbered ? i + 1 : 0, tours.length)).join('')}</div></section>` : '');
    body.innerHTML = sec('Start here', ABOUT_START, start, start.length > 1) + sec('Day to day', ABOUT_DAY, day, false);
  }
  const draw = () => { drawRoles(); drawBody(); };

  // Listen on this screen's own root, which goes when the screen goes; `el` outlives it.
  el.firstElementChild.addEventListener('click', (e) => {
    const r = e.target.closest('[data-role]'), play = e.target.closest('[data-play]');
    if (r) {
      role = r.dataset.role; remember({ role });
      $$('[data-role]', rolesEl).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.role === role)));
      drawBody();
    } else if (play) startTour(play.closest('[data-tour]').dataset.tour, play.dataset.play, ctx, { role });
  });
  const onGuide = (e) => { if (e.detail?.done) draw(); };
  window.addEventListener('deme:guide', onGuide);
  const off = data.on(draw); // a new login or a changed role changes what opens

  draw();
  // On a phone the roles are one row that scrolls sideways: bring the picked one into it.
  const picked = $('[aria-pressed="true"]', rolesEl);
  if (picked && rolesEl.scrollWidth > rolesEl.clientWidth + 1) rolesEl.scrollLeft = picked.offsetLeft - rolesEl.offsetLeft - (rolesEl.clientWidth - picked.offsetWidth) / 2;
  return () => { window.removeEventListener('deme:guide', onGuide); off(); };
}
