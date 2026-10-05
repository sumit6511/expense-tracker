# UI/UX audit (October 2026)

A review of the whole interface, run against the live app rather than read from code alone.
Nothing has been changed yet; this is the plan.

## How it was checked

- **Every screen**: 39 routes and tabs (all report and settings tabs, account and split-group
  pages, sign-in pages, 404) at 1440×900, 820×1180 and 390×844, in light and dark, so 234
  full-page captures. Each page was also checked for sideways overflow, console errors and
  load time.
- **Automated accessibility**: axe-core (WCAG 2.0/2.1 A and AA, plus best practices) on every
  desktop and phone capture.
- **Interactions**: the add/edit transaction forms, transfer, bulk selection, command palette,
  notifications, workspace switcher, user menu, the phone "More" sheet, account, rule and
  recurring dialogs.
- **Keyboard**: a 40-stop Tab walk of the dashboard, plus focus behaviour after navigating.
- **States**: a brand-new empty workspace, slowed API responses (loading), a server error and a
  network failure.
- **Touch targets**: measured on phone layouts.
- **Code**: design tokens, the type scale, component variants, icon-button names and motion
  settings.

## What's already good (keep it)

- **No sideways overflow** on any page at any size. Long lists, tables and filter bars scroll
  inside their own containers.
- **One colour system.** Colours come from theme tokens (no hard-coded palette classes), and
  dark mode is cohesive rather than inverted.
- **Visible keyboard focus** on every stop, with a single global `:focus-visible` style.
- **Named icon buttons.** All 40 icon-only buttons have accessible names.
- **Reduced motion** is honoured globally, and the page language follows the person's
  language setting.
- **States exist.** Empty states are friendly and specific, errors offer "Try again", and the
  offline banner and route error page are in place.
- **Good bones.** Clear hierarchy on the dashboard and budgets, consistent card language,
  a good command palette and a working bottom navigation on phones.

The plan below keeps the visual identity: teal brand, rounded cards, Inter, the Bikram Sambat
first design. It fixes what's broken or inconsistent and does no redesign for its own sake.

Effort: **S** = under half a day, **M** = half a day to two days, **L** = more than two days.

---

## Critical: excludes people or breaks core use

### UX-C1. Text that fails contrast in the app's main meaning colours — S

- **Evidence (axe, 26 elements on 16 pages).**
  - Income green `#108846` on the page background is 4.33:1 (it needs 4.5:1). It's used for
    every income amount, "+Rs." totals, "you lent" and similar.
  - The destructive button in dark mode (white on `#f4514f`) is 3.27:1, e.g. "Delete
    workspace".
  - Positive and destructive badges at 11 px are 3.88:1 and 4.03:1 (Integrations status).
  - Tag colours used as text (sky `#0284c7`, rose `#e11d48`) are 3.9–4.5:1 in both themes
    (transaction rows, Tags report).
- **Why it matters.** Money direction is the most important signal in the app, and people with
  low vision or reading in sunlight lose it.
- **Fix.**
  - Darken `--positive` in light mode and `--destructive` (as a button background) in dark mode
    until they reach 4.5:1.
  - Give badges a one-step-darker foreground.
  - Render tags as a coloured dot plus neutral text instead of coloured text, or derive a
    readable shade per theme.
  - Keep the hues so the identity doesn't change.

### UX-C2. Keyboard and screen-reader navigation gaps — M

- **Evidence.**
  - **No skip link.** Tab reaches page content only after 16 sidebar stops.
  - **Navigation is silent.** After a link is clicked, focus stays on that link and the tab
    title stays "Expense Tracker", so screen readers don't announce the new page. Only the
    monthly report sets a title.
  - **Charts are noise.** The dashboard pace chart takes focus and is read as
    "135791113…50K1L1.5L".
  - **Unnamed bars.** 152 progress bars on Payees/Tags reports have no accessible name.
  - **Scroll areas.** The horizontally scrollable tables on 5 report tabs (Cash flow, Budget,
    Net worth, Compare, Calendar) can't be reached by keyboard on phones.
  - **Landmarks and headings.** Sign-in, sign-up, password, invitation and 404 pages have no
    `<main>` landmark; the 404 page has no `<h1>`; Rules settings skips a heading level; the
    exchange-rates table has an empty header cell.
  - **Icon labels.** Row indicator icons carry `aria-label` on an `<svg>` without
    `role="img"`, which screen readers announce inconsistently.
