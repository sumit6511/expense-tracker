# Expense Tracker

A fast, private expense tracker built for Nepal: **NPR by default, any currency per account,
Bikram Sambat dates and budget months, lakh/crore number formatting, and daily Nepal Rastra
Bank exchange rates.** Works on phones and desktops and installs like an app (PWA).

![Dashboard](docs/screenshots/dashboard.png)

The research and design behind it are in [`docs/PLAN.md`](docs/PLAN.md). This repository contains
**Phase 0 (foundations) and Phase 1 (MVP)** of that plan.

## What it does

- **Log spending in seconds.** Press <kbd>N</kbd> (or the ＋ button on a phone), type an amount
  (`1,500`, `120+45`, or Devanagari digits), tap one of your frequent categories and save. Known
  payees fill in their usual category. <kbd>I</kbd> adds income, <kbd>T</kbd> a transfer.
- **Accounts:** cash, bank, eSewa/Khalti/IME Pay, credit cards, loans, each in its own currency.
  Transfers between accounts (including across currencies) never count as spending.
- **Split transactions** across categories, **tags** (e.g. `#dashain`), **refunds** that reduce
  spending, a **trash** with undo, and **bulk edit** (categorize, tag, review, delete).
- **Budgets by Bikram Sambat month** (or Gregorian months starting on any day, for pay-day
  budgeting), with "copy last month" and "use my 3-month average".
- **Dashboard:** what's left to spend, a daily allowance, a spending-pace chart, and items that
  need attention.
- **Reports:** spending by category, cash flow, per-category trends and budget vs actual, each
  with a table view. Ranges include this BS month, this BS year and the **Nepal fiscal year**.
- **Import bank and wallet statements** (Excel `.xlsx` or CSV): columns and date formats
  (including BS dates like `2083-06-14`) are detected, duplicates are flagged, categories are
  suggested, and a whole import can be undone.
- **Your data is yours:** CSV export (opens in Excel, Devanagari intact), full JSON backup, and
  restore into a new workspace.
- **Multi-currency:** amounts are converted to your main currency at each day's rate: NRB rates
  (fetched automatically), the INR peg (1 INR = 1.60 NPR), or rates you enter yourself.
- Dark mode, keyboard shortcuts (<kbd>?</kbd>), a command palette (<kbd>Ctrl/⌘ K</kbd>), and
  accessible, mobile-first UI.

| Quick add | Budgets | Cash flow | Phone |
|---|---|---|---|
| ![Quick add](docs/screenshots/quick-add.png) | ![Budgets](docs/screenshots/budgets.png) | ![Cash flow](docs/screenshots/cash-flow.png) | ![Mobile quick add](docs/screenshots/mobile-quick-add.png) |

## Run it yourself (Docker)

```bash
git clone <this repo> expense-tracker && cd expense-tracker
AUTH_SECRET=$(openssl rand -base64 32) docker compose up -d
```

Open <http://localhost:3000> and create your account. Compose starts PostgreSQL, the app
(API + web on one port; migrations run automatically), and a nightly database backup that keeps
14 days of dumps in the `backups` volume.

Useful settings (environment variables, see [`.env.example`](.env.example)):

| Variable | Purpose |
|---|---|
| `AUTH_SECRET` | **Required.** Random secret for signing sessions. |
| `PUBLIC_URL` | The URL people open, e.g. `https://money.example.com` (secure cookies are used for https). |
| `ALLOW_SIGNUP` | Set to `false` once your own account exists, to close sign-ups. |
| `FX_NRB_ENABLED` | Fetch daily rates from Nepal Rastra Bank (default `true`). |
| `POSTGRES_PASSWORD` | Database password used by compose. |

Put a TLS-terminating reverse proxy (Caddy, nginx, Cloudflare Tunnel) in front for internet
access.

## Develop

Requirements: Node.js 22+, pnpm 10 (`corepack enable`), PostgreSQL 16+.

```bash
pnpm install
cp .env.example .env            # then set AUTH_SECRET
docker compose up -d db         # or use any local PostgreSQL (see DATABASE_URL)
pnpm db:migrate
pnpm db:seed                    # optional: demo user demo@example.com / demo-password-123
pnpm dev                        # API on :3000, web on http://localhost:5173
```

| Command | What it does |
|---|---|
| `pnpm dev` | API (tsx watch) and web (Vite) with hot reload |
| `pnpm check` | Lint + typecheck + all unit and integration tests |
| `pnpm test:unit` | Domain logic: money math, Bikram Sambat calendar, periods, import parsing |
| `pnpm test:integration` | API tests against a throwaway PostgreSQL database |
| `pnpm build` | Production bundles (`apps/api/dist`, `apps/web/dist`) |
| `pnpm e2e` | Playwright tests against the production build (needs a database, see below) |
| `pnpm db:generate` | Create a migration after changing `apps/api/src/db/schema.ts` |

Integration tests create and drop their own database; point `TEST_DATABASE_ADMIN_URL` at a server
where your user may `CREATE DATABASE` (default `postgresql://et:et@localhost:5432/postgres`).
End-to-end tests use `E2E_DATABASE_URL` (default `…/expense_tracker_e2e`, which must exist).

API documentation (OpenAPI 3.1) is served at `/api/docs` when the app is running.

## How it's built

```
apps/api         Hono API on Node.js · Drizzle ORM · PostgreSQL · Better Auth · pg-boss jobs
apps/web         React 19 PWA · Vite · TanStack Router & Query · Tailwind CSS v4 · Radix UI · Recharts
packages/shared  Money, currencies, Bikram Sambat calendar, budget periods, import parsing, Zod schemas
```

A few decisions worth knowing:

- **Money is integers** (paisa for NPR), never floating point. Conversions and splits use exact
  arithmetic, and a database constraint guarantees a transaction's split lines add up to its total.
- **Dates are stored in AD**; Bikram Sambat is computed from a month-length table (1970–2090 BS,
  cross-checked against two independent sources). Changing the calendar never touches your data.
- **Every query is scoped to a workspace**, and non-members get "not found". Writes need a same-origin
  request (CSRF protection), passwords use Argon2id, and sign-in is rate-limited.
- Reports convert each day's totals at that day's exchange rate, and tell you when a rate is missing
  instead of silently guessing.

## What's next

Phase 2 of the plan adds rules for automatic categorization, recurring bills and reminders, a
"needs review" inbox, rollover budgets and goals, reconciliation, attachments, pasting bank SMS
alerts, offline quick add, and two-factor sign-in. See [`docs/PLAN.md`](docs/PLAN.md#12-roadmap--milestones).
