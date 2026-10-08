import { BETA } from './channel.js';
import { store } from './audio.js';
import { settings } from './settings.js';
import { dayKey } from './daily.js';

/**
 * Leaderboards.
 *
 * Local (always on), localStorage `tabbyrush.board`:
 *   { v: 1, rev, all: [entry x10], daily: { day, list: [entry x10] } }   entry: { n, s, d, c, t, me? }
 * Normal runs go to `all`, daily-challenge runs to today's `daily` list (the seeded track is the same for everyone).
 * `rev` counts saves: when the storage copy is older than the session copy (a write that failed, e.g. quota full),
 * the session copy wins.
 *
 * Global (optional): `assets/leaderboard.json` = { "provider": "supabase", "url": "https://<ref>.supabase.co",
 * "anonKey": "<public anon key>" } turns on the world board, backed by Postgres functions (tools/leaderboard.sql):
 *   tr_submit(p_client, p_name, p_score, p_dist, p_coins, p_secs, p_day) -> [{ o_board, o_rank, o_best }]
 *   tr_top(p_board, p_limit, p_client)                                -> [{ o_name, o_score, o_dist, o_coins, o_at, o_me }]
 *   tr_rename(p_client, p_name)  (optional, tools/loop/requests.md)   -> name-only update of the player's rows
 * Boards: 'all' + 'week:IYYY-IW' (normal runs; tr_top takes 'week' for the current one) and 'day:YYYY-MM-DD'
 * (daily runs). Each player keeps one row per board (their best). Ranks tie like the server's: 1 + players with a
 * higher score (see rankOf in board-ui.js).
 * A run that can't be sent (offline) waits in `tabbyrush.board.pending` and goes out with the next one.
 *
 * Renaming (any screen -> settings.set('name')) is handled here, once, whichever screen it came from:
 *   - local rows take the new name at once (all of them: they are all this device's player);
 *   - `fetchRemote` shows the player's own world rows (o_me) under the current name before the server knows it;
 *   - the server learns it through tr_rename, 400 ms after the last change; offline / throttled tries repeat (the
 *     `board.nameDirty` flag survives a reload). Without tr_rename on the server (404) the name rides on the next
 *     tr_submit, which always carries it. Scores are never re-sent for a rename.
 */
const MAX = 10;
const DEFAULT_NAME = '虎斑跑者';
let memBoard = null;  // session copy when storage is blocked or full
let cid = '';

function loadLocal() {
  const stored = store.get('board', null);
  // the storage copy, unless this session saved a newer one that could not be written
  const b = stored && typeof stored === 'object' && (!memBoard || (Number(stored.rev) || 0) >= (memBoard.rev || 0)) ? stored : memBoard;
  const list = (l) => (Array.isArray(l) ? l.filter((e) => e && Number.isFinite(e.s)).slice(0, MAX) : []);
  return b && typeof b === 'object'
    ? { v: 1, rev: Number(b.rev) || 0, all: list(b.all), daily: { day: Number(b.daily?.day) || 0, list: list(b.daily?.list) } }
    : { v: 1, rev: 0, all: [], daily: { day: 0, list: [] } };
}

function saveLocal(b) {
  b.rev = (Number(b.rev) || 0) + 1;
  memBoard = b;
  store.set('board', b);
}

/** The name shown on boards: the chosen one, else 虎斑跑者 + four digits from the device id. */
export function playerName() {
  return settings.get('name') || `${DEFAULT_NAME}${clientId().replace(/\D/g, '').slice(0, 4).padEnd(4, '7')}`;
}

/** A random id for this browser (one row per player per global board). */
export function clientId() {
  if (cid) return cid;
  let id = store.get('cid', '');
  if (!/^[0-9a-f-]{36}$/.test(id)) {
    id = crypto.randomUUID ? crypto.randomUUID()
      : '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) => (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16));
    store.set('cid', id);
  }
  return (cid = id);
}

const isoDay = (day) => `${Math.floor(day / 10000)}-${String(Math.floor(day / 100) % 100).padStart(2, '0')}-${String(day % 100).padStart(2, '0')}`;

/**
 * Record a finished run on the local boards. `day` = daily-challenge day key (yyyymmdd) or 0 for a normal run.
 * Returns the 1-based rank on that board (0 = not in the top 10; equal scores share a rank).
 */
export function recordLocal({ score, dist, coins, day = 0 }) {
  const b = loadLocal();
  const e = { n: playerName(), s: score, d: dist, c: coins, t: Date.now() };
  let list;
  if (day) {
    if (b.daily.day !== day) b.daily = { day, list: [] };
    list = b.daily.list;
  } else list = b.all;
  for (const x of list) delete x.me;
  e.me = true;
  list.push(e);
  list.sort((a, c) => c.s - a.s || a.t - c.t);
  list.length = Math.min(list.length, MAX);
  saveLocal(b);
  // ties share a rank, like the server's (and the board card's)
  return list.includes(e) ? list.filter((x) => x.s > e.s).length + 1 : 0;
}

