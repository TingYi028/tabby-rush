import * as C from './config.js';
import { Train, Ramp, Hurdle, Overhead, PowerUp, JumpPad, BoostStrip } from './objects.js';
import { setPieces } from './setpieces.js';
import { tuneRow, inTunnel } from './director.js';
import { PEAK, comboGap } from './peak.js';

const FACTORY = { train: Train, ramp: Ramp, hurdle: Hurdle, overhead: Overhead, power: PowerUp, pad: JumpPad, boost: BoostStrip };
const POWER_WEIGHTS = [['magnet', 0.3], ['sneakers', 0.17], ['x2', 0.25], ['shield', 0.2], ['jetpack', 0.08]];
const JET_FIRST = 800, JET_GAP = 1500;  // m: no jetpack this early, nor this soon after the previous one

/** A power-up type for track position s; the jetpack only when it is allowed there (weights renormalised). */
function weightedPower(s, lastJet, noJet) {
  const jetOk = !noJet && s >= JET_FIRST && s - lastJet >= JET_GAP;
  const list = jetOk ? POWER_WEIGHTS : POWER_WEIGHTS.filter(([t]) => t !== 'jetpack');
  let r = Math.random() * list.reduce((a, [, w]) => a + w, 0);
  for (const [t, w] of list) { if ((r -= w) < 0) return t; }
  return 'magnet';
}

// Tension/release: difficulty offset for each row of an 8-row cycle. Rows 0-4 climb, row 5 is the
// gate (a pattern needing 2-3 actions), rows 6-7 are breathers (open track, coins, earlier power-ups).
const WAVE = [0, 0.08, 0.16, 0.24, 0.32, 0.5, -0.5, -0.5];
const GATE_ROW = 5;
const LINE_OK = { empty: true, boost: true, rampTrain: true, hurdle: true, overhead: true }; // lanes that can take a second coin line
const BOOST_CHANCE = 0.68;   // per climb row 0-2, at most one strip per 6 rows (~1 per 10 rows overall)

/**
 * Generates the track in SLOT-long rows. A "safe lane" random-walks one lane at a time and is
 * never blocked by a train, and every lane that was open in the previous row must be able to
 * reach an open lane in the next one, so a run is always survivable.
 */
export class Spawner {
  constructor(root, mats, coins) {
    this.root = root;
    this.mats = mats;
    this.coins = coins;
    this.pools = { train: [], ramp: [], hurdle: [], overhead: [], power: [], pad: [], boost: [] };
    this.obstacles = [];
    this.powerups = [];
    this.rng = null;      // daily challenge: seeded () => [0, 1) that drives generation (see seeded())
    this.rowHook = null;  // daily modifier: (content, k, spawner) => void, called per row in genSlot()
    this.reset(false);
  }

  /** Run `fn` with Math.random swapped for `this.rng` (when set), so the generated track is repeatable. */
  seeded(fn) {
    if (!this.rng) return fn();
    const rnd = Math.random;
    this.realRandom = rnd;
    Math.random = this.rng;
    try { return fn(); } finally { Math.random = rnd; }
  }

  /** Inside seeded(): run `fn` on the real Math.random instead. */
  unseeded(fn) {
    if (!this.rng || Math.random !== this.rng) return fn();
    Math.random = this.realRandom;
    try { return fn(); } finally { Math.random = this.rng; }
  }

  /**
   * Pooled objects draw their own randomness (THREE uuids, train livery, lazily built cars and textures)
   * from the real Math.random, so a seeded track never depends on what happens to be in the pools.
   */
  isolate(obj) {
    for (let p = Object.getPrototypeOf(obj); p && p !== Object.prototype; p = Object.getPrototypeOf(p)) {
      for (const m of Object.getOwnPropertyNames(p)) {
        const f = Object.getOwnPropertyDescriptor(p, m).value;
        if (m === 'constructor' || typeof f !== 'function' || Object.prototype.hasOwnProperty.call(obj, m)) continue; // (Object.hasOwn: iOS 15.4+)
        const sp = this;
        // fast path outside generation (every frame: setDanger, signs...) allocates nothing
        obj[m] = function () {
          if (!sp.rng || Math.random !== sp.rng) return f.apply(obj, arguments);
          const args = arguments;
          return sp.unseeded(() => f.apply(obj, args));
        };
      }
    }
    return obj;
  }

