# Expense Tracker: Research & Product/Technical Plan

> Status: **Approved on 30 Sep 2026** with the decisions in [§0.1](#01-decisions-approved-30-sep-2026). **Phases 0 to 3 are implemented** (see [§12.1](#121-implementation-notes-phase-0--1), [§12.2](#122-implementation-notes-phase-2) and [§12.3](#123-implementation-notes-phase-3)); Phase 4 is next.
> Research date: September 2026.

---

## 0. TL;DR

- **What we're building:** a fast, low-friction, privacy-respecting personal & household expense tracker with budgets, reports, recurring bills, rules-based auto-categorization, multi-currency, and data import/export. Later phases add shared-expense splitting, receipt scanning and bank sync.
- **The main lesson from the research:** people stop using expense trackers because of **friction** (too much manual entry and categorizing), **complexity** (a methodology to learn before logging anything), **cost and upsells**, **privacy anxiety** (handing over bank credentials), and **shame-driven UI** (the app only ever tells you that you failed). Every decision below is aimed at one of these.
- **Recommended stack:** TypeScript end-to-end. React + Vite PWA frontend, Hono API on Node.js, PostgreSQL with Drizzle ORM, Better Auth, pg-boss for background jobs. A pnpm monorepo that runs with one `docker compose up`.
- **Delivery:** in phases. **Phase 1 (MVP)** is a complete, usable tracker on its own. Later phases add automation, collaboration and AI.
- **Decisions:** answered. See §0.1 below.

### 0.1 Decisions (approved 30 Sep 2026)

| Question | Decision |
|---|---|
| Region / currency | **Nepal. Base currency NPR**, with USD, INR and any other ISO currency available per account; the base currency can be changed in settings |
| Audience | Personal first; household sharing in Phase 3 (the data model is workspace-based from day one) |
| Platform | Responsive web app, installable as a PWA; native wrapper later |
| Hosting | Self-hostable with Docker; deployable to any cloud |
| Budget style | Simple monthly category budgets; zero-based mode opt-in later |
| AI | Opt-in, Phase 3 |
| MVP scope | Phase 0 + Phase 1 as listed in §12 |
| Branding | Neutral placeholder theme; app name configurable |
| Stack | As recommended in §5.3 |

**Nepal localization.** These change the design and are part of the MVP. Details in [§4.6](#46-nepal-localization).
- **Bikram Sambat (BS) calendar:** dates are shown in BS or AD (user setting, BS by default), with a BS date picker. **Budget months follow BS months** when BS is selected, since salaries are commonly paid per BS month. Dates are still stored as AD, and BS is computed from them.
- **Nepal fiscal year** (1 Shrawan to the end of Ashadh) as a report period.
- **Lakh/crore number grouping** (Rs. 1,23,45,678.90) by default, with international grouping as an option.
- **Exchange rates from Nepal Rastra Bank (NRB)**, which publishes daily NPR rates (ECB/Frankfurter does not cover NPR). INR is pegged at 1 INR = 1.60 NPR. Rates can be entered manually as a fallback, and overridden per transaction.
- **Local presets:** e-wallet accounts (eSewa, Khalti, IME Pay); categories such as festivals (Dashain/Tihar), remittance income, mobile top-up and data, electricity (NEA), and LPG gas.
- **Import:** Nepali banks and wallets mostly export **Excel**, so **XLSX import is in the MVP** alongside CSV.
- **No open-banking API exists in Nepal.** Automatic capture will come from statement import, **pasting bank SMS alerts** into the app (P2; works on the web), and Android SMS reading (P4, native only).

---

## 1. Research: the existing landscape

### 1.1 Products analysed

| Product | Model | Budget style | Strengths | Weaknesses / complaints |
|---|---|---|---|---|
| **YNAB** | Paid, ~$109/yr | Zero-based envelope ("give every dollar a job") | Changes behaviour; strong method and teaching; bank sync | Steep learning curve; price; one currency per budget |
| **Monarch Money** | Paid, ~$99/yr | Flexible, per-category budgets | Clean dashboard; **unlimited household collaborators** with per-person attribution; recurring/subscription detection; cash-flow forecast; rules engine | Paid only; mostly US/Canada bank coverage |
| **Copilot Money** | Paid, ~$95/yr | Category budgets + AI | Polished and fast; categorization learns from you; "to review" inbox | Apple-first; paid |
| **Actual Budget** | Free, open source, self-hosted | Envelope (plus a simpler tracking mode) | **Local-first** (very fast, works offline); optional end-to-end-encrypted sync; strong rules and schedules; keyboard-driven; full export | Self-hosting setup; envelope learning curve; weak multi-currency |
| **Firefly III** | Free, open source, self-hosted | Budgets with limits | Powerful rules engine; strong multi-currency; full REST API; double-entry accuracy | Accounting jargon (asset/expense/revenue accounts) confuses non-accountants; web only |
| **Cashew** | Free, open source (Flutter) | Per-period budgets | Very fast manual entry; multi-currency; offline; goals | No bank sync; mobile-first |
| **Maybe → Sure** | Open source (AGPLv3), community fork | Net worth focused | Good net-worth and investment view | Original company shut down (archived July 2025); community-maintained |
| **Splitwise / Tricount / Settle Up** | Freemium / free | n/a (shared expenses) | Group splits, debt simplification, settle-up, multi-currency | Splitwise now limits free-tier usage; not a personal budget tool |
| **Expensify** | Paid (business) | Expense reports | Receipt capture by photo, email or SMS (SmartScan) | Built for business reimbursement, not personal budgeting |
| **Axio (formerly Walnut), India** | Free | Automatic tracking | Reads bank and UPI SMS on Android for fully automatic tracking | Privacy concerns; Android only; product pivoted to credit/BNPL |
| **Mint** | *Shut down in 2024* | — | Was free and automatic | Ads and upsells; poor categorization; its shutdown stranded millions of users (this is why data export matters) |

### 1.2 Why people abandon expense trackers

Reviews, Reddit threads and write-ups by app makers keep citing the same causes. Most apps are commonly said to be abandoned within the first month.

1. **Friction.** Too many steps to log an expense; categorizing ambiguous transactions; renaming merchants; fixing bad auto-categorization.
2. **Complexity up front.** Learning a methodology (YNAB) or a taxonomy (Mint had about 52 categories) before the first entry.
3. **Emotional avoidance ("ostrich effect").** The app is mostly red numbers and "over budget!" alerts, so people stop opening it.
4. **Cost and upsell fatigue.** Subscription price increases, ads, and features locked behind paywalls.
5. **Privacy and trust.** Discomfort handing bank credentials to a startup; fear of data breaches or the company shutting down (Mint, Maybe).
6. **Data without guidance.** The app shows what happened but not what to do next.

### 1.3 What we borrow, and what we avoid

**Borrow:**
- *Copilot:* a **"Needs review" inbox** for new or auto-created transactions (one tap to confirm), and categorization that learns from your edits.
- *Actual:* **"Create a rule from this edit"** prompts; schedules; local-first speed; keyboard-first power use; full export.
- *Monarch:* per-person attribution in households; recurring/subscription detection; cash-flow forecast; flexible budgets.
- *Firefly III:* a powerful rules engine; first-class multi-currency; a complete, documented REST API.
- *YNAB:* an *optional* zero-based mode for people who want it; good onboarding.
- *Cashew:* entry in two or three taps; offline use.
- *Splitwise/Tricount:* split methods (equal, exact, percentage, shares) and debt simplification for settling up.
- *Expensify:* receipt capture from a photo.

**Avoid:**
- Accounting jargon; forcing one budgeting method on everyone; 50+ default categories.
- Storing bank credentials; ads; paywalls on core features.
- UI where every expense is red and the dashboard mostly scolds.
- Data lock-in. Full export and import has to be a core feature, not an afterthought.

---

## 2. Product vision & principles

**Vision:** *"Know where your money goes in seconds a day, without spreadsheets, shame, or giving up your privacy."*

**Design principles (used to settle trade-offs):**

1. **Speed of capture beats everything.** Logging a cash expense takes 3 taps or less and under 5 seconds. The app should never feel slow.
2. **Automate the boring part, keep the human in control.** Rules, learned suggestions and recurring schedules do the work; the user confirms in a review inbox.
3. **Progressive disclosure.** Simple by default (accounts, transactions, categories, a monthly budget). Power features (rules, splits, multi-currency, zero-based mode) are there when you look for them.
4. **Encouraging, not judgemental.** Neutral colours for normal spending; warnings only when they're actionable; show wins as well as problems.
5. **Your data is yours.** Full export (CSV and JSON), import from other apps, self-hostable, no ads, no selling data.
6. **Correct money math.** Integer minor units, no floating-point errors, and every balance can be traced back to its transactions.

**Target users (personas):**
- **Solo tracker:** wants to know where the money went each month. Mostly manual entry plus CSV import.
- **Household:** a couple or family sharing a budget, each logging expenses, with visibility into who spent what.
- **Traveller / multi-currency user:** spends in several currencies and wants totals in a home currency.
- **Friend group / roommates** (Phase 3): shared bills and trips with settle-up.

---

## 3. Feature set & phasing

Legend: **P1** = MVP (usable end to end), **P2** = automation and depth, **P3** = collaboration and AI, **P4** = integrations and native apps.

### 3.1 Core ledger

| Feature | Phase | Notes |
|---|---|---|
| Accounts: cash, checking, savings, credit card, e-wallet, loan, investment (balance only), other | P1 | Opening balance; archive; include/exclude from net worth and budget; icon and colour |
| Transactions: create, edit, delete (soft delete with undo) | P1 | Date, amount, account, payee, category, notes, tags |
| **Quick add** (mobile floating button, desktop `N` shortcut) | P1 | Amount keypad first → recent/frequent category grid → save. Account and date default sensibly |
| Transfers between accounts (including credit card payments) | P1 | Linked pair of transactions; excluded from income and spending |
| **Split transactions** (one payment across several categories) | P1 | e.g. a supermarket bill split into groceries and household |
| Refunds (reduce spending instead of counting as income) | P1 | A positive amount in an expense category |
| Search, filters, saved views | P1 | Text, date range, account, category, payee, amount range, tags, status |
| Bulk edit (select many → categorize, tag, move, delete) | P1 | |
| Payee management (rename, merge, default category) | P1 | |
| Categories: two levels (group → category), income and expense | P1 | ~15 starter categories (editable), not 50 |
| Tags (cross-cutting, e.g. `#vacation-2026`, `#tax-deductible`) | P1 | |
| Transaction status: pending / cleared / reconciled | P2 | |
| **Account reconciliation** flow | P2 | Enter the statement balance → tick transactions off → lock |
| Attachments (receipt photos, PDFs) | P2 | |
| Audit history per transaction | P2 | |
| "Exclude from reports" flag (e.g. reimbursable work expenses) | P2 | |

### 3.2 Budgets & goals

| Feature | Phase | Notes |
|---|---|---|
| Monthly per-category budgets with progress bars | P1 | Budgeted / spent / remaining |
| **Custom month start day** (e.g. payday on the 25th) | P1 | Rarely offered, and very useful |
| "Left to spend" and "safe to spend per day" headline numbers | P1 | |
| Budget helpers: copy last month, use 3-month average | P1 | |
| Rollover per category (none / surplus only / surplus and deficit) | P2 | |
| Overall monthly spending cap | P2 | For people who don't want per-category budgets |
| **Zero-based (envelope) mode**, opt-in per workspace | P3 | YNAB/Actual-style "ready to assign" |
| Savings goals (target amount and date, linked account or manual contributions, projected completion) | P2 | |
| Budget alerts (80% and 100%), weekly digest | P2 | Opt-in; tone is informative, not alarming |

### 3.3 Automation (fighting friction)

| Feature | Phase | Notes |
|---|---|---|
| **Learned category suggestions** from your own history (payee → most likely category) | P1 | Deterministic and local; no AI needed |
| **Rules engine** (conditions → actions) | P2 | Conditions: payee/description contains, equals or matches a regex; amount range; account; day of month. Actions: set category, rename payee, add tag, split by %, mark as transfer, set notes. Ordered, with "stop processing" |
| "Create a rule from this edit?" prompt | P2 | Shown after the same manual fix is made twice |
| **Recurring transactions / scheduled bills** (RFC 5545 RRULE) | P2 | Auto-post or remind; upcoming-bills calendar; match imported transactions to schedules |
| **Recurring and subscription detection** from history | P3 | "Looks like Netflix bills monthly, around $15.49. Track it?" Also flags price increases |
| **"Needs review" inbox** | P2 | Imported, auto-posted or AI-suggested transactions wait here for a one-tap confirmation |

### 3.4 Import / export & data portability

| Feature | Phase | Notes |
|---|---|---|
| **CSV import wizard**: upload → map columns (auto-detected) → preview → confirm | P1 | Saved mappings per bank; date and number format detection; handles debit/credit in separate columns |
| **Duplicate detection** on import | P1 | External ID when present, otherwise fuzzy match (same account, amount, date ±3 days, similar payee) |
| **Undo an import** (revert a whole batch) | P1 | |
| CSV export (filtered view or everything) | P1 | |
| Full JSON backup and restore (entire workspace) | P1 | Guards against lock-in |
| **XLSX (Excel) import** through the same wizard | P1 | Most Nepali banks and wallets export Excel. Files are parsed in the browser and only the mapped rows are sent |
| **Paste a bank SMS alert** → parsed transaction | P2 | Templates for common Nepali bank and wallet alert formats; works on the web |
| OFX / QFX / QIF / CAMT.053 import | P2 | Standard bank statement formats |
| Import from other apps (YNAB, Actual, Mint CSV, Splitwise) | P3 | Presets on top of the CSV importer |
| PDF bank-statement import (AI-assisted extraction) | P3 | Useful where banks only give PDFs |
| PDF monthly report export | P3 | |

### 3.5 Reports & insights

| Report | Phase | Visual |
|---|---|---|
| Dashboard: month-to-date spend vs budget, left to spend, cash flow, upcoming bills, top categories, recent transactions, account balances | P1 | Cards, bars, sparklines |
| Spending by category, drilling down to the transactions | P1 | Donut or treemap, ranked bars |
| Income vs expense over time (cash flow) | P1 | Grouped bars and a net line |
| Spending trends by category over 6 or 12 months | P1 | Stacked bars / lines |
| Budget vs actual | P1 | Bullet bars |
| Net worth over time (assets − liabilities) | P2 | Area chart |
| Spending by payee/merchant; by tag | P2 | Ranked bars |
| Period comparison (this month vs last month or the same month last year) | P2 | Delta table |
| Calendar heat-map of daily spending | P2 | |
| Cash-flow forecast (balance projected from schedules) | P3 | Line with confidence band |
| **Insights feed** (deterministic first): unusual spend in a category (above the trailing mean + 2σ), subscription price rises, positive streaks ("Dining is 20% under last month") | P3 | |

### 3.6 Collaboration & shared expenses

| Feature | Phase | Notes |
|---|---|---|
| **Workspaces** (a personal one plus shared "household" ones) | P1 (data model), P3 (sharing UI) | Everything is scoped to a workspace from day one, so sharing later needs no migration |
| Invite members with roles: owner / admin / editor / viewer | P3 | "Created by" shown on each transaction |
| Personal / shared visibility per account | P3 | Like Monarch's shared views |
| **Split groups** (trips, roommates): equal, exact, percentage or share splits; balances; **debt simplification**; settle up; members who aren't users (just a name) | P3 | Optionally link your share to your personal ledger |

### 3.7 AI features (optional; off by default; clearly disclosed)

| Feature | Phase | Notes |
|---|---|---|
| **Receipt scan**: photo → merchant, date, total, tax, currency, line items → pre-filled transaction | P3 | Vision LLM with structured output, validated with Zod; the user always confirms |
| Natural-language quick add ("lunch 12.50 yesterday on amex") | P3 | A deterministic parser covers common patterns; LLM only as a fallback |
| Category suggestion fallback for payees never seen before | P3 | Only when rules and history don't match |
| "Ask your money" (e.g. "How much did we spend on takeout this year?") | P3 | The LLM maps the question to our **typed report API**. It never writes raw SQL |

Provider: behind an interface so it can be swapped or turned off. Default recommendation is the Claude API (`claude-haiku-4-5` for cheap extraction and categorization; a larger model only where accuracy needs it). Only the minimum data needed is sent, never whole ledgers.

### 3.8 Bank connectivity (region-dependent, P4)

Bank sync is the feature people most want and the most expensive and regulated one to run, so it comes **last** and sits behind a provider interface. Coverage differs by region:

| Region | Options (as of Sep 2026) |
|---|---|
| US | **SimpleFIN Bridge** (~$15/yr, read-only, popular with self-hosted tools), **Plaid** (free sandbox; limited free production; paid after that), Teller |
| EU / UK | **Enable Banking** (free "restricted production" for your own accounts). *GoCardless Bank Account Data (formerly Nordigen) stopped accepting new sign-ups in July 2025.* |
| India | The Account Aggregator framework needs a regulated FIU licence (not practical for a personal app). The practical routes are **SMS parsing (Android native only)**, **statement import (CSV/PDF)**, and **forwarding bank alert emails** |
| **Nepal (our target)** | No open-banking or aggregator API for individuals. The routes are **statement import (XLSX/CSV, P1)**, **pasting SMS alerts (P2)**, forwarding alert emails (P4), and **Android SMS reading (P4, native)** |
| Everywhere | Statement import (P1/P2) plus a unique email-in address for receipts and alerts (P4) |

We **never** store bank passwords. Provider access tokens are encrypted at rest (see §9).

### 3.9 Platform & UX extras

| Feature | Phase |
|---|---|
| Responsive web app (phone, tablet, desktop), installable as a **PWA** | P1 |
| Light and dark themes | P1 |
| Keyboard shortcuts and a command palette (`Ctrl/Cmd+K`) | P1 |
| **Offline quick-add**, queued and synced when back online | P2 |
| Localization (i18n): locale-aware number, date and currency formatting | P1 (formatting), P3 (translations) |
| Notifications: in-app; email; web push | P2 |
| Native mobile apps (Capacitor wrapper, or React Native if needed) | P4 |
| Public REST API with personal access tokens and webhooks | P4 (internal API from P1) |

---

## 4. Key domain decisions

### 4.1 Money representation
- Amounts are stored as **integers in minor units** (`bigint`), e.g. $12.34 → `1234`, ¥500 → `500`, KWD 1.234 → `1234`. Each currency's decimal places come from ISO 4217.
- **No floating-point numbers anywhere** in money math. A small, fully tested `money` module in `packages/shared` handles add, subtract, multiply by rate (with explicit rounding) and **largest-remainder allocation**, so a 3-way split of $10.00 comes out as 3.34 + 3.33 + 3.33 and always sums correctly.
- Display always goes through `Intl.NumberFormat` using the user's locale.
- Sign convention: **outflow is negative, inflow is positive**, relative to the account.

### 4.2 Ledger model: single-entry with splits and linked transfers (not full double-entry)
- **Why not double-entry?** It is more rigorous, but Firefly III shows it confuses ordinary users with "expense accounts" and "revenue accounts". We get the practical benefits a simpler way:
  - Every transaction has **1..n split lines**. The category lives on the split, and the lines must add up to the transaction amount. Reports only ever add up split lines, which keeps them consistent.
  - **Transfers** are two transactions sharing a `transfer_group_id`. They are excluded from income and expense totals, and editing one side updates the other.
  - An account's **balance** = opening balance + the sum of its transactions. It is always derived and can be audited; nothing is stored that could drift.

### 4.3 Multi-currency
- Each **account** has one currency. Each **workspace** has a **base currency** used for reports.
- A transaction made in a foreign currency stores both the original amount and currency and the amount in the account's currency (with the rate used). Example: a €20 charge on a USD card is stored as −$21.60, with €20.00 as the original.
- Reports convert to the base currency using the **historical rate on the transaction date**. Rates come from a daily job (**Nepal Rastra Bank** for NPR; see §4.6), are cached in an `exchange_rates` table, and can be overridden manually.

### 4.4 Dates & time
- A transaction's `date` is a **calendar date** (`DATE`, no time zone). That is how people think about "when I bought it", and it avoids off-by-one-day bugs around midnight.
- System timestamps (`created_at` and so on) are `timestamptz` in UTC.
- Budget periods follow the workspace's **calendar** (BS or AD; §4.6), **month start day** (AD only) and **week start day** (Sunday by default in Nepal).

### 4.5 Categories
- Two levels: **group → category** (e.g. *Food → Groceries, Dining out*), each of kind *expense* or *income*.
- A starter set of about 15 categories that can be edited during onboarding. Categories are archived rather than deleted when they have history (deleting offers to reassign transactions).

### 4.6 Nepal localization

**Calendar (Bikram Sambat).**
- The stored value is always the AD `DATE`. BS is a presentation and period layer computed by a calendar module in `packages/shared`. That module has a table of BS month lengths (1970–2090 BS) and gives O(1) conversion in both directions.
- The workspace setting `calendar: 'bs' | 'ad'` (default `bs`) controls:
  - date display (e.g. "14 Asoj 2083", with the AD date shown secondly in detail views);
  - the date picker (a BS month grid);
  - **budget periods**: with BS, a budget month is a BS month (29–32 days); with AD, a Gregorian month with the custom start day.
- The month-length data was cross-checked between two independent libraries (`bikram-sambat` by Medic, Apache-2.0, and `nepali-date-converter`, MIT). They agree through 2084 BS; later years are projections that the official panchang can revise. Because we store AD dates, a revision only moves period boundaries and never corrupts data.
- **Fiscal year:** 1 Shrawan to the end of Ashadh (mid-July to mid-July). Available as a report preset, e.g. "FY 2083/84".

**Numbers and currency display.**
- Grouping `lakh` (default: 1,23,45,678.90) or `international` (12,345,678.90), a per-user preference implemented with `Intl.NumberFormat` (`en-IN` digit grouping for lakh).
- Symbols: NPR shows as **"Rs."**, INR as "₹", USD as "$", and other currencies use their ISO code or Intl symbol. Devanagari numerals are an option for the Nepali UI later (P3).

**Currencies and rates.**
- NPR is the default base. The currency picker lists NPR, INR, USD first, then the main remittance and travel currencies (QAR, AED, SAR, MYR, KRW, JPY, KWD, EUR, GBP, AUD, CAD, CNY), then every other ISO 4217 currency.
- A rate provider interface with these implementations:
  1. **NRB** (`nrb.org.np/api/forex/v1/rates`): daily buying and selling rates against NPR. It handles the `unit` field (e.g. INR and JPY are quoted per 100 or per 10 units). We use the mid rate.
  2. A **fixed peg** for INR (1.60), used if NRB is unreachable.
  3. **Manual** rates entered by the user.
- A daily job fetches rates. Missing dates fall back to the most recent earlier rate.

**Local presets.**
- Accounts: Cash, Bank account, eSewa, Khalti, IME Pay, Credit card.
- Expense categories: Food & Groceries, Dining Out, Transport (fuel, bus, taxi, ride-hailing), Rent, Utilities (electricity, water, internet, LPG gas), Mobile & Data, Education, Health, Shopping, Entertainment, **Festivals & Gifts** (Dashain, Tihar, weddings), Family Support, Travel, Loan/EMI, Insurance, Donations.
- Income categories: Salary, Business, **Remittance**, Interest, Gifts Received, Other Income.

---

## 5. Architecture

### 5.1 Architecture choice

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| **A. Local-first** (SQLite in the browser plus a sync server, like Actual) | Very fast; fully offline; private | CRDT/sync complexity; harder multi-user sharing, server-side jobs (recurring posts, bank sync, email) and AI | Too costly for our feature set |
| **B. Server-first SPA + API with an offline-tolerant PWA** | Simple and robust; easy sharing, jobs, notifications, bank sync; one source of truth | Needs a network for most actions | ✅ **Recommended** |
| C. Full-stack SSR framework (e.g. Next.js) | One deployable | The app sits behind a login (no SEO benefit); a separate typed API is better for future mobile and third-party clients; the PWA offline shell is simpler with a SPA | Good alternative, not our choice |

**Decision: B**, with local caching (persisted query cache in IndexedDB) and an offline mutation queue for quick-add. It feels instant and works on the subway, without the cost of full local-first sync.

### 5.2 System diagram

```
┌──────────────────────────────┐        HTTPS (JSON, cookie session)        ┌──────────────────────────────┐
│  Web client (React PWA)      │ ─────────────────────────────────────────▶ │  API server (Hono, Node.js)  │
│  • TanStack Router + Query   │                                            │  • REST /api/v1 + OpenAPI    │
│  • IndexedDB cache           │ ◀───────────────────────────────────────── │  • Auth (Better Auth)        │
│  • Offline mutation queue    │                                            │  • Domain services           │
│  • Service worker (Workbox)  │                                            │  • Zod validation            │
└──────────────────────────────┘                                            └──────┬───────────┬───────────┘
                                                                                   │           │
                                                                      SQL (Drizzle)│           │ S3 API
                                                                                   ▼           ▼
                                                              ┌──────────────────────┐   ┌─────────────────────┐
                                                              │ PostgreSQL           │   │ Object storage      │
                                                              │ • data               │   │ (S3 / MinIO)        │
                                                              │ • pg-boss job queue  │   │ receipts, exports   │
                                                              └─────────┬────────────┘   └─────────────────────┘
                                                                        │ jobs
                                                                        ▼
                                                              ┌──────────────────────────────────────────────┐
                                                              │ Worker (same codebase, separate process)     │
                                                              │ • post recurring txns  • FX rate refresh     │
                                                              │ • budget alerts/digest • import processing   │
                                                              │ • receipt OCR (P3)     • bank sync (P4)      │
                                                              └──────────────────────────────────────────────┘
```

### 5.3 Tech stack (with reasoning)

| Layer | Choice | Why | Alternatives considered |
|---|---|---|---|
| Language | **TypeScript 6** (strict) everywhere | One language; types and validation shared between client and server | — |
| Monorepo | **pnpm workspaces** (+ Turborepo if builds get slow) | Simple, fast, shared packages | Nx (heavier) |
| Frontend | **React 19 + Vite** | Mature ecosystem; fast dev server; a SPA suits an app behind a login | SvelteKit, Next.js |
| Routing / data | **TanStack Router + TanStack Query** | Type-safe routes and search params (filters live in the URL); caching, optimistic updates, offline persistence | React Router |
| Forms | **React Hook Form + Zod** | Same schemas as the API | — |
| UI kit | **Tailwind CSS v4 + shadcn/ui** (Radix primitives) + lucide icons | Accessible primitives; we own the component code; consistent design | MUI, Mantine |
| Charts | **Recharts** (lazy-loaded) | Declarative, React-native, covers every chart we need | ECharts, visx |
| Tables | **TanStack Table + TanStack Virtual** | Smooth scrolling through 10k+ transactions | AG Grid |
| PWA | **vite-plugin-pwa (Workbox)** | App shell caching, installable, update prompts | — |
| API framework | **Hono** on Node.js 24 LTS | Small and fast; first-class Zod and OpenAPI integration; typed RPC client | Fastify, NestJS (heavier) |
| Validation / API docs | **Zod 4 + @hono/zod-openapi** | One schema gives validation, types and an OpenAPI spec | tRPC (not as good for third-party clients) |
| Database | **PostgreSQL 16+** | Relational integrity for money; JSONB for rules; full-text and trigram search; dependable | SQLite (single-user only), MySQL |
| ORM / migrations | **Drizzle ORM + drizzle-kit** | SQL-first, type-safe, lightweight, explicit migrations | Prisma (heavier runtime, less SQL control) |
| Auth | **Better Auth** | Email/password (Argon2id), OAuth (Google), **passkeys**, **TOTP 2FA**, sessions, organizations/teams (which fit workspaces) | Auth.js, Clerk (hosted and paid) |
| Background jobs | **pg-boss** (Postgres-backed queue) | No Redis to run; transactional job creation; cron scheduling | BullMQ + Redis |
| File storage | **S3-compatible** (MinIO locally; S3/R2 in the cloud) | Receipts and exports | Local disk (does not scale) |
| Email | **Nodemailer** over SMTP (e.g. Resend, SES) | Invites, password resets, digests | — |
| Recurrence | **rrule** (RFC 5545) | Industry-standard recurrence rules | Custom (reinventing it) |
| Dates | **date-fns** (+ `@date-fns/tz`) | Tree-shakeable, immutable | Day.js, Luxon |
| i18n | **Lingui** or react-i18next | Message extraction; ICU plurals | — |
| Logging / observability | **pino** structured logs; OpenTelemetry-ready; optional Sentry | | |
| Testing | **Vitest** (unit and integration against a real, throwaway Postgres database), **Playwright** (E2E), MSW (API mocks in UI tests) | Fast; realistic; covers the key user flows; no Docker needed to run the tests | Jest, Cypress, Testcontainers |
| Lint / format | **Biome** (or ESLint + Prettier) | One fast tool | |
| CI | **GitHub Actions**: typecheck, lint, unit, integration, E2E, build Docker images | | |
| Deploy | **Docker Compose** (web, api, worker, postgres, minio), self-hostable; any container host for the cloud (Fly.io, Railway, Render) + managed Postgres (Neon, Supabase) | Runs anywhere, no lock-in | Vercel (fine for the web app, not the worker) |

### 5.4 Repository layout

```
expense-tracker/
├─ apps/
│  ├─ web/                 # React PWA
│  │  └─ src/{routes,features/<domain>,components/ui,lib,i18n}
│  └─ api/                 # Hono API + worker entrypoint
│     └─ src/{routes,services,repositories,jobs,auth,db/{schema,migrations}}
├─ packages/
│  └─ shared/              # Zod schemas, DTO types, money/date utils, rule evaluator, CSV parsers
├─ docs/                   # PLAN.md, ADRs (architecture decision records), API notes
├─ docker/                 # Dockerfiles, compose overrides
├─ docker-compose.yml
└─ .github/workflows/ci.yml
```

The code is organised by feature (`features/transactions`, `features/budgets`, …). The API is layered: **route → service (business rules) → repository (SQL)**, and every repository function requires a `workspaceId`, so data from one tenant cannot leak into another.

---

## 6. Data model

(Postgres; every table has `id uuid pk` (UUIDv7, time-ordered), `created_at` and `updated_at`. All workspace-owned tables have `workspace_id` with an index and a foreign key.)

```
users                (Better Auth tables: user, session, account, verification, passkey, two_factor)
  + locale, timezone, number_grouping enum(lakh, international), default_workspace_id

workspaces           name, base_currency char(3), calendar enum(bs, ad), month_start_day 1..28 (AD only),
                     week_start 0..6, budget_mode enum(tracking, zero_based)
workspace_members    workspace_id, user_id, role enum(owner, admin, editor, viewer)   PK(workspace_id,user_id)
invitations          workspace_id, email, role, token_hash, expires_at, accepted_at

accounts             workspace_id, name, type enum(cash, checking, savings, credit_card, e_wallet,
                     loan, investment, other), currency char(3), opening_balance_minor bigint,
                     opening_date date, credit_limit_minor, institution, last4, icon, color,
                     on_budget bool, in_net_worth bool, visibility enum(shared, private), owner_user_id,
                     archived_at, sort_order

category_groups      workspace_id, name, kind enum(expense, income), sort_order, archived_at
categories           workspace_id, group_id, name, icon, color, rollover enum(none, surplus, all),
                     exclude_from_reports bool, sort_order, archived_at

payees               workspace_id, name, normalized_name, default_category_id, archived_at
                     UNIQUE(workspace_id, normalized_name)

transactions         workspace_id, account_id, date date, amount_minor bigint (signed, account ccy),
                     payee_id, raw_description text, notes text,
                     original_amount_minor, original_currency, fx_rate numeric(20,10),
                     status enum(pending, cleared, reconciled), needs_review bool,
                     transfer_group_id uuid null, recurring_id null, import_batch_id null,
                     external_id text null, created_by, updated_by, deleted_at, version int
                     INDEX(workspace_id, date DESC), INDEX(account_id, date), INDEX(payee_id),
                     UNIQUE(account_id, external_id) WHERE external_id IS NOT NULL,
                     GIN trigram index on (raw_description, notes) for search
transaction_splits   transaction_id, category_id null, amount_minor bigint, memo
                     (a deferred constraint trigger checks SUM(splits) = transaction.amount)
tags                 workspace_id, name, color       UNIQUE(workspace_id, name)
transaction_tags     transaction_id, tag_id           PK(transaction_id, tag_id)
attachments          workspace_id, transaction_id, storage_key, mime, size_bytes, sha256,
                     extracted jsonb (OCR result)

budgets              workspace_id, category_id, month date (first day of period), amount_minor
                     UNIQUE(workspace_id, category_id, month)
goals                workspace_id, name, target_minor, currency, target_date, account_id null,
                     icon, color, achieved_at
goal_contributions   goal_id, date, amount_minor, transaction_id null

recurring            workspace_id, template jsonb (account, amount, payee, splits, tags, notes),
                     rrule text, start_date, end_date null, next_date, mode enum(auto_post, remind),
                     remind_days_before, match_tolerance_pct, paused bool
rules                workspace_id, name, priority int, stage enum(pre, default, post),
                     conditions jsonb, actions jsonb, stop_processing bool, enabled bool,
                     hit_count int, last_hit_at

import_batches       workspace_id, account_id, source enum(csv, ofx, qif, camt, json, bank_sync),
                     file_name, mapping jsonb, stats jsonb, created_by, reverted_at
import_profiles      workspace_id, name, mapping jsonb (saved per-bank CSV column mapping)

exchange_rates       base char(3), quote char(3), date, rate numeric(20,10), source enum(nrb, peg, manual)
                     PK(base,quote,date,source)
notifications        user_id, workspace_id, type, payload jsonb, read_at
audit_log            workspace_id, actor_user_id, entity, entity_id, action, diff jsonb, at

-- Phase 3: shared expense groups
split_groups         workspace_id null, name, currency, simplify_debts bool
split_members        group_id, user_id null, display_name, email null
shared_expenses      group_id, paid_by_member_id, date, description, amount_minor, currency,
                     split_method enum(equal, exact, percent, shares), linked_transaction_id null
shared_expense_shares shared_expense_id, member_id, share_minor
settlements          group_id, from_member_id, to_member_id, amount_minor, date

-- Phase 4
api_tokens           user_id, name, token_hash, scopes text[], last_used_at, expires_at
bank_connections     workspace_id, provider, encrypted_access_token, status, last_synced_at
bank_account_links   bank_connection_id, account_id, provider_account_id
```

**Integrity:** foreign keys everywhere; `ON DELETE RESTRICT` for money-bearing rows; soft delete for transactions (so undo works, with a purge after 30 days); an optimistic concurrency `version` column (the API returns 409 on a stale write).

---

## 7. API design

- REST under **`/api/v1`**, JSON, documented automatically as **OpenAPI 3.1** (with a Scalar or Swagger UI page at `/api/docs`).
- The workspace is part of the path: `/api/v1/workspaces/:wid/transactions`. Authorization is checked by middleware on every request.
- **Cursor pagination** (`?cursor=…&limit=50`); filtering through query params that match the UI's URL state.
- **Idempotency keys** (`Idempotency-Key` header) on POSTs, and client-generated UUIDs, so replaying the offline queue never creates duplicates.
- Consistent error envelope: `{ error: { code, message, details } }`.

Main resources:

```
auth/*                              (Better Auth handlers: sign-up, sign-in, passkeys, 2FA, sessions)
workspaces, workspaces/:wid/members, invitations
accounts            GET/POST/PATCH/DELETE, GET :id/balance-history, POST :id/reconcile
transactions        GET (filters) / POST / PATCH / DELETE, POST bulk, POST :id/restore
transfers           POST (creates the linked pair)
categories, category-groups, payees (POST :id/merge), tags
budgets             GET ?month=, PUT (upsert many), POST copy-previous, POST fill-average
goals, goals/:id/contributions
recurring           CRUD, GET upcoming?days=30, POST :id/skip, POST :id/post-now
rules               CRUD, POST :id/test (dry run over history), POST apply (retroactive)
imports             POST (upload) → GET :id/preview → POST :id/commit, POST :id/revert
exports             POST (csv|json) → job → GET download (signed URL)
reports             GET spending-by-category, cash-flow, trends, net-worth, budget-vs-actual,
                        by-payee, by-tag, calendar  (all accept from/to/accounts/categories/tags)
review-inbox        GET, POST confirm (bulk)
attachments         POST (presigned upload), GET (signed URL), DELETE
```

---

## 8. UX & UI design

### 8.1 Information architecture

- **Mobile:** bottom tab bar: **Home · Transactions · ＋ · Budgets · More** (Reports, Accounts, Recurring, Goals, Settings under More).
- **Desktop:** left sidebar with the same sections plus a workspace switcher; command palette (`Cmd/Ctrl+K`); shortcuts (`N` new transaction, `/` search, `G T` go to transactions, `E` edit, `Del` delete, `?` help).

### 8.2 Key screens

1. **Onboarding (about 60 seconds):** choose base currency → create your first account (with a "Cash" preset) → confirm the starter categories → optionally import a CSV → done. You can skip everything and start logging straight away.
2. **Home dashboard**
   ```
   ┌───────────────────────────────────────────────────────────┐
   │  September · 5 days left              [ This month ▾ ]    │
   │  ┌─────────────────────┐  ┌────────────────────────────┐  │
   │  │ Left to spend        │  │ Cash flow                  │  │
   │  │  $642  (~$128/day)   │  │  In $4,200  Out $3,015     │  │
   │  │  ███████████░░░ 78%  │  │  Net +$1,185 ▁▃▅▂▆▄        │  │
   │  └─────────────────────┘  └────────────────────────────┘  │
   │  Needs review (3)  ▸  Upcoming bills (next 7 days)  ▸     │
   │  Top categories: Groceries $512 · Dining $288 · Fuel $140 │
   │  Recent transactions ...                                   │
   └───────────────────────────────────────────────────────────┘
   ```
3. **Quick add (bottom sheet):** a large amount keypad (with a currency switcher) → a grid of your 8 most frequent/recent categories → optional payee, note, date, account → **Save**. Also "Save & add another".
4. **Transactions:** a virtualized list grouped by date with daily totals; filter chips; inline category editing; multi-select bulk bar; an "Uncategorized" and "Needs review" quick filter.
5. **Transaction detail:** splits editor (with a live "remaining to allocate" figure), tags, attachments, history, "create rule from this".
6. **Budgets:** the month selector respects the custom start day; each category row shows *budgeted · spent · remaining* with a progress bar (neutral → amber at 80% → red only when over); group subtotals; "copy last month" and "use averages".
7. **Reports:** tabs (Spending · Cash flow · Trends · Net worth · Budget vs actual). A period picker with presets; click any chart segment to see the matching transactions.
8. **Accounts:** balances grouped as assets and liabilities, net worth at the top; an account register with a running balance; a reconcile button.
9. **Recurring:** list and calendar views, the next 30 days, and a monthly total for subscriptions.
10. **Import wizard:** Upload → Map columns → Preview (flags duplicates; shows the categories rules would set) → Commit → Summary with "Undo import".
11. **Settings:** Profile · Security (password, passkeys, 2FA, active sessions) · Workspace (currency, month start, members) · Categories · Payees · Tags · Rules · Import/Export · Delete account.

### 8.3 Visual design

- **Design tokens:** Tailwind v4 theme with CSS variables for colour, radius, spacing and typography; light and dark themes.
- **Money typography:** tabular (fixed-width) numerals so columns line up; outflows in the neutral text colour, inflows in green, and red reserved for over-budget and errors.
- **Category identity:** an icon and colour per category, used consistently across lists, charts and budgets.
- **Accessibility:** WCAG 2.2 AA; keyboard navigable; visible focus; charts get table or summary alternatives for screen readers; respects `prefers-reduced-motion`; touch targets of 44px or more.
- **Empty states that teach** (e.g. "No transactions yet: add one, or import a CSV from your bank").

### 8.4 Performance targets

- First load under 2.5s LCP on a mid-range phone over 4G; later navigations feel instant (cached, optimistic).
- Quick-add save shows up optimistically in under 100ms.
- The transaction list scrolls at 60fps with 10k+ rows; report queries return in under 300ms for about 100k transactions.

---

## 9. Security & privacy

| Area | Measure |
|---|---|
| Passwords | Argon2id (Better Auth); breached-password check (optional, HIBP k-anonymity) |
| Sessions | httpOnly, Secure, SameSite=Lax cookies; rotation; list and revoke sessions |
| MFA | TOTP 2FA and passkeys (WebAuthn); recovery codes |
| CSRF | SameSite cookies plus an origin check on state-changing requests |
| Authorization | Workspace membership and role checked in middleware; **every query scoped by `workspace_id`** at the repository layer; tests prove cross-tenant access fails. (Postgres row-level security as defence in depth: optional, P3) |
| Input | Zod validation on every endpoint; parameterized SQL only (Drizzle); CSV-injection-safe export (cells starting with `= + - @` are escaped) |
| Transport and headers | HTTPS only; HSTS; strict CSP; `X-Content-Type-Options`; `Referrer-Policy` |
| Rate limiting | Per IP and per user on auth and write endpoints |
| Secrets at rest | Bank tokens and API keys encrypted with AES-256-GCM (envelope encryption; key from env/KMS); API tokens stored only as hashes |
| Files | Private bucket; short-lived signed URLs; MIME and size checks; image EXIF stripped |
| Privacy | No ads, no tracking or third-party analytics by default; AI features opt-in, with a clear note on what is sent; full data export and **account deletion** (GDPR-style) |
| Supply chain | Lockfile; Dependabot/Renovate; `pnpm audit` and CodeQL in CI |
| Backups | Scheduled `pg_dump` (in Compose) with retention; restore procedure documented and tested |

---

## 10. Quality & testing strategy

| Level | Tooling | What is covered |
|---|---|---|
| Unit | Vitest | Money math and allocation, currency conversion, budget period calculations (custom month start), RRULE expansion, the rule evaluator, CSV/OFX parsers, duplicate detection, debt simplification. **≥ 90% coverage on `packages/shared`** |
| Integration | Vitest + a real Postgres (a fresh database per test run; a service container in CI) | Every API endpoint: happy path, validation, authorization (cross-workspace denial), the split-sum invariant, transfer linkage, import commit/revert |
| E2E | Playwright (Chromium, plus mobile viewport) | Sign up → onboarding → quick add → edit → budget → report; CSV import; offline quick-add sync |
| Accessibility | axe-core in Playwright | Key screens have no serious violations |
| Visual | Playwright screenshots (optional) | Dashboard and budget screens in light/dark |
| Seed data | A realistic demo dataset generator (12 months, several accounts and currencies) | Used for dev, demos, E2E and performance checks |

**Definition of done for each feature:** typed end to end; validated; tested at unit and integration level; E2E for the main flows; accessible; works on a mobile viewport; documented in the API spec; no new lint or type errors; CI green.

---

## 11. DevOps & operations

- **Local dev:** `pnpm i && docker compose up -d db minio && pnpm dev`. Seed script `pnpm db:seed`.
- **Environments:** local → preview (per PR, optional) → production.
- **CI (GitHub Actions):** install (with cache) → typecheck → lint → unit → integration (Testcontainers) → E2E (Playwright against the built app) → build Docker images.
- **Migrations:** drizzle-kit, generated and reviewed in PRs, applied on deploy. Destructive changes happen in two steps (expand, then contract).
- **Config:** 12-factor env vars validated with Zod at startup (the app refuses to boot on a bad config).
- **Monitoring:** `/healthz` (liveness) and `/readyz` (DB and queue) endpoints; structured logs; optional Sentry; job failure alerts.

---

## 12. Roadmap & milestones

Each milestone ends with a working app that can be demoed, and a merged PR.

### 12.1 Implementation notes (Phase 0 + 1)

Built as planned, with these differences:

- **Transaction list:** infinite scroll in pages of 100 instead of a virtualized table. Only loaded
  rows are rendered, which covers personal-scale histories; virtualization can be added later if needed.
- **Integration tests** run against a real throwaway PostgreSQL database created by the test setup
  (a service container in CI) rather than Testcontainers, so no Docker is needed locally.
- **Workspace creation** happens in onboarding (after sign-up) rather than automatically, so the
  user picks the currency, calendar and accounts first.
- **Docker Compose** has no MinIO (attachments ended up in PostgreSQL, see §12.2). It includes a nightly `pg_dump` backup service.
- **Charts** use a validated colour-blind-safe palette (blue/orange series) with every chart
  also available as a table.
- **Refunds** are recorded as money in against a spending category (Income mode lets you pick one).
- **Hardening found by the end-to-end tests:** sign-in/sign-up rate limiting (configurable only for
  automated tests), and static-file serving limited to real files.

### 12.2 Implementation notes (Phase 2)

Built in eight slices, each with unit, API integration and end-to-end tests. Differences from the plan:

- **Recurring schedules** use a small schedule model (frequency, interval, start date, "last day of
  the month") instead of RRULE, because RRULE can't express **Bikram Sambat months**. Occurrences are
  computed from their index, so skipping or editing one never drifts the rest. Automatic items are
  recorded hourly, each workspace in its own time zone.
- **Rules** run when transactions are added or imported (not when edited, so a manual fix is never
  overwritten). "Always do this" after changing a category proposes a rule based on a keyword from
  the bank description, which matches future imports better than the payee name.
- **Attachments live in PostgreSQL** (`bytea`, 5 MB each, 10 per transaction, 1 GB per workspace)
  instead of S3/MinIO: one less service to run, and the nightly dump backs them up. Photos are
  resized and stripped of EXIF (location) data on the device before upload; file types are checked
  by content. The storage layer can move to S3 later without changing the API.
- **Reconciled transactions** can still be edited, but only after an explicit confirmation, and
  every change to a transaction is recorded in its history (who, when, before → after).
- **Import formats:** OFX/QFX (SGML and XML), QIF and CAMT.053, plus **pasted SMS alerts** from
  Nepali banks and wallets, which cover the gap left by the lack of bank APIs.
- **Offline quick add** keeps a queue in local storage; each queued transaction carries an id chosen
  on the device, so re-sending after a flaky connection can't create duplicates. Accounts and
  categories are cached by the service worker so the form works offline.
- **Notifications** are in-app plus optional email (SMTP). Budget warnings fire at 90% and when over,
  but not at exactly 100% (usually a fixed bill paid as planned). **Web push moved to Phase 3**: it
  needs VAPID keys and per-device subscriptions, and email covers the "tell me when I'm not in the
  app" need for now.
- **Two-step sign-in** uses Better Auth's TOTP plugin with 10 single-use backup codes, optional
  "trust this device for 30 days", and account lockout after repeated wrong codes. **Passkeys** sign
  in on their own (they already combine something you have with a biometric or PIN), so they skip
  the TOTP step.

### 12.3 Implementation notes (Phase 3)

Built in seven slices, each with unit, API integration and end-to-end tests. Differences from the
plan, and known limits:

- **Sharing.** Invitations are links that work once, for 7 days, and only for the invited email
  address (emailed when SMTP is set up, shown to copy either way). Deleting your login hands a
  shared workspace to its longest-standing admin, or else member, instead of orphaning it.
- **Private accounts** are enforced through a scope object (the workspace id plus the accounts
  hidden from the person asking) that every lookup takes instead of a bare workspace id; jobs use an
  explicit system scope or each member's own scope. **Postgres row-level security was not added**:
  the scope gives the same guarantee in one place, and integration tests cover each surface (lists,
  search, reports, budgets, exports, backups, attachments, history). A transfer between a shared and
  a private account shows its shared side to others as "another account", read-only. *Limit:* a
  member who leaves keeps their private accounts in the workspace, hidden from everyone else; they
  only see them again if they rejoin, and deleting their login deletes them.
- **Split groups** settle up by having the largest debtor pay the largest creditor repeatedly, which
  needs at most (people − 1) payments and is what Splitwise-style apps do (the true minimum is
  NP-hard). Leftover paisa from rounding go to the largest remainders, so shares always add up exactly.
- **Envelope mode** computes Ready to assign from the on-budget accounts: money there before the
  first budgeted month, then each month's income, minus what's assigned, uncategorized spending and
  last month's overspending. *Limit:* a transfer from an on-budget account to an off-budget one
  (investments, a loan) is not taken out of Ready to assign; record such a move as spending in a
  category, or put the destination account on budget.
- **Insights are deterministic**, as planned: spending above the mean + 2σ of the previous months,
  categories well under their usual, good-month streaks, budgets kept three months running, price
  changes and payments worth tracking. Each person dismisses items for themselves. The **forecast**
  adds scheduled items to the average everyday money in and out over the last 90 days (leaving out
  payees that now have a schedule, so a salary isn't counted twice), with an 80% band widening with
  √days. It doesn't model seasonal spikes such as Dashain.
- **Web push** uses VAPID keys from the environment, or a pair made on first start and kept in the
  database. Subscriptions are only accepted for the major browsers' push services (plus
  `PUSH_EXTRA_HOSTS`), so the server can't be pointed at internal addresses. New notifications are
  pushed every minute, more than three collapse into one summary, and devices the push service
  reports as gone are forgotten. *Limit:* on iPhone and iPad, push needs the app added to the home
  screen (iOS 16.4+), as for any web app.
- **AI helpers** use the Claude API behind a provider interface (tests use a scripted fake). They are
  off unless the server has `ANTHROPIC_API_KEY` *and* a workspace owner or admin turns them on, with
  a per-workspace daily limit (`AI_DAILY_LIMIT`). Extraction (receipts, sentences, PDF statements,
  categories) uses structured outputs validated with Zod; "ask your money" runs the model with
  read-only report tools limited to the asker's view, never SQL. The model defaults to
  `claude-opus-5-5` and can be changed with `AI_MODEL` (e.g. `claude-haiku-4-5` for lower cost).
  Natural-language quick add tries a deterministic parser first (amounts with lakh and Devanagari
  digits, relative dates, accounts, categories, a few Nepali words) and only asks the model when it
  finds nothing useful; the same parser runs in the browser when offline.
- **Import presets** recognise YNAB, Actual Budget, Mint and Splitwise exports by their header row.
  Transfers, starting balances and settle-up payments are left out (and counted). Splitwise imports
  your share of each expense as spending; it does not recreate the groups.
- **PDF report export** is a print-ready monthly report saved with the browser's "Save as PDF",
  rather than server-side PDF generation: the browser already shapes Devanagari, lakh grouping and
  BS dates correctly, and the server needs no headless browser or font files.
- **Translations:** Nepali (नेपाली) is a per-person setting, with Devanagari digits, रु. and Nepali
  month and weekday names. *Limit:* it covers navigation, the dashboard, the transaction dialog, the
  monthly report and shared labels; deeper settings pages, insight sentences and server-written
  notifications and emails are still English. Untranslated text falls back to English, and the
  catalogue (`apps/web/src/lib/locales/ne.ts`) is keyed by the English text so it can grow page by
  page.

### Phase 0: Foundations
- Monorepo, TypeScript config, Biome, Vitest, Playwright, CI
- Docker Compose (Postgres; MinIO when attachments arrive in P2), env config, logging
- Drizzle schema and first migration; seed script
- Better Auth (email/password, sessions); workspace created on sign-up
- Web shell: routing, layout (sidebar and bottom nav), theme, design tokens, shadcn/ui base components

### Phase 1: MVP (a complete, usable tracker)
1. Accounts CRUD, balances
2. Categories (group → category), starter set, payees, tags
3. Transactions CRUD, **quick add**, splits, transfers, refunds, soft delete with undo
4. Transactions list: search, filters in the URL, bulk edit, virtualization
5. Learned category suggestions (payee history)
6. Budgets (monthly, custom month start, copy and average helpers), left to spend
7. Dashboard and core reports (spending by category, cash flow, trends, budget vs actual)
8. CSV import wizard with mapping, duplicate detection and revert; CSV and JSON export/backup
9. Multi-currency (account currency, base currency, FX rates job)
10. Onboarding flow, empty states, dark mode, PWA install, i18n formatting

### Phase 2: Automation & depth
- Rules engine (with "create rule from this edit", dry-run and retroactive apply)
- Recurring transactions and bills (RRULE; auto-post or remind; upcoming calendar)
- Needs-review inbox
- Rollover budgets; overall cap; goals
- Reconciliation; transaction status; attachments; audit history
- Net worth report; payee, tag and calendar reports; period comparison
- OFX/QFX/QIF/CAMT import; notifications (in-app, email, web push); offline quick-add queue
- 2FA (TOTP) and passkeys

### Phase 3: Collaboration & intelligence
- Household sharing (invites, roles, per-person attribution, private/shared accounts)
- Split groups with debt simplification and settle-up
- Zero-based (envelope) budgeting mode
- Subscription detection; insights feed; cash-flow forecast
- Web push notifications (moved from Phase 2)
- AI: receipt scan, natural-language quick add, category fallback, "ask your money", PDF statement import
- Import presets for YNAB, Actual, Mint and Splitwise; PDF report export; translations

### Phase 4: Integrations & native
- Bank sync provider(s) for your region; email-in for receipts and alerts
- Public API with personal access tokens and webhooks
- Native mobile wrapper (Capacitor), including Android SMS parsing if you're in India
- Investment holdings (optional)

---

## 13. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Scope creep (this plan is big) | Strict phase gates; Phase 1 must be usable on its own; anything new goes into a later phase unless it blocks something |
| Money rounding bugs | Integer minor units; one tested money module; property-based tests (fast-check) for allocation and conversion |
| Split/transfer inconsistencies | A DB-level deferred constraint and service-level invariants; integration tests |
| Import duplicates or messy bank CSVs | Preview before commit; fuzzy duplicate detection; revertible batches; saved mappings |
| Offline sync conflicts | Only *creates* are queued offline (no edits in P2); client UUIDs and idempotency keys; conflicts surface in the review inbox |
| Bank-sync cost and regulation | Deferred to P4 behind an interface; statement import covers every region in the meantime |
| AI cost, privacy and accuracy | Opt-in; deterministic methods first; send minimal data; the user always confirms; per-workspace usage limits |
| Tenant data leakage | Workspace scoping enforced in the repository layer; authorization tests; optional RLS |

---

## 14. Open questions for you

My recommended default is in **bold**. If you're happy with all of them, just say "go with the defaults".

1. **Who is it for?** **Personal plus household sharing (Phase 3)** / personal only / also small business (invoices, tax, which I'd suggest avoiding).
2. **Your region and main currency?** This decides the default currency, CSV presets and the bank-sync route (US: SimpleFIN or Plaid; EU/UK: Enable Banking; India: SMS on Android plus statement import).
3. **Platform priority?** **Responsive web and installable PWA first, native wrapper later** / native mobile first.
4. **Hosting?** **Self-hostable with Docker, deployable to any cloud** / managed SaaS only / purely local desktop app.
5. **Default budgeting style?** **Simple monthly category budgets, with zero-based mode opt-in later** / zero-based (YNAB-style) as the default / no budgets, tracking only.
6. **AI features?** **Yes, opt-in, in Phase 3** / not at all / earlier (e.g. receipt scanning in the MVP).
7. **MVP scope:** is Phase 1 as listed the right line for "complete and fully functional", or should something move up (e.g. recurring bills or rules)?
8. **Branding:** do you have an app name, colour, or logo preference? (Otherwise I'll use a neutral placeholder theme.)
9. **Stack:** any constraints (e.g. you'd rather use Next.js, Python/Django, Flutter, or MongoDB)? The plan above is my recommendation, but I can adapt it.

---

## 15. Sources (research, Sep 2026)

- [The Best Budgeting Apps for 2026 (The College Investor)](https://thecollegeinvestor.com/32672/best-budgeting-apps/)
- [The Best Budget Apps for 2026 (NerdWallet)](https://www.nerdwallet.com/finance/learn/best-budget-apps)
- [The best budgeting apps for 2026 (Engadget)](https://www.engadget.com/apps/best-budgeting-apps-120036303.html)
- [Monarch vs YNAB (Monarch)](https://www.monarch.com/compare/ynab-alternative)
- [Monarch Money Review 2026 (The Penny Hoarder)](https://www.thepennyhoarder.com/budgeting/monarch-money-review/)
- [Actual Budget on GitHub](https://github.com/actualbudget/actual) · [Actual bank sync docs](https://actualbudget.org/docs/advanced/bank-sync/)
- [Firefly III](https://www.firefly-iii.org/) · [Firefly III docs: introduction](https://docs.firefly-iii.org/explanation/firefly-iii/about/introduction/)
- [Cashew: open-source budget & expense tracker](https://dev.co/databases/open-source/cashew) · [Ivy Wallet (unmaintained)](https://github.com/Ivy-Apps/ivy-wallet)
- [Maybe Finance (archived)](https://github.com/maybe-finance/maybe) · [Sure (community fork)](https://github.com/we-promise/sure)
- [Free & indie open banking APIs 2026 (Open Banking Tracker)](https://www.openbankingtracker.com/guides/free-open-banking-apis)
- [Best Splitwise alternatives 2026 (SplitMyExpenses)](https://www.splitmyexpenses.com/articles/best-splitwise-alternatives)
- [Receipt OCR comparison 2026 (LlamaIndex)](https://www.llamaindex.ai/insights/best-ocr-for-receipts)
- [Why budgeting apps fail (Medium)](https://medium.com/@moneytoolapp/why-most-budgeting-apps-fail-and-what-we-can-do-about-it-a9bf9a417804) · [Why people hate finance apps (DEV)](https://dev.to/eastkap/i-built-a-budget-tracker-in-a-weekend-heres-what-i-learned-about-why-people-hate-finance-apps-46km)
- [UPI/SMS expense trackers in India 2026](https://www.moonproduct.tech/insights/upi-expense-tracker-india-2026/) · [TrackMyRupee vs Axio vs Money Manager](https://trackmyrupee.com/blog/trackmyrupee-vs-walnut-axio-vs-money-manager-which-expense-tracker-is-best-for-indians-in-2026/)

*Prices and provider availability change often; re-check before relying on them.*
