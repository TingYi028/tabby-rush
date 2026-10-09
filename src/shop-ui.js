import { FXP } from './settings.js';
import { setOverBanner } from './progression-ui.js';
import { LookPreview, drawTrailPreview, drawCompanionPreview, drawHatPreview, companionSheet, drawStage, boxIcon, LOOK_PREVIEW_SIZE } from './cosmetic-art.js';

/*
 * View for src/cosmetics.js: the 造型店 screen (six tabs 造型 / 頭飾 / 特效 / 夥伴 / 收藏 / 道具, each holding one or more
 * sections of one item kind), the pre-run "arm consumables" strip on the menu, the mystery-box reveal and the small banners.
 * Everything is built from JavaScript; the styles are in shop.css (linked from index.html, and added here when missing).
 * Cards look like the upgrade shop's rows. The equipped 結算橫幅 is handed to the game-over card (progression-ui.js).
 * Previews of coin / crash / banner / livery items come from src/collect-art.js, loaded the first time such a card is built;
 * until it is there (or when it fails) a neutral placeholder is drawn.
 */

const $ = (id) => document.getElementById(id);
const fmt = new Intl.NumberFormat('en-US');
const COIN = 'assets/ui/icon_coin.webp';
const HERO = 'assets/hero/run_01.webp';
const CONFIRM_AT = 2000;                 // coins: from this price on, buying takes a second tap
const PV_W = LOOK_PREVIEW_SIZE.w, PV_H = LOOK_PREVIEW_SIZE.h;
/** Tabs hold sections; a section lists the items of one catalog kind (`upgrade` is the link card to the upgrade shop). */
const TABS = [
  { id: 'look', label: '造型', sub: '替貓裝換個風格，原本的貓裝不會壞掉。', sections: [{ kind: 'look', title: '造型' }] },
  { id: 'hat', label: '頭飾', sub: '頭上戴點什麼，貓裝不會變。', sections: [{ kind: 'hat', title: '頭飾' }] },
  { id: 'trail', label: '特效', sub: '跑過的路、撞車的瞬間、撿到的金幣，都能換花樣。',
    sections: [{ kind: 'trail', title: '拖尾' }, { kind: 'crash', title: '撞車特效' }, { kind: 'coin', title: '金幣外觀' }] },
  { id: 'pet', label: '夥伴', sub: '一個小跟班陪你跑，有些還會幫你多存一點金幣。', sections: [{ kind: 'pet', title: '夥伴' }] },
  { id: 'more', label: '收藏', sub: '列車、結算畫面和跳躍聲，都換成自己的風格。',
    sections: [{ kind: 'livery', title: '列車塗裝' }, { kind: 'banner', title: '結算橫幅' }, { kind: 'sfx', title: '跳躍音效' }] },
  { id: 'item', label: '道具', sub: '出發前帶上，用完就沒了。每日挑戰不能使用道具。', sections: [{ kind: 'item', title: '道具' }, { kind: 'upgrade', title: '升級' }] },
];
/** Which tab shows an item kind (also maps a kind or the old `upgrade` tab id given to open() / setTab()). */
const TAB_OF = Object.create(null);
for (const t of TABS) for (const sec of t.sections) TAB_OF[sec.kind] = t.id;
const FILTERS = [['all', '全部'], ['todo', '還沒有'], ['own', '已擁有']];
const FILTER_FROM = 8;                   // cards in a tab from which the 全部 / 還沒有 / 已擁有 chips appear
const COLLECT_FN = { coin: 'drawCoinPreview', crash: 'drawCrashPreview', banner: 'drawBannerPreview', livery: 'drawLiveryPreview' };
const WIDE = new Set(['banner', 'livery']);       // previews that are wider than tall: a full-width strip on top of the card
const WIDE_W = 256, WIDE_H = 64;
const GLYPH = { coin: '幣', crash: '碰', banner: '旗', livery: '車', sfx: '♪' };
const SOUND_GLYPH = { sfx_8bit: '嗶', sfx_meow: '喵', sfx_spring: '彈', sfx_muyu: '咚' };
let collect = null;                      // the loaded src/collect-art.js (null until then, or when it is missing)
const SVG_HANGER = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 7.5a2.6 2.6 0 1 0-2.6-2.6" fill="none" stroke="#3b1d0e" stroke-width="2" stroke-linecap="round"/><path d="M12 7.5v2.2L3.6 16.2a1.6 1.6 0 0 0 1 2.9h14.8a1.6 1.6 0 0 0 1-2.9L12 9.7" fill="#ffd23f" stroke="#3b1d0e" stroke-width="2" stroke-linejoin="round"/></svg>';
const SVG_LOCK = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10.5" width="14" height="10" rx="2.5" fill="currentColor"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>';
const SVG_PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="#ffd23f" stroke="#3b1d0e" stroke-width="2.4"/><path d="M10 7.8v8.4l6.6-4.2z" fill="#3b1d0e"/></svg>';
const SVG_CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const restart = (el, cls) => { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); };
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
/** A decorative <img> that hides itself when its file is missing (never a broken-image glyph). */
const softImg = (cls, src) => {
  const i = el('img', cls);
  i.alt = '';
  i.addEventListener('error', () => { i.hidden = true; }, { once: true });
  i.src = src;
  return i;
};