  reset(active = true) {
    for (const o of this.obstacles) this.release(o.kind, o.obj);
    for (const p of this.powerups) this.release('power', p.obj);
    this.obstacles.length = 0;
    this.powerups.length = 0;
    this.coins.clear();
    this.k = 0;
    this.safe = 1;
    this.busy = [0, 0, 0];
    this.blocked = [];
    this.reserve = null;
    this.resetSetPieces();
    this.lastMoving = -99;
    this.nextPower = 8 + C.randi(0, 2);
    this.lastJet = -1e9;
    this.lastBoost = -99;
    this.boostLane = -1;
    this.padRow = -9;     // last row that had spring pads, and their lanes (the next row avoids flat train fronts there)
    this.padLanes = [];
    this.comboRow = -9;   // last gate-combo row, its lane and the hurdle's position (the next row keeps that lane clear)
    this.comboLane = -1;
    this.comboEnd = 0;
    this.active = active;
  }

  get(kind) {
    const obj = this.pools[kind].pop() || this.unseeded(() => this.isolate(new FACTORY[kind](this.mats)));
    if (!obj.group.parent) this.root.add(obj.group);
    obj.group.visible = true;
    return obj;
  }

  release(kind, obj) {
    obj.group.visible = false;
    this.pools[kind].push(obj);
  }

  addObstacle(kind, obj, lane, s0, len, extra = {}) {
    const o = { kind, type: kind, obj, lane, x: C.laneX(lane), y0: 0, s0, len, moving: false, speed: 0, ...extra };
    obj.group.position.set(o.x, o.y0, -s0);
    obj.group.rotation.set(0, 0, 0);
    this.obstacles.push(o);
    return o;
  }

  /**
   * Highest walkable surface under (x, s) that the hero can stand on from height y.
   * `prevS` (last frame's s) keeps a long frame from tunnelling under a ramp: slopes are judged by
   * the height where the hero was, and a train is reachable when he was climbing its ramp.
   */
  groundAt(x, s, y, prevS = s) {
    let g = 0;
    for (const o of this.obstacles) {
      if (o.type !== 'train' && o.type !== 'ramp') continue;
      if (Math.abs(x - o.x) > C.LANE_W / 2 || s < o.s0 - 0.3 || s > o.s0 + o.len + 0.3) continue;
      let top, reach;
      if (o.type === 'train') {
        top = C.TRAIN_TOP;
        reach = y >= top - C.STEP_UP || (prevS < o.s0 && this.climbingInto(o, prevS, y));
      } else {
        top = C.clamp((s - o.s0) / C.RAMP_LEN, 0, 1) * C.TRAIN_TOP;
        reach = y >= C.clamp((Math.min(s, prevS) - o.s0) / C.RAMP_LEN, 0, 1) * C.TRAIN_TOP - C.STEP_UP;
      }
      if (reach && top > g) g = top;
    }
    return g;
  }

  /** Was the hero (at prevS, height y) on the ramp that leads onto this train? */
  climbingInto(train, prevS, y) {
    for (const q of this.obstacles) {
      if (q.type !== 'ramp' || Math.abs(q.x - train.x) > 0.1 || Math.abs(q.s0 + q.len - train.s0) > 0.25) continue;
      if (prevS < q.s0 - 0.3) continue;
      const h = C.clamp((prevS - q.s0) / C.RAMP_LEN, 0, 1) * C.TRAIN_TOP;
      if (y >= h - C.STEP_UP) return true;
    }
    return false;
  }

