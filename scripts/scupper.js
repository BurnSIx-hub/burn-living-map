// Сливы крыш под дождём. Картограф вшивает сливы `Roof_Scupper_A` в картинку
// плоской крыши и ставит тайлу метку
//   flags["burn-living-map"] = { scuppers: [[x, y, rot], ...], scupperSize }
// (x, y — середина слива в точках сцены, rot — градусы по часовой, 0 — носик вверх).
// Когда на сцене дождь (`rain`, `rainStorm`), по каждому сливу бежит вода: кровля
// у лотка мокнет, по дну лотка течёт рябь, из носика бьёт струя в воронку, у трубы
// брызги, по мокрому пятну — круги от капель. Дождь начался — вода набирается,
// кончился — стекает и пропадает.
//
// Слив рисуется в свою текстуру 256 px (раскладка как у ассета: y 0..96 воронка
// снаружи, 96..160 лоток в парапете, 160..256 кровля), а на сцену выходит спрайтом
// Foundry (PrimarySpriteMesh) на высоте крыши, с её режимами затухания: гаснет,
// когда гаснет крыша, в том числе круглым вырезом вокруг токена.
// Слои — `assets/rain/`, сняты скриптом `Kartograf Work/tools/scupper_rain_layers.py`.

const MODULE_ID = "burn-living-map";
const RAIN = { rain: 1, rainStorm: 1.8 };
const SIZE = 256;
const CX = SIZE / 2;
/** Дырка трубы в воронке — куда бьёт струя. */
const HOLE_Y = 40;
const ASSET = `modules/${MODULE_ID}/assets/rain/`;
const V = "?v=1";
/** Секунды, за которые вода набирается и стекает. */
const RISE = 5, FALL = 9;

/** @type {Map<string, {tile: Tile, items: object[]}>} */
const roofs = new Map();
let tex = null;
let ticking = false;
let gen = 0;
let wet = 0;
/** Сцена прошлой сборки: смена погоды перерисовывает холст той же сцены — вода не сбрасывается. */
let lastScene = null;

const on = () => game.settings.get(MODULE_ID, "enabled") && game.settings.get(MODULE_ID, "groundWeather");
const rainLevel = () => RAIN[canvas.scene?.weather ?? ""] ?? 0;

function hash(n) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

async function textures() {
  if (tex) return tex;
  const load = foundry.canvas?.loadTexture ?? globalThis.loadTexture;
  const [stain, trough, jet, flow] = await Promise.all(["stain", "trough", "jet", "flow"].map((n) => load(`${ASSET}${n}.png${V}`)));
  if (flow?.baseTexture) flow.baseTexture.wrapMode = PIXI.WRAP_MODES.REPEAT;
  tex = { stain, trough, jet, flow };
  return tex;
}

function scuppersOf(doc) {
  const f = doc?.flags?.[MODULE_ID];
  return Array.isArray(f?.scuppers) && f.scuppers.length ? f : null;
}

/* ------------------------------ Сборка ------------------------------ */

/** Рябь под маской: два слоя бегут с разной скоростью — вода «живёт». */
function stream(mask, w, h) {
  const box = new PIXI.Container();
  const a = new PIXI.TilingSprite(tex.flow, w, h);
  const b = new PIXI.TilingSprite(tex.flow, w, h);
  b.alpha = 0.55;
  b.tilePosition.x = 23;
  b.tileScale.set(-1, 1);
  box.addChild(a, b);
  const m = new PIXI.Sprite(mask);
  box.mask = m;
  return { box, mask: m, a, b };
}

