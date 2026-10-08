import * as C from './config.js';
import { store } from './audio.js';
import { MetaUI, NAMES } from './progression-ui.js';
import { DAILY, dailyStatus, dailyToday, rewardFor as dailyReward } from './daily.js';

/*
 * Meta progression ("reasons to play again"): one versioned save, the coin shop and missions.
 *
 * Save, localStorage `tabbyrush.save` (via `store`; everything still works in memory without storage):
 *   { v: 2, rev, bank, best,                                   // rev: write counter, see persist()
 *     upg: { magnet, sneakers, x2, jetpack, shield },        // shop levels
 *     missions: { lvl, skipDay, focus (pinned mission id), rev, slots: [{ id, goal, prog, done }] x3 },
 *     stats: { runs, coins, dist, missions, spent, bestCoins, bestDist, missionCoins, sets, pins },
 *     recent: [[dist, coins, score] x up to 10],              // last finished runs: the pace that sizes new goals
 *     mig: { jet, sets } }                                    // one-off migrations already applied
 * v1 saves load unchanged (the sanitizer ignores `v`): unknown mission ids are dropped, missing fields default,
 * and `missions.rev` < MISSION_REV re-scales the open missions to the current goal table keeping their progress ratio.
 * The first load migrates the old `tabbyrush.best` / `tabbyrush.bank` keys; those keys stay mirrored.
 * Mission level is earned one finished set at a time: a save with `missions.lvl` above `stats.sets` is clamped to it
 * (saves from before `sets` was counted have no such key and keep their level; so do saves of the r02 beta, which wrote
 * `sets: 0` without the `mig.sets` flag: they get `sets = max(sets, lvl)` once, see sanitize()).
 * Two tabs: every write bumps `rev`; a tab whose copy is older than the stored one never overwrites it, it reloads the
 * stored save instead and lays what it did itself since its last read / write on top: the coin change (earned minus
 * spent) and, after a finished run, the run's stats and mission progress (persist(), catchUp(), adopt(), replayRun()).
 * main.js keeps G.best / G.bank as the live values: every save reads them back from G (sync()).
 *
 * Missions: a set is three missions of different kinds (a single-run performance goal, a cumulative goal and a
 * skill goal; the very first set is fixed). Each mission pays coins when it completes (tier x level scale) and
 * the set pays a bonus; all three done = mission level +1 (start multiplier +1 up to MAX_BONUS) and a fresh set.
 *
 * Hooks called from main.js: init, startRun, frame, track, trick, pause, endRun, menu,
 * powerTime / powerMax (power-up durations), multBonus (mission level score bonus).
 */

const VERSION = 2;
const MISSION_REV = 3;           // goal-table revision: older saves get their open missions re-scaled once
export const UPGRADE_STEP = 2;   // default seconds added per power-up upgrade level
export const MAX_BONUS = 29;     // mission level score-multiplier bonus cap

/** Seconds added per upgrade level, per power-up (a jetpack second is worth more than a magnet second). */
const STEP = { jetpack: 1, sneakers: 1.5, magnet: 2, x2: 2 };
export const upgradeStep = (type) => STEP[type] ?? UPGRADE_STEP;
// the old curve gave +2 s per level for every power-up: levels already bought get coins back once (per level)
const REFUND = { jetpack: 1000, sneakers: 200 };

export const SHOP = {
  magnet: { max: 5, prices: [300, 700, 1500, 3000, 6000] },
  sneakers: { max: 5, prices: [300, 700, 1500, 3000, 6000] },
  x2: { max: 5, prices: [300, 700, 1500, 3000, 6000] },
  jetpack: { max: 5, prices: [300, 700, 1500, 3000, 6000] },
  shield: { max: 3, prices: [800, 2500, 6000], chance: [0, 0.35, 0.7, 1] },   // start a run with a shield
};

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/**
 * Mission templates.
 *   m      per-run counter it reads (see COUNTERS)        run   single-run goal (best run counts), else cumulative
 *   kind   'perf' performance | 'sum' cumulative | 'skill' technique: a set deals one of each (distinct counters)
 *   tier   1..3 payout class (TIER_COINS), roughly the number of runs the goal takes
 *   text   the goal; left = the same as "still missing {n}" (toasts, next-step lines)
 * Goal for mission level L and pace profile (see goalFor): base x growth(L) x pf^pfp, a multiple of `r`, at most `cap`
 * (x pf); single-run goals grow by (1 + slope x L), cumulative ones by scale(L)^pow; `mult` follows the start
 * multiplier (score goals); `first` replaces base on level 1 (the opening set); `floor` = at least that many times the
 * player's median coins / distance / score of the last runs; `pfl` = the pf exponent for players slower than the
 * reference (pf < 1, default pfp): a skill goal that barely moves for them shrinks faster than their pace;
 * `from` = first mission level that deals it; `minPf` = not dealt while the player's known pace factor is below it;
 * `deal: false` = never dealt any more (only old saves carry it).
 */
