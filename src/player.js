import * as THREE from 'three';
import * as C from './config.js';
import { images, makeTexture } from './assets.js';
import { blobShadowCanvas, bubbleCanvas, makeCanvas } from './textures.js';

// Sprite frames are 512x640 with the feet at y=612; the hero stands ~1.95 units tall.
const FRAME_H = 2.2;
const FRAME_W = FRAME_H * 0.8;
const FEET = (640 - 612) / 640;

function placeholderFrame() {
  const c = makeCanvas(512, 640), g = c.getContext('2d');
  g.fillStyle = '#f2892c';
  g.beginPath(); g.ellipse(256, 380, 120, 230, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#222';
  g.beginPath(); g.arc(256, 150, 90, 0, Math.PI * 2); g.fill();
  return c;
}

export class Player {
  constructor(scene) {
    const tex = (key) => (images[key] ? makeTexture(images[key]) : makeTexture(placeholderFrame()));
    this.frames = {
      run: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => tex(`run${i}`)),
      jump: ['jump_01', 'jump_02', 'jump_03'].map(tex),
      roll: ['roll_01', 'roll_02'].map(tex),
      lean: tex('lean'),
      crash: tex('crash'),
    };
    const geo = new THREE.PlaneGeometry(FRAME_W, FRAME_H);
    geo.translate(0, FRAME_H / 2 - FEET * FRAME_H, 0);
    this.material = new THREE.MeshBasicMaterial({
      map: this.frames.run[0], transparent: true, alphaTest: 0.02, depthWrite: false, side: THREE.DoubleSide,
    });
    this.material.color.setRGB(1.0, 0.97, 0.93);
    // Cross-dissolve into the next frame at the end of each frame so the cycle reads smoothly.
    this.blendU = { map2: { value: this.frames.run[1] }, blend: { value: 0 } };
    this.material.onBeforeCompile = (sh) => {
      sh.uniforms.map2 = this.blendU.map2;
      sh.uniforms.blend = this.blendU.blend;
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D map2;\nuniform float blend;')
        .replace('#include <map_fragment>', `#ifdef USE_MAP
          vec4 sampledDiffuseColor = mix(texture2D(map, vMapUv), texture2D(map2, vMapUv), blend);
          diffuseColor *= sampledDiffuseColor;
        #endif`);
    };
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.renderOrder = 4;
    scene.add(this.mesh);

    // crash frame is square (640x640)
    const cgeo = new THREE.PlaneGeometry(FRAME_H, FRAME_H);
    cgeo.translate(0, FRAME_H / 2 - FEET * FRAME_H, 0);
    this.crashGeo = cgeo;
    this.runGeo = geo;

    const sgeo = new THREE.PlaneGeometry(1.7, 1.1);
    sgeo.rotateX(-Math.PI / 2);
    this.shadow = new THREE.Mesh(sgeo, new THREE.MeshBasicMaterial({
      map: makeTexture(blobShadowCanvas()), transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -4,
    }));
    this.shadow.renderOrder = 3;
    scene.add(this.shadow);

    this.bubble = new THREE.Sprite(new THREE.SpriteMaterial({
      map: makeTexture(bubbleCanvas()), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      color: 0x9fe6ff, opacity: 0.6,
    }));
    this.bubble.renderOrder = 6;
    scene.add(this.bubble);

    // Jetpack strapped to the hero's back (faces the chase camera).
    this.jetpack = new THREE.Sprite(new THREE.SpriteMaterial({
      map: images.icon_jetpack ? makeTexture(images.icon_jetpack) : null, transparent: true, depthWrite: false,
    }));
    this.jetpack.scale.set(0.85, 0.85, 1);
    this.jetpack.renderOrder = 5;
    this.jetpack.visible = false;
    scene.add(this.jetpack);
    this.reset();
  }

  reset() {
    this.lane = 1;
    this.prevLane = 1;
    this.x = 0;
    this.y = 0;
    this.vy = 0;
    this.ground = 0;
    this.onGround = true;
    this.coyote = 0;
    this.rollT = 0;
    this.leanT = 0;
    this.leanDir = 1;
    this.runPhase = 0;
    this.sx = 1;
    this.sy = 1;
    this.tilt = 0;
    this.invuln = 0;
    this.crashed = false;
    this.stumbleT = 0;
    this.prevS = 0;
    this.queue = [];
    this.mesh.geometry = this.runGeo;
    this.mesh.visible = true;
  }

  input(action) {
    if (!this.crashed) this.queue.push(action);
  }

  get height() { return this.rollT > 0 ? C.ROLL_H : C.STAND_H; }

  /**
   * Advance one step. `w` provides: dist, speed, spawner, power, and receives events.
   * Returns a list of event objects: {type, ...}.
   */
  update(dt, w) {
    const ev = [];
    const sneakers = w.power.sneakers > 0;
    this.rollT = Math.max(0, this.rollT - dt);
    this.leanT = Math.max(0, this.leanT - dt);
    this.invuln = Math.max(0, this.invuln - dt);
    this.stumbleT = Math.max(0, this.stumbleT - dt);
    this.coyote = this.onGround ? 0.09 : Math.max(0, this.coyote - dt);

    const flying = w.jetpack;
    if (!this.crashed) {
      for (const a of this.queue) {
        if ((a === 'left' && this.lane > 0) || (a === 'right' && this.lane < 2)) {
          const close = this.closeCall(w);
          this.prevLane = this.lane;
          this.lane += a === 'left' ? -1 : 1;
          this.leanT = 0.2;
          this.leanDir = a === 'left' ? -1 : 1;
          ev.push({ type: 'lane' });
          if (close) ev.push({ type: 'nearmiss', obstacle: close });
        } else if (flying) {
          // no jumping or rolling while the jetpack is lit
        } else if (a === 'jump' && (this.onGround || this.coyote > 0)) {
          const h = sneakers ? C.JUMP_H_SNEAKERS : C.JUMP_H;
          this.vy = Math.sqrt(2 * C.GRAVITY * h);
          this.onGround = false;
          this.coyote = 0;
          this.rollT = 0;
          this.sx = 0.86; this.sy = 1.16;
          ev.push({ type: 'jump', sneakers });
        } else if (a === 'roll') {
          if (!this.onGround) this.vy = Math.min(this.vy, -30);
          this.rollT = 0.62;
          ev.push({ type: 'roll' });
        }
      }
    }
    this.queue.length = 0;

    // lateral
    const prevX = this.x;
    const tx = C.laneX(this.lane);
    this.x = C.damp(this.x, tx, 19, dt);
    if (Math.abs(this.x - tx) < 0.004) this.x = tx;

    // vertical
    const s = w.dist;
    const g = w.spawner.groundAt(this.x, s, this.y);
    if (flying) {
      this.onGround = false;
      this.rollT = 0;
      const k = 1 - Math.exp(-3.2 * dt);
      const ny = this.y + (C.JET_Y - this.y) * k;
      this.vy = (ny - this.y) / Math.max(dt, 1e-4);
      this.y = ny;
    } else if (this.onGround) {
      if (g < this.y - 0.05) { this.onGround = false; this.vy = 0; } else this.y = g;
      // spring pads launch the hero high enough to land on train roofs
      for (const o of w.spawner.obstacles) {
        if (o.type !== 'pad' || this.y > 0.5 || Math.abs(this.x - o.x) > 1.0) continue;
        if (s >= o.s0 - 0.6 && s <= o.s0 + o.len) {
          this.vy = Math.sqrt(2 * C.GRAVITY * C.PAD_JUMP_H);
          this.onGround = false;
          this.rollT = 0;
          this.sx = 0.8; this.sy = 1.25;
          ev.push({ type: 'pad' });
          break;
        }
      }
    }
    if (!this.onGround && !flying) {
      this.vy -= C.GRAVITY * (this.vy < 0 ? 1.12 : 1) * dt;
      this.y += this.vy * dt;
      if (this.y <= g) {
        const fall = -this.vy;
        this.y = g;
        this.vy = 0;
        this.onGround = true;
        this.sx = 1.16; this.sy = 0.84;
        ev.push({ type: 'land', hard: fall > 14, onTrain: g > 1 });
      }
    }
    this.ground = w.spawner.groundAt(this.x, s, this.y + 0.01);

    // collisions
    if (!this.crashed && !flying) {
      const top = this.y + this.height;
      for (const o of w.spawner.obstacles) {
        if (o.type === 'ramp' || o.type === 'pad') continue;
        const near = o.s0 - 0.35, far = o.s0 + o.len + 0.35;
        if (s < near || this.prevS > far) continue;
        const half = o.type === 'train' ? 1.15 + 0.3 : 1.1 + 0.28;
        if (Math.abs(this.x - o.x) >= half) continue;
        let hit = false;
        if (o.type === 'train') hit = this.y < C.TRAIN_TOP - C.STEP_UP;
        else if (o.type === 'hurdle') hit = this.y < C.HURDLE_TOP - 0.14;
        else if (o.type === 'overhead') hit = top > C.OVERHEAD_BOTTOM + 0.05;
        if (!hit) continue;
        if (w.invincible) { ev.push({ type: 'smash', obstacle: o }); continue; }
        const side = o.type === 'train' && Math.abs(prevX - o.x) >= half && this.lane !== this.prevLane;
        if (side) {
          // bounced off the side of a train: back to the previous lane, stumble
          this.lane = this.prevLane;
          this.x = prevX;
          this.leanT = 0;
          if (this.stumbleT > 0 && this.invuln <= 0) {
            ev.push({ type: 'crash', obstacle: o, side: true });
          } else {
            this.stumbleT = 3.2;
            ev.push({ type: 'stumble' });
          }
          break;
        }
        if (this.invuln > 0) continue;
        ev.push({ type: 'crash', obstacle: o, side: false });
        break;
      }
    }
    this.prevS = s;

    // animation
    this.sx = C.damp(this.sx, 1, 11, dt);
    this.sy = C.damp(this.sy, 1, 11, dt);
    this.runPhase += dt * (9.5 + w.speed * 0.36);
    let map, map2 = null, blend = 0, mirror = false, crashGeo = false;
    if (this.crashed) { map = this.frames.crash; crashGeo = true; }
    else if (this.rollT > 0) map = this.frames.roll[Math.floor(this.runPhase * 0.9) % 2];
    else if (flying) map = this.frames.jump[1];
    else if (!this.onGround) map = this.frames.jump[this.vy > 7 ? 0 : this.vy > -5 ? 1 : 2];
    else if (this.leanT > 0) { map = this.frames.lean; mirror = this.leanDir < 0; }
    else {
      const i = Math.floor(this.runPhase) % 8, f = this.runPhase % 1;
      map = this.frames.run[i];
      map2 = this.frames.run[(i + 1) % 8];
      const t = C.clamp((f - 0.5) / 0.5, 0, 1);
      blend = t * t * (3 - 2 * t);
    }
    if (this.material.map !== map) this.material.map = map;
    this.blendU.map2.value = map2 || map;
    this.blendU.blend.value = blend;
    this.mesh.geometry = crashGeo ? this.crashGeo : this.runGeo;

    const targetTilt = this.crashed ? 0 : (C.laneX(this.lane) - this.x) * -0.09;
    this.tilt = C.damp(this.tilt, targetTilt, 14, dt);
    this.mesh.position.set(this.x, this.y + (this.rollT > 0 && this.onGround ? Math.abs(Math.sin(this.runPhase * 2.2)) * 0.08 : 0), 0);
    this.mesh.scale.set(this.sx * (mirror ? -1 : 1), this.sy, 1);
    this.mesh.rotation.set(0, 0, this.tilt);
    this.mesh.visible = !(this.invuln > 0 && Math.floor(this.invuln * 14) % 2 === 0);

    const air = this.y - this.ground;
    const k = C.clamp(1 - air / 4.5, 0.25, 1);
    this.shadow.position.set(this.x, this.ground + 0.03, 0.05);
    this.shadow.scale.set(k, 1, k);
    this.shadow.material.opacity = 0.9 * k;

    this.jetpack.visible = !!flying && !this.crashed;
    if (flying) this.jetpack.position.set(this.x, this.y + 0.95 + Math.sin(this.runPhase) * 0.04, 0.25);

    const shield = w.power.shield;
    this.bubble.visible = shield && !this.crashed;
    if (shield) {
      const t = performance.now() / 1000;
      this.bubble.position.set(this.x, this.y + 1.05, 0.15);
      this.bubble.scale.set(2.6 + Math.sin(t * 6) * 0.06, 2.6 + Math.cos(t * 5) * 0.06, 1);
    }
    return ev;
  }

  /** A train front bearing down in the current lane, close enough that leaving now is a near miss. */
  closeCall(w) {
    if (this.y >= C.TRAIN_TOP - C.STEP_UP || w.jetpack) return null;
    const s = w.dist;
    for (const o of w.spawner.obstacles) {
      if (o.type !== 'train' || o.lane !== this.lane) continue;
      const ahead = o.s0 - s;
      const reach = o.moving ? 16 : 8.5;
      if (ahead < 0.4 || ahead > reach) continue;
      const ramp = w.spawner.obstacles.some((q) => q.type === 'ramp' && q.lane === o.lane && Math.abs(q.s0 + q.len - o.s0) < 0.1);
      if (!ramp) return o;
    }
    return null;
  }

  faceCamera(camera) {
    this.mesh.rotation.y = Math.atan2(camera.position.x - this.x, camera.position.z) * 0.9;
  }
}
