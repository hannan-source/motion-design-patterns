# The lakehouse: one history of ERP, people and finance data

The live system answers "what is true now". The lakehouse answers "what happened, and how has it
changed", across the ERP, HR and Tally, without slowing the live system down. It can start at no
cost and grow without being rebuilt.

## Recommendation: BigQuery, to start

Deme works in Google Workspace, so the lakehouse starts in Google too: **BigQuery** for the data
and **Looker Studio** for dashboards people open like a Google Sheet.

| Layer | Use | Why | Cost to start |
|---|---|---|---|
| Live records | Postgres (already the live database) | Small, transactional, backed up | Free tier |
| History and reporting | BigQuery, in Deme's own Google Cloud project | Nothing to run or size; SQL; signs in with the same Google accounts | Free allowance: 10 GB of storage and 1 TB of queries a month |
| Dashboards | Looker Studio on BigQuery | Shared and permissioned like Google Docs | Free |
| Scheduled loads | GitHub Actions on a timer, writing through a service account | Already used for tests; no new service | Free minutes |

What "free" means here, as of November 2026, from Google's own pages:

- **The sandbox** needs no card and no billing account. It has the same monthly allowance, but
  every table is deleted 60 days after it is made. Good for a demo; not for keeping history.
- **The free tier with billing switched on** has the same allowance and nothing expires. Deme's
  data is tens of megabytes a year, far inside 10 GB, so the bill stays at zero. Switch billing on
  before the first real load and set a budget alert at a small amount as a safety net.

**BigQuery is not where the app itself keeps its records.** It is built for reading large
amounts of history, not for many people saving small changes at once: an order being confirmed
while a roll is inspected and a parcel is scanned. That is what Postgres does, and it is why the
live site stays on Postgres and copies into BigQuery every night. Both are free at Deme's size.

If Deme later wants to stay out of any one vendor's format, the same loads can write open Parquet
files to object storage (Cloudflare R2, 10 GB free) and be read with DuckDB or DuckLake. The
bronze, silver and gold layout below is the same either way.

## How data gets in

```
Deme Intelligence ── GET /api/events?after=<seq> ──┐
   (ERP + HR)        GET /api/data/<record type>   │
                                                   ├──> landing files ──> cleaned tables ──> answers
Tally ── Tally bridge on the accounts computer ────┤    (bronze)          (silver)           (gold)
Shopify, DHL ── their own exports or APIs ─────────┘
```

1. **ERP and HR.** A service key (its role must be able to read Admin, which guards the feed)
   calls two things the API already has: the
   ordered event feed (`/api/events?after=`), which never repeats or skips, and a nightly snapshot
   of each record type. The job remembers the last `seq` it loaded.
2. **Tally.** The bridge planned in `TALLY-CONNECTOR.md` already reads vouchers and ledgers from
   Tally on the accounts computer. The same program writes a copy of the day book, ledgers and
   outstanding bills to the landing area each night.
3. **Shopify and DHL.** Orders, refunds and tracking events land the same way once those
   connections exist; until then, their CSV exports can be dropped in.

## Three layers

- **Bronze, as received.** One file per load, never edited: `bronze.erp_events`, partitioned by day.
  If a later step has a bug, everything can be rebuilt from here.
- **Silver, cleaned.** One table per thing the business talks about: styles, rolls, work orders,
  scans, parcels, vouchers, people, attendance. Types fixed, duplicates removed, ERP and Tally
  ledgers matched by name.
- **Gold, answers.** Small tables built for questions: fabric loss by mill and month, minutes per
  piece by style and tailor, on-time dispatch by channel, margin by style, cash due by week.
  The Founder view can read these for anything that needs history.

## Steps

1. **Now.** Create the Google Cloud project, a `deme` dataset in the Mumbai region and a service
   account that may write to it. Nightly job: events and snapshots into bronze tables. This is a
   backup with a memory, and every later step builds on it.
2. **When the first history questions come** (a quarter of data): add the silver and gold SQL as
   files in this repository, run by the same job as scheduled queries.
3. **When several people want dashboards**: Looker Studio reports on the gold tables, shared by
   Google account, and history panels in the Founder view.
4. **When cameras arrive** (`VISION-PLAN.md`): readings and clip metadata go to the same dataset;
   only the flags reach the ERP. This is where volume starts to matter and the format pays off.

## Rules that keep it trustworthy

- The lakehouse only reads from the live system. Corrections are made in the ERP or in Tally and
  flow through; nobody edits the lake.
- Salary and personal fields are left out of the general tables and kept in a separate folder
  with its own access.
- Every gold table names the silver tables it was built from, so a number on a dashboard can be
  traced to the records behind it.
