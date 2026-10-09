import { store as saved } from './audio.js';

/*
 * 更新日誌: what changed in each version, the version pill in the menu's top-left corner, and a one-time "已更新到 v1.x" banner
 * for players whose last-seen version is older. Everything is built from JavaScript (like wish-ui.js); the stylesheet link
 * is in index.html, the styles in changelog.css. Texts are plain strings and only ever go in with textContent.
 *
 * Screens: #changelog (the card, a ui.screens member), the pill (.cl-ver) and the banner (.cl-banner) live in #app and show
 * only while body[data-screen="menu"]; a row in the 設定 card (for the pause menu and short landscape phones, where the pill
 * is hidden) opens the card too. Saved: localStorage `tabbyrush.ver` = the last version announced to this player.
 */

/**
 * Newest first. `v` is "major.minor" (the number on the pill), `date` the release day (YYYY-MM-DD), `title` the one-line
 * headline (also the banner's second line and the news chip's text), `items` 3-6 short player-facing bullets.
 * `draft: true` = notes for a version that is still in testing (shown with a 測試中 tag): at release the producer removes
 * `draft`, sets `date` and trims the bullets to what really shipped. VERSION follows the newest entry.
 */
export const CHANGELOG = [
  {
    v: '1.3', date: '2026-10-09', title: '12 張新地圖・新音樂・72 件新品',
    items: [
      '12 張新地圖：夜市、廟口、雪國、溫泉街……每局起點隨機。',
      '造型店多了 72 件新品：布丁胖龍、頭飾、金幣外觀、列車塗裝。',
      '第一個尖峰時段變溫和，之後更擠；跑過 3 公里越跑越快。',
      '每日挑戰不再加任務倍率，大家在同一條賽道上公平比。',
      '修正多開分頁會吃掉進度的問題，排行榜成績上傳更穩。',
      '每張地圖都有自己的音樂，大廳也會換成下一局的地圖。',
    ],
  },
  {
    v: '1.2', date: '2026-10-08', title: '尖峰時段・段位徽章・更新日誌',
    items: [
      '尖峰時段：速度加快、迎面列車變多、金幣更多，撐過去有獎勵。',
      '更新日誌：點選單左上角的版本號或「設定」，看每次更新了什麼。',
      '段位徽章：任務等級對應見習到傳說七個段位，選單和結算都看得到。',
      '新圖示與音效：造型店、道具和段位有新圖示，買東西、升級、開箱也有新音效。',
      '手機更省記憶體：貼圖變小、音樂改單聲道。',
      '任務調整：新增「撐過尖峰時段」任務，新手的任務目標更貼近你的進度。',
    ],
  },
  {
    v: '1.1', date: '2026-10-08', title: '更快更刺激・造型店・許願池',
    items: [
      '速度更快、列車和柵欄更密，越跑越刺激。',
      '任務改版：依你的節奏出題，完成就領金幣，全部做完再領獎勵。',
      '下一個目標：點任務設為目標，選單和結算畫面會提醒你。',
      '造型店：換造型、軌跡、夥伴，還有道具和驚喜箱。',
      '許願池：寫下想要的功能，也能幫別人的願望投票。',
      '改名馬上同步到排行榜、拿掉新手教學、手機更順暢。',
    ],
  },
  {
    v: '1.0', date: '2026-10-04', title: '全球排行榜・挑戰朋友',
    items: [
      '全球排行榜：本週、總榜和每日挑戰，看看你排第幾。',
      '挑戰朋友：結算畫面一鍵產生連結，手機還有成績分享圖。',
      '設定：特效強度、減少閃爍、鏡頭晃動、音量和震動。',
      '特效預設更柔和，不再閃得刺眼。',
      '排行榜名稱：第一次開跑時取名，之後可在設定修改。',
      '最佳距離終點線、怎麼玩說明，還能加到手機主畫面。',
    ],
  },
];

export const VERSION = CHANGELOG[0].v;

const SEEN_KEY = 'ver';       // localStorage `tabbyrush.ver`
const BANNER_MS = 8000;       // the banner leaves by itself (paused while the pointer or focus is on it)

/* ---------- versions ---------- */

const parse = (v) => {
  const m = /^(\d+)\.(\d+)(?:\.(\d+))?$/.exec(typeof v === 'string' ? v.trim() : '');
  return m ? [+m[1], +m[2], +(m[3] || 0)] : null;
};

/** -1 / 0 / 1 like a - b for "1.2" style versions (numeric parts: 1.10 > 1.9); NaN when either is not a version. */
export function cmpVersion(a, b) {
  const x = parse(a), y = parse(b);
  if (!x || !y) return NaN;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
}

/**
 * What to do about `current` for a player whose saved version is `seen`:
 *   'none'  already announced (or the save is from a newer build: a rolled-back site must not nag or lower it)
 *   'mark'  a brand-new player (`fresh`): nothing to compare with, remember the version silently
 *   'show'  announce it; also for a missing / unreadable `seen` (players from before this feature existed)
 */
