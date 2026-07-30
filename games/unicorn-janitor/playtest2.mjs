// Headless playtest for Level 2 (Fisherman's Wharf), derived from Level 1's. The GLB models and bloom can't be visually
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

const URL = process.env.PLAYTEST_URL || 'http://127.0.0.1:8099/games/unicorn-janitor/level2.html';
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
// level 2 zombies hit harder and the suite spawns many chasers — without
// regular cleanup they kill Jax mid-suite and step() becomes a no-op
await page.evaluate(() => {
  window.__QA_CLEAN = () => {
    const UJ = window.UJ;
    UJ.getZombies().forEach(z => { if (z.alive) { z.alive = false; z.group.visible = false; } });
    // invisible corpses still eat raycasts (Mesh.raycast checks material
    // visibility, not group visibility) — purge them from cleanTargets so
    // later ray-based checks aren't intercepted by test leftovers
    for (let i = UJ.cleanTargets.length - 1; i >= 0; i--) {
      const e = UJ.cleanTargets[i].userData.entity;
      if (e && e.alive === false) UJ.cleanTargets.splice(i, 1);
    }
    UJ.Player.hp = 100;
  };
});

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

await page.evaluate(() => window.__QA_CLEAN());
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
    UJ.Meters.pressure = UJ.maxPressure(); // this checks jelly physics, not the tank
    UJ.aimAt(c.x, c.y + 0.4, c.z); UJ.step(0.03);
    const r = pile.group.scale.y / pile.baseScale;
    minRatio = Math.min(minRatio, r); maxRatio = Math.max(maxRatio, r);
  }
  // finish it off to trigger the chunk burst
  let guard = 0;
  while (pile.alive && guard++ < 200) {
    UJ.Meters.pressure = UJ.maxPressure();
    UJ.aimAt(c.x, c.y + 0.4, c.z); UJ.step(0.03);
  }
  UJ.Input.spray = false;
  const burst = UJ.physBodies.length - bodiesBefore;
  for (let i=0;i<90;i++) UJ.step(0.03); // let chunks expire
  return { minRatio, maxRatio, burst };
});
ok('sprayed pile quivers like jelly and bursts into physics gobs',
   jelly.skipped || (jelly.minRatio < 0.985 && jelly.burst >= 4),
   jelly.skipped ? 'no pile' : `wobble ratio ${jelly.minRatio.toFixed(3)}–${jelly.maxRatio.toFixed(3)} · +${jelly.burst} chunks on pop`);

await page.evaluate(() => window.__QA_CLEAN());
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
  const goo = z.goo, gooBelowMax = z.goo < UJ.CFG.zombie.goo;
  z.alive = false; z.group.visible = false; // neutralize
  return { stunned, goo, gooBelowMax };
});
ok('fast-flying prop staggers a zombie on impact (physics as a weapon)',
   clobber.skipped || (clobber.stunned && clobber.gooBelowMax),
   clobber.skipped ? 'no prop' : `stunned=${clobber.stunned} · goo ${clobber.goo}`);

await page.evaluate(() => window.__QA_CLEAN());
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

await page.evaluate(() => window.__QA_CLEAN());
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

await page.evaluate(() => window.__QA_CLEAN());
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

await page.evaluate(() => window.__QA_CLEAN());
// L2a. WHARF — the 3x pier: 5 sea lions, 20 piles, 14 zombies, 2 bells
const wharf = await page.evaluate(() => ({
  civs: window.UJ.Game.layoutStats.civs,
  piles: window.UJ.Game.layoutStats.piles,
  zombies: window.UJ.CFG.zombie.count,
  bells: window.UJ.bells.length,
  playLen: window.UJ.CFG.bridge.zStart - window.UJ.CFG.bridge.playZEnd,
  width: window.UJ.CFG.bridge.width,
}));
ok('3x wharf layout: 5 sea lions, 20 piles, 14 zombies, 2 bells, 221m pier',
   wharf.civs === 5 && wharf.piles === 20 && wharf.zombies === 14 && wharf.bells === 2 && wharf.playLen === 221 && wharf.width === 26,
   `civs=${wharf.civs} piles=${wharf.piles} zombies=${wharf.zombies} bells=${wharf.bells} · ${wharf.width}x${wharf.playLen}m`);

// L2b. Cleansing an infected sea lion saves it
const rescue = await page.evaluate(() => {
  const UJ = window.UJ;
  const c = UJ.civilians[0];
  const before = UJ.Game.civSaved;
  c.clean(1000, c.group.position);
  return { before, after: UJ.Game.civSaved, resolved: c.resolved };
});
ok('hosing the rot off a sea lion saves it', rescue.after === rescue.before + 1 && rescue.resolved,
   `saved ${rescue.before} → ${rescue.after}`);

await page.evaluate(() => window.__QA_CLEAN());
// L2c. WIDE NOZZLE — spray that MISSES a slim zombie still scrubs it when on
const wide = await page.evaluate(() => {
  const UJ = window.UJ, P = UJ.Player;
  const G = UJ.CFG.zombie.goo;
  const mk = () => { const z = UJ.spawnZombieAt(P.pos.x, P.pos.z - 6); UJ.step(0.03); return z; };
  const sprayBeside = (z) => {
    UJ.Input.spray = true;
    for (let i=0;i<15;i++) { const p = z.group.position; UJ.aimAt(p.x + 1.5, p.y + 1.1, p.z); UJ.step(0.03); }
    UJ.Input.spray = false;
  };
  // control: stock nozzle, aim 1.5m beside the zombie — ray misses, no cleaning
  UJ.setWideNozzle(false);
  const zA = mk(); sprayBeside(zA);
  const stockGoo = zA.goo;
  zA.alive = false; zA.group.visible = false;
  // reward on: same miss — the fan scrubs it anyway
  UJ.setWideNozzle(true);
  const zB = mk(); sprayBeside(zB);
  const wideGoo = zB.goo;
  zB.alive = false; zB.group.visible = false;
  UJ.setWideNozzle(false);
  window.__QA_CLEAN();
  return { G, stockGoo, wideGoo };
});
ok('wide-nozzle fan scrubs a zombie the ray misses; stock nozzle does not',
   wide.stockGoo >= wide.G - 1 && wide.wideGoo < wide.G - 8,
   `goo after off-aim spray: stock ${wide.stockGoo.toFixed(1)}/${wide.G} vs wide ${wide.wideGoo.toFixed(1)}/${wide.G}`);

await page.evaluate(() => window.__QA_CLEAN());
// L2d. BUILD 2 — washable grime fades as it's hosed and scrubs out for XP
const grime = await page.evaluate(() => {
  const UJ = window.UJ;
  const g = UJ.grimes.find(g => !g.resolved);
  const op0 = g.mesh.material.opacity;
  g.clean(10, g.mesh.position);
  const opMid = g.mesh.material.opacity;
  const xp0 = UJ.RPG.xp;
  g.clean(1000, g.mesh.position);
  return { op0, opMid, resolved: g.resolved, xpGain: UJ.RPG.xp - xp0,
           stillTarget: UJ.cleanTargets.includes(g.mesh) };
});
ok('washable grime fades under the hose and scrubs out for bonus XP',
   grime.opMid < grime.op0 && grime.resolved && grime.xpGain >= 10 && !grime.stillTarget,
   `opacity ${grime.op0.toFixed(2)} → ${grime.opMid.toFixed(2)} → scrubbed · +${grime.xpGain} XP`);

// L2e. BUILD 2 — a burst suds barrel foam-blasts nearby filth and staggers zombies
const suds = await page.evaluate(() => {
  const UJ = window.UJ;
  const b = UJ.barrels.find(b => !b.resolved);
  const bp = b.group.position;
  const z = UJ.spawnZombieAt(bp.x - 2, bp.z);
  const g0 = z.goo;
  b.clean(1000, bp);
  const out = { burst: b.resolved, g0, g1: z.goo, stunned: z.state === 'stunned', wet: UJ.wetPatches.length > 0 };
  z.alive = false; z.group.visible = false;
  return out;
});
ok('suds barrel bursts into a foam nova: nearby zombie scrubbed + staggered',
   suds.burst && suds.g1 <= suds.g0 - 79 && suds.stunned && suds.wet,
   `goo ${suds.g0} → ${suds.g1} · stunned=${suds.stunned} · leaves wet deck=${suds.wet}`);

await page.evaluate(() => window.__QA_CLEAN());
// L2f. BUILD 2 — the jet launches a beach ball (feather-light physics toy)
const ball = await page.evaluate(() => {
  const UJ = window.UJ, P = UJ.Player;
  const b = UJ.beachBalls[0];
  b.g.position.set(0, 0.45, -30); b.vel.set(0, 0, 0);
  P.pos.set(0, 0, -25);
  for (let i = 0; i < 70; i++) UJ.step(0.03); // camera settles behind the new spot
  const start = b.g.position.clone();
  UJ.Input.spray = true;
  for (let i = 0; i < 20; i++) { UJ.aimAt(b.g.position.x, b.g.position.y, b.g.position.z); UJ.step(0.03); }
  UJ.Input.spray = false;
  const moved = b.g.position.distanceTo(start);
  const v = b.g.position.clone().sub(UJ.nozzleWorldPos());
  v.y += b.aimY;
  const along = v.dot(P.aim);
  return { moved, speed: b.vel.length(), dbg: {
    state: UJ.Game.state, horn: P.hasHorn, pressure: +UJ.Meters.pressure.toFixed(1),
    along: +along.toFixed(2), off2: +(v.lengthSq() - along * along).toFixed(2),
    ballAt: b.g.position.toArray().map(n => +n.toFixed(1)),
    playerAt: P.pos.toArray().map(n => +n.toFixed(1)),
    aim: P.aim.toArray().map(n => +n.toFixed(2)),
  } };
});
ok('water jet launches a beach ball across the deck', ball.moved > 1.5,
   `ball flew ${ball.moved.toFixed(2)}m (vel ${ball.speed.toFixed(1)} m/s)${ball.moved > 1.5 ? '' : ' · dbg=' + JSON.stringify(ball.dbg)}`);

await page.evaluate(() => window.__QA_CLEAN());
// L2g. BUILD 2 — ringing the harbor bell lures zombies away from the player
const lure = await page.evaluate(() => {
  const UJ = window.UJ, bell = UJ.getBell();
  const z = UJ.spawnZombieAt(0, -52);
  const distTo = () => Math.hypot(z.group.position.x - bell.pos.x, z.group.position.z - bell.pos.z);
  const before = distTo();
  bell.cd = 0; bell.ring();
  const luredNow = z.lureT > 0;
  for (let i = 0; i < 50; i++) UJ.step(0.03);
  const after = distTo();
  const out = { before, after, luredNow };
  z.alive = false; z.group.visible = false;
  return out;
});
ok('harbor bell DING lures a zombie toward the bell', lure.luredNow && lure.after < lure.before - 1.5,
   `dist to bell ${lure.before.toFixed(1)}m → ${lure.after.toFixed(1)}m · lured=${lure.luredNow}`);

await page.evaluate(() => window.__QA_CLEAN());
// L2h. BUILD 2 — a chasing zombie slips on a wet plank patch and eats deck
const slip = await page.evaluate(() => {
  const UJ = window.UJ, P = UJ.Player;
  P.pos.set(0, 0, -40);
  UJ.spawnWetPatch({ x: 0, z: -45.5 });
  const z = UJ.spawnZombieAt(0, -48); // chases the player straight across the patch
  let slipped = false;
  for (let i = 0; i < 80 && !slipped; i++) { UJ.step(0.03); if (z.state === 'stunned') slipped = true; }
  const out = { slipped, z: z.group.position.z.toFixed(1) };
  z.alive = false; z.group.visible = false;
  return out;
});
ok('chasing zombie slips on a wet plank and is briefly stunned', slip.slipped,
   `slipped=${slip.slipped} (stopped at z=${slip.z})`);

// L2i. BUILD 2 — gull bombing run: splat falls, lands, and cleans for bonus XP
const splat = await page.evaluate(() => {
  const UJ = window.UJ;
  const s = UJ.spawnGullSplat(2, -20);
  const fell = s.falling;
  for (let i = 0; i < 40 && s.falling; i++) UJ.step(0.03);
  const landed = !s.falling && UJ.cleanTargets.includes(s.mesh);
  const xp0 = UJ.RPG.xp;
  s.clean(1000, s.mesh.position);
  return { fell, landed, resolved: s.resolved, xpGain: UJ.RPG.xp - xp0 };
});
ok('gull splat falls, lands as a cleanable, and pays bonus XP',
   splat.fell && splat.landed && splat.resolved && splat.xpGain >= 5,
   `fell=${splat.fell} landed=${splat.landed} · +${splat.xpGain} XP`);

// L2j. BUILD 2 — spraying an ambient sea lion makes it bark and hop (throttled)
const bark = await page.evaluate(() => {
  const UJ = window.UJ;
  const s = UJ.ambientSeaLions.find(s => s.ent);
  UJ.Meters.rainbow = 50;
  s.ent.clean(10);
  const hop = s.hop, rb1 = UJ.Meters.rainbow;
  s.ent.clean(10); // inside the 2.5s throttle — must be a no-op
  return { hop, rb1, rb2: UJ.Meters.rainbow };
});
ok('ambient sea lion barks + hops when sprayed (and the bark is throttled)',
   bark.hop === 1 && bark.rb1 === 52 && bark.rb2 === 52,
   `hop=${bark.hop} · rainbow 50 → ${bark.rb1} (throttled repeat: ${bark.rb2})`);

await page.evaluate(() => window.__QA_CLEAN());
// B3a. AIM ASSIST — a near-miss (≤ ~0.7m off-axis) still scrubs; a wide miss doesn't
const assist = await page.evaluate(() => {
  const UJ = window.UJ, P = UJ.Player;
  P.pos.set(0, 0, -25);
  // clear the firing lane. A wandering zombie drifting into the shot eats the
  // jet outright, which reads as "the assist did nothing" — and since BUILD 12
  // its weak point sticks out past its body, so it blocks from further off
  // axis than it used to. Park anything nearby and put it back afterwards.
  const parked = [];
  for (const z of UJ.getZombies()) {
    if (!z.alive || z.group.position.distanceTo(P.pos) > 22) continue;
    parked.push([z, z.group.position.clone(), z.state]);
    z.group.position.set(0, 0, -140);
    z.setState('wander');
  }
  for (let i = 0; i < 70; i++) UJ.step(0.03); // camera settles
  const trial = (offset) => {
    const s = UJ.spawnGullSplat(0, -31);
    while (s.falling) UJ.step(0.03);
    const d0 = s.dirt;
    UJ.Input.spray = true;
    for (let i = 0; i < 15; i++) { UJ.aimAt(offset, 0.16, -31); UJ.step(0.03); }
    UJ.Input.spray = false;
    const gone = d0 - s.dirt;
    if (!s.resolved) s.clean(1000, s.mesh.position); // tidy up
    return gone;
  };
  const out = { near: trial(0.55), far: trial(1.3) };
  for (const [z, pos, st] of parked) { z.group.position.copy(pos); z.setState(st); }
  return out;
});
ok('soft aim assist: near-miss scrubs at reduced power, wide miss does not',
   assist.near > 2 && assist.far < 0.5,
   `dirt removed — 0.55m off: ${assist.near.toFixed(1)} · 1.3m off: ${assist.far.toFixed(1)}`);