export const MISSIONS = {
  // ---- performance: one good run ----
  coin_run: { text: '一局內收集 {n} 枚金幣', left: '再收集 {n} 枚金幣', m: 'coin', run: true, kind: 'perf', tier: 2, base: 560, first: 520, floor: 1.2, r: 10, cap: 4000 },
  dist_run: { text: '一局內跑 {n} 公尺', left: '再跑 {n} 公尺', m: 'dist', run: true, kind: 'perf', tier: 2, base: 2000, first: 2000, floor: 1.2, r: 50, cap: 15000 },
  clean_run: { text: '不被無人機盯上跑 {n} 公尺', left: '再平安跑 {n} 公尺', m: 'clean', run: true, kind: 'perf', tier: 3, base: 1100, pfp: 0.4, r: 50, cap: 9000 },
  score_run: { text: '一局內拿到 {n} 分', left: '再拿 {n} 分', m: 'score', run: true, kind: 'perf', tier: 2, base: 70000, mult: true, slope: 0, pfp: 1.5, floor: 1.2, r: 5000 },
  // ---- cumulative: a few runs' worth ----
  coin_total: { text: '累計收集 {n} 枚金幣', left: '再收集 {n} 枚金幣', m: 'coin', kind: 'sum', tier: 1, base: 1600, floor: 3, r: 50 },
  dist_total: { text: '累計跑 {n} 公尺', left: '再跑 {n} 公尺', m: 'dist', kind: 'sum', tier: 1, base: 5500, floor: 3, r: 500 },
  power_total: { text: '撿到 {n} 個道具', left: '再撿 {n} 個道具', m: 'power', kind: 'sum', tier: 1, base: 12, first: 12 },
  boost_total: { text: '踩過加速帶 {n} 次', left: '再踩 {n} 次加速帶', m: 'boost', kind: 'sum', tier: 1, base: 12, pfl: 1.5 },
  smash_total: { text: 'RUSH 中撞飛 {n} 個障礙', left: '再撞飛 {n} 個障礙', m: 'smash', kind: 'sum', tier: 2, base: 14, from: 2, minPf: 1 },
  jet_total: { text: '使用噴射背包 {n} 次', left: '再用 {n} 次噴射背包', m: 'jet', kind: 'sum', tier: 2, base: 1, pfp: 0, cap: 2, deal: false },   // jetpacks are rare now: only old saves still carry it
  trick_total: { text: '累計完成 {n} 個花式動作', left: '再完成 {n} 個花式動作', m: 'trick', kind: 'sum', tier: 1, base: 45, pfl: 1.5 },
  runs_total: { text: '完成 {n} 局', left: '再跑 {n} 局', m: 'runs', kind: 'sum', tier: 1, base: 4, pow: 0.5, pfp: 0, cap: 12 },
  // dealt once main.js calls track('peak') on a cleared 尖峰時段 (peak hour): drop `deal: false` together with that hook
  peak_total: { text: '撐過 {n} 次尖峰時段', left: '再撐過 {n} 次尖峰時段', m: 'peak', kind: 'sum', tier: 2, base: 2, pfp: 0.5, from: 3, minPf: 0.75, cap: 20 },
  // ---- skill: clean technique ----
  graze_run: { text: '一局內驚險閃過列車 {n} 次', left: '再 {n} 次驚險閃避', m: 'graze', run: true, kind: 'skill', tier: 2, base: 6, pfl: 2, cap: 30 },
  graze_total: { text: '累計驚險閃過列車 {n} 次', left: '再 {n} 次驚險閃避', m: 'graze', kind: 'skill', tier: 1, base: 14, pfl: 1.5 },
  pjump_total: { text: '完美跳躍 {n} 次', left: '再 {n} 次完美跳躍', m: 'pjump', kind: 'skill', tier: 2, base: 4, pfl: 2 },
  pjump_run: { text: '一局內完美跳躍 {n} 次', left: '再 {n} 次完美跳躍', m: 'pjump', run: true, kind: 'skill', tier: 3, base: 2, pfl: 2, cap: 12 },
  proll_total: { text: '完美翻滾 {n} 次', left: '再 {n} 次完美翻滾', m: 'proll', kind: 'skill', tier: 2, base: 5, pfl: 2 },
  proll_run: { text: '一局內完美翻滾 {n} 次', left: '再 {n} 次完美翻滾', m: 'proll', run: true, kind: 'skill', tier: 3, base: 2, pfl: 2, cap: 12 },
  trick_run: { text: '一局內完成 {n} 個花式動作', left: '再完成 {n} 個花式動作', m: 'trick', run: true, kind: 'skill', tier: 2, base: 16, pfl: 2, cap: 60 },
  combo_run: { text: '連擊達到 ×{n}', left: '再接 {n} 個連擊', m: 'combo', run: true, kind: 'skill', tier: 2, base: 6, slope: 0.01, pfp: 0.3, minPf: 0.9, cap: 10 },
  triple_total: { text: '完成「貓步三連」{n} 次', left: '再完成 {n} 次貓步三連', m: 'triple', kind: 'skill', tier: 3, base: 3, pfp: 0.8, from: 3, minPf: 1, cap: 14 },
  rush_total: { text: '發動 TABBY RUSH {n} 次', left: '再發動 {n} 次 RUSH', m: 'rush', kind: 'skill', tier: 2, base: 3, pfp: 0.5, from: 2, minPf: 1, cap: 25 },
  rush_run: { text: '一局內發動 TABBY RUSH {n} 次', left: '再發動 {n} 次 RUSH', m: 'rush', run: true, kind: 'skill', tier: 3, base: 2, pfp: 0.5, from: 8, minPf: 1, cap: 6 },
  smash_run: { text: '一局內 RUSH 撞飛 {n} 個障礙', left: '再撞飛 {n} 個障礙', m: 'smash', run: true, kind: 'skill', tier: 3, base: 6, from: 4, minPf: 1, cap: 40 },
  power_run: { text: '一局內撿到 {n} 個道具', left: '再撿 {n} 個道具', m: 'power', run: true, kind: 'skill', tier: 3, base: 5, cap: 14 },
};
export const FIRST_SET = ['coin_run', 'dist_run', 'power_total'];   // level 1: teach the basics
export const KINDS = ['perf', 'sum', 'skill'];

const COUNTERS = ['coin', 'dist', 'clean', 'score', 'graze', 'pjump', 'proll', 'trick', 'combo', 'triple',
  'rush', 'smash', 'power', 'jet', 'boost', 'runs', 'peak'];
const zeroCounters = () => Object.fromEntries(COUNTERS.map((k) => [k, 0]));
/** Short label of a counter for the in-run objective row. */
const TAGS = {
  coin: '金幣', dist: '距離', clean: '平安距離', score: '分數', graze: '驚險閃避', pjump: '完美跳躍', proll: '完美翻滾',
  trick: '花式動作', combo: '連擊', triple: '貓步三連', rush: 'RUSH', smash: '撞飛', power: '道具', jet: '噴射背包',
  boost: '加速帶', runs: '局數', peak: '尖峰時段',
};
const UNITS = { dist: ' m', clean: ' m' };

