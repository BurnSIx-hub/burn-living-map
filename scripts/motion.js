// Движение тайлов: поворотный кран и вагонетки по рельсам.
//
// Кран (`flags.burn-living-map.slew` = [ось x, ось y, градусы]) медленно
// поворачивается вокруг оси — середины поворотной платформы, в долях картинки —
// на заданный угол и обратно, с остановками. Сторону выбрал Картограф при выгрузке:
// там стрела ни во что не упрётся. Тень — запечённая чёрная копия, от солнца.
//
// Вагонетка (`rail` = {path, lag, cargo}) ездит по пути: из депо (первая точка —
// рудник, тоннель) к концу, стоит под разгрузкой, возвращается и ждёт в темноте.
// Всё на одном пути — сцепка: голова и отставшие от неё на `lag` точек. Груз
// (`cargo`, руда в вагонетке) виден только по пути туда. Рядом слышен стук колёс
// по стыкам и гул — синтез Web Audio в контексте окружения Foundry (ползунок
// «Окружение»); громкость — по ближайшему слушателю, как у звуков сцены.
//
// Документы не меняются: двигает каждый у себя по общим часам (`Date.now`), так
// что у всех кран и вагонетки в одном месте. Foundry сам ставит мешу позицию и
// поворот при правке тайла — замечаем это по расхождению и берём за основу.

import { bakeTexture, placeBaked } from "./hover.js";

const MODULE_ID = "burn-living-map";
/** Куда падает тень, градусы по часовой от «вправо» — как у теней Картографа. */
const SUN = 45;

/* Кран: стоит, поворачивается, стоит, возвращается — секунды. */
const SLEW_HOLD = 7;
const SLEW_MOVE = 11;

/* Вагонетки: скорость туда и обратно (клеток в секунду), стоянки (секунды). */
const RAIL_OUT = 1.0;
const RAIL_BACK = 1.4;
const RAIL_UNLOAD = 6;
const RAIL_DEPOT = 9;
/** На сколько клеток от депо вагонетка выходит из темноты. */
const RAIL_FADE = 2.0;
/** Стыки рельсов, клетки; колёса одной вагонетки — через столько. */
const JOINT = 1.0;
const WHEELBASE = 0.55;
/** Слышно на столько клеток. */
const HEAR = 7;

/** @type {Map<string, object>} */
const movers = new Map();
/** @type {Map<string, object>} пути вагонеток: сцепка и её звук */
const trains = new Map();
let ticking = false;

function hash(s) {
  let h = 0;
  for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) | 0;
  const x = Math.sin(h) * 43758.5453;
  return x - Math.floor(x);
}

const smooth = (x) => x * x * (3 - 2 * x);
const clamp01 = (x) => Math.min(1, Math.max(0, x));

export function slewOf(doc) {
  const v = doc?.flags?.[MODULE_ID]?.slew;
  if (!Array.isArray(v) || v.length < 3) return null;
  const [ax, ay, deg] = v.map(Number);
  return [ax, ay, deg].every(Number.isFinite) && deg ? { ax, ay, arc: (deg * Math.PI) / 180 } : null;
}

export function railOf(doc) {
  const r = doc?.flags?.[MODULE_ID]?.rail;
  const path = (r?.path ?? []).filter((p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite));
  if (path.length < 2) return null;
  return { path, lag: Number(r.lag) || 0, cargo: !!r.cargo, key: JSON.stringify(path) };
}

/* ------------------------------ Путь ------------------------------ */

function measure(path) {
  const segs = [];
  let acc = 0;
  for (let i = 1; i < path.length; i++) {
    const [x0, y0] = path[i - 1], [x1, y1] = path[i];
    const len = Math.hypot(x1 - x0, y1 - y0);
    if (len < 1e-6) continue;
    segs.push({ x0, y0, dx: (x1 - x0) / len, dy: (y1 - y0) / len, len, at: acc, ang: Math.atan2(y1 - y0, x1 - x0) });
    acc += len;
  }
  return { segs, length: acc };
}

