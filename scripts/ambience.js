// Звуки мест. Два вида:
//  • звук сцены — лес по сезону, пещера, квартал… Выбирается в окне сцены
//    (вкладка «Разное», флаг `ambience`), Картограф ставит его при выгрузке.
//    Слышен на всей сцене ровно — кроме мест со своим звуком.
//  • звук внутри — область с флагом `place` (таверна, дом…): пока слушатель
//    внутри, играет её звук, а звук сцены стихает; на пороге они сменяются
//    за полклетки. Картограф обводит так здание, а звуком сцены ставит округу.
//  • звук области — лава, вода, болото, костёр. Громче всего над самой областью,
//    к `reach` клеткам от края стихает до нуля. Слушатели — как у звуков
//    окружения Foundry (`getListenerPositions`): токены со зрением, у Мастера —
//    выбранные. Вариант записи — в окне области (флаг `sound`, "off" — тишина).
// У области своя громкость — флаг `volume` (1 — как есть, 0 — тишина, до 2), ползунок
// в окне области; Мастер слышит его сразу, ещё не сохранив (`preview`).
// Всё идёт в контекст окружения (`game.audio.environment`) и слушается ползунка
// «Окружение»: громкость области умножается на него. Петли сшиваются перекрёстным затуханием: стык записи не щёлкает.
// Записи — Freesound, авторы в README. Звуки станции — синтез (tools/station_synth.py), записей нет.
//  • горящий тайл (blaze.js) звучит, как большой костёр, — по своей рамке.

import { blazingShapes } from "./blaze.js";

const MODULE_ID = "burn-living-map";
const DIR = `modules/${MODULE_ID}/sounds/`;
/** Сколько секунд две копии записи звучат вместе на стыке петли. */
const XF = 3;
/** Громкость звука сцены и звука области над самой областью. */
const PLACE_LOUD = 0.5;
const ZONE_LOUD = 0.7;

// Слой — файл и множитель громкости. Записи на Freesound разной громкости:
// GAIN ровняет громкий 90-й процентиль по окнам 0,4 с к гулу лавы (−24,6 дБ),
// но пики не выше −1 дБ, подъём не больше +18 дБ, спуск — не больше −15.
// Второй множитель в L — поправка на слух поверх выравнивания.
const GAIN = {
  "lava-loop.mp3": 1, "forest-summer.mp3": 1.57, "forest-spring.mp3": 7.33, "forest-autumn.mp3": 4.73,
  "forest-winter.mp3": 3.67, "forest-magic.mp3": 2.43, "cave.mp3": 0.69, "cave-creepy.mp3": 0.84,
  "cave-drips.mp3": 2.43, "dungeon-air.mp3": 0.41, "dungeon-dark.mp3": 0.52, "town-street.mp3": 1.11,
  "town-village.mp3": 2.48, "town-bells.mp3": 3.2, "tavern.mp3": 0.51, "house-fireplace.mp3": 1.32,
  "water-stream.mp3": 7.94, "water-brook.mp3": 7.94, "swamp-night.mp3": 3.85, "swamp-lilypads.mp3": 4.12,
  "swamp-april.mp3": 1.55, "swamp-frogs.mp3": 1.55, "fire-campfire.mp3": 0.75, "fire-bonfire.mp3": 0.77,
  // Гул станции записан на общий уровень (−24,6 дБ); реактор чуть громче: он ниже и на слух тише вентиляции.
  "station-vent.wav": 0.8, "station-core.wav": 1.2
};
const L = (file, gain = 1) => ({ file, gain: (GAIN[file] ?? 1) * gain });

/** Звук сцены: ключ → варианты, вариант — слои, звучащие вместе. */
export const PLACES = {
  "forest-summer": [[L("forest-summer.mp3")]],
  "forest-spring": [[L("forest-spring.mp3")]],
  "forest-autumn": [[L("forest-autumn.mp3")]],
  "forest-winter": [[L("forest-winter.mp3")]],
  "forest-magic":  [[L("forest-magic.mp3")]],
  "cave-1":        [[L("cave.mp3")]],
  "cave-2":        [[L("cave-creepy.mp3")]],
  "cave-3":        [[L("cave-drips.mp3")]],
  "dungeon-1":     [[L("dungeon-air.mp3")]],
  "dungeon-2":     [[L("cave-creepy.mp3")]],
  "dungeon-3":     [[L("dungeon-dark.mp3")]],
  "town-1":        [[L("town-street.mp3")]],
  "town-2":        [[L("town-village.mp3")]],
  "station-1":     [[L("station-vent.wav")]],
  "station-2":     [[L("station-core.wav")]],
  "tavern":        [[L("tavern.mp3")]],
  "house":         [[L("house-fireplace.mp3")]]
};

