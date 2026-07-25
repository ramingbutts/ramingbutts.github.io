# Unicorn Janitor — reusable patterns

Working notes for future levels. Everything below lives in `level1.js` (and,
since the fork, `level2.js`); the shared-engine extraction is scheduled for
level 3 — see the Level 2 section at the bottom for the fork decision.

## Content note (applies to all levels)

Enemies and filth are never characterized by sexual orientation. The house
style is camp: rainbow drips, glitter explosions, disco-fabulous flair. Keep
the flamboyance, drop any group-targeting labels.

## Character designs (locked to concept art, iteration 3)

**Jax:** navy work shirt (zipper stripe) + jeans + brown leather boots and
tool belt with steel buckle, bare muscular skin arms, brown-haired head with
white unicorn ears, rainbow mohawk-mane (7 box spikes arcing forehead→nape,
tallest mid-crest), white horn with a gold torus band at the base (horn, ring
and glow all hidden until the crater pickup).

**Poop zombie:** waddling poop golem — round brown belly, three-scoop swirl
head with flicked tip, single glowing yellow eye + pupil, dark mouth slit
with four teeth, dangling capsule arms ending in three down-pointing claws,
clawed box feet, six bright rainbow slime drips (the cleanable `gooBlobs`,
scale-shrink with goo). Keep body emissive ≤ 0.1 or the brown reads pink.

## Fog rig (section 3 + 6)

`THREE.FogExp2` (density 0.030) + `scene.background` set to the same color so
geometry dissolves into sky, layered with ~24 large additive glow sprites
(scale 22–38, opacity 0.05–0.10) drifting slowly and wrapping in z. The sprites
sell "moving mist" that plain exponential fog can't. Lesson learned: keep
sprite opacity ≤ 0.07 and scale ≥ 34, otherwise they read as bokeh bubbles,
not fog (portrait phones exaggerate this — check both orientations). No post-processing composer needed — the shared radial-gradient
`CanvasTexture` (`makeGlowTexture`) fakes bloom on every emissive object.

## Cleanable-entity interface + cleaning raycast (section 8, 11)

Any mesh with `mesh.userData.entity = obj` where `obj.clean(amount, hitPoint)`
exists is hoseable; all such meshes are registered in the flat `cleanTargets`
array. Hose = raycast from **camera** along the aim vector every frame while
spraying (`dps * dt`); beam = same ray, one big hit on a cooldown. Ray from the
camera (not the nozzle) keeps cleaning aligned with the crosshair. Caveat: the
camera lerps to position, so a teleported player has ~0.3 s of misaligned rays
— irrelevant in play, relevant in automated tests. `removeCleanTargets(group)`
must be called on death or dead meshes keep eating rays.

## Hose spray particles (section 11)

Fixed-size ring buffer (500) over one `THREE.Points` + `Float32Array`;
`frustumCulled = false` (emitter origin moves), hidden particles parked at
y = −1000. Spawn accumulator (`spawnRate * dt`) so emission is framerate-
independent. Additive blending, `depthWrite: false`, shared glow texture.

## Glitter burst VFX (section 7)

`spawnGlitter(center, count, power)` — throwaway `THREE.Points` per burst,
per-vertex HSL rainbow colors, sphere-shell velocities with upward bias, light
gravity, floor clamp, opacity fade in the last 0.6 s, geometry/material
disposed on expiry. Used for: scrub sparks (small, ~6), pile pop (~90), zombie
defeat (~130), victory rain (6 × 80). This is the core "cleaning as combat"
payoff — be generous with counts, they're cheap points.

## Zombie AI template (section 9)

FSM: `wander → chase → windup → lunge → recover`, tuned by the `CFG.zombie`
block only. Key feel decisions: telegraphed lean-back windup (0.55 s) before a
short dash lunge (0.35 s @ 11 m/s), 1 s per-zombie hit cooldown, and getting
hosed while wandering aggro-drops them into chase. Health = "goo coverage";
visuals degrade with coverage (emissive intensity + shrinking goo blobs), so
the player reads progress without a health bar.

## Positional audio cues (sections 1, 12)

All sounds are procedural WebAudio (no assets): looped-noise wind with LFO'd
lowpass, gated bandpass-noise spray loop, sliding-sawtooth groans, splat =
noise burst + sub thump, chime/fanfare arpeggios. `panFor(worldPos)` maps a
world position to a StereoPanner pan via dot with the camera's right vector;
volume falls off linearly with distance. Groan cadence tightens when a zombie
is chasing — that's the fog-navigation mechanic. A 2.5 s ticker "blorps" the
nearest dirty pile. Tutorial narration rides on `speechSynthesis` best-effort.

## Tutorial gating (section 13)

Event-fired, once-only steps (`Tutorial.fire('hornPickup' | 'firstSpray' |
'pileCleaned' | 'firstBeam' | 'zombieDefeated')`) hooked into gameplay code at
the moment the thing happens, not on timers. Level layout enforces pacing: the
first zombie is placed past the beam-tutorial pile so mechanics arrive one at
a time. Touch and desktop get different copy (`IS_TOUCH`).

## Input rig (section 2)

Desktop: pointer lock, `e.code` bindings (layout-safe), hold-LMB spray,
RMB/Q beam, Space jump. Touch: left-zone virtual joystick, right-zone drag
look, three hold/tap buttons; joystick and look are tracked per
`touch.identifier` so they work simultaneously. On coarse pointers the
tutorial box moves to the top of the screen (`@media (pointer: coarse)`) —
the bottom belongs to the thumbs.

