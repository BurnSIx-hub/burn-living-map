// Погода на земле. Падает сам снег или дождь Foundry (погода сцены), а здесь —
// что от него остаётся на полу:
//   снег (`snow`, `blizzard`) — то тут, то там наметает снег: сугробик из
//     бугров, круглый холмик, длинный намёт по ветру, серп, горсть комков или
//     просто порошу; растёт, держится несколько секунд и тает. Намёты и серпы
//     ложатся по одному ветру сцены, в метель их больше;
//   дождь (`rain`, `rainStorm`) — пол мокнет: слабые отражения неба в лужах,
//     круги от капель и мелкие брызги.
// Под крышами (тайлы, что не пускают погоду) и в воде, лаве и болоте ничего нет.
// Рисует каждый игрок у себя; на полу, под токенами; свет Foundry ложится сверху.

import { VERT } from "./shaders.js";
import { surfaceAt } from "./particles.js";

const MODULE_ID = "burn-living-map";
const SNOW = { snow: 1, blizzard: 2.2 };
const RAIN = { rain: 1, rainStorm: 1.8 };
/** Ниже токенов (700) и кругов на воде (650), выше тайлов пола. */
const GROUND = 640;
/** Маска «куда падает» — в восьмую долю масштаба. */
const MASK_SCALE = 0.125;
/** Сугробов на экране одновременно, не больше. */
const DRIFT_CAP = 45;
/** Сколько сугробов в секунду на 100 клеток видимой сцены при обычном снеге. */
const DRIFT_RATE = 0.9;

let drifts = null;
const heaps = [];
let sheen = null;
let ticking = false;
let last = 0;
let textures = null;
/** Куда дует ветер на этой сцене, радианы: намёты вытянуты по нему. */
let wind = 0;

const on = () => game.settings.get(MODULE_ID, "enabled") && game.settings.get(MODULE_ID, "groundWeather");

/* ------------------------------ Сборка ------------------------------ */

export function rebuildWeather() {
  clearWeather();
  if (!canvas.ready || !canvas.primary || !on()) return;
  const w = canvas.scene?.weather ?? "";
  if (SNOW[w]) {
    texturesReady();
    // Ветер у сцены свой и постоянный: от её id, чтобы у всех игроков один.
    wind = [...(canvas.scene.id ?? "")].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 3600, 7) / 3600 * Math.PI * 2;
    drifts = new PIXI.Container();
    drifts.name = `${MODULE_ID}.drifts`;
    drifts.eventMode = "none";
    drifts.elevation = 0;
    drifts.sortLayer = GROUND;
    drifts.sort = 0;
    canvas.primary.addChild(drifts);
  }
  if (RAIN[w]) sheen = wetFloor(RAIN[w]);
  if (!drifts && !sheen) return;
  canvas.primary.sortDirty = true;
  last = performance.now() / 1000;
  if (!ticking) {
    canvas.app.ticker.add(tick);
    ticking = true;
  }
}

export function clearWeather() {
  if (ticking) canvas.app?.ticker.remove(tick);
  ticking = false;
  heaps.length = 0;
  if (drifts && !drifts.destroyed) drifts.destroy({ children: true });
  drifts = null;
  if (sheen) {
    if (!sheen.mesh.destroyed) sheen.mesh.destroy();
    sheen.mask.destroy(true);
  }
  sheen = null;
}

/** Тайлы-крыши: Foundry не пускает под них погоду. */
function roofs() {
  return (canvas.tiles?.placeables ?? []).filter((t) => t.document.restrictions?.weather && t.mesh && !t.mesh.destroyed);
}

function underRoof(x, y, list) {
  return list.some((t) => {
    try {
      return t.mesh.containsCanvasPoint({ x, y });
    } catch {
      return t.bounds?.contains(x, y) ?? false;
    }
  });
}

/* ------------------------------ Сугробы ------------------------------ */

function bake(draw, size) {
  const root = new PIXI.Container();
  draw(root, size);
  const tex = canvas.app.renderer.generateTexture(root, {
    resolution: 1, multisample: PIXI.MSAA_QUALITY.HIGH,
    region: new PIXI.Rectangle(-size, -size, size * 2, size * 2)
  });
  root.destroy({ children: true });
  return tex;
}

