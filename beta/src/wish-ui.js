import { list, submit, vote, checkWish, loadDraft, saveDraft, quotaLeft, answerCount, markSeen, hasWished, CATS, STATUS, MAX_LEN, DAILY, MESSAGES } from './wish.js';
import { remote } from './leaderboard.js';

/*
 * 許願池 (src/wish.js is the data side): a card over the menu where players write feature wishes and vote on the public
 * ones. Everything is built from JavaScript; the entry button (#btn-wish, next to 排行榜) and the stylesheet link are in
 * index.html, the styles in wish.css. Wish and note texts are the players' / the developer's words: they only ever go in
 * with textContent.
 *
 * Layouts (CSS decides the grid, `compact` decides what is shown):
 *   tall screens      the form on top, 熱門 / 我的 tabs and the list under it
 *   short + narrow    (phones in portrait, <= 740 px high) one thing at a time: a 「我要許願」 button swaps the list for the form
 *   short + wide      (phones in landscape, laptops) form on the left, tabs + list on the right
 */

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const SVG_UP = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4.5 4.2 14h4.9v5.5h5.8V14h4.9z"/></svg>';
const TABS = ['hot', 'mine'];

/** The rows of a tab: 熱門 = every public wish in the server's order; 我的 = this player's own, newest first. */
export function shown(items, tab) {
  if (tab === 'mine') return items.filter((i) => i.mine).sort((a, b) => (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0) || b.id - a.id);
  return items.filter((i) => i.status !== 'pending');
}

const snippet = (t, n = 24) => { const a = [...t]; return a.length > n ? a.slice(0, n).join('') + '…' : t; };

/** Vote button / count of one row, from the item's state. */
function paintVote(li, it) {
  const n = li.querySelector('.wish-side b');
  if (n) n.textContent = String(it.votes);
  const b = li.querySelector('.wish-up');
  if (b) {
    b.setAttribute('aria-pressed', String(it.voted));
    b.setAttribute('aria-label', `${it.voted ? '取消支持' : '支持這個願望'}：${snippet(it.text)}，目前 ${it.votes} 票`);
  }
}

function itemEl(it) {
  const li = el('li', `wish-item st-${it.status}${it.mine ? ' mine' : ''}`);
  li.dataset.id = String(it.id);
  const side = el('div', 'wish-side');
  if (STATUS[it.status].vote) {
    const b = el('button', 'wish-up');
    b.type = 'button';
    b.innerHTML = `${SVG_UP}<b></b>`;
    side.append(b);
  } else {
    const t = el('div', 'wish-tally');
    t.innerHTML = '<span>票</span><b></b>';
    side.append(t);
  }
  const main = el('div', 'wish-main');
  const tags = el('div', 'wish-tags');
  tags.append(el('span', `wish-badge st-${it.status}`, STATUS[it.status].label), el('span', 'wish-cat', it.cat));
  if (it.mine) tags.append(el('span', 'wish-own', '我的'));
  main.append(el('p', 'wish-text', it.text), tags);
  if (it.note) {
    const n = el('p', 'wish-note');
    n.append(el('b', null, '開發者：'), el('span', null, it.note));
    main.append(n);
  } else if (it.status === 'pending') {
    main.append(el('p', 'wish-note soft', '審核通過後才會公開，大家就能投票。'));
  }
  li.append(side, main);
  paintVote(li, it);
  return li;
}

