import * as C from './config.js';
import { store } from './audio.js';
import { MetaUI } from './progression-ui.js';

/*
 * Meta progression ("reasons to play again"): one versioned save, the coin shop and missions.
 *
 * Save, localStorage `tabbyrush.save` (via `store`; everything still works in memory without storage):
 *   { v: 1, bank, best,
 *     upg: { magnet, sneakers, x2, jetpack, shield },        // shop levels
 *     missions: { lvl, skipDay, slots: [{ id, goal, prog, done }] x3 },
 *     stats: { runs, coins, dist, missions, spent, bestCoins, bestDist } }
 * The first load migrates the old `tabbyrush.best` / `tabbyrush.bank` keys; those keys stay mirrored.
 * main.js keeps G.best / G.bank as the live values: every save reads them back from G (sync()).
 *
 * Hooks called from main.js: init, startRun, frame, track, trick, pause, endRun, menu,
 * powerTime / powerMax (power-up durations), multBonus (mission level score bonus).
 */

const VERSION = 1;
export const UPGRADE_STEP = 2;   // seconds added per power-up upgrade level
export const MAX_BONUS = 29;     // mission level score-multiplier bonus cap

export const SHOP = {
  magnet: { max: 5, prices: [300, 700, 1500, 3000, 6000] },
  sneakers: { max: 5, prices: [300, 700, 1500, 3000, 6000] },
  x2: { max: 5, prices: [300, 700, 1500, 3000, 6000] },
  jetpack: { max: 5, prices: [300, 700, 1500, 3000, 6000] },
  shield: { max: 3, prices: [800, 2500, 6000], chance: [0, 0.35, 0.7, 1] },   // start a run with a shield
};

/**
 * Mission templates. `m` is the per-run counter it reads; `run` missions need it in a single run,
 * the others add up across runs. Goal = base + step x level, rounded to a multiple of `r`, capped at `cap`.
 */
export const MISSIONS = {
  coin_run: { text: '一局內收集 {n} 枚金幣', m: 'coin', run: true, base: 100, step: 20, r: 10 },
  coin_total: { text: '累計收集 {n} 枚金幣', m: 'coin', base: 400, step: 150, r: 50 },
  dist_run: { text: '一局內跑 {n} 公尺', m: 'dist', run: true, base: 800, step: 150, r: 50 },
  dist_total: { text: '累計跑 {n} 公尺', m: 'dist', base: 3000, step: 1000, r: 500 },
  clean_run: { text: '不被無人機盯上跑 {n} 公尺', m: 'clean', run: true, base: 600, step: 120, r: 50 },
  score_run: { text: '一局內拿到 {n} 分', m: 'score', run: true, base: 10000, step: 5000, r: 1000 },
  graze_run: { text: '一局內驚險閃過列車 {n} 次', m: 'graze', run: true, base: 3, step: 0.6, cap: 25 },
  graze_total: { text: '累計驚險閃過列車 {n} 次', m: 'graze', base: 8, step: 3 },
  pjump_total: { text: '完美跳躍 {n} 次', m: 'pjump', base: 3, step: 1.5 },
  proll_total: { text: '完美翻滾 {n} 次', m: 'proll', base: 3, step: 1.5 },
  trick_run: { text: '一局內完成 {n} 個花式動作', m: 'trick', run: true, base: 8, step: 2.5 },
  combo_run: { text: '連擊達到 ×{n}', m: 'combo', run: true, base: 4, step: 0.5, cap: 16 },
  triple_total: { text: '完成「貓步三連」{n} 次', m: 'triple', base: 1, step: 0.5 },
  rush_total: { text: '發動 TABBY RUSH {n} 次', m: 'rush', base: 2, step: 1 },
  rush_run: { text: '一局內發動 TABBY RUSH {n} 次', m: 'rush', run: true, base: 1, step: 0.2, cap: 6 },
  smash_total: { text: 'RUSH 中撞飛 {n} 個障礙', m: 'smash', base: 5, step: 3 },
  power_total: { text: '撿到 {n} 個道具', m: 'power', base: 4, step: 2 },
  jet_total: { text: '使用噴射背包 {n} 次', m: 'jet', base: 2, step: 1 },
  boost_total: { text: '踩過加速帶 {n} 次', m: 'boost', base: 4, step: 2 },
  runs_total: { text: '完成 {n} 局', m: 'runs', base: 3, step: 1, cap: 20 },
};
const FIRST_SET = ['coin_run', 'dist_run', 'power_total'];   // level 1: teach the basics

