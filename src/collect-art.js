import { makeCanvas, liveryAtlasCanvas } from './textures.js';
import { FXP } from './settings.js';
import { artReady, drawStage } from './cosmetic-art.js';

export { LIVERY_IDS, liveryVariants, liveryAtlasCanvas } from './textures.js';

/*
 * Art of the shop's collection kinds (round 3, part 2b): coin faces (kind `coin`), crash-effect sprites (`crash`), the
 * game-over banner pictures (`banner`), train liveries (`livery`, drawn by textures.js) and the four shop previews.
 *  - coinFace(id): the 128x128 face drawn on the coin meshes (fx.js setCoinFace); crashSprite(kind): fx.js textures
 *  - applyLivery(trainMats, id, decals): repaint the train materials (cosmetics.onEquipped('livery', ...) in the wiring)
 *  - bannerUrl / BANNER: assets/ui/banner_<name>.webp (512x128), the title stays clear in the middle
 *  - drawCoinPreview / drawCrashPreview (64x80) and drawBannerPreview / drawLiveryPreview (256x64): (g, fx, t, w, h)
 * `fx` is a catalog id ('coin_paw'), the id without its kind prefix ('paw') or '' / unknown = the free default (shop-ui passes the short form). Art is
 * procedural except the banners; 減少閃爍 (FXP.calm) drops every sparkle and blink. Cartoon outline colour #3b1d0e.
 */

const INK = '#3b1d0e';
const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const fract = (v) => v - Math.floor(v);

/** Catalog ids per kind (cosmetics.js); the same list of the `fx` parts is the filename / switch key of each kind. */
export const COIN_IDS = ['coin_paw', 'coin_pearl', 'coin_heart', 'coin_star', 'coin_cake', 'coin_pixel'];
export const CRASH_IDS = ['crash_stars', 'crash_confetti', 'crash_pixel', 'crash_firework', 'crash_bang'];
export const BANNER_IDS = ['banner_ribbon', 'banner_lantern', 'banner_redpaper', 'banner_pixel', 'banner_neon'];
export const LIVERY_CATALOG_IDS = ['livery_market', 'livery_sakura', 'livery_seabreeze', 'livery_temple', 'livery_candy'];
const IDS = { coin: COIN_IDS, crash: CRASH_IDS, banner: BANNER_IDS, livery: LIVERY_CATALOG_IDS };

/** `fx` of kind `kind` as its catalog id ('paw' | 'coin_paw' -> 'coin_paw'), or '' for none / unknown. */
export function catalogId(kind, fx) {
  const s = String(fx || ''), id = s.startsWith(`${kind}_`) ? s : `${kind}_${s}`;
  return IDS[kind] && IDS[kind].includes(id) ? id : '';
}
const shortId = (kind, fx) => catalogId(kind, fx).slice(kind.length + 1);

/* ---------- train liveries (kind `livery`): textures.js draws the atlases ---------- */

/**
 * Repaint the shared train materials (objects.js `mats.trainMats`: variant-major, 2 per variant, atlas seeds as in
 * buildSharedMaterials) in livery `id` ('' / unknown = the factory paint again; `decals` = the graffiti images, factory only).
 * The textures keep their size, so nothing is reallocated: each map gets the new canvas and is re-uploaded. Returns how many were repainted.
 */
export function applyLivery(trainMats, id, decals = []) {
  const key = catalogId('livery', id);
  let n = 0;
  (trainMats || []).forEach((m, i) => {
    if (!m || !m.map) return;
    const vi = i >> 1, k = i & 1;
    m.map.image = liveryAtlasCanvas(key, vi, decals, 101 + vi * 17 + k * 7);
    m.map.needsUpdate = true;
    n++;
  });
  return n;
}

/* ---------- coin faces (kind `coin`) ---------- */

export const COIN_FACE = 128;
/** The face disc is cropped by the coin's circle: 0.45 of the texture (CircleGeometry uv scaled 0.9) is the visible radius. */
export const COIN_VISIBLE = 0.45;
const C = COIN_FACE / 2;

