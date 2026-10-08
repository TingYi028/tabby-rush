import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as C from './config.js';
import { FXP } from './settings.js';
import { images, makeTexture } from './assets.js';
import {
  TRAIN_VARIANTS, TRAIN_UV, PROP_UV, trainAtlasCanvas, propsAtlasCanvas, softDotCanvas, makeCanvas,
} from './textures.js';

/* ---------- UV helpers: pack many parts into one draw call via texture atlases ---------- */

function remapUV(geo, [u0, v0, u1, v1], from = 0, to = Infinity) {
  const uv = geo.attributes.uv;
  for (let i = from; i < Math.min(to, uv.count); i++) {
    uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
  }
  return geo;
}
/** Box faces in BoxGeometry order: +x, -x, +y, -y, +z, -z (4 vertices each). */
function boxUV(geo, rects) {
  rects.forEach((r, f) => remapUV(geo, r, f * 4, f * 4 + 4));
  return geo;
}
function solidUV(geo, [u0, v0, u1, v1]) {
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (u0 + u1) / 2, (v0 + v1) / 2);
  return geo;
}
function box(w, h, d, x, y, z, rects) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (Array.isArray(rects[0])) boxUV(g, rects); else solidUV(g, rects);
  g.translate(x, y, z);
  return g;
}
const OUTLINE = new THREE.MeshBasicMaterial({ color: 0x24150c, side: THREE.BackSide });

/* ---------- shared materials ---------- */

export function buildSharedMaterials() {
  const decals = [];
  for (let i = 1; i <= 6; i++) if (images[`graffiti${i}`]) decals.push(images[`graffiti${i}`]);
  const trainMats = [];
  TRAIN_VARIANTS.forEach((v, vi) => {
    for (let k = 0; k < 2; k++) {
      const tex = makeTexture(trainAtlasCanvas(v, decals, 101 + vi * 17 + k * 7));
      trainMats.push(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5, metalness: 0.12 }));
    }
  });
  const props = new THREE.MeshStandardMaterial({
    map: makeTexture(propsAtlasCanvas()), roughness: 0.55, metalness: 0.15,
  });
  return { trainMats, props, glowTex: makeTexture(softDotCanvas()) };
}

/* ---------- trains ---------- */

const R = C.CAR_W / 2;
let carGeo, carHullGeo, lightsGeo;

function buildCarGeometry() {
  const L = C.CAR_LEN, T = TRAIN_UV;
  const parts = [];
  parts.push(box(C.CAR_W, C.BODY_H, L, 0, C.BODY_Y0 + C.BODY_H / 2, 0, [T.SIDE, T.SIDE, T.ROOF, T.DARK, T.FRONT, T.BACK]));
  const roof = new THREE.CylinderGeometry(R, R, L, 22, 1, false, Math.PI / 2, Math.PI);
  roof.rotateX(Math.PI / 2);
  roof.scale(1, C.ROOF_H / R, 1);
  roof.translate(0, C.BODY_Y0 + C.BODY_H, 0);
  parts.push(remapUV(roof, T.ROOF));
  for (const z of [-3.2, 2.6]) parts.push(box(1.1, 0.16, 1.7, 0, C.TRAIN_TOP - 0.05, z, T.ROOFBOX));
  parts.push(box(C.CAR_W * 0.86, 0.34, L * 0.9, 0, 0.4, 0, T.DARK));
  for (const z of [L / 2 - 2.3, -L / 2 + 2.3]) {
    parts.push(box(1.95, 0.2, 2.4, 0, 0.46, z, T.DARK));
    for (const dz of [-0.75, 0.75]) for (const x of [-0.84, 0.84]) {
      const w = new THREE.CylinderGeometry(0.3, 0.3, 0.14, 14);
      w.rotateZ(Math.PI / 2);
      w.translate(x, 0.3, z + dz);
      parts.push(solidUV(w, T.DARK));
    }
  }
  // gangway to the next car
  parts.push(box(1.5, 2.1, C.CAR_GAP + 0.2, 0, C.BODY_Y0 + 1.2, -L / 2 - C.CAR_GAP / 2, T.DARK));
  carGeo = mergeGeometries(parts, false);

  const hb = new THREE.BoxGeometry(C.CAR_W + 0.11, C.BODY_H + 0.08, L + 0.11);
  hb.translate(0, C.BODY_Y0 + C.BODY_H / 2, 0);
  const hr = new THREE.CylinderGeometry(R + 0.055, R + 0.055, L + 0.11, 22, 1, false, Math.PI / 2, Math.PI);
  hr.rotateX(Math.PI / 2);
  hr.scale(1, (C.ROOF_H + 0.05) / (R + 0.055), 1);
  hr.translate(0, C.BODY_Y0 + C.BODY_H, 0);
  carHullGeo = mergeGeometries([hb, hr], false);

  const ls = [];
  for (const x of [-0.64, 0.64]) {
    const c = new THREE.CircleGeometry(0.13, 18);
    c.translate(x, C.BODY_Y0 + 0.28 * C.BODY_H, L / 2 + 0.04);
    ls.push(c);
  }
  lightsGeo = mergeGeometries(ls, false);
}

