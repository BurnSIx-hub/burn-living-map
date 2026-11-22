// Boundless (SweetyHake): огромный мир Картографа одной сценой, кусками. Тайлы и крыши там —
// меши самого Boundless, а не тайлы Foundry, и хуки тайлов их не видят. Что Boundless ставит
// на холст, отдаём тем же модулям, что оживляют тайлы: под видом тайла — `{id, mesh, document}`,
// где `document` собран из записи манифеста (середина, размер, поворот, высота, картинка,
// пометки `flags.burn-living-map`).
//   тайлы: ветер (кроны, кусты, бельё, ветроуказатели, гамаки), листья и светлячки, парение,
//     «на воде», краны и вагонетки, техника, тени от солнца, колонки;
//   дома (меш крыши): дым из труб и вода из сливов под дождём;
//   живые огни (`dynamicLights`): скорость и сила анимации, окраска, затухание, яркость из записи.
// Вода, болото и звуки мест — обычные области сцены, их оживляет main.js как всегда.
//
// С Boundless 1.1.1 есть события `Boundless.on`: `virtualTileMount` / `virtualTileRetire`,
// `overlayMount` / `overlayRetire` (снятие — до возврата меша в пул), `mount` / `unmount`.
// По ним и берём и отпускаем. Наши модули сами сбрасывают взятое при пересборке по хукам
// тайлов и сцены, поэтому раз в полсекунды сверяем их со своим списком — он из событий, а не
// из внутренностей Boundless.
//
// Boundless 1.1.0 событий не шлёт: тогда каждый кадр смотрим `activeVirtualTiles` и
// `activeOverlays`, «свой ли меш» узнаём по имени, которое Boundless даёт мешу при установке,
// и подменяем `retireMesh`, чтобы отпустить меш раньше, чем он уйдёт к другому тайлу.
//
// Отражение: Boundless 1.1.2 сам ставит знак `scaleX` / `scaleY` из записи и сбрасывает его в
// пуле. Старому отражаем сами (механизм, ветроуказатель и колонку Картограф кладёт с `scaleX`
// −1 — их рисуют по раскладке картинки), а уходящий в пул меш возвращаем прямым.

import { addWind, dropWind, windKeys } from "./wind.js";
import { addSmoke, dropSmoke, smokeKeys } from "./chimneys.js";
import { addHover, dropHover, hoverKeys, hoverOf } from "./hover.js";
import { addAfloat, dropAfloat, afloatKeys, afloatOf } from "./afloat.js";
import { addMotion, dropMotion, motionKeys, slewOf, railOf } from "./motion.js";
import { addMachine, dropMachine, machineKeys, machineOf } from "./machines.js";
import { addShadow, dropShadow, shadowKeys, shadowOf } from "./shadows.js";
import { addSpeaker, dropSpeaker, speakerKeys, stateOf } from "./speaker.js";
import { addParticles, dropParticles, particleKeys } from "./particles.js";
import { addScuppers, dropScuppers, scupperKeys } from "./scupper.js";

const MODULE_ID = "burn-living-map";
/** Ключи взятого у Boundless — чтобы не спутать с тайлами Foundry. */
const PREFIX = "boundless:";
/** Раз в столько кадров сверяем модули со списком из событий. */
const RESYNC = 30;

const own = (doc) => doc.flags?.[MODULE_ID] ?? {};
const list = (v) => Array.isArray(v) && v.length > 0;

/** Кто что оживляет: `on` — тайлы или дома, `wants` — по документу под видом тайла. */
const KINDS = [
  { on: "tile", wants: (d) => Number(own(d).wind) > 0 || !!own(d).sock || list(own(d).swing), add: addWind, drop: dropWind, keys: windKeys },
  { on: "tile", wants: (d) => !!own(d).particles, add: addParticles, drop: dropParticles, keys: particleKeys },
  { on: "tile", wants: (d) => hoverOf(d) > 0, add: addHover, drop: dropHover, keys: hoverKeys },
  { on: "tile", wants: (d) => afloatOf(d) > 0, add: addAfloat, drop: dropAfloat, keys: afloatKeys },
  { on: "tile", wants: (d) => !!(slewOf(d) || railOf(d)), add: addMotion, drop: dropMotion, keys: motionKeys },
  { on: "tile", wants: (d) => !!machineOf(d), add: addMachine, drop: dropMachine, keys: machineKeys },
  { on: "tile", wants: (d) => shadowOf(d), add: addShadow, drop: dropShadow, keys: shadowKeys },
  { on: "tile", wants: (d) => !!stateOf(d), add: addSpeaker, drop: dropSpeaker, keys: speakerKeys },
  { on: "house", wants: (d) => list(own(d).chimneys), add: (t) => addSmoke(t.id, t, own(t.document).chimneys), drop: dropSmoke, keys: smokeKeys },
  { on: "house", wants: (d) => list(own(d).scuppers), add: addScuppers, drop: dropScuppers, keys: scupperKeys }
];
for (const k of KINDS) k.mesh = new Map();

