// Работающая техника на тайлах: крутятся вентиляторы, мигают огоньки серверов.
//
// Тайл с пометкой `machine` (ключ раскладки ниже) или с картинкой, в имени которой
// есть этот ключ. Раскладка — доли картинки, снята с ассетов киберпанк-набора
// Картографа: центры и радиусы вентиляторов, точки огоньков (x, y в тысячных, цвет:
// 1 — пурпурный, 0 — голубой). Винты дирижабля видны сверху с ребра: лопасти
// сжимаются и разворачиваются по косинусу, ступица остаётся поверх; руны
// подсвечиваются по своему голубому цвету и медленно дышат. Вентилятор — круг той же картинки, повёрнутый под
// маской, второй полупрозрачный слой со сдвигом даёт размытие. Огоньки: большая
// часть горит ровно, остальные гаснут и вспыхивают каждый в своём ритме.

import { bakeTexture, placeBaked } from "./hover.js";

const MODULE_ID = "burn-living-map";

export const LAYOUTS = {"Airship_Gnome_Brass_A":{"rotors":[[0.12656,0.77266,0.01406,0.23594,0.10625,0.15469,0.76172,0.78594,1],[0.87344,0.77266,0.76406,0.98594,0.84531,0.89531,0.76172,0.78594,-1]],"runes":[0.55,0.95,1]},"Floor_Fan_Industrial_A":{"fans":[[0.4986,0.4951,0.359,2.6]]},"Drone_Delivery_A":{"props":[[0.207,0.207,1],[0.781,0.207,-1],[0.207,0.781,-1],[0.781,0.781,1]]},"Treadmill_A":{"belt":[0.2734,0.3086,0.7266,0.8711,0.3906]},"Robot_Arm_Industrial_A":{"arm":{"pivot":[0.4975,0.6238],"split":0.4609,"reach":0.08,"rod":0.066,"claws":[[0.4648,0.1211],[0.5352,0.1211]]}},"Generator_Portable_A":{"fans":[[0.3469,0.4934,0.1621]],"bars":[0.25,0.2305,0.3633,0.2617,6],"lamps":[[0.4895,0.248,0.027,1]]},"Cooling_Unit_A":{"fans":[[0.3654,0.4813,0.1367],[0.7387,0.4809,0.1406]]},"Server_Rack_A":{"leds":[438,227,0,555,227,0,570,227,0,586,227,0,594,227,0,621,227,0,629,227,0,656,227,0,578,245,0,621,245,0,631,245,0,643,245,0,430,246,0,577,253,0,332,254,0,383,254,0,438,254,0,535,254,0,547,254,0,594,254,0,607,254,0,617,254,0,629,254,0,637,254,0,660,254,0,574,256,0,520,263,0,547,262,0,555,262,0,602,263,0,609,263,0,619,263,0,648,263,0,352,264,0,383,264,0,391,264,0,426,264,0,457,264,0,469,264,0,570,264,0,582,264,0,629,264,0,641,264,0,660,264,0,613,281,0,633,281,0,641,281,0,660,281,0,520,289,0,543,289,0,562,287,0,574,287,0,628,289,0,387,290,0,531,290,0,560,290,0,570,289,0,578,289,0,595,290,0,605,290,0,615,289,0,574,291,0,586,291,0,539,296,0,418,297,0,469,297,0,531,298,0,551,297,0,562,298,0,574,297,0,584,298,0,594,297,0,605,297,0,617,298,0,520,299,0,438,322,0,471,323,0,520,323,0,531,323,0,551,322,0,572,322,0,586,322,0,613,322,0,641,322,0,418,324,0,461,324,0,582,324,0,543,330,0,336,332,0,348,332,0,355,332,0,398,332,0,410,332,0,418,332,0,434,332,0,457,332,0,535,332,0,586,332,0,594,332,0,605,332,0,617,332,0,625,332,0,559,349,0,431,354,0,473,350,0,578,350,0,457,352,0,535,357,0,543,357,0,551,357,0,660,357,0,336,359,0,424,359,0,409,362,0,441,361,0,451,366,0,422,363,0,562,366,0,574,365,0,408,368,0,336,369,0,391,369,0,383,386,0,566,385,0,633,385,0,357,394,0,418,394,0,457,394,0,566,393,0,625,393,0,332,402,0,348,402,0,359,402,0,406,402,0,426,402,0,547,402,0,605,402,0,641,402,0,418,404,0,355,430,0,371,430,0,379,430,0,457,430,0,633,430,0,660,430,0,336,432,0,336,440,0,348,439,0,357,439,0,367,439,0,395,439,0,555,439,0,586,439,0,641,439,0,336,453,0,359,453,0,406,453,0,438,454,0,555,453,0,566,453,0,641,453,0,369,455,0,381,455,0,395,455,0,402,455,0,414,455,0,469,455,0,545,461,0,555,461,0,598,461,0,617,461,0,629,461,0,641,461,0,660,461,0,336,463,0,348,463,0,355,463,0,404,463,0,414,463,0,438,463,0,445,463,0,469,463,0,336,472,0,348,472,0,359,472,0,383,472,0,426,471,0,555,471,0,566,471,0,337,493,0,348,494,0,359,493,0,367,493,0,375,493,0,383,493,0,391,493,0,398,493,0,406,492,0,441,492,0,449,493,0,457,493,0,473,493,0,539,493,0,574,492,0,652,493,0,660,505,0,336,506,0,355,506,0,367,506,0,383,506,0,414,506,0,426,506,0,461,506,0,660,522,0,359,529,0,406,529,0,574,530,0,619,530,0,629,530,0,660,530,0,332,531,0,383,531,0,641,531,0,652,531,0,617,539,0,630,538,0,641,539,0,652,539,0,660,538,0,608,540,0,332,541,0,641,553,0,652,553,0,641,559,0,336,561,0,359,561,0,383,561,0,395,561,0,426,561,0,449,561,0,531,561,0,576,561,0,588,561,0,619,561,0,629,561,0,637,561,0,650,561,0,662,561,0,566,572,0,574,572,0,604,573,0,629,572,0,639,574,0,650,573,0,424,574,0,594,574,0,664,574,0,414,578,0,434,578,0,441,578,0,459,578,0,336,582,0,523,582,0,535,582,0,547,582,0,559,582,0,566,582,0,574,583,0,605,583,0,617,582,0,625,582,0,457,584,0,637,584,0,406,586,0,416,586,0,469,586,0,586,590,0,598,590,0,605,590,0,408,592,0,545,592,0,555,592,0,566,592,0,576,592,0,609,592,0,617,592,0,631,592,0,660,592,0,523,613,0,535,614,0,550,615,0,641,613,0,336,615,0,406,615,0,598,615,0,652,615,0,545,623,0,574,623,0,590,623,0,598,623,0,609,623,0,641,623,0,652,623,0,547,645,0,559,645,0,566,645,0,652,645,0,359,646,0,471,646,0,471,654,0,535,654,0,547,654,0,559,654,0,586,654,0,609,654,0,621,654,0,641,654,0,523,666,0,555,668,0,598,668,0,359,670,0,402,670,0,439,670,0,449,670,0,459,670,0,535,676,0,566,676,0,395,678,0,402,678,0,428,678,0,438,678,0,449,678,0,473,678,0,547,684,0,586,684,0,598,684,0,359,686,0,422,686,0,457,686,0,469,686,0],"ledSize":0.0063},"Server_Rack_B":{"leds":[445,303,1,459,303,1,475,303,1,488,303,1,516,303,1,551,303,0,518,309,1,551,309,0,566,309,0,547,311,0,430,322,1,461,322,1,551,322,0,566,322,0,551,328,0,566,328,0,547,330,0,531,340,0,547,340,0,570,340,0,445,342,1,516,342,1,551,342,0,566,342,0,570,346,0,566,348,0,445,359,1,516,359,1,549,361,0,568,361,0,461,361,1,473,361,1,549,365,0,570,365,0,566,367,0,461,379,1,549,380,0,566,379,0,574,380,0,551,386,0,574,386,0,568,390,0,555,391,0,551,395,0,553,405,0,578,396,0,475,398,1,539,399,0,581,404,0,461,400,1,547,402,0,568,410,0,529,414,0,546,426,0,461,418,1,473,418,1,573,423,0,538,441,0,574,438,0,551,439,0,570,439,0,537,445,0,531,455,0,568,455,0,535,457,0,543,457,0,572,460,0,531,459,0,549,459,0,549,464,0,566,464,0,549,475,0,566,475,0,543,477,0,559,479,0,543,484,0,566,482,0,551,484,0,542,495,0,570,494,0,566,496,0,566,502,0,549,514,0,566,514,0,570,516,0,547,520,0,570,520,0,551,521,0,543,533,0,551,533,0,566,533,0,531,535,0,549,540,0,570,540,0,473,553,1,543,553,0,551,559,0,569,559,0,547,561,0,445,572,1,551,572,0,566,572,0,531,574,0,548,579,0,570,578,0,445,592,1,488,592,1,516,592,1,543,592,0,551,592,0,566,592,0,516,598,1,551,598,0,566,598,0,547,600,0,461,611,1,551,611,0,551,617,0,566,617,0,547,619,0,430,631,1,461,631,1,475,631,1,574,637,0,570,639,0,461,649,1,551,648,0,566,648,0,445,650,1,543,650,0,547,654,0,570,654,0,566,656,0,543,669,0,568,669,0,461,670,1,549,674,0,570,674,0,445,688,1,461,688,1,473,688,1,543,688,0,551,689,0,570,689,0,549,693,0,568,694,0,432,707,1,457,707,1,551,707,0,566,707,0,461,709,1,547,709,0,570,709,0,547,714,0,568,714,0,527,727,0,551,727,0,566,727,0,551,733,0,566,732,0,570,734,0,457,746,1,543,746,0,551,752,0,566,752,0,570,754,0,461,766,1,551,766,0,566,766,0,551,771,0,566,771,0,547,783,0,570,783,0,445,785,1,461,785,1,551,785,0,566,785,0,566,791,0,445,804,1,461,804,1,549,804,0,568,804,0,516,809,1,549,809,0,570,809,0,566,811,0,445,822,1,461,822,1,551,822,0,566,822,0,551,829,0,566,828,0,570,830,0,445,842,1,473,842,1,516,842,1,551,842,0,566,842,0,549,849,0,566,848,0,570,850,0],"ledSize":0.0063}};

