import { store } from './audio.js';
import { remote, rpc, clientId } from './leaderboard.js';

/**
 * 許願池 client (the view is wish-ui.js). Players send feature wishes and vote; the developer answers with a status and
 * a short public note. Same Supabase project, config (assets/leaderboard.json) and private player id as the leaderboard;
 * Postgres functions from tools/wishes.sql:
 *   tr_wish_submit(p_client, p_text, p_cat)  -> id
 *   tr_wish_list(p_client, p_limit)          -> [{ o_id, o_text, o_cat, o_votes, o_status, o_note, o_mine, o_voted, o_at }]
 *   tr_wish_vote(p_client, p_id)             -> the new vote count (toggles this player's vote)
 * Every call resolves to { ok: true, ... } or { ok: false, code, message } with a zh-Hant message fit to show, never throws:
 *   soon     the world service is not set up (no assets/leaderboard.json) or tools/wishes.sql has not been run (404)
 *   offline  no network / timeout       limit  too many requests    quota  3 wishes a day used     busy  review queue full
 *   rejected / short / long / dup / category   the text or category was refused    error  anything else
 * Wish text is untrusted: the view must only ever put it in with textContent.
 *
 * Local storage: `tabbyrush.wish.sent` = timestamps of wishes sent in the last 24 h (to show the daily allowance),
 * `tabbyrush.wish.seen` = { id: 'status|note' } of the player's own wishes as they last saw them (the 「有新回覆」 dot),
 * `tabbyrush.wish.draft` = { text, cat } (an unsent wish).
 */
export const CATS = ['玩法', '商店', '介面', '問題', '其他'];
export const MIN_LEN = 4;
export const MAX_LEN = 140;
export const DAILY = 3;           // wishes per player per 24 h (the server's limit)

/** Status labels (the badge text) and whether votes are open. Order = how the server sorts them. */
export const STATUS = {
  doing: { label: '開發中', vote: true },
  planned: { label: '會做', vote: true },
  open: { label: '開放投票', vote: true },
  pending: { label: '審核中', vote: false },
  done: { label: '已上線', vote: false },
  declined: { label: '不採納', vote: false },
};

export const MESSAGES = {
  soon: '許願池即將開放，敬請期待！',
  offline: '連不上許願池，請檢查網路後再試一次。',
  limit: '操作太頻繁了，等一下再試試看。',
  quota: `每人每天最多許 ${DAILY} 個願望，明天再來吧！`,
  busy: '許願池現在排隊的人太多，晚點再來看看。',
  rejected: '這段話沒辦法送出：請不要放連結、電話、信箱，也不要有不雅的字詞。',
  short: `再多寫一點吧（至少 ${MIN_LEN} 個字）。`,
  long: `願望太長了（最多 ${MAX_LEN} 個字）。`,
  dup: '你已經許過一樣的願望囉。',
  category: '請選一個分類。',
  closed: '這個願望目前不開放投票。',
  error: '許願池暫時有點問題，請稍後再試。',
};

/* ---------- text rules (same as tr_clean_text in tools/wishes.sql) ---------- */

// The patterns are the SQL ones, character for character, so tools/test_wish.mjs can check the two files agree. \m and \M
// (Postgres: start / end of a word) become \b here. They run on the NFKC form in lower case, which folds full-width
// letters, digits and "＠" to ASCII.
export const PATTERNS = {
  link: String.raw`(://|\mwww\.|\mhttps?\M|\mftp\M|(\mdot|點)\s?(com|net|org|tw|io|gg|cc|me)\M|[a-z0-9-][.。](com|net|org|edu|gov|io|gg|me|tw|cn|jp|hk|cc|co|tv|xyz|top|vip|app|dev|ly|link|club|shop|site|online|info|biz|fun|live|ai|pw|tk)\M|\m(gmail|hotmail|yahoo|outlook|icloud|discord|telegram|whatsapp|wechat)\M|微信|加賴|加line|加我(好友|line|賴|ig|fb|dc|tg|微信))`,
  mail: String.raw`@[a-z0-9_]`,
  num: String.raw`(\d[ .()-]?){8,}|[零〇一二三四五六七八九]{8,}`,
  rep: String.raw`(.)\1{9,}`,
  zh: String.raw`(幹你|幹妳|幹您|操你|操妳|肏|他媽的|你媽|你妈|靠北|靠杯|雞掰|機掰|鸡巴|雞巴|屌你|婊子|賤人|贱人|去死|強姦|强奸|性交|傻逼|煞筆|腦殘|智障|白痴|白癡|妓女|色情|做愛|自慰|約砲|援交)`,
  en: String.raw`\m(fuck\w*|fuk|shit\w*|bitch\w*|cunt|nigg\w*|fag|faggot|whore|slut|rape|porn|pornograph\w*|pornhub|nazi|hitler|retard\w*|asshole|kys)\M`,
};
const RE = {};
for (const [k, p] of Object.entries(PATTERNS)) RE[k] = new RegExp(p.replace(/\\[mM]/g, '\\b'), 'u');

