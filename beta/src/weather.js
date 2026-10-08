import * as THREE from 'three';
import { FXP } from './settings.js';

/*
 * Weather: GPU-animated particles in a box around the camera, one draw call each, no per-frame CPU work beyond a few
 * uniforms. Particles are fixed in the world, so the run carries the camera through them.
 *  - Rain: streaks that slant toward the viewer with speed (the place's blendable `rain` amount drives it).
 *  - Particles: one billboard shader for the place presets below (themes.js `weather`): lanterns, petals, spray,
 *    embers. Only uniforms change between presets, so switching never recompiles a program.
 *  - Weather bundles both for world.js: Weather.blend cross-fades the presets of two places.
 */
const COUNT = 900;
const BOX = [28, 15, 46];   // x width, y height, z depth (mostly ahead of the camera)
const reduce = matchMedia('(prefers-reduced-motion: reduce)');

const VERT = /* glsl */`
attribute vec3 aSeed;      // x, z, phase (0..1)
attribute vec2 aCorner;    // x: 0 head / 1 tail, y: side -1 / 1
uniform vec3 uCam;
uniform float uFall, uRun, uSpeed, uWidth, uShutter;
varying float vA;
void main() {
  vec3 box = vec3(${BOX[0].toFixed(1)}, ${BOX[1].toFixed(1)}, ${BOX[2].toFixed(1)});
  vec3 p;
  p.x = uCam.x + (aSeed.x - 0.5) * box.x;
  p.y = uCam.y + 7.0 - mod(aSeed.z * box.y + uFall, box.y);
  p.z = uCam.z + 4.0 - box.z + mod(aSeed.y * box.z + uRun, box.z);
  // streak along the drop's velocity relative to the running camera
  vec3 vel = vec3(-1.5, -26.0, uSpeed);
  vec3 tail = p - vel * uShutter;
  vec4 vh = modelViewMatrix * vec4(p, 1.0);
  vec4 vt = modelViewMatrix * vec4(tail, 1.0);
  vec4 v = mix(vh, vt, aCorner.x);
  vec2 d = vt.xy - vh.xy;
  d = length(d) > 1e-4 ? normalize(d) : vec2(0.0, 1.0);
  v.xy += vec2(-d.y, d.x) * aCorner.y * uWidth;
  float z = -v.z;
  vA = smoothstep(0.6, 2.5, z) * (1.0 - smoothstep(22.0, 40.0, z)) * mix(1.0, 0.1, aCorner.x);
  gl_Position = projectionMatrix * v;
}`;

const FRAG = /* glsl */`
uniform vec3 uColor;
uniform float uOpacity;
varying float vA;
void main() {
  gl_FragColor = vec4(uColor, vA * uOpacity);
}`;

export class Rain {
  constructor() {
    const seed = new Float32Array(COUNT * 4 * 3), corner = new Float32Array(COUNT * 4 * 2), idx = [];
    for (let i = 0; i < COUNT; i++) {
      const sx = Math.random(), sz = Math.random(), ph = Math.random();
      for (let j = 0; j < 4; j++) {
        const v = i * 4 + j;
        seed.set([sx, sz, ph], v * 3);
        corner.set([j >> 1, j & 1 ? 1 : -1], v * 2);
      }
      const b = i * 4;
      idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);   // counter-clockwise in view space (front-facing)
    }
    const geo = new THREE.BufferGeometry();
    // positions are generated in the shader; the attribute only sets the vertex count
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(COUNT * 4 * 3), 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 3));
    geo.setAttribute('aCorner', new THREE.BufferAttribute(corner, 2));
    geo.setIndex(idx);
    this.uniforms = {
      uCam: { value: new THREE.Vector3() }, uFall: { value: 0 }, uRun: { value: 0 }, uSpeed: { value: 20 },
      uWidth: { value: 0.011 }, uShutter: { value: 0.035 },
      uColor: { value: new THREE.Color(0.78, 0.86, 0.95) }, uOpacity: { value: 0 },
    };
    this.mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: false, fog: false,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 7;
    this.amount = 0;
  }

  /** amount 0..1 (theme rain × shelter). */
  setAmount(a) { this.amount = a; }

  update(dt, dist, speed, camera) {
    const op = this.amount * (reduce.matches ? 0.35 : 0.55);
    this.mesh.visible = op > 0.004;
    if (!this.mesh.visible) return;
    const u = this.uniforms;
    u.uOpacity.value = op;
    u.uCam.value.copy(camera.position);
    // wrap at whole multiples of the box so the shader's mod() never jumps
    u.uFall.value = (u.uFall.value + dt * (reduce.matches ? 12 : 26)) % (BOX[1] * 500);
    u.uRun.value = dist % (BOX[2] * 200);
    u.uSpeed.value = speed;
  }
}

