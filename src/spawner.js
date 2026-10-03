import * as C from './config.js';
import { Train, Ramp, Hurdle, Overhead, PowerUp, JumpPad } from './objects.js';

const FACTORY = { train: Train, ramp: Ramp, hurdle: Hurdle, overhead: Overhead, power: PowerUp, pad: JumpPad };
const POWER_WEIGHTS = [['magnet', 0.24], ['sneakers', 0.18], ['x2', 0.2], ['shield', 0.16], ['jetpack', 0.22]];

function weightedPower() {
  let r = Math.random();
  for (const [t, w] of POWER_WEIGHTS) { if ((r -= w) < 0) return t; }
  return 'magnet';
}

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
    this.pools = { train: [], ramp: [], hurdle: [], overhead: [], power: [], pad: [] };
    this.obstacles = [];
    this.powerups = [];
    this.reset(false);
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
    this.lastMoving = -99;
    this.nextPower = 5 + C.randi(0, 3);
    this.active = active;
  }

  get(kind) {
    const obj = this.pools[kind].pop() || new FACTORY[kind](this.mats);
    if (!obj.group.parent) this.root.add(obj.group);
    obj.group.visible = true;
    return obj;
  }

  release(kind, obj) {
    obj.group.visible = false;
    this.pools[kind].push(obj);
  }

  addObstacle(kind, obj, lane, s0, len, extra = {}) {
    const o = { kind, type: kind, obj, lane, x: C.laneX(lane), s0, len, moving: false, speed: 0, ...extra };
    obj.group.position.set(o.x, 0, -s0);
    obj.group.rotation.set(0, 0, 0);
    this.obstacles.push(o);
    return o;
  }

  /** Highest walkable surface under (x, s) that the hero can stand on from height y. */
  groundAt(x, s, y) {
    let g = 0;
    for (const o of this.obstacles) {
      if (o.type !== 'train' && o.type !== 'ramp') continue;
      if (Math.abs(x - o.x) > 1.22 || s < o.s0 - 0.3 || s > o.s0 + o.len + 0.3) continue;
      const top = o.type === 'train' ? C.TRAIN_TOP : C.clamp((s - o.s0) / C.RAMP_LEN, 0, 1) * C.TRAIN_TOP;
      if (y >= top - C.STEP_UP && top > g) g = top;
    }
    return g;
  }

  update(dt, dist) {
    const events = [];
    if (this.active) {
      while (C.START_GAP + this.k * C.SLOT < dist + C.VIEW_AHEAD) this.genSlot();
    }
    for (let i = this.obstacles.length - 1; i >= 0; i--) {
      const o = this.obstacles[i];
      if (o.moving) {
        o.s0 -= o.speed * dt;
        o.obj.group.position.z = -o.s0;
        if (!o.honked && o.s0 - dist < 95) { o.honked = true; events.push({ type: 'horn', lane: o.lane }); }
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
    return events;
  }

  /** Zig-zag coin trail in the sky for the jetpack. */
  addSkyCoins(from, to) {
    let lane = 1, s = from;
    while (s < to) {
      for (let i = 0; i < 7 && s < to; i++, s += 2.6) this.coins.add(C.laneX(lane), C.JET_Y + 1, s);
      lane = lane === 1 ? C.pick([0, 2]) : 1;
      s += 3;
    }
  }

  removePower(p) {
    this.release('power', p.obj);
    this.powerups.splice(this.powerups.indexOf(p), 1);
  }

  /** Remove an obstacle (shield smash) together with its attached ramp. */
  smash(o) {
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
    const diff = C.clamp(s0 / 3400, 0, 1);
    const prevBlocked = this.blocked[k - 1] || [false, false, false];

    const prevSafe = this.safe;
    // An oncoming train needs a clear lane next to an unchanging safe lane for the rows it sweeps through.
    if (!this.reserve && s0 > 360 && k - this.lastMoving > 6 && Math.random() < 0.28 + 0.2 * diff) {
      const cand = [prevSafe - 1, prevSafe + 1].filter((l) => l >= 0 && l <= 2 && this.busy[l] <= k);
      if (cand.length) this.reserve = { lane: C.pick(cand), until: k + 6 };
    }
    const R = this.reserve;
    let newSafe = prevSafe;
    if (!R && k > 1 && Math.random() < 0.32) {
      const cand = [prevSafe - 1, prevSafe + 1].filter((l) => l >= 0 && l <= 2 && this.busy[l] <= k && !prevBlocked[l]);
      if (cand.length) newSafe = C.pick(cand);
    }
    this.safe = newSafe;
    const safeSet = new Set([prevSafe, newSafe]);

    const content = ['empty', 'empty', 'empty'];
    const blocked = [false, false, false];
    for (let L = 0; L < 3; L++) {
      if (this.busy[L] > k) { content[L] = 'body'; blocked[L] = true; continue; }
      if (k < 2) continue;
      if (R && R.lane === L) {
        if (k >= R.until) { content[L] = 'moving'; this.reserve = null; }
        continue;
      }
      if (safeSet.has(L)) {
        if (prevSafe === newSafe && Math.random() < 0.16 + 0.2 * diff) content[L] = Math.random() < 0.5 ? 'hurdle' : 'overhead';
        continue;
      }
      const r = Math.random();
      if (r < 0.34 + 0.3 * diff) {
        content[L] = Math.random() < 0.38 ? 'rampTrain' : 'train';
      } else if (r < 0.52 + 0.25 * diff) {
        content[L] = Math.random() < 0.5 ? 'hurdle' : 'overhead';
      } else if (k > 3 && Math.random() < 0.3) {
        content[L] = 'pad';
      }
    }
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

    this.blocked[k] = blocked;

    const info = [null, null, null];
    for (let L = 0; L < 3; L++) info[L] = this.place(content[L], L, s0, k, diff);

    this.placeCoins(content, info, blocked, newSafe, s0, k);

    if (k >= this.nextPower) {
      const lanes = [0, 1, 2].filter((l) => content[l] === 'empty');
      if (lanes.length) {
        const L = C.pick(lanes);
        const obj = this.get('power');
        obj.setType(weightedPower());
        const p = { obj, x: C.laneX(L), y: 1.25, s: s0 + 14, type: obj.type, t: Math.random() * 6 };
        obj.group.position.set(p.x, p.y, -p.s);
        this.powerups.push(p);
        this.nextPower = k + 9 + C.randi(0, 6);
      }
    }
  }

  place(content, L, s0, k, diff) {
    switch (content) {
      case 'train':
      case 'moving': {
        const moving = content === 'moving';
        const cars = moving ? 1 + (Math.random() < 0.5 ? 1 : 0)
          : 1 + (Math.random() < 0.45 + 0.3 * diff ? 1 : 0) + (Math.random() < 0.2 * diff ? 1 : 0);
        const tr = this.get('train');
        const len = tr.setup(cars, moving);
        const front = s0 + 2;
        const o = this.addObstacle('train', tr, L, front, len);
        if (moving) {
          o.moving = true;
          o.speed = 8 + 4 * diff;
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

  placeCoins(content, info, blocked, safe, s0, k) {
    const co = this.coins;
    // Roof rewards on plain parked trains.
    for (let L = 0; L < 3; L++) {
      const inf = info[L];
      if (content[L] === 'train' && !inf.moving && Math.random() < 0.3) {
        for (let s = inf.front + 1.5; s < inf.front + inf.len - 1; s += 2.4) co.add(C.laneX(L), C.TRAIN_TOP + 0.9, s);
      }
      if (content[L] === 'pad') {
        // a high arc of coins that only a spring launch can reach
        for (let i = 1; i <= 8; i++) co.add(C.laneX(L), 1.2 + 4.8 * Math.sin((i / 9) * Math.PI), inf.at + i * 3.2);
      }
    }
    if (k < 1 || Math.random() > 0.82) return;
    let lane = safe;
    if (Math.random() < 0.3) {
      const open = [0, 1, 2].filter((l) => !blocked[l] && content[l] !== 'body');
      if (open.length) lane = C.pick(open);
    }
    const x = C.laneX(lane), c = content[lane], inf = info[lane];
    if (c === 'rampTrain') {
      for (let s = inf.ramp + 0.8, n = 0; s < inf.front + inf.len - 1 && n < 14; s += 2.2, n++) {
        const h = s < inf.front ? C.clamp((s - inf.ramp) / C.RAMP_LEN, 0, 1) * C.TRAIN_TOP : C.TRAIN_TOP;
        co.add(x, h + 0.9, s);
      }
    } else if (c === 'hurdle') {
      for (let i = -3; i <= 3; i++) {
        const t = i / 3.6;
        co.add(x, 0.9 + Math.max(0, 1.9 * (1 - t * t)), inf.at + i * 2.1);
      }
    } else if (c === 'overhead') {
      for (let s = s0 + 4; s <= s0 + 16; s += 2) co.add(x, 0.55, s);
    } else if (c === 'empty') {
      for (let s = s0 + 3; s <= s0 + 17; s += 2) co.add(x, 0.9, s);
    }
  }
}
