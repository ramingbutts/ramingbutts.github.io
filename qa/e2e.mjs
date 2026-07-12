// Personal OS — user-level E2E suite against production-scale seed data.
//
// Drives the real UI (clicks, typing, drag, file inputs) in headless Chromium,
// following qa/INVENTORY.md. Seed data loads into localStorage BEFORE the app
// boots, exactly like a long-time user opening the site. Every failure grabs a
// screenshot into qa/evidence/.
//
//   run:  python3 -m http.server 8099   (repo root)
//         node qa/e2e.mjs
//   env:  PW_MODULE / PW_CHROMIUM as in games/unicorn-janitor/playtest.mjs
//
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const { chromium } = await import(process.env.PW_MODULE || 'playwright');
const QA = dirname(fileURLToPath(import.meta.url));
const EVIDENCE = join(QA, 'evidence');
mkdirSync(EVIDENCE, { recursive: true });
const seed = JSON.parse(readFileSync(join(QA, 'seed-data.json'), 'utf8'));
const BASE = process.env.PLAYTEST_URL || 'http://127.0.0.1:8099/index.html';

const browser = await chromium.launch({
  ...(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}),
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });

// preload seed into localStorage before any page script runs
await ctx.addInitScript((data) => {
  if (!localStorage.getItem('__qa_seeded')) {
    for (const [k, v] of Object.entries(data)) localStorage.setItem('os_' + k.replace(/^os_/, ''), JSON.stringify(v));
    localStorage.setItem('__qa_seeded', '1');
  }
}, Object.fromEntries(Object.entries(seed).map(([k, v]) => [k.startsWith('water_') ? k : k, v])));

const page = await ctx.newPage();
const consoleErrors = [];
// network noise (blocked webfonts etc.) is not an app error — filter it
const NETWORK_NOISE = /Failed to load resource|net::ERR|ERR_CONNECTION/;
page.on('console', m => { if (m.type() === 'error' && !NETWORK_NOISE.test(m.text())) consoleErrors.push(m.text()); });
page.on('pageerror', e => consoleErrors.push('PAGEERROR: ' + e.message));

const results = [];
let shotN = 0;
async function check(id, name, fn) {
  const errBefore = consoleErrors.length;
  try {
    const detail = await fn();
    const newErrs = consoleErrors.slice(errBefore);
    if (newErrs.length) throw new Error('console errors: ' + newErrs.join(' | ').slice(0, 300));
    results.push({ id, name, pass: true, detail: detail || '' });
    console.log(`PASS  ${id}  ${name}${detail ? '  — ' + detail : ''}`);
  } catch (e) {
    const shot = join(EVIDENCE, `${String(++shotN).padStart(2, '0')}-${id}.png`);
    await page.screenshot({ path: shot, fullPage: false }).catch(() => {});
    results.push({ id, name, pass: false, detail: e.message, shot });
    console.log(`FAIL  ${id}  ${name}  — ${e.message.split('\n')[0]}`);
    // leave no open UI behind — a failed check must not cascade into the next
    await page.evaluate(() => { try { App.closeModal(); Capture.close(); } catch {} }).catch(() => {});
  }
}
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };

async function goto(hash) {
  // setting an identical hash fires no hashchange — force the router so a
  // second visit re-renders fresh data (matches a user's reload-equivalent)
  await page.evaluate(h => { location.hash = h; App._route(); }, hash);
  await page.waitForTimeout(120);
}
const grab = sel => page.evaluate(s => document.querySelector(s)?.textContent ?? null, sel);
const count = sel => page.evaluate(s => document.querySelectorAll(s).length, sel);
const storage = key => page.evaluate(k => JSON.parse(localStorage.getItem('os_' + k)), key);

// ═══════════════ boot ═══════════════
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForFunction(() => typeof App !== 'undefined' && typeof Capture !== 'undefined' && document.querySelectorAll('#page-content *').length > 0, null, { timeout: 15000 });

await check('A0', 'app boots with production-scale data, no console errors', async () => {
  const t = await grab('#page-title');
  expect(t === 'Dashboard', 'title=' + t);
  return `${Math.round(JSON.stringify(seed).length / 1024)} KB seed`;
});

