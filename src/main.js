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
import { buildSharedMaterials, Coins, Drone, blinkLights } from './objects.js';
import { Spawner } from './spawner.js';
import { Player } from './player.js';
import { FX, FX_COLORS } from './fx.js';
import { AudioFX, store } from './audio.js';
import { UI, POWER_META, RUSH_ICON } from './ui.js';
import { TRICK, TRICK_BIT, TRICK_ALL, TRICK_LABEL } from './tricks.js';

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
    uDanger: { value: 0 },
  },
  vertexShader: /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float uTime, uSpeed, uFlash, uAspect, uVignette; uniform vec3 uFlashColor;
    uniform float uDanger;
    varying vec2 vUv;
    float hash(float n) { return fract(sin(n) * 43758.5453); }
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 p = vUv - 0.5; p.x *= uAspect;
      float r = length(p);
      if (uSpeed > 0.001) {
        // cheap 5-tap radial (zoom) blur toward the centre, only toward the screen edges
        float k = uSpeed * 0.006 * smoothstep(0.25, 0.9, r);
        if (k > 0.00005) {
          vec2 st = (vUv - 0.5) * k;
          c += texture2D(tDiffuse, vUv - st) + texture2D(tDiffuse, vUv - st * 2.0)
             + texture2D(tDiffuse, vUv - st * 3.0) + texture2D(tDiffuse, vUv - st * 4.0);
          c *= 0.2;
        }
        float a = atan(p.y, p.x);
        float seg = floor(a * 40.0);
        float h = hash(seg + floor(uTime * 16.0) * 7.13);
        float streak = step(0.8, h) * smoothstep(0.36, 0.8, r) * (0.55 + 0.45 * hash(seg * 3.7));
        c.rgb = mix(c.rgb, vec3(1.0), streak * uSpeed * 0.45);
      }
      c.rgb *= 1.0 - uVignette * smoothstep(0.42, 1.05, r);
      // oncoming-train warning: pulsing red edge glow (uDanger already carries the pulse, see updateDanger);
      // the uv-space radius keeps the side edges lit on portrait screens too
      float rd = max(r, length(vUv - 0.5) * 1.41421);
      c.rgb = mix(c.rgb, vec3(1.0, 0.13, 0.08), 0.45 * smoothstep(0.45, 1.0, rd) * uDanger);
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
  power: { magnet: 0, sneakers: 0, x2: 0, shield: false, jetpack: 0 },
  best: store.get('best', 0), bank: store.get('bank', 0),
  deathT: 0, flash: 0, camBlend: 1, dustT: 0, sparkT: 0,
  rush: 0, fever: 0, combo: 0, comboT: 0, slowmo: 0, smashPopT: 0,
};
let world, coins, spawner, player, fx, drone;
const feverFrame = document.getElementById('fever-frame');
const FLAME_A = new THREE.Color(1.3, 0.75, 0.2);
const FLAME_B = new THREE.Color(1.1, 0.35, 0.12);
const RAINBOW = ['#ff6b6b', '#ffd23f', '#6bf0a0', '#6bb4ff'].map((c) => new THREE.Color(c).multiplyScalar(1.2));
const fmtN = (n) => Math.round(n).toLocaleString('en-US');
const audio = new AudioFX();
const ui = new UI({
  play: () => startRun(),
  pause: () => pause(),
  resume: () => resume(),
  menu: () => toMenu(),
  toggleSound: () => { audio.unlock(); audio.setMuted(!audio.muted); ui.setMuted(audio.muted); audio.play('ui_click', { vol: 0.6 }); },
  rush: () => triggerRush(),
});
ui.setMuted(audio.muted);
ui.stats(G.best, G.bank);

const multiplier = () => Math.min(10, 1 + Math.floor(G.dist / 650));
const totalMult = () => multiplier() * (G.power.x2 > 0 ? 2 : 1) * (G.fever > 0 ? 3 : 1);

/* ---------- camera rig ---------- */