// Свои ассеты Картографа (паровой Иерихон): сигнальный маяк — разряды от линзы
// к латунному кольцу. arcs: [cx, cy, внутренний радиус, внешний, сколько разом,
// цвет сердцевины, цвет ореола] — доли ширины картинки.
LAYOUTS.Signal_Beacon_Arcane_A = { arcs: [0.499, 0.498, 0.165, 0.405, 3, 0xeaf7ff, 0x5cb8ff] };

/** Ключ раскладки: пометка `machine` или имя картинки тайла. */
function keyOf(doc) {
  const own = doc?.flags?.[MODULE_ID]?.machine;
  if (own && LAYOUTS[own]) return own;
  const src = doc?.texture?.src ?? "";
  return Object.keys(LAYOUTS).find((k) => src.toLowerCase().includes(k.toLowerCase())) ?? null;
}

/** @type {Map<string, {tile: Tile, key: string, box: PIXI.Container, fans: object[], leds: PIXI.Graphics|null, tex: any}>} */
const machines = new Map();
let ticking = false;

function hash(n) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

const ARM_DIR = `modules/${MODULE_ID}/assets/machines`;
// Ключевые кадры руки: [секунда, поворот (рад), вытянута 0..1, хват 0 открыт .. 1 сжат].
const ARM_KEYS = [
  [0, 0, 0, 0], [1.5, 0, 0.9, 0], [2.3, 0, 0.9, 1], [3.6, 0, 0.1, 1],
  [6, 0.95, 0.1, 1], [7, 0.95, 0.85, 1], [7.8, 0.95, 0.85, 0], [9, 0.95, 0, 0],
  [11.5, -0.7, 0, 0], [12.5, -0.7, 0.6, 0], [13.3, -0.7, 0.6, 1], [14.3, -0.7, 0, 1],
  [16.5, 0, 0, 1], [17.3, 0, 0, 0], [18, 0, 0, 0]
];

