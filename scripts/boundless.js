// Boundless (SweetyHake): огромный мир Картографа одной сценой, кусками. Тайлы и крыши там —
// меши самого Boundless, а не тайлы Foundry, и хуки тайлов их не видят. Каждый кадр смотрим,
// что Boundless держит на холсте, и отдаём эти меши тем же модулям, что оживляют тайлы:
// под видом тайла — `{id, mesh, document}`, где `document` собран из записи манифеста
// (середина, размер, поворот, высота, картинка, пометки `flags.burn-living-map`).
//   тайлы (`activeVirtualTiles`): ветер (кроны, кусты, бельё, ветроуказатели, гамаки), листья
//     и светлячки, парение, «на воде», краны и вагонетки, техника, тени от солнца, колонки;
//   дома (`activeOverlays`, меш крыши): дым из труб и вода из сливов под дождём;
//   живые огни (`dynamicLights`): скорость и сила анимации, окраска, затухание, яркость из записи.
// Вода, болото и звуки мест — обычные области сцены, их оживляет main.js как всегда.
//
// Boundless берёт меши из пула: ушедший тайл отдаёт свой меш другому. Поэтому отпускаем
// раньше всех (высокий приоритет тикера), а «свой ли меш» — по имени, которое Boundless
// даёт мешу при установке. Модуль может сам сбросить взятое (пересборка по хукам) —
// тогда берём заново в следующем кадре.
//
// Отражать тайлы Boundless не умеет. Отражённое Картограф кладёт своей картинкой, а
// механизм, ветроуказатель и колонку (их рисуют по раскладке картинки) — с `scaleX` −1 в
// записи: такой меш отражаем сами, как ядро отражает тайл, и модули видят обычный
// отражённый тайл. Ширину меша Boundless ставит со знаком, поэтому, уходя в пул, меш
// получает прямой вид обратно — иначе отразился бы следующий тайл на нём.

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

/** Меш ещё наш: Boundless ставит ему имя при установке и снимает, убирая в пул. */
function owner(mesh) {
  const name = mesh.name;
  return () => !mesh.destroyed && mesh.name === name;
}

/** Отражённые нами меши → имя, под которым отражали. */
const mirrored = new Map();
const GUARD = Symbol.for(`${MODULE_ID}.mirror`);

function mirror(vt) {
  if (!(Number(vt.tSpec?.scaleX) < 0)) return;
  const mesh = vt.mesh;
  if (mesh.scale.x > 0) mesh.scale.x = -mesh.scale.x;
  mirrored.set(mesh, mesh.name);
}

function unmirror(mesh) {
  if (!mesh.destroyed && mesh.scale.x < 0) mesh.scale.x = -mesh.scale.x;
  mirrored.delete(mesh);
}

/** Меш уходит в пул — сразу прямым: следующий тайл на нём Boundless ставит в том же шаге. */
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

/**
 * Живые огни Boundless (у фишек со зрением) он ставит со скоростью и силой анимации 3, без окраски,
 * затухания и яркости: из записи манифеста берёт только вид анимации. Картограф (0.2.51+) кладёт их
 * девятым полем записи — объектом, как у запекалки самого Boundless. Доводим огонь по нему один раз:
 * Boundless пересоздаёт огни новыми объектами, а свою переинициализацию делает с `ls.data`, где наше
 * уже есть.
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

function tick() {
  const B = boundless();
  if (!B || !canvas.ready) return stop();
  guardPool(B);
  tuneLights(B);
  // Меш ушёл к другому мимо пула — вернуть прямой вид.
  for (const [mesh, name] of mirrored) if (mesh.destroyed || mesh.name !== name) unmirror(mesh);
  // Что Boundless держит сейчас: id → тайл и кто его оживляет.
  const want = new Map();
  for (const [key, vt] of B.activeVirtualTiles ?? []) {
    if (!vt?.mesh || vt.mesh.destroyed) continue;
    mirror(vt);
    let info = known.get(vt);
    if (!info) known.set(vt, (info = classify(asTile(key, vt), "tile")));
    if (info.kinds.length) want.set(info.tile.id, info);
  }
  for (const [key, ov] of B.activeOverlays ?? []) {
    if (!ov?.roofMesh || ov.roofMesh.destroyed) continue;
    let info = known.get(ov);
    if (!info || info.tile.mesh !== ov.roofMesh) known.set(ov, (info = classify(asHouse(key, ov, B), "house")));
    if (info.kinds.length) want.set(info.tile.id, info);
  }
  for (const kind of KINDS) {
    const have = new Set(kind.keys());
    // Ушёл с холста или сменил меш — отпустить.
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

/** Boundless включается не сразу после готовности холста: ждём его, раз в секунду, до 30 с. */
function start(tries = 30) {
  if (ticking) return;
  if (!boundless()) {
    if (tries > 0 && canvas.scene?.flags?.boundless?.enabled) setTimeout(() => start(tries - 1), 1000);
    return;
  }
  // Раньше модулей: меш, который Boundless отдал другому тайлу, отпускаем до их кадра.
  canvas.app.ticker.add(tick, null, PIXI.UPDATE_PRIORITY.HIGH);
  ticking = true;
}

function stop() {
  if (ticking) canvas.app?.ticker.remove(tick);
  ticking = false;
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
  return out;
}

export function registerBoundless() {
  // Boundless поднимает свой мир после готовности холста.
  Hooks.on("canvasReady", () => setTimeout(start, 500));
  Hooks.on("canvasTearDown", () => stop());
}