const rig = { x: 0, y: 4.6, fov: 58, roll: 0, trauma: 0, jet: 0, dip: 0, dipV: 0, kick: 0 };
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
  // lead into a lane change: aim a little past the hero toward the lane they're heading for
  rig.x = C.damp(rig.x, px * 0.8 + (C.laneX(player.lane) - px) * 0.3, 9, dt);
  // Jetpack: lift the whole rig up into the sky lane.
  const jetOn = G.power.jetpack > 0 || (!player.onGround && player.y > 7.5);
  rig.jet = C.damp(rig.jet, jetOn ? 1 : 0, 2.2, dt);
  const yNormal = Math.min(7.6, baseY + g * 0.8 + air * 0.28);
  rig.y = C.damp(rig.y, yNormal + (C.JET_Y + 2.9 - yNormal) * rig.jet, 5, dt);
  rig.trauma = Math.max(0, rig.trauma - raw * 1.5);
  const t = performance.now() / 1000, sh = rig.trauma * rig.trauma;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0.3 : 1;
  const sx = sh * 0.55 * reduce * (Math.sin(t * 41) + Math.sin(t * 23.7 + 1.3)) * 0.5;
  const sy = sh * 0.45 * reduce * (Math.sin(t * 37 + 2) + Math.sin(t * 29.1)) * 0.5;
  // landing dip: a damped spring pulls the camera back up after landImpact() knocks it down
  rig.dipV += (-200 * rig.dip - 18 * rig.dipV) * dt;
  rig.dip += rig.dipV * dt;
  posGame.set(rig.x + sx, rig.y + sy + rig.dip, camZ);
  const lookNormal = 1.25 + g * 0.85 + air * 0.2;
  look.set(px * 0.55, lookNormal + (C.JET_Y - 0.8 - lookNormal) * rig.jet + rig.dip * 0.5, -14);

  const mt = t * 0.22;
  posMenu.set(Math.sin(mt) * 1.6, 5.4, 10.5);
  lookMenu.set(Math.sin(mt) * 0.4, 1.7, -14);
  const b = G.camBlend;
  const e = b * b * (3 - 2 * b);
  camera.position.lerpVectors(posMenu, posGame, e);
  const lk = lookMenu.clone().lerp(look, e);
  camera.lookAt(lk);
  rig.roll = C.damp(rig.roll, C.clamp((px - rig.x) * -0.055, -0.07, 0.07) * reduce, 6, dt);
  camera.rotateZ(rig.roll * e);

  const base = portrait ? Math.min(78, Math.max(62, portraitFov(aspect, camZ))) : 58;
  const air2 = !player.onGround && G.power.sneakers > 0 ? 7 : 0;
  const target = base + (G.state === 'play' ? (G.speed - C.BASE_SPEED) * 0.55 + air2 + (G.fever > 0 ? 9 : 0) + rig.jet * 4 : 0);
  rig.fov = C.damp(rig.fov, target, 3, dt);
  rig.kick = C.damp(rig.kick, 0, 10, dt); // lane-change FOV punch, added on top of the smoothed FOV
  const fov = rig.fov + rig.kick;
  if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
}

/* ---------- game feel: hit-stop, landing tiers, oncoming-train warning, speed layers ---------- */

G.hitStop = 0;   // seconds of near-frozen sim left (see frame())
G.danger = 0;    // smoothed oncoming-train threat 0..1
G.streakT = 0;   // speed-streak spawn accumulator
const reduceMQ = matchMedia('(prefers-reduced-motion: reduce)');
const motionScale = () => (reduceMQ.matches ? 0.3 : 1);
const STREAK = new THREE.Color(0.85, 0.92, 1.1);
const warnEl = document.getElementById('train-warn');
const warnV = new THREE.Vector3();
const warn = { x: -1 };

/** Freeze the sim for `d` seconds (dt x0.02); camera shake and flashes keep running on raw time. */
function hitStop(d) { G.hitStop = Math.max(G.hitStop, d); }