/* ---------- place presets (lanterns, petals, spray, embers, snow, neon, laundry, sparkle, confetti, steam) ---------- */

/**
 * One entry per themes.js `weather` name (rain is the Rain class above). `count` is the particle count at the "high"
 * effects level (scaled by FXP.particles); `size` the half-width of a particle in metres; `color` linear RGB (above 1
 * glows through bloom); `fall` m/s down (negative: rises); `wind` m/s sideways; `sway` / `swayF` the wobble (m, rad/s);
 * `spin` rad/s of the billboard; `y` the lowest / highest height; `grow` extra size at the top of the height range
 * (steam widens as it rises); `shape` 0 soft dot, 1 petal, 2 mist, 3 ember, 4 lantern, 5 glint, 6 confetti (palette),
 * 7 steam puff, 8 neon (pink / cyan dots), 9 cloth scrap; `twinkle` rad/s of the brightness wobble (0 = steady; slow, and
 * off in calm mode: nothing blinks with 減少閃爍); `opacity` at full amount; `add` additive blending (glow) or normal alpha.
 */
export const WEATHER = {
  lanterns: { count: 70, size: 0.2, color: [1.7, 0.85, 0.3], fall: -0.45, wind: 0.25, sway: 0.5, swayF: 0.9, spin: 0, grow: 0, y: [1.2, 9], shape: 4, twinkle: 1.3, opacity: 0.85, add: true },
  petals: { count: 260, size: 0.075, color: [1, 0.74, 0.82], fall: 1.1, wind: 1.4, sway: 0.6, swayF: 1.7, spin: 3, grow: 0, y: [0.2, 7], shape: 1, twinkle: 0, opacity: 0.9, add: false },
  spray: { count: 220, size: 0.06, color: [0.95, 0.98, 1], fall: -0.3, wind: 2.2, sway: 0.3, swayF: 2.4, spin: 0, grow: 0, y: [0.2, 4.5], shape: 2, twinkle: 0, opacity: 0.5, add: false },
  embers: { count: 140, size: 0.045, color: [3, 1.1, 0.25], fall: -1.3, wind: 0.5, sway: 0.45, swayF: 2.2, spin: 0, grow: 0, y: [0.2, 7], shape: 3, twinkle: 5, opacity: 1, add: true },
  snow: { count: 260, size: 0.05, color: [0.97, 0.98, 1], fall: 1.0, wind: 0.8, sway: 0.5, swayF: 1.3, spin: 0, grow: 0, y: [0.2, 8], shape: 0, twinkle: 0, opacity: 0.9, add: false },
  neon: { count: 60, size: 0.1, color: [1, 1, 1], fall: -0.35, wind: 0.2, sway: 0.4, swayF: 0.8, spin: 0, grow: 0, y: [0.8, 7], shape: 8, twinkle: 0, opacity: 0.6, add: true },
  laundry: { count: 50, size: 0.07, color: [1, 0.85, 0.7], fall: 0.15, wind: 3, sway: 0.35, swayF: 3, spin: 4, grow: 0, y: [0.5, 5], shape: 9, twinkle: 0, opacity: 0.55, add: false },
  sparkle: { count: 120, size: 0.08, color: [1.6, 1.2, 1.4], fall: -0.25, wind: 0.1, sway: 0.2, swayF: 0.9, spin: 0, grow: 0, y: [0.5, 6], shape: 5, twinkle: 2.5, opacity: 0.8, add: true },
  confetti: { count: 120, size: 0.06, color: [1, 1, 1], fall: 1.3, wind: 0.6, sway: 0.8, swayF: 2, spin: 5, grow: 0, y: [0.3, 8], shape: 6, twinkle: 0, opacity: 0.9, add: false },
  steam: { count: 50, size: 0.5, color: [1, 1, 1], fall: -0.6, wind: 0.3, sway: 0.3, swayF: 1.1, spin: 0, grow: 1.2, y: [0.2, 4], shape: 7, twinkle: 0, opacity: 0.35, add: false },
};
const MAX_PARTICLES = 280;