await page.evaluate(() => window.__QA_CLEAN());
// B3b. BEAM GRAZE — the big shot bends into a target ~1m off the beam line
const graze = await page.evaluate(() => {
  const UJ = window.UJ, P = UJ.Player;
  // quiet corner: the pier start has no piles/patches near the beam line, so
  // the graze can't be stolen by a closer target or a wet-plank slip
  P.pos.set(0, 0, 6);
  for (let i = 0; i < 70; i++) UJ.step(0.03); // camera settles
  const z = UJ.spawnZombieAt(0, -2);
  UJ.step(0.03);
  const g0 = z.goo;
  UJ.Meters.rainbow = 100;
  UJ.aimAt(z.group.position.x + 0.9, 0.9, z.group.position.z);
  UJ.Input.beamPressed = true;
  UJ.step(0.03);
  const out = { g0, g1: z.goo, stunned: z.state === 'stunned' };
  z.alive = false; z.group.visible = false;
  return out;
});
ok('beam graze: an off-aim beam bends into the nearby zombie and stuns it',
   graze.g1 <= graze.g0 - 40 && graze.stunned,
   `goo ${graze.g0} → ${graze.g1} · stunned=${graze.stunned}`);

// B3c. RUNNERS — layout ships 2 red-eyed runners; a runner outpaces a normal zombie
const runners = await page.evaluate(() => {
  const UJ = window.UJ, P = UJ.Player;
  const layoutRunners = { length: UJ.Game.layoutStats.runners };
  const zN = UJ.spawnZombieAt(P.pos.x - 2, P.pos.z - 12);
  const zR = UJ.spawnZombieAt(P.pos.x + 2, P.pos.z - 12, { runner: true });
  const n0 = zN.group.position.clone(), r0 = zR.group.position.clone();
  for (let i = 0; i < 30; i++) UJ.step(0.03);
  const out = {
    count: layoutRunners.length, cfg: UJ.CFG.zombie.runners,
    goo: zR.gooMax, cfgGoo: UJ.CFG.zombie.runnerGoo,
    nDist: zN.group.position.distanceTo(n0), rDist: zR.group.position.distanceTo(r0),
  };
  zN.alive = false; zN.group.visible = false;
  zR.alive = false; zR.group.visible = false;
  return out;
});
// The exact count is the layout designer's call and moves whenever the pier
// is re-cut (BUILD 15 re-laid it as a teaching order); what must hold is that
// runners exist, carry less goo, and visibly out-run a shambler.
ok('runner variant: present in the layout, less goo, visibly faster in the chase',
   runners.count >= 2 && runners.goo === runners.cfgGoo && runners.rDist > runners.nDist * 1.25,
   `runners=${runners.count} in the layout · goo ${runners.goo} · chase ${runners.nDist.toFixed(2)}m vs ${runners.rDist.toFixed(2)}m over 0.9s`);

await page.evaluate(() => window.__QA_CLEAN());
// B3d. PILE REGEN — abandoned half-cleaned piles re-fester after a few seconds
const regen = await page.evaluate(() => {
  const UJ = window.UJ;
  const p = UJ.piles.find(p => p.alive);
  p.dirt = UJ.CFG.pile.dirt; // known starting point
  p.clean(40, p.group.position);
  const after = p.dirt;
  for (let i = 0; i < 220; i++) UJ.step(0.03); // 6.6s idle > 4s delay
  return { after, regrown: p.dirt, cap: UJ.CFG.pile.dirt };
});
ok('half-cleaned pile slowly regrows once abandoned', regen.regrown > regen.after + 4 && regen.regrown <= regen.cap,
   `dirt ${regen.after.toFixed(1)} → ${regen.regrown.toFixed(1)} after 6.6s idle (cap ${regen.cap})`);

// B3e. CLIMAX — at 80% piles the horde wakes AND two runner reinforcements storm in
const climax = await page.evaluate(() => {
  const UJ = window.UJ, G = UJ.Game;
  const saved = G.pilesCleaned;
  const before = G.totalZombies;
  G.pilesCleaned = Math.ceil(G.totalPiles * 0.8);
  UJ.maybeTriggerClimax();
  G.pilesCleaned = saved;
  const fresh = UJ.getZombies().slice(-2);
  const out = { before, after: G.totalZombies,
    bothRunners: fresh.every(z => z.runner && z.alive && z.state === 'chase') };
  fresh.forEach(z => { z.alive = false; z.group.visible = false; });
  return out;
});
ok('climax spawns two chasing runner reinforcements', climax.after === climax.before + 2 && climax.bothRunners,
   `totalZombies ${climax.before} → ${climax.after} · reinforcements are runners=${climax.bothRunners}`);

await page.evaluate(() => window.__QA_CLEAN());
// B3f. LOOK SENSITIVITY — the settings slider scales look speed linearly
const sens = await page.evaluate(() => {
  const UJ = window.UJ, P = UJ.Player;
  UJ.Settings.sens = 1;
  UJ.Input.lookDX = 200; const y0 = P.yaw; UJ.step(0.03);
  const d1 = Math.abs(P.yaw - y0);
  UJ.Settings.sens = 2;
  UJ.Input.lookDX = 200; const y1 = P.yaw; UJ.step(0.03);
  const d2 = Math.abs(P.yaw - y1);
  UJ.Settings.sens = 1;
  return { d1, d2 };
});
ok('look-sensitivity setting scales turn speed (2× ≈ double)',
   sens.d1 > 0 && Math.abs(sens.d2 - 2 * sens.d1) < sens.d1 * 0.1,
   `yaw delta ${sens.d1.toFixed(4)} → ${sens.d2.toFixed(4)} at 2×`);

// a sea lion may have transformed into a live zombie during the long idle
// stretches above — clear the field or it kills Jax mid-check (step no-ops)
await page.evaluate(() => window.__QA_CLEAN());
// B3g. TARGET SENSE — the crosshair lights up gold on a cleanable, dims on sky
const senseUI = await page.evaluate(() => {
  const UJ = window.UJ, el = document.getElementById('crosshair');
  // pick an UNTOUCHED pile: a partly-cleaned one has shrunk (baseScale falls
  // with dirt), so a fixed aim height sails over it and the check goes flaky
  const p = UJ.piles.find(p => p.alive && p.dirt >= UJ.CFG.pile.dirt - 1) || UJ.piles.find(p => p.alive);
  UJ.Player.pos.set(p.group.position.x, 0, p.group.position.z + 8); // within hose range
  // re-aim every step: the third-person camera swings for ~2s after a big
  // aim change, and aimAt computes from the camera's current position
  for (let i = 0; i < 70; i++) { UJ.aimAt(p.group.position.x, 0.7, p.group.position.z); UJ.step(0.03); }
  // BUILD 12 split the confirmation in two: gold on a body, cyan on a weak
  // point. Either one is "the jet would land on something".
  const lit = () => el.classList.contains('onTarget') || el.classList.contains('onCore');
  const onTarget = lit();
  for (let i = 0; i < 70; i++) { UJ.aimAt(UJ.Player.pos.x, 60, UJ.Player.pos.z - 2); UJ.step(0.03); } // at the sky
  const offTarget = lit();
  return { onTarget, offTarget, dbg: {
    state: UJ.Game.state, hp: UJ.Player.hp, pileAlive: p.alive,
    dist: +p.group.position.distanceTo(UJ.Player.pos).toFixed(1),
    targets: UJ.cleanTargets.length, cls: el.className,
  } };
});
ok('crosshair target-sense: gold on a cleanable, off against the sky',
   senseUI.onTarget && !senseUI.offTarget,
   `on=${senseUI.onTarget} off=${senseUI.offTarget}` + (senseUI.onTarget ? '' : ' · dbg=' + JSON.stringify(senseUI.dbg)));

await page.evaluate(() => window.__QA_CLEAN());
// B4a. PLAYER MOMENTUM — velocity ramps up under input and coasts to a stop
const momentum = await page.evaluate(() => {
  const UJ = window.UJ, P = UJ.Player;
  P.hvel.set(0, 0, 0);
  UJ.Input.keys.KeyW = true;
  for (let i = 0; i < 2; i++) UJ.step(0.03);
  const early = P.hvel.length();
  for (let i = 0; i < 20; i++) UJ.step(0.03);
  const cruise = P.hvel.length();
  UJ.Input.keys.KeyW = false;
  for (let i = 0; i < 20; i++) UJ.step(0.03);
  const stopped = P.hvel.length();
  return { early, cruise, stopped };
});
ok('player momentum: speed ramps up, cruises, and coasts to a stop',
   momentum.early > 0.5 && momentum.cruise > momentum.early * 1.5 && momentum.stopped < 0.3,
   `speed ${momentum.early.toFixed(1)} → ${momentum.cruise.toFixed(1)} m/s → ${momentum.stopped.toFixed(2)} after release`);

// B4b. ZOMBIE STEERING — heading turns at a capped rate (arcs, not snap pivots)
const steer = await page.evaluate(() => {
  const UJ = window.UJ, P = UJ.Player;
  const z = UJ.spawnZombieAt(P.pos.x, P.pos.z - 10);
  z.heading += Math.PI; // force him to face dead away from his prey
  const cap = UJ.CFG.zombie.turnRate * (z.runner ? 1.4 : 1) * 0.03 + 1e-6;
  let maxStep = 0, prev = z.heading;
  for (let i = 0; i < 60; i++) {
    UJ.step(0.03);
    let d = z.heading - prev;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    maxStep = Math.max(maxStep, Math.abs(d));
    prev = z.heading;
  }
  // after ~2s he should have carved around to face the player again
  const want = Math.atan2(P.pos.x - z.group.position.x, P.pos.z - z.group.position.z);
  let err = want - z.heading;
  err = Math.atan2(Math.sin(err), Math.cos(err));
  const out = { maxStep, cap, aligned: Math.abs(err) };
  z.alive = false; z.group.visible = false;
  return out;
});
ok('zombie steering: turn rate is capped per-frame and converges on the target',
   steer.maxStep <= steer.cap * 1.05 && steer.aligned < 0.5,
   `max per-frame turn ${steer.maxStep.toFixed(3)} rad (cap ${steer.cap.toFixed(3)}) · final aim error ${steer.aligned.toFixed(2)} rad`);

// B4c. CROWD SEPARATION — two zombies dropped on the same spot shoulder apart
const sep = await page.evaluate(() => {
  const UJ = window.UJ, P = UJ.Player;
  const a = UJ.spawnZombieAt(P.pos.x + 1, P.pos.z - 8);
  const b = UJ.spawnZombieAt(P.pos.x + 1, P.pos.z - 8);
  for (let i = 0; i < 20; i++) UJ.step(0.03);
  const d = a.group.position.distanceTo(b.group.position);
  a.alive = false; a.group.visible = false;
  b.alive = false; b.group.visible = false;
  return { d };
});
ok('crowd separation: stacked zombies shoulder each other apart', sep.d > 0.6,
   `spawned overlapping → ${sep.d.toFixed(2)}m apart after 0.6s`);

await page.evaluate(() => window.__QA_CLEAN());
// B5a. CAMERA BOOM COLLISION — a shop wall behind Jax pulls the lens in
const boom = await page.evaluate(() => {
  const UJ = window.UJ, P = UJ.Player;
  const settle = (x, z) => {
    P.pos.set(x, 0, z);
    P.yaw = Math.PI / 2; P.pitch = 0; // face +x, so the boom swings out over -x
    P.hvel.set(0, 0, 0); P.firing = false; P._aimT = 0; P.shake = 0;
    UJ.camera.position.set(x, 2.5, z);
    for (let i = 0; i < 90; i++) UJ.step(0.03);
    const head = { x: P.pos.x, y: P.pos.y + 1.9, z: P.pos.z };
    return { arm: Math.hypot(UJ.camera.position.x - head.x, UJ.camera.position.y - head.y,
                             UJ.camera.position.z - head.z), camX: UJ.camera.position.x };
  };
  const open = settle(-11, -33);  // clear stretch between two shops
  const wall = settle(-11, -24);  // shop hull spans z -29.5..-18.5 at x -19.2..-13.2
  return { open, wall, blockers: UJ.camBlockers.length };
});
ok('camera boom collides: a shop wall shortens the arm instead of clipping through',
   boom.open.arm > 4.5 && boom.wall.arm < boom.open.arm - 1 && boom.wall.camX > -13.3,
   `arm ${boom.open.arm.toFixed(2)}m in the open → ${boom.wall.arm.toFixed(2)}m at the wall · lens x ${boom.wall.camX.toFixed(2)} (hull face -13.2) · ${boom.blockers} blockers`);

// B5b. SHOULDER AIM — firing slides the lens off-axis so Jax stops eclipsing the crosshair
const shoulder = await page.evaluate(() => {
  const UJ = window.UJ, P = UJ.Player;
  P.pos.set(0, 0, -33); P.yaw = Math.PI; P.pitch = 0; P.hvel.set(0, 0, 0); P.shake = 0;
  const lateral = () => { // perpendicular distance from the head-aim line
    const hx = P.pos.x, hz = P.pos.z;
    const dx = UJ.camera.position.x - hx, dz = UJ.camera.position.z - hz;
    const along = dx * P.aim.x + dz * P.aim.z;
    return Math.hypot(dx - P.aim.x * along, dz - P.aim.z * along);
  };
  P.firing = false; P._aimT = 0;
  for (let i = 0; i < 90; i++) UJ.step(0.03);
  const hip = lateral();
  UJ.Input.spray = true;
  for (let i = 0; i < 60; i++) UJ.step(0.03);
  const aimed = lateral();
  UJ.Input.spray = false;
  return { hip, aimed, aimT: P._aimT };
});
ok('over-the-shoulder aim: the lens slides wider while spraying',
   shoulder.aimed > shoulder.hip + 0.25 && shoulder.aimT > 0.8,
   `lateral offset ${shoulder.hip.toFixed(2)}m → ${shoulder.aimed.toFixed(2)}m (aim blend ${shoulder.aimT.toFixed(2)})`);

// B5c. TRAUMA SHAKE — impacts roll the lens, then decay cleanly to zero
const shake = await page.evaluate(() => {
  const UJ = window.UJ, P = UJ.Player;
  P.shake = 0.7;
  let maxRoll = 0;
  for (let i = 0; i < 8; i++) { UJ.step(0.03); maxRoll = Math.max(maxRoll, Math.abs(UJ.camera.rotation.z)); }
  for (let i = 0; i < 40; i++) UJ.step(0.03); // ride it out
  return { maxRoll, rest: Math.abs(UJ.camera.rotation.z), trauma: P.shake };
});
ok('trauma shake rolls the camera on impact and settles back to level',
   shake.maxRoll > 0.004 && shake.trauma === 0 && shake.rest < 0.002,
   `peak roll ${shake.maxRoll.toFixed(4)} rad → rest ${shake.rest.toFixed(4)} · trauma drained to ${shake.trauma}`);

