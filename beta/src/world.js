import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as C from './config.js';
import { images, makeTexture } from './assets.js';
import {
  gravelCanvas, concreteCanvas, sidewalkCanvas, cloudCanvas, fallbackFacadeCanvas, makeCanvas,
} from './textures.js';
import { rng, isCoarsePointer } from './textures.js';
import { makeLook, blendLook } from './themes.js';
import { TunnelShell } from './tunnel.js';
import { Rain } from './weather.js';

export const FOG_COLOR = 0xf3d9b1;
const BULB = new THREE.Color(1.7, 1.5, 1.1);
const HEADLAMP = 26;   // candela at full tunnel darkness (decay 1)
const smooth = THREE.MathUtils.smoothstep;

/**
 * Lit-window emissive map for a facade: its grey glass panes, flood-filled per window so each window is
 * either lit (mostly warm, a few TV-blue) or dark. Black elsewhere, so a zero intensity keeps the day look.
 */
function windowGlowCanvas(src, seed) {
  const W = 160, H = 384, c = makeCanvas(W, H), g = c.getContext('2d');
  g.drawImage(src, 0, 0, W, H);
  let d;
  try { d = g.getImageData(0, 0, W, H).data; } catch (e) { g.fillStyle = '#000'; g.fillRect(0, 0, W, H); return c; } // tainted canvas: no glow
  const n = W * H;
  const mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const r = d[i * 4] / 255, gr = d[i * 4 + 1] / 255, b = d[i * 4 + 2] / 255;
    const mx = Math.max(r, gr, b), mn = Math.min(r, gr, b);
    if (mx > 0.2 && mx < 0.75 && (mx - mn) / mx < 0.15 && b >= r - 0.03) mask[i] = 1;
  }
  const out = g.createImageData(W, H), o = out.data, rnd = rng(seed), stack = [], comp = [];
  for (let i = 0; i < n; i++) {
    o[i * 4 + 3] = 255;
    if (mask[i] !== 1) continue;
    comp.length = 0;
    stack.push(i);
    mask[i] = 2;
    while (stack.length) {
      const p = stack.pop(), x = p % W;
      comp.push(p);
      if (x > 0 && mask[p - 1] === 1) { mask[p - 1] = 2; stack.push(p - 1); }
      if (x < W - 1 && mask[p + 1] === 1) { mask[p + 1] = 2; stack.push(p + 1); }
      if (p >= W && mask[p - W] === 1) { mask[p - W] = 2; stack.push(p - W); }
      if (p + W < n && mask[p + W] === 1) { mask[p + W] = 2; stack.push(p + W); }
    }
    if (comp.length < 14 || rnd() > 0.72) continue;   // specks and dark windows stay black
    const k = 0.6 + 0.4 * rnd(), warm = rnd() < 0.85;
    const cr = (warm ? 255 : 150) * k, cg = (warm ? 190 : 200) * k, cb = (warm ? 105 : 255) * k;
    for (const p of comp) { o[p * 4] = cr; o[p * 4 + 1] = cg; o[p * 4 + 2] = cb; }
  }
  g.putImageData(out, 0, 0);
  return c;
}

const FACADE_TINT = ['#b4523d', '#e6d2a6', '#3f8e8a', '#c2643b'];
const BX = C.WALL_X + 3.4; // inner face of the first row of buildings

function paint(geo, color) {
  const c = new THREE.Color(color), n = geo.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return geo;
}
const pbox = (w, h, d, x, y, z, color) => paint(new THREE.BoxGeometry(w, h, d).translate(x, y, z), color);

const SKY_VERT = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const SKY_FRAG = /* glsl */`
uniform vec3 top; uniform vec3 mid; uniform vec3 hor;
varying vec3 vDir;
void main() {
  float h = vDir.y;
  vec3 c = mix(hor, mid, smoothstep(-0.02, 0.2, h));
  c = mix(c, top, smoothstep(0.2, 0.75, h));
  gl_FragColor = vec4(c, 1.0);
}`;

