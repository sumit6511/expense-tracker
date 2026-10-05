# Expense Tracker

A fast, private expense tracker built for Nepal: **NPR by default, any currency per account,
Bikram Sambat dates and budget months, lakh/crore number formatting, and daily Nepal Rastra
Bank exchange rates.** Works on phones and desktops and installs like an app (PWA).

![Dashboard](docs/screenshots/dashboard.png)

The research and design behind it are in [`docs/PLAN.md`](docs/PLAN.md). This repository contains
**all four phases** of that plan: foundations and the MVP, automation and depth, collaboration and
intelligence, and integrations.

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
- **A getting-started tour** the first time someone opens the app: a spotlight on each main part
  (on desktop or phone), ending with their first expense. It can be taken again from the profile
  menu, the *More* sheet on phones, or the command palette.

**Automation and depth (Phase 2):**

- **Rules** categorize, rename payees, tag and split transactions as they're added or imported.
  Fix a category once and choose "Always do this" to turn it into a rule; preview what a rule
  matches and apply it to past transactions. Imported and unmatched items land in a **Review** inbox.
- **Recurring transactions and bills** (weekly to yearly, Bikram Sambat months, "last day of the
  month"): recorded automatically or with a reminder, and shown as "Coming up" on the dashboard.
  Repeating payments in your history are suggested for you.
- **Rollover budgets** (carry leftovers, or overspending too), an **overall monthly limit**, and
  **savings goals** linked to an account, a budget fund, or tracked by hand.
- **Reconcile** accounts against a statement, mark transactions pending or cleared, see each
  transaction's **edit history**, and attach **receipt photos or PDFs** (resized on the phone).
- **More reports:** net worth over time, spending by payee or tag, period comparison and a
  calendar heatmap. Categories like "Transfers to savings" can be left out of reports.
- **More ways in:** OFX/QFX, QIF and CAMT.053 statements, **pasted bank and wallet SMS alerts**,
  and **offline quick add** (saved on the device and sent when you're back online).
- **Notifications** under the bell for bills coming due, budgets at 90% or over, automatic
  entries and goals reached, optionally **by email** too.
- **Two-step sign-in** with an authenticator app (plus backup codes), and **passkeys** (Face ID,
  fingerprint, security keys) to sign in without a password.

| Quick add | Budgets | Cash flow | Phone |
|---|---|---|---|
| ![Quick add](docs/screenshots/quick-add.png) | ![Budgets](docs/screenshots/budgets.png) | ![Cash flow](docs/screenshots/cash-flow.png) | ![Mobile quick add](docs/screenshots/mobile-quick-add.png) |

**Sharing and intelligence (Phase 3):**

- **Share a workspace** with your household: invite people by email as admin, editor or viewer.
  Every transaction shows who added it, and the list can be filtered by person. An account can be
  shared with everyone or kept **"Only me"**: a private account, its balance and its transactions
  are left out of everything other members see (lists, totals, reports, budgets, exports).
- **Split groups** for trips, flatmates and dinners: split expenses equally, by exact amounts,
  percentages or shares, see who owes whom, and settle up in the fewest payments. People don't need
  an account. What you paid can be recorded in your own accounts too, so your spending equals your
  share once everyone has settled.
- **Envelope budgeting** (optional, per workspace): give every rupee a job. "Ready to assign" shows
  money not yet budgeted, leftovers carry over, and overspending is covered by moving money.
- **Insights** found in your own history (no AI): subscriptions and bills detected automatically,
  price changes, unusually high spending, categories well under their usual, good months and
  budgets kept. A **cash-flow forecast** projects your balance 30–90 days ahead from scheduled
  items and your everyday spending, with a likely range.
- **Push notifications** on phones and computers, even with the app closed.
- **Optional AI helpers** (Claude API, off unless the server has a key *and* a workspace admin turns
  them on): describe a transaction in a sentence, scan a receipt photo or PDF, suggest categories in
  the review inbox, read PDF bank statements, and **ask questions about your money** ("how much did
  we spend eating out last month?"). Quick add understands sentences like
  "lunch 450 at Bhojan Griha yesterday via eSewa" without AI too.
- **Bring your history** from YNAB, Actual Budget, Mint or Splitwise: their CSV exports are
  recognised and read without matching columns.
- **Monthly report** laid out for paper, saved as a **PDF** from the browser.
- **Nepali interface** (नेपाली), chosen per person, for the everyday screens: Devanagari digits,
  रु. and Nepali month names. Quick add understands आज, हिजो and अस्ति too.

| Insights & forecast | Split group | Monthly report | नेपाली |
|---|---|---|---|
| ![Insights](docs/screenshots/insights.png) | ![Split group](docs/screenshots/split-group.png) | ![Monthly report](docs/screenshots/monthly-report.png) | ![Nepali on a phone](docs/screenshots/mobile-nepali.png) |

**Integrations and phones (Phase 4):**

- **Email in:** each workspace gets a private address. Forward a receipt (with "lunch 450 eSewa" as
  the subject if you like), or have your bank's alert emails sent there, and they become
  transactions waiting in Review. Only mail from members, and from senders you trust (your bank's
  alert address), is read; the rest is listed so you can trust it with one click.
- **Android app** (optional, [`apps/mobile`](apps/mobile/README.md)): the same app in a native shell
  that can **read bank and wallet alert SMS** on the phone, so they're imported without copying.
- **Share receipts to the app:** on Android, share a photo or PDF from the gallery, WhatsApp or a
  banking app to the installed app and it opens a new expense with the receipt attached.
- **Investments:** shares (NEPSE or elsewhere), fund units and gold held in an account, valued at
  the latest prices (paste them from a market website), with gains on cost. Their value counts in
  the account and in net worth.
- **Bank sync** through [SimpleFIN Bridge](https://www.simplefin.org) for accounts at US banks:
  new transactions arrive in Review and ones you already entered are matched. No provider covers
  banks in Nepal yet, which is why email in and SMS reading exist.
- **Access tokens and a public API** for your own scripts and spreadsheets (read-only or
  read-write, one workspace each), documented at `/api/docs`.
- **Webhooks:** each new, changed or deleted transaction is sent to your URL as it happens,
  signed the [Standard Webhooks](https://www.standardwebhooks.com) way, with retries and a log.

| Integrations | Investments |
|---|---|
| ![Email in, bank sync, tokens and webhooks](docs/screenshots/integrations.png) | ![An investment account with holdings](docs/screenshots/investments.png) |

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
| `SMTP_URL` | Optional SMTP server, e.g. `smtps://user:pass@smtp.example.com:465`. Enables “Forgot password?” emails, invitations by email and email notifications (people opt in under Settings → Notifications). |
| `MAIL_FROM` | Sender for those emails, e.g. `Expense Tracker <money@example.com>`. |
| `WEB_PUSH` | Push notifications to browsers and installed apps (default `true`). The server makes its VAPID keys on first start; set `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` to manage them yourself. |
| `ANTHROPIC_API_KEY` | Optional. Enables the AI helpers; each workspace's owner or admin still has to turn them on. |
| `AI_MODEL` | The Claude model the helpers use (default `claude-opus-5-5`; `claude-haiku-4-5` costs less). |
| `AI_DAILY_LIMIT` | AI requests allowed per workspace per day (default `200`). |
| `EMAIL_IN_ADDRESS` | Turns on email in: the address pattern with `{token}` for each workspace's secret, e.g. `money+{token}@gmail.com`. See below. |
| `EMAIL_IN_IMAP_URL` | A mailbox to read email in from, e.g. `imaps://money%40gmail.com:app-password@imap.gmail.com:993`. |
| `EMAIL_IN_SECRET` | Or: the secret a mail service uses to post raw messages to `/api/inbound/email`. |
| `BANK_SYNC` | Let owners and admins connect SimpleFIN bank sync (default `true`). |
| `WEBHOOK_ALLOW_PRIVATE` | Let webhooks reach your own network, e.g. Home Assistant on `192.168.x.x` (default `false`). |
| `ENCRYPTION_KEY` | Key for stored secrets (webhook keys, bank connections). Defaults to one derived from `AUTH_SECRET`; set it if you might change `AUTH_SECRET`. |
| `TRUST_PROXY` | Which reverse proxies' `X-Forwarded-For` to believe when working out a visitor's address (for sign-in rate limits and the signed-in devices list). Default `loopback,private`: a proxy on the same machine or Docker network. Use `none`, or list your proxy's addresses or CIDR ranges. |
| `POSTGRES_PASSWORD` | Database password used by compose. |

Put a TLS-terminating reverse proxy (Caddy, nginx, Cloudflare Tunnel) in front for internet
access. If the proxy runs on another machine, add its address to `TRUST_PROXY`; otherwise every
visitor looks like the proxy and shares one sign-in rate limit. Passkeys are tied to the host name in `PUBLIC_URL`, so set it before people add them, and
browsers only allow push notifications on https (or `localhost`).

### If it doesn't start

Compose reads `.env` in this folder (the same file `pnpm dev` uses), so check it first:

- **`failed to read .env: line N: unexpected character`**: every line must be `NAME=value` or a
  `# comment`. Commands pasted from elsewhere (e.g. SimpleFIN's `curl … base64 --decode`) don't
  belong there; bank sync setup tokens are pasted in the app, under Settings → Integrations.
- **The app keeps restarting**, and `docker compose logs app` says `AUTH_SECRET is the example
  value`: set a real one, `AUTH_SECRET=` followed by the output of `openssl rand -base64 32`.
- **Signing up or in fails with "Invalid origin"**: `PUBLIC_URL` must be the address you open,
  e.g. `http://localhost:3000` for Docker (`http://localhost:5173` is only for `pnpm dev`).

### Forgotten passwords

With `SMTP_URL` set, “Forgot password?” on the sign-in page emails a link that works for an hour;
choosing a new password signs out every other device. Without email, reset a password from the
server; it prints a temporary password and signs the person out everywhere:

```bash
docker compose exec app node dist/reset-password.js person@example.com
# in development: pnpm --filter @et/api reset-password person@example.com
```

### Email in

Each workspace's address is `EMAIL_IN_ADDRESS` with its secret token in place of `{token}`. The
simplest setup is one mailbox you make for this, read over IMAP:

1. Create a mailbox, e.g. a new Gmail account `money@gmail.com`, turn on two-step verification and
   make an *app password* for it.
2. Set `EMAIL_IN_ADDRESS=money+{token}@gmail.com` and
   `EMAIL_IN_IMAP_URL=imaps://money%40gmail.com:<app password>@imap.gmail.com:993`.
3. Settings → Integrations shows each workspace its address (`money+et…@gmail.com`; Gmail delivers
   anything after the `+` to the same mailbox). The server checks the mailbox every minute.

To have bank alerts arrive by themselves, add a filter in your own email that forwards your
bank's alert emails to that address, and add the bank's sender under *Trusted senders* with the
account its alerts are for. (Gmail first sends a confirmation to the address; its code is in the
subject, which shows under *Recent emails*.)

If you have a domain, a mail service can instead post each raw message to
`POST /api/inbound/email` with `Authorization: Bearer <EMAIL_IN_SECRET>` (and `?to=` the
recipient). With Cloudflare Email Routing, a catch-all rule to this Email Worker does it:

```js
export default {
  async email(message, env) {
    await fetch(`${env.URL}/api/inbound/email?to=${encodeURIComponent(message.to)}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${env.SECRET}`, 'content-type': 'message/rfc822' },
      body: message.raw,
    });
  },
};
```

with `EMAIL_IN_ADDRESS={token}@in.example.com`.

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
apps/mobile      Android app: Capacitor shell around the web app, plus an SMS-reading plugin
packages/shared  Money, currencies, Bikram Sambat calendar, budget periods, import parsing, Zod schemas
```

A few decisions worth knowing:

- **Money is integers** (paisa for NPR), never floating point. Conversions and splits use exact
  arithmetic, and a database constraint guarantees a transaction's split lines add up to its total.
- **Dates are stored in AD**; Bikram Sambat is computed from a month-length table (1970–2090 BS,
  cross-checked against two independent sources). Changing the calendar never touches your data.
- **Every query is scoped to a workspace**, and non-members get "not found". Writes need a same-origin
  request (CSRF protection), passwords use Argon2id, and sign-in is rate-limited.
- **Receipts are stored in PostgreSQL** (at most 5 MB each, 1 GB per workspace), so the nightly
  database dump backs them up too and there's no separate file store to run. Uploads are checked
  by their content, not their name, and served with a sandboxing Content-Security-Policy.
- **Background jobs** (pg-boss, stored in PostgreSQL) record recurring items, check for
  notifications every 15 minutes, send push notifications, refresh exchange rates and empty the trash.
- **Private accounts are enforced in one place:** every request carries the list of accounts hidden
  from that person, and lookups take that scope instead of a bare workspace id, so a new query
  can't forget it. Background jobs work out notifications per person in the same way.
- **Insights and the forecast are plain statistics** (averages, standard deviations, detected
  rhythms), not AI, so they're predictable, private and free. The AI helpers sit behind an
  interface with a scripted fake for tests; only what a helper needs is sent, and questions are
  answered through read-only report tools limited to what the asker can see.
- **Push subscriptions** are only accepted for the major browsers' push services, and webhook and
  bank-sync addresses are checked after DNS at connect time, so the server can't be made to send
  requests into its own network.
- **Webhooks come from the database:** triggers on transactions, their splits and tags fill an
  outbox, so every way of changing a transaction (the app, the API, imports, rules, recurring
  items) is covered, and only committed changes are sent.
- **Secrets the server must read back** (webhook signing keys, bank connections) are encrypted with
  AES-256-GCM; access tokens and invitation links are stored only as hashes.
- Reports convert each day's totals at that day's exchange rate, and tell you when a rate is missing
  instead of silently guessing.

## What's next

All four phases of the plan are built. Natural next steps: a bank-sync provider for Nepal if one
appears, a NEPSE price feed for investments, more of the interface in Nepali, and an iOS build of
the native app. See [`docs/PLAN.md`](docs/PLAN.md#124-implementation-notes-phase-4) for what each
phase includes and its known limits.