await page.evaluate(() => window.__QA_CLEAN());
// B5d. COMPASS — an objective dead ahead sits centred, one behind clamps to an edge
const compass = await page.evaluate(() => {
  const UJ = window.UJ, P = UJ.Player;
  const pile = UJ.piles.find(p => p.alive);
  const pp = pile.group.position;
  P.pos.set(pp.x, 0, pp.z + 14);            // stand 14m away...
  P.yaw = Math.atan2(pp.x - P.pos.x, pp.z - P.pos.z); // ...looking right at it
  UJ.updateCompass();
  const ahead = UJ.compassPool.find(el => el.style.opacity === '1' && el.firstChild.textContent.includes('💩'));
  const aheadLeft = ahead ? parseFloat(ahead.style.left) : -1;
  const label = ahead ? ahead.lastChild.textContent : '';
  P.yaw += Math.PI;                          // turn our back on it
  UJ.updateCompass();
  const behind = UJ.compassPool.find(el => el.style.opacity === '1' && el.firstChild.textContent.includes('💩'));
  const behindLeft = behind ? parseFloat(behind.style.left) : -1;
  const edge = behind ? behind.classList.contains('edge') : false;
  // and the bearing helper itself: a point off the player's right reads positive
  const right = UJ.screenBearing({ x: P.pos.x - 5, y: 0, z: P.pos.z + 10 });
  P.yaw = 0;
  return { aheadLeft, label, behindLeft, edge, rightSign: right };
});
ok('compass: objectives track by bearing, off-screen ones clamp to the edge',
   Math.abs(compass.aheadLeft - 50) < 8 && compass.label === '14m' &&
   (compass.behindLeft <= 2 || compass.behindLeft >= 98) && compass.edge,
   `dead ahead ${compass.aheadLeft.toFixed(1)}% "${compass.label}" · behind ${compass.behindLeft.toFixed(1)}% edge=${compass.edge}`);

// B5e. DAMAGE DIRECTION — a hit from the right paints the arc at ~90°
const dmgDir = await page.evaluate(() => {
  const UJ = window.UJ, P = UJ.Player;
  P.yaw = 0;
  UJ.dmgArcs.forEach(a => { a.life = 0; a.el.style.opacity = 0; });
  UJ.showDamageFrom({ x: 1, y: 0, z: 0 }); // attacker sits at -x, i.e. screen-right
  const a = UJ.dmgArcs[0];
  const deg = parseFloat((a.el.style.transform.match(/-?[\d.]+/) || [NaN])[0]);
  UJ.updateDamageArcs(0.05);
  const litOpacity = parseFloat(a.el.style.opacity);
  for (let i = 0; i < 30; i++) UJ.updateDamageArcs(0.05); // 1.5s later
  return { deg, litOpacity, faded: parseFloat(a.el.style.opacity) };
});
ok('damage indicator points at the attacker and fades out',
   Math.abs(dmgDir.deg - 90) < 6 && dmgDir.litOpacity > 0.9 && dmgDir.faded === 0,
   `arc at ${dmgDir.deg.toFixed(1)}° (expected 90°) · opacity ${dmgDir.litOpacity} → ${dmgDir.faded}`);

// B5f. DIFFICULTY — the same hit costs a different amount of HP per preset
const diff = await page.evaluate(() => {
  const UJ = window.UJ, P = UJ.Player;
  const saved = UJ.Settings.difficulty;
  const hit = (mode) => {
    UJ.Settings.difficulty = mode;
    P.hp = 100;
    UJ.damagePlayer(20, { x: 0, y: 0, z: 1 });
    return 100 - P.hp;
  };
  const out = { story: hit('story'), normal: hit('normal'), nightmare: hit('nightmare') };
  UJ.Settings.difficulty = saved;
  P.hp = 100;
  return out;
});
ok('difficulty presets scale incoming damage', diff.story === 10 && diff.normal === 20 && diff.nightmare === 32,
   `20 damage lands as ${diff.story} / ${diff.normal} / ${diff.nightmare} HP (story/normal/nightmare)`);

// B5g. UPDATE BUDGET — distant shamblers tick in batches, near ones every frame
const budget = await page.evaluate(() => {
  const UJ = window.UJ, P = UJ.Player;
  P.pos.set(0, 0, -30);
  const near = UJ.spawnZombieAt(0, -38);   // 8m
  const far = UJ.spawnZombieAt(0, -110);   // 80m, past the 55m budget line
  let nearTicks = 0, farTicks = 0;
  const wrap = (z, bump) => { const o = z.update.bind(z); z.update = (dt, t) => { bump(); o(dt, t); }; };
  wrap(near, () => nearTicks++);
  wrap(far, () => farTicks++);
  for (let i = 0; i < 40; i++) UJ.step(0.03); // 1.2s
  near.alive = false; near.group.visible = false;
  far.alive = false; far.group.visible = false;
  return { nearTicks, farTicks };
});
ok('update budget: far-away zombies tick in coarse batches, near ones every frame',
   budget.nearTicks === 40 && budget.farTicks > 0 && budget.farTicks <= 14,
   `over 40 frames — near zombie ${budget.nearTicks} updates, distant ${budget.farTicks}`);

await page.evaluate(() => window.__QA_CLEAN());
// B5h. THREAT MUSIC — the score's intensity rises with hunters and settles after
const threat = await page.evaluate(() => {
  const UJ = window.UJ, P = UJ.Player;
  // the intensity slew is deliberately slow, so let the previous check's
  // chasers wash out before sampling the calm baseline
  for (let i = 0; i < 100; i++) UJ.step(0.03);
  const calm = UJ.getThreat();
  const zs = [UJ.spawnZombieAt(P.pos.x + 3, P.pos.z - 4), UJ.spawnZombieAt(P.pos.x - 3, P.pos.z - 5)];
  for (let i = 0; i < 60; i++) UJ.step(0.03);
  const hunted = UJ.getThreat();
  zs.forEach(z => { z.alive = false; z.group.visible = false; });
  for (let i = 0; i < 90; i++) UJ.step(0.03);
  return { calm, hunted, after: UJ.getThreat() };
});
ok('threat music: intensity swells while hunted and decays once clear',
   threat.calm < 0.1 && threat.hunted > 0.5 && threat.after < threat.hunted * 0.4,
   `intensity ${threat.calm.toFixed(2)} → ${threat.hunted.toFixed(2)} → ${threat.after.toFixed(2)}`);

await page.evaluate(() => window.__QA_CLEAN());
// B6a. HYPE — chaining cleans heats the meter, tiers up, and drops the disco rig
const hype = await page.evaluate(() => {
  const UJ = window.UJ;
  UJ.Hype.heat = 0; UJ.Hype.tier = 0;
  for (let i = 0; i < 5; i++) UJ.step(0.03);
  // the rig is built once and then parked in the fog, so "cold" means
  // stowed out of sight, not absent
  const cold = { tier: UJ.Hype.tier, stowed: !UJ.getDisco() || UJ.getDisco().y > 18 };
  const bloomBase = UJ.bloom.strength;
  // simulate a sustained run: the meter is topped up as fast as it drains
  for (let i = 0; i < 120; i++) { UJ.Hype.heat = 1; UJ.step(0.03); } // let the rig fly in
  const d = UJ.getDisco();
  const hot = { tier: UJ.Hype.tier, name: UJ.HYPE_TIERS[UJ.Hype.tier].name,
                y: d.y, visible: d.g.visible, bloom: UJ.bloom.strength,
                banner: document.getElementById('hypeWrap').classList.contains('on'),
                label: document.getElementById('hypeLabel').textContent };
  UJ.Hype.heat = 0;                          // and let it cool right back down
  for (let i = 0; i < 200; i++) UJ.step(0.03);
  const cooled = { tier: UJ.Hype.tier, y: UJ.getDisco().y, bloom: UJ.bloom.strength };
  return { cold, hot, cooled, bloomBase };
});
ok('hype: chaining tiers up, drops the disco rig and swells the bloom — then packs up',
   hype.cold.tier === 0 && hype.cold.stowed && hype.hot.tier === 3 && hype.hot.visible &&
   hype.hot.y < 12 && hype.hot.bloom > hype.bloomBase && hype.hot.banner &&
   hype.cooled.tier === 0 && hype.cooled.y > 18,
   `tier 0 (rig stowed=${hype.cold.stowed}) → ${hype.hot.tier} (${hype.hot.label}, banner=${hype.hot.banner}) · ball drops to y ${hype.hot.y.toFixed(1)} · bloom ${hype.bloomBase.toFixed(2)} → ${hype.hot.bloom.toFixed(2)} · cools back to tier ${hype.cooled.tier}, ball at y ${hype.cooled.y.toFixed(1)}`);

// B6b. HYPE POWER — a hot streak visibly hits harder
const hypeDmg = await page.evaluate(() => {
  const UJ = window.UJ;
  const at = (heat) => { UJ.Hype.heat = heat; UJ.updateHype(0.001); return UJ.Hype.dmgMul(); };
  const out = { cold: at(0), hot: at(0.95) };
  UJ.Hype.heat = 0; UJ.updateHype(0.001);
  return out;
});
ok('hype multiplies hose power at higher tiers', hypeDmg.cold === 1 && hypeDmg.hot > 1.4,
   `hose multiplier ${hypeDmg.cold.toFixed(2)}× cold → ${hypeDmg.hot.toFixed(2)}× at LEGENDARY`);

await page.evaluate(() => window.__QA_CLEAN());
// B6c. JET BOOST — hosing the deck mid-air rides the recoil upward
const boost = await page.evaluate(() => {
  const UJ = window.UJ, P = UJ.Player;
  const hop = (useJet) => {
    P.pos.set(0, 0, -30); P.vel.y = 0; P.hvel.set(0, 0, 0); P.onGround = true;
    UJ.Meters.pressure = 100;
    P.pitch = -0.9; // straight down at the planks
    UJ.Input.jumpPressed = true;
    UJ.Input.spray = useJet;
    let peak = 0;
    for (let i = 0; i < 45; i++) { UJ.step(0.03); peak = Math.max(peak, P.pos.y); }
    UJ.Input.spray = false;
    const psi = UJ.Meters.pressure;
    for (let i = 0; i < 60; i++) UJ.step(0.03); // land again
    return { peak, psi };
  };
  const plain = hop(false);
  const jet = hop(true);
  P.pitch = 0;
  return { plain, jet };
});
ok('jet boost: spraying downward mid-air lifts Jax far above a plain jump',
   boost.jet.peak > boost.plain.peak + 2 && boost.jet.psi < 40,
   `apex ${boost.plain.peak.toFixed(2)}m jumping → ${boost.jet.peak.toFixed(2)}m on the jet · pressure left ${boost.jet.psi.toFixed(0)}%`);

await page.evaluate(() => window.__QA_CLEAN());
// B6d. STYLE KILLS — finishing airborne pays hype and punches the camera
const style = await page.evaluate(() => {
  const UJ = window.UJ, P = UJ.Player;
  UJ.Hype.heat = 0; P._fovPunch = 0;
  for (let i = 0; i < 120; i++) UJ.step(0.03); // let any running chain expire first
  UJ.Hype.heat = 0; P._fovPunch = 0;
  const z = UJ.spawnZombieAt(P.pos.x + 2, P.pos.z - 6);
  P.onGround = false;              // mid-air finish
  z.clean(9999, z.group.position);
  const air = { heat: UJ.Hype.heat, punch: P._fovPunch };
  P.onGround = true;
  for (let i = 0; i < 120; i++) UJ.step(0.03); // and again, so the control is a clean single kill
  UJ.Hype.heat = 0; P._fovPunch = 0;
  const z2 = UJ.spawnZombieAt(P.pos.x + 2, P.pos.z - 6);
  z2.clean(9999, z2.group.position);
  const plain = { heat: UJ.Hype.heat, punch: P._fovPunch };
  UJ.Hype.heat = 0;
  return { air, plain };
});
ok('style kills: an airborne finish pays extra hype and kicks the lens',
   style.air.heat > style.plain.heat + 0.15 && style.air.punch >= 7 && style.plain.punch < 7,
   `hype gained — airborne ${style.air.heat.toFixed(2)} vs grounded ${style.plain.heat.toFixed(2)} · fov punch ${style.air.punch} vs ${style.plain.punch}`);

await page.evaluate(() => window.__QA_CLEAN());
// B6e. BRUTE — a heavy that shrugs off the jet entirely
const brute = await page.evaluate(() => {
  const UJ = window.UJ, P = UJ.Player;
  const layout = { length: UJ.Game.layoutStats.brutes };
  const b = UJ.spawnZombieAt(P.pos.x, P.pos.z - 8, { brute: true });
  const n = UJ.spawnZombieAt(P.pos.x + 4, P.pos.z - 8);
  const bz = b.group.position.z, nz = n.group.position.z;
  b.push(0.5); n.push(0.5);
  const out = {
    layout: layout.length, cfgBrutes: UJ.CFG.zombie.brutes,
    goo: b.gooMax, cfgGoo: UJ.CFG.zombie.bruteGoo,
    scale: +b.group.scale.x.toFixed(2), slower: b.speedMul < n.speedMul,
    bruteShoved: Math.abs(b.group.position.z - bz), normalShoved: Math.abs(n.group.position.z - nz),
  };
  b.alive = false; b.group.visible = false;
  n.alive = false; n.group.visible = false;
  return out;
});
ok('brute: bigger, tougher, slower, and too heavy for the jet to shove',
   brute.layout === brute.cfgBrutes && brute.goo === brute.cfgGoo && brute.scale > 1.3 &&
   brute.slower && brute.bruteShoved === 0 && brute.normalShoved > 0.5,
   `${brute.layout} in the layout · ${brute.goo} goo · ${brute.scale}× scale · knockback ${brute.bruteShoved.toFixed(2)}m vs a normal zombie's ${brute.normalShoved.toFixed(2)}m`);

await page.evaluate(() => window.__QA_CLEAN());
// B9z. THE BUG THAT BROKE THE GAME: anything in cleanTargets that can't take
// damage used to swallow the whole jet, because only hits[0] was considered.
// One corpse between you and an enemy = zero damage, with no feedback.
const blocker = await page.evaluate(() => {
  const UJ = window.UJ, P = UJ.Player;
  const setup = (leaveCorpse) => {
    UJ.getZombies().forEach(z => { if (z.alive) { z.alive = false; UJ.removeCleanTargets(z.group); z.group.visible = false; } });
    P.pos.set(0, 0, -30); P.yaw = Math.PI; P.pitch = 0;
    if (leaveCorpse) {
      // a dead zombie whose meshes were never unregistered — exactly the state
      // that made the hose useless
      const dead = UJ.spawnZombieAt(0, -38);
      dead.alive = false; dead.group.visible = false;
    }
    const target = UJ.spawnZombieAt(0, -46);
    target.stun(999);
    UJ.Meters.pressure = 100;
    for (let i = 0; i < 45; i++) { UJ.aimAt(0, 1.1, -46); UJ.step(0.03); }
    const g0 = target.goo;
    UJ.Input.spray = true;
    for (let i = 0; i < 25; i++) { UJ.aimAt(0, 1.1, -46); UJ.step(0.03); }
    UJ.Input.spray = false;
    const dmg = +(g0 - target.goo).toFixed(1);
    target.alive = false; target.group.visible = false;
    return dmg;
  };
  const clean = setup(false);
  const throughCorpse = setup(true);
  window.__QA_CLEAN();
  return { clean, throughCorpse };
});
ok('the jet shoots through corpses instead of being swallowed by them',
   blocker.clean > 10 && blocker.throughCorpse > 10,
   `damage to a zombie 16m out — clear line ${blocker.clean}, with a corpse in the way ${blocker.throughCorpse}`);