- **Why it matters.** Keyboard and screen-reader users can use every feature, but slowly and
  without being told where they are. These are WCAG 2.4.1, 2.4.2, 1.1.1, 4.1.2 and 2.1.1
  failures.
- **Fix.**
  - **Skip link** in the app shell.
  - **Per-route titles** ("Transactions · Personal · Expense Tracker"), and on navigation move
    focus to the page `<h1>`, made focusable with `tabIndex={-1}`.
  - **Charts:** give each chart a one-sentence summary as its accessible name (e.g. "Spent
    Rs. 96,075 of Rs. 1,10,000; on pace line by day 31") and hide the decorative SVG
    internals.
  - **Progress bars:** name them ("Food & Groceries, 31% of spending").
  - **Scroll areas:** make them focusable (`tabIndex={0}`, `role="region"` and a label).
  - **Structure:** wrap the sign-in shell and 404 page in `<main>`, fix the heading level,
    label the empty header cell, and add `role="img"` to the labelled icons.

### UX-C3. Touch targets too small on phones — M

- **Evidence.**
  - **Row checkboxes:** each transaction row's checkbox is 18×18 px (100 of them on the
    Transactions page), right next to the row's own tap target, so a near-miss opens the editor
    instead.
  - **Card links:** "See all", "Manage", "Reports" and "Recurring" are 16 px tall.
  - **Budget category names** are 20 px tall.
  - On the phone dashboard, 18 of 45 controls are under 40 px.
- **Why it matters.** Mis-taps on the most-used list, and a WCAG 2.5.8 (24 px minimum) failure.
- **Fix.**
  - **Selection on touch:** hide row checkboxes and add a selection mode. Long-press a row, or
    "Select" in the header, then show 40 px checkboxes.
  - **Bigger hit areas, same look:** keep the visible size and expand the hit area with
    padding plus negative margin (`py-2 -my-2`). Do this for card-header links and inline text
    links.
  - **Desktop** keeps today's always-visible checkboxes.

---

## High: visible bugs and friction in core flows

### UX-H1. Segmented controls wrap their labels — S

- **Evidence.** "Paste SMS / alerts" on Import and "Uncategorized / · 3" on Review break onto
  two lines even at 1440 px wide.
- **Cause.** `Segmented` buttons use `flex-1` with `text-balance` inside a shrink-to-fit
  container, so the browser sizes them to the narrowest wrap.
- **Fix.** Make items `whitespace-nowrap` with `flex-auto`, sized to their content (or an equal
  grid when a full-width variant is asked for). One component, so it fixes every use.

### UX-H2. Adding and editing a transaction look like two different forms — M

- **Evidence.** "New expense" opens as a centred dialog; editing opens as a right-hand side
  panel with a different field order (no Describe-it or type tabs, different footer).
- **Why it matters.** This is the app's most-used form. Two layouts mean two things to learn,
  and the position of Save changes.
- **Fix.**
  - Use one presentation for both: the side panel on desktop, and the bottom sheet that already
    works on phones.
  - Same field order and same footer position; the edit-only actions (Delete, Make recurring)
    sit on the left of the footer.
  - The E2E tests need their dialog selectors updated.

### UX-H3. Bulk actions bar is cramped and unclear — S

- **Evidence.**
  - At 1440 px the bar wraps into two rows ("2 selected · All" above the actions, indented).
  - "All" selects only the rows loaded on this page (100 of 293), but doesn't say so.
  - Escape doesn't clear the selection.
- **Fix.**
  - One row: "2 selected · Select all 100 shown | Categorize ▾ | Tag | Mark reviewed |
    Status | Delete | ✕".
  - Escape clears the selection.
  - Keep the list's bottom padding at least as tall as the bar.
  - On phones, put the bar above the bottom nav and move rarer actions into a "More" menu.

### UX-H4. New budgets: the empty state points elsewhere, and two actions do nothing — S

- **Evidence.** The empty Budgets page says to "Turn on 'Show all categories' and type an
  amount". The switch is in another card and there's no button. "Copy last month" and "Use
  3-month averages" stay enabled with nothing to copy or average.
- **Why it matters.** Budgets are the core value, and new users stall here.
- **Fix.**
  - A primary "Set budgets" button that turns on all categories and focuses the first amount.
  - Disable the two actions, with a tooltip explaining why, until there's last month's budget
    or three months of spending.

