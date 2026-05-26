App.registerPage('nutrition', {
  render(container) {
    const data = Storage.get('nutrition') || { goals: { calories: 2200, protein: 150, carbs: 250, fat: 70, water: 8 }, entries: [] };
    const today = App.getToday();
    const todayEntries = (data.entries || []).filter(e => e.date === today);

    const totals = { calories: 0, protein: 0, carbs: 0, fat: 0 };
    todayEntries.forEach(entry => {
      (entry.items || []).forEach(item => {
        totals.calories += item.calories || 0;
        totals.protein += item.protein || 0;
        totals.carbs += item.carbs || 0;
        totals.fat += item.fat || 0;
      });
    });

    const goals = data.goals || {};
    const calPct = goals.calories ? Math.min(Math.round((totals.calories / goals.calories) * 100), 100) : 0;
    const protPct = goals.protein ? Math.min(Math.round((totals.protein / goals.protein) * 100), 100) : 0;
    const carbPct = goals.carbs ? Math.min(Math.round((totals.carbs / goals.carbs) * 100), 100) : 0;
    const fatPct = goals.fat ? Math.min(Math.round((totals.fat / goals.fat) * 100), 100) : 0;

    const waterLogged = Storage.get('water_' + today) || 0;
    const waterPct = goals.water ? Math.min(Math.round((waterLogged / goals.water) * 100), 100) : 0;

    container.innerHTML = `
      <div class="section">
        <div class="grid-4">
          <div class="card glow">
            <div class="card-title">Calories</div>
            <div class="card-value" style="margin-top:6px;color:var(--accent)">${totals.calories}</div>
            <div class="card-subtitle">/ ${goals.calories || 0} kcal</div>
            <div class="progress-bar" style="margin-top:8px"><div class="progress-fill accent" style="width:${calPct}%"></div></div>
          </div>
          <div class="card">
            <div class="card-title">Protein</div>
            <div class="card-value" style="margin-top:6px;color:var(--green)">${totals.protein}g</div>
            <div class="card-subtitle">/ ${goals.protein || 0}g</div>
            <div class="progress-bar" style="margin-top:8px"><div class="progress-fill green" style="width:${protPct}%"></div></div>
          </div>
          <div class="card">
            <div class="card-title">Carbs</div>
            <div class="card-value" style="margin-top:6px;color:var(--amber)">${totals.carbs}g</div>
            <div class="card-subtitle">/ ${goals.carbs || 0}g</div>
            <div class="progress-bar" style="margin-top:8px"><div class="progress-fill amber" style="width:${carbPct}%"></div></div>
          </div>
          <div class="card">
            <div class="card-title">Fat</div>
            <div class="card-value" style="margin-top:6px;color:var(--pink)">${totals.fat}g</div>
            <div class="card-subtitle">/ ${goals.fat || 0}g</div>
            <div class="progress-bar" style="margin-top:8px"><div class="progress-fill pink" style="width:${fatPct}%"></div></div>
          </div>
        </div>
      </div>

      <div class="section">
        <div class="grid-2">
          <div>
            <div class="section-header">
              <span class="section-title">Water Intake</span>
            </div>
            <div class="card">
              <div style="display:flex;align-items:center;gap:16px">
                <div style="font-size:32px">💧</div>
                <div style="flex:1">
                  <div style="font-size:18px;font-weight:700;color:var(--accent)">${waterLogged} / ${goals.water || 8} glasses</div>
                  <div class="progress-bar" style="margin-top:8px"><div class="progress-fill accent" style="width:${waterPct}%"></div></div>
                </div>
                <button class="btn btn-primary btn-sm" id="add-water">+ Glass</button>
                <button class="btn btn-secondary btn-sm" id="sub-water">-</button>
              </div>
            </div>
          </div>
          <div>
            <div class="section-header">
              <span class="section-title">Daily Goals</span>
              <button class="btn btn-secondary btn-sm" id="edit-goals">Edit</button>
            </div>
            <div class="card">
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
                <div><span style="font-size:12px;color:var(--text-muted)">Calories</span><div style="font-weight:600">${goals.calories} kcal</div></div>
                <div><span style="font-size:12px;color:var(--text-muted)">Protein</span><div style="font-weight:600">${goals.protein}g</div></div>
                <div><span style="font-size:12px;color:var(--text-muted)">Carbs</span><div style="font-weight:600">${goals.carbs}g</div></div>
                <div><span style="font-size:12px;color:var(--text-muted)">Fat</span><div style="font-weight:600">${goals.fat}g</div></div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="section">
        <div class="section-header">
          <span class="section-title">Today's Meals</span>
          <button class="btn btn-primary btn-sm" id="add-meal">+ Add Meal</button>
        </div>
        ${todayEntries.length ? todayEntries.map(entry => {
          const mealCals = (entry.items || []).reduce((s, i) => s + (i.calories || 0), 0);
          return `
            <div class="meal-card">
              <div class="meal-header">
                <div class="meal-name">${this._esc(entry.meal)}</div>
                <div style="display:flex;gap:8px;align-items:center">
                  <span class="meal-cals">${mealCals} kcal</span>
                  <button class="btn btn-danger btn-sm" onclick="App.pages.nutrition._deleteMeal('${entry.id}')">&#10005;</button>
                </div>
              </div>
              ${(entry.items || []).map(item => `
                <div class="meal-item">
                  <span>${this._esc(item.name)}</span>
                  <span>${item.calories}cal &middot; ${item.protein}p &middot; ${item.carbs}c &middot; ${item.fat}f</span>
                </div>
              `).join('')}
            </div>
          `;
        }).join('') : '<div class="card"><div class="empty-state" style="padding:24px"><div class="empty-state-text">No meals logged today</div></div></div>'}
      </div>
    `;

    document.getElementById('add-water').onclick = () => {
      Storage.set('water_' + today, Math.min(waterLogged + 1, 20));
      this.render(container);
    };
    document.getElementById('sub-water').onclick = () => {
      Storage.set('water_' + today, Math.max(waterLogged - 1, 0));
      this.render(container);
    };
    document.getElementById('add-meal').onclick = () => this._addMeal();
    document.getElementById('edit-goals').onclick = () => this._editGoals(data);
  },

  _addMeal() {
    App.openModal('Log Meal', `
      <div class="form-group">
        <label>Meal Name</label>
        <select id="fn-meal">
          <option value="Breakfast">Breakfast</option>
          <option value="Lunch">Lunch</option>
          <option value="Dinner">Dinner</option>
          <option value="Snack">Snack</option>
        </select>
      </div>
      <div id="fn-items">
        <div class="form-group" style="font-size:12px;color:var(--text-muted);margin-bottom:8px">Food Items</div>
        <div class="fn-item-row">
          <div class="form-row" style="margin-bottom:8px">
            <div class="form-group"><label>Food</label><input class="fn-name" placeholder="e.g. Chicken breast"></div>
            <div class="form-group"><label>Cal</label><input class="fn-cal" type="number" placeholder="200"></div>
            <div class="form-group"><label>P(g)</label><input class="fn-prot" type="number" placeholder="30"></div>
            <div class="form-group"><label>C(g)</label><input class="fn-carb" type="number" placeholder="0"></div>
            <div class="form-group"><label>F(g)</label><input class="fn-fat" type="number" placeholder="5"></div>
          </div>
        </div>
      </div>
      <button class="btn btn-secondary btn-sm" id="fn-add-item" style="margin-bottom:12px">+ Add item</button>
      <div class="modal-actions">
        <button class="btn btn-secondary" onclick="App.closeModal()">Cancel</button>
        <button class="btn btn-primary" id="fn-save">Save Meal</button>
      </div>
    `);

    document.getElementById('fn-add-item').onclick = () => {
      const row = document.createElement('div');
      row.className = 'fn-item-row';
      row.innerHTML = `<div class="form-row" style="margin-bottom:8px">
        <div class="form-group"><input class="fn-name" placeholder="Food"></div>
        <div class="form-group"><input class="fn-cal" type="number" placeholder="Cal"></div>
        <div class="form-group"><input class="fn-prot" type="number" placeholder="P"></div>
        <div class="form-group"><input class="fn-carb" type="number" placeholder="C"></div>
        <div class="form-group"><input class="fn-fat" type="number" placeholder="F"></div>
      </div>`;
      document.getElementById('fn-items').appendChild(row);
    };

    document.getElementById('fn-save').onclick = () => {
      const meal = document.getElementById('fn-meal').value;
      const rows = document.querySelectorAll('.fn-item-row');
      const items = [];
      rows.forEach(row => {
        const name = row.querySelector('.fn-name')?.value.trim();
        if (name) {
          items.push({
            name,
            calories: Number(row.querySelector('.fn-cal')?.value || 0),
            protein: Number(row.querySelector('.fn-prot')?.value || 0),
            carbs: Number(row.querySelector('.fn-carb')?.value || 0),
            fat: Number(row.querySelector('.fn-fat')?.value || 0),
          });
        }
      });
      if (!items.length) { App.toast('Add at least one food item', 'error'); return; }

      const data = Storage.get('nutrition') || { goals: {}, entries: [] };
      if (!data.entries) data.entries = [];
      data.entries.push({ id: App.uid(), date: App.getToday(), meal, items });
      Storage.set('nutrition', data);
      App.closeModal();
      this.render(document.getElementById('page-content'));
      App.toast('Meal logged', 'success');
    };
  },

  _deleteMeal(id) {
    const data = Storage.get('nutrition') || { goals: {}, entries: [] };
    data.entries = (data.entries || []).filter(e => e.id !== id);
    Storage.set('nutrition', data);
    this.render(document.getElementById('page-content'));
  },

  _editGoals(data) {
    const g = data.goals || {};
    App.openModal('Edit Daily Goals', `
      <div class="form-row">
        <div class="form-group"><label>Calories (kcal)</label><input id="ng-cal" type="number" value="${g.calories || 2200}"></div>
        <div class="form-group"><label>Protein (g)</label><input id="ng-prot" type="number" value="${g.protein || 150}"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Carbs (g)</label><input id="ng-carb" type="number" value="${g.carbs || 250}"></div>
        <div class="form-group"><label>Fat (g)</label><input id="ng-fat" type="number" value="${g.fat || 70}"></div>
      </div>
      <div class="form-group"><label>Water (glasses/day)</label><input id="ng-water" type="number" value="${g.water || 8}"></div>
      <div class="modal-actions">
        <button class="btn btn-secondary" onclick="App.closeModal()">Cancel</button>
        <button class="btn btn-primary" id="ng-save">Save</button>
      </div>
    `);
    document.getElementById('ng-save').onclick = () => {
      const d = Storage.get('nutrition') || { goals: {}, entries: [] };
      d.goals = {
        calories: Number(document.getElementById('ng-cal').value),
        protein: Number(document.getElementById('ng-prot').value),
        carbs: Number(document.getElementById('ng-carb').value),
        fat: Number(document.getElementById('ng-fat').value),
        water: Number(document.getElementById('ng-water').value),
      };
      Storage.set('nutrition', d);
      App.closeModal();
      this.render(document.getElementById('page-content'));
      App.toast('Goals updated', 'success');
    };
  },

  _esc(s) {
    if (!s) return '';
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }
});
