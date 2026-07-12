App.registerPage('tasks', {
  view: 'board',

  render(container) {
    const tasks = Storage.get('tasks') || [];
    container.innerHTML = `
      <div class="section-header">
        <div style="display:flex;gap:8px">
          <button class="btn ${this.view === 'board' ? 'btn-primary' : 'btn-secondary'} btn-sm" id="view-board">Board</button>
          <button class="btn ${this.view === 'list' ? 'btn-primary' : 'btn-secondary'} btn-sm" id="view-list">List</button>
        </div>
        <button class="btn btn-primary btn-sm" id="add-task">+ Add Task</button>
      </div>
      <div id="tasks-content"></div>
    `;

    document.getElementById('view-board').onclick = () => { this.view = 'board'; this.render(container); };
    document.getElementById('view-list').onclick = () => { this.view = 'list'; this.render(container); };
    document.getElementById('add-task').onclick = () => this._openForm();

    if (this.view === 'board') this._renderBoard(tasks);
    else this._renderList(tasks);
  },

  _renderBoard(tasks) {
    const columns = [
      { key: 'todo', label: 'To Do', color: 'var(--text-muted)' },
      { key: 'in-progress', label: 'In Progress', color: 'var(--accent)' },
      { key: 'done', label: 'Done', color: 'var(--green)' }
    ];

    const el = document.getElementById('tasks-content');
    el.innerHTML = `<div class="kanban">${columns.map(col => {
      const items = tasks.filter(t => t.status === col.key);
      return `
        <div class="kanban-column" data-status="${col.key}">
          <div class="kanban-column-header">
            <span class="kanban-column-title" style="color:${col.color}">${col.label}</span>
            <span class="kanban-count">${items.length}</span>
          </div>
          <div class="kanban-cards" data-status="${col.key}">
            ${items.map(t => `
              <div class="kanban-card" draggable="true" data-id="${t.id}">
                <div class="kanban-card-title">${this._esc(t.title)}</div>
                <div class="kanban-card-meta">
                  <span class="badge badge-${t.priority === 'high' ? 'red' : t.priority === 'medium' ? 'amber' : 'green'}">${t.priority}</span>
                  <span>${t.recurrence && t.recurrence !== 'none' ? '🔁 ' : ''}${t.dueDate ? App.formatDate(t.dueDate) : ''}</span>
                </div>
                ${t.blockers && t.blockers.length ? `<div style="margin-top:6px;font-size:10px;color:var(--red)">&#9888; ${t.blockers.length} blocker(s)</div>` : ''}
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }).join('')}</div>`;

    this._initDragDrop();
    el.querySelectorAll('.kanban-card').forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('[draggable]') && !e.defaultPrevented) {
          this._openForm(card.dataset.id);
        }
      });
    });
  },

  _renderList(tasks) {
    const el = document.getElementById('tasks-content');
    const sorted = [...tasks].sort((a, b) => {
      const p = { high: 0, medium: 1, low: 2 };
      return (p[a.priority] || 2) - (p[b.priority] || 2);
    });

    el.innerHTML = `
      <div class="card">
        <div class="table-wrap">
          <table>
            <thead><tr>
              <th>Task</th><th>Priority</th><th>Status</th><th>Category</th><th>Due</th><th>Actions</th>
            </tr></thead>
            <tbody>
              ${sorted.map(t => `
                <tr>
                  <td style="font-weight:500">${this._esc(t.title)}</td>
                  <td><span class="badge badge-${t.priority === 'high' ? 'red' : t.priority === 'medium' ? 'amber' : 'green'}">${t.priority}</span></td>
                  <td><span class="badge badge-${t.status === 'done' ? 'green' : t.status === 'in-progress' ? 'accent' : 'purple'}">${t.status}</span></td>
                  <td style="color:var(--text-secondary)">${this._esc(t.category || '-')}</td>
                  <td style="font-family:'JetBrains Mono',monospace;font-size:12px">${t.dueDate || '-'}</td>
                  <td>
                    <button class="btn btn-ghost btn-sm task-edit-btn" data-id="${App.escAttr(t.id)}">Edit</button>
                    <button class="btn btn-danger btn-sm task-del-btn" data-id="${App.escAttr(t.id)}">&#10005;</button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;

    el.querySelectorAll('.task-edit-btn').forEach(btn => {
      btn.addEventListener('click', () => this._openForm(btn.dataset.id));
    });
    el.querySelectorAll('.task-del-btn').forEach(btn => {
      btn.addEventListener('click', () => this._delete(btn.dataset.id));
    });
  },

  _initDragDrop() {
    const cards = document.querySelectorAll('.kanban-card');
    const zones = document.querySelectorAll('.kanban-cards');

    cards.forEach(card => {
      card.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', card.dataset.id);
        card.classList.add('dragging');
      });
      card.addEventListener('dragend', () => card.classList.remove('dragging'));
    });

    zones.forEach(zone => {
      zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('drag-over'); });
      zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
      zone.addEventListener('drop', (e) => {
        e.preventDefault();
        zone.classList.remove('drag-over');
        const id = e.dataTransfer.getData('text/plain');
        const newStatus = zone.dataset.status;
        const tasks = Storage.get('tasks') || [];
        const task = tasks.find(t => t.id === id);
        if (task) {
          const wasDone = task.status === 'done';
          task.status = newStatus;
          // completing a recurring task spawns its next occurrence
          const spawned = (newStatus === 'done' && !wasDone) ? this._maybeRecur(task, tasks) : false;
          Storage.set('tasks', tasks);
          this.render(document.getElementById('page-content'));
          App.toast(spawned ? `Done — next ${task.recurrence} occurrence scheduled` : `Task moved to ${newStatus}`, 'success');
        }
      });
    });
  },

  _openForm(id) {
    const tasks = Storage.get('tasks') || [];
    const task = id ? tasks.find(t => t.id === id) : null;
    const isEdit = !!task;

    App.openModal(isEdit ? 'Edit Task' : 'New Task', `
      <div class="form-group">
        <label>Title</label>
        <input id="f-title" value="${this._esc(task?.title || '')}" placeholder="Task title">
      </div>
      <div class="form-group">
        <label>Description</label>
        <textarea id="f-desc" placeholder="Details...">${this._esc(task?.description || '')}</textarea>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Priority</label>
          <select id="f-priority">
            <option value="high" ${task?.priority === 'high' ? 'selected' : ''}>High</option>
            <option value="medium" ${task?.priority === 'medium' ? 'selected' : ''}>Medium</option>
            <option value="low" ${!task || task?.priority === 'low' ? 'selected' : ''}>Low</option>
          </select>
        </div>
        <div class="form-group">
          <label>Status</label>
          <select id="f-status">
            <option value="todo" ${!task || task?.status === 'todo' ? 'selected' : ''}>To Do</option>
            <option value="in-progress" ${task?.status === 'in-progress' ? 'selected' : ''}>In Progress</option>
            <option value="done" ${task?.status === 'done' ? 'selected' : ''}>Done</option>
          </select>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Category</label>
          <input id="f-category" value="${this._esc(task?.category || '')}" placeholder="e.g. Work, Health">
        </div>
        <div class="form-group">
          <label>Due Date</label>
          <input id="f-due" type="date" value="${task?.dueDate || ''}">
        </div>
      </div>
      <div class="form-group">
        <label>Repeat</label>
        <select id="f-recurrence">
          ${[['none', 'Does not repeat'], ['daily', 'Every day'], ['weekly', 'Every week'], ['monthly', 'Every month']].map(([r, label]) => `<option value="${r}" ${(task?.recurrence || 'none') === r ? 'selected' : ''}>${label}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label>Blockers (one per line)</label>
        <textarea id="f-blockers" placeholder="What's blocking this task?"></textarea>
      </div>
      <div class="modal-actions">
        ${isEdit ? `<button class="btn btn-danger" id="f-delete">Delete</button>` : ''}
        <button class="btn btn-secondary" onclick="App.closeModal()">Cancel</button>
        <button class="btn btn-primary" id="f-save">Save</button>
      </div>
    `);

    document.getElementById('f-blockers').value = (task?.blockers || []).join('\n');
    if (isEdit) {
      document.getElementById('f-delete').addEventListener('click', () => { this._delete(id); App.closeModal(); });
    }

    document.getElementById('f-save').onclick = () => {
      const title = document.getElementById('f-title').value.trim();
      if (!title) { App.toast('Title required', 'error'); return; }

      const data = {
        id: task?.id || App.uid(),
        title,
        description: document.getElementById('f-desc').value.trim(),
        priority: document.getElementById('f-priority').value,
        status: document.getElementById('f-status').value,
        category: document.getElementById('f-category').value.trim(),
        dueDate: document.getElementById('f-due').value,
        recurrence: document.getElementById('f-recurrence').value,
        blockers: document.getElementById('f-blockers').value.split('\n').map(s => s.trim()).filter(Boolean),
        createdAt: task?.createdAt || new Date().toISOString()
      };

      const all = Storage.get('tasks') || [];
      let spawned = false;
      if (isEdit) {
        const idx = all.findIndex(t => t.id === id);
        // completing a recurring task via the form also spawns the next one
        if (idx >= 0 && data.status === 'done' && all[idx].status !== 'done') spawned = this._maybeRecur(data, all);
        if (idx >= 0) all[idx] = data;
      } else {
        if (data.status === 'done') spawned = this._maybeRecur(data, all);
        all.push(data);
      }
      Storage.set('tasks', all);
      App.closeModal();
      this.render(document.getElementById('page-content'));
      App.toast(spawned ? `Saved — next ${data.recurrence} occurrence scheduled` : (isEdit ? 'Task updated' : 'Task created'), 'success');
    };
  },

  // when a recurring task is completed, push a fresh 'todo' copy with its due
  // date rolled forward by the interval. Returns true if one was spawned.
  _maybeRecur(task, list) {
    if (!task.recurrence || task.recurrence === 'none') return false;
    list.push({
      id: App.uid(),
      title: task.title,
      description: task.description || '',
      priority: task.priority || 'medium',
      status: 'todo',
      category: task.category || '',
      dueDate: this._rollDate(task.dueDate, task.recurrence),
      recurrence: task.recurrence,
      blockers: [],
      createdAt: new Date().toISOString(),
    });
    return true;
  },

  _rollDate(dateStr, recurrence) {
    // anchor to the task's due date if it has one, else today
    const base = dateStr ? new Date(dateStr + 'T00:00:00') : new Date();
    if (recurrence === 'daily') base.setDate(base.getDate() + 1);
    else if (recurrence === 'weekly') base.setDate(base.getDate() + 7);
    else if (recurrence === 'monthly') base.setMonth(base.getMonth() + 1);
    // roll past today so the next occurrence is always in the future
    const today = new Date(App.getToday() + 'T00:00:00');
    let guard = 0;
    while (base <= today && guard++ < 400) {
      if (recurrence === 'daily') base.setDate(base.getDate() + 1);
      else if (recurrence === 'weekly') base.setDate(base.getDate() + 7);
      else base.setMonth(base.getMonth() + 1);
    }
    return `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, '0')}-${String(base.getDate()).padStart(2, '0')}`;
  },

  _delete(id) {
    const tasks = (Storage.get('tasks') || []).filter(t => t.id !== id);
    Storage.set('tasks', tasks);
    this.render(document.getElementById('page-content'));
    App.toast('Task deleted', 'info');
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
