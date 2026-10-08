import { store } from './audio.js';
import { ShopUI } from './shop-ui.js';

/*
 * Cosmetics + consumables shop ("造型店"): hero looks (shader, hero-look.js), trails (fx.js), companions
 * (companions.js) and run consumables. No new hero art: every cosmetic is a shader, a particle or a procedural sprite.
 *
 * Save, localStorage `tabbyrush.cos` (via `store`; tolerant of any bad data, works in memory without storage):
 *   { v: 1, owned: { id: 1 }, eq: { look, trail, pet }, inv: { c_jet, c_score, c_revive }, arm: { c_jet.. : bool },
 *     seen: { id: 1 toasted | 2 seen in the shop }, box: { n, pity }, bought }
 * Coins are the game's bank (G.bank): `spend(n)` / `earn(n)` of progression.js do the paying and saving.
 * Achievement items (`unlock`) are never stored as owned: they are owned while the progression stats say so.
 *
 * Hooks called from main.js (all optional, nothing breaks if some are missing): init, attach, startRun, update,
 * scoreMult, useRevive, assisted, coinBonus, event, endRun, menu, onChange. See tools/loop/requests.md.
 * Randomness here is our own generator: cosmetics never touch Math.random, so a seeded daily track stays repeatable.
 */

const VERSION = 1;
export const CAP = 20;            // most of one consumable you can hold
export const HEADSTART = 6;       // 起跑噴射: seconds of jetpack at the start line
export const SCORE_MULT = 1.5;    // 加班分數章: score multiplier for the run
export const BOX_PITY = 20;       // 驚喜箱: this many boxes without a cosmetic guarantees one

// Hero look numbers = branches of hero-look.js
export const LOOK = { mono: 1, vhs: 2, neon: 3, gold: 4, holo: 5, pixel: 6, rainbow: 7, cloak: 8, glitch: 9, negative: 10, thermal: 11, comic: 12 };

export const KINDS = { look: '造型', trail: '拖尾', pet: '夥伴', item: '道具' };
export const RARITY = {
  common: { name: '常見', rank: 0 }, rare: { name: '稀有', rank: 1 }, epic: { name: '史詩', rank: 2 }, legend: { name: '傳說', rank: 3 },
};

// unlock: { stat, n, text } where stat is a key of stats() below; `fmt` picks how the shop prints the numbers
const L = (id, name, rarity, price, desc, look, extra) => ({ id: `look_${id}`, kind: 'look', name, rarity, price, desc, look, ...extra });
const T = (id, name, rarity, price, desc, extra) => ({ id: `trail_${id}`, kind: 'trail', name, rarity, price, desc, fx: id, ...extra });
const P = (id, name, rarity, price, desc, extra) => ({ id: `pet_${id}`, kind: 'pet', name, rarity, price, desc, fx: id, ...extra });