/** Неровный круг: радиус гуляет по нескольким гармоникам. */
function blob(cx, cy, r, rnd, sq = 1, n = 36) {
  const k = [0.1 + rnd() * 0.12, rnd() * 0.1, rnd() * 0.07], ph = [rnd() * 6.3, rnd() * 6.3, rnd() * 6.3];
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const d = r * (1 + k[0] * Math.sin(a * 2 + ph[0]) + k[1] * Math.sin(a * 3 + ph[1]) + k[2] * Math.sin(a * 6 + ph[2]));
    pts.push(cx + Math.cos(a) * d, cy + Math.sin(a) * d * sq);
  }
  return pts;
}

/**
 * Сугробик сверху: вытянутый рваный намёт из двух-трёх бугров. Край размыт,
 * под ним голубоватая тень с подветренной стороны (снизу справа), сверху
 * слева блик; вокруг — россыпь снежной крупы. Середина плотная, края сквозят.
 */
function drift(root, s, rnd) {
  const soft = (g, px) => {
    const f = new PIXI.BlurFilter(px, 3);
    f.padding = px * 3;
    g.filters = [f];
    return root.addChild(g);
  };
  const lumps = [];
  const n = 2 + Math.floor(rnd() * 2);
  for (let k = 0; k < n; k++) {
    const x = (k - (n - 1) / 2) * s * 0.32 + (rnd() - 0.5) * s * 0.12;
    lumps.push({ x, y: (rnd() - 0.5) * s * 0.16, r: s * (0.2 + 0.13 * rnd()) });
  }
  const shape = (g, dx, dy, grow, color, alpha) => {
    g.beginFill(color, alpha);
    for (const l of lumps) g.drawPolygon(blob(l.x + dx, l.y + dy, l.r * grow, rnd, 0.62));
    g.endFill();
  };
  // Тень, тело, блик — каждое мягким краем.
  const shadow = new PIXI.Graphics();
  shape(shadow, s * 0.07, s * 0.08, 1.05, 0x3c4e6e, 0.5);
  soft(shadow, s * 0.08);
  const body = new PIXI.Graphics();
  shape(body, 0, 0, 1.15, 0xe8eef8, 0.55);
  shape(body, 0, 0, 0.95, 0xf4f8ff, 0.9);
  soft(body, s * 0.05);
  const light = new PIXI.Graphics();
  shape(light, -s * 0.05, -s * 0.05, 0.55, 0xffffff, 0.8);
  soft(light, s * 0.06);
  // Крупа вокруг: мелкие комочки, гуще у намёта.
  const dust = new PIXI.Graphics();
  for (let k = 0; k < 26; k++) {
    const l = lumps[Math.floor(rnd() * lumps.length)];
    const a = rnd() * Math.PI * 2, d = l.r * (1 + rnd() * 0.9);
    dust.beginFill(0xf6f9ff, 0.5 + 0.4 * rnd());
    dust.drawCircle(l.x + Math.cos(a) * d, l.y + Math.sin(a) * d * 0.7, s * (0.012 + 0.02 * rnd()));
    dust.endFill();
  }
  soft(dust, s * 0.008);
}

/** Мягкий край слою: размытие по его размеру. */
function softLayer(root, g, px) {
  const f = new PIXI.BlurFilter(px, 3);
  f.padding = px * 3;
  g.filters = [f];
  return root.addChild(g);
}

/** Снежная крупа вокруг точек `around` (x, y, r): гуще у края. */
function grains(root, s, rnd, around, count, spread = 0.9, sq = 0.7) {
  const g = new PIXI.Graphics();
  for (let k = 0; k < count; k++) {
    const l = around[Math.floor(rnd() * around.length)];
    const a = rnd() * Math.PI * 2, d = l.r * (1 + rnd() * spread);
    g.beginFill(0xf6f9ff, 0.45 + 0.45 * rnd());
    g.drawCircle(l.x + Math.cos(a) * d, l.y + Math.sin(a) * d * sq, s * (0.01 + 0.018 * rnd()));
    g.endFill();
  }
  softLayer(root, g, s * 0.008);
}

