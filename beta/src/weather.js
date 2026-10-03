import * as THREE from 'three';

/*
 * Rain: GPU-animated streaks in a box around the camera (one draw call, no per-frame CPU work beyond
 * a few uniforms). Drops are fixed in the world, so the run carries the camera through them and the
 * streaks slant toward the viewer with speed.
 */
const COUNT = 900;
const BOX = [28, 15, 46];   // x width, y height, z depth (mostly ahead of the camera)

const VERT = /* glsl */`
attribute vec3 aSeed;      // x, z, phase (0..1)
attribute vec2 aCorner;    // x: 0 head / 1 tail, y: side -1 / 1
uniform vec3 uCam;
uniform float uFall, uRun, uSpeed, uWidth, uShutter;
varying float vA;
void main() {
  vec3 box = vec3(${BOX[0].toFixed(1)}, ${BOX[1].toFixed(1)}, ${BOX[2].toFixed(1)});
  vec3 p;
  p.x = uCam.x + (aSeed.x - 0.5) * box.x;
  p.y = uCam.y + 7.0 - mod(aSeed.z * box.y + uFall, box.y);
  p.z = uCam.z + 4.0 - box.z + mod(aSeed.y * box.z + uRun, box.z);
  // streak along the drop's velocity relative to the running camera
  vec3 vel = vec3(-1.5, -26.0, uSpeed);
  vec3 tail = p - vel * uShutter;
  vec4 vh = modelViewMatrix * vec4(p, 1.0);
  vec4 vt = modelViewMatrix * vec4(tail, 1.0);
  vec4 v = mix(vh, vt, aCorner.x);
  vec2 d = vt.xy - vh.xy;
  d = length(d) > 1e-4 ? normalize(d) : vec2(0.0, 1.0);
  v.xy += vec2(-d.y, d.x) * aCorner.y * uWidth;
  float z = -v.z;
  vA = smoothstep(0.6, 2.5, z) * (1.0 - smoothstep(22.0, 40.0, z)) * mix(1.0, 0.1, aCorner.x);
  gl_Position = projectionMatrix * v;
}`;

const FRAG = /* glsl */`
uniform vec3 uColor;
uniform float uOpacity;
varying float vA;
void main() {
  gl_FragColor = vec4(uColor, vA * uOpacity);
}`;

export class Rain {
  constructor() {
    const seed = new Float32Array(COUNT * 4 * 3), corner = new Float32Array(COUNT * 4 * 2), idx = [];
    for (let i = 0; i < COUNT; i++) {
      const sx = Math.random(), sz = Math.random(), ph = Math.random();
      for (let j = 0; j < 4; j++) {
        const v = i * 4 + j;
        seed.set([sx, sz, ph], v * 3);
        corner.set([j >> 1, j & 1 ? 1 : -1], v * 2);
      }
      const b = i * 4;
      idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);   // counter-clockwise in view space (front-facing)
    }
    const geo = new THREE.BufferGeometry();
    // positions are generated in the shader; the attribute only sets the vertex count
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(COUNT * 4 * 3), 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 3));
    geo.setAttribute('aCorner', new THREE.BufferAttribute(corner, 2));
    geo.setIndex(idx);
    this.uniforms = {
      uCam: { value: new THREE.Vector3() }, uFall: { value: 0 }, uRun: { value: 0 }, uSpeed: { value: 20 },
      uWidth: { value: 0.011 }, uShutter: { value: 0.035 },
      uColor: { value: new THREE.Color(0.78, 0.86, 0.95) }, uOpacity: { value: 0 },
    };
    this.mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: false, fog: false,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 7;
    this.amount = 0;
    this.reduce = matchMedia('(prefers-reduced-motion: reduce)');
  }

  /** amount 0..1 (theme rain × shelter). */
  setAmount(a) { this.amount = a; }

  update(dt, dist, speed, camera) {
    const reduce = this.reduce.matches;
    const op = this.amount * (reduce ? 0.35 : 0.55);
    this.mesh.visible = op > 0.004;
    if (!this.mesh.visible) return;
    const u = this.uniforms;
    u.uOpacity.value = op;
    u.uCam.value.copy(camera.position);
    // wrap at whole multiples of the box so the shader's mod() never jumps
    u.uFall.value = (u.uFall.value + dt * (reduce ? 12 : 26)) % (BOX[1] * 500);
    u.uRun.value = dist % (BOX[2] * 200);
    u.uSpeed.value = speed;
  }
}