### UX-H5. On phones, Recent transactions sit at the bottom of a 3,000 px dashboard — S

- **Evidence.** The phone dashboard order is: hero, totals, review items, Worth knowing, Where
  it went, Accounts, Goals, Coming up, and Recent last.
- **Fix.**
  - Reorder for small screens: hero, review items, Recent (5 rows), Coming up, then the rest.
  - Make Worth knowing collapsible.
  - The desktop grid order stays the same.

### UX-H6. Row indicators are icons with no visible explanation — S

- **Evidence.**
  - On transaction rows, the inbox icon means "Needs review", the paperclip means
    attachments, and a padlock means reconciled.
  - On split expenses, the link icon means "Recorded in your accounts".
  - Next to budgets, ⇄ means rollover.
  - A small coloured letter (e.g. a red "S") is the avatar of whoever added the transaction,
    but it reads like a status badge.
  - All of these have screen-reader labels but no hover or long-press text.
  - Only 5 files use tooltips at all.
- **Fix.**
  - Wrap each indicator in the existing `Tooltip`; use `title` as the fallback on touch.
  - Give the "added by" avatar a ring and the tooltip "Added by Sita".
  - Show the "Needs review" icon only outside the Review page, where every row needs review.

### UX-H7. Money and dates are formatted differently from widget to widget — S

- **Evidence.**
  - Recent shows "-Rs. 1,450.00" while Coming up shows "-Rs. 2,500" and Where it went shows
    "Rs. 25,000". This comes from `trimZeroFraction` being applied ad hoc.
  - Compact lists truncate long dates ("Wednesday, 1…", "Uncatego…") on the dashboard and on
    phones.
- **Fix.**
  - **Money rule:** headline numbers and summaries drop ".00"; lists and tables of individual
    transactions keep decimals so the column lines up. Write it down in `lib/format.ts` and
    apply it everywhere.
  - **Dates:** compact lists use a short date ("Today", "Yesterday", "Wed 14", "14 Asoj")
    instead of the long weekday form.

---

## Medium: consistency, discoverability, layout

### UX-M1. Settings: personal and security options are hard to find — S

- **Evidence.**
  - "Profile" sits in the same flat list as workspace settings (Categories, Rates…).
  - Two-step sign-in, passkeys, password and signed-in devices are all inside Profile.
  - On phones, signing out is only reachable through Settings → Profile; there's no account
    entry in the top bar or the More sheet.
- **Fix.**
  - Group the settings nav under **Workspace** (General … Data) and **You** (Profile, Security,
    Notifications).
  - Move the security cards to a "Security" tab.
  - Add an account row (avatar, Profile, Sign out) to the phone More sheet.

### UX-M2. Two ways of saving on one settings page — S

- **Evidence.** In Settings → General, the Workspace card needs "Save", while the Display card
  (language, number format, theme) applies instantly. Save is always enabled, there's no
  "unsaved changes" hint, and leaving the page drops edits silently.
- **Fix.** Disable Save until something changed and show "Unsaved changes" next to it, or
  autosave the workspace fields like the Display card does. One pattern for all settings.

### UX-M3. Dashboard pace chart is taller than it needs to be — S

- **Evidence.** About 450 px on desktop, which pushes Where it went, Accounts and Goals below
  the fold.
- **Fix.** Cap the chart at about 240 px on desktop, keep the axis labels, and let the cards
  rise.

### UX-M4. Tablet portrait uses the phone layout, stretched — M

- **Evidence.** At 820 px, a single column of full-width cards with lots of empty space; the
  sidebar only appears from 1024 px.
- **Fix.** Use a two-column card grid from 768 px on the dashboard, reports and settings (the
  `md:` breakpoint). Keep the bottom nav.

### UX-M5. Loading and error states show placeholders where real values are known — S

- **Evidence.**
  - While loading, the dashboard and budgets title shows "•••" instead of "Asoj 2083", even
    though the month can be worked out on the device. It stays "•••" in the error state.
  - Skeletons are flat blocks that don't match the content's shape.
  - In an error state, page actions ("Copy last month") stay enabled.
- **Fix.**
  - Work out the month label locally with `getMonthPeriod`.
  - Skeleton rows shaped like the content: row height, icon circle, two text lines.
  - Disable data actions while the page is in an error state.

### UX-M6. Empty Transactions and Reports offer the wrong tools — S

