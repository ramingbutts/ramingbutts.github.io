App.registerPage('calendar', {
  currentMonth: new Date().getMonth(),
  currentYear: new Date().getFullYear(),

  render(container) {
    const events = Storage.get('calendar_events') || [];
    const today = App.getToday();
    const month = this.currentMonth;
    const year = this.currentYear;

    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const daysInPrev = new Date(year, month, 0).getDate();
    const monthName = new Date(year, month).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

    const eventsByDate = {};
    events.forEach(e => {
      if (!eventsByDate[e.date]) eventsByDate[e.date] = [];
      eventsByDate[e.date].push(e);
    });

    const todayEvents = (eventsByDate[today] || []).sort((a, b) => (a.time || '').localeCompare(b.time || ''));

    const cells = [];
    const localDate = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    for (let i = firstDay - 1; i >= 0; i--) {
      const d = daysInPrev - i;
      const dt = new Date(year, month - 1, d);
      cells.push({ day: d, date: localDate(dt), other: true });
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const dt = new Date(year, month, d);
      cells.push({ day: d, date: localDate(dt), other: false });
    }
    const remaining = 42 - cells.length;
    for (let d = 1; d <= remaining; d++) {
      const dt = new Date(year, month + 1, d);
      cells.push({ day: d, date: localDate(dt), other: true });
    }

    container.innerHTML = `
      <div class="section">
        <div class="grid-2-1">
          <div>
            <div class="section-header">
              <div style="display:flex;align-items:center;gap:12px">
                <button class="btn btn-ghost btn-sm" id="cal-prev">&larr;</button>
                <span class="section-title" style="min-width:180px;text-align:center">${monthName}</span>
                <button class="btn btn-ghost btn-sm" id="cal-next">&rarr;</button>
              </div>
              <div style="display:flex;gap:8px">
                <button class="btn btn-secondary btn-sm" id="cal-today">Today</button>
                <button class="btn btn-primary btn-sm" id="add-event">+ Event</button>
              </div>
            </div>
            <div class="card" style="padding:12px">
              <div class="cal-grid">
                ${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => `<div class="cal-header">${d}</div>`).join('')}
                ${cells.map(c => {
                  const dayEvents = eventsByDate[c.date] || [];
                  return `
                    <div class="cal-day ${c.other ? 'other-month' : ''} ${c.date === today ? 'today' : ''}" onclick="App.pages.calendar._dayClick('${c.date}')">
                      <div class="cal-day-num">${c.day}</div>
                      ${dayEvents.slice(0, 2).map(e => `<div class="cal-event">${this._esc(e.title)}</div>`).join('')}
                      ${dayEvents.length > 2 ? `<div style="font-size:9px;color:var(--text-muted)">+${dayEvents.length - 2} more</div>` : ''}
                    </div>
                  `;
                }).join('')}
              </div>
            </div>
          </div>

          <div>
            <div class="section-header">
              <span class="section-title">Today's Agenda</span>
            </div>
            <div class="card">
              ${todayEvents.length ? todayEvents.map(e => `
                <div style="padding:12px 0;border-bottom:1px solid var(--border);cursor:pointer" onclick="App.pages.calendar._editEvent('${e.id}')">
                  <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px">
                    <span style="font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--accent)">${e.time || '---'}</span>
                    <span class="badge badge-${e.type === 'meeting' ? 'accent' : e.type === 'work' ? 'purple' : 'green'}">${e.type}</span>
                  </div>
                  <div style="font-size:14px;font-weight:500">${this._esc(e.title)}</div>
                  ${e.description ? `<div style="font-size:12px;color:var(--text-muted);margin-top:2px">${this._esc(e.description)}</div>` : ''}
                  <div style="font-size:11px;color:var(--text-muted);margin-top:4px">${e.duration || 30} minutes</div>
                </div>
              `).join('') : '<div style="padding:24px;text-align:center;color:var(--text-muted);font-size:13px">No events today</div>'}
            </div>

            <div class="section-header" style="margin-top:20px">
              <span class="section-title">Upcoming</span>
            </div>
            <div class="card">
              ${events.filter(e => e.date > today).sort((a, b) => a.date.localeCompare(b.date) || (a.time || '').localeCompare(b.time || '')).slice(0, 5).map(e => `
                <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);cursor:pointer" onclick="App.pages.calendar._editEvent('${e.id}')">
                  <div>
                    <div style="font-size:13px;font-weight:500">${this._esc(e.title)}</div>
                    <div style="font-size:11px;color:var(--text-muted)">${e.type} &middot; ${e.time || ''}</div>
                  </div>
                  <span style="font-size:12px;color:var(--accent);font-family:'JetBrains Mono',monospace">${App.formatDate(e.date)}</span>
                </div>
              `).join('') || '<div style="padding:16px;text-align:center;color:var(--text-muted);font-size:13px">No upcoming events</div>'}
            </div>
          </div>
        </div>
      </div>
    `;

    document.getElementById('cal-prev').onclick = () => { this.currentMonth--; if (this.currentMonth < 0) { this.currentMonth = 11; this.currentYear--; } this.render(container); };
    document.getElementById('cal-next').onclick = () => { this.currentMonth++; if (this.currentMonth > 11) { this.currentMonth = 0; this.currentYear++; } this.render(container); };
    document.getElementById('cal-today').onclick = () => { this.currentMonth = new Date().getMonth(); this.currentYear = new Date().getFullYear(); this.render(container); };
    document.getElementById('add-event').onclick = () => this._editEvent();
  },

  _dayClick(date) {
    const events = (Storage.get('calendar_events') || []).filter(e => e.date === date);
    if (events.length === 1) {
      this._editEvent(events[0].id);
    } else if (events.length > 1) {
      App.openModal(`Events on ${App.formatDate(date)}`, `
        ${events.map(e => `
          <div style="padding:10px 0;border-bottom:1px solid var(--border);cursor:pointer" onclick="App.pages.calendar._editEvent('${e.id}');App.closeModal()">
            <div style="font-size:13px;font-weight:500">${this._esc(e.title)}</div>
            <div style="font-size:11px;color:var(--text-muted)">${e.time || ''} &middot; ${e.type}</div>
          </div>
        `).join('')}
        <div class="modal-actions"><button class="btn btn-primary btn-sm" onclick="App.closeModal();App.pages.calendar._editEvent(null,'${date}')">+ Add Event</button></div>
      `);
    } else {
      this._editEvent(null, date);
    }
  },

  _editEvent(id, prefillDate) {
    const events = Storage.get('calendar_events') || [];
    const ev = id ? events.find(e => e.id === id) : null;
    App.openModal(ev ? 'Edit Event' : 'New Event', `
      <div class="form-group"><label>Title</label><input id="fe-title" value="${this._esc(ev?.title || '')}"></div>
      <div class="form-row">
        <div class="form-group"><label>Date</label><input id="fe-date" type="date" value="${ev?.date || prefillDate || App.getToday()}"></div>
        <div class="form-group"><label>Time</label><input id="fe-time" type="time" value="${ev?.time || '09:00'}"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Duration (min)</label><input id="fe-dur" type="number" value="${ev?.duration || 30}"></div>
        <div class="form-group">
          <label>Type</label>
          <select id="fe-type">
            <option value="meeting" ${ev?.type === 'meeting' ? 'selected' : ''}>Meeting</option>
            <option value="work" ${ev?.type === 'work' ? 'selected' : ''}>Work</option>
            <option value="personal" ${ev?.type === 'personal' ? 'selected' : ''}>Personal</option>
          </select>
        </div>
      </div>
      <div class="form-group"><label>Description</label><textarea id="fe-desc">${this._esc(ev?.description || '')}</textarea></div>
      <div class="modal-actions">
        ${ev ? `<button class="btn btn-danger" onclick="App.pages.calendar._deleteEvent('${id}');App.closeModal()">Delete</button>` : ''}
        <button class="btn btn-secondary" onclick="App.closeModal()">Cancel</button>
        <button class="btn btn-primary" id="fe-save">Save</button>
      </div>
    `);

    document.getElementById('fe-save').onclick = () => {
      const title = document.getElementById('fe-title').value.trim();
      if (!title) { App.toast('Title required', 'error'); return; }
      const data = {
        id: ev?.id || App.uid(),
        title,
        date: document.getElementById('fe-date').value,
        time: document.getElementById('fe-time').value,
        duration: Number(document.getElementById('fe-dur').value),
        type: document.getElementById('fe-type').value,
        description: document.getElementById('fe-desc').value.trim()
      };
      const all = Storage.get('calendar_events') || [];
      if (ev) { const i = all.findIndex(e => e.id === id); if (i >= 0) all[i] = data; }
      else all.push(data);
      Storage.set('calendar_events', all);
      App.closeModal();
      this.render(document.getElementById('page-content'));
      App.toast(ev ? 'Event updated' : 'Event added', 'success');
    };
  },

  _deleteEvent(id) {
    const events = (Storage.get('calendar_events') || []).filter(e => e.id !== id);
    Storage.set('calendar_events', events);
    this.render(document.getElementById('page-content'));
    App.toast('Event deleted', 'info');
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
