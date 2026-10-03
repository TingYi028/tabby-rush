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
