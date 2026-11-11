// Разломы — аномалии в полу. Сам разлом — эффект области «rift» (шейдер RIFT
// в shaders.js, рисует main.js). Здесь то, что делает его аномалией:
//
// - разлом открывается и закрывается: щель растёт от середины к концам
//   (uOpen 0..1). Открытие видят все, у кого сцена на экране: хук createRegion;
//   закрытие — пометка `closing`, через OPEN_TIME Мастер удаляет область;
// - ось и размеры щели берутся из формы области (главная ось её точек), так что
//   разлом ложится вдоль любой нарисованной области; у круга — направление по id;
// - Мастер ставит разлом протяжкой мыши (`placeRift`) или пускает «шторм
//   аномалий» (`startStorm`): разломы сами возникают в выбранном месте и гаснут;
// - у разлома может быть свет Foundry (виден ночью, освещает токены) и срок
//   жизни (`expires`). Сроки и недозакрытые разломы подхватываются после
//   перезагрузки у главного Мастера.
//
// Из макроса: `game.modules.get("burn-living-map").api.rift.place({ color: 0 })`.

const MODULE_ID = "burn-living-map";
export const RIFT = "rift";
/** Сколько секунд разлом открывается и закрывается. */
export const OPEN_TIME = 2.2;
/** Цвет света и рамки области — как `riftColor`: фиолетовый, бирюзовый, золотой, алый. */
const COLORS = ["#9a5cff", "#4cd8ff", "#ffc452", "#ff4760"];

const loc = (k) => game.i18n.localize(`BLM.Rift.${k}`);
const clock = () => performance.now() / 1000;
const isRift = (r) => r.flags?.[MODULE_ID]?.effect === RIFT;
const own = (r) => r.flags?.[MODULE_ID] ?? {};

/* ------------------------------ Открытие и закрытие ------------------------------ */

/** Разломы, что открываются или закрываются у этого игрока: id → { from, opening }. */
const motion = new Map();

// Модуль подключается раньше main.js, поэтому эти хуки срабатывают до пересборки мешей.
Hooks.on("createRegion", (region) => {
  if (isRift(region)) motion.set(region.id, { from: clock(), opening: true });
});
Hooks.on("updateRegion", (region, changes) => {
  if (changes.flags?.[MODULE_ID]?.closing === true) motion.set(region.id, { from: clock(), opening: false });
});
Hooks.on("deleteRegion", (region) => motion.delete(region.id));

/** Насколько разлом открыт у этого игрока: 0..1. */
export function openness(region) {
  const mo = motion.get(region.id);
  if (!mo) return own(region).closing ? 0 : 1;
  const k = Math.min(1, Math.max(0, (clock() - mo.from) / OPEN_TIME));
  return mo.opening ? k : 1 - k;
}

/** Строка → число 0..1 (FNV-1a): у всех игроков одно и то же. */
function seedOf(text) {
  let h = 2166136261;
  for (const ch of String(text)) h = Math.imul(h ^ ch.codePointAt(0), 16777619) >>> 0;
  return h / 4294967296;
}

/** Формы шейдера: ось щели — главная ось точек области, полуоси — в клетках. */
export function riftUniforms(region, grid) {
  const v = region.triangulation?.vertices ?? [];
  const c = region.bounds.center;
  let sxx = 0, syy = 0, sxy = 0;
  for (let i = 0; i < v.length; i += 2) {
    const dx = v[i] - c.x, dy = v[i + 1] - c.y;
    sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
  }
  const seed = seedOf(region.id);
  // Почти круг — своя ось не угадывается, направление берём из id.
  const elongated = Math.hypot(sxx - syy, 2 * sxy) > 0.08 * (sxx + syy);
  const angle = elongated ? 0.5 * Math.atan2(2 * sxy, sxx - syy) : seed * Math.PI;
  const ax = Math.cos(angle), ay = Math.sin(angle);
  let half = 0, side = 0;
  for (let i = 0; i < v.length; i += 2) {
    const dx = v[i] - c.x, dy = v[i + 1] - c.y;
    half = Math.max(half, Math.abs(dx * ax + dy * ay));
    side = Math.max(side, Math.abs(dy * ax - dx * ay));
  }
  return {
    uAxis: new Float32Array([ax, ay]),
    uHalf: new Float32Array([Math.max(half / grid, 0.5), Math.max(side / grid, 0.3)]),
    uSeed: seed * 64,
    uOpen: openness(region)
  };
}

