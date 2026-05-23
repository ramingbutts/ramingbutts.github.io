App.registerPage('journal', {
  render(container) {
    const entries = Storage.get('journal') || [];
    const sorted = [...entries].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

    const today = App.getToday();
    const thisWeek = entries.filter(e => {
      const d = new Date(e.date || e.createdAt);
      const now = new Date();
      const diff = (now - d) / (1000 * 60 * 60 * 24);
      return diff <= 7;
    }).length;

    const streak = this._calcStreak(entries);

    const moods = {};
    entries.forEach(e => { if (e.mood) moods[e.mood] = (moods[e.mood] || 0) + 1; });
    const topMood = Object.entries(moods).sort((a, b) => b[1] - a[1])[0];

    container.innerHTML = `
      <div class="section">
        <div class="grid-4">
          <div class="card glow">
            <div class="card-title">Total Entries</div>
            <div class="card-value" style="margin-top:8px;color:var(--accent)">${entries.length}</div>
          </div>
          <div class="card">
            <div class="card-title">This Week</div>
            <div class="card-value" style="margin-top:8px;color:var(--green)">${thisWeek}</div>
          </div>
          <div class="card">
            <div class="card-title">Streak</div>
            <div class="card-value" style="margin-top:8px;color:var(--amber)">${streak} days</div>
          </div>
          <div class="card">
            <div class="card-title">Top Mood</div>
            <div class="card-value" style="margin-top:8px">${topMood ? topMood[0] : '-'}</div>
            <div class="card-subtitle">${topMood ? topMood[1] + ' times' : 'no entries yet'}</div>
          </div>
        </div>
      </div>

      <div class="section">
        <div class="section-header">
          <span class="section-title">Journal Entries</span>
          <button class="btn btn-primary btn-sm" id="add-journal">+ New Entry</button>
        </div>
        ${sorted.length ? sorted.map(e => `
          <div class="journal-entry" onclick="App.pages.journal._view('${e.id}')">
            <div class="journal-entry-header">
              <div class="journal-entry-date">${e.date || (e.createdAt ? e.createdAt.slice(0, 10) : '')}</div>
              <div class="journal-entry-mood">${e.mood || ''}</div>
            </div>
            <div class="journal-entry-title">${this._esc(e.title)}</div>
            <div class="journal-entry-preview">${this._esc(e.content)}</div>
            <div style="margin-top:8px;display:flex;gap:4px">
              ${(e.tags || []).map(t => `<span class="badge badge-purple">${this._esc(t)}</span>`).join('')}
            </div>
          </div>
        `).join('') : '<div class="card"><div class="empty-state"><div class="empty-state-icon">&#9998;</div><div class="empty-state-text">Start journaling to track your thoughts and growth</div></div></div>'}
      </div>
    `;

    document.getElementById('add-journal').onclick = () => this._edit();
  },

  _calcStreak(entries) {
    const dates = new Set(entries.map(e => e.date || (e.createdAt ? e.createdAt.slice(0, 10) : '')));
    let streak = 0;
    const today = new Date();
    for (let i = 0; i < 365; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      if (dates.has(d.toISOString().slice(0, 10))) streak++;
      else break;
    }
    return streak;
  },

  _view(id) {
    const entries = Storage.get('journal') || [];
    const e = entries.find(e => e.id === id);
    if (!e) return;

    App.openModal('', `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <span style="font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--text-muted)">${e.date || ''}</span>
        <span style="font-size:24px">${e.mood || ''}</span>
      </div>
      <h2 style="font-size:20px;font-weight:700;margin-bottom:16px">${this._esc(e.title)}</h2>
      <div style="font-size:14px;line-height:1.8;white-space:pre-wrap;color:var(--text-secondary)">${this._esc(e.content)}</div>
      <div style="margin-top:16px;display:flex;gap:4px">${(e.tags || []).map(t => `<span class="badge badge-purple">${this._esc(t)}</span>`).join('')}</div>
      <div class="modal-actions">
        <button class="btn btn-danger" onclick="App.pages.journal._delete('${id}');App.closeModal()">Delete</button>
        <button class="btn btn-secondary" onclick="App.closeModal()">Close</button>
        <button class="btn btn-primary" onclick="App.closeModal();App.pages.journal._edit('${id}')">Edit</button>
      </div>
    `);
    document.getElementById('modal-title').textContent = '';
  },

  _edit(id) {
    const entries = Storage.get('journal') || [];
    const e = id ? entries.find(e => e.id === id) : null;
    const moods = ['&#128640;', '&#128513;', '&#128522;', '&#128528;', '&#128533;', '&#128555;', '&#129300;', '&#128170;', '&#127775;', '&#128147;'];

    App.openModal(e ? 'Edit Entry' : 'New Journal Entry', `
      <div class="form-group"><label>Title</label><input id="fj-title" value="${this._esc(e?.title || '')}"></div>
      <div class="form-row">
        <div class="form-group"><label>Date</label><input id="fj-date" type="date" value="${e?.date || App.getToday()}"></div>
        <div class="form-group">
          <label>Mood</label>
          <div id="fj-moods" style="display:flex;gap:6px;flex-wrap:wrap;padding:4px 0">
            ${moods.map(m => `<span class="mood-pick" style="font-size:22px;cursor:pointer;padding:4px;border-radius:4px;border:2px solid ${e?.mood === m ? 'var(--accent)' : 'transparent'}" data-mood="${m}" onclick="document.querySelectorAll('.mood-pick').forEach(x=>x.style.borderColor='transparent');this.style.borderColor='var(--accent)'">${m}</span>`).join('')}
          </div>
        </div>
      </div>
      <div class="form-group"><label>Write your thoughts...</label><textarea id="fj-content" style="min-height:180px">${this._esc(e?.content || '')}</textarea></div>
      <div class="form-group"><label>Tags (comma separated)</label><input id="fj-tags" value="${(e?.tags || []).join(', ')}"></div>
      <div class="modal-actions">
        <button class="btn btn-secondary" onclick="App.closeModal()">Cancel</button>
        <button class="btn btn-primary" id="fj-save">Save</button>
      </div>
    `);

    document.getElementById('fj-save').onclick = () => {
      const title = document.getElementById('fj-title').value.trim();
      if (!title) { App.toast('Title required', 'error'); return; }
      const selectedMood = document.querySelector('.mood-pick[style*="var(--accent)"]');
      const data = {
        id: e?.id || App.uid(),
        date: document.getElementById('fj-date').value,
        title,
        content: document.getElementById('fj-content').value,
        mood: selectedMood?.dataset.mood || e?.mood || '',
        tags: document.getElementById('fj-tags').value.split(',').map(s => s.trim()).filter(Boolean),
        createdAt: e?.createdAt || new Date().toISOString()
      };
      const all = Storage.get('journal') || [];
      if (e) { const i = all.findIndex(x => x.id === id); if (i >= 0) all[i] = data; }
      else all.push(data);
      Storage.set('journal', all);
      App.closeModal();
      this.render(document.getElementById('page-content'));
      App.toast(e ? 'Entry updated' : 'Entry saved', 'success');
    };
  },

  _delete(id) {
    const entries = (Storage.get('journal') || []).filter(e => e.id !== id);
    Storage.set('journal', entries);
    this.render(document.getElementById('page-content'));
    App.toast('Entry deleted', 'info');
  },

  _esc(s) {
    if (!s) return '';
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }
});