const P_VERT = /* glsl */`
attribute vec3 aSeed;      // x, z, phase (0..1)
attribute vec2 aCorner;    // -1 / 1 quad corner
uniform vec3 uCam;
uniform vec2 uY;           // lowest / highest world height
uniform float uFall, uRun, uWind, uTime, uSize, uSway, uSwayF, uSpin, uTwinkle, uGrow;
varying vec2 vUv;
varying float vA, vV;
void main() {
  vec3 box = vec3(${BOX[0].toFixed(1)}, 1.0, ${BOX[2].toFixed(1)});
  float h = uY.y - uY.x, ph = aSeed.z, vary = fract(ph * 7.31);
  vec3 p;
  p.x = uCam.x + mod(aSeed.x * box.x + uWind, box.x) - box.x * 0.5 + sin(uTime * uSwayF + ph * 6.283) * uSway;
  p.y = uY.y - mod(ph * h + uFall, h);
  p.z = uCam.z + 4.0 - box.z + mod(aSeed.y * box.z + uRun, box.z);
  float ang = uSpin * uTime * (0.5 + vary) + ph * 6.283;
  mat2 rot = mat2(cos(ang), sin(ang), -sin(ang), cos(ang));
  vec4 v = modelViewMatrix * vec4(p, 1.0);
  float hf = (p.y - uY.x) / h;   // 0 at the lowest height, 1 at the highest: particles fade in and out there instead of popping
  v.xy += rot * aCorner * uSize * (0.7 + 0.6 * vary) * (1.0 + uGrow * hf);
  float z = -v.z;
  vA = smoothstep(0.8, 3.0, z) * (1.0 - smoothstep(20.0, 40.0, z)) * smoothstep(0.0, 0.1, hf) * (1.0 - smoothstep(0.85, 1.0, hf))
     * (uTwinkle > 0.0 ? 0.65 + 0.35 * sin(uTime * uTwinkle + ph * 40.0) : 1.0);
  vUv = aCorner;
  vV = vary;
  gl_Position = projectionMatrix * v;
}`;

