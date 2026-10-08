const $ = (id) => document.getElementById(id);
const fmt = new Intl.NumberFormat('en-US');

const POWER_META = {
  magnet: { label: '磁鐵吸金', icon: 'assets/ui/icon_magnet.webp' },
  sneakers: { label: '超級彈跳鞋', icon: 'assets/ui/icon_sneakers.webp' },
  x2: { label: '分數 ×2', icon: 'assets/ui/icon_x2.webp' },
  shield: { label: '泡泡護盾', icon: 'assets/ui/icon_shield.webp' },
  jetpack: { label: '噴射背包', icon: 'assets/ui/icon_jetpack.webp' },
};
export const RUSH_ICON = 'assets/ui/icon_rush.webp';
export { POWER_META };

/**
 * Long numbers on narrow phones: shrink a game-over value until its row fits, instead of wrapping the label;
 * a row that still doesn't fit (7-digit score on a 320 px phone) puts the value under its label.
 */
function fitStats() {
  for (const row of document.querySelectorAll('#over .go-row:not([hidden])')) {
    const b = row.querySelector('b');
    if (!b) continue;
    const fits = () => row.scrollWidth <= row.clientWidth + 1;
    const shrink = () => {
      b.style.fontSize = '';
      let px = parseFloat(getComputedStyle(b).fontSize);
      while (!fits() && px > 12) b.style.fontSize = `${--px}px`;
    };
    row.classList.remove('stack');
    shrink();
    if (!fits()) { row.classList.add('stack'); shrink(); }
  }
}

export class UI {
  constructor(h) {
    this.screens = ['loading', 'menu', 'pause', 'over'];
    this.last = { score: -1, coins: -1, mult: -1 };
    $('btn-play').addEventListener('click', h.play);
    $('btn-pause').addEventListener('click', h.pause);
    $('btn-resume').addEventListener('click', h.resume);
    $('btn-quit').addEventListener('click', h.menu);
    $('btn-retry').addEventListener('click', h.retry || h.play);
    $('btn-home').addEventListener('click', h.menu);
    for (const id of ['btn-sound', 'btn-sound-hud']) $(id).addEventListener('click', h.toggleSound);
    const touch = matchMedia('(pointer: coarse)').matches;
    $('hint-keys').hidden = touch;
    $('hint-touch').hidden = !touch;
    this.initTricks(h, touch);
    this.bars = {};
    const wrap = $('powerbars');
    for (const [k, meta] of Object.entries(POWER_META)) {
      if (k === 'shield') continue;
      const row = document.createElement('div');
      row.className = `pbar pbar-${k}`;
      row.hidden = true;
      row.innerHTML = `<img src="${meta.icon}" alt=""><span class="track"><i></i></span>`;
      wrap.appendChild(row);
      this.bars[k] = { row, fill: row.querySelector('i') };
    }
    // game-over stats: refit whenever a value / row changes or the card resizes (rotation, toolbars)
    const stats = document.querySelector('#over .go-stats');
    let fitQ = 0;
    const queueFit = () => { if (!fitQ) fitQ = requestAnimationFrame(() => { fitQ = 0; fitStats(); }); };
    new MutationObserver(queueFit).observe(stats, { subtree: true, childList: true, characterData: true, attributeFilter: ['hidden'] });
    if (window.ResizeObserver) new ResizeObserver(queueFit).observe(stats);
  }

  show(name) {
    for (const s of this.screens) $(s).hidden = s !== name;
    $('hud').hidden = !(name === 'hud' || name === 'pause');
    if (name === 'hud') this.coinRect = null;   // measured again on the first coin flight of the run
    document.body.dataset.screen = name;
  }

  loading(p) {
    $('load-fill').style.width = `${Math.round(p * 100)}%`;
    $('load-text').textContent = `正在把軌道鋪好… ${Math.round(p * 100)}%`;
  }

  stats(best, bank) {
    $('best').textContent = fmt.format(best);
    $('bank').textContent = fmt.format(bank);
  }

