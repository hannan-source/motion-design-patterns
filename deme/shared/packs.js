// Packs: self-contained parts of the platform. Each pack owns its lists, its steps and its rules,
// and meets the rest only through records, steps and the change feed. Nothing in a pack calls
// another pack's code, so one can be changed, replaced or lifted out to run on its own.
//
// The contract a pack file keeps:
//   X_ENTITIES  list definitions, in the same shape as schema.js
//   X_ACTIONS   { 'pack.step': { module, level, run(ctx, payload, doc, e) } }; `level: 'self'` is open to any signed-in person
//   X_RULES     optional: (h) => ({ <list id>: { read(user, doc), write(user, doc), why } })
//               h = { db, can(user, module, level), centres(), isHead, headOf, isAdmin(user) }
// A pack file must not import schema.js, service.js, platform.js or actions.js (they import the
// packs). It may import defs.js, util.js and org.js.
//
// Steps named 'hook.created.<list>' and 'hook.updated.<list>' run when a record of that list is
// added or changed through the list API. 'hook.changes' (one pack only: workflows) runs once at
// the end of every request with every record that request wrote: [{ entity, id, before, after }].

import { CHAT_ENTITIES, CHAT_ACTIONS, CHAT_RULES } from './chat.js';
import { FLOW_ENTITIES, FLOW_ACTIONS } from './flows.js';
import { PEOPLE_ENTITIES, PEOPLE_ACTIONS, PEOPLE_RULES } from './people.js';
import { CRM_ENTITIES, CRM_ACTIONS } from './crm.js';

export const PACK_ENTITIES = [...CHAT_ENTITIES, ...PEOPLE_ENTITIES, ...CRM_ENTITIES, ...FLOW_ENTITIES];
export const PACK_ACTIONS = { ...CHAT_ACTIONS, ...PEOPLE_ACTIONS, ...CRM_ACTIONS, ...FLOW_ACTIONS };
export const PACK_RULES = [CHAT_RULES, PEOPLE_RULES].filter(Boolean);