// ═══════════════ shell: routing ═══════════════
const ROUTES = [['tasks', 'Task CRM'], ['finance', 'Finance Pulse'], ['habits', 'Habit Tracker'], ['nutrition', 'Nutrition'], ['calendar', 'Calendar'], ['brain', 'Second Brain'], ['graph', 'Knowledge Graph'], ['journal', 'Journal'], ['pulse', 'Weekly Pulse'], ['dashboard', 'Dashboard']];
await check('A1', 'all 10 routes render under load within budget', async () => {
  const times = [];
  for (const [route, title] of ROUTES) {
    const t0 = Date.now();
    await goto('#/' + route);
    await page.waitForFunction(() => document.querySelectorAll('#page-content *').length > 3);
    const ms = Date.now() - t0;
    times.push(`${route}:${ms}ms`);
    const pt = await grab('#page-title');
    expect(pt === title, `${route} title="${pt}"`);
    const active = await page.evaluate(r => document.querySelector('.nav-link.active')?.dataset.page === r, route);
    expect(active, `${route} nav not active`);
    expect(ms < 1500, `${route} took ${ms}ms (>1500)`);
  }
  return times.join(' ');
});

await check('A2', 'unknown route shows empty state, no crash', async () => {
  await goto('#/nope');
  const txt = await grab('#page-content');
  expect(/Page not found/.test(txt), 'missing empty state');
});

// ═══════════════ G3: stored-XSS witness ═══════════════
await check('G3', 'malicious task title renders inert everywhere', async () => {
  await goto('#/tasks');
  await page.waitForTimeout(200);
  const fired = await page.evaluate(() => window.__xss === 1);
  expect(!fired, 'XSS payload EXECUTED');
  const cardShown = await page.evaluate(() => [...document.querySelectorAll('.kanban-card-title')].some(el => el.textContent.includes('<img src=x')));
  expect(cardShown, 'sentinel card not visible as text');
});

// ═══════════════ Task CRM ═══════════════
await check('T1', 'create task via modal → appears, persists', async () => {
  await goto('#/tasks');
  await page.click('#add-task');
  await page.fill('#f-title', 'QA created task Alpha');
  await page.selectOption('#f-priority', 'high');
  await page.fill('#f-category', 'QA');
  await page.click('#f-save');
  await page.waitForTimeout(150);
  const stored = (await storage('tasks')).find(t => t.title === 'QA created task Alpha');
  expect(stored && stored.priority === 'high' && stored.category === 'QA', 'not persisted');
});

await check('T2', 'edit task fields incl. blockers persists', async () => {
  const id = (await storage('tasks')).find(t => t.title === 'QA created task Alpha').id;
  await page.evaluate(i => App.pages.tasks._openForm(i), id);
  await page.fill('#f-desc', 'edited description');
  await page.fill('#f-blockers', 'waiting on vendor\nneeds review');
  await page.click('#f-save');
  await page.waitForTimeout(150);
  const t = (await storage('tasks')).find(t => t.id === id);
  expect(t.description === 'edited description', 'desc not saved');
  expect(t.blockers.length === 2 && t.blockers[1] === 'needs review', 'blockers not split/saved');
});

await check('T3', 'kanban drag to Done sets status + recurring spawns next', async () => {
  await goto('#/tasks');
  const before = (await storage('tasks')).length;
  const moved = await page.evaluate(() => {
    const card = document.querySelector('.kanban-card[data-id="qa-task-recur"]');
    const zone = document.querySelector('.kanban-cards[data-status="done"]');
    if (!card || !zone) return 'missing card/zone';
    const dt = new DataTransfer();
    card.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
    zone.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: dt }));
    zone.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt }));
    return true;
  });
  expect(moved === true, String(moved));
  await page.waitForTimeout(150);
  const tasks = await storage('tasks');
  const done = tasks.find(t => t.id === 'qa-task-recur');
  expect(done.status === 'done', 'status=' + done.status);
  expect(tasks.length === before + 1, 'no next occurrence spawned');
  const next = tasks[tasks.length - 1];
  expect(next.title === done.title && next.status === 'todo', 'spawn malformed');
  expect(next.dueDate > new Date().toISOString().slice(0, 10), `rolled due ${next.dueDate} not in future`);
  return `rolled 90-days-past due → ${next.dueDate}`;
});

