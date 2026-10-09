import { FXP } from './settings.js';
import { loadArt, hatSheetUrl, hatFrame, HAT_ART, ART_BASE } from './cosmetic-art.js';

/*
 * Hats (頭飾, cosmetics.js kind 'hat'): one small billboard sprite drawn over the hero's head. The hero frames are never
 * touched: the sprite is a separate object that follows the head of whichever frame player.js shows. It has no collision,
 * does not alter the hit box, is hidden on the crash frame and while the jetpack is lit, and is hidden until its image
 * (assets/hats/hat_<fx>.webp, loaded when the hat is equipped, never at boot) has arrived or when the file is missing.
 *
 * player.js is not edited: the frame on show is read from `player.material.map` (matched against `player.frames`), the
 * position from `player.mesh` (position, scale = the squash spring and the lean mirror, rotation.z = the lane tilt).
 * three.js is imported when the sprite is mounted (not at load), so the node tests can import this module without it.
 */

/**
 * Head-top point of every hero frame, measured from the frame images (assets/hero/*.webp; script and debug picture in
 * assets/hats/_work/): the middle of the hair crown between the cat ears, 4 % of the hair width inside the hair.
 *  x, y: metres from the mesh origin (the feet) at scale 1, for the frame as drawn (the lean frame is mirrored by player.js
 *        when the hero leans left: hatPose(key, true) mirrors x); y up. 1 frame pixel = 2.45 / 640 m, feet at pixel row 612.
 *  s:    head size relative to the run frames (hair width / 126 px, 0.55 .. 1): the hat is scaled by it.
 *  r:    tilt of the head in radians (counter-clockwise positive; only the lean frame tilts noticeably).
 */
export const HAT_ANCHOR = {
  run1: { x: 0.004, y: 2.029, s: 1.0, r: 0 },
  run2: { x: -0.008, y: 1.952, s: 0.99, r: 0 },
  run3: { x: 0.01, y: 2.013, s: 1.0, r: 0 },
  run4: { x: 0.011, y: 2.09, s: 1.0, r: 0 },
  run5: { x: -0.008, y: 2.029, s: 1.0, r: 0 },
  run6: { x: 0.004, y: 1.952, s: 0.98, r: 0 },
  run7: { x: -0.013, y: 2.013, s: 1.0, r: 0 },
  run8: { x: -0.014, y: 2.09, s: 1.0, r: 0 },
  jump_01: { x: -0.002, y: 1.902, s: 0.83, r: 0 },
  jump_02: { x: 0.002, y: 1.31, s: 0.78, r: 0 },
  jump_03: { x: -0.006, y: 1.922, s: 0.79, r: 0 },
  roll_01: { x: -0.003, y: 0.862, s: 0.55, r: 0 },
  roll_02: { x: -0.003, y: 0.842, s: 0.55, r: 0 },
  lean: { x: 0.084, y: 1.964, s: 0.77, r: -0.3 },
  crash: { x: -0.007, y: 1.276, s: 0.73, r: 0 },
};
export const HAT_FRAMES = Object.keys(HAT_ANCHOR);

const FALLBACK = HAT_ANCHOR.run1;

/** Anchor of frame `key` into `out` ({ x, y, s, r }); `mirror` = the hero sprite is flipped (leaning left). Allocation-free. */
function poseInto(out, key, mirror) {
  const a = HAT_ANCHOR[key] || FALLBACK;
  out.x = mirror ? -a.x : a.x;
  out.y = a.y;
  out.s = a.s;
  out.r = mirror ? -a.r : a.r;
  return out;
}

/** Pure: the head anchor of frame `key` as a new { x, y, s, r } (unknown keys give the first run frame's). */
export const hatPose = (key, mirror = false) => poseInto({ x: 0, y: 0, s: 1, r: 0 }, key, !!mirror);

/** Pure: should the hat be on screen for this player? Hidden on the crash frame, while the jetpack is lit, when the hero is hidden. */
export const hatShown = (p) => !!(p && p.mesh && p.mesh.visible && !p.crashed && !(p.jetpack && p.jetpack.visible));

/** Pure: frame texture -> anchor key for a Player's `frames` ({ run[8], jump[3], roll[2], lean, crash }). */
export function frameKeys(frames) {
  const m = new Map();
  frames.run.forEach((t, i) => m.set(t, `run${i + 1}`));
  frames.jump.forEach((t, i) => m.set(t, `jump_0${i + 1}`));
  frames.roll.forEach((t, i) => m.set(t, `roll_0${i + 1}`));
  m.set(frames.lean, 'lean');
  m.set(frames.crash, 'crash');
  return m;
}

/* ---------- the sprite ---------- */