/** Запись Boundless → тайл для модулей; разбор один на запись. */
const known = new WeakMap();
let ticking = false;

/** Boundless ведёт эту сцену. */
function boundless() {
  const B = globalThis.Boundless;
  return B?.active && canvas.scene?.flags?.boundless?.enabled ? B : null;
}

/** Boundless шлёт события установки и снятия (1.1.1+). */
const hasEvents = (B) => typeof B?.on === "function";

/** Меш ещё наш: Boundless ставит ему имя при установке и снимает, убирая в пул. */
function owner(mesh) {
  const name = mesh.name;
  return () => !mesh.destroyed && mesh.name === name;
}

/* ------------------------------ Отражение ------------------------------ */

/** Отражённые нами меши → имя, под которым отражали. */
const mirrored = new Map();
const GUARD = Symbol.for(`${MODULE_ID}.mirror`);

function mirror(vt) {
  if (!(Number(vt.tSpec?.scaleX) < 0)) return;
  const mesh = vt.mesh;
  if (mesh.scale.x < 0) return; // отразил сам Boundless
  mesh.scale.x = -mesh.scale.x;
  mirrored.set(mesh, mesh.name);
}

function unmirror(mesh) {
  if (!mesh.destroyed && mesh.scale.x < 0) mesh.scale.x = -mesh.scale.x;
  mirrored.delete(mesh);
}

/** Старый Boundless: меш уходит в пул — сразу прямым, следующий тайл на нём ставится в том же шаге. */
function guardPool(B) {
  const retire = B.retireMesh;
  if (typeof retire !== "function" || retire[GUARD]) return;
  const guarded = function (m) {
    if (m && mirrored.has(m)) unmirror(m);
    return retire.call(this, m);
  };
  guarded[GUARD] = true;
  B.retireMesh = guarded;
}

/* ------------------------------ Свет ------------------------------ */

/**
 * Живые огни Boundless (у фишек со зрением) он ставит со скоростью и силой анимации 3, без окраски,
 * затухания и яркости: из записи манифеста берёт только вид анимации. Картограф (0.2.51+) кладёт их
 * девятым полем записи — объектом, как у запекалки самого Boundless. Доводим огонь по нему один раз:
 * Boundless пересоздаёт огни новыми объектами, а свою переинициализацию делает с `ls.data`, где наше
 * уже есть. Событий для огней у Boundless нет — смотрим `dynamicLights` каждый кадр.
 */
const tunedFor = new WeakMap();
const tunedLights = new WeakSet();
const LOOK = ["coloration", "attenuation", "luminosity"];

function lightExtra(B, lid) {
  const [levelId, rest] = String(lid).split("::");
  const i = rest?.lastIndexOf("_") ?? -1;
  if (i < 0) return null;
  const raw = B.levelLayers?.get(levelId)?.spec?.sectors?.[rest.slice(0, i)]?.l?.[Number(rest.slice(i + 1))];
  const x = raw?.[8];
  return x && typeof x === "object" ? x : null;
}

function tuneLights(B) {
  let changed = false;
  for (const [lid, ls] of B.dynamicLights ?? []) {
    if (!ls || tunedFor.get(ls) === lid) continue;
    tunedFor.set(ls, lid);
    const extra = lightExtra(B, lid);
    if (!extra) continue;
    const anim = ls.data?.animation ?? {};
    const next = {};
    if (anim.type) next.animation = { ...anim, speed: extra.speed ?? anim.speed, intensity: extra.intensity ?? anim.intensity };
    for (const k of LOOK) if (Number.isFinite(extra[k])) next[k] = extra[k];
    if (!Object.keys(next).length) continue;
    ls.initialize(next);
    tunedLights.add(ls);
    changed = true;
  }
  if (changed) canvas.perception.update({ refreshLighting: true });
}

