import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/* =====================================================================
   0. CONFIG — one place to tune the whole level
   ===================================================================== */
const CFG = {
  // "bridge" keys are the engine's level-bounds vocabulary (kept so every
  // system reads the same fields): here they describe the wharf pier.
  bridge: { width: 26, zStart: 13, zEnd: -230, playZEnd: -208, playHalfW: 11.4 }, // BUILD 4: ~3x the play area of BUILD 3's pier
  fogDensity: 0.030,
  fogColor: 0x6d5570, // mauve dusk rolling off the bay — level 2 is sunset
  player: { speed: 8, jumpVel: 8.5, gravity: 24, hp: 100 },
  // GROUND POUND (BUILD 13). The level had exactly one offensive verb, and a
  // whole vertical layer — containers, awning pads, the jet boost — that
  // combat never touched. Tap jump again in the air and you come down hard.
  // Every number scales off how far you FELL, so height is the resource and
  // the rooftops become a weapon rather than scenery.
  slam:   { minHeight: 2.2,  // above the ground below you before it arms
            dive: 27,        // downward dive speed
            drag: 0.22,      // fraction of horizontal momentum you keep
            rMin: 3.6, rPerM: 0.42, rMax: 9.5,      // shockwave radius vs drop
            dmgMin: 45, dmgPerM: 11, dmgMax: 175,   // and its bite
            downMin: 1.5, downPerM: 0.1, downMax: 3.2, // knockdown seconds
            padBoost: 1.35 },  // slamming onto an awning throws you back higher

  hose:   { range: 20, dps: 65, spawnRate: 560, jetSpeed: 34,
            assistOff2: 0.5, assistPower: 0.35, // soft aim assist: near-misses ≤ ~0.7m off-axis still scrub, weakly
            boost: 30, boostMax: 7.5, boostDrain: 30 }, // BUILD 6: ride your own recoil
  beam:   { range: 40, damage: 45, cooldown: 1.2, grazeOff2: 1.0 }, // the big shot bends into anything ~1m off the line
  zombie: { count: 14, detect: 16, lose: 30, wanderSpeed: 1.1, chaseSpeed: 3.1,
            lungeSpeed: 11.5, lungeTime: 0.35, windup: 0.5, recover: 0.85,
            hitRange: 1.5, damage: 13, goo: 110, knockback: 3.6, // level 2: slightly meaner
            runners: 4, runnerSpeedMul: 1.5, runnerGoo: 70, // lean sprinter variant
            brutes: 2, bruteGoo: 240, bruteSpeedMul: 0.6, bruteDamage: 1.6, // BUILD 6 heavy
            turnRate: 3.5, accel: 6, decel: 10 }, // BUILD 4 steering: they carve arcs, not pivots
  pile:   { dirt: 100, regen: 3.5, regenDelay: 4 }, // abandoned progress re-festers
  civilian: { timer: 22 }, // BUILD 3: tighter rescue window (was 26)
  // BUILD 5 cinematic camera rig: a spring arm that collides with the world,
  // slides over the shoulder while you aim, and leads the direction of travel
  cam: { dist: 5.4, height: 0.4, shoulder: 0.55, aimPull: 1.1, aimShoulder: 0.5,
         lead: 0.075, minDist: 1.3, fov: 70, sprintFov: 78 },
};

// BUILD 5: difficulty presets — every multiplier is applied at the call site,
// never written back into CFG, so switching mid-run is safe and reversible.
const DIFFICULTIES = {
  story:     { label: 'STORY',     dmg: 0.5, speed: 0.85, regen: 0.4, rescue: 1.4 },
  normal:    { label: 'NORMAL',    dmg: 1,   speed: 1,    regen: 1,   rescue: 1 },
  nightmare: { label: 'NIGHTMARE', dmg: 1.6, speed: 1.18, regen: 1.8, rescue: 0.75 },
};
const DIFF = {
  cur() { return DIFFICULTIES[Settings.difficulty] || DIFFICULTIES.normal; },
  dmg() { return this.cur().dmg; },
  speed() { return this.cur().speed; },
  regen() { return this.cur().regen; },
  rescue() { return this.cur().rescue; },
};

const IS_TOUCH = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

// BUILD 8 — three ways to point the same water. Every field is a multiplier
// on the base hose numbers so tuning stays in one place, and the modes are
// genuinely different verbs rather than damage tiers: JET is the precise
// default, BLAST is a short shotgun cone for crowds, LANCE is a long
// piercing stream that hits everything lined up behind the first target.
const NOZZLES = [
  { key: 'jet',   name: 'JET',   dps: 1,    range: 20, drain: 1,    spread: 0.9,  speed: 34, rate: 1,    color: '#9fdcff' },
  { key: 'blast', name: 'BLAST', dps: 0.6,  range: 9,  drain: 1.55, spread: 6.5,  speed: 19, rate: 1.25, color: '#ffd94f' },
  { key: 'lance', name: 'LANCE', dps: 1.3,  range: 30, drain: 1.9,  spread: 0.22, speed: 54, rate: 0.8,  color: '#c58fff' },
];
let nozzleIdx = 0;
const Nozzle = () => NOZZLES[nozzleIdx];
const BLAST_COS = Math.cos(0.75); // ~43° half-angle, measured from the chest (see updateHose)
function applyNozzleUI() {
  const n = Nozzle();
  const el = document.getElementById('nozzleName');
  if (el) { el.textContent = n.name; el.style.color = n.color; }
}
function cycleNozzle(dir = 1) {
  nozzleIdx = (nozzleIdx + dir + NOZZLES.length) % NOZZLES.length;
  const n = Nozzle();
  applyNozzleUI();
  SFX.step(0);
  showToast(`💦 Nozzle: ${n.name}` + (n.key === 'blast' ? ' — short, wide, shoves hard'
    : n.key === 'lance' ? ' — long range, pierces everything in line' : ' — balanced'));
}

// Level-2 reward, persisted across sessions: once the wharf has been cleared
// the hose fan widens (see updateHose) — near-misses along the jet still clean.
let WIDE_NOZZLE = false;
try { WIDE_NOZZLE = localStorage.getItem('uj_wide_nozzle') === '1'; } catch (e) { /* private mode */ }

// resource meters (design doc): Pressure fuels the hose and refills when you
// ease off; Rainbow fills as you clean and pays for the Magic Beam.
const Meters = { pressure: 100, rainbow: 0 };
const BEAM_COST = 35, PRESSURE_DRAIN = 16, PRESSURE_REGEN = 30, RAINBOW_FILL = 14;
let pressureLocked = false; // emptied tank: trigger locks until it recovers

/* =====================================================================
   1. AUDIO — all procedural WebAudio. In heavy fog, sound is the map:
      groans, poop-bubbles and splats are positional (stereo pan + volume).
   ===================================================================== */
const SFX = {
  ctx: null, master: null, noiseBuf: null, sprayGain: null,

  init() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.85;
    this.master.connect(this.ctx.destination);

    // BUILD 11 — a real space. Every sound was landing bone-dry, which is the
    // single most "not shipped" thing about procedural audio. A convolver fed
    // by a synthesised impulse response (decaying stereo noise, slightly
    // decorrelated per channel) puts the whole mix inside a damp wooden pier
    // under fog. It's a send, so dry transients stay punchy.
    try {
      const rate = this.ctx.sampleRate, secs = 2.6, len = Math.floor(rate * secs);
      const ir = this.ctx.createBuffer(2, len, rate);
      for (let ch = 0; ch < 2; ch++) {
        const d = ir.getChannelData(ch);
        for (let i = 0; i < len; i++) {
          const t = i / len;
          // early reflections then a long-ish tail; ch offset widens the image
          d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 2.4) * (1 - 0.35 * ch * Math.sin(t * 40));
        }
      }
      const verb = this.ctx.createConvolver();
      verb.buffer = ir;
      const damp = this.ctx.createBiquadFilter();     // fog eats the highs
      damp.type = 'lowpass'; damp.frequency.value = 2600;
      const wet = this.ctx.createGain(); wet.gain.value = 0.3;
      verb.connect(damp); damp.connect(wet); wet.connect(this.master);
      this._verb = verb; this._wet = wet;
    } catch (e) { this._verb = null; } // convolver is optional; dry still plays

    // reusable 2s white-noise buffer
    const len = this.ctx.sampleRate * 2;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    this._startWind();
    this._startSprayLoop();
    this._startMusic();
  },

  // ambient music bed: four detuned triangle voices drifting through a
  // minor chord progression under a slow-breathing lowpass — foggy, hopeful
  _startMusic() {
    // two moods per the design doc: eerie before the horn, hopeful after
    this._chordSets = {
      eerie: [
        [220.0, 261.6, 311.1, 415.3],   // A C Eb Ab — uneasy
        [196.0, 233.1, 293.7, 392.0],   // G Bb D G
        [174.6, 207.7, 261.6, 311.1],   // F Ab C Eb
        [164.8, 196.0, 246.9, 293.7],   // E G B D
      ],
      hero: [
        [220.0, 261.6, 329.6, 392.0],   // Am add9
        [174.6, 220.0, 261.6, 349.2],   // F maj
        [196.0, 246.9, 293.7, 392.0],   // G add7
        [164.8, 220.0, 246.9, 329.6],   // E min-ish
      ],
    };
    this._chords = this._chordSets.eerie;
    const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 750; lp.Q.value = 0.5;
    const breathe = this.ctx.createOscillator(); breathe.frequency.value = 0.045;
    const breatheG = this.ctx.createGain(); breatheG.gain.value = 320;
    breathe.connect(breatheG); breatheG.connect(lp.frequency); breathe.start();
    const bus = this.ctx.createGain(); bus.gain.value = 0.05;
    this._musicBus = bus; // settings menu can mute the music independently
    this._musicLP = lp;   // threat intensity opens this filter (setIntensity)
    lp.connect(bus); bus.connect(this.master);
    // the danger layer: a detuned low drone that only exists when hunted
    const drone = this.ctx.createOscillator(); drone.type = 'sawtooth';
    drone.frequency.value = 55;
    const droneLP = this.ctx.createBiquadFilter();
    droneLP.type = 'lowpass'; droneLP.frequency.value = 240; droneLP.Q.value = 3;
    const droneG = this.ctx.createGain(); droneG.gain.value = 0;
    drone.connect(droneLP); droneLP.connect(droneG); droneG.connect(bus);
    drone.start();
    this._droneG = droneG;
    this._musicVoices = this._chords[0].map((f, i) => {
      const o = this.ctx.createOscillator(); o.type = 'triangle';
      o.frequency.value = f; o.detune.value = (i - 1.5) * 5;
      const g = this.ctx.createGain(); g.gain.value = 0.22;
      o.connect(g); g.connect(lp); o.start();
      return o;
    });
    let step = 0;
    this._musicTimer = setInterval(() => {
      step = (step + 1) % this._chords.length;
      const t = this.ctx.currentTime;
      this._musicVoices.forEach((o, i) => {
        o.frequency.cancelScheduledValues(t);
        o.frequency.setValueAtTime(o.frequency.value, t);
        o.frequency.linearRampToValueAtTime(this._chords[step][i], t + 2.5);
      });
    }, 9000);
  },

  // BUILD 5: the score reacts to danger — the pad opens up, a low drone
  // swells underneath, and it all settles again once you're clear.
  setIntensity(x) {
    if (!this.ctx || !this._musicLP || !Settings.music) return;
    const t = this.ctx.currentTime;
    this._musicLP.frequency.setTargetAtTime(700 + x * 1700, t, 1.1);
    if (this._musicBus) this._musicBus.gain.setTargetAtTime(0.05 * (1 + x * 1.2), t, 1.1);
    if (this._droneG) this._droneG.gain.setTargetAtTime(x * x * 0.075, t, 0.9);
  },

  // BUILD 6: a four-on-the-floor groove that only exists while you're
  // styling. Tier drives how much of the kit shows up.
  setGroove(tier) {
    if (!this.ctx || this._grooveTier === tier) return;
    this._grooveTier = tier;
    if (this._grooveTimer) { clearInterval(this._grooveTimer); this._grooveTimer = null; }
    if (tier <= 0) return;
    let beat = 0;
    this._grooveTimer = setInterval(() => {
      if (!Settings.music || !this.ctx) return;
      const t = this.ctx.currentTime, bus = this._musicBus || this.master;
      beat = (beat + 1) % 4;
      const kick = this.ctx.createOscillator(); kick.type = 'sine';
      const kg = this.ctx.createGain();
      kick.frequency.setValueAtTime(125, t);
      kick.frequency.exponentialRampToValueAtTime(44, t + 0.11);
      kg.gain.setValueAtTime(0.9 + 0.5 * tier, t);
      kg.gain.exponentialRampToValueAtTime(0.001, t + 0.19);
      kick.connect(kg); kg.connect(bus); kick.start(t); kick.stop(t + 0.2);
      if (tier >= 2 && beat % 2 === 1) { // offbeat tick once it's really cooking
        const h = this.ctx.createOscillator(); h.type = 'square';
        h.frequency.value = 5200 + Math.random() * 900;
        const hg = this.ctx.createGain();
        hg.gain.setValueAtTime(0.16 * tier, t);
        hg.gain.exponentialRampToValueAtTime(0.001, t + 0.045);
        h.connect(hg); hg.connect(bus); h.start(t); h.stop(t + 0.05);
      }
    }, 480); // ~125 BPM
  },

  setMusicMood(name) {
    if (!this.ctx || !this._chordSets || !this._chordSets[name]) return;
    this._chords = this._chordSets[name];
    const t = this.ctx.currentTime;
    this._musicVoices.forEach((o, i) => {
      o.frequency.cancelScheduledValues(t);
      o.frequency.setValueAtTime(o.frequency.value, t);
      o.frequency.linearRampToValueAtTime(this._chords[0][i], t + 1.5);
    });
  },

  _out(pan = 0, vol = 1) { // panner+gain chain for one-shots
    const g = this.ctx.createGain(); g.gain.value = vol;
    if (this.ctx.createStereoPanner) {
      const p = this.ctx.createStereoPanner(); p.pan.value = pan;
      g.connect(p); p.connect(this.master);
      if (this._verb) p.connect(this._verb); // parallel send: wet tail, dry punch
    } else {
      g.connect(this.master);
      if (this._verb) g.connect(this._verb);
    }
    return g;
  },

  _noise(dur) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuf; s.loop = true;
    s.start(); s.stop(this.ctx.currentTime + dur);
    return s;
  },

  // constant bridge wind: looped noise -> slow-wobbling lowpass
  _startWind() {
    const src = this.ctx.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
    const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 320; lp.Q.value = 0.4;
    const g = this.ctx.createGain(); g.gain.value = 0.055;
    const lfo = this.ctx.createOscillator(); lfo.frequency.value = 0.07;
    const lfoG = this.ctx.createGain(); lfoG.gain.value = 140;
    lfo.connect(lfoG); lfoG.connect(lp.frequency);
    src.connect(lp); lp.connect(g); g.connect(this.master);
    src.start(); lfo.start();
  },

  // hose spray loop — gain ramped by setSpray()
  _startSprayLoop() {
    const src = this.ctx.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
    const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2600; bp.Q.value = 0.7;
    this.sprayGain = this.ctx.createGain(); this.sprayGain.gain.value = 0;
    src.connect(bp); bp.connect(this.sprayGain); this.sprayGain.connect(this.master);
    src.start();
  },

  setSpray(on) {
    if (!this.ctx) return;
    this.sprayGain.gain.linearRampToValueAtTime(on ? 0.22 : 0, this.ctx.currentTime + 0.06);
  },

  splat(pan = 0, vol = 0.8) { // wet impact: filtered noise burst + low thump
    if (!this.ctx) return;
    const t = this.ctx.currentTime, out = this._out(pan, vol);
    const n = this._noise(0.18);
    const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(900, t);
    lp.frequency.exponentialRampToValueAtTime(120, t + 0.16);
    const g = this.ctx.createGain(); g.gain.setValueAtTime(0.7, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    n.connect(lp); lp.connect(g); g.connect(out);
    const o = this.ctx.createOscillator(); o.frequency.setValueAtTime(95, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.12);
    const og = this.ctx.createGain(); og.gain.setValueAtTime(0.5, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    o.connect(og); og.connect(out); o.start(t); o.stop(t + 0.15);
  },

  bubble(pan = 0, vol = 0.5) { // poop pile "blorp" cue
    if (!this.ctx) return;
    const t = this.ctx.currentTime, out = this._out(pan, vol);
    const o = this.ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(180, t); o.frequency.exponentialRampToValueAtTime(520, t + 0.12);
    const g = this.ctx.createGain(); g.gain.setValueAtTime(0.35, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    o.connect(g); g.connect(out); o.start(t); o.stop(t + 0.18);
  },

  groan(pan = 0, vol = 0.6) { // zombie groan: sliding sawtooth through a lowpass
    if (!this.ctx) return;
    const t = this.ctx.currentTime, out = this._out(pan, vol);
    const o = this.ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(85 + Math.random() * 30, t);
    o.frequency.linearRampToValueAtTime(50 + Math.random() * 15, t + 0.9);
    const vib = this.ctx.createOscillator(); vib.frequency.value = 5.5;
    const vibG = this.ctx.createGain(); vibG.gain.value = 7;
    vib.connect(vibG); vibG.connect(o.frequency);
    const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 480;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.001, t); g.gain.linearRampToValueAtTime(0.5, t + 0.15);
    g.gain.linearRampToValueAtTime(0.001, t + 0.95);
    o.connect(lp); lp.connect(g); g.connect(out);
    o.start(t); o.stop(t + 1); vib.start(t); vib.stop(t + 1);
  },

  chime(mult = 1) { // clean success: rising sparkle arpeggio (pitch scales with combo)
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    [880, 1108, 1318, 1760].forEach((f, i) => {
      const o = this.ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f * mult;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.001, t + i * 0.07);
      g.gain.linearRampToValueAtTime(0.22, t + i * 0.07 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.07 + 0.5);
      o.connect(g); g.connect(this.master);
      o.start(t + i * 0.07); o.stop(t + i * 0.07 + 0.55);
    });
  },

  pop(pan = 0, vol = 0.8) { // glitter explosion pop
    if (!this.ctx) return;
    const t = this.ctx.currentTime, out = this._out(pan, vol);
    const o = this.ctx.createOscillator(); o.type = 'triangle';
    o.frequency.setValueAtTime(1500, t); o.frequency.exponentialRampToValueAtTime(220, t + 0.14);
    const g = this.ctx.createGain(); g.gain.setValueAtTime(0.5, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    o.connect(g); g.connect(out); o.start(t); o.stop(t + 0.22);
    const n = this._noise(0.12);
    const hp = this.ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 3000;
    const ng = this.ctx.createGain(); ng.gain.setValueAtTime(0.25, t); ng.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    n.connect(hp); hp.connect(ng); ng.connect(out);
  },

  beam() { // magic beam: rising sweep + shimmer
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(220, t); o.frequency.exponentialRampToValueAtTime(1400, t + 0.22);
    const g = this.ctx.createGain(); g.gain.setValueAtTime(0.25, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 0.32);
  },

  step(pan = 0) { // soft footstep tap
    if (!this.ctx) return;
    const t = this.ctx.currentTime, out = this._out(pan, 0.35);
    const n = this._noise(0.05);
    const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 500;
    const g = this.ctx.createGain(); g.gain.setValueAtTime(0.22, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    n.connect(lp); lp.connect(g); g.connect(out);
  },

  sonar(pan = 0) { // sixth-sense ping: pure tone + fading echo
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    [[0, 0.3], [0.25, 0.12]].forEach(([dt, vol]) => {
      const out = this._out(pan, vol);
      const o = this.ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(1180, t + dt);
      o.frequency.exponentialRampToValueAtTime(880, t + dt + 0.22);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.3, t + dt); g.gain.exponentialRampToValueAtTime(0.001, t + dt + 0.28);
      o.connect(g); g.connect(out); o.start(t + dt); o.stop(t + dt + 0.3);
    });
  },

  nova() { // superpower: deep boom + rising rainbow shimmer
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const boom = this.ctx.createOscillator(); boom.type = 'sawtooth';
    boom.frequency.setValueAtTime(500, t); boom.frequency.exponentialRampToValueAtTime(55, t + 0.55);
    const bg = this.ctx.createGain(); bg.gain.setValueAtTime(0.4, t); bg.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
    boom.connect(bg); bg.connect(this.master); boom.start(t); boom.stop(t + 0.62);
    [660, 880, 1108, 1480].forEach((f, i) => {
      const o = this.ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.001, t + 0.05 * i);
      g.gain.linearRampToValueAtTime(0.16, t + 0.05 * i + 0.03);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.05 * i + 0.6);
      o.connect(g); g.connect(this.master);
      o.start(t + 0.05 * i); o.stop(t + 0.05 * i + 0.65);
    });
  },

  // ---- ground pound (BUILD 13): a falling whistle, then a body blow ----
  whoosh() { // the dive: filtered noise sliding down, air past your ears
    if (!this.ctx) return;
    const t = this.ctx.currentTime, out = this._out(0, 0.7);
    const n = this._noise(0.5);
    const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.4;
    bp.frequency.setValueAtTime(2400, t); bp.frequency.exponentialRampToValueAtTime(320, t + 0.4);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.001, t); g.gain.linearRampToValueAtTime(0.3, t + 0.08);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
    n.connect(bp); bp.connect(g); g.connect(out);
  },

  slamHit(pan = 0, power = 1) { // impact: sub thump + a crack of plank noise
    if (!this.ctx) return;
    const t = this.ctx.currentTime, out = this._out(pan, Math.min(1, 0.55 + power * 0.45));
    const sub = this.ctx.createOscillator(); sub.type = 'sine';
    sub.frequency.setValueAtTime(150 + 40 * power, t);
    sub.frequency.exponentialRampToValueAtTime(34, t + 0.3 + 0.2 * power);
    const sg = this.ctx.createGain();
    sg.gain.setValueAtTime(0.55, t);
    sg.gain.exponentialRampToValueAtTime(0.001, t + 0.4 + 0.25 * power);
    sub.connect(sg); sg.connect(out); sub.start(t); sub.stop(t + 0.7 + 0.25 * power);
    const n = this._noise(0.22);
    const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(5200, t); lp.frequency.exponentialRampToValueAtTime(700, t + 0.2);
    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(0.4 * power, t); ng.gain.exponentialRampToValueAtTime(0.001, t + 0.24);
    n.connect(lp); lp.connect(ng); ng.connect(out);
  },

  hurt() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(); o.type = 'square';
    o.frequency.setValueAtTime(170, t); o.frequency.exponentialRampToValueAtTime(70, t + 0.18);
    const g = this.ctx.createGain(); g.gain.setValueAtTime(0.3, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 0.22);
  },

  fanfare() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    [523, 659, 784, 1046, 1318, 1568].forEach((f, i) => {
      const o = this.ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.001, t + i * 0.12);
      g.gain.linearRampToValueAtTime(0.25, t + i * 0.12 + 0.03);
      g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.12 + 0.8);
      o.connect(g); g.connect(this.master);
      o.start(t + i * 0.12); o.stop(t + i * 0.12 + 0.85);
    });
  },
};

// tutorial narration via the browser's speech synthesis (best-effort)
function narrate(text, pitch = 1.15) {
  try {
    if (typeof Settings !== 'undefined' && !Settings.voice) return;
    if (!('speechSynthesis' in window)) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text.replace(/[✨💩🧟🧍🌈💀🌠“”]/g, ''));
    u.pitch = pitch;                       // low pitch = Prismalox, the voice in the horn
    u.rate = pitch < 1 ? 0.92 : 1.05;
    u.volume = 0.9;
    speechSynthesis.speak(u);
  } catch (e) { /* narration is optional */ }
}

/* =====================================================================
   2. INPUT — keyboard + mouse (pointer lock) + touch (joystick, buttons)
   ===================================================================== */
const Input = {
  keys: {}, spray: false, beamPressed: false, jumpPressed: false, novaPressed: false, pingPressed: false,
  lookDX: 0, lookDY: 0, joy: { x: 0, y: 0 },
  locked: false,

  consumeLook() { const r = [this.lookDX, this.lookDY]; this.lookDX = 0; this.lookDY = 0; return r; },
};

window.addEventListener('keydown', e => {
  Input.keys[e.code] = true;
  if (Game.state === 'intro') { introSkip = true; return; }
  if (e.code === 'Space') { Input.jumpPressed = true; e.preventDefault(); }
  if (e.code === 'KeyQ') Input.beamPressed = true;
  if (e.code === 'KeyF') Input.novaPressed = true;
  if (e.code === 'KeyC') Input.pingPressed = true;
  if (e.code === 'KeyT') toggleSkillPanel();
  if (e.code === 'KeyR' && e.shiftKey) cycleModelYaw();
  else if (e.code === 'KeyR') cycleNozzle(1);
  // live muzzle placement: [ ] move the jet origin back/forward, ; ' down/up
  if (e.code === 'BracketRight') nudgeNozzle('fwd', 0.15);
  if (e.code === 'BracketLeft') nudgeNozzle('fwd', -0.15);
  if (e.code === 'Quote') nudgeNozzle('up', 0.1);
  if (e.code === 'Semicolon') nudgeNozzle('up', -0.1);
  if (Game.state === 'perks' && /^Digit[123]$/.test(e.code)) takePerk(+e.code.slice(5) - 1);
  if (e.code === 'KeyP' || e.code === 'Escape') togglePause();
});
window.addEventListener('keyup', e => { Input.keys[e.code] = false; });
window.addEventListener('contextmenu', e => e.preventDefault());

window.addEventListener('mousedown', e => {
  if (Game.state === 'intro') { introSkip = true; return; }
  if (!Input.locked) return;
  if (e.button === 0) Input.spray = true;
  if (e.button === 2) Input.beamPressed = true;
});
window.addEventListener('touchstart', () => {
  if (Game.state === 'intro') introSkip = true;
}, { passive: true });
window.addEventListener('mouseup', e => { if (e.button === 0) Input.spray = false; });
window.addEventListener('mousemove', e => {
  if (!Input.locked) return;
  Input.lookDX += e.movementX; Input.lookDY += e.movementY;
});
document.addEventListener('pointerlockchange', () => {
  Input.locked = document.pointerLockElement === canvas;
  resumeHint.classList.toggle('hidden', Input.locked || IS_TOUCH || Game.state !== 'playing');
});

// ---- touch: left joystick = move, right-side drag = look, buttons = actions ----
function setupTouch() {
  document.getElementById('touchUI').style.display = 'block';
  document.getElementById('controlsText').innerHTML =
    '<b>Left stick</b> move · <b>drag right side</b> look<br><b>SPRAY</b> hold to hose · <b>BEAM</b> magic blast · <b>JUMP</b><br><b>JUMP again in mid-air</b> to ground pound.<br>Fog is thick out there — <b>trust your ears</b>.';

  const joyBase = document.getElementById('joyBase'), joyKnob = document.getElementById('joyKnob');
  let joyId = null, lookId = null, lookLast = null;

  function joyCenter() { const r = joyBase.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }

  window.addEventListener('touchstart', e => {
    for (const t of e.changedTouches) {
      const el = document.elementFromPoint(t.clientX, t.clientY);
      if (el && el.closest && el.closest('.tbtn')) continue; // buttons handle themselves
      if (t.clientX < innerWidth * 0.45 && joyId === null) {
        joyId = t.identifier;
      } else if (lookId === null) {
        lookId = t.identifier; lookLast = [t.clientX, t.clientY];
      }
    }
  }, { passive: false });

  window.addEventListener('touchmove', e => {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier === joyId) {
        const [cx, cy] = joyCenter();
        let dx = (t.clientX - cx) / 55, dy = (t.clientY - cy) / 55;
        const m = Math.hypot(dx, dy); if (m > 1) { dx /= m; dy /= m; }
        Input.joy.x = dx; Input.joy.y = dy;
        joyKnob.style.left = 35 + dx * 32 + 'px'; joyKnob.style.top = 35 + dy * 32 + 'px';
      } else if (t.identifier === lookId) {
        Input.lookDX += (t.clientX - lookLast[0]) * 2.2;
        Input.lookDY += (t.clientY - lookLast[1]) * 2.2;
        lookLast = [t.clientX, t.clientY];
      }
    }
  }, { passive: false });

  const endTouch = e => {
    for (const t of e.changedTouches) {
      if (t.identifier === joyId) { joyId = null; Input.joy.x = 0; Input.joy.y = 0; joyKnob.style.left = '35px'; joyKnob.style.top = '35px'; }
      if (t.identifier === lookId) lookId = null;
    }
  };
  window.addEventListener('touchend', endTouch);
  window.addEventListener('touchcancel', endTouch);

  const bindBtn = (id, down, up) => {
    const el = document.getElementById(id);
    el.addEventListener('touchstart', e => { e.preventDefault(); e.stopPropagation(); el.classList.add('active'); down(); }, { passive: false });
    el.addEventListener('touchend', e => { e.preventDefault(); el.classList.remove('active'); if (up) up(); }, { passive: false });
  };
  bindBtn('btnSpray', () => Input.spray = true, () => Input.spray = false);
  bindBtn('btnBeam', () => Input.beamPressed = true);
  bindBtn('btnJump', () => Input.jumpPressed = true);
  bindBtn('btnNova', () => Input.novaPressed = true);
  bindBtn('btnPing', () => Input.pingPressed = true);
}

/* =====================================================================
   3. RENDERER, SCENE, FOG
   ===================================================================== */
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75)); // clamp for mid-range GPUs
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping; // filmic response, cinematic highlights
renderer.toneMappingExposure = 0.98; // pulled back from 1.15 to recover highlight detail
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(CFG.fogColor);
scene.fog = new THREE.FogExp2(CFG.fogColor, CFG.fogDensity);

const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 520); // far plane must clear the sky sphere (r 420) or it clips into a fog-colored dome

scene.add(new THREE.HemisphereLight(0xcfe3f2, 0x51606e, 1.1));
const sun = new THREE.DirectionalLight(0xfff2dd, 0.85);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.left = -28; sun.shadow.camera.right = 28;
sun.shadow.camera.top = 28; sun.shadow.camera.bottom = -28;
sun.shadow.camera.near = 5; sun.shadow.camera.far = 160;
sun.shadow.bias = -0.0006;
scene.add(sun);
scene.add(sun.target); // sun follows the player so the shadow window stays tight

// post-processing: MSAA render target -> bloom -> vignette -> tonemap/output
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(innerWidth, innerHeight,
  { samples: 4, type: THREE.HalfFloatType }));
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), 0.42, 0.6, 0.82); // higher threshold: only real light sources bloom, not the whole sky
composer.addPass(bloom);
// vignette + film grain + damage chromatic aberration, all in one pass —
// three filmic touches for the cost of the one we already paid for
const vignette = new ShaderPass({
  name: 'VignetteShader',
  uniforms: { tDiffuse: { value: null }, strength: { value: 0.9 },
              time: { value: 0 }, grain: { value: 0.032 }, aberration: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `varying vec2 vUv; uniform sampler2D tDiffuse; uniform float strength;
    uniform float time; uniform float grain; uniform float aberration;
    void main(){
      float d = distance(vUv, vec2(0.5));
      vec4 c;
      if (aberration > 0.001) {
        // channels separate radially — the lens itself feels the hit
        vec2 dir = (vUv - vec2(0.5)) * aberration * (0.35 + d);
        c.r = texture2D(tDiffuse, vUv + dir).r;
        c.g = texture2D(tDiffuse, vUv).g;
        c.b = texture2D(tDiffuse, vUv - dir).b;
        c.a = 1.0;
      } else {
        c = texture2D(tDiffuse, vUv);
      }
      c.rgb *= 1.0 - strength * smoothstep(0.4, 0.78, d);
      // per-pixel hash grain, animated — breaks up the flat fog gradients
      float n = fract(sin(dot(vUv * vec2(1.0, 1.3) + fract(time * 0.61), vec2(12.9898, 78.233))) * 43758.5453);
      c.rgb += (n - 0.5) * grain;
      gl_FragColor = c;
    }`,
});
composer.addPass(vignette);
composer.addPass(new OutputPass());

window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
});

// soft radial glow texture, reused by every glow sprite / particle system
function makeGlowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.5)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
const GLOW_TEX = makeGlowTexture();

function glowSprite(color, scale, opacity = 0.8) {
  const m = new THREE.SpriteMaterial({ map: GLOW_TEX, color, transparent: true, opacity,
    blending: THREE.AdditiveBlending, depthWrite: false });
  const s = new THREE.Sprite(m); s.scale.setScalar(scale);
  return s;
}

/* =====================================================================
   4. THE BRIDGE — low-poly Golden Gate: deck, towers, cables, hangers
   ===================================================================== */
const GG_ORANGE = 0xc2402a;
const bridgeMat = new THREE.MeshStandardMaterial({ color: GG_ORANGE, roughness: 0.75 });

// procedural asphalt: speckle noise + hairline cracks, tiled down the deck
function makeAsphaltTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#43474e'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 9000; i++) {
    const v = 50 + (Math.random() * 45 | 0);
    g.fillStyle = `rgba(${v},${v},${v + 5},0.28)`;
    g.fillRect(Math.random() * 256, Math.random() * 256, 1.6, 1.6);
  }
  g.strokeStyle = 'rgba(18,20,24,0.45)'; g.lineWidth = 1;
  for (let i = 0; i < 6; i++) {
    g.beginPath();
    let x = Math.random() * 256, y = Math.random() * 256;
    g.moveTo(x, y);
    for (let s = 0; s < 6; s++) { x += (Math.random() - 0.5) * 70; y += (Math.random() - 0.5) * 70; g.lineTo(x, y); }
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(3, 32);
  t.anisotropy = 4;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const deckMat = new THREE.MeshStandardMaterial({ map: makeAsphaltTexture(), roughness: 0.95 });

// weathered plank boardwalk texture — same CanvasTexture trick as the asphalt
function makePlankTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#6e5236'; g.fillRect(0, 0, 256, 256);
  for (let row = 0; row < 8; row++) {
    const y = row * 32;
    g.fillStyle = ['#75593b', '#684d31', '#7c5f40', '#6a4f34'][row % 4];
    g.fillRect(0, y, 256, 30);
    g.fillStyle = 'rgba(30,20,12,0.9)'; g.fillRect(0, y + 30, 256, 2); // seam
    for (let i = 0; i < 26; i++) { // grain streaks
      g.fillStyle = `rgba(${40 + Math.random() * 30 | 0},${28 + Math.random() * 20 | 0},16,${0.12 + Math.random() * 0.15})`;
      g.fillRect(Math.random() * 256, y + 2 + Math.random() * 26, 12 + Math.random() * 60, 1);
    }
    g.fillStyle = 'rgba(20,14,8,0.75)'; // plank-end joints
    for (let i = 0; i < 3; i++) g.fillRect(Math.random() * 256, y, 2, 30);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 18);
  return tex;
}

/* ---------------------------------------------------------------------
   BUILD 9 — verticality. The pier was a flat corridor, which gave the jet
   boost nowhere to go and made every fight the same fight. Cargo
   containers, kiosk roofs and springy awnings turn it into terrain: cover
   to break line of sight, high ground to fight from, and a bounce-and-jet
   route along the tops for anyone who wants to skip the deck entirely.
   --------------------------------------------------------------------- */
const platforms = [];   // {x0,x1,z0,z1,y} axis-aligned tops the player can stand on
const bouncePads = [];  // {x,z,r,power,mesh}

// highest platform top under (x,z) that we're allowed to land on. `fromY` is
// where we were before this frame's fall, so you pass up through a platform
// from underneath instead of snapping onto its roof.
function groundHeightAt(x, z, fromY) {
  let best = 0;
  for (const p of platforms) {
    if (x < p.x0 || x > p.x1 || z < p.z0 || z > p.z1) continue;
    if (p.y > best && fromY >= p.y - 0.35) best = p.y;
  }
  return best;
}

function addPlatform(mesh, x, z, w, d, y) {
  platforms.push({ x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2, y });
  if (mesh) camBlockers.push(mesh);
}

function buildTerrain(grp) {
  const steelA = new THREE.MeshStandardMaterial({ color: 0x9a4a3a, roughness: 0.7, metalness: 0.25 });
  const steelB = new THREE.MeshStandardMaterial({ color: 0x2f6a7a, roughness: 0.7, metalness: 0.25 });
  const steelC = new THREE.MeshStandardMaterial({ color: 0x6a6a3a, roughness: 0.7, metalness: 0.25 });
  const mats = [steelA, steelB, steelC];
  const ribGeo = new THREE.BoxGeometry(0.12, 2.3, 0.12);
  // [x, z, width, depth, height, rotated?]
  const crates = [
    [-7.5, -26, 5.4, 2.6, 2.5], [7.6, -40, 2.6, 5.4, 2.5], [-8.2, -55, 2.6, 5.2, 3.6],
    [8.4, -70, 5.2, 2.6, 2.5], [0, -88, 6.2, 2.8, 3.2], [-8.6, -104, 2.8, 5.4, 2.5],
    [8.2, -120, 5.4, 2.8, 3.8], [-7.4, -137, 5.4, 2.8, 2.5], [8.6, -152, 2.8, 5.4, 3.2],
    [0, -166, 6.4, 2.8, 2.5], [-8.4, -182, 2.8, 5.4, 3.6], [7.8, -196, 5.4, 2.8, 2.5],
  ];
  crates.forEach(([x, z, w, d, h], i) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mats[i % 3]);
    m.position.set(x, h / 2, z);
    m.castShadow = true; m.receiveShadow = true;
    grp.add(m);
    // corrugation ribs so a plain box reads as a shipping container
    for (let k = -1; k <= 1; k++) {
      const rib = new THREE.Mesh(ribGeo, mats[(i + 1) % 3]);
      rib.scale.y = h / 2.3;
      rib.position.set(x + (w > d ? k * w * 0.28 : w / 2 + 0.01), h / 2, z + (w > d ? d / 2 + 0.01 : k * d * 0.28));
      grp.add(rib);
    }
    addPlatform(m, x, z, w, d, h);
  });

  // SECOND TIER (BUILD 13): the ground pound needs somewhere worth falling
  // from. Six of the containers get a smaller crate stacked on them, which
  // puts a roof at 5.5–7 m — high enough for a SKY SLAM — right over the
  // stretches where the horde gathers. Reachable by jet boost from the lower
  // tier, so the vertical route is earned rather than free.
  const stacks = [
    [-7.5, -26, 3.4, 2.2, 2.6, 2.5], [-8.2, -55, 2.2, 3.4, 2.4, 3.6],
    [0, -88, 4.0, 2.4, 2.8, 3.2], [8.2, -120, 3.4, 2.4, 2.6, 3.8],
    [0, -166, 4.2, 2.4, 3.0, 2.5], [-8.4, -182, 2.4, 3.4, 2.4, 3.6],
  ];
  stacks.forEach(([x, z, w, d, h, baseH], i) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mats[(i + 2) % 3]);
    m.position.set(x, baseH + h / 2, z);
    m.castShadow = true; m.receiveShadow = true;
    grp.add(m);
    const rim = glowSprite(0xffd94f, 2.4, 0.22); // a faint crown so the high ground reads through fog
    rim.position.set(x, baseH + h + 0.5, z);
    grp.add(rim);
    addPlatform(m, x, z, w, d, baseH + h);
  });

  // springy awnings: land on one and it throws you back up. Chained with the
  // jet boost they're a route along the rooftops.
  const padSpots = [[3.4, -33], [-4.6, -62], [5.2, -96], [-5.4, -128], [4.8, -160], [-3.6, -190]];
  const padGeo = new THREE.CylinderGeometry(1.5, 1.6, 0.28, 14);
  for (const [x, z] of padSpots) {
    const pad = new THREE.Mesh(padGeo, new THREE.MeshStandardMaterial({
      color: 0xff5fa2, roughness: 0.45, emissive: 0xff2f8a, emissiveIntensity: 0.5 }));
    pad.position.set(x, 0.14, z);
    pad.receiveShadow = true;
    grp.add(pad);
    const ring = glowSprite(0xff8fd0, 3.6, 0.35);
    ring.position.set(x, 0.5, z);
    grp.add(ring);
    bouncePads.push({ x, z, r: 1.9, power: 15.5, mesh: pad, glow: ring, t: 0 });
  }
}

