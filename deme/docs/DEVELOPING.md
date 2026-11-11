# Developing Deme Intelligence

How the code is laid out and the rules every screen follows.

## Layout

```
server/     app.js (the API), index.js (Node host, static files), db.js (SQLite), pgstore.js (Postgres)
netlify/    functions/api.mjs (the same API as a Netlify Function)
shared/     runs in Node and in the browser
  schema.js   every record type, its fields, statuses and actions; roles and permissions
  service.js  permissions, validation, numbering, audit trail, action dispatch
  actions.js  the business transactions (post a receipt, inspect a roll, scan a parcel ...)
  org.js      work centres, workstations and positions   collab.js  requests, comments, notices
  engine.js   the production scheduler
  tally.js    vouchers to Tally import XML
  util.js     dates on a Mon–Sat calendar, rupee formatting, small helpers
web/        the browser app, no build step
  js/main.js  sign-in, shell, routing        js/api.js   data layer (server or in-browser preview)
  js/ui.js    shared interface pieces        js/fx.js    gradient field shader
  js/erp.js   generic lists, forms, imports  js/home.js, myday.js, scan.js, gate.js, map.js, room.js  purpose-built screens
  js/smart.js bring in data (AI or name matching)   js/guide.js, guides-content.js  role walkthroughs
  js/journey.js  each person's own steps            js/org.js  work centres and workstations
test/       node --test
```

Run it: `npm install`, then `npm start` (Node 22.13 or newer), open `http://localhost:8800`.
For a throwaway database while developing: `PORT=8801 DEME_DB=/tmp/deme-dev.db npm start`.
Tests: `npm test`.

The browser loads shared code at `/shared/...`, so files in `web/js` import it as `'../shared/schema.js'`
(a URL path, not a disk path). three.js is imported as `'../vendor/three.module.min.js'`.

## A screen

A view module exports `mount(el, ctx)` and returns a cleanup function (or nothing).

- `ctx.go(name, opts)` switches route: `journey`, `org`, `pulse`, `home`, `map`, `room`, `myday`,
  `scan`, `gate`, `guide`, `import`, `m-<module>`. `#task-<id>` opens one task in the tracker.
- Attach listeners to the screen's own root element, never to `el` itself: `el` is reused by the
  next screen, so a listener left on it keeps firing there.
- `ctx.openEntity(entityId, opts)` opens a record type in the ERP; `opts` may be `{ id }` to open one
  record or `{ add: true }` to open the add form. `ctx.opts` holds what the previous view passed.
- Workspace screens render `<div class="workspace"><div class="workspace-inner">…`.

## Data

`import { api, data } from './api.js'`.

- `data.all(entity)`, `data.get(entity, id)`, `data.title(entity, id)` (use `'users'` for people) read a
  synchronous cache of everything the signed-in person may read. `data.canRead(entity)`,
  `data.canWrite(entity)`, `data.can(module, level)` answer permission questions; `data.user`,
  `data.users`, `data.mine` (own employee record, today's attendance, leave, KRAs).
- `data.on(fn)` subscribes to changes and returns an unsubscribe; `fn(touched)` gets the changed
  record types (`['*']` after a full load). Re-render from the cache; unsubscribe in cleanup.
- Change things only through `api.create(entity, input)`, `api.update(entity, id, input)`,
  `api.remove(entity, id)`, `api.importRows(entity, rows)` and
  `api.act(actionId, payload, { entity, id })` (leave the third argument out for scans and
  self-service actions). Each resolves after the cache is refreshed and returns
  `{ doc, message, data }`; each rejects with an `Error` whose `message` is fit to show.
- A person whose level on a module is `scan` (tailors and masters) cannot read lists. Screens for
  them work from action results only.

There is no example data. Every screen must look finished when its lists are empty: say what is
missing in a few words and offer the button that adds it.

## Interface rules

- Design language: HLL, re-implemented in plain CSS (`web/css/app.css`). Light ground only, no dark
  mode. Dark Grey `#1A1A1A` text, Mid Grey `#949494` captions, hairlines as low-alpha ink, radius 6px.
  Manrope for text and headlines (light weight for large type), Sometype Mono uppercase for
  functional text. Use only the tokens and classes in `app.css`; never a literal colour.
- Each area wears one gradient through `--g` (set by the router). Buttons are `.btn` (muted at rest,
  the gradient blooms on hover), `.btn-primary` for the main action, `.btn-outline`, `.btn-quiet`,
  `.btn-sm`. Status is a `.tag tag-ok|warn|crit|info|plain`. View titles are `<h1 class="reveal">`.
  Other pieces: `.panel`, `.panel-head`, `.panel-pad`, `.kpis`/`.kpi`, `.table-wrap`/`.table`,
  `.field`, `.input`, `.select`, `.seg`, `.chip`, `.bar`, `.empty`, `.eyebrow`, `.sect`, `.link`.
- No explanations on screen. Where something may need explaining, put an information button beside
  its heading: `info(text, title)` from `ui.js`. Labels, headings and data only otherwise.
- Copy: short, plain, in the words the factory uses. No em-dash asides, no emoji.
- Escape everything interpolated into HTML with `esc()`. Use `toast(msg)` for results and
  `oops(error)` for failures; wrap button handlers in `busy(btn, async () => …)`.
- Must work at 400px wide with no sideways page scroll (tables scroll inside `.table-wrap`), with
  a keyboard, and with `prefers-reduced-motion`.
- View-specific CSS goes in the view's own file under `web/css/` and is scoped under a class on the
  view's root element, so one view's class names cannot leak into another.