/** Слои намёта: тень с подветренной стороны, тело, блик — по фигуре `shape`. */
function layered(root, s, shape, { shadow = 0.5, lift = 1 } = {}) {
  const sh = new PIXI.Graphics();
  shape(sh, s * 0.07 * lift, s * 0.08 * lift, 1.05, 0x3c4e6e, shadow);
  softLayer(root, sh, s * 0.08);
  const body = new PIXI.Graphics();
  shape(body, 0, 0, 1.15, 0xe8eef8, 0.55);
  shape(body, 0, 0, 0.95, 0xf4f8ff, 0.9);
  softLayer(root, body, s * 0.05);
  const light = new PIXI.Graphics();
  shape(light, -s * 0.05, -s * 0.05, 0.55, 0xffffff, 0.8);
  softLayer(root, light, s * 0.06);
}

/** Холмик: один круглый бугор, повыше — тень длиннее. */
function mound(root, s, rnd) {
  const r = s * (0.3 + 0.08 * rnd()), sq = 0.8 + 0.15 * rnd();
  const pts = blob(0, 0, r, rnd, sq, 40);
  layered(root, s, (g, dx, dy, grow, color, alpha) => {
    g.beginFill(color, alpha);
    g.drawPolygon(pts.map((v, i) => (i % 2 ? v * grow + dy : v * grow + dx)));
    g.endFill();
  }, { shadow: 0.55, lift: 1.3 });
  grains(root, s, rnd, [{ x: 0, y: 0, r }], 18, 0.7, sq);
}

/**
 * Намёт по ветру: длинная узкая гряда вдоль оси x, с острыми концами и
 * рябью поперёк — ветер вылизывает снег полосами.
 */
function streak(root, s, rnd) {
  const len = s * (0.62 + 0.2 * rnd()), wide = s * (0.15 + 0.06 * rnd());
  const bend = (rnd() - 0.5) * s * 0.25;
  const n = 28;
  const ridge = (grow, dx, dy) => {
    const top = [], low = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n, x = -len + 2 * len * t;
      // Толще с наветренной трети, к концам сходит на нет.
      const w = wide * grow * Math.pow(Math.sin(Math.PI * t), 0.7) * (1.1 - 0.35 * t) * (1 + 0.15 * Math.sin(t * 17 + rnd()));
      const y = bend * Math.sin(Math.PI * t);
      top.push(x + dx, y - w + dy);
      low.unshift(x + dx, y + w * 0.8 + dy);
    }
    return top.concat(low);
  };
  layered(root, s, (g, dx, dy, grow, color, alpha) => {
    g.beginFill(color, alpha);
    g.drawPolygon(ridge(grow, dx * 0.6, dy * 1.2));
    g.endFill();
  }, { shadow: 0.42, lift: 0.7 });
  // Рябь: короткие светлые и тёмные чёрточки поперёк гряды.
  const ripple = new PIXI.Graphics();
  const waves = 3 + Math.floor(rnd() * 2);
  for (let k = 0; k < waves; k++) {
    const t = 0.25 + 0.5 * (k / (waves - 1)) + (rnd() - 0.5) * 0.08, x = -len + 2 * len * t;
    const y = bend * Math.sin(Math.PI * t), h = wide * 0.7 * Math.sin(Math.PI * t);
    ripple.lineStyle(s * 0.02, 0xb9c7dc, 0.22);
    ripple.moveTo(x, y - h).quadraticCurveTo(x + s * 0.05, y, x, y + h * 0.7);
  }
  softLayer(root, ripple, s * 0.015);
  grains(root, s, rnd, [{ x: len * 0.6, y: bend * 0.5, r: wide }, { x: len * 0.9, y: 0, r: wide * 0.6 }], 16, 1.6, 0.5);
}