export const CATALOG = [
  // ---- 造型: shader on the hero sprite ----
  { id: 'look_none', kind: 'look', name: '原色', rarity: 'common', price: 0, desc: '虎斑貓裝，原汁原味。', look: 0 },
  L('mono', '黑白默片', 'common', 1500, '老電影質感：黑白、顆粒，偶爾閃一下。', LOOK.mono),
  L('vhs', '復古錄影帶', 'common', 1800, '褪色棕褐加掃描線，像九〇年代的錄影帶。', LOOK.vhs),
  L('negative', '底片負片', 'rare', 4000, '顏色整個反過來，橘貓變藍貓。', LOOK.negative),
  L('pixel', '像素風', 'rare', 4500, '整隻貓變成 8-bit 的方塊。', LOOK.pixel),
  L('comic', '漫畫網點', 'rare', 5000, '黑色描邊加網點，跑起來像漫畫分格。', LOOK.comic),
  L('cloak', '隱形斗篷', 'rare', 6000, '半透明又閃著水波，只剩輪廓發亮（判定不變）。', LOOK.cloak),
  L('neon', '霓虹虎斑', 'epic', 9000, '青色與洋紅色的霓虹描邊，晚上特別帥。', LOOK.neon),
  L('holo', '全像投影', 'epic', 10500, '藍色投影加掃描線，偶爾訊號不良。', LOOK.holo),
  L('glitch', '故障藝術', 'epic', 12000, '畫面撕裂、RGB 錯位，像是訊號壞掉了。', LOOK.glitch),
  L('rainbow', '彩虹虎斑', 'epic', 0, '貓裝的顏色一路變幻成彩虹。', LOOK.rainbow,
    { unlock: { stat: 'level', n: 5, text: '任務等級達到 Lv.5', fmt: 'lv' } }),
  L('thermal', '熱像儀', 'epic', 0, '用熱感應看世界：越亮的地方越燙。', LOOK.thermal,
    { unlock: { stat: 'bestDist', n: 2500, text: '單局跑到 2,500 公尺', fmt: 'm' } }),
  L('gold', '黃金打工仔', 'legend', 25000, '全身鍍金還會閃閃發光。努力的人最閃亮。', LOOK.gold),

  // ---- 拖尾: particles / decals / afterimages behind the hero ----
  { id: 'trail_none', kind: 'trail', name: '無', rarity: 'common', price: 0, desc: '什麼都不留下。', fx: '' },
  T('paw', '虎斑腳印', 'common', 1500, '地上留下一串小貓掌印。'),
  T('coin', '金幣雨', 'common', 2000, '身後灑下叮叮噹噹的金幣（只是裝飾，撿不到）。'),
  T('bubble', '泡泡珍奶', 'common', 2500, '拖著珍珠和奶泡，邊跑邊喝。'),
  T('bone', '魚骨頭', 'rare', 4000, '吃完的魚骨頭一路丟在後面。'),
  T('fire', '火焰腳', 'rare', 5500, '腳下噴火，連空氣都在燃燒。'),
  T('rainbow', '彩虹屁', 'rare', 6500, '身後噴出一道彩虹。名字就是這樣。'),
  T('ghost', '影印機分身', 'epic', 10000, '兩個慢半拍的分身緊跟在後。'),
  T('star', '星塵', 'epic', 0, '一路灑下閃爍的星星。', { unlock: { stat: 'dist', n: 10000, text: '累計跑 10 公里', fmt: 'km' } }),
  T('galaxy', '銀河尾跡', 'legend', 22000, '拖著一整條銀河在跑。'),

  // ---- 夥伴: a small sprite that follows the hero (perk: extra coins banked at the end of a run) ----
  { id: 'pet_none', kind: 'pet', name: '無', rarity: 'common', price: 0, desc: '一個人跑也很帥。', fx: '' },
  P('drone', '跟班小無人機', 'common', 2000, '和警告用的無人機不是同夥，只負責陪你。'),
  P('box', '紙箱阿貓', 'rare', 0, '躲在紙箱裡的小貓，探頭跟著你跑。', { perk: 0.03, unlock: { stat: 'runs', n: 30, text: '完成 30 局', fmt: 'n' } }),
  P('fish', '漂浮魚', 'rare', 5500, '一條在空中游泳的魚氣球。', { perk: 0.04 }),
  P('train', '迷你列車', 'epic', 9500, '玩具列車嗚嗚冒著煙，在旁邊陪跑。', { perk: 0.05 }),
  P('ufo', '迷你飛碟', 'epic', 12000, '外星朋友路過，決定跟著你。', { perk: 0.06 }),

  // ---- 道具: bought as counts, armed before a run (not usable in the daily challenge) ----
  { id: 'c_jet', kind: 'item', name: '起跑噴射', rarity: 'common', price: 350, icon: 'assets/ui/icon_jetpack.webp',
    desc: `開局直接噴射 ${HEADSTART} 秒，沿路撿天空金幣。` },
  { id: 'c_score', kind: 'item', name: '加班分數章', rarity: 'common', price: 400, icon: 'assets/ui/icon_x2.webp',
    desc: `這一局分數 ×${SCORE_MULT}。` },
  { id: 'c_revive', kind: 'item', name: '復活券', rarity: 'common', price: 400, icon: 'assets/ui/icon_shield.webp',
    desc: '撞車時自動使用，免費復活一次。' },
  { id: 'c_box', kind: 'item', name: '虎斑驚喜箱', rarity: 'rare', price: 600, box: true,
    desc: '開箱隨機得到金幣、道具，或是沒有的外觀。' },
];