  hud(score, coins, m, hot) {
    if (score !== this.last.score) { $('score').textContent = fmt.format(score); this.last.score = score; }
    if (coins !== this.last.coins) {
      const txt = fmt.format(coins);
      $('coins').textContent = txt;
      this.last.coins = coins;
      if (txt.length !== this.coinLen) { this.coinLen = txt.length; this.coinRect = null; }   // the box grows leftwards with the digits
    }
    if (m !== this.last.mult) {
      const el = $('mult');
      el.textContent = `×${m}`;
      el.classList.toggle('hot', hot);
      el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump');
      this.last.mult = m;
    }
  }

  /** Frenzy meter: fill 0..1; `active` while TABBY RUSH is running; `ready` when full and waiting for the player. */
  rush(fill, active, ready = false) {
    const el = $('rush');
    const f = Math.round(Math.max(0, Math.min(1, fill)) * 400) / 400;
    const key = `${f}|${active}`;
    if (key !== this.rushKey) {   // only touch the DOM when something changed
      this.rushKey = key;
      $('rush-fill').style.transform = `scaleX(${f})`;
      el.classList.toggle('full', fill >= 0.999 || active);
      el.classList.toggle('active', active);
    }
    const on = ready && !active;
    if (on !== this.rushOn) {
      this.rushOn = on;
      el.classList.toggle('ready', on);
      $('btn-rush').hidden = !on;
    }
  }

  /** Floating bonus text above the hero; `scale` grows the text with the combo. */
  popup(text, tone = 'sun', scale = 1) {
    const wrap = $('popups');
    const el = document.createElement('div');
    el.className = `popup tone-${tone}`;
    el.textContent = text;
    if (scale !== 1) el.style.fontSize = `calc(clamp(20px, 3.6vw, 30px) * ${scale.toFixed(2)})`;
    wrap.appendChild(el);
    while (wrap.children.length > 3) wrap.firstChild.remove();
    setTimeout(() => el.remove(), 1200);
  }

  coinPop() {
    const el = $('coin-box');
    el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
  }

  /* ---------- tricks: combo ring, coin flights, manual RUSH ---------- */

