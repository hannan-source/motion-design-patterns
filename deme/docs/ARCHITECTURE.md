# Architecture

## Shape

```
browser (web/)  ──HTTP + cookie──>  server/index.js  ──>  shared/service.js  ──>  server/db.js (SQLite)
                                                             │
                                                             └─ shared/actions.js, shared/schema.js
```

- **`shared/schema.js`** declares every record type (fields, statuses, the actions each status
  allows), the modules, and the roles with their level per module (`scan`, `read`, `write`, `admin`).
- **`shared/service.js`** is the only way to data. It checks the role, validates and coerces input
  against the schema, numbers documents, strips fields a person may not see (salary), refuses to
  delete a record another record points at, writes the audit trail, and runs actions inside a
  transaction so a failed step saves nothing.
- **`shared/actions.js`** holds the business transactions. Each is a small function over a context
  that can read, save, change status, write a voucher, move stock and open a bill.
- **`server/db.js`** stores records as JSON documents in SQLite, keyed by (collection, id), with
  counters, the audit log and sessions beside them.
- **`server/index.js`** serves the web app and the API from one process with no dependencies.
- **`web/`** is plain ES modules. `api.js` keeps a cache of everything the signed-in person may
  read and refreshes the record types each change touched.

The same service runs in the browser over `localStorage` when the page is opened without a server
(the hosted preview). That mode is for looking, not for running the business: data stays on one device.

## API

| Method and path | Purpose |
|---|---|
| `GET /api/state` | Whether setup is needed, and who is signed in |
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

Passwords are hashed with scrypt and a per-user salt. Sessions are random tokens stored
server-side. Sign-in is throttled per address and email. Changes must be JSON from the same
origin. Static serving is limited to `web/` and `shared/`. Permissions are enforced in the service,
never only in the interface.

Still to do before a wide rollout: HTTPS in front (required), password reset by email,
two-step sign-in for admins, and off-site database backups.

## Modules and services

The product is built as separable parts that meet at one API, so each can be changed, scaled or
replaced without touching the others.

**Inside the core today** (one process, separate modules with no shared state except the store):

| Module | Files | Owns |
|---|---|---|
| Records | `shared/schema.js`, `shared/service.js` | Data model, permissions, validation, audit |
| Transactions | `shared/actions.js` | Purchasing, stock, quality, production, sales, logistics, finance, people steps |
| Planning | `shared/engine.js`, `web/js/plan.js` | The schedule and what-if |
| Go-live and tasks | `shared/golive.js` | The plan template and task steps |
| Identity | `server/index.js` | Sign-in, sessions, service keys |
| Storage | `server/db.js` | Nine functions over SQLite |

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

SQLite with JSON documents suits one site and a team of this size, and keeps deployment to one
file. Move to Postgres when any of these becomes true: more than one server instance is needed,
reports need heavy queries across record types, or tables pass a few hundred thousand rows.
The service talks to storage through nine small functions (`all`, `get`, `put`, `del`, `next`,
`log`, `logs`, `tx`, sessions), so the change is a new `db.js`, not a rewrite. At that point,
lists should also be paged instead of loaded whole.

## Connections planned

Shopify (orders in, fulfilment and stock back), DHL (tracking by the number on the label), Tally
(`docs/TALLY-CONNECTOR.md`), and cameras that write the same inspection and scan records people
enter today. Each arrives as a caller of the same service actions, so the rules stay in one place.