function armPose(t) {
  const T = ARM_KEYS.at(-1)[0];
  t = ((t % T) + T) % T;
  let i = 0;
  while (i < ARM_KEYS.length - 2 && ARM_KEYS[i + 1][0] <= t) i++;
  const a = ARM_KEYS[i], b = ARM_KEYS[i + 1];
  let u = (t - a[0]) / (b[0] - a[0]);
  u = u * u * (3 - 2 * u);
  return [1, 2, 3].map((k) => a[k] + (b[k] - a[k]) * u);
}

function buildArm(m, key) {
  const load = foundry.canvas?.loadTexture ?? globalThis.loadTexture;
  const parts = ["base", "lower", "upper", "claw_l", "claw_r"];
  const arm = { ready: false, rot: new PIXI.Container(), up: new PIXI.Container(), rod: new PIXI.Graphics(), s: {} };
  for (const n of parts) arm.s[n] = new PIXI.Sprite(PIXI.Texture.EMPTY);
  arm.up.addChild(arm.s.upper, arm.s.claw_l, arm.s.claw_r);
  arm.rot.addChild(arm.rod, arm.up, arm.s.lower);
  // Тень руки: те же детали чёрным, сдвиг вправо-вниз, лёгкое размытие.
  arm.sh = new PIXI.Container();
  arm.shUp = new PIXI.Sprite(PIXI.Texture.EMPTY);
  arm.shLo = new PIXI.Sprite(PIXI.Texture.EMPTY);
  for (const sp of [arm.shUp, arm.shLo]) sp.tint = 0x000000;
  arm.sh.addChild(arm.shUp, arm.shLo);
  arm.sh.alpha = 0.38;
  arm.sh.filters = [new PIXI.BlurFilter(3)];
  m.box.addChild(arm.s.base, arm.sh, arm.rot);
  m.arm = arm;
  Promise.all(parts.map((n) => load(`${ARM_DIR}/${key}/${n}.webp?v=4`))).then((tx) => {
    parts.forEach((n, i) => { if (tx[i]) arm.s[n].texture = tx[i]; });
    if (tx[1]) arm.shLo.texture = tx[1];
    if (tx[2]) arm.shUp.texture = tx[2];
    arm.ready = tx.every(Boolean);
  }).catch((e) => console.warn(`${MODULE_ID} | рука ${key}:`, e));
}

function drawArm(m, t, x0, y0, tw, th) {
  const A = LAYOUTS[m.key].arm, arm = m.arm;
  const tm = m.tile.mesh;
  if (!arm.ready) { tm.renderable = true; return; }
  tm.renderable = false; // исходную картинку заменяют детали
  const [px, py] = A.pivot;
  const [ang, ext, grip] = armPose(t + m.seed);
  const place = (sp, ax, ay, x, y) => { sp.anchor.set(ax, ay); sp.width = tw; sp.height = th; sp.position.set(x, y); };
  place(arm.s.base, 0, 0, x0, y0);
  arm.rot.position.set(x0 + px * tw, y0 + py * th);
  arm.rot.rotation = ang;
  place(arm.s.lower, px, py, 0, 0);
  place(arm.s.upper, px, py, 0, 0);
  const lift = ext * A.reach * th;
  arm.up.position.set(0, -lift);
  arm.sh.position.set(arm.rot.x + 0.012 * tw, arm.rot.y + 0.012 * th);
  arm.sh.rotation = ang;
  place(arm.shLo, px, py, 0, 0);
  place(arm.shUp, px, py, 0, -lift);
  const [[lx, ly], [rx, ry]] = A.claws;
  place(arm.s.claw_l, lx, ly, (lx - px) * tw, (ly - py) * th);
  place(arm.s.claw_r, rx, ry, (rx - px) * tw, (ry - py) * th);
  arm.s.claw_l.rotation = (-8 + 20 * grip) * Math.PI / 180;
  arm.s.claw_r.rotation = (8 - 20 * grip) * Math.PI / 180;
  // Шток телескопа: хромированный цилиндр из горловины нижнего звена к верхнему.
  const ys = (A.split - py) * th, w = A.rod * tw;
  const top = ys - lift - 0.006 * th, bot = ys + 0.026 * th;
  const g = arm.rod.clear();
  const bands = [0x23272c, 0x4a5058, 0x8a929b, 0xc9d0d6, 0xeef2f5, 0xb3bac2, 0x6d747c, 0x3a3f45, 0x1d2024];
  const bw = w / bands.length;
  bands.forEach((c, i) => g.beginFill(c).drawRect(-w / 2 + i * bw, top, bw + 0.3, bot - top).endFill());
  // Тёмный обжим там, где шток выходит из горловины и входит в верхнее звено.
  g.beginFill(0x15181b, 0.9).drawRect(-w / 2 - 1, bot - 0.008 * th, w + 2, 0.008 * th).endFill();
  g.beginFill(0x15181b, 0.6).drawRect(-w / 2, top, w, 0.005 * th).endFill();
}

