// Норы. Токен зарывается (действие движения «Копать», `burrow`) — на месте, где он
// ушёл под землю, остаётся нора с кучкой вынутой земли; где вылез — ещё одна.
// Цвет норы и кучки берётся с картинки пола под ней: в траве — травянистый край
// и бурая земля, на песке — песчаная, на снегу — белёсая.
//
// Норы — флаг сцены `burrows` (пишет активный Мастер), поэтому видны всем и
// остаются после перезагрузки. Засыпать — кнопка в окне сцены, вкладка «Окружение»,
// или `game.modules.get("burn-living-map").api.clearBurrows()`.

import { surfaceAt } from "./particles.js";
import { VERT } from "./shaders.js";

const MODULE_ID = "burn-living-map";
const BURROW = "burrow";
/** Ниже сугробов и кругов, выше пола и тайлов пола. */
const PITS = 630;
/** Новая нора ближе этого (в клетках) к старой — та же нора. */
const SAME = 0.6;
const KEEP = 80;

let layer = null;
/** Последнее действие движения каждого токена: от него понятно, где он нырнул. */
const actions = new Map();
const colors = new Map();

const loc = (k) => game.i18n.localize(`BLM.${k}`);
const isGM = () => game.users.activeGM?.isSelf ?? false;

/* ------------------------------ Где копали ------------------------------ */

function centerOf(pos) {
  const g = canvas.grid;
  return { x: pos.x + ((pos.width ?? 1) * g.sizeX) / 2, y: pos.y + ((pos.height ?? 1) * g.sizeY) / 2 };
}

function sizeOf(pos) {
  return Math.max(pos.width ?? 1, pos.height ?? 1);
}

/** Мастер дописывает норы в сцену; рядом со старой новую не роет. */
async function dig(scene, spots) {
  if (!isGM() || !spots.length) return;
  const list = [...(scene.flags?.[MODULE_ID]?.burrows ?? [])];
  const g = canvas.grid.size;
  for (const s of spots) {
    // В воде, лаве и болоте норы не остаётся.
    if (surfaceAt(s.x, s.y)) continue;
    if (list.some((b) => Math.hypot(b.x - s.x, b.y - s.y) < g * SAME)) continue;
    list.push({ x: Math.round(s.x), y: Math.round(s.y), size: s.size, seed: Math.floor(Math.random() * 1e6), level: s.level ?? null });
  }
  await scene.setFlag(MODULE_ID, "burrows", list.slice(-KEEP));
}

export async function clearBurrows() {
  if (!game.user.isGM) return;
  await canvas.scene?.unsetFlag(MODULE_ID, "burrows");
}

/* ------------------------------ Рисунок ------------------------------ */

function rng(seed) {
  let s = (seed % 2147483646) + 1;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

function shade(c, k) {
  const f = (v) => Math.max(0, Math.min(255, Math.round(v * k)));
  return (f(c >> 16) << 16) | (f((c >> 8) & 255) << 8) | f(c & 255);
}

function mix(a, b, f) {
  const ch = (c, s) => (c >> s) & 255;
  const m = (s) => Math.round(ch(a, s) + (ch(b, s) - ch(a, s)) * f);
  return (m(16) << 16) | (m(8) << 8) | m(0);
}

/** Неровный круг: радиус гуляет по нескольким гармоникам. */
function blob(cx, cy, r, rnd, sq = 1, n = 28) {
  const k = [rnd() * 0.12, rnd() * 0.08, rnd() * 0.05], ph = [rnd() * 6.3, rnd() * 6.3, rnd() * 6.3];
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const d = r * (1 + k[0] * Math.sin(a * 2 + ph[0]) + k[1] * Math.sin(a * 3 + ph[1]) + k[2] * Math.sin(a * 5 + ph[2]));
    pts.push(cx + Math.cos(a) * d, cy + Math.sin(a) * d * sq);
  }
  return pts;
}

/**
 * Средний цвет картинки пола у точки: картинки уровней сцены (фон) уменьшаются
 * в квадрат 8×8 вокруг точки. Не вышло — бурая земля.
 */
