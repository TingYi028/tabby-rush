import { DAILY } from './daily.js';

const $ = (id) => document.getElementById(id);

/**
 * The how-to-play card (#help), opened from the "?" corner button on the menu and returning there.
 * Touch devices see the swipe wording, keyboards the keys.
 */
export class HelpUI {
  constructor(ui, { click } = {}) {
    this.ui = ui;
    this.click = click || (() => {});
    if (!ui.screens.includes('help')) ui.screens.push('help');
    const touch = matchMedia('(pointer: coarse)').matches;
    for (const el of document.querySelectorAll('#help [data-touch]')) el.hidden = !touch;
    for (const el of document.querySelectorAll('#help [data-keys]')) el.hidden = touch;
    // the daily goal lives in daily.js: keep the how-to-play text in step with it
    const daily = [...document.querySelectorAll('#help .help-row')].find((r) => r.querySelector('b')?.textContent === '每日挑戰');
    const dp = daily && daily.querySelector('p');
    if (dp) dp.textContent = dp.textContent.replace('1,000 m', `${DAILY.goal.toLocaleString('en-US')} m`);
    $('btn-help').addEventListener('click', () => this.open());
    $('btn-help-back').addEventListener('click', () => this.close());
    window.addEventListener('keydown', (e) => {
      if (document.body.dataset.screen !== 'help' || e.code !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      this.close();
    }, true);
  }

  open() {
    this.click();
    this.ui.show('help');
    $('help-list').scrollTop = 0;
    setTimeout(() => $('btn-help-back').focus({ preventScroll: true }), 30);
  }

  close() {
    if (document.body.dataset.screen !== 'help') return;
    this.click();
    this.ui.show('menu');
    setTimeout(() => $('btn-help')?.focus({ preventScroll: true }), 30);
  }
}
