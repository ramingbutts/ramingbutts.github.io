App.registerPage('finance', {
  tab: 'overview',

  render(container) {
    const tabs = [
      { key: 'overview', label: 'Overview' },
      { key: 'profile', label: 'Profile' },
      { key: 'debts', label: 'Debt Tracker' },
      { key: 'categories', label: 'Categories' },
      { key: 'trends', label: 'Trends' },
    ];

    container.innerHTML = `
      <div style="display:flex;gap:6px;margin-bottom:20px;flex-wrap:wrap" id="fin-tabs">
        ${tabs.map(t => `<button class="btn ${this.tab === t.key ? 'btn-primary' : 'btn-secondary'} btn-sm fin-tab" data-tab="${t.key}">${t.label}</button>`).join('')}
      </div>
      <div id="fin-content"></div>
    `;

    container.querySelectorAll('.fin-tab').forEach(btn => {
      btn.addEventListener('click', () => { this.tab = btn.dataset.tab; this.render(container); });
    });

    const el = document.getElementById('fin-content');
    switch (this.tab) {
      case 'overview': this._renderOverview(el); break;
      case 'profile': this._renderProfile(el); break;
      case 'debts': this._renderDebts(el); break;
      case 'categories': this._renderCategories(el); break;
      case 'trends': this._renderTrends(el); break;
    }
  },

  _renderOverview(el) {
    const f = Storage.get('finance') || {};
    const accounts = f.accounts || [];
    const transactions = f.transactions || [];
    const goals = f.goals || [];
    const rules = Storage.get('finance_rules') || [];

    // reconciliation: the headline figures are entered by hand while the real
    // numbers live in accounts + transactions, so they drift. Derive the truth
    // and surface the gap.
    const rec = this._reconcileData(f, accounts, transactions);

    el.innerHTML = `
      <div class="section">
        <div class="grid-4">
          <div class="card glow">
            <div class="card-title">Net Worth</div>
            <div class="card-value" style="margin-top:8px;color:var(--accent)">${App.formatCurrency(f.netWorth || 0)}</div>
          </div>
          <div class="card">
            <div class="card-title">Monthly Income</div>
            <div class="card-value" style="margin-top:8px;color:var(--green)">${App.formatCurrency(f.monthlyIncome || 0)}</div>
          </div>
          <div class="card">
            <div class="card-title">Monthly Expenses</div>
            <div class="card-value" style="margin-top:8px;color:var(--red)">${App.formatCurrency(f.monthlyExpenses || 0)}</div>
          </div>
          <div class="card">
            <div class="card-title">Savings Rate</div>
            <div class="card-value" style="margin-top:8px;color:var(--purple)">${f.savingsRate || 0}%</div>
          </div>
        </div>
      </div>

      <div class="section">
        <div class="card" style="border-left:3px solid ${rec.anyDrift ? 'var(--amber)' : 'var(--green)'}">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px;flex-wrap:wrap">
            <div style="display:flex;align-items:center;gap:8px">
              <span style="font-size:16px">${rec.anyDrift ? '&#9888;' : '&#10003;'}</span>
              <span class="card-title" style="margin:0">Reconciliation</span>
            </div>
            ${rec.anyDrift
              ? `<button class="btn btn-primary btn-sm" id="fin-reconcile">Sync headline figures</button>`
              : `<span style="font-size:12px;color:var(--green)">Headline figures match your accounts &amp; transactions</span>`}
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th></th><th style="text-align:right">Recorded</th><th style="text-align:right">Derived</th><th style="text-align:right">Drift</th></tr></thead>
              <tbody>
                ${rec.rows.map(r => `
                  <tr>
                    <td>${r.label}<div style="font-size:11px;color:var(--text-muted)">${r.source}</div></td>
                    <td style="text-align:right;font-family:'JetBrains Mono',monospace">${r.fmt(r.recorded)}</td>
                    <td style="text-align:right;font-family:'JetBrains Mono',monospace">${r.fmt(r.derived)}</td>
                    <td style="text-align:right;font-family:'JetBrains Mono',monospace;color:${r.drift ? 'var(--amber)' : 'var(--text-muted)'}">${r.drift ? r.fmt(r.derived - r.recorded) : '—'}</td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:8px">Derived from ${accounts.length} account${accounts.length !== 1 ? 's' : ''} and this month&rsquo;s transactions. Add transactions and account balances to keep these honest.</div>
        </div>
      </div>

      ${rules.length ? `
      <div class="section">
        <div class="card" style="border-left:3px solid var(--amber)">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
            <span style="font-size:16px">&#9888;</span>
            <span class="card-title" style="margin:0">Financial Rules</span>
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:8px">
            ${rules.map(r => `<span class="badge badge-amber" style="font-size:12px;padding:5px 10px;text-transform:none;letter-spacing:0">${this._esc(r)}</span>`).join('')}
          </div>
        </div>
      </div>` : ''}

      <div class="section">
        <div class="grid-2">
          <div>
            <div class="section-header">
              <span class="section-title">Accounts</span>
              <button class="btn btn-primary btn-sm" id="add-account">+ Account</button>
            </div>
            <div class="card" id="accounts-list">
              ${accounts.map(a => `
                <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 0;border-bottom:1px solid var(--border)">
                  <div>
                    <div style="font-size:14px;font-weight:500">${this._esc(a.name)}</div>
                    <div style="font-size:11px;color:var(--text-muted)">${this._esc(a.type)}</div>
                  </div>
                  <div style="text-align:right">
                    <div style="font-size:16px;font-weight:700;color:${a.balance >= 0 ? 'var(--green)' : 'var(--red)'}">${App.formatCurrency(a.balance)}</div>
                    <button class="btn btn-ghost btn-sm acct-edit" data-id="${App.escAttr(a.id)}">Edit</button>
                  </div>
                </div>
              `).join('')}
              ${!accounts.length ? '<div style="padding:16px;color:var(--text-muted);text-align:center;font-size:13px">No accounts added</div>' : ''}
            </div>
          </div>
          <div>
            <div class="section-header">
              <span class="section-title">Financial Goals</span>
              <button class="btn btn-primary btn-sm" id="add-goal">+ Goal</button>
            </div>
            <div id="goals-list">
            ${goals.map(g => {
              const pct = g.target ? Math.round((g.current / g.target) * 100) : 0;
              return `
                <div class="card" style="margin-bottom:10px">
                  <div style="display:flex;justify-content:space-between;margin-bottom:8px">
                    <span style="font-size:14px;font-weight:500">${this._esc(g.name)}</span>
                    <button class="btn btn-ghost btn-sm goal-edit" data-id="${App.escAttr(g.id)}">Edit</button>
                  </div>
                  <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text-secondary);margin-bottom:6px">
                    <span>${App.formatCurrency(g.current)}</span>
                    <span>${App.formatCurrency(g.target)}</span>
                  </div>
                  <div class="progress-bar"><div class="progress-fill purple" style="width:${Math.min(pct, 100)}%"></div></div>
                  <div style="text-align:right;font-size:11px;color:var(--text-muted);margin-top:4px">${pct}%</div>
                </div>
              `;
            }).join('')}
            ${!goals.length ? '<div class="card"><div style="padding:16px;color:var(--text-muted);text-align:center;font-size:13px">No goals set</div></div>' : ''}
            </div>
          </div>
        </div>
      </div>

      <div class="section">
        <div class="section-header">
          <span class="section-title">Recent Transactions</span>
          <button class="btn btn-primary btn-sm" id="add-transaction">+ Transaction</button>
        </div>
        <div class="card">
          <div class="table-wrap">
            <table>
              <thead><tr><th>Description</th><th>Category</th><th>Amount</th><th>Date</th><th></th></tr></thead>
              <tbody>
                ${[...transactions].sort((a, b) => b.date.localeCompare(a.date)).map(t => `
                  <tr>
                    <td style="font-weight:500">${this._esc(t.description)}</td>
                    <td><span class="badge badge-${t.amount > 0 ? 'green' : 'red'}">${this._esc(t.category)}</span></td>
                    <td style="font-weight:600;color:${t.amount > 0 ? 'var(--green)' : 'var(--red)'}">${t.amount > 0 ? '+' : ''}${App.formatCurrency(t.amount)}</td>
                    <td style="font-family:'JetBrains Mono',monospace;font-size:12px">${t.date}</td>
                    <td><button class="btn btn-danger btn-sm txn-del" data-id="${App.escAttr(t.id)}">&#10005;</button></td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
          ${!transactions.length ? '<div style="padding:16px;color:var(--text-muted);text-align:center;font-size:13px">No transactions recorded</div>' : ''}
        </div>
      </div>

      <div class="section">
        <div class="section-header"><span class="section-title">Overview Settings</span></div>
        <div class="card">
          <div class="form-row">
            <div class="form-group"><label>Net Worth</label><input id="s-nw" type="number" value="${f.netWorth || 0}"></div>
            <div class="form-group"><label>Monthly Income</label><input id="s-inc" type="number" value="${f.monthlyIncome || 0}"></div>
            <div class="form-group"><label>Monthly Expenses</label><input id="s-exp" type="number" value="${f.monthlyExpenses || 0}"></div>
            <div class="form-group"><label>Savings Rate %</label><input id="s-sr" type="number" value="${f.savingsRate || 0}"></div>
          </div>
          <button class="btn btn-primary btn-sm" id="save-overview" style="margin-top:8px">Save Overview</button>
        </div>
      </div>
    `;

    const reconcileBtn = document.getElementById('fin-reconcile');
    if (reconcileBtn) reconcileBtn.addEventListener('click', () => this._applyReconcile(rec));
    document.getElementById('add-account').addEventListener('click', () => this._editAccount());
    document.getElementById('add-goal').addEventListener('click', () => this._editGoal());
    document.getElementById('add-transaction').addEventListener('click', () => this._addTransaction());
    el.querySelectorAll('.acct-edit').forEach(b => b.addEventListener('click', () => this._editAccount(b.dataset.id)));
    el.querySelectorAll('.goal-edit').forEach(b => b.addEventListener('click', () => this._editGoal(b.dataset.id)));
    el.querySelectorAll('.txn-del').forEach(b => b.addEventListener('click', () => this._deleteTransaction(b.dataset.id)));
    document.getElementById('save-overview').addEventListener('click', () => {
      const fin = Storage.get('finance') || {};
      fin.netWorth = Number(document.getElementById('s-nw').value);
      fin.monthlyIncome = Number(document.getElementById('s-inc').value);
      fin.monthlyExpenses = Number(document.getElementById('s-exp').value);
      fin.savingsRate = Number(document.getElementById('s-sr').value);
      Storage.set('finance', fin);
      App.toast('Overview saved', 'success');
    });
  },

  // derive the "true" headline figures from source data and compare to the
  // hand-entered ones. A drift over a small tolerance is flagged.
  _reconcileData(f, accounts, transactions) {
    const money = App.formatCurrency.bind(App);
    const pct = v => (Math.round(v * 10) / 10) + '%';
    const accountsSum = accounts.reduce((s, a) => s + (Number(a.balance) || 0), 0);
    const now = new Date();
    const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const monthTx = transactions.filter(t => (t.date || '').startsWith(ym));
    const income = monthTx.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
    const expenses = monthTx.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);
    const savings = income > 0 ? (income - expenses) / income * 100 : 0;

    const drift = (a, b, tol) => Math.abs((Number(a) || 0) - b) > tol;
    const rows = [
      { key: 'netWorth', label: 'Net worth', source: 'sum of account balances', recorded: Number(f.netWorth) || 0, derived: accountsSum, fmt: money, drift: accounts.length > 0 && drift(f.netWorth, accountsSum, 1) },
      { key: 'monthlyIncome', label: 'Income this month', source: 'positive transactions', recorded: Number(f.monthlyIncome) || 0, derived: income, fmt: money, drift: monthTx.length > 0 && drift(f.monthlyIncome, income, 1) },
      { key: 'monthlyExpenses', label: 'Expenses this month', source: 'negative transactions', recorded: Number(f.monthlyExpenses) || 0, derived: expenses, fmt: money, drift: monthTx.length > 0 && drift(f.monthlyExpenses, expenses, 1) },
      { key: 'savingsRate', label: 'Savings rate', source: '(income − expenses) / income', recorded: Number(f.savingsRate) || 0, derived: Math.round(savings * 10) / 10, fmt: pct, drift: income > 0 && drift(f.savingsRate, savings, 0.5) },
    ];
    return { rows, anyDrift: rows.some(r => r.drift) };
  },

  _applyReconcile(rec) {
    const f = Storage.get('finance') || {};
    rec.rows.forEach(r => { if (r.drift) f[r.key] = r.derived; });
    if (Storage.set('finance', f) !== false) {
      App.toast('Headline figures synced to your data', 'success');
      this.render(document.getElementById('page-content'));
    }
  },

  // ─── FINANCIAL PROFILE ───
  _renderProfile(el) {
    const profile = Storage.get('finance_profile') || {};
    const rules = Storage.get('finance_rules') || [];
    const weakSpots = Storage.get('finance_weakspots') || [];

    el.innerHTML = `
      <div class="section">
        <div class="section-header">
          <span class="section-title">Investor Identity</span>
          <button class="btn btn-primary btn-sm" id="edit-profile">Edit Profile</button>
        </div>
        <div class="card">
          <div class="grid-2" style="gap:24px">
            <div>
              <div class="stat" style="margin-bottom:16px">
                <span class="stat-label">Name</span>
                <span style="font-size:16px;font-weight:600">${this._esc(profile.name || 'Not set')}</span>
              </div>
              <div class="stat" style="margin-bottom:16px">
                <span class="stat-label">Location</span>
                <span style="font-size:14px">${this._esc(profile.location || 'Not set')}</span>
              </div>
              <div class="stat" style="margin-bottom:16px">
                <span class="stat-label">Occupation</span>
                <span style="font-size:14px">${this._esc(profile.occupation || 'Not set')}</span>
              </div>
              <div class="stat" style="margin-bottom:16px">
                <span class="stat-label">Income Sources</span>
                <span style="font-size:14px">${this._esc(profile.incomeSources || 'Not set')}</span>
              </div>
            </div>
            <div>
              <div class="stat" style="margin-bottom:16px">
                <span class="stat-label">Risk Tolerance</span>
                <span style="font-size:14px">${this._esc(profile.riskTolerance || 'Not set')}</span>
              </div>
              <div class="stat" style="margin-bottom:16px">
                <span class="stat-label">Time Horizon</span>
                <span style="font-size:14px">${this._esc(profile.timeHorizon || 'Not set')}</span>
              </div>
              <div class="stat" style="margin-bottom:16px">
                <span class="stat-label">Investment Philosophy</span>
                <span style="font-size:14px">${this._esc(profile.philosophy || 'Not set')}</span>
              </div>
              <div class="stat">
                <span class="stat-label">Portfolio Purpose</span>
                <span style="font-size:14px">${this._esc(profile.purpose || 'Not set')}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="section">
        <div class="grid-2">
          <div>
            <div class="section-header">
              <span class="section-title">Financial Rules</span>
              <button class="btn btn-primary btn-sm" id="add-rule">+ Rule</button>
            </div>
            <div class="card" id="rules-list">
              ${rules.length ? rules.map((r, i) => `
                <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--border)">
                  <div style="display:flex;align-items:center;gap:10px">
                    <span style="font-size:16px;color:var(--amber)">&#9888;</span>
                    <span style="font-size:13px">${this._esc(r)}</span>
                  </div>
                  <button class="btn btn-danger btn-sm rule-del" data-idx="${i}">&#10005;</button>
                </div>
              `).join('') : '<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:13px">No rules set. Add rules to keep yourself accountable.</div>'}
            </div>
          </div>
          <div>
            <div class="section-header">
              <span class="section-title">Known Weak Spots</span>
              <button class="btn btn-primary btn-sm" id="add-weak">+ Weak Spot</button>
            </div>
            <div class="card" id="weak-list">
              ${weakSpots.length ? weakSpots.map((w, i) => `
                <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--border)">
                  <div style="display:flex;align-items:center;gap:10px">
                    <span style="font-size:16px;color:var(--red)">&#9679;</span>
                    <span style="font-size:13px">${this._esc(w)}</span>
                  </div>
                  <button class="btn btn-danger btn-sm weak-del" data-idx="${i}">&#10005;</button>
                </div>
              `).join('') : '<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:13px">Identify your spending weak spots to stay aware.</div>'}
            </div>
          </div>
        </div>
      </div>
    `;

    document.getElementById('edit-profile').addEventListener('click', () => this._editProfile());
    document.getElementById('add-rule').addEventListener('click', () => this._addListItem('finance_rules', 'Financial Rule', 'e.g. Never carry credit card balance above $2,000'));
    document.getElementById('add-weak').addEventListener('click', () => this._addListItem('finance_weakspots', 'Weak Spot', 'e.g. I overspend on dining out when stressed'));
    el.querySelectorAll('.rule-del').forEach(b => b.addEventListener('click', () => this._deleteListItem('finance_rules', Number(b.dataset.idx))));
    el.querySelectorAll('.weak-del').forEach(b => b.addEventListener('click', () => this._deleteListItem('finance_weakspots', Number(b.dataset.idx))));
  },

  _editProfile() {
    const p = Storage.get('finance_profile') || {};
    App.openModal('Edit Financial Profile', `
      <div class="form-group"><label>Name</label><input id="fp-name" value="${this._esc(p.name || '')}"></div>
      <div class="form-row">
        <div class="form-group"><label>Location</label><input id="fp-loc" value="${this._esc(p.location || '')}"></div>
        <div class="form-group"><label>Occupation</label><input id="fp-occ" value="${this._esc(p.occupation || '')}"></div>
      </div>
      <div class="form-group"><label>Income Sources</label><input id="fp-inc" value="${this._esc(p.incomeSources || '')}" placeholder="e.g. Salary $4,200 + Freelance $850"></div>
      <div class="form-row">
        <div class="form-group">
          <label>Risk Tolerance</label>
          <select id="fp-risk">
            <option value="Conservative" ${p.riskTolerance === 'Conservative' ? 'selected' : ''}>Conservative</option>
            <option value="Moderate" ${p.riskTolerance === 'Moderate' ? 'selected' : ''}>Moderate</option>
            <option value="Aggressive" ${p.riskTolerance === 'Aggressive' ? 'selected' : ''}>Aggressive</option>
          </select>
        </div>
        <div class="form-group">
          <label>Time Horizon</label>
          <select id="fp-time">
            <option value="Short-term (1-3 years)" ${p.timeHorizon?.startsWith('Short') ? 'selected' : ''}>Short-term (1-3 years)</option>
            <option value="Medium-term (3-10 years)" ${p.timeHorizon?.startsWith('Medium') ? 'selected' : ''}>Medium-term (3-10 years)</option>
            <option value="Long-term (10+ years)" ${p.timeHorizon?.startsWith('Long') ? 'selected' : ''}>Long-term (10+ years)</option>
          </select>
        </div>
      </div>
      <div class="form-group"><label>Investment Philosophy</label><textarea id="fp-phil" placeholder="In your own words...">${this._esc(p.philosophy || '')}</textarea></div>
      <div class="form-group"><label>Portfolio Purpose</label><input id="fp-purp" value="${this._esc(p.purpose || '')}" placeholder="e.g. Build $15K emergency fund by March 2027"></div>
      <div class="modal-actions">
        <button class="btn btn-secondary" onclick="App.closeModal()">Cancel</button>
        <button class="btn btn-primary" id="fp-save">Save</button>
      </div>
    `);
    document.getElementById('fp-save').addEventListener('click', () => {
      Storage.set('finance_profile', {
        name: document.getElementById('fp-name').value.trim(),
        location: document.getElementById('fp-loc').value.trim(),
        occupation: document.getElementById('fp-occ').value.trim(),
        incomeSources: document.getElementById('fp-inc').value.trim(),
        riskTolerance: document.getElementById('fp-risk').value,
        timeHorizon: document.getElementById('fp-time').value,
        philosophy: document.getElementById('fp-phil').value.trim(),
        purpose: document.getElementById('fp-purp').value.trim(),
      });
      App.closeModal();
      this.render(document.getElementById('page-content'));
      App.toast('Profile saved', 'success');
    });
  },

  _addListItem(key, title, placeholder) {
    App.openModal('Add ' + title, `
      <div class="form-group"><label>${title}</label><input id="fli-val" placeholder="${placeholder}"></div>
      <div class="modal-actions">
        <button class="btn btn-secondary" onclick="App.closeModal()">Cancel</button>
        <button class="btn btn-primary" id="fli-save">Add</button>
      </div>
    `);
    document.getElementById('fli-save').addEventListener('click', () => {
      const val = document.getElementById('fli-val').value.trim();
      if (!val) { App.toast('Cannot be empty', 'error'); return; }
      const list = Storage.get(key) || [];
      list.push(val);
      Storage.set(key, list);
      App.closeModal();
      this.render(document.getElementById('page-content'));
      App.toast(title + ' added', 'success');
    });
  },

  _deleteListItem(key, idx) {
    const list = Storage.get(key) || [];
    list.splice(idx, 1);
    Storage.set(key, list);
    this.render(document.getElementById('page-content'));
  },

  // ─── DEBT TRACKER ───
  _renderDebts(el) {
    const debts = Storage.get('finance_debts') || [];
    const totalDebt = debts.reduce((s, d) => s + d.balance, 0);
    const totalMin = debts.reduce((s, d) => s + d.minPayment, 0);
    const highestRate = debts.length ? Math.max(...debts.map(d => d.rate)) : 0;

    el.innerHTML = `
      <div class="section">
        <div class="grid-3">
          <div class="card" style="border-left:3px solid var(--red)">
            <div class="card-title">Total Debt</div>
            <div class="card-value" style="margin-top:8px;color:var(--red)">${App.formatCurrency(totalDebt)}</div>
          </div>
          <div class="card">
            <div class="card-title">Monthly Minimums</div>
            <div class="card-value" style="margin-top:8px;color:var(--amber)">${App.formatCurrency(totalMin)}</div>
          </div>
          <div class="card">
            <div class="card-title">Highest Rate</div>
            <div class="card-value" style="margin-top:8px;color:var(--pink)">${highestRate.toFixed(1)}%</div>
          </div>
        </div>
      </div>

      <div class="section">
        <div class="section-header">
          <span class="section-title">Debts</span>
          <button class="btn btn-primary btn-sm" id="add-debt">+ Add Debt</button>
        </div>
        ${debts.length ? `<div class="card">
          <div class="table-wrap">
            <table>
              <thead><tr><th>Name</th><th>Type</th><th>Balance</th><th>APR</th><th>Min Payment</th><th>Payoff Est.</th><th></th></tr></thead>
              <tbody>
                ${[...debts].sort((a, b) => b.rate - a.rate).map(d => {
                  const months = this._payoffMonths(d.balance, d.rate, d.minPayment);
                  return `
                    <tr>
                      <td style="font-weight:500">${this._esc(d.name)}</td>
                      <td><span class="badge badge-red">${this._esc(d.type)}</span></td>
                      <td style="font-weight:600;color:var(--red)">${App.formatCurrency(d.balance)}</td>
                      <td style="font-family:'JetBrains Mono',monospace">${d.rate}%</td>
                      <td>${App.formatCurrency(d.minPayment)}/mo</td>
                      <td style="font-size:12px;color:var(--text-secondary)">${months === Infinity ? 'Never' : months + ' months'}</td>
                      <td>
                        <button class="btn btn-ghost btn-sm debt-edit" data-id="${App.escAttr(d.id)}">Edit</button>
                        <button class="btn btn-danger btn-sm debt-del" data-id="${App.escAttr(d.id)}">&#10005;</button>
                      </td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>` : '<div class="card"><div style="padding:24px;text-align:center;color:var(--text-muted)">No debts tracked. Add your debts to see payoff projections.</div></div>'}
      </div>

      ${debts.length ? `
      <div class="section">
        <div class="section-title" style="margin-bottom:12px">Payoff Strategy (Avalanche — highest interest first)</div>
        <div class="card">
          ${[...debts].sort((a, b) => b.rate - a.rate).map((d, i) => {
            const pct = totalDebt ? Math.round((d.balance / totalDebt) * 100) : 0;
            const colors = ['var(--red)', 'var(--pink)', 'var(--amber)', 'var(--purple)', 'var(--accent)'];
            return `
              <div style="padding:10px 0;border-bottom:1px solid var(--border)">
                <div style="display:flex;justify-content:space-between;margin-bottom:6px">
                  <span style="font-size:13px;font-weight:500">${i + 1}. ${this._esc(d.name)} <span style="color:var(--text-muted);font-weight:400">(${d.rate}% APR)</span></span>
                  <span style="font-size:13px;font-weight:600;color:var(--red)">${App.formatCurrency(d.balance)}</span>
                </div>
                <div class="progress-bar"><div class="progress-fill" style="width:${pct}%;background:${colors[i % colors.length]}"></div></div>
              </div>
            `;
          }).join('')}
          <div style="padding:12px 0;font-size:12px;color:var(--text-secondary)">
            Pay minimums on all debts, put extra money toward #1 first. When it's paid off, roll that payment into #2.
          </div>
        </div>
      </div>` : ''}
    `;

    document.getElementById('add-debt').addEventListener('click', () => this._editDebt());
    el.querySelectorAll('.debt-edit').forEach(b => b.addEventListener('click', () => this._editDebt(b.dataset.id)));
    el.querySelectorAll('.debt-del').forEach(b => b.addEventListener('click', () => this._deleteDebt(b.dataset.id)));
  },

  _payoffMonths(balance, apr, payment) {
    if (payment <= 0) return Infinity;
    const r = apr / 100 / 12;
    if (r === 0) return Math.ceil(balance / payment);
    if (payment <= balance * r) return Infinity;
    return Math.ceil(-Math.log(1 - (balance * r) / payment) / Math.log(1 + r));
  },

  _editDebt(id) {
    const debts = Storage.get('finance_debts') || [];
    const d = id ? debts.find(d => d.id === id) : null;
    App.openModal(d ? 'Edit Debt' : 'New Debt', `
      <div class="form-group"><label>Name</label><input id="fd-name" value="${this._esc(d?.name || '')}" placeholder="e.g. Chase Sapphire"></div>
      <div class="form-row">
        <div class="form-group">
          <label>Type</label>
          <select id="fd-type">
            <option value="Credit Card" ${d?.type === 'Credit Card' ? 'selected' : ''}>Credit Card</option>
            <option value="Personal Loan" ${d?.type === 'Personal Loan' ? 'selected' : ''}>Personal Loan</option>
            <option value="Car Loan" ${d?.type === 'Car Loan' ? 'selected' : ''}>Car Loan</option>
            <option value="Mortgage" ${d?.type === 'Mortgage' ? 'selected' : ''}>Mortgage</option>
            <option value="Student Loan" ${d?.type === 'Student Loan' ? 'selected' : ''}>Student Loan</option>
            <option value="Other" ${d?.type === 'Other' ? 'selected' : ''}>Other</option>
          </select>
        </div>
        <div class="form-group"><label>Balance</label><input id="fd-bal" type="number" value="${d?.balance || 0}"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>APR %</label><input id="fd-rate" type="number" step="0.01" value="${d?.rate || 0}"></div>
        <div class="form-group"><label>Min Payment /mo</label><input id="fd-min" type="number" value="${d?.minPayment || 0}"></div>
      </div>
      <div class="modal-actions">
        ${d ? `<button class="btn btn-danger" id="fd-del">Delete</button>` : ''}
        <button class="btn btn-secondary" onclick="App.closeModal()">Cancel</button>
        <button class="btn btn-primary" id="fd-save">Save</button>
      </div>
    `);
    if (d) document.getElementById('fd-del').addEventListener('click', () => { this._deleteDebt(id); App.closeModal(); });
    document.getElementById('fd-save').addEventListener('click', () => {
      const name = document.getElementById('fd-name').value.trim();
      if (!name) { App.toast('Name required', 'error'); return; }
      const data = { id: d?.id || App.uid(), name, type: document.getElementById('fd-type').value, balance: Number(document.getElementById('fd-bal').value), rate: Number(document.getElementById('fd-rate').value), minPayment: Number(document.getElementById('fd-min').value) };
      const all = Storage.get('finance_debts') || [];
      if (d) { const i = all.findIndex(x => x.id === id); if (i >= 0) all[i] = data; }
      else all.push(data);
      Storage.set('finance_debts', all);
      App.closeModal();
      this.render(document.getElementById('page-content'));
      App.toast('Debt saved', 'success');
    });
  },

  _deleteDebt(id) {
    const debts = (Storage.get('finance_debts') || []).filter(d => d.id !== id);
    Storage.set('finance_debts', debts);
    this.render(document.getElementById('page-content'));
  },

  // ─── EXPENSE CATEGORIES ───
  _renderCategories(el) {
    const f = Storage.get('finance') || {};
    const transactions = f.transactions || [];
    const expenses = transactions.filter(t => t.amount < 0);
    const income = f.monthlyIncome || transactions.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);

    const catMap = {};
    const defaultCats = ['Housing', 'Food', 'Transport', 'Subscriptions', 'Health', 'Entertainment', 'Savings', 'Other'];
    expenses.forEach(t => {
      const cat = this._mapCategory(t.category);
      if (!catMap[cat]) catMap[cat] = { total: 0, count: 0, items: [] };
      catMap[cat].total += Math.abs(t.amount);
      catMap[cat].count++;
      catMap[cat].items.push(t);
    });

    const sorted = Object.entries(catMap).sort((a, b) => b[1].total - a[1].total);
    const totalExpenses = expenses.reduce((s, t) => s + Math.abs(t.amount), 0);
    const catColors = { Housing: 'var(--red)', Food: 'var(--amber)', Transport: 'var(--purple)', Subscriptions: 'var(--pink)', Health: 'var(--green)', Entertainment: 'var(--accent)', Savings: 'var(--green)', Other: 'var(--text-muted)' };

    el.innerHTML = `
      <div class="section">
        <div class="grid-3">
          <div class="card">
            <div class="card-title">Total Expenses</div>
            <div class="card-value" style="margin-top:8px;color:var(--red)">${App.formatCurrency(totalExpenses)}</div>
          </div>
          <div class="card">
            <div class="card-title">Categories Used</div>
            <div class="card-value" style="margin-top:8px">${sorted.length}</div>
          </div>
          <div class="card">
            <div class="card-title">Biggest Category</div>
            <div class="card-value" style="margin-top:8px;color:var(--amber)">${sorted.length ? sorted[0][0] : '-'}</div>
            <div class="card-subtitle">${sorted.length ? App.formatCurrency(sorted[0][1].total) : ''}</div>
          </div>
        </div>
      </div>

      <div class="section">
        <div class="section-title" style="margin-bottom:12px">Spending Breakdown</div>
        <div class="card">
          ${sorted.length ? sorted.map(([cat, data]) => {
            const pct = totalExpenses ? Math.round((data.total / totalExpenses) * 100) : 0;
            const incPct = income ? (data.total / income * 100).toFixed(1) : 0;
            const color = catColors[cat] || 'var(--text-muted)';
            return `
              <div style="padding:12px 0;border-bottom:1px solid var(--border)">
                <div style="display:flex;justify-content:space-between;margin-bottom:6px">
                  <div style="display:flex;align-items:center;gap:8px">
                    <span style="width:10px;height:10px;border-radius:2px;background:${color};display:inline-block"></span>
                    <span style="font-size:14px;font-weight:500">${this._esc(cat)}</span>
                    <span style="font-size:11px;color:var(--text-muted)">${data.count} txn${data.count !== 1 ? 's' : ''}</span>
                  </div>
                  <div style="text-align:right">
                    <span style="font-size:14px;font-weight:600;color:var(--red)">${App.formatCurrency(data.total)}</span>
                    <span style="font-size:11px;color:var(--text-muted);margin-left:8px">${pct}% of spend &middot; ${incPct}% of income</span>
                  </div>
                </div>
                <div class="progress-bar"><div class="progress-fill" style="width:${pct}%;background:${color}"></div></div>
              </div>
            `;
          }).join('') : '<div style="padding:24px;text-align:center;color:var(--text-muted)">No expense transactions yet. Add transactions in the Overview tab to see category analysis.</div>'}
        </div>
      </div>

      ${sorted.length >= 3 ? `
      <div class="section">
        <div class="section-title" style="margin-bottom:12px">Top 3 Spending Areas (% of Income)</div>
        <div class="grid-3">
          ${sorted.slice(0, 3).map(([cat, data]) => {
            const incPct = income ? (data.total / income * 100).toFixed(1) : 0;
            const color = catColors[cat] || 'var(--text-muted)';
            return `
              <div class="card" style="border-top:3px solid ${color}">
                <div style="font-size:13px;font-weight:600;margin-bottom:4px">${this._esc(cat)}</div>
                <div style="font-size:24px;font-weight:800;color:${color}">${incPct}%</div>
                <div style="font-size:11px;color:var(--text-muted)">of monthly income</div>
              </div>
            `;
          }).join('')}
        </div>
      </div>` : ''}
    `;
  },

  _mapCategory(cat) {
    if (!cat) return 'Other';
    const c = cat.toLowerCase();
    if (['rent', 'mortgage', 'housing', 'utilities'].some(k => c.includes(k))) return 'Housing';
    if (['food', 'grocery', 'groceries', 'dining', 'restaurant'].some(k => c.includes(k))) return 'Food';
    if (['transport', 'gas', 'fuel', 'car', 'uber', 'lyft', 'parking'].some(k => c.includes(k))) return 'Transport';
    if (['subscription', 'netflix', 'spotify', 'software'].some(k => c.includes(k))) return 'Subscriptions';
    if (['health', 'gym', 'medical', 'pharmacy', 'fitness'].some(k => c.includes(k))) return 'Health';
    if (['entertainment', 'fun', 'games', 'movies', 'concerts'].some(k => c.includes(k))) return 'Entertainment';
    if (['savings', 'investment', 'invest'].some(k => c.includes(k))) return 'Savings';
    if (['income', 'salary', 'freelance', 'revenue'].some(k => c.includes(k))) return 'Income';
    return cat;
  },

  // ─── MONTHLY TRENDS ───
  _renderTrends(el) {
    const snapshots = Storage.get('finance_snapshots') || [];
    const sorted = [...snapshots].sort((a, b) => a.month.localeCompare(b.month));

    el.innerHTML = `
      <div class="section">
        <div class="section-header">
          <span class="section-title">Monthly Snapshots</span>
          <button class="btn btn-primary btn-sm" id="add-snapshot">+ Log Month</button>
        </div>

        ${sorted.length ? `
        <div class="grid-4" style="margin-bottom:20px">
          <div class="card">
            <div class="card-title">Avg Income</div>
            <div class="card-value" style="margin-top:8px;color:var(--green)">${App.formatCurrency(sorted.reduce((s, m) => s + m.income, 0) / sorted.length)}</div>
          </div>
          <div class="card">
            <div class="card-title">Avg Expenses</div>
            <div class="card-value" style="margin-top:8px;color:var(--red)">${App.formatCurrency(sorted.reduce((s, m) => s + m.expenses, 0) / sorted.length)}</div>
          </div>
          <div class="card">
            <div class="card-title">Avg Savings</div>
            <div class="card-value" style="margin-top:8px;color:var(--accent)">${App.formatCurrency(sorted.reduce((s, m) => s + m.saved, 0) / sorted.length)}</div>
          </div>
          <div class="card">
            <div class="card-title">Avg Savings Rate</div>
            <div class="card-value" style="margin-top:8px;color:var(--purple)">${(sorted.reduce((s, m) => s + (m.income ? (m.saved / m.income * 100) : 0), 0) / sorted.length).toFixed(1)}%</div>
          </div>
        </div>

        <div class="card" style="margin-bottom:20px">
          <div class="table-wrap">
            <table>
              <thead><tr><th>Month</th><th>Income</th><th>Expenses</th><th>Saved</th><th>Rate</th><th>Net Position</th><th></th></tr></thead>
              <tbody>
                ${sorted.map(m => {
                  const rate = m.income ? (m.saved / m.income * 100).toFixed(1) : 0;
                  const net = m.income - m.expenses;
                  return `
                    <tr>
                      <td style="font-weight:500;font-family:'JetBrains Mono',monospace">${m.month}</td>
                      <td style="color:var(--green)">${App.formatCurrency(m.income)}</td>
                      <td style="color:var(--red)">${App.formatCurrency(m.expenses)}</td>
                      <td style="color:var(--accent)">${App.formatCurrency(m.saved)}</td>
                      <td><span class="badge badge-${Number(rate) >= 20 ? 'green' : Number(rate) >= 10 ? 'amber' : 'red'}">${rate}%</span></td>
                      <td style="font-weight:600;color:${net >= 0 ? 'var(--green)' : 'var(--red)'}">${net >= 0 ? '+' : ''}${App.formatCurrency(net)}</td>
                      <td><button class="btn btn-danger btn-sm snap-del" data-id="${App.escAttr(m.id)}">&#10005;</button></td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>

        ${sorted.length >= 2 ? `
        <div class="section-title" style="margin-bottom:12px">Trend Visualization</div>
        <div class="card">
          ${sorted.map((m, i) => {
            const maxInc = Math.max(...sorted.map(s => s.income));
            const incW = maxInc ? (m.income / maxInc * 100) : 0;
            const expW = maxInc ? (m.expenses / maxInc * 100) : 0;
            const savW = maxInc ? (m.saved / maxInc * 100) : 0;
            return `
              <div style="padding:10px 0;border-bottom:1px solid var(--border)">
                <div style="font-size:12px;font-weight:600;margin-bottom:6px;font-family:'JetBrains Mono',monospace">${m.month}</div>
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:3px">
                  <span style="font-size:10px;color:var(--text-muted);min-width:50px">Income</span>
                  <div class="progress-bar" style="flex:1"><div class="progress-fill green" style="width:${incW}%"></div></div>
                  <span style="font-size:11px;min-width:60px;text-align:right">${App.formatCurrency(m.income)}</span>
                </div>
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:3px">
                  <span style="font-size:10px;color:var(--text-muted);min-width:50px">Expense</span>
                  <div class="progress-bar" style="flex:1"><div class="progress-fill red" style="width:${expW}%"></div></div>
                  <span style="font-size:11px;min-width:60px;text-align:right">${App.formatCurrency(m.expenses)}</span>
                </div>
                <div style="display:flex;align-items:center;gap:8px">
                  <span style="font-size:10px;color:var(--text-muted);min-width:50px">Saved</span>
                  <div class="progress-bar" style="flex:1"><div class="progress-fill accent" style="width:${savW}%"></div></div>
                  <span style="font-size:11px;min-width:60px;text-align:right">${App.formatCurrency(m.saved)}</span>
                </div>
              </div>
            `;
          }).join('')}
        </div>` : ''}
        ` : '<div class="card"><div style="padding:32px;text-align:center;color:var(--text-muted)">No monthly snapshots yet. Log your first month to start tracking trends over time.</div></div>'}
      </div>
    `;

    document.getElementById('add-snapshot').addEventListener('click', () => this._addSnapshot());
    el.querySelectorAll('.snap-del').forEach(b => b.addEventListener('click', () => {
      const snaps = (Storage.get('finance_snapshots') || []).filter(s => s.id !== b.dataset.id);
      Storage.set('finance_snapshots', snaps);
      this.render(document.getElementById('page-content'));
    }));
  },

  _addSnapshot() {
    const now = new Date();
    const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    App.openModal('Log Monthly Snapshot', `
      <div class="form-group"><label>Month (YYYY-MM)</label><input id="fs-month" type="month" value="${defaultMonth}"></div>
      <div class="form-row">
        <div class="form-group"><label>Total Income</label><input id="fs-inc" type="number" placeholder="5050"></div>
        <div class="form-group"><label>Total Expenses</label><input id="fs-exp" type="number" placeholder="3360"></div>
      </div>
      <div class="form-group"><label>Amount Saved</label><input id="fs-saved" type="number" placeholder="300"></div>
      <div class="modal-actions">
        <button class="btn btn-secondary" onclick="App.closeModal()">Cancel</button>
        <button class="btn btn-primary" id="fs-save">Save</button>
      </div>
    `);
    document.getElementById('fs-save').addEventListener('click', () => {
      const month = document.getElementById('fs-month').value;
      if (!month) { App.toast('Month required', 'error'); return; }
      const snaps = Storage.get('finance_snapshots') || [];
      snaps.push({
        id: App.uid(), month,
        income: Number(document.getElementById('fs-inc').value),
        expenses: Number(document.getElementById('fs-exp').value),
        saved: Number(document.getElementById('fs-saved').value),
      });
      Storage.set('finance_snapshots', snaps);
      App.closeModal();
      this.render(document.getElementById('page-content'));
      App.toast('Snapshot logged', 'success');
    });
  },

  // ─── SHARED HELPERS ───
  _editAccount(id) {
    const f = Storage.get('finance') || {};
    const acct = id ? (f.accounts || []).find(a => a.id === id) : null;
    App.openModal(acct ? 'Edit Account' : 'New Account', `
      <div class="form-group"><label>Name</label><input id="fa-name" value="${this._esc(acct?.name || '')}"></div>
      <div class="form-row">
        <div class="form-group"><label>Type</label>
          <select id="fa-type">
            <option value="bank" ${acct?.type === 'bank' ? 'selected' : ''}>Bank</option>
            <option value="investment" ${acct?.type === 'investment' ? 'selected' : ''}>Investment</option>
            <option value="crypto" ${acct?.type === 'crypto' ? 'selected' : ''}>Crypto</option>
            <option value="other" ${acct?.type === 'other' ? 'selected' : ''}>Other</option>
          </select>
        </div>
        <div class="form-group"><label>Balance</label><input id="fa-bal" type="number" value="${acct?.balance || 0}"></div>
      </div>
      <div class="modal-actions">
        ${acct ? `<button class="btn btn-danger" id="fa-del">Delete</button>` : ''}
        <button class="btn btn-secondary" onclick="App.closeModal()">Cancel</button>
        <button class="btn btn-primary" id="fa-save">Save</button>
      </div>
    `);
    if (acct) document.getElementById('fa-del').addEventListener('click', () => { this._deleteAccount(id); App.closeModal(); });
    document.getElementById('fa-save').addEventListener('click', () => {
      const name = document.getElementById('fa-name').value.trim();
      if (!name) { App.toast('Name required', 'error'); return; }
      const fin = Storage.get('finance') || {};
      if (!fin.accounts) fin.accounts = [];
      const data = { id: acct?.id || App.uid(), name, type: document.getElementById('fa-type').value, balance: Number(document.getElementById('fa-bal').value) };
      if (acct) { const i = fin.accounts.findIndex(a => a.id === id); if (i >= 0) fin.accounts[i] = data; }
      else fin.accounts.push(data);
      Storage.set('finance', fin);
      App.closeModal();
      this.render(document.getElementById('page-content'));
      App.toast('Account saved', 'success');
    });
  },

  _deleteAccount(id) {
    const f = Storage.get('finance') || {};
    f.accounts = (f.accounts || []).filter(a => a.id !== id);
    Storage.set('finance', f);
    this.render(document.getElementById('page-content'));
  },

  _editGoal(id) {
    const f = Storage.get('finance') || {};
    const goal = id ? (f.goals || []).find(g => g.id === id) : null;
    App.openModal(goal ? 'Edit Goal' : 'New Goal', `
      <div class="form-group"><label>Goal Name</label><input id="fg-name" value="${this._esc(goal?.name || '')}"></div>
      <div class="form-row">
        <div class="form-group"><label>Target</label><input id="fg-target" type="number" value="${goal?.target || 0}"></div>
        <div class="form-group"><label>Current</label><input id="fg-current" type="number" value="${goal?.current || 0}"></div>
      </div>
      <div class="modal-actions">
        ${goal ? `<button class="btn btn-danger" id="fg-del">Delete</button>` : ''}
        <button class="btn btn-secondary" onclick="App.closeModal()">Cancel</button>
        <button class="btn btn-primary" id="fg-save">Save</button>
      </div>
    `);
    if (goal) document.getElementById('fg-del').addEventListener('click', () => { this._deleteGoal(id); App.closeModal(); });
    document.getElementById('fg-save').addEventListener('click', () => {
      const name = document.getElementById('fg-name').value.trim();
      if (!name) { App.toast('Name required', 'error'); return; }
      const fin = Storage.get('finance') || {};
      if (!fin.goals) fin.goals = [];
      const data = { id: goal?.id || App.uid(), name, target: Number(document.getElementById('fg-target').value), current: Number(document.getElementById('fg-current').value) };
      if (goal) { const i = fin.goals.findIndex(g => g.id === id); if (i >= 0) fin.goals[i] = data; }
      else fin.goals.push(data);
      Storage.set('finance', fin);
      App.closeModal();
      this.render(document.getElementById('page-content'));
      App.toast('Goal saved', 'success');
    });
  },

  _deleteGoal(id) {
    const f = Storage.get('finance') || {};
    f.goals = (f.goals || []).filter(g => g.id !== id);
    Storage.set('finance', f);
    this.render(document.getElementById('page-content'));
  },

  _addTransaction() {
    App.openModal('New Transaction', `
      <div class="form-group"><label>Description</label><input id="ft-desc" placeholder="What was it for?"></div>
      <div class="form-row">
        <div class="form-group"><label>Amount (negative for expense)</label><input id="ft-amount" type="number" placeholder="-50"></div>
        <div class="form-group">
          <label>Category</label>
          <select id="ft-cat">
            <option value="Income">Income</option>
            <option value="Housing">Housing</option>
            <option value="Food" selected>Food</option>
            <option value="Transport">Transport</option>
            <option value="Subscriptions">Subscriptions</option>
            <option value="Health">Health</option>
            <option value="Entertainment">Entertainment</option>
            <option value="Savings">Savings</option>
            <option value="Other">Other</option>
          </select>
        </div>
      </div>
      <div class="form-group"><label>Date</label><input id="ft-date" type="date" value="${App.getToday()}"></div>
      <div class="modal-actions">
        <button class="btn btn-secondary" onclick="App.closeModal()">Cancel</button>
        <button class="btn btn-primary" id="ft-save">Save</button>
      </div>
    `);
    document.getElementById('ft-save').addEventListener('click', () => {
      const desc = document.getElementById('ft-desc').value.trim();
      if (!desc) { App.toast('Description required', 'error'); return; }
      const fin = Storage.get('finance') || {};
      if (!fin.transactions) fin.transactions = [];
      fin.transactions.push({
        id: App.uid(), description: desc,
        amount: Number(document.getElementById('ft-amount').value),
        category: document.getElementById('ft-cat').value,
        date: document.getElementById('ft-date').value
      });
      Storage.set('finance', fin);
      App.closeModal();
      this.render(document.getElementById('page-content'));
      App.toast('Transaction added', 'success');
    });
  },

  _deleteTransaction(id) {
    const f = Storage.get('finance') || {};
    f.transactions = (f.transactions || []).filter(t => t.id !== id);
    Storage.set('finance', f);
    this.render(document.getElementById('page-content'));
  },

  _esc(s) {
    if (!s) return '';
    const d = document.createElement('div');
    d.textContent = s;
    // also escape quotes: _esc output is interpolated into value="..." attributes,
    // where an unescaped quote truncates the field and silently corrupts data
    return d.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
});
