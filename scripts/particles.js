// Частицы от крон: тайлы с пометкой `flags.burn-living-map.particles` (Картограф
// ставит её кронам леса по времени года).
//   leaves    — осенний листопад: лист кружится, переворачивается, падает с тенью,
//               сносится ветром, лежит и тает; в воде — круги, лист плывёт и тонет,
//               в болоте вязнет, в лаве и огне вспыхивает, обугливается и осыпается;
//   fireflies — в магическом лесу у крон бродят и мерцают светлячки.
// Снег зимнего леса — погода самого Foundry (её ставит Картограф), не здесь.
// Токены в областях «Wild Canvas»: в воде — брызги при входе, круги следом на ходу
// и изредка стоя; в болоте — мутные круги и пузыри; лава густая — кругов нет: под
// токеном проступает раскалённое, расходится тёмная корка, следы остывают; в лаве
// и огне токен горит — кольцо пламени шейдером (`TOKEN_FIRE`), дым, искры.
// Всё рисует каждый игрок у себя, документы не меняются. Частицы в основной группе
// холста: листья и искры над токенами, круги и тени — на земле под ними; туман
// войны и зрение прячут и то и другое.

import { wind } from "./wind.js";
import { VERT, TOKEN_FIRE } from "./shaders.js";

const MODULE_ID = "burn-living-map";
const KINDS = ["leaves", "fireflies"];
const ABOVE_TOKENS = 800;
/** Круги и тени: выше тайлов пола, ниже токенов (у токенов 700). */
const UNDER_TOKENS = 650;
const WET = ["water", "waterfall", "fountain", "swamp", "lava", "fire"];
/** Сколько частиц живёт одновременно при густоте 1, на всю сцену. */
const CAP = 240;

/** Сколько в секунду выпускает одна крона при густоте 1. */
const RATE = { leaves: 0.3, fireflies: 0.22 };
/** Половина размера текстуры листа: рисуется крупно, на сцене уменьшается. */
const LEAF = 40;

const AUTUMN = [0xd9622b, 0xe8a33a, 0xc8452c, 0xb5762e, 0xf0c04a];

/** @type {{tile: Tile, kind: string, colors: number[]|null, acc: number}[]} */
let sources = [];
/** @type {PIXI.Container|null} */
let layer = null;
/** Тени листьев и круги на земле под токенами; листья и искры над ними. */
let ground = null, under = null, over = null;
/** Свет светлячков: над освещением Foundry (тьма сцены его не гасит), под туманом войны. */
let shine = null;
/** Есть ли на сцене области, в которые можно ступить. */
let wet = false;
/** Токены, что сейчас в воде и прочем: id → где стоят и сколько прошли. */
const walkers = new Map();
/** @type {{sprite: PIXI.Sprite, src: object, age: number, life: number, [k: string]: any}[]} */
const live = [];
const pool = [];
const textures = {};
const tones = new Map();
let ticking = false;

function kindOf(doc) {
  const k = doc.flags?.[MODULE_ID]?.particles;
  return KINDS.includes(k) ? k : null;
}

function density() {
  if (!game.settings.get(MODULE_ID, "enabled")) return 0;
  return game.settings.get(MODULE_ID, "treeParticles");
}

/* ------------------------------ Текстуры ------------------------------ */

function bake(draw, size) {
  const g = new PIXI.Graphics();
  draw(g, size);
  const tex = canvas.app.renderer.generateTexture(g, {
    resolution: 1, multisample: PIXI.MSAA_QUALITY.HIGH,
    region: new PIXI.Rectangle(-size, -size, size * 2, size * 2)
  });
  g.destroy();
  return tex;
}

/**
 * Лист по половинке ширины w(t), t от черенка (0) к кончику (1): левая половина
 * светлее, правая в тени, по краю тонкий тёмный кант, жилки и черенок темнее —
 * текстура белая, цвет даёт tint, так что тёмное становится тёмным оттенком листа.
 */
function leafShape(g, s, w, veins) {
  const N = 48;
  const L = s * 0.82, base = s * 0.92;
  const pt = (t, side) => [side * w(t) * s, base - t * (L + base * 0.9)];
  const left = [], right = [];
  for (let k = 0; k <= N; k++) {
    left.push(...pt(k / N, -1));
    right.push(...pt(k / N, 1));
  }
  const tipY = base - (L + base * 0.9);
  const outline = [...left];
  for (let k = right.length - 2; k >= 0; k -= 2) outline.push(right[k], right[k + 1]);
  // Тело листа.
  g.lineStyle(s * 0.05, 0x5a5a5a, 0.55);
  g.beginFill(0xffffff, 1);
  g.drawPolygon(outline);
  g.endFill();
  // Правая половина в тени.
  const shade = [0, base];
  for (let k = 0; k < right.length; k += 2) shade.push(right[k], right[k + 1]);
  shade.push(0, tipY);
  g.lineStyle(0);
  g.beginFill(0x000000, 0.16);
  g.drawPolygon(shade);
  g.endFill();
  // Средняя жилка и черенок.
  g.lineStyle(s * 0.06, 0x3a3a3a, 0.45);
  g.moveTo(0, base + s * 0.06);
  g.lineTo(0, tipY + s * 0.12);
  g.lineStyle(s * 0.07, 0x4a4a4a, 0.9);
  g.moveTo(0, base);
  g.quadraticCurveTo(s * 0.04, base + s * 0.05, s * 0.02, s);
  // Боковые жилки.
  g.lineStyle(s * 0.03, 0x3a3a3a, 0.3);
  for (const t of veins) {
    const [, y] = pt(t, 1);
    for (const side of [-1, 1]) {
      const [ex, ey] = pt(Math.min(1, t + 0.12), side);
      g.moveTo(0, y);
      g.lineTo(ex * 0.78, ey);
    }
  }
}

function leafTextures() {
  const ovate = (t) => 0.42 * Math.pow(Math.sin(Math.PI * Math.min(1, t * 0.95 + 0.03)), 0.85) * (1 - 0.25 * t);
  const oak = (t) => {
    const lobes = 0.78 + 0.22 * Math.cos(t * Math.PI * 2 * 3.5);
    return 0.4 * Math.pow(Math.sin(Math.PI * Math.min(1, t * 0.96 + 0.02)), 0.7) * lobes;
  };
  const birch = (t) => {
    const teeth = 1 - 0.06 * Math.abs(Math.sin(t * Math.PI * 14));
    return 0.36 * Math.pow(Math.sin(Math.PI * Math.min(1, t * 0.97 + 0.02)), 0.6) * (1 - 0.35 * t) * teeth;
  };
  const vein = [0.2, 0.38, 0.56, 0.72];
  return [
    bake((g, s) => leafShape(g, s, ovate, vein), LEAF),
    bake((g, s) => leafShape(g, s, oak, [0.25, 0.53, 0.8]), LEAF),
    bake((g, s) => leafShape(g, s, birch, vein), LEAF),
    bake(maple, LEAF)
  ];
}