/** Точка и направление на пути на длине `s`; у излома угол плавно меняется. */
function pointAt(m, s, turn) {
  const segs = m.segs;
  s = Math.min(Math.max(s, 0), m.length);
  let i = segs.findIndex((g) => s <= g.at + g.len);
  if (i < 0) i = segs.length - 1;
  const g = segs[i];
  const u = s - g.at;
  let ang = g.ang;
  // Поворот в полклетки до и после излома.
  if (i + 1 < segs.length && g.len - u < turn) ang = mix(g.ang, segs[i + 1].ang, 0.5 * (1 - (g.len - u) / turn));
  else if (i > 0 && u < turn) ang = mix(segs[i - 1].ang, g.ang, 0.5 + 0.5 * (u / turn));
  return { x: g.x0 + g.dx * u, y: g.y0 + g.dy * u, ang };
}

function mix(a, b, k) {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return a + d * k;
}

/** Где на пути точка: длина до ближайшего места. */
function project(m, x, y) {
  let best = Infinity, at = 0;
  for (const g of m.segs) {
    const u = Math.min(Math.max((x - g.x0) * g.dx + (y - g.y0) * g.dy, 0), g.len);
    const d = Math.hypot(g.x0 + g.dx * u - x, g.y0 + g.dy * u - y);
    if (d < best) { best = d; at = g.at + u; }
  }
  return at;
}

/** Разгон и торможение: доля пути за долю времени, на краях по 15 %. */
function trapezoid(x) {
  const a = 0.15, v = 1 / (1 - a);
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  if (x < a) return (v * x * x) / (2 * a);
  if (x > 1 - a) return 1 - (v * (1 - x) ** 2) / (2 * a);
  return v * (a / 2 + (x - a));
}

/** Голова сцепки в момент `t`: длина от депо, скорость (точек в секунду), груз 0..1, у конца ли. */
function trainPose(tr, t) {
  const grid = canvas.grid.size;
  const L = tr.measure.length;
  const tOut = (L / (RAIL_OUT * grid)) * 1.18, tBack = (L / (RAIL_BACK * grid)) * 1.18;
  const cycle = RAIL_DEPOT + tOut + RAIL_UNLOAD + tBack;
  let u = (((t + tr.phase * cycle) % cycle) + cycle) % cycle;
  if (u < RAIL_DEPOT) return { s: 0, v: 0, cargo: 1, stage: 0 };
  u -= RAIL_DEPOT;
  if (u < tOut) {
    const x = u / tOut;
    return { s: L * trapezoid(x), v: (L * (trapezoid(x + 0.01) - trapezoid(x))) / (0.01 * tOut), cargo: 1, stage: 1 };
  }
  u -= tOut;
  if (u < RAIL_UNLOAD) return { s: L, v: 0, cargo: 1 - smooth(clamp01((u / RAIL_UNLOAD - 0.3) / 0.35)), stage: 2 };
  u -= RAIL_UNLOAD;
  const x = u / tBack;
  return { s: L * (1 - trapezoid(x)), v: (L * (trapezoid(x + 0.01) - trapezoid(x))) / (0.01 * tBack), cargo: 0, stage: 3 };
}

/* ------------------------------ Звук ------------------------------ */

let noiseBuf = null;
function noise(ctx) {
  if (noiseBuf && noiseBuf.sampleRate === ctx.sampleRate) return noiseBuf;
  const len = Math.floor(ctx.sampleRate * 3);
  const b = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = b.getChannelData(0);
  // Бурый шум: глухой, без шипения.
  let last = 0;
  for (let i = 0; i < len; i++) {
    last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
    d[i] = last * 3.5;
  }
  noiseBuf = b;
  return b;
}

let whiteBuf = null;
/** Белый шум — для шороха руды и щелчка колеса; верха срезает фильтр. */
function white(ctx) {
  if (whiteBuf && whiteBuf.sampleRate === ctx.sampleRate) return whiteBuf;
  const len = Math.floor(ctx.sampleRate * 3);
  const b = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  whiteBuf = b;
  return b;
}

