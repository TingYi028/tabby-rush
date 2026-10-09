// Per-place soundtrack helpers (pure, no audio context; AudioFX in audio.js plays what they choose) and the procedural
// funk/hip-hop groove (A minor, 112 BPM) that plays when no music file is available.

/*
 * Track keys: 'menu' / 'game' = today's menu.mp3 / bgm.mp3 (music.json); `menu:<place>` / `run:<place>` = the place's lobby /
 * run track from music_places.json. A place without a manifest entry (the lighting-only city places, places still being
 * composed, a bad entry) simply has no key of its own and falls back to 'menu' / 'game', then to the Groove synth.
 */

/** Cross-fade seconds: place -> place in a run, lobby change, lobby -> run handover (out / in), stopping, a fresh start. */
export const FADE = { place: 2.5, lobby: 1.5, out: 1.2, in: 0.8, off: 0.5 };
/** Gain of a track into the music bus; bgm.mp3 standing in for a missing lobby track is quieter. */
export const GAIN = { track: 0.85, lobbyFallback: 0.45 };
/** Seconds to wait for the place's own track with nothing playing before a fallback (or the synth) takes over. */
export const GRACE = 2.5;

const ID_RE = /^[a-z0-9_]{1,32}$/;
const FILE_RE = /^[A-Za-z0-9_-]{1,64}\.mp3$/;
const KEY_RE = /^(run|menu):([a-z0-9_]{1,32})$/;

export const isPlaceId = (id) => typeof id === 'string' && ID_RE.test(id);

function parseEntry(e) {
  if (!e || typeof e !== 'object' || typeof e.file !== 'string' || !FILE_RE.test(e.file)) return null;
  const l = e.loop;
  if (!Array.isArray(l) || l.length !== 2 || !l.every((v) => typeof v === 'number' && Number.isFinite(v))) return null;
  if (l[0] < 0 || l[1] - l[0] < 4 || l[1] > 1200) return null;
  return { file: e.file, bpm: Number.isFinite(e.bpm) ? e.bpm : null, loop: [l[0], l[1]] };
}

/**
 * music_places.json -> { <placeId>: { run?, menu? } } with each entry {file, bpm, loop: [start, end]} (seconds). Anything
 * that is not a well-formed entry (bad id, file name with a path, missing / reversed / absurd loop points) is left out, so
 * that place falls back; a missing or garbage manifest gives an empty one. The result has no prototype.
 */
export function parseManifest(json) {
  const out = Object.create(null);
  const places = json && typeof json === 'object' ? json.places : null;
  if (!places || typeof places !== 'object' || Array.isArray(places)) return out;
  for (const id of Object.keys(places)) {
    if (!ID_RE.test(id) || !places[id] || typeof places[id] !== 'object') continue;
    const run = parseEntry(places[id].run), menu = parseEntry(places[id].menu);
    if (run || menu) out[id] = { ...(run && { run }), ...(menu && { menu }) };
  }
  return out;
}

/** Track keys for a mode ('game' = a run, 'menu' = the lobby) at place `id`, best first; every key has a file to load. */
export function trackChain(manifest, list, mode, id) {
  const e = isPlaceId(id) && manifest ? manifest[id] : null;
  const has = (k) => !!list && typeof list[k] === 'string' && FILE_RE.test(list[k]);
  if (mode === 'game') return [e && e.run ? `run:${id}` : null, has('game') ? 'game' : null].filter(Boolean);
  if (mode === 'menu') return [e && e.menu ? `menu:${id}` : null, has('menu') ? 'menu' : null, has('game') ? 'game' : null].filter(Boolean);
  return [];
}

/** {file, loop} of a track key (loop null = a legacy file that audio.js makes loop seamlessly), or null if unknown. */
export function trackSpec(manifest, list, key) {
  if (key === 'menu' || key === 'game') return list && typeof list[key] === 'string' && FILE_RE.test(list[key]) ? { file: list[key], loop: null } : null;
  const m = KEY_RE.exec(key);
  const e = m && manifest && manifest[m[2]] ? manifest[m[2]][m[1]] : null;
  return e ? { file: e.file, loop: e.loop } : null;
}

/** 'menu' for the lobby tracks (menu.mp3 and the place menus), 'game' for run tracks (bgm.mp3, run:*). */
export const trackKind = (key) => (key === 'menu' || (key || '').startsWith('menu:') ? 'menu' : 'game');

/** [fade-out, fade-in] seconds when the music goes from track `from` (null = nothing / the synth) to track `to`. */
export function fadeTimes(from, to) {
  if (!from) return [0, FADE.in];
  const a = trackKind(from), b = trackKind(to);
  if (a === 'menu' && b === 'game') return [FADE.out, FADE.in];   // 開始衝刺 handover
  if (a === b) return a === 'menu' ? [FADE.lobby, FADE.lobby] : [FADE.place, FADE.place];
  return [FADE.off, FADE.in];                                      // run -> lobby (quit to menu)
}