export class WishUI {
  constructor(ui, { click } = {}) {
    this.ui = ui;
    this.click = click || (() => {});
    this.items = [];
    this.tab = 'hot';
    this.cat = CATS[0];
    this.writing = false;   // compact layout: the form is showing instead of the list
    this.compact = false;
    this.sending = false;
    this.loaded = false;    // the server has answered once
    this.state = '';        // why there is no list: '' | 'soon' | 'offline' | 'limit' | 'error'
    this.errMsg = '';
    this.token = 0;
    this.busy = new Set();  // wishes with a vote on its way
    this.msgT = 0;
    this.draftT = 0;
    if (!ui.screens.includes('wish')) ui.screens.push('wish');
    this.ensureCss();
    this.build();
    this.mqShort = matchMedia('(max-height: 740px)');
    this.mqWide = matchMedia('(min-width: 600px) and (min-aspect-ratio: 1001/1000)');
    for (const mq of [this.mqShort, this.mqWide]) {
      if (mq.addEventListener) mq.addEventListener('change', () => this.layout());
      else if (mq.addListener) mq.addListener(() => this.layout());
    }
    this.layout();
    $('btn-wish')?.addEventListener('click', () => this.open());
    // Escape closes (not while an IME is choosing characters); keys pressed with the focus outside the card (on the page
    // itself) must not reach the menu's Enter / Space = start a run
    window.addEventListener('keydown', (e) => {
      if (document.body.dataset.screen !== 'wish') return;
      if (e.code === 'Escape') {
        if (e.isComposing || e.keyCode === 229) return;
        e.preventDefault();
        e.stopPropagation();
        this.close();
      } else if (!this.root.contains(e.target)) e.stopPropagation();
    }, true);
    // a player who has wished before gets a dot on the menu button when the developer has answered (one quiet request per visit)
    remote.ready.then((on) => {
      if (!on || !hasWished()) return;
      const t = setTimeout(() => this.peek(), 4000);
      t.unref?.(); // (node tests)
    });
  }

  ensureCss() {
    if (document.querySelector('link[href="wish.css"]')) return;
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = 'wish.css';
    document.head.appendChild(l);
  }

  /* ---------- DOM ---------- */