await page.evaluate(() => window.__QA_CLEAN());
// B9a. TERRAIN — cargo containers are solid ground you can stand on
const terrain = await page.evaluate(() => {
  const UJ = window.UJ, P = UJ.Player;
  // pick a container with nothing stacked on it — BUILD 13 put a second tier
  // on six of them, and landing on a roof you didn't aim for proves nothing
  const covered = (c) => UJ.platforms.some(o => o !== c && o.y > c.y &&
    o.x0 < c.x1 && o.x1 > c.x0 && o.z0 < c.z1 && o.z1 > c.z0);
  const c = UJ.platforms.find(p => p.y > 2 && !covered(p));
  const cx = (c.x0 + c.x1) / 2, cz = (c.z0 + c.z1) / 2;
  const onTop = UJ.groundHeightAt(cx, cz, 10);        // falling from above
  const beside = UJ.groundHeightAt(cx + 9, cz, 10);   // off to the side
  const fromBelow = UJ.groundHeightAt(cx, cz, 0.2);   // jumping up through it
  // and actually land on it
  P.pos.set(cx, c.y + 4, cz); P.vel.y = 0; P.hvel.set(0, 0, 0); P.onGround = false;
  for (let i = 0; i < 60; i++) UJ.step(0.03);
  const rest = { y: +P.pos.y.toFixed(2), onGround: P.onGround };
  P.pos.set(0, 0, -30);
  return { count: UJ.platforms.length, top: c.y, onTop, beside, fromBelow, rest };
});
ok('cargo containers are standable terrain, and you pass up through them',
   terrain.count >= 12 && terrain.onTop === terrain.top && terrain.beside === 0 &&
   terrain.fromBelow === 0 && Math.abs(terrain.rest.y - terrain.top) < 0.05 && terrain.rest.onGround,
   `${terrain.count} platforms · ground on top ${terrain.onTop}m, beside ${terrain.beside}m, from below ${terrain.fromBelow}m · Jax settles at ${terrain.rest.y}m`);

// B9b. BOUNCE PADS — landing on one throws you well above a plain jump
const bounce = await page.evaluate(() => {
  const UJ = window.UJ, P = UJ.Player;
  const pad = UJ.bouncePads[0];
  const apex = (onPad) => {
    // any leftover movement input would drift Jax off a 1.9m pad during the
    // fall, so silence the controls before dropping him
    UJ.Input.keys = {}; UJ.Input.joy.x = 0; UJ.Input.joy.y = 0;
    UJ.Input.gpX = 0; UJ.Input.gpY = 0;
    P.pos.set(onPad ? pad.x : pad.x + 9, 1.6, pad.z);
    P.vel.y = 0; P.hvel.set(0, 0, 0); P.onGround = false;
    // don't gate on seeing onGround — a pad clears that flag in the same
    // frame it fires, so the rebound would never be recorded
    for (let i = 0; i < 14; i++) UJ.step(0.03);   // fall and make contact
    let peak = 0;
    for (let i = 0; i < 80; i++) { UJ.step(0.03); peak = Math.max(peak, P.pos.y); }
    return { peak, drift: +Math.hypot(P.pos.x - pad.x, P.pos.z - pad.z).toFixed(2) };
  };
  const off = apex(false), on = apex(true);
  P.pos.set(0, 0, -30);
  return { off, on, squashed: pad.t > 0 };
});
ok('bounce pads launch Jax far higher than the deck does',
   bounce.on.peak > bounce.off.peak + 3 && bounce.on.peak > 4,
   `rebound apex — plain deck ${bounce.off.peak.toFixed(2)}m vs pad ${bounce.on.peak.toFixed(2)}m (drift on pad ${bounce.on.drift}m)`);

await page.evaluate(() => window.__QA_CLEAN());
/* =====================================================================
   BUILD 13 — THE GROUND POUND
   The level had one offensive verb and a whole vertical layer combat
   never touched. These check the new verb end to end: it arms only with
   real height under you, everything scales off the drop, it flattens
   rather than just damages, the flattened take double, and it detonates
   BUILD 12's chains off the impact.
   ===================================================================== */

// B13a. It arms on height, not on being airborne — a hop must not trigger it
const slamArm = await page.evaluate(() => {
  const UJ = window.UJ, P = UJ.Player;
  UJ.Input.keys = {}; UJ.Input.joy.x = 0; UJ.Input.joy.y = 0;
  const tryAt = (h) => {
    P.pos.set(0, h, -30); P.vel.y = 0; P.hvel.set(0, 0, 0); P.onGround = false;
    P.slamming = false;
    UJ.Input.jumpPressed = true;
    UJ.step(0.016);
    const out = P.slamming;
    P.slamming = false;
    return out;
  };
  const low = tryAt(0.9), high = tryAt(6);
  P.pos.set(0, 0, -30); P.vel.y = 0; P.onGround = true;
  return { low, high, gate: UJ.CFG.slam.minHeight };
});
ok('the slam arms only with real height under you, not on any hop',
   !slamArm.low && slamArm.high,
   `at 0.9m above the deck: ${slamArm.low ? 'armed' : 'no slam'} · at 6m: ${slamArm.high ? 'armed' : 'no slam'} (gate ${slamArm.gate}m)`);

// B13b. Everything scales off the DROP — height is the resource
const slamScale = await page.evaluate(() => {
  const UJ = window.UJ, P = UJ.Player;
  UJ.Input.keys = {}; UJ.Input.joy.x = 0; UJ.Input.joy.y = 0;
  const from = (h) => {
    for (const z of UJ.getZombies()) z.alive = false;
    UJ.reapEntities();
    // a ring of victims at a fixed radius: how many get caught reads the
    // shockwave's reach without having to inspect the number itself
    const ring = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      ring.push(UJ.spawnZombieAt(Math.cos(a) * 5.5, -70 + Math.sin(a) * 5.5));
    }
    const near = UJ.spawnZombieAt(1.2, -70);
    const g0 = near.goo;
    P.pos.set(0, h, -70); P.vel.y = 0; P.hvel.set(0, 0, 0); P.onGround = false;
    P.hp = 100;
    UJ.Input.jumpPressed = true;
    for (let i = 0; i < 120 && !P.onGround; i++) { P.hp = 100; UJ.step(0.03); }
    const out = { dmg: +(g0 - near.goo).toFixed(1),
                  caught: ring.filter(z => z.goo < z.gooMax || !z.alive).length,
                  downed: ring.filter(z => z.state === 'downed').length + (near.state === 'downed' ? 1 : 0) };
    for (const z of [...ring, near]) z.alive = false;
    UJ.reapEntities();
    return out;
  };
  const lowDrop = from(3), highDrop = from(14);
  P.pos.set(0, 0, -30);
  return { lowDrop, highDrop };
});
ok('the slam scales off the drop — a rooftop dive hits harder and wider',
   slamScale.highDrop.dmg > slamScale.lowDrop.dmg * 1.5 &&
   slamScale.highDrop.caught > slamScale.lowDrop.caught &&
   slamScale.lowDrop.dmg > 0,
   `from 3m: ${slamScale.lowDrop.dmg} dmg, ${slamScale.lowDrop.caught}/8 of the ring caught · ` +
   `from 14m: ${slamScale.highDrop.dmg} dmg, ${slamScale.highDrop.caught}/8 caught`);

// B13c. It flattens, and the flattened take double from the hose. This is
// the actual design: the slam sets the table, the hose eats.
const slamDown = await page.evaluate(() => {
  const UJ = window.UJ, P = UJ.Player;
  UJ.Input.keys = {}; UJ.Input.joy.x = 0; UJ.Input.joy.y = 0;
  // a brute: 240 goo, so a 10m pound flattens him without killing him and
  // there is still a live target to measure the vulnerability window on
  const z = UJ.spawnZombieAt(1.5, -70, { brute: true });
  P.pos.set(0, 10, -70); P.vel.y = 0; P.hvel.set(0, 0, 0); P.onGround = false;
  UJ.Input.jumpPressed = true;
  for (let i = 0; i < 120 && !P.onGround; i++) { P.hp = 100; UJ.step(0.03); }
  const flat = z.state === 'downed';
  for (let i = 0; i < 12; i++) UJ.step(0.03);   // let him pitch over
  const pitched = Math.abs(z.group.rotation.x) > 0.4;
  // same hose tick, downed vs upright
  z.goo = z.gooMax; z.clean(50, z.group.position);
  const downedTook = +(z.gooMax - z.goo).toFixed(1);
  z.setState('chase'); z.group.rotation.x = 0;
  z.goo = z.gooMax; z.clean(50, z.group.position);
  const uprightTook = +(z.gooMax - z.goo).toFixed(1);
  // and he gets back up on his own (clear the slam's own timer first —
  // knockdown() takes the MAX, so a fresh short one would be swallowed)
  z.downT = 0; z.setState('chase');
  z.knockdown(0.6);
  for (let i = 0; i < 60; i++) UJ.step(0.03);
  const recovered = z.state !== 'downed' && Math.abs(z.group.rotation.x) < 0.2;
  z.alive = false; UJ.reapEntities();
  P.pos.set(0, 0, -30);
  return { flat, pitched, downedTook, uprightTook, recovered };
});
ok('a slam flattens zombies, doubles what the hose does to them, and they get back up',
   slamDown.flat && slamDown.pitched && slamDown.downedTook === slamDown.uprightTook * 2 && slamDown.recovered,
   `knocked face-down · same 50-point hose tick took ${slamDown.uprightTook} standing vs ${slamDown.downedTook} downed · scrambled up after the timer`);

// B13d. A slam kill detonates, so BUILD 12's chains fire off the impact
const slamChain = await page.evaluate(() => {
  const UJ = window.UJ, P = UJ.Player;
  UJ.Input.keys = {}; UJ.Input.joy.x = 0; UJ.Input.joy.y = 0;
  for (const z of UJ.getZombies()) z.alive = false;
  UJ.reapEntities();
  UJ.Game.bursts = 0; UJ.Game.bestChain = 0; UJ.Game.slams = 0;
  const pack = [];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const z = UJ.spawnZombieAt(Math.cos(a) * 2.4, -70 + Math.sin(a) * 2.4);
    z.goo = 12;              // already worked over: the slam should finish them
    pack.push(z);
  }
  P.pos.set(0, 12, -70); P.vel.y = 0; P.hvel.set(0, 0, 0); P.onGround = false;
  UJ.Input.jumpPressed = true;
  for (let i = 0; i < 140 && !P.onGround; i++) { P.hp = 100; UJ.step(0.03); }
  const out = { killed: pack.filter(z => !z.alive).length, bursts: UJ.Game.bursts,
                chain: UJ.Game.bestChain, slams: UJ.Game.slams };
  for (const z of pack) z.alive = false;
  UJ.reapEntities();
  P.pos.set(0, 0, -30);
  return out;
});
ok('a slam kill detonates, chaining straight into the BUILD 12 goo bursts',
   slamChain.slams === 1 && slamChain.killed === 5 && slamChain.bursts > 0 && slamChain.chain >= 2,
   `one pound wiped a softened pack of ${slamChain.killed} · ${slamChain.bursts} detonations, best chain x${slamChain.chain}`);

// B13e. Slamming onto an awning rebounds higher than landing on one —
// the pad → slam → bigger pad loop
const slamPad = await page.evaluate(() => {
  const UJ = window.UJ, P = UJ.Player;
  UJ.Input.keys = {}; UJ.Input.joy.x = 0; UJ.Input.joy.y = 0;
  UJ.Input.gpX = 0; UJ.Input.gpY = 0;
  const pad = UJ.bouncePads[0];
  const apex = (withSlam) => {
    P.pos.set(pad.x, 6, pad.z); P.vel.y = 0; P.hvel.set(0, 0, 0); P.onGround = false;
    P.slamming = false;
    if (withSlam) UJ.Input.jumpPressed = true;
    // gate on the pad FIRING (upward velocity), not on onGround — the pad
    // clears that flag in the same frame, so an onGround loop runs on past
    // the rebound and ends up measuring a second, ordinary bounce
    let fired = false;
    for (let i = 0; i < 90 && !fired; i++) { UJ.step(0.03); fired = P.vel.y > 1; }
    let peak = P.pos.y;
    for (let i = 0; i < 90; i++) {
      UJ.step(0.03);
      peak = Math.max(peak, P.pos.y);
      if (P.vel.y < 0 && P.pos.y < peak - 0.5) break; // coming down again; stop before the next pad hit
    }
    return +peak.toFixed(2);
  };
  const plain = apex(false), slammed = apex(true);
  P.pos.set(0, 0, -30); P.vel.y = 0; P.onGround = true;
  return { plain, slammed, mult: UJ.CFG.slam.padBoost };
});
ok('slamming onto an awning throws you back higher than simply landing on it',
   slamPad.slammed > slamPad.plain + 1,
   `rebound apex — landed ${slamPad.plain}m vs slammed ${slamPad.slammed}m (pad boost ×${slamPad.mult})`);

// B13f. The wharf grew a second tier worth falling from
const tiers = await page.evaluate(() => {
  const UJ = window.UJ;
  const high = UJ.platforms.filter(p => p.y > 5);
  return { total: UJ.platforms.length, high: high.length,
           tallest: +Math.max(...UJ.platforms.map(p => p.y)).toFixed(1) };
});
ok('the wharf has high ground to dive from, not just crates to stand on',
   tiers.high >= 4 && tiers.tallest >= 5.5,
   `${tiers.total} platforms, ${tiers.high} of them above 5m · tallest roof ${tiers.tallest}m`);

/* =====================================================================
   BUILD 14 — THE STEPPER IS THE FRAME, AND THE FRAME IS READABLE
   Four separate bugs came from tick() and UJ.step() keeping two
   hand-maintained lists of updates. There is one list now (simulate()),
   and these guard the properties that proves.
   ===================================================================== */

// B14a. Transient pools actually drain under the stepper. This is the check
// that would have caught updateGlitter never running headless — a leak that
// quietly poisoned every screenshot and perf number taken in this repo.
const drains = await page.evaluate(async () => {
  const UJ = window.UJ;
  // Quiesce first: a live wharf sprays its own glitter every few frames, so
  // "did MY bursts drain" is only answerable with gameplay parked. 'skills'
  // skips simulate()'s playing branch while the ambient/particle half — the
  // half under test — keeps running, which is exactly the isolation we want.
  const was = UJ.Game.state;
  UJ.Game.state = 'skills';
  for (let i = 0; i < 120; i++) UJ.step(0.03);   // drain whatever was in flight
  const base = { children: UJ.scene.children.length, glitter: UJ.getGlitterLive(),
                 bursts: UJ.bursts.length };
  const pos = UJ.Player.pos.clone().setY(1);
  for (let i = 0; i < 10; i++) UJ.spawnGlitter(pos, 60, 5);
  UJ.spawnSplash(pos, true);
  const peak = { children: UJ.scene.children.length, glitter: UJ.getGlitterLive(), bursts: UJ.bursts.length };
  for (let i = 0; i < 90; i++) UJ.step(0.03);   // 2.7s: everything transient should be gone
  const after = { children: UJ.scene.children.length, glitter: UJ.getGlitterLive(), bursts: UJ.bursts.length };
  UJ.Game.state = was;
  return { base, peak, after };
});
ok('transient particle pools drain under the headless stepper, not just the real frame',
   drains.base.bursts === 0 && drains.peak.bursts === 10 && drains.after.bursts === 0 &&
   drains.after.glitter === 0 && drains.after.children === drains.base.children,
   `10 bursts (${drains.peak.glitter} particles) spawned then fully reaped · ` +
   `scene children ${drains.base.children} → ${drains.peak.children} → ${drains.after.children}`);