/** Run speed 0 (base) .. 1 (max; frenzy overdrive clamps). */
function speedNorm() { return C.clamp((runSpeed() - C.BASE_SPEED) / (C.MAX_SPEED - C.BASE_SPEED), 0, 1); }

/** Stereo position of a lane relative to the hero. */
function lanePan(lane) { return C.clamp((lane - player.lane) * 0.7, -1, 1); }

/** Lane switch: a quick FOV punch on top of the smoothed FOV. */
function laneKick() { rig.kick = Math.min(3, rig.kick + 1.8 * motionScale()); }

/** Landing impact tiers from the player's 'land' event (k 0..1). */
function landImpact(e) {
  const k = e.k || 0;
  if (e.hard || e.onTrain) { audio.play('land', { vol: 0.2 + 0.5 * k }); fx.land(player.x, player.y, -G.dist, 8 + 16 * k); }
  if (e.hard) rig.trauma = Math.max(rig.trauma, 0.22);
  if (k > 0) { rig.dip = Math.min(rig.dip, -0.35 * k * motionScale()); rig.dipV = 0; }
  if (k >= 0.9) { hitStop(0.03); rig.trauma = Math.max(rig.trauma, 0.3); }
}

/** Stationary sparks along the walls far ahead; the run carries the camera past them, so speed reads from frame one. */
function emitSpeedStreaks(dt) {
  if (G.state !== 'play') return;
  G.streakT += dt * (25 + 70 * speedNorm());
  for (; G.streakT >= 1; G.streakT -= 1) {
    const side = Math.random() < 0.5 ? -1 : 1;
    fx.add.emit(side * C.rand(3.5, 6), C.rand(0.5, 5), -G.dist - 40, 0, 0, 0, C.rand(1.8, 2.2), 0.25, 0.25, STREAK, 0.55, 0, 0);
  }
}

/** Oncoming trains in the hero's lane: headlight swell, red screen-edge pulse and a warning chevron over the lane. */
function updateDanger(raw, t) {
  const live = G.state === 'play' && G.power.jetpack <= 0;
  let danger = 0, threat = null;
  for (const o of spawner.obstacles) {
    if (o.type !== 'train' || !o.moving) continue;
    const ahead = o.s0 - G.dist;
    const d = live && o.lane === player.lane && ahead > 0 ? C.clamp(1 - ahead / 70, 0, 1) : 0;
    o.obj.setDanger(d, t);
    if (d > danger) { danger = d; threat = o; }
  }
  G.danger = C.damp(G.danger, danger, danger > G.danger ? 30 : 9, raw);
  // ~2.9 Hz pulse (sin(t*18)), kept shallow and below the 3-flashes/s photosensitivity line
  const pulse = reduceMQ.matches ? 0.8 : 0.775 + 0.225 * Math.sin(t * 18);
  finalPass.uniforms.uDanger.value = G.danger * pulse;
  if (!warnEl) return;
  if (threat) {
    // worldRoot is shifted by +dist, so the train front sits at world z = dist - s0
    camera.updateMatrixWorld();
    warnV.set(threat.x, C.TRAIN_TOP, G.dist - threat.s0).project(camera);
    if (warnV.z < 1) warn.x = C.clamp((warnV.x * 0.5 + 0.5) * window.innerWidth, 44, window.innerWidth - 44);
  }
  const op = warn.x < 0 ? 0 : C.clamp((G.danger - 0.02) / 0.2, 0, 1);
  const on = op > 0.01;
  if (warnEl.hidden === on) warnEl.hidden = !on;
  if (!on) return;
  warnEl.style.opacity = op.toFixed(2);
  warnEl.style.transform = `translate3d(${warn.x.toFixed(1)}px, 0, 0) translateX(-50%) scale(${(0.8 + 0.4 * G.danger).toFixed(3)})`;
  warnEl.classList.toggle('hot', G.danger > 0.7);
}

