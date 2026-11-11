# Deme Intelligence

An ERP for Deme: a 3D map of the business, a production planner, and working modules for
purchasing, inventory, quality, production, B2B and B2C sales, logistics, finance, people,
projects, marketing and design. It has its own server, sign-in by role, and no example data:
it starts empty and is filled by the team.

## Run it

Needs Node 22.13 or newer.

```bash
cd deme
npm install
npm start            # http://localhost:8800
```

The first visit asks you to create the founder account. Add everyone else under **Admin > Team**.
Run this way, the database is one SQLite file at `data/deme.db` (change with `DEME_DB`).

```bash
npm test             # service rules, business actions, scheduler, API, Postgres store, sign-in
npm run dev          # restart on file changes
npm run build        # the static site Netlify publishes (dist/)
```

## Put it live

Netlify, with Postgres behind it: `docs/GO-LIVE.md` lists the five things needed, the first-run
steps, and how a change travels from a branch to the live site (tests on every pull request, a
preview link, publish on merge). The same code also runs as one Docker container with a disk
(`Dockerfile`) for a laptop demo or Deme's own network. Settings are in `.env.example`.

## What is in it

| Area | What it does |
|---|---|
| **Founder view** | Go-live progress by track and by team, and the business at a glance: fabric, production, sales, money, quality |
| **Today** | What needs attention across the business, sales of the day, a getting-started checklist while lists are empty |
| **Business map** | 3D model of suppliers, dye house, factory floor, channels and office. Places, flows, zones and parts are clickable and show live figures from the records |
| **Production room** | Finite-capacity plan from open work orders, styles and work centres. Test a sample run, extra units, a demand jump, absences or a late fabric lot and see what moves |
| **Scan station** | Tailors and masters scan bundles in and out; gives real minutes per piece |
| **Dispatch gate** | One scan point for parcels out, returns in and store fit visits |
| **Projects** | Kanban board and Gantt timeline over the same tasks. "Create the go-live plan" adds 53 dated tasks across 8 tracks with an owner for each |
| **My day** | Check in and out, leave, own KRAs and tasks, for every person |
| **Guide** | Pick a role and be walked through its day on the real screens, starting with bringing existing data in |
| **Bring in data** | Drop any spreadsheet or paste rows. Columns are matched to the right record type (by Claude Haiku when a key is set, by name otherwise), checked, and imported with a row-by-row result |
| **ERP modules** | Masters, Purchasing, Inventory, Quality, Production, B2B sales, B2C sales, Logistics, Finance, People, Projects, Marketing, Design, Admin |

Every list can be filled by hand, from **Bring in data**, or by CSV import on the list itself
(**Import** gives the column headings). Explanations sit behind the small **i** buttons, not on the screens.

### Sign-in

Email and password, or **Sign in with Google** when the Google Workspace settings are present.
Google accounts on the team list get their role; others in the Workspace domain come in as Staff
until an admin gives them one.

### Roles

Roles follow the access plan Deme drew up for its ERP evaluation: founder and operations head
(everything), production head and managers, line manager, tailor or master (scan only), QC,
logistics, B2B and merchandising, sales, finance, marketing, design, HR admin, and staff
(self-service only). **Admin > Roles** shows the full grid. One person can be given extra
modules without changing role ("Also allow").

### What happens automatically

Posting a goods receipt creates fabric rolls for inspection or adds stock, opens the supplier
bill and writes the purchase voucher. A roll that fails inspection before dyeing raises a debit
note. Only inspected rolls can go on a dye lot; a roll that fails after dyeing is written off to
its own ledger. Confirming a sales order raises work orders. Scanning a Shopify parcel out marks
the order shipped and books the sale. A store piece scanned in counts a fit visit. Vouchers
export as Tally import XML. Every change is in the audit trail.

## Not built yet

- Live connections to Shopify, DHL and Tally (CSV import, manual tracking updates and XML export
  cover them for now; `docs/TALLY-CONNECTOR.md` is the plan for Tally).
- Camera reading of fabric defects and barcodes. Handheld scanners work today, and tags print from the app; `docs/VISION-PLAN.md` is the plan for cameras.
- GST and statutory payroll deductions. Settle the tax treatment with Deme's accountant first.
- Password reset by email (an admin sets a new password under Admin > Team).
- The lakehouse for history across ERP, HR and Tally. `docs/LAKEHOUSE.md` is the plan; the event feed it reads from is in place.

## Code

See `docs/DEVELOPING.md` for the layout and the rules every screen follows,
`docs/ARCHITECTURE.md` for how the pieces fit, and `docs/GO-LIVE.md` for hosting and releases. Adding a field or a record type is an edit to
`shared/schema.js`; a new business step is a function in `shared/actions.js`.

The interface follows the HLL design language, re-implemented in plain CSS and WebGL because the
HLL React components cannot be imported into an app with no build step. Manrope stands in for
Aeonik until the webfont files are supplied.
