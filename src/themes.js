import * as THREE from 'three';

/*
 * Places (zones): the run walks through the places below, PLACE.len metres each, in an order drawn per run (resetPlaces:
 * a random start, then shuffled bags, never the same place twice in a row). A place is a look (the numbers here) plus its
 * own art set (`set`: assets/zones/<set>/, 'city' = the shared env / decals set), a weather preset (weather.js) and an
 * optional obstacle skin (objects.js setBarrierSkin). Every blendable value is a uniform / colour / intensity, so
 * switching never recompiles a shader. Colours: hex strings are sRGB, `lin()` values are linear RGB (may exceed 1 for bloom).
 * The four city places are the original zones; the twelve with an art set are visual only (spawn 0 / 0).
 */

export const PLACE = { len: 800, fade: 3 };   // metres per place, seconds to cross-fade (mutable for #debug tests)

const lin = (r, g, b) => new THREE.Color().setRGB(r, g, b);
const hex = (h) => new THREE.Color(h);
const vec = (x, y, z) => new THREE.Vector3(x, y, z);

export const PLACES = [
  {
    id: 'afternoon', name: '午後', toast: '午後區域', tone: 'sun', set: 'city',
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
    weather: '', skin: null,
    spawn: { moving: 0, barriers: 0 },
  },
  {
    id: 'dusk', name: '黃昏', toast: '黃昏區域', tone: 'warn', set: 'city',
    skyTop: hex('#3a4690'), skyMid: hex('#e58aa2'), skyHor: hex('#ffad62'),
    fog: hex('#eaa47e'), fogNear: 65, fogFar: 285,
    hemiSky: hex('#ffc0a0'), hemiGround: hex('#7c5670'), hemi: 1.2,
    sunColor: hex('#ff9a4e'), sun: 2.7, sunDir: vec(-40, 15, 30),  // low, raking sun: long shadows
    env: 0.34, exposure: 1.0, bloom: 0.68, bloomThreshold: 0.98,
    building: lin(0.88, 0.8, 0.82), windows: 0.4, boards: 0.45, lamps: 1.8,
    skyline: lin(1.0, 0.7, 0.62), clouds: lin(1.0, 0.64, 0.56), hero: lin(1, 0.9, 0.84),
    rain: 0, headlamp: 0,
    weather: '', skin: null,
    spawn: { moving: 0, barriers: 0 },
  },
  {
    id: 'neon', name: '霓虹夜城', toast: '霓虹夜城區域', tone: 'hot', set: 'city',
    skyTop: hex('#070a24'), skyMid: hex('#24195a'), skyHor: hex('#6a2c7c'),
    fog: hex('#1b1636'), fogNear: 40, fogFar: 240,
    hemiSky: hex('#5a68ff'), hemiGround: hex('#c24ea2'), hemi: 0.66,
    sunColor: hex('#9fb0ff'), sun: 0.75, sunDir: vec(-14, 40, 30),  // moonlight
    env: 0.13, exposure: 1.12, bloom: 0.95, bloomThreshold: 0.8,
    building: lin(0.32, 0.33, 0.45), windows: 1.15, boards: 1.15, lamps: 2.6,
    skyline: lin(0.2, 0.18, 0.4), clouds: lin(0.17, 0.15, 0.32), hero: lin(0.88, 0.86, 0.98),
    rain: 0, headlamp: 0.45,
    weather: '', skin: null,
    spawn: { moving: 0.35, movingGap: 2, barriers: 0 },  // ~+25% oncoming trains (extra chance per row + tighter spacing)
  },
  {
    id: 'industrial', name: '雨天工業區', toast: '雨天工業區', tone: 'sun', set: 'city',
    skyTop: hex('#4c5f64'), skyMid: hex('#7a8d90'), skyHor: hex('#a7b3b0'),
    fog: hex('#8b9a9a'), fogNear: 28, fogFar: 200,
    hemiSky: hex('#b6caca'), hemiGround: hex('#596059'), hemi: 1.3,
    sunColor: hex('#d4e2ea'), sun: 1.1, sunDir: vec(-10, 42, 28),
    env: 0.36, exposure: 1.0, bloom: 0.6, bloomThreshold: 1.0,
    building: lin(0.62, 0.68, 0.68), windows: 0.18, boards: 0.3, lamps: 1.6,
    skyline: lin(0.52, 0.6, 0.62), clouds: lin(0.6, 0.65, 0.68), hero: lin(0.92, 0.94, 0.95),
    rain: 1, headlamp: 0.15,
    weather: 'rain', skin: null,   // the rain itself is the blendable `rain` amount (Rain in weather.js)
    spawn: { moving: 0, barriers: 0.3 },     // hurdles / overheads +30%
  },
  {
    id: 'nightmarket', name: '夜市', toast: '夜市', tone: 'hot', set: 'nightmarket',   // night, warm bulbs, drifting lanterns
    skyTop: hex('#0b0a22'), skyMid: hex('#3a1b50'), skyHor: hex('#c0523c'),
    fog: hex('#2a1a30'), fogNear: 38, fogFar: 230,   // (every set's skyline haze is painted in its place's fog colour: keep them equal)
    hemiSky: hex('#7a6aa8'), hemiGround: hex('#b8603a'), hemi: 0.8,
    sunColor: hex('#ffb27a'), sun: 0.8, sunDir: vec(-16, 38, 28),
    env: 0.14, exposure: 1.12, bloom: 1.0, bloomThreshold: 0.78,
    building: lin(0.42, 0.38, 0.42), windows: 1.1, boards: 1.2, lamps: 2.8,
    skyline: lin(0.9, 0.9, 0.95), clouds: lin(0.2, 0.15, 0.25), hero: lin(1, 0.9, 0.85),
    rain: 0, headlamp: 0.3,
    weather: 'lanterns', skin: { overhead: 'lanternline' },
    spawn: { moving: 0, barriers: 0 },
  },
  {
    id: 'seawall', name: '海邊堤防', toast: '海邊堤防', tone: 'sun', set: 'seawall',   // bright afternoon, sea spray
    skyTop: hex('#1f8fe8'), skyMid: hex('#7fd0ff'), skyHor: hex('#e6f6ff'),
    fog: hex('#d6ecf2'), fogNear: 80, fogFar: 320,
    hemiSky: hex('#cfeaff'), hemiGround: hex('#d6c7a0'), hemi: 1.6,
    sunColor: hex('#fff3dc'), sun: 3.3, sunDir: vec(-22, 42, 34),
    env: 0.5, exposure: 1.03, bloom: 0.5, bloomThreshold: 1.08,
    building: lin(1, 1, 1), windows: 0, boards: 0.1, lamps: 0.8,
    skyline: lin(0.97, 0.97, 1), clouds: lin(1, 1, 1), hero: lin(1, 0.98, 0.95),
    rain: 0, headlamp: 0,
    weather: 'spray', skin: { hurdle: 'breakwater' },
    spawn: { moving: 0, barriers: 0 },
  },
  {
    id: 'sakura', name: '櫻花季', toast: '櫻花季', tone: 'sun', set: 'sakura',   // soft pink morning, falling petals
    skyTop: hex('#7ab6ef'), skyMid: hex('#f4c9dc'), skyHor: hex('#ffe8e0'),
    fog: hex('#f6dde0'), fogNear: 60, fogFar: 270,
    hemiSky: hex('#ffe4ee'), hemiGround: hex('#d9a8a4'), hemi: 1.45,
    sunColor: hex('#fff0e2'), sun: 2.6, sunDir: vec(-26, 32, 36),
    env: 0.42, exposure: 1.03, bloom: 0.62, bloomThreshold: 1.0,
    building: lin(1, 0.96, 0.97), windows: 0, boards: 0.1, lamps: 1.0,
    skyline: lin(0.98, 0.93, 0.97), clouds: lin(1, 0.92, 0.95), hero: lin(1, 0.95, 0.94),
    rain: 0, headlamp: 0,
    weather: 'petals', skin: null,
    spawn: { moving: 0, barriers: 0 },
  },
  {
    id: 'miaokou', name: '廟口', toast: '廟口', tone: 'warn', set: 'miaokou',   // dusk, embers and incense smoke
    skyTop: hex('#2b2a63'), skyMid: hex('#c75a5a'), skyHor: hex('#ffb04a'),
    fog: hex('#c98264'), fogNear: 50, fogFar: 250,
    hemiSky: hex('#ffb08a'), hemiGround: hex('#6e3a3a'), hemi: 1.05,
    sunColor: hex('#ff8a3c'), sun: 2.3, sunDir: vec(-38, 13, 30),
    env: 0.3, exposure: 1.02, bloom: 0.8, bloomThreshold: 0.92,
    building: lin(0.8, 0.7, 0.7), windows: 0.5, boards: 0.7, lamps: 2.2,
    skyline: lin(0.95, 0.85, 0.8), clouds: lin(1, 0.6, 0.5), hero: lin(1, 0.88, 0.8),
    rain: 0, headlamp: 0.1,
    weather: 'embers', skin: { overhead: 'banner' },
    spawn: { moving: 0, barriers: 0 },
  },
  {
    id: 'snow', name: '雪國', toast: '雪國', tone: 'sun', set: 'snow',   // overcast, cool, soft; falling snow
    skyTop: hex('#8e9fb4'), skyMid: hex('#b9c6d4'), skyHor: hex('#e4ebf2'),
    fog: hex('#dce4ec'), fogNear: 45, fogFar: 250,
    hemiSky: hex('#dfe8f3'), hemiGround: hex('#a9b5c4'), hemi: 1.55,
    sunColor: hex('#f2f5ff'), sun: 1.3, sunDir: vec(-20, 40, 30),
    env: 0.45, exposure: 1.05, bloom: 0.45, bloomThreshold: 1.1,
    building: lin(0.98, 0.99, 1), windows: 0.3, boards: 0.15, lamps: 1.3,
    skyline: lin(0.98, 0.99, 1), clouds: lin(0.85, 0.89, 0.95), hero: lin(0.97, 0.98, 1),
    rain: 0, headlamp: 0.05,
    weather: 'snow', skin: { hurdle: 'snowbank' },
    spawn: { moving: 0, barriers: 0 },
  },
  {
    id: 'metro', name: '捷運地下站', toast: '捷運地下站', tone: 'sun', set: 'metro',   // underground, flat cool fluorescent
    skyTop: hex('#1b2226'), skyMid: hex('#2b363b'), skyHor: hex('#59686c'),   // (no sky: the dark ceiling; the tiled station wall is the skyline)
    fog: hex('#9fb0b2'), fogNear: 55, fogFar: 230,
    hemiSky: hex('#d8efe8'), hemiGround: hex('#8c9a9a'), hemi: 1.35,
    sunColor: hex('#e6fff4'), sun: 1.0, sunDir: vec(-4, 50, 10),
    env: 0.3, exposure: 1.05, bloom: 0.55, bloomThreshold: 1.0,
    building: lin(0.95, 1, 0.98), windows: 0.7, boards: 0.5, lamps: 2.0,
    skyline: lin(0.98, 1, 0.99), clouds: lin(0.1, 0.12, 0.13), hero: lin(0.96, 1, 0.98),
    rain: 0, headlamp: 0.2,
    weather: '', skin: null,
    spawn: { moving: 0, barriers: 0 },
  },
  {
    id: 'conbini', name: '便利商店街', toast: '便利商店街', tone: 'hot', set: 'conbini',   // late-evening neon, bright shop glass
    skyTop: hex('#0d0a28'), skyMid: hex('#38205e'), skyHor: hex('#d0507c'),
    fog: hex('#2b2147'), fogNear: 40, fogFar: 235,
    hemiSky: hex('#8a78c8'), hemiGround: hex('#a8508a'), hemi: 0.85,
    sunColor: hex('#ff9ad0'), sun: 0.8, sunDir: vec(-18, 28, 26),
    env: 0.16, exposure: 1.1, bloom: 1.15, bloomThreshold: 0.74,
    building: lin(0.46, 0.4, 0.55), windows: 1.2, boards: 1.5, lamps: 3.0,
    skyline: lin(0.92, 0.9, 1), clouds: lin(0.2, 0.12, 0.3), hero: lin(1, 0.9, 0.95),
    rain: 0, headlamp: 0.3,
    weather: 'neon', skin: null,
    spawn: { moving: 0, barriers: 0 },
  },
  {
    id: 'rooftop', name: '屋頂天台', toast: '屋頂天台', tone: 'warn', set: 'rooftop',   // low golden sunset, laundry in the wind
    skyTop: hex('#4a4a9a'), skyMid: hex('#e0709a'), skyHor: hex('#ffb866'),
    fog: hex('#e9a27c'), fogNear: 55, fogFar: 260,
    hemiSky: hex('#ffc9a0'), hemiGround: hex('#8a5a6a'), hemi: 1.15,
    sunColor: hex('#ff9a4a'), sun: 2.6, sunDir: vec(-40, 12, 28),
    env: 0.32, exposure: 1.03, bloom: 0.75, bloomThreshold: 0.95,
    building: lin(0.9, 0.78, 0.74), windows: 0.35, boards: 0.5, lamps: 1.6,
    skyline: lin(0.97, 0.9, 0.9), clouds: lin(1, 0.62, 0.55), hero: lin(1, 0.9, 0.82),
    rain: 0, headlamp: 0.05,
    weather: 'laundry', skin: { overhead: 'laundryline' },
    spawn: { moving: 0, barriers: 0 },
  },
  {
    id: 'candy', name: '糖果世界', toast: '糖果世界', tone: 'sun', set: 'candy',   // pastel, sugar sparkles
    skyTop: hex('#8fcfff'), skyMid: hex('#ffd0ea'), skyHor: hex('#fff0f6'),
    fog: hex('#f8dcec'), fogNear: 60, fogFar: 270,
    hemiSky: hex('#ffe8f6'), hemiGround: hex('#f0c8c0'), hemi: 1.5,
    sunColor: hex('#fff1e0'), sun: 2.6, sunDir: vec(-24, 38, 34),
    env: 0.45, exposure: 1.04, bloom: 0.7, bloomThreshold: 0.95,
    building: lin(1, 0.98, 1), windows: 0, boards: 0.1, lamps: 1.2,
    skyline: lin(0.98, 0.97, 1), clouds: lin(1, 0.9, 0.97), hero: lin(1, 0.96, 0.97),
    rain: 0, headlamp: 0,
    weather: 'sparkle', skin: { hurdle: 'biscuit' },
    spawn: { moving: 0, barriers: 0 },
  },
  {
    id: 'funfair', name: '遊樂園', toast: '遊樂園', tone: 'hot', set: 'funfair',   // twilight, confetti
    skyTop: hex('#16143f'), skyMid: hex('#6a2f86'), skyHor: hex('#ff8a6a'),
    fog: hex('#5b3a6e'), fogNear: 42, fogFar: 240,
    hemiSky: hex('#9a7ad0'), hemiGround: hex('#c46a5a'), hemi: 0.9,
    sunColor: hex('#ff9a70'), sun: 0.9, sunDir: vec(-30, 18, 30),
    env: 0.18, exposure: 1.1, bloom: 1.1, bloomThreshold: 0.75,
    building: lin(0.55, 0.5, 0.6), windows: 1.0, boards: 1.3, lamps: 3.0,
    skyline: lin(0.95, 0.9, 1), clouds: lin(0.4, 0.25, 0.5), hero: lin(1, 0.92, 0.9),
    rain: 0, headlamp: 0.3,
    weather: 'confetti', skin: { overhead: 'ridegate' },
    spawn: { moving: 0, barriers: 0 },
  },
  {
    id: 'ricefield', name: '稻田鄉間', toast: '稻田鄉間', tone: 'sun', set: 'ricefield',   // bright clean morning, no particles
    skyTop: hex('#3f9fee'), skyMid: hex('#9fd8f6'), skyHor: hex('#f3fbe6'),
    fog: hex('#e3eed6'), fogNear: 90, fogFar: 340,
    hemiSky: hex('#d6efff'), hemiGround: hex('#c9c590'), hemi: 1.6,
    sunColor: hex('#fff4d6'), sun: 3.4, sunDir: vec(-34, 30, 34),
    env: 0.5, exposure: 1.03, bloom: 0.45, bloomThreshold: 1.1,
    building: lin(1, 0.97, 0.95), windows: 0, boards: 0.1, lamps: 0.6,
    skyline: lin(0.98, 1, 0.97), clouds: lin(1, 1, 1), hero: lin(1, 0.98, 0.94),
    rain: 0, headlamp: 0,
    weather: '', skin: null,
    spawn: { moving: 0, barriers: 0 },
  },
  {
    id: 'onsen', name: '溫泉街', toast: '溫泉街', tone: 'warn', set: 'onsen',   // dusk, rising steam
    skyTop: hex('#232850'), skyMid: hex('#7b5a8c'), skyHor: hex('#f0a888'),
    fog: hex('#9a8aa0'), fogNear: 34, fogFar: 210,
    hemiSky: hex('#a89ac8'), hemiGround: hex('#b07a60'), hemi: 0.95,
    sunColor: hex('#ffb890'), sun: 1.0, sunDir: vec(-30, 16, 32),
    env: 0.2, exposure: 1.08, bloom: 0.95, bloomThreshold: 0.8,
    building: lin(0.5, 0.46, 0.52), windows: 1.0, boards: 0.6, lamps: 2.6,
    skyline: lin(0.95, 0.92, 1), clouds: lin(0.55, 0.45, 0.6), hero: lin(1, 0.92, 0.88),
    rain: 0, headlamp: 0.2,
    weather: 'steam', skin: { overhead: 'noren' },
    spawn: { moving: 0, barriers: 0 },
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
const KEYS = Object.keys(PLACES[0]).filter((k) => isBlendable(PLACES[0][k]));
const TUNNEL_KEYS = Object.keys(TUNNEL_LOOK);

/* ---------- place order ---------- */

const order = [];   // place index of every PLACE.len stretch of this run, grown on demand (one shuffled bag at a time)

/** mulberry32: a small seeded generator of its own, so planning never touches Math.random (the track generator's stream). */
const seeded = (a) => () => {
  a = (a + 0x6d2b79f5) >>> 0;
  let t = Math.imul(a ^ (a >>> 15), a | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
let rnd = seeded(1);   // until the first resetPlaces: a fixed order
const BAG_WEIGHT = { afternoon: 0.5, dusk: 0.5 };   // chance of a place being in a bag (default 1): the art places and 霓虹 / 雨天 always are

/**
 * New run: draws the place order. It takes ONE Math.random() (the daily seed inside spawner.seeded, so the daily run
 * walks through the same places for everyone) and builds the order from its own generator, so planning ahead from the
 * per-frame placeAt never consumes the track generator's numbers (same pattern as director.js resetDirector).
 * Order: bags of places in random order, the first bag's first place being the start place; a bag holds every place once
 * (午後 and 黃昏, the two lighting-only daylight places, only with BAG_WEIGHT 0.5, each drawn per bag), and a bag never
 * opens with the place the previous bag ended on.
 */
export function resetPlaces() {
  rnd = seeded((Math.random() * 4294967296) >>> 0);
  order.length = 0;
  growOrder(0);
}

function growOrder(i) {
  while (order.length <= i) {
    const bag = [];
    for (let n = 0; n < PLACES.length; n++) if (!(PLACES[n].id in BAG_WEIGHT) || rnd() < BAG_WEIGHT[PLACES[n].id]) bag.push(n);
    for (let n = bag.length - 1; n > 0; n--) { const j = Math.floor(rnd() * (n + 1)); [bag[n], bag[j]] = [bag[j], bag[n]]; }
    if (order.length && bag[0] === order[order.length - 1]) {
      const j = 1 + Math.floor(rnd() * (bag.length - 1));
      [bag[0], bag[j]] = [bag[j], bag[0]];
    }
    order.push(...bag);
  }
}

/** Place index (into PLACES) for a track position: a pure function of the stored order, nothing allocated. */
export function placeAt(s) {
  const i = Math.floor(Math.max(0, s) / PLACE.len);
  if (i >= order.length) growOrder(i);
  return order[i];
}

// old names, kept until main.js (Z1e) and the QA harnesses have moved over to PLACE / PLACES / placeAt

/** A mutable look object (deep copy of place 0) for blendLook to write into. */
export function makeLook() {
  const out = {};
  for (const k of KEYS) { const v = PLACES[0][k]; out[k] = typeof v === 'number' ? v : v.clone(); }
  return out;
}

/** out = lerp(PLACES[a], PLACES[b], t), then pulled toward TUNNEL_LOOK by `dark`. No allocations. */
export function blendLook(out, a, b, t, dark = 0) {
  const A = PLACES[a], B = PLACES[b];
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
