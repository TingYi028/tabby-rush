import { SURGE_SPEED, SPEED_MULT_CAP, speedAt } from './config.js';

/*
 * 尖峰時段 (peak hour): a telegraphed, rewarded spike of PEAK.rows rows that starts PEAK.afterRoof rows after every
 * PEAK.roofEvery-th rooftop segment (setpieces.js) and is generated into the track like any other row rule
 * (spawner.js genSlot, director.js tuneRow), so the daily challenge stays identical for everyone.
 * This file only holds the numbers (config.js is its only import, so node can test it); main.js imports PEAK.speed.
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
};

/** Coins for surviving the i-th (0-based) peak hour of a run. */
export const peakBonus = (i) => Math.min(400, 100 + 50 * i);

/**
 * Metres before a peak hour starting at track position `from` where its 'warn' event fires: warnTime seconds at the
 * fastest the hero can be going there, speedAt x SPEED_MULT_CAP (frenzy x surge x peak at the cap; the curve only rises
 * towards `from`). A distance, so the daily challenge warns at the same place for everyone: ~108 m at the first peak
 * hour (~1 km) up to 144 m at the top speed, inside C.VIEW_AHEAD, so the span is generated before its warning is due.
 * The 0.1 s over the 2.2 s needed covers the frame the event waits for.
 */
export const peakWarn = (from) => Math.ceil(PEAK.warnTime * SPEED_MULT_CAP * speedAt(from));

/** Combo gate: metres from the sign (s0 + 5) to the hurdle, at row start s0: 0.42 s of a boost surge, 14..22 m. */
export const comboGap = (s0) => Math.min(22, Math.max(14, Math.round(0.42 * SURGE_SPEED * speedAt(s0 + 12))));