// B14b. The glitter budget bounds the worst case: a chain kill asking for
// thousands of additive particles at once gets a picture of a fight back,
// not a flashbang
const glitterCap = await page.evaluate(() => {
  const UJ = window.UJ;
  const was = UJ.Game.state;
  UJ.Game.state = 'skills';                             // park gameplay, see B14a
  for (let i = 0; i < 120; i++) UJ.step(0.03);          // start from a clean pool
  const pos = UJ.Player.pos.clone().setY(1);
  let asked = 0;
  for (let i = 0; i < 20; i++) { asked += 300; UJ.spawnGlitter(pos, 300, 5); }
  const live = UJ.getGlitterLive();
  const smallest = Math.min(...UJ.bursts.map(b => b.n));
  for (let i = 0; i < 90; i++) UJ.step(0.03);
  const drained = UJ.getGlitterLive();
  UJ.Game.state = was;
  return { asked, live, smallest, cap: UJ.GLITTER_BUDGET, drained };
});
// B14c. Feedback hierarchy: one headline at a time, and a lesser beat
// cannot stomp a bigger one
const feedback = await page.evaluate(() => {
  const UJ = window.UJ;
  const texts = UJ.floatTexts;
  texts.length = 0;
  const p = UJ.Player.pos.clone().setY(2);
  const read = () => texts.map(f => ({ key: f.key, pri: f.pri, tier: f.tier,
                                       w: +f.s.scale.x.toFixed(2) }));
  UJ.spawnFloatText(p, 'CHAIN x5', '#9ffcff', { tier: 'headline', pri: 8 });
  const afterChain = read();
  UJ.spawnFloatText(p, 'CRIT!', '#9ffcff', { tier: 'headline', pri: 1 });  // must NOT win
  const afterCrit = read();
  UJ.spawnFloatText(p, 'SKY SLAM!', '#ffd94f', { tier: 'headline', pri: 9 }); // must win
  const afterSlam = read();
  UJ.spawnFloatText(p, '+400 XP', '#ffd94f', { tier: 'ticker', key: 'xp' });
  UJ.spawnFloatText(p, 'COMBO x4', '#ff8fd0', { tier: 'ticker', key: 'combo' });
  const all = read();
  const headlines = all.filter(f => f.tier === 'headline');
  const tickers = all.filter(f => f.tier === 'ticker');
  texts.length = 0;
  return { afterChain, afterCrit, afterSlam, headlines, tickers,
           headlineW: UJ.FLOAT_TIERS.headline.scale[0], tickerW: UJ.FLOAT_TIERS.ticker.scale[0] };
});
ok('one headline at a time, and a small beat cannot displace a big one',
   feedback.headlines.length === 1 && feedback.afterCrit[0].pri === 8 && feedback.afterSlam[0].pri === 9 &&
   feedback.tickers.length === 2 && feedback.tickerW < feedback.headlineW * 0.6,
   `CHAIN x5 held the slot against CRIT! (pri 8 vs 1) and yielded to SKY SLAM! (pri 9) · ` +
   `${feedback.tickers.length} tickers alongside, drawn at ${feedback.tickerW} vs the headline's ${feedback.headlineW}`);

/* =====================================================================
   BUILD 15 — THE ROSTER
   Every enemy used to ask the same question: point at it, hold the
   trigger. These assert that each new kind asks a different one.
   ===================================================================== */

// B15a. SPITTER — never closes, and throws something you can actually dodge
const spitter = await page.evaluate(async () => {
  const UJ = window.UJ, P = UJ.Player;
  UJ.Input.keys = {}; UJ.Input.joy.x = 0; UJ.Input.joy.y = 0;
  for (const z of UJ.getZombies()) z.alive = false;
  UJ.reapEntities();
  UJ.gobs.length = 0;
  P.pos.set(0, 0, -70); P.hp = 100;
  // spawn it right on top of the player: a shambler would lunge, this one
  // should walk away. Measuring from frame zero would just re-measure where
  // it was put, so settle first, then watch.
  const z = UJ.spawnZombieAt(0, -73, { kind: 'spitter' });
  const seen = new Set();
  for (let i = 0; i < 120; i++) { P.hp = 100; UJ.step(0.03); seen.add(z.state); }
  const retreated = +z.group.position.distanceTo(P.pos).toFixed(1);
  let closest = 99, threw = 0;
  for (let i = 0; i < 400; i++) {
    P.hp = 100;                         // survivability isn't what this checks
    UJ.step(0.03);
    seen.add(z.state);
    closest = Math.min(closest, z.group.position.distanceTo(P.pos));
    threw = Math.max(threw, UJ.gobs.length);
  }
  const lunged = seen.has('lunge') || seen.has('windup');
  const standoff = z.spec.standoff;
  // does the gob actually land where the marker says, and can it miss?
  UJ.gobs.length = 0;
  z.setState('spit'); z.stateT = 99;
  UJ.step(0.03);
  const g = UJ.gobs[0];
  const marked = g ? { x: +g.shadow.position.x.toFixed(2), z: +g.shadow.position.z.toFixed(2) } : null;
  let landedNear = false, dodgedHp = 100;
  if (g) {
    P.pos.set(marked.x + 6, 0, marked.z);   // step off the marker: this must miss
    P.hp = 100;
    for (let i = 0; i < 80 && UJ.gobs.length; i++) UJ.step(0.03);
    dodgedHp = P.hp;
    landedNear = true;
  }
  z.alive = false; UJ.reapEntities();
  return { closest: +closest.toFixed(1), standoff, threw, marked, landedNear, dodgedHp,
           retreated, lunged, states: [...seen] };
});
ok('the spitter backs away instead of lunging, and lobs a gob you can walk out from under',
   spitter.threw > 0 && !spitter.lunged && spitter.retreated > 7 &&
   spitter.closest > spitter.standoff - 4 && spitter.marked && spitter.dodgedHp === 100,
   `dropped next to the player it walked out to ${spitter.retreated}m (stand-off ${spitter.standoff}m) ` +
   `and never lunged · states ${spitter.states.join('/')} · threw with a ground marker, ` +
   `and stepping off that marker took 0 damage`);

// B15b. CRUST — armoured from the front, soft from behind, and a slam
// turns the plates skyward
const crust = await page.evaluate(() => {
  const UJ = window.UJ, P = UJ.Player;
  UJ.Input.keys = {};
  const hit = (place) => {
    for (const z of UJ.getZombies()) z.alive = false;
    UJ.reapEntities();
    const z = UJ.spawnZombieAt(0, -70, { kind: 'crust' });
    z.setState('stunned'); z.stunT = 99;
    z.heading = 0; z.group.rotation.y = 0;    // facing +z
    if (place === 'front') P.pos.set(0, 0, -66);   // in front of its face
    else if (place === 'back') P.pos.set(0, 0, -74);
    else { P.pos.set(0, 0, -70.01); z.knockdown(3); }   // pounded flat
    const g0 = z.goo;
    z.clean(60, z.group.position);
    const out = +(g0 - z.goo).toFixed(1);
    z.alive = false; UJ.reapEntities();
    return out;
  };
  const front = hit('front'), back = hit('back'), downed = hit('downed');
  P.pos.set(0, 0, -30);
  return { front, back, downed, armour: UJ.ZKIND.crust.frontArmour };
});
ok('the crust shrugs off a frontal hose and opens up from behind or once pounded flat',
   crust.front < crust.back * 0.3 && crust.downed > crust.back,
   `same 60-point hose tick — head-on ${crust.front}, from behind ${crust.back}, ` +
   `knocked down ${crust.downed} (frontal armour ×${crust.armour})`);

// B15c. BLOATER — a bomb you aim. It hurts the crowd, and it hurts YOU if
// you pop it in your own face
const bloater = await page.evaluate(() => {
  const UJ = window.UJ, P = UJ.Player;
  UJ.Input.keys = {};
  const pop = (playerDist) => {
    for (const z of UJ.getZombies()) z.alive = false;
    UJ.reapEntities();
    const b = UJ.spawnZombieAt(0, -70, { kind: 'bloater' });
    const near = UJ.spawnZombieAt(2.2, -70);
    const far = UJ.spawnZombieAt(0, -84);        // outside the blast
    b.setState('stunned'); b.stunT = 99;
    const swellBefore = b.sac.scale.x;
    b.clean(60, b.group.position);
    UJ.step(0.03);
    const swellHurt = b.sac.scale.x;             // it should visibly inflate
    P.pos.set(0, 0, -70 + playerDist); P.hp = 100;
    b.clean(9999, b.group.position);             // pop it
    const out = { swellBefore: +swellBefore.toFixed(2), swellHurt: +swellHurt.toFixed(2),
                  nearHurt: +(near.gooMax - near.goo).toFixed(1),
                  farHurt: +(far.gooMax - far.goo).toFixed(1), hp: Math.round(P.hp) };
    for (const z of [near, far]) z.alive = false;
    UJ.reapEntities();
    return out;
  };
  const upClose = pop(1.5), atRange = pop(14);
  P.pos.set(0, 0, -30); P.hp = 100;
  return { upClose, atRange, r: UJ.ZKIND.bloater.burstR };
});
ok('the bloater swells as it is hurt, then detonates — on the crowd, and on you',
   bloater.upClose.swellHurt > bloater.upClose.swellBefore * 1.2 &&
   bloater.upClose.nearHurt > 0 && bloater.upClose.farHurt === 0 &&
   bloater.upClose.hp < 100 && bloater.atRange.hp === 100,
   `sac swelled ${bloater.upClose.swellBefore}→${bloater.upClose.swellHurt} · ` +
   `blast (r=${bloater.r}m) took ${bloater.upClose.nearHurt} off a neighbour and nothing off one 14m away · ` +
   `standing in it cost ${100 - bloater.upClose.hp} HP, standing clear cost 0`);

// B15d. The roster is a data table, and the level teaches each kind alone
const roster = await page.evaluate(() => {
  const UJ = window.UJ;
  const L = UJ.Game.layoutStats.kinds;
  // for each new kind, is its FIRST appearance in the layout uncrowded?
  const spots = UJ.Game.layoutStats.firstSpots || null;
  return { kinds: L, all: UJ.ZKINDS, spots };
});
ok('every kind in the table is represented on the pier',
   roster.all.length === 6 && ['spitter','crust','bloater'].every(k => roster.kinds[k] > 0),
   `layout ships ${roster.all.map(k => `${roster.kinds[k]} ${k}`).join(', ')}`);

/* =====================================================================
   BUILD 16 — RESCUE, DAMAGE SPREAD, AND A TREE WORTH FILLING
   ===================================================================== */

// B16a. Cleaning an enemy frees a person: a citizen is left standing, it
// isn't a threat, it holds no raycast targets, and it leaves on its own
const freed = await page.evaluate(() => {
  const UJ = window.UJ, P = UJ.Player;
  UJ.Input.keys = {};
  for (const z of UJ.getZombies()) z.alive = false;
  UJ.reapEntities();
  UJ.cleansed.length = 0;
  const before = UJ.Game.cleansed;
  const targets0 = UJ.cleanTargets.length;
  const kinds = ['shambler', 'brute', 'crust', 'spitter'];
  for (let i = 0; i < kinds.length; i++) {
    const z = UJ.spawnZombieAt(-3 + i * 2, -70, { kind: kinds[i] });
    z.setState('stunned'); z.stunT = 99;
    z.clean(9999, z.group.position);
  }
  UJ.step(0.03);
  const spawned = UJ.cleansed.length;
  const distinctLooks = new Set(UJ.cleansed.map(c => c.kind)).size;
  // is anybody left in the raycast set or the threat list?
  UJ.reapEntities();
  const stillTargets = UJ.cleanTargets.length;
  const liveThreats = UJ.getZombies().filter(z => z.alive).length;
  // do they walk off and clean themselves up?
  let moved = 0;
  const start = UJ.cleansed.map(c => c.g.position.clone());
  for (let i = 0; i < 120; i++) UJ.step(0.03);          // 3.6s: cheer, then walk
  UJ.cleansed.forEach((c, i) => { if (start[i] && c.g.position.distanceTo(start[i]) > 1) moved++; });
  const midCount = UJ.cleansed.length;
  for (let i = 0; i < 140; i++) UJ.step(0.03);          // past their ~6.2s life
  return { spawned, distinctLooks, freed: UJ.Game.cleansed - before,
           stillTargets, targets0, liveThreats, moved, midCount,
           after: UJ.cleansed.length };
});
ok('cleaning an enemy frees a citizen who cheers, walks off, and cleans itself up',
   freed.spawned === 4 && freed.freed === 4 && freed.distinctLooks === 4 &&
   freed.liveThreats === 0 && freed.stillTargets <= freed.targets0 &&
   freed.moved === freed.midCount && freed.after === 0,
   `4 enemies purified → 4 citizens, ${freed.distinctLooks} distinct looks · ` +
   `no threats and no ray targets left behind · all ${freed.moved} walked away and despawned`);

// B16b. Six kinds, six different bites — and the readout names each one
const biteRows = await page.evaluate(() => {
  const UJ = window.UJ, P = UJ.Player;
  const el = document.getElementById('hitReadout');
  const base = UJ.CFG.zombie.damage;
  const rows = UJ.ZKINDS.map(k => {
    P.hp = 100;
    UJ.showHitReadout(base * UJ.ZKIND[k].dmg * UJ.DIFF.dmg(), k);
    return { kind: k, mul: UJ.ZKIND[k].dmg,
             dealt: +(base * UJ.ZKIND[k].dmg).toFixed(1),
             label: el.textContent, sev: el.className };
  });
  P.hp = 100;
  return { rows, gob: UJ.ZKIND.spitter.gobDmg, blast: UJ.ZKIND.bloater.selfDmg };
});
const muls = biteRows.rows.map(r => r.mul);
ok('each kind hits for a different amount, and the readout says which and how much',
   new Set(muls).size === 6 && Math.min(...muls) < 0.6 && Math.max(...muls) > 2 &&
   biteRows.rows.every(r => r.label.includes(r.kind.toUpperCase())) &&
   new Set(biteRows.rows.map(r => r.sev)).size >= 2,
   biteRows.rows.map(r => `${r.kind} ${r.dealt}`).join(' · ') +
   ` · gob ${biteRows.gob} · bloater blast ${biteRows.blast}`);

