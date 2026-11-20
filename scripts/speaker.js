// Колонка: тайл с пометкой `speaker` ("on" / "off") играет эквалайзером.
//
// Полоски на панели колонки прыгают под музыку, от корпуса расходятся кольца,
// неоновая рамка вздрагивает на басах — видно, что колонка включена. Выключенная
// стоит тёмной. Включает и выключает Мастер кнопкой на панели тайла.
//
// Звук берётся с того, что сейчас играет у этого игрока (у каждого — своё):
//   1. HTML-аудио на странице (поток Lazy Music и т. п.) — через captureStream,
//      сам звук при этом не трогается;
//   2. каналы Foundry «музыка» и «окружение» — их анализатор;
//   3. YouTube-плеер Lazy Music — к его звуку доступа нет, полоски идут сами,
//      пока плеер играет;
//   4. тишина — колонка включена, но «ждёт»: полоски еле дышат.
//
// Рисуется поверх тайла в его осях (как пламя в blaze.js): место, поворот, размер —
// от тайла. Нарисованные на картинке полоски закрываются панелью, если это колонка
// из набора Картографа; у другой картинки полоски встают внизу по середине.

const MODULE_ID = "burn-living-map";
const loc = (k) => game.i18n.localize(`BLM.${k}`);

const BARS = 11;
const SEGMENTS = 5;
/** Панель эквалайзера у `Speaker_Stack_Neon` — доли картинки. */
const PANEL = { x0: 82 / 256, x1: 174 / 256, y0: 216 / 256, y1: 235 / 256 };
/** У чужой картинки — полоса внизу по середине. */
const PANEL_ANY = { x0: 0.3, x1: 0.7, y0: 0.84, y1: 0.93 };
/** Решётка динамика — крупный эквалайзер, видный с карты. */
const GRILLE = { x0: 0.26, x1: 0.74, y0: 0.26, y1: 0.73 };
const GRILLE_BARS = 9, GRILLE_SEG = 8;
const CYAN = 0x3ff4ff, MAGENTA = 0xff4fe6, PANEL_FILL = 0x221c2a;

/** @type {Map<string, {tile: Tile, gfx: PIXI.Graphics, rings: {age:number}[], cool:number, lvl:Float32Array, peak:Float32Array}>} */
const speakers = new Map();
let ticking = false;
let last = 0;

export const stateOf = (doc) => doc?.flags?.[MODULE_ID]?.speaker ?? null;

/* ------------------------------ Источники звука ------------------------------ */

// Любое HTML-аудио, которое начинало играть: Lazy Music создаёт его вне документа.
const media = new Set();
const proto = globalThis.HTMLMediaElement?.prototype;
if (proto && !proto._blmSpeakerPatched) {
  const play = proto.play;
  proto.play = function (...args) {
    media.add(this);
    return play.apply(this, args);
  };
  proto._blmSpeakerPatched = true;
}

/** @type {WeakMap<HTMLMediaElement, {src:string, analyser:AnalyserNode, data:Float32Array}|null>} */
const taps = new WeakMap();

function tapOf(el) {
  const src = el.currentSrc || el.src || "";
  const old = taps.get(el);
  if (old !== undefined && (old === null || old.src === src)) return old;
  let tap = null;
  try {
    const capture = el.captureStream ?? null; // в Firefox mozCaptureStream глушит звук — не берём
    const ctx = game.audio?.getAnalyzerContext?.();
    if (capture && ctx) {
      const stream = capture.call(el);
      if (stream.getAudioTracks().length) {
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        analyser.smoothingTimeConstant = 0.6;
        ctx.createMediaStreamSource(stream).connect(analyser);
        tap = { src, analyser, data: new Float32Array(analyser.frequencyBinCount) };
      } else {
        return null; // дорожки появятся, когда пойдёт звук — попробуем в следующий раз
      }
    }
  } catch (err) {
    console.warn(`${MODULE_ID} | speaker: no access to audio`, err?.message ?? err);
  }
  taps.set(el, tap);
  return tap;
}

/** Полосы 0..1 по частотам от 40 Гц до 12 кГц, логарифмически. */
function bandsOf(analyser, data, out) {
  analyser.getFloatFrequencyData(data);
  const rate = analyser.context.sampleRate;
  const bin = rate / analyser.fftSize;
  let sum = 0;
  for (let i = 0; i < BARS; i++) {
    const f0 = 40 * Math.pow(12000 / 40, i / BARS), f1 = 40 * Math.pow(12000 / 40, (i + 1) / BARS);
    const a = Math.max(1, Math.floor(f0 / bin)), b = Math.max(a + 1, Math.ceil(f1 / bin));
    let m = -Infinity;
    for (let k = a; k < b && k < data.length; k++) m = Math.max(m, data[k]);
    const v = Math.min(1, Math.max(0, (m + 85) / 60));
    out[i] = v;
    sum += v;
  }
  return sum / BARS;
}

