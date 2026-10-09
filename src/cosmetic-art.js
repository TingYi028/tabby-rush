import { makeCanvas } from './textures.js';
import { FXP } from './settings.js';

/*
 * 2D art for the shop (src/shop-ui.js) and the world (companions.js / hats.js / fx.js textures): procedural, except the
 * image sheets of the r03 pets (assets/pets) and hats (assets/hats), which load lazily and fall back to a placeholder.
 *  - LookPreview: the real hero frame run through a CPU port of the look shaders (hero-look.js), animated
 *  - drawTrailPreview: small animated particle swatches for the trails
 *  - companionSheet / drawCompanionPreview: the companions' sprite sheets (frames side by side; image pets: PET_ART)
 *  - drawHatPreview: a hat on the hero's head (real run_01 frame, hat sprite from HAT_ART)
 *  - spriteCanvas: particle textures (coin, bone, heart, zzz, ribbon, ...) and the ground paw print
 * Everything draws in the cartoon style of the game: thick dark outline (#3b1d0e), bright flat fills.
 */

const INK = '#3b1d0e';
const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const fract = (v) => v - Math.floor(v);
const mix = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

/* ---------- lazily loaded image art: r03 pets (assets/pets) and hats (assets/hats) ---------- */

const IMG_CACHE = new Map();   // url -> { img: HTMLImageElement | null, p: Promise }

/** Load an image file once (never at boot: pets / hats call this when equipped or shown). Resolves null when it is missing. */
export function loadArt(url) {
  let e = IMG_CACHE.get(url);
  if (!e) {
    e = { img: null, p: null };
    e.p = typeof Image === 'undefined' ? Promise.resolve(null) : new Promise((res) => {
      const im = new Image();
      im.onload = () => { e.img = im; res(im); };
      im.onerror = () => res(null);
      im.src = url;
    });
    IMG_CACHE.set(url, e);
  }
  return e.p;
}
/** The loaded image of `url`, or null while it loads / when it is missing (starts the load on first call). */
export function artReady(url) { loadArt(url); return IMG_CACHE.get(url).img; }

// Image-sheet companions: frames (256 px each, side by side), placeholder colour, preview frame rate
export const PET_ART = {
  shiba: { frames: 2, col: '#f5a04a', prev: 2.5 },
  muyu: { frames: 2, col: '#a8683a', prev: 2.5 },
  capy: { frames: 2, col: '#b98a5a', prev: 1.2 },
  boba: { frames: 2, col: '#e9c79a', prev: 3 },
  saltfish: { frames: 2, col: '#c9a35c', prev: 0.7 },
  ox: { frames: 2, col: '#b9764a', prev: 1.2 },
  pudding: { frames: 4, col: '#f6c453', prev: 5 },
  xlb: { frames: 2, col: '#f3deb0', prev: 3 },
  mochi: { frames: 2, col: '#f6efe6', prev: 2.5 },
  pigeon: { frames: 2, col: '#9aa0b4', prev: 2.5 },
  robovac: { frames: 2, col: '#c8e6e0', prev: 3 },
  sweetpotato: { frames: 2, col: '#e0a030', prev: 3 },
  puffer: { frames: 2, col: '#f5b32e', prev: 1.6 },
  panda: { frames: 2, col: '#e9e9ee', prev: 2.5 },
  penguin: { frames: 2, col: '#4a5568', prev: 1.4 },
};
export const COMPANION_IMG = Object.keys(PET_ART);
export const petFrames = (fx) => (PET_ART[fx] ? PET_ART[fx].frames : 2);
export const petSheetUrl = (fx) => `assets/pets/pet_${fx}.webp`;

// Hat sprites: 256 px frames (side by side when a hat has 2). size = quad side in metres at head scale 1, lift = metres
// above the hair crown (negative: sunk onto the head, e.g. the headphones' cups); the art's bottom edge sits ART_BASE of the
// quad above its lower edge. pulse: depth of a gentle opacity pulse (it dips by 2 x pulse) with a 2 cm bob (static with 減少閃爍). fps: the 2 frames loop at
// that rate (frame 1 only with 減少閃爍); without fps a 2-frame hat is the chick's blink.
export const HAT_ART = {
  party: { frames: 1, size: 0.7, lift: 0 },
  sprout: { frames: 1, size: 0.7, lift: 0 },
  hardhat: { frames: 1, size: 0.7, lift: 0 },
  maid: { frames: 1, size: 0.7, lift: 0 },
  chick: { frames: 2, size: 0.7, lift: 0 },
  crown: { frames: 1, size: 0.7, lift: 0 },
  halo: { frames: 1, size: 0.7, lift: 0.17, pulse: 0.12 },
  chef: { frames: 1, size: 0.7, lift: -0.04 },
  headphones: { frames: 1, size: 0.7, lift: -0.2 },
  propeller: { frames: 2, size: 0.7, lift: 0, fps: 8 },
  flowers: { frames: 1, size: 0.7, lift: -0.1 },
  grad: { frames: 1, size: 0.7, lift: -0.04 },
  bow: { frames: 1, size: 0.7, lift: -0.06 },
  noodle: { frames: 1, size: 0.7, lift: -0.03 },
  cap: { frames: 1, size: 0.7, lift: -0.08 },
  bun: { frames: 1, size: 0.7, lift: 0 },
  lamp: { frames: 1, size: 0.7, lift: 0, pulse: 0.07 },
};
export const HAT_FX = Object.keys(HAT_ART);
export const ART_BASE = 8 / 256;
/** Pure: which frame of hat `fx` shows `t` seconds in: the chick blinks for 0.15 s every 3.2 s, an `fps` hat loops (frame 0 with 減少閃爍). */
export function hatFrame(fx, t) {
  const art = HAT_ART[fx];
  if (!art || art.frames < 2) return 0;
  if (art.fps) return FXP.calm ? 0 : Math.floor(t * art.fps) % art.frames;
  return t % 3.2 > 3.05 ? 1 : 0;
}
export const hatSheetUrl = (fx) => `assets/hats/hat_${fx}.webp`;

/* ---------- look previews (CPU port of hero-look.js, in linear light like the shader) ---------- */