const nat = (v) => (Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
const fmtN = (n) => Math.round(n).toLocaleString('en-US');
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Cumulative goal growth with the mission level L: 1, 1.12, ... 2.8 at L10, 5.8 at L20, 9.5 at L29. */
export const scale = (lvl) => { const L = Math.min(60, Math.max(0, lvl)); return 1 + 0.12 * L + 0.006 * L * L; };

const REF_DIST = 1600;   // median run distance (m) of the reference casual player the goal table is written for
const clampN = (v, a, b) => Math.max(a, Math.min(b, v));

/**
 * Goal of mission `id` at mission level `lvl`. `prof` = { pf, dist, coin, score } from the player's last runs (see
 * paceOf) or null: pf (0.5..3) = median run distance / REF_DIST scales the goal, and coin / distance / score goals
 * never fall below 1.2 x (single run) or 3 x (cumulative) the player's own median. A set then takes about as many
 * runs for a strong player as for a casual one. The opening set (`first`) only bends to pf 0.5..1.25.
 */
export function goalFor(id, lvl, prof = null) {
  const t = MISSIONS[id], r = t.r || 1, L = clampN(lvl, 0, 60);
  const pf = prof ? prof.pf : 1, f = pf ** (pf < 1 ? (t.pfl ?? t.pfp ?? 1) : (t.pfp ?? 1));
  let raw;
  if (L === 0 && t.first) raw = t.first * clampN(pf, 0.5, 1.25);
  else {
    const grow = t.run ? 1 + (t.slope ?? 0.015) * L : scale(L) ** (t.pow ?? 0.45);
    // score goals follow the start multiplier, which is the player's distance steps (about 1 + 1.2 pf) plus the mission level
    const m0 = 1 + 1.2 * pf;
    raw = t.base * grow * (t.mult ? (m0 + Math.min(MAX_BONUS, L)) / m0 : 1) * f;
    const med = prof && t.floor ? prof[t.m] : 0;
    if (med) raw = Math.max(raw, t.floor * med);
  }
  return Math.min((t.cap || Infinity) * Math.max(1, f), Math.max(r, Math.round(raw / r) * r));
}

/** Pace profile from a save's last finished runs ([dist, coins, score] x up to 10); null until 4 runs are known (2 for the opening set). */
function paceOf(sv) {
  const rec = sv && sv.recent;
  if (!rec || rec.length < (sv.missions && sv.missions.lvl === 0 ? 2 : 4)) return null;
  const med = (i) => {
    const a = rec.map((x) => x[i]).sort((x, y) => x - y), n = a.length;
    return n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2;
  };
  const dist = med(0);
  return { pf: clampN(dist / REF_DIST, 0.5, 3), dist, coin: med(1), score: med(2) };
}

export function missionText(id, goal) {
  return MISSIONS[id].text.replace('{n}', goal.toLocaleString('en-US'));
}

/** "still missing" wording, e.g. 再跑 120 公尺. */
export function missionLeft(id, n) {
  return MISSIONS[id].left.replace('{n}', Math.max(0, Math.ceil(n)).toLocaleString('en-US'));
}

/* ---------- mission payouts ---------- */

export const TIER_COINS = [0, 60, 110, 180];   // coins per mission by tier at mission level 0
const REWARD_PER_LEVEL = 0.12;                 // +12 % per mission level (stops growing at MAX_BONUS, like the multiplier)
const SET_BONUS = 100, SET_BONUS_PER_LEVEL = 40;

/** Coins a finished mission pays at mission level `lvl`. */
export function rewardFor(id, lvl) {
  const L = Math.min(MAX_BONUS, Math.max(0, lvl));
  return Math.round(TIER_COINS[MISSIONS[id].tier || 1] * (1 + REWARD_PER_LEVEL * L) / 10) * 10;
}

/** Extra coins for finishing all three missions of a set at mission level `lvl`. */
export function setBonusFor(lvl) {
  return SET_BONUS + SET_BONUS_PER_LEVEL * Math.min(MAX_BONUS, Math.max(0, lvl));
}

/* ---------- state ---------- */

let save = null;
let G = null;
let view = null;
let ctx = { ui: null, audio: null };
let notice = null;   // one-off message for the menu (jetpack refund)
let leveled = 0;     // a level-up that adopt() dealt while a run was being merged (endRun shows it on the card)
let stored = '';     // the save as this tab last read or wrote it (JSON text): persist() skips writes that change nothing
let baseBank = 0, baseSpent = 0;   // bank / stats.spent of that same read or write: what this tab changed since is its own to keep
const goalSources = [];   // extra "next goal" candidates from other modules (see addGoalSource)
const run = {
  active: false, daily: false, c: zeroCounters(), fresh: [], stumbled: false, allToast: false,
  bank0: 0, reward: 0, setReward: 0, time: 0, liveAt: -1e9, nearDone: [false, false, false], nearDue: [0, 0, 0],
  merge: false,   // a run was committed and not yet written: if the stored save is newer, replayRun() lays it on top
};

/** Live power-up durations (seconds), kept in step with the shop; pass to ui.powers() as the bar max. */
export const powerMax = { ...C.POWER_TIME };

function fresh() {
  return {
    v: VERSION, rev: 0, bank: 0, best: 0,
    upg: Object.fromEntries(Object.keys(SHOP).map((k) => [k, 0])),
    missions: { lvl: 0, skipDay: '', focus: '', rev: MISSION_REV, slots: [] },
    stats: { runs: 0, coins: 0, dist: 0, missions: 0, spent: 0, bestCoins: 0, bestDist: 0, missionCoins: 0, sets: 0, pins: 0 },
    recent: [],   // [dist, coins, score] of the last 10 finished runs (pace of the player, see paceOf)
    mig: { jet: true, sets: true },
  };
}

/** New goal for an open slot keeping its progress ratio (goal table changed / the opening set met the player's pace). */
function regoal(slot, lvl, prof) {
  const ratio = Math.min(0.999, slot.prog / slot.goal);
  slot.goal = goalFor(slot.id, lvl, prof);
  slot.prog = Math.min(slot.goal - 1, Math.floor(slot.goal * ratio));
}

function makeSlot(id, lvl, prof) { return { id, goal: goalFor(id, lvl, prof), prog: 0, done: false }; }

/**
 * Can mission `id` be dealt at mission level `lvl` to a player with pace profile `prof` (null = not known yet)? Old
 * saves may still hold ones that no longer are; a slot already held is never taken away.
 */
const dealable = (id, lvl, prof) => {
  const t = MISSIONS[id];
  return t.deal !== false && lvl >= (t.from || 0) && !(prof && prof.pf < (t.minPf || 0));
};

/**
 * A new mission whose counter isn't used by `others`, avoiding `avoid` ids when possible.
 * `kind` limits the pool to one mission kind when it has any candidate left.
 */
function newSlot(lvl, others, avoid = [], kind = null, prof = null) {
  const usedM = new Set(others.map((s) => MISSIONS[s.id].m));
  const ok = Object.keys(MISSIONS).filter((id) => dealable(id, lvl, prof) && !usedM.has(MISSIONS[id].m));
  const ofKind = kind ? ok.filter((id) => MISSIONS[id].kind === kind) : ok;
  const base = ofKind.length ? ofKind : ok;
  const pool = base.filter((id) => !avoid.includes(id));
  const list = pool.length ? pool : base;
  return makeSlot(list[Math.floor(Math.random() * list.length)], lvl, prof);
}

/** Level 1: the fixed basics. Later: one performance, one cumulative and one skill mission. */
function newSet(lvl, avoid = [], prof = null) {
  if (lvl === 0) return FIRST_SET.map((id) => makeSlot(id, 0, prof));
  const slots = [];
  for (const kind of KINDS) slots.push(newSlot(lvl, slots, avoid, kind, prof));
  return slots;
}

/** Validate a stored save (any shape / version) into a clean v2 save; null when unusable. */
function sanitize(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const s = fresh();
  s.rev = Math.min(2 ** 31, nat(raw.rev));
  s.bank = nat(raw.bank);
  s.best = nat(raw.best);
  for (const k of Object.keys(SHOP)) s.upg[k] = Math.min(SHOP[k].max, nat(raw.upg && raw.upg[k]));
  const m = raw.missions && typeof raw.missions === 'object' ? raw.missions : {};
  s.missions.lvl = nat(m.lvl);
  const st = raw.stats && typeof raw.stats === 'object' ? raw.stats : {};
  for (const k of Object.keys(s.stats)) s.stats[k] = nat(st[k]);
  // a level is one finished set: a save claiming more levels than sets on record is clamped; one without a `sets` count
  // (written before it existed) keeps its level and starts counting from there
  if (Number.isFinite(st.sets)) {
    // the r02 beta wrote `sets: 0` next to real levels: once (no `mig.sets`), a save that has finished runs counts them as sets
    if (!(raw.mig && raw.mig.sets === true) && s.stats.runs > 0) s.stats.sets = Math.max(s.stats.sets, s.missions.lvl);
    s.missions.lvl = Math.min(s.missions.lvl, s.stats.sets);
  } else s.stats.sets = s.missions.lvl;
  s.missions.skipDay = typeof m.skipDay === 'string' ? m.skipDay.slice(0, 10) : '';
  s.missions.focus = typeof m.focus === 'string' && has(MISSIONS, m.focus) ? m.focus : '';
  const rescale = m.rev !== MISSION_REV;   // older goal table: keep the progress ratio, not the number
  s.recent = (Array.isArray(raw.recent) ? raw.recent : []).slice(-10)
    .filter(Array.isArray).map((x) => [nat(x[0]), nat(x[1]), nat(x[2])]);
  const prof = paceOf(s);
  const slots = [];
  for (const o of Array.isArray(m.slots) ? m.slots : []) {
    if (!o || typeof o.id !== 'string' || !has(MISSIONS, o.id) || slots.length >= 3
      || slots.some((q) => MISSIONS[q.id].m === MISSIONS[o.id].m)) continue;
    const old = nat(o.goal) || goalFor(o.id, s.missions.lvl, prof);
    const done = o.done === true;
    const slot = { id: o.id, goal: old, prog: done ? old : Math.min(old, nat(o.prog)), done };
    if (rescale && !done) regoal(slot, s.missions.lvl, prof);
    slots.push(slot);
  }
  if (!slots.length) slots.push(...newSet(s.missions.lvl, [], prof));
  while (slots.length < 3) {   // top up with whichever kind the set is missing
    const kind = KINDS.find((k) => !slots.some((q) => MISSIONS[q.id].kind === k));
    slots.push(newSlot(s.missions.lvl, slots, [], kind, prof));
  }
  s.missions.slots = slots;
  // jetpack / sneakers upgrades got a flatter curve: one-off refund per level bought before that
  if (!(raw.mig && raw.mig.jet === true)) {
    const back = Object.keys(REFUND).reduce((sum, k) => sum + REFUND[k] * s.upg[k], 0);
    if (back > 0) {
      s.bank += back;
      s.stats.spent = Math.max(0, s.stats.spent - back);
      notice = { refund: back };
    }
  }
  return s;
}

function load() {
  const raw = store.get('save', null);
  const s = sanitize(raw);
  if (s) { stored = JSON.stringify(raw); return s; }
  // first run on this version: migrate the old loose keys
  const m = fresh();
  m.best = nat(store.get('best', 0));
  m.bank = nat(store.get('bank', 0));
  m.missions.slots = newSet(0);
  return m;
}

/** Copy G's live best/bank into the save. */
export function sync() {
  if (!save || !G) return;
  save.bank = nat(G.bank);
  save.best = Math.max(save.best, nat(G.best));
}

/**
 * Take `raw` (a save another tab wrote) as this tab's save and put this tab's own changes back on top of it: `own` is the
 * coin change since this tab last read or wrote (earned minus spent, signed) and its `stats.spent`; with `merge` (a run
 * was just committed) also the run's stats and mission progress (replayRun). Nothing the other tab did is undone and
 * nothing is counted twice: the next write is a plain successor of the stored save.
 */
function adopt(raw, own = 0, merge = false) {
  const s = sanitize(raw);
  if (!s) return;
  const mySpent = save ? Math.max(0, save.stats.spent - baseSpent) : 0;
  const theirs = s.bank - baseBank;   // what the other tab changed
  save = s;
  stored = JSON.stringify(raw);
  baseBank = s.bank;
  baseSpent = s.stats.spent;
  save.stats.spent += mySpent;
  if (merge) {   // the mission payouts of this tab's own copy are decided again against the stored missions
    own -= run.reward;
    Object.assign(run, { reward: 0, setReward: 0, fresh: [] });
    run.bank0 += theirs;   // the game-over ledger shows this run's coins, not the other tab's purchases
  }
  if (G) { G.bank = nat(s.bank + own); G.best = Math.max(nat(G.best), s.best); }
  if (merge) replayRun();
  refreshPowerMax();
  const lvl = settle();
  if (lvl) leveled = lvl;
  if (ctx.ui && G) ctx.ui.stats(G.best, G.bank);
  if (view) { view.renderMenu(lvl); view.refreshShop(); }
  if (own || merge || mySpent) persist();
}

/** The finished run's counters on top of the stored save: its stats, its pace row and its progress on the missions it holds. */
function replayRun() {
  const c = run.c, st = save.stats;
  st.runs += nat(c.runs);
  st.coins += nat(c.coin);
  st.dist += Math.floor(c.dist);
  st.bestCoins = Math.max(st.bestCoins, nat(c.coin));
  st.bestDist = Math.max(st.bestDist, Math.floor(c.dist));
  if (c.runs) save.recent = save.recent.concat([[Math.floor(c.dist), nat(c.coin), nat(c.score)]]).slice(-10);
  for (const s of save.missions.slots) {
    if (s.done) continue;
    const t = MISSIONS[s.id], v = Math.floor(c[t.m]);
    s.prog = Math.min(s.goal, t.run ? Math.max(s.prog, v) : s.prog + v);
    if (s.prog >= s.goal) finish(s, false);
  }
}

/** Another tab saved since this tab last read or wrote? Then load its save (never mid-run); true when it did. */
export function catchUp() {
  if (!save || run.active) return false;
  const raw = store.get('save', null);
  if (!raw || nat(raw.rev) <= save.rev) return false;
  adopt(raw, G ? G.bank - baseBank : 0);
  return true;
}

/**
 * Write the save. `withRun` folds the unfinished run's progress into the written copy only (tab hidden / closed).
 * Two tabs share one localStorage: a write that would change nothing is skipped (a tab that is only opened or hidden
 * must not look like a writer), and one from a tab whose copy is older than the stored `rev` is refused, so a stale
 * tab can neither bring spent coins back nor erase what another tab did; it takes the stored save and adds its own
 * coin change and, at the end of a run, that run (adopt()).
 */
function persist(withRun = false) {
  if (!save) return;
  const own = G ? G.bank - baseBank : 0;
  const merge = run.merge;
  run.merge = false;
  sync();
  let out = save;
  if (withRun && run.active) {
    out = JSON.parse(JSON.stringify(save));
    out.missions.slots.forEach((s, i) => { if (!s.done) s.prog = Math.floor(progressOf(save.missions.slots[i])); });
  }
  if (JSON.stringify(out) === stored) return;
  const raw = store.get('save', null);
  if (raw && nat(raw.rev) > save.rev) {
    if (run.active) return;   // the run goes on; the next idle moment (catchUp) or the end of the run takes the stored save
    adopt(raw, own, merge);
    if (view) view.notice('另一個分頁剛更新過進度，已同步最新的存檔');
    return;
  }
  out.rev = save.rev + 1;
  save.rev = out.rev;
  stored = JSON.stringify(out);
  baseBank = save.bank;
  baseSpent = save.stats.spent;
  store.set('save', out);
  store.set('best', save.best);
  store.set('bank', save.bank);
}

/* ---------- public: setup & shop ---------- */

/** Load (or migrate) the save, adopt its best/bank into G and build the shop/mission UI. */
export function init(game, deps = {}) {
  G = game;
  ctx = { ui: deps.ui || null, audio: deps.audio || null };
  save = load();
  baseBank = save.bank;
  baseSpent = save.stats.spent;
  G.best = Math.max(nat(G.best), save.best);
  G.bank = save.bank;
  refreshPowerMax();
  // a run that was closed with all three missions done never got to deal the next set
  const lvl = settle();
  persist();
  view = deps.view || (typeof document !== 'undefined' ? new MetaUI(api, ctx.ui, ctx.audio) : null);
  if (view) {
    view.renderMenu(lvl);
    if (notice) view.notice(`道具升級改版：退還 ${fmtN(notice.refund)} 金幣`);
  }
  notice = null;
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', () => persist(true));
    document.addEventListener('visibilitychange', () => { if (document.hidden) persist(true); else catchUp(); });
    window.addEventListener('storage', (e) => { if (e.key && e.key.endsWith('.save')) catchUp(); });   // another tab saved
  }
}