const scratch = new Float32Array(BARS);

/** Уровни сейчас: что громче — то и играет. Возвращает источник для отладки. */
function measure(out) {
  out.fill(0);
  let best = 0, kind = "silence";
  // 1. HTML-аудио.
  for (const el of media) {
    if (el.paused || el.ended || el.muted || el.volume === 0) continue;
    const tap = tapOf(el);
    if (!tap) continue;
    const avg = bandsOf(tap.analyser, tap.data, scratch);
    if (avg > best) { best = avg; out.set(scratch); kind = "media"; }
  }
  // 2. Каналы Foundry.
  for (const name of ["music", "environment"]) {
    const a = game.audio?.analyzer?.[name];
    if (!a) continue;
    if (!a.active) game.audio.enableAnalyzer?.(name);
    a.lastUsed = performance.now();
    if (!a.node) continue;
    const data = (a._blmData ??= new Float32Array(a.node.frequencyBinCount));
    const avg = bandsOf(a.node, data, scratch);
    if (avg > best) { best = avg; out.set(scratch); kind = name; }
  }
  if (best > 0.04) return kind;
  // 3. YouTube у Lazy Music — звука не достать, но видно, что играет.
  const yt = globalThis._lmYTPlayer;
  const ytOn = yt?.getPlayerState?.() === 1;
  const t = performance.now() / 1000;
  if (ytOn) {
    const beat = Math.exp(-((t * 2) % 1) * 5); // 120 ударов в минуту
    for (let i = 0; i < BARS; i++) {
      const n = 0.5 + 0.5 * Math.sin(t * (3.1 + i * 0.7) + i * 1.9) * Math.sin(t * (1.3 + i * 0.37));
      out[i] = Math.min(1, (i < 3 ? beat * 0.8 : beat * 0.3) + n * 0.55);
    }
    return "youtube";
  }
  // 4. Тишина: еле дышит.
  for (let i = 0; i < BARS; i++) out[i] = 0.12 + 0.08 * Math.sin(t * 1.6 + i * 0.8);
  return "idle";
}

/* ------------------------------ Рисование ------------------------------ */

function rebuildOne(tile) {
  dropOne(tile.id);
  const state = stateOf(tile.document);
  if (!state || !tile.mesh) return;
  const gfx = new PIXI.Graphics();
  gfx.name = `${MODULE_ID}.speaker.${tile.id}`;
  gfx.eventMode = "none";
  canvas.primary.addChild(gfx);
  speakers.set(tile.id, { tile, gfx, rings: [], cool: 0, lvl: new Float32Array(BARS), peak: new Float32Array(BARS) });
}

function dropOne(id) {
  const s = speakers.get(id);
  if (!s) return;
  if (!s.gfx.destroyed) s.gfx.destroy();
  speakers.delete(id);
}

/** Колонка на меше Boundless под видом тайла (см. boundless.js). */
export function addSpeaker(tile) {
  if (speakers.has(tile.id) || !canvas.ready || !stateOf(tile.document)) return;
  rebuildOne(tile);
  if (speakers.size && !ticking) {
    last = performance.now() / 1000;
    canvas.app.ticker.add(tick);
    ticking = true;
  }
}

export const dropSpeaker = (id) => dropOne(id);
export const speakerKeys = () => speakers.keys();

export function clearSpeakers() {
  for (const id of [...speakers.keys()]) dropOne(id);
}

export function rebuildSpeakers() {
  clearSpeakers();
  if (!canvas.ready || !canvas.tiles) return;
  for (const tile of canvas.tiles.placeables) if (stateOf(tile.document)) rebuildOne(tile);
  if (speakers.size && !ticking) {
    last = performance.now() / 1000;
    canvas.app.ticker.add(tick);
    ticking = true;
  }
}

const levels = new Float32Array(BARS);
let source = "idle";

function tick() {
  if (!speakers.size || !canvas.ready) {
    canvas.app?.ticker.remove(tick);
    ticking = false;
    return;
  }
  const now = performance.now() / 1000;
  const dt = Math.min(now - last, 0.1);
  last = now;
  let anyOn = false;
  for (const s of speakers.values()) if (stateOf(s.tile.document) === "on") anyOn = true;
  if (anyOn) source = measure(levels);
  for (const s of speakers.values()) draw(s, dt);
}

