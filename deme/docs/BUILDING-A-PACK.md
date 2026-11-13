# Building a part of Hyper Lychee Labs ERP

Read this with `docs/PLATFORM.md` (the plan), `docs/DEVELOPING.md` (how screens and data work) and
`shared/packs.js` (the contract a pack keeps). This page is the house rules.

## What the product is

A platform any business can run on. A business signs up, picks a template, and gets a workspace:
its own people, work centres, lists, tasks, chat, pay and workflows. Nothing in the code may name a
particular customer. Where the business's name is wanted, use `data.workspace?.name` in the browser.
The first customer's template is "Made-to-order apparel"; a chocolate maker or a design studio
picks another and gets a different system from the same code.

## Shape of the code

- `shared/` runs in Node and in the browser. `shared/schema.js` holds the built-in lists, roles and
  areas; `shared/service.js` holds permissions, validation and the audit trail; packs
  (`shared/chat.js`, `people.js`, `flows.js`, `crm.js`) add their own lists, steps and rules.
- `server/app.js` is the API (workspaces, sessions, routes). `web/js/api.js` is the browser's data
  layer; with no server (the hosted preview) the same service runs in the browser over localStorage.
- `web/js/<screen>.js` exports `mount(el, ctx)` and returns a cleanup function.
- `shared/crm.js` is the smallest complete pack: copy its shape.

## Rules for a pack's server side

- A list definition is data: `{ id, module, name, one, title, info, fields: [[key, label, type, opts]], statuses, initial, editWhen, actions, readonly, open, level }`.
  Field types: text, long, number, money, date, datetime, bool, select (`options`), ref (`ref`), refs, user, lines (`cols`).
  Options: `req`, `list` (show in the table), `ro` (set by the system), `secret` (admin level only),
  `only: ['module:level']` (who may see it), `personal` (a person's own details), `def`, `hint`.
- `readonly: true` closes a list to the generic add/change API; then every write goes through your steps.
- A step is `{ module, level, run(ctx, payload, doc, e) }`. `level: 'self'` is open to any signed-in person.
  A step shown as a button on a record is listed in the list's `actions` and receives the record as `doc`.
- In a step use `ctx`: `ctx.user`, `ctx.today`, `ctx.now`, `ctx.all(list)`, `ctx.get(list, id)`,
  `ctx.put(list, doc)` (stamps id, number, created/updated), `ctx.setStatus(list, doc, status)`,
  `ctx.log(list, id, action, text)`, `ctx.fail(message)` (stops with a plain message the person sees),
  `ctx.notify(userId, text, link)` (in-app notice and email), `ctx.can(module, level)`,
  `ctx.step(name, payload, doc)` (run another pack's step), `ctx.queue({ kind: 'webhook', url, body })`.
- Return `{ message }` to show a toast, `{ data }` to hand something back.
- Rules on single records (who may read or change one) go in `X_RULES`.
- Every message a person can see is plain language: say what happened and what to do next.
- Text from people is length-limited and never trusted. Keep personal data to what the job needs.

## Rules for a screen

- Root element: `<div class="workspace <name>"><div class="workspace-inner">…`. All of the screen's
  CSS is scoped under its root class, in `web/css/<name>.css`.
- Attach listeners to the screen's own root element, never to `el`.
- Read with `data.all(list)`, `data.get(list, id)`, `data.title(list, id)`, `data.users`, `data.user`,
  `data.can(module, level)`, `data.canRead(list)`, `data.canWrite(list)`, `data.workspace`.
  Subscribe with `data.on(fn)` and unsubscribe in cleanup. Change things only through
  `api.create / api.update / api.remove / api.act(stepName, payload, { entity, id })`.
- A list may be switched off for a business: guard with `data.entity(id)` before using it.
- The interface is light only, in the Hyper Lychee Labs design language: tokens in
  `web/css/app.css` (`--ink`, `--surface`, `--line`, `--g` gradient of the view, `--shadow-1/2`,
  `--r-md`, `--ease-out`, Manrope for text, Sometype Mono for labels and numbers).
  Shared pieces in `web/js/ui.js`: `info(text, title)` (the (i) button), `drawer(html)`, `formHtml`,
  `readForm`, `busy(btn, fn)`, `toast`, `oops`, `statusTag`, `esc`.
- Make it feel like the future of business software, not a form over a table: cards with depth
  (layered soft shadows, a hairline border, a gradient accent from `--g`), clear hierarchy, generous
  spacing, motion that explains (staggered entry, state changes that ease). Show things visually
  (boards, timelines, chains, meters) before falling back to a table. Works at phone width
  with a 16px gutter and no sideways page scroll. Respect `prefers-reduced-motion`.
- No explainer paragraphs on screen: put the explanation behind an `info(...)` button.
- No made-up example records, ever. An empty screen says what to do first and offers the button.
- Wording: short, plain, no jargon, no em dashes. Buttons say what they do.

## Checking your work

- `npm test` must pass (Node's own test runner; see `test/platform.test.js` and `test/collab.test.js`
  for how to stand up a service or a whole server in a test). Add tests for what you build.
- Look at it in a real browser. Start a throwaway server:
  `PORT=<port> DEME_DB=<scratch dir>/<name>.db SIGNUP=open npm start`, open it, start a business
  (pick a template), and drive the screen with Playwright:
  `import { createRequire } from 'node:module'; const { chromium } = createRequire(import.meta.url)('playwright');`
  `chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })`.
  Take a screenshot and look at it. Check a phone width (390px) too. Fix what looks plain or broken.
- Check the screen on a business started from "Any other business" as well as "Made-to-order apparel".