function starPath(g, cx, cy, ro, ri, rot = -Math.PI / 2, n = 5) {
  g.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const a = rot + (i * Math.PI) / n, r = i % 2 ? ri : ro;
    g[i ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  g.closePath();
}

function heartPath(g, cx, cy, s) {
  g.beginPath();
  g.moveTo(cx, cy + s * 0.9);
  g.bezierCurveTo(cx - s * 1.5, cy - s * 0.1, cx - s * 0.9, cy - s * 1.1, cx, cy - s * 0.35);
  g.bezierCurveTo(cx + s * 0.9, cy - s * 1.1, cx + s * 1.5, cy - s * 0.1, cx, cy + s * 0.9);
  g.closePath();
}

function pawPrint(g, cx, cy, s) {
  g.beginPath();
  g.ellipse(cx, cy + 7 * s, 15 * s, 12 * s, 0, 0, TAU);
  for (const [x, y, rx, ry] of [[-21, -5, 6, 8.5], [-8, -17, 6.5, 9], [8, -17, 6.5, 9], [21, -5, 6, 8.5]]) {
    g.moveTo(cx + (x + rx) * s, cy + y * s);
    g.ellipse(cx + x * s, cy + y * s, rx * s, ry * s, 0, 0, TAU);
  }
}

/** Emboss `shape` (a function that builds the path): a light edge up-left, a shadow down-right, then the body fill. */
function emboss(g, shape, body, hi = 'rgba(255,250,205,0.95)', lo = 'rgba(133,76,4,0.65)', d = 2) {
  for (const [dx, dy, col] of [[-d, -d, hi], [d, d, lo], [0, 0, body]]) {
    g.save(); g.translate(dx, dy); shape(); g.fillStyle = col; g.fill(); g.restore();
  }
}

/** The coin every skin shares: a gold rim ring (always the same, so every face reads as a coin) around the face disc. */
function faceBase(g, disc0, disc1) {
  g.fillStyle = '#e6a114';
  g.fillRect(0, 0, COIN_FACE, COIN_FACE);
  const ring = g.createLinearGradient(14, 10, 114, 118);
  ring.addColorStop(0, '#fff0a0'); ring.addColorStop(0.5, '#f7bd24'); ring.addColorStop(1, '#c98a10');
  g.beginPath(); g.arc(C, C, 58, 0, TAU); g.fillStyle = ring; g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.8)'; g.lineWidth = 3.5; g.lineCap = 'round';
  g.beginPath(); g.arc(C, C, 53.5, Math.PI * 1.08, Math.PI * 1.46); g.stroke();
  g.beginPath(); g.arc(C, C, 48.5, 0, TAU); g.fillStyle = '#b97a0c'; g.fill();
  const d = g.createRadialGradient(50, 46, 4, C, C, 48);
  d.addColorStop(0, disc0); d.addColorStop(1, disc1);
  g.beginPath(); g.arc(C, C, 46.5, 0, TAU); g.fillStyle = d; g.fill();
}

const GOLD_DISC = ['#fff09a', '#f2b21c'];

// star coin: four glints that twinkle one after another over 4 frames (one frame in 減少閃爍)
const GLINTS = [[39, 38, 9], [88, 48, 7], [78, 90, 8.5], [42, 82, 6]];
function glint(g, x, y, r) {
  g.fillStyle = 'rgba(255,255,255,0.95)';
  g.beginPath();
  g.moveTo(x, y - r); g.quadraticCurveTo(x + r * 0.16, y - r * 0.16, x + r, y); g.quadraticCurveTo(x + r * 0.16, y + r * 0.16, x, y + r);
  g.quadraticCurveTo(x - r * 0.16, y + r * 0.16, x - r, y); g.quadraticCurveTo(x - r * 0.16, y - r * 0.16, x, y - r);
  g.fill();
}

// pixel coin: 16 x 16 cells of 8 px; the cat face is 7 x 6 cells, E = its eyes, N = its nose
const PIXEL_CAT = ['X.....X', 'XX...XX', 'XXXXXXX', 'XEXXXEX', 'XXXNXXX', '.XXXXX.'];

