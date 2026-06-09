---
name: add-storage-key
description: Add a new persisted localStorage key to the Personal OS project the safe way. Use when a page needs to store new data, or the user says "persist X", "save Y to storage", "add a storage key", or you're introducing any new Storage.get/set key. Wires the import allow-list and (optionally) seed data, and enforces the Storage.set-only + App.getToday() conventions.
disable-model-invocation: false
allowed-tools: Read, Edit, Grep
---

# /add-storage-key — Add a persisted key the safe way

Persistence in Personal OS has three footguns this skill exists to prevent:
imports silently dropping the key, direct `localStorage` writes bypassing sync,
and seed dates drifting a day at midnight. Follow this.

## 1. Name and locate the key

- Confirm the **key name** (e.g. `reading_list`, `finance_budgets`). It's stored
  internally as `os_<key>` — you pass just `<key>` to `Storage.get/set`.
- Grep `js/storage.js` and the page modules to confirm it isn't already used.

## 2. Use `Storage`, never `localStorage`

In page code, read/write only through the namespace:

```js
const items = Storage.get('<key>') || [];   // null when unset → default it
Storage.set('<key>', items);                 // returns false on quota failure
```

Never call `localStorage.getItem/setItem('<key>', …)` directly — that bypasses
Supabase sync and the Diag failure surfacing baked into `Storage.set`. The only
direct-`localStorage` exceptions in this codebase are the Supabase config keys
in `Storage.init/configureSupabase`; don't add to them.

`Storage.set` already logs to `Diag` and toasts once on `QuotaExceededError`, so
you don't need your own error handling around it — but if a write *must* succeed
for the UI to be correct, check its boolean return.

## 3. Add the key to the import allow-list — REQUIRED

`Storage.importAll` (`js/storage.js`) only restores keys on an allow-list — this
is a security boundary (it stops a backup file injecting Supabase creds or
arbitrary keys). A key that isn't listed will **silently vanish on import**. Add
it to `allowedKeys`:

```js
const allowedKeys = ['tasks', 'finance', /* … */, 'finance_snapshots', '<key>'];
```

(Keys with dynamic suffixes use the `k.startsWith('water_')` style prefix check
instead — match that pattern only if your key is genuinely dynamic.)

## 4. Seed data — optional

If the page should ship with example data, add a `this.set('<key>', …)` block in
`Storage._seedIfEmpty` (`js/storage.js`). Note the seed gate: it returns early
when `tasks` already exists, so seeds only apply to a fresh install.

- Use `App.uid()`-style ids — `_seedIfEmpty` uses the local `this._id()` helper;
  reuse it for consistency.
- For **user-facing dates**, prefer the local-time form
  `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
  (what `App.getToday()` returns). The existing seed data uses
  `new Date().toISOString().slice(0,10)`, which can drift a day at midnight —
  don't copy that into new code (CLAUDE.md convention).

## 5. Self-check

- `<key>` appears in `allowedKeys` in `Storage.importAll`.
- All access goes through `Storage.get` / `Storage.set` — grep the page module
  for stray `localStorage.` usage.
- Any new seed dates use the local-time format, not `toISOString().slice`.

## Quality Standard

The key round-trips through Export → Import without loss, never writes
`localStorage` directly, and surfaces failures through `Diag`/toast rather than
silently. A user must never believe data was saved when it wasn't. Don't add a
key (or seed data) the app doesn't yet read — match complexity to value.

## Changelog
2026-06-09: Initial version. Encodes the importAll allow-list requirement,
Storage.set-only rule, and the local-time vs toISOString seed-date convention.