  update(dt, dist) {
    const events = [];
    this.trackPace(dt, dist);
    if (this.active && C.START_GAP + this.k * C.SLOT < dist + C.VIEW_AHEAD) {
      this.genTo = dist + C.VIEW_AHEAD;
      this.seeded(this.genAhead ||= () => { while (C.START_GAP + this.k * C.SLOT < this.genTo) this.genSlot(); });
    }
    for (let i = this.obstacles.length - 1; i >= 0; i--) {
      const o = this.obstacles[i];
      if (o.moving) {
        o.s0 -= o.speed * dt;
        o.obj.group.position.z = -o.s0;
        if (o.swerve) this.swerveStep(o, dt, dist, events);
        if (!o.honked && o.s0 - dist < Math.max(95, 2.2 * (this.pace + o.speed))) { o.honked = true; events.push({ type: 'horn', lane: o.lane }); }
        if (!o.passed && o.s0 < dist) { o.passed = true; events.push({ type: 'pass', lane: o.lane }); }
      }
      if (o.s0 + o.len < dist - 16) {
        this.release(o.kind, o.obj);
        this.obstacles[i] = this.obstacles[this.obstacles.length - 1];
        this.obstacles.pop();
      }
    }
    for (let i = this.powerups.length - 1; i >= 0; i--) {
      const p = this.powerups[i];
      if (p.s < dist - 10) {
        this.release('power', p.obj);
        this.powerups.splice(i, 1);
      }
    }
    this.updateSigns(dt, dist, events);
    return events;
  }

  /** Zig-zag coin trail in the sky for the jetpack (`rnd`: the daily run passes a generator seeded by the pickup). */
  addSkyCoins(from, to, rnd = Math.random) {
    let lane = 1, s = from;
    while (s < to) {
      for (let i = 0; i < 7 && s < to; i++, s += 2.6) this.coins.add(C.laneX(lane), C.JET_Y + 1, s);
      lane = lane === 1 ? (rnd() < 0.5 ? 0 : 2) : 1;
      s += 3;
    }
  }

  removePower(p) {
    this.release('power', p.obj);
    this.powerups.splice(this.powerups.indexOf(p), 1);
  }

  /** Remove an obstacle (shield smash) together with its attached ramp. */
  smash(o) {
    this.roofSmash(o);
    for (let i = this.obstacles.length - 1; i >= 0; i--) {
      const q = this.obstacles[i];
      if (q === o || (q.lane === o.lane && q.type === 'ramp' && Math.abs(q.s0 + q.len - o.s0) < 0.1)) {
        this.release(q.kind, q.obj);
        this.obstacles.splice(i, 1);
      }
    }
  }

