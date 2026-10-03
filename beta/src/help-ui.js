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
