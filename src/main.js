import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import * as C from './config.js';
import { loadImages, setAniso } from './assets.js';
import { World } from './world.js';
import { buildSharedMaterials, Coins, blinkLights } from './objects.js';
import { Spawner } from './spawner.js';
import { Player } from './player.js';
import { FX, FX_COLORS } from './fx.js';
import { AudioFX, store } from './audio.js';
import { UI, POWER_META } from './ui.js';

/* ---------- renderer & post ---------- */

const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.02;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
setAniso(Math.min(8, renderer.capabilities.getMaxAnisotropy()));

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(58, 1, 0.1, 1800);
const worldRoot = new THREE.Group();
scene.add(worldRoot);

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.45;

const FinalShader = {
  uniforms: {
    tDiffuse: { value: null }, uTime: { value: 0 }, uSpeed: { value: 0 }, uFlash: { value: 0 },
    uFlashColor: { value: new THREE.Color(1, 1, 1) }, uAspect: { value: 1 }, uVignette: { value: 0.3 },
  },
  vertexShader: /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float uTime, uSpeed, uFlash, uAspect, uVignette; uniform vec3 uFlashColor;
    varying vec2 vUv;
    float hash(float n) { return fract(sin(n) * 43758.5453); }
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 p = vUv - 0.5; p.x *= uAspect;
      float r = length(p);
      if (uSpeed > 0.001) {
        float a = atan(p.y, p.x);
        float seg = floor(a * 40.0);
        float h = hash(seg + floor(uTime * 16.0) * 7.13);
        float streak = step(0.8, h) * smoothstep(0.36, 0.8, r) * (0.55 + 0.45 * hash(seg * 3.7));
        c.rgb = mix(c.rgb, vec3(1.0), streak * uSpeed * 0.45);
      }
      c.rgb *= 1.0 - uVignette * smoothstep(0.42, 1.05, r);
      c.rgb = mix(c.rgb, uFlashColor, uFlash);
      gl_FragColor = c;
    }`,
};

const rt = new THREE.WebGLRenderTarget(256, 256, { type: THREE.HalfFloatType, samples: 4 });
const composer = new EffectComposer(renderer, rt);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.5, 1.05);
composer.addPass(bloom);
composer.addPass(new OutputPass());
const finalPass = new ShaderPass(FinalShader);
composer.addPass(finalPass);

/* ---------- game state ---------- */

const G = {
  state: 'loading', dist: 0, speed: C.BASE_SPEED, score: 0, coins: 0, time: 0, timeScale: 1,
  power: { magnet: 0, sneakers: 0, x2: 0, shield: false },
  best: store.get('best', 0), bank: store.get('bank', 0),
  deathT: 0, flash: 0, camBlend: 1, dustT: 0, sparkT: 0,
};
let world, coins, spawner, player, fx;
const audio = new AudioFX();
const ui = new UI({
  play: () => startRun(),
  pause: () => pause(),
  resume: () => resume(),
  menu: () => toMenu(),
  toggleSound: () => { audio.unlock(); audio.setMuted(!audio.muted); ui.setMuted(audio.muted); audio.play('ui_click', { vol: 0.6 }); },
});
ui.setMuted(audio.muted);
ui.stats(G.best, G.bank);

const multiplier = () => Math.min(10, 1 + Math.floor(G.dist / 650));

/* ---------- camera rig ---------- */

const rig = { x: 0, y: 4.6, fov: 58, roll: 0, trauma: 0 };
const look = new THREE.Vector3();
const lookMenu = new THREE.Vector3();
const posMenu = new THREE.Vector3();
const posGame = new THREE.Vector3();

function portraitFov(aspect, dist) {
  return THREE.MathUtils.radToDeg(2 * Math.atan((3.7 / dist) / aspect));
}

function updateCamera(dt, raw) {
  const aspect = camera.aspect, portrait = aspect < 1;
  const camZ = portrait ? 8.2 : 7.0;
  const baseY = portrait ? 4.8 : 4.25;
  const px = player.x, g = player.ground, air = Math.max(0, player.y - g);
  rig.x = C.damp(rig.x, px * 0.8, 6.5, dt);
  rig.y = C.damp(rig.y, Math.min(7.6, baseY + g * 0.8 + air * 0.28), 5, dt);
  rig.trauma = Math.max(0, rig.trauma - raw * 1.5);
  const t = performance.now() / 1000, sh = rig.trauma * rig.trauma;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0.3 : 1;
  const sx = sh * 0.55 * reduce * (Math.sin(t * 41) + Math.sin(t * 23.7 + 1.3)) * 0.5;
  const sy = sh * 0.45 * reduce * (Math.sin(t * 37 + 2) + Math.sin(t * 29.1)) * 0.5;
  posGame.set(rig.x + sx, rig.y + sy, camZ);
  look.set(px * 0.55, 1.25 + g * 0.85 + air * 0.2, -14);

  const mt = t * 0.22;
  posMenu.set(Math.sin(mt) * 1.6, 5.4, 10.5);
  lookMenu.set(Math.sin(mt) * 0.4, 1.7, -14);
  const b = G.camBlend;
  const e = b * b * (3 - 2 * b);
  camera.position.lerpVectors(posMenu, posGame, e);
  const lk = lookMenu.clone().lerp(look, e);
  camera.lookAt(lk);
  rig.roll = C.damp(rig.roll, (px - rig.x) * -0.03, 6, dt);
  camera.rotateZ(rig.roll * e);

  const base = portrait ? Math.min(78, Math.max(62, portraitFov(aspect, camZ))) : 58;
  const air2 = !player.onGround && G.power.sneakers > 0 ? 7 : 0;
  const target = base + (G.state === 'play' ? (G.speed - C.BASE_SPEED) * 0.45 + air2 : 0);
  rig.fov = C.damp(rig.fov, target, 3, dt);
  if (Math.abs(camera.fov - rig.fov) > 0.01) { camera.fov = rig.fov; camera.updateProjectionMatrix(); }
}

/* ---------- sizing & adaptive quality ---------- */

const quality = { level: 0, acc: 0, n: 0 };
function dprCap() { return [2, 1.5, 1.15, 1][quality.level]; }

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  if (w < 2 || h < 2) return;
  const dpr = Math.min(window.devicePixelRatio || 1, dprCap());
  renderer.setPixelRatio(dpr);
  renderer.setSize(w, h, false);
  composer.setPixelRatio(dpr);
  composer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  finalPass.uniforms.uAspect.value = w / h;
  if (fx) fx.setScale((h * dpr) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))));
}
window.addEventListener('resize', resize);

function adapt(raw) {
  if (G.state !== 'play') return;
  quality.acc += raw;
  if (++quality.n < 120) return;
  const avg = quality.acc / quality.n;
  quality.acc = 0;
  quality.n = 0;
  if (avg > 1 / 45 && quality.level < 3) {
    quality.level++;
    if (quality.level >= 2) bloom.enabled = false;
    if (quality.level >= 3) world.sun.shadow.mapSize.set(1024, 1024);
    resize();
  }
}

/* ---------- flow ---------- */

function flash(color, amount) {
  finalPass.uniforms.uFlashColor.value.set(color);
  G.flash = Math.max(G.flash, amount);
}

function startRun() {
  audio.unlock();
  audio.play('go', { vol: 0.7 });
  audio.music('game');
  Object.assign(G, { state: 'play', dist: 0, score: 0, coins: 0, time: 0, timeScale: 1, deathT: 0, speed: C.BASE_SPEED });
  G.power = { magnet: 0, sneakers: 0, x2: 0, shield: false };
  G.camBlend = 0;
  worldRoot.position.z = 0;
  spawner.reset(true);
  player.reset();
  fx.clear();
  world.reset(0);
  ui.last.mult = -1;
  ui.show('hud');
  ui.toast('衝啊！', null);
}

function pause() {
  if (G.state !== 'play') return;
  G.state = 'pause';
  ui.show('pause');
  if (audio.ctx) audio.ctx.suspend();
  setTimeout(() => document.getElementById('btn-resume').focus({ preventScroll: true }), 30);
}

function resume() {
  if (G.state !== 'pause') return;
  G.state = 'play';
  ui.show('hud');
  if (audio.ctx) audio.ctx.resume();
}

function toMenu() {
  if (audio.ctx && audio.ctx.state === 'suspended') audio.ctx.resume();
  audio.play('ui_click', { vol: 0.6 });
  audio.music('menu');
  G.state = 'menu';
  G.camBlend = 0;
  G.timeScale = 1;
  spawner.reset(false);
  player.reset();
  fx.clear();
  ui.stats(G.best, G.bank);
  ui.show('menu');
  setTimeout(() => document.getElementById('btn-play').focus({ preventScroll: true }), 30);
}

function grantPower(type) {
  if (type === 'shield') G.power.shield = true;
  else G.power[type] = C.POWER_TIME[type];
  audio.play('powerup', { vol: 0.8 });
  ui.toast(`${POWER_META[type].label}！`, POWER_META[type].icon);
  const col = { magnet: FX_COLORS.red, sneakers: FX_COLORS.green, x2: FX_COLORS.yellow, shield: FX_COLORS.blue }[type];
  fx.burst(player.x, player.y + 1, -G.dist, col, 34, 8);
  flash({ magnet: '#ffb3a8', sneakers: '#c8ffb0', x2: '#fff0a0', shield: '#c9f1ff' }[type], 0.28);
}

function crash(o) {
  if (G.power.shield) {
    G.power.shield = false;
    spawner.smash(o);
    player.invuln = 1.4;
    audio.play('shield_break', { vol: 0.9 });
    fx.burst(player.x, player.y + 1.2, -G.dist - 0.5, FX_COLORS.blue, 40, 10);
    rig.trauma = Math.max(rig.trauma, 0.55);
    flash('#c9f1ff', 0.4);
    ui.toast('護盾擋下了！', POWER_META.shield.icon);
    return;
  }
  player.crashed = true;
  G.state = 'dying';
  G.deathT = 0;
  G.timeScale = 0.3;
  audio.play('crash', { vol: 1 });
  audio.music('off');
  rig.trauma = 1;
  flash('#ffffff', 0.55);
  fx.crash(player.x, player.y, -G.dist - 0.6);
}

function gameOver() {
  const score = Math.floor(G.score);
  const newBest = score > G.best;
  if (newBest) G.best = score;
  G.bank += G.coins;
  store.set('best', G.best);
  store.set('bank', G.bank);
  G.state = 'over';
  ui.gameOver({ score, coins: G.coins, dist: Math.floor(G.dist), best: G.best, newBest });
  audio.play(newBest ? 'newbest' : 'gameover', { vol: 0.8 });
}

/* ---------- per-frame ---------- */

function handlePlayerEvents(ev) {
  for (const e of ev) {
    switch (e.type) {
      case 'lane': audio.play('lane_switch', { vol: 0.35, rate: C.rand(0.95, 1.08) }); break;
      case 'jump':
        audio.play('jump', { vol: 0.55, rate: e.sneakers ? 0.85 : 1 });
        if (e.sneakers) fx.burst(player.x, player.y + 0.1, -G.dist, FX_COLORS.green, 16, 5);
        break;
      case 'roll': audio.play('roll', { vol: 0.5 }); break;
      case 'land':
        if (e.hard || e.onTrain) { audio.play('land', { vol: 0.55 }); fx.land(player.x, player.y, -G.dist); }
        if (e.hard) rig.trauma = Math.max(rig.trauma, 0.22);
        break;
      case 'stumble':
        audio.play('stumble', { vol: 0.8 });
        rig.trauma = Math.max(rig.trauma, 0.45);
        flash('#ff8a6a', 0.22);
        ui.toast('小心！', null, 'warn');
        break;
      case 'crash': crash(e.obstacle); break;
      default: break;
    }
  }
}

function emitAmbient(dt) {
  G.dustT -= dt;
  if (player.onGround && !player.crashed && G.dustT <= 0) {
    G.dustT = player.rollT > 0 ? 0.025 : 0.055;
    fx.dust(player.x, player.y, -G.dist + 0.3, player.rollT > 0 ? 1.25 : 0.85);
  }
  G.sparkT -= dt;
  if (G.sparkT <= 0) {
    G.sparkT = 0.05;
    if (G.power.magnet > 0) fx.trail(player.x + C.rand(-0.8, 0.8), player.y + C.rand(0.3, 1.8), -G.dist, FX_COLORS.red);
    if (G.power.sneakers > 0 && !player.onGround) fx.trail(player.x, player.y, -G.dist + 0.2, FX_COLORS.green);
    if (G.power.x2 > 0) fx.trail(player.x + C.rand(-0.5, 0.5), player.y + 2.1, -G.dist, FX_COLORS.yellow);
  }
}

function updatePowerups(dt) {
  for (const p of [...spawner.powerups]) {
    p.t += dt;
    p.obj.group.position.y = p.y + Math.sin(p.t * 3) * 0.18;
    p.obj.icon.material.rotation = Math.sin(p.t * 2.2) * 0.18;
    const s = 1 + Math.sin(p.t * 5) * 0.05;
    p.obj.glow.scale.set(2.6 * s, 2.6 * s, 1);
    if (G.state === 'play' && Math.abs(p.s - G.dist) < 1.1 && Math.abs(p.x - player.x) < 1.15
      && Math.abs(p.y - (player.y + 0.9)) < 1.7) {
      grantPower(p.type);
      spawner.removePower(p);
    }
  }
}

function stepWorld(dt, speed) {
  G.dist += speed * dt;
  worldRoot.position.z = G.dist;
  const sev = spawner.update(dt, G.dist);
  for (const e of sev) {
    if (e === 'horn') audio.play('train_horn', { vol: 0.5 });
    else if (e === 'pass') audio.play('train_pass', { vol: 0.45 });
  }
}

function updatePlay(dt) {
  G.time += dt;
  G.speed = C.BASE_SPEED + (C.MAX_SPEED - C.BASE_SPEED) * (1 - Math.exp(-G.dist / 2600));
  stepWorld(dt, G.speed);
  handlePlayerEvents(player.update(dt, { dist: G.dist, speed: G.speed, spawner, power: G.power }));
  if (G.state !== 'play') return;

  const got = coins.update(dt, G.time, G.dist, player.x, player.y, G.power.magnet > 0);
  for (const c of got) {
    G.coins++;
    G.score += 25 * multiplier() * (G.power.x2 > 0 ? 2 : 1);
    fx.coin(c.x, c.y, -c.s);
    audio.coin();
  }
  if (got.length) ui.coinPop();
  updatePowerups(dt);

  for (const k of ['magnet', 'sneakers', 'x2']) {
    if (G.power[k] > 0) {
      G.power[k] = Math.max(0, G.power[k] - dt);
      if (G.power[k] === 0) audio.play('ui_click', { vol: 0.4, rate: 0.8 });
    }
  }
  G.score += G.speed * dt * 0.5 * multiplier() * (G.power.x2 > 0 ? 2 : 1);
  emitAmbient(dt);
  ui.hud(Math.floor(G.score), G.coins, multiplier(), G.power.x2 > 0);
  ui.powers(G.power, C.POWER_TIME);
  G.camBlend = Math.min(1, G.camBlend + dt / 0.9);
}

function updateMenu(dt) {
  G.time += dt;
  stepWorld(dt, 9);
  player.update(dt, { dist: G.dist, speed: 9, spawner, power: G.power });
  coins.update(dt, G.time, G.dist, 99, 0, false);
  emitAmbient(dt);
  G.camBlend = Math.max(0, G.camBlend - dt / 0.6);
}

function updateDying(dt, raw) {
  G.deathT += raw;
  G.timeScale = Math.min(1, 0.3 + G.deathT * 0.9);
  player.update(dt, { dist: G.dist, speed: 0, spawner, power: G.power });
  coins.update(dt, G.time, G.dist, 99, 0, false);
  if (G.deathT > 1.25) gameOver();
}

let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const raw = Math.min(0.05, (now - last) / 1000);
  last = now;
  adapt(raw);
  const dt = raw * G.timeScale;
  if (G.state === 'play') updatePlay(dt);
  else if (G.state === 'menu') updateMenu(dt);
  else if (G.state === 'dying') updateDying(dt, raw);

  if (G.state !== 'pause') {
    blinkLights(now / 1000);
    fx.update(dt);
    world.update(dt, G.dist, camera);
    updateCamera(dt, raw);
    player.faceCamera(camera);
  }
  G.flash = Math.max(0, G.flash - raw * 2.2);
  const u = finalPass.uniforms;
  u.uFlash.value = G.flash;
  u.uTime.value = now / 1000;
  const fast = G.state === 'play' ? C.clamp((G.speed - 25) / 8, 0, 1) * 0.6 : 0;
  const boost = G.state === 'play' && G.power.sneakers > 0 && !player.onGround ? 0.7 : 0;
  u.uSpeed.value = C.damp(u.uSpeed.value, Math.max(fast, boost), 6, raw);
  if (canvas.width > 1 && canvas.height > 1) composer.render();
}

/* ---------- input ---------- */

const KEYS = {
  ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
  ArrowUp: 'jump', KeyW: 'jump', Space: 'jump', ArrowDown: 'roll', KeyS: 'roll',
};
window.addEventListener('keydown', (e) => {
  if (G.state === 'play') {
    const a = KEYS[e.code];
    if (a) { e.preventDefault(); if (!e.repeat) player.input(a); }
    else if (e.code === 'Escape' || e.code === 'KeyP') pause();
  } else if (G.state === 'pause' && (e.code === 'Escape' || e.code === 'KeyP')) {
    resume();
  } else if (G.state === 'menu' && (e.code === 'Enter' || e.code === 'Space') && document.activeElement?.tagName !== 'BUTTON') {
    e.preventDefault();
    startRun();
  }
});

let swipe = null;
const touchLayer = document.getElementById('touch');
touchLayer.addEventListener('pointerdown', (e) => {
  if (G.state !== 'play') return;
  swipe = { x: e.clientX, y: e.clientY, id: e.pointerId, done: false };
});
window.addEventListener('pointermove', (e) => {
  if (!swipe || swipe.done || e.pointerId !== swipe.id) return;
  const dx = e.clientX - swipe.x, dy = e.clientY - swipe.y;
  const th = Math.max(22, Math.min(window.innerWidth, window.innerHeight) * 0.045);
  if (Math.hypot(dx, dy) < th) return;
  swipe.done = true;
  player.input(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'roll' : 'jump'));
});
window.addEventListener('pointerup', () => { swipe = null; });
window.addEventListener('pointercancel', () => { swipe = null; });
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
window.addEventListener('blur', () => pause());

/* ---------- boot ---------- */

async function boot() {
  ui.show('loading');
  audio.preload();
  try { await Promise.race([document.fonts.load('40px "Lilita One"'), new Promise((r) => setTimeout(r, 2500))]); } catch { /* fonts optional */ }
  await loadImages((p) => ui.loading(p * 0.85));
  const mats = buildSharedMaterials();
  world = new World(scene, worldRoot);
  coins = new Coins(worldRoot);
  spawner = new Spawner(worldRoot, mats, coins);
  player = new Player(scene);
  fx = new FX(worldRoot);
  resize();

  // Warm the pools and shader programs so the first obstacles don't hitch.
  spawner.reset(true);
  spawner.update(0, 900);
  worldRoot.position.z = 900;
  updateCamera(0.016, 0.016);
  renderer.compile(scene, camera);
  composer.render();
  spawner.reset(false);
  worldRoot.position.z = 0;
  world.reset(0);
  ui.loading(1);

  G.state = 'menu';
  G.camBlend = 0;
  ui.show('menu');
  requestAnimationFrame(frame);
  const firstGesture = () => {
    if (audio.unlocked) return;
    audio.unlock();
    audio.music(G.state === 'play' ? 'game' : 'menu');
    document.getElementById('hint-sound').hidden = true;
  };
  window.addEventListener('pointerdown', firstGesture, true);
  window.addEventListener('keydown', firstGesture, true);
}

boot();
