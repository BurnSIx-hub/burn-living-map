import { VERT, FRAG, EFFECTS, PARAMS, SPEED } from "./shaders.js";
import { registerWind, rebuildWind } from "./wind.js";
import { registerParticles, rebuildParticles } from "./particles.js";
import { registerAmbience, rebuildAmbience, soundField, sounding } from "./ambience.js";
import { rebuildClouds } from "./clouds.js";
import { registerWeather, rebuildWeather, driftSheet } from "./weather.js";
import { registerBurrows, drawBurrows, clearBurrows } from "./burrow.js";
import { registerSteps, surfaceUnder } from "./steps.js";
import { registerBlaze, rebuildBlaze, heatOf } from "./blaze.js";
import { registerRoofs } from "./roofs.js";
import { registerMachines, rebuildMachines } from "./machines.js";
import { registerHover, rebuildHover } from "./hover.js";
import { registerAfloat, rebuildAfloat } from "./afloat.js";
import { registerShadows, rebuildShadows } from "./shadows.js";
import { registerMotion, rebuildMotion, motionStatus } from "./motion.js";
import { registerSpeakers, rebuildSpeakers, speakerSource } from "./speaker.js";
import { registerScuppers, rebuildScuppers } from "./scupper.js";
import { registerChimneys, rebuildChimneys } from "./chimneys.js";
import { registerBoundless } from "./boundless.js";
import { RIFT, riftUniforms, openness, riftApi } from "./rift.js";
import { takeSettings, openPanel, WildCanvasPanel } from "./panel.js";

// 🔥 Wild Canvas. Область сцены с пометкой `flags.burn-living-map.effect`
// оживает: поверх картинки ложится меш с шейдером эффекта. Меш живёт в
// основной группе холста сразу над фоном своего уровня (`sortLayer` 1 —
// выше фона, ниже тайлов, токенов и рисунков), поэтому его перекрывает всё,
// что стоит на полу, а свет и зрение Foundry работают как обычно.
//
// Область с эффектом `cut` ничего не рисует: она вырезает эффекты своего уровня,
// не трогая их берег, — так мост остаётся сухим, а вода течёт под ним.

const MODULE_ID = "burn-living-map";
const loc = (k) => game.i18n.localize(`BLM.${k}`);

/** Маска области — в восьмую долю масштаба: тени и пене подробности ни к чему. */
const MASK_SCALE = 0.125;
/** Вырез чёткий, поэтому подробнее маски. */
const CUT_SCALE = 0.25;
const CUT = "cut";
/** Дым тянется за область на столько клеток и идёт поверх токенов. */
const SMOKE_REACH = 9;
const ABOVE_TOKENS = 800;
/** Сразу над тайлами (500), ниже токенов (700): фонтан нарисован тайлом. */
const FOUNTAIN_LAYER = 510;

/** Все настраиваемые величины, без повторов. */
const LOOKS = [SPEED, ...Object.values(PARAMS).flat()];

/** @type {Map<string, {region: Region, mesh: PIXI.Mesh, mask: PIXI.RenderTexture, cut: PIXI.RenderTexture, clock: number}>} */
const zones = new Map();
let ticking = false;
let lastTick = 0;

/** Значения ползунков до сохранения: `world` — окно настроек, `regions` — окна областей. */
const preview = { world: {}, regions: {} };