  initTricks(h, touch) {
    this.touch = touch;
    this.cmb = { n: -1, kinds: -1, p: -1, el: $('combo'), ring: $('combo-ring'), num: $('combo-n') };
    this.cmb.icons = [...this.cmb.el.querySelectorAll('.combo-kinds i')];
    const btn = $('btn-rush');
    btn.querySelector('kbd').hidden = touch;
    this.rushOn = false;
    // Pointer taps fire from main.js on pointer-up (rushTap) unless the touch became a swipe, so a swipe that
    // starts on the button still steers the hero and a slightly sloppy tap still fires. `click` only covers
    // keyboard activation (Enter / Space) and is ignored right after a pointer tap.
    this.rushTapT = -1e9;
    this.rushTap = () => {
      this.rushTapT = performance.now();
      btn.blur();
      if (h.rush) h.rush();
    };
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (performance.now() - this.rushTapT < 800 || e.detail > 0) return; // pointer clicks are handled on pointer-up
      if (h.rush) h.rush();
    });
    // pooled coins that fly from the pickup to the HUD counter
    const wrap = $('coin-fly');
    this.fly = { pool: [], i: 0, t: -1e9 };
    for (let i = 0; i < 16; i++) {
      const img = document.createElement('img');
      img.src = 'assets/ui/icon_coin.webp';
      img.alt = '';
      img.decoding = 'async';
      wrap.appendChild(img);
      this.fly.pool.push(img);
    }
    this.reduce = matchMedia('(prefers-reduced-motion: reduce)');
    // where coins fly to: measured once per layout, not on every flight (forced layout on phones)
    this.coinRect = null;
    this.coinLen = 0;
    window.addEventListener('resize', () => { this.coinRect = null; });
  }

  /**
   * Combo HUD: `n` tricks in the chain, `frac` 0..1 of the chain window left,
   * `kinds` bitmask of trick kinds collected (1 jump, 2 roll, 4 graze).
   */
  combo(n, frac, kinds) {
    const c = this.cmb;
    if (n !== c.n) {
      c.el.classList.toggle('on', n > 0);
      c.el.dataset.tier = n >= 5 ? '5' : n >= 3 ? '3' : '1';
      c.num.textContent = n > 0 ? `×${n}` : '';
      if (n > c.n && n > 0) { c.ring.classList.remove('bump'); void c.ring.offsetWidth; c.ring.classList.add('bump'); }
      c.n = n;
    }
    if (kinds !== c.kinds) {
      c.icons.forEach((el, i) => el.classList.toggle('lit', (kinds & (1 << i)) !== 0));
      c.el.classList.toggle('all', kinds === 7);
      c.kinds = kinds;
    }
    const p = n > 0 ? Math.round(Math.max(0, Math.min(1, frac)) * 120) / 120 : 0;
    if (p !== c.p) { c.ring.style.setProperty('--p', p.toFixed(3)); c.p = p; }
  }

  /**
   * A collected coin flies from screen point (x, y) to the coin counter, which pops on arrival.
   * Returns false when no flight covers this coin (caller pops the counter directly).
   */
  coinFly(x, y) {
    const f = this.fly;
    if (!f || this.reduce.matches || !f.pool[0].animate) return false;
    const now = performance.now();
    if (now - f.t < 45) return true; // throttled: the coin already in the air pops the counter
    f.t = now;
    const img = f.pool[f.i];
    f.i = (f.i + 1) % f.pool.length;
    if (img.anim) img.anim.cancel();
    const r = this.coinRect || (this.coinRect = $('coin-box').querySelector('img').getBoundingClientRect());
    const tx = r.left + r.width / 2, ty = r.top + r.height / 2;
    // quadratic arc: rises from the pickup first, then sweeps across into the counter
    const cx = x + (tx - x) * 0.1, cy = ty + (y - ty) * 0.2;
    const frames = [];
    for (let k = 0; k <= 8; k++) {
      const t = k / 8, u = 1 - t;
      const px = u * u * x + 2 * u * t * cx + t * t * tx;
      const py = u * u * y + 2 * u * t * cy + t * t * ty;
      frames.push({ transform: `translate(${px.toFixed(1)}px, ${py.toFixed(1)}px) translate(-50%, -50%) scale(${(0.9 - 0.4 * t).toFixed(3)})` });
    }
    img.style.visibility = 'visible';
    const a = img.animate(frames, { duration: 380, easing: 'cubic-bezier(.55,-.4,.8,.5)', fill: 'forwards' });
    img.anim = a;
    a.onfinish = () => {
      if (img.anim !== a) return;
      img.anim = null;
      img.style.visibility = 'hidden';
      a.cancel();
      this.coinPop();
    };
    return true;
  }

  powers(power, max) {
    for (const k in this.bars) {
      const b = this.bars[k], t = power[k];
      const on = t > 0, f = on ? Math.round(Math.max(0, t / max[k]) * 300) / 300 : 0;
      if (b.on !== on) { b.on = on; b.row.hidden = !on; }
      if (on && b.f !== f) { b.f = f; b.fill.style.transform = `scaleX(${f})`; }
    }
    if (this.shieldOn !== !!power.shield) { this.shieldOn = !!power.shield; $('shield-chip').hidden = !power.shield; }
  }

  toast(text, icon, tone = 'sun') {
    const el = $('toast');
    el.innerHTML = '';
    if (icon) { const img = document.createElement('img'); img.src = icon; img.alt = ''; el.appendChild(img); }
    const span = document.createElement('span');
    span.textContent = text;
    el.appendChild(span);
    el.dataset.tone = tone;
    el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  }

  gameOver({ score, coins, dist, best, newBest }) {
    $('go-score').textContent = fmt.format(score);
    $('go-coins').textContent = fmt.format(coins);
    $('go-dist').textContent = `${fmt.format(dist)} m`;
    $('go-best').textContent = fmt.format(best);
    $('go-ribbon').hidden = !newBest;
    this.show('over');
    setTimeout(() => $('btn-retry').focus({ preventScroll: true }), 50);
  }

  setMuted(m) {
    for (const id of ['btn-sound', 'btn-sound-hud']) {
      const b = $(id);
      b.classList.toggle('muted', m);
      b.setAttribute('aria-label', m ? '開啟聲音' : '關閉聲音');
    }
  }
}
