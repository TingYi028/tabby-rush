import { POWER_META } from './ui.js';

/*
 * Views for src/progression.js: the 商店 screen, mission cards (menu / pause / game over),
 * the in-run "任務完成！" banner and the coins-to-bank line on the game-over card.
 * Markup lives in index.html (#menu-meta, #shop, #pause-missions, #go-meta, #mission-toast).
 */

const $ = (id) => document.getElementById(id);
const fmt = new Intl.NumberFormat('en-US');
const COIN = 'assets/ui/icon_coin.webp';
const NAMES = {
  magnet: POWER_META.magnet.label, sneakers: POWER_META.sneakers.label, x2: POWER_META.x2.label,
  jetpack: POWER_META.jetpack.label, shield: '開局自帶護盾',
};
const CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const SKIP = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 8.5A7.5 7.5 0 1 0 19.5 15" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/><path d="M20 3.5v5.5h-5.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const restart = (el, cls) => { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); };

export class MetaUI {
  constructor(api, ui, audio) {
    this.api = api;
    this.ui = ui;
    this.audio = audio;
    this.reduce = matchMedia('(prefers-reduced-motion: reduce)');
    this.queue = [];
    this.toastBusy = false;
    if (ui && !ui.screens.includes('shop')) ui.screens.push('shop');
    $('btn-shop')?.addEventListener('click', () => this.openShop());
    $('btn-shop-back')?.addEventListener('click', () => this.closeShop());
    $('menu-missions')?.addEventListener('click', (e) => {
      const b = e.target.closest('.mis-skip');
      if (b) this.onSkip(b);
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
  }

  sfx(name, opts) { if (this.audio) this.audio.play(name, opts); }

  /* ---------- mission cards ---------- */

  /**
   * One mission row. opts: skip (show the daily skip button), fresh (completed this run),
   * value (number shown instead of prog), gain (added this run), tag (small label before the number).
   */
  missionItem(s, opts = {}) {
    const li = document.createElement('li');
    li.className = `mis${s.done ? ' done' : ''}${opts.fresh ? ' fresh' : ''}`;
    li.dataset.slot = s.i;
    li.tabIndex = -1;
    const val = Math.floor(opts.value ?? s.prog);
    const p = s.done ? 1 : Math.max(0, Math.min(1, val / s.goal));
    const num = s.done ? (opts.fresh ? '完成！' : '完成') : `${fmt.format(val)}/${fmt.format(s.goal)}`;
    li.innerHTML = `<span class="mis-ico" aria-hidden="true">${s.done ? CHECK : `<b>${s.i + 1}</b>`}</span>
      <span class="mis-main"><span class="mis-top"><span class="mis-text"></span><span class="mis-num"></span></span>
      <span class="mis-bar" aria-hidden="true"><i style="--p:${p.toFixed(3)}"></i></span></span>`;
    li.querySelector('.mis-text').textContent = s.text;
    const n = li.querySelector('.mis-num');
    if (opts.tag && !s.done) { const t = document.createElement('small'); t.textContent = opts.tag; n.appendChild(t); }
    n.appendChild(document.createTextNode(num));
    if (opts.gain > 0 && !s.done) {
      const g = document.createElement('em');
      g.className = 'mis-gain';
      g.textContent = `+${fmt.format(opts.gain)}`;
      n.appendChild(g);
    }
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
    for (const el of document.querySelectorAll('.mis-lvl')) el.textContent = `Lv.${st.lvl + 1}`;
    for (const el of document.querySelectorAll('.mis-mult b')) el.textContent = `×${1 + st.bonus}`;
  }

  /** Main menu cards; `levelUp` = new mission level reached while settling (0 = none). */
  renderMenu(levelUp = 0) {
    const list = $('menu-missions');
    if (!list) return;
    const st = this.api.state();
    this.head(st);
    list.replaceChildren(...st.slots.map((s) => this.missionItem(s, { skip: st.canSkip && !s.done })));
    $('mis-skip-note').hidden = st.canSkip || st.slots.every((s) => s.done);
    if (levelUp) this.allDone(st.bonus, true);
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

  /* ---------- in-run banner ---------- */

  missionDone(text) {
    this.sfx('powerup', { vol: 0.55, rate: 1.35 });
    this.push({ title: '任務完成！', text, kind: 'done' });
  }

  allDone(bonus, now = false) {
    if (now) this.sfx('newbest', { vol: 0.5 });
    this.push({ title: now ? '任務等級提升！' : '三個任務全部完成！', text: `起跑倍率 ×${1 + bonus}${now ? '' : '（下一局生效）'}`, kind: 'all' });
  }

  banner(title, icon) {
    this.push({ title, text: '', kind: 'info', icon: POWER_META[icon] ? POWER_META[icon].icon : null });
  }

  push(item) {
    this.queue.push(item);
    if (!this.toastBusy) this.nextToast();
  }

  nextToast() {
    const el = $('mission-toast');
    const item = this.queue.shift();
    if (!el || !item) { this.toastBusy = false; return; }
    this.toastBusy = true;
    el.hidden = false;
    el.dataset.kind = item.kind;
    const ico = el.querySelector('.mt-ico');
    ico.innerHTML = item.icon ? `<img src="${item.icon}" alt="">` : CHECK;
    el.querySelector('.mt-title').textContent = item.title;
    const t = el.querySelector('.mt-text');
    t.textContent = item.text;
    t.hidden = !item.text;
    restart(el, 'show');
    this.toastTimer = setTimeout(() => this.nextToast(), item.kind === 'info' ? 1600 : 2300);
  }

  /** Drop queued banners and hide the current one (run start / end, back to the menu). */
  clearToasts() {
    this.queue.length = 0;
    clearTimeout(this.toastTimer);
    this.toastBusy = false;
    const el = $('mission-toast');
    if (el) { el.classList.remove('show'); el.hidden = true; }
  }

  /* ---------- game over ---------- */

  renderGameOver(r) {
    const earn = $('go-earn');
    if (!earn) return;
    earn.textContent = `+${fmt.format(r.earned)}`;
    this.countUp($('go-bank'), r.bank - r.earned, r.bank);
    const up = $('go-levelup');
    up.hidden = !r.levelUp;
    if (r.levelUp) up.querySelector('span').textContent = `任務等級 Lv.${r.lvl + 1}・起跑倍率 ×${1 + r.bonus}`;
    // the finished set (before any level-up swap): this run's value for single-run missions, totals + gain otherwise
    for (const el of document.querySelectorAll('#go-meta .mis-lvl')) el.textContent = `Lv.${r.lvl + 1 - (r.levelUp ? 1 : 0)}`;
    $('go-missions').replaceChildren(...r.slots.map((s) => this.missionItem(s, {
      fresh: s.fresh, value: s.run ? s.runVal : s.prog, gain: s.gain, tag: s.run ? '本局 ' : '',
    })));
    if (r.levelUp) setTimeout(() => this.sfx('newbest', { vol: 0.45, rate: 1.1 }), 700);
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
      const pct = (l) => `${Math.round(a.SHOP.shield.chance[l] * 100)}%`;
      return lv >= max ? `機率 ${pct(lv)}・已滿級` : `機率 ${pct(lv)} → ${pct(lv + 1)}`;
    }
    const sec = (l) => a.base[type] + a.UPGRADE_STEP * l;
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
      this.sfx('coin', { vol: 0.7, rate: 1.2 });
      this.sfx('powerup', { vol: 0.6, rate: 1.1 });
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
    if (!this.ui) return;
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
    setTimeout(() => $('btn-shop')?.focus({ preventScroll: true }), 30);
  }
}
