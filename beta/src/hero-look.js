/*
 * Hero "looks" (外觀): GLSL for the hero sprite material (src/player.js patches MeshBasicMaterial with it).
 *
 * One program per look: the chosen look is a compile-time `#define HERO_LOOK n`, so the default look compiles the
 * original two-frame cross-fade and nothing else, and a look only costs the player who wears it. Programs are cached
 * by three.js per look (see Player.setLook), so switching back is instant after the first time.
 *
 * Contract of every look: `vec4 heroLookColor(vec2 uv)` returns the sprite colour and alpha for the (cross-faded)
 * sprite. It may set `heroEmis`, an additive HDR glow that is added AFTER the zone tint (material.color, which
 * main.js applyLook() rewrites every frame) so glows stay bright in tunnels while the body still follows the
 * zone lighting. The colour is multiplied by the zone tint like the plain sprite.
 *
 * Uniforms (shared by all looks): heroT seconds, heroGlow 0..1 (effects setting), heroCalm 0/1 (reduce flashing).
 * Look numbers must match LOOK in cosmetics.js (checked by tools/test_cosmetics.mjs).
 */

export const HERO_LOOK_NAMES = ['', 'mono', 'vhs', 'neon', 'gold', 'holo', 'pixel', 'rainbow', 'cloak', 'glitch', 'negative', 'thermal', 'comic'];

// GLSL reserved words / names we must not use as identifiers: flat smooth centroid sample input output filter half
// fixed long short packed buffer shared. Float literals everywhere (GLSL ES has no int -> float conversion).
const HELPERS = /* glsl */`
const vec2 HERO_TEXEL = vec2(0.001953125, 0.0015625);
float heroLuma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float heroHash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
vec4 heroTex(vec2 uv) {
  vec4 a = texture2D(map, uv);
  return blend > 0.001 ? mix(a, texture2D(map2, uv), blend) : a;
}
float heroA(vec2 uv) {
  float a = texture2D(map, uv).a;
  return blend > 0.001 ? mix(a, texture2D(map2, uv).a, blend) : a;
}
const vec2 HERO_RING[8] = vec2[8](vec2(1.0, 0.0), vec2(0.7071, 0.7071), vec2(0.0, 1.0), vec2(-0.7071, 0.7071),
  vec2(-1.0, 0.0), vec2(-0.7071, -0.7071), vec2(0.0, -1.0), vec2(0.7071, -0.7071));
vec2 heroRing(vec2 uv, float r) {
  float lo = 1.0;
  float hi = 0.0;
  for (int i = 0; i < 8; i++) {
    float a = heroA(uv + HERO_RING[i] * r * HERO_TEXEL);
    lo = min(lo, a);
    hi = max(hi, a);
  }
  return vec2(lo, hi);
}
`;

