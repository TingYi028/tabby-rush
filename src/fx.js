import * as THREE from 'three';
import { makeTexture } from './assets.js';
import { softDotCanvas, starCanvas, bubbleCanvas, isCoarsePointer, makeCanvas } from './textures.js';
import { rand } from './config.js';
import { FXP } from './settings.js';
import { spriteCanvas, TRAIL_TEXT } from './cosmetic-art.js';
import { Companions, Ghosts } from './companions.js';

// ATLAS variant (trail sprites with several pictures): the texture is a row of `uCells` cells, `cell` picks one and the
// sprite turns by `spin.y + spin.x * uTime` radians (a point sprite cannot rotate on its own)
const VERT = /* glsl */`
attribute float size;
attribute float alpha;
attribute vec3 pcolor;
uniform float uScale;
uniform float uMaxPx;
varying float vAlpha;
varying vec3 vColor;
#ifdef ATLAS
attribute float cell;
attribute vec2 spin;
uniform float uTime;
varying float vCell;
varying float vRot;
#endif
void main() {
  vAlpha = alpha;
  vColor = pcolor;
#ifdef ATLAS
  vCell = cell;
  vRot = spin.y + spin.x * uTime;
#endif
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = min(size * uScale / max(0.1, -mv.z), uMaxPx); // nothing balloons as it passes the camera
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */`
uniform sampler2D uMap;
varying float vAlpha;
varying vec3 vColor;
#ifdef ATLAS
uniform float uCells;
varying float vCell;
varying float vRot;
#endif
void main() {
#ifdef ATLAS
  vec2 pc = gl_PointCoord - 0.5;
  float cs = cos(vRot), sn = sin(vRot);
  pc = vec2(cs * pc.x - sn * pc.y, sn * pc.x + cs * pc.y) + 0.5;
  if (pc.x < 0.0 || pc.x > 1.0 || pc.y < 0.0 || pc.y > 1.0) discard;
  vec4 t = texture2D(uMap, vec2((pc.x + vCell) / uCells, 1.0 - pc.y));
#else
  vec4 t = texture2D(uMap, gl_PointCoord);
#endif
  float a = t.a * vAlpha;
  if (a < 0.003) discard;
  gl_FragColor = vec4(vColor * t.rgb, a);
}`;

/**
 * Fixed-capacity point sprites in one draw call. A ring cursor hands out slots (a full pool recycles the oldest), and
 * `live` lists the slots in use, so update() costs the live particles, not the capacity. `cells` > 1: the texture is a row of
 * that many pictures and emit() takes the picture index (and a spin) as its last arguments.
 */
export class ParticleSystem {
  constructor(parent, max, texture, blending, maxPx = 0.16, cells = 0) {
    this.max = max;
    this.maxPx = maxPx;  // largest sprite, as a fraction of the drawing-buffer height
    this.gain = () => 1; // colour multiplier at emit time (additive sparkles follow the effects setting)
    this.cursor = 0;
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('pcolor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo = geo;
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max).fill(1);
    this.s0 = new Float32Array(max);
    this.s1 = new Float32Array(max);
    this.a0 = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.live = new Uint16Array(max);   // slots in use, each at most once (`on` flags them)
    this.on = new Uint8Array(max);
    this.nLive = 0;
    this.lastHi = 0;
    this.visits = 0;                    // debug: live slots updated by the last update()
    this.died = 0;                      // debug: slots that expired in it (zeroed there, then dropped from the list)
    this.dyn = [geo.attributes.position, geo.attributes.size, geo.attributes.alpha]; // re-uploaded every frame
    this.ranges = this.dyn.map(() => ({ start: 0, count: 0 }));
    const uniforms = { uMap: { value: texture }, uScale: { value: 400 }, uMaxPx: { value: 160 } };
    this.cell = this.spin = null;
    if (cells > 1) {   // picture index and spin per particle: written at emit, uploaded with the colours
      this.cell = new Float32Array(max);
      this.spin = new Float32Array(max * 2);
      geo.setAttribute('cell', new THREE.BufferAttribute(this.cell, 1).setUsage(THREE.DynamicDrawUsage));
      geo.setAttribute('spin', new THREE.BufferAttribute(this.spin, 2).setUsage(THREE.DynamicDrawUsage));
      uniforms.uCells = { value: cells };
      uniforms.uTime = { value: 0 };
    }
    this.material = new THREE.ShaderMaterial({
      uniforms,
      defines: cells > 1 ? { ATLAS: 1 } : {},
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    parent.add(this.points);
  }

  /** Pixel cap and scale (pixels per world unit at distance 1) for a drawing buffer `h` px tall. */
  setScale(s, h) {
    const u = this.material.uniforms;
    u.uScale.value = s;
    u.uMaxPx.value = Math.max(24, h * this.maxPx);
  }

  emit(x, y, z, vx, vy, vz, life, s0, s1, color, a0 = 1, grav = 0, drag = 0, cell = 0, spinRate = 0, spinPhase = 0) {
    const i = this.cursor;
    this.cursor = (i + 1) % this.max;
    if (!this.on[i]) { this.on[i] = 1; this.live[this.nLive++] = i; }
    const i3 = i * 3;
    this.pos[i3] = x; this.pos[i3 + 1] = y; this.pos[i3 + 2] = z;
    this.vel[i3] = vx; this.vel[i3 + 1] = vy; this.vel[i3 + 2] = vz;
    const g = this.gain();
    this.col[i3] = color.r * g; this.col[i3 + 1] = color.g * g; this.col[i3 + 2] = color.b * g;
    this.colDirty = true;
    this.life[i] = this.maxLife[i] = life;
    this.s0[i] = s0; this.s1[i] = s1; this.a0[i] = a0;
    this.grav[i] = grav; this.drag[i] = drag;
    if (this.cell) { this.cell[i] = cell; this.spin[i * 2] = spinRate; this.spin[i * 2 + 1] = spinPhase; }
  }

  update(dt) {
    if (this.cell) this.material.uniforms.uTime.value += dt;
    const live = this.live, life = this.life, vel = this.vel, pos = this.pos, size = this.size, alpha = this.alpha;
    let n = this.nLive, hi = 0, died = 0;
    for (let k = 0; k < n;) {
      const i = live[k];
      if (i >= hi) hi = i + 1;
      life[i] -= dt;
      if (life[i] <= 0) {   // expired: its alpha has reached 0 anyway, so zero it here and drop it from the list
        alpha[i] = 0; size[i] = 0; this.on[i] = 0;
        live[k] = live[--n];
        died++;
        continue;
      }
      const t = 1 - life[i] / this.maxLife[i];
      const i3 = i * 3;
      const d = Math.exp(-this.drag[i] * dt);
      vel[i3] *= d; vel[i3 + 1] = vel[i3 + 1] * d - this.grav[i] * dt; vel[i3 + 2] *= d;
      pos[i3] += vel[i3] * dt;
      pos[i3 + 1] += vel[i3 + 1] * dt;
      pos[i3 + 2] += vel[i3 + 2] * dt;
      size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * t;
      alpha[i] = this.a0[i] * (t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85);
      k++;
    }
    this.nLive = n;
    this.visits = n;
    this.died = died;
    // upload only the slots that can hold a particle (plus the ones zeroed since last frame); colours only after emits
    const top = Math.max(hi, this.lastHi);
    this.lastHi = hi;
    this.geo.setDrawRange(0, hi);
    if (!top) return;
    for (let j = 0; j < this.dyn.length; j++) {
      const at = this.dyn[j], r = this.ranges[j];
      r.count = top * at.itemSize;
      at.clearUpdateRanges();
      at.updateRanges.push(r);   // addUpdateRange(0, count) without the object it allocates per call
      at.needsUpdate = true;
    }
    if (this.colDirty) {
      this.colDirty = false;
      this.geo.attributes.pcolor.needsUpdate = true;
      if (this.cell) { this.geo.attributes.cell.needsUpdate = true; this.geo.attributes.spin.needsUpdate = true; }
    }
  }

  clear() {
    for (let k = 0; k < this.nLive; k++) {
      const i = this.live[k];
      this.life[i] = 0; this.alpha[i] = 0; this.size[i] = 0; this.on[i] = 0;
    }
    this.nLive = 0;
  }
}

const COL = {
  gold: new THREE.Color(1.6, 1.2, 0.35),
  white: new THREE.Color(1.6, 1.6, 1.5),
  dust: new THREE.Color('#e3d1b2'),
  dustDark: new THREE.Color('#b9a284'),
  green: new THREE.Color(0.6, 1.8, 0.4),
  blue: new THREE.Color(0.5, 1.3, 2.0),
  red: new THREE.Color(2.0, 0.6, 0.5),
  yellow: new THREE.Color(2.0, 1.6, 0.4),
};
export const FX_COLORS = COL;

/**
 * Cosmetic trails (cosmetics.js) use their own generator, never Math.random: a seeded daily track must not be able to
 * notice what the player wears.
 */
let cseed = (Date.now() ^ 0x9e3779b9) >>> 0 || 1;
function crand() {
  cseed = (cseed + 0x6d2b79f5) >>> 0;
  let t = cseed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const cr = (a, b) => a + crand() * (b - a);

const TC = {
  plain: new THREE.Color(1, 1, 1),
  flameA: new THREE.Color(1.3, 0.75, 0.2),
  flameB: new THREE.Color(1.1, 0.35, 0.12),
  smoke: new THREE.Color('#3a3040'),
  pearl: new THREE.Color('#4b2a17'),
  spectrum: ['#ff4d4d', '#ff9a2a', '#ffe14a', '#5be37d', '#4db8ff', '#b06cff'].map((c) => new THREE.Color(c).multiplyScalar(1.25)),
  lavender: new THREE.Color('#b9a6ff'),
  party: ['#ff5a5f', '#ffb02e', '#ffe14a', '#4cd98a', '#4db8ff', '#c47bff'].map((c) => new THREE.Color(c)),
  spark: ['#ff5a5f', '#ffb02e', '#ffe14a', '#4cd98a', '#4db8ff', '#c47bff'].map((c) => new THREE.Color(c).multiplyScalar(1.6)),
  stardust: [new THREE.Color(0.8, 1.0, 1.9), new THREE.Color(1.8, 1.65, 1.1), new THREE.Color(1.4, 1.0, 1.9)],
  galaxy: [new THREE.Color(0.5, 1.5, 2.0), new THREE.Color(2.0, 0.55, 1.7), new THREE.Color(1.8, 1.7, 1.3), new THREE.Color(1.1, 0.8, 2.0)],
};
const DUST_GAP = 0.09;   // seconds between dust puffs on phones
const TRAIL_RATE = { coin: 15, bubble: 18, bone: 6, fire: 55, rainbow: 26, star: 34, galaxy: 70, heart: 14, zzz: 6, confetti: 30, danmaku: 5, merit: 2.2 };
/**
 * Trails that draw several pictures from one texture: the pictures (cosmetic-art.js spriteCanvas names, left to right in
 * the atlas) and the particle pool size (rate x life, plus slack). heart / zzz / ribbon / confetti are drawn white where
 * fx.js tints them; the text tokens and rings keep their own colours.
 */
const TRAIL_ATLAS = {
  heart: { cells: ['heart', 'fheart'], max: 24 },
  confetti: { cells: ['ribbon', 'confetti'], max: 48 },
  danmaku: { cells: TRAIL_TEXT.danmaku.map((w) => `text:${w}`), max: 12 },
  merit: { cells: [`text:${TRAIL_TEXT.merit}`, 'ring'], max: 16 },
};
const ZZZ_SIZE = [0.3, 0.45, 0.62];

/* ---------- shop crash effects (kind `crash`) and coin faces (kind `coin`) ---------- */

const CRASH_KINDS = ['stars', 'confetti', 'pixel', 'firework', 'bang'];
/** `crash_stars` | `stars` -> 'stars'; anything unknown -> '' (no extra effect). */
const crashKind = (id) => { const k = String(id || '').replace(/^crash_/, ''); return CRASH_KINDS.includes(k) ? k : ''; };
/** Particles of today's crash (26 dust puffs + the burst); an extra effect adds at most half of it (S-A7: <= 1.5x). */
const crashBase = () => 26 + Math.max(4, Math.round(20 * FXP.particles));
const CRASH_POOL = { pixel: 24, bang: 2 };
const TABBY = ['#e59a45', '#f4c47e', '#fff1d6', '#5a3b24', '#2e2018'].map((c) => new THREE.Color(c));   // the hero's palette
const SHELL_AT = 0.3;   // seconds between the two firework shells

// The art module of the shop effects (collect-art.js: crashSprite(kind) -> canvas | null, coinFace(id) -> canvas | [canvas] | null)
// is loaded the first time a non-default crash effect or coin face is equipped; without it the built-in pictures stand in.
let ART = null, ARTP = null;
function loadArt() {
  if (!ARTP) ARTP = import('./collect-art.js').then((m) => { ART = m; }, () => { /* not shipped yet: built-in pictures */ });
  return ARTP;
}

/** Built-in picture of a pixel block (tinted per particle) and of the comic 「碰！」 burst, for when the art module has none. */
function pixelCanvas() {
  const c = makeCanvas(8, 8), g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, 8, 8);
  g.fillStyle = 'rgba(60,40,30,0.35)'; g.fillRect(0, 7, 8, 1); g.fillRect(7, 0, 1, 8);
  return c;
}
function bangCanvas() {
  const c = makeCanvas(128, 128), g = c.getContext('2d');
  g.beginPath();
  for (let i = 0; i < 16; i++) {
    const a = (i * Math.PI) / 8, r = i & 1 ? 38 : 62;
    g[i ? 'lineTo' : 'moveTo'](64 + Math.cos(a) * r, 64 + Math.sin(a) * r);
  }
  g.closePath();
  g.fillStyle = '#ffd23f'; g.fill(); g.lineWidth = 6; g.lineJoin = 'round'; g.strokeStyle = '#2a2233'; g.stroke();
  g.font = '900 54px "Noto Sans TC", "Microsoft JhengHei", "PingFang TC", sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 8; g.strokeStyle = '#fff'; g.strokeText('碰！', 64, 68);
  g.fillStyle = '#e0352b'; g.fillText('碰！', 64, 68);
  return c;
}

/** 虎斑腳印: a few paw decals on the ground, one draw call, fading with the distance run since they were stamped. */
class PawDecals {
  constructor(root) {
    this.N = 8;
    const N = this.N;
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(N * 12);
    this.col = new Float32Array(N * 16);
    const uv = new Float32Array(N * 8), idx = new Uint16Array(N * 6);
    for (let i = 0; i < N; i++) {
      uv.set([0, 0, 1, 0, 1, 1, 0, 1], i * 8);
      idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
      for (let k = 0; k < 4; k++) this.col.set([1, 1, 1, 0], (i * 4 + k) * 4);
    }
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    this.geo = geo;
    this.at = new Float32Array(N).fill(-1e9);   // track distance each paw was stamped at
    this.cursor = 0;
    this.last = -1e9;
    this.side = 1;
    this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      map: makeTexture(spriteCanvas('paw')), transparent: true, vertexColors: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -3,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    root.add(this.mesh);
  }

  /** Stamp one every 2.5 m while the hero runs on something, and fade the older ones. */
  step(dist, p) {
    if (dist < this.last) this.last = dist - 2.5;   // a new run started
    if (dist - this.last >= 2.5 && p.onGround && !p.crashed && p.y < 6) {
      this.last = dist;
      this.side = -this.side;
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.N;
      this.at[i] = dist;
      const cx = p.x + this.side * 0.3, cy = p.y + 0.035, cz = -dist + 0.1, w = 0.24, h = 0.3, a = this.pos, o = i * 12;
      a[o] = cx - w; a[o + 1] = cy; a[o + 2] = cz + h;
      a[o + 3] = cx + w; a[o + 4] = cy; a[o + 5] = cz + h;
      a[o + 6] = cx + w; a[o + 7] = cy; a[o + 8] = cz - h;
      a[o + 9] = cx - w; a[o + 10] = cy; a[o + 11] = cz - h;
      this.geo.attributes.position.needsUpdate = true;
    }
    // fade by distance behind the hero: the camera sits ~7 m back, so a print is out of sight after that
    const c = this.col;
    for (let i = 0; i < this.N; i++) {
      const m = dist - this.at[i], al = m < 0 || m > 9 ? 0 : 0.7 * (1 - m / 9), o = i * 16;
      c[o + 3] = c[o + 7] = c[o + 11] = c[o + 15] = al;
    }
    this.geo.attributes.color.needsUpdate = true;
  }

  clear() {
    this.at.fill(-1e9);
    this.last = -1e9;
    for (let i = 0; i < this.N; i++) { const o = i * 16; this.col[o + 3] = this.col[o + 7] = this.col[o + 11] = this.col[o + 15] = 0; }
    this.geo.attributes.color.needsUpdate = true;
  }
}

/** Particles live inside the moving world group, so dust stays put on the ground behind the hero. */
export class FX {
  constructor(worldRoot) {
    this.coarse = isCoarsePointer();
    this.add = new ParticleSystem(worldRoot, 700, makeTexture(starCanvas()), THREE.AdditiveBlending);
    this.add.gain = () => FXP.glow;
    // dust / smoke puffs are alpha-blended full squares: half the size cap on phones (their fill rate is the limit)
    this.soft = new ParticleSystem(worldRoot, 500, makeTexture(softDotCanvas()), THREE.NormalBlending, this.coarse ? 0.08 : 0.16);
    this.root = worldRoot;
    this.clock = 0;       // simulated seconds (fx.update), the time base of the dust limiter
    this.dustAt = 0;
    this.systems = [this.add, this.soft];
    this.scale = { s: 400, h: 1000 };
    // shop cosmetics (cosmetics.js): companion sprite, afterimages, trail state
    this.companions = new Companions();
    this.ghosts = new Ghosts();
    this.sprites = {};
    this.paws = null;
    this.trailId = '';
    this.tacc = 0;
    this.tclock = 0;
    this.tn = 0;          // emitted count of the current trail (every 8th heart is a finger heart, danmaku alternate sides)
    this.crashK = '';     // equipped crash effect ('' = today's crash only)
    this.orb = { n: 0, t: 0, x: 0, y: 0, z: 0, sys: null, slot: new Int16Array(5) };   // crash_stars: the ring of stars
    this.fw = { n: 0, t: 0, k: 0, x: 0, y: 0, z: 0 };                                 // crash_firework: the shell still to go off
    this.coinId = '';
    this.coinTarget = null;
  }
  /** `s`: pixels per world unit at distance 1; `h`: drawing-buffer height (caps a particle at 16% of it, dust on phones 8%). */
  setScale(s, h = 1000) {
    this.scale.s = s;
    this.scale.h = h;
    for (let i = 0; i < this.systems.length; i++) this.systems[i].setScale(s, h);
  }
  update(dt) {
    this.clock += dt;
    if (this.orb.n) this.turnStars(dt);
    if (this.fw.n) this.nextShell(dt);
    for (let i = 0; i < this.systems.length; i++) this.systems[i].update(dt);
  }
  clear() {
    this.orb.n = this.fw.n = 0;
    for (let i = 0; i < this.systems.length; i++) this.systems[i].clear();
    if (this.paws) this.paws.clear();
  }

  // All positions below are in world-root local space: (x, y, -s).
  // Effect counts and sizes scale with the effects setting (FXP.particles: 0.45 low .. 1 high).
  coin(x, y, z) {
    const n = Math.max(3, Math.round(8 * FXP.particles)), k = 0.6 + 0.4 * FXP.particles;
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2), sp = rand(2.5, 5.5);
      this.add.emit(x, y, z, Math.cos(a) * sp, Math.sin(a) * sp + 1.5, rand(-1, 1), rand(0.28, 0.45), rand(0.55, 0.85) * k, 0.05,
        i % 3 ? COL.gold : COL.white, 0.6 + 0.4 * FXP.particles, 4, 3);
    }
  }
  dust(x, y, z, big = 1) {
    if (this.coarse) {   // phones: one puff per DUST_GAP at most (~11 / s), however often the run loop asks
      if (this.clock < this.dustAt) return;
      this.dustAt = Math.max(this.dustAt + DUST_GAP, this.clock + DUST_GAP / 2);
    }
    this.soft.emit(x + rand(-0.25, 0.25), y + 0.08, z + rand(-0.2, 0.2), rand(-0.6, 0.6), rand(0.4, 1.1), rand(0.2, 1.2),
      rand(0.45, 0.7), 0.45 * big, 1.0 * big, Math.random() < 0.5 ? COL.dust : COL.dustDark, 0.42, -0.4, 1.5);
  }
  land(x, y, z, count = 12) {
    const n = Math.max(1, Math.round(count));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      this.soft.emit(x + Math.cos(a) * 0.3, y + 0.1, z + Math.sin(a) * 0.3, Math.cos(a) * 3.2, rand(0.3, 1), Math.sin(a) * 3.2,
        rand(0.4, 0.6), 0.5, 1.7, COL.dust, 0.5, 0, 3);
    }
  }
  burst(x, y, z, color, n = 26, speed = 7) {
    n = Math.max(4, Math.round(n * FXP.particles));
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2), b = rand(-0.6, 1.2), sp = rand(speed * 0.5, speed);
      this.add.emit(x, y, z, Math.cos(a) * sp, b * sp * 0.6 + 2, Math.sin(a) * sp, rand(0.45, 0.8), rand(0.6, 1.1), 0.05,
        Math.random() < 0.3 ? COL.white : color, 1, 6, 2.5);
    }
  }
  crash(x, y, z) {
    for (let i = 0; i < 26; i++) {
      this.soft.emit(x + rand(-0.6, 0.6), y + rand(0.2, 1.6), z + rand(-0.3, 0.3), rand(-4, 4), rand(1, 5), rand(-1, 4),
        rand(0.6, 1.0), 0.8, 2.6, i % 2 ? COL.dust : COL.dustDark, 0.65, 2, 2.2);
    }
    this.burst(x, y + 1.4, z, COL.yellow, 20, 8);
    if (this.crashK) this.crashFx(this.crashK, x, y, z);
  }
  trail(x, y, z, color) {
    if (Math.random() > FXP.particles) return;
    this.add.emit(x + rand(-0.3, 0.3), y + rand(0, 0.4), z + rand(-0.2, 0.2), rand(-0.4, 0.4), rand(-0.2, 0.6), rand(1, 3),
      rand(0.3, 0.5), rand(0.4, 0.7), 0.05, color, 0.9, 0, 1);
  }

  /* ---------- shop crash effects and coin faces (cosmetics.js kinds `crash`, `coin`) ---------- */

  /**
   * Equip crash effect `id` (`crash_<kind>` or `<kind>`: stars | confetti | pixel | firework | bang; '' or unknown = none).
   * fx.crash() adds it on top of today's burst. Returns a promise that settles once its picture is ready (the pictures are
   * made here, never mid-crash, like the trail sprites).
   */
  setCrash(id) {
    const k = this.crashK = crashKind(id);
    this.orb.n = this.fw.n = 0;
    if (!k) return Promise.resolve();
    const prep = () => { if (this.crashK === k) this.crashSys(k); };
    if (k === 'stars' || k === 'pixel' || k === 'bang') return loadArt().then(prep);
    prep();
    return Promise.resolve();
  }

  /** Particle system that draws crash effect `kind`: a shared one, or one with its own picture (created once). */
  crashSys(kind) {
    if (kind === 'confetti') return this.atlas('confetti');
    if (kind === 'firework') return this.add;
    const key = `crash_${kind}`;
    if (this.sprites[key]) return this.sprites[key];
    let cv = ART && ART.crashSprite ? ART.crashSprite(kind) : null;
    if (!cv && kind === 'pixel') cv = pixelCanvas();
    if (!cv && kind === 'bang') cv = bangCanvas();
    if (!cv) return this.add;   // stars without art: the additive sparkle
    const tex = makeTexture(cv);
    if (kind === 'pixel') {   // hard-edged blocks
      tex.generateMipmaps = false;
      tex.minFilter = tex.magFilter = THREE.NearestFilter;
    }
    const p = this.sprites[key] = new ParticleSystem(this.root, CRASH_POOL[kind] || 12, tex, THREE.NormalBlending);
    p.setScale(this.scale.s, this.scale.h);
    this.systems.push(p);
    return p;
  }

  /**
   * The extra crash effect `kind` at the crash point; returns the particles it emitted (at most half of today's crash:
   * 26 dust puffs + the burst, so the whole crash stays <= 1.5x). Counts follow the effects setting; 減少閃爍 (FXP.calm)
   * holds the stars still and fires one firework shell. Uses `crand`, never Math.random.
   */
  crashFx(kind, x, y, z) {
    const k = crashKind(kind);
    if (!k) return 0;
    const cap = crashBase() >> 1, per = (base) => Math.min(cap, Math.max(3, Math.round(base * FXP.particles)));
    switch (k) {
      case 'stars': {   // five stars circling the head for 0.8 s
        const s = this.crashSys('stars'), o = this.orb, tint = s === this.add ? COL.yellow : TC.plain;
        o.sys = s; o.n = 5; o.t = 0; o.x = x; o.y = y + 1.95; o.z = z;
        for (let i = 0; i < 5; i++) {
          o.slot[i] = s.cursor;
          s.emit(x, o.y, z, 0, 0, 0, 0.8, 0.55, 0.45, tint, 0.95, 0, 0);
        }
        this.turnStars(0);
        return 5;
      }
      case 'confetti': {
        const n = per(18), s = this.crashSys('confetti');
        for (let i = 0; i < n; i++) {
          const rib = crand() < 0.5;
          s.emit(x + cr(-0.5, 0.5), y + cr(1, 1.8), z + cr(-0.2, 0.2), cr(-4, 4), cr(3, 6.5), cr(-2.5, 3),
            cr(0.65, 0.8), rib ? 0.55 : 0.36, rib ? 0.5 : 0.3, TC.party[(crand() * 6) | 0], 1, 9, 0.6, rib ? 0 : 1, cr(-9, 9), cr(0, 6.28));
        }
        return n;
      }
      case 'pixel': {   // square blocks in the hero's palette
        const n = per(18), s = this.crashSys('pixel');
        for (let i = 0; i < n; i++) {
          s.emit(x + cr(-0.4, 0.4), y + cr(0.4, 1.8), z + cr(-0.2, 0.2), cr(-4.5, 4.5), cr(1.5, 6), cr(-3, 4),
            cr(0.55, 0.8), 0.3, 0.22, TABBY[(crand() * TABBY.length) | 0], 1, 14, 0.5);
        }
        return n;
      }
      case 'firework': {   // two shells above the crash point (calm: one), no screen flash
        const n = per(8), shells = FXP.calm ? 1 : 2, f = this.fw;
        f.n = shells - 1; f.t = SHELL_AT; f.k = n; f.x = x + 1.2; f.y = y + 3.8; f.z = z - 1;
        this.shell(x, y + 3.2, z, 0);
        return n * shells;
      }
      default: {   // bang: the comic 「碰！」 pops above the hero for 0.6 s (calm: no growing)
        const s = this.crashSys('bang');
        s.emit(x, y + 2.2, z + 0.6, 0, 0.5, 0, 0.6, FXP.calm ? 1.7 : 0.9, 1.9, TC.plain, 1, 0, 2);
        return 1;
      }
    }
  }

  /** crash_stars: put the five stars on their ring (turning unless calm) before the systems integrate this frame. */
  turnStars(dt) {
    const o = this.orb, s = o.sys, pos = s.pos;
    o.t += dt;
    if (o.t >= 0.8) { o.n = 0; return; }
    const turn = FXP.calm ? 0 : o.t * 9;
    for (let k = 0; k < 5; k++) {
      const slot = o.slot[k], a = (k / 5) * 6.2832 + turn, i3 = slot * 3;
      if (!s.on[slot]) continue;
      pos[i3] = o.x + Math.cos(a) * 0.7;
      pos[i3 + 1] = o.y + (FXP.calm ? 0 : Math.sin(a * 2) * 0.08);
      pos[i3 + 2] = o.z + Math.sin(a) * 0.45;
    }
  }

  /** crash_firework: fire the second shell SHELL_AT seconds after the first. */
  nextShell(dt) {
    const f = this.fw;
    f.t -= dt;
    if (f.t > 0) return;
    f.n = 0;
    this.shell(f.x, f.y, f.z, 3);
  }

  /** One firework shell: `this.fw.k` sparks flying out in a flat ring-ish ball, falling; without calm every other one hangs a little longer as glitter. */
  shell(x, y, z, hue) {
    const n = this.fw.k, c = TC.spark[hue % 6], a0 = crand() * 6.28;
    for (let i = 0; i < n; i++) {
      const a = a0 + (i / n) * 6.2832, sp = cr(2.4, 3.4), glitter = !FXP.calm && (i & 1);
      this.add.emit(x, y, z, Math.cos(a) * sp, cr(-0.4, 1) * sp * 0.5 + 0.4, Math.sin(a) * sp * 0.6,
        glitter ? 0.95 : 0.75, glitter ? 0.3 : 0.5, 0.1, c, 1, 3.5, 1.2);
    }
  }

  /** The coin renderer (objects.js Coins) the equipped coin face is put on. */
  bindCoins(coins) {
    this.coinTarget = coins;
    this.applyCoinFace();
  }

  /** Equip coin face `id` (cosmetics.js `coin_<name>`; '' = the normal coin). Missing art = the normal coin. */
  setCoinFace(id) {
    this.coinId = id || '';
    return this.applyCoinFace();
  }

  applyCoinFace() {
    const coins = this.coinTarget, id = this.coinId;
    if (!coins) return Promise.resolve();
    if (!id) { if (coins.frames.length) coins.setFace(null); return Promise.resolve(); }
    return loadArt().then(() => {
      if (this.coinTarget === coins && this.coinId === id) coins.setFace(ART && ART.coinFace ? ART.coinFace(id) : null);
    });
  }

  /* ---------- shop trails (cosmetics.js) ---------- */

  /** Textured particle system of `name` ('coin' | 'bone' | 'bubble' | 'zzz'), created on first use (when a trail is equipped, never mid-run). */
  sprite(name) {
    let p = this.sprites[name];
    if (!p) {
      const tex = makeTexture(name === 'bubble' ? bubbleCanvas() : spriteCanvas(name));
      p = this.sprites[name] = new ParticleSystem(this.root, name === 'bubble' ? 40 : 60, tex, THREE.NormalBlending);
      p.setScale(this.scale.s, this.scale.h);
      this.systems.push(p);
    }
    return p;
  }

  /** Several-picture particle system of trail `name` (TRAIL_ATLAS), created on first use like sprite(). */
  atlas(name) {
    let p = this.sprites[name];
    if (!p) {
      const def = TRAIL_ATLAS[name], parts = def.cells.map(spriteCanvas), cell = Math.max(...parts.map((c) => c.width));
      const c = makeCanvas(cell * parts.length, cell), g = c.getContext('2d');
      parts.forEach((s, i) => g.drawImage(s, i * cell, 0, cell, cell));
      const tex = makeTexture(c);
      tex.generateMipmaps = false;   // the mip chain would blend neighbouring cells
      tex.minFilter = THREE.LinearFilter;
      p = this.sprites[name] = new ParticleSystem(this.root, def.max, tex, THREE.NormalBlending, 0.16, parts.length);
      p.setScale(this.scale.s, this.scale.h);
      this.systems.push(p);
    }
    return p;
  }

  /**
   * Equip trail `id` ('' = none): 'paw' | 'coin' | 'bubble' | 'bone' | 'fire' | 'rainbow' | 'star' | 'galaxy' | 'ghost' |
   * 'heart' | 'zzz' | 'confetti' | 'danmaku' | 'merit'.
   */
  setTrail(id) {
    this.trailId = id || '';
    this.tacc = 0;
    this.tn = 0;
    this.ghosts.setActive(id === 'ghost');
    if (id === 'coin' || id === 'bone' || id === 'bubble' || id === 'zzz') this.sprite(id);
    else if (TRAIL_ATLAS[id]) this.atlas(id);
    if (id === 'paw' && !this.paws) this.paws = new PawDecals(this.root);
    if (this.paws) this.paws.mesh.visible = id === 'paw';
  }

  /**
   * Per frame while a trail is equipped: `p` is the player, `dist` the run distance, `speed` the run speed.
   * Emission rates scale with the effects setting (FXP.particles); nothing here flickers.
   */
  cosTrail(dt, p, dist, speed) {
    const id = this.trailId;
    if (!id || id === 'ghost' || p.crashed) return;
    const x = p.x, y = p.y, z = -dist + 0.25;
    this.tclock += dt;
    if (id === 'paw') { if (this.paws) this.paws.step(dist, p); return; }
    this.tacc = Math.min(this.tacc + dt * (TRAIL_RATE[id] || 0) * FXP.particles, 6);
    const sp = Math.max(6, speed) * 0.14;       // streams lean back with the run speed
    for (; this.tacc >= 1; this.tacc -= 1) {
      switch (id) {
        case 'coin':
          this.sprite('coin').emit(x + cr(-0.45, 0.45), y + cr(1.3, 2.2), z + cr(0, 0.5), cr(-0.5, 0.5), cr(0.4, 1.2), cr(0.6, 1.6),
            0.5, 0.5, 0.42, TC.plain, 1, 12, 0.3);
          break;
        case 'bubble':
          if (crand() < 0.55) {
            this.sprite('bubble').emit(x + cr(-0.4, 0.4), y + cr(0.3, 1.5), z + cr(0, 0.5), cr(-0.4, 0.4), cr(0.8, 1.8), cr(1.5, 3),
              0.45, 0.4, 0.8, TC.plain, 0.95, 0, 0.8);
          } else {
            this.soft.emit(x + cr(-0.3, 0.3), y + cr(0.15, 0.5), z + cr(0, 0.4), cr(-0.6, 0.6), cr(1.5, 3), cr(1.5, 3),
              0.4, 0.28, 0.26, TC.pearl, 0.95, 10, 0.5);
          }
          break;
        case 'bone':
          this.sprite('bone').emit(x + cr(-0.3, 0.3), y + cr(0.7, 1.3), z, cr(-1, 1), cr(1.5, 3), cr(3, 5.5),
            0.45, 0.55, 0.5, TC.plain, 1, 11, 0.2);
          break;
        case 'fire':
          this.add.emit(x + cr(-0.25, 0.25), y + cr(0.05, 0.3), z + cr(0, 0.3), cr(-0.4, 0.4), cr(0.8, 2.6), sp * cr(0.5, 1),
            cr(0.2, 0.34), cr(0.5, 0.75), 0.06, crand() < 0.5 ? TC.flameA : TC.flameB, 0.9, 0, 1.5);
          if (crand() < 0.16) {
            this.soft.emit(x + cr(-0.2, 0.2), y + cr(0.3, 0.6), z + cr(0, 0.3), cr(-0.4, 0.4), cr(0.6, 1.4), sp,
              0.4, 0.35, 1.0, TC.smoke, 0.3, -0.3, 1.2);
          }
          break;
        case 'rainbow':
          // a ribbon of six colour bands stacked from the hero's hips to shoulders (one burst per tick)
          for (let b = 0; b < 6; b++) {
            this.add.emit(x + cr(-0.05, 0.05), y + 0.35 + b * 0.17, z, 0, 0, sp * 0.8, 0.38, 0.5, 0.42, TC.spectrum[b], 0.85, 0, 0);
          }
          this.tacc -= 0.2;    // 6 particles per tick: keep the budget
          break;
        case 'star':
          this.add.emit(x + cr(-0.7, 0.7), y + cr(0.2, 1.9), z + cr(0, 0.5), cr(-0.3, 0.3), cr(-0.1, 0.5), cr(0.5, 2.5),
            cr(0.35, 0.6), cr(0.3, 0.55), 0.05, TC.stardust[(crand() * 3) | 0], 0.9, 0, 0.8);
          break;
        case 'galaxy': {
          const a = this.tclock * 7 + crand() * 6.28, r = cr(0.25, 0.95);
          this.add.emit(x + Math.cos(a) * r, y + 0.95 + Math.sin(a) * r * 1.15, z + cr(0, 0.3), Math.cos(a) * 0.5, Math.sin(a) * 0.5, sp * cr(0.6, 1.1),
            cr(0.3, 0.5), cr(0.3, 0.55), 0.05, TC.galaxy[(crand() * 4) | 0], 0.9, 0, 1);
          break;
        }
        case 'heart': {
          const fh = ++this.tn % 8 === 0;   // every 8th is a finger heart
          this.atlas('heart').emit(x + cr(-0.5, 0.5), y + cr(0.9, 1.9), z + cr(0, 0.5), cr(-0.4, 0.4), cr(0.7, 1.4), sp * cr(0.4, 0.8),
            0.8, fh ? 0.7 : 0.45, fh ? 0.6 : 0.35, TC.plain, 0.95, -0.4, 0.8, fh ? 1 : 0);
          break;
        }
        case 'zzz': {
          const k = ZZZ_SIZE[(crand() * 3) | 0];   // three sizes, slowly rising and leaning back
          this.sprite('zzz').emit(x + cr(-0.3, 0.3), y + cr(1.6, 2.1), z + cr(0, 0.3), cr(-0.2, 0.2), cr(0.5, 0.9), sp * cr(0.5, 0.8),
            1.1, k, k * 1.25, TC.lavender, 0.9, -0.2, 0.6);
          break;
        }
        case 'confetti': {
          const rib = crand() < 0.5;   // curling ribbon strip or square confetti, turning in the air
          this.atlas('confetti').emit(x + cr(-0.5, 0.5), y + cr(0.6, 1.8), z + cr(-0.2, 0.4), cr(-1.6, 1.6), cr(1.5, 3.2), sp * cr(0.3, 1),
            0.85, rib ? 0.55 : 0.36, rib ? 0.5 : 0.3, TC.party[(crand() * 6) | 0], 1, 9, 0.7, rib ? 0 : 1, cr(-9, 9), cr(0, 6.28));
          break;
        }
        case 'danmaku': {
          // comments in two lanes beside the hero (never over it), starting just ahead and sliding back at 0.6x the run speed
          const side = ++this.tn & 1 ? 1 : -1, high = crand() < 0.5;
          this.atlas('danmaku').emit(x + side * cr(1.5, 2.2), y + (high ? 2.2 : 1.35) + cr(-0.1, 0.1), z - cr(1.5, 4), 0, 0, -speed * 0.4,
            0.5, 0.95, 0.95, TC.plain, 1, 0, 0, (crand() * TRAIL_TEXT.danmaku.length) | 0);
          break;
        }
        case 'merit': {
          const s = this.atlas('merit');   // 「功德 +1」 rising, and the ring of the tap under it
          s.emit(x + cr(-0.15, 0.15), y + 2.05, z, 0, 1.1, sp * 0.25, 0.9, 0.95, 0.95, TC.plain, 1, 0, 0.4, 0);
          s.emit(x, y + 1.55, z, 0, 0, 0, 0.22, 0.25, 0.8, TC.plain, 0.9, 0, 0, 1);
          break;
        }
        default: break;
      }
    }
  }
}