/* ------------------------------ Настройки ------------------------------ */

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "enabled", {
    name: "BLM.Setting.Enabled", hint: "BLM.Setting.EnabledHint",
    scope: "client", config: true, type: Boolean, default: true,
    onChange: () => { rebuild(); rebuildWind(); rebuildParticles(); rebuildAmbience(); rebuildClouds(); rebuildWeather(); drawBurrows(); rebuildBlaze(); rebuildMachines(); rebuildHover(); rebuildAfloat(); rebuildShadows(); rebuildMotion(); rebuildChimneys(); }
  });
  game.settings.register(MODULE_ID, "strength", {
    name: "BLM.Setting.Strength", hint: "BLM.Setting.StrengthHint",
    scope: "client", config: true, type: Number, default: 1,
    range: { min: 0.2, max: 1.5, step: 0.1 },
    onChange: () => settled("strength")
  });
  // Вид — для всех за столом; у области поверх него свой множитель.
  for (const { key, min = 0, max, step = 0.05, initial = 1, choices } of LOOKS) {
    game.settings.register(MODULE_ID, key, {
      name: `BLM.Setting.${key}`,
      scope: "world", config: true, type: Number, default: initial,
      ...(choices ? { choices: Object.fromEntries(choices.map((c, i) => [i, `BLM.Choice.${key}.${c}`])) } : { range: { min, max, step } }),
      onChange: () => settled(key)
    });
  }
  // Ветер в кронах — тайлы с пометкой `wind` (см. wind.js).
  registerWind();
  // Крыши видны с улицы, значки дверей под крышей спрятаны (см. roofs.js).
  registerRoofs();
  // Листопад, снег и светлячки от крон — пометка `particles` (см. particles.js).
  registerParticles();
  // Гул лавы над областями `lava` и в двух клетках вокруг (см. ambience.js).
  registerAmbience();
  // Сугробы при снеге и мокрый пол при дожде (см. weather.js).
  registerWeather();
  // Норы там, где токен зарылся (см. burrow.js).
  registerBurrows();
  // Шаги по поверхностям: разметка, области, сетка Картографа (см. steps.js).
  registerSteps();
  // Пожар на тайле: пламя по его картинке, дым, свет и треск (см. blaze.js).
  registerBlaze();
  // Техника: вентиляторы крутятся, огоньки серверов мигают (см. machines.js).
  registerMachines();
  // Парение: дирижабль плывёт, покачивается, тень ползёт по земле (см. hover.js).
  registerHover();
  // На воде: лист бумаги, поплавок едва покачиваются (см. afloat.js).
  registerAfloat();
  // Тени предметов от солнца сцены: Картограф выгружает предметы без тени (см. shadows.js).
  registerShadows();
  registerMotion();
  // Колонки: эквалайзер под музыку, кольца, кнопка на панели тайла (см. speaker.js).
  registerSpeakers();
  // Сливы крыш под дождём: вода по лотку, струя в воронку (см. scupper.js).
  registerScuppers();
  // Дым из труб на крышах: клубы по ветру, гаснут вместе с крышей (см. chimneys.js).
  registerChimneys();
  // Мир Boundless: его кроны и дома — свои меши, не тайлы (см. boundless.js).
  registerBoundless();
  for (const hook of ["createTile", "updateTile", "deleteTile"]) {
    Hooks.on(hook, (doc) => { if (doc.parent === canvas.scene && (heatOf(doc) > 0 || hook !== "createTile")) setTimeout(() => rebuildAmbience(), 0); });
  }
  // Все настройки — в своём окне (см. panel.js). Его открывает плитка BurnHub,
  // а без BurnHub — кнопка в настройках игры.
  takeSettings();
  if (!game.modules.get("burnhub")?.active) {
    game.settings.registerMenu(MODULE_ID, "panel", {
      name: "BLM.Title", label: "BLM.Panel.Open", hint: "BLM.Panel.Hint",
      icon: "fa-solid fa-water", type: WildCanvasPanel, restricted: false
    });
  }
});

Hooks.once("ready", () => {
  game.modules.get(MODULE_ID).api = { rebuildMachines, rebuildHover, rebuildAfloat, rebuildMotion, motionStatus, rebuildScuppers, rebuildChimneys, rebuildSpeakers, speakerSource, rebuild, rebuildWind, rebuildParticles, rebuildWeather, rebuildBlaze, driftSheet, clearBurrows, surfaceUnder, status, sounding, EFFECTS, rift: riftApi };
  Hooks.callAll("hubRegisterTile", {
    moduleId: MODULE_ID,
    title: loc("Title"),
    icon: "fa-solid fa-water",
    onClick: () => openPanel()
  });
});

/* ------------------------------ Холст ------------------------------ */

Hooks.on("canvasReady", () => rebuild());
Hooks.on("canvasTearDown", () => clear());
for (const hook of ["createRegion", "updateRegion", "deleteRegion"]) {
  Hooks.on(hook, (region, changes) => {
    if (region.parent !== canvas.scene) return;
    if (hook === "updateRegion" && onlyLooks(changes)) refreshLooks();
    else rebuild();
  });
}