/** Per-frame feel layers that run on raw time: danger warning + speed/slow-mo audio. */
function updateFeel(raw, t) {
  updateDanger(raw, t);
  const slow = G.hitStop > 0 || ((G.state === 'play' || G.state === 'dying') && G.timeScale < 0.99);
  audio.setIntensity(speedNorm(), slow, G.state === 'play');
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
  Object.assign(G, {
    state: 'play', dist: 0, score: 0, coins: 0, time: 0, timeScale: 1, deathT: 0, speed: C.BASE_SPEED,
    rush: 0, fever: 0, combo: 0, comboT: 0, slowmo: 0,
  });
  G.power = { magnet: 0, sneakers: 0, x2: 0, shield: false, jetpack: 0 };
  feverFrame.classList.remove('on');
  audio.setRate(1);
  drone.group.visible = false;
  G.camBlend = 0;
  worldRoot.position.z = 0;
  spawner.reset(true);
  resetSurge();
  player.reset();
  fx.clear();
  world.reset(0);
  ui.last.mult = -1;
  resetTricks();
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
  G.fever = 0;
  G.power.jetpack = 0;
  feverFrame.classList.remove('on');
  drone.group.visible = false;
  spawner.reset(false);
  resetSurge();
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
  const col = { magnet: FX_COLORS.red, sneakers: FX_COLORS.green, x2: FX_COLORS.yellow, shield: FX_COLORS.blue, jetpack: FX_COLORS.yellow }[type];
  fx.burst(player.x, player.y + 1, -G.dist, col, 34, 8);
  flash({ magnet: '#ffb3a8', sneakers: '#c8ffb0', x2: '#fff0a0', shield: '#c9f1ff', jetpack: '#ffd59a' }[type], 0.28);
  if (type === 'jetpack') {
    audio.play('jetpack', { vol: 0.9 });
    spawner.addSkyCoins(G.dist + 16, G.dist + 16 + runSpeed() * (C.POWER_TIME.jetpack - 1.5));
  }
}

function runSpeed() {
  return G.speed * Math.min(C.SPEED_MULT_CAP, (G.fever > 0 ? C.FEVER_SPEED : 1) * (G.surge > 0 ? C.SURGE_SPEED : 1));
}

/* ---------- speed-boost surge ---------- */

function startSurge() {
  G.surge = C.SURGE_TIME;
  audio.play('boing', { vol: 0.75, rate: 1.5 });
  ui.popup('加速！', 'cool');
  flash('#9fe6ff', 0.16);
  rig.trauma = Math.max(rig.trauma, 0.15);
  fx.burst(player.x, 0.4, -G.dist - 1, FX_COLORS.blue, 20, 9);
}

function resetSurge() {
  G.surge = 0;
  G.surgeT = 0;
  G.musicRate = 1;
  audio.setTempo(false);
}

/** Tick the surge and keep the soundtrack's pace in step with surge / frenzy. */
function updateSurge(dt) {
  if (G.surge > 0) {
    G.surge = Math.max(0, G.surge - dt);
    G.surgeT -= dt;
    if (G.surgeT <= 0) {
      G.surgeT = 0.03;
      fx.trail(player.x + C.rand(-0.45, 0.45), player.y + C.rand(0.1, 1.3), -G.dist + 0.3, FX_COLORS.blue);
    }
  }
  const rate = G.fever > 0 ? 1.08 : G.surge > 0 ? 1.05 : 1;
  if (rate !== G.musicRate) {
    G.musicRate = rate;
    audio.setRate(rate);
    audio.setTempo(rate > 1);
  }
}

function addRush(v) {
  if (G.fever > 0 || G.state !== 'play') return;
  G.rush = Math.min(1, G.rush + v);
  if (G.rush >= 1 && !G.rushReady) rushReady();
}

/** The meter is full: wait for the player to fire it (E / Shift / HUD button). */
function rushReady() {
  G.rushReady = true;
  audio.play('powerup', { vol: 0.5, rate: 1.25 });
  if (!G.rushHint) {
    G.rushHint = true;
    ui.toast(ui.touch ? 'RUSH 準備好！點按鈕' : 'RUSH 準備好！按 E', RUSH_ICON);
  }
}