function updateBouncePads(dt, t) {
  for (const b of bouncePads) {
    b.t = Math.max(0, b.t - dt * 3);
    b.mesh.scale.y = 1 - b.t * 0.55;
    b.glow.material.opacity = 0.3 + b.t * 0.5 + 0.06 * Math.sin(t * 4);
  }
}

// called from the player's ground-contact code
function tryBounce(mult = 1) {
  for (const b of bouncePads) {
    const dx = Player.pos.x - b.x, dz = Player.pos.z - b.z;
    if (dx * dx + dz * dz > b.r * b.r) continue;
    Player.vel.y = b.power * mult;
    Player.onGround = false;
    b.t = 1;
    SFX.pop(panFor(new THREE.Vector3(b.x, 0.5, b.z)), 0.5);
    spawnGlitter(new THREE.Vector3(b.x, 0.6, b.z), 22, 4);
    Player._fovPunch = Math.max(Player._fovPunch, 4);
    return true;
  }
  return false;
}

const ambientSeaLions = [];
// solid geometry the camera boom collides against (shops, carts, pilings) —
// a short explicit list, because raycasting the whole scene every frame is waste
const camBlockers = [];
function buildWharf() {
  const B = CFG.bridge, len = B.zStart - B.zEnd, zMid = (B.zStart + B.zEnd) / 2;
  const grp = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0x5e462c, roughness: 0.85 });
  const woodDark = new THREE.MeshStandardMaterial({ color: 0x4a3620, roughness: 0.9 });

  // boardwalk deck
  const plankMat = new THREE.MeshStandardMaterial({ map: makePlankTexture(), roughness: 0.9 });
  const deck = new THREE.Mesh(new THREE.BoxGeometry(B.width, 1, len), plankMat);
  deck.position.set(0, -0.5, zMid);
  deck.receiveShadow = true;
  grp.add(deck);

  // Pilings and railings repeat ~230 times down a 243m pier. As individual
  // meshes that was ~230 draw calls of scenery that never moves or reacts —
  // more than the entire Level 1 scene. InstancedMesh renders each family in
  // one call. Anything static and repeated on this map should go this way.
  const _m4 = new THREE.Matrix4();
  // ...but ONE InstancedMesh spanning the whole pier can never frustum-cull,
  // so it draws all 243m of railing even when you're facing the other way.
  // Chunk by z: each chunk is a single draw call AND culls as a unit.
  const CHUNK = 55;
  const instanced = (geo, mat, placements) => {
    const chunks = new Map();
    for (const pl of placements) {
      const k = Math.floor(pl[2] / CHUNK);
      if (!chunks.has(k)) chunks.set(k, []);
      chunks.get(k).push(pl);
    }
    for (const group of chunks.values()) {
      const im = new THREE.InstancedMesh(geo, mat, group.length);
      group.forEach(([x, y, z, rx], i) => {
        _m4.makeRotationX(rx || 0);
        _m4.setPosition(x, y, z);
        im.setMatrixAt(i, _m4);
      });
      im.instanceMatrix.needsUpdate = true;
      // scenery this small doesn't need to cast into the 28m shadow window
      im.castShadow = false;
      grp.add(im);
    }
  };

  // pilings under the pier edges — barnacle-dark, poking out of the water
  const pilingSpots = [];
  for (const side of [-1, 1]) {
    for (let z = B.zStart; z > B.zEnd; z -= 7) pilingSpots.push([side * (B.width / 2 - 0.2), -2.2, z]);
  }
  instanced(new THREE.CylinderGeometry(0.32, 0.38, 5, 8), woodDark, pilingSpots);

  // post-and-rail wooden railings (waist height, rope sag between posts)
  const ropeMat = new THREE.MeshStandardMaterial({ color: 0x9a8563, roughness: 0.95 });
  const postSpots = [], ropeSpots = [];
  for (const side of [-1, 1]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, len), wood);
    rail.position.set(side * (B.width / 2 - 0.4), 1.35, zMid);
    grp.add(rail);
    for (let z = B.zStart; z > B.zEnd; z -= 6) {
      postSpots.push([side * (B.width / 2 - 0.4), 0.75, z]);
      if (z - 6 > B.zEnd) ropeSpots.push([side * (B.width / 2 - 0.4), 0.95, z - 3, Math.PI / 2]);
    }
  }
  instanced(new THREE.BoxGeometry(0.18, 1.5, 0.18), wood, postSpots);
  instanced(new THREE.CylinderGeometry(0.035, 0.035, 5.7, 5), ropeMat, ropeSpots);

  // shop row along the -x side: colorful shacks, striped awnings, glowing signs
  const shopDefs = [ // [z, width, hull color, awning color, sign color]
    [-8, 9, 0x7e4a5a, 0xe8e4da, 0x8fe0ff], [-24, 11, 0x4a6a5e, 0xd66a6a, 0xffd94f],
    [-42, 8, 0x5a5a7e, 0xe8b04a, 0xff9ae0], [-58, 10, 0x6a4a3a, 0x9ad6c2, 0x9fdcff],
    [-76, 9, 0x44585a, 0xe8e4da, 0xffb36a], [-96, 10, 0x5e4a6e, 0xd6c26a, 0x8fffc9],
    [-116, 9, 0x3f5a6a, 0xe8a4b8, 0xffd0f0], [-136, 11, 0x6a5a3f, 0xa8d6e8, 0xfff08f],
    [-158, 9, 0x4a3f5a, 0xd6e8a8, 0x9fb0ff], [-180, 10, 0x5a6a4a, 0xe8b8d6, 0x8fe0ff],
  ];
  for (const [z, w, hull, awn, sign] of shopDefs) {
    const shopX = -(B.width / 2 + 3.2);
    const shop = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(6, 4.6, w),
      new THREE.MeshStandardMaterial({ color: hull, roughness: 0.8 }));
    body.position.y = 2.3; body.castShadow = true;
    shop.add(body);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(6.6, 0.35, w + 0.6), woodDark);
    roof.position.y = 4.75;
    shop.add(roof);
    // striped awning slanting toward the pier
    const awning = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.12, w - 1),
      new THREE.MeshStandardMaterial({ color: awn, roughness: 0.7 }));
    awning.position.set(3.6, 3.4, 0); awning.rotation.z = -0.28;
    shop.add(awning);
    // glowing sign strip — reads through the dusk fog
    const signMesh = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.7, w * 0.6),
      new THREE.MeshStandardMaterial({ color: sign, emissive: sign, emissiveIntensity: 1.6, roughness: 0.4 }));
    signMesh.position.set(3.12, 4.1, 0);
    shop.add(signMesh);
    const glow = glowSprite(sign, 3.4, 0.35);
    glow.position.set(3.4, 4.1, 0);
    shop.add(glow);
    shop.position.set(shopX, 0, z);
    grp.add(shop);
    camBlockers.push(body, roof);
  }

  // floating docks on the +x side, hauled-out sea lions dozing on them —
  // they bob with the tide (updateSeaLions) and sell "Fisherman's Wharf"
  const slBody = new THREE.CapsuleGeometry(0.55, 1.5, 4, 8);
  const slMat = new THREE.MeshStandardMaterial({ color: 0x6b5643, roughness: 0.7 });
  const slDark = new THREE.MeshStandardMaterial({ color: 0x57452f, roughness: 0.75 });
  for (const [dz, n] of [[-16, 2], [-38, 3], [-64, 2], [-98, 3], [-132, 2], [-166, 3]]) {
    const dock = new THREE.Group();
    const plat = new THREE.Mesh(new THREE.BoxGeometry(5.5, 0.5, 7), woodDark);
    dock.add(plat);
    for (let i = 0; i < n; i++) {
      const sl = new THREE.Group();
      const body = new THREE.Mesh(slBody, i % 2 ? slMat : slDark);
      body.rotation.x = Math.PI / 2 - 0.18; // nose-up doze
      body.position.y = 0.55;
      sl.add(body);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.38, 8, 6), i % 2 ? slMat : slDark);
      head.position.set(0, 1.15, 1.05);
      sl.add(head);
      const snout = new THREE.Mesh(new THREE.SphereGeometry(0.18, 6, 5), slDark);
      snout.position.set(0, 1.05, 1.38);
      sl.add(snout);
      for (const s of [-1, 1]) { // front flippers
        const flip = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.6, 5), i % 2 ? slDark : slMat);
        flip.rotation.z = s * 2.1;
        flip.position.set(s * 0.55, 0.35, 0.5);
        sl.add(flip);
      }
      sl.position.set((i - (n - 1) / 2) * 1.7, 0.25, (Math.random() - 0.5) * 2);
      sl.rotation.y = (Math.random() - 0.5) * 1.2;
      dock.add(sl);
      const entry = { g: sl, phase: Math.random() * 10, hop: 0 };
      // spray a dozing sea lion and it barks and does a happy hop — pure
      // delight, plus a trickle of rainbow charge for the showmanship
      entry.ent = { barkCd: 0,
        clean() {
          if (this.barkCd > 0) return;
          this.barkCd = 2.5;
          entry.hop = 1;
          const wp = sl.getWorldPosition(new THREE.Vector3());
          SFX.groan(panFor(wp), 0.4);
          spawnFloatText(wp.add(new THREE.Vector3(0, 1.5, 0)), 'ARF!', '#9fdcff');
          Meters.rainbow = Math.min(100, Meters.rainbow + 2);
        } };
      body.userData.entity = entry.ent;
      head.userData.entity = entry.ent;
      cleanTargets.push(body, head);
      ambientSeaLions.push(entry);
    }
    dock.position.set(B.width / 2 + 4.5, -1.5, dz);
    grp.add(dock);
    ambientSeaLions.push({ g: dock, phase: dz, isDock: true });
  }

  // two wooden fish carts (reuse the car suspension springs — jet rocks them)
  const cartBody = new THREE.BoxGeometry(1.6, 0.9, 2.6);
  [[4.8, -28, 0x7a5a33], [-4.6, -52, 0x8a6a43], [7.5, -118, 0x6a5a43], [-8, -152, 0x7a6a53]].forEach(([x, z, col]) => {
    const m = new THREE.MeshStandardMaterial({ color: col, roughness: 0.85 });
    const b = new THREE.Mesh(cartBody, m); b.position.set(x, 0.45, z); b.rotation.y = (Math.random() - 0.5) * 0.6;
    const tub = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.3, 2.2),
      new THREE.MeshStandardMaterial({ color: 0x9fdcff, metalness: 0.4, roughness: 0.3 })); // ice tub
    tub.position.set(0, 0.6, 0); b.add(tub);
    const wheelGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.12, 10);
    for (const [wx, wz] of [[-0.75, 0.8], [0.75, 0.8], [-0.75, -0.8], [0.75, -0.8]]) {
      const w = new THREE.Mesh(wheelGeo, woodDark);
      w.rotation.z = Math.PI / 2; w.position.set(wx, -0.35, wz);
      b.add(w);
    }
    b.castShadow = true;
    grp.add(b);
    camBlockers.push(b);
    cars.push({ mesh: b, rock: 0, rockV: 0 });
  });

  // the bay — right below the pier this time, breathing swells at dusk
  const seaGeo = new THREE.PlaneGeometry(900, 900, 40, 40); // must reach past the sky sphere (r 420) or its edge silhouettes at the horizon
  seaMesh = new THREE.Mesh(seaGeo,
    new THREE.MeshStandardMaterial({ color: 0x35415e, roughness: 0.3, metalness: 0.35,
      flatShading: true }));
  seaMesh.rotation.x = -Math.PI / 2; seaMesh.position.y = -2.6;
  seaBaseZ = Float32Array.from(seaGeo.attributes.position.array); // rest positions
  grp.add(seaMesh);

  // dusk sky: deep violet overhead melting into hot pink at the waterline
  const skyGeo = new THREE.SphereGeometry(420, 24, 16);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, fog: false, depthWrite: false,
    uniforms: { top: { value: new THREE.Color(0x2e2440) }, bot: { value: new THREE.Color(0xc76a7e) } },
    vertexShader: 'varying float vh; void main(){ vh = normalize(position).y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'varying float vh; uniform vec3 top; uniform vec3 bot; void main(){ gl_FragColor = vec4(mix(bot, top, smoothstep(-0.1, 0.55, vh)), 1.0); }',
  });
  skyMesh = new THREE.Mesh(skyGeo, skyMat);
  scene.add(skyMesh);

  // the setting sun, low over the water off the sea-lion side
  const sunGlow = glowSprite(0xffc9a8, 90, 0.6);
  sunGlow.material.fog = false;
  sunGlow.position.set(120, 26, -70);
  grp.add(sunGlow);

  buildTerrain(grp);
  scene.add(grp);
}

// tide bob for the docks, a lazy head-sway for the dozing sea lions, and
// the happy hop a sea lion does when the player sprays it (see buildWharf)
function updateSeaLions(t, dt = 0.016) {
  for (const s of ambientSeaLions) {
    if (s.ent) s.ent.barkCd = Math.max(0, s.ent.barkCd - dt);
    if (Settings.reduceMotion) continue;
    if (s.isDock) {
      s.g.position.y = -1.5 + Math.sin(t * 0.9 + s.phase) * 0.18;
    } else {
      s.g.rotation.z = Math.sin(t * 1.4 + s.phase) * 0.06;
      if (s.hop > 0) {
        s.hop = Math.max(0, s.hop - dt * 1.4);
        s.g.position.y = 0.25 + Math.sin(s.hop * 9) * 0.22 * s.hop;
        s.g.rotation.z += Math.sin(s.hop * 18) * 0.15 * s.hop;
      }
    }
  }
}

// --- animated ocean + circling seagulls, both cheap ambient life ---
let seaMesh, seaBaseZ, skyMesh;
function updateOcean(t) {
  if (!seaMesh || Settings.reduceMotion) return;
  const p = seaMesh.geometry.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = seaBaseZ[i * 3], y = seaBaseZ[i * 3 + 1];
    p.array[i * 3 + 2] = Math.sin(x * 0.05 + t * 0.7) * 1.6 + Math.cos(y * 0.06 + t * 0.5) * 1.4;
  }
  p.needsUpdate = true;
  seaMesh.geometry.computeVertexNormals();
}

const gulls = [];
function buildGulls() {
  const gullMat = new THREE.MeshBasicMaterial({ color: 0xf4f4ee, fog: true });
  for (let i = 0; i < 5; i++) {
    // a simple V — two angled wing quads — is all a distant gull needs
    const g = new THREE.Group();
    for (const s of [-1, 1]) {
      const wing = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.22), gullMat);
      wing.position.x = s * 0.42; wing.rotation.z = s * 0.5; wing.rotation.y = s * 0.3;
      g.add(wing);
    }
    g.userData = { r: 22 + Math.random() * 26, cy: 30 + Math.random() * 22,
      cz: -30 - Math.random() * 170, sp: 0.15 + Math.random() * 0.2, ph: Math.random() * 6.28,
      wings: g.children };
    scene.add(g); gulls.push(g);
  }
}
function updateGulls(t) {
  for (const g of gulls) {
    const u = g.userData, a = t * u.sp + u.ph;
    g.position.set(Math.cos(a) * u.r, u.cy + Math.sin(a * 2) * 2, u.cz + Math.sin(a) * u.r);
    g.rotation.y = -a + Math.PI / 2;
    const flap = Math.sin(t * 6 + u.ph) * 0.4;               // slow wing-beat
    u.wings[0].rotation.z = 0.5 + flap; u.wings[1].rotation.z = -0.5 - flap;
  }
}

/* =====================================================================
   5. METEOR CRATER — rainbow impact site, the level's starting point
   ===================================================================== */
let craterParticles, craterLight;
function buildCrater() {
  const grp = new THREE.Group();
  grp.position.set(0, 0, 6);

  const scorch = new THREE.Mesh(new THREE.CircleGeometry(5, 24),
    new THREE.MeshBasicMaterial({ color: 0x1c1420 }));
  scorch.rotation.x = -Math.PI / 2; scorch.position.y = 0.03;
  grp.add(scorch);

  // glowing rainbow rocks around the rim
  const rockGeo = new THREE.IcosahedronGeometry(0.45, 0);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const mat = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.4,
      emissive: new THREE.Color().setHSL(i / 10, 0.9, 0.55), emissiveIntensity: 1.0 });
    const r = new THREE.Mesh(rockGeo, mat);
    r.position.set(Math.cos(a) * 4.4, 0.3, Math.sin(a) * 4.4);
    r.scale.setScalar(0.5 + Math.random() * 0.6);
    r.rotation.set(Math.random() * 3, Math.random() * 3, 0);
    grp.add(r);
  }

  // rising rainbow particle fountain
  const N = 120;
  const pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
  const c = new THREE.Color();
  for (let i = 0; i < N; i++) {
    pos[i * 3] = (Math.random() - 0.5) * 7;
    pos[i * 3 + 1] = Math.random() * 6;
    pos[i * 3 + 2] = (Math.random() - 0.5) * 7;
    c.setHSL(Math.random(), 0.9, 0.65);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  craterParticles = new THREE.Points(geo, new THREE.PointsMaterial({
    map: GLOW_TEX, size: 0.5, vertexColors: true, transparent: true, opacity: 0.85,
    blending: THREE.AdditiveBlending, depthWrite: false }));
  grp.add(craterParticles);

  const craterGlow = glowSprite(0xff9ae0, 6, 0.25);
  craterGlow.position.y = 1;
  grp.add(craterGlow);

  // color-cycling light — the meteor's magic spills onto the roadway
  craterLight = new THREE.PointLight(0xff9ae0, 4, 26);
  craterLight.position.y = 2.5;
  grp.add(craterLight);
  scene.add(grp);
}

function updateCrater(dt, t) {
  const p = craterParticles.geometry.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let y = p.getY(i) + dt * (0.8 + (i % 5) * 0.3);
    if (y > 6) y = 0;
    p.setY(i, y);
  }
  p.needsUpdate = true;
  craterLight.color.setHSL((t * 0.08) % 1, 0.85, 0.6); // slow rainbow cycle
}

/* =====================================================================
   6. FOG PARTICLES — drifting soft sprites layered over FogExp2
   ===================================================================== */
const fogSprites = [];
function buildFogParticles() {
  for (let i = 0; i < 34; i++) { // more mist for 3x the pier
    const s = glowSprite(0xdde8f0, 34 + Math.random() * 20, 0.035 + Math.random() * 0.035);
    s.position.set((Math.random() - 0.5) * 52,
                   1 + Math.random() * 8,
                   CFG.bridge.zStart - Math.random() * 235);
    s.userData.drift = 0.3 + Math.random() * 0.6;
    s.userData.phase = Math.random() * Math.PI * 2;
    fogSprites.push(s); scene.add(s);
  }
}
function updateFogParticles(dt, t) {
  for (const s of fogSprites) {
    s.position.x += Math.sin(t * 0.1 + s.userData.phase) * s.userData.drift * dt;
    s.position.z += s.userData.drift * dt * 0.6;
    if (s.position.z > CFG.bridge.zStart + 10) s.position.z = CFG.bridge.zEnd + 20;
  }
}

/* =====================================================================
   7. GLITTER BURSTS — pooled rainbow particle explosions
      (this is the payoff for every clean — make it generous)
   ===================================================================== */
const bursts = [];
/* Glitter, on a budget.

   Every burst is additive and bloomed, so the cost of one is invisible and
   the cost of nine at once is a white rectangle where the fight used to be.
   A seven-kill chain slam asks for ~1200 particles in a single frame, at
   LEGENDARY, where `glitterMul` makes each burst *bigger* — exactly backwards
   at the one moment readability matters most.

   So bursts request what they'd like and get what's left. Past the soft
   budget each new burst is scaled down, hard-floored at a few sparks so
   nothing ever silently produces no feedback at all. The result: a single
   kill looks exactly as it did, and a screen-clearing chain stays a picture
   of a fight rather than a flashbang.

   This only became visible once BUILD 14 made the headless stepper run
   `updateGlitter` — before that, particles froze at their spawn point in
   every screenshot ever taken of this game. */
const GLITTER_BUDGET = 520;
let glitterLive = 0;
function spawnGlitter(center, count = 70, power = 5) {
  count = Math.round(count);
  if (glitterLive > GLITTER_BUDGET) {
    const room = Math.max(0, 1 - (glitterLive - GLITTER_BUDGET) / GLITTER_BUDGET);
    count = Math.max(4, Math.round(count * room));
  }
  if (count <= 0) return;
  const pos = new Float32Array(count * 3), col = new Float32Array(count * 3);
  const vel = [];
  const c = new THREE.Color();
  for (let i = 0; i < count; i++) {
    pos[i * 3] = center.x; pos[i * 3 + 1] = center.y; pos[i * 3 + 2] = center.z;
    c.setHSL(Math.random(), 0.95, 0.65);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.7, Math.random() - 0.5)
      .normalize().multiplyScalar(power * (0.4 + Math.random()));
    vel.push(dir);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.PointsMaterial({ map: GLOW_TEX, size: 0.35, vertexColors: true,
    transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false });
  const pts = new THREE.Points(geo, mat);
  scene.add(pts);
  glitterLive += count;
  bursts.push({ pts, vel, life: 1.2, n: count });
}
function updateGlitter(dt) {
  for (let b = bursts.length - 1; b >= 0; b--) {
    const burst = bursts[b];
    burst.life -= dt;
    if (burst.life <= 0) {
      glitterLive -= burst.n;
      scene.remove(burst.pts); burst.pts.geometry.dispose(); burst.pts.material.dispose();
      bursts.splice(b, 1); continue;
    }
    const p = burst.pts.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const v = burst.vel[i];
      v.y -= 6 * dt;
      p.setXYZ(i, p.getX(i) + v.x * dt, Math.max(0.05, p.getY(i) + v.y * dt), p.getZ(i) + v.z * dt);
    }
    p.needsUpdate = true;
    burst.pts.material.opacity = Math.min(1, burst.life / 0.6);
  }
}

/* =====================================================================
   7.5 RIGID-BODY PHYSICS — a lightweight simulation for every loose
   object on the deck: velocity + gravity integration, ground bounce with
   restitution, rolling friction, angular tumble, rail/deck bounds, and
   player kick-through. The high-pressure jet applies real impulses, so
   cones and buckets go flying; dead zombies burst into ragdoll chunks
   that bounce and settle. No library — ~60 lines cover everything a
   deck-cleaning brawl needs.
   ===================================================================== */
const physBodies = [];
const _pv = new THREE.Vector3();

// abandoned cars rock on their suspension: a damped roll spring per car,
// excited by the water jet and by walking into them
const cars = [];
function updateCars(dt) {
  for (const c of cars) {
    // player shoulder-check: shove the suspension as you brush past
    _pv.subVectors(c.mesh.position, Player.pos); _pv.y = 0;
    if (_pv.lengthSq() < 4.6 && Math.abs(c.rockV) < 0.3) c.rockV += 0.5;
    c.rockV += (-c.rock * 60 - c.rockV * 5.5) * dt;
    c.rock = THREE.MathUtils.clamp(c.rock + c.rockV * dt, -0.09, 0.09);
    c.mesh.rotation.z = c.rock;
    c.mesh.position.y = 0.45 + Math.abs(c.rock) * 0.12; // lifts slightly as it rolls
  }
}
function addPhysBody(g, r, restY, opts = {}) {
  // aimY: where the water jet "grabs" the body relative to its origin. Props
  // built with their origin at the deck (cones, crates) default to mid-height;
  // center-origin bodies (beach balls) pass 0 or the jet axis overshoots them.
  const b = { g, r, restY, vel: new THREE.Vector3(), angVel: new THREE.Vector3(),
    rest: opts.rest ?? 0.38, ttl: opts.ttl ?? null, mass: opts.mass ?? 1,
    aimY: opts.aimY ?? restY + 0.15 };
  physBodies.push(b);
  return b;
}
function updatePhysics(dt) {
  for (let i = physBodies.length - 1; i >= 0; i--) {
    const b = physBodies[i], p = b.g.position;
    // ragdoll chunks expire: shrink out, then free the mesh
    if (b.ttl != null) {
      b.ttl -= dt;
      if (b.ttl <= 0) {
        scene.remove(b.g);
        b.g.traverse(o => { if (o.isMesh) o.geometry.dispose(); });
        physBodies.splice(i, 1); continue;
      }
      if (b.ttl < 0.5) b.g.scale.multiplyScalar(Math.max(0.01, 1 - dt * 2.2));
    }
    // integrate
    b.vel.y -= 22 * dt;
    p.addScaledVector(b.vel, dt);
    b.g.rotation.x += b.angVel.x * dt;
    b.g.rotation.y += b.angVel.y * dt;
    b.g.rotation.z += b.angVel.z * dt;
    // deck contact: bounce if falling fast, else rest + roll friction
    if (p.y <= b.restY) {
      p.y = b.restY;
      if (b.vel.y < -1.4) {
        b.vel.y *= -b.rest;
        b.angVel.set((Math.random() - 0.5) * 4, b.angVel.y, (Math.random() - 0.5) * 4);
        if (b.vel.y > 0.8 && Math.random() < 0.5) SFX.step(panFor(p)); // clatter
      } else b.vel.y = 0;
      const fr = Math.max(0, 1 - 5 * dt);
      b.vel.x *= fr; b.vel.z *= fr;
      b.angVel.multiplyScalar(Math.max(0, 1 - 6 * dt));
      // settle upright-ish tumble to a stop
      if (b.vel.lengthSq() < 0.01 && b.angVel.lengthSq() < 0.01) { b.vel.set(0, 0, 0); b.angVel.set(0, 0, 0); }
    }
    // rails + level bounds reflect
    const wallX = CFG.bridge.playHalfW;
    if (Math.abs(p.x) > wallX) { p.x = Math.sign(p.x) * wallX; b.vel.x *= -0.45; }
    if (p.z > CFG.bridge.zStart - 1) { p.z = CFG.bridge.zStart - 1; b.vel.z *= -0.45; }
    if (p.z < CFG.bridge.playZEnd) { p.z = CFG.bridge.playZEnd; b.vel.z *= -0.45; }
    // walking through a prop boots it aside — the deck feels solid
    _pv.subVectors(p, Player.pos); _pv.y = 0;
    const d = _pv.length();
    if (d < b.r + 0.55 && d > 1e-4) {
      _pv.normalize();
      b.vel.addScaledVector(_pv, 2.6 / b.mass);
      b.vel.y = Math.max(b.vel.y, 1.2 / b.mass);
      b.angVel.x += (Math.random() - 0.5) * 3;
    }

    // physics as a weapon: anything flying fast enough clobbers a zombie —
    // blast a traffic cone at one and it staggers, dazed, taking chip damage
    b.zHitCd = Math.max(0, (b.zHitCd || 0) - dt);
    if (b.zHitCd <= 0 && b.vel.lengthSq() > 12) {
      for (const z of zombies) {
        if (!z.alive) continue;
        if (p.distanceTo(z.group.position) < b.r + 0.75) {
          z.stun(0.8);
          z._propStun = 1.4; // remember it, so a kill right after reads as a STRIKE
          z.clean(10, p);
          b.vel.multiplyScalar(-0.35); // the prop caroms off
          b.vel.y = Math.max(b.vel.y, 2);
          b.zHitCd = 0.6;
          SFX.splat(panFor(p), 0.6);
          spawnGlitter(p.clone(), 12, 3);
          break;
        }
      }
    }
  }
}

// deck props: traffic cones, buckets and crates from the janitor job site
function buildProps() {
  const coneMat = new THREE.MeshStandardMaterial({ color: 0xd95f18, roughness: 0.6 });
  const bandMat = new THREE.MeshStandardMaterial({ color: 0xe8e4da, roughness: 0.4 });
  const bucketMat = new THREE.MeshStandardMaterial({ color: 0x3a6ea5, roughness: 0.45, metalness: 0.3 });
  const crateMat = new THREE.MeshStandardMaterial({ color: 0x7a5a33, roughness: 0.8 });
  const coneGeo = new THREE.ConeGeometry(0.22, 0.62, 10);
  const baseGeo = new THREE.BoxGeometry(0.42, 0.05, 0.42);
  const bandGeo = new THREE.CylinderGeometry(0.145, 0.175, 0.1, 10);
  const bucketGeo = new THREE.CylinderGeometry(0.2, 0.16, 0.34, 12, 1, true);
  const crateGeo = new THREE.BoxGeometry(0.5, 0.5, 0.5);
  const spots = [ // [kind, x, z] — crab-shack clutter along the pier
    ['cone', -2.5, -6], ['cone', -2.1, -7.1], ['cone', 3.2, -13], ['cone', -4.5, -24],
    ['cone', 5.1, -37], ['cone', -1.8, -49], ['cone', 2.6, -63], ['cone', -5.4, -76],
    ['bucket', 1.4, -9], ['bucket', -3.6, -31], ['bucket', 4.4, -55], ['bucket', 0.8, -70],
    ['crate', -5.8, -17], ['crate', 6, -44], ['crate', -6.1, -68], ['crate', 6.4, -66],
    ['cone', 8.5, -94], ['cone', -9.2, -108], ['cone', 7.8, -128], ['cone', -8.4, -144],
    ['cone', 9.1, -162], ['cone', -7.6, -182], ['bucket', 8.8, -102], ['bucket', -9.5, -122],
    ['bucket', 7.2, -146], ['bucket', -8.8, -176], ['crate', 9.6, -114], ['crate', -10, -140],
    ['crate', 8.2, -158], ['crate', -9.4, -192],
  ];
  for (const [kind, x, z] of spots) {
    const g = new THREE.Group();
    if (kind === 'cone') {
      const c = new THREE.Mesh(coneGeo, coneMat); c.position.y = 0.31; g.add(c);
      const band = new THREE.Mesh(bandGeo, bandMat); band.position.y = 0.34; g.add(band);
      const base = new THREE.Mesh(baseGeo, coneMat); base.position.y = 0.025; g.add(base);
      g.position.set(x, 0, z);
      addPhysBody(g, 0.3, 0, { mass: 0.7, rest: 0.3 });
    } else if (kind === 'bucket') {
      const bk = new THREE.Mesh(bucketGeo, bucketMat); bk.position.y = 0.17; g.add(bk);
      g.position.set(x, 0, z);
      addPhysBody(g, 0.26, 0, { mass: 0.6, rest: 0.45 });
    } else {
      const cr = new THREE.Mesh(crateGeo, crateMat); cr.position.y = 0.25; g.add(cr);
      g.position.set(x, 0, z);
      addPhysBody(g, 0.4, 0, { mass: 1.6, rest: 0.25 });
    }
    g.rotation.y = Math.random() * Math.PI * 2;
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    scene.add(g);
  }
}

// generic chunk burst: anything that dies wetly explodes into bouncing
// physics debris. Zombies add their trademark eye; piles pass their own
// material so the debris glows the pile's color.
function spawnChunkBurst(center, { count = 6, mat = null, eyeMat = null, rMin = 0.14, rMax = 0.3, power = 1 } = {}) {
  // a wiped-out swarm must not dump 600 rigid bodies into one frame
  if (physBodies.length > 150) count = Math.max(1, Math.round(count * 0.4));
  if (physBodies.length > 260) return;
  const scoopMat = mat || new THREE.MeshStandardMaterial({ color: 0x53341f, roughness: 0.55 });
  for (let i = 0; i < count; i++) {
    const isEye = eyeMat && i === count - 1;
    const r = isEye ? 0.12 : rMin + Math.random() * (rMax - rMin);
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6), isEye ? eyeMat : scoopMat);
    const g = new THREE.Group(); g.add(m);
    g.position.copy(center);
    g.position.y += 0.6 + Math.random() * 0.8;
    const b = addPhysBody(g, r, r, { ttl: 1.3 + Math.random() * 0.7, rest: 0.5, mass: 0.5 });
    const a = Math.random() * Math.PI * 2;
    b.vel.set(Math.cos(a) * (2 + Math.random() * 3) * power, (3.5 + Math.random() * 3) * power,
      Math.sin(a) * (2 + Math.random() * 3) * power);
    b.angVel.set((Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10);
    m.castShadow = true;
    scene.add(g);
  }
}

// ragdoll: a dead zombie bursts into bouncing poop scoops (+ the eye)
function spawnRagdoll(center) {
  spawnChunkBurst(center, { count: 6,
    eyeMat: new THREE.MeshStandardMaterial({ color: 0xffd23f, emissive: 0xffc400, emissiveIntensity: 0.9 }) });
}

/* =====================================================================
   8. CLEANABLES — poop piles + the raycast cleaning interface.
      Anything with mesh.userData.entity = {clean(amount, point)} can
      be hosed. Piles and zombies both implement it.
   ===================================================================== */
const cleanTargets = [];   // meshes the hose/beam raycast against
const piles = [];

/* ---------------------------------------------------------------------
   WEAK POINTS (BUILD 12) — the missing skill layer.

   Up to BUILD 11 the core verb was "hold the trigger until a number
   reaches zero": *that* you aimed mattered, *where* you aimed did not.
   Every pile and zombie now carries a gunk core — a hot orb riding
   proud of the body. Land the jet on it and the hit crits for 3x,
   refunds pressure and heats the hype meter; then the core bolts
   somewhere else, so crit uptime is an active tracking skill instead of
   a one-time aim. Kill something while its core is still lit and it
   detonates, splashing damage into everything nearby — and that splash
   can pop a weakened neighbour, which detonates in turn. Aim well and a
   pack unzips itself.

   BLAST deliberately cannot crit. The wide cone trades precision for
   coverage, which is what keeps the three nozzles genuinely different
   verbs rather than damage tiers.
   --------------------------------------------------------------------- */
const CRIT = {
  mul: 3,            // damage multiplier on a core hit
  refund: 22,        // pressure/sec refunded while you hold the core
  hype: 0.5,         // hype/sec while critting
  hold: 0.5,         // how long a core stays "lit" after the last crit
  pop: 0.45,         // sustained crit contact before the core bolts
  moveMin: 2.1, moveMax: 3.6, // idle seconds between relocations
  slide: 3.2,        // relocation speed (1/sec) — it slides, you track it
  burstR: 5.5,       // chain-burst radius
  burstDmg: 34,      // damage dealt to each neighbour caught in a burst — about
                     // a third of a zombie, so a cascade needs a pack that's
                     // already been worked over, not one healthy core kill
  burstMax: 6,       // cascade depth cap, so a chain always terminates
};
const CORE_GEO = new THREE.SphereGeometry(0.17, 10, 8); // shared — never disposed per entity
const _critV = new THREE.Vector3();

// Give an entity a weak point. `host` is the group it rides, `r` the orbit
// radius around the body axis and `ySpan` how far it roams vertically.
function attachWeakPoint(ent, { host, y = 1, r = 0.72, ySpan = 0.5, scale = 1 } = {}) {
  const pivot = new THREE.Group();
  pivot.position.y = y;
  host.add(pivot);
  const orb = new THREE.Group();
  pivot.add(orb);
  const mesh = new THREE.Mesh(CORE_GEO, new THREE.MeshBasicMaterial({ color: 0x9ffcff }));
  mesh.scale.setScalar(scale);
  mesh.userData.entity = ent;
  mesh.userData.core = true;      // the flag updateHose looks for
  orb.add(mesh);
  cleanTargets.push(mesh);
  const halo = glowSprite(0x9ffcff, 1.4 * scale, 0.7);
  orb.add(halo);
  ent.weak = { host, pivot, orb, mesh, halo, r, ySpan, scale, haloBase: 1.4 * scale,
               lit: 0, hold: 0, t: 0, move: 1, moves: 0, phase: Math.random() * 7,
               from: new THREE.Vector3(), to: new THREE.Vector3() };
  moveWeakPoint(ent.weak, true);
  return ent.weak;
}

const _weakV = new THREE.Vector3();
function moveWeakPoint(w, instant) {
  // Bias the new spot into the hemisphere facing the player. A core parked
  // on the far side of the body isn't a skill test, it's a coin flip — you
  // can't see it and the ray can't reach it. Circle around and it stays
  // hidden until it next moves, so flanking still matters; you just never
  // get handed an unhittable target.
  let base = Math.random() * Math.PI * 2;
  if (w.host) {
    w.host.getWorldPosition(_weakV);
    const dx = Player.pos.x - _weakV.x, dz = Player.pos.z - _weakV.z;
    if (dx * dx + dz * dz > 1e-4) base = Math.atan2(dx, dz) - w.host.rotation.y;
  }
  const a = base + (Math.random() - 0.5) * 2.0; // ±57° of the player's bearing
  w.from.copy(w.orb.position);
  w.to.set(Math.sin(a) * w.r, (Math.random() - 0.5) * w.ySpan, Math.cos(a) * w.r);
  w.t = CRIT.moveMin + Math.random() * (CRIT.moveMax - CRIT.moveMin);
  w.move = instant ? 1 : 0;
  w.moves++;
  if (instant) w.orb.position.copy(w.to);
}