## AAA rendering rig (iteration 4)

EffectComposer on a 4-sample MSAA half-float target: RenderPass →
UnrealBloomPass (half-res, strength 0.5 / radius 0.55 / threshold 0.75) →
inline vignette ShaderPass → OutputPass, with ACES filmic tone mapping
(exposure 1.15). Addon modules are vendored under `lib/jsm/` and mapped via
`"three/addons/": "./lib/jsm/"` in the importmap — only the postprocessing +
shaders files actually imported are shipped. One 1024px PCF-soft directional
shadow whose position/target follow the player each frame (28 m window), so a
single map covers the whole level; deck receives, characters/piles/cars cast.
Deck uses a procedural 256px asphalt CanvasTexture (speckle + cracks, tiled
3×32). Game feel: pooled water-splash sprites at every spray impact, decaying
`Player.shake` camera jitter on beam fire and damage taken, crosshair pulse
while the spray connects, procedural run cycle (hip/shoulder-pivoted limbs,
counter-swing), zombie waddle-rock, and a 4-voice triangle-pad ambient music
bed stepping a minor progression every 9 s under a breathing lowpass.
Caveat: with a composer, `renderer.info` per-frame numbers reflect only the
final pass — set `info.autoReset = false` and accumulate to measure.

## RPG progression (iteration 5)

XP: 25 per pile, 50 per zombie (`gainXP(amount, worldPos)` — also puffs
glitter at the source). Cumulative thresholds `[100,250,450,700,1050]`; each
level-up = +1 talent point, fanfare, toast, glitter burst. Four talents, 3
ranks each, defined in the `SKILLS` array and stored in `RPG.ranks`: Swift
Hooves (+12% speed/rank), Power Pressure (+25% hose dps/rank), Beam Mastery
(+25% dmg, −20% cd/rank), Rainbow Nova (unlockable AoE purify: F key / NOVA
button, radius 6+2·rank, cooldown 24−5·rank, 80 dmg to every pile/zombie in
range, expanding additive ring VFX). Modifiers are *multiplied into base CFG
values at the call site* (`CFG.player.speed * RPG.speedMul()`), never written
back into CFG — keeps tuning and progression independent. The talents panel
is a tactical pause: `Game.state = 'skills'` freezes updates, releases
pointer lock, and resumes on close (T toggles on desktop; TALENTS button on
touch). Total level XP (10 piles + 9 zombies = 700) reaches level 5 of 6 —
full clear should never cap the tree; scarcity is the point.

## Living-light details (iteration 5)

Horn PointLight (pink, distance 10, on at pickup), crater PointLight cycling
hue at 0.08 Hz, sun glow sprite with `material.fog = false` (fog would eat
it), pile glows breathing with remaining dirt, zombie eye emissive flaring
when hunting, and the pile "blorp" audio cue now puffs matching glitter —
every audio cue should have a visual twin and vice versa.

## Instant page load (iteration 6)

The HTML shell is just markup + CSS: the game module lives in `level1.js`
and is injected only after the window `load` event, with
`<link rel="modulepreload">` for both the module and Three.js so their
fetches start immediately. The start button boots disabled as "LOADING…"
and the module's last lines enable it — so a slow network shows honest
state instead of a dead button. The title chip carries a BUILD number;
GitHub Pages caches HTML for ~10 minutes, and the visible build id is how
you tell a stale cache from a bug. Measured (7 cold runs, local server,
fresh context each): DCL 19 ms / load 21 ms — versus 2.8 s inline.
Same treatment applied to the dashboard `index.html` (post-load ordered
script injection, async webfonts): 12.7 s → 28 ms when the font CDN hangs.
Rule: nothing render-blocking except the page's own CSS; third-party
fetches must never be able to hold the load event hostage.

## Game-feel layer (iteration 7)

Cinematic intro: `Game.state = 'intro'` flies the camera from above the
tower down to the third-person slot over 3.4 s (smoothstep lerp), CSS
letterbox bars + location title via a `body.cine` class that also hides the
HUD; any key/click/touch skips. Pointer lock must be requested in the start
click and merely persists through the intro — requesting it at intro end
would fail (no user gesture). Combos: cleans within a 3 s window raise the
chime pitch (+8%/step) and pay small bonus XP with a "COMBO xN" popup.
Floating text: per-spawn 256×80 canvas sprites, rise-and-fade 1.15 s, hard
cap 14 with oldest-recycled. Kill feedback: 0.09 s hit-stop (dt ×0.15) +
spin-shrink corpse (0.45 s) before removal — counters and XP fire at death,
the animation is cosmetic only. Sprint: Shift ×1.45 speed with FOV 70→78
kick and faster footstep taps. Sixth-sense ping (C / PING, 6 s cd): horn
flash + sonar panned toward the nearest objective + an expanding beacon
sprite above it — assists fog navigation without adding a minimap. Best
time persists in `localStorage('uj_l1_best')` (try/catch for private mode).

## Design-doc systems (iteration 9)

