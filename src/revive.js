/*
 * Coin revive ("花金幣復活"): when a crash would end the run, a 3-second offer to pay coins and carry on.
 * The price doubles with each revive in the same run. main.js owns the game side (state 'revive' freezes
 * the world, spending, invulnerability); this module has the tuning, the track clearing and the overlay.
 */

export const REVIVE = {
  base: 250,     // price of the first revive in a run; doubles each time (250, 500, 1000 ...)
  time: 3,       // seconds to decide
  delay: 0.8,    // crash beat (s) before the offer appears
  invuln: 2,     // seconds of invulnerability after reviving
  clear: 30,     // metres ahead cleared in every lane (further at speed, see clearForRevive)
  arm: 0.35,     // input is ignored this long after the offer opens, so mashing keys can't spend coins
};

export const reviveCost = (n) => REVIVE.base * 2 ** n;

// Never in the way (same list the player's collision pass skips).
const HARMLESS = new Set(['ramp', 'pad', 'boost']);

/**
 * Clear the track for a revive, in every lane: each obstacle overlapping REVIVE.clear m ahead, or reached
 * before the invulnerability wears off (oncoming trains close in at run speed + their own), so the hero
 * never ends up inside a train when it does. Ramps, pads and boost strips stay; Spawner.smash takes a
 * removed train's ramp with it. Returns how many obstacles went.
 */
export function clearForRevive(spawner, dist, speed, invuln = REVIVE.invuln) {
  const doomed = spawner.obstacles.filter((o) => !HARMLESS.has(o.type) && o.s0 + o.len > dist - 2
    && o.s0 - dist < Math.max(REVIVE.clear, (speed + (o.moving ? o.speed : 0)) * (invuln + 0.3)));
  for (const o of doomed) if (spawner.obstacles.includes(o)) spawner.smash(o);
  return doomed.length;
}

const $ = (id) => document.getElementById(id);
const fmt = new Intl.NumberFormat('en-US');

/** The offer overlay: countdown ring, "復活（N 金幣）" and "放棄". h = { accept, decline, tick }. */
export class ReviveOverlay {
  constructor(ui, h) {
    ui.screens.push('revive'); // ui.show() now toggles the overlay like any other screen
    this.ui = ui;
    this.h = h;
    this.t = 0;
    this.e = {
      ring: $('revive-ring'), sec: $('revive-sec'), cost: $('revive-cost'), note: $('revive-note'),
      yes: $('btn-revive'), no: $('btn-giveup'),
    };
    this.e.yes.addEventListener('click', () => this.choose(true));
    this.e.no.addEventListener('click', () => this.choose(false));
  }

  /** Show the offer; the revive button is disabled when `wallet` (bank + run coins) can't cover `cost`. */
  open(cost, wallet) {
    const e = this.e;
    this.t = REVIVE.time;
    this.shown = -1;
    this.openedAt = performance.now();
    this.ok = wallet >= cost;
    e.cost.textContent = fmt.format(cost);
    e.yes.disabled = !this.ok;
    e.note.textContent = this.ok
      ? `持有 ${fmt.format(wallet)} 金幣・清空前方並無敵 ${REVIVE.invuln} 秒`
      : `金幣不足：持有 ${fmt.format(wallet)}，還差 ${fmt.format(cost - wallet)}`;
    this.ui.show('revive');
    this.update(0);
    setTimeout(() => (this.ok ? e.yes : e.no).focus({ preventScroll: true }), 30);
  }

  /** Advance the countdown on raw time (it freezes with the tab); true once it has run out. */
  update(raw) {
    this.t = Math.max(0, this.t - raw);
    this.e.ring.style.setProperty('--p', (this.t / REVIVE.time).toFixed(3));
    const s = Math.ceil(this.t);
    if (s !== this.shown) {
      this.shown = s;
      this.e.sec.textContent = s;
      if (s > 0 && this.h.tick) this.h.tick(s);
    }
    return this.t <= 0;
  }

  choose(yes) {
    if (performance.now() - this.openedAt < REVIVE.arm * 1000) return;
    if (yes && this.ok) this.h.accept();
    else if (!yes) this.h.decline();
  }

  /** Enter / Space = revive (or move on when it can't be afforded), Escape = give up. */
  key(e) {
    if (e.code === 'Escape') { e.preventDefault(); this.choose(false); }
    else if (e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space') {
      e.preventDefault();
      if (!e.repeat) this.choose(this.ok);
    }
  }
}