// pulse, drift and relocate every live weak point. Called from both tick()
// and UJ.step() — a stepper that skips this leaves cores frozen mid-slide.
function updateWeakPoints(dt, t) {
  for (const list of [piles, zombies]) {
    for (const e of list) {
      const w = e.weak;
      if (!w || !e.alive) continue;
      w.lit = Math.max(0, w.lit - dt);
      if (w.move < 1) {
        w.move = Math.min(1, w.move + dt * CRIT.slide);
        const s = w.move * w.move * (3 - 2 * w.move); // smoothstep slide
        w.orb.position.lerpVectors(w.from, w.to, s);
      } else if ((w.t -= dt) <= 0) {
        moveWeakPoint(w, false);
      }
      const pulse = 0.9 + Math.sin(t * 7 + w.phase) * 0.14 + (w.lit > 0 ? 0.45 : 0);
      w.mesh.scale.setScalar(w.scale * pulse);
      w.halo.scale.setScalar(w.haloBase * pulse);
      w.halo.material.opacity = 0.45 + 0.4 * pulse;
    }
  }
}

// A hit that landed on the weak point. Triples the damage, pays back
// pressure so precision buys uptime, and throttles its own feedback so a
// held stream doesn't paper the screen with CRIT! popups.
function applyCrit(ent, amount, point, dt) {
  if (ent.canCrit && !ent.canCrit()) { ent.clean(amount, point); return; } // armoured: no bonus
  ent.clean(amount * CRIT.mul, point);
  Tutorial.fire('firstCrit');
  Meters.pressure = Math.min(100, Meters.pressure + CRIT.refund * dt);
  Hype.add(CRIT.hype * dt);
  const w = ent.weak;
  if (!w) return;
  if (w.lit <= 0) Game.crits++; // one per acquisition, not per frame of contact
  w.lit = CRIT.hold;
  w.hold += dt;
  if (w.hold >= CRIT.pop) {
    w.hold = 0;
    spawnGlitter(point, 9, 4);
    if (ent.alive) spawnFloatText(_critV.copy(point).setY(point.y + 0.7), 'CRIT!', '#9ffcff', { tier: 'headline', pri: 1 });
    moveWeakPoint(w, false); // it bolts — crit uptime has to be re-earned
  }
}

// Detonation. Called from die() when the kill landed on a lit core, or when
// the victim was itself caught in a burst — that second case is what makes
// a cascade possible.
let critChain = 0, _burstDepth = 0;
function chainBurst(ent, pos) {
  if (_burstDepth >= CRIT.burstMax) return;
  _burstDepth++; critChain++;
  Game.bursts++;
  Game.bestChain = Math.max(Game.bestChain, critChain);
  spawnBurstRing(pos);
  // taper the sparkle as a cascade deepens: five simultaneous full-fat bursts
  // under LEGENDARY bloom wash the frame to white and you lose the fight
  spawnGlitter(pos, _burstDepth === 1 ? 28 : 12, 6);
  SFX.pop(panFor(pos), 0.75);
  Player.shake = Math.max(Player.shake, 0.16);
  // snapshot first: the loop below can kill entities and splice these arrays
  const caught = [];
  for (const list of [piles, zombies, grimes, barrels, gullSplats]) {
    for (const o of list) {
      if (!o || o === ent || o.alive === false || o.resolved) continue;
      if (o.group.position.distanceTo(pos) < CRIT.burstR) caught.push(o);
    }
  }
  for (const o of caught) {
    if (o.alive === false) continue; // already taken out earlier in this cascade
    o._burst = true;
    o.clean(CRIT.burstDmg, o.group.position);
    o._burst = false;
  }
  _burstDepth--;
  if (_burstDepth === 0) {
    if (critChain >= 3) {
      spawnFloatText(_critV.copy(pos).setY(pos.y + 3), 'CHAIN x' + critChain, '#9ffcff', { tier: 'headline', pri: 3 + critChain });
      Hype.add(0.08 * critChain);
      hitStop = Math.max(hitStop, 0.18);
      Player._fovPunch = Math.max(Player._fovPunch, 6);
    }
    critChain = 0;
  }
}
// did this kill earn a detonation? (lit core, or caught in someone else's)
function burstOnDeath(ent) { return !!(ent._burst || (ent.weak && ent.weak.lit > 0)); }

// A thin additive shockwave. Deliberately restrained: it is drawn on top of
// glitter, splash and (at LEGENDARY) a very hot bloom, and five of these at
// once is a normal outcome of a good chain.
const BURST_GEO = new THREE.RingGeometry(0.34, 0.42, 28);
const burstRings = [];
function spawnBurstRing(pos) {
  if (Settings.reduceMotion) return;
  const m = new THREE.Mesh(BURST_GEO, new THREE.MeshBasicMaterial({ color: 0x9ffcff,
    transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false,
    blending: THREE.AdditiveBlending }));
  m.rotation.x = -Math.PI / 2;
  m.position.set(pos.x, Math.max(0.25, pos.y), pos.z);
  scene.add(m);
  burstRings.push({ m, t: 0 });
  if (burstRings.length > 6) { const o = burstRings.shift(); scene.remove(o.m); o.m.material.dispose(); }
}
function updateBurstRings(dt) {
  for (let i = burstRings.length - 1; i >= 0; i--) {
    const b = burstRings[i];
    b.t += dt;
    const s = 1 + b.t * 16;
    b.m.scale.set(s, s, s);
    b.m.material.opacity = Math.max(0, 0.55 - b.t * 1.5);
    if (b.t > 0.4) { scene.remove(b.m); b.m.material.dispose(); burstRings.splice(i, 1); }
  }
}

class PoopPile {
  constructor(x, z, size = 1) {
    this.dirt = CFG.pile.dirt;
    this.alive = true;
    this.size = size;
    this.sinceClean = 99; // seconds since last sprayed (drives BUILD 3 regen)
    this.baseScale = 1;              // shrink level from cleaning
    this.wob = 0; this.wobV = 0;     // jelly-wobble spring, excited by the jet
    this.group = new THREE.Group();
    this.group.position.set(x, 0, z);

    const hue = Math.random();
    this.mat = new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 0.5,
      emissive: new THREE.Color().setHSL(hue, 0.9, 0.45), emissiveIntensity: 0.9 });

    // classic three-scoop swirl, squashed spheres
    const blobGeo = new THREE.SphereGeometry(1, 10, 8);
    const scales = [[1.3, 0.55, 1.3, 0.35], [0.95, 0.5, 0.95, 0.85], [0.6, 0.45, 0.6, 1.25]];
    for (const [sx, sy, sz, y] of scales) {
      const m = new THREE.Mesh(blobGeo, this.mat);
      m.scale.set(sx * size, sy * size, sz * size);
      m.position.y = y * size;
      m.userData.entity = this;
      m.castShadow = true;
      this.group.add(m);
      cleanTargets.push(m);
    }
    this.glow = glowSprite(new THREE.Color().setHSL(hue, 0.9, 0.6).getHex(), 2.5 * size, 0.35);
    this.glow.position.y = 1;
    this.group.add(this.glow);
    // the hot spot: a pile is a static target, so its core is what makes
    // scrubbing one an act of aim rather than a stopwatch
    attachWeakPoint(this, { host: this.group, y: 0.75 * size, r: 0.85 * size,
                            ySpan: 0.6 * size, scale: 1.05 });
    scene.add(this.group);
  }

  clean(amount, point) {
    if (!this.alive) return;
    this.dirt -= amount;
    this.sinceClean = 0; // regen holds off while you're actively scrubbing
    const f = Math.max(this.dirt, 0) / CFG.pile.dirt;
    this.baseScale = 0.35 + 0.65 * f;
    this.wobV += amount * 0.35; // the pressure blast sets the jelly quivering
    this.glow.material.opacity = 0.1 + 0.25 * f;
    if (Math.random() < 0.15) spawnGlitter(point || this.group.position, 6, 2); // scrub sparks
    if (this.dirt <= 0) this.die();
  }

  die() {
    this.alive = false;
    const c = this.group.position.clone(); c.y += 1;
    spawnGlitter(c, Math.round(90 * Hype.glitterMul()), 6);
    Hype.add(0.16);
    if (burstOnDeath(this)) chainBurst(this, c); // popped on the core: it detonates
    // the pile bursts into physical gobs in its own glowing color
    spawnChunkBurst(this.group.position, { count: 5, mat: this.mat, rMin: 0.1, rMax: 0.22, power: 0.9 });
    spawnWetPatch(this.group.position); // a burst pile leaves the planks slick
    if (Perks.thorns()) { // GLITTER BOMB: the pop is shrapnel
      for (const z of zombies) {
        if (z.alive && z.group.position.distanceTo(this.group.position) < 5.5) z.clean(Perks.thorns(), z.group.position);
      }
    }
    SFX.pop(panFor(this.group.position), 0.9);
    registerCombo(this.group.position);
    removeCleanTargets(this.group);
    scene.remove(this.group);
    Game.pilesCleaned++;
    Meters.rainbow = Math.min(100, Meters.rainbow + 25); // big charge per pile
    gainXP(25, this.group.position);
    Rush.award(40, this.group.position);
    Tutorial.fire('pileCleaned');
    updateObjectiveHUD();
    maybeTriggerClimax();
    checkWin();
  }
}

// design doc "Bridge Escape": once 80% of piles are clean, every remaining
// zombie aggros at once for a minor climax before the level ends
let climaxFired = false;
function maybeTriggerClimax() {
  if (climaxFired || Game.totalPiles === 0) return;
  if (Game.pilesCleaned / Game.totalPiles < 0.8) return;
  climaxFired = true;
  for (const z of zombies) if (z.alive && z.state !== 'stunned') z.setState('chase');
  // BUILD 3: the climax also lands reinforcements — two runners burst out of
  // the far fog so the final stretch stays dangerous even on a clean sweep
  for (const [x, z] of [[-3, CFG.bridge.playZEnd + 3], [3, CFG.bridge.playZEnd + 6]]) {
    const r = new Zombie(x, z, { runner: true });
    r.setState('chase');
    zombies.push(r);
    Game.totalZombies++;
  }
  updateObjectiveHUD();
  showToast('🚨 WHARF PANIC! Every zombie has your scent — and runners are storming the pier!');
  narrate('The horde has your scent, janitor — and the fast ones are coming!', 0.6);
  SFX.setMusicMood('hero');
  Player.shake = Math.max(Player.shake, 0.25);
}

// living emissives + jelly physics: glow breathes with remaining dirt, and a
// damped spring makes the whole pile quiver under the pressure washer.
// Shared by the main tick and the headless UJ.step driver.
function updatePileJelly(dt, t) {
  for (let i = 0; i < piles.length; i++) {
    const p = piles[i];
    if (!p.alive) continue;
    const pdx = p.group.position.x - Player.pos.x, pdz = p.group.position.z - Player.pos.z;
    const pvis = pdx * pdx + pdz * pdz < CULL2;
    if (p.group.visible !== pvis) p.group.visible = pvis;
    if (!pvis) continue; // no point springing jelly nobody can see
    // BUILD 3: abandoned progress re-festers — a half-cleaned pile slowly
    // regrows if it hasn't been sprayed for a few seconds. Finish the job.
    p.sinceClean += dt;
    if (p.dirt < CFG.pile.dirt && p.sinceClean > CFG.pile.regenDelay) {
      p.dirt = Math.min(CFG.pile.dirt, p.dirt + CFG.pile.regen * DIFF.regen() * dt);
      p.baseScale = 0.35 + 0.65 * Math.max(p.dirt, 0) / CFG.pile.dirt;
    }
    const f = Math.max(p.dirt, 0) / CFG.pile.dirt;
    p.glow.material.opacity = 0.1 + 0.25 * f + 0.06 * Math.sin(t * 3 + i * 2.1);
    p.wobV += (-p.wob * 90 - p.wobV * 7) * dt;      // stiff, under-damped jelly
    p.wob = THREE.MathUtils.clamp(p.wob + p.wobV * dt, -0.3, 0.3);
    const b = p.baseScale;
    p.group.scale.set(b * (1 + p.wob * 0.7), b * (1 - p.wob), b * (1 + p.wob * 0.7));
  }
}

function removeCleanTargets(group) {
  group.traverse(o => {
    const i = cleanTargets.indexOf(o);
    if (i >= 0) cleanTargets.splice(i, 1);
  });
}

/* =====================================================================
   8.5 WHARF TOYS — the interactive layer: washable grime, suds barrels,
        beach balls, the harbor bell, wet-plank slips and gull bombing
        runs. All of it is optional fun — none of it gates the win.
   ===================================================================== */

// ---- wet planks: spray the deck (or pop anything juicy) and it stays
// slick for a few seconds; a hustling zombie that crosses one wipes out.
const wetPatches = [];
let slipToastShown = false;
const _wetGeo = new THREE.CircleGeometry(0.85, 14);
function spawnWetPatch(point) {
  for (const w of wetPatches) { // refresh a nearby patch instead of stacking decals
    if (Math.abs(w.m.position.x - point.x) < 1.1 && Math.abs(w.m.position.z - point.z) < 1.1) {
      w.ttl = Math.max(w.ttl, 7); return w;
    }
  }
  if (wetPatches.length >= 14) { const old = wetPatches.shift(); scene.remove(old.m); old.m.material.dispose(); }
  const m = new THREE.Mesh(_wetGeo, new THREE.MeshStandardMaterial({ color: 0x1c2c40,
    transparent: true, opacity: 0.32, roughness: 0.12, metalness: 0.4, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  m.position.set(point.x, 0.018, point.z);
  scene.add(m);
  const w = { m, ttl: 7 };
  wetPatches.push(w);
  return w;
}
function updateWetPatches(dt) {
  for (let i = wetPatches.length - 1; i >= 0; i--) {
    const w = wetPatches[i];
    w.ttl -= dt;
    if (w.ttl <= 0) { scene.remove(w.m); w.m.material.dispose(); wetPatches.splice(i, 1); continue; }
    w.m.material.opacity = 0.32 * Math.min(1, w.ttl / 1.5);
  }
}

// ---- washable grime: dark stains baked onto the planks. Pure power-washer
// satisfaction — hose one and it fades away stroke by stroke. Bonus XP.
const grimes = [];
let grimeCleaned = 0;
function makeGrimeTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d');
  for (let i = 0; i < 26; i++) { // overlapping smears read as one organic stain
    const a = Math.random() * Math.PI * 2, r = 12 + Math.random() * 36;
    x.fillStyle = `rgba(26,20,12,${0.22 + Math.random() * 0.3})`;
    x.beginPath();
    x.ellipse(64 + Math.cos(a) * 20, 64 + Math.sin(a) * 20, r * 0.5, r * 0.32, a, 0, 7);
    x.fill();
  }
  return new THREE.CanvasTexture(c);
}
class Grime {
  constructor(x, z, s = 1) {
    this.dirt = 30;
    this.resolved = false;
    this.aimY = 0; // flat decal: the jet grabs it at deck level
    const m = this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2.2 * s, 2.2 * s),
      new THREE.MeshBasicMaterial({ map: makeGrimeTexture(), transparent: true, opacity: 0.95, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = Math.random() * 6.28;
    m.position.set(x, 0.024, z);
    m.userData.entity = this;
    this.group = m; // .group.position duck-typing for the wide-nozzle fan
    scene.add(m);
    cleanTargets.push(m);
    grimes.push(this);
  }
  clean(amount, point) {
    if (this.resolved) return;
    this.dirt -= amount;
    this.mesh.material.opacity = 0.95 * Math.max(this.dirt, 0) / 30;
    if (Math.random() < 0.2) spawnGlitter(point || this.mesh.position, 4, 1.5);
    if (this.dirt <= 0) this.scrub();
  }
  scrub() {
    this.resolved = true;
    grimeCleaned++;
    spawnGlitter(this.mesh.position.clone().setY(0.4), 30, 3);
    spawnFloatText(this.mesh.position.clone().setY(1.4), 'SPOTLESS!', '#9fdcff');
    Hype.add(0.08);
    spawnWetPatch(this.mesh.position);
    SFX.chime(0.9);
    gainXP(10, this.mesh.position);
    Rush.award(25, this.mesh.position);
    const i = cleanTargets.indexOf(this.mesh);
    if (i >= 0) cleanTargets.splice(i, 1);
    scene.remove(this.mesh);
    if (grimeCleaned === grimes.length) {
      showToast('✨ Every stain scrubbed — the boardwalk gleams! +50 XP');
      gainXP(50, Player.pos);
    }
  }
}

// ---- suds barrels: janitor supply drops. Blast one open and it detonates
// in a foam nova that scrubs every pile, zombie and sea lion around it.
const barrels = [];
let sudsToastShown = false;
class SudsBarrel {
  constructor(x, z) {
    this.dirt = 50;
    this.resolved = false;
    this.aimY = 0.55; // barrel mid-height
    const g = this.group = new THREE.Group();
    g.position.set(x, 0, z);
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.46, 0.9, 12),
      new THREE.MeshStandardMaterial({ color: 0xe8f4ff, roughness: 0.35 }));
    body.position.y = 0.45; body.castShadow = true; body.userData.entity = this;
    g.add(body); cleanTargets.push(body);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.445, 0.445, 0.16, 12),
      new THREE.MeshStandardMaterial({ color: 0x2f8fd0, roughness: 0.4 }));
    band.position.y = 0.45; band.userData.entity = this;
    g.add(band); cleanTargets.push(band);
    const foam = new THREE.Mesh(new THREE.SphereGeometry(0.34, 10, 8),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.2, emissive: 0xbfe8ff, emissiveIntensity: 0.3 }));
    foam.scale.y = 0.55; foam.position.y = 0.95; foam.userData.entity = this;
    g.add(foam); cleanTargets.push(foam);
    const glow = glowSprite(0x9fdcff, 1.8, 0.22);
    glow.position.y = 1;
    g.add(glow);
    scene.add(g);
    barrels.push(this);
  }
  clean(amount, point) {
    if (this.resolved) return;
    this.dirt -= amount;
    this.group.rotation.z = (Math.random() - 0.5) * 0.1; // fizzing agitation
    if (Math.random() < 0.25) spawnSplash(this.group.position.clone().setY(1.1));
    if (this.dirt <= 0) this.burst();
  }
  burst() {
    this.resolved = true;
    const p = this.group.position;
    // foam nova: scrub everything nearby — pile, zombie or infected sea lion
    for (const list of [piles, zombies, civilians, gullSplats]) {
      for (const tgt of list) {
        if (!tgt || tgt.resolved || tgt.alive === false || tgt.falling) continue;
        if (tgt.group.position.distanceTo(p) < 7) tgt.clean(80, tgt.group.position);
      }
    }
    for (const z of zombies) { // survivors stagger out of the foam, dazed
      if (z.alive && z.group.position.distanceTo(p) < 7) z.stun(1.2);
    }
    spawnGlitter(p.clone().setY(1), 120, 8);
    spawnChunkBurst(p, { count: 7,
      mat: new THREE.MeshStandardMaterial({ color: 0xf4fbff, roughness: 0.25 }),
      rMin: 0.12, rMax: 0.26, power: 1.3 });
    spawnSplash(p.clone().setY(0.8), true);
    spawnWetPatch(p);
    SFX.pop(panFor(p), 1);
    SFX.splat(panFor(p), 0.9);
    spawnFloatText(p.clone().setY(2), 'FOAM BLAST!', '#bfe8ff');
    gainXP(15, p);
    Player.shake = Math.max(Player.shake, 0.12);
    if (!sudsToastShown) { sudsToastShown = true; showToast('🧼 SUDS BARREL! Burst one next to filth for a foam blast.'); }
    removeCleanTargets(this.group);
    scene.remove(this.group);
  }
}

// ---- beach balls: feather-light physics toys. The jet launches them,
// and (via the flying-prop stagger rule) a fast ball bowls a zombie over.
const beachBalls = [];
function buildBeachBalls() {
  const c = document.createElement('canvas'); c.width = 96; c.height = 48;
  const x = c.getContext('2d');
  ['#ff5f7e', '#ffd94f', '#5fc8ff', '#7dffb0', '#ff9ae0', '#f4f4ee']
    .forEach((col, i) => { x.fillStyle = col; x.fillRect(i * 16, 0, 16, 48); });
  const tex = new THREE.CanvasTexture(c);
  for (const [bx, bz] of [[2.5, -16], [-3, -46], [6, -120]]) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.45, 14, 12),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5 }));
    m.position.set(bx, 0.45, bz);
    m.castShadow = true;
    scene.add(m);
    beachBalls.push(addPhysBody(m, 0.5, 0.45, { mass: 0.3, rest: 0.8, aimY: 0 }));
  }
}

// ---- harbor bell: hose it with a sustained blast and it DINGs — every
// zombie in earshot is mesmerized and shambles to the bell instead of you.
const bells = [];
let bellToastShown = false;
function buildBell(bx, bz) {
  const g = new THREE.Group();
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x4a3620, roughness: 0.9 });
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.22, 2.6, 0.22), woodMat);
  post.position.y = 1.3; g.add(post);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.18, 0.18), woodMat);
  arm.position.set(-0.35, 2.55, 0); g.add(arm);
  const dome = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.42, 0.5, 12),
    new THREE.MeshStandardMaterial({ color: 0xd9a832, metalness: 0.75, roughness: 0.3,
      emissive: 0x664c10, emissiveIntensity: 0.25 }));
  dome.position.set(-0.62, 2.2, 0);
  g.add(dome);
  const glow = glowSprite(0xffd94f, 2, 0.25);
  glow.position.set(-0.62, 2.2, 0);
  g.add(glow);
  g.position.set(bx, 0, bz);
  scene.add(g);
  const bell = {
    group: g, dome, charge: 0, cd: 0, swing: 0,
    pos: new THREE.Vector3(bx - 0.62, 2.2, bz), // dome in world space
    clean(amount) { // the water jet is the clapper
      this.charge += amount;
      if (this.charge > 20 && this.cd <= 0) this.ring();
    },
    ring() {
      this.cd = 8; this.charge = 0; this.swing = 1;
      SFX.chime(0.55);
      let lured = 0;
      for (const z of zombies) {
        if (!z.alive) continue;
        if (z.group.position.distanceTo(this.pos) < 26) {
          z.lureT = 6;
          z.lurePos.set(this.pos.x, 0, this.pos.z);
          if (z.state === 'wander') z.setState('chase'); // hustle to the sound
          lured++;
        }
      }
      spawnFloatText(this.pos.clone().add(new THREE.Vector3(0, 1, 0)), '🔔 DING!', '#ffd94f');
      Player.shake = Math.max(Player.shake, 0.08);
      if (lured && !bellToastShown) {
        bellToastShown = true;
        showToast('🔔 The harbor bell mesmerizes zombies — they shamble toward it!');
      }
    },
  };
  dome.userData.entity = bell;
  cleanTargets.push(dome);
  bells.push(bell);
}
function updateBell(dt) {
  for (const bell of bells) {
    bell.cd = Math.max(0, bell.cd - dt);
    bell.charge = Math.max(0, bell.charge - 12 * dt); // demands a sustained blast, not a drip
    if (bell.swing > 0) {
      bell.swing = Math.max(0, bell.swing - dt * 0.8);
      bell.dome.rotation.z = Math.sin(bell.swing * 22) * 0.5 * bell.swing;
    }
  }
}

// ---- gull bombing runs: every so often a gull lets one go near the player.
// Fresh splats are quick bonus XP (and keep the deck feeling alive/hostile).
const gullSplats = [];
let gullBombT = 9;
let gullToastShown = false;
class MiniSplat {
  constructor(x, z) {
    this.dirt = 18;
    this.resolved = false;
    this.aimY = 0.05; // squat blob: jet aim point is basically the deck
    this.falling = true; // registered as a clean target only once it lands
    const hue = Math.random();
    const m = this.mesh = new THREE.Mesh(new THREE.SphereGeometry(0.42, 8, 6),
      new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 0.5,
        emissive: new THREE.Color().setHSL(hue, 0.9, 0.45), emissiveIntensity: 0.8 }));
    m.scale.set(1, 0.38, 1);
    m.position.set(x, 8.5, z);
    m.castShadow = true;
    m.userData.entity = this;
    this.group = m;
    scene.add(m);
    gullSplats.push(this);
  }
  clean(amount, point) {
    if (this.resolved || this.falling) return;
    this.dirt -= amount;
    const f = Math.max(this.dirt, 0) / 18;
    this.mesh.scale.set(0.5 + 0.5 * f, 0.38 * (0.5 + 0.5 * f), 0.5 + 0.5 * f);
    if (Math.random() < 0.15) spawnGlitter(point || this.mesh.position, 4, 1.5);
    if (this.dirt <= 0) {
      this.resolved = true;
      spawnGlitter(this.mesh.position.clone().setY(0.5), 24, 3);
      SFX.pop(panFor(this.mesh.position), 0.5);
      registerCombo(this.mesh.position);
      gainXP(5, this.mesh.position);
      const i = cleanTargets.indexOf(this.mesh);
      if (i >= 0) cleanTargets.splice(i, 1);
      const j = gullSplats.indexOf(this);
      if (j >= 0) gullSplats.splice(j, 1);
      scene.remove(this.mesh);
    }
  }
}
function spawnGullSplat(x, z) {
  const px = x ?? THREE.MathUtils.clamp(Player.pos.x + (Math.random() - 0.5) * 10, -(CFG.bridge.playHalfW - 1), CFG.bridge.playHalfW - 1);
  const pz = z ?? THREE.MathUtils.clamp(Player.pos.z - 5 - Math.random() * 12,
    CFG.bridge.playZEnd + 2, CFG.bridge.zStart - 6);
  return new MiniSplat(px, pz);
}
function updateGullSplats(dt) {
  gullBombT -= dt;
  if (gullBombT <= 0) {
    gullBombT = 13 + Math.random() * 9;
    if (gullSplats.length < 6) {
      spawnGullSplat();
      if (!gullToastShown) { gullToastShown = true; showToast('💩 Seagull bombing run! Fresh splats are bonus XP.'); }
    }
  }
  for (const s of gullSplats) {
    if (!s.falling) continue;
    s.mesh.position.y -= 13 * dt;
    if (s.mesh.position.y <= 0.16) {
      s.mesh.position.y = 0.16;
      s.falling = false;
      cleanTargets.push(s.mesh);
      SFX.splat(panFor(s.mesh.position), 0.7);
      spawnSplash(s.mesh.position.clone().setY(0.3));
    }
  }
}

// one call site for the whole toy layer (shared by tick AND UJ.step)
function updateWharfToys(dt) {
  updateWetPatches(dt);
  updateBell(dt);
  updateGullSplats(dt);
}

/* =====================================================================
   9. ZOMBIES — flamboyant glitter zombies. Shirtless, hot-pink shorts,
      covered in rainbow goo; hose the goo off to defeat them.
      FSM: wander -> chase -> windup -> lunge -> recover
   ===================================================================== */
const zombies = [];
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _knockV = new THREE.Vector3();

// BUILD 5 update budget: on a 221m pier most of the horde is far away in the
// fog, where nobody can see a 60Hz gait. Beyond 55m they tick in coarser
// batched steps — same behaviour, a fraction of the work. Shared by tick and
// the headless stepper so tests exercise exactly what ships.
const CULL2 = 52 * 52; // squared distance past which the fog has eaten it anyway
function updateZombies(dt, t) {
  for (const z of zombies) {
    if (!z.alive) continue;
    const dx = z.group.position.x - Player.pos.x, dz = z.group.position.z - Player.pos.z;
    const d2 = dx * dx + dz * dz;
    const vis = d2 < CULL2;
    if (z.group.visible !== vis) z.group.visible = vis;
    if (d2 > 3025) {
      z._acc = (z._acc || 0) + dt;
      if (z._acc < 0.1) continue;      // ~10Hz out in the murk
      z.update(Math.min(z._acc, 0.15), t);
      z._acc = 0;
    } else {
      z._acc = 0;
      z.update(dt, t);
    }
  }
}