// Винты: картинка без лопастей (base) + лопасти каждого винта отдельно (prop_i).
function buildProps(m, key) {
  const L = LAYOUTS[key];
  const load = foundry.canvas?.loadTexture ?? globalThis.loadTexture;
  const pr = { ready: false, base: new PIXI.Sprite(PIXI.Texture.EMPTY), items: [] };
  m.box.addChild(pr.base);
  L.props.forEach((q, i) => {
    const a = new PIXI.Sprite(PIXI.Texture.EMPTY), b = new PIXI.Sprite(PIXI.Texture.EMPTY);
    b.alpha = 0.4;
    m.box.addChild(b, a);
    pr.items.push({ q, a, b, angle: hash(i + 7) * 6.28 });
  });
  m.props = pr;
  const names = ["base", ...L.props.map((_, i) => `prop_${i}`)];
  Promise.all(names.map((n) => load(`${ARM_DIR}/${key}/${n}.webp?v=1`))).then((tx) => {
    if (tx[0]) pr.base.texture = tx[0];
    pr.items.forEach((it, i) => { if (tx[i + 1]) { it.a.texture = tx[i + 1]; it.b.texture = tx[i + 1]; } });
    pr.ready = tx.every(Boolean);
  }).catch((e) => console.warn(`${MODULE_ID} | винты ${key}:`, e));
}

function drawProps(m, dt, x0, y0, tw, th) {
  const pr = m.props, tm = m.tile.mesh;
  if (!pr.ready) { tm.renderable = true; return; }
  tm.renderable = false;
  pr.base.position.set(x0, y0); pr.base.width = tw; pr.base.height = th;
  for (const it of pr.items) {
    const [hx, hy, dir] = it.q;
    it.angle = (it.angle + dt * 19 * dir) % (Math.PI * 2);
    for (const [sp, off] of [[it.a, 0], [it.b, -0.45 * dir]]) {
      sp.anchor.set(hx, hy); sp.width = tw; sp.height = th;
      sp.position.set(x0 + hx * tw, y0 + hy * th);
      sp.rotation = it.angle + off;
    }
  }
}

// Лента: бесшовный кусок (belt.webp) прокручивается под маской; бежит и останавливается.
function buildBelt(m, key) {
  const load = foundry.canvas?.loadTexture ?? globalThis.loadTexture;
  const bl = { ready: false, ts: null, mask: new PIXI.Graphics(), off: 0, v: 0 };
  m.box.addChild(bl.mask);
  m.belt = bl;
  load(`${ARM_DIR}/${key}/belt.webp?v=1`).then((tex) => {
    if (!tex || m.box.destroyed) return;
    bl.ts = new PIXI.TilingSprite(tex, 10, 10);
    bl.ts.mask = bl.mask;
    m.box.addChildAt(bl.ts, 0);
    bl.ready = true;
  }).catch((e) => console.warn(`${MODULE_ID} | лента ${key}:`, e));
}

function drawBelt(m, dt, t, x0, y0, tw, th) {
  const bl = m.belt;
  if (!bl.ready) return;
  const [bx0, by0, bx1, by1, tileH] = LAYOUTS[m.key].belt;
  const x = x0 + bx0 * tw, y = y0 + by0 * th, w = (bx1 - bx0) * tw, h = (by1 - by0) * th;
  bl.ts.position.set(x, y); bl.ts.width = w; bl.ts.height = h;
  const sc = (tileH * th) / bl.ts.texture.height;
  bl.ts.tileScale.set(w / bl.ts.texture.width, sc);
  if (bl.w !== w || bl.h !== h) { bl.mask.clear().beginFill(0xffffff).drawRect(x, y, w, h).endFill(); bl.w = w; bl.h = h; }
  // 9 с бежит, 5 с стоит; разгон и торможение плавные.
  const ph = (t + m.seed) % 14;
  const target = ph < 9 ? 1 : 0;
  bl.v += (target - bl.v) * Math.min(1, dt * 1.6);
  bl.off += dt * bl.v * th * 0.16;
  bl.ts.tilePosition.y = bl.off;
}