// escapes built from code points (the source stays free of invisible characters, like settings.js)
const BS = String.fromCharCode(92);
const U = (c) => BS + 'u' + c.toString(16).padStart(4, '0');
const CLASS = (ranges) => ranges.map(([a, b]) => U(a) + (b == null ? '' : '-' + U(b))).join('');
const SPACES = new RegExp('[^' + BS + 'S' + U(0xfeff) + ']+', 'g');   // all white space except the BOM (stripped below)
// control, zero-width, bidi-override and filler characters, and angle brackets
const STRIP = new RegExp('[' + CLASS([[0, 0x1f], [0x7f, 0x9f], [0xad], [0x34f], [0x115f, 0x1160], [0x180e], [0x200b, 0x200f],
  [0x202a, 0x202e], [0x2060, 0x2064], [0x2066, 0x2069], [0x3164], [0xfeff], [0xffa0]]) + '<>]', 'g');
const TAGS = /<[^<>]{1,40}>/g;
const FLAT = /[\s._*~!@#$%^&()+=|\/\\'"`,:;?，。！？、；：「」『』（）【】《》〈〉…—～·-]+/g;
const LEET = { 0: 'o', 1: 'i', '!': 'i', 3: 'e', $: 's', 5: 's', '@': 'a' };

/** The text as the server stores it: tags and invisible characters dropped, white space collapsed. */
export function cleanWish(text) {
  const t = [...String(text ?? '')].slice(0, 400).join('');
  return t.replace(TAGS, ' ').replace(SPACES, ' ').replace(STRIP, '').replace(SPACES, ' ').trim();
}

/** True when the (cleaned) text holds a link, a contact detail or abuse: the server would answer 'rejected'. */
export function isBlocked(clean) {
  const f = clean.normalize('NFKC').toLowerCase();
  const low = f.replace(/[01!3$5@]/g, (c) => LEET[c]);
  const words = low.replace(/([a-z])[._*~-](?=[a-z])/g, '$1'); // f.u.c.k -> fuck
  const flat = low.replace(FLAT, '');
  return RE.link.test(f) || RE.mail.test(f) || RE.num.test(f) || RE.rep.test(clean) || RE.zh.test(flat) || RE.en.test(words);
}

/** What the player typed -> { ok: true, text } or { ok: false, reason: 'short' | 'long' | 'rejected' }. */
export function checkWish(text) {
  const t = cleanWish(text);
  const n = [...t].length;
  if (isBlocked(t)) return { ok: false, reason: 'rejected', text: t };
  if (n < MIN_LEN) return { ok: false, reason: 'short', text: t };
  if (n > MAX_LEN) return { ok: false, reason: 'long', text: t };
  return { ok: true, text: t };
}

/* ---------- server calls ---------- */

const fail = (code) => ({ ok: false, code, message: MESSAGES[code] || MESSAGES.error });
let missingAt = 0; // when a 404 said the functions are not installed (asked again after a minute)

/** The server's short message out of an rpc error (PostgREST answers {"code", "message", ...}). */
const serverMessage = (e) => (String(e?.detail ?? '').match(/"message"\s*:\s*"([^"]*)"/) || [])[1] || '';

/** An rpc error as a result object. */
export function explain(e) {
  const st = e?.status, msg = serverMessage(e);
  if (st === 404) { missingAt = Date.now(); return fail('soon'); }
  if (!st) return fail('offline');   // network error or timeout
  if (st === 429) return fail(msg === 'too many wishes' ? 'quota' : msg === 'busy' ? 'busy' : 'limit');
  if (st === 400) {
    if (msg === 'rejected') return fail('rejected');
    if (msg === 'too short') return fail('short');
    if (msg === 'too long') return fail('long');
    if (msg === 'duplicate') return fail('dup');
    if (msg === 'bad category') return fail('category');
    if (msg === 'not open for votes') return fail('closed');
  }
  return fail('error');
}

/** null when the service can be called, else the 'soon' result. */
async function gate() {
  const on = await remote.ready;
  if (!on || !remote.on || (missingAt && Date.now() - missingAt < 60000)) return fail('soon');
  return null;
}

const KNOWN = Object.keys(STATUS);
function norm(r) {
  if (!r || typeof r !== 'object') return null;
  const id = Number(r.o_id);
  if (!Number.isFinite(id)) return null;
  return {
    id,
    text: String(r.o_text ?? '').slice(0, 200),
    cat: CATS.includes(r.o_cat) ? r.o_cat : '其他',
    votes: Math.max(0, Number(r.o_votes) || 0),
    status: KNOWN.includes(r.o_status) ? r.o_status : 'open',
    note: String(r.o_note ?? '').slice(0, 240),
    mine: !!r.o_mine,
    voted: !!r.o_voted,
    at: String(r.o_at ?? ''),
  };
}

/** The public wishes plus this player's own: { ok: true, wishes: [{ id, text, cat, votes, status, note, mine, voted, at }] }. */
export async function list(limit = 50) {
  const g = await gate();
  if (g) return g;
  try {
    const rows = await rpc('tr_wish_list', { p_client: clientId(), p_limit: limit });
    missingAt = 0;
    return { ok: true, wishes: (Array.isArray(rows) ? rows : []).map(norm).filter(Boolean) };
  } catch (e) { return explain(e); }
}

/** Send a wish (checked here first, then by the server). { ok: true, id, wish } with `wish` shaped like a list() entry. */
export async function submit(text, cat = '其他') {
  const chk = checkWish(text);
  if (!chk.ok) return fail(chk.reason);
  if (!CATS.includes(cat)) return fail('category');
  const g = await gate();
  if (g) return g;
  try {
    const id = Number(await rpc('tr_wish_submit', { p_client: clientId(), p_text: chk.text, p_cat: cat })) || 0;
    noteSent();
    if (id) rememberSeen({ id, status: 'pending', note: '' });
    return { ok: true, id, wish: { id, text: chk.text, cat, votes: 0, status: 'pending', note: '', mine: true, voted: false, at: new Date().toISOString() } };
  } catch (e) { return explain(e); }
}

/** Toggle this player's vote: { ok: true, votes } (the new count; whether the vote is on now is the caller's to know). */
export async function vote(id) {
  const g = await gate();
  if (g) return g;
  try {
    const n = await rpc('tr_wish_vote', { p_client: clientId(), p_id: id });
    return { ok: true, votes: Math.max(0, Number(n) || 0) };
  } catch (e) { return explain(e); }
}

/* ---------- local bookkeeping ---------- */

const DAY = 86400000;
const arr = (v) => (Array.isArray(v) ? v : []);

/** Wishes this device sent in the last 24 h (the server counts per player, which is the same thing here). */
export function sentToday(now = Date.now()) {
  return arr(store.get('wish.sent', [])).filter((t) => Number.isFinite(t) && t > now - DAY && t <= now + DAY);
}
function noteSent(now = Date.now()) { store.set('wish.sent', [...sentToday(now), now].slice(-DAILY * 2)); }
/** Wishes left for today by this device's count (0..DAILY). */
export const quotaLeft = (now = Date.now()) => Math.max(0, DAILY - sentToday(now).length);

const sig = (w) => `${w.status}|${w.note || ''}`;
const seenMap = () => { const s = store.get('wish.seen', {}); return s && typeof s === 'object' && !Array.isArray(s) ? s : {}; };
function rememberSeen(w) { store.set('wish.seen', { ...seenMap(), [w.id]: sig(w) }); }

/** Does the player have any wish on record (so the menu may look for answers)? */
export const hasWished = () => Object.keys(seenMap()).length > 0 || sentToday().length > 0;

/** How many of the player's own wishes changed (status or note) since they last looked. */
export function answerCount(wishes) {
  const seen = seenMap();
  return wishes.filter((w) => w.mine && seen[w.id] !== undefined && seen[w.id] !== sig(w)).length;
}

/** The player has seen these: their own wishes are remembered as they are now (forgetting ones that are gone). */
export function markSeen(wishes) {
  const next = {};
  for (const w of wishes) if (w.mine) next[w.id] = sig(w);
  store.set('wish.seen', next);
}

/** The unsent wish (typed text and chosen category), so closing the card does not lose it. */
export const loadDraft = () => { const d = store.get('wish.draft', null); return d && typeof d.text === 'string' ? { text: d.text.slice(0, MAX_LEN), cat: CATS.includes(d.cat) ? d.cat : CATS[0] } : null; };
export const saveDraft = (text, cat) => store.set('wish.draft', text ? { text, cat } : null);
