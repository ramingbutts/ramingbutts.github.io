// Weekly Pulse — the cross-module review the app was missing.
//
// Every other page reads one Storage key. This one reads them all and reports
// the *relationships* between them: how habit consistency tracks mood, where
// the money went, what's carrying over. It computes from real data with
// graceful fallbacks when a module is empty — no seeded numbers.
//
// Charts are hand-built SVG following the dataviz discipline (single axis,
// direct value labels, recessive gridlines) with a colourblind-safe dark
// palette validated against the app's dark surface.
App.registerPage('pulse', {
  // validated categorical palette (passes the dataviz validator on dark)
  C: { cyan: '#0a9ec2', purple: '#8b5cf6', green: '#0d9668', amber: '#c77f0a', pink: '#e0408f' },
  HEAT: ['#123039', '#155a6d', '#0a83a3', '#28c3e6'],

  render(container) {
    const days = this._lastNDates(7);
    const prevDays = this._lastNDates(14).slice(0, 7);

    const habits = Storage.get('habits') || [];
    const journal = Storage.get('journal') || [];
    const tasks = Storage.get('tasks') || [];
    const finance = Storage.get('finance') || {};
    const txns = finance.transactions || [];

    const habitPct = days.map(d => this._habitPctOn(habits, d));
    const prevHabitPct = prevDays.map(d => this._habitPctOn(habits, d));
    const consistency = this._avg(habitPct);
    const prevConsistency = this._avg(prevHabitPct);
    const consistencyDelta = Math.round(consistency - prevConsistency);

    const moodByDay = days.map(d => this._moodOn(journal, d));       // 0..5 or null
    const journalCount = journal.filter(j => days.includes(j.date || (j.createdAt || '').slice(0, 10))).length;
    const moodSamples = moodByDay.filter(m => m != null);
    const avgMood = moodSamples.length ? this._avg(moodSamples) : null; // null (not 0) when the week has no mood data

    const weekTxns = txns.filter(t => days.includes(t.date));
    const saved = weekTxns.reduce((s, t) => s + t.amount, 0);
    const income = weekTxns.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
    const spendByCat = this._spendByCategory(weekTxns);

    const doneTasks = tasks.filter(t => t.status === 'done').length;
    const blocked = tasks.filter(t => t.status !== 'done' && t.blockers && t.blockers.length);

    const insights = this._insights({ habitPct, moodByDay, days, spendByCat, income, blocked, habits });

    container.innerHTML = `
      <div class="section">
        <div style="display:flex;align-items:baseline;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:6px">
          <div>
            <div style="font-size:22px;font-weight:800;letter-spacing:-.4px">Weekly Pulse</div>
            <div style="font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--text-muted)">
              ${App.formatDate(days[0])} – ${App.formatDate(days[6])} · your week across every module</div>
          </div>
        </div>
      </div>

      <div class="section">
        <div class="grid-4">
          <div class="card glow">
            <div class="card-title">Habit consistency</div>
            <div class="card-value" style="margin-top:6px;color:var(--green)">${Math.round(consistency)}%</div>
            <div class="card-subtitle" style="color:${consistencyDelta >= 0 ? 'var(--green)' : 'var(--red)'}">
              ${prevHabitPct.some(p => p > 0) ? (consistencyDelta >= 0 ? '▲ ' : '▼ ') + Math.abs(consistencyDelta) + ' pts vs last week' : 'first tracked week'}</div>
          </div>
          <div class="card">
            <div class="card-title">Net this week</div>
            <div class="card-value" style="margin-top:6px;color:${saved >= 0 ? 'var(--accent)' : 'var(--red)'}">${App.formatCurrency(saved)}</div>
            <div class="card-subtitle">${weekTxns.length} transaction${weekTxns.length !== 1 ? 's' : ''}${income ? ' · ' + Math.round(Math.max(saved, 0) / income * 100) + '% of income' : ''}</div>
          </div>
          <div class="card">
            <div class="card-title">Tasks</div>
            <div class="card-value" style="margin-top:6px">${doneTasks} done</div>
            <div class="card-subtitle" style="color:${blocked.length ? 'var(--red)' : 'var(--text-muted)'}">${blocked.length} blocked</div>
          </div>
          <div class="card">
            <div class="card-title">Avg mood</div>
            <div class="card-value" style="margin-top:6px">${avgMood != null ? this._moodFace(avgMood) + ' ' + avgMood.toFixed(1) + '<span style="font-size:14px;color:var(--text-muted)">/5</span>' : '—'}</div>
            <div class="card-subtitle">${journalCount ? 'from ' + journalCount + ' entr' + (journalCount === 1 ? 'y' : 'ies') : 'no journal entries'}</div>
          </div>
        </div>
      </div>

      <div class="section">
        <div class="section-title" style="margin-bottom:10px">What stood out</div>
        <div class="card" style="padding:4px 0">
          ${insights.length ? insights.map((ins, i) => `
            <div style="display:flex;gap:12px;padding:14px 16px;align-items:flex-start;${i < insights.length - 1 ? 'border-bottom:1px solid var(--border)' : ''}">
              <span style="width:8px;height:8px;border-radius:50%;margin-top:6px;flex-shrink:0;background:${ins.color}"></span>
              <div style="font-size:13.5px;line-height:1.55"><b style="color:var(--text)">${this._esc(ins.head)}</b>
                <span style="color:var(--text-secondary)"> ${this._esc(ins.body)}</span></div>
            </div>`).join('')
          : '<div style="padding:22px;text-align:center;color:var(--text-muted);font-size:13px">Log habits, a journal entry, and a few transactions this week, and insights will appear here.</div>'}
        </div>
      </div>

      <div class="section">
        <div class="grid-2">
          <div class="card">
            <div style="font-size:13px;font-weight:600;color:var(--text-secondary)">Habits vs. mood</div>
            <div style="font-size:11px;color:var(--text-muted);margin-bottom:14px">Do the days you keep your habits feel better? Mood is scaled to the same 0–100%.</div>
            ${this._lineChart(days, habitPct, moodByDay)}
            <div style="display:flex;gap:14px;flex-wrap:wrap;font-size:11px;color:var(--text-secondary);margin-top:10px">
              <span style="display:inline-flex;align-items:center;gap:5px"><i style="width:9px;height:9px;border-radius:2px;background:${this.C.cyan}"></i>Habits met %</span>
              <span style="display:inline-flex;align-items:center;gap:5px"><i style="width:9px;height:9px;border-radius:2px;background:${this.C.purple}"></i>Mood (0–100%)</span>
            </div>
          </div>
          <div class="card">
            <div style="font-size:13px;font-weight:600;color:var(--text-secondary)">Where the money went</div>
            <div style="font-size:11px;color:var(--text-muted);margin-bottom:14px">Spending by category this week, biggest first.</div>
            ${spendByCat.length ? this._barChart(spendByCat) : '<div style="padding:30px;text-align:center;color:var(--text-muted);font-size:13px">No spending recorded this week.</div>'}
          </div>
        </div>
      </div>

      <div class="section">
        <div class="grid-2-1">
          <div class="card">
            <div style="font-size:13px;font-weight:600;color:var(--text-secondary)">Habit heatmap</div>
            <div style="font-size:11px;color:var(--text-muted);margin-bottom:14px">Each row a habit, each column a day. The gaps are the story.</div>
            ${habits.length ? this._heatmap(habits, days) : '<div style="padding:24px;text-align:center;color:var(--text-muted);font-size:13px">No habits yet — add some on the Habit Tracker.</div>'}
          </div>
          <div class="card">
            <div style="font-size:13px;font-weight:600;color:var(--text-secondary)">Carried into next week</div>
            <div style="font-size:11px;color:var(--text-muted);margin-bottom:8px">Open blockers &amp; overdue items.</div>
            ${this._carryList(blocked, tasks)}
          </div>
        </div>
      </div>
    `;
  },

  // ─────────── computation ───────────
  _lastNDates(n) {
    const out = [];
    const today = new Date();
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(today); d.setDate(d.getDate() - i);
      out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
    }
    return out;
  },

  _habitPctOn(habits, date) {
    if (!habits.length) return 0;
    const done = habits.filter(h => h.completed && h.completed[date]).length;
    return Math.round(done / habits.length * 100);
  },

  _moodOn(journal, date) {
    const scale = { '😫': 1, '😕': 2, '😐': 3, '🤔': 3, '😊': 4, '💪': 4, '😁': 5, '🚀': 5, '🌟': 5, '💓': 4 };
    const entries = journal.filter(j => (j.date || (j.createdAt || '').slice(0, 10)) === date && j.mood);
    if (!entries.length) return null;
    const vals = entries.map(e => scale[e.mood]).filter(v => v != null);
    return vals.length ? this._avg(vals) : null;
  },

  _moodFace(v) { return v >= 4.3 ? '😁' : v >= 3.5 ? '🙂' : v >= 2.5 ? '😐' : '😕'; },

  _spendByCategory(txns) {
    const map = {};
    txns.filter(t => t.amount < 0).forEach(t => {
      const cat = (App.pages.finance && App.pages.finance._mapCategory) ? App.pages.finance._mapCategory(t.category) : (t.category || 'Other');
      map[cat] = (map[cat] || 0) + Math.abs(t.amount);
    });
    return Object.entries(map).map(([cat, total]) => ({ cat, total })).sort((a, b) => b.total - a.total);
  },

  _insights({ habitPct, moodByDay, days, spendByCat, income, blocked }) {
    const out = [];
    // habit ↔ mood correlation, only when we have overlapping days
    const paired = days.map((d, i) => ({ h: habitPct[i], m: moodByDay[i] })).filter(x => x.m != null);
    if (paired.length >= 3) {
      const good = paired.filter(x => x.h >= 80), bad = paired.filter(x => x.h < 80);
      if (good.length && bad.length) {
        const gm = this._avg(good.map(x => x.m)), bm = this._avg(bad.map(x => x.m));
        if (gm - bm >= 0.4) {
          out.push({ color: this.C.green, head: 'Your best mood days were your best habit days.',
            body: `On the ${good.length} day${good.length !== 1 ? 's' : ''} you hit ≥80% of habits, mood averaged ${gm.toFixed(1)}/5 — versus ${bm.toFixed(1)} otherwise.` });
        }
      }
    }
    // top spend category vs income
    if (spendByCat.length && income > 0) {
      const top = spendByCat[0];
      const pct = Math.round(top.total / income * 100);
      if (pct >= 15) out.push({ color: this.C.amber, head: `${top.cat} is your biggest spend this week.`,
        body: `${App.formatCurrency(top.total)} — ${pct}% of the income you logged.` });
    }
    // long-standing blockers
    if (blocked.length) {
      const names = blocked.slice(0, 2).map(t => '“' + t.title + '”').join(' and ');
      out.push({ color: this.C.pink, head: `${blocked.length} task${blocked.length !== 1 ? 's are' : ' is'} blocked.`,
        body: `${names}${blocked.length > 2 ? ' and more' : ''} — worth an unblock or a re-scope.` });
    }
    // consistency streak nudge
    const perfect = habitPct.filter(p => p === 100).length;
    if (perfect >= 3) out.push({ color: this.C.cyan, head: `${perfect} perfect habit days this week.`, body: 'Momentum is on your side — protect the streak.' });
    return out;
  },

  _avg(arr) { return arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : 0; },

  // ─────────── charts (SVG) ───────────
  _lineChart(days, habitPct, moodByDay) {
    const W = 480, H = 210, P = { l: 30, r: 12, t: 12, b: 26 };
    const x = i => P.l + i * (W - P.l - P.r) / (days.length - 1);
    const y = v => P.t + (100 - v) * (H - P.t - P.b) / 100;
    const grid = [0, 50, 100].map(g => `<line x1="${P.l}" x2="${W - P.r}" y1="${y(g)}" y2="${y(g)}" stroke="var(--border)"/><text x="${P.l - 5}" y="${y(g) + 3}" text-anchor="end" fill="var(--text-muted)" font-size="10" font-family="monospace">${g}</text>`).join('');
    const dow = days.map((d, i) => `<text x="${x(i)}" y="${H - 8}" text-anchor="middle" fill="var(--text-muted)" font-size="10" font-family="monospace">${['S', 'M', 'T', 'W', 'T', 'F', 'S'][new Date(d + 'T00:00:00').getDay()]}</text>`).join('');
    const line = (vals, scale, color) => {
      const pts = vals.map((v, i) => v == null ? null : [x(i), y(v * scale)]).filter(Boolean);
      if (pts.length < 1) return '';
      const path = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
      const dots = pts.map(p => `<circle cx="${p[0]}" cy="${p[1]}" r="3" fill="${color}" stroke="var(--bg-card)" stroke-width="2"/>`).join('');
      return `<path d="${path}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>${dots}`;
    };
    return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;display:block" role="img" aria-label="Habits and mood over the week">
      ${grid}${dow}${line(habitPct, 1, this.C.cyan)}${line(moodByDay, 20, this.C.purple)}</svg>`;
  },

  _barChart(data) {
    const W = 480, H = 200, P = { l: 78, r: 46, t: 6, b: 6 };
    const max = Math.max(...data.map(d => d.total));
    const rowH = (H - P.t - P.b) / data.length;
    const colors = [this.C.pink, this.C.amber, this.C.purple, this.C.green, this.C.cyan];
    const rows = data.slice(0, 6).map((d, i) => {
      const cy = P.t + i * rowH + rowH / 2;
      const bw = Math.max((d.total / max) * (W - P.l - P.r), 2);
      const col = colors[i % colors.length];
      return `<text x="${P.l - 8}" y="${cy + 3}" text-anchor="end" fill="var(--text-secondary)" font-size="10" font-family="monospace">${this._esc(d.cat)}</text>
        <rect x="${P.l}" y="${cy - 7}" width="${bw}" height="14" rx="4" fill="${col}"/>
        <text x="${P.l + bw + 6}" y="${cy + 3}" fill="var(--text-secondary)" font-size="10" font-weight="600" font-family="monospace">${App.formatCurrency(d.total)}</text>`;
    }).join('');
    return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;display:block" role="img" aria-label="Spending by category">${rows}</svg>`;
  },

  _heatmap(habits, days) {
    const list = habits.slice(0, 6);
    const W = 480, H = Math.max(90, 26 + list.length * 26), P = { l: 84, t: 20, r: 8, b: 6 };
    const cw = (W - P.l - P.r) / 7, ch = (H - P.t - P.b) / list.length;
    const head = days.map((d, i) => `<text x="${P.l + i * cw + cw / 2}" y="14" text-anchor="middle" fill="var(--text-muted)" font-size="10" font-family="monospace">${['S', 'M', 'T', 'W', 'T', 'F', 'S'][new Date(d + 'T00:00:00').getDay()]}</text>`).join('');
    const rows = list.map((h, r) => {
      const label = `<text x="${P.l - 8}" y="${P.t + r * ch + ch / 2 + 3}" text-anchor="end" fill="var(--text-secondary)" font-size="10" font-family="monospace">${this._esc((h.name || '').slice(0, 12))}</text>`;
      const cells = days.map((d, c) => {
        const on = h.completed && h.completed[d];
        return `<rect x="${P.l + c * cw + 2}" y="${P.t + r * ch + 2}" width="${cw - 4}" height="${ch - 4}" rx="2" fill="${on ? this.HEAT[3] : 'var(--bg-input)'}"/>`;
      }).join('');
      return label + cells;
    }).join('');
    return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;display:block" role="img" aria-label="Habit completion heatmap">${head}${rows}</svg>`;
  },

  _carryList(blocked, tasks) {
    const overdue = tasks.filter(t => t.status !== 'done' && t.dueDate && t.dueDate < App.getToday() && !(t.blockers && t.blockers.length));
    const items = [
      ...blocked.map(t => ({ ico: '⛔', txt: t.title, tag: t.blockers.length + ' blocker' + (t.blockers.length !== 1 ? 's' : ''), col: 'var(--red)' })),
      ...overdue.slice(0, 4).map(t => ({ ico: '☐', txt: t.title, tag: 'overdue', col: 'var(--amber)' })),
    ];
    if (!items.length) return '<div style="padding:18px;text-align:center;color:var(--text-muted);font-size:13px">Nothing blocked or overdue — clean slate.</div>';
    return items.map(it => `
      <div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border)">
        <span>${it.ico}</span><span style="font-size:13px;flex:1">${this._esc(it.txt)}</span>
        <span class="badge" style="color:${it.col};border:1px solid ${it.col};background:transparent;text-transform:none">${it.tag}</span>
      </div>`).join('');
  },

  _esc(s) {
    if (s == null) return '';
    const d = document.createElement('div');
    d.textContent = String(s);
    return d.innerHTML;
  },
});