/** Звук области: эффект → насколько слышно (клеток) и варианты. */
export const ZONES = {
  lava:  { reach: 2, variants: [[L("lava-loop.mp3")]] },
  water: { reach: 2, variants: [[L("water-stream.mp3")], [L("water-brook.mp3")]] },
  // Водопад шумит громче и дальше ручья: та же запись вблизи, слышно за четыре клетки.
  waterfall: { reach: 4, variants: [[L("water-stream.mp3", 1.6)], [L("water-brook.mp3", 1.6)]] },
  // Фонтан журчит тише водопада: ручей вблизи, слышно за три клетки.
  fountain: { reach: 3, variants: [[L("water-brook.mp3")], [L("water-stream.mp3")]] },
  // Третий — апрельское болото, поверх лягушки втрое тише (лягушки — тем же множителем, что болото).
  swamp: { reach: 2, variants: [[L("swamp-night.mp3")], [L("swamp-lilypads.mp3")], [L("swamp-april.mp3"), L("swamp-frogs.mp3", 1 / 3)]] },
  // Первый костёр в полтора раза тише записи.
  fire:  { reach: 5, variants: [[L("fire-campfire.mp3", 1 / 1.5)], [L("fire-bonfire.mp3")]] }
};

/** Разовые звуки: Мастер включает для всех кнопкой в панели звуков. */
export const SHOTS = { bells: "town-bells.mp3" };

/* ------------------------------ Петля ------------------------------ */

/** Одна запись по кругу: под конец следующая копия вступает, прежняя гаснет. */
class Bed {
  constructor({ file, gain }) {
    this.src = DIR + file;
    this.gain = gain;
    this.level = 0;
    this.alive = true;
    this.cur = null;
    this.timer = null;
  }

  async start() {
    // Первый проход — с случайного места: два одинаковых звука на разных сценах не в такт.
    this.cur = await this.#voice(500, true);
  }

  async #voice(fadeIn, first) {
    const s = new foundry.audio.Sound(this.src, { context: game.audio.environment, forceBuffer: true });
    await s.load();
    if (!this.alive) return null;
    const offset = first ? Math.random() * Math.max(0, s.duration - 2 * XF - 1) : 0;
    await s.play({ volume: 0, offset });
    if (!this.alive) { s.stop(); return null; }
    s.fade(this.level * this.gain, { duration: fadeIn });
    const left = s.duration - offset - XF;
    this.timer = setTimeout(() => this.#swap(), Math.max(1, left) * 1000);
    return s;
  }

  async #swap() {
    const old = this.cur;
    old?.fade(0, { duration: XF * 1000 }).then(() => old.stop());
    const next = await this.#voice(XF * 1000, false).catch(() => null);
    if (this.alive) this.cur = next;
  }

  set(level, ms = 250) {
    if (Math.abs(level - this.level) < 0.005) return;
    this.level = level;
    this.cur?.fade(level * this.gain, { duration: ms });
  }

  stop(ms = 500) {
    this.alive = false;
    clearTimeout(this.timer);
    const s = this.cur;
    this.cur = null;
    s?.fade(0, { duration: ms }).then(() => s.stop());
  }
}

/** Вариант — несколько слоёв с общей громкостью. */
class Mix {
  constructor(layers) { this.beds = layers.map((l) => new Bed(l)); }
  start() { return Promise.all(this.beds.map((b) => b.start().catch((err) => console.warn(`${MODULE_ID} | sound failed to load: ${b.src}`, err)))); }
  set(level, ms) { for (const b of this.beds) b.set(level, ms); }
  stop() { for (const b of this.beds) b.stop(); }
}

/* ------------------------------ Что звучит ------------------------------ */

let place = null;            // { key, mix }
const zones = new Map();     // "эффект:вариант" → { mix, regions, reach }
const indoors = new Map();   // ключ звука → { mix, regions }
/** За сколько клеток за краем области «внутри» сменяется звуком сцены. */
const DOORSTEP = 0.5;
/** Громкость, ещё не сохранённая в открытом окне области: id области → громкость. */
const preview = new Map();

/** Громкость области: открытое окно, флаг `volume`, иначе 1. У горящего тайла — 1. */
function volumeOf(region) {
  const v = Number(preview.get(region?.id) ?? region?.flags?.[MODULE_ID]?.volume ?? 1);
  return Number.isFinite(v) ? Math.max(0, v) : 1;
}

