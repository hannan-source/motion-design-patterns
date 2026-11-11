# Architecture

## Shape

```
                         ┌─ server/index.js (Node http) ──┐                  ┌─ server/db.js (SQLite file)
browser (web/) ──HTTPS──>┤                                ├─> server/app.js ─┤
                         └─ netlify/functions/api.mjs ────┘        │         └─ server/pgstore.js (Postgres)
                                                                   └─> shared/service.js ─> shared/actions.js, schema.js
```

One API, two ways to run it. `server/app.js` holds every route and knows nothing about the host:
it takes a plain request object and a store. `server/index.js` runs it as one Node process over
SQLite; `netlify/functions/api.mjs` runs it as a function over Postgres.

- **`shared/schema.js`** declares every record type (fields, statuses, the actions each status
  allows), the modules, and the roles with their level per module (`scan`, `read`, `write`, `admin`).
- **`shared/service.js`** is the only way to data. It checks the role, validates and coerces input
  against the schema, numbers documents, strips fields a person may not see (salary), refuses to
  delete a record another record points at, writes the audit trail, and runs actions inside a
  transaction so a failed step saves nothing.
- **`shared/actions.js`** holds the business transactions. Each is a small function over a context
  that can read, save, change status, write a voucher, move stock and open a bill.
- **`server/app.js`** is the API: sign-in (password and Google), sessions, service keys, records,
  imports, actions, the event feed, the AI column mapping.
- **`server/db.js`** stores records as JSON documents in SQLite, keyed by (collection, id), with
  counters and the audit log beside them.
- **`server/pgstore.js`** does the same in Postgres. The service is synchronous, so each request
  runs against an in-memory snapshot: when the code asks for a collection that is not loaded, the
  store fetches it and runs the request again; at the end, everything changed is written in one
  transaction. A version number per collection catches two requests changing the same collection
  at once, and the later one is run again on fresh data. Numbering stays gap-free and unique.
- **`server/index.js`** serves the web app and the API from one process.
- **`web/`** is plain ES modules. `api.js` keeps a cache of everything the signed-in person may
  read and refreshes the record types each change touched.

The same service runs in the browser over `localStorage` in the hosted preview page, which is
marked as a preview when it is built (`tools/build-artifact.mjs`). That mode is for looking, not
for running the business: data stays on one device. Every other copy uses its server and shows a
"could not start" screen if the server cannot be reached; it never falls back to the browser.

## API

| Method and path | Purpose |
|---|---|
| `GET /api/state` | Whether setup is needed, who is signed in, and whether Google sign-in and AI mapping are switched on |
| `GET /api/auth/google/start`, `/callback` | Google Workspace sign-in (authorisation-code flow, state cookie, domain check) |
| `GET /api/all` | Everything the person may read, in one request |
| `POST /api/me/position` | Say which position I hold; it waits to be confirmed |
| `POST /api/users/:id/join` | Confirm or decline a request to join `{ ok }` (the head of that work centre, or an admin) |
| `GET /api/inbox`, `POST /api/inbox/read` | My notices |
| `POST /api/ai/map` | Match spreadsheet columns to a record type: `{ headers, sample, entity? }` |
| `POST /api/setup` | Create the founder (once) |
| `POST /api/login`, `POST /api/logout` | Session cookie `deme_sid` (HttpOnly, SameSite=Lax, 14 days) |
| `GET /api/boot` | The person, what they may read and write, the team directory, their own HR data |
| `GET/POST /api/data/:entity`, `GET/PUT/DELETE /api/data/:entity/:id` | Records |
| `POST /api/import/:entity` | Bulk add `{ rows }`; good rows go in, bad rows are reported |
| `POST /api/action/:id` | Run an action `{ entity, id, payload }` |
| `GET /api/audit?entity=&id=` | Audit trail |
| `GET/POST /api/users`, `PUT /api/users/:id` | Team (admin) |
| `GET /api/export/tally?ids=` | Tally import XML |
| `GET /api/events?after=` | Ordered feed of everything that happened, for other services |
| `GET/POST /api/keys`, `PUT /api/keys/:id` | Service keys (admin, signed in as a person) |

## Security

