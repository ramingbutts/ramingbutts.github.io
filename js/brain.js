App.registerPage('brain', {
  render(container, sub) {
    if (sub) {
      this._renderCategory(container, sub);
    } else {
      this._renderCategories(container);
    }
  },

  _renderCategories(container) {
    const categories = Storage.get('brain_categories') || [];
    const notes = Storage.get('brain_notes') || [];

    container.innerHTML = `
      <div class="section">
        <div class="section-header">
          <span class="section-title">Knowledge Base</span>
          <button class="btn btn-primary btn-sm" id="add-category">+ Category</button>
        </div>
        <div class="note-categories">
          ${categories.map(c => {
            const count = notes.filter(n => n.categoryId === c.id).length;
            return `
              <div class="note-category-card" onclick="location.hash='#/brain/${c.id}'">
                <div class="note-category-icon">${c.icon}</div>
                <div class="note-category-name">${this._esc(c.name)}</div>
                <div class="note-category-count">${count} note${count !== 1 ? 's' : ''}</div>
              </div>
            `;
          }).join('')}
          ${!categories.length ? '<div class="empty-state" style="grid-column:1/-1"><div class="empty-state-icon">&#9672;</div><div class="empty-state-text">Create your first category to start building your second brain</div></div>' : ''}
        </div>
      </div>

      <div class="section">
        <div class="section-header">
          <span class="section-title">Uncategorized Notes</span>
          <button class="btn btn-primary btn-sm" id="add-note-uncat">+ Note</button>
        </div>
        ${this._renderNotesList(notes.filter(n => !n.categoryId || !categories.find(c => c.id === n.categoryId)))}
      </div>
    `;

    document.getElementById('add-category').onclick = () => this._editCategory();
    document.getElementById('add-note-uncat').onclick = () => this._editNote(null, null);
  },

  _renderCategory(container, catId) {
    const categories = Storage.get('brain_categories') || [];
    const cat = categories.find(c => c.id === catId);
    const notes = (Storage.get('brain_notes') || []).filter(n => n.categoryId === catId);

    container.innerHTML = `
      <div class="section-header">
        <div style="display:flex;align-items:center;gap:12px">
          <button class="btn btn-ghost btn-sm" onclick="location.hash='#/brain'">&larr; Back</button>
          <span class="section-title">${cat ? cat.icon + ' ' + this._esc(cat.name) : 'Category'}</span>
        </div>
        <div style="display:flex;gap:8px">
          ${cat ? `<button class="btn btn-secondary btn-sm" id="edit-cat">Edit Category</button>` : ''}
          <button class="btn btn-primary btn-sm" id="add-note-cat">+ Note</button>
        </div>
      </div>
      ${this._renderNotesList(notes)}
    `;

    if (cat) document.getElementById('edit-cat').onclick = () => this._editCategory(cat.id);
    document.getElementById('add-note-cat').onclick = () => this._editNote(null, catId);
  },

  _renderNotesList(notes) {
    if (!notes.length) {
      return '<div class="card"><div class="empty-state" style="padding:32px"><div class="empty-state-text">No notes yet</div></div></div>';
    }
    return `<div class="card">
      ${[...notes].sort((a, b) => (b.updatedAt || b.createdAt || '').localeCompare(a.updatedAt || a.createdAt || '')).map(n => `
        <div style="padding:14px 0;border-bottom:1px solid var(--border);cursor:pointer" onclick="App.pages.brain._viewNote('${n.id}')">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
            <span style="font-size:14px;font-weight:600">${this._esc(n.title)}</span>
            <span style="font-size:11px;color:var(--text-muted);font-family:'JetBrains Mono',monospace">${n.updatedAt ? new Date(n.updatedAt).toLocaleDateString() : ''}</span>
          </div>
          <div style="font-size:12px;color:var(--text-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${this._esc(n.content?.slice(0, 120) || '')}</div>
          <div style="margin-top:6px;display:flex;gap:4px">${(n.tags || []).map(t => `<span class="badge badge-accent">${this._esc(t)}</span>`).join('')}</div>
        </div>
      `).join('')}
    </div>`;
  },

  _viewNote(id) {
    const notes = Storage.get('brain_notes') || [];
    const n = notes.find(n => n.id === id);
    if (!n) return;

    App.openModal(this._esc(n.title), `
      <div style="font-size:11px;color:var(--text-muted);margin-bottom:12px;font-family:'JetBrains Mono',monospace">
        Created: ${n.createdAt ? new Date(n.createdAt).toLocaleString() : 'N/A'}
        &middot; Updated: ${n.updatedAt ? new Date(n.updatedAt).toLocaleString() : 'N/A'}
      </div>
      <div style="font-size:14px;line-height:1.7;white-space:pre-wrap">${this._esc(n.content)}</div>
      <div style="margin-top:12px;display:flex;gap:4px">${(n.tags || []).map(t => `<span class="badge badge-accent">${this._esc(t)}</span>`).join('')}</div>
      <div class="modal-actions">
        <button class="btn btn-danger" onclick="App.pages.brain._deleteNote('${id}');App.closeModal()">Delete</button>
        <button class="btn btn-secondary" onclick="App.closeModal()">Close</button>
        <button class="btn btn-primary" onclick="App.closeModal();App.pages.brain._editNote('${id}')">Edit</button>
      </div>
    `);
  },

  _editNote(id, categoryId) {
    const notes = Storage.get('brain_notes') || [];
    const categories = Storage.get('brain_categories') || [];
    const n = id ? notes.find(n => n.id === id) : null;

    App.openModal(n ? 'Edit Note' : 'New Note', `
      <div class="form-group"><label>Title</label><input id="fb-title" value="${this._esc(n?.title || '')}"></div>
      <div class="form-group">
        <label>Category</label>
        <select id="fb-cat">
          <option value="">Uncategorized</option>
          ${categories.map(c => `<option value="${c.id}" ${(n?.categoryId || categoryId) === c.id ? 'selected' : ''}>${this._esc(c.name)}</option>`).join('')}
        </select>
      </div>
      <div class="form-group"><label>Content</label><textarea id="fb-content" style="min-height:150px">${this._esc(n?.content || '')}</textarea></div>
      <div class="form-group"><label>Tags (comma separated)</label><input id="fb-tags" value="${(n?.tags || []).join(', ')}"></div>
      <div class="modal-actions">
        <button class="btn btn-secondary" onclick="App.closeModal()">Cancel</button>
        <button class="btn btn-primary" id="fb-save">Save</button>
      </div>
    `);

    document.getElementById('fb-save').onclick = () => {
      const title = document.getElementById('fb-title').value.trim();
      if (!title) { App.toast('Title required', 'error'); return; }
      const data = {
        id: n?.id || App.uid(),
        categoryId: document.getElementById('fb-cat').value || null,
        title,
        content: document.getElementById('fb-content').value,
        tags: document.getElementById('fb-tags').value.split(',').map(s => s.trim()).filter(Boolean),
        createdAt: n?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      const all = Storage.get('brain_notes') || [];
      if (n) { const i = all.findIndex(x => x.id === id); if (i >= 0) all[i] = data; }
      else all.push(data);
      Storage.set('brain_notes', all);
      App.closeModal();
      this.render(document.getElementById('page-content'), location.hash.split('/').slice(2).join('/'));
      App.toast(n ? 'Note updated' : 'Note created', 'success');
    };
  },

  _deleteNote(id) {
    const notes = (Storage.get('brain_notes') || []).filter(n => n.id !== id);
    Storage.set('brain_notes', notes);
    this.render(document.getElementById('page-content'), location.hash.split('/').slice(2).join('/'));
    App.toast('Note deleted', 'info');
  },

  _editCategory(id) {
    const categories = Storage.get('brain_categories') || [];
    const cat = id ? categories.find(c => c.id === id) : null;
    App.openModal(cat ? 'Edit Category' : 'New Category', `
      <div class="form-group"><label>Name</label><input id="fc-name" value="${this._esc(cat?.name || '')}"></div>
      <div class="form-row">
        <div class="form-group"><label>Icon (emoji/symbol)</label><input id="fc-icon" value="${cat?.icon || '&#9733;'}" maxlength="8"></div>
        <div class="form-group">
          <label>Color</label>
          <select id="fc-color">
            <option value="accent" ${cat?.color === 'accent' ? 'selected' : ''}>Cyan</option>
            <option value="purple" ${cat?.color === 'purple' ? 'selected' : ''}>Purple</option>
            <option value="green" ${cat?.color === 'green' ? 'selected' : ''}>Green</option>
            <option value="amber" ${cat?.color === 'amber' ? 'selected' : ''}>Amber</option>
            <option value="pink" ${cat?.color === 'pink' ? 'selected' : ''}>Pink</option>
          </select>
        </div>
      </div>
      <div class="modal-actions">
        ${cat ? `<button class="btn btn-danger" onclick="App.pages.brain._deleteCategory('${id}');App.closeModal()">Delete</button>` : ''}
        <button class="btn btn-secondary" onclick="App.closeModal()">Cancel</button>
        <button class="btn btn-primary" id="fc-save">Save</button>
      </div>
    `);
    document.getElementById('fc-save').onclick = () => {
      const name = document.getElementById('fc-name').value.trim();
      if (!name) { App.toast('Name required', 'error'); return; }
      const data = { id: cat?.id || App.uid(), name, icon: document.getElementById('fc-icon').value, color: document.getElementById('fc-color').value };
      const all = Storage.get('brain_categories') || [];
      if (cat) { const i = all.findIndex(c => c.id === id); if (i >= 0) all[i] = data; }
      else all.push(data);
      Storage.set('brain_categories', all);
      App.closeModal();
      this.render(document.getElementById('page-content'), '');
      App.toast(cat ? 'Category updated' : 'Category created', 'success');
    };
  },

  _deleteCategory(id) {
    const categories = (Storage.get('brain_categories') || []).filter(c => c.id !== id);
    Storage.set('brain_categories', categories);
    const notes = Storage.get('brain_notes') || [];
    notes.forEach(n => { if (n.categoryId === id) n.categoryId = null; });
    Storage.set('brain_notes', notes);
    this.render(document.getElementById('page-content'), '');
  },

  _esc(s) {
    if (!s) return '';
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }
});
