# Security and reliability audit (October 2026)

A review of the whole system — API, web app, shared package, database, CI and deployment — with
each finding checked against the code or reproduced against a running server. Findings are
grouped by priority and fixed in that order. **Status** is kept up to date as work lands.

How findings were verified:

- **Reproduced**: shown against the running app (commands in the finding).
- **Read**: found by reading the code; the fix comes with a test that fails without it.

## Critical

### C1. Sign-in rate limits can be bypassed, or used to lock everyone out — Reproduced

- **Problem**: Better Auth keys its rate limits (sign-in, sign-up, two-factor codes, passkeys) on
  the `X-Forwarded-For` header, which any client can set. Our own write limiter does the same for
  signed-out requests. With no header in production it falls back to one bucket shared by
  everybody, and behind nginx a spoofed header (two entries) causes the same fallback.
- **Evidence**: 14 wrong passwords in a row: `429` after the 9th normally; all 14 allowed
  (`401`) when each request sent a different `X-Forwarded-For`.
- **Impact**: Unlimited password and two-factor-code guessing against any account. Or, the
  other way round, a handful of requests a minute locks every user out of signing in.
- **Fix**: Work out the client address from the TCP connection. Trust `X-Forwarded-For` only
  when the connection comes from a configured proxy (`TRUST_PROXY`, by default loopback and
  private networks, which covers a reverse proxy or tunnel on the same host or Docker network).
  Hand that address to Better Auth in a header the client can't set, and use it for our own
  limiter too. Tests cover spoofing, trusted proxies and the fallback.
- **Status**: Fixed in phase 1. `test/client-ip.test.ts` replays the attack (it fails without
  the fix); against a real server with `TRUST_PROXY=none` the same 14-request attack now gets
  `429` after the 10th attempt.

### C2. CI has been red on every commit for two weeks — Reproduced

- **Problem**: The main CI job fails on the push-notification end-to-end test. CI runs
  Playwright's default "headless shell" browser, which reports notifications as blocked, so the
  "On this device" switch is disabled. Locally the full Chromium build is used, so it passes.
- **Evidence**: The last 12 runs on this branch all fail on that one test; running it locally
  with the headless-shell binary fails the same way ("Notifications are blocked for this site").
- **Impact**: A permanently red pipeline hides real regressions; nobody can tell a broken commit
  from a good one.