// Винты с ребра: [ступица x, y, кончик слева, кончик справа, край ступицы слева,
// справа, верх лопастей, низ, направление]. Лопасти вырезаны из картинки тайла
// маской; основа — та же картинка без лопастей, ступица остаётся на ней поверх.
function buildRotors(m, key) {
  const rt = { base: new PIXI.Sprite(PIXI.Texture.EMPTY), baseMask: new PIXI.Graphics(), items: [], geo: "" };
  LAYOUTS[key].rotors.forEach((q, i) => {
    const pair = [0, 1].map(() => {
      const c = new PIXI.Container(), s = new PIXI.Sprite(PIXI.Texture.EMPTY), g = new PIXI.Graphics();
      c.addChild(s, g);
      s.mask = g;
      return { c, s, g };
    });
    pair[1].c.alpha = 0.35;
    m.box.addChild(pair[1].c, pair[0].c);
    rt.items.push({ q, a: pair[0], b: pair[1], angle: hash(i + 11) * 6.28 });
  });
  m.box.addChild(rt.base, rt.baseMask);
  rt.base.mask = rt.baseMask;
  m.rotors = rt;
}

/** Прямоугольники [x0, y0, x1, y1] без вырезов — полосами по высоте. */
function without(full, holes) {
  const ys = [...new Set([full[1], full[3], ...holes.flatMap((h) => [h[1], h[3]])])].filter((y) => y >= full[1] && y <= full[3]).sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i + 1 < ys.length; i++) {
    const [y0, y1] = [ys[i], ys[i + 1]];
    const cut = holes.filter((h) => h[1] <= y0 && h[3] >= y1).map((h) => [h[0], h[2]]).sort((a, b) => a[0] - b[0]);
    let x = full[0];
    for (const [a, b] of cut) {
      if (a > x) out.push([x, y0, a, y1]);
      x = Math.max(x, b);
    }
    if (x < full[2]) out.push([x, y0, full[2], y1]);
  }
  return out;
}

function drawRotors(m, dt, x0, y0, tw, th, tex) {
  const rt = m.rotors;
  m.tile.mesh.renderable = false;
  if (rt.base.texture !== tex) rt.base.texture = tex;
  rt.base.position.set(x0, y0);
  rt.base.width = tw;
  rt.base.height = th;
  const geo = `${x0}|${y0}|${tw}|${th}`;
  if (rt.geo !== geo) {
    rt.geo = geo;
    const blades = rt.items.flatMap(({ q }) => [[q[2], q[6], q[4], q[7]], [q[5], q[6], q[3], q[7]]]);
    rt.baseMask.clear().beginFill(0xffffff);
    for (const [a, b, c, d] of without([0, 0, 1, 1], blades)) rt.baseMask.drawRect(x0 + a * tw, y0 + b * th, (c - a) * tw, (d - b) * th);
    rt.baseMask.endFill();
    for (const it of rt.items) {
      const [px, py, l, r, hl, hr, top, bot] = it.q;
      for (const p of [it.a, it.b]) {
        p.c.position.set(x0 + px * tw, y0 + py * th);
        p.s.position.set(-px * tw, -py * th);
        p.g.clear().beginFill(0xffffff)
          .drawRect((l - px) * tw, (top - py) * th, (hl - l) * tw, (bot - top) * th)
          .drawRect((hr - px) * tw, (top - py) * th, (r - hr) * tw, (bot - top) * th)
          .endFill();
      }
    }
  }
  for (const it of rt.items) {
    const dir = it.q[8] ?? 1;
    it.angle = (it.angle + dt * 11 * dir) % (Math.PI * 2);
    for (const [p, off] of [[it.a, 0], [it.b, -0.55 * dir]]) {
      if (p.s.texture !== tex) p.s.texture = tex;
      const c = Math.cos(it.angle + off);
      p.c.scale.set(Math.abs(c) < 0.03 ? Math.sign(c || 1) * 0.03 : c, 1);
    }
  }
}

// Руны: из картинки остаётся только голубое, поверх складывается светом —
// чёткий слой и размытый ореол. Оба запекаются один раз (фильтры внутри
// основной группы холста Foundry не рисуются), дальше дышит лишь яркость.
const RUNE_FRAG = `
varying vec2 vTextureCoord;
uniform sampler2D uSampler;
uniform vec3 uColor;
uniform float uGlow;
void main() {
  vec4 c = texture2D(uSampler, vTextureCoord);
  vec3 rgb = c.a > 0.0 ? c.rgb / c.a : vec3(0.0);
  float cyan = smoothstep(0.05, 0.15, min(rgb.g, rgb.b) - rgb.r);
  float a = cyan * c.a * uGlow;
  gl_FragColor = vec4(uColor * a, a);
}`;

function buildRunes(m, key) {
  const sharp = new PIXI.Sprite(PIXI.Texture.EMPTY), halo = new PIXI.Sprite(PIXI.Texture.EMPTY);
  for (const s of [halo, sharp]) {
    s.blendMode = PIXI.BLEND_MODES.ADD;
    s.visible = false;
  }
  m.box.addChild(halo, sharp);
  m.runes = { sharp, halo, col: LAYOUTS[key].runes, baked: null };
}

function dropRunes(m) {
  for (const b of m.runes?.baked ?? []) b.rt.destroy(true);
  if (m.runes) m.runes.baked = null;
}

