import * as C from './config.js';
import { LaneArrows, ARROW_SPACING } from './objects.js';
import { PEAK, peakBonus, peakWarn } from './peak.js';

/*
 * Set pieces, mixed into Spawner.prototype (hooks: reset, update, smash, genSlot in spawner.js).
 *
 * Lane-switching oncoming trains ("swerve"): an oncoming-train booking made while the safe lane is an
 * edge lane may instead reserve BOTH other lanes; the train spawns in the far edge lane and, ~45 m
 * before reaching the hero, slides into the middle lane, which stays next to the unchanged safe lane.
 * Telegraphed ~1 s ahead by blinking amber arrows on the middle lane's sleepers plus an extra horn.
 *
 * Rooftop parkour: roughly every ROOF.every metres, a clear lead-in row, then ROOF.rows rows where all
 * three lanes are long parked trains with 5-8 m jumpable gaps, hurdles / signs standing on the roofs
 * (obstacle.y0 = TRAIN_TOP) and coin trails, entered by a ramp in the safe lane; then a clear lead-out
 * row and the normal wave resumes. The gate / breather / booking logic never runs inside it.
 *
 * Peak hour (尖峰時段, numbers in peak.js): after every 2nd rooftop segment, PEAK.rows denser rows (spawner.js genSlot,
 * director.js tuneRow) and a speed factor for the hero (main.js, via peakAt). Anchored to the rooftop schedule, so
 * the two never overlap; telegraphed by the 'peak' events (warn / start / clear) from updateSigns.
 */

export const SWERVE = {
  after: 650,      // m: no swerving trains before this
  chance: 0.45,    // share of eligible oncoming-train bookings that swerve
  at: 45,          // m between the front and the hero when the swerve starts...
  minTtc: 1.2,     // ...or this many seconds of closing time, whichever is further
  warn: 1.2,       // s of arrows + horn before the swerve starts
  dur: 0.5,        // s to cross into the next lane
  lean: 0.06,      // rad of yaw at mid-swerve (the nose leads, the tail lags)
};

export const ROOF = {
  first: 800,      // m: the first rooftop segment starts about here
  every: 800,      // m between segment starts
  rows: 6,         // segment length in rows
  quiet: 140,      // m before a segment where no new oncoming train is booked (so it can't delay the segment)
  gapMin: 5,       // m between consecutive trains in a lane; a normal jump covers ~9 m even at base speed
  gapMax: 8,
  slack: 14,       // every lane's last train ends within this many metres of the segment end
  barFront: 14,    // m: roof hurdles / signs at least this far behind a train's front...
  barEnd: 8,       // ...and ahead of its end; more next to gaps, scaled with speed (see barWindow)
  barChance: 0.75, // per train with room for an obstacle
  bar2Chance: 0.5, // second obstacle on a train with room for two
  barSpacing: 15,
  hurdleShare: 0.65, // first pick; falls back to a sign where a hurdle won't fit at this speed
  coinStep: 2.5,
  extraTrail: 0.55, // chance of a coin trail in each lane besides the entrance lane
};

const carsLen = (n) => n * C.CAR_LEN + (n - 1) * C.CAR_GAP;
const rowOf = (s) => Math.floor((s - C.START_GAP) / C.SLOT);
// spawner.js wave: 8-row cycle with the gate on row 5 (WAVE / GATE_ROW there)
const WAVE_LEN = 8, GATE_ROW = 5;
/** Run speed at track position s (same curve as main.js), with a boost-strip surge on top as the worst case. */
const planSpeed = (s) => C.SURGE_SPEED * C.speedAt(s);

/**
 * Where a roof barrier of `kind` may stand on train `tr` (gap before / after it in metres, 0 = none) at speed v.
 * A normal jump stays above roof level for ~0.505 s (0.505 v metres). Hurdles: a late gap jump (coyote time
 * included) must land at least 0.15 s before the hurdle, and a hurdle hop must land 0.2 s before the next gap.
 * Signs: roll-slam in the air works right after a gap; after rolling under, the gap jump needs ~0.35 s of roof.
 */
function barWindow(kind, tr, gapBefore, gapAfter, v) {
  let front = ROOF.barFront, end = ROOF.barEnd;
  if (kind === 'hurdle') {
    if (gapBefore) front = Math.max(front, 0.745 * v + 0.3 - gapBefore);
    if (gapAfter) end = Math.max(16, 0.605 * v);
  } else if (gapAfter) end = Math.max(10, 0.35 * v);
  return [tr.s + front, tr.s + tr.len - end];
}