const DEC = new Float32Array(256);
for (let i = 0; i < 256; i++) { const c = i / 255; DEC[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }
const enc = (x) => { x = clamp(x, 0, 1); return x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055; };

function hash2(x, y) {
  let px = fract(x * 123.34), py = fract(y * 456.21);
  const d = px * (px + 45.32) + py * (py + 45.32);
  px += d; py += d;
  return fract(px * py);
}
const luma = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

// 1 texel of the 512x640 frame is this many preview px; spatial detail of the shaders is scaled up to read at thumbnail size
const Z = 2.4;
const CROP = { x: 100, y: 30, w: 330, h: 412 };   // head and shoulders of run_01

export const LOOK_PREVIEW_SIZE = { w: 64, h: 80 };

/** The hero's head and shoulders (assets/hero/run_01) at thumbnail size, drawn through any look at any time. */
export class LookPreview {
  constructor(img, w = LOOK_PREVIEW_SIZE.w, h = LOOK_PREVIEW_SIZE.h) {
    this.w = w;
    this.h = h;
    const c = makeCanvas(w, h), g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, CROP.x, CROP.y, CROP.w, CROP.h, 0, 0, w, h);
    const d = g.getImageData(0, 0, w, h).data, n = w * h;
    this.r = new Float32Array(n); this.g = new Float32Array(n); this.b = new Float32Array(n); this.a = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      this.r[i] = DEC[d[i * 4]]; this.g[i] = DEC[d[i * 4 + 1]]; this.b[i] = DEC[d[i * 4 + 2]]; this.a[i] = d[i * 4 + 3] / 255;
    }
    this.out = null;
    this.px = [0, 0, 0, 0];     // result of the last sample(): r, g, b, a
    this.em = [0, 0, 0];        // additive glow
  }

  sample(x, y) {
    const w = this.w, i = clamp(Math.round(y), 0, this.h - 1) * w + clamp(Math.round(x), 0, w - 1), p = this.px;
    p[0] = this.r[i]; p[1] = this.g[i]; p[2] = this.b[i]; p[3] = this.a[i];
    return p;
  }

  alpha(x, y) { return this.a[clamp(Math.round(y), 0, this.h - 1) * this.w + clamp(Math.round(x), 0, this.w - 1)]; }

  /** [min, max] alpha on a ring of radius `r` preview px. */
  ring(x, y, r) {
    let lo = 1, hi = 0;
    for (let k = 0; k < 8; k++) {
      const a = this.alpha(x + Math.cos(k * 0.7854) * r, y + Math.sin(k * 0.7854) * r);
      if (a < lo) lo = a;
      if (a > hi) hi = a;
    }
    return [lo, hi];
  }

  /** Draw look `look` (0 = original) at time `t` seconds into `ctx` (a canvas of this.w x this.h); `calm` mirrors the reduce-flashing setting. */
  draw(ctx, look, t, calm = false) {
    const { w, h } = this;
    if (!this.out) this.out = ctx.createImageData(w, h);
    const o = this.out.data, em = this.em, cm = calm ? 1 : 0, glow = 0.85;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const u = (CROP.x + ((x + 0.5) / w) * CROP.w) / 512, v = (CROP.y + ((y + 0.5) / h) * CROP.h) / 640;
        em[0] = em[1] = em[2] = 0;
        let r, g, b, a;
        const s = this.sample(x, y);
        r = s[0]; g = s[1]; b = s[2]; a = s[3];
        if (look > 0) [r, g, b, a] = this.look(look, x, y, u, v, t, cm, glow);
        const i = (y * w + x) * 4;
        o[i] = enc(r + em[0]) * 255; o[i + 1] = enc(g + em[1]) * 255; o[i + 2] = enc(b + em[2]) * 255; o[i + 3] = clamp(a, 0, 1) * 255;
      }
    }
    ctx.putImageData(this.out, 0, 0);
  }

  /** One pixel through look `n`. Returns [r, g, b, a] (linear); glow goes to this.em. */
  look(n, x, y, u, v, t, cm, glow) {
    const em = this.em;
    let s = this.sample(x, y);
    let r = s[0], g = s[1], b = s[2], a = s[3];
    const l = luma(r, g, b);
    switch (n) {
      case 1: { // 黑白默片
        const tk = Math.floor(t * mix(18, 5, cm));
        const grain = hash2(Math.floor(x / 1.2) + tk * 17, Math.floor(y / 1.2)) - 0.5;
        let k = smooth(0, 1, clamp(l * 1.9, 0, 1)) * (0.92 + grain * 0.5) + Math.max(grain, 0) * 0.05;
        k *= 1 - 0.07 * (1 - cm) * hash2(tk, 3);
        const sc = hash2(Math.floor(u * 260), tk) > 0.9965 ? 0.3 : 0;
        k = Math.max(k, 0);
        return [k + sc, k * 0.985 + sc, k * 0.95 + sc, a];
      }
      case 2: { // 復古錄影帶
        const row = Math.floor(y / 1.6);
        const wob = (hash2(row, Math.floor(t * 10)) - 0.5) * 0.006 * (1 - cm) * 512 / Z;
        s = this.sample(x + wob, y);
        const ll = luma(s[0], s[1], s[2]);
        const sl = 0.78 + 0.22 * (fract(row * 0.5) >= 0.5 ? 1 : 0);
        const q = (c) => { const e = Math.floor(Math.sqrt(Math.max(c, 0)) * 7 + 0.5) / 7; return e * e * sl; };
        return [q(mix(s[0], ll * 1.25, 0.6)), q(mix(s[1], ll, 0.6)), q(mix(s[2], ll * 0.72, 0.6)), s[3]];
      }
      case 3: { // 霓虹虎斑
        const r1 = this.ring(x, y, 1.0), r2 = this.ring(x, y, 2.4);
        const outl = clamp(r1[1] - a, 0, 1), halo = clamp(r2[1] - Math.max(a, r1[1]), 0, 1), inner = a * (1 - r1[0]);
        const k = 0.5 + 0.5 * Math.sin((t * 0.7 + v * 1.6) * TAU);
        const nr = mix(0.05, 1.0, k), ng = mix(0.9, 0.12, k), nb = mix(1.0, 0.85, k);
        const pulse = 1 - 0.18 * (1 - cm) * (0.5 + 0.5 * Math.sin(t * 7));
        const e = (outl * 2.4 + halo * 0.9 + inner * 1.1) * glow * pulse;
        em[0] = nr * e; em[1] = ng * e; em[2] = nb * e;
        return [r * 0.82 + nr * l * 0.25, g * 0.82 + ng * l * 0.25, b * 0.82 + nb * l * 0.25, Math.max(a, clamp(outl + halo * 0.55, 0, 1))];
      }
      case 4: { // 黃金打工仔
        const k = clamp(l * 1.2, 0, 1);
        const lo = [0.16, 0.07, 0.01], mid = [0.9, 0.52, 0.06], hi = [1.6, 1.2, 0.45];
        const A = k < 0.5 ? lo : mid, B = k < 0.5 ? mid : hi, f = k < 0.5 ? k * 2 : (k - 0.5) * 2;
        const rip = 0.9 + 0.2 * Math.sin(v * 38 + k * 5);
        let c0 = mix(A[0], B[0], f) * rip, c1 = mix(A[1], B[1], f) * rip, c2 = mix(A[2], B[2], f) * rip;
        const sw = fract((u * 0.8 + v * 0.6 - t * 0.5) / 2.4);
        const band = smooth(0, 0.03, sw) * (1 - smooth(0.03, 0.12, sw));
        c0 += 1.3 * band * (0.35 + 0.65 * k); c1 += 1.0 * band * (0.35 + 0.65 * k); c2 += 0.45 * band * (0.35 + 0.65 * k);
        const rate = mix(2.5, 1.3, cm);
        const cx = u * 24, cy = v * 30, fx = fract(cx) - 0.5, fy = fract(cy) - 0.5;
        const hh = hash2(Math.floor(cx) + Math.floor(t * rate) * 11, Math.floor(cy));
        const dia = Math.max(0, 1 - 2.6 * (Math.abs(fx) + Math.abs(fy)));
        const bar = Math.max(Math.max(0, 1 - Math.abs(fy) * 12) * Math.max(0, 1 - Math.abs(fx) * 2.4), Math.max(0, 1 - Math.abs(fx) * 12) * Math.max(0, 1 - Math.abs(fy) * 2.4));
        const on = hh > 0.955 && a > 0.5 && k > 0.45 ? 1 : 0;
        const e = Math.max(dia, bar) * Math.sin(fract(t * rate) * 3.14159) * on * glow;
        em[0] = 2.2 * e; em[1] = 1.8 * e; em[2] = 1.0 * e;
        return [c0, c1, c2, a];
      }
      case 5: { // 全像投影
        const band = Math.floor(v * 46), jit = hash2(band, Math.floor(t * 5));
        const dx = (jit > 0.975 ? (jit - 0.975) * 2.4 : 0) * (1 - cm) * 512 / Z;
        s = this.sample(x + dx, y);
        const rg = this.ring(x + dx, y, 1.2), rim = s[3] * (1 - rg[0]), ll = luma(s[0], s[1], s[2]);
        const scan = 0.5 + 0.5 * Math.sin(v * 280 * 0.55 - t * 4);
        const fl = 1 - 0.12 * (1 - cm) * (hash2(Math.floor(t * 5), 5) >= 0.6 ? 1 : 0);
        const k = (0.12 + 1.35 * ll) * (0.55 + 0.45 * scan) * fl;
        em[0] = 0.2 * rim * 1.6 * glow * fl; em[1] = 1.0 * rim * 1.6 * glow * fl; em[2] = 1.3 * rim * 1.6 * glow * fl;
        return [0.08 * k, 0.75 * k, 1.0 * k, s[3] * (0.5 + 0.3 * scan)];
      }
      case 6: { // 像素風
        const cs = 2.6, cx = Math.floor(x / cs), cy = Math.floor(y / cs);
        s = this.sample((cx + 0.5) * cs, (cy + 0.5) * cs);
        const bay = ((cx % 2 === 0) ? ((cy % 2 === 0) ? 0 : 3) : ((cy % 2 === 0) ? 2 : 1)) / 4;
        const q = (c) => { const e = Math.sqrt(Math.max(c, 0)); const m = Math.floor((e + (bay - 0.4) * 0.18) * 6 + 0.5) / 6; return m * m; };
        return [q(s[0]), q(s[1]), q(s[2]), s[3] > 0.45 ? 1 : 0];
      }
      case 7: { // 彩虹虎斑
        const gr = Math.sqrt(Math.max(r, 0)), gg = Math.sqrt(Math.max(g, 0)), gb = Math.sqrt(Math.max(b, 0));
        const mx = Math.max(gr, gg, gb), mn = Math.min(gr, gg, gb);
        const m = smooth(0.42, 0.62, (mx - mn) / Math.max(mx, 0.001)) * smooth(0.30, 0.50, mx);
        const yy = 0.299 * r + 0.587 * g + 0.114 * b, ii = 0.596 * r - 0.274 * g - 0.322 * b, qq = 0.211 * r - 0.523 * g + 0.312 * b;
        const ang = t * 1.1 + v * 5, cs = Math.cos(ang), sn = Math.sin(ang);
        const i2 = ii * cs - qq * sn, q2 = ii * sn + qq * cs;
        const rr = Math.max(0, yy + 0.956 * i2 + 0.621 * q2) * 1.12, rg2 = Math.max(0, yy - 0.272 * i2 - 0.647 * q2) * 1.12, rb = Math.max(0, yy - 1.106 * i2 + 1.703 * q2) * 1.12;
        em[0] = rr * m * 0.12 * glow; em[1] = rg2 * m * 0.12 * glow; em[2] = rb * m * 0.12 * glow;
        return [mix(r, rr, m), mix(g, rg2, m), mix(b, rb, m), a];
      }
      case 8: { // 隱形斗篷
        const wx = Math.sin(v * 70 + t * 3) * 0.0045 * mix(1, 0.4, cm) * 512 / Z, wy = Math.cos(u * 55 - t * 2.3) * 0.0045 * mix(1, 0.4, cm) * 512 / Z;
        s = this.sample(x + wx, y + wy);
        const rg = this.ring(x + wx, y + wy, 1.2), rim = s[3] * (1 - rg[0]);
        const sh = 0.5 + 0.5 * Math.sin(v * 90 * 0.6 - t * 3.5 + Math.sin(u * 28) * 2.5), ll = luma(s[0], s[1], s[2]);
        const k = (0.25 + 1.1 * ll) * (0.8 + 0.4 * sh);
        const e = (rim * 1.4 + s[3] * sh * 0.08) * glow;
        em[0] = 0.55 * e; em[1] = 0.95 * e; em[2] = 1.15 * e;
        return [0.35 * k, 0.62 * k, 0.85 * k, Math.min(1, s[3] * (0.3 + 0.12 * sh) + rim * 0.55)];
      }
      case 9: { // 故障藝術
        const tk = Math.floor(t * 9), burst = (1 - cm) * (hash2(tk, 1) >= 0.7 ? 1 : 0);
        const shift = (hash2(Math.floor(v * 28), tk) - 0.5) * 0.07 * burst * 512 / Z, split = (0.004 + 0.014 * burst) * 512 / Z;
        const sr = this.sample(x + shift + split, y).slice(), sg = this.sample(x + shift, y).slice(), sb = this.sample(x + shift - split, y).slice();
        const aa = Math.max(sg[3], sr[3], sb[3]), d = Math.max(aa, 0.02), ln = 0.9 + 0.1 * Math.sin(v * 520 * 0.6);
        let c = [sr[0] * sr[3] / d * ln, sg[1] * sg[3] / d * ln, sb[2] * sb[3] / d * ln];
        const blk = hash2(Math.floor(u * 9) + tk, Math.floor(v * 12)) >= 0.93 ? burst : 0;
        c = [mix(c[0], c[2] * 1.3, blk * 0.55), mix(c[1], c[1] * 1.3, blk * 0.55), mix(c[2], c[0] * 1.3, blk * 0.55)];
        return [c[0], c[1], c[2], aa];
      }
      case 10: { // 底片負片
        const ng = (c) => (1 - Math.sqrt(clamp(c, 0, 1))) ** 2;
        return [ng(r) * 0.95, ng(g), ng(b) * 1.1, a];
      }
      case 11: { // 熱像儀
        s = this.sample(x + Math.sin(v * 45 + t * 2) * 0.0025 * (1 - 0.6 * cm) * 512 / Z, y);
        const k = clamp(luma(s[0], s[1], s[2]) * 1.8 + 0.04 * Math.sin(t * 1.3 + v * 8), 0, 1);
        const c = [mix(0, 0.35, smooth(0, 0.25, k)), 0, mix(0.08, 0.45, smooth(0, 0.25, k))];
        const m1 = smooth(0.25, 0.5, k), m2 = smooth(0.5, 0.75, k), m3 = smooth(0.75, 1, k);
        c[0] = mix(c[0], 0.9, m1); c[1] = mix(c[1], 0.05, m1); c[2] = mix(c[2], 0.1, m1);
        c[0] = mix(c[0], 1.4, m2); c[1] = mix(c[1], 0.7, m2); c[2] = mix(c[2], 0.05, m2);
        c[0] = mix(c[0], 1.8, m3); c[1] = mix(c[1], 1.7, m3); c[2] = mix(c[2], 0.7, m3);
        return [c[0], c[1], c[2], s[3]];
      }
      case 12: { // 漫畫網點
        const rg = this.ring(x, y, 1.0), outl = clamp(rg[1] - a, 0, 1);
        const q = (c) => { const e = Math.floor(Math.sqrt(Math.max(c, 0)) * 4 + 0.5) / 4; return e * e * 1.05; };
        let c = [q(r), q(g), q(b)];
        const gx = u * 72 * 0.6, gy = v * 90 * 0.6, rx = (gx + gy) * 0.7071, ry = (gy - gx) * 0.7071;
        const d = Math.hypot(fract(rx) - 0.5, fract(ry) - 0.5), rad = clamp(0.62 - l * 1.15, 0, 0.62);
        const ink = (1 - smooth(rad - 0.06, rad + 0.04, d)) * (rad >= 0.02 ? 1 : 0);
        c = c.map((k) => mix(k, k * 0.12, ink));
        const o = clamp(outl * 2, 0, 1), cv = smooth(0, 0.6, a);
        return [mix(c[0] * cv, 0.02, o), mix(c[1] * cv, 0.02, o), mix(c[2] * cv, 0.02, o), Math.max(a, clamp(outl * 1.6, 0, 1))];
      }
      case 13: { // 美拉德穿搭
        const t3 = clamp((Math.sqrt(clamp(l, 0, 1)) - 0.1) * 1.2, 0, 1) * 3, k = Math.min(2, Math.floor(t3)), f = t3 - k;
        const R = [[0.044, 0.017, 0.008], [0.195, 0.069, 0.023], [0.527, 0.254, 0.102], [0.879, 0.694, 0.462]];
        const tk = Math.floor(t * mix(9, 2, cm)), gr = hash2(Math.floor(x / 1.2) + tk * 7, Math.floor(y / 1.2)) - 0.5;
        const c = [0, 1, 2].map((i) => Math.max(0, mix(R[k][i], R[k + 1][i], f) * (1 + gr * 0.14) + [1, 0.8, 0.55][i] * gr * 0.02));
        return [c[0], c[1], c[2], a];
      }
      case 14: { // 多巴胺配色
        const gr = [Math.sqrt(Math.max(r, 0)), Math.sqrt(Math.max(g, 0)), Math.sqrt(Math.max(b, 0))];
        const mx = Math.max(...gr), sat = (mx - Math.min(...gr)) / Math.max(mx, 0.001), lv = clamp((luma(gr[0], gr[1], gr[2]) - 0.35) / 0.45, 0, 0.999) * 5;
        const PAL = [[0.62, 0.45, 1], [1, 0.48, 0.74], [1, 0.72, 0.42], [1, 0.92, 0.45], [0.45, 1, 0.78]], p = PAL[Math.floor(lv)], pl = luma(p[0], p[1], p[2]);
        const m = smooth(0.35, 0.55, sat) * smooth(0.45, 0.6, mx), gl = 0.9 + 0.2 * fract(lv);
        const cd = p.map((q) => { const e = clamp(mix(pl, q, 1.25), 0, 1) * gl; return e * e * 1.05; });
        return [mix(r, cd[0], m), mix(g, cd[1], m), mix(b, cd[2], m), a];
      }
      case 15: { // CCD 數位感
        const tk = Math.floor(t * mix(8, 2, cm)), cx = Math.floor(x / 1.2), cy = Math.floor(y / 1.2);
        const ch = [hash2(cx + tk * 3, cy) - 0.5, hash2(cx + tk * 5 + 17, cy) - 0.5, hash2(cx + tk * 7 + 31, cy) - 0.5];
        const lift = 0.14 * smooth(0.45, 1, l * 2), ph = t % 4, pop = (1 - cm) * (ph <= 0.12 ? Math.sin(ph / 0.12 * 3.14159) : 0);
        const ex = 1 + 0.35 * pop, cast = [1.08, 1, 0.86], gg = [Math.sqrt(Math.max(r, 0)), Math.sqrt(Math.max(g, 0)), Math.sqrt(Math.max(b, 0))];
        const c = gg.map((q, i) => { const e = (mix(mix(q, 1, lift), l * 1.2, 0.12) * 0.88 + 0.1) * cast[i] + ch[i] * 0.05; return Math.max(0, e * ex) ** 2; });
        em[0] = 0.12 * pop * glow; em[1] = 0.11 * pop * glow; em[2] = 0.09 * pop * glow;
        return [c[0], c[1], c[2], a];
      }
      case 16: { // Y2K 鍍鉻
        const tt = clamp(l * 1.9, 0, 1), refl = 0.5 + 0.5 * Math.sin(tt * 9 + v * 7 - t * 0.4), uu = clamp(tt * 0.75 + refl * 0.3 - 0.05, 0, 1);
        const D = [0.015, 0.02, 0.035], M = [0.3, 0.36, 0.5], L = [0.85, 0.92, 1.05];
        const sw = fract((u * 0.7 + v * 0.7 - t * 0.3) / 1.7), band = smooth(0, 0.04, sw) * (1 - smooth(0.04, 0.15, sw));
        const irid = [0, 0.33, 0.67].map((o) => 0.5 + 0.5 * Math.cos(TAU * (sw * 2.5 + o)));
        const c = [0, 1, 2].map((i) => (uu < 0.5 ? mix(D[i], M[i], uu * 2) : mix(M[i], L[i], (uu - 0.5) * 2)) + irid[i] * band * (0.25 + 0.75 * tt) * 0.55);
        const sheen = tt * tt * tt * 0.18;
        em[0] = (irid[0] * band * 0.45 + 0.75 * sheen) * glow; em[1] = (irid[1] * band * 0.45 + 0.85 * sheen) * glow; em[2] = (irid[2] * band * 0.45 + sheen) * glow;
        return [c[0], c[1], c[2], a];
      }
      case 17: { // 果凍貓
        const amp = 0.012 * mix(1, 0.35, cm) * 512 / Z;
        s = this.sample(x + Math.sin(v * 18 + t * 5) * amp, y + Math.cos(u * 14 + t * 4.2) * amp);
        const rg = this.ring(x + Math.sin(v * 18 + t * 5) * amp, y + Math.cos(u * 14 + t * 4.2) * amp, 1.2), edge = s[3] * (1 - rg[0]);
        const ll = Math.sqrt(luma(s[0], s[1], s[2])), T = [1, 0.42, 0.36];
        const bx = 0.5 + 0.2 * Math.sin(t * 0.9), by = 0.3 + 0.12 * Math.cos(t * 0.7), dd = Math.hypot(u - bx, (v - by) * 0.8);
        const blob = (1 - smooth(0, 0.11, dd)) * s[3];
        const c = [0, 1, 2].map((i) => [s[0], s[1], s[2]][i] * 0.5 + T[i] * (0.3 + 0.7 * ll) * 0.55);
        em[0] = (T[0] * edge * 0.3 + blob * 0.85) * glow; em[1] = (T[1] * edge * 0.3 + blob * 0.82) * glow; em[2] = (T[2] * edge * 0.3 + blob * 0.81) * glow;
        return [c[0], c[1], c[2], s[3] * mix(0.8, 1, edge)];
      }
      case 18: { // 大理石雕像
        const ll = Math.sqrt(clamp(l, 0, 1)), vein = (px, py) => { const w = Math.sin(px * 3.1 + Math.sin(py * 4.3) * 1.7) + Math.sin(py * 2.3 - Math.sin(px * 3.7) * 1.3); return 1 - smooth(0, 0.18, Math.abs(w)); };
        const vn = Math.max(vein(u * 7 * 1.6, v * 8.5 * 1.6), 0.6 * vein(u * 17 * 1.6 + 3.1, v * 21 * 1.6 + 3.1)), k = 0.1 + ll;
        const vm = vn * 0.85 * smooth(0.1, 0.4, ll), vc = [0.36, 0.38, 0.42], st = [0.86, 0.85, 0.82];
        const sw = fract((u * 0.6 + v * 0.8 - t * 0.12) / 1.7), sheen = smooth(0, 0.25, sw) * (1 - smooth(0.25, 0.5, sw)), e = (smooth(0.7, 1, ll) * 0.1 + sheen * ll * ll * 0.08) * glow;
        em[0] = e; em[1] = e * 0.98; em[2] = e * 0.94;
        return [0, 1, 2].map((i) => mix(st[i] * k, vc[i] * (0.3 + 0.7 * ll), vm)).concat([a]);
      }
      case 19: { // 黏土動畫
        const tk = Math.floor(t * 8), f = 1 - cm;
        s = this.sample(x + ((hash2(tk, 1) - 0.5) * 0.006 + Math.sin(v * 40 + tk * 1.3) * 0.0025) * f * 512 / Z, y + ((hash2(tk, 2) - 0.5) * 0.006 + Math.cos(u * 34 + tk * 0.9) * 0.0025) * f * 512 / Z);
        const gg = [Math.sqrt(Math.max(s[0], 0)), Math.sqrt(Math.max(s[1], 0)), Math.sqrt(Math.max(s[2], 0))], gl = luma(gg[0], gg[1], gg[2]);
        const qx = u * 6 * 1.5, qy = v * 7.5 * 1.5, cx = Math.floor(qx), cy = Math.floor(qy);
        const fx = fract(qx) - 0.5 - (hash2(cx, cy) - 0.5) * 0.4, fy = fract(qy) - 0.5 - (hash2(cx + 7.7, cy + 7.7) - 0.5) * 0.4, fl = Math.hypot(fx, fy);
        const ridge = Math.sin(fl * 38 + hash2(cx + 3.3, cy + 3.3) * 6.2832) * (1 - smooth(0.25, 0.5, fl)), grain = hash2(Math.floor(x / 1.5), Math.floor(y / 1.5)) - 0.5;
        const rg = this.ring(x, y, 1.4), edge = s[3] * (1 - rg[0]);
        const c = gg.map((q) => { const e = 0.26 + mix(gl, q, 1.15) * 0.68 + ridge * 0.035 + grain * 0.05 + 0.06 * edge; return Math.max(e, 0) ** 2; });
        return [c[0], c[1], c[2], s[3]];
      }
      case 20: { // 鉛筆素描
        const tk = Math.floor(t * 6) * (1 - cm), ll = Math.sqrt(clamp(l, 0, 1));
        const w = Math.sin(v * 31 + tk) * 0.12 + Math.sin(u * 23 - tk * 1.7) * 0.1, gx = u * 46 * 0.75, gy = v * 57.5 * 0.75;
        const hatch = (q) => smooth(0.37, 0.5, fract(q)) * (1 - smooth(0.5, 0.63, fract(q)));
        const ht = Math.max(Math.max(hatch((gx + gy) * 0.7071 + w) * (1 - smooth(0.7, 0.9, ll)), hatch((gx - gy) * 0.7071 + w * 1.3) * (1 - smooth(0.5, 0.66, ll))), hatch(gy * 1.1 + w * 0.8) * (1 - smooth(0.25, 0.4, ll)));
        const fibre = hash2(Math.floor(x / 1.2), Math.floor(y / 1.2)) - 0.5, rg = this.ring(x, y, 1.1), outl = a * (1 - rg[0]);
        const ink = clamp(ht * 0.85 + outl * 0.9, 0, 1), pp = (0.95 + 0.1 * fibre) * (0.86 + 0.14 * smooth(0, 0.7, ll)), PC = [0.86, 0.85, 0.8], IN = [0.09, 0.09, 0.11];
        return [0, 1, 2].map((i) => mix(PC[i] * pp, IN[i], ink)).concat([a]);
      }
      case 21: { // 蒸氣波
        const vy = 1 - v, tt = clamp((Math.sqrt(clamp(l, 0, 1)) - 0.15) * 1.4 + (vy - 0.5) * 0.55, 0, 1);
        const C0 = [0.12, 0.02, 0.28], C1 = [1, 0.22, 0.62], C2 = [0.25, 0.9, 1];
        const sl = 0.8 + 0.2 * (fract(y / 2.2) >= 0.5 ? 1 : 0), sw = fract(vy * 0.9 + t * 0.18), bd = 1 + 0.3 * (1 - cm) * smooth(0, 0.08, sw) * (1 - smooth(0.08, 0.3, sw));
        const c = [0, 1, 2].map((i) => (tt < 0.5 ? mix(C0[i], C1[i], tt * 2) : mix(C1[i], C2[i], (tt - 0.5) * 2)) * sl * bd), e = smooth(0.55, 0.9, tt) * 0.08 * glow;
        em[0] = e; em[1] = e * 0.4; em[2] = e * 0.8;
        return [c[0], c[1], c[2], a];
      }
      case 22: { // 夜光貼紙 (the shop preview sits in "the dark": the zone tint is stood in for by a slow swell of the darkness)
        const ll = Math.sqrt(clamp(l, 0, 1)), dk = 0.85 - 0.25 * (1 - cm) * (0.5 + 0.5 * Math.sin(t * 0.9));
        const rg = this.ring(x, y, 1.4), rim = a * (1 - rg[0]), pulse = 0.94 + 0.06 * (1 - cm) * Math.sin(t * 1.6);
        const e = ((0.35 + 0.65 * ll) * (0.18 + dk) + rim * (0.3 + 0.7 * dk) * 0.8) * pulse * a * glow;
        em[0] = 0.25 * e; em[1] = e; em[2] = 0.5 * e;
        const lk = clamp(ll * ll * 1.4, 0, 1);
        return [mix(0.02, 0.62, lk), mix(0.05, 0.85, lk), mix(0.03, 0.5, lk), a];
      }
      default: return [r, g, b, a];
    }
  }
}