- **Evidence.**
  - With no transactions, the page still shows the full filter bar, Export CSV, Trash and "0
    transactions · In Rs. 0 · Out Rs. 0".
  - The copy says "Add one, or import a statement", but only the Add button exists.
  - Reports shows nine tabs of "No spending in this period" with no way forward.
- **Fix.**
  - Hide the filters, summary and Export until there's data.
  - Add an "Import statement" button to the empty state.
  - Reports' empty state links to Add transaction and Import.

### UX-M7. Search and filters on phones — S

- **Evidence.**
  - The search placeholder ends with "( / )", a keyboard shortcut hint that means nothing on
    touch.
  - The filter chips scroll sideways with no visual cue that there are more.
- **Fix.**
  - Show the shortcut as a small key badge, on devices with a keyboard only.
  - Add a fade at the scrolling edge of the chip row.

### UX-M8. Overdue bills can't be recorded from the dashboard — S

- **Evidence.** Coming up shows "Electricity · 5 days overdue" in red with no action. The
  Recording action exists only on the Recurring page.
- **Fix.** Add a compact "Record" button on overdue and due-today items, reusing the existing
  Record flow.

### UX-M9. Spending-by-day heatmap glitch on phones — S

- **Evidence.** On the Calendar report, cells scroll into the gutter to the left of the sticky
  weekday labels.
- **Fix.** Give the sticky label column a background that covers the container's padding, or
  clip an inner wrapper.

---

## Low: polish

### UX-L1. Text below 11 px, and one-off font sizes — S

- **Evidence.** 8 px initials in the extra-small avatars, 9 px in the date picker, 10 px chart
  and heatmap labels. Arbitrary sizes are used 50 times (`text-[13px]` ×24, `text-[11px]` ×18,
  plus 10/9/8 px).
- **Fix.** Add two tokens to the type scale (`text-2xs` = 11 px, `text-sm-` = 13 px), replace
  the arbitrary values, and use 11 px as the floor.

### UX-L2. Page headers come in five styles — S

- **Evidence.**
  - Five different heading class combinations.
  - The month-navigation headers (Dashboard, Budgets) are built separately from `PageHeader`.
  - On tablet and dashboard, the "next month" arrow sits far from the title.
