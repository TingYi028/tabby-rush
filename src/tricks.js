import * as C from './config.js';

/* Trick combos ("貓步三連"): clearing hurdles, rolling under signs and side-stepping train fronts. */

export const TRICK = {
  window: 4,              // seconds a chain stays alive after each trick
  cap: 5,                 // combo multiplier cap
  points: 50,             // × combo × totalMult()
  perfectPoints: 150,     // perfect jump / roll and grazes
  rush: 0.03,             // Rush gained per normal trick
  rushPerfect: 0.08,
  rushGraze: 0.14,
  rushTriple: 0.15,       // jump + roll + graze in one chain, once per chain
  slowmo: 0.22,           // perfect / graze only
  slowmoCooldown: 1.2,
  perfectJump: [1.05, 1.4],  // feet height above ground over the hurdle
  perfectRoll: [0.12, 0.3],  // seconds between starting the roll and reaching the sign
  graze: [0.2, 0.45],        // time-to-contact with the train front when leaving its lane
  nearMissTtc: 0.6,          // leaving a train's lane within this time-to-contact (or the old 8.5 / 16 m reach) is a near miss
};
export const TRICK_BIT = { jump: 1, roll: 2, graze: 4 };
export const TRICK_ALL = 7;
export const TRICK_LABEL = {
  jump: ['跳過！', '完美跳躍！'],
  roll: ['滾過！', '完美翻滾！'],
  graze: ['驚險閃過！', '擦身而過！'],
};

// Same hit boxes as the collision sweep in Player.update.
const PAD = 0.35;
const TRAIN_HALF = 1.15 + 0.3;
const BAR_HALF = 1.1 + 0.28;
const inRange = (v, [a, b]) => v >= a && v <= b;

/**
 * Watches the hero against the obstacles and pushes success events into the player's event list:
 *   {type:'clearHurdle', obstacle, perfect, height}  jumped (not spring-launched) over a hurdle
 *   {type:'clearOverhead', obstacle, perfect, lead}  rolled under an overhead sign
 *   {type:'nearmiss', obstacle, graze, ttc}          left a train's lane and then passed its front unharmed
 * Every obstacle instance counts once; smashed / crashed-into obstacles never count.
 */
export class TrickTracker {
  constructor() {
    this.launch = null;   // what put the hero in the air: 'jump' | 'pad' | 'jet' | null
    this.rollS = -1e9;    // track position where the current roll started
    this.trains = [];     // pending near-miss candidates
  }

  /** Lane change away from train `o` whose front is ahead: remember it, award once it is behind. */
  watchTrain(o, s, speed) {
    if (o._nm || o._nmPending) return;
    o._nmPending = true;
    const ttc = (o.s0 - s) / Math.max(1, speed + (o.moving ? o.speed : 0));
    this.trains.push({ o, ttc, t: 0 });
  }

  update(p, w, ev, dt, flying) {
    const s = w.dist, obs = w.spawner.obstacles;
    for (let i = 0; i < ev.length; i++) {
      const e = ev[i];
      if (e.type === 'jump') this.launch = 'jump';
      else if (e.type === 'pad') this.launch = 'pad';
      else if (e.type === 'roll') this.rollS = s;
      else if ((e.type === 'crash' || e.type === 'smash') && e.obstacle) e.obstacle._void = true;
      else if (e.type === 'stumble') this.trains.length = 0;
    }
    if (flying) this.launch = 'jet';
    else if (p.onGround) this.launch = null;

    // hurdles and overhead signs: sample while sweeping through the hit box, judge on leaving it
    if (!flying) {
      for (const o of obs) {
        if ((o.type !== 'hurdle' && o.type !== 'overhead') || o._trick || o._void) continue;
        const near = o.s0 - PAD, far = o.s0 + o.len + PAD;
        if (s < near || p.prevS > far) continue;
        let st = o._tk;
        if (!st || s <= far) {
          if (!st) st = o._tk = { minH: Infinity, aligned: true, rolling: true, air: true };
          st.minH = Math.min(st.minH, p.y - (o.y0 || 0)); // feet above the barrier's base (roof barriers: y0 > 0)
          st.aligned = st.aligned && Math.abs(p.x - o.x) < BAR_HALF;
          st.rolling = st.rolling && p.rollT > 0;
          st.air = st.air && !p.onGround;
        }
        if (s <= far) continue;
        o._trick = true;
        if (!st.aligned) continue;
        if (o.type === 'hurdle') {
          if (this.launch === 'jump' && st.air && st.minH >= C.HURDLE_TOP - 0.14) {
            ev.push({ type: 'clearHurdle', obstacle: o, perfect: inRange(st.minH, TRICK.perfectJump), height: st.minH });
          }
        } else if (st.rolling) {
          const lead = (o.s0 - this.rollS) / Math.max(1, w.speed);
          ev.push({ type: 'clearOverhead', obstacle: o, perfect: inRange(lead, TRICK.perfectRoll), lead });
        }
      }
    }

    // side-stepped train fronts: award once the hero is safely past the front
    for (let i = this.trains.length - 1; i >= 0; i--) {
      const c = this.trains[i], o = c.o;
      c.t += dt;
      let drop = o._nm || o._void || c.t > 4 || !obs.includes(o);
      if (!drop && s < o.s0) {
        // stepped back in front of it: not a dodge any more
        if (p.lane !== o.lane || Math.abs(p.x - o.x) >= TRAIN_HALF) continue;
        drop = true;
      }
      this.trains.splice(i, 1);
      if (drop) {
        if (!o._nm && !o._void) delete o._nmPending; // a later re-dodge of this train can still count
        continue;
      }
      o._nm = true;
      ev.push({ type: 'nearmiss', obstacle: o, graze: inRange(c.ttc, TRICK.graze), ttc: c.ttc });
    }
  }
}
