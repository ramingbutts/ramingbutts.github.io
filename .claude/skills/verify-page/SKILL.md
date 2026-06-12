---
name: verify-page
description: Verify a Personal OS dashboard page works after a change, the project's way. Use when the user wants to check/QA/test a dashboard page, confirm a new or edited page renders, or validate a change before shipping. There is no build or test suite — this skill runs static wiring checks and produces a concrete manual checklist tied to the real UI flow (open index.html, exercise the page, read Diag output).
disable-model-invocation: false
allowed-tools: Read, Grep, Glob, Bash
---

# /verify-page — QA a dashboard page

This project has no automated tests, no compile, no lint (CLAUDE.md: "There is
nothing to compile or lint"). Verification = static wiring checks you can run
here + a manual checklist the user runs in a browser. Do both.

## 1. Identify the page

Get the `page` id under test (from the user, the recent diff, or
`git diff --name-only`). Everything below keys off that id.

## 2. Static wiring checks (run these here)

For the page id, confirm all wiring points agree — a mismatch is the #1 cause of
a page silently not loading. Use Grep/Read:

- **Module registers itself:** `js/<page>.js` exists and contains
  `App.registerPage('<page>'`.
- **Script is loaded:** `index.html` has `<script src="js/<page>.js">`, placed
  after `app.js` (the `diag.js → storage.js → app.js` trio must remain first).
- **Nav + route match:** sidebar `<li>` has both `href="#/<page>"` and
  `data-page="<page>"` on the same element.
- **Title mapped:** `js/app.js` `_setPageTitle` `titles` map has a `<page>` entry.
- **Persistence (if any):** every `Storage.get/set('<key>')` the module uses has
  `<key>` in the `allowedKeys` allow-list in `Storage.importAll`.

Convention checks on the changed code:
- No inline `onclick` / interpolated raw `value` on **user content** — user text
  goes through `_esc()`, attributes through `App.escAttr()`.
- No direct `localStorage.` calls in the page module (must use `Storage`).
- User-facing dates use `App.getToday()`, not `toISOString().slice(0,10)`.

Report any failed check with the exact file/line; fixing them is usually a
one-liner (or re-run `new-page`).

## 3. Serve it (optional, if a browser is reachable)

The site is fully static. If you can preview, serve from the repo root and open
the page route:

```
python3 -m http.server 8000   # then open http://localhost:8000/#/<page>
```

In this headless environment you usually can't see the rendered DOM — in that
case skip to the manual checklist rather than guessing it "works".

## 4. Manual checklist (hand to the user)

Produce a checklist grounded in the page's *actual* UI flow, not generic
"verify it works". Template — adapt to what the page does:

- [ ] Open `index.html` (or the served URL) and click **<Display Title>** in the
      sidebar → page renders, sidebar item highlights, topbar title is correct.
- [ ] Console is clean — no errors on load. Run `Diag.dump()`; confirm no
      `error`-level entries from this page's actions.
- [ ] Golden path: <the create/edit action> → item appears immediately
      (re-render), and a success toast shows.
- [ ] Persistence: reload the page → the change is still there (came back from
      `Storage`).
- [ ] Edge cases: empty state shows when there are no items; deleting the last
      item returns to the empty state; long / special-character input
      (`<script>`, quotes, emoji) renders escaped, not as markup.
- [ ] Export Data → Import the file back → the page's data round-trips intact
      (this exercises the allow-list).
- [ ] Regression: sibling pages still load and the topbar clock still ticks.

Fill the bracketed parts in from the real module — reference the actual buttons
and fields by name.

## 5. Report

State plainly what passed and what didn't. If static checks failed, say so with
the file/line and don't claim the page works. If you couldn't render it, say the
manual steps are unverified-by-you and the user must run them. Never report
"verified" on the basis of static checks alone.

## Quality Standard

A good verification catches the silent-failure cases this stack is prone to:
missing script tag, allow-list gap (data lost on import), unescaped user input
(XSS), and midnight date drift. The manual checklist must name real UI elements
so the user can follow it without re-reading the code. Honesty over optimism —
"tests fail / unverified" is a valid and required outcome.

## Changelog
2026-06-09: Initial version. Static wiring + convention checks plus a
UI-grounded manual checklist (Diag.dump, export/import round-trip,
escaping, persistence on reload). Distinct from the generic `verify` skill.