// B16c. Levelling never stops, and every level pays a point
const curve16 = await page.evaluate(() => {
  const UJ = window.UJ, R = UJ.RPG;
  R.xp = 0; R.level = 1; R.points = 0;
  for (const k in R.ranks) R.ranks[k] = 0;
  const curve = [];
  for (let lv = 2; lv <= 14; lv++) curve.push(R.xpFor(lv));
  UJ.gainXP(200000);                       // an absurd haul: it must still pay
  const out = { level: R.level, points: R.points, curve,
                rising: curve.every((v, i) => i === 0 || v > curve[i - 1]),
                treeTotal: UJ.SKILLS.reduce((a, s) => a + s.max, 0) };
  R.xp = 0; R.level = 1; R.points = 0;
  for (const k in R.ranks) R.ranks[k] = 0;
  UJ.gainXP(0);
  return out;
});
// The tree is deliberately LARGER than any one run can fill — 26 ranks against
// roughly 7 points for a story clear and ~23 for a deep endless run. That is
// the point: you specialise. What had to change is that the old curve stopped
// dead after five thresholds, so five points was the lifetime maximum and most
// XP earned was thrown away.
ok('levelling never stops, and every level pays a point',
   curve16.rising && curve16.level > 20 && curve16.points === curve16.level - 1 &&
   curve16.points > 5 && curve16.treeTotal > curve16.points,
   `curve keeps rising (${curve16.curve[0]} → ${curve16.curve[curve16.curve.length - 1]} XP) · ` +
   `a 200k haul reached level ${curve16.level} for ${curve16.points} points ` +
   `(the old curve capped at 5) · ${curve16.treeTotal}-rank tree, so you specialise`);

// B16d. Every new rank is read at its call site and actually changes the game
const rankWire = await page.evaluate(() => {
  const UJ = window.UJ, R = UJ.RPG;
  const reset = () => { for (const k in R.ranks) R.ranks[k] = 0; };
  reset();
  const base = { tank: UJ.maxPressure(), reach: UJ.NOZZLES[0].range * R.reachMul(),
                 crit: R.critMul(), slam: R.slamMul(), hose: R.hoseMul() };
  R.ranks.tank = 3; R.ranks.reach = 3; R.ranks.crit = 3; R.ranks.slam = 3; R.ranks.power = 5;
  const maxed = { tank: UJ.maxPressure(), reach: UJ.NOZZLES[0].range * R.reachMul(),
                  crit: R.critMul(), slam: R.slamMul(), hose: R.hoseMul() };
  // and the actual slam gets bigger, not just the multiplier
  UJ.Player.pos.set(0, 9, -70); UJ.Player.slamming = true; UJ.Player.slamFrom = 9;
  UJ.landSlam(0);
  const bigRing = UJ.slamRings.length ? UJ.slamRings[UJ.slamRings.length - 1].radius : 0;
  reset();
  UJ.Player.pos.set(0, 9, -70); UJ.Player.slamming = true; UJ.Player.slamFrom = 9;
  UJ.landSlam(0);
  const smallRing = UJ.slamRings.length ? UJ.slamRings[UJ.slamRings.length - 1].radius : 0;
  UJ.Player.pos.set(0, 0, -30); UJ.Player.slamming = false;
  UJ.Meters.pressure = UJ.maxPressure();
  return { base, maxed, bigRing: +bigRing.toFixed(2), smallRing: +smallRing.toFixed(2) };
});
ok('the new ranks are read at their call sites and visibly change the game',
   rankWire.maxed.tank > rankWire.base.tank * 1.7 && rankWire.maxed.reach > rankWire.base.reach * 1.4 &&
   rankWire.maxed.crit > rankWire.base.crit * 2 && rankWire.maxed.hose > rankWire.base.hose * 2 &&
   rankWire.bigRing > rankWire.smallRing * 1.5,
   `tank ${rankWire.base.tank}→${rankWire.maxed.tank} PSI · reach ${rankWire.base.reach}→${rankWire.maxed.reach}m · ` +
   `crit ×${rankWire.base.crit}→×${rankWire.maxed.crit} · hose ×${rankWire.base.hose}→×${rankWire.maxed.hose} · ` +
   `slam shockwave ${rankWire.smallRing}→${rankWire.bigRing}m`);

/* =====================================================================
   BUILD 17 — THE AIM
   The crosshair used to lie by a constant 2.5 degrees, because it is drawn
   at screen centre while the damage ray was cast along Player.aim from a
   camera parked behind one shoulder. These lock the fix down.
   ===================================================================== */

// B17a. The crosshair, the water and the damage all land on the same pixel,
// at every range. This is the measured bug, turned into a guard.
const truthful = await page.evaluate(() => {
  const UJ = window.UJ, P = UJ.Player;
  UJ.Input.keys = {}; P.hasHorn = true;
  for (const z of UJ.getZombies()) z.alive = false; UJ.reapEntities();
  const W = innerWidth, H = innerHeight;
  const rows = [];
  for (const dist of [4, 9, 16, 22]) {
    const z = UJ.spawnZombieAt(0, -40 - dist);
    P.pos.set(0, 0, -40); P.yaw = Math.PI; P.pitch = 0;
    for (let i = 0; i < 70; i++) { P.hp = 100; z.setState('stunned'); z.stunT = 99; UJ.step(0.03); }
    const point = UJ.aimTarget(dist + 14);           // what the reticle resolves to
    const toPx = (v) => { const q = v.clone().project(UJ.camera);
      return [(q.x * 0.5 + 0.5) * W, (-q.y * 0.5 + 0.5) * H]; };
    const [dx, dy] = toPx(point);
    // and where the water is thrown: muzzle -> that same point
    const muzzle = UJ.nozzleWorldPos();
    const jet = point.clone().sub(muzzle).normalize();
    const [wx, wy] = toPx(muzzle.clone().addScaledVector(jet, point.distanceTo(muzzle)));
    rows.push({ dist,
      damagePx: +Math.hypot(dx - W / 2, dy - H / 2).toFixed(1),
      waterPx: +Math.hypot(wx - W / 2, wy - H / 2).toFixed(1) });
    z.alive = false; UJ.reapEntities();
  }
  return rows;
});
ok('the crosshair, the water and the damage converge on the same pixel at every range',
   truthful.every(r => r.damagePx < 2 && r.waterPx < 2),
   truthful.map(r => `${r.dist}m: damage ${r.damagePx}px / water ${r.waterPx}px off centre`).join(' · '));

// B17b. Aiming is now defined by the reticle: whatever sits under the
// crosshair is what takes the hit, even though the lens is off-shoulder
const underReticle = await page.evaluate(() => {
  const UJ = window.UJ, P = UJ.Player;
  UJ.Input.keys = {};
  for (const z of UJ.getZombies()) z.alive = false; UJ.reapEntities();
  // two targets side by side, 1.6m apart at 14m: at 2.5 degrees of error the
  // old aim would have bitten the wrong one
  const left = UJ.spawnZombieAt(-0.8, -54), right = UJ.spawnZombieAt(0.8, -54);
  P.pos.set(0, 0, -40); P.hp = 100;
  const hold = () => { for (const z of [left, right]) { z.setState('stunned'); z.stunT = 99; } };
  const fire = (target) => {
    hold();
    for (let i = 0; i < 12; i++) { hold(); UJ.aimAt(target.group.position.x, 1.15, target.group.position.z); UJ.step(0.03); }
    const before = [left.goo, right.goo];
    for (let i = 0; i < 14; i++) {
      hold(); UJ.Meters.pressure = UJ.maxPressure();
      UJ.aimAt(target.group.position.x, 1.15, target.group.position.z);
      UJ.Input.spray = true; UJ.step(0.03);
    }
    UJ.Input.spray = false;
    return [+(before[0] - left.goo).toFixed(1), +(before[1] - right.goo).toFixed(1)];
  };
  const atLeft = fire(left);
  left.goo = left.gooMax; right.goo = right.gooMax;
  const atRight = fire(right);
  for (const z of [left, right]) z.alive = false;
  UJ.reapEntities();
  return { atLeft, atRight };
});
ok('whatever sits under the crosshair is what takes the hit',
   underReticle.atLeft[0] > underReticle.atLeft[1] * 3 &&
   underReticle.atRight[1] > underReticle.atRight[0] * 3,
   `two targets 1.6m apart at 14m — aiming left dealt ${underReticle.atLeft[0]}/${underReticle.atLeft[1]}, ` +
   `aiming right dealt ${underReticle.atRight[0]}/${underReticle.atRight[1]}`);

// B17c. FOCUS narrows the lens, slows the look, and does NOT buff damage
const focus = await page.evaluate(() => {
  const UJ = window.UJ, P = UJ.Player;
  UJ.Input.keys = {}; UJ.Input.focus = false;
  P.pos.set(0, 0, -40); P.yaw = Math.PI; P.pitch = 0;
  for (let i = 0; i < 60; i++) UJ.step(0.03);
  const relaxed = { fov: +UJ.camera.fov.toFixed(1), t: +UJ.getFocus().toFixed(2) };
  // how far does a fixed look input turn you, relaxed vs braced?
  const sweep = () => {
    const y0 = P.yaw;
    for (let i = 0; i < 20; i++) { UJ.Input.lookDX = 40; UJ.step(0.03); }
    return Math.abs(P.yaw - y0);
  };
  const turnRelaxed = sweep();
  UJ.Input.focus = true;
  for (let i = 0; i < 90; i++) UJ.step(0.03);           // ease in
  const braced = { fov: +UJ.camera.fov.toFixed(1), t: +UJ.getFocus().toFixed(2) };
  const turnBraced = sweep();
  // damage must be untouched: focus is an aiming aid, not a weapon upgrade
  const z = UJ.spawnZombieAt(0, -47);
  z.setState('stunned'); z.stunT = 99;
  // pull the weak point out of the raycast set: it orbits, so leaving it in
  // makes each 10-frame damage sample a coin flip between body and 3x crit,
  // which swamps the thing under test (that focus changes NOTHING about damage)
  const ci = UJ.cleanTargets.indexOf(z.weak.mesh);
  if (ci >= 0) UJ.cleanTargets.splice(ci, 1);
  const dmgAt = () => {
    z.goo = z.gooMax;
    for (let i = 0; i < 10; i++) {
      z.setState('stunned'); z.stunT = 99; UJ.Meters.pressure = UJ.maxPressure();
      UJ.aimAt(z.group.position.x, 1.15, z.group.position.z);
      UJ.Input.spray = true; UJ.step(0.03);
    }
    UJ.Input.spray = false;
    return +(z.gooMax - z.goo).toFixed(1);
  };
  const dmgBraced = dmgAt();
  UJ.Input.focus = false;
  for (let i = 0; i < 90; i++) UJ.step(0.03);
  const dmgRelaxed = dmgAt();
  z.alive = false; UJ.reapEntities();
  return { relaxed, braced, turnRelaxed: +turnRelaxed.toFixed(3), turnBraced: +turnBraced.toFixed(3),
           dmgBraced, dmgRelaxed, focusFov: UJ.CFG.cam.focusFov };
});
ok('focus narrows the lens and slows the look, and buys no extra damage',
   focus.braced.fov < focus.relaxed.fov - 15 && focus.braced.t > 0.9 &&
   focus.turnBraced < focus.turnRelaxed * 0.5 &&
   Math.abs(focus.dmgBraced - focus.dmgRelaxed) < focus.dmgRelaxed * 0.12,
   `FOV ${focus.relaxed.fov}° → ${focus.braced.fov}° · the same look input turns ` +
   `${focus.turnRelaxed} rad relaxed vs ${focus.turnBraced} braced · ` +
   `damage unchanged (${focus.dmgRelaxed} vs ${focus.dmgBraced})`);

// B17d. Sensitivity tracks the lens, so zooming doesn't secretly change it.
// Measured as degrees of view swept per unit of input — the thing your hand
// actually learns — which must stay roughly constant across FOVs.
const fovComp = await page.evaluate(() => {
  const UJ = window.UJ, P = UJ.Player;
  UJ.Input.keys = {}; UJ.Input.focus = false;
  // Isolated on SPRINT (70° → 78°), not focus: focus deliberately stacks an
  // extra 0.45x damping on top of the compensation because braced aiming should
  // be slower in absolute terms (B17c covers that). Sprint changes only the
  // lens, so it measures the compensation and nothing else.
  const sweepFraction = () => {
    const y0 = P.yaw;
    for (let i = 0; i < 15; i++) { UJ.Input.lookDX = 30; UJ.step(0.03); }
    return Math.abs(P.yaw - y0) / (UJ.camera.fov * Math.PI / 180);
  };
  P.pos.set(0, 0, -40); P.yaw = Math.PI; P.pitch = 0;
  for (let i = 0; i < 60; i++) UJ.step(0.03);
  const walkFov = +UJ.camera.fov.toFixed(1);
  const walking = sweepFraction();
  UJ.Input.keys.KeyW = true; UJ.Input.keys.ShiftLeft = true;   // sprint stretches the lens
  for (let i = 0; i < 120; i++) UJ.step(0.03);
  const sprintFov = +UJ.camera.fov.toFixed(1);
  const sprinting = sweepFraction();
  UJ.Input.keys = {};
  for (let i = 0; i < 90; i++) UJ.step(0.03);
  return { walkFov, sprintFov, walking: +walking.toFixed(4), sprinting: +sprinting.toFixed(4) };
});
ok('sensitivity tracks the lens: the same input sweeps the same fraction of the view',
   fovComp.sprintFov > fovComp.walkFov + 4 &&
   Math.abs(fovComp.walking - fovComp.sprinting) < fovComp.walking * 0.06,
   `the same look input sweeps ${fovComp.walking} of a ${fovComp.walkFov}° view and ` +
   `${fovComp.sprinting} of a ${fovComp.sprintFov}° one — uncompensated the wider lens ` +
   `would have swept ${(fovComp.walkFov / fovComp.sprintFov).toFixed(2)}x less`);

// B17e. The stick has a response curve, not a cliff
const stick = await page.evaluate(() => {
  // reproduce the pad curve the poll applies, and check its shape
  const DZ = 0.07, CURVE = 2.4;
  const f = (v) => { const a = Math.abs(v); return a <= DZ ? 0 : Math.sign(v) * Math.pow((a - DZ) / (1 - DZ), CURVE); };
  const pts = [0.05, 0.2, 0.4, 0.6, 0.8, 1].map(v => +f(v).toFixed(3));
  return { pts, deadzone: f(0.05) === 0, full: f(1), fineAtQuarter: f(0.25) };
});
ok('the look stick has a real response curve: fine near centre, full at the edge',
   stick.deadzone && Math.abs(stick.full - 1) < 1e-6 && stick.fineAtQuarter < 0.06 &&
   stick.pts.every((v, i) => i === 0 || v > stick.pts[i - 1]),
   `curve ${stick.pts.join(' → ')} · a quarter-deflection moves at ${(stick.fineAtQuarter * 100).toFixed(1)}% ` +
   `of full speed (linear would be 25%), and full deflection still reaches 100%`);