const S = {
  THREE: null, makeTexture: null, scene: null, player: null, keyOf: null,
  sprite: null, mat: null, tex: null,
  fx: '', art: null, img: null,        // wanted hat, its HAT_ART entry once its image is in `img`
  mounting: false,
  a: { x: 0, y: 0, s: 1, r: 0 }, b: { x: 0, y: 0, s: 1, r: 0 },
  frame: -1, t: 0,
};

/** Create the (hidden) sprite and put it in the scene. Call once with the scene and the Player; a hat set earlier shows up when ready. */
export async function mount(scene, player) {
  if (S.sprite || S.mounting || !scene || !player) return;
  S.mounting = true;
  try {
    const [THREE, assets] = await Promise.all([import('three'), import('./assets.js')]);
    S.THREE = THREE; S.makeTexture = assets.makeTexture;
    S.scene = scene; S.player = player; S.keyOf = frameKeys(player.frames);
    S.mat = new THREE.SpriteMaterial({ transparent: true, depthWrite: false });
    S.sprite = new THREE.Sprite(S.mat);
    S.sprite.center.set(0.5, ART_BASE);
    S.sprite.renderOrder = 5;       // hero 4, jetpack 5, bubble 6
    S.sprite.frustumCulled = false;
    S.sprite.visible = false;
    scene.add(S.sprite);
    apply();
  } catch { S.sprite = null; }       // no three / no assets (a broken environment): no hat, the game goes on
  S.mounting = false;
}

/** Wear hat `fx` (catalog fx such as 'party'; '' = none). The image loads now; until it is there nothing is drawn. */
export function set(fx) {
  S.fx = HAT_ART[fx] ? fx : '';
  S.img = null; S.art = null; S.frame = -1; S.t = 0;
  if (S.sprite) S.sprite.visible = false;
  if (S.tex) { S.tex.dispose(); S.tex = null; }
  if (!S.fx) return;
  const want = S.fx;
  loadArt(hatSheetUrl(want)).then((img) => {
    if (!img || S.fx !== want) return;
    S.img = img;
    apply();
  });
}

/** Both the sprite and the image exist: build the texture and start drawing. */
function apply() {
  if (!S.sprite || !S.img || !S.fx || S.tex) return;
  const art = HAT_ART[S.fx], tex = S.makeTexture(S.img);
  tex.repeat.set(1 / art.frames, 1);
  tex.generateMipmaps = false;         // 2-frame hats (chick, propeller) sit side by side: no mip bleeding
  tex.minFilter = S.THREE.LinearFilter;
  S.tex = tex;
  S.mat.map = tex;
  S.mat.needsUpdate = true;
  S.art = art;
  S.frame = -1;
}

/** Per frame after the player has updated (cosmetics.update). Allocation-free. */
export function update(dt, p) {
  const sp = S.sprite, art = S.art;
  if (!sp) return;
  if (!art || !hatShown(p)) { sp.visible = false; return; }
  S.t += dt;
  const m = p.mesh, a = poseInto(S.a, S.keyOf.get(p.material.map), m.scale.x < 0);
  const bu = p.blendU;
  if (bu && bu.blend.value > 0.001) {          // run frames cross-fade: the head follows
    const b = poseInto(S.b, S.keyOf.get(bu.map2.value), m.scale.x < 0), k = bu.blend.value;
    a.x += (b.x - a.x) * k; a.y += (b.y - a.y) * k; a.s += (b.s - a.s) * k; a.r += (b.r - a.r) * k;
  }
  const sx = Math.abs(m.scale.x), sy = m.scale.y, rz = m.rotation.z, c = Math.cos(rz), s = Math.sin(rz);
  const lift = art.lift + (art.pulse && !FXP.calm ? Math.sin(S.t * 2) * 0.02 : 0);
  const ox = a.x * sx, oy = (a.y + lift * a.s) * sy;
  sp.position.set(m.position.x + ox * c - oy * s, m.position.y + ox * s + oy * c, 0.06);
  const size = art.size * a.s * (sx + sy) * 0.5;
  sp.scale.set(size, size, 1);
  S.mat.rotation = a.r + rz;
  // gentle halo / lantern pulse (never a strobe; static with 減少閃爍); the chick blinks for a moment every ~3 s, the propeller spins
  S.mat.opacity = art.pulse && !FXP.calm ? 1 - art.pulse + art.pulse * Math.sin(S.t * 2.4) : 1;
  if (art.frames > 1) {
    const f = hatFrame(S.fx, S.t);
    if (f !== S.frame) { S.frame = f; S.tex.offset.x = f / art.frames; }
  }
  sp.visible = true;
}

/** The sprite and its state, for tests and QA (null before mount). */
export const debugState = () => ({ sprite: S.sprite, fx: S.fx, ready: !!S.art, texture: S.tex });