function triggerRush() {
  if (G.state !== 'play' || G.fever > 0 || !G.rushReady) return;
  G.rushReady = false;
  startFever();
}

function startFever() {
  G.fever = C.FEVER_TIME;
  G.power.magnet = Math.max(G.power.magnet, C.FEVER_TIME);
  audio.play('rush', { vol: 1 });
  audio.setRate(1.08);
  ui.toast('TABBY RUSH！', RUSH_ICON);
  flash('#ffe36b', 0.5);
  rig.trauma = Math.max(rig.trauma, 0.45);
  feverFrame.classList.add('on');
  fx.burst(player.x, player.y + 1.2, -G.dist - 1.5, FX_COLORS.yellow, 24, 13);
}

function endFever() {
  G.fever = 0;
  G.rush = 0;
  audio.setRate(1);
  feverFrame.classList.remove('on');
  player.invuln = Math.max(player.invuln, 1.2);
}

/* ---------- tricks & combo chain ("貓步三連") ---------- */

function resetTricks() {
  Object.assign(G, { combo: 0, comboT: 0, chainKinds: 0, chainBonus: false, slowCd: 0, rushReady: false, rushHint: false });
  ui.combo(0, 0, 0);
}

/**
 * Score a trick: kind 'jump' | 'roll' | 'graze'; `perfect` = perfect jump / roll, or a graze for near misses.
 * Feeds the combo chain (window TRICK.window, multiplier capped at TRICK.cap) and the Rush meter.
 */
function awardTrick(kind, perfect = false, label = null) {
  if (G.state !== 'play') return 0;
  if (G.combo === 0 || G.comboT <= 0) endChain(false);
  G.combo++;
  G.comboT = TRICK.window;
  G.chainKinds |= TRICK_BIT[kind] || 0;
  const m = Math.min(G.combo, TRICK.cap);
  const bonus = (perfect ? TRICK.perfectPoints : TRICK.points) * m * totalMult();
  G.score += bonus;
  addRush(!perfect ? TRICK.rush : kind === 'graze' ? TRICK.rushGraze : TRICK.rushPerfect);
  const text = label || (TRICK_LABEL[kind] || TRICK_LABEL.graze)[perfect ? 1 : 0];
  audio.play('nearmiss', { vol: perfect ? 0.85 : 0.45, rate: (perfect ? 1 : 1.15) + m * 0.05 });
  ui.popup(`${text} +${fmtN(bonus)}`, perfect ? 'hot' : 'sun', 1 + 0.1 * m);
  if (perfect) {
    hitStop(0.04);
    flash('#ffffff', 0.12);
    rig.trauma = Math.max(rig.trauma, 0.2);
    if (G.slowCd <= 0) { G.slowmo = TRICK.slowmo; G.slowCd = TRICK.slowmoCooldown; }
  }
  if (G.chainKinds === TRICK_ALL && !G.chainBonus) {
    G.chainBonus = true;
    addRush(TRICK.rushTriple);
    ui.toast('貓步三連！', null, 'hot');
    audio.play('powerup', { vol: 0.6, rate: 1.3 });
    flash('#ffc4e4', 0.22);
    fx.burst(player.x, player.y + 1.2, -G.dist - 1, RAINBOW[0], 26, 10);
  }
  return bonus;
}

/** Legacy hook (debug): a graze-grade near miss. */
function nearMiss(label) { return awardTrick('graze', true, label); }

function endChain(show) {
  if (show && G.combo >= 3) ui.toast(`×${G.combo} 連擊！`, null, G.combo >= 5 ? 'hot' : 'sun');
  Object.assign(G, { combo: 0, comboT: 0, chainKinds: 0, chainBonus: false });
}