/* ---------- stage ---------- */

/** The dark "night" backdrop behind every preview (glows and see-through looks need something to show against). */
export function drawStage(g, w, h) {
  const bg = g.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, '#3a2f63');
  bg.addColorStop(1, '#1d1a38');
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(255,255,255,0.07)';
  g.fillRect(0, h * 0.78, w, h * 0.22);
}

/* ---------- trail previews ---------- */

function pill(g, x, y, s, alpha = 1) {            // the hero, very small, seen from behind
  g.save();
  g.globalAlpha *= alpha;
  g.translate(x, y);
  g.scale(s, s);
  g.fillStyle = '#ff9a2a';
  g.strokeStyle = INK;
  g.lineWidth = 2;
  g.beginPath(); g.ellipse(0, 7, 7, 10, 0, 0, TAU); g.fill(); g.stroke();
  g.fillStyle = '#2a1a14';
  g.beginPath(); g.arc(0, -6, 6.5, 0, TAU); g.fill();
  g.fillStyle = '#ff9a2a';
  g.beginPath(); g.moveTo(-6, -9); g.lineTo(-5, -15); g.lineTo(-1, -11); g.fill();
  g.beginPath(); g.moveTo(6, -9); g.lineTo(5, -15); g.lineTo(1, -11); g.fill();
  g.restore();
}

