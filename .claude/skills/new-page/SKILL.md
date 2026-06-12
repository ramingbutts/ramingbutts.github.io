---
name: new-page
description: Scaffold a new dashboard page for the Personal OS project the project's exact way. Use when the user wants to add a new page/tab/section to the dashboard (e.g. "add a workouts page", "new module for X", "create a reading-list page"). Wires up the js module, App.registerPage, the index.html script tag in correct load order, the sidebar nav link, the page-title map, and (if it persists data) the Storage allow-list.
disable-model-invocation: false
allowed-tools: Read, Write, Edit, Grep, Glob
---

# /new-page — Scaffold a Personal OS dashboard page

Add a new page to the vanilla-JS SPA. There is no build step, so every wiring
point is manual and **order matters**. Miss one and the page silently fails to
load. Follow this exactly.

## 0. Settle the name first

Ask for / confirm two things before touching files:
- **`page` id** — lowercase, one word, used in the route (`#/<page>`),
  `data-page`, the filename `js/<page>.js`, and `App.registerPage('<page>', …)`.
  It must be unique against existing pages (dashboard, tasks, finance, habits,
  nutrition, calendar, brain, graph, journal).
- **Display title** — what shows in the sidebar and topbar (e.g. "Reading List").
- **Does it persist data?** If yes, note the storage key(s) — you'll wire the
  allow-list in step 5 (or delegate to the `add-storage-key` skill).

Grep `js/app.js` and `index.html` to confirm the id isn't taken.

## 1. Create the page module — `js/<page>.js`

Match the modern, safe pattern (see `js/habits.js`, `js/tasks.js`). Minimum
viable module:

```js
App.registerPage('<page>', {
  render(container, sub) {
    const items = Storage.get('<page>') || [];   // omit if no persistence

    container.innerHTML = `
      <div class="section">
        <div class="section-header">
          <span class="section-title">${this._esc('<Display Title>')}</span>
          <button class="btn btn-primary btn-sm" id="<page>-add">+ Add</button>
        </div>
        <div class="card">
          ${items.length
            ? items.map(it => `
              <div class="row">
                <span>${this._esc(it.name)}</span>
                <button class="btn btn-ghost btn-sm <page>-del" data-id="${App.escAttr(it.id)}">✕</button>
              </div>`).join('')
            : '<div class="empty-state"><div class="empty-state-text">Nothing here yet.</div></div>'}
        </div>
      </div>
    `;

    // Bind via addEventListener + data-* — never inline onclick on user content.
    document.getElementById('<page>-add')?.addEventListener('click', () => this._add());
    container.querySelectorAll('.<page>-del').forEach(btn => {
      btn.addEventListener('click', () => this._delete(btn.dataset.id));
    });
  },

  _add() { /* App.openModal(...) then Storage.set('<page>', ...) */ },

  _delete(id) {
    const items = (Storage.get('<page>') || []).filter(x => x.id !== id);
    Storage.set('<page>', items);
    this.render(document.getElementById('page-content'));
    App.toast('Removed', 'info');
  },

  _esc(s) {
    if (!s) return '';
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }
};
```

Non-negotiable conventions (from CLAUDE.md):
- **Escape all user content** with `this._esc()` for text and `App.escAttr()`
  for attribute values. No interpolated raw `value`s, no inline `onclick` on
  user data.
- **All persistence through `Storage.get` / `Storage.set`** — never touch
  `localStorage` directly.
- **User-facing dates use `App.getToday()`**, never `toISOString().slice(0,10)`.
- New IDs use `App.uid()`.
- Re-render after a mutation with `this.render(document.getElementById('page-content'))`.

## 2. Add the `<script>` tag — `index.html`

The SPA loads every `js/*.js` as a plain script in declaration order. The base
trio must stay first: `diag.js` → `storage.js` → `app.js`. Page modules come
after `app.js` (any order among themselves). Add your tag at the **end of the
page-module block**, just before `</body>`:

```html
  <script src="js/<page>.js"></script>
```

If you forget this, `App.registerPage` never runs and the route shows
"Page not found".

## 3. Add the sidebar nav link — `index.html`

Inside `<ul class="nav-links">`, copy an existing `<li>` and adapt. Use an HTML
entity for the icon to match the others:

```html
        <li><a href="#/<page>" class="nav-link" data-page="<page>">
          <span class="nav-icon">&#9670;</span> <Display Title>
        </a></li>
```

`data-page` must equal the page id — that's what drives active-state highlighting.

## 4. Add the page title — `js/app.js`

In `_setPageTitle`'s `titles` map, add:

```js
      <page>: '<Display Title>',
```

Without this the topbar falls back to the raw page id.

## 5. Wire persistence (only if the page stores data)

For each new storage key, add it to the `allowedKeys` array in
`Storage.importAll` (`js/storage.js`) so backups round-trip. If you also want
seed data, add a `this.set('<key>', [...])` block in `Storage._seedIfEmpty`
(use `App.getToday()`-style dates, not UTC slices). For anything non-trivial,
invoke the **`add-storage-key`** skill instead of doing it by hand.

## 6. Self-check before handing off

Confirm all five wiring points line up on the same id:
- `js/<page>.js` exists and calls `App.registerPage('<page>', …)`
- `index.html` has the `<script src="js/<page>.js">` tag
- `index.html` sidebar `<li>` has `href="#/<page>"` and `data-page="<page>"`
- `js/app.js` `titles` map has the `<page>` entry
- if persistent: key is in `importAll` allow-list

Then suggest the user run the **`verify-page`** skill to exercise it live.

## Quality Standard

A great scaffold loads on first try, renders without console errors, and is
indistinguishable in style from the existing modern pages — same `_esc`/`escAttr`
discipline, same `Storage` usage, same re-render pattern. If the new page needs
inline `onclick` on user data or writes `localStorage` directly, it's wrong:
fix it before handing off. Match complexity to value — don't add sub-routes,
extra storage keys, or helpers the page doesn't yet need.

## Changelog
2026-06-09: Initial version. Encodes the 5 wiring points (module,
script tag, nav link, title map, allow-list) + the escape/Storage/date
conventions from CLAUDE.md.