function drawRunes(m, t, x0, y0, tw, th, tex) {
  const r = m.runes;
  if (tex?.valid && r.baked?.[0].tex !== tex) {
    dropRunes(m);
    const only = () => new PIXI.Filter(undefined, RUNE_FRAG, { uColor: new Float32Array(r.col), uGlow: 1 });
    r.baked = [bakeTexture(tex, { scale: 0.5, blur: 1, filters: [only()] }), bakeTexture(tex, { scale: 0.25, blur: Math.max(2, tw * 0.004), filters: [only()] })];
  }
  if (!r.baked) return;
  for (const [s, b] of [[r.sharp, r.baked[0]], [r.halo, r.baked[1]]]) {
    placeBaked(s, b, 0, 0);
    s.position.set(x0, y0);
    s.scale.set(1 / b.scale);
    s.visible = true;
  }
  // Медленный вдох и редкая дрожь, будто по рунам проходит заряд.
  const breath = 0.5 + 0.5 * Math.sin(t * 1.25 + m.seed);
  const flick = Math.sin(t * 17 + m.seed * 3) > 0.96 ? 0.25 : 0;
  r.sharp.alpha = Math.min(1, 0.3 + 0.45 * breath + flick);
  r.halo.alpha = Math.min(1, 0.45 + 0.55 * breath + flick);
}

// Разряды: ломаные от края линзы к кольцу, как у катушки Теслы. Каждые
// 60–140 мс — новый рисунок (2–3 дуги, иногда с отростком), между вспышками
// дуги гаснут; ореол — та же ломаная толще и прозрачнее (фильтры размытия в
// основной группе холста не рисуются). Линза под ними мерцает.
/** Мягкое пятно света (радиальный градиент): у залитого круга PIXI при сложении
 * цветов виден шов по диаметру. */
let glowTex = null;
function glowTexture() {
  if (glowTex && !glowTex.baseTexture?.destroyed) return glowTex;
  const n = 128, cv = document.createElement("canvas");
  cv.width = cv.height = n;
  const g = cv.getContext("2d"), gr = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
  gr.addColorStop(0, "rgba(255,255,255,1)");
  gr.addColorStop(0.45, "rgba(255,255,255,0.45)");
  gr.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = gr;
  g.fillRect(0, 0, n, n);
  glowTex = PIXI.Texture.from(cv);
  return glowTex;
}

function buildArcs(m, key) {
  const lens = new PIXI.Sprite(glowTexture()), halo = new PIXI.Graphics(), core = new PIXI.Graphics();
  lens.anchor.set(0.5);
  for (const g of [lens, halo, core]) g.blendMode = PIXI.BLEND_MODES.ADD;
  m.box.addChild(lens, halo, core);
  m.arcs = { lens, halo, core, L: LAYOUTS[key].arcs, next: 0, life: 0, paths: [], n: 0 };
}

function zigzag(m, from, to, steps, jitter) {
  const pts = [from];
  const [dx, dy] = [to[0] - from[0], to[1] - from[1]];
  const len = Math.hypot(dx, dy) || 1;
  const [nx, ny] = [-dy / len, dx / len];
  for (let i = 1; i < steps; i++) {
    const u = i / steps;
    const j = (hash(m.arcs.n * 13.7 + i * 3.1 + m.seed) - 0.5) * 2 * jitter * Math.sin(Math.PI * u);
    pts.push([from[0] + dx * u + nx * j, from[1] + dy * u + ny * j]);
  }
  pts.push(to);
  return pts;
}

function drawArcs(m, t, dt, x0, y0, tw) {
  const a = m.arcs;
  const [fx, fy, r0, r1, many, coreCol, haloCol] = a.L;
  const cx = x0 + fx * tw, cy = y0 + fy * tw;
  if (t >= a.next) {
    a.n++;
    a.next = t + 0.06 + hash(a.n * 1.7 + m.seed) * 0.08;
    a.life = 1;
    a.paths = [];
    const count = 1 + Math.floor(hash(a.n * 5.3 + m.seed) * many);
    for (let i = 0; i < count; i++) {
      const th = hash(a.n * 7.1 + i * 2.9 + m.seed) * Math.PI * 2;
      const tt = th + (hash(a.n * 3.3 + i * 8.1) - 0.5) * 1.1;
      const ro = r1 * (0.86 + 0.14 * hash(a.n + i * 4.4));
      const from = [cx + Math.cos(th) * r0 * tw, cy + Math.sin(th) * r0 * tw];
      const to = [cx + Math.cos(tt) * ro * tw, cy + Math.sin(tt) * ro * tw];
      const path = zigzag(m, from, to, 7, tw * 0.035);
      a.paths.push(path);
      // Отросток: из середины дуги вбок, короче.
      if (hash(a.n * 9.9 + i) > 0.55) {
        const k = 2 + Math.floor(hash(a.n + i * 6.6) * 3);
        const b0 = path[k];
        const tb = tt + (hash(a.n * 2.2 + i) - 0.5) * 1.4;
        const rb = r0 + (r1 - r0) * (0.55 + 0.3 * hash(a.n * 4.8 + i));
        a.paths.push(zigzag(m, b0, [cx + Math.cos(tb) * rb * tw, cy + Math.sin(tb) * rb * tw], 4, tw * 0.025));
      }
    }
  }
  a.life = Math.max(0, a.life - dt * 9);
  const flash = a.life;
  const { halo, core, lens } = a;
  halo.clear();
  core.clear();
  for (const path of a.paths) {
    halo.lineStyle({ width: tw * 0.04, color: haloCol, alpha: 0.42 * flash, cap: "round", join: "round" });
    halo.moveTo(...path[0]);
    for (const q of path.slice(1)) halo.lineTo(...q);
    core.lineStyle({ width: tw * 0.008, color: coreCol, alpha: 0.95 * flash, cap: "round", join: "round" });
    core.moveTo(...path[0]);
    for (const q of path.slice(1)) core.lineTo(...q);
  }
  // Линза: слабое голубое свечение по краю и вспышка при разряде (не до белого).
  lens.position.set(cx, cy);
  lens.width = lens.height = r0 * tw * 3.2;
  lens.tint = haloCol;
  lens.alpha = 0.1 + 0.05 * Math.sin(t * 3.1 + m.seed) + 0.3 * flash;
}

