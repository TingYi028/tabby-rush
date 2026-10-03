const $ = (id) => document.getElementById(id);
const fmt = new Intl.NumberFormat('en-US');

const POWER_META = {
  magnet: { label: '磁鐵吸金', icon: 'assets/ui/icon_magnet.webp' },
  sneakers: { label: '超級彈跳鞋', icon: 'assets/ui/icon_sneakers.webp' },
  x2: { label: '分數 ×2', icon: 'assets/ui/icon_x2.webp' },
  shield: { label: '泡泡護盾', icon: 'assets/ui/icon_shield.webp' },
};
export { POWER_META };

export class UI {
  constructor(h) {
    this.screens = ['loading', 'menu', 'pause', 'over'];
    this.last = { score: -1, coins: -1, mult: -1 };
    $('btn-play').addEventListener('click', h.play);
    $('btn-pause').addEventListener('click', h.pause);
    $('btn-resume').addEventListener('click', h.resume);
    $('btn-quit').addEventListener('click', h.menu);
    $('btn-retry').addEventListener('click', h.play);
    $('btn-home').addEventListener('click', h.menu);
    for (const id of ['btn-sound', 'btn-sound-hud']) $(id).addEventListener('click', h.toggleSound);
    const touch = matchMedia('(pointer: coarse)').matches;
    $('hint-keys').hidden = touch;
    $('hint-touch').hidden = !touch;
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
  }

  show(name) {
    for (const s of this.screens) $(s).hidden = s !== name;
    $('hud').hidden = !(name === 'hud' || name === 'pause');
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

  hud(score, coins, mult, x2) {
    if (score !== this.last.score) { $('score').textContent = fmt.format(score); this.last.score = score; }
    if (coins !== this.last.coins) { $('coins').textContent = fmt.format(coins); this.last.coins = coins; }
    const m = mult * (x2 ? 2 : 1);
    if (m !== this.last.mult) {
      const el = $('mult');
      el.textContent = `×${m}`;
      el.classList.toggle('hot', x2);
      el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump');
      this.last.mult = m;
    }
  }

  coinPop() {
    const el = $('coin-box');
    el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
  }

  powers(power, max) {
    for (const [k, b] of Object.entries(this.bars)) {
      const t = power[k];
      b.row.hidden = !(t > 0);
      if (t > 0) b.fill.style.transform = `scaleX(${Math.max(0, t / max[k])})`;
    }
    $('shield-chip').hidden = !power.shield;
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