/** Equal-power fade as [secondsFromStart, gain] points (linear ramps between them): in = peak*sin, out = peak*cos. */
export function fadePoints(dur, peak, dir, steps = 16) {
  const pts = [];
  for (let i = 1; i <= steps; i++) {
    const p = i / steps, a = p * Math.PI / 2;
    pts.push([dur * p, i === steps && dir === 'out' ? 0 : peak * (dir === 'in' ? Math.sin(a) : Math.cos(a))]);
  }
  return pts;
}

/** Schedule an equal-power fade on an AudioParam from time `t`: in from 0 up to `peak`, out from `peak` down to 0. */
export function fadeParam(param, t, dur, peak, dir) {
  param.cancelScheduledValues(t);
  param.setValueAtTime(dir === 'in' ? 0 : peak, t);
  for (const [dt, v] of fadePoints(dur, peak, dir)) param.linearRampToValueAtTime(v, t + dt);
}

/** Keys to drop so that at most `cap` remain, least recently used first, never one in `keep` (a Set). `used`: key -> counter. */
export function lruVictims(held, used, keep, cap) {
  const order = held.filter((k) => !keep.has(k)).sort((a, b) => (used[a] || 0) - (used[b] || 0));
  const out = [];
  for (let n = held.length; n > cap && out.length < order.length; n--) out.push(order[out.length]);
  return out;
}

// Procedural funk/hip-hop groove (A minor, 112 BPM). Used when no music file is present.

const _ = null;
const BASS = [
  [45, _, 57, _, _, 45, _, 48, _, 50, _, 52, 55, _, 52, _],
  [50, _, 62, _, _, 50, _, 53, _, 54, _, 57, 60, _, 57, _],
  [41, _, 53, _, _, 41, _, 45, _, 48, _, 50, 52, _, 48, _],
  [40, _, 52, _, _, 40, _, 44, _, 47, _, 50, 52, _, 51, 50],
];
const CHORDS = [[57, 60, 64, 67], [62, 66, 69, 72], [53, 57, 60, 64], [52, 56, 59, 62]];
const LEAD = [
  [76, _, _, 79, _, 76, _, 74, 72, _, _, _, _, _, _, _],
  [_, _, 74, _, 76, _, _, _, 79, _, 81, _, 79, _, 76, _],
  [77, _, _, 76, _, 72, _, _, 69, _, 72, _, 76, _, _, _],
  [76, _, 75, _, 74, _, 71, _, 68, _, 71, _, 74, _, 76, _],
];
const KICK = [1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0];
const SNARE = [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0.35];
const STAB = [0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0];

const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);

export class Groove {
  constructor(ctx, out) {
    this.ctx = ctx;
    this.bus = ctx.createGain();
    this.bus.gain.value = 0;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 1000;
    this.filter.Q.value = 0.7;
    this.bus.connect(this.filter).connect(out);

    this.delay = ctx.createDelay(1);
    this.delay.delayTime.value = 0.4;
    const fb = ctx.createGain();
    fb.gain.value = 0.32;
    const dl = ctx.createGain();
    dl.gain.value = 0.35;
    this.delay.connect(fb).connect(this.delay);
    this.delay.connect(dl).connect(this.bus);

    const len = ctx.sampleRate;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    this.bpm = 112;
    this.step = 0;
    this.loop = 0;
    this.timer = null;
    this.mode = 'menu';
  }

  start(mode) {
    this.setMode(mode);
    if (this.timer) return;
    this.step = 0;
    this.nextTime = this.ctx.currentTime + 0.06;
    this.timer = setInterval(() => this.schedule(), 25);
  }

  stop(fast = false) {
    const t = this.ctx.currentTime;
    this.bus.gain.cancelScheduledValues(t);
    this.bus.gain.setValueAtTime(this.bus.gain.value, t);
    this.bus.gain.linearRampToValueAtTime(0, t + (fast ? 0.35 : 0.8));
    this.filter.frequency.cancelScheduledValues(t);
    this.filter.frequency.setValueAtTime(this.filter.frequency.value, t);
    this.filter.frequency.exponentialRampToValueAtTime(200, t + 0.6);
    const timer = this.timer;
    this.timer = null;
    setTimeout(() => clearInterval(timer), 900);
  }

  setMode(mode) {
    this.mode = mode;
    const t = this.ctx.currentTime;
    this.bus.gain.cancelScheduledValues(t);
    this.bus.gain.setValueAtTime(this.bus.gain.value, t);
    this.bus.gain.linearRampToValueAtTime(mode === 'game' ? 0.55 : 0.4, t + 0.6);
    this.filter.frequency.cancelScheduledValues(t);
    this.filter.frequency.setValueAtTime(Math.max(200, this.filter.frequency.value), t);
    this.filter.frequency.exponentialRampToValueAtTime(mode === 'game' ? 16000 : 1100, t + 0.8);
  }

