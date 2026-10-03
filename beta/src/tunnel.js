import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeTexture } from './assets.js';
import { concreteCanvas, makeCanvas } from './textures.js';
import { TUNNEL } from './director.js';

/*
 * Dark-tunnel shell: one pooled model (the schedule never has two tunnels in view) placed in the world
 * root at track coordinates. Draw calls: shell + portals + trim (1), light panels (1), sign (1),
 * entrance "darkness" curtain (1), exit glare (1).
 * Cross-section: walls at ±TW up to SPRING, then a half-ellipse to the crown. Tall enough for the gantries,
 * a sneaker jump off a train roof and jetpack flight (hero ~12.6 m, camera ~13.3 m at |x| <= 3).
 */
const TW = 7.3, SPRING = 6.2, RISE = 9, ARCH_N = 24;
export const TUNNEL_CROWN = SPRING + RISE;
const PW = 9.6, PH = 18.4, PD = 1.6;   // portal headwall half-width, height, depth
const UVS = 1 / 6;                     // metres -> texture repeats
const LIGHT_EVERY = 12;
const CURTAIN_Z = 28;                  // darkness curtain depth inside the entrance

/** Opening outline from the right foot, up and over the crown, to the left foot (grown by `g`). */
function profile(g = 0) {
  const pts = [new THREE.Vector2(TW + g, 0), new THREE.Vector2(TW + g, SPRING)];
  for (let i = 1; i < ARCH_N; i++) {
    const a = (i / ARCH_N) * Math.PI;
    pts.push(new THREE.Vector2(Math.cos(a) * (TW + g), SPRING + Math.sin(a) * (RISE + g)));
  }
  pts.push(new THREE.Vector2(-(TW + g), SPRING), new THREE.Vector2(-(TW + g), 0));
  return pts;
}

function setColor(geo, fn) {
  const p = geo.attributes.position, a = new Float32Array(p.count * 3), c = new THREE.Color();
  for (let i = 0; i < p.count; i += 3) {
    // flat colour per triangle (non-indexed) from its centroid
    const x = (p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3, y = (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3;
    fn(c, x, y);
    for (let j = i; j < i + 3; j++) { a[j * 3] = c.r; a[j * 3 + 1] = c.g; a[j * 3 + 2] = c.b; }
  }
  geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return geo;
}

/** Inner shell: the profile swept along -z; faces point inward; grimy foot and crown via vertex colours. */
function shellGeometry(len) {
  const prof = profile(), n = prof.length, nz = Math.ceil(len / 8);
  const arc = [0];
  for (let i = 1; i < n; i++) arc.push(arc[i - 1] + prof[i].distanceTo(prof[i - 1]));
  const pos = [], uv = [], col = [], idx = [];
  for (let j = 0; j <= nz; j++) {
    const z = -(j / nz) * len;
    for (let i = 0; i < n; i++) {
      const { x, y } = prof[i];
      pos.push(x, y, z);
      uv.push(arc[i] * UVS, z * UVS);
      const soot = 0.42 + 0.5 * THREE.MathUtils.smoothstep(y, 0.2, 2.6) - 0.22 * THREE.MathUtils.smoothstep(y, 9, 14);
      col.push(soot, soot * 0.97, soot * 0.93);
    }
  }
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < n - 1; i++) {
      const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo.toNonIndexed();
}

/** Headwall with the arched opening; front face at z = PD (toward the approaching hero). */
function portalGeometry() {
  const sh = new THREE.Shape();
  const open = profile();
  sh.moveTo(-PW, 0);
  for (let i = open.length - 1; i >= 0; i--) sh.lineTo(open[i].x, open[i].y);
  sh.lineTo(PW, 0);
  sh.lineTo(PW, PH);
  sh.lineTo(-PW, PH);
  sh.closePath();
  const geo = new THREE.ExtrudeGeometry(sh, { depth: PD, bevelEnabled: false });
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * UVS, uv.getY(i) * UVS);
  // cornice along the top
  const top = new THREE.BoxGeometry(PW * 2 + 0.8, 0.7, PD + 0.7).translate(0, PH + 0.35, PD / 2).toNonIndexed();
  return mergeGeometries([
    setColor(geo.index ? geo.toNonIndexed() : geo, (c, x, y) => c.setScalar(y > PH - 0.01 ? 0.7 : 0.92)),
    setColor(top, (c) => c.setScalar(0.62)),
  ], false);
}

/** Yellow / black hazard band framing the opening on the portal face. */
function trimGeometry() {
  const sh = new THREE.Shape(), outer = profile(0.75), inner = profile(0);
  sh.moveTo(outer[0].x, outer[0].y);
  for (let i = 1; i < outer.length; i++) sh.lineTo(outer[i].x, outer[i].y);
  for (let i = inner.length - 1; i >= 0; i--) sh.lineTo(inner[i].x, inner[i].y);
  sh.closePath();
  const geo = new THREE.ExtrudeGeometry(sh, { depth: 0.14, bevelEnabled: false });
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, 0.5, 0.5);
  geo.translate(0, 0, PD);
  const Y = new THREE.Color('#f2b632'), K = new THREE.Color('#2a2622');
  return setColor(geo.index ? geo.toNonIndexed() : geo, (c, x, y) => {
    // position along the band: 0 at the right foot .. 1 at the left foot
    const t = y > SPRING ? Math.atan2((y - SPRING) / RISE, x / TW) / Math.PI * 0.6 + 0.2
      : x > 0 ? (y / SPRING) * 0.2 : 1 - (y / SPRING) * 0.2;
    c.copy(Math.floor(t * 26) % 2 ? K : Y);
  });
}