function loopNoise(ctx, type, freq, q, buffer = noise(ctx)) {
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.value = 0;
  src.connect(f).connect(g);
  src.start(0, Math.random() * 2);
  return { src, g };
}

/** Голос сцепки: гул колёс, низ корпуса, шорох руды; стыки и удар — разовые. */
function voiceOf(tr) {
  const ctx = game.audio?.environment, out = ctx?.gainNode;
  if (!ctx || !out || ctx.state === "suspended") return null;
  if (tr.voice?.ctx === ctx) return tr.voice;
  const bus = ctx.createGain();
  bus.gain.value = 0;
  bus.connect(out);
  // Звук «Б» (выбран пользователем): гул до 420 Гц, корпус 110 Гц, руда 650 Гц —
  // слышно и на маленьких колонках, а 2–4 кГц нет совсем.
  const roll = loopNoise(ctx, "lowpass", 420, 0.7);
  const body = loopNoise(ctx, "bandpass", 110, 1.2);
  const ore = loopNoise(ctx, "bandpass", 650, 1.4, white(ctx));
  for (const n of [roll, body, ore]) n.g.connect(bus);
  tr.voice = { ctx, bus, roll, body, ore };
  return tr.voice;
}

function silence(tr) {
  const v = tr.voice;
  if (!v) return;
  for (const n of [v.roll, v.body, v.ore]) {
    try { n.src.stop(); } catch { /* уже стоит */ }
    n.src.disconnect();
  }
  v.bus.disconnect();
  tr.voice = null;
}

/** Удар колеса о стык: короткое «тук» до 900 Гц, без звона. */
function thump(v, when, gain, low = 160) {
  const { ctx, bus } = v;
  const src = ctx.createBufferSource();
  src.buffer = white(ctx);
  const f = ctx.createBiquadFilter();
  f.type = "lowpass";
  f.frequency.setValueAtTime(900, when);
  f.frequency.exponentialRampToValueAtTime(low, when + 0.08);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(gain * 0.5, when + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, when + 0.1);
  src.connect(f).connect(g).connect(bus);
  src.start(when, Math.random() * 2);
  src.stop(when + 0.13);
  const o = ctx.createOscillator();
  o.type = "sine";
  o.frequency.setValueAtTime(low, when);
  o.frequency.exponentialRampToValueAtTime(low * 0.5, when + 0.1);
  const og = ctx.createGain();
  og.gain.setValueAtTime(0.0001, when);
  og.gain.exponentialRampToValueAtTime(gain * 0.5, when + 0.004);
  og.gain.exponentialRampToValueAtTime(0.0001, when + 0.11);
  o.connect(og).connect(bus);
  o.start(when);
  o.stop(when + 0.14);
}

/** Громкость в точке: ближайший слушатель сцены, со стенами — как у звуков Foundry. */
function hearing(tr, x, y) {
  const listeners = canvas.sounds?.getListenerPositions?.() ?? [];
  if (!listeners.length) return 0;
  const radius = canvas.grid.size * HEAR;
  if (!listeners.some((l) => Math.hypot(l.x - x, l.y - y) <= radius)) return 0;
  const elevation = canvas.level?.elevation?.base ?? 0;
  tr.source ??= new CONFIG.Canvas.soundSourceClass({ object: null });
  try {
    tr.source.initialize({ x, y, elevation, radius, walls: true });
  } catch {
    return 0;
  }
  let best = 0;
  for (const l of listeners) best = Math.max(best, tr.source.getVolumeMultiplier(l, { easing: true }));
  return best;
}