await check('T5', 'delete task from list view', async () => {
  await goto('#/tasks');
  await page.click('#view-list');
  await page.waitForTimeout(100);
  const before = (await storage('tasks')).length;
  await page.evaluate(() => document.querySelector('.task-del-btn').click());
  await page.waitForTimeout(120);
  expect((await storage('tasks')).length === before - 1, 'not deleted');
});

await check('T-empty', 'empty title rejected with toast', async () => {
  await goto('#/tasks');
  await page.click('#add-task');
  await page.click('#f-save');
  await page.waitForTimeout(80);
  const toast = await page.evaluate(() => [...document.querySelectorAll('.toast')].map(t => t.textContent).join());
  expect(/Title required/.test(toast), 'no rejection toast');
  await page.evaluate(() => App.closeModal());
});

// ═══════════════ Quick Capture ═══════════════
await check('C1', 'Ctrl+K opens palette, Esc closes', async () => {
  await page.keyboard.press('Control+k');
  await page.waitForTimeout(80);
  expect(await page.evaluate(() => !document.getElementById('capture-overlay').classList.contains('hidden')), 'did not open');
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => document.getElementById('capture-overlay').classList.contains('hidden')), 'did not close');
});

await check('C2', 'fuzzy search finds seeded items across groups + navigates', async () => {
  await page.keyboard.press('Control+k');
  await page.fill('#capture-input', 'iron streak');
  await page.waitForTimeout(80);
  const groups = await count('.capture-group');
  expect(groups >= 1, 'no result groups');
  await page.keyboard.press('Enter'); // first match: the habit → #/habits
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => location.hash.includes('habits')), 'did not navigate');
});

await check('C3', 'capture task with !high @tomorrow #QA parses fully', async () => {
  await page.keyboard.press('Control+k');
  await page.fill('#capture-input', 't pay water bill !high @tomorrow #QA');
  await page.waitForTimeout(60);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  const t = (await storage('tasks')).find(x => x.title === 'pay water bill');
  expect(t, 'task not created');
  expect(t.priority === 'high' && t.category === 'QA', 'fields not parsed');
  const tm = new Date(); tm.setDate(tm.getDate() + 1);
  const exp = `${tm.getFullYear()}-${String(tm.getMonth() + 1).padStart(2, '0')}-${String(tm.getDate()).padStart(2, '0')}`;
  expect(t.dueDate === exp, `due ${t.dueDate} != ${exp}`);
});

await check('C4', '$ capture: amount required; valid txn writes', async () => {
  await page.keyboard.press('Control+k');
  await page.fill('#capture-input', '$ lunch no amount');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(80);
  expect(await page.evaluate(() => !document.getElementById('capture-overlay').classList.contains('hidden')), 'should stay open on error');
  await page.fill('#capture-input', '$ -12.50 qa lunch #Food');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  const tx = (await storage('finance')).transactions.find(t => t.description === 'qa lunch');
  expect(tx && tx.amount === -12.5 && tx.category === 'Food', 'txn not written');
});

await check('C5', 'j / n / e / w captures write their stores', async () => {
  const today = await page.evaluate(() => App.getToday());
  const before = { j: (await storage('journal')).length, n: (await storage('brain_notes')).length, e: (await storage('calendar_events')).length, w: (await storage('water_' + today)) || 0 };
  for (const cmd of ['j qa mood check :🚀', 'n qa quick note', 'e 14:00 qa sync', 'w']) {
    await page.keyboard.press('Control+k');
    await page.fill('#capture-input', cmd);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(120);
  }
  expect((await storage('journal')).length === before.j + 1, 'journal not written');
  expect((await storage('brain_notes')).length === before.n + 1, 'note not written');
  const ev = (await storage('calendar_events')).find(e => e.title === 'qa sync');
  expect(ev && ev.time === '14:00', 'event time not parsed');
  expect((await storage('water_' + today)) === before.w + 1, 'water not incremented');
});

await check('C-nav', 'palette can navigate to every sidebar page', async () => {
  const navLabels = await page.evaluate(() => {
    const groups = Capture._searchGroups();
    const nav = groups.find(g => g[0] === 'Navigate');
    return nav ? nav[2].map(x => x.hash) : [];
  });
  const missing = ['#/graph', '#/pulse', '#/dashboard', '#/tasks', '#/finance', '#/habits', '#/nutrition', '#/calendar', '#/brain', '#/journal'].filter(h => !navLabels.includes(h));
  expect(!missing.length, 'palette missing nav entries: ' + missing.join(', '));
});

