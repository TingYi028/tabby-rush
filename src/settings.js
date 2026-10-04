import { store } from './audio.js';

/**
 * Player settings, saved in localStorage `tabbyrush.settings`:
 *   fx: 'low' | 'normal' | 'high'  effects intensity (screen flashes, particles, glow, bloom, speed lines)
 *   calm: true | false | null     reduce flashing (null = follow the OS "reduce motion" setting)
 *   shake: boolean                camera shake
 *   music, sfx: 0..1              volumes
 *   haptics: boolean              vibration on phones that support it
 *   name: string                  leaderboard name ('' = not chosen yet)
 * `FXP` holds the live effect parameters derived from fx + calm; listeners run after every change.
 */
const reduceMQ = matchMedia('(prefers-reduced-motion: reduce)');
const DEFAULTS = { fx: 'normal', calm: null, shake: true, music: 0.8, sfx: 0.9, haptics: true, name: '' };

// flash: screen-flash multiplier, cap: largest flash; particles: spawn-count multiplier; glow: HDR multiplier of
// additive sparkles (what bloom turns into glare); bloom: bloom-strength multiplier; streak/streakRate: speed-line
// strength and how many times a second their pattern changes; pulse: depth of the red train-warning pulse.
const LEVELS = {
  low: { flash: 0.3, cap: 0.2, particles: 0.45, glow: 0.6, bloom: 0.45, bloomBias: 0.12, streak: 0.08, streakRate: 4, pulse: 0.45 },
  normal: { flash: 0.55, cap: 0.32, particles: 0.7, glow: 0.78, bloom: 0.65, bloomBias: 0.06, streak: 0.16, streakRate: 6, pulse: 0.75 },
  high: { flash: 1, cap: 0.6, particles: 1, glow: 1, bloom: 1, bloomBias: 0, streak: 0.4, streakRate: 12, pulse: 1 },
};

export const FXP = { ...LEVELS.normal, calm: false, shake: 1, level: 'normal' };
const listeners = new Set();

function clean(s) {
  const o = { ...DEFAULTS, ...(s && typeof s === 'object' ? s : {}) };
  if (!LEVELS[o.fx]) o.fx = DEFAULTS.fx;
  if (o.calm !== null) o.calm = !!o.calm;
  o.shake = o.shake !== false;
  o.haptics = o.haptics !== false;
  for (const k of ['music', 'sfx']) o[k] = Number.isFinite(+o[k]) ? Math.min(1, Math.max(0, +o[k])) : DEFAULTS[k];
  o.name = cleanName(o.name);
  return o;
}

// control characters, zero-width and bidi-override characters, and angle brackets (built from code points)
const BS = String.fromCharCode(92);
const hex = (c) => BS + 'u' + c.toString(16).padStart(4, '0');
const BAD_CHARS = new RegExp('[' + [[0x00, 0x1f], [0x7f, 0x9f], [0xad, 0xad], [0x34f, 0x34f], [0x115f, 0x1160], [0x180e, 0x180e],
  [0x200b, 0x200f], [0x2028, 0x202e], [0x2060, 0x2064], [0x2066, 0x2069], [0x3164, 0x3164], [0xfeff, 0xfeff], [0xffa0, 0xffa0]]
  .map(([a, b]) => hex(a) + '-' + hex(b)).join('') + '<>]', 'g');

// abusive phrases; a hit falls back to the default name. Chinese: anywhere (spaces / punctuation ignored);
// English: whole words only (so Grape, Fukuoka or Scunthorpe stay usable), after undoing l33t digits and dotted letters
const BLOCK_ZH = ['幹你', '幹妳', '幹您', '操你', '操妳', '肏', '他媽的', '你媽', '你妈', '靠北', '靠杯', '雞掰', '機掰', '鸡巴',
  '雞巴', '屌你', '婊子', '賤人', '贱人', '去死', '強姦', '强奸', '性交', '傻逼', '煞筆', '腦殘', '智障'];
const BLOCK_EN = new RegExp(BS + 'b(fuck\\w*|fuk|shit\\w*|bitch\\w*|cunt|nigg\\w*|fag|faggot|whore|slut|rape|porn|nazi|hitler)' + BS + 'b');

/** Leaderboard names: printable characters only, collapsed spaces, at most 12 characters, no abuse. */
export function cleanName(n) {
  const out = [...String(n ?? '').replace(BAD_CHARS, '').replace(/\s+/g, ' ').trim()].slice(0, 12).join('');
  const low = out.toLowerCase().replace(/0/g, 'o').replace(/[1!]/g, 'i').replace(/3/g, 'e').replace(/[$5]/g, 's').replace(/@/g, 'a');
  const words = low.replace(/([a-z])[._*~-](?=[a-z])/g, '$1');        // f.u.c.k -> fuck (no look-behind: old Safari)
  const flat = low.replace(/[\s._\-*~!@#$%^&()+=|/\\'"`,:;?]+/g, '');
  return BLOCK_ZH.some((w) => flat.includes(w)) || BLOCK_EN.test(words) ? '' : out;
}

let S = clean(store.get('settings', null));

function derive() {
  const L = LEVELS[S.fx];
  const calm = S.calm === null ? reduceMQ.matches : S.calm;
  Object.assign(FXP, L, { calm, level: S.fx, shake: S.shake ? (reduceMQ.matches ? 0.3 : 1) : 0 });
  if (calm) {
    // no strobing: soft single flashes only, static speed lines off, no pulsing warning, calmer sparkles
    Object.assign(FXP, { flash: Math.min(L.flash, 0.25), cap: 0.12, particles: Math.min(L.particles, 0.6),
      glow: Math.min(L.glow, 0.7), bloom: Math.min(L.bloom, 0.6), bloomBias: Math.max(L.bloomBias, 0.1), streak: 0, pulse: 0 });
  }
  document.body.classList.toggle('fx-calm', calm);
  document.body.dataset.fx = S.fx;
}

export const settings = {
  get(k) { return S[k]; },
  /** The effective reduce-flashing state (resolves the "follow the OS" default). */
  calm() { return FXP.calm; },
  set(k, v) {
    S = clean({ ...S, [k]: v });
    store.set('settings', S);
    derive();
    for (const f of listeners) f(k, S[k]);
  },
  onChange(f) { listeners.add(f); return () => listeners.delete(f); },
};

reduceMQ.addEventListener?.('change', () => { derive(); for (const f of listeners) f('calm', S.calm); });
derive();

/** A short vibration on phones that support it (Android); silently nothing elsewhere. */
export function vibrate(pattern) {
  if (!S.haptics || typeof navigator === 'undefined' || !navigator.vibrate) return;
  if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return; // browsers refuse before a tap
  try { navigator.vibrate(pattern); } catch { /* not allowed */ }
}
export const canVibrate = () => typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function'
  && matchMedia('(pointer: coarse)').matches;