function draw(s, dt) {
  const { tile, gfx } = s;
  const tm = tile.mesh;
  gfx.clear();
  if (!tm || tm.destroyed || gfx.destroyed) return;
  const on = stateOf(tile.document) === "on";
  // Положение тайла: те же оси, что у картинки.
  gfx.position.copyFrom(tm.position);
  gfx.scale.copyFrom(tm.scale);
  gfx.skew.copyFrom(tm.skew);
  gfx.pivot.copyFrom(tm.pivot);
  gfx.rotation = tm.rotation;
  gfx.elevation = tm.elevation;
  gfx.sortLayer = tm.sortLayer;
  gfx.sort = (tm.sort ?? 0) + 0.5;
  // Порядок в основной группе пересчитывается только по флагу: без него полоски под картинкой.
  if (s.sortedFor !== tm) { canvas.primary.sortDirty = true; s.sortedFor = tm; }
  gfx.visible = tm.visible && tm.renderable !== false && tile.visible !== false;
  gfx.alpha = tm.alpha ?? 1;
  const tex = tm.texture;
  const tw = tex.orig?.width ?? tex.width, th = tex.orig?.height ?? tex.height;
  const x0 = -(tm.anchor?.x ?? 0.5) * tw, y0 = -(tm.anchor?.y ?? 0.5) * th;
  // Своя колонка — по имени картинки или по сцене Картографа: при выгрузке картинка
  // переименовывается («…_предмет_1.webp»), а колонкой-тайлом он ставит только её.
  const own = /speaker_stack/i.test(tile.document.texture?.src ?? "") || !!canvas.scene?.flags?.kartograf;
  const P = own ? PANEL : PANEL_ANY;
  const px0 = x0 + P.x0 * tw, px1 = x0 + P.x1 * tw, py0 = y0 + P.y0 * th, py1 = y0 + P.y1 * th;

  // Панель: свои полоски вместо нарисованных.
  if (own) gfx.beginFill(PANEL_FILL, 1).drawRect(px0, py0, px1 - px0, py1 - py0).endFill();

  // Уровни с плавным спадом и пиками.
  for (let i = 0; i < BARS; i++) {
    const target = on ? levels[i] : 0;
    s.lvl[i] = target > s.lvl[i] ? target : Math.max(target, s.lvl[i] - dt * 2.2);
    s.peak[i] = Math.max(s.lvl[i], s.peak[i] - dt * 0.7);
  }
  const bass = on ? (s.lvl[0] + s.lvl[1] + s.lvl[2]) / 3 : 0;

  // Полоски: столбики из сегментов, верхний сегмент на пике — пурпурный.
  const cw = (px1 - px0) / BARS;
  const sh = (py1 - py0) / SEGMENTS;
  for (let i = 0; i < BARS; i++) {
    const n = Math.round(s.lvl[i] * SEGMENTS);
    const pk = Math.min(SEGMENTS - 1, Math.round(s.peak[i] * SEGMENTS));
    for (let k = 0; k < SEGMENTS; k++) {
      const lit = k < n;
      const isPeak = on && k === pk && pk > 0;
      if (!lit && !isPeak) continue;
      const x = px0 + i * cw + cw * 0.2, y = py1 - (k + 1) * sh + sh * 0.18;
      gfx.beginFill(isPeak && !lit ? MAGENTA : CYAN, lit ? 0.95 : 0.8).drawRect(x, y, cw * 0.6, sh * 0.64).endFill();
    }
  }

  // Крупно на решётке: полупрозрачные столбики снизу вверх (только у своей колонки).
  if (own && on) {
    const gx0 = x0 + GRILLE.x0 * tw, gx1 = x0 + GRILLE.x1 * tw, gy0 = y0 + GRILLE.y0 * th, gy1 = y0 + GRILLE.y1 * th;
    const gw = (gx1 - gx0) / GRILLE_BARS, gs = (gy1 - gy0) / GRILLE_SEG;
    for (let j = 0; j < GRILLE_BARS; j++) {
      const i = Math.min(BARS - 1, Math.round((j * (BARS - 1)) / (GRILLE_BARS - 1)));
      const n = Math.round(s.lvl[i] * GRILLE_SEG);
      const pk = Math.min(GRILLE_SEG - 1, Math.round(s.peak[i] * GRILLE_SEG));
      for (let k = 0; k < GRILLE_SEG; k++) {
        const lit = k < n, isPeak = k === pk && pk > 0;
        if (!lit && !isPeak) continue;
        const hot = k / GRILLE_SEG;
        const color = isPeak && !lit ? MAGENTA : hot > 0.7 ? MAGENTA : CYAN;
        gfx.beginFill(color, lit ? 0.22 + 0.25 * hot : 0.35)
          .drawRect(gx0 + j * gw + gw * 0.14, gy1 - (k + 1) * gs + gs * 0.14, gw * 0.72, gs * 0.72).endFill();
      }
    }
  }

  if (!on) { s.rings.length = 0; return; }

  // Рамка вздрагивает на басах.
  const inset = 0.085 * tw;
  gfx.lineStyle({ width: tw * 0.02, color: MAGENTA, alpha: 0.12 + 0.45 * bass });
  gfx.drawRoundedRect(x0 + inset, y0 + inset, tw - 2 * inset, th - 2 * inset, tw * 0.07);

  // Кольца от корпуса — на ударе баса, не чаще трёх в секунду.
  s.cool -= dt;
  if (bass > 0.45 && s.cool <= 0) { s.rings.push({ age: 0, k: bass }); s.cool = 0.33; }
  const cx = x0 + tw / 2, cy = y0 + th / 2;
  for (const r of s.rings) {
    r.age += dt;
    const p = r.age / 1.1;
    const rad = tw * (0.55 + 0.6 * p);
    gfx.lineStyle({ width: tw * 0.018 * (1 - p * 0.5), color: MAGENTA, alpha: 0.32 * r.k * (1 - p) });
    gfx.drawCircle(cx, cy, rad);
  }
  s.rings = s.rings.filter((r) => r.age < 1.1);
  gfx.lineStyle(0);
}