/** Пересчитать громкость по нынешним слушателям. */
const relisten = () => listen(canvas.ready ? canvas.sounds.getListenerPositions() : []);

export function registerAmbience() {
  game.settings.register(MODULE_ID, "ambience", {
    name: "BLM.Setting.ambience", hint: "BLM.Setting.ambienceHint",
    scope: "client", config: true, type: Boolean, default: true,
    onChange: () => rebuildAmbience()
  });
}

const on = () => game.settings.get(MODULE_ID, "enabled") && game.settings.get(MODULE_ID, "ambience");

/** Вариант области: номер из флага, нет флага — первый, "off" — без звука. */
export function zoneVariant(region) {
  const f = region.flags?.[MODULE_ID] ?? {};
  const zone = ZONES[f.effect];
  if (!zone || f.sound === "off") return null;
  const i = Number(f.sound ?? 0);
  return zone.variants[i] ? i : 0;
}

/** Собрать звуки сцены заново: что должно играть — играет, остальное гаснет. */
export function rebuildAmbience() {
  const scene = on() && canvas.ready ? canvas.scene : null;
  if (scene && game.audio.locked) return void game.audio.pending.push(() => rebuildAmbience());

  // Сцена.
  const key = scene?.flags?.[MODULE_ID]?.ambience;
  const want = PLACES[key] ? key : null;
  if (place?.key !== want) {
    place?.mix.stop();
    place = null;
    if (want) {
      const mix = new Mix(PLACES[want][0]);
      place = { key: want, mix };
      mix.set(PLACE_LOUD);
      mix.start();
    }
  }

  // Места со своим звуком внутри.
  const inside = new Map();
  for (const r of scene?.regions ?? []) {
    const k = r.flags?.[MODULE_ID]?.place;
    if (!PLACES[k]) continue;
    if (!inside.has(k)) inside.set(k, []);
    inside.get(k).push(r);
  }
  for (const [k, z] of indoors) {
    if (!inside.has(k)) { z.mix.stop(); indoors.delete(k); }
  }
  for (const [k, regions] of inside) {
    let z = indoors.get(k);
    if (!z) {
      const mix = new Mix(PLACES[k][0]);
      z = { mix, regions: [] };
      indoors.set(k, z);
      mix.start().then(() => listen(canvas.sounds.getListenerPositions()));
    }
    z.regions = regions;
  }

  // Области.
  const groups = new Map();
  for (const r of scene?.regions ?? []) {
    const v = zoneVariant(r);
    if (v === null) continue;
    const effect = r.flags[MODULE_ID].effect;
    const id = `${effect}:${v}`;
    if (!groups.has(id)) groups.set(id, { effect, v, regions: [] });
    groups.get(id).regions.push(r);
  }
  // Горящие тайлы трещат, как большой костёр.
  if (scene) {
    for (const shape of blazingShapes()) {
      if (!groups.has("fire:1")) groups.set("fire:1", { effect: "fire", v: 1, regions: [] });
      groups.get("fire:1").regions.push(shape);
    }
  }
  for (const [id, z] of zones) {
    if (!groups.has(id)) { z.mix.stop(); zones.delete(id); }
  }
  for (const [id, g] of groups) {
    let z = zones.get(id);
    if (!z) {
      const mix = new Mix(ZONES[g.effect].variants[g.v]);
      z = { mix, reach: ZONES[g.effect].reach, regions: [] };
      zones.set(id, z);
      mix.start().then(() => listen(canvas.sounds.getListenerPositions()));
    }
    z.regions = g.regions;
  }
  listen(canvas.ready ? canvas.sounds.getListenerPositions() : []);
}

/** Что звучит и как громко: `api.sounding()` в консоли. */
export function sounding() {
  const lvl = (mix) => Math.round((mix.beds[0]?.level ?? 0) * 100) / 100;
  return {
    scene: place ? { [place.key]: lvl(place.mix) } : {},
    inside: Object.fromEntries([...indoors].map(([k, z]) => [k, lvl(z.mix)])),
    zones: Object.fromEntries([...zones].map(([k, z]) => [k, lvl(z.mix)]))
  };
}

function stopAll() {
  place?.mix.stop();
  place = null;
  for (const z of zones.values()) z.mix.stop();
  zones.clear();
  for (const z of indoors.values()) z.mix.stop();
  indoors.clear();
}

