# QA findings — Personal OS dashboard

Campaign: full inventory pass per `qa/INVENTORY.md`, driven by `qa/e2e.mjs`
against `qa/seed-data.json` (production-scale sanitized data, 497 KB).
First run: 36/45 → after harness corrections 41/46 with **5 real product
bugs** → all fixed → final run **46/46 clean**. Every bug below has a
permanent regression check in the suite (id in parentheses).

## Root-cause cluster 1 — escaping in attribute context

**Bug 1 (K-quote) — user data silently truncated by a double quote.**
Repro: create a calendar event titled `Quote's "edge" check`, open it for
editing from the agenda. The title input shows only `Quote's ` — everything
from the `"` on is dropped, and saving persists the truncated title
(silent data loss). Evidence: `evidence/bug2-quote-truncated-title.png`.
Cause: every module's `_esc()` (the `div.textContent → innerHTML` trick)
escapes `< > &` but **not quotes**, while all edit modals interpolate
`value="${this._esc(...)}"` — the first `"` in user data terminates the
attribute. Affected identically: tasks, journal, calendar, brain, habits,
finance (accounts/goals/debts/profile), nutrition.
Fix: all 11 `_esc` copies now also escape `"` → `&quot;` and `'` → `&#39;`
(safe in both text and attribute contexts).

**Bug 2 (B-amp, B4) — note titles with `&`/`<` display double-escaped.**
Repro: open the seeded note `Fish & Chips <recipe>` — the modal title showed
`Fish &amp; Chips &lt;recipe&gt;`. Evidence:
`evidence/bug3-double-escaped-title.png`. Cause: `brain._viewNote` passed a
pre-escaped title into `App.openModal`, which assigns via `textContent`
(escaping is inherent — pre-escaping double-encodes). Fix: pass the raw
title. Same-family audit: no other module pre-escapes an `openModal` title.

## Root-cause cluster 2 — re-render drops focus

**Bug 3 (B-focus) — typing in the category search is interrupted.**
Repro: open any Second Brain category, type in its search box; after the
300 ms debounce the list re-renders and the input loses focus — the rest of
your word goes nowhere. Evidence: `evidence/bug4-search-focus-loss.png`.
Cause: `_renderCategory` rebuilds the input but, unlike `_renderCategories`,
never restores focus/caret. Fix: mirror the focus + `setSelectionRange`
restore.

## Completeness gap

**Bug 4 (C-nav) — palette can't navigate to 2 of 10 pages.**
The Ctrl+K palette's Navigate group omitted Knowledge Graph and Weekly
Pulse. Evidence: `evidence/bug1-palette-missing-nav.png`. Fix: entries added.

## Verified non-issues worth recording

- Stored XSS (G3): a task titled `<img src=x onerror=…>` renders inert
  everywhere it appears — the `_esc` discipline holds.
- Import allow-list (A3): a backup poisoned with `supabase_url`/`supabase_key`
  restores data but never writes the credential keys.
- Recurrence roll (T3): a weekly task 90 days overdue rolls to the next
  future date, not into the past.
- Habit streak loop bound (H1): a 400-day unbroken chain reads 365 (the
  documented cap) with no hang; untoggling today collapses it to 0 and back.
- Graph page (R5) cancels its animation loop on navigation — no background
  CPU burn.
- Payoff math (F3): payment ≤ monthly interest → "Never"; 0% APR divides
  linearly.
- Pulse (P-empty) renders every empty-module fallback without NaN.

## Known accepted behaviors (documented, not fixed)

- Blank numeric inputs coerce to `0` on save (finance settings, event
  duration) — consistent across modules; no NaN ever renders.
- Deletes are immediate with no confirm dialog — consistent app-wide.
- Calendar retains the last-viewed month across page switches ("Today"
  resets it).
- The Supabase sync path is opt-in via console, has no UI, and was not
  exercised (external service — out of scope without explicit approval).

## How to rerun

```
node qa/seed.mjs                       # regenerate seed (deterministic)
python3 -m http.server 8099            # repo root
node qa/e2e.mjs                        # 46 checks; exits non-zero on failure
```
