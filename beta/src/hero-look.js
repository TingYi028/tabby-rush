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

export const HERO_LOOK_NAMES = ['', 'mono', 'vhs', 'neon', 'gold', 'holo', 'pixel', 'rainbow', 'cloak', 'glitch', 'negative', 'thermal', 'comic', 'maillard', 'dopamine', 'ccd', 'y2k', 'jelly', 'marble', 'clay', 'sketch', 'vapor', 'glow'];

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

  // 13 美拉德穿搭: luminance through a 4-stop brown ramp (#3b2316, #7a4a2a, #c08a5a, #f1d9b5), a little warm grain (slower in calm mode)
  13: /* glsl */`
vec4 heroLookColor(vec2 uv) {
  vec4 s = heroTex(uv);
  float t = clamp((sqrt(clamp(heroLuma(s.rgb), 0.0, 1.0)) - 0.1) * 1.2, 0.0, 1.0) * 3.0;
  vec3 c0 = vec3(0.044, 0.017, 0.008);
  vec3 c1 = vec3(0.195, 0.069, 0.023);
  vec3 c2 = vec3(0.527, 0.254, 0.102);
  vec3 c3 = vec3(0.879, 0.694, 0.462);
  vec3 c = t < 1.0 ? mix(c0, c1, t) : (t < 2.0 ? mix(c1, c2, t - 1.0) : mix(c2, c3, t - 2.0));
  float tk = floor(heroT * mix(9.0, 2.0, heroCalm));
  float grain = heroHash(floor(uv / (HERO_TEXEL * 2.0)) + tk * 7.0) - 0.5;
  c = c * (1.0 + grain * 0.14) + vec3(1.0, 0.8, 0.55) * grain * 0.02;
  return vec4(max(c, 0.0), s.a);
}`,

  // 14 多巴胺配色: the costume's brightness posterised into 5 bands, each band a candy colour (pastel-neon, +25 % saturation, a little gloss inside
  // the band); hair, paw pads and the outline are not saturated bright costume pixels, so they keep their colour. Static: no flicker.
  14: /* glsl */`
vec4 heroLookColor(vec2 uv) {
  vec4 s = heroTex(uv);
  vec3 g = sqrt(max(s.rgb, 0.0));
  float mx = max(g.r, max(g.g, g.b));
  float sat = (mx - min(g.r, min(g.g, g.b))) / max(mx, 0.001);
  float lv = clamp((heroLuma(g) - 0.35) / 0.45, 0.0, 0.999) * 5.0;
  float band = floor(lv);
  vec3 pal = band < 1.0 ? vec3(0.62, 0.45, 1.0) : (band < 2.0 ? vec3(1.0, 0.48, 0.74) : (band < 3.0 ? vec3(1.0, 0.72, 0.42) : (band < 4.0 ? vec3(1.0, 0.92, 0.45) : vec3(0.45, 1.0, 0.78))));
  pal = clamp(mix(vec3(heroLuma(pal)), pal, 1.25), 0.0, 1.0) * (0.9 + 0.2 * fract(lv));
  float m = smoothstep(0.35, 0.55, sat) * smoothstep(0.45, 0.6, mx);
  return vec4(mix(s.rgb, pal * pal * 1.05, m), s.a);
}`,

  // 15 CCD 數位感: lifted, over-exposed highlights, warm cast, soft chroma noise, and a flash pop (0.12 s, +35 % exposure) once every 4 s (off in calm mode)
  15: /* glsl */`
vec4 heroLookColor(vec2 uv) {
  vec4 s = heroTex(uv);
  float l = heroLuma(s.rgb);
  vec3 g = sqrt(max(s.rgb, 0.0));
  float tk = floor(heroT * mix(8.0, 2.0, heroCalm));
  vec2 cell = floor(uv / (HERO_TEXEL * 2.0));
  vec3 chroma = vec3(heroHash(cell + tk * 3.0), heroHash(cell + tk * 5.0 + 17.0), heroHash(cell + tk * 7.0 + 31.0)) - 0.5;
  g = mix(g, vec3(1.0), 0.14 * smoothstep(0.45, 1.0, l * 2.0));
  g = mix(g, vec3(l * 1.2), 0.12) * 0.88 + 0.1;
  g = g * vec3(1.08, 1.0, 0.86) + chroma * 0.05;
  float ph = mod(heroT, 4.0);
  float pop = (1.0 - heroCalm) * step(ph, 0.12) * sin(ph / 0.12 * 3.14159);
  g *= 1.0 + 0.35 * pop;
  heroEmis = vec3(0.12, 0.11, 0.09) * pop * heroGlow;
  return vec4(max(g * g, 0.0), s.a);
}`,

  // 16 Y2K 鍍鉻: luminance through a cool silver chrome ramp with reflection banding, a thin iridescent band sliding across (heroGlow scales the sheen)
  16: /* glsl */`
vec4 heroLookColor(vec2 uv) {
  vec4 s = heroTex(uv);
  float t = clamp(heroLuma(s.rgb) * 1.9, 0.0, 1.0);
  float refl = 0.5 + 0.5 * sin(t * 9.0 + uv.y * 7.0 - heroT * 0.4);
  float u = clamp(t * 0.75 + refl * 0.3 - 0.05, 0.0, 1.0);
  vec3 dark = vec3(0.015, 0.02, 0.035);
  vec3 mid = vec3(0.3, 0.36, 0.5);
  vec3 lite = vec3(0.85, 0.92, 1.05);
  vec3 c = u < 0.5 ? mix(dark, mid, u * 2.0) : mix(mid, lite, (u - 0.5) * 2.0);
  float sw = fract((dot(uv, vec2(0.7, 0.7)) - heroT * 0.3) / 1.7);
  float band = smoothstep(0.0, 0.04, sw) * (1.0 - smoothstep(0.04, 0.15, sw));
  vec3 irid = 0.5 + 0.5 * cos(6.2832 * (sw * 2.5 + vec3(0.0, 0.33, 0.67)));
  c += irid * band * (0.25 + 0.75 * t) * 0.55;
  heroEmis = (irid * band * 0.45 + vec3(0.75, 0.85, 1.0) * t * t * t * 0.18) * heroGlow;
  return vec4(c, s.a);
}`,

  // 17 果凍貓: a translucent tinted jelly body (outline kept), a gentle wobble of the picture (at most 1.2 % of the quad) and a drifting specular blob
  17: /* glsl */`
vec4 heroLookColor(vec2 uv) {
  float amp = 0.012 * mix(1.0, 0.35, heroCalm);
  vec2 p = clamp(uv + vec2(sin(uv.y * 18.0 + heroT * 5.0), cos(uv.x * 14.0 + heroT * 4.2)) * amp, 0.002, 0.998);
  vec4 s = heroTex(p);
  vec2 r = heroRing(p, 3.0);
  float edge = s.a * (1.0 - r.x);
  float l = heroLuma(s.rgb);
  vec3 tint = vec3(1.0, 0.42, 0.36);
  vec3 c = s.rgb * 0.5 + tint * (0.3 + 0.7 * sqrt(l)) * 0.55;
  vec2 bp = vec2(0.5 + 0.2 * sin(heroT * 0.9), 0.3 + 0.12 * cos(heroT * 0.7));
  float blob = (1.0 - smoothstep(0.0, 0.11, length((uv - bp) * vec2(1.0, 0.8)))) * s.a;
  heroEmis = (tint * edge * 0.3 + vec3(1.0, 0.97, 0.95) * blob * 0.85) * heroGlow;
  return vec4(c, s.a * mix(0.8, 1.0, edge));
}`,
  // 18 大理石雕像: luminance lifted into warm white stone, grey veins (two warped sine scales, kept off the carved outline), a soft specular sheen drifting slowly
  18: /* glsl */`
float heroVein(vec2 p) {
  float w = sin(p.x * 3.1 + sin(p.y * 4.3) * 1.7) + sin(p.y * 2.3 - sin(p.x * 3.7) * 1.3);
  return 1.0 - smoothstep(0.0, 0.18, abs(w));
}
vec4 heroLookColor(vec2 uv) {
  vec4 s = heroTex(uv);
  float l = sqrt(clamp(heroLuma(s.rgb), 0.0, 1.0));
  float vein = max(heroVein(uv * vec2(7.0, 8.5)), 0.6 * heroVein(uv * vec2(17.0, 21.0) + 3.1));
  vec3 c = vec3(0.86, 0.85, 0.82) * (0.1 + l);
  c = mix(c, vec3(0.36, 0.38, 0.42) * (0.3 + 0.7 * l), vein * 0.85 * smoothstep(0.1, 0.4, l));
  float sw = fract((dot(uv, vec2(0.6, 0.8)) - heroT * 0.12) / 1.7);
  float sheen = smoothstep(0.0, 0.25, sw) * (1.0 - smoothstep(0.25, 0.5, sw));
  heroEmis = vec3(1.0, 0.98, 0.94) * (smoothstep(0.7, 1.0, l) * 0.1 + sheen * l * l * 0.08) * heroGlow;
  return vec4(c, s.a);
}`,

  // 19 黏土動畫: flattened matte colours (less contrast, a little more saturation), thumbprint whorls + grain, a stop-motion wobble at 8 steps a second (static in calm mode)
  19: /* glsl */`
vec4 heroLookColor(vec2 uv) {
  float tk = floor(heroT * 8.0);
  vec2 jit = (vec2(heroHash(vec2(tk, 1.0)), heroHash(vec2(tk, 2.0))) - 0.5) * 0.006 + vec2(sin(uv.y * 40.0 + tk * 1.3), cos(uv.x * 34.0 + tk * 0.9)) * 0.0025;
  vec2 p = clamp(uv + jit * (1.0 - heroCalm), 0.002, 0.998);
  vec4 s = heroTex(p);
  vec3 g = sqrt(max(s.rgb, 0.0));
  float l = heroLuma(g);
  g = mix(vec3(l), g, 1.15);
  g = 0.26 + g * 0.68;
  vec2 q = uv * vec2(6.0, 7.5);
  vec2 cell = floor(q);
  vec2 f = fract(q) - 0.5 - (vec2(heroHash(cell), heroHash(cell + 7.7)) - 0.5) * 0.4;
  float ridge = sin(length(f) * 38.0 + heroHash(cell + 3.3) * 6.2832) * (1.0 - smoothstep(0.25, 0.5, length(f)));
  float grain = heroHash(floor(uv / (HERO_TEXEL * 3.0))) - 0.5;
  g += ridge * 0.035 + grain * 0.05;
  vec2 r = heroRing(p, 3.0);
  g += 0.06 * s.a * (1.0 - r.x);
  return vec4(max(g, 0.0) * max(g, 0.0), s.a);
}`,

  // 20 鉛筆素描: warm paper white, graphite hatching by luminance (one diagonal layer, a crossing layer, a third in the darks), a pencil outline, a 6 steps a second line boil (static in calm mode)
  20: /* glsl */`
float heroHatch(float v) {
  float f = fract(v);
  return smoothstep(0.37, 0.5, f) * (1.0 - smoothstep(0.5, 0.63, f));
}
vec4 heroLookColor(vec2 uv) {
  float tk = floor(heroT * 6.0) * (1.0 - heroCalm);
  vec2 p = clamp(uv + (vec2(heroHash(vec2(tk, 4.0)), heroHash(vec2(tk, 5.0))) - 0.5) * 0.004, 0.002, 0.998);
  vec4 s = heroTex(p);
  float l = sqrt(clamp(heroLuma(s.rgb), 0.0, 1.0));
  vec2 g = p * vec2(46.0, 57.5);
  float w = sin(p.y * 31.0 + tk) * 0.12 + sin(p.x * 23.0 - tk * 1.7) * 0.1;
  float h1 = heroHatch((g.x + g.y) * 0.7071 + w);
  float h2 = heroHatch((g.x - g.y) * 0.7071 + w * 1.3);
  float h3 = heroHatch(g.y * 1.1 + w * 0.8);
  float hatch = max(max(h1 * (1.0 - smoothstep(0.7, 0.9, l)), h2 * (1.0 - smoothstep(0.5, 0.66, l))), h3 * (1.0 - smoothstep(0.25, 0.4, l)));
  float fibre = heroHash(floor(p / (HERO_TEXEL * 2.0))) - 0.5;
  vec3 paper = vec3(0.86, 0.85, 0.8) * (0.95 + 0.1 * fibre);
  vec2 r = heroRing(p, 2.0);
  float outl = s.a * (1.0 - r.x);
  float ink = clamp(hatch * 0.85 + outl * 0.9, 0.0, 1.0);
  vec3 c = mix(paper * (0.86 + 0.14 * smoothstep(0.0, 0.7, l)), vec3(0.09, 0.09, 0.11), ink);
  return vec4(c, s.a);
}`,

  // 21 蒸氣波: luminance through a violet -> hot pink -> cyan gradient map (cyan towards the top), scanlines, a slow light sweep down the body (off in calm mode)
  21: /* glsl */`
vec4 heroLookColor(vec2 uv) {
  vec4 s = heroTex(uv);
  float t = clamp((sqrt(clamp(heroLuma(s.rgb), 0.0, 1.0)) - 0.15) * 1.4 + (uv.y - 0.5) * 0.55, 0.0, 1.0);
  vec3 c0 = vec3(0.12, 0.02, 0.28);
  vec3 c1 = vec3(1.0, 0.22, 0.62);
  vec3 c2 = vec3(0.25, 0.9, 1.0);
  vec3 c = t < 0.5 ? mix(c0, c1, t * 2.0) : mix(c1, c2, (t - 0.5) * 2.0);
  c *= 0.8 + 0.2 * step(0.5, fract(uv.y * 90.0));
  float sw = fract(uv.y * 0.9 + heroT * 0.18);
  c *= 1.0 + 0.3 * (1.0 - heroCalm) * smoothstep(0.0, 0.08, sw) * (1.0 - smoothstep(0.08, 0.3, sw));
  heroEmis = vec3(1.0, 0.4, 0.8) * smoothstep(0.55, 0.9, t) * 0.08 * heroGlow;
  return vec4(c, s.a);
}`,

  // 22 夜光貼紙: a pale phosphor-green plastic body; the darker the zone tint (material.color: tunnels, 霓虹夜城, dusk) the stronger the green glow, rim glow included
  22: /* glsl */`
vec4 heroLookColor(vec2 uv) {
  vec4 s = heroTex(uv);
  float l = sqrt(clamp(heroLuma(s.rgb), 0.0, 1.0));
  float dk = 1.0 - smoothstep(0.82, 0.98, heroLuma(diffuse));
  vec3 c = mix(vec3(0.02, 0.05, 0.03), vec3(0.62, 0.85, 0.5), clamp(l * l * 1.4, 0.0, 1.0));
  vec2 r = heroRing(uv, 3.0);
  float rim = s.a * (1.0 - r.x);
  float pulse = 0.94 + 0.06 * (1.0 - heroCalm) * sin(heroT * 1.6);
  heroEmis = vec3(0.25, 1.0, 0.5) * ((0.35 + 0.65 * l) * (0.18 + dk) + rim * (0.3 + 0.7 * dk) * 0.8) * pulse * s.a * heroGlow;
  return vec4(c, s.a);
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
