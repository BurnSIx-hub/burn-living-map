// Тени облаков: по сцене плывут мягкие тёмные пятна, по ветру «Wild Canvas»
// (`wind()`, тот же, что качает кроны). Изредка туча прикрывает солнце: вся сцена
// на несколько секунд тускнеет и светлеет обратно. Свет Foundry не трогается —
// это свой меш над картой, крышами и токенами, затемняет умножением.
//
// Флаги сцены: `clouds` — сила (0 — выкл), `cloudCover` — густота. Окно сцены,
// вкладка «Окружение». Картограф ставит их лесу и кварталу.
// Ночью (тьма сцены) тени гаснут, под снегом Foundry — мягче.
// Под растворившейся крышей (токен в доме) тени нет: та же маска глубины Foundry,
// что прячет там дождь, — синий канал у крыш, не пускающих погоду.

import { wind } from "./wind.js";

const MODULE_ID = "burn-living-map";
/** Над крышами (20 + 10 на этаж) и токенами. */
const HIGH = 100000;
/** Средний размер тучи в клетках. */
const SIZE = 14;
/** Скорость туч, клеток в секунду: в штиль и прибавка от силы ветра. */
const DRIFT = 0.12, GUST = 0.3;
/** Солнце прячется раз в столько секунд (случайно между), на столько. */
const SUN_EVERY = [70, 200], SUN_HOLD = [4, 9], SUN_IN = 4, SUN_OUT = 6;

const FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 vPos;
varying vec2 vMask;
uniform float uGrid, uShade, uDensity, uSun, uSize;
uniform vec2 uOffset;
uniform sampler2D uDepth;
uniform bool uUseDepth;

