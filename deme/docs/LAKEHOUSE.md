# The lakehouse: one history of ERP, people and finance data

The live system answers "what is true now". The lakehouse answers "what happened, and how has it
changed", across the ERP, HR and Tally, without slowing the live system down. It can start at no
cost and grow without being rebuilt.

## Recommendation

| Layer | Use | Why | Cost to start |
|---|---|---|---|
| Live records | Postgres (already the live database) | Small, transactional, backed up | Free tier |
| Files | Parquet on object storage: Cloudflare R2 | Open format any tool reads; no fee for reading data out | 10 GB free each month |
| Table format | DuckLake, catalogue kept in Postgres | Adds versions, time travel and safe schema change over the Parquet files; version 1.0 (April 2026) is the first production release | Free, open source |
| Engine | DuckDB | Runs anywhere: a laptop, a scheduled job, the browser. No cluster to keep running | Free, open source |
| Scheduled loads | GitHub Actions on a timer | Already used for tests; no new service | Free minutes |
| Shared SQL and dashboards | MotherDuck (hosted DuckDB) when more than one person queries it | Same SQL, nothing to rewrite | Has a free plan; check its current limits |

Deme's data is small by lakehouse standards: tens of thousands of records a year, not billions.
A warehouse cluster (Databricks, Snowflake) would cost money every month to sit idle. The stack
above costs nothing until there is real volume, and because the files are plain Parquet, moving up
later is a matter of pointing a bigger engine at the same bucket.

If Deme would rather stay inside Google, the alternative is **BigQuery with Looker Studio**: the
same loads write to BigQuery instead of Parquet, and dashboards are shared like Google Sheets.
BigQuery has a monthly free allowance; the trade is that the data then lives in Google's format.

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

- **Bronze, as received.** One file per load, never edited: `bronze/erp/events/2026-11-11.parquet`.
  If a later step has a bug, everything can be rebuilt from here.
- **Silver, cleaned.** One table per thing the business talks about: styles, rolls, work orders,
  scans, parcels, vouchers, people, attendance. Types fixed, duplicates removed, ERP and Tally
  ledgers matched by name.
- **Gold, answers.** Small tables built for questions: fabric loss by mill and month, minutes per
  piece by style and tailor, on-time dispatch by channel, margin by style, cash due by week.
  The Founder view can read these for anything that needs history.

## Steps

1. **Now, no new services.** Nightly job: events and snapshots to Parquet in an R2 bucket. This is
   a backup with a memory, and every later step builds on it.
2. **When the first history questions come** (a quarter of data): add the silver and gold SQL as
   files in this repository, run by the same job. Query from DuckDB on a laptop.
3. **When several people want dashboards**: register the tables in DuckLake, attach MotherDuck or
   an open dashboard tool, and add history panels to the Founder view.
4. **When cameras arrive** (`VISION-PLAN.md`): readings and clips metadata go to the same bucket;
   only the flags reach the ERP. This is where volume starts to matter and the format pays off.

## Rules that keep it trustworthy

- The lakehouse only reads from the live system. Corrections are made in the ERP or in Tally and
  flow through; nobody edits the lake.
- Salary and personal fields are left out of the general tables and kept in a separate folder
  with its own access.
- Every gold table names the silver tables it was built from, so a number on a dashboard can be
  traced to the records behind it.
