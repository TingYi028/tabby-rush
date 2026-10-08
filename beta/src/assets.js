import * as THREE from 'three';

const manifest = {};
for (let i = 1; i <= 8; i++) manifest[`run${i}`] = `assets/hero/run_0${i}.webp`;
for (const n of ['jump_01', 'jump_02', 'jump_03', 'roll_01', 'roll_02', 'lean', 'crash', 'portrait']) {
  manifest[n] = `assets/hero/${n}.webp`;
}
for (const n of ['logo', 'icon_coin', 'icon_magnet', 'icon_sneakers', 'icon_x2', 'icon_shield', 'icon_jetpack', 'icon_rush']) {
  manifest[n] = `assets/ui/${n}.webp`;
}
for (let i = 1; i <= 6; i++) manifest[`graffiti${i}`] = `assets/decals/graffiti_0${i}.webp`;
for (const n of ['skyline_tile', 'facade_01', 'facade_02', 'facade_03', 'facade_04']) {
  manifest[n] = `assets/env/${n}.webp`;
}

/** Loaded HTMLImageElements by key; a missing file leaves `null` so callers can fall back. */
export const images = {};

export function loadImages(onProgress) {
  const keys = Object.keys(manifest);
  let done = 0;
  const tick = () => onProgress(++done / keys.length);
  return Promise.all(keys.map((k) => new Promise((resolve) => {
    const img = new Image();
    img.onload = () => { images[k] = img; tick(); resolve(); };
    img.onerror = () => { images[k] = null; tick(); resolve(); };
    img.src = manifest[k];
  })));
}

/** Images of a place's art set, assets/zones/<set>/<name>.webp (specs/zone_pack.md); props, decals and skin may be absent. */
export const SET_FILES = ['facade_1', 'facade_2', 'facade_3', 'skyline', 'props', 'decals', 'skin'];
const SET_TIMEOUT = 15000;

/**
 * Lazily fetch and decode the art set `set` (never part of the boot manifest). Resolves `{ <file>: HTMLImageElement | null }`
 * for every name in SET_FILES plus `atlas` (the parsed assets/zones/<set>/atlas.json: pixel rects and heights of the props and
 * decals; unchecked, zoneload.js parseAtlas validates it): a file that is missing, fails or takes longer than SET_TIMEOUT is
 * `null`, never a rejection. Images are decoded here, so the later texture upload does not decode on the main thread.
 */
export function loadSet(set) {
  const bad = !/^[a-z0-9_]{1,24}$/.test(set);
  const atlas = new Promise((resolve) => {
    if (bad) { resolve(null); return; }
    const timer = setTimeout(() => resolve(null), SET_TIMEOUT);
    Promise.resolve().then(() => fetch(`assets/zones/${set}/atlas.json`)).then((r) => (r.ok ? r.json() : null)).catch(() => null)
      .then((j) => { clearTimeout(timer); resolve(j); });
  });
  return Promise.all([...SET_FILES.map((f) => new Promise((resolve) => {
    if (bad) { resolve(null); return; }
    const img = new Image();
    const timer = setTimeout(() => { img.onload = img.onerror = null; resolve(null); }, SET_TIMEOUT);
    const done = (v) => { clearTimeout(timer); resolve(v); };
    img.onload = () => (img.decode ? img.decode().then(() => done(img), () => done(img)) : done(img));
    img.onerror = () => done(null);
    img.src = `assets/zones/${set}/${f}.webp`;
  })), atlas]).then((got) => Object.fromEntries([...SET_FILES, 'atlas'].map((f, i) => [f, got[i]])));
}

let maxAniso = 4;
export const setAniso = (n) => { maxAniso = n; };

/** Wrap an image or canvas in an sRGB texture. */
export function makeTexture(src, { repeat = false } = {}) {
  const t = src instanceof HTMLCanvasElement ? new THREE.CanvasTexture(src) : new THREE.Texture(src);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = maxAniso;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.needsUpdate = true;
  return t;
}
