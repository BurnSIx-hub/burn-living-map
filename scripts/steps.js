// Шаги. Токен идёт — у всех за столом звучат шаги по тому, на что он ступает.
// По чему идёт, решается так, первое найденное:
//   1. область с поведением «Шаги: поверхность» — ручная разметка важнее всего;
//   2. области «Wild Canvas»: вода и водопад — вода, болото — грязь, огонь —
//      горящая земля; лава шагов не даёт (она гудит сама); вырез (мост) — дерево;
//   3. сетка поверхностей сцены — флаг `surfaces`, его пишет Картограф при выгрузке:
//      по букве на клетку;
//   4. ничего — тишина. Чужую карту без сетки и без областей угадывать не берёмся.
// Летящий (выше 1 фута или действие «Полёт») и копающий не шагают.
//
// Перенесено из «Location Misc» (footstep-sounds). Прежний ключ поведения
// `footstep-sounds.surfaceType` Foundry 14 не принимал: тип должен быть объявлен
// в `module.json` модуля (`documentTypes`) и начинаться с его id. Теперь —
// `burn-living-map.surface`.

import { SYNTH, playSynth } from "./steps-synth.js";

const MODULE_ID = "burn-living-map";
const BEHAVIOR_TYPE = `${MODULE_ID}.surface`;
const DIR = `modules/${MODULE_ID}/sounds/steps`;

const LIVE_SURFACE = { water: "water", waterfall: "water", swamp: "mud", fire: "fire", cut: "wood" };
/** Буквы сетки Картографа. */
const LETTERS = { w: "water", m: "mud", e: "metal", n: "snow", g: "gravel", k: "creaky_wood", o: "wood", s: "stone", a: "sand", r: "grass", d: "dirt" };

const SOUND_FILES = {
  metal:       ["metal1.mp3",  "metal2.ogg",  "metal3.ogg",  "metal4.ogg"],
  stone:       ["stone1.ogg",  "stone2.ogg",  "stone3.ogg",  "stone4.ogg",  "stone5.ogg"],
  gravel:      ["gravel1.ogg", "gravel2.ogg", "gravel3.ogg", "gravel4.ogg", "gravel5.ogg"],
  dirt:        ["dirt1.ogg"],
  wood:        ["wood1.ogg",   "wood2.ogg",   "wood3.ogg",   "wood4.ogg",   "wood5.ogg"],
  creaky_wood: ["creaky1.ogg", "creaky2.ogg", "creaky3.ogg", "creaky4.ogg"],
  water:       ["water1.wav", "water2.wav", "water3.wav", "water4.wav", "water5.wav", "water6.wav"],
  mud:         ["mud1.wav",   "mud2.wav",   "mud3.wav",   "mud4.wav",   "mud5.wav",   "mud6.wav"]
};
/** Своих записей пока нет — звучит ближайшее: трава и песок мягко, как земля; снег хрустит, как гравий. */
const STAND_IN = { grass: "dirt", sand: "dirt", snow: "gravel" };
/** Первый шаг в поверхность: всплеск. Нет здесь — обычный шаг. */
const ENTRY_FILES = { water: "water_entry.wav" };
/** Где первый шаг звучит иначе (файлом или синтезом). */
const HAS_ENTRY = new Set(["water", "mud", "fire"]);

const SURFACES = ["metal", "stone", "gravel", "dirt", "grass", "sand", "snow", "wood", "creaky_wood", "water", "mud", "fire"];
const LABEL = { creaky_wood: "CreakyWood" };
const labelKey = (s) => `FOOTSTEPS.Surface.${LABEL[s] ?? s[0].toUpperCase() + s.slice(1)}`;

const WALK_STEP_MS = 167; // на клетку при обычной скорости анимации Foundry (~6 клеток/с)
const RUN_RATE = 1.25;
const COOLDOWN_MS = 200;

const order = {};
const lockUntil = new Map();
/**
 * Где токен стоял до этого переноса. Когда приходит `updateToken`, в документе уже
 * новое место (Foundry двигает его ещё при перетаскивании), поэтому прежнее — своё.
 */
const lastPos = new Map();

/* ------------------------------ Поведение области ------------------------------ */

class FootstepSurfaceBehaviorData extends foundry.data.regionBehaviors.RegionBehaviorType {
  static defineSchema() {
    return {
      surfaceType: new foundry.data.fields.StringField({
        required: true, blank: false, initial: "stone",
        label: "FOOTSTEPS.SurfaceType.Label", hint: "FOOTSTEPS.SurfaceType.Hint",
        choices: Object.fromEntries(SURFACES.map((s) => [s, labelKey(s)]))
      })
    };
  }
}

/* ------------------------------ Звук ------------------------------ */

async function play(surface, rate = 1, entry = false) {
  if (!game.settings.get(MODULE_ID, "enabled") || !game.settings.get(MODULE_ID, "footsteps")) return;
  if (SYNTH.has(surface)) return playSynth(surface, { rate, entry });
  const kind = SOUND_FILES[surface] ? surface : STAND_IN[surface];
  const files = SOUND_FILES[kind];
  if (!files?.length) return;
  const k = (order[kind] = ((order[kind] ?? -1) + 1) % files.length);
  const file = (entry && ENTRY_FILES[kind]) || files[k];
  const sound = await game.audio.play(`${DIR}/${kind}/${file}`, { volume: 1, loop: false, context: game.audio.environment });
  if (sound?.node) sound.node.playbackRate.value = rate;
}

/* ------------------------------ По чему идёт ------------------------------ */