export function announceKind(seen, current = VERSION, fresh = false) {
  if (cmpVersion(current, seen) <= 0) return 'none';
  return fresh ? 'mark' : 'show';
}

/** 2026-10-08 -> 2026/10/08 (the entry's own digits, no time zones involved). */
export const fmtDate = (iso) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.replace(/-/g, '/') : '');

/* ---------- view ---------- */

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const X_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11" fill="none" stroke="#3b1d0e" stroke-width="3" stroke-linecap="round"/></svg>';
const CHEVRON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.5 5.5 15 12l-6.5 6.5" fill="none" stroke="#3b1d0e" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const chevron = () => { const i = el('i', 'cl-chev'); i.innerHTML = CHEVRON; return i; };
const usable = (n) => !!n && n !== document.body && !n.hidden && n.getClientRects().length > 0;   // can take the focus now

export class ChangelogUI {
  constructor(ui, { click, store = saved } = {}) {
    this.ui = ui;
    this.click = click || (() => {});
    this.store = store;
    this.from = 'menu';     // the screen the card returns to: 'menu' | 'settings'
    this.opener = null;
    this.bannerT = 0;
    this.hover = false;     // the pointer is over the banner
    this.focused = false;   // the keyboard focus is inside it
    if (!ui.screens.includes('changelog')) ui.screens.push('changelog');
    this.build();
    // Esc closes; other keys pressed with the focus outside the card must not reach the menu's Enter / Space = start a run
    window.addEventListener('keydown', (e) => {
      if (document.body.dataset.screen !== 'changelog') return;
      if (e.code === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.close();
      } else if (!this.root.contains(e.target)) e.stopPropagation();
    }, true);
  }

  build() {
    const sec = el('section', 'screen dim');
    sec.id = 'changelog';
    sec.hidden = true;
    const card = el('div', 'card cl-card');
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-labelledby', 'cl-title');
    const title = el('h2', null, '更新日誌');
    title.id = 'cl-title';
    this.list = el('div', 'cl-list');
    this.list.tabIndex = 0;
    this.list.setAttribute('role', 'region');
    this.list.setAttribute('aria-label', '各版本的更新內容');
    this.items = CHANGELOG.map((e, i) => this.entry(e, i));
    for (const it of this.items) this.list.append(it.art);
    this.items.forEach((_, i) => this.fold(i, i === 0));
    this.back = el('button', 'btn btn-alt', '知道了');
    this.back.type = 'button';
    this.back.addEventListener('click', () => this.close());
    const actions = el('div', 'card-actions');
    actions.append(this.back);
    card.append(title, el('p', 'cl-now', `目前版本 v${VERSION}`), this.list, actions);
    sec.append(card);
    // keys typed inside the card never reach main.js (Space / Enter must not start a run); scrolling keys still work
    sec.addEventListener('keydown', (e) => { e.stopPropagation(); });
    this.root = sec;

    this.pill = el('button', 'cl-ver', `v${VERSION}`);
    this.pill.type = 'button';
    this.pill.title = '更新日誌';
    this.pill.setAttribute('aria-label', `更新日誌，目前版本 v${VERSION}`);
    this.pill.addEventListener('click', () => this.open());

    const bn = el('div', 'cl-banner');
    bn.hidden = true;
    bn.setAttribute('role', 'region');
    bn.setAttribute('aria-label', '版本更新');
    const text = el('div', 'cl-bn-text');
    this.bnTitle = el('b');
    this.bnSub = el('span', 'cl-bn-sub');
    text.append(this.bnTitle, this.bnSub);
    const go = el('button', 'btn cl-bn-go', '查看');
    go.type = 'button';
    go.addEventListener('click', () => this.open());
    this.bnClose = el('button', 'icon-btn cl-bn-x');
    this.bnClose.type = 'button';
    this.bnClose.setAttribute('aria-label', '關閉更新通知');
    this.bnClose.innerHTML = X_SVG;
    this.bnClose.addEventListener('click', () => { this.click(); this.hideBanner(); });
    bn.append(text, go, this.bnClose);
    // the countdown runs only while neither the pointer nor the focus is on the banner (focus moving from 查看 to × stays inside)
    bn.addEventListener('pointerenter', () => { this.hover = true; this.armBanner(); });
    bn.addEventListener('pointerleave', () => { this.hover = false; this.armBanner(); });
    bn.addEventListener('focusin', () => { this.focused = true; this.armBanner(); });
    bn.addEventListener('focusout', (e) => { this.focused = bn.contains(e.relatedTarget); this.armBanner(); });
    this.banner = bn;
    // the announcement for screen readers: a live region that is always in the page, filled when the banner shows
    this.live = el('p', 'sr-only');
    this.live.setAttribute('role', 'status');
    this.live.setAttribute('aria-live', 'polite');

    (document.getElementById('app') || document.body).append(sec, this.pill, bn, this.live);

    // 設定 -> 更新日誌: reachable from the pause menu and wherever the pill is hidden (short landscape phones)
    const set = document.querySelector('#settings .set-list');
    if (set) {
      const row = el('button', 'set-row cl-set-row');
      row.type = 'button';
      const label = el('span', 'set-label', '更新日誌');
      label.append(el('small', null, '看看每個版本加了什麼'));
      const side = el('span', 'cl-set-side');
      side.append(el('b', null, `v${VERSION}`), chevron());
      row.append(label, side);
      row.addEventListener('click', () => this.open());
      set.append(row);
      this.setRow = row;
    }
  }

