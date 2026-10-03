import * as THREE from 'three';
import { makeTexture } from './assets.js';
import { makeCanvas } from './textures.js';

/**
 * Distance markers on the track: a checkered finish stripe across all three lanes plus a floating label,
 * e.g. your best distance ("最佳紀錄") or a friend's challenge distance. They live in the world group
 * (local z = -metres) and only show while they are within reach ahead or just behind the hero.
 */
const TONES = {
  best: { fill: '#ffd23f', text: '#3b1d0e', a: '#ffd23f', b: '#fff5df' },
  friend: { fill: '#8d66ff', text: '#ffffff', a: '#b79bff', b: '#fff5df' },
};

/** Rounded-rect path (CanvasRenderingContext2D.roundRect is missing on older Safari). */
function rr(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function labelCanvas(top, bottom, tone) {
  const c = makeCanvas(512, 168), g = c.getContext('2d'), t = TONES[tone];
  g.fillStyle = '#3b1d0e';
  rr(g, 6, 10, 500, 148, 44); g.fill();
  g.fillStyle = t.fill;
  rr(g, 14, 6, 484, 138, 38); g.fill();
  g.lineWidth = 8; g.strokeStyle = '#3b1d0e'; g.stroke();
  g.textAlign = 'center';
  g.fillStyle = t.text;
  g.font = '900 46px "Noto Sans TC", "Microsoft JhengHei", sans-serif';
  g.fillText(top, 256, 64, 450);
  g.font = '52px "Lilita One", "Noto Sans TC", sans-serif';
  g.fillText(bottom, 256, 122, 450);
  return c;
}

function stripeCanvas(tone) {
  const c = makeCanvas(256, 32), g = c.getContext('2d'), t = TONES[tone];
  for (let i = 0; i < 16; i++) for (let j = 0; j < 2; j++) {
    g.fillStyle = (i + j) % 2 ? t.a : t.b;
    g.fillRect(i * 16, j * 16, 16, 16);
  }
  return c;
}

export class DistanceMarkers {
  constructor(parent) {
    this.parent = parent;
    this.items = [];
    this.stripeGeo = new THREE.PlaneGeometry(8.6, 0.7);
  }

  /** list: [{ dist, top, bottom, tone: 'best' | 'friend' }] — rebuilt at the start of every run. */
  set(list) {
    this.clear();
    for (const m of list) {
      if (!(m.dist > 30)) continue;
      const group = new THREE.Group();
      const stripeTex = makeTexture(stripeCanvas(m.tone));
      const stripe = new THREE.Mesh(this.stripeGeo, new THREE.MeshBasicMaterial({ map: stripeTex, transparent: true, opacity: 0.92, depthWrite: false }));
      stripe.rotation.x = -Math.PI / 2;
      stripe.position.y = 0.05;
      stripe.renderOrder = 2;
      const labelTex = makeTexture(labelCanvas(m.top, m.bottom, m.tone));
      const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTex, transparent: true, depthWrite: false }));
      label.scale.set(4.4, 1.44, 1);
      label.position.set(m.tone === 'friend' ? -2.6 : 2.6, 5.4, 0);
      label.renderOrder = 6;
      group.add(stripe, label);
      group.position.z = -m.dist;
      group.visible = false;
      this.parent.add(group);
      this.items.push({ ...m, group, passed: false, textures: [stripeTex, labelTex] });
    }
  }

  /** Show markers near the hero; returns the markers passed this frame. */
  update(dist) {
    let passed = null;
    for (const m of this.items) {
      const ahead = m.dist - dist;
      m.group.visible = ahead < 240 && ahead > -14;
      if (!m.passed && ahead <= 0) {
        m.passed = true;
        (passed ||= []).push(m);
      }
    }
    return passed;
  }

  clear() {
    for (const m of this.items) {
      this.parent.remove(m.group);
      for (const o of m.group.children) o.material.dispose();
      for (const t of m.textures) t.dispose();
    }
    this.items = [];
  }
}