/** Кленовый: пять лопастей звездой, жилки из черенка к каждой. */
function maple(g, s) {
  const pts = [];
  const N = 120;
  for (let k = 0; k < N; k++) {
    const a = (k / N) * Math.PI * 2;
    // Лопасти через 72°, главная вверх; у черенка выемка.
    const u = a - Math.PI / 2;
    const lobe = Math.pow(Math.abs(Math.cos(u * 2.5)), 1.6);
    const teeth = 1 - 0.07 * Math.abs(Math.sin(u * 15));
    const d = Math.atan2(Math.sin(a - Math.PI * 1.5), Math.cos(a - Math.PI * 1.5));
    const notch = 1 - 0.55 * Math.exp(-d * d * 8);
    const r = s * (0.42 + 0.48 * lobe) * teeth * notch;
    pts.push(Math.cos(a) * r, -Math.sin(a) * r);
  }
  g.lineStyle(s * 0.05, 0x5a5a5a, 0.55);
  g.beginFill(0xffffff, 1);
  g.drawPolygon(pts);
  g.endFill();
  g.lineStyle(0);
  g.beginFill(0x000000, 0.14);
  g.drawPolygon([0, 0, ...pts.slice(N * 0.75 * 2 - 2), ...pts.slice(0, N * 0.25 * 2 + 2)]);
  g.endFill();
  g.lineStyle(s * 0.045, 0x3a3a3a, 0.4);
  for (let j = 0; j < 5; j++) {
    const a = Math.PI / 2 + (j * Math.PI * 2) / 5;
    g.moveTo(0, 0);
    g.lineTo(Math.cos(a) * s * 0.78, -Math.sin(a) * s * 0.78);
  }
  g.lineStyle(s * 0.07, 0x4a4a4a, 0.9);
  g.moveTo(0, 0);
  g.quadraticCurveTo(s * 0.05, s * 0.5, s * 0.02, s * 0.98);
}

function texturesReady() {
  if (textures.leaves && !textures.leaves[0].destroyed) return;
  textures.leaves = leafTextures();
  // Язык пламени: капля острием вверх, яркая серединка; основание у низа текстуры.
  textures.flame = bake((g, s) => {
    for (let k = 7; k >= 1; k--) {
      const w = (s * 0.55 * k) / 7, top = -s * (0.15 + (0.75 * k) / 7);
      g.beginFill(0xffffff, k <= 2 ? 0.35 : 0.13);
      g.moveTo(0, top);
      g.bezierCurveTo(w * 0.9, top * 0.35, w * 1.3, s * 0.55, 0, s * 0.62);
      g.bezierCurveTo(-w * 1.3, s * 0.55, -w * 0.9, top * 0.35, 0, top);
      g.endFill();
    }
  }, 32);
  // Мягкое пятно: дым и жар, без чёткой серединки.
  textures.soft = bake((g, s) => {
    for (let k = 12; k >= 1; k--) {
      g.beginFill(0xffffff, 0.07);
      g.drawCircle(0, 0, (s * k) / 12);
      g.endFill();
    }
  }, 32);
  // Круг на воде: тонкое кольцо и за ним кольцо бледнее.
  textures.ripple = bake((g, s) => {
    g.lineStyle(s * 0.07, 0xffffff, 0.9);
    g.drawCircle(0, 0, s * 0.9);
    g.lineStyle(s * 0.05, 0xffffff, 0.4);
    g.drawCircle(0, 0, s * 0.68);
  }, 32);
  // Светлячок: яркая серединка и широкое свечение (и для брызг с искрами).
  textures.fireflies = bake((g, s) => {
    for (let k = 8; k >= 1; k--) {
      g.beginFill(0xffffff, k === 1 ? 1 : 0.07);
      g.drawCircle(0, 0, (s * k) / 8);
      g.endFill();
    }
  }, 16);
  // Ореол фонарика: широкий, без чёткой серединки — плавно гаснет к краю.
  textures.halo = bake((g, s) => {
    for (let k = 16; k >= 1; k--) {
      g.beginFill(0xffffff, 0.05 + (k <= 4 ? 0.12 : 0));
      g.drawCircle(0, 0, (s * k) / 16);
      g.endFill();
    }
  }, 32);
  // Жучок сверху, головой вправо: голова, грудка с рыжим щитком, надкрылья,
  // прозрачные крылья, брюшко-фонарик светлое — его красит tint и светит ореол.
  textures.bug = bake((g, s) => {
    g.beginFill(0xffffff, 0.28);
    g.drawEllipse(-s * 0.05, -s * 0.42, s * 0.42, s * 0.2);
    g.drawEllipse(-s * 0.05, s * 0.42, s * 0.42, s * 0.2);
    g.endFill();
    g.beginFill(0xfffbe0, 1);
    g.drawEllipse(-s * 0.48, 0, s * 0.3, s * 0.2);
    g.endFill();
    g.beginFill(0x2a2418, 1);
    g.drawEllipse(-s * 0.02, 0, s * 0.36, s * 0.22);
    g.endFill();
    g.lineStyle(s * 0.03, 0x14100a, 1);
    g.moveTo(-s * 0.3, 0);
    g.lineTo(s * 0.3, 0);
    g.lineStyle(0);
    g.beginFill(0xc2582a, 1);
    g.drawEllipse(s * 0.38, 0, s * 0.13, s * 0.16);
    g.endFill();
    g.beginFill(0x1a1610, 1);
    g.drawCircle(s * 0.52, 0, s * 0.08);
    g.endFill();
    g.lineStyle(s * 0.025, 0x1a1610, 0.9);
    g.moveTo(s * 0.56, -s * 0.04);
    g.lineTo(s * 0.74, -s * 0.16);
    g.moveTo(s * 0.56, s * 0.04);
    g.lineTo(s * 0.74, s * 0.16);
  }, 32);
}

/**
 * Цвета листьев из самой кроны: картинка тайла ужимается до 8×8, берутся
 * непрозрачные и не серые точки. Не вышло — осенняя палитра.
 */
function crownTones(tile) {
  const src = tile.document.texture?.src ?? "";
  if (tones.has(src)) return tones.get(src);
  let out = AUTUMN;
  try {
    const tex = tile.mesh?.texture;
    if (tex?.valid) {
      const rt = PIXI.RenderTexture.create({ width: 8, height: 8 });
      const sp = new PIXI.Sprite(tex);
      sp.width = 8;
      sp.height = 8;
      canvas.app.renderer.render(sp, { renderTexture: rt, clear: true });
      const px = canvas.app.renderer.extract.pixels(rt);
      sp.destroy();
      rt.destroy(true);
      const picks = [];
      for (let k = 0; k < px.length; k += 4) {
        const a = px[k + 3];
        if (a < 160) continue;
        // Пиксели премноженные: вернуть цвет.
        const [r, g, b] = [px[k], px[k + 1], px[k + 2]].map((v) => Math.min(255, (v * 255) / a));
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        if (max < 60 || max - min < 35) continue;
        // Чуть светлее кроны: лист в полёте на свету.
        const lift = (v) => Math.min(255, Math.round(v * 1.15 + 12));
        picks.push((lift(r) << 16) | (lift(g) << 8) | lift(b));
      }
      if (picks.length >= 4) out = picks;
    }
  } catch (err) {
    console.warn(`${MODULE_ID} | could not read the crown colour`, err);
  }
  tones.set(src, out);
  return out;
}

