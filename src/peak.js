import { SURGE_SPEED, SPEED_MULT_CAP, speedAt } from './config.js';

/*
 * 尖峰時段 (peak hour): a telegraphed, rewarded spike of PEAK.rows rows that starts PEAK.afterRoof rows after every
 * PEAK.roofEvery-th rooftop segment (setpieces.js) and is generated into the track like any other row rule
 * (spawner.js genSlot, director.js tuneRow), so the daily challenge stays identical for everyone.
 * This file only holds the numbers (config.js is its only import, so node can test it). The numbers differ by span: the
 * 1st peak hour of a run is the gentle one, later ones are denser and faster (r03 balance); peakParams(span) picks them.
 */

export const PEAK = {
  rows: 16,          // rows per peak hour (320 m)
  roofEvery: 2,      // after every 2nd rooftop segment (the 1st, 3rd, 5th ...)
  afterRoof: 4,      // rows after the segment's lead-out row where the peak hour starts
  warnTime: 2.3,     // s before the start of the 'warn' event at the highest run speed possible there (peakWarn; A5 wants >= 2.2)
  speed: 1.08,       // run-speed factor while the hero is inside a span (main.js, inside SPEED_MULT_CAP)
  diff: 0.9,         // difficulty floor in peak rows (not on breathers)
  trainAdd: 0.12,    // extra static-train chance per non-safe lane
  safeBar: 0.1,      // extra hurdle / sign chance in an unchanged safe lane
  safeMove: 0.6,     // safe-lane move chance per row (normal 0.4): more forced lane changes (spawner.js: the lane may also
                     // be one whose 1-row train just ended; without that, booked oncoming trains and dense trains cut moves by half)
  book: 0.85,        // oncoming-train booking chance per eligible row (normal 0.4 + 0.2 diff)
  bookGap: 2,        // rows since the last oncoming train before a new booking (normal: > 3)
  arm: 0.5,          // director.tuneRow: chance per row to arm one when the spawner's own booking did not (tunnels: 0.6)
  moveAdd: 4,        // m/s added to oncoming trains placed in a peak hour (normal 9 + 7 diff)
  coin2: 0.8,        // chance of a second ground coin line per non-breather row
  jetMargin: 60,     // m before the start where no jetpack is generated
  vacate: 0,         // chance that the lane a moving safe lane leaves takes a flat train (forced lane change; later peaks only)
  // 1st peak hour (idx 0): the casual wall of r02, now a fast, rich stretch instead: no difficulty floor, no extra
  // barriers or trains, the normal safe-lane walk and fewer oncoming bookings; keeps speed 1.08, the warning and the coins
  first: { diff: 0, safeBar: 0, safeMove: 0.4, trainAdd: 0, book: 0.5, bookGap: 3, arm: 0.3 },
  // later peak hours (idx >= 1): faster, fewer oncoming bookings so the lanes can carry more static trains, plus `vacate`
  later: { speed: 1.12, trainAdd: 0.25, book: 0.3, bookGap: 3, arm: 0, vacate: 0.9 },
};

const { first, later, ...BASE } = PEAK;
const P_FIRST = { ...BASE, ...first }, P_LATER = { ...BASE, ...later };

/** Numbers for peak span `p` (null / undefined = outside a peak hour): built once at import, no allocation per row. */
export const peakParams = (p) => (!p ? PEAK : p.idx === 0 ? P_FIRST : P_LATER);

/** Coins for surviving the i-th (0-based) peak hour of a run. */
export const peakBonus = (i) => Math.min(400, 100 + 50 * i);

/**
 * Metres before a peak hour starting at track position `from` where its 'warn' event fires: warnTime seconds at the
 * fastest the hero can be going there, speedAt x SPEED_MULT_CAP (frenzy x surge x peak at the cap; the curve only rises
 * towards `from`). A distance, so the daily challenge warns at the same place for everyone: ~108 m at the first peak
 * hour (~1 km) up to 166 m at the top speed (48 m/s), inside C.VIEW_AHEAD, so the span is generated before its warning is due.
 * The 0.1 s over the 2.2 s needed covers the frame the event waits for.
 */
export const peakWarn = (from) => Math.ceil(PEAK.warnTime * SPEED_MULT_CAP * speedAt(from));

/** Combo gate: metres from the sign (s0 + 5) to the hurdle, at row start s0: 0.42 s of a boost surge, 14..24 m. */
export const comboGap = (s0) => Math.min(24, Math.max(14, Math.round(0.42 * SURGE_SPEED * speedAt(s0 + 12))));