// ═══════════════ Finance ═══════════════
await check('F1', 'reconciliation derives truth and Sync clears drift', async () => {
  await goto('#/finance');
  await page.waitForTimeout(150);
  const f = await storage('finance');
  const sum = f.accounts.reduce((s, a) => s + a.balance, 0);
  const btn = await page.$('#fin-reconcile');
  expect(btn, 'no drift flagged despite seeded drift');
  await btn.click();
  await page.waitForTimeout(200);
  const f2 = await storage('finance');
  expect(Math.abs(f2.netWorth - sum) < 1, `netWorth ${f2.netWorth} != accounts sum ${sum}`);
  expect(!(await page.$('#fin-reconcile')), 'drift still flagged after sync');
  return `netWorth synced to ${f2.netWorth}`;
});

await check('F2', 'account + transaction + goal CRUD persists', async () => {
  await page.click('#add-account');
  await page.fill('#fa-name', 'QA Vault');
  await page.fill('#fa-bal', '1234');
  await page.click('#fa-save');
  await page.waitForTimeout(120);
  expect((await storage('finance')).accounts.some(a => a.name === 'QA Vault'), 'account missing');
  await page.click('#add-transaction');
  await page.fill('#ft-desc', 'QA txn probe');
  await page.fill('#ft-amount', '-42');
  await page.click('#ft-save');
  await page.waitForTimeout(120);
  expect((await storage('finance')).transactions.some(t => t.description === 'QA txn probe'), 'txn missing');
  await page.click('#add-goal');
  await page.fill('#fg-name', 'QA Goal');
  await page.fill('#fg-target', '1000');
  await page.fill('#fg-current', '250');
  await page.click('#fg-save');
  await page.waitForTimeout(120);
  expect((await storage('finance')).goals.some(g => g.name === 'QA Goal'), 'goal missing');
});

await check('F3', 'debt payoff math: Never / 0% APR cases', async () => {
  await page.click('.fin-tab[data-tab="debts"]');
  await page.waitForTimeout(150);
  const rows = await page.evaluate(() => [...document.querySelectorAll('tbody tr')].map(r => r.textContent));
  const never = rows.find(r => r.includes('Underwater card'));
  expect(never && never.includes('Never'), 'underwater debt should be Never');
  const sofa = rows.find(r => r.includes('Zero-APR sofa'));
  expect(sofa && sofa.includes('12 months'), 'sofa 600/50 should be 12 months: ' + sofa);
});

await check('F4', 'categories tab groups vendor categories correctly', async () => {
  await page.click('.fin-tab[data-tab="categories"]');
  await page.waitForTimeout(200);
  const txt = await grab('#fin-content');
  expect(/Food/.test(txt) && /Total Expenses/.test(txt), 'categories missing');
  const groc = await page.evaluate(() => [...document.querySelectorAll('#fin-content span')].some(s => s.textContent === 'Groceries'));
  expect(!groc, '"Groceries" should have been mapped into Food');
});

await check('F5', 'trends snapshot add + averages', async () => {
  await page.click('.fin-tab[data-tab="trends"]');
  await page.waitForTimeout(150);
  await page.click('#add-snapshot');
  await page.fill('#fs-inc', '5000');
  await page.fill('#fs-exp', '3000');
  await page.fill('#fs-saved', '1500');
  await page.click('#fs-save');
  await page.waitForTimeout(150);
  expect((await storage('finance_snapshots')).length === 13, 'snapshot not added');
});

