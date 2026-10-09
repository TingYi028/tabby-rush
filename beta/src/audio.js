import { PREFIX } from './channel.js';
import { Groove, FADE, GAIN, GRACE, parseManifest, trackChain, trackSpec, fadeTimes, fadeParam, lruVictims, isPlaceId } from './music.js';

const SFX = ['coin', 'jump', 'roll', 'lane_switch', 'crash', 'powerup', 'land', 'stumble', 'train_horn',
  'train_pass', 'ui_click', 'gameover', 'newbest', 'shield_break', 'go',
  'nearmiss', 'jetpack', 'rush', 'smash', 'boing', 'drone',
  'buy', 'equip', 'mission', 'levelup', 'box_open', 'peak'];

// Doppler sweep applied automatically to these samples: playbackRate [from, to] over seconds.
const DOPPLER = { train_pass: [1.12, 0.88, 0.5] };

// Until a new sound's file has loaded (or if it failed), play this older sample at rate x factor instead.
const ALIAS = { buy: ['coin', 1.2], equip: ['ui_click', 1.3], mission: ['powerup', 1.35], levelup: ['newbest', 1.1],
  box_open: ['powerup', 0.9], peak: ['train_horn', 1.15] };

// Shop 跳躍音效: each pack replaces only `jump` and `land`, from `assets/audio/<id>_jump.mp3` / `<id>_land.mp3`.
export const JUMP_PACKS = ['sfx_8bit', 'sfx_meow', 'sfx_spring', 'sfx_muyu'];

/**
 * The buffer to play for `name` and its playback-rate factor, or null when there is nothing to play.
 * With a jump `pack`, its `jump` / `land` comes first; a pack file that is missing falls back to the default sample.
 */
export function soundFor(bufs, name, pack = null) {
  const p = pack && (name === 'jump' || name === 'land') ? `${pack}_${name}` : null;
  if (p && bufs[p]) return { buf: bufs[p], factor: 1 };
  if (bufs[name]) return { buf: bufs[name], factor: 1 };
  const a = ALIAS[name];
  return a && bufs[a[0]] ? { buf: bufs[a[0]], factor: a[1] } : null;
}

/** (L + R) / 2 of a stereo buffer as a new 1-channel buffer (`ctx` allocates it). The source is untouched. */
export function downmixMono(ctx, buf) {
  const n = buf.length, out = ctx.createBuffer(1, n, buf.sampleRate), d = out.getChannelData(0);
  const chans = [...Array(buf.numberOfChannels).keys()].map((c) => buf.getChannelData(c)), k = chans.length;
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let c = 0; c < k; c++) s += chans[c][i];
    d[i] = s / k;
  }
  return out;
}

/** Phones (coarse pointer, or 4 GB of memory or less) keep the soundtrack mono to save memory. */
function isPhone() {
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  return coarse || (globalThis.navigator?.deviceMemory || 8) <= 4;
}

