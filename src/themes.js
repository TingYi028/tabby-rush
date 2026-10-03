import * as THREE from 'three';

/*
 * Zone themes: the run cycles 午後 → 黃昏 → 霓虹夜城 → 雨天工業區 every ZONE.len metres.
 * Every value here is a uniform / colour / intensity, so switching never recompiles a shader.
 * Colours: hex strings are sRGB, `lin()` values are linear RGB (may exceed 1 for bloom).
 */

export const ZONE = { len: 1000, fade: 3 };   // metres per zone, seconds to cross-fade (mutable for #debug tests)

const lin = (r, g, b) => new THREE.Color().setRGB(r, g, b);
const hex = (h) => new THREE.Color(h);
const vec = (x, y, z) => new THREE.Vector3(x, y, z);

export const THEMES = [
  {
    name: '午後', toast: '午後區域', tone: 'sun',
    skyTop: hex('#2e84df'), skyMid: hex('#8fd0ff'), skyHor: hex('#ffe3bd'),
    fog: hex('#f3d9b1'), fogNear: 75, fogFar: 300,
    hemiSky: hex('#d2e8ff'), hemiGround: hex('#e2b98d'), hemi: 1.55,
    sunColor: hex('#fff0d6'), sun: 3.2, sunDir: vec(-18, 40, 38),   // sun offset from its target
    env: 0.45, exposure: 1.02, bloom: 0.55, bloomThreshold: 1.05,
    building: lin(1, 1, 1),   // diffuse multiplier for facades / parapets / towers / billboard frames
    windows: 0,               // lit-window emissive strength
    boards: 0.12,             // billboard emissive
    lamps: 1,                 // track lamp bulb brightness
    skyline: lin(0.96, 0.95, 0.98), clouds: lin(1, 1, 1), hero: lin(1, 0.97, 0.93),
    rain: 0, headlamp: 0,
    spawn: { moving: 0, barriers: 0 },
  },
  {
    name: '黃昏', toast: '黃昏區域', tone: 'warn',
    skyTop: hex('#3a4690'), skyMid: hex('#e58aa2'), skyHor: hex('#ffad62'),
    fog: hex('#eaa47e'), fogNear: 65, fogFar: 285,
    hemiSky: hex('#ffc0a0'), hemiGround: hex('#7c5670'), hemi: 1.2,
    sunColor: hex('#ff9a4e'), sun: 2.7, sunDir: vec(-40, 15, 30),  // low, raking sun: long shadows
    env: 0.34, exposure: 1.0, bloom: 0.68, bloomThreshold: 0.98,
    building: lin(0.88, 0.8, 0.82), windows: 0.4, boards: 0.45, lamps: 1.8,
    skyline: lin(1.0, 0.7, 0.62), clouds: lin(1.0, 0.64, 0.56), hero: lin(1, 0.9, 0.84),
    rain: 0, headlamp: 0,
    spawn: { moving: 0, barriers: 0 },
  },
  {
    name: '霓虹夜城', toast: '霓虹夜城區域', tone: 'hot',
    skyTop: hex('#070a24'), skyMid: hex('#24195a'), skyHor: hex('#6a2c7c'),
    fog: hex('#1b1636'), fogNear: 40, fogFar: 240,
    hemiSky: hex('#5a68ff'), hemiGround: hex('#c24ea2'), hemi: 0.66,
    sunColor: hex('#9fb0ff'), sun: 0.75, sunDir: vec(-14, 40, 30),  // moonlight
    env: 0.13, exposure: 1.12, bloom: 0.95, bloomThreshold: 0.8,
    building: lin(0.32, 0.33, 0.45), windows: 1.15, boards: 1.15, lamps: 2.6,
    skyline: lin(0.2, 0.18, 0.4), clouds: lin(0.17, 0.15, 0.32), hero: lin(0.88, 0.86, 0.98),
    rain: 0, headlamp: 0.45,
    spawn: { moving: 0.35, movingGap: 2, barriers: 0 },  // ~+25% oncoming trains (extra chance per row + tighter spacing)
  },
  {
    name: '雨天工業區', toast: '雨天工業區', tone: 'sun',
    skyTop: hex('#4c5f64'), skyMid: hex('#7a8d90'), skyHor: hex('#a7b3b0'),
    fog: hex('#8b9a9a'), fogNear: 28, fogFar: 200,
    hemiSky: hex('#b6caca'), hemiGround: hex('#596059'), hemi: 1.3,
    sunColor: hex('#d4e2ea'), sun: 1.1, sunDir: vec(-10, 42, 28),
    env: 0.36, exposure: 1.0, bloom: 0.6, bloomThreshold: 1.0,
    building: lin(0.62, 0.68, 0.68), windows: 0.18, boards: 0.3, lamps: 1.6,
    skyline: lin(0.52, 0.6, 0.62), clouds: lin(0.6, 0.65, 0.68), hero: lin(0.92, 0.94, 0.95),
    rain: 1, headlamp: 0.15,
    spawn: { moving: 0, barriers: 0.3 },     // hurdles / overheads +30%
  },
];

/** Look inside a tunnel; blended over the zone theme by the tunnel darkness factor. */
export const TUNNEL_LOOK = {
  fog: hex('#0b0c10'), fogNear: 14, fogFar: 78,
  hemiSky: hex('#76767c'), hemiGround: hex('#1e1b1a'), hemi: 0.3,
  sun: 0, env: 0.08, exposure: 1.06, bloom: 0.85, bloomThreshold: 0.85,
  hero: lin(0.86, 0.82, 0.78), rain: 0, headlamp: 1,
};

const isBlendable = (v) => typeof v === 'number' || (v && (v.isColor || v.isVector3));
const KEYS = Object.keys(THEMES[0]).filter((k) => isBlendable(THEMES[0][k]));
const TUNNEL_KEYS = Object.keys(TUNNEL_LOOK);

/** Zone theme index for a track position. */
export function themeIndexAt(s) {
  return Math.floor(Math.max(0, s) / ZONE.len) % THEMES.length;
}

/** A mutable look object (deep copy of theme 0) for blendLook to write into. */
export function makeLook() {
  const out = {};
  for (const k of KEYS) { const v = THEMES[0][k]; out[k] = typeof v === 'number' ? v : v.clone(); }
  return out;
}

/** out = lerp(THEMES[a], THEMES[b], t), then pulled toward TUNNEL_LOOK by `dark`. No allocations. */
export function blendLook(out, a, b, t, dark = 0) {
  const A = THEMES[a], B = THEMES[b];
  for (let i = 0; i < KEYS.length; i++) {
    const k = KEYS[i], va = A[k], vb = B[k];
    if (typeof va === 'number') out[k] = va + (vb - va) * t;
    else if (va.isColor) out[k].lerpColors(va, vb, t);
    else out[k].lerpVectors(va, vb, t);
  }
  if (dark <= 0) return out;
  for (let i = 0; i < TUNNEL_KEYS.length; i++) {
    const k = TUNNEL_KEYS[i], v = TUNNEL_LOOK[k];
    if (typeof v === 'number') out[k] += (v - out[k]) * dark;
    else out[k].lerp(v, dark);
  }
  return out;
}