class Zombie {
  constructor(x, z, opts = {}) {
    // BUILD 3 "runner" variant: lean, fast, less goo — a different threat
    // shape, not just bigger numbers. Two ship in the layout, two more storm
    // the pier as climax reinforcements.
    this.runner = !!opts.runner;
    // BUILD 6 brute: a slab of a zombie — slow, enormously thick with goo,
    // and too heavy for the jet to shove. You have to commit to killing it.
    this.brute = !!opts.brute;
    this.speedMul = this.runner ? CFG.zombie.runnerSpeedMul
                  : this.brute ? CFG.zombie.bruteSpeedMul : 1;
    this.gooMax = this.runner ? CFG.zombie.runnerGoo
                : this.brute ? CFG.zombie.bruteGoo : CFG.zombie.goo;
    this.goo = this.gooMax;
    this.sclX = this.runner ? 0.86 : this.brute ? 1.42 : 1; // silhouette reads the threat at a glance
    this.sclY = this.runner ? 1.08 : this.brute ? 1.3 : 1;
    this.heading = Math.random() * Math.PI * 2; // BUILD 4 steering: facing = movement dir
    this.speed = 0;                             // current ground speed, ramps up/down
    this.pauseT = 0;                            // wander "sniff" stops
    this.alive = true;
    this.state = 'wander';
    this.stateT = 0;
    this.home = new THREE.Vector3(x, 0, z);
    this.target = this.home.clone();
    this.groanT = 2 + Math.random() * 4;
    this.hitCd = 0;
    this.lungeDir = new THREE.Vector3();
    this.lureT = 0;                       // harbor-bell mesmerize timer
    this.lurePos = new THREE.Vector3();
    this.slipCd = 0;                      // wet-plank pratfall cooldown

    const g = this.group = new THREE.Group();
    g.position.set(x, 0, z);
    g.scale.set(this.sclX, this.sclY, this.sclX); // maintained by the flinch code below

    // concept art: waddling poop golem — swirl head, one yellow eye, toothy
    // grin, claw arms/feet, dripping rainbow slime (the cleanable part)
    const poopDark = new THREE.MeshStandardMaterial({ color: 0x53341f, roughness: 0.55 });
    const clawMat = new THREE.MeshStandardMaterial({ color: 0xcbb391, roughness: 0.4 });
    this.bodyMat = new THREE.MeshStandardMaterial({ color: this.brute ? 0x4a2f18 : 0x6b4426,
      roughness: 0.5, emissive: this.brute ? 0xff8000 : 0xff40c0, emissiveIntensity: 0.05 });

    // round belly
    const belly = new THREE.Mesh(new THREE.SphereGeometry(0.55, 12, 10), this.bodyMat);
    belly.position.y = 0.85; belly.scale.set(1, 1.1, 0.9);
    belly.userData.entity = this;
    g.add(belly); cleanTargets.push(belly);
    this.belly = belly;
    this.gaitT = Math.random() * 10; // per-zombie gait phase so the horde doesn't march in sync

    // poop-swirl head: three shrinking scoops + a flicked tip
    const headG = new THREE.Group();
    headG.position.y = 1.66;
    const swirlGeo = new THREE.SphereGeometry(1, 10, 8);
    [[0.42, 0.3, 0.42, 0], [0.3, 0.24, 0.3, 0.24], [0.18, 0.16, 0.18, 0.45]].forEach(([sx, sy, sz, y]) => {
      const s = new THREE.Mesh(swirlGeo, poopDark);
      s.scale.set(sx, sy, sz); s.position.y = y;
      s.userData.entity = this;
      headG.add(s); cleanTargets.push(s);
    });
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.24, 6), poopDark);
    tip.position.set(0.06, 0.64, 0); tip.rotation.z = -0.55;
    headG.add(tip);

    // one big yellow eye + pupil, and a toothy grin (runners burn red)
    this.eyeMat = this.runner
      ? new THREE.MeshStandardMaterial({ color: 0xff5f5f, emissive: 0xff2040, emissiveIntensity: 1.1 })
      : this.brute
      ? new THREE.MeshStandardMaterial({ color: 0xffa23f, emissive: 0xff6a00, emissiveIntensity: 1.3 })
      : new THREE.MeshStandardMaterial({ color: 0xffd23f, emissive: 0xffc400, emissiveIntensity: 0.9 });
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), this.eyeMat);
    eye.position.set(0.12, 0.08, 0.34); headG.add(eye);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.045, 6, 5),
      new THREE.MeshBasicMaterial({ color: 0x231206 }));
    pupil.position.set(0.12, 0.08, 0.45); headG.add(pupil);
    const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.1, 0.06),
      new THREE.MeshStandardMaterial({ color: 0x2a1408, roughness: 0.6 }));
    mouth.position.set(0, -0.16, 0.34); headG.add(mouth);
    const toothGeo = new THREE.BoxGeometry(0.055, 0.07, 0.03);
    const toothMat = new THREE.MeshStandardMaterial({ color: 0xf2ead8, roughness: 0.4 });
    for (let i = 0; i < 4; i++) {
      const t = new THREE.Mesh(toothGeo, toothMat);
      t.position.set(-0.14 + i * 0.095, -0.12, 0.37);
      headG.add(t);
    }
    g.add(headG);
    this.headG = headG;

    // dangling claw arms — each wrapped in a shoulder pivot so it can swing
    // with the gait (real moving parts, not a welded pose)
    const armGeo = new THREE.CapsuleGeometry(0.11, 0.5, 3, 6);
    this.arms = [];
    for (const s of [-1, 1]) {
      const shoulder = new THREE.Group();
      shoulder.position.set(s * 0.6, 1.25, 0.05); // pivot at the shoulder joint
      shoulder.rotation.z = s * 0.5;              // baseline splay
      const arm = new THREE.Mesh(armGeo, this.bodyMat);
      arm.position.y = -0.3; // hang below the joint
      shoulder.add(arm);
      g.add(shoulder); this.arms.push(shoulder);
      for (let c = 0; c < 3; c++) {
        const claw = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.12, 5), clawMat);
        claw.position.set((c - 1) * 0.055, -0.42, 0.03);
        claw.rotation.x = Math.PI; // point down from the paw
        arm.add(claw);
      }
    }

    // clawed feet — each in an ankle pivot so the waddle actually steps
    const footGeo = new THREE.BoxGeometry(0.26, 0.14, 0.42);
    this.feet = [];
    for (const s of [-1, 1]) {
      const ankle = new THREE.Group();
      ankle.position.set(s * 0.24, 0.07, 0.08);
      const foot = new THREE.Mesh(footGeo, poopDark);
      ankle.add(foot);
      for (let c = 0; c < 2; c++) {
        const claw = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.12, 5), clawMat);
        claw.position.set((c - 0.5) * 0.11, -0.01, 0.26);
        claw.rotation.x = Math.PI / 2;
        ankle.add(claw);
      }
      g.add(ankle); this.feet.push(ankle);
    }

    // rainbow slime drips — these shrink away as the player hoses him
    this.gooBlobs = [];
    const dripGeo = new THREE.SphereGeometry(0.09, 6, 5);
    for (let i = 0; i < 6; i++) {
      const hue = i / 6;
      const dm = new THREE.MeshStandardMaterial({
        color: new THREE.Color().setHSL(hue, 0.95, 0.55), roughness: 0.25,
        emissive: new THREE.Color().setHSL(hue, 0.95, 0.4), emissiveIntensity: 1.1 });
      const drip = new THREE.Mesh(dripGeo, dm);
      const onHead = i % 2 === 0;
      drip.position.set((Math.random() - 0.5) * 0.6,
        onHead ? 1.6 + Math.random() * 0.5 : 0.7 + Math.random() * 0.5,
        0.22 + Math.random() * 0.25);
      drip.scale.set(1, 1.5 + Math.random(), 1);
      drip.userData.entity = this;
      g.add(drip); this.gooBlobs.push(drip); cleanTargets.push(drip);
    }

    this.sparkle = glowSprite(0xff8fe0, 2.2, 0.35);
    this.sparkle.position.y = 1.4;
    g.add(this.sparkle);

    // dizzy-stars indicator shown while stunned by the beam/nova
    this.stunT = 0;
    this.downT = 0; // BUILD 13 knockdown (ground pound)
    this.stunStars = glowSprite(0x9fdcff, 1.3, 0);
    this.stunStars.position.y = 2.55;
    g.add(this.stunStars);

    // partition: primitive cosmetics into a rig subgroup (hidden when the
    // generated GLB loads — they stay forever as invisible hitboxes);
    // gameplay overlays (drips, sparkle, stars) stay at group level
    const keep = new Set([...this.gooBlobs, this.sparkle, this.stunStars]);
    this.rig = new THREE.Group();
    for (const child of [...g.children]) if (!keep.has(child)) this.rig.add(child);
    g.add(this.rig);

    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    // the weak point goes on AFTER the rig partition so it survives the
    // swap to the GLB body — it's gameplay, not cosmetics. Brutes carry a
    // fatter one because their body scale widens the orbit with them.
    attachWeakPoint(this, { host: g, y: 1.15, r: 0.72, ySpan: 0.7,
                            scale: this.brute ? 1.25 : this.runner ? 0.85 : 1 });
    this.weak.mesh.castShadow = false;
    scene.add(g);
    this.applyModel(); // if the GLB prototype is already loaded, wear it now
  }

  applyModel() {
    if (!zombieProto || this.glb || !this.alive || !Settings.models) return;
    this.glb = normalizeModel(zombieProto.scene.clone(true), zombieProto.spec);
    this.glb.traverse(o => { if (o.isMesh) o.userData.entity = this; });
    this.group.add(this.glb);
    this.rig.visible = false;
  }

  stun(dur) { // design doc: the Magic Beam stuns as well as cleans
    if (!this.alive) return;
    if (this.state === 'downed') { this.downT = Math.max(this.downT, dur); return; } // already flat — keep him there
    this.stunT = Math.max(this.stunT, dur);
    this.group.rotation.x = 0;
    this.setState('stunned');
  }

  // BUILD 13: flattened by a ground pound. Distinct from a stun — he goes
  // face-down on the planks, takes DOUBLE from the hose while he's there,
  // and has to scramble back up. That vulnerability window is the whole
  // point: the slam sets the table, the hose eats.
  knockdown(dur) {
    if (!this.alive) return;
    this.downT = Math.max(this.downT || 0, dur);
    this.speed = 0;
    this.setState('downed');
    this.stunStars.material.opacity = 0.6;
    spawnSplash(this.group.position.clone().setY(0.12), true);
  }

  clean(amount, point) {
    if (!this.alive) return;
    if (this.state === 'downed') amount *= 2; // flat on his back: open season
    this.goo -= amount;
    this.flinch = Math.min(1, (this.flinch || 0) + amount * 0.12); // impact shudder (gain must beat the per-frame decay under continuous spray)
    const f = Math.max(this.goo, 0) / this.gooMax;
    this.bodyMat.emissiveIntensity = 0.05 * f;
    for (const b of this.gooBlobs) b.scale.setScalar(Math.max(0.01, f));
    if (Math.random() < 0.12) spawnGlitter(point || this.group.position, 5, 2);
    // being hosed aggravates him
    if (this.state === 'wander') this.setState('chase');
    if (this.goo <= 0) this.die();
  }

  die() {
    this.alive = false;
    const c = this.group.position.clone(); c.y += 1.3;
    spawnGlitter(c, Math.round(130 * Hype.glitterMul()), 7);
    // STYLE KILLS: how you finished it matters. Each one slams the brakes
    // for a beat, punches the lens and pays into the hype meter.
    const style = this.state === 'downed' ? 'CURB SERVICE!'
      : this.weak && this.weak.lit > 0 ? 'CORE POP!'
      : !Player.onGround ? 'AIRBORNE PURIFY!'
      : this._propStun > 0 ? 'STRIKE!'
      : this.brute ? 'BRUTE DOWN!'
      : comboCount >= 3 ? 'PURIFY CHAIN!' : null;
    if (style) {
      hitStop = 0.22;
      Player._fovPunch = Math.max(Player._fovPunch, 7);
      Player.shake = Math.max(Player.shake, 0.3);
      Hype.add(0.2);
      spawnFloatText(c.clone().setY(c.y + 1.1), style, '#ffd94f', { tier: 'headline', pri: 2 });
    }
    Hype.add(this.brute ? 0.34 : 0.22);
    if (burstOnDeath(this)) chainBurst(this, c); // core kill: the goo goes off
    spawnRagdoll(this.group.position); // physics chunks bounce off the deck
    SFX.pop(panFor(this.group.position), 1);
    registerCombo(this.group.position);
    removeCleanTargets(this.group);
    // death animation: spin-shrink for 0.45s, then a final sparkle; the
    // group is removed by the dying-list updater in the main loop
    dyingZombies.push({ g: this.group, t: 0.45 });
    hitStop = 0.09; // brief slow-motion on every kill
    Meters.rainbow = Math.min(100, Meters.rainbow + 15);
    Game.zombiesDefeated++;
    RPG.kills++;
    gainXP(this.brute ? 110 : 50, this.group.position);
    Rush.award(this.brute ? 250 : this.runner ? 140 : 100, this.group.position);
    Tutorial.fire('zombieDefeated');
    updateObjectiveHUD();
    checkWin();
  }

  setState(s) { this.state = s; this.stateT = 0; }

  // shoved backward by the high-pressure jet — the hose's crowd control. A
  // mid-lunge zombie resists (it has committed momentum); otherwise it slides
  // away and leans back, clamped to the deck.
  push(dt) {
    if (!this.alive || this.state === 'lunge' || this.state === 'downed') return;
    if (this.brute) return; // too heavy to shove — the jet just makes it angry
    _knockV.subVectors(this.group.position, Player.pos); _knockV.y = 0;
    if (_knockV.lengthSq() < 1e-4) return;
    _knockV.normalize();
    const p = this.group.position;
    p.addScaledVector(_knockV, CFG.zombie.knockback * dt);
    this.speed = Math.max(0, this.speed - 12 * dt); // the blast kills their momentum too
    p.x = THREE.MathUtils.clamp(p.x, -(CFG.bridge.playHalfW + 0.1), CFG.bridge.playHalfW + 0.1);
    p.z = THREE.MathUtils.clamp(p.z, CFG.bridge.playZEnd, CFG.bridge.zStart - 3);
    this.group.rotation.x = -0.18; // brief lean-back from the blast
  }

  // BUILD 4 locomotion: a real steering model. Heading turns at a capped
  // rate (arcs, not pivots), speed ramps with acceleration and bleeds off in
  // hard turns, and the body faces its actual direction of travel.
  moveToward(tx, tz, maxSpeed, dt) {
    this._moved = true;
    const pos = this.group.position;
    const dx = tx - pos.x, dz = tz - pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 1e-3) { this.speed = Math.max(0, this.speed - CFG.zombie.decel * dt); return d; }
    const want = Math.atan2(dx, dz);
    let diff = want - this.heading;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    const tr = CFG.zombie.turnRate * (this.runner ? 1.4 : 1) * dt;
    this.heading += THREE.MathUtils.clamp(diff, -tr, tr);
    // commit less speed while turning hard — they bank into corners
    const align = Math.max(0, Math.cos(diff));
    const target = maxSpeed * DIFF.speed() * (0.35 + 0.65 * align);
    const acc = (target > this.speed ? CFG.zombie.accel * (this.runner ? 1.6 : 1) : CFG.zombie.decel) * dt;
    this.speed += THREE.MathUtils.clamp(target - this.speed, -acc, acc);
    pos.x += Math.sin(this.heading) * this.speed * dt;
    pos.z += Math.cos(this.heading) * this.speed * dt;
    this.group.rotation.y = this.heading;
    return d;
  }

  update(dt, t) {
    if (!this.alive) return;
    this._moved = false;
    this.stateT += dt;
    this.hitCd = Math.max(0, this.hitCd - dt);
    this._propStun = Math.max(0, (this._propStun || 0) - dt); // recent prop clobber (style kills)
    const pos = this.group.position;
    const toPlayer = _v1.subVectors(Player.pos, pos); toPlayer.y = 0;
    const dist = toPlayer.length();

    // positional groans — the fog navigation mechanic
    this.groanT -= dt;
    if (this.groanT <= 0 && dist < 45) {
      const vol = Math.max(0.08, 1 - dist / 40);
      SFX.groan(panFor(pos), vol * (this.state === 'chase' ? 0.9 : 0.55));
      this.groanT = this.state === 'chase' ? 1.6 + Math.random() * 1.5 : 4 + Math.random() * 4;
    }

    // harbor-bell mesmerize: forget the player, shamble toward the ring.
    // Committed lunges/windups and stuns take priority; the timer holds
    // during a stun, so a dazed zombie resumes its pilgrimage after.
    let lured = false;
    if (this.lureT > 0 && this.state !== 'stunned' && this.state !== 'lunge' && this.state !== 'windup') {
      this.lureT -= dt;
      lured = true;
      const ld = this.moveToward(this.lurePos.x, this.lurePos.z, CFG.zombie.chaseSpeed * this.speedMul * 0.85, dt);
      if (ld <= 2) { this.speed = Math.max(0, this.speed - 8 * dt); this.group.rotation.y += dt * 1.5; } // milling at the bell, entranced
    }

    if (!lured) switch (this.state) {
      case 'wander': {
        if (dist < CFG.zombie.detect) { this.setState('chase'); break; }
        // sniff stops: every so often he halts and sweeps his head around —
        // idle predators pause, they don't metronome between waypoints
        if (this.pauseT > 0) {
          this.pauseT -= dt;
          this.speed = Math.max(0, this.speed - CFG.zombie.decel * dt);
          break;
        }
        if (Math.random() < dt * 0.12) { this.pauseT = 0.7 + Math.random() * 1.2; break; }
        _v2.subVectors(this.target, pos); _v2.y = 0;
        if (_v2.length() < 0.5 || this.stateT > 6) {
          this.target.set(this.home.x + (Math.random() - 0.5) * 8, 0, this.home.z + (Math.random() - 0.5) * 8);
          this.stateT = 0;
        } else {
          this.moveToward(this.target.x, this.target.z, CFG.zombie.wanderSpeed * this.speedMul, dt);
        }
        break;
      }
      case 'chase': {
        if (dist > CFG.zombie.lose) { this.setState('wander'); break; }
        if (dist < 3.2) { this.setState('windup'); break; }
        this.moveToward(Player.pos.x, Player.pos.z, CFG.zombie.chaseSpeed * this.speedMul, dt);
        break;
      }
      case 'windup': { // dramatic lean-back before the flying lunge-hug
        this.group.rotation.x = -0.35 * Math.min(1, this.stateT / CFG.zombie.windup);
        if (this.stateT >= CFG.zombie.windup) {
          this.lungeDir.copy(toPlayer).normalize();
          this.heading = Math.atan2(this.lungeDir.x, this.lungeDir.z); // commit the body to the dive
          this.group.rotation.y = this.heading;
          this.setState('lunge');
          SFX.groan(panFor(pos), 0.9);
        }
        break;
      }
      case 'lunge': {
        pos.addScaledVector(this.lungeDir, CFG.zombie.lungeSpeed * DIFF.speed() * (1 + (this.speedMul - 1) * 0.4) * dt);
        this.group.rotation.x = 0.4;
        if (dist < CFG.zombie.hitRange && this.hitCd <= 0) {
          this.hitCd = 1;
          damagePlayer(CFG.zombie.damage * (this.brute ? CFG.zombie.bruteDamage : 1), this.lungeDir);
        }
        if (this.stateT >= CFG.zombie.lungeTime) { this.group.rotation.x = 0; this.setState('recover'); }
        break;
      }
      case 'recover': {
        if (this.stateT >= CFG.zombie.recover) this.setState(dist < CFG.zombie.lose ? 'chase' : 'wander');
        break;
      }
      case 'stunned': { // frozen in place, seeing stars
        this.stunT -= dt;
        this.stunStars.material.opacity = 0.55 + 0.35 * Math.sin(t * 12);
        if (this.stunT <= 0) {
          this.stunStars.material.opacity = 0;
          this.setState(dist < CFG.zombie.lose ? 'chase' : 'wander');
        }
        break;
      }
      case 'downed': { // face-down on the planks after a slam, wide open
        this.downT -= dt;
        this.stunStars.material.opacity = 0.5 + 0.3 * Math.sin(t * 9);
        // pitch flat fast, then scramble upright over the last half second
        const up = this.downT < 0.5 ? 1 - this.downT / 0.5 : 0;
        this.group.rotation.x = THREE.MathUtils.lerp(this.group.rotation.x, -1.35 * (1 - up), 1 - Math.pow(0.001, dt));
        if (up > 0) this.group.rotation.y += dt * 5 * up; // pushing himself around
        if (this.downT <= 0) {
          this.stunStars.material.opacity = 0;
          this.group.rotation.x = 0;
          this.setState('chase'); // he gets up angry
        }
        break;
      }
    }

    if (!this._moved) this.speed = Math.max(0, this.speed - CFG.zombie.decel * dt);

    // crowd separation: shamblers shoulder each other aside instead of
    // stacking into one super-zombie — cheap O(n^2), n is small
    for (const o of zombies) {
      if (o === this || !o.alive) continue;
      const sx = pos.x - o.group.position.x, sz = pos.z - o.group.position.z;
      const d2 = sx * sx + sz * sz;
      if (d2 > 0.81 || d2 < 1e-6) continue;
      const d = Math.sqrt(d2), push = (0.9 - d) * 0.5;
      pos.x += (sx / d) * push;
      pos.z += (sz / d) * push;
    }

    // keep on the deck
    pos.x = THREE.MathUtils.clamp(pos.x, -(CFG.bridge.playHalfW + 0.1), CFG.bridge.playHalfW + 0.1);
    pos.z = THREE.MathUtils.clamp(pos.z, CFG.bridge.playZEnd, CFG.bridge.zStart - 3);

    // wet planks: a hustling zombie that crosses a slick patch wipes out
    this.slipCd = Math.max(0, this.slipCd - dt);
    if (this.slipCd <= 0 && (this.state === 'chase' || this.state === 'lunge' || lured)) {
      for (const w of wetPatches) {
        const dx = pos.x - w.m.position.x, dz = pos.z - w.m.position.z;
        if (dx * dx + dz * dz < 0.8) {
          this.slipCd = 3;
          this.flinch = 1;
          this.stun(0.8);
          SFX.splat(panFor(pos), 0.7);
          spawnSplash(pos.clone().setY(0.3), true);
          spawnFloatText(pos.clone().add(new THREE.Vector3(0, 2.2, 0)), 'SLIP!', '#9fdcff');
          if (!slipToastShown) { slipToastShown = true; showToast('💦 Zombies slip on wet planks — hose the deck to lay traps!'); }
          break;
        }
      }
    }

    // ---- articulated gait: every part moves, driven by how fast he's walking.
    // gait phase advances with locomotion so steps match ground speed.
    // BUILD 4: stride frequency comes from ACTUAL ground speed, so steps
    // match the deck exactly through acceleration, turns and knockback
    const gaitRate = this.speed * 2.9;
    this.gaitT += dt * gaitRate;
    const gp = this.gaitT;
    const walking = this.speed > 0.25;
    const k = 1 - Math.pow(0.001, dt); // smoothing toward pose targets

    // waddle roll + pitch rock, scaled by stride
    this.group.rotation.z += ((walking ? Math.sin(gp) * 0.09 : 0) - this.group.rotation.z) * k;
    // 'downed' joins windup/lunge here: the gait's idle pose pulls pitch back
    // toward level every frame, which fought the knockdown to a stalemate at
    // about -0.6 rad — a zombie leaning back rather than flat on the planks
    if (this.state !== 'windup' && this.state !== 'lunge' && this.state !== 'downed') {
      this.group.rotation.x += ((walking ? Math.sin(gp * 2) * 0.05 : 0) - this.group.rotation.x) * k;
    }
    // stepping feet: alternate lift + toe pitch, planted when idle
    for (let i = 0; i < 2; i++) {
      const ph = gp + i * Math.PI;
      const lift = walking ? Math.max(0, Math.sin(ph)) : 0;
      this.feet[i].position.y = 0.07 + lift * 0.12;
      this.feet[i].rotation.x += ((walking ? -lift * 0.5 : 0) - this.feet[i].rotation.x) * k;
    }
    // belly squash-and-stretch keyed to footfalls; head bobbles with a lag
    const squash = walking ? Math.abs(Math.sin(gp)) * 0.05 : Math.sin(t * 1.7) * 0.015;
    this.belly.scale.y = 1.1 - squash;
    this.belly.scale.x = 1 + squash * 0.6;
    this.headG.rotation.z += ((walking ? Math.sin(gp - 0.6) * 0.1 : 0) - this.headG.rotation.z) * k;
    this.headG.rotation.x += ((this.state === 'stunned' ? Math.sin(t * 9) * 0.15
      : walking ? Math.sin(gp * 2 - 0.8) * 0.05 : 0) - this.headG.rotation.x) * k;
    // sniff stop: the head sweeps side to side while he pauses mid-wander
    this.headG.rotation.y += ((this.pauseT > 0 ? Math.sin(t * 1.9) * 0.55 : 0) - this.headG.rotation.y) * k;

    // arms: reach forward when hunting, flail high in windup, swing with gait
    const reach = this.state === 'chase' ? -0.9 : this.state === 'windup' ? -2.2 : 0;
    for (let i = 0; i < 2; i++) {
      const s = i === 0 ? -1 : 1;
      const swing = walking ? Math.sin(gp + i * Math.PI) * (this.state === 'chase' ? 0.35 : 0.55) : 0;
      this.arms[i].rotation.x += ((reach + swing) - this.arms[i].rotation.x) * k;
      this.arms[i].rotation.z += ((s * (this.state === 'windup' ? 1.1 : 0.5)
        + (walking ? Math.sin(gp * 2 + i) * 0.1 : Math.sin(t * 2 + i) * 0.06)) - this.arms[i].rotation.z) * k;
    }
    this.sparkle.material.opacity = 0.25 + 0.15 * Math.sin(t * 8);

    // hit-flinch: getting blasted squashes the whole body and shivers the
    // facing for a beat — the jet visibly lands (applies to rig AND GLB)
    this.flinch = Math.max(0, (this.flinch || 0) - dt * 3.5);
    const fl = this.flinch;
    this.group.scale.set(this.sclX * (1 + fl * 0.06), this.sclY * (1 - fl * 0.09), this.sclX * (1 + fl * 0.06));
    if (fl > 0.01) this.group.rotation.y += Math.sin(t * 45) * fl * 0.05;

    // ---- GLB locomotion: the textured model is one baked mesh, so its life
    // comes from whole-body animation — a gait-synced waddle-hop, squash-and-
    // stretch on each footfall, a hungry lean in chase, a stretched lunge,
    // banking into turns, and a dizzy sway while stunned. Without this the
    // AAA mesh slides around like a chess piece.
    if (this.glb) {
      const gl = this.glb;
      gl.position.y = walking ? Math.abs(Math.sin(gp)) * 0.09 : 0;
      const sq = walking ? Math.max(0, -Math.sin(gp * 2)) * 0.06
        : this.state === 'stunned' ? 0 : Math.max(0, Math.sin(t * 1.7)) * 0.02; // idle breathing
      let sy = 1 - sq, sxz = 1 + sq * 0.7, szExtra = 1;
      if (this.state === 'lunge') { szExtra = 1.14; sy *= 0.92; } // stretch through the dive
      gl.scale.set(sxz, sy, sxz * szExtra);
      const leanT = this.state === 'chase' ? 0.14 : this.state === 'lunge' ? 0.3
        : this.state === 'windup' ? -0.25 : 0; // group already leans; this adds body english
      gl.rotation.x += (leanT - gl.rotation.x) * k;
      // bank into turns (yaw delta, wrapped)
      const yaw = this.group.rotation.y;
      let dyaw = yaw - (this._prevYaw ?? yaw);
      if (dyaw > Math.PI) dyaw -= Math.PI * 2; else if (dyaw < -Math.PI) dyaw += Math.PI * 2;
      this._prevYaw = yaw;
      const bank = THREE.MathUtils.clamp(-dyaw * 6, -0.25, 0.25)
        + (this.state === 'stunned' ? Math.sin(t * 6) * 0.12 : 0);
      gl.rotation.z += (bank - gl.rotation.z) * k;
    }
    // the eye burns brighter when he's hunting you
    this.eyeMat.emissiveIntensity = this.state === 'chase' || this.state === 'windup' || this.state === 'lunge'
      ? 1.6 + 0.5 * Math.sin(t * 12)
      : 0.8 + 0.2 * Math.sin(t * 4);
  }
}

/* =====================================================================
   9.4 GENERATED CHARACTER MODELS — textured GLB meshes generated from
   the concept art (image → 3D). They stream in from the media CDN at
   runtime; if the fetch fails the primitive rigs simply stay visible,
   and either way the primitives remain as invisible collision proxies.
   ===================================================================== */
// Each model is tried LOCAL-first, then the CDN, then it silently leaves the
// primitive rig on. Dropping a vendored copy at `local` (e.g. models/jax.glb)
// makes the AAA mesh load offline and on GitHub Pages with zero code change —
// which is the whole project's "no CDN dependency, works offline" principle.
const MODELS = {
  jax: { local: 'models/jax.glb',
    url: 'https://d3u0tzju9qaucj.cloudfront.net/7d051b5a-7bfe-49fe-a484-24e7b3a9458a/651c2d90-8eff-463e-87fb-60b765c0c03b.glb',
    height: 2.05, rotY: 0 }, // gun-toting Jax with red pressure tank + power-washer
  zombie: { local: 'models/zombie.glb',
    url: 'https://d3u0tzju9qaucj.cloudfront.net/7d051b5a-7bfe-49fe-a484-24e7b3a9458a/9c49e60c-c41e-4331-9580-519b0903b524.glb',
    height: 1.95, rotY: 0 },
};
let zombieProto = null, modelsLoadStarted = false;
const gltfLoader = new GLTFLoader();

// scale to a target height, center on the origin, plant feet at y = 0
function normalizeModel(sceneRoot, spec) {
  const wrap = new THREE.Group();
  wrap.add(sceneRoot);
  const box = new THREE.Box3().setFromObject(sceneRoot);
  const size = box.getSize(new THREE.Vector3());
  sceneRoot.scale.setScalar(spec.height / Math.max(size.y, 0.001));
  const box2 = new THREE.Box3().setFromObject(sceneRoot);
  sceneRoot.position.x -= (box2.min.x + box2.max.x) / 2;
  sceneRoot.position.z -= (box2.min.z + box2.max.z) / 2;
  sceneRoot.position.y -= box2.min.y;
  // capture the model's local bounding box (feet-planted, centered, unrotated)
  // so the muzzle can be placed at its forward-most point — the barrel tip
  const lb = new THREE.Box3().setFromObject(sceneRoot);
  wrap.userData.localBox = { min: lb.min.clone(), max: lb.max.clone() };
  // spec.rotY is the baked default; Settings.modelYaw is the player's live
  // correction (Shift+R) — image→3D meshes sometimes come out facing away,
  // and this lets it be fixed without a code round-trip
  wrap.userData.baseRotY = spec.rotY;
  wrap.rotation.y = spec.rotY + (Settings.modelYaw || 0);
  wrap.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return wrap;
}

// derive the gun-muzzle offset from Jax's own geometry: the barrel tip is the
// model's forward-most point in the player's local frame (forward = +Z), so it
// stays correct for whatever model loads and re-tracks when Shift+R re-faces him
function computeGunNozzle(wrap) {
  const b = wrap && wrap.userData.localBox;
  if (!b) return;
  const ry = wrap.rotation.y, cos = Math.cos(ry), sin = Math.sin(ry);
  let maxZ = -Infinity;
  for (const x of [b.min.x, b.max.x]) for (const z of [b.min.z, b.max.z]) {
    const zr = -x * sin + z * cos;       // Y-rotation of the corner
    if (zr > maxZ) maxZ = zr;
  }
  NOZZLE_GUN.fwd = THREE.MathUtils.clamp(maxZ + 0.15, 0.9, 3.4); // just past the tip
  NOZZLE_GUN.up = THREE.MathUtils.clamp(b.min.y + (b.max.y - b.min.y) * 0.6, 1.0, 1.7);
}

// try the vendored local file first, fall back to the CDN, then give up quietly
// (the improved primitive rig stays on). onLoad only fires on success.
function loadModelWithFallback(spec, label, onLoad) {
  gltfLoader.load(spec.local,
    gltf => { console.info(`${label}: loaded vendored ${spec.local}`); onLoad(gltf); },
    undefined,
    () => gltfLoader.load(spec.url,
      gltf => { console.info(`${label}: loaded from CDN (no local copy)`); onLoad(gltf); },
      undefined,
      () => console.info(`${label}: no local or CDN model — primitive rig stays on`)));
}

function loadCharacterModels() {
  if (modelsLoadStarted || MODELS.jax.url.startsWith('MODEL_URL')) return;
  modelsLoadStarted = true;
  loadModelWithFallback(MODELS.jax, 'Jax', gltf => {
    Player.glbVisual = normalizeModel(gltf.scene, MODELS.jax);
    Player.group.add(Player.glbVisual);
    computeGunNozzle(Player.glbVisual); // place the muzzle at the measured barrel tip
    if (Player.hasHorn) { Player.horn.visible = false; Player.hornRing.visible = false; }
    applyModelSetting();
  });
  loadModelWithFallback(MODELS.zombie, 'Zombie', gltf => {
    zombieProto = { scene: gltf.scene, spec: MODELS.zombie };
    for (const z of zombies) if (z.alive) z.applyModel();
    applyModelSetting();
  });
}

// generated GLBs are the heaviest asset in the scene, so they only show when
// the player asked for them AND the device can afford them — on the 'low'
// auto-quality tier (weak hardware, sustained <45fps) we fall back to the
// cheap primitive rigs, which is where the biggest perf win lives
function modelsActive() { return Settings.models && activeTier() !== 'low'; }

// live toggle between generated models and the classic primitive look
function applyModelSetting() {
  const on = modelsActive();
  if (Player.glbVisual) {
    Player.glbVisual.visible = on;
    Player.rig.visible = !on;
    if (Player.hasHorn) { Player.horn.visible = !on; Player.hornRing.visible = !on; }
    // GLB Jax carries the long power-washer → water leaves the barrel tip;
    // primitive Jax uses his short nozzle
    Player.nozzle = on ? NOZZLE_GUN : NOZZLE_PRIMITIVE;
  }
  for (const z of zombies) {
    if (!z.alive) continue;
    if (on && !z.glb) z.applyModel();
    if (z.glb) { z.glb.visible = on; z.rig.visible = !on; }
  }
}

// Shift+R: rotate the generated models 90° and remember it. Fixes a
// back-facing image→3D mesh in-game without a code change; the chosen
// angle persists so the fix survives a reload.
function applyModelYaw() {
  const extra = Settings.modelYaw || 0;
  if (Player.glbVisual) Player.glbVisual.rotation.y = (Player.glbVisual.userData.baseRotY || 0) + extra;
  for (const z of zombies) if (z.glb) z.glb.rotation.y = (z.glb.userData.baseRotY || 0) + extra;
  computeGunNozzle(Player.glbVisual); // barrel tip moves with the new facing
}
function cycleModelYaw() {
  if (!Player.glbVisual && !zombies.some(z => z.glb)) {
    showToast('No 3D model loaded to rotate'); return;
  }
  Settings.modelYaw = ((Settings.modelYaw || 0) + Math.PI / 2) % (Math.PI * 2);
  saveSettings();
  applyModelYaw();
  showToast('🔄 Model facing: ' + Math.round(Settings.modelYaw * 180 / Math.PI) + '°');
}

// nudge the water-jet origin so it sits exactly on the gun barrel; persists
function nudgeNozzle(axis, delta) {
  if (Game.state !== 'playing') return;
  const a = Settings.nozzleAdj;
  a[axis] = Math.round((a[axis] + delta) * 100) / 100;
  saveSettings();
  showToast(`💦 Muzzle: fwd ${(NOZZLE_GUN.fwd + a.fwd).toFixed(2)} · up ${(NOZZLE_GUN.up + a.up).toFixed(2)}`);
}

/* =====================================================================
   9.9 THE GUNK KRAKEN (BUILD 7) — the thing the rot was feeding.
       It hauls itself out of the bay at the end of the pier once the
       wharf is clear. Tentacles hammer the deck on a telegraph; hose a
       pinned one until it breaks and the beast recoils, baring the core
       that is its actual health. Everything the level taught you —
       dodging with the jet, banking hype for damage, the beam for
       burst — is what this fight asks for.
   ===================================================================== */
const BOSS = {
  tentacleGoo: 130, coreGoo: 400, slamDmg: 18, expose: 7,
  slamRadius: 3.7, arena: 20, // metres of deck the fight lives on
};
let boss = null;
// every tentacle segment is the same unit sphere, sized by scale — 4 limbs of
// 18 beads each would otherwise be 72 separate geometries
const TENTACLE_GEO = new THREE.SphereGeometry(1, 10, 8);

class BossTentacle {
  constructor(b, idx, baseX) {
    this.b = b; this.idx = idx;
    this.goo = BOSS.tentacleGoo;
    this.state = 'idle'; this.t = 0;
    this.cd = 1.4 + idx * 1.1;      // staggered so they don't slam in unison
    this.disabled = 0;
    this.base = new THREE.Vector3(baseX * 1.5, -0.4, b.z + 5.5);
    this.tip = this.base.clone().add(new THREE.Vector3(0, 5, 5));
    this.target = this.tip.clone();
    this.lift = 6;

    const hue = 0.08 + idx * 0.05;
    this.mat = new THREE.MeshStandardMaterial({
      color: 0x4a3520, roughness: 0.55,
      emissive: new THREE.Color().setHSL(hue, 0.9, 0.4), emissiveIntensity: 0.25 });
    // Enough beads that neighbours overlap along the whole arc — at 8 they
    // read as a dotted line in the sky, not a limb. Spacing along an ~18m
    // bezier has to stay under one segment diameter.
    this.segs = [];
    this.segR = [];
    const N = 24;
    for (let i = 0; i < N; i++) {
      const u = i / (N - 1);
      const r = 0.95 - 0.5 * u * u;       // thick at the shoulder, tapering to the tip
      const m = new THREE.Mesh(TENTACLE_GEO, this.mat);
      m.scale.setScalar(r);
      m.userData.entity = this;
      m.castShadow = true;
      scene.add(m);
      cleanTargets.push(m);
      this.segs.push(m);
      this.segR.push(r);
    }
    // the telegraph: a ring that swells on the planks where it's about to land
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.72, 1, 40),
      new THREE.MeshBasicMaterial({ color: 0xff5f6e, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.05;
    scene.add(this.ring);
    this.group = { position: this.tip }; // duck-typing for the cleaning helpers
  }

  clean(amount, point) {
    if (!this.b.alive) return;
    // only vulnerable while it's lying on the deck — that's the whole rhythm
    if (this.state !== 'pinned') {
      if (Math.random() < 0.25) spawnSplash(point || this.tip);
      return;
    }
    this.goo -= amount;
    const f = Math.max(this.goo, 0) / BOSS.tentacleGoo;
    this.mat.emissiveIntensity = 0.25 * f;
    if (Math.random() < 0.3) spawnGlitter(point || this.tip, 6, 2);
    if (this.goo <= 0) this.breakOff();
  }

  breakOff() {
    this.state = 'hurt'; this.t = 0;
    this.disabled = 9;
    this.goo = BOSS.tentacleGoo;
    this.mat.emissiveIntensity = 0.25;
    this.ring.material.opacity = 0;
    spawnGlitter(this.tip.clone(), 90, 6);
    spawnChunkBurst(this.tip, { count: 5, mat: this.mat, rMin: 0.14, rMax: 0.3, power: 1.2 });
    SFX.pop(panFor(this.tip), 1);
    spawnFloatText(this.tip.clone().setY(this.tip.y + 2), 'TENTACLE DOWN!', '#ffd94f', { tier: 'headline', pri: 6 });
    Hype.add(0.28);
    gainXP(60, this.tip);
    hitStop = 0.16;
    Player.shake = Math.max(Player.shake, 0.3);
    this.b.expose(BOSS.expose + (this.b.phase() === 3 ? 2 : 0));
  }

  update(dt, t) {
    this.t += dt;
    if (this.disabled > 0) this.disabled -= dt;
    const inArena = Player.pos.z < CFG.bridge.playZEnd + BOSS.arena + 6;

    switch (this.state) {
      case 'idle': {
        // sway above the water, waiting for a turn
        this.tip.set(this.base.x + Math.sin(t * 0.9 + this.idx) * 2.2, 4.2 + Math.sin(t * 1.3 + this.idx) * 0.7,
                     this.base.z + 4 + Math.cos(t * 0.7 + this.idx) * 1.4);
        this.lift += (3.4 - this.lift) * dt * 2;
        this.cd -= dt;
        if (this.cd <= 0 && this.disabled <= 0 && inArena && this.b.activeCount() > this.idx) {
          // aim at where the player is standing, clamped to the arena deck
          this.target.set(
            THREE.MathUtils.clamp(Player.pos.x, -(CFG.bridge.playHalfW - 1), CFG.bridge.playHalfW - 1),
            0.35,
            THREE.MathUtils.clamp(Player.pos.z, CFG.bridge.playZEnd + 1, CFG.bridge.playZEnd + BOSS.arena));
          this.ring.position.set(this.target.x, 0.05, this.target.z);
          this.state = 'rear'; this.t = 0;
          SFX.groan(panFor(this.target), 0.8);
        }
        break;
      }
      case 'rear': { // telegraph — rise high, ring swells under the landing spot
        const f = Math.min(1, this.t / this.b.telegraph());
        this.tip.lerp(_v1.set(this.target.x, 8.5, this.target.z - 1.5), 1 - Math.pow(0.02, dt));
        this.lift += (5.5 - this.lift) * dt * 3;
        this.ring.scale.setScalar(BOSS.slamRadius * (0.45 + 0.55 * f));
        this.ring.material.opacity = 0.35 + 0.4 * f;
        if (f >= 1) { this.state = 'slam'; this.t = 0; }
        break;
      }
      case 'slam': {
        this.tip.lerp(this.target, 1 - Math.pow(0.000002, dt));
        this.lift += (1.2 - this.lift) * dt * 12;
        if (this.tip.distanceTo(this.target) < 0.45 || this.t > 0.5) {
          this.state = 'pinned'; this.t = 0;
          this.ring.material.opacity = 0;
          this.tip.copy(this.target);
          // the hit itself
          const d = Math.hypot(Player.pos.x - this.target.x, Player.pos.z - this.target.z);
          if (d < BOSS.slamRadius && Player.pos.y < 2.4) {
            _v2.set(Player.pos.x - this.target.x, 0, Player.pos.z - this.target.z).normalize();
            damagePlayer(BOSS.slamDmg, _v2.lengthSq() < 0.1 ? new THREE.Vector3(0, 0, 1) : _v2);
          }
          Player.shake = Math.max(Player.shake, 0.55);
          SFX.splat(panFor(this.target), 1);
          spawnSplash(this.target.clone(), true);
          spawnWetPatch(this.target);
          spawnChunkBurst(this.target, { count: 4, mat: this.mat, rMin: 0.1, rMax: 0.22, power: 1.4 });
          spawnFloatText(this.target.clone().setY(1.8), 'PINNED — HOSE IT!', '#9fdcff');
        }
        break;
      }
      case 'pinned': { // the window: lying on the planks and cleanable
        this.lift += (1.1 - this.lift) * dt * 6;
        if (this.t > this.b.pinTime()) { this.state = 'retract'; this.t = 0; }
        break;
      }
      case 'retract': {
        this.tip.lerp(_v1.set(this.base.x, 4.2, this.base.z + 4), 1 - Math.pow(0.06, dt));
        this.lift += (3.4 - this.lift) * dt * 3;
        if (this.t > 0.9) { this.state = 'idle'; this.t = 0; this.cd = this.b.slamCd(); }
        break;
      }
      case 'hurt': { // thrashing back into the bay after being broken
        this.tip.lerp(_v1.set(this.base.x + Math.sin(t * 12) * 1.5, -1.2, this.base.z + 1), 1 - Math.pow(0.15, dt));
        this.lift += (2 - this.lift) * dt * 3;
        if (this.t > 1.2) { this.state = 'idle'; this.t = 0; this.cd = 2 + Math.random(); }
        break;
      }
    }

    // lay the segments along a bezier from base to tip, bowed upward by `lift`
    const cx = (this.base.x + this.tip.x) / 2, cz = (this.base.z + this.tip.z) / 2;
    const cy = Math.max(this.base.y, this.tip.y) + this.lift;
    const n = this.segs.length;
    // a limb reaching 30m needs fatter beads than one curled at 12m, or the
    // spacing outruns the diameter and it reads as a dotted line again
    const span = Math.hypot(this.tip.x - this.base.x, this.tip.y - this.base.y, this.tip.z - this.base.z);
    const thick = THREE.MathUtils.clamp(span / 20, 0.9, 1.75);
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1), iv = 1 - u;
      this.segs[i].position.set(
        iv * iv * this.base.x + 2 * iv * u * cx + u * u * this.tip.x,
        iv * iv * this.base.y + 2 * iv * u * cy + u * u * this.tip.y,
        iv * iv * this.base.z + 2 * iv * u * cz + u * u * this.tip.z);
      const pulse = this.state === 'pinned' ? 1.12 + Math.sin(t * 14 + i) * 0.06 : 1;
      this.segs[i].scale.setScalar(this.segR[i] * thick * pulse);
    }
    if (this.state !== 'rear') this.ring.material.opacity = Math.max(0, this.ring.material.opacity - dt * 3);
  }

  dispose() {
    for (const m of this.segs) {
      const i = cleanTargets.indexOf(m);
      if (i >= 0) cleanTargets.splice(i, 1);
      scene.remove(m); // geometry is shared (TENTACLE_GEO) — never dispose it here
    }
    scene.remove(this.ring); this.ring.geometry.dispose(); this.ring.material.dispose();
  }
}

