// Парение: тайл с пометкой `flags.burn-living-map.hover` (дирижабль, аэростат)
// висит в воздухе. Меш тайла медленно плывёт по восьмёрке, чуть поворачивается
// и «дышит» — поднимаясь, становится крупнее. Под ним по земле и крышам ползёт
// размытая тень: чем выше корабль, тем дальше и бледнее она.
//
// Документ тайла не меняется: качает каждый игрок у себя. Foundry сам ставит
// мешу позицию, поворот и масштаб (только при правке тайла) — замечаем это по
// расхождению с тем, что ставили сами, и берём новое за основу.
//
// Число в пометке — сила: 1 — обычное парение, меньше — едва заметное.
//
// Фильтры размытия внутри основной группы холста Foundry не рисуются, поэтому
// тень запекается один раз в уменьшенную текстуру, а дальше лишь двигается.

const MODULE_ID = "burn-living-map";
/** Куда падает тень, градусы по часовой от «вправо» — как у теней Картографа. */
const SUN = 45;

/** Размытие тени, клетки. */
const SOFT = 0.2;

/** @type {Map<string, {tile: Tile, amp: number, phase: number, shadow: PIXI.Sprite, baked: object|null, base: object|null, set: object|null}>} */
const ships = new Map();
let ticking = false;

/** Сила парения тайла: 0 — не парит. */
export function hoverOf(doc) {
  const v = doc?.flags?.[MODULE_ID]?.hover;
  if (v === true) return 1;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 3) : 0;
}

/**
 * Картинка, запечённая в текстуру: уменьшенная, подкрашенная, через фильтры и
 * с размытием. `pad` — поле под размытие в точках запечённой текстуры.
 */
export function bakeTexture(tex, { scale = 0.25, blur = 0, tint = 0xffffff, filters = [] } = {}) {
  const tw = tex.orig?.width ?? tex.width, th = tex.orig?.height ?? tex.height;
  const pad = Math.ceil(blur * 3) + 2;
  const w = Math.max(1, Math.ceil(tw * scale) + pad * 2), h = Math.max(1, Math.ceil(th * scale) + pad * 2);
  const rt = PIXI.RenderTexture.create({ width: w, height: h });
  const root = new PIXI.Container();
  const sp = root.addChild(new PIXI.Sprite(tex));
  sp.scale.set(scale);
  sp.position.set(pad, pad);
  sp.tint = tint;
  const fs = [...filters];
  if (blur > 0) {
    const f = new PIXI.BlurFilter(blur, 4);
    f.padding = pad;
    fs.push(f);
  }
  if (fs.length) {
    root.filters = fs;
    root.filterArea = new PIXI.Rectangle(0, 0, w, h);
  }
  canvas.app.renderer.render(root, { renderTexture: rt, clear: true });
  root.destroy({ children: true });
  return { rt, pad, scale, w, h, tw, th, tex };
}

/** Спрайт запечённой картинки ложится туда же, где лежала бы исходная с этим якорем. */
export function placeBaked(sprite, b, ax = 0.5, ay = 0.5) {
  if (sprite.texture !== b.rt) sprite.texture = b.rt;
  sprite.anchor.set((b.pad + ax * b.tw * b.scale) / b.w, (b.pad + ay * b.th * b.scale) / b.h);
}

function hash(s) {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) | 0;
  const x = Math.sin(h) * 43758.5453;
  return x - Math.floor(x);
}

function land(id) {
  const s = ships.get(id);
  if (!s) return;
  const mesh = s.tile.mesh;
  if (mesh && !mesh.destroyed && s.base && s.set) {
    // Вернуть меш туда, где его поставил Foundry, если с тех пор его не трогал.
    if (mesh.position.x === s.set.x && mesh.position.y === s.set.y) mesh.position.set(s.base.x, s.base.y);
    if (mesh.rotation === s.set.r) mesh.rotation = s.base.r;
    if (mesh.scale.x === s.set.sx && mesh.scale.y === s.set.sy) mesh.scale.set(s.base.sx, s.base.sy);
  }
  if (!s.shadow.destroyed) s.shadow.destroy();
  s.baked?.rt.destroy(true);
  ships.delete(id);
}

export function clearHover() {
  for (const id of [...ships.keys()]) land(id);
}

export function rebuildHover() {
  clearHover();
  if (!canvas.ready || !canvas.tiles) return;
  for (const tile of canvas.tiles.placeables) addHover(tile);
}

/** Поднять тайл в воздух: тайл Foundry или меш Boundless под видом тайла (см. boundless.js). */
export function addHover(tile) {
  const amp = hoverOf(tile.document);
  if (!amp || !tile.mesh || ships.has(tile.id) || !canvas.ready || !game.settings.get(MODULE_ID, "enabled")) return;
  const shadow = new PIXI.Sprite(PIXI.Texture.EMPTY);
  shadow.name = `${MODULE_ID}.hover.${tile.id}`;
  shadow.eventMode = "none";
  canvas.primary.addChild(shadow);
  ships.set(tile.id, { tile, amp, phase: hash(tile.id) * 100, shadow, baked: null, base: null, set: null, sortedFor: null });
  if (!ticking) {
    canvas.app.ticker.add(float);
    ticking = true;
  }
}

export const dropHover = (id) => land(id);
export const hoverKeys = () => ships.keys();