/** Поменялись только ползунки: форма и эффект те же, пересобирать незачем. */
function onlyLooks(changes) {
  const own = changes.flags?.[MODULE_ID];
  const rest = Object.keys(changes).filter((k) => !["_id", "_stats", "flags"].includes(k));
  return !!own && !("effect" in own) && !rest.length && Object.keys(changes.flags).length === 1;
}

/** Что не собралось у этого игрока: эффект → журнал видеокарты. */
const broken = new Map();
const checked = new Set();
const failures = [];

/**
 * Собирается ли шейдер на этой видеокарте. PIXI собирает его только при первом кадре и
 * молча не рисует, поэтому проверяем сами и один раз говорим игроку.
 */
function compiles(effect) {
  if (checked.has(effect)) return !broken.has(effect);
  checked.add(effect);
  const gl = canvas.app.renderer.gl;
  const sh = gl.createShader(gl.FRAGMENT_SHADER);
  gl.shaderSource(sh, FRAG[effect]);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS) && !gl.isContextLost()) {
    broken.set(effect, gl.getShaderInfoLog(sh) ?? "");
    console.error(`${MODULE_ID} | shader "${effect}" failed to compile:`, broken.get(effect));
    ui.notifications.warn(game.i18n.format("BLM.Broken", { effect: loc(`Effect.${effect}`) }));
  }
  gl.deleteShader(sh);
  return !broken.has(effect);
}

/** Для игрока, у которого не видно: `game.modules.get("burn-living-map").api.status()` в консоли. */
function status() {
  const gl = canvas.app?.renderer?.gl;
  const high = gl?.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
  const report = {
    version: game.modules.get(MODULE_ID).version,
    enabled: game.settings.get(MODULE_ID, "enabled"),
    strength: game.settings.get(MODULE_ID, "strength"),
    regions: canvas.scene?.regions.filter((r) => effectOf(r)).length ?? 0,
    drawn: zones.size,
    hidden: [...zones.values()].filter((z) => !z.mesh.visible).length,
    webgl: gl ? gl.getParameter(gl.VERSION) : "none",
    highPrecision: !!high?.precision,
    performance: game.settings.get("core", "performanceMode"),
    broken: Object.fromEntries(broken),
    failures
  };
  console.log(`${MODULE_ID} | status`, report);
  return report;
}

/** Эффект области или `null`. */
function effectOf(region) {
  const e = region.flags?.[MODULE_ID]?.effect;
  return EFFECTS.includes(e) ? e : null;
}

function clear() {
  for (const { mesh, glow, mask, cut } of zones.values()) {
    if (glow && !glow.destroyed) glow.destroy();
    if (!mesh.destroyed) mesh.destroy();
    mask.destroy(true);
    cut.destroy(true);
  }
  zones.clear();
}

export function rebuild() {
  clear();
  if (!canvas.ready || !canvas.scene || !canvas.primary) return;
  if (!game.settings.get(MODULE_ID, "enabled")) return;
  const cuts = canvas.scene.regions.filter((r) => r.flags?.[MODULE_ID]?.effect === CUT);
  for (const region of canvas.scene.regions) {
    const effect = effectOf(region);
    if (!effect) continue;
    try {
      if (!compiles(effect)) continue;
      const zone = makeZone(region, effect, cuts);
      if (zone) zones.set(region.id, zone);
    } catch (err) {
      failures.push(`${region.name}: ${err.message ?? err}`);
      console.error(`${MODULE_ID} | region ${region.name}`, err);
    }
  }
  canvas.primary.sortDirty = true;
  if (zones.size && !ticking) {
    canvas.app.ticker.add(tick);
    ticking = true;
  }
}

/** Уровень области: первый из её уровней, иначе первый уровень сцены. */
function levelOf(region) {
  const ids = region.levels ? [...region.levels] : [];
  return (ids.length ? canvas.scene.levels.get(ids[0]) : null) ?? canvas.scene.firstLevel ?? null;
}

/** Настройка мира, умноженная на пометку области. Старая галочка рыбок — true или false. */
function look(region, key) {
  const own = preview.regions[region.id]?.[key] ?? region.flags?.[MODULE_ID]?.[key];
  const world = preview.world[key] ?? game.settings.get(MODULE_ID, key);
  if (LOOKS.find((l) => l.key === key)?.fixed) return own == null ? world : Number(own);
  return world * (own == null ? 1 : Number(own));
}

const uniformOf = (key) => `u${key[0].toUpperCase()}${key.slice(1)}`;