const P_FRAG = /* glsl */`
uniform vec3 uColor;
uniform float uOpacity, uShape;
varying vec2 vUv;
varying float vA, vV;
void main() {
  float r = length(vUv), a;
  vec3 c = uColor;
  if (uShape < 0.5) a = pow(smoothstep(1.0, 0.0, r), 2.0);                       // soft dot
  else if (uShape < 1.5) {                                                       // petal: a squashed ellipse, paler at one end
    a = smoothstep(1.0, 0.7, length(vec2(vUv.x, vUv.y * 1.7)));
    c = mix(uColor, vec3(1.0), 0.3 * (vUv.y * 0.5 + 0.5));
  } else if (uShape < 2.5) a = smoothstep(1.0, 0.1, r) * 0.7;                    // mist
  else if (uShape < 3.5) {                                                       // ember: hot core, soft glow
    float core = smoothstep(0.4, 0.0, r);
    a = core + 0.45 * pow(smoothstep(1.0, 0.0, r), 2.0);
    c = mix(uColor, vec3(3.0, 2.4, 1.2), core);
  } else if (uShape < 4.5) {                                                     // lantern: a lit body inside a halo
    float body = smoothstep(0.62, 0.5, length(vec2(vUv.x, vUv.y * 0.82)));
    a = max(body, 0.5 * pow(smoothstep(1.0, 0.0, r), 2.0));
    c = uColor * (0.7 + 0.9 * body);
  } else if (uShape < 5.5) {                                                     // glint: a soft core with a four-point cross
    float arms = smoothstep(0.14, 0.0, min(abs(vUv.x), abs(vUv.y))) * smoothstep(1.0, 0.0, r);
    a = pow(smoothstep(1.0, 0.0, r), 3.0) + 0.8 * arms;
  } else if (uShape < 6.5) {                                                     // confetti: a paper rectangle in one of five colours (no green)
    a = smoothstep(1.0, 0.85, max(abs(vUv.x), abs(vUv.y) * 1.7));
    float k = floor(vV * 5.0);
    c = k < 1.0 ? vec3(1.0, 0.25, 0.22) : k < 2.0 ? vec3(1.0, 0.85, 0.2) : k < 3.0 ? vec3(0.25, 0.5, 1.0) : k < 4.0 ? vec3(1.0, 0.55, 0.15) : vec3(1.0, 0.5, 0.75);
  } else if (uShape < 7.5) a = pow(smoothstep(1.0, 0.0, r), 1.5);                // steam: a soft puff
  else if (uShape < 8.5) {                                                       // neon: a soft dot, pink or cyan per particle
    a = pow(smoothstep(1.0, 0.0, r), 2.0);
    c = vV < 0.5 ? vec3(1.4, 0.4, 0.9) : vec3(0.3, 1.2, 1.5);
  } else {                                                                       // cloth scrap: a small flapping rectangle
    a = smoothstep(1.0, 0.8, max(abs(vUv.x), abs(vUv.y) * 1.7));
    c = uColor * (0.8 + 0.4 * vV);
  }
  gl_FragColor = vec4(c, a * vA * uOpacity);
}`;

/** One preset layer: a billboard particle field that takes its numbers from WEATHER[name] (see set). */
export class Particles {
  constructor() {
    const seed = new Float32Array(MAX_PARTICLES * 4 * 3), corner = new Float32Array(MAX_PARTICLES * 4 * 2), idx = [];
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const sx = Math.random(), sz = Math.random(), ph = Math.random();
      for (let j = 0; j < 4; j++) {
        const v = i * 4 + j;
        seed.set([sx, sz, ph], v * 3);
        corner.set([j & 1 ? 1 : -1, j >> 1 ? 1 : -1], v * 2);
      }
      const b = i * 4;
      idx.push(b, b + 1, b + 2, b + 2, b + 1, b + 3);
    }
    const geo = new THREE.BufferGeometry();
    // positions are generated in the shader; the attribute only sets the vertex count
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_PARTICLES * 4 * 3), 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 3));
    geo.setAttribute('aCorner', new THREE.BufferAttribute(corner, 2));
    geo.setIndex(idx);
    this.uniforms = {
      uCam: { value: new THREE.Vector3() }, uY: { value: new THREE.Vector2(0, 1) },
      uFall: { value: 0 }, uRun: { value: 0 }, uWind: { value: 0 }, uTime: { value: 0 },
      uSize: { value: 0.1 }, uSway: { value: 0 }, uSwayF: { value: 1 }, uSpin: { value: 0 }, uTwinkle: { value: 0 }, uGrow: { value: 0 },
      uColor: { value: new THREE.Color() }, uOpacity: { value: 0 }, uShape: { value: 0 },
    };
    this.mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: P_VERT, fragmentShader: P_FRAG,
      transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 8;
    this.mesh.visible = false;
    this.name = '';
    this.preset = null;
    this.amount = 0;
  }

  /** Show preset `name` (empty or unknown: none) at `amount` 0..1. Only uniforms change, never the program. */
  set(name, amount) {
    const P = WEATHER[name];
    this.amount = P ? amount : 0;
    if (!P || name === this.name) return;
    this.name = name;
    this.preset = P;
    const u = this.uniforms;
    u.uColor.value.setRGB(P.color[0], P.color[1], P.color[2]);
    u.uY.value.set(P.y[0], P.y[1]);
    u.uSize.value = P.size;
    u.uSway.value = P.sway;
    u.uSwayF.value = P.swayF;
    u.uSpin.value = P.spin;
    u.uGrow.value = P.grow;
    u.uShape.value = P.shape;
    this.mesh.material.blending = P.add ? THREE.AdditiveBlending : THREE.NormalBlending;
  }

  update(dt, dist, camera) {
    const P = this.preset, calm = reduce.matches || FXP.calm;
    const op = P ? this.amount * P.opacity * (calm ? 0.5 : 1) : 0;
    this.mesh.visible = op > 0.004;
    if (!this.mesh.visible) return;
    const u = this.uniforms, k = calm ? 0.45 : 1;
    u.uOpacity.value = op;
    u.uTwinkle.value = calm ? 0 : P.twinkle;   // 減少閃爍 / reduced motion: nothing blinks
    u.uCam.value.copy(camera.position);
    u.uTime.value = (u.uTime.value + dt * k) % 100000;
    // wrap at whole multiples of the box so the shader's mod() never jumps
    u.uFall.value = (u.uFall.value + dt * k * P.fall) % (500 * (P.y[1] - P.y[0]));
    u.uWind.value = (u.uWind.value + dt * k * P.wind) % (BOX[0] * 500);
    u.uRun.value = dist % (BOX[2] * 200);
    this.mesh.geometry.setDrawRange(0, Math.max(1, Math.round(P.count * FXP.particles)) * 6);
  }
}