  build() {
    const sec = el('section', 'screen dim');
    sec.id = 'wish';
    sec.hidden = true;
    sec.setAttribute('aria-labelledby', 'wish-title');
    sec.innerHTML = `<div class="card wish-card" role="dialog" aria-modal="true" aria-labelledby="wish-title">
        <h2 id="wish-title">許願池</h2>
        <p class="wish-rules">請描述想要的功能；不要留個人資料或連結。審核後會公開，大家可以投票。</p>
        <button type="button" class="btn btn-alt btn-small wish-toggle" id="btn-wish-toggle" aria-controls="wish-form" hidden>我要許願</button>
        <div class="wish-form" id="wish-form" role="group" aria-label="寫下你的願望">
          <label class="sr-only" for="wish-text">你的願望</label>
          <textarea id="wish-text" maxlength="${MAX_LEN}" rows="3" placeholder="例如：想要雙人同樂模式、新的場景主題…" enterkeyhint="done" autocomplete="off" spellcheck="false"></textarea>
          <div class="wish-cats" id="wish-cats" role="radiogroup" aria-label="願望分類"></div>
          <div class="wish-send">
            <button type="button" class="btn btn-small" id="btn-wish-send">送出願望</button>
            <span class="wish-quota" id="wish-quota"></span>
            <span class="wish-count" id="wish-count" aria-hidden="true">0/${MAX_LEN}</span>
          </div>
        </div>
        <p class="wish-msg" id="wish-msg" role="status" aria-live="polite"></p>
        <div class="wish-tabs" id="wish-tabs" role="tablist" aria-label="願望清單">
          <button type="button" role="tab" id="wish-tab-hot" data-tab="hot" aria-controls="wish-body">熱門</button>
          <button type="button" role="tab" id="wish-tab-mine" data-tab="mine" aria-controls="wish-body">我的</button>
        </div>
        <div class="wish-body" id="wish-body" role="tabpanel" tabindex="0" aria-labelledby="wish-tab-hot">
          <p class="wish-status" id="wish-status" role="status" aria-live="polite" hidden></p>
          <ul class="wish-list" id="wish-list"></ul>
        </div>
        <div class="card-actions"><button id="btn-wish-back" class="btn btn-alt" type="button">返回</button></div>
      </div>`;
    const anchor = $('board');
    if (anchor && anchor.parentNode) anchor.after(sec); else ($('app') || document.body).appendChild(sec);
    this.root = sec;
    this.card = sec.querySelector('.wish-card');
    this.rules = sec.querySelector('.wish-rules');
    this.toggle = $('btn-wish-toggle');
    this.form = $('wish-form');
    this.input = $('wish-text');
    this.cats = $('wish-cats');
    this.send = $('btn-wish-send');
    this.quota = $('wish-quota');
    this.count = $('wish-count');
    this.msg = $('wish-msg');
    this.tabs = $('wish-tabs');
    this.body = $('wish-body');
    this.status = $('wish-status');
    this.listEl = $('wish-list');

    for (const c of CATS) {
      const b = el('button', 'wish-catbtn', c);
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.dataset.cat = c;
      b.addEventListener('click', () => { this.setCat(c); this.click(); this.onInput(); });
      this.cats.appendChild(b);
    }
    this.cats.addEventListener('keydown', (e) => {
      const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
      if (!d) return;
      e.preventDefault();
      const i = CATS.indexOf(this.cat);
      const next = CATS[(i + d + CATS.length) % CATS.length];
      this.setCat(next);
      this.cats.querySelector(`[data-cat="${next}"]`)?.focus();
      this.onInput();
    });
    this.setCat(this.cat);

    this.input.addEventListener('input', () => this.onInput());
    this.input.addEventListener('keydown', (e) => {
      if (e.isComposing || e.keyCode === 229) return;           // IME candidate selection
      if (e.key === 'Enter') {
        e.preventDefault();                                      // a wish is one line; Ctrl / Cmd + Enter sends, Enter moves on
        if (e.ctrlKey || e.metaKey) this.doSend(); else this.send.focus();
      }
    });
    this.send.addEventListener('click', () => this.doSend());
    this.toggle.addEventListener('click', () => { this.click(); this.setWriting(!this.writing); });
    $('btn-wish-back').addEventListener('click', () => this.close());
    for (const b of this.tabs.querySelectorAll('button')) {
      b.addEventListener('click', () => this.setTab(b.dataset.tab, true));
      b.addEventListener('keydown', (e) => {
        const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
        if (!d) return;
        e.preventDefault();
        const next = TABS[(TABS.indexOf(this.tab) + d + TABS.length) % TABS.length];
        this.setTab(next, true);
        $(`wish-tab-${next}`).focus();
      });
    }
    this.listEl.addEventListener('click', (e) => {
      const b = e.target.closest('.wish-up');
      const li = b && b.closest('.wish-item');
      const it = li && this.items.find((x) => x.id === Number(li.dataset.id));
      if (it) this.onVote(li, it);
    });
    this.status.addEventListener('click', (e) => { if (e.target.closest('button')) { this.click(); this.refresh(); } });
    // nothing typed here may start a run: the menu's Enter / Space handler sits on window
    sec.addEventListener('keydown', (e) => { e.stopPropagation(); });

    const d = loadDraft();
    if (d) { this.input.value = d.text; this.setCat(d.cat); }
    this.onInput(true);
  }

  /** Short + narrow screens show the list or the form, one at a time. */
  layout() {
    const compact = this.mqShort.matches && !this.mqWide.matches;
    if (compact !== this.compact) {
      // the on-screen keyboard can shrink the page into the compact layout: a form being typed in stays
      if (compact && document.activeElement === this.input) this.writing = true;
      this.compact = compact;
    }
    this.sync();
  }

  setWriting(on) {
    this.writing = on;
    this.sync();
    if (on) setTimeout(() => this.input.focus({ preventScroll: true }), 30);
    else this.tabFocus();
  }

  tabFocus() { setTimeout(() => $(`wish-tab-${this.tab}`)?.focus({ preventScroll: true }), 30); }

