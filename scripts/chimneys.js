// Дым из труб. Картограф вшивает дымоходы в картинку крыши и ставит тайлу метку
//   flags["burn-living-map"] = { chimneys: [[x, y, size], ...] }
// (x, y — середина трубы в точках сцены, size — её сторона в точках).
// Над каждой трубой идут клубы: родятся у устья, растут, светлеют и тают,
// уходя по ветру сцены (настройки «Ветер в кронах»), с ленивым покачиванием.
//
// Клубы рисуются в свою текстуру и выходят на сцену спрайтом Foundry
// (PrimarySpriteMesh) на высоте крыши, с её затуханием: игрок вошёл в дом —
// крыша гаснет, и дым над ней тоже. Так же устроены сливы (scupper.js).

import { wind } from "./wind.js";

const MODULE_ID = "burn-living-map";
/** Сторона текстуры дыма и сколько клеток она покрывает (труба — посередине). */
const SIZE = 320;
const CELLS = 9;
const PUFFS = 11;
/** Секунды жизни клуба. */
const LIFE = 5.2;

/** @type {Map<string, {tile: Tile, items: object[]}>} */
const roofs = new Map();
let puffTex = null;
let ticking = false;

const on = () => game.settings.get(MODULE_ID, "enabled");

function hash(n) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function chimneysOf(doc) {
  const c = doc?.flags?.[MODULE_ID]?.chimneys;
  return Array.isArray(c) && c.length ? c.filter((v) => Array.isArray(v) && v.length >= 2) : null;
}

/** Клуб: мягкое пятно из нескольких наложенных кругов — край рваный, не шар. */
function puffTexture() {
  if (puffTex && !puffTex.baseTexture?.destroyed) return puffTex;
  const n = 96;
  const cv = document.createElement("canvas");
  cv.width = cv.height = n;
  const g = cv.getContext("2d");
  for (let i = 0; i < 7; i++) {
    const a = hash(i * 3.1) * Math.PI * 2, r = (i ? 0.16 : 0) * n * (0.6 + hash(i * 7.7));
    const x = n / 2 + Math.cos(a) * r, y = n / 2 + Math.sin(a) * r;
    const rad = n * (i ? 0.22 + 0.1 * hash(i * 5.3) : 0.34);
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, "rgba(255,255,255,0.55)");
    gr.addColorStop(0.55, "rgba(255,255,255,0.25)");
    gr.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = gr;
    g.beginPath();
    g.arc(x, y, rad, 0, Math.PI * 2);
    g.fill();
  }
  puffTex = PIXI.Texture.from(cv);
  return puffTex;
}

/* ------------------------------ Сборка ------------------------------ */

function buildOne(tile, [x, y, size], n) {
  const grid = canvas.grid.size;
  const root = new PIXI.Container();
  const tex = puffTexture();
  const seed = hash(n * 17.3 + tile.id.charCodeAt(0) + tile.id.charCodeAt(tile.id.length - 1));
  const puffs = [];
  for (let i = 0; i < PUFFS; i++) {
    const s = new PIXI.Sprite(tex);
    s.anchor.set(0.5);
    s.rotation = hash(i * 9.1 + seed * 50) * Math.PI * 2;
    root.addChild(s);
    puffs.push({ s, phase: i / PUFFS + hash(i + seed * 30) * 0.06, spin: (hash(i * 2.3 + seed) - 0.5) * 0.5 });
  }
  const rt = PIXI.RenderTexture.create({ width: SIZE, height: SIZE });
  const Mesh = foundry.canvas?.primary?.PrimarySpriteMesh ?? globalThis.PrimarySpriteMesh;
  const mesh = new Mesh({ texture: rt, name: `${MODULE_ID}.chimney.${tile.id}.${n}`, object: tile });
  mesh.anchor.set(0.5, 0.5);
  mesh.position.set(x, y);
  mesh.scale.set((CELLS * grid) / SIZE);
  mesh.eventMode = "none";
  mesh.hoverFade = false;
  // Затухание — как у крыши: её состояние копируется после своего пересчёта.
  const own = mesh.updateTransform;
  mesh.updateTransform = function () {
    own.call(this);
    const tm = tile.mesh;
    if (tm && !tm.destroyed) Object.assign(this._occlusionState, tm._occlusionState);
  };
  canvas.primary.addChild(mesh);
  // Радиус клуба у устья в точках текстуры: у трубы в клетку — 0,45 клетки,
  // к концу жизни он втрое шире.
  const mouth = Math.max(0.5, Math.min(2, (Number(size) || grid) / grid)) * 0.45 * (SIZE / CELLS);
  return { tile, root, puffs, rt, mesh, seed, mouth };
}