function inside(region, p) {
  try {
    return region.polygonTree?.testPoint(p) ?? false;
  } catch {
    return false;
  }
}

/** Ручная разметка: поведение «Шаги: поверхность». */
function marked(scene, p) {
  for (const region of scene.regions) {
    const b = region.behaviors.find((x) => x.type === BEHAVIOR_TYPE && !x.disabled);
    if (b && inside(region, p)) return b.system.surfaceType;
  }
  return undefined;
}

/** Области «Wild Canvas». Лава — `null`: там тихо, а не «смотри дальше». */
function living(scene, p) {
  let found;
  for (const region of scene.regions) {
    const e = region.flags?.[MODULE_ID]?.effect;
    if (!e || !(e in LIVE_SURFACE || e === "lava")) continue;
    if (!inside(region, p)) continue;
    // Мост поверх воды — дерево, что бы ни было под ним.
    if (e === "cut") return LIVE_SURFACE.cut;
    found ??= e === "lava" ? null : LIVE_SURFACE[e];
  }
  return found;
}

/** Сетка Картографа: буква клетки под точкой. */
function gridded(scene, p) {
  const s = scene.flags?.[MODULE_ID]?.surfaces;
  if (!s?.cells || !s.w) return undefined;
  const r = canvas.dimensions.sceneRect;
  const g = canvas.grid.size;
  const x = Math.floor((p.x - r.x) / g), y = Math.floor((p.y - r.y) / g);
  if (x < 0 || y < 0 || x >= s.w || y >= s.h) return undefined;
  return LETTERS[s.cells[y * s.w + x]] ?? null;
}

export function surfaceUnder(scene, p) {
  const own = marked(scene, p);
  if (own !== undefined) return own;
  const live = living(scene, p);
  if (live !== undefined) return live;
  return gridded(scene, p) ?? null;
}

/* ------------------------------ Шаг ------------------------------ */

function onMove(doc, changes) {
  if (!("x" in changes) && !("y" in changes)) return;
  const scene = doc.parent;
  if (!scene || scene !== canvas.scene) return;
  const now = { x: doc.x, y: doc.y };
  // Прежнее место — из своей таблицы, и сразу запомнить новое. До проверки паузы:
  // иначе шаг в паузе пропадал, и всплеск звучал на втором шаге в воде.
  const before = lastPos.get(doc.id);
  lastPos.set(doc.id, { ...now });
  const t = Date.now();
  if (t < (lockUntil.get(doc.id) ?? 0)) return;
  // Летит или копает — шагов нет.
  const action = doc.movementAction;
  if ((doc.elevation ?? 0) > 1 || action === "fly" || action === "burrow") return;

  const g = scene.grid?.size ?? 100;
  const center = (q) => ({ x: q.x + (doc.width * g) / 2, y: q.y + (doc.height * g) / 2 });
  const under = (q) => surfaceUnder(scene, center(q));
  let cells = 1;
  if (before) cells = Math.min(20, Math.max(1, Math.round(Math.max(Math.abs(now.x - before.x), Math.abs(now.y - before.y)) / g)));
  // Поверхность под каждым шагом пути, а не одна на весь перенос: протяжка с
  // берега в воду шлёпает по воде только с той клетки, где вода началась.
  const at = (k) => (before ? { x: before.x + (now.x - before.x) * k, y: before.y + (now.y - before.y) * k } : now);
  let prev = before ? under(before) : null;
  const steps = [];
  for (let i = 0; i < cells; i++) {
    const here = under(at((i + 1) / cells));
    // Шаг из размеченного на неразмеченное (из воды на берег) ещё звучит прежним.
    const sound = here ?? prev;
    const entry = !!here && here !== prev && HAS_ENTRY.has(here);
    steps.push({ sound, entry });
    prev = here;
  }
  if (!steps.some((s) => s.sound)) return;
  // Несколько клеток за раз — перетаскивание мышью, бег; одна — шаг с клавиатуры.
  const rate = cells > 1 ? RUN_RATE : 1;
  const stepMs = Math.round(WALK_STEP_MS / rate);
  lockUntil.set(doc.id, t + (cells - 1) * stepMs + COOLDOWN_MS);
  steps.forEach(({ sound, entry }, i) => {
    if (sound) setTimeout(() => play(sound, rate, entry), i * stepMs);
  });
}

/* ------------------------------ Хуки ------------------------------ */

export function registerSteps() {
  CONFIG.RegionBehavior.dataModels[BEHAVIOR_TYPE] = FootstepSurfaceBehaviorData;
  CONFIG.RegionBehavior.typeLabels[BEHAVIOR_TYPE] = "FOOTSTEPS.BehaviorLabel";
  CONFIG.RegionBehavior.typeIcons[BEHAVIOR_TYPE] = "fa-solid fa-shoe-prints";
  game.settings.register(MODULE_ID, "footsteps", {
    name: "BLM.Setting.footsteps", hint: "BLM.Setting.footstepsHint",
    scope: "client", config: true, type: Boolean, default: true
  });
  Hooks.on("canvasReady", () => {
    lastPos.clear();
    for (const t of canvas.tokens.placeables) lastPos.set(t.id, { x: t.document.x, y: t.document.y });
  });
  Hooks.on("createToken", (doc) => lastPos.set(doc.id, { x: doc.x, y: doc.y }));
  Hooks.on("deleteToken", (doc) => {
    lastPos.delete(doc.id);
    lockUntil.delete(doc.id);
  });
  Hooks.on("updateToken", onMove);
}