function build(tile, key) {
  const tm = tile.mesh;
  if (!tm) return null;
  const L = LAYOUTS[key];
  const box = new PIXI.Container();
  box.name = `${MODULE_ID}.machine.${tile.id}`;
  box.eventMode = "none";
  canvas.primary.addChild(box);
  const m = { tile, key, box, fans: [], leds: null, tex: null, sortedFor: null, seed: hash(tile.id.length + tile.id.charCodeAt(0)) * 100 };
  if (L.fans) {
    for (const [i, f] of L.fans.entries()) {
      const mask = new PIXI.Graphics(), mask2 = new PIXI.Graphics();
      const a = new PIXI.Sprite(tm.texture), b = new PIXI.Sprite(tm.texture);
      b.alpha = 0.45;
      box.addChild(a, b, mask, mask2);
      a.mask = mask;
      b.mask = mask2;
      m.fans.push({ f, a, b, mask, mask2, speed: f[3] ?? 5.5 + i * 0.9, angle: hash(i + 3) * 6.28 });
    }
  }
  if (L.arm) buildArm(m, key);
  if (L.props) buildProps(m, key);
  if (L.belt) buildBelt(m, key);
  if (L.rotors) buildRotors(m, key);
  if (L.runes) buildRunes(m, key);
  if (L.arcs) buildArcs(m, key);
  if (L.leds || L.bars || L.lamps) {
    m.leds = new PIXI.Graphics();
    box.addChild(m.leds);
  }
  return m;
}

function drop(id) {
  const m = machines.get(id);
  if (!m) return;
  if ((m.arm || m.props || m.rotors) && m.tile.mesh && !m.tile.mesh.destroyed) m.tile.mesh.renderable = true;
  dropRunes(m);
  if (!m.box.destroyed) m.box.destroy({ children: true });
  machines.delete(id);
}

export function clearMachines() {
  for (const id of [...machines.keys()]) drop(id);
}

export function rebuildMachines() {
  clearMachines();
  if (!canvas.ready || !canvas.tiles || !game.settings.get(MODULE_ID, "enabled")) return;
  for (const tile of canvas.tiles.placeables) {
    const key = keyOf(tile.document);
    if (!key) continue;
    const m = build(tile, key);
    if (m) machines.set(tile.id, m);
  }
  if (machines.size && !ticking) {
    canvas.app.ticker.add(tick);
    ticking = true;
  }
}

function tick() {
  if (!machines.size || !canvas.ready) {
    canvas.app?.ticker.remove(tick);
    ticking = false;
    return;
  }
  const dt = Math.min(canvas.app.ticker.deltaMS / 1000, 0.1);
  const t = performance.now() / 1000;
  for (const m of machines.values()) draw(m, dt, t);
}