/* ------------------------------ Тайлы и дома ------------------------------ */

function asTile(key, vt) {
  const s = vt.tSpec ?? {}, mesh = vt.mesh;
  const w = Number(s.w) || 0, h = Number(s.h) || 0;
  // Без якоря Boundless ставит меш серединой записи (x, y — левый верх).
  const x = s.anchorX === undefined ? s.x + w / 2 : s.x + (0.5 - s.anchorX) * w;
  const y = s.anchorY === undefined ? s.y + h / 2 : s.y + (0.5 - s.anchorY) * h;
  const owns = owner(mesh);
  return {
    id: `${PREFIX}t:${key}`, mesh, boundless: true, owns,
    get visible() { return owns(); },
    document: {
      x, y, width: w, height: h, rotation: Number(s.rot) || 0,
      elevation: Number.isFinite(s.elevation) ? s.elevation : mesh.elevation,
      texture: { src: s.src ?? "", anchorX: 0.5, anchorY: 0.5, scaleX: Number(s.scaleX) < 0 ? -1 : 1 },
      flags: s.flags ?? {}
    }
  };
}

function asHouse(key, ov, B) {
  const s = ov.ovSpec ?? {}, mesh = ov.roofMesh;
  const owns = owner(mesh);
  return {
    id: `${PREFIX}o:${key}`, mesh, boundless: true, owns,
    get visible() { return owns(); },
    // Крыша открыта — у фишки, под мышью, по Alt: решает Boundless.
    open: () => !!B._isRoofRevealed?.(mesh, canvas.masks?.occlusion?.occludedSurfaces),
    document: { x: s.cx, y: s.cy, width: s.w, height: s.h, rotation: Number(s.rot) || 0, flags: s.flags ?? {} }
  };
}

function classify(tile, on) {
  return { tile, kinds: KINDS.filter((k) => k.on === on && k.wants(tile.document)) };
}

/** Тайл Boundless → разбор (или null, если оживлять нечего). */
function tileInfo(key, vt) {
  if (!vt?.mesh || vt.mesh.destroyed) return null;
  mirror(vt);
  let info = known.get(vt);
  if (!info) known.set(vt, (info = classify(asTile(key, vt), "tile")));
  return info.kinds.length ? info : null;
}

function houseInfo(key, ov, B) {
  if (!ov?.roofMesh || ov.roofMesh.destroyed) return null;
  let info = known.get(ov);
  if (!info || info.tile.mesh !== ov.roofMesh) known.set(ov, (info = classify(asHouse(key, ov, B), "house")));
  return info.kinds.length ? info : null;
}

/** Модули — по списку: лишнее и сменившее меш отпустить, недостающее взять. */
function sync(want) {
  for (const kind of KINDS) {
    const have = new Set(kind.keys());
    for (const id of have) {
      if (!id.startsWith(PREFIX)) continue;
      const w = want.get(id);
      if (w && w.kinds.includes(kind) && kind.mesh.get(id) === w.tile.mesh) continue;
      kind.drop(id);
      have.delete(id);
    }
    for (const id of kind.mesh.keys()) if (!want.has(id)) kind.mesh.delete(id);
    for (const [id, w] of want) {
      if (have.has(id) || !w.kinds.includes(kind)) continue;
      kind.add(w.tile);
      kind.mesh.set(id, w.tile.mesh);
    }
  }
}

/** Отпустить один тайл во всех модулях — сразу, пока меш ещё не ушёл в пул. */
function release(id, mesh) {
  for (const kind of KINDS) {
    if (!kind.mesh.has(id)) continue;
    kind.drop(id);
    kind.mesh.delete(id);
  }
  if (mesh && mirrored.has(mesh)) unmirror(mesh);
}

/* ------------------------------ По событиям (1.1.1+) ------------------------------ */

/** Что Boundless держит сейчас, по его событиям: id → тайл и кто его оживляет. */
const live = new Map();
let dirty = false, frame = 0;
let subscribed = null;

function take(info) {
  if (!info) return;
  live.set(info.tile.id, info);
  dirty = true;
}