const LOOKS = {
  // 1 黑白默片: silver-screen grey, flickering grain, the odd projector scratch
  1: /* glsl */`
vec4 heroLookColor(vec2 uv) {
  vec4 s = heroTex(uv);
  float l = heroLuma(s.rgb);
  float tk = floor(heroT * mix(18.0, 5.0, heroCalm));
  float grain = heroHash(floor(uv / (HERO_TEXEL * 2.0)) + tk * 17.0) - 0.5;
  float g = smoothstep(0.0, 1.0, clamp(l * 1.9, 0.0, 1.0));
  g = g * (0.92 + grain * 0.5) + max(grain, 0.0) * 0.05;
  g *= 1.0 - 0.07 * (1.0 - heroCalm) * heroHash(vec2(tk, 3.0));
  float scratch = step(0.9965, heroHash(vec2(floor(uv.x * 260.0), tk))) * 0.3;
  vec3 c = vec3(max(g, 0.0)) * vec3(1.0, 0.985, 0.95) + vec3(scratch);
  return vec4(c, s.a);
}`,

  // 2 復古錄影帶: faded sepia, coarse colour levels, scanlines, a wobbling tape head
  2: /* glsl */`
vec4 heroLookColor(vec2 uv) {
  float row = floor(uv.y / (HERO_TEXEL.y * 3.0));
  float wob = (heroHash(vec2(row, floor(heroT * 10.0))) - 0.5) * 0.006 * (1.0 - heroCalm);
  vec4 s = heroTex(vec2(uv.x + wob, uv.y));
  float l = heroLuma(s.rgb);
  vec3 c = sqrt(max(mix(s.rgb, vec3(l) * vec3(1.25, 1.0, 0.72), 0.6), 0.0));
  c = floor(c * 7.0 + 0.5) / 7.0;
  c *= c;
  c *= 0.78 + 0.22 * step(0.5, fract(row * 0.5));
  return vec4(c, s.a);
}`,

  // 3 霓虹虎斑: cyan <-> magenta neon outline from the alpha edge, a dimmer body
  3: /* glsl */`
vec4 heroLookColor(vec2 uv) {
  vec4 s = heroTex(uv);
  vec2 r1 = heroRing(uv, 2.5);
  vec2 r2 = heroRing(uv, 7.0);
  float outl = clamp(r1.y - s.a, 0.0, 1.0);
  float halo = clamp(r2.y - max(s.a, r1.y), 0.0, 1.0);
  float inner = s.a * (1.0 - r1.x);
  float ph = heroT * 0.7 + uv.y * 1.6;
  vec3 neon = mix(vec3(0.05, 0.9, 1.0), vec3(1.0, 0.12, 0.85), 0.5 + 0.5 * sin(ph * 6.2832));
  float pulse = 1.0 - 0.18 * (1.0 - heroCalm) * (0.5 + 0.5 * sin(heroT * 7.0));
  vec3 body = s.rgb * 0.82 + neon * heroLuma(s.rgb) * 0.25;
  heroEmis = neon * (outl * 2.4 + halo * 0.9 + inner * 1.1) * heroGlow * pulse;
  return vec4(body, max(s.a, clamp(outl + halo * 0.55, 0.0, 1.0)));
}`,

  // 4 黃金打工仔: luminance-driven gold ramp, a slow glint sweeping across, twinkling stars
  4: /* glsl */`
vec4 heroLookColor(vec2 uv) {
  vec4 s = heroTex(uv);
  float t = clamp(heroLuma(s.rgb) * 1.2, 0.0, 1.0);
  vec3 lo = vec3(0.16, 0.07, 0.01);
  vec3 mid = vec3(0.9, 0.52, 0.06);
  vec3 hi = vec3(1.6, 1.2, 0.45);
  vec3 g = t < 0.5 ? mix(lo, mid, t * 2.0) : mix(mid, hi, (t - 0.5) * 2.0);
  g *= 0.9 + 0.2 * sin(uv.y * 38.0 + t * 5.0);
  float sw = fract((dot(uv, vec2(0.8, 0.6)) - heroT * 0.5) / 2.4);
  float band = smoothstep(0.0, 0.03, sw) * (1.0 - smoothstep(0.03, 0.12, sw));
  g += vec3(1.3, 1.0, 0.45) * band * (0.35 + 0.65 * t);
  float rate = mix(2.5, 1.3, heroCalm);
  vec2 cell = uv * vec2(24.0, 30.0);
  float h = heroHash(floor(cell) + floor(heroT * rate) * 11.0);
  vec2 f = fract(cell) - 0.5;
  float dia = max(0.0, 1.0 - 2.6 * (abs(f.x) + abs(f.y)));
  float bar = max(max(0.0, 1.0 - abs(f.y) * 12.0) * max(0.0, 1.0 - abs(f.x) * 2.4),
                  max(0.0, 1.0 - abs(f.x) * 12.0) * max(0.0, 1.0 - abs(f.y) * 2.4));
  float env = sin(fract(heroT * rate) * 3.14159);
  float on = step(0.955, h) * step(0.5, s.a) * step(0.45, t);
  heroEmis = vec3(2.2, 1.8, 1.0) * max(dia, bar) * env * on * heroGlow;
  return vec4(g, s.a);
}`,

  // 5 全像投影: cyan hologram, scanlines, sliced rows and a faint flicker (both off in calm mode)
  5: /* glsl */`
vec4 heroLookColor(vec2 uv) {
  float band = floor(uv.y * 46.0);
  float jit = heroHash(vec2(band, floor(heroT * 5.0)));
  float dx = jit > 0.975 ? (jit - 0.975) * 2.4 : 0.0;
  dx *= 1.0 - heroCalm;
  vec2 p = vec2(uv.x + dx, uv.y);
  vec4 s = heroTex(p);
  vec2 r = heroRing(p, 3.0);
  float rim = s.a * (1.0 - r.x);
  float l = heroLuma(s.rgb);
  float scan = 0.5 + 0.5 * sin(uv.y * 280.0 - heroT * 4.0);
  float fl = 1.0 - 0.12 * (1.0 - heroCalm) * step(0.6, heroHash(vec2(floor(heroT * 5.0), 5.0)));
  vec3 c = vec3(0.08, 0.75, 1.0) * (0.12 + 1.35 * l) * (0.55 + 0.45 * scan) * fl;
  heroEmis = vec3(0.2, 1.0, 1.3) * rim * 1.6 * heroGlow * fl;
  return vec4(c, s.a * (0.5 + 0.3 * scan));
}`,

  // 6 像素風: sprite re-sampled on a coarse grid, ordered dither, 6 levels per channel, hard alpha
  6: /* glsl */`
float heroBayer(vec2 p) {
  float i = mod(p.x, 2.0);
  float j = mod(p.y, 2.0);
  return (i < 0.5 ? (j < 0.5 ? 0.0 : 3.0) : (j < 0.5 ? 2.0 : 1.0)) / 4.0;
}
vec4 heroLookColor(vec2 uv) {
  vec2 grid = vec2(46.0, 57.5);
  vec2 cell = floor(uv * grid);
  vec2 puv = (cell + 0.5) / grid;
  vec4 a = textureLod(map, puv, 3.0);
  vec4 s = blend > 0.001 ? mix(a, textureLod(map2, puv, 3.0), blend) : a;
  vec3 c = sqrt(max(s.rgb, 0.0));
  c = floor((c + (heroBayer(cell) - 0.4) * 0.18) * 6.0 + 0.5) / 6.0;
  return vec4(c * c, s.a > 0.45 ? 1.0 : 0.0);
}`,

  // 7 彩虹虎斑: hue rotates over the bright, saturated costume pixels only (hair, paw pads and shadows keep their colour)
  7: /* glsl */`
vec3 heroHue(vec3 c, float ang) {
  const mat3 toYiq = mat3(0.299, 0.596, 0.211, 0.587, -0.274, -0.523, 0.114, -0.322, 0.312);
  const mat3 toRgb = mat3(1.0, 1.0, 1.0, 0.956, -0.272, -1.106, 0.621, -0.647, 1.703);
  vec3 q = toYiq * c;
  float cs = cos(ang);
  float sn = sin(ang);
  q = vec3(q.x, q.y * cs - q.z * sn, q.y * sn + q.z * cs);
  return max(toRgb * q, 0.0);
}
vec4 heroLookColor(vec2 uv) {
  vec4 s = heroTex(uv);
  vec3 g = sqrt(max(s.rgb, 0.0));
  float mx = max(g.r, max(g.g, g.b));
  float mn = min(g.r, min(g.g, g.b));
  float sat = (mx - mn) / max(mx, 0.001);
  float m = smoothstep(0.42, 0.62, sat) * smoothstep(0.30, 0.50, mx);
  vec3 rot = heroHue(s.rgb, heroT * 1.1 + uv.y * 5.0) * 1.12;
  heroEmis = rot * m * 0.12 * heroGlow;
  return vec4(mix(s.rgb, rot, m), s.a);
}`,

  // 8 隱形斗篷: a faint, rippling see-through body with a bright rim, so the hero never becomes hard to read
  8: /* glsl */`
vec4 heroLookColor(vec2 uv) {
  vec2 w = vec2(sin(uv.y * 70.0 + heroT * 3.0), cos(uv.x * 55.0 - heroT * 2.3)) * 0.0045 * mix(1.0, 0.4, heroCalm);
  vec2 p = uv + w;
  vec4 s = heroTex(p);
  vec2 r = heroRing(p, 3.0);
  float rim = s.a * (1.0 - r.x);
  float sh = 0.5 + 0.5 * sin(p.y * 90.0 - heroT * 3.5 + sin(p.x * 28.0) * 2.5);
  float l = heroLuma(s.rgb);
  vec3 c = vec3(0.35, 0.62, 0.85) * (0.25 + 1.1 * l) * (0.8 + 0.4 * sh);
  heroEmis = vec3(0.55, 0.95, 1.15) * (rim * 1.4 + s.a * sh * 0.08) * heroGlow;
  return vec4(c, min(1.0, s.a * (0.3 + 0.12 * sh) + rim * 0.55));
}`,

  // 9 故障藝術: RGB split, torn rows in short bursts (calm mode keeps only the steady split)
  9: /* glsl */`
vec4 heroLookColor(vec2 uv) {
  float tk = floor(heroT * 9.0);
  float burst = (1.0 - heroCalm) * step(0.7, heroHash(vec2(tk, 1.0)));
  float shift = (heroHash(vec2(floor(uv.y * 28.0), tk)) - 0.5) * 0.07 * burst;
  float split = 0.004 + 0.014 * burst;
  vec2 p = vec2(uv.x + shift, uv.y);
  vec4 sr = heroTex(p + vec2(split, 0.0));
  vec4 sg = heroTex(p);
  vec4 sb = heroTex(p - vec2(split, 0.0));
  float a = max(sg.a, max(sr.a, sb.a));
  vec3 c = vec3(sr.r * sr.a, sg.g * sg.a, sb.b * sb.a) / max(a, 0.02);
  c *= 0.9 + 0.1 * sin(uv.y * 520.0);
  float blk = step(0.93, heroHash(floor(uv * vec2(9.0, 12.0)) + tk)) * burst;
  c = mix(c, c.bgr * 1.3, blk * 0.55);
  return vec4(c, a);
}`,

  // 10 底片負片: colours inverted, a little cool
  10: /* glsl */`
vec4 heroLookColor(vec2 uv) {
  vec4 s = heroTex(uv);
  vec3 g = vec3(1.0) - sqrt(clamp(s.rgb, 0.0, 1.0));
  return vec4(g * g * vec3(0.95, 1.0, 1.1), s.a);
}`,

  // 11 熱像儀: luminance mapped to a thermal camera palette, with a little heat shimmer
  11: /* glsl */`
vec3 heroHeat(float t) {
  vec3 c = mix(vec3(0.0, 0.0, 0.08), vec3(0.35, 0.0, 0.45), smoothstep(0.0, 0.25, t));
  c = mix(c, vec3(0.9, 0.05, 0.1), smoothstep(0.25, 0.5, t));
  c = mix(c, vec3(1.4, 0.7, 0.05), smoothstep(0.5, 0.75, t));
  c = mix(c, vec3(1.8, 1.7, 0.7), smoothstep(0.75, 1.0, t));
  return c;
}
vec4 heroLookColor(vec2 uv) {
  vec2 p = uv + vec2(sin(uv.y * 45.0 + heroT * 2.0) * 0.0025 * (1.0 - 0.6 * heroCalm), 0.0);
  vec4 s = heroTex(p);
  float t = clamp(heroLuma(s.rgb) * 1.8 + 0.04 * sin(heroT * 1.3 + uv.y * 8.0), 0.0, 1.0);
  return vec4(heroHeat(t), s.a);
}`,

  // 12 漫畫網點: posterised colour, halftone dots in the shadows, black ink outline
  12: /* glsl */`
vec4 heroLookColor(vec2 uv) {
  vec4 s = heroTex(uv);
  vec2 r = heroRing(uv, 2.6);
  float outl = clamp(r.y - s.a, 0.0, 1.0);
  float l = heroLuma(s.rgb);
  vec3 q = sqrt(max(s.rgb, 0.0));
  q = floor(q * 4.0 + 0.5) / 4.0;
  vec3 col = q * q * 1.05;
  vec2 g = uv * vec2(72.0, 90.0);
  vec2 rr = vec2(g.x + g.y, g.y - g.x) * 0.7071;
  float d = length(fract(rr) - 0.5);
  float rad = clamp(0.62 - l * 1.15, 0.0, 0.62);
  float ink = 1.0 - smoothstep(rad - 0.06, rad + 0.04, d);
  col = mix(col, col * 0.12, ink * step(0.02, rad));
  col = mix(col * smoothstep(0.0, 0.6, s.a), vec3(0.02), clamp(outl * 2.0, 0.0, 1.0));
  return vec4(col, max(s.a, clamp(outl * 1.6, 0.0, 1.0)));
}`,
};

