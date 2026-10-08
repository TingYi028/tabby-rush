/*
 * Place art sets on the GPU (specs/zone_pack.md Z-P1 / Z-P2). A set is a place's facades, skyline, props, decals and
 * obstacle skin; 'city' is the shared set every place falls back to. The rules live here, with no three.js, so node can
 * test them: world.js says what to load / build / free (io below), this file decides when.
 *
 *   - at most MAX_SETS place sets are resident (the current and the next); the shared set goes when neither is it
 *   - a set whose files are missing, or whose textures would cost more than SET_MB_MAX, is `failed` and counts as the
 *     shared set (the place keeps its palette, a missing file is never an error); a failed set is retried after RETRY_MS
 *   - uploads are spread: step() runs ONE build job (one texture, or one window-glow canvas) per call, once per frame
 *   - the set on screen is pinned: never freed while any material still points at its textures
 */

export const SHARED = 'city';
export const MAX_SETS = 2;
export const SET_MB_MAX = 11.6;    // half of the 23.2 MB city set: two place sets stay under the one they replace
const RETRY_MS = 60000;

/** GPU megabytes (MiB) of a w x h RGBA texture with its mip chain, the way specs/zone_pack.md counts them. */
export const texMB = (w, h) => (w * h * 4 * 1.33) / 1048576;

/** Pixel rect [x, y, w, h] (origin top-left) of a W x H image as texture coordinates (v counts from the bottom). */
export const rectUV = (r, W, H) => ({ u: r[0] / W, v: 1 - (r[1] + r[3]) / H, du: r[2] / W, dv: r[3] / H });

const rectOk = (r, W, H) => Array.isArray(r) && r.length === 4 && r.every(Number.isFinite) && r[0] >= 0 && r[1] >= 0
  && r[2] >= 4 && r[3] >= 4 && r[0] + r[2] <= W + 0.5 && r[1] + r[3] <= H + 0.5;
export const PROP_H = { min: 0.5, max: 8, fallback: 3 };   // metres: clamp of a prop's suggested height, and its value when missing
const MAX_PROPS = 8;
const MAX_DECALS = 6;   // the decal material slots in world.js

/** A cols x cols grid of equal cells as picture definitions {u, v, du, dv, aspect, height}: what props / decals were before atlas.json. */
export function gridDefs(cols) {
  const out = [];
  for (let k = 0; k < cols * cols; k++) {
    out.push({ u: (k % cols) / cols, v: 1 - (Math.floor(k / cols) + 1) / cols, du: 1 / cols, dv: 1 / cols, aspect: 1, height: PROP_H.fallback });
  }
  return out;
}

/**
 * Validate the parsed atlas.json of a place set against its images ({ props, decals, skin }: anything with width / height, or
 * absent). Returns `{ props, decals, skin }`: props / decals = lists of {u, v, du, dv, aspect, height} (texture coordinates from the
 * pixel rects, bottom-centre anchored props with their suggested world height in metres), skin = { hurdle, overhead } as {u, v, du, dv}
 * (either may be missing). Anything missing, malformed or outside its image is dropped; a part with no valid entry is null, and the
 * caller falls back to the 2 x 2 grid (gridDefs) for props / decals and to no skin rect.
 */
export function parseAtlas(json, img) {
  const out = { props: null, decals: null, skin: null };
  if (!json || typeof json !== 'object' || !img) return out;
  const list = (items, im, max, make) => {
    if (!im || !Array.isArray(items)) return null;
    const defs = [];
    for (const it of items) {
      if (defs.length >= max) break;
      if (it && typeof it === 'object' && rectOk(it.rect, im.width, im.height)) defs.push(make(it, rectUV(it.rect, im.width, im.height)));
    }
    return defs.length ? defs : null;
  };
  out.props = list(json.props, img.props, MAX_PROPS, (it, uv) => ({
    ...uv, aspect: it.rect[2] / it.rect[3],
    height: Number.isFinite(it.height_m) ? Math.min(PROP_H.max, Math.max(PROP_H.min, it.height_m)) : PROP_H.fallback,
  }));
  out.decals = list(json.decals, img.decals, MAX_DECALS, (it, uv) => ({
    ...uv, aspect: Number.isFinite(it.aspect) && it.aspect > 0.1 && it.aspect < 10 ? it.aspect : it.rect[2] / it.rect[3], height: PROP_H.fallback,
  }));
  if (img.skin && json.skin && typeof json.skin === 'object') {
    const skin = {};
    for (const k of ['hurdle', 'overhead']) if (rectOk(json.skin[k], img.skin.width, img.skin.height)) skin[k] = rectUV(json.skin[k], img.skin.width, img.skin.height);
    if (skin.hurdle || skin.overhead) out.skin = skin;
  }
  return out;
}

/** The place's art set name ('city' when the place has none). */
export const placeSet = (place) => (place && place.set) || SHARED;

/**
 * What objects.js needs from the set on screen: its name and obstacle-skin texture (null = none). `version` changes on every
 * swap; onSetSwap(fn) calls fn(skin, name, skinUV) right after one (the skin is disposed with its set once the set is off screen).
 * skinUV = { hurdle, overhead } texture rects {u, v, du, dv} from atlas.json (a part may be missing), or null.
 */