class GunkKraken {
  constructor() {
    this.alive = true;
    this.goo = BOSS.coreGoo;
    this.exposed = 0;
    this.rise = 0;          // 0..1 emergence animation
    this.spitCd = 7;
    this.z = CFG.bridge.playZEnd - 11;
    const g = this.group = new THREE.Group();
    g.position.set(0, -14, this.z); // starts submerged
    g.scale.setScalar(1.7);         // it has to dwarf the pier to land as a boss

    // a dark silhouette just reads as scenery through the fog — it needs to
    // glow from inside to look alive at 20m
    const hide = new THREE.MeshStandardMaterial({ color: 0x6b4726, roughness: 0.6,
      emissive: 0xb04a00, emissiveIntensity: 0.55 });
    this.hide = hide;
    // a lumpy mass rather than one clean sphere — it should look accreted
    for (const [sx, sy, sz, x, y, z] of [
      [4.2, 3.2, 4.2, 0, 1.4, 0], [2.6, 2.1, 2.6, -3.1, 0.8, 0.6],
      [2.4, 1.9, 2.4, 3.2, 0.7, -0.4], [2.0, 1.6, 2.0, 0.4, 0.6, 2.6]]) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 10), hide);
      m.scale.set(sx, sy, sz); m.position.set(x, y, z);
      m.castShadow = true;
      g.add(m);
    }
    // the maw: two shells that crank apart when the core is bared
    this.shells = [];
    for (const side of [-1, 1]) {
      const sh = new THREE.Mesh(new THREE.SphereGeometry(2.5, 14, 10, 0, Math.PI), hide);
      sh.position.set(0, 2.2, 3.1);
      sh.rotation.z = side > 0 ? 0 : Math.PI;
      sh.userData.side = side;
      g.add(sh);
      this.shells.push(sh);
    }
    this.coreMat = new THREE.MeshStandardMaterial({ color: 0xffe9a8, emissive: 0xffb03f,
      emissiveIntensity: 2.2, roughness: 0.2 });
    this.core = new THREE.Mesh(new THREE.SphereGeometry(1.25, 16, 12), this.coreMat);
    this.core.position.set(0, 2.2, 3.2);
    this.core.userData.entity = this;
    this.core.userData.core = true; // the whole boss fight is a weak-point fight
    g.add(this.core);
    cleanTargets.push(this.core);
    this.coreGlow = glowSprite(0xffc46a, 6, 0);
    this.coreGlow.position.copy(this.core.position);
    g.add(this.coreGlow);
    // eyes, because a silhouette needs somewhere to look from
    this.eyeMat = new THREE.MeshStandardMaterial({ color: 0xffd23f, emissive: 0xffa000, emissiveIntensity: 1.4 });
    for (const ex of [-1.5, 1.5]) {
      const e = new THREE.Mesh(new THREE.SphereGeometry(0.42, 10, 8), this.eyeMat);
      e.position.set(ex, 3.6, 2.4);
      g.add(e);
    }
    const aura = glowSprite(0xff8a3f, 22, 0.28); // carries its bulk through the fog
    aura.position.set(0, 2, 0);
    g.add(aura);
    this.aura = aura;
    scene.add(g);
    camBlockers.push(...this.shells);

    this.tentacles = [];
    [-6.5, 6.5, -2.4, 2.4].forEach((x, i) => this.tentacles.push(new BossTentacle(this, i, x)));
  }

  // armoured between limb breaks: the core is there, but it can't be crit
  // (or damaged) until a tentacle goes down and bares it
  canCrit() { return this.exposed > 0; }

  // phase 1 while the core is fat, 3 once it's nearly done
  phase() { const f = this.goo / BOSS.coreGoo; return f > 0.66 ? 1 : f > 0.33 ? 2 : 3; }
  activeCount() { return this.phase() + 1; }       // 2, 3, then all 4 tentacles
  slamCd() { return [0, 3.4, 2.8, 2.2][this.phase()]; }
  telegraph() { return [0, 1.15, 1, 0.85][this.phase()]; }
  pinTime() { return [0, 2.9, 2.7, 2.5][this.phase()]; }

  expose(secs) {
    this.exposed = Math.max(this.exposed, secs);
    showToast('🐙 THE CORE IS BARE — burn it down!');
  }

  clean(amount, point) {
    if (!this.alive || this.exposed <= 0) {
      if (Math.random() < 0.2) spawnSplash(point || this.core.getWorldPosition(_v1));
      return; // armoured until a tentacle goes down
    }
    this.goo -= amount;
    bossFillEl.style.width = Math.max(0, this.goo / BOSS.coreGoo * 100) + '%';
    if (Math.random() < 0.3) spawnGlitter(point || this.core.getWorldPosition(_v1), 7, 3);
    if (this.goo <= 0) this.die();
  }

  die() {
    this.alive = false;
    Game.bossDefeated = true;
    const c = this.group.position.clone(); c.y += 3;
    hitStop = 0.5;
    Player.shake = Math.max(Player.shake, 0.9);
    Player._fovPunch = Math.max(Player._fovPunch, 12);
    for (let i = 0; i < 8; i++) {
      spawnGlitter(c.clone().add(new THREE.Vector3((Math.random() - 0.5) * 12, Math.random() * 6, (Math.random() - 0.5) * 12)), 140, 9);
    }
    spawnChunkBurst(c, { count: 12, mat: this.hide, rMin: 0.25, rMax: 0.6, power: 2.2 });
    SFX.pop(panFor(c), 1); SFX.fanfare();
    Hype.add(1);
    gainXP(400, c);
    bossBarEl.classList.add('hidden');
    showToast('🐙 THE GUNK KRAKEN IS PURIFIED!');
    narrate('The wharf is yours, janitor.', 0.6);
    for (const t of this.tentacles) t.dispose();
    const i = cleanTargets.indexOf(this.core);
    if (i >= 0) cleanTargets.splice(i, 1);
    checkWin();
  }

  update(dt, t) {
    if (!this.alive) return;
    // haul out of the bay on first sight
    if (this.rise < 1) {
      this.rise = Math.min(1, this.rise + dt * 0.35);
      const e = 1 - Math.pow(1 - this.rise, 3);
      this.group.position.y = -14 + e * 15;
      if (Math.random() < dt * 12) spawnSplash(this.group.position.clone().add(
        new THREE.Vector3((Math.random() - 0.5) * 9, 0.4, (Math.random() - 0.5) * 6)), true);
    } else {
      this.group.position.y = 1 + Math.sin(t * 0.8) * 0.35; // breathing swell
    }
    this.group.rotation.y = Math.sin(t * 0.35) * 0.12;

    this.exposed = Math.max(0, this.exposed - dt);
    const open = this.exposed > 0 ? 1 : 0;
    this._open = (this._open ?? 0) + (open - (this._open ?? 0)) * (1 - Math.pow(0.02, dt));
    for (const sh of this.shells) sh.rotation.x = -this._open * 1.15 * sh.userData.side;
    this.coreGlow.material.opacity = this._open * (0.55 + 0.25 * Math.sin(t * 9));
    this.coreMat.emissiveIntensity = 1 + this._open * 2.4;
    this.eyeMat.emissiveIntensity = this.phase() === 3 ? 2.8 : 1.6;
    this.aura.material.opacity = 0.2 + 0.12 * this._open + (this.phase() === 3 ? 0.12 : 0);
    if (this.phase() === 3) this.hide.emissive.setHex(0xa02000);

    if (this.rise > 0.75) for (const tn of this.tentacles) tn.update(dt, t);

    // phase 2+: hawk gunk onto the deck so the arena never goes quiet
    if (this.phase() >= 2 && this.rise >= 1) {
      this.spitCd -= dt;
      if (this.spitCd <= 0) {
        this.spitCd = this.phase() === 3 ? 4.5 : 6.5;
        const sx = THREE.MathUtils.clamp(Player.pos.x + (Math.random() - 0.5) * 8,
          -(CFG.bridge.playHalfW - 1), CFG.bridge.playHalfW - 1);
        const sz = THREE.MathUtils.clamp(Player.pos.z + (Math.random() - 0.5) * 8,
          CFG.bridge.playZEnd + 1, CFG.bridge.playZEnd + BOSS.arena);
        spawnGullSplat(sx, sz); // reuse the falling-splat entity wholesale
        SFX.groan(panFor(this.group.position), 0.7);
      }
    }
    bossFillEl.style.width = Math.max(0, this.goo / BOSS.coreGoo * 100) + '%';
    bossStateEl.textContent = this.exposed > 0 ? 'CORE EXPOSED' : 'ARMOURED — BREAK A TENTACLE';
  }
}

/* =====================================================================
   9.95 WHARF RUSH (BUILD 8) — the endless mode. The story run is one and
        done; this is the reason to come back. Same pier, no objectives,
        escalating waves, and a score that only climbs while you keep the
        hype alive. Dying ends the run and banks a high score.
   ===================================================================== */
/* ---------------------------------------------------------------------
   PERKS (BUILD 9) — the run-scoped upgrade layer. The talent tree is a
   slow drip across a whole level; this is the fast one: clear a wave,
   pick one of three, watch the build compound. Same discipline as the
   talents — every perk is read at the call site, never written into CFG.
   --------------------------------------------------------------------- */
const PERKS = [
  { key: 'power',   icon: '💦', name: 'HIGH PRESSURE', desc: '+22% hose power, stacking.' },
  { key: 'tank',    icon: '🫧', name: 'BIGGER TANK',   desc: 'Pressure refills 40% faster and drains slower.' },
  { key: 'boots',   icon: '👟', name: 'SPRING BOOTS',  desc: 'Move 12% faster and jump noticeably higher.' },
  { key: 'wide',    icon: '🌊', name: 'FLARED CONE',   desc: 'BLAST reaches further and hits wider.' },
  { key: 'leech',   icon: '💗', name: 'SUDS THERAPY',  desc: 'Cleaning slowly heals you.' },
  { key: 'hype',    icon: '🪩', name: 'SLOW BURN',     desc: 'Hype drains 40% slower — hold LEGENDARY longer.' },
  { key: 'beam',    icon: '🌈', name: 'PRISM LENS',    desc: 'Magic Beam costs less rainbow to fire.' },
  { key: 'thorns',  icon: '✨', name: 'GLITTER BOMB',  desc: 'Popped piles damage nearby zombies.' },
];
const Perks = {
  taken: {},
  rank(k) { return this.taken[k] || 0; },
  reset() { this.taken = {}; },
  hoseMul() { return 1 + 0.22 * this.rank('power'); },
  regenMul() { return 1 + 0.4 * this.rank('tank'); },
  drainMul() { return 1 / (1 + 0.18 * this.rank('tank')); },
  speedMul() { return 1 + 0.12 * this.rank('boots'); },
  jumpMul() { return 1 + 0.14 * this.rank('boots'); },
  blastMul() { return 1 + 0.22 * this.rank('wide'); },
  leech() { return 0.9 * this.rank('leech'); },        // hp per second of contact
  hypeDecayMul() { return 1 / (1 + 0.4 * this.rank('hype')); },
  beamCostMul() { return 1 / (1 + 0.25 * this.rank('beam')); },
  thorns() { return 26 * this.rank('thorns'); },
};
const perkPickEl = document.getElementById('perkPick');
const perkRowEl = document.getElementById('perkRow');
const perkOwnedEl = document.getElementById('perkOwned');
let perkOffer = [];

function offerPerks() {
  const pool = PERKS.slice();
  perkOffer = [];
  for (let i = 0; i < 3 && pool.length; i++) {
    perkOffer.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  }
  perkRowEl.innerHTML = '';
  perkOffer.forEach((pk, i) => {
    const card = document.createElement('div');
    card.className = 'perkCard';
    const rank = Perks.rank(pk.key);
    card.innerHTML = `<div class="ico">${pk.icon}</div><h3>${pk.name}${rank ? ' ' + (rank + 1) : ''}</h3>` +
      `<p>${pk.desc}</p><div class="key">${i + 1}</div>`;
    card.addEventListener('click', () => takePerk(i));
    perkRowEl.appendChild(card);
  });
  const owned = Object.entries(Perks.taken).map(([k, v]) => {
    const d = PERKS.find(p => p.key === k);
    return `${d.icon} ${d.name}${v > 1 ? ' ×' + v : ''}`;
  });
  perkOwnedEl.textContent = owned.length ? 'Loadout: ' + owned.join('  ·  ') : '';
  perkPickEl.classList.add('show');
  Game.state = 'perks';           // freeze the world while you read
  if (document.exitPointerLock) document.exitPointerLock();
}

function takePerk(i) {
  const pk = perkOffer[i];
  if (!pk) return;
  Perks.taken[pk.key] = Perks.rank(pk.key) + 1;
  perkPickEl.classList.remove('show');
  Game.state = 'playing';
  SFX.chime(1.3);
  showToast(`${pk.icon} ${pk.name} acquired`);
  spawnGlitter(Player.pos.clone().add(new THREE.Vector3(0, 1.5, 0)), 60, 5);
  if (!IS_TOUCH && canvas.requestPointerLock) canvas.requestPointerLock();
}

const rushHudEl = document.getElementById('rushHud');
const rushWaveEl = document.getElementById('rushWave');
const rushScoreEl = document.getElementById('rushScore');
const rushBestEl = document.getElementById('rushBest');
const waveBannerEl = document.getElementById('waveBanner');

const Rush = {
  on: false, wave: 0, score: 0, best: 0, breather: 0, cleared: false,
  load() { try { this.best = Number(localStorage.getItem('uj_l2_rush_best')) || 0; } catch (e) {} },
  save() { try { localStorage.setItem('uj_l2_rush_best', String(Math.max(this.best, this.score))); } catch (e) {} },
  // score is multiplied by the hype tier, so playing stylishly is worth more
  // than playing safely — the two systems are meant to feed each other
  award(points, pos) {
    if (!this.on) return;
    const mult = 1 + Hype.tier * 0.5;
    const got = Math.round(points * mult);
    this.score += got;
    rushScoreEl.textContent = this.score.toLocaleString();
    if (pos && Hype.tier > 0) spawnFloatText(pos.clone().setY(pos.y + 2.2), `+${got}`, HYPE_TIERS[Hype.tier].color, { tier: 'ticker', key: 'score' });
  },
};
Rush.load();

function banner(text) {
  waveBannerEl.textContent = text;
  waveBannerEl.classList.remove('show'); void waveBannerEl.offsetWidth;
  waveBannerEl.classList.add('show');
}

// strip the story layer out so the pier becomes a pure arena
function clearStoryContent() {
  for (const p of piles) if (p.alive) { p.alive = false; removeCleanTargets(p.group); scene.remove(p.group); }
  piles.length = 0;
  for (const z of zombies) if (z.alive) { z.alive = false; removeCleanTargets(z.group); scene.remove(z.group); }
  zombies.length = 0;
  for (const c of civilians) if (!c.resolved) { c.resolved = true; removeCleanTargets(c.group); scene.remove(c.group); }
  civilians.length = 0;
  Game.totalPiles = 0; Game.totalZombies = 0; Game.civTotal = 0;
  Game.pilesCleaned = 0; Game.zombiesDefeated = 0; Game.civResolved = 0;
}

function startRush() {
  Rush.on = true;
  Rush.wave = 0; Rush.score = 0; Rush.breather = 3.5; Rush.cleared = false;
  Perks.reset();
  clearStoryContent();
  Player.hasHorn = true;
  Player.horn && (Player.horn.visible = true);
  Player.hornGlow && (Player.hornGlow.visible = true);
  if (Player.hornLight) Player.hornLight.intensity = 3;
  if (hornPickup) { scene.remove(hornPickup); hornPickup = null; }
  document.getElementById('objectives').classList.add('hidden');
  rushHudEl.classList.remove('hidden');
  rushScoreEl.textContent = '0';
  rushBestEl.textContent = 'BEST ' + Rush.best.toLocaleString();
  rushWaveEl.textContent = 'GET READY';
  SFX.setMusicMood('hero');
  showToast('🌊 WHARF RUSH — survive the tide. Style pays double.');
}

// a wave is a mix that shifts with depth: shamblers, then runners, then
// brutes, with a swarm every fifth wave
function startWave() {
  Rush.wave++;
  Rush.cleared = false;
  const w = Rush.wave;
  const swarm = w % 5 === 0;
  // a wave is a threat, not a framerate test: keep the live crowd bounded so
  // deep waves get *harder* (more brutes/runners) rather than just heavier
  const live = zombies.reduce((n, z) => n + (z.alive ? 1 : 0), 0);
  const want = Math.min(16, 3 + Math.floor(w * 1.2)) * (swarm ? 2 : 1);
  const count = Math.max(2, Math.min(want, 26 - live));
  const runnerFrom = 2, bruteFrom = 4;
  for (let i = 0; i < count; i++) {
    const ang = Math.random() * Math.PI * 2;
    const dist = 24 + Math.random() * 20;
    const x = THREE.MathUtils.clamp(Player.pos.x + Math.sin(ang) * dist,
      -(CFG.bridge.playHalfW - 1.5), CFG.bridge.playHalfW - 1.5);
    const z = THREE.MathUtils.clamp(Player.pos.z + Math.cos(ang) * dist,
      CFG.bridge.playZEnd + 2, CFG.bridge.zStart - 4);
    const roll = Math.random();
    const brute = w >= bruteFrom && roll < 0.12 + w * 0.012;
    const runner = !brute && w >= runnerFrom && roll < 0.45;
    const z2 = new Zombie(x, z, { runner, brute });
    z2.setState('chase');
    z2.heading = Math.atan2(Player.pos.x - x, Player.pos.z - z);
    zombies.push(z2);
  }
  // a little filth to scrub for points and hype fuel
  for (let i = 0; i < 2 + Math.floor(w / 2); i++) {
    const x = (Math.random() - 0.5) * (CFG.bridge.playHalfW * 1.7);
    const z = THREE.MathUtils.clamp(Player.pos.z + (Math.random() - 0.5) * 44,
      CFG.bridge.playZEnd + 2, CFG.bridge.zStart - 4);
    piles.push(new PoopPile(x, z, 0.85 + Math.random() * 0.5));
  }
  rushWaveEl.textContent = 'WAVE ' + w;
  rushScoreEl.textContent = Rush.score.toLocaleString(); // keep the readout honest between awards
  banner(swarm ? `WAVE ${w} · SWARM!` : `WAVE ${w}`);
  SFX.fanfare();
  Player.shake = Math.max(Player.shake, swarm ? 0.4 : 0.2);
}

function updateRush(dt) {
  if (!Rush.on || Game.state !== 'playing') return;
  if (Rush.breather > 0) {
    Rush.breather -= dt;
    if (Rush.breather <= 0) startWave();
    return;
  }
  const liveZ = zombies.some(z => z.alive);
  const livePiles = piles.some(p => p.alive);
  if (!liveZ && !livePiles && !Rush.cleared) {
    Rush.cleared = true;
    Rush.breather = 5;
    Rush.award(200 * Rush.wave, Player.pos.clone().setY(1.5));
    Player.hp = Math.min(100, Player.hp + 14); // a breath, not a full heal
    hpFill.style.width = Player.hp + '%';
    Meters.pressure = 100;
    rushWaveEl.textContent = 'WAVE ' + Rush.wave + ' CLEAR';
    banner('WAVE CLEAR');
    showToast(`✅ Wave ${Rush.wave} down · +${200 * Rush.wave}`);
    offerPerks();
  }
}

function summonBoss() {
  if (boss) return boss;
  boss = new GunkKraken();
  Game.bossActive = true;
  bossBarEl.classList.remove('hidden');
  SFX.setMusicMood('hero');
  Player.shake = Math.max(Player.shake, 0.7);
  showToast('🐙 THE BAY ERUPTS — something enormous is climbing the pier!');
  narrate('Janitor. The rot had a heart, and it is awake.', 0.55);
  return boss;
}
function updateBoss(dt, t) { if (boss) boss.update(dt, t); }

/* =====================================================================
   9.5 STORY CONTENT (design doc) — transforming civilians, the hidden
   meteor shard, flickering streetlights, and Jax's graffiti job site.
   ===================================================================== */
const civilians = [];

// A person half-consumed by rainbow rot. Their timer starts when the player
// gets close: hose them clean to save them, or they become a zombie.
class Civilian {
  constructor(x, z) {
    this.goo = 60;
    this.timer = CFG.civilian.timer * DIFF.rescue();
    this.active = false;
    this.resolved = false;
    this.warned = false;
    const g = this.group = new THREE.Group();
    g.position.set(x, 0, z);

    // a sea lion hauled out on the pier, rainbow rot creeping up its back
    const hide = new THREE.MeshStandardMaterial({ color: 0x6b5643, roughness: 0.7 });
    const hideDark = new THREE.MeshStandardMaterial({ color: 0x57452f, roughness: 0.75 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.6, 1.6, 4, 8), hide);
    body.rotation.x = Math.PI / 2 - 0.2; // chest raised, nose up — classic haul-out pose
    body.position.y = 0.62; body.userData.entity = this;
    g.add(body); cleanTargets.push(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.42, 10, 8), hide);
    head.position.set(0, 1.28, 1.12); head.userData.entity = this;
    g.add(head); cleanTargets.push(head);
    const snout = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), hideDark);
    snout.position.set(0, 1.16, 1.5);
    g.add(snout);
    for (const s of [-1, 1]) { // front flippers splayed on the planks
      const flip = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.7, 5), hideDark);
      flip.rotation.z = s * 2.1;
      flip.position.set(s * 0.6, 0.34, 0.55);
      g.add(flip);
    }
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.7, 6), hideDark);
    tail.rotation.x = -1.25;
    tail.position.set(0, 0.35, -1.15);
    g.add(tail);
    // creeping rainbow rot — shrinks as it's hosed off
    this.rot = [];
    const dripGeo = new THREE.SphereGeometry(0.1, 6, 5);
    for (let i = 0; i < 5; i++) {
      const hue = Math.random();
      const d = new THREE.Mesh(dripGeo, new THREE.MeshStandardMaterial({
        color: new THREE.Color().setHSL(hue, 0.9, 0.5),
        emissive: new THREE.Color().setHSL(hue, 0.9, 0.4),
        emissiveIntensity: 1, roughness: 0.3 }));
      d.position.set((Math.random() - 0.5) * 0.7, 0.55 + Math.random() * 0.7, -0.8 + Math.random() * 1.6);
      d.userData.entity = this;
      g.add(d); this.rot.push(d); cleanTargets.push(d);
    }
    g.rotation.y = (Math.random() - 0.5) * 1.5;
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    scene.add(g);
  }

  clean(amount, point) {
    if (this.resolved) return;
    this.goo -= amount;
    if (Math.random() < 0.15) spawnGlitter(point || this.group.position, 5, 2);
    const f = Math.max(this.goo, 0) / 60;
    for (const d of this.rot) d.scale.setScalar(0.4 + 0.8 * f);
    if (this.goo <= 0) this.save();
  }

  save() {
    this.resolved = true;
    Game.civSaved++; Game.civResolved++;
    Meters.rainbow = Math.min(100, Meters.rainbow + 20);
    spawnGlitter(this.group.position.clone().add(new THREE.Vector3(0, 1.4, 0)), 80, 5);
    spawnFloatText(this.group.position.clone().add(new THREE.Vector3(0, 2.3, 0)), 'SAVED!', '#5fffb0');
    Hype.add(0.3);
    gainXP(75, this.group.position);
    SFX.chime(1.25);
    showToast('🦭 Sea lion saved! It barks and flops back toward the water.');
    removeCleanTargets(this.group);
    scene.remove(this.group);
    updateObjectiveHUD();
    checkWin();
  }

  transform() {
    this.resolved = true;
    Game.civResolved++;
    removeCleanTargets(this.group);
    scene.remove(this.group);
    const p = this.group.position;
    spawnGlitter(p.clone().add(new THREE.Vector3(0, 1.2, 0)), 60, 5);
    SFX.groan(panFor(p), 1);
    showToast('💀 Too late — the rot took the sea lion!');
    narrate('Too late. The rot has taken the poor creature.', 0.6);
    const z = new Zombie(p.x, p.z);
    z.setState('chase');
    zombies.push(z);
    Game.totalZombies++;
    updateObjectiveHUD();
  }

  update(dt, t) {
    if (this.resolved) return;
    const dist = this.group.position.distanceTo(Player.pos);
    if (!this.active && dist < 26) {
      this.active = true; // pacing: the countdown starts when you can see them
      showToast('🦭 A sea lion is infected — hose the rot off before it turns!');
      narrate('Cleanse the sea lion, janitor, before the rot takes hold.', 0.6);
    }
    if (!this.active) return;
    this.timer -= dt;
    const panic = 1 - Math.max(this.timer, 0) / (CFG.civilian.timer * DIFF.rescue());
    this.group.rotation.z = Math.sin(t * (8 + panic * 16)) * 0.05 * (1 + panic * 2);
    for (const d of this.rot) d.scale.multiplyScalar(1 + 0.02 * dt); // rot slowly spreads
    if (!this.warned && this.timer < 8) {
      this.warned = true;
      spawnFloatText(this.group.position.clone().add(new THREE.Vector3(0, 2.4, 0)), 'HELP!', '#ff6f8a');
    }
    if (this.timer <= 0) this.transform();
  }
}

// ---- hidden meteor shard: optional collectible tucked behind a wreck ----
let shard = null;
function buildShard() {
  shard = new THREE.Group();
  shard.position.set(-10.2, 0.9, -186); // way out by the last shops — a reason to walk the dark end
  const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.32, 0),
    new THREE.MeshStandardMaterial({ color: 0xbfffff, emissive: 0x7fe8ff,
      emissiveIntensity: 1.6, roughness: 0.15 }));
  shard.add(gem);
  shard.add(glowSprite(0x9ffcff, 2.2, 0.45));
  scene.add(shard);
}
function updateShard(dt, t) {
  if (!shard) return;
  shard.rotation.y += dt * 1.5;
  shard.position.y = 0.9 + Math.sin(t * 2.2) * 0.15;
  if (Player.pos.distanceTo(shard.position) < 1.8) {
    Game.shardFound = true;
    spawnGlitter(shard.position.clone(), 100, 6);
    SFX.fanfare();
    showToast('🌠 METEOR SHARD FRAGMENT found!');
    gainXP(100, shard.position);
    scene.remove(shard);
    shard = null;
  }
}

// ---- streetlights, two of them flickering for the mood ----
const lamps = [];
let lampLight;
function buildStreetlights() {
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x2e3338, roughness: 0.6, metalness: 0.4 });
  const poleGeo = new THREE.CylinderGeometry(0.07, 0.09, 3.8, 6);
  const armGeo = new THREE.BoxGeometry(0.08, 0.08, 1.1);
  const bulbGeo = new THREE.SphereGeometry(0.14, 8, 6);
  for (const [side, z, flicker] of [[-1, -14, false], [1, -28, false], [-1, -44, true],
                                    [1, -58, false], [-1, -72, true], [1, -84, false],
                                    [-1, -100, true], [1, -118, false], [-1, -136, true],
                                    [1, -154, false], [-1, -172, false], [1, -190, true]]) {
    const x = side * (CFG.bridge.playHalfW - 0.5);
    const pole = new THREE.Mesh(poleGeo, poleMat);
    pole.position.set(x, 1.9, z);
    scene.add(pole);
    const arm = new THREE.Mesh(armGeo, poleMat);
    arm.rotation.y = Math.PI / 2;
    arm.position.set(x - side * 0.5, 3.75, z);
    scene.add(arm);
    const mat = new THREE.MeshStandardMaterial({ color: 0xfff3d0, emissive: 0xffe9a8, emissiveIntensity: 1.8 });
    const bulb = new THREE.Mesh(bulbGeo, mat);
    bulb.position.set(x - side * 1.0, 3.7, z);
    scene.add(bulb);
    const glow = glowSprite(0xffe9a8, 1.6, 0.5);
    glow.position.copy(bulb.position);
    scene.add(glow);
    lamps.push({ mat, glow, flicker, on: true, t: Math.random() });
  }
  // one real light under the first flickering lamp — moody pools on the deck
  lampLight = new THREE.PointLight(0xffe4a0, 2.2, 16);
  lampLight.position.set(-(CFG.bridge.playHalfW - 1.5), 3.6, -44);
  scene.add(lampLight);
}
function updateStreetlights(dt) {
  for (const l of lamps) {
    if (!l.flicker) continue;
    l.t -= dt;
    if (l.t <= 0) {
      l.on = !l.on || Math.random() < 0.75; // mostly on, stuttering off
      l.t = l.on ? 0.4 + Math.random() * 2.2 : 0.04 + Math.random() * 0.15;
      l.mat.emissiveIntensity = l.on ? 1.8 : 0.15;
      l.glow.material.opacity = l.on ? 0.5 : 0.05;
    }
  }
  if (lampLight) lampLight.intensity = lamps[2].on ? 2.2 : 0.2;
}

// ---- graffiti near the spawn: the job Jax was doing when the sky fell ----
function buildGraffiti() {
  const tags = [['PIER PRESSURE', '#ff5fa2'], ['FISH & SUDS', '#5fc8ff'], ['WASH ME', '#ffd94f']];
  tags.forEach(([text, color], i) => {
    const c = document.createElement('canvas'); c.width = 256; c.height = 96;
    const g = c.getContext('2d');
    g.font = '700 46px "Segoe UI", system-ui, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.shadowColor = color; g.shadowBlur = 16;
    g.fillStyle = color;
    g.save(); g.translate(128, 48); g.rotate((i - 1) * 0.08);
    g.fillText(text, 0, 0); g.restore();
    const side = i % 2 === 0 ? -1 : 1;
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.85),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true }));
    plane.position.set(side * (CFG.bridge.width / 2 - 0.82), 0.62, 11 - i * 6);
    plane.rotation.y = -side * Math.PI / 2; // on the curb's inner face
    scene.add(plane);
  });
}

/* =====================================================================
   10. PLAYER — Jax: neon-blue jumpsuit, glowing horn (once picked up)
   ===================================================================== */
const Player = {
  group: null, pos: null, vel: new THREE.Vector3(), knock: new THREE.Vector3(),
  hvel: new THREE.Vector3(), // horizontal momentum (BUILD 4)
  _aimT: 0, _fovPunch: 0,    // camera-rig state (BUILD 5)
  yaw: Math.PI, pitch: -0.05, onGround: true, hp: CFG.player.hp,
  slamming: false, slamFrom: 0, // ground pound: state + the height it started from
  hasHorn: false, horn: null, hornLight: null, shake: 0,
  forward: new THREE.Vector3(), aim: new THREE.Vector3(),
  // muzzle offset from the player origin; swapped for the long GLB gun below
  nozzle: { up: 1.5, fwd: 0.6, right: 0 },
};
const NOZZLE_PRIMITIVE = { up: 1.5, fwd: 0.6, right: 0 };
// tip of the long power-washer barrel, well out in front (not at his hands/chest)
const NOZZLE_GUN = { up: 1.24, fwd: 2.4, right: 0.16 };

function buildPlayer() {
  const g = Player.group = new THREE.Group();
  Player.pos = g.position;
  g.position.set(0, 0, 12);

  // concept art: navy short-sleeve jumpsuit over a black tee, leather
  // suspenders + belt, cargo pants, mohawk with shaved silver sides,
  // candy-striped horn, red pressure hose
  const shirt = new THREE.MeshStandardMaterial({ color: 0x2a3d63, roughness: 0.8 });
  const denim = new THREE.MeshStandardMaterial({ color: 0x22314c, roughness: 0.85 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xd8a882, roughness: 0.6 });
  const leather = new THREE.MeshStandardMaterial({ color: 0x5a3d26, roughness: 0.7 });
  const steel = new THREE.MeshStandardMaterial({ color: 0xc4ccd6, metalness: 0.75, roughness: 0.3 });
  const black = new THREE.MeshStandardMaterial({ color: 0x14161c, roughness: 0.8 });

  // torso + black tee peeking at the collar + zipper stripe
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.4, 0.5, 4, 8), shirt);
  body.position.y = 1.3;
  g.add(body);
  const tee = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.3, 0.14, 10), black);
  tee.position.y = 1.63;
  g.add(tee);
  const zip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.5, 0.03), steel);
  zip.position.set(0, 1.28, 0.4);
  g.add(zip);

  // chest pockets with steel buttons
  const pocketGeo = new THREE.BoxGeometry(0.18, 0.16, 0.04);
  for (const s of [-1, 1]) {
    const pocket = new THREE.Mesh(pocketGeo, denim);
    pocket.position.set(s * 0.2, 1.4, 0.36);
    pocket.rotation.y = s * -0.2;
    g.add(pocket);
    const btn = new THREE.Mesh(new THREE.SphereGeometry(0.022, 6, 5), steel);
    btn.position.set(s * 0.2, 1.49, 0.385);
    g.add(btn);
  }

  // leather suspenders over both shoulders, clasped at the chest
  const strapGeo = new THREE.BoxGeometry(0.09, 0.6, 0.03);
  for (const s of [-1, 1]) {
    const front = new THREE.Mesh(strapGeo, leather);
    front.position.set(s * 0.2, 1.34, 0.39);
    front.rotation.x = -0.1; front.rotation.z = s * 0.12;
    g.add(front);
    const back = new THREE.Mesh(strapGeo, leather);
    back.position.set(s * 0.2, 1.34, -0.39);
    back.rotation.x = 0.1; back.rotation.z = s * -0.12;
    g.add(back);
    const clasp = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.06, 0.045), steel);
    clasp.position.set(s * 0.22, 1.07, 0.36);
    g.add(clasp);
  }

  // jeans + boots — pivoted at the hip so they can swing while running;
  // the boot is a child of the leg so it follows the stride
  Player.legs = [];
  const legGeo = new THREE.BoxGeometry(0.22, 0.55, 0.26);
  legGeo.translate(0, -0.275, 0); // pivot at the top (hip)
  const bootGeo = new THREE.BoxGeometry(0.26, 0.22, 0.42);
  const cargoGeo = new THREE.BoxGeometry(0.06, 0.16, 0.15);
  for (const s of [-1, 1]) {
    const leg = new THREE.Mesh(legGeo, denim);
    leg.position.set(s * 0.17, 0.82, 0);
    const boot = new THREE.Mesh(bootGeo, leather);
    boot.position.set(0.01 * s, -0.66, 0.05);
    leg.add(boot);
    const cargo = new THREE.Mesh(cargoGeo, shirt); // side cargo pocket
    cargo.position.set(s * 0.13, -0.28, 0);
    leg.add(cargo);
    g.add(leg);
    Player.legs.push(leg);
  }

  // tool belt + buckle
  const belt = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.14, 0.56), leather);
  belt.position.y = 0.88;
  g.add(belt);
  const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.1, 0.04), steel);
  buckle.position.set(0, 0.88, 0.3);
  g.add(buckle);

  // muscular bare arms — pivoted at the shoulder for the run swing
  // muscular bare arms, brought inward so both hands can grip the gun out front;
  // the run cycle keeps them in the forward hold (see updatePlayer) rather than
  // swinging them like an empty-handed run.
  Player.armsM = [];
  const glove = new THREE.MeshStandardMaterial({ color: 0x14161c, roughness: 0.7 });
  const armGeo = new THREE.CapsuleGeometry(0.12, 0.5, 3, 6);
  armGeo.translate(0, -0.28, 0); // pivot at the shoulder
  for (const s of [-1, 1]) {
    const arm = new THREE.Mesh(armGeo, skin);
    arm.position.set(s * 0.33, 1.6, 0.08);
    arm.rotation.z = s * 0.12;
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), glove);
    hand.position.set(0, -0.82, 0); // at the forearm tip, follows the reach
    arm.add(hand);
    g.add(arm);
    Player.armsM.push(arm);
  }

  // the whole head rides a neck joint so Jax visibly looks where he aims —
  // pitch nods the head, and the mane sways with his motion (moving parts)
  const headG = Player.headG = new THREE.Group();
  headG.position.y = 1.72; // neck pivot
  g.add(headG);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 10), skin);
  head.position.y = 0.13;
  headG.add(head);

  // shaved silver sides + the permanent scowl (heavy brows, hard eyes)
  const silver = new THREE.MeshStandardMaterial({ color: 0xcfd2d6, roughness: 0.45 });
  for (const s of [-1, 1]) {
    const side = new THREE.Mesh(new THREE.SphereGeometry(0.27, 10, 8), silver);
    side.scale.set(0.42, 0.72, 0.8);
    side.position.set(s * 0.17, 0.22, -0.04);
    headG.add(side);
    const brow = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.035, 0.04), black);
    brow.position.set(s * 0.1, 0.21, 0.245);
    brow.rotation.z = s * -0.28; // angled inward: he is not happy about the poop
    brow.rotation.y = s * 0.35;
    headG.add(brow);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.026, 6, 5), black);
    eye.position.set(s * 0.1, 0.165, 0.255);
    headG.add(eye);
  }

  // white unicorn ears
  const earGeo = new THREE.ConeGeometry(0.07, 0.18, 6);
  const earMat = new THREE.MeshStandardMaterial({ color: 0xf4f0ec, roughness: 0.5 });
  for (const s of [-1, 1]) {
    const ear = new THREE.Mesh(earGeo, earMat);
    ear.position.set(s * 0.19, 0.38, -0.02);
    ear.rotation.z = s * -0.3;
    headG.add(ear);
  }

  // rainbow mohawk-mane: taller, denser, swept back like the art.
  // Spikes are stored so they can ripple as he runs.
  const maneGeo = new THREE.BoxGeometry(0.14, 0.34, 0.16);
  Player.mane = [];
  for (let i = 0; i < 9; i++) {
    const th = -0.4 + (i / 8) * 2.3;            // arc angle: forehead -> nape
    const hue = (i / 8) * 0.8;                  // red front -> purple back, no wrap
    const dir = new THREE.Vector3(0, Math.cos(th), -Math.sin(th));
    const spike = new THREE.Mesh(maneGeo, new THREE.MeshStandardMaterial({
      color: new THREE.Color().setHSL(hue, 0.95, 0.5), roughness: 0.5,
      emissive: new THREE.Color().setHSL(hue, 0.95, 0.35), emissiveIntensity: 0.45 }));
    spike.position.set(0, 0.13, 0).addScaledVector(dir, 0.37);
    spike.rotation.x = -th - 0.28;              // swept backward
    spike.userData.baseRotX = spike.rotation.x; // sway returns to this
    spike.scale.y = 0.9 + 0.85 * Math.sin(((i + 1) / 10) * Math.PI); // tall crest
    headG.add(spike);
    Player.mane.push(spike);
  }

  // chrome power-washer gun, held two-handed out front. Built as its own group
  // so it can recoil, and positioned so the barrel TIP lands on the primitive
  // muzzle point (local 0,1.5,0.6 = NOZZLE_PRIMITIVE) — water leaves the barrel,
  // not the chest. Player faces local +Z, so the barrel points +Z.
  const chrome = new THREE.MeshStandardMaterial({ color: 0xd7dde6, metalness: 0.85, roughness: 0.22 });
  const gun = Player.gun = new THREE.Group();
  gun.position.set(0, 1.5, 0);
  // pistol grip (rear, angled down so the hand wraps it)
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.28, 0.12), black);
  grip.position.set(0, -0.16, 0.26); grip.rotation.x = 0.5;
  gun.add(grip);
  // pump housing / body — the chunky chrome block
  const gbody = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.2, 0.36), chrome);
  gbody.position.set(0, 0, 0.36);
  gun.add(gbody);
  // trigger guard
  const guard = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.017, 6, 10), steel);
  guard.position.set(0, -0.08, 0.28); guard.rotation.x = Math.PI / 2;
  gun.add(guard);
  // long chrome barrel down the middle, tip at local z≈0.6 (the muzzle)
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.42, 10), chrome);
  barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.01, 0.42);
  gun.add(barrel);
  // blue nozzle collar + emissive tip ring right at the muzzle
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.07, 10),
    new THREE.MeshStandardMaterial({ color: 0x3f8fdf, metalness: 0.5, roughness: 0.3 }));
  collar.rotation.x = Math.PI / 2; collar.position.set(0, 0.01, 0.585);
  gun.add(collar);
  const muzzleRing = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.012, 6, 12),
    new THREE.MeshStandardMaterial({ color: 0x8fe0ff, emissive: 0x4fb8ff, emissiveIntensity: 1.4, roughness: 0.3 }));
  muzzleRing.position.set(0, 0.01, 0.62);
  gun.add(muzzleRing);
  g.add(gun);
  // red high-pressure hose from the grip base looping down to the tool belt
  const hoseCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 1.3, 0.28),
    new THREE.Vector3(0.28, 1.02, 0.06),
    new THREE.Vector3(0.34, 0.82, -0.24),
    new THREE.Vector3(0, 0.86, -0.34),
  ]);
  const hose = new THREE.Mesh(new THREE.TubeGeometry(hoseCurve, 18, 0.045, 6),
    new THREE.MeshStandardMaterial({ color: 0xa32c22, roughness: 0.55 }));
  g.add(hose);

  // the horn — candy-striped rainbow segments, hidden until the pickup
  Player.horn = new THREE.Group();
  const SEGS = 5, HORN_H = 0.9;
  for (let i = 0; i < SEGS; i++) {
    const f = i / SEGS;
    const rBot = 0.095 * (1 - f);
    const rTop = Math.max(0.095 * (1 - (i + 1) / SEGS), 0.012);
    const seg = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, HORN_H / SEGS, 8),
      new THREE.MeshStandardMaterial({
        color: new THREE.Color().setHSL(f * 0.8, 0.9, 0.6),
        emissive: new THREE.Color().setHSL(f * 0.8, 0.9, 0.45),
        emissiveIntensity: 1.3, roughness: 0.25 }));
    seg.position.y = -HORN_H / 2 + (i + 0.5) * (HORN_H / SEGS);
    Player.horn.add(seg);
  }
  // horn + ring live on the head joint so they nod with the aim (their
  // visibility is still managed directly by the pickup/model toggles)
  Player.horn.position.set(0, 0.73, 0.15);
  Player.horn.rotation.x = -0.35;
  Player.horn.visible = false;
  headG.add(Player.horn);
  // gold band at the horn base, per the concept art
  Player.hornRing = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.028, 6, 12),
    new THREE.MeshStandardMaterial({ color: 0xd9a940, metalness: 0.8, roughness: 0.3 }));
  Player.hornRing.position.set(0, 0.44, 0.05);
  Player.hornRing.rotation.x = Math.PI / 2 - 0.35; // perpendicular to the horn axis
  Player.hornRing.visible = false;
  headG.add(Player.hornRing);
  Player.hornGlow = glowSprite(0xffb0ea, 1.1, 0.6);
  Player.hornGlow.position.set(0, 2.7, 0.32);
  Player.hornGlow.visible = false;
  g.add(Player.hornGlow);
  // real light from the horn — paints nearby piles/zombies pink at night... er, in fog
  Player.hornLight = new THREE.PointLight(0xff9ae0, 0, 10);
  Player.hornLight.position.set(0, 2.5, 0.2);
  g.add(Player.hornLight);

  // partition: primitive cosmetics — INCLUDING the primitive nozzle/tip/hose —
  // go into a rig subgroup that hides when the GLB loads, because the GLB Jax
  // carries his own power-washer gun. Only the horn glow/light (gameplay VFX)
  // and the toggle-managed horn/ring stay at group level.
  const keep = new Set([Player.horn, Player.hornRing, Player.hornGlow, Player.hornLight]);
  Player.rig = new THREE.Group();
  for (const child of [...g.children]) if (!keep.has(child)) Player.rig.add(child);
  g.add(Player.rig);

  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  scene.add(g);
}

