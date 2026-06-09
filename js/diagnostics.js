// Diagnostics page — renders the Diag ring buffer so runtime failures are
// visible without opening devtools. Read-only view over Diag; no persistence.
App.registerPage('diag', {
  _filter: 'all',

  render(container) {
    const all = Diag.entries();
    const counts = {
      error: all.filter(e => e.level === 'error').length,
      warn: all.filter(e => e.level === 'warn').length,
      info: all.filter(e => e.level === 'info').length
    };
    const synced = typeof Storage !== 'undefined' && Storage._useSupabase;
    const syncBroken = counts.error && all.some(e => e.scope === 'sync');

    const filter = this._filter;
    const rows = (filter === 'all' ? all : all.filter(e => e.level === filter));

    container.innerHTML = `
      <div class="section">
        <div class="grid-4">
          <div class="card glow">
            <div class="card-title">Events Logged</div>
            <div class="card-value" style="margin-top:8px;color:var(--accent)">${all.length}</div>
            <div class="card-subtitle">in-memory ring buffer</div>
          </div>
          <div class="card">
            <div class="card-title">Errors</div>
            <div class="card-value" style="margin-top:8px;color:var(--red)">${counts.error}</div>
            <div class="card-subtitle">${counts.warn} warning${counts.warn === 1 ? '' : 's'}</div>
          </div>
          <div class="card">
            <div class="card-title">Cloud Sync</div>
            <div class="card-value" style="margin-top:8px;color:var(--${syncBroken ? 'red' : synced ? 'green' : 'text-muted'})">${syncBroken ? 'Failing' : synced ? 'On' : 'Off'}</div>
            <div class="card-subtitle">${synced ? 'Supabase configured' : 'local only'}</div>
          </div>
          <div class="card">
            <div class="card-title">Local Storage</div>
            <div class="card-value" style="margin-top:8px;color:var(--green)">${this._storageKb()} KB</div>
            <div class="card-subtitle">~5 MB browser limit</div>
          </div>
        </div>
      </div>

      <div class="section">
        <div class="section-header">
          <span class="section-title">Event Log</span>
          <div style="display:flex;gap:8px;align-items:center">
            <select id="diag-filter" style="width:auto">
              <option value="all"${filter === 'all' ? ' selected' : ''}>All levels</option>
              <option value="error"${filter === 'error' ? ' selected' : ''}>Errors</option>
              <option value="warn"${filter === 'warn' ? ' selected' : ''}>Warnings</option>
              <option value="info"${filter === 'info' ? ' selected' : ''}>Info</option>
            </select>
            <button class="btn btn-secondary btn-sm" id="diag-refresh">Refresh</button>
            <button class="btn btn-secondary btn-sm" id="diag-copy">Copy</button>
            <button class="btn btn-danger btn-sm" id="diag-clear">Clear</button>
          </div>
        </div>
        ${rows.length ? `
        <div class="card" style="padding:0">
          <div class="table-wrap">
            <table>
              <thead>
                <tr><th style="width:90px">Time</th><th style="width:80px">Level</th><th style="width:90px">Scope</th><th>Message</th></tr>
              </thead>
              <tbody>
                ${rows.map(e => `
                  <tr>
                    <td style="font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--text-muted)">${this._esc(this._time(e.t))}</td>
                    <td><span class="badge badge-${this._levelColor(e.level)}">${this._esc(e.level)}</span></td>
                    <td style="font-size:12px;color:var(--text-secondary)">${this._esc(e.scope)}</td>
                    <td style="font-size:13px">${this._esc(e.message)}</td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>
        </div>` : `
        <div class="empty-state">
          <div class="empty-state-icon">&#10003;</div>
          <div class="empty-state-text">No ${filter === 'all' ? '' : filter + ' '}events logged — everything's running clean.</div>
        </div>`}
        <div class="card-subtitle" style="margin-top:12px">Logs live in memory only and reset on reload. Also available via <code>Diag.dump()</code> in the console.</div>
      </div>`;

    const sel = container.querySelector('#diag-filter');
    sel.addEventListener('change', () => { this._filter = sel.value; this.render(container); });
    container.querySelector('#diag-refresh').addEventListener('click', () => this.render(container));
    container.querySelector('#diag-copy').addEventListener('click', () => this._copy());
    container.querySelector('#diag-clear').addEventListener('click', () => {
      Diag.clear();
      App.toast('Logs cleared', 'success');
      this.render(container);
    });
  },

  _copy() {
    const text = Diag.export();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text)
        .then(() => App.toast('Logs copied to clipboard', 'success'))
        .catch(() => App.toast('Copy failed — see console', 'error'));
    } else {
      App.toast('Clipboard unavailable — logged to console', 'info');
    }
    Diag.log('diag', 'Exported log buffer');
  },

  _storageKb() {
    let total = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('os_')) total += k.length + (localStorage.getItem(k) || '').length;
    }
    return Math.round(total / 1024);
  },

  _levelColor(level) {
    return level === 'error' ? 'red' : level === 'warn' ? 'amber' : 'accent';
  },

  _time(iso) {
    const d = new Date(iso);
    return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  },

  _esc(s) {
    if (s == null) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
});
