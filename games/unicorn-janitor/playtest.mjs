// Headless playtest for Level 1. The GLB models and bloom can't be visually
// verified in the sandbox (CDN is blocked, WebGL runs under swiftshader), so this
// drives the real game logic through the `window.UJ.step()` deterministic stepper
// and asserts the core loop: boot -> move -> spray-from-the-barrel -> knockback ->
// clean a pile -> XP -> talents. It exists because rAF is throttled to ~2fps in
// headless Chromium, which would stall a wall-clock-driven test.
//
//   run:  python3 -m http.server 8099   (from repo root)
//         node games/unicorn-janitor/playtest.mjs
//
// Paths below are the sandbox's Chromium/Playwright locations; adjust for local runs.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const URL = 'http://127.0.0.1:8099/games/unicorn-janitor/level1.html';
const results = [];
const ok = (name, cond, detail='') => { results.push({name, pass: !!cond, detail}); console.log(`${cond?'PASS':'FAIL'}  ${name}${detail?'  — '+detail:''}`); };

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox','--disable-dev-shm-usage']
});
const page = await browser.newPage();
const errors = [];
page.on('console', m => { if (m.type()==='error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('PAGEERROR: '+e.message));

await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction(() => window.UJ && window.UJ.Player && window.UJ.step, null, { timeout: 20000 });

// pin high quality, start from the menu, fast-forward the intro to 'playing'
await page.evaluate(() => { window.UJ.Settings.quality='high'; window.UJ.applyQuality?.(); });
await page.click('#startBtn');
await page.evaluate(() => window.UJ.skipIntro());
// the intro→playing flip happens inside the (throttled) rAF tick; give it real time
await page.waitForFunction(() => window.UJ.Game.state === 'playing', null, { timeout: 8000 }).catch(()=>{});
const state = await page.evaluate(() => window.UJ.Game.state);
ok('game reaches the playing state', state === 'playing', `state=${state}`);

// from here we drive frames deterministically via UJ.step — no dependence on rAF.
// grant the hose (a tutorial pickup) so spray mechanics are exercisable.
await page.evaluate(() => { window.UJ.Player.hasHorn = true; });

// 1. The stepper advances game state (sanity that our driver works)
const stepped = await page.evaluate(() => {
  const p0 = window.UJ.Player.pos.clone();
  window.UJ.Input.keys['KeyW'] = true;                 // walk forward
  for (let i=0;i<20;i++) window.UJ.step(0.03);
  window.UJ.Input.keys['KeyW'] = false;
  return window.UJ.Player.pos.distanceTo(p0);
});
ok('player moves when driven (WASD + stepper)', stepped > 0.1, `moved ${stepped.toFixed(2)}m over 20 frames`);

// 2. WATER FROM THE BARREL, NOT THE CHEST — the headless proof of the user's fix.
const spray = await page.evaluate(() => {
  const UJ = window.UJ;
  UJ.Input.spray = true;
  for (let i=0;i<20;i++) UJ.step(0.03);   // ~0.6s of spray, deterministic
  const H = UJ.HoseFX;
  const nozzle = UJ.nozzleWorldPos();
  const chest = UJ.Player.pos.clone(); chest.y += 1.1;
  const idx = H.idx;
  const px = H.pos[idx*3], py = H.pos[idx*3+1], pz = H.pos[idx*3+2];
  UJ.Input.spray = false;
  const dist = (ax,ay,az,b) => Math.hypot(ax-b.x, ay-b.y, az-b.z);
  return {
    muzzle: [H.muzzle.position.x, H.muzzle.position.y, H.muzzle.position.z],
    nozzle: [nozzle.x, nozzle.y, nozzle.z],
    particle: [px, py, pz],
    dToNozzle: dist(px,py,pz, {x:nozzle.x,y:nozzle.y,z:nozzle.z}),
    dToChest: dist(px,py,pz, chest),
  };
});
// a fresh particle is ≤1 frame downstream of a 34 m/s jet (~1.0 m) — so it must be
// nearer the nozzle than the chest AND within one frame's travel of the muzzle.
ok('spray particle originates at the barrel muzzle, not the chest',
   spray.dToNozzle < 1.5 && spray.dToNozzle < spray.dToChest,
   `dist→nozzle ${spray.dToNozzle.toFixed(2)}  dist→chest ${spray.dToChest.toFixed(2)}  nozzle=[${spray.nozzle.map(n=>n.toFixed(2))}]`);

// 3. Muzzle flash sprite rides the barrel while firing
ok('muzzle flash sprite sits at the nozzle',
   Math.hypot(spray.muzzle[0]-spray.nozzle[0], spray.muzzle[1]-spray.nozzle[1], spray.muzzle[2]-spray.nozzle[2]) < 0.6,
   `Δ ${Math.hypot(spray.muzzle[0]-spray.nozzle[0], spray.muzzle[1]-spray.nozzle[1], spray.muzzle[2]-spray.nozzle[2]).toFixed(2)}`);

// 4. Knockback — place a zombie on the aim ray and hose it; it must net backward.
const knock = await page.evaluate(() => {
  const UJ = window.UJ, P = UJ.Player;
  // spawn a chaser at 5 m — beyond the 3.2 m windup range, so it stays in 'chase'
  // where knockback (3.6/s) outpaces chase (2.9/s) and it must net backward.
  P.yaw = Math.PI; P.pitch = 0;
  for (let i=0;i<5;i++) UJ.step(0.03);          // settle the camera behind the player
  const a = P.aim, len = Math.hypot(a.x, a.z) || 1;
  const zpos = { x: P.pos.x + (a.x/len)*5, z: P.pos.z + (a.z/len)*5 };
  const z = UJ.spawnZombieAt(zpos.x, zpos.z);
  UJ.step(0.03);
  const before = z.group.position.distanceTo(P.pos);
  let hitRegistered = false, everLunged = false;
  UJ.Input.spray = true;
  for (let i=0;i<15;i++) {
    const zp = z.group.position; UJ.aimAt(zp.x, zp.y + 1.2, zp.z); // track the zombie
    UJ.step(0.03);
    if (UJ.HoseFX.light.intensity > 0) hitRegistered = true;
    if (z.state === 'lunge') everLunged = true;
  }
  UJ.Input.spray = false;
  const after = z.group.position.distanceTo(P.pos);
  return { before, after, alive: z.alive, hitRegistered, everLunged, state: z.state };
});
ok('hosing a chasing zombie pushes it back (integration)',
   knock.after > knock.before && knock.hitRegistered,
   `dist ${knock.before.toFixed(2)} → ${knock.after.toFixed(2)} · sprayHit=${knock.hitRegistered} · state=${knock.state}`);

// 5. Cleaning a poop pile actually reduces its dirt (core objective loop)
const clean = await page.evaluate(() => {
  const UJ = window.UJ, P = UJ.Player;
  // pick a pile within hose reach so the ray can land on it
  const pile = UJ.piles.filter(p => p.alive)
    .sort((a,b) => a.group.position.distanceTo(P.pos) - b.group.position.distanceTo(P.pos))[0];
  if (!pile) return { skipped: true };
  const c = pile.group.position;
  for (let i=0;i<5;i++) UJ.step(0.03);          // settle camera
  const before = pile.dirt;
  UJ.Input.spray = true;
  for (let i=0;i<40;i++) { UJ.aimAt(c.x, c.y + 0.4, c.z); UJ.step(0.03); } // aim from camera at the pile
  UJ.Input.spray = false;
  return { before, after: pile.dirt, dist: c.distanceTo(P.pos) };
});
ok('spraying a poop pile reduces its dirt', clean.skipped || clean.after < clean.before,
   clean.skipped ? 'no live pile' : `dirt ${clean.before?.toFixed(1)} → ${clean.after?.toFixed(1)} (pile ${clean.dist?.toFixed(1)}m away)`);

// 6. XP / progression
const xp = await page.evaluate(() => { const b = window.UJ.RPG?.xp ?? 0; window.UJ.gainXP(50); return { before: b, after: window.UJ.RPG?.xp ?? 0 }; });
ok('gainXP increments RPG progression', xp.after > xp.before, `${xp.before} → ${xp.after}`);

// 7. Talent panel opens/closes
const panel = await page.evaluate(() => {
  const el = document.getElementById('skillOverlay');
  window.UJ.toggleSkillPanel?.(true);  const opened = el && !el.classList.contains('hidden');
  window.UJ.toggleSkillPanel?.(false); const closed = el && el.classList.contains('hidden');
  return { found: !!el, opened, closed };
});
ok('talents/allocation panel opens and closes', panel.found && panel.opened && panel.closed, `open=${panel.opened} close=${panel.closed}`);

// 8. No JS runtime errors (network/CDN tunnel failures are expected in-sandbox and excluded)
const jsErrors = errors.filter(e => !/ERR_TUNNEL_CONNECTION_FAILED|Failed to load resource|net::ERR/.test(e));
ok('no JS runtime errors (CDN/network excluded)', jsErrors.length === 0, jsErrors.slice(0,3).join(' | ') || 'clean');

await browser.close();
const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (errors.length) console.log(`(sandbox network noise, expected: ${errors.length} resource-load failures — CDN blocked)`);
process.exit(failed.length ? 1 : 0);