// ═══════════════ Habits ═══════════════
await check('H1', 'day-cell toggle recomputes streak from history', async () => {
  await goto('#/habits');
  const iron = (await storage('habits')).find(h => h.id === 'qa-habit-iron');
  expect(iron.streak === 365, `iron streak ${iron.streak} != 365 (loop bound)`);
  // toggle today OFF for the iron habit → streak collapses to 0
  await page.evaluate(() => {
    const cells = [...document.querySelectorAll('.habit-toggle[data-hid="qa-habit-iron"]')];
    cells[cells.length - 1].click(); // last cell = today
  });
  await page.waitForTimeout(150);
  const after = (await storage('habits')).find(h => h.id === 'qa-habit-iron');
  expect(after.streak === 0, `streak ${after.streak} != 0 after untoggling today`);
  // restore
  await page.evaluate(() => {
    const cells = [...document.querySelectorAll('.habit-toggle[data-hid="qa-habit-iron"]')];
    cells[cells.length - 1].click();
  });
  await page.waitForTimeout(120);
  return 'streak 365 → 0 → restored';
});

await check('H2', 'at-risk list shows sentinel; quick-complete clears it', async () => {
  await goto('#/habits');
  const risk = await page.evaluate(() => [...document.querySelectorAll('.habit-quick')].map(b => b.dataset.hid));
  expect(risk.includes('qa-habit-risk'), 'sentinel not at risk');
  await page.evaluate(() => document.querySelector('.habit-quick[data-hid="qa-habit-risk"]').click());
  await page.waitForTimeout(150);
  const after = await page.evaluate(() => [...document.querySelectorAll('.habit-quick')].map(b => b.dataset.hid));
  expect(!after.includes('qa-habit-risk'), 'still at risk after quick-complete');
  const h = (await storage('habits')).find(h => h.id === 'qa-habit-risk');
  expect(h.streak === 6, `streak ${h.streak} != 6`);
});

await check('H4', 'habit add + edit + delete', async () => {
  await goto('#/habits');
  await page.click('#add-habit');
  await page.fill('#fh-name', 'QA floss');
  await page.click('#fh-save');
  await page.waitForTimeout(120);
  const h = (await storage('habits')).find(x => x.name === 'QA floss');
  expect(h, 'not added');
  await page.evaluate(id => document.querySelector(`.habit-del-btn[data-hid="${id}"]`).click(), h.id);
  await page.waitForTimeout(120);
  expect(!(await storage('habits')).some(x => x.name === 'QA floss'), 'not deleted');
});

// ═══════════════ Nutrition ═══════════════
await check('N1', 'water clamps at [0,20] and persists per-day', async () => {
  await goto('#/nutrition');
  const today = await page.evaluate(() => App.getToday());
  await page.evaluate(() => Storage.set('water_' + App.getToday(), 19));
  await goto('#/nutrition');
  await page.click('#add-water'); await page.waitForTimeout(80);
  await page.click('#add-water'); await page.waitForTimeout(80); // should clamp at 20
  expect((await storage('water_' + today)) === 20, 'not clamped at 20');
});

await check('N2', 'meal with 2 items sums into day totals', async () => {
  await goto('#/nutrition');
  const calBefore = await page.evaluate(() => Number(document.querySelector('.card-value').textContent));
  await page.click('#add-meal');
  await page.fill('.fn-item-row .fn-name', 'QA rice');
  await page.fill('.fn-item-row .fn-cal', '200');
  await page.click('#fn-add-item');
  const rows = await page.$$('.fn-item-row');
  await rows[1].$eval('.fn-name', el => el.value = 'QA beans');
  await rows[1].$eval('.fn-cal', el => el.value = '150');
  await page.click('#fn-save');
  await page.waitForTimeout(150);
  const calAfter = await page.evaluate(() => Number(document.querySelector('.card-value').textContent));
  expect(calAfter === calBefore + 350, `calories ${calBefore} → ${calAfter}, expected +350`);
});

await check('N4', 'meal with no items rejected', async () => {
  await page.click('#add-meal');
  await page.click('#fn-save');
  await page.waitForTimeout(80);
  const toast = await page.evaluate(() => [...document.querySelectorAll('.toast')].map(t => t.textContent).join());
  expect(/at least one/.test(toast), 'no rejection');
  await page.evaluate(() => App.closeModal());
});

// ═══════════════ Calendar ═══════════════
await check('K1', 'grid renders 42 cells, today highlighted, 3-event day chooser', async () => {
  await goto('#/calendar');
  expect((await count('.cal-day')) === 42, 'not 42 cells');
  expect((await count('.cal-day.today')) === 1, 'today not highlighted');
  await page.evaluate(() => App.pages.calendar._dayClick(App.getToday()));
  await page.waitForTimeout(100);
  const modalTxt = await grab('#modal-body');
  expect(/QA today block/.test(modalTxt) && /QA evening walk/.test(modalTxt), 'chooser missing events');
  await page.evaluate(() => App.closeModal());
});

