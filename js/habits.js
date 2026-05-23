App.registerPage('habits', {
  render(container) {
    const habits = Storage.get('habits') || [];
    const today = new Date();
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      days.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
    }
    const dayLabels = days.map(d => {
      const dt = new Date(d + 'T00:00:00');
      return dt.toLocaleDateString('en-US', { weekday: 'short' });
    });

    const todayStr = App.getToday();
    const completed = habits.filter(h => h.completed && h.completed[todayStr]).length;
    const pct = habits.length ? Math.round((completed / habits.length) * 100) : 0;
    const totalStreak = habits.reduce((s, h) => s + (h.streak || 0), 0);

    container.innerHTML = `
      <div class="section">
        <div class="grid-3">
          <div class="card glow">
            <div class="card-title">Today's Progress</div>
            <div class="card-value" style="margin-top:8px;color:var(--green)">${completed}/${habits.length}</div>
            <div class="progress-bar" style="margin-top:8px"><div class="progress-fill green" style="width:${pct}%"></div></div>
            <div class="card-subtitle">${pct}% complete</div>
          </div>
          <div class="card">
            <div class="card-title">Total Streaks</div>
            <div class="card-value" style="margin-top:8px;color:var(--amber)">${totalStreak}</div>
            <div class="card-subtitle">combined streak days</div>
          </div>
          <div class="card">
            <div class="card-title">Active Habits</div>
            <div class="card-value" style="margin-top:8px">${habits.length}</div>
            <div class="card-subtitle">tracking daily</div>
          </div>
        </div>
      </div>

      <div class="section">
        <div class="section-header">
          <span class="section-title">Weekly View</span>
          <button class="btn btn-primary btn-sm" id="add-habit">+ Add Habit</button>
        </div>
        <div class="card">
          <div class="habit-row" style="border-bottom:1px solid var(--border-light)">
            <div class="habit-name" style="font-weight:600;color:var(--text-muted);font-size:11px;text-transform:uppercase">Habit</div>
            <div class="habit-days">
              ${dayLabels.map((l, i) => `<div class="habit-day" style="cursor:default;font-weight:600;color:${days[i] === todayStr ? 'var(--accent)' : 'var(--text-muted)'}">${l}</div>`).join('')}
            </div>
            <div class="habit-streak" style="font-size:11px;color:var(--text-muted);text-transform:uppercase">Streak</div>
            <div style="width:60px"></div>
          </div>
          ${habits.map(h => `
            <div class="habit-row">
              <div class="habit-name">
                <span>${this._esc(h.icon || '★')}</span> ${this._esc(h.name)}
                <div style="font-size:10px;color:var(--text-muted)">${this._esc(h.category)}</div>
              </div>
              <div class="habit-days">
                ${days.map(d => {
                  const done = h.completed && h.completed[d];
                  return `<div class="habit-day ${done ? 'completed' : ''} habit-toggle" data-hid="${App.escAttr(h.id)}" data-date="${d}">${done ? '&#10003;' : ''}</div>`;
                }).join('')}
              </div>
              <div class="habit-streak">${h.streak || 0}&#128293;</div>
              <div style="width:60px;text-align:right">
                <button class="btn btn-ghost btn-sm habit-edit-btn" data-hid="${App.escAttr(h.id)}">&#9998;</button>
                <button class="btn btn-ghost btn-sm habit-del-btn" data-hid="${App.escAttr(h.id)}" style="color:var(--red)">&#10005;</button>
              </div>
            </div>
          `).join('')}
          ${!habits.length ? '<div class="empty-state"><div class="empty-state-text">No habits yet. Add your first habit!</div></div>' : ''}
        </div>
      </div>

      <div class="section">
        <div class="section-title">Habit Categories</div>
        <div class="grid-3" style="margin-top:12px">
          ${this._categoryStats(habits, 'health', 'Health', 'var(--green)')}
          ${this._categoryStats(habits, 'productivity', 'Productivity', 'var(--purple)')}
          ${this._categoryStats(habits, 'finance', 'Finance', 'var(--amber)')}
        </div>
      </div>
    `;

    document.getElementById('add-habit').onclick = () => this._edit();
    container.querySelectorAll('.habit-toggle').forEach(el => {
      el.addEventListener('click', () => this._toggle(el.dataset.hid, el.dataset.date));
    });
    container.querySelectorAll('.habit-edit-btn').forEach(btn => {
      btn.addEventListener('click', () => this._edit(btn.dataset.hid));
    });
    container.querySelectorAll('.habit-del-btn').forEach(btn => {
      btn.addEventListener('click', () => this._delete(btn.dataset.hid));
    });
  },

  _categoryStats(habits, cat, label, color) {
    const catHabits = habits.filter(h => h.category === cat);
    const today = App.getToday();
    const done = catHabits.filter(h => h.completed && h.completed[today]).length;
    const pct = catHabits.length ? Math.round((done / catHabits.length) * 100) : 0;
    return `
      <div class="card">
        <div style="font-size:13px;font-weight:600;color:${color};margin-bottom:8px">${label}</div>
        <div style="font-size:20px;font-weight:700">${done}/${catHabits.length}</div>
        <div class="progress-bar" style="margin-top:8px"><div class="progress-fill" style="width:${pct}%;background:${color}"></div></div>
      </div>
    `;
  },

  _toggle(id, date) {
    const habits = Storage.get('habits') || [];
    const h = habits.find(h => h.id === id);
    if (!h) return;
    if (!h.completed) h.completed = {};
    h.completed[date] = !h.completed[date];
    h.streak = this._calcStreak(h);
    Storage.set('habits', habits);
    this.render(document.getElementById('page-content'));
  },

  _calcStreak(habit) {
    let streak = 0;
    const today = new Date();
    for (let i = 0; i < 365; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      if (habit.completed && habit.completed[key]) streak++;
      else break;
    }
    return streak;
  },

  _edit(id) {
    const habits = Storage.get('habits') || [];
    const h = id ? habits.find(h => h.id === id) : null;
    App.openModal(h ? 'Edit Habit' : 'New Habit', `
      <div class="form-group"><label>Name</label><input id="fh-name" value="${this._esc(h?.name || '')}"></div>
      <div class="form-row">
        <div class="form-group">
          <label>Category</label>
          <select id="fh-cat">
            <option value="health" ${h?.category === 'health' ? 'selected' : ''}>Health</option>
            <option value="productivity" ${h?.category === 'productivity' ? 'selected' : ''}>Productivity</option>
            <option value="finance" ${h?.category === 'finance' ? 'selected' : ''}>Finance</option>
          </select>
        </div>
        <div class="form-group"><label>Icon (emoji/symbol)</label><input id="fh-icon" value="${h?.icon || '&#9733;'}" maxlength="8"></div>
      </div>
      <div class="modal-actions">
        <button class="btn btn-secondary" onclick="App.closeModal()">Cancel</button>
        <button class="btn btn-primary" id="fh-save">Save</button>
      </div>
    `);
    document.getElementById('fh-save').onclick = () => {
      const name = document.getElementById('fh-name').value.trim();
      if (!name) { App.toast('Name required', 'error'); return; }
      const all = Storage.get('habits') || [];
      if (h) {
        const i = all.findIndex(x => x.id === id);
        if (i >= 0) { all[i].name = name; all[i].category = document.getElementById('fh-cat').value; all[i].icon = document.getElementById('fh-icon').value; }
      } else {
        all.push({ id: App.uid(), name, category: document.getElementById('fh-cat').value, icon: document.getElementById('fh-icon').value, streak: 0, completed: {} });
      }
      Storage.set('habits', all);
      App.closeModal();
      this.render(document.getElementById('page-content'));
      App.toast(h ? 'Habit updated' : 'Habit added', 'success');
    };
  },

  _delete(id) {
    const habits = (Storage.get('habits') || []).filter(h => h.id !== id);
    Storage.set('habits', habits);
    this.render(document.getElementById('page-content'));
    App.toast('Habit removed', 'info');
  },

  _esc(s) {
    if (!s) return '';
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }
});
