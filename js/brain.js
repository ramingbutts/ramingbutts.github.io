App.registerPage('brain', {
  searchQuery: '',

  render(container, sub) {
    if (sub) {
      this._renderCategory(container, sub);
    } else {
      this._renderCategories(container);
    }
  },

  _renderCategories(container) {
    const categories = Storage.get('brain_categories') || [];
    const allNotes = Storage.get('brain_notes') || [];
    const q = this.searchQuery.toLowerCase();
    const notes = q ? allNotes.filter(n =>
      (n.title || '').toLowerCase().includes(q) ||
      (n.content || '').toLowerCase().includes(q) ||
      (n.tags || []).some(t => t.toLowerCase().includes(q))
    ) : allNotes;

    const totalNotes = allNotes.length;
    const totalTags = [...new Set(allNotes.flatMap(n => n.tags || []))].length;

    container.innerHTML = `
      <div class="section">
        <div class="grid-3">
          <div class="card">
            <div class="card-title">Total Notes</div>
            <div class="card-value" style="margin-top:8px;color:var(--accent)">${totalNotes}</div>
          </div>
          <div class="card">
            <div class="card-title">Categories</div>
            <div class="card-value" style="margin-top:8px;color:var(--purple)">${categories.length}</div>
          </div>
          <div class="card">
            <div class="card-title">Unique Tags</div>
            <div class="card-value" style="margin-top:8px;color:var(--amber)">${totalTags}</div>
          </div>
        </div>
      </div>

      <div class="section">
        <div class="section-header">
          <div style="display:flex;align-items:center;gap:10px;flex:1">
            <span class="section-title">Knowledge Base</span>
            <input id="brain-search" type="text" placeholder="Search notes by title, content, or tag..." style="max-width:350px;padding:7px 12px;font-size:13px" value="${this._esc(this.searchQuery)}">
          </div>
          <div style="display:flex;gap:8px">
            <button class="btn btn-secondary btn-sm" id="import-obsidian">Import .md</button>
            <input type="file" id="obsidian-files" accept=".md,.markdown,.txt" multiple style="display:none">
            <button class="btn btn-primary btn-sm" id="add-category">+ Category</button>
          </div>
        </div>

        ${q ? `<div style="margin-bottom:12px;font-size:13px;color:var(--text-secondary)">${notes.length} result${notes.length !== 1 ? 's' : ''} for "${this._esc(q)}" <button class="btn btn-ghost btn-sm" id="clear-search">Clear</button></div>` : ''}

        ${!q ? `<div class="note-categories">
          ${categories.map(c => {
            const count = allNotes.filter(n => n.categoryId === c.id).length;
            return `
              <div class="note-category-card" data-cid="${App.escAttr(c.id)}">
                <div class="note-category-icon">${this._esc(c.icon)}</div>
                <div class="note-category-name">${this._esc(c.name)}</div>
                <div class="note-category-count">${count} note${count !== 1 ? 's' : ''}</div>
              </div>
            `;
          }).join('')}
          ${!categories.length ? '<div class="empty-state" style="grid-column:1/-1"><div class="empty-state-icon">🧠</div><div class="empty-state-text">Create your first category or import Obsidian notes</div></div>' : ''}
        </div>` : ''}
      </div>

      <div class="section">
        <div class="section-header">
          <span class="section-title">${q ? 'Search Results' : 'All Notes'}</span>
          <button class="btn btn-primary btn-sm" id="add-note-uncat">+ Note</button>
        </div>
        <div id="brain-notes-container"></div>
      </div>
    `;

    const notesToShow = q ? notes : allNotes.filter(n => !n.categoryId || !categories.find(c => c.id === n.categoryId));
    this._renderNotesInto(document.getElementById('brain-notes-container'), notesToShow);

    document.getElementById('add-category').addEventListener('click', () => this._editCategory());
    document.getElementById('add-note-uncat').addEventListener('click', () => this._editNote(null, null));
    document.getElementById('import-obsidian').addEventListener('click', () => document.getElementById('obsidian-files').click());
    document.getElementById('obsidian-files').addEventListener('change', (e) => this._importFiles(e.target.files));

    const searchInput = document.getElementById('brain-search');
    let debounce;
    searchInput.addEventListener('input', () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        this.searchQuery = searchInput.value.trim();
        this.render(document.getElementById('page-content'), '');
      }, 300);
    });
    searchInput.focus();
    searchInput.setSelectionRange(searchInput.value.length, searchInput.value.length);

    if (document.getElementById('clear-search')) {
      document.getElementById('clear-search').addEventListener('click', () => {
        this.searchQuery = '';
        this.render(document.getElementById('page-content'), '');
      });
    }

    container.querySelectorAll('.note-category-card').forEach(el => {
      el.addEventListener('click', () => { location.hash = '#/brain/' + el.dataset.cid; });
    });
  },

  _renderCategory(container, catId) {
    const categories = Storage.get('brain_categories') || [];
    const cat = categories.find(c => c.id === catId);
    const allNotes = (Storage.get('brain_notes') || []).filter(n => n.categoryId === catId);
    const q = this.searchQuery.toLowerCase();
    const notes = q ? allNotes.filter(n =>
      (n.title || '').toLowerCase().includes(q) ||
      (n.content || '').toLowerCase().includes(q) ||
      (n.tags || []).some(t => t.toLowerCase().includes(q))
    ) : allNotes;

    container.innerHTML = `
      <div class="section-header">
        <div style="display:flex;align-items:center;gap:12px">
          <button class="btn btn-ghost btn-sm" onclick="location.hash='#/brain'">&larr; Back</button>
          <span class="section-title">${cat ? this._esc(cat.icon) + ' ' + this._esc(cat.name) : 'Category'}</span>
          <span style="font-size:12px;color:var(--text-muted)">${allNotes.length} note${allNotes.length !== 1 ? 's' : ''}</span>
        </div>
        <div style="display:flex;gap:8px">
          ${cat ? `<button class="btn btn-secondary btn-sm" id="edit-cat">Edit Category</button>` : ''}
          <button class="btn btn-primary btn-sm" id="add-note-cat">+ Note</button>
        </div>
      </div>
      <div style="margin:12px 0">
        <input id="brain-search" type="text" placeholder="Search in ${this._esc(cat?.name || 'category')}..." style="max-width:350px;padding:7px 12px;font-size:13px" value="${this._esc(this.searchQuery)}">
      </div>
      ${q ? `<div style="margin-bottom:12px;font-size:13px;color:var(--text-secondary)">${notes.length} result${notes.length !== 1 ? 's' : ''}</div>` : ''}
      <div id="brain-notes-container"></div>
    `;

    this._renderNotesInto(document.getElementById('brain-notes-container'), notes);

    if (cat) document.getElementById('edit-cat').addEventListener('click', () => this._editCategory(cat.id));
    document.getElementById('add-note-cat').addEventListener('click', () => this._editNote(null, catId));

    const searchInput = document.getElementById('brain-search');
    let debounce;
    searchInput.addEventListener('input', () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        this.searchQuery = searchInput.value.trim();
        this._renderCategory(document.getElementById('page-content'), catId);
      }, 300);
    });
    // the debounced re-render rebuilds this input — restore focus and caret so
    // typing isn't interrupted mid-word (mirrors _renderCategories)
    searchInput.focus();
    searchInput.setSelectionRange(searchInput.value.length, searchInput.value.length);
  },

  _renderNotesInto(container, notes) {
    if (!notes.length) {
      container.innerHTML = '<div class="card"><div class="empty-state" style="padding:32px"><div class="empty-state-text">No notes found</div></div></div>';
      return;
    }
    container.innerHTML = `<div class="card">
      ${[...notes].sort((a, b) => (b.updatedAt || b.createdAt || '').localeCompare(a.updatedAt || a.createdAt || '')).map(n => `
        <div style="padding:14px 0;border-bottom:1px solid var(--border);cursor:pointer" class="brain-note-row" data-nid="${App.escAttr(n.id)}">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
            <span style="font-size:14px;font-weight:600">${this._esc(n.title)}</span>
            <span style="font-size:11px;color:var(--text-muted);font-family:'JetBrains Mono',monospace">${n.updatedAt ? new Date(n.updatedAt).toLocaleDateString() : ''}</span>
          </div>
          <div style="font-size:12px;color:var(--text-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${this._esc((n.content || '').slice(0, 150))}</div>
          <div style="margin-top:6px;display:flex;gap:4px;flex-wrap:wrap">
            ${(n.tags || []).map(t => `<span class="badge badge-accent">${this._esc(t)}</span>`).join('')}
            ${n.wikiLinks && n.wikiLinks.length ? n.wikiLinks.slice(0, 3).map(l => `<span class="badge badge-purple">${this._esc(l)}</span>`).join('') : ''}
          </div>
        </div>
      `).join('')}
    </div>`;

    container.querySelectorAll('.brain-note-row').forEach(el => {
      el.addEventListener('click', () => this._viewNote(el.dataset.nid));
    });
  },

  // ─── OBSIDIAN IMPORT ───
  _importFiles(fileList) {
    if (!fileList || !fileList.length) return;
    const files = Array.from(fileList);
    let imported = 0;
    let created = 0;
    const categories = Storage.get('brain_categories') || [];
    const notes = Storage.get('brain_notes') || [];

    const promises = files.map(file => new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const raw = ev.target.result;
        const parsed = this._parseObsidianMd(raw, file.name, file.webkitRelativePath);

        let catId = null;
        if (parsed.category) {
          let cat = categories.find(c => c.name.toLowerCase() === parsed.category.toLowerCase());
          if (!cat) {
            cat = { id: App.uid(), name: parsed.category, icon: '📁', color: 'accent' };
            categories.push(cat);
            created++;
          }
          catId = cat.id;
        }

        notes.push({
          id: App.uid(),
          categoryId: catId,
          title: parsed.title,
          content: parsed.content,
          tags: parsed.tags,
          wikiLinks: parsed.wikiLinks,
          source: 'obsidian',
          createdAt: parsed.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });
        imported++;
        resolve();
      };
      reader.readAsText(file);
    }));

    Promise.all(promises).then(() => {
      Storage.set('brain_categories', categories);
      Storage.set('brain_notes', notes);
      this.render(document.getElementById('page-content'), '');
      App.toast(`Imported ${imported} note${imported !== 1 ? 's' : ''}${created ? `, created ${created} categor${created !== 1 ? 'ies' : 'y'}` : ''}`, 'success');
    });
  },

  _parseObsidianMd(raw, fileName, filePath) {
    let content = raw;
    let title = fileName.replace(/\.(md|markdown|txt)$/i, '');
    let tags = [];
    let category = null;
    let createdAt = null;

    // Parse YAML frontmatter
    const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
    if (fmMatch) {
      const fm = fmMatch[1];
      content = content.slice(fmMatch[0].length);

      const titleMatch = fm.match(/^title:\s*["']?(.+?)["']?\s*$/m);
      if (titleMatch) title = titleMatch[1];

      const catMatch = fm.match(/^category:\s*["']?(.+?)["']?\s*$/m);
      if (catMatch) category = catMatch[1].trim();

      const dateMatch = fm.match(/^(?:date|created):\s*["']?(.+?)["']?\s*$/m);
      if (dateMatch) createdAt = new Date(dateMatch[1]).toISOString();

      const tagMatch = fm.match(/^tags:\s*\[([^\]]*)\]\s*$/m);
      if (tagMatch) {
        tags = tagMatch[1].split(',').map(t => t.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
      }
      const tagListMatch = fm.match(/^tags:\s*\n((?:\s*-\s*.+\n?)+)/m);
      if (tagListMatch) {
        tags = tagListMatch[1].split('\n').map(l => l.replace(/^\s*-\s*/, '').trim().replace(/^["']|["']$/g, '')).filter(Boolean);
      }
    }

    // Extract inline #tags from content
    const inlineTags = content.match(/(?:^|\s)#([a-zA-Z0-9_\-/]+)/g);
    if (inlineTags) {
      inlineTags.forEach(t => {
        const tag = t.trim().slice(1);
        if (!tags.includes(tag)) tags.push(tag);
      });
    }

    // Extract [[wiki-links]]
    const wikiLinks = [];
    const linkMatches = content.match(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g);
    if (linkMatches) {
      linkMatches.forEach(m => {
        const link = m.replace(/\[\[|\]\]/g, '').split('|')[0].trim();
        if (!wikiLinks.includes(link)) wikiLinks.push(link);
      });
    }

    // Clean up wiki-links in content to readable text
    content = content.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2');
    content = content.replace(/\[\[([^\]]+)\]\]/g, '$1');

    // Infer category from folder path
    if (!category && filePath) {
      const parts = filePath.split('/');
      if (parts.length > 1) {
        category = parts[parts.length - 2];
      }
    }

    return { title, content: content.trim(), tags, wikiLinks, category, createdAt };
  },

  // ─── VIEW / EDIT / DELETE ───
  _viewNote(id) {
    const notes = Storage.get('brain_notes') || [];
    const n = notes.find(n => n.id === id);
    if (!n) return;

    const rendered = this._renderMarkdown(n.content || '');

    // resolve [[wiki-links]] to actual notes by title (case-insensitive)
    const byTitle = {};
    notes.forEach(x => { byTitle[(x.title || '').toLowerCase().trim()] = x.id; });
    const linkHtml = (n.wikiLinks || []).map(l => {
      // strip Obsidian heading/block fragments ([[Note#Heading]], [[Note^block]])
      const targetId = byTitle[l.split(/[#^]/)[0].toLowerCase().trim()];
      return targetId
        ? `<span class="badge badge-purple brain-link" data-target="${App.escAttr(targetId)}" style="cursor:pointer">${this._esc(l)}</span>`
        : `<span class="badge" style="opacity:.55" title="No note named &quot;${App.escAttr(l)}&quot;">${this._esc(l)} &#9888;</span>`;
    }).join('');

    // openModal sets the title via textContent — pass it RAW or "&" renders as "&amp;"
    App.openModal(n.title, `
      <div style="font-size:11px;color:var(--text-muted);margin-bottom:12px;font-family:'JetBrains Mono',monospace">
        Created: ${n.createdAt ? new Date(n.createdAt).toLocaleString() : 'N/A'}
        &middot; Updated: ${n.updatedAt ? new Date(n.updatedAt).toLocaleString() : 'N/A'}
        ${n.source ? `&middot; Source: ${this._esc(n.source)}` : ''}
      </div>
      <div class="brain-note-content" style="font-size:14px;line-height:1.7">${rendered}</div>
      <div style="margin-top:12px;display:flex;gap:4px;flex-wrap:wrap">
        ${(n.tags || []).map(t => `<span class="badge badge-accent">${this._esc(t)}</span>`).join('')}
        ${linkHtml}
      </div>
      <div class="modal-actions">
        <button class="btn btn-danger" id="bn-delete">Delete</button>
        <button class="btn btn-secondary" onclick="App.closeModal()">Close</button>
        <a class="btn btn-secondary" href="#/graph" onclick="App.closeModal()">View in Graph</a>
        <button class="btn btn-primary" id="bn-edit">Edit</button>
      </div>
    `);
    document.querySelectorAll('.brain-link').forEach(el => {
      el.addEventListener('click', () => { App.closeModal(); this._viewNote(el.dataset.target); });
    });
    document.getElementById('bn-delete').addEventListener('click', () => { this._deleteNote(id); App.closeModal(); });
    document.getElementById('bn-edit').addEventListener('click', () => { App.closeModal(); this._editNote(id); });
  },

  _renderMarkdown(text) {
    let html = this._esc(text);
    // Headers
    html = html.replace(/^### (.+)$/gm, '<h4 style="font-size:14px;font-weight:700;margin:12px 0 6px;color:var(--text)">$1</h4>');
    html = html.replace(/^## (.+)$/gm, '<h3 style="font-size:15px;font-weight:700;margin:14px 0 6px;color:var(--text)">$1</h3>');
    html = html.replace(/^# (.+)$/gm, '<h2 style="font-size:17px;font-weight:700;margin:16px 0 8px;color:var(--text)">$1</h2>');
    // Bold and italic
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
    // Inline code
    html = html.replace(/`([^`]+)`/g, '<code style="background:var(--bg-input);padding:2px 5px;border-radius:3px;font-family:\'JetBrains Mono\',monospace;font-size:12px">$1</code>');
    // Unordered lists
    html = html.replace(/^- (.+)$/gm, '<div style="padding-left:16px;position:relative"><span style="position:absolute;left:4px;color:var(--accent)">•</span>$1</div>');
    // Checkboxes
    html = html.replace(/^- \[x\] (.+)$/gm, '<div style="padding-left:16px;color:var(--green)">✓ <s>$1</s></div>');
    html = html.replace(/^- \[ \] (.+)$/gm, '<div style="padding-left:16px;color:var(--text-secondary)">☐ $1</div>');
    // Blockquotes
    html = html.replace(/^&gt; (.+)$/gm, '<div style="border-left:3px solid var(--accent);padding-left:12px;color:var(--text-secondary);margin:8px 0">$1</div>');
    // Horizontal rules
    html = html.replace(/^---$/gm, '<hr style="border:none;border-top:1px solid var(--border);margin:12px 0">');
    // Line breaks
    html = html.replace(/\n/g, '<br>');
    return html;
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
      <div class="form-group"><label>Content (Markdown supported)</label><textarea id="fb-content" style="min-height:200px;font-family:'JetBrains Mono',monospace;font-size:13px"></textarea></div>
      <div class="form-group"><label>Tags (comma separated)</label><input id="fb-tags"></div>
      <div class="modal-actions">
        <button class="btn btn-secondary" onclick="App.closeModal()">Cancel</button>
        <button class="btn btn-primary" id="fb-save">Save</button>
      </div>
    `);

    document.getElementById('fb-content').value = n?.content || '';
    document.getElementById('fb-tags').value = (n?.tags || []).join(', ');

    document.getElementById('fb-save').addEventListener('click', () => {
      const title = document.getElementById('fb-title').value.trim();
      if (!title) { App.toast('Title required', 'error'); return; }
      const content = document.getElementById('fb-content').value;
      const inlineTags = [];
      const tagMatches = content.match(/(?:^|\s)#([a-zA-Z0-9_\-/]+)/g);
      if (tagMatches) tagMatches.forEach(t => { const tag = t.trim().slice(1); if (!inlineTags.includes(tag)) inlineTags.push(tag); });

      const manualTags = document.getElementById('fb-tags').value.split(',').map(s => s.trim()).filter(Boolean);
      const allTags = [...new Set([...manualTags, ...inlineTags])];

      const wikiLinks = [];
      const linkMatches = content.match(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g);
      if (linkMatches) linkMatches.forEach(m => {
        const link = m.replace(/\[\[|\]\]/g, '').split('|')[0].trim();
        if (!wikiLinks.includes(link)) wikiLinks.push(link);
      });

      const data = {
        id: n?.id || App.uid(),
        categoryId: document.getElementById('fb-cat').value || null,
        title,
        content,
        tags: allTags,
        wikiLinks,
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
    });
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
        <div class="form-group"><label>Icon (emoji/symbol)</label><input id="fc-icon" value="${cat?.icon || '📁'}" maxlength="8"></div>
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
        ${cat ? `<button class="btn btn-danger" id="fc-del">Delete</button>` : ''}
        <button class="btn btn-secondary" onclick="App.closeModal()">Cancel</button>
        <button class="btn btn-primary" id="fc-save">Save</button>
      </div>
    `);
    if (cat) document.getElementById('fc-del').addEventListener('click', () => { this._deleteCategory(id); App.closeModal(); });
    document.getElementById('fc-save').addEventListener('click', () => {
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
    });
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
    // also escape quotes: _esc output is interpolated into value="..." attributes,
    // where an unescaped quote truncates the field and silently corrupts data
    return d.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
});
