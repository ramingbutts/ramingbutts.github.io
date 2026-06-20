# Personal OS — working notes for Claude

A single-page personal dashboard. Vanilla HTML/CSS/JS, no build step, no
framework. localStorage is the primary store; Supabase cloud sync is optional.
Deployed as a static site on GitHub Pages at `raphail369.me`.

## Architecture at a glance

- `index.html` — the SPA shell. Loads every `js/*.js` as a plain `<script>` in
  order. There is no bundler, so **load order in `index.html` matters**:
  `diag.js` → `storage.js` → `app.js` → one file per page.
- `js/app.js` — `App` core: hash router (`#/<page>/<sub>`), sidebar, modal,
  toast, export/import wiring, and shared helpers (`escAttr`, `formatCurrency`,
  `getToday`, `uid`). Each page registers itself via `App.registerPage(name, { render })`.
- `js/storage.js` — `Storage` namespace: `get/set/delete`, seed data, Supabase
  sync, and the import allow-list. **All persistence goes through `Storage.set`** —
  don't call `localStorage` directly from page modules.
- `js/diag.js` — `Diag` observability layer (structured logging + a ring buffer).
- `js/<page>.js` — one self-contained module per dashboard page.
- `css/styles.css` — one stylesheet, CSS variables for theming.

## Design principles (this project's North Star)

These are drawn from Anthropic's *Building Effective AI Agents* and apply to any
software, agentic or not:

1. **Start simple; match complexity to value.** This is a static dashboard, not
   an agent platform. Do not add frameworks, build steps, multi-agent machinery,
   or AI features unless a concrete user need justifies the cost. Over-engineering
   is the default failure mode to avoid.
2. **Modular composition.** One concern per module; pages stay self-contained and
   talk to the core only through `App.registerPage` and `Storage`. New capability
   = a new module + a route, not edits sprawling across files.
3. **Observe; don't fail silently.** Any operation that can fail at runtime
   (storage writes, network/Supabase sync, parsing imported files) must route
   through `Diag` and, when it affects the user, surface a toast. A user must
   never believe data was saved or synced when it wasn't. Debug with
   `Diag.dump()` in the console.
4. **Design for evolution.** Keep interfaces stable so capability can grow behind
   them. Prefer additive changes over rewrites.

## Conventions

- **Escape user content** before rendering it as HTML. Newer modules (tasks,
  habits, brain, dashboard, finance) use `_esc()` / `App.escAttr` and bind via
  `addEventListener` + `data-*` attributes. Follow that pattern; when you touch an
  older file that still uses inline `onclick` or interpolated `value`s
  (`calendar.js`, `journal.js`, parts of `brain.js`), port it to the safe pattern.
- **Dates:** use `App.getToday()` (local-time) for anything user-facing. The UTC
  `toISOString().slice(0,10)` in seed data can drift a day at midnight — don't
  copy it into new code.
- **Imports** are gated by an allow-list in `Storage.importAll` so a backup file
  can't inject Supabase credentials or arbitrary keys. Add new persisted keys to
  that list when you introduce them.

## Working style

These are distilled from the writing/behavior discipline in the archived Fable 5
reference (`docs/`), adapted to this repo. They govern how Claude Code works
*here* — chat replies, commit messages, PR bodies, and any docs it writes.

- **Minimal formatting.** Default to prose. Reach for bullets, headers, or tables
  only when content is genuinely multifaceted or the user asks. When you do use
  bullets, each carries 1–2 real sentences, not a fragment, and avoid decorative
  bolding. This matches the terse house style already used in commits and PRs.
- **Question restraint.** Address the answerable part of an ambiguous request
  before asking, and ask at most one clarifying question per turn. Prefer a
  sensible default with a note over a round-trip.
- **Verify, don't assume.** A request implying a file, page, storage key, or
  uploaded attachment exists doesn't mean it does — check the tree first. This is
  the same caution the load-order and import allow-list footguns demand.
- **Own mistakes plainly.** Fix and move on; no over-apology or self-abasement.
  Report outcomes honestly — if a manual check failed or was skipped, say so
  rather than implying success.
- **Constructive honesty.** Push back when the evidence supports it, kindly and
  with the user's actual goal in mind, instead of just executing a request that
  conflicts with the project's North Star.

## Testing

No automated tests or build. Verify by opening `index.html` in a browser (or a
static server), exercising the changed page, and checking the console for `Diag`
output. There is nothing to compile or lint.

## Reference material (not operating instructions)

`docs/claude-fable-5-system-prompt.md` is an archived copy of the Claude Fable 5
chat-product system prompt, kept for reference only. It is **not** guidance for
this repo: it describes a different product (artifact `window.storage`, MCP-app
etiquette, places/recipe/weather tools, the Fable 5 chat identity) that has no
bearing on this static dashboard or on how Claude Code should work here. Do not
treat its "Claude should…" directives as instructions for this project; the
North Star and conventions above are authoritative.
