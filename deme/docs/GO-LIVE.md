# Putting Deme Intelligence live on Netlify

The web app is published as static files. Every `/api/*` request runs one Netlify Function
(`netlify/functions/api.mjs`) that talks to a Postgres database. Nothing else has to be hosted.

## What is needed

| # | What | Where it comes from | Goes into Netlify as |
|---|---|---|---|
| 1 | The site | Netlify: **Add new project > Import an existing project**, pick this GitHub repository, set **Base directory** to `deme`. Build command, publish folder and functions folder are read from `deme/netlify.toml` | — |
| 2 | A Postgres database | A free Neon project (neon.com), or Netlify's own database from the site's dashboard | `DATABASE_URL` (the **pooled** connection string). Netlify's database sets `NETLIFY_DB_URL` itself, which is read too |
| 3 | The site's address | The Netlify address or Deme's own domain, e.g. `https://intelligence.deme.com` | `PUBLIC_URL` |
| 4 | Google sign-in | Google Cloud console, in Deme's Workspace: an OAuth consent screen of type **Internal**, then an **OAuth client ID** of type *Web application* with the authorised redirect URI `<PUBLIC_URL>/api/auth/google/callback` | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_WORKSPACE_DOMAIN` (e.g. `deme.com`) |
| 5 | AI reading of spreadsheets | An Anthropic API key (console.anthropic.com) | `ANTHROPIC_API_KEY` |
| 6 | Email notices | A Resend account (resend.com) with Deme's domain verified, and an API key | `RESEND_API_KEY`, and `MAIL_FROM` such as `Deme Intelligence <intelligence@deme.com>` |
| 7 | Shopify orders | A custom app in the Shopify admin with read access to orders | `SHOPIFY_STORE`, `SHOPIFY_TOKEN`; and for instant intake, a webhook for order payment to `<PUBLIC_URL>/api/shopify/webhook` with its secret in `SHOPIFY_WEBHOOK_SECRET` |
| 8 | Meta ad spend | The ad account id and a system-user token with `ads_read` | `META_AD_ACCOUNT`, `META_TOKEN` |

Items 4 to 8 are optional. Without Google the team signs in with email and password. Without the
Anthropic key, "Bring in data" matches columns by name and the person corrects the rest by hand.
Without the mail key, notices about tasks, comments and requests show in the app only.
Without Shopify, orders come in from the Shopify export; without Meta, spend comes in from its export.
Once everyone signs in with Google, set `PASSWORD_LOGIN=off`. `docs/SECURITY.md` lists what else to
settle before customer data is held.

Environment variables are set under **Project configuration > Environment variables**. Mark the
database string, the Google secret and the Anthropic key as secret values. Redeploy after changing any.

## First run

1. Open the site. The database tables are created on the first request.
2. Create the first account. It belongs to whoever is setting the system up (the system admin),
   not to the founder. It starts with a set of work centres and workstations to adjust.
3. **Work centres**: rename, add or remove them to match Deme, and name the person in charge of
   each. Add those people under **Admin > Team** with their position; with Google sign-in on, no
   password is needed.
4. **My journey > Create the go-live plan**: pick the start date. Each position gets its dated
   tasks; the person holding it is told.
5. Everyone else signs in with their Deme Google account, picks the position they hold, and is
   confirmed by the head of that work centre (an admin confirms heads, Finance and HR). From then
   on they open on **My journey**: what to fill in next, the screen it is done on, and a
   walkthrough of how. The founder opens on the **Founder view** and enters nothing.
6. Leave `GOOGLE_WORKSPACE_DOMAIN` empty to admit only people already on the team list.

## How a change goes live

```
change on a branch ──> pull request ──> tests run (GitHub Actions) ──> Netlify builds a preview link
                                                   │
                              merge to main ───────┴──> Netlify builds and publishes production
```

- **Tests**: `.github/workflows/deme.yml` runs `npm ci`, `npm test` and `npm run build` on every
  push and pull request that touches `deme/`. In GitHub, under **Settings > Branches**, protect
  `main` and make the "Deme Intelligence / test" check required, so nothing untested can be merged.
- **Preview**: Netlify builds every pull request and posts a link on it. The preview uses the same
  environment variables unless a different value is set for the *Deploy Previews* context. Give
  previews their own `DATABASE_URL` (a Neon branch or a second project) so trying a change never
  touches live data.
- **Production**: merging to `main` publishes within a couple of minutes. Nobody uploads files.
- **Undo**: in Netlify, **Deploys**, open the last good deploy and choose **Publish deploy**. That
  restores the code at once; fix the branch afterwards.

Changes to the data model need no database migration: records are stored as JSON documents, so a
new field or record type in `shared/schema.js` is live as soon as the code is. Removing or renaming
a field that already holds data is the one case to plan: write a small script that rewrites the
old records through the API first.

## Running costs to check

Free allowances change. As of November 2026, by the providers' own pages:

- **Neon free plan**: 1 GB of storage per project and 100 compute-hours a month, with the database
  sleeping when idle. Deme's records for a first year fit well inside 1 GB. The first request after
  an idle spell takes a second or two longer.
- **Netlify**: the site, functions and previews run on the plan's monthly credit allowance. Netlify's
  own database was free to store only until July 2026, so a Neon project is the cheaper start.
- **Anthropic**: each spreadsheet read sends the column headings and five sample rows to Claude
  Haiku once. That is a fraction of a rupee per file.

## Before the team relies on it

- Use Deme's own domain and keep `PUBLIC_URL` matching it exactly (sign-in cookies and the Google
  return address depend on it).
- Turn on point-in-time restore or scheduled backups for the database (Neon keeps a short
  restore window on the free plan; lengthen it on a paid plan before go-live).
- Keep the three secrets out of the repository. `.env.example` lists every setting with no values.
- A cold function start plus a sleeping database can make the first page of the morning slow. If
  that bothers the floor, the fix is a paid database tier that does not sleep, not a code change.

## The same code as one server

`npm start` runs the identical API over a SQLite file, and the `Dockerfile` packages that for any
host with a persistent disk. Use it for development, for a demo on a laptop, or if Deme later wants
the system inside its own network.