function billboardCanvas(kind) {
  const W = 1024, H = 320, c = makeCanvas(W, H), g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 0, H);
  if (kind === 0) { grd.addColorStop(0, '#2fb9d9'); grd.addColorStop(1, '#1b7fb8'); }
  else { grd.addColorStop(0, '#ffcf45'); grd.addColorStop(1, '#ff8a22'); }
  g.fillStyle = grd;
  g.fillRect(0, 0, W, H);
  g.fillStyle = 'rgba(255,255,255,0.18)';
  for (let i = 0; i < 14; i++) {
    g.beginPath(); g.moveTo(W / 2, H * 1.4); g.arc(W / 2, H * 1.4, W, -Math.PI + i * 0.22, -Math.PI + i * 0.22 + 0.11); g.fill();
  }
  if (kind === 0 && images.logo) {
    const lw = W * 0.86, lh = lw * images.logo.height / images.logo.width;
    g.drawImage(images.logo, (W - lw) / 2, (H - lh) / 2, lw, lh);
  } else if (images.portrait) {
    const ph = H * 1.0, pw = ph * images.portrait.width / images.portrait.height;
    g.drawImage(images.portrait, 40, H - ph + 10, pw, ph);
    g.font = '86px "Lilita One", Arial Black, sans-serif';
    g.lineJoin = 'round';
    g.lineWidth = 16;
    g.strokeStyle = '#3b1d0e';
    g.fillStyle = '#ffffff';
    for (const [t, y] of [['RUN, TABBY,', 140], ['RUN!', 240]]) { g.strokeText(t, 80 + pw, y); g.fillText(t, 80 + pw, y); }
  }
  g.lineWidth = 18;
  g.strokeStyle = '#3b1d0e';
  g.strokeRect(9, 9, W - 18, H - 18);
  return c;
}

export class World {
  constructor(scene, root) {
    this.scene = scene;
    this.root = root;
    scene.fog = new THREE.Fog(FOG_COLOR, 75, 300);
    scene.background = new THREE.Color(FOG_COLOR);
    this.buildLights();
    this.buildSky();
    this.buildTrack();
    this.buildCity();
    this.buildAmbience();
    this.segments = [];
    for (let i = 0; i < C.SEG_COUNT; i++) this.segments.push({ s: 0, buildings: [], decals: [] });
    this.reset(0);
  }

  /* ---------- zone themes & tunnel look (uniform / colour / intensity changes only, no recompiles) ---------- */

  buildAmbience() {
    // camera-mounted "headlamp" for tunnels / night; created at boot (intensity 0) so the light count never changes
    this.headlamp = new THREE.SpotLight(0xffe2b4, 0, 140, 0.6, 0.6, 1);
    this.scene.add(this.headlamp, this.headlamp.target);
    this.rain = new Rain();
    this.scene.add(this.rain.mesh);
    this.tunnel = new TunnelShell(this.root);
    this.look = makeLook();
    this.zone = { from: 0, to: 0, t: 1 };
    this.dark = 0;      // tunnel darkness 0..1
    this.shelter = 0;   // under the tunnel roof (no rain) 0..1
    this.applyLook();
  }

  /** Tunnel darkness / rain shelter from the camera's track position, headlamp, rain; re-applies the look when it moved. */
  updateAmbience(dt, dist, camera, speed) {
    let dark = 0, shelter = 0;
    const s0 = this.tunnel.s0;
    if (s0 >= 0) {
      const camS = dist - camera.position.z, s1 = s0 + this.tunnel.len;   // the camera trails the hero (z = 0) by its z
      dark = smooth(camS, s0 - 14, s0 + 14) * (1 - smooth(camS, s1 - 6, s1 + 12));
      shelter = smooth(camS, s0 - 30, s0 + 2) * (1 - smooth(camS, s1 - 26, s1 - 2));
      this.tunnel.update(camS, this.scene.fog.far);
    }
    if (dark !== this.dark || shelter !== this.shelter) { this.dark = dark; this.shelter = shelter; this.dirty = true; }
    if (this.dirty) { this.dirty = false; this.applyLook(); }
    const p = camera.position;
    this.headlamp.position.set(p.x, p.y - 0.7, p.z - 0.5);
    this.headlamp.target.position.set(p.x * 0.4, 0.6, p.z - 46);
    this.rain.update(dt, dist, speed, camera);
  }

