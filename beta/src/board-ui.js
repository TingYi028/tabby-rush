import { localList, fetchRemote, remote, boardKey, playerName, myRemoteRank } from './leaderboard.js';
import { settings } from './settings.js';
import { applyName } from './settings-ui.js';
import { dayKey } from './daily.js';

const $ = (id) => document.getElementById(id);
const fmt = new Intl.NumberFormat('en-US');

/**
 * The leaderboard card (#board): tabs 全球 (world, only when assets/leaderboard.json is set up),
 * 今日挑戰 (today's daily board: world when online, else this device) and 我的紀錄 (this device's top 10).
 * Opens over the menu or the game-over card and returns there.
 */
export class BoardUI {
  constructor(ui, { click } = {}) {
    this.ui = ui;
    this.click = click || (() => {});
    this.from = 'menu';
    this.tab = 'mine';
    this.scope = 'week';  // world tab: this week's board or all-time
    this.token = 0;
    if (!ui.screens.includes('board')) ui.screens.push('board');
    this.tabs = [...document.querySelectorAll('#board-tabs button')];
    this.scopes = [...document.querySelectorAll('#board-scope button')];
    for (const b of this.scopes) b.addEventListener('click', () => { if (this.scope !== b.dataset.scope) { this.scope = b.dataset.scope; this.click(); this.render(); } });
    for (const b of this.tabs) b.addEventListener('click', () => { if (this.tab !== b.dataset.tab) { this.tab = b.dataset.tab; this.click(); this.render(); } });
    // arrow keys move between tabs / scopes (only the selected one is in the Tab order); landscape stacks the tabs
    const arrows = (e) => (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0);
    $('board-tabs').addEventListener('keydown', (e) => {
      const d = arrows(e);
      if (!d) return;
      e.preventDefault();
      const vis = this.tabs.filter((b) => !b.hidden);
      const i = vis.findIndex((b) => b.dataset.tab === this.tab);
      const b = vis[(i + d + vis.length) % vis.length];
      b.click();
      b.focus();
    });
    $('board-scope').addEventListener('keydown', (e) => {
      const d = arrows(e);
      if (!d) return;
      e.preventDefault();
      const i = this.scopes.findIndex((b) => b.dataset.scope === this.scope);
      const b = this.scopes[(i + d + this.scopes.length) % this.scopes.length];
      b.click();
      b.focus();
    });
    const name = $('board-name');
    name.addEventListener('change', () => { applyName(name); if (this.tab === 'mine') this.render(); });
    name.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) name.blur(); });
    $('btn-board')?.addEventListener('click', () => this.open('menu'));
    $('btn-board-over')?.addEventListener('click', () => this.open('over'));
    $('btn-board-back').addEventListener('click', () => this.close());
    window.addEventListener('keydown', (e) => {
      if (document.body.dataset.screen !== 'board' || e.code !== 'Escape' || e.isComposing || e.keyCode === 229) return;
      e.preventDefault();
      e.stopPropagation();
      this.close();
    }, true);
    remote.ready.then((on) => {
      $('tab-world').hidden = !on;
      if (on && this.tab === 'mine') this.tab = 'world';
      $('board-note').hidden = on;
    });
  }

  open(from, tab) {
    this.from = from;
    $('tab-world').hidden = !remote.on;
    $('board-note').hidden = remote.on;
    if (!remote.on && this.tab === 'world') this.tab = 'mine';
    if (tab && !(tab === 'world' && !remote.on)) this.tab = tab;
    const name = $('board-name');
    name.value = settings.get('name');
    name.placeholder = playerName();
    this.click();
    this.ui.show('board');
    this.render();
    setTimeout(() => this.tabs.find((b) => b.dataset.tab === this.tab)?.focus({ preventScroll: true }), 30);
  }

  close() {
    if (document.body.dataset.screen !== 'board') return;
    const name = $('board-name');
    if (document.activeElement === name) { applyName(name); name.blur(); }
    this.click();
    this.ui.show(this.from);
    const back = this.from === 'over' ? 'btn-board-over' : 'btn-board';
    setTimeout(() => $(back)?.focus({ preventScroll: true }), 30);
  }

  async render() {
    const token = ++this.token;
    for (const b of this.tabs) {
      const on = b.dataset.tab === this.tab;
      b.setAttribute('aria-selected', on);
      b.tabIndex = on ? 0 : -1;
    }
    const list = $('board-list'), status = $('board-status');
    const today = dayKey();
    let rows = [];
    const local = (l) => l.map((e) => ({ name: e.n, score: e.s, dist: e.d, me: !!e.me }));
    const online = this.tab === 'world' || (this.tab === 'daily' && remote.on);
    const worldBoard = this.scope === 'week' ? 'week' : 'all';
    $('board-scope').hidden = this.tab !== 'world';
    for (const b of this.scopes) {
      const on = b.dataset.scope === this.scope;
      b.setAttribute('aria-checked', on);
      b.tabIndex = on ? 0 : -1;
    }
    $('board-sub').textContent = this.tab === 'world'
      ? (this.scope === 'week' ? '本週排行・每週一早上 8 點重置' : '全世界最強的虎斑跑者（每人只留最佳成績）')
      : this.tab === 'daily' ? (remote.on ? '今天所有人跑同一條賽道' : '今天的每日挑戰（這台裝置）') : '這台裝置上的前 10 名';
    if (online) {
      list.textContent = '';
      status.hidden = false;
      status.textContent = '讀取中…';
      try {
        rows = await fetchRemote(this.tab === 'world' ? worldBoard : boardKey(today));
      } catch {
        if (token !== this.token) return;
        status.textContent = '連不上排行榜，請稍後再試。';
        return;
      }
      if (token !== this.token) return;
    } else {
      rows = local(this.tab === 'daily' ? localList('daily', today) : localList('all'));
    }
    list.textContent = '';
    status.hidden = rows.length > 0;
    status.textContent = this.tab === 'mine' ? '還沒有紀錄，跑一局就會出現！'
      : this.tab === 'daily' ? '今天還沒有人跑每日挑戰，搶第一！'
        : this.scope === 'week' ? '這週還沒有人上榜，快來搶第一！' : '還沒有人上榜，快來搶第一！';
    const frag = document.createDocumentFragment();
    rows.forEach((r, i) => {
      const li = document.createElement('li');
      li.className = 'board-row' + (r.me ? ' me' : '') + (i < 3 ? ` top${i + 1}` : '');
      const rank = document.createElement('span');
      rank.className = 'b-rank';
      rank.textContent = i + 1;
      const name = document.createElement('span');
      name.className = 'b-name';
      name.textContent = r.name || '神秘跑者';
      const dist = document.createElement('span');
      dist.className = 'b-dist';
      dist.textContent = `${fmt.format(r.dist)} m`;
      const score = document.createElement('b');
      score.className = 'b-score';
      score.textContent = fmt.format(r.score);
      li.append(rank, name, dist, score);
      frag.appendChild(li);
    });
    // outside the top N: show where the player stands, below a gap
    const mine = online ? myRemoteRank(this.tab === 'world' ? worldBoard : boardKey(today)) : null;
    if (mine && !rows.some((r) => r.me) && mine.rank > rows.length) {
      const gap = document.createElement('li');
      gap.className = 'board-gap';
      gap.textContent = '⋯';
      const li = document.createElement('li');
      li.className = 'board-row me';
      const rank = document.createElement('span');
      rank.className = 'b-rank';
      rank.textContent = mine.rank > 999 ? '999+' : mine.rank;
      const name = document.createElement('span');
      name.className = 'b-name';
      name.textContent = playerName();
      const dist = document.createElement('span');
      dist.className = 'b-dist';
      const score = document.createElement('b');
      score.className = 'b-score';
      score.textContent = fmt.format(mine.best);
      li.append(rank, name, dist, score);
      frag.append(gap, li);
    }
    list.appendChild(frag);
    const me = list.querySelector('.me'), body = list.parentElement;
    if (me && body) body.scrollTop = Math.max(0, me.offsetTop - body.offsetTop - body.clientHeight / 2 + me.offsetHeight / 2);
  }
}