function groundColor(x, y) {
  const key = `${Math.round(x / 10)}:${Math.round(y / 10)}`;
  if (colors.has(key)) return colors.get(key);
  let out = 0x6b5038;
  try {
    const span = canvas.grid.size * 0.8;
    const rt = PIXI.RenderTexture.create({ width: 8, height: 8 });
    const root = new PIXI.Container();
    root.scale.set(8 / (span * 2));
    root.position.set(-(x - span) * root.scale.x, -(y - span) * root.scale.y);
    for (const m of canvas.primary.levelTextures ?? []) {
      if (m.destroyed || !m.visible || !m.texture?.valid || m.texture === PIXI.Texture.EMPTY) continue;
      const sp = root.addChild(new PIXI.Sprite(m.texture));
      sp.anchor.copyFrom(m.anchor);
      sp.position.copyFrom(m.position);
      sp.scale.copyFrom(m.scale);
      sp.rotation = m.rotation;
    }
    if (root.children.length) {
      canvas.app.renderer.render(root, { renderTexture: rt, clear: true });
      const px = canvas.app.renderer.extract.pixels(rt);
      let r = 0, g = 0, b = 0, n = 0;
      for (let k = 0; k < px.length; k += 4) {
        const a = px[k + 3];
        if (a < 128) continue;
        r += (px[k] * 255) / a;
        g += (px[k + 1] * 255) / a;
        b += (px[k + 2] * 255) / a;
        n++;
      }
      if (n) out = (Math.min(255, Math.round(r / n)) << 16) | (Math.min(255, Math.round(g / n)) << 8) | Math.min(255, Math.round(b / n));
    }
    root.destroy({ children: true });
    rt.destroy(true);
  } catch (err) {
    console.warn(`${MODULE_ID} | could not read the floor colour under a burrow`, err);
  }
  colors.set(key, out);
  return out;
}

/** Слой рисунка норы с мягким краем: размытие в долях радиуса. */
function layerOf(root, blur) {
  const g = root.addChild(new PIXI.Graphics());
  if (blur > 0) {
    const f = new PIXI.BlurFilter(blur, 3);
    f.padding = Math.ceil(blur * 3);
    g.filters = [f];
  }
  return g;
}

/**
 * Нора сверху: с одной стороны кучка вынутой земли, по краю валик разрыхлённого
 * пола, внутри темнеет в глубину; дальний край в тени, ближний чуть освещён.
 * Рисуется слоями с размытием и запекается в одну картинку.
 */