// B9c. PERKS — upgrades compound and are read at the call site
const perks = await page.evaluate(() => {
  const UJ = window.UJ, P = UJ.Player;
  UJ.Perks.reset();
  const base = { hose: UJ.Perks.hoseMul(), jump: UJ.Perks.jumpMul(), drain: UJ.Perks.drainMul() };
  UJ.Perks.taken = { power: 2, boots: 1, tank: 1 };
  const buffed = { hose: UJ.Perks.hoseMul(), jump: UJ.Perks.jumpMul(), drain: UJ.Perks.drainMul() };
  // measure the launch impulse itself: integrating to an apex is perturbed by
  // terrain, bob and landing squash, and that noise swamped the difference
  const launch = () => {
    P.pos.set(0, 0, -30); P.vel.y = 0; P.hvel.set(0, 0, 0); P.onGround = true;
    UJ.Input.jumpPressed = true;
    UJ.step(0.03);
    return P.vel.y;
  };
  const highJump = launch();
  UJ.Perks.reset();
  const plainJump = launch();
  return { base, buffed, highJump, plainJump };
});
ok('perks stack and take effect at the call site',
   perks.base.hose === 1 && Math.abs(perks.buffed.hose - 1.44) < 0.001 &&
   perks.buffed.jump > 1 && perks.buffed.drain < 1 && perks.highJump > perks.plainJump * 1.1,
   `hose ×${perks.base.hose} → ×${perks.buffed.hose.toFixed(2)} with 2 stacks · jump launch ${perks.plainJump.toFixed(2)} → ${perks.highJump.toFixed(2)} m/s with SPRING BOOTS`);

await page.evaluate(() => window.__QA_CLEAN());
// B8a. NOZZLES — R cycles three genuinely different tools
const nozzles = await page.evaluate(() => {
  const UJ = window.UJ;
  UJ.setNozzle(0);
  const seq = [];
  for (let i = 0; i < 4; i++) { seq.push(UJ.Nozzle().key); UJ.cycleNozzle(1); }
  UJ.setNozzle(0);
  const [jet, blast, lance] = UJ.NOZZLES;
  return { seq, label: document.getElementById('nozzleName').textContent,
    ranges: [jet.range, blast.range, lance.range], drains: [jet.drain, blast.drain, lance.drain] };
});
ok('three nozzles cycle and differ in reach and thirst',
   nozzles.seq.join(',') === 'jet,blast,lance,jet' &&
   nozzles.ranges[1] < nozzles.ranges[0] && nozzles.ranges[2] > nozzles.ranges[0] &&
   nozzles.drains[1] > nozzles.drains[0] && nozzles.drains[2] > nozzles.drains[1],
   `cycle ${nozzles.seq.join('→')} · ranges ${nozzles.ranges.join('/')}m · drain ×${nozzles.drains.join('/×')}`);

await page.evaluate(() => window.__QA_CLEAN());
// B8b. BLAST — a short wide cone scrubs a whole pack; JET only bites one
const blast = await page.evaluate(() => {
  const UJ = window.UJ, P = UJ.Player;
  P.pos.set(0, 0, -40); P.yaw = Math.PI; P.pitch = 0;
  const pack = () => {
    window.__QA_CLEAN(); // also purges dead zombies' meshes from cleanTargets
    return [-2.2, 0, 2.2].map(dx => UJ.spawnZombieAt(P.pos.x + dx, P.pos.z - 5));
  };
  const spray = (mode) => {
    UJ.setNozzle(mode);
    UJ.Meters.pressure = 100; // a drained tank locks the trigger and reads as "no damage"
    const zs = pack();
    zs.forEach(z => { z.stun(30); });          // hold the pack still
    const g0 = zs.map(z => z.goo);
    UJ.Input.spray = true;
    for (let i = 0; i < 25; i++) { UJ.aimAt(P.pos.x, 1.1, P.pos.z - 5); UJ.step(0.03); }
    UJ.Input.spray = false;
    const dmg = zs.map((z, i) => +(g0[i] - z.goo).toFixed(1));
    zs.forEach(z => { z.alive = false; z.group.visible = false; });
    return { hit: dmg.filter(d => d > 1).length, dmg };
  };
  const jetHits = spray(0);
  const blastHits = spray(1);
  UJ.setNozzle(0);
  return { jetHits, blastHits };
});
ok('BLAST scrubs the whole pack in its cone where JET bites one',
   blast.blastHits.hit === 3 && blast.jetHits.hit <= 1,
   `zombies damaged — JET ${blast.jetHits.hit}/3 [${blast.jetHits.dmg}] vs BLAST ${blast.blastHits.hit}/3 [${blast.blastHits.dmg}]`);

await page.evaluate(() => window.__QA_CLEAN());
// B8c. LANCE — pierces through the front target into the one behind it.
// Uses piles, not zombies: a pile is a ~2.6m blob, so the check measures
// piercing rather than whether a 0.55m belly happened to line up with a
// slightly diagonal ray.
const lance = await page.evaluate(() => {
  const UJ = window.UJ, P = UJ.Player;
  P.pos.set(0, 0, -60); P.yaw = Math.PI; P.pitch = 0;
  const pair = () => {
    for (const p of UJ.piles) if (p.alive && Math.abs(p.group.position.z + 68) < 12) {
      p.alive = false; p.group.visible = false;
    }
    const a = new (UJ.piles[0].constructor)(P.pos.x, P.pos.z - 8, 1);
    const b = new (UJ.piles[0].constructor)(P.pos.x, P.pos.z - 13, 1);
    UJ.piles.push(a, b);
    return [a, b];
  };
  const spray = (mode) => {
    UJ.setNozzle(mode);
    UJ.Meters.pressure = 100;
    const [a, b] = pair();
    const d0 = [a.dirt, b.dirt];
    UJ.Input.spray = true;
    for (let i = 0; i < 22; i++) { UJ.aimAt(P.pos.x, 0.8, P.pos.z - 8); UJ.step(0.03); }
    UJ.Input.spray = false;
    const out = { front: +(d0[0] - a.dirt).toFixed(1), behind: +(d0[1] - b.dirt).toFixed(1) };
    a.alive = false; a.group.visible = false; b.alive = false; b.group.visible = false;
    return out;
  };
  const jet = spray(0);
  const lan = spray(2);
  UJ.setNozzle(0);
  return { jet, lan };
});
// The rear number is a RATIO, not zero: BUILD 12's weak points orbit outside
// the body and lean toward the player, so the back pile's core can peek past
// the front one and catch a stray JET tick. That is a fair consequence of
// cores being real geometry — what must hold is that LANCE reaches the rear
// target by an order of magnitude more, which is the nozzle's whole identity.
ok('LANCE punches through the front pile into the one behind',
   lance.jet.front > 1 && lance.lan.front > 1 && lance.lan.behind > 1 &&
   lance.lan.behind > lance.jet.behind * 5,
   `dirt removed front/behind — JET ${lance.jet.front}/${lance.jet.behind} vs LANCE ${lance.lan.front}/${lance.lan.behind}`);

/* =====================================================================
   BUILD 12 — WEAK POINTS, CRITS AND CHAIN BURSTS
   The build's whole point is that WHERE you aim now matters. These check
   the mechanic end to end: the core exists and is shootable, hitting it
   triples damage and pays pressure back, it relocates so uptime has to be
   re-earned, a kill on a lit core detonates into the neighbours, and the
   cascade actually chains rather than stopping at one.
   ===================================================================== */

// B12a. Every pile and zombie carries a core, and it's in the raycast set
const cores = await page.evaluate(() => {
  const UJ = window.UJ;
  const live = (l) => l.filter(e => e.alive);
  const withWeak = (l) => live(l).filter(e => e.weak && e.weak.mesh).length;
  const inTargets = live(UJ.piles).concat(live(UJ.getZombies()))
    .filter(e => e.weak && UJ.cleanTargets.includes(e.weak.mesh)).length;
  return { piles: live(UJ.piles).length, pileCores: withWeak(UJ.piles),
           zombies: live(UJ.getZombies()).length, zombieCores: withWeak(UJ.getZombies()),
           inTargets, flagged: UJ.cleanTargets.filter(m => m.userData.core).length };
});
ok('every live pile and zombie carries a shootable weak point',
   cores.pileCores === cores.piles && cores.zombieCores === cores.zombies &&
   cores.inTargets === cores.piles + cores.zombies && cores.flagged >= cores.inTargets,
   `${cores.pileCores}/${cores.piles} piles · ${cores.zombieCores}/${cores.zombies} zombies · all ${cores.inTargets} registered as ray targets`);

// B12b. A core hit triples the damage and refunds pressure. Both shots are
// fired through the real hose (aim + trigger), not by calling clean() — the
// point is that the RAY has to find the core, not that the maths works.
const crit = await page.evaluate(() => {
  const UJ = window.UJ;
  UJ.setNozzle(0);
  const t = UJ.camera.position.clone(); // a Vector3 without reaching for THREE
  const shoot = (atCore) => {
    const z = UJ.spawnZombieAt(0, -30);
    z.state = 'stunned'; z.stateT = 99;         // hold it still: aim is the only variable
    // the control shot must be a PURE body hit. Cores lean toward the player,
    // so one can drift in front of the belly and turn the baseline into a crit
    if (!atCore) { const i = UJ.cleanTargets.indexOf(z.weak.mesh); if (i >= 0) UJ.cleanTargets.splice(i, 1); }
    UJ.Player.pos.set(0, 0, -24); UJ.Player.hasHorn = true;
    for (let i = 0; i < 6; i++) UJ.step(0.03);  // let the camera boom settle
    z.goo = z.gooMax; UJ.Meters.pressure = 100;
    const g0 = z.goo, p0 = UJ.Meters.pressure;
    let sawCore = false;
    for (let i = 0; i < 6; i++) {               // track the target, as a player would
      z.state = 'stunned'; z.stateT = 99;
      (atCore ? z.weak.mesh : z.belly).getWorldPosition(t);
      UJ.aimAt(t.x, t.y, t.z);
      UJ.Input.spray = true;
      UJ.step(0.03);
      sawCore = sawCore || !!UJ.HoseFX.lastCore;
    }
    UJ.Input.spray = false;
    UJ.step(0.09); // the ~12Hz target-sense raycast needs a tick to catch up
    const out = { dmg: +(g0 - z.goo).toFixed(1), psi: +(UJ.Meters.pressure - p0).toFixed(2), sawCore,
                  cross: document.getElementById('crosshair').className };
    z.alive = false; UJ.reapEntities();
    return out;
  };
  return { body: shoot(false), head: shoot(true) };
});
ok('landing the jet on the core triples the damage and pays pressure back',
   crit.head.sawCore && !crit.body.sawCore &&
   crit.head.dmg > crit.body.dmg * 2.2 && crit.head.psi > crit.body.psi &&
   crit.head.cross === 'onCore' && crit.body.cross === 'onTarget',
   `body hits ${crit.body.dmg} dmg / ${crit.body.psi} PSI (crosshair "${crit.body.cross}") vs core hits ${crit.head.dmg} dmg / ${crit.head.psi > 0 ? '+' : ''}${crit.head.psi} PSI (crosshair "${crit.head.cross}")`);

// B12c. The core doesn't sit still — idle drift and a bolt after sustained
// contact are what stop "aim once, hold forever"
const drift = await page.evaluate(() => {
  const UJ = window.UJ;
  const z = UJ.spawnZombieAt(0, -30);
  const w = z.weak;
  const start = w.orb.position.clone();
  const m0 = w.moves;
  let idleMoved = 0;
  for (let i = 0; i < 40; i++) { UJ.step(0.03); idleMoved = Math.max(idleMoved, w.orb.position.distanceTo(start)); }
  const idleMoves = w.moves - m0;                 // 1.2s idle: at most one relocation
  const m1 = w.moves, held = w.orb.position.clone();
  let heldMoved = 0;
  for (let i = 0; i < 40; i++) {                  // 1.2s of the jet held on the core
    UJ.applyCrit(z, 0.1, z.group.position, 0.03);
    UJ.step(0.03);
    heldMoved = Math.max(heldMoved, w.orb.position.distanceTo(held));
  }
  const heldMoves = w.moves - m1;
  z.alive = false; UJ.reapEntities();
  return { idleMoves, heldMoves, idleMoved: +idleMoved.toFixed(2), heldMoved: +heldMoved.toFixed(2) };
});
// (distance isn't asserted: relocation is biased into the arc facing the
// player, so two consecutive picks can legitimately land close together —
// the contract under test is the RATE, not how far any one hop travels)
ok('holding the jet on a core makes it bolt far sooner than it drifts on its own',
   drift.heldMoves >= 2 && drift.heldMoves > drift.idleMoves && drift.heldMoved > 0.02,
   `over the same 1.2s: ${drift.idleMoves} relocation(s) left alone vs ${drift.heldMoves} while held · slid ${drift.heldMoved}m`);

// B12d. Popping something on a lit core detonates into its neighbours —
// and the detonation can chain through a weakened pack
const burst = await page.evaluate(() => {
  const UJ = window.UJ;
  const ring = [];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    ring.push(UJ.spawnZombieAt(Math.cos(a) * 3, -40 + Math.sin(a) * 3));
  }
  const victim = UJ.spawnZombieAt(0, -40);
  // control: kill it with the core cold, nobody else should feel a thing
  const cold = UJ.spawnZombieAt(20, -40);
  const coldNb = UJ.spawnZombieAt(21, -40);
  cold.weak.lit = 0;
  cold.clean(9999, cold.group.position);
  const coldNeighbourGoo = coldNb.goo;

  const before = ring.map(z => z.goo);
  victim.weak.lit = 1;                       // as if you'd just crit it
  victim.clean(9999, victim.group.position); // …and that hit finished it
  const after = ring.map(z => z.goo);
  const hurt = after.filter((g, i) => g < before[i]).length;

  // cascade: a ring already on its last legs should unzip itself
  const weak = [];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.3;
    const z = UJ.spawnZombieAt(Math.cos(a) * 3, -60 + Math.sin(a) * 3);
    z.goo = 20; weak.push(z);                // one burst apiece would do it
  }
  const trigger = UJ.spawnZombieAt(0, -60);
  trigger.weak.lit = 1;
  trigger.clean(9999, trigger.group.position);
  const cascaded = weak.filter(z => !z.alive).length;

  for (const z of [...ring, ...weak, coldNb, cold]) z.alive = false;
  UJ.reapEntities();
  return { hurt, coldNeighbourUnhurt: coldNb.goo === coldNeighbourGoo, cascaded,
           rings: UJ.burstRings.length };
});
ok('a kill on a lit core detonates, and the blast cascades through a weak pack',
   burst.hurt === 5 && burst.coldNeighbourUnhurt && burst.cascaded === 5 && burst.rings > 0,
   `core kill splashed ${burst.hurt}/5 neighbours (a cold kill splashed none) · a weakened ring of 5 chain-popped ${burst.cascaded}`);

