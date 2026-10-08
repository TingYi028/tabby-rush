import * as C from './config.js';
import { PLACES, placeAt } from './themes.js';

/*
 * Zone director: schedules the dark-tunnel set pieces along the track (in track distance s, so the
 * generator ~250 m ahead and the visuals at the hero agree) and tunes each generated row for the
 * place / tunnel it falls in. Spawner calls tuneRow() once per row (a one-line hook).
 */

export const TUNNEL = {
  first: 700,      // first tunnel entrance (m), plus 0..40 m jitter
  every: 900,      // spacing between entrances, ± jitter
  jitter: 60,
  len: 160,        // tunnel length (m)
  moving: 0.6,     // chance per row to arm an oncoming train that meets the hero inside a tunnel
  movingGap: 2,    // min rows after the last oncoming train before arming another (spawner's own rule: 7)
};

const starts = [];   // tunnel entrances for this run, ascending
let rnd = Math.random;

/**
 * New run: a fresh, randomly jittered tunnel schedule. It draws from its own generator, seeded once here from the
 * caller's Math.random (the daily seed inside spawner.seeded), so planning ahead from the per-frame zone check never
 * consumes or depends on the track generator's numbers: a daily track is the same for everyone, all the way.
 */
export function resetDirector() {
  starts.length = 0;
  let a = (Math.random() * 4294967296) >>> 0;
  rnd = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function plan(upTo) {
  while (!starts.length || starts[starts.length - 1] < upTo) {
    const n = starts.length;
    starts.push(n ? starts[n - 1] + TUNNEL.every + (rnd() * 2 - 1) * TUNNEL.jitter : TUNNEL.first + rnd() * 40);
  }
}

/** Entrance of the tunnel covering track position s (widened by `pad` metres each side; negative shrinks), or -1. */
export function tunnelAt(s, pad = 0) {
  plan(s + TUNNEL.len + Math.abs(pad));
  for (let i = 0; i < starts.length; i++) {
    const t = starts[i];
    if (s < t - pad) return -1;
    if (s <= t + TUNNEL.len + pad) return t;
  }
  return -1;
}

export const inTunnel = (s, pad = 0) => tunnelAt(s, pad) >= 0;

/** Entrance of the tunnel the hero is in or approaching: the first whose exit + `after` metres is still ahead of s. */
export function nextTunnel(s, after = 0) {
  plan(s + TUNNEL.every + TUNNEL.len);
  for (let i = 0; i < starts.length; i++) if (starts[i] + TUNNEL.len + after > s) return starts[i];
  return -1;
}

/* ---------- generator hook ---------- */

const TRAINISH = { train: true, rampTrain: true, moving: true, body: true };

/** Same rule as the spawner's fairness pass: every lane open in the previous row reaches an open lane sideways. */
function fair(prevBlocked, content, blocked) {
  for (let A = 0; A < 3; A++) {
    if (prevBlocked[A] || content[A] === 'body') continue;
    let lo = A, hi = A;
    while (lo > 0 && !prevBlocked[lo - 1]) lo--;
    while (hi < 2 && !prevBlocked[hi + 1]) hi++;
    let ok = false;
    for (let B = lo; B <= hi; B++) if (!blocked[B]) ok = true;
    if (!ok) return false;
  }
  return true;
}

/**
 * Called by Spawner.genSlot after the fairness / breather / boost passes, before the row is placed.
 * Mutates the row's `content` / `blocked` lanes in place and may arm the next oncoming train (sp.reserve).
 *  - tunnel rows: no spring pads or boost strips; ramped trains become flat trains when that stays fair
 *  - more oncoming trains timed to meet the hero inside a tunnel, and in zones with spawn.moving
 *  - zones with spawn.barriers get extra hurdles / overhead signs in free side lanes
 *  - `dense` (the peak.js numbers of the span, for a peak-hour row outside a tunnel; false otherwise): oncoming trains
 *    armed with its `arm` chance, at its `bookGap` spacing
 */
export function tuneRow(sp, k, s0, content, blocked, prevBlocked, breather, dense) {
  const spawn = PLACES[placeAt(s0)].spawn;

  // the row's obstacles sit at s0+2 .. s0+20; keep a short run-up before the portal clean too
  if (inTunnel(s0 + C.SLOT / 2, C.SLOT / 2 + 6)) {
    for (let L = 0; L < 3; L++) if (content[L] === 'pad' || content[L] === 'boost') content[L] = 'empty';
    for (let L = 0; L < 3; L++) {
      if (content[L] !== 'rampTrain' || (sp.lastBoost === k - 1 && sp.boostLane === L) || (sp.padRow === k - 1 && sp.padLanes.includes(L))) continue;
      content[L] = 'train';
      blocked[L] = true;
      if (!fair(prevBlocked, content, blocked)) { content[L] = 'rampTrain'; blocked[L] = false; }
    }
  }

  if (spawn.barriers > 0 && !breather && k > 3) {
    const tunnelRow = inTunnel(s0 + C.SLOT / 2, C.SLOT / 2 + 6);
    for (let L = 0; L < 3; L++) {
      if (content[L] !== 'empty' || L === sp.safe || sp.reserved(sp.reserve, L) || (sp.comboRow === k - 1 && sp.comboLane === L)) continue;
      // only ~0.2 eligible lanes per row late in a run, so this adds about `barriers` × the base ~0.47 barriers per row
      if (Math.random() < spawn.barriers * 2.6) {
        const kind = Math.random() < 0.5 ? 'hurdle' : 'overhead';
        content[L] = sp.padsOnly ? (tunnelRow ? 'empty' : 'pad') : kind;
      }
    }
  }

  // Arm an oncoming train for the next row (same shape as the spawner's own reservation: 6 clear rows,
  // then the train). It spawns ~142 m past this row and meets the hero roughly 70 m before that.
  // The spawner spaces oncoming trains >= 13 rows apart, so a higher rate also needs a shorter gap.
  let extra = spawn.moving, gap = spawn.movingGap || 6;
  if (inTunnel(s0 + 72, -12)) { extra = Math.max(extra, TUNNEL.moving); gap = Math.min(gap, TUNNEL.movingGap); }
  if (dense) { extra = Math.max(extra, dense.arm); gap = Math.min(gap, dense.bookGap); }
  if (extra <= 0 || sp.reserve || s0 + C.SLOT <= 360 || k + 1 - sp.lastMoving <= gap) return;
  if (content[0] === 'moving' || content[1] === 'moving' || content[2] === 'moving') return;
  if (Math.random() >= extra) return;
  const a = sp.safe - 1, b = sp.safe + 1;
  const okA = a >= 0 && sp.busy[a] <= k + 1 && !TRAINISH[content[a]];
  const okB = b <= 2 && sp.busy[b] <= k + 1 && !TRAINISH[content[b]];
  if (okA || okB) sp.reserve = { lane: okA && okB ? (Math.random() < 0.5 ? a : b) : okA ? a : b, until: k + 7 };
}
