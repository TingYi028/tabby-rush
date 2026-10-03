import * as THREE from 'three';
import { makeTexture } from './assets.js';
import { softDotCanvas, starCanvas } from './textures.js';
import { rand } from './config.js';
import { FXP } from './settings.js';

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

class ParticleSystem {
  constructor(parent, max, texture, blending) {
    this.max = max;
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

  emit(x, y, z, vx, vy, vz, life, s0, s1, color, a0 = 1, grav = 0, drag = 0) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
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
    let hi = 0;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { this.alpha[i] = 0; this.size[i] = 0; continue; }
      hi = i + 1;
      this.life[i] -= dt;
      const t = 1 - Math.max(0, this.life[i]) / this.maxLife[i];
      const i3 = i * 3;
      const d = Math.exp(-this.drag[i] * dt);
      this.vel[i3] *= d; this.vel[i3 + 1] = this.vel[i3 + 1] * d - this.grav[i] * dt; this.vel[i3 + 2] *= d;
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * t;
      this.alpha[i] = this.a0[i] * (t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85);
    }
    // upload only the slots that can be alive (plus the ones that died since last frame); colours only after emits
    const n = Math.max(hi, this.lastHi || 0);
    this.lastHi = hi;
    this.geo.setDrawRange(0, hi);
    if (!n) return;
    const a = this.geo.attributes;
    for (const at of [a.position, a.size, a.alpha]) {
      at.clearUpdateRanges();
      at.addUpdateRange(0, n * at.itemSize);
      at.needsUpdate = true;
    }
    if (this.colDirty) { this.colDirty = false; a.pcolor.needsUpdate = true; }
  }

  clear() { this.life.fill(0); }
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

/** Particles live inside the moving world group, so dust stays put on the ground behind the hero. */
export class FX {
  constructor(worldRoot) {
    this.add = new ParticleSystem(worldRoot, 700, makeTexture(starCanvas()), THREE.AdditiveBlending);
    this.add.gain = () => FXP.glow;
    this.soft = new ParticleSystem(worldRoot, 500, makeTexture(softDotCanvas()), THREE.NormalBlending);
    this.root = worldRoot;
  }
  /** `s`: pixels per world unit at distance 1; `h`: drawing-buffer height (caps a particle at 16% of it). */
  setScale(s, h = 1000) {
    for (const p of [this.add, this.soft]) {
      p.material.uniforms.uScale.value = s;
      p.material.uniforms.uMaxPx.value = Math.max(24, h * 0.16);
    }
  }
  update(dt) { this.add.update(dt); this.soft.update(dt); }
  clear() { this.add.clear(); this.soft.clear(); }

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
    this.soft.emit(x + rand(-0.25, 0.25), y + 0.08, z + rand(-0.2, 0.2), rand(-0.6, 0.6), rand(0.4, 1.1), rand(0.2, 1.2),
      rand(0.45, 0.7), 0.45 * big, 1.6 * big, Math.random() < 0.5 ? COL.dust : COL.dustDark, 0.42, -0.4, 1.5);
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
}
