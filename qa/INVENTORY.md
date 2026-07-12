# Personal OS — QA Inventory, Acceptance Criteria & Edge Cases

Scope: the dashboard SPA (`index.html` + `js/*.js`) served statically, exactly as
GitHub Pages serves it (production-like: plain `http.server`, no Supabase creds,
localStorage only). The game (`games/`) carries its own regression suite
(`games/unicorn-janitor/playtest.mjs`, 19 checks) and is out of scope here.

Roles: single user (no auth). One optional "role" variant: Supabase sync
configured vs not — sync is opt-in via console (`Storage.configureSupabase`),
has no UI, and is NOT exercised here (would touch external services; ask first).

Test data: `qa/seed.mjs` generates sanitized production-scale data (no real
PII; names/vendors are synthetic) → `qa/seed-data.json`, loaded into
localStorage by the harness before app boot. Volumes: ~300 tasks, ~1,300
transactions across 18 months, 8 accounts, 6 goals, 10 habits × 18 months of
history, ~250 journal entries, ~160 calendar events (past+future), 8 brain
categories, ~120 notes with wiki-links/tags, 90 days of nutrition + water,
5 debts, rules/weak spots/profile, 12 finance snapshots.

Conventions verified globally on every page (the "shell criteria"):
- **G1** Route renders with production-scale data with zero console errors.
- **G2** Route renders in < 1.5 s with that data (static site; generous bound).
- **G3** All user strings render escaped (no live `<img onerror>` from data).
- **G4** Every mutation goes through `Storage.set` and survives a reload.
- **G5** Modal closes on ✕ and on overlay click; toast appears on mutations.

---

## Shell (`index.html`, `js/app.js`)

Controls: sidebar links ×10, sidebar toggle (mobile), Export Data, Import Data
(file input), clock, modal chrome, toasts. Router: `#/<page>/<sub>`.

Acceptance criteria:
- A1 Each of the 10 nav links routes, sets the active link and page title.
- A2 Unknown hash (`#/nope`) shows the "Page not found" empty state, no crash.
- A3 Export downloads a JSON containing every `os_*` key.
- A4 Import of that export restores all allow-listed keys (round-trip equality
  for tasks/finance/habits/nutrition/calendar/brain/journal/water) and ignores
  non-allow-listed keys (e.g. injected `supabase_url`).
- A5 Import of invalid JSON toasts an error and changes nothing.

Edge cases (risk-based):
- E-A1 Hash with sub-route on non-brain pages (`#/tasks/xyz`) still renders.
- E-A2 Import file containing `os_supabase_key` → key must NOT be written.

## Dashboard (`#/`)

Controls: Quick-capture button, Weekly Pulse link, habit quick-toggle buttons,
links to tasks/calendar/habits/finance.

Criteria: D1 counts (todo/in-progress/done, habit %) match the seeded data.
D2 habit toggle flips state, persists, updates streak. D3 blocked-tasks panel
lists tasks with blockers. D4 ⌘K button opens the capture palette.
Edge: E-D1 with 300 tasks the priority list shows only high-priority not-done.

## Quick Capture (global, `js/capture.js`)

Controls: Ctrl/Cmd+K toggle, input, arrow/Enter/Esc keys, result rows.

Criteria:
- C1 Ctrl+K opens; Esc and overlay-click close; input autofocuses.
- C2 Fuzzy search finds seeded items from ≥6 groups and navigates on Enter.
- C3 `t title !high @tomorrow #Cat` creates a task with parsed fields
  (due = real tomorrow date, priority high, category Cat).
- C4 `$ -12.50 lunch #Food` adds a transaction (amount −12.5, category Food);
  `$ lunch` (no amount) errors, does not write.
- C5 `j`, `n`, `e 14:00 …`, `w` each write their module's key; `w` caps at 20.
- C6 After capture the current page re-renders showing the new item.
Edge: E-C1 `@garbage` due token is dropped (no Invalid Date). E-C2 capture on
the graph page doesn't wedge the canvas loop. E-C3 palette lists navigation
for every page in the sidebar (10 pages — the missing ones are a finding).

## Task CRM (`#/tasks`)

Controls: Board/List toggle, + Add Task, kanban drag between 3 columns, card
click → edit modal (title/desc/priority/status/category/due/recurrence/
blockers), Edit/✕ in list view, Delete in modal.

Criteria:
- T1 Create → appears in correct column and in list view; persists.
- T2 Edit each field → persists (blockers split on newlines).
- T3 Drag card to Done: status changes; a recurring task spawns its next
  occurrence with rolled due date and a toast says so.
- T4 Recurrence roll always lands strictly in the future (daily/weekly/monthly),
  including a due date months in the past (guard loop).
- T5 Delete removes from both views.
Edge: E-T1 title of `<img src=x onerror=window.__xss=1>` renders inert
(G3 witness). E-T2 empty title save is rejected with a toast.

## Finance Pulse (`#/finance` — 5 tabs)

Overview: headline cards, reconciliation table + Sync button, accounts CRUD,
goals CRUD, transactions add/delete, overview settings save.
Profile: identity edit modal, rules add/delete, weak spots add/delete.
Debts: CRUD, payoff-months estimate, avalanche ordering.
Categories: derived breakdown from expense transactions.
Trends: snapshot CRUD, averages, bars.