function buildOne(tile, [x, y, rot], size, n) {
  const root = new PIXI.Container();
  const stain = new PIXI.Sprite(tex.stain);
  const trough = stream(tex.trough, SIZE, SIZE);
  const jet = stream(tex.jet, SIZE, SIZE);
  const fx = new PIXI.Graphics();
  root.addChild(stain, trough.box, trough.mask, jet.box, jet.mask, fx);
  const rt = PIXI.RenderTexture.create({ width: SIZE, height: SIZE });
  const Mesh = foundry.canvas?.primary?.PrimarySpriteMesh ?? globalThis.PrimarySpriteMesh;
  const mesh = new Mesh({ texture: rt, name: `${MODULE_ID}.scupper.${tile.id}.${n}`, object: tile });
  mesh.anchor.set(0.5, 0.5);
  mesh.position.set(x, y);
  mesh.rotation = ((rot || 0) * Math.PI) / 180;
  mesh.scale.set(size / SIZE);
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
  return { tile, root, stain, trough, jet, fx, rt, mesh, seed: hash(n + tile.id.charCodeAt(0)) * 50 };
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

export function clearScuppers() {
  for (const id of [...roofs.keys()]) drop(id);
  if (ticking) canvas.app?.ticker.remove(tick);
  ticking = false;
}

/** @param {boolean} [fresh] сцена только открылась: если уже льёт — вода сразу есть,
 * если сухо — нет. Иначе вода набирается или стекает с того, что было. */
export async function rebuildScuppers(fresh = false) {
  const my = ++gen;
  clearScuppers();
  if (!canvas.ready || !canvas.primary || !canvas.tiles || !on()) return;
  const level = rainLevel();
  const list = canvas.tiles.placeables.filter((t) => scuppersOf(t.document) && t.mesh && !t.mesh.destroyed);
  if (fresh) wet = level ? 1 : 0;
  if (!list.length || (!level && wet <= 0)) { wet = 0; return; }
  await textures();
  if (my !== gen || !canvas.ready) return;
  for (const tile of list) {
    const f = scuppersOf(tile.document);
    const size = Number(f.scupperSize) || canvas.grid.size;
    const items = f.scuppers.filter((s) => Array.isArray(s) && s.length >= 2).map((s, i) => buildOne(tile, s, size, i));
    roofs.set(tile.id, { tile, items });
  }
  canvas.primary.sortDirty = true;
  if (!ticking) {
    canvas.app.ticker.add(tick);
    ticking = true;
  }
}

/* ------------------------------ Кадр ------------------------------ */

function tick() {
  if (!roofs.size || !canvas.ready) return clearScuppers();
  const dt = Math.min(canvas.app.ticker.deltaMS / 1000, 0.1);
  const t = performance.now() / 1000;
  const level = rainLevel();
  wet = level ? Math.min(1, wet + dt / RISE) : Math.max(0, wet - dt / FALL);
  if (!level && wet <= 0) return clearScuppers();
  // Сила — по последнему дождю, пока вода стекает.
  const L = level || 1;
  for (const { tile, items } of roofs.values()) {
    const tm = tile.mesh;
    if (!tm || tm.destroyed) continue;
    for (const it of items) draw(it, tm, dt, t, L);
  }
}

function draw(it, tm, dt, t, L) {
  const { mesh } = it;
  if (mesh.destroyed) return;
  mesh.elevation = tm.elevation;
  mesh.sortLayer = tm.sortLayer;
  if (mesh.sort !== (tm.sort ?? 0) + 0.5) {
    mesh.sort = (tm.sort ?? 0) + 0.5;
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

  // Пятно мокнет медленнее, чем бежит вода; сходит тоже позже.
  const w = wet;
  it.stain.alpha = Math.min(1, w * 1.3);
  const flow = Math.max(0, (w - 0.15) / 0.85);
  const k = L / 1.8;

  // Вода в лотке: течёт от кровли к носику (в раскладке — вверх).
  const tr = it.trough;
  tr.a.tilePosition.y -= dt * (26 + 22 * k);
  tr.b.tilePosition.y -= dt * (41 + 30 * k);
  tr.b.tilePosition.x = 23 + Math.sin(t * 0.9 + it.seed) * 3;
  tr.box.alpha = flow * (0.7 + 0.3 * k);

  // Струя: быстрее, дрожит; в ливень плотнее.
  const jt = it.jet;
  jt.a.tilePosition.y -= dt * (90 + 50 * k);
  jt.b.tilePosition.y -= dt * (120 + 60 * k);
  jt.b.tilePosition.x = 23 + Math.sin(t * 7 + it.seed) * 1.5;
  jt.box.alpha = flow * (0.75 + 0.25 * k) * (0.88 + 0.12 * Math.sin(t * 17 + it.seed));

  // Брызги у трубы и капли по мокрой кровле.
  const g = it.fx;
  g.clear();
  if (flow > 0) {
    const tint = 0xd2e6f0;
    g.beginFill(tint, (0.22 + 0.1 * Math.sin(t * 11 + it.seed)) * flow).drawEllipse(CX, HOLE_Y + 2, 9, 6).endFill();
    for (let i = 0; i < 3; i++) {
      const p = (t * (1.4 + 0.6 * k) + i / 3 + it.seed) % 1;
      g.lineStyle(1.3, tint, (1 - p) * 0.5 * flow).drawEllipse(CX, HOLE_Y + 2, 6 + p * 15, 4 + p * 10);
    }
    g.lineStyle(0);
    // Капли разлетаются от удара струи — каждую долю секунды новая горсть.
    const burst = Math.floor(t * 6 + it.seed), ph = (t * 6 + it.seed) % 1;
    for (let i = 0; i < 4 + Math.round(3 * k); i++) {
      const h = hash(burst * 13 + i);
      const a = h * Math.PI * 2, r = 5 + ph * (8 + 10 * hash(burst * 7 + i));
      g.beginFill(tint, (1 - ph) * 0.7 * flow).drawCircle(CX + Math.cos(a) * r, HOLE_Y + 2 + Math.sin(a) * r * 0.7, 1.1).endFill();
    }
  }
  if (w > 0) {
    for (let i = 0; i < 3 + Math.round(3 * k); i++) {
      const per = 0.9 + hash(i * 3.7 + it.seed) * 0.8;
      const n = Math.floor(t / per + hash(i + it.seed)), p = (t / per + hash(i + it.seed)) % 1;
      const dy = hash(n * 5.1 + i) * 70, x = CX + (hash(n * 9.3 + i) - 0.5) * (40 + dy * 1.2), y = 168 + dy;
      g.lineStyle(1, 0xc8dce6, (1 - p) * 0.45 * w).drawCircle(x, y, 1.5 + p * 6);
    }
    g.lineStyle(0);
  }
  canvas.app.renderer.render(it.root, { renderTexture: it.rt, clear: true });
}

/* ------------------------------ Хуки ------------------------------ */

export function registerScuppers() {
  Hooks.on("canvasReady", () => {
    const fresh = canvas.scene?.id !== lastScene;
    lastScene = canvas.scene?.id ?? null;
    rebuildScuppers(fresh);
  });
  Hooks.on("canvasTearDown", () => { gen++; clearScuppers(); });
  Hooks.on("updateScene", (scene, changes) => {
    if (scene !== canvas.scene || !("weather" in changes)) return;
    // Дождь пошёл — собрать (вода наберётся); кончился — тик сам даст ей стечь.
    if (rainLevel() && !roofs.size) rebuildScuppers();
  });
  const again = foundry.utils.debounce(() => rebuildScuppers(), 100);
  for (const hook of ["createTile", "updateTile", "deleteTile"]) {
    Hooks.on(hook, (doc) => { if (doc.parent === canvas.scene && (scuppersOf(doc) || roofs.has(doc.id))) again(); });
  }
  // Новый тайл получает картинку позже createTile — ловим отрисовку.
  Hooks.on("drawTile", (tile) => {
    if (tile.document?.parent === canvas.scene && scuppersOf(tile.document) && !roofs.has(tile.id) && rainLevel()) again();
  });
  Hooks.on("clientSettingChanged", (key) => {
    if (key === `${MODULE_ID}.enabled` || key === `${MODULE_ID}.groundWeather`) rebuildScuppers(true);
  });
}
