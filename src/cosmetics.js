import { store } from './audio.js';
import { ShopUI } from './shop-ui.js';

/*
 * Cosmetics + consumables shop ("造型店"): hero looks (shader, hero-look.js), trails (fx.js), companions
 * (companions.js), hats (hats.js: a small sprite above the hero's head), coin faces and crash bursts (fx.js), jump sound packs
 * (audio.js), train liveries and game-over banners (onEquipped() below) and run consumables. No new hero art: every cosmetic is
 * a shader, a particle, a sound or a procedural sprite.
 *
 * Save, localStorage `tabbyrush.cos` (via `store`; tolerant of any bad data, works in memory without storage):
 *   { v: 1, owned: { id: 1 }, eq: { look, trail, pet, hat, coin, crash, sfx, banner, livery }, inv: { c_jet, c_score, c_revive }, arm: { c_jet.. : bool },
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
export const LOOK = { mono: 1, vhs: 2, neon: 3, gold: 4, holo: 5, pixel: 6, rainbow: 7, cloak: 8, glitch: 9, negative: 10, thermal: 11, comic: 12,
  maillard: 13, dopamine: 14, ccd: 15, y2k: 16, jelly: 17, marble: 18, clay: 19, sketch: 20, vapor: 21, glow: 22 };

export const KINDS = { look: '造型', trail: '拖尾', pet: '夥伴', hat: '頭飾', coin: '金幣外觀', crash: '撞車特效', sfx: '跳躍音效', banner: '結算橫幅', livery: '列車塗裝', item: '道具' };
export const RARITY = {
  common: { name: '常見', rank: 0 }, rare: { name: '稀有', rank: 1 }, epic: { name: '史詩', rank: 2 }, legend: { name: '傳說', rank: 3 },
};

// unlock: { stat, n, text } where stat is a key of stats() below; `fmt` picks how the shop prints the numbers
const L = (id, name, rarity, price, desc, look, extra) => ({ id: `look_${id}`, kind: 'look', name, rarity, price, desc, look, ...extra });
const T = (id, name, rarity, price, desc, extra) => ({ id: `trail_${id}`, kind: 'trail', name, rarity, price, desc, fx: id, ...extra });
const P = (id, name, rarity, price, desc, extra) => ({ id: `pet_${id}`, kind: 'pet', name, rarity, price, desc, fx: id, ...extra });
const H = (id, name, rarity, price, desc, extra) => ({ id: `hat_${id}`, kind: 'hat', name, rarity, price, desc, fx: id, ...extra });
// part 2 kinds: coin skins, crash effects, jump sound packs, game-over banners, train liveries; `fx` = the id without its prefix
const kindRow = (kind) => (id, name, rarity, price, desc, extra) => ({ id: `${kind}_${id}`, kind, name, rarity, price, desc, fx: id, ...extra });
const N = kindRow('coin'), X = kindRow('crash'), F = kindRow('sfx'), B = kindRow('banner'), V = kindRow('livery');
const none = (kind, name, desc) => ({ id: `${kind}_none`, kind, name, rarity: 'common', price: 0, desc, fx: '' });

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
  L('maillard', '美拉德穿搭', 'common', 2000, '焦糖、咖啡、可可色，秋天的味道。', LOOK.maillard),
  L('dopamine', '多巴胺配色', 'common', 2200, '高彩度糖果色，心情直接變好。', LOOK.dopamine),
  L('ccd', 'CCD 數位感', 'rare', 4500, '2008 年的數位相機：過曝偏暖，偶爾閃光。', LOOK.ccd),
  L('y2k', 'Y2K 鍍鉻', 'epic', 10000, '銀色鍍鉻加彩虹反光，千禧年回來了。', LOOK.y2k),
  L('jelly', '果凍貓', 'epic', 0, '晶瑩剔透的果凍，跑起來還會晃（判定不變）。', LOOK.jelly,
    { unlock: { stat: 'bestDist', n: 4000, text: '單局跑到 4,000 公尺', fmt: 'm' } }),
  L('marble', '大理石雕像', 'rare', 5000, '變成會跑的大理石雕像。', LOOK.marble),
  L('clay', '黏土動畫', 'rare', 5500, '像停格動畫裡的黏土貓。', LOOK.clay),
  L('sketch', '鉛筆素描', 'rare', 6000, '筆記本上畫出來的貓。', LOOK.sketch),
  L('vapor', '蒸氣波', 'epic', 9500, '粉紫漸層，九〇年代的夢。', LOOK.vapor),
  L('glow', '夜光貼紙', 'epic', 0, '越暗的地方越亮。', LOOK.glow,
    { unlock: { stat: 'bestDist', n: 5000, text: '單局跑到 5,000 公尺', fmt: 'm' } }),
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
  T('heart', '比心心', 'common', 1800, '一路比愛心，粉紅色的心飄在身後。'),
  T('zzz', '躺平 Zzz', 'common', 2200, '人在跑，心已經躺平了。'),
  T('confetti', '拉花彩帶', 'rare', 4500, '每一步都在開派對。'),
  T('danmaku', '彈幕刷屏', 'epic', 9000, '身後飄過一排排彈幕：笑死、ㄏㄏ、好扯。'),
  T('merit', '功德 +1', 'rare', 0, '每跑一步，功德 +1。', { unlock: { stat: 'missions', n: 40, text: '完成 40 個任務', fmt: 'n' } }),
  T('galaxy', '銀河尾跡', 'legend', 22000, '拖著一整條銀河在跑。'),

  // ---- 夥伴: a small sprite that follows the hero (perk: extra coins banked at the end of a run) ----
  { id: 'pet_none', kind: 'pet', name: '無', rarity: 'common', price: 0, desc: '一個人跑也很帥。', fx: '' },
  P('drone', '跟班小無人機', 'common', 2000, '和警告用的無人機不是同夥，只負責陪你。'),
  P('box', '紙箱阿貓', 'rare', 0, '躲在紙箱裡的小貓，探頭跟著你跑。', { perk: 0.03, unlock: { stat: 'runs', n: 30, text: '完成 30 局', fmt: 'n' } }),
  P('fish', '漂浮魚', 'rare', 5500, '一條在空中游泳的魚氣球。', { perk: 0.04 }),
  P('train', '迷你列車', 'epic', 9500, '玩具列車嗚嗚冒著煙，在旁邊陪跑。', { perk: 0.05 }),
  P('ufo', '迷你飛碟', 'epic', 12000, '外星朋友路過，決定跟著你。', { perk: 0.06 }),
  P('shiba', '憨憨柴', 'common', 2500, '一臉憨笑的柴犬，跑起來耳朵亂飛。', { perk: 0.02 }),
  P('muyu', '電子木魚', 'rare', 4500, '自己會敲自己的木魚，功德一直漲。', { perk: 0.03 }),
  P('capy', '泡湯水豚', 'rare', 5000, '頭頂小橘子，泡在澡盆裡跟著飄。', { perk: 0.04 }),
  P('boba', '珍奶精靈', 'rare', 6000, '珍奶杯成精了，吸管還會冒泡。', { perk: 0.04 }),
  P('saltfish', '鹹魚', 'rare', 0, '平常躺著不動，偶爾翻個身。', { perk: 0.03, unlock: { stat: 'runs', n: 60, text: '完成 60 局', fmt: 'n' } }),
  P('ox', '打工牛馬', 'epic', 9500, '打著領帶、捧著咖啡，還在加班。', { perk: 0.05 }),
  P('pudding', '布丁胖龍', 'legend', 24000, '焦糖布丁做的胖龍，自信滿滿，走路會晃。', { perk: 0.07 }),
  P('xlb', '小籠包精', 'common', 2000, '皮薄餡多，跑起來會晃湯汁。', { perk: 0.02 }),
  P('mochi', '麻糬兔', 'common', 2500, '軟 Q 的麻糬，捏一下會彈回來。', { perk: 0.02 }),
  P('pigeon', '胖鴿子', 'rare', 4000, '吃太飽的鴿子，邊走邊點頭。', { perk: 0.03 }),
  P('robovac', '掃地機器人', 'rare', 4500, '一路幫你掃金幣，真的有多存一點。', { perk: 0.03 }),
  P('sweetpotato', '地瓜球三兄弟', 'rare', 5000, '三顆地瓜球疊在一起跳。', { perk: 0.03 }),
  P('puffer', '河豚氣球', 'rare', 5500, '生氣就會鼓起來。', { perk: 0.03 }),
  P('panda', '熊貓團子', 'epic', 9000, '三顆團子串成一隻熊貓。', { perk: 0.05 }),
  P('penguin', '社畜企鵝', 'epic', 0, '背著公事包，準時打卡。', { perk: 0.05, unlock: { stat: 'runs', n: 200, text: '完成 200 局', fmt: 'n' } }),

  // ---- 頭飾: a small sprite above the hero's head (hats.js; never changes the hero frames or the hit box) ----
  { id: 'hat_none', kind: 'hat', name: '無', rarity: 'common', price: 0, desc: '頭上空空，清爽。', fx: '' },
  H('party', '派對尖帽', 'common', 1500, '每天都是生日。'),
  H('sprout', '長草了', 'common', 1800, '頭上長草，代表很想要。'),
  H('hardhat', '工地安全帽', 'common', 2200, '打工安全第一。'),
  H('maid', '女僕頭飾', 'rare', 4000, '白色蕾絲頭飾，端莊又可愛。'),
  H('chick', '頭頂小雞', 'rare', 5000, '一隻小雞把你的頭當成窩。'),
  H('crown', '紙皇冠', 'epic', 8000, '紙做的皇冠，氣勢是真的。'),
  H('halo', '天使光環', 'epic', 0, '花了這麼多，你就是天使。', { unlock: { stat: 'spent', n: 20000, text: '累計花掉 20,000 金幣', fmt: 'n' } }),
  H('noodle', '泡麵碗', 'common', 2000, '頭頂一碗泡麵，還在冒煙。'),
  H('cap', '反戴棒球帽', 'common', 2500, '反戴才是重點。'),
  H('bun', '包子頭', 'rare', 0, '頭上兩顆包子，很好捏。', { unlock: { stat: 'level', n: 10, text: '任務等級達到 Lv.10', fmt: 'lv' } }),
  H('lamp', '頭頂燈籠', 'epic', 9000, '走到哪亮到哪。'),
  H('chef', '廚師帽', 'common', 1500, '今天的主廚是你。'),
  H('headphones', '大耳機', 'common', 2500, '戴上耳機，世界只剩音樂。'),
  H('propeller', '螺旋槳帽', 'rare', 4000, '跑快一點，槳就轉起來。'),
  H('flowers', '花圈', 'rare', 4500, '一圈小花，春天的感覺。'),
  H('grad', '學士帽', 'rare', 0, '恭喜畢業，跑出人生。', { unlock: { stat: 'level', n: 20, text: '任務等級達到 Lv.20', fmt: 'lv' } }),
  H('bow', '超大蝴蝶結', 'epic', 8000, '大到有點誇張的蝴蝶結。'),

  // ---- 金幣外觀: the face of the coins you pick up (same rim, size, spin and pick-up box) ----
  none('coin', '原味金幣', '經典的金色金幣。'),
  N('paw', '貓掌幣', 'common', 1500, '金幣上蓋了一個貓掌印。'),
  N('pearl', '珍珠幣', 'common', 2000, '黑糖珍珠做的金幣，Q 彈。'),
  N('heart', '愛心幣', 'rare', 3500, '撿起來心情會變好。'),
  N('star', '星星幣', 'rare', 4500, '一閃一閃的星星。'),
  N('cake', '鳳梨酥幣', 'epic', 8000, '金黃酥皮，看起來很好吃。'),
  N('pixel', '像素幣', 'epic', 0, '8-bit 時代的金幣。', { unlock: { stat: 'coins', n: 30000, text: '累計撿 30,000 金幣', fmt: 'n' } }),

  // ---- 撞車特效: a burst variant on top of the crash burst (same duration, no extra flash) ----
  none('crash', '原味撞擊', '撞車就是撞車。'),
  X('stars', '眼冒金星', 'common', 1500, '撞到眼冒金星，轉圈圈。'),
  X('confetti', '撞出彩帶', 'common', 2000, '撞車也要撞得很歡樂。'),
  X('pixel', '像素碎裂', 'rare', 4000, '碎成一地像素方塊。'),
  X('firework', '原地煙火', 'epic', 8500, '砰！直接放一發煙火。'),
  X('bang', '漫畫碰！', 'rare', 0, '漫畫字「碰！」跳出來。', { unlock: { stat: 'runs', n: 100, text: '完成 100 局', fmt: 'n' } }),

  // ---- 跳躍音效: replaces the jump / land samples only ----
  none('sfx', '原味音效', '貓咪跳起來的原本聲音。'),
  F('8bit', '嗶嗶 8bit', 'common', 1500, '每一跳都是紅白機。'),
  F('meow', '喵喵跳', 'common', 2000, '跳一下喵一聲。'),
  F('spring', '彈簧跳', 'rare', 3500, '腳底裝了彈簧。'),
  F('muyu', '木魚跳', 'rare', 4000, '每跳一下，功德 +1。'),

  // ---- 結算橫幅: a frame around the game-over title ----
  none('banner', '素面結算', '乾乾淨淨的結算畫面。'),
  B('ribbon', '彩帶橫幅', 'common', 1500, '結算畫面掛上彩帶。'),
  B('lantern', '夜市燈籠', 'rare', 4000, '燈籠一排，熱熱鬧鬧。'),
  B('redpaper', '紅紙賀詞', 'rare', 4500, '紅紙寫上「跑得快」。'),
  B('pixel', '像素獎盃', 'epic', 8000, '8-bit 獎盃，閃閃發亮。'),
  B('neon', '霓虹招牌', 'epic', 0, '你的成績，用霓虹燈打出來。', { unlock: { stat: 'best', n: 1000000, text: '最高分達到 1,000,000', fmt: 'n' } }),

  // ---- 列車塗裝: body colour and motif of the trains (front lights and warning colours stay) ----
  none('livery', '原廠塗裝', '電車公司的原廠配色。'),
  V('market', '夜市號', 'rare', 5000, '車身畫滿夜市小吃。'),
  V('sakura', '櫻花號', 'rare', 5500, '粉紅車身，櫻花飄飄。'),
  V('seabreeze', '海風號', 'rare', 5500, '藍白車身，帶著海的味道。'),
  V('temple', '廟會號', 'epic', 9000, '紅金配色，熱鬧滾滾。'),
  V('candy', '糖果號', 'epic', 0, '像糖果一樣的列車。', { unlock: { stat: 'dist', n: 50000, text: '累計跑 50 公里', fmt: 'km' } }),

  // ---- 道具: bought as counts, armed before a run (not usable in the daily challenge) ----
  { id: 'c_jet', kind: 'item', name: '起跑噴射', rarity: 'common', price: 350, icon: 'assets/ui/item_jet.webp',
    desc: `開局直接噴射 ${HEADSTART} 秒，沿路撿天空金幣。` },
  { id: 'c_score', kind: 'item', name: '加班分數章', rarity: 'common', price: 400, icon: 'assets/ui/item_score.webp',
    desc: `這一局分數 ×${SCORE_MULT}。` },
  { id: 'c_revive', kind: 'item', name: '復活券', rarity: 'common', price: 400, icon: 'assets/ui/item_revive.webp',
    desc: '撞車時自動使用，免費復活一次。' },
  { id: 'c_box', kind: 'item', name: '虎斑驚喜箱', rarity: 'rare', price: 600, icon: 'assets/ui/item_box.webp', box: true,
    desc: '開箱隨機得到金幣、道具，或是沒有的外觀。' },
];

const BY_ID = Object.assign(Object.create(null), Object.fromEntries(CATALOG.map((it) => [it.id, it])));   // no inherited keys ('constructor'...)
export const CONSUMABLES = CATALOG.filter((it) => it.kind === 'item' && !it.box).map((it) => it.id);
const ONE_OFF = ['look', 'trail', 'pet', 'hat', 'coin', 'crash', 'sfx', 'banner', 'livery'];
const DEFAULT = Object.fromEntries(ONE_OFF.map((k) => [k, `${k}_none`]));

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
// Dev hosts only (localhost / 127.0.0.1, where the QA harnesses serve the game) or no browser at all (node tests): on a published page
// the debug helpers and seedRandom do nothing, so the console can't import them to pick a 驚喜箱 roll or hand itself items.
const DEV = typeof window === 'undefined' || !window.location || !window.location.hostname || ['localhost', '127.0.0.1'].includes(window.location.hostname);
/** Test hook: fix the generator. */
export function seedRandom(n) { if (DEV) rs = (n >>> 0) || 1; }

