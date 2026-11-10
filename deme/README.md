# Deme ERP

An ERP for Deme: a 3D map of the business, a production planner, and working modules for
purchasing, inventory, quality, production, B2B and B2C sales, logistics, finance, people,
projects, marketing and design. It has its own server, sign-in by role, and no example data:
it starts empty and is filled by the team.

## Run it

Needs Node 22.13 or newer. There are no packages to install.

```bash
cd deme
npm start            # http://localhost:8800
```

The first visit asks you to create the founder account. Add everyone else under **Admin > Team**.
The database is one SQLite file at `data/deme.db` (change with `DEME_DB`). Back that file up.

```bash
npm test             # service rules, business actions, scheduler, HTTP and role checks
npm run dev          # restart on file changes
```

## Deploy it

One container, one volume:

```bash
docker build -t deme-erp .
docker run -d --name deme-erp -p 8800:8800 -v deme-data:/data deme-erp
```

Put it behind HTTPS (a reverse proxy such as Caddy or nginx, or the platform's own TLS). The
sign-in cookie is marked `Secure` when the proxy sends `X-Forwarded-Proto: https`, or set
`DEME_SECURE_COOKIES=1`. Any host that runs a Docker image with a persistent disk works
(Render, Railway, Fly.io, a VM). Settings are in `.env.example`.

Before going live: use HTTPS, schedule a backup of the database file, and keep the server to one
instance (SQLite is a single-writer database; see `docs/ARCHITECTURE.md` for when to move to Postgres).

## What is in it

| Area | What it does |
|---|---|
| **Today** | What needs attention across the business, sales of the day, a getting-started checklist while lists are empty |
| **Business map** | 3D model of suppliers, dye house, factory floor, channels and office. Places, flows, zones and parts are clickable and show live figures from the records |
| **Production room** | Finite-capacity plan from open work orders, styles and work centres. Test a sample run, extra units, a demand jump, absences or a late fabric lot and see what moves |
| **Scan station** | Tailors and masters scan bundles in and out; gives real minutes per piece |
| **Dispatch gate** | One scan point for parcels out, returns in and store fit visits |
| **My day** | Check in and out, leave, own KRAs and tasks, for every person |
| **ERP modules** | Masters, Purchasing, Inventory, Quality, Production, B2B sales, B2C sales, Logistics, Finance, People, Projects, Marketing, Design, Admin |

Every list can be filled by hand or by CSV import (**Import** on any list gives the column
headings). Explanations sit behind the small **i** buttons, not on the screens.

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
- Camera reading of fabric defects and barcodes. Handheld scanners that type like a keyboard work today.
- GST and statutory payroll deductions. Settle the tax treatment with Deme's accountant first.
- Password reset by email (an admin sets a new password under Admin > Team).

## Code

See `docs/DEVELOPING.md` for the layout and the rules every screen follows, and
`docs/ARCHITECTURE.md` for how the pieces fit. Adding a field or a record type is an edit to
`shared/schema.js`; a new business step is a function in `shared/actions.js`.

The interface follows the HLL design language, re-implemented in plain CSS and WebGL because the
HLL React components cannot be imported into an app with no build step. Manrope stands in for
Aeonik until the webfont files are supplied.