  schedule() {
    const sixteenth = 60 / this.bpm / 4;
    while (this.nextTime < this.ctx.currentTime + 0.14) {
      this.playStep(this.step, this.nextTime);
      const swing = this.step % 2 === 0 ? 1.14 : 0.86;
      this.nextTime += sixteenth * swing;
      this.step = (this.step + 1) % 64;
      if (this.step === 0) this.loop++;
    }
  }

  env(node, t, a, peak, d) {
    node.gain.setValueAtTime(0.0001, t);
    node.gain.exponentialRampToValueAtTime(peak, t + a);
    node.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  playStep(i, t) {
    const bar = i >> 4, s = i & 15, game = this.mode === 'game';
    if (KICK[s]) this.kick(t);
    if (SNARE[s]) this.snare(t, SNARE[s]);
    if (s % 2 === 0) this.hat(t, s % 4 === 2 ? 0.16 : 0.1, false);
    else if (game) this.hat(t, 0.05, s === 15);
    const n = BASS[bar][s];
    if (n !== null) this.bass(t, n);
    if (STAB[s] && (game || s === 3)) this.stab(t, CHORDS[bar]);
    if (game && this.loop % 2 === 1) {
      const m = LEAD[bar][s];
      if (m !== null) this.lead(t, m);
    }
  }

  kick(t) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain();
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    this.env(g, t, 0.003, 0.95, 0.3);
    o.connect(g).connect(this.bus);
    o.start(t); o.stop(t + 0.35);
  }

  snare(t, v) {
    const c = this.ctx, src = c.createBufferSource(), hp = c.createBiquadFilter(), g = c.createGain();
    src.buffer = this.noise;
    hp.type = 'highpass'; hp.frequency.value = 1300;
    this.env(g, t, 0.002, 0.42 * v, 0.17);
    src.connect(hp).connect(g).connect(this.bus);
    src.start(t, Math.random() * 0.5); src.stop(t + 0.22);
    const o = c.createOscillator(), og = c.createGain();
    o.type = 'triangle'; o.frequency.value = 190;
    this.env(og, t, 0.002, 0.3 * v, 0.09);
    o.connect(og).connect(this.bus);
    o.start(t); o.stop(t + 0.12);
  }

  hat(t, v, open) {
    const c = this.ctx, src = c.createBufferSource(), hp = c.createBiquadFilter(), g = c.createGain();
    src.buffer = this.noise;
    hp.type = 'highpass'; hp.frequency.value = 7500;
    this.env(g, t, 0.001, v, open ? 0.2 : 0.035);
    src.connect(hp).connect(g).connect(this.bus);
    src.start(t, Math.random() * 0.5); src.stop(t + (open ? 0.25 : 0.06));
  }

  bass(t, m) {
    const c = this.ctx, o = c.createOscillator(), o2 = c.createOscillator(), f = c.createBiquadFilter(), g = c.createGain();
    o.type = 'sawtooth'; o.frequency.value = hz(m);
    o2.type = 'square'; o2.frequency.value = hz(m - 12);
    f.type = 'lowpass'; f.Q.value = 7;
    f.frequency.setValueAtTime(1500, t);
    f.frequency.exponentialRampToValueAtTime(240, t + 0.18);
    this.env(g, t, 0.004, 0.3, 0.22);
    o.connect(f); o2.connect(f); f.connect(g).connect(this.bus);
    o.start(t); o2.start(t); o.stop(t + 0.3); o2.stop(t + 0.3);
  }

  stab(t, notes) {
    const c = this.ctx, f = c.createBiquadFilter(), g = c.createGain();
    f.type = 'lowpass'; f.frequency.value = 2600; f.Q.value = 1;
    this.env(g, t, 0.006, 0.12, 0.2);
    f.connect(g).connect(this.bus);
    for (const m of notes) for (const det of [-8, 8]) {
      const o = c.createOscillator();
      o.type = 'sawtooth'; o.frequency.value = hz(m); o.detune.value = det;
      o.connect(f); o.start(t); o.stop(t + 0.3);
    }
  }

  lead(t, m) {
    const c = this.ctx, o = c.createOscillator(), lfo = c.createOscillator(), lg = c.createGain(), g = c.createGain();
    o.type = 'sine'; o.frequency.value = hz(m);
    lfo.frequency.value = 5.5; lg.gain.value = 7;
    lfo.connect(lg).connect(o.detune);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16, t + 0.025);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
    o.connect(g);
    g.connect(this.bus);
    g.connect(this.delay);
    o.start(t); lfo.start(t); o.stop(t + 0.36); lfo.stop(t + 0.36);
  }
}
