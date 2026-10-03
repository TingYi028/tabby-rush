import { Groove } from './music.js';

const SFX = ['coin', 'jump', 'roll', 'lane_switch', 'crash', 'powerup', 'land', 'stumble', 'train_horn',
  'train_pass', 'ui_click', 'gameover', 'newbest', 'shield_break', 'go'];

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
    this.musicBus.connect(this.master);
    this.groove = new Groove(this.ctx, this.musicBus);
    this.ready = this.loadAll();
  }

  /** Call from a user gesture: resumes the context so sound can play. */
  unlock() {
    this.preload();
    if (this.ctx && this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
    this.unlocked = true;
  }

  async fetchBuffer(url) {
    try {
      const r = await fetch(url);
      if (!r.ok) return null;
      return await this.ctx.decodeAudioData(await r.arrayBuffer());
    } catch { return null; }
  }

  async loadAll() {
    await Promise.all(SFX.map(async (n) => { this.buf[n] = await this.fetchBuffer(`assets/audio/${n}.mp3`); }));
    // music.json lists the optional soundtrack files, e.g. {"game": "bgm.mp3", "menu": "menu.mp3"}
    let list = {};
    try { const r = await fetch('assets/audio/music.json'); if (r.ok) list = await r.json(); } catch { /* no soundtrack */ }
    this.tracksPending = !!(list.game || list.menu);
    await Promise.all(['game', 'menu'].map(async (k) => {
      if (!list[k]) return;
      const b = await this.fetchBuffer(`assets/audio/${list[k]}`);
      if (b) this.tracks[k] = seamless(this.ctx, b);
    }));
    this.tracksPending = false;
    if (this.mode) { const m = this.mode; this.mode = null; this.music(m); }
  }

  play(name, { vol = 1, rate = 1 } = {}) {
    if (!this.ctx || !this.buf[name]) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.buf[name];
    src.playbackRate.value = rate;
    const g = this.ctx.createGain();
    g.gain.value = vol;
    src.connect(g).connect(this.sfx);
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

  setMuted(m) {
    this.muted = m;
    store.set('muted', m);
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 1, this.ctx.currentTime, 0.05);
  }
}