const BY_ID = Object.assign(Object.create(null), Object.fromEntries(CATALOG.map((it) => [it.id, it])));   // no inherited keys ('constructor'...)
export const CONSUMABLES = CATALOG.filter((it) => it.kind === 'item' && !it.box).map((it) => it.id);
const DEFAULT = { look: 'look_none', trail: 'trail_none', pet: 'pet_none' };
const ONE_OFF = ['look', 'trail', 'pet'];

export const item = (id) => BY_ID[id] || null;
export const list = (kind) => CATALOG.filter((it) => it.kind === kind);
/** Items you can own (everything except the free defaults and the consumables). */
export const COLLECTABLE = CATALOG.filter((it) => ONE_OFF.includes(it.kind) && it.id !== DEFAULT[it.kind]);

/* ---------- own random numbers (mulberry32) ---------- */

let rs = (Date.now() ^ Math.floor((typeof performance !== 'undefined' ? performance.now() : 0) * 1000)) >>> 0 || 1;
function rnd() {
  rs = (rs + 0x6d2b79f5) >>> 0;
  let t = rs;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
/** Test hook: fix the generator. */
export function seedRandom(n) { rs = (n >>> 0) || 1; }

/* ---------- state ---------- */

const nat = (v) => (Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
let S = fresh();
let G = null;
let D = { spend: null, earn: null, stats: null };
let view = null;
const listeners = new Set();
let goalAdded = false;
// runtime (never saved)
const R = { attached: false, scene: null, player: null, fx: null, t: 0, used: {}, mult: 1, daily: false, look: 0, trail: '', pet: '' };

function fresh() {
  return {
    v: VERSION, owned: {}, eq: { ...DEFAULT },
    inv: Object.fromEntries(CONSUMABLES.map((k) => [k, 0])), arm: Object.fromEntries(CONSUMABLES.map((k) => [k, false])),
    seen: {}, box: { n: 0, pity: 0 }, bought: 0,
  };
}

/** Validate a stored save (any shape) into a clean v1 save. Never throws. */
export function sanitize(raw) {
  const s = fresh();
  if (!raw || typeof raw !== 'object') return s;
  const own = raw.owned && typeof raw.owned === 'object' ? raw.owned : {};
  for (const k of Object.keys(own)) { const it = BY_ID[k]; if (it && ONE_OFF.includes(it.kind) && own[k]) s.owned[k] = 1; }
  const eq = raw.eq && typeof raw.eq === 'object' ? raw.eq : {};
  for (const k of ONE_OFF) { const it = BY_ID[eq[k]]; if (it && it.kind === k) s.eq[k] = it.id; }
  const inv = raw.inv && typeof raw.inv === 'object' ? raw.inv : {};
  const arm = raw.arm && typeof raw.arm === 'object' ? raw.arm : {};
  for (const k of CONSUMABLES) { s.inv[k] = Math.min(CAP, nat(inv[k])); s.arm[k] = arm[k] === true && s.inv[k] > 0; }
  const seen = raw.seen && typeof raw.seen === 'object' ? raw.seen : {};
  for (const k of Object.keys(seen)) if (BY_ID[k] && (seen[k] === 1 || seen[k] === 2)) s.seen[k] = seen[k];
  const box = raw.box && typeof raw.box === 'object' ? raw.box : {};
  s.box.n = nat(box.n);
  s.box.pity = Math.min(BOX_PITY, nat(box.pity));
  s.bought = nat(raw.bought);
  return s;
}

function save() { store.set('cos', S); }
function emit(type = 'change', a) { for (const f of listeners) { try { f(type, a); } catch { /* a listener must not break the shop */ } } if (view && view.refresh && type === 'change') view.refresh(); }
/** Run `f(type, arg)` after every state change ('change') and notable event ('unlock', 'box', 'used'); returns an unsubscribe. */
export function onChange(f) { listeners.add(f); return () => listeners.delete(f); }

/* ---------- stats (achievement unlocks) ---------- */

const ZERO = { runs: 0, coins: 0, dist: 0, missions: 0, spent: 0, bestCoins: 0, bestDist: 0, level: 1, best: 0 };
/** Normalised progress numbers: runs, coins, dist (m, all runs), missions, spent, bestCoins, bestDist (m), level (mission level as shown, 1+), best score. */
export function stats() {
  let raw = null;
  try { raw = D.stats ? D.stats() : null; } catch { raw = null; }
  if (!raw || typeof raw !== 'object') return ZERO;
  const st = raw.stats && typeof raw.stats === 'object' ? raw.stats : raw;   // progression.stats() is flat, debug.save is nested
  const lvl = raw.missions && typeof raw.missions === 'object' ? raw.missions.lvl : raw.lvl;
  return {
    runs: nat(st.runs), coins: nat(st.coins), dist: nat(st.dist), missions: nat(st.missions), spent: nat(st.spent),
    bestCoins: nat(st.bestCoins), bestDist: nat(st.bestDist), level: nat(lvl) + 1, best: nat(raw.best),
  };
}

/** Progress toward an achievement item: { have, need, ratio (0..1), done }. */
export function progress(id) {
  const it = BY_ID[id];
  if (!it || !it.unlock) return null;
  const have = stats()[it.unlock.stat] || 0, need = it.unlock.n;
  return { have: Math.min(have, need), need, ratio: Math.min(1, have / need), done: have >= need };
}

/* ---------- ownership & equipment ---------- */

export function owns(id) {
  const it = BY_ID[id];
  if (!it || !ONE_OFF.includes(it.kind)) return false;
  if (id === DEFAULT[it.kind]) return true;
  if (S.owned[id]) return true;
  const p = it.unlock && progress(id);
  return !!(p && p.done);
}
export const count = (id) => S.inv[id] || 0;
export const equippedId = (kind) => (owns(S.eq[kind]) ? S.eq[kind] : DEFAULT[kind]);
export const isEquipped = (id) => { const it = BY_ID[id]; return !!it && ONE_OFF.includes(it.kind) && equippedId(it.kind) === id; };
export const armed = (id) => !!S.arm[id] && S.inv[id] > 0;
export const price = (id) => (BY_ID[id] ? BY_ID[id].price : 0);
export const bank = () => (G ? nat(G.bank) : 0);
/** Collected cosmetics (not counting the free defaults) and the total available. */
export function collection() {
  const by = {};
  let have = 0;
  for (const k of ONE_OFF) {
    const all = COLLECTABLE.filter((it) => it.kind === k), got = all.filter((it) => owns(it.id)).length;
    by[k] = { have: got, total: all.length };
    have += got;
  }
  return { have, total: COLLECTABLE.length, by };
}
/** Achievement items that just unlocked and the shop has not shown yet. */
export function freshUnlocks() { return COLLECTABLE.filter((it) => it.unlock && owns(it.id) && S.seen[it.id] !== 2).map((it) => it.id); }
/** Mark items as seen in the shop (clears their NEW badge). */
export function markSeen(ids) {
  let hit = false;
  for (const id of ids) if (BY_ID[id] && S.seen[id] !== 2) { S.seen[id] = 2; hit = true; }
  if (hit) save();
}

/** Buy an item. Returns { res: 'ok'|'poor'|'owned'|'locked'|'full'|'bad', reward? } (reward: a 驚喜箱 result, already saved). */
export function buy(id) {
  const it = BY_ID[id];
  if (!it || !G || !D.spend) return { res: 'bad' };
  if (it.kind !== 'item') {
    if (owns(id)) return { res: 'owned' };
    if (it.unlock) return { res: 'locked' };
  } else if (!it.box && S.inv[id] >= CAP) return { res: 'full' };
  if (nat(G.bank) < it.price) return { res: 'poor' };
  if (!D.spend(it.price)) return { res: 'poor' };
  S.bought++;
  if (it.box) {
    const reward = rollBox();          // applied + saved before the shop shows anything
    emit('change');
    emit('box', reward);
    return { res: 'ok', reward };
  }
  if (it.kind === 'item') { if (!S.inv[id]) S.arm[id] = true; S.inv[id]++; } else S.owned[id] = 1;
  save();
  emit('change');
  return { res: 'ok' };
}

/** Wear a look / trail / companion you own. */
export function equip(id) {
  const it = BY_ID[id];
  if (!it || !ONE_OFF.includes(it.kind) || !owns(id)) return false;
  S.eq[it.kind] = id;
  save();
  applyAll();
  emit('change');
  return true;
}

/** Take (or leave) a consumable on the next runs. */
export function setArmed(id, on) {
  if (!CONSUMABLES.includes(id)) return false;
  S.arm[id] = !!on && S.inv[id] > 0;
  save();
  emit('change');
  return S.arm[id];
}

/* ---------- 驚喜箱 ---------- */

const BOX_COINS = [[200, 35], [400, 30], [600, 20], [1000, 10], [2500, 5]];   // [coins, weight]
function weighted(table) {
  let r = rnd() * table.reduce((a, t) => a + t[1], 0);
  for (const t of table) if ((r -= t[1]) < 0) return t[0];
  return table[0][0];
}

/** Pick an unowned, buyable cosmetic (common 60 / rare 35 / epic 5); null when there is none left. */
function boxCosmetic() {
  const pool = COLLECTABLE.filter((it) => !it.unlock && it.rarity !== 'legend' && !owns(it.id));
  if (!pool.length) return null;
  const tier = weighted([['common', 60], ['rare', 35], ['epic', 5]]);
  const sub = pool.filter((it) => it.rarity === tier);
  const from = sub.length ? sub : pool;
  return from[Math.floor(rnd() * from.length)];
}

/** Roll a box and apply the result to the save (the coin payout through earn()). Returns the reward description. */
function rollBox() {
  rs = (rs ^ Date.now() ^ (S.box.n * 2654435761)) >>> 0 || 1;
  S.box.n++;
  S.box.pity++;
  let kind = S.box.pity >= BOX_PITY ? 'cosmetic' : weighted([['coins', 52], ['item', 46], ['cosmetic', 2]]);
  let reward = null;
  if (kind === 'cosmetic') {
    const it = boxCosmetic();
    if (it) { S.owned[it.id] = 1; S.box.pity = 0; reward = { kind: 'cosmetic', id: it.id }; } else kind = 'coins';
  }
  if (!reward && kind === 'item') {
    const id = CONSUMABLES[Math.floor(rnd() * CONSUMABLES.length)];
    const qty = rnd() < 0.1 ? 2 : 1;
    if (S.inv[id] >= CAP) kind = 'coins';
    else {
      if (!S.inv[id]) S.arm[id] = true;
      S.inv[id] = Math.min(CAP, S.inv[id] + qty);
      reward = { kind: 'item', id, qty };
    }
  }
  if (!reward) reward = { kind: 'coins', coins: weighted(BOX_COINS) };
  if (reward.kind === 'coins' && D.earn) D.earn(reward.coins);
  save();
  return reward;
}

/* ---------- "what next" card of the menu / game-over screen (progression.addGoalSource) ---------- */

/**
 * A suggestion for the 下一個目標 card, or null: a new unlock to wear (88), a cosmetic that just became affordable (82, only while
 * the bank is under twice its price: a rich player is not nagged), or the cheapest one still to save up for once 40% of the way (45..70).
 */
export function goalHint(bank) {
  const fresh = freshUnlocks();
  if (fresh.length) {
    const it = BY_ID[fresh[0]];
    return { kind: 'shop', text: `新解鎖：${it.name}！`, sub: it.unlock.text, p: -1, score: 88, act: 'cshop', cta: '去裝備' };
  }
  let next = null;
  for (const it of COLLECTABLE) if (!it.unlock && !owns(it.id) && (!next || it.price < next.price)) next = it;
  if (!next) return null;
  if (bank >= next.price) {
    if (bank >= next.price * 2) return null;
    return { kind: 'shop', text: `可以買「${next.name}」了！`, sub: `${next.price.toLocaleString('en-US')} 金幣・${KINDS[next.kind]}`, p: -1, score: 82, act: 'cshop', cta: '去造型店' };
  }
  const p = bank / next.price;
  if (p < 0.4) return null;
  return { kind: 'shop', text: `存錢買「${next.name}」`, sub: `還差 ${(next.price - bank).toLocaleString('en-US')} 金幣`, p, score: 45 + 25 * p, act: 'cshop', cta: '看看' };
}

/* ---------- run hooks ---------- */

/** Wire the shop to the game: `G` (live state), deps { progression | spend, earn, stats, ui, audio, view }. */
export function init(game, deps = {}) {
  G = game;
  const prog = deps.progression || {};
  D = {
    spend: deps.spend || (prog.spend ? (n) => prog.spend(n) : null),
    earn: deps.earn || (prog.earn ? (n) => prog.earn(n) : null),
    stats: deps.stats || (() => (prog.stats ? prog.stats() : prog.debug ? prog.debug.save : null)),
  };
  S = sanitize(store.get('cos', null));
  save();
  if (prog.addGoalSource && !goalAdded) { goalAdded = true; prog.addGoalSource(({ bank: b }) => goalHint(nat(b))); }
  view = 'view' in deps ? deps.view : (typeof document !== 'undefined' ? new ShopUI(api, deps.ui || null, deps.audio || null) : null);
  if (view && view.refresh) view.refresh();
}

/**
 * Game objects the visuals need. Call once after Player and FX exist. Applies what is equipped.
 * Also fine to call before init(): the look is applied once the save is loaded.
 */
export function attach(scene, player, fx) {
  Object.assign(R, { scene, player, fx, attached: true });
  if (fx && fx.companions) fx.companions.mount(scene);
  if (fx && fx.ghosts) fx.ghosts.mount(scene, player);
  applyAll();
}

function applyAll() {
  if (!R.attached) return;
  const look = BY_ID[equippedId('look')], trail = BY_ID[equippedId('trail')], pet = BY_ID[equippedId('pet')];
  R.look = look ? look.look | 0 : 0;
  R.trail = trail ? trail.fx : '';
  R.pet = pet ? pet.fx : '';
  const { player, fx } = R;
  if (player && player.setLook) player.setLook(R.look);
  if (fx && fx.setTrail) fx.setTrail(R.trail);
  if (fx && fx.companions) fx.companions.set(R.pet);
}

/** Start of a run (call after the run mode is set up, so G.daily is known). Returns what was taken: { jet, score, revive, list }. */
export function startRun(game) {
  const g = game || G;
  const out = { jet: 0, score: 0, revive: 0, list: [] };
  R.used = {};
  R.mult = 1;
  R.daily = !!(g && g.daily);
  if (R.daily) {
    if (CONSUMABLES.some((k) => armed(k))) bannerText('每日挑戰不能帶道具', '道具留到一般賽道用吧');
    return out;
  }
  if (armed('c_jet')) {
    S.inv.c_jet--;
    R.used.c_jet = 1;
    out.jet = HEADSTART;
    out.list.push(BY_ID.c_jet.name);
    if (g && g.power) g.power.jetpack = Math.max(g.power.jetpack || 0, HEADSTART);
  }
  if (armed('c_score')) {
    S.inv.c_score--;
    R.used.c_score = 1;
    R.mult = SCORE_MULT;
    out.score = SCORE_MULT;
    out.list.push(BY_ID.c_score.name);
  }
  if (armed('c_revive')) { out.revive = S.inv.c_revive; out.list.push(`${BY_ID.c_revive.name} ×${S.inv.c_revive}`); }
  for (const k of CONSUMABLES) if (S.inv[k] <= 0) S.arm[k] = false;
  if (out.list.length) { save(); emit('change'); bannerText('出發！帶上了道具', out.list.join('・')); }
  return out;
}

/** Score multiplier of the run (加班分數章), 1 when none. Cheap: call it from totalMult(). */
export const scoreMult = () => R.mult;

/** The crash would end the run: spend an armed 復活券 and return true (revive for free), else false. */
export function useRevive() {
  if (R.daily || !armed('c_revive')) return false;
  S.inv.c_revive--;
  if (S.inv.c_revive <= 0) S.arm.c_revive = false;
  R.used.c_revive = (R.used.c_revive | 0) + 1;
  save();
  emit('change');
  emit('used', 'c_revive');
  bannerText('復活券發動！', `還剩 ${S.inv.c_revive} 張`);
  return true;
}

/** True when this run used a score-affecting consumable (起跑噴射 / 加班分數章): keep it off the world leaderboard, label it 道具局. */
export const assisted = () => !!(R.used.c_jet || R.used.c_score);
/** Consumables used this run: { c_jet?, c_score?, c_revive? (count) }. */
export const used = () => R.used;

/** Extra coins (an integer) the equipped companion pays on top of the run's coins, e.g. `G.coins += coinBonus(G.coins)`. */
export function coinBonus(coins) {
  const it = BY_ID[equippedId('pet')];
  return it && it.perk ? Math.floor(nat(coins) * it.perk) : 0;
}
/** Perk of the equipped companion (0.05 = +5% coins). */
export const perk = () => { const it = BY_ID[equippedId('pet')]; return it && it.perk ? it.perk : 0; };

/** Visual reaction: 'crash' | 'revive' | 'rush' | 'coin' (companions hop, look away...). */
export function event(type) {
  const fx = R.fx;
  if (fx && fx.companions) fx.companions.react(type);
}

/** Per frame (any state but pause): shader clock, trail, companion, afterimages. Allocation-free. */
export function update(dt, game, player, fx) {
  if (!R.attached) return;
  R.t += dt;
  const p = player || R.player, f = fx || R.fx;
  if (R.look && p.updateLook) p.updateLook(R.t);
  if (!f) return;
  const g = game || G, st = g ? g.state : 'menu';
  if (R.trail && (st === 'play' || st === 'menu') && f.cosTrail) f.cosTrail(dt, p, g ? g.dist : 0, g && st === 'play' ? g.speed : 9);
  if (f.companions && R.pet) f.companions.update(dt, p, R.t, true);
  if (f.ghosts) f.ghosts.update(dt, p, R.t);
}

/** After progression.endRun(): announce achievements that unlocked this run. */
export function endRun() { announceUnlocks(); }
/** Back on the menu (call after progression.menu()). */
export function menu() { announceUnlocks(); }

function announceUnlocks() {
  const ids = COLLECTABLE.filter((it) => it.unlock && owns(it.id) && !S.seen[it.id]).map((it) => it.id);
  if (!ids.length) return;
  for (const id of ids) S.seen[id] = 1;
  save();
  emit('change');
  emit('unlock', ids);
  bannerText(ids.length > 1 ? `解鎖了 ${ids.length} 件新外觀！` : `解鎖：${BY_ID[ids[0]].name}！`, '到造型店裝備看看');
}

function bannerText(title, text) { if (view && view.banner) view.banner(title, text); }

/** 驚喜箱 state for the shop: boxes opened and boxes since the last cosmetic. */
export const boxInfo = () => ({ opened: S.box.n, pity: S.box.pity, limit: BOX_PITY });

/** Items of a tab in shop order: the free default, then by rarity (buyable before achievement items), then price. */
export function sorted(kind) {
  const cmp = (a, b) => (a.price === 0 && !a.unlock ? -1 : b.price === 0 && !b.unlock ? 1 : 0)
    || RARITY[a.rarity].rank - RARITY[b.rarity].rank || (a.unlock ? 1 : 0) - (b.unlock ? 1 : 0) || a.price - b.price;
  return list(kind).sort(cmp);
}

/* ---------- API for the view & #debug ---------- */

const api = {
  CATALOG, KINDS, RARITY, CAP, HEADSTART, SCORE_MULT, BOX_PITY, item, list, sorted, owns, count, equippedId, isEquipped, armed, price, bank,
  collection, progress, stats, buy, equip, setArmed, freshUnlocks, markSeen, onChange, perk, boxInfo, CONSUMABLES,
};

/** #debug helpers: window.__tabby.cosmetics.debug.* */
export const debug = {
  get save() { return S; },
  get run() { return R; },
  get view() { return view; },
  api,
  /** Own an item (or +n of a consumable) without paying. */
  give(id, n = 1) {
    const it = BY_ID[id];
    if (!it) return false;
    if (it.kind === 'item') { S.inv[id] = Math.min(CAP, S.inv[id] + n); S.arm[id] = S.inv[id] > 0; } else S.owned[id] = 1;
    save(); emit('change');
    return true;
  },
  /** Own everything buyable. */
  all() { for (const it of CATALOG) if (ONE_OFF.includes(it.kind)) S.owned[it.id] = 1; save(); emit('change'); },
  /** Forget the cosmetics save (reload afterwards). */
  wipe() { S = fresh(); store.set('cos', S); emit('change'); },
};