/* ---------- state ---------- */

const nat = (v) => (Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
let S = fresh();
let G = null;
let D = { spend: null, earn: null, stats: null, audio: null };
let view = null;
const listeners = new Set();
let goalAdded = false;
let stored = '';   // the shop save as this tab last read or wrote it (JSON text)
let listening = false;
let hats = null;   // hats.js, loaded by attach() (it needs three.js, which the unit tests do not have); until then no hat is drawn
const pushed = { livery: '', banner: '' };   // what the onEquipped() listeners were last told
const SINK = { livery: new Set(), banner: new Set() };
const applied = {};   // what applyAll() last gave each setter (look, trail, pet, crash, coin, sfx, hat): only a changed value is given again
// runtime (never saved)
const R = { attached: false, scene: null, player: null, fx: null, t: 0, used: {}, mult: 1, daily: false, look: 0, trail: '', pet: '', hat: '', coin: '', crash: '', sfx: '', banner: '', livery: '' };

function fresh() {
  return {
    v: VERSION, rev: 0, owned: {}, eq: { ...DEFAULT },
    inv: Object.fromEntries(CONSUMABLES.map((k) => [k, 0])), arm: Object.fromEntries(CONSUMABLES.map((k) => [k, false])),
    seen: {}, box: { n: 0, pity: 0 }, bought: 0,
  };
}

/** Validate a stored save (any shape) into a clean v1 save. Never throws. */
export function sanitize(raw) {
  const s = fresh();
  if (!raw || typeof raw !== 'object') return s;
  s.rev = Math.min(2 ** 31, nat(raw.rev));
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

/**
 * Write the shop save. Two tabs share one localStorage: `rev` counts the writes, a write that changes nothing is skipped, and a
 * tab whose copy is older than the stored one takes the stored copy instead of overwriting it (no item or ticket is paid twice).
 */
function save() {
  if (JSON.stringify(S) === stored) return;
  const raw = store.get('cos', null);
  if (raw && nat(raw.rev) > S.rev) { adopt(raw); return; }
  S.rev++;
  stored = JSON.stringify(S);
  store.set('cos', S);
}
/** Load the shop save another tab wrote. */
function adopt(raw) {
  S = sanitize(raw);
  stored = JSON.stringify(raw);
  applyAll();
  emit('change');
}
/** Take the other tab's newer shop save, if there is one: call before reading stock or ownership to change it. */
function catchUp() {
  const raw = store.get('cos', null);
  if (raw && nat(raw.rev) > S.rev) adopt(raw);
}
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
  catchUp();
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

/** Wear a look / trail / companion / hat you own. */
export function equip(id) {
  catchUp();
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
  catchUp();
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
    audio: deps.audio || null,
  };
  const raw = store.get('cos', null);
  S = sanitize(raw);
  stored = raw ? JSON.stringify(raw) : '';
  save();
  if (!listening && typeof window !== 'undefined' && window.addEventListener) {
    listening = true;
    window.addEventListener('storage', (e) => { if (e.key && e.key.endsWith('.cos')) catchUp(); });   // another tab saved
  }
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
  for (const k of Object.keys(applied)) delete applied[k];   // new objects: nothing is applied to them yet
  if (fx && fx.companions) fx.companions.mount(scene);
  if (fx && fx.ghosts) fx.ghosts.mount(scene, player);
  applyAll();
  import('./hats.js').then((m) => { hats = m; hats.mount(scene, player); applyAll(); }, () => { /* the module did not load: the game runs without hats */ });
}

function applyAll() {
  if (!R.attached) return;
  const look = BY_ID[equippedId('look')], trail = BY_ID[equippedId('trail')], pet = BY_ID[equippedId('pet')], hat = BY_ID[equippedId('hat')];
  R.look = look ? look.look | 0 : 0;
  R.trail = trail ? trail.fx : '';
  R.pet = pet ? pet.fx : '';
  R.hat = hat ? hat.fx : '';
  for (const k of ['coin', 'crash', 'sfx', 'banner', 'livery']) R[k] = equippedId(k) === DEFAULT[k] ? '' : equippedId(k);   // catalog id, '' = the default
  const { player, fx } = R;
  // a setter is called only when its kind changed: equipping a trail must not re-upload the coin face or flicker the hat, and another
  // tab's save arriving mid-run changes nothing the player is wearing unless it equipped something else
  const put = (k, to, f) => { if (to && applied[k] !== R[k]) { applied[k] = R[k]; f(R[k]); } };
  put('look', player && player.setLook, (v) => player.setLook(v));
  put('trail', fx && fx.setTrail, (v) => fx.setTrail(v));
  put('pet', fx && fx.companions, (v) => fx.companions.set(v));
  put('crash', fx && fx.setCrash, (v) => fx.setCrash(v));
  put('coin', fx && fx.setCoinFace, (v) => fx.setCoinFace(v));
  put('sfx', D.audio && D.audio.setJumpPack, (v) => D.audio.setJumpPack(v));
  put('hat', hats, (v) => hats.set(v));
  for (const k of Object.keys(SINK)) {
    if (R[k] === pushed[k]) continue;
    pushed[k] = R[k];
    for (const f of SINK[k]) tell(f, R[k]);
  }
}

const tell = (f, id) => { try { f(id); } catch { /* a listener must not break the shop */ } };
/**
 * Art that lives outside this module follows the equipped item: `kind` is 'livery' (train atlases) or 'banner' (game-over frame).
 * `f(id)` gets the catalog id (never the `_none` row: '' means the default look) after every change, and at once when an item is already worn.
 * Returns an unsubscribe. Nothing registered = no effect.
 */
export function onEquipped(kind, f) {
  const set = SINK[kind];
  if (!set || typeof f !== 'function') return () => {};
  set.add(f);
  if (R.attached && R[kind]) tell(f, R[kind]);
  return () => set.delete(f);
}

/** Start of a run (call after the run mode is set up, so G.daily is known). Returns what was taken: { jet, score, revive, list }. */
export function startRun(game) {
  catchUp();   // the stock another tab left
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
  if (R.daily) return false;
  catchUp();   // a ticket another tab already used is gone
  if (!armed('c_revive')) return false;
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

/** Per frame (any state but pause): shader clock, trail, companion, hat, afterimages. Allocation-free. */
export function update(dt, game, player, fx) {
  if (!R.attached) return;
  R.t += dt;
  const p = player || R.player, f = fx || R.fx;
  const g = game || G, st = g ? g.state : 'menu';
  if (R.look && p.updateLook) p.updateLook(R.t);
  if (R.hat && hats) hats.update(dt, p, g);
  if (!f) return;
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

/** #debug helpers: window.__tabby.cosmetics.debug.* (null on a published page, see DEV above). */
const dbg = !DEV ? null : {
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
export { dbg as debug };