function updateCombo(dt) {
  G.slowCd = Math.max(0, G.slowCd - dt);
  if (G.combo > 0) {
    G.comboT = Math.max(0, G.comboT - dt);
    if (G.comboT === 0) endChain(true);
  } else if (G.comboT > 0 || G.chainKinds) endChain(false); // chain broken (stumble)
  ui.combo(G.combo, G.comboT / TRICK.window, G.chainKinds);
}

/** An oncoming train roared past in the next lane; each train instance scores once (see TrickTracker). */
function passNearMiss(lane) {
  let o = null;
  for (const q of spawner.obstacles) {
    if (q.type === 'train' && q.moving && q.passed && q.lane === lane && (!o || q.s0 > o.s0)) o = q;
  }
  if (o) {
    if (o._nm || o._nmPending || o._void) return;
    o._nm = true;
  }
  awardTrick('graze', false, '呼嘯而過！');
}

const coinV = new THREE.Vector3();
/** Launch the HUD coin flight from a collected coin's screen position. */
function flyCoin(c) {
  coinV.set(c.x, c.y, -c.s + G.dist).project(camera);
  if (coinV.z > 1 || Math.abs(coinV.x) > 1.1 || Math.abs(coinV.y) > 1.1) return false;
  return ui.coinFly((coinV.x + 1) * 0.5 * window.innerWidth, (1 - coinV.y) * 0.5 * window.innerHeight);
}

function crash(o) {
  if (G.power.shield) {
    G.power.shield = false;
    spawner.smash(o);
    player.invuln = 1.4;
    audio.play('shield_break', { vol: 0.9 });
    fx.burst(player.x, player.y + 1.2, -G.dist - 0.5, FX_COLORS.blue, 40, 10);
    rig.trauma = Math.max(rig.trauma, 0.55);
    hitStop(0.1);
    flash('#c9f1ff', 0.4);
    ui.toast('護盾擋下了！', POWER_META.shield.icon);
    return;
  }
  player.crashed = true;
  G.state = 'dying';
  G.deathT = 0;
  G.timeScale = 0.3;
  hitStop(0.14);
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
      case 'lane': audio.play('lane_switch', { vol: 0.35, rate: C.rand(0.95, 1.08) }); laneKick(); break;
      case 'jump':
        audio.play('jump', { vol: 0.55, rate: e.sneakers ? 0.85 : 1 });
        if (e.sneakers) fx.burst(player.x, player.y + 0.1, -G.dist, FX_COLORS.green, 16, 5);
        break;
      case 'roll': audio.play('roll', { vol: 0.5 }); break;
      case 'land': landImpact(e); break;
      case 'stumble':
        audio.play('stumble', { vol: 0.8 });
        audio.play('drone', { vol: 0.7 });
        rig.trauma = Math.max(rig.trauma, 0.45);
        flash('#ff8a6a', 0.22);
        ui.toast('被無人機盯上了！', null, 'warn');
        G.combo = 0;
        break;
      case 'crash': crash(e.obstacle); break;
      case 'nearmiss': awardTrick('graze', e.graze); break;
      case 'clearHurdle': awardTrick('jump', e.perfect); break;
      case 'clearOverhead': awardTrick('roll', e.perfect); break;
      case 'pad':
        audio.play('boing', { vol: 0.8 });
        fx.burst(player.x, 0.5, -G.dist, FX_COLORS.yellow, 22, 6);
        rig.trauma = Math.max(rig.trauma, 0.15);
        break;
      case 'boost': startSurge(); break;
      case 'smash': {
        spawner.smash(e.obstacle);
        const bonus = 100 * totalMult();
        G.score += bonus;
        audio.play('smash', { vol: 0.85, rate: C.rand(0.95, 1.1) });
        fx.burst(e.obstacle.x, player.y + 1.4, -G.dist - 2.5, FX_COLORS.yellow, 14, 9);
        rig.trauma = Math.max(rig.trauma, 0.3);
        if (G.smashPopT <= 0) { ui.popup(`粉碎！+${fmtN(bonus)}`, 'hot'); G.smashPopT = 0.35; hitStop(0.05); }
        break;
      }
      default: break;
    }
  }
}