function sound(tr, pose, head, t) {
  const grid = canvas.grid.size;
  // Слух — пять раз в секунду: источник с обходом стен не бесплатный.
  if (!tr.heardAt || t - tr.heardAt > 0.2) {
    tr.heard = pose.s > grid * 0.3 || pose.v > 0 ? hearing(tr, head.x, head.y) : 0;
    tr.heardAt = t;
  }
  const moving = clamp01(pose.v / (RAIL_OUT * grid));
  // Из рудника слышно глуше: пока вагонетка в темноте, гул тише.
  const out = clamp01(pose.s / (RAIL_FADE * grid) + 0.35);
  const level = tr.heard * out;
  if (level <= 0.001 && !tr.voice) { tr.prevS = pose.s; tr.prevStage = pose.stage; return; }
  const v = voiceOf(tr);
  if (!v) return;
  const now = v.ctx.currentTime;
  v.bus.gain.setTargetAtTime(level * 0.9, now, 0.15);
  v.roll.g.gain.setTargetAtTime(0.6 * moving ** 0.8, now, 0.2);
  v.body.g.gain.setTargetAtTime(0.6 * moving ** 0.7, now, 0.2);
  v.ore.g.gain.setTargetAtTime(0.035 * moving * pose.cargo * (0.6 + 0.4 * Math.sin(t * 9.3 + Math.sin(t * 3.1) * 2)), now, 0.05);
  // Стыки: колёса проходят их парой — «ту-дук».
  if (level > 0.01 && tr.prevS !== undefined && moving > 0.05) {
    const j0 = Math.floor(tr.prevS / (JOINT * grid)), j1 = Math.floor(pose.s / (JOINT * grid));
    if (j0 !== j1) {
      const gap = Math.min(0.4, (WHEELBASE * grid) / Math.max(pose.v, 1));
      const g = 0.5 * Math.min(1, 0.4 + moving);
      thump(v, now + 0.01, g);
      thump(v, now + 0.01 + gap, g * 0.85);
    }
  }
  // Встала у конца — тяжёлый удар в упор.
  if (tr.prevStage === 1 && pose.stage === 2 && level > 0.01) thump(v, now + 0.01, 0.9, 90);
  tr.prevS = pose.s;
  tr.prevStage = pose.stage;
  if (level <= 0.001 && moving <= 0) {
    tr.quiet = (tr.quiet ?? 0) + 1;
    if (tr.quiet > 120) silence(tr);
  } else tr.quiet = 0;
}

/* ------------------------------ Сборка ------------------------------ */

function drop(id) {
  const m = movers.get(id);
  if (!m) return;
  const mesh = m.tile.mesh;
  if (mesh && !mesh.destroyed && m.base && m.set) {
    if (mesh.position.x === m.set.x && mesh.position.y === m.set.y) mesh.position.set(m.base.x, m.base.y);
    if (mesh.rotation === m.set.r) mesh.rotation = m.base.r;
    if (mesh.alpha === m.set.a) mesh.alpha = m.base.a;
  }
  if (m.shadow && !m.shadow.destroyed) m.shadow.destroy();
  m.baked?.rt.destroy(true);
  // Вагонетка уходит из сцепки; последняя — сцепка молчит.
  const tr = m.train;
  if (tr) {
    tr.cars = tr.cars.filter((c) => c !== m);
    if (!tr.cars.length) {
      silence(tr);
      trains.delete(tr.key);
    }
  }
  movers.delete(id);
}

export function clearMotion() {
  for (const id of [...movers.keys()]) drop(id);
  for (const tr of trains.values()) silence(tr);
  trains.clear();
}

export function rebuildMotion() {
  clearMotion();
  if (!canvas.ready || !canvas.tiles) return;
  for (const tile of canvas.tiles.placeables) addMotion(tile);
}