/** Серп: снег намело рогами по ветру — выпуклой стороной к нему. */
function crescent(root, s, rnd) {
  const r = s * (0.36 + 0.06 * rnd()), cut = r * (0.55 + 0.15 * rnd());
  const n = 36;
  const horn = (grow, dx, dy) => {
    const pts = [];
    // Наружная дуга (наветренная, слева) и внутренняя — сдвинутая вправо.
    for (let i = 0; i <= n; i++) {
      const a = Math.PI * 0.5 + Math.PI * (i / n);
      pts.push(Math.cos(a) * r * grow * 0.95 + dx, Math.sin(a) * r * grow + dy);
    }
    for (let i = n; i >= 0; i--) {
      const a = Math.PI * 0.5 + Math.PI * (i / n);
      pts.push(Math.cos(a) * cut * grow * 0.7 + r * 0.32 + dx, Math.sin(a) * r * 0.74 * grow + dy);
    }
    return pts;
  };
  layered(root, s, (g, dx, dy, grow, color, alpha) => {
    g.beginFill(color, alpha);
    g.drawPolygon(horn(grow, dx, dy));
    g.endFill();
  }, { shadow: 0.5, lift: 1 });
  grains(root, s, rnd, [{ x: r * 0.35, y: -r * 0.8, r: r * 0.2 }, { x: r * 0.35, y: r * 0.8, r: r * 0.2 }], 14, 1.2, 1);
}

/** Горсть комков: снег слетел с ветки — мелкие кучки врозь, у каждой своя тень. */
function clumps(root, s, rnd) {
  const lumps = [];
  const n = 5 + Math.floor(rnd() * 4);
  for (let k = 0; k < n; k++) {
    const a = rnd() * Math.PI * 2, d = s * 0.38 * Math.sqrt(rnd());
    lumps.push({ x: Math.cos(a) * d, y: Math.sin(a) * d * 0.8, r: s * (0.05 + 0.07 * rnd()) });
  }
  layered(root, s, (g, dx, dy, grow, color, alpha) => {
    g.beginFill(color, alpha);
    for (const l of lumps) g.drawPolygon(blob(l.x + dx * 0.5, l.y + dy * 0.5, l.r * grow, rnd, 0.85, 20));
    g.endFill();
  }, { shadow: 0.45, lift: 0.5 });
  grains(root, s, rnd, lumps, 24, 1.3, 0.85);
}

/** Пороша: тонкий налёт без высоты — пятно сквозит, тени почти нет, крупы много. */
function dusting(root, s, rnd) {
  const lumps = [];
  for (let k = 0; k < 4; k++) lumps.push({ x: (rnd() - 0.5) * s * 0.5, y: (rnd() - 0.5) * s * 0.35, r: s * (0.16 + 0.1 * rnd()) });
  const film = new PIXI.Graphics();
  film.beginFill(0xeef3fb, 0.32);
  for (const l of lumps) film.drawPolygon(blob(l.x, l.y, l.r, rnd, 0.7, 30));
  film.endFill();
  softLayer(root, film, s * 0.07);
  grains(root, s, rnd, lumps, 60, 1.0, 0.7);
}

/**
 * Виды сугробов: как рисовать, сколько текстур, как часто (в обычный снег и в
 * метель), размер в клетках, ложится ли по ветру.
 */
const KINDS = [
  { draw: drift, n: 4, weight: [30, 26], size: [0.3, 0.75], along: false },
  { draw: mound, n: 3, weight: [18, 14], size: [0.25, 0.55], along: false },
  { draw: streak, n: 3, weight: [10, 20], size: [0.6, 1.15], along: true },
  { draw: crescent, n: 2, weight: [8, 12], size: [0.4, 0.8], along: true },
  { draw: clumps, n: 3, weight: [16, 8], size: [0.35, 0.7], along: false },
  { draw: dusting, n: 2, weight: [18, 20], size: [0.55, 1.1], along: false }
];

function texturesReady() {
  if (textures && !textures[0].tex.destroyed) return;
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  textures = KINDS.flatMap((kind) => Array.from({ length: kind.n }, () => ({ kind, tex: bake((g, s) => kind.draw(g, s, rnd), 64) })));
}

/** Все виды сугробов рядом — посмотреть: `api.driftSheet()` в консоли даёт картинку. */
export function driftSheet() {
  texturesReady();
  const sheet = new PIXI.Container();
  textures.forEach((t, i) => {
    const sp = new PIXI.Sprite(t.tex);
    sp.position.set((i % 6) * 140 + 70, Math.floor(i / 6) * 140 + 70);
    sp.anchor.set(0.5);
    sheet.addChild(sp);
  });
  return sheet;
}