/* ------------------------------ Сборка ------------------------------ */

export function rebuildParticles() {
  clearParticles();
  if (!canvas.ready || !canvas.tiles || !canvas.primary) return;
  sources = canvas.tiles.placeables
    .map((tile) => ({ tile, kind: kindOf(tile.document), colors: null, acc: Math.random() }))
    .filter((s) => s.kind);
  wet = (canvas.scene?.regions ?? []).some((r) => WET.includes(r.flags?.[MODULE_ID]?.effect));
  if (!sources.length && !wet) return;
  build();
}

/** Слои частиц и тикер. */
function build() {
  texturesReady();
  layer = new PIXI.Container();
  layer.name = `${MODULE_ID}.particles`;
  layer.eventMode = "none";
  layer.elevation = Math.max(0, ...sources.map((s) => s.tile.document.elevation ?? 0));
  layer.sortLayer = ABOVE_TOKENS;
  layer.sort = 1;
  over = layer.addChild(new PIXI.Container());
  ground = new PIXI.Container();
  ground.name = `${MODULE_ID}.ground`;
  ground.eventMode = "none";
  ground.elevation = 0;
  ground.sortLayer = UNDER_TOKENS;
  ground.sort = 1;
  under = ground.addChild(new PIXI.Container());
  canvas.primary.addChild(ground);
  canvas.primary.addChild(layer);
  shine = new PIXI.Container();
  shine.name = `${MODULE_ID}.shine`;
  shine.eventMode = "none";
  canvas.environment.addChild(shine);
  canvas.primary.sortDirty = true;
  if (!ticking) {
    canvas.app.ticker.add(step);
    ticking = true;
  }
}

/** Листья или светлячки с кроны — меша Boundless под видом тайла (см. boundless.js). */
export function addParticles(tile) {
  const kind = kindOf(tile.document);
  if (!kind || !tile.mesh || !canvas.ready || !canvas.primary || sources.some((s) => s.tile.id === tile.id)) return;
  sources.push({ tile, kind, colors: null, acc: Math.random() });
  if (!layer || layer.destroyed) return build();
  const e = tile.document.elevation ?? 0;
  if (e > layer.elevation) {
    layer.elevation = e;
    canvas.primary.sortDirty = true;
  }
}

/** Крона ушла: новых частиц нет, вылетевшие догорают сами. */
export function dropParticles(id) {
  sources = sources.filter((s) => s.tile.id !== id);
}

export const particleKeys = () => sources.map((s) => s.tile.id);

export function clearParticles() {
  for (const p of live) {
    p.sprite.destroy();
    p.shadow?.destroy();
    for (const s of p.parts ?? []) s.destroy();
  }
  live.length = 0;
  for (const s of pool) s.destroy();
  pool.length = 0;
  if (layer && !layer.destroyed) layer.destroy({ children: true });
  if (ground && !ground.destroyed) ground.destroy({ children: true });
  if (shine && !shine.destroyed) shine.destroy({ children: true });
  layer = ground = under = over = shine = null;
  sources = [];
  for (const w of walkers.values()) quench(w);
  walkers.clear();
  wet = false;
}

/**
 * Что под точкой: эффект области «Wild Canvas» (вода, болото, лава, огонь) или
 * null — земля. Вырез (мост) сверху — тоже земля.
 */
export function surfaceAt(x, y) {
  let found = null;
  for (const r of canvas.scene?.regions ?? []) {
    const e = r.flags?.[MODULE_ID]?.effect;
    if (!["water", "waterfall", "fountain", "swamp", "lava", "fire", "cut"].includes(e)) continue;
    let inside = false;
    try {
      inside = r.polygonTree?.testPoint({ x, y }) ?? false;
    } catch {
      inside = false;
    }
    if (!inside) continue;
    if (e === "cut") return null;
    found ??= e === "waterfall" || e === "fountain" ? "water" : e;
  }
  return found;
}

/** Круг по воде от точки: растёт и гаснет; `delay` — позже первого. */
function ripple(src, x, y, grid, { size = 0.45, delay = 0, alpha = 0.45, tint = 0xffffff, add = false, life = 1.8, from = 0.25 } = {}) {
  const s = sprite(textures.ripple, under, add);
  s.tint = tint;
  s.position.set(x, y);
  live.push({ src, kind: "ripple", sprite: s, age: -delay, life, x, y, size: (grid * size) / 32, peak: alpha, from });
}

/** Видимая часть сцены с запасом: за экраном ничего не выпускаем. */
function viewRect() {
  const { width, height } = canvas.app.renderer.screen;
  const m = canvas.stage.worldTransform;
  const a = m.applyInverse(new PIXI.Point(0, 0));
  const b = m.applyInverse(new PIXI.Point(width, height));
  const pad = canvas.grid.size * 3;
  return { l: a.x - pad, t: a.y - pad, r: b.x + pad, b: b.y + pad };
}

/* ------------------------------ Кадр ------------------------------ */

function step() {
  if (!layer || layer.destroyed || !canvas.ready) {
    canvas.app?.ticker.remove(step);
    ticking = false;
    return;
  }
  const dt = Math.min(canvas.app.ticker.deltaMS / 1000, 0.1);
  const d = density();
  const grid = canvas.grid.size;
  const air = wind();
  const view = viewRect();
  const t = performance.now() / 1000;

  if (d > 0) {
    const cap = CAP * d;
    for (const s of sources) {
      const doc = s.tile.document;
      const { x, y, width, height } = doc;
      // У Картографа x, y тайла — середина (anchor 0.5); у своих тайлов — угол.
      const cx = (doc.texture?.anchorX ?? 0) === 0.5 ? x : x + width / 2;
      const cy = (doc.texture?.anchorY ?? 0) === 0.5 ? y : y + height / 2;
      if (cx < view.l || cx > view.r || cy < view.t || cy > view.b) continue;
      if (!s.tile.mesh?.visible || !s.tile.visible) continue;
      s.acc += dt * RATE[s.kind] * d * Math.sqrt(Math.max(width, height) / (grid * 4));
      while (s.acc >= 1 && live.length < cap) {
        s.acc -= 1;
        spawn(s, cx, cy, Math.min(width, height) / 2, grid);
      }
      if (s.acc > 1) s.acc = 1;
    }
  }
  if (wet && game.settings.get(MODULE_ID, "enabled") && game.settings.get(MODULE_ID, "tokenSplash")) wade(dt, grid);

  for (let k = live.length - 1; k >= 0; k--) {
    const p = live[k];
    p.age += dt;
    if (p.age >= p.life || !p.src.tile.mesh || p.src.tile.mesh.destroyed) {
      retire(k);
      continue;
    }
    move(p, dt, t, air, grid);
    p.sprite.visible = p.src.tile.visible && p.src.tile.mesh.visible;
    if (p.shadow) p.shadow.visible = p.sprite.visible;
    for (const s of p.parts ?? []) s.visible = p.sprite.visible;
  }
}