export class Train {
  constructor(mats) {
    if (!carGeo) buildCarGeometry();
    this.mats = mats;
    this.group = new THREE.Group();
    this.cars = [];
    this.lightOn = new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 4.4, 3) });
    this.seed = Math.random() * 100;
    this.lightOff = new THREE.MeshBasicMaterial({ color: 0xf3ead0 });
    this.lights = new THREE.Mesh(lightsGeo, this.lightOff);
    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: mats.glowTex, color: 0xffe6a8, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.glow.scale.set(4.6, 2.6, 1);
    this.glow.position.set(0, C.BODY_Y0 + 0.28 * C.BODY_H, C.CAR_LEN / 2 + 0.4);
    this.group.add(this.lights, this.glow);
  }
  setup(cars, moving) {
    while (this.cars.length < cars) {
      const body = new THREE.Mesh(carGeo, this.mats.trainMats[0]);
      body.castShadow = true;
      body.receiveShadow = true;
      const hull = new THREE.Mesh(carHullGeo, OUTLINE);
      const car = new THREE.Group();
      car.add(body, hull);
      this.group.add(car);
      this.cars.push({ car, body });
    }
    const base = Math.floor(Math.random() * this.mats.trainMats.length);
    this.cars.forEach((c, i) => {
      c.car.visible = i < cars;
      c.car.position.z = -(i * (C.CAR_LEN + C.CAR_GAP) + C.CAR_LEN / 2);
      c.body.material = this.mats.trainMats[(base + (Math.random() < 0.3 ? i * 2 : 0)) % this.mats.trainMats.length];
    });
    this.lights.position.z = -C.CAR_LEN / 2;
    this.glow.position.z = 0.4;
    this.lights.material = moving ? this.lightOn : this.lightOff;
    this.glow.visible = moving;
    this.setDanger(0);
    return cars * C.CAR_LEN + (cars - 1) * C.CAR_GAP;
  }
  /** Oncoming-train warning (d 0..1): the headlight glow swells 4.6 -> 7.5 wide and flickers as it bears down. */
  setDanger(d, t = performance.now() / 1000) {
    if (!(d > 0)) {
      if (this.danger !== 0) { this.glow.scale.set(4.6, 2.6, 1); this.glow.material.opacity = 1; this.danger = 0; }
      return;
    }
    this.danger = d;
    // dips on a 10 Hz grid (frame-rate independent); calm mode keeps a steady swell
    const cell = Math.floor(t * 10), dip = !FXP.calm && Math.abs(Math.sin(cell * 12.9898 + this.seed) * 43758.5453) % 1 < 0.18 * d;
    const flicker = 1 - d * ((FXP.calm ? 0.08 : 0.16) * (0.5 + 0.5 * Math.sin(t * (FXP.calm ? 9 : 43))) + (dip ? 0.3 : 0));
    const w = (4.6 + 2.9 * d) * (0.93 + 0.07 * flicker);
    this.glow.scale.set(w, w * (2.6 / 4.6), 1);
    this.glow.material.opacity = flicker;
  }
}