/** Какой сугроб: по весам вида, в метель — свои веса. */
function pickTexture(power) {
  const i = power > 1.5 ? 1 : 0;
  const total = KINDS.reduce((sum, k) => sum + k.weight[i], 0);
  let r = Math.random() * total;
  const kind = KINDS.find((k) => (r -= k.weight[i]) < 0) ?? KINDS[0];
  const own = textures.filter((t) => t.kind === kind);
  return own[Math.floor(Math.random() * own.length)];
}

function spawnDrift(view, grid, list, power) {
  const r = canvas.dimensions.sceneRect;
  for (let tries = 0; tries < 6; tries++) {
    const x = view.l + Math.random() * (view.r - view.l);
    const y = view.t + Math.random() * (view.b - view.t);
    if (!r.contains(x, y)) continue;
    if (surfaceAt(x, y) || underRoof(x, y, list)) continue;
    const { kind, tex } = pickTexture(power);
    const s = new PIXI.Sprite(tex);
    s.anchor.set(0.5);
    s.position.set(x, y);
    // Намёт и серп — по ветру; бугры — как легли, но тоже больше вдоль него.
    s.rotation = kind.along ? wind + (Math.random() - 0.5) * 0.35 : wind + (Math.random() - 0.5) * 1.6;
    if (Math.random() < 0.5 && !kind.along) s.scale.y = -1;
    s.tint = Math.random() < 0.5 ? 0xffffff : 0xeef3ff;
    s.alpha = 0;
    drifts.addChild(s);
    const [lo, hi] = kind.size;
    const size = (grid * (lo + Math.random() * (hi - lo))) / 64;
    // Пороша ложится и сходит быстрее, намёт держится дольше.
    const pace = kind.draw === dusting ? 0.7 : kind.along ? 1.3 : 1;
    heaps.push({ s, size, flip: s.scale.y < 0 ? -1 : 1, age: 0, grow: (1.5 + Math.random()) * pace, hold: (3 + Math.random() * 4) * pace, melt: (2 + Math.random() * 1.5) * pace });
    return;
  }
}

function stepDrifts(dt, power) {
  const grid = canvas.grid.size;
  const view = viewRect();
  const cells = ((view.r - view.l) * (view.b - view.t)) / (grid * grid);
  const want = DRIFT_RATE * power * game.settings.get(MODULE_ID, "strength") * (cells / 100) * dt;
  // Дробная часть — с вероятностью: на маленьком экране сугроб раз в несколько секунд.
  let n = Math.floor(want) + (Math.random() < want % 1 ? 1 : 0);
  const list = n ? roofs() : [];
  while (n-- > 0 && heaps.length < DRIFT_CAP) spawnDrift(view, grid, list, power);
  for (let k = heaps.length - 1; k >= 0; k--) {
    const h = heaps[k];
    h.age += dt;
    const end = h.grow + h.hold + h.melt;
    if (h.age >= end) {
      h.s.destroy();
      heaps.splice(k, 1);
      continue;
    }
    // Наметает: растёт из пятнышка. Тает: оседает и бледнеет.
    const g = Math.min(1, h.age / h.grow);
    const m = Math.max(0, (h.age - h.grow - h.hold) / h.melt);
    const k1 = h.size * (0.35 + 0.65 * Math.sqrt(g)) * (1 - 0.25 * m);
    h.s.scale.set(k1, h.flip * k1 * (1 - 0.15 * m));
    h.s.alpha = 0.92 * Math.min(1, g * 1.6) * (1 - m * m);
  }
}

function viewRect() {
  const { width, height } = canvas.app.renderer.screen;
  const m = canvas.stage.worldTransform;
  const a = m.applyInverse(new PIXI.Point(0, 0));
  const b = m.applyInverse(new PIXI.Point(width, height));
  return { l: a.x, t: a.y, r: b.x, b: b.y };
}

/* ------------------------------ Мокрый пол ------------------------------ */