function emitAmbient(dt) {
  emitSpeedStreaks(dt);
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
  if (G.power.jetpack > 0) {
    // twin thruster flames, small so the hero stays readable
    for (const ox of [-0.28, 0.28]) {
      fx.add.emit(player.x + ox, player.y + 0.55, -G.dist + 0.35, C.rand(-0.3, 0.3), C.rand(-7, -5), C.rand(0.5, 1.5),
        C.rand(0.12, 0.2), C.rand(0.3, 0.45), 0.05, Math.random() < 0.5 ? FLAME_A : FLAME_B, 0.85, 0, 2);
    }
  }
  G.feverT = (G.feverT || 0) - dt;
  if (G.fever > 0 && G.feverT <= 0) {
    // rainbow sparks streaming off both sides, never over the hero's body
    G.feverT = 0.035;
    const side = Math.random() < 0.5 ? -1 : 1;
    fx.add.emit(player.x + side * C.rand(0.75, 1.1), player.y + C.rand(0.3, 1.8), -G.dist - 0.3, side * C.rand(0.5, 1.5),
      C.rand(-0.3, 0.6), C.rand(4, 7), C.rand(0.25, 0.4), C.rand(0.3, 0.5), 0.05, RAINBOW[(Math.random() * 4) | 0], 0.75, 0, 1);
  }
}

function updateDrone(dt, t) {
  const on = (G.state === 'play' || G.state === 'dying' || G.state === 'over') && player.stumbleT > 0;
  if (on && !drone.group.visible) { drone.group.visible = true; drone.group.position.set(player.x, player.y + 5, 4); }
  if (!on) { drone.group.visible = false; return; }
  const p = drone.group.position;
  const side = player.x > 0.1 ? -1 : 1;
  p.x = C.damp(p.x, player.x + side * 1.1 + Math.sin(t * 2.3) * 0.3, 5, dt);
  p.y = C.damp(p.y, player.y + 3.1 + Math.sin(t * 4) * 0.15, 4, dt);
  p.z = C.damp(p.z, 0.6, 3, dt);
  drone.group.rotation.set(0.25, Math.sin(t * 1.7) * 0.3, (p.x - player.x) * -0.4);
  drone.update(t);
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
    if (e.type === 'horn') audio.play('train_horn', { vol: 0.5, pan: lanePan(e.lane) });
    else if (e.type === 'pass') {
      audio.play('train_pass', { vol: 0.45, pan: lanePan(e.lane) });
      // an oncoming train screaming past in the next lane counts as a near miss
      if (G.state === 'play' && Math.abs(e.lane - player.lane) === 1 && player.y < C.TRAIN_TOP && G.power.jetpack <= 0) passNearMiss(e.lane);
    }
  }
}