function signCanvas() {
  const W = 1024, H = 256, c = makeCanvas(W, H), g = c.getContext('2d');
  g.fillStyle = '#1d4a39';
  g.fillRect(0, 0, W, H);
  g.lineWidth = 14;
  g.strokeStyle = '#f4efe2';
  g.strokeRect(18, 18, W - 36, H - 36);
  g.fillStyle = '#f4efe2';
  g.font = '150px "Lilita One", Arial Black, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('TUNNEL', W / 2 + 6, H / 2 + 10);
  // little lamp icons either side
  for (const x of [110, W - 110]) {
    g.beginPath(); g.arc(x, H / 2, 38, 0, Math.PI * 2); g.fillStyle = '#ffd36b'; g.fill();
    g.lineWidth = 10; g.strokeStyle = '#f4efe2'; g.stroke();
  }
  return c;
}

export class TunnelShell {
  constructor(root) {
    const len = TUNNEL.len;
    this.len = len;
    this.s0 = -1;
    this.group = new THREE.Group();
    this.group.visible = false;
    root.add(this.group);

    const cTex = makeTexture(concreteCanvas(), { repeat: true });
    const mat = new THREE.MeshStandardMaterial({ map: cTex, vertexColors: true, color: 0x8f8d88, roughness: 0.95 });
    const parts = [shellGeometry(len)];
    const entry = portalGeometry();
    parts.push(entry, entry.clone().translate(0, 0, -len - PD), trimGeometry());
    // cable trays along both walls
    for (const sd of [-1, 1]) {
      for (const y of [3.5, 3.85]) parts.push(setColor(new THREE.BoxGeometry(0.34, 0.1, len).translate(sd * (TW - 0.17), y, -len / 2).toNonIndexed(), (c) => c.setScalar(0.2)));
    }
    for (const p of parts) for (const k of Object.keys(p.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) p.deleteAttribute(k);
    this.shell = new THREE.Mesh(mergeGeometries(parts, false), mat);
    this.shell.castShadow = true;
    this.shell.receiveShadow = true;

    // warm light panels every LIGHT_EVERY m on both walls; fog-free so the rows read deep into the dark
    const lights = [];
    for (let z = -LIGHT_EVERY / 2; z > -len; z -= LIGHT_EVERY) {
      for (const sd of [-1, 1]) lights.push(new THREE.BoxGeometry(0.12, 0.3, 2.3).translate(sd * (TW - 0.06), 5.1, z));
    }
    this.lights = new THREE.Mesh(mergeGeometries(lights, false),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 1.45, 0.6), fog: false }));

    const sign = new THREE.Mesh(new THREE.PlaneGeometry(7.2, 1.8),
      new THREE.MeshBasicMaterial({ map: makeTexture(signCanvas()) }));
    sign.position.set(0, TUNNEL_CROWN + 1.85, PD + 0.06);

    const hole = new THREE.ShapeGeometry(new THREE.Shape(profile()));
    // from outside the interior reads as a dark mouth; fades away as the camera closes in
    this.curtain = new THREE.Mesh(hole, new THREE.MeshBasicMaterial({
      color: 0x000000, transparent: true, opacity: 0, depthWrite: false, fog: false,
    }));
    this.curtain.position.z = -CURTAIN_Z;
    // over-exposed daylight at the far end of the tunnel
    this.glare = new THREE.Mesh(hole, new THREE.MeshBasicMaterial({
      color: new THREE.Color(1.35, 1.3, 1.18), transparent: true, opacity: 0, depthWrite: false, fog: false,
    }));
    this.glare.position.z = -len - PD * 0.5;
    this.group.add(this.shell, this.lights, sign, this.curtain, this.glare);
  }

  /** Put the tunnel whose entrance is at track position s0 in place (-1 hides it). */
  place(s0) {
    if (s0 === this.s0) return;
    this.s0 = s0;
    this.group.visible = s0 >= 0;
    if (s0 >= 0) this.group.position.z = -s0;
  }

  /** `camS` = the camera's track position; `fogFar` fades the (fog-free) mouth and lamps in from the haze. */
  update(camS, fogFar = 1e9) {
    if (this.s0 < 0) return;
    const toEntry = this.s0 - camS, toExit = this.s0 + this.len - camS;
    const haze = 1 - THREE.MathUtils.smoothstep(toEntry, fogFar - 90, fogFar - 10);
    const cu = 0.9 * THREE.MathUtils.smoothstep(toEntry, 6, 50) * haze;
    if (haze !== this.haze) { this.haze = haze; this.lights.material.color.setRGB(2.4 * haze, 1.45 * haze, 0.6 * haze); }
    this.curtain.material.opacity = cu;
    this.curtain.visible = cu > 0.003;
    const gl = toExit > 0 ? 0.9 * THREE.MathUtils.smoothstep(toExit, 6, 42) : 0;
    this.glare.material.opacity = gl;
    this.glare.visible = gl > 0.003;
  }
}
