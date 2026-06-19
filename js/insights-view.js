// Insights page — the life-system observability view. Renders the Insights
// engine's output: attention digest, weekly review, and the activity audit
// trail. Read-only over Storage + Insights; follows the safe render pattern
// (_esc + addEventListener, no inline handlers).
App.registerPage('insights', {
  _levelBadge: { urgent: 'red', warn: 'amber', info: 'accent' },
  _pageBadge: { tasks: 'accent', habits: 'purple', finance: 'green', nutrition: 'pink', journal: 'amber', brain: 'purple', calendar: 'accent', system: 'accent' },

  render(container) {
    const signals = Insights.attention();
    const wk = Insights.weeklyReview();
    const activity = Storage.getActivity();

    container.innerHTML = `
      <div class="section">
        <div class="section-header">
          <span class="section-title">Needs your attention</span>
          <span class="badge badge-${signals.length ? 'amber' : 'green'}">${signals.length || 'all clear'}</span>
        </div>
        ${signals.length ? `
          <div class="attention-panel">
            ${signals.map(s => `
              <a class="attention-item" href="#/${s.page}">
                <span class="attention-dot ${s.level}"></span>
                <span class="attention-icon">${this._esc(s.icon)}</span>
                <span class="attention-body">
                  <span class="attention-text">${this._esc(s.text)}</span>
                  <span class="attention-reason">${this._esc(s.reason || '')}</span>
                </span>
                <span class="attention-go">→</span>
              </a>`).join('')}
          </div>` : `
          <div class="empty-state">
            <div class="empty-state-icon">&#10003;</div>
            <div class="empty-state-text">Nothing needs you right now — tasks current, streaks safe, data fresh.</div>
          </div>`}
      </div>

      <div class="section">
        <div class="section-header">
          <span class="section-title">This week</span>
          <span class="card-subtitle" style="margin:0">${this._esc(wk.rangeLabel)} · ${wk.actions} action${wk.actions === 1 ? '' : 's'}</span>
        </div>
        <div class="grid-4">
          <div class="card glow">
            <div class="card-title">Tasks Completed</div>
            <div class="card-value" style="margin-top:8px;color:var(--green)">${wk.tasks.completedThisWeek}</div>
            <div class="card-subtitle">${wk.tasks.open} open${wk.tasks.overdue ? ` · ${wk.tasks.overdue} overdue` : ''}</div>
          </div>
          <div class="card">
            <div class="card-title">Habit Consistency</div>
            <div class="card-value" style="margin-top:8px;color:var(--purple)">${wk.habits.rate}%</div>
            <div class="progress-bar" style="margin-top:8px"><div class="progress-fill purple" style="width:${wk.habits.rate}%"></div></div>
          </div>
          <div class="card">
            <div class="card-title">Net Cash Flow</div>
            <div class="card-value" style="margin-top:8px;color:var(--${wk.finance.net >= 0 ? 'green' : 'red'})">${this._esc(this._money(wk.finance.net))}</div>
            <div class="card-subtitle">${this._esc(this._money(wk.finance.income))} in · ${this._esc(this._money(wk.finance.spending))} out</div>
          </div>
          <div class="card">
            <div class="card-title">Logged Days</div>
            <div class="card-value" style="margin-top:8px;color:var(--amber)">${wk.nutrition.daysLogged}/7</div>
            <div class="card-subtitle">${wk.journal.count} journal${wk.journal.count === 1 ? '' : 's'} ${wk.journal.moods.slice(0, 5).map(m => this._esc(m)).join('')}</div>
          </div>
        </div>
        ${wk.habits.streaks.length ? `
          <div class="card" style="margin-top:16px">
            <div class="card-title" style="margin-bottom:10px">Active streaks</div>
            <div style="display:flex;flex-wrap:wrap;gap:8px">
              ${wk.habits.streaks.map(s => `<span class="badge badge-purple">${this._esc(s.name)} · ${s.streak}d</span>`).join('')}
            </div>
          </div>` : ''}
      </div>

      <div class="section">
        <div class="section-header">
          <span class="section-title">Recent activity</span>
          ${activity.length ? `<button class="btn btn-danger btn-sm" id="ins-clear">Clear history</button>` : ''}
        </div>
        ${activity.length ? `
          <div class="card" style="padding:0">
            <div class="activity-list">
              ${activity.slice(0, 40).map(a => `
                <div class="activity-item">
                  <span class="badge badge-${this._pageBadge[a.page] || 'accent'}">${this._esc(a.page)}</span>
                  <span class="activity-text">${this._esc(a.text)}</span>
                  <span class="activity-time">${this._esc(this._rel(a.t))}</span>
                </div>`).join('')}
            </div>
          </div>
          <div class="card-subtitle" style="margin-top:10px">Captured automatically as you use the app. Newest first · last ${Math.min(activity.length, 40)} of ${activity.length}.</div>
        ` : `
          <div class="empty-state">
            <div class="empty-state-icon">&#128220;</div>
            <div class="empty-state-text">No activity yet — changes you make will show up here.</div>
          </div>`}
      </div>`;

    const clearBtn = container.querySelector('#ins-clear');
    if (clearBtn) clearBtn.addEventListener('click', () => {
      Storage.clearActivity();
      App.toast('Activity history cleared', 'success');
      this.render(container);
    });
  },

  _money(n) {
    return (App.formatCurrency ? App.formatCurrency(Math.abs(n)) : '$' + Math.abs(n));
  },

  _rel(iso) {
    const then = new Date(iso);
    if (isNaN(then)) return '';
    const mins = Math.round((Date.now() - then) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.round(hrs / 24);
    if (days < 7) return `${days}d ago`;
    return then.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  },

  _esc(s) {
    if (s == null) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
});