function letGo(id, mesh) {
  if (!live.delete(id) && !mesh) return;
  release(id, mesh);
}

function subscribe(B) {
  if (subscribed === B) return;
  subscribed = B;
  B.on("virtualTileMount", ({ key, vt } = {}) => take(tileInfo(key, vt)));
  B.on("virtualTileRetire", ({ key, mesh } = {}) => letGo(`${PREFIX}t:${key}`, mesh));
  B.on("overlayMount", ({ key, ov } = {}) => take(houseInfo(key, ov, B)));
  B.on("overlayRetire", ({ key, mesh } = {}) => letGo(`${PREFIX}o:${key}`, mesh));
  B.on("mount", () => start());
  B.on("unmount", () => stop());
}

/** Что уже стояло до подписки (модуль включили посреди игры) — один раз. */
function seed(B) {
  for (const [key, vt] of B.activeVirtualTiles ?? []) take(tileInfo(key, vt));
  for (const [key, ov] of B.activeOverlays ?? []) take(houseInfo(key, ov, B));
}

/* ------------------------------ Кадр ------------------------------ */

/** Старый Boundless: что он держит сейчас, по его спискам. */
function scan(B) {
  guardPool(B);
  // Меш ушёл к другому мимо пула — вернуть прямой вид.
  for (const [mesh, name] of mirrored) if (mesh.destroyed || mesh.name !== name) unmirror(mesh);
  const want = new Map();
  for (const [key, vt] of B.activeVirtualTiles ?? []) {
    const info = tileInfo(key, vt);
    if (info) want.set(info.tile.id, info);
  }
  for (const [key, ov] of B.activeOverlays ?? []) {
    const info = houseInfo(key, ov, B);
    if (info) want.set(info.tile.id, info);
  }
  return want;
}

function tick() {
  const B = boundless();
  if (!B || !canvas.ready) return stop();
  tuneLights(B);
  if (!hasEvents(B)) return sync(scan(B));
  if (dirty || ++frame >= RESYNC) {
    dirty = false;
    frame = 0;
    sync(live);
  }
}

/** Boundless включается не сразу после готовности холста: ждём его, раз в секунду, до 30 с. */
function start(tries = 30) {
  if (ticking) return;
  const B = boundless();
  if (!B) {
    if (tries > 0 && canvas.scene?.flags?.boundless?.enabled) setTimeout(() => start(tries - 1), 1000);
    return;
  }
  if (hasEvents(B)) {
    subscribe(B);
    seed(B);
  }
  // Раньше модулей: у старого Boundless меш, отданный другому тайлу, отпускаем до их кадра.
  canvas.app.ticker.add(tick, null, PIXI.UPDATE_PRIORITY.HIGH);
  ticking = true;
}

function stop() {
  if (ticking) canvas.app?.ticker.remove(tick);
  ticking = false;
  live.clear();
  dirty = false;
  for (const kind of KINDS) {
    for (const id of [...kind.keys()]) if (id.startsWith(PREFIX)) kind.drop(id);
    kind.mesh.clear();
  }
  for (const mesh of [...mirrored.keys()]) unmirror(mesh);
}

/** Для проверки: сколько чего взято у Boundless. */
export function boundlessStatus() {
  const names = ["wind", "particles", "hover", "afloat", "motion", "machines", "shadows", "speakers", "chimneys", "scuppers"];
  const out = Object.fromEntries(KINDS.map((k, i) => [names[i], [...k.keys()].filter((id) => id.startsWith(PREFIX)).length]));
  out.mirrored = mirrored.size;
  const B = globalThis.Boundless;
  out.lights = [...(B?.dynamicLights?.values() ?? [])].filter((ls) => tunedLights.has(ls)).length;
  out.events = hasEvents(B) && subscribed === B;
  out.live = live.size;
  return out;
}

export function registerBoundless() {
  // Подписаться заранее: тайлы первой установки Boundless ставит до своего события `mount`.
  Hooks.once("ready", () => {
    const B = globalThis.Boundless;
    if (hasEvents(B)) subscribe(B);
  });
  // Boundless поднимает свой мир после готовности холста.
  Hooks.on("canvasReady", () => setTimeout(start, 500));
  Hooks.on("canvasTearDown", () => stop());
}
