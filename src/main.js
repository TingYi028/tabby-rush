import * as THREE from 'three';

document.documentElement.lang ||= 'zh-Hant'; // also inside hosts that wrap the page in their own <html>
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
import * as progression from './progression.js';
import { DAILY, DailyUI, dailyToday, dailyStatus, mulberry32, rowHook, completeDaily, recordDaily, dayKey } from './daily.js';
import { REVIVE, ReviveOverlay, reviveCost, clearForRevive } from './revive.js';
import { THEMES, ZONE, themeIndexAt } from './themes.js';
import { TUNNEL, resetDirector, nextTunnel } from './director.js';
import { settings, FXP, vibrate } from './settings.js';
import { SettingsUI } from './settings-ui.js';
import { HelpUI } from './help-ui.js';
import { NameUI } from './name-ui.js';
import { recordLocal, submitRemote, initRemote, flushPending, playerName, seedLocal, remote } from './leaderboard.js';
import { BoardUI } from './board-ui.js';
import { parseChallenge, shareChallenge, gameUrl } from './challenge.js';
import { scoreCard } from './scorecard.js';
import { DistanceMarkers } from './marker.js';

/* ---------- renderer & post ---------- */

const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.02;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
setAniso(Math.min(8, renderer.capabilities.getMaxAnisotropy()));

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(58, 1, 0.3, 1800); // near 0.3: 3x the depth precision (no z-fighting far out)
const worldRoot = new THREE.Group();
scene.add(worldRoot);

// The environment map is a render-target texture: three doesn't redraw those after a lost GPU context, so it is rebuilt.
let envRT = null;
function buildEnvironment() {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  envRT?.dispose();
  envRT = pmrem.fromScene(room, 0.04);
  scene.environment = envRT.texture;
  room.dispose?.();
  pmrem.dispose();
}
buildEnvironment();
scene.environmentIntensity = 0.45;