export const HERO_LOOK_COUNT = Object.keys(LOOKS).length;

/**
 * Patch three's MeshBasicMaterial fragment shader (r170): the sprite is read as the cross-fade of two frames
 * (`map` -> `map2` by `blend`), then (look > 0) passed through heroLookColor(). Returns the new source, or null
 * when the stock shader no longer has the anchors we need (the caller then falls back to the plain cross-fade).
 */
export function patchHeroShader(frag, look = 0) {
  const A = ['#include <map_pars_fragment>', '#include <map_fragment>', '#include <opaque_fragment>'];
  if (A.some((t) => !frag.includes(t))) return null;
  const n = LOOKS[look] ? look : 0;
  // heroEmis lives outside USE_MAP (opaque_fragment reads it); the sampling helpers need `map`, so they sit inside
  const pars = n
    ? `uniform float heroT;\nuniform float heroGlow;\nuniform float heroCalm;\nvec3 heroEmis = vec3(0.0);\n#ifdef USE_MAP\n${HELPERS}\n${LOOKS[n]}\n#endif\n`
    : '';
  const mapFrag = n
    ? `#ifdef USE_MAP
        vec4 sampledDiffuseColor = heroLookColor(vMapUv);
        diffuseColor *= sampledDiffuseColor;
      #endif`
    : `#ifdef USE_MAP
        vec4 sampledDiffuseColor = mix(texture2D(map, vMapUv), texture2D(map2, vMapUv), blend);
        diffuseColor *= sampledDiffuseColor;
      #endif`;
  return `#define HERO_LOOK ${n}\n${frag}`
    .replace('#include <map_pars_fragment>', `#include <map_pars_fragment>\nuniform sampler2D map2;\nuniform float blend;\n${pars}`)
    .replace('#include <map_fragment>', mapFrag)
    .replace('#include <opaque_fragment>', `${n ? 'outgoingLight += heroEmis;\n' : ''}#include <opaque_fragment>`);
}

/** GLSL source of one look (tests / debugging). */
export const lookSource = (n) => LOOKS[n] || '';
