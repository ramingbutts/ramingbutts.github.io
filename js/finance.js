App.registerPage('finance', {
  render(container) {
    const f = Storage.get('finance') || {};
    const accounts = f.accounts || [];
    const transactions = f.transactions || [];
    const goals = f.goals || [];

    const totalBalance = accounts.reduce((s, a) => s + a.balance, 0);
    const income = transactions.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
    const expenses = transactions.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);

    container.innerHTML = `
      <div class="section">
        <div class="grid-4">
          <div class="card glow">
            <div class="card-title">Net Worth</div>
            <div class="card-value" style="margin-top:8px;color:var(--accent)">${App.formatCurrency(f.netWorth || totalBalance)}</div>
          </div>
          <div class="card">
            <div class="card-title">Monthly Income</div>
            <div class="card-value" style="margin-top:8px;color:var(--green)">${App.formatCurrency(f.monthlyIncome || income)}</div>
          </div>
          <div class="card">
            <div class="card-title">Monthly Expenses</div>
            <div class="card-value" style="margin-top:8px;color:var(--red)">${App.formatCurrency(f.monthlyExpenses || expenses)}</div>
          </div>
          <div class="card">
            <div class="card-title">Savings Rate</div>
            <div class="card-value" style="margin-top:8px;color:var(--purple)">${f.savingsRate || 0}%</div>
          </div>
        </div>
      </div>

      <div class="section">
        <div class="grid-2">
          <div>
            <div class="section-header">
              <span class="section-title">Accounts</span>
              <button class="btn btn-primary btn-sm" id="add-account">+ Account</button>
            </div>
            <div class="card">
              ${accounts.map(a => `
                <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 0;border-bottom:1px solid var(--border)">
                  <div>
                    <div style="font-size:14px;font-weight:500">${this._esc(a.name)}</div>
                    <div style="font-size:11px;color:var(--text-muted)">${a.type}</div>
                  </div>
                  <div style="text-align:right">
                    <div style="font-size:16px;font-weight:700;color:${a.balance >= 0 ? 'var(--green)' : 'var(--red)'}">${App.formatCurrency(a.balance)}</div>
                    <button class="btn btn-ghost btn-sm" onclick="App.pages.finance._editAccount('${a.id}')">Edit</button>
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
            ${goals.map(g => {
              const pct = g.target ? Math.round((g.current / g.target) * 100) : 0;
              return `
                <div class="card" style="margin-bottom:10px">
                  <div style="display:flex;justify-content:space-between;margin-bottom:8px">
                    <span style="font-size:14px;font-weight:500">${this._esc(g.name)}</span>
                    <button class="btn btn-ghost btn-sm" onclick="App.pages.finance._editGoal('${g.id}')">Edit</button>
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
                    <td><button class="btn btn-danger btn-sm" onclick="App.pages.finance._deleteTransaction('${t.id}')">&#10005;</button></td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
          ${!transactions.length ? '<div style="padding:16px;color:var(--text-muted);text-align:center;font-size:13px">No transactions recorded</div>' : ''}
        </div>
      </div>

      <div class="section">
        <div class="section-header">
          <span class="section-title">Overview Settings</span>
        </div>
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

    document.getElementById('add-account').onclick = () => this._editAccount();
    document.getElementById('add-goal').onclick = () => this._editGoal();
    document.getElementById('add-transaction').onclick = () => this._addTransaction();
    document.getElementById('save-overview').onclick = () => {
      const fin = Storage.get('finance') || {};
      fin.netWorth = Number(document.getElementById('s-nw').value);
      fin.monthlyIncome = Number(document.getElementById('s-inc').value);
      fin.monthlyExpenses = Number(document.getElementById('s-exp').value);
      fin.savingsRate = Number(document.getElementById('s-sr').value);
      Storage.set('finance', fin);
      App.toast('Overview saved', 'success');
    };
  },

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
        ${acct ? `<button class="btn btn-danger" onclick="App.pages.finance._deleteAccount('${id}');App.closeModal()">Delete</button>` : ''}
        <button class="btn btn-secondary" onclick="App.closeModal()">Cancel</button>
        <button class="btn btn-primary" id="fa-save">Save</button>
      </div>
    `);
    document.getElementById('fa-save').onclick = () => {
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
    };
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
        ${goal ? `<button class="btn btn-danger" onclick="App.pages.finance._deleteGoal('${id}');App.closeModal()">Delete</button>` : ''}
        <button class="btn btn-secondary" onclick="App.closeModal()">Cancel</button>
        <button class="btn btn-primary" id="fg-save">Save</button>
      </div>
    `);
    document.getElementById('fg-save').onclick = () => {
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
    };
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
        <div class="form-group"><label>Category</label><input id="ft-cat" placeholder="Food, Income, etc."></div>
      </div>
      <div class="form-group"><label>Date</label><input id="ft-date" type="date" value="${App.getToday()}"></div>
      <div class="modal-actions">
        <button class="btn btn-secondary" onclick="App.closeModal()">Cancel</button>
        <button class="btn btn-primary" id="ft-save">Save</button>
      </div>
    `);
    document.getElementById('ft-save').onclick = () => {
      const desc = document.getElementById('ft-desc').value.trim();
      if (!desc) { App.toast('Description required', 'error'); return; }
      const fin = Storage.get('finance') || {};
      if (!fin.transactions) fin.transactions = [];
      fin.transactions.push({
        id: App.uid(), description: desc,
        amount: Number(document.getElementById('ft-amount').value),
        category: document.getElementById('ft-cat').value.trim(),
        date: document.getElementById('ft-date').value
      });
      Storage.set('finance', fin);
      App.closeModal();
      this.render(document.getElementById('page-content'));
      App.toast('Transaction added', 'success');
    };
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
    return d.innerHTML;
  }
});
