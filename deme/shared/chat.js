// Chat pack: people talk where they work. One channel for everyone, one for each work centre,
// one for each workstation, groups people make themselves, and one to one.
// See packs.js for the contract this file keeps.
//
// Who is in a channel is worked out, never stored, for the standing ones: move a person to
// another work centre and they are in its channel. Groups and direct conversations keep a list.
// Nothing is written to these lists except through the steps below, and every step checks that
// the person is in the channel first.

import { opt } from './defs.js';
import { headOf } from './org.js';

const CH = 'chat_channels', MSG = 'chat_messages', READ = 'chat_reads';
const TEXT_MAX = 4000, GROUP_MAX = 200;
const short = (s, n = 80) => { const t = String(s).replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const idList = (v) => [...new Set((Array.isArray(v) ? v : v ? [v] : []).map((x) => String(x)).filter(Boolean))];

export const CHAT_ENTITIES = [
  { id: CH, module: 'projects', name: 'Chat channels', one: 'Channel', title: 'name', readonly: true,
    info: 'Where people talk. There is one channel for everyone, one for each work centre and one for each workstation, and people add groups and one to one conversations of their own. A person sees a channel only if they are in it.',
    fields: [['name', 'Name', 'text', { list: true }], ['kind', 'Kind', 'select', { list: true, options: opt(['everyone', 'Everyone'], ['centre', 'Work centre'], ['station', 'Workstation'], ['group', 'Group'], ['direct', 'Direct']) }],
      ['centre', 'Work centre', 'text', { ro: true }], ['station', 'Workstation', 'text', { ro: true }], ['members', 'People', 'text', { ro: true }], ['about', 'About', 'text', {}],
      ['lastAt', 'Last message', 'datetime', { ro: true, list: true }], ['lastText', 'Preview', 'text', { ro: true }], ['archived', 'Archived', 'bool', { ro: true }]] },
  { id: MSG, module: 'projects', name: 'Chat messages', one: 'Message', title: 'text', readonly: true,
    info: 'What was said in a channel, oldest first. A reply sits under the message it answers. A deleted message keeps its place with its words removed.',
    fields: [['channel', 'Channel', 'ref', { ref: CH, list: true }], ['text', 'Message', 'long', { list: true }], ['by', 'By', 'user', { ro: true, list: true }], ['at', 'At', 'datetime', { ro: true, list: true }],
      ['replyTo', 'Reply to', 'text', { ro: true }], ['mentions', 'Mentions', 'text', { ro: true }], ['link', 'About', 'text', { ro: true }], ['edited', 'Edited', 'bool', { ro: true }], ['deleted', 'Deleted', 'bool', { ro: true }]] },
  { id: READ, module: 'projects', name: 'Chat read markers', one: 'Read marker', title: 'channel', readonly: true,
    info: 'How far each person has read in each channel. A person sees only their own.',
    fields: [['user', 'Person', 'user', { ro: true }], ['channel', 'Channel', 'ref', { ref: CH }], ['at', 'Read up to', 'datetime', { ro: true }]] },
];

// ── One definition of who is in a channel, shared by the rules, the steps, the screen and the tests ──

/**
 * Is this person in this channel?
 * `centres`: the work centre records, or a function that returns them (asked only when needed).
 * `can(user, module, level)`: the permission check the service hands a pack (in the browser, `can`
 * from schema.js). Without it nobody counts as an admin and nobody as an outside login.
 */
export function inChannel(user, channel, centres = [], can = null) {
  if (!user || !channel || user.active === false) return false;
  if (can && !can(user, 'projects', 'read')) return false;   // an outside login, or someone who only scans: no chat
  const admin = () => !!can && can(user, 'admin', 'admin');
  const head = () => !!channel.centre && headOf(typeof centres === 'function' ? centres() : centres, channel.centre) === user.id;
  switch (channel.kind) {
    case 'everyone': return true;
    case 'centre': return (!!channel.centre && user.centre === channel.centre) || admin() || head();
    case 'station': return (!!channel.station && user.station === channel.station) || admin() || head();
    case 'group': case 'direct': return (channel.members || []).includes(user.id);
    default: return false;
  }
}
/** Everyone in a channel, from the team list. */
export const membersOf = (channel, users, centres = [], can = null) => (users || []).filter((u) => inChannel(u, channel, centres, can));

/** How many messages from other people each channel holds since this person last read it: { [channelId]: count }. */
export function unreadFor(userId, channels, messages, reads) {
  const out = {}, since = {};
  for (const c of channels || []) out[c.id] = 0;
  for (const r of reads || []) if (r.user === userId && (since[r.channel] || '') < r.at) since[r.channel] = r.at;
  for (const m of messages || []) if (m.channel in out && !m.deleted && m.by !== userId && String(m.at) > (since[m.channel] || '')) out[m.channel]++;
  return out;
}

/** The people a message names with @: by full name, or by first name. `@Ravi` does not name Ravindra. */
export function mentionsIn(text, users) {
  const lower = String(text || '').toLowerCase(), hit = [];
  if (!lower.includes('@')) return hit;
  const names = (u) => { const n = String(u.name || '').trim().toLowerCase(); return n ? [n, n.split(/\s+/)[0]] : []; };
  for (const u of users || []) {
    if (u.active === false) continue;
    const found = names(u).some((n) => { for (let i = lower.indexOf(`@${n}`); i >= 0; i = lower.indexOf(`@${n}`, i + 1)) { if (!/[a-z0-9]/.test(lower[i + n.length + 1] || '')) return true; } return false; });
    if (found) hit.push(u.id);
  }
  return hit;
}

// ── Rules: a person reads a channel and what is said in it only if they are in it ──

// The service's own helpers, kept by the database they belong to, so a step can ask about someone
// other than the person acting (is the person being messaged a member of the team at all?).
// One business's helpers can never answer for another: each has its own database view.
const HELP = new WeakMap();

export const CHAT_RULES = (h) => {
  // Reading a long list of messages asks the same question many times over. The answers are kept
  // only until the current piece of work ends, and are dropped whenever a chat step runs.
  let memo = null;
  const fresh = () => { if (!memo) { memo = { centres: null, ch: new Map(), yes: new Map() }; queueMicrotask(() => { memo = null; }); } return memo; };
  const centres = () => (fresh().centres ||= h.centres());
  const inside = (u, id) => {
    const m = fresh(), key = `${u.id}|${id}|${u.centre || ''}|${u.station || ''}|${u.role}|${u.active !== false}`;
    if (!m.yes.has(key)) { if (!m.ch.has(id)) m.ch.set(id, h.db.get(CH, id)); m.yes.set(key, inChannel(u, m.ch.get(id), centres, h.can)); }
    return m.yes.get(key);
  };
  HELP.set(h.db, { can: h.can, forget: () => { memo = null; } });
  return {
    [CH]: { read: (u, d) => inChannel(u, d, centres, h.can) },
    [MSG]: { read: (u, d) => inside(u, d.channel) },
    [READ]: { read: (u, d) => d.user === u.id },
  };
};

// ── Steps ──

/** What a step needs to know about people other than the one acting. */
function who(ctx) {
  const help = HELP.get(ctx.db); help?.forget();
  // With no helpers to ask (never the case inside the service), only the person acting is known.
  const can = help?.can || ((u, module, level) => u.id === ctx.user.id && ctx.can(module, level));
  let cs = null; const centres = () => (cs ||= ctx.all('work_centres'));
  return {
    can, centres,
    inside: (u, ch) => inChannel(u, ch, centres, can),
    /** Active people who are part of the team (not an outside login). */
    team: () => ctx.all('users').filter((u) => u.active !== false && can(u, 'projects', 'read')),
  };
}
/** The channel, if the person acting is in it. Otherwise the step stops. */
function mine(ctx, id, w = who(ctx)) {
  if (!ctx.can('projects', 'read')) ctx.fail('Chat is for members of the team.', 403);
  const ch = id ? ctx.get(CH, String(id)) : null;
  if (!ch || !w.inside(ctx.user, ch)) ctx.fail('That channel does not exist, or you are not in it.', 404);
  return ch;
}
const clean = (ctx, text) => {
  const t = String(text ?? '').trim();
  if (!t) ctx.fail('Write the message first.');
  if (t.length > TEXT_MAX) ctx.fail('Keep a message under 4,000 characters.');
  return t;
};
/** A record or a task a message is about. Only where it is, never what it says: each reader sees it by their own access. */
function cleanLink(ctx, link) {
  if (!link) return undefined;
  const entity = String(link.entity || ''), id = String(link.id || '');
  let ok = /^[a-z][a-z0-9_]{1,40}$/.test(entity) && /^[\w-]{1,40}$/.test(id);
  if (ok) { try { const doc = ctx.get(entity, id); ok = !!doc && ctx.sees(entity, doc); } catch { ok = false; } }
  if (!ok) ctx.fail('That record cannot be attached. It may have been removed.');
  return { entity, id };
}
function stampRead(ctx, channelId) {
  const mark = ctx.all(READ).find((r) => r.user === ctx.user.id && r.channel === channelId) || { user: ctx.user.id, channel: channelId };
  mark.at = ctx.now; return ctx.put(READ, mark);
}
/** Keep the channel's preview in step with its newest message that still has words. */
function preview(ctx, ch) {
  const last = ctx.all(MSG).filter((m) => m.channel === ch.id && !m.deleted).sort((a, b) => (a.at < b.at ? 1 : -1))[0];
  ch.lastText = last ? short(last.text) : ''; ch.lastBy = last?.by || '';
  return ctx.put(CH, ch);
}
/** What the audit trail and the change feed say. Never the words, and never the name of a private conversation. */
const where = (ch) => (ch.kind === 'direct' ? 'a direct conversation' : ch.kind === 'group' ? 'a group' : ch.name);
const linkTo = (ch) => `chat-${ch.id}`;
const directKey = (a, b) => [a, b].sort().join(':');

export const CHAT_ACTIONS = {
  /** Make sure the standing channels exist and carry the right names. Safe to call often. */
  'chat.sync': {
    level: 'self',
    run(ctx) {
      if (!ctx.can('projects', 'read')) ctx.fail('Chat is for members of the team.', 403);
      HELP.get(ctx.db)?.forget();
      const all = ctx.all(CH), centres = ctx.all('work_centres'), stations = ctx.all('workstations');
      let made = 0, changed = 0;
      const keep = (found, want) => {
        if (!found) { ctx.put(CH, { ...want, members: [], about: '', lastAt: '', lastText: '', archived: false }); made++; return; }
        if (Object.keys(want).some((k) => found[k] !== want[k]) || found.archived) { Object.assign(found, want, { archived: false }); ctx.put(CH, found); changed++; }
      };
      keep(all.find((c) => c.kind === 'everyone'), { kind: 'everyone', name: 'Everyone' });
      for (const c of centres) keep(all.find((x) => x.kind === 'centre' && x.centre === c.id), { kind: 'centre', centre: c.id, name: c.name });
      for (const s of stations) keep(all.find((x) => x.kind === 'station' && x.station === s.id), { kind: 'station', station: s.id, centre: s.centre || '', name: s.name });
      // A work centre or workstation that was removed: what was said stays, the channel closes.
      for (const x of all) {
        const gone = (x.kind === 'centre' && !centres.some((c) => c.id === x.centre)) || (x.kind === 'station' && !stations.some((s) => s.id === x.station));
        if (gone && !x.archived) { x.archived = true; ctx.put(CH, x); changed++; }
      }
      if (made || changed) ctx.log(CH, null, 'synced', `Chat channels brought in step with the work centres: ${made} added, ${changed} changed`);
      return { data: { made, changed } };
    },
  },

  /** Say something in a channel. `replyTo` answers a message; `link` is a record or task being talked about. */
  'chat.post': {
    level: 'self',
    run(ctx, { channel, text, replyTo, link } = {}) {
      const w = who(ctx), ch = mine(ctx, channel, w);
      if (ch.archived) ctx.fail('This channel is closed. Start a new group to carry on.');
      text = clean(ctx, text);
      let parent = null;
      if (replyTo) {
        parent = ctx.get(MSG, String(replyTo));
        if (!parent || parent.channel !== ch.id) ctx.fail('The message you are replying to is no longer there.');
        if (parent.replyTo) parent = ctx.get(MSG, parent.replyTo) || parent;   // threads are one level deep
      }
      const people = w.team().filter((u) => w.inside(u, ch));
      const named = mentionsIn(text, people).filter((id) => id !== ctx.user.id);
      const msg = ctx.put(MSG, { channel: ch.id, text, by: ctx.user.id, at: ctx.now, ...(parent ? { replyTo: parent.id } : {}), mentions: named, ...(link ? { link: cleanLink(ctx, link) } : {}) });
      Object.assign(ch, { lastAt: ctx.now, lastText: short(text), lastBy: ctx.user.id }); ctx.put(CH, ch);
      stampRead(ctx, ch.id);

      const told = new Set();
      for (const id of named) { ctx.notify(id, `${ctx.user.name} mentioned you in ${ch.kind === 'direct' ? 'a message' : ch.name}: ${short(text, 90)}`, linkTo(ch)); told.add(id); }
      if (ch.kind === 'direct') {
        // The other person is always told, once: not again while that notice is unread, and not while they are in the conversation.
        const other = ch.members.find((id) => id !== ctx.user.id);
        const waiting = ctx.all('notifications').some((n) => n.to === other && !n.read && n.link === linkTo(ch));
        const seen = ctx.all(READ).find((r) => r.user === other && r.channel === ch.id)?.at;
        const here = !!seen && Date.parse(ctx.now) - Date.parse(seen) < 120000;
        if (other && !told.has(other) && !waiting && !here) { ctx.notify(other, `${ctx.user.name}: ${short(text, 90)}`, linkTo(ch)); told.add(other); }
      }
      if (parent && parent.by !== ctx.user.id && !told.has(parent.by) && people.some((u) => u.id === parent.by)) ctx.notify(parent.by, `${ctx.user.name} replied to you in ${ch.kind === 'direct' ? 'a message' : ch.name}: ${short(text, 90)}`, linkTo(ch));
      ctx.log(CH, ch.id, 'message', `${ctx.user.name} wrote in ${where(ch)}`);
      return { doc: msg };
    },
  },

  /** Change the words of your own message. */
  'chat.edit': {
    level: 'self',
    run(ctx, { id, text } = {}) {
      const msg = id ? ctx.get(MSG, String(id)) : null;
      const w = who(ctx), ch = mine(ctx, msg?.channel, w);
      if (msg.deleted) ctx.fail('That message was deleted.');
      if (msg.by !== ctx.user.id) ctx.fail('You can change only your own messages.', 403);
      text = clean(ctx, text);
      const before = msg.mentions || [];
      const named = mentionsIn(text, w.team().filter((u) => w.inside(u, ch))).filter((x) => x !== ctx.user.id);
      Object.assign(msg, { text, mentions: named, edited: true }); ctx.put(MSG, msg);
      for (const to of named.filter((x) => !before.includes(x))) ctx.notify(to, `${ctx.user.name} mentioned you in ${ch.kind === 'direct' ? 'a message' : ch.name}: ${short(text, 90)}`, linkTo(ch));
      preview(ctx, ch);
      ctx.log(CH, ch.id, 'edited', `${ctx.user.name} changed a message in ${where(ch)}`);
      return { doc: msg };
    },
  },

  /** Take a message back. It keeps its place, so replies still make sense, but its words are gone. */
  'chat.delete': {
    level: 'self',
    run(ctx, { id } = {}) {
      const msg = id ? ctx.get(MSG, String(id)) : null;
      const ch = mine(ctx, msg?.channel);
      if (msg.by !== ctx.user.id && !ctx.can('admin', 'admin')) ctx.fail('You can delete only your own messages.', 403);
      if (msg.deleted) return { doc: msg };
      const mineToo = msg.by === ctx.user.id;
      Object.assign(msg, { text: '', mentions: [], deleted: true }); delete msg.link; ctx.put(MSG, msg);
      preview(ctx, ch);
      ctx.log(CH, ch.id, 'deleted', `${ctx.user.name} deleted ${mineToo ? 'a message' : 'someone else\'s message'} in ${where(ch)}`);
      return { doc: msg };
    },
  },

  /** Start a group ({ kind: 'group', name, members, about }) or a conversation with one person ({ kind: 'direct', with }). */
  'chat.open': {
    level: 'self',
    run(ctx, p = {}) {
      if (!ctx.can('projects', 'read')) ctx.fail('Chat is for members of the team.', 403);
      const w = who(ctx), team = w.team(), known = new Set(team.map((u) => u.id));
      if (p.kind === 'direct') {
        const other = String(p.with || '');
        if (other === ctx.user.id) ctx.fail('Choose someone else to write to.');
        if (!known.has(other)) ctx.fail('Choose a member of the team to write to.');
        const key = directKey(ctx.user.id, other);
        const have = ctx.all(CH).find((c) => c.kind === 'direct' && (c.key === key || directKey(...(c.members || [])) === key));
        if (have) return { doc: have };
        return { doc: ctx.put(CH, { kind: 'direct', name: '', key, members: [ctx.user.id, other], about: '', lastAt: '', lastText: '', archived: false }) };
      }
      if (p.kind !== 'group') ctx.fail('Choose a group or a person.');
      const name = String(p.name || '').replace(/\s+/g, ' ').trim();
      if (name.length < 2 || name.length > 60) ctx.fail('Give the group a name of 2 to 60 characters.');
      const about = String(p.about || '').trim();
      if (about.length > 300) ctx.fail('Keep what the group is about under 300 characters.');
      const members = [ctx.user.id, ...idList(p.members).filter((id) => id !== ctx.user.id)];
      if (members.some((id) => !known.has(id))) ctx.fail('Someone you chose is not on the team any more. Choose again.');
      if (members.length > GROUP_MAX) ctx.fail(`A group holds up to ${GROUP_MAX} people. Use a work centre channel for more.`);
      const ch = ctx.put(CH, { kind: 'group', name, about, members, lastAt: '', lastText: '', archived: false });
      for (const id of members) ctx.notify(id, `${ctx.user.name} added you to the group ${name}`, linkTo(ch));
      ctx.log(CH, ch.id, 'created', `${ctx.user.name} started a group`);
      return { doc: ch };
    },
  },

  /** Add people to a group or take them out (its creator, or an admin in it). Anyone may take themselves out. */
  'chat.members': {
    level: 'self',
    run(ctx, { channel, add, remove } = {}) {
      const w = who(ctx), ch = mine(ctx, channel, w);
      if (ch.kind !== 'group') ctx.fail('Only a group has a list of people to change. Work centre and workstation channels follow the organisation.');
      if (ch.archived) ctx.fail('This group is closed.');
      const adding = idList(add).filter((id) => !ch.members.includes(id)), removing = idList(remove).filter((id) => ch.members.includes(id));
      const runs = ch.createdBy === ctx.user.id || ctx.can('admin', 'admin');
      if (!runs && (adding.length || removing.some((id) => id !== ctx.user.id))) ctx.fail('Only whoever started the group, or an admin, can add or remove people. You can leave it yourself.', 403);
      const known = new Set(w.team().map((u) => u.id));
      if (adding.some((id) => !known.has(id))) ctx.fail('Someone you chose is not on the team any more. Choose again.');
      ch.members = [...ch.members.filter((id) => !removing.includes(id)), ...adding];
      if (ch.members.length > GROUP_MAX) ctx.fail(`A group holds up to ${GROUP_MAX} people. Use a work centre channel for more.`);
      const left = removing.includes(ctx.user.id);
      // A group nobody is in closes. One its creator has left passes to whoever has been in it longest.
      if (!ch.members.length) ch.archived = true;
      else if (!ch.members.includes(ch.createdBy)) ch.createdBy = ch.members[0];
      ctx.put(CH, ch);
      for (const id of adding) ctx.notify(id, `${ctx.user.name} added you to the group ${ch.name}`, linkTo(ch));
      for (const id of removing) if (id !== ctx.user.id) ctx.notify(id, `${ctx.user.name} took you out of the group ${ch.name}`, 'chat');
      if (adding.length || removing.length) ctx.log(CH, ch.id, 'members', `${ctx.user.name} changed who is in a group`);
      return { doc: left ? null : ch, message: left ? `You left ${ch.name}.` : null };
    },
  },

  /** I have read this channel up to now. */
  'chat.read': {
    level: 'self',
    run(ctx, { channel } = {}) {
      const ch = mine(ctx, channel);
      return { doc: stampRead(ctx, ch.id) };
    },
  },

  /** Close a group (its creator, or an admin in it). What was said stays for those who were in it. */
  'chat.archive': {
    level: 'self',
    run(ctx, { channel } = {}) {
      const ch = mine(ctx, channel);
      if (ch.kind !== 'group') ctx.fail('Only a group can be closed. Work centre and workstation channels follow the organisation.');
      if (ch.createdBy !== ctx.user.id && !ctx.can('admin', 'admin')) ctx.fail('Only whoever started the group, or an admin, can close it.', 403);
      if (!ch.archived) { ch.archived = true; ctx.put(CH, ch); ctx.log(CH, ch.id, 'archived', `${ctx.user.name} closed a group`); }
      return { doc: ch, message: `${ch.name} is closed.` };
    },
  },
};