/** Stand-in for a preview that has no art yet: the stage with a big character of the kind. */
function drawPlaceholder(g, kind, w, h, glyph) {
  drawStage(g, w, h);
  g.save();
  g.fillStyle = 'rgba(255, 255, 255, 0.55)';
  g.font = `900 ${Math.round(Math.min(h * 0.5, w * 0.6))}px "Noto Sans TC", sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(glyph || GLYPH[kind] || '?', w / 2, h / 2);
  g.restore();
}

/** The banner's file stem (banner_<name>.webp) for the game-over card; '' for the free default. */
const bannerName = (it) => (it && !/_none$/.test(it.id) ? String(it.fx || it.id).replace(/^banner_/, '') : '');

/** "1,200" for coins, km / m / n for achievement progress. */
function fmtStat(fmtKind, v) {
  if (fmtKind === 'km') return `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)} 公里`;
  if (fmtKind === 'm') return `${fmt.format(v)} 公尺`;
  if (fmtKind === 'lv') return `Lv.${v}`;
  return fmt.format(v);
}

export class ShopUI {
  constructor(api, ui, audio) {
    this.api = api;
    this.ui = ui;
    this.audio = audio;
    this.tab = 'look';
    this.cards = [];
    this.from = 'menu';
    this.reduce = matchMedia('(prefers-reduced-motion: reduce)');
    this.raf = 0;
    this.focusT = 0;
    this.lastDraw = 0;
    this.stripKey = '';
    this.ensureCss();
    this.build();
    this.loadHero();
    if (ui && !ui.screens.includes('cshop')) ui.screens.push('cshop');
    // the shop sits on top of the menu state: keep menu keys (Enter / Space = start a run) away from it
    window.addEventListener('keydown', (e) => {
      if (document.body.dataset.screen !== 'cshop') return;
      if (e.code === 'Escape') {
        e.preventDefault(); e.stopPropagation();
        if (!this.reveal.hidden) this.closeReveal(); else this.close();
      } else if ((e.code === 'Enter' || e.code === 'Space') && !/^(BUTTON|INPUT|A)$/.test(document.activeElement?.tagName || '')) {
        e.preventDefault(); e.stopPropagation();
      }
    }, true);
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.stopAnim(); else if (this.isOpen()) this.startAnim(); });
    this.refresh();
  }

  sfx(name, opts) { if (this.audio) this.audio.play(name, opts); }
  isOpen() { return document.body.dataset.screen === 'cshop'; }

  /**
   * Moves the focus once the screen switch has settled. The newest request wins (so open() then close() never focuses the
   * hidden shop), and the target is skipped when it is gone, hidden, or on the wrong side of the shop by then.
   */
  focusSoon(get, inShop) {
    clearTimeout(this.focusT);
    this.focusT = setTimeout(() => {
      this.focusT = 0;
      if (this.isOpen() !== inShop) return;
      const t = get();
      if (t && !t.hidden) t.focus({ preventScroll: true });
    }, 30);
  }

  ensureCss() {
    if (document.querySelector('link[href$="shop.css"]')) return;
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = 'shop.css';
    document.head.appendChild(l);
  }

  /* ---------- DOM ---------- */

  build() {
    const sec = el('section', 'screen dim');
    sec.id = 'cshop';
    sec.hidden = true;
    sec.setAttribute('aria-labelledby', 'cs-title');
    sec.innerHTML = `<div class="card cs-card" role="dialog" aria-modal="true" aria-labelledby="cs-title">
        <div class="cs-head"><h2 id="cs-title">造型店</h2>
          <div class="cs-bank" aria-live="off"><img src="${COIN}" alt="金幣"><b id="cs-bank">0</b></div></div>
        <p class="cs-sub" id="cs-sub"><span id="cs-sub-t"></span><b id="cs-sub-n"></b></p>
        <div class="cs-tabs" id="cs-tabs" role="tablist" aria-label="商品分類"></div>
        <div class="cs-body" id="cs-body" role="tabpanel" tabindex="-1"><div class="cs-filter" id="cs-filter" role="group" aria-label="篩選商品" hidden></div><ul class="cs-list" id="cs-list"></ul></div>
        <p class="sr-only" id="cs-live" role="status" aria-live="polite"></p>
        <div class="card-actions"><button id="btn-cs-back" class="btn btn-alt" type="button">返回</button></div>
        <div class="cs-reveal" id="cs-reveal" role="dialog" aria-modal="true" aria-label="開箱結果" hidden>
          <div class="cs-reveal-box" id="cs-rv-art"></div>
          <b class="cs-rv-title" id="cs-rv-title"></b>
          <span class="cs-rv-text" id="cs-rv-text"></span>
          <div class="cs-rv-actions"><button id="btn-cs-equip" class="btn btn-small" type="button" hidden>馬上裝備</button>
            <button id="btn-cs-ok" class="btn btn-alt btn-small" type="button">好耶</button></div>
        </div>
      </div>`;
    const anchor = $('shop');
    if (anchor && anchor.parentNode) anchor.after(sec); else ($('app') || document.body).appendChild(sec);
    this.root = sec;
    this.list = $('cs-list');
    this.body = $('cs-body');
    this.reveal = $('cs-reveal');
    this.live = $('cs-live');
    const tabs = $('cs-tabs');
    for (const t of TABS) {
      const b = el('button', 'cs-tab');
      b.append(softImg('cs-tab-ico', `assets/ui/tab_${t.id}.webp`), t.label);
      b.type = 'button';
      b.id = `cs-tab-${t.id}`;
      b.setAttribute('role', 'tab');
      b.dataset.tab = t.id;
      b.setAttribute('aria-controls', 'cs-body');
      const dot = el('i', 'cs-dot');
      dot.hidden = true;
      b.appendChild(dot);
      b.addEventListener('click', () => this.setTab(t.id, true));
      b.addEventListener('keydown', (e) => this.tabKey(e));
      tabs.appendChild(b);
    }
    const fl = $('cs-filter');
    for (const [id, label] of FILTERS) {
      const b = el('button', 'cs-chip', label);
      b.type = 'button';
      b.dataset.f = id;
      b.setAttribute('aria-pressed', String(id === 'all'));
      b.addEventListener('click', () => { this.sfx('ui_click', { vol: 0.4, rate: 1.1 }); this.setFilter(id); });
      fl.appendChild(b);
    }
    this.filter = 'all';
    $('btn-cs-back').addEventListener('click', () => this.close());
    $('btn-cs-ok').addEventListener('click', () => this.closeReveal());
    this.reveal.addEventListener('click', (e) => { if (e.target === this.reveal) this.skipReveal(); });
    $('btn-cs-equip').addEventListener('click', () => {
      if (this.lastReward && this.lastReward.id) { this.api.equip(this.lastReward.id); this.sfx('equip', { vol: 0.6 }); }
      this.closeReveal();
    });

    // menu entry button, next to 排行榜
    const chips = document.querySelector('#menu .chips');
    this.entry = el('button', 'chip chip-btn cs-entry');
    this.entry.id = 'btn-cshop';
    this.entry.type = 'button';
    this.entry.innerHTML = `${SVG_HANGER}<span>造型店</span><i class="cs-dot" hidden></i>`;
    this.entry.addEventListener('click', () => this.open());
    if (chips) chips.appendChild(this.entry);

    // pre-run strip: the consumables to take along
    this.strip = el('div', 'arm-strip');
    this.strip.id = 'arm-strip';
    this.strip.setAttribute('role', 'group');
    this.strip.setAttribute('aria-label', '起跑前帶上的道具');
    this.strip.hidden = true;
    const play = $('btn-play');
    if (play && play.parentNode) play.after(this.strip);

    // a way over from the upgrade shop
    const acts = document.querySelector('#shop .card-actions');
    if (acts) {
      const b = el('button', 'btn btn-alt', '造型・道具');
      b.type = 'button';
      b.id = 'btn-cshop-from-shop';
      b.addEventListener('click', () => { this.sfx('ui_click', { vol: 0.6 }); this.open('look', 'shop'); });
      acts.prepend(b);
    }

    // banners (run start / unlocks)
    this.toast = el('div', 'cs-toast');
    this.toast.id = 'cs-toast';
    this.toast.hidden = true;
    this.toast.setAttribute('role', 'status');
    this.toast.setAttribute('aria-live', 'polite');
    this.toast.innerHTML = '<b class="cs-toast-title"></b><span class="cs-toast-text"></span>';
    ($('app') || document.body).appendChild(this.toast);
  }

  loadHero() {
    this.heroImg = new Image();
    this.heroImg.onload = () => {
      try { this.look = new LookPreview(this.heroImg); } catch { this.look = null; }
      if (this.isOpen()) this.drawAll(performance.now() / 1000);
    };
    this.heroImg.src = HERO;
  }

  /* ---------- open / close ---------- */

  open(tab, from = 'menu') {
    if (!this.ui) return;
    this.from = from;
    const unlocked = this.api.freshUnlocks();
    if (!tab) tab = unlocked.length ? this.api.item(unlocked[0]).kind : this.tab;   // setTab() maps a kind to its tab
    this.sfx('ui_click', { vol: 0.6 });
    this.ui.show('cshop');
    this.setTab(tab, false);
    this.focusSoon(() => $(`cs-tab-${this.tab}`) || $('btn-cs-back'), true);
  }

  close() {
    if (!this.ui || !this.isOpen()) return;
    this.sfx('ui_click', { vol: 0.6 });
    this.stopAnim();
    this.flushSeen();
    this.ui.show(this.from === 'shop' ? 'shop' : 'menu');
    this.refresh();
    const back = this.from === 'shop' ? $('btn-cshop-from-shop') : this.entry;
    this.focusSoon(() => back, false);
    this.from = 'menu';
  }

  /* ---------- tabs ---------- */

  tabKey(e) {
    const i = TABS.findIndex((t) => t.id === this.tab);
    let n = -1;
    if (e.code === 'ArrowRight') n = (i + 1) % TABS.length;
    else if (e.code === 'ArrowLeft') n = (i + TABS.length - 1) % TABS.length;
    else if (e.code === 'Home') n = 0;
    else if (e.code === 'End') n = TABS.length - 1;
    if (n < 0) return;
    e.preventDefault();
    this.setTab(TABS[n].id, true);
    $(`cs-tab-${TABS[n].id}`).focus({ preventScroll: true });
  }

  setTab(id, click) {
    if (TAB_OF[id]) id = TAB_OF[id];
    if (!TABS.some((t) => t.id === id)) id = 'look';
    if (id !== this.tab) this.filter = 'all';
    this.tab = id;
    if (click) this.sfx('ui_click', { vol: 0.45, rate: 1.1 });
    for (const t of TABS) {
      const b = $(`cs-tab-${t.id}`);
      b.setAttribute('aria-selected', String(t.id === id));
      b.tabIndex = t.id === id ? 0 : -1;
    }
    this.body.setAttribute('aria-labelledby', `cs-tab-${id}`);
    this.buildList();
    this.body.scrollTop = 0;
  }

  /* ---------- cards ---------- */

  /** Looking at a tab clears the NEW badges of what it showed (when the tab is left). */
  flushSeen() {
    if (this.pendingSeen && this.pendingSeen.length) this.api.markSeen(this.pendingSeen);
    this.pendingSeen = null;
  }

  buildList() {
    this.flushSeen();
    this.stopAnim();
    if (this.io) this.io.disconnect();
    this.cards = [];
    this.groups = [];
    this.list.replaceChildren();
    this.io = 'IntersectionObserver' in window
      ? new IntersectionObserver((es) => {
        for (const e of es) {
          e.target._vis = e.isIntersecting;
          const c = e.target._card;
          if (e.isIntersecting && c && c.draw) { try { c.draw(performance.now() / 1000); } catch { c.draw = null; } }
        }
      }, { root: this.body, rootMargin: '60px' })
      : null;
    const a = this.api, tab = TABS.find((t) => t.id === this.tab), many = tab.sections.length > 1;
    for (const sec of tab.sections) {
      const items = sec.kind === 'upgrade' ? [] : a.sorted(sec.kind);
      if (sec.kind !== 'upgrade' && !items.length) continue;    // a kind the catalog does not have (yet) leaves no empty header
      const li = el('li', 'cs-sect');
      li.dataset.kind = sec.kind;
      const g = { sec, li, cards: [], n: null };
      if (many) {
        const h = el('h3', 'cs-sec-h');
        g.n = el('span', 'cs-sec-n');
        h.append(el('span', null, sec.title), g.n);
        li.appendChild(h);
      }
      const ul = el('ul', 'cs-grp');
      if (sec.kind === 'upgrade') ul.appendChild(this.upgradeCard());
      for (const it of items) {
        const c = this.buildCard(it);
        c.li._card = c;
        this.cards.push(c);
        g.cards.push(c);
        ul.appendChild(c.li);
        if (this.io) this.io.observe(c.li); else c.li._vis = true;
      }
      li.appendChild(ul);
      this.list.appendChild(li);
      this.groups.push(g);
    }
    this.empty = el('li', 'cs-empty');
    this.empty.hidden = true;
    this.list.appendChild(this.empty);
    this.filterable = this.cards.length >= FILTER_FROM && !this.cards.some((c) => c.it.kind === 'item');
    this.refresh();
    this.applyFilter();
    this.pendingSeen = this.cards.map((c) => c.it.id).filter((id) => a.owns(id));
    if (this.isOpen()) this.startAnim();
  }

  setFilter(id) {
    if (!FILTERS.some((f) => f[0] === id)) id = 'all';
    this.filter = id;
    this.applyFilter();
    this.body.scrollTop = 0;
    this.say(`${FILTERS.find((x) => x[0] === id)[1]}：${this.shown} 件`);
  }

  /** Shows the cards the 全部 / 還沒有 / 已擁有 chip asks for (only when the tab is long enough to have chips). */
  applyFilter() {
    const a = this.api, bar = $('cs-filter'), f = this.filterable ? this.filter : 'all';
    bar.hidden = !this.filterable;
    for (const b of bar.children) b.setAttribute('aria-pressed', String(b.dataset.f === f));
    let shown = 0;
    for (const g of this.groups) {
      let n = 0;
      for (const c of g.cards) {
        const on = f === 'all' || (f === 'own') === a.owns(c.it.id);
        c.li.hidden = !on;
        if (on) n++;
      }
      shown += n;
      g.li.hidden = f !== 'all' && g.cards.length > 0 && !n;
    }
    this.shown = shown;
    const none = f !== 'all' && !shown;
    this.empty.hidden = !none;
    this.empty.textContent = none ? (f === 'own' ? '還沒有收藏，先去買一件吧。' : '這一頁全部收集完了，太厲害了！') : '';
  }

  buildCard(it) {
    const li = el('li', `cs-item r-${it.rarity}${WIDE.has(it.kind) ? ' cs-wide' : ''}`);
    li.dataset.id = it.id;
    li._vis = false;
    const pv = el('span', 'cs-pv');
    const info = el('span', 'cs-info');
    const name = el('b', 'cs-name');
    name.append(it.name);
    const rar = el('em', 'cs-rar', this.api.RARITY[it.rarity].name);
    if (it.kind !== 'item' || it.box) name.append(' ', rar);
    const desc = el('span', 'cs-desc', it.desc);
    const note = el('span', 'cs-note');
    const prog = el('span', 'cs-prog');
    prog.innerHTML = '<i></i>';
    prog.setAttribute('aria-hidden', 'true');
    info.append(name, desc, note, prog);
    const act = el('span', 'cs-act');
    const btn = el('button', 'cs-buy');
    btn.type = 'button';
    act.appendChild(btn);
    const c = { it, li, pv, note, prog, btn, act, draw: null, ctx: null, name };
    if (it.kind === 'item') {
      const arm = el('label', 'cs-arm');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.addEventListener('change', () => { this.api.setArmed(it.id, cb.checked); this.sfx('ui_click', { vol: 0.5, rate: 1.15 }); });
      arm.append(cb, el('i'), el('span', null, '下一局帶上'));
      if (!it.box) act.appendChild(arm);
      c.arm = arm; c.cb = cb;
    }
    this.makePreview(c, pv);
    if (it.kind === 'sfx') {
      const play = el('button', 'cs-play');
      play.type = 'button';
      play.setAttribute('aria-label', `試聽「${it.name}」`);
      play.innerHTML = SVG_PLAY;
      play.addEventListener('click', () => { c.pulse = performance.now() / 1000 + 0.5; if (!this.previewSound(it)) this.say('這個瀏覽器目前不能試聽。'); });
      pv.appendChild(play);
    }
    const fresh = el('i', 'cs-new', '新！');
    fresh.hidden = true;
    pv.appendChild(fresh);
    c.fresh = fresh;
    li.append(pv, info, act);
    btn.addEventListener('click', () => this.onAct(c));
    return c;
  }

  makePreview(c, host) {
    const it = c.it;
    if (it.kind === 'item') {
      if (it.icon) host.appendChild(softImg('cs-icon', it.icon));
      else { const cv = boxIcon(); cv.className = 'cs-icon'; host.appendChild(cv); }
      return;
    }
    const wide = WIDE.has(it.kind), w = wide ? WIDE_W : PV_W, h = wide ? WIDE_H : PV_H;
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    cv.className = 'cs-cv';
    cv.setAttribute('aria-hidden', 'true');
    host.appendChild(cv);
    const g = cv.getContext('2d');
    c.ctx = g;
    if (it.kind === 'look') c.draw = (t) => {
      if (this.look) this.look.draw(g, it.look, t, FXP.calm);
      else { drawStage(g, PV_W, PV_H); if (this.heroImg.complete && this.heroImg.naturalWidth) g.drawImage(this.heroImg, 100, 30, 330, 412, 0, 0, PV_W, PV_H); }
    };
    else if (it.kind === 'trail') c.draw = (t) => drawTrailPreview(g, it.fx, t, PV_W, PV_H);
    else if (it.kind === 'hat') c.draw = (t) => { if (it.fx) drawHatPreview(g, it.fx, t, PV_W, PV_H); else drawStage(g, PV_W, PV_H); };
    else if (it.kind === 'pet') {
      const sheet = it.fx ? companionSheet(it.fx) : null;
      c.draw = (t) => { if (sheet) drawCompanionPreview(g, sheet, it.fx, t, PV_W, PV_H); else drawStage(g, PV_W, PV_H); };
    } else {
      if (COLLECT_FN[it.kind]) this.loadCollect();
      c.draw = (t) => this.drawCollect(g, it, t, w, h, c);
    }
  }

  /** Loads src/collect-art.js once (the first coin / crash / banner / livery card); a missing file leaves the placeholders. */
  loadCollect() {
    if (this.collectP) return;
    this.collectP = import('./collect-art.js').then((m) => { collect = m; if (this.isOpen()) this.drawAll(performance.now() / 1000); }).catch(() => {});
  }

  /** coin / crash / banner / livery previews from collect-art.js (fx '' = the free default), the sound pack tile, or the placeholder. */
  drawCollect(g, it, t, w, h, c) {
    if (it.kind === 'sfx') { this.drawSoundTile(g, it, t, w, h, c); return; }
    const f = collect && collect[COLLECT_FN[it.kind]];
    if (f && !(c && c.bad)) {
      try { f(g, it.fx || '', t, w, h); return; } catch { if (c) c.bad = true; }
    }
    drawPlaceholder(g, it.kind, w, h);
  }

  /** A jump sound pack has nothing to look at: a stage with a character, a ring that pulses after 試聽. */
  drawSoundTile(g, it, t, w, h, c) {
    drawPlaceholder(g, 'sfx', w, h, SOUND_GLYPH[it.id]);
    const k = c ? (c.pulse || 0) - t : 0;
    if (k > 0 && !this.reduce.matches) {
      g.save();
      g.strokeStyle = `rgba(255, 210, 63, ${Math.min(1, k * 2).toFixed(2)})`;
      g.lineWidth = 3;
      g.beginPath();
      g.arc(w / 2, h / 2, w * (0.28 + (0.5 - k) * 0.5), 0, Math.PI * 2);
      g.stroke();
      g.restore();
    }
  }

  /**
   * Plays the pack's jump sample (audio.js setJumpPack: the pack is switched on for one jump sound, the equipped one is put
   * back; a pack whose files are not decoded yet is loaded first). false when this build cannot play it.
   */
  previewSound(it) {
    const au = this.audio;
    if (!au || typeof au.setJumpPack !== 'function') return false;
    const run = () => {
      au.setJumpPack(it.id);
      au.play('jump', { vol: 0.55 });             // the volume main.js jumps with
      au.setJumpPack(this.api.equippedId('sfx'));
    };
    if (it.fx && typeof au.loadPack === 'function') Promise.resolve(au.loadPack(it.id)).then(run, run); else run();
    return true;
  }

  upgradeCard() {
    const li = el('li', 'cs-item cs-upgrade');
    li.innerHTML = '<span class="cs-info"><b class="cs-name">道具升級</b><span class="cs-desc">磁鐵、彈跳鞋、分數 ×2、噴射背包的持續時間，還有開局護盾的機率。升級永久有效。</span></span>';
    const act = el('span', 'cs-act');
    const b = el('button', 'cs-buy equip', '前往升級');
    b.type = 'button';
    b.addEventListener('click', () => {
      const go = $('btn-shop');
      if (!go) return;
      this.sfx('ui_click', { vol: 0.6 });
      this.from = 'menu';
      go.click();
    });
    act.appendChild(b);
    li.appendChild(act);
    return li;
  }

  /** Re-read the state into every visible piece: bank, cards, dots, the strip. Cheap. */
  refresh() {
    const a = this.api, bank = a.bank();
    const bankEl = $('cs-bank');
    if (bankEl) bankEl.textContent = fmt.format(bank);
    const fresh = a.freshUnlocks();
    if (this.entry) this.entry.querySelector('.cs-dot').hidden = !fresh.length;
    for (const t of TABS) {
      const d = $(`cs-tab-${t.id}`)?.querySelector('.cs-dot');
      if (d) d.hidden = !fresh.some((id) => TAB_OF[a.item(id).kind] === t.id);
    }
    const tab = TABS.find((t) => t.id === this.tab);
    const col = a.collection();
    const sub = $('cs-sub');
    if (sub && tab) {
      const mine = tab.sections.map((s) => col.by[s.kind]).filter(Boolean);
      const have = mine.reduce((n, m) => n + m.have, 0), total = mine.reduce((n, m) => n + m.total, 0);
      $('cs-sub-t').textContent = tab.sub;
      $('cs-sub-n').textContent = total ? `收藏 ${have} / ${total}` : '';
      sub.hidden = !tab.sub && !total;
    }
    for (const g of this.groups || []) {
      const m = col.by[g.sec.kind];
      if (g.n) g.n.textContent = m ? `${m.have} / ${m.total}` : '';
    }
    for (const c of this.cards) this.paint(c, bank);
    setOverBanner(bannerName(a.item(a.equippedId('banner'))));
    this.renderStrip();
  }

  /** One card's text, button and classes from the current state. */
  paint(c, bank) {
    const a = this.api, it = c.it, id = it.id, btn = c.btn;
    const setBtn = (cls, label, aria, coinPrice) => {
      const k = cls.split(' ');
      btn.className = `cs-buy ${cls}`;
      btn.replaceChildren();
      if (coinPrice != null) { const i = el('img'); i.src = COIN; i.alt = ''; btn.append(i, el('span', null, fmt.format(coinPrice))); }
      else if (k.includes('lock')) { btn.insertAdjacentHTML('beforeend', SVG_LOCK); btn.append(el('span', null, label)); }
      else if (k.includes('on')) { btn.insertAdjacentHTML('beforeend', SVG_CHECK); btn.append(el('span', null, label)); }
      else btn.append(el('span', null, label));
      btn.setAttribute('aria-label', aria);
      btn.setAttribute('aria-disabled', String(k.includes('lock') || k.includes('on') || k.includes('poor') || k.includes('full')));
      if (k.includes('on')) btn.setAttribute('aria-pressed', 'true'); else btn.removeAttribute('aria-pressed');
    };
    c.prog.hidden = true;
    c.note.textContent = '';
    c.note.className = 'cs-note';
    c.li.classList.remove('owned', 'equipped', 'locked', 'poor', 'is-new', 'confirm');
    c.fresh.hidden = true;
    if (it.kind === 'item') {
      const n = a.count(id);
      if (it.box) {
        const info = a.boxInfo();
        c.note.textContent = `已開 ${info.opened} 箱・連續 ${info.pity} / ${info.limit} 箱沒開到外觀，到 ${info.limit} 箱必出`;
        const poor = bank < it.price;
        c.li.classList.toggle('poor', poor);
        setBtn(poor ? 'poor' : '', '', poor ? `「${it.name}」要 ${fmt.format(it.price)} 金幣，金幣不足` : `開「${it.name}」：${fmt.format(it.price)} 金幣`, it.price);
        return;
      }
      c.note.textContent = `擁有 ×${n}${n >= a.CAP ? '（已達上限）' : ''}`;
      c.note.classList.add('count');
      const full = n >= a.CAP, poor = !full && bank < it.price;
      c.li.classList.toggle('poor', poor);
      c.cb.checked = a.armed(id);
      c.cb.disabled = n <= 0;
      c.arm.classList.toggle('off', n <= 0);
      setBtn(full ? 'full' : poor ? 'poor' : '', '已滿', full ? `「${it.name}」已達上限` : poor ? `買「${it.name}」要 ${fmt.format(it.price)} 金幣，金幣不足` : `買「${it.name}」：${fmt.format(it.price)} 金幣，目前擁有 ${n}`, full ? null : it.price);
      return;
    }
    const owned = a.owns(id), eq = a.isEquipped(id);
    c.li.classList.toggle('owned', owned);
    c.li.classList.toggle('equipped', eq);
    if (it.perk) c.note.textContent = `夥伴加成：每局結算 +${Math.round(it.perk * 100)}% 金幣`;
    if (owned && it.unlock && !it.price) c.note.textContent = `${it.unlock.text}・已解鎖${c.note.textContent ? `　${c.note.textContent}` : ''}`;
    if (owned) {
      c.fresh.hidden = !(it.unlock && a.freshUnlocks().includes(id));
      c.li.classList.toggle('is-new', !c.fresh.hidden);
      if (eq) setBtn('on', '裝備中', `「${it.name}」裝備中`);
      else setBtn('equip', '裝備', `裝備「${it.name}」`);
      return;
    }
    if (it.unlock) {
      const p = a.progress(id);
      c.li.classList.add('locked');
      c.note.textContent = `${it.unlock.text}（${fmtStat(it.unlock.fmt, p.have)} / ${fmtStat(it.unlock.fmt, p.need)}）`;
      c.note.classList.add('req');
      c.prog.hidden = false;
      c.prog.firstChild.style.setProperty('--p', p.ratio.toFixed(3));
      setBtn('lock', '未解鎖', `「${it.name}」尚未解鎖：${it.unlock.text}`);
      return;
    }
    const poor = bank < it.price;
    c.li.classList.toggle('poor', poor);
    if (c.confirm) {
      c.li.classList.add('confirm');
      setBtn('confirm', '確定購買？', `再按一次確定購買「${it.name}」，${fmt.format(it.price)} 金幣`);
    } else {
      setBtn(poor ? 'poor' : '', '', poor ? `「${it.name}」要 ${fmt.format(it.price)} 金幣，金幣不足，還差 ${fmt.format(it.price - bank)}` : `買「${it.name}」：${fmt.format(it.price)} 金幣`, it.price);
    }
  }

  say(text) { this.live.textContent = ''; setTimeout(() => { this.live.textContent = text; }, 30); }

  onAct(c) {
    const a = this.api, it = c.it, id = it.id, bank = a.bank();
    if (it.kind === 'item') {
      if (!it.box && a.count(id) >= a.CAP) { this.nope(c, `「${it.name}」最多帶 ${a.CAP} 個`); return; }
      if (bank < it.price) { this.nope(c, `金幣不足：還差 ${fmt.format(it.price - bank)}`); return; }
      const r = a.buy(id);
      if (r.res !== 'ok') { this.nope(c, '買不了'); return; }
      this.bought(c);
      if (it.box) this.showReveal(r.reward);
      else this.say(`買了「${it.name}」，現在有 ${a.count(id)} 個，下一局會帶上`);
      return;
    }
    if (a.owns(id)) {
      if (a.isEquipped(id)) return;
      a.equip(id);
      if (it.kind !== 'sfx' || !this.previewSound(it)) this.sfx('equip', { vol: 0.6 });    // a sound pack answers with its own jump
      restart(c.li, 'bought');
      this.say(`裝備了「${it.name}」`);
      return;
    }
    if (it.unlock) { this.nope(c, `尚未解鎖：${it.unlock.text}`); return; }
    if (bank < it.price) { c.confirm = false; this.nope(c, `金幣不足：還差 ${fmt.format(it.price - bank)}`); return; }
    if (it.price >= CONFIRM_AT && !c.confirm) {
      c.confirm = true;
      this.paint(c, bank);
      this.sfx('ui_click', { vol: 0.5 });
      this.say(`再按一次確定購買「${it.name}」，${fmt.format(it.price)} 金幣`);
      clearTimeout(c.confirmT);
      c.confirmT = setTimeout(() => { c.confirm = false; this.paint(c, a.bank()); }, 3000);
      return;
    }
    clearTimeout(c.confirmT);
    c.confirm = false;
    const r = a.buy(id);
    if (r.res !== 'ok') { this.nope(c, '買不了'); return; }
    a.equip(id);
    this.bought(c);
    this.say(`買了「${it.name}」，已經裝備好了`);
  }

  bought(c) {
    this.sfx('buy', { vol: 0.525 });
    restart(c.li, 'bought');
    const bank = document.querySelector('#cshop .cs-bank');
    if (bank) restart(bank, 'bump');
  }

  nope(c, msg) {
    this.sfx('ui_click', { vol: 0.5, rate: 0.7 });
    restart(c.li, 'nope');
    this.say(msg);
  }

  /* ---------- preview animation ---------- */

  startAnim() {
    this.drawAll(performance.now() / 1000);
    if (this.raf || this.reduce.matches || document.hidden || !this.cards.some((c) => c.draw)) return;
    const loop = (now) => {
      this.raf = requestAnimationFrame(loop);
      if (now - this.lastDraw < 66) return;       // ~15 fps is plenty for thumbnails
      this.lastDraw = now;
      this.drawAll(now / 1000);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stopAnim() { if (this.raf) cancelAnimationFrame(this.raf); this.raf = 0; }

  drawAll(t) {
    for (const c of this.cards) if (c.draw && c.li._vis) { try { c.draw(t); } catch { c.draw = null; } }
  }

  /* ---------- pre-run strip ---------- */

  renderStrip() {
    const a = this.api, strip = this.strip;
    if (!strip) return;
    const ids = a.CONSUMABLES.filter((id) => a.count(id) > 0);
    const key = ids.map((id) => `${id}:${a.count(id)}:${a.armed(id) ? 1 : 0}`).join('|');
    if (key === this.stripKey) return;
    this.stripKey = key;
    strip.hidden = !ids.length;
    strip.replaceChildren();
    if (!ids.length) return;
    const lab = el('span', 'arm-label', '帶上');
    lab.setAttribute('aria-hidden', 'true');
    strip.appendChild(lab);
    const names = [];
    for (const id of ids) {
      const it = a.item(id), on = a.armed(id);
      if (on) names.push(it.name);
      const b = el('button', `arm-btn${on ? ' on' : ''}`);
      b.type = 'button';
      b.setAttribute('aria-pressed', String(on));
      b.setAttribute('aria-label', `${on ? '已帶上' : '不帶'}「${it.name}」，還有 ${a.count(id)} 個。${it.desc}`);
      b.title = `${it.name}：${it.desc}`;
      b.append(softImg('', it.icon), el('b', null, `×${a.count(id)}`));
      b.insertAdjacentHTML('beforeend', `<s aria-hidden="true">${SVG_CHECK}</s>`);
      b.addEventListener('click', () => { a.setArmed(id, !a.armed(id)); this.sfx('ui_click', { vol: 0.5, rate: on ? 0.9 : 1.2 }); });
      strip.appendChild(b);
    }
    const note = el('span', 'arm-note', names.length ? names.join('、') : '這局不帶道具');
    strip.appendChild(note);
  }

  /* ---------- 驚喜箱 ---------- */

  showReveal(r) {
    const a = this.api;
    this.lastReward = r;
    const art = $('cs-rv-art'), title = $('cs-rv-title'), text = $('cs-rv-text'), eq = $('btn-cs-equip');
    art.replaceChildren();
    const open = () => {
      art.replaceChildren();
      eq.hidden = true;
      this.reveal.dataset.phase = 'open';
      let head = '', sub = '';
      this.sfx('box_open', { vol: 0.7 });
      if (r.kind === 'coins') {
        const i = el('img', 'cs-rv-ico'); i.src = COIN; i.alt = '';
        art.appendChild(i);
        head = `+${fmt.format(r.coins)} 金幣`; sub = '已經存進存款';
      } else if (r.kind === 'item') {
        const it = a.item(r.id);
        art.appendChild(softImg('cs-rv-ico', it.icon));
        head = `${it.name} ×${r.qty}`; sub = '放進背包了，下一局會帶上';
      } else {
        const it = a.item(r.id), cv = document.createElement('canvas'), wide = WIDE.has(it.kind);
        cv.width = wide ? WIDE_W : PV_W; cv.height = wide ? WIDE_H : PV_H; cv.className = wide ? 'cs-rv-cv wide' : 'cs-rv-cv';
        if (COLLECT_FN[it.kind]) this.loadCollect();
        art.appendChild(cv);
        const g = cv.getContext('2d'), t = performance.now() / 1000;
        try {
          if (it.kind === 'look' && this.look) this.look.draw(g, it.look, t, FXP.calm);
          else if (it.kind === 'trail') drawTrailPreview(g, it.fx, t, PV_W, PV_H);
          else if (it.kind === 'pet') drawCompanionPreview(g, companionSheet(it.fx), it.fx, t, PV_W, PV_H);
          else if (it.kind === 'hat') drawHatPreview(g, it.fx, t, PV_W, PV_H);
          else if (COLLECT_FN[it.kind] || it.kind === 'sfx') this.drawCollect(g, it, t, cv.width, cv.height, null);
          else drawStage(g, PV_W, PV_H);
        } catch { drawStage(g, PV_W, PV_H); }
        head = `新外觀：${it.name}`; sub = `${a.RARITY[it.rarity].name}${a.KINDS[it.kind]}`;
        eq.hidden = false;
        this.prizeT = setTimeout(() => this.sfx('newbest', { vol: 0.6 }), 450);   // after the lid pop, not on top of it
      }
      title.textContent = head;
      text.textContent = sub;
      this.say(`${head}，${sub}`);
      this.focusSoon(() => (eq.hidden ? $('btn-cs-ok') : eq), true);
    };
    this.openReveal = open;
    this.reveal.hidden = false;
    title.textContent = '';
    text.textContent = '';
    eq.hidden = true;
    if (this.reduce.matches) { open(); return; }
    this.reveal.dataset.phase = 'shake';
    const b = boxIcon();
    b.className = 'cs-rv-box';
    art.appendChild(b);
    this.sfx('ui_click', { vol: 0.5, rate: 0.8 });
    clearTimeout(this.revealT);
    this.revealT = setTimeout(() => { if (!this.reveal.hidden && this.reveal.dataset.phase === 'shake') open(); }, 1100);
    this.focusSoon(() => $('btn-cs-ok'), true);
  }

  skipReveal() {
    if (!this.reveal.hidden && this.reveal.dataset.phase === 'shake' && this.openReveal) { clearTimeout(this.revealT); this.openReveal(); }
  }

  closeReveal() {
    if (this.reveal.hidden) return;
    if (this.reveal.dataset.phase === 'shake') { this.skipReveal(); return; }   // first tap shows the result, the next closes
    clearTimeout(this.revealT);
    clearTimeout(this.prizeT);
    this.reveal.hidden = true;
    this.sfx('ui_click', { vol: 0.5 });
    const first = this.cards.find((c) => c.btn.getAttribute('aria-disabled') !== 'true');
    this.focusSoon(() => (first ? first.btn : $('btn-cs-back')), true);
  }

  /* ---------- banner ---------- */

  banner(title, text) {
    const t = this.toast;
    if (!t) return;
    t.querySelector('.cs-toast-title').textContent = title;
    const x = t.querySelector('.cs-toast-text');
    x.textContent = text || '';
    x.hidden = !text;
    t.hidden = false;
    restart(t, 'show');
    clearTimeout(this.toastT);
    this.toastT = setTimeout(() => { t.hidden = true; t.classList.remove('show'); }, 2800);
  }
}