const COUNTERS = ['coin', 'dist', 'clean', 'score', 'graze', 'pjump', 'proll', 'trick', 'combo', 'triple',
  'rush', 'smash', 'power', 'jet', 'boost', 'runs'];
const zeroCounters = () => Object.fromEntries(COUNTERS.map((k) => [k, 0]));

const nat = (v) => (Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function goalFor(id, lvl) {
  const t = MISSIONS[id], r = t.r || 1;
  return Math.min(t.cap || Infinity, Math.max(r, Math.round((t.base + t.step * lvl) / r) * r));
}

export function missionText(id, goal) {
  return MISSIONS[id].text.replace('{n}', goal.toLocaleString('en-US'));
}

/* ---------- state ---------- */

let save = null;
let G = null;
let view = null;
let ctx = { ui: null, audio: null };
const run = { active: false, c: zeroCounters(), fresh: [], stumbled: false, allToast: false };

/** Live power-up durations (seconds), kept in step with the shop; pass to ui.powers() as the bar max. */
export const powerMax = { ...C.POWER_TIME };

function fresh() {
  return {
    v: VERSION, bank: 0, best: 0,
    upg: Object.fromEntries(Object.keys(SHOP).map((k) => [k, 0])),
    missions: { lvl: 0, skipDay: '', slots: [] },
    stats: { runs: 0, coins: 0, dist: 0, missions: 0, spent: 0, bestCoins: 0, bestDist: 0 },
  };
}

function makeSlot(id, lvl) { return { id, goal: goalFor(id, lvl), prog: 0, done: false }; }

/** A new mission whose counter isn't used by `others`, avoiding `avoid` ids when possible. */
function newSlot(lvl, others, avoid = []) {
  const usedM = new Set(others.map((s) => MISSIONS[s.id].m));
  const ok = Object.keys(MISSIONS).filter((id) => !usedM.has(MISSIONS[id].m));
  const pool = ok.filter((id) => !avoid.includes(id));
  const list = pool.length ? pool : ok;
  return makeSlot(list[Math.floor(Math.random() * list.length)], lvl);
}

function newSet(lvl, avoid = []) {
  if (lvl === 0) return FIRST_SET.map((id) => makeSlot(id, 0));
  const slots = [];
  while (slots.length < 3) slots.push(newSlot(lvl, slots, avoid));
  return slots;
}

/** Validate a stored save (any shape) into a clean v1 save; null when unusable. */
function sanitize(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const s = fresh();
  s.bank = nat(raw.bank);
  s.best = nat(raw.best);
  for (const k of Object.keys(SHOP)) s.upg[k] = Math.min(SHOP[k].max, nat(raw.upg && raw.upg[k]));
  const m = raw.missions && typeof raw.missions === 'object' ? raw.missions : {};
  s.missions.lvl = nat(m.lvl);
  s.missions.skipDay = typeof m.skipDay === 'string' ? m.skipDay.slice(0, 10) : '';
  const slots = [];
  for (const o of Array.isArray(m.slots) ? m.slots : []) {
    if (!o || !MISSIONS[o.id] || slots.length >= 3 || slots.some((q) => MISSIONS[q.id].m === MISSIONS[o.id].m)) continue;
    const goal = nat(o.goal) || goalFor(o.id, s.missions.lvl);
    slots.push({ id: o.id, goal, prog: Math.min(goal, nat(o.prog)), done: o.done === true });
  }
  if (!slots.length) slots.push(...newSet(s.missions.lvl));
  while (slots.length < 3) slots.push(newSlot(s.missions.lvl, slots));
  s.missions.slots = slots;
  const st = raw.stats && typeof raw.stats === 'object' ? raw.stats : {};
  for (const k of Object.keys(s.stats)) s.stats[k] = nat(st[k]);
  return s;
}

function load() {
  const s = sanitize(store.get('save', null));
  if (s) return s;
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

/** Write the save. `withRun` folds the unfinished run's progress into the written copy only (tab hidden / closed). */
function persist(withRun = false) {
  if (!save) return;
  sync();
  let out = save;
  if (withRun && run.active) {
    out = JSON.parse(JSON.stringify(save));
    out.missions.slots.forEach((s, i) => { if (!s.done) s.prog = Math.floor(progressOf(save.missions.slots[i])); });
  }
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
  G.best = Math.max(nat(G.best), save.best);
  G.bank = save.bank;
  refreshPowerMax();
  persist();
  view = deps.view || (typeof document !== 'undefined' ? new MetaUI(api, ctx.ui, ctx.audio) : null);
  if (view) view.renderMenu(0);
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', () => persist(true));
    document.addEventListener('visibilitychange', () => { if (document.hidden) persist(true); });
  }
}

function refreshPowerMax() {
  for (const k of Object.keys(powerMax)) powerMax[k] = powerTime(k);
}

/** Upgraded power-up duration in seconds (magnet / sneakers / x2 / jetpack). */
export function powerTime(type) {
  return (C.POWER_TIME[type] || 0) + UPGRADE_STEP * (save ? save.upg[type] || 0 : 0);
}

/** Finished runs on this device (the first few get the in-run tutorial hints). */
export function runsPlayed() { return save ? save.stats.runs : 0; }

/** Write the save now (coins earned or spent outside the normal run end: daily reward, revive). */
export function saveNow() { persist(); }

/** Longest run so far in metres (the best-distance marker on the track). */
export function bestDist() { return save ? save.stats.bestDist : 0; }

/** Chance (0..1) to start a run with a shield. */
export function shieldChance() { return SHOP.shield.chance[save ? save.upg.shield : 0]; }

/** Permanent score multiplier bonus from the mission level (+1 per level, max +29). */
export function multBonus() { return save ? Math.min(MAX_BONUS, save.missions.lvl) : 0; }

export function upgradeLevel(type) { return save ? save.upg[type] : 0; }

/** Next upgrade price, or 0 when maxed. */
export function price(type) {
  const it = SHOP[type], lv = upgradeLevel(type);
  return lv >= it.max ? 0 : it.prices[lv];
}

/** Buy the next level of `type`: 'ok' | 'max' | 'poor'. */
export function buy(type) {
  if (!save || !SHOP[type] || !G) return 'poor';
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

/* ---------- missions ---------- */

/** Live progress of a slot (includes the running run). */
function progressOf(s) {
  if (s.done) return s.goal;
  const t = MISSIONS[s.id], v = run.active ? run.c[t.m] : 0;
  return Math.min(s.goal, t.run ? Math.max(s.prog, v) : s.prog + v);
}

function check(live) {
  if (!save) return;
  const slots = save.missions.slots;
  let hit = false;
  for (const s of slots) {
    if (s.done || progressOf(s) < s.goal) continue;
    s.done = true;
    s.prog = s.goal;
    save.stats.missions++;
    run.fresh.push(s.id);
    hit = true;
    if (live && view) view.missionDone(missionText(s.id, s.goal));
  }
  if (!hit) return;
  if (live && view && !run.allToast && slots.every((s) => s.done)) {
    run.allToast = true;
    view.allDone(Math.min(MAX_BONUS, save.missions.lvl + 1));
  }
  persist();
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
}

/** All three done: level up (score bonus +1) and deal a new set. Returns the new level or 0. */
function settle() {
  const m = save.missions;
  if (!m.slots.every((s) => s.done)) return 0;
  m.lvl++;
  m.slots = newSet(m.lvl, m.slots.map((s) => s.id));
  return m.lvl;
}

function slotView(s, i) {
  const t = MISSIONS[s.id];
  return { i, id: s.id, text: missionText(s.id, s.goal), goal: s.goal, prog: progressOf(s), done: s.done, run: !!t.run };
}

/** Everything the menu / shop views need. */
function state() {
  const m = save.missions;
  return {
    lvl: m.lvl, bonus: multBonus(), canSkip: m.skipDay !== today(),
    slots: m.slots.map(slotView), bank: G ? G.bank : save.bank,
  };
}

/** Swap one unfinished mission for a new one; one free skip per calendar day. */
export function skip(i) {
  const m = save && save.missions, s = m && m.slots[i];
  if (!s || s.done || run.active || m.skipDay === today()) return false;
  m.slots[i] = newSlot(m.lvl, m.slots.filter((_, j) => j !== i), m.slots.map((q) => q.id));
  m.skipDay = today();
  persist();
  return true;
}

/* ---------- run hooks ---------- */

/** New run: reset the run counters and roll the start-with-shield upgrade. */
export function startRun(game) {
  if (!save) return;
  if (view) view.clearToasts(); // last run's leftover banners would otherwise play over this one
  Object.assign(run, { active: true, c: zeroCounters(), fresh: [], stumbled: false, allToast: false });
  const lv = save.upg.shield;
  if (lv > 0 && Math.random() < SHOP.shield.chance[lv]) {
    game.power.shield = true;
    if (view) view.banner('開局護盾！', 'shield');
  }
}

/** Per play frame: distance / score based missions. */
export function frame(game) {
  if (!run.active) return;
  run.c.dist = game.dist;
  run.c.score = Math.floor(game.score);
  if (!run.stumbled) run.c.clean = game.dist;
  check(true);
}

/**
 * Count a run event: 'coin' (n), 'power' (type), 'rush', 'boost', 'smash', 'triple', 'stumble'.
 */
export function track(ev, a = 1) {
  if (!run.active) return;
  const c = run.c;
  switch (ev) {
    case 'coin': c.coin += a; break;
    case 'power': c.power++; if (a === 'jetpack') c.jet++; break;
    case 'stumble': run.stumbled = true; return;
    default: if (ev in c) c[ev]++; else return;
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

/**
 * Game over (after main.js banked the coins into G.bank): commit mission progress, level up when all
 * three are done, save, and fill the game-over card. Returns the summary it rendered.
 */
export function endRun(game) {
  if (!save) return null;
  if (run.active) {
    run.c.runs = 1;
    run.c.dist = game.dist;
    run.c.score = Math.floor(game.score);
    if (!run.stumbled) run.c.clean = game.dist;
    check(false);
  }
  // snapshot before commit/settle: run missions show this run's value, the others their total and this run's gain
  const before = save.missions.slots.map((s, i) => {
    const t = MISSIONS[s.id], v = run.active ? Math.floor(run.c[t.m]) : 0;
    return { ...slotView(s, i), fresh: run.fresh.includes(s.id), gain: t.run ? 0 : v, runVal: t.run ? Math.min(s.goal, v) : 0 };
  });
  if (run.active) save.stats.runs++;
  commit();
  const lvl = settle();
  persist();
  const out = {
    earned: nat(game.coins), bank: nat(game.bank), slots: before, levelUp: lvl,
    bonus: multBonus(), lvl: save.missions.lvl,
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
  state, buy, skip, price, upgradeLevel, powerTime, shieldChance,
  SHOP, UPGRADE_STEP, MAX_BONUS, base: C.POWER_TIME,
};

/** #debug helpers: window.__tabby.progression.debug.* */
export const debug = {
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
      s.prog = s.goal; s.done = true; save.stats.missions++;
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
  /** Forget today's skip. */
  resetSkip() { save.missions.skipDay = ''; persist(); if (view && G && G.state === 'menu') view.renderMenu(0); },
  /** Wipe the v1 save (keeps the legacy keys); reload the page afterwards. */
  wipe() { store.set('save', null); save = null; },
};