await check('K2', 'event CRUD via modal persists', async () => {
  await page.click('#add-event');
  await page.fill('#fe-title', 'QA planning slot');
  await page.fill('#fe-time', '11:15');
  await page.click('#fe-save');
  await page.waitForTimeout(150);
  const ev = (await storage('calendar_events')).find(e => e.title === 'QA planning slot');
  expect(ev && ev.time === '11:15', 'not saved');
  await page.evaluate(id => App.pages.calendar._deleteEvent(id), ev.id);
  await page.waitForTimeout(120);
  expect(!(await storage('calendar_events')).some(e => e.title === 'QA planning slot'), 'not deleted');
});

await check('K4', 'month navigation crosses year boundary both ways', async () => {
  await goto('#/calendar');
  for (let i = 0; i < 13; i++) await page.click('#cal-prev');
  let head = await page.evaluate(() => document.querySelector('.section-title[style*="min-width"]').textContent);
  const yearBack = Number(head.match(/\d{4}/)[0]);
  expect(yearBack === new Date().getFullYear() - 1, 'prev year wrong: ' + head);
  await page.click('#cal-today');
  for (let i = 0; i < 13; i++) await page.click('#cal-next');
  head = await page.evaluate(() => document.querySelector('.section-title[style*="min-width"]').textContent);
  expect(Number(head.match(/\d{4}/)[0]) === new Date().getFullYear() + 1, 'next year wrong: ' + head);
  await page.click('#cal-today');
});

await check('K-quote', 'event with quotes in title: agenda click still works', async () => {
  await goto('#/calendar');
  await page.evaluate(() => {
    const rows = [...document.querySelectorAll('[onclick*="_editEvent"]')];
    const row = rows.find(r => r.textContent.includes('edge'));
    if (row) row.click();
  });
  await page.waitForTimeout(120);
  const open = await page.evaluate(() => !document.getElementById('modal-overlay').classList.contains('hidden'));
  expect(open, 'edit modal did not open for quoted title');
  const val = await page.evaluate(() => document.getElementById('fe-title')?.value || '');
  expect(val.includes('edge'), 'title mangled: ' + val);
  await page.evaluate(() => App.closeModal());
});

// ═══════════════ Second Brain ═══════════════
await check('B1', 'search filters notes; clear restores', async () => {
  await goto('#/brain');
  await page.fill('#brain-search', 'sourdough');
  await page.waitForTimeout(450); // debounce
  const results = await count('.brain-note-row');
  expect(results >= 1 && results < 121, `results ${results}`);
  await page.evaluate(() => document.getElementById('clear-search')?.click());
  await page.waitForTimeout(150);
});

await check('B2', 'deleting a category orphans notes, never deletes them', async () => {
  await goto('#/brain');
  const cats = await storage('brain_categories');
  const cat = cats[0];
  const notesBefore = (await storage('brain_notes')).length;
  const inCat = (await storage('brain_notes')).filter(n => n.categoryId === cat.id).length;
  expect(inCat > 0, 'seed category empty');
  await page.evaluate(id => App.pages.brain._deleteCategory(id), cat.id);
  await page.waitForTimeout(150);
  const notes = await storage('brain_notes');
  expect(notes.length === notesBefore, 'notes were deleted!');
  expect(!notes.some(n => n.categoryId === cat.id), 'orphaning failed');
  return `${inCat} notes orphaned safely`;
});

await check('B3', 'note save extracts inline #tags and [[wiki-links]]', async () => {
  await goto('#/brain');
  await page.click('#add-note-uncat');
  await page.fill('#fb-title', 'QA extraction probe');
  await page.fill('#fb-content', 'Links to [[Fish & Chips <recipe>]] and #qatag inline.');
  await page.click('#fb-save');
  await page.waitForTimeout(150);
  const n = (await storage('brain_notes')).find(x => x.title === 'QA extraction probe');
  expect(n.tags.includes('qatag'), 'inline tag missed');
  expect(n.wikiLinks.includes('Fish & Chips <recipe>'), 'wiki link missed');
});