  /** Show / hide and label the parts for the current layout and state. */
  sync() {
    const c = this.compact;
    this.toggle.hidden = !c;
    this.rules.hidden = c && !this.writing;   // browsing the list on a small screen: the rules line makes room
    this.form.hidden = c && !this.writing;
    this.tabs.hidden = this.body.hidden = c && this.writing;
    this.toggle.setAttribute('aria-expanded', String(!this.form.hidden));
    this.toggle.textContent = this.writing ? '看大家的願望' : '我要許願';
    if (c) this.card.dataset.compact = '1'; else delete this.card.dataset.compact;
    for (const t of TABS) {
      const b = $(`wish-tab-${t}`);
      b.setAttribute('aria-selected', String(t === this.tab));
      b.tabIndex = t === this.tab ? 0 : -1;
    }
    this.body.setAttribute('aria-labelledby', `wish-tab-${this.tab}`);
    const left = quotaLeft();
    const off = this.state === 'soon';
    this.input.disabled = off;
    this.send.disabled = this.sending || off || left <= 0;
    this.quota.textContent = off ? MESSAGES.soon : left <= 0 ? '今天的願望名額用完囉' : `今天還能許 ${left} 個（每天最多 ${DAILY} 個）`;
  }

  setCat(c) {
    this.cat = c;
    for (const b of this.cats.querySelectorAll('.wish-catbtn')) {
      const on = b.dataset.cat === c;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    }
  }

  setTab(id, click) {
    if (!TABS.includes(id)) id = 'hot';
    if (click && id !== this.tab) this.click();
    this.tab = id;
    this.sync();
    this.renderList();
    this.body.scrollTop = 0;
  }

  /** A line under the form (live region): tone 'err' | 'good' | '' ; good ones fade after a while. */
  say(text, tone = '') {
    clearTimeout(this.msgT);
    this.msg.textContent = text;
    this.msg.className = `wish-msg${tone ? ` ${tone}` : ''}`;
    if (text && tone === 'good') this.msgT = setTimeout(() => this.say(''), 9000);
  }

  onInput(quiet = false) {
    const n = this.input.value.length;
    this.count.textContent = `${n}/${MAX_LEN}`;
    this.count.className = `wish-count${n >= MAX_LEN ? ' full' : n >= MAX_LEN - 20 ? ' near' : ''}`;
    this.input.classList.remove('bad');
    if (!quiet && this.msg.classList.contains('err')) this.say('');
    clearTimeout(this.draftT);
    if (!quiet) this.draftT = setTimeout(() => saveDraft(this.input.value, this.cat), 600);
  }

  /* ---------- open / close ---------- */

  open() {
    this.click();
    this.ui.show('wish');
    this.writing = false;
    this.layout();
    this.say('');
    this.renderList();
    this.refresh();
    this.tabFocus();
  }

  close() {
    if (document.body.dataset.screen !== 'wish') return;
    clearTimeout(this.draftT);
    saveDraft(this.input.value, this.cat);
    if (this.loaded) markSeen(this.items);
    this.setDot(false);
    this.input.blur();
    this.click();
    this.ui.show('menu');
    setTimeout(() => $('btn-wish')?.focus({ preventScroll: true }), 30);
  }

  /* ---------- the list ---------- */

  /** Load the wishes; `quiet` keeps what is on screen until the answer comes. */
  async refresh(quiet = false) {
    const token = ++this.token;
    if (!this.loaded && !quiet) this.renderList();
    const r = await list(50);
    if (token !== this.token) return;
    if (r.ok) {
      this.items = r.wishes;
      this.loaded = true;
      this.state = '';
      if (document.body.dataset.screen === 'wish') { markSeen(this.items); this.setDot(false); }
    } else {
      this.state = r.code;
      this.errMsg = r.message;
      if (this.loaded) this.say(r.message, 'err'); // (what is on screen stays)
    }
    this.renderList();
    this.sync();
  }