/** Форма шейдера для ползунков; скорость идёт в часы зоны, а не сюда. */
/** Сдвиг хеша рыбок из зерна сцены: флаг `seed` (Картограф пишет зерно карты),
 *  иначе id сцены. Строка → два числа до 64 (FNV-1a). */
function fishSeed() {
  const text = String(canvas.scene?.flags?.[MODULE_ID]?.seed || canvas.scene?.id || "");
  let h = 2166136261;
  for (const ch of text) h = Math.imul(h ^ ch.codePointAt(0), 16777619) >>> 0;
  return new Float32Array([(h & 0xffff) / 1024, (h >>> 16) / 1024]);
}

function looksOf(region) {
  const looks = Object.fromEntries(LOOKS.filter((l) => l !== SPEED).map(({ key }) => [uniformOf(key), look(region, key)]));
  looks.uStrength = preview.world.strength ?? game.settings.get(MODULE_ID, "strength");
  // Вид рыбы «без рыбы» (последний в списке) гасит рыб, сколько бы их ни было.
  if (looks.uFishKind === 3) looks.uFish = 0;
  if (effectOf(region) === "waterfall") Object.assign(looks, fallUniforms(region, looks.uFlow));
  return looks;
}

/**
 * Водопад: где вдоль течения кромка и низ области, в клетках. От них шейдер меряет, сколько
 * вода уже пролетела. Зависит от направления, поэтому считается вместе с ползунками.
 */
function fallUniforms(region, flow) {
  const grid = canvas.grid.size;
  const rad = (Number(flow) || 0) * Math.PI / 180, dx = Math.cos(rad), dy = Math.sin(rad);
  const v = region.triangulation?.vertices ?? [];
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < v.length; i += 2) {
    const a = (v[i] * dx + v[i + 1] * dy) / grid;
    if (a < lo) lo = a;
    if (a > hi) hi = a;
  }
  return { uFall: new Float32Array(Number.isFinite(lo) ? [lo, hi] : [0, 1]) };
}

/** Переложить ползунки в работающие шейдеры: без пересборки, можно хоть каждый кадр. */
function refreshLooks() {
  for (const { region, mesh, glow } of zones.values()) {
    if (mesh.destroyed) continue;
    const looks = looksOf(region);
    Object.assign(mesh.shader.uniforms, looks);
    if (glow && !glow.destroyed) Object.assign(glow.shader.uniforms, looks);
  }
}

/** Настройка сохранена: её значение теперь настоящее. */
function settled(key) {
  delete preview.world[key];
  refreshLooks();
}

function makeZone(region, effect, cuts) {
  const tri = region.triangulation;
  if (!tri?.indices?.length) return null;
  const grid = canvas.grid.size;
  // Поля вокруг: размытый край выходит за контур на полклетки.
  const pad = grid * (effect === "fire" ? SMOKE_REACH : effect === "waterfall" ? 2.5 : effect === "fog" ? 2.2 : effect === RIFT ? 1 : 0.5);
  const b = region.bounds.clone().pad(pad);
  // Туман редеет к краю на клетку: маска размыта шире, рваный край даёт шейдер.
  const mask = drawMask(tri, b, grid, effect === "fog" ? 1.1 : 0.35);

  // Меш — прямоугольник с полями; форму даёт маска.
  const verts = new Float32Array([b.left, b.top, b.right, b.top, b.right, b.bottom, b.left, b.bottom]);
  const geometry = new PIXI.Geometry()
    .addAttribute("aVertexPosition", verts, 2)
    .addIndex(new Uint16Array([0, 1, 2, 0, 2, 3]));
  const raw = region.bounds;
  const level = levelOf(region);
  const cut = drawCut(cuts.filter((c) => levelOf(c)?.id === level?.id), b);
  const shader = PIXI.Shader.from(VERT, FRAG[effect], {
    ...looksOf(region),
    uSpeed: 1,
    uMask: mask,
    uCut: cut,
    uBounds: new Float32Array([b.x, b.y, b.width, b.height]),
    uTime: 0,
    uGrid: grid,
    uCenter: new Float32Array([raw.center.x / grid, raw.center.y / grid]),
    uRadius: Math.min(raw.width, raw.height) / grid / 2,
    uFishSeed: fishSeed(),
    // Разлом: ось и размер щели по форме области, насколько открыт (см. rift.js).
    ...(effect === RIFT ? riftUniforms(region, grid) : {}),
    // Вода и лава берут картинку пола: вода её преломляет и несёт, у лавы светятся
    // её трещины (см. shaders.js).
    ...(MAPPED.has(effect) ? floorUniforms(level) : {})
  });
  const mesh = new PIXI.Mesh(geometry, shader);
  mesh.name = `${MODULE_ID}.${region.id}`;
  mesh.elevation = level?.elevation?.bottom ?? 0;
  // Фонтан Картографа — тайл (слой тайлов 500): эффект под ним был не виден совсем.
  mesh.sortLayer = effect === "fire" ? ABOVE_TOKENS : effect === "fountain" ? FOUNTAIN_LAYER : 1;
  mesh.sort = 0;
  mesh.eventMode = "none";
  mesh.blmLevel = level;
  canvas.primary.addChild(mesh);
  // Светящееся (лава, огонь, разлом, неон) — ещё раз, вторым проходом того же шейдера,
  // поверх освещения сцены: ночью оно не темнеет вместе с картой (см. uPass в shaders.js).
  // Как свет светлячков, в группе окружения; днём (темнота 0) не рисуется.
  let glow = null;
  if (GLOWING.has(effect) && canvas.environment) {
    glow = new PIXI.Mesh(geometry, PIXI.Shader.from(VERT, FRAG[effect], { ...shader.uniforms, uPass: 1, uNight: 0 }));
    glow.name = `${MODULE_ID}.${region.id}.glow`;
    glow.eventMode = "none";
    glow.visible = false;
    canvas.environment.addChild(glow);
  }
  return { region, effect, mesh, glow, mask, cut, clock: performance.now() / 1000 % 3600 };
}