float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + vec2(17.1, 9.2); a *= 0.5; }
  return v;
}
void main() {
  vec2 q = (vPos / uGrid - uOffset) / uSize;
  // Лёгкое завихрение: края туч рваные, а не круглые пятна шума.
  vec2 w = vec2(fbm(q * 0.7 + 3.1), fbm(q * 0.7 + 7.7));
  float n = fbm(q + 0.8 * w);
  // Густота сдвигает порог; когда туча на солнце — туч больше.
  // fbm с завихрением собран тесно около 0,37: порог 0,43 — небо почти чистое,
  // 0,36 — больше половины в тучах. Мерилось на тестовой странице.
  float thr = mix(0.43, 0.36, uDensity) - 0.03 * uSun;
  float c = smoothstep(thr, thr + 0.06, n);
  // Тень плюс общее притенение, пока солнце прикрыто.
  float a = clamp(uShade * (c + 0.75 * uSun), 0.0, 0.7);
  // Под крышей, что растворилась над токеном, неба не видно.
  if (uUseDepth) a *= 1.0 - step(0.5 / 255.0, texture2D(uDepth, vMask).b);
  // Тень холодная: синевато-серая, не чёрная. Умножение: dst * (tint*a + 1 - a).
  vec3 tint = vec3(0.34, 0.38, 0.46);
  gl_FragColor = vec4(tint * a, a);
}`;

const VERT = `
attribute vec2 aVertexPosition;
uniform mat3 projectionMatrix;
uniform mat3 translationMatrix;
uniform vec2 screenDimensions;
varying vec2 vPos;
varying vec2 vMask;
void main() {
  vPos = aVertexPosition;
  vec3 tPos = translationMatrix * vec3(aVertexPosition, 1.0);
  // Как у мешей Foundry: маски экранного размера, координата — от экрана.
  vMask = tPos.xy / screenDimensions;
  gl_Position = vec4((projectionMatrix * tPos).xy, 0.0, 1.0);
}`;

let mesh = null;
let last = 0;
const off = { x: 0, y: 0 };
const sun = { v: 0, phase: "wait", until: 0 };

const rand = ([a, b]) => a + Math.random() * (b - a);
const now = () => performance.now() / 1000;

function flags() {
  const f = canvas.scene?.flags?.[MODULE_ID] ?? {};
  return { shade: Number(f.clouds ?? 0), density: Number(f.cloudCover ?? 0.5) };
}

/** Собрать заново: сцена сменилась, флаги или «включено». */
export function rebuildClouds() {
  clearClouds();
  if (!canvas.ready || !game.settings.get(MODULE_ID, "enabled")) return;
  const { shade, density } = flags();
  if (!(shade > 0)) return;
  const r = canvas.dimensions.sceneRect;
  const verts = new Float32Array([r.left, r.top, r.right, r.top, r.right, r.bottom, r.left, r.bottom]);
  const geometry = new PIXI.Geometry().addAttribute("aVertexPosition", verts, 2).addIndex(new Uint16Array([0, 1, 2, 0, 2, 3]));
  const shader = PIXI.Shader.from(VERT, FRAG, {
    uGrid: canvas.grid.size, uShade: 0, uDensity: density, uSun: 0, uSize: SIZE,
    uOffset: new Float32Array([Math.random() * 500, Math.random() * 500]),
    uDepth: canvas.masks?.depth?.renderTexture ?? PIXI.Texture.EMPTY,
    uUseDepth: !!canvas.masks?.depth?.renderTexture,
    screenDimensions: canvas.screenDimensions
  });
  mesh = new PIXI.Mesh(geometry, shader);
  mesh.name = `${MODULE_ID}.clouds`;
  mesh.blendMode = PIXI.BLEND_MODES.MULTIPLY;
  mesh.elevation = HIGH;
  mesh.sortLayer = 1000;
  mesh.eventMode = "none";
  canvas.primary.addChild(mesh);
  off.x = shader.uniforms.uOffset[0];
  off.y = shader.uniforms.uOffset[1];
  sun.v = 0;
  sun.phase = "wait";
  sun.until = now() + rand(SUN_EVERY) * 0.5;
  last = now();
  canvas.app.ticker.add(tick);
}

export function clearClouds() {
  canvas.app?.ticker.remove(tick);
  if (mesh && !mesh.destroyed) mesh.destroy({ children: true });
  mesh = null;
}

/** Солнце: ждём → туча наползает → держится → уходит → ждём. */
function stepSun(t, dt) {
  if (t >= sun.until) {
    if (sun.phase === "wait") { sun.phase = "in"; sun.until = t + SUN_IN; }
    else if (sun.phase === "in") { sun.phase = "hold"; sun.until = t + rand(SUN_HOLD); }
    else if (sun.phase === "hold") { sun.phase = "out"; sun.until = t + SUN_OUT; }
    else { sun.phase = "wait"; sun.until = t + rand(SUN_EVERY); }
  }
  const target = sun.phase === "in" || sun.phase === "hold" ? 1 : 0;
  const rate = target ? 1 / SUN_IN : 1 / SUN_OUT;
  sun.v += Math.sign(target - sun.v) * Math.min(Math.abs(target - sun.v), rate * dt);
}

function tick() {
  if (!mesh || mesh.destroyed) return;
  const t = now();
  const dt = Math.min(0.1, t - last);
  last = t;
  const w = wind();
  const speed = DRIFT + GUST * Math.min(w.force, 2.5);
  off.x += w.dx * speed * dt;
  off.y += w.dy * speed * dt;
  stepSun(t, dt);
  const { shade, density } = flags();
  const dark = canvas.environment?.darknessLevel ?? canvas.scene?.environment?.darknessLevel ?? 0;
  const snow = canvas.scene?.weather ? 0.6 : 1;
  const u = mesh.shader.uniforms;
  u.uOffset[0] = off.x;
  u.uOffset[1] = off.y;
  // Окно меняют — Foundry подменяет и размер экрана, и текстуру маски.
  u.screenDimensions = canvas.screenDimensions;
  const depth = canvas.masks?.depth?.renderTexture;
  u.uUseDepth = !!depth;
  if (depth) u.uDepth = depth;
  u.uDensity = density;
  u.uSun = sun.v * snow;
  u.uShade = shade * game.settings.get(MODULE_ID, "strength") * snow * Math.max(0, 1 - dark * 1.2) * 0.45;
}

/* ------------------------------ Окно сцены ------------------------------ */

const loc = (k) => game.i18n.localize(`BLM.${k}`);

// Вкладка «Окружение»: сила и густота теней облаков.
Hooks.on("renderSceneConfig", (app, element) => {
  const root = element instanceof HTMLElement ? element : element[0];
  const tab = root?.querySelector('.tab[data-tab="environment"]');
  if (!tab || tab.querySelector(`.${MODULE_ID}-clouds`)) return;
  const f = app.document.flags?.[MODULE_ID] ?? {};
  const set = document.createElement("fieldset");
  set.className = `${MODULE_ID}-clouds`;
  set.innerHTML = `
    <legend>🔥 ${loc("Clouds.Title")}</legend>
    <div class="form-group">
      <label>${loc("Clouds.Shade")}</label>
      <div class="form-fields"><range-picker name="flags.${MODULE_ID}.clouds" value="${Number(f.clouds ?? 0)}" min="0" max="1" step="0.05"></range-picker></div>
      <p class="hint">${loc("Clouds.Hint")}</p>
    </div>
    <div class="form-group">
      <label>${loc("Clouds.Cover")}</label>
      <div class="form-fields"><range-picker name="flags.${MODULE_ID}.cloudCover" value="${Number(f.cloudCover ?? 0.5)}" min="0" max="1" step="0.05"></range-picker></div>
    </div>`;
  tab.append(set);
});

Hooks.on("canvasReady", () => rebuildClouds());
Hooks.on("canvasTearDown", () => clearClouds());
Hooks.on("updateScene", (scene, changes) => {
  if (scene !== canvas.scene) return;
  const f = changes.flags?.[MODULE_ID];
  if (f && ("clouds" in f || "cloudCover" in f)) rebuildClouds();
});
