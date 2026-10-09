// Shared tuning constants. Units are metres-ish; the hero is ~1.9 tall.
export const LANE_W = 2.6;
export const laneX = (lane) => (lane - 1) * LANE_W;

// Track layout
export const SLOT = 20;            // obstacle generator step along the track
export const START_GAP = 46;       // empty runway before the first slot
export const VIEW_AHEAD = 250;     // how far ahead content is spawned
export const PERIOD = 26.4;        // repeat length of the static track dressing (multiple of 1.1 and 8.8)
export const TRACK_BACK = 40;      // track dressing extends this far behind the camera
export const TRACK_LEN = 528;      // total length of static dressing (multiple of PERIOD)
export const SEG_LEN = 60;         // building / decal recycling segment
export const SEG_COUNT = 7;
export const WALL_X = 6.2;         // inner face of the retaining walls

// Trains
export const CAR_LEN = 12.5;
export const CAR_GAP = 0.7;
export const CAR_W = 2.3;
export const BODY_Y0 = 0.55;
export const BODY_H = 2.5;
export const ROOF_H = 0.32;
export const TRAIN_TOP = BODY_Y0 + BODY_H + ROOF_H;
export const RAMP_LEN = 7.5;

// Barriers
export const HURDLE_TOP = 1.05;
export const OVERHEAD_BOTTOM = 1.35;
export const OVERHEAD_TOP = 3.45;    // feet above this clear the beam

// Player
export const GRAVITY = 64;
export const FALL_GRAVITY = 1.12;  // gravity multiplier while falling (snappier landings)
export const JUMP_H = 2.15;
export const JUMP_H_SNEAKERS = 4.7;
export const STAND_H = 1.75;
export const ROLL_H = 0.85;
export const STEP_UP = 0.6;

// Pace
export const BASE_SPEED = 21;
export const MAX_SPEED = 42;
export const SPEED_RAMP = 1500;     // distance over which speed approaches MAX_SPEED
/** Run speed (m/s) at track distance s, before frenzy / surge multipliers: ~29 m/s after 30 s, ~37 after 90 s. */
export const LATE = { from: 3000, rate: 1, cap: 6 };   // m, m/s per km, m/s: +1 m/s per km after 3 km, 48 m/s from 9 km
export const speedAt = (s) => BASE_SPEED + (MAX_SPEED - BASE_SPEED) * (1 - Math.exp(-s / SPEED_RAMP))
  + Math.min(LATE.cap, Math.max(0, s - LATE.from) * LATE.rate / 1000);
export const POWER_TIME = { magnet: 10, sneakers: 10, x2: 14, jetpack: 5 };

// Thrills
export const JET_Y = 10.4;          // jetpack cruise height (above the gantries)
export const PAD_JUMP_H = 5.2;      // spring pad launch height (clears train roofs)
export const BOOST_LEN = 5.5;       // speed-boost strip length on the sleepers
export const SURGE_TIME = 3;        // speed surge after running over a boost strip
export const SURGE_SPEED = 1.25;
export const SPEED_MULT_CAP = 1.5;  // frenzy x surge never exceeds this
export const FEVER_TIME = 5.5;      // TABBY RUSH frenzy duration
export const FEVER_SPEED = 1.3;

export const rand = (a, b) => a + Math.random() * (b - a);
export const randi = (a, b) => Math.floor(rand(a, b + 1));
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const damp = (a, b, lambda, dt) => a + (b - a) * (1 - Math.exp(-lambda * dt));
