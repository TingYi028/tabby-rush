// Procedural canvas art: track materials, train liveries, prop atlas, particles, clouds.

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

export function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const t = amt < 0 ? 0 : 255, p = Math.abs(amt);
  r = Math.round(r + (t - r) * p); g = Math.round(g + (t - g) * p); b = Math.round(b + (t - b) * p);
  return `rgb(${r},${g},${b})`;
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function speckle(g, w, h, n, r, alpha) {
  for (let i = 0; i < n; i++) {
    const v = r() < 0.5 ? 0 : 255;
    g.fillStyle = `rgba(${v},${v},${v},${alpha * r()})`;
    g.fillRect(r() * w, r() * h, 1 + r() * 1.5, 1 + r() * 1.5);
  }
}

/* ---------- ground ---------- */

export function gravelCanvas() {
  const S = 512, c = makeCanvas(S, S), g = c.getContext('2d'), r = rng(11);
  g.fillStyle = '#a08d76';
  g.fillRect(0, 0, S, S);
  const cols = ['#8a7762', '#b5a28b', '#77654f', '#c6b69e', '#6a5a4a', '#a59787', '#90826f', '#bfae95'];
  for (let i = 0; i < 6000; i++) {
    const x = r() * S, y = r() * S, rx = 1.4 + r() * 3.4, ry = rx * (0.55 + r() * 0.45), a = r() * Math.PI;
    const col = cols[(r() * cols.length) | 0];
    for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) {
      const px = x + ox, py = y + oy;
      if (px < -8 || px > S + 8 || py < -8 || py > S + 8) continue;
      g.fillStyle = 'rgba(40,30,20,0.35)';
      g.beginPath(); g.ellipse(px + 0.8, py + 1, rx, ry, a, 0, Math.PI * 2); g.fill();
      g.fillStyle = col;
      g.beginPath(); g.ellipse(px, py, rx, ry, a, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(255,250,235,0.28)';
      g.beginPath(); g.ellipse(px - rx * 0.3, py - ry * 0.35, rx * 0.4, ry * 0.3, a, 0, Math.PI * 2); g.fill();
    }
  }
  for (let i = 0; i < 16; i++) {
    const x = r() * S, y = r() * S, rad = 30 + r() * 70;
    for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) {
      const grd = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, rad);
      grd.addColorStop(0, 'rgba(60,44,30,0.16)');
      grd.addColorStop(1, 'rgba(60,44,30,0)');
      g.fillStyle = grd;
      g.fillRect(x + ox - rad, y + oy - rad, rad * 2, rad * 2);
    }
  }
  return c;
}

export function concreteCanvas() {
  const W = 512, H = 256, c = makeCanvas(W, H), g = c.getContext('2d'), r = rng(23);
  g.fillStyle = '#d6cdbf';
  g.fillRect(0, 0, W, H);
  speckle(g, W, H, 9000, r, 0.12);
  for (let i = 0; i < 26; i++) {
    const x = r() * W, w = 4 + r() * 14, len = 40 + r() * 120;
    const grd = g.createLinearGradient(0, 26, 0, 26 + len);
    grd.addColorStop(0, 'rgba(90,78,64,0.16)');
    grd.addColorStop(1, 'rgba(90,78,64,0)');
    g.fillStyle = grd;
    g.fillRect(x, 26, w, len);
  }
  for (let x = 0; x < W; x += 128) {
    g.fillStyle = 'rgba(105,95,84,0.6)'; g.fillRect(x, 0, 3, H);
    g.fillStyle = 'rgba(255,255,255,0.3)'; g.fillRect(x + 3, 0, 2, H);
  }
  g.fillStyle = '#eee7dc'; g.fillRect(0, 0, W, 22);
  g.fillStyle = 'rgba(0,0,0,0.2)'; g.fillRect(0, 22, W, 4);
  const dirt = g.createLinearGradient(0, 150, 0, H);
  dirt.addColorStop(0, 'rgba(92,70,48,0)');
  dirt.addColorStop(1, 'rgba(92,70,48,0.5)');
  g.fillStyle = dirt;
  g.fillRect(0, 150, W, H - 150);
  return c;
}