/** Кран или вагонетка: тайл Foundry или меш Boundless под видом тайла (см. boundless.js). */
export function addMotion(tile) {
  if (!tile.mesh || movers.has(tile.id) || !canvas.ready || !game.settings.get(MODULE_ID, "enabled")) return;
  const slew = slewOf(tile.document);
  const rail = slew ? null : railOf(tile.document);
  if (!slew && !rail) return;
  const m = { tile, slew, rail, phase: hash(tile.id), base: null, set: null, sortedFor: null };
  if (rail) {
    let tr = trains.get(rail.key);
    if (!tr) {
      const measured = measure(rail.path);
      if (!measured.length) return;
      tr = { key: rail.key, measure: measured, phase: hash(rail.key), cars: [] };
      trains.set(rail.key, tr);
    }
    tr.cars.push(m);
    m.train = tr;
  }
  if (slew) {
    m.shadow = new PIXI.Sprite(PIXI.Texture.EMPTY);
    m.shadow.name = `${MODULE_ID}.slew.${tile.id}`;
    m.shadow.eventMode = "none";
    canvas.primary.addChild(m.shadow);
  }
  movers.set(tile.id, m);
  if (!ticking) {
    canvas.app.ticker.add(tick);
    ticking = true;
  }
}

export const dropMotion = (id) => drop(id);
export const motionKeys = () => movers.keys();

/** Основа меша: Foundry переставил его (правка тайла) — это новое исходное место. */
function baseOf(m) {
  const mesh = m.tile.mesh;
  const s = m.set;
  if (!s || mesh.position.x !== s.x || mesh.position.y !== s.y) m.base = { ...(m.base ?? {}), x: mesh.position.x, y: mesh.position.y, moved: true };
  if (!s || mesh.rotation !== s.r) m.base = { ...m.base, r: mesh.rotation };
  if (!s || mesh.alpha !== s.a) m.base = { ...m.base, a: mesh.alpha };
  return m.base;
}

function tick() {
  if (!movers.size || !canvas.ready) {
    canvas.app?.ticker.remove(tick);
    ticking = false;
    return;
  }
  const t = Date.now() / 1000;
  for (const m of movers.values()) {
    const mesh = m.tile.mesh;
    if (!mesh || mesh.destroyed || !mesh.texture?.valid) continue;
    if (m.slew) drawSlew(m, mesh, t);
  }
  for (const tr of trains.values()) drawTrain(tr, t);
}

function drawSlew(m, mesh, t) {
  const b = baseOf(m);
  const { ax, ay, arc } = m.slew;
  // Стоит — поворачивается — стоит — возвращается; у каждого крана свой час.
  const cycle = 2 * (SLEW_HOLD + SLEW_MOVE);
  const u = (((t + m.phase * cycle) % cycle) + cycle) % cycle;
  let k;
  if (u < SLEW_HOLD) k = 0;
  else if (u < SLEW_HOLD + SLEW_MOVE) k = smooth((u - SLEW_HOLD) / SLEW_MOVE);
  else if (u < 2 * SLEW_HOLD + SLEW_MOVE) k = 1;
  else k = 1 - smooth((u - 2 * SLEW_HOLD - SLEW_MOVE) / SLEW_MOVE);
  const ang = arc * k;
  const tex = mesh.texture;
  const W = (tex.orig?.width ?? tex.width) * Math.abs(mesh.scale.x), H = (tex.orig?.height ?? tex.height) * Math.abs(mesh.scale.y);
  // От оси к точке якоря меша, в осях картинки; у отражённого меша ось — на отражённой картинке.
  const vx = (mesh.anchor.x - ax) * W * (Math.sign(mesh.scale.x) || 1), vy = (mesh.anchor.y - ay) * H * (Math.sign(mesh.scale.y) || 1);
  const rot = (r, x, y) => [x * Math.cos(r) - y * Math.sin(r), x * Math.sin(r) + y * Math.cos(r)];
  const [bx, by] = rot(b.r, vx, vy);
  const px = b.x - bx, py = b.y - by;
  const [nx, ny] = rot(b.r + ang, vx, vy);
  const x = px + nx, y = py + ny, r = b.r + ang;
  mesh.position.set(x, y);
  mesh.rotation = r;
  m.set = { x, y, r, a: mesh.alpha };

  // Тень: стрела высоко — падает дальше, чем у вещей на земле.
  const sh = m.shadow;
  if (!sh || sh.destroyed) return;
  const grid = canvas.grid.size;
  if (m.baked?.tex !== tex) {
    m.baked?.rt.destroy(true);
    const perCell = (tex.orig?.width ?? tex.width) / Math.max(m.tile.document.width / grid, 0.1);
    m.baked = bakeTexture(tex, { scale: 0.25, blur: 0.12 * perCell * 0.25, tint: 0x000000 });
  }
  placeBaked(sh, m.baked, mesh.anchor.x, mesh.anchor.y);
  const sun = (SUN * Math.PI) / 180, reach = grid * 0.45;
  sh.position.set(x + Math.cos(sun) * reach, y + Math.sin(sun) * reach);
  sh.rotation = r;
  sh.scale.set(mesh.scale.x / m.baked.scale, mesh.scale.y / m.baked.scale);
  sh.elevation = mesh.elevation;
  sh.sortLayer = mesh.sortLayer;
  sh.sort = (mesh.sort ?? 0) - 0.5;
  if (m.sortedFor !== mesh) { canvas.primary.sortDirty = true; m.sortedFor = mesh; }
  sh.visible = mesh.visible && m.tile.visible !== false;
  sh.alpha = 0.42 * (mesh.alpha ?? 1);
}

