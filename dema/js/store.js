// One shared state object for every view, kept in this browser so edits survive a reload.
// In production this file is replaced by API calls; the views only ever use get/update/on.

import { seed, SEED_VERSION } from './seed.js';

const KEY = 'dema-intel-state';
const listeners = new Set();
let state = load();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw);
      if (s && s.v === SEED_VERSION) return s;
    }
  } catch { /* storage can be unavailable; fall through to example data */ }
  return seed();
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* fine without it */ }
}

export const store = {
  get: () => state,
  /** Mutate state inside `fn`, then persist and notify. `topic` lets views skip irrelevant updates. */
  update(fn, topic = 'data') {
    fn(state);
    save();
    listeners.forEach((l) => l(state, topic));
  },
  on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  reset() {
    state = seed();
    save();
    listeners.forEach((l) => l(state, 'reset'));
  },
  nextId(counter, prefix, pad = 4) {
    const n = state.counters[counter]++;
    return `${prefix}-${String(n).padStart(pad, '0')}`;
  },
};
