import { settings, canVibrate, vibrate } from './settings.js';
import { playerName } from './leaderboard.js';

const $ = (id) => document.getElementById(id);

/** Save a typed leaderboard name; a refused one (abuse filter) flashes the field and says so in the placeholder. */
export function applyName(input) {
  const typed = input.value.trim();
  settings.set('name', input.value);
  input.value = settings.get('name');
  const refused = typed !== '' && settings.get('name') === '';
  input.classList.toggle('bad', refused);
  input.placeholder = refused ? '這個名字不能用，換一個吧' : playerName();
  if (refused) setTimeout(() => { input.classList.remove('bad'); input.placeholder = playerName(); }, 2600);
  return !refused;
}

/**
 * The settings card (#settings). It opens on top of the menu or the pause card and returns to that screen;
 * every control applies immediately (settings.set) and is saved.
 */
export class SettingsUI {
  constructor(ui, { click } = {}) {
    this.ui = ui;
    this.click = click || (() => {});
    this.from = 'menu';
    if (!ui.screens.includes('settings')) ui.screens.push('settings');
    this.seg = [...document.querySelectorAll('#set-fx button')];
    for (const b of this.seg) b.addEventListener('click', () => { settings.set('fx', b.dataset.fx); this.click(); this.sync(); });
    const toggle = (id, key, after) => $(id).addEventListener('change', (e) => {
      settings.set(key, e.target.checked);
      this.click();
      if (after) after(e.target.checked);
      this.sync();
    });
    toggle('set-calm', 'calm');
    toggle('set-shake', 'shake');
    toggle('set-haptics', 'haptics', (on) => { if (on) vibrate(30); });
    $('set-haptics-row').hidden = !canVibrate();
    for (const k of ['music', 'sfx']) {
      const r = $(`set-${k}`);
      r.addEventListener('input', () => { settings.set(k, r.value / 100); this.paint(r); });
      r.addEventListener('change', () => { if (k === 'sfx') this.click(); });
    }
    const name = $('set-name');
    name.addEventListener('change', () => applyName(name));
    name.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) name.blur(); });
    $('btn-settings')?.addEventListener('click', () => this.open('menu'));
    $('btn-settings-pause')?.addEventListener('click', () => this.open('pause'));
    $('btn-set-back').addEventListener('click', () => this.close());
    // radio-group keys for the effects switch
    $('set-fx').addEventListener('keydown', (e) => {
      const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
      if (!d) return;
      e.preventDefault();
      const i = this.seg.findIndex((b) => b.dataset.fx === settings.get('fx'));
      const b = this.seg[(i + d + this.seg.length) % this.seg.length];
      b.click();
      b.focus();
    });
    // the card sits on top of the menu / pause state (main.js ignores its own keys while it is open)
    window.addEventListener('keydown', (e) => {
      if (document.body.dataset.screen !== 'settings' || e.code !== 'Escape' || e.isComposing || e.keyCode === 229) return;
      e.preventDefault();
      e.stopPropagation();
      this.close();
    }, true);
  }

  open(from) {
    this.from = from;
    this.sync();
    this.click();
    this.ui.show('settings');
    setTimeout(() => this.seg.find((b) => b.getAttribute('aria-checked') === 'true')?.focus({ preventScroll: true }), 30);
  }

  close() {
    if (document.body.dataset.screen !== 'settings') return;
    const name = $('set-name');
    if (document.activeElement === name) { applyName(name); name.blur(); }
    this.click();
    this.ui.show(this.from);
    const back = this.from === 'pause' ? 'btn-settings-pause' : 'btn-settings';
    setTimeout(() => $(back)?.focus({ preventScroll: true }), 30);
  }

  sync() {
    const fx = settings.get('fx');
    for (const b of this.seg) {
      const on = b.dataset.fx === fx;
      b.setAttribute('aria-checked', on);
      b.tabIndex = on ? 0 : -1;
    }
    $('set-calm').checked = settings.calm();
    $('set-shake').checked = settings.get('shake');
    $('set-haptics').checked = settings.get('haptics');
    for (const k of ['music', 'sfx']) { const r = $(`set-${k}`); r.value = Math.round(settings.get(k) * 100); this.paint(r); }
    if (document.activeElement !== $('set-name')) $('set-name').value = settings.get('name');
    $('set-name').placeholder = playerName();
  }

  paint(r) { r.style.setProperty('--v', `${r.value}%`); }
}