  /** Cross-fade between zone themes (indices into THEMES), t 0..1 (eased here). */
  setTheme(from, to, t) {
    const z = this.zone, e = t * t * (3 - 2 * t);
    if (z.from === from && z.to === to && z.t === e) return;
    z.from = from; z.to = to; z.t = e;
    this.dirty = true;
  }

  /** Track position of the tunnel entrance to show (the one being approached or driven through), -1 for none. */
  setTunnel(s0) { this.tunnel.place(s0); }

  /**
   * Boot warm-up: show the tunnel just ahead of track position `dist` and the rain so their shader programs
   * compile in the warm-up render instead of hitching on first sight; prewarm(false) hides them again.
   */
  prewarm(on, dist = 0) {
    const t = this.tunnel;
    t.place(on ? dist + 30 : -1);
    t.curtain.visible = t.glare.visible = on;
    this.rain.mesh.visible = on;
  }

  applyLook() {
    const L = blendLook(this.look, this.zone.from, this.zone.to, this.zone.t, this.dark);
    const u = this.sky.material.uniforms;
    u.top.value.copy(L.skyTop);
    u.mid.value.copy(L.skyMid);
    u.hor.value.copy(L.skyHor);
    const f = this.scene.fog;
    f.color.copy(L.fog);
    f.near = L.fogNear;
    f.far = L.fogFar;
    this.scene.background.copy(L.fog);
    this.hemi.color.copy(L.hemiSky);
    this.hemi.groundColor.copy(L.hemiGround);
    this.hemi.intensity = L.hemi;
    this.sun.color.copy(L.sunColor);
    this.sun.intensity = L.sun;
    this.scene.environmentIntensity = L.env;
    for (const t of this.tinted) t.mat.color.copy(t.base).multiply(L.building);
    for (const t of this.types) t.im.material[0].emissiveIntensity = L.windows;
    for (const b of this.boards) b.material.emissiveIntensity = L.boards;
    this.bulbMat.color.copy(BULB).multiplyScalar(L.lamps);
    if (this.skylineMat) this.skylineMat.color.copy(L.skyline);
    for (const c of this.clouds) c.material.color.copy(L.clouds);
    this.headlamp.intensity = HEADLAMP * L.headlamp;
    this.rain.setAmount(L.rain * (1 - this.shelter));
  }

  buildLights() {
    this.hemi = new THREE.HemisphereLight(0xd2e8ff, 0xe2b98d, 1.55);
    this.sun = new THREE.DirectionalLight(0xfff0d6, 3.2);
    this.sun.castShadow = true;
    const sc = this.sun.shadow.camera;
    sc.left = -34; sc.right = 34; sc.top = 52; sc.bottom = -34; sc.near = 1; sc.far = 160;
    this.sun.shadow.mapSize.set(1024, 1024);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.05;
    this.scene.add(this.hemi, this.sun, this.sun.target);
  }