const FACES = {
  coin_paw(g) {
    faceBase(g, ...GOLD_DISC);
    emboss(g, () => pawPrint(g, C, C - 4, 1), '#e9a417');
  },
  coin_pearl(g) {
    faceBase(g, '#fff09a', '#f2b21c');
    const p = g.createRadialGradient(50, 46, 3, C + 3, C + 3, 44);
    p.addColorStop(0, '#9a6240'); p.addColorStop(0.55, '#4e2a16'); p.addColorStop(1, '#1e0e07');
    g.beginPath(); g.arc(C, C, 40, 0, TAU); g.fillStyle = p; g.fill();
    g.lineWidth = 2.5; g.strokeStyle = '#2a140a'; g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.85)'; g.beginPath(); g.ellipse(48, 42, 11, 6, -0.7, 0, TAU); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.4)'; g.beginPath(); g.arc(82, 86, 3.4, 0, TAU); g.fill();
  },
  coin_heart(g) {
    faceBase(g, ...GOLD_DISC);
    const body = g.createLinearGradient(0, 36, 0, 90);
    body.addColorStop(0, '#ff8fb8'); body.addColorStop(1, '#ee4a85');
    emboss(g, () => heartPath(g, C, C - 2, 27), body, 'rgba(255,255,255,0.8)', 'rgba(130,20,60,0.6)');
    g.lineWidth = 2.5; g.strokeStyle = '#a8234f'; heartPath(g, C, C - 2, 27); g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.8)'; g.beginPath(); g.ellipse(48, 46, 8, 4.5, -0.7, 0, TAU); g.fill();
  },
  coin_star(g, k = 0) {
    faceBase(g, '#ffe07a', '#e9a313');
    const body = g.createLinearGradient(0, 28, 0, 96);
    body.addColorStop(0, '#fffbc8'); body.addColorStop(1, '#ffd23a');
    emboss(g, () => starPath(g, C, C + 3, 36, 16), body, 'rgba(255,255,255,0.9)', 'rgba(140,80,4,0.6)');
    g.lineJoin = 'round'; g.lineWidth = 3; g.strokeStyle = '#c98a10'; starPath(g, C, C + 3, 36, 16); g.stroke();
    if (k >= 0) GLINTS.forEach(([x, y, r], i) => {
      const s = i === k ? 1 : i === (k + 3) % 4 ? 0.5 : 0;
      if (s) glint(g, x, y, r * s);
    });
  },
  coin_cake(g) {
    faceBase(g, '#ffe58a', '#f0b020');
    const sq = (s, r) => {
      g.beginPath();
      g.moveTo(C - s + r, C - s); g.arcTo(C + s, C - s, C + s, C + s, r); g.arcTo(C + s, C + s, C - s, C + s, r);
      g.arcTo(C - s, C + s, C - s, C - s, r); g.arcTo(C - s, C - s, C + s, C - s, r); g.closePath();
    };
    sq(32, 13);
    const crust = g.createLinearGradient(0, 32, 0, 96);
    crust.addColorStop(0, '#f2b550'); crust.addColorStop(1, '#c47a1c');
    g.fillStyle = crust; g.fill(); g.lineWidth = 3; g.strokeStyle = '#8f5410'; g.stroke();
    sq(24, 9);
    g.fillStyle = '#f9d86e'; g.fill(); g.lineWidth = 2; g.strokeStyle = 'rgba(140,84,16,0.55)'; g.stroke();
    g.save(); sq(24, 9); g.clip();
    g.fillStyle = '#e29a28';
    for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) {   // pineapple-filling dots on a diamond lattice
      g.beginPath(); g.arc(C - 20 + x * 10 + (y % 2) * 5, C - 20 + y * 10, 2.5, 0, TAU); g.fill();
    }
    g.restore();
    g.strokeStyle = 'rgba(255,255,255,0.7)'; g.lineWidth = 3; g.lineCap = 'round';
    g.beginPath(); g.moveTo(C - 24, C - 31); g.lineTo(C + 12, C - 31); g.stroke();
  },
  coin_pixel(g) {
    const N = 16, S = COIN_FACE / N, pal = { rim: '#d98b0c', light: '#ffe27a', groove: '#b8760a', gold: '#e8a010', cat: '#fff1a0', eye: '#7a3d00', nose: '#ff7a9c' };
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const d = Math.hypot(x - 7.5, y - 7.5);
      g.fillStyle = d >= 6.4 ? pal.rim : d >= 5.4 ? pal.light : d >= 4.7 ? pal.groove : pal.gold;
      g.fillRect(x * S, y * S, S, S);
    }
    PIXEL_CAT.forEach((row, ry) => [...row].forEach((ch, rx) => {
      if (ch === '.') return;
      g.fillStyle = ch === 'E' ? pal.eye : ch === 'N' ? pal.nose : pal.cat;
      g.fillRect((4 + rx) * S, (5 + ry) * S, S, S);
    }));
  },
};

