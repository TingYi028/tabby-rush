import * as THREE from 'three';
import { makeTexture } from './assets.js';
import { softDotCanvas, starCanvas, bubbleCanvas, isCoarsePointer } from './textures.js';
import { rand } from './config.js';
import { FXP } from './settings.js';
import { spriteCanvas } from './cosmetic-art.js';
import { Companions, Ghosts } from './companions.js';

const VERT = /* glsl */`
attribute float size;
attribute float alpha;
attribute vec3 pcolor;
uniform float uScale;
uniform float uMaxPx;
varying float vAlpha;
varying vec3 vColor;
void main() {
  vAlpha = alpha;
  vColor = pcolor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = min(size * uScale / max(0.1, -mv.z), uMaxPx); // nothing balloons as it passes the camera
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */`
uniform sampler2D uMap;
varying float vAlpha;
varying vec3 vColor;
void main() {
  vec4 t = texture2D(uMap, gl_PointCoord);
  float a = t.a * vAlpha;
  if (a < 0.003) discard;
  gl_FragColor = vec4(vColor * t.rgb, a);
}`;

/**
 * Fixed-capacity point sprites in one draw call. A ring cursor hands out slots (a full pool recycles the oldest), and
 * `live` lists the slots in use, so update() costs the live particles, not the capacity.
 */
export class ParticleSystem {
  constructor(parent, max, texture, blending, maxPx = 0.16) {
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
    this.material = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: texture }, uScale: { value: 400 }, uMaxPx: { value: 160 } },
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

  emit(x, y, z, vx, vy, vz, life, s0, s1, color, a0 = 1, grav = 0, drag = 0) {
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
  }

  update(dt) {
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
    if (this.colDirty) { this.colDirty = false; this.geo.attributes.pcolor.needsUpdate = true; }
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
  stardust: [new THREE.Color(0.8, 1.0, 1.9), new THREE.Color(1.8, 1.65, 1.1), new THREE.Color(1.4, 1.0, 1.9)],
  galaxy: [new THREE.Color(0.5, 1.5, 2.0), new THREE.Color(2.0, 0.55, 1.7), new THREE.Color(1.8, 1.7, 1.3), new THREE.Color(1.1, 0.8, 2.0)],
};
const DUST_GAP = 0.09;   // seconds between dust puffs on phones
const TRAIL_RATE = { coin: 15, bubble: 18, bone: 6, fire: 55, rainbow: 26, star: 34, galaxy: 70 };

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
  }
  /** `s`: pixels per world unit at distance 1; `h`: drawing-buffer height (caps a particle at 16% of it, dust on phones 8%). */
  setScale(s, h = 1000) {
    this.scale.s = s;
    this.scale.h = h;
    for (let i = 0; i < this.systems.length; i++) this.systems[i].setScale(s, h);
  }
  update(dt) {
    this.clock += dt;
    for (let i = 0; i < this.systems.length; i++) this.systems[i].update(dt);
  }
  clear() {
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
  }
  trail(x, y, z, color) {
    if (Math.random() > FXP.particles) return;
    this.add.emit(x + rand(-0.3, 0.3), y + rand(0, 0.4), z + rand(-0.2, 0.2), rand(-0.4, 0.4), rand(-0.2, 0.6), rand(1, 3),
      rand(0.3, 0.5), rand(0.4, 0.7), 0.05, color, 0.9, 0, 1);
  }

  /* ---------- shop trails (cosmetics.js) ---------- */

  /** Textured particle system of `name` ('coin' | 'bone' | 'bubble'), created on first use (when a trail is equipped, never mid-run). */
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

  /** Equip trail `id` ('' = none): 'paw' | 'coin' | 'bubble' | 'bone' | 'fire' | 'rainbow' | 'star' | 'galaxy' | 'ghost'. */
  setTrail(id) {
    this.trailId = id || '';
    this.tacc = 0;
    this.ghosts.setActive(id === 'ghost');
    if (id === 'coin' || id === 'bone' || id === 'bubble') this.sprite(id);
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
        default: break;
      }
    }
  }
}

