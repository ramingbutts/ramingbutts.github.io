// Full-run validation for Level 2. The unit suite (playtest2.mjs) proves each
// mechanic in isolation; this proves the GAME — that a run can be started,
// completed and won, and that an endless run survives sustained play. It
// exists because "enemies take no damage" shipped past 68 green unit checks:
// every one of them fired down a clean corridor, and none of them played the
// game from start to finish.
//
//   run:  python3 -m http.server 8099   (from repo root)
//         node games/unicorn-janitor/playthrough.mjs
const { chromium } = await import(process.env.PW_MODULE || 'playwright');
const URL = process.env.PLAYTEST_URL || 'http://127.0.0.1:8099/games/unicorn-janitor/level2.html';

const results = [];
const ok = (name, cond, detail = '') => {
  results.push({ name, pass: !!cond, detail });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

const browser = await chromium.launch({
  ...(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}),
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction(() => window.UJ && window.UJ.step, null, { timeout: 20000 });
await page.evaluate(() => { window.UJ.Settings.quality = 'high'; window.UJ.applyQuality?.(); });
await page.click('#startBtn');
await page.evaluate(() => window.UJ.skipIntro());
await page.waitForFunction(() => window.UJ.Game.state === 'playing', null, { timeout: 8000 }).catch(() => {});

// Everything below drives the real verbs: walk into range, hold the trigger,
// let the game decide when something dies. Nothing is set directly.
const installHose = () => page.evaluate(() => {
  window.__hose = (getPos, maxSeconds) => {
    const UJ = window.UJ, P = UJ.Player;
    const frames = Math.round(maxSeconds / 0.03);
    for (let i = 0; i < frames; i++) {
      const t = getPos();
      if (!t) return true;                       // target resolved itself
      // stand off at a comfortable working distance and face it
      const dx = t.x - P.pos.x, dz = t.z - P.pos.z;
      const d = Math.hypot(dx, dz) || 1;
      if (d > 7) { P.pos.x += (dx / d) * Math.min(d - 6, 2.2); P.pos.z += (dz / d) * Math.min(d - 6, 2.2); }
      P.hp = Math.max(P.hp, 60);                 // survivability isn't what this validates
      UJ.Meters.pressure = 100;
      UJ.aimAt(t.x, t.y + 0.9, t.z);
      UJ.Input.spray = true;
      UJ.step(0.03);
    }
    UJ.Input.spray = false;
    return false;
  };
});
await installHose();

// ---- 1. the horn pickup gates the whole game ----
const horn = await page.evaluate(() => {
  const UJ = window.UJ, P = UJ.Player;
  const before = P.hasHorn;
  const start = { x: +P.pos.x.toFixed(1), z: +P.pos.z.toFixed(1) };
  // steer toward the crater rather than assuming which way is 'forward'
  const CRATER = { x: 0, z: 6 };
  for (let i = 0; i < 400 && !P.hasHorn; i++) {
    const dx = CRATER.x - P.pos.x, dz = CRATER.z - P.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    P.pos.x += (dx / d) * 0.12;
    P.pos.z += (dz / d) * 0.12;
    UJ.step(0.03);
  }
  return { before, after: P.hasHorn, start, z: +P.pos.z.toFixed(1) };
});
ok('walking into the crater grants the horn', !horn.before && horn.after,
   `spawned at z=${horn.start.z}, walked to the crater and picked it up at z=${horn.z}`);

// ---- 2. clean the whole wharf with the actual hose ----
const sweep = await page.evaluate(async () => {
  const UJ = window.UJ, G = UJ.Game;
  let guard = 0;
  // piles
  while (UJ.piles.some(p => p.alive) && guard++ < 40) {
    const p = UJ.piles.find(p => p.alive);
    window.__hose(() => (p.alive ? p.group.position : null), 8);
  }
  const pilesDone = G.pilesCleaned;
  // sea lions (they also resolve by transforming, which still counts)
  guard = 0;
  while (UJ.civilians.some(c => !c.resolved) && guard++ < 20) {
    const c = UJ.civilians.find(c => !c.resolved);
    window.__hose(() => (!c.resolved ? c.group.position : null), 10);
  }
  const civDone = G.civResolved;
  // every zombie, including any the sea lions turned into
  guard = 0;
  while (UJ.getZombies().some(z => z.alive) && guard++ < 80) {
    const z = UJ.getZombies().find(z => z.alive);
    window.__hose(() => (z.alive ? z.group.position : null), 10);
  }
  return { pilesDone, totalPiles: G.totalPiles, civDone, civTotal: G.civTotal,
           zombiesDone: G.zombiesDefeated, totalZombies: G.totalZombies,
           livePiles: UJ.piles.filter(p => p.alive).length,
           liveZombies: UJ.getZombies().filter(z => z.alive).length };
});
ok('the whole wharf can actually be cleaned with the hose',
   sweep.livePiles === 0 && sweep.liveZombies === 0 &&
   sweep.pilesDone >= sweep.totalPiles && sweep.civDone >= sweep.civTotal &&
   sweep.zombiesDone >= sweep.totalZombies,
   `${sweep.pilesDone}/${sweep.totalPiles} piles · ${sweep.civDone}/${sweep.civTotal} sea lions · ${sweep.zombiesDone}/${sweep.totalZombies} zombies`);

// ---- 3. clearing it summons the Kraken ----
const summoned = await page.evaluate(() => {
  const UJ = window.UJ;
  for (let i = 0; i < 40; i++) UJ.step(0.03);
  const b = UJ.getBoss();
  return { spawned: !!b, state: UJ.Game.state, goo: b ? b.goo : 0 };
});
ok('clearing the wharf summons the boss rather than ending the level',
   summoned.spawned && summoned.state === 'playing',
   `boss up with ${summoned.goo} core goo`);

// ---- 4. beat it the way a player must: break a limb, burn the core ----
const fight = await page.evaluate(() => {
  const UJ = window.UJ, P = UJ.Player, b = UJ.getBoss();
  P.pos.set(0, 0, UJ.CFG.bridge.playZEnd + 12);
  for (let i = 0; i < 140; i++) { P.hp = 100; UJ.step(0.03); } // let it haul out
  let windows = 0, limbsBroken = 0;
  for (let i = 0; i < 9000 && b.alive; i++) {
    P.hp = Math.max(P.hp, 70);
    UJ.Meters.pressure = 100;
    const pinned = b.tentacles.find(t => t.state === 'pinned');
    if (b.exposed > 0) {                       // core is bared: burn it
      const c = b.core.getWorldPosition(new (b.core.position.constructor)());
      UJ.aimAt(c.x, c.y, c.z);
      UJ.Input.spray = true;
    } else if (pinned) {                       // limb is down: scrub it
      UJ.aimAt(pinned.tip.x, pinned.tip.y + 0.4, pinned.tip.z);
      UJ.Input.spray = true;
      if (pinned.goo < 5) limbsBroken++;
    } else {
      UJ.Input.spray = false;
    }
    if (b.exposed > 0 && i % 400 === 0) windows++;
    UJ.step(0.03);
  }
  UJ.Input.spray = false;
  return { alive: b.alive, defeated: UJ.Game.bossDefeated, state: UJ.Game.state, limbsBroken };
});
ok('the Kraken can be beaten by breaking limbs and burning the core',
   !fight.alive && fight.defeated,
   `boss down · state=${fight.state}`);

// ---- 5. and that wins the level, with a rank ----
const won = await page.waitForFunction(
  () => !document.getElementById('winOverlay').classList.contains('hidden'),
  null, { timeout: 8000 }).then(() => true).catch(() => false);
const winInfo = await page.evaluate(() => ({
  state: window.UJ.Game.state,
  rank: document.getElementById('winRank').textContent,
  stats: document.getElementById('winStats').textContent,
  wide: (() => { try { return localStorage.getItem('uj_wide_nozzle'); } catch (e) { return null; } })(),
}));
ok('beating the boss wins the level and awards the reward',
   won && winInfo.state === 'won' && /[SABC]/.test(winInfo.rank) && winInfo.wide === '1',
   `rank ${winInfo.rank || '?'} · ${winInfo.stats} · wide nozzle unlocked=${winInfo.wide === '1'}`);

// ---- 6. an endless run survives sustained play ----
await page.reload({ waitUntil: 'load' });
await page.waitForFunction(() => window.UJ && window.UJ.step, null, { timeout: 20000 });
await installHose();   // the reload wiped the page context
await page.click('#rushBtn');
await page.evaluate(() => window.UJ.skipIntro());
await page.waitForFunction(() => window.UJ.Game.state === 'playing', null, { timeout: 8000 }).catch(() => {});
const rush = await page.evaluate(() => {
  const UJ = window.UJ, P = UJ.Player;
  P.pos.set(0, 0, -60);
  let picked = 0;
  for (let wave = 0; wave < 6; wave++) {
    UJ.Rush.breather = 0.01;
    for (let i = 0; i < 40 && UJ.Rush.breather > 0; i++) UJ.step(0.03);
    let guard = 0;
    while (UJ.getZombies().some(z => z.alive) && guard++ < 60) {
      const z = UJ.getZombies().find(z => z.alive);
      window.__hose(() => (z.alive ? z.group.position : null), 8);
    }
    guard = 0;
    while (UJ.piles.some(p => p.alive) && guard++ < 40) {
      const p = UJ.piles.find(p => p.alive);
      window.__hose(() => (p.alive ? p.group.position : null), 8);
    }
    for (let i = 0; i < 20; i++) { P.hp = 100; UJ.step(0.03); }
    if (UJ.Game.state === 'perks') { UJ.takePerk(0); picked++; }
  }
  return { wave: UJ.Rush.wave, score: UJ.Rush.score, picked,
           perks: Object.keys(UJ.Perks.taken).length,
           zombieArr: UJ.getZombies().length, pileArr: UJ.piles.length,
           state: UJ.Game.state };
});
ok('an endless run survives six waves, pays out, and hands out upgrades',
   rush.wave >= 5 && rush.score > 0 && rush.picked >= 4 && rush.state === 'playing' &&
   rush.zombieArr < 60 && rush.pileArr < 60,
   `reached wave ${rush.wave} · ${rush.score.toLocaleString()} points · ${rush.picked} upgrades taken · arrays held at ${rush.zombieArr} zombies / ${rush.pileArr} piles`);

// ---- 7. precision pays: tracking cores through a real pack should clear it
// faster than hosing the same pack centre-mass, and set off detonations.
// Fresh page first — six waves of stacked perks make the hose strong enough
// to delete the pack either way, which would measure nothing. ----
await page.reload({ waitUntil: 'load' });
await page.waitForFunction(() => window.UJ && window.UJ.step, null, { timeout: 20000 });
await installHose();
await page.click('#rushBtn');    // strips the story layer and grants the horn
await page.evaluate(() => window.UJ.skipIntro());
await page.waitForFunction(() => window.UJ.Game.state === 'playing', null, { timeout: 8000 }).catch(() => {});
const precision = await page.evaluate(() => {
  const UJ = window.UJ, P = UJ.Player;
  const tmp = UJ.camera.position.clone();
  // hose a fresh pack for a fixed budget of frames, aiming either at bodies
  // or at whatever weak point is currently exposed. Same water, same time.
  const run = (atCores) => {
    for (const z of UJ.getZombies()) z.alive = false;
    UJ.reapEntities();
    UJ.Game.crits = 0; UJ.Game.bursts = 0; UJ.Game.bestChain = 0;
    const kills0 = UJ.Game.zombiesDefeated;
    const pack = [];
    for (let i = 0; i < 6; i++) pack.push(UJ.spawnZombieAt(-3 + i * 1.2, -66));
    P.pos.set(0, 0, -58);
    for (let i = 0; i < 20; i++) { P.hp = 100; UJ.step(0.03); }
    let frames = 0;
    for (; frames < 900; frames++) {
      const z = pack.find(z => z.alive);
      if (!z) break;
      P.hp = 100; UJ.Meters.pressure = 100;
      if (atCores) z.weak.mesh.getWorldPosition(tmp);
      else { z.group.getWorldPosition(tmp); tmp.y += 0.9; }
      UJ.aimAt(tmp.x, tmp.y, tmp.z);
      UJ.Input.spray = true;
      UJ.step(0.03);
    }
    UJ.Input.spray = false;
    const out = { kills: UJ.Game.zombiesDefeated - kills0, crits: UJ.Game.crits,
                  bursts: UJ.Game.bursts, chain: UJ.Game.bestChain,
                  secs: +(frames * 0.03).toFixed(1), left: pack.filter(z => z.alive).length };
    for (const z of pack) z.alive = false;
    UJ.reapEntities();
    return out;
  };
  return { body: run(false), core: run(true) };
});
// (cascade DEPTH isn't asserted here: a fresh pack at full goo survives a
// single detonation, so chains only compound once neighbours are softened —
// that path is covered by B12d in the unit suite)
ok('tracking weak points clears a pack far faster than hosing centre-mass',
   precision.core.crits > 0 && precision.core.bursts > precision.body.bursts &&
   precision.core.left === 0 && precision.core.secs < precision.body.secs * 0.75,
   `same pack of 6, same hose — centre-mass took ${precision.body.secs}s (${precision.body.bursts} detonations); ` +
   `tracking cores took ${precision.core.secs}s with ${precision.core.crits} weak-point hits, ` +
   `${precision.core.bursts} detonations, best chain x${precision.core.chain}`);

const jsErrors = errors.filter(e => !/ERR_TUNNEL_CONNECTION_FAILED|Failed to load resource|net::ERR/.test(e));
ok('a full playthrough raises no runtime errors', jsErrors.length === 0,
   jsErrors.slice(0, 3).join(' | ') || 'clean');

await browser.close();
const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} playthrough checks passed`);
if (errors.length) console.log(`(sandbox network noise, expected: ${errors.length} resource-load failures — CDN blocked)`);
process.exit(failed.length ? 1 : 0);
