// Тени предметов. Картограф (0.2.43+) выгружает предметы плитками без тени в картинке:
// у плитки пометка `flags.burn-living-map.shadow`, а солнце — у сцены,
// `flags.burn-living-map.shadows`: angle (куда падает тень, градусы по часовой от
// «вправо»), dist (на сколько клеток), blur (размытие, клетки), opacity, fade
// (затухание: 0 — ровная, 1 — тает к концу).
//
// Тень — силуэт картинки плитки, чёрный и размытый, сдвинутый от солнца. Фильтр
// размытия внутри основной группы холста не рисуется, поэтому силуэт запекается в
// уменьшенную текстуру один раз на картинку и размытие (у сотни одинаковых бочек —
// одна текстура), а дальше спрайт лишь следует за своим тайлом: стоит в основной
// группе сразу под ним, поворачивается и тянется вместе с ним, гаснет вместе с ним.
//
// Тень видна только на этом компьютере и выключается в настройках («Тени предметов»).

import { bakeTexture, placeBaked } from "./hover.js";

const MODULE_ID = "burn-living-map";
/** Силуэт тени считается в столько точек на клетку: тень мягкая, подробности ей ни к чему. */
const BAKE_PER_CELL = 32;

/** @type {Map<string, {tile: Tile, sprites: PIXI.Sprite[], sortedFor: object|null}>} */
const shades = new Map();
/** Запечённые силуэты: ключ — картинка и размытие. */
const bakes = new Map();
let ticking = false;

/** Есть ли у тайла тень от солнца. */
export function shadowOf(doc) {
  const v = doc?.flags?.[MODULE_ID]?.shadow;
  return v === true || Number(v) > 0;
}

/** Солнце сцены; без пометки — как у Картографа по умолчанию. */
function sun() {
  const f = canvas.scene?.flags?.[MODULE_ID]?.shadows ?? {};
  const n = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
  return { angle: n(f.angle, 45), dist: n(f.dist, 0.2), blur: n(f.blur, 0.3), opacity: n(f.opacity, 0.55), fade: Math.min(Math.max(n(f.fade, 0), 0), 1) };
}

/** Слои тени, как у Картографа: ровная — один; с затуханием — три, всё дальше и мягче. */
function layers(s) {
  if (s.fade <= 0) return [{ dist: s.dist, blur: s.blur, opacity: s.opacity }];
  const n = 3;
  const opacity = 1 - Math.pow(1 - Math.min(s.opacity, 0.99), 1 / n);
  return Array.from({ length: n }, (_, i) => {
    const reach = s.dist * (1 - s.fade + (s.fade * (i + 1)) / n);
    return { dist: reach * (1 - s.fade / 2), blur: s.blur + reach * s.fade, opacity };
  });
}

function enabled() {
  return game.settings.get(MODULE_ID, "enabled") && game.settings.get(MODULE_ID, "objectShadows");
}

function forget(id) {
  const s = shades.get(id);
  if (!s) return;
  for (const sp of s.sprites) if (!sp.destroyed) sp.destroy();
  shades.delete(id);
}

export function clearShadows() {
  for (const id of [...shades.keys()]) forget(id);
  for (const b of bakes.values()) b.rt.destroy(true);
  bakes.clear();
}

export function rebuildShadows() {
  for (const id of [...shades.keys()]) forget(id);
  if (!canvas.ready || !canvas.tiles) return;
  for (const tile of canvas.tiles.placeables) addShadow(tile);
}

/** Тень от солнца тайлу Foundry или мешу Boundless под видом тайла (см. boundless.js). */
export function addShadow(tile) {
  if (!shadowOf(tile.document) || !tile.mesh || shades.has(tile.id) || !canvas.ready || !enabled()) return;
  const ls = layers(sun());
  const sprites = ls.map((l, i) => {
    const sp = new PIXI.Sprite(PIXI.Texture.EMPTY);
    sp.name = `${MODULE_ID}.shadow.${tile.id}.${i}`;
    sp.eventMode = "none";
    sp.visible = false;
    canvas.primary.addChild(sp);
    return sp;
  });
  shades.set(tile.id, { tile, sprites, layers: ls, sortedFor: null });
  if (!ticking) {
    canvas.app.ticker.add(follow);
    ticking = true;
  }
}