function refreshPowerMax() {
  for (const k of Object.keys(powerMax)) powerMax[k] = powerTime(k);
}

/**
 * Power-up duration in seconds (magnet / sneakers / x2 / jetpack). With `lvl` (shop preview) it is the duration at
 * that upgrade level; without, the level bought so far, or the base time during a daily run (like-for-like board).
 */
export function powerTime(type, lvl) {
  const l = lvl !== undefined ? lvl : save && !run.daily ? save.upg[type] || 0 : 0;
  return Math.round(((C.POWER_TIME[type] || 0) + upgradeStep(type) * l) * 10) / 10;
}

/** Finished runs on this device (the first few get the in-run tutorial hints). */
export function runsPlayed() { return save ? save.stats.runs : 0; }

/** Write the save now (coins earned or spent outside the normal run end: daily reward, revive). */
export function saveNow() { persist(); }

/** Flat progress numbers for other modules (achievement unlocks): save.stats + lvl (mission level, 0-based) + best score. */
export function stats() {
  return save ? { ...save.stats, lvl: save.missions.lvl, best: Math.max(save.best, nat(G && G.best)) } : null;
}

/** Longest run so far in metres (the best-distance marker on the track). */
export function bestDist() { return save ? save.stats.bestDist : 0; }

/** Chance (0..1) to start a run with a shield. */
export function shieldChance() { return SHOP.shield.chance[save ? save.upg.shield : 0]; }