- **Fix.** Give `PageHeader` a `leading` slot for month navigation and use it on every page
  (it pairs with UX-C2's per-route titles).

### UX-L3. Crowded phone headers — S

- **Evidence.** On phones, the Transactions header gives Export CSV and Trash full buttons next
  to the title.
- **Fix.** Collapse rare actions into a "⋯" menu below 640 px.

### UX-L4. Small feedback gaps — S

- **Budget amounts** save silently; add a brief tick next to the field.
- **Notifications** say "4 d ago"; use "4 days ago". A 4-day-old "due today" notification
  contradicts "5 days overdue" on the dashboard; reword it to "was due on 14 Asoj".
- **Recurring:** "Bills per month -Rs. 41,200" shows a redundant minus.
- **Split:** in People, "Paid · share" wraps on some rows but not others; keep it on one line
  or always stack it.

### UX-L5. Micro-interactions (restrained) — S

- **Pressed state** on buttons (`active:` one step darker).
- **Hover and lift** on clickable cards: a hover background and a 150 ms transition.
- **Newly added rows** highlight briefly when they appear in a list.

All of this respects reduced motion (already global). No number tweening and no page
transitions.

---

## Dependencies

```
UX-C1 tokens ─────────────┬──> every later visual change (colours are used everywhere)
UX-L1 type scale ─────────┤
UX-H1 Segmented fix ──────┘
UX-H6 tooltip pattern ────────> UX-H3 bulk bar, UX-H4 disabled-action tooltips
UX-H7 formatting rules ───────> UX-H5 phone dashboard, UX-M8 dashboard "Record"
UX-C2 per-route titles ───────> UX-L2 header unification (same title source)
UX-H2 one transaction form ───> UX-C3 phone selection mode (same list and editor)
UX-M1 settings IA ────────────> UX-M2 save pattern (settings layout settled first)
```

## Phased plan

Each phase ends with the same checks:

- re-run the audit crawl (axe, overflow, screenshots at 3 sizes × 2 themes);
- the API and E2E suites;
- a look at the changed screens in both themes.

The target after phase 2 is **zero serious or critical axe violations**.

| Phase | Contents | Why this order |
|---|---|---|
| **1. Foundations** | C1 contrast tokens, L1 type scale, H1 Segmented, H6 tooltip pattern, H7 formatting rules, hit-area utility (part of C3) | Shared tokens and components; everything after builds on them, and visual diffs stay small. |
| **2. Accessibility infrastructure** | C2 (skip link, titles and focus on navigation, landmarks, chart summaries, progress bar names, scroll regions, headings) | One pass through the app shell and charts. Meets WCAG AA. |
| **3. Core flows** | H2 one transaction form, H3 bulk bar, C3 phone selection mode, H5 phone dashboard order, M3 chart height, M8 dashboard "Record" | The most-used journeys. Needs the E2E selector updates. |
| **4. States and first run** | H4 budgets empty state, M5 loading and error placeholders, M6 empty Transactions and Reports | Smooths a new person's first ten minutes. |
| **5. Structure and responsive** | M1 settings groups and Security tab, M2 save pattern, M4 tablet grid, M7 phone search and filters, L3 phone headers, M9 heatmap | Layout work, once the components are settled. |
| **6. Polish** | L2 header unification, L4 feedback copy, L5 micro-interactions | Last, so it isn't redone. |

## Status

| ID | Priority | Effort | Phase | Status |
|---|---|---|---|---|
| UX-C1 | Critical | S | 1 | Fixed (phase 1): 0 contrast violations on all routes, both themes, desktop and phone |
| UX-C2 | Critical | M | 2 | Fixed (phase 2): full axe WCAG 2.2 AA and best-practice run reports no violations on any route (desktop and phone, both themes); E2E test covers the skip link, titles and focus after navigating. The Payees/Tags bars are hidden from screen readers rather than named, since each row already reads out its name and amount |
| UX-C3 | Critical | M | 1 (hit areas) + 3 (selection mode) | Fixed (phases 1 and 3): on touch screens the checkboxes appear only in selection mode (long-press a row, or "Select"), where a tap selects; E2E test on a phone |
| UX-H1 | High | S | 1 | Fixed (phase 1): every label on one line at 1440 and 390 px except the calendar options on phones, which wrap as intended |
| UX-H2 | High | M | 3 | Fixed (phase 3): new and edit both open as the side panel (bottom sheet on phones), with the same type switch (an edit can turn an expense into income) and the same footer |
| UX-H3 | High | S | 3 | Fixed (phase 3): one row from 768 px (Tag and Status move to "More" below 1280 px), two rows on phones, "Select all 100 shown", Escape clears, room left below the list; E2E test |
| UX-H4 | High | S | 4 | Planned |
| UX-H5 | High | S | 3 | Fixed (phase 3): phones show hero, review, Recent (5), Coming up, then the rest, in DOM order; Worth knowing folds away |
| UX-H6 | High | S | 1 | Fixed (phase 1) |
| UX-H7 | High | S | 1 | Fixed (phase 1) |
| UX-M1 | Medium | S | 5 | Planned |
| UX-M2 | Medium | S | 5 | Planned |
| UX-M3 | Medium | S | 3 | Fixed (phase 3): chart 240 px; Where it went and Accounts start at 576 px instead of 814 px at 1440×900 |
| UX-M4 | Medium | M | 5 | Planned |
| UX-M5 | Medium | S | 4 | Planned |
| UX-M6 | Medium | S | 4 | Planned |
| UX-M7 | Medium | S | 5 | Planned |
| UX-M8 | Medium | S | 3 | Fixed (phase 3): "Record" on due and overdue reminders in Coming up, sharing the Recurring page's code; E2E test |
| UX-M9 | Medium | S | 5 | Planned |
| UX-L1 | Low | S | 1 | Fixed (phase 1): no arbitrary pixel font sizes left |
| UX-L2 | Low | S | 6 | Planned |
| UX-L3 | Low | S | 5 | Planned |
| UX-L4 | Low | S | 6 | Planned |
| UX-L5 | Low | S | 6 | Planned |

## Deliberately not changing

- **Brand.** The teal brand colour, rounded-card language, Inter, and the dashboard's overall
  layout.
- **Charts.** No new chart types. The bar lists in Reports are clearer and more accessible than
  a donut would be.
- **List performance.** The transaction list renders 100 rows per page. Load times in dev mode
  (2.4–3.9 s to settle) aren't representative of the production build; measure there before
  considering virtualisation.