/** Train lengths and gaps filling `avail` metres: at least two trains, ending within ROOF.slack of the end. */
function fitTrains(avail) {
  for (let n = 0; n < 80; n++) {
    const seq = [];
    let tot = 0;
    for (;;) {
      const opts = [2, 3, 3, 4, 4].filter((c) => tot + carsLen(c) <= avail);
      if (!opts.length) break;
      const cars = C.pick(opts);
      seq.push({ cars, len: carsLen(cars), gap: 0 });
      tot += carsLen(cars);
      const gap = C.rand(ROOF.gapMin, ROOF.gapMax);
      if (tot + gap + carsLen(2) > avail) break;
      seq[seq.length - 1].gap = gap;
      tot += gap;
    }
    if (seq.length >= 2 && tot >= avail - ROOF.slack) return seq;
  }
  const L4 = carsLen(4);
  return [{ cars: 4, len: L4, gap: C.clamp(avail - 2 * L4, ROOF.gapMin, ROOF.gapMax) }, { cars: 4, len: L4, gap: 0 }];
}

/** Coin trail along one lane of a rooftop segment: up the ramp, along the roofs, arcs over gaps and hurdles. */
function roofCoins(lane, from, L, out) {
  const x = C.laneX(L), T = C.TRAIN_TOP, tr = lane.trains, last = tr[tr.length - 1];
  for (let s = from; s <= last.s + last.len - 1; s += ROOF.coinStep) {
    let y = T + 0.9;
    if (lane.ramp !== null && s < lane.ramp + C.RAMP_LEN) y = C.clamp((s - lane.ramp) / C.RAMP_LEN, 0, 1) * T + 0.9;
    for (let i = 0; i + 1 < tr.length; i++) {
      const a = tr[i].s + tr[i].len - 3, b = tr[i + 1].s + 2;
      if (s > a && s < b) y = T + 0.9 + 2 * Math.sin((Math.PI * (s - a)) / (b - a));
    }
    for (const bar of lane.bars) {
      const d = s - bar.s;
      if (bar.kind === 'hurdle' && Math.abs(d) < 5) y = T + 0.9 + 1.9 * Math.cos((d / 5) * (Math.PI / 2));
      else if (bar.kind === 'overhead' && Math.abs(d) < 4.5) y = T + 0.55;
    }
    out.push({ x, y, s });
  }
}

