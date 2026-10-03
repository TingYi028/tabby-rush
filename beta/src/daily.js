import { store } from './audio.js';

/*
 * Daily challenge ("每日挑戰"): one seeded track per local calendar day (seed = YYYYMMDD, the same for every
 * player), a weekday modifier, today's best score, and a streak of consecutive days with a completed run
 * (one that reached DAILY.goal metres). The first completion of a day pays DAILY.reward x streak multiplier.
 *
 * Saved as `tabbyrush.daily` = { day, best, last, streak }: `best` is the best daily score on `day`,
 * `last` the most recent day completed and `streak` the run of consecutive completed days ending at `last`.
 */

export const DAILY = {
  goal: 1000,       // metres that complete today's challenge
  reward: 300,      // coins for the first completion of the day, x streakMult()
  streakCap: 5,     // the multiplier stops growing after this many days in a row
  fastSpeed: 27,    // 高速起跑: run-speed floor (BASE_SPEED 18.5 .. MAX_SPEED 37)
  magnetTime: 15,   // 磁鐵開局: seconds of magnet from the start line
};

/** Weekday modifiers, indexed by Date#getDay() (0 = Sunday). */
export const MODS = [
  { id: 'none', day: '週日', name: '一般', desc: '原味賽道，今天大家跑同一條' },
  { id: 'magnet', day: '週一', name: '磁鐵開局', desc: `起跑就帶著 ${DAILY.magnetTime} 秒磁鐵` },
  { id: 'pads', day: '週二', name: '只有彈跳墊', desc: '柵欄和看板全換成彈跳墊' },
  { id: 'coins2', day: '週三', name: '雙倍金幣', desc: '每枚金幣算兩枚' },
  { id: 'fast', day: '週四', name: '高速起跑', desc: '一開跑就是高速' },
  { id: 'rush2', day: '週五', name: 'RUSH 充能 ×2', desc: 'RUSH 能量累積加倍' },
  { id: 'trains', day: '週六', name: '迎面列車變多', desc: '迎面而來的列車多出約五成' },
];

/** Local calendar day as a number, e.g. 20261004; it doubles as the track seed. */
export function dayKey(d = new Date()) {
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

/** The day before `key` (noon avoids DST edge cases). */
export function prevDay(key) {
  return dayKey(new Date(Math.floor(key / 10000), (Math.floor(key / 100) % 100) - 1, (key % 100) - 1, 12));
}

/** Small, fast seeded PRNG: returns () => [0, 1), like Math.random. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Today's challenge: { day, seed, mod }. */
export function dailyToday(d = new Date()) {
  const day = dayKey(d);
  return { day, seed: day, mod: MODS[d.getDay()] };
}

// In-memory copy so the reward can't be claimed twice in one session when storage is unavailable.
let mem = { day: 0, best: 0, last: 0, streak: 0 };
function load() {
  const s = store.get('daily', mem);
  const n = (v) => (Number.isFinite(v) ? v : 0);
  const d = s && typeof s === 'object' ? { day: n(s.day), best: n(s.best), last: n(s.last), streak: n(s.streak) } : { ...mem };
  // storage that can be read but not written (quota full) would hand back stale data: trust the newer session copy
  if (mem.last > d.last) { d.last = mem.last; d.streak = mem.streak; }
  if (mem.day > d.day || (mem.day === d.day && mem.best > d.best)) { d.day = mem.day; d.best = mem.best; }
  return d;
}
function save(s) {
  mem = s;
  store.set('daily', s);
}

export const streakMult = (n) => 1 + 0.5 * (Math.min(Math.max(1, n), DAILY.streakCap) - 1);
export const rewardFor = (n) => Math.round(DAILY.reward * streakMult(n));

/** { best: today's best daily score, done: completed today, streak: consecutive days still alive (0 if broken) }. */
export function dailyStatus(day = dayKey()) {
  const s = load();
  const alive = s.last === day || s.last === prevDay(day);
  return { best: s.day === day ? s.best : 0, done: s.last === day, streak: alive ? s.streak : 0 };
}

/** First completion of `day`: extend the streak and return { streak, mult, coins }; null if already completed. */
export function completeDaily(day) {
  const s = load();
  if (s.last >= day) return null;
  s.streak = s.last === prevDay(day) ? s.streak + 1 : 1;
  s.last = day;
  save(s);
  return { streak: s.streak, mult: streakMult(s.streak), coins: rewardFor(s.streak) };
}

/** A daily run on `day` ended with `score`: keep the day's best. Returns { best, newBest }. */
export function recordDaily(day, score) {
  const s = load();
  if (day < s.day) return { best: score, newBest: false }; // the run started before midnight; a newer day is on file
  const prev = s.day === day ? s.best : 0;
  s.day = day;
  s.best = Math.max(prev, score);
  save(s);
  return { best: s.best, newBest: score > prev };
}

/**
 * Track tweaks for a modifier: Spawner.genSlot calls the hook once per row with (content, k, spawner) after
 * the row's content is decided and before anything is placed. Null when the modifier needs none.
 */
export function rowHook(id) {
  if (id === 'pads') {
    // low barriers (and the roll-then-jump gate) become jump pads; pads never block a lane, so fairness holds
    return (content) => {
      for (let L = 0; L < 3; L++) if (content[L] === 'hurdle' || content[L] === 'overhead' || content[L] === 'combo') content[L] = 'pad';
    };
  }
  if (id === 'trains') {
    // drop the cooldown between oncoming trains to a single row (each one still gets its cleared lane):
    // ~1.45x as many over 5 km; the per-row spawn chance and the 6-row approach lane are left alone
    return (content, k, sp) => { sp.lastMoving = Math.min(sp.lastMoving, k - 6); };
  }
  return null;
}

/* ---------- UI: menu button + game-over row ---------- */

const $ = (id) => document.getElementById(id);
const fmt = new Intl.NumberFormat('en-US');

export class DailyUI {
  constructor(onPlay) {
    $('btn-daily').addEventListener('click', onPlay);
    this.refresh();
  }

  /** Menu: today's modifier, the streak flame and either the reward on offer or today's best. */
  refresh() {
    const t = dailyToday(), st = dailyStatus(t.day);
    $('daily-mod').textContent = `${t.mod.day}・${t.mod.name}`;
    $('btn-daily').title = t.mod.desc;
    $('daily-streak').hidden = st.streak < 1;
    $('daily-streak-n').textContent = st.streak;
    $('daily-info').textContent = st.done
      ? `今日已完成・最佳 ${fmt.format(st.best)}`
      : `跑到 ${fmt.format(DAILY.goal)} m 領 ${fmt.format(rewardFor(st.streak + 1))} 金幣`;
  }

  /** Game-over card: `res` = { best, newBest, done, streak, reward } for a daily run, null hides the rows. */
  over(res) {
    $('go-daily-row').hidden = !res;
    $('go-daily-note').hidden = !res;
    if (!res) return;
    $('go-daily-best').textContent = fmt.format(res.best);
    $('go-daily-new').hidden = !res.newBest;
    $('go-daily-note').textContent = res.reward
      ? `每日獎勵 +${fmt.format(res.reward.coins)} 金幣・連續 ${res.reward.streak} 天`
      : res.done ? `今日挑戰已完成・連續 ${res.streak} 天` : `跑到 ${fmt.format(DAILY.goal)} m 就完成今日挑戰`;
  }
}