/**
 * Everything the sky drops, as world.js uses it: `mesh` (add to the scene), setAmount (rain), blend (the place presets),
 * update (per frame), prewarm (boot shader warm-up). Two particle layers carry the cross-fade between two places.
 */
export class Weather {
  constructor() {
    this.rain = new Rain();
    this.layers = [new Particles(), new Particles()];
    this.mesh = new THREE.Group();
    this.mesh.add(this.rain.mesh, this.layers[0].mesh, this.layers[1].mesh);
  }

  /** Rain amount 0..1 (place rain x shelter). */
  setAmount(a) { this.rain.setAmount(a); }

  /**
   * Place presets `a` -> `b` (themes.js `weather` names) at cross-fade t 0..1; `shelter` 0..1 hides them under a tunnel roof.
   * A preset keeps the layer it already runs on (its seeds and running fall / wind / time), so the particles that were fading in
   * carry on at the next boundary instead of jumping; only a new preset takes a layer over.
   */
  blend(a, b, t, shelter = 0) {
    const k = 1 - shelter, L = this.layers;
    const ia = L[0].name === a ? 0 : L[1].name === a ? 1 : -1;
    if (a === b) {
      const i = ia < 0 ? 0 : ia;
      L[i].set(a, k);
      L[1 - i].set('', 0);
      return;
    }
    const ib = L[0].name === b && ia !== 0 ? 0 : L[1].name === b && ia !== 1 ? 1 : -1;
    const fa = ia >= 0 ? ia : ib === 0 ? 1 : 0;
    L[fa].set(a, (1 - t) * k);
    L[ib >= 0 ? ib : 1 - fa].set(b, t * k);
  }

  update(dt, dist, speed, camera) {
    this.rain.update(dt, dist, speed, camera);
    this.layers[0].update(dt, dist, camera);
    this.layers[1].update(dt, dist, camera);
  }

  /** Boot warm-up: every layer visible so its program compiles in the warm-up render; prewarm(false) hides them again. */
  prewarm(on) {
    this.rain.mesh.visible = on;
    for (const l of this.layers) l.mesh.visible = on;
  }
}
