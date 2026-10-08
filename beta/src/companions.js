import * as THREE from 'three';
import { makeTexture } from './assets.js';
import { companionSheet } from './cosmetic-art.js';
import { damp } from './config.js';
import { FXP } from './settings.js';

/*
 * Cosmetic companions and afterimages (see cosmetics.js). Both are plain scene objects (not in the moving world root):
 *  - Companions: one billboard sprite (a 2-frame procedural sheet from cosmetic-art.js) that follows the hero with lag
 *    on the lane side that is free, hovering or on the ground, with a hop when something happens. No collision,
 *    no sound, nothing to read: it must never be mistaken for the warning drone.
 *  - Ghosts: the 影印機分身 trail, two delayed faint copies of the hero sprite (frames, lean and squash included).
 * Per-frame code allocates nothing.
 */

// dx: lateral offset from the hero; hover: height of the sprite centre above the hero's feet (0 = stands on the ground);
// lag / lagY: follow speeds; fps: frame flips per second
const SPEC = {
  drone: { size: 0.95, dx: 1.35, hover: 2.15, lag: 6, lagY: 5, bob: 0.12, fps: 12, tilt: 0.5 },
  box: { size: 1.05, dx: 1.3, hover: 0, lag: 7, lagY: 9, bob: 0.0, fps: 1.6, tilt: 0.2 },
  fish: { size: 1.2, dx: 1.35, hover: 2.35, lag: 4.5, lagY: 4, bob: 0.18, fps: 3.5, tilt: 0.6 },
  train: { size: 1.15, dx: 1.4, hover: 0, lag: 8, lagY: 10, bob: 0.03, fps: 9, tilt: 0.1 },
  ufo: { size: 1.25, dx: 1.35, hover: 2.6, lag: 5, lagY: 4, bob: 0.14, fps: 5, tilt: 0.7 },
};

export class Companions {
  constructor() {
    this.sprite = null;
    this.mat = null;
    this.cache = {};
    this.spec = null;
    this.fx = '';
    this.x = 0; this.y = 0;
    this.side = 1;
    this.hop = 0;
    this.frame = -1;
    this.ready = false;
  }

  /** Create the (hidden) sprite and put it in the scene. */
  mount(scene) {
    if (this.sprite || !scene) return;
    this.mat = new THREE.SpriteMaterial({ transparent: true, depthWrite: false });
    this.sprite = new THREE.Sprite(this.mat);
    this.sprite.renderOrder = 6;
    this.sprite.frustumCulled = false;
    this.sprite.visible = false;
    scene.add(this.sprite);
    if (this.fx) this.set(this.fx);
  }

  /** Show companion `fx` ('' = none). */
  set(fx) {
    this.fx = fx;
    this.spec = SPEC[fx] || null;
    this.ready = false;
    if (!this.sprite) return;
    if (!this.spec) { this.sprite.visible = false; return; }
    let tex = this.cache[fx];
    if (!tex) {
      tex = this.cache[fx] = makeTexture(companionSheet(fx));
      tex.repeat.set(0.5, 1);
      tex.generateMipmaps = false;                 // the two frames sit side by side: no mip bleeding between them
      tex.minFilter = THREE.LinearFilter;
    }
    this.mat.map = tex;
    this.mat.needsUpdate = true;
    this.frame = -1;
    this.sprite.scale.set(this.spec.size, this.spec.size, 1);
  }

  /** Something happened ('crash' | 'revive' | 'rush' | 'coin'): a hop. */
  react(type) {
    if (type === 'crash' || type === 'revive') this.hop = 1;
    else if (type === 'rush') this.hop = Math.max(this.hop, 0.7);
  }