const FACE_CACHE = { key: '', frames: null };

/** `frames` canvases of skin `key` (a catalog id): one plain face, or the 4 glint frames of coin_star. */
function buildFaces(key, frames) {
  const list = [];
  for (let k = 0; k < frames; k++) {
    const c = makeCanvas(COIN_FACE, COIN_FACE), g = c.getContext('2d');
    FACES[key](g, frames > 1 ? k : -1);
    list.push(c);
  }
  return list;
}
const faceFrames = (key) => (key === 'coin_star' && !FXP.calm ? 4 : 1);

/**
 * The face of coin skin `id` ('coin_paw' ...): one 128x128 canvas, an array of 4 canvases (cycle one per 0.5 s: only coin_star,
 * and only outside 減少閃爍) or null for none / unknown (the objects keep the default coin picture). The result is kept for
 * the next call with the same id, so a caller that wants it for good keeps its own reference.
 */
export function coinFace(id) {
  const key = catalogId('coin', id);
  if (!key) return null;
  const frames = faceFrames(key), tag = `${key}:${frames}`;
  if (FACE_CACHE.key !== tag) { FACE_CACHE.key = tag; FACE_CACHE.frames = buildFaces(key, frames); }
  return frames > 1 ? FACE_CACHE.frames : FACE_CACHE.frames[0];
}

/* ---------- crash-effect sprites (kind `crash`) ---------- */

/** Sprites fx.js takes from here; confetti and firework use fx.js's own pictures. */
export const CRASH_SPRITES = ['stars', 'pixel', 'bang'];

/**
 * Texture canvas of crash effect `kind` ('stars' | 'pixel' | 'bang', or the catalog id): 'stars' a 64 px yellow cartoon star
 * (keeps its own colours), 'pixel' an 8 x 8 white block with a bevel (tinted per particle), 'bang' the 128 px comic burst with
 * 「碰！」. Anything else (confetti, firework, unknown): null.
 */
export function crashSprite(kind) {
  const k = String(kind || '').replace(/^crash_/, '');
  if (k === 'stars') {
    const c = makeCanvas(64, 64), g = c.getContext('2d');
    starPath(g, 32, 34, 27, 12);
    const f = g.createLinearGradient(0, 8, 0, 60);
    f.addColorStop(0, '#fff6a8'); f.addColorStop(1, '#ffcb2e');
    g.lineJoin = 'round'; g.lineWidth = 5; g.strokeStyle = INK; g.stroke(); g.fillStyle = f; g.fill();
    g.fillStyle = 'rgba(255,255,255,0.85)'; g.beginPath(); g.ellipse(26, 24, 4.5, 2.6, -0.8, 0, TAU); g.fill();
    return c;
  }
  if (k === 'pixel') {
    const c = makeCanvas(8, 8), g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, 8, 8);
    g.fillStyle = 'rgba(60,40,30,0.35)'; g.fillRect(0, 7, 8, 1); g.fillRect(7, 0, 1, 8);
    g.fillStyle = 'rgba(60,40,30,0.12)'; g.fillRect(1, 6, 6, 1); g.fillRect(6, 1, 1, 6);
    return c;
  }
  if (k === 'bang') {
    const c = makeCanvas(128, 128), g = c.getContext('2d');
    const burst = (ro, ri) => {
      g.beginPath();
      for (let i = 0; i < 18; i++) { const a = (i * Math.PI) / 9, r = i & 1 ? ri : ro; g[i ? 'lineTo' : 'moveTo'](64 + Math.cos(a) * r, 64 + Math.sin(a) * r); }
      g.closePath();
    };
    g.lineJoin = 'round';
    burst(62, 40); g.fillStyle = '#ffd23f'; g.fill(); g.lineWidth = 6; g.strokeStyle = INK; g.stroke();
    burst(50, 32); g.fillStyle = '#fff1a6'; g.fill();
    g.font = '900 52px "Noto Sans TC", "Microsoft JhengHei", "PingFang TC", sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 9; g.strokeStyle = INK; g.strokeText('碰！', 64, 68);
    g.lineWidth = 4; g.strokeStyle = '#fff'; g.strokeText('碰！', 64, 68);
    g.fillStyle = '#e0352b'; g.fillText('碰！', 64, 68);
    return c;
  }
  return null;
}