function sprite(texture, parent, add = false) {
  const s = pool.pop() ?? new PIXI.Sprite();
  s.texture = texture;
  s.anchor.set(0.5);
  s.blendMode = add ? PIXI.BLEND_MODES.ADD : PIXI.BLEND_MODES.NORMAL;
  s.alpha = 0;
  s.rotation = 0;
  s.visible = true;
  parent.addChild(s);
  return s;
}

function retire(k) {
  const p = live[k];
  live.splice(k, 1);
  for (const s of [p.sprite, p.shadow, ...(p.parts ?? [])]) {
    if (!s) continue;
    s.parent?.removeChild(s);
    pool.push(s);
  }
}

/** Смесь двух цветов: f = 0 — первый, 1 — второй. */
function mix(a, b, f) {
  f = Math.max(0, Math.min(1, f));
  const ch = (c, s) => (c >> s) & 255;
  const m = (s) => Math.round(ch(a, s) + (ch(b, s) - ch(a, s)) * f);
  return (m(16) << 16) | (m(8) << 8) | m(0);
}

/** Цвет темнее или светлее в k раз. */
function shade(c, k) {
  const f = (v) => Math.max(0, Math.min(255, Math.round(v * k)));
  return (f(c >> 16) << 16) | (f((c >> 8) & 255) << 8) | f(c & 255);
}

function spawn(src, cx, cy, radius, grid) {
  const kind = src.kind;
  const a = Math.random() * Math.PI * 2;
  const p = { src, kind, age: 0, seed: Math.random() * 100 };
  if (kind === "leaves") {
    const tex = textures.leaves[Math.floor(Math.random() * textures.leaves.length)];
    p.shadow = sprite(tex, under);
    p.shadow.tint = 0x000000;
    p.sprite = sprite(tex, over);
    // С края и из глубины кроны, а не из самой середины.
    const r = radius * (0.35 + 0.6 * Math.sqrt(Math.random()));
    src.colors ??= crownTones(src.tile);
    p.x = cx + Math.cos(a) * r;
    p.y = cy + Math.sin(a) * r;
    p.fall = 4 + Math.random() * 3;
    p.life = p.fall + 2.5;
    p.size = grid * (0.15 + Math.random() * 0.07) / LEAF;
    p.spin = (Math.random() < 0.5 ? -1 : 1) * (0.6 + Math.random() * 1.4);
    p.flip = 1.2 + Math.random() * 1.2;
    // Свой оттенок у каждого листа, изнанка бледнее.
    const c = shade(src.colors[Math.floor(Math.random() * src.colors.length)], 0.85 + Math.random() * 0.3);
    p.front = c;
    p.back = shade(c, 1.18);
    p.sprite.tint = c;
    p.sprite.rotation = Math.random() * Math.PI * 2;
  } else {
    // Светлячок из четырёх частей: ореол в воздухе, жучок, искра фонарика и
    // отсвет на земле под ним — отсвет сдвинут от жучка на его высоту.
    p.sprite = sprite(textures.halo, shine, true);
    p.glow = sprite(textures.soft, shine, true);
    p.bug = sprite(textures.bug, over);
    p.lamp = sprite(textures.fireflies, shine, true);
    p.parts = [p.glow, p.bug, p.lamp];
    // Светлячки бродят под кроной и вокруг неё.
    const r = radius * (0.3 + 0.9 * Math.random());
    p.x = cx + Math.cos(a) * r;
    p.y = cy + Math.sin(a) * r;
    p.life = 9 + Math.random() * 8;
    p.size = (grid * (0.55 + Math.random() * 0.3)) / 32;
    p.color = Math.random() < 0.7 ? 0xd8ff6a : Math.random() < 0.5 ? 0x9fe8ff : 0xffd27a;
    for (const s of [p.sprite, p.glow, p.lamp]) s.tint = p.color;
    p.bug.tint = mix(0xffffff, p.color, 0.6);
    p.heading = Math.random() * Math.PI * 2;
    // Высота над землёй в клетках и когда вспыхнуть; бывает двойная вспышка.
    p.h = 0.35 + Math.random() * 0.5;
    p.flash = Math.random() * 2;
    p.lit = 0;
    p.hover = 0;
  }
  p.sprite.scale.set(p.size);
  p.sprite.position.set(p.x, p.y);
  live.push(p);
}

const ease = (v) => Math.max(0, Math.min(1, v));

