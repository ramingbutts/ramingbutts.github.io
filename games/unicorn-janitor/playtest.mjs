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
// Environment overrides (all optional — defaults target a standard local setup):
//   PW_MODULE    module specifier for playwright (default: bare 'playwright')
//   PW_CHROMIUM  explicit Chromium executable (default: playwright's bundled one)
//   PLAYTEST_URL page URL (default: http://127.0.0.1:8099/…/level1.html)
// In this repo's sandbox: PW_MODULE=/opt/node22/lib/node_modules/playwright/index.mjs
// and PW_CHROMIUM=/opt/pw-browsers/chromium-1194/chrome-linux/chrome.
const { chromium } = await import(process.env.PW_MODULE || 'playwright');

const URL = process.env.PLAYTEST_URL || 'http://127.0.0.1:8099/games/unicorn-janitor/level1.html';
const results = [];
const ok = (name, cond, detail='') => { results.push({name, pass: !!cond, detail}); console.log(`${cond?'PASS':'FAIL'}  ${name}${detail?'  — '+detail:''}`); };

const browser = await chromium.launch({
  ...(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}),
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

// 5b. JELLY — a sprayed pile quivers (wobble spring) and bursts into chunks
const jelly = await page.evaluate(() => {
  const UJ = window.UJ, P = UJ.Player;
  const pile = UJ.piles.filter(p => p.alive)
    .sort((a,b) => a.group.position.distanceTo(P.pos) - b.group.position.distanceTo(P.pos))[0];
  if (!pile) return { skipped: true };
  pile.dirt = UJ.CFG.pile.dirt; // the earlier check part-drained it — start full
  const c = pile.group.position;
  const bodiesBefore = UJ.physBodies.length;
  let minRatio = 1, maxRatio = 1;
  UJ.Input.spray = true;
  for (let i=0;i<25 && pile.alive;i++) {
    UJ.aimAt(c.x, c.y + 0.4, c.z); UJ.step(0.03);
    const r = pile.group.scale.y / pile.baseScale;
    minRatio = Math.min(minRatio, r); maxRatio = Math.max(maxRatio, r);
  }
  // finish it off to trigger the chunk burst
  let guard = 0;
  while (pile.alive && guard++ < 200) { UJ.aimAt(c.x, c.y + 0.4, c.z); UJ.step(0.03); }
  UJ.Input.spray = false;
  const burst = UJ.physBodies.length - bodiesBefore;
  for (let i=0;i<90;i++) UJ.step(0.03); // let chunks expire
  return { minRatio, maxRatio, burst };
});
ok('sprayed pile quivers like jelly and bursts into physics gobs',
   jelly.skipped || (jelly.minRatio < 0.985 && jelly.burst >= 4),
   jelly.skipped ? 'no pile' : `wobble ratio ${jelly.minRatio.toFixed(3)}–${jelly.maxRatio.toFixed(3)} · +${jelly.burst} chunks on pop`);

// 5c. FLINCH — a hosed zombie shudders (squash + shiver). The spray→clean()
// pathway is already proven end-to-end by the knockback check (sprayHit=true),
// so this drives clean() directly at hose dps and verifies the flinch spring —
// deterministic regardless of what the level puts between camera and target.
const flinch = await page.evaluate(() => {
  const UJ = window.UJ, P = UJ.Player;
  P.hp = 100;
  const z = UJ.spawnZombieAt(P.pos.x + 3, P.pos.z - 20);
  let minScale = 1;
  for (let i=0;i<15;i++) {
    z.clean(UJ.CFG.hose.dps * 0.03, z.group.position); // one hose-frame of damage
    UJ.step(0.03);
    minScale = Math.min(minScale, z.group.scale.y);
  }
  const fl = z.flinch;
  // let it decay: stop hosing, flinch should spring back toward upright
  for (let i=0;i<25;i++) UJ.step(0.03);
  const recovered = z.group.scale.y;
  z.alive = false; z.group.visible = false; // neutralize
  return { minScale, fl, recovered };
});
ok('hosed zombie flinches (body squashes, then springs back)',
   flinch.minScale < 0.95 && flinch.fl > 0.3 && flinch.recovered > 0.99,
   `min scale ${flinch.minScale.toFixed(3)} · flinch ${flinch.fl.toFixed(2)} · recovers to ${flinch.recovered.toFixed(3)}`);

// 5d. PROP WEAPON — a fast-flying prop staggers a zombie it hits
const clobber = await page.evaluate(() => {
  const UJ = window.UJ, P = UJ.Player;
  const z = UJ.spawnZombieAt(P.pos.x + 4, P.pos.z - 20); // far: stays wandering
  const prop = UJ.physBodies.filter(b => b.ttl == null)[0];
  if (!prop) return { skipped: true };
  // tee the prop up next to the zombie and fire it at him
  prop.g.position.set(z.group.position.x - 2.5, 0.5, z.group.position.z);
  prop.vel.set(9, 1, 0); prop.zHitCd = 0;
  let stunned = false;
  for (let i=0;i<25;i++) { UJ.step(0.03); if (z.state === 'stunned') { stunned = true; break; } }
  const goo = z.goo;
  z.alive = false; z.group.visible = false; // neutralize
  return { stunned, goo };
});
ok('fast-flying prop staggers a zombie on impact (physics as a weapon)',
   clobber.skipped || (clobber.stunned && clobber.goo < 100),
   clobber.skipped ? 'no prop' : `stunned=${clobber.stunned} · goo ${clobber.goo}`);

// 5e. CARS — the jet rocks an abandoned car on its suspension
const carRock = await page.evaluate(() => {
  const UJ = window.UJ, P = UJ.Player;
  const car = UJ.cars[0];
  if (!car) return { skipped: true };
  P.pos.set(car.mesh.position.x - 4, 0, car.mesh.position.z);
  for (let i=0;i<25;i++) UJ.step(0.03); // camera settles
  let maxRock = 0;
  UJ.Input.spray = true;
  for (let i=0;i<25;i++) {
    const cp = car.mesh.position; UJ.aimAt(cp.x, 1, cp.z); UJ.step(0.03);
    maxRock = Math.max(maxRock, Math.abs(car.mesh.rotation.z));
  }
  UJ.Input.spray = false;
  for (let i=0;i<60;i++) UJ.step(0.03); // spring settles
  return { maxRock, settled: Math.abs(car.mesh.rotation.z) };
});
ok('water jet rocks an abandoned car on its suspension',
   carRock.skipped || (carRock.maxRock > 0.005 && carRock.settled < carRock.maxRock),
   carRock.skipped ? 'no cars' : `max roll ${carRock.maxRock.toFixed(3)} rad → settles to ${carRock.settled.toFixed(3)}`);

// 6b. PHYSICS — spraying a deck prop blasts it away (rigid-body impulse)
const phys = await page.evaluate(() => {
  const UJ = window.UJ, P = UJ.Player;
  const prop = UJ.physBodies.filter(b => b.ttl == null)
    .sort((a,b) => a.g.position.distanceTo(P.pos) - b.g.position.distanceTo(P.pos))[0];
  if (!prop) return { skipped: true };
  // Park it at a known spot in front of the player. Whichever prop happens to
  // be nearest sits at a different range and angle each run, and the impulse
  // scales with both — that variance made this check flaky (0.5m to 1.4m).
  prop.g.position.set(P.pos.x, prop.restY, P.pos.z - 4);
  prop.vel.set(0, 0, 0); prop.angVel.set(0, 0, 0);
  P.yaw = Math.PI; P.pitch = 0;
  for (let i=0;i<30;i++) UJ.step(0.03);   // settle the camera behind the player
  const p0 = prop.g.position.clone();
  UJ.Input.spray = true;
  for (let i=0;i<25;i++) { const q = prop.g.position; UJ.aimAt(q.x, q.y + 0.3, q.z); UJ.step(0.03); }
  UJ.Input.spray = false;
  for (let i=0;i<30;i++) UJ.step(0.03); // let it fly + settle
  return { moved: prop.g.position.distanceTo(p0), count: UJ.physBodies.length };
});
ok('high-pressure jet sends a physics prop flying', phys.skipped || phys.moved > 0.5,
   phys.skipped ? 'no props found' : `prop moved ${phys.moved.toFixed(2)}m · ${phys.count} bodies simulated`);

// 6c. ARTICULATION — a chasing zombie's shoulder joints swing across steps
const gait = await page.evaluate(() => {
  const UJ = window.UJ, P = UJ.Player;
  const z = UJ.spawnZombieAt(P.pos.x, P.pos.z - 8); // far enough to stay chasing
  const samples = [];
  for (let i=0;i<24;i++) { UJ.step(0.03); if (i % 4 === 0) samples.push(z.arms[0].rotation.x); }
  const range = Math.max(...samples) - Math.min(...samples);
  const feetMove = z.feet && z.feet[0].position.y !== z.feet[1].position.y;
  return { range, feetMove, state: z.state };
});
ok('zombie limbs are articulated (arms swing, feet step)', gait.range > 0.05 && gait.feetMove,
   `shoulder swing range ${gait.range.toFixed(2)} rad · feet independent=${gait.feetMove} · state=${gait.state}`);

// 6d. RAGDOLL — killing a zombie bursts it into physics chunks
const rag = await page.evaluate(() => {
  const UJ = window.UJ;
  const before = UJ.physBodies.length;
  const z = UJ.spawnZombieAt(UJ.Player.pos.x + 2, UJ.Player.pos.z - 3);
  UJ.step(0.03);
  z.clean(10000, z.group.position); // instant kill
  const after = UJ.physBodies.length;
  for (let i=0;i<80;i++) UJ.step(0.03); // chunks bounce, expire, get freed
  return { before, after, settled: UJ.physBodies.length };
});
ok('dead zombie bursts into bouncing ragdoll chunks that expire', rag.after >= rag.before + 5 && rag.settled <= rag.before,
   `bodies ${rag.before} → ${rag.after} on death → ${rag.settled} after cleanup`);

// 6d2. GLB LOCOMOTION — the textured zombie mesh hops, squashes and leans.
// The real GLB can't download here (CDN blocked), so inject a stand-in wrap:
// the animation code only cares that this.glb exists.
const glb = await page.evaluate(() => {
  const UJ = window.UJ, P = UJ.Player;
  const z = UJ.spawnZombieAt(P.pos.x, P.pos.z - 9);
  const GroupClass = P.group.constructor; // THREE.Group via an existing instance
  z.glb = new GroupClass();
  let hops = 0, squashed = false, leaned = false, lastY = 0;
  for (let i = 0; i < 40; i++) {
    UJ.step(0.03);
    if (z.glb.position.y > 0.02 && lastY <= 0.02) hops++;
    lastY = z.glb.position.y;
    if (z.glb.scale.y < 0.98) squashed = true;
    if (z.glb.rotation.x > 0.05) leaned = true;
  }
  const st = z.state;
  z.glb = null;
  return { hops, squashed, leaned, state: st };
});
ok('GLB zombie hops, squashes and leans while hunting', glb.hops >= 2 && glb.squashed && glb.leaned,
   `hops=${glb.hops} squash=${glb.squashed} chaseLean=${glb.leaned} state=${glb.state}`);

// the tests above spawned live chasers — neutralize them and heal Jax so the
// remaining checks don't fail because he got lunge-hugged to death mid-suite
await page.evaluate(() => {
  const UJ = window.UJ;
  UJ.getZombies().forEach(z => { if (z.alive) { z.alive = false; z.group.visible = false; } });
  UJ.Player.hp = 100;
});

// 6d3. Landing squash — jumping and landing compresses the whole body briefly
const land = await page.evaluate(() => {
  const UJ = window.UJ, P = UJ.Player;
  UJ.Input.jumpPressed = true;
  let minScale = 1, airborne = false;
  for (let i = 0; i < 60; i++) {
    UJ.step(0.03);
    if (!P.onGround) airborne = true;
    if (airborne && P.onGround) minScale = Math.min(minScale, P.group.scale.y);
  }
  return { minScale, airborne };
});
ok('landing from a jump squashes the body (impact weight)', land.airborne && land.minScale < 0.95,
   `min body scale ${land.minScale.toFixed(3)} after touchdown`);

// 6e. Jax's head is a live joint — it nods to follow aim pitch
const headAim = await page.evaluate(() => {
  const UJ = window.UJ, P = UJ.Player;
  P.pitch = 0.6; for (let i=0;i<25;i++) UJ.step(0.03);
  const up = P.headG.rotation.x;
  P.pitch = -0.6; for (let i=0;i<25;i++) UJ.step(0.03);
  const down = P.headG.rotation.x;
  P.pitch = 0;
  return { up, down };
});
ok("Jax's head nods with aim pitch (neck joint)", headAim.up < -0.15 && headAim.down > 0.15,
   `look-up rot ${headAim.up.toFixed(2)} · look-down rot ${headAim.down.toFixed(2)}`);

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