/* ---------- game-over banners (kind `banner`) ---------- */

/**
 * The banner pictures: assets/ui/banner_<name>.webp, 512x128 RGBA. The title (white, ~36 px, up to ~4 CJK characters) is drawn
 * over the middle: `safe` is the clear rectangle in the picture's pixels; the art lives in the wings and edge strips.
 * `pulse`: banner_neon may glow slowly (a CSS brightness / shadow pulse), and only outside 減少閃爍.
 */
export const BANNER = { w: 512, h: 128, safe: { x: 108, y: 24, w: 296, h: 80 }, pulse: ['neon'] };
export const bannerUrl = (fx) => { const n = shortId('banner', fx); return n ? `assets/ui/banner_${n}.webp` : ''; };

/* ---------- previews ---------- */

function hero(g, x, y, s) {            // the hero, very small, seen from behind (same pill as the trail previews)
  g.save(); g.translate(x, y); g.scale(s, s);
  g.fillStyle = '#ff9a2a'; g.strokeStyle = INK; g.lineWidth = 2;
  g.beginPath(); g.ellipse(0, 7, 7, 10, 0, 0, TAU); g.fill(); g.stroke();
  g.fillStyle = '#2a1a14'; g.beginPath(); g.arc(0, -6, 6.5, 0, TAU); g.fill();
  g.fillStyle = '#ff9a2a';
  g.beginPath(); g.moveTo(-6, -9); g.lineTo(-5, -15); g.lineTo(-1, -11); g.fill();
  g.beginPath(); g.moveTo(6, -9); g.lineTo(5, -15); g.lineTo(1, -11); g.fill();
  g.restore();
}

const PREVIEW_FACES = new Map();      // coin id -> frames (the shop shows all six at once: kept, 64 KB each)
function previewFaces(id) {
  const tag = `${id}:${FXP.calm ? 1 : 0}`;
  let f = PREVIEW_FACES.get(tag);
  if (!f) {
    f = buildFaces(id, faceFrames(id));
    PREVIEW_FACES.set(tag, f);
    if (PREVIEW_FACES.size > 12) PREVIEW_FACES.delete(PREVIEW_FACES.keys().next().value);
  }
  return f;
}
let DEFAULT_FACE = null;
function defaultFace() {              // the free coin: today's gold coin, drawn like the skins so the rim matches
  if (!DEFAULT_FACE) {
    DEFAULT_FACE = makeCanvas(COIN_FACE, COIN_FACE);
    const g = DEFAULT_FACE.getContext('2d');
    faceBase(g, ...GOLD_DISC);
    g.strokeStyle = 'rgba(176,96,8,0.8)'; g.lineWidth = 4; g.beginPath(); g.arc(C, C, 30, 0, TAU); g.stroke();
  }
  return DEFAULT_FACE;
}

/** A coin skin (catalog id, '' = the plain coin) on the dark preview stage, slowly turning (64 x 80). Star: glints, still in 減少閃爍. */
export function drawCoinPreview(g, fx, t, w, h) {
  drawStage(g, w, h);
  const id = catalogId('coin', fx), frames = id ? previewFaces(id) : [defaultFace()];
  const face = frames[Math.floor(t * 2) % frames.length], r = Math.min(w * 0.38, h * 0.32), cx = w / 2, cy = h * 0.46;
  const sx = Math.max(0.16, Math.abs(Math.cos(t * 1.1)));
  g.save();
  g.translate(cx, cy); g.scale(sx, 1);
  g.beginPath(); g.arc(0, 0, r + 2, 0, TAU); g.fillStyle = '#c98a10'; g.fill();     // the coin's edge
  g.beginPath(); g.arc(0, 0, r, 0, TAU); g.clip();
  const side = r / COIN_VISIBLE;      // the visible disc is 0.45 of the face
  g.drawImage(face, -side / 2, -side / 2, side, side);
  g.restore();
  g.fillStyle = 'rgba(0,0,0,0.25)'; g.beginPath(); g.ellipse(cx, cy + r + 8, r * 0.8 * sx, 3, 0, 0, TAU); g.fill();
}