// horn pickup floating in the crater
let hornPickup;
function buildHornPickup() {
  hornPickup = new THREE.Group();
  hornPickup.position.set(0, 1.3, 6);
  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.22, 1.2, 8),
    new THREE.MeshStandardMaterial({ color: 0xfff0f8, emissive: 0xff9ae0, emissiveIntensity: 2, roughness: 0.2 }));
  hornPickup.add(cone);
  hornPickup.add(glowSprite(0xffb0ea, 4, 0.8));
  scene.add(hornPickup);
}

function updatePlayer(dt, t) {
  // --- look ---
  const [dx, dy] = Input.consumeLook();
  const sens = 0.0023 * (Settings.sens || 1); // mouse, touch-drag and gamepad all funnel through consumeLook
  Player.yaw -= dx * sens;
  Player.pitch = THREE.MathUtils.clamp(Player.pitch - dy * sens, -0.9, 0.7);

  Player.forward.set(Math.sin(Player.yaw), 0, Math.cos(Player.yaw));
  // the sky sphere rides along (xz only) so its gradient stays horizon-true
  // this far down the pier — an origin-pinned sphere reads as a violet dome
  if (skyMesh) { skyMesh.position.x = Player.pos.x; skyMesh.position.z = Player.pos.z; }
  const cp = Math.cos(Player.pitch);
  Player.aim.set(Math.sin(Player.yaw) * cp, Math.sin(Player.pitch), Math.cos(Player.yaw) * cp);

  // --- move ---
  let f = 0, s = 0;
  if (Input.keys.KeyW || Input.keys.ArrowUp) f += 1;
  if (Input.keys.KeyS || Input.keys.ArrowDown) f -= 1;
  if (Input.keys.KeyD || Input.keys.ArrowRight) s += 1;
  if (Input.keys.KeyA || Input.keys.ArrowLeft) s -= 1;
  f += -Input.joy.y; s += Input.joy.x;
  f += -(Input.gpY || 0); s += (Input.gpX || 0);

  const right = _v1.crossVectors(Player.forward, THREE.Object3D.DEFAULT_UP);
  _v2.set(0, 0, 0).addScaledVector(Player.forward, f).addScaledVector(right, s);
  if (_v2.lengthSq() > 1) _v2.normalize();
  const moving = _v2.lengthSq() > 0.001;
  const sprinting = moving && Player.onGround && (Input.keys.ShiftLeft || Input.keys.ShiftRight || Input.gpSprint);
  // BUILD 4 momentum: velocity chases the wish direction with real
  // acceleration (much less of it mid-air), so starts, stops and strafes
  // carry weight instead of teleport-snapping
  _v2.multiplyScalar(CFG.player.speed * RPG.speedMul() * Perks.speedMul() * (sprinting ? 1.45 : 1));
  const accel = (Player.onGround ? 34 : 10) * dt;
  Player.hvel.x += THREE.MathUtils.clamp(_v2.x - Player.hvel.x, -accel, accel);
  Player.hvel.z += THREE.MathUtils.clamp(_v2.z - Player.hvel.z, -accel, accel);
  Player.pos.x += Player.hvel.x * dt;
  Player.pos.z += Player.hvel.z * dt;

  // footsteps
  if (moving && Player.onGround) {
    Player.stepT = (Player.stepT || 0) - dt;
    if (Player.stepT <= 0) {
      Player.stepT = sprinting ? 0.24 : 0.34;
      Player.stepSide = !Player.stepSide;
      SFX.step(Player.stepSide ? 0.12 : -0.12);
    }
  }

  // knockback decay
  Player.pos.addScaledVector(Player.knock, dt);
  Player.knock.multiplyScalar(Math.max(0, 1 - 5 * dt));

  // --- jump / slam / gravity ---
  if (Input.jumpPressed) {
    if (Player.onGround) {
      Player.vel.y = CFG.player.jumpVel * Perks.jumpMul();
      Player.onGround = false;
    } else if (!Player.slamming &&
               Player.pos.y - groundHeightAt(Player.pos.x, Player.pos.z, Player.pos.y) >= CFG.slam.minHeight) {
      // tap it again up high and you commit: the same button, no new control
      // to learn, and the height gate stops a hop from triggering it
      startSlam();
    }
  }
  Input.jumpPressed = false;
  const prevY = Player.pos.y;
  if (Player.slamming) {
    Player.vel.y = -CFG.slam.dive;          // a dive, not a fall — gravity is out of it
    Player.hvel.multiplyScalar(Math.pow(CFG.slam.drag, dt * 12)); // and you can't steer far
    if (Math.random() < dt * 40) spawnGlitter(_v2.copy(Player.pos).setY(Player.pos.y + 0.8), 3, 2);
  } else {
    Player.vel.y -= CFG.player.gravity * dt;
  }
  Player.pos.y += Player.vel.y * dt;
  const groundY = groundHeightAt(Player.pos.x, Player.pos.z, prevY);
  if (Player.pos.y <= groundY) {
    const impact = Player.vel.y;
    Player.pos.y = groundY; Player.vel.y = 0;
    const wasAir = !Player.onGround;
    const slammed = Player.slamming;
    if (slammed) landSlam(groundY);
    Player.onGround = true;
    // a springy awning converts that landing straight back into height —
    // and a slam onto one throws you higher still, so pad → slam → bigger
    // pad is a loop worth finding
    if (groundY === 0 && tryBounce(slammed ? CFG.slam.padBoost : 1)) {
      Player._landSq = 0;
    } else if (wasAir && impact < -3) {
      // touchdown: bank the impact speed as a squash-and-recover on the body
      Player._landSq = Math.min(0.16, -impact * 0.016);
    }
  } else if (Player.pos.y > groundY + 0.05) {
    Player.onGround = false; // walked off an edge
  }

  // stay on the playable deck
  Player.pos.x = THREE.MathUtils.clamp(Player.pos.x, -(CFG.bridge.playHalfW + 0.2), CFG.bridge.playHalfW + 0.2);
  Player.pos.z = THREE.MathUtils.clamp(Player.pos.z, CFG.bridge.playZEnd, 13);

  // body follows the camera yaw with a beat of lag — fast flicks read as
  // the camera leading and the body catching up, not a statue on a turntable
  let bodyD = Player.yaw - Player.group.rotation.y;
  bodyD = Math.atan2(Math.sin(bodyD), Math.cos(bodyD));
  Player.group.rotation.y += bodyD * (1 - Math.pow(0.0005, dt));
  // running bob, or a slow idle-breathing rise when standing still
  const bob = moving && Player.onGround ? Math.abs(Math.sin(t * 9)) * 0.06 : Math.sin(t * 1.6) * 0.02;
  Player.group.position.y = Player.pos.y + bob;

  // landing squash-and-recover: the whole body (rig or GLB, gun included)
  // compresses on touchdown proportional to impact speed, then springs back
  Player._landSq = Math.max(0, (Player._landSq || 0) - dt * 0.9);
  const lsq = Player._landSq;
  Player.group.scale.set(1 + lsq * 0.6, 1 - lsq, 1 + lsq * 0.6);

  // run cycle: legs and arms counter-swing while moving, relax when idle
  const swing = (moving && Player.onGround) ? Math.sin(t * 10) : 0;
  const ease = 1 - Math.pow(0.001, dt);
  Player.legs[0].rotation.x += (swing * 0.55 - Player.legs[0].rotation.x) * ease;
  Player.legs[1].rotation.x += (-swing * 0.55 - Player.legs[1].rotation.x) * ease;
  // arms stay in the two-handed forward hold (reach ≈ -1.2 rad) with only a small
  // sway while running — so the power-washer stays gripped in both hands
  const HOLD = -1.2;
  Player.armsM[0].rotation.x += ((HOLD - swing * 0.08) - Player.armsM[0].rotation.x) * ease;
  Player.armsM[1].rotation.x += ((HOLD + swing * 0.08) - Player.armsM[1].rotation.x) * ease;

  // ankle articulation: boots counter-rotate against the hip swing so the
  // feet stay planted-looking through the stride instead of dragging stiffly
  for (const leg of Player.legs) {
    const boot = leg.children[0];
    if (boot) boot.rotation.x += ((-leg.rotation.x * 0.6) - boot.rotation.x) * ease;
  }

  // the head is a real joint: it nods with aim pitch and rolls slightly into
  // strafes, and the mane ripples back harder the faster he moves
  if (Player.headG) {
    Player.headG.rotation.x += ((-Player.pitch * 0.55) - Player.headG.rotation.x) * ease;
    Player.headG.rotation.z += ((moving ? -s * 0.07 : 0) - Player.headG.rotation.z) * ease;
    const speed = moving ? (sprinting ? 1 : 0.55) : 0;
    for (let i = 0; i < Player.mane.length; i++) {
      const sp = Player.mane[i];
      const wave = Math.sin(t * (6 + speed * 4) + i * 0.7) * (0.04 + speed * 0.1);
      sp.rotation.x = sp.userData.baseRotX - speed * 0.22 + wave; // streams back at a run
    }
  }

  // primitive-rig recoil: kick the gun back + up a touch while firing
  if (Player.gun) {
    Player._gunRecoil = Math.max(0, (Player._gunRecoil || 0) - dt * 5);
    if (Player.firing) Player._gunRecoil = Math.min(0.1, Player._gunRecoil + dt * 3.5);
    const gk = 1 - Math.pow(0.02, dt);
    Player.gun.position.z += ((-Player._gunRecoil) - Player.gun.position.z) * gk;
    Player.gun.rotation.x += ((-Player._gunRecoil * 1.4) - Player.gun.rotation.x) * gk;
  }

  // procedural life for the GLB body (a static mesh, so it needs motion here):
  // a walk sway + lean while moving, gentle idle breathing when still, and a
  // recoil lean while the power-washer is firing — keeps the gun in his hands
  if (Player.glbVisual) {
    const g = Player.glbVisual;
    const walk = (moving && Player.onGround) ? 1 : 0;
    const sway = Math.sin(t * 8) * 0.06 * walk;              // hip roll
    const lean = walk * (sprinting ? 0.11 : 0.05);           // lean harder at a sprint
    const breathe = Math.sin(t * 1.8) * 0.012 * (1 - walk);  // idle chest rise
    Player._recoil = Math.max(0, (Player._recoil || 0) - dt * 4);
    if (Player.firing) Player._recoil = Math.min(0.12, Player._recoil + dt * 3);
    const k = 1 - Math.pow(0.02, dt);
    // bank into camera turns so fast swings read as weight shift, not a swivel
    let dyaw = Player.yaw - (Player._prevYaw ?? Player.yaw);
    if (dyaw > Math.PI) dyaw -= Math.PI * 2; else if (dyaw < -Math.PI) dyaw += Math.PI * 2;
    Player._prevYaw = Player.yaw;
    const bank = THREE.MathUtils.clamp(-dyaw * 2.5, -0.12, 0.12);
    const airTuck = Player.onGround ? 0 : 0.09; // brace slightly while airborne
    g.rotation.z += ((sway + bank) - g.rotation.z) * k;
    g.rotation.x += ((lean + breathe + airTuck - Player._recoil) - g.rotation.x) * k;
  }

  // --- camera: cinematic spring arm (BUILD 5) ---
  // The boom sits behind the head along the aim vector, offset to one shoulder
  // so Jax's body never eclipses the crosshair, pulled in while you're firing,
  // led slightly by your own velocity, and shortened whenever world geometry
  // would come between the lens and the character.
  const C = CFG.cam;
  const headPos = _camHead.copy(Player.pos).setY(Player.pos.y + 1.9);
  _camRightV.crossVectors(Player.aim, THREE.Object3D.DEFAULT_UP).normalize();
  // ease over the shoulder while spraying, ease back out when idle
  Player._aimT += ((Player.firing ? 1 : 0) - Player._aimT) * (1 - Math.pow(0.03, dt));
  const boom = C.dist - Player._aimT * C.aimPull;
  const shoulder = C.shoulder + Player._aimT * C.aimShoulder;
  _camDesired.copy(headPos)
    .addScaledVector(Player.aim, -boom)
    .addScaledVector(_camRightV, shoulder)
    .addScaledVector(Player.hvel, C.lead); // lead the run — the world slides in ahead of you
  _camDesired.y += C.height;

  // boom collision: never let a shop wall, cart or piling sit between lens and Jax
  _camArm.subVectors(_camDesired, headPos);
  const armLen = _camArm.length();
  if (armLen > 1e-4) {
    _camArm.divideScalar(armLen);
    camRay.set(headPos, _camArm);
    camRay.far = armLen;
    const blocked = camRay.intersectObjects(camBlockers, false);
    const allowed = blocked.length ? Math.max(C.minDist, blocked[0].distance - 0.35) : armLen;
    _camDesired.copy(headPos).addScaledVector(_camArm, allowed);
  }
  _camDesired.y = Math.max(_camDesired.y, 0.6); // never dip under the deck

  // asymmetric damping: snap IN fast (so a wall can't clip the lens for a frame)
  // and drift OUT slowly (so leaving cover feels like a crane pull-back)
  const closing = _camDesired.distanceToSquared(headPos) < camera.position.distanceToSquared(headPos);
  camera.position.lerp(_camDesired, 1 - Math.pow(closing ? 0.000000001 : 0.0001, dt));
  _camLook.copy(headPos).addScaledVector(Player.aim, 10);
  camera.lookAt(_camLook);

  // trauma-based shake: intensity is trauma SQUARED, so hits punch and then
  // vanish instead of buzzing, and it rolls the lens (not just jitters it) —
  // the difference between "screen shake" and a camera operator flinching.
  if (Player.shake > 0.002 && !Settings.reduceMotion) {
    Player.shake = Math.max(0, Player.shake - dt * 1.7);
    const tr = Player.shake * Player.shake;
    const st = t * 32;
    // layered sines at irrational-ish ratios ≈ smooth noise, no lib needed
    const n1 = Math.sin(st) * 0.6 + Math.sin(st * 2.37 + 1.7) * 0.4;
    const n2 = Math.sin(st * 1.31 + 4.2) * 0.6 + Math.sin(st * 3.11) * 0.4;
    const n3 = Math.sin(st * 0.87 + 2.4);
    camera.position.x += n1 * tr * 0.55;
    camera.position.y += n2 * tr * 0.4;
    camera.rotation.z += n3 * tr * 0.07; // the roll is what sells the impact
  } else Player.shake = 0;

  // FOV: sprint stretch plus a decaying punch from beams, novas and hits
  Player._fovPunch = Math.max(0, (Player._fovPunch || 0) - dt * 14);
  const targetFov = (sprinting ? C.sprintFov : C.fov) + Player._fovPunch;
  if (Math.abs(camera.fov - targetFov) > 0.05) {
    camera.fov += (targetFov - camera.fov) * (1 - Math.pow(0.005, dt));
    camera.updateProjectionMatrix();
  }

  // keep the sun's shadow window centered on the player
  sun.position.set(Player.pos.x + 21, 43, Player.pos.z + 14);
  sun.target.position.copy(Player.pos);

  // --- horn pickup ---
  if (!Player.hasHorn && hornPickup) {
    hornPickup.rotation.y += dt * 2;
    hornPickup.position.y = 1.3 + Math.sin(t * 2.5) * 0.25;
    if (Player.pos.distanceTo(hornPickup.position) < 2.4) {
      Player.hasHorn = true;
      // GLB Jax has the horn baked in (dormant until now) — the striped
      // overlay horn is only for the primitive rig
      if (!Player.glbVisual || !Settings.models) {
        Player.horn.visible = true;
        Player.hornRing.visible = true;
      }
      Player.hornGlow.visible = true;
      Player.hornLight.intensity = 3;
      scene.remove(hornPickup); hornPickup = null;
      SFX.chime(); SFX.fanfare();
      SFX.setMusicMood('hero'); // the score turns hopeful once Jax awakens
      Tutorial.fire('hornPickup');
      // Prismalox — the voice inside the horn — speaks for the first time
      showToast('🌈 PRISMALOX: “Awaken, janitor. The rainbow chose you.”');
      narrate('Awaken, janitor. The rainbow chose you.', 0.6);
    }
  }
  if (Player.hasHorn) {
    Player.hornGlow.material.opacity = 0.5 + 0.25 * Math.sin(t * 6);
    // relax any ping flash back to the resting glow
    Player.hornLight.intensity += (3 - Player.hornLight.intensity) * (1 - Math.pow(0.05, dt));
  }
}

/* ---------------------------------------------------------------------
   GROUND POUND (BUILD 13)

   The hose was the only offensive verb, so the whole vertical layer —
   twelve containers, six awning pads, the jet boost that BUILD 6 added —
   was traversal you never had a combat reason to use. The slam turns
   height into the resource that powers a second attack.

   Everything scales off the DROP, not a flat number: a hop off a crate is
   a shove, a dive off a stacked roof is a screen-clearing detonation. It
   flattens rather than kills — downed zombies take double from the hose —
   so the loop is get up, come down, then mop up, and the two verbs feed
   each other instead of competing.

   It also detonates: a slam kill is flagged as a burst, so BUILD 12's
   chain reactions fire straight off the impact.
   --------------------------------------------------------------------- */
function startSlam() {
  Player.slamming = true;
  Player.slamFrom = Player.pos.y;
  Player.vel.y = -CFG.slam.dive;
  Player._fovPunch = Math.max(Player._fovPunch, 5);
  SFX.whoosh();
  spawnGlitter(_v1.copy(Player.pos).setY(Player.pos.y + 0.9), 14, 3);
}

const slamRings = [];
function landSlam(groundY) {
  Player.slamming = false;
  const drop = Math.max(0, Player.slamFrom - groundY);
  const C = CFG.slam;
  const radius = Math.min(C.rMax, C.rMin + drop * C.rPerM);
  const damage = Math.min(C.dmgMax, C.dmgMin + drop * C.dmgPerM) * RPG.hoseMul() * Perks.hoseMul();
  const downFor = Math.min(C.downMax, C.downMin + drop * C.downPerM);
  const impact = _v1.copy(Player.pos).setY(groundY + 0.12);

  spawnSlamRing(impact, radius);
  spawnGlitter(_v2.copy(impact).setY(groundY + 0.5), Math.round(40 + drop * 6), 6);
  SFX.slamHit(panFor(impact), Math.min(1, drop / 8));
  Player.shake = Math.max(Player.shake, Math.min(0.85, 0.28 + drop * 0.05));
  Player._fovPunch = Math.max(Player._fovPunch, Math.min(13, 5 + drop * 0.7));
  hitStop = Math.max(hitStop, Math.min(0.26, 0.08 + drop * 0.015));
  Player._landSq = 0.16;

  // snapshot before damaging: clean() can kill entities and splice the arrays
  const caught = [];
  for (const list of [piles, zombies, grimes, barrels, gullSplats]) {
    for (const o of list) {
      if (!o || o.alive === false || o.resolved) continue;
      const d = o.group.position.distanceTo(impact);
      if (d < radius) caught.push({ o, d });
    }
  }
  let flattened = 0;
  for (const { o, d } of caught) {
    if (o.alive === false) continue; // taken out by a chain earlier in this pass
    const falloff = 1 - 0.45 * (d / radius);
    o._burst = true;                 // a slam kill detonates (BUILD 12 chains)
    o.clean(damage * falloff, o.group.position);
    o._burst = false;
    if (o.alive && o.knockdown) { o.knockdown(downFor); flattened++; }
  }
  // the shockwave throws loose props and rocks the parked cars
  for (const b of physBodies) {
    const d = b.g.position.distanceTo(impact);
    if (d > radius) continue;
    _v2.subVectors(b.g.position, impact).setY(0.4).normalize();
    b.vel.addScaledVector(_v2, (10 + drop * 1.6) * (1 - d / radius) / b.mass);
    b.angVel.x += (Math.random() - 0.5) * 7;
    b.angVel.z += (Math.random() - 0.5) * 7;
  }
  for (const c of cars) {
    if (c.mesh.position.distanceTo(impact) < radius + 3) c.rockV += 6;
  }
  for (let i = 0; i < 5; i++) {
    spawnSplash(_v2.set(impact.x + (Math.random() - 0.5) * radius, 0.1,
                        impact.z + (Math.random() - 0.5) * radius), true);
  }
  if (flattened >= 3) {
    spawnFloatText(_v2.copy(impact).setY(groundY + 2.4), 'SLAM x' + flattened, '#ffd94f', { tier: 'headline', pri: 3 + flattened });
    Hype.add(0.1 + 0.05 * flattened);
  } else if (drop > 5) {
    spawnFloatText(_v2.copy(impact).setY(groundY + 2.4), 'SKY SLAM!', '#ffd94f', { tier: 'headline', pri: 4 });
    Hype.add(0.12);
  }
  Hype.add(0.06 + drop * 0.012);
  Tutorial.fire('firstSlam');
  Game.slams++;
  Game.bestSlam = Math.max(Game.bestSlam, Math.round(drop));
}

const SLAM_GEO = new THREE.RingGeometry(0.8, 1, 40);
function spawnSlamRing(pos, radius) {
  if (Settings.reduceMotion) return;
  const m = new THREE.Mesh(SLAM_GEO, new THREE.MeshBasicMaterial({ color: 0xffd94f,
    transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false,
    blending: THREE.AdditiveBlending }));
  m.rotation.x = -Math.PI / 2;
  m.position.copy(pos);
  scene.add(m);
  slamRings.push({ m, t: 0, radius });
  if (slamRings.length > 4) { const o = slamRings.shift(); scene.remove(o.m); o.m.material.dispose(); }
}
function updateSlamRings(dt) {
  for (let i = slamRings.length - 1; i >= 0; i--) {
    const r = slamRings[i];
    r.t += dt;
    const f = Math.min(1, r.t / 0.45);
    const s = 0.5 + r.radius * (1 - Math.pow(1 - f, 3)); // fast out, easing to the rim
    r.m.scale.set(s, s, s);
    r.m.material.opacity = 0.8 * (1 - f);
    if (f >= 1) { scene.remove(r.m); r.m.material.dispose(); slamRings.splice(i, 1); }
  }
}

// the airborne prompt: the slam is only discoverable if the game says so once
const slamHintEl = document.getElementById('slamHint');
function updateSlamHint() {
  if (!slamHintEl) return;
  const armed = Game.state === 'playing' && !Player.onGround && !Player.slamming &&
    Player.pos.y - groundHeightAt(Player.pos.x, Player.pos.z, Player.pos.y) >= CFG.slam.minHeight;
  slamHintEl.classList.toggle('on', armed);
}

function damagePlayer(amount, fromDir) {
  if (Game.state !== 'playing') return;
  Player.hp -= amount * DIFF.dmg();
  Player._fovPunch = Math.max(Player._fovPunch, 4);
  showDamageFrom(fromDir);
  Player.knock.copy(fromDir).setY(0).normalize().multiplyScalar(7);
  Game.dmgFlash = 1;
  Player.shake = 0.45;
  SFX.hurt();
  try { // gamepad rumble on hit
    const gp = navigator.getGamepads && navigator.getGamepads()[0];
    if (gp && gp.vibrationActuator) gp.vibrationActuator.playEffect('dual-rumble',
      { duration: 160, strongMagnitude: 0.8, weakMagnitude: 0.4 });
  } catch (e) {}
  hpFill.style.width = Math.max(0, Player.hp) + '%';
  hpFill.style.background = Player.hp < 35 ? 'linear-gradient(90deg,#ff4f6e,#ff9e4f)' : 'linear-gradient(90deg,#4fff9e,#b8ff4f)';
  if (Player.hp <= 0) gameOver();
}

/* =====================================================================
   11. HOSE + MAGIC BEAM — spray particles, raycast cleaning
   ===================================================================== */
// pooled water-impact splashes: a sprite that pops open and fades wherever
// the spray lands — sells the "high-pressure" fantasy
const splashPool = [];
let splashIdx = 0;
function buildSplashes() {
  for (let i = 0; i < 14; i++) {
    const s = glowSprite(0xbfe8ff, 0.1, 0);
    s.userData.life = 0;
    splashPool.push(s); scene.add(s);
  }
}
function spawnSplash(point, big = false) {
  const s = splashPool[splashIdx = (splashIdx + 1) % splashPool.length];
  s.position.copy(point);
  s.userData.life = big ? 0.35 : 0.22;
  s.userData.big = big;
  s.scale.setScalar(big ? 0.8 : 0.35);
}
function updateSplashes(dt) {
  for (const s of splashPool) {
    if (s.userData.life <= 0) { s.material.opacity = 0; continue; }
    s.userData.life -= dt;
    s.scale.addScalar((s.userData.big ? 7 : 4.5) * dt);
    s.material.opacity = Math.max(0, s.userData.life * (s.userData.big ? 2.2 : 3.2));
  }
}

/* ---------------------------------------------------------------------
   CONTACT SHADOWS (BUILD 11) — the sun shadow map only covers 28m and
   misses everything in the fog, so characters and filth read as floating
   stickers on the planks. A soft dark ellipse under each one plants them.
   One InstancedMesh, one draw call, rewritten each frame for whatever is
   near. Jax's own shadow doubles as a landing indicator now that the pier
   has rooftops — it stays on the ground he'll actually come down on.
   --------------------------------------------------------------------- */
const CONTACT_N = 56;
let contactMesh = null;
const _mShadow = new THREE.Matrix4();
function buildContactShadows() {
  const geo = new THREE.PlaneGeometry(1, 1);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({
    map: GLOW_TEX, color: 0x000000, transparent: true, opacity: 0.42,
    depthWrite: false, blending: THREE.NormalBlending });
  contactMesh = new THREE.InstancedMesh(geo, mat, CONTACT_N);
  contactMesh.frustumCulled = false;   // instances are rewritten every frame
  contactMesh.renderOrder = -1;        // under the glitter and splashes
  scene.add(contactMesh);
}
function updateContactShadows() {
  if (!contactMesh) return;
  let i = 0;
  const put = (x, y, z, r, alpha) => {
    if (i >= CONTACT_N) return;
    const s = r * 2 * alpha;
    _mShadow.makeScale(s, 1, s);
    _mShadow.setPosition(x, y + 0.035, z);
    contactMesh.setMatrixAt(i++, _mShadow);
  };
  // Jax: fades and spreads with altitude, so it reads as "you land here"
  const pg = groundHeightAt(Player.pos.x, Player.pos.z, Player.pos.y);
  const air = THREE.MathUtils.clamp((Player.pos.y - pg) / 7, 0, 1);
  put(Player.pos.x, pg, Player.pos.z, 0.75 + air * 0.5, 1 - air * 0.55);
  for (const z of zombies) {
    if (!z.alive || !z.group.visible) continue;
    put(z.group.position.x, 0, z.group.position.z, 0.85 * z.sclX, 1);
  }
  for (const p of piles) {
    if (!p.alive || !p.group.visible) continue;
    put(p.group.position.x, 0, p.group.position.z, 1.15 * p.size * p.baseScale, 1);
  }
  for (const c of civilians) {
    if (c.resolved) continue;
    put(c.group.position.x, 0, c.group.position.z, 1.1, 1);
  }
  for (const b of barrels) {
    if (b.resolved) continue;
    put(b.group.position.x, 0, b.group.position.z, 0.5, 1);
  }
  while (i < CONTACT_N) { _mShadow.makeScale(0, 0, 0); contactMesh.setMatrixAt(i++, _mShadow); }
  contactMesh.instanceMatrix.needsUpdate = true;
}

const raycaster = new THREE.Raycaster();
// BUILD 5 camera rig scratch (kept separate from _v1/_v2, which updatePlayer reuses)
const _camHead = new THREE.Vector3(), _camDesired = new THREE.Vector3(),
      _camArm = new THREE.Vector3(), _camLook = new THREE.Vector3(),
      _camRightV = new THREE.Vector3();
const camRay = new THREE.Raycaster();
const HoseFX = { N: 900, idx: 0, pos: null, vel: [], life: [], points: null, muzzle: null };

function buildHose() {
  HoseFX.pos = new Float32Array(HoseFX.N * 3).fill(-1000);
  for (let i = 0; i < HoseFX.N; i++) { HoseFX.vel.push(new THREE.Vector3()); HoseFX.life.push(0); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(HoseFX.pos, 3));
  HoseFX.points = new THREE.Points(geo, new THREE.PointsMaterial({
    map: GLOW_TEX, color: 0xbfe8ff, size: 0.24, transparent: true, opacity: 0.9,
    blending: THREE.AdditiveBlending, depthWrite: false }));
  HoseFX.points.frustumCulled = false;
  scene.add(HoseFX.points);
  // muzzle burst: a bright puff at the barrel tip that pulses while firing
  HoseFX.muzzle = glowSprite(0xdff4ff, 0.7, 0);
  HoseFX.muzzle.frustumCulled = false;
  scene.add(HoseFX.muzzle);
  // a cool point-light that rides the jet while firing, so the high-pressure
  // water actually casts light into the fog — pure atmosphere, no balance change
  HoseFX.light = new THREE.PointLight(0x9fe4ff, 0, 9);
  scene.add(HoseFX.light);
}

// where the water leaves the weapon. The GLB Jax holds a long power-washer
// gun out front, so the muzzle sits further forward and toward his gun hand;
// the primitive rig's little nozzle stays close. applyModelSetting() flips it.
const _nozRight = new THREE.Vector3();
function nozzleWorldPos(out) {
  const n = Player.nozzle;
  // on the gun, add the player's live muzzle nudge ([ ] and ; ') so the jet
  // can be dialled exactly onto the barrel tip and the fix persists
  const adj = (n === NOZZLE_GUN) ? Settings.nozzleAdj : null;
  const up = n.up + (adj ? adj.up : 0);
  const fwd = n.fwd + (adj ? adj.fwd : 0);
  out.copy(Player.pos).add(_nozRight.set(0, up, 0)).addScaledVector(Player.forward, fwd);
  _nozRight.crossVectors(Player.forward, THREE.Object3D.DEFAULT_UP).normalize();
  return out.addScaledVector(_nozRight, n.right);
}

