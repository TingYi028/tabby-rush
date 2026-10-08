import { POWER_META } from './ui.js';
import { TIERS, tierOf, levelsToNext, nextTier, tierUp, tierIcon } from './tiers.js';

/*
 * Views for src/progression.js: the 商店 screen, mission cards (menu / pause / game over) with the 段位 badge of the
 * mission level (src/tiers.js), the in-run banners ("任務完成！+金幣", "任務快完成"), the HUD objective row and the
 * "what next" guidance (menu 下一個目標 card, game-over 下一步 line, coin ledger).
 * Markup lives in index.html (#menu-meta, #shop, #pause-missions, #go-meta, #mission-toast); the guidance elements
 * are built here and styled by the CSS block below, which this module injects itself.
 */

const $ = (id) => document.getElementById(id);
const fmt = new Intl.NumberFormat('en-US');
const COIN = 'assets/ui/icon_coin.webp';
export const NAMES = {
  magnet: POWER_META.magnet.label, sneakers: POWER_META.sneakers.label, x2: POWER_META.x2.label,
  jetpack: POWER_META.jetpack.label, shield: '開局護盾',
};
const CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const SKIP = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 8.5A7.5 7.5 0 1 0 19.5 15" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/><path d="M20 3.5v5.5h-5.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const TARGET = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.6" fill="none" stroke="currentColor" stroke-width="2.6"/><circle cx="12" cy="12" r="4.2" fill="none" stroke="currentColor" stroke-width="2.6"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/></svg>';
const FLAME = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2c1 3.5-1.5 5.2-3.2 7.4C7.3 11.3 6 13.3 6 15.9 6 19.3 8.7 22 12 22s6-2.7 6-6.1c0-2.7-1.4-4.7-2.6-6-.1 1.8-.8 3-2 3.6.5-4.1-.2-8.6-1.4-11.5z" fill="#ff7a1f" stroke="#3b1d0e" stroke-width="1.8" stroke-linejoin="round"/><path d="M12 13.4c-1.6 1.6-2.6 2.9-2.6 4.6a2.6 2.6 0 0 0 5.2 0c0-1.7-1-3-2.6-4.6z" fill="#ffe36b"/></svg>';
const FLAG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 21V3.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/><path d="M6 4.5h12l-3 4.2 3 4.2H6z" fill="#ff5a8a" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/></svg>';
const CHEVRON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICONS = { target: TARGET, flame: FLAME, flag: FLAG };

const restart = (el, cls) => { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); };
const secText = (s) => (Number.isInteger(s) ? String(s) : s.toFixed(1));

/* ---------- 段位 badges: an <img> per place; a file that fails to load is hidden and remembered, the text stays ---------- */

const badFiles = new Set();   // tier ids whose image did not load

/** A badge <img>; `host` gets the class `no-art` while the current tier's file is missing (CSS shows a colour dot or a plain layout). */
function badgeImg(host) {
  const img = document.createElement('img');
  img.className = 'tier-badge';
  img.alt = '';
  img.addEventListener('error', () => { badFiles.add(img.dataset.tier); img.hidden = true; host.classList.add('no-art'); });
  return img;
}

function paintBadge(img, host, t) {
  const bad = badFiles.has(t.id);
  host.classList.toggle('no-art', bad);
  img.hidden = bad;
  if (!bad && img.dataset.tier !== t.id) img.src = tierIcon(t);
  img.dataset.tier = t.id;
}

/** One `.mis-lvl`: badge before it, 「銅牌 Lv.7」 inside it, a spoken label on the title. `lvl` is 0-based. */
function paintLevel(el, lvl) {
  const key = String(lvl);
  if (el.dataset.lv === key) return;
  el.dataset.lv = key;
  const t = TIERS[tierOf(lvl)], title = el.parentElement;
  let img = title.querySelector('.tier-badge');
  if (!img) { img = badgeImg(el); el.before(img); }
  paintBadge(img, el, t);
  el.style.setProperty('--tc', t.color);
  const name = document.createElement('i');
  name.className = 'tier-name';
  name.textContent = t.name;
  el.replaceChildren(name, document.createTextNode(` Lv.${lvl + 1}`));
  title.setAttribute('role', 'img');
  title.setAttribute('aria-label', `任務段位 ${t.name}，等級 ${lvl + 1}`);
}