/* ---------- ramp ---------- */

let rampGeo;
function buildRampGeometry() {
  const L = C.RAMP_LEN, H = C.TRAIN_TOP, P = PROP_UV;
  const len = Math.hypot(L, H), ang = Math.atan2(H, L);
  const tilt = (g) => { g.rotateX(ang); g.translate(0, H / 2, -L / 2); return g; };
  const parts = [];
  parts.push(tilt(box(2.2, 0.14, len, 0, -0.07, 0, [P.METAL, P.METAL, P.RAMP, P.DARK, P.METAL, P.METAL])));
  for (const x of [-1.12, 1.12]) {
    parts.push(tilt(box(0.12, 0.34, len, x, 0.05, 0, [P.STRIPE_YB, P.STRIPE_YB, P.YELLOW, P.DARK, P.YELLOW, P.YELLOW])));
  }
  for (const [z, h] of [[-L + 0.25, H - 0.12], [-L * 0.55, H * 0.55 - 0.12]]) {
    for (const x of [-0.95, 0.95]) parts.push(box(0.16, h, 0.16, x, h / 2, z, P.DARK));
    parts.push(box(1.9, 0.12, 0.12, 0, h * 0.55, z, P.DARK));
  }
  parts.push(box(2.4, 0.06, 0.6, 0, 0.03, -0.1, P.METAL));
  rampGeo = mergeGeometries(parts, false);
}

export class Ramp {
  constructor(mats) {
    if (!rampGeo) buildRampGeometry();
    this.group = new THREE.Group();
    const m = new THREE.Mesh(rampGeo, mats.props);
    m.castShadow = true;
    m.receiveShadow = true;
    this.group.add(m);
  }
}

/* ---------- barriers ---------- */

const blinkAmber = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 1.6, 0.3) });
const blinkRed = new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 0.5, 0.35) });
export function blinkLights(t) {
  const on = Math.sin(t * 7) > 0;
  blinkAmber.color.setRGB(on ? 3.2 : 0.8, on ? 1.7 : 0.45, on ? 0.3 : 0.1);
  blinkRed.color.setRGB(on ? 0.9 : 4, on ? 0.15 : 0.5, on ? 0.12 : 0.35);
  if (boostTex) boostTex.offset.y = -((t * 1.4) % 1); // boost-strip chevrons stream forward
  if (arrowMat) { // lane-switch arrows: ~2.5 Hz, under the 3-flashes/s line
    const on = Math.sin(t * 15.7) > -0.2;
    arrowMat.opacity = on ? 1 : 0.25;
    arrowGlow.opacity = on ? 0.9 : 0.15;
  }
}

let hurdleGeo, hurdleHull, hurdleLights;
function buildHurdle() {
  const P = PROP_UV, S = P.STRIPE_RW, Wt = P.WHITE;
  hurdleGeo = mergeGeometries([
    box(0.13, 1.0, 0.13, -1.02, 0.5, 0, Wt),
    box(0.13, 1.0, 0.13, 1.02, 0.5, 0, Wt),
    box(0.46, 0.07, 0.5, -1.02, 0.035, 0, P.DARK),
    box(0.46, 0.07, 0.5, 1.02, 0.035, 0, P.DARK),
    box(2.3, 0.32, 0.1, 0, C.HURDLE_TOP - 0.16, 0, [Wt, Wt, Wt, Wt, S, S]),
    box(2.3, 0.2, 0.08, 0, 0.45, 0, [Wt, Wt, Wt, Wt, S, S]),
  ], false);
  hurdleHull = new THREE.BoxGeometry(2.38, 0.4, 0.17);
  hurdleHull.translate(0, C.HURDLE_TOP - 0.16, 0);
  const l = [];
  for (const x of [-1.02, 1.02]) { const s = new THREE.SphereGeometry(0.09, 10, 8); s.translate(x, 1.08, 0); l.push(s); }
  hurdleLights = mergeGeometries(l, false);
}