/** Saves live under `tabbyrush.<key>` (the beta build: `tabbyrush-beta.<key>`, see channel.js). */
const store = {
  get(k, d) { try { const v = localStorage.getItem(PREFIX + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(PREFIX + k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};
export { store };

/** Find the full-energy body of a track, skipping quiet intros and fade-outs. */
function bodyRange(buf) {
  const win = Math.floor(buf.sampleRate * 0.1), n = Math.floor(buf.length / win);
  const chans = [...Array(buf.numberOfChannels).keys()].map((c) => buf.getChannelData(c));
  const rms = new Float32Array(n);
  for (let w = 0; w < n; w++) {
    let s = 0;
    for (const d of chans) for (let i = w * win; i < (w + 1) * win; i += 4) s += d[i] * d[i];
    rms[w] = Math.sqrt(s / (win / 4) / chans.length);
  }
  const sorted = [...rms].sort((a, b) => a - b), median = sorted[Math.floor(n / 2)];
  const loud = (w) => rms[w] > median * 0.55;
  let a = 0, b = n - 1;
  while (a < n - 1 && !(loud(a) && loud(a + 1) && loud(a + 2))) a++;
  while (b > a && !(loud(b) && loud(b - 1) && loud(b - 2))) b--;
  if ((b - a) * win < buf.sampleRate * 20) return [0, buf.length];
  return [a * win, (b + 1) * win];
}

/**
 * Make the body of a decoded track loop seamlessly, in place: the samples just past the loop end are
 * equal-power crossfaded into the loop head, and the loop points are returned. No second copy of the
 * (large, ~40 MB per channel-minute at 48 kHz) buffer is made.
 */
function seamless(buf, fade = 2) {
  const [start, end] = bodyRange(buf);
  const L = end - start;
  const X = Math.min(Math.floor(fade * buf.sampleRate), Math.floor(L / 4));
  const len = L - X;
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < X; i++) {
      const t = i / X;
      d[start + i] = d[start + i] * Math.sin(t * Math.PI / 2) + d[start + len + i] * Math.cos(t * Math.PI / 2);
    }
  }
  return { buffer: buf, start: start / buf.sampleRate, end: (start + len) / buf.sampleRate };
}

export class AudioFX {
  constructor() {
    this.ctx = null;
    this.buf = {};
    this.tracks = {};
    this.list = {};        // soundtrack files from music.json, by mode: {menu, game}
    this.manifest = parseManifest(null);   // per-place tracks from music_places.json (see music.js trackChain for the keys)
    this.loads = {};       // track key -> its decode (one per file)
    this.settled = {};     // track key -> decode finished, with or without a buffer
    this.used = {};        // track key -> last-use counter (LRU order for eviction)
    this.useN = 0;
    this.phone = isPhone();
    this.muted = store.get('muted', false);
    this.coinStep = 0;
    this.lastCoin = 0;
    this.mode = null;      // mode asked for
    this.playing = null;   // mode whose music is running
    this.bootTrack = null;
    this.booted = false;   // the boot soundtrack has settled (lobby() can prefetch from here on)
    this.lobbyId = null;   // place the lobby shows = the next run's start place
    this.lobbyWanted = false;   // lobby() was called and no run has started since: its tracks are wanted even mid-run (quit to menu)
    this.runId = null;     // place the hero is in
    this.nextId = null;    // place whose run track is preloading ahead of the hero
    this.cur = null;       // key of the track playing, 'groove' for the synth, null for nothing
    this.trackSrc = null;  // {src, g, key, peak} of the playing track
    this.prevSrc = null;   // the one fading out during a cross-fade
    this.grace = false;    // waited long enough for the place's own track: a fallback may start
    this.graceTimer = null;
    this.graceMs = GRACE * 1000;
    this.secondLoadMs = 1500;   // the run track follows the lobby track this much later at boot
    this.vol = { music: 1, sfx: 1 };
    this.pack = null;      // jump sound pack id (JUMP_PACKS) or null for the default jump / land
    this.packLoads = {};   // pack id -> decode of its jump / land files (once)
  }

  /** Player volume settings 0..1 (music bus base 0.7, SFX bus base 0.9). */
  setVolumes(music, sfx) {
    this.vol = { music, sfx };
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.musicBus.gain.setTargetAtTime(0.7 * music, t, 0.05);
    this.sfx.gain.setTargetAtTime(0.9 * sfx, t, 0.05);
  }

  /** Create the (suspended) context and start downloading/decoding at page load, before any tap. */
  preload() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    // 32 kHz keeps everything a 96 kbps soundtrack carries and decodes the music into a third less memory
    try { this.ctx = new AC({ sampleRate: 32000 }); } catch { this.ctx = new AC(); }
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 3;
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 1;
    this.master.connect(comp).connect(this.ctx.destination);
    this.sfx = this.ctx.createGain();
    this.sfx.gain.value = 0.9 * this.vol.sfx;
    this.sfx.connect(this.master);
    this.musicBus = this.ctx.createGain();
    this.musicBus.gain.value = 0.7 * this.vol.music;
    this.buildLayers();
    this.groove = new Groove(this.ctx, this.musicBus);
    this.ready = this.loadAll();
    if (this.pack) this.loadPack(this.pack);
  }

  /** Shop jump pack: `id` from JUMP_PACKS, anything else = the default jump / land. Its files load on first use. */
  setJumpPack(id) {
    this.pack = JUMP_PACKS.includes(id) ? id : null;
    if (this.pack) this.loadPack(this.pack);
  }

  /** Decode `<id>_jump` and `<id>_land` once. A file that is missing or fails stays out, so its sound plays the default. */
  loadPack(id) {
    if (!this.ctx) return Promise.resolve();   // preload() loads the chosen pack
    this.packLoads[id] ??= Promise.all(['jump', 'land'].map(async (n) => {
      this.buf[`${id}_${n}`] = await this.fetchBuffer(`assets/audio/${id}_${n}.mp3`);
    }));
    return this.packLoads[id];
  }

  /**
   * Music bus -> lowpass (opened wide; closes to 900 Hz in slow-mo) -> master,
   * plus a looping wind layer (noise -> bandpass -> gain) that rises with run speed.
   */
  buildLayers() {
    const c = this.ctx;
    this.musicLP = c.createBiquadFilter();
    this.musicLP.type = 'lowpass';
    this.musicLP.frequency.value = 18000;
    this.musicLP.Q.value = 0.7;
    this.musicBus.connect(this.musicLP).connect(this.master);
    const len = c.sampleRate * 2, noise = c.createBuffer(1, len, c.sampleRate), d = noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.wind = c.createBufferSource();
    this.wind.buffer = noise;
    this.wind.loop = true;
    this.windBP = c.createBiquadFilter();
    this.windBP.type = 'bandpass';
    this.windBP.frequency.value = 500;
    this.windBP.Q.value = 0.9;
    this.windGain = c.createGain();
    this.windGain.gain.value = 0;
    this.wind.connect(this.windBP).connect(this.windGain).connect(this.sfx);
    this.wind.start();
    this.layer = { wind: -1, band: -1, slow: false };
    this.baseRate = 1;
  }

  /**
   * Per-frame speed layering. speedNorm 0..1 drives the wind (bandpass 500 -> 1800 Hz, gain up to 0.14,
   * silent unless `playing`); `slow` (slow-mo / hit-stop) muffles the music and drops its rate to x0.94.
   */
  setIntensity(speedNorm, slow, playing = true) {
    if (!this.windGain) return;
    const t = this.ctx.currentTime, L = this.layer;
    const s = Math.max(0, Math.min(1, speedNorm || 0));
    const g = playing ? 0.025 + 0.115 * s : 0;
    if (Math.abs(g - L.wind) > 0.002) { this.windGain.gain.setTargetAtTime(g, t, playing ? 0.25 : 0.1); L.wind = g; }
    const f = 500 + 1300 * s;
    if (Math.abs(f - L.band) > 8) { this.windBP.frequency.setTargetAtTime(f, t, 0.25); L.band = f; }
    if (!!slow !== L.slow) {
      L.slow = !!slow;
      this.musicLP.frequency.setTargetAtTime(L.slow ? 900 : 18000, t, 0.03);
      this.applyRate(0.05);
    }
  }

  /** Playback rate of the music: frenzy speed-up x slow-mo drop. */
  rate() { return (this.baseRate || 1) * (this.layer && this.layer.slow ? 0.94 : 1); }

  /** Both tracks of a cross-fade follow slow-mo and frenzy. */
  applyRate(tc = 0.25) {
    for (const s of [this.trackSrc, this.prevSrc]) if (s) s.src.playbackRate.setTargetAtTime(this.rate(), this.ctx.currentTime, tc);
  }

  /** Call from a user gesture: resumes the context so sound can play. */
  unlock() {
    this.preload();
    if (!this.ctx) return Promise.resolve(false);
    const done = () => { this.unlocked = this.ctx.state === 'running'; return this.unlocked; };
    if (this.ctx.state === 'running') return Promise.resolve(done());
    return this.ctx.resume().then(done, () => false);
  }

  /** Fetch and decode; `onProgress(0..1)` reports download progress when the size is known. */
  async fetchBuffer(url, onProgress) {
    try {
      const r = await fetch(url);
      if (!r.ok) return null;
      const total = Number(r.headers.get('content-length')) || 0;
      let data;
      if (onProgress && total && r.body) {
        const reader = r.body.getReader(), chunks = [];
        let got = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          got += value.length;
          onProgress(Math.min(1, got / total));
        }
        data = new Uint8Array(got);
        let o = 0;
        for (const c of chunks) { data.set(c, o); o += c.length; }
        data = data.buffer;
      } else {
        data = await r.arrayBuffer();
      }
      return await this.ctx.decodeAudioData(data);
    } catch { return null; }
  }

  async loadAll() {
    await Promise.all(SFX.map(async (n) => { this.buf[n] = await this.fetchBuffer(`assets/audio/${n}.mp3`); }));
    // music.json lists the optional soundtrack files, e.g. {"game": "bgm.mp3", "menu": "menu.mp3"};
    // music_places.json the per-place tracks (parseManifest drops anything malformed; a missing file = no place tracks)
    const getJson = async (url) => { try { const r = await fetch(url); return r.ok ? await r.json() : null; } catch { return null; } };
    const [list, places] = await Promise.all([getJson('assets/audio/music.json'), getJson('assets/audio/music_places.json')]);
    this.list = list && typeof list === 'object' ? list : {};
    this.manifest = parseManifest(places);
    // Boot decodes one soundtrack (the lobby place's menu track, else menu.mp3, else the run track if that is all there is);
    // the lobby place's run track follows 1.5 s later
    const order = [this.chain('menu')[0], this.chain('game')[0]].filter((k, i, all) => k && all.indexOf(k) === i);
    this.bootTrack = order[0] || null;
    this.tracksPending = order.length > 0;
    if (!order.length) this.onProgress?.(1);
    if (order[0]) await this.loadTrack(order[0]);
    this.tracksPending = false;
    this.booted = true;
    this.apply();
    if (order[1]) setTimeout(() => this.loadTrack(order[1]).then(() => this.apply()), this.secondLoadMs);
  }

  /** Track keys for `mode` ('menu' = lobby, 'game' = run), best first. Defaults: the lobby place / the place the hero is in. */
  chain(mode, id = mode === 'game' ? this.runId ?? this.lobbyId : this.lobbyId) {
    return trackChain(this.manifest, this.list, mode, id);
  }

  /** Fetch and decode soundtrack `k` once (a track key, see music.js). evict() drops it again when nothing wants it. */
  loadTrack(k) {
    const spec = trackSpec(this.manifest, this.list, k);
    if (!spec) return Promise.resolve();
    this.loads[k] ??= (async () => {
      const b = await this.fetchBuffer(`assets/audio/${spec.file}`, (p) => this.progress(k, p * 0.9));
      try { if (b) { this.tracks[k] = this.prepare(spec, b); this.touch(k); } } catch { /* keep the fallback for this one */ }
      this.settled[k] = true;
      this.progress(k, 1);
      this.evict(k);
    })();
    return this.loads[k];
  }

  /**
   * The playable track of a decode. Phones keep a mono copy and drop the stereo buffer. A legacy file (menu.mp3 / bgm.mp3) is
   * made to loop in place by seamless(); a place file is already seamless and ships its loop points, so it is used as it is
   * (seamless() would shorten the loop by its crossfade and smear the beat). Throws when the loop does not fit the file.
   */
  prepare(spec, b) {
    const buf = this.phone && b.numberOfChannels > 1 ? downmixMono(this.ctx, b) : b;
    if (!spec.loop) return seamless(buf);
    const end = Math.min(spec.loop[1], buf.length / buf.sampleRate);
    if (end - spec.loop[0] < 4) throw new Error('loop outside the file');
    return { buffer: buf, start: spec.loop[0], end };
  }

  touch(k) { this.used[k] = ++this.useN; }

  /** Tracks that must stay decoded: playing / fading ones and what the lobby, the run and the next place are heading for. */
  keepKeys() {
    const keep = new Set();
    for (const s of [this.trackSrc, this.prevSrc]) if (s) keep.add(s.key);
    // a chain counts up to its first decoded track: the fallbacks behind it are not needed any more
    const add = (chain) => { for (const k of chain) { keep.add(k); if (this.tracks[k]) break; } };
    if (this.mode === 'game') {
      add(this.chain('game'));
      if (this.nextId) add(this.chain('game', this.nextId));
    }
    if (this.mode !== 'game' || this.lobbyWanted) {
      add(this.chain('menu'));
      add(this.chain('game', this.lobbyId));   // 開始衝刺 should be instant
    }
    return keep;
  }

  /**
   * Drop decoded tracks over the cap (2 on phones, 4 elsewhere), least recently used first, never one that is playing or
   * wanted. On phones also `landed` if nothing wants it, and, with `eager` (a fade just ended), everything nothing wants.
   */
  evict(landed, eager = false) {
    const keep = this.keepKeys();
    const drop = lruVictims(Object.keys(this.tracks), this.used, keep, eager ? 0 : this.phone ? 2 : 4);
    if (this.phone && landed && this.tracks[landed] && !keep.has(landed) && !drop.includes(landed)) drop.push(landed);
    for (const k of drop) { delete this.tracks[k]; delete this.loads[k]; delete this.settled[k]; delete this.used[k]; }
  }

  /**
   * The lobby shows place `id` (the next run's start place, null = none): load its lobby track first, then its run track, so
   * the lobby music and 開始衝刺 are both quick. Boot loads them itself (loadAll): call this before audio.preload() then.
   */
  lobby(id) {
    this.lobbyId = isPlaceId(id) ? id : null;
    this.lobbyWanted = true;
    if (!this.ctx || !this.booted) return;
    const first = (mode) => this.chain(mode, this.lobbyId).find((k) => this.tracks[k] || !this.settled[k]);
    const go = (k) => (k && !this.tracks[k] ? this.loadTrack(k) : null);
    this.apply();
    Promise.resolve(go(first('menu'))).then(() => go(first('game'))).then(() => this.apply());
  }

  /** The hero entered place `id`: cross-fade to its run track (or wait for it and keep the current one). */
  place(id) {
    const next = isPlaceId(id) ? id : null;
    if (next === this.nextId) this.nextId = null;
    if (next === this.runId) return;
    this.runId = next;
    if (this.mode === 'game') this.apply();
  }

  /** Start decoding the run track of the place coming up (null = none), early enough for a cross-fade at the boundary. */
  preloadPlace(id) {
    if (id === this.nextId) return;   // called every frame
    const next = isPlaceId(id) ? id : null;
    if (next === this.nextId) return;
    this.nextId = next;
    if (!next || !this.ctx) return;
    const k = this.chain('game', next).find((c) => this.tracks[c] || !this.settled[c]);
    if (k && !this.tracks[k]) this.loadTrack(k).then(() => this.apply());
  }

  /** Download progress of the boot soundtrack feeds the loading bar. */
  progress(k, p) { if (k === this.bootTrack) this.onProgress?.(p); }

  /** `pan` -1..1 places the sound in the stereo field (StereoPannerNode where supported). */
  play(name, { vol = 1, rate = 1, pan = 0 } = {}) {
    const s = soundFor(this.buf, name, this.pack);
    if (!this.ctx || !s) return;
    const src = this.ctx.createBufferSource();
    src.buffer = s.buf;
    rate *= s.factor;
    src.playbackRate.value = rate;
    const dop = DOPPLER[name];
    if (dop) {
      const t = this.ctx.currentTime;
      src.playbackRate.setValueAtTime(rate * dop[0], t);
      src.playbackRate.exponentialRampToValueAtTime(rate * dop[1], t + dop[2]);
    }
    const g = this.ctx.createGain();
    g.gain.value = vol;
    let out = this.sfx;
    if (pan && this.ctx.createStereoPanner) {
      out = this.ctx.createStereoPanner();
      out.pan.value = Math.max(-1, Math.min(1, pan));
      out.connect(this.sfx);
    }
    src.connect(g).connect(out);
    src.start();
  }

  coin() {
    const now = performance.now();
    this.coinStep = now - this.lastCoin < 420 ? Math.min(this.coinStep + 1, 14) : 0;
    this.lastCoin = now;
    this.play('coin', { vol: 0.5, rate: Math.pow(2, this.coinStep / 24) });
  }

  /** mode: 'menu' | 'game' | 'off' */
  music(mode) {
    if (!this.ctx || mode === this.mode) return;
    this.mode = mode;
    if (mode === 'game') this.lobbyWanted = false;
    this.apply();
  }

  /**
   * Play what this.mode wants: its place's track if decoded, else (nothing playing) the next best decoded one, else the synth
   * after GRACE seconds. While the wanted track is still decoding the current music keeps playing (the lobby track through the
   * 開始衝刺 handover, the last place's track at a boundary); the decode's landing calls apply() again.
   */
  apply() {
    const mode = this.mode;
    if (!mode || !this.ctx) return;
    if (mode === 'off') {
      if (this.playing === 'off') return;
      this.playing = 'off';
      this.leave(this.ctx.currentTime, FADE.off);
      this.groove.stop(true);
      this.cur = null;
      this.calm();
      return;
    }
    // The boot soundtrack is still decoding: wait for it instead of starting the synth (avoids two musics at once).
    if (this.tracksPending !== false) return;
    let play = null, wait = null;
    for (const k of this.chain(mode)) {
      if (this.tracks[k]) {
        if (wait && mode === 'menu' && k === 'game') continue;   // run music is no stand-in for a lobby track that is on its way
        play = k;
        break;
      }
      if (!this.settled[k]) wait ??= k;
    }
    if (wait) this.loadTrack(wait).then(() => this.apply());
    let target;
    if (!wait) target = play || 'groove';
    else if (this.cur && (this.cur !== 'groove' || !play)) target = this.cur;
    else if (play) target = play;
    else if (this.grace) {
      target = 'groove';
      const k = this.chain(mode).find((c) => c !== wait && !this.tracks[c] && !this.settled[c]);
      if (k) this.loadTrack(k).then(() => this.apply());   // a fallback file to replace the synth
    } else {
      if (!this.graceTimer) this.graceTimer = setTimeout(() => { this.graceTimer = null; this.grace = true; this.apply(); }, this.graceMs);
      return;
    }
    this.playing = mode;
    this.switchTo(target, mode);
  }

  /** Gain of track `key` while `mode` is wanted. */
  peak(mode, key) { return mode === 'menu' && key === 'game' ? GAIN.lobbyFallback : GAIN.track; }

  /** Nothing is waiting for a track any more: stop the grace timer. */
  calm() {
    clearTimeout(this.graceTimer);
    this.graceTimer = null;
    this.grace = false;
  }

  /** Move the sound to `target` (a decoded track key or 'groove') with the cross-fade that fits the pair of tracks. */
  switchTo(target, mode) {
    const t = this.ctx.currentTime, cur = this.trackSrc;
    if (target === this.cur) {
      if (cur) this.retarget(cur, this.peak(mode, cur.key), t);
      else this.groove.start(mode);   // the same synth, maybe in another mode
      return;
    }
    this.calm();
    if (this.prevSrc) this.cut(this.prevSrc, t);   // a fade is still running: finish it fast
    if (target === 'groove') {
      this.leave(t, FADE.off);
      this.groove.start(mode);
      this.cur = 'groove';
      return;
    }
    const [out, inn] = fadeTimes(cur ? cur.key : null, target);
    if (this.cur === 'groove') this.groove.stop(true);
    this.leave(t, out);
    const track = this.tracks[target], src = this.ctx.createBufferSource(), g = this.ctx.createGain(), peak = this.peak(mode, target);
    src.buffer = track.buffer;
    src.loop = true;
    src.loopStart = track.start;
    src.loopEnd = track.end;
    src.playbackRate.value = this.rate();
    fadeParam(g.gain, t, inn, peak, 'in');
    src.connect(g).connect(this.musicBus);
    src.start(t, track.start);
    this.trackSrc = { src, g, key: target, peak };
    this.cur = target;
    this.touch(target);
  }

  /** The playing track fades out over `dur` seconds and is released when it has ended. */
  leave(t, dur) {
    const cur = this.trackSrc;
    if (!cur) return;
    fadeParam(cur.g.gain, t, dur, cur.g.gain.value, 'out');
    cur.src.stop(t + dur + 0.05);
    cur.src.onended = () => {
      if (this.prevSrc === cur) this.prevSrc = null;
      try { cur.src.disconnect(); cur.g.disconnect(); } catch { /* already gone */ }
      this.evict(null, this.phone);
    };
    this.prevSrc = cur;
    this.trackSrc = null;
  }

  /** Silence a fading track quickly (another switch came before its fade ended). */
  cut(prev, t) {
    fadeParam(prev.g.gain, t, 0.1, prev.g.gain.value, 'out');
    prev.src.stop(t + 0.15);
    this.prevSrc = null;
  }

  /** Ramp the playing track to gain `peak` (e.g. the lobby track kept through the handover to a run). */
  retarget(cur, peak, t) {
    if (cur.peak === peak) return;
    cur.peak = peak;
    cur.g.gain.cancelScheduledValues(t);
    cur.g.gain.setValueAtTime(cur.g.gain.value, t);
    cur.g.gain.linearRampToValueAtTime(peak, t + FADE.in);
  }

  /** Speed the soundtrack up slightly during frenzy. */
  setRate(r) {
    this.baseRate = r;
    this.applyRate(0.25);
  }

  /** setRate() only reaches music files; the synth fallback gets its tempo nudged instead (112 -> 120 BPM). */
  setTempo(fast) {
    if (this.groove) this.groove.bpm = fast ? 120 : 112;
  }

  /** Decoded soundtrack memory in MB (debug): length x channels x 4 bytes (float32). */
  memoryMB() {
    const bytes = Object.values(this.tracks).reduce((s, t) => s + t.buffer.length * t.buffer.numberOfChannels * 4, 0);
    return Math.round(bytes / 1048576 * 10) / 10;
  }

  setMuted(m) {
    this.muted = m;
    store.set('muted', m);
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 1, this.ctx.currentTime, 0.05);
  }
}