/** Громкость каждой области по ближайшему слушателю: внутри — полная, к `reach` — ноль. */
function listen(listeners) {
  if (!canvas.ready) return;
  // Слушать некому (у Мастера не выбран токен) — слышно то, что в середине экрана.
  if (!listeners?.length) listeners = [{ x: canvas.stage.pivot.x, y: canvas.stage.pivot.y }];
  // Внутри места: его звук, звук сцены — тем тише, чем глубже зашли все слушатели.
  // Громкость места — своей области (у нескольких областей одного звука — самой громкой рядом).
  if (indoors.size) {
    const step = DOORSTEP * canvas.grid.size;
    const depth = (r, p) => Math.max(0, 1 - distance(r, p) / step);
    const levels = new Map([...indoors.keys()].map((k) => [k, 0]));
    let outside = 0;
    for (const p of listeners) {
      let here = 0;
      for (const [k, z] of indoors) {
        for (const r of z.regions) {
          const d = depth(r, p);
          levels.set(k, Math.max(levels.get(k), d * volumeOf(r)));
          here = Math.max(here, d);
        }
      }
      outside = Math.max(outside, 1 - here);
    }
    for (const [k, z] of indoors) z.mix.set(PLACE_LOUD * levels.get(k), 600);
    place?.mix.set(PLACE_LOUD * outside, 600);
  }
  if (!zones.size) return;
  // Каждая область слышна своей громкостью; у нескольких областей одного звука — громче та, что ближе.
  for (const z of zones.values()) {
    const reach = z.reach * canvas.grid.size;
    let level = 0;
    for (const r of z.regions) {
      const vol = volumeOf(r);
      if (vol <= 0) continue;
      let near = Infinity;
      for (const p of listeners ?? []) {
        near = Math.min(near, distance(r, p));
        if (near === 0) break;
      }
      const k = Math.max(0, 1 - near / reach);
      level = Math.max(level, ZONE_LOUD * k * k * (3 - 2 * k) * vol);
    }
    z.mix.set(level);
  }
}

/** От точки до области: 0 внутри, иначе до ближайшего края. */
function distance(region, p) {
  if (region.polygonTree?.testPoint(p)) return 0;
  let best = Infinity;
  for (const poly of region.polygons ?? []) {
    const pts = poly.points;
    for (let i = 0; i < pts.length; i += 2) {
      const ax = pts[i], ay = pts[i + 1];
      const bx = pts[(i + 2) % pts.length], by = pts[(i + 3) % pts.length];
      best = Math.min(best, segment(p.x, p.y, ax, ay, bx, by));
    }
  }
  return best;
}

function segment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Разовый звук для всех на сцене. */
export function playShot(name) {
  const file = SHOTS[name];
  if (!file) return;
  foundry.audio.AudioHelper.play({ src: DIR + file, volume: 0.8 * (GAIN[file] ?? 1), channel: "environment" }, true);
}

/* ------------------------------ Окна ------------------------------ */

const loc = (k) => game.i18n.localize(`BLM.${k}`);

// Окно сцены, вкладка «Разное», рядом с плейлистом: звук места.
Hooks.on("renderSceneConfig", (app, element) => {
  const root = element instanceof HTMLElement ? element : element[0];
  const audio = root?.querySelector('[name="playlist"]')?.closest("fieldset");
  if (!audio || audio.querySelector(`.${MODULE_ID}`)) return;
  const cur = app.document.flags?.[MODULE_ID]?.ambience ?? "";
  const opt = (v, l) => `<option value="${v}" ${cur === v ? "selected" : ""}>${l}</option>`;
  const group = (label, keys) => `<optgroup label="${label}">${keys.map((k) => opt(k, loc(`Place.${k}`))).join("")}</optgroup>`;
  const keys = Object.keys(PLACES);
  const by = (p) => keys.filter((k) => k.startsWith(p));
  const div = document.createElement("div");
  div.className = `form-group ${MODULE_ID}`;
  div.innerHTML = `
    <label>🔥 ${loc("Place.Label")}</label>
    <div class="form-fields"><select name="flags.${MODULE_ID}.ambience">
      ${opt("", loc("None"))}
      ${group(loc("Place.Forest"), by("forest-"))}
      ${group(loc("Place.Cave"), by("cave-"))}
      ${group(loc("Place.Dungeon"), by("dungeon-"))}
      ${group(loc("Place.Town"), by("town-"))}
      ${group(loc("Place.Station"), by("station-"))}
      ${opt("tavern", loc("Place.tavern"))}
      ${opt("house", loc("Place.house"))}
    </select></div>
    <p class="hint">${loc("Place.Hint")}</p>`;
  audio.append(div);
});