  renderList() {
    const rows = shown(this.items, this.tab);
    this.listEl.replaceChildren();
    let text = '';
    let retry = false;
    if (!this.loaded && this.state) { text = this.errMsg || MESSAGES[this.state] || MESSAGES.error; retry = this.state !== 'soon'; }
    else if (!this.loaded) text = '讀取中…';
    else if (!rows.length) text = this.tab === 'mine' ? '你還沒有許過願望。寫下想要的功能，審核通過後大家就能投票。' : '還沒有公開的願望，來當第一個許願的人吧！';
    this.status.hidden = !text;
    this.status.textContent = text;
    if (retry) {
      const b = el('button', 'btn btn-alt btn-small wish-retry', '再試一次');
      b.type = 'button';
      this.status.append(b);
    }
    const frag = document.createDocumentFragment ? document.createDocumentFragment() : this.listEl;
    for (const it of rows) frag.appendChild(itemEl(it));
    if (frag !== this.listEl) this.listEl.appendChild(frag);
  }

  async onVote(li, it) {
    if (this.busy.has(it.id)) return;
    this.busy.add(it.id);
    const was = it.voted;
    it.voted = !was; // shown at once, corrected below if the server says otherwise
    it.votes = Math.max(0, it.votes + (was ? -1 : 1));
    paintVote(li, it);
    this.click();
    const r = await vote(it.id);
    this.busy.delete(it.id);
    if (r.ok) { it.votes = r.votes; paintVote(li, it); return; }
    it.voted = was;
    it.votes = Math.max(0, it.votes + (was ? 1 : -1));
    paintVote(li, it);
    this.say(r.message, 'err');
    if (r.code === 'closed') this.refresh(true);
  }

  /* ---------- sending ---------- */

  async doSend() {
    if (this.sending) return;
    if (this.state === 'soon') { this.say(MESSAGES.soon, 'err'); return; }
    if (quotaLeft() <= 0) { this.say(MESSAGES.quota, 'err'); this.sync(); return; }
    const chk = checkWish(this.input.value);
    if (!chk.ok) {
      this.say(MESSAGES[chk.reason], 'err');
      this.input.classList.remove('bad');
      void this.input.offsetWidth;
      this.input.classList.add('bad');
      this.input.focus({ preventScroll: true });
      return;
    }
    this.sending = true;
    this.sync();
    this.say('送出中…');
    const r = await submit(this.input.value, this.cat);
    this.sending = false;
    if (!r.ok) {
      if (r.code === 'soon') this.state = 'soon';
      this.say(r.message, 'err');
      this.sync();
      this.renderList();
      return;
    }
    this.click();
    clearTimeout(this.draftT);
    this.input.value = '';
    saveDraft('', this.cat);
    this.onInput(true);
    this.items = [r.wish, ...this.items.filter((x) => x.id !== r.wish.id)];
    this.tab = 'mine';
    this.writing = false;
    this.say(quotaLeft() > 0 ? '願望送出了！審核通過後就會公開，大家就能投票。' : '願望送出了！今天的名額用完囉，明天再來。', 'good');
    this.sync();
    this.renderList();
    this.body.scrollTop = 0;
    if (this.compact) this.tabFocus(); else this.send.focus({ preventScroll: true });
  }

  /* ---------- the menu button's dot ---------- */

  setDot(on) {
    const b = $('btn-wish');
    if (!b) return;
    const d = b.querySelector('.wish-dot');
    if (d) d.hidden = !on;
    if (on) b.setAttribute('aria-label', '許願池，有新的回覆'); else b.removeAttribute('aria-label');
  }

  /** Look quietly for answers to the player's wishes (menu, once per visit). */
  async peek() {
    const r = await list(50);
    if (!r.ok) return;
    this.items = r.wishes;
    this.loaded = true;
    this.state = '';
    this.setDot(answerCount(r.wishes) > 0);
  }
}
