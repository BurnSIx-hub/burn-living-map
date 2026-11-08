// Ветер: тайлы с пометкой `flags.burn-living-map.wind` (кроны деревьев из Картографа)
// покачиваются. Двигается сам меш тайла — сдвиг по ветру, лёгкий доворот и перекос,
// поэтому затухание над токеном, свет и уровни Foundry работают как обычно.
// Документ тайла не меняется: качает каждый игрок у себя.
//
// Foundry сам ставит мешу позицию и поворот (только при правке тайла) и не трогает
// перекос — каждый кадр берём их из документа и добавляем качание поверх.
//
// Число в пометке — сила: 1 — крона, меньше — куст (лишь чуть колышется).
// Пометка `rope` — верёвка с бельём: концы привязаны к стенам и стоят, а
// середина провисает и колышется. Меш тогда не двигается: картинку гнёт фильтр.

const MODULE_ID = "burn-living-map";

/** @type {Map<string, {tile: Tile, phase: number, size: number, amp: number}>} */
const trees = new Map();
/** @type {Map<string, {tile: Tile, phase: number, filter: PIXI.Filter}>} */
const ropes = new Map();

// Изгиб верёвки: точка экрана берёт цвет у соседней поперёк верёвки. Сдвиг —
// по синусу вдоль неё: у концов ноль, в середине наибольший; по нему бежит
// волна, бельё колышется. Координаты — экранные, как у фильтров PIXI.
const ROPE_FRAG = `
varying vec2 vTextureCoord;
uniform sampler2D uSampler;
uniform vec4 inputSize;
uniform vec4 outputFrame;
uniform vec4 inputClamp;
uniform vec2 uA, uB;
uniform float uAmp, uTime, uPhase, uBias;
void main() {
  vec2 pos = vTextureCoord * inputSize.xy + outputFrame.xy;
  vec2 ab = uB - uA;
  float len2 = max(dot(ab, ab), 1.0);
  float u = clamp(dot(pos - uA, ab) / len2, 0.0, 1.0);
  vec2 n = vec2(-ab.y, ab.x) / sqrt(len2);
  float bow = sin(3.14159265 * u);
  float w = uBias + 0.7 * sin(uTime * 1.4 + uPhase - u * 2.2) + 0.3 * sin(uTime * 3.3 + u * 8.0 + uPhase * 2.0);
  vec2 src = pos - n * uAmp * bow * w;
  vec2 tc = (src - outputFrame.xy) * inputSize.zw;
  float inside = step(inputClamp.x, tc.x) * step(tc.x, inputClamp.z) * step(inputClamp.y, tc.y) * step(tc.y, inputClamp.w);
  gl_FragColor = texture2D(uSampler, tc) * inside;
}`;
let ticking = false;

/** Насколько сильно и куда дует: настройки мира, плюс общая сила эффектов игрока. */
export function wind() {
  const on = game.settings.get(MODULE_ID, "enabled");
  const force = on ? game.settings.get(MODULE_ID, "treeWind") * game.settings.get(MODULE_ID, "strength") : 0;
  const angle = (game.settings.get(MODULE_ID, "treeWindDirection") * Math.PI) / 180;
  return { force, dx: Math.cos(angle), dy: Math.sin(angle) };
}

/** Своё зерно у каждого дерева, чтобы лес не качался строем. */
function phaseOf(id) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return (h % 10000) / 10000 * Math.PI * 2;
}

function windy(doc) {
  return Number(doc.flags?.[MODULE_ID]?.wind ?? 0) > 0;
}

function roped(doc) {
  return !!doc.flags?.[MODULE_ID]?.rope;
}

export function rebuildWind() {
  calm();
  trees.clear();
  ropes.clear();
  if (!canvas.ready || !canvas.tiles) return;
  for (const tile of canvas.tiles.placeables) {
    if (!windy(tile.document)) continue;
    const { width, height } = tile.document;
    if (roped(tile.document)) {
      ropes.set(tile.id, { tile, phase: phaseOf(tile.id), filter: null });
      continue;
    }
    const amp = Math.min(Number(tile.document.flags[MODULE_ID].wind), 2);
    trees.set(tile.id, { tile, phase: phaseOf(tile.id), size: Math.max(width, height), amp });
  }
  if ((trees.size || ropes.size) && !ticking) {
    canvas.app.ticker.add(sway);
    ticking = true;
  }
}

/** Вернуть мешам их место из документа: ветер стих или модуль выключили. */
export function calm() {
  for (const { tile } of trees.values()) rest(tile);
  for (const r of ropes.values()) untie(r);
}

function untie(r) {
  const mesh = r.tile.mesh;
  if (r.filter && mesh && !mesh.destroyed) mesh.filters = (mesh.filters ?? []).filter((f) => f !== r.filter);
  r.filter = null;
}

