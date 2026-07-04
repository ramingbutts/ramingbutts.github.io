import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

/* =====================================================================
   0. CONFIG — one place to tune the whole level
   ===================================================================== */
const CFG = {
  bridge: { width: 18, zStart: 15, zEnd: -205, playZEnd: -132 }, // playable section ends before second tower
  fogDensity: 0.030,
  fogColor: 0x9db3c6,
  player: { speed: 8, jumpVel: 8.5, gravity: 24, hp: 100 },
  hose:   { range: 20, dps: 65, spawnRate: 320 },   // particles/sec while spraying
  beam:   { range: 40, damage: 45, cooldown: 3 },
  zombie: { count: 9, detect: 15, lose: 26, wanderSpeed: 1.1, chaseSpeed: 2.9,
            lungeSpeed: 11, lungeTime: 0.35, windup: 0.55, recover: 0.9,
            hitRange: 1.5, damage: 12, goo: 100 },
  pile:   { dirt: 100 },
};

const IS_TOUCH = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

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
    const chords = [
      [220.0, 261.6, 329.6, 392.0],   // Am add9
      [174.6, 220.0, 261.6, 349.2],   // F maj
      [196.0, 246.9, 293.7, 392.0],   // G add7
      [164.8, 220.0, 246.9, 329.6],   // E min-ish
    ];
    const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 750; lp.Q.value = 0.5;
    const breathe = this.ctx.createOscillator(); breathe.frequency.value = 0.045;
    const breatheG = this.ctx.createGain(); breatheG.gain.value = 320;
    breathe.connect(breatheG); breatheG.connect(lp.frequency); breathe.start();
    const bus = this.ctx.createGain(); bus.gain.value = 0.05;
    lp.connect(bus); bus.connect(this.master);
    this._musicVoices = chords[0].map((f, i) => {
      const o = this.ctx.createOscillator(); o.type = 'triangle';
      o.frequency.value = f; o.detune.value = (i - 1.5) * 5;
      const g = this.ctx.createGain(); g.gain.value = 0.22;
      o.connect(g); g.connect(lp); o.start();
      return o;
    });
    let step = 0;
    this._musicTimer = setInterval(() => {
      step = (step + 1) % chords.length;
      const t = this.ctx.currentTime;
      this._musicVoices.forEach((o, i) => {
        o.frequency.cancelScheduledValues(t);
        o.frequency.setValueAtTime(o.frequency.value, t);
        o.frequency.linearRampToValueAtTime(chords[step][i], t + 2.5);
      });
    }, 9000);
  },

  _out(pan = 0, vol = 1) { // panner+gain chain for one-shots
    const g = this.ctx.createGain(); g.gain.value = vol;
    if (this.ctx.createStereoPanner) {
      const p = this.ctx.createStereoPanner(); p.pan.value = pan;
      g.connect(p); p.connect(this.master);
    } else g.connect(this.master);
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
function narrate(text) {
  try {
    if (!('speechSynthesis' in window)) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text.replace(/[✨💩🧟]/g, ''));
    u.rate = 1.05; u.pitch = 1.15; u.volume = 0.9;
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
    '<b>Left stick</b> move · <b>drag right side</b> look<br><b>SPRAY</b> hold to hose · <b>BEAM</b> magic blast · <b>JUMP</b><br>Fog is thick out there — <b>trust your ears</b>.';

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
renderer.toneMappingExposure = 1.15;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(CFG.fogColor);
scene.fog = new THREE.FogExp2(CFG.fogColor, CFG.fogDensity);

const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 300);

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
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), 0.5, 0.55, 0.75);
composer.addPass(bloom);
const vignette = new ShaderPass({
  name: 'VignetteShader',
  uniforms: { tDiffuse: { value: null }, strength: { value: 0.9 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `varying vec2 vUv; uniform sampler2D tDiffuse; uniform float strength;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      float d = distance(vUv, vec2(0.5));
      c.rgb *= 1.0 - strength * smoothstep(0.4, 0.78, d);
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

function buildBridge() {
  const B = CFG.bridge, len = B.zStart - B.zEnd, zMid = (B.zStart + B.zEnd) / 2;
  const grp = new THREE.Group();

  // roadway
  const deck = new THREE.Mesh(new THREE.BoxGeometry(B.width, 1, len), deckMat);
  deck.position.set(0, -0.5, zMid);
  deck.receiveShadow = true;
  grp.add(deck);

  // dashed lane line + worn white edge lines
  const dashGeo = new THREE.BoxGeometry(0.25, 0.02, 3);
  const dashMat = new THREE.MeshBasicMaterial({ color: 0xd8c86a });
  for (let z = B.zStart - 6; z > B.zEnd; z -= 9) {
    const d = new THREE.Mesh(dashGeo, dashMat);
    d.position.set(0, 0.02, z);
    grp.add(d);
  }
  const edgeMat = new THREE.MeshBasicMaterial({ color: 0xb9bcb4 });
  for (const side of [-1, 1]) {
    const edge = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.02, len), edgeMat);
    edge.position.set(side * (B.width / 2 - 1.4), 0.02, zMid);
    grp.add(edge);
  }

  // side curbs + railing posts
  const curbGeo = new THREE.BoxGeometry(0.8, 1.2, len);
  const postGeo = new THREE.BoxGeometry(0.15, 1.4, 0.15);
  for (const side of [-1, 1]) {
    const curb = new THREE.Mesh(curbGeo, bridgeMat);
    curb.position.set(side * (B.width / 2 - 0.4), 0.6, zMid);
    grp.add(curb);
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, len), bridgeMat);
    rail.position.set(side * (B.width / 2 - 0.4), 2.1, zMid);
    grp.add(rail);
    for (let z = B.zStart; z > B.zEnd; z -= 8) {
      const p = new THREE.Mesh(postGeo, bridgeMat);
      p.position.set(side * (B.width / 2 - 0.4), 1.9, z);
      grp.add(p);
    }
  }

  // two towers
  const towerZs = [-55, -155];
  const colGeo = new THREE.BoxGeometry(1.8, 56, 1.8);
  const braceGeo = new THREE.BoxGeometry(B.width + 2, 1.6, 1.2);
  for (const tz of towerZs) {
    for (const side of [-1, 1]) {
      const col = new THREE.Mesh(colGeo, bridgeMat);
      col.position.set(side * (B.width / 2 + 0.4), 27, tz);
      grp.add(col);
    }
    for (const by of [16, 34, 50]) {
      const brace = new THREE.Mesh(braceGeo, bridgeMat);
      brace.position.set(0, by, tz);
      grp.add(brace);
    }

    // fake volumetric light shafts under the lower brace — additive cones
    // read as fog-catching floodlights for nearly zero cost
    const shaftMat = new THREE.MeshBasicMaterial({ color: 0xfff3d0, transparent: true, opacity: 0.055,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    for (const sx of [-4.5, 4.5]) {
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 6),
        new THREE.MeshStandardMaterial({ color: 0xfff3d0, emissive: 0xffe9a8, emissiveIntensity: 2 }));
      lamp.position.set(sx, 15.4, tz);
      grp.add(lamp);
      const shaft = new THREE.Mesh(new THREE.ConeGeometry(3.4, 14.5, 10, 1, true), shaftMat);
      shaft.position.set(sx, 15.4 - 7.25, tz);
      grp.add(shaft);
    }
  }

  // main suspension cables (catmull-rom over tower tops) + vertical hangers
  const cableMat = new THREE.MeshStandardMaterial({ color: 0x8c2f1e, roughness: 0.6 });
  const hangerMat = new THREE.LineBasicMaterial({ color: 0x772a1c });
  for (const side of [-1, 1]) {
    const x = side * (B.width / 2 + 0.4);
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(x, 24, B.zStart),
      new THREE.Vector3(x, 9, -22),
      new THREE.Vector3(x, 54, -55),
      new THREE.Vector3(x, 11, -105),
      new THREE.Vector3(x, 54, -155),
      new THREE.Vector3(x, 9, -188),
      new THREE.Vector3(x, 24, B.zEnd),
    ]);
    grp.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 80, 0.28, 6), cableMat));

    // hangers: straight drops from the cable to the deck
    const pts = [];
    for (let i = 0; i <= 54; i++) {
      const p = curve.getPoint(i / 54);
      if (p.y < 3.2) continue;
      pts.push(p.x, p.y, p.z, p.x, 2.1, p.z);
    }
    const hg = new THREE.BufferGeometry();
    hg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    grp.add(new THREE.LineSegments(hg, hangerMat));
  }

  // abandoned cars for atmosphere
  const carBody = new THREE.BoxGeometry(2, 0.9, 4.2);
  const carTop = new THREE.BoxGeometry(1.7, 0.7, 2.2);
  [[5.5, -30, 0xa04a56], [-5.8, -66, 0x4a6a8a], [6, -95, 0x777d5a], [-5.2, -120, 0x8a8a92]].forEach(([x, z, col]) => {
    const m = new THREE.MeshStandardMaterial({ color: col, roughness: 0.55, metalness: 0.3 });
    const b = new THREE.Mesh(carBody, m); b.position.set(x, 0.45, z); b.rotation.y = (Math.random() - 0.5) * 0.5;
    const t = new THREE.Mesh(carTop, m); t.position.set(0, 0.8, -0.3); b.add(t);
    b.castShadow = true; t.castShadow = true;
    grp.add(b);
  });

  // ocean far below (mostly hidden by fog, sells the height)
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(600, 600),
    new THREE.MeshBasicMaterial({ color: 0x3d5a6b }));
  sea.rotation.x = -Math.PI / 2; sea.position.y = -60;
  grp.add(sea);

  // a soft sun disc burning through the fog (unaffected by scene fog)
  const sunGlow = glowSprite(0xfff3da, 70, 0.5);
  sunGlow.material.fog = false;
  sunGlow.position.set(70, 90, -60);
  grp.add(sunGlow);

  scene.add(grp);
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
  for (let i = 0; i < 20; i++) {
    const s = glowSprite(0xdde8f0, 34 + Math.random() * 20, 0.035 + Math.random() * 0.035);
    s.position.set((Math.random() - 0.5) * 40,
                   1 + Math.random() * 8,
                   CFG.bridge.zStart - Math.random() * 160);
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
function spawnGlitter(center, count = 70, power = 5) {
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
  bursts.push({ pts, vel, life: 1.2 });
}
function updateGlitter(dt) {
  for (let b = bursts.length - 1; b >= 0; b--) {
    const burst = bursts[b];
    burst.life -= dt;
    if (burst.life <= 0) {
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
   8. CLEANABLES — poop piles + the raycast cleaning interface.
      Anything with mesh.userData.entity = {clean(amount, point)} can
      be hosed. Piles and zombies both implement it.
   ===================================================================== */
const cleanTargets = [];   // meshes the hose/beam raycast against
const piles = [];

class PoopPile {
  constructor(x, z, size = 1) {
    this.dirt = CFG.pile.dirt;
    this.alive = true;
    this.size = size;
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
    scene.add(this.group);
  }

  clean(amount, point) {
    if (!this.alive) return;
    this.dirt -= amount;
    const f = Math.max(this.dirt, 0) / CFG.pile.dirt;
    this.group.scale.setScalar(0.35 + 0.65 * f);
    this.glow.material.opacity = 0.1 + 0.25 * f;
    if (Math.random() < 0.15) spawnGlitter(point || this.group.position, 6, 2); // scrub sparks
    if (this.dirt <= 0) this.die();
  }

  die() {
    this.alive = false;
    const c = this.group.position.clone(); c.y += 1;
    spawnGlitter(c, 90, 6);
    SFX.pop(panFor(this.group.position), 0.9);
    registerCombo(this.group.position);
    removeCleanTargets(this.group);
    scene.remove(this.group);
    Game.pilesCleaned++;
    gainXP(25, this.group.position);
    Tutorial.fire('pileCleaned');
    updateObjectiveHUD();
    checkWin();
  }
}

function removeCleanTargets(group) {
  group.traverse(o => {
    const i = cleanTargets.indexOf(o);
    if (i >= 0) cleanTargets.splice(i, 1);
  });
}

/* =====================================================================
   9. ZOMBIES — flamboyant glitter zombies. Shirtless, hot-pink shorts,
      covered in rainbow goo; hose the goo off to defeat them.
      FSM: wander -> chase -> windup -> lunge -> recover
   ===================================================================== */
const zombies = [];
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3();

class Zombie {
  constructor(x, z) {
    this.goo = CFG.zombie.goo;
    this.alive = true;
    this.state = 'wander';
    this.stateT = 0;
    this.home = new THREE.Vector3(x, 0, z);
    this.target = this.home.clone();
    this.groanT = 2 + Math.random() * 4;
    this.hitCd = 0;
    this.lungeDir = new THREE.Vector3();

    const g = this.group = new THREE.Group();
    g.position.set(x, 0, z);

    // concept art: waddling poop golem — swirl head, one yellow eye, toothy
    // grin, claw arms/feet, dripping rainbow slime (the cleanable part)
    const poopDark = new THREE.MeshStandardMaterial({ color: 0x53341f, roughness: 0.55 });
    const clawMat = new THREE.MeshStandardMaterial({ color: 0xcbb391, roughness: 0.4 });
    this.bodyMat = new THREE.MeshStandardMaterial({ color: 0x6b4426, roughness: 0.5,
      emissive: 0xff40c0, emissiveIntensity: 0.1 });

    // round belly
    const belly = new THREE.Mesh(new THREE.SphereGeometry(0.55, 12, 10), this.bodyMat);
    belly.position.y = 0.85; belly.scale.set(1, 1.1, 0.9);
    belly.userData.entity = this;
    g.add(belly); cleanTargets.push(belly);

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

    // one big yellow eye + pupil, and a toothy grin
    this.eyeMat = new THREE.MeshStandardMaterial({ color: 0xffd23f, emissive: 0xffc400, emissiveIntensity: 0.9 });
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

    // dangling claw arms
    const armGeo = new THREE.CapsuleGeometry(0.11, 0.5, 3, 6);
    this.arms = [];
    for (const s of [-1, 1]) {
      const arm = new THREE.Mesh(armGeo, this.bodyMat);
      arm.position.set(s * 0.6, 0.95, 0.05);
      arm.rotation.z = s * 0.5;
      g.add(arm); this.arms.push(arm);
      for (let c = 0; c < 3; c++) {
        const claw = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.12, 5), clawMat);
        claw.position.set((c - 1) * 0.055, -0.42, 0.03);
        claw.rotation.x = Math.PI; // point down from the paw
        arm.add(claw);
      }
    }

    // clawed feet
    const footGeo = new THREE.BoxGeometry(0.26, 0.14, 0.42);
    for (const s of [-1, 1]) {
      const foot = new THREE.Mesh(footGeo, poopDark);
      foot.position.set(s * 0.24, 0.07, 0.08);
      g.add(foot);
      for (let c = 0; c < 2; c++) {
        const claw = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.12, 5), clawMat);
        claw.position.set(s * 0.24 + (c - 0.5) * 0.11, 0.06, 0.34);
        claw.rotation.x = Math.PI / 2;
        g.add(claw);
      }
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

    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    scene.add(g);
  }

  clean(amount, point) {
    if (!this.alive) return;
    this.goo -= amount;
    const f = Math.max(this.goo, 0) / CFG.zombie.goo;
    this.bodyMat.emissiveIntensity = 0.1 * f;
    for (const b of this.gooBlobs) b.scale.setScalar(Math.max(0.01, f));
    if (Math.random() < 0.12) spawnGlitter(point || this.group.position, 5, 2);
    // being hosed aggravates him
    if (this.state === 'wander') this.setState('chase');
    if (this.goo <= 0) this.die();
  }

  die() {
    this.alive = false;
    const c = this.group.position.clone(); c.y += 1.3;
    spawnGlitter(c, 130, 7);
    SFX.pop(panFor(this.group.position), 1);
    registerCombo(this.group.position);
    removeCleanTargets(this.group);
    // death animation: spin-shrink for 0.45s, then a final sparkle; the
    // group is removed by the dying-list updater in the main loop
    dyingZombies.push({ g: this.group, t: 0.45 });
    hitStop = 0.09; // brief slow-motion on every kill
    Game.zombiesDefeated++;
    RPG.kills++;
    gainXP(50, this.group.position);
    Tutorial.fire('zombieDefeated');
    updateObjectiveHUD();
    checkWin();
  }

  setState(s) { this.state = s; this.stateT = 0; }

  update(dt, t) {
    if (!this.alive) return;
    this.stateT += dt;
    this.hitCd = Math.max(0, this.hitCd - dt);
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

    switch (this.state) {
      case 'wander': {
        if (dist < CFG.zombie.detect) { this.setState('chase'); break; }
        _v2.subVectors(this.target, pos); _v2.y = 0;
        if (_v2.length() < 0.5 || this.stateT > 6) {
          this.target.set(this.home.x + (Math.random() - 0.5) * 8, 0, this.home.z + (Math.random() - 0.5) * 8);
          this.stateT = 0;
        } else {
          _v2.normalize();
          pos.addScaledVector(_v2, CFG.zombie.wanderSpeed * dt);
          this.group.rotation.y = Math.atan2(_v2.x, _v2.z);
        }
        break;
      }
      case 'chase': {
        if (dist > CFG.zombie.lose) { this.setState('wander'); break; }
        if (dist < 3.2) { this.setState('windup'); break; }
        toPlayer.normalize();
        pos.addScaledVector(toPlayer, CFG.zombie.chaseSpeed * dt);
        this.group.rotation.y = Math.atan2(toPlayer.x, toPlayer.z);
        break;
      }
      case 'windup': { // dramatic lean-back before the flying lunge-hug
        this.group.rotation.x = -0.35 * Math.min(1, this.stateT / CFG.zombie.windup);
        if (this.stateT >= CFG.zombie.windup) {
          this.lungeDir.copy(toPlayer).normalize();
          this.setState('lunge');
          SFX.groan(panFor(pos), 0.9);
        }
        break;
      }
      case 'lunge': {
        pos.addScaledVector(this.lungeDir, CFG.zombie.lungeSpeed * dt);
        this.group.rotation.x = 0.4;
        if (dist < CFG.zombie.hitRange && this.hitCd <= 0) {
          this.hitCd = 1;
          damagePlayer(CFG.zombie.damage, this.lungeDir);
        }
        if (this.stateT >= CFG.zombie.lungeTime) { this.group.rotation.x = 0; this.setState('recover'); }
        break;
      }
      case 'recover': {
        if (this.stateT >= CFG.zombie.recover) this.setState(dist < CFG.zombie.lose ? 'chase' : 'wander');
        break;
      }
    }

    // keep on the deck
    pos.x = THREE.MathUtils.clamp(pos.x, -7.5, 7.5);
    pos.z = THREE.MathUtils.clamp(pos.z, CFG.bridge.playZEnd, CFG.bridge.zStart - 3);

    // waddling idle animation: body sway + paddling claw arms
    const sway = Math.sin(t * 5 + pos.x * 7);
    this.group.rotation.z = sway * 0.07;
    if (this.state === 'wander' || this.state === 'chase') { // waddle-rock while walking
      this.group.rotation.x = Math.sin(t * 7 + pos.z) * 0.06;
    }
    this.arms[0].rotation.z = -0.5 + Math.sin(t * 4) * 0.25;
    this.arms[1].rotation.z = 0.5 - Math.sin(t * 4 + 1) * 0.25;
    this.sparkle.material.opacity = 0.25 + 0.15 * Math.sin(t * 8);
    // the eye burns brighter when he's hunting you
    this.eyeMat.emissiveIntensity = this.state === 'chase' || this.state === 'windup' || this.state === 'lunge'
      ? 1.6 + 0.5 * Math.sin(t * 12)
      : 0.8 + 0.2 * Math.sin(t * 4);
  }
}

/* =====================================================================
   10. PLAYER — Jax: neon-blue jumpsuit, glowing horn (once picked up)
   ===================================================================== */
const Player = {
  group: null, pos: null, vel: new THREE.Vector3(), knock: new THREE.Vector3(),
  yaw: Math.PI, pitch: -0.05, onGround: true, hp: CFG.player.hp,
  hasHorn: false, horn: null, hornLight: null, shake: 0,
  forward: new THREE.Vector3(), aim: new THREE.Vector3(),
};

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
  Player.armsM = [];
  const armGeo = new THREE.CapsuleGeometry(0.13, 0.5, 3, 6);
  armGeo.translate(0, -0.28, 0); // pivot at the shoulder
  for (const s of [-1, 1]) {
    const arm = new THREE.Mesh(armGeo, skin);
    arm.position.set(s * 0.56, 1.58, 0.05);
    arm.rotation.z = s * 0.25;
    g.add(arm);
    Player.armsM.push(arm);
  }

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 10), skin);
  head.position.y = 1.85;
  g.add(head);

  // shaved silver sides + the permanent scowl (heavy brows, hard eyes)
  const silver = new THREE.MeshStandardMaterial({ color: 0xcfd2d6, roughness: 0.45 });
  for (const s of [-1, 1]) {
    const side = new THREE.Mesh(new THREE.SphereGeometry(0.27, 10, 8), silver);
    side.scale.set(0.42, 0.72, 0.8);
    side.position.set(s * 0.17, 1.94, -0.04);
    g.add(side);
    const brow = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.035, 0.04), black);
    brow.position.set(s * 0.1, 1.93, 0.245);
    brow.rotation.z = s * -0.28; // angled inward: he is not happy about the poop
    brow.rotation.y = s * 0.35;
    g.add(brow);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.026, 6, 5), black);
    eye.position.set(s * 0.1, 1.885, 0.255);
    g.add(eye);
  }

  // white unicorn ears
  const earGeo = new THREE.ConeGeometry(0.07, 0.18, 6);
  const earMat = new THREE.MeshStandardMaterial({ color: 0xf4f0ec, roughness: 0.5 });
  for (const s of [-1, 1]) {
    const ear = new THREE.Mesh(earGeo, earMat);
    ear.position.set(s * 0.19, 2.1, -0.02);
    ear.rotation.z = s * -0.3;
    g.add(ear);
  }

  // rainbow mohawk-mane: taller, denser, swept back like the art
  const maneGeo = new THREE.BoxGeometry(0.14, 0.34, 0.16);
  for (let i = 0; i < 9; i++) {
    const th = -0.4 + (i / 8) * 2.3;            // arc angle: forehead -> nape
    const hue = (i / 8) * 0.8;                  // red front -> purple back, no wrap
    const dir = new THREE.Vector3(0, Math.cos(th), -Math.sin(th));
    const spike = new THREE.Mesh(maneGeo, new THREE.MeshStandardMaterial({
      color: new THREE.Color().setHSL(hue, 0.95, 0.5), roughness: 0.5,
      emissive: new THREE.Color().setHSL(hue, 0.95, 0.35), emissiveIntensity: 0.45 }));
    spike.position.set(0, 1.85, 0).addScaledVector(dir, 0.37);
    spike.rotation.x = -th - 0.28;              // swept backward
    spike.scale.y = 0.9 + 0.85 * Math.sin(((i + 1) / 10) * Math.PI); // tall crest
    g.add(spike);
  }

  // pressure rig: chunky steel nozzle, blue tip, red hose looping to the belt
  const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.11, 0.55, 8), steel);
  nozzle.rotation.x = Math.PI / 2;
  nozzle.position.set(0.3, 1.2, 0.5);
  g.add(nozzle);
  const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.088, 0.088, 0.1, 8),
    new THREE.MeshStandardMaterial({ color: 0x3f8fdf, metalness: 0.5, roughness: 0.3 }));
  tip.rotation.x = Math.PI / 2;
  tip.position.set(0.3, 1.2, 0.79);
  g.add(tip);
  const hoseCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.3, 1.2, 0.24),
    new THREE.Vector3(0.44, 0.95, 0.08),
    new THREE.Vector3(0.3, 0.78, -0.26),
    new THREE.Vector3(0, 0.86, -0.34),
  ]);
  const hose = new THREE.Mesh(new THREE.TubeGeometry(hoseCurve, 16, 0.045, 6),
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
  Player.horn.position.set(0, 2.45, 0.15);
  Player.horn.rotation.x = -0.35;
  Player.horn.visible = false;
  g.add(Player.horn);
  // gold band at the horn base, per the concept art
  Player.hornRing = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.028, 6, 12),
    new THREE.MeshStandardMaterial({ color: 0xd9a940, metalness: 0.8, roughness: 0.3 }));
  Player.hornRing.position.set(0, 2.16, 0.05);
  Player.hornRing.rotation.x = Math.PI / 2 - 0.35; // perpendicular to the horn axis
  Player.hornRing.visible = false;
  g.add(Player.hornRing);
  Player.hornGlow = glowSprite(0xffb0ea, 1.1, 0.6);
  Player.hornGlow.position.set(0, 2.7, 0.32);
  Player.hornGlow.visible = false;
  g.add(Player.hornGlow);
  // real light from the horn — paints nearby piles/zombies pink at night... er, in fog
  Player.hornLight = new THREE.PointLight(0xff9ae0, 0, 10);
  Player.hornLight.position.set(0, 2.5, 0.2);
  g.add(Player.hornLight);

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
  const sens = 0.0023;
  Player.yaw -= dx * sens;
  Player.pitch = THREE.MathUtils.clamp(Player.pitch - dy * sens, -0.9, 0.7);

  Player.forward.set(Math.sin(Player.yaw), 0, Math.cos(Player.yaw));
  const cp = Math.cos(Player.pitch);
  Player.aim.set(Math.sin(Player.yaw) * cp, Math.sin(Player.pitch), Math.cos(Player.yaw) * cp);

  // --- move ---
  let f = 0, s = 0;
  if (Input.keys.KeyW || Input.keys.ArrowUp) f += 1;
  if (Input.keys.KeyS || Input.keys.ArrowDown) f -= 1;
  if (Input.keys.KeyD || Input.keys.ArrowRight) s += 1;
  if (Input.keys.KeyA || Input.keys.ArrowLeft) s -= 1;
  f += -Input.joy.y; s += Input.joy.x;

  const right = _v1.crossVectors(Player.forward, THREE.Object3D.DEFAULT_UP);
  _v2.set(0, 0, 0).addScaledVector(Player.forward, f).addScaledVector(right, s);
  if (_v2.lengthSq() > 1) _v2.normalize();
  const moving = _v2.lengthSq() > 0.001;
  const sprinting = moving && Player.onGround && (Input.keys.ShiftLeft || Input.keys.ShiftRight);
  Player.pos.addScaledVector(_v2, CFG.player.speed * RPG.speedMul() * (sprinting ? 1.45 : 1) * dt);

  // sprint FOV kick — subtle speed sensation
  const targetFov = sprinting ? 78 : 70;
  if (Math.abs(camera.fov - targetFov) > 0.05) {
    camera.fov += (targetFov - camera.fov) * (1 - Math.pow(0.005, dt));
    camera.updateProjectionMatrix();
  }

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

  // --- jump / gravity ---
  if (Input.jumpPressed && Player.onGround) { Player.vel.y = CFG.player.jumpVel; Player.onGround = false; }
  Input.jumpPressed = false;
  Player.vel.y -= CFG.player.gravity * dt;
  Player.pos.y += Player.vel.y * dt;
  if (Player.pos.y <= 0) { Player.pos.y = 0; Player.vel.y = 0; Player.onGround = true; }

  // stay on the playable deck
  Player.pos.x = THREE.MathUtils.clamp(Player.pos.x, -7.6, 7.6);
  Player.pos.z = THREE.MathUtils.clamp(Player.pos.z, CFG.bridge.playZEnd, 13);

  // body faces where the camera faces; bob a little when running
  Player.group.rotation.y = Player.yaw;
  Player.group.position.y = Player.pos.y + (moving && Player.onGround ? Math.abs(Math.sin(t * 9)) * 0.06 : 0);

  // run cycle: legs and arms counter-swing while moving, relax when idle
  const swing = (moving && Player.onGround) ? Math.sin(t * 10) : 0;
  const ease = 1 - Math.pow(0.001, dt);
  Player.legs[0].rotation.x += (swing * 0.55 - Player.legs[0].rotation.x) * ease;
  Player.legs[1].rotation.x += (-swing * 0.55 - Player.legs[1].rotation.x) * ease;
  Player.armsM[0].rotation.x += (-swing * 0.45 - Player.armsM[0].rotation.x) * ease;
  Player.armsM[1].rotation.x += (swing * 0.45 - Player.armsM[1].rotation.x) * ease;

  // --- camera: third-person follow, slightly damped ---
  const headPos = _v1.copy(Player.pos).add(new THREE.Vector3(0, 1.9, 0));
  const camTarget = _v2.copy(headPos).addScaledVector(Player.aim, -5.4).add(new THREE.Vector3(0, 0.4, 0));
  camTarget.y = Math.max(camTarget.y, 0.6);
  camera.position.lerp(camTarget, 1 - Math.pow(0.0001, dt));
  const lookAt = headPos.clone().addScaledVector(Player.aim, 10);
  camera.lookAt(lookAt);

  // camera shake (impacts, beam) — positional jitter after lookAt
  if (Player.shake > 0.002) {
    Player.shake *= Math.max(0, 1 - 5 * dt);
    camera.position.x += (Math.random() - 0.5) * Player.shake * 0.5;
    camera.position.y += (Math.random() - 0.5) * Player.shake * 0.35;
  } else Player.shake = 0;

  // keep the sun's shadow window centered on the player
  sun.position.set(Player.pos.x + 21, 43, Player.pos.z + 14);
  sun.target.position.copy(Player.pos);

  // --- horn pickup ---
  if (!Player.hasHorn && hornPickup) {
    hornPickup.rotation.y += dt * 2;
    hornPickup.position.y = 1.3 + Math.sin(t * 2.5) * 0.25;
    if (Player.pos.distanceTo(hornPickup.position) < 2.4) {
      Player.hasHorn = true;
      Player.horn.visible = true;
      Player.hornRing.visible = true;
      Player.hornGlow.visible = true;
      Player.hornLight.intensity = 3;
      scene.remove(hornPickup); hornPickup = null;
      SFX.chime(); SFX.fanfare();
      Tutorial.fire('hornPickup');
    }
  }
  if (Player.hasHorn) {
    Player.hornGlow.material.opacity = 0.5 + 0.25 * Math.sin(t * 6);
    // relax any ping flash back to the resting glow
    Player.hornLight.intensity += (3 - Player.hornLight.intensity) * (1 - Math.pow(0.05, dt));
  }
}

function damagePlayer(amount, fromDir) {
  if (Game.state !== 'playing') return;
  Player.hp -= amount;
  Player.knock.copy(fromDir).setY(0).normalize().multiplyScalar(7);
  Game.dmgFlash = 1;
  Player.shake = 0.45;
  SFX.hurt();
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

const raycaster = new THREE.Raycaster();
const HoseFX = { N: 500, idx: 0, pos: null, vel: [], life: [], points: null };

function buildHose() {
  HoseFX.pos = new Float32Array(HoseFX.N * 3).fill(-1000);
  for (let i = 0; i < HoseFX.N; i++) { HoseFX.vel.push(new THREE.Vector3()); HoseFX.life.push(0); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(HoseFX.pos, 3));
  HoseFX.points = new THREE.Points(geo, new THREE.PointsMaterial({
    map: GLOW_TEX, color: 0x9fdcff, size: 0.22, transparent: true, opacity: 0.85,
    blending: THREE.AdditiveBlending, depthWrite: false }));
  HoseFX.points.frustumCulled = false;
  scene.add(HoseFX.points);
}

function nozzleWorldPos(out) {
  return out.copy(Player.pos).add(new THREE.Vector3(0, 1.5, 0)).addScaledVector(Player.forward, 0.6);
}

let sprayAccum = 0, sprayWasOn = false, sprayHeldTime = 0, hitPulse = 0;
const crosshairEl = document.getElementById('crosshair');
function updateHose(dt) {
  const spraying = Input.spray && Player.hasHorn && Game.state === 'playing';
  if (spraying !== sprayWasOn) { SFX.setSpray(spraying); sprayWasOn = spraying; }

  if (spraying) {
    sprayHeldTime += dt;
    if (sprayHeldTime > 0.4) Tutorial.fire('firstSpray');

    // spawn spray particles from the nozzle along the aim
    const nozzle = nozzleWorldPos(_v1);
    sprayAccum += CFG.hose.spawnRate * dt;
    while (sprayAccum >= 1) {
      sprayAccum -= 1;
      const i = HoseFX.idx = (HoseFX.idx + 1) % HoseFX.N;
      HoseFX.pos[i * 3] = nozzle.x; HoseFX.pos[i * 3 + 1] = nozzle.y; HoseFX.pos[i * 3 + 2] = nozzle.z;
      HoseFX.vel[i].copy(Player.aim).multiplyScalar(22)
        .add(_v2.set((Math.random() - 0.5) * 2.4, Math.random() * 1.6, (Math.random() - 0.5) * 2.4));
      HoseFX.life[i] = 0.55;
    }

    // the actual cleaning: ray from the camera through the crosshair
    raycaster.set(camera.position, Player.aim);
    raycaster.far = CFG.hose.range + 6; // camera sits ~5.4 behind the player
    const hits = raycaster.intersectObjects(cleanTargets, false);
    if (hits.length) {
      const e = hits[0].object.userData.entity;
      if (e) {
        e.clean(CFG.hose.dps * RPG.hoseMul() * dt, hits[0].point);
        hitPulse = 1; // crosshair feedback: you're scrubbing something
        if (Math.random() < dt * 14) spawnSplash(hits[0].point);
        if (Math.random() < dt * 6) SFX.splat(panFor(hits[0].point), 0.35);
      }
    } else if (Player.aim.y < -0.05) {
      // no target: show the water hitting the roadway instead
      const tGround = (camera.position.y - 0.05) / -Player.aim.y;
      if (tGround < CFG.hose.range + 6 && Math.random() < dt * 10) {
        spawnSplash(_v2.copy(camera.position).addScaledVector(Player.aim, tGround));
      }
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
  beamCdFill.style.width = (100 - (beamCooldown / beamMaxCd) * 100) + '%';

  if (Input.beamPressed) {
    Input.beamPressed = false;
    if (Player.hasHorn && beamCooldown <= 0 && Game.state === 'playing') {
      beamCooldown = beamMaxCd;
      SFX.beam();
      Tutorial.fire('firstBeam');

      raycaster.set(camera.position, Player.aim);
      raycaster.far = CFG.beam.range + 6;
      const hits = raycaster.intersectObjects(cleanTargets, false);
      const nozzle = nozzleWorldPos(_v1.clone());
      let end;
      Player.shake = Math.max(Player.shake, 0.22);
      if (hits.length && hits[0].object.userData.entity) {
        end = hits[0].point.clone();
        hits[0].object.userData.entity.clean(CFG.beam.damage * RPG.beamMul(), hits[0].point);
        spawnGlitter(hits[0].point, 30, 4);
        spawnSplash(hits[0].point, true);
        SFX.splat(panFor(hits[0].point), 0.7);
      } else {
        end = nozzle.clone().addScaledVector(Player.aim, CFG.beam.range);
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
  thresholds: [100, 250, 450, 700, 1050], // cumulative XP for each level-up
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

function gainXP(amount, worldPos) {
  RPG.xp += amount;
  if (worldPos) {
    spawnGlitter(_v1.copy(worldPos).add(new THREE.Vector3(0, 1, 0)), 16, 3);
    spawnFloatText(worldPos.clone().add(new THREE.Vector3(0, 1.9, 0)), '+' + amount + ' XP');
  }
  while (RPG.level - 1 < RPG.thresholds.length && RPG.xp >= RPG.thresholds[RPG.level - 1]) {
    RPG.level++; RPG.points++;
    SFX.fanfare();
    Player.shake = Math.max(Player.shake, 0.2);
    spawnGlitter(Player.pos.clone().add(new THREE.Vector3(0, 1.5, 0)), 120, 6);
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
  for (const z of zombies) if (z.alive && z.group.position.distanceTo(Player.pos) < radius) z.clean(80, z.group.position);
}

/* =====================================================================
   12.7 GAME FEEL — combos, floating text, kill slow-mo, death anims,
   the sixth-sense ping, and the cinematic intro.
   ===================================================================== */
let hitStop = 0;                 // seconds of slow-motion remaining
const dyingZombies = [];         // spin-shrink corpses mid-animation

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
function spawnFloatText(pos, text, color = '#ffd94f') {
  if (floatTexts.length > 14) { // hard cap: recycle the oldest
    const old = floatTexts.shift();
    scene.remove(old.s); old.s.material.map.dispose(); old.s.material.dispose();
  }
  const c = document.createElement('canvas'); c.width = 256; c.height = 80;
  const g = c.getContext('2d');
  g.font = '700 42px "Segoe UI", system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 8; g.strokeStyle = 'rgba(10,6,20,0.9)';
  g.strokeText(text, 128, 40);
  g.fillStyle = color; g.fillText(text, 128, 40);
  const m = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false });
  const s = new THREE.Sprite(m);
  s.scale.set(2.6, 0.8, 1);
  s.position.copy(pos);
  scene.add(s);
  floatTexts.push({ s, life: 1.15 });
}
function updateFloatTexts(dt) {
  for (let i = floatTexts.length - 1; i >= 0; i--) {
    const f = floatTexts[i];
    f.life -= dt;
    if (f.life <= 0) {
      scene.remove(f.s); f.s.material.map.dispose(); f.s.material.dispose();
      floatTexts.splice(i, 1); continue;
    }
    f.s.position.y += 1.1 * dt;
    f.s.material.opacity = Math.min(1, f.life * 1.6);
  }
}

// ---- combo: chained cleans inside a 3s window raise the chime pitch
// and pay a small XP bonus ----
let comboCount = 0, comboT = 0;
function registerCombo(pos) {
  comboT = 3;
  comboCount++;
  SFX.chime(1 + 0.08 * Math.min(comboCount - 1, 8));
  if (comboCount >= 2) {
    spawnFloatText(pos.clone().add(new THREE.Vector3(0, 2.6, 0)), 'COMBO x' + comboCount, '#ff8fd0');
    gainXP(5 * Math.min(comboCount - 1, 6)); // bonus, no popup spam
  }
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
    if (this.fired[event]) return;
    this.fired[event] = true;
    switch (event) {
      case 'start':
        this.show(IS_TOUCH
          ? 'A rainbow meteor woke you up, Jax. Use the LEFT STICK to walk into the glowing crater.'
          : 'A rainbow meteor woke you up, Jax. Use WASD to walk into the glowing crater.');
        break;
      case 'hornPickup':
        this.show(IS_TOUCH
          ? 'The Unicorn Horn is yours! HOLD the SPRAY button to fire your power-hose.'
          : 'The Unicorn Horn is yours! HOLD LEFT CLICK to fire your power-hose.');
        break;
      case 'firstSpray':
        this.show('That’s the stuff! Now hose down the glowing poop pile ahead until it bursts into glitter.');
        break;
      case 'pileCleaned':
        this.show(IS_TOUCH
          ? 'Sparkling! Next: tap BEAM for your Magic Beam — a big blast with a short cooldown.'
          : 'Sparkling! Next: RIGHT CLICK (or Q) fires your Magic Beam — a big blast with a short cooldown.');
        break;
      case 'firstBeam':
        this.show('Beautiful. Now listen… groans in the fog. Hose the rainbow slime off the poop zombies to melt them!');
        break;
      case 'zombieDefeated':
        this.show('FABULOUS! Purify the whole bridge: clean every pile and every zombie. Let your ears guide you.', true);
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
const hpFill = document.getElementById('hpFill');
const beamCdFill = document.getElementById('beamCdFill');
const dmgFlashEl = document.getElementById('dmgFlash');
const resumeHint = document.getElementById('resumeHint');

const Game = {
  state: 'menu', // menu | playing | won | dead
  pilesCleaned: 0, zombiesDefeated: 0,
  totalPiles: 0, totalZombies: 0,
  dmgFlash: 0, startTime: 0,
};

function updateObjectiveHUD() {
  document.getElementById('pileCount').textContent = `${Game.pilesCleaned}/${Game.totalPiles}`;
  document.getElementById('zombieCount').textContent = `${Game.zombiesDefeated}/${Game.totalZombies}`;
}

function checkWin() {
  if (Game.state !== 'playing') return;
  if (Game.pilesCleaned >= Game.totalPiles && Game.zombiesDefeated >= Game.totalZombies) {
    Game.state = 'won';
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
      const prev = Number(localStorage.getItem('uj_l1_best')) || Infinity;
      const best = Math.min(prev, secs);
      localStorage.setItem('uj_l1_best', best);
      bestTxt = ` · Best: ${fmt(best)}${secs <= prev ? ' — NEW RECORD!' : ''}`;
    } catch (e) { /* private mode: no persistence */ }
    document.getElementById('winStats').textContent =
      `Cleared in ${fmt(secs)} · HP left: ${Math.max(0, Math.round(Player.hp))} · Level ${RPG.level} · ${RPG.xp} XP${bestTxt}`;
    setTimeout(() => {
      document.getElementById('winOverlay').classList.remove('hidden');
      if (document.exitPointerLock) document.exitPointerLock();
    }, 1400);
    narrate('First Poopocalypse victory! The bridge sparkles again.');
  }
}

function gameOver() {
  Game.state = 'dead';
  SFX.setSpray(false);
  tutorialEl.style.opacity = 0;
  document.getElementById('deadOverlay').classList.remove('hidden');
  if (document.exitPointerLock) document.exitPointerLock();
}

/* =====================================================================
   15. LEVEL LAYOUT + BOOT
   ===================================================================== */
function buildLevel() {
  buildBridge();
  buildCrater();
  buildFogParticles();
  buildPlayer();
  buildHornPickup();
  buildHose();
  buildSplashes();

  // poop piles — the first two are the tutorial targets, right past the crater
  const pileSpots = [
    [2, -12, 1.2], [-4, -22, 1], [3, -34, 1], [-5, -48, 1.1], [0, -60, 1],
    [5, -75, 0.9], [-4, -88, 1.1], [2, -100, 1], [-6, -112, 0.9], [4, -124, 1.2],
  ];
  for (const [x, z, s] of pileSpots) piles.push(new PoopPile(x, z, s));
  Game.totalPiles = piles.length;

  // zombies — the first one waits past the beam tutorial so mechanics land one at a time
  const zombieSpots = [
    [0, -42], [-4, -55], [4, -68], [-3, -70], [-2, -80],
    [5, -92], [-5, -104], [0, -116], [3, -126],
  ];
  for (const [x, z] of zombieSpots) zombies.push(new Zombie(x, z));
  Game.totalZombies = zombies.length;

  updateObjectiveHUD();
}

function startGame() {
  SFX.init();
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

document.getElementById('startBtn').addEventListener('click', startGame);
document.getElementById('againBtn').addEventListener('click', () => location.reload());
document.getElementById('retryBtn').addEventListener('click', () => location.reload());
skillBtn.addEventListener('click', () => toggleSkillPanel());
document.getElementById('skillResume').addEventListener('click', () => toggleSkillPanel(false));
buildSkillPanel();
// clicking back into the game re-locks the pointer on desktop
canvas.addEventListener('click', () => {
  if (Game.state === 'playing' && !IS_TOUCH && !Input.locked) canvas.requestPointerLock();
});

if (IS_TOUCH) setupTouch();
buildLevel();

/* =====================================================================
   16. MAIN LOOP
   ===================================================================== */
// debug/testing hook (also handy in the console: UJ.Diag-style poking)
window.UJ = { Game, Player, Tutorial, piles, zombies, cleanTargets, CFG, Input, renderer, RPG, gainXP, toggleSkillPanel,
  skipIntro: () => { introSkip = true; },
  getCombo: () => comboCount,
  getDying: () => dyingZombies.length };

const clock = new THREE.Clock();
function tick() {
  requestAnimationFrame(tick);
  let dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  // kill slow-motion: world runs at 15% for a beat
  if (hitStop > 0) { hitStop -= dt; dt *= 0.15; }

  updateCrater(dt, t);
  updateFogParticles(dt, t);
  updateGlitter(dt);
  updateSplashes(dt);
  // living emissives: pile glow breathes with its remaining dirt
  for (let i = 0; i < piles.length; i++) {
    const p = piles[i];
    if (!p.alive) continue;
    const f = Math.max(p.dirt, 0) / CFG.pile.dirt;
    p.glow.material.opacity = 0.1 + 0.25 * f + 0.06 * Math.sin(t * 3 + i * 2.1);
  }

  // toast fade (level-ups, unlocks)
  if (toastT > 0) { toastT -= dt; if (toastT <= 0) toastEl.style.opacity = 0; }
  updateDying(dt);
  updateFloatTexts(dt);
  if (comboT > 0) { comboT -= dt; if (comboT <= 0) comboCount = 0; }

  if (Game.state === 'intro') {
    updateIntro(dt);
  } else if (Game.state === 'playing') {
    updatePlayer(dt, t);
    updateHose(dt);
    updateBeam(dt);
    updateNova(dt);
    updatePing(dt);
    for (const z of zombies) z.update(dt, t);
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

  composer.render();
}
tick();

// the shell shows LOADING… until this module is evaluated
const _sb = document.getElementById('startBtn');
_sb.disabled = false;
_sb.textContent = 'WAKE UP, JAX';
