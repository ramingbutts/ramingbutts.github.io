# Personal OS

A self-hosted personal operating system that tracks every area of life in one dashboard. Tasks, finances, habits, nutrition, calendar, notes, and journaling — all in a single sharp dark-mode interface, deployable as a static site.

Live at **[raphail369.me](https://raphail369.me)**.

---

## What it is

Inspired by [Miles Deutscher's personal OS build](https://twitter.com/milesdeutscher), this is a single-page web app that consolidates the tools most people scatter across 8+ apps (Notion, Apple Notes, Google Sheets, Mint, Obsidian, Cron, etc.) into one home base.

No build step. No framework. Vanilla HTML/CSS/JS with localStorage persistence and optional Supabase cloud sync — runs on GitHub Pages and works offline.

---

## Features

### 9 dashboard modules

| Module | What it does |
|---|---|
| **Dashboard** | Daily home base — net worth, priority tasks, today's schedule, habit progress, finance accounts, blockers |
| **Task CRM** | Kanban board with drag-and-drop + list view, priorities, categories, and per-task blocker tracking |
| **Finance Pulse** | Five sub-tabs: Overview, Investor Profile, Debt Tracker (with payoff projections + avalanche strategy), Expense Categories (auto-categorized), Monthly Trends |
| **Habit Tracker** | Weekly grid view with streak tracking and per-category breakdowns (health, productivity, finance) |
| **Nutrition** | Macro tracking (calories, protein, carbs, fat), meal logging, water intake |
| **Calendar** | Monthly grid with events, today's agenda, upcoming preview |
| **Second Brain** | Categorized notes with Obsidian `.md` import — parses YAML frontmatter, `#tags`, `[[wiki-links]]`, auto-creates categories from folder paths |
| **Knowledge Graph** | Interactive graph of your notes — nodes sized by link count, hub/orphan/broken-link detection, suggested connections, Graphify CLI import support |
| **Journal** | Daily entries with mood picker, tag support, and streak tracking |

### Data layer

- **localStorage by default** — works immediately, data persists per-browser
- **Supabase hooks ready** — to enable cloud sync, load `@supabase/supabase-js` (e.g. add `<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"></script>` to `index.html`), then call `Storage.configureSupabase(url, key)` in the browser console
- **Export / Import** — JSON backup buttons in the sidebar; import is whitelisted to prevent overwriting Supabase credentials
- **Auto-migration** — old HTML entity icons migrate to emoji on load
- **Observability** — `js/diag.js` centralizes structured logging in an in-memory ring buffer; storage-quota and Supabase-sync failures (previously silent) now log and surface a toast. Inspect with `Diag.dump()` in the console

### Security posture

The modules touched most often (Tasks, Habits, Brain, Dashboard, Finance) escape user-controlled content through `_esc()` before rendering and bind handlers via `addEventListener` + `data-*` attributes. Older modules (`calendar.js`, `journal.js`, parts of `brain.js`) still mix in inline `onclick` handlers and template-interpolated input `value`s — these work but are riskier with imported data. When adding new code, follow the safer pattern; when touching the older files, port them over.

- Import key whitelist blocks credential injection via backup files
- Date strings written by the app use local-time formatters (`getToday()` in `js/app.js`); the original seed data in `storage.js` uses UTC `toISOString().slice(0,10)` which can drift by a day at midnight

---

## Tech stack

| Layer | Choice |
|---|---|
| Markup | Single `index.html` SPA shell |
| Styles | One `css/styles.css` file, CSS variables for theming |
| Logic | Vanilla JS, one module per page in `js/<page>.js` |
| Routing | Hash-based router (`#/dashboard`, `#/finance`, etc.) |
| Storage | localStorage (primary) + Supabase (optional) |
| Hosting | GitHub Pages |
| Domain | `raphail369.me` via CNAME |

No npm, no webpack, no build. View source, edit, refresh.

---

## How to use it

### Daily workflow

1. **Morning** — Open the Dashboard. Scan net worth, priority tasks, today's schedule, habit progress.
2. **Throughout the day** — Toggle habits from the dashboard, add tasks via the CRM, log meals/water in Nutrition.
3. **End of day** — Write a journal entry, update finance overview if needed.
4. **End of month** — Log a snapshot in Finance → Trends to track income vs expenses vs savings over time.

### Importing existing data

- **Obsidian vault** — Second Brain → Import .md → select all `.md` files. Tags, wiki-links, and categories auto-parse.
- **Graphify report** — Knowledge Graph → Import graph.json (from `graphify-out/`)
- **Backup file** — Sidebar → Import Data → select an exported JSON file

### Voice control

Not built in — the static site can't receive webhooks. But the Telegram + Whispr + Vercel setup from the Miles Deutscher guide will work with this OS once the Supabase sync is configured.

---

## Project structure

```
ramingbutts.github.io/
├── index.html              # SPA shell
├── css/styles.css          # All styles
├── js/
│   ├── app.js              # Router + global helpers
│   ├── storage.js          # localStorage + Supabase + migrations
│   ├── dashboard.js        # Homepage
│   ├── tasks.js            # Task CRM
│   ├── finance.js          # Finance Pulse (5 sub-tabs)
│   ├── habits.js           # Habit Tracker
│   ├── nutrition.js        # Nutrition Tracker
│   ├── calendar.js         # Calendar
│   ├── brain.js            # Second Brain
│   ├── graph.js            # Knowledge Graph
│   └── journal.js          # Journal
├── docs/
│   └── GRAPHIFY.md         # Knowledge Graph + Graphify integration
├── .claude/
│   └── skills/
│       └── ship/SKILL.md   # /ship slash command for commit→push→PR
├── CNAME                   # raphail369.me
└── README.md
```

---

## Adding a new module

Follow the existing pattern in any `js/<module>.js`:

```js
App.registerPage('mymodule', {
  render(container, sub) {
    container.innerHTML = `...`;
    container.querySelector('.btn').addEventListener('click', () => { /* ... */ });
  },
  _esc(s) { /* HTML escape helper */ }
});
```

Then add the sidebar link in `index.html` and the title in `app.js` → `_setPageTitle()`.

---

## Shipping changes

This repo includes a `/ship` Claude Code skill at `.claude/skills/ship/SKILL.md`. In any Claude Code session in this repo, after making changes type:

```
/ship
```

It will check git status, commit with the project's structured message format, push to the feature branch with `--force-with-lease`, and open a PR with Summary + Test plan sections.

---

## Hard rules

- Never push directly to `main` — always feature branch + PR
- Never commit `.env` or credential files
- Never use inline `onclick` with interpolated user-controlled IDs (XSS vector)
- Always escape user content before `innerHTML`
- Always include `## Summary` and `## Test plan` in PR bodies

---

## Optional integrations (not yet wired)

| Integration | What it'd add |
|---|---|
| Supabase | Cross-device sync, AI extraction of data for ChatGPT/Claude |
| Google Calendar API | Auto-pull real meetings into the Calendar module |
| Plaid / bank APIs | Live finance data instead of manual entry |
| Telegram BotFather + Whispr + Vercel | Voice prompts from your phone |
| Graphify CLI | Deeper note graph analysis with LLM-powered semantic extraction |

---

## Backups

Click **Export Data** in the sidebar to download a JSON file with all your data. Drop it back in via **Import Data** anytime. Recommended cadence: weekly, or before any major data import.

---

## License

No license file is included, so the code is "all rights reserved" by default. Built as a personal project — if you want to fork or reuse it, open an issue and we can talk.