// B12e. BLAST deliberately can't crit — that's the trade that keeps the
// three nozzles different verbs instead of damage tiers
const noCritBlast = await page.evaluate(() => {
  const UJ = window.UJ;
  const t = UJ.camera.position.clone();
  const fire = (nz) => {
    UJ.setNozzle(nz);
    const z = UJ.spawnZombieAt(0, -28);
    z.state = 'stunned'; z.stateT = 99;
    UJ.Player.pos.set(0, 0, -24); UJ.Player.hasHorn = true;
    for (let i = 0; i < 6; i++) UJ.step(0.03);
    z.goo = z.gooMax;
    const g0 = z.goo;
    let lit = false;
    // 20 frames, not 6: the core orbits, so whether the ray finds it on any
    // ONE frame is luck. Whether it finds it at all over a burst is the claim.
    for (let i = 0; i < 20; i++) {
      z.goo = z.gooMax;                        // keep it alive for the whole burst
      UJ.Meters.pressure = 100;
      z.state = 'stunned'; z.stateT = 99;
      z.weak.mesh.getWorldPosition(t);
      UJ.aimAt(t.x, t.y, t.z);
      UJ.Input.spray = true;
      UJ.step(0.03);
      lit = lit || z.weak.lit > 0;
    }
    UJ.Input.spray = false;
    const out = { dmg: +(g0 - z.goo).toFixed(1), lit };
    z.alive = false; UJ.reapEntities();
    return out;
  };
  const jet = fire(0), blast = fire(1);
  UJ.setNozzle(0);
  return { jet, blast };
});
ok('BLAST cannot crit — coverage is what it trades precision for',
   noCritBlast.jet.lit && !noCritBlast.blast.lit,
   `JET on the core lights it (${noCritBlast.jet.dmg} dmg); BLAST through the same point never does (${noCritBlast.blast.dmg} dmg)`);

await page.evaluate(() => window.__QA_CLEAN());
// B8d. WHARF RUSH — starting it strips the story layer and arms the waves
const rushStart = await page.evaluate(() => {
  const UJ = window.UJ;
  UJ.startRush();
  return { on: UJ.Rush.on, wave: UJ.Rush.wave, score: UJ.Rush.score,
    piles: UJ.piles.length, zombies: UJ.getZombies().filter(z => z.alive).length,
    civs: UJ.civilians.length, horn: UJ.Player.hasHorn,
    hud: !document.getElementById('rushHud').classList.contains('hidden'),
    objectivesHidden: document.getElementById('objectives').classList.contains('hidden') };
});
ok('Wharf Rush clears the story layer and arms the wave director',
   rushStart.on && rushStart.wave === 0 && rushStart.piles === 0 && rushStart.zombies === 0 &&
   rushStart.civs === 0 && rushStart.horn && rushStart.hud && rushStart.objectivesHidden,
   `pier stripped (0 piles / 0 zombies / 0 sea lions) · horn granted · rush HUD up`);

// B8e. Waves spawn, scale, and pay out when cleared
const wave = await page.evaluate(() => {
  const UJ = window.UJ, P = UJ.Player;
  P.pos.set(0, 0, -60); P.hp = 60;
  UJ.Rush.breather = 0.01;
  UJ.step(0.03);                                  // trips startWave
  const w1 = { wave: UJ.Rush.wave, kinds: new Set(UJ.getZombies().filter(z => z.alive).map(z => z.kind)).size,
               spawned: UJ.getZombies().filter(z => z.alive).length,
               piles: UJ.piles.filter(p => p.alive).length,
               banner: document.getElementById('waveBanner').textContent };
  UJ.Rush.wave = 6; UJ.Rush.breather = 0.01;      // deeper wave = bigger tide
  UJ.getZombies().forEach(z => { if (z.alive) { z.alive = false; z.group.visible = false; } });
  UJ.piles.forEach(p => { p.alive = false; });
  UJ.step(0.03);
  const live7 = UJ.getZombies().filter(z => z.alive);
  const w7 = { spawned: live7.length,
               brutes: live7.filter(z => z.brute).length,
               runners: live7.filter(z => z.runner).length,
               kinds: new Set(live7.map(z => z.kind)).size };
  // clear the field and let the director notice
  UJ.getZombies().forEach(z => { if (z.alive) { z.alive = false; z.group.visible = false; } });
  UJ.piles.forEach(p => { p.alive = false; });
  const before = UJ.Rush.score, hpBefore = UJ.Player.hp;
  UJ.step(0.03);
  // clearing a wave hands you an upgrade pick, which freezes the world
  const picker = { shown: document.getElementById('perkPick').classList.contains('show'),
                   offered: UJ.getPerkOffer().length, frozen: UJ.Game.state === 'perks' };
  const chosen = UJ.getPerkOffer()[0];
  UJ.takePerk(0);
  const after = { rank: UJ.Perks.rank(chosen.key), state: UJ.Game.state,
                  hidden: !document.getElementById('perkPick').classList.contains('show') };
  return { w1, w7, cleared: UJ.Rush.cleared, breather: UJ.Rush.breather,
           bonus: UJ.Rush.score - before, healed: UJ.Player.hp > hpBefore,
           picker, after, name: chosen.name };
});
ok('waves scale with depth and clearing one pays a bonus, a breather and an upgrade',
   wave.w1.wave === 1 && wave.w1.spawned >= 4 && wave.w1.piles >= 2 &&
   wave.w7.spawned > wave.w1.spawned &&
   // NOT "wave 7 contains a runner or a brute": BUILD 15 made the wave picker
   // roll from six kinds, so any single kind can legitimately be absent from
   // any single wave. Asserting a specific roll makes this a dice test.
   wave.w7.kinds > wave.w1.kinds - 1 &&
   wave.cleared && wave.breather > 4 && wave.bonus > 0 && wave.healed &&
   wave.picker.shown && wave.picker.offered === 3 && wave.picker.frozen &&
   wave.after.rank === 1 && wave.after.state === 'playing' && wave.after.hidden,
   `wave 1: ${wave.w1.spawned} enemies of ${wave.w1.kinds} kind(s) → wave 7: ${wave.w7.spawned} of ${wave.w7.kinds} kinds · +${wave.bonus} and 3 upgrades offered → took ${wave.name}`);

// B8f. Score is multiplied by the hype tier — style literally pays
const scoring = await page.evaluate(() => {
  const UJ = window.UJ;
  const at = (heat) => {
    UJ.Hype.heat = heat; UJ.updateHype(0.001);
    const before = UJ.Rush.score;
    UJ.Rush.award(100, null);
    return UJ.Rush.score - before;
  };
  const cold = at(0), hot = at(1);
  UJ.Hype.heat = 0; UJ.updateHype(0.001);
  return { cold, hot };
});
ok('rush score is multiplied by the hype tier', scoring.cold === 100 && scoring.hot === 250,
   `a 100-point clean pays ${scoring.cold} cold and ${scoring.hot} at LEGENDARY`);

// B8g. Dying banks the run, and rush never triggers the story win
const rushEnd = await page.evaluate(() => {
  const UJ = window.UJ, G = UJ.Game;
  G.pilesCleaned = G.totalPiles; G.zombiesDefeated = G.totalZombies; G.civResolved = G.civTotal;
  UJ.checkWin();                       // must NOT win or summon in endless mode
  const stillPlaying = G.state === 'playing' && !UJ.getBoss();
  UJ.Rush.score = 12345; UJ.Rush.best = 0;
  UJ.Player.hp = 0;
  UJ.damagePlayer(50, { x: 0, y: 0, z: 1 });
  const txt = document.getElementById('rushResult').textContent;
  let stored = null;
  try { stored = localStorage.getItem('uj_l2_rush_best'); } catch (e) {}
  // hand the world back to the story-mode checks that follow
  UJ.Rush.on = false;
  G.state = 'playing';
  document.getElementById('deadOverlay').classList.add('hidden');
  document.getElementById('rushHud').classList.add('hidden');
  UJ.Player.hp = 100;
  window.__QA_CLEAN();
  return { stillPlaying, txt, stored };
});
ok('endless mode never "wins", and dying banks the score',
   rushEnd.stillPlaying && /12,345/.test(rushEnd.txt) && /NEW BEST/.test(rushEnd.txt) && rushEnd.stored === '12345',
   `checkWin was a no-op in rush · result "${rushEnd.txt}" · persisted best ${rushEnd.stored}`);

// ---- BUILD 7: THE GUNK KRAKEN. These run last: the final check wins the
// level outright, after which step() deliberately stops advancing.
// B7a. Clearing the wharf summons the boss instead of ending the level
const summon = await page.evaluate(() => {
  const UJ = window.UJ, G = UJ.Game;
  G.pilesCleaned = G.totalPiles;
  G.zombiesDefeated = G.totalZombies;
  G.civResolved = G.civTotal;
  UJ.checkWin();
  return { state: G.state, spawned: !!UJ.getBoss(), active: G.bossActive,
           bar: !document.getElementById('bossBar').classList.contains('hidden'),
           coreGoo: UJ.getBoss() ? UJ.getBoss().goo : 0, tentacles: UJ.getBoss() ? UJ.getBoss().tentacles.length : 0 };
});
ok('clearing the wharf wakes the Kraken instead of winning',
   summon.state === 'playing' && summon.spawned && summon.active && summon.bar &&
   summon.coreGoo === 400 && summon.tentacles === 4,
   `state=${summon.state} · core ${summon.coreGoo} goo · ${summon.tentacles} tentacles · bar shown=${summon.bar}`);

// B7b. A tentacle telegraphs, slams, and is only cleanable once pinned
const cycle = await page.evaluate(() => {
  const UJ = window.UJ, P = UJ.Player, b = UJ.getBoss();
  P.pos.set(0, 0, -195); P.hp = 100;                 // stand in the arena
  for (let i = 0; i < 130; i++) UJ.step(0.03);       // let it finish hauling out
  const risen = b.rise;
  const seen = [];
  let ringPeak = 0, hitWhileRearing = 0, hitWhilePinned = 0;
  const t0 = b.tentacles[0];
  for (let i = 0; i < 400; i++) {
    UJ.step(0.03);
    if (seen[seen.length - 1] !== t0.state) seen.push(t0.state);
    ringPeak = Math.max(ringPeak, t0.ring.material.opacity);
    if (t0.state === 'rear') { const g = t0.goo; t0.clean(20, t0.tip); hitWhileRearing += g - t0.goo; }
    if (t0.state === 'pinned') { const g = t0.goo; t0.clean(3, t0.tip); hitWhilePinned += g - t0.goo; }
    if (seen.includes('pinned') && hitWhilePinned > 0) break;
  }
  return { risen, seen: seen.slice(0, 6), ringPeak, hitWhileRearing, hitWhilePinned };
});
ok('tentacle telegraphs, slams, pins — and only takes damage while pinned',
   cycle.risen > 0.9 && cycle.seen.includes('rear') && cycle.seen.includes('slam') &&
   cycle.seen.includes('pinned') && cycle.ringPeak > 0.5 &&
   cycle.hitWhileRearing === 0 && cycle.hitWhilePinned > 0,
   `states ${cycle.seen.join('→')} · telegraph ring peaked ${cycle.ringPeak.toFixed(2)} · damage taken rearing ${cycle.hitWhileRearing} vs pinned ${cycle.hitWhilePinned}`);

// B7c. Standing where it lands hurts
const slam = await page.evaluate(() => {
  const UJ = window.UJ, P = UJ.Player, b = UJ.getBoss();
  P.hp = 100; P.pos.set(0, 0, -195);
  const before = P.hp;
  let landed = false;
  for (let i = 0; i < 600 && !landed; i++) {
    UJ.step(0.03);
    // stay glued to whichever tentacle is winding up, so the slam connects
    const rearing = b.tentacles.find(t => t.state === 'rear');
    if (rearing) P.pos.set(rearing.target.x, 0, rearing.target.z);
    if (b.tentacles.some(t => t.state === 'pinned') && P.hp < before) landed = true;
  }
  const out = { before, after: P.hp, landed };
  P.hp = 100;
  return out;
});
ok('a slam that lands on you takes a real bite of HP', slam.landed && slam.after < slam.before,
   `HP ${slam.before} → ${slam.after} after eating a tentacle slam`);

// B7d. The core is armoured until a tentacle goes down
const core = await page.evaluate(() => {
  const UJ = window.UJ, b = UJ.getBoss();
  b.exposed = 0;
  const g0 = b.goo;
  b.clean(150, b.core.position);          // armoured: should bounce off
  const armoured = b.goo;
  b.tentacles[0].state = 'pinned';
  b.tentacles[0].goo = 5;
  b.tentacles[0].clean(50, b.tentacles[0].tip); // break it
  const exposedFor = b.exposed;
  b.clean(150, b.core.position);          // now it should bite
  return { g0, armoured, exposedFor, after: b.goo, broke: b.tentacles[0].state };
});
ok('the core shrugs off the hose until a tentacle breaks and bares it',
   core.armoured === core.g0 && core.exposedFor >= 7 && core.after === core.g0 - 150 && core.broke === 'hurt',
   `core ${core.g0} → ${core.armoured} while armoured, → ${core.after} once bared (exposed ${core.exposedFor.toFixed(1)}s, tentacle now '${core.broke}')`);

// B7e. Phases escalate as the core burns down
const phases = await page.evaluate(() => {
  const UJ = window.UJ, b = UJ.getBoss();
  const at = (frac) => {
    b.goo = UJ.BOSS.coreGoo * frac;
    return { phase: b.phase(), active: b.activeCount(), cd: b.slamCd(), tell: b.telegraph() };
  };
  const out = { p1: at(0.9), p2: at(0.5), p3: at(0.2) };
  b.goo = UJ.BOSS.coreGoo * 0.2;
  return out;
});
ok('phases escalate: more tentacles, shorter telegraphs, faster slams',
   phases.p1.phase === 1 && phases.p3.phase === 3 &&
   phases.p3.active > phases.p1.active && phases.p3.cd < phases.p1.cd && phases.p3.tell < phases.p1.tell,
   `P1 ${phases.p1.active} arms / ${phases.p1.cd}s cd / ${phases.p1.tell}s tell → P3 ${phases.p3.active} arms / ${phases.p3.cd}s / ${phases.p3.tell}s`);

// B7f. Burning the core out wins the level
const finale = await page.evaluate(() => {
  const UJ = window.UJ, b = UJ.getBoss();
  b.exposed = 10;
  b.clean(9999, b.core.position);
  return { alive: b.alive, defeated: UJ.Game.bossDefeated, state: UJ.Game.state,
           barHidden: document.getElementById('bossBar').classList.contains('hidden'),
           tentacleTargets: UJ.cleanTargets.filter(m => m.userData.entity && m.userData.entity.b).length };
});
// the win screen is deliberately held back 1.4s so the kill can play out
const winShown = await page.waitForFunction(
  () => !document.getElementById('winOverlay').classList.contains('hidden'),
  null, { timeout: 6000 }).then(() => true).catch(() => false);
finale.winShown = winShown;
ok('burning out the core kills the Kraken and wins the level',
   !finale.alive && finale.defeated && finale.state === 'won' && finale.barHidden &&
   finale.winShown && finale.tentacleTargets === 0,
   `boss dead · Game.state=${finale.state} · win screen up=${finale.winShown} · tentacle ray-targets cleaned up=${finale.tentacleTargets === 0}`);

// 8. No JS runtime errors (network/CDN tunnel failures are expected in-sandbox and excluded)
const jsErrors = errors.filter(e => !/ERR_TUNNEL_CONNECTION_FAILED|Failed to load resource|net::ERR/.test(e));
ok('no JS runtime errors (CDN/network excluded)', jsErrors.length === 0, jsErrors.slice(0,3).join(' | ') || 'clean');

await browser.close();
const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (errors.length) console.log(`(sandbox network noise, expected: ${errors.length} resource-load failures — CDN blocked)`);
process.exit(failed.length ? 1 : 0);