/** Окно области: какой записью звучит (у лавы, воды, болота, костра). Зовёт main.js, собрав свой блок. */
export function soundField(app, set) {
  const f = app.document.flags?.[MODULE_ID] ?? {};
  // Звук внутри области — у любой, с эффектом и без.
  const keys = Object.keys(PLACES);
  const here = document.createElement("div");
  here.className = "form-group";
  here.innerHTML = `
    <label>${loc("Place.Inside")}</label>
    <div class="form-fields"><select name="flags.${MODULE_ID}.place">
      <option value="">${loc("None")}</option>
      ${keys.map((k) => `<option value="${k}" ${f.place === k ? "selected" : ""}>${loc(`Place.${k}`)}</option>`).join("")}
    </select></div>
    <p class="hint">${loc("Place.InsideHint")}</p>`;
  set.querySelector("legend")?.after(here);
  const effectSelect = set.querySelector(`[name="flags.${MODULE_ID}.effect"]`);
  const div = document.createElement("div");
  div.className = "form-group";
  set.querySelector(".form-group")?.after(div);
  const draw = () => {
    const e = effectSelect?.value;
    const zone = ZONES[e];
    div.style.display = zone ? "" : "none";
    if (!zone) return;
    const cur = String(f.sound ?? 0);
    const opts = zone.variants.map((_, i) => [String(i), loc(`Sound.${e}.${i}`)]);
    opts.push(["off", loc("Sound.off")]);
    div.innerHTML = `
      <label>${loc("Sound.Label")}</label>
      <div class="form-fields"><select name="flags.${MODULE_ID}.sound">
        ${opts.map(([v, l]) => `<option value="${v}" ${cur === v ? "selected" : ""}>${l}</option>`).join("")}
      </select></div>`;
  };
  effectSelect?.addEventListener("change", draw);
  draw();

  // Громкость: у звука области и у звука внутри. Двигаешь — слышно сразу.
  const vol = document.createElement("div");
  vol.className = "form-group";
  vol.innerHTML = `
    <label>${loc("Volume.Label")}</label>
    <div class="form-fields">
      <range-picker name="flags.${MODULE_ID}.volume" value="${volumeOf(app.document)}" min="0" max="2" step="0.05"></range-picker>
    </div>
    <p class="hint">${loc("Volume.Hint")}</p>`;
  div.after(vol);
  const placeSelect = here.querySelector("select");
  const showVol = () => {
    const sound = div.querySelector("select")?.value;
    const zone = ZONES[effectSelect?.value] && sound !== "off";
    vol.style.display = zone || placeSelect.value ? "" : "none";
  };
  set.addEventListener("change", showVol);
  showVol();
  const id = app.document.id;
  const hear = (event) => {
    if (event.target.closest?.("range-picker")?.getAttribute("name") !== `flags.${MODULE_ID}.volume`) return;
    const v = Number(event.target.value);
    if (!Number.isFinite(v)) return;
    preview.set(id, v);
    relisten();
  };
  set.addEventListener("input", hear, true);
  set.addEventListener("change", hear, true);
}

// Окно области закрыто: несохранённая громкость забыта.
Hooks.on("closeRegionConfig", (app) => {
  if (preview.delete(app.document?.id)) relisten();
});

// Панель звуков у Мастера: разовые звуки для всех.
Hooks.on("getSceneControlButtons", (controls) => {
  const tools = controls.sounds?.tools;
  if (!tools) return;
  tools[`${MODULE_ID}-bells`] = {
    name: `${MODULE_ID}-bells`,
    order: 50,
    title: "BLM.Shot.bells",
    icon: "fa-solid fa-bell",
    button: true,
    onChange: () => playShot("bells")
  };
});

/* ------------------------------ Хуки ------------------------------ */

// Foundry пересчитывает слушателей при движении токенов, смене выбора и зрения.
Hooks.on("soundsRefresh", (layer, listeners) => listen(listeners));
// Без слушателей звук идёт за камерой.
Hooks.on("canvasPan", () => {
  const listeners = canvas.sounds?.getListenerPositions?.() ?? [];
  if (!listeners.length) listen(listeners);
});
Hooks.on("canvasReady", () => rebuildAmbience());
Hooks.on("canvasTearDown", () => stopAll());
Hooks.on("updateScene", (scene, changes) => {
  if (scene === canvas.scene && changes.flags?.[MODULE_ID] && "ambience" in changes.flags[MODULE_ID]) rebuildAmbience();
});
for (const hook of ["createRegion", "updateRegion", "deleteRegion"]) {
  Hooks.on(hook, (region) => { if (region.parent === canvas.scene) rebuildAmbience(); });
}