/* ------------------------------ Окна ------------------------------ */

// Окно тайла, вкладка «Вид»: сделать тайл колонкой.
Hooks.on("renderTileConfig", (app, element) => {
  const root = element instanceof HTMLElement ? element : element[0];
  const tab = root?.querySelector('.tab[data-tab="appearance"]') ?? root?.querySelector(".tab[data-tab]");
  if (!tab || tab.querySelector(`.${MODULE_ID}-speaker`)) return;
  const now = stateOf(app.document) ?? "";
  const set = document.createElement("fieldset");
  set.className = `${MODULE_ID}-speaker`;
  set.innerHTML = `
    <legend>🔥 ${loc("Speaker.Title")}</legend>
    <div class="form-group">
      <label>${loc("Speaker.Label")}</label>
      <div class="form-fields"><select name="flags.${MODULE_ID}.speaker">
        ${["", "off", "on"].map((v) => `<option value="${v}" ${v === now ? "selected" : ""}>${loc(`Speaker.${v || "none"}`)}</option>`).join("")}
      </select></div>
      <p class="hint">${loc("Speaker.Hint")}</p>
    </div>`;
  tab.append(set);
});

// Панель тайла у Мастера: включить или выключить колонку.
Hooks.on("renderTileHUD", (hud, element) => {
  const doc = hud.object?.document;
  const state = stateOf(doc);
  if (!state || !game.user.isGM) return;
  const root = element instanceof HTMLElement ? element : element[0];
  const col = root?.querySelector(".col.right") ?? root?.querySelector(".col.left");
  if (!col) return;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = `control-icon ${state === "on" ? "active" : ""}`;
  btn.dataset.tooltip = loc(state === "on" ? "Speaker.TurnOff" : "Speaker.TurnOn");
  btn.innerHTML = `<i class="fa-solid ${state === "on" ? "fa-volume-high" : "fa-volume-xmark"}"></i>`;
  btn.addEventListener("click", async (ev) => {
    ev.preventDefault();
    await doc.update({ [`flags.${MODULE_ID}.speaker`]: state === "on" ? "off" : "on" });
    hud.render?.();
  });
  col.append(btn);
});

/* ------------------------------ Хуки ------------------------------ */

export function registerSpeakers() {
  Hooks.on("canvasReady", () => rebuildSpeakers());
  Hooks.on("canvasTearDown", () => clearSpeakers());
  for (const hook of ["createTile", "updateTile", "deleteTile"]) {
    Hooks.on(hook, (doc) => {
      if (doc.parent !== canvas.scene) return;
      setTimeout(() => rebuildSpeakers(), 0);
    });
  }
  // Только что созданный тайл получает картинку позже createTile — ловим отрисовку.
  Hooks.on("drawTile", (tile) => {
    if (tile.document?.parent === canvas.scene && stateOf(tile.document) && !speakers.has(tile.id)) setTimeout(() => rebuildSpeakers(), 0);
  });
}

/** Откуда сейчас берётся звук — для проверки: media, music, environment, youtube, idle. */
export const speakerSource = () => source;