function move(p, dt, t, air, grid) {
  const s = p.sprite;
  const push = air.force * grid;
  if (p.kind === "leaves") {
    if (p.age < p.fall) {
      // Падает: сносит ветром, качает поперёк него, кружит и переворачивает.
      const f = p.age / p.fall;
      const side = Math.sin(p.age * 2.1 + p.seed) * grid * 0.35;
      const gust = 0.6 + 0.4 * Math.sin(t * 0.7 + p.seed);
      p.x += (air.dx * push * 0.32 * gust) * dt;
      p.y += (air.dy * push * 0.32 * gust + grid * 0.12) * dt;
      const lx = p.x - air.dy * side, ly = p.y + air.dx * side;
      s.position.set(lx, ly);
      // Кружит быстрее на размахе качания, медленнее в крайних точках.
      s.rotation += p.spin * dt * (0.6 + 0.8 * Math.abs(Math.cos(p.age * 2.1 + p.seed)));
      // Переворачивается: ширина идёт через ноль, изнанка бледнее.
      const turn = Math.cos(p.age * p.flip + p.seed);
      s.tint = turn >= 0 ? p.front : p.back;
      // Ближе к земле — меньше: лист опускается из кроны.
      const k = p.size * (1.3 - 0.3 * f);
      s.scale.set(k * (0.25 + 0.75 * Math.abs(turn)), k);
      s.alpha = ease(p.age / 0.6);
      // Тень на земле: чем выше лист, тем дальше и бледнее.
      const h = (1 - f) * grid * 0.9;
      const sh = p.shadow;
      sh.position.set(lx + h * 0.35, ly + h * 0.6);
      sh.rotation = s.rotation;
      sh.scale.copyFrom(s.scale);
      sh.alpha = s.alpha * (0.12 + 0.2 * f);
    } else {
      if (p.surface === undefined) land(p, grid);
      if (p.surface === "water" || p.surface === "swamp") float(p, dt, t, air, grid);
      else if (p.surface === "lava" || p.surface === "fire") {
        // Сгорает: край рыжеет, лист чернеет и сворачивается, осыпается пеплом.
        const f = ease((p.age - p.fall) / (p.life - p.fall));
        s.tint = f < 0.25 ? mix(p.front, 0xff9a3a, f / 0.25) : f < 0.6 ? mix(0xff9a3a, 0x2a1d14, (f - 0.25) / 0.35) : mix(0x2a1d14, 0x6a625a, (f - 0.6) / 0.4);
        s.scale.set(p.size * (1 - 0.45 * f), p.size * (1 - 0.6 * f * f));
        s.rotation += Math.sin(p.age * 9 + p.seed) * 0.4 * dt;
        s.alpha = f < 0.7 ? 1 : 1 - (f - 0.7) / 0.3;
        p.shadow.alpha = 0;
        // Пока горит — новые огоньки над ним.
        p.lick = (p.lick ?? 0) - dt;
        if (f < 0.55 && p.lick <= 0) {
          p.lick = 0.12;
          flame(p.src, s.x + (Math.random() - 0.5) * grid * 0.08, s.y, grid, 0.12 + Math.random() * 0.06);
        }
      } else {
        // Лёг на землю лицом вверх и тает.
        s.tint = p.front;
        s.scale.set(p.size, p.size);
        s.alpha = 1 - ease((p.age - p.fall) / (p.life - p.fall));
        p.shadow.position.set(s.x + grid * 0.015, s.y + grid * 0.02);
        p.shadow.scale.copyFrom(s.scale);
        p.shadow.alpha = s.alpha * 0.3;
      }
    }
  } else if (p.kind === "drop") {
    // Брызга: летит дугой и падает обратно.
    p.vh -= grid * 6 * dt;
    p.h += p.vh * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    s.position.set(p.x, p.y - Math.max(0, p.h));
    s.alpha = p.peak * ease(p.age / 0.05);
    if (p.h < 0 && p.vh < 0) {
      p.age = p.life;
      if (p.surface === "water") ripple(p.src, p.x, p.y, grid, { size: 0.08, alpha: 0.3 });
    }
  } else if (p.kind === "spark") {
    // Искра: взлетает, сносится ветром, мерцает и гаснет.
    p.x += (p.vx + air.dx * push * 0.15) * dt;
    p.y += (p.vy + air.dy * push * 0.15) * dt;
    p.vy -= grid * 0.15 * dt;
    s.position.set(p.x, p.y);
    const f = p.age / p.life;
    s.tint = f < 0.4 ? 0xffd070 : f < 0.75 ? 0xff8a2a : 0xd0401a;
    s.alpha = (0.6 + 0.4 * Math.sin(p.age * 30 + p.seed)) * (1 - f);
    s.scale.set(p.size * (1 - 0.5 * f));
  } else if (p.kind === "flame") {
    // Язык пламени: вытягивается вверх, дрожит, желтеет → краснеет и гаснет.
    const f = p.age / p.life;
    p.y -= grid * 0.35 * p.k * dt;
    p.x += (air.dx * push * 0.1 + Math.sin(p.age * 18 + p.seed) * grid * 0.25 * p.k) * dt;
    s.position.set(p.x, p.y);
    s.tint = f < 0.25 ? mix(0xffd070, 0xff8a20, f / 0.25) : mix(0xff8a20, 0xb8200a, (f - 0.25) / 0.75);
    const flick = 0.85 + 0.3 * Math.sin(p.age * 25 + p.seed * 2);
    s.scale.set(p.size * (1.1 - 0.5 * f) * flick, p.size * (0.6 + 0.5 * Math.sin(Math.PI * Math.min(1, f * 1.3))));
    s.alpha = 0.95 * ease(p.age / 0.06) * (1 - f * f);
  } else if (p.kind === "smoke") {
    if (p.age < 0) {
      s.alpha = 0;
      return;
    }
    // Дым: поднимается, расплывается, сносится ветром.
    const f = p.age / p.life;
    p.x += (air.dx * push * 0.3 + Math.sin(p.age + p.seed) * grid * 0.05) * dt;
    p.y += (air.dy * push * 0.3 - grid * 0.25) * dt;
    s.position.set(p.x, p.y);
    s.scale.set(p.size * (1 + 1.8 * f));
    s.alpha = p.peak * Math.sin(Math.PI * Math.min(1, f * 1.15));
  } else if (p.kind === "glow") {
    // Жар: раскалённое пятно, остывает от жёлтого к тёмно-красному и гаснет.
    const f = p.age / p.life;
    s.tint = p.cool ? (f < 0.35 ? mix(0xffd060, 0xff6a1a, f / 0.35) : mix(0xff6a1a, 0x7a1806, (f - 0.35) / 0.65)) : p.tint;
    s.scale.set(p.size * (p.grow ? 0.7 + 0.5 * Math.sqrt(f) : 1));
    s.alpha = p.peak * ease(p.age / 0.15) * (1 - f * f);
  } else if (p.kind === "bubble") {
    // Пузырь: вспухает и лопается кругом; лавовый — тяжело, с дымком.
    const f = p.age / p.life;
    s.scale.set(p.size * Math.sqrt(f));
    s.alpha = 0.8 * ease(f * 4);
    if (p.age + dt >= p.life) {
      if (p.lava) {
        glow(p.src, p.x, p.y, grid, { size: 0.2, life: 0.8, cool: true, alpha: 0.8 });
        smoke(p.src, p.x, p.y, grid, { size: 0.12 });
      } else ripple(p.src, p.x, p.y, grid, { size: 0.12, alpha: 0.35, tint: 0xc8d0a0 });
    }
  } else if (p.kind === "ripple") {
    if (p.age < 0) {
      s.alpha = 0;
      return;
    }
    const f = p.age / p.life;
    s.scale.set(p.size * (p.from + (1.35 - p.from) * Math.sqrt(f)));
    s.alpha = p.peak * (1 - f) * ease(p.age / 0.12);
  } else firefly(p, dt, t, air, grid);
}

/**
 * Светлячок: летит зигзагом, то зависает, то рывком меняет курс, покачивается по
 * высоте. Фонарик вспыхивает раз в 1,5–4 с (изредка дважды подряд) и тлеет между
 * вспышками; на вспышке под ним светлеет земля.
 */
