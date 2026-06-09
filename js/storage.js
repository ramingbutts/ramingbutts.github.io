const Storage = {
  _supabase: null,
  _useSupabase: false,

  init() {
    const sbUrl = localStorage.getItem('os_supabase_url');
    const sbKey = localStorage.getItem('os_supabase_key');
    if (sbUrl && sbKey && typeof window.supabase !== 'undefined') {
      this._supabase = window.supabase.createClient(sbUrl, sbKey);
      this._useSupabase = true;
    }
    this._seedIfEmpty();
  },

  configureSupabase(url, key) {
    localStorage.setItem('os_supabase_url', url);
    localStorage.setItem('os_supabase_key', key);
    location.reload();
  },

  get(key) {
    const raw = localStorage.getItem('os_' + key);
    if (raw === null) return null;
    try { return JSON.parse(raw); }
    catch { return raw; }
  },

  set(key, value) {
    try {
      localStorage.setItem('os_' + key, JSON.stringify(value));
    } catch (e) {
      // The most common cause is QuotaExceededError — e.g. a large Obsidian
      // import overflowing the ~5MB localStorage budget. Make it visible
      // instead of silently dropping the write.
      Diag.error('storage', `Failed to save "${key}" (${e.name || 'error'})`, e);
      Diag.notifyOnce('storage_write_failed', 'Storage full — change not saved. Export a backup and remove old data.', 'error');
      return false;
    }
    if (this._useSupabase) this._syncToSupabase(key, value);
    return true;
  },

  delete(key) {
    localStorage.removeItem('os_' + key);
  },

  exportAll() {
    const data = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k.startsWith('os_')) {
        data[k.slice(3)] = this.get(k.slice(3));
      }
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `personal-os-backup-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  },

  importAll(jsonStr) {
    const allowedKeys = ['tasks', 'finance', 'habits', 'nutrition', 'calendar_events', 'brain_categories', 'brain_notes', 'graph_imported', 'journal', 'finance_profile', 'finance_rules', 'finance_weakspots', 'finance_debts', 'finance_snapshots'];
    const data = JSON.parse(jsonStr);
    Object.entries(data).forEach(([k, v]) => {
      if (allowedKeys.includes(k) || k.startsWith('water_')) this.set(k, v);
    });
  },

  async _syncToSupabase(key, value) {
    if (!this._supabase) return;
    try {
      await this._supabase.from('os_data').upsert({
        key,
        value: JSON.stringify(value),
        updated_at: new Date().toISOString()
      }, { onConflict: 'key' });
      // Recovered — allow a future failure to notify again.
      Diag.clearNotice('supabase_sync_failed');
    } catch (e) {
      // Cloud sync failing silently is dangerous: the user believes their data
      // is backed up when it isn't. Log every occurrence, toast once.
      Diag.error('sync', `Supabase sync failed for "${key}"`, e);
      Diag.notifyOnce('supabase_sync_failed', 'Cloud sync failed — data saved locally only.', 'error');
    }
  },

  _migrateHtmlEntities() {
    const entityMap = {
      '&#9829;': '❤️', '&#9733;': '⭐', '&#9650;': '📊', '&#9672;': '🚀',
      '&#9998;': '✍️', '&#9744;': '📵', '&#128640;': '🚀', '&#128513;': '😁',
      '&#128522;': '😊', '&#128528;': '😐', '&#128533;': '😕', '&#128555;': '😫',
      '&#129300;': '🤔', '&#128170;': '💪', '&#127775;': '🌟', '&#128147;': '💓'
    };
    const fix = (val) => {
      if (typeof val !== 'string') return val;
      let out = val;
      Object.entries(entityMap).forEach(([ent, emoji]) => { out = out.split(ent).join(emoji); });
      return out;
    };
    const habits = this.get('habits');
    if (habits) {
      let changed = false;
      habits.forEach(h => { const f = fix(h.icon); if (f !== h.icon) { h.icon = f; changed = true; } });
      if (changed) this.set('habits', habits);
    }
    const cats = this.get('brain_categories');
    if (cats) {
      let changed = false;
      cats.forEach(c => { const f = fix(c.icon); if (f !== c.icon) { c.icon = f; changed = true; } });
      if (changed) this.set('brain_categories', cats);
    }
    const journal = this.get('journal');
    if (journal) {
      let changed = false;
      journal.forEach(e => { const f = fix(e.mood); if (f !== e.mood) { e.mood = f; changed = true; } });
      if (changed) this.set('journal', journal);
    }
  },

  _seedIfEmpty() {
    if (this.get('tasks') !== null) { this._migrateHtmlEntities(); return; }

    this.set('tasks', [
      { id: this._id(), title: 'Set up Personal OS', description: 'Configure all dashboard modules', priority: 'high', status: 'done', category: 'Setup', dueDate: new Date().toISOString().slice(0,10), blockers: [], createdAt: new Date().toISOString() },
      { id: this._id(), title: 'Connect Google Calendar', description: 'Link calendar for meeting sync', priority: 'high', status: 'todo', category: 'Integration', dueDate: new Date(Date.now() + 86400000).toISOString().slice(0,10), blockers: [], createdAt: new Date().toISOString() },
      { id: this._id(), title: 'Review weekly finances', description: 'Check all account balances', priority: 'medium', status: 'in-progress', category: 'Finance', dueDate: new Date(Date.now() + 172800000).toISOString().slice(0,10), blockers: [], createdAt: new Date().toISOString() },
      { id: this._id(), title: 'Meal prep planning', description: 'Plan meals for the week', priority: 'low', status: 'todo', category: 'Health', dueDate: new Date(Date.now() + 259200000).toISOString().slice(0,10), blockers: [], createdAt: new Date().toISOString() },
      { id: this._id(), title: 'Update project roadmap', description: 'Add Q3 milestones', priority: 'medium', status: 'todo', category: 'Work', dueDate: new Date(Date.now() + 345600000).toISOString().slice(0,10), blockers: ['Waiting on team input'], createdAt: new Date().toISOString() },
    ]);

    this.set('finance', {
      netWorth: 125000,
      monthlyIncome: 8500,
      monthlyExpenses: 4200,
      savingsRate: 50.6,
      accounts: [
        { id: this._id(), name: 'Checking', type: 'bank', balance: 12500 },
        { id: this._id(), name: 'Savings', type: 'bank', balance: 45000 },
        { id: this._id(), name: 'Investment Portfolio', type: 'investment', balance: 62000 },
        { id: this._id(), name: 'Crypto', type: 'crypto', balance: 5500 },
      ],
      transactions: [
        { id: this._id(), description: 'Salary deposit', amount: 8500, category: 'Income', date: new Date().toISOString().slice(0,10) },
        { id: this._id(), description: 'Rent', amount: -1800, category: 'Housing', date: new Date().toISOString().slice(0,10) },
        { id: this._id(), description: 'Groceries', amount: -320, category: 'Food', date: new Date(Date.now() - 86400000).toISOString().slice(0,10) },
        { id: this._id(), description: 'Gym membership', amount: -50, category: 'Health', date: new Date(Date.now() - 172800000).toISOString().slice(0,10) },
      ],
      goals: [
        { id: this._id(), name: 'Emergency Fund', target: 25000, current: 18000 },
        { id: this._id(), name: 'Investment Target', target: 100000, current: 62000 },
      ]
    });

    this.set('habits', [
      { id: this._id(), name: 'Morning workout', category: 'health', icon: '💪', streak: 5, completed: {} },
      { id: this._id(), name: 'Read 30 min', category: 'productivity', icon: '📖', streak: 12, completed: {} },
      { id: this._id(), name: 'Finance check', category: 'finance', icon: '📊', streak: 3, completed: {} },
      { id: this._id(), name: 'Meditation', category: 'health', icon: '🧘', streak: 8, completed: {} },
      { id: this._id(), name: 'Journal entry', category: 'productivity', icon: '✍️', streak: 7, completed: {} },
      { id: this._id(), name: 'No social media before noon', category: 'productivity', icon: '📵', streak: 2, completed: {} },
    ]);

    this.set('nutrition', {
      goals: { calories: 2200, protein: 150, carbs: 250, fat: 70, water: 8 },
      entries: []
    });

    this.set('calendar_events', [
      { id: this._id(), title: 'Team standup', date: new Date().toISOString().slice(0,10), time: '09:00', duration: 30, type: 'meeting', description: 'Daily sync' },
      { id: this._id(), title: 'Lunch with Alex', date: new Date().toISOString().slice(0,10), time: '12:30', duration: 60, type: 'personal', description: '' },
      { id: this._id(), title: 'Review sprint goals', date: new Date(Date.now() + 86400000).toISOString().slice(0,10), time: '14:00', duration: 45, type: 'work', description: 'Q3 planning' },
    ]);

    this.set('brain_categories', [
      { id: this._id(), name: 'Business', icon: '💼', color: 'accent' },
      { id: this._id(), name: 'Personal', icon: '🏠', color: 'pink' },
      { id: this._id(), name: 'Learning', icon: '🎓', color: 'amber' },
      { id: this._id(), name: 'Projects', icon: '🚀', color: 'purple' },
    ]);

    this.set('brain_notes', [
      { id: this._id(), categoryId: null, title: 'Welcome to Second Brain', content: 'This is your AI-powered second brain. Organize notes by category and access them anytime.', tags: ['intro'], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    ]);

    this.set('journal', [
      { id: this._id(), date: new Date().toISOString().slice(0,10), title: 'Getting started', content: 'Set up my Personal OS today. Excited to see how this transforms my daily workflow and productivity.', mood: '🚀', tags: ['start', 'productivity'], createdAt: new Date().toISOString() },
    ]);
  },

  _id() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }
};