export class Hurdle {
  constructor(mats) {
    if (!hurdleGeo) buildHurdle();
    this.group = new THREE.Group();
    const m = new THREE.Mesh(hurdleGeo, mats.props);
    m.castShadow = true;
    this.group.add(m, new THREE.Mesh(hurdleHull, OUTLINE), new THREE.Mesh(hurdleLights, blinkAmber));
  }
}

let overGeo, overHull, overLights;
function buildOverhead() {
  const P = PROP_UV, B = C.OVERHEAD_BOTTOM, top = 3.3, boardH = 1.3;
  overGeo = mergeGeometries([
    box(0.2, top, 0.2, -1.22, top / 2, 0, P.STRIPE_YB),
    box(0.2, top, 0.2, 1.22, top / 2, 0, P.STRIPE_YB),
    box(0.5, 0.08, 0.5, -1.22, 0.04, 0, P.DARK),
    box(0.5, 0.08, 0.5, 1.22, 0.04, 0, P.DARK),
    box(2.7, 0.24, 0.24, 0, top, 0, P.RED),
    box(2.3, boardH, 0.12, 0, B + boardH / 2, 0, [P.DARK, P.DARK, P.DARK, P.DARK, P.SIGN, P.SIGN]),
    box(0.06, top - (B + boardH), 0.06, -0.8, (top + B + boardH) / 2, 0, P.DARK),
    box(0.06, top - (B + boardH), 0.06, 0.8, (top + B + boardH) / 2, 0, P.DARK),
  ], false);
  const h1 = new THREE.BoxGeometry(2.38, boardH + 0.08, 0.2);
  h1.translate(0, B + boardH / 2, 0);
  const h2 = new THREE.BoxGeometry(2.78, 0.32, 0.32);
  h2.translate(0, top, 0);
  overHull = mergeGeometries([h1, h2], false);
  const l = [];
  for (const x of [-1.22, 1.22]) { const s = new THREE.SphereGeometry(0.12, 10, 8); s.translate(x, top + 0.2, 0); l.push(s); }
  overLights = mergeGeometries(l, false);
}

export class Overhead {
  constructor(mats) {
    if (!overGeo) buildOverhead();
    this.group = new THREE.Group();
    const m = new THREE.Mesh(overGeo, mats.props);
    m.castShadow = true;
    this.group.add(m, new THREE.Mesh(overHull, OUTLINE), new THREE.Mesh(overLights, blinkRed));
  }
}

/* ---------- spring pad ---------- */

let padGeo;
function buildPad() {
  const P = PROP_UV;
  const top = new THREE.CylinderGeometry(0.98, 0.98, 0.1, 28);
  remapUV(top, P.STRIPE_YB);
  top.translate(0, 0.42, 0);
  const parts = [top, solidUV(new THREE.CylinderGeometry(1.05, 1.12, 0.16, 28).translate(0, 0.08, 0), P.DARK)];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    parts.push(solidUV(new THREE.CylinderGeometry(0.13, 0.13, 0.22, 10).translate(Math.cos(a) * 0.6, 0.27, Math.sin(a) * 0.6), P.METAL));
  }
  parts.push(solidUV(new THREE.ConeGeometry(0.28, 0.22, 3).rotateX(-Math.PI / 2).translate(0, 0.52, -0.1), P.RED));
  padGeo = mergeGeometries(parts, false);
}

export class JumpPad {
  constructor(mats) {
    if (!padGeo) buildPad();
    this.group = new THREE.Group();
    const m = new THREE.Mesh(padGeo, mats.props);
    m.castShadow = m.receiveShadow = true;
    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: mats.glowTex, color: 0xffd23f, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.6,
    }));
    this.glow.scale.set(3, 1.4, 1);
    this.glow.position.y = 0.6;
    this.group.add(m, this.glow);
  }
}

/* ---------- speed-boost strip (flat, lies on the sleepers between the rails) ---------- */