function firefly(p, dt, t, air, grid) {
  const push = air.force * grid;
  p.hover -= dt;
  if (p.hover <= 0 && Math.random() < dt * 0.25) p.hover = 0.6 + Math.random() * 1.2;
  if (Math.random() < dt * 0.4) p.heading += (Math.random() - 0.5) * 2.2;
  p.heading += Math.sin(t * 0.8 + p.seed) * 1.6 * dt;
  const speed = grid * (p.hover > 0 ? 0.04 : 0.26);
  p.x += Math.cos(p.heading) * speed * dt + air.dx * push * 0.05 * dt;
  p.y += Math.sin(p.heading) * speed * dt + air.dy * push * 0.05 * dt;
  const h = (p.h + 0.12 * Math.sin(p.age * 1.7 + p.seed)) * grid;
  // Вспышка: сразу загорается, гаснет за полсекунды.
  p.flash -= dt;
  if (p.flash <= 0) {
    p.lit = 1;
    p.flash = Math.random() < 0.2 ? 0.45 : 1.5 + Math.random() * 2.5;
  }
  p.lit = Math.max(0, p.lit - dt * 2.2);
  const glow = 0.12 + 0.88 * Math.pow(p.lit, 0.6);
  const fade = ease(p.age / 1.2) * ease((p.life - p.age) / 1.5);
  const k = p.size;
  // В воздухе: ореол, жучок, искра фонарика на брюшке.
  const bx = p.x, by = p.y - h;
  p.sprite.position.set(bx, by);
  p.sprite.scale.set(k * (0.6 + 0.9 * glow));
  p.sprite.alpha = Math.min(1, glow * 1.1) * fade;
  p.bug.position.set(bx, by);
  p.bug.rotation = p.heading;
  // Крылья мелькают: жучок чуть дрожит поперёк.
  p.bug.scale.set(k * 0.16, k * 0.16 * (0.85 + 0.15 * Math.sin(p.age * 60)));
  p.bug.alpha = fade * 0.95;
  const tail = k * 0.16 * 32 * 0.48;
  p.lamp.position.set(bx - Math.cos(p.heading) * tail, by - Math.sin(p.heading) * tail);
  p.lamp.scale.set(k * 0.32 * (0.6 + 0.6 * glow));
  p.lamp.alpha = (0.35 + 0.65 * glow) * fade;
  // На земле: отсвет под светлячком, на вспышке ярче и шире.
  p.glow.position.set(p.x, p.y);
  p.glow.scale.set(k * (1.2 + 0.8 * glow));
  p.glow.alpha = 0.3 * Math.pow(p.lit, 0.8) * fade;
}

/** Лист коснулся земли: куда упал — от этого вся его дальнейшая жизнь. */
function land(p, grid) {
  const { x, y } = p.sprite;
  p.surface = surfaceAt(x, y);
  p.x = x;
  p.y = y;
  if (p.surface === "water" || p.surface === "swamp") {
    const water = p.surface === "water";
    // На воде лист живёт дольше: плывёт, намокает и тонет.
    p.life = p.fall + (water ? 10 + Math.random() * 6 : 6 + Math.random() * 3);
    // Течение: сам ветер плюс своё слабое кружение у каждого листа.
    p.cur = Math.random() * Math.PI * 2;
    p.next = 2 + Math.random() * 3;
    ripple(p.src, x, y, grid, { alpha: water ? 0.45 : 0.25 });
    if (water) ripple(p.src, x, y, grid, { delay: 0.35, size: 0.32, alpha: 0.3 });
  } else if (p.surface === "lava" || p.surface === "fire") {
    p.life = p.fall + 1.6;
    glow(p.src, x, y, grid, { size: 0.35, life: 0.9, tint: 0xff7a20, alpha: 0.5 });
    smoke(p.src, x, y, grid, { size: 0.18, delay: 0.5 });
  }
}

/** Плывёт: сносит ветром и течением, покачивается, темнеет от воды, тонет к концу. */
function float(p, dt, t, air, grid) {
  const s = p.sprite;
  const water = p.surface === "water";
  const on = p.age - p.fall;
  const left = p.life - p.age;
  const speed = water ? 1 : 0.3;
  p.cur += Math.sin(t * 0.3 + p.seed) * 0.4 * dt;
  const vx = (air.dx * air.force * 0.07 + Math.cos(p.cur) * 0.04) * grid * speed;
  const vy = (air.dy * air.force * 0.07 + Math.sin(p.cur) * 0.04) * grid * speed;
  const nx = p.x + vx * dt, ny = p.y + vy * dt;
  // К берегу прибило — дальше не плывёт.
  if (surfaceAt(nx, ny) === p.surface) {
    p.x = nx;
    p.y = ny;
  }
  const bob = Math.sin(on * 2.2 + p.seed);
  s.position.set(p.x, p.y + bob * grid * 0.008);
  s.rotation += Math.sin(on * 0.5 + p.seed) * 0.25 * dt * speed;
  // Намокает: темнеет, в болоте быстрее и сильнее.
  const wet = ease(on / (water ? 6 : 3));
  s.tint = shade(p.front, 1 - (water ? 0.25 : 0.45) * wet);
  const k = p.size * (1 + 0.02 * bob);
  s.scale.set(k, k);
  // Тонет: уходит под воду за последние секунды.
  s.alpha = ease(left / (water ? 3 : 2.5)) * (water ? 0.95 : 0.85);
  p.shadow.alpha = 0;
  // Изредка от листа расходится слабый круг.
  p.next -= dt;
  if (water && p.next <= 0 && left > 2) {
    p.next = 3 + Math.random() * 4;
    ripple(p.src, p.x, p.y, grid, { size: 0.3, alpha: 0.18 });
  }
}

/* ------------------------------ Токены ------------------------------ */

/** Брызги, искры и пузыри для токенов: обычная частица без кроны. */
function bit(src, kind, x, y, grid, o) {
  if (live.length > CAP * 4) return;
  const add = kind === "spark";
  const s = sprite(kind === "bubble" ? textures.ripple : textures.fireflies, kind === "bubble" ? under : over, add);
  const p = { src, kind, sprite: s, age: 0, seed: Math.random() * 100, x, y, ...o };
  s.tint = o.tint ?? 0xffffff;
  s.scale.set(p.size);
  s.position.set(x, y);
  live.push(p);
}

/** Язык пламени у точки; `k` — высота в клетках. */
function flame(src, x, y, grid, k = 0.3) {
  if (live.length > CAP * 4) return;
  // Обычное наложение, не сложение: на светлом токене сложение белит пламя.
  const s = sprite(textures.flame, over);
  s.anchor.set(0.5, 0.8);
  s.position.set(x, y);
  live.push({ src, kind: "flame", sprite: s, age: 0, life: 0.45 + Math.random() * 0.4, x, y, k, seed: Math.random() * 100, size: (grid * k) / 32 });
}

function smoke(src, x, y, grid, { size = 0.3, delay = 0, alpha = 0.35, tint = 0x3a3430 } = {}) {
  if (live.length > CAP * 4) return;
  const s = sprite(textures.soft, over);
  s.tint = tint;
  s.position.set(x, y);
  live.push({ src, kind: "smoke", sprite: s, age: -delay, life: 2 + Math.random() * 1.2, x, y, seed: Math.random() * 100, size: (grid * size) / 32, peak: alpha });
}