function drawPit(root, b, grid) {
  const rnd = rng(b.seed);
  const r = grid * 0.36 * Math.min(3, b.size ?? 1);
  const floor = groundColor(b.x, b.y);
  // Вынутая земля: темнее и бурее пола, сырая.
  const soil = mix(shade(floor, 0.72), 0x5a3e28, 0.45);
  const { x, y } = b;
  const a = rnd() * Math.PI * 2;
  const mx = x + Math.cos(a) * r * 1.45, my = y + Math.sin(a) * r * 1.45;
  // Тень под кучкой и валиком.
  const shadow = layerOf(root, r * 0.12);
  shadow.beginFill(0x000000, 0.28);
  shadow.drawPolygon(blob(mx + r * 0.16, my + r * 0.2, r * 1.05, rnd, 0.85));
  shadow.drawPolygon(blob(x + r * 0.06, y + r * 0.08, r * 1.2, rnd));
  shadow.endFill();
  // Кучка: горка из комьев, к макушке светлее.
  const heap = layerOf(root, r * 0.025);
  // Снизу вверх: широкое тёмное основание, на нём комья светлее, макушка на свету.
  heap.beginFill(shade(soil, 0.7), 1);
  heap.drawPolygon(blob(mx, my, r * 0.85, rnd, 0.85));
  heap.endFill();
  for (let k = 0; k < 14; k++) {
    const d = r * 0.6 * Math.sqrt(rnd()), q = rnd() * Math.PI * 2;
    const top = 1 - d / (r * 0.6);
    heap.beginFill(shade(soil, 0.72 + 0.45 * top + 0.15 * rnd()), 1);
    heap.drawPolygon(blob(mx + Math.cos(q) * d, my + Math.sin(q) * d * 0.85, r * (0.18 + 0.2 * rnd()), rnd, 0.85, 16));
    heap.endFill();
    // Щель между комьями — с теневой стороны.
    heap.beginFill(shade(soil, 0.5), 0.6);
    heap.drawPolygon(blob(mx + Math.cos(q) * d + r * 0.08, my + Math.sin(q) * d * 0.85 + r * 0.1, r * 0.06, rnd, 0.8, 8));
    heap.endFill();
  }
  heap.beginFill(shade(soil, 1.35), 0.8);
  heap.drawPolygon(blob(mx - r * 0.12, my - r * 0.15, r * 0.24, rnd, 0.85, 14));
  heap.endFill();
  // Комья и крошки вокруг, больше в сторону кучки.
  for (let k = 0; k < 16; k++) {
    const q = a + (rnd() - 0.5) * (k < 10 ? 2.2 : 6.2), d = r * (0.95 + 1.2 * rnd());
    heap.beginFill(shade(soil, 0.75 + 0.45 * rnd()), 1);
    heap.drawPolygon(blob(x + Math.cos(q) * d, y + Math.sin(q) * d, r * (0.04 + 0.07 * rnd()), rnd, 0.9, 8));
    heap.endFill();
  }
  // Валик по краю норы: разрыхлённый пол.
  const rim = layerOf(root, r * 0.06);
  rim.beginFill(mix(floor, soil, 0.6), 1);
  rim.drawPolygon(blob(x, y, r * 1.15, rnd));
  rim.endFill();
  // Сама нора: от края к глубине; середина сдвинута к дальнему (верхнему) краю.
  const pit = layerOf(root, r * 0.09);
  const steps = [
    [1.0, mix(soil, 0x1a120c, 0.4), 0],
    [0.84, mix(soil, 0x120c08, 0.68), -0.04],
    [0.66, 0x150f0a, -0.08],
    [0.46, 0x0a0705, -0.1]
  ];
  for (const [k, c, dy] of steps) {
    pit.beginFill(c, 1);
    pit.drawPolygon(blob(x, y + dy * r, r * k, rng(b.seed + 7), 0.92));
    pit.endFill();
  }
  // Ближний внутренний край на свету.
  const lip = layerOf(root, r * 0.04);
  lip.lineStyle(r * 0.08, shade(soil, 1.2), 0.5);
  lip.arc(x, y - r * 0.02, r * 0.88, Math.PI * 0.18, Math.PI * 0.82);
}

// Нора сверху — карта высот, освещённая один раз. Единица длины — радиус норы r,
// начало — её середина, y вниз (как на холсте). Свет — сверху слева, как у
// картинок FA: тени ложатся вправо вниз.
//
// Высота складывается из: воронки (стенки круче к краю, дно ниже), валика
// разрыхлённого грунта по краю, горки вынутой земли из комьев, дорожки
// просыпавшейся земли от норы к горке и редких комьев вокруг. Нормаль — по
// разностям высоты, тень — пробежкой к свету; глубина гасит свет в норе.
// Грунт — смесь пола и сырой земли с зерном, камешками и корешками; по краю он
// крошится на пол, за горкой на пол падает мягкая тень.
const PIT_FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 vPos;
uniform vec2 uSize;
uniform float uExt;
uniform vec2 uHeap;
uniform float uHeapR;
uniform float uSeed;
uniform vec3 uFloor;
uniform vec3 uSoil;

const vec3 L = vec3(-0.56, -0.62, 0.55);
const float RELIEF = 0.75;