let boostGeo, boostTex, boostMat;
/** Two chevrons (cyan, yellow) per tile, pointing up = forward along the track; tiles vertically. */
function boostStripCanvas() {
  const W = 128, H = 256, c = makeCanvas(W, H), g = c.getContext('2d');
  g.fillStyle = 'rgba(24, 110, 150, 0.55)';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#8ff8ff';
  g.fillRect(0, 0, 7, H);
  g.fillRect(W - 7, 0, 7, H);
  ['#5ff4ff', '#ffe14a'].forEach((col, i) => {
    const y = i * 128 + 22;
    g.beginPath();
    g.moveTo(W / 2, y);
    g.lineTo(W - 16, y + 48);
    g.lineTo(W - 16, y + 80);
    g.lineTo(W / 2, y + 32);
    g.lineTo(16, y + 80);
    g.lineTo(16, y + 48);
    g.closePath();
    g.shadowColor = col;
    g.shadowBlur = 12;
    g.fillStyle = col;
    g.fill();
  });
  return c;
}
function buildBoost() {
  boostGeo = new THREE.PlaneGeometry(1.3, C.BOOST_LEN);
  boostGeo.rotateX(-Math.PI / 2);
  boostGeo.translate(0, 0.15, -C.BOOST_LEN / 2);
  boostTex = makeTexture(boostStripCanvas(), { repeat: true });
  boostTex.repeat.set(1, 2);
  // over-bright so the chevrons catch the bloom pass
  boostMat = new THREE.MeshBasicMaterial({
    map: boostTex, color: new THREE.Color(1.8, 1.8, 1.8), transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
}

export class BoostStrip {
  constructor(mats) {
    if (!boostGeo) buildBoost();
    this.group = new THREE.Group();
    const m = new THREE.Mesh(boostGeo, boostMat);
    m.renderOrder = 2;
    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: mats.glowTex, color: 0x5ff4ff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.7,
    }));
    this.glow.scale.set(2.8, 1.3, 1);
    this.glow.position.set(0, 0.45, -C.BOOST_LEN / 2);
    this.glow.renderOrder = 3;
    this.group.add(m, this.glow);
  }
}

/* ---------- lane-switch telegraph: blinking amber arrows on the sleepers of the lane a train is about to swerve into ---------- */

let arrowGeo, arrowMat, arrowGlow;
/** Double chevron pointing +x (sideways across the track), tall so it survives the grazing view; dark rim. */
function laneArrowCanvas() {
  const W = 128, H = 160, c = makeCanvas(W, H), g = c.getContext('2d');
  g.lineJoin = 'round';
  for (const x0 of [10, 62]) {
    g.beginPath();
    g.moveTo(x0, 8);
    g.lineTo(x0 + 54, H / 2);
    g.lineTo(x0, H - 8);
    g.lineTo(x0 + 22, H / 2);
    g.closePath();
    g.lineWidth = 10;
    g.strokeStyle = 'rgba(40, 18, 0, 0.9)';
    g.stroke();
    g.fillStyle = '#ffc23a';
    g.fill();
  }
  return c;
}
export const ARROW_SPACING = 6;
export class LaneArrows {
  constructor(mats) {
    if (!arrowGeo) {
      arrowGeo = new THREE.PlaneGeometry(2.1, 2.8);
      arrowGeo.rotateX(-Math.PI / 2);
      arrowMat = new THREE.MeshBasicMaterial({
        map: makeTexture(laneArrowCanvas()), color: new THREE.Color(2.6, 1.5, 0.35), transparent: true, depthWrite: false,
        side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      });
      arrowGlow = new THREE.SpriteMaterial({
        map: mats && mats.glowTex, color: 0xffa62b, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      });
    }
    this.group = new THREE.Group();
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(arrowGeo, arrowMat);
      m.position.set(0, 0.2, -i * ARROW_SPACING);
      m.renderOrder = 2;
      const glow = new THREE.Sprite(arrowGlow);
      glow.position.set(0, 0.55, -i * ARROW_SPACING);
      glow.scale.set(3.2, 1.3, 1);
      glow.renderOrder = 3;
      this.group.add(m, glow);
    }
  }
  /** dir +1: the train moves toward +x (arrows point right), -1: toward -x. */
  setDir(dir) { this.group.scale.x = dir < 0 ? -1 : 1; }
}

/* ---------- security drone (chases the hero after a stumble) ---------- */

