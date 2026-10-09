import { localList, fetchRemote, remote, boardKey, playerName, myRemoteRank, myTag, onRename, onNameSync } from './leaderboard.js';
import { settings } from './settings.js';
import { applyName, SYNC_TEXT } from './settings-ui.js';
import { dayKey } from './daily.js';

/** "#1234" after a world-board name: tells players with the same name apart. */
const tagEl = (tag) => { const t = document.createElement('small'); t.className = 'b-tag'; t.textContent = `#${tag}`; return t; };

const $ = (id) => document.getElementById(id);
const fmt = new Intl.NumberFormat('en-US');
const LIMIT = 50; // rows asked of the world board

/**
 * Displayed ranks of rows sorted by score: equal scores share a rank, as the server counts it (o_rank = 1 + players
 * with a higher score), so the number in the list matches the one the game-over card announced.
 */
export function rankRows(rows) {
  const out = [];
  rows.forEach((r, i) => out.push(i > 0 && r.score === rows[i - 1].score ? out[i - 1] : i + 1));
  return out;
}

/**
 * The rank to show for the player's own row under a full top-N list they are not in (0 = no extra row): their last
 * known rank, never above the end of the list. A board with room left has all its rows: no row of theirs = not on it.
 */
export function belowList(rows, mine, limit = LIMIT) {
  if (!mine || rows.length < limit || rows.some((r) => r.me)) return 0;
  return Math.max(mine.rank, rows.length + 1);
}

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
    this.loading = 0;     // token of the world fetch in flight
    this.subText = '';
    this.noteT = 0;
    if (!ui.screens.includes('board')) ui.screens.push('board');
    this.tabs = [...document.querySelectorAll('#board-tabs button')];
    this.scopes = [...document.querySelectorAll('#board-scope button')];
    for (const b of this.scopes) b.addEventListener('click', () => { if (this.scope !== b.dataset.scope) { this.scope = b.dataset.scope; this.click(); this.render(); } });
    for (const b of this.tabs) b.addEventListener('click', () => { if (this.tab !== b.dataset.tab) { this.tab = b.dataset.tab; this.click(); this.render(); } });
    // landscape phones stack the tabs (index.html): tell screen readers which arrow keys apply
    const stacked = matchMedia('(max-height: 520px) and (min-width: 600px) and (min-aspect-ratio: 1001/1000)');
    const orient = () => $('board-tabs').setAttribute('aria-orientation', stacked.matches ? 'vertical' : 'horizontal');
    orient();
    stacked.addEventListener?.('change', orient);
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
    name.addEventListener('change', () => applyName(name)); // the rest follows the setting: onRename / onNameSync below
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
      if (document.body.dataset.screen === 'board') this.render(); // opened before the world board came up
    });
    // a rename (from this card, 設定 or the name card): own rows change at once; 名稱同步中… / 名稱已更新 in the subtitle
    $('board-sub').setAttribute('aria-live', 'polite');
    onRename(() => this.renamed());
    onNameSync((state, changed) => {
      if (document.body.dataset.screen !== 'board') return;
      clearTimeout(this.noteT);
      $('board-sub').textContent = SYNC_TEXT[state] || this.subText;
      if (state !== 'syncing') this.noteT = setTimeout(() => { $('board-sub').textContent = this.subText; }, 2600);
      if (changed && this.tab !== 'mine' && remote.on && !this.loading) this.render(true); // the server has it: reload quietly
    });
  }

  /** The player's own rows wear the new name now (the world rows are the server's copy until it hears it). */
  renamed() {
    if (document.body.dataset.screen !== 'board') return;
    if (this.tab === 'mine' || (this.tab === 'daily' && !remote.on)) { this.render(); return; }
    const n = playerName();
    for (const el of $('board-list').querySelectorAll('.board-row.me .b-name')) if (el.firstChild?.nodeType === 3) el.firstChild.nodeValue = n;
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

  /** `quiet`: reload the world rows in place (no loading text, no jump) after the server learned a new name. */
  async render(quiet = false) {
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
    if (!quiet) {
      clearTimeout(this.noteT);
      this.subText = this.tab === 'world'
        ? (this.scope === 'week' ? '本週排行・每週一早上 8 點重置' : '全世界最強的虎斑跑者（每人只留最佳成績）')
        : this.tab === 'daily' ? (remote.on ? '今天所有人跑同一條賽道' : '今天的每日挑戰（這台裝置）') : '這台裝置上的前 10 名';
      $('board-sub').textContent = this.subText;
    }
    if (online) {
      if (!quiet) {
        list.textContent = '';
        status.hidden = false;
        status.textContent = '讀取中…';
      }
      this.loading = token;
      try {
        rows = await fetchRemote(this.tab === 'world' ? worldBoard : boardKey(today), LIMIT);
      } catch {
        if (token !== this.token) return;
        if (!quiet) status.textContent = '連不上排行榜，請稍後再試。';
        return;
      } finally {
        if (this.loading === token) this.loading = 0;
      }
      if (token !== this.token) return;
    } else {
      rows = local(this.tab === 'daily' ? localList('daily', today) : localList('all'));
    }
    const body = list.parentElement, keepTop = quiet && body ? body.scrollTop : -1;
    list.textContent = '';
    status.hidden = rows.length > 0;
    status.textContent = this.tab === 'mine' ? '還沒有紀錄，跑一局就會出現！'
      : this.tab === 'daily' ? '今天還沒有人跑每日挑戰，搶第一！'
        : this.scope === 'week' ? '這週還沒有人上榜，快來搶第一！' : '還沒有人上榜，快來搶第一！';
    const frag = document.createDocumentFragment();
    const ranks = rankRows(rows);
    rows.forEach((r, i) => {
      const li = document.createElement('li');
      li.className = 'board-row' + (r.me ? ' me' : '') + (ranks[i] <= 3 ? ` top${ranks[i]}` : '');
      const rank = document.createElement('span');
      rank.className = 'b-rank';
      rank.textContent = ranks[i];
      const name = document.createElement('span');
      name.className = 'b-name';
      name.textContent = r.name || '神秘跑者';
      if (r.tag) name.append(tagEl(r.tag));
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
    const below = belowList(rows, mine);
    if (below) {
      const gap = document.createElement('li');
      gap.className = 'board-gap';
      gap.textContent = '⋯';
      const li = document.createElement('li');
      li.className = 'board-row me';
      const rank = document.createElement('span');
      rank.className = 'b-rank';
      rank.textContent = below > 999 ? '999+' : below;
      const name = document.createElement('span');
      name.className = 'b-name';
      name.textContent = playerName();
      if (myTag()) name.append(tagEl(myTag()));
      const dist = document.createElement('span');
      dist.className = 'b-dist';
      const score = document.createElement('b');
      score.className = 'b-score';
      score.textContent = fmt.format(mine.best);
      li.append(rank, name, dist, score);
      frag.append(gap, li);
    }
    list.appendChild(frag);
    const me = list.querySelector('.me');
    if (keepTop >= 0) body.scrollTop = keepTop;
    else if (me && body) body.scrollTop = Math.max(0, me.offsetTop - body.offsetTop - body.clientHeight / 2 + me.offsetHeight / 2);
  }
}
