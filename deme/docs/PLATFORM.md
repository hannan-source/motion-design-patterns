# Hyper Lychee Labs ERP: the platform

What started as an ERP for one garment maker becomes a platform any business can build on. This
page is the plan: the shape of the system, what is built, what comes next, and how it is hosted.

## The idea

A business signs up, describes itself (work centres, the workstations inside them, the people),
and gets a running system: its own map, lists, tasks, chat, HR, and the flows of its trade.
Where its work differs from the template, the difference is added as data (a new list, a new
field, a new workflow), not as a code release.

## Five layers

```
5  Workflows      trigger → steps (notify, create, update, ask AI to read a photo, ask for approval)
4  Packs          what a trade needs: Inventory, Purchasing, Apparel floor, Online orders, HR, Channels…
3  Lists          record types as data: built-in ones from packs, and ones a business defines itself
2  Core           people and positions, work centres and workstations, projects, chat, files, notices, import
1  Workspace      one business: its data, its settings, its template, its AI connection, its limits
```

**Workspace.** Every record belongs to exactly one workspace. Isolation is enforced below the
service: each request is handed a view of the database that can only see its own workspace, so no
rule higher up can leak across businesses by mistake.

**Core.** The same for every business. Nothing here knows what the business makes.

**Lists.** A record type is a description: fields, statuses, who may write. The screens, the
import, the audit trail, the permissions and the API all read that description. A list defined by
a business behaves exactly like a built-in one.

**Packs.** A pack is a folder of one trade's lists, steps and screens. A workspace switches packs
on. Packs talk to each other only through records and the event feed, never by calling each
other's code, so a pack can be changed, replaced or run as its own service without touching the
rest. The apparel floor (rolls, dye lots, slips, day plans) is one pack; a chocolate maker would
not have it switched on.

**Workflows.** The low-code layer. A workflow says "when this happens, do these steps". Steps are
a small fixed set, so a flow can be read and edited by someone who is not a programmer. One step
asks an AI model to turn a photo or a document into fields; the answer is always shown to a person
before it is saved.

**Templates.** A template is a starting point for a workspace: which packs are on, the work
centres and workstations, the positions, the go-live plan, the words the business uses ("Styles"
or "Products"). **Deme's template is kept as "Made-to-order apparel"** and is what Deme deploys.

## Modular, not a tangle; services where they earn it

The request was for microservices rather than a monolith. The honest position:

- **Boundaries are real now.** Each pack owns its lists and steps; the core owns identity, org and
  storage. They meet at one API and one event feed.
- **Things that face the outside already run apart**: connectors (Shopify, Meta, Tally bridge),
  AI calls, email. They hold a service key and use the same API as people do.
- **The core is deployed as one unit on purpose.** Splitting it into separately deployed services
  today would add network hops, partial failures and a bigger bill, with no gain at this size.
  Because packs do not call each other, any pack can be lifted out into its own service the day it
  needs its own scaling. The boundary is already there; only the deployment changes.

Data that shows in several places (a customer on an order, a slip and a parcel) is stored once and
referenced. Figures on dashboards are computed from records, not copied.

## AI, per business

Each workspace has an AI connection: Anthropic (Claude), or any endpoint that speaks the common
chat-completions protocol, which covers open-source models a business hosts itself. Keys are kept
on the server and never sent to a browser. A business with no connection uses the platform's
default. Every AI step states what is sent, sends the least it can, and returns a proposal that a
person confirms.

First flows built on it:
- **Bring in data**: match a spreadsheet's columns to a list.
- **Read completed slips from a photo**: at the end of the day, photograph the printed slips that
  passed QC; the model reads slip numbers, the tailor's name and the tick boxes; a person checks
  the table; the slips are marked done. What was printed in the morning is closed in the evening
  without typing.

## Finance stays outside

The platform does not do accounting or GST. It records what happened in the business's own terms
and hands vouchers to the accounting tool (Tally first). The "Accounts bridge" pack exists for
that hand-over only.

## Hosting: one platform, many businesses

**Recommendation: one deployment that Hyper Lychee Labs runs, with every customer as a workspace
on it.** Offer a dedicated deployment only to a customer who needs one, at a price.

Why shared first:
- **Six months free only works if a customer costs almost nothing.** On a shared platform a new
  business is a new row, not a new server, database, domain, set of keys and upgrade to look after.
- **One upgrade reaches everyone.** With a deployment per customer, twenty customers are twenty
  releases, twenty backups and twenty places for a fix to be missing.
- **Templates, packs and workflows improve for all** as each customer teaches the platform
  something.

What makes shared safe:
- Isolation below the service (above), tested on every change.
- Limits per workspace: people, records, file storage, AI calls a month. Shown to the business,
  enforced by the platform, raised when they pay.
- Export on demand: a business can always take all of its data out.

When dedicated is right: a customer whose contracts require their own database or region, or who
wants the system inside their own cloud. It is the same code with one workspace; they pay for the
hosting and for the upgrades to be applied.

| | Shared platform (default) | Dedicated (on request) |
|---|---|---|
| Who hosts | Hyper Lychee Labs | Hyper Lychee Labs in the customer's account, or the customer |
| Data | One database, split by workspace | Their own database |
| Address | `business.<platform domain>` | Their own domain |
| Upgrades | Automatic, for everyone | Scheduled per customer |
| Cost to run | Near zero per added business | A full stack each |
| Fits | The free six months, and most customers after | Regulated or large customers |

**Stack for the shared platform.** Start where it already runs: static site and functions, with
managed Postgres in Mumbai. Three things move before the tenth customer, because chat, photos and
scheduled workflows outgrow that shape:
1. **Files** (photos, PDFs) out of the database into object storage.
2. **Background work** (scheduled workflows, AI jobs, emails, nightly lake loads) onto a queue with
   a worker, so nothing waits on a web request.
3. **Live updates** (chat, boards) over a push channel instead of asking every 40 seconds.

A small container service beside the database carries all three and can be added without
changing how the app is built.

**Charging.** Nothing in the product. After six months, invoice outside it; the platform only
needs to know each workspace's limits and whether it is active.

## Getting a business in: the bridge

A new customer arrives with spreadsheets and exports from an old system. The bridge takes many
files at once, works out which list each belongs to, proposes a new list where nothing fits,
shows what will be created, and loads it with a row-by-row result that can be undone. The aim is
a business fully loaded in an afternoon, which is what makes the free period turn into staying.

## Phases

| Phase | What | State |
|---|---|---|
| 0 | Deme's ERP: fabric to dispatch, slips, tasks, journeys | Built, smoke-tested |
| 1 | Workspaces, templates, packs, lists as data, invites, business builder | In progress |
| 2 | Chat by work centre and workstation; Asana-style projects (sections, subtasks, custom fields, templates) | Next |
| 3 | Workflow builder; AI connections; read slips from a photo | Next |
| 4 | HR in full: salary structure, PF, ESI, professional tax, gratuity, holidays, leave balances, reimbursements, requests, compliance calendar | Next |
| 5 | The map drawn from the business's own work centres; the visual redesign | Next |
| 6 | The bridge: many files, Excel, new lists from a sheet, undo | Next |
| 7 | Files to object storage, a job queue, live push; limits and export per workspace | Before the tenth customer |