export class Drone {
  constructor(mats) {
    const P = PROP_UV;
    const parts = [solidUV(new THREE.SphereGeometry(0.42, 20, 14).scale(1, 0.7, 1), P.WHITE)];
    parts.push(solidUV(new THREE.SphereGeometry(0.3, 16, 10).scale(1, 0.6, 0.7).translate(0, -0.05, 0.28), P.DARK));
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + (i * Math.PI) / 2;
      parts.push(solidUV(new THREE.BoxGeometry(0.75, 0.07, 0.1).rotateY(-a).translate(Math.cos(a) * 0.45, 0.05, Math.sin(a) * 0.45), P.DARK));
    }
    this.group = new THREE.Group();
    const body = new THREE.Mesh(mergeGeometries(parts, false), mats.props);
    body.castShadow = true;
    this.group.add(body);
    const rotorMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false });
    this.rotors = [];
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + (i * Math.PI) / 2;
      const r = new THREE.Mesh(new THREE.CircleGeometry(0.34, 16).rotateX(-Math.PI / 2), rotorMat);
      r.position.set(Math.cos(a) * 0.82, 0.12, Math.sin(a) * 0.82);
      this.group.add(r);
      this.rotors.push(r);
    }
    this.red = new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 0.4, 0.3) });
    this.blue = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 0.8, 5) });
    const lr = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), this.red);
    const lb = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), this.blue);
    lr.position.set(-0.22, 0.3, 0.05);
    lb.position.set(0.22, 0.3, 0.05);
    this.group.add(lr, lb);
    this.group.visible = false;
  }
  update(t) {
    const on = FXP.calm ? true : Math.floor(t * 5) % 2 === 0;
    this.red.color.setRGB(on ? 6 : 0.6, on ? 0.5 : 0.1, on ? 0.4 : 0.1);
    this.blue.color.setRGB(on ? 0.1 : 0.3, on ? 0.2 : 0.9, on ? 0.6 : 6);
    for (const r of this.rotors) r.rotation.y = t * 40;
  }
}

/* ---------- coins (instanced: two draw calls for every coin on screen) ---------- */

