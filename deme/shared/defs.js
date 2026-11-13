// Small helpers for writing list definitions, shared by schema.js and the packs.

/** Statuses: S(['open', 'Open', 'warn'], ...) → { open: { name: 'Open', tone: 'warn' } }. Tones: plain, info, ok, warn, crit. */
export const S = (...pairs) => Object.fromEntries(pairs.map(([id, name, tone = 'plain']) => [id, { name, tone }]));
/** Choices for a select: opt('A', ['b', 'B']) → [['A', 'A'], ['b', 'B']]. */
export const opt = (...v) => v.map((x) => (Array.isArray(x) ? x : [x, x]));
