// App shell: hash routing between the four views, and the light/dark switch.
// Each view module exports `mount(el, ctx)` and returns a cleanup function.

import { store } from './store.js';

const VIEWS = {
  map: () => import('./map.js'),
  room: () => import('./room.js'),
  erp: () => import('./erp.js'),
  systems: () => import('./systems.js'),
};
const viewEl = document.getElementById('view');
let cleanup = null;
let current = null;
let pending = {}; // options handed from one view to the next, e.g. { focus: 'lineb2b' }

const ctx = {
  store,
  /** Switch view. `opts` reach the next view's mount as ctx.opts. */
  go(view, opts = {}) {
    pending = opts;
    if (location.hash.slice(1) === view) render(); else location.hash = view;
  },
};

async function render() {
  const name = VIEWS[location.hash.slice(1)] ? location.hash.slice(1) : 'map';
  const opts = pending; pending = {};
  if (cleanup) { try { cleanup(); } catch (e) { console.error(e); } cleanup = null; }
  current = name;
  document.querySelectorAll('.nav a').forEach((a) => {
    if (a.dataset.view === name) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  viewEl.innerHTML = '';
  viewEl.dataset.view = name;
  try {
    const mod = await VIEWS[name]();
    if (current !== name) return; // navigated away while loading
    cleanup = mod.mount(viewEl, { ...ctx, opts }) || null;
  } catch (e) {
    console.error(e);
    viewEl.innerHTML = `<div class="workspace"><div class="empty">This view could not load: ${String(e.message || e)}</div></div>`;
  }
}

// Theme: follow the system unless the person picks one; remember the pick on this device.
const root = document.documentElement;
try { const t = localStorage.getItem('dema-theme'); if (t) root.dataset.theme = t; } catch { /* no storage */ }
document.getElementById('themeToggle').addEventListener('click', () => {
  const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  root.dataset.theme = dark ? 'light' : 'dark';
  try { localStorage.setItem('dema-theme', root.dataset.theme); } catch { /* no storage */ }
});
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => window.dispatchEvent(new Event('themechange')));
new MutationObserver(() => window.dispatchEvent(new Event('themechange'))).observe(root, { attributes: true, attributeFilter: ['data-theme'] });

window.addEventListener('hashchange', render);
render();