const WET_FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 vPos;
uniform sampler2D uMask;
uniform vec4 uBounds;
uniform float uTime, uGrid, uStrength, uHeavy;
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * noise(p); p = p * 2.03 + vec2(17.1, 9.2); a *= 0.5; }
  return v;
}
vec4 over(vec4 dst, vec3 c, float a) { return vec4(c * a, a) + dst * (1.0 - a); }
// Лужи берут цвет туч поверх пола (а не прибавляют свет): так их видно и на тёмном
// камне, и на светлом песке. Было — прибавка в десятые доли яркости, на тёмном
// камне незаметная.
void main() {
  float m = texture2D(uMask, (vPos - uBounds.xy) / uBounds.zw).r;
  if (m < 0.02) discard;
  vec2 p = vPos / uGrid;
  float t = uTime;
  // Лужи там, где пол ниже: пятна шума. Вокруг них просто мокро.
  float n = fbm(p * 0.3 + 11.0);
  float puddle = smoothstep(0.5, 0.56, n);
  float rim = smoothstep(0.46, 0.5, n) * (1.0 - puddle);
  float damp = smoothstep(0.28, 0.5, n);
  // Отражение неба: медленные светлые и тёмные разводы туч.
  float sky = fbm(p * 0.22 + vec2(t * 0.025, t * 0.012));
  vec3 refl = mix(vec3(0.42, 0.48, 0.56), vec3(0.82, 0.86, 0.92), smoothstep(0.35, 0.7, sky));
  // Мокрое темнее сухого и чуть блестит пятнами.
  vec4 o = vec4(0.0);
  o = over(o, vec3(0.0), 0.12 * damp);
  float gloss = smoothstep(0.55, 0.85, fbm(p * 0.9 + vec2(t * 0.05, 0.0)));
  o.rgb += refl * gloss * damp * 0.06;
  // Лужа — зеркало неба, у края тёмная кайма.
  o = over(o, vec3(0.05, 0.06, 0.07), rim * 0.25);
  o = over(o, refl * 0.85, puddle * 0.42);
  // Круги от капель: в лужах ярко, на мокром — слабо.
  float rings = 0.0;
  for (int k = 0; k < 3; k++) {
    vec2 q = p * (2.2 + float(k) * 1.1) + float(k) * 7.7;
    vec2 cell = floor(q);
    float h = hash(cell);
    float ph = fract(t * (0.7 + 0.5 * h) * uHeavy + h * 13.0);
    vec2 c = cell + 0.2 + 0.6 * vec2(hash(cell + 3.3), hash(cell + 8.1));
    float d = length(q - c);
    float r = 0.04 + ph * 0.32;
    rings += smoothstep(0.035, 0.0, abs(d - r)) * (1.0 - ph) * step(0.3, h);
  }
  o.rgb += refl * rings * (puddle * 0.45 + damp * 0.08);
  // Брызги: короткие светлые точки, на мокром везде.
  vec2 sc = floor(p * 6.0);
  float sh = hash(sc + floor(t * 4.0 * uHeavy));
  vec2 sp = (sc + vec2(hash(sc + 1.1), hash(sc + 2.9))) / 6.0;
  o.rgb += refl * smoothstep(0.035, 0.0, length(p - sp)) * step(0.9, sh) * 0.3 * damp;
  gl_FragColor = o * uStrength * m;
}`;

function wetFloor(heavy) {
  const r = canvas.dimensions.sceneRect;
  const mask = dryMask(r);
  const verts = new Float32Array([r.left, r.top, r.right, r.top, r.right, r.bottom, r.left, r.bottom]);
  const geometry = new PIXI.Geometry().addAttribute("aVertexPosition", verts, 2).addIndex(new Uint16Array([0, 1, 2, 0, 2, 3]));
  const shader = PIXI.Shader.from(VERT, WET_FRAG, {
    uMask: mask, uBounds: new Float32Array([r.x, r.y, r.width, r.height]),
    uTime: Math.random() * 100, uGrid: canvas.grid.size, uHeavy: heavy,
    uStrength: game.settings.get(MODULE_ID, "strength")
  });
  const mesh = new PIXI.Mesh(geometry, shader);
  mesh.name = `${MODULE_ID}.wet`;
  mesh.eventMode = "none";
  mesh.elevation = 0;
  mesh.sortLayer = 1;
  mesh.sort = -1;
  canvas.primary.addChild(mesh);
  return { mesh, mask };
}

/** Белое — куда падает дождь; крыши и вода, лава, болото — чёрные. */
function dryMask(r) {
  const s = MASK_SCALE;
  const w = Math.max(4, Math.ceil(r.width * s)), h = Math.max(4, Math.ceil(r.height * s));
  const rt = PIXI.RenderTexture.create({ width: w, height: h, scaleMode: PIXI.SCALE_MODES.LINEAR });
  const root = new PIXI.Container();
  root.scale.set(s);
  root.position.set(-r.x * s, -r.y * s);
  const sky = root.addChild(new PIXI.Graphics());
  sky.beginFill(0xffffff, 1).drawRect(r.x, r.y, r.width, r.height).endFill();
  // Место, размер и поворот — из документа тайла, не из меша: в хуке
  // `updateScene` (Мастер включил дождь) меш стоит ещё в своих координатах
  // (середина — в половине размера), и лужи выходили в домах.
  for (const t of roofs()) {
    const m = t.mesh;
    if (!m.texture?.valid) continue;
    const d = t.document;
    const sp = root.addChild(new PIXI.Sprite(m.texture));
    sp.anchor.set(0.5, 0.5);
    sp.position.set(d.x, d.y);
    sp.width = d.width;
    sp.height = d.height;
    if ((d.texture?.scaleX ?? 1) < 0) sp.scale.x *= -1;
    if ((d.texture?.scaleY ?? 1) < 0) sp.scale.y *= -1;
    sp.angle = d.rotation ?? 0;
    sp.tint = 0x000000;
  }
  const wet = root.addChild(new PIXI.Graphics());
  wet.beginFill(0x000000, 1);
  for (const reg of canvas.scene.regions) {
    const e = reg.flags?.[MODULE_ID]?.effect;
    if (!["water", "waterfall", "lava", "swamp", "fire", "rift"].includes(e)) continue;
    const tri = reg.triangulation;
    if (!tri?.indices?.length) continue;
    const v = tri.vertices, ix = tri.indices;
    for (let k = 0; k < ix.length; k += 3) {
      const pts = [];
      for (let j = 0; j < 3; j++) pts.push(v[2 * ix[k + j]], v[2 * ix[k + j] + 1]);
      wet.drawPolygon(pts);
    }
  }
  wet.endFill();
  canvas.app.renderer.render(root, { renderTexture: rt, clear: true });
  root.destroy({ children: true });
  return rt;
}

/* ------------------------------ Кадр ------------------------------ */

function tick() {
  const now = performance.now() / 1000;
  const dt = Math.min(0.1, now - last);
  last = now;
  const w = canvas.scene?.weather ?? "";
  if (drifts && !drifts.destroyed) stepDrifts(dt, SNOW[w] ?? 0);
  if (sheen && !sheen.mesh.destroyed) {
    const u = sheen.mesh.shader.uniforms;
    u.uTime += dt;
    u.uStrength = game.settings.get(MODULE_ID, "strength");
  }
}

/* ------------------------------ Настройки ------------------------------ */

export function registerWeather() {
  game.settings.register(MODULE_ID, "groundWeather", {
    name: "BLM.Setting.groundWeather", hint: "BLM.Setting.groundWeatherHint",
    scope: "client", config: true, type: Boolean, default: true,
    onChange: () => rebuildWeather()
  });
  Hooks.on("canvasReady", () => rebuildWeather());
  Hooks.on("canvasTearDown", () => clearWeather());
  Hooks.on("updateScene", (scene, changes) => {
    if (scene === canvas.scene && "weather" in changes) rebuildWeather();
  });
  // Крыши и вода — маска мокрого пола; пересобрать, только если идёт дождь.
  const again = foundry.utils.debounce(() => { if (sheen) rebuildWeather(); }, 300);
  for (const hook of ["createTile", "updateTile", "deleteTile", "createRegion", "updateRegion", "deleteRegion"]) {
    Hooks.on(hook, (doc) => { if (doc.parent === canvas.scene) again(); });
  }
}