/** Permanent score multiplier bonus from the mission level (+1 per level, max +29). */
export function multBonus() { return save ? Math.min(MAX_BONUS, save.missions.lvl) : 0; }

export function upgradeLevel(type) { return save && has(SHOP, type) ? save.upg[type] : 0; }

/** Next upgrade price, or 0 when maxed. */
export function price(type) {
  const it = SHOP[type], lv = upgradeLevel(type);
  return lv >= it.max ? 0 : it.prices[lv];
}

/** Buy the next level of `type`: 'ok' | 'max' | 'poor'. */
export function buy(type) {
  if (!save || !G || typeof type !== 'string' || !has(SHOP, type)) return 'poor';
  catchUp();   // pay from the coins the other tab left, not from a stale copy
  const p = price(type);
  if (!p) return 'max';
  if (G.bank < p) return 'poor';
  G.bank -= p;
  save.upg[type]++;
  save.stats.spent += p;
  refreshPowerMax();
  persist();
  if (ctx.ui) ctx.ui.stats(G.best, G.bank);
  return 'ok';
}

/** Pay `n` coins from the bank for anything outside the upgrade list (cosmetics, consumables). False when short. */
export function spend(n) {
  n = nat(n);
  catchUp();
  if (!save || !G || !n || G.bank < n) return false;
  G.bank -= n;
  save.stats.spent += n;
  persist();
  if (ctx.ui) ctx.ui.stats(G.best, G.bank);
  return true;
}

/** Add `n` coins to the bank outside a run (mystery-box refunds, rewards). */
export function earn(n) {
  n = nat(n);
  catchUp();
  if (!save || !G || !n) return;
  G.bank += n;
  persist();
  if (ctx.ui) ctx.ui.stats(G.best, G.bank);
}

/**
 * Let another module (the cosmetics shop) suggest a "next goal": `fn({ bank, mode })` returns null or
 * { score, kind, text, sub?, p?, icon?, act? } (see suggest()); `score` competes with the built-in candidates
 * (affordable upgrade 85, daily 70, saving up 60-75, missions 50-115 growing with progress, +20 for the pinned one, an almost-done one 107+).
 */
export function addGoalSource(fn) { if (typeof fn === 'function') goalSources.push(fn); }

/* ---------- missions ---------- */

/** Live progress of a slot (includes the running run). */
function progressOf(s) {
  if (s.done) return s.goal;
  const t = MISSIONS[s.id], v = run.active ? run.c[t.m] : 0;
  return Math.min(s.goal, t.run ? Math.max(s.prog, v) : s.prog + v);
}