const FinalShader = {
  uniforms: {
    tDiffuse: { value: null }, uTime: { value: 0 }, uSpeed: { value: 0 }, uFlash: { value: 0 },
    uFlashColor: { value: new THREE.Color(1, 1, 1) }, uAspect: { value: 1 }, uVignette: { value: 0.3 },
    uDanger: { value: 0 }, uStreak: { value: 0.45 }, uStreakRate: { value: 16 },
  },
  vertexShader: /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float uTime, uSpeed, uFlash, uAspect, uVignette; uniform vec3 uFlashColor;
    uniform float uDanger, uStreak, uStreakRate;
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
        float h = hash(seg + floor(uTime * uStreakRate) * 7.13);
        float streak = step(0.8, h) * smoothstep(0.36, 0.8, r) * (0.55 + 0.45 * hash(seg * 3.7));
        c.rgb = mix(c.rgb, vec3(1.0), streak * uSpeed * uStreak);
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
// RenderPass and the bloom composite use renderTarget2 (the clone); OutputPass writes renderTarget1, which needs no MSAA
composer.renderTarget1.samples = 0;
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
let world, coins, spawner, player, fx, drone, markers;
const feverFrame = document.getElementById('fever-frame');
const FLAME_A = new THREE.Color(1.3, 0.75, 0.2);
const FLAME_B = new THREE.Color(1.1, 0.35, 0.12);
const RAINBOW = ['#ff6b6b', '#ffd23f', '#6bf0a0', '#6bb4ff'].map((c) => new THREE.Color(c).multiplyScalar(1.2));
const fmtN = (n) => Math.round(n).toLocaleString('en-US');
// While the lost-GPU notice is up no key reaches the game or the cards behind it (their handlers listen in the
// capture phase too, so this one is registered before them); the notice's own button still works.
window.addEventListener('keydown', (e) => { if (!document.getElementById('gl-lost').hidden) e.stopImmediatePropagation(); }, true);
const audio = new AudioFX();
const ui = new UI({
  play: () => play(),
  retry: () => startRun(!!G.daily),
  pause: () => pause(),
  resume: () => resume(),
  menu: () => toMenu(),
  toggleSound: () => { audio.unlock(); audio.setMuted(!audio.muted); ui.setMuted(audio.muted); audio.play('ui_click', { vol: 0.6 }); },
  rush: () => triggerRush(),
});
ui.setMuted(audio.muted);
progression.init(G, { ui, audio }); // save v1 (migrates best/bank), shop + missions UI
new SettingsUI(ui, { click: () => audio.play('ui_click', { vol: 0.6 }) });
new HelpUI(ui, { click: () => audio.play('ui_click', { vol: 0.6 }) });
const nameUI = new NameUI(ui, { click: () => audio.play('ui_click', { vol: 0.6 }) });
/** Menu starts (開始衝刺 / 每日挑戰 / Enter): the first one asks for a leaderboard name. */
function play(daily = false) {
  if (nameUI.needed()) nameUI.open(() => startRun(daily));
  else startRun(daily);
}
audio.setVolumes(settings.get('music'), settings.get('sfx'));
initRemote().then(() => { if (G.state === 'menu') showChallenge(); }); // before BoardUI, which waits on it to show the world tab
seedLocal(G.best, progression.bestDist());
const boardUI = new BoardUI(ui, { click: () => audio.play('ui_click', { vol: 0.6 }) });
settings.onChange((k) => {
  if (k === 'music' || k === 'sfx') audio.setVolumes(settings.get('music'), settings.get('sfx'));
  if ((k === 'fx' || k === 'calm') && world) { applyLook(); idleFrames = 0; }
});
ui.stats(G.best, G.bank);

const multiplier = () => Math.min(10, 1 + Math.floor(G.dist / 650)) + progression.multBonus();
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
  const reduce = reduceMQ.matches ? 0.3 : 1, shake = FXP.shake;
  const sx = sh * 0.55 * shake * (Math.sin(t * 41) + Math.sin(t * 23.7 + 1.3)) * 0.5;
  const sy = sh * 0.45 * shake * (Math.sin(t * 37 + 2) + Math.sin(t * 29.1)) * 0.5;
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
  camera.lookAt(lookMenu.lerp(look, e)); // lookMenu is rebuilt every frame, so lerping it in place is safe
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
const motionScale = () => (reduceMQ.matches || FXP.shake === 0 ? 0.3 : 1);
const STREAK = new THREE.Color(0.85, 0.92, 1.1);
const JET_X = [-0.28, 0.28];
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
  G.streakT += dt * (25 + 70 * speedNorm()) * FXP.particles;
  for (; G.streakT >= 1; G.streakT -= 1) {
    const side = Math.random() < 0.5 ? -1 : 1;
    const life = Math.min(C.rand(1.8, 2.2), 36 / Math.max(10, runSpeed()));
    fx.add.emit(side * C.rand(3.5, 6), C.rand(0.5, 5), -G.dist - 40, 0, 0, 0, life, 0.25, 0.25, STREAK, 0.55, 0, 0);
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
  const pulse = 0.8 + (0.225 * Math.sin(t * 18) - 0.025) * FXP.pulse;
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

/*
 * Adaptive quality ladder, cheapest loss first: 0 full | 1 no MSAA | 2 no bloom, DPR <= 1.25 | 3 DPR <= 1
 * | 4 DPR 0.9, 512 shadow map. Steps that change nothing on this screen are skipped. Two slow windows (avg
 * frame > 22 ms) step down; six fast ones (< 17 ms) step back up, unless that level already proved too slow.
 * The level is remembered per device, so a weak PC doesn't stutter through the ladder every session.
 */
const QUALITY = [
  { samples: 4, bloom: true, dpr: 1.5, shadow: 1024 },
  { samples: 0, bloom: true, dpr: 1.5, shadow: 1024 },
  { samples: 0, bloom: false, dpr: 1.25, shadow: 1024 },
  { samples: 0, bloom: false, dpr: 1, shadow: 1024 },
  { samples: 0, bloom: false, dpr: 0.9, shadow: 512 },
];
const weakDevice = (navigator.deviceMemory && navigator.deviceMemory <= 4) || (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4);
const quality = { level: Math.min(QUALITY.length - 1, Math.max(0, store.get('quality', weakDevice ? 1 : 0) | 0)), acc: 0, n: 0, slow: 0, fast: 0, floor: 0 };
function dprCap() { return QUALITY[quality.level].dpr; }

/** Apply quality.level: MSAA, bloom, shadow-map size and pixel ratio. */
function applyQuality() {
  const q = QUALITY[quality.level], rt2 = composer.renderTarget2;
  if (rt2.samples !== q.samples) { rt2.dispose(); rt2.samples = q.samples; }
  bloom.enabled = q.bloom;
  if (world && world.sun.shadow.mapSize.x !== q.shadow) {
    world.sun.shadow.mapSize.set(q.shadow, q.shadow);
    world.sun.shadow.map?.dispose();
    world.sun.shadow.map = null;
  }
  resize();
}

/** Next level in direction d that actually changes something on this screen. */
function nextLevel(d) {
  const native = window.devicePixelRatio || 1;
  const eff = (l) => { const q = QUALITY[l]; return `${q.samples}|${q.bloom}|${Math.min(native, q.dpr)}|${q.shadow}`; };
  let l = quality.level + d;
  while (l > 0 && l < QUALITY.length - 1 && eff(l) === eff(quality.level)) l += d;
  return Math.max(quality.floor, Math.min(QUALITY.length - 1, l));
}

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  if (w < 2 || h < 2) return;
  idleFrames = 0; // repaint a still screen after a resize
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
  if (G.state !== 'play') { quality.acc = quality.sq = quality.n = 0; return; }
  quality.acc += raw;
  quality.sq = (quality.sq || 0) + raw * raw;
  if (++quality.n < 120) return;
  const avg = quality.acc / quality.n;
  const sd = Math.sqrt(Math.max(0, quality.sq / quality.n - avg * avg));
  quality.acc = quality.sq = 0;
  quality.n = 0;
  // A steady ~33 ms is either a 30 Hz cap (low-power mode, battery saver) or a GPU just missing 60: the cheap big wins
  // (MSAA, bloom) still go, but it never drags the picture down to the blurry, blocky bottom of the ladder.
  const capped30 = Math.abs(avg - 1 / 30) < 0.003 && sd < 0.004;
  quality.slow = avg > 1 / 45 && (!capped30 || quality.level < 2) ? quality.slow + 1 : 0;
  quality.fast = avg < 1 / 58 ? quality.fast + 1 : 0;
  let to = quality.level;
  if (quality.slow >= 2 && quality.level < QUALITY.length - 1) to = nextLevel(1);
  else if (quality.fast >= 6 && quality.level > quality.floor) to = nextLevel(-1);
  if (to === quality.level) return;
  // stepping back down to a level that was just too slow pins it as the floor for this session
  if (to > quality.level && quality.raised) quality.floor = to;
  quality.raised = to < quality.level;
  quality.level = to;
  quality.slow = quality.fast = 0;
  store.set('quality', to);
  applyQuality();
}

/* ---------- flow ---------- */

let lastFlash = -1e9;
/** Screen flash, scaled by the effects setting; a flash within 0.35 s of the last one is damped (no strobing). */
function flash(color, amount) {
  const now = performance.now();
  let a = Math.min(FXP.cap, amount * FXP.flash);
  if (now - lastFlash < 350) a *= 0.4;
  if (a < 0.02) return;
  lastFlash = now;
  if (a >= G.flash) finalPass.uniforms.uFlashColor.value.setStyle(color, THREE.LinearSRGBColorSpace);
  G.flash = Math.max(G.flash, a);
}

/** `daily`: today's seeded challenge track with its weekday modifier instead of a random one. */
function startRun(daily = false) {
  audio.unlock();
  audio.play('go', { vol: 0.7 });
  audio.music('game');
  Object.assign(G, {
    state: 'play', dist: 0, score: 0, coins: 0, time: 0, timeScale: 1, deathT: 0, speed: C.BASE_SPEED,
    rush: 0, fever: 0, combo: 0, comboT: 0, slowmo: 0,
  });
  G.power = { magnet: 0, sneakers: 0, x2: 0, shield: false, jetpack: 0 };
  progression.startRun(G); // run counters + start-with-shield upgrade
  feverFrame.classList.remove('on');
  audio.setRate(1);
  drone.group.visible = false;
  G.camBlend = 0;
  worldRoot.position.z = 0;
  setupRunMode(daily);
  // the tunnel schedule shapes the track, so it must come from the same seed as the generator (daily runs)
  spawner.seeded(() => { resetZones(); spawner.reset(true); });
  resetSurge();
  player.reset();
  fx.clear();
  world.reset(0);
  ui.last.mult = -1;
  resetTricks();
  ui.show('hud');
  ui.toast('衝啊！', null);
  dailyKickoff();
  setupMarkers();
  tutorial.on = progression.runsPlayed() < 3 && !G.daily;
  tutorial.seen = 0;
  hideHint();
}

/* ---------- first-run hints: the first hurdle / sign / train in the hero's lane gets a swipe hint + a beat of slow-mo ---------- */

const tutorial = { on: false, seen: 0, shown: null, t: 0 };
const HINTS = {
  jump: { bit: 1, dir: 'up', touch: '往上滑　跳過柵欄！', keys: '按 <kbd>↑</kbd> 跳過柵欄！' },
  roll: { bit: 2, dir: 'down', touch: '往下滑　鑽過看板！', keys: '按 <kbd>↓</kbd> 翻滾鑽過！' },
  lane: { bit: 4, dir: 'side', touch: '左右滑　換軌道！', keys: '按 <kbd>←</kbd><kbd>→</kbd> 換軌道！' },
};

function showHint(kind) {
  const h = HINTS[kind], el = $('tut-hint');
  tutorial.seen |= h.bit;
  tutorial.shown = kind;
  tutorial.t = 1.6;
  el.dataset.dir = h.dir;
  el.querySelector('span').innerHTML = ui.touch ? h.touch : h.keys; // fixed strings only
  el.hidden = false;
  G.slowmo = Math.max(G.slowmo, 0.45); // a short beat of slow motion to read it
}

function hideHint(kind) {
  if (kind && tutorial.shown !== kind) return;
  tutorial.shown = null;
  $('tut-hint').hidden = true;
}

function updateTutorial(dt) {
  if (tutorial.shown) {
    tutorial.t -= dt;
    if (tutorial.t <= 0) hideHint();
    return;
  }
  if (tutorial.seen === 7 || G.power.jetpack > 0 || G.fever > 0 || player.y > 1) return; // RUSH smashes through anyway
  const v = Math.max(1, runSpeed());
  for (const o of spawner.obstacles) {
    if (o.lane !== player.lane || (o.y0 || 0) > player.y + 0.5) continue;
    const tt = (o.s0 - G.dist) / (v + (o.moving ? Math.max(0, o.speed) : 0));
    const kind = o.type === 'hurdle' ? 'jump' : o.type === 'overhead' ? 'roll' : o.type === 'train' ? 'lane' : null;
    if (!kind || (tutorial.seen & HINTS[kind].bit) || tt < 0.45 || tt > (kind === 'lane' ? 1.5 : 1.1)) continue;
    // a train with a ramp in front of it can be run over: not a lane-change lesson
    if (kind === 'lane' && spawner.obstacles.some((q) => q.type === 'ramp' && q.lane === o.lane && Math.abs(q.s0 + q.len - o.s0) < 0.3)) continue;
    showHint(kind);
    return;
  }
}

/* ---------- best-distance / friend-challenge markers, leaderboard + challenge results ---------- */

G.vs = parseChallenge(); // a friend's challenge link: { score, dist, name }
const $ = (id) => document.getElementById(id);

function setupMarkers() {
  G.vsBeat = false;
  const best = progression.bestDist();
  const list = [];
  if (best > 60) list.push({ dist: best, top: '最佳紀錄', bottom: `${fmtN(best)} m`, tone: 'best' });
  if (G.vs && !G.daily && G.vs.dist > 60) list.push({ dist: G.vs.dist, top: G.vs.name, bottom: `${fmtN(G.vs.dist)} m`, tone: 'friend' });
  markers.set(list);
}

function updateMarkers() {
  const passed = markers.update(G.dist);
  if (passed) {
    for (const m of passed) {
      if (m.tone === 'best') { ui.toast('突破最佳距離！', null, 'hot'); audio.play('newbest', { vol: 0.5 }); }
      else { ui.toast(`追過 ${m.top}！`, null, 'cool'); audio.play('powerup', { vol: 0.6, rate: 1.2 }); }
      flash('#fff0a0', 0.2);
    }
  }
  if (G.vs && !G.daily && !G.vsBeat && G.score > G.vs.score) {
    G.vsBeat = true;
    ui.popup(`分數超越 ${G.vs.name}！`, 'hot', 1.2);
    audio.play('newbest', { vol: 0.45, rate: 1.1 });
  }
}

function showChallenge() {
  $('vs-banner').hidden = !G.vs;
  // one-time "what's new" chip (hidden while a friend's challenge banner is up); it names the world board only once
  // that is really on, and comes back once for players who saw it before the world board went live
  $('news-text').textContent = remote.on ? '全球排行榜・挑戰朋友・特效設定' : '排行榜・挑戰朋友・特效設定';
  $('news-chip').hidden = !!G.vs || newsSeen();
  if (!G.vs) return;
  $('vs-name').textContent = G.vs.name;
  $('vs-score').textContent = fmtN(G.vs.score);
}
const NEWS_ID = '2026-10-04';
const NEWS_ALL = `${NEWS_ID}+world`;
let newsDismissed = false; // this session (the world board may turn on right after a tap on a slow network)
const newsSeen = () => { const v = store.get('news', ''); return newsDismissed || v === NEWS_ALL || (v === NEWS_ID && !remote.on); };
window.addEventListener('hashchange', () => {
  const vs = parseChallenge();
  if (!vs) return;
  G.vs = vs;
  if (G.state === 'menu') showChallenge();
});
$('news-chip').addEventListener('click', () => {
  newsDismissed = true;
  store.set('news', remote.on ? NEWS_ALL : NEWS_ID);
  $('news-chip').hidden = true;
  boardUI.open('menu');
});
$('vs-close').addEventListener('click', () => {
  audio.play('ui_click', { vol: 0.6 });
  G.vs = null;
  showChallenge();
  if (location.hash.startsWith('#vs=')) history.replaceState(null, '', location.pathname + location.search);
});

/** Game-over: local rank now, world rank when the server answers; the friend-challenge result row. */
function boardOver(score) {
  const run = { score, dist: Math.floor(G.dist), coins: G.coins, secs: G.time, day: G.daily ? G.daily.day : 0 };
  G.lastRun = run;
  // the share image is drawn now; a tap only uses it once it is ready (waiting would spend the tap's activation)
  G.card = null;
  if (ui.touch) scoreCard({ score, dist: run.dist, name: playerName(), host: gameUrl() }).then((f) => { if (G.lastRun === run) G.card = f; }, () => {});
  const rank = recordLocal(run), el = $('go-rank');
  const where = run.day ? '今日挑戰' : '我的紀錄';
  el.textContent = rank ? `${where}第 ${rank} 名${rank === 1 ? '！' : ''}` : '';
  el.hidden = !rank;
  submitRemote(run).then((r) => {
    if (!r || G.lastRun !== run || G.state !== 'over') return;
    const wk = !run.day && r.week ? r.week.rank : 0;
    const top = (n) => (n <= 10 ? '！' : '');
    const parts = run.day ? [r.rank && `今日挑戰全球第 ${fmtN(r.rank)} 名${top(r.rank)}`]
      : [wk && `本週全球第 ${fmtN(wk)} 名${top(wk)}`, r.rank && (wk ? `總榜第 ${fmtN(r.rank)} 名` : `全球排行第 ${fmtN(r.rank)} 名${top(r.rank)}`)];
    const text = parts.filter(Boolean).join('・');
    if (!text) return;
    el.textContent = text;
    el.hidden = false;
  });
  const row = $('go-vs-row');
  row.hidden = !G.vs || !!G.daily;
  if (!row.hidden) {
    const win = score > G.vs.score, res = $('go-vs-result');
    $('go-vs-label').textContent = `挑戰 ${G.vs.name}`;
    res.textContent = win ? '勝利！' : `差 ${fmtN(G.vs.score - score)} 分`;
    res.className = win ? 'win' : 'lose';
  }
}

$('btn-share').addEventListener('click', async (e) => {
  const btn = e.currentTarget, run = G.lastRun;
  audio.play('ui_click', { vol: 0.6 });
  if (!run || btn.dataset.busy) return;
  btn.dataset.busy = '1';
  const info = { score: run.score, dist: run.dist, name: playerName() };
  // phones share the score card image along with the link when it is ready; share() must run in the tap's activation
  const res = await shareChallenge(info, G.card);
  const label = btn.lastChild;
  if (res === 'copied' || res === 'failed') {
    label.textContent = res === 'copied' ? '已複製連結！' : '請截圖分享';
    clearTimeout(btn.labelT);
    btn.labelT = setTimeout(() => { label.textContent = '挑戰朋友'; }, 2000);
  }
  delete btn.dataset.busy;
});

function pause() {
  if (G.state !== 'play') return;
  G.state = 'pause';
  swipes.clear();
  progression.pause();
  ui.show('pause');
  if (audio.ctx) audio.ctx.suspend();
  setTimeout(() => document.getElementById('btn-resume').focus({ preventScroll: true }), 30);
}

function resume() {
  if (G.state !== 'pause' || glLost) return;
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
  G.power = { magnet: 0, sneakers: 0, x2: 0, shield: false, jetpack: 0 };
  Object.assign(G, { rush: 0, rushReady: false, slowmo: 0, hitStop: 0 });
  ui.rush(0, false, false);
  audio.setRate(1);
  feverFrame.classList.remove('on');
  drone.group.visible = false;
  spawner.reset(false);
  resetSurge();
  player.reset();
  fx.clear();
  progression.menu();
  hideHint();
  markers.set([]);
  showChallenge();
  flushPending();
  resetZones();
  ui.stats(G.best, G.bank);
  dailyUI.refresh();
  ui.show('menu');
  setTimeout(() => document.getElementById('btn-play').focus({ preventScroll: true }), 30);
}

function grantPower(type) {
  if (type === 'shield') G.power.shield = true;
  else G.power[type] = progression.powerTime(type);
  progression.track('power', type);
  audio.play('powerup', { vol: 0.8 });
  vibrate(15);
  ui.toast(`${POWER_META[type].label}！`, POWER_META[type].icon);
  const col = { magnet: FX_COLORS.red, sneakers: FX_COLORS.green, x2: FX_COLORS.yellow, shield: FX_COLORS.blue, jetpack: FX_COLORS.yellow }[type];
  fx.burst(player.x, player.y + 1, -G.dist, col, 34, 8);
  flash({ magnet: '#ffb3a8', sneakers: '#c8ffb0', x2: '#fff0a0', shield: '#c9f1ff', jetpack: '#ffd59a' }[type], 0.28);
  if (type === 'jetpack') {
    audio.play('jetpack', { vol: 0.9 });
    spawner.addSkyCoins(G.dist + 16, G.dist + 16 + runSpeed() * (progression.powerTime('jetpack') - 1.5));
  }
}

function runSpeed() {
  return G.speed * Math.min(C.SPEED_MULT_CAP, (G.fever > 0 ? C.FEVER_SPEED : 1) * (G.surge > 0 ? C.SURGE_SPEED : 1));
}

/* ---------- speed-boost surge ---------- */

function startSurge() {
  G.surge = C.SURGE_TIME;
  progression.track('boost');
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
  if (G.mod === 'rush2') v *= 2;
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
  progression.track('rush');
  audio.play('rush', { vol: 1 });
  vibrate([20, 25, 45]);
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

/* ---------- zone themes (every ZONE.len m) & dark tunnels ---------- */

const zone = { idx: 0, from: 0, t: 1, tunnel: -1, phase: 0 };

/** Back to 午後 with no tunnel and a fresh tunnel schedule (new run / menu). */
function resetZones() {
  Object.assign(zone, { idx: 0, from: 0, t: 1, tunnel: -1, phase: 0 });
  resetDirector();
  world.setTheme(0, 0, 1);
  world.setTunnel(-1);
}

/** Zone cross-fades and tunnel entry / exit by the hero's distance (the generator reads the same schedule by track s). */
function updateZones(dt) {
  if (G.state === 'menu') return;
  const z = themeIndexAt(G.dist);
  if (z !== zone.idx) {
    zone.from = zone.idx;
    zone.idx = z;
    zone.t = 0;
    if (G.state === 'play') ui.toast(THEMES[z].toast, null, THEMES[z].tone);
  }
  if (zone.t < 1) {
    zone.t = Math.min(1, zone.t + dt / ZONE.fade);
    world.setTheme(zone.from, zone.idx, zone.t);
  }
  const tn = nextTunnel(G.dist, 40);   // keep the shell until the camera is well past the exit
  if (tn !== zone.tunnel) { zone.tunnel = tn; zone.phase = 0; }
  world.setTunnel(tn >= 0 && tn - G.dist < 330 ? tn : -1);
  if (G.state !== 'play' || tn < 0) return;
  if (zone.phase === 0 && G.dist >= tn + 6) {
    zone.phase = 1;
    ui.popup('進入隧道！', 'cool');
  } else if (zone.phase === 1 && G.dist >= tn + TUNNEL.len + 4) {
    // the camera (~7 m behind) reaches daylight: white-out, then the zone light returns
    zone.phase = 2;
    flash('#fffaf0', 0.55);
    ui.popup('重見光明！', 'sun');
  }
}

/** Renderer / post / hero values of the current zone look (set by World). */
function applyLook() {
  const L = world.look;
  renderer.toneMappingExposure = L.exposure;
  bloom.strength = L.bloom * FXP.bloom;
  bloom.threshold = L.bloomThreshold + FXP.bloomBias;
  player.material.color.copy(L.hero);
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
  progression.trick(kind, perfect, G.combo);
  const m = Math.min(G.combo, TRICK.cap);
  const bonus = (perfect ? TRICK.perfectPoints : TRICK.points) * m * totalMult();
  G.score += bonus;
  addRush(!perfect ? TRICK.rush : kind === 'graze' ? TRICK.rushGraze : TRICK.rushPerfect);
  const text = label || (TRICK_LABEL[kind] || TRICK_LABEL.graze)[perfect ? 1 : 0];
  audio.play('nearmiss', { vol: perfect ? 0.85 : 0.45, rate: (perfect ? 1 : 1.15) + m * 0.05 });
  ui.popup(`${text} +${fmtN(bonus)}`, perfect ? 'hot' : 'sun', 1 + 0.1 * m);
  if (perfect) {
    hitStop(0.04);
    vibrate(12);
    flash('#ffffff', 0.12);
    rig.trauma = Math.max(rig.trauma, 0.2);
    if (G.slowCd <= 0) { G.slowmo = TRICK.slowmo; G.slowCd = TRICK.slowmoCooldown; }
  }
  if (G.chainKinds === TRICK_ALL && !G.chainBonus) {
    G.chainBonus = true;
    progression.track('triple');
    ui.toast('貓步三連！', null, 'hot');
    addRush(TRICK.rushTriple); // after the toast, so a "RUSH 準備好！" hint isn't overwritten
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
    vibrate(35);
    fx.burst(player.x, player.y + 1.2, -G.dist - 0.5, FX_COLORS.blue, 40, 10);
    rig.trauma = Math.max(rig.trauma, 0.55);
    hitStop(0.1);
    flash('#c9f1ff', 0.4);
    ui.toast('護盾擋下了！', POWER_META.shield.icon);
    return;
  }
  player.crashed = true;
  hideHint();
  G.state = 'dying';
  G.deathT = 0;
  G.timeScale = 0.3;
  hitStop(0.14);
  audio.play('crash', { vol: 1 });
  vibrate([45, 35, 70]);
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
  progression.endRun(G); // commit missions, save, fill the bank + mission rows on the card
  ui.gameOver({ score, coins: G.coins, dist: Math.floor(G.dist), best: G.best, newBest });
  dailyOver(score);
  boardOver(score);
  audio.play(newBest ? 'newbest' : 'gameover', { vol: 0.8 });
}

/* ---------- daily challenge ("每日挑戰") & coin revive ("花金幣復活") ---------- */

// daily: today's challenge { day, seed, mod, claimed, reward } or null; mod: active modifier id ('' = none);
// revives: revives bought this run (sets the price); reviveT: revive invulnerability left (bubble look)
Object.assign(G, { daily: null, mod: '', revives: 0, reviveT: 0 });
const dailyUI = new DailyUI(() => play(true));
const revive = new ReviveOverlay(ui, {
  accept: () => acceptRevive(),
  decline: () => declineRevive(),
  tick: () => audio.play('ui_click', { vol: 0.5, rate: 1.35 }),
});

/** Per-run setup (before the spawner resets): a daily run seeds the generator and installs its row hook. */
function setupRunMode(daily) {
  G.daily = daily ? { ...dailyToday(), claimed: false, reward: null } : null;
  G.mod = G.daily ? G.daily.mod.id : '';
  G.revives = 0;
  G.reviveT = 0;
  spawner.rng = G.daily ? mulberry32(G.daily.seed) : null;
  spawner.rowHook = rowHook(G.mod);
  spawner.padsOnly = G.mod === 'pads'; // zone barriers / roof bars respect the modifier too
}

/** Start-line effects of today's modifier (the rest are read in place: G.mod in updatePlay/addRush, the row hook). */
function dailyKickoff() {
  if (!G.daily) return;
  const m = G.daily.mod;
  if (m.id === 'magnet') G.power.magnet = DAILY.magnetTime;
  ui.toast(`每日挑戰・${m.name}`, m.id === 'magnet' ? POWER_META.magnet.icon : null, 'hot');
}

/** The first time past DAILY.goal metres today pays the reward (x streak multiplier) straight into the bank. */
function updateDaily() {
  if (!G.daily || G.daily.claimed || G.dist < DAILY.goal) return;
  G.daily.claimed = true;
  const r = completeDaily(G.daily.day);
  if (!r) { ui.popup('今日挑戰完成！', 'cool'); return; }
  G.daily.reward = r;
  G.bank += r.coins;
  progression.saveNow();
  audio.play('powerup', { vol: 0.8, rate: 1.1 });
  ui.toast(`每日挑戰完成！+${fmtN(r.coins)}`, 'assets/ui/icon_coin.webp');
  flash('#fff0a0', 0.25);
}

/** Game-over card: today's best (+ reward / streak) for a daily run; hides those rows otherwise. */
function dailyOver(score) {
  if (!G.daily) { dailyUI.over(null); return; }
  const rec = recordDaily(G.daily.day, score), st = dailyStatus(G.daily.day);
  dailyUI.over({ ...rec, done: st.done, streak: st.streak, reward: G.daily.reward });
}

/** The crash would end the run: offer a coin revive. State 'revive' freezes the world under the overlay. */
function offerRevive() {
  G.state = 'revive';
  revive.open(reviveCost(G.revives), G.bank + G.coins);
}

function updateRevive(raw) {
  if (revive.update(raw)) declineRevive();
}

function acceptRevive() {
  if (G.state !== 'revive' || !spendCoins(reviveCost(G.revives))) return;
  G.revives++;
  clearForRevive(spawner, G.dist, runSpeed(), REVIVE.invuln);
  player.crashed = false;
  player.invuln = REVIVE.invuln;
  player.stumbleT = 0;
  Object.assign(G, { state: 'play', timeScale: 1, deathT: 0, hitStop: 0, slowmo: 0, reviveT: REVIVE.invuln });
  ui.show('hud');
  audio.play('go', { vol: 0.7 });
  audio.music('game');
  flash('#c9f1ff', 0.35);
  fx.burst(player.x, player.y + 1.2, -G.dist - 0.5, FX_COLORS.blue, 34, 9);
  ui.toast('復活！', POWER_META.shield.icon);
}

function declineRevive() {
  if (G.state === 'revive') gameOver();
}

/** Pay `n` coins, from the bank first and then from this run's coins; false if they don't cover it. */
function spendCoins(n) {
  if (G.bank + G.coins < n) return false;
  const fromBank = Math.min(G.bank, n);
  G.bank -= fromBank;
  G.coins -= n - fromBank;
  progression.saveNow();
  return true;
}

/** Revive invulnerability wears a shield bubble that shrinks away at the end (a real shield takes precedence). */
function updateReviveGlow(dt) {
  if (G.reviveT <= 0) return;
  G.reviveT = Math.max(0, G.reviveT - dt);
  if (G.power.shield) return;
  const b = player.bubble, k = Math.min(1, G.reviveT / 0.35), t = performance.now() / 1000;
  b.visible = G.reviveT > 0;
  b.position.set(player.x, player.y + 1.05, 0.15);
  b.scale.set((2.6 + Math.sin(t * 6) * 0.06) * k, (2.6 + Math.cos(t * 5) * 0.06) * k, 1);
}

/* ---------- per-frame ---------- */

function handlePlayerEvents(ev) {
  for (const e of ev) {
    switch (e.type) {
      case 'lane': audio.play('lane_switch', { vol: 0.35, rate: C.rand(0.95, 1.08) }); laneKick(); hideHint('lane'); break;
      case 'jump':
        hideHint('jump');
        audio.play('jump', { vol: 0.55, rate: e.sneakers ? 0.85 : 1 });
        if (e.sneakers) fx.burst(player.x, player.y + 0.1, -G.dist, FX_COLORS.green, 16, 5);
        break;
      case 'roll': audio.play('roll', { vol: 0.5 }); hideHint('roll'); break;
      case 'land': landImpact(e); break;
      case 'stumble':
        audio.play('stumble', { vol: 0.8 });
        audio.play('drone', { vol: 0.7 });
        rig.trauma = Math.max(rig.trauma, 0.45);
        flash('#ff8a6a', 0.22);
        ui.toast('被無人機盯上了！', null, 'warn');
        progression.track('stumble');
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
        progression.track('smash');
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
  G.jetT = (G.jetT || 0) - dt;
  if (G.power.jetpack > 0 && G.jetT <= 0) {
    G.jetT = 1 / 60;
    // twin thruster flames, small so the hero stays readable
    for (const ox of JET_X) {
      fx.add.emit(player.x + ox, player.y + 0.55, -G.dist + 0.35, C.rand(-0.3, 0.3), C.rand(-7, -5), C.rand(0.5, 1.5),
        C.rand(0.12, 0.2), C.rand(0.3, 0.45), 0.05, Math.random() < 0.5 ? FLAME_A : FLAME_B, 0.85, 0, 2);
    }
  }
  G.feverT = (G.feverT || 0) - dt;
  if (G.fever > 0 && G.feverT <= 0) {
    // rainbow sparks streaming off both sides, never over the hero's body
    G.feverT = 0.035 / Math.max(0.3, FXP.particles);
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
  for (let i = spawner.powerups.length - 1; i >= 0; i--) {
    const p = spawner.powerups[i];
    p.t += dt;
    p.obj.group.position.y = p.y + Math.sin(p.t * 3) * 0.18;
    p.obj.icon.material.rotation = Math.sin(p.t * 2.2) * 0.18;
    const s = 1 + Math.sin(p.t * 5) * 0.05;
    p.obj.glow.scale.set(2.6 * s, 2.6 * s, 1);
    if (G.state === 'play' && p.s > G.prevDist - 1.1 && p.s < G.dist + 1.1 && Math.abs(p.x - player.x) < 1.15
      && Math.abs(p.y - (player.y + 0.9)) < 1.7) {
      grantPower(p.type);
      spawner.removePower(p);
    }
  }
}

function stepWorld(dt, speed) {
  G.prevDist = G.dist;
  G.dist += speed * dt;
  worldRoot.position.z = G.dist;
  const sev = spawner.update(dt, G.dist);
  for (const e of sev) {
    if (e.type === 'horn') audio.play('train_horn', { vol: 0.5, pan: lanePan(e.lane) });
    else if (e.type === 'swerve') audio.play('train_horn', { vol: 0.85, rate: 1.18, pan: lanePan(e.lane) }); // lane-switch telegraph
    else if (e.type === 'setpiece' && G.state === 'play') ui.toast('屋頂跑酷！', null, 'hot');
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
  if (G.mod === 'fast') G.speed = Math.max(G.speed, DAILY.fastSpeed);
  const v = runSpeed();
  stepWorld(dt, v);
  handlePlayerEvents(player.update(dt, {
    dist: G.dist, speed: v, spawner, power: G.power, jetpack: G.power.jetpack > 0, invincible: G.fever > 0,
  }));
  if (G.state !== 'play') return;
  updateReviveGlow(dt);
  updateDaily();
  updateMarkers();
  if (tutorial.on) updateTutorial(dt);

  const got = coins.update(dt, G.time, G.dist, player.x, player.y, G.power.magnet > 0, G.prevDist);
  let flew = false;
  for (const c of got) {
    G.coins++;
    if (G.mod === 'coins2') G.coins++;
    G.score += 25 * totalMult();
    fx.coin(c.x, c.y, -c.s);
    audio.coin();
    addRush(0.011);
    if (flyCoin(c)) flew = true;
  }
  if (got.length && !flew) ui.coinPop();
  if (got.length) progression.track('coin', got.length * (G.mod === 'coins2' ? 2 : 1));
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
  progression.frame(G);
  emitAmbient(dt);
  ui.hud(Math.floor(G.score), G.coins, totalMult(), G.power.x2 > 0 || G.fever > 0);
  ui.powers(G.power, progression.powerMax);
  ui.rush(G.rush, G.fever > 0, G.rushReady);
  G.camBlend = Math.min(1, G.camBlend + dt / 0.9);
}

function updateMenu(dt) {
  G.time += dt;
  // the menu may sit open past midnight: refresh today's challenge and the free mission skip
  G.dayT = (G.dayT || 0) + dt;
  if (G.dayT > 2 && document.body.dataset.screen === 'menu') {
    G.dayT = 0;
    const d = dayKey();
    if (G.menuDay && d !== G.menuDay) { dailyUI.refresh(); progression.menu(); }
    G.menuDay = d;
  }
  stepWorld(dt, 9);
  player.update(dt, { dist: G.dist, speed: 9, spawner, power: G.power });
  coins.update(dt, G.time, G.dist, player.x, player.y, false, G.dist, false);
  emitAmbient(dt);
  G.camBlend = Math.max(0, G.camBlend - dt / 0.6);
}

function updateDying(dt, raw) {
  G.deathT += raw;
  G.timeScale = Math.min(1, 0.3 + G.deathT * 0.9);
  player.update(dt, { dist: G.dist, speed: 0, spawner, power: G.power });
  coins.update(dt, G.time, G.dist, player.x, player.y, false, G.dist, false);
  if (G.deathT > REVIVE.delay) offerRevive(); // declining or letting the countdown run out ends the run
}

let last = performance.now();
let idleFrames = 0;

let lastInput = performance.now();
for (const t of ['pointerdown', 'keydown', 'wheel', 'touchstart']) {
  window.addEventListener(t, () => { lastInput = performance.now(); }, { capture: true, passive: true });
}

// Phones may take the GPU back (backgrounded tab, driver reset): pause, say so, and rebuild when it is returned.
// While the notice is up nothing behind it takes input (a key could otherwise resume the frozen run).
let glLost = false, bootFailed = false, focusBeforeLost = null;
const blockBehind = (on) => { for (const el of document.querySelectorAll('#app > *')) if (el.id !== 'gl-lost') el.inert = on; };
canvas.addEventListener('webglcontextlost', (e) => {
  e.preventDefault(); // lets the browser hand the context back
  glLost = true;
  focusBeforeLost = document.activeElement;
  if (G.state === 'play') pause();
  const inRun = G.state === 'pause' || G.state === 'dying' || G.state === 'revive';
  $('gl-lost-note').textContent = inRun ? '重新載入會結束這一局，之前存好的紀錄和金幣都還在。' : '存好的紀錄和金幣都還在。';
  $('gl-lost').hidden = false;
  blockBehind(true);
  setTimeout(() => $('btn-reload').focus({ preventScroll: true }), 60); // after pause() has focused 繼續
});
canvas.addEventListener('webglcontextrestored', () => {
  if (bootFailed) { location.reload(); return; } // lost while loading: start over (the files are cached by now)
  glLost = false;
  $('gl-lost').hidden = true;
  blockBehind(false);
  buildEnvironment();
  applyQuality(); // render targets and the shadow map are rebuilt at the current size
  idleFrames = 0;
  const back = focusBeforeLost;
  focusBeforeLost = null;
  setTimeout(() => {
    const shown = (el) => el && el.isConnected && el !== document.body && !el.disabled && el.getClientRects().length > 0;
    const name = document.body.dataset.screen, screen = $(name);
    const main = { pause: 'btn-resume', over: 'btn-retry', menu: 'btn-play', revive: $('btn-revive').disabled ? 'btn-giveup' : 'btn-revive' }[name];
    const el = shown(back) && screen && screen.contains(back) ? back : main && $(main);
    if (shown(el)) el.focus({ preventScroll: true });
  }, 30);
});
$('btn-reload').addEventListener('click', () => location.reload());

function frame(now) {
  requestAnimationFrame(frame);
  if (glLost) { last = now; return; }
  // The menu backdrop runs at ~30 fps, play at most ~95 fps; still screens (pause, game over, revive, a card over
  // the menu) stop rendering after a few frames.
  // a menu nobody has touched for 40 s idles at ~12 fps (laptops left open stay cool); any input brings it back
  if (now - last < (G.state === 'menu' ? (now - lastInput > 40000 ? 80 : 30) : 8.6)) return;
  if (G.state === 'pause' || G.state === 'over' || G.state === 'revive' || (G.state === 'menu' && OVERLAYS.has(document.body.dataset.screen))) {
    if (++idleFrames > 3 && G.state !== 'revive') { last = now; return; }
  } else idleFrames = 0;
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
  else if (G.state === 'revive') updateRevive(raw);

  if (G.state !== 'pause') {
    blinkLights(now / 1000);
    fx.update(dt);
    updateZones(dt);
    world.update(dt, G.dist, camera, G.state === 'play' ? runSpeed() : G.state === 'menu' ? 9 : 0);
    applyLook();
    updateCamera(dt, raw);
    player.faceCamera(camera);
    // R3: particle sizes follow the live FOV (it widens up to +26 degrees with speed / frenzy / jetpack)
    fx.setScale((window.innerHeight * renderer.getPixelRatio()) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))),
      window.innerHeight * renderer.getPixelRatio());
    updateDrone(dt, now / 1000);
  }
  G.flash = Math.max(0, G.flash - raw * 2.2);
  updateFeel(raw, now / 1000);
  const u = finalPass.uniforms;
  u.uFlash.value = G.flash;
  u.uTime.value = (now / 1000) % 600;
  u.uStreak.value = FXP.streak;
  u.uStreakRate.value = FXP.streakRate;
  const fast = G.state === 'play' ? 0.15 + 0.55 * C.clamp((G.speed - 20) / 15, 0, 1) : 0;
  const boost = G.state === 'play' && ((G.power.sneakers > 0 && !player.onGround) || G.power.jetpack > 0) ? 0.7 : 0;
  const frenzy = G.state === 'play' && G.fever > 0 ? 1 : 0;
  const surge = G.state === 'play' && G.surge > 0 ? 0.8 : 0;
  u.uSpeed.value = C.damp(u.uSpeed.value, Math.max(fast, boost, frenzy, surge), 6, raw);
  if (canvas.width > 1 && canvas.height > 1 && idleFrames <= 3) composer.render();
}

/* ---------- input ---------- */

const KEYS = {
  ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
  ArrowUp: 'jump', KeyW: 'jump', Space: 'jump', ArrowDown: 'roll', KeyS: 'roll',
};
const OVERLAYS = new Set(['settings', 'board', 'shop', 'help', 'name']);
window.addEventListener('keydown', (e) => {
  if (glLost || OVERLAYS.has(document.body.dataset.screen)) return; // their own handlers take the keys
  if (G.state === 'play') {
    const a = KEYS[e.code];
    if (a) { e.preventDefault(); if (!e.repeat) player.input(a); }
    else if (e.code === 'KeyE' || e.code === 'ShiftLeft' || e.code === 'ShiftRight') { e.preventDefault(); if (!e.repeat) triggerRush(); }
    else if (e.code === 'Escape' || e.code === 'KeyP') pause();
  } else if (G.state === 'pause' && (e.code === 'Escape' || e.code === 'KeyP')) {
    resume();
  } else if (G.state === 'revive') {
    revive.key(e);
  } else if (G.state === 'menu' && (e.code === 'Enter' || e.code === 'Space') && document.activeElement?.tagName !== 'BUTTON') {
    e.preventDefault();
    play();
  }
});

const swipes = new Map(); // pointerId -> { x, y, done, onRush }: one per finger
const touchLayer = document.getElementById('touch');
const startSwipe = (e, onRush = false) => {
  if (G.state !== 'play') return;
  swipes.set(e.pointerId, { x: e.clientX, y: e.clientY, done: false, onRush });
};
touchLayer.addEventListener('pointerdown', (e) => startSwipe(e));
// swipes may start on the RUSH button too; a touch that doesn't become a swipe fires RUSH on pointer-up
document.getElementById('btn-rush').addEventListener('pointerdown', (e) => startSwipe(e, true));
window.addEventListener('pointermove', (e) => {
  const swipe = swipes.get(e.pointerId);
  if (!swipe || swipe.done || G.state !== 'play') return;
  const dx = e.clientX - swipe.x, dy = e.clientY - swipe.y;
  const th = Math.max(22, Math.min(window.innerWidth, window.innerHeight) * 0.045);
  if (Math.hypot(dx, dy) < th) return;
  swipe.done = true;
  player.input(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'roll' : 'jump'));
});
window.addEventListener('pointerup', (e) => {
  // a touch that started on the RUSH button and never became a swipe is a tap on it
  const swipe = swipes.get(e.pointerId);
  if (swipe && swipe.onRush && !swipe.done && G.state === 'play') ui.rushTap();
  swipes.delete(e.pointerId);
});
window.addEventListener('pointercancel', (e) => { swipes.delete(e.pointerId); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    pause();
    if (audio.ctx && audio.ctx.state === 'running') audio.ctx.suspend(); // menu / game-over music too
  } else if (G.state !== 'pause' && audio.unlocked && audio.ctx) {
    audio.ctx.resume().catch(() => {});
  }
});
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
  // music is a nice-to-have: never let a slow or failed download keep the player on the loading screen
  const audioReady = Promise.race([Promise.resolve(audio.ready).catch(() => {}), new Promise((r) => setTimeout(r, 15000))])
    .then(() => { if (audio.tracksPending) audio.tracksPending = false; });
  await Promise.all([fonts, loadImages((p) => { artP = p; show(); }), audioReady]);
  const mats = buildSharedMaterials();
  world = new World(scene, worldRoot);
  coins = new Coins(worldRoot);
  spawner = new Spawner(worldRoot, mats, coins);
  player = new Player(scene);
  fx = new FX(worldRoot);
  markers = new DistanceMarkers(worldRoot);
  drone = new Drone(mats);
  scene.add(drone.group);
  resize();

  // Warm the pools and shader programs so the first obstacles don't hitch.
  spawner.reset(true);
  spawner.update(0, 300);
  worldRoot.position.z = 300;
  updateCamera(0.016, 0.016);
  world.prewarm(true, 300);
  renderer.compile(scene, camera);
  for (const f of Object.values(player.frames)) for (const t of [].concat(f)) if (t && t.isTexture) renderer.initTexture(t);
  for (const m of mats.trainMats) if (m.map) renderer.initTexture(m.map);
  applyQuality();
  composer.render();
  world.prewarm(false);
  spawner.reset(false);
  worldRoot.position.z = 0;
  world.reset(0);
  ui.loading(1);

  G.state = 'menu';
  G.camBlend = 0;
  ui.show('menu');
  if (progression.runsPlayed() === 0) store.set('news', NEWS_ALL); // brand-new players have nothing to compare with
  showChallenge();
  flushPending();
  requestAnimationFrame(frame);
  if (location.hash === '#debug' || new URLSearchParams(location.search).has('debug')) window.__tabby = { G, player, spawner, startRun, grantPower, addRush, nearMiss, awardTrick, triggerRush, startSurge, progression };
  if (window.__tabby) Object.assign(window.__tabby, { crash, offerRevive, acceptRevive, declineRevive, dailyUI, world, zone, ZONE, TUNNEL, THEMES, frame, composer, markers, boardUI, settings, toMenu, scene });
  // Browsers grant audio on pointerup / touchend / click / keydown (not touch pointerdown):
  // keep listening until the context is really running.
  const GESTURES = ['pointerup', 'touchend', 'click', 'keydown'];
  const firstGesture = () => {
    if (audio.unlocked) return;
    audio.music(G.state === 'play' ? 'game' : 'menu');
    audio.unlock().then((ok) => {
      if (!ok) return;
      document.getElementById('hint-sound').hidden = true;
      for (const t of GESTURES) window.removeEventListener(t, firstGesture, true);
    });
  };
  for (const t of GESTURES) window.addEventListener(t, firstGesture, true);
}

boot().catch((err) => {
  if (!glLost && !renderer.getContext().isContextLost()) throw err;
  bootFailed = true; // the GPU went away mid-load: the notice is (or is about to be) up; its restore starts over
});
