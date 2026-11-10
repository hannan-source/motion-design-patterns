// Small shared helpers: dates on a Mon–Sat factory calendar, Indian-format money, safe HTML.

export const DAY = 86400000;

export function today() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
export const isWorkday = (d) => d.getDay() !== 0; // the factory runs Monday to Saturday

/** Date that is `n` working days after `from` (n = 0 returns the next working day on or after `from`). */
export function addWorkdays(from, n) {
  const d = new Date(from);
  while (!isWorkday(d)) d.setDate(d.getDate() + 1);
  let left = n;
  while (left > 0) {
    d.setDate(d.getDate() + 1);
    if (isWorkday(d)) left--;
  }
  return d;
}
/** Working-day index of `date` counted from `from` (0 = `from` itself, negative if earlier). */
export function workdayIndex(from, date) {
  const a = new Date(from), b = new Date(date);
  a.setHours(0, 0, 0, 0); b.setHours(0, 0, 0, 0);
  if (b < a) return -workdayIndex(b, a);
  let n = 0;
  const d = new Date(a);
  while (d < b) {
    d.setDate(d.getDate() + 1);
    if (isWorkday(d)) n++;
  }
  return n;
}
export const iso = (d) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const fmtDate = (d) => { const x = new Date(d); return `${x.getDate()} ${MONTHS[x.getMonth()]}`; };
export const fmtDay = (d) => { const x = new Date(d); return `${DOW[x.getDay()]} ${x.getDate()} ${MONTHS[x.getMonth()]}`; };
export const fmtTime = (d) => { const x = new Date(d); return `${String(x.getHours()).padStart(2, '0')}:${String(x.getMinutes()).padStart(2, '0')}`; };
export const fmtStamp = (d) => `${fmtDate(d)}, ${fmtTime(d)}`;

/** Rupees in the Indian system: ₹8,400 · ₹4.2 L (lakh) · ₹2.1 Cr (crore). */
export function inr(n) {
  const sign = n < 0 ? '−' : '';
  const a = Math.abs(n);
  if (a >= 1e7) return `${sign}₹${trim(a / 1e7)} Cr`;
  if (a >= 1e5) return `${sign}₹${trim(a / 1e5)} L`;
  return `${sign}₹${Math.round(a).toLocaleString('en-IN')}`;
}
const trim = (x) => (x >= 100 ? x.toFixed(0) : x >= 10 ? x.toFixed(1) : x.toFixed(2)).replace(/\.?0+$/, '');
export const inrFull = (n) => `₹${Math.round(n).toLocaleString('en-IN')}`;
export const num = (n, dp = 0) => Number(n).toLocaleString('en-IN', { maximumFractionDigits: dp, minimumFractionDigits: 0 });
export const pct = (x) => `${Math.round(x * 100)}%`;

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Deterministic PRNG so the example data is the same on every load. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const sum = (arr, f = (x) => x) => arr.reduce((s, x) => s + f(x), 0);
export const by = (arr, key) => Object.fromEntries(arr.map((x) => [x[key], x]));

export function toast(msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
  el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { el.hidden = true; }, 2600);
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

export const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
