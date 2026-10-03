import { Groove } from './music.js';

const SFX = ['coin', 'jump', 'roll', 'lane_switch', 'crash', 'powerup', 'land', 'stumble', 'train_horn',
  'train_pass', 'ui_click', 'gameover', 'newbest', 'shield_break', 'go',
  'nearmiss', 'jetpack', 'rush', 'smash', 'boing', 'drone'];

// Doppler sweep applied automatically to these samples: playbackRate [from, to] over seconds.
const DOPPLER = { train_pass: [1.12, 0.88, 0.5] };

const store = {
  get(k, d) { try { const v = localStorage.getItem(`tabbyrush.${k}`); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(`tabbyrush.${k}`, JSON.stringify(v)); } catch { /* storage unavailable */ } },
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

/** Loop the body of a decoded track with an equal-power crossfaded seam. */
function seamless(ctx, buf, fade = 2) {
  const [start, end] = bodyRange(buf);
  const L = end - start;
  const X = Math.min(Math.floor(fade * buf.sampleRate), Math.floor(L / 4));
  const len = L - X;
  const out = ctx.createBuffer(buf.numberOfChannels, len, buf.sampleRate);
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const a = buf.getChannelData(ch).subarray(start, end), o = out.getChannelData(ch);
    o.set(a.subarray(0, len));
    for (let i = 0; i < X; i++) {
      const t = i / X;
      o[i] = a[i] * Math.sin(t * Math.PI / 2) + a[len + i] * Math.cos(t * Math.PI / 2);
    }
  }
  return out;
}

export class AudioFX {
  constructor() {
    this.ctx = null;
    this.buf = {};
    this.tracks = {};
    this.muted = store.get('muted', false);
    this.coinStep = 0;
    this.lastCoin = 0;
    this.mode = null;
    this.trackSrc = null;
  }

  /** Create the (suspended) context and start downloading/decoding at page load, before any tap. */
  preload() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 3;
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 1;
    this.master.connect(comp).connect(this.ctx.destination);
    this.sfx = this.ctx.createGain();
    this.sfx.gain.value = 0.9;
    this.sfx.connect(this.master);
    this.musicBus = this.ctx.createGain();
    this.musicBus.gain.value = 0.7;
    this.buildLayers();
    this.groove = new Groove(this.ctx, this.musicBus);
    this.ready = this.loadAll();
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

  applyRate(tc = 0.25) {
    if (!this.trackSrc) return;
    const r = (this.baseRate || 1) * (this.layer && this.layer.slow ? 0.94 : 1);
    this.trackSrc.src.playbackRate.setTargetAtTime(r, this.ctx.currentTime, tc);
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
    // music.json lists the optional soundtrack files, e.g. {"game": "bgm.mp3", "menu": "menu.mp3"}
    let list = {};
    try { const r = await fetch('assets/audio/music.json'); if (r.ok) list = await r.json(); } catch { /* no soundtrack */ }
    this.tracksPending = !!(list.game || list.menu);
    const keys = ['game', 'menu'].filter((k) => list[k]);
    const prog = Object.fromEntries(keys.map((k) => [k, 0]));
    const report = () => this.onProgress?.(keys.length ? keys.reduce((s, k) => s + prog[k], 0) / keys.length : 1);
    report();
    await Promise.all(keys.map(async (k) => {
      const b = await this.fetchBuffer(`assets/audio/${list[k]}`, (p) => { prog[k] = p * 0.9; report(); });
      if (b) this.tracks[k] = seamless(this.ctx, b);
      prog[k] = 1;
      report();
    }));
    this.tracksPending = false;
    if (this.mode) { const m = this.mode; this.mode = null; this.music(m); }
  }

  /** `pan` -1..1 places the sound in the stereo field (StereoPannerNode where supported). */
  play(name, { vol = 1, rate = 1, pan = 0 } = {}) {
    if (!this.ctx || !this.buf[name]) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.buf[name];
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
    // Real tracks are still decoding: wait for them instead of starting the synth (avoids two musics at once).
    if (this.tracksPending !== false && mode !== 'off') return;
    if (this.trackSrc) {
      const { src, g } = this.trackSrc, t = this.ctx.currentTime;
      g.gain.cancelScheduledValues(t);
      g.gain.setValueAtTime(g.gain.value, t);
      g.gain.linearRampToValueAtTime(0, t + 0.5);
      src.stop(t + 0.55);
      this.trackSrc = null;
    }
    if (mode === 'off') { this.groove.stop(true); return; }
    const track = this.tracks[mode] || (mode === 'menu' ? this.tracks.game : null);
    if (track) {
      this.groove.stop(true);
      const src = this.ctx.createBufferSource(), g = this.ctx.createGain(), t = this.ctx.currentTime;
      src.buffer = track;
      src.loop = true;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(mode === 'menu' && !this.tracks.menu ? 0.45 : 0.85, t + 0.8);
      src.connect(g).connect(this.musicBus);
      src.start();
      this.trackSrc = { src, g };
    } else {
      this.groove.start(mode);
    }
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

  setMuted(m) {
    this.muted = m;
    store.set('muted', m);
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 1, this.ctx.currentTime, 0.05);
  }
}