Passwords are hashed with scrypt and a per-user salt. Sessions are random tokens; only their
hash is stored. Google sign-in verifies the account with Google, checks the Workspace domain, and
admits a person as their team-list role or, inside the domain, as Staff. The AI mapping sends
column headings and five sample rows to the model, never a whole file, and its answer is checked
against the schema before anything is shown. Sign-in is throttled per address and email. Changes must be JSON from the same
origin. Static serving is limited to `web/` and `shared/`. Permissions are enforced in the service,
never only in the interface.

Access has two layers. The role's level on a module decides what a person can open. On top of
that, single records carry rules: a task can be changed only by the people on it (anyone can
comment), a project limited to its work centre is invisible to everyone else, and the head of a
work centre can change its own workstations without wider access to the reference lists. A
position picked at sign-in grants nothing until it is confirmed.

Notices are written with the change that caused them and emailed only after that change has been
saved (Resend, when `RESEND_API_KEY` and `MAIL_FROM` are set). A failed email never fails the
request; the notice is already in the person's inbox in the app.

Still to do before a wide rollout: password reset by email (not needed for people who use
Google), two-step sign-in for admins who use passwords, and scheduled database backups.

## Modules and services

The product is built as separable parts that meet at one API, so each can be changed, scaled or
replaced without touching the others.

**Inside the core today** (one process, separate modules with no shared state except the store):

| Module | Files | Owns |
|---|---|---|
| Records | `shared/schema.js`, `shared/service.js` | Data model, permissions, validation, audit |
| Transactions | `shared/actions.js` | Purchasing, stock, quality, production, sales, logistics, finance, people steps |
| Planning | `shared/engine.js`, `web/js/plan.js` | The schedule and what-if |
| Organisation | `shared/org.js` | Work centres, workstations, positions and what each position may do |
| Go-live and tasks | `shared/golive.js` | The plan template and task steps |
| Working together | `shared/collab.js` | Requests to a work centre, what a task waits for, comments, notices |
| Identity | `server/app.js` | Sign-in (password, Google), sessions, service keys |
| Storage | `server/db.js`, `server/pgstore.js` | The same small interface over SQLite or Postgres |
| Hosts | `server/index.js`, `netlify/functions/api.mjs` | Turn the host's request into the API's and back |

**Services that run beside the core** (separate programs with their own service key; none can
reach the database, only the API):

| Service | Reads | Writes | State |
|---|---|---|---|
| Scanner apps and fixed scanners | — | `gate.scan`, `scan.start`, `scan.finish` | Works now with a key |
| Tally bridge (on the accounts computer) | Open vouchers, `GET /api/events` | `vouchers.markSynced` | Planned: `docs/TALLY-CONNECTOR.md` |
| Shopify sync | Shopify orders | `shop_orders`, stock and fulfilment back | Planned |
| DHL tracking | DHL events by tracking number | `parcel.track`, `parcel.delivered` | Planned |
| Notifier | `GET /api/events` | WhatsApp or SMS nudges | Planned |
| Vision edge boxes | Camera streams | The same actions people use | Planned: `docs/VISION-PLAN.md` |

The seam for all of them is the same: a service key that acts with one role, the action
endpoints, and `GET /api/events?after=<seq>`, an ordered feed of everything that has happened.
A service keeps the last `seq` it handled and asks for what came after, so it can stop and
restart without missing or repeating anything.

This is deliberate: one core that is simple to deploy and back up, with independent services at
the edges where the outside world changes (couriers, shops, accounting, cameras). Splitting the
core itself into separately deployed services would add failure points without a benefit at
Deme's size; the module boundaries above are where it would be cut if that changes.

## Limits and the next step

Records are JSON documents, so adding a field needs no migration. The Postgres store loads whole
collections per request, which suits Deme's size (thousands of records per type). Past a few
hundred thousand rows in one type, give that type its own table and page its list; the service
reaches storage through a handful of functions (`all`, `get`, `put`, `del`, `next`, `log`, `logs`,
`tx`), so that is a change to the store, not to the rules. History and heavy reporting belong in
the lakehouse (`docs/LAKEHOUSE.md`), which reads the event feed and leaves the live database small.

## Connections planned

Shopify (orders in, fulfilment and stock back), DHL (tracking by the number on the label), Tally
(`docs/TALLY-CONNECTOR.md`), and cameras that write the same inspection and scan records people
enter today. Each arrives as a caller of the same service actions, so the rules stay in one place.