function updatePlay(dt) {
  G.time += dt;
  G.speed = C.BASE_SPEED + (C.MAX_SPEED - C.BASE_SPEED) * (1 - Math.exp(-G.dist / C.SPEED_RAMP));
  const v = runSpeed();
  stepWorld(dt, v);
  handlePlayerEvents(player.update(dt, {
    dist: G.dist, speed: v, spawner, power: G.power, jetpack: G.power.jetpack > 0, invincible: G.fever > 0,
  }));
  if (G.state !== 'play') return;

  const got = coins.update(dt, G.time, G.dist, player.x, player.y, G.power.magnet > 0);
  let flew = false;
  for (const c of got) {
    G.coins++;
    G.score += 25 * totalMult();
    fx.coin(c.x, c.y, -c.s);
    audio.coin();
    addRush(0.011);
    if (flyCoin(c)) flew = true;
  }
  if (got.length && !flew) ui.coinPop();
  updatePowerups(dt);
  updateSurge(dt);

  for (const k of ['magnet', 'sneakers', 'x2', 'jetpack']) {
    if (G.power[k] > 0) {
      G.power[k] = Math.max(0, G.power[k] - dt);
      if (G.power[k] === 0) {
        audio.play('ui_click', { vol: 0.4, rate: 0.8 });
        if (k === 'jetpack') player.invuln = Math.max(player.invuln, 1.5);
      }
    }
  }
  if (G.fever > 0) {
    G.fever = Math.max(0, G.fever - dt);
    G.rush = G.fever / C.FEVER_TIME;
    if (G.fever === 0) endFever();
  }
  updateCombo(dt);
  G.smashPopT -= dt;
  G.score += v * dt * 0.5 * totalMult();
  emitAmbient(dt);
  ui.hud(Math.floor(G.score), G.coins, totalMult(), G.power.x2 > 0 || G.fever > 0);
  ui.powers(G.power, C.POWER_TIME);
  ui.rush(G.rush, G.fever > 0, G.rushReady);
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
  if (G.state === 'play') {
    G.slowmo = Math.max(0, G.slowmo - raw);
    G.timeScale = 1 - 0.55 * Math.min(1, G.slowmo / 0.1); // eases back out over the last 0.1 s
  }
  // hit-stop: near-freeze the sim for a few frames; shake/flash/post keep running on raw time
  const stopped = G.hitStop > 0;
  G.hitStop = Math.max(0, G.hitStop - raw);
  const dt = raw * (stopped ? 0.02 : G.timeScale);
  if (G.state === 'play') updatePlay(dt);
  else if (G.state === 'menu') updateMenu(dt);
  else if (G.state === 'dying') updateDying(dt, stopped ? 0 : raw);

  if (G.state !== 'pause') {
    blinkLights(now / 1000);
    fx.update(dt);
    world.update(dt, G.dist, camera);
    updateCamera(dt, raw);
    player.faceCamera(camera);
    updateDrone(dt, now / 1000);
  }
  G.flash = Math.max(0, G.flash - raw * 2.2);
  updateFeel(raw, now / 1000);
  const u = finalPass.uniforms;
  u.uFlash.value = G.flash;
  u.uTime.value = now / 1000;
  const fast = G.state === 'play' ? 0.15 + 0.55 * C.clamp((G.speed - 20) / 15, 0, 1) : 0;
  const boost = G.state === 'play' && ((G.power.sneakers > 0 && !player.onGround) || G.power.jetpack > 0) ? 0.7 : 0;
  const frenzy = G.state === 'play' && G.fever > 0 ? 1 : 0;
  const surge = G.state === 'play' && G.surge > 0 ? 0.8 : 0;
  u.uSpeed.value = C.damp(u.uSpeed.value, Math.max(fast, boost, frenzy, surge), 6, raw);
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
    else if (e.code === 'KeyE' || e.code === 'ShiftLeft' || e.code === 'ShiftRight') { e.preventDefault(); if (!e.repeat) triggerRush(); }
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
  // Art and music download together; the bar shows both (art 40%, music 60%).
  let artP = 0, musicP = 0;
  const show = () => ui.loading(Math.min(0.99, artP * 0.4 + musicP * 0.6));
  audio.onProgress = (p) => { musicP = p; show(); };
  audio.preload();
  const fonts = Promise.race([document.fonts.load('40px "Lilita One"'), new Promise((r) => setTimeout(r, 1500))]).catch(() => {});
  await Promise.all([fonts, loadImages((p) => { artP = p; show(); }), audio.ready]);
  const mats = buildSharedMaterials();
  world = new World(scene, worldRoot);
  coins = new Coins(worldRoot);
  spawner = new Spawner(worldRoot, mats, coins);
  player = new Player(scene);
  fx = new FX(worldRoot);
  drone = new Drone(mats);
  scene.add(drone.group);
  resize();

  // Warm the pools and shader programs so the first obstacles don't hitch.
  spawner.reset(true);
  spawner.update(0, 300);
  worldRoot.position.z = 300;
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
  if (location.hash === '#debug') window.__tabby = { G, player, spawner, startRun, grantPower, addRush, nearMiss, awardTrick, triggerRush, startSurge };
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