function drawTrain(tr, t) {
  const grid = canvas.grid.size;
  const pose = trainPose(tr, t);
  let head = null;
  for (const m of tr.cars) {
    const mesh = m.tile.mesh;
    if (!mesh || mesh.destroyed || !mesh.texture?.valid) continue;
    const b = baseOf(m);
    if (b.moved || m.home === undefined) {
      // Где вагонетка стоит на карте: длина вдоль пути и направление там.
      m.home = project(tr.measure, b.x, b.y);
      const p = pointAt(tr.measure, m.home, grid * 0.5);
      m.homeAng = p.ang;
      m.off = [b.x - p.x, b.y - p.y];
      b.moved = false;
    }
    const lag = m.rail.lag;
    const s = pose.s - lag;
    const p = pointAt(tr.measure, s, grid * 0.5);
    const turn = p.ang - m.homeAng;
    const x = p.x + m.off[0], y = p.y + m.off[1], r = b.r + turn;
    // Выходит из темноты рудника и уходит в неё.
    let a = smooth(clamp01(s / (RAIL_FADE * grid)));
    if (m.rail.cargo) a *= pose.cargo;
    a *= b.a ?? 1;
    mesh.position.set(x, y);
    mesh.rotation = r;
    mesh.alpha = a;
    m.set = { x, y, r, a };
    if (!lag) head = { x, y };
  }
  if (head) sound(tr, pose, head, t);
}

/** Для проверки: сцепки — сколько вагонеток, насколько слышно, звучит ли голос. */
export function motionStatus() {
  return [...trains.values()].map((tr) => ({
    cars: tr.cars.length,
    heard: Math.round((tr.heard ?? 0) * 100) / 100,
    voice: !!tr.voice,
    gain: tr.voice ? Math.round(tr.voice.bus.gain.value * 1000) / 1000 : 0
  }));
}

/* ------------------------------ Хуки ------------------------------ */

export function registerMotion() {
  Hooks.on("canvasReady", () => rebuildMotion());
  Hooks.on("canvasTearDown", () => clearMotion());
  for (const hook of ["createTile", "updateTile", "deleteTile"]) {
    Hooks.on(hook, (doc) => {
      if (doc.parent === canvas.scene) setTimeout(() => rebuildMotion(), 0);
    });
  }
  // Только что созданный тайл получает меш позже createTile — ловим отрисовку.
  Hooks.on("drawTile", (tile) => {
    const doc = tile.document;
    if (doc?.parent === canvas.scene && (slewOf(doc) || railOf(doc)) && !movers.has(tile.id)) setTimeout(() => rebuildMotion(), 0);
  });
}