export const setPieces = {
  resetSetPieces() {
    if (!this.signs) {
      this.signs = [];
      this.arrowPool = [];
      this.releaseArrows(this.makeArrows()); // pre-built (hidden) so the boot shader warm-up compiles its materials
    }
    for (const sg of this.signs) this.releaseArrows(sg.obj);
    this.signs.length = 0;
    this.pace = 0;          // hero speed, measured from dist steps (for the swerve timing)
    this.lastDist = null;
    this.roof = null;       // rooftop segment being generated
    this.nextRoof = ROOF.first;
    this.roofSeq = 0;
    this.roofSpans = [];    // {from, to, announced} track spans of generated segments
    this.nextPeak = Infinity; // track position where the next peak hour opens (set at a rooftop lead-out)
    this.peakSpans = [];    // {idx, from, to, warnAt, warned, started, cleared} generated peak hours still near the hero
    this.peakCount = 0;     // peak hours generated this run (debug)
  },

  /** Lane `l` is kept clear for a booked oncoming train (its own lane, or the lane it will swerve into). */
  reserved(R, l) {
    return !!R && (R.lane === l || R.to === l);
  },

  /** Is track position `s` inside a rooftop segment (lead-in / lead-out rows included)? For other set pieces. */
  inRoof(s) {
    if (this.roof && s >= this.roof.start - C.SLOT) return true;
    return this.roofSpans.some((r) => s >= r.from - C.SLOT && s < r.to + C.SLOT);
  },

  /** Is track position `s` inside a generated peak hour? Per frame in main.js (the hero's speed factor): no allocation. */
  peakAt(s) {
    for (let i = 0; i < this.peakSpans.length; i++) if (s >= this.peakSpans[i].from && s < this.peakSpans[i].to) return true;
    return false;
  },

  /** No jetpack from PEAK.jetMargin before a peak hour (pending or generated) to its end: it would fly over all of it. */
  peakNoJet(s) {
    if (s >= this.nextPeak - PEAK.jetMargin) return true;
    for (let i = 0; i < this.peakSpans.length; i++) if (s >= this.peakSpans[i].from - PEAK.jetMargin && s < this.peakSpans[i].to) return true;
    return false;
  },

  /** genSlot: the row at s0 (>= nextPeak, not a rooftop row) opens the scheduled peak hour. */
  openPeak(s0) {
    this.peakSpans.push({ idx: this.peakCount++, from: s0, to: s0 + PEAK.rows * C.SLOT, warnAt: s0 - peakWarn(s0), warned: false, started: false, cleared: false });
    this.nextPeak = Infinity;
  },

  trackPace(dt, dist) {
    if (dt > 0 && this.lastDist !== null) this.pace = Math.max(0, (dist - this.lastDist) / dt);
    this.lastDist = dist;
  },

  /* ---------- lane-switching oncoming trains ---------- */

  /** Runs right after the oncoming-train booking in genSlot: maybe turn a fresh booking into a swerve. */
  planSwerve(k, s0, prevSafe) {
    const R = this.reserve;
    if (!R || R.until !== k + 6 || R.to !== undefined) return; // only a booking made in this row
    if (s0 >= this.nextRoof - ROOF.quiet) { this.reserve = null; return; } // keep the run-up to a rooftop segment free
    if (s0 < SWERVE.after || prevSafe === 1 || Math.random() >= SWERVE.chance) return;
    // Safe lane at one edge: the train comes down the other edge and swerves into the middle lane,
    // which stays next to the (unchanging) safe lane. Both lanes stay clear of static obstacles until it spawns.
    const from = 2 - prevSafe, to = 1;
    if (this.busy[from] > k || this.busy[to] > k) return;
    this.reserve = { lane: from, to, until: R.until };
  },

  /** After placement in the spawn row: arm the swerve on the oncoming train just placed. */
  armSwerve(R, content, s0) {
    if (!R || R.to === undefined || content[R.lane] !== 'moving') return;
    for (let i = this.obstacles.length - 1; i >= 0; i--) {
      const o = this.obstacles[i];
      if (o.moving && o.lane === R.lane && Math.abs(o.s0 - (s0 + 2)) < 1e-6) {
        o.swerve = { from: R.lane, to: R.to, x0: o.x, x1: C.laneX(R.to), t: -1, warned: false, done: false };
        return;
      }
    }
  },

  /** Per-frame swerve driver for one oncoming train (called from Spawner.update). */
  swerveStep(o, dt, dist, events) {
    const sw = o.swerve;
    if (sw.done) return;
    const ahead = o.s0 - dist;
    const close = Math.max(1, this.pace + o.speed);
    const at = Math.max(SWERVE.at, close * SWERVE.minTtc);
    if (!sw.warned && ahead <= at + close * SWERVE.warn) {
      sw.warned = true;
      events.push({ type: 'swerve', lane: sw.to, from: sw.from });
      this.showArrows(o, o.s0 - o.speed * Math.max(0, (ahead - at) / close));
    }
    if (sw.t < 0) {
      if (ahead > at) return;
      sw.t = 0;
    }
    sw.t += dt;
    const u = C.clamp(sw.t / SWERVE.dur, 0, 1), e = u * u * (3 - 2 * u);
    o.x = sw.x0 + (sw.x1 - sw.x0) * e;
    o.obj.group.position.x = o.x;
    o.obj.group.rotation.y = SWERVE.lean * Math.sign(sw.x1 - sw.x0) * Math.sin(Math.PI * u);
    // collisions, near misses, pass events and the danger warning all follow o.lane
    if (u >= 0.5) o.lane = sw.to;
    if (u >= 1) { sw.done = true; o.obj.group.rotation.y = 0; }
  },

  /** Four arrows on the target lane, ending just short of where the nose will cross over (at `sNose`). */
  showArrows(o, sNose) {
    const obj = this.arrowPool.pop() || this.makeArrows();
    obj.group.visible = true;
    obj.setDir(o.swerve.x1 - o.swerve.x0);
    obj.group.position.set(o.swerve.x1, 0, -(sNose - 2 - 3 * ARROW_SPACING));
    this.signs.push({ obj, o, after: 0 });
  },

  makeArrows() {
    const obj = new LaneArrows(this.mats);
    this.root.add(obj.group);
    return obj;
  },

  releaseArrows(obj) {
    obj.group.visible = false;
    this.arrowPool.push(obj);
  },

  /** End of Spawner.update: retire arrows, announce rooftop segments and peak hours. */
  updateSigns(dt, dist, events) {
    for (let i = this.signs.length - 1; i >= 0; i--) {
      const sg = this.signs[i];
      if (sg.o.swerve.done) sg.after += dt;
      if (sg.after < 0.4 && this.obstacles.includes(sg.o)) continue;
      this.releaseArrows(sg.obj);
      this.signs.splice(i, 1);
    }
    for (let i = this.roofSpans.length - 1; i >= 0; i--) {
      const r = this.roofSpans[i];
      if (!r.announced && dist >= r.from - 70) { r.announced = true; events.push({ type: 'setpiece', name: 'roof' }); }
      if (r.to + C.SLOT < dist - 20) this.roofSpans.splice(i, 1);
    }
    for (let i = this.peakSpans.length - 1; i >= 0; i--) {
      const p = this.peakSpans[i];
      if (!p.warned && dist >= p.warnAt) { p.warned = true; events.push({ type: 'peak', phase: 'warn', idx: p.idx }); }
      if (!p.started && dist >= p.from) { p.started = true; events.push({ type: 'peak', phase: 'start', idx: p.idx }); }
      if (!p.cleared && dist >= p.to) { p.cleared = true; events.push({ type: 'peak', phase: 'clear', idx: p.idx, bonus: peakBonus(p.idx) }); }
      if (p.to + 40 < dist) this.peakSpans.splice(i, 1);
    }
  },

  /* ---------- rooftop parkour ---------- */

  /**
   * genSlot hook (before anything else in the row). Returns true when the row was generated here:
   * approach rows (no new obstacles until every train body has ended), the lead-in row, the segment rows
   * and the lead-out row.
   */
  setPieceRow(k, s0) {
    if (this.roof) { this.roofRow(this.roof, k, s0); return true; }
    if (s0 < this.nextRoof - C.SLOT || this.reserve || this.peakAt(s0)) return false; // never inside a peak hour
    const blocked = [0, 1, 2].map((L) => this.busy[L] > k);
    this.blocked[k] = blocked;
    if (blocked.some(Boolean)) {
      // approach: open track (trains already on it run out), coins in the safe lane
      this.groundCoins(this.safe, k, s0 + 3, s0 + 17);
      return true;
    }
    this.planRoof(k, s0);
    return true;
  },

  /** Lead-in row k: lay out the whole segment (placed row by row as the generator reaches it). */
  planRoof(k, s0) {
    const S = this.safe, start = s0 + C.SLOT, end = start + ROOF.rows * C.SLOT, v = planSpeed(end);
    const id = ++this.roofSeq, items = [], lanes = [], coins = [];
    for (let L = 0; L < 3; L++) {
      const first = start + 2 + (L === S ? C.RAMP_LEN : 0);
      if (L === S) items.push({ s: start + 2, kind: 'ramp', L });
      const trains = [];
      let s = first;
      for (const t of fitTrains(end - 1 - first)) {
        const it = { s, kind: 'train', L, cars: t.cars, len: t.len, gap: t.gap, o: null, next: null };
        if (trains.length) trains[trains.length - 1].next = it;
        items.push(it);
        trains.push(it);
        s += t.len + t.gap;
      }
      const bars = [];
      trains.forEach((tr, i) => {
        const gapBefore = i ? trains[i - 1].gap : 0;
        let from = -Infinity;
        for (let n = 0; n < 2 && !this.padsOnly && Math.random() < (n ? ROOF.bar2Chance : ROOF.barChance); n++) {
          let kind = Math.random() < ROOF.hurdleShare ? 'hurdle' : 'overhead';
          let [a, b] = barWindow(kind, tr, gapBefore, tr.gap, v);
          if (Math.max(a, from) > b) {
            kind = kind === 'hurdle' ? 'overhead' : 'hurdle';
            [a, b] = barWindow(kind, tr, gapBefore, tr.gap, v);
          }
          a = Math.max(a, from);
          if (a > b) break;
          // leave room for a second one when there is some
          const sAt = C.rand(a, n === 0 && b - a >= ROOF.barSpacing ? b - ROOF.barSpacing : b);
          const bar = { s: sAt, kind, L, on: tr };
          items.push(bar);
          bars.push(bar);
          // after a hurdle hop the hero needs to be back on the roof before the next barrier, as before a gap
          from = sAt + (kind === 'hurdle' ? Math.max(ROOF.barSpacing, 0.605 * v + 2) : ROOF.barSpacing);
        }
      });
      lanes.push({ trains, bars, ramp: L === S ? start + 2 : null });
    }
    // coin trails: always up the entrance ramp (starting in the lead-in row), sometimes along the other lanes
    for (let L = 0; L < 3; L++) {
      if (L === S) roofCoins(lanes[L], this.coinFrom(L, k, start - 14), L, coins); // (not through a combo hurdle left over from row k - 1)
      else if (Math.random() < ROOF.extraTrail) roofCoins(lanes[L], lanes[L].trains[0].s + 1.5, L, coins);
    }
    items.sort((a, b) => a.s - b.s);
    coins.sort((a, b) => a.s - b.s);
    this.roof = { id, k0: k, S, start, end, items, coins, lanes };
    this.roofSpans.push({ from: start, to: end, announced: false });
    this.blocked[k] = [false, false, false];
    this.flushRoof(this.roof, start);
  },

  /** Segment rows: place what falls in the row. Only the ramp lane is open (at ground level) in the first one. */
  roofRow(P, k, s0) {
    const j = k - P.k0;
    if (j <= ROOF.rows) {
      this.blocked[k] = [0, 1, 2].map((L) => !(j === 1 && L === P.S));
      this.flushRoof(P, s0 + C.SLOT);
      return;
    }
    // lead-out: an open row to drop back onto the tracks; the normal wave resumes on the next row
    // (one more open row if that would be a gate, so the landing never runs straight into one)
    this.flushRoof(P, Infinity);
    this.blocked[k] = [0, 1, 2].map((L) => this.busy[L] > k);
    for (let s = s0 + 3; s <= s0 + 17; s += 2) this.coins.add(C.laneX(P.S), 0.9, s);
    if ((k + 1) % WAVE_LEN === GATE_ROW) return;
    this.roof = null;
    this.nextRoof = P.start + ROOF.every;
    if (P.id % PEAK.roofEvery === 1) this.nextPeak = s0 + PEAK.afterRoof * C.SLOT; // the 1st, 3rd, 5th ... segment
  },

  flushRoof(P, upto) {
    while (P.items.length && P.items[0].s < upto) {
      const it = P.items.shift();
      if (it.kind === 'ramp') {
        this.addObstacle('ramp', this.get('ramp'), it.L, it.s, C.RAMP_LEN);
      } else if (it.kind === 'train') {
        const tr = this.get('train');
        const len = tr.setup(it.cars, false);
        it.o = this.addObstacle('train', tr, it.L, it.s, len, { roof: P.id, item: it });
        this.busy[it.L] = Math.max(this.busy[it.L], rowOf(it.s + len) + 1);
      } else if (it.on.o) {
        // hurdles and signs standing on a roof: meshes and hit tests are offset by y0
        this.addObstacle(it.kind, this.get(it.kind), it.L, it.s, 0.12, { y0: C.TRAIN_TOP, on: it.on.o });
      }
    }
    while (P.coins.length && P.coins[0].s < upto) {
      const c = P.coins.shift();
      this.coins.add(c.x, c.y, c.s);
    }
  },

  /**
   * Spawner.smash hook: obstacles standing on a smashed train go with it, and a rooftop train smashed from
   * the tracks (shield / frenzy after missing a gap) gets a rescue ramp up to the next train in its lane.
   */
  roofSmash(o) {
    for (let i = this.obstacles.length - 1; i >= 0; i--) {
      const q = this.obstacles[i];
      if (q.on === o) { this.release(q.kind, q.obj); this.obstacles.splice(i, 1); }
    }
    const nx = o.item && o.item.next && o.item.next.o;
    if (!nx || !this.obstacles.includes(nx)) return;
    if (this.obstacles.some((q) => q.type === 'ramp' && q.lane === nx.lane && Math.abs(q.s0 + q.len - nx.s0) < 0.1)) return;
    this.addObstacle('ramp', this.get('ramp'), nx.lane, nx.s0 - C.RAMP_LEN, C.RAMP_LEN);
  },
};