float hash(vec2 p) {
  p = fract(p * vec2(234.34, 435.345) + uSeed * 0.013);
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { s += a * noise(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return s;
}
// Комья: в каждой клетке сетки свой бугорок, круглый, разной высоты.
// keep — доля клеток, где ком есть (1 — во всех).
float lumps(vec2 p, float scale, float keep) {
  vec2 g = p * scale;
  vec2 i = floor(g), f = fract(g);
  float h = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 o = vec2(float(x), float(y));
      vec2 c = i + o;
      if (hash(c + 11.7) > keep) continue;
      vec2 at = o + vec2(0.2, 0.2) + 0.6 * vec2(hash(c), hash(c + 7.3));
      float rr = 0.32 + 0.3 * hash(c + 3.1);
      vec2 d = (f - at) / rr;
      // Ком чуть сплюснут и повёрнут — не шарик.
      float t = hash(c + 5.5) * 6.2832;
      d = mat2(cos(t), -sin(t), sin(t), cos(t)) * d * vec2(1.0, 1.25);
      float q = dot(d, d);
      if (q < 1.0) h = max(h, sqrt(1.0 - q) * (0.55 + 0.45 * hash(c + 9.0)));
    }
  }
  return h;
}

// Высота, где земля разрыта (soil 0..1) и щели между комьями (gap: 1 — глубоко между ними).
float height(vec2 p, out float soil, out float gap) {
  float d = length(p);
  vec2 dir = d > 1e-4 ? p / d : vec2(1.0, 0.0);
  // Край норы неровный. Шум — по точке, а не по направлению: иначе по стенке
  // бегут лучи от середины.
  float R = 1.0 + 0.3 * (fbm(p * 0.9 + uSeed * 0.37) - 0.5) + 0.08 * (noise(p * 3.5 + 3.0) - 0.5);
  float t = d / R;
  float h = 0.0;
  // Профиль воронки: у края полого (видно стенки), к середине круто вниз.
  if (t < 1.0) h -= 1.5 * (1.0 - pow(t, 2.4)) * (0.92 + 0.16 * fbm(p * 3.0));
  // Валик по краю: выше со стороны горки.
  float toward = dot(dir, normalize(uHeap)) * 0.5 + 0.5;
  float rim = exp(-pow((d - R * 1.07) / (0.15 + 0.06 * toward), 2.0));
  h += rim * (0.16 + 0.12 * toward) * (0.65 + 0.7 * fbm(p * 5.0));
  // Горка: основание неровное, на ней комья.
  vec2 q = p - uHeap;
  float qd = length(q);
  vec2 qdir = qd > 1e-4 ? q / qd : vec2(1.0, 0.0);
  float HR = uHeapR * (1.0 + 0.55 * (fbm(q * 1.1 + uSeed * 0.71 + 5.0) - 0.5) + 0.14 * (noise(q * 4.0 + 2.0) - 0.5));
  float k = qd / HR;
  float mound = k < 1.0 ? pow(1.0 - k * k, 1.35) : 0.0;
  // Крупные комья — на всей горке, мелкие — между ними и у подножия.
  float inHeap = smoothstep(1.05, 0.3, k);
  float clods = lumps(p, 3.4, 1.0) * inHeap;
  float fine = lumps(p * 1.07 + 3.3, 8.0, 0.85) * smoothstep(1.15, 0.45, k);
  float bump = max(clods * 0.34, fine * 0.13);
  h += mound * 0.8 + bump + (fbm(p * 9.0) - 0.5) * 0.05 * mound;
  gap = inHeap * (1.0 - smoothstep(0.0, 0.12, bump));
  // Дорожка просыпавшейся земли от норы к горке.
  vec2 ab = uHeap;
  float u = clamp(dot(p, ab) / dot(ab, ab), 0.0, 1.0);
  float lane = length(p - ab * u) / (0.55 + 0.25 * fbm(p * 2.5));
  float spill = smoothstep(1.0, 0.0, lane) * step(R * 0.9, d);
  h += spill * (0.05 + 0.1 * lumps(p, 9.0, 0.7));
  // Редкие комья вокруг: гуще у норы и в сторону горки.
  float near = smoothstep(2.6, 1.0, d) * (0.35 + 0.65 * toward);
  float scatter = lumps(p, 7.0, 0.18 * near) * step(R * 1.05, d) * step(1.05, k);
  h += scatter * 0.14;
  // Где земля: нора с валиком, горка, дорожка, комья. Край крошится.
  float crumble = (noise(p * 14.0) - 0.5) * 0.12 + (noise(p * 31.0) - 0.5) * 0.06;
  float pitSoil = smoothstep(0.0, 0.07, R * (1.3 + 0.12 * toward) + crumble - d);
  // Подножие горки осыпается на пол: край рваный, с отдельными крошками.
  float heapSoil = smoothstep(0.0, 0.07, 1.1 + crumble * 2.6 - k);
  float laneSoil = smoothstep(0.0, 0.1, 0.9 + crumble * 2.0 - lane) * step(0.0, 1.0 - u * 0.95);
  soil = max(max(pitSoil, heapSoil), max(laneSoil, step(0.02, scatter)));
  return h;
}