  update(dt, p, t, show) {
    const sp = this.spec, s = this.sprite;
    if (!sp || !s) return;
    s.visible = show && p.mesh.visible;
    if (!s.visible) return;
    if (p.lane === 0) this.side = 1;
    else if (p.lane === 2) this.side = -1;
    const tx = p.x + this.side * sp.dx;
    const base = sp.hover ? p.y + sp.hover : p.ground + sp.size * 0.5 + 0.02;
    const ty = base + (sp.bob ? Math.sin(t * 3.1) * sp.bob : 0) + Math.sin(Math.min(1, this.hop) * Math.PI) * 0.55;
    if (!this.ready) { this.x = tx; this.y = ty; this.ready = true; }   // appear in place, don't fly in from the origin
    this.x = damp(this.x, tx, sp.lag, dt);
    this.y = damp(this.y, ty, sp.lagY, dt);
    this.hop = Math.max(0, this.hop - dt * 2.4);
    s.position.set(this.x, this.y, 0.45);
    this.mat.rotation = (tx - this.x) * sp.tilt * 0.12;
    const f = Math.floor(t * sp.fps) & 1;
    if (f !== this.frame) { this.frame = f; this.mat.map.offset.x = f * 0.5; }
  }
}

/* ---------- afterimages ---------- */

const CAP = 64;                        // samples of history (about 1 s at 60 fps)
const DELAY = [0.08, 0.16];            // seconds behind the hero
const OPACITY = [0.18, 0.09];

export class Ghosts {
  constructor() {
    this.active = false;
    this.meshes = null;
    this.scene = null;
    this.ts = new Float32Array(CAP);
    this.xs = new Float32Array(CAP); this.ys = new Float32Array(CAP);
    this.sx = new Float32Array(CAP); this.sy = new Float32Array(CAP);
    this.rz = new Float32Array(CAP); this.ry = new Float32Array(CAP);
    this.maps = new Array(CAP).fill(null);
    this.crash = new Uint8Array(CAP);
    this.head = 0;
    this.n = 0;
  }

  mount(scene, player) {
    this.scene = scene;
    this.player = player;
    if (this.active) this.build();
  }

  build() {
    if (this.meshes || !this.scene || !this.player) return;
    this.meshes = DELAY.map((_, i) => {
      const m = new THREE.Mesh(this.player.runGeo, new THREE.MeshBasicMaterial({
        map: this.player.frames.run[0], transparent: true, opacity: OPACITY[i], depthWrite: false, side: THREE.DoubleSide, alphaTest: 0.02,
      }));
      m.renderOrder = 3.6;
      m.frustumCulled = false;
      m.visible = false;
      this.scene.add(m);
      return m;
    });
  }

  setActive(on) {
    this.active = !!on;
    this.n = 0;
    if (this.active) this.build();
    if (!this.active && this.meshes) for (const m of this.meshes) m.visible = false;
  }

  update(dt, p, t) {
    if (!this.active || !this.meshes) return;
    // record this frame
    const h = this.head, me = p.mesh;
    this.ts[h] = t; this.xs[h] = me.position.x; this.ys[h] = me.position.y;
    this.sx[h] = me.scale.x; this.sy[h] = me.scale.y; this.rz[h] = me.rotation.z; this.ry[h] = me.rotation.y;
    this.maps[h] = p.material.map; this.crash[h] = p.crashed ? 1 : 0;
    this.head = (h + 1) % CAP;
    if (this.n < CAP) this.n++;
    const count = FXP.level === 'low' ? 1 : 2;
    for (let i = 0; i < this.meshes.length; i++) {
      const g = this.meshes[i];
      if (i >= count || !me.visible || this.n < 3) { g.visible = false; continue; }
      // newest sample at or before t - delay (walk back from the head)
      const want = t - DELAY[i];
      let k = (this.head - 1 + CAP) % CAP, left = this.n;
      while (left > 1 && this.ts[k] > want) { k = (k - 1 + CAP) % CAP; left--; }
      if (this.ts[k] > want) { g.visible = false; continue; }
      g.visible = true;
      g.geometry = this.crash[k] ? p.crashGeo : p.runGeo;
      g.position.set(this.xs[k], this.ys[k], -0.02);
      g.scale.set(this.sx[k], this.sy[k], 1);
      g.rotation.set(0, this.ry[k], this.rz[k]);
      const mat = g.material;
      if (mat.map !== this.maps[k]) mat.map = this.maps[k];
      mat.color.copy(p.material.color).multiplyScalar(1.05);
      mat.color.b = Math.min(1.2, mat.color.b * 1.12);
    }
  }
}