const CONFETTI = ['#ff5a5f', '#ffb02e', '#ffe14a', '#4cd98a', '#4db8ff', '#c47bff'];
const TABBY = ['#e59a45', '#f4c47e', '#fff1d6', '#5a3b24', '#2e2018'];
const hash = (a, b) => fract(Math.sin(a * 127.1 + b * 311.7) * 43758.5453);
const CRASH_LOOP = 1.8;

function blast(g, x, y, ph, n, r1, col, tw) {       // one firework burst: n rays flying out, a ring, sparks that twinkle (not in calm)
  const e = 1 - (1 - clamp(ph, 0, 1)) ** 2;
  g.globalAlpha = clamp(1.4 - ph * 1.4, 0, 1);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU, r = r1 * e;
    g.strokeStyle = col[i % col.length]; g.lineWidth = 2; g.lineCap = 'round';
    g.beginPath(); g.moveTo(x + Math.cos(a) * r * 0.6, y + Math.sin(a) * r * 0.6); g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); g.stroke();
    if (tw && hash(i, 3) > 0.5 && Math.sin(ph * 40 + i * 2) > 0) { g.fillStyle = '#fff'; g.fillRect(x + Math.cos(a) * r * 1.12 - 1, y + Math.sin(a) * r * 1.12 - 1, 2, 2); }
  }
  g.globalAlpha = 1;
}

/** A crash effect (catalog id, '' = the plain crash) around the little hero, looping every 1.8 s (64 x 80). */
export function drawCrashPreview(g, fx, t, w, h) {
  drawStage(g, w, h);
  const id = catalogId('crash', fx), k = id.slice(6), ph = fract(t / CRASH_LOOP) * CRASH_LOOP, cx = w / 2, cy = h * 0.58, top = cy - 17;
  hero(g, cx, cy, 1.25);
  g.save();
  if (k === 'stars') {
    const sp = crashSprite('stars'), live = ph < 0.8 || FXP.calm;
    if (live) for (let i = 0; i < 5; i++) {
      const a = (FXP.calm ? 0 : ph * 7) + (i / 5) * TAU, x = cx + Math.cos(a) * 15, y = top + 1 + Math.sin(a) * 4.5;
      g.drawImage(sp, x - 5.5, y - 5.5, 11, 11);
    }
  } else if (k === 'confetti') {
    if (ph < 1.5) for (let i = 0; i < 22; i++) {
      const sp = 14 + hash(i, 1) * 26, a = -Math.PI / 2 + (hash(i, 2) - 0.5) * 2.3, x = cx + Math.cos(a) * sp * ph * 1.4, y = top + Math.sin(a) * sp * ph * 1.4 + 22 * ph * ph;
      g.globalAlpha = clamp(1.6 - ph, 0, 1);
      g.save(); g.translate(x, y); g.rotate(ph * 6 * (hash(i, 4) - 0.5) + i);
      g.fillStyle = CONFETTI[i % 6]; g.fillRect(-2.2, -1.2, 4.4, 2.4);
      g.restore();
    }
  } else if (k === 'pixel') {
    if (ph < 1.5) for (let i = 0; i < 18; i++) {
      const sp = 10 + hash(i, 1) * 26, a = -Math.PI / 2 + (hash(i, 2) - 0.5) * 3.2, s = 3 + Math.floor(hash(i, 5) * 3);
      g.globalAlpha = clamp(1.6 - ph, 0, 1);
      g.fillStyle = TABBY[i % 5];
      g.fillRect(Math.round(cx + Math.cos(a) * sp * ph * 1.3 - s / 2), Math.round(cy - 3 + Math.sin(a) * sp * ph * 1.3 + 30 * ph * ph - s / 2), s, s);
    }
  } else if (k === 'firework') {
    const cols = ['#ff5a5f', '#ffe14a', '#4db8ff', '#fff'];
    const shells = FXP.calm ? [[0, cx, top - 12]] : [[0, cx - 9, top - 10], [0.3, cx + 10, top - 16]];
    for (const [at, x, y] of shells) {
      const q = ph - at;
      if (q < 0) continue;
      if (q < 0.32) { g.fillStyle = '#ffe9a0'; g.fillRect(x - 1, y + 24 * (1 - q / 0.32), 2, 4); }
      else blast(g, x, y, (q - 0.32) / 0.9, FXP.calm ? 10 : 14, 13, cols, !FXP.calm);
    }
  } else if (k === 'bang') {
    const sp = crashSprite('bang'), q = ph / 0.6, s = ph < 0.6 ? 0.2 + 1.0 * clamp(q, 0, 1) + 0.18 * Math.sin(clamp(q, 0, 1) * Math.PI) : 1.2;
    g.globalAlpha = clamp(1.7 - ph, 0, 1);
    const sz = 40 * s;
    g.drawImage(sp, cx - sz / 2, top - sz * 0.62, sz, sz);
  } else {
    if (ph < 0.5) {   // plain crash: a puff of dust
      g.globalAlpha = 1 - ph * 2; g.fillStyle = '#e9d7bd';
      for (let i = 0; i < 6; i++) { g.beginPath(); g.arc(cx + Math.cos(i) * (6 + ph * 22), cy + 8 + Math.sin(i * 1.7) * 3 * ph - ph * 6, 3 + ph * 4, 0, TAU); g.fill(); }
    }
  }
  g.restore();
}