export function sidewalkCanvas() {
  const S = 256, c = makeCanvas(S, S), g = c.getContext('2d'), r = rng(5);
  g.fillStyle = '#cbbfad';
  g.fillRect(0, 0, S, S);
  speckle(g, S, S, 4000, r, 0.14);
  g.strokeStyle = 'rgba(95,84,72,0.55)';
  g.lineWidth = 3;
  for (const p of [0, 128]) {
    g.beginPath(); g.moveTo(p + 1.5, 0); g.lineTo(p + 1.5, S); g.stroke();
    g.beginPath(); g.moveTo(0, p + 1.5); g.lineTo(S, p + 1.5); g.stroke();
  }
  for (let i = 0; i < 6; i++) {
    const x = r() * S, y = r() * S, rad = 12 + r() * 30;
    const grd = g.createRadialGradient(x, y, 0, x, y, rad);
    grd.addColorStop(0, 'rgba(70,60,50,0.14)');
    grd.addColorStop(1, 'rgba(70,60,50,0)');
    g.fillStyle = grd;
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  return c;
}

/* ---------- trains ---------- */

export const TRAIN_VARIANTS = [
  { body: '#f2892c', dark: '#b85a17', stripe: '#fff1d6', stripe2: '#1f8f8a', roof: '#c3c9ce', num: '12' },
  { body: '#27ad9d', dark: '#16766b', stripe: '#ffd23f', stripe2: '#fff6e6', roof: '#c3c9ce', num: '07' },
  { body: '#cdd5dc', dark: '#8f9ba6', stripe: '#d8343f', stripe2: '#21405f', roof: '#a9b3bb', num: '22' },
  { body: '#df463e', dark: '#9f2b27', stripe: '#fff4e0', stripe2: '#ffc93c', roof: '#c3c9ce', num: '31' },
  { body: '#3b75d8', dark: '#244f9e', stripe: '#ffd23f', stripe2: '#fff4e0', roof: '#c3c9ce', num: '48' },
];

// Atlas layout (1024x512 canvas, flipY texture): side panel on top, then front/back/roof/dark.
export const TRAIN_UV = {
  SIDE: [0, 0.5, 1, 1],
  FRONT: [0, 0, 0.25, 0.5],
  BACK: [0.25, 0, 0.5, 0.5],
  ROOF: [0.5, 0, 0.75, 0.5],
  DARK: [0.75, 0, 1, 0.4],
  ROOFBOX: [0.76, 0.462, 0.99, 0.495],
};

function glass(g, x, y, w, h, rad) {
  roundRect(g, x, y, w, h, rad);
  const grd = g.createLinearGradient(x, y, x, y + h);
  grd.addColorStop(0, '#1a2f47');
  grd.addColorStop(1, '#3a6a8a');
  g.fillStyle = grd;
  g.fill();
  g.save();
  roundRect(g, x, y, w, h, rad);
  g.clip();
  g.fillStyle = 'rgba(255,255,255,0.2)';
  g.beginPath();
  g.moveTo(x + w * 0.15, y); g.lineTo(x + w * 0.45, y); g.lineTo(x + w * 0.2, y + h); g.lineTo(x - w * 0.1, y + h);
  g.fill();
  g.fillStyle = 'rgba(255,255,255,0.1)';
  g.beginPath();
  g.moveTo(x + w * 0.55, y); g.lineTo(x + w * 0.65, y); g.lineTo(x + w * 0.4, y + h); g.lineTo(x + w * 0.3, y + h);
  g.fill();
  g.restore();
  roundRect(g, x, y, w, h, rad);
  g.lineWidth = 5;
  g.strokeStyle = '#eef1f3';
  g.stroke();
  roundRect(g, x - 3, y - 3, w + 6, h + 6, rad + 2);
  g.lineWidth = 2;
  g.strokeStyle = 'rgba(30,20,10,0.45)';
  g.stroke();
}

function drawSide(g, v, decals, r) {
  const W = 1024, H = 256;
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, shade(v.body, 0.2));
  grad.addColorStop(0.5, v.body);
  grad.addColorStop(1, v.dark);
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  g.fillStyle = 'rgba(0,0,0,0.28)'; g.fillRect(0, 0, W, 8);
  g.fillStyle = 'rgba(255,255,255,0.4)'; g.fillRect(0, 8, W, 3);
  g.fillStyle = v.stripe; g.fillRect(0, H * 0.6, W, H * 0.075);
  g.fillStyle = v.stripe2; g.fillRect(0, H * 0.685, W, H * 0.03);
  const sk = g.createLinearGradient(0, H * 0.86, 0, H);
  sk.addColorStop(0, '#3b3532');
  sk.addColorStop(1, '#1b1817');
  g.fillStyle = sk;
  g.fillRect(0, H * 0.88, W, H * 0.12);

  for (const [x, w] of [[58, 150], [372, 118], [508, 118], [816, 150]]) glass(g, x, H * 0.17, w, H * 0.33, 14);
  for (const x of [236, 664]) {
    const y = H * 0.13, w = 104, h = H * 0.75;
    g.fillStyle = shade(v.body, -0.08);
    g.fillRect(x, y, w, h);
    g.strokeStyle = 'rgba(30,20,10,0.55)'; g.lineWidth = 4; g.strokeRect(x, y, w, h);
    g.beginPath(); g.moveTo(x + w / 2, y); g.lineTo(x + w / 2, y + h); g.stroke();
    glass(g, x + 12, y + 14, w / 2 - 22, h * 0.42, 8);
    glass(g, x + w / 2 + 10, y + 14, w / 2 - 22, h * 0.42, 8);
  }
  g.strokeStyle = 'rgba(0,0,0,0.18)';
  g.lineWidth = 2;
  for (const x of [30, 224, 352, 646, 782, 994]) {
    g.beginPath(); g.moveTo(x, 12); g.lineTo(x, H * 0.88); g.stroke();
  }
  g.fillStyle = 'rgba(255,255,255,0.4)';
  for (let x = 16; x < W; x += 22) {
    g.beginPath(); g.arc(x, 18, 2, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.arc(x, H * 0.855, 2, 0, Math.PI * 2); g.fill();
  }
  const grime = g.createLinearGradient(0, H * 0.5, 0, H * 0.9);
  grime.addColorStop(0, 'rgba(60,40,20,0)');
  grime.addColorStop(1, 'rgba(60,40,20,0.3)');
  g.fillStyle = grime;
  g.fillRect(0, H * 0.5, W, H * 0.4);

  if (decals.length) {
    const n = r() < 0.55 ? 1 : 2;
    const used = [];
    for (let i = 0; i < n; i++) {
      const img = decals[(r() * decals.length) | 0];
      let dh = H * (0.44 + r() * 0.2), dw = dh * img.width / img.height;
      if (dw > 400) { dw = 400; dh = dw * img.height / img.width; }
      let x = 40 + r() * (W - dw - 80);
      if (used.some(([a, b]) => x < b && x + dw > a)) x = (x + W / 2) % (W - dw - 40);
      used.push([x, x + dw]);
      const y = H * 0.94 - dh - r() * H * 0.05;
      g.save();
      g.translate(x + dw / 2, y + dh / 2);
      g.rotate((r() - 0.5) * 0.12);
      g.globalAlpha = 0.94;
      g.drawImage(img, -dw / 2, -dh / 2, dw, dh);
      g.restore();
    }
  }
  g.font = '28px "Lilita One", Arial Black, sans-serif';
  g.fillStyle = 'rgba(255,255,255,0.92)';
  g.fillText(v.num, 222 - 44, 46);
  g.strokeStyle = 'rgba(30,18,10,0.6)';
  g.lineWidth = 6;
  g.strokeRect(3, 3, W - 6, H - 6);
}

function drawEnd(g, ox, oy, v, front) {
  const W = 256, H = 256;
  const grad = g.createLinearGradient(0, oy, 0, oy + H);
  grad.addColorStop(0, shade(v.body, 0.2));
  grad.addColorStop(0.55, v.body);
  grad.addColorStop(1, v.dark);
  g.fillStyle = grad;
  g.fillRect(ox, oy, W, H);
  g.fillStyle = v.stripe; g.fillRect(ox, oy + H * 0.6, W, H * 0.075);
  g.fillStyle = v.stripe2; g.fillRect(ox, oy + H * 0.685, W, H * 0.03);
  if (front) {
    roundRect(g, ox + 40, oy + 12, 176, 28, 6);
    g.fillStyle = '#141414'; g.fill();
    g.font = 'bold 17px "Courier New", monospace';
    g.textAlign = 'center';
    g.fillStyle = '#ffb000';
    g.fillText('TABBY LINE', ox + 128, oy + 32);
    g.textAlign = 'left';
    glass(g, ox + 24, oy + 48, 208, 92, 18);
  } else {
    glass(g, ox + 70, oy + 40, 116, 110, 14);
  }
  for (const lx of [0.22, 0.78]) {
    const cx = ox + lx * W, cy = oy + 0.72 * H;
    g.beginPath(); g.arc(cx, cy, 20, 0, Math.PI * 2); g.fillStyle = '#e1e5e8'; g.fill();
    g.beginPath(); g.arc(cx, cy, 14, 0, Math.PI * 2); g.fillStyle = front ? '#fff6cf' : '#c53a2e'; g.fill();
    g.lineWidth = 3; g.strokeStyle = 'rgba(30,20,10,0.6)'; g.stroke();
  }
  roundRect(g, ox + 103, oy + 168, 50, 26, 5);
  g.fillStyle = '#fbfbf6'; g.fill();
  g.font = '20px "Lilita One", Arial Black, sans-serif';
  g.textAlign = 'center';
  g.fillStyle = '#2a2a2a';
  g.fillText(v.num, ox + 128, oy + 189);
  g.textAlign = 'left';
  g.fillStyle = '#2b2725'; g.fillRect(ox, oy + H * 0.88, W, H * 0.12);
  g.fillStyle = '#5b5550'; g.fillRect(ox + 106, oy + H * 0.9, 44, 20);
  g.strokeStyle = 'rgba(30,18,10,0.6)';
  g.lineWidth = 6;
  g.strokeRect(ox + 3, oy + 3, W - 6, H - 6);
}

export function trainAtlasCanvas(v, decals, seed) {
  const c = makeCanvas(1024, 512), g = c.getContext('2d'), r = rng(seed);
  drawSide(g, v, decals, r);
  drawEnd(g, 0, 256, v, true);
  drawEnd(g, 256, 256, v, false);
  // Roof: u runs around the curved roof, v along the car. Ribs across, a darker walkway down the middle.
  const rg = g.createLinearGradient(512, 0, 768, 0);
  rg.addColorStop(0, shade(v.roof, -0.35));
  rg.addColorStop(0.3, shade(v.roof, -0.12));
  rg.addColorStop(0.5, shade(v.roof, -0.05));
  rg.addColorStop(0.7, shade(v.roof, -0.12));
  rg.addColorStop(1, shade(v.roof, -0.35));
  g.fillStyle = rg;
  g.fillRect(512, 256, 256, 256);
  g.fillStyle = 'rgba(40,46,52,0.22)';
  g.fillRect(512 + 100, 256, 56, 256);
  for (let y = 256 + 4; y < 512; y += 16) {
    g.fillStyle = 'rgba(30,34,40,0.28)'; g.fillRect(512, y, 256, 3);
    g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(512, y + 3, 256, 2);
  }
  const grimeR = g.createLinearGradient(512, 0, 768, 0);
  grimeR.addColorStop(0, 'rgba(70,52,36,0.35)');
  grimeR.addColorStop(0.2, 'rgba(70,52,36,0)');
  grimeR.addColorStop(0.8, 'rgba(70,52,36,0)');
  grimeR.addColorStop(1, 'rgba(70,52,36,0.35)');
  g.fillStyle = grimeR;
  g.fillRect(512, 256, 256, 256);
  g.fillStyle = '#2a2624';
  g.fillRect(768, 256, 256, 256);
  g.fillStyle = '#b4bcc3';
  g.fillRect(768, 256, 256, 40);
  return c;
}

/* ---------- props atlas (barriers, ramps, posts) ---------- */

const PROP_RECTS = {
  STRIPE_RW: [0, 0, 512, 128],
  STRIPE_YB: [0, 128, 512, 128],
  SIGN: [512, 0, 512, 256],
  RAMP: [0, 256, 512, 512],
  METAL: [512, 256, 256, 256],
  WHITE: [768, 256, 256, 256],
  DARK: [512, 512, 256, 256],
  RED: [768, 512, 256, 256],
  ORANGE: [512, 768, 256, 256],
  YELLOW: [768, 768, 256, 256],
};

export const PROP_UV = Object.fromEntries(Object.entries(PROP_RECTS).map(([k, [x, y, w, h]]) => [
  k, [x / 1024 + 0.002, 1 - (y + h) / 1024 + 0.002, (x + w) / 1024 - 0.002, 1 - y / 1024 - 0.002],
]));

function stripes(g, [x, y, w, h], a, b, band) {
  g.save();
  g.beginPath(); g.rect(x, y, w, h); g.clip();
  g.fillStyle = a; g.fillRect(x, y, w, h);
  g.fillStyle = b;
  for (let i = -h; i < w + h; i += band * 2) {
    g.beginPath();
    g.moveTo(x + i, y + h); g.lineTo(x + i + band, y + h); g.lineTo(x + i + band + h, y); g.lineTo(x + i + h, y);
    g.fill();
  }
  const sh = g.createLinearGradient(0, y, 0, y + h);
  sh.addColorStop(0, 'rgba(255,255,255,0.25)');
  sh.addColorStop(0.5, 'rgba(255,255,255,0)');
  sh.addColorStop(1, 'rgba(0,0,0,0.2)');
  g.fillStyle = sh; g.fillRect(x, y, w, h);
  g.restore();
}

export function propsAtlasCanvas() {
  const c = makeCanvas(1024, 1024), g = c.getContext('2d'), r = rng(3);
  stripes(g, PROP_RECTS.STRIPE_RW, '#f4f1ea', '#e23b2e', 40);
  stripes(g, PROP_RECTS.STRIPE_YB, '#ffcf33', '#25211e', 40);

  // overhead sign
  {
    const [x, y, w, h] = PROP_RECTS.SIGN;
    g.fillStyle = '#ffcf33'; g.fillRect(x, y, w, h);
    g.fillStyle = '#25211e';
    g.fillRect(x, y, w, 18); g.fillRect(x, y + h - 18, w, 18);
    g.fillRect(x, y, 18, h); g.fillRect(x + w - 18, y, 18, h);
    g.font = '118px "Lilita One", Arial Black, sans-serif';
    g.textAlign = 'center';
    g.fillText('DUCK!', x + w / 2, y + 150);
    g.font = '30px "Lilita One", Arial Black, sans-serif';
    g.fillText('LOW CLEARANCE', x + w / 2, y + 210);
    g.textAlign = 'left';
    for (const cx of [x + 58, x + w - 58]) {
      for (const dy of [70, 120, 170]) {
        g.beginPath(); g.moveTo(cx - 26, y + dy); g.lineTo(cx, y + dy + 26); g.lineTo(cx + 26, y + dy);
        g.lineTo(cx + 26, y + dy - 12); g.lineTo(cx, y + dy + 14); g.lineTo(cx - 26, y + dy - 12); g.fill();
      }
    }
  }

  // ramp tread plate with chevrons pointing toward the top of the region (up the slope)
  {
    const [x, y, w, h] = PROP_RECTS.RAMP;
    const grd = g.createLinearGradient(x, y, x + w, y + h);
    grd.addColorStop(0, '#7f8890'); grd.addColorStop(1, '#5d666e');
    g.fillStyle = grd; g.fillRect(x, y, w, h);
    for (let yy = y + 6; yy < y + h; yy += 22) {
      for (let xx = x + 6 + ((yy / 22) % 2) * 11; xx < x + w; xx += 22) {
        g.save(); g.translate(xx, yy); g.rotate(0.6);
        g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(-7, -2, 14, 3);
        g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(-7, 1, 14, 2);
        g.restore();
      }
    }
    g.fillStyle = '#ffcf33';
    for (let cy = y + 70; cy < y + h; cy += 110) {
      g.beginPath();
      g.moveTo(x + 110, cy + 40); g.lineTo(x + w / 2, cy - 20); g.lineTo(x + w - 110, cy + 40);
      g.lineTo(x + w - 110, cy + 74); g.lineTo(x + w / 2, cy + 14); g.lineTo(x + 110, cy + 74);
      g.fill();
    }
    stripes(g, [x, y, 34, h], '#ffcf33', '#25211e', 26);
    stripes(g, [x + w - 34, y, 34, h], '#ffcf33', '#25211e', 26);
  }

  const solid = (rect, top, bottom) => {
    const [x, y, w, h] = rect;
    const grd = g.createLinearGradient(0, y, 0, y + h);
    grd.addColorStop(0, top); grd.addColorStop(1, bottom);
    g.fillStyle = grd; g.fillRect(x, y, w, h);
  };
  solid(PROP_RECTS.METAL, '#9aa3ab', '#7d868e');
  solid(PROP_RECTS.WHITE, '#f6f3ec', '#dcd7cc');
  solid(PROP_RECTS.DARK, '#34302d', '#25211f');
  solid(PROP_RECTS.RED, '#e2533d', '#c53d2c');
  solid(PROP_RECTS.ORANGE, '#ee6a3e', '#d24f2c');
  solid(PROP_RECTS.YELLOW, '#ffd34a', '#f2b81f');
  return c;
}

/* ---------- small sprites ---------- */

export function softDotCanvas(color = '255,255,255') {
  const S = 128, c = makeCanvas(S, S), g = c.getContext('2d');
  const grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grd.addColorStop(0, `rgba(${color},1)`);
  grd.addColorStop(0.45, `rgba(${color},0.55)`);
  grd.addColorStop(1, `rgba(${color},0)`);
  g.fillStyle = grd;
  g.fillRect(0, 0, S, S);
  return c;
}

export function blobShadowCanvas() {
  const S = 128, c = makeCanvas(S, S), g = c.getContext('2d');
  const grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grd.addColorStop(0, 'rgba(40,24,12,0.75)');
  grd.addColorStop(0.55, 'rgba(40,24,12,0.4)');
  grd.addColorStop(1, 'rgba(40,24,12,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, S, S);
  return c;
}

export function starCanvas() {
  const S = 128, c = makeCanvas(S, S), g = c.getContext('2d'), m = S / 2;
  const glow = g.createRadialGradient(m, m, 0, m, m, m);
  glow.addColorStop(0, 'rgba(255,255,255,0.9)');
  glow.addColorStop(0.25, 'rgba(255,255,255,0.25)');
  glow.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, S, S);
  g.fillStyle = '#fff';
  g.beginPath();
  g.moveTo(m, 4);
  g.quadraticCurveTo(m + 6, m - 6, S - 4, m);
  g.quadraticCurveTo(m + 6, m + 6, m, S - 4);
  g.quadraticCurveTo(m - 6, m + 6, 4, m);
  g.quadraticCurveTo(m - 6, m - 6, m, 4);
  g.fill();
  return c;
}

export function bubbleCanvas() {
  const S = 256, c = makeCanvas(S, S), g = c.getContext('2d'), m = S / 2;
  const grd = g.createRadialGradient(m, m, m * 0.55, m, m, m);
  grd.addColorStop(0, 'rgba(140,220,255,0)');
  grd.addColorStop(0.75, 'rgba(140,220,255,0.35)');
  grd.addColorStop(0.92, 'rgba(210,245,255,0.9)');
  grd.addColorStop(1, 'rgba(210,245,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, S, S);
  g.strokeStyle = 'rgba(255,255,255,0.85)';
  g.lineWidth = 9;
  g.lineCap = 'round';
  g.beginPath(); g.arc(m, m, m * 0.72, Math.PI * 1.1, Math.PI * 1.45); g.stroke();
  g.lineWidth = 6;
  g.beginPath(); g.arc(m, m, m * 0.72, Math.PI * 1.55, Math.PI * 1.62); g.stroke();
  return c;
}

export function cloudCanvas(seed) {
  const W = 512, H = 256, c = makeCanvas(W, H), g = c.getContext('2d'), r = rng(seed);
  const puffs = [];
  const n = 6 + ((r() * 4) | 0);
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const rad = 46 + Math.sin(t * Math.PI) * 60 + r() * 24;
    puffs.push([70 + t * (W - 140), H * 0.68 - rad * 0.55 - r() * 20, rad]);
  }
  g.save();
  g.beginPath();
  g.rect(0, 0, W, H * 0.74);
  g.clip();
  g.filter = 'blur(1.5px)';
  g.fillStyle = '#c9dcef';
  for (const [x, y, rad] of puffs) { g.beginPath(); g.arc(x, y + 8, rad, 0, Math.PI * 2); g.fill(); }
  g.fillStyle = '#ffffff';
  for (const [x, y, rad] of puffs) { g.beginPath(); g.arc(x - 4, y - 4, rad * 0.94, 0, Math.PI * 2); g.fill(); }
  g.fillStyle = 'rgba(255,248,236,0.9)';
  for (const [x, y, rad] of puffs) { g.beginPath(); g.arc(x - rad * 0.25, y - rad * 0.3, rad * 0.5, 0, Math.PI * 2); g.fill(); }
  g.restore();
  return c;
}

/* ---------- fallback facades if generated art is missing ---------- */

export function fallbackFacadeCanvas(i) {
  const cols = ['#b5523b', '#e8d3a8', '#3f8f8c', '#c4643a'];
  const W = 256, H = 600, c = makeCanvas(W, H), g = c.getContext('2d');
  g.fillStyle = cols[i % cols.length];
  g.fillRect(0, 0, W, H);
  for (let fy = 0; fy < 4; fy++) {
    for (let fx = 0; fx < 3; fx++) glass(g, 30 + fx * 72, 60 + fy * 130, 50, 80, 6);
  }
  return c;
}