const CSS = `
/* ---------- meta guidance: reward chips, 下一個目標 card, game-over 下一步 / ledger, HUD objective (src/progression-ui.js) ---------- */
.mis-foot { display: flex; align-items: center; gap: 6px; }
.mis-foot .mis-bar { flex: 1; min-width: 0; }
.mis-rw { flex: none; display: inline-flex; align-items: center; gap: 2px; font: 12px/1 var(--font-display); color: #b3600a; font-variant-numeric: tabular-nums; }
.mis-rw img { width: 14px; height: 14px; }
.mis.done .mis-rw { color: #1d8a4e; }
.mis.fresh .mis-rw { color: var(--tangerine); }
.mis.tap { cursor: pointer; }
.mis.pinned { border-color: var(--tangerine); box-shadow: 0 0 0 2px var(--tangerine); }
.mis.pinned .mis-ico { background: var(--tangerine); color: var(--white); }
.mis.pinned .mis-ico svg { width: 16px; height: 16px; }

.next-goal { position: relative; display: flex; align-items: center; gap: 10px; box-sizing: border-box; width: min(440px, 100%); min-width: 0;
  margin: 0; padding: 6px 12px 7px 7px; background: var(--cream); border: 3px solid var(--ink); border-radius: 16px; box-shadow: 0 4px 0 var(--ink);
  color: var(--ink); font: inherit; text-align: left; cursor: pointer; }
.next-goal.ng-pop { animation: ng-in 0.4s cubic-bezier(0.2, 0.9, 0.3, 1.3); }
.next-goal:hover { transform: translateY(-1px); }
.next-goal:active { transform: translateY(3px); box-shadow: 0 1px 0 var(--ink); }
.next-goal.static { cursor: default; }
.next-goal.static:hover, .next-goal.static:active { transform: none; box-shadow: 0 4px 0 var(--ink); }
.next-goal:focus-visible { outline: 4px solid var(--white); outline-offset: 4px; }
.ng-ico { flex: none; display: grid; place-items: center; width: 38px; height: 38px; box-sizing: border-box; border-radius: 50%;
  border: 3px solid var(--ink); background: var(--sun); color: var(--ink); }
.ng-ico svg { width: 22px; height: 22px; }
.ng-ico img { width: 82%; height: auto; }
[data-kind="shop"] > .ng-ico, [data-kind="save"] > .ng-ico { background: #c9f1ff; }
[data-kind="daily"] > .ng-ico { background: #c7b2ff; }
[data-kind="record"] > .ng-ico { background: #ffc4e4; }
.ng-body { flex: 1; min-width: 0; display: grid; gap: 2px; }
.ng-label { font: 900 11px/1 var(--font-cjk); letter-spacing: 0.12em; color: var(--tangerine); }
.ng-text { font: 900 15px/1.25 var(--font-cjk); overflow-wrap: anywhere; text-wrap: pretty; }
.ng-meter { display: flex; align-items: center; gap: 8px; min-width: 0; }
.ng-meter .mis-bar { flex: 1; min-width: 24px; }
.ng-sub { min-width: 0; overflow: hidden; text-overflow: ellipsis; font: 12px/1.2 var(--font-display); color: #7a4a2a; font-variant-numeric: tabular-nums; white-space: nowrap; }
.ng-sub.txt { font: 700 12px/1.2 var(--font-cjk); white-space: normal; overflow: visible; overflow-wrap: anywhere; }
.ng-cta { flex: none; padding: 6px 12px 7px; border: 3px solid var(--ink); border-radius: 999px; box-shadow: 0 3px 0 var(--ink);
  background: linear-gradient(#ffdc55, #ff9e22 62%, #ff7c1a); color: var(--white); font: 900 14px/1 var(--font-cjk); text-shadow: var(--ol-sm); white-space: nowrap; }
.ng-go { flex: none; width: 22px; height: 22px; color: var(--tangerine); }
.ng-cta + .ng-go { display: none; }
@keyframes ng-in { 0% { transform: translateY(8px) scale(0.94); opacity: 0; } 100% { transform: none; opacity: 1; } }
@media (max-width: 820px), (max-aspect-ratio: 1/1) { .next-goal { order: 3; } }   /* the narrow menu is a flex column of ordered blocks: right after the play button */
@media (max-height: 760px) {
  .ng-label { display: none; }
  .next-goal { padding-block: 5px 6px; }
  .ng-ico { width: 34px; height: 34px; }
  .ng-text { font-size: 14px; }
}
@media (max-width: 360px) {
  .ng-cta { display: none; }
  .ng-cta + .ng-go { display: block; }
}
@media (max-height: 520px) and (min-aspect-ratio: 1001/1000) { .next-goal { width: 100%; } .ng-ico { width: 30px; height: 30px; } .ng-ico svg { width: 18px; height: 18px; } }
@media (prefers-reduced-motion: reduce) { .next-goal.ng-pop { animation: none; } }

.mis-hint { text-wrap: balance; }
.go-bank { flex-wrap: wrap; row-gap: 4px; }
.go-ledger { margin: -2px 0 0; font: 700 12px/1.35 var(--font-cjk); color: #7a4a2a; text-align: center; text-wrap: balance; }
.go-next { display: flex; align-items: center; gap: 8px; box-sizing: border-box; width: 100%; min-width: 0; padding: 6px 8px 7px 7px;
  background: #fff1c9; border: 3px solid var(--ink); border-radius: 14px; box-shadow: 0 3px 0 var(--ink); text-align: left; }
.go-next .ng-ico { width: 32px; height: 32px; }
.go-next .ng-ico svg { width: 18px; height: 18px; }
.gn-body { flex: 1; min-width: 0; display: grid; gap: 2px; }
.gn-cause { font: 700 12px/1.3 var(--font-cjk); color: #b5402a; overflow-wrap: anywhere; }
.gn-line { font: 900 14px/1.3 var(--font-cjk); overflow-wrap: anywhere; text-wrap: pretty; }
.gn-line b { color: var(--tangerine); font-weight: 900; }
.gn-sub { font: 700 12px/1.2 var(--font-cjk); color: #7a4a2a; overflow-wrap: anywhere; }
.go-next .ng-cta { padding: 5px 10px 6px; font-size: 13px; cursor: pointer; }
@media (max-height: 740px) { #go-next { order: -1; } }
@media (max-width: 360px) { .go-next .ng-cta { padding: 5px 8px 6px; } }

.live-goal { display: grid; gap: 3px; box-sizing: border-box; max-width: min(46vw, 210px); margin-top: 18px; padding: 4px 10px 6px 8px;
  background: rgba(59, 29, 14, 0.58); border: 3px solid var(--ink); border-radius: 12px; color: var(--cream);
  font: 900 13px/1.15 var(--font-cjk); pointer-events: none; }
.lg-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-variant-numeric: tabular-nums; }
.lg-bar { display: block; height: 6px; border-radius: 999px; background: rgba(255, 245, 223, 0.3); overflow: hidden; }
.lg-bar i { display: block; height: 100%; transform-origin: left center; transform: scaleX(var(--p, 0)); background: linear-gradient(90deg, #ffd23f, #ff8a1f); }
@media (max-height: 520px) { .live-goal { margin-top: 16px; padding: 2px 8px 4px 7px; font-size: 12px; } }

.mt-reward { flex: none; display: inline-flex; align-items: center; gap: 3px; margin-left: 4px; padding: 3px 9px 3px 4px;
  border: 2px solid var(--ink); border-radius: 999px; background: var(--sun); color: var(--ink); font: 19px/1 var(--font-display); }
.mt-reward img { width: 22px; height: 22px; }
#mission-toast[data-kind="near"] .mt-ico { background: var(--sun); color: var(--ink); }
#mission-toast[data-kind="near"] .mt-title { color: #c25a00; }
#mission-toast[data-kind="near"].show { animation-duration: 2.1s; }

/* 段位 badges (src/tiers.js): beside every mission level, big on the game-over card when a tier is crossed */
.tier-badge { width: 22px; height: 22px; margin: -3px 2px -3px 1px; vertical-align: middle; object-fit: contain; }
.tier-name { font: 900 13px/1 var(--font-cjk); font-style: normal; letter-spacing: 0; color: var(--ink); }
.mis-title .mis-lvl { white-space: nowrap; }
.mis-lvl.no-art::before { content: ''; display: inline-block; width: 10px; height: 10px; box-sizing: border-box; margin-right: 4px;
  border: 2px solid var(--ink); border-radius: 50%; background: var(--tc, var(--sun)); vertical-align: 1px; }
@media (max-height: 740px) { .tier-badge { width: 20px; height: 20px; } }
/* the menu header (title + 起跑倍率 + 商店) has no room to spare: it tightens by its own width, not the screen's */
#menu-meta .mis-head { container: mishead / inline-size; }
@container mishead (max-width: 340px) {
  .mis-title { font-size: 14px; }
  .mis-title b.mis-lvl { margin-left: 0; font-size: 16px; }
  .tier-name { font-size: 12px; }
  .tier-badge { width: 20px; height: 20px; margin-inline: 0 1px; }
  .mis-mult { padding-inline: 5px; font-size: 11px; }
  .mis-mult b { font-size: 14px; }
  .btn.btn-shop { font-size: 16px; padding: 7px 9px 8px 5px; gap: 4px; }
  .btn-shop img { width: 24px; height: 24px; }
}
@container mishead (max-width: 296px) { .mis-mult { font-size: 0; } .mis-mult b { font-size: 14px; } }   /* 320 px phones: just 「×8」 */
.go-levelup:not(.no-art) { grid-template-columns: auto minmax(0, 1fr); column-gap: 10px; text-align: left; }
.go-levelup .tier-badge { grid-row: 1 / span 2; align-self: center; margin: 0; }
.go-levelup.tier-up .tier-badge { width: 72px; height: 72px; filter: drop-shadow(0 3px 0 rgba(59, 29, 14, 0.35));
  animation: tier-pop 0.6s 0.5s ease-out both; }
@media (max-height: 740px) { .go-levelup.tier-up .tier-badge { width: 56px; height: 56px; } }
@keyframes tier-pop { 0% { transform: scale(0.6); } 60% { transform: scale(1.15); } 100% { transform: none; } }
@media (prefers-reduced-motion: reduce) { .go-levelup.tier-up .tier-badge { animation: none; } }
body.fx-calm .go-levelup.tier-up .tier-badge { animation: none; }

/* ---------- game-over title frame: the equipped 結算橫幅 (shop kind banner) ---------- */
/* The image is absolutely placed around the title: the card keeps the height it has without a banner. */
.go-title { position: relative; display: grid; justify-items: center; min-width: 0; }
.go-title > h2 { position: relative; z-index: 1; }
.go-title.has-banner { width: 100%; }
.go-banner { position: absolute; z-index: 0; left: 50%; top: 50%; width: calc(100% + 12px); height: calc(100% + 24px); transform: translate(-50%, -50%);
  object-fit: contain; pointer-events: none; animation: go-banner-in 0.5s 0.15s ease-out both; }
.go-banner[hidden] { display: none; }
.go-title[data-banner="neon"] .go-banner { animation: go-banner-in 0.5s 0.15s ease-out both, go-neon 2.6s 0.7s ease-in-out infinite alternate; }
@keyframes go-banner-in { 0% { opacity: 0; } 100% { opacity: 1; } }
@keyframes go-neon { 0% { filter: brightness(1) drop-shadow(0 0 3px #ff4fd8); } 100% { filter: brightness(1.18) drop-shadow(0 0 9px #3df0ff); } }
@media (prefers-reduced-motion: reduce) { .go-banner, .go-title[data-banner="neon"] .go-banner { animation: none; } }
body.fx-calm .go-banner, body.fx-calm .go-title[data-banner="neon"] .go-banner { animation: none; }
`;

