import { store } from './audio.js';
import { settings } from './settings.js';
import { applyName } from './settings-ui.js';
import { playerName } from './leaderboard.js';

const $ = (id) => document.getElementById(id);

/**
 * The "what's your name?" card (#name): shown once, the first time a run is started without a leaderboard name.
 * 開始 saves the typed name (an empty or refused one keeps the default) and starts the run; 先跳過 just starts.
 * The name can be changed later in 設定 or on the leaderboard card. A name saved here renames the seeded / past local
 * rows too (leaderboard.js listens to the setting); a new player has no world row yet, so the first run carries it.
 */
export class NameUI {
  constructor(ui, { click } = {}) {
    this.ui = ui;
    this.click = click || (() => {});
    this.then = null;
    if (!ui.screens.includes('name')) ui.screens.push('name');
    const input = $('name-input');
    $('btn-name-go').addEventListener('click', () => {
      if (input.value.trim() && !applyName(input)) { input.focus(); return; } // refused: let them try again
      this.done();
    });
    $('btn-name-skip').addEventListener('click', () => this.done());
    input.addEventListener('keydown', (e) => {
      if (e.isComposing || e.keyCode === 229) return; // IME candidate selection
      if (e.key === 'Enter') { e.preventDefault(); $('btn-name-go').click(); }
    });
    window.addEventListener('keydown', (e) => {
      if (document.body.dataset.screen !== 'name' || e.code !== 'Escape' || e.isComposing || e.keyCode === 229) return;
      e.preventDefault();
      e.stopPropagation();
      this.done();
    }, true);
  }

  /** True when the card should come up before this run. */
  needed() { return !settings.get('name') && !store.get('nameAsked', false); }

  /** Show the card; `then` starts the run once the player has answered. */
  open(then) {
    this.then = then;
    const input = $('name-input');
    input.value = '';
    delete input.dataset.kept;
    input.classList.remove('bad');
    input.placeholder = playerName();
    this.click();
    this.ui.show('name');
    setTimeout(() => input.focus({ preventScroll: true }), 60);
  }

  done() {
    if (document.body.dataset.screen !== 'name') return;
    store.set('nameAsked', true);
    $('name-input').blur();
    this.click();
    const then = this.then;
    this.then = null;
    this.ui.show('menu');
    then?.();
  }
}
