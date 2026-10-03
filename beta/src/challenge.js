import { cleanName } from './settings.js';

/**
 * Friend challenges without a server: a link carries the target run in its hash,
 *   https://…/tabby-rush/#vs=<score>-<dist>-<url-encoded name>
 * Opening it shows the target in the menu, puts a marker on the track at the friend's distance and
 * compares the result on the game-over card.
 */
export function parseChallenge(hash = location.hash) {
  const m = /^#vs=(\d{1,8})-(\d{1,7})(?:-(.*))?$/.exec(hash || '');
  if (!m) return null;
  let name = '';
  try { name = cleanName(decodeURIComponent(m[3] || '')); } catch { name = ''; }
  const score = Number(m[1]), dist = Number(m[2]);
  if (!(score > 0) || score > 50000000 || dist > 1000000) return null;
  return { score, dist, name: name || '神秘跑者' };
}

const HOME = 'https://tingyi028.github.io/tabby-rush/';

/** The game's own address when served from GitHub Pages or a local server, else the public one (iframes, mirrors). */
function gameUrl() {
  const h = location.hostname;
  return h === 'tingyi028.github.io' || h === '127.0.0.1' || h === 'localhost' ? `${location.origin}${location.pathname}` : HOME;
}

export function challengeLink({ score, dist, name }) {
  const base = gameUrl();
  return `${base}#vs=${Math.floor(score)}-${Math.floor(dist)}-${encodeURIComponent(cleanName(name))}`;
}

/**
 * Share (phones: the score card image + link when the platform takes files, else the link) or copy (desktop).
 * Resolves 'shared' | 'copied' | 'cancelled' | 'failed'.
 */
export async function shareChallenge(run, card = null) {
  const url = challengeLink(run);
  const text = `我在 Tabby Rush 跑了 ${run.score.toLocaleString('en-US')} 分（${run.dist.toLocaleString('en-US')} m）！你能超越我嗎？`;
  if (navigator.share && matchMedia('(pointer: coarse)').matches) {
    try {
      if (card && navigator.canShare && navigator.canShare({ files: [card] })) {
        await navigator.share({ files: [card], title: 'Tabby Rush 挑戰', text: `${text}\n${url}` });
      } else {
        await navigator.share({ title: 'Tabby Rush 挑戰', text, url });
      }
      return 'shared';
    } catch (e) {
      if (e && e.name === 'AbortError') return 'cancelled';
    }
  }
  try { await navigator.clipboard.writeText(`${text}\n${url}`); return 'copied'; } catch { /* fall back below */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = `${text}\n${url}`;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok ? 'copied' : 'failed';
  } catch { return 'failed'; }
}