/**
 * Frames the game-over title with the equipped 結算橫幅 (`name` = the banner's catalog fx, '' for none). Called by the shop
 * view whenever the equipment changes; the picture is assets/ui/banner_<name>.webp (512x128) and hides itself when missing.
 */
export function setOverBanner(name) {
  const box = $('go-title');
  if (!box) return;
  const want = /^[a-z0-9]+$/.test(name || '') ? name : '';
  if ((box.dataset.banner || '') === want) return;
  let img = box.querySelector('.go-banner');
  box.classList.toggle('has-banner', !!want);
  if (!want) { delete box.dataset.banner; if (img) img.hidden = true; return; }
  if (!img) {
    img = document.createElement('img');
    img.className = 'go-banner';
    img.alt = '';
    img.setAttribute('aria-hidden', 'true');
    img.addEventListener('error', () => { img.hidden = true; });
    box.appendChild(img);
  }
  box.dataset.banner = want;
  img.hidden = false;
  img.src = `assets/ui/banner_${want}.webp`;
}

function injectStyles() {
  if ($('meta-css')) return;
  const st = document.createElement('style');
  st.id = 'meta-css';
  st.textContent = CSS;
  document.head.appendChild(st);
}

export class MetaUI {
  constructor(api, ui, audio) {
    this.api = api;
    this.ui = ui;
    this.audio = audio;
    this.reduce = matchMedia('(prefers-reduced-motion: reduce)');
    this.queue = [];
    this.toastBusy = false;
    this.cur = null;
    this.nextAct = '';
    this.liveText = '';
    this.liveP = -1;
    injectStyles();
    if (ui && !ui.screens.includes('shop')) ui.screens.push('shop');
    $('btn-shop')?.addEventListener('click', () => this.openShop());
    $('btn-shop-back')?.addEventListener('click', () => this.closeShop());
    const list = $('menu-missions');
    list?.addEventListener('click', (e) => {
      const b = e.target.closest('.mis-skip');
      if (b) { this.onSkip(b); return; }
      const li = e.target.closest('.mis');
      if (li) this.onPin(li, false);
    });
    list?.addEventListener('keydown', (e) => {
      if ((e.code === 'Enter' || e.code === 'Space') && e.target.classList?.contains('mis')) {
        e.preventDefault();
        e.stopPropagation();   // the menu's Enter / Space = start run must not also fire
        this.onPin(e.target, true);
      }
    });
    // the shop sits on top of the menu state: keep menu keys (Enter/Space = start run) away from it
    window.addEventListener('keydown', (e) => {
      if (document.body.dataset.screen !== 'shop') return;
      if (e.code === 'Escape') { e.preventDefault(); e.stopPropagation(); this.closeShop(); }
      else if ((e.code === 'Enter' || e.code === 'Space') && document.activeElement?.tagName !== 'BUTTON') {
        e.preventDefault(); e.stopPropagation();
      }
    }, true);
    this.buildShop();
    this.buildNext();
    this.buildLive();
    this.buildOver();
    const toast = $('mission-toast');
    if (toast && !toast.querySelector('.mt-reward')) {
      const rw = document.createElement('span');
      rw.className = 'mt-reward';
      rw.hidden = true;
      rw.innerHTML = `<img src="${COIN}" alt=""><b></b>`;
      toast.appendChild(rw);
    }
  }