  buildSky() {
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        top: { value: new THREE.Color('#2e84df') },
        mid: { value: new THREE.Color('#8fd0ff') },
        hor: { value: new THREE.Color('#ffe3bd') },
      },
      vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, fog: false,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1000, 32, 16), mat);
    this.sky.renderOrder = -10;
    this.scene.add(this.sky);

    this.far = new THREE.Group();
    this.scene.add(this.far);
    const img = images.skyline_tile;
    if (img) {
      const R = 640, arc = Math.PI * 1.3, aspect = img.width / img.height;
      const tiles = Math.max(2, Math.round((R * arc) / (R * 0.34 * aspect)));
      const H = (R * arc) / (tiles * aspect);
      const tex = makeTexture(img, { repeat: true });
      tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.repeat.set(-tiles, 1);
      const geo = new THREE.CylinderGeometry(R, R, H, 96, 1, true, Math.PI - arc / 2, arc);
      const sky = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        map: tex, transparent: true, side: THREE.BackSide, depthWrite: false, fog: false,
      }));
      sky.material.color.setRGB(0.96, 0.95, 0.98);
      this.skylineMat = sky.material;
      sky.position.y = H / 2 - 24;
      sky.renderOrder = -9;
      this.far.add(sky);
    }
    this.clouds = [];
    const ctex = [1, 2, 3].map((s) => makeTexture(cloudCanvas(s * 31)));
    for (let i = 0; i < 11; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: ctex[i % 3], transparent: true, depthWrite: false, fog: false, opacity: 0.96,
      }));
      const w = C.rand(170, 300);
      sp.scale.set(w, w * 0.5, 1);
      sp.position.set(C.rand(-650, 650), C.rand(120, 260), C.rand(-420, -760));
      sp.renderOrder = -8;
      this.far.add(sp);
      this.clouds.push(sp);
    }
  }

  buildTrack() {
    const T = new THREE.Group();
    this.track = T;
    this.scene.add(T);
    const len = C.TRACK_LEN, z0 = C.TRACK_BACK, zc = z0 - len / 2;

    const gravel = gravelCanvas();
    const gTex = makeTexture(gravel, { repeat: true });
    gTex.repeat.set((2 * C.WALL_X) / 4.4, len / 4.4);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(2 * C.WALL_X, len).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ map: gTex, roughness: 1 }));
    ground.position.set(0, 0, zc);
    ground.receiveShadow = true;
    T.add(ground);

    const bTex = gTex.clone();   // shares the canvas Source: one GPU upload for both gravel textures, own repeat
    bTex.repeat.set(3.1 / 4.4, len / 4.4);
    const bedMat = new THREE.MeshStandardMaterial({
      map: bTex, color: 0x9a8a78, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1,
    });
    for (let l = 0; l < 3; l++) {
      const bed = new THREE.Mesh(new THREE.PlaneGeometry(3.1, len).rotateX(-Math.PI / 2), bedMat);
      bed.position.set(C.laneX(l), 0.01, zc);
      bed.receiveShadow = true;
      T.add(bed);
    }

    const n = Math.floor(len / 1.1);
    const sleepers = new THREE.InstancedMesh(new THREE.BoxGeometry(2.45, 0.12, 0.3),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 }), n * 3);
    const m = new THREE.Matrix4(), col = new THREE.Color();
    let k = 0;
    for (let l = 0; l < 3; l++) {
      for (let i = 0; i < n; i++) {
        m.makeTranslation(C.laneX(l), 0.06, z0 - i * 1.1);
        sleepers.setMatrixAt(k, m);
        col.set('#7b5638').offsetHSL(0, 0, C.rand(-0.05, 0.05));
        sleepers.setColorAt(k++, col);
      }
    }
    sleepers.receiveShadow = true;
    sleepers.frustumCulled = false;
    T.add(sleepers);

    const rails = [];
    for (let l = 0; l < 3; l++) {
      for (const s of [-0.72, 0.72]) {
        rails.push(new THREE.BoxGeometry(0.1, 0.15, len).translate(C.laneX(l) + s, 0.215, zc));
        rails.push(new THREE.BoxGeometry(0.24, 0.05, len).translate(C.laneX(l) + s, 0.14, zc));
      }
    }
    const railMesh = new THREE.Mesh(mergeGeometries(rails, false),
      new THREE.MeshStandardMaterial({ color: 0xc4ccd3, metalness: 0.85, roughness: 0.32 }));
    railMesh.receiveShadow = true;
    T.add(railMesh);

    const cTex = makeTexture(concreteCanvas(), { repeat: true });
    cTex.repeat.set(len / 8.8, 1);
    const wallMat = new THREE.MeshStandardMaterial({ map: cTex, roughness: 0.95 });
    const copeMat = new THREE.MeshStandardMaterial({ color: 0xe9e1d3, roughness: 0.9 });
    const swTex = makeTexture(sidewalkCanvas(), { repeat: true });
    swTex.repeat.set(80 / 4.4, len / 4.4);
    const swMat = new THREE.MeshStandardMaterial({ map: swTex, roughness: 0.95 });
    for (const sd of [-1, 1]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(0.7, 2.3, len), wallMat);
      wall.position.set(sd * (C.WALL_X + 0.35), 1.15, zc);
      wall.receiveShadow = wall.castShadow = true;
      const cope = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.16, len), copeMat);
      cope.position.set(sd * (C.WALL_X + 0.35), 2.38, zc);
      cope.castShadow = true;
      const out = new THREE.Mesh(new THREE.PlaneGeometry(80, len).rotateX(-Math.PI / 2), swMat);
      out.position.set(sd * (C.WALL_X + 0.7 + 40), 0.02, zc);
      T.add(wall, cope, out);
    }

    // Repeating dressing: gantries, wires, lamps, cable troughs, cabinets (one draw call per material).
    const steel = [], wires = [], lamps = [], bulbs = [];
    const P = C.PERIOD, count = Math.floor(len / P);
    for (let i = 0; i < count; i++) {
      const z = z0 - i * P - 4;
      for (const sd of [-1, 1]) {
        steel.push(pbox(0.38, 8.9, 0.38, sd * 5.25, 4.45, z, '#e2583a'));
        steel.push(pbox(0.8, 0.22, 0.8, sd * 5.25, 0.11, z, '#4a4440'));
      }
      steel.push(pbox(11.1, 0.44, 0.44, 0, 8.7, z, '#e2583a'));
      steel.push(pbox(11.1, 0.16, 0.16, 0, 8.08, z, '#e2583a'));
      for (let b = -4; b <= 4; b++) {
        const g = new THREE.BoxGeometry(0.12, 0.74, 0.12).rotateZ(b % 2 ? 0.62 : -0.62).translate(b * 1.2, 8.39, z);
        steel.push(paint(g, '#c94a30'));
      }
      const zl = z0 - i * P - P / 2;
      for (const sd of [-1, 1]) {
        const x = sd * (C.WALL_X - 0.45);
        lamps.push(paint(new THREE.CylinderGeometry(0.07, 0.1, 5.0, 8).translate(x, 2.5, zl), '#2f4a40'));
        lamps.push(pbox(1.1, 0.09, 0.09, x - sd * 0.5, 4.95, zl, '#2f4a40'));
        lamps.push(pbox(0.55, 0.18, 0.32, x - sd * 1.05, 4.92, zl, '#2f4a40'));
        bulbs.push(pbox(0.42, 0.05, 0.22, x - sd * 1.05, 4.82, zl, '#ffffff'));
        lamps.push(pbox(0.6, 1.15, 0.85, sd * (C.WALL_X - 0.55), 0.58, z0 - i * P - (sd < 0 ? 9 : 19), '#9aa39c'));
      }
    }
    for (const sd of [-1, 1]) lamps.push(pbox(0.55, 0.3, len, sd * (C.WALL_X - 0.28), 0.15, zc, '#b9b1a4'));
    for (let l = 0; l < 3; l++) {
      wires.push(pbox(0.026, 0.026, len, C.laneX(l), 7.45, zc, '#2a2a2a'));
      wires.push(pbox(0.022, 0.022, len, C.laneX(l), 7.98, zc, '#2a2a2a'));
      for (let z = z0; z > z0 - len; z -= 4.4) wires.push(pbox(0.014, 0.53, 0.014, C.laneX(l), 7.715, z, '#2a2a2a'));
      for (let i = 0; i < count; i++) wires.push(pbox(0.06, 0.62, 0.06, C.laneX(l), 7.77, z0 - i * P - 4, '#3a3633'));
    }
    const vmat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.15 });
    // gantry steel dissolves only within ~3 m of the lens: during a jetpack climb / descent the camera passes the
    // beam height, and a beam crossing the near plane would otherwise black out the view for a frame or two
    const smat = vmat.clone();
    smat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
