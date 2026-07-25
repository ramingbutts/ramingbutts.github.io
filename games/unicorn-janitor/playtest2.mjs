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
  civs: window.UJ.civilians.length,
  piles: window.UJ.piles.length,
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
  return { near: trial(0.55), far: trial(1.3) };
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
  const layoutRunners = UJ.getZombies().filter(z => z.runner);
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
ok('runner variant: 2 in the layout, less goo, visibly faster in the chase',
   runners.count === runners.cfg && runners.goo === runners.cfgGoo && runners.rDist > runners.nDist * 1.25,
   `runners=${runners.count}/${runners.cfg} · goo ${runners.goo} · chase ${runners.nDist.toFixed(2)}m vs ${runners.rDist.toFixed(2)}m over 0.9s`);

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
  const onTarget = el.classList.contains('onTarget');
  for (let i = 0; i < 70; i++) { UJ.aimAt(UJ.Player.pos.x, 60, UJ.Player.pos.z - 2); UJ.step(0.03); } // at the sky
  const offTarget = el.classList.contains('onTarget');
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
  const layout = UJ.getZombies().filter(z => z.brute);
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

// 8. No JS runtime errors (network/CDN tunnel failures are expected in-sandbox and excluded)
const jsErrors = errors.filter(e => !/ERR_TUNNEL_CONNECTION_FAILED|Failed to load resource|net::ERR/.test(e));
ok('no JS runtime errors (CDN/network excluded)', jsErrors.length === 0, jsErrors.slice(0,3).join(' | ') || 'clean');

await browser.close();
const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (errors.length) console.log(`(sandbox network noise, expected: ${errors.length} resource-load failures — CDN blocked)`);
process.exit(failed.length ? 1 : 0);