/** Жар на земле под токеном или листом. */
function glow(src, x, y, grid, { size = 0.5, life = 1.2, tint = 0xff6a1a, alpha = 0.6, cool = false, grow = false } = {}) {
  if (live.length > CAP * 4) return;
  const s = sprite(textures.soft, under, true);
  s.tint = tint;
  s.position.set(x, y);
  live.push({ src, kind: "glow", sprite: s, age: 0, life, x, y, size: (grid * size) / 32, peak: alpha, tint, cool, grow });
}

/**
 * Кольцо пламени вокруг токена — меш с шейдером, рисуется попиксельно и потому
 * чёткое на любом приближении. Не собралось — `false`, тогда горит спрайтами.
 */
function torch(r) {
  try {
    const R = r * 2.1;
    const geometry = new PIXI.Geometry()
      .addAttribute("aVertexPosition", new Float32Array([-R, -R, R, -R, R, R, -R, R]), 2)
      .addIndex(new Uint16Array([0, 1, 2, 0, 2, 3]));
    const shader = PIXI.Shader.from(VERT, TOKEN_FIRE, {
      uTime: Math.random() * 100, uRadius: r, uPower: 0, uSeed: Math.random() * 50,
      uStrength: game.settings.get(MODULE_ID, "strength")
    });
    const mesh = new PIXI.Mesh(geometry, shader);
    mesh.eventMode = "none";
    over.addChildAt(mesh, 0);
    return { mesh, r, power: 0 };
  } catch (err) {
    console.warn(`${MODULE_ID} | token flame shader failed, falling back to sprites`, err);
    return false;
  }
}

function quench(w) {
  if (w.fire?.mesh && !w.fire.mesh.destroyed) w.fire.mesh.destroy({ children: true });
  w.fire = null;
}

/**
 * Где у токена край, по которому горит: у кольца Foundry — само кольцо (оно уже
 * рамки токена), у простой картинки — чуть внутри рамки, где кончается рисунок.
 */
function fireRing(token) {
  return token.document.ring?.enabled ? RING_EDGE : PLAIN_EDGE;
}
const RING_EDGE = 0.8, PLAIN_EDGE = 0.9;

/** Пламя токена: разгорается при входе, гаснет за секунду после выхода. */
function blazeToken(w, token, c, r, hot, dt) {
  if (hot && w.fire && Math.abs(w.fire.r - r) > 1) quench(w);
  if (hot && w.fire == null) w.fire = torch(r);
  const f = w.fire;
  if (!f) return;
  f.power = Math.max(0, Math.min(1, f.power + (hot ? 2.5 : -1.2) * dt));
  if (!hot && f.power <= 0) {
    quench(w);
    return;
  }
  const u = f.mesh.shader.uniforms;
  u.uTime += dt;
  u.uPower = f.power;
  f.mesh.position.set(c.x, c.y);
  f.mesh.visible = token.visible;
}

/** Токен горит: языки пламени по краям, к низу гуще. Есть кольцо-шейдер — оно и горит. */
function burn(src, c, r, grid, n) {
  if (src.torch) return;
  for (let k = 0; k < n; k++) {
    // Нижняя дуга чаще: огонь лижет снизу.
    const a = Math.PI * 0.5 + (Math.random() - 0.5) * Math.PI * (Math.random() < 0.7 ? 1.3 : 2);
    const d = r * (src.ring ?? 1) * (0.88 + 0.22 * Math.random());
    flame(src, c.x + Math.cos(a) * d, c.y + Math.sin(a) * d, grid, (r / grid) * (0.45 + Math.random() * 0.35));
  }
}

function lavaBubble(src, c, r, grid) {
  const a = Math.random() * Math.PI * 2;
  const d = r * (1 + Math.random() * 0.5);
  bit(src, "bubble", c.x + Math.cos(a) * d, c.y + Math.sin(a) * d, grid, {
    life: 1.2 + Math.random() * 0.8, size: (grid * (0.12 + Math.random() * 0.08)) / 32, tint: 0xffb040, lava: true
  });
}

function drops(src, c, r, grid, n, tint, surface) {
  for (let k = 0; k < n; k++) {
    const a = Math.random() * Math.PI * 2;
    const v = grid * (0.6 + Math.random() * 0.9);
    const x = c.x + Math.cos(a) * r * 0.7, y = c.y + Math.sin(a) * r * 0.7;
    bit(src, "drop", x, y, grid, {
      life: 2, vx: Math.cos(a) * v * 0.5, vy: Math.sin(a) * v * 0.5, h: 0, vh: grid * (1 + Math.random() * 1.2),
      size: (grid * (0.035 + Math.random() * 0.03)) / 16, tint, peak: 0.8, surface
    });
  }
}

function sparks(src, c, r, grid, n) {
  for (let k = 0; k < n; k++) {
    const a = Math.random() * Math.PI * 2;
    // Из-под краёв токена, а не из середины: там их закрыл бы сам токен.
    const d = r * (0.6 + 0.7 * Math.random());
    bit(src, "spark", c.x + Math.cos(a) * d, c.y + Math.sin(a) * d, grid, {
      life: 0.8 + Math.random() * 0.9, vx: (Math.random() - 0.5) * grid * 0.4, vy: -grid * (0.2 + Math.random() * 0.5),
      size: (grid * (0.1 + Math.random() * 0.08)) / 16
    });
  }
}

function bubbles(src, c, r, grid, n) {
  for (let k = 0; k < n; k++) {
    const a = Math.random() * Math.PI * 2;
    const d = r * (0.8 + Math.random() * 0.6);
    bit(src, "bubble", c.x + Math.cos(a) * d, c.y + Math.sin(a) * d, grid, {
      life: 0.6 + Math.random() * 0.8, size: (grid * (0.07 + Math.random() * 0.07)) / 32, tint: 0xdde4b8
    });
  }
}

/** Круг вокруг токена: радиус круга — чуть шире токена. */
const ring = (r, grid, k = 1) => ((r * 1.25) / grid) * k;
const MUD = 0x9aa070;

