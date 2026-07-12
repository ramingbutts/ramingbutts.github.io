// Sanitized production-scale seed data for Personal OS QA.
//
// Deterministic (seeded PRNG) so failures reproduce. All content is synthetic:
// names, vendors, note text are generated from word lists — no real PII.
// Output shape = Storage.exportAll() format (top-level storage keys), so the
// same file drives both the localStorage preload AND the import round-trip test.
//
//   node qa/seed.mjs        → writes qa/seed-data.json
//
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// ---------- deterministic PRNG (mulberry32) ----------
let _s = 0xC0FFEE;
const rnd = () => { _s |= 0; _s = (_s + 0x6D2B79F5) | 0; let t = Math.imul(_s ^ (_s >>> 15), 1 | _s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const pick = arr => arr[Math.floor(rnd() * arr.length)];
const chance = p => rnd() < p;

let _uid = 1000;
const uid = () => 'qa' + (_uid++).toString(36).padStart(6, '0');

// ---------- date helpers (local-time, matching App.getToday) ----------
const fmt = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const today = new Date();
const daysAgo = n => { const d = new Date(today); d.setDate(d.getDate() - n); return d; };
const iso = d => d.toISOString();

// ---------- sanitized vocab ----------
const VERBS = ['Review', 'Draft', 'Ship', 'Refactor', 'Test', 'Plan', 'Schedule', 'Clean', 'Update', 'Archive', 'Prepare', 'Research', 'Fix', 'Migrate', 'Document'];
const NOUNS = ['quarterly report', 'garden bed', 'backup routine', 'expense sheet', 'reading list', 'sprint board', 'travel kit', 'meal plan', 'photo library', 'home network', 'workshop notes', 'budget forecast', 'onboarding doc', 'bike maintenance', 'window seals'];
const TASK_CATS = ['Work', 'Health', 'Home', 'Finance', 'Learning', ''];
const VENDORS = ['Northside Grocers', 'Transit Pass', 'Cloud Notes Pro', 'Corner Bakery', 'City Utilities', 'Pedal & Chain', 'Streamline Video', 'Green Bowl Cafe', 'BookNook', 'FixIt Hardware', 'Juniper Pharmacy', 'Metro Parking'];
const EXP_CATS = ['Food', 'Groceries', 'Transport', 'Subscriptions', 'Health', 'Entertainment', 'Housing', 'Other'];
const PEOPLE = ['Sam Rivera', 'Alex Chen', 'Jordan Blake', 'Casey Nguyen'];  // synthetic
const MOODS = ['🚀', '😁', '😊', '😐', '😕', '😫', '🤔', '💪', '🌟', '💓'];
const TOPICS = ['compost', 'typography', 'interval training', 'sourdough', 'spaced repetition', 'index funds', 'trail maps', 'watercolor', 'espresso dialing', 'strength blocks', 'sleep hygiene', 'note-taking'];
const WORDS = 'the quick projects garden light system review notes energy focus deep water simple change plan build learn track measure improve steady'.split(' ');
const sentence = n => { const w = []; for (let i = 0; i < n; i++) w.push(pick(WORDS)); const s = w.join(' '); return s[0].toUpperCase() + s.slice(1) + '.'; };
const para = () => Array.from({ length: ri(2, 5) }, () => sentence(ri(6, 14))).join(' ');

// ---------- tasks (~300) ----------
const tasks = [];
for (let i = 0; i < 300; i++) {
  const created = daysAgo(ri(0, 540));
  const status = pick(['todo', 'todo', 'in-progress', 'done', 'done', 'done']);
  const due = chance(0.7) ? fmt(daysAgo(ri(-30, 60))) : '';
  tasks.push({
    id: uid(),
    title: `${pick(VERBS)} ${pick(NOUNS)} #${i + 1}`,
    description: chance(0.5) ? sentence(ri(6, 12)) : '',
    priority: pick(['high', 'medium', 'medium', 'low']),
    status,
    category: pick(TASK_CATS),
    dueDate: due,
    recurrence: chance(0.12) ? pick(['daily', 'weekly', 'monthly']) : 'none',
    blockers: chance(0.08) ? [sentence(5), ...(chance(0.3) ? [sentence(4)] : [])] : [],
    createdAt: iso(created),
  });
}
// deterministic sentinels the E2E suite asserts on
tasks.push({ id: 'qa-task-xss', title: '<img src=x onerror="window.__xss=1">', description: 'XSS witness', priority: 'high', status: 'todo', category: 'Work', dueDate: fmt(today), recurrence: 'none', blockers: ['<b>bold blocker</b>'], createdAt: iso(today) });
tasks.push({ id: 'qa-task-recur', title: 'QA weekly recurring sentinel', description: '', priority: 'medium', status: 'todo', category: 'Work', dueDate: fmt(daysAgo(90)), recurrence: 'weekly', blockers: [], createdAt: iso(daysAgo(90)) });

// ---------- finance (~1300 txns / 18 months, 8 accounts, 6 goals) ----------
const accounts = [
  { id: uid(), name: 'Everyday Checking', type: 'bank', balance: 4820 },
  { id: uid(), name: 'Rainy Day Savings', type: 'bank', balance: 21500 },
  { id: uid(), name: 'Index Portfolio', type: 'investment', balance: 48200 },
  { id: uid(), name: 'Retirement Fund', type: 'investment', balance: 31350 },
  { id: uid(), name: 'Coin Wallet', type: 'crypto', balance: 1875 },
  { id: uid(), name: 'Travel Pot', type: 'bank', balance: 2300 },
  { id: uid(), name: 'House Deposit', type: 'bank', balance: 15400 },
  { id: uid(), name: 'Petty Cash', type: 'other', balance: 140 },
];
const transactions = [];
for (let m = 17; m >= 0; m--) {
  const monthStart = new Date(today.getFullYear(), today.getMonth() - m, 1);
  const dim = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0).getDate();
  const clampDay = m === 0 ? Math.min(today.getDate(), dim) : dim;
  // salary on the 1st, rent on the 3rd
  transactions.push({ id: uid(), description: 'Salary — Meridian Studio', amount: 5050, category: 'Income', date: fmt(new Date(monthStart.getFullYear(), monthStart.getMonth(), 1)) });
  if (clampDay >= 3) transactions.push({ id: uid(), description: 'Rent — Alder Street Apt', amount: -1650, category: 'Housing', date: fmt(new Date(monthStart.getFullYear(), monthStart.getMonth(), 3)) });
  const n = ri(55, 75); // day-to-day spend
  for (let i = 0; i < n; i++) {
    const day = ri(1, clampDay);
    transactions.push({
      id: uid(),
      description: pick(VENDORS),
      amount: -Math.round((rnd() * 88 + 4) * 100) / 100,
      category: pick(EXP_CATS),
      date: fmt(new Date(monthStart.getFullYear(), monthStart.getMonth(), day)),
    });
  }
  if (chance(0.5)) transactions.push({ id: uid(), description: 'Freelance invoice', amount: ri(200, 900), category: 'Income', date: fmt(new Date(monthStart.getFullYear(), monthStart.getMonth(), ri(10, clampDay))) });
}
const finance = {
  netWorth: 118000, // intentionally drifted from the account sum → reconciliation must flag
  monthlyIncome: 5050,
  monthlyExpenses: 3300,
  savingsRate: 34,
  accounts,
  transactions,
  goals: [
    { id: uid(), name: 'Emergency fund', target: 25000, current: 21500 },
    { id: uid(), name: 'House deposit', target: 60000, current: 15400 },
    { id: uid(), name: 'New laptop', target: 2400, current: 900 },
    { id: uid(), name: 'Sabbatical pot', target: 12000, current: 3100 },
    { id: uid(), name: 'Bike upgrade', target: 1500, current: 1500 },
    { id: uid(), name: 'Course budget', target: 800, current: 260 },
  ],
};

// ---------- habits (10 × 18 months of history) ----------
const HABIT_DEFS = [
  ['Morning stretch', 'health', '🤸', 0.85], ['Read 30 min', 'productivity', '📖', 0.7],
  ['Strength session', 'health', '💪', 0.5], ['Ledger check', 'finance', '📊', 0.6],
  ['Meditate', 'health', '🧘', 0.75], ['Write journal', 'productivity', '✍️', 0.65],
  ['Walk 8k steps', 'health', '🚶', 0.8], ['Inbox zero', 'productivity', '📥', 0.4],
  ['No-spend day', 'finance', '🚫', 0.3], ['Lights out 23:00', 'health', '🌙', 0.55],
];
const habits = HABIT_DEFS.map(([name, category, icon, p]) => {
  const completed = {};
  for (let d = 540; d >= 1; d--) if (chance(p)) completed[fmt(daysAgo(d))] = true;
  return { id: uid(), name, category, icon, streak: 0, completed };
});
// sentinel: unbroken 400-day chain INCLUDING today → at top of streaks, tests the 365 loop bound
{
  const completed = {};
  for (let d = 400; d >= 0; d--) completed[fmt(daysAgo(d))] = true;
  habits.push({ id: 'qa-habit-iron', name: 'Iron streak sentinel', category: 'health', icon: '⛓️', streak: 0, completed });
}
// sentinel: streak 5 ending yesterday, NOT done today → must appear "at risk"
{
  const completed = {};
  for (let d = 5; d >= 1; d--) completed[fmt(daysAgo(d))] = true;
  habits.push({ id: 'qa-habit-risk', name: 'At-risk sentinel', category: 'productivity', icon: '🔥', streak: 5, completed });
}
// recompute stored streaks the way the app does (consecutive days ending today).
// EXCEPT the at-risk sentinel: a real user's stored streak was computed at their
// last toggle (yesterday), so it legitimately reads 5 while today is unticked.
for (const h of habits) {
  if (h.id === 'qa-habit-risk') continue;
  let s = 0;
  for (let i = 0; i < 365; i++) { if (h.completed[fmt(daysAgo(i))]) s++; else break; }
  h.streak = s;
}

// ---------- journal (~250 entries) ----------
const journal = [];
for (let d = 540; d >= 0; d--) {
  if (!chance(0.45)) continue;
  const date = daysAgo(d);
  journal.push({
    id: uid(), date: fmt(date),
    title: `On ${pick(TOPICS)}`,
    content: para(),
    mood: chance(0.85) ? pick(MOODS) : '',
    tags: chance(0.6) ? [pick(TOPICS).split(' ')[0], ...(chance(0.3) ? ['weekly'] : [])] : [],
    createdAt: iso(new Date(date.getFullYear(), date.getMonth(), date.getDate(), ri(7, 22), ri(0, 59))),
  });
}

// ---------- calendar (~160 events, past & future) ----------
const EVENT_TITLES = ['Team sync', 'Dentist', 'Coffee with ' + PEOPLE[0], 'Deep work block', 'Grocery run', 'Yoga class', 'Sprint review', '1:1 with ' + PEOPLE[1], 'Library return', 'Bike service'];
const calendar_events = [];
for (let i = 0; i < 160; i++) {
  const d = daysAgo(ri(-45, 400));
  calendar_events.push({
    id: uid(), title: pick(EVENT_TITLES), date: fmt(d),
    time: chance(0.85) ? `${String(ri(7, 19)).padStart(2, '0')}:${pick(['00', '15', '30', '45'])}` : '',
    duration: pick([15, 30, 45, 60, 90]),
    type: pick(['meeting', 'work', 'personal']),
    description: chance(0.4) ? sentence(ri(4, 9)) : '',
  });
}
// sentinels: exactly 3 events today (multi-event day chooser), 1 with quotes in title
calendar_events.push({ id: 'qa-ev-1', title: "Quote's \"edge\" check", date: fmt(today), time: '09:00', duration: 30, type: 'meeting', description: '' });
calendar_events.push({ id: 'qa-ev-2', title: 'QA today block', date: fmt(today), time: '13:00', duration: 60, type: 'work', description: 'sentinel' });
calendar_events.push({ id: 'qa-ev-3', title: 'QA evening walk', date: fmt(today), time: '18:30', duration: 45, type: 'personal', description: '' });

// ---------- second brain (8 categories, ~120 notes, wiki-links) ----------
const brain_categories = [
  ['Projects', '🚀', 'purple'], ['Recipes', '🍲', 'amber'], ['Reading', '📚', 'accent'],
  ['Fitness', '🏋️', 'green'], ['Travel', '🧭', 'pink'], ['Home', '🏠', 'accent'],
  ['Career', '💼', 'purple'], ['Ideas', '💡', 'amber'],
].map(([name, icon, color]) => ({ id: uid(), name, icon, color }));

const noteTitles = [];
const brain_notes = [];
for (let i = 0; i < 120; i++) {
  const title = `${pick(TOPICS)} ${pick(['guide', 'log', 'checklist', 'map', 'plan', 'notes'])} ${i + 1}`;
  noteTitles.push(title);
}
for (let i = 0; i < 120; i++) {
  const links = [];
  if (i > 4 && chance(0.55)) { links.push(noteTitles[ri(0, i - 1)]); if (chance(0.4)) links.push(noteTitles[ri(0, i - 1)]); }
  if (i === 10) links.push('A note that does not exist'); // broken-link sentinel
  const tags = [pick(TOPICS).split(' ')[0]];
  if (chance(0.5)) tags.push(pick(['howto', 'reference', 'draft', 'evergreen']));
  const created = daysAgo(ri(1, 500));
  brain_notes.push({
    id: uid(),
    categoryId: chance(0.85) ? pick(brain_categories).id : null,
    title: noteTitles[i],
    content: `# ${noteTitles[i]}\n\n${para()}\n\n- [ ] follow up\n- [x] captured\n\n` +
      links.map(l => `Related: [[${l}]]`).join('\n') + (tags[0] ? `\n\n#${tags[0]}` : ''),
    tags,
    wikiLinks: links,
    createdAt: iso(created),
    updatedAt: iso(daysAgo(ri(0, 100))),
  });
}
// double-escape sentinel: title with & and <
brain_notes.push({ id: 'qa-note-amp', title: 'Fish & Chips <recipe>', content: 'Batter & fry. **Crispy.**', tags: ['howto'], wikiLinks: [], categoryId: brain_categories[1].id, createdAt: iso(daysAgo(3)), updatedAt: iso(daysAgo(3)) });

// ---------- nutrition (90 days) + water ----------
const FOODS = [['Oats with fruit', 380, 12, 60, 9], ['Chicken bowl', 520, 42, 45, 16], ['Lentil soup', 340, 18, 50, 6], ['Greek yogurt', 150, 15, 12, 4], ['Trail mix', 210, 6, 18, 13], ['Veg stir-fry', 430, 20, 55, 12], ['Salmon & rice', 610, 38, 52, 22], ['Apple', 90, 0, 24, 0]];
const nutrition = { goals: { calories: 2200, protein: 150, carbs: 250, fat: 70, water: 8 }, entries: [] };
const water = {};
for (let d = 90; d >= 0; d--) {
  const date = fmt(daysAgo(d));
  for (const meal of ['Breakfast', 'Lunch', 'Dinner']) {
    if (!chance(0.8)) continue;
    const items = Array.from({ length: ri(1, 3) }, () => {
      const [name, calories, protein, carbs, fat] = pick(FOODS);
      return { name, calories, protein, carbs, fat };
    });
    nutrition.entries.push({ id: uid(), date, meal, items });
  }
  if (chance(0.9)) water['water_' + date] = ri(2, 10);
}

// ---------- finance extras ----------
const finance_profile = { name: 'Q. A. Tester', location: 'Springfield', occupation: 'Designer', incomeSources: 'Salary $5,050 + freelance', riskTolerance: 'Moderate', timeHorizon: 'Long-term (10+ years)', philosophy: 'Low-cost index funds, boring on purpose.', purpose: 'House deposit by 2028' };
const finance_rules = ['Never carry a card balance past the 15th', 'Transfers to savings before discretionary spend', 'Sleep on any purchase over $200'];
const finance_weakspots = ['Late-night gadget browsing', 'Cafe lunches when busy'];
const finance_debts = [
  { id: uid(), name: 'Aurora Card', type: 'Credit Card', balance: 1840, rate: 22.9, minPayment: 65 },
  { id: uid(), name: 'Car note', type: 'Car Loan', balance: 8900, rate: 6.4, minPayment: 260 },
  { id: uid(), name: 'Student loan', type: 'Student Loan', balance: 12400, rate: 4.3, minPayment: 150 },
  { id: uid(), name: 'Zero-APR sofa', type: 'Other', balance: 600, rate: 0, minPayment: 50 },
  { id: uid(), name: 'Underwater card', type: 'Credit Card', balance: 5000, rate: 29.9, minPayment: 20 }, // payment < interest → "Never"
];
const finance_snapshots = [];
for (let m = 12; m >= 1; m--) {
  const d = new Date(today.getFullYear(), today.getMonth() - m, 1);
  const income = 5050 + ri(0, 800), expenses = ri(2800, 3900);
  finance_snapshots.push({ id: uid(), month: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, income, expenses, saved: income - expenses - ri(0, 300) });
}

// ---------- assemble in Storage.exportAll shape ----------
const data = {
  tasks, finance, habits, nutrition, calendar_events,
  brain_categories, brain_notes, journal,
  finance_profile, finance_rules, finance_weakspots, finance_debts, finance_snapshots,
  ...water,
};

const out = join(dirname(fileURLToPath(import.meta.url)), 'seed-data.json');
writeFileSync(out, JSON.stringify(data));
const kb = Math.round(JSON.stringify(data).length / 1024);
console.log(`seed-data.json written: ${kb} KB · ${tasks.length} tasks · ${transactions.length} txns · ${habits.length} habits · ${journal.length} journal · ${calendar_events.length} events · ${brain_notes.length} notes · ${nutrition.entries.length} meals`);