const SPECTRUM = ['#ff4d4d', '#ff9a2a', '#ffe14a', '#5be37d', '#4db8ff', '#b06cff'];

/** Animated swatch of trail `fx` (the catalog's trail key) at time t, in a w x h canvas context. */
export function drawTrailPreview(g, fx, t, w, h) {
  drawStage(g, w, h);
  const cx = w / 2, top = h * 0.3;
  g.save();
  if (!fx) {
    // no trail: just the hero
  } else if (fx === 'ghost') {
    pill(g, cx + 9 + Math.sin(t * 2) * 1.5, top + 17, 1.15, 0.12);
    pill(g, cx + 5 + Math.sin(t * 2) * 1, top + 9, 1.15, 0.22);
  } else if (fx === 'paw') {
    for (let i = 0; i < 4; i++) {
      const ph = fract(t * 0.7 + i / 4), side = i % 2 ? 1 : -1, y = top + 10 + ph * (h - top - 14);
      g.globalAlpha = 1 - ph;
      g.fillStyle = '#e9d7bd';
      const px = cx + side * 6;
      g.beginPath(); g.ellipse(px, y, 4, 3.4, 0, 0, TAU); g.fill();
      for (let k = -1; k <= 2; k++) { g.beginPath(); g.arc(px + (k - 0.5) * 3.2, y - 5 - (k === 0 || k === 1 ? 1 : 0), 1.5, 0, TAU); g.fill(); }
    }
  } else {
    const N = fx === 'galaxy' ? 40 : fx === 'rainbow' || fx === 'danmaku' || fx === 'merit' ? 0 : fx === 'zzz' ? 5 : fx === 'heart' ? 9 : fx === 'confetti' ? 26 : 18;
    if (fx === 'danmaku') {
      // comments scroll sideways in two lanes below / beside the hero, never over it
      g.font = '900 9px "Noto Sans TC", "Microsoft JhengHei", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
      for (let i = 0; i < 5; i++) {
        const ph = fract(t * 0.32 + i * 0.37), y = top + 24 + (i % 2) * 13, x = w + 12 - ph * (w + 40), word = TRAIL_TEXT.danmaku[i];
        g.globalAlpha = 1; g.lineWidth = 2.6; g.strokeStyle = INK; g.strokeText(word, x, y); g.fillStyle = '#fff'; g.fillText(word, x, y);
      }
    }
    if (fx === 'merit') {
      g.font = '900 9px "Noto Sans TC", "Microsoft JhengHei", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
      const ph = fract(t / 0.9);
      g.globalAlpha = 1 - ph * ph; g.lineWidth = 2.6; g.strokeStyle = INK;
      g.strokeText(TRAIL_TEXT.merit, cx, top - 18 - ph * 10); g.fillStyle = '#ffd23f'; g.fillText(TRAIL_TEXT.merit, cx, top - 18 - ph * 10);
      const rp = fract(t / 0.45);
      g.globalAlpha = 1 - rp; g.strokeStyle = '#ffd23f'; g.lineWidth = 1.6;
      g.beginPath(); g.ellipse(cx, top + 22, 5 + rp * 12, 2 + rp * 4, 0, 0, TAU); g.stroke();
    }
    if (fx === 'rainbow') {
      for (let b = 0; b < SPECTRUM.length; b++) {
        g.strokeStyle = SPECTRUM[b];
        g.lineWidth = 2.4;
        g.globalAlpha = 0.95;
        g.beginPath();
        for (let y = top + 8; y <= h - 4; y += 3) {
          const k = (y - top) / (h - top), x = cx + (b - 2.5) * 3.1 * (0.6 + k * 0.9) + Math.sin(y * 0.22 - t * 5) * 2;
          if (y === top + 8) g.moveTo(x, y); else g.lineTo(x, y);
        }
        g.stroke();
      }
    }
    for (let i = 0; i < N; i++) {
      const seed = hash2(i, 7), ph = fract(t * (0.5 + 0.4 * seed) + i / N), a0 = hash2(i, 3) * TAU;
      let x = cx, y = top + 6 + ph * (h - top - 8), sz = 2, col = '#fff', alpha = 1 - ph;
      g.globalCompositeOperation = 'source-over';
      switch (fx) {
        case 'coin':
          x = cx + (seed - 0.5) * 26; y = top + ph * (h - top); sz = 3.2; col = '#ffd23f';
          g.globalAlpha = alpha; g.fillStyle = col; g.strokeStyle = INK; g.lineWidth = 1;
          g.beginPath(); g.ellipse(x, y, sz * Math.abs(Math.cos(t * 5 + i)), sz, 0, 0, TAU); g.fill(); g.stroke();
          continue;
        case 'bubble':
          x = cx + (seed - 0.5) * 22 + Math.sin(t * 2 + i) * 2; sz = 2 + seed * 3;
          g.globalAlpha = alpha;
          if (i % 2) { g.strokeStyle = '#d6f3ff'; g.fillStyle = 'rgba(214,243,255,0.25)'; g.lineWidth = 1; g.beginPath(); g.arc(x, y, sz, 0, TAU); g.fill(); g.stroke(); }
          else { g.fillStyle = '#4b2a17'; g.beginPath(); g.arc(x, y, 2.2, 0, TAU); g.fill(); }
          continue;
        case 'bone':
          x = cx + (seed - 0.5) * 20; sz = 5;
          g.globalAlpha = alpha; g.strokeStyle = '#fff7e0'; g.lineWidth = 1.2;
          g.save(); g.translate(x, y); g.rotate(a0 + t * 2);
          g.beginPath(); g.moveTo(-sz, 0); g.lineTo(sz, 0); g.moveTo(-1.5, 0); g.lineTo(-3, -3); g.moveTo(-1.5, 0); g.lineTo(-3, 3); g.moveTo(1.5, 0); g.lineTo(3, -3); g.moveTo(1.5, 0); g.lineTo(3, 3); g.stroke();
          g.restore();
          continue;
        case 'fire':
          g.globalCompositeOperation = 'lighter';
          x = cx + (seed - 0.5) * 12 * (1 - ph * 0.4); sz = 5 * (1 - ph) + 1;
          col = ph < 0.35 ? '#ffe36b' : ph < 0.7 ? '#ff8a2a' : '#c0361f';
          break;
        case 'star':
          g.globalCompositeOperation = 'lighter';
          x = cx + (seed - 0.5) * 34; y = top + hash2(i, 9) * (h - top - 6); sz = 1.5 + 2 * Math.abs(Math.sin(t * 3 + i));
          alpha = 0.5 + 0.5 * Math.sin(t * 3 + i * 1.7);
          col = i % 3 ? '#cfe6ff' : '#ffe9a8';
          g.globalAlpha = Math.max(0, alpha); g.fillStyle = col;
          g.beginPath(); g.moveTo(x, y - sz * 2); g.lineTo(x + sz * 0.6, y); g.lineTo(x, y + sz * 2); g.lineTo(x - sz * 0.6, y); g.closePath(); g.fill();
          g.beginPath(); g.moveTo(x - sz * 2, y); g.lineTo(x, y + sz * 0.6); g.lineTo(x + sz * 2, y); g.lineTo(x, y - sz * 0.6); g.closePath(); g.fill();
          continue;
        case 'galaxy': {
          g.globalCompositeOperation = 'lighter';
          const rad = ph * 24, ang = a0 + ph * 4 + t;
          x = cx + Math.cos(ang) * rad * 0.9; y = top + 8 + ph * (h - top - 10) + Math.sin(ang) * rad * 0.25;
          sz = 1.6 * (1 - ph) + 0.5; col = ['#7fd8ff', '#ff7ad9', '#fff4c2', '#a58bff'][i % 4];
          break;
        }
        case 'heart': {
          x = cx + (seed - 0.5) * 24 + Math.sin(t * 2 + i) * 2; y = top + 4 + ph * (h - top - 6); sz = 2.6 + seed * 1.6;
          g.globalAlpha = alpha; g.fillStyle = '#ff5f93'; g.strokeStyle = INK; g.lineWidth = 1;
          heartPath(g, x, y, sz); g.fill(); g.stroke();
          if (i % 8 === 0) { g.strokeStyle = '#ffd9b8'; g.lineWidth = 1.4; g.beginPath(); g.moveTo(x - 2, y + sz * 1.6); g.lineTo(x + 2, y + sz * 0.7); g.moveTo(x + 2, y + sz * 1.6); g.lineTo(x - 2, y + sz * 0.7); g.stroke(); }
          continue;
        }
        case 'zzz': {
          x = cx + 6 + i * 2.2 - ph * 4; y = top - 4 - ph * 22 + (i % 3) * 8; sz = 2.4 + (i % 3) * 1.4;
          g.globalAlpha = Math.min(1, ph * 6) * (1 - ph) * 1.3; g.fillStyle = '#c9b6ff'; g.strokeStyle = INK; g.lineWidth = 0.9;
          g.beginPath(); g.moveTo(x - sz, y - sz); g.lineTo(x + sz, y - sz); g.lineTo(x - sz, y + sz); g.lineTo(x + sz, y + sz); g.closePath(); g.fill(); g.stroke();
          continue;
        }
        case 'confetti': {
          x = cx + (seed - 0.5) * 34 + Math.sin(t * 3 + i) * 3; y = top + 2 + ph * (h - top - 4);
          g.globalAlpha = Math.min(1, alpha * 1.6); g.fillStyle = SPECTRUM[i % 6]; g.strokeStyle = SPECTRUM[i % 6];
          g.save(); g.translate(x, y); g.rotate(a0 + t * 4);
          if (i % 2) g.fillRect(-2, -1.5, 4, 3);
          else { g.lineWidth = 1.6; g.beginPath(); g.moveTo(-4, 0); g.quadraticCurveTo(-2, -3, 0, 0); g.quadraticCurveTo(2, 3, 4, 0); g.stroke(); }
          g.restore();
          continue;
        }
        default: break;
      }
      g.globalAlpha = Math.max(0, alpha);
      g.fillStyle = col;
      g.beginPath(); g.arc(x, y, Math.max(0.4, sz), 0, TAU); g.fill();
    }
  }
  g.restore();
  g.globalCompositeOperation = 'source-over';
  g.globalAlpha = 1;
  pill(g, cx, top, 1.15);
}