varying float vViewZ;`)
        .replace('#include <project_vertex>', `#include <project_vertex>
vViewZ = -mvPosition.z;`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
varying float vViewZ;`)
        .replace('void main() {', `void main() {
          float keepS = smoothstep(0.6, 3.2, vViewZ);
          if (fract(sin(dot(floor(gl_FragCoord.xy), vec2(12.9898, 78.233))) * 43758.5453) > keepS) discard;`);
    };
    const steelMesh = new THREE.Mesh(mergeGeometries(steel, false), smat);
    // Shadow pass (1024 map, redrawn every frame): the 528 m gantry / lamp merges are never culled, so lamps cast none and
    // the steel only on desktop (its stripes across the track are a depth cue there)
    steelMesh.receiveShadow = true;
    steelMesh.castShadow = !isCoarsePointer();
    const lampMesh = new THREE.Mesh(mergeGeometries(lamps, false), vmat);
    lampMesh.receiveShadow = true;
    // Wires dissolve (screen-door dither) close to the camera so they never slice across the view.
    const wmat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.15 });
    wmat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying float vViewZ;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvViewZ = -mvPosition.z;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vViewZ;')
        .replace('void main() {', `void main() {
          float keep = smoothstep(7.0, 17.0, vViewZ);
          if (fract(sin(dot(floor(gl_FragCoord.xy), vec2(12.9898, 78.233))) * 43758.5453) > keep) discard;`);
    };
    const wireMesh = new THREE.Mesh(mergeGeometries(wires, false), wmat);
    const bulbMesh = new THREE.Mesh(mergeGeometries(bulbs, false), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.7, 1.5, 1.1) }));
    this.bulbMat = bulbMesh.material;
    T.add(steelMesh, lampMesh, wireMesh, bulbMesh);
    for (const o of [steelMesh, lampMesh, wireMesh, bulbMesh, railMesh]) o.frustumCulled = false;
  }

  buildCity() {
    const box = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    box.clearGroups();
    box.addGroup(0, 6, 0);   // +x face carries the facade
    box.addGroup(6, 30, 1);
    this.types = [];
    for (let i = 1; i <= 4; i++) {
      const src = images[`facade_0${i}`] || fallbackFacadeCanvas(i - 1);
      const mats = [
        new THREE.MeshStandardMaterial({ map: makeTexture(src), roughness: 0.92,
          emissive: 0xffffff, emissiveMap: makeTexture(windowGlowCanvas(src, 71 * i)), emissiveIntensity: 0 }),
        new THREE.MeshStandardMaterial({ color: FACADE_TINT[i - 1], roughness: 0.95 }),
      ];
      const im = new THREE.InstancedMesh(box, mats, 160);
      im.castShadow = true;
      im.receiveShadow = false;
      im.frustumCulled = false;
      im.count = 0;
      this.root.add(im);
      this.types.push({ im, aspect: src.width / src.height });
    }
    const unit = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    // parapets, water towers and billboard frames cast no shadow (shadow pass cost; buildings, walls and trains carry it)
    this.parapets = new THREE.InstancedMesh(unit, new THREE.MeshStandardMaterial({ color: 0x6e5c4e, roughness: 0.9 }), 640);

    const tw = [];
    for (const x of [-0.9, 0.9]) for (const z of [-0.9, 0.9]) tw.push(pbox(0.18, 3, 0.18, x, 1.5, z, '#5a4636'));
    tw.push(pbox(2.0, 0.1, 0.1, 0, 1.3, 0.9, '#5a4636'), pbox(2.0, 0.1, 0.1, 0, 1.3, -0.9, '#5a4636'));
    tw.push(paint(new THREE.CylinderGeometry(1.55, 1.55, 0.16, 18).translate(0, 3.05, 0), '#5a4636'));
    tw.push(paint(new THREE.CylinderGeometry(1.3, 1.36, 2.6, 18).translate(0, 4.4, 0), '#a06c45'));
    for (const y of [3.75, 4.45, 5.15]) tw.push(paint(new THREE.CylinderGeometry(1.37, 1.37, 0.08, 18).translate(0, y, 0), '#3d3128'));
    tw.push(paint(new THREE.ConeGeometry(1.55, 1.15, 18).translate(0, 6.27, 0), '#4c3b30'));
    this.towers = new THREE.InstancedMesh(mergeGeometries(tw, false),
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }), 160);

    const bw = 8.4, bh = bw * 320 / 1024;
    this.boardSize = [bw, bh];
    const frame = [
      pbox(0.2, 3.2, 0.2, -bw * 0.35, 1.6, -0.25, '#3b3633'), pbox(0.2, 3.2, 0.2, bw * 0.35, 1.6, -0.25, '#3b3633'),
      pbox(bw + 0.3, bh + 0.3, 0.2, 0, 3.0 + bh / 2, -0.12, '#3b3633'),
      pbox(bw, 0.1, 0.6, 0, 2.9, 0.2, '#3b3633'),
    ];
    this.frames = new THREE.InstancedMesh(mergeGeometries(frame, false),
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 }), 40);
    const boardGeo = new THREE.PlaneGeometry(bw, bh).translate(0, 3.0 + bh / 2, 0.04);
    this.boards = [0, 1].map((k) => new THREE.InstancedMesh(boardGeo,
      new THREE.MeshStandardMaterial({ map: makeTexture(billboardCanvas(k)), roughness: 0.6, emissive: 0xffffff, emissiveIntensity: 0.12,
        emissiveMap: null }), 30));
    for (const b of this.boards) b.material.emissiveMap = b.material.map;

    for (const im of [this.parapets, this.towers, this.frames, ...this.boards]) {
      im.frustumCulled = false;
      im.count = 0;
      this.root.add(im);
    }
    // materials darkened / tinted by the zone theme (base colour kept for the multiply)
    this.tinted = [...this.types.flatMap((t) => t.im.material), this.parapets.material, this.towers.material, this.frames.material]
      .map((mat) => ({ mat, base: mat.color.clone() }));

    this.decalMats = [];
    for (let i = 1; i <= 6; i++) {
      const img = images[`graffiti${i}`];
      if (!img) continue;
      this.decalMats.push({
        aspect: img.width / img.height,
        mat: new THREE.MeshStandardMaterial({
          map: makeTexture(img), transparent: true, depthWrite: false, roughness: 0.85,
          polygonOffset: true, polygonOffsetFactor: -2,
        }),
      });
    }
    this.decalGeo = new THREE.PlaneGeometry(1, 1);
    this.decalPool = [];
  }

  getDecal() {
    const m = this.decalPool.pop() || new THREE.Mesh(this.decalGeo);
    if (!m.parent) this.root.add(m);
    m.visible = true;
    return m;
  }

  fillSegment(seg) {
    for (const d of seg.decals) { d.visible = false; this.decalPool.push(d); }
    seg.decals.length = 0;
    seg.buildings.length = 0;
    const end = seg.s + C.SEG_LEN;
    for (const side of [-1, 1]) {
      let s = seg.s + (side < 0 ? 0.01 : 2.6);
      while (s < end - 3) {
        const type = Math.floor(Math.random() * this.types.length);
        const asp = this.types[type].aspect;
        let H = C.rand(14, 19) * (Math.random() < 0.18 ? 1.35 : 1);
        let Lz = H * asp;
        if (s + Lz > end) { Lz = end - s; H = Lz / asp; if (H < 10) break; }
        const depth = C.rand(10, 16);
        const setback = Math.random() < 0.3 ? C.rand(0.4, 2.4) : 0;
        seg.buildings.push({
          type, side, H, Lz, depth, x: side * (BX + setback + depth / 2), zc: -(s + Lz / 2),
          tint: C.rand(0.9, 1.04), tower: Math.random() < 0.3, board: -1,
          tz: C.rand(-0.25, 0.25), tx: C.rand(-0.2, 0.2),
        });
        s += Lz + (Math.random() < 0.16 ? C.rand(1.5, 4) : 0.02);
      }
    }
    if (seg.buildings.length && Math.random() < 0.5) {
      const b = C.pick(seg.buildings);
      b.board = Math.random() < 0.6 ? 0 : 1;
      b.tower = false;
    }
    if (this.decalMats.length) {
      const n = C.randi(2, 3);
      for (let i = 0; i < n; i++) {
        const d = C.pick(this.decalMats), side = Math.random() < 0.5 ? -1 : 1;
        const h = C.rand(1.25, 1.65), w = Math.min(h * d.aspect, 4.2);
        const m = this.getDecal();
        m.material = d.mat;
        m.scale.set(w, w / d.aspect, 1);
        m.position.set(side * (C.WALL_X - 0.012), 1.1, -(seg.s + (i + C.rand(0.15, 0.85)) * (C.SEG_LEN / n)));
        m.rotation.set(0, side < 0 ? Math.PI / 2 : -Math.PI / 2, 0);
        seg.decals.push(m);
      }
    }
  }

  layoutBuildings() {
    const counts = this.types.map(() => 0);
    let np = 0, nt = 0, nf = 0;
    const nb = [0, 0];
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
    const col = new THREE.Color(), up = new THREE.Vector3(0, 1, 0);
    for (const seg of this.segments) {
      for (const b of seg.buildings) {
        const t = this.types[b.type];
        q.setFromAxisAngle(up, b.side < 0 ? 0 : Math.PI);
        m.compose(p.set(b.x, 0, b.zc), q, s.set(b.depth, b.H, b.Lz));
        t.im.setMatrixAt(counts[b.type], m);
        t.im.setColorAt(counts[b.type]++, col.setScalar(b.tint));
        m.compose(p.set(b.x, b.H + (np % 2) * 0.012, b.zc), q, s.set(b.depth + 0.35 + (np % 3) * 0.014, 0.5, b.Lz + 0.35));
        this.parapets.setMatrixAt(np, m);
        this.parapets.setColorAt(np++, col.setScalar(b.tint));
        if (b.tower && b.Lz > 5) {
          q.setFromAxisAngle(up, b.tz * 6);
          m.compose(p.set(b.x + b.tx * b.depth, b.H + 0.5, b.zc + b.tz * b.Lz), q, s.set(1, 1, 1));
          this.towers.setMatrixAt(nt++, m);
        }
        if (b.board >= 0) {
          q.setFromAxisAngle(up, b.side < 0 ? Math.PI / 2 - 0.55 : -Math.PI / 2 + 0.55);
          m.compose(p.set(b.x - b.side * (b.depth / 2 - 3), b.H + 0.5, b.zc), q, s.set(1, 1, 1));
          this.frames.setMatrixAt(nf++, m);
          this.boards[b.board].setMatrixAt(nb[b.board]++, m);
        }
      }
    }
    this.types.forEach((t, i) => {
      t.im.count = counts[i];
      t.im.instanceMatrix.needsUpdate = true;
      if (t.im.instanceColor) t.im.instanceColor.needsUpdate = true;
    });
    this.parapets.count = np;
    this.towers.count = nt;
    this.frames.count = nf;
    this.boards.forEach((b, i) => { b.count = nb[i]; b.instanceMatrix.needsUpdate = true; });
    for (const im of [this.parapets, this.towers, this.frames]) im.instanceMatrix.needsUpdate = true;
    if (this.parapets.instanceColor) this.parapets.instanceColor.needsUpdate = true;
  }

  reset(dist) {
    this.segments.forEach((seg, i) => { seg.s = dist - 45 + i * C.SEG_LEN; this.fillSegment(seg); });
    this.layoutBuildings();
  }

  update(dt, dist, camera, speed = 0) {
    this.track.position.z = dist % C.PERIOD;
    this.sky.position.copy(camera.position);
    this.far.position.set(camera.position.x, 0, camera.position.z);
    for (const c of this.clouds) {
      c.position.x += dt * 4;
      if (c.position.x > 700) c.position.x = -700;
    }
    const texel = 68 / this.sun.shadow.mapSize.x;
    this.sun.target.position.set(Math.round(camera.position.x / texel) * texel, 0, -22);
    this.sun.position.copy(this.sun.target.position).add(this.look.sunDir);
    this.updateAmbience(dt, dist, camera, speed);
    let dirty = false;
    for (const seg of this.segments) {
      if (dist - (seg.s + C.SEG_LEN) > 45) {
        seg.s += C.SEG_COUNT * C.SEG_LEN;
        this.fillSegment(seg);
        dirty = true;
      }
    }
    if (dirty) this.layoutBuildings();
  }
}
