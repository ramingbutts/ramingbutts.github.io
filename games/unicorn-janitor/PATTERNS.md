# Unicorn Janitor — reusable patterns from Level 1

Working notes for future levels. Everything below lives in `level1.html` and is
written so it can be lifted into a shared module once level 2 starts (per the
project's design-for-evolution rule: extract on the second use, not before).

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
