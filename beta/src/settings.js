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

// control characters, zero-width / bidi / filler / tag characters, variation selectors, the Braille blank and angle brackets
// (built from code points, so the source holds no invisible characters)
const BS = String.fromCharCode(92);
const hex = (c) => BS + 'u{' + c.toString(16) + '}';
const BAD_CHARS = new RegExp('[' + [[0x00, 0x1f], [0x7f, 0x9f], [0xad], [0x34f], [0x61c], [0x115f, 0x1160], [0x17b4, 0x17b5], [0x180b, 0x180e],
  [0x200b, 0x200f], [0x2028, 0x202e], [0x2060, 0x206f], [0x2800], [0x3164], [0xfe00, 0xfe0f], [0xfeff], [0xffa0], [0xfff9, 0xfffb],
  [0xe0000, 0xe007f], [0xe0100, 0xe01ef]]
  .map(([a, b]) => hex(a) + (b == null ? '' : '-' + hex(b))).join('') + '<>]', 'gu');
const LONE = /[\ud800-\udfff]/gu;           // with the u flag: only unpaired surrogates match (a pair is one code point)
const MARKS = /(\p{M}{2})\p{M}+/gu;         // at most 2 combining marks in a row

// look-alike letters -> the ASCII letter they imitate (Cyrillic, Greek, small capitals, dotless i: the table of tools/wishes.mjs)
const LOOKALIKE = {
  a: [0x430, 0x410, 0x3b1, 0x391, 0x1d00], b: [0x412, 0x392, 0x299], c: [0x441, 0x421, 0x3f2, 0x3f9, 0x1d04], d: [0x501, 0x1d05],
  e: [0x435, 0x415, 0x3b5, 0x395, 0x1d07], g: [0x261, 0x262], h: [0x4bb, 0x43d, 0x41d, 0x397, 0x29c], i: [0x456, 0x406, 0x3b9, 0x399, 0x26a, 0x131],
  j: [0x458, 0x408, 0x1d0a, 0x237], k: [0x43a, 0x41a, 0x3ba, 0x39a, 0x1d0b], l: [0x4cf, 0x29f], m: [0x43c, 0x41c, 0x39c, 0x1d0d], n: [0x3b7, 0x39d, 0x274],
  o: [0x43e, 0x41e, 0x3bf, 0x39f, 0x1d0f], p: [0x440, 0x420, 0x3c1, 0x3a1, 0x1d18], q: [0x51b], r: [0x280], s: [0x455, 0x405, 0xa731],
  t: [0x442, 0x422, 0x3c4, 0x3a4, 0x1d1b], u: [0x3c5, 0x1d1c], v: [0x3bd, 0x1d20], w: [0x51d, 0x1d21], x: [0x445, 0x425, 0x3c7, 0x3a7],
  y: [0x443, 0x423, 0x3a5, 0x28f], z: [0x396, 0x1d22],
};
const HOMO = new Map();
for (const [l, cps] of Object.entries(LOOKALIKE)) for (const c of cps) HOMO.set(String.fromCodePoint(c), l);
const LEET = { 0: 'o', 1: 'i', '!': 'i', 3: 'e', 4: 'a', $: 's', 5: 's', 7: 't', '@': 'a' };
// simplified -> Traditional, only the characters of the lists below / of wish.js (so a simplified slur meets the Traditional list)
const SIMP = new Map([...'干妈鸡机贱强奸笔脑残痴爱约炮'].map((c, i) => [c, [...'幹媽雞機賤強姦筆腦殘癡愛約砲'][i]]));

// "f u c k" / "f/u/c/k" -> "fuck": a run of single letters is one word; every other character separates words
function wordsOf(s) {
  const out = [];
  let run = '';
  for (const t of s.match(/[a-z0-9]+/g) || []) {
    if (/^[a-z]$/.test(t)) run += t;
    else { if (run) out.push(run); run = ''; out.push(t); }
  }
  if (run) out.push(run);
  return out.join(' ');
}

/**
 * Text as the abuse lists see it (also used by wish.js): accents, full-width forms, look-alike letters and case folded, digits
 * and symbols that stand for letters undone, simplified Chinese read as Traditional.
 *   flat   letters, digits and CJK only (spaces, punctuation and emoji between characters do not hide a phrase): for the Chinese lists
 *   words  two shapes for the whole-word English list: dots / dashes inside a word joined (f.u.c.k, fu.ck) or not (ur.fuck), and
 *          in both a run of single letters joined (f u c k, f/u/c/k)
 */
export function abuseForms(text) {
  let t = '', flat = '';
  for (const c of String(text ?? '').normalize('NFKD').toLowerCase().replace(/[\u0300-\u036f]/g, '')) {
    const h = HOMO.get(c) ?? c;
    t += h;
    flat += SIMP.get(h) ?? h;
  }
  const leet = t.replace(/[014!357$@]/g, (c) => LEET[c]);
  return {
    flat: flat.replace(/[^a-z0-9\u3400-\u9fff]+/g, ''),
    words: [wordsOf(leet), wordsOf(leet.replace(/([a-z])[._*~|^+-]+(?=[a-z])/g, '$1'))],
  };
}

// abusive phrases; a hit falls back to the default name. Chinese: anywhere (spaces / punctuation ignored, simplified read as Traditional);
// English: whole words only (so Grape, Fukuoka or Scunthorpe stay usable), after undoing l33t digits, accents, look-alike letters and spacing
const BLOCK_ZH = ['幹你', '幹妳', '幹您', '操你', '操妳', '肏', '他媽的', '你媽', '你妈', '靠北', '靠杯', '雞掰', '機掰', '鸡巴',
  '雞巴', '屌你', '婊子', '賤人', '贱人', '去死', '強姦', '强奸', '性交', '傻逼', '煞筆', '腦殘', '智障'];
const BLOCK_EN = new RegExp(BS + 'b(fuck\\w*|fuk|shit\\w*|bitch\\w*|cunt|nigg\\w*|fag|faggot|whore|slut|rape|porn|nazi|hitler)' + BS + 'b');

/** Leaderboard names: printable characters only, collapsed spaces, at most 12 characters (no trailing space), no abuse. */
export function cleanName(n) {
  const s = (typeof n === 'string' ? n : typeof n === 'number' ? String(n) : '').slice(0, 400).replace(LONE, '').replace(BAD_CHARS, '').replace(MARKS, '$1').replace(/\s+/g, ' ');
  const out = [...s.trim()].slice(0, 12).join('').trim();
  const f = abuseForms(out);
  return BLOCK_ZH.some((w) => f.flat.includes(w)) || f.words.some((w) => BLOCK_EN.test(w)) ? '' : out;
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
