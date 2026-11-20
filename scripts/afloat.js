// На воде: тайл с пометкой `flags.burn-living-map.afloat` (лист бумаги, поплавок,
// щепка) лежит на стоячей воде и едва ходит: дрейф в пару сотых клетки и поворот
// на пару градусов, у каждого тайла в своём ритме.
//
// Документ тайла не меняется: покачивает каждый игрок у себя. Foundry сам ставит
// мешу позицию и поворот (только при правке тайла) — замечаем это по расхождению
// с тем, что ставили сами, и берём новое за основу (как у парения, см. hover.js).
//
// Число в пометке — сила: 1 — лист бумаги на стоячей воде, больше — заметнее.

const MODULE_ID = "burn-living-map";

/** @type {Map<string, {tile: Tile, amp: number, phase: number, base: object|null, set: object|null}>} */
const floaters = new Map();
let ticking = false;

/** Сила покачивания тайла: 0 — лежит неподвижно. */
export function afloatOf(doc) {
  const v = doc?.flags?.[MODULE_ID]?.afloat;
  if (v === true) return 1;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 3) : 0;
}

function hash(s) {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) | 0;
  const x = Math.sin(h) * 43758.5453;
  return x - Math.floor(x);
}

function settle(id) {
  const s = floaters.get(id);
  if (!s) return;
  const mesh = s.tile.mesh;
  if (mesh && !mesh.destroyed && s.base && s.set) {
    // Вернуть меш туда, где его поставил Foundry, если с тех пор его не трогал.
    if (mesh.position.x === s.set.x && mesh.position.y === s.set.y) mesh.position.set(s.base.x, s.base.y);
    if (mesh.rotation === s.set.r) mesh.rotation = s.base.r;
  }
  floaters.delete(id);
}

export function clearAfloat() {
  for (const id of [...floaters.keys()]) settle(id);
}

export function rebuildAfloat() {
  clearAfloat();
  if (!canvas.ready || !canvas.tiles) return;
  for (const tile of canvas.tiles.placeables) addAfloat(tile);
}

/** Пустить тайл по воде: тайл Foundry или меш Boundless под видом тайла (см. boundless.js). */
export function addAfloat(tile) {
  const amp = afloatOf(tile.document);
  if (!amp || !tile.mesh || floaters.has(tile.id) || !canvas.ready || !game.settings.get(MODULE_ID, "enabled")) return;
  floaters.set(tile.id, { tile, amp, phase: hash(tile.id) * 100, base: null, set: null });
  if (!ticking) {
    canvas.app.ticker.add(bob);
    ticking = true;
  }
}

export const dropAfloat = (id) => settle(id);
export const afloatKeys = () => floaters.keys();

function bob() {
  if (!floaters.size || !canvas.ready) {
    canvas.app?.ticker.remove(bob);
    ticking = false;
    return;
  }
  const t = performance.now() / 1000;
  const grid = canvas.grid.size;
  for (const s of floaters.values()) {
    const mesh = s.tile.mesh;
    if (!mesh || mesh.destroyed) continue;
    // Foundry переставил меш (правка тайла) — это новая основа.
    if (!s.set || mesh.position.x !== s.set.x || mesh.position.y !== s.set.y) s.base = { ...(s.base ?? {}), x: mesh.position.x, y: mesh.position.y };
    if (!s.set || mesh.rotation !== s.set.r) s.base = { ...s.base, r: mesh.rotation };
    const b = s.base, k = s.amp, p = s.phase;
    // Два несовпадающих ритма на каждую ось: движение не повторяется на глаз.
    const dx = grid * k * (0.028 * Math.sin(t * 0.47 + p * 1.7) + 0.011 * Math.sin(t * 1.13 + p));
    const dy = grid * k * (0.024 * Math.sin(t * 0.39 + p * 0.9) + 0.010 * Math.sin(t * 0.97 + p * 2.1));
    const turn = k * (0.05 * Math.sin(t * 0.33 + p * 3.1) + 0.018 * Math.sin(t * 0.81 + p * 1.3));
    const x = b.x + dx, y = b.y + dy, r = b.r + turn;
    mesh.position.set(x, y);
    mesh.rotation = r;
    s.set = { x, y, r };
  }
}

export function registerAfloat() {
  Hooks.on("canvasReady", () => rebuildAfloat());
  Hooks.on("canvasTearDown", () => floaters.clear());
  for (const hook of ["createTile", "updateTile", "deleteTile"]) {
    Hooks.on(hook, (doc) => {
      if (doc.parent === canvas.scene) setTimeout(() => rebuildAfloat(), 0);
    });
  }
  // Только что созданный тайл получает меш позже createTile — ловим отрисовку.
  Hooks.on("drawTile", (tile) => {
    if (tile.document?.parent === canvas.scene && afloatOf(tile.document) && !floaters.has(tile.id)) setTimeout(() => rebuildAfloat(), 0);
  });
}

/* ------------------------------ Окно тайла ------------------------------ */

Hooks.on("renderTileConfig", (app, element) => {
  const root = element instanceof HTMLElement ? element : element[0];
  const tab = root?.querySelector('.tab[data-tab="appearance"]') ?? root?.querySelector(".tab[data-tab]");
  if (!tab || tab.querySelector(`.${MODULE_ID}-afloat`)) return;
  const loc = (k) => game.i18n.localize(`BLM.${k}`);
  const now = afloatOf(app.document);
  const set = document.createElement("fieldset");
  set.className = `${MODULE_ID}-afloat`;
  set.innerHTML = `
    <legend>🔥 ${loc("Afloat.Title")}</legend>
    <div class="form-group">
      <label>${loc("Afloat.Label")}</label>
      <div class="form-fields"><range-picker name="flags.${MODULE_ID}.afloat" value="${now}" min="0" max="3" step="0.1"></range-picker></div>
      <p class="hint">${loc("Afloat.Hint")}</p>
    </div>`;
  tab.append(set);
});