export const ACTIVE = { set: SHARED, skin: null, skinUV: null, version: 0 };
const swapListeners = [];
export function onSetSwap(fn) { swapListeners.push(fn); }
export function swapActive(name, skin, skinUV) {
  ACTIVE.set = name;
  ACTIVE.skin = skin || null;
  ACTIVE.skinUV = (skin && skinUV) || null;
  ACTIVE.version++;
  for (let i = 0; i < swapListeners.length; i++) swapListeners[i](ACTIVE.skin, name, ACTIVE.skinUV);
}

export class ZoneSets {
  /**
   * io.load(name) -> Promise<files | null>; io.build(name, files) -> { res, mb, jobs } | null (jobs: one function per texture,
   * res fills up as they run); io.free(name, res) -> void (disposes whatever is built so far); io.now() -> ms.
   */
  constructor(io) {
    this.io = io;
    this.sets = new Map();   // name -> { name, state: 'loading' | 'building' | 'ready' | 'failed', res, mb, jobs, at }
    this.raw = [];           // names as last asked for
    this.wanted = [];        // the same after aliasing: what may stay resident
    this.pin = '';
    this.peakMB = 0;
    this.uploads = 0;
    this.frees = 0;
  }

  /** Register a set that is already built (the shared set at boot) and put it on screen. */
  adopt(name, res, mb) {
    this.sets.set(name, { name, state: 'ready', res, mb, jobs: null, at: 0 });
    this.pin = name;
    this.peakMB = Math.max(this.peakMB, this.residentMB());
  }

  state(name) { const e = this.sets.get(name); return e ? e.state : 'none'; }

  /** The finished resources of `name`, or null while it is not (completely) ready. */
  get(name) { const e = this.sets.get(name); return e && e.state === 'ready' ? e.res : null; }

  /** A set that failed stands in as the shared set; one that failed long enough ago is tried again. */
  alias(name) {
    if (!name) return SHARED;
    const e = this.sets.get(name);
    if (e && e.state === 'failed') {
      if (this.io.now() - e.at < RETRY_MS) return SHARED;
      this.sets.delete(name);
    }
    return name;
  }

  /** The sets that should be resident now (the current and the next place, or both while cross-fading). Starts loads, frees the rest. */
  want(names) {
    this.raw = names;
    const list = [];
    let fresh = 0;
    for (let i = 0; i < names.length; i++) {
      const a = this.alias(names[i]);
      if (list.includes(a) || (a !== SHARED && ++fresh > MAX_SETS)) continue;
      list.push(a);
    }
    this.wanted = list;
    for (let i = 0; i < list.length; i++) if (!this.sets.has(list[i])) this.start(list[i]);
    this.purge();
  }

  /** The set on screen changed to `name` (it is now the only one materials point at). */
  setPin(name) {
    this.pin = name;
    this.purge();
  }

  start(name) {
    const e = { name, state: 'loading', res: null, mb: 0, jobs: null, at: 0 };
    this.sets.set(name, e);
    this.io.load(name).then((files) => {
      if (this.sets.get(name) !== e) return;   // freed (or replaced) while the files were on their way
      let b = null;
      try { b = files ? this.io.build(name, files) : null; } catch (err) { b = null; }
      if (!b || (name !== SHARED && b.mb > SET_MB_MAX)) { this.fail(e, b && b.res); return; }
      e.res = b.res;
      e.mb = b.mb;
      e.jobs = b.jobs;
      e.state = e.jobs.length ? 'building' : 'ready';
      this.peakMB = Math.max(this.peakMB, this.residentMB());
      this.purge();
    }, () => { if (this.sets.get(name) === e) this.fail(e, null); });
  }

  fail(e, res) {
    if (res) this.io.free(e.name, res);
    if (e.res) this.io.free(e.name, e.res);
    e.res = null;
    e.jobs = null;
    e.state = 'failed';
    e.at = this.io.now();
    this.want(this.raw);   // the shared set takes its place in the list (and is rebuilt if it was already given up)
  }

  /** Free every set that is not wanted and not on screen; the shared set also stays while a wanted set is not ready to replace it. */
  purge() {
    const shared = this.wanted.includes(SHARED) || this.pin === SHARED || this.wanted.some((n) => this.state(n) !== 'ready');
    for (const [name, e] of this.sets) {
      if (e.state === 'failed' || name === this.pin || this.wanted.includes(name) || (name === SHARED && shared)) continue;
      if (e.res) { this.io.free(name, e.res); this.frees++; }
      this.sets.delete(name);
    }
  }

  /** Once per frame: runs one build job of the first wanted set that has any. Returns true if one ran. */
  step() {
    for (let i = 0; i < this.wanted.length; i++) {
      const e = this.sets.get(this.wanted[i]);
      if (!e || e.state !== 'building') continue;
      try { e.jobs.shift()(); } catch (err) { this.fail(e, null); return true; }
      this.uploads++;
      if (!e.jobs.length) { e.state = 'ready'; this.purge(); }
      return true;
    }
    return false;
  }

  /** GPU megabytes held by the sets that are built or being built (counted whole while building: an upper bound). */
  residentMB() {
    let mb = 0;
    for (const e of this.sets.values()) if (e.state === 'building' || e.state === 'ready') mb += e.mb;
    return mb;
  }

  /** Debug / QA: the resident sets with their state and size. */
  stats() {
    const sets = [];
    for (const e of this.sets.values()) sets.push({ name: e.name, state: e.state, mb: Math.round(e.mb * 100) / 100 });
    return { sets, mb: this.residentMB(), peakMB: this.peakMB, uploads: this.uploads, frees: this.frees, pin: this.pin };
  }
}