export const dropShadow = (id) => forget(id);
export const shadowKeys = () => shades.keys();

/** Силуэт картинки, размытый на `blur` клеток при `perCell` точках картинки на клетку. */
function baked(tex, perCell, blur) {
  const scale = Math.min(1, BAKE_PER_CELL / Math.max(perCell, 1));
  const px = Math.max(0.5, blur * perCell * scale * 0.5);
  const key = `${tex.baseTexture?.uid ?? tex.textureCacheIds?.[0]}|${tex.frame?.x},${tex.frame?.y},${tex.frame?.width}|${scale.toFixed(3)}|${px.toFixed(1)}`;
  let b = bakes.get(key);
  if (!b) {
    b = bakeTexture(tex, { scale, blur: px, tint: 0x000000 });
    bakes.set(key, b);
  }
  return b;
}

function follow() {
  if (!shades.size || !canvas.ready) {
    canvas.app?.ticker.remove(follow);
    ticking = false;
    return;
  }
  const grid = canvas.grid.size;
  const s = sun();
  const a = (s.angle * Math.PI) / 180;
  const [ux, uy] = [Math.cos(a), Math.sin(a)];
  for (const sh of shades.values()) {
    const mesh = sh.tile.mesh;
    if (!mesh || mesh.destroyed) continue;
    const tex = mesh.texture;
    const shown = mesh.visible && mesh.renderable !== false && sh.tile.visible !== false && tex?.valid;
    const doc = sh.tile.document;
    const perCell = (tex?.orig?.width ?? tex?.width ?? 1) / Math.max(Math.abs(doc.width) / grid, 0.1);
    sh.sprites.forEach((sp, i) => {
      if (sp.destroyed) return;
      if (!shown) { sp.visible = false; return; }
      const l = sh.layers[i];
      const b = baked(tex, perCell, l.blur);
      placeBaked(sp, b, mesh.anchor.x, mesh.anchor.y);
      sp.position.set(mesh.position.x + ux * l.dist * grid, mesh.position.y + uy * l.dist * grid);
      sp.rotation = mesh.rotation;
      sp.scale.set(mesh.scale.x / b.scale, mesh.scale.y / b.scale);
      sp.elevation = mesh.elevation;
      sp.sortLayer = mesh.sortLayer;
      sp.sort = (mesh.sort ?? 0) - 0.5;
      sp.alpha = l.opacity * (mesh.alpha ?? 1);
      sp.visible = true;
    });
    if (sh.sortedFor !== mesh) { canvas.primary.sortDirty = true; sh.sortedFor = mesh; }
  }
}

export function registerShadows() {
  game.settings.register(MODULE_ID, "objectShadows", {
    name: "BLM.Setting.objectShadows", hint: "BLM.Setting.objectShadowsHint",
    scope: "client", config: true, type: Boolean, default: true,
    onChange: () => rebuildShadows()
  });
  Hooks.on("canvasReady", () => rebuildShadows());
  Hooks.on("canvasTearDown", () => {
    for (const sh of shades.values()) for (const sp of sh.sprites) if (!sp.destroyed) sp.destroy();
    shades.clear();
    for (const b of bakes.values()) b.rt.destroy(true);
    bakes.clear();
  });
  for (const hook of ["createTile", "updateTile", "deleteTile"]) {
    Hooks.on(hook, (doc) => {
      if (doc.parent === canvas.scene) setTimeout(() => rebuildShadows(), 0);
    });
  }
  // Солнце сменили у сцены — тени заново.
  Hooks.on("updateScene", (doc, change) => {
    if (doc === canvas.scene && foundry.utils.hasProperty(change, `flags.${MODULE_ID}.shadows`)) setTimeout(() => rebuildShadows(), 0);
  });
  // Только что созданный тайл получает меш позже createTile — ловим отрисовку.
  Hooks.on("drawTile", (tile) => {
    if (tile.document?.parent === canvas.scene && shadowOf(tile.document) && !shades.has(tile.id)) setTimeout(() => rebuildShadows(), 0);
  });
}