/**
 * Players from before the leaderboard already have a best score: start their local board with it,
 * so the first new run isn't announced as "第 1 名" below that best.
 */
export function seedLocal(best, dist = 0) {
  const b = loadLocal();
  if (b.all.length || !(best > 0) || store.get('board.seeded', false)) return;
  b.all.push({ n: playerName(), s: Math.floor(best), d: Math.floor(dist), c: 0, t: 0 });
  saveLocal(b);
  store.set('board.seeded', true);
}

/** Local list: 'all' or 'daily' (today's, empty when the stored day is old). */
export function localList(kind, today = 0) {
  const b = loadLocal();
  if (kind === 'daily') return b.daily.day === today ? b.daily.list : [];
  return b.all;
}

/** Every local row is this device's player: after a rename they all carry the new name. */
function renameLocal() {
  const b = loadLocal(), n = playerName();
  let hit = false;
  for (const e of [...b.all, ...b.daily.list]) if (e.n !== n) { e.n = n; hit = true; }
  if (hit) saveLocal(b);
}

/* ---------- global board ---------- */

let cfg = null;
export const remote = { on: false, ready: Promise.resolve(false) };

function jwtRole(k) {
  try { return JSON.parse(atob(k.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).role; } catch { return ''; }
}

/** Read assets/leaderboard.json once at boot; the world board stays off unless it is valid. */
export function initRemote() {
  remote.ready = fetch('assets/leaderboard.json', { cache: 'no-cache' })
    .then((r) => (r.ok ? r.json() : null))
    .then((c) => {
      const okUrl = c && typeof c.url === 'string' && (/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(c.url)
        || (c.test === true && /^http:\/\/127\.0\.0\.1:\d+$/.test(c.url)));
      const okKey = c && typeof c.anonKey === 'string' && c.anonKey.length > 20 && !c.anonKey.startsWith('sb_secret_')
        && (!c.anonKey.startsWith('eyJ') || jwtRole(c.anonKey) === 'anon');
      if (c && c.provider === 'supabase' && okUrl && okKey) {
        cfg = { url: c.url, key: c.anonKey };
        remote.on = true;
      }
      return remote.on;
    })
    .catch(() => false);
  return remote.ready;
}

/** POST one Supabase RPC (9 s timeout). Throws an Error with `.status` / `.detail` on a refusal; also used by wish.js. */
export async function rpc(fn, body) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 9000);
  try {
    const r = await fetch(`${cfg.url}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      // legacy anon keys are JWTs and also go in Authorization; new sb_publishable_ keys only in apikey
      headers: cfg.key.startsWith('eyJ')
        ? { apikey: cfg.key, Authorization: `Bearer ${cfg.key}`, 'Content-Type': 'application/json' }
        : { apikey: cfg.key, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      const err = new Error(`leaderboard ${fn} ${r.status}`);
      err.status = r.status;
      err.detail = t.slice(0, 200);
      throw err;
    }
    const t = await r.text(); // (a function that returns nothing answers with an empty body)
    return t ? JSON.parse(t) : null;
  } finally { clearTimeout(timer); }
}

/** Board key for a day key (0 = the all-time board of normal runs). */
export const boardKey = (day) => (day ? `day:${isoDay(day)}` : 'all');

/** This week's board key, as the server names it (ISO week of the UTC date: resets Monday 00:00 UTC). */
export function weekKey(d = new Date()) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const wd = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - wd);
  const y = t.getUTCFullYear();
  const w = Math.ceil(((t - Date.UTC(y, 0, 1)) / 86400000 + 1) / 7);
  return `week:${y}-${String(w).padStart(2, '0')}`;
}

/**
 * Send a finished run to the world board. Resolves { rank, best, week } (rank 0 = no row for this run's board;
 * week = { rank, best, wk } for normal runs) or null (off / offline / refused).
 * An unsent run is kept (best one per board, with the week it was earned in) and retried by flushPending().
 */
export async function submitRemote({ score, dist, coins, secs, day = 0, wk = '' }) {
  if (BETA || !(await remote.ready) || score <= 0) return null; // the beta build never posts to the world boards (channel.js)
  const run = { score, dist, coins, secs: Math.max(1, Math.round(secs)), day, wk: wk || weekKey() };
  // A normal run queued in an earlier week would count in THIS week's board (the server dates it at arrival). It adds
  // nothing to the all-time board unless it beats the known all-time best: then drop it. (An all-time record from last
  // week still goes out; the server has no way yet to keep it off the weekly board, see requests.md.)
  if (!day && run.wk !== weekKey()) {
    const known = store.get('board.ranks', {})?.all?.best;
    if (known >= score) { dropPending(run); return null; }
  }
  const name = playerName();
  let sent = false;
  try {
    const rows = await rpc('tr_submit', {
      p_client: clientId(), p_name: name, p_score: Math.floor(score), p_dist: Math.floor(dist),
      p_coins: Math.floor(coins), p_secs: run.secs, p_day: day ? isoDay(day) : null,
    });
    dropPending(run);
    sent = true;
    const list = Array.isArray(rows) ? rows : rows ? [rows] : [];
    const key = boardKey(day);
    const pick = (b) => { const r = list.find((x) => x && x.o_board === b); return r ? { rank: Number(r.o_rank) || 0, best: Number(r.o_best) || score } : null; };
    // only this run's own board counts as its rank (the server may answer with just the week row, e.g. when the
    // all-time row was trimmed in the same call)
    const main = pick(key);
    const wrow = list.find((x) => x && String(x.o_board).startsWith('week:'));
    const week = wrow ? { rank: Number(wrow.o_rank) || 0, best: Number(wrow.o_best) || score, wk: String(wrow.o_board) } : null;
    if (!main && !week) return null;
    const ranks = store.get('board.ranks', {});
    const old = ranks && typeof ranks === 'object' ? ranks : {};
    // 'all' + 'week' + the two newest daily boards (a normal run must not forget today's daily rank)
    const keep = {};
    for (const k of ['all', 'week', ...Object.keys(old).filter((k) => k.startsWith('day:') && k !== key).sort().slice(-1)]) if (old[k]) keep[k] = old[k];
    if (main) keep[key] = main;
    if (week) keep.week = week;
    store.set('board.ranks', keep);
    return { rank: main ? main.rank : 0, best: main ? main.best : score, week };
  } catch (e) {
    // 429 (rate limited), 5xx and network errors wait for a later try; other 4xx = refused for good
    if (!(e.status >= 400 && e.status < 500) || e.status === 429) keepPending(run);
    else dropPending(run, true);
    return null;
  } finally {
    // The run carried the name to the all-time + weekly rows. Renamed meanwhile: the server holds the old name again.
    if (sent) { if (name !== playerName()) { setDirty(true); scheduleSync(); } else if (!day) setDirty(false); }
  }
}

function keepPending(run) {
  const p = store.get('board.pending', []);
  const list = Array.isArray(p) ? p.filter((x) => x && x.day !== run.day) : [];
  const old = Array.isArray(p) ? p.find((x) => x && x.day === run.day) : null;
  list.push(old && old.score >= run.score ? old : run);
  store.set('board.pending', list.slice(-4));
}

/** Sent (drops this and lower queued runs of its board) or refused for good (`exact`: just this one). */
function dropPending(run, exact = false) {
  const p = store.get('board.pending', []);
  if (Array.isArray(p) && p.length) {
    store.set('board.pending', p.filter((x) => x && !(x.day === run.day && (exact ? x.score === run.score : x.score <= run.score))));
  }
}

let flushing = false, flushAgain = false;
/**
 * Retry runs that couldn't be sent earlier (menu), then a rename the server hasn't heard yet. Each run leaves the
 * queue only once sent or refused for good. A call that lands while a flush is running makes it look at the queue once
 * more (new entries wait in it).
 */
export async function flushPending() {
  if (!(await remote.ready)) return;
  if (flushing) { flushAgain = true; return; }
  flushing = true;
  try {
    do {
      flushAgain = false;
      const p = store.get('board.pending', []);
      for (const run of Array.isArray(p) ? p : []) {
        if (!run || !(run.score > 0)) continue;
        await submitRemote(run);
        const left = store.get('board.pending', []);
        if (Array.isArray(left) && left.some((x) => x && x.day === run.day && x.score === run.score)) return; // offline / throttled
      }
    } while (flushAgain);
  } finally { flushing = false; }
  if (isDirty()) await pushName();
}

/* ---------- renaming ---------- */

export const syncOpts = { delay: 400, retry: [6500, 20000, 60000] }; // ms: wait after the last change; later tries
let dirtyMem = false; // (storage that refuses writes)
const isDirty = () => dirtyMem || store.get('board.nameDirty', false) === true;
const setDirty = (on) => {
  dirtyMem = on;
  if ((store.get('board.nameDirty', false) === true) !== on) store.set('board.nameDirty', on);
};

const renameListeners = new Set(), syncListeners = new Set();
/** Run `f()` right after the player's name changed (the local rows already carry it). Returns the unsubscribe function. */
export function onRename(f) { renameListeners.add(f); return () => renameListeners.delete(f); }
/**
 * `f(state, changed)` while the world boards are told: 'syncing' (waiting / sending), 'done' (the server has the name;
 * `changed` = it was really sent, so a board on screen can reload) or 'later' (offline / throttled / no tr_rename on
 * the server yet: it goes out with the next try or the next run). Local-only play reports 'done' at once.
 */
export function onNameSync(f) { syncListeners.add(f); return () => syncListeners.delete(f); }
const say = (state, changed = false) => { for (const f of syncListeners) f(state, changed); };

let debounceT = 0, retryT = 0, pushing = false, noRenameRpc = false, settle = null, syncing = Promise.resolve();
/** Resolves when the latest rename has been handled (sent, or queued for a retry). */
export const nameSynced = () => syncing;

function scheduleSync() {
  if (!remote.on || !onServer()) { setDirty(false); say('done'); return; } // nothing on a world board to rename
  if (!settle) syncing = new Promise((r) => { settle = r; });
  say('syncing');
  clearTimeout(debounceT);
  debounceT = setTimeout(pushName, syncOpts.delay);
}

/** A player with no row on any world board has nothing to rename: their first run carries the name. */
function onServer() {
  const r = store.get('board.ranks', {});
  return (r && typeof r === 'object' && Object.keys(r).length > 0) || myTag() !== '';
}

function retryName(n) {
  clearTimeout(retryT);
  if (n >= syncOpts.retry.length) return;
  retryT = setTimeout(async () => { await pushName(); if (isDirty() && !noRenameRpc) retryName(n + 1); }, syncOpts.retry[n]);
  retryT.unref?.(); // (node tests)
}

async function pushName() {
  clearTimeout(debounceT);
  if (pushing) return; // the running push looks again when it ends
  pushing = true;
  const name = playerName();
  let again = false;
  try {
    if (BETA || !isDirty() || !(await remote.ready) || !onServer()) { setDirty(false); say('done'); return; } // beta: renames stay local
    if (noRenameRpc) { say('later'); return; }
    say('syncing');
    await rpc('tr_rename', { p_client: clientId(), p_name: name });
    again = name !== playerName();
    if (!again) { setDirty(false); say('done', true); }
  } catch (e) {
    if (e.status === 404) { noRenameRpc = true; say('later'); } // tr_rename isn't installed yet: the next run carries the name
    else if (e.status >= 400 && e.status < 500 && e.status !== 429) { setDirty(false); say('done'); } // refused for good
    else { say('later'); again = name !== playerName(); if (!again) retryName(0); }
  } finally {
    pushing = false;
    if (again) scheduleSync(); // renamed again meanwhile
    else if (settle) { const r = settle; settle = null; r(); }
  }
}

let lastName = settings.get('name');
settings.onChange((k) => {
  if (k !== 'name' || settings.get('name') === lastName) return;
  lastName = settings.get('name');
  renameLocal();
  for (const f of renameListeners) f();
  setDirty(true);
  scheduleSync();
});

/** The player's last known world rank on a board: { rank, best } or null. */
export function myRemoteRank(board) {
  const r = store.get('board.ranks', {});
  const e = r && typeof r === 'object' ? r[board] : null;
  if (!e || !(e.rank > 0)) return null;
  return board === 'week' && e.wk !== weekKey() ? null : e; // last week's rank is history
}

/**
 * Top entries of a world board: [{ name, tag, score, dist, coins, at, me }], or throws when unreachable.
 * tag = the server's 4-digit player number ('' from an older server), shown after the name to tell same names apart.
 */
export async function fetchRemote(board, limit = 50) {
  if (!(await remote.ready)) return [];
  const rows = await rpc('tr_top', { p_board: board, p_limit: limit, p_client: clientId() });
  // the player's own rows wear the current name even before the server has heard it (a rename, a fetch that was in flight)
  const list = (Array.isArray(rows) ? rows : []).map((r) => ({
    name: r.o_me ? playerName() : String(r.o_name ?? ''), tag: /^[0-9]{4}$/.test(String(r.o_tag ?? '')) ? String(r.o_tag) : '',
    score: Number(r.o_score) || 0, dist: Number(r.o_dist) || 0, coins: Number(r.o_coins) || 0, at: r.o_at, me: !!r.o_me,
  }));
  const mine = list.find((r) => r.me && r.tag);
  if (mine) store.set('board.tag', mine.tag);
  return list;
}

/** This player's number on the world boards ('' until a board including them has been seen). */
export const myTag = () => { const t = store.get('board.tag', ''); return /^[0-9]{4}$/.test(t) ? t : ''; };