/* ---------- companion art ---------- */

function rr(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r);
  g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y);
  g.closePath();
}
function fillStroke(g, fill, lw = 5) {
  g.fillStyle = fill;
  g.strokeStyle = INK;
  g.lineWidth = lw;
  g.lineJoin = 'round';
  g.lineCap = 'round';
  g.fill();
  g.stroke();
}
function poly(g, pts) { g.beginPath(); g.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]); g.closePath(); }
function grad(g, y0, y1, a, b) { const k = g.createLinearGradient(0, y0, 0, y1); k.addColorStop(0, a); k.addColorStop(1, b); return k; }

const ART = {
  drone(g, f) {
    g.strokeStyle = INK; g.lineWidth = 6; g.lineCap = 'round';
    g.beginPath(); g.moveTo(40, 58); g.lineTo(24, 42); g.moveTo(88, 58); g.lineTo(104, 42); g.stroke();
    for (const x of [24, 104]) {
      g.fillStyle = 'rgba(255,255,255,0.6)'; g.strokeStyle = INK; g.lineWidth = 2.5;
      g.beginPath(); g.ellipse(x, 38, 22, f ? 9 : 4.5, 0, 0, TAU); g.fill(); g.stroke();
    }
    g.beginPath(); g.moveTo(64, 50); g.lineTo(64, 34); g.strokeStyle = INK; g.lineWidth = 4; g.stroke();
    g.beginPath(); g.arc(64, 31, 5, 0, TAU); fillStroke(g, f ? '#fff08a' : '#ffd23f', 3);
    rr(g, 34, 48, 60, 46, 22); fillStroke(g, grad(g, 48, 94, '#4fe0cb', '#1ea896'));
    g.fillStyle = 'rgba(255,255,255,0.35)'; g.beginPath(); g.ellipse(50, 56, 9, 4, -0.3, 0, TAU); g.fill();
    g.fillStyle = '#12313a'; g.beginPath(); g.ellipse(64, 72, 19, 12, 0, 0, TAU); g.fill();
    g.fillStyle = f ? '#b8fff3' : '#6fffe9'; g.beginPath(); g.arc(64, 72, f ? 6.5 : 5.2, 0, TAU); g.fill();
    g.fillStyle = '#fff'; g.beginPath(); g.arc(61, 69, 1.8, 0, TAU); g.fill();
    g.strokeStyle = INK; g.lineWidth = 5; g.beginPath(); g.moveTo(48, 94); g.lineTo(48, 101); g.moveTo(80, 94); g.lineTo(80, 101); g.stroke();
  },
  box(g, f) {
    // back flaps, cat, then the front of the box over the cat's chin
    poly(g, [18, 62, 6, 44, 38, 38, 46, 62]); fillStroke(g, '#c68b52', 4);
    poly(g, [110, 62, 122, 44, 90, 38, 82, 62]); fillStroke(g, '#c68b52', 4);
    // ears
    poly(g, [40, 40, 42, 12, 62, 30]); fillStroke(g, '#f2892c', 4);
    poly(g, [88, 40, 86, 12, 66, 30]); fillStroke(g, '#f2892c', 4);
    poly(g, [45, 34, 46, 20, 55, 30]); g.fillStyle = '#ff9fb2'; g.fill();
    poly(g, [83, 34, 82, 20, 73, 30]); g.fillStyle = '#ff9fb2'; g.fill();
    g.beginPath(); g.ellipse(64, 50, 29, 23, 0, 0, TAU); fillStroke(g, '#ff9a2a', 5);
    g.strokeStyle = '#c86a14'; g.lineWidth = 3; g.lineCap = 'round';
    g.beginPath(); g.moveTo(58, 31); g.lineTo(58, 38); g.moveTo(64, 29); g.lineTo(64, 37); g.moveTo(70, 31); g.lineTo(70, 38); g.stroke();
    if (f) {   // blink
      g.strokeStyle = INK; g.lineWidth = 3.5;
      g.beginPath(); g.arc(52, 50, 6, 0.2, Math.PI - 0.2); g.moveTo(82, 50); g.arc(76, 50, 6, 0.2, Math.PI - 0.2); g.stroke();
    } else {
      for (const x of [52, 76]) {
        g.fillStyle = '#fff'; g.strokeStyle = INK; g.lineWidth = 3;
        g.beginPath(); g.ellipse(x, 49, 7, 8.5, 0, 0, TAU); g.fill(); g.stroke();
        g.fillStyle = INK; g.beginPath(); g.ellipse(x + 1.5, 51, 3.4, 5, 0, 0, TAU); g.fill();
      }
    }
    poly(g, [60, 58, 68, 58, 64, 63]); g.fillStyle = '#ff6f91'; g.fill();
    g.strokeStyle = INK; g.lineWidth = 2; g.beginPath(); g.moveTo(40, 60); g.lineTo(26, 57); g.moveTo(40, 64); g.lineTo(26, 66); g.moveTo(88, 60); g.lineTo(102, 57); g.moveTo(88, 64); g.lineTo(102, 66); g.stroke();
    rr(g, 20, 66, 88, 50, 6); fillStroke(g, grad(g, 66, 116, '#e0aa6c', '#c68b52'));
    g.fillStyle = 'rgba(255,240,205,0.85)'; g.fillRect(56, 67, 16, 48);
    g.strokeStyle = 'rgba(59,29,20,0.35)'; g.lineWidth = 2; g.beginPath(); g.moveTo(30, 100); g.lineTo(46, 100); g.moveTo(84, 100); g.lineTo(98, 100); g.stroke();
  },
  fish(g, f) {
    const s = f ? 1 : -1;
    g.strokeStyle = INK; g.lineWidth = 3; g.lineCap = 'round';
    g.beginPath(); g.moveTo(68, 92); g.quadraticCurveTo(58 + s * 4, 106, 66, 122); g.stroke();
    poly(g, [36, 64, 8, 44 + s * 6, 8, 84 + s * 6]); fillStroke(g, '#ff7aa8');
    poly(g, [58, 40, 76, 20 + s * 2, 90, 42]); fillStroke(g, '#ff7aa8');
    g.beginPath(); g.ellipse(70, 64, 40, 28, 0, 0, TAU); fillStroke(g, grad(g, 36, 92, '#ffc15a', '#ff7a45'));
    g.fillStyle = 'rgba(255,255,255,0.4)'; g.beginPath(); g.ellipse(72, 78, 28, 9, 0, 0, TAU); g.fill();
    g.strokeStyle = 'rgba(59,29,20,0.35)'; g.lineWidth = 2.5;
    for (const [x, y] of [[54, 60], [66, 54], [66, 68], [78, 60], [78, 74]]) { g.beginPath(); g.arc(x, y, 6, -0.9, 0.9); g.stroke(); }
    g.beginPath(); g.arc(92, 56, 8.5, 0, TAU); g.fillStyle = '#fff'; g.fill(); g.strokeStyle = INK; g.lineWidth = 3; g.stroke();
    g.fillStyle = INK; g.beginPath(); g.arc(94, 57, 4.2, 0, TAU); g.fill();
    g.fillStyle = '#fff'; g.beginPath(); g.arc(95.5, 55.5, 1.4, 0, TAU); g.fill();
    g.strokeStyle = INK; g.lineWidth = 3; g.beginPath(); g.arc(104, 66, 6, 0.2, 1.6); g.stroke();
  },
  train(g, f) {
    g.fillStyle = INK; g.fillRect(14, 86, 100, 10);
    // smoke
    g.fillStyle = 'rgba(255,255,255,0.92)'; g.strokeStyle = 'rgba(59,29,20,0.5)'; g.lineWidth = 2;
    for (const [x, y, r] of f ? [[92, 20, 10], [102, 10, 6]] : [[88, 24, 8], [96, 14, 10]]) { g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill(); g.stroke(); }
    rr(g, 82, 30, 14, 26, 3); fillStroke(g, '#4a4a55', 4);
    rr(g, 78, 26, 22, 8, 3); fillStroke(g, '#2f2f3a', 4);
    rr(g, 56, 52, 58, 36, 14); fillStroke(g, grad(g, 52, 88, '#ff6a50', '#d93a22'));
    g.fillStyle = '#ffd23f'; g.fillRect(58, 72, 54, 5);
    g.beginPath(); g.arc(112, 68, 6, 0, TAU); fillStroke(g, '#fff4a8', 3);
    rr(g, 16, 38, 44, 50, 6); fillStroke(g, '#c93a24');
    rr(g, 12, 30, 52, 10, 3); fillStroke(g, '#2f2f3a', 4);
    rr(g, 24, 48, 22, 20, 4); fillStroke(g, '#bfeaff', 3.5);
    for (const x of [34, 66, 98]) {
      g.beginPath(); g.arc(x, 98, 13, 0, TAU); fillStroke(g, '#ffd23f', 4.5);
      g.strokeStyle = INK; g.lineWidth = 3;
      const a = f * 0.78;
      g.beginPath(); g.moveTo(x + Math.cos(a) * 9, 98 + Math.sin(a) * 9); g.lineTo(x - Math.cos(a) * 9, 98 - Math.sin(a) * 9);
      g.moveTo(x + Math.cos(a + 1.57) * 9, 98 + Math.sin(a + 1.57) * 9); g.lineTo(x - Math.cos(a + 1.57) * 9, 98 - Math.sin(a + 1.57) * 9); g.stroke();
    }
  },
  ufo(g, f) {
    poly(g, [46, 82, 82, 82, 102, 124, 26, 124]);
    g.fillStyle = f ? 'rgba(170,255,230,0.38)' : 'rgba(170,255,230,0.24)'; g.fill();
    g.beginPath(); g.arc(64, 62, 26, Math.PI, 0); g.closePath(); fillStroke(g, 'rgba(190,240,255,0.9)', 4);
    g.beginPath(); g.arc(64, 54, 11, 0, TAU); fillStroke(g, '#7ee36d', 3.5);
    g.fillStyle = INK; g.beginPath(); g.ellipse(60, 53, 2.2, 3.4, 0.2, 0, TAU); g.ellipse(68, 53, 2.2, 3.4, -0.2, 0, TAU); g.fill();
    g.strokeStyle = INK; g.lineWidth = 2.5; g.beginPath(); g.moveTo(60, 44); g.lineTo(57, 36); g.moveTo(68, 44); g.lineTo(71, 36); g.stroke();
    g.fillStyle = '#ffd23f'; g.beginPath(); g.arc(57, 35, 2.6, 0, TAU); g.arc(71, 35, 2.6, 0, TAU); g.fill();
    g.beginPath(); g.ellipse(64, 70, 54, 18, 0, 0, TAU); fillStroke(g, grad(g, 52, 88, '#d6deee', '#8793b3'));
    g.fillStyle = 'rgba(255,255,255,0.45)'; g.beginPath(); g.ellipse(46, 63, 14, 3.5, -0.2, 0, TAU); g.fill();
    const cols = ['#ff5a8a', '#ffd23f', '#6bf0a0', '#6bb4ff', '#c45cff'];
    for (let i = 0; i < 5; i++) {
      g.fillStyle = cols[(i + f) % 5]; g.strokeStyle = INK; g.lineWidth = 2;
      g.beginPath(); g.arc(24 + i * 20, 76 - (i === 0 || i === 4 ? 4 : i === 2 ? -2 : 1), 4.4, 0, TAU); g.fill(); g.stroke();
    }
    g.beginPath(); g.ellipse(64, 86, 20, 6, 0, 0, TAU); g.fillStyle = '#6a7596'; g.fill();
  },
};