/** Концы верёвки на экране: вдоль длинной стороны тайла, через середину. */
function ropeEnds(tile) {
  const s = tile.document.shape ?? tile.document;
  const { width, height } = tile.document;
  const rad = ((s.rotation ?? tile.document.rotation) * Math.PI) / 180;
  const half = Math.max(width, height) / 2;
  const along = width >= height ? [Math.cos(rad), Math.sin(rad)] : [-Math.sin(rad), Math.cos(rad)];
  const m = tile.mesh.parent.worldTransform;
  const a = m.apply({ x: s.x - along[0] * half, y: s.y - along[1] * half });
  const b = m.apply({ x: s.x + along[0] * half, y: s.y + along[1] * half });
  return { a, b, along };
}

function swayRope(r, t, force, dx, dy, gust, grid) {
  const mesh = r.tile.mesh;
  if (!mesh || mesh.destroyed) return;
  if (!force) return untie(r);
  if (!r.filter) {
    r.filter = new PIXI.Filter(undefined, ROPE_FRAG, { uA: new Float32Array(2), uB: new Float32Array(2), uAmp: 0, uTime: 0, uPhase: r.phase, uBias: 0 });
    r.filter.resolution = canvas.app.renderer.resolution;
    mesh.filters = [...(mesh.filters ?? []), r.filter];
  }
  const { a, b, along } = ropeEnds(r.tile);
  const zoom = mesh.parent.worldTransform.a;
  // Ветер поперёк верёвки выгибает её в свою сторону; вдоль — лишь колышет.
  const across = dx * -along[1] + dy * along[0];
  const amp = grid * 0.09 * force * zoom * gust;
  const u = r.filter.uniforms;
  u.uA[0] = a.x; u.uA[1] = a.y; u.uB[0] = b.x; u.uB[1] = b.y;
  u.uAmp = amp;
  u.uTime = t;
  u.uBias = across * 0.5;
  r.filter.padding = Math.ceil(amp * 1.6) + 2;
}

function rest(tile) {
  const mesh = tile.mesh;
  if (!mesh || mesh.destroyed) return;
  const s = tile.document.shape ?? tile.document;
  mesh.position.set(s.x, s.y);
  mesh.angle = s.rotation ?? tile.document.rotation;
  mesh.skew.set(0, 0);
}

function sway() {
  if ((!trees.size && !ropes.size) || !canvas.ready) {
    canvas.app?.ticker.remove(sway);
    ticking = false;
    return;
  }
  const { force, dx, dy } = wind();
  const t = performance.now() / 1000;
  const grid = canvas.grid.size;
  // Порывы: общий для всего леса медленный «вдох», чтобы ветер шёл волной.
  const gust = 0.65 + 0.35 * Math.sin(t * 0.21) * Math.sin(t * 0.13 + 1.3);
  for (const r of ropes.values()) swayRope(r, t, force, dx, dy, gust, grid);
  for (const { tile, phase, size, amp } of trees.values()) {
    const mesh = tile.mesh;
    if (!mesh || mesh.destroyed) continue;
    const s = tile.document.shape ?? tile.document;
    const rot = s.rotation ?? tile.document.rotation;
    if (!force) {
      mesh.position.set(s.x, s.y);
      mesh.angle = rot;
      mesh.skew.set(0, 0);
      continue;
    }
    // Большое дерево качается медленнее и меньше, мелкое — живее.
    const big = Math.sqrt(size / (grid * 4));
    const k = (force * amp) / Math.max(big, 0.6);
    // Порыв пробегает по лесу: дальние деревья ловят его позже.
    const lag = (s.x * dx + s.y * dy) / (grid * 12);
    const w = Math.sin(t * 1.15 / big - lag + phase) + 0.35 * Math.sin(t * 2.9 - lag * 1.7 + phase * 1.9);
    const reach = grid * 0.06 * k * gust;
    mesh.position.set(s.x + dx * w * reach, s.y + dy * w * reach);
    mesh.angle = rot + w * 0.9 * k * gust;
    // Листва: мелкая дрожь перекосом, быстрее основного качания.
    const flutter = Math.sin(t * 5.3 + phase * 3.1) * 0.5 + Math.sin(t * 7.7 + phase) * 0.5;
    mesh.skew.set(0.012 * k * (w * 0.6 + flutter * 0.4) * dy, 0.012 * k * (w * 0.6 + flutter * 0.4) * dx);
  }
}

export function registerWind() {
  game.settings.register(MODULE_ID, "treeWind", {
    name: "BLM.Setting.treeWind", hint: "BLM.Setting.treeWindHint",
    scope: "world", config: true, type: Number, default: 1,
    range: { min: 0, max: 2.5, step: 0.1 }
  });
  game.settings.register(MODULE_ID, "treeWindDirection", {
    name: "BLM.Setting.treeWindDirection", hint: "BLM.Setting.treeWindDirectionHint",
    scope: "world", config: true, type: Number, default: 30,
    range: { min: 0, max: 359, step: 1 }
  });
  Hooks.on("canvasReady", () => rebuildWind());
  Hooks.on("canvasTearDown", () => { trees.clear(); ropes.clear(); });
  for (const hook of ["createTile", "updateTile", "deleteTile"]) {
    Hooks.on(hook, (doc) => {
      if (doc.parent === canvas.scene) setTimeout(() => rebuildWind(), 0);
    });
  }
}
