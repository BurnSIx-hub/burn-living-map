// Окно настроек Wild Canvas: открывается плиткой BurnHub, без BurnHub — кнопкой
// в настройках игры. Все настройки модуля живут здесь, а не в общем окне:
// `takeSettings` в конце init снимает с них `config` и запоминает порядок.
// Сверху — свои (на этом компьютере), ниже — настройки мира; их видит тот,
// кому Foundry разрешает менять настройки мира (как в общем окне).
// Ползунки видно сразу (main.js ловит `renderWildCanvasPanel`), закрыл без
// сохранения — вернулось как было (`closeWildCanvasPanel`).

const MODULE_ID = "burn-living-map";
const PANEL_ID = `${MODULE_ID}-panel`;
const { ApplicationV2 } = foundry.applications.api;
const loc = (k) => game.i18n.localize(k);
const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));

/** Ключи настроек окна в порядке регистрации. */
const keys = [];

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

export class WildCanvasPanel extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: PANEL_ID,
    tag: "form",
    classes: [MODULE_ID, "standard-form"],
    window: { title: "BLM.Title", icon: "fa-solid fa-water", resizable: true },
    position: { width: 560, height: 720 },
    form: { handler: WildCanvasPanel.#save, closeOnSubmit: true }
  };

  async _renderHTML() {
    const all = keys.map((k) => game.settings.settings.get(`${MODULE_ID}.${k}`)).filter(Boolean);
    const own = all.filter((s) => s.scope !== CONST.SETTING_SCOPES.WORLD);
    const world = game.user.can("SETTINGS_MODIFY") ? all.filter((s) => s.scope === CONST.SETTING_SCOPES.WORLD) : [];
    const block = (legend, list) => list.length ? `<fieldset><legend>${esc(loc(legend))}</legend>${list.map(row).join("")}</fieldset>` : "";
    return `
      <section class="blm-panel" style="flex: 1; overflow-y: auto; padding-right: 4px;">
        ${block("BLM.Panel.Own", own)}
        ${block("BLM.Panel.World", world)}
      </section>
      <footer class="form-footer">
        <button type="submit"><i class="fa-solid fa-floppy-disk"></i> <span>${esc(loc("SETTINGS.Save"))}</span></button>
      </footer>`;
  }

  _replaceHTML(result, content) {
    content.innerHTML = result;
  }

  /** Сохранить изменённое: каждая настройка — своим `set`, со своим onChange. */
  static async #save(event, form) {
    for (const k of keys) {
      const s = game.settings.settings.get(`${MODULE_ID}.${k}`);
      const el = form.querySelector(`[name="${s?.id}"]`);
      if (!s || !el) continue;
      const value = s.type === Boolean ? el.checked : Number(el.value);
      if (s.type !== Boolean && !Number.isFinite(value)) continue;
      if (value !== game.settings.get(MODULE_ID, k)) await game.settings.set(MODULE_ID, k, value);
    }
  }
}

/** Строка окна: подпись, поле, подсказка. */
function row(s) {
  const value = game.settings.get(MODULE_ID, s.key);
  let field;
  if (s.type === Boolean) field = `<input type="checkbox" name="${s.id}" ${value ? "checked" : ""}>`;
  else if (s.choices) {
    const opts = Object.entries(s.choices).map(([v, l]) => `<option value="${esc(v)}" ${String(value) === v ? "selected" : ""}>${esc(loc(l))}</option>`).join("");
    field = `<select name="${s.id}" data-dtype="Number">${opts}</select>`;
  } else if (s.range) {
    const { min, max, step } = s.range;
    field = `<range-picker name="${s.id}" value="${Number(value)}" min="${min}" max="${max}" step="${step}"></range-picker>`;
  } else field = `<input type="number" name="${s.id}" value="${Number(value)}">`;
  const hint = s.hint ? `<p class="hint">${esc(loc(s.hint))}</p>` : "";
  return `
    <div class="form-group">
      <label>${esc(loc(s.name))}</label>
      <div class="form-fields">${field}</div>
      ${hint}
    </div>`;
}
