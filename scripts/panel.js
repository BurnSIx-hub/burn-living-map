// Окно Wild Canvas: открывается плиткой BurnHub, без BurnHub — кнопкой
// в настройках игры. Все настройки модуля живут здесь, а не в общем окне:
// `takeSettings` в конце init снимает с них `config` и запоминает порядок.
//
// Раскладка по образцу FA Nexus: слева сетка карточек эффектов с настоящими
// кадрами (assets/previews), справа — выбранный эффект: кнопка «Нарисовать
// область» и его ползунки по группам. Вкладка «Сцена» — общее для всех
// эффектов, внизу — переключатели этого компьютера.
//
// В форме лежат все поля сразу (невыбранные спрятаны), поэтому сохранение
// и живой предпросмотр (main.js ловит `renderWildCanvasPanel`) работают как
// раньше: закрыл без сохранения — вернулось как было (`closeWildCanvasPanel`).

const MODULE_ID = "burn-living-map";
const PANEL_ID = `${MODULE_ID}-panel`;
const { ApplicationV2 } = foundry.applications.api;
const loc = (k) => game.i18n.localize(k);
const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));

/** Ключи настроек окна в порядке регистрации. */
const keys = [];

/** Карточки эффектов: ползунки мира по группам. Вырез — без ползунков. */
const CARDS = [
  { id: "water", hint: "BLM.Effect.Hint", groups: { Surface: ["ripple", "foam", "caustic", "glint"], Fish: ["fish", "fishKind"], Current: ["current", "drift"] } },
  { id: "waterfall", hint: "BLM.Effect.WaterfallHint", groups: { Streams: ["streaks", "spray", "flow"] } },
  { id: "fountain", hint: "BLM.Effect.FountainHint", groups: { Jet: ["jet", "spill"] } },
  { id: "lava", hint: "BLM.Effect.Hint", groups: { Heat: ["glow", "sparks"] } },
  { id: "swamp", hint: "BLM.Effect.Hint", groups: { Water: ["murk", "bubbles"] } },
  { id: "fog", hint: "BLM.Effect.Hint", groups: { Fog: ["density"] } },
  { id: "fire", hint: "BLM.Effect.FireHint", groups: { Flame: ["flame", "spread"], Smoke: ["smoke", "wind"] } },
  { id: "neon", hint: "BLM.Panel.DrawHint", groups: { Glow: ["pulses", "seams", "neonColor"] } },
  { id: "rift", hint: "BLM.Effect.RiftHint", groups: { Rift: ["riftGlow", "riftCracks", "riftMotes", "riftColor"] } },
  { id: "cut", hint: "BLM.Effect.CutHint", groups: {} }
];

/** Переключатели этого компьютера — полоса внизу окна. */
const SWITCHES = ["enabled", "ambience", "footsteps", "groundWeather", "objectShadows"];

/** Вкладка «Сцена»: общее для всех эффектов. Всё, что не попало никуда, — тоже сюда. */
const SCENE = { Look: ["strength", "speed", "tokenSplash"], Trees: ["treeWind", "treeWindDirection", "treeParticles"] };

/** Забрать настройки модуля из общего окна настроек: зовётся в конце init. */
export function takeSettings() {
  for (const s of game.settings.settings.values()) {
    if (s.namespace !== MODULE_ID || !s.config) continue;
    s.config = false;
    keys.push(s.key);
  }
}

/** Открыть окно; уже открытое — вынести наверх. */
export function openPanel() {
  const open = foundry.applications.instances.get(PANEL_ID);
  if (open) return open.bringToFront();
  new WildCanvasPanel().render({ force: true });
}

/** Эффект, который ляжет на следующую нарисованную этим игроком область. */
let drawing = null;

Hooks.on("preCreateRegion", (doc, data, options, userId) => {
  if (!drawing || userId !== game.user.id) return;
  const effect = drawing;
  drawing = null;
  doc.updateSource({ name: loc(`BLM.Effect.${effect}`), flags: { [MODULE_ID]: { effect } } });
  foundry.applications.instances.get(PANEL_ID)?.maximize();
});

// Передумал рисовать — ушёл с многоугольника областей: эффект ни к чему не прилипнет.
Hooks.on("renderSceneControls", (controls) => {
  if (drawing && (controls.control?.name !== "regions" || controls.tool?.name !== "polygon")) drawing = null;
});

