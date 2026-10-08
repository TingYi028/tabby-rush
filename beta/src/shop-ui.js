import { FXP } from './settings.js';
import { LookPreview, drawTrailPreview, drawCompanionPreview, companionSheet, drawStage, boxIcon, LOOK_PREVIEW_SIZE } from './cosmetic-art.js';

/*
 * View for src/cosmetics.js: the 造型店 screen (tabs 造型 / 拖尾 / 夥伴 / 道具 / 升級), the pre-run "arm consumables"
 * strip on the menu, the mystery-box reveal and the small banners. Everything is built from JavaScript; the styles are in
 * shop.css (linked from index.html, and added here when missing). Cards look like the upgrade shop's rows.
 */

const $ = (id) => document.getElementById(id);
const fmt = new Intl.NumberFormat('en-US');
const COIN = 'assets/ui/icon_coin.webp';
const HERO = 'assets/hero/run_01.webp';
const CONFIRM_AT = 2000;                 // coins: from this price on, buying takes a second tap
const PV_W = LOOK_PREVIEW_SIZE.w, PV_H = LOOK_PREVIEW_SIZE.h;
const TABS = [
  { id: 'look', label: '造型', sub: '替貓裝換個風格，原本的貓裝不會壞掉。' },
  { id: 'trail', label: '拖尾', sub: '跑過的地方留下點什麼。' },
  { id: 'pet', label: '夥伴', sub: '一個小跟班陪你跑，有些還會幫你多存一點金幣。' },
  { id: 'item', label: '道具', sub: '出發前帶上，用完就沒了。每日挑戰不能使用道具。' },
  { id: 'upgrade', label: '升級', sub: '' },
];
const SVG_HANGER = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 7.5a2.6 2.6 0 1 0-2.6-2.6" fill="none" stroke="#3b1d0e" stroke-width="2" stroke-linecap="round"/><path d="M12 7.5v2.2L3.6 16.2a1.6 1.6 0 0 0 1 2.9h14.8a1.6 1.6 0 0 0 1-2.9L12 9.7" fill="#ffd23f" stroke="#3b1d0e" stroke-width="2" stroke-linejoin="round"/></svg>';
const SVG_LOCK = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10.5" width="14" height="10" rx="2.5" fill="currentColor"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>';
const SVG_CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const restart = (el, cls) => { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); };
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

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
        <p class="cs-sub" id="cs-sub"></p>
        <div class="cs-tabs" id="cs-tabs" role="tablist" aria-label="商品分類"></div>
        <div class="cs-body" id="cs-body" role="tabpanel" tabindex="-1"><ul class="cs-list" id="cs-list"></ul></div>
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
      const b = el('button', 'cs-tab', t.label);
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
    $('btn-cs-back').addEventListener('click', () => this.close());
    $('btn-cs-ok').addEventListener('click', () => this.closeReveal());
    this.reveal.addEventListener('click', (e) => { if (e.target === this.reveal) this.skipReveal(); });
    $('btn-cs-equip').addEventListener('click', () => {
      if (this.lastReward && this.lastReward.id) { this.api.equip(this.lastReward.id); this.sfx('powerup', { vol: 0.5, rate: 1.2 }); }
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
    if (!tab) tab = unlocked.length ? this.api.item(unlocked[0]).kind : this.tab;
    this.sfx('ui_click', { vol: 0.6 });
    this.ui.show('cshop');
    this.setTab(tab, false);
    setTimeout(() => ($(`cs-tab-${this.tab}`) || $('btn-cs-back')).focus({ preventScroll: true }), 30);
  }

  close() {
    if (!this.ui || !this.isOpen()) return;
    this.sfx('ui_click', { vol: 0.6 });
    this.stopAnim();
    this.flushSeen();
    this.ui.show(this.from === 'shop' ? 'shop' : 'menu');
    this.refresh();
    const back = this.from === 'shop' ? $('btn-cshop-from-shop') : this.entry;
    setTimeout(() => back?.focus({ preventScroll: true }), 30);
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
    if (!TABS.some((t) => t.id === id)) id = 'look';
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
    this.list.replaceChildren();
    if (this.tab === 'upgrade') { this.buildUpgrade(); this.refresh(); return; }
    this.io = 'IntersectionObserver' in window
      ? new IntersectionObserver((es) => {
        for (const e of es) {
          e.target._vis = e.isIntersecting;
          const c = e.target._card;
          if (e.isIntersecting && c && c.draw) { try { c.draw(performance.now() / 1000); } catch { c.draw = null; } }
        }
      }, { root: this.body, rootMargin: '60px' })
      : null;
    const a = this.api;
    for (const it of a.sorted(this.tab)) {
      const c = this.buildCard(it);
      c.li._card = c;
      this.cards.push(c);
      this.list.appendChild(c.li);
      if (this.io) this.io.observe(c.li); else c.li._vis = true;
    }
    this.refresh();
    this.pendingSeen = this.cards.map((c) => c.it.id).filter((id) => a.owns(id));
    if (this.isOpen()) this.startAnim();
  }

  buildCard(it) {
    const li = el('li', `cs-item r-${it.rarity}`);
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
      if (it.icon) { const img = el('img', 'cs-icon'); img.src = it.icon; img.alt = ''; host.appendChild(img); }
      else { const cv = boxIcon(); cv.className = 'cs-icon'; host.appendChild(cv); }
      return;
    }
    const cv = document.createElement('canvas');
    cv.width = PV_W; cv.height = PV_H;
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
    else {
      const sheet = it.fx ? companionSheet(it.fx) : null;
      c.draw = (t) => { if (sheet) drawCompanionPreview(g, sheet, it.fx, t, PV_W, PV_H); else drawStage(g, PV_W, PV_H); };
    }
  }

  buildUpgrade() {
    this.list.replaceChildren();
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
    this.list.appendChild(li);
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
      if (d) d.hidden = !fresh.some((id) => a.item(id).kind === t.id);
    }
    const tab = TABS.find((t) => t.id === this.tab);
    const sub = $('cs-sub');
    if (sub && tab) {
      const col = a.collection();
      const mine = col.by[this.tab];
      sub.textContent = mine ? `${tab.sub}　收藏 ${mine.have} / ${mine.total}` : tab.sub;
      sub.hidden = !sub.textContent;
    }
    for (const c of this.cards) this.paint(c, bank);
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
      this.sfx('powerup', { vol: 0.45, rate: 1.25 });
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
    this.sfx('coin', { vol: 0.7, rate: 1.2 });
    this.sfx('powerup', { vol: 0.6, rate: 1.1 });
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
      const img = el('img'); img.src = it.icon; img.alt = '';
      b.append(img, el('b', null, `×${a.count(id)}`));
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
      if (r.kind === 'coins') {
        const i = el('img', 'cs-rv-ico'); i.src = COIN; i.alt = '';
        art.appendChild(i);
        head = `+${fmt.format(r.coins)} 金幣`; sub = '已經存進存款';
        this.sfx('coin', { vol: 0.8, rate: 1.1 });
      } else if (r.kind === 'item') {
        const it = a.item(r.id), i = el('img', 'cs-rv-ico'); i.src = it.icon; i.alt = '';
        art.appendChild(i);
        head = `${it.name} ×${r.qty}`; sub = '放進背包了，下一局會帶上';
        this.sfx('powerup', { vol: 0.7, rate: 1.2 });
      } else {
        const it = a.item(r.id), cv = document.createElement('canvas');
        cv.width = PV_W; cv.height = PV_H; cv.className = 'cs-rv-cv';
        art.appendChild(cv);
        const g = cv.getContext('2d'), t = performance.now() / 1000;
        try {
          if (it.kind === 'look' && this.look) this.look.draw(g, it.look, t, FXP.calm);
          else if (it.kind === 'trail') drawTrailPreview(g, it.fx, t, PV_W, PV_H);
          else if (it.kind === 'pet') drawCompanionPreview(g, companionSheet(it.fx), it.fx, t, PV_W, PV_H);
          else drawStage(g, PV_W, PV_H);
        } catch { drawStage(g, PV_W, PV_H); }
        head = `新外觀：${it.name}`; sub = `${a.RARITY[it.rarity].name}${a.KINDS[it.kind]}`;
        eq.hidden = false;
        this.sfx('newbest', { vol: 0.7 });
      }
      title.textContent = head;
      text.textContent = sub;
      this.say(`${head}，${sub}`);
      setTimeout(() => (eq.hidden ? $('btn-cs-ok') : eq).focus({ preventScroll: true }), 30);
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
    setTimeout(() => $('btn-cs-ok').focus({ preventScroll: true }), 30);
  }

  skipReveal() {
    if (!this.reveal.hidden && this.reveal.dataset.phase === 'shake' && this.openReveal) { clearTimeout(this.revealT); this.openReveal(); }
  }

  closeReveal() {
    if (this.reveal.hidden) return;
    if (this.reveal.dataset.phase === 'shake') { this.skipReveal(); return; }   // first tap shows the result, the next closes
    clearTimeout(this.revealT);
    this.reveal.hidden = true;
    this.sfx('ui_click', { vol: 0.5 });
    const first = this.cards.find((c) => c.btn.getAttribute('aria-disabled') !== 'true');
    setTimeout(() => (first ? first.btn : $('btn-cs-back')).focus({ preventScroll: true }), 30);
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