let sprayAccum = 0, sprayWasOn = false, sprayHeldTime = 0, hitPulse = 0;
const crosshairEl = document.getElementById('crosshair');
let targetSenseT = 0, crosshairOnTarget = false, crosshairOnCore = false; // BUILD 3 aim confirmation, BUILD 12 crit sense
const pressureFill = document.getElementById('pressureFill');
const rainbowFill = document.getElementById('rainbowFill');
function updateHose(dt) {
  const wantSpray = (Input.spray || Input.gpSpray) && Player.hasHorn && Game.state === 'playing';
  // pressure meter: drains while spraying, refills on release; running it
  // dry locks the trigger briefly — teaches the ease-off rhythm
  if (pressureLocked && Meters.pressure > 25) pressureLocked = false;
  const spraying = wantSpray && !pressureLocked && Meters.pressure > 0;
  if (spraying) {
    Meters.pressure = Math.max(0, Meters.pressure - PRESSURE_DRAIN * Nozzle().drain * Perks.drainMul() * (1 - 0.08 * RPG.ranks.power) * dt);
    if (Perks.leech() && Player.hp < 100) { // suds therapy ticks while you work
      Player.hp = Math.min(100, Player.hp + Perks.leech() * dt);
      hpFill.style.width = Player.hp + '%';
    }
    if (Meters.pressure <= 0) { pressureLocked = true; Tutorial.fire('pressureEmpty'); }
  } else {
    Meters.pressure = Math.min(100, Meters.pressure + PRESSURE_REGEN * Perks.regenMul() * dt);
  }
  pressureFill.style.width = Meters.pressure + '%';
  rainbowFill.style.width = Meters.rainbow + '%';
  if (spraying !== sprayWasOn) { SFX.setSpray(spraying); sprayWasOn = spraying; }
  Player.firing = spraying; // drives the GLB recoil lean

  if (spraying) {
    sprayHeldTime += dt;
    if (sprayHeldTime > 0.4) Tutorial.fire('firstSpray');

    // spawn spray particles from the muzzle along the aim — a tight, fast,
    // dense cone that reads as a high-pressure jet
    const nozzle = nozzleWorldPos(_v1);
    HoseFX.muzzle.position.copy(nozzle);
    HoseFX.muzzle.material.opacity = 0.5 + 0.4 * Math.random(); // flicker at the barrel
    HoseFX.muzzle.scale.setScalar(0.6 + 0.25 * Math.random());
    sprayAccum += CFG.hose.spawnRate * Nozzle().rate * dt;
    while (sprayAccum >= 1) {
      sprayAccum -= 1;
      const i = HoseFX.idx = (HoseFX.idx + 1) % HoseFX.N;
      // start just ahead of the muzzle so the stream reads as continuous
      HoseFX.pos[i * 3] = nozzle.x + Player.aim.x * 0.2;
      HoseFX.pos[i * 3 + 1] = nozzle.y + Player.aim.y * 0.2;
      HoseFX.pos[i * 3 + 2] = nozzle.z + Player.aim.z * 0.2;
      const spread = Nozzle().spread; // tight for JET/LANCE, blooming for BLAST
      HoseFX.vel[i].copy(Player.aim).multiplyScalar(Nozzle().speed)
        .add(_v2.set((Math.random() - 0.5) * spread, (Math.random() - 0.4) * spread, (Math.random() - 0.5) * spread));
      HoseFX.life[i] = 0.6;
    }

    // JET BOOST (BUILD 6): a power-washer this size has recoil. Hose
    // downward while airborne and you ride it — hover, cross a gap, or
    // stay above a lunging zombie. It burns pressure fast, so it's a
    // move you commit to, not a second pair of legs.
    if (!Player.onGround && Player.aim.y < -0.25 && Meters.pressure > 0) {
      const thrust = CFG.hose.boost * (-Player.aim.y) * dt;
      Player.vel.y = Math.min(Player.vel.y + thrust, CFG.hose.boostMax);
      Player.hvel.x -= Player.aim.x * thrust * 0.45; // shoved along the recoil too
      Player.hvel.z -= Player.aim.z * thrust * 0.45;
      Meters.pressure = Math.max(0, Meters.pressure - CFG.hose.boostDrain * dt);
      Player._boosting = 0.12;
      if (Math.random() < dt * 22) spawnSplash(_v2.copy(Player.pos).setY(0.12), true);
    }
    Player._boosting = Math.max(0, (Player._boosting || 0) - dt);

    // the actual cleaning: ray from the camera through the crosshair
    const NZ = Nozzle();
    const power = CFG.hose.dps * NZ.dps * RPG.hoseMul() * Hype.dmgMul() * Perks.hoseMul();
    raycaster.set(camera.position, Player.aim);
    raycaster.far = NZ.range + 6; // camera sits ~5.4 behind the player
    const hits = raycaster.intersectObjects(cleanTargets, false);
    HoseFX.lastHits = hits.length; HoseFX.lastMode = NZ.key; // debug readout
    HoseFX.lastEntity = hits.length ? ((hits[0].object.userData.entity || {}).constructor || {}).name || 'none' : null;
    HoseFX.lastHitDist = hits.length ? +hits[0].distance.toFixed(1) : -1;
    HoseFX.lastCore = hits.length ? !!hits[0].object.userData.core : false;
    // ride the jet light out to whatever the water is hitting (or ~3m ahead)
    HoseFX.light.position.copy(hits.length ? hits[0].point : _v2.copy(nozzle).addScaledVector(Player.aim, 3));
    HoseFX.light.intensity = 1.7 + (Settings.reduceMotion ? 0 : Math.random() * 0.5);

    if (NZ.key === 'blast') {
      // BLAST: a short wide cone. Everything inside it gets scrubbed and
      // shoved — weak per target, devastating against a pack.
      let any = false;
      for (const list of [piles, zombies, civilians, grimes, barrels, gullSplats]) {
        for (const tgt of list) {
          if (!tgt || tgt.resolved || tgt.alive === false || tgt.falling) continue;
          // from the chest, not the barrel: the muzzle's forward/right offset
          // skews the cone enough to drop one flank of a pack
          _v2.subVectors(tgt.group.position, Player.pos);
          _v2.y += (tgt.aimY ?? 0.9) - 1.2;
          const d = _v2.length();
          const blastRange = NZ.range * Perks.blastMul();
          if (d > blastRange || d < 0.01) continue;
          if (_v2.dot(Player.aim) / d < BLAST_COS / Perks.blastMul()) continue;
          const falloff = 1 - 0.5 * (d / blastRange);
          tgt.clean(power * falloff * dt, tgt.group.position);
          if (tgt.push) { tgt.push(dt * 1.35); if (tgt.stun && Math.random() < dt * 1.6) tgt.stun(0.35); }
          any = true;
          if (Math.random() < dt * 7) spawnSplash(tgt.group.position.clone().setY(0.9));
        }
      }
      if (boss && boss.alive) { // the beast is one big target, not in those lists
        for (const tn of boss.tentacles) {
          _v2.subVectors(tn.tip, nozzle); const d = _v2.length();
          if (d < NZ.range && d > 0.01 && _v2.dot(Player.aim) / d >= BLAST_COS) { tn.clean(power * dt, tn.tip); any = true; }
        }
      }
      if (any) { Meters.rainbow = Math.min(100, Meters.rainbow + RAINBOW_FILL * dt); hitPulse = 1; }
    } else if (NZ.key === 'lance') {
      // LANCE: pierces. Every distinct entity along the ray takes the hit,
      // so lining targets up is the skill.
      // one hit per entity, but a core anywhere along the ray wins over a
      // body hit on the same target — the skewer should reward threading
      // the cores, not whichever mesh happened to be nearest
      const seen = new Map();
      for (const h of hits) {
        const e = h.object.userData.entity;
        if (!e || e.alive === false || e.resolved) continue;
        const core = !!h.object.userData.core;
        const prev = seen.get(e);
        if (!prev) seen.set(e, { point: h.point, core });
        else if (core && !prev.core) { prev.point = h.point; prev.core = true; }
      }
      for (const [e, h] of seen) {
        if (h.core) applyCrit(e, power * dt, h.point, dt);
        else e.clean(power * dt, h.point);
        if (Math.random() < dt * 10) spawnSplash(h.point);
      }
      if (seen.size) {
        Meters.rainbow = Math.min(100, Meters.rainbow + RAINBOW_FILL * dt);
        hitPulse = 1;
        if (Math.random() < dt * 6) SFX.splat(panFor(hits[0].point), 0.35);
      }
    } else if (hits.length) {
      // skip anything that can't take damage — a corpse still in cleanTargets
      // or a sea lion you already saved would otherwise swallow the whole jet
      let e = null, point = null, onCore = false;
      for (const h of hits) {
        const c = h.object.userData.entity;
        if (!c || c.alive === false || c.resolved) continue;
        e = c; point = h.point; onCore = !!h.object.userData.core; break;
      }
      if (e) {
        if (onCore) applyCrit(e, power * dt, point, dt);
        else e.clean(power * dt, point);
        if (e.push) e.push(dt); // high-pressure water shoves zombies back
        Meters.rainbow = Math.min(100, Meters.rainbow + RAINBOW_FILL * dt); // cleaning charges the beam
        hitPulse = 1; // crosshair feedback: you're scrubbing something
        if (Math.random() < dt * 14) spawnSplash(point);
        if (Math.random() < dt * 6) SFX.splat(panFor(point), 0.35);
      }
    }
    // SOFT AIM ASSIST (BUILD 3): when the ray misses everything, the single
    // nearest target hugging the jet axis (≤ ~0.7m off) still gets scrubbed
    // at 35% power — near-misses feel wet, not dead. Much tighter and weaker
    // than the earned wide-nozzle fan below, which stays the real prize.
    let assisted = null;
    if (!hits.length && NZ.key === 'jet') {
      let bestOff = CFG.hose.assistOff2;
      for (const list of [piles, zombies, civilians, grimes, barrels, gullSplats]) {
        for (const tgt of list) {
          if (!tgt || tgt.resolved || tgt.alive === false || tgt.falling) continue;
          const gp = tgt.group.position;
          _v2.subVectors(gp, camera.position);
          _v2.y += tgt.aimY ?? 0.9; // flat targets (grime, splats) aim at deck level
          const along = _v2.dot(Player.aim);
          if (along < 1 || along > NZ.range + 4) continue;
          const off2 = _v2.lengthSq() - along * along;
          if (off2 < bestOff) { bestOff = off2; assisted = tgt; }
        }
      }
      if (assisted) {
        assisted.clean(CFG.hose.dps * RPG.hoseMul() * CFG.hose.assistPower * dt, assisted.group.position);
        Meters.rainbow = Math.min(100, Meters.rainbow + RAINBOW_FILL * 0.5 * dt);
        hitPulse = Math.max(hitPulse, 0.6);
        if (Math.random() < dt * 8) spawnSplash(assisted.group.position.clone().setY(0.9));
      }
    }
    // WIDE SPRAY NOZZLE (this level's reward, active once earned): the fan of
    // water also scrubs anything close to the jet axis at 55% power — near
    // misses still clean, and grouped piles melt together.
    if (WIDE_NOZZLE && NZ.key === 'jet') {
      const seen = hits.length ? hits[0].object.userData.entity : null;
      for (const list of [piles, zombies, civilians, grimes, barrels, gullSplats]) {
        for (const tgt of list) {
          if (!tgt || tgt === seen || tgt === assisted || tgt.resolved || tgt.alive === false || tgt.falling) continue;
          const gp = tgt.group.position;
          _v2.subVectors(gp, camera.position);
          _v2.y += tgt.aimY ?? 0.9; // aim at the target's body, not its feet
          const along = _v2.dot(Player.aim);
          if (along < 1 || along > NZ.range + 4) continue;
          if (_v2.lengthSq() - along * along > 3.2) continue; // ~1.8m off-axis fan
          tgt.clean(CFG.hose.dps * RPG.hoseMul() * Hype.dmgMul() * 0.55 * dt, gp);
          if (Math.random() < dt * 6) spawnSplash(gp.clone().setY(0.8));
        }
      }
    }
    if (!hits.length && Player.aim.y < -0.05) {
      // no target: the water hits the planks — splash, and leave them slick
      // (wet patches are the zombie slip-trap, see the wharf-toys section)
      const tGround = (camera.position.y - 0.05) / -Player.aim.y;
      if (tGround < NZ.range + 6) {
        _v2.copy(camera.position).addScaledVector(Player.aim, tGround);
        if (Math.random() < dt * 10) spawnSplash(_v2);
        if (Math.random() < dt * 5) spawnWetPatch(_v2);
      }
    }

    // the jet is a real force: any physics prop in the stream gets blasted
    for (const b of physBodies) {
      _v2.subVectors(b.g.position, nozzle);
      _v2.y += b.aimY; // offset to the prop's middle (0 for center-origin bodies)
      const along = _v2.dot(Player.aim);
      if (along < 0.5 || along > NZ.range) continue;
      const off2 = _v2.lengthSq() - along * along; // squared distance off the jet axis
      if (off2 > 0.55) continue;
      const kick = 30 * (1 - along / NZ.range) * dt / b.mass;
      b.vel.addScaledVector(Player.aim, kick);
      b.vel.y += kick * 0.45; // pressure lifts as it shoves
      b.angVel.x += (Math.random() - 0.5) * kick * 6;
      b.angVel.z += (Math.random() - 0.5) * kick * 6;
      if (Math.random() < dt * 10) spawnSplash(b.g.position);
    }
    // too heavy to launch, but the jet rocks the abandoned cars on their springs
    for (const c of cars) {
      _v2.subVectors(c.mesh.position, nozzle);
      const along = _v2.dot(Player.aim);
      if (along < 0.5 || along > NZ.range) continue;
      if (_v2.lengthSq() - along * along > 2.6) continue;
      c.rockV += 4.5 * dt * Math.sign(Math.random() - 0.3);
      if (Math.random() < dt * 8) spawnSplash(c.mesh.position.clone().setY(1));
    }
  } else if (HoseFX.muzzle) {
    HoseFX.muzzle.material.opacity = 0; // no jet, no muzzle glow
    HoseFX.light.intensity = 0;
  }

  // TARGET SENSE (BUILD 3): the crosshair warms up gold whenever the jet
  // WOULD land on something cleanable — aim confirmation before you spend
  // pressure. Cheap: one raycast at ~12Hz, not per frame.
  // BUILD 12 adds a second state: sitting on a weak point snaps it cyan and
  // wide, so you know a crit is there before you commit the trigger.
  targetSenseT -= dt;
  if (targetSenseT <= 0) {
    targetSenseT = 0.08;
    raycaster.set(camera.position, Player.aim);
    raycaster.far = CFG.hose.range + 6;
    const ts = Game.state === 'playing' ? raycaster.intersectObjects(cleanTargets, false) : [];
    let on = false, core = false;
    for (const h of ts) {
      const e = h.object.userData.entity;
      if (!e || e.alive === false || e.resolved) continue;
      on = true; core = !!h.object.userData.core; break;
    }
    if (on !== crosshairOnTarget || core !== crosshairOnCore) {
      crosshairOnTarget = on; crosshairOnCore = core;
      crosshairEl.classList.toggle('onTarget', on && !core);
      crosshairEl.classList.toggle('onCore', core);
    }
  }

  // advance all particles
  const p = HoseFX.points.geometry.attributes.position;
  for (let i = 0; i < HoseFX.N; i++) {
    if (HoseFX.life[i] <= 0) continue;
    HoseFX.life[i] -= dt;
    if (HoseFX.life[i] <= 0) { p.setY(i, -1000); continue; }
    HoseFX.vel[i].y -= 10 * dt;
    p.setXYZ(i, p.getX(i) + HoseFX.vel[i].x * dt, p.getY(i) + HoseFX.vel[i].y * dt, p.getZ(i) + HoseFX.vel[i].z * dt);
  }
  p.needsUpdate = true;
}

// ---- magic beam ----
let beamCooldown = 0;
const activeBeams = [];
function updateBeam(dt) {
  const beamMaxCd = CFG.beam.cooldown * RPG.beamCdMul();
  beamCooldown = Math.max(0, beamCooldown - dt);
  // the under-crosshair bar now shows beam readiness = rainbow charge
  beamCdFill.style.width = Math.min(Meters.rainbow / BEAM_COST, 1) * 100 + '%';

  if (Input.beamPressed) {
    Input.beamPressed = false;
    if (Player.hasHorn && beamCooldown <= 0 && Meters.rainbow >= BEAM_COST * Perks.beamCostMul() && Game.state === 'playing') {
      Meters.rainbow -= BEAM_COST * Perks.beamCostMul();
      beamCooldown = beamMaxCd;
      Player._fovPunch = Math.max(Player._fovPunch, 6);
      SFX.beam();
      Tutorial.fire('firstBeam');

      raycaster.set(camera.position, Player.aim);
      raycaster.far = CFG.beam.range + 6;
      const hits = raycaster.intersectObjects(cleanTargets, false);
      const nozzle = nozzleWorldPos(_v1.clone());
      let end;
      Player.shake = Math.max(Player.shake, 0.22);
      let bh = null;
      for (const h of hits) { // same rule as the hose: shoot past the undamageable
        const c = h.object.userData.entity;
        if (!c || c.alive === false || c.resolved) continue;
        bh = h; break;
      }
      if (bh) {
        end = bh.point.clone();
        const ent = bh.object.userData.entity;
        ent.clean(CFG.beam.damage * RPG.beamMul(), bh.point);
        if (ent.stun) ent.stun(2.5); // the beam blasts AND stuns
        spawnGlitter(bh.point, 30, 4);
        spawnSplash(bh.point, true);
        SFX.splat(panFor(bh.point), 0.7);
      } else {
        // BEAM GRAZE (BUILD 3): the big cooldown shot shouldn't whiff on a
        // hair miss — bend the blast into the nearest target within ~1m of
        // the beam line (the drawn beam visibly kinks to it, honest feedback)
        let graze = null, bestOff = CFG.beam.grazeOff2;
        for (const list of [piles, zombies, civilians]) {
          for (const tgt of list) {
            if (!tgt || tgt.resolved || tgt.alive === false) continue;
            _v2.subVectors(tgt.group.position, camera.position);
            _v2.y += tgt.aimY ?? 0.9;
            const along = _v2.dot(Player.aim);
            if (along < 1 || along > CFG.beam.range) continue;
            const off2 = _v2.lengthSq() - along * along;
            if (off2 < bestOff) { bestOff = off2; graze = tgt; }
          }
        }
        if (graze) {
          const gp = graze.group.position.clone(); gp.y += 1;
          end = gp;
          graze.clean(CFG.beam.damage * RPG.beamMul(), gp);
          if (graze.stun) graze.stun(2.5);
          spawnGlitter(gp, 30, 4);
          spawnSplash(gp, true);
          SFX.splat(panFor(gp), 0.7);
        } else {
          end = nozzle.clone().addScaledVector(Player.aim, CFG.beam.range);
        }
      }

      // beam visual: two nested additive cylinders from horn to target
      const dir = end.clone().sub(nozzle);
      const len = dir.length();
      const grp = new THREE.Group();
      for (const [r, col, op] of [[0.09, 0xffffff, 0.95], [0.22, 0xc06fff, 0.5]]) {
        const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 8, 1, true),
          new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: op,
            blending: THREE.AdditiveBlending, depthWrite: false }));
        m.position.y = len / 2;
        grp.add(m);
      }
      grp.position.copy(nozzle);
      grp.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
      scene.add(grp);
      activeBeams.push({ grp, life: 0.16 });
    }
  }

  for (let i = activeBeams.length - 1; i >= 0; i--) {
    const b = activeBeams[i];
    b.life -= dt;
    b.grp.children.forEach(m => m.material.opacity *= 0.82);
    if (b.life <= 0) {
      b.grp.children.forEach(m => { m.geometry.dispose(); m.material.dispose(); });
      scene.remove(b.grp);
      activeBeams.splice(i, 1);
    }
  }
}

/* =====================================================================
   12. POSITIONAL AUDIO HELPERS — pan by camera-relative direction
   ===================================================================== */
const _camRight = new THREE.Vector3();
function panFor(worldPos) {
  _camRight.setFromMatrixColumn(camera.matrixWorld, 0); // camera local +x
  _v2.subVectors(worldPos, camera.position).normalize();
  return THREE.MathUtils.clamp(_v2.dot(_camRight), -1, 1);
}

// ambient poop-bubble cues: every couple of seconds, the nearest dirty
// pile blorps at you through the fog
let bubbleT = 2;
function updateAudioCues(dt) {
  bubbleT -= dt;
  if (bubbleT > 0) return;
  bubbleT = 2.2 + Math.random() * 1.5;
  let best = null, bestD = 40;
  for (const p of piles) {
    if (!p.alive) continue;
    const d = p.group.position.distanceTo(Player.pos);
    if (d < bestD) { bestD = d; best = p; }
  }
  if (best) {
    SFX.bubble(panFor(best.group.position), Math.max(0.12, 1 - bestD / 40) * 0.7);
    // the blorp has a visual: a little burp of sparkles from the pile
    spawnGlitter(_v1.copy(best.group.position).add(new THREE.Vector3(0, 1.2, 0)), 7, 1.6);
  }
}

/* =====================================================================
   12.5 RPG PROGRESSION — XP from every clean, level-ups grant talent
   points the player allocates: speed, hose power, beam, or the Rainbow
   Nova superpower. Modifiers are multiplied into the base CFG values.
   ===================================================================== */
const RPG = {
  xp: 0, level: 1, points: 0, kills: 0,
  ranks: { speed: 0, power: 0, beam: 0, nova: 0 },
  thresholds: [120, 300, 550, 850, 1250], // cumulative XP per level-up — raised vs level 1 because the wharf-toys bonus XP (grime, splats, barrels) would otherwise cap the tree; scarcity is the point
  speedMul() { return 1 + 0.12 * this.ranks.speed; },
  hoseMul() { return 1 + 0.25 * this.ranks.power; },
  beamMul() { return 1 + 0.25 * this.ranks.beam; },
  beamCdMul() { return 1 - 0.2 * this.ranks.beam; },
};

const SKILLS = [
  { key: 'speed', name: 'Swift Hooves', icon: '👟', desc: '+12% run speed per rank', max: 3 },
  { key: 'power', name: 'Power Pressure', icon: '💦', desc: '+25% hose cleaning power per rank', max: 3 },
  { key: 'beam', name: 'Beam Mastery', icon: '🌈', desc: '+25% beam damage and −20% cooldown per rank', max: 3 },
  { key: 'nova', name: 'Rainbow Nova', icon: '⭐', desc: 'Unlock a purifying blast around Jax (F / NOVA). Ranks widen it and cut its cooldown', max: 3 },
];

const xpFill = document.getElementById('xpFill');
const lvBadge = document.getElementById('lvBadge');
const skillBtn = document.getElementById('skillBtn');
const toastEl = document.getElementById('toastMsg');
let toastT = 0;
function showToast(text) {
  toastEl.textContent = text;
  toastEl.style.opacity = 1;
  toastT = 3.4;
}

// XP awarded while the '+N XP' popup is still on screen accumulates into it
// rather than printing a fresh number over the top of the last one
let xpRun = 0, xpRunT = 0;
function gainXP(amount, worldPos) {
  RPG.xp += amount;
  if (worldPos) {
    if (xpRunT <= 0) xpRun = 0;
    xpRun += amount; xpRunT = 1.15;
    spawnGlitter(_v1.copy(worldPos).add(new THREE.Vector3(0, 1, 0)), 16, 3);
    spawnFloatText(worldPos.clone().add(new THREE.Vector3(0, 1.9, 0)), '+' + xpRun + ' XP', '#ffd94f', { tier: 'ticker', key: 'xp' });
  }
  let gained = 0;
  while (RPG.level - 1 < RPG.thresholds.length && RPG.xp >= RPG.thresholds[RPG.level - 1]) {
    RPG.level++; RPG.points++; gained++;
  }
  if (gained > 0) { // single feedback burst even for multi-level jumps
    SFX.fanfare();
    Player.shake = Math.max(Player.shake, 0.2);
    spawnGlitter(Player.pos.clone().add(new THREE.Vector3(0, 1.5, 0)), 80, 6);
    showToast('⭐ LEVEL UP! Skill point earned' + (IS_TOUCH ? ' — tap TALENTS' : ' — press T'));
    narrate('Level up! You earned a talent point.');
  }
  updateRPGHUD();
}

function updateRPGHUD() {
  const li = RPG.level - 1;
  if (li >= RPG.thresholds.length) {
    xpFill.style.width = '100%';
  } else {
    const prev = li > 0 ? RPG.thresholds[li - 1] : 0;
    xpFill.style.width = THREE.MathUtils.clamp((RPG.xp - prev) / (RPG.thresholds[li] - prev) * 100, 0, 100) + '%';
  }
  lvBadge.textContent = 'LV ' + RPG.level;
  const spent = Object.values(RPG.ranks).some(r => r > 0);
  skillBtn.style.display = (RPG.points > 0 || spent) ? 'block' : 'none';
  skillBtn.textContent = `⭐ TALENTS${RPG.points > 0 ? ' (' + RPG.points + ')' : ''}${IS_TOUCH ? '' : ' — T'}`;
  skillBtn.classList.toggle('avail', RPG.points > 0);
  if (RPG.ranks.nova > 0) {
    document.getElementById('novaCd').classList.remove('hidden');
    if (IS_TOUCH) document.getElementById('btnNova').style.display = 'flex';
  }
}

// ---- talents panel (tactical pause) ----
function buildSkillPanel() {
  const grid = document.getElementById('skillGrid');
  grid.innerHTML = SKILLS.map(s => `
    <div class="skillCard" data-skill="${s.key}">
      <div class="ico">${s.icon}</div>
      <div style="flex:1;">
        <h3>${s.name}</h3><p>${s.desc}</p>
        <div class="pips">${'<span class="pip"></span>'.repeat(s.max)}</div>
      </div>
      <button class="plusBtn">+</button>
    </div>`).join('');
  grid.querySelectorAll('.skillCard').forEach(card => {
    card.querySelector('.plusBtn').addEventListener('click', () => {
      const key = card.dataset.skill;
      const def = SKILLS.find(s => s.key === key);
      if (RPG.points <= 0 || RPG.ranks[key] >= def.max) return;
      RPG.points--; RPG.ranks[key]++;
      SFX.chime();
      if (key === 'nova' && RPG.ranks.nova === 1) {
        showToast(IS_TOUCH ? '⭐ RAINBOW NOVA unlocked — tap NOVA!' : '⭐ RAINBOW NOVA unlocked — press F!');
      }
      refreshSkillPanel();
      updateRPGHUD();
    });
  });
}
function refreshSkillPanel() {
  document.getElementById('skillPoints').textContent = 'POINTS: ' + RPG.points;
  document.querySelectorAll('.skillCard').forEach(card => {
    const key = card.dataset.skill;
    const def = SKILLS.find(s => s.key === key);
    card.querySelectorAll('.pip').forEach((p, r) => p.classList.toggle('on', r < RPG.ranks[key]));
    card.querySelector('.plusBtn').disabled = RPG.points <= 0 || RPG.ranks[key] >= def.max;
  });
}
function toggleSkillPanel(open) {
  const el = document.getElementById('skillOverlay');
  if (open === undefined) open = el.classList.contains('hidden');
  if (open && Game.state === 'playing') {
    Game.state = 'skills'; // tactical pause: world freezes while allocating
    refreshSkillPanel();
    el.classList.remove('hidden');
    Input.spray = false; SFX.setSpray(false);
    if (document.exitPointerLock) document.exitPointerLock();
  } else if (!open && Game.state === 'skills') {
    Game.state = 'playing';
    el.classList.add('hidden');
    if (!IS_TOUCH) canvas.requestPointerLock();
  }
}

// ---- Rainbow Nova: unlockable AoE purify burst ----
let novaCooldown = 0;
const novaRings = [];
const novaCdFillEl = document.getElementById('novaCdFill');
function updateNova(dt) {
  for (let i = novaRings.length - 1; i >= 0; i--) {
    const r = novaRings[i];
    r.life -= dt;
    if (r.life <= 0) {
      scene.remove(r.ring); r.ring.geometry.dispose(); r.ring.material.dispose();
      novaRings.splice(i, 1); continue;
    }
    const f = 1 - r.life / 0.6;
    r.ring.scale.setScalar(0.5 + r.radius * f);
    r.ring.material.opacity = 0.9 * (1 - f);
  }

  if (RPG.ranks.nova <= 0) { Input.novaPressed = false; return; }
  const maxCd = 24 - 5 * RPG.ranks.nova; // 19s / 14s / 9s
  novaCooldown = Math.max(0, novaCooldown - dt);
  novaCdFillEl.style.width = (100 - novaCooldown / maxCd * 100) + '%';
  if (!Input.novaPressed) return;
  Input.novaPressed = false;
  if (novaCooldown > 0 || Game.state !== 'playing') return;

  novaCooldown = maxCd;
  const radius = 6 + 2 * RPG.ranks.nova;
  SFX.nova();
  Player.shake = Math.max(Player.shake, 0.5);
  spawnGlitter(Player.pos.clone().add(new THREE.Vector3(0, 1.2, 0)), 160, 8);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.86, 1, 48),
    new THREE.MeshBasicMaterial({ color: 0xffb0ea, transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(Player.pos.x, 0.15, Player.pos.z);
  scene.add(ring);
  novaRings.push({ ring, life: 0.6, radius });
  for (const p of piles) if (p.alive && p.group.position.distanceTo(Player.pos) < radius) p.clean(80, p.group.position);
  for (const z of zombies) if (z.alive && z.group.position.distanceTo(Player.pos) < radius) {
    z.clean(80, z.group.position);
    if (z.alive) z.stun(1.5);
  }
}

/* =====================================================================
   12.7 GAME FEEL — combos, floating text, kill slow-mo, death anims,
   the sixth-sense ping, and the cinematic intro.
   ===================================================================== */
let hitStop = 0;                 // seconds of slow-motion remaining
const dyingZombies = [];         // spin-shrink corpses mid-animation

function reapEntities() {
  for (let i = piles.length - 1; i >= 0; i--) {
    if (piles[i].alive) continue;
    removeCleanTargets(piles[i].group); // never leave a ray-blocker behind
    piles.splice(i, 1);
  }
  for (let i = zombies.length - 1; i >= 0; i--) {
    if (zombies[i].alive) continue;
    removeCleanTargets(zombies[i].group);
    zombies.splice(i, 1);
  }
}

function updateDying(dt) {
  for (let i = dyingZombies.length - 1; i >= 0; i--) {
    const d = dyingZombies[i];
    d.t -= dt;
    if (d.t <= 0) {
      spawnGlitter(d.g.position.clone().add(new THREE.Vector3(0, 0.6, 0)), 30, 3);
      scene.remove(d.g);
      dyingZombies.splice(i, 1);
      continue;
    }
    d.g.rotation.y += 15 * dt;
    d.g.scale.setScalar(Math.max(0.01, d.t / 0.45));
  }
}

// ---- floating world-space text (XP popups, combo callouts) ----
const floatTexts = [];
// Draw the label onto an existing (or new) sprite. Split out so a keyed
// popup can be repainted in place instead of spawning a second one.
function paintFloatText(sprite, text, color) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 80;
  const g = c.getContext('2d');
  g.font = '700 42px "Segoe UI", system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 8; g.strokeStyle = 'rgba(10,6,20,0.9)';
  g.strokeText(text, 128, 40);
  g.fillStyle = color; g.fillText(text, 128, 40);
  const tex = new THREE.CanvasTexture(c);
  if (sprite.material.map) sprite.material.map.dispose();
  sprite.material.map = tex;
  sprite.material.needsUpdate = true;
}

// `key` collapses a repeating popup into ONE that updates in place. Without
// it a good chain paints COMBO x4/x5/x6/x7 and four XP tickers on top of each
// other and the screen becomes unreadable at exactly the moment you most
// want to see what you did. Keyed popups also count up, which reads better
// than a stack of near-identical numbers.
/* ---------------------------------------------------------------------
   FEEDBACK HIERARCHY (BUILD 14)

   BUILD 12 stopped a repeating popup printing five copies of itself. What
   it did not fix is that six *different* channels all fire at the same
   instant and all draw at the same size, in the same place, at the moment
   you most want to read them. A good slam printed SKY SLAM!, AIRBORNE
   PURIFY!, +600 XP and SPOTLESS! in one band of pixels, and you could read
   none of them.

   Three tiers, and they never compete:

     headline — ONE at a time, large, at the action. Style kills, chains,
       slams, boss beats. A new headline only displaces a live one if it
       is at least as important, so a CRIT! can't stomp a CHAIN x5.
     ticker   — small, dim, parked below the headline. Running totals:
       XP, score, combo. They are reference numbers, not events.
     label    — normal size, at the object it belongs to. SAVED!, HELP!,
       SPOTLESS! — contextual, and usually nowhere near the middle.

   Tiers are the ranking; `key` (from BUILD 12) still collapses repeats
   within one.
   --------------------------------------------------------------------- */
const FLOAT_TIERS = {
  headline: { scale: [3.0, 0.94], pop: [3.35, 1.05], life: 1.25, rise: 1.25, dim: 1 },
  ticker:   { scale: [1.65, 0.5], pop: [1.85, 0.56], life: 0.95, rise: 0.8,  dim: 0.72 },
  label:    { scale: [2.4, 0.74], pop: [2.7, 0.83],  life: 1.15, rise: 1.1,  dim: 0.9 },
};
function spawnFloatText(pos, text, color = '#ffd94f', opts = null) {
  // legacy call form: a bare string is the key, tier inferred as a label
  if (typeof opts === 'string') opts = { key: opts };
  const o = opts || {};
  const tier = FLOAT_TIERS[o.tier] ? o.tier : 'label';
  const T = FLOAT_TIERS[tier];
  const pri = o.pri || 0;

  // headlines share one slot: the biggest moment on screen wins it
  const key = tier === 'headline' ? 'headline' : o.key;
  if (key) {
    const live = floatTexts.find(f => f.key === key && f.life > 0.3);
    if (live) {
      if (tier === 'headline' && pri < live.pri) return; // a lesser beat doesn't steal it
      paintFloatText(live.s, text, color);
      live.life = T.life; live.pri = Math.max(live.pri, pri);
      live.s.scale.set(T.pop[0], T.pop[1], 1); // a repaint pops — it re-earns the eye
      live.s.position.copy(pos);
      if (tier === 'ticker') live.s.position.y -= 0.9;
      return;
    }
  }
  if (floatTexts.length > 9) { // hard cap: recycle the oldest
    const old = floatTexts.shift();
    scene.remove(old.s); old.s.material.map.dispose(); old.s.material.dispose();
  }
  const m = new THREE.SpriteMaterial({ transparent: true, depthWrite: false });
  const s = new THREE.Sprite(m);
  paintFloatText(s, text, color);
  s.scale.set(T.scale[0], T.scale[1], 1);
  s.position.copy(pos);
  // tickers sit below the headline band; labels fan slightly so two events in
  // the same frame don't print on top of one another
  if (tier === 'ticker') s.position.y -= 0.9;
  else if (tier === 'label') {
    s.position.x += (Math.random() - 0.5) * 1.2;
    s.position.y += floatTexts.length * 0.12;
  }
  scene.add(s);
  floatTexts.push({ s, life: T.life, key, pri, tier });
}
function updateFloatTexts(dt) {
  xpRunT = Math.max(0, xpRunT - dt);
  for (let i = floatTexts.length - 1; i >= 0; i--) {
    const f = floatTexts[i];
    const T = FLOAT_TIERS[f.tier] || FLOAT_TIERS.label;
    f.life -= dt;
    if (f.life <= 0) {
      scene.remove(f.s); f.s.material.map.dispose(); f.s.material.dispose();
      floatTexts.splice(i, 1); continue;
    }
    f.s.position.y += T.rise * dt;
    f.s.material.opacity = Math.min(1, f.life * 1.6) * T.dim;
  }
}

// ---- combo: chained cleans inside a 3s window raise the chime pitch
// and pay a small XP bonus ----
let comboCount = 0, comboT = 0;
function registerCombo(pos) {
  comboT = 3;
  comboCount++;
  Hype.add(0.06 + 0.03 * Math.min(comboCount, 6)); // chaining is the point
  SFX.chime(1 + 0.08 * Math.min(comboCount - 1, 8));
  if (comboCount >= 2) {
    spawnFloatText(pos.clone().add(new THREE.Vector3(0, 2.6, 0)), 'COMBO x' + comboCount, '#ff8fd0', { tier: 'ticker', key: 'combo' });
    gainXP(5 * Math.min(comboCount - 1, 6)); // bonus, no popup spam
  }
}

/* ---------------------------------------------------------------------
   HYPE (BUILD 6) — the style meter. Cleaning with flair heats it up; at
   each tier the wharf itself gets more fabulous: a disco ball drops out
   of the fog, coloured beams sweep the deck, the bloom swells and a
   groove kicks in under the score. Let it cool and the party packs up.
   --------------------------------------------------------------------- */
const HYPE_TIERS = [
  null,
  { name: 'GROOVY',    color: '#5fc8ff', at: 0.30 },
  { name: 'FABULOUS',  color: '#ff8fd0', at: 0.62 },
  { name: 'LEGENDARY', color: '#ffd94f', at: 0.84 },
];
const hypeWrapEl = document.getElementById('hypeWrap');
const hypeLabelEl = document.getElementById('hypeLabel');
const hypeFillEl = document.getElementById('hypeFill');
const Hype = {
  heat: 0, tier: 0, peak: 0,
  add(x) { if (Game.state === 'playing') this.heat = Math.min(1, this.heat + x); },
  dmgMul() { return 1 + this.tier * 0.15; },      // up to +45% at LEGENDARY
  // capped low deliberately: this multiplies the sparkle at exactly the
  // moment the most things are dying at once, and the bloom is already hottest
  glitterMul() { return 1 + this.tier * 0.18; },
};

function updateHype(dt) {
  // heat bleeds away steadily — a streak is something you keep alive
  Hype.heat = Math.max(0, Hype.heat - dt * 0.075 * Perks.hypeDecayMul());
  // hysteresis: you climb at the threshold but only fall 0.07 below it, so a
  // tier you earned doesn't strobe on and off while the meter drains
  let tier = 0;
  for (let i = HYPE_TIERS.length - 1; i >= 1; i--) {
    const enter = HYPE_TIERS[i].at;
    const hold = i <= Hype.tier ? enter - 0.07 : enter;
    if (Hype.heat >= hold) { tier = i; break; }
  }
  if (tier !== Hype.tier) {
    const rising = tier > Hype.tier;
    Hype.tier = tier;
    Hype.peak = Math.max(Hype.peak, tier);
    SFX.setGroove(tier);
    if (tier > 0) {
      const T = HYPE_TIERS[tier];
      hypeLabelEl.textContent = T.name;
      hypeLabelEl.style.color = T.color;
      if (rising) {
        hypeLabelEl.classList.remove('bump'); void hypeLabelEl.offsetWidth;
        hypeLabelEl.classList.add('bump');
        SFX.chime(1.2 + 0.15 * tier);
        spawnFloatText(Player.pos.clone().add(new THREE.Vector3(0, 3.1, 0)), T.name, T.color);
        Player._fovPunch = Math.max(Player._fovPunch, 3 + tier);
      }
    }
    hypeWrapEl.classList.toggle('on', tier > 0);
  }
  hypeFillEl.style.width = (Hype.heat * 100) + '%';
  updateDisco(dt);
}

// the disco rig: a mirrorball on an invisible wire, plus sweeping cones.
// Built lazily the first time anyone earns it — no cost until it matters.
let disco = null;
function buildDisco() {
  const g = new THREE.Group();
  const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(0.85, 1),
    new THREE.MeshStandardMaterial({ color: 0xdfe8ff, metalness: 1, roughness: 0.12,
      flatShading: true, emissive: 0x8fa8ff, emissiveIntensity: 0.4 }));
  g.add(ball);
  const halo = glowSprite(0xcfe0ff, 4.2, 0.3);
  g.add(halo);
  const beams = [];
  for (let i = 0; i < 7; i++) {
    const col = new THREE.Color().setHSL(i / 7, 0.95, 0.6);
    // Narrow spokes, tilted well out from vertical. Width matters: a fat cone
    // hung above the player swallows the camera, and being *inside* an additive
    // double-sided cone paints its far wall across the whole screen.
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.5, 18, 8, 1, true),
      new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.06,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    cone.position.y = -9;
    const pivot = new THREE.Group();
    pivot.add(cone);
    pivot.rotation.z = 0.78 + Math.random() * 0.22; // ~45°+ out, so it lands on deck, not on the lens
    pivot.rotation.y = (i / 7) * Math.PI * 2;
    g.add(pivot);
    // the light pool where that spoke meets the planks — this is the part
    // that actually reads as a mirrorball from the player's eyeline
    const pool = glowSprite(col.getHex(), 3.4, 0.3);
    pool.material.fog = false;
    scene.add(pool);
    beams.push({ pivot, cone, pool, spin: (i % 2 ? 1 : -1) * (0.5 + Math.random() * 0.4) });
  }
  g.position.set(Player.pos.x, 22, Player.pos.z);
  g.visible = false;
  scene.add(g);
  disco = { g, ball, halo, beams, y: 22, bloomBase: bloom.strength };
  return disco;
}
function updateDisco(dt) {
  const tier = Hype.tier;
  if (!disco) {
    if (tier <= 0) return;
    buildDisco();
  }
  const want = tier > 0 ? 8.4 : 22;
  disco.y += (want - disco.y) * (1 - Math.pow(0.12, dt));
  disco.g.visible = disco.y < 20.5;
  if (!disco.g.visible) {
    bloom.strength = disco.bloomBase;
    for (const b of disco.beams) b.pool.visible = false;
    return;
  }
  // the ball hangs over the party, drifting after the player rather than
  // welded to him — it reads as a fixture, not a hat
  disco.g.position.x += (Player.pos.x - disco.g.position.x) * (1 - Math.pow(0.2, dt));
  disco.g.position.z += (Player.pos.z - disco.g.position.z) * (1 - Math.pow(0.2, dt));
  disco.g.position.y = disco.y;
  const lit = THREE.MathUtils.clamp((20.5 - disco.y) / 12, 0, 1);
  disco.ball.rotation.y += dt * 1.1;
  disco.ball.material.emissiveIntensity = 0.35 + 0.25 * Math.sin(clock.elapsedTime * 6);
  disco.halo.material.opacity = 0.3 * lit;
  for (const b of disco.beams) {
    if (!Settings.reduceMotion) {
      b.pivot.rotation.y += dt * b.spin;
      b.pivot.rotation.z = 0.86 + Math.sin(clock.elapsedTime * 0.7 + b.spin * 3) * 0.16;
    }
    b.cone.material.opacity = (0.018 + 0.016 * tier) * lit;
    // park the pool where this spoke strikes the deck
    const reach = disco.y * Math.tan(b.pivot.rotation.z);
    b.pool.position.set(disco.g.position.x + Math.sin(b.pivot.rotation.y) * reach, 0.06,
                        disco.g.position.z + Math.cos(b.pivot.rotation.y) * reach);
    b.pool.material.opacity = (0.1 + 0.075 * tier) * lit;
    b.pool.visible = true;
  }
  bloom.strength = disco.bloomBase + 0.14 * tier * lit; // the whole scene glows harder
}

// ---- sixth-sense ping (C / PING): the horn flashes and the nearest
// dirty objective answers through the fog ----
let pingCd = 0;
const pingBeacons = [];
function updatePing(dt) {
  pingCd = Math.max(0, pingCd - dt);
  for (let i = pingBeacons.length - 1; i >= 0; i--) {
    const b = pingBeacons[i];
    b.life -= dt;
    if (b.life <= 0) { scene.remove(b.s); b.s.material.dispose(); pingBeacons.splice(i, 1); continue; }
    b.s.scale.setScalar(2 + (2.5 - b.life) * 4);
    b.s.material.opacity = Math.min(0.9, b.life * 0.7);
  }
  if (!Input.pingPressed) return;
  Input.pingPressed = false;
  if (pingCd > 0 || !Player.hasHorn || Game.state !== 'playing') return;
  pingCd = 6;
  let best = null, bestD = 1e9;
  for (const p of piles) if (p.alive) { const d = p.group.position.distanceTo(Player.pos); if (d < bestD) { bestD = d; best = p.group.position; } }
  for (const z of zombies) if (z.alive) { const d = z.group.position.distanceTo(Player.pos); if (d < bestD) { bestD = d; best = z.group.position; } }
  if (!best) return;
  SFX.sonar(panFor(best));
  Player.hornLight.intensity = 9; // flash; relaxes back in updatePlayer
  const s = glowSprite(0x9fdcff, 2, 0.9);
  s.position.copy(best).y += 2.4;
  scene.add(s);
  pingBeacons.push({ s, life: 2.5 });
}