Resource meters: `Meters.pressure` (hose fuel — drains 16/s spraying, refills
30/s idle; hitting 0 locks the trigger until 25 so it can't stutter) and
`Meters.rainbow` (beam fuel — fills 14/s while actively cleaning, +25 per
pile, +15 per zombie, +20 per saved civilian; the beam costs 35 and keeps
only a 1.2 s anti-spam cooldown). The under-crosshair bar now shows rainbow
charge. Balance check: the first pile yields ~40 rainbow, so the beam
tutorial always fires. Transforming civilians: timer starts only when the
player comes within 26 m (pacing!), shiver amplitude grows with panic, hose
them clean to save (+75 XP) or they become a live zombie added to
`zombies[]` with `Game.totalZombies++` — win requires all civilians
*resolved* (saved or transformed-and-defeated). Hidden meteor shard behind
the far car (+100 XP). Streetlights: emissive bulbs + glow sprites, two
flicker via random on/off state timers, one real PointLight pooled under a
flickering lamp. Graffiti: canvas-texture planes on the curb inner faces at
spawn (story: Jax's job site). Music moods: `SFX.setMusicMood('eerie'|'hero')`
swaps the pad's chord table live — eerie until the horn pickup, hopeful
after. Prismalox lines are `narrate(text, 0.6)` (low pitch = the horn's
voice) + a toast. Win screen renders a secondary-objectives checklist
(80% piles / 5 zombies / civilians / shard).

## Adaptive quality + settings + gamepad (iteration 11)

Three quality tiers (`QUALITY_TIERS`): high = bloom+shadows+DPR 1.75,
medium = bloom, no shadows, DPR 1.25, low = neither, DPR 1. A rolling-fps
monitor (real unclamped dt) steps the Auto tier down after three
consecutive sub-45fps seconds, with a toast; toggling shadowMap at runtime
requires `material.needsUpdate` on every mesh (one-frame hitch, acceptable).
Pause menu (P/Esc/⚙/Start): volume (master gain), music (dedicated
`_musicBus`), narration toggle (gates `narrate()`), quality override,
reduce-motion (zeroes camera shake and hit-stop) — persisted in
`localStorage('uj_settings')`. Gamepad: poll `navigator.getGamepads()[0]`
every tick; sticks move/look, RT/A hold-spray via a separate `gpSpray`
flag (never OR into the mouse hold state), edge-detected X/Y/B/RB/Start/
Back for beam/nova/jump/ping/pause/talents, L3 sprint, rumble on damage
via `vibrationActuator`. Beam now stuns (`Zombie.stun(2.5)`, nova 1.5) —
a 'stunned' FSM state with a dizzy-stars sprite; this is the player's
defensive verb per the design doc. Objective counters pop (CSS class
re-trigger via `void el.offsetWidth`) when values change.

## Living world + climax + rank (iteration 12)

Ambient life, all cheap and reduce-motion-aware: the ocean is a 40×40 plane
whose verts ride two sine waves with `computeVertexNormals()` each frame
(cache rest positions in a Float32Array); a `ShaderMaterial` BackSide sphere
gives a horizon→zenith sky gradient (`fog:false`, `depthWrite:false`); five
seagull V-meshes orbit the towers with a flap cycle; Jax breathes (slow
y-sine) when idle. Design-doc "Bridge Escape" climax: `maybeTriggerClimax()`
fires once at 80% piles cleaned — every non-stunned zombie force-chases, with
a toast, hero-music swap, and a shake. Win rank: 0–10 score from secondary
objectives (2 each) + survival (HP≥90→2, ≥50→1) + speed (≤240s→2, ≤360s→1)
maps to S/A/B/C, shown in a glowing colored grade above the checklist, best
persisted in `localStorage('uj_l1_rank')`. FPS counter is a settings toggle
(`Settings.showFps`) reading real unclamped dt — for real-device playtests it
shows "N FPS · TIER". The find-mesh-by-vertex-count trick (`position.count
=== 1681`) is how tests reach un-exported meshes.

## Generated character models (iteration 13)

Pipeline: text→image (nano_banana_pro, full-body A-pose, plain grey
background, "no props no text") → image→3D (`image_to_3d`,
`should_texture: true` — the default is UNtextured; always set it) →
textured GLB on the media CDN. Integration pattern: the primitive
character rigs are partitioned into a `rig` subgroup at the end of each
constructor (a `keep` Set holds gameplay overlays — horn, weapon, drips,
sparkles — at group level); when the GLB streams in, `normalizeModel()`
wraps it, scales to a target height, centers it, plants feet at y=0, and
the rig turns invisible but REMAINS as the collision proxy (raycasts
against the `cleanTargets` array hit invisible meshes — tuned hitboxes
survive any visual swap). Zombies clone one prototype scene (static
meshes share geometry). Loads that fail fall back to primitives silently;
a CHARACTERS 3D/CLASSIC settings toggle switches live. Known constraints:
the sandbox proxy can't reach the CDN so GLB rendering is verified only
on real clients; `rotY` in the `MODELS` spec is the facing fix-up if a
generated mesh faces backwards; the GLB Jax has the horn baked in, so
the striped overlay horn is suppressed on the GLB path.
Model job IDs: images bbc810cb / abd19a8d, GLBs 5ffa09a6 (Jax),
79d718b2 (zombie) — re-fetch URLs via job_display if the CDN links rot.

## Models scale with the quality tier (iteration 14)

The generated GLBs are the heaviest asset in the scene, so `modelsActive()`
gates them on `Settings.models && activeTier() !== 'low'` — when the
rolling-fps monitor drops Auto to 'low' on weak hardware, the characters
fall back to the cheap primitive rigs (which are still present as invisible
colliders), completing the auto-quality story: bloom, shadows, pixel ratio
AND the models all scale down together. `applyQuality()` calls
`applyModelSetting()` on every tier change so crossing the threshold in
either direction takes effect live. Verified by stubbing GLBs and stepping
autoTier high→low→medium (models off at low, back on at medium, primitive
rig visibility inverse throughout).

## High-pressure jet + muzzle origin (iteration 15)

The water now reads as a real power-washer jet: denser (N 900, spawnRate
560), faster (`jetSpeed` 34), a tight 0.9 cone instead of a wide fan, and a
flickering additive muzzle-burst sprite pinned to the barrel tip that fades
the instant you release. The muzzle position is `Player.nozzle` — a
model-aware offset that `applyModelSetting()` swaps between `NOZZLE_PRIMITIVE`
(the short primitive nozzle, fwd 0.6) and `NOZZLE_GUN` (the long GLB
power-washer barrel, fwd 1.55 / up 1.32 / right 0.32 toward the gun hand),
so the stream leaves whichever weapon is actually shown. `nozzleWorldPos()`
adds the lateral component via `forward × up`. Because this rides on
`modelsActive()`, a low-tier device using the primitive rig also uses the
short nozzle — consistent by construction.

## Water-from-barrel + GLB body motion (iteration 18)

The jet was originating at NOZZLE_GUN fwd 1.55 — mid-gun / hand height, so
it read as "from the chest." Pushed to fwd 2.4 / up 1.24 (the long barrel
tip) and added a persisted live nudge: `[` `]` move the muzzle back/forward,
`;` `'` down/up (`Settings.nozzleAdj`, applied only to the gun nozzle in
`nozzleWorldPos`), so the origin can be dialled exactly onto the barrel and
the toast reports the resolved value to bake as the default. GLB fluidity:
the run cycle only animated the *primitive* limbs, so the GLB body sat
static. Added procedural motion on `Player.glbVisual` — walk hip-roll
(`rotation.z`) + lean (`rotation.x`) while moving, idle breathing when still,
and a `Player.firing`-driven recoil lean while spraying — all on x/z so it
never fights the `rotation.y` facing (Shift+R / modelYaw). A rigged skeletal
walk was rejected on purpose: auto-rig locomotion swings the arms and would
pull the power-washer out of his hands; procedural whole-body motion keeps
the gun pose intact and is verifiable in-sandbox.

## Auto-measured barrel muzzle (iteration 19)

Instead of a hardcoded gun-muzzle distance, `computeGunNozzle()` measures it
from the model: `normalizeModel()` stores the feet-planted, centered local
bounding box, and the muzzle's forward offset (`NOZZLE_GUN.fwd`) is set to the
box's forward-most extent along player-forward (+Z) — the barrel tip — with
`up` at 60% of model height. It runs on model load and re-runs on every
Shift+R, so the muzzle tracks the facing correction (verified: a +Z 1.2 barrel
gives fwd 1.35 facing forward, 0.35 flipped 180°, 0.4 at 90°). The manual
`[ ] ; '` nudge still layers on top for final tuning. Data-driven, so it stays
correct for any future character model. No-ops safely on the primitive path
(no localBox).

## High-pressure knockback (iteration 21)

The hose now shoves zombies: while a zombie is being sprayed, `Zombie.push(dt)`
slides it directly away from the player at `CFG.zombie.knockback` (3.6 m/s) —
faster than its 2.9 m/s chase, so a hosed zombie nets backward — with a brief
lean-back, clamped to the deck. A committed lunge resists (early-return on
`state === 'lunge'`) so the shove is crowd-control, not an i-win button. This
is the "cleaning as combat" payoff of the high-pressure fantasy and is
model-independent (works on GLB and primitive Jax alike).

## Performance defaults

Pixel ratio clamped to 1.75, no shadows (fog hides them anyway), shared
geometries/materials, everything low-poly primitives, particles pooled.
Vendored `lib/three.module.min.js` (r170) — no CDN dependency, works offline
and on GitHub Pages.

## Testing rig (scratchpad, not committed)

`window.UJ` debug hook exposes `Game/Player/Tutorial/piles/zombies/CFG/Input/
renderer` for Playwright: teleport player, aim by setting yaw/pitch, hold
mouse to spray, assert dirt/goo/state, read `renderer.info` for draw-call
budgets (level 1 baseline: 315 calls / 18k tris / 6 programs). Headless
swiftshader runs ~5 fps and `dt` clamps at 0.05 s, so hold durations must be
generous, the camera needs ~2 s to settle after a teleport before
ray-dependent assertions, and DOM read-backs of per-frame HUD writes race the
frame — assert on game state (e.g. `Tutorial.fired.firstBeam`), not on style
strings. Touch is testable by dispatching synthetic `TouchEvent`s; handlers
must not require `isTrusted`.

### Deterministic stepping beats wall-clock frames

Headless Chromium throttles `requestAnimationFrame` to ~2 fps (the compositor
treats the page as hidden regardless of `document.visibilityState`), so a test
that waits real seconds barely advances the game. `UJ.step(dt)` runs the same
updates as the `playing` branch of `tick()` for one frame, so the harness drives
frames itself and the run is deterministic and fast. Companion hooks: `UJ.aimAt(x,y,z)`
points the aim from the *camera* (the hose ray originates there, ~5.4 m behind
the player — aiming from the player's own position misses), `UJ.spawnZombieAt`,
`UJ.getFrames`, `UJ.HoseFX`, `UJ.nozzleWorldPos`. `games/unicorn-janitor/playtest.mjs`
is the committed harness (9 checks, all green).

Gotchas that bit real assertions: the hose needs `Player.hasHorn = true` (it's a
tutorial pickup, false at spawn); a chaser must spawn **beyond 3.2 m** or it
enters windup→lunge, which is deliberately knockback-immune, so a knockback test
placed too close reads as "moved closer"; and a fresh spray particle is already
~1 frame (≈1 m at `jetSpeed 34`) downstream of the muzzle, so "water from the
barrel" is proven by the muzzle *sprite* sitting exactly on `nozzleWorldPos()`
(Δ≈0) plus the particle being nearer the nozzle than the chest — not by an
absolute distance to the spawn point.

## Rigid-body physics + articulation (iteration 26)

~60-line custom physics (`physBodies` / `addPhysBody` / `updatePhysics`), no
library: gravity integration, ground bounce with restitution, rolling
friction, angular tumble, rail/bounds reflection, player kick-through, and
optional `ttl` for self-cleaning debris. Three users: deck props (cones,
buckets, crates — the jet applies real impulses inside `updateHose`, force
scaled by `dt`/mass and distance along the aim axis), zombie death ragdolls
(6 chunks incl. the eye, `ttl` ~1.5s with end-of-life shrink), and anything
future levels toss around. Props run in the always-on tick section so they
settle even during menus; `UJ.step` runs them too so tests see physics.

Characters are articulated with pivot groups, not baked poses: zombie arms
hang from shoulder joints and feet from ankle pivots, and a per-zombie
`gaitT` phase (randomized so the horde never marches in sync) advances with
state-dependent rate — feet alternate lift+toe-pitch, belly squash-stretches
on footfalls, head bobbles with a lag, arms reach forward in chase and flail
in windup, all eased with `1 - 0.001^dt` smoothing toward pose targets so
state changes blend instead of snapping. Jax's whole head (face, ears, mane,
horn) rides a neck joint that nods with aim pitch and rolls into strafes;
mane spikes ripple back harder with speed; boots counter-rotate against hip
swing for an ankle. Playtest checks all of it headlessly (13 checks).

## GLB whole-body locomotion (iteration 27)

The textured image→3D meshes are single baked wraps — no bones — so their
life is whole-body animation layered on the wrap (never touch `rotation.y`,
which belongs to the facing/Shift+R system): gait-synced waddle-hop
(`|sin(gaitT)|`), footfall squash-and-stretch, state leans (chase forward,
windup back, lunge stretched +z / squashed y), yaw-delta turn banking
(wrap dyaw to ±π first), stunned dizzy sway. Jax's wrap adds sprint-scaled
lean, camera-turn banking, an airborne tuck, and a whole-`Player.group`
landing squash proportional to impact speed (bank it at the ground clamp:
`_landSq = min(0.16, -vel.y * 0.016)`, decay ~0.9/s, scale y down / xz up).
Testable without the real model: inject `new THREE.Group()` as `z.glb` —
the animation layer only checks existence.

## Physics everywhere + hit-feel (iteration 28)

Every object class now reacts: piles are jelly (damped spring `wob`/`wobV`
excited by each clean() hit, integrated in `updatePileJelly` — shared by tick
AND UJ.step, or headless runs never see it), and they pop into physics gobs
tinted by their own material (`spawnChunkBurst`, the generalized ragdoll).
Zombies flinch under the jet (whole-group squash + facing shiver; gain must
beat per-frame decay under continuous spray — 0.04 was mathematically
invisible, 0.12 reaches ~0.9 equilibrium). Cars rock on suspension springs
(jet cone + walk-by excitation, roll clamped ±0.09). And physics is a weapon:
any body flying >3.5 m/s staggers a zombie it touches (stun 0.8s + 10 goo,
prop caroms off) — blast a traffic cone at one.

Test gotchas: hiding a leftover zombie does NOT stop it eating rays
(Mesh.raycast checks material visibility, not group visibility) — either
call removeCleanTargets or design the check to not depend on ray geometry;
and a suite that reuses "the nearest pile" inherits the previous check's
drain state — reset `dirt` explicitly.

## Level 2: Fisherman's Wharf (fork, BUILD 1)

Level 2 is a **copy-and-reshape fork** of `level1.js`, not a shared-engine
extraction. Reasoning: the engine surface that levels vary on turned out to be
small and legible — the `CFG` block, one environment builder
(`buildBridge` → `buildWharf`), the Civilian skin, layout spot arrays in
`buildLevel`, tutorial/HUD strings, and the per-level record keys
(`uj_l2_best`/`uj_l2_rank`). Everything else (physics, articulation, hose,
RPG, audio, settings) was untouched. Fork cost measured: ~2 days of diff
noise risk for ~300 changed lines out of 3400. **Extract the shared engine
when level 3 starts** — with two live copies the seams are now proven, and a
third copy would make every engine bugfix a triple edit.

What actually changed: dusk palette (`fogColor 0x6d5570`, sky gradient
`0x2e2440 → 0xc76a7e`, low sun sprite), plank-texture boardwalk with
pilings + post-and-rope rails, 5 shop shacks (awning + emissive sign +
glow sprite), 3 floating docks with ambient tide-bobbing sea lions, fish
carts reusing the `cars[]` suspension system, and civilians reskinned as
**infected sea lions** (capsule body pitched horizontal, flippers/snout/tail,
rot drips along the spine — same `clean()` interface, so every hose/beam
path just works). Zombies are meaner via CFG only (8 count, dmg 13,
goo 110). 12 piles / 8 zombies / 3 sea lions.

Win reward: **Wide Spray Nozzle** — persisted as
`localStorage('uj_wide_nozzle')`, read at boot into a `WIDE_NOZZLE` flag.
Implementation is an off-axis fan pass in `updateHose` after the direct-ray
hit: for every pile/zombie/civilian, project its offset onto the aim axis;
if it's within range and < ~1.8 m off-axis (`off² ≤ 3.2`), apply
`dps × 0.55 × dt`. The direct-hit target is excluded so the fan never
double-dips. `UJ.setWideNozzle(v)` exists so tests toggle it live.

Playtest fork lessons (`playtest2.mjs`, 22 checks): (1) meaner zombies
killed Jax mid-suite, silently turning `UJ.step` into a no-op — a
`__QA_CLEAN()` helper (despawn live zombies, refill HP) now runs before
each section; (2) assert against `UJ.CFG` values (goo 110, count 8), never
level-1 literals; (3) piles are ~1.5 m-wide blobs, so a "miss" for the
wide-nozzle control must aim beside a *slim* target (a zombie) and the
check must be an on/off comparison, not an absolute.

## Wharf toys — the interactivity layer (level 2 BUILD 2)

BUILD 2 answered "make it more fun, more interactive" with a toy layer
(section 8.5 of `level2.js`) that never gates the win — everything is
optional delight or tactics, discovered through one-time toasts:

- **Washable grime** (8 deck stains): flat canvas-blotch decals whose
  opacity IS their dirt. The purest power-washer fantasy — wash a stain,
  watch it fade. +10 XP each, +50 for the full set.
- **Suds barrels** (3): burst one with the hose and it foam-novas — 80
  clean to every pile/zombie/sea lion within 7 m, plus a 1.2 s stagger.
  A barrel next to an infected sea lion is an instant rescue.
- **Beach balls** (2): feather-light physics bodies (mass 0.3, rest 0.8)
  the jet launches; the existing flying-prop stagger rule makes them
  bowling balls for zombies.
- **Harbor bell**: a `clean()`-interface entity whose charge decays 12/s,
  so only a sustained blast rings it (charge > 20, 8 s cd). The ring lures
  every zombie within 26 m (`lureT = 6`) — the lure branch bypasses the
  FSM switch entirely, stuns pause it (they resume the pilgrimage after),
  and committed windup/lunge states are immune.
- **Wet planks**: ground-spray, burst piles, scrubbed grime and barrel
  novas leave slick decals (merged within 1.1 m, cap 14, ttl 7 s); a
  hustling zombie (chase/lunge/lured) crossing one slips — stun 0.8 s
  with a 3 s per-zombie cooldown. Hose-the-floor becomes trap-laying.
- **Gull bombing runs**: every 13–22 s a splat falls near the player
  (cap 6 live). Cleanable for +5 XP, but only registered in
  `cleanTargets` once landed — a mid-air blob must not eat rays.
- **Sea lion barks**: the ambient dock sea lions have a throttled
  `clean()` that barks, hops and pays +2 rainbow — spraying wildlife is
  rewarded, gently.

XP thresholds rose to `[120,300,550,850,1250]` so the ~200 bonus XP
doesn't cap the talent tree (scarcity is the point).

Engine fix that fell out of testing: `addPhysBody` gained `aimY` — the
jet-impulse loop offsets each body to `restY + 0.15` assuming its origin
sits at deck level (cones, crates), but a center-origin body (beach ball)
gets overshot by its own height and the cone check misses at steep aim
pitches. Center-origin bodies pass `aimY: 0`. Symptom to remember: the
kick works in a fresh scene but fails after camera-pitch feedback settles
differently — geometry bugs hide behind "it worked in my probe".

## Aim feel + difficulty curve (level 2 BUILD 3)

Aim, layered from cheap to smart (all CFG-tunable):
- **Target sense**: the crosshair turns gold whenever the cleaning ray
  WOULD land on a cleanable — one raycast at ~12 Hz, toggling an
  `onTarget` CSS class. Pre-fire confirmation, so players stop wasting
  pressure on fog.
- **Soft aim assist**: when the ray misses everything, the single nearest
  target within `assistOff2` (~0.7 m) of the jet axis still gets scrubbed
  at 35% power and half rainbow-fill. Tuned to stay strictly inside the
  earned wide-nozzle fan (1.8 m / 55%) so the reward keeps its meaning.
- **Beam graze**: if the beam ray whiffs, it bends into the nearest
  target within ~1 m of the beam line — the drawn beam visibly kinks to
  it, which doubles as feedback. A whiffed 35-rainbow shot felt terrible.
- **Look sensitivity**: `Settings.sens` (0.5–2×) multiplies the one
  constant in `updatePlayer`; mouse, touch-drag and gamepad all funnel
  through `Input.consumeLook`, so one line covers every input rig.
- Entities carry `aimY` (like phys bodies): the off-axis loops aim at
  torso height (0.9) by default, but flat targets (grime 0, splats 0.05,
  barrels 0.55) must override or the uniform offset pushes them outside
  their own assist cone.

Difficulty, as threat variety rather than stat inflation:
- **Runner zombies** (`opts.runner`): 1.5× speed, 70 goo, lean 0.86/1.08
  silhouette with a red eye. The flinch code owns `group.scale`, so the
  variant's base scale must live in `sclX/sclY` and be re-applied there —
  never bake a scale into a group something else writes every frame.
  `gooMax` per zombie replaces `CFG.zombie.goo` in the health fraction.
- **Climax reinforcements**: the 80%-piles climax now also spawns two
  chasing runners at the far fog line (`totalZombies` grows, HUD pops).
- **Pile regen**: piles regrow `regen`/s after `regenDelay`s untouched
  (in `updatePileJelly`, so tick and UJ.step both apply it). Punishes
  spray-and-run; trivial while actively scrubbing (65 dps vs 3.5/s).
- **Tighter rescues**: `CFG.civilian.timer` 26 → 22.
- XP thresholds already raised in BUILD 2 absorb the extra kills.

Test-harness lessons this build: a **transformed sea lion** becomes a
live zombie that hunts Jax through later checks — `__QA_CLEAN` before
every section is not optional hygiene, it's what keeps `step()` from
silently no-op'ing after a mid-suite death; `__QA_CLEAN` now also purges
dead zombies' meshes from `cleanTargets` (invisible corpses eat rays —
the L1 gotcha, now handled centrally); and any check that raycasts after
teleporting must re-aim every step for ~2 s (`aimAt` computes from the
still-lerping camera) and stand within `hose.range` of its target.

## Steering locomotion + the 3x pier (level 2 BUILD 4)

Movement realism, both sides of the chase:
- **Jax has momentum**: `Player.hvel` chases the wish velocity with real
  acceleration (34/s² grounded, 10/s² airborne) instead of teleport-snap
  input; his body yaw eases after the camera (`1 - 0.0005^dt`) so flicks
  read as the camera leading and the body catching up.
- **Zombies steer**: `Zombie.moveToward()` is the single locomotion
  path for wander/chase/lure — heading turns at a capped rate
  (`CFG.zombie.turnRate`, runners 1.4×) so they carve arcs; speed ramps
  with accel/decel and is scaled by heading error, so they bank and slow
  through corners; **stride frequency comes from actual ground speed**
  (`gaitT += speed * 2.9 * dt`), which keeps footsteps planted through
  acceleration and knockback for free. Wander gets random "sniff" stops
  with a head sweep (`headG.rotation.y`, previously unused). Crowd
  separation (O(n²) pairwise push under 0.9 m) stops the horde stacking
  into one super-zombie. `spawnZombieAt` seeds heading toward the player
  and half chase speed — spawned chasers face their prey, and playtests
  don't flake on the random initial heading.

The 3x map (26×221 m vs 18×101 m play area) is mostly data: spot lists
for piles (20), zombies (14, 4 runners), sea lions (5), shops (10),
docks (6), lamps (12), grime (14), barrels (5), bells (2), props, and
`CFG.bridge.playHalfW` replacing every hardcoded ±7.4/7.5 clamp
(physics walls, zombie/player clamps, gull-splat spawns). Rank speed
thresholds scale with the map (8/12 min). Two rendering gotchas at this
scale, both invisible on the small map:
- The sky sphere grew past `camera.far` (300) — everything beyond the
  far plane clips to the background color, which reads as a giant
  fog-colored dome dead ahead. far → 520, and diagnose "crisp-edged
  dome/arc in the sky" as far-plane clipping first.
- An origin-centered sky sphere's gradient distorts once the camera
  travels 100 m+ off-center — the sky now follows the player in xz
  (set in `updatePlayer`, so headless `step()` renders match too), and
  the sea plane must extend past the sky radius or its edge silhouettes
  at the horizon.

## The AAA-feel pass (level 2 BUILD 5)

"AAA" in a browser game with no art budget is not more polygons — it's the
layer of *presentation and readability* that shipped games have and hobby
games skip. Five systems, none of which change the core verbs:

**Cinematic camera rig** (`CFG.cam`, replaces the one-line follow lerp).
A spring arm anchored at the head: boom behind the aim, offset to one
shoulder so Jax never eclipses the crosshair, pulled in and pushed wider
while firing (`Player._aimT` eases the two together), led by
`Player.hvel` so the world slides ahead of a run. The boom raycasts
against an explicit `camBlockers` list (shop hulls, roofs, carts) and
shortens rather than clipping through — the damping is **asymmetric**,
near-instant when closing (a wall must never eat a frame) and slow when
opening (reads as a crane pull-back). Shake became **trauma**: the same
`Player.shake` call sites now feed a 0–1 value whose effect is trauma
*squared* and which **rolls** the lens (`camera.rotation.z`) as well as
jittering it — roll is what separates "screen shake" from a camera
operator flinching. Noise is layered sines at irrational-ish ratios; no
noise library, and smooth instead of the old per-frame `Math.random()`
buzz. A decaying `_fovPunch` fires on beams, novas and hits.

**Navigation HUD.** A 221 m pier in heavy fog is unreadable without
bearings, so objectives ride a compass strip: `screenBearing()` returns
the bearing relative to the crosshair (note the basis — `right` is
`forward × up` = `(-fz, 0, fx)`, so **+x is screen-LEFT** and the helper
negates), markers clamp to the strip edge with a chevron when off-screen,
and same-bearing markers nudge apart instead of printing on top of each
other. Damage arrives as a conic-gradient arc rotated to the attacker's
bearing — the same helper, reused.

**Difficulty presets** (`DIFFICULTIES` / `DIFF`). Story / Normal /
Nightmare scale incoming damage, zombie speed, pile regen and rescue
timers. Same discipline as the talent multipliers: applied at the call
site, never written back into CFG, so switching mid-run is safe.
Selectable from the start screen *and* the pause menu via one shared
`cycleDifficulty()`.

**Reactive score.** `SFX.setIntensity(0..1)` opens the pad's lowpass,
lifts the music bus and swells a filtered saw drone; `updateThreatMusic`
derives intensity from how many hunters are within 26 m plus a bonus when
one is inside 7 m, slewed so it never flickers. The drone is the layer
that actually reads as danger.

**Filmic post + an update budget.** Grain and damage-driven chromatic
aberration folded into the *existing* vignette pass — three effects for
the cost of the one pass already paid for (grain 0.032; 0.045 was visibly
noisy on flat sky). And `updateZombies()` gives anything past 55 m a
batched ~10 Hz tick, shared by `tick()` and `UJ.step` so tests exercise
what ships.

Testing notes: the threat slew is deliberately slow, so a check sampling
a "calm" baseline must let the previous check's chasers wash out (~3 s of
steps, not 1). Camera-rig assertions need ~90 steps to settle because the
arm damping is asymmetric. And the boom-collision check works because the
shops sit *outside* the play area (`playHalfW` 11.4, shop inner face
−13.2): stand at x −11 facing +x and the boom swings into the hull.