/** Эффекты, что светятся сами. */
const GLOWING = new Set(["lava", "fire", RIFT, "neon"]);
/** Эффекты, что смотрят на картинку пола под собой. */
const MAPPED = new Set(["water", "lava"]);

/**
 * Картинка пола уровня: загруженная текстура фона и где она лежит, в точках сцены.
 * Нет фона (Boundless, сцена без картинки) или не загружен — `uHasMap` 0, шейдер
 * обходится без неё.
 */
function floorUniforms(level) {
  const none = { uMap: PIXI.Texture.EMPTY, uMapRect: new Float32Array([0, 0, 1, 1]), uHasMap: 0 };
  try {
    const src = level?.background?.src ?? canvas.scene?.background?.src;
    const tex = src ? foundry.canvas.getTexture?.(src) : null;
    if (!tex?.baseTexture?.valid) return none;
    const mesh = canvas.primary.children.find((c) => c.texture?.baseTexture === tex.baseTexture);
    const r = canvas.dimensions.sceneRect;
    const rect = mesh
      ? [mesh.x - mesh.width * (mesh.anchor?.x ?? 0), mesh.y - mesh.height * (mesh.anchor?.y ?? 0), mesh.width, mesh.height]
      : [r.x, r.y, r.width, r.height];
    return { uMap: tex, uMapRect: new Float32Array(rect), uHasMap: 1 };
  } catch {
    return none;
  }
}

/** Темнота сцены сейчас: 0 — день, 1 — ночь. */
function darkness() {
  return canvas.environment?.darknessLevel ?? canvas.scene?.environment?.darknessLevel ?? 0;
}

/** Силуэт области в низком разрешении, размытый: 1 внутри, 0 снаружи. */
function drawMask(tri, b, grid, soft = 0.35) {
  const s = MASK_SCALE;
  const { rt, w, h } = target(b, s);
  const g = silhouette([tri, ...beyondEdges(tri)], b, s);
  const blur = new PIXI.BlurFilter(grid * soft * s, 4);
  blur.padding = Math.ceil(grid * s * Math.max(1, soft * 2));
  g.filters = [blur];
  g.filterArea = new PIXI.Rectangle(0, 0, w, h);
  canvas.app.renderer.render(g, { renderTexture: rt, clear: true });
  g.destroy();
  return rt;
}

/**
 * Область, что упирается в край сцены (озеро, река за край карты), продолжается за
 * него своим зеркалом: иначе размытая маска у края гаснет, и по рамке карты бежит
 * пена, как у берега. Зеркала — только через края, которых область касается.
 */
