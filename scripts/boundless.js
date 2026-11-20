// Boundless (SweetyHake): огромный мир Картографа одной сценой, кусками. Тайлы и крыши там —
// меши самого Boundless, а не тайлы Foundry, и хуки тайлов их не видят. Каждый кадр
// смотрим, что Boundless держит на холсте: кроны (`flags.burn-living-map.wind` у тайла)
// качаем тем же ветром, над трубами домов (`chimneys` у дома) пускаем тот же дым. Вода,
// болото и звуки мест — обычные области сцены, их оживляет main.js как всегда.

import { wind, swayCrown, phaseOf } from "./wind.js";
import { addSmoke, dropSmoke, smokeKeys } from "./chimneys.js";

const MODULE_ID = "burn-living-map";
/** Ключи дыма над домами Boundless — чтобы не спутать с дымом тайлов. */
const PREFIX = "boundless:";

/** Меш кроны → его место без ветра. Boundless берёт меши из пула: место — по ключу тайла. */
const rest = new WeakMap();
let ticking = false;

/** Boundless ведёт эту сцену. */
function boundless() {
  const B = globalThis.Boundless;
  return B?.active && canvas.scene?.flags?.boundless?.enabled ? B : null;
}

function tick() {
  const B = boundless();
  if (!B || !canvas.ready) return stop();
  const on = game.settings.get(MODULE_ID, "enabled");
  const { force, dx, dy } = wind();
  const t = performance.now() / 1000;
  const grid = canvas.grid.size;
  // Порывы — те же, что у тайлов (wind.js).
  const gust = 0.65 + 0.35 * Math.sin(t * 0.21) * Math.sin(t * 0.13 + 1.3);
  for (const [key, vt] of B.activeVirtualTiles ?? []) {
    const f = vt.tSpec?.flags?.[MODULE_ID];
    const m = vt.mesh;
    if (!m || m.destroyed || !(Number(f?.wind) > 0) || f.rope || f.sock || f.swing) continue;
    let r = rest.get(m);
    if (!r || r.key !== key) {
      r = { key, x: m.position.x, y: m.position.y, rot: m.angle, phase: phaseOf(key) };
      rest.set(m, r);
    }
    const size = Math.max(Number(vt.tSpec.w) || 0, Number(vt.tSpec.h) || 0);
    swayCrown(m, r.x, r.y, r.rot, r.phase, size, Math.min(Number(f.wind), 2), t, on ? force : 0, dx, dy, gust, grid);
  }
  // Дым — над домами, что Boundless сейчас держит (крыша рядом с окном).
  const want = new Set();
  if (on) {
    for (const [key, ov] of B.activeOverlays ?? []) {
      const list = ov.ovSpec?.flags?.[MODULE_ID]?.chimneys;
      const mesh = ov.roofMesh;
      if (!Array.isArray(list) || !list.length || !mesh || mesh.destroyed) continue;
      const id = PREFIX + key;
      want.add(id);
      addSmoke(id, { id, mesh, visible: true, open: () => !!B._isRoofRevealed?.(mesh, canvas.masks?.occlusion?.occludedSurfaces) }, list);
    }
  }
  for (const id of smokeKeys()) {
    if (id.startsWith(PREFIX) && !want.has(id)) dropSmoke(id);
  }
}

/** Boundless включается не сразу после готовности холста: ждём его, раз в секунду, до 30 с. */
function start(tries = 30) {
  if (ticking) return;
  if (!boundless()) {
    if (tries > 0 && canvas.scene?.flags?.boundless?.enabled) setTimeout(() => start(tries - 1), 1000);
    return;
  }
  canvas.app.ticker.add(tick);
  ticking = true;
}

function stop() {
  if (ticking) canvas.app?.ticker.remove(tick);
  ticking = false;
  for (const id of smokeKeys()) {
    if (id.startsWith(PREFIX)) dropSmoke(id);
  }
}

export function registerBoundless() {
  // Boundless поднимает свой мир после готовности холста.
  Hooks.on("canvasReady", () => setTimeout(start, 500));
  Hooks.on("canvasTearDown", () => stop());
}