  genSlot() {
    const k = this.k++;
    const s0 = C.START_GAP + k * C.SLOT;
    if (!this.roof && s0 >= this.nextPeak) this.openPeak(s0);
    // Peak hour rows (peak.js): `dense` rows get the density rules; in a tunnel only coins / arcs / breathers change
    const peak = this.peakAt(s0), dense = peak && !inTunnel(s0 + C.SLOT / 2, C.SLOT / 2 + 6);
    const wave = k % WAVE.length;
    const gate = wave === GATE_ROW, breather = wave === 7 || (wave === 6 && s0 < 1500 && !peak);
    let diff = C.clamp(C.clamp(s0 / 2500, 0, 1) + (wave === 6 && !breather ? 0.1 : WAVE[wave]), 0, 1);
    if (dense && !breather) diff = Math.max(diff, PEAK.diff);
    const prevBlocked = this.blocked[k - 1] || [false, false, false];
    if (k > 3) this.blocked[k - 4] = undefined; // only the previous row is ever read
    if (this.setPieceRow(k, s0)) return; // rooftop segment rows (setpieces.js)

    const prevSafe = this.safe;
    // An oncoming train needs a clear lane next to an unchanging safe lane for the rows it sweeps through.
    if (!this.reserve && s0 > 200 && k - this.lastMoving > (dense ? PEAK.bookGap : 3) && Math.random() < (dense ? PEAK.book : 0.4 + 0.2 * diff)) {
      const cand = [prevSafe - 1, prevSafe + 1].filter((l) => l >= 0 && l <= 2 && this.busy[l] <= k);
      if (cand.length) this.reserve = { lane: C.pick(cand), until: k + 6 };
    }
    this.planSwerve(k, s0, prevSafe);
    const R = this.reserve;
    let newSafe = prevSafe;
    if (!R && k > 1 && Math.random() < (dense ? PEAK.safeMove : 0.4)) {
      // (peak hour: a lane whose train ended in the previous row counts too; busy still keeps every train body out)
      const cand = [prevSafe - 1, prevSafe + 1].filter((l) => l >= 0 && l <= 2 && this.busy[l] <= k && (dense || !prevBlocked[l]));
      if (cand.length) newSafe = C.pick(cand);
    }
    this.safe = newSafe;
    const safeSet = new Set([prevSafe, newSafe]);
    // Gate: a wall of trains around a barrier in the safe lane, or a roll-then-jump double barrier there.
    const wall = gate && (prevSafe !== newSafe || Math.random() < 0.55);

    const content = ['empty', 'empty', 'empty'];
    const blocked = [false, false, false];
    for (let L = 0; L < 3; L++) {
      if (this.busy[L] > k) { content[L] = 'body'; blocked[L] = true; continue; }
      if (k < 2) continue;
      if (R && R.to === L && k < R.until) continue; // lane an oncoming train will swerve into stays clear
      if (R && R.lane === L) {
        if (k >= R.until) { content[L] = 'moving'; this.reserve = null; }
        continue;
      }
      if (safeSet.has(L)) {
        if (gate && L === prevSafe) content[L] = wall ? (Math.random() < 0.5 ? 'hurdle' : 'overhead') : 'combo';
        else if (prevSafe === newSafe && Math.random() < (s0 < 1500 ? 0.2 + 0.25 * diff : 0.24 + 0.3 * diff) + (dense ? PEAK.safeBar : 0)) content[L] = Math.random() < 0.5 ? 'hurdle' : 'overhead';
        continue;
      }
      const r = wall ? 0 : Math.random();
      const mid = L === 1 && prevSafe !== 1 && newSafe !== 1 ? 0.15 : 0;
      if (r < 0.44 + 0.32 * diff + mid + (dense ? PEAK.trainAdd : 0)) {
        content[L] = Math.random() < (s0 < 2000 ? 0.36 : 0.28) ? 'rampTrain' : 'train';
      } else if (r < 0.6 + 0.25 * diff) {
        content[L] = Math.random() < 0.5 ? 'hurdle' : 'overhead';
      } else if (k > 3 && Math.random() < 0.3) {
        content[L] = 'pad';
      }
    }
    if (this.comboRow === k - 1 && (content[this.comboLane] === 'hurdle' || content[this.comboLane] === 'overhead' || content[this.comboLane] === 'pad')) {
      content[this.comboLane] = 'empty';
    }
    // Never surge straight into a flat train front: the row after a boost strip gets a ramp in that lane.
    if (this.lastBoost === k - 1 && content[this.boostLane] === 'train') content[this.boostLane] = 'rampTrain';
    if (this.padRow === k - 1) for (const L of this.padLanes) if (content[L] === 'train') content[L] = 'rampTrain';
    for (let L = 0; L < 3; L++) if (content[L] === 'train' || content[L] === 'moving') blocked[L] = true;

    // Fairness: from every lane open in the previous row there must be a sideways path to an open lane.
    for (let A = 0; A < 3; A++) {
      if (prevBlocked[A] || content[A] === 'body') continue;
      let lo = A, hi = A;
      while (lo > 0 && !prevBlocked[lo - 1]) lo--;
      while (hi < 2 && !prevBlocked[hi + 1]) hi++;
      let ok = false;
      for (let B = lo; B <= hi; B++) if (!blocked[B]) ok = true;
      if (!ok) {
        content[A] = content[A] === 'train' ? 'rampTrain' : 'empty';
        blocked[A] = false;
      }
    }

    if (breather) this.breathe(content, blocked);
    else if (wave < 3 && k > 3) this.maybeBoost(content, R, k, s0);
    if (this.rowHook) this.rowHook(content, k, this);

    tuneRow(this, k, s0, content, blocked, prevBlocked, breather, dense); // zone theme + tunnel + peak rules (director.js)
    this.blocked[k] = blocked;
    const prevPadRow = this.padRow, prevPadLanes = this.padLanes;
    this.padRow = k;
    this.padLanes = [0, 1, 2].filter((L) => content[L] === 'pad');

    const info = [null, null, null];
    for (let L = 0; L < 3; L++) info[L] = this.place(content[L], L, s0, k, diff, dense ? PEAK.moveAdd : 0);
    const combo = content.indexOf('combo');
    if (combo >= 0) { this.comboRow = k; this.comboLane = combo; this.comboEnd = info[combo].at2; }
    this.armSwerve(R, content, s0);

    if (breather) this.breatherCoins(content, R, newSafe, s0, k, peak);
    else this.placeCoins(content, info, blocked, newSafe, s0, k, { padRow: prevPadRow, padLanes: prevPadLanes }, peak);

    if (k >= this.nextPower - (breather ? 2 : 0)) {
      const lanes = [0, 1, 2].filter((l) => content[l] === 'empty' && !this.reserved(R, l));
      if (lanes.length) {
        const L = C.pick(lanes);
        const obj = this.get('power');
        obj.setType(weightedPower(s0 + 14, this.lastJet, this.peakNoJet(s0 + 14)));
        if (obj.type === 'jetpack') this.lastJet = s0 + 14;
        const p = { obj, x: C.laneX(L), y: 1.25, s: s0 + 14, type: obj.type, t: Math.random() * 6 };
        obj.group.position.set(p.x, p.y, -p.s);
        this.powerups.push(p);
        this.nextPower = k + 12 + C.randi(0, 6);
      }
    }
  }

