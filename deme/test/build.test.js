// What the Build screen reads from the platform: every built-in area and list as it was written,
// the trade packs, and the positions a business can offer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { builtInAreas, builtInPacks, builtInLists, positionsFor, schemaFor, applySchema, templateById, settingsFrom } from '../shared/platform.js';
import { MODULES, ENTITIES } from '../shared/schema.js';
import { POSITIONS } from '../shared/org.js';

test('areas: every built-in area with the lists it brings, core ones marked', () => {
  const areas = builtInAreas(), by = Object.fromEntries(areas.map((a) => [a.id, a]));
  assert.deepEqual(areas.map((a) => a.id), Object.keys(schemaFor().MODULES));
  assert.deepEqual(areas.filter((a) => a.core).map((a) => a.id).sort(), ['admin', 'hr', 'masters', 'projects']);
  assert.ok(by.masters.lists.includes('Customers') && by.projects.lists.includes('Tasks'));
  for (const a of areas) assert.ok(a.name && a.info && Array.isArray(a.lists), a.id);
  // a list that belongs to a trade pack is reported by the pack, not by its area
  const apparel = builtInPacks().find((p) => p.id === 'apparel');
  assert.ok(apparel && apparel.lists.includes('Fabric rolls') && apparel.areas.includes('inventory') && apparel.fields > 0);
  assert.ok(!by.inventory.lists.includes('Fabric rolls'));
});

test('areas and lists stay as written, whatever a browser has switched on or renamed', () => {
  const before = { areas: builtInAreas(), lists: builtInLists() };
  const keep = { M: { ...MODULES }, E: [...ENTITIES] };
  try {
    // what a browser does on sign-in: a business with few areas, its own words and a list of its own
    const s = { ...settingsFrom('general', 'Studio'), terms: { styles: ['Services', 'Service'] } };
    applySchema(schemaFor(s, [{ key: 'visits', name: 'Visits', one: 'Visit', fields: [{ k: 'who', label: 'Who', type: 'text', req: true, list: true }], statuses: [], writers: 'all' }]));
    assert.ok(!MODULES.inventory && MODULES.lists);
    assert.deepEqual(builtInAreas(), before.areas);
    assert.deepEqual(builtInLists(), before.lists);
    const styles = builtInLists().find((l) => l.id === 'styles');
    assert.deepEqual([styles.name, styles.one, styles.area], ['Styles', 'Style', 'masters']);
    assert.ok(!builtInLists().some((l) => l.id.startsWith('x_')) && !builtInAreas().some((a) => a.id === 'lists'));
  } finally {
    applySchema({ ENTITIES: keep.E, MODULES: keep.M, byId: Object.fromEntries(keep.E.map((e) => [e.id, e])) });
  }
});

test('positions: only those whose work centre the business has, plus the general ones', () => {
  const centres = (tpl) => templateById[tpl].centres.map(([key, name], i) => ({ id: `c${i}`, key, name }));
  const general = positionsFor(centres('general')).map((p) => p.id);
  assert.ok(general.includes('staff') && general.includes('setup') && general.includes('finance') && general.includes('sales'));
  assert.ok(!general.includes('masters') && !general.includes('merch') && !general.includes('design') && !general.includes('stores'));
  assert.deepEqual(positionsFor(centres('apparel')).map((p) => p.id), POSITIONS.map((p) => p.id));
  // a work centre the business added itself has no key and brings no positions; with none at all only the general ones are left
  assert.deepEqual(positionsFor([{ id: 'x', name: 'Workshop' }]).map((p) => p.id), ['staff']);
  assert.deepEqual(positionsFor(null).map((p) => p.id), ['staff']);
});