function beyondEdges(tri) {
  const r = canvas.dimensions.sceneRect;
  const v = tri.vertices;
  const eps = 1;
  let left = false, right = false, top = false, bottom = false;
  for (let i = 0; i < v.length; i += 2) {
    left ||= v[i] <= r.left + eps;
    right ||= v[i] >= r.right - eps;
    top ||= v[i + 1] <= r.top + eps;
    bottom ||= v[i + 1] >= r.bottom - eps;
  }
  const flips = [];
  const fx = [null, ...(left ? [r.left] : []), ...(right ? [r.right] : [])];
  const fy = [null, ...(top ? [r.top] : []), ...(bottom ? [r.bottom] : [])];
  for (const x of fx) {
    for (const y of fy) {
      if (x === null && y === null) continue;
      const m = new Float32Array(v.length);
      for (let i = 0; i < v.length; i += 2) {
        m[i] = x === null ? v[i] : 2 * x - v[i];
        m[i + 1] = y === null ? v[i + 1] : 2 * y - v[i + 1];
      }
      flips.push({ vertices: m, indices: tri.indices });
    }
  }
  return flips;
}

/** Вырезы в рамке области; без них — пустая маска. */
function drawCut(cuts, b) {
  const { rt } = target(b, CUT_SCALE);
  const g = silhouette(cuts.map((c) => c.triangulation).filter((t) => t?.indices?.length), b, CUT_SCALE);
  canvas.app.renderer.render(g, { renderTexture: rt, clear: true });
  g.destroy();
  return rt;
}

function target(b, s) {
  const w = Math.max(4, Math.ceil(b.width * s));
  const h = Math.max(4, Math.ceil(b.height * s));
  return { rt: PIXI.RenderTexture.create({ width: w, height: h, scaleMode: PIXI.SCALE_MODES.LINEAR }), w, h };
}

function silhouette(tris, b, s) {
  const g = new PIXI.Graphics();
  g.beginFill(0xffffff, 1);
  for (const tri of tris) {
    const v = tri.vertices, ix = tri.indices;
    for (let k = 0; k < ix.length; k += 3) {
      const pts = [];
      for (let j = 0; j < 3; j++) {
        const n = ix[k + j];
        pts.push((v[2 * n] - b.x) * s, (v[2 * n + 1] - b.y) * s);
      }
      g.drawPolygon(pts);
    }
  }
  g.endFill();
  return g;
}

function tick() {
  if (!zones.size) {
    canvas.app.ticker.remove(tick);
    ticking = false;
    return;
  }
  const now = performance.now() / 1000;
  const dt = Math.min(now - lastTick, 0.25);
  lastTick = now;
  const night = darkness();
  for (const zone of zones.values()) {
    const { mesh, glow, region } = zone;
    if (mesh.destroyed) continue;
    // Часы копят время со своей скоростью, поэтому смена скорости не дёргает картинку.
    zone.clock = (zone.clock + dt * look(region, SPEED.key)) % 3600;
    mesh.shader.uniforms.uTime = zone.clock;
    if (zone.effect === RIFT) mesh.shader.uniforms.uOpen = openness(region);
    // На многоэтажной сцене — только на видимых этажах.
    mesh.visible = mesh.blmLevel?.isVisible ?? true;
    if (glow && !glow.destroyed) {
      const u = glow.shader.uniforms;
      u.uTime = zone.clock;
      u.uNight = night;
      if (zone.effect === RIFT) u.uOpen = mesh.shader.uniforms.uOpen;
      glow.visible = mesh.visible && night > 0.02;
    }
  }
}

/* ------------------------------ Окно области ------------------------------ */