  /** Breather row (after the fairness pass): clear everything except trains already on the track and an oncoming one. */
  breathe(content, blocked) {
    for (let L = 0; L < 3; L++) {
      if (content[L] === 'body' || content[L] === 'moving') continue;
      content[L] = 'empty';
      blocked[L] = false;
    }
  }

  /**
   * A speed-boost strip in an open lane on a climb row; never in a lane kept clear for an oncoming train,
   * nor right after a pad or hurdle in that lane (the hero would sail over it).
   */
  maybeBoost(content, R, k, s0) {
    if (k - this.lastBoost < 6 || Math.random() > BOOST_CHANCE) return;
    const airborne = (l) => this.obstacles.some((o) => o.lane === l && (o.type === 'pad' || o.type === 'hurdle') && o.s0 > s0 - C.SLOT && o.s0 < s0);
    const open = [0, 1, 2].filter((l) => content[l] === 'empty' && !this.reserved(R, l) && !airborne(l));
    if (!open.length) return;
    const L = C.pick(open);
    content[L] = 'boost';
    this.lastBoost = k;
    this.boostLane = L;
  }

  /** Release rows pay out: a full coin line along the safe lane, sometimes a second one beside it (always in a peak hour). */
  breatherCoins(content, R, safe, s0, k, peak) {
    const lanes = [safe];
    const other = [0, 1, 2].filter((l) => l !== safe && content[l] === 'empty' && !this.reserved(R, l));
    if (other.length && Math.random() < (peak ? 1 : 0.5)) lanes.push(C.pick(other));
    for (const L of lanes) this.groundCoins(L, k, s0 + 1, s0 + C.SLOT - 1);
  }

