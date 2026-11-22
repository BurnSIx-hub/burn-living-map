// Пожар на тайле: тайл с пометкой `flags.burn-living-map.blaze` (0 — нет, до 1 —
// пылает) горит сам, а не область под ним. Пламя рисуется поверх тайла в его же
// осях и обрезается по его картинке попиксельно: где картинка прозрачна (или в
// запечённой полупрозрачной тени FA), огня нет. Меш каждый кадр повторяет тайл —
// его место, поворот, отражение и качание ветром, — поэтому горящая крона
// качается вместе с огнём.
//
// Сверх пламени: дым над токенами (уходит по ветру огня, за край тайла можно —
// это не огонь), свет Foundry без документа (у каждого игрока свой, временный)
// и треск костра рядом (см. ambience.js). Документ тайла не меняется.

import { VERT } from "./shaders.js";

const MODULE_ID = "burn-living-map";
/** Дым тянется за тайл на столько клеток и идёт поверх токенов. */
const SMOKE_REACH = 9;
const ABOVE_TOKENS = 800;
/** Ступени пожара в окне тайла. */
export const BLAZE_STEPS = [0, 0.35, 0.7, 1];
export const BLAZE_NAMES = ["none", "smoulder", "burn", "blaze"];

const HEAD = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 vPos;
uniform float uTime, uHeat, uStrength, uFlame, uSmoke, uSeed;
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + vec2(17.1, 9.2); a *= 0.5; }
  return v;
}
vec4 over(vec4 dst, vec3 c, float a) { return vec4(c * a, a) + dst * (1.0 - a); }
`;

/**
 * Пламя в осях тайла. `vPos` — точка в пикселях картинки тайла (от якоря),
 * `uCell` — сколько этих пикселей в клетке по осям, `uUp` — куда «вверх по
 * экрану» в клетках тайла: языки тянутся туда, даже если тайл повёрнут.
 */
const FLAME = HEAD + `
uniform sampler2D uTile;
uniform vec4 uFrame;
uniform vec4 uRect;
uniform vec2 uCell, uUp, uWindDir;
uniform float uAlpha;
float alphaAt(vec2 local) {
  vec2 uv = (local - uRect.xy) / uRect.zw;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return 0.0;
  return texture2D(uTile, uFrame.xy + uv * uFrame.zw).a;
}
// Что горит: непрозрачное тайла (не полупрозрачная тень под ним), пятнами —
// где-то прогорело, где-то разгорается; сильнее пожар — пятна шире.
float fuel(vec2 q, float t) {
  float solid = smoothstep(0.55, 0.8, alphaAt(q * uCell));
  float cover = mix(0.66, 0.3, uHeat);
  float patches = smoothstep(cover - 0.1, cover + 0.12, fbm(q * 0.6 + uSeed + vec2(t * 0.03, -t * 0.02)));
  return solid * patches;
}
vec3 heatColor(float h) {
  vec3 c = mix(vec3(0.35, 0.03, 0.0), vec3(0.85, 0.18, 0.02), smoothstep(0.0, 0.3, h));
  c = mix(c, vec3(1.0, 0.5, 0.08), smoothstep(0.3, 0.6, h));
  c = mix(c, vec3(1.0, 0.82, 0.35), smoothstep(0.6, 0.85, h));
  return mix(c, vec3(1.0, 0.97, 0.82), smoothstep(0.88, 1.0, h));
}
float hash3(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
float noise3(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  float a = mix(hash3(i), hash3(i + vec3(1.0, 0.0, 0.0)), u.x);
  float b = mix(hash3(i + vec3(0.0, 1.0, 0.0)), hash3(i + vec3(1.0, 1.0, 0.0)), u.x);
  float c = mix(hash3(i + vec3(0.0, 0.0, 1.0)), hash3(i + vec3(1.0, 0.0, 1.0)), u.x);
  float d = mix(hash3(i + vec3(0.0, 1.0, 1.0)), hash3(i + vec3(1.0, 1.0, 1.0)), u.x);
  return mix(mix(a, b, u.y), mix(c, d, u.y), u.z);
}
float fbm3(vec3 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * noise3(p); p = p * 2.02 + vec3(13.1, 7.7, 3.3); a *= 0.5; }
  return v;
}
const float PI2 = 6.2831853;
float hash1(float x) { return fract(sin(x * 12.9898) * 43758.5453); }
// Один очаг сверху, как у огня области (shaders.js, flameAt): языки разной длины по
// кругу (шум по окружности, без симметрии), клубятся и дрожат, край рвёт шум turb,
// дальнее сносит ветром uWindDir.
// hot — жар середины: у костра выше языков, у очагов пожара ниже, чтобы
// они не горели одинаковыми звёздочками.
float flameAt(vec2 p, vec2 c, float size, float seed, float t, vec3 turb, float hot) {
  vec2 rel = (p - c) / size;
  rel -= uWindDir * 0.3 * length(rel);
  float r = length(rel);
  if (r > 1.45) return 0.0;
  vec2 dir = rel / max(r, 0.001);
  float ang = atan(rel.y, rel.x) + (turb.x - 0.5) * 0.9 * r;
  vec2 cs = vec2(cos(ang), sin(ang));
  float lobes = noise3(vec3(cs * 2.0 + seed, t * 1.8)) * 0.55 + noise3(vec3(cs * 5.0 + seed * 1.7, t * 3.6)) * 0.45;
  lobes = smoothstep(0.25, 0.8, lobes);
  float len = 0.32 + 0.62 * lobes;
  float flow = noise3(vec3(rel * 2.6 + seed, t * 2.8)) * 0.6 + noise3(vec3(rel * 6.0 - seed, t * 4.5)) * 0.4;
  float rr = r * (0.88 + 0.24 * (turb.z - 0.5)) / len;
  float body = clamp(1.0 - rr, 0.0, 1.0);
  body = pow(body, 0.9) * (0.65 + 0.7 * flow);
  body *= smoothstep(0.0, 0.22, body + (turb.y - 0.5) * 0.28);
  float core = (1.0 - smoothstep(0.0, 0.38, r)) * hot * 0.8;
  return clamp(max(body, core * (0.75 + 0.35 * flow)), 0.0, 1.2);
}
void main() {
  // Попиксельно: прозрачное и тень — мимо.
  float here = smoothstep(0.55, 0.8, alphaAt(vPos));
  if (here <= 0.0) { gl_FragColor = vec4(0.0); return; }
  vec2 p = vPos / uCell;
  float t = uTime;
  float f0 = fuel(p, t);
  // Обугленное: темнеет всё, что горит или горело, — сильнее у сильного пожара.
  float burnt = smoothstep(0.3, 0.7, fbm(p * 0.6 + uSeed * 1.7)) * 0.5 + 0.5;
  vec4 o = vec4(0.0);
  o = over(o, vec3(0.06, 0.04, 0.03), (0.18 + 0.4 * f0) * burnt * uHeat);
  // Угли: тлеют пятнами и дышат.
  float coal = fbm(p * 4.0 + vec2(0.0, t * 0.2) + uSeed);
  o.rgb += vec3(1.0, 0.3, 0.05) * f0 * smoothstep(0.5, 0.75, coal) * (0.5 + 0.5 * sin(t * 2.0 + coal * 9.0)) * (0.35 + 0.4 * uHeat);
  // Огонь сверху: клубящееся тело по горящим пятнам и очаг в середине тайла.
  // Тлеет — тело тусклое и рваное, пылает — сплошное.
  vec3 turb = vec3(noise3(vec3(p * 2.6 + uSeed, t * 1.6)), noise3(vec3(p * 9.5, t * 4.0)), noise3(vec3(p * 4.8 + 7.0, t * 2.8)));
  // Сплошное клубящееся пламя по горящему, без сетки очагов (она давала россыпь
  // звёздочек): два слоя кипящего шума, светлые сгустки и тёмные провалы.
  float edge = (noise3(vec3(p * 2.2, t * 1.3)) - 0.5) * 0.45 + (noise3(vec3(p * 5.0, t * 3.2)) - 0.5) * 0.4;
  float n1 = fbm3(vec3(p * 1.3 + uSeed, t * 0.8));
  float n2 = fbm3(vec3(p * 3.1 + 5.0, t * 1.9));
  float boil = smoothstep(0.4, 0.82, n1 * 0.7 + n2 * 0.5);
  float body = smoothstep(0.3, 0.8, f0 + edge) * (0.06 + 0.8 * boil) * (0.8 + 0.3 * turb.z);
  float raw = body * smoothstep(0.3, 0.9, uHeat);
  // Очаг в середине тайла: у кроны или куста в клетку сетка очагов может
  // промахнуться, а гореть должно всегда.
  vec2 mid = (uRect.xy + uRect.zw * 0.5) / uCell;
  vec2 cells = uRect.zw / uCell;
  float fm = max(fuel(mid, t), 0.6 * smoothstep(0.55, 0.8, alphaAt(mid * uCell)));
  if (fm > 0.1) {
    float size = clamp(min(cells.x, cells.y) * 0.45, 0.4, 1.2) * (0.45 + 0.55 * uHeat);
    raw = max(raw, flameAt(p, mid, size, uSeed * 3.3, t, turb, 0.95) * mix(0.6, 0.95, fm) * (0.55 + 0.45 * uHeat));
  }
  float core = noise(p * 4.0 + vec2(t * 1.1, -t * 0.9));
  float h = clamp(raw * (0.85 + 0.3 * core), 0.0, 1.0);
  // Кончики языков темнеют в копоть — мягко, без обводки.
  float soot = smoothstep(0.0, 0.08, raw) * (1.0 - smoothstep(0.06, 0.3, raw));
  o = over(o, vec3(0.1, 0.055, 0.035), soot * 0.18 * uFlame);
  vec3 col = heatColor(h);
  float a = smoothstep(0.02, 0.45, h) * uFlame;
  o = over(o, col, clamp(a * 0.85, 0.0, 1.0));
  o.rgb += col * smoothstep(0.55, 1.0, h) * 0.32 * uFlame;
  // Отсвет по самому тайлу вокруг очагов.
  vec2 side = vec2(-uWindDir.y, uWindDir.x);
  float near = max(f0, max(fuel(p + uWindDir * 0.5, t), fuel(p - side * 0.5, t)) * 0.7);
  float flick = 0.82 + 0.18 * noise(vec2(t * 3.1, p.x * 0.3));
  o.rgb += vec3(1.0, 0.42, 0.1) * near * (1.0 - h) * 0.2 * flick * uFlame * uHeat;
  // Искры: подхвачены жаром и ветром — тоже только над непрозрачным.
  for (int k = 0; k < 2; k++) {
    float sc = 2.4 + float(k) * 1.7;
    vec2 qq = (p - uWindDir * t * (0.7 + 0.35 * float(k)) + vec2(sin(t * 0.7 + float(k)) * 0.2, cos(t * 0.6 + float(k)) * 0.2) + uSeed) * sc;
    vec2 cell = floor(qq);
    float hh = hash(cell + float(k) * 3.1);
    vec2 sp = cell + vec2(hash(cell + 1.7), hash(cell + 9.2));
    float life = fract(hh * 7.0 + t * 0.35);
    float src = fuel(p - uWindDir * (0.3 + life * 1.4), t);
    float spark = smoothstep(0.09, 0.0, length(qq - sp)) * step(0.82, hh) * (1.0 - life) * src;
    o.rgb += vec3(1.0, 0.75, 0.3) * spark * 1.2 * uFlame * uHeat;
  }
  gl_FragColor = o * here * uAlpha * uStrength;
}`;

/** Дым в мировых пикселях: шлейф от середины тайла по ветру, шире — у большого. */
const SMOKE = HEAD + `
uniform float uGrid, uWind, uRadius;
uniform vec2 uCenter;
float plume(vec2 p, vec2 src, float t, float wide) {
  float rad = radians(uWind);
  vec2 w = vec2(cos(rad), sin(rad));
  vec2 q = p - src;
  float along = dot(q, w);
  float across = dot(q, vec2(-w.y, w.x));
  if (along < -0.4 - wide) return 0.0;
  float width = 0.3 + wide + along * 0.42;
  float body = exp(-across * across / (width * width)) * smoothstep(-0.3 - wide, 0.35, along) * exp(-max(along, 0.0) * 0.22);
  // Перед очагом (along < 0) делитель не меньше 0,6: иначе у большого очага
  // он уходил в ноль, и шум разлетался лучами из одной точки.
  float puffs = fbm(vec2(along * 1.4 - t * 1.1, across * 1.8 / (0.6 + max(along, 0.0) * 0.4)) + src * 3.1 + uSeed);
  return body * smoothstep(0.22, 0.62, puffs) * smoothstep(8.5 + wide, 5.0 + wide, along);
}
void main() {
  vec2 p = vPos / uGrid;
  float sm = clamp(plume(p, uCenter, uTime, uRadius * 0.55) * uSmoke * (0.35 + 0.65 * uHeat), 0.0, 0.85);
  // Тёплый серый: холодный над зелёной кроной давал сиреневый налёт.
  gl_FragColor = vec4(vec3(0.38, 0.35, 0.32) * sm, sm) * uStrength;
}`;

/** @type {Map<string, {tile: Tile, flame: PIXI.Mesh, smoke: PIXI.Mesh, light: object|null, clock: number}>} */
const fires = new Map();
let ticking = false;
let last = 0;

const on = () => game.settings.get(MODULE_ID, "enabled");

/** Сила пожара тайла: 0 — не горит. */
export function heatOf(doc) {
  const v = Number(doc?.flags?.[MODULE_ID]?.blaze ?? 0);
  return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0;
}

/** Своё зерно у каждого тайла: два пожара не горят одинаково. */
function seedOf(id) {
  let h = 2166136261;
  for (const c of id) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  return (h % 10000) / 100;
}

/** Горящие тайлы как области для звука: рамка тайла, проверка точки и контур. */
export function blazingShapes() {
  if (!on() || !canvas.ready) return [];
  return (canvas.tiles?.placeables ?? []).filter((t) => heatOf(t.document) > 0).map((t) => {
    const b = t.bounds;
    return {
      polygonTree: { testPoint: (p) => b.contains(p.x, p.y) },
      polygons: [{ points: [b.left, b.top, b.right, b.top, b.right, b.bottom, b.left, b.bottom] }],
      heat: heatOf(t.document)
    };
  });
}

export function clearBlaze() {
  for (const f of fires.values()) {
    if (!f.flame.destroyed) f.flame.destroy();
    if (!f.smoke.destroyed) f.smoke.destroy();
    try { f.light?.destroy(); } catch {}
  }
  const had = fires.size;
  fires.clear();
  if (had && canvas.ready) canvas.perception.update({ initializeLighting: true, refreshLighting: true, refreshVision: true });
}

export function rebuildBlaze() {
  clearBlaze();
  if (!canvas.ready || !canvas.primary || !on()) return;
  for (const tile of canvas.tiles?.placeables ?? []) {
    const heat = heatOf(tile.document);
    if (!heat) continue;
    const mesh = tile.mesh;
    if (!mesh || mesh.destroyed) continue;
    // Картинка ещё грузится — придём позже.
    if (!mesh.texture?.baseTexture?.valid) {
      mesh.texture?.baseTexture?.once?.("loaded", () => rebuildBlaze());
      continue;
    }
    try {
      fires.set(tile.id, makeFire(tile, heat));
    } catch (err) {
      console.error(`${MODULE_ID} | tile fire ${tile.id}`, err);
    }
  }
  canvas.primary.sortDirty = true;
  if (fires.size) canvas.perception.update({ initializeLighting: true, refreshLighting: true, refreshVision: true });
  last = performance.now() / 1000;
  if (fires.size && !ticking) {
    canvas.app.ticker.add(tick);
    ticking = true;
  }
}

function settings() {
  const g = (k, d) => { try { return game.settings.get(MODULE_ID, k); } catch { return d; } };
  return { flame: g("flame", 1), smoke: g("smoke", 1), wind: g("wind", 210), strength: g("strength", 1) };
}

function makeFire(tile, heat) {
  const tm = tile.mesh;
  const tex = tm.texture;
  const tw = tex.orig?.width ?? tex.width, th = tex.orig?.height ?? tex.height;
  const ax = tm.anchor?.x ?? 0.5, ay = tm.anchor?.y ?? 0.5;
  const x0 = -ax * tw, y0 = -ay * th;
  const verts = new Float32Array([x0, y0, x0 + tw, y0, x0 + tw, y0 + th, x0, y0 + th]);
  const quad = new PIXI.Geometry().addAttribute("aVertexPosition", verts, 2).addIndex(new Uint16Array([0, 1, 2, 0, 2, 3]));
  const base = tex.baseTexture, fr = tex.frame;
  const s = settings();
  const seed = seedOf(tile.id);
  const flame = new PIXI.Mesh(quad, PIXI.Shader.from(VERT, FLAME, {
    uTile: tex,
    uFrame: new Float32Array([fr.x / base.width, fr.y / base.height, fr.width / base.width, fr.height / base.height]),
    uRect: new Float32Array([x0, y0, tw, th]),
    uCell: new Float32Array([100, 100]),
    uUp: new Float32Array([0, -1]),
    uWindDir: new Float32Array([1, 0]),
    uAlpha: 1, uTime: 0, uHeat: heat, uSeed: seed,
    uFlame: s.flame, uSmoke: s.smoke, uStrength: s.strength
  }));
  flame.name = `${MODULE_ID}.blaze.${tile.id}`;
  flame.eventMode = "none";
  canvas.primary.addChild(flame);

  // Дым — в мировых пикселях, с полями под шлейф.
  const grid = canvas.grid.size;
  const b = tile.bounds.clone().pad(grid * SMOKE_REACH);
  const sv = new Float32Array([b.left, b.top, b.right, b.top, b.right, b.bottom, b.left, b.bottom]);
  const sq = new PIXI.Geometry().addAttribute("aVertexPosition", sv, 2).addIndex(new Uint16Array([0, 1, 2, 0, 2, 3]));
  const c = tile.bounds.center;
  const smoke = new PIXI.Mesh(sq, PIXI.Shader.from(VERT, SMOKE, {
    uTime: 0, uHeat: heat, uSeed: seed, uGrid: grid, uWind: s.wind,
    uCenter: new Float32Array([c.x / grid, c.y / grid]),
    uRadius: Math.min(tile.bounds.width, tile.bounds.height) / grid / 2,
    uFlame: s.flame, uSmoke: s.smoke, uStrength: s.strength
  }));
  smoke.name = `${MODULE_ID}.blaze-smoke.${tile.id}`;
  smoke.eventMode = "none";
  smoke.elevation = tile.document.elevation ?? 0;
  smoke.sortLayer = ABOVE_TOKENS;
  smoke.sort = 0;
  canvas.primary.addChild(smoke);

  const fire = { tile, flame, smoke, light: makeLight(tile, heat), clock: (seed * 37) % 3600, shape: "" };
  follow(fire);
  return fire;
}

/** Свет огня: источник Foundry без документа — живёт, пока горит, только у этого игрока. */
function makeLight(tile, heat) {
  try {
    const Light = CONFIG.Canvas.lightSourceClass;
    const grid = canvas.grid.size;
    const size = Math.max(tile.bounds.width, tile.bounds.height) / grid;
    const c = tile.bounds.center;
    const elevation = tile.document.elevation ?? 0;
    const level = canvas.inferLevelFromElevation?.(elevation)?.id ?? canvas.scene.firstLevel?.id ?? null;
    const dim = grid * (1.5 + size * 0.5 + 2 * heat);
    const light = new Light({ sourceId: `${MODULE_ID}.blaze.${tile.id}`, object: null });
    light.initialize({
      x: c.x, y: c.y, elevation, level, rotation: 0, walls: true, vision: false,
      dim, bright: dim * 0.35, color: "#ff8a3d", alpha: 0.45 + 0.2 * heat,
      coloration: 1, attenuation: 0.6, luminosity: 0.5, saturation: 0, contrast: 0, shadows: 0,
      animation: { type: "torch", speed: 5, intensity: 5, reverse: false },
      seed: Math.floor(seedOf(tile.id) * 100), disabled: false, preview: false
    });
    light.add();
    return light;
  } catch (err) {
    console.warn(`${MODULE_ID} | fire light failed`, err);
    return null;
  }
}

/** Меш пламени — туда же, куда тайл: место, поворот, отражение, качание ветром. */
function follow(fire) {
  const { tile, flame, smoke } = fire;
  const tm = tile.mesh;
  if (!tm || tm.destroyed) { flame.visible = smoke.visible = false; return; }
  // Тайл перерисовывают (правка, смена картинки) — меш у него новый, а якорь и
  // картинка выставляются не сразу: рамку берём заново, когда она поменялась.
  const tex = tm.texture;
  const tw = tex.orig?.width ?? tex.width, th = tex.orig?.height ?? tex.height;
  const ax = tm.anchor?.x ?? 0.5, ay = tm.anchor?.y ?? 0.5;
  const shape = `${ax}|${ay}|${tw}|${th}|${tex.baseTexture?.uid}`;
  if (shape !== fire.shape) {
    fire.shape = shape;
    const x0 = -ax * tw, y0 = -ay * th;
    flame.geometry.getBuffer("aVertexPosition").update(new Float32Array([x0, y0, x0 + tw, y0, x0 + tw, y0 + th, x0, y0 + th]));
    const base = tex.baseTexture, fr = tex.frame, uu = flame.shader.uniforms;
    uu.uTile = tex;
    uu.uRect = new Float32Array([x0, y0, tw, th]);
    uu.uFrame = new Float32Array([fr.x / base.width, fr.y / base.height, fr.width / base.width, fr.height / base.height]);
  }
  // Foundry 14 пересоздаёт меш тайла (догрузка картинки, правка) и кладёт его в конец
  // основной группы без пересортировки: пламя оказывалось под тайлом и не было видно.
  // Проверяем порядок, когда меш тайла сменился, и раз в секунду.
  const P = canvas.primary;
  const now = performance.now();
  if (P && flame.parent === P && (fire.mesh !== tm || now - (fire.checked ?? 0) > 1000)) {
    fire.mesh = tm;
    fire.checked = now;
    if (tm.parent === P && P.children.indexOf(flame) < P.children.indexOf(tm)) P.sortChildren();
  }
  flame.position.copyFrom(tm.position);
  flame.scale.copyFrom(tm.scale);
  flame.skew.copyFrom(tm.skew);
  flame.pivot.copyFrom(tm.pivot);
  flame.rotation = tm.rotation;
  flame.elevation = tm.elevation;
  flame.sortLayer = tm.sortLayer;
  flame.sort = (tm.sort ?? 0) + 0.5;
  const shown = tm.visible && tm.renderable !== false && tile.visible !== false;
  flame.visible = shown;
  smoke.visible = shown;
  const u = flame.shader.uniforms;
  u.uAlpha = tm.alpha ?? 1;
  // Клетка в пикселях картинки и «вверх по экрану» в осях тайла.
  const grid = canvas.grid.size;
  const sx = Math.hypot(tm.scale.x, 0) || 1, sy = Math.abs(tm.scale.y) || 1;
  u.uCell[0] = grid / sx;
  u.uCell[1] = grid / sy;
  const m = tm.localTransform;
  const det = m.a * m.d - m.b * m.c || 1;
  // Мировой вектор (0, −1) в осях тайла: обратная матрица.
  let lx = (m.c * 1) / det, ly = (-m.a * 1) / det;
  // В клетках тайла: делим на размер клетки по оси.
  lx /= u.uCell[0];
  ly /= u.uCell[1];
  const len = Math.hypot(lx, ly) || 1;
  u.uUp[0] = lx / len;
  u.uUp[1] = ly / len;
  // Ветер огня (куда клонятся языки и летят искры) — тоже в осях тайла.
  const w = (settings().wind * Math.PI) / 180;
  const [wx, wy] = [Math.cos(w), Math.sin(w)];
  let vx = (m.d * wx - m.c * wy) / det / u.uCell[0];
  let vy = (-m.b * wx + m.a * wy) / det / u.uCell[1];
  const vl = Math.hypot(vx, vy) || 1;
  u.uWindDir[0] = vx / vl;
  u.uWindDir[1] = vy / vl;
}

function tick() {
  if (!fires.size || !canvas.ready) {
    canvas.app?.ticker.remove(tick);
    ticking = false;
    return;
  }
  const now = performance.now() / 1000;
  const dt = Math.min(now - last, 0.25);
  last = now;
  const s = settings();
  for (const fire of fires.values()) {
    if (fire.flame.destroyed) continue;
    fire.clock = (fire.clock + dt) % 3600;
    follow(fire);
    for (const mesh of [fire.flame, fire.smoke]) {
      const u = mesh.shader.uniforms;
      u.uTime = fire.clock;
      u.uFlame = s.flame;
      u.uSmoke = s.smoke;
      u.uStrength = s.strength;
      if ("uWind" in u) u.uWind = s.wind;
    }
  }
}

/* ------------------------------ Окно тайла ------------------------------ */

const loc = (k) => game.i18n.localize(`BLM.${k}`);

Hooks.on("renderTileConfig", (app, element) => {
  const root = element instanceof HTMLElement ? element : element[0];
  // Вкладка «Вид»: в v14 это div.tab, раньше — section.
  const tab = root?.querySelector('.tab[data-tab="appearance"]') ?? root?.querySelector(".tab[data-tab]");
  if (!tab || tab.querySelector(`.${MODULE_ID}-blaze`)) return;
  const now = heatOf(app.document);
  const at = BLAZE_STEPS.reduce((best, v, i) => (Math.abs(v - now) < Math.abs(BLAZE_STEPS[best] - now) ? i : best), 0);
  const set = document.createElement("fieldset");
  set.className = `${MODULE_ID}-blaze`;
  set.innerHTML = `
    <legend>🔥 ${loc("Title")}</legend>
    <div class="form-group">
      <label>${loc("Blaze.Label")}</label>
      <div class="form-fields"><select name="flags.${MODULE_ID}.blaze" data-dtype="Number">
        ${BLAZE_STEPS.map((v, i) => `<option value="${v}" ${i === at ? "selected" : ""}>${loc(`Blaze.${BLAZE_NAMES[i]}`)}</option>`).join("")}
      </select></div>
      <p class="hint">${loc("Blaze.Hint")}</p>
    </div>`;
  tab.append(set);
});

/* ------------------------------ Хуки ------------------------------ */

export function registerBlaze() {
  Hooks.on("canvasReady", () => rebuildBlaze());
  Hooks.on("canvasTearDown", () => clearBlaze());
  for (const hook of ["createTile", "updateTile", "deleteTile"]) {
    Hooks.on(hook, (doc, changes) => {
      if (doc.parent !== canvas.scene) return;
      // Подвинули горящий тайл — свет и дым на новое место; прочее — только если касается огня.
      const relevant = hook !== "updateTile" || heatOf(doc) > 0 || changes?.flags?.[MODULE_ID] && "blaze" in changes.flags[MODULE_ID];
      if (relevant) setTimeout(() => rebuildBlaze(), 0);
    });
  }
}