function draw(m, dt, t) {
  const { tile, box } = m;
  const tm = tile.mesh;
  if (!tm || tm.destroyed || box.destroyed) return;
  box.position.copyFrom(tm.position);
  box.scale.copyFrom(tm.scale);
  box.skew.copyFrom(tm.skew);
  box.pivot.copyFrom(tm.pivot);
  box.rotation = tm.rotation;
  box.elevation = tm.elevation;
  box.sortLayer = tm.sortLayer;
  box.sort = (tm.sort ?? 0) + 0.5;
  if (m.sortedFor !== tm) { canvas.primary.sortDirty = true; m.sortedFor = tm; }
  box.visible = tm.visible && (m.arm || m.props || m.rotors || tm.renderable !== false) && tile.visible !== false;
  box.alpha = tm.alpha ?? 1;
  const tex = tm.texture;
  const tw = tex.orig?.width ?? tex.width, th = tex.orig?.height ?? tex.height;
  const x0 = -(tm.anchor?.x ?? 0.5) * tw, y0 = -(tm.anchor?.y ?? 0.5) * th;

  if (m.arm) drawArm(m, t, x0, y0, tw, th);
  if (m.props) drawProps(m, dt, x0, y0, tw, th);
  if (m.belt) drawBelt(m, dt, t, x0, y0, tw, th);
  if (m.rotors) drawRotors(m, dt, x0, y0, tw, th, tex);
  if (m.runes) drawRunes(m, t, x0, y0, tw, th, tex);
  if (m.arcs) drawArcs(m, t, dt, x0, y0, tw);

  // Вентиляторы: круг картинки крутится, второй слой со сдвигом — размытие движения.
  for (const fan of m.fans) {
    const [fx, fy, fr] = fan.f;
    const cx = x0 + fx * tw, cy = y0 + fy * th, r = fr * tw;
    if (fan.a.texture !== tex) { fan.a.texture = tex; fan.b.texture = tex; }
    if (fan.r !== r || fan.cx !== cx || fan.cy !== cy) {
      for (const g of [fan.mask, fan.mask2]) g.clear().beginFill(0xffffff).drawCircle(cx, cy, r).endFill();
      for (const s of [fan.a, fan.b]) {
        s.anchor.set(fx, fy);
        s.position.set(cx, cy);
      }
      fan.r = r; fan.cx = cx; fan.cy = cy;
    }
    fan.angle = (fan.angle + dt * fan.speed) % (Math.PI * 2);
    fan.a.rotation = fan.angle;
    fan.b.rotation = fan.angle - 0.22;
  }

  // Огоньки: большинство горит ровно, часть мигает каждый в своём ритме.
  if (m.leds) m.leds.clear();
  const LL = LAYOUTS[m.key];
  // Полоски заряда: набираются по одной, полная — мерцает, потом сначала.
  if (LL.bars) {
    const [bx0, by0, bx1, by1, n] = LL.bars;
    const g = m.leds;
    const bw = ((bx1 - bx0) * tw) / n, bh = (by1 - by0) * th;
    const k = Math.floor((t * 1.1 + m.seed) % (n + 2));
    const shown = Math.min(n, 2 + k);
    for (let i = shown; i < n; i++) {
      g.beginFill(0x07181b, 0.88).drawRect(x0 + bx0 * tw + i * bw, y0 + by0 * th, bw, bh).endFill();
    }
    if (shown === n) {
      const a = 0.25 + 0.25 * Math.sin(t * 9);
      g.beginFill(0x9ffcff, Math.max(0, a)).drawRect(x0 + bx0 * tw, y0 + by0 * th, bw * n, bh).endFill();
    }
  }
  // Лампы: тлеют и вспыхивают; изредка гаснут.
  if (LL.lamps) {
    const g = m.leds;
    for (const [i, [lx, ly, lr, c]] of LL.lamps.entries()) {
      const x = x0 + lx * tw, y = y0 + ly * th, r = lr * tw;
      const ph = (t * 0.8 + hash(i + m.seed)) % 1;
      const col = c ? 0xff7cf0 : 0x9ffcff;
      if (ph < 0.12) g.beginFill(0x1a0d1c, 0.8).drawCircle(x, y, r * 1.05).endFill();
      else {
        const a = 0.15 + 0.35 * Math.max(0, Math.sin(t * 5 + i));
        g.beginFill(col, a * 0.5).drawCircle(x, y, r * 1.7).endFill();
        g.beginFill(0xffffff, a * 0.6).drawCircle(x, y, r * 0.45).endFill();
      }
    }
  }
  if (m.leds && LL.leds) {
    const L = LL;
    const g = m.leds;
    const sz = Math.max(1.2, L.ledSize * tw);
    const leds = L.leds;
    for (let i = 0, n = 0; i < leds.length; i += 3, n++) {
      const h = hash(n + m.seed);
      if (h < 0.55) continue; // ровные
      const period = 0.35 + hash(n * 7.3 + m.seed) * 2.6;
      const phase = hash(n * 3.1 + m.seed);
      const on = ((t / period + phase) % 1) < (h < 0.8 ? 0.82 : 0.35);
      const x = x0 + (leds[i] / 1000) * tw, y = y0 + (leds[i + 1] / 1000) * th;
      if (on && h > 0.92) {
        g.beginFill(leds[i + 2] ? 0xff7cf0 : 0x9ffcff, 0.9).drawRect(x - sz, y - sz * 0.8, sz * 2, sz * 1.6).endFill();
      } else if (!on) {
        g.beginFill(0x15121c, 0.85).drawRect(x - sz * 1.1, y - sz * 0.9, sz * 2.2, sz * 1.8).endFill();
      }
    }
  }
}

/* ------------------------------ Окно тайла ------------------------------ */

const loc = (k) => game.i18n.localize(`BLM.${k}`);

Hooks.on("renderTileConfig", (app, element) => {
  const root = element instanceof HTMLElement ? element : element[0];
  const tab = root?.querySelector('.tab[data-tab="appearance"]') ?? root?.querySelector(".tab[data-tab]");
  if (!tab || tab.querySelector(`.${MODULE_ID}-machine`)) return;
  const now = app.document.flags?.[MODULE_ID]?.machine ?? "";
  const set = document.createElement("fieldset");
  set.className = `${MODULE_ID}-machine`;
  set.innerHTML = `
    <legend>🔥 ${loc("Machine.Title")}</legend>
    <div class="form-group">
      <label>${loc("Machine.Label")}</label>
      <div class="form-fields"><select name="flags.${MODULE_ID}.machine">
        ${["", ...Object.keys(LAYOUTS)].map((v) => `<option value="${v}" ${v === now ? "selected" : ""}>${loc(`Machine.${v || "none"}`)}</option>`).join("")}
      </select></div>
      <p class="hint">${loc("Machine.Hint")}</p>
    </div>`;
  tab.append(set);
});

/* ------------------------------ Хуки ------------------------------ */

export function registerMachines() {
  Hooks.on("canvasReady", () => rebuildMachines());
  Hooks.on("canvasTearDown", () => clearMachines());
  for (const hook of ["createTile", "updateTile", "deleteTile"]) {
    Hooks.on(hook, (doc) => {
      if (doc.parent !== canvas.scene) return;
      setTimeout(() => rebuildMachines(), 0);
    });
  }
  // Только что созданный тайл получает картинку позже createTile — ловим отрисовку.
  Hooks.on("drawTile", (tile) => {
    if (tile.document?.parent === canvas.scene && keyOf(tile.document) && !machines.has(tile.id)) setTimeout(() => rebuildMachines(), 0);
  });
}