export class WildCanvasPanel extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: PANEL_ID,
    tag: "form",
    classes: [MODULE_ID, "blm-panel"],
    window: { title: "BLM.Title", icon: "fa-solid fa-water", resizable: true },
    position: { width: 820, height: 600 },
    form: { handler: WildCanvasPanel.#save, closeOnSubmit: true },
    actions: {
      page: WildCanvasPanel.#onPage,
      card: WildCanvasPanel.#onCard,
      draw: WildCanvasPanel.#onDraw
    }
  };

  /** Выбранная вкладка и карточка — переживают перерисовку окна. */
  #tab = "effects";
  #card = "water";

  async _renderHTML() {
    const world = game.user.can("SETTINGS_MODIFY");
    if (!world) this.#tab = "scene";
    const has = (k) => keys.includes(k) && (world || setting(k)?.scope !== CONST.SETTING_SCOPES.WORLD);
    const counts = {};
    for (const r of canvas.scene?.regions ?? []) {
      const e = r.flags?.[MODULE_ID]?.effect;
      if (e) counts[e] = (counts[e] ?? 0) + 1;
    }
    const total = Object.values(counts).reduce((a, b) => a + b, 0);

    // Всё, что не разложено ни по карточкам, ни по полосе, — на вкладку «Сцена».
    const placed = new Set([...SWITCHES, ...Object.values(SCENE).flat(), ...CARDS.flatMap((c) => Object.values(c.groups).flat())]);
    const rest = keys.filter((k) => !placed.has(k) && has(k));
    const sceneGroups = Object.entries(SCENE).map(([g, list]) => group(`BLM.Panel.Group.${g}`, list.filter(has), true, false)).join("")
      + (rest.length ? group("BLM.Panel.Group.Other", rest, true, false) : "");

    const cards = CARDS.map((c) => `
      <a class="blm-card ${c.id === this.#card ? "active" : ""}" data-action="card" data-card="${c.id}"
         data-search="${esc(loc(`BLM.Effect.${c.id}`).toLowerCase())}">
        <img src="modules/${MODULE_ID}/assets/previews/${c.id}.webp" alt="" loading="lazy">
        ${counts[c.id] ? `<span class="blm-badge">${counts[c.id]}</span>` : ""}
        <span class="blm-card-name">${esc(loc(`BLM.Effect.${c.id}`))}</span>
      </a>`).join("");

    const details = CARDS.map((c) => {
      const groups = Object.entries(c.groups)
        .map(([g, list], i) => group(`BLM.Panel.Group.${g}`, list.filter(has), i === 0))
        .join("");
      return `
      <div class="blm-detail" data-detail="${c.id}" ${c.id === this.#card ? "" : "hidden"}>
        <div class="blm-detail-head">
          <img src="modules/${MODULE_ID}/assets/previews/${c.id}.webp" alt="">
          <h3>${esc(loc(`BLM.Effect.${c.id}`))}</h3>
        </div>
        ${game.user.isGM ? `<button type="button" class="blm-draw" data-action="draw" data-effect="${c.id}">
          <i class="fa-solid fa-draw-polygon"></i> ${esc(loc("BLM.Panel.Draw"))}</button>` : ""}
        <p class="hint">${esc(loc(c.hint))}</p>
        ${groups}
      </div>`;
    }).join("");

    // Не `data-action="tab"`: это действие ядро ApplicationV2 забирает себе.
    const tab = (id, icon) => `<a class="blm-tab ${this.#tab === id ? "active" : ""}" data-action="page" data-page="${id}">
      <i class="fa-solid ${icon}"></i> ${esc(loc(`BLM.Panel.Tab.${id}`))}</a>`;

    const switches = SWITCHES.filter(has).map((k) => {
      const s = setting(k);
      return `<label class="blm-switch" data-tooltip="${esc(s.hint ? loc(s.hint) : "")}">
        <input type="checkbox" name="${s.id}" ${game.settings.get(MODULE_ID, k) ? "checked" : ""}>
        <span>${esc(loc(s.name))}</span></label>`;
    }).join("");

    return `
      <header class="blm-bar">
        ${world ? `<input type="search" class="blm-search" placeholder="${esc(loc("BLM.Panel.Search"))}" ${this.#tab === "effects" ? "" : "style=\"visibility: hidden\""}>` : ""}
        <nav class="blm-tabs">${world ? tab("effects", "fa-wand-magic-sparkles") : ""}${tab("scene", "fa-mountain-sun")}</nav>
        ${world ? `<span class="blm-count">${esc(game.i18n.format("BLM.Panel.OnScene", { n: total }))}</span>` : ""}
      </header>
      <section class="blm-page" data-page="effects" ${this.#tab === "effects" ? "" : "hidden"}>
        <div class="blm-grid">${cards}</div>
        <aside class="blm-side">${details}</aside>
      </section>
      <section class="blm-page blm-scene" data-page="scene" ${this.#tab === "scene" ? "" : "hidden"}>${sceneGroups}</section>
      <footer class="blm-foot">
        ${switches}
        <button type="submit"><i class="fa-solid fa-floppy-disk"></i> ${esc(loc("SETTINGS.Save"))}</button>
      </footer>`;
  }

  _replaceHTML(result, content) {
    content.innerHTML = result;
    // Поиск: прячет карточки, чьё имя не подходит.
    content.querySelector(".blm-search")?.addEventListener("input", (event) => {
      const q = event.target.value.trim().toLowerCase();
      for (const card of content.querySelectorAll(".blm-card")) card.hidden = !!q && !card.dataset.search.includes(q);
    });
  }

  static #onPage(event, target) {
    this.#tab = target.dataset.page;
    for (const t of this.element.querySelectorAll(".blm-tab")) t.classList.toggle("active", t === target);
    for (const p of this.element.querySelectorAll(".blm-page")) p.hidden = p.dataset.page !== this.#tab;
    // Поиск ищет только карточки — на «Сцене» ему нечего искать.
    const search = this.element.querySelector(".blm-search");
    if (search) search.style.visibility = this.#tab === "effects" ? "" : "hidden";
  }

  static #onCard(event, target) {
    this.#card = target.dataset.card;
    for (const c of this.element.querySelectorAll(".blm-card")) c.classList.toggle("active", c === target);
    for (const d of this.element.querySelectorAll(".blm-detail")) d.hidden = d.dataset.detail !== this.#card;
  }

  /** Нарисовать область: инструмент многоугольника, новая область сразу с эффектом. */
  static async #onDraw(event, target) {
    if (!canvas.ready) return;
    canvas.regions.templateMode = false;
    await ui.controls.activate({ control: "regions", tool: "polygon" });
    canvas.regions.releaseAll();
    // После переключения: перерисовка панели инструментов сбрасывает ожидание (см. выше).
    drawing = target.dataset.effect;
    this.minimize();
    ui.notifications.info(game.i18n.format("BLM.Panel.DrawNow", { effect: loc(`BLM.Effect.${drawing}`) }));
  }

  /** Сохранить изменённое: каждая настройка — своим `set`, со своим onChange. */
  static async #save(event, form) {
    for (const k of keys) {
      const s = setting(k);
      const el = form.querySelector(`[name="${s?.id}"]`);
      if (!s || !el) continue;
      const value = s.type === Boolean ? el.checked : Number(el.value);
      if (s.type !== Boolean && !Number.isFinite(value)) continue;
      if (value !== game.settings.get(MODULE_ID, k)) await game.settings.set(MODULE_ID, k, value);
    }
  }
}

function setting(k) {
  return game.settings.settings.get(`${MODULE_ID}.${k}`);
}

/** Сворачиваемая группа ползунков. */
function group(title, list, open, short = true) {
  if (!list.length) return "";
  return `<details class="blm-group" ${open ? "open" : ""}>
    <summary>${esc(loc(title))}</summary>${list.map((k) => row(k, short)).join("")}</details>`;
}

/** Строка: подпись, поле. Подсказка — во всплывающей подсказке подписи. */
function row(k, short) {
  const s = setting(k);
  if (!s) return "";
  const value = game.settings.get(MODULE_ID, k);
  let field;
  if (s.type === Boolean) field = `<input type="checkbox" name="${s.id}" ${value ? "checked" : ""}>`;
  else if (s.choices) {
    const opts = Object.entries(s.choices).map(([v, l]) => `<option value="${esc(v)}" ${String(value) === v ? "selected" : ""}>${esc(loc(l))}</option>`).join("");
    field = `<select name="${s.id}" data-dtype="Number">${opts}</select>`;
  } else if (s.range) {
    const { min, max, step } = s.range;
    field = `<range-picker name="${s.id}" value="${Number(value)}" min="${min}" max="${max}" step="${step}"></range-picker>`;
  } else field = `<input type="number" name="${s.id}" value="${Number(value)}">`;
  const tip = s.hint ? ` data-tooltip="${esc(loc(s.hint))}"` : "";
  return `<div class="form-group"><label${tip}>${esc(short ? label(k, s) : loc(s.name))}</label><div class="form-fields">${field}</div></div>`;
}

/** Подпись без приставки эффекта: в группе «Вода» не нужно «Вода: рябь». */
function label(k, s) {
  const param = `BLM.Param.${k}`;
  const text = loc(param);
  return text !== param ? text : loc(s.name);
}