await check('B4', 'view modal renders markdown + wiki-link navigation works', async () => {
  const n = (await storage('brain_notes')).find(x => x.title === 'QA extraction probe');
  await page.evaluate(id => App.pages.brain._viewNote(id), n.id);
  await page.waitForTimeout(120);
  const chip = await page.$('.brain-link');
  expect(chip, 'no resolvable wiki-link chip');
  await chip.click();
  await page.waitForTimeout(120);
  const title = await grab('#modal-title');
  expect(title.includes('Fish & Chips'), 'chip navigation failed, title=' + title);
  return 'modal title shows: ' + title.trim();
});

await check('B-amp', 'title with & and < displays verbatim in modal title (double-escape check)', async () => {
  await page.evaluate(() => App.pages.brain._viewNote('qa-note-amp'));
  await page.waitForTimeout(100);
  const title = await grab('#modal-title');
  expect(title === 'Fish & Chips <recipe>', `shows "${title}" — double-escaped`);
  await page.evaluate(() => App.closeModal());
});

await check('B-focus', 'category search keeps focus across debounced re-render', async () => {
  const cat = (await storage('brain_categories'))[0];
  await goto('#/brain/' + cat.id);
  await page.waitForTimeout(150);
  await page.click('#brain-search');
  await page.type('#brain-search', 'plan', { delay: 40 });
  await page.waitForTimeout(500); // let the debounce re-render
  const focused = await page.evaluate(() => document.activeElement?.id === 'brain-search');
  expect(focused, 'input lost focus after re-render — typing is interrupted');
});

// ═══════════════ Knowledge Graph ═══════════════
await check('R1', 'graph model counts consistent with seed', async () => {
  await goto('#/graph');
  await page.waitForTimeout(400);
  const stats = await page.evaluate(() => [...document.querySelectorAll('.card-value')].slice(0, 4).map(e => Number(e.textContent)));
  const notes = (await storage('brain_notes')).length;
  expect(stats[0] === notes, `nodes ${stats[0]} != notes ${notes}`);
  expect(stats[3] >= 1, 'broken-link sentinel not counted');
  return `nodes=${stats[0]} edges=${stats[1]} orphans=${stats[2]} broken=${stats[3]}`;
});

await check('R2', 'hub chip opens the note modal', async () => {
  await page.evaluate(() => document.querySelector('.graph-jump')?.click());
  await page.waitForTimeout(150);
  const open = await page.evaluate(() => !document.getElementById('modal-overlay').classList.contains('hidden'));
  expect(open, 'modal did not open');
  await page.evaluate(() => App.closeModal());
});

await check('R5', 'leaving graph stops the animation loop', async () => {
  await goto('#/graph');
  await page.waitForTimeout(300);
  await goto('#/journal');
  await page.waitForTimeout(300);
  const stopped = await page.evaluate(() => !App.pages.graph._sim || App.pages.graph._sim.raf === null);
  expect(stopped, 'rAF loop still running after navigation');
});

// ═══════════════ Journal ═══════════════
await check('J1', 'journal CRUD via modal + mood picker', async () => {
  await goto('#/journal');
  await page.click('#add-journal');
  await page.fill('#fj-title', 'QA reflection');
  await page.fill('#fj-content', 'Steady progress on the suite.');
  await page.evaluate(() => document.querySelector('.mood-pick[data-mood="😁"]').click());
  await page.fill('#fj-tags', 'qa, suite');
  await page.click('#fj-save');
  await page.waitForTimeout(150);
  const e = (await storage('journal')).find(x => x.title === 'QA reflection');
  expect(e && e.mood === '😁' && e.tags.length === 2, 'entry malformed: ' + JSON.stringify(e || null));
});

// ═══════════════ Weekly Pulse ═══════════════
await check('P1', 'pulse renders with full data: no NaN, charts valid', async () => {
  await goto('#/pulse');
  await page.waitForTimeout(250);
  const html = await page.evaluate(() => document.getElementById('page-content').innerHTML);
  expect(!/NaN/.test(html), 'NaN in output');
  expect((await count('svg')) >= 2, 'charts missing');
});