/** What the running run alone has done towards a slot (single-run goals: this run's best; cumulative: saved + run). */
function nowValue(s) {
  const t = MISSIONS[s.id], v = run.active ? run.c[t.m] : 0;
  return Math.min(s.goal, t.run ? v : s.prog + v);
}

/** Pay coins into the bank right now (mission payouts). */
function pay(n) {
  if (!n || !G) return;
  G.bank += n;
  save.stats.missionCoins += n;
  run.reward += n;
  if (ctx.ui) ctx.ui.stats(G.best, G.bank);
}

/** A slot reached its goal: mark it, pay the mission (and the set bonus with the last one), toast. */
function finish(s, live) {
  const m = save.missions;
  s.done = true;
  s.prog = s.goal;
  save.stats.missions++;
  run.fresh.push(s.id);
  const reward = rewardFor(s.id, m.lvl);
  pay(reward);
  const all = m.slots.every((q) => q.done);
  let bonus = 0;
  if (all) {
    bonus = setBonusFor(m.lvl);
    pay(bonus);
    run.setReward += bonus;
    save.stats.sets++;
  }
  if (live && view) {
    view.missionDone(missionText(s.id, s.goal), reward);
    if (all && !run.allToast) {
      run.allToast = true;
      view.allDone(Math.min(MAX_BONUS, m.lvl + 1), false, bonus);
    }
  }
}

function check(live) {
  if (!save) return;
  let hit = false;
  for (const s of save.missions.slots) {
    if (s.done || progressOf(s) < s.goal) continue;
    finish(s, live);
    hit = true;
  }
  if (hit) persist();
}

/** Fold the run's counters into the slots (once per run). */
function commit() {
  if (!run.active) return;
  for (const s of save.missions.slots) if (!s.done) s.prog = Math.floor(progressOf(s));
  const st = save.stats;
  st.coins += run.c.coin;
  st.dist += Math.floor(run.c.dist);
  st.bestCoins = Math.max(st.bestCoins, run.c.coin);
  st.bestDist = Math.max(st.bestDist, Math.floor(run.c.dist));
  run.active = false;
  run.merge = true;
  if (run.daily) { run.daily = false; refreshPowerMax(); }   // back to the shop durations
}

/** All three done: level up (score bonus +1) and deal a new set. Returns the new level or 0. */
function settle() {
  const m = save.missions;
  if (!m.slots.every((s) => s.done)) return 0;
  m.lvl++;
  m.focus = '';
  m.slots = newSet(m.lvl, m.slots.map((s) => s.id), paceOf(save));
  return m.lvl;
}

function slotView(s, i) {
  const t = MISSIONS[s.id];
  return {
    i, id: s.id, text: missionText(s.id, s.goal), goal: s.goal, prog: progressOf(s), done: s.done, run: !!t.run,
    reward: rewardFor(s.id, save.missions.lvl), kind: t.kind, pinned: i === focusIndex() && !s.done,
  };
}

/** The mission the player is working on: the pinned one, else the open one that is furthest along. */
function focusIndex() {
  const slots = save.missions.slots, f = save.missions.focus;
  let k = f ? slots.findIndex((s) => s.id === f && !s.done) : -1;
  if (k >= 0) return k;
  let top = -1;
  slots.forEach((s, i) => {
    if (s.done) return;
    const p = progressOf(s) / s.goal;
    if (p > top) { top = p; k = i; }
  });
  return top >= 0 ? k : -1;
}

/** Pin mission `i` as the goal (tap again to unpin). Returns the new focus id ('' = automatic). */
export function pin(i) {
  const m = save && save.missions, s = m && m.slots[i];
  if (!s || s.done) return m ? m.focus : '';
  m.focus = m.focus === s.id ? '' : s.id;
  if (m.focus) save.stats.pins++;
  persist();
  return m.focus;
}

/** Everything the menu / shop views need. */
function state() {
  const m = save.missions;
  return {
    lvl: m.lvl, bonus: multBonus(), canSkip: m.skipDay !== today(), maxed: m.lvl >= MAX_BONUS,
    setBonus: setBonusFor(m.lvl), pins: save.stats.pins, runs: save.stats.runs,
    slots: m.slots.map(slotView), bank: G ? G.bank : save.bank, next: suggest('menu'),
  };
}

/** Swap one unfinished mission for a new one (same kind); one free skip per calendar day. */
export function skip(i) {
  catchUp();   // the other tab may have skipped today already
  const m = save && save.missions, s = m && m.slots[i];
  if (!s || s.done || run.active || m.skipDay === today()) return false;
  m.slots[i] = newSlot(m.lvl, m.slots.filter((_, j) => j !== i), m.slots.map((q) => q.id), MISSIONS[s.id].kind, paceOf(save));
  m.skipDay = today();
  persist();
  return true;
}

/* ---------- "what next": the single most useful thing to do ---------- */

/**
 * The best next step as { kind, text, sub, p, icon, act, score }:
 *   kind  'mission' | 'shop' | 'save' | 'daily' | 'record' | (from a goal source)
 *   p     0..1 progress bar, -1 = none          icon  'target' | 'flame' | 'flag' | an upgrade type
 *   act   what a tap does: 'play' | 'shop' (upgrades) | 'cshop' (cosmetics shop) | 'daily' | ''
 * mode 'menu' reads the saved state; mode 'over' (after endRun committed the run) also takes
 * x = { dist, prevBest, levelUp } of the finished run.
 */
