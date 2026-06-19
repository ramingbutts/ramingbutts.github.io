// Insights — the life-system observability engine.
//
// Where Diag observes the *app's* health (errors, sync, storage), Insights
// observes *your data* and explains its state back to you: what needs attention,
// how the week went, and which modules have gone stale. Pure compute — reads
// through Storage.get, writes nothing. UI lives in insights-view.js; the compact
// strip lives in dashboard.js; staleness badges are rendered by app.js.
const Insights = {
  // ---- date helpers (local-time, consistent with App.getToday) ----
  _today() { return (typeof App !== 'undefined' && App.getToday) ? App.getToday() : new Date().toISOString().slice(0, 10); },

  _daysSince(dateStr) {
    if (!dateStr) return Infinity;
    const d = new Date(String(dateStr).slice(0, 10) + 'T00:00:00');
    if (isNaN(d)) return Infinity;
    const today = new Date(this._today() + 'T00:00:00');
    return Math.round((today - d) / 86400000);
  },

  _within(dateStr, days) {
    const n = this._daysSince(dateStr);
    return n >= 0 && n < days;
  },

  // ---- 1. Attention digest: what needs you, and why ----
  attention() {
    const out = [];
    const today = this._today();
    const tasks = Storage.get('tasks') || [];
    const habits = Storage.get('habits') || [];
    const finance = Storage.get('finance') || {};
    const nutrition = Storage.get('nutrition') || {};
    const journal = Storage.get('journal') || [];
    const events = Storage.get('calendar_events') || [];

    // Overdue tasks
    const overdue = tasks.filter(t => t.status !== 'done' && t.dueDate && t.dueDate < today);
    if (overdue.length) {
      out.push({ level: 'urgent', icon: '⏰', page: 'tasks',
        text: `${overdue.length} task${overdue.length > 1 ? 's' : ''} overdue`,
        reason: overdue.slice(0, 3).map(t => t.title).join(', ') });
    }

    // Due today
    const dueToday = tasks.filter(t => t.status !== 'done' && t.dueDate === today);
    if (dueToday.length) {
      out.push({ level: 'warn', icon: '📅', page: 'tasks',
        text: `${dueToday.length} task${dueToday.length > 1 ? 's' : ''} due today`,
        reason: dueToday.slice(0, 3).map(t => t.title).join(', ') });
    }

    // High-priority tasks that are blocked
    const blocked = tasks.filter(t => t.status !== 'done' && t.priority === 'high' && (t.blockers || []).length);
    if (blocked.length) {
      out.push({ level: 'warn', icon: '🚧', page: 'tasks',
        text: `${blocked.length} high-priority task${blocked.length > 1 ? 's' : ''} blocked`,
        reason: blocked.map(t => `${t.title} (${(t.blockers || []).join('; ')})`).slice(0, 2).join(' · ') });
    }

    // Habit streaks about to break (have a streak, not yet checked today)
    const atRisk = habits.filter(h => (h.streak || 0) > 0 && !(h.completed && h.completed[today]));
    if (atRisk.length) {
      const top = atRisk.slice().sort((a, b) => (b.streak || 0) - (a.streak || 0));
      const maxStreak = top[0].streak || 0;
      out.push({ level: maxStreak >= 7 ? 'urgent' : 'warn', icon: '🔥', page: 'habits',
        text: `${atRisk.length} streak${atRisk.length > 1 ? 's' : ''} break${atRisk.length > 1 ? '' : 's'} tonight`,
        reason: top.map(h => `${h.name} (${h.streak}d)`).slice(0, 3).join(', ') });
    }

    // Nutrition not logged today
    const loggedToday = (nutrition.entries || []).some(e => e.date === today);
    if (!loggedToday) {
      out.push({ level: 'info', icon: '🍽️', page: 'nutrition',
        text: 'No nutrition logged today', reason: 'Macros for today are empty' });
    }

    // Journaling gap
    const lastJournal = (journal || []).map(e => e.date || (e.createdAt || '').slice(0, 10)).sort().pop();
    const jGap = this._daysSince(lastJournal);
    if (jGap >= 3) {
      out.push({ level: jGap >= 7 ? 'warn' : 'info', icon: '✍️', page: 'journal',
        text: `No journal entry in ${jGap === Infinity ? 'a while' : jGap + ' days'}`,
        reason: lastJournal ? `Last entry ${App.formatDate ? App.formatDate(lastJournal) : lastJournal}` : 'No entries yet' });
    }

    // Finance staleness (last transaction date)
    const txDates = (finance.transactions || []).map(t => t.date).filter(Boolean).sort();
    const lastTx = txDates[txDates.length - 1];
    const fGap = this._daysSince(lastTx);
    if (fGap >= 7) {
      out.push({ level: 'warn', icon: '💰', page: 'finance',
        text: `No finance activity in ${fGap === Infinity ? 'a while' : fGap + ' days'}`,
        reason: 'Net worth and balances may be out of date' });
    }
    // Monthly snapshot missing for current month
    const month = today.slice(0, 7);
    const snaps = Storage.get('finance_snapshots') || [];
    if (snaps.length && !snaps.some(s => s.month === month)) {
      out.push({ level: 'info', icon: '📈', page: 'finance',
        text: `No snapshot for ${new Date(today + 'T00:00:00').toLocaleDateString('en-US', { month: 'long' })}`,
        reason: 'Log a monthly snapshot to keep trends accurate' });
    }

    // Today's events (informational, helpful)
    const todayEvents = events.filter(e => e.date === today).sort((a, b) => (a.time || '').localeCompare(b.time || ''));
    if (todayEvents.length) {
      out.push({ level: 'info', icon: '📆', page: 'calendar',
        text: `${todayEvents.length} event${todayEvents.length > 1 ? 's' : ''} today`,
        reason: todayEvents.map(e => `${e.time || ''} ${e.title}`.trim()).slice(0, 3).join(', ') });
    }

    const rank = { urgent: 0, warn: 1, info: 2 };
    return out.sort((a, b) => rank[a.level] - rank[b.level]);
  },

  // ---- 2. Weekly review: how the last 7 days went ----
  weeklyReview() {
    const tasks = Storage.get('tasks') || [];
    const habits = Storage.get('habits') || [];
    const finance = Storage.get('finance') || {};
    const nutrition = Storage.get('nutrition') || {};
    const journal = Storage.get('journal') || [];
    const activity = Storage.get('activity') || [];
    const today = this._today();

    // last 7 calendar days (today inclusive)
    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(today + 'T00:00:00');
      d.setDate(d.getDate() - i);
      days.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
    }
    const inWeek = ds => days.includes(String(ds || '').slice(0, 10));

    // Habits: completion rate across the week + streaks
    let possible = 0, done = 0;
    habits.forEach(h => { days.forEach(d => { possible++; if (h.completed && h.completed[d]) done++; }); });
    const habitRate = possible ? Math.round((done / possible) * 100) : 0;
    const streaks = habits.filter(h => (h.streak || 0) > 0)
      .sort((a, b) => (b.streak || 0) - (a.streak || 0))
      .map(h => ({ name: h.name, streak: h.streak }));

    // Finance: income vs spending in the week
    let income = 0, spending = 0, txCount = 0;
    (finance.transactions || []).forEach(t => {
      if (!inWeek(t.date)) return;
      txCount++;
      if (t.amount > 0) income += t.amount; else spending += -t.amount;
    });

    // Nutrition: days logged this week
    const nutDays = new Set((nutrition.entries || []).filter(e => inWeek(e.date)).map(e => e.date)).size;

    // Journal: entries + mood mix this week
    const jWeek = journal.filter(e => inWeek(e.date || (e.createdAt || '').slice(0, 10)));
    const moods = jWeek.map(e => e.mood).filter(Boolean);

    // Activity volume (changes recorded in the week)
    const actions = activity.filter(a => inWeek(a.t)).length;
    const completedTasks = activity.filter(a => inWeek(a.t) && /^Completed task/.test(a.text || '')).length;

    return {
      rangeLabel: `${App.formatDate ? App.formatDate(days[6]) : days[6]} – ${App.formatDate ? App.formatDate(days[0]) : days[0]}`,
      tasks: {
        open: tasks.filter(t => t.status !== 'done').length,
        done: tasks.filter(t => t.status === 'done').length,
        overdue: tasks.filter(t => t.status !== 'done' && t.dueDate && t.dueDate < today).length,
        completedThisWeek: completedTasks
      },
      habits: { rate: habitRate, streaks },
      finance: { income, spending, net: income - spending, txCount },
      nutrition: { daysLogged: nutDays },
      journal: { count: jWeek.length, moods },
      actions
    };
  },

  // ---- 3. Staleness: which modules have gone quiet ----
  staleness() {
    const r = {};
    const set = (page, lastDate, threshold) => {
      const days = this._daysSince(lastDate);
      r[page] = { days, stale: days >= threshold, label: lastDate ? `${days}d ago` : 'never' };
    };

    const nutrition = Storage.get('nutrition') || {};
    const nutDates = (nutrition.entries || []).map(e => e.date).filter(Boolean).sort();
    set('nutrition', nutDates[nutDates.length - 1], 2);

    const journal = Storage.get('journal') || [];
    const jDates = journal.map(e => e.date || (e.createdAt || '').slice(0, 10)).filter(Boolean).sort();
    set('journal', jDates[jDates.length - 1], 3);

    const finance = Storage.get('finance') || {};
    const txDates = (finance.transactions || []).map(t => t.date).filter(Boolean).sort();
    set('finance', txDates[txDates.length - 1], 10);

    const habits = Storage.get('habits') || [];
    let lastHabit = '';
    habits.forEach(h => Object.keys(h.completed || {}).forEach(d => { if (h.completed[d] && d > lastHabit) lastHabit = d; }));
    set('habits', lastHabit, 2);

    const notes = Storage.get('brain_notes') || [];
    const nDates = notes.map(n => (n.updatedAt || n.createdAt || '').slice(0, 10)).filter(Boolean).sort();
    set('brain', nDates[nDates.length - 1], 21);

    return r;
  }
};