/** Токен ступил в область: всплеск, чавк или сноп искр. */
function enter(src, here, c, r, grid) {
  if (here === "water") {
    ripple(src, c.x, c.y, grid, { size: ring(r, grid, 1.1), alpha: 0.5 });
    ripple(src, c.x, c.y, grid, { size: ring(r, grid, 0.85), alpha: 0.35, delay: 0.2 });
    ripple(src, c.x, c.y, grid, { size: ring(r, grid, 1.4), alpha: 0.2, delay: 0.45 });
    drops(src, c, r, grid, 12, 0xe8f6ff, "water");
  } else if (here === "swamp") {
    ripple(src, c.x, c.y, grid, { size: ring(r, grid), alpha: 0.3, tint: MUD });
    ripple(src, c.x, c.y, grid, { size: ring(r, grid, 0.8), alpha: 0.2, tint: MUD, delay: 0.3 });
    drops(src, c, r, grid, 6, 0x6f7a45, "swamp");
    bubbles(src, c, r, grid, 3);
  } else if (here === "lava") {
    // Густая: продавливается, а не плещет. Раскалённое проступает и медленно
    // расходится тёмная корка; токен занимается огнём.
    glow(src, c.x, c.y, grid, { size: (r / grid) * 1.5, life: 2.2, alpha: 0.5, cool: true, grow: true });
    ripple(src, c.x, c.y, grid, { size: ring(r, grid, 1.05), alpha: 0.55, tint: 0x24100a, life: 2.8, from: 0.75 });
    burn(src, c, r, grid, 10);
    smoke(src, c.x, c.y, grid, { size: (r / grid) * 0.7, alpha: 0.4 });
    smoke(src, c.x, c.y, grid, { size: (r / grid) * 0.6, alpha: 0.3, delay: 0.4 });
    sparks(src, c, r, grid, 6);
  } else {
    burn(src, c, r, grid, 12);
    smoke(src, c.x, c.y, grid, { size: (r / grid) * 0.6, alpha: 0.35 });
    sparks(src, c, r, grid, 8);
  }
}

/** Идёт по области: след кругами, в лаве — искры из-под ног. */
function wake(src, here, c, r, grid) {
  if (here === "water") {
    ripple(src, c.x, c.y, grid, { size: ring(r, grid), alpha: 0.32 });
    if (Math.random() < 0.5) drops(src, c, r, grid, 2, 0xe8f6ff, "water");
  } else if (here === "swamp") {
    ripple(src, c.x, c.y, grid, { size: ring(r, grid, 0.9), alpha: 0.2, tint: MUD });
    if (Math.random() < 0.4) bubbles(src, c, r, grid, 1);
  } else {
    // След в лаве остывает от жёлтого к тёмно-красному.
    if (here === "lava") glow(src, c.x, c.y, grid, { size: (r / grid) * 1.1, life: 2.6, alpha: 0.45, cool: true });
    burn(src, c, r, grid, 3);
    if (Math.random() < 0.3) sparks(src, c, r, grid, 2);
  }
}

/** Стоит в области: изредка круг, пузыри, тлеющие искры. */
function idle(src, here, c, r, grid) {
  if (here === "water") ripple(src, c.x, c.y, grid, { size: ring(r, grid, 0.95), alpha: 0.14 });
  else if (here === "swamp") bubbles(src, c, r, grid, 1 + Math.floor(Math.random() * 2));
  else {
    if (here === "lava") {
      // Жар пульсирует: новое пятно примерно раз в полсекунды.
      if (Math.random() < 0.3) glow(src, c.x, c.y, grid, { size: (r / grid) * 1.3, life: 1.1, alpha: 0.25 + Math.random() * 0.15 });
      if (Math.random() < 0.12) lavaBubble(src, c, r, grid);
    }
    burn(src, c, r, grid, 4);
    if (Math.random() < 0.35) smoke(src, c.x, c.y - r * 0.3, grid, { size: (r / grid) * 0.5, alpha: 0.28 });
    if (Math.random() < 0.25) sparks(src, c, r, grid, 1);
  }
}

const IDLE = { water: [2.5, 4], swamp: [1.2, 2.5], lava: [0.12, 0.2], fire: [0.12, 0.2] };

/** Каждый кадр: кто из токенов где стоит, вошёл ли, идёт или стоит. */
function wade(dt, grid) {
  const seen = new Set();
  for (const token of canvas.tokens?.placeables ?? []) {
    if (!token.visible || token.destroyed) continue;
    // Летящий над водой не мокнет.
    if ((token.document.elevation ?? 0) > 1) continue;
    seen.add(token.id);
    const c = token.center;
    const r = Math.max(token.w, token.h) / 2;
    const here = surfaceAt(c.x, c.y);
    let w = walkers.get(token.id);
    // Первый взгляд на токен (загрузка сцены) — без всплеска: он там уже стоял.
    if (!w) {
      walkers.set(token.id, { surface: here, x: c.x, y: c.y, trail: 0, next: Math.random() * 2 });
      continue;
    }
    blazeToken(w, token, c, r * fireRing(token), here === "lava" || here === "fire", dt);
    // У токена те же `mesh` и `visible`, что у кроны: частицы гаснут вместе с ним.
    const src = { tile: token, torch: !!w.fire, ring: fireRing(token) };
    const moved = Math.hypot(c.x - w.x, c.y - w.y);
    if (here && here !== w.surface) {
      enter(src, here, c, r, grid);
      w.trail = 0;
    } else if (here) {
      w.trail += moved;
      if (w.trail >= grid * 0.3) {
        w.trail = 0;
        wake(src, here, c, r, grid);
      }
      w.next -= dt;
      if (w.next <= 0) {
        const [a, b] = IDLE[here];
        w.next = a + Math.random() * (b - a);
        if (moved < 0.5) idle(src, here, c, r, grid);
      }
    }
    w.surface = here;
    w.x = c.x;
    w.y = c.y;
  }
  for (const [id, w] of walkers) {
    if (seen.has(id)) continue;
    quench(w);
    walkers.delete(id);
  }
}

/* ------------------------------ Настройки ------------------------------ */

export function registerParticles() {
  game.settings.register(MODULE_ID, "treeParticles", {
    name: "BLM.Setting.treeParticles", hint: "BLM.Setting.treeParticlesHint",
    scope: "world", config: true, type: Number, default: 1,
    range: { min: 0, max: 3, step: 0.1 }
  });
  game.settings.register(MODULE_ID, "tokenSplash", {
    name: "BLM.Setting.tokenSplash", hint: "BLM.Setting.tokenSplashHint",
    scope: "world", config: true, type: Boolean, default: true
  });
  Hooks.on("canvasReady", () => rebuildParticles());
  // Появилась или пропала вода — токенам есть или нечего плескать.
  for (const hook of ["createRegion", "updateRegion", "deleteRegion"]) {
    Hooks.on(hook, (doc) => {
      if (doc.parent === canvas.scene) setTimeout(() => rebuildParticles(), 0);
    });
  }
  Hooks.on("canvasTearDown", () => clearParticles());
  for (const hook of ["createTile", "updateTile", "deleteTile"]) {
    Hooks.on(hook, (doc, changes) => {
      if (doc.parent !== canvas.scene) return;
      // Крона качнулась или сдвинулась — источники те же, пересобирать незачем.
      if (hook === "updateTile" && !changes?.flags?.[MODULE_ID] && !("texture" in (changes ?? {}))) return;
      setTimeout(() => rebuildParticles(), 0);
    });
  }
}
