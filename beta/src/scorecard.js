/**
 * A 1080x1350 score card (PNG) to share with a challenge link: the key-art banner (icons/og.jpg, logo included)
 * over a cream panel with the score, distance, name and the game's address. Drawn with the page's own fonts.
 * Resolves a File, or null when anything is unavailable (the caller then shares the plain link).
 */
const W = 1080, H = 1350;
const INK = '#3b1d0e';

function loadImage(src) {
  return new Promise((res) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => res(null);
    im.src = src;
  });
}

/** Text with the game's chunky ink outline. */
function outlined(g, text, x, y, fill, width = 14) {
  g.lineJoin = 'round';
  g.lineWidth = width;
  g.strokeStyle = INK;
  g.strokeText(text, x, y);
  g.fillStyle = fill;
  g.fillText(text, x, y);
}

export async function scoreCard({ score, dist, name, host }) {
  try {
    const art = await loadImage('icons/og.jpg');
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const g = c.getContext('2d');
    if (!g) return null;
    // banner: the 1200x630 key art fills the top
    const bh = Math.round(W * 630 / 1200);
    if (art) g.drawImage(art, 0, 0, W, bh);
    else { g.fillStyle = '#ffb052'; g.fillRect(0, 0, W, bh); }
    // panel
    g.fillStyle = '#fff5df';
    g.fillRect(0, bh, W, H - bh);
    g.fillStyle = INK;
    g.fillRect(0, bh - 6, W, 12);
    g.textAlign = 'center';
    g.textBaseline = 'alphabetic';
    const fmt = (n) => Math.floor(n).toLocaleString('en-US');
    g.font = '900 52px "Noto Sans TC", "Microsoft JhengHei", sans-serif';
    g.fillStyle = INK;
    g.fillText('我在 Tabby Rush 跑了', W / 2, bh + 110);
    g.font = '200px "Lilita One", "Noto Sans TC", sans-serif';
    outlined(g, fmt(score), W / 2, bh + 330, '#ff8a1f', 22);
    g.font = '900 56px "Noto Sans TC", "Microsoft JhengHei", sans-serif';
    g.fillStyle = INK;
    g.fillText(`分・${fmt(dist)} m`, W / 2, bh + 420);
    g.font = '900 64px "Noto Sans TC", "Microsoft JhengHei", sans-serif';
    outlined(g, '你能超越我嗎？', W / 2, bh + 545, '#ffffff', 16);
    g.font = '900 40px "Noto Sans TC", "Microsoft JhengHei", sans-serif';
    g.fillStyle = '#8a5a3a';
    g.fillText(`— ${name}`, W / 2, bh + 620, W - 120);
    // address pill
    const url = host.replace(/^https?:\/\//, '').replace(/\/$/, '');
    g.font = '44px "Lilita One", "Noto Sans TC", sans-serif';
    const tw = Math.min(W - 140, g.measureText(url).width + 90);
    const px = (W - tw) / 2, py = H - 128, ph = 84;
    g.fillStyle = INK;
    g.beginPath();
    g.moveTo(px + ph / 2, py);
    g.arcTo(px + tw, py, px + tw, py + ph, ph / 2);
    g.arcTo(px + tw, py + ph, px, py + ph, ph / 2);
    g.arcTo(px, py + ph, px, py, ph / 2);
    g.arcTo(px, py, px + tw, py, ph / 2);
    g.closePath();
    g.fill();
    g.fillStyle = '#ffd23f';
    g.fillText(url, W / 2, py + 58, tw - 60);
    const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
    return blob ? new File([blob], 'tabby-rush-score.png', { type: 'image/png' }) : null;
  } catch {
    return null;
  }
}