function suggest(mode, x = {}) {
  if (!save) return null;
  const m = save.missions, bank = G ? G.bank : save.bank, c = [];
  // missions: the closer to done (and the pinned one) the better
  const fi = focusIndex();
  m.slots.forEach((s, i) => {
    if (s.done) return;
    const t = MISSIONS[s.id], cur = s.prog, p = cur / s.goal;
    let score = 50 + 40 * p + (i === fi ? 20 : 0) + (p >= 0.8 ? 25 : 0) + (save.stats.runs === 0 ? 60 : 0);
    let text = p >= 0.5 ? `${missionLeft(s.id, s.goal - cur)}就完成任務` : missionText(s.id, s.goal);
    if (t.run && p >= 0.8) text = `差一點！${missionLeft(s.id, s.goal - cur)}就完成任務`;
    if (x.levelUp) { text = `新任務：${missionText(s.id, s.goal)}`; score = 95 - i; }
    c.push({
      kind: 'mission', text, p, score, icon: 'target', act: mode === 'menu' ? 'play' : '',
      sub: t.run ? (cur > 0 ? `單局・最好 ${fmtN(cur)}/${fmtN(s.goal)}` : '要在同一局完成') : `${fmtN(cur)}/${fmtN(s.goal)}`,
    });
  });
  // shop upgrades: affordable now, or close enough to save up for
  let aff = null, near = null;
  for (const type of Object.keys(SHOP)) {
    const p = price(type);
    if (!p) continue;
    const lv = upgradeLevel(type);
    if (bank >= p) { if (!aff || lv < aff.lv || (lv === aff.lv && p < aff.p)) aff = { type, p, lv }; }
    else if (!near || p < near.p) near = { type, p, lv };
  }
  if (aff) {
    c.push({
      kind: 'shop', text: `可以升級${NAMES[aff.type]}了！`, sub: `${fmtN(aff.p)} 金幣・Lv.${aff.lv + 1}`, p: -1,
      score: 85, icon: aff.type, act: 'shop', cta: '去商店',
    });
  } else if (near && bank / near.p >= 0.5) {
    c.push({
      kind: 'save', text: `再存 ${fmtN(near.p - bank)} 金幣就能升級${NAMES[near.type]}`, sub: `${fmtN(bank)}/${fmtN(near.p)}`,
      p: bank / near.p, score: 45 + 30 * (bank / near.p), icon: near.type, act: 'shop', cta: '商店',
    });
  }
  // today's daily challenge (not for brand-new players, who have the first missions)
  if (save.stats.runs >= 2) {
    const d = dailyStatus();
    if (!d.done) {
      c.push({
        kind: 'daily', text: `完成今日挑戰，領 ${fmtN(dailyReward(d.streak + 1))} 金幣`,
        sub: `${dailyToday().mod.name}・跑到 ${fmtN(DAILY.goal)} m`, p: -1, score: 70, icon: 'flame', act: 'daily', cta: '挑戰',
      });
    }
  }
  // distance record
  const best = x.prevBest ?? save.stats.bestDist;
  if (mode === 'over' && best > 0 && x.dist < best && x.dist >= best * 0.85) {
    c.push({ kind: 'record', text: `再 ${fmtN(best - x.dist + 1)} 公尺就能打破最遠紀錄！`, sub: `${fmtN(best)} m`, p: x.dist / best, score: 78, icon: 'flag', act: '' });
  } else if (best >= 300) {
    const goal = mode === 'over' && x.dist > best ? Math.ceil((x.dist + 1) / 100) * 100 : best;
    c.push({ kind: 'record', text: `打破最遠紀錄 ${fmtN(goal)} 公尺`, sub: '', p: -1, score: 30, icon: 'flag', act: mode === 'menu' ? 'play' : '' });
  }
  for (const fn of goalSources) {
    try { const g = fn({ bank, mode }); if (g && g.text) c.push({ p: -1, sub: '', icon: 'target', act: '', ...g }); } catch { /* a bad source never breaks the menu */ }
  }
  c.sort((a, b) => b.score - a.score);
  return c[0] || null;
}

/** Live objective for the HUD row: { text, p } for the pinned / closest mission (or the distance record when all are done). */
function liveInfo() {
  const slots = save.missions.slots, k = focusIndex();
  if (k >= 0) {
    const s = slots[k], t = MISSIONS[s.id], v = Math.floor(nowValue(s)), u = UNITS[t.m] || '';
    return { text: `${TAGS[t.m]} ${fmtN(v)}/${fmtN(s.goal)}${u}`, p: v / s.goal };
  }
  const d = Math.floor(run.c.dist), b = save.stats.bestDist;
  if (b > d) return { text: `打破最遠紀錄 ${fmtN(d)}/${fmtN(b)} m`, p: d / b };
  const ms = (Math.floor(d / 500) + 1) * 500;
  return { text: `下一站 ${fmtN(d)}/${fmtN(ms)} m`, p: 1 - (ms - d) / 500 };
}

/** 80 % toasts: "任務快完成：再 5 次驚險閃避", once per mission and run, dropped while another banner is up. */
function nearScan() {
  const slots = save.missions.slots;
  for (let i = 0; i < 3; i++) {
    const s = slots[i];
    if (!s || s.done || run.nearDone[i] || run.time < run.nearDue[i]) continue;
    const v = nowValue(s);
    if (v < s.goal * 0.8) continue;
    if (view && view.toastIdle && !view.toastIdle()) return;   // try again at the next tick
    run.nearDone[i] = true;
    if (view) view.near(missionLeft(s.id, s.goal - v));
    return;
  }
}

/* ---------- run hooks ---------- */

/**
 * New run: reset the run counters and roll the start-with-shield upgrade. `daily` = today's challenge: like-for-like for
 * the daily board, so no start shield and base power-up durations (see powerTime).
 */
export function startRun(game, daily = false) {
  if (!save) return;
  catchUp();   // a run starts from the newest save: its coins and missions are folded into that one
  if (view) view.clearToasts(); // last run's leftover banners would otherwise play over this one
  Object.assign(run, {
    active: true, daily: !!daily, c: zeroCounters(), fresh: [], stumbled: false, allToast: false, bank0: nat(game.bank),
    reward: 0, setReward: 0, time: 0, liveAt: -1e9, nearDone: [false, false, false], nearDue: [0, 0, 0],
  });
  // missions that were already at 80 % when the run starts get their reminder a few seconds in, not on frame one
  save.missions.slots.forEach((s, i) => { if (!s.done && nowValue(s) >= s.goal * 0.8) run.nearDue[i] = 6; });
  refreshPowerMax();
  const lv = run.daily ? 0 : save.upg.shield;
  if (lv > 0 && Math.random() < SHOP.shield.chance[lv]) {
    game.power.shield = true;
    if (view) view.banner('開局護盾！', 'shield');
  }
  if (view) view.live(liveInfo());
}

/** Per play frame: distance / score based missions. */
export function frame(game) {
  if (!run.active) return;
  run.time = game.time || 0;
  run.c.dist = game.dist;
  run.c.score = Math.floor(game.score);
  if (!run.stumbled) run.c.clean = game.dist;
  check(true);
  const now = performance.now();
  if (now - run.liveAt >= 250) {   // 4 Hz: the objective row and the 80 % reminders
    run.liveAt = now;
    if (view) { view.live(liveInfo()); nearScan(); }
  }
}

/**
 * Count a run event: 'coin' (n), 'power' (type), 'rush', 'boost', 'smash', 'triple', 'peak' (a cleared 尖峰時段), 'stumble'.
 */