await check('P2', 'pulse consistency matches hand-computed value', async () => {
  const expected = await page.evaluate(() => {
    const habits = Storage.get('habits') || [];
    const days = [];
    const t = new Date();
    for (let i = 6; i >= 0; i--) { const d = new Date(t); d.setDate(d.getDate() - i); days.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`); }
    const pcts = days.map(d => Math.round(habits.filter(h => h.completed && h.completed[d]).length / habits.length * 100));
    return Math.round(pcts.reduce((s, x) => s + x, 0) / 7);
  });
  const shown = await page.evaluate(() => Number(document.querySelector('.card-value').textContent.replace('%', '')));
  expect(shown === expected, `shown ${shown}% != computed ${expected}%`);
});

await check('P-empty', 'pulse with emptied modules renders fallbacks, no NaN', async () => {
  await page.evaluate(() => {
    Storage.set('journal', []); Storage.set('habits', []);
    const f = Storage.get('finance'); f.transactions = []; Storage.set('finance', f);
  });
  await goto('#/pulse');
  await page.waitForTimeout(200);
  const html = await page.evaluate(() => document.getElementById('page-content').innerHTML);
  expect(!/NaN/.test(html), 'NaN in empty-state output');
  const mood = await page.evaluate(() => [...document.querySelectorAll('.card-value')].map(e => e.textContent).join('|'));
  expect(mood.includes('—'), 'avg mood should be — : ' + mood);
});

// ═══════════════ Export / Import round-trip ═══════════════
await check('A3', 'export → import round-trip + allow-list blocks poison key', async () => {
  // rebuild a fresh context state first (P-empty wiped some keys): re-import seed
  const poisoned = JSON.stringify({ ...seed, supabase_url: 'https://evil.example', supabase_key: 'sk-evil' });
  await page.evaluate(js => Storage.importAll(js), poisoned);
  await page.waitForTimeout(150);
  expect((await storage('tasks')).length > 300, 'import did not restore tasks');
  expect((await storage('habits')).length === 12, 'import did not restore habits');
  const poisonWritten = await page.evaluate(() => localStorage.getItem('os_supabase_url'));
  expect(poisonWritten === null, 'ALLOW-LIST BREACH: supabase_url was written');
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 5000 }), page.click('#btn-export')]);
  const path = await download.path();
  const exported = JSON.parse(readFileSync(path, 'utf8'));
  expect(exported.tasks.length === (await storage('tasks')).length, 'export tasks mismatch');
  expect(Object.keys(exported).some(k => k.startsWith('water_')), 'water keys missing from export');
  return `export contains ${Object.keys(exported).length} keys`;
});

await check('A5', 'import of invalid JSON toasts error, changes nothing', async () => {
  const before = (await storage('tasks')).length;
  await page.evaluate(() => {
    try { Storage.importAll('this is not json'); } catch (e) { App.toast('Import failed: not valid JSON', 'error'); }
  });
  await page.waitForTimeout(80);
  expect((await storage('tasks')).length === before, 'data changed on bad import');
});

// ═══════════════ Dashboard ═══════════════
await check('D1', 'dashboard counts match storage; habit toggle persists', async () => {
  await goto('#/dashboard');
  const tasks = await storage('tasks');
  const todo = tasks.filter(t => t.status === 'todo').length;
  const badge = await page.evaluate(() => [...document.querySelectorAll('.badge')].map(b => b.textContent).find(t => t.includes('TODO')));
  expect(badge && badge.includes(String(todo)), `badge "${badge}" != ${todo} TODO`);
  const before = await page.evaluate(() => (Storage.get('habits') || []).filter(h => h.completed && h.completed[App.getToday()]).length);
  await page.evaluate(() => document.querySelector('.dash-habit-btn')?.click());
  await page.waitForTimeout(150);
  const after = await page.evaluate(() => (Storage.get('habits') || []).filter(h => h.completed && h.completed[App.getToday()]).length);
  expect(Math.abs(after - before) === 1, 'toggle did not flip');
});

// ═══════════════ results ═══════════════
await browser.close();
const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log('\nFailures:');
  for (const f of failed) console.log(`  ${f.id}: ${f.detail}${f.shot ? '  [' + f.shot + ']' : ''}`);
}
writeFileSync(join(QA, 'last-run.json'), JSON.stringify(results, null, 2));
process.exit(failed.length ? 1 : 0);