export const COMPANION_FX = Object.keys(ART);

/** Stand-in for an image-sheet pet until its file loads (or when it is missing): a coloured blob, 128 px per frame. */
function blob(g, f, col) {
  const sq = f % 2 ? 1.06 : 0.97;
  g.beginPath(); g.ellipse(64, 76 + (f % 2 ? 0 : 3), 40 * sq, 34 / sq, 0, 0, TAU); fillStroke(g, grad(g, 40, 112, col, col), 5);
  g.fillStyle = 'rgba(255,255,255,0.35)'; g.beginPath(); g.ellipse(48, 58, 12, 5, -0.4, 0, TAU); g.fill();
  g.fillStyle = INK;
  g.beginPath(); g.ellipse(52, 72, 3.6, 5, 0, 0, TAU); g.ellipse(76, 72, 3.6, 5, 0, 0, TAU); g.fill();
}

/** Sprite sheet of companion `fx`: frames side by side (128 px each; procedural pets 2 frames, image pets their placeholder). */
export function companionSheet(fx) {
  const frames = petFrames(fx), c = makeCanvas(128 * frames, 128), g = c.getContext('2d');
  const draw = ART[fx] || (PET_ART[fx] && ((gg, f) => blob(gg, f, PET_ART[fx].col)));
  if (!draw) return c;
  for (let f = 0; f < frames; f++) { g.save(); g.translate(f * 128, 0); draw(g, f); g.restore(); }
  return c;
}