// Во вкладке «Вид» окна области: какой эффект и ползунки именно этого эффекта.
Hooks.on("renderRegionConfig", (app, element) => {
  const root = element instanceof HTMLElement ? element : element[0];
  const tab = root?.querySelector('section[data-tab="appearance"]');
  if (!tab || tab.querySelector(`.${MODULE_ID}`)) return;
  const f = app.document.flags?.[MODULE_ID] ?? {};
  const options = [["", loc("None")], ...EFFECTS.map((e) => [e, loc(`Effect.${e}`)]), [CUT, loc("Effect.cut")]]
    .map(([v, l]) => `<option value="${v}" ${f.effect === v || (!f.effect && !v) ? "selected" : ""}>${l}</option>`)
    .join("");
  const pickOne = (key, choices, effects) => {
    const now = Number(f[key] ?? game.settings.get(MODULE_ID, key));
    const opts = choices.map((c, i) => `<option value="${i}" ${now === i ? "selected" : ""}>${loc(`Choice.${key}.${c}`)}</option>`).join("");
    return `
    <div class="form-group" data-blm="${effects}">
      <label>${loc(`Param.${key}`)}</label>
      <div class="form-fields"><select name="flags.${MODULE_ID}.${key}" data-dtype="Number">${opts}</select></div>
    </div>`;
  };
  const slider = ({ key, min = 0, max, step = 0.05, initial = 1, fixed, choices }, effects) => choices ? pickOne(key, choices, effects) : `
    <div class="form-group" data-blm="${effects}">
      <label>${loc(`Param.${key}`)}</label>
      <div class="form-fields">
        <range-picker name="flags.${MODULE_ID}.${key}" value="${Number(f[key] ?? (fixed ? game.settings.get(MODULE_ID, key) : initial))}" min="${min}" max="${max}" step="${step}"></range-picker>
      </div>
    </div>`;
  const sliders = Object.entries(PARAMS).flatMap(([e, list]) => list.map((p) => slider(p, e))).join("");
  const set = document.createElement("fieldset");
  set.className = MODULE_ID;
  set.innerHTML = `
    <legend>🔥 ${loc("Title")}</legend>
    <div class="form-group">
      <label>${loc("Effect.Label")}</label>
      <div class="form-fields"><select name="flags.${MODULE_ID}.effect">${options}</select></div>
      <p class="hint" data-blm="waterfall">${loc("Effect.WaterfallHint")}</p>
      <p class="hint" data-blm="fountain">${loc("Effect.FountainHint")}</p>
      <p class="hint" data-blm="water lava swamp fog">${loc("Effect.Hint")}</p>
      <p class="hint" data-blm="fire">${loc("Effect.FireHint")}</p>
      <p class="hint" data-blm="${RIFT}">${loc("Effect.RiftHint")}</p>
      <p class="hint" data-blm="${CUT}">${loc("Effect.CutHint")}</p>
    </div>
    ${slider(SPEED, EFFECTS.join(" "))}
    ${sliders}`;
  tab.append(set);
  soundField(app, set);
  // Именно список эффектов: soundField уже вставил перед ним выбор «Звук внутри».
  const select = set.querySelector(`select[name="flags.${MODULE_ID}.effect"]`);
  const show = () => {
    for (const el of set.querySelectorAll("[data-blm]")) {
      el.style.display = el.dataset.blm.split(" ").includes(select.value) ? "" : "none";
    }
  };
  select.addEventListener("change", show);
  show();
  live(set, (preview.regions[app.document.id] ??= {}));
});

Hooks.on("closeRegionConfig", (app) => {
  delete preview.regions[app.document.id];
  refreshLooks();
});

// Окно настроек: те же ползунки, видно сразу. Закрыл без сохранения — вернулось как было.
Hooks.on("renderSettingsConfig", (app, element) => {
  const root = element instanceof HTMLElement ? element : element[0];
  if (root) live(root, preview.world);
});

Hooks.on("closeSettingsConfig", () => {
  for (const key of Object.keys(preview.world)) delete preview.world[key];
  refreshLooks();
});

// Своё окно настроек (плитка BurnHub) — так же.
Hooks.on("renderWildCanvasPanel", (app, element) => live(element, preview.world));
Hooks.on("closeWildCanvasPanel", () => {
  for (const key of Object.keys(preview.world)) delete preview.world[key];
  refreshLooks();
});

/** Движение ползунка внутри `root` — сразу в шейдеры. */
function live(root, into) {
  if (root.dataset.blmLive) return;
  root.dataset.blmLive = "1";
  root.addEventListener("input", (event) => {
    const name = (event.target.closest?.("range-picker") ?? event.target.closest?.("select"))?.getAttribute("name") ?? "";
    const key = name.split(".").pop();
    if (!name.includes(MODULE_ID) || !(key === "strength" || LOOKS.some((l) => l.key === key))) return;
    const value = Number(event.target.value);
    if (!Number.isFinite(value)) return;
    into[key] = value;
    refreshLooks();
  }, true);
}