  /**
   * Where a ground coin line in lane L of row k may start: in the combo lane of the row after a gate, past the hurdle
   * that can stand up to 7 m into this row, so no coin sits inside it and the landing is paid.
   */
  coinFrom(L, k, from) {
    return this.comboRow === k - 1 && L === this.comboLane ? Math.max(from, this.comboEnd + 6) : from;
  }

  /** A ground coin line along lane L, every 2 m. */
  groundCoins(L, k, from, to) {
    for (let s = this.coinFrom(L, k, from); s <= to; s += 2) this.coins.add(C.laneX(L), 0.9, s);
  }

  place(content, L, s0, k, diff, moveAdd = 0) {
    switch (content) {
      case 'train':
      case 'moving': {
        const moving = content === 'moving';
        const cars = moving ? 1 + (Math.random() < 0.5 ? 1 : 0)
          : 1 + (Math.random() < 0.55 + 0.3 * diff ? 1 : 0) + (Math.random() < 0.35 * diff ? 1 : 0);
        const tr = this.get('train');
        const len = tr.setup(cars, moving);
        const front = s0 + 2;
        const o = this.addObstacle('train', tr, L, front, len);
        if (moving) {
          o.moving = true;
          o.speed = 9 + 7 * diff + moveAdd;
          this.lastMoving = k;
        }
        this.busy[L] = k + Math.ceil((front + len - s0) / C.SLOT);
        return { front, len, moving };
      }
      case 'rampTrain': {
        const ramp = this.get('ramp');
        const rs = s0 + 2;
        this.addObstacle('ramp', ramp, L, rs, C.RAMP_LEN);
        const tr = this.get('train');
        const len = tr.setup(1 + (Math.random() < 0.55 ? 1 : 0), false);
        const front = rs + C.RAMP_LEN;
        this.addObstacle('train', tr, L, front, len);
        this.busy[L] = k + Math.ceil((front + len - s0) / C.SLOT);
        return { ramp: rs, front, len };
      }
      case 'pad': {
        const obj = this.get('pad');
        this.addObstacle('pad', obj, L, s0 + 6, 1.4);
        return { at: s0 + 6 };
      }
      case 'boost':
        this.addObstacle('boost', this.get('boost'), L, s0 + 4, C.BOOST_LEN);
        return { at: s0 + 4 };
      case 'combo': {
        // gate: roll under, then jump comboGap(s0) m later (14-22 m, scaled with speed so the take-off window stays
        // ~0.35 s); the hurdle can stand up to 7 m into the next row, whose combo lane stays clear of bars and pads
        const at2 = s0 + 5 + comboGap(s0);
        this.addObstacle('overhead', this.get('overhead'), L, s0 + 5, 0.12);
        this.addObstacle('hurdle', this.get('hurdle'), L, at2, 0.12);
        return { at: s0 + 5, at2 };
      }
      case 'hurdle':
      case 'overhead': {
        const obj = this.get(content);
        this.addObstacle(content, obj, L, s0 + 10, 0.12);
        return { at: s0 + 10 };
      }
      default:
        return null;
    }
  }