function drop(id) {
  const r = roofs.get(id);
  if (!r) return;
  for (const it of r.items) {
    if (!it.mesh.destroyed) it.mesh.destroy();
    it.root.destroy({ children: true });
    it.rt.destroy(true);
  }
  roofs.delete(id);
}

export function clearChimneys() {
  for (const id of [...roofs.keys()]) drop(id);
  if (ticking) canvas.app?.ticker.remove(tick);
  ticking = false;
}

export function rebuildChimneys() {
  clearChimneys();
  if (!canvas.ready || !canvas.primary || !canvas.tiles || !on()) return;
  for (const tile of canvas.tiles.placeables) {
    const list = chimneysOf(tile.document);
    if (!list || !tile.mesh || tile.mesh.destroyed) continue;
    roofs.set(tile.id, { tile, items: list.map((c, i) => buildOne(tile, c, i)) });
  }
  if (!roofs.size) return;
  canvas.primary.sortDirty = true;
  if (!ticking) {
    canvas.app.ticker.add(tick);
    ticking = true;
  }
}

/* ------------------------------ Кадр ------------------------------ */

function tick() {
  if (!roofs.size || !canvas.ready) return clearChimneys();
  const t = performance.now() / 1000;
  const { force, dx, dy } = wind();
  const strength = game.settings.get(MODULE_ID, "strength");
  for (const { tile, items } of roofs.values()) {
    const tm = tile.mesh;
    if (!tm || tm.destroyed) continue;
    for (const it of items) draw(it, tm, t, force, dx, dy, strength);
  }
}

function draw(it, tm, t, force, dx, dy, strength) {
  const { mesh } = it;
  if (mesh.destroyed) return;
  mesh.elevation = tm.elevation;
  mesh.sortLayer = tm.sortLayer;
  if (mesh.sort !== (tm.sort ?? 0) + 0.6) {
    mesh.sort = (tm.sort ?? 0) + 0.6;
    canvas.primary.sortDirty = true;
  }
  mesh._occludedBySameElevationSurfaces = tm._occludedBySameElevationSurfaces;
  mesh.occlusionMode = tm.occlusionMode;
  mesh.occluded = tm.occluded;
  mesh.unoccludedAlpha = tm.unoccludedAlpha;
  mesh.occludedAlpha = tm.occludedAlpha;
  mesh.alpha = tm.alpha;
  mesh.visible = tm.visible && tm.renderable !== false && it.tile?.visible !== false;
  if (!mesh.visible) return;

  // Тихо — дым встаёт столбом и расплывается на месте; ветер — уносит шлейфом.
  const k = Math.min(force, 2.5);
  const reach = (SIZE / CELLS) * (0.8 + 1.4 * Math.min(k, 1.5));
  const c = SIZE / 2;
  const [nx, ny] = [-dy, dx];
  for (const p of it.puffs) {
    const a = (t / LIFE + p.phase + it.seed) % 1;
    const sway = Math.sin(t * 0.55 + p.phase * 9 + it.seed * 20) * (0.35 + a) * (SIZE / CELLS) * 0.45;
    const along = reach * Math.pow(a, 0.85);
    p.s.position.set(c + dx * along + nx * sway, c + dy * along + ny * sway);
    const r = it.mouth * (0.55 + 2.4 * a);
    p.s.scale.set((r * 2) / 96);
    p.s.rotation += p.spin * 0.016;
    // Рождается плотным и тёмным у устья, светлеет и тает.
    const fadeIn = Math.min(1, a / 0.12);
    p.s.alpha = fadeIn * Math.pow(1 - a, 1.3) * Math.min(1, 0.4 + 0.6 * strength);
    const shade = Math.round(150 + 85 * a);
    p.s.tint = (shade << 16) | (shade << 8) | (shade + 4 > 255 ? 255 : shade + 4);
  }
  canvas.app.renderer.render(it.root, { renderTexture: it.rt, clear: true });
}

/* ------------------------------ Хуки ------------------------------ */

export function registerChimneys() {
  Hooks.on("canvasReady", () => rebuildChimneys());
  Hooks.on("canvasTearDown", () => clearChimneys());
  const again = foundry.utils.debounce(() => rebuildChimneys(), 100);
  for (const hook of ["createTile", "updateTile", "deleteTile"]) {
    Hooks.on(hook, (doc) => { if (doc.parent === canvas.scene && (chimneysOf(doc) || roofs.has(doc.id))) again(); });
  }
  // Новый тайл получает картинку позже createTile — ловим отрисовку.
  Hooks.on("drawTile", (tile) => {
    if (tile.document?.parent === canvas.scene && chimneysOf(tile.document) && !roofs.has(tile.id)) again();
  });
  Hooks.on("clientSettingChanged", (key) => {
    if (key === `${MODULE_ID}.enabled`) rebuildChimneys();
  });
}