float heightOnly(vec2 p) { float s, g; return height(p, s, g); }

void main() {
  vec2 p = (vPos / uSize * 2.0 - 1.0) * uExt;
  float soil, gap;
  float h = height(p, soil, gap);
  float e = 0.012;
  float hx = heightOnly(p + vec2(e, 0.0)) - heightOnly(p - vec2(e, 0.0));
  float hy = heightOnly(p + vec2(0.0, e)) - heightOnly(p - vec2(0.0, e));
  vec3 n = normalize(vec3(-hx / (2.0 * e) * RELIEF, -hy / (2.0 * e) * RELIEF, 1.0));
  vec3 l = normalize(L);
  float diff = max(dot(n, l), 0.0);

  // Тень: идём к свету и смотрим, не заслоняет ли рельеф.
  float slope = l.z / length(l.xy);
  float occl = 0.0;
  for (int i = 1; i <= 18; i++) {
    float t = float(i) * 0.055;
    float hh = heightOnly(p + normalize(l.xy) * t);
    occl = max(occl, ((hh - h) * RELIEF - t * slope) / (t * 0.6 + 0.05));
  }
  float lit = 1.0 - smoothstep(0.0, 0.35, occl);

  // Цвет грунта: сырая земля с оттенком пола, пятнами, зерном и камешками.
  float d = length(p);
  vec3 c = mix(uSoil, uFloor * 0.8, 0.22 * smoothstep(1.0, 1.6, d));
  c *= 0.82 + 0.36 * fbm(p * 4.0 + 7.0);
  float grain = noise(p * 46.0);
  c *= 0.9 + 0.2 * grain;
  vec2 pc = floor(p * 26.0);
  float peb = step(0.965, hash(pc + 2.0));
  float pebShape = smoothstep(0.42, 0.25, length(fract(p * 26.0) - 0.5));
  c = mix(c, mix(uFloor, vec3(0.62, 0.58, 0.52), 0.5) * (0.85 + 0.3 * hash(pc)), peb * pebShape * 0.85);
  // Сырее и темнее вглубь, суше на макушке горки.
  float wet = smoothstep(0.0, -0.9, h);
  c *= mix(1.0, 0.55, wet);
  c = mix(c, c * 1.28 + 0.03, smoothstep(0.2, 0.8, h));
  // Корешки в стенке норы.
  float root = smoothstep(0.035, 0.0, abs(fbm(p * vec2(3.0, 9.0) + 9.0) - 0.5)) * smoothstep(-0.15, -0.6, h) * smoothstep(-1.2, -0.7, h);
  c = mix(c, vec3(0.42, 0.33, 0.24), root * 0.55);

  // Глубина гасит свет понемногу: стенки видны, дно уходит в темноту.
  float depth = smoothstep(-0.1, -1.4, h);
  float ao = mix(1.0, 0.1, pow(depth, 2.5));
  // В щелях между комьями свет не достаёт.
  ao *= mix(1.0, 0.68, gap);
  // В тени норы не черно: небо светит сверху, и стенку видно.
  vec3 col = c * (0.3 + 1.1 * diff * mix(0.22, 1.0, lit)) * ao;
  // Отблеск по светлым кромкам комьев.
  col += vec3(0.05) * pow(max(dot(reflect(-l, n), vec3(0.0, 0.0, 1.0)), 0.0), 12.0) * lit * (1.0 - depth);

  // Тень рельефа на полу вокруг.
  float floorShadow = (1.0 - lit) * 0.5 * (1.0 - soil);
  float a = soil + (1.0 - soil) * floorShadow;
  gl_FragColor = vec4(col * soil, a);
}`;


/**
 * Вынутая земля: бурая, с оттенком пола. На тёмном полу (сырая земля, ночная
 * трава) не темнее предела — иначе горка сливается с полом.
 */
function freshSoil(floor) {
  let c = mix(shade(floor, 0.8), 0x6b4a2f, 0.55);
  const lum = (0.299 * ((c >> 16) & 255) + 0.587 * ((c >> 8) & 255) + 0.114 * (c & 255)) / 255;
  if (lum < 0.3) c = shade(c, 0.3 / Math.max(lum, 0.05));
  return c;
}

/** Поля картинки вокруг норы, в её радиусах: горка с комьями уходит до ~2,7. */
const EXT = 3;
/** Точек картинки на точку сцены: нору разглядывают вблизи. */
const RES = 2;
const MAX_SIDE = 1024;

const rgb = (c) => new Float32Array([((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255]);

/** Нора картинкой: шейдер считает её один раз, дальше — обычный спрайт. */
function pitSprite(b, grid) {
  try {
    return shadedPit(b, grid);
  } catch (err) {
    console.warn(`${MODULE_ID} | burrow shader failed, drawing the simple pit`, err);
    return vectorPit(b, grid);
  }
}

function shadedPit(b, grid) {
  const rnd = rng(b.seed);
  const r = grid * 0.36 * Math.min(3, b.size ?? 1);
  const floor = groundColor(b.x, b.y);
  const soil = freshSoil(floor);
  const a = rnd() * Math.PI * 2;
  const reach = 1.45 + 0.15 * rnd();
  const side = Math.min(MAX_SIDE, Math.ceil(2 * EXT * r * RES));
  const verts = new Float32Array([0, 0, side, 0, side, side, 0, side]);
  const quad = new PIXI.Geometry().addAttribute("aVertexPosition", verts, 2).addIndex(new Uint16Array([0, 1, 2, 0, 2, 3]));
  const mesh = new PIXI.Mesh(quad, PIXI.Shader.from(VERT, PIT_FRAG, {
    uSize: new Float32Array([side, side]),
    uExt: EXT,
    uHeap: new Float32Array([Math.cos(a) * reach, Math.sin(a) * reach]),
    uHeapR: 0.85 + 0.2 * rnd(),
    uSeed: (b.seed % 997) + 0.5,
    uFloor: rgb(floor),
    uSoil: rgb(soil)
  }));
  const rt = PIXI.RenderTexture.create({ width: side, height: side });
  canvas.app.renderer.render(mesh, { renderTexture: rt, clear: true });
  mesh.destroy({ children: true });
  quad.destroy();
  const sp = new PIXI.Sprite(rt);
  const span = 2 * EXT * r;
  sp.scale.set(span / side);
  sp.position.set(b.x - span / 2, b.y - span / 2);
  return sp;
}

/** Запасной рисунок: слои многоугольников, если шейдер не собрался. */
function vectorPit(b, grid) {
  const root = new PIXI.Container();
  drawPit(root, b, grid);
  const box = root.getLocalBounds();
  const tex = canvas.app.renderer.generateTexture(root, { resolution: 1, multisample: PIXI.MSAA_QUALITY.HIGH, region: box });
  root.destroy({ children: true });
  const sp = new PIXI.Sprite(tex);
  sp.position.set(box.x, box.y);
  return sp;
}

export function drawBurrows() {
  if (layer && !layer.destroyed) layer.destroy({ children: true, texture: true });
  layer = null;
  if (!canvas.ready || !canvas.primary || !game.settings.get(MODULE_ID, "enabled")) return;
  const list = canvas.scene?.flags?.[MODULE_ID]?.burrows ?? [];
  if (!list.length) return;
  layer = new PIXI.Container();
  layer.name = `${MODULE_ID}.burrows`;
  layer.eventMode = "none";
  layer.elevation = 0;
  layer.sortLayer = PITS;
  layer.sort = 0;
  const grid = canvas.grid.size;
  for (const b of list) layer.addChild(pitSprite(b, grid));
  canvas.primary.addChild(layer);
  canvas.primary.sortDirty = true;
}

/* ------------------------------ Хуки ------------------------------ */

export function registerBurrows() {
  Hooks.on("canvasReady", () => {
    actions.clear();
    colors.clear();
    for (const t of canvas.tokens?.placeables ?? []) actions.set(t.id, t.document.movementAction);
    // Картинки пола могут догрузиться позже холста: цвет возьмём, когда всё на месте.
    setTimeout(() => drawBurrows(), 0);
  });
  Hooks.on("canvasTearDown", () => {
    if (layer && !layer.destroyed) layer.destroy({ children: true, texture: true });
    layer = null;
  });
  Hooks.on("updateScene", (scene, changes) => {
    if (scene !== canvas.scene) return;
    const f = changes.flags?.[MODULE_ID];
    if (f && ("burrows" in f || "-=burrows" in f)) drawBurrows();
  });

  // Шёл по пути: где сменилось «копает» на другое или обратно — там нора.
  Hooks.on("moveToken", (doc, movement) => {
    if (doc.parent !== canvas.scene) return;
    let prev = actions.get(doc.id) ?? doc._source?.movementAction ?? "walk";
    let at = movement.origin;
    const spots = [];
    for (const wp of movement.passed?.waypoints ?? []) {
      const act = wp.action ?? prev;
      if ((act === BURROW) !== (prev === BURROW) && at) spots.push({ ...centerOf(at), size: sizeOf(at), level: at.level ?? doc.level ?? null });
      prev = act;
      at = wp;
    }
    actions.set(doc.id, prev);
    dig(doc.parent, spots);
  });

  // Сменил действие на месте: зарылся или вылез тут же.
  Hooks.on("updateToken", (doc, changes) => {
    if (doc.parent !== canvas.scene || !("movementAction" in changes)) return;
    if ("x" in changes || "y" in changes) return;
    const prev = actions.get(doc.id);
    const now = changes.movementAction;
    actions.set(doc.id, now);
    if (prev === undefined || (prev === BURROW) === (now === BURROW)) return;
    dig(doc.parent, [{ ...centerOf(doc), size: sizeOf(doc), level: doc.level ?? null }]);
  });
  Hooks.on("createToken", (doc) => actions.set(doc.id, doc.movementAction));

  // Окно сцены, «Окружение»: засыпать норы.
  Hooks.on("renderSceneConfig", (app, element) => {
    const root = element instanceof HTMLElement ? element : element[0];
    const tab = root?.querySelector('.tab[data-tab="environment"]');
    if (!tab || tab.querySelector(`.${MODULE_ID}-burrows`) || !game.user.isGM) return;
    const n = app.document.flags?.[MODULE_ID]?.burrows?.length ?? 0;
    const set = document.createElement("fieldset");
    set.className = `${MODULE_ID}-burrows`;
    set.innerHTML = `
      <legend>🔥 ${loc("Burrows.Title")}</legend>
      <div class="form-group">
        <label>${game.i18n.format("BLM.Burrows.Count", { n })}</label>
        <div class="form-fields"><button type="button" ${n ? "" : "disabled"}><i class="fa-solid fa-trowel"></i> ${loc("Burrows.Clear")}</button></div>
        <p class="hint">${loc("Burrows.Hint")}</p>
      </div>`;
    const button = set.querySelector("button");
    button.addEventListener("click", async (ev) => {
      ev.preventDefault();
      button.disabled = true;
      await app.document.unsetFlag(MODULE_ID, "burrows");
      set.querySelector("label").textContent = game.i18n.format("BLM.Burrows.Count", { n: 0 });
    });
    tab.append(set);
  });
}