- **Fix**: Run the end-to-end tests in full Chromium (Playwright's `chromium` channel, "new
  headless"). Also give the CI Postgres health check a user, which removes a log line every 5 s.
- **Status**: Fixed in phase 1 (config change). Can only be confirmed by CI, since the
  Chromium build Playwright uses isn't installed in the audit environment.

## High

### H1. No limit on request body size (unauthenticated memory exhaustion) — Reproduced

- **Problem**: Only receipt and photo uploads (and inbound email) have a size limit. Every JSON
  endpoint, the sign-in/sign-up endpoints and the AI receipt/statement uploads read the whole
  body into memory first.
- **Evidence**: One unauthenticated 400 MB POST to `/api/v1/workspaces` raised the API's memory
  from 1.0 GB to 1.55 GB before it answered `400`.
- **Impact**: A few concurrent requests can crash the server without signing in.
- **Fix**: A default limit of 1 MB for API and auth requests, 10 MB for imports and AI uploads,
  50 MB for backup restores; clients get a clear `413`. The web app checks AI uploads before
  sending them.
- **Status**: Planned (phase 2).

### H2. A slow webhook receiver can stall all webhook deliveries — Read

- **Problem**: Outgoing requests (webhooks, bank sync) only have an *idle* timeout. A receiver
  that sends one byte every few seconds keeps the request open indefinitely. Deliveries run in
  one loop for the whole server, so it then stops for every workspace.
- **Impact**: Any workspace admin (anyone can create a workspace) can halt webhooks server-wide.
- **Fix**: An overall deadline per request (10 s for webhooks, 60 s for bank sync) as well as the
  idle timeout. Test with a receiver that drips bytes.
- **Status**: Planned (phase 2).

### H3. No way to recover a forgotten password — Read

- **Problem**: There is no "Forgot password?" flow. Better Auth's reset needs an email sender,
  which was never wired up.
- **Impact**: Anyone who forgets their password loses their account and data for good (unless
  they set up a passkey).
- **Fix**: With SMTP configured, "Forgot password?" emails a one-hour reset link; resetting signs
  out every other session. Without SMTP, the server owner can reset a password from the command
  line (`pnpm --filter @et/api reset-password <email>`, or `node dist/reset-password.js` in
  Docker).
- **Status**: Planned (phase 2).

### H4. Signing out doesn't always clear the device — Read

- **Problem**: The main menu's sign-out clears offline data, but signing out from an invitation
  page and deleting your account don't. Queued offline transactions, the cached reference data
  and the in-memory query cache are left for whoever signs in next.
- **Impact**: On a shared device, the next person could see the previous person's accounts and
  categories, and the outbox would try to send the previous person's queued transactions.
- **Fix**: One sign-out routine used everywhere (asks before discarding unsynced transactions);
  outbox items remember who queued them and are only sent for that person.
- **Status**: Planned (phase 2).

## Medium

### M1. No list of signed-in devices — Read

- **Problem**: You can't see where you're signed in or sign out a lost phone, except by changing
  your password.
- **Fix**: Settings → Security lists sessions (device, approximate place by IP, last active) with
  "Sign out" for each and "Sign out everywhere else". This relies on C1 for correct addresses.
- **Status**: Planned (phase 3).

### M2. No error page for crashes or stale app versions — Read

- **Problem**: There is no route error boundary. A rendering error, or a missing code chunk after
  a new version is deployed, shows the router's unstyled default error.
- **Fix**: A styled error page with "Reload" and "Go to dashboard"; a missing chunk reloads once
  automatically.
- **Status**: Planned (phase 3).

### M3. Removed members' access tokens come back if they're re-invited — Read

- **Problem**: Removing a member (or a member leaving) keeps their API tokens. They stop working
  only because the member check fails, so re-inviting the person silently revives old tokens.
- **Fix**: Delete the person's tokens for that workspace when they're removed or leave.
- **Status**: Planned (phase 3).

### M4. The example `AUTH_SECRET` is accepted in production — Read

- **Problem**: `.env.example`'s placeholder secret passes validation. Copying the example file
  makes session cookies and sealed secrets use a publicly known key.
- **Fix**: Refuse to start in production with the placeholder (or another obviously weak secret).
- **Status**: Planned (phase 3).

### M5. Any date from year 1 to 9999 is accepted — Reproduced

- **Problem**: Transactions dated `1800-01-01` or `9999-12-31` are saved. A slip like typing the
  Bikram Sambat year (2083) as AD puts a transaction decades away, where it skews forecasts and
  never shows in the expected month.
- **Fix**: Dates people enter (transactions, recurring items, goals, budgets, imports) must fall
  between 1900-01-01 and 2099-12-31, with a clear message.
- **Status**: Planned (phase 3).

### M6. Expired sessions, sign-in codes, invitations and tokens pile up — Read

- **Problem**: Nothing deletes expired rows from `session`, `verification`, `invitations` or
  `api_tokens`.
- **Fix**: The nightly clean-up deletes them (expired invitations after 30 days, so "this link has
  expired" still shows for a while).
- **Status**: Planned (phase 3).

## Low

### L1. SSRF block list misses some IPv6 forms — Read

- **Problem**: IPv4-mapped addresses are covered, but IPv4-compatible (`::/96`), 6to4
  (`2002::/16`) and Teredo (`2001::/32`) addresses aren't. They aren't normally routable, so this
  is defence in depth.
- **Status**: Planned (phase 4).

### L2. Inbound-email files are served without a CSP sandbox — Read

- **Problem**: Receipt attachments use `sandbox`; files from inbound email don't. Only images and
  PDFs are stored, so the risk is small.
- **Status**: Planned (phase 4).

### L3. Post-login redirect accepts `/\…` paths — Read

- **Problem**: Browsers read `/\example.com` like `//example.com`. Client-side navigation made
  this harmless in practice, but the check should reject it.
- **Status**: Planned (phase 4).

### L4. Offline transactions refused with 401 need a manual retry — Read

- **Problem**: If the session expired while offline, queued transactions are marked as failed
  instead of waiting for sign-in.
- **Status**: Planned (phase 4).

### L5. Production source maps are published — Read

- **Problem**: `sourcemap: true` serves full source maps with the app (about 6 MB extra).
- **Fix**: Build "hidden" source maps (written but not linked) so stack traces can still be
  decoded.
- **Status**: Planned (phase 4).

### Not changing (reviewed and accepted)

- **Sign-up says when an email is already registered.** Hiding it needs email verification on
  sign-up, which isn't possible on servers without SMTP. Sign-up is rate-limited per client
  (C1), and `ALLOW_SIGNUP=false` turns it off once your accounts exist.
- **Exports and backups are built in memory.** Fine for household-sized data (100k transactions
  is about 40 MB); streaming would be the next step for much larger workspaces.
- **Rate limits are kept in memory.** Correct for the single-process deployment the README
  describes; several API replicas would need a shared store.