## Style, not just polish (level 2 BUILD 6)

BUILD 5 made the game *read* well; this one makes it fun to show off in.
Everything here leans into the camp-disco identity rather than away from
it — the house style is the feature.

**HYPE — the style meter.** Every clean adds heat (pile 0.16, zombie
0.22, brute 0.34, rescue 0.30, grime 0.08, plus a combo-scaled bonus);
it bleeds at 0.075/s, so a streak is something you *keep alive*. Three
tiers — GROOVY / FABULOUS / LEGENDARY — each raising hose damage
(`Hype.dmgMul()`, up to +45%) and glitter counts, and dropping a
mirrorball out of the fog. Two things that were wrong on the first pass
and are worth remembering: the top tier sat at 0.90, which the decay
crossed back over instantly, so tiers **strobed** — fixed with
hysteresis (enter at the threshold, fall out 0.07 below) and by lowering
LEGENDARY to 0.84. And a tier must never be a hard gate on progress; it
only amplifies.

**The disco rig, and why volumetric beams are a trap.** First attempt
hung seven wide cones (radius 1.7) under a ball 8.4 m above the player.
Additive + `depthWrite:false` + `DoubleSide` means that when the camera
ends up *inside* a cone — which it always does, hanging above the
player — you render its far wall across the entire screen. The pier
vanished behind coloured wedges. The fix is narrow spokes (radius 0.5)
tilted ~50° out so they land on deck well clear of the lens, at a tenth
the opacity, and to put the real payload on the floor: a glow sprite
**light pool** per spoke, parked where it strikes the planks
(`reach = ballY * tan(tiltZ)`). Pools read as a mirrorball from the
player's eyeline; the beams are just garnish. Bloom strength ramps with
tier off a captured `bloomBase` (`applyQuality` owns `bloom.enabled`,
not `.strength`, so they don't fight).

**Jet boost.** Airborne + spraying with `aim.y < -0.25` converts the
hose into thrust (`CFG.hose.boost`, capped at `boostMax`, draining
pressure at `boostDrain` on top of the normal spray cost) plus a shove
along the recoil axis. A plain jump peaks at ~1.3 m; the jet reaches
~8 m and eats 60% of the tank. Note the ordering: `updatePlayer` runs
before `updateHose`, so thrust written to `Player.vel.y` lands on the
*next* frame's integration — correct, but don't expect same-frame
altitude in a test.

**Style kills.** `Zombie.die()` classifies the finish — airborne, a prop
STRIKE (`_propStun`, set when a flying body clobbers it), a brute, or a
combo chain — and pays hit-stop, an FOV punch, shake and bonus hype.
**Brutes** are the counterweight: 240 goo, 0.6× speed, 1.42× scale,
1.6× damage, and `push()` early-returns so the jet can't shove them at
all. All of it rides the `sclX/sclY/gooMax/speedMul` fields the runner
variant already introduced — variants are cheap now, which was the point
of building them that way.

Harness lesson worth keeping: `UJ.step` was never expiring combos
(`comboT` only ticked in `tick()`), so headless runs held an infinite
chain and a "grounded control kill" silently counted as a style kill.
Any state the playing branch mutates must be mirrored in `step`, or
tests quietly measure a different game. Same class of bug as the
`updatePileJelly` split back in BUILD 28 of level 1.
