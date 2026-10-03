import { store } from './audio.js';
import { settings } from './settings.js';

/**
 * Leaderboards.
 *
 * Local (always on), localStorage `tabbyrush.board`:
 *   { v: 1, all: [entry x10], daily: { day, list: [entry x10] } }   entry: { n, s, d, c, t, me? }
 * Normal runs go to `all`, daily-challenge runs to today's `daily` list (the seeded track is the same for everyone).
 *
 * Global (optional): `assets/leaderboard.json` = { "provider": "supabase", "url": "https://<ref>.supabase.co",
 * "anonKey": "<public anon key>" } turns on the world board, backed by two Postgres functions (tools/leaderboard.sql):
 *   tr_submit(p_client, p_name, p_score, p_dist, p_coins, p_secs, p_day) -> [{ o_board, o_rank, o_best }]
 *   tr_top(p_board, p_limit, p_client)                                -> [{ o_name, o_score, o_dist, o_coins, o_at, o_me }]
 * Boards: 'all' + 'week:IYYY-IW' (normal runs; tr_top takes 'week' for the current one) and 'day:YYYY-MM-DD'
 * (daily runs). Each player keeps one row per board (their best).
 * A run that can't be sent (offline) waits in `tabbyrush.board.pending` and goes out with the next one.
 */
const MAX = 10;
const DEFAULT_NAME = '虎斑跑者';
let memBoard = null;  // session copy when storage is blocked or full
let cid = '';

function loadLocal() {
  const b = store.get('board', null) ?? memBoard;
  const list = (l) => (Array.isArray(l) ? l.filter((e) => e && Number.isFinite(e.s)).slice(0, MAX) : []);
  return b && typeof b === 'object'
    ? { v: 1, all: list(b.all), daily: { day: Number(b.daily?.day) || 0, list: list(b.daily?.list) } }
    : { v: 1, all: [], daily: { day: 0, list: [] } };
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
 * Returns the 1-based rank on that board (0 = not in the top 10).
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
  memBoard = b;
  store.set('board', b);
  return list.indexOf(e) + 1;
}

/** Local list: 'all' or 'daily' (today's, empty when the stored day is old). */
export function localList(kind, today = 0) {
  const b = loadLocal();
  if (kind === 'daily') return b.daily.day === today ? b.daily.list : [];
  return b.all;
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

async function rpc(fn, body) {
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
    return await r.json();
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
 * Send a finished run to the world board. Resolves { rank, best } or null (off / offline / refused).
 * An unsent run is kept (best one per board) and retried by flushPending().
 */
export async function submitRemote({ score, dist, coins, secs, day = 0 }) {
  if (!(await remote.ready) || score <= 0) return null;
  const run = { score, dist, coins, secs: Math.max(1, Math.round(secs)), day };
  try {
    const rows = await rpc('tr_submit', {
      p_client: clientId(), p_name: playerName(), p_score: Math.floor(score), p_dist: Math.floor(dist),
      p_coins: Math.floor(coins), p_secs: run.secs, p_day: day ? isoDay(day) : null,
    });
    dropPending(run);
    const list = Array.isArray(rows) ? rows : rows ? [rows] : [];
    const key = boardKey(day);
    const pick = (b) => { const r = list.find((x) => x && x.o_board === b); return r ? { rank: Number(r.o_rank) || 0, best: Number(r.o_best) || score } : null; };
    const main = pick(key) || pick(list[0]?.o_board);
    if (!main) return null;
    const wrow = list.find((x) => x && String(x.o_board).startsWith('week:'));
    const week = wrow ? { rank: Number(wrow.o_rank) || 0, best: Number(wrow.o_best) || score, wk: String(wrow.o_board) } : null;
    const ranks = store.get('board.ranks', {});
    const keep = ranks && typeof ranks === 'object' ? Object.fromEntries(Object.entries(ranks).filter(([k]) => k === 'all' || k === 'week' || k === key)) : {};
    keep[key] = main;
    if (week) keep.week = week;
    store.set('board.ranks', keep);
    return { ...main, week };
  } catch (e) {
    // 429 (rate limited), 5xx and network errors wait for a later try; other 4xx = refused for good
    if (!(e.status >= 400 && e.status < 500) || e.status === 429) keepPending(run);
    else dropPending(run, true);
    return null;
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

let flushing = false;
/** Retry runs that couldn't be sent earlier (menu). Each leaves the queue only once sent or refused for good. */
export async function flushPending() {
  if (flushing || !(await remote.ready)) return;
  flushing = true;
  try {
    const p = store.get('board.pending', []);
    for (const run of Array.isArray(p) ? p : []) {
      if (!run || !(run.score > 0)) continue;
      await submitRemote(run);
      const left = store.get('board.pending', []);
      if (Array.isArray(left) && left.some((x) => x && x.day === run.day && x.score === run.score)) break; // offline / throttled
    }
  } finally { flushing = false; }
}

/** The player's last known world rank on a board: { rank, best } or null. */
export function myRemoteRank(board) {
  const r = store.get('board.ranks', {});
  const e = r && typeof r === 'object' ? r[board] : null;
  if (!e || !(e.rank > 0)) return null;
  return board === 'week' && e.wk !== weekKey() ? null : e; // last week's rank is history
}

/** Top entries of a world board: [{ name, score, dist, coins, at, me }], or throws when unreachable. */
export async function fetchRemote(board, limit = 50) {
  if (!(await remote.ready)) return [];
  const rows = await rpc('tr_top', { p_board: board, p_limit: limit, p_client: clientId() });
  return (Array.isArray(rows) ? rows : []).map((r) => ({
    name: String(r.o_name ?? ''), score: Number(r.o_score) || 0, dist: Number(r.o_dist) || 0,
    coins: Number(r.o_coins) || 0, at: r.o_at, me: !!r.o_me,
  }));
}