  placeCoins(content, info, blocked, safe, s0, k, prev, peak) {
    const co = this.coins, vm = peak ? PEAK.speed : 1; // arcs follow the hero's peak-hour speed
    // Roof rewards on plain parked trains.
    for (let L = 0; L < 3; L++) {
      const inf = info[L];
      const reach = content[L - 1] === 'rampTrain' || content[L + 1] === 'rampTrain' || (prev.padRow === k - 1 && prev.padLanes.includes(L));
      if (content[L] === 'train' && !inf.moving && reach && Math.random() < 0.45) {
        for (let s = inf.front + 1.5; s < inf.front + inf.len - 1; s += 2.4) co.add(C.laneX(L), C.TRAIN_TOP + 0.9, s);
      }
      if (content[L] === 'pad') {
        // a high arc of coins that only a spring launch can reach, on the launch's real ballistic path; it stops
        // before the fall so a landing on a following train roof still collects all of it
        arcCoins(co, C.laneX(L), inf.at - 0.45, C.PAD_JUMP_H, 0.06, 0.74, 7, false, vm);
      }
    }
    if (k < 1 || (!peak && Math.random() > 0.82)) return; // a peak hour always pays its coin line
    let lane = safe;
    if (Math.random() < 0.3) {
      const open = [0, 1, 2].filter((l) => !blocked[l] && content[l] !== 'body' && !this.reserved(this.reserve, l));
      if (open.length) lane = C.pick(open);
    }
    this.laneCoins(lane, content[lane], info[lane], s0, k, peak);
    if (peak && Math.random() < PEAK.coin2) {
      const free = [0, 1, 2].filter((l) => l !== lane && LINE_OK[content[l]] && !this.reserved(this.reserve, l));
      if (free.length) { const l2 = C.pick(free); this.laneCoins(l2, content[l2], info[l2], s0, k, peak); }
    }
  }

  /** The coin line that suits what lane L holds: up a ramp and over its train, an arc over a hurdle, under a sign, or flat. */
  laneCoins(lane, c, inf, s0, k, peak) {
    const co = this.coins, x = C.laneX(lane), vm = peak ? PEAK.speed : 1;
    if (c === 'rampTrain') {
      for (let s = inf.ramp + 0.8, n = 0; s < inf.front + inf.len - 1 && n < 14; s += 2.2, n++) {
        const h = s < inf.front ? C.clamp((s - inf.ramp) / C.RAMP_LEN, 0, 1) * C.TRAIN_TOP : C.TRAIN_TOP;
        co.add(x, h + 0.9, s);
      }
    } else if (c === 'hurdle') {
      arcCoins(co, x, inf.at, C.JUMP_H, 0.08, 0.92, 7, true, vm);
    } else if (c === 'overhead') {
      for (let s = s0 + 4; s <= s0 + 16; s += 2) co.add(x, 0.55, s);
    } else if (c === 'combo') {
      for (let s = inf.at - 4; s <= inf.at + 2; s += 2) co.add(x, 0.55, s);
      arcCoins(co, x, inf.at2, C.JUMP_H, 0.12, 0.88, 5, true, vm);
    } else if (c === 'empty' || c === 'boost') {
      this.groundCoins(lane, k, peak ? s0 + 1 : s0 + 3, peak ? s0 + 19 : s0 + 17); // a peak hour's lines run the whole row
    }
  }
}

/**
 * `n` coins along a jump of apex height `h` (GRAVITY physics, at the run speed of that stretch times `vm`), from
 * fraction `u0` to `u1` of the airtime. A launch pad throws the hero up at `s`; a hurdle hop is centred on the hurdle
 * at `s`. Coins sit 0.9 above the feet (the pickup box is centred there), so the whole line is caught in one jump.
 */
function arcCoins(co, x, s, h, u0, u1, n, centred = false, vm = 1) {
  const g = C.GRAVITY, vy = Math.sqrt(2 * g * h), ta = vy / g, T = ta + Math.sqrt(2 * h / (g * C.FALL_GRAVITY)), v = C.speedAt(s) * vm;
  for (let i = 0; i < n; i++) {
    const t = T * (u0 + (u1 - u0) * (i / (n - 1)));
    const feet = t <= ta ? vy * t - 0.5 * g * t * t : h - 0.5 * g * C.FALL_GRAVITY * (t - ta) ** 2;
    co.add(x, 0.9 + feet, s + v * (centred ? t - ta : t));
  }
}

Object.assign(Spawner.prototype, setPieces);