function float() {
  if (!ships.size || !canvas.ready) {
    canvas.app?.ticker.remove(float);
    ticking = false;
    return;
  }
  const t = performance.now() / 1000;
  const grid = canvas.grid.size;
  const sun = (SUN * Math.PI) / 180;
  for (const s of ships.values()) {
    const mesh = s.tile.mesh;
    if (!mesh || mesh.destroyed || s.shadow.destroyed) continue;
    // Foundry переставил меш (правка тайла) — это новая основа.
    const moved = !s.set || mesh.position.x !== s.set.x || mesh.position.y !== s.set.y;
    if (moved) s.base = { ...(s.base ?? {}), x: mesh.position.x, y: mesh.position.y };
    if (!s.set || mesh.rotation !== s.set.r) s.base = { ...s.base, r: mesh.rotation };
    if (!s.set || mesh.scale.x !== s.set.sx || mesh.scale.y !== s.set.sy) s.base = { ...s.base, sx: mesh.scale.x, sy: mesh.scale.y };
    const b = s.base, k = s.amp, p = s.phase;

    // Большой корабль плывёт медленнее мелкого.
    const size = Math.max(s.tile.document.width, s.tile.document.height) / grid;
    const slow = Math.min(Math.max(Math.sqrt(size / 4), 0.8), 2);
    // Подъём −1..1: медленный вдох и мелкая зыбь поверх.
    const lift = 0.8 * Math.sin(t * 0.9 / slow + p) + 0.2 * Math.sin(t * 2.3 / slow + p * 2.3);
    // Дрейф восьмёркой, доли клетки.
    const dx = grid * 0.14 * k * Math.sin(t * 0.5 / slow + p * 1.7);
    const dy = grid * 0.09 * k * Math.sin(t * 1.0 / slow + p * 0.9);
    const turn = 0.013 * k * Math.sin(t * 0.4 / slow + p * 3.1) + 0.004 * k * Math.sin(t * 1.3 / slow + p);
    const grow = 1 + 0.016 * k * lift;

    const x = b.x + dx, y = b.y + dy, r = b.r + turn, sx = b.sx * grow, sy = b.sy * grow;
    mesh.position.set(x, y);
    mesh.rotation = r;
    mesh.scale.set(sx, sy);
    s.set = { x, y, r, sx, sy };

    // Тень: от солнца, ниже корабля по сортировке; выше — дальше и бледнее.
    const sh = s.shadow;
    const tex = mesh.texture;
    if (tex?.valid && s.baked?.tex !== tex) {
      s.baked?.rt.destroy(true);
      // Размытие — доля клетки в точках картинки тайла, запекаем в четверть.
      const perCell = (tex.orig?.width ?? tex.width) / Math.max(s.tile.document.width / grid, 0.1);
      s.baked = bakeTexture(tex, { scale: 0.25, blur: SOFT * perCell * 0.25, tint: 0x000000 });
    }
    if (!s.baked) { sh.visible = false; continue; }
    placeBaked(sh, s.baked, mesh.anchor.x, mesh.anchor.y);
    const reach = grid * (0.9 + 0.25 * lift) * Math.sqrt(k);
    sh.position.set(x + Math.cos(sun) * reach, y + Math.sin(sun) * reach);
    sh.rotation = r;
    const shrink = (0.97 - 0.012 * lift) / s.baked.scale;
    sh.scale.set(b.sx * shrink, b.sy * shrink);
    sh.elevation = mesh.elevation;
    sh.sortLayer = mesh.sortLayer;
    sh.sort = (mesh.sort ?? 0) - 0.5;
    if (s.sortedFor !== mesh) { canvas.primary.sortDirty = true; s.sortedFor = mesh; }
    sh.visible = mesh.visible && s.tile.visible !== false;
    sh.alpha = (0.5 - 0.08 * lift) * (mesh.alpha ?? 1);
  }
}

export function registerHover() {
  Hooks.on("canvasReady", () => rebuildHover());
  Hooks.on("canvasTearDown", () => {
    for (const s of ships.values()) {
      if (!s.shadow.destroyed) s.shadow.destroy();
      s.baked?.rt.destroy(true);
    }
    ships.clear();
  });
  for (const hook of ["createTile", "updateTile", "deleteTile"]) {
    Hooks.on(hook, (doc) => {
      if (doc.parent === canvas.scene) setTimeout(() => rebuildHover(), 0);
    });
  }
  // Только что созданный тайл получает меш позже createTile — ловим отрисовку.
  Hooks.on("drawTile", (tile) => {
    if (tile.document?.parent === canvas.scene && hoverOf(tile.document) && !ships.has(tile.id)) setTimeout(() => rebuildHover(), 0);
  });
}

/* ------------------------------ Окно тайла ------------------------------ */

Hooks.on("renderTileConfig", (app, element) => {
  const root = element instanceof HTMLElement ? element : element[0];
  const tab = root?.querySelector('.tab[data-tab="appearance"]') ?? root?.querySelector(".tab[data-tab]");
  if (!tab || tab.querySelector(`.${MODULE_ID}-hover`)) return;
  const loc = (k) => game.i18n.localize(`BLM.${k}`);
  const now = hoverOf(app.document);
  const set = document.createElement("fieldset");
  set.className = `${MODULE_ID}-hover`;
  set.innerHTML = `
    <legend>🔥 ${loc("Hover.Title")}</legend>
    <div class="form-group">
      <label>${loc("Hover.Label")}</label>
      <div class="form-fields"><range-picker name="flags.${MODULE_ID}.hover" value="${now}" min="0" max="3" step="0.1"></range-picker></div>
      <p class="hint">${loc("Hover.Hint")}</p>
    </div>`;
  tab.append(set);
});