/* ------------------------------ Мастер: открыть, закрыть ------------------------------ */

function gmOnly() {
  if (game.user.isGM) return true;
  ui.notifications.warn(loc("GMOnly"));
  return false;
}

/** Таймеры сроков жизни: uuid области → setTimeout. */
const timers = new Map();

function schedule(region, ms) {
  clearTimeout(timers.get(region.uuid));
  timers.set(region.uuid, setTimeout(() => {
    timers.delete(region.uuid);
    closeRift(region);
  }, Math.max(0, ms)));
}

/**
 * Открыть разлом.
 * @param {object} o
 * @param {number} o.x, o.y   середина, пиксели сцены
 * @param {number} [o.length] длина, клеток (по умолчанию 3)
 * @param {number} [o.width]  ширина области, клеток (по умолчанию 0,45 длины, не меньше 0,8)
 * @param {number} [o.angle]  направление, градусы (по умолчанию случайное)
 * @param {number} [o.color]  0 фиолетовый, 1 бирюзовый, 2 золотой, 3 алый
 * @param {number} [o.life]   через сколько секунд закрыться сам; 0 — пока не закроют
 * @param {boolean} [o.light] свет Foundry вокруг (виден в темноте, освещает токены)
 */
export async function openRift({ x, y, length = 3, width = null, angle = null, color = 0, life = 0, light = true, scene = canvas.scene, storm = false } = {}) {
  if (!gmOnly() || !scene || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  const grid = scene.grid.size;
  length = Math.max(1, Number(length) || 3);
  width = Math.max(0.8, Number(width) || length * 0.45);
  angle = Number.isFinite(Number(angle)) && angle !== null ? Number(angle) : Math.random() * 180;
  color = Math.min(3, Math.max(0, Math.round(Number(color) || 0)));
  const f = { effect: RIFT, riftColor: color, ...(storm ? { storm: true } : {}) };
  if (life > 0) f.expires = Date.now() + life * 1000;
  const [region] = await scene.createEmbeddedDocuments("Region", [{
    name: loc("Name"),
    color: COLORS[color],
    shapes: [{ type: "ellipse", x, y, radiusX: (length * grid) / 2, radiusY: (width * grid) / 2, rotation: angle }],
    flags: { [MODULE_ID]: f }
  }]);
  if (!region) return null;
  if (life > 0) schedule(region, life * 1000);
  // Свет загорается, когда щель уже раскрылась наполовину.
  if (light) {
    setTimeout(async () => {
      if (!scene.regions.has(region.id) || own(region).closing) return;
      const d = scene.grid.distance;
      const [l] = await scene.createEmbeddedDocuments("AmbientLight", [{
        x, y,
        config: {
          dim: (length / 2 + 1.5) * d, bright: Math.max(0.5, width / 2) * d,
          color: COLORS[color], alpha: 0.3, luminosity: 0.45, attenuation: 0.8,
          animation: { type: "energy", speed: 3, intensity: 3 }
        },
        flags: { [MODULE_ID]: { rift: region.id } }
      }]);
      if (l && scene.regions.has(region.id)) await region.setFlag(MODULE_ID, "riftLight", l.id);
      else l?.delete();
    }, (OPEN_TIME * 1000) / 2);
  }
  return region;
}

/** Закрыть разлом: щель сходится у всех, потом область и свет удаляются. */
export async function closeRift(region) {
  if (!gmOnly() || !region?.parent || !isRift(region) || own(region).closing) return;
  const scene = region.parent;
  clearTimeout(timers.get(region.uuid));
  timers.delete(region.uuid);
  await region.setFlag(MODULE_ID, "closing", true);
  setTimeout(() => dropLight(scene, region), 800);
  setTimeout(() => { if (scene.regions.has(region.id)) region.delete(); }, OPEN_TIME * 1000 + 300);
}

function dropLight(scene, region) {
  const ids = scene.lights.filter((l) => l.flags?.[MODULE_ID]?.rift === region.id).map((l) => l.id);
  const id = own(region).riftLight;
  if (id && scene.lights.has(id) && !ids.includes(id)) ids.push(id);
  if (ids.length) scene.deleteEmbeddedDocuments("AmbientLight", ids);
}

/** Закрыть все разломы сцены (`storm` — только те, что открыл шторм). */
export function closeRifts({ scene = canvas.scene, storm = false } = {}) {
  if (!gmOnly() || !scene) return 0;
  const list = scene.regions.filter((r) => isRift(r) && !own(r).closing && (!storm || own(r).storm));
  for (const r of list) closeRift(r);
  return list.length;
}

// После перезагрузки: недозакрытые убрать, сроки жизни завести заново. Только главный Мастер.
Hooks.on("canvasReady", () => {
  if (!game.user.isGM || game.users.activeGM?.isSelf === false) return;
  const scene = canvas.scene;
  for (const r of scene?.regions ?? []) {
    if (!isRift(r)) continue;
    const f = own(r);
    if (f.closing) { dropLight(scene, r); r.delete(); }
    else if (f.expires && !timers.has(r.uuid)) schedule(r, f.expires - Date.now());
  }
});

/* ------------------------------ Мастер: поставить мышью ------------------------------ */

/**
 * Поставить разлом мышью: протянуть по полу — разлом ляжет вдоль, длиной с протяжку;
 * щелчок — разлом длины `length` случайного направления. Esc или правая кнопка — отмена.
 * Остальные настройки — как у `openRift`; `quiet` — без подсказки.
 */
export function placeRift(opts = {}) {
  if (!gmOnly() || !canvas.ready) return Promise.resolve(null);
  return new Promise((resolve) => {
    const view = canvas.app.view;
    const line = canvas.controls.addChild(new PIXI.Graphics());
    const tint = Number(`0x${COLORS[opts.color ?? 0].slice(1)}`);
    let start = null;
    const at = (e) => canvas.canvasCoordinatesFromClient({ x: e.clientX, y: e.clientY });
    const done = (value) => {
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("keydown", key, true);
      if (!line.destroyed) line.destroy();
      view.style.cursor = "";
      resolve(value);
    };
    const down = (e) => {
      if (e.target !== view) return;
      e.stopImmediatePropagation();
      e.preventDefault();
      if (e.button !== 0) return done(null);
      start = at(e);
    };
    const move = (e) => {
      // Над холстом движение не отдаём Foundry: иначе PIXI сбросит курсор-прицел.
      if (e.target === view) {
        e.stopImmediatePropagation();
        view.style.cursor = "crosshair";
      }
      if (!start) return;
      const p = at(e);
      const w = 3 / canvas.stage.scale.x;
      line.clear().lineStyle(w, tint, 0.9).moveTo(start.x, start.y).lineTo(p.x, p.y);
    };
    const up = async (e) => {
      if (!start) return;
      e.stopImmediatePropagation();
      e.preventDefault();
      const end = at(e);
      const dx = end.x - start.x, dy = end.y - start.y;
      const len = Math.hypot(dx, dy) / canvas.grid.size;
      const where = len >= 1
        ? { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2, length: len, angle: Math.toDegrees(Math.atan2(dy, dx)) }
        : { x: start.x, y: start.y };
      done(await openRift({ ...opts, ...where }));
    };
    const key = (e) => {
      if (e.key !== "Escape") return;
      e.stopImmediatePropagation();
      done(null);
    };
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("keydown", key, true);
    view.style.cursor = "crosshair";
    if (!opts.quiet) ui.notifications.info(loc("PlaceHint"));
  });
}

/* ------------------------------ Шторм аномалий ------------------------------ */

let storm = null;
const rand = (a, b) => a + Math.random() * (b - a);

/** Откуда брать места: видимая часть сцены, вокруг токенов или внутри области. */
function picker(scene, area, radius) {
  const grid = scene.grid.size;
  const rect = scene.dimensions.sceneRect;
  if (area === "region") {
    const reg = canvas.regions?.controlled?.[0]?.document;
    if (!reg) return null;
    const b = reg.bounds;
    return () => {
      for (let i = 0; i < 20; i++) {
        const p = { x: rand(b.left, b.right), y: rand(b.top, b.bottom) };
        if (reg.polygonTree?.testPoint?.(p) ?? true) return p;
      }
      return null;
    };
  }
  if (area === "tokens") {
    const chosen = canvas.tokens?.controlled?.map((t) => t.document) ?? [];
    const ids = (chosen.length ? chosen : scene.tokens.filter((t) => t.hasPlayerOwner)).map((t) => t.id);
    if (!ids.length) return null;
    return () => {
      const t = scene.tokens.get(ids[Math.floor(Math.random() * ids.length)]);
      if (!t) return null;
      const r = rand(1.5, Math.max(2, radius)) * grid, a = rand(0, Math.PI * 2);
      const p = { x: t.x + (t.width * grid) / 2 + Math.cos(a) * r, y: t.y + (t.height * grid) / 2 + Math.sin(a) * r };
      return rect.contains(p.x, p.y) ? p : null;
    };
  }
  // Видимая часть сцены у Мастера в момент запуска, с отступом в клетку.
  const { width, height } = canvas.app.renderer.screen;
  const s = canvas.stage.scale.x;
  const v = new PIXI.Rectangle(canvas.stage.pivot.x - width / 2 / s, canvas.stage.pivot.y - height / 2 / s, width / s, height / s);
  const r = v.intersection(rect).pad(-grid);
  if (r.width <= 0 || r.height <= 0) return null;
  return () => ({ x: rand(r.left, r.right), y: rand(r.top, r.bottom) });
}

/**
 * Шторм аномалий: раз в `every` секунд, пока живых разломов шторма меньше `count`,
 * в выбранном месте открывается новый и живёт около `life` секунд.
 * `area`: "view" — видимая часть сцены, "tokens" — вокруг выделенных токенов
 * (иначе — токенов игроков) в радиусе `radius` клеток, "region" — внутри выделенной области.
 */
export function startStorm({ count = 3, every = 5, life = 12, length = [1.5, 3.5], color = 0, light = true, area = "view", radius = 6 } = {}) {
  if (!gmOnly() || !canvas.ready) return false;
  stopStorm({ close: false, quiet: true });
  const scene = canvas.scene;
  const pick = picker(scene, area, radius);
  if (!pick) { ui.notifications.warn(loc("NoArea")); return false; }
  const grid = scene.grid.size;
  const [lo, hi] = Array.isArray(length) ? length : [length, length];
  let busy = false;
  const spawn = async () => {
    if (busy || !game.scenes.has(scene.id)) return;
    const live = scene.regions.filter((r) => isRift(r) && own(r).storm && !own(r).closing);
    if (live.length >= count) return;
    busy = true;
    try {
      for (let i = 0; i < 12; i++) {
        const p = pick();
        if (!p || live.some((r) => Math.hypot(r.bounds.center.x - p.x, r.bounds.center.y - p.y) < grid * 2.5)) continue;
        await openRift({ ...p, length: rand(lo, hi), color, light, life: life * rand(0.7, 1.3), scene, storm: true });
        break;
      }
    } finally { busy = false; }
  };
  storm = { scene, timer: setInterval(spawn, Math.max(1, every) * 1000) };
  spawn();
  ui.notifications.info(loc("StormOn"));
  return true;
}

/** Остановить шторм; `close` — заодно закрыть его разломы. */
export function stopStorm({ close = true, quiet = false } = {}) {
  if (!storm) return false;
  clearInterval(storm.timer);
  const scene = storm.scene;
  storm = null;
  if (close) closeRifts({ scene, storm: true });
  if (!quiet) ui.notifications.info(loc("StormOff"));
  return true;
}

export const stormRunning = () => !!storm;

export const riftApi = { open: openRift, close: closeRift, closeAll: closeRifts, place: placeRift, storm: startStorm, calm: stopStorm, stormRunning };
