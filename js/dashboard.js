App.registerPage('dashboard', {
  render(container) {
    const tasks = Storage.get('tasks') || [];
    const finance = Storage.get('finance') || {};
    const habits = Storage.get('habits') || [];
    const journal = Storage.get('journal') || [];
    const events = Storage.get('calendar_events') || [];
    const today = App.getToday();

    const todoCount = tasks.filter(t => t.status === 'todo').length;
    const inProgressCount = tasks.filter(t => t.status === 'in-progress').length;
    const doneToday = tasks.filter(t => t.status === 'done').length;
    const highPriority = tasks.filter(t => t.priority === 'high' && t.status !== 'done');

    const todayHabits = habits.filter(h => h.completed && h.completed[today]);
    const habitPercent = habits.length ? Math.round((todayHabits.length / habits.length) * 100) : 0;

    const todayEvents = events.filter(e => e.date === today).sort((a, b) => (a.time || '').localeCompare(b.time || ''));
    const upcomingEvents = events.filter(e => e.date > today).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 3);

    container.innerHTML = `
      <div class="section">
        <div class="grid-4">
          <div class="card glow">
            <div class="card-header"><span class="card-title">Net Worth</span><span class="badge badge-green">LIVE</span></div>
            <div class="card-value" style="color:var(--accent)">${App.formatCurrency(finance.netWorth || 0)}</div>
            <div class="card-subtitle">Savings rate: ${finance.savingsRate || 0}%</div>
          </div>
          <div class="card">
            <div class="card-header"><span class="card-title">Tasks</span><span class="badge badge-amber">${todoCount} TODO</span></div>
            <div class="card-value">${inProgressCount}</div>
            <div class="card-subtitle">in progress &middot; ${doneToday} completed</div>
          </div>
          <div class="card">
            <div class="card-header"><span class="card-title">Habits Today</span><span class="badge badge-purple">${habitPercent}%</span></div>
            <div class="card-value">${todayHabits.length}/${habits.length}</div>
            <div class="progress-bar" style="margin-top:8px"><div class="progress-fill green" style="width:${habitPercent}%"></div></div>
          </div>
          <div class="card">
            <div class="card-header"><span class="card-title">Journal</span></div>
            <div class="card-value">${journal.length}</div>
            <div class="card-subtitle">entries total</div>
          </div>
        </div>
      </div>

      <div class="section">
        <div class="grid-2-1">
          <div>
            <div class="section-header">
              <span class="section-title">Priority Tasks</span>
              <a href="#/tasks" class="btn btn-ghost btn-sm">View all &rarr;</a>
            </div>
            <div class="card">
              ${highPriority.length ? highPriority.map(t => `
                <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--border)">
                  <div>
                    <div style="font-size:13px;font-weight:500">${this._esc(t.title)}</div>
                    <div style="font-size:11px;color:var(--text-muted)">${t.category || ''} ${t.dueDate ? '&middot; Due ' + App.formatDate(t.dueDate) : ''}</div>
                  </div>
                  <span class="badge badge-${t.status === 'in-progress' ? 'accent' : 'red'}">${t.status}</span>
                </div>
              `).join('') : '<div class="empty-state" style="padding:20px"><div class="empty-state-text">No high-priority tasks</div></div>'}
            </div>

            ${this._renderBlockers(tasks)}
          </div>

          <div>
            <div class="section-header">
              <span class="section-title">Today's Schedule</span>
              <a href="#/calendar" class="btn btn-ghost btn-sm">Calendar &rarr;</a>
            </div>
            <div class="card">
              ${todayEvents.length ? todayEvents.map(e => `
                <div style="display:flex;gap:12px;padding:10px 0;border-bottom:1px solid var(--border)">
                  <div style="font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--accent);min-width:50px">${e.time || ''}</div>
                  <div>
                    <div style="font-size:13px;font-weight:500">${this._esc(e.title)}</div>
                    <div style="font-size:11px;color:var(--text-muted)">${e.duration}min &middot; ${e.type}</div>
                  </div>
                </div>
              `).join('') : '<div style="padding:16px;text-align:center;color:var(--text-muted);font-size:13px">No events today</div>'}
            </div>

            ${upcomingEvents.length ? `
            <div class="section-header" style="margin-top:20px">
              <span class="section-title">Upcoming</span>
            </div>
            <div class="card">
              ${upcomingEvents.map(e => `
                <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);font-size:13px">
                  <span>${this._esc(e.title)}</span>
                  <span style="color:var(--text-muted);font-size:12px">${App.formatDate(e.date)}</span>
                </div>
              `).join('')}
            </div>` : ''}

            <div class="section-header" style="margin-top:20px">
              <span class="section-title">Quick Habits</span>
              <a href="#/habits" class="btn btn-ghost btn-sm">All &rarr;</a>
            </div>
            <div class="card" id="dash-habits-list">
              ${habits.slice(0, 4).map(h => `
                <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border)">
                  <span style="font-size:13px">${this._esc(h.name)}</span>
                  <div style="display:flex;align-items:center;gap:8px">
                    <span style="font-size:11px;color:var(--amber)">${h.streak} day streak</span>
                    <button class="btn btn-sm ${h.completed && h.completed[today] ? 'btn-primary' : 'btn-secondary'} dash-habit-btn" data-habit="${App.escAttr(h.id)}">${h.completed && h.completed[today] ? '✓' : '○'}</button>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      </div>

      <div class="section">
        <div class="section-header">
          <span class="section-title">Finance Overview</span>
          <a href="#/finance" class="btn btn-ghost btn-sm">Details &rarr;</a>
        </div>
        <div class="grid-4">
          ${(finance.accounts || []).map(a => `
            <div class="card">
              <div class="card-title">${this._esc(a.name)}</div>
              <div class="card-value" style="margin-top:8px;color:${a.type === 'investment' ? 'var(--purple)' : a.type === 'crypto' ? 'var(--amber)' : 'var(--green)'}">${App.formatCurrency(a.balance)}</div>
              <div class="card-subtitle">${a.type}</div>
            </div>
          `).join('')}
        </div>
      </div>
    `;

    container.querySelectorAll('.dash-habit-btn').forEach(btn => {
      btn.addEventListener('click', () => this._toggleHabit(btn.dataset.habit));
    });
  },

  _renderBlockers(tasks) {
    const blocked = tasks.filter(t => t.blockers && t.blockers.length > 0 && t.status !== 'done');
    if (!blocked.length) return '';
    return `
      <div class="section-header" style="margin-top:20px">
        <span class="section-title">Task Blockers</span>
      </div>
      <div class="card">
        ${blocked.map(t => `
          <div style="padding:10px 0;border-bottom:1px solid var(--border)">
            <div style="font-size:13px;font-weight:500">${this._esc(t.title)}</div>
            ${t.blockers.map(b => `<div style="font-size:12px;color:var(--red);margin-top:4px">&#9888; ${this._esc(b)}</div>`).join('')}
          </div>
        `).join('')}
      </div>
    `;
  },

  _toggleHabit(id) {
    const habits = Storage.get('habits') || [];
    const today = App.getToday();
    const h = habits.find(h => h.id === id);
    if (!h) return;
    if (!h.completed) h.completed = {};
    h.completed[today] = !h.completed[today];
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

  _esc(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }
});
