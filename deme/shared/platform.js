// The platform under every business: a workspace is one business, a template is a starting
// point for one, and the lists a workspace has are worked out here from what it has switched on
// plus the lists it has defined for itself.
//
// Nothing below names a particular customer. "Made-to-order apparel" is the template the first
// customer runs on; a food maker or a service firm picks another and gets a different system
// from the same code.

import { ENTITIES, MODULES, entityById } from './schema.js';
import { DEFAULT_CENTRES } from './org.js';

// The built-in lists and areas as they were written. Copied once, so they stay whole whatever a browser does to the shared ones.
const BASE_ENTITIES = Object.freeze([...ENTITIES]), BASE_MODULES = Object.freeze({ ...MODULES });

export const PLATFORM = 'Hyper Lychee Labs ERP';
export const PLATFORM_SHORT = 'Lychee';

// Field types a business may use on a list it defines itself.
export const FIELD_TYPES = [['text', 'Text'], ['long', 'Long text'], ['number', 'Number'], ['money', 'Money'], ['date', 'Date'], ['bool', 'Yes or no'], ['select', 'One of a set'], ['user', 'A team member'], ['ref', 'A record from another list']];
const TYPE_IDS = new Set(FIELD_TYPES.map((t) => t[0]));
export const LISTS_MODULE = 'lists';

const CORE = ['masters', 'hr', 'projects', 'admin'];
const centres = (...keys) => DEFAULT_CENTRES.filter((c) => keys.includes(c[0]));

/**
 * Templates. `modules` are the areas switched on; `packs` are trade-specific sets of lists inside
 * those areas; `terms` are the words this kind of business uses for the same thing; `centres` is
 * the starting organisation as [key, name, what it does, [workstation, stage?, line?]...].
 */
export const TEMPLATES = [
  {
    id: 'apparel', name: 'Made-to-order apparel', line: 'Fabric, dyeing, cutting, stitching, QC and dispatch, for online and wholesale orders.',
    modules: Object.keys(BASE_MODULES), packs: ['apparel'], terms: {}, centres: DEFAULT_CENTRES, golive: true,
  },
  {
    id: 'food', name: 'Food and packaged goods', line: 'Ingredients in, batches made, packed goods out: chocolate, snack bars, bakery.',
    modules: [...CORE, 'crm', 'purchasing', 'inventory', 'b2b', 'logistics', 'marketing'], packs: [],
    terms: { styles: ['Products', 'Product'], items: ['Ingredients and packaging', 'Material'] },
    centres: [
      ['management', 'Management', 'Direction, approvals and the system itself.', []],
      ['production', 'Production', 'From weighed ingredients to finished, packed goods.', [['Weighing and prep'], ['Mixing and cooking'], ['Moulding or baking'], ['Cooling'], ['Packing'], ['Quality check']]],
      ['stores', 'Stores', 'Ingredients and packaging in, finished goods out.', [['Goods inward'], ['Dry store'], ['Cold store'], ['Finished goods']]],
      ['dispatch', 'Sales and dispatch', 'Orders, deliveries and returns.', [['Order desk'], ['Dispatch bay']]],
      ...centres('finance', 'people', 'marketing'),
    ],
  },
  {
    id: 'general', name: 'Any other business', line: 'People, work centres, projects and your own lists. Add what the business needs as it goes.',
    modules: [...CORE, 'crm', 'b2b', 'marketing'], packs: [],
    terms: { styles: ['Products and services', 'Product or service'], items: ['Materials', 'Material'] },
    centres: [
      ['management', 'Management', 'Direction, approvals and the system itself.', []],
      ['operations', 'Operations', 'Where the work of the business is done.', [['Main desk']]],
      ['dispatch', 'Sales', 'Customers, orders and delivery.', [['Order desk']]],
      ...centres('finance', 'people', 'marketing'),
    ],
  },
];
export const templateById = Object.fromEntries(TEMPLATES.map((t) => [t.id, t]));

/** The settings a new workspace starts with, from its template. */
export function settingsFrom(templateId, name) {
  const t = templateById[templateId] || templateById.apparel;
  return { name: String(name || '').trim() || 'My business', template: t.id, modules: [...t.modules], packs: [...t.packs], terms: structuredClone(t.terms), ai: { provider: 'platform' } };
}

const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30);

/** Check a list a business has defined, and return it in the shape it is stored. Throws a plain message. */
export function cleanType(input, existing = []) {
  const name = String(input.name || '').trim(), one = String(input.one || '').trim() || name.replace(/s$/, '');
  if (name.length < 2 || name.length > 40) throw new Error('Give the list a name of 2 to 40 characters.');
  const key = input.key || slug(name);
  if (!key) throw new Error('Give the list a name with letters in it.');
  if (existing.some((t) => t.key === key && t.id !== input.id)) throw new Error(`There is already a list called ${name}.`);
  if (BASE_ENTITIES.some((e) => e.id === key || e.id === `x_${key}`)) throw new Error(`"${name}" is the name of a built-in list. Choose another name.`);
  const fields = (Array.isArray(input.fields) ? input.fields : []).map((f, i) => {
    const label = String(f.label || '').trim(); if (!label) throw new Error(`Field ${i + 1} needs a name.`);
    if (label.length > 40) throw new Error(`"${label.slice(0, 20)}…" is too long for a field name.`);
    if (!TYPE_IDS.has(f.type)) throw new Error(`Choose what kind of field "${label}" is.`);
    const out = { k: f.k || slug(label) || `field_${i + 1}`, label, type: f.type, req: !!f.req, list: f.list !== false };
    if (f.type === 'select') { out.options = [...new Set((Array.isArray(f.options) ? f.options : String(f.options || '').split(',')).map((o) => String(o).trim()).filter(Boolean))].slice(0, 30); if (out.options.length < 2) throw new Error(`"${label}" needs at least two choices.`); }
    if (f.type === 'ref') { if (!f.ref) throw new Error(`Choose which list "${label}" points at.`); out.ref = f.ref; }
    return out;
  });
  if (!fields.length) throw new Error('Add at least one field.');
  if (fields.length > 30) throw new Error('A list can have up to 30 fields.');
  if (new Set(fields.map((f) => f.k)).size !== fields.length) throw new Error('Two fields have the same name.');
  if (!['text', 'number'].includes(fields[0].type)) throw new Error('Make the first field a text or a number: it is what each record is known by.');
  fields[0].req = true;
  const statuses = (Array.isArray(input.statuses) ? input.statuses : []).map((s) => String(s.name ?? s).trim()).filter(Boolean).slice(0, 8);
  const writers = input.writers === 'admins' ? 'admins' : 'all';
  return { key, name, one, about: String(input.about || '').trim().slice(0, 300), fields, statuses, writers, centre: input.centre || '' };
}