export class Coins {
  constructor(parent) {
    this.cap = 640;
    const rimGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.1, 30, 1, true);
    rimGeo.rotateX(Math.PI / 2);
    const front = new THREE.CircleGeometry(0.42, 36);
    const back = new THREE.CircleGeometry(0.42, 36);
    for (const g of [front, back]) {
      const uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, 0.5 + (uv.getX(i) - 0.5) * 0.9, 0.5 + (uv.getY(i) - 0.5) * 0.9);
    }
    front.translate(0, 0, 0.05);
    back.rotateY(Math.PI);
    back.translate(0, 0, -0.05);
    const faceGeo = mergeGeometries([front, back], false);
    const tex = images.icon_coin ? makeTexture(images.icon_coin) : null;
    const faceMat = new THREE.MeshStandardMaterial({
      map: tex, color: tex ? 0xffffff : 0xffc933, emissive: 0xffffff, emissiveMap: tex,
      emissiveIntensity: tex ? 0.35 : 0, metalness: 0.25, roughness: 0.35,
    });
    const rimMat = new THREE.MeshStandardMaterial({
      color: 0xf4b41a, metalness: 0.85, roughness: 0.25, emissive: 0x8a5200, emissiveIntensity: 0.6,
    });
    // The spin happens in the vertex shader (angle from time + the coin's track position), so the instance matrices
    // are pure translations that only change when coins appear, go or get pulled by the magnet.
    this.spin = { value: 0 };
    const spin = (m) => {
      m.onBeforeCompile = (sh) => {
        sh.uniforms.uSpin = this.spin;
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', `#include <common>
            uniform float uSpin;
            mat3 coinSpin() { float a = uSpin * 4.2 - instanceMatrix[3].z * 0.35; float c = cos(a), s = sin(a); return mat3(c, 0., -s, 0., 1., 0., s, 0., c); }`)
          .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n objectNormal = coinSpin() * objectNormal;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\n transformed = coinSpin() * transformed;');
      };
    };
    spin(faceMat);
    spin(rimMat);
    this.rim = new THREE.InstancedMesh(rimGeo, rimMat, this.cap);
    this.face = new THREE.InstancedMesh(faceGeo, faceMat, this.cap);
    for (const m of [this.rim, this.face]) {
      m.frustumCulled = false;
      m.count = 0;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      parent.add(m);
    }
    this.list = [];
    this.dirty = true;
  }
  add(x, y, s) {
    if (this.list.length >= this.cap) return;
    this.list.push({ x, y, s, mag: false, phase: s * 0.35 });
    this.dirty = true;
  }
  clear() { this.list.length = 0; this.dirty = true; }
  /** Returns the collected coins' positions (track coordinates) for effects. */
  /**
   * `prevDist`: the hero's distance last frame (pickups cover the whole frame's travel, so low frame rates
   * don't skip coins); `collect` false (menu, crash) neither collects nor pulls magnetised coins.
   */
  update(dt, t, dist, px, py, magnet, prevDist = dist, collect = true) {
    const got = [];
    const L = this.list;
    for (let i = L.length - 1; i >= 0; i--) {
      const c = L[i];
      if (c.s < dist - 12) { L[i] = L[L.length - 1]; L.pop(); this.dirty = true; continue; }
      const ahead = c.s - dist;
      if (magnet && ahead < 16 && ahead > -1.5 && !c.mag) { c.mag = true; c.off = ahead; }
      if (c.mag && collect) {
        // pulled in relative to the hero (an absolute chase would trail him by speed/14 m forever)
        const k = 1 - Math.exp(-14 * dt);
        c.x += (px - c.x) * k;
        c.y += (py + 1.0 - c.y) * k;
        c.off *= 1 - k;
        c.s = dist + c.off;
        this.dirty = true;
      }
      if (!collect) continue;
      if (c.s > prevDist - 0.9 && c.s < dist + 0.9 && Math.abs(c.x - px) < 0.95 && Math.abs(c.y - (py + 0.9)) < 1.35) {
        got.push(c);
        L[i] = L[L.length - 1];
        L.pop();
        this.dirty = true;
      }
    }
    this.spin.value = t % 600;
    if (!this.dirty) return got;
    this.dirty = false;
    // instance matrices start as identity; only the translation column changes
    const a = this.rim.instanceMatrix.array, b = this.face.instanceMatrix.array;
    for (let i = 0; i < L.length; i++) {
      const c = L[i], o = i * 16;
      a[o] = a[o + 5] = a[o + 10] = a[o + 15] = b[o] = b[o + 5] = b[o + 10] = b[o + 15] = 1;
      a[o + 12] = b[o + 12] = c.x;
      a[o + 13] = b[o + 13] = c.y;
      a[o + 14] = b[o + 14] = -c.s;
    }
    this.rim.count = this.face.count = L.length;
    this.rim.instanceMatrix.needsUpdate = true;
    this.face.instanceMatrix.needsUpdate = true;
    return got;
  }
}

/* ---------- power-ups ---------- */

export const POWER_TYPES = ['magnet', 'sneakers', 'x2', 'shield', 'jetpack'];
const POWER_GLOW = { magnet: 0xff6a5a, sneakers: 0x8cff5a, x2: 0xffd23f, shield: 0x7fd8ff, jetpack: 0xffa040 };
const ICON_TEX = {}; // shared by every pooled power-up

export class PowerUp {
  constructor(mats) {
    this.group = new THREE.Group();
    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: mats.glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.glow.scale.set(2.6, 2.6, 1);
    this.icon = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false }));
    this.icon.scale.set(1.35, 1.35, 1);
    this.group.add(this.glow, this.icon);
    this.texCache = ICON_TEX;
  }
  setType(type) {
    this.type = type;
    if (!this.texCache[type]) {
      const img = images[`icon_${type}`];
      this.texCache[type] = img ? makeTexture(img) : null;
    }
    this.icon.material.map = this.texCache[type];
    this.icon.material.color.set(this.texCache[type] ? 0xffffff : POWER_GLOW[type]);
    this.icon.material.needsUpdate = true;
    this.glow.material.color.set(POWER_GLOW[type]);
  }
}