/** Companion preview: the sprite bobbing on the stage (image pets draw their real sheet once it has loaded). */
export function drawCompanionPreview(g, sheet, fx, t, w, h) {
  drawStage(g, w, h);
  const art = PET_ART[fx], frames = petFrames(fx), src = (art && artReady(petSheetUrl(fx))) || sheet;
  if (!src) return;
  const fw = (src.naturalWidth || src.width) / frames, fh = src.naturalHeight || src.height;
  const bob = Math.sin(t * 3) * 2.5, f = Math.floor(t * (art ? art.prev : 4)) % frames;
  g.drawImage(src, f * fw, 0, fw, fh, 3, 10 + bob, w - 6, w - 6);
}

/* ---------- hat preview ---------- */

const RUN1 = 'assets/hero/run_01.webp';
const HEAD = { x: 257, y: 82 };                  // run_01: hair crown (= HAT_ANCHOR.run1 in px, hats.js) between the ears
const WIN = { x: 130, w: 252, up: 118, down: 197 };   // window on the frame: 118 px of empty space above the head, 197 px of body below

/** A hat on the hero's head: the real run_01 frame (shown, never changed) with the hat sprite drawn over it, as in the run. */
export function drawHatPreview(g, fx, t, w, h) {
  drawStage(g, w, h);
  const hero = artReady(RUN1), k = w / WIN.w, art = HAT_ART[fx];
  if (!hero) return;
  const top = WIN.up * k;
  g.drawImage(hero, WIN.x, 0, WIN.w, WIN.down, 0, top, w, WIN.down * k);
  const img = art && artReady(hatSheetUrl(fx));
  if (!img) return;
  const px = art.size / (2.45 / 640) * k, fw = img.naturalWidth / art.frames;   // quad side in preview px
  const f = hatFrame(fx, t);
  const x = (HEAD.x - WIN.x) * k - px / 2, y = top + HEAD.y * k - px * (1 - ART_BASE) - art.lift / (2.45 / 640) * k + (art.pulse && !FXP.calm ? Math.sin(t * 2) * 0.6 : 0);
  g.save();
  if (art.pulse) g.globalAlpha = FXP.calm ? 1 - art.pulse * 0.65 : 1 - art.pulse * 1.25 + art.pulse * 1.25 * Math.sin(t * 2.4);
  g.drawImage(img, f * fw, 0, fw, img.naturalHeight, x, y, px, px);
  g.restore();
}