/** A list a business defined, as a record type the rest of the system understands. */
function entityFrom(t) {
  const tones = ['plain', 'info', 'info', 'info', 'info', 'info', 'info', 'ok'];
  return {
    id: `x_${t.key}`, module: LISTS_MODULE, name: t.name, one: t.one, title: t.fields[0].k, custom: true, writers: t.writers, centre: t.centre || '',
    info: t.about || `A list this business set up for itself. Change its fields under Build.`,
    ...(t.statuses?.length ? { statuses: Object.fromEntries(t.statuses.map((name, i) => [slug(name) || `s${i}`, { name, tone: i === t.statuses.length - 1 ? 'ok' : tones[i] || 'info' }])), initial: slug(t.statuses[0]) || 's0', editWhen: t.statuses.map((name, i) => slug(name) || `s${i}`) } : {}),
    fields: t.fields.map((f) => [f.k, f.label, f.type, { ...(f.req ? { req: true } : {}), ...(f.list ? { list: true } : {}), ...(f.options ? { options: f.options.map((o) => [o, o]) } : {}), ...(f.ref ? { ref: f.ref } : {}) }]),
    ...(t.statuses?.length ? { actions: [{ id: 'list.next', label: 'Move forward', when: t.statuses.slice(0, -1).map((name, i) => slug(name) || `s${i}`) }, { id: 'list.back', label: 'Move back', when: t.statuses.slice(1).map((name, i) => slug(name) || `s${i + 1}`) }] } : {}),
  };
}

/**
 * The lists and areas one workspace has: built-in ones for the areas and packs it has switched on,
 * in its own words, plus the lists it defined itself. With no settings, everything (as in tests).
 * Returns fresh objects every time; the built-in definitions are never changed.
 */
export function schemaFor(settings = null, types = []) {
  const mods = settings?.modules ? new Set([...settings.modules, 'admin']) : null, packs = new Set(settings?.packs || (settings ? [] : ['apparel']));
  const terms = settings?.terms || {};
  const ENTITIES = BASE_ENTITIES.filter((e) => (!mods || mods.has(e.module)) && (!e.pack || packs.has(e.pack))).map((e) => {
    const fields = e.fields.filter((f) => !f[3]?.pack || packs.has(f[3].pack));
    const t = terms[e.id];
    return fields.length === e.fields.length && !t ? e : { ...e, fields, ...(t ? { name: t[0], one: t[1] } : {}) };
  });
  const MODULES = Object.fromEntries(Object.entries(BASE_MODULES).filter(([m]) => !mods || mods.has(m)));
  const own = (types || []).map(entityFrom);
  if (own.length || settings) MODULES[LISTS_MODULE] = { name: 'Lists', info: 'Lists this business set up for itself: anything it needs to keep track of that the built-in areas do not cover. Add or change them under Build.' };
  ENTITIES.push(...own);
  return { ENTITIES, MODULES, byId: Object.fromEntries(ENTITIES.map((e) => [e.id, e])), mods, packs };
}

/**
 * One workspace's view of a database. Every collection and counter is kept under the workspace's
 * own name and its log lines are tagged, so code written against this view cannot read or write
 * another business's data, whatever it asks for.
 */
export function scopeDb(db, ws) {
  if (!ws || /[^a-z0-9_]/i.test(ws)) throw new Error('Bad workspace.');
  const p = (c) => `${ws}/${c}`;
  return {
    ws,
    all: (c) => db.all(p(c)), get: (c, id) => db.get(p(c), id), put: (c, d) => db.put(p(c), d), del: (c, id) => db.del(p(c), id),
    next: (n) => db.next(p(n)),
    log: (e) => db.log({ ...e, ws }), logs: (f = {}) => db.logs({ ...f, ws }), logsAfter: (seq, limit) => db.logsAfter(seq, limit, ws),
    tx: (fn) => db.tx(fn),
  };
}

/**
 * Browser only. Make the lists and areas every screen imports those of the signed-in workspace:
 * what its template switched on, in its words, plus the lists it set up itself. A browser holds
 * one workspace at a time, so the shared objects are changed in place. The server never calls this.
 */
export function applySchema(S) {
  ENTITIES.length = 0; ENTITIES.push(...S.ENTITIES);
  for (const k of Object.keys(entityById)) delete entityById[k];
  Object.assign(entityById, S.byId);
  for (const k of Object.keys(MODULES)) delete MODULES[k];
  Object.assign(MODULES, S.MODULES);
}