  sfx(name, opts) { if (this.audio) this.audio.play(name, opts); }

  /* ---------- mission cards ---------- */

  /**
   * One mission row. opts: skip (show the daily skip button), pin (menu: tap sets the goal), fresh (completed this run),
   * value (number shown instead of prog), gain (added this run), tag (small label before the number).
   */
  missionItem(s, opts = {}) {
    const li = document.createElement('li');
    const pinned = !!(opts.pin && s.pinned && !s.done);
    li.className = `mis${s.done ? ' done' : ''}${opts.fresh ? ' fresh' : ''}${pinned ? ' pinned' : ''}${opts.pin && !s.done ? ' tap' : ''}`;
    li.dataset.slot = s.i;
    li.tabIndex = opts.pin && !s.done ? 0 : -1;
    const val = Math.floor(opts.value ?? s.prog);
    const p = s.done ? 1 : Math.max(0, Math.min(1, val / s.goal));
    const num = s.done ? (opts.fresh ? '完成！' : '完成') : `${fmt.format(val)}/${fmt.format(s.goal)}`;
    li.innerHTML = `<span class="mis-ico" aria-hidden="true">${s.done ? CHECK : pinned ? TARGET : `<b>${s.i + 1}</b>`}</span>
      <span class="mis-main"><span class="mis-top"><span class="mis-text"></span><span class="mis-num"></span></span>
      <span class="mis-foot"><span class="mis-bar" aria-hidden="true"><i style="--p:${p.toFixed(3)}"></i></span>
      <span class="mis-rw" title="完成可得金幣"><img src="${COIN}" alt=""><b></b></span></span></span>`;
    li.querySelector('.mis-text').textContent = s.text;
    li.querySelector('.mis-rw b').textContent = `+${fmt.format(s.reward || 0)}`;
    if (!s.reward) li.querySelector('.mis-rw').hidden = true;
    const n = li.querySelector('.mis-num');
    if (opts.tag && !s.done) { const t = document.createElement('small'); t.textContent = opts.tag; n.appendChild(t); }
    n.appendChild(document.createTextNode(num));
    if (opts.gain > 0 && !s.done) {
      const g = document.createElement('em');
      g.className = 'mis-gain';
      g.textContent = `+${fmt.format(opts.gain)}`;
      n.appendChild(g);
    }
    if (opts.pin && !s.done) li.title = pinned ? '目前的目標（再點一次取消）' : '點一下設為目標';
    if (opts.skip) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'mis-skip';
      b.dataset.slot = s.i;
      b.innerHTML = SKIP;
      b.setAttribute('aria-label', `跳過任務「${s.text}」（每天可免費跳過一次）`);
      b.title = '每天可免費跳過一個任務';
      li.appendChild(b);
    }
    return li;
  }

  head(st) {
    for (const el of document.querySelectorAll('.mis-lvl')) paintLevel(el, st.lvl);
    for (const el of document.querySelectorAll('.mis-mult b')) el.textContent = `×${1 + st.bonus}`;
    const meta = $('menu-meta');
    if (meta) {
      const n = levelsToNext(st.lvl), tip = n ? `再升 ${n} 級晉升${nextTier(st.lvl).name}` : '已是最高段位';
      if (meta.title !== tip) meta.title = tip;
    }
    const mult = document.querySelector('#menu-meta .mis-mult');
    if (mult) {
      mult.title = st.maxed ? `起跑倍率已達上限・每組任務全部完成可領 ${fmt.format(st.setBonus)} 金幣`
        : `完成三個任務，起跑倍率永久 +1，再領 ${fmt.format(st.setBonus)} 金幣`;
    }
  }

  /** Main menu cards; `levelUp` = new mission level reached while settling (0 = none). */
  renderMenu(levelUp = 0) {
    const list = $('menu-missions');
    if (!list) return;
    const st = this.api.state();
    this.head(st);
    list.replaceChildren(...st.slots.map((s) => this.missionItem(s, { skip: st.canSkip && !s.done, pin: true })));
    $('mis-skip-note').hidden = st.canSkip || st.slots.every((s) => s.done);
    const hint = $('mis-hint');
    if (hint) {
      hint.textContent = `${st.pins === 0 ? '點任務可設為目標・' : ''}全部完成再領 +${fmt.format(st.setBonus)} 金幣${st.maxed ? '' : '・起跑倍率 +1'}`;
    }
    this.renderNext(st.next);
    if (levelUp) this.allDone(st.bonus, true, 0);
  }

  renderPause(st) {
    const list = $('pause-missions');
    if (!list) return;
    this.head(st);
    list.replaceChildren(...st.slots.map((s) => this.missionItem(s, { value: s.prog })));
  }

  onSkip(b) {
    const i = Number(b.dataset.slot);
    if (!b.classList.contains('confirm')) {
      // two-step so a stray tap doesn't burn the daily skip
      for (const o of document.querySelectorAll('.mis-skip.confirm')) this.unconfirm(o);
      b.classList.add('confirm');
      b.textContent = '確定跳過？';
      b.setAttribute('aria-label', '再按一次確定跳過這個任務');
      clearTimeout(b._t);
      b._t = setTimeout(() => this.unconfirm(b), 3000);
      this.sfx('ui_click', { vol: 0.5 });
      return;
    }
    clearTimeout(b._t);
    if (!this.api.skip(i)) return;
    this.sfx('ui_click', { vol: 0.6, rate: 1.2 });
    this.renderMenu(0);
    const li = document.querySelector(`#menu-missions .mis[data-slot="${i}"]`);
    if (li) { restart(li, 'swap'); li.focus({ preventScroll: true }); }
  }

  unconfirm(b) {
    b.classList.remove('confirm');
    b.innerHTML = SKIP;
    const text = b.closest('.mis')?.querySelector('.mis-text')?.textContent || '';
    b.setAttribute('aria-label', `跳過任務「${text}」（每天可免費跳過一次）`);
  }

  /** Tap a menu mission: make it the goal (the 下一個目標 card and the HUD row follow it); tap again to let the game choose. */
  onPin(li, viaKey) {
    if (li.classList.contains('done')) return;
    const i = Number(li.dataset.slot);
    this.api.pin(i);
    this.sfx('ui_click', { vol: 0.5, rate: 1.1 });
    this.renderMenu(0);
    const again = document.querySelector(`#menu-missions .mis[data-slot="${i}"]`);
    if (again) { restart(again, 'swap'); if (viaKey) again.focus({ preventScroll: true }); }
  }

  /* ---------- "what next": 下一個目標 card (menu) and 下一步 line (game over) ---------- */

  iconFor(n) {
    if (this.api.SHOP[n.icon]) return `<img src="${POWER_META[n.icon].icon}" alt="">`;
    return ICONS[n.icon] || TARGET;
  }

  buildNext() {
    const play = $('btn-play');
    if (!play) return;
    const b = document.createElement('button');
    b.type = 'button';
    b.id = 'next-goal';
    b.className = 'next-goal';
    b.hidden = true;
    b.innerHTML = `<span class="ng-ico" aria-hidden="true"></span>
      <span class="ng-body"><span class="ng-label">下一個目標</span><span class="ng-text"></span>
      <span class="ng-meter"><span class="mis-bar" aria-hidden="true"><i></i></span><span class="ng-sub"></span></span></span>
      <span class="ng-cta" hidden></span><span class="ng-go" hidden>${CHEVRON}</span>`;
    b.addEventListener('click', () => this.go(this.nextAct, 'menu'));
    this.nextEl = b;
    // beside the play button; short landscape phones have a second column (missions) where there is room
    const mq = matchMedia('(max-height: 520px) and (min-aspect-ratio: 1001/1000)');
    const place = () => {
      const meta = $('menu-meta');
      if (mq.matches && meta) meta.before(b); else play.after(b);
    };
    place();
    if (mq.addEventListener) mq.addEventListener('change', place);
    const meta = $('menu-meta'), note = document.createElement('p');
    note.id = 'mis-hint';
    note.className = 'mis-note mis-hint';
    meta?.appendChild(note);
  }

  /** Fill the menu's 下一個目標 card from a suggest() result. */
  renderNext(n) {
    const el = this.nextEl;
    if (!el) return;
    if (!n) { el.hidden = true; this.nextAct = ''; return; }
    const changed = el.dataset.key !== `${n.kind}|${n.text}`;
    el.dataset.key = `${n.kind}|${n.text}`;
    el.hidden = false;
    el.dataset.kind = n.kind;
    el.querySelector('.ng-ico').innerHTML = this.iconFor(n);
    const cta = el.querySelector('.ng-cta'), go = el.querySelector('.ng-go');
    cta.hidden = !(n.act && n.cta);
    cta.textContent = n.cta || '';
    go.hidden = !n.act;
    this.nextAct = n.act || '';
    el.classList.toggle('static', !n.act);
    el.tabIndex = n.act ? 0 : -1;
    el.querySelector('.ng-text').textContent = n.text;
    const bar = el.querySelector('.mis-bar'), sub = el.querySelector('.ng-sub');
    bar.hidden = !(n.p >= 0);
    if (n.p >= 0) bar.firstElementChild.style.setProperty('--p', Math.max(0, Math.min(1, n.p)).toFixed(3));
    sub.textContent = n.sub || '';
    sub.classList.toggle('txt', !(n.p >= 0));
    el.querySelector('.ng-meter').hidden = !n.sub && !(n.p >= 0);
    el.setAttribute('aria-label', `下一個目標：${n.text}${n.sub ? `（${n.sub}）` : ''}${n.act ? '，按一下前往' : ''}`);
    if (changed) restart(el, 'ng-pop');
  }

  go(act, from) {
    if (act === 'shop' || act === 'cshop') {   // 'shop' = upgrades, 'cshop' = the cosmetics shop (造型店)
      if (from === 'over') $('btn-home')?.click();   // back to the menu first, the shop opens on top of it
      $(act === 'shop' ? 'btn-shop' : 'btn-cshop')?.click();
    } else if (act === 'daily') $('btn-daily')?.click();
    else if (act === 'play') $('btn-play')?.click();
  }

  /** The extra game-over elements: coin ledger, 下一步 line. */
  buildOver() {
    const meta = $('go-meta');
    if (!meta) return;
    const bank = meta.querySelector('.go-bank');
    const ledger = document.createElement('p');
    ledger.id = 'go-ledger';
    ledger.className = 'go-ledger';
    ledger.hidden = true;
    bank?.after(ledger);
    const next = document.createElement('div');
    next.id = 'go-next';
    next.className = 'go-next';
    next.hidden = true;
    next.innerHTML = `<span class="ng-ico" aria-hidden="true"></span>
      <span class="gn-body"><span class="gn-cause" hidden></span><span class="gn-line"><b>下一步：</b><span class="gn-text"></span></span><span class="gn-sub" hidden></span></span>
      <button type="button" class="ng-cta" hidden></button>`;
    next.querySelector('.ng-cta').addEventListener('click', () => this.go(this.overAct, 'over'));
    meta.appendChild(next);
    this.overEl = next;
    this.overAct = '';
  }

  /* ---------- HUD objective row (4 Hz from progression.frame) ---------- */

  buildLive() {
    const rush = $('rush');
    if (!rush) return;
    const el = document.createElement('div');
    el.id = 'live-goal';
    el.className = 'live-goal';
    el.hidden = true;
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = '<span class="lg-text"></span><span class="lg-bar"><i></i></span>';
    rush.after(el);
    this.liveEl = el;
    this.liveTextEl = el.querySelector('.lg-text');
    this.liveFill = el.querySelector('i');
  }

  /** `info` = { text, p } of the objective to show, or null to hide the row. Only touches the DOM when something changed. */
  live(info) {
    const el = this.liveEl;
    if (!el) return;
    if (!info) { el.hidden = true; this.liveText = ''; return; }
    if (el.hidden) el.hidden = false;
    if (info.text !== this.liveText) { this.liveText = info.text; this.liveTextEl.textContent = info.text; }
    const p = Math.round(Math.max(0, Math.min(1, info.p)) * 100) / 100;
    if (p !== this.liveP) { this.liveP = p; this.liveFill.style.setProperty('--p', p.toFixed(2)); }
  }

  /* ---------- in-run banner ---------- */

  missionDone(text, reward = 0) {
    this.sfx('mission', { vol: 0.45 });
    this.push({ title: '任務完成！', text, kind: 'done', reward });
  }

  allDone(bonus, now = false, reward = 0) {
    const capped = bonus >= this.api.MAX_BONUS;
    const mult = capped ? '起跑倍率已達上限' : `起跑倍率 ×${1 + bonus}${now ? '' : '（下一局生效）'}`;
    // in a run the game-over card plays the levelup fanfare; a level-up settled on the menu has no card, so its banner plays it
    this.push({ title: now ? '任務等級提升！' : '三個任務全部完成！', text: mult, kind: 'all', reward, fanfare: now });
  }

  banner(title, icon) {
    this.push({ title, text: '', kind: 'info', icon: POWER_META[icon] ? POWER_META[icon].icon : null });
  }

  /** "任務快完成" reminder (an 80 %-done mission). */
  near(left) {
    this.push({ title: '任務快完成！', text: left, kind: 'near' });
  }

  /** A one-off message on the menu (migrations). */
  notice(text) {
    this.push({ title: text, text: '', kind: 'info', icon: COIN });
  }

  /** True when no banner is showing or waiting (low-priority reminders only appear then). */
  toastIdle() { return !this.toastBusy && !this.queue.length; }

  push(item) {
    this.queue.push(item);
    if (!this.toastBusy) this.nextToast();
    else if (this.cur && this.cur.kind === 'near' && item.kind !== 'near') { clearTimeout(this.toastTimer); this.nextToast(); } // a reminder never holds up a result
  }

  nextToast() {
    const el = $('mission-toast');
    const item = this.queue.shift();
    this.cur = item || null;
    if (!el || !item) { this.toastBusy = false; return; }
    this.toastBusy = true;
    el.hidden = false;
    el.dataset.kind = item.kind;
    const ico = el.querySelector('.mt-ico');
    ico.innerHTML = item.icon ? `<img src="${item.icon}" alt="">` : item.kind === 'near' ? TARGET : CHECK;
    if (item.fanfare) this.sfx('levelup', { vol: 0.375 });   // when the banner shows, not when it is queued
    el.querySelector('.mt-title').textContent = item.title;
    const t = el.querySelector('.mt-text');
    t.textContent = item.text;
    t.hidden = !item.text;
    const rw = el.querySelector('.mt-reward');
    if (rw) {
      rw.hidden = !item.reward;
      if (item.reward) rw.querySelector('b').textContent = `+${fmt.format(item.reward)}`;
    }
    restart(el, 'show');
    this.toastTimer = setTimeout(() => this.nextToast(), item.kind === 'info' ? 1600 : item.kind === 'near' ? 2100 : 2300);
  }

  /** Drop queued banners and hide the current one (run start / end, back to the menu). */
  clearToasts() {
    this.queue.length = 0;
    this.cur = null;
    clearTimeout(this.toastTimer);
    clearTimeout(this.levelT);
    this.toastBusy = false;
    const el = $('mission-toast');
    if (el) { el.classList.remove('show'); el.hidden = true; }
  }

  /* ---------- game over ---------- */

  renderGameOver(r) {
    const earn = $('go-earn');
    if (!earn) return;
    const L = r.ledger || { gross: r.earned, revive: 0, mission: 0, set: 0, daily: 0, delta: r.earned };
    earn.textContent = `${L.delta < 0 ? '−' : '+'}${fmt.format(Math.abs(L.delta))}`;
    this.countUp($('go-bank'), r.bank - L.delta, r.bank);
    // coin ledger: only when something besides the pickups moved the bank
    const parts = [];
    if (L.peak) parts.push(`尖峰時段 +${fmt.format(L.peak)}`);
    if (L.revive) parts.push(`復活 −${fmt.format(L.revive)}`);
    if (L.mission) parts.push(`任務 +${fmt.format(L.mission)}`);
    if (L.set) parts.push(`全部完成 +${fmt.format(L.set)}`);
    if (L.daily) parts.push(`每日獎勵 +${fmt.format(L.daily)}`);
    const led = $('go-ledger');
    if (led) {
      led.hidden = !parts.length;
      led.textContent = parts.length ? [`收集 ${fmt.format(L.gross)}`, ...parts].join('・') : '';
    }
    const up = $('go-levelup');
    up.hidden = !r.levelUp;
    if (r.levelUp) this.paintLevelUp(up, r);
    // the finished set (before any level-up swap): this run's value for single-run missions, totals + gain otherwise
    for (const el of document.querySelectorAll('#go-meta .mis-lvl')) paintLevel(el, r.lvl - (r.levelUp ? 1 : 0));
    $('go-missions').replaceChildren(...r.slots.map((s) => this.missionItem(s, {
      fresh: s.fresh, value: s.run ? s.runVal : s.prog, gain: s.gain, tag: s.run ? '本局 ' : '',
    })));
    this.renderOverNext(r);
    const retry = $('btn-retry');
    if (retry && r.retry) retry.textContent = r.retry;
    if (r.levelUp) this.levelT = setTimeout(() => this.sfx('levelup', { vol: tierUp(r.lvl) ? 0.41 : 0.34 }), 700);
  }

  /** The 任務全部完成 box: a 段位 badge beside the new level, big with a pop when the level moved into a new tier. */
  paintLevelUp(up, r) {
    const t = TIERS[tierOf(r.lvl)], crossed = tierUp(r.lvl), next = nextTier(r.lvl);
    let img = up.querySelector('.tier-badge');
    if (!img) { img = badgeImg(up); up.firstElementChild.before(img); }
    paintBadge(img, up, t);
    up.classList.toggle('tier-up', crossed);
    up.querySelector('b').textContent = crossed ? `晉升「${t.name}」！` : '任務全部完成！';
    const mult = r.maxed ? '起跑倍率已達上限' : `起跑倍率 ×${1 + r.bonus}`;
    up.querySelector('span').textContent = `任務等級 Lv.${r.lvl + 1}・${mult}${r.setBonus ? `・獎勵 +${fmt.format(r.setBonus)} 金幣` : ''}${!crossed && next ? `・再 ${levelsToNext(r.lvl)} 級升${next.name}` : ''}`;
  }

  /** 下一步 line: what killed the hero (when known) + the single most useful next step. */
  renderOverNext(r) {
    const el = this.overEl, n = r.next;
    if (!el) return;
    const cause = el.querySelector('.gn-cause');
    cause.hidden = !r.cause;
    cause.textContent = r.cause || '';
    if (!n && !r.cause) { el.hidden = true; return; }
    el.hidden = false;
    el.dataset.kind = n ? n.kind : 'mission';
    el.querySelector('.ng-ico').innerHTML = n ? this.iconFor(n) : TARGET;
    el.querySelector('.gn-line').hidden = !n;
    el.querySelector('.gn-text').textContent = n ? n.text : '';
    const sub = el.querySelector('.gn-sub');
    sub.hidden = !(n && n.sub);
    sub.textContent = n && n.sub ? n.sub : '';
    const cta = el.querySelector('.ng-cta');
    this.overAct = n && n.act ? n.act : '';
    cta.hidden = !(n && n.act);
    cta.textContent = (n && n.cta) || '前往';
  }

  countUp(el, from, to) {
    cancelAnimationFrame(this.countRaf);
    if (!el) return;
    if (this.reduce.matches || from === to) { el.textContent = fmt.format(to); return; }
    const t0 = performance.now() + 350, dur = 900;
    const step = (now) => {
      const k = Math.max(0, Math.min(1, (now - t0) / dur));
      el.textContent = fmt.format(Math.round(from + (to - from) * (1 - (1 - k) ** 3)));
      if (k < 1) this.countRaf = requestAnimationFrame(step);
    };
    el.textContent = fmt.format(from);
    this.countRaf = requestAnimationFrame(step);
  }

  /* ---------- shop ---------- */

  buildShop() {
    const list = $('shop-list');
    if (!list) return;
    this.rows = {};
    for (const type of Object.keys(this.api.SHOP)) {
      const it = this.api.SHOP[type];
      const li = document.createElement('li');
      li.className = 'shop-row';
      li.dataset.type = type;
      li.innerHTML = `<img class="shop-ico" src="${POWER_META[type].icon}" alt="">
        <span class="shop-info"><b class="shop-name"></b><span class="shop-desc"></span>
        <span class="pips" aria-hidden="true">${'<i></i>'.repeat(it.max)}</span></span>
        <button type="button" class="shop-buy"><img src="${COIN}" alt=""><span></span></button>`;
      li.querySelector('.shop-name').textContent = NAMES[type];
      const btn = li.querySelector('.shop-buy');
      btn.addEventListener('click', () => this.onBuy(type));
      list.appendChild(li);
      this.rows[type] = { li, btn, desc: li.querySelector('.shop-desc'), pips: [...li.querySelectorAll('.pips i')], price: btn.querySelector('span') };
    }
  }

  describe(type, lv) {
    const a = this.api, max = a.SHOP[type].max;
    if (type === 'shield') {
      // spell out that it is a per-run chance (a player read Lv1 as "always")
      const pct = (l) => `${Math.round(a.SHOP.shield.chance[l] * 100)}%`;
      if (lv >= max) return '每局必定帶護盾・已滿級';
      return `每局 ${pct(lv)} → ${pct(lv + 1)} 機率`;
    }
    const sec = (l) => secText(a.powerTime(type, l));
    return lv >= max ? `持續 ${sec(lv)} 秒・已滿級` : `持續 ${sec(lv)} → ${sec(lv + 1)} 秒`;
  }

  refreshShop() {
    if (!this.rows) return;
    const bank = this.api.state().bank;
    const bankEl = $('shop-bank');
    if (bankEl) bankEl.textContent = fmt.format(bank);
    for (const [type, r] of Object.entries(this.rows)) {
      const lv = this.api.upgradeLevel(type), p = this.api.price(type), name = NAMES[type];
      r.desc.textContent = this.describe(type, lv);
      r.pips.forEach((el, i) => el.classList.toggle('on', i < lv));
      const max = !p, poor = !max && bank < p;
      r.li.classList.toggle('max', max);
      r.li.classList.toggle('poor', poor);
      r.btn.setAttribute('aria-disabled', String(max || poor));
      r.price.textContent = max ? '已滿級' : fmt.format(p);
      r.btn.setAttribute('aria-label', max ? `「${name}」已滿級`
        : poor ? `「${name}」升級需要 ${fmt.format(p)} 金幣，金幣不足`
          : `升級「${name}」到 ${lv + 1} 級：${fmt.format(p)} 金幣`);
    }
  }

  onBuy(type) {
    const r = this.rows[type];
    const res = this.api.buy(type);
    if (res === 'ok') {
      this.sfx('buy', { vol: 0.525 });
      this.refreshShop();
      restart(r.li, 'bought');
      restart($('shop-bank').parentElement, 'bump');
      const lv = this.api.upgradeLevel(type);
      const live = $('shop-live');
      if (live) live.textContent = `${NAMES[type]} 升到 ${lv} 級！${this.describe(type, lv)}`;
    } else {
      this.sfx('ui_click', { vol: 0.5, rate: 0.7 });
      restart(r.li, 'nope');
    }
  }

  openShop() {
    if (!this.ui || !this.rows) return;
    this.refreshShop();
    this.sfx('ui_click', { vol: 0.6 });
    this.ui.show('shop');
    const first = Object.values(this.rows).find((r) => r.btn.getAttribute('aria-disabled') !== 'true');
    setTimeout(() => (first ? first.btn : $('btn-shop-back')).focus({ preventScroll: true }), 30);
  }

  closeShop() {
    if (!this.ui || document.body.dataset.screen !== 'shop') return;
    this.sfx('ui_click', { vol: 0.6 });
    this.ui.show('menu');
    this.renderMenu(0);   // the bank changed: the 下一個目標 card may too
    setTimeout(() => $('btn-shop')?.focus({ preventScroll: true }), 30);
  }
}
