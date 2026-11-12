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

The first visit asks you to create the first account: the system admin, who shapes the work
centres, names who is in charge of each and invites the team. The founder is added like everyone else.
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
| **My journey** | Where everyone except the founder opens. Pick the position you hold; once confirmed, see your own part of the go-live in order: what to do now, the screen it is done on, a walkthrough, and how much is already in. Heads confirm who joins them and see their team's progress |
| **Work centres** | How Deme is organised: each work centre with the person in charge, its workstations and its people. The admin shapes work centres; a head runs the workstations of their own |
| **Founder view** | Go-live progress by track and by team, and the business at a glance: fabric, production, sales, money, quality |
| **Today** | What needs attention across the business, sales of the day, a getting-started checklist while lists are empty |
| **Business map** | 3D model of suppliers, dye house, factory floor, channels and office. Places, flows, zones and parts are clickable and show live figures from the records |
| **Production room** | Finite-capacity plan from open work orders, styles and work centres. Test a sample run, extra units, a demand jump, absences or a late fabric lot and see what moves |
| **Orders** | One slip per made-to-order piece, from a paid online order or from an internal order placed by the store, a boutique, a shoot or sales. Everyone can see where a slip is and whether it is stuck, so nobody has to chase. Slips print with a QR code |
| **Scan a slip** | One page for a phone: the tailor scans to start and to finish, QC scans the piece in and judges it pass, rework or reject. Each stop is stamped with the time and the person |
| **Channels** | What each marketing channel costs and what it really brings in, set against what the channel claims |
| **Privacy** | Find what is held on a customer, hand it over, or remove it on request |
| **Day plan** | Tomorrow's cutting, decided the evening before: which master cuts which order, checked line by line against fabric really in the store. Issuing it sets the metres aside, makes one bundle per line and gives the fabric runner the bundling list. No slip goes out without fabric behind it |
| **Dye house** | A phone screen for the dye house and for Deme's checker there: the lots at the dye house, and a problem reported in a few taps with photos |
| **Scan station** | Tailors and masters scan bundles in and out; gives real minutes per piece |
| **Dispatch gate** | One scan point for parcels out, returns in and store fit visits |
| **Projects** | Kanban board and Gantt timeline over the same tasks, for the go-live and every project after it. Anyone can add a task, ask another work centre for something ("I need 80 samples"), comment, mention people and say what a task waits for. Only the people on a task can change it. Notices arrive in the app and by email |
| **My day** | Check in and out, leave, own KRAs and tasks, for every person |
| **Guide** | Pick a role and be walked through its day on the real screens, starting with bringing existing data in |
| **Bring in data** | Drop any spreadsheet or paste rows. Columns are matched to the right record type (by Claude Haiku when a key is set, by name otherwise), checked, and imported with a row-by-row result |
| **ERP modules** | Masters, Purchasing, Inventory, Quality, Production, B2B sales, B2C sales, Logistics, Finance, People, Projects, Marketing, Design, Admin |

Every list can be filled by hand, from **Bring in data**, or by CSV import on the list itself
(**Import** gives the column headings). Explanations sit behind the small **i** buttons, not on the screens.

### Sign-in

Email and password, or **Sign in with Google** when the Google Workspace settings are present.
Google accounts on the team list get their position; others in the Workspace domain come in, pick
the position they hold and wait to be confirmed.

### Work centres, positions and roles

A **work centre** is a part of the business with one person in charge (Production, Merchandising,
Design, Finance). A **workstation** is a place inside it where one kind of work is done (cutting,
a stitching line, the inspection table, the dispatch gate). A **position** is the job a person
holds: it places them in a work centre, gives them the role that job needs, and decides which
go-live tasks are theirs. People pick their position when they first sign in; the head of that
work centre confirms it, and an admin confirms positions that lead a work centre or handle money.


Roles follow the access plan Deme drew up for its ERP evaluation: founder and operations head
(everything), production head and managers, line manager, tailor or master (scan only), QC,
logistics, B2B and merchandising, sales, finance, marketing, design, HR admin, and staff
(self-service only). **Admin > Roles** shows the full grid. One person can be given extra
modules without changing role ("Also allow").

### How fabric and work really move

The model follows how Deme runs, as its merchandising head described it:

- **Fabric.** Ready-for-dyeing fabric goes from the mill straight to the dye house; other fabric
  comes to the store. A receipt says where it was delivered. A roll is passed either on the mill's
  QC report or by Deme's own check, at the dye house or the store.
- **Failures are claims.** Fabric that fails, before dyeing or after it, is the mill's or the dye
  house's to answer for. A claim opens with the reason and stays open until the credit note or the
  replacement arrives. Only a failure nobody answers for is written off.
- **Cutting.** Planned a day ahead against fabric in the store; issued as bundles of exactly the
  cut quantity per master.
- **Vendors.** Most wholesale work is made by production vendors. Each work order says which
  vendor, and whether it is checked there by Deme's QC and shipped from there, or comes back for
  QC in-house. Vendor work takes no in-house capacity in the plan.
- **Dispatch.** The office adds the paperwork to a parcel (e-invoice number, and an e-way bill
  number above ₹50,000, with the documents attached). The factory prints, attaches and scans it
  out. A parcel without its paperwork is stopped at the gate. Returned pieces are approved as fit
  to sell, then sold on.
- **Photos and documents** can be attached to any record.

### What happens automatically

Posting a goods receipt creates fabric rolls for inspection or adds stock, opens the supplier
bill and writes the purchase voucher. A roll that fails opens a claim on the supplier at fault, with its debit note. Only rolls that
were checked, or accepted on the mill's QC report, can go on a dye lot. Confirming a sales order raises work orders. Scanning a Shopify parcel out marks
the order shipped and books the sale. A store piece scanned in counts a fit visit. Vouchers
export as Tally import XML. Every change is in the audit trail.

## Security and privacy

`docs/SECURITY.md` sets out what the product does, what the hosting does, and what Deme has to do
as a company for GDPR and India's DPDP Act.

## Not built yet

- Live connections to DHL and Tally (manual tracking updates and XML export cover them for now;
  `docs/TALLY-CONNECTOR.md` is the plan for Tally). Shopify orders and Meta spend are pulled in
  when their keys are set; pushing tracking numbers back to Shopify, and a Google Ads pull, are not built.
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