/* ---------- particle / decal textures ---------- */

// Words the text trails draw (cosmetic-art stays closed over this list: no player text ever reaches a canvas)
export const TRAIL_TEXT = { danmaku: ['笑死', 'ㄏㄏ', '好扯', '+1', '神'], merit: '功德 +1' };
const TEXT_OK = new Set([...TRAIL_TEXT.danmaku, TRAIL_TEXT.merit]);
const TEXT_GOLD = TRAIL_TEXT.merit;

function heartPath(g, cx, cy, s) {
  g.beginPath();
  g.moveTo(cx, cy + s * 0.9);
  g.bezierCurveTo(cx - s * 1.5, cy - s * 0.1, cx - s * 0.9, cy - s * 1.1, cx, cy - s * 0.35);
  g.bezierCurveTo(cx + s * 0.9, cy - s * 1.1, cx + s * 1.5, cy - s * 0.1, cx, cy + s * 0.9);
  g.closePath();
}

/**
 * Particle textures: 'coin' | 'bone' | 'paw' | 'heart' | 'fheart' | 'zzz' | 'ribbon' | 'confetti' (64 px, square) and
 * 'ring' | 'text:<word of TRAIL_TEXT>' (128 px, square). zzz / ribbon / confetti are drawn white where the particle
 * colour (fx.js) tints them; hearts, text and ring keep their own colours. Anything else: a blank canvas.
 */
export function spriteCanvas(name) {
  const S = name === 'ring' || name.startsWith('text:') ? 128 : 64, c = makeCanvas(S, S), g = c.getContext('2d');
  g.lineCap = 'round'; g.lineJoin = 'round';
  if (name === 'heart' || name === 'fheart') {
    // pink hearts in their own colours (fx.js emits them untinted); the finger heart is a smaller one held by a crossed thumb and finger
    const fh = name === 'fheart';
    heartPath(g, 32, fh ? 24 : 30, fh ? 17 : 21);
    g.fillStyle = grad(g, 10, 50, '#ff8ab4', '#ff4f86'); g.fill(); g.strokeStyle = INK; g.lineWidth = 4; g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.8)'; g.beginPath(); g.ellipse(22, fh ? 17 : 21, 4.5, 2.6, -0.7, 0, TAU); g.fill();
    if (fh) {
      for (const k of [-1, 1]) {      // thumb and index finger crossing under the heart
        g.save(); g.translate(32, 50); g.rotate(k * 0.62);
        rr(g, -5, -13, 10, 26, 5); fillStroke(g, '#ffd9b8', 3.5);
        g.restore();
      }
    }
  } else if (name === 'zzz') {
    poly(g, [14, 14, 50, 14, 50, 22, 28, 46, 52, 46, 52, 54, 12, 54, 12, 46, 34, 22, 14, 22]);
    g.fillStyle = '#fff'; g.fill(); g.strokeStyle = INK; g.lineWidth = 4; g.stroke();
    g.fillStyle = 'rgba(190,190,215,0.5)'; g.fillRect(16, 16, 32, 3);
  } else if (name === 'ribbon') {
    const strip = () => { g.beginPath(); g.moveTo(8, 50); g.bezierCurveTo(20, 4, 30, 60, 40, 24); g.bezierCurveTo(44, 10, 52, 12, 56, 14); };
    g.strokeStyle = 'rgba(70,60,90,0.85)'; g.lineWidth = 12; strip(); g.stroke();
    g.strokeStyle = '#fff'; g.lineWidth = 8; strip(); g.stroke();
    g.strokeStyle = 'rgba(170,170,200,0.7)'; g.lineWidth = 2; g.beginPath(); g.moveTo(12, 40); g.bezierCurveTo(20, 18, 26, 44, 34, 30); g.stroke();
  } else if (name === 'confetti') {
    rr(g, 14, 18, 36, 28, 5); g.fillStyle = '#fff'; g.fill(); g.strokeStyle = 'rgba(70,60,90,0.85)'; g.lineWidth = 4; g.stroke();
    g.fillStyle = 'rgba(170,170,200,0.6)'; g.fillRect(18, 34, 28, 8);
  } else if (name === 'ring') {
    g.strokeStyle = INK; g.lineWidth = 14; g.beginPath(); g.ellipse(64, 64, 40, 40, 0, 0, TAU); g.stroke();
    g.strokeStyle = '#ffd23f'; g.lineWidth = 8; g.beginPath(); g.ellipse(64, 64, 40, 40, 0, 0, TAU); g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.8)'; g.lineWidth = 3; g.beginPath(); g.arc(64, 64, 40, Math.PI * 1.1, Math.PI * 1.45); g.stroke();
  } else if (name.startsWith('text:')) {
    const word = name.slice(5);
    if (!TEXT_OK.has(word)) return c;
    let px = 62;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `900 ${px}px "Noto Sans TC", "Microsoft JhengHei", "PingFang TC", sans-serif`;
    px = Math.min(px, Math.floor(px * 112 / Math.max(1, g.measureText(word).width)));
    g.font = `900 ${px}px "Noto Sans TC", "Microsoft JhengHei", "PingFang TC", sans-serif`;
    g.lineWidth = Math.max(5, px * 0.16); g.strokeStyle = INK; g.strokeText(word, 64, 66);
    g.fillStyle = word === TEXT_GOLD ? '#ffd23f' : '#fff'; g.fillText(word, 64, 66);
  } else if (name === 'coin') {
    const k = g.createRadialGradient(26, 24, 3, 32, 32, 28);
    k.addColorStop(0, '#fff3a8'); k.addColorStop(0.6, '#ffc926'); k.addColorStop(1, '#e08a10');
    g.beginPath(); g.arc(32, 32, 27, 0, TAU); g.fillStyle = k; g.fill();
    g.strokeStyle = INK; g.lineWidth = 4; g.stroke();
    g.strokeStyle = 'rgba(176,96,8,0.8)'; g.lineWidth = 3; g.beginPath(); g.arc(32, 32, 17, 0, TAU); g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.8)'; g.lineWidth = 3.5; g.beginPath(); g.arc(32, 32, 21, Math.PI * 1.1, Math.PI * 1.45); g.stroke();
  } else if (name === 'bone') {
    const spine = () => {
      g.beginPath(); g.moveTo(14, 32); g.lineTo(50, 32);
      for (const x of [24, 32, 40]) { g.moveTo(x, 32); g.lineTo(x - 5, 21); g.moveTo(x, 32); g.lineTo(x - 5, 43); }
      g.moveTo(50, 32); g.lineTo(60, 22); g.moveTo(50, 32); g.lineTo(60, 42);
    };
    g.strokeStyle = INK; g.lineWidth = 8; spine(); g.stroke();
    g.beginPath(); g.arc(10, 32, 8, 0, TAU); g.fillStyle = INK; g.fill();
    g.strokeStyle = '#fff7e0'; g.lineWidth = 3.6; spine(); g.stroke();
    g.beginPath(); g.arc(10, 32, 6, 0, TAU); g.fillStyle = '#fff7e0'; g.fill();
    g.fillStyle = INK; g.beginPath(); g.arc(9, 30, 1.8, 0, TAU); g.fill();
  } else if (name === 'paw') {
    g.fillStyle = 'rgba(70,38,20,1)';
    g.beginPath(); g.ellipse(32, 41, 13, 11, 0, 0, TAU); g.fill();
    for (const [x, y, rx, ry] of [[14, 27, 5.5, 7.5], [25, 17, 5.5, 8], [39, 17, 5.5, 8], [50, 27, 5.5, 7.5]]) { g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, TAU); g.fill(); }
  }
  return c;
}

/** Gift-box icon of the 驚喜箱 (a 64x64 canvas). */
export function boxIcon() {
  const c = makeCanvas(64, 64), g = c.getContext('2d');
  rr(g, 8, 26, 48, 32, 5); fillStroke(g, grad(g, 26, 58, '#c7b2ff', '#8d66ff'), 4);
  rr(g, 5, 16, 54, 14, 5); fillStroke(g, '#ffd23f', 4);
  g.fillStyle = '#ff5a8a'; g.fillRect(28, 17, 8, 40);
  g.strokeStyle = INK; g.lineWidth = 3; g.strokeRect(28, 17, 8, 40);
  g.beginPath(); g.moveTo(32, 16); g.quadraticCurveTo(14, -2, 20, 12); g.moveTo(32, 16); g.quadraticCurveTo(50, -2, 44, 12); g.stroke();
  return c;
}