// ---- cinematic intro: fly from above the bridge down to Jax ----
let introT = 0, introSkip = false;
const INTRO_LEN = 3.4;
function updateIntro(dt) {
  introT += dt;
  if (introSkip) introT = INTRO_LEN;
  const k = THREE.MathUtils.smoothstep(Math.min(introT / INTRO_LEN, 1), 0, 1);
  const cp = Math.cos(Player.pitch);
  const aim = _v2.set(Math.sin(Player.yaw) * cp, Math.sin(Player.pitch), Math.cos(Player.yaw) * cp);
  const headPos = _v1.copy(Player.pos).add(new THREE.Vector3(0, 1.9, 0));
  const endPos = headPos.clone().addScaledVector(aim, -5.4).add(new THREE.Vector3(0, 0.4, 0));
  camera.position.set(
    THREE.MathUtils.lerp(8, endPos.x, k),
    THREE.MathUtils.lerp(44, endPos.y, k),
    THREE.MathUtils.lerp(-70, endPos.z, k));
  camera.lookAt(
    THREE.MathUtils.lerp(0, headPos.x, k),
    THREE.MathUtils.lerp(3, headPos.y, k),
    THREE.MathUtils.lerp(6, headPos.z + aim.z * 10, k));
  if (introT >= INTRO_LEN) {
    Game.state = 'playing';
    document.body.classList.remove('cine');
    document.getElementById('crosshair').classList.remove('hidden');
    document.getElementById('beamCd').classList.remove('hidden');
    Input.lookDX = 0; Input.lookDY = 0; // discard look input accumulated mid-flight
    Game.startTime = performance.now();
    Tutorial.fire('start');
  }
}

/* =====================================================================
   12.8 SETTINGS, PAUSE MENU, AUTO-QUALITY — the game adapts to weak
   hardware by itself; the player can override everything.
   ===================================================================== */
const Settings = { volume: 85, music: true, voice: true, quality: 'auto', reduceMotion: false, showFps: false, models: true, modelYaw: 0, nozzleAdj: { fwd: 0, up: 0 }, sens: 1, difficulty: 'normal' };
if (!Settings.nozzleAdj) Settings.nozzleAdj = { fwd: 0, up: 0 }; // heal older saves
let fpsAccum = 0, fpsCount = 0;
const fpsEl = document.getElementById('fpsMeter');
try { Object.assign(Settings, JSON.parse(localStorage.getItem('uj_settings') || '{}')); } catch (e) { /* private mode */ }
if (!Settings.sens) Settings.sens = 1; // heal saves that predate the look-sensitivity setting
if (!DIFFICULTIES[Settings.difficulty]) Settings.difficulty = 'normal';
function saveSettings() { try { localStorage.setItem('uj_settings', JSON.stringify(Settings)); } catch (e) {} }

const QUALITY_TIERS = {
  high: { bloom: true, shadows: true, dpr: 1.75 },
  medium: { bloom: true, shadows: false, dpr: 1.25 },
  low: { bloom: false, shadows: false, dpr: 1 },
};
let autoTier = 'high', appliedTier = 'high';
function activeTier() { return Settings.quality === 'auto' ? autoTier : Settings.quality; }
function applyQuality() {
  const tier = activeTier();
  if (tier === appliedTier) return;
  appliedTier = tier;
  const q = QUALITY_TIERS[tier];
  bloom.enabled = q.bloom;
  if (renderer.shadowMap.enabled !== q.shadows) {
    renderer.shadowMap.enabled = q.shadows;
    sun.castShadow = q.shadows;
    scene.traverse(o => { if (o.isMesh && o.material) o.material.needsUpdate = true; });
  }
  renderer.setPixelRatio(Math.min(devicePixelRatio, q.dpr));
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
  applyModelSetting(); // tier change may cross the models on/off threshold
}
function applySettings() {
  if (SFX.master) SFX.master.gain.value = 0.85 * Settings.volume / 100;
  if (SFX._musicBus) SFX._musicBus.gain.value = Settings.music ? 0.05 : 0;
  applyQuality();
  refreshSettingsUI();
}
function refreshSettingsUI() {
  document.getElementById('setVol').value = Settings.volume;
  document.getElementById('setSens').value = Settings.sens || 1;
  document.getElementById('setSensVal').textContent = (Settings.sens || 1).toFixed(1) + '×';
  document.getElementById('setDiff').textContent = DIFF.cur().label;
  document.getElementById('startDiff').textContent = DIFF.cur().label;
  document.getElementById('setMusic').textContent = Settings.music ? 'ON' : 'OFF';
  document.getElementById('setVoice').textContent = Settings.voice ? 'ON' : 'OFF';
  document.getElementById('setQuality').textContent =
    Settings.quality.toUpperCase() + (Settings.quality === 'auto' ? ' · ' + autoTier.toUpperCase() : '');
  document.getElementById('setMotion').textContent = Settings.reduceMotion ? 'ON' : 'OFF';
  document.getElementById('setFps').textContent = Settings.showFps ? 'ON' : 'OFF';
  document.getElementById('setModels').textContent = Settings.models ? '3D' : 'CLASSIC';
  fpsEl.style.display = Settings.showFps ? 'block' : 'none';
}

// rolling-fps monitor: three bad seconds on Auto steps the tier down
let fpsFrames = 0, fpsTime = 0, fpsLowStreak = 0;
function updateAutoQuality(rawDt) {
  fpsFrames++; fpsTime += rawDt;
  if (fpsTime < 1) return;
  const fps = fpsFrames / fpsTime;
  fpsFrames = 0; fpsTime = 0;
  if (Settings.quality !== 'auto' || Game.state !== 'playing' || autoTier === 'low') { fpsLowStreak = 0; return; }
  if (fps < 45) {
    if (++fpsLowStreak >= 3) {
      autoTier = autoTier === 'high' ? 'medium' : 'low';
      fpsLowStreak = 0;
      applyQuality(); refreshSettingsUI();
      showToast('⚙ Auto quality adjusted: ' + autoTier.toUpperCase());
    }
  } else fpsLowStreak = 0;
}

function togglePause(open) {
  const el = document.getElementById('pauseOverlay');
  if (open === undefined) open = el.classList.contains('hidden');
  if (open && Game.state === 'playing') {
    Game.state = 'paused';
    refreshSettingsUI();
    el.classList.remove('hidden');
    Input.spray = false; SFX.setSpray(false);
    if (document.exitPointerLock) document.exitPointerLock();
  } else if (!open && Game.state === 'paused') {
    Game.state = 'playing';
    el.classList.add('hidden');
    if (!IS_TOUCH) canvas.requestPointerLock();
  }
}

/* =====================================================================
   12.9 GAMEPAD — standard mapping: sticks move/look, RT/A spray,
   X beam, Y nova, B jump, RB ping, L3 sprint, Start pause, Back talents
   ===================================================================== */
const gpPrev = {};
function pollGamepad() {
  const gp = (navigator.getGamepads && navigator.getGamepads()[0]) || null;
  Input.gpSpray = false; Input.gpSprint = false; Input.gpX = 0; Input.gpY = 0;
  if (!gp || !gp.connected) return;
  const dz = v => (Math.abs(v || 0) > 0.16 ? v : 0);
  Input.gpX = dz(gp.axes[0]); Input.gpY = dz(gp.axes[1]);
  Input.lookDX += dz(gp.axes[2]) * 16;
  Input.lookDY += dz(gp.axes[3]) * 12;
  const down = i => !!(gp.buttons[i] && gp.buttons[i].pressed);
  Input.gpSpray = down(7) || down(0);
  Input.gpSprint = down(10);
  const edge = (i, cb) => { const p = down(i); if (p && !gpPrev[i]) cb(); gpPrev[i] = p; };
  edge(2, () => Input.beamPressed = true);
  edge(3, () => Input.novaPressed = true);
  edge(1, () => Input.jumpPressed = true);
  edge(5, () => Input.pingPressed = true);
  edge(9, () => { if (Game.state === 'intro') introSkip = true; else togglePause(); });
  edge(8, () => toggleSkillPanel());
}

// threat level drives the score: how many hunters are close, and how close
let threatLevel = 0;
function updateThreatMusic(dt) {
  let hunters = 0, nearest = Infinity;
  for (const z of zombies) {
    if (!z.alive) continue;
    if (z.state !== 'chase' && z.state !== 'windup' && z.state !== 'lunge') continue;
    const d = z.group.position.distanceTo(Player.pos);
    if (d < 26) { hunters++; nearest = Math.min(nearest, d); }
  }
  let want = Math.min(1, hunters / 3);
  if (nearest < 7) want = Math.min(1, want + 0.35);
  if (boss && boss.alive && boss.rise > 0.5) want = Math.max(want, 0.55 + 0.15 * boss.phase());
  threatLevel += (want - threatLevel) * (1 - Math.pow(0.25, dt)); // slew, don't flicker
  SFX.setIntensity(threatLevel);
}

/* =====================================================================
   12.9 NAVIGATION HUD (BUILD 5) — a 221m pier in heavy fog needs bearings.
        A compass strip carries objective markers by relative bearing, and
        damage arrives as a directional arc so you know where to turn.
   ===================================================================== */
const compassEl = document.getElementById('compass');
const dmgArcsEl = document.getElementById('dmgArcs');
const compassPool = [];
const dmgArcs = [];
const COMPASS_HALF = 0.92; // radians of bearing visible either side of centre

function compassMarker(i) {
  while (compassPool.length <= i) {
    const el = document.createElement('div');
    el.className = 'cmark';
    el.innerHTML = '<b></b><span></span>';
    compassEl.appendChild(el);
    compassPool.push(el);
  }
  return compassPool[i];
}

// relative bearing of a world point, in "screen radians": 0 dead ahead,
// positive to the right of the crosshair
function screenBearing(p) {
  let rel = Math.atan2(p.x - Player.pos.x, p.z - Player.pos.z) - Player.yaw;
  rel = Math.atan2(Math.sin(rel), Math.cos(rel));
  return -rel; // +x is screen-left in this camera basis, so flip
}

function updateCompass() {
  if (Game.state !== 'playing') { compassEl.classList.add('hidden'); return; }
  compassEl.classList.remove('hidden');
  const marks = [];
  // infected sea lions first — they are on a timer, so they outrank everything
  for (const c of civilians) {
    if (c.resolved || !c.active) continue;
    marks.push({ icon: '🦭', p: c.group.position, urgent: true });
  }
  // the nearest dirty pile and the nearest hunting zombie: the two things
  // you actually steer toward and away from
  let pile = null, pileD = Infinity, hunter = null, hunterD = Infinity;
  for (const p of piles) {
    if (!p.alive) continue;
    const d = p.group.position.distanceTo(Player.pos);
    if (d < pileD) { pileD = d; pile = p; }
  }
  for (const z of zombies) {
    if (!z.alive || (z.state !== 'chase' && z.state !== 'windup' && z.state !== 'lunge')) continue;
    const d = z.group.position.distanceTo(Player.pos);
    if (d < hunterD) { hunterD = d; hunter = z; }
  }
  if (pile) marks.push({ icon: '💩', p: pile.group.position });
  if (hunter && hunterD < 40) marks.push({ icon: '🧟', p: hunter.group.position, urgent: hunterD < 12 });
  if (shard && shard.position.distanceTo(Player.pos) < 90) marks.push({ icon: '🌠', p: shard.position });
  if (boss && boss.alive) marks.push({ icon: '🐙', p: boss.group.position, urgent: true });

  const placed = [];
  for (let i = 0; i < compassPool.length || i < marks.length; i++) {
    const el = compassMarker(i), m = marks[i];
    if (!m) { el.style.opacity = 0; continue; }
    const rel = screenBearing(m.p);
    const off = Math.abs(rel) > COMPASS_HALF;
    const clamped = THREE.MathUtils.clamp(rel, -COMPASS_HALF, COMPASS_HALF);
    let pct = 50 + (clamped / COMPASS_HALF) * 50;
    // declutter: two objectives on the same bearing would print on top of each
    // other, so nudge the lower-priority one aside rather than hide it
    for (const q of placed) {
      if (Math.abs(pct - q) < 5.5) pct = q + (pct >= q ? 5.5 : -5.5);
    }
    placed.push(pct);
    el.style.left = THREE.MathUtils.clamp(pct, 0, 100) + '%';
    el.style.opacity = 1;
    el.classList.toggle('edge', off);
    el.classList.toggle('urgent', !!m.urgent && !off);
    const d = Math.round(m.p.distanceTo(Player.pos));
    const icon = off ? (rel > 0 ? m.icon + '›' : '‹' + m.icon) : m.icon;
    if (el.firstChild.textContent !== icon) el.firstChild.textContent = icon;
    const label = d + 'm';
    if (el.lastChild.textContent !== label) el.lastChild.textContent = label;
  }
}

// a red arc blooms at the bearing the hit came from, then fades
function showDamageFrom(fromDir) {
  if (!dmgArcsEl || Settings.reduceMotion) return;
  let el = dmgArcs.find(a => a.life <= 0);
  if (!el) {
    if (dmgArcs.length >= 3) el = dmgArcs[0];
    else {
      const d = document.createElement('div');
      d.className = 'dmgArc';
      dmgArcsEl.appendChild(d);
      el = { el: d, life: 0 };
      dmgArcs.push(el);
    }
  }
  // fromDir points from attacker toward Jax, so the attacker is back along it
  _v2.copy(fromDir).setY(0);
  if (_v2.lengthSq() < 1e-6) _v2.set(0, 0, 1);
  _v2.normalize().multiplyScalar(-1);
  const deg = screenBearing(_v2.add(Player.pos)) * 180 / Math.PI;
  el.el.style.transform = `rotate(${deg}deg)`;
  el.life = 1.1;
}
function updateDamageArcs(dt) {
  for (const a of dmgArcs) {
    if (a.life <= 0) continue;
    a.life -= dt;
    a.el.style.opacity = Math.max(0, Math.min(1, a.life * 1.3));
  }
}

/* =====================================================================
   13. TUTORIAL — one mechanic at a time, gated by play events
   ===================================================================== */
const tutorialEl = document.getElementById('tutorial');
const Tutorial = {
  fired: {},
  hideT: 0,

  show(text, sticky = false) {
    tutorialEl.textContent = text;
    tutorialEl.style.opacity = 1;
    this.hideT = sticky ? Infinity : 7;
    narrate(text);
  },

  fire(event) {
    if (Rush.on) return; // endless mode isn't the tutorial's story
    if (this.fired[event]) return;
    this.fired[event] = true;
    switch (event) {
      case 'start':
        this.show(IS_TOUCH
          ? 'The rot has spread to Fisherman’s Wharf, Jax. Use the LEFT STICK to reclaim your horn from the glowing crater.'
          : 'The rot has spread to Fisherman’s Wharf, Jax. Use WASD to reclaim your horn from the glowing crater.');
        break;
      case 'hornPickup':
        this.show(IS_TOUCH
          ? 'The Unicorn Horn is yours! HOLD the SPRAY button to fire your power-hose. Watch the PSI meter — ease off to refill.'
          : 'The Unicorn Horn is yours! HOLD LEFT CLICK to fire your power-hose. Watch the PSI meter — ease off to refill.');
        break;
      case 'pressureEmpty':
        this.show('Pressure spent! Ease off the trigger for a moment — the tank refills fast.');
        break;
      case 'firstSpray':
        this.show('That’s the stuff! Now hose down the glowing poop pile ahead until it bursts into glitter.');
        break;
      case 'firstSlam':
        this.show('GROUND POUND! The higher the drop, the wider it hits — and anything it flattens takes DOUBLE from the hose while it’s down. Get up on the containers and the awning pads, then come down on the crowd.');
        break;
      case 'firstCrit':
        this.show('CORE HIT! That cyan orb is a gunk core — triple damage, and it pays your pressure back. It moves, so keep tracking it. Pop something while its core is lit and the goo goes off in everything nearby.');
        break;
      case 'pileCleaned':
        this.show(IS_TOUCH
          ? 'Sparkling! Cleaning filled your RAINBOW METER — tap BEAM to unleash the Magic Beam!'
          : 'Sparkling! Cleaning filled your RAINBOW METER — RIGHT CLICK (or Q) unleashes the Magic Beam!');
        break;
      case 'firstBeam':
        this.show('Beautiful — the beam blasts AND stuns! Now listen… groans in the fog. Hose the rainbow slime off the poop zombies to melt them!');
        break;
      case 'zombieDefeated':
        this.show('FABULOUS! Purify the whole wharf: every pile, every zombie, every sea lion. Let your ears guide you.', true);
        break;
    }
  },

  update(dt) {
    if (this.hideT === Infinity) return;
    this.hideT -= dt;
    if (this.hideT <= 0) tutorialEl.style.opacity = 0;
  },
};

/* =====================================================================
   14. GAME STATE, HUD, WIN/LOSE
   ===================================================================== */
const bossBarEl = document.getElementById('bossBar');
const bossFillEl = document.getElementById('bossFill');
const bossStateEl = document.getElementById('bossState');
const hpFill = document.getElementById('hpFill');
const beamCdFill = document.getElementById('beamCdFill');
const dmgFlashEl = document.getElementById('dmgFlash');
const resumeHint = document.getElementById('resumeHint');

const Game = {
  state: 'menu', // menu | intro | playing | skills | won | dead
  pilesCleaned: 0, zombiesDefeated: 0,
  crits: 0, bursts: 0, bestChain: 0, // BUILD 12 precision telemetry
  slams: 0, bestSlam: 0,             // BUILD 13 ground pound telemetry
  totalPiles: 0, totalZombies: 0,
  civSaved: 0, civResolved: 0, civTotal: 5,
  bossActive: false, bossDefeated: false,
  shardFound: false,
  dmgFlash: 0, startTime: 0,
};

function updateObjectiveHUD() {
  const bump = (id, txt) => { // counter pop when a value changes
    const el = document.getElementById(id);
    if (el.textContent !== txt) {
      el.textContent = txt;
      el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
    }
  };
  bump('pileCount', `${Game.pilesCleaned}/${Game.totalPiles}`);
  bump('zombieCount', `${Game.zombiesDefeated}/${Game.totalZombies}`);
  bump('civCount', `${Game.civSaved}/${Game.civTotal}`);
}

function checkWin() {
  if (Game.state !== 'playing' || Rush.on) return; // endless mode has no win, only a high score
  if (Game.pilesCleaned >= Game.totalPiles && Game.zombiesDefeated >= Game.totalZombies
      && Game.civResolved >= Game.civTotal) {
    // BUILD 7: a clean wharf is no longer the end of it — it's what wakes
    // the Kraken. The level is won when the core goes out.
    if (!Game.bossDefeated) { summonBoss(); return; }
    Game.state = 'won';
    WIDE_NOZZLE = true; // reward turns on immediately, and persists below
    try { localStorage.setItem('uj_wide_nozzle', '1'); } catch (e) { /* private mode */ }
    SFX.fanfare();
    SFX.setSpray(false);
    tutorialEl.style.opacity = 0;
    // celebratory glitter rain around the player
    for (let i = 0; i < 6; i++) {
      const c = Player.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 8, 3 + Math.random() * 3, (Math.random() - 0.5) * 8));
      spawnGlitter(c, 80, 6);
    }
    const secs = Math.round((performance.now() - Game.startTime) / 1000);
    const fmt = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    let bestTxt = '';
    try { // personal best persists across sessions
      const prev = Number(localStorage.getItem('uj_l2_best')) || Infinity;
      const best = Math.min(prev, secs);
      localStorage.setItem('uj_l2_best', best);
      bestTxt = ` · Best: ${fmt(best)}${secs <= prev ? ' — NEW RECORD!' : ''}`;
    } catch (e) { /* private mode: no persistence */ }
    // performance rank: secondary objectives + speed + survival earn an S–C
    const objs = [Game.zombiesDefeated >= 5, Game.civSaved >= Game.civTotal, Game.shardFound];
    let score = objs.filter(Boolean).length * 2;           // up to 6 for objectives
    if (Player.hp >= 90) score += 2; else if (Player.hp >= 50) score += 1; // survival
    if (secs <= 480) score += 2; else if (secs <= 720) score += 1;         // speed (3x map: 8/12 min)
    const rank = score >= 9 ? 'S' : score >= 7 ? 'A' : score >= 4 ? 'B' : 'C';
    const rankColor = { S: '#ffd94f', A: '#5fffb0', B: '#5fc8ff', C: '#c58fff' }[rank];
    try {
      const prevRank = localStorage.getItem('uj_l2_rank') || 'C';
      if ('SABC'.indexOf(rank) <= 'SABC'.indexOf(prevRank)) localStorage.setItem('uj_l2_rank', rank);
    } catch (e) {}
    document.getElementById('winRank').innerHTML =
      `<span style="color:${rankColor}">RANK ${rank}</span>`;
    document.getElementById('winStats').textContent =
      `Cleared in ${fmt(secs)} · HP left: ${Math.max(0, Math.round(Player.hp))} · Level ${RPG.level} · ${RPG.xp} XP${bestTxt}`;
    document.getElementById('winObjectives').innerHTML = [
      ['Cleaned every poop pile', true],
      [`Defeated ${Game.zombiesDefeated} Rainbow Zombies (goal: 5)`, Game.zombiesDefeated >= 5],
      [`Civilians saved: ${Game.civSaved}/${Game.civTotal}`, Game.civSaved >= Game.civTotal],
      [`Weak points hit: ${Game.crits} · goo detonations: ${Game.bursts}${Game.bestChain > 1 ? ` (best chain x${Game.bestChain})` : ''}`, Game.crits > 0],
    [`Ground pounds: ${Game.slams}${Game.bestSlam > 0 ? ` (longest drop ${Game.bestSlam} m)` : ''}`, Game.slams > 0],
    ['The Gunk Kraken purified', Game.bossDefeated],
      ['Meteor Shard Fragment found', Game.shardFound],
    ].map(([txt, ok]) => `${ok ? '✅' : '⬜'} ${txt}`).join('<br>');
    setTimeout(() => {
      document.getElementById('winOverlay').classList.remove('hidden');
      if (document.exitPointerLock) document.exitPointerLock();
    }, 1400);
    narrate('The wharf sparkles! Your hose grows wider with power.');
  }
}

function gameOver() {
  Game.state = 'dead';
  SFX.setSpray(false);
  tutorialEl.style.opacity = 0;
  if (Rush.on) {
    const isBest = Rush.score > Rush.best;
    Rush.save();
    document.getElementById('rushResult').innerHTML =
      `Wave ${Rush.wave} · Score <b>${Rush.score.toLocaleString()}</b>` +
      (isBest ? ' — 🏆 NEW BEST!' : ` · Best ${Rush.best.toLocaleString()}`);
  }
  document.getElementById('deadOverlay').classList.remove('hidden');
  if (document.exitPointerLock) document.exitPointerLock();
}

/* =====================================================================
   15. LEVEL LAYOUT + BOOT
   ===================================================================== */
function buildLevel() {
  buildWharf();
  buildGulls();
  buildCrater();
  buildFogParticles();
  buildPlayer();
  buildHornPickup();
  buildHose();
  buildSplashes();
  buildShard();
  buildStreetlights();
  buildGraffiti();
  buildProps();
  buildContactShadows();

  // the interactive toy layer: washable stains, suds barrels, beach balls
  // and the harbor bell (gull bombing runs spawn on a timer during play)
  const grimeSpots = [
    [-3, -14, 1], [4, -21, 1.2], [0.5, -36, 1], [-5.5, -44, 1.1],
    [3, -59, 1], [-2, -64, 1.2], [6, -77, 1], [-4.8, -86, 1],
    [-8, -95, 1.1], [7, -110, 1], [-6, -135, 1.2], [9, -155, 1],
    [-9, -172, 1], [4, -195, 1.1],
  ];
  for (const [x, z, s] of grimeSpots) new Grime(x, z, s);
  new SudsBarrel(-6, -22); new SudsBarrel(6, -48); new SudsBarrel(-5.5, -80);
  new SudsBarrel(9, -125); new SudsBarrel(-8, -170);
  buildBeachBalls();
  buildBell(10.4, -44);   // mid-pier, sea-lion side
  buildBell(-10.4, -140); // deep pier, shop side

  // three infected sea lions hauled out on the pier — cleanse them in time
  civilians.push(new Civilian(-4, -33), new Civilian(5, -57), new Civilian(-3, -74),
    new Civilian(8, -118), new Civilian(-9, -158));

  // poop piles — twelve of them; the first two are the tutorial targets
  const pileSpots = [
    [2, -11, 1.2], [-4, -18, 1], [4, -26, 0.9], [-5, -33, 1.1], [1, -40, 1],
    [5, -47, 0.9], [-4, -54, 1.1], [2, -61, 1], [-6, -67, 0.9], [4, -73, 1.2],
    [-2, -79, 1], [5, -84, 1], [8, -92, 1], [-9, -101, 1.1], [3, -112, 0.9],
    [9, -124, 1], [-7, -138, 1.2], [5, -152, 1], [-9, -168, 0.9], [2, -190, 1.3],
  ];
  for (const [x, z, s] of pileSpots) piles.push(new PoopPile(x, z, s));
  Game.totalPiles = piles.length;

  // zombies — first one waits past the beam tutorial so mechanics land one at
  // a time; two mid/late spots are red-eyed runners (BUILD 3 threat variety)
  const zombieSpots = [
    [0, -30], [-4, -42], [4, -50, 'runner'], [-3, -58],
    [5, -66], [-5, -72], [0, -78, 'runner'], [3, -84],
    [-7, -98], [6, -112, 'runner'], [-8, -130, 'brute'], [4, -148],
    [-3, -168, 'runner'], [7, -188, 'brute'],
  ];
  for (const [x, z, kind] of zombieSpots) {
    zombies.push(new Zombie(x, z, { runner: kind === 'runner', brute: kind === 'brute' }));
  }
  Game.totalZombies = zombies.length;

  Game.layoutStats = {
    piles: piles.length, zombies: zombies.length, civs: civilians.length,
    runners: zombies.filter(z => z.runner).length,
    brutes: zombies.filter(z => z.brute).length,
  };
  updateObjectiveHUD();
}

function startGame(mode) {
  SFX.init();
  if (mode === 'rush') startRush();
  applySettings(); // saved volume/music/quality take effect immediately
  document.getElementById('startOverlay').classList.add('hidden');
  // cinematic fly-in first; crosshair/HUD and the tutorial arrive at its end.
  // Pointer lock must be requested inside this click gesture — it persists
  // through the intro even though mouse-look is ignored until it ends.
  Game.state = 'intro';
  introT = 0; introSkip = false;
  document.body.classList.add('cine');
  Game.startTime = performance.now();
  if (!IS_TOUCH) canvas.requestPointerLock();
}

document.getElementById('startBtn').addEventListener('click', () => startGame());
document.getElementById('rushBtn').addEventListener('click', () => startGame('rush'));
document.getElementById('btnNozzle').addEventListener('click', () => cycleNozzle(1));
document.getElementById('againBtn').addEventListener('click', () => location.reload());
document.getElementById('retryBtn').addEventListener('click', () => location.reload());
skillBtn.addEventListener('click', () => toggleSkillPanel());
document.getElementById('skillResume').addEventListener('click', () => toggleSkillPanel(false));
buildSkillPanel();

// settings menu wiring
document.getElementById('gearBtn').addEventListener('click', () => togglePause());
document.getElementById('pauseResume').addEventListener('click', () => togglePause(false));
document.getElementById('pauseRestart').addEventListener('click', () => location.reload());
document.getElementById('setVol').addEventListener('input', e => {
  Settings.volume = +e.target.value; saveSettings(); applySettings();
});
document.getElementById('setSens').addEventListener('input', e => {
  Settings.sens = +e.target.value; saveSettings(); refreshSettingsUI();
});
// one cycler, two buttons: the start screen and the pause menu
function cycleDifficulty(toast) {
  const order = ['story', 'normal', 'nightmare'];
  Settings.difficulty = order[(order.indexOf(Settings.difficulty) + 1) % order.length];
  saveSettings(); refreshSettingsUI();
  if (toast) showToast('⚔ Difficulty: ' + DIFF.cur().label);
}
document.getElementById('setDiff').addEventListener('click', () => cycleDifficulty(true));
document.getElementById('startDiff').addEventListener('click', () => cycleDifficulty(false));
document.getElementById('setMusic').addEventListener('click', () => {
  Settings.music = !Settings.music; saveSettings(); applySettings();
});
document.getElementById('setVoice').addEventListener('click', () => {
  Settings.voice = !Settings.voice; saveSettings(); refreshSettingsUI();
});
document.getElementById('setQuality').addEventListener('click', () => {
  const order = ['auto', 'high', 'medium', 'low'];
  Settings.quality = order[(order.indexOf(Settings.quality) + 1) % order.length];
  saveSettings(); applyQuality(); refreshSettingsUI();
});
document.getElementById('setMotion').addEventListener('click', () => {
  Settings.reduceMotion = !Settings.reduceMotion; saveSettings(); refreshSettingsUI();
});
document.getElementById('setFps').addEventListener('click', () => {
  Settings.showFps = !Settings.showFps; saveSettings(); refreshSettingsUI();
});
document.getElementById('setModels').addEventListener('click', () => {
  Settings.models = !Settings.models;
  saveSettings();
  if (Settings.models) loadCharacterModels();
  applyModelSetting();
  refreshSettingsUI();
});
refreshSettingsUI();
applyQuality();
// clicking back into the game re-locks the pointer on desktop
canvas.addEventListener('click', () => {
  if (Game.state === 'playing' && !IS_TOUCH && !Input.locked) canvas.requestPointerLock();
});

if (IS_TOUCH) setupTouch();
buildLevel();
if (Settings.models) loadCharacterModels();

/* =====================================================================
   16. MAIN LOOP
   ===================================================================== */
// debug/testing hook (also handy in the console: UJ.Diag-style poking)
window.UJ = { Game, Player, Tutorial, piles, zombies, civilians, Meters, cleanTargets, CFG, Input, renderer, RPG, gainXP, toggleSkillPanel,
  Settings, togglePause, applyQuality, activeTier, modelsActive, applyModelSetting,
  setAutoTier: (t) => { autoTier = t; applyQuality(); },
  getShard: () => shard,
  skipIntro: () => { introSkip = true; },
  getCombo: () => comboCount,
  getDying: () => dyingZombies.length,
  // muzzle/spray introspection — lets a headless playtest confirm water leaves
  // the barrel tip rather than the chest without needing to see the render
  HoseFX,
  nozzleWorldPos: (out) => nozzleWorldPos(out || new THREE.Vector3()),
  spawnZombieAt: (x, z, opts) => { const z2 = new Zombie(x, z, opts); z2.setState('chase'); z2.heading = Math.atan2(Player.pos.x - x, Player.pos.z - z); z2.speed = CFG.zombie.chaseSpeed * z2.speedMul * 0.5; zombies.push(z2); Game.totalZombies++; return z2; },
  maybeTriggerClimax,
  getZombies: () => zombies,
  getFrames: () => _frameCount,
  camera,
  aimAt: (tx, ty, tz) => { // point the player's aim from the camera toward a world point
    const d = new THREE.Vector3(tx, ty, tz).sub(camera.position).normalize();
    Player.yaw = Math.atan2(d.x, d.z); Player.pitch = Math.asin(THREE.MathUtils.clamp(d.y, -1, 1));
  },
  // deterministic single-frame advance for headless testing, where the browser
  // throttles requestAnimationFrame. Runs the same updates as the 'playing' tick.
  // Advances its own time accumulator so `t`-driven animation (sway, breathe,
  // glow pulse) evolves across steps instead of freezing at clock.elapsedTime.
  step: (dt = 0.03) => {
    dt = Math.min(dt, 0.05);
    _stepTime += dt;
    // ONE list of updates, shared with the real frame — see simulate().
    simulate(dt, clock.elapsedTime + _stepTime);
    // A real frame ends in composer.render(), which is what refreshes every
    // child's matrixWorld. Without it a headless step() loop raycasts against
    // stale matrices — freshly spawned meshes simply aren't where they claim
    // to be, and every ray misses. Mirror the render's side effect.
    scene.updateMatrixWorld(true);
  },
  physBodies, cars, civilians2: civilians, setWideNozzle: v => { WIDE_NOZZLE = v; },
  // wharf-toys hooks (BUILD 2): the interactive layer, reachable by playtests
  grimes, barrels, gullSplats, beachBalls, wetPatches, spawnWetPatch, spawnGullSplat,
  getBell: () => bells[0], bells, ambientSeaLions,
  // BUILD 5 hooks: camera rig, navigation HUD, difficulty, threat music
  camBlockers, DIFF, DIFFICULTIES, updateCompass, compassPool, dmgArcs,
  screenBearing, showDamageFrom, updateDamageArcs, damagePlayer,
  getThreat: () => threatLevel, vignette, updateZombies,
  Hype, HYPE_TIERS, updateHype, getDisco: () => disco, bloom,
  BOSS, summonBoss, updateBoss, getBoss: () => boss, checkWin, updateSplashes, splashPool, scene,
  NOZZLES, cycleNozzle, Nozzle, getNozzleIdx: () => nozzleIdx, setNozzle: (i) => { nozzleIdx = i; applyNozzleUI(); },
  Rush, startRush, startWave, updateRush, clearStoryContent, reapEntities,
  platforms, bouncePads, groundHeightAt, tryBounce, updateBouncePads, removeCleanTargets,
  updateContactShadows, getContactMesh: () => contactMesh,
  PERKS, Perks, offerPerks, takePerk, getPerkOffer: () => perkOffer,
  // BUILD 12 weak points / crits / chain bursts
  // BUILD 14 particle budget + feedback tiers
  GLITTER_BUDGET, getGlitterLive: () => glitterLive, bursts, FLOAT_TIERS, floatTexts, simulate,
  spawnGlitter, spawnSplash, spawnFloatText,
  // BUILD 13 ground pound
  startSlam, landSlam, slamRings, updateSlamRings, updateSlamHint,
  CRIT, attachWeakPoint, moveWeakPoint, updateWeakPoints, applyCrit, chainBurst,
  burstOnDeath, burstRings, updateBurstRings,
  getCritChain: () => critChain, onCore: () => crosshairOnCore,
  renderOnce: () => composer.render() };

const clock = new THREE.Clock();
let _frameCount = 0;
let _stepTime = 0; // headless UJ.step() time accumulator (see the step hook above)
/* ---------------------------------------------------------------------
   ONE SIMULATION, TWO DRIVERS (BUILD 14)

   `tick()` is the real frame; `UJ.step()` is the deterministic driver the
   headless suites use because a background browser throttles rAF to ~2fps.
   Keeping two hand-maintained lists of update calls in sync failed four
   separate times — the stepper silently skipped `updatePileJelly`, then
   combo expiry, then `scene.updateMatrixWorld` (which made every raycast
   miss), then `updateGlitter` (which leaked ~2000 Points objects over a
   long headless run and quietly poisoned every performance measurement
   taken in this repo).

   So there is now exactly ONE list. `simulate()` is the whole world
   advancing by dt; both drivers call it and then do their own private
   work — the frame renders and reads real hardware timings, the stepper
   refreshes matrices by hand. A new system added to `simulate()` cannot
   be forgotten by one of them, because there is no longer a second place
   to forget it.
   --------------------------------------------------------------------- */
function simulate(dt, t) {
  // kill slow-motion: world runs at 15% for a beat (skipped for reduce-motion).
  // This lives here, not in the frame, because it changes how far the world
  // actually moves — a stepper that skipped it was simulating a different game.
  if (Settings.reduceMotion) hitStop = 0;
  if (hitStop > 0) { hitStop -= dt; dt *= 0.15; }

  // --- ambient world: runs in menus too, so the wharf is alive behind the UI
  updateCrater(dt, t);
  updateFogParticles(dt, t);
  updateOcean(t);
  updateGulls(t);
  updateSeaLions(t, dt);
  updateBouncePads(dt, t);
  updateContactShadows();
  updateGlitter(dt);
  updateSplashes(dt);
  updateDamageArcs(dt);
  updatePhysics(dt); updateCars(dt);
  updatePileJelly(dt, t);
  updateWeakPoints(dt, t);
  updateBurstRings(dt);
  updateSlamRings(dt);
  updateDying(dt);
  updateFloatTexts(dt);

  // filmic post: grain always breathing, aberration only when you're hurt
  vignette.uniforms.time.value = t;
  vignette.uniforms.aberration.value = Settings.reduceMotion ? 0 : Game.dmgFlash * 0.006;

  // toast fade (level-ups, unlocks)
  if (toastT > 0) { toastT -= dt; if (toastT <= 0) toastEl.style.opacity = 0; }
  if (comboT > 0) { comboT -= dt; if (comboT <= 0) comboCount = 0; }

  if (Game.state === 'intro') {
    updateIntro(dt);
  } else if (Game.state === 'playing') {
    updatePlayer(dt, t);
    updateHose(dt);
    updateBeam(dt);
    updateNova(dt);
    updatePing(dt);
    updateZombies(dt, t);
    for (const c of civilians) c.update(dt, t);
    updateWharfToys(dt);
    updateBoss(dt, t);
    updateRush(dt);
    reapEntities();
    updateCompass();
    updateThreatMusic(dt);
    updateHype(dt);
    updateShard(dt, t);
    updateStreetlights(dt);
    updateSlamHint();
    updateAudioCues(dt);
    Tutorial.update(dt);

    // crosshair pulse while the spray is connecting
    if (hitPulse > 0.01) {
      hitPulse = Math.max(0, hitPulse - dt * 4);
      crosshairEl.style.transform = `translate(-50%,-50%) scale(${1 + hitPulse * 0.3})`;
      crosshairEl.style.filter = `drop-shadow(0 0 ${hitPulse * 6}px #9fdcff)`;
    }

    // damage vignette fade
    if (Game.dmgFlash > 0) {
      Game.dmgFlash = Math.max(0, Game.dmgFlash - dt * 2);
      dmgFlashEl.style.opacity = Game.dmgFlash * 0.9;
    }
  } else if (Game.state === 'won') {
    // slow victory orbit
    const a = t * 0.3;
    camera.position.lerp(_v1.set(Player.pos.x + Math.sin(a) * 8, 4, Player.pos.z + Math.cos(a) * 8), 0.02);
    camera.lookAt(Player.pos.x, 1.5, Player.pos.z);
  }
}

function tick() {
  requestAnimationFrame(tick);
  _frameCount++;
  const rawDt = clock.getDelta();
  const t = clock.elapsedTime;

  // frame-only work: real input devices and real hardware timings. These are
  // deliberately NOT in simulate() — a headless step has no gamepad, and
  // feeding it fake frame times would have it downgrade the quality tier.
  pollGamepad();
  updateAutoQuality(rawDt);
  if (Settings.showFps) {
    fpsAccum += rawDt; fpsCount++;
    if (fpsAccum >= 0.5) {
      fpsEl.textContent = Math.round(fpsCount / fpsAccum) + ' FPS · ' + activeTier().toUpperCase();
      fpsAccum = 0; fpsCount = 0;
    }
  }

  simulate(Math.min(rawDt, 0.05), t);
  composer.render();
}
tick();

// the shell shows LOADING… until this module is evaluated
const _sb = document.getElementById('startBtn');
_sb.disabled = false;
_sb.textContent = 'WAKE UP, JAX';