const TITLE = '撞車啦！';
/** A game-over banner (catalog id, '' = none) around a sample title on the stage (256 x 64: the picture is 4:1). neon glows slowly, still in 減少閃爍. */
export function drawBannerPreview(g, fx, t, w, h) {
  drawStage(g, w, h);
  const name = shortId('banner', fx), img = name && artReady(bannerUrl(fx));
  const sc = Math.min(w / BANNER.w, h / BANNER.h), bw = BANNER.w * sc, bh = BANNER.h * sc, x = (w - bw) / 2, y = (h - bh) / 2;
  if (img) {
    g.drawImage(img, x, y, bw, bh);
    if (BANNER.pulse.includes(name) && !FXP.calm) {
      g.save();
      g.globalCompositeOperation = 'lighter';
      g.globalAlpha = 0.22 + 0.2 * Math.sin(t * 2.4);
      g.drawImage(img, x, y, bw, bh);
      g.restore();
    }
  }
  g.save();
  g.font = `900 ${Math.round(h * 0.5)}px "Noto Sans TC", "Microsoft JhengHei", "PingFang TC", sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
  g.lineWidth = Math.max(3, h * 0.09); g.strokeStyle = INK; g.strokeText(TITLE, w / 2, h / 2 + 1);
  g.fillStyle = '#fff'; g.fillText(TITLE, w / 2, h / 2 + 1);
  g.restore();
}

const LIVERY_PREVIEW = new Map();     // livery id -> a w x h canvas with the train drawn once (the atlas itself is dropped)
/** A train in livery `fx` ('' = factory paint): the front and the side of one car on the stage (256 x 64). */
export function drawLiveryPreview(g, fx, t, w, h) {
  drawStage(g, w, h);
  const id = catalogId('livery', fx), tag = `${id}|${w}|${h}`;
  let pic = LIVERY_PREVIEW.get(tag);
  if (!pic) {
    const atlas = liveryAtlasCanvas(id, 0, [], 101), k = atlas.width / 1024;   // phones: the half-size atlas
    pic = makeCanvas(w, h);
    const p = pic.getContext('2d'), fh = h - 10, sw = w - fh - 22, sh = sw / 4;
    p.fillStyle = 'rgba(0,0,0,0.28)'; p.fillRect(8, h - 5, w - 16, 3);
    p.drawImage(atlas, 0, 256 * k, 256 * k, 256 * k, 6, 4, fh, fh);                         // front tile
    p.drawImage(atlas, 0, 0, 1024 * k, 256 * k, fh + 16, h - 6 - sh, sw, sh);              // side panel
    LIVERY_PREVIEW.set(tag, pic);
    if (LIVERY_PREVIEW.size > 8) LIVERY_PREVIEW.delete(LIVERY_PREVIEW.keys().next().value);
  }
  g.drawImage(pic, 0, FXP.calm ? 0 : Math.sin(t * 3) * 0.6);
}
