// Quick Capture — a global Ctrl/Cmd+K command palette for Personal OS.
//
// Two jobs, from the product audit: (1) fuzzy-search across every module and
// jump to it, and (2) capture new data in one line without navigating a page
// or opening a modal. Typed prefixes:
//   t <title> !high @2026-07-10 #Work   → task
//   $ -12.50 lunch #Food                → finance transaction
//   j <text> :🚀                        → journal entry
//   n <text>                            → second-brain note
//   e 14:00 dentist                     → calendar event (today)
//   w                                   → log a glass of water
//
// All writes go through Storage.set (never localStorage directly), dates use
// App.getToday(), user content is escaped before render, and failures route to
// Diag. It writes only to existing keys, so the import allow-list is unchanged.
const Capture = {
  open: false,
  items: [],
  sel: 0,

  init() {
    if (typeof App === 'undefined' || typeof Storage === 'undefined') return;
    this._injectDom();
    this._bindGlobalKey();
  },

  _esc(s) {
    if (s == null) return '';
    const d = document.createElement('div');
    d.textContent = String(s);
    // also escape quotes: _esc output is interpolated into value="..." attributes,
    // where an unescaped quote truncates the field and silently corrupts data
    return d.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  },

  _injectDom() {
    const el = document.createElement('div');
    el.id = 'capture-overlay';
    el.className = 'hidden';
    el.innerHTML = `
      <div id="capture-box" role="dialog" aria-label="Quick capture">
        <input id="capture-input" autocomplete="off" spellcheck="false"
          placeholder="Search, or capture — t task · $ expense · j journal · n note · e event · w water">
        <div id="capture-parse"></div>
        <div id="capture-results"></div>
        <div id="capture-foot">
          <span><b>&uarr;&darr;</b> navigate</span>
          <span><b>Enter</b> select</span>
          <span><b>Esc</b> close</span>
          <span style="margin-left:auto"><b>Ctrl</b>+<b>K</b> anytime</span>
        </div>
      </div>`;
    document.body.appendChild(el);

    this.overlay = el;
    this.input = el.querySelector('#capture-input');
    this.resultsEl = el.querySelector('#capture-results');
    this.parseEl = el.querySelector('#capture-parse');

    el.addEventListener('click', e => { if (e.target === el) this.close(); });
    this.input.addEventListener('input', () => this._refresh());
    this.input.addEventListener('keydown', e => this._onKey(e));
  },

  _bindGlobalKey() {
    window.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        this.open ? this.close() : this.show();
      }
    });
  },

  show() {
    this.open = true;
    this.overlay.classList.remove('hidden');
    this.input.value = '';
    this._refresh();
    setTimeout(() => this.input.focus(), 0);
  },

  close() {
    this.open = false;
    this.overlay.classList.add('hidden');
  },

  _onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); this.close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); this._move(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); this._move(-1); }
    else if (e.key === 'Enter') { e.preventDefault(); this._execute(); }
  },

  _move(d) {
    if (!this.items.length) return;
    this.sel = (this.sel + d + this.items.length) % this.items.length;
    this._paintSel();
  },

  _paintSel() {
    const rows = this.resultsEl.querySelectorAll('.capture-item');
    rows.forEach((r, i) => r.classList.toggle('sel', i === this.sel));
    const s = rows[this.sel];
    if (s) s.scrollIntoView({ block: 'nearest' });
  },

  // ---------- fuzzy search index ----------
  _searchGroups() {
    const tasks = (Storage.get('tasks') || []).map(t => ({ label: t.title, meta: (t.priority || '') + (t.status ? ' · ' + t.status : ''), hash: '#/tasks' }));
    const notes = (Storage.get('brain_notes') || []).map(n => ({ label: n.title, meta: 'note', hash: '#/brain' }));
    const journal = (Storage.get('journal') || []).map(j => ({ label: j.title, meta: (j.date || ''), hash: '#/journal' }));
    const events = (Storage.get('calendar_events') || []).map(ev => ({ label: ev.title, meta: (ev.date || '') + (ev.time ? ' ' + ev.time : ''), hash: '#/calendar' }));
    const habits = (Storage.get('habits') || []).map(h => ({ label: h.name, meta: (h.streak || 0) + '🔥', hash: '#/habits' }));
    const fin = Storage.get('finance') || {};
    const txns = (fin.transactions || []).map(x => ({ label: x.description, meta: App.formatCurrency(x.amount), hash: '#/finance' }));
    const nav = [
      { label: 'Go to Dashboard', meta: 'page', hash: '#/dashboard' },
      { label: 'Go to Task CRM', meta: 'page', hash: '#/tasks' },
      { label: 'Go to Finance Pulse', meta: 'page', hash: '#/finance' },
      { label: 'Go to Habits', meta: 'page', hash: '#/habits' },
      { label: 'Go to Nutrition', meta: 'page', hash: '#/nutrition' },
      { label: 'Go to Calendar', meta: 'page', hash: '#/calendar' },
      { label: 'Go to Second Brain', meta: 'page', hash: '#/brain' },
      { label: 'Go to Journal', meta: 'page', hash: '#/journal' },
      { label: 'Go to Knowledge Graph', meta: 'page', hash: '#/graph' },
      { label: 'Go to Weekly Pulse', meta: 'page', hash: '#/pulse' },
    ];
    return [
      ['Tasks', '☐', tasks], ['Calendar', '🕒', events], ['Habits', '🔁', habits],
      ['Second Brain', '🧠', notes], ['Journal', '✍️', journal], ['Transactions', '$', txns],
      ['Navigate', '→', nav],
    ];
  },

  _fuzzy(q, str) {
    q = q.toLowerCase(); const lower = (str || '').toLowerCase();
    let qi = 0; const hits = [];
    for (let i = 0; i < lower.length && qi < q.length; i++) {
      if (lower[i] === q[qi]) { hits.push(i); qi++; }
    }
    return qi === q.length ? hits : null;
  },

  _highlight(str, hits) {
    return String(str).split('').map((c, i) =>
      hits.includes(i) ? '<mark>' + this._esc(c) + '</mark>' : this._esc(c)).join('');
  },

  // ---------- capture parsing ----------
  _parseCapture(v) {
    const m = v.match(/^([t$jnew])(\s+(.*))?$/i);
    if (!m) return null;
    const key = m[1].toLowerCase();
    const rest = (m[3] || '').trim();
    if (key !== 'w' && !rest) return { key, kind: this._kindName(key), title: '', chips: [], incomplete: true };
    switch (key) {
      case 't': {
        const pri = (rest.match(/!(high|med(?:ium)?|low)/i) || [])[1];
        const due = this._parseDue((rest.match(/@(\S+)/) || [])[1]);
        const cat = (rest.match(/#(\S+)/) || [])[1];
        const title = rest.replace(/!(high|med(?:ium)?|low)|@\S+|#\S+/gi, '').trim();
        return { key, kind: 'Task', title, priority: pri ? (pri[0].toLowerCase() === 'h' ? 'high' : pri[0].toLowerCase() === 'l' ? 'low' : 'medium') : 'medium', due, cat,
          chips: [pri && ['red', '!' + pri], due && ['accent', '@' + due], cat && ['purple', '#' + cat]].filter(Boolean) };
      }
      case '$': {
        const amt = (rest.match(/-?\d+(?:\.\d+)?/) || [])[0];
        const cat = (rest.match(/#(\S+)/) || [])[1];
        const desc = rest.replace(/-?\d+(?:\.\d+)?|#\S+/g, '').trim();
        return { key, kind: 'Transaction', title: desc, amount: amt != null ? Number(amt) : null, cat,
          chips: [amt != null && [Number(amt) >= 0 ? 'green' : 'red', (Number(amt) >= 0 ? '+' : '') + App.formatCurrency(Number(amt))], cat && ['purple', '#' + cat]].filter(Boolean) };
      }
      case 'j': {
        const mood = (rest.match(/:(\S+)/) || [])[1];
        return { key, kind: 'Journal', title: rest.replace(/:(\S+)/, '').trim(), mood, chips: [mood && ['purple', mood]].filter(Boolean) };
      }
      case 'n': return { key, kind: 'Note', title: rest, chips: [] };
      case 'e': {
        const time = (rest.match(/\b([01]?\d|2[0-3]):[0-5]\d\b/) || [])[0];
        return { key, kind: 'Event', title: rest.replace(/\b([01]?\d|2[0-3]):[0-5]\d\b/, '').trim(), time, chips: [time && ['accent', time]].filter(Boolean) };
      }
      case 'w': return { key, kind: 'Water', title: 'Log a glass of water', chips: [] };
    }
  },

  _kindName(key) { return { t: 'Task', $: 'Transaction', j: 'Journal', n: 'Note', e: 'Event', w: 'Water' }[key] || ''; },

  // normalize a @-token to YYYY-MM-DD so it populates <input type="date"> and
  // App.formatDate() cleanly; unrecognized tokens are dropped (no invalid dates)
  _parseDue(tok) {
    if (!tok) return null;
    const t = tok.toLowerCase();
    if (t === 'today') return App.getToday();
    if (t === 'tomorrow' || t === 'tmr') {
      const d = new Date(App.getToday() + 'T00:00:00');
      d.setDate(d.getDate() + 1);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
    return /^\d{4}-\d{2}-\d{2}$/.test(tok) ? tok : null;
  },

  _refresh() {
    const v = this.input.value.trim();
    this.sel = 0;
    const cap = v ? this._parseCapture(v) : null;

    // capture preview chips
    if (cap) {
      this.parseEl.style.display = 'flex';
      this.parseEl.innerHTML =
        `<span class="badge badge-accent" style="text-transform:none">${cap.kind}</span>` +
        `<span style="font-size:13px">${cap.title ? this._esc(cap.title) : '<i style="color:var(--text-muted)">…</i>'}</span>` +
        cap.chips.map(([c, txt]) => `<span class="badge badge-${c}" style="text-transform:none">${this._esc(txt)}</span>`).join('');
    } else {
      this.parseEl.style.display = 'none';
      this.parseEl.innerHTML = '';
    }

    this.items = [];
    let html = '';
    if (cap) {
      this.items.push({ type: 'capture', cap });
      const ready = cap.title || cap.key === 'w';
      html = `<div class="capture-item sel">
        <span class="ci-ico">${{ t: '☐', $: '$', j: '✍️', n: '🧠', e: '🕒', w: '💧' }[cap.key]}</span>
        <span>${ready ? 'Create ' + cap.kind + ': <b>' + this._esc(cap.title || 'water') + '</b>' : 'Keep typing your ' + this._esc(cap.kind.toLowerCase()) + '…'}</span>
        <span class="ci-meta">${ready ? 'Enter &crarr;' : ''}</span></div>`;
    } else {
      for (const [name, ico, list] of this._searchGroups()) {
        const matches = [];
        for (const it of list) {
          const hits = v ? this._fuzzy(v, it.label) : [];
          if (hits === null) continue;
          matches.push({ it, hits });
          if (matches.length >= (v ? 4 : (name === 'Tasks' || name === 'Navigate' ? 3 : 0))) break;
        }
        if (!matches.length) continue;
        html += `<div class="capture-group">${name}</div>`;
        for (const { it, hits } of matches) {
          this.items.push({ type: 'open', hash: it.hash, label: it.label });
          html += `<div class="capture-item"><span class="ci-ico">${ico}</span>
            <span>${this._highlight(it.label, hits)}</span><span class="ci-meta">${this._esc(it.meta)}</span></div>`;
        }
      }
      if (!this.items.length) {
        html = `<div class="capture-empty">No matches. Capture with a prefix: <b>t</b> task · <b>$</b> expense · <b>j</b> journal · <b>n</b> note · <b>e</b> event · <b>w</b> water</div>`;
      }
    }
    this.resultsEl.innerHTML = html;
    this.resultsEl.querySelectorAll('.capture-item').forEach((row, i) => {
      row.addEventListener('mouseenter', () => { this.sel = i; this._paintSel(); });
      row.addEventListener('click', () => { this.sel = i; this._execute(); });
    });
    this._paintSel();
  },

  _execute() {
    const item = this.items[this.sel];
    if (!item) return;
    if (item.type === 'open') {
      this.close();
      location.hash = item.hash;
      return;
    }
    const c = item.cap;
    if (!c.title && c.key !== 'w') { App.toast('Nothing to capture yet', 'error'); return; }

    let ok = true;
    try {
      switch (c.key) {
        case 't': ok = this._addTask(c); break;
        case '$': ok = this._addTxn(c); break;
        case 'j': ok = this._addJournal(c); break;
        case 'n': ok = this._addNote(c); break;
        case 'e': ok = this._addEvent(c); break;
        case 'w': ok = this._addWater(); break;
      }
    } catch (err) {
      Diag.error('capture', 'Capture failed for ' + c.kind, err);
      App.toast('Capture failed — see console', 'error');
      return;
    }
    if (ok === false) return; // the writer already toasted (e.g. storage full)
    App.toast(c.kind + ' captured', 'success');
    this.close();
    // refresh the current page if the capture affects it
    if (App.pages[App.currentPage]) {
      App.pages[App.currentPage].render(document.getElementById('page-content'));
    }
  },

  _addTask(c) {
    const tasks = Storage.get('tasks') || [];
    tasks.push({
      id: App.uid(), title: c.title, description: '', priority: c.priority || 'medium',
      status: 'todo', category: c.cat || '', dueDate: c.due || '', blockers: [],
      createdAt: new Date().toISOString(),
    });
    return Storage.set('tasks', tasks);
  },

  _addTxn(c) {
    const fin = Storage.get('finance') || {};
    if (!fin.transactions) fin.transactions = [];
    if (c.amount == null || isNaN(c.amount)) { App.toast('Add an amount, e.g. $ -12.50 lunch', 'error'); return false; }
    fin.transactions.push({
      id: App.uid(), description: c.title || '(no description)', amount: c.amount,
      category: c.cat || (c.amount >= 0 ? 'Income' : 'Other'), date: App.getToday(),
    });
    return Storage.set('finance', fin);
  },

  _addJournal(c) {
    const entries = Storage.get('journal') || [];
    entries.push({
      id: App.uid(), date: App.getToday(), title: c.title, content: c.title,
      mood: c.mood || '', tags: [], createdAt: new Date().toISOString(),
    });
    return Storage.set('journal', entries);
  },

  _addNote(c) {
    const notes = Storage.get('brain_notes') || [];
    notes.push({
      id: App.uid(), categoryId: null, title: c.title, content: '', tags: [],
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
    return Storage.set('brain_notes', notes);
  },

  _addEvent(c) {
    const events = Storage.get('calendar_events') || [];
    events.push({
      id: App.uid(), title: c.title, date: App.getToday(), time: c.time || '',
      duration: 30, type: 'personal', description: '',
    });
    return Storage.set('calendar_events', events);
  },

  _addWater() {
    const key = 'water_' + App.getToday();
    const cur = Storage.get(key) || 0;
    return Storage.set(key, Math.min(cur + 1, 20));
  },
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => Capture.init());
} else {
  Capture.init();
}