export function track(ev, a = 1) {
  if (!run.active) return;
  const c = run.c;
  switch (ev) {
    case 'coin': c.coin += a; break;
    case 'power': c.power++; if (a === 'jetpack') c.jet++; break;
    case 'stumble': run.stumbled = true; return;
    default: if (has(c, ev)) c[ev]++; else return;
  }
  check(true);
}

/** A scored trick (see awardTrick): kind 'jump' | 'roll' | 'graze'; `combo` = chain length after it. */
export function trick(kind, perfect, combo) {
  if (!run.active) return;
  const c = run.c;
  c.trick++;
  if (kind === 'graze') c.graze++;
  else if (perfect && kind === 'jump') c.pjump++;
  else if (perfect && kind === 'roll') c.proll++;
  c.combo = Math.max(c.combo, combo || 0);
  check(true);
}

/** Pause screen: show live mission progress. */
export function pause() {
  if (save && view) view.renderPause(state());
}

/** What killed the hero (main.js G.deathCause) as a game-over line with the hint that avoids it. */
function causeLine(cause) {
  switch (cause) {
    case 'moving': return '被迎面列車撞到：看到紅色警告就換道';
    case 'train': return '撞上列車車頭：提早換道，或從斜坡跑上車頂';
    case 'side': return '側面擦撞列車：換道要提早，別貼著車身';
    case 'hurdle': return '撞上柵欄：快到時往上跳';
    case 'overhead': return '撞上看板：快到時往下翻滾';
    default: return '';
  }
}

/**
 * Game over (after main.js banked the coins into G.bank): commit mission progress, level up when all
 * three are done, save, and fill the game-over card (G.deathCause feeds its "what happened" line).
 * Returns the summary it rendered.
 */
export function endRun(game) {
  if (!save) return null;
  const prevBest = save.stats.bestDist;
  if (run.active) {
    run.c.runs = 1;
    run.c.dist = game.dist;
    run.c.score = Math.floor(game.score);
    if (!run.stumbled) run.c.clean = game.dist;
    save.recent.push([Math.floor(run.c.dist), nat(run.c.coin), nat(run.c.score)]);   // the pace of the next goals
    if (save.recent.length > 10) save.recent.shift();
    if (save.missions.lvl === 0 && save.recent.length === 2) {   // two runs seen: fit the opening set to this player
      const prof = paceOf(save);
      for (const q of save.missions.slots) if (!q.done) regoal(q, 0, prof);
    }
    check(false);
  }
  // snapshot before commit/settle: run missions show this run's value, the others their total and this run's gain
  const before = save.missions.slots.map((s, i) => {
    const t = MISSIONS[s.id], v = run.active ? Math.floor(run.c[t.m]) : 0;
    return { ...slotView(s, i), pinned: false, fresh: run.fresh.includes(s.id), gain: t.run ? 0 : v, runVal: t.run ? Math.min(s.goal, v) : 0 };
  });
  const ran = run.active, runDist = Math.floor(run.c.dist);
  if (ran) save.stats.runs++;
  commit();
  leveled = 0;
  let lvl = settle();
  persist();
  lvl = lvl || leveled;   // persist() may have adopted a newer save of another tab and finished its set with this run
  // the coin ledger of this run: what was picked up, the 尖峰時段 bonus (main.js G.peakCoins: in game.coins, not a pick-up),
  // what a revive cost, what was paid on top, what reached the bank
  const bank = nat(game.bank), gross = nat(run.c.coin), peak = nat(game.peakCoins);
  const daily = game.daily && game.daily.reward ? nat(game.daily.reward.coins) : 0;
  const delta = bank - (ran ? run.bank0 : bank - nat(game.coins));
  const ledger = {
    gross, peak, revive: Math.max(0, gross + peak + daily + run.reward - delta), mission: run.reward - run.setReward,
    set: run.setReward, daily, delta,
  };
  const out = {
    earned: nat(game.coins), bank, slots: before, levelUp: lvl, bonus: multBonus(), lvl: save.missions.lvl,
    maxed: save.missions.lvl >= MAX_BONUS, setBonus: run.setReward, ledger,
    next: suggest('over', { dist: runDist, prevBest, levelUp: lvl }), cause: causeLine(game.deathCause),
    retry: game.daily ? '再挑戰一次' : lvl ? '挑戰新任務' : '再跑一次',
  };
  if (view) { view.clearToasts(); view.renderGameOver(out); } // the card shows the results; no banners over it
  return out;
}

/** Back on the main menu (also after quitting a run): commit, settle and refresh the mission cards. */
export function menu() {
  if (!save) return;
  if (view) view.clearToasts();
  commit();
  const lvl = settle();
  persist();
  if (view) view.renderMenu(lvl);
}

/* ---------- API for the view & #debug ---------- */

const api = {
  state, buy, skip, pin, price, upgradeLevel, powerTime, shieldChance, suggest, upgradeStep,
  SHOP, UPGRADE_STEP, MAX_BONUS, base: C.POWER_TIME,
};

/**
 * #debug helpers: window.__tabby.progression.debug.*. Only on a dev host (localhost / 127.0.0.1, where the QA harnesses serve the
 * game) or outside a browser (node tests): on a published page the export is null, so the console can't import it and edit the bank.
 */
const DEV = typeof window === 'undefined' || !window.location || !window.location.hostname || ['localhost', '127.0.0.1'].includes(window.location.hostname);
const dbg = !DEV ? null : {
  get save() { return save; },
  get run() { return run; },
  /** Complete mission slot `i` (first unfinished by default); live toast when a run is on. */
  complete(i) {
    const slots = save.missions.slots;
    const k = Number.isInteger(i) ? i : slots.findIndex((s) => !s.done);
    const s = slots[k];
    if (!s || s.done) return false;
    if (run.active) {
      const t = MISSIONS[s.id];
      run.c[t.m] = Math.max(run.c[t.m], t.run ? s.goal : s.goal - s.prog);
      check(true);
    } else {
      finish(s, false);
      persist();
      if (view && G && G.state === 'menu') view.renderMenu(0);
    }
    return true;
  },
  /** Add coins to the bank. */
  coins(n = 10000) {
    G.bank += n; persist();
    if (ctx.ui) ctx.ui.stats(G.best, G.bank);
    if (view) view.refreshShop();
    return G.bank;
  },
  /** The next-step line the menu would show right now. */
  next(mode = 'menu') { return suggest(mode); },
  /** Forget today's skip. */
  resetSkip() { save.missions.skipDay = ''; persist(); if (view && G && G.state === 'menu') view.renderMenu(0); },
  /** Wipe the save (keeps the legacy keys); reload the page afterwards. */
  wipe() { store.set('save', null); save = null; },
};
export { dbg as debug };
