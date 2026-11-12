// Working together: tasks addressed to a work centre, what a task waits for, comments, and the
// notices that tell people something needs them. Also the steps that bring the organisation
// itself into being. These are actions like any other, so the same rules and audit trail apply.

import { headOf } from './org.js';

const REQUESTS = 'Requests between teams';
const short = (s, n = 70) => (String(s).length > n ? `${String(s).slice(0, n - 1)}…` : String(s));
const link = (task) => `task-${task.id}`;
/** Everyone with a stake in a task: the person on it, whoever asked, and the head of its work centre. */
const stakeholders = (ctx, t) => [...new Set([t.assignee, t.createdBy, t.centre ? headOf(ctx.all('work_centres'), t.centre) : null].filter(Boolean))];
const openDeps = (ctx, t) => (t.dependsOn || []).map((id) => ctx.get('tasks', id)).filter((d) => d && d.status !== 'done');

export const COLLAB_ACTIONS = {
  /** A new task: one addressed to a work centre goes to its head, and whoever is named is told. */
  'hook.created.tasks': {
    run(ctx, _p, doc) {
      if ((doc.dependsOn || []).includes(doc.id)) ctx.fail('A task cannot wait for itself.');
      const centre = doc.centre ? ctx.get('work_centres', doc.centre) : null;
      if (centre && !doc.assignee && centre.head) { doc.assignee = centre.head; ctx.put('tasks', doc); }
      if (doc.assignee) ctx.notify(doc.assignee, centre ? `${ctx.user.name} asked ${centre.name}: ${short(doc.title)}` : `${ctx.user.name} gave you a task: ${short(doc.title)}`, link(doc));
    },
  },
  'hook.updated.tasks': {
    run(ctx, old, doc) {
      if ((doc.dependsOn || []).includes(doc.id)) ctx.fail('A task cannot wait for itself.');
      // A loop of tasks waiting on each other would never start.
      const seen = new Set(); const walk = (id) => { if (id === doc.id) ctx.fail('Those tasks would be waiting for each other.'); if (seen.has(id)) return; seen.add(id); for (const d of ctx.get('tasks', id)?.dependsOn || []) walk(d); };
      for (const d of doc.dependsOn || []) walk(d);
      if (doc.assignee && doc.assignee !== old.assignee) ctx.notify(doc.assignee, `${ctx.user.name} put you on: ${short(doc.title)}`, link(doc));
      if (doc.due && doc.due !== old.due && doc.assignee) ctx.notify(doc.assignee, `New date for ${short(doc.title, 50)}: ${doc.due}`, link(doc));
    },
  },
  /** When a work centre gets a head, that person belongs to it and is told. */
  'hook.updated.work_centres': {
    run(ctx, old, doc) {
      if (!doc.head || doc.head === old.head) return;
      const u = ctx.get('users', doc.head);
      if (u && !u.centre) { u.centre = doc.id; ctx.db.put('users', u); }
      ctx.notify(doc.head, `You are now in charge of ${doc.name}`, 'journey');
    },
  },

  /** Say something on a task. Mention a person with @ and their name to tell them too. */
  'task.comment': {
    module: 'projects', level: 'read',
    run(ctx, { id, text }) {
      const task = ctx.get('tasks', id) || ctx.fail('That task no longer exists.');
      if (!ctx.sees('tasks', task)) ctx.fail('That task no longer exists.', 404);   // a project limited to its work centre is closed to others for writing too
      text = String(text || '').trim(); if (!text) ctx.fail('Write the comment first.');
      if (text.length > 4000) ctx.fail('Keep a comment under 4,000 characters.');
      const c = ctx.put('comments', { task: id, text, by: ctx.user.id });
      const lower = text.toLowerCase();
      const named = ctx.all('users').filter((u) => u.active !== false && (lower.includes(`@${u.name.toLowerCase()}`) || lower.includes(`@${u.name.toLowerCase().split(/\s+/)[0]}`))).map((u) => u.id);
      const earlier = ctx.all('comments').filter((x) => x.task === id).map((x) => x.by);
      for (const to of new Set([...stakeholders(ctx, task), ...earlier, ...named])) ctx.notify(to, `${ctx.user.name} on ${short(task.title, 50)}: ${short(text, 90)}`, link(task));
      ctx.log('tasks', id, 'comment', `Comment on ${task.title}`);
      return { message: null, data: { comment: c.id } };
    },
  },
  /** Ask a work centre for something: "I need 80 samples by the 20th". It lands with the head of that work centre. */
  'task.ask': {
    module: 'projects', level: 'read',
    run(ctx, { centre, title, due, notes, project }) {
      const c = ctx.get('work_centres', centre) || ctx.fail('Choose the work centre you are asking.');
      title = String(title || '').trim(); if (!title) ctx.fail('Say what you need.');
      if (due && !/^\d{4}-\d{2}-\d{2}$/.test(due)) ctx.fail('Give the date as a day.');
      let p = project ? ctx.get('projects', project) : ctx.all('projects').find((x) => x.kind === 'requests');
      if (project && (!p || !ctx.sees('projects', p))) ctx.fail('That project no longer exists.', 404);
      if (!p) p = ctx.put('projects', { name: REQUESTS, kind: 'requests', access: 'everyone', start: ctx.today, about: 'What one work centre has asked of another. Each request goes to the head of the work centre it is addressed to.' });
      const t = ctx.put('tasks', { project: p.id, title, centre: c.id, assignee: c.head || undefined, start: ctx.today, due: due || undefined, notes: String(notes || '').trim() || undefined });
      if (c.head) ctx.notify(c.head, `${ctx.user.name} asked ${c.name}: ${short(title)}`, link(t));
      ctx.log('tasks', t.id, 'created', `${ctx.user.name} asked ${c.name}: ${title}`);
      return { message: c.head ? `Sent to ${ctx.get('users', c.head)?.name || c.name}.` : `Added for ${c.name}. Nobody is in charge of it yet, so nobody was told.`, data: { task: t.id } };
    },
  },
  /** Create the starting work centres and workstations where they are missing (older set-ups). */
  'org.seed': {
    module: 'admin', level: 'admin',
    run(ctx) {
      // Before work centres had heads, production workstations were kept in the same list.
      const old = ctx.all('work_centres').filter((c) => c.stage || c.people !== undefined);
      const made = ctx.seedOrg(ctx.user, ctx.now);
      const production = ctx.centreByKey('production');
      for (const o of old) { ctx.db.del('work_centres', o.id); ctx.put('workstations', { ...o, centre: production }); }
      const me = ctx.get('users', ctx.user.id);
      if (me && !me.position) { Object.assign(me, { position: 'setup', centre: ctx.centreByKey('management') }); ctx.db.put('users', me); }
      const n = Object.keys(made).length;
      ctx.log('work_centres', null, 'created', `Starting work centres created: ${n}`);
      return { message: n ? `${n} work centres created with their workstations.` : 'The work centres are already there.' };
    },
  },
};

/** Called by the task steps in golive.js so the right people hear about them. */
export const taskNotices = {
  done(ctx, doc) {
    for (const to of stakeholders(ctx, doc)) ctx.notify(to, `Done: ${short(doc.title)}`, link(doc));
    for (const t of ctx.all('tasks')) {
      if (t.status === 'done' || !(t.dependsOn || []).includes(doc.id) || openDeps(ctx, t).length) continue;
      if (t.assignee) ctx.notify(t.assignee, `You can start: ${short(t.title, 50)} (it was waiting for ${short(doc.title, 40)})`, link(t));
    }
  },
  blocked(ctx, doc, reason) {
    const owner = ctx.get('projects', doc.project)?.owner;
    for (const to of new Set([...stakeholders(ctx, doc), owner].filter(Boolean))) ctx.notify(to, `Blocked: ${short(doc.title, 50)}${reason ? ` (${short(reason, 60)})` : ''}`, link(doc));
  },
  /** Tasks that must be finished before this one can start. */
  waitingOn: openDeps,
};