  /** One version: a header button (version, headline, date + tags) that folds its bullet list. */
  entry(e, i) {
    const art = el('article', 'cl-item');
    art.dataset.v = e.v;
    const btn = el('button', 'cl-toggle');
    btn.type = 'button';
    btn.setAttribute('aria-controls', `cl-b-${i}`);
    const sub = el('span', 'cl-d', fmtDate(e.date));
    if (i === 0) sub.append(el('i', 'cl-tag cl-new', '最新'));
    if (e.draft) sub.append(el('i', 'cl-tag cl-test', '測試中'));
    btn.append(el('span', 'cl-v', `v${e.v}`), el('span', 'cl-t', e.title), sub, chevron());
    const h = el('h3', 'cl-h');
    h.append(btn);
    const ul = el('ul', 'cl-items');
    ul.id = `cl-b-${i}`;
    for (const t of e.items) ul.append(el('li', null, t));
    art.append(h, ul);
    btn.addEventListener('click', () => { this.click(); this.fold(i, ul.hidden); });
    return { art, btn, ul };
  }

  fold(i, open) {
    const it = this.items[i];
    it.ul.hidden = !open;
    it.btn.setAttribute('aria-expanded', String(open));
    it.art.classList.toggle('cl-open', open);
  }

  /* ---------- the banner ---------- */

  /** Seen-version check for the boot (and the first menu after an update): shows the banner when it is news to this player. */
  check({ fresh = false } = {}) {
    const kind = announceKind(this.store.get(SEEN_KEY, ''), VERSION, fresh);
    if (kind !== 'none') this.store.set(SEEN_KEY, VERSION);
    if (kind === 'show') this.showBanner();
    return kind === 'show';
  }

  showBanner() {
    this.bnTitle.textContent = `已更新到 v${VERSION}`;
    this.bnSub.textContent = CHANGELOG[0].title;
    this.live.textContent = `已更新到 v${VERSION}，可以到更新日誌看新內容`;
    this.banner.hidden = false;
    this.armBanner();
  }

  /** (Re)starts the countdown unless the banner is hidden or the pointer / focus is on it. */
  armBanner() {
    clearTimeout(this.bannerT);
    if (!this.banner.hidden && !this.hover && !this.focused) this.bannerT = setTimeout(() => this.hideBanner(), BANNER_MS);
  }

  /** Hides the banner; when it held the focus, that goes to 開始衝刺 (a hidden button would drop it on the page). */
  hideBanner() {
    clearTimeout(this.bannerT);
    const had = this.banner.contains(document.activeElement);
    this.banner.hidden = true;
    this.hover = this.focused = false;   // a hidden banner gets no pointerleave / focusout
    const play = $('btn-play');
    if (had && usable(play)) play.focus({ preventScroll: true });
  }

  /* ---------- open / close ---------- */

  open() {
    const here = document.body.dataset.screen;
    if (here === 'changelog') return;
    this.from = here === 'settings' ? 'settings' : 'menu';
    this.opener = document.activeElement;
    this.click();
    this.hideBanner();
    CHANGELOG.forEach((_, i) => this.fold(i, i === 0));   // the newest version open, the rest folded
    this.ui.show('changelog');
    this.list.scrollTop = 0;
    setTimeout(() => this.back.focus({ preventScroll: true }), 30);
  }

  close() {
    if (document.body.dataset.screen !== 'changelog') return;
    this.click();
    this.ui.show(this.from);
    const to = (this.from === 'settings' ? [this.setRow] : [this.opener, this.pill, $('btn-play')]).find(usable);
    setTimeout(() => to?.focus({ preventScroll: true }), 30);
  }
}

/* ---------- module API (main.js) ---------- */

let ctl = null;

/** Build the changelog UI once at startup (like `new HelpUI(ui)`); `click` plays the UI click sound. */
export function initChangelog(ui, opts) {
  ctl = new ChangelogUI(ui, opts);
  return ctl;
}

export function openChangelog() { ctl?.open(); }

/**
 * Call once the menu is up. `fresh` = a brand-new player (no run played yet): remembered silently, no banner.
 * Returns true when the banner was shown.
 */
export function checkNewVersion(opts) { return ctl ? ctl.check(opts) : false; }