Criteria:
- F1 Reconciliation `derived` figures equal (sum of account balances; this
  month's +txns; |−txns|; savings %). Sync overwrites the recorded figures and
  the drift flags clear.
- F2 Account/goal/transaction/debt/snapshot CRUD all persist and re-render.
- F3 Payoff estimate: payment ≤ monthly interest → "Never"; 0% APR →
  ceil(balance/payment).
- F4 Categories tab groups via `_mapCategory` (e.g. "Groceries" → Food) and
  percentages sum sensibly against total expenses.
- F5 With 1,300 transactions the Overview and Categories tabs meet G2.
Edge: E-F1 blank numeric inputs coerce to 0 (documented behavior, check no
NaN renders). E-F2 duplicate snapshot month is accepted (finding if it breaks
averages). E-F3 transaction with amount 0 (neither + nor −) doesn't corrupt
category totals.

## Habit Tracker (`#/habits`)

Controls: + Add Habit, 7-day toggle grid, quick-complete ("keep it") buttons,
edit ✏️ / delete ✕, insights cards.

Criteria:
- H1 Toggling any of the 7 day cells flips completion and recomputes streak
  from the full history (not just today).
- H2 At-risk list = streak ≥ 3 and today not done; quick-complete clears it.
- H3 30-day consistency and per-habit rates match the seeded history.
- H4 Add/edit/delete habit persists.
Edge: E-H1 habit with 540-day unbroken history → streak equals history length
capped at 365 (loop bound) — verify no hang.

## Nutrition (`#/nutrition`)

Controls: water +/−, Edit goals modal, + Add Meal (dynamic item rows), meal ✕.

Criteria:
- N1 Water increments/decrements clamp to [0, 20], persist per-day key.
- N2 Meal with multiple items sums calories/macros into the day cards.
- N3 Goals edit changes targets and progress bars.
- N4 Meal with no named items is rejected.
Edge: E-N1 negative macro input is accepted today — verify totals still render
finite (finding if UI shows NaN). E-N2 90 days of entries: today view filters
correctly.

## Calendar (`#/calendar`)

Controls: month prev/next/Today, + Event, day-cell click (0/1/n events), event
edit/delete via modal, agenda + upcoming lists.

Criteria:
- K1 Month grid always renders 42 cells; today is highlighted.
- K2 Day click: empty → new-event modal prefilled with that date; single →
  edit modal; multiple → chooser modal listing all.
- K3 Event CRUD persists; agenda sorts by time; upcoming sorts by date.
- K4 Month navigation crosses year boundaries both directions.
Edge: E-K1 event with quote/apostrophe in title renders and its inline
onclick still works (calendar still uses inline handlers — port opportunity).
E-K2 duration cleared → saves 0, renders "0 minutes" (documented, no NaN).

## Second Brain (`#/brain`, `#/brain/<catId>`)

Controls: search (debounced), + Category, + Note, .md import (multi-file),
category cards → sub-route, note rows → view modal (markdown render,
wiki-link chips), edit/delete note, edit/delete category.

Criteria:
- B1 Search filters by title/content/tag; clear restores.
- B2 Category CRUD; deleting a category orphans its notes (categoryId → null),
  never deletes notes.
- B3 Note CRUD; inline `#tags` and `[[wiki-links]]` are extracted on save.
- B4 View modal renders markdown (headers, bold, lists, checkboxes, code)
  from ESCAPED source; wiki-link chips navigate to the target note, unknown
  targets show the ⚠ dead-link chip.
- B5 .md import parses YAML frontmatter (title/tags/category/date), creates
  categories, strips wiki-link syntax in content.
Edge: E-B1 note titled with `&`/`<` displays correctly in the view-modal
TITLE (suspected double-escape finding). E-B2 search typed in the CATEGORY
sub-route keeps keyboard focus across the debounced re-render (suspected
focus-loss finding). E-B3 120 notes list meets G2.

## Knowledge Graph (`#/graph`)

Controls: highlight search, shared-tag checkbox, Re-layout, Import graph.json,
canvas (pan/zoom/drag/click node), hub/orphan jump chips, source tabs (after
import).

Criteria:
- R1 Node count = notes; link edges = resolved wiki-links; orphans/broken
  counts consistent with seed.
- R2 Node click opens the brain note modal; hub/orphan chips too.
- R3 Tag-edge overlay adds dashed edges without changing degrees/orphans.
- R4 graph.json import (valid {nodes,edges}) renders in imported mode;
  invalid file toasts an error.
- R5 Leaving the page stops the animation loop (no background CPU burn).
Edge: E-R1 120-node simulation stays interactive (frame under ~16 ms after
settle is not required; render under G2 is).

## Journal (`#/journal`)

Controls: + New Entry, entry cards → view modal, edit/delete, mood picker,
tags input, stats cards.

Criteria:
- J1 CRUD persists; entries sort newest-first by createdAt.
- J2 Mood picker selection saves; top-mood stat counts correctly.
- J3 Streak counts consecutive days with entries ending today.
Edge: E-J1 "This Week" card with entries dated in the future (import edge) —
finding if it counts them. E-J2 250 entries meet G2.

## Weekly Pulse (`#/pulse`)

Read-only aggregation: 4 stat cards, insights, habits-vs-mood line chart,
spend bar chart, habit heatmap, carried-over list.

Criteria:
- P1 Renders with full seed (insights present) AND with empty storage (all
  graceful fallbacks, avg mood "—", no NaN anywhere).
- P2 Consistency % equals mean of daily habit percentages over the last 7
  days; net = sum of week's transactions.
- P3 Charts are valid SVG (no NaN coordinates) for partial mood data.

## Diag (console-only)

Criteria: X1 `Diag.dump()` returns the ring buffer; storage-quota errors toast
once (not per keystroke).
