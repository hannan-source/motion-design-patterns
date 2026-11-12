# Security and privacy

What Deme Intelligence does to protect the business's data and people's personal data, what the
hosting does, and what remains for Deme to do as a company. Software alone does not make a
company compliant with GDPR or with India's DPDP Act; this page separates the three so nothing is
assumed.

## Whose data, and which laws

| People | What is held | Where |
|---|---|---|
| Online customers | Name and country on the order; size, measurements and notes on the slip | `shop_orders`, `slips`, parcel destination |
| Wholesale contacts | Company, contact person, email | `customers` |
| Team members | Name, work email, position | users |
| Employees | HR record, attendance, leave, salary | `employees`, `attendance`, `leaves`, `payroll_runs` |
| Tailors and masters | Who cut and stitched each piece, and when | `slips`, `bundles`, `scans` |

Deme sells to people in the UK and the EU, so UK GDPR and EU GDPR apply to those customers' data.
India's Digital Personal Data Protection Act applies to customers and staff in India. Wholesale
buyers in the US bring contract terms of their own.

## What the product does

**Who can get in**
- Sign-in with the company Google account (only the Workspace domain, verified email), or email
  and password. Passwords are stored as scrypt hashes with a salt per person. Password sign-in can
  be switched off once everyone uses Google (`PASSWORD_LOGIN=off`), which puts Google's two-step
  verification in front of every login.
- Sessions are random tokens in an HttpOnly, SameSite, Secure cookie; only their hash is stored.
  Sign-in attempts are throttled. Switching a person off ends their sessions.
- Other programs use service keys that act with one role, are stored as hashes, and can be
  switched off.

**Who can see what**
- Every request is checked on the server against the person's role, never only on the screen.
- A position picked at sign-in grants nothing until the head of that work centre, or an admin,
  confirms it. Nobody can change their own role.
- Salary is visible to HR admins only. Which master and tailor made a piece, and the trail of who
  did what, are shown only to those who run the floor and to QC. A customer's name is shown only
  to those who handle the order. An outside dye house sees its own lots and nothing else.
- A project can be limited to its work centre.

**What is kept, and for how long**
- From Shopify, only a customer's name and country are taken. Email, phone and street address are
  never requested, so they are never stored.
- **Privacy** (admins): find everything held on a customer, download it, and remove their name and
  measurements from their orders with the reason recorded. Amounts and dates stay for the accounts.
- A routine clean-up removes names and measurements from finished online orders older than a set
  number of months (`privacy.sweep`, 36 by default). Run it on a schedule.
- Every change is in the audit trail with who and when. Looking up a customer under Privacy is
  logged too.

**Against attack**
- A content security policy allows scripts only from the site itself and no inline script, so text
  that reaches a page cannot run as code. All text is escaped when drawn.
- Changes must be JSON from the same site; cross-site requests are refused. The site cannot be
  framed. Transport is HTTPS only, with HSTS.
- Uploaded files must be a photo or a PDF under 2 MB and are never served as a web page.
- Database access uses parameters throughout. The Shopify webhook is accepted only with a valid
  signature. Dependencies are two packages, checked with `npm audit` (no known vulnerabilities at
  the time of writing) and tested on every change.
- The AI used to match spreadsheet columns is sent the column headings and five sample rows with
  email addresses and phone numbers blanked, never a whole file.

## What the hosting does

| Need | Provided by | To confirm when setting up |
|---|---|---|
| Encryption in transit | Netlify (TLS on the site and functions) | Custom domain has its certificate |
| Encryption at rest | The Postgres provider | Stated in the provider's documentation for the chosen plan |
| Backups and point-in-time restore | The Postgres provider | Restore window is long enough; do one test restore |
| Where the data sits | Region chosen for the database | Choose and write down the region |
| Secrets | Netlify environment variables, marked secret | No secret is in the repository |

## What Deme must do as a company

These are decisions and documents, not code. A lawyer or privacy adviser should review them.

1. **Privacy notice** on the website saying what is collected, why, how long it is kept and who it
   is shared with, including the manufacturing step (measurements go to the factory).
2. **Contracts with processors** (data processing agreements): Shopify, the hosting and database
   providers, Google Workspace, the email service, the AI provider, Meta. Where data leaves the UK
   or EU, the transfer terms each provider offers.
3. **A record of processing**: the table at the top of this page, kept current, with the lawful
   basis for each (contract for orders, legal obligation for payroll, legitimate interest for
   floor timing, with staff told about it).
4. **A retention schedule**: how long orders, HR records and floor timing are kept. The clean-up
   above enforces the customer part once the number is chosen.
5. **A named person** who answers customer requests within the legal time limit, using the Privacy
   screen, and a short written procedure for a data breach (who is told, within what time).
6. **Staff**: tell tailors and masters that scans record their times and what that is used for.
7. **Access hygiene**: Google two-step verification required for all staff; leavers switched off
   the same day; the admin role held by few people.

## Not built yet

- Two-step sign-in for people who use a password (use Google sign-in instead).
- A log of who viewed a record (changes are logged; views are not).
- Automatic scheduling of the clean-up (it runs when an admin or a scheduled job calls it).
- Encryption of individual fields inside the database beyond what the provider does.
- An independent penetration test. Arrange one before customer data at volume is held.
